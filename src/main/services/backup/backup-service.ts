import { createHash, randomUUID } from 'node:crypto'
import {
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync
} from 'node:fs'
import { copyFile, lstat, mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { BackupManifest, BackupResult } from '../../../shared/backup'

const ROOTS = [
  'toolbox.db',
  'covers',
  'backgrounds',
  'ai-settings.json',
  'password-master-key.json'
] as const
const MAX_FILES = 100_000
const MAX_MANIFEST_BYTES = 32 * 1024 * 1024
const JOURNAL = 'snapshot-restore-journal.json'

/** 数据层能力注入，服务不直接持有 SQLite 连接或明文加密密钥。 */
export interface BackupDatabase {
  backupTo(path: string): Promise<number>
  inspect(path: string): number
  close(): void
}

function inside(root: string, path: string): boolean {
  const tail = relative(resolve(root), resolve(path))
  return tail !== '' && !tail.startsWith(`..${sep}`) && tail !== '..' && !isAbsolute(tail)
}

async function digest(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

/** 快照使用固定根清单、普通文件、哈希校验与暂存目录，拒绝链接与清单路径穿越。 */
export class BackupService {
  private busy = false
  constructor(
    private readonly userData: string,
    private readonly documents: string,
    private readonly database: BackupDatabase,
    private readonly appVersion: string,
    private readonly machineTag: string
  ) {}

  async export(parent: string): Promise<BackupResult> {
    return this.exclusive(async () => {
      await this.requireDocumentsFolder(parent)
      const target = join(
        parent,
        `Tool_box-快照-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`
      )
      await this.writeSnapshot(target)
      console.info('[Backup] 本机快照导出完成')
      return { path: target, restartRequired: false }
    })
  }

  async validate(folder: string): Promise<BackupManifest> {
    await this.requireOrdinaryDirectory(folder)
    const manifestPath = join(folder, 'manifest.json')
    const info = await lstat(manifestPath)
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_MANIFEST_BYTES)
      throw new Error('快照清单无效')
    let value: unknown
    try {
      value = JSON.parse(await readFile(manifestPath, 'utf8'))
    } catch {
      throw new Error('快照清单无法读取')
    }
    const manifest = parseManifest(value)
    if (manifest.machineTag !== this.machineTag)
      throw new Error('此快照仅可在创建它的电脑及系统用户下恢复')
    const inventory = await this.inventory(folder, true)
    if (inventory.length !== manifest.files.length) throw new Error('快照文件清单不完整')
    const actual = new Map(inventory.map((item) => [item.path, item]))
    for (const item of manifest.files) {
      const file = actual.get(item.path)
      if (!file || file.size !== item.size || file.sha256 !== item.sha256)
        throw new Error('快照文件已变化或损坏')
    }
    let version: number
    try {
      version = this.database.inspect(join(folder, 'toolbox.db'))
    } catch {
      throw new Error('快照数据库损坏或 schema 高于当前程序，无法恢复')
    }
    if (manifest.schemaVersion !== version) throw new Error('清单与数据库 schema 版本不一致')
    return manifest
  }

  /** 最终安装为同步调用：关闭库之后不再让异步业务写入穿插，完成回调必须结束进程。 */
  async restore(folder: string, finish: (result: BackupResult) => never): Promise<never> {
    return this.exclusive(async () => {
      await this.validate(folder)
      const id = randomUUID()
      const stage = join(this.userData, `.snapshot-restore-${id}`)
      await mkdir(stage)
      const incoming = join(stage, 'incoming')
      await mkdir(incoming)
      await this.copySnapshotFiles(folder, incoming)
      await copyFile(join(folder, 'manifest.json'), join(incoming, 'manifest.json'))
      await this.validate(incoming)
      const safety = join(this.userData, 'backups', `before-restore-${id}`)
      await mkdir(dirname(safety), { recursive: true })
      await this.writeSnapshot(safety)
      // 前置快照完成后再封口当前数据库；安装只移动受管目录，不删除用户文件。
      this.database.close()
      const result: BackupResult = {
        path: folder,
        safetySnapshotPath: safety,
        restartRequired: true
      }
      try {
        installSnapshotSync(this.userData, stage)
      } catch {
        // 安装函数已尝试回滚，数据库仍关闭，必须退出后重新打开，不能继续复用缓存主密钥。
        console.warn('[Backup] 快照恢复未完成，已保留前置快照与恢复日志')
        return finish({ path: '', safetySnapshotPath: safety, restartRequired: true })
      }
      console.info('[Backup] 本机快照恢复完成，等待手动重新启动')
      return finish(result)
    })
  }

  private async writeSnapshot(target: string): Promise<void> {
    // 非递归创建最终目录；任何已存在目标都拒绝，不静默覆盖。
    await mkdir(target)
    const schemaVersion = await this.database.backupTo(join(target, 'toolbox.db'))
    await this.copyAssets(this.userData, target)
    const files = await this.inventory(target, false)
    const manifest: BackupManifest = {
      version: 1,
      appVersion: this.appVersion,
      schemaVersion,
      createdAtMs: Date.now(),
      localOnly: true,
      machineTag: this.machineTag,
      files
    }
    await writeFile(join(target, 'manifest.json'), JSON.stringify(manifest, null, 2), {
      flag: 'wx',
      mode: 0o600
    })
    await this.validate(target)
  }

  private async copyAssets(source: string, destination: string): Promise<void> {
    for (const name of ROOTS.slice(1)) {
      const path = join(source, name)
      if (name === 'covers' || name === 'backgrounds') {
        await mkdir(join(destination, name))
        if (existsSync(path)) await this.copyTree(path, join(destination, name), { count: 0 }, 0)
      } else if (existsSync(path)) {
        const stat = await lstat(path)
        if (!stat.isFile() || stat.isSymbolicLink())
          throw new Error('数据文件不是普通文件，无法导出')
        await copyFile(path, join(destination, name))
      }
    }
  }

  private async copySnapshotFiles(source: string, destination: string): Promise<void> {
    await copyFile(join(source, 'toolbox.db'), join(destination, 'toolbox.db'))
    await this.copyAssets(source, destination)
  }

  private async copyTree(
    source: string,
    destination: string,
    budget: { count: number },
    depth: number
  ): Promise<void> {
    await this.requireOrdinaryDirectory(source)
    if (depth > 32) throw new Error('资源目录层数超过快照上限')
    for (const item of await readdir(source, { withFileTypes: true })) {
      if (++budget.count > MAX_FILES) throw new Error('资源文件数超过快照上限')
      const path = join(source, item.name)
      const target = join(destination, item.name)
      const stat = await lstat(path)
      if (stat.isSymbolicLink() || (await realpath(path)) !== resolve(path))
        throw new Error('资源目录含链接，无法生成安全快照')
      if (stat.isDirectory()) {
        await mkdir(target)
        await this.copyTree(path, target, budget, depth + 1)
      } else if (stat.isFile()) await copyFile(path, target)
      else throw new Error('资源目录包含不支持的文件类型')
    }
  }

  private async inventory(
    folder: string,
    requireManifest: boolean
  ): Promise<BackupManifest['files']> {
    const files: BackupManifest['files'] = []
    let visited = 0
    const walk = async (directory: string, depth: number): Promise<void> => {
      if (depth > 32) throw new Error('快照目录层数超过上限')
      await this.requireOrdinaryDirectory(directory)
      for (const name of await readdir(directory)) {
        if (++visited > MAX_FILES) throw new Error('快照文件数超过上限')
        const path = join(directory, name)
        const rel = relative(folder, path).split(sep).join('/')
        const stat = await lstat(path)
        if (stat.isSymbolicLink() || (await realpath(path)) !== resolve(path))
          throw new Error('快照不能包含链接')
        if (rel === 'manifest.json' && requireManifest && stat.isFile()) continue
        if (!isAllowedPath(rel, stat.isDirectory())) throw new Error('快照包含清单以外的文件')
        if (stat.isDirectory()) await walk(path, depth + 1)
        else if (stat.isFile())
          files.push({ path: rel, size: stat.size, sha256: await digest(path) })
        else throw new Error('快照文件类型不受支持')
      }
    }
    await walk(folder, 0)
    return files.sort((a, b) => a.path.localeCompare(b.path))
  }

  private async requireOrdinaryDirectory(folder: string): Promise<void> {
    const info = await lstat(folder)
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      (await realpath(folder)) !== resolve(folder)
    )
      throw new Error('请选择普通文件夹，不支持符号链接或联接目录')
  }

  private async requireDocumentsFolder(folder: string): Promise<void> {
    await this.requireOrdinaryDirectory(folder)
    const documents = await realpath(this.documents)
    if (resolve(folder) !== documents && !inside(documents, folder))
      throw new Error('请在当前用户的文档目录内选择备份位置')
    if (inside(this.userData, folder) || resolve(folder) === resolve(this.userData))
      throw new Error('备份位置不能位于应用数据目录内')
  }

  private async exclusive<T>(action: () => Promise<T>): Promise<T> {
    if (this.busy) throw new Error('另一项备份操作正在进行，请稍后再试')
    this.busy = true
    try {
      return await action()
    } finally {
      this.busy = false
    }
  }
}

function isAllowedPath(path: string, directory: boolean): boolean {
  if (
    !path ||
    path.includes('\\') ||
    path.startsWith('/') ||
    path.split('/').some((part) => !part || part === '.' || part === '..' || part.includes(':'))
  )
    return false
  if (directory)
    return (
      path === 'covers' ||
      path === 'backgrounds' ||
      path.startsWith('covers/') ||
      path.startsWith('backgrounds/')
    )
  return (
    path === 'toolbox.db' ||
    path === 'ai-settings.json' ||
    path === 'password-master-key.json' ||
    path.startsWith('covers/') ||
    path.startsWith('backgrounds/')
  )
}

/** 仅接收普通 JSON，不信任清单的路径、大小、版本或重复项。 */
export function parseManifest(value: unknown): BackupManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('快照清单无效')
  const data = value as Record<string, unknown>
  if (data.version !== 1) throw new Error('快照格式版本高于或不受当前程序支持')
  if (
    data.localOnly !== true ||
    typeof data.machineTag !== 'string' ||
    !/^[a-f0-9]{64}$/.test(data.machineTag) ||
    typeof data.schemaVersion !== 'number' ||
    !Number.isSafeInteger(data.schemaVersion) ||
    data.schemaVersion < 1 ||
    typeof data.createdAtMs !== 'number' ||
    !Number.isFinite(data.createdAtMs) ||
    typeof data.appVersion !== 'string' ||
    data.appVersion.length > 100 ||
    !Array.isArray(data.files) ||
    data.files.length > MAX_FILES
  )
    throw new Error('快照清单无效')
  const paths = new Set<string>()
  const files = data.files.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      throw new Error('快照文件清单无效')
    const file = entry as Record<string, unknown>
    if (
      typeof file.path !== 'string' ||
      file.path.length > 4096 ||
      !isAllowedPath(file.path, false) ||
      typeof file.size !== 'number' ||
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      typeof file.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(file.sha256) ||
      paths.has(file.path.toLowerCase())
    )
      throw new Error('快照文件清单无效')
    paths.add(file.path.toLowerCase())
    return { path: file.path, size: file.size, sha256: file.sha256 }
  })
  if (!paths.has('toolbox.db')) throw new Error('快照缺少数据库')
  return {
    version: 1,
    localOnly: true,
    machineTag: data.machineTag,
    schemaVersion: data.schemaVersion,
    createdAtMs: data.createdAtMs,
    appVersion: data.appVersion,
    files
  }
}

/** 所有移动目标都是 userData 的固定直接子项，恢复日志用于进程意外终止后的回退。 */
function installSnapshotSync(userData: string, stage: string): void {
  assertStage(userData, stage)
  const old = join(stage, 'previous')
  mkdirSync(old)
  const journal = {
    stage: basename(stage),
    phase: 'installing',
    had: ROOTS.filter((name) => existsSync(join(userData, name)))
  }
  writeFileSync(join(userData, JOURNAL), JSON.stringify(journal), { flag: 'wx', mode: 0o600 })
  try {
    for (const name of ROOTS) {
      const target = join(userData, name)
      if (existsSync(target)) renameSync(target, join(old, name))
      const incoming = join(stage, 'incoming', name)
      if (existsSync(incoming)) renameSync(incoming, target)
    }
    // 已关闭连接，若仍有 WAL/SHM 则绝不能让它们在新库重开时被应用。
    for (const suffix of ['-wal', '-shm']) {
      const sidecar = join(userData, `toolbox.db${suffix}`)
      if (existsSync(sidecar)) renameSync(sidecar, join(old, `toolbox.db${suffix}`))
    }
    writeFileSync(join(userData, JOURNAL), JSON.stringify({ ...journal, phase: 'committed' }), {
      mode: 0o600
    })
    renameSync(join(userData, JOURNAL), join(stage, 'completed-journal.json'))
  } catch (error) {
    recoverInterruptedRestore(userData)
    throw error
  }
}

function assertStage(userData: string, stage: string): void {
  if (
    dirname(resolve(stage)) !== resolve(userData) ||
    !/^\.snapshot-restore-[a-f0-9-]{36}$/.test(basename(stage)) ||
    !lstatSync(stage).isDirectory() ||
    lstatSync(stage).isSymbolicLink() ||
    realpathSync(stage) !== resolve(stage)
  )
    throw new Error('恢复暂存目录无效')
}

/** 启动数据库与主密钥缓存前执行；未知日志拒绝启动，不猜测覆盖用户数据。 */
export function recoverInterruptedRestore(userData: string): void {
  const file = join(userData, JOURNAL)
  if (!existsSync(file)) return
  if (lstatSync(file).isSymbolicLink() || lstatSync(file).size > 4096)
    throw new Error('恢复日志无效')
  const journal = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
  if (
    typeof journal.stage !== 'string' ||
    !Array.isArray(journal.had) ||
    !journal.had.every((name) => ROOTS.includes(name as (typeof ROOTS)[number]))
  )
    throw new Error('恢复日志无效')
  const stage = join(userData, journal.stage)
  assertStage(userData, stage)
  if (journal.phase !== 'committed') {
    if (journal.phase !== 'installing') throw new Error('恢复日志状态无效')
    const old = join(stage, 'previous')
    if (
      !lstatSync(old).isDirectory() ||
      lstatSync(old).isSymbolicLink() ||
      realpathSync(old) !== resolve(old)
    )
      throw new Error('恢复暂存数据目录无效')
    const rejected = join(stage, `rejected-${randomUUID()}`)
    mkdirSync(rejected)
    for (const name of ROOTS) {
      const previous = join(old, name)
      const current = join(userData, name)
      if (existsSync(previous)) {
        if (existsSync(current)) renameSync(current, join(rejected, name))
        renameSync(previous, current)
      } else if (!journal.had.includes(name) && existsSync(current))
        renameSync(current, join(rejected, name))
    }
    for (const suffix of ['-wal', '-shm']) {
      const previous = join(old, `toolbox.db${suffix}`)
      if (existsSync(previous)) renameSync(previous, join(userData, `toolbox.db${suffix}`))
    }
  }
  renameSync(file, join(stage, `recovered-journal-${randomUUID()}.json`))
}
