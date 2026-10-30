const LOCAL_SKILL_NOTE =
  /^用户明确选择本机 Skill "(?:[^"\\]|\\.)*"。请先按原生文件读取权限读取 "(?:[^"\\]|\\.)*" 的完整说明，并按其中的相对目录寻找资源；不要仅凭名称猜测步骤。读取被拒绝或不支持时明确告知用户，不宣称已调用。$/

/** 仅移除用户消息末尾引用区中的固定说明，保留提问和其他引用；不修改原始历史。 */
export function agentUserMessageText(content: string): string {
  const boundary = content.lastIndexOf('\n\n')
  if (boundary < 0) return content
  const lines = content.slice(boundary + 2).split('\n')
  const visible = lines.filter((line) => !LOCAL_SKILL_NOTE.test(line))
  if (visible.length === lines.length) return content
  return content.slice(0, boundary) + (visible.length ? `\n\n${visible.join('\n')}` : '')
}
