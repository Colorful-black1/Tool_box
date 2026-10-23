import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { inspectJwt } from '@shared/jwt-tools'
import type { JwtPreview } from '@shared/jwt-tools'
import { Dropdown } from '../../dropdown'
import { Workbench } from '../workbench'

function JwtViewer(): JSX.Element {
  const [input, setInput] = useState('')
  const [result, setResult] = useState<JwtPreview | null>(null)
  const [error, setError] = useState('')
  return (
    <Workbench
      inputLabel="JWT 令牌"
      outputLabel="JWT 解码结果"
      value={input}
      onChange={(value) => {
        setInput(value)
        setResult(null)
        setError('')
      }}
      placeholder="粘贴三段 JWT 或 Bearer 令牌，仅在本机解码"
      output={
        result
          ? `头部\n${JSON.stringify(result.header, null, 2)}\n\n载荷\n${JSON.stringify(result.payload, null, 2)}\n\n时间声明（UTC）\n${result.claims.map((c) => `${c.name}  ${c.value}`).join('\n') || '未提供 iat / nbf / exp'}`
          : ''
      }
      error={error}
      actions={
        <>
          <button
            type="button"
            className="btn-ghost btn-mini"
            onClick={() => {
              setInput('')
              setResult(null)
              setError('')
            }}
          >
            清空令牌
          </button>
          <button
            type="button"
            className="btn-gold btn-mini"
            onClick={() => {
              setResult(null)
              setError('')
              try {
                setResult(inspectJwt(input))
              } catch (error) {
                setError(error instanceof Error ? error.message : 'JWT 解析失败')
              }
            }}
          >
            解码 JWT
          </button>
        </>
      }
      outputExtra={
        result ? (
          <div className="status-banner" role="status">
            {result.warnings.map((warning) => (
              <div key={warning}>{warning}</div>
            ))}
          </div>
        ) : null
      }
    />
  )
}

function CertificateViewer(): JSX.Element {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const request = useRef({ sequence: 0 })
  useEffect(() => {
    const state = request.current
    return () => {
      state.sequence++
    }
  }, [])
  const change = (value: string): void => {
    request.current.sequence++
    setInput(value)
    setOutput('')
    setError('')
    setBusy(false)
  }
  const run = async (): Promise<void> => {
    const sequence = ++request.current.sequence
    setOutput('')
    setError('')
    if (!window.toolbox?.tools?.inspectCertificate) {
      setError('证书接口未就绪，请使用最新桌面应用')
      return
    }
    setBusy(true)
    try {
      const certificates = await window.toolbox.tools.inspectCertificate(input)
      if (sequence !== request.current.sequence) return
      const now = Date.now()
      setOutput(
        certificates
          .map((cert, index) =>
            [
              `证书 ${index + 1}`,
              `有效期状态：${now < Date.parse(cert.validFrom) ? '尚未生效' : now >= Date.parse(cert.validTo) ? '已过期' : '有效期内（未验证信任链）'}`,
              `主体：${cert.subject}`,
              `签发者：${cert.issuer}`,
              `备用名称：${cert.subjectAltName || '无'}`,
              `序列号：${cert.serialNumber}`,
              `生效（UTC）：${cert.validFrom}`,
              `到期（UTC）：${cert.validTo}`,
              `公钥：${cert.publicKey}`,
              `CA：${cert.ca ? '是' : '否'}`,
              `SHA-256 指纹：${cert.fingerprint256}`
            ].join('\n')
          )
          .join('\n\n')
      )
    } catch (error) {
      if (sequence === request.current.sequence) {
        const message = error instanceof Error ? error.message : ''
        setError(
          message.includes('私钥')
            ? '检测到私钥，请只提供公开证书'
            : message.includes('128')
              ? '证书内容不能超过 128 KiB'
              : message.includes('10 张')
                ? '一次最多查看 10 张证书'
                : '无法解析证书，请仅提供有效的 X.509 PEM 或 DER 证书'
        )
      }
    } finally {
      if (sequence === request.current.sequence) setBusy(false)
    }
  }
  const loadFile = async (file: File): Promise<void> => {
    change('')
    const sequence = request.current.sequence
    if (file.size > 98304) {
      setError('证书文件不能超过 96 KiB')
      return
    }
    setBusy(true)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const text = new TextDecoder().decode(bytes)
      let encoded = ''
      if (!text.includes('-----')) for (const byte of bytes) encoded += String.fromCharCode(byte)
      if (sequence === request.current.sequence)
        setInput(text.includes('-----') ? text : btoa(encoded))
    } catch {
      if (sequence === request.current.sequence) setError('证书文件读取失败，请重试')
    } finally {
      if (sequence === request.current.sequence) setBusy(false)
    }
  }
  return (
    <>
      <input
        ref={fileInput}
        type="file"
        hidden
        accept=".pem,.cer,.crt,.der"
        aria-label="选择证书文件"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void loadFile(file)
        }}
      />
      <Workbench
        inputLabel="证书内容"
        outputLabel="证书详情"
        value={input}
        onChange={change}
        output={output}
        error={error}
        placeholder="粘贴 PEM 证书链，或选择 .pem / .cer / .crt / .der 文件"
        actions={
          <>
            <button
              type="button"
              className="btn-ghost btn-mini"
              disabled={busy}
              onClick={() => fileInput.current?.click()}
            >
              选择证书文件
            </button>
            <button type="button" className="btn-ghost btn-mini" onClick={() => change('')}>
              清空证书
            </button>
            <button
              type="button"
              className="btn-gold btn-mini"
              disabled={busy}
              onClick={() => void run()}
            >
              {busy ? '读取中…' : '查看证书'}
            </button>
          </>
        }
      />
    </>
  )
}

export function JwtCertificatePanel(): JSX.Element {
  const [mode, setMode] = useState('jwt')
  return (
    <div className="tool-stack">
      <div className="tool-controls">
        <Dropdown
          ariaLabel="查看类型"
          value={mode}
          options={[
            { value: 'jwt', label: 'JWT 解码' },
            { value: 'certificate', label: 'X.509 证书' }
          ]}
          onChange={setMode}
        />
      </div>
      <p className="field-hint">
        仅在本机查看，不保存或发送 AI；切换类型会清空输入。JWT
        不验证签名，证书不验证信任链，不代表身份可信。证书不接受私钥。
      </p>
      {mode === 'jwt' ? <JwtViewer /> : <CertificateViewer />}
    </div>
  )
}
