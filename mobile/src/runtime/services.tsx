/**
 * 应用服务容器：把数据层与 AI 链路组装成一个单例，并通过 Context 下发。
 *
 * 为什么用 Context 而不是各处 import 单例：
 * - 需要在启动时异步 bootstrap（开库 → 跑迁移 → 造密钥盒），期间要有加载/错误态；
 * - 设置页与对话页要用同一份 AiSettingsService / AiGateway，
 *   否则会出现「设置改了但对话页还拿旧配置」。
 *
 * 网络层用 `expo/fetch` 而不是全局 fetch：
 * RN 的全局 fetch 建立在 XMLHttpRequest 上，**响应不提供流式 body**
 * （`response.body` 为 undefined），拿不到逐字增量。expo/fetch 是原生实现，
 * 支持 ReadableStream。
 */
import { fetch as expoFetch } from 'expo/fetch'
import * as Crypto from 'expo-crypto'
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { AI_SETTINGS_MASTER_KEY, MASTER_KEY_STORE_KEY } from '../data/constants'
import { openDatabase } from '../data/database'
import { SecureStoreSecretBox } from '../data/secret-box'
import { MobileStore } from '../data/store'
import { AiSettingsService } from '../ai/ai-settings'
import { AiGateway } from '../ai/ai-gateway'
import type { FetchLike } from '../ai/stream-chat'
import { colors, fonts } from '../theme'

export interface AppServices {
  store: MobileStore
  aiSettings: AiSettingsService
  gateway: AiGateway
  /** 统一走 expo/fetch：RN 全局 fetch 不支持流式响应体 */
  fetchImpl: FetchLike
}

type BootState =
  | { phase: 'loading' }
  | { phase: 'ready'; services: AppServices }
  | { phase: 'error'; message: string }

const ServicesContext = createContext<BootState>({ phase: 'loading' })

/** 取已就绪的服务；未就绪时抛错，调用方须先判断 phase */
export function useServices(): AppServices {
  const state = useContext(ServicesContext)
  if (state.phase !== 'ready') throw new Error('服务尚未就绪')
  return state.services
}

/** 只关心就绪与否的场合（如开关、禁用态） */
export function useBootState(): BootState {
  return useContext(ServicesContext)
}

export function ServicesProvider({ children }: { children: ReactNode }): ReactNode {
  const [state, setState] = useState<BootState>({ phase: 'loading' })

  useEffect(() => {
    let disposed = false

    const boot = async (): Promise<void> => {
      try {
        const db = await openDatabase()
        if (disposed) return

        const newId = (): string => Crypto.randomUUID()
        const store = new MobileStore(db, new SecureStoreSecretBox(MASTER_KEY_STORE_KEY), newId)
        // AI Key 用独立密钥，与密码箱主密钥互不影响
        const aiSettings = new AiSettingsService(
          store,
          new SecureStoreSecretBox(AI_SETTINGS_MASTER_KEY),
          newId
        )
        const gateway = new AiGateway(aiSettings, store, expoFetch as unknown as FetchLike)

        const fetchImpl = expoFetch as unknown as FetchLike
        if (!disposed)
          setState({ phase: 'ready', services: { store, aiSettings, gateway, fetchImpl } })
      } catch (error) {
        if (disposed) return
        // 只提示可读信息，不把底层异常栈暴露给用户
        const message = error instanceof Error ? error.message : '初始化失败'
        setState({ phase: 'error', message })
      }
    }

    void boot()
    return () => {
      disposed = true
    }
  }, [])

  const value = useMemo(() => state, [state])
  return <ServicesContext.Provider value={value}>{children}</ServicesContext.Provider>
}

/** 启动中 / 启动失败的兜底界面 */
export function BootGate({ children }: { children: ReactNode }): ReactNode {
  const state = useBootState()

  if (state.phase === 'loading') return <BootNotice text="正在初始化本地数据…" />
  if (state.phase === 'error') return <BootNotice text={`初始化失败：${state.message}`} />
  return <>{children}</>
}

function BootNotice({ text }: { text: string }): ReactNode {
  return (
    <View style={styles.root}>
      <Text style={styles.text}>{text}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  text: { color: colors.textMid, fontSize: 13, textAlign: 'center', fontFamily: fonts.sans }
})
