import { spawn } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CodexConnection } from './codex-connection'

const connections: CodexConnection[] = []
afterEach(() => connections.splice(0).forEach((connection) => connection.close()))

function connect(
  script: string,
  notification = vi.fn(),
  handler = vi.fn().mockResolvedValue({ decision: 'decline' })
) {
  const child = spawn(process.execPath, ['-e', script], { stdio: 'pipe', windowsHide: true })
  const disconnected = vi.fn()
  const connection = new CodexConnection(child, notification, handler, disconnected)
  connections.push(connection)
  return { connection, disconnected }
}

describe('Codex stdio 协议边界', () => {
  it('不要求 ACP 字段，拆包粘包按请求编号关联', async () => {
    const { connection } = connect(`let text=''; process.stdin.on('data',chunk=>{
      text+=chunk; let i; while((i=text.indexOf('\\n'))>=0){const m=JSON.parse(text.slice(0,i));text=text.slice(i+1);
      const out=JSON.stringify({id:m.id,result:'流式中文'})+'\\n';process.stdout.write(out.slice(0,8));process.stdout.write(out.slice(8));}})`)
    expect(
      await Promise.all([connection.request('first', {}), connection.request('second', {})])
    ).toEqual(['流式中文', '流式中文'])
  })
  it('超时或非法超大消息关闭连接并清理未决请求', async () => {
    const a = connect('process.stdin.resume()')
    await expect(a.connection.request('slow', {}, 30)).rejects.toThrow('结果未知')
    expect(a.disconnected).toHaveBeenCalledOnce()
    const b = connect(`process.stdin.once('data',()=>process.stdout.write('x'.repeat(2000001)))`)
    await expect(b.connection.request('large', {})).rejects.toThrow('连接已结束')
  })
  it('审批与通知独立，原生错误和 stderr 不向上层泄露', async () => {
    const notification = vi.fn(),
      handler = vi.fn().mockResolvedValue({ decision: 'decline' })
    const { connection } = connect(
      `process.stdin.once('data',()=>{
      process.stderr.write('fixture-private-secret');
      process.stdout.write(JSON.stringify({id:'approve',method:'item/commandExecution/requestApproval',params:{threadId:'t1'}})+'\\n');
      process.stdout.write(JSON.stringify({method:'item/agentMessage/delta',params:{delta:'中文'}})+'\\n');
      process.stdin.once('data',()=>process.stdout.write(JSON.stringify({id:1,error:{message:'fixture-private-secret'}})+'\\n'));})`,
      notification,
      handler
    )
    await expect(connection.request('start', {})).rejects.toThrow('检查原生登录')
    expect(handler).toHaveBeenCalledWith(
      'item/commandExecution/requestApproval',
      {
        threadId: 't1'
      },
      'approve'
    )
    expect(notification).toHaveBeenCalledWith('item/agentMessage/delta', { delta: '中文' })
  })
})
