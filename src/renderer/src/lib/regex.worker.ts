import { testRegex } from '@shared/dev-tools'

/** 正则仅在独立线程执行，发生灾难性回溯时由调用方终止整个 Worker。 */
self.onmessage = (event: MessageEvent<{ pattern: string; flags: string; text: string }>): void => {
  const { pattern, flags, text } = event.data
  self.postMessage(testRegex(pattern, flags, text))
}
