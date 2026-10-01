import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { NavigationContainer } from '@react-navigation/native'
import type { ReactNode } from 'react'
import { StyleSheet } from 'react-native'
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context'

import { colors, fonts } from './src/theme'
import { BootGate, ServicesProvider } from './src/runtime/services'
import { ChatScreen } from './src/screens/chat-screen'
import { NotesScreen } from './src/screens/notes-screen'
import { PasswordScreen } from './src/screens/password-screen'
import { SettingsScreen } from './src/screens/settings-screen'
import { ShelfScreen } from './src/screens/shelf-screen'

const Tab = createBottomTabNavigator()

/** Tab 栏自身的高度（不含底部安全区） */
const TAB_BAR_HEIGHT = 56

/**
 * 根组件：导航骨架 + 主题容器 + 5 个模块入口。
 * 各模块的真实界面分别在 M2（对话）、M3（记事本）、M4（阅读）、M5（密码箱）接入。
 */
export default function App(): ReactNode {
  return (
    <SafeAreaProvider>
      <ServicesProvider>
        <BootGate>
          <NavigationContainer theme={navigationTheme}>
            <Tabs />
          </NavigationContainer>
        </BootGate>
      </ServicesProvider>
    </SafeAreaProvider>
  )
}

/**
 * 底部 Tab 栏必须自己吃掉安全区。
 *
 * `react-native-safe-area-context` 只负责**上报**内边距，不做任何自动避让；
 * 之前只挂了 `SafeAreaProvider` 却没人消费 `useSafeAreaInsets`，
 * 结果 Tab 栏紧贴系统导航栏（有三键导航 / 手势条的机型上会被压住）。
 * 正确做法是「固定高度 + 底部内边距」一起给：只加 padding 不加高度，
 * 标签会被挤扁；只加高度不加 padding，图标又会陷进导航栏里。
 */
function Tabs(): ReactNode {
  const insets = useSafeAreaInsets()
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: [
          styles.tabBar,
          {
            height: TAB_BAR_HEIGHT + insets.bottom,
            paddingBottom: insets.bottom,
            paddingTop: 6
          }
        ],
        tabBarActiveTintColor: colors.gold,
        tabBarInactiveTintColor: colors.textDim,
        tabBarLabelStyle: styles.tabLabel
      }}
    >
      <Tab.Screen name="Chat" component={ChatScreen} options={{ title: '对话' }} />
      <Tab.Screen name="Shelf" component={ShelfScreen} options={{ title: '书架' }} />
      <Tab.Screen name="Passwords" component={PasswordScreen} options={{ title: '密码箱' }} />
      <Tab.Screen name="Notes" component={NotesScreen} options={{ title: '记事本' }} />
      <Tab.Screen name="Settings" component={SettingsScreen} options={{ title: '设置' }} />
    </Tab.Navigator>
  )
}

/** 让导航容器背景与设计令牌一致，避免默认白底闪一下 */
const navigationTheme = {
  dark: true,
  colors: {
    primary: colors.gold,
    background: colors.bgDeep,
    card: colors.bgPanelSolid,
    text: colors.textHi,
    border: colors.line,
    notification: colors.cyan
  },
  fonts: {
    regular: { fontFamily: fonts.sans, fontWeight: '400' as const },
    medium: { fontFamily: fonts.sans, fontWeight: '500' as const },
    bold: { fontFamily: fonts.sans, fontWeight: '700' as const },
    heavy: { fontFamily: fonts.sans, fontWeight: '700' as const }
  }
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: colors.bgPanelSolid,
    borderTopColor: colors.line
  },
  tabLabel: {
    fontSize: 11,
    letterSpacing: 1,
    fontFamily: fonts.sans,
    // 底部安全区已经占了 paddingBottom，标签自身不要再多留行高
    marginTop: 0
  }
})
