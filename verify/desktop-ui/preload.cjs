const { contextBridge, ipcRenderer } = require('electron')
const fixture = require('./fixture.cjs')()

fixture.toolbox.config = {
  get: () => ipcRenderer.invoke('verify:config:get'),
  set: (patch) => ipcRenderer.invoke('verify:config:set', patch)
}
fixture.controls.failNextConfigSave = () => ipcRenderer.invoke('verify:config:fail-save')
fixture.controls.readConfig = () => ipcRenderer.invoke('verify:config:get')

contextBridge.exposeInMainWorld('toolbox', fixture.toolbox)
contextBridge.exposeInMainWorld('uiVerification', fixture.controls)
