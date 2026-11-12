import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { LocalIpAddressView, PublicIpEntry, PublicIpView } from '@shared/types'
import { CopyButton } from '../workbench'
import { PortPanel } from './port-panel'

function formatCheckedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

function PublicIpRow({ entry }: { entry: PublicIpEntry }): JSX.Element {
  return (
    <div className="tool-public-ip-row">
      <span className="field-label">公网 {entry.family}</span>
      <code>{entry.address}</code>
      <span className="field-hint">来源 {entry.source}</span>
      <CopyButton text={entry.address} label={`复制 ${entry.family}`} />
    </div>
  )
}

export function IpPanel(): JSX.Element {
  const [addresses, setAddresses] = useState<LocalIpAddressView[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [publicIp, setPublicIp] = useState<PublicIpView | null>(null)
  const [publicBusy, setPublicBusy] = useState(false)
  const [publicError, setPublicError] = useState('')
  const request = useRef({ sequence: 0 })
  const publicRequest = useRef({ sequence: 0 })
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
  const queryPublicIp = useCallback(async (): Promise<void> => {
    const sequence = ++publicRequest.current.sequence
    if (!window.toolbox?.system?.publicIp) {
      setPublicError('公网 IP 接口未就绪，请使用最新桌面应用')
      return
    }
    setPublicBusy(true)
    setPublicError('')
    setPublicIp(null)
    try {
      const result = await window.toolbox.system.publicIp()
      if (sequence === publicRequest.current.sequence) setPublicIp(result)
    } catch (error) {
      if (sequence === publicRequest.current.sequence)
        setPublicError(
          error instanceof Error && error.message.startsWith('公网 IP')
            ? error.message
            : '公网 IP 查询失败，请检查网络或代理后重试'
        )
    } finally {
      if (sequence === publicRequest.current.sequence) setPublicBusy(false)
    }
  }, [])
  useEffect(() => {
    const localState = request.current
    const publicState = publicRequest.current
    void refresh()
    return () => {
      localState.sequence++
      publicState.sequence++
    }
  }, [refresh])
  const text = addresses
    .map((item) => `${item.interfaceName}\t${item.family}\t${item.address}\t${item.netmask}`)
    .join('\n')
  return (
    <div className="tool-stack">
      <section className="tool-public-ip" aria-label="公网 IP 查询">
        <div className="tool-panel-head">
          <h3 className="tool-panel-title">公网出口</h3>
          <p className="tool-panel-desc">
            点击后分别查询公网 IPv4 / IPv6，结果仅在本次页面内保留；查询走系统代理，关闭代理后重新查询可看到本机宽带出口。
          </p>
        </div>
        <div className="tool-controls">
          <button
            type="button"
            className="btn-ghost"
            disabled={publicBusy}
            onClick={() => void queryPublicIp()}
          >
            {publicBusy ? '查询中…' : '查询公网 IP'}
          </button>
          <span className="field-hint" role="status">
            {publicBusy
              ? '正在请求第三方服务'
              : publicIp
                ? `查询于 ${formatCheckedAt(publicIp.checkedAt)}`
                : '尚未查询'}
          </span>
        </div>
        {publicError ? (
          <div className="status-banner" role="alert">
            {publicError}
          </div>
        ) : null}
        {publicIp ? (
          <div className="tool-public-ip-list">
            {publicIp.ipv4 ? <PublicIpRow entry={publicIp.ipv4} /> : null}
            {publicIp.ipv6 ? <PublicIpRow entry={publicIp.ipv6} /> : null}
          </div>
        ) : null}
        {publicIp && !publicIp.ipv4 ? (
          <p className="field-hint warn">未检测到公网 IPv4，可能被代理、运营商 NAT 或网络策略限制。</p>
        ) : null}
        {publicIp && !publicIp.ipv6 ? (
          <p className="field-hint">未检测到 IPv6，网络可能未启用 IPv6。</p>
        ) : null}
      </section>
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
        本机地址仅列非回环网卡，包含 VPN / 虚拟网卡；公网地址由第三方服务单独查询，不判断默认出网网卡。
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
      <PortPanel />
    </div>
  )
}
