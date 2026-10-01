/**
 * 一键运行 M1 数据层端到端验证。
 *
 * 做法：用 esbuild 把真实数据层（schema / migrate / store / secret-box）打成一个 Node 包，
 * 只 shim 掉 expo-sqlite、expo-crypto、expo-secure-store 三个原生绑定，
 * 然后用 Electron 跑（better-sqlite3 是 Electron ABI，必须在 Electron 里加载）。
 *
 * 覆盖：建库、迁移分段、迁移幂等、v2→v4 升级、全部业务 SQL、AES-256-GCM 往返、
 * 级联删除、错误路径。
 * 不覆盖：真机上的原生绑定行为与系统钥匙串，这部分只能上真机验。
 *
 * 用法：npm run verify:data
 */
const { execFileSync, spawnSync } = require('node:child_process')
const { existsSync, mkdirSync, readFileSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')

const verifyDir = __dirname
const mobileDir = resolve(verifyDir, '..')
const repoRoot = resolve(mobileDir, '..')
const outDir = join(verifyDir, '.out')
const outFile = join(outDir, 'verify-bundle.cjs')
const logFile = join(outDir, 'verify.log')

// 直接用 node 跑 esbuild 的 JS 入口：Windows 下 spawnSync 无法直接执行 .cmd
const esbuild = join(repoRoot, 'node_modules', 'esbuild', 'bin', 'esbuild')
const electron = join(repoRoot, 'node_modules', 'electron', 'dist', 'electron.exe')

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

console.log('1/2 打包（esbuild，shim 掉三个原生绑定）…')
execFileSync(
  process.execPath,
  [
    esbuild,
    join(verifyDir, 'verify-data.ts'),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--target=node20',
    '--external:better-sqlite3',
    `--alias:expo-crypto=${join(verifyDir, 'shims', 'expo-crypto.ts')}`,
    `--alias:expo-secure-store=${join(verifyDir, 'shims', 'expo-secure-store.ts')}`,
    `--outfile=${outFile}`
  ],
  { cwd: mobileDir, stdio: 'inherit' }
)

console.log('2/2 运行（Electron + better-sqlite3）…')
// 用绝对路径：Electron 以自己的 CWD 解析相对路径
const result = spawnSync(electron, [outFile], {
  cwd: mobileDir,
  stdio: 'ignore',
  env: { ...process.env, VERIFY_OUT_DIR: outDir }
})

if (existsSync(logFile)) {
  console.log(readFileSync(logFile, 'utf8'))
} else {
  console.error('没有生成验证日志，说明脚本未能启动。')
}

process.exit(result.status ?? 1)
