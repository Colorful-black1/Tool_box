/**
 * 把路由上的「快捷动作」参数转成一个递增的信号。
 *
 * 页面拿到的是普通 number，子组件用 useEffect 盯着它变化即可，
 * 不必把路由对象一路传下去。
 */
import { useEffect, useState } from 'react'
import { useRoute } from '@react-navigation/native'
import type { RouteProp } from '@react-navigation/native'

import type { RootTabParamList } from './tab-params'

export function useQuickActionSignal(): number {
  const route = useRoute<RouteProp<RootTabParamList>>()
  const quick = route.params?.quick
  const [signal, setSignal] = useState(0)

  useEffect(() => {
    if (!quick) return
    setSignal((value) => value + 1)
  }, [quick])

  return signal
}
