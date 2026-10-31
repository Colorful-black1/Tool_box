/* global structuredClone:readonly */
// 仅合成桥接数据，真实主进程及恢复链路由 verify/capability-batch.cjs 独立验收。
module.exports = (fixture) => {
  let listener = () => {},
    scanListener = () => {}
  let snapshot = {
    enabled: false,
    keywords: [],
    prefixes: [],
    pausedUntilMs: 0,
    entries: [],
    revision: 0,
    error: ''
  }
  const emit = () => {
    snapshot.revision += 1
    listener(structuredClone(snapshot))
    return structuredClone(snapshot)
  }
  const health = [
    ...[1, 2, 3].map((n) => ({
      id: `health-${n}`,
      title: `健康测试账号${n}`,
      password: 'SyntheticStrong#1234'
    })),
    { id: 'weak', title: '待修改弱密码', password: 'abc' },
    { id: 'failed', title: '无法解密账号', password: 'SyntheticStrong#1234', isDecryptable: false }
  ].map((item) => ({
    url: '',
    account: '',
    remark: '',
    firstLetter: 'J',
    isFavorite: false,
    isDecryptable: true,
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
    ...item
  }))
  fixture.toolbox.passwords.list = async () => structuredClone(health)
  fixture.toolbox.clipboardHistory = {
    list: async () => structuredClone(snapshot),
    setEnabled: async (config) => {
      snapshot = { ...snapshot, ...config }
      return emit()
    },
    pause: async () => {
      snapshot.pausedUntilMs = Date.now() + 1_800_000
      return emit()
    },
    clear: async (id) => {
      snapshot.entries = id ? snapshot.entries.filter((entry) => entry.id !== id) : []
      return emit()
    },
    pin: async (id, pinned) => {
      snapshot.entries.find((entry) => entry.id === id).pinned = pinned
      snapshot.entries.sort(
        (a, b) => Number(b.pinned) - Number(a.pinned) || b.capturedAtMs - a.capturedAtMs
      )
      return emit()
    },
    onEvent: (callback) => {
      listener = callback
      return () => {
        listener = () => {}
      }
    }
  }
  fixture.controls.seedClipboard = () => {
    snapshot.entries = ['第三段报错', '第二段文本', '第一段日志'].map((text, index) => ({
      id: String(index),
      text,
      preview: text,
      capturedAtMs: Date.now() - index * 1000,
      pinned: false,
      truncated: index === 0
    }))
    emit()
  }
  fixture.controls.healthyPasswords = () => {
    health.splice(1)
    health[0].password = 'StrongUnique!123456'
  }
  fixture.controls.emptyPasswords = () => {
    health.splice(0)
  }
  fixture.controls.emptyPasswordEntries = () => {
    health.splice(
      0,
      health.length,
      ...[1, 2].map((id) => ({
        id: `empty-${id}`,
        title: `空密码账号${id}`,
        password: '',
        account: '',
        remark: '',
        url: '',
        firstLetter: 'K',
        isFavorite: false,
        isDecryptable: true,
        createdAtMs: Date.now(),
        updatedAtMs: Date.now()
      }))
    )
  }
  fixture.toolbox.files = {
    chooseDirectory: async () => ({ token: 'fixture-directory', label: 'C:/合成目录' }),
    findDuplicates: async () => {
      const state = {
        scanId: 'fixture-scan',
        phase: 'completed',
        files: 4,
        hashed: 3,
        candidates: 3,
        skipped: 1,
        truncated: false,
        warnings: ['0 字节文件不参与重复分组'],
        groups: [
          {
            id: 'hash',
            size: 1024,
            paths: ['C:/合成目录/a.txt', 'C:/合成目录/另一个名字.txt'],
            reclaimableBytes: 1024
          }
        ]
      }
      scanListener(state)
      return state
    },
    cancelScan: async () => {},
    onScan: (callback) => {
      scanListener = callback
      return () => {
        scanListener = () => {}
      }
    }
  }
  fixture.toolbox.backup = {
    chooseFolder: async (purpose) => ({
      purpose,
      token: purpose,
      label: 'C:/Users/合成用户/Documents'
    }),
    export: async () => ({
      path: 'C:/Users/合成用户/Documents/Tool_box-快照-合成',
      restartRequired: false
    }),
    restore: async () => null
  }
}
