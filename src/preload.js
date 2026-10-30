const { contextBridge, ipcRenderer } = require('electron');

async function call(channel, ...args) {
  const res = await ipcRenderer.invoke(channel, ...args);
  if (!res.ok) throw new Error(res.error);
  return res.value;
}

contextBridge.exposeInMainWorld('api', {
  campaigns: {
    list: () => call('campaign:list'),
    current: () => call('campaign:current'),
    open: (name) => call('campaign:open', name),
    create: (name, fromStarter) => call('campaign:create', name, fromStarter),
    reveal: () => call('campaign:reveal'),
    exportBackup: (names) => call('campaign:export', names),
    importRead: () => call('campaign:importRead'),
    importApply: (choices) => call('campaign:importApply', choices),
  },
  pages: {
    list: () => call('pages:list'),
    read: (id) => call('pages:read', id),
    write: (id, meta, body) => call('pages:write', id, meta, body),
    create: (title, meta, body) => call('pages:create', title, meta, body),
    delete: (id) => call('pages:delete', id),
  },
  trash: {
    list: () => call('trash:list'),
    restore: (file) => call('trash:restore', file),
    delete: (file) => call('trash:delete', file),
    empty: () => call('trash:empty'),
  },
  images: {
    save: (fileName, bytes) => call('images:save', fileName, bytes),
    read: (rel) => call('images:read', rel),
  },
  data: {
    read: (name) => call('data:read', name),
    list: () => call('data:list'),
    readRaw: (name) => call('data:readRaw', name),
    writeRaw: (name, text) => call('data:writeRaw', name, text),
    resetFromStarter: (name) => call('data:resetFromStarter', name),
  },
  saved: {
    read: () => call('saved:read'),
    write: (saved) => call('saved:write', saved),
  },
  rolls: {
    read: () => call('rolls:read'),
    write: (rolls) => call('rolls:write', rolls),
  },
  battle: {
    openPlayerView: () => call('window:player'),
    publish: (snap) => ipcRenderer.send('battle:publish', snap),
    onUpdate: (cb) => ipcRenderer.on('battle:update', (_e, snap) => cb(snap)),
    ready: () => ipcRenderer.send('battle:ready'),
  },
  exportMarkdown: (name, text) => call('export:markdown', name, text),
  tourAllowed: () => call('app:tourAllowed'),
  files: {
    saveText: (name, text, kind) => call('file:saveText', name, text, kind),
    openText: (kind) => call('file:openText', kind),
    saveImage: (name, bytes) => call('file:saveImage', name, bytes),
    savePdf: (name, html) => call('file:savePdf', name, html),
    saveSheetPdf: (name, fields, image) => call('file:saveSheetPdf', name, fields, image),
  },
});
