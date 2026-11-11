import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, readdir, writeFile, symlink } from 'node:fs/promises'
import Database from 'better-sqlite3'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ToolboxStore } from '../chat-store/chat-store'
import { BackupService, parseManifest, recoverInterruptedRestore } from './backup-service'
import type { SecretBox } from '../crypto/secret-box'
import type { BackupResult } from '../../../shared/backup'

// 合成数据用测试盒，不读取真实主密钥或用户库。
const box: SecretBox = {
  encrypt: (value) => JSON.stringify(value),
  decrypt: (value) => JSON.parse(value)
}
const tag = 'a'.repeat(64)

async function setup(): Promise<{
  root: string
  data: string
  documents: string
  store: ToolboxStore
  service: BackupService
}> {
  const root = await mkdtemp(join(tmpdir(), 'toolbox-backup-'))
  const data = join(root, 'data'),
    documents = join(root, 'documents')
  await mkdir(data)
  await mkdir(documents)
  const store = new ToolboxStore(join(data, 'toolbox.db'), box)
  store.saveNote({ title: '原笔记', content: '合成正文' })
  await mkdir(join(data, 'covers'))
  await writeFile(join(data, 'covers', 'cover.txt'), 'synthetic-cover')
  await writeFile(join(data, 'ai-settings.json'), '{"version":2,"profiles":[]}')
  await writeFile(join(data, 'password-master-key.json'), 'synthetic-key-file')
  const service = new BackupService(
    data,
    documents,
    {
      backupTo: (path) => store.backupTo(path),
      inspect: ToolboxStore.inspectSnapshot,
      close: () => store.close()
    },
    '0.3.0',
    tag
  )
  return { root, data, documents, store, service }
}

describe('本机快照', () => {
  it('实际数据库高版本、缺表或损坏都不能通过只读检查', async () => {
    const { root, store } = await setup()
    try {
      const path = join(root, 'invalid.db')
      const database = new Database(path)
      database.exec('CREATE TABLE conversations (id TEXT); PRAGMA user_version = 5')
      database.close()
      expect(() => ToolboxStore.inspectSnapshot(path)).toThrow()
      const future = new Database(path)
      future.pragma('user_version = 999')
      future.close()
      expect(() => ToolboxStore.inspectSnapshot(path)).toThrow('版本')
      await writeFile(path, 'not-sqlite')
      expect(() => ToolboxStore.inspectSnapshot(path)).toThrow()
    } finally {
      store.close()
    }
  })
  it('恢复日志的外部联接目录被拒绝，不移动当前数据', async () => {
    const { data, root, store } = await setup()
    store.close()
    const stage = join(data, `.snapshot-restore-${randomUUID()}`)
    await mkdir(stage)
    const external = join(root, 'external')
    await mkdir(external)
    await symlink(external, join(stage, 'previous'), 'junction')
    const before = readFileSync(join(data, 'toolbox.db'))
    writeFileSync(
      join(data, 'snapshot-restore-journal.json'),
      JSON.stringify({
        stage: stage.split(/[\\/]/).at(-1),
        phase: 'installing',
        had: []
      })
    )
    expect(() => recoverInterruptedRestore(data)).toThrow('目录无效')
    expect(readFileSync(join(data, 'toolbox.db'))).toEqual(before)
  })
  it('WAL 一致性快照含受管资源与清单，独立数据库可读，不覆盖已有快照', async () => {
    const { documents, store, service } = await setup()
    try {
      const first = await service.export(documents)
      const manifest = await service.validate(first.path)
      expect(manifest).toMatchObject({ version: 1, schemaVersion: 7, localOnly: true })
      expect(manifest.files.map((file) => file.path)).toEqual(
        expect.arrayContaining(['toolbox.db', 'password-master-key.json', 'covers/cover.txt'])
      )
      expect(ToolboxStore.inspectSnapshot(join(first.path, 'toolbox.db'))).toBe(7)
      const separate = new ToolboxStore(join(first.path, 'toolbox.db'), box)
      expect(separate.listNotes()).toHaveLength(1)
      separate.close()
      const second = await service.export(documents)
      expect(second.path).not.toBe(first.path)
      expect(await readdir(documents)).toHaveLength(2)
    } finally {
      store.close()
    }
  })
  it('拒绝高版本、路径穿越、重复清单、异机、篡改与文档目录之外的导出', async () => {
    const { root, documents, store, service } = await setup()
    try {
      await expect(service.export(root)).rejects.toThrow('文档目录')
      const result = await service.export(documents)
      const file = join(result.path, 'manifest.json')
      const original = JSON.parse(await readFile(file, 'utf8'))
      expect(() => parseManifest({ ...original, version: 2 })).toThrow('版本')
      expect(() =>
        parseManifest({ ...original, files: [...original.files, original.files[0]] })
      ).toThrow('清单')
      expect(() =>
        parseManifest({ ...original, files: [{ path: '../toolbox.db', size: 1, sha256: tag }] })
      ).toThrow('清单')
      await writeFile(file, JSON.stringify({ ...original, schemaVersion: 999 }))
      await expect(service.validate(result.path)).rejects.toThrow('schema')
      await writeFile(file, JSON.stringify({ ...original, machineTag: 'b'.repeat(64) }))
      await expect(service.validate(result.path)).rejects.toThrow('电脑')
      await writeFile(file, JSON.stringify(original))
      await writeFile(join(result.path, 'covers', 'cover.txt'), 'tampered')
      await expect(service.validate(result.path)).rejects.toThrow('损坏')
      expect(store.listNotes()).toHaveLength(1)
    } finally {
      store.close()
    }
  })
  it('恢复先产生当前快照，再关闭连接安装，重新打开恢复原有数据', async () => {
    const { data, documents, store, service } = await setup()
    const snapshot = await service.export(documents)
    store.saveNote({ title: '后来新增', content: '恢复前要保住' })
    await writeFile(join(data, 'covers', 'new.txt'), 'new-cover')
    let outcome: BackupResult | undefined
    const exit = new Error('synthetic-exit')
    await expect(
      service.restore(snapshot.path, (result): never => {
        outcome = result
        throw exit
      })
    ).rejects.toThrow('synthetic-exit')
    expect(outcome?.restartRequired).toBe(true)
    expect(existsSync(join(outcome!.safetySnapshotPath!, 'manifest.json'))).toBe(true)
    const restored = new ToolboxStore(join(data, 'toolbox.db'), box)
    const safety = new ToolboxStore(join(outcome!.safetySnapshotPath!, 'toolbox.db'), box)
    try {
      expect(restored.listNotes().map((note) => note.title)).toEqual(['原笔记'])
      expect(safety.listNotes()).toHaveLength(2)
      expect(existsSync(join(data, 'covers', 'new.txt'))).toBe(false)
      expect(await readFile(join(data, 'password-master-key.json'), 'utf8')).toBe(
        'synthetic-key-file'
      )
    } finally {
      restored.close()
      safety.close()
    }
  })
  it('安装中断的启动回退幂等，文件整体归还且不物理删除残留', async () => {
    const { data, store } = await setup()
    store.close()
    const stage = join(data, `.snapshot-restore-${randomUUID()}`)
    mkdirSync(stage)
    mkdirSync(join(stage, 'previous'))
    const original = readFileSync(join(data, 'toolbox.db'))
    renameSync(join(data, 'toolbox.db'), join(stage, 'previous', 'toolbox.db'))
    writeFileSync(join(data, 'toolbox.db'), 'incomplete-new-database')
    writeFileSync(
      join(data, 'snapshot-restore-journal.json'),
      JSON.stringify({
        stage: stage.split(/[\\/]/).at(-1),
        phase: 'installing',
        had: ['toolbox.db', 'covers', 'password-master-key.json', 'ai-settings.json']
      })
    )
    recoverInterruptedRestore(data)
    recoverInterruptedRestore(data)
    expect(readFileSync(join(data, 'toolbox.db'))).toEqual(original)
    expect(existsSync(stage)).toBe(true)
  })
  it('校验失败或备份失败不关闭当前库、不触发安装', async () => {
    const { data, documents, store, service } = await setup()
    try {
      const snapshot = await service.export(documents)
      const close = vi.fn()
      const broken = new BackupService(
        data,
        documents,
        {
          backupTo: async () => {
            throw new Error('disk-full')
          },
          inspect: ToolboxStore.inspectSnapshot,
          close
        },
        '0.3.0',
        tag
      )
      await expect(
        broken.restore(snapshot.path, (): never => {
          throw new Error('should-not-exit')
        })
      ).rejects.toThrow('disk-full')
      expect(close).not.toHaveBeenCalled()
      expect(store.listNotes()).toHaveLength(1)
    } finally {
      store.close()
    }
  })
})
