/** 本机快照是文件夹，不承诺跨电脑或跨系统用户解密。 */
export interface BackupFolderReference {
  token: string
  label: string
  purpose: 'export' | 'restore'
}

/** 清单中只允许固定的数据文件和两个受管资源目录。 */
export interface BackupManifest {
  version: 1
  appVersion: string
  schemaVersion: number
  createdAtMs: number
  localOnly: true
  machineTag: string
  files: Array<{ path: string; size: number; sha256: string }>
}

/** 只将路径与结果传给渲染层，不返回配置内容或主密钥。 */
export interface BackupResult {
  path: string
  safetySnapshotPath?: string
  restartRequired: boolean
}
