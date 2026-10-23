import { useState } from 'react'
import type { JSX } from 'react'
import {
  compareSpringConfig,
  convertSpringConfig,
  parseSpringConfig
} from '@shared/spring-config-tools'
import type { ConfigFormat } from '@shared/spring-config-tools'
import { Dropdown } from '../../dropdown'
import { AutoTextarea } from '../auto-textarea'
import { Workbench } from '../workbench'

const FORMATS = [
  { value: 'yaml', label: 'YAML' },
  { value: 'properties', label: 'Properties' }
]

export function SpringConfigPanel(): JSX.Element {
  const [input, setInput] = useState('')
  const [reference, setReference] = useState('')
  const [format, setFormat] = useState<ConfigFormat>('yaml')
  const [referenceFormat, setReferenceFormat] = useState<ConfigFormat>('yaml')
  const [mode, setMode] = useState('convert')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')
  const reset = (): void => {
    setOutput('')
    setError('')
  }
  const run = (): void => {
    reset()
    try {
      setOutput(
        mode === 'convert'
          ? convertSpringConfig(input, format)
          : compareSpringConfig(
              parseSpringConfig(input, format),
              parseSpringConfig(reference, referenceFormat)
            )
      )
    } catch (error) {
      setError(error instanceof Error ? error.message : '配置处理失败')
    }
  }
  return (
    <div className="tool-stack">
      <div className="tool-controls">
        <Dropdown
          ariaLabel="配置操作"
          value={mode}
          options={[
            { value: 'convert', label: '格式转换' },
            { value: 'compare', label: '配置比较' }
          ]}
          onChange={(value) => {
            reset()
            setMode(value)
          }}
        />
        <span className="field-label">输入格式</span>
        <Dropdown
          ariaLabel="配置输入格式"
          value={format}
          options={FORMATS}
          onChange={(value) => {
            reset()
            setFormat(value as ConfigFormat)
          }}
        />
        <button
          type="button"
          className="btn-ghost"
          onClick={() => {
            reset()
            setInput(
              format === 'yaml'
                ? 'server:\n  port: 8080\nspring:\n  application:\n    name: demo\n  datasource:\n    url: ${DB_URL:jdbc:h2:mem:test}\napp:\n  ids:\n    - 9223372036854775807\n    - 2'
                : 'server.port=8080\nspring.application.name=demo\nspring.datasource.url=${DB_URL:jdbc:h2:mem:test}\napp.ids[0]=9223372036854775807\napp.ids[1]=2'
            )
          }}
        >
          填入配置示例
        </button>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => {
            reset()
            setInput('')
            setReference('')
          }}
        >
          清空配置
        </button>
        <button type="button" className="btn-gold" onClick={run}>
          {mode === 'convert' ? '转换配置' : '比较配置'}
        </button>
      </div>
      <p className="field-hint">
        本机处理，不保存或发送 AI。支持缩进映射、块列表、Properties 转义和续行；保留长整数与占位符。
        转换去除注释，YAML 输出统一使用字符串。多文档、锚点、标签、流式集合、多行标量和 null
        会明确拒绝； 不模拟 Spring 环境覆盖或解析占位符。
      </p>
      {mode === 'compare' ? (
        <section className="tool-io">
          <header className="tool-io-head">
            <span className="tool-io-label">右侧参考配置</span>
            <Dropdown
              ariaLabel="参考配置格式"
              value={referenceFormat}
              options={FORMATS}
              onChange={(value) => {
                reset()
                setReferenceFormat(value as ConfigFormat)
              }}
            />
          </header>
          <AutoTextarea
            className="field-input field-textarea tool-input"
            value={reference}
            ariaLabel="右侧参考配置"
            placeholder="粘贴另一个环境的配置"
            onChange={(value) => {
              reset()
              setReference(value)
            }}
          />
        </section>
      ) : null}
      <Workbench
        inputLabel={mode === 'compare' ? '左侧配置' : '待转换的 Spring 配置'}
        outputLabel={
          mode === 'compare' ? '配置差异' : format === 'yaml' ? 'Properties 结果' : 'YAML 结果'
        }
        value={input}
        onChange={(value) => {
          reset()
          setInput(value)
        }}
        output={output}
        error={error}
        placeholder="粘贴 application.yml 或 application.properties 的单份配置"
      />
    </div>
  )
}
