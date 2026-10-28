import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { attachDshWorkspace, dshSessionMessages, parseDshSessionRecord } from './dsh-runtime'

describe('DSH Desktop 会话缓存', () => {
  it('只提取标题和空白标记，结构不匹配时返回 null', () => {
    expect(
      parseDshSessionRecord({
        version: 7,
        record: {
          identity: { cwd: '/fixture' },
          rows: {
            title: { val: '桌面会话' },
            sessionListMetadata: { val: { blank: false, lastPromptAt: 123 } }
          }
        }
      })
    ).toEqual({ title: '桌面会话', blank: false, lastPromptAt: 123 })
    expect(
      parseDshSessionRecord({
        version: 7,
        record: {
          rows: {
            title: { val: null },
            sessionListMetadata: { val: { blank: true, lastPromptAt: null } }
          }
        }
      })
    ).toEqual({ title: '', blank: true, lastPromptAt: null })
    expect(parseDshSessionRecord(null)).toBeNull()
    expect(parseDshSessionRecord({ record: { rows: [] } })).toBeNull()
  })

  it('按 zstd 帧恢复历史正文，跳过注入消息和推理文本', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'toolbox-dsh-session-'))
    const previous = process.env.DSH_HOME
    const id = 'session-test'
    const sessionDirectory = join(directory, 'sessions', '--fixture-project--', id)
    const events = [
      { type: 'session', version: 4, id },
      {
        type: 'user/message',
        seq: 2,
        data: {
          id: 'injected',
          role: 'user',
          source: { kind: 'agent-instructions' },
          content: [{ type: 'text', text: '不应显示' }]
        }
      },
      {
        type: 'user/message',
        seq: 3,
        data: {
          id: 'u1',
          role: 'user',
          source: { kind: 'user' },
          content: [{ type: 'text', text: '历史问题' }]
        }
      },
      {
        type: 'assistant/message',
        seq: 4,
        data: {
          message: {
            id: 'a1',
            role: 'assistant',
            content: [
              { type: 'reasoning', text: '推理内容' },
              { type: 'text', text: '历史回答' }
            ]
          }
        }
      },
      {
        type: 'assistant/message',
        seq: 5,
        data: { message: { id: 'a2', role: 'assistant', content: [{ type: 'reasoning', text: '只有推理' }] } }
      }
    ]
    try {
      await mkdir(sessionDirectory, { recursive: true })
      await writeFile(
        join(sessionDirectory, 'session.v4.jsonl.zstd'),
        Buffer.concat(
          events.map((event) => zstdCompressSync(Buffer.from(JSON.stringify(event) + '\n')))
        )
      )
      process.env.DSH_HOME = directory
      await expect(dshSessionMessages(id)).resolves.toEqual([
        { id: 'u1', role: 'user', content: '历史问题' },
        { id: 'a1', role: 'assistant', content: '历史回答' }
      ])
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('工作区归组写入 workspace.json，取消归档并保留备份', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'toolbox-dsh-workspace-'))
    const previous = process.env.DSH_HOME
    const sessionId = 'session-workspace'
    const file = join(directory, 'storages', 'workspace.json')
    try {
      await mkdir(join(directory, 'storages'), { recursive: true })
      await writeFile(
        file,
        JSON.stringify(
          {
            unit: { name: 'workspace', version: 2 },
            global: {
              initialized: true,
              workspaceIds: ['ws'],
              archivedSessionIds: [sessionId],
              pinnedSessionIds: []
            },
            tables: {
              workspaces: {
                ws: {
                  path: directory,
                  title: 'Fixture',
                  sessionIds: ['session-old'],
                  createdAt: '2026-01-01T00:00:00.000Z',
                  updatedAt: '2026-01-01T00:00:00.000Z'
                }
              }
            }
          },
          null,
          2
        )
      )
      process.env.DSH_HOME = directory
      await expect(attachDshWorkspace(sessionId, directory)).resolves.toMatchObject({
        workspace: 'Fixture'
      })
      const saved = JSON.parse(await readFile(file, 'utf8')) as {
        global: { archivedSessionIds: string[] }
        tables: { workspaces: Record<string, { sessionIds: string[] }> }
      }
      expect(saved.global.archivedSessionIds).toEqual([])
      expect(saved.tables.workspaces.ws.sessionIds).toEqual([sessionId, 'session-old'])
      expect(await readFile(`${file}.toolbox-backup`, 'utf8')).toContain('session-old')
      await expect(attachDshWorkspace(sessionId, directory)).resolves.toMatchObject({
        message: expect.stringContaining('该会话已在')
      })
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
      await rm(directory, { recursive: true, force: true })
    }
  })
})
