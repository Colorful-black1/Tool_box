const { contextBridge, ipcRenderer } = require('electron')
const fixture = require('./fixture.cjs')()
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

contextBridge.exposeInMainWorld('toolbox', fixture.toolbox)
contextBridge.exposeInMainWorld('uiVerification', fixture.controls)
