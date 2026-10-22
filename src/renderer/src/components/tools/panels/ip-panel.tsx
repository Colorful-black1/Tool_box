import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { LocalIpAddressView } from '@shared/types'
import { CopyButton } from '../workbench'

export function IpPanel(): JSX.Element {
  const [addresses, setAddresses] = useState<LocalIpAddressView[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const request = useRef({ sequence: 0 })
  const refresh = useCallback(async (): Promise<void> => {
    const sequence = ++request.current.sequence
    if (!window.toolbox?.system?.networkAddresses) {
      setError('网络信息接口未就绪，请使用最新桌面应用')
      return
    }
    setBusy(true)
    setAddresses([])
    setError('')
    try {
      const result = await window.toolbox.system.networkAddresses()
      if (sequence === request.current.sequence) setAddresses(result)
    } catch {
      if (sequence === request.current.sequence) setError('无法读取本机 IP，请稍后刷新重试')
    } finally {
      if (sequence === request.current.sequence) setBusy(false)
    }
  }, [])
  useEffect(() => {
    const state = request.current
    void refresh()
    return () => {
      state.sequence++
    }
  }, [refresh])
  const text = addresses
    .map((item) => `${item.interfaceName}\t${item.family}\t${item.address}\t${item.netmask}`)
    .join('\n')
  return (
    <div className="tool-stack">
      <div className="tool-controls">
        <button type="button" className="btn-ghost" disabled={busy} onClick={() => void refresh()}>
          {busy ? '读取中…' : '刷新 IP'}
        </button>
        <CopyButton text={text} label="复制全部地址" />
        <span className="field-hint" role="status">
          {addresses.length} 个本机地址
        </span>
      </div>
      <p className="field-hint">
        仅列本机非回环地址，包含 VPN / 虚拟网卡；不查询公网 IP，也不判断默认出网网卡。
      </p>
      {error ? (
        <div className="status-banner" role="alert">
          {error}
        </div>
      ) : null}
      {!busy && !error && !addresses.length ? (
        <p className="field-hint" role="status">
          未发现可用地址，请检查网络连接后刷新。
        </p>
      ) : null}
      {addresses.length ? (
        <div className="tool-diff">
          <table className="tool-ip-table" aria-label="本机 IP 地址">
            <thead>
              <tr>
                <th>网卡</th>
                <th>协议</th>
                <th>IP 地址</th>
                <th>子网掩码</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {addresses.map((item) => (
                <tr key={`${item.interfaceName}/${item.family}/${item.address}`}>
                  <td>{item.interfaceName}</td>
                  <td>{item.family}</td>
                  <td>
                    <code>{item.address}</code>
                  </td>
                  <td>
                    <code>{item.netmask}</code>
                  </td>
                  <td>
                    <CopyButton text={item.address} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}
