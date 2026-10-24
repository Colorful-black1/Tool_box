import { homedir } from 'node:os'
import { join } from 'node:path'
import type { UsageClient } from '../../../shared/agent-usage'

/** 只探测已知的统计目录，不扫描整个用户目录，不读取认证配置。 */
export function sourcePaths(client: UsageClient, home = homedir(), env = process.env): string[] {
  const root = (key: string, fallback: string): string => env[key]?.trim() || join(home, fallback)
  switch (client) {
    case 'codex':
      return [
        join(root('CODEX_HOME', '.codex'), 'sessions'),
        join(root('CODEX_HOME', '.codex'), 'archived_sessions')
      ]
    case 'opencode':
      return [
        env.OPENCODE_DB ||
          join(env.XDG_DATA_HOME || join(home, '.local/share'), 'opencode/opencode.db')
      ]
    case 'claude':
      return [join(root('CLAUDE_CONFIG_DIR', '.claude'), 'projects')]
    case 'kimi':
      return env.KIMI_CODE_HOME
        ? [join(env.KIMI_CODE_HOME, 'sessions')]
        : [join(home, '.kimi/sessions'), join(home, '.kimi-code/sessions')]
    case 'pi':
      return env.PI_DESKTOP_SESSIONS_DIR
        ? [env.PI_DESKTOP_SESSIONS_DIR]
        : [join(home, '.pi/agent/sessions'), join(home, '.pi-desktop/sessions')]
    case 'workbuddy':
      return [join(root('WORKBUDDY_CONFIG_DIR', '.workbuddy'), 'projects')]
    case 'dsh':
      return [env.DSH_SESSIONS_DIR || join(home, '.dsh/sessions')]
    case 'zcode':
      return [join(root('ZCODE_HOME', '.zcode'), 'cli/db/db.sqlite')]
    case 'gemini':
      return [join(env.GEMINI_CLI_HOME || home, '.gemini/tmp')]
    case 'copilot':
      return [join(root('COPILOT_HOME', '.copilot'), 'session-store.db')]
    case 'grok':
      return [join(root('GROK_HOME', '.grok'), 'sessions')]
    case 'mimocode':
      return [
        env.MIMOCODE_DB ||
          join(env.XDG_DATA_HOME || join(home, '.local/share'), 'mimocode/mimocode.db')
      ]
    case 'mcode':
      return [
        join(
          env.MINIMAX_DATA_DIR || env.MAVIS_DATA_DIR || join(home, '.minimax'),
          'v2/sqlite/runtime-state.sqlite'
        )
      ]
    case 'cline':
      return [
        env.CLINE_SESSION_DATA_DIR ||
          join(env.CLINE_DATA_DIR || join(root('CLINE_DIR', '.cline'), 'data'), 'sessions')
      ]
  }
}
