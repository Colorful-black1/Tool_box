import { execFile } from 'node:child_process'
import { mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { codexObject } from './codex-connection'

const verified = new Set<string>()

/** 只读导出所选 CLI 的协议；能力取决于实际 schema，不从版本号猜测。 */
export async function inspectCodexRevert(executable: string): Promise<boolean> {
  let folder = ''
  let root = ''
  try {
    const file = await stat(executable)
    const key = `${executable}:${file.size}:${file.mtimeMs}`
    if (verified.has(key)) return true
    root = await realpath(tmpdir())
    folder = await mkdtemp(join(root, 'toolbox-codex-protocol-'))
    await new Promise<void>((resolve, reject) => {
      execFile(
        executable,
        ['app-server', 'generate-json-schema', '--out', folder],
        { windowsHide: true, timeout: 10_000, maxBuffer: 16_384 },
        (error) => (error ? reject(error) : resolve())
      )
    })
    const path = join(folder, 'ClientRequest.json')
    if ((await stat(path)).size > 2_000_000) return false
    const schema = codexObject(JSON.parse(await readFile(path, 'utf8')))
    const definitions = codexObject(schema?.definitions)
    const params = codexObject(definitions?.ThreadRevertParams)
    const fields = codexObject(params?.properties)
    const required = params?.required
    const requests = Array.isArray(schema?.oneOf) ? schema.oneOf : []
    const hasMethod = (name: string): boolean =>
      requests.some((entry) => {
        const method = codexObject(codexObject(codexObject(entry)?.properties)?.method)
        return Array.isArray(method?.enum) && method.enum.includes(name)
      })
    const supported = Boolean(
      fields &&
      Object.keys(fields).length === 2 &&
      fields.threadId &&
      fields.beforeTurnId &&
      Array.isArray(required) &&
      required.length === 2 &&
      required.includes('threadId') &&
      required.includes('beforeTurnId') &&
      typeof params?.description === 'string' &&
      params.description.includes('does not revert local file changes') &&
      hasMethod('thread/revert') &&
      hasMethod('thread/turns/list')
    )
    if (supported) {
      if (verified.size >= 8) verified.clear()
      verified.add(key)
    }
    return supported
  } catch {
    // 旧 CLI、超时或不认识的 schema 均降级为不可用，不回显第三方诊断或猜测能力。
    return false
  } finally {
    // 递归清理只针对本函数在规范临时根目录下新建的随机子目录。
    if (
      folder &&
      dirname(folder) === root &&
      basename(folder).startsWith('toolbox-codex-protocol-')
    )
      await rm(folder, { recursive: true, force: true }).catch(() => {
        // 临时 schema 清理失败不影响连接；不触碰用户目录或原生会话。
      })
  }
}
