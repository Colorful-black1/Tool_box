import { spawn } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AcpConnection } from './acp-connection'

const connections: AcpConnection[] = []
afterEach(() => connections.splice(0).forEach((connection) => connection.close()))

function connect(script: string, notification = vi.fn(), request = vi.fn().mockResolvedValue({})) {
  const child = spawn(process.execPath, ['-e', script], { stdio: 'pipe', windowsHide: true })
  const disconnected = vi.fn()
  const connection = new AcpConnection(child, notification, request, disconnected)
  connections.push(connection)
  return { connection, disconnected, child }
}

describe('OpenCode ACP 连接', () => {
  it('超大未结束帧会关闭连接，避免无限累积输出', async () => {
    const { connection } = connect(
      `process.stdin.once('data', () => process.stdout.write('x'.repeat(2000001)))`
    )
    await expect(connection.request('test', {})).rejects.toThrow('连接已结束')
  })
  it('拆包和粘包均按请求编号关联，支持 UTF-8 文本', async () => {
    const { connection } = connect(`
      let input = ''
      process.stdin.on('data', data => {
        input += data
        let i
        while ((i = input.indexOf('\\n')) >= 0) {
          const m = JSON.parse(input.slice(0, i)); input = input.slice(i + 1)
          const output = JSON.stringify({ jsonrpc: '2.0', id: m.id, result: '合成回复' }) + '\\n'
          process.stdout.write(output.slice(0, 8)); process.stdout.write(output.slice(8))
        }
      })
    `)
    await expect(
      Promise.all([connection.request('first', {}), connection.request('second', {})])
    ).resolves.toEqual(['合成回复', '合成回复'])
  })
  it('请求超时不自动重发，晚到响应不会污染后续请求', async () => {
    const { connection, disconnected } = connect('process.stdin.resume()')
    await expect(connection.request('slow', {}, 30)).rejects.toThrow('结果未知')
    expect(disconnected).toHaveBeenCalledOnce()
    await expect(connection.request('again', {})).rejects.toThrow('已断开')
  })
  it('进程退出清理未决请求，不透传 stderr', async () => {
    const { connection, disconnected } = connect(
      `process.stdin.once('data', () => { process.stderr.write('fixture-private-detail'); process.exit(1) })`
    )
    await expect(connection.request('test', {})).rejects.toThrow('未自动重发')
    expect(disconnected).toHaveBeenCalledOnce()
  })
  it('非法协议关闭连接', async () => {
    const { connection } = connect(
      `process.stdin.once('data', () => process.stdout.write('invalid\\n'))`
    )
    await expect(connection.request('test', {})).rejects.toThrow('连接已结束')
  })
  it('第三方错误不包含原始错误正文', async () => {
    const { connection } = connect(`process.stdin.once('data', data => {
      const m = JSON.parse(data)
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, error: { code: -1, message: 'fixture-private-detail' } }) + '\\n')
    })`)
    await expect(connection.request('test', {})).rejects.toThrow('检查登录')
  })
  it('权限请求交给显式审批回调，通知保持独立', async () => {
    const request = vi.fn().mockResolvedValue({ outcome: { outcome: 'cancelled' } })
    const notification = vi.fn()
    const { connection } = connect(
      `process.stdin.once('data', () => {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: 'approval', method: 'session/request_permission', params: { sessionId: 's1' } }) + '\\n')
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 's1' } }) + '\\n')
      process.stdin.once('data', () => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: 1, result: true }) + '\\n'))
    })`,
      notification,
      request
    )
    await expect(connection.request('start', {})).resolves.toBe(true)
    expect(request).toHaveBeenCalledWith('session/request_permission', { sessionId: 's1' })
    expect(notification).toHaveBeenCalledWith('session/update', { sessionId: 's1' })
  })
})
