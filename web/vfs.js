// A tiny file store in the browser's IndexedDB, standing in for the campaign folders on disk.
// Every file is one record keyed by its path ("D&D Campaigns/Pallimustus/pages/home.md"); folders are implied.

const DB_NAME = 'dnd-campaign-manager';
const STORE = 'files';
let dbPromise = null;

function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('This browser blocked saving. Campaigns need site storage turned on.'));
    });
  }
  return dbPromise;
}

function tx(mode, fn) {
  return db().then(d => new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let out;
    Promise.resolve(fn(store)).then(v => { out = v; });
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Saving was cancelled by the browser.'));
  }));
}

const wrap = req => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });

/** Every key under a folder (prefix with no trailing slash). */
function rangeOf(dir) {
  const p = dir.replace(/\/+$/, '') + '/';
  return IDBKeyRange.bound(p, p + '￿');
}

export const join = (...parts) => parts.filter(Boolean).join('/').replace(/\/+/g, '/');
export const basename = p => p.split('/').pop();

export async function read(file) {
  const v = await tx('readonly', s => wrap(s.get(file)));
  if (v === undefined) throw new Error(`File not found: ${basename(file)}`);
  return v;
}
export async function readText(file) {
  const v = await read(file);
  return typeof v === 'string' ? v : new TextDecoder().decode(v);
}
export const write = (file, data) => tx('readwrite', s => wrap(s.put(data, file)));
export const exists = async file => (await tx('readonly', s => wrap(s.count(file)))) > 0;
export const remove = file => tx('readwrite', s => wrap(s.delete(file)));
export const removeDir = dir => tx('readwrite', s => wrap(s.delete(rangeOf(dir))));

/** All file paths under a folder, at any depth. */
export const listAll = dir => tx('readonly', s => wrap(s.getAllKeys(rangeOf(dir))));

/** The names directly inside a folder: files and sub-folders, like readdir. */
export async function readdir(dir) {
  const base = dir.replace(/\/+$/, '') + '/';
  const names = new Set();
  for (const k of await listAll(dir)) names.add(k.slice(base.length).split('/')[0]);
  return [...names];
}

export async function rename(from, to) {
  const v = await read(from);
  await tx('readwrite', s => { s.put(v, to); s.delete(from); });
}

/** Moves every file under one folder to another. */
export async function renameDir(from, to) {
  const keys = await listAll(from);
  const vals = await tx('readonly', s => Promise.all(keys.map(k => wrap(s.get(k)))));
  await tx('readwrite', s => keys.forEach((k, i) => { s.put(vals[i], to + k.slice(from.length)); s.delete(k); }));
}

/** Writes many files in one go: { path: data }. */
export const writeMany = files => tx('readwrite', s => { for (const [k, v] of Object.entries(files)) s.put(v, k); });
