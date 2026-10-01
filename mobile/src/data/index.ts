/**
 * 数据层对外接口。界面层只从这里 import，不要直接引用内部文件。
 */

export { openDatabase, databaseDirectory, databaseFilePath } from './database'
export { transact } from './transaction'
export { SCHEMA_VERSION } from './schema'
export { SecureStoreSecretBox } from './secret-box'
export type { SecretBox } from './secret-box'
export {
  ENVELOPE_VERSION,
  IV_BYTE_LENGTH,
  TAG_BYTE_LENGTH,
  unpackEnvelope
} from './secret-envelope'
export type { SecretEnvelope, SecretPayload } from './secret-envelope'
export { MobileStore } from './store'
export { DB_FILE_NAME, COVERS_DIR, BACKGROUNDS_DIR } from './constants'