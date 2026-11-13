// The only bridge between the UI and the main process: a small, explicit API (no Node in the page).
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (fn) => {
  const h = (_e, data) => fn(data);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};

contextBridge.exposeInMainWorld('taskpilot', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  setViewBounds: (b) => ipcRenderer.invoke('view:bounds', b),
  go: (url) => ipcRenderer.invoke('view:go', url),
  back: () => ipcRenderer.invoke('view:back'),
  showView: (on) => ipcRenderer.invoke('view:visible', on),
  start: (task) => ipcRenderer.invoke('agent:start', { task }),
  stop: () => ipcRenderer.invoke('agent:stop'),
  answer: (id, reply) => ipcRenderer.invoke('agent:answer', { id, reply }),
  listRuns: () => ipcRenderer.invoke('runs:list'),
  getRun: (id) => ipcRenderer.invoke('runs:get', id),
  deleteRun: (id) => ipcRenderer.invoke('runs:delete', id),
  onStep: on('agent:step'),
  onAsk: on('agent:ask'),
  onEnd: on('agent:end'),
  onUrl: on('agent:url'),
  onBlocked: on('agent:blocked'),
  onStopping: on('agent:stopping'),
});
