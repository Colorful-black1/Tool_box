import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { NavigationContainer } from '@react-navigation/native'
import type { ReactNode } from 'react'
import { StyleSheet } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { colors, fonts } from './src/theme'
import { ChatScreen } from './src/screens/chat-screen'
import { NotesScreen } from './src/screens/notes-screen'
import { PasswordScreen } from './src/screens/password-screen'
import { SettingsScreen } from './src/screens/settings-screen'
import { ShelfScreen } from './src/screens/shelf-screen'

const Tab = createBottomTabNavigator()

/**
 * M0 根组件：导航骨架 + 主题容器 + 5 个模块入口。
 * 各模块的真实界面分别在 M2（对话）、M3（记事本）、M4（阅读）、M5（密码箱）接入。
 */
export default function App(): ReactNode {
  return (
    <SafeAreaProvider>
      <NavigationContainer theme={navigationTheme}>
        <Tab.Navigator
          screenOptions={{
            headerShown: false,
            tabBarStyle: styles.tabBar,
            tabBarActiveTintColor: colors.gold,
            tabBarInactiveTintColor: colors.textDim,
            tabBarLabelStyle: styles.tabLabel
          }}
        >
          <Tab.Screen name="Chat" component={ChatScreen} options={{ title: '对话' }} />
          <Tab.Screen name="Shelf" component={ShelfScreen} options={{ title: '书架' }} />
          <Tab.Screen
            name="Passwords"
            component={PasswordScreen}
            options={{ title: '密码箱' }}
          />
          <Tab.Screen name="Notes" component={NotesScreen} options={{ title: '记事本' }} />
          <Tab.Screen name="Settings" component={SettingsScreen} options={{ title: '设置' }} />
        </Tab.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
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
    fontFamily: fonts.sans
  }
})
