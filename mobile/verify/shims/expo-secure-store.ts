/** 验证用 shim：内存版 expo-secure-store（真机上是系统钥匙串） */

const store = new Map<string, string>()

export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = 'whenUnlockedThisDeviceOnly'

export async function getItemAsync(key: string): Promise<string | null> {
  return store.get(key) ?? null
}

export async function setItemAsync(
  key: string,
  value: string,
  _options?: { keychainAccessible?: string }
): Promise<void> {
  store.set(key, value)
}

export async function deleteItemAsync(key: string): Promise<void> {
  store.delete(key)
}
