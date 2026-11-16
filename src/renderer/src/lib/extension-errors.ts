/**
 * 把 IPC 抛回来的错误还原成用户可读的一句话。
 *
 * Electron 会把主进程错误包成
 * `Error invoking remote method 'skill-hub:search': Error: 关键词至少 2 个字符`，
 * 界面只展示最后那段原因；拿不到时回退到调用方给的默认文案。
 */
export function ipcErrorText(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback
  const text = error.message
    .replace(/^Error invoking remote method '[^']*':\s*/, '')
    .replace(/^Error:\s*/, '')
    .trim()
  return text || fallback
}
