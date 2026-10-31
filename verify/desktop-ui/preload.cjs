const { contextBridge, ipcRenderer } = require('electron')
const fixture = require('./fixture.cjs')()
fixture.toolbox.developerCommands = {
  read: () => ipcRenderer.invoke('developer-commands:read'),
  save: (input) => ipcRenderer.invoke('developer-commands:save', input),
  setFavorite: (input) => ipcRenderer.invoke('developer-commands:favorite:set', input),
  setArchived: (input) => ipcRenderer.invoke('developer-commands:archive:set', input)
}
fixture.controls.failNextCommandSave = () => ipcRenderer.invoke('verify:commands:fail-save')
if (process.env.TOOLBOX_USAGE_VERIFY === '1') {
  const usage = require('./agent-usage-fixture.cjs')()
  fixture.toolbox.agentUsage = usage.bridge
  Object.assign(fixture.controls, usage.controls)
}
if (
  process.env.TOOLBOX_CODING_AGENT_VERIFY === '1' ||
  process.env.TOOLBOX_CONVENIENCE_VERIFY === '1'
) {
  const agents = require('./coding-agents-fixture.cjs')()
  fixture.toolbox.codingAgents = agents.bridge
  Object.assign(fixture.controls, agents.controls)
}

fixture.toolbox.config = {
  get: () => ipcRenderer.invoke('verify:config:get'),
  set: (patch) => ipcRenderer.invoke('verify:config:set', patch)
}
fixture.controls.failNextConfigSave = () => ipcRenderer.invoke('verify:config:fail-save')
fixture.controls.readConfig = () => ipcRenderer.invoke('verify:config:get')
fixture.toolbox.agentDrafts = {
  read: () => ipcRenderer.invoke('agent-draft:read'),
  save: (input) => ipcRenderer.invoke('agent-draft:save', input),
  flushed: (input) => ipcRenderer.invoke('agent-draft:flushed', input),
  onFlush: (listener) => {
    const wrapped = (_event, id) => listener(id)
    ipcRenderer.on('agent-draft:event:flush', wrapped)
    return () => ipcRenderer.removeListener('agent-draft:event:flush', wrapped)
  }
}
fixture.controls.flushDrafts = () => ipcRenderer.invoke('verify:draft:flush')
fixture.controls.failNextDraftRead = () => ipcRenderer.invoke('verify:draft:fail-read')
fixture.controls.failNextDraftSave = () => ipcRenderer.invoke('verify:draft:fail-save')
fixture.controls.draftStorageEncrypted = () => ipcRenderer.invoke('verify:draft:encrypted')

fixture.toolbox.todos = {
  list: (query) => ipcRenderer.invoke('todos:list', query),
  save: (input) => ipcRenderer.invoke('todos:save', input),
  complete: (id, completed) => ipcRenderer.invoke('todos:complete', id, completed),
  archive: (id, archived) => ipcRenderer.invoke('todos:archive', id, archived),
  testNotification: () => ipcRenderer.invoke('todos:notification:test'),
  onEvent: (listener) => {
    const wrapped = (_event, payload) => listener(payload)
    ipcRenderer.on('todos:event', wrapped)
    return () => ipcRenderer.removeListener('todos:event', wrapped)
  }
}
fixture.controls.openTodo = (id) => ipcRenderer.invoke('verify:todo:open', id)

if (process.env.TOOLBOX_CHAT_TOOLS_VERIFY === '1')
  require('./chat-tools-preload.cjs')(fixture, ipcRenderer)

if (process.env.TOOLBOX_CAPABILITY_VERIFY === '1')
  require('./capability-batch-fixture.cjs')(fixture)

contextBridge.exposeInMainWorld('toolbox', fixture.toolbox)
contextBridge.exposeInMainWorld('uiVerification', fixture.controls)
