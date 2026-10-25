import { describe, expect, it, vi } from 'vitest'
import { AgentDraftService } from './agent-draft-service'
import { validateAgentDraftSave } from '../../ipc/validation'
import { emptyDraftDocument } from '../../../shared/agent-drafts'

describe('加密草稿服务', () => {
  function fixture() {
    let cipher: string | null = null
    const repository = {
      agentDraftCipherGet: () => cipher,
      agentDraftCipherSet: vi.fn((text: string) => {
        cipher = text
      })
    }
    const box = {
      encryptText: (text: string) => Buffer.from(text).toString('base64'),
      decryptText: (text: string) => Buffer.from(text, 'base64').toString()
    }
    return { repository, box, service: new AgentDraftService(repository, box) }
  }
  it('独立记录、修订号冲突和重启读取', () => {
    const { repository, box, service } = fixture()
    const document = {
      ...emptyDraftDocument(),
      drafts: [
        {
          runtimeId: 'opencode' as const,
          directory: 'C:/Work/one',
          nativeSessionId: 's:1',
          content: '  完整空白\n'
        }
      ]
    }
    const saved = service.save(validateAgentDraftSave({ revision: 0, document }))
    expect(saved.revision).toBe(1)
    expect(repository.agentDraftCipherSet.mock.calls[0][0]).not.toContain('完整空白')
    expect(new AgentDraftService(repository, box).read()).toEqual(saved)
    expect(() => service.save({ revision: 0, document })).toThrow('其他窗口')
  })
  it('无法解密时保留原记录，拒绝空覆盖', () => {
    const { repository, box, service } = fixture()
    repository.agentDraftCipherSet('broken')
    box.decryptText = () => {
      throw new Error('private internal error')
    }
    expect(() => service.read()).toThrow('原记录已保留')
    expect(() => service.save({ revision: 0, document: emptyDraftDocument() })).toThrow(
      '原记录已保留'
    )
    expect(repository.agentDraftCipherGet()).toBe('broken')
  })
  it('校验项目、重复、正文、总 UTF-8 体积和运行时', () => {
    const entry = {
      runtimeId: 'codex',
      directory: 'C:/Work',
      nativeSessionId: null,
      content: ' 文本\n '
    }
    const parse = (drafts: unknown[]) =>
      validateAgentDraftSave({ revision: 0, document: { version: 1, selection: null, drafts } })
    expect(parse([entry]).document.drafts[0].content).toBe(' 文本\n ')
    expect(() => parse([entry, { ...entry, directory: 'c:\\work\\' }])).toThrow('重复')
    expect(() => parse([{ ...entry, directory: 'relative' }])).toThrow()
    expect(() => parse([{ ...entry, content: 'x'.repeat(50_001) }])).toThrow()
    expect(() => parse([{ ...entry, runtimeId: '__proto__' }])).toThrow()
    expect(() =>
      parse(
        Array.from({ length: 30 }, (_, index) => ({
          ...entry,
          nativeSessionId: String(index),
          content: '字'.repeat(50_000)
        }))
      )
    ).toThrow('2 MiB')
  })
})
