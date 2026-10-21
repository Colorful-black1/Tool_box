import type { RegexResult } from '@shared/dev-tools'

/** 包含线程启动时间的单次预算，超时后终止线程以保持界面可用。 */
export const REGEX_TIMEOUT_MS = 1000

/** 每次创建独立任务；完成、失败、取消与超时均清理线程及事件监听。 */
export function runRegex(
  pattern: string,
  flags: string,
  text: string,
  signal: AbortSignal
): Promise<RegexResult> {
  if (signal.aborted || !pattern) return Promise.resolve({ matches: [] })

  return new Promise((resolve) => {
    let worker: Worker
    try {
      worker = new Worker(new URL('./regex.worker.ts', import.meta.url), { type: 'module' })
    } catch {
      // 线程不可用时给出提示，禁止回落主线程执行可能阻塞的正则。
      resolve({ matches: [], error: '无法启动正则测试，请重新打开工具页后重试' })
      return
    }

    let settled = false
    const finish = (result: RegexResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      signal.removeEventListener('abort', onAbort)
      worker.onmessage = null
      worker.onerror = null
      worker.onmessageerror = null
      worker.terminate()
      resolve(result)
    }
    const onAbort = (): void => finish({ matches: [] })
    const timeout = setTimeout(
      () => finish({ matches: [], error: '匹配超时，已停止测试；请简化表达式或缩短文本' }),
      REGEX_TIMEOUT_MS
    )
    signal.addEventListener('abort', onAbort, { once: true })
    worker.onmessage = (event: MessageEvent<RegexResult>): void => finish(event.data)
    worker.onerror = (event): void => {
      event.preventDefault()
      finish({ matches: [], error: '正则测试失败，请重新尝试' })
    }
    worker.onmessageerror = (): void => {
      finish({ matches: [], error: '无法读取正则测试结果，请重新尝试' })
    }
    try {
      worker.postMessage({ pattern, flags, text })
    } catch {
      // 输入无法传入线程时仍需释放已创建的线程与超时计时器。
      finish({ matches: [], error: '无法开始正则测试，请缩短文本后重试' })
    }
  })
}
