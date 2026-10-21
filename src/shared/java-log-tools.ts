import { checkToolInput } from './json-tools'

/** 显式选择会改变正文的操作，默认不展开可能属于路径的反斜杠。 */
export interface JavaLogOptions {
  expandEscapes: boolean
  collapseRepeated: boolean
  traceId: string
}

export function cleanJavaLog(
  text: string,
  options: JavaLogOptions
): {
  output: string
  causes: string[]
  collapsed: number
  matchedRecords: number
} {
  checkToolInput(text)
  if (options.traceId.length > 200) throw new Error('traceId 最多 200 字符')
  // 参数长度有界，避免大量未闭合 ESC 序列导致正则反复扫描。
  // eslint-disable-next-line no-control-regex -- 此工具专门识别并清理 ANSI ESC 控制序列。
  let output = text.replace(/\x1b\[[0-?]{0,64}[ -/]{0,8}[@-~]/g, '').replace(/\r\n?/g, '\n')
  if (options.expandEscapes) {
    let decoded = false
    if (output.trim().startsWith('"')) {
      try {
        const parsed: unknown = JSON.parse(output)
        if (typeof parsed === 'string') {
          output = parsed
          decoded = true
        }
      } catch {
        /* 非完整 JSON 字符串按普通日志处理，只展开已知转义。 */
      }
    }
    if (!decoded)
      output = output.replace(/\\(\\|r\\n|n|r|t)/g, (_match, code: string) =>
        code === '\\' ? '\\' : code === 't' ? '\t' : '\n'
      )
    output = output.replace(/\r\n?/g, '\n')
  }
  let lines = output.split('\n')
  const trace = options.traceId.trim()
  let matchedRecords = 0
  if (trace) {
    const selected: string[] = []
    let active = false
    for (const line of lines) {
      const continuation =
        /^\s+(?:at\s|\.\.\.)|^\s*(?:Caused by:|Suppressed:)|^\s*(?:[\w$]+\.)+[\w$]*(?:Exception|Error|Throwable)\b/.test(
          line
        )
      if (!continuation) {
        active = line.includes(trace)
        if (active) matchedRecords++
      }
      if (active || line.includes(trace)) selected.push(line)
    }
    lines = selected
  }
  const causes = lines
    .filter((line) => /^\s*(?:Caused by:|Suppressed:)/.test(line))
    .map((line) => line.trim())
    .slice(0, 100)
  let collapsed = 0
  if (options.collapseRepeated) {
    const compact: string[] = []
    for (let index = 0; index < lines.length;) {
      let end = index + 1
      while (end < lines.length && lines[end] === lines[index]) end++
      compact.push(lines[index])
      if (end - index > 1) {
        compact.push(`… 连续重复 ${end - index} 次`)
        collapsed += end - index - 1
      }
      index = end
    }
    lines = compact
  }
  return { output: lines.join('\n'), causes, collapsed, matchedRecords }
}
