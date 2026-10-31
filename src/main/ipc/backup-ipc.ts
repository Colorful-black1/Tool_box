import { createHash, randomUUID } from 'node:crypto'
import { homedir, hostname, userInfo } from 'node:os'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import type { BackupFolderReference } from '../../shared/backup'
import { IPC } from '../../shared/ipc-contract'
import { BackupService } from '../services/backup/backup-service'
import { ToolboxStore } from '../services/chat-store/chat-store'
import { requireCapabilityOwner } from './clipboard-ipc'
import { requireEnum, requireString } from './validation'

/** 原始路径仅来自系统选择框；窗口、用途、有效期及单次消费在主进程约束。 */
export function registerBackupIpc(
  store: ToolboxStore,
  canRestore: () => boolean = () => true
): void {
  const machineTag = createHash('sha256')
    .update([hostname(), userInfo().username, homedir()].join('\0'))
    .digest('hex')
  const service = new BackupService(
    app.getPath('userData'),
    app.getPath('documents'),
    {
      backupTo: (path) => store.backupTo(path),
      inspect: ToolboxStore.inspectSnapshot,
      close: () => {
        if (!canRestore()) throw new Error('请先停止正在运行的对话和编程 Agent，再恢复快照')
        store.close()
      }
    },
    app.getVersion(),
    machineTag
  )
  const choices = new Map<
    number,
    { token: string; directory: string; purpose: 'export' | 'restore'; expires: number }
  >()
  const watched = new Set<number>()
  ipcMain.handle(
    IPC.backupChooseFolder,
    async (event, value: unknown): Promise<BackupFolderReference | null> => {
      const owner = requireCapabilityOwner(event)
      const purpose = requireEnum(value, '快照用途', ['export', 'restore'] as const)
      const result = await dialog.showOpenDialog(owner, {
        title:
          purpose === 'export'
            ? '选择文档目录内的备份位置（将新建独立快照文件夹）'
            : '选择含 manifest.json 的本机快照文件夹',
        defaultPath: app.getPath('documents'),
        properties: ['openDirectory']
      })
      if (result.canceled || !result.filePaths[0] || event.sender.isDestroyed()) return null
      const token = randomUUID()
      choices.set(owner.id, {
        token,
        directory: result.filePaths[0],
        purpose,
        expires: Date.now() + 10 * 60_000
      })
      if (!watched.has(owner.id)) {
        watched.add(owner.id)
        owner.once('closed', () => {
          choices.delete(owner.id)
          watched.delete(owner.id)
        })
      }
      return { token, label: result.filePaths[0], purpose }
    }
  )
  const consume = (owner: number, value: unknown, purpose: 'export' | 'restore'): string => {
    const token = requireString(value, '快照目录引用', { maxLength: 64 })
    const choice = choices.get(owner)
    if (
      !choice ||
      choice.token !== token ||
      choice.purpose !== purpose ||
      choice.expires < Date.now()
    )
      throw new Error('快照目录引用已失效，请重新选择')
    choices.delete(owner)
    return choice.directory
  }
  ipcMain.handle(IPC.backupExport, async (event, input: unknown) => {
    const owner = requireCapabilityOwner(event)
    const folder = consume(owner.id, input, 'export')
    try {
      return await service.export(folder)
    } catch (error) {
      console.warn('[Backup] 导出未完成')
      if (error instanceof Error && /文档目录|另一项备份|普通文件夹/.test(error.message))
        throw error
      throw new Error('快照导出未完成，请检查空间、权限和资源目录。已有文件不会被覆盖。', {
        cause: error
      })
    }
  })
  ipcMain.handle(IPC.backupRestore, async (event, input: unknown) => {
    const owner = requireCapabilityOwner(event)
    const folder = consume(owner.id, input, 'restore')
    if (!canRestore()) throw new Error('请先停止正在运行的对话和编程 Agent，再恢复快照')
    try {
      await service.validate(folder)
    } catch (error) {
      if (error instanceof Error && /^快照|^此快照|^清单/.test(error.message)) throw error
      throw new Error('快照校验失败，当前数据未改变', { cause: error })
    }
    const confirm = await dialog.showMessageBox(owner, {
      type: 'warning',
      title: '确认恢复本机快照',
      message: '会覆盖当前全部数据，覆盖前自动生成一份当前快照',
      detail:
        '请先保存编辑并停止正在运行的任务。快照只可在原电脑及系统用户下恢复。恢复完成后应用将退出，请手动重新打开。',
      buttons: ['取消', '覆盖并恢复'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    })
    if (confirm.response !== 1) return null
    const windows = BrowserWindow.getAllWindows()
    windows.forEach((window) => window.setEnabled(false))
    try {
      return await service.restore(folder, (result): never => {
        try {
          dialog.showMessageBoxSync({
            type: result.path ? 'info' : 'error',
            title: result.path ? '恢复完成' : '恢复未完成',
            message: result.path
              ? '本机快照已恢复，请手动重新启动应用'
              : '恢复未完成，当前数据已尝试回退，请重新启动应用',
            detail: `前置快照：${result.safetySnapshotPath}\n若重新打开失败，请保留数据目录中的恢复日志与快照，不要删除。`,
            buttons: ['退出应用']
          })
        } catch {
          // 连接已经关闭；系统提示异常也必须退出，不能返回界面继续使用旧缓存。
          console.warn('[Backup] 恢复结果提示未显示，请手动重新打开应用')
        }
        app.exit(0)
        process.exit(0)
      })
    } catch {
      console.warn('[Backup] 恢复准备失败，当前数据未覆盖')
      throw new Error('恢复准备失败，当前数据未覆盖。请检查空间、权限和快照完整性。')
    } finally {
      windows.forEach((window) => {
        if (!window.isDestroyed()) window.setEnabled(true)
      })
    }
  })
}
