import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // 仅收纯逻辑测试（.ts）：React 组件测试需要额外的 RN 渲染环境，暂不引入
    include: ['src/**/*.test.ts', 'mobile/src/**/*.test.ts'],
    globals: true
  }
})
