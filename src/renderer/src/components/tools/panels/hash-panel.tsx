/**
 * 哈希：SHA-256 / SHA-384 / SHA-512。
 *
 * 用 Web Crypto（`crypto.subtle`）在本机算，不联网、不落盘。
 * `crypto.subtle` 只在安全上下文可用，Electron 的 file:// 与开发用的
 * localhost 都算安全上下文；万一不可用就明确报错，不做降级伪造。
 *
 * 刻意**不做 MD5**：Web Crypto 不支持，要支持得自己实现或走主进程，
 * 而 MD5 已不适合当安全用途。
 */
import { useState } from 'react'
import type { JSX } from 'react'

import { CopyButton } from '../workbench'
import { AutoTextarea } from '../auto-textarea'

type HashAlgorithm = 'SHA-256' | 'SHA-384' | 'SHA-512'

const ALGORITHMS: HashAlgorithm[] = ['SHA-256', 'SHA-384', 'SHA-512']

async function digest(algorithm: HashAlgorithm, text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) {
    throw new Error('当前环境不支持 Web Crypto，无法计算哈希')
  }
  const bytes = new TextEncoder().encode(text)
  const hash = await subtle.digest(algorithm, bytes)
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function HashPanel(): JSX.Element {
  const [input, setInput] = useState('')
  const [results, setResults] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const run = async (): Promise<void> => {
    if (!input) {
      setError('请输入要计算哈希的文本')
      return
    }
    setBusy(true)
    setError('')
    try {
      const entries = await Promise.all(
        ALGORITHMS.map(async (algorithm) => [algorithm, await digest(algorithm, input)] as const)
      )
      setResults(Object.fromEntries(entries))
    } catch (hashError) {
      setError(hashError instanceof Error ? hashError.message : '哈希计算失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="tool-stack">
      <section className="tool-io">
        <header className="tool-io-head">
          <span className="tool-io-label">原文</span>
          <button type="button" className="btn-ghost btn-mini" disabled={busy} onClick={() => void run()}>
            {busy ? '计算中…' : '计算哈希'}
          </button>
        </header>
        <AutoTextarea
          className="field-input field-textarea tool-input"
          value={input}
          placeholder="要计算哈希的文本"
          onChange={setInput}
        />
      </section>

      {error ? (
        <div className="tool-error" role="alert">
          {error}
        </div>
      ) : null}

      {ALGORITHMS.map((algorithm) =>
        results[algorithm] ? (
          <section key={algorithm} className="tool-io">
            <header className="tool-io-head">
              <span className="tool-io-label">{algorithm}</span>
              <CopyButton text={results[algorithm]} />
            </header>
            <output className="tool-hash-line">{results[algorithm]}</output>
          </section>
        ) : null
      )}
    </div>
  )
}
