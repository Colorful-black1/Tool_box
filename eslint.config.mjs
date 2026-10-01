import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  { ignores: ['out', 'dist', 'node_modules', 'release', 'scripts', 'mobile/dist', '**/.out/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // 渲染层与手机端都是 React，两套 hooks 规则共用
    files: ['src/renderer/src/**/*.{ts,tsx}', 'mobile/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // 本项目所有数据加载都走 IPC（window.toolbox），异步首屏加载在 effect 内
      // 触发 setState 是刻意的模式（同旧项目 Riverpod FutureProvider 语义）。
      'react-hooks/set-state-in-effect': 'off'
    }
  },
  {
    // 验证装置：跑在 Electron 主进程（Node），但也用 Web 的 btoa/atob/TextEncoder
    files: ['mobile/verify/**/*.ts'],
    languageOptions: {
      globals: {
        Buffer: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        btoa: 'readonly',
        atob: 'readonly',
        crypto: 'readonly',
        __dirname: 'readonly'
      }
    }
  },
  {
    // CommonJS 配置文件：eslint.config.cjs / metro.config.js / verify/run.cjs 等本身就是 CJS
    files: ['**/*.cjs', '**/*.config.js', '**/run.cjs'],
    languageOptions: {
      globals: {
        module: 'readonly',
        require: 'readonly',
        exports: 'readonly',
        process: 'readonly',
        console: 'readonly',
        __dirname: 'readonly'
      }
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off'
    }
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ]
    }
  }
)
