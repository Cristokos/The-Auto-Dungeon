// The browser version of the desktop app's main process (src/main.js): the same window.api the renderer calls,
// with campaigns kept in IndexedDB instead of folders on disk, and file dialogs turned into downloads and file pickers.
// The upgrade and backup logic follows main.js line for line, so a campaign behaves the same in both.
import * as yaml from 'js-yaml';
import STARTER from './starter.gen.js';
import * as fs from './vfs.js';
import { fillSheet } from '../src/sheetpdf.js';
import pkg from '../package.json';

const { join, basename } = fs;
const ROOT = 'D&D Campaigns';
const STARTER_NAME = 'Pallimustus';
const SETTINGS_KEY = 'dnd-last-campaign';

let current = null; // path of the open campaign, like "D&D Campaigns/Pallimustus"
const imageUrls = new Map(); // "images/x.png" → blob: URL, for the open campaign

// ---------- helpers ----------

function inside(base, rel) {
  const parts = [];
  for (const part of String(rel).split(/[\\/]+/)) {
    if (!part || part === '.') continue;
    if (part === '..') { if (!parts.length) throw new Error('Path escapes campaign folder'); parts.pop(); }
    else parts.push(part);
  }
  return join(base, ...parts);
}

function requireCampaign() {
  if (!current) throw new Error('No campaign open');
  return current;
}

function slugify(text) {
  return String(text || 'untitled')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'untitled';
}

function parsePage(id, raw) {
  let meta = {};
  let body = raw;
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (m) {
    try { meta = yaml.load(m[1]) || {}; } catch (e) { meta = { parseError: String(e.message) }; }
    if (typeof meta !== 'object' || Array.isArray(meta)) meta = {};
    body = raw.slice(m[0].length);
  }
  for (const [k, v] of Object.entries(meta)) if (v instanceof Date && !isNaN(v)) meta[k] = v.toISOString().replace(/T00:00:00\.000Z$/, '');
  if (meta.title != null && meta.title !== '') meta.title = String(meta.title);
  if (!meta.title) meta.title = id;
  if (!meta.type) meta.type = 'lore';
  return { id, meta, body };
}

function serializePage(meta, body) {
  const clean = {};
  for (const [k, v] of Object.entries(meta || {})) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    clean[k] = v;
  }
  return '---\n' + yaml.dump(clean, { lineWidth: 120 }) + '---\n\n' + (body || '').replace(/^\n+/, '');
}

const starterFiles = dir => Object.keys(STARTER).filter(k => k.startsWith(dir + '/')).map(k => k.slice(dir.length + 1));
const starterText = rel => { if (!(rel in STARTER)) throw new Error(`No starter file ${rel}`); return STARTER[rel]; };

async function listCampaigns() {
  const out = [];
  for (const name of await fs.readdir(ROOT)) {
    if (name.startsWith('.')) continue;
    if (await fs.exists(join(ROOT, name, 'campaign.json'))) out.push(name);
  }
  return out.sort();
}

async function createCampaign(name, fromStarter) {
  const safe = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim();
  if (!safe) throw new Error('Campaign name is empty');
  const dest = join(ROOT, safe);
  if (await fs.exists(join(dest, 'campaign.json'))) throw new Error(`A campaign called "${safe}" already exists`);
  const files = {};
  for (const [rel, text] of Object.entries(STARTER)) {
    if (rel === 'campaign.json' || rel === 'upgrades.json') continue;
    // A blank campaign still gets the generator lists, which are rules data.
    if (fromStarter || rel.startsWith('data/')) files[join(dest, rel)] = text;
  }
  if (!fromStarter) {
    files[join(dest, 'pages', 'home.md')] = serializePage({ title: 'Home', type: 'lore' }, `# ${safe}\n\nA new campaign. Start adding pages with **New page**.\n`);
  }
  const info = { name: safe, created: new Date().toISOString(), starter: fromStarter ? STARTER_NAME : null };
  files[join(dest, 'campaign.json')] = JSON.stringify(info, null, 2);
  await fs.writeMany(files);
  return safe;
}

const plain = x => x && typeof x === 'object' && !Array.isArray(x);

function replaceText(o, words) {
  if (Array.isArray(o)) { o.forEach((x, i) => { if (typeof x === 'string' && words.has(x)) o[i] = words.get(x); else replaceText(x, words); }); return; }
  if (!plain(o)) return;
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (typeof v === 'string' && words.has(v)) o[k] = words.get(v);
    else replaceText(v, words);
    if (words.has(k) && !(words.get(k) in o)) { o[words.get(k)] = o[k]; delete o[k]; }
  }
}

function addMissing(mine, theirs) {
  for (const [k, v] of Object.entries(theirs)) {
    if (!(k in mine)) { mine[k] = v; continue; }
    const m = mine[k];
    if (plain(m) && plain(v)) addMissing(m, v);
    else if (Array.isArray(m) && Array.isArray(v) && v.length && v.every(x => plain(x) && (x.type || x.name))) {
      const id = x => plain(x) ? x.type || x.name : undefined;
      for (const t of v) {
        const have = m.find(x => id(x) === id(t));
        if (have) addMissing(have, t); else m.push(t);
      }
    }
  }
}

// Generator lists added or extended in a newer version reach older campaigns. See addNewStarterLists in main.js.
async function addNewStarterLists(dir) {
  const dataDir = join(dir, 'data');
  try {
    for (const f of starterFiles('data')) {
      if (f.endsWith('.json') && !(await fs.exists(join(dataDir, f)))) await fs.write(join(dataDir, f), starterText('data/' + f));
    }
    for (const f of starterFiles('data')) {
      if (!f.endsWith('.json') || f === 'words.json') continue;
      let mine;
      try { mine = JSON.parse(await fs.readText(join(dataDir, f))); } catch { continue; }
      if (!plain(mine)) continue;
      const theirs = JSON.parse(starterText('data/' + f));
      if ((mine.version || 1) >= (theirs.version || 1)) continue;
      for (const [v, up] of Object.entries(theirs._upgrades || {})) {
        if (Number(v) <= (mine.version || 1)) continue;
        for (const step of up.set || []) {
          const keys = step.slice(0, -1);
          let at = mine;
          for (const k of keys.slice(0, -1)) {
            if (Array.isArray(at)) at = at.find(x => plain(x) && (x.name || x.type) === k);
            else at = plain(at[k]) || Array.isArray(at[k]) ? at[k] : (at[k] = {});
            if (!at) break;
          }
          if (at && !Array.isArray(at)) at[keys[keys.length - 1]] = step[step.length - 1];
        }
        for (const [k, name] of up.remove || []) if (Array.isArray(mine[k])) mine[k] = mine[k].filter(x => !(plain(x) && (x.name || x.type) === name));
        const listAt = keys => {
          let at = mine;
          for (const k of keys) {
            at = Array.isArray(at) ? at.find(x => plain(x) && (x.name || x.type || x.key) === k) : plain(at) ? at[k] : undefined;
            if (!at) return null;
          }
          return Array.isArray(at) ? at : null;
        };
        for (const step of up.add || []) {
          const at = listAt(step.slice(0, -1));
          if (at) for (const w of step[step.length - 1]) if (!at.includes(w)) at.push(w);
        }
        for (const step of up.drop || []) {
          const at = listAt(step.slice(0, -1));
          if (at) for (const w of step[step.length - 1]) { const i = at.indexOf(w); if (i >= 0) at.splice(i, 1); }
        }
        for (const [k, sources] of up.refresh || []) {
          if (!plain(mine[k]) || !plain(theirs[k])) continue;
          const ours = x => plain(x) && sources.includes(x.source);
          const aliasOf = new Map(Object.entries(theirs[k]).flatMap(([key, x]) => (x.aliases || []).map(a => [a, key])));
          for (const [key, x] of Object.entries(mine[k])) {
            if (!ours(x)) continue;
            if (theirs[k][key]) mine[k][key] = theirs[k][key];
            else if (aliasOf.has(key)) delete mine[k][key];
          }
        }
        if (up.replace?.length) replaceText(mine, new Map(up.replace));
      }
      addMissing(mine, theirs);
      mine.version = theirs.version;
      mine._about = theirs._about;
      await fs.write(join(dataDir, f), JSON.stringify(mine, null, 1));
    }
    const wordsFile = join(dataDir, 'words.json');
    const words = JSON.parse(await fs.readText(wordsFile));
    const starter = JSON.parse(starterText('data/words.json'));
    if ((words.version || 1) < (starter.version || 1)) {
      const merge = (mine, theirs, kind) => {
        const retired = new Set(starter.retired?.[kind] || []);
        if (Array.isArray(mine) || !mine) return theirs;
        const out = { ...mine };
        for (const [g, list] of Object.entries(theirs)) out[g] = [...new Set([...(mine[g] || []).filter(w => !retired.has(w)), ...list])];
        return out;
      };
      await fs.write(wordsFile, JSON.stringify({
        ...words, version: starter.version, _about: starter._about, retired: starter.retired,
        nouns: merge(words.nouns, starter.nouns, 'nouns'), adjectives: merge(words.adjectives, starter.adjectives, 'adjectives'),
        slots: starter.slots, hooks: starter.hooks,
      }, null, 1));
    }
  } catch (e) {
    console.error('Could not add new generator lists:', e);
  }
}

async function pageBodyHash(raw) {
  const text = parsePage('', raw).body.replace(/^\n+/, '').trimEnd();
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Wiki pages added to the starter in a newer version reach campaigns made from it. See addNewStarterPages in main.js.
async function addNewStarterPages(dir) {
  try {
    const infoFile = join(dir, 'campaign.json');
    const info = JSON.parse(await fs.readText(infoFile));
    const classPagesOnly = !info.starter;
    const upgrades = 'upgrades.json' in STARTER ? JSON.parse(STARTER['upgrades.json']) : {};
    const seen = new Set(info.starterPages || []);
    const trashed = new Set((await fs.readdir(join(dir, '.trash'))).map(f => f.replace(/-\d+\.md$/, '')));
    for (const [id, hashes] of Object.entries(classPagesOnly ? {} : upgrades.retired || {})) {
      const file = join(dir, 'pages', id + '.md');
      if (!(await fs.exists(file)) || !hashes.includes(await pageBodyHash(await fs.readText(file)))) continue;
      await fs.rename(file, join(dir, '.trash', `${id}-${Date.now()}.md`));
    }
    const metaDone = new Set(info.metaUpgrades || []);
    for (const [id, fields] of Object.entries(classPagesOnly ? {} : upgrades.meta || {})) {
      const file = join(dir, 'pages', id.split('#')[0] + '.md');
      const key = `${id}:${Object.keys(fields).join(',')}`;
      if (metaDone.has(key)) continue;
      metaDone.add(key);
      if (!(await fs.exists(file))) continue;
      const page = parsePage(id.split('#')[0], await fs.readText(file));
      const add = Object.fromEntries(Object.entries(fields).filter(([k]) => page.meta[k] === undefined));
      if (Object.keys(add).length) await fs.write(file, serializePage({ ...page.meta, ...add }, page.body));
    }
    info.metaUpgrades = [...metaDone].sort();
    for (const f of starterFiles('pages')) {
      if (!f.endsWith('.md')) continue;
      const id = f.slice(0, -3);
      const src = starterText('pages/' + f);
      if (classPagesOnly && f !== 'classes.md' && !/^tags:.*"class"/m.test(src)) continue;
      const dest = join(dir, 'pages', f);
      if (await fs.exists(dest)) {
        const old = upgrades.pages?.[id] || [];
        if (old.includes(await pageBodyHash(await fs.readText(dest)))) await fs.write(dest, src);
      } else if (!seen.has(id) && !trashed.has(id)) {
        await fs.write(dest, src);
      }
      seen.add(id);
    }
    info.starterPages = [...seen].sort();
    await fs.write(infoFile, JSON.stringify(info, null, 2));
  } catch (e) {
    console.error('Could not add new starter pages:', e);
  }
}

const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif' };
const extOf = name => (String(name).match(/\.([^./]+)$/)?.[1] || '').toLowerCase();

function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (Array.isArray(data)) return Uint8Array.from(data);
  if (typeof data === 'string') return new TextEncoder().encode(data);
  return new Uint8Array(0);
}

function cacheImage(rel, data) {
  const old = imageUrls.get(rel);
  if (old) URL.revokeObjectURL(old);
  imageUrls.set(rel, URL.createObjectURL(new Blob([toBytes(data)], { type: IMAGE_TYPES[extOf(rel)] || 'application/octet-stream' })));
}

async function loadImages(dir) {
  for (const u of imageUrls.values()) URL.revokeObjectURL(u);
  imageUrls.clear();
  for (const file of await fs.listAll(join(dir, 'images'))) {
    if (basename(file) === '.keep') continue;
    cacheImage(file.slice(dir.length + 1), await fs.read(file));
  }
}

async function openCampaign(name) {
  const dir = join(ROOT, name);
  if (!(await fs.exists(join(dir, 'campaign.json')))) throw new Error(`No campaign called "${name}"`);
  current = dir;
  await addNewStarterLists(dir);
  await addNewStarterPages(dir);
  await loadImages(dir);
  try { localStorage.setItem(SETTINGS_KEY, name); } catch {}
  return { name, path: dir };
}

async function ensureFirstRun() {
  const list = await listCampaigns();
  if (list.length === 0) return createCampaign(STARTER_NAME, true);
  let last = null;
  try { last = localStorage.getItem(SETTINGS_KEY); } catch {}
  if (last && list.includes(last)) return last;
  return list[0];
}

// ---------- downloads and file pickers ----------

function download(name, data, type = 'application/octet-stream') {
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return name;
}

/** Opens the browser's file picker. Resolves to the chosen File, or null if the person cancels. */
function pickFile(accept) {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    if (accept) input.accept = accept;
    input.style.display = 'none';
    let done = false;
    const finish = f => { if (done) return; done = true; input.remove(); resolve(f); };
    input.addEventListener('change', () => finish(input.files?.[0] || null));
    input.addEventListener('cancel', () => finish(null));
    document.body.appendChild(input);
    input.click();
  });
}

const safeName = name => String(name || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/^\.+/, '').trim();

async function gzip(bytes) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
}
async function gunzip(bytes) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
}
function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const fromBase64 = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));

// ---------- the api ----------

const BACKUP_FORMAT = 'dnd-campaign-manager/campaigns';
const TRASH_DAYS = 30;
const trashDir = () => join(requireCampaign(), '.trash');
let pendingImport = null;

const ready = (async () => {
  const name = await ensureFirstRun();
  await openCampaign(name);
})();

// Every call waits for the first campaign to open, and hands back its own copy of the result, as IPC did.
const call = fn => async (...args) => { await ready; return fn(...args); };
const wrapAll = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'function' ? call(v) : wrapAll(v)]));

const battle = new BroadcastChannel('dnd-battle');
let lastSnapshot = null;
battle.onmessage = e => { if (e.data?.type === 'ready' && lastSnapshot) battle.postMessage({ type: 'update', snap: lastSnapshot }); };

window.api = {
  ...wrapAll({
    campaigns: {
      list: listCampaigns,
      current: async () => current ? { name: basename(current), path: current } : null,
      open: openCampaign,
      create: async (name, fromStarter) => openCampaign(await createCampaign(name, fromStarter)),
      reveal: async () => { throw new Error('In the browser, campaigns live in site storage. Use Export backup to save a copy.'); },
      exportBackup: async (names) => {
        const list = names?.length ? names : await listCampaigns();
        const day = new Date().toISOString().slice(0, 10);
        const suggested = list.length === 1 ? `${list[0]} ${day}.dndcampaign` : `D&D Campaigns ${day}.dndcampaign`;
        const bundle = { format: BACKUP_FORMAT, version: 1, app: pkg.version, exported: new Date().toISOString(), campaigns: [] };
        let count = 0;
        for (const name of list) {
          const dir = join(ROOT, name);
          const files = {};
          for (const file of await fs.listAll(dir)) { files[file.slice(dir.length + 1)] = toBase64(toBytes(await fs.read(file))); count++; }
          bundle.campaigns.push({ name, files });
        }
        download(suggested, await gzip(new TextEncoder().encode(JSON.stringify(bundle))), 'application/gzip');
        return { path: suggested, campaigns: list, files: count };
      },
      importRead: async () => {
        const f = await pickFile('.dndcampaign');
        if (!f) return null;
        let raw = new Uint8Array(await f.arrayBuffer());
        let bundle;
        try {
          if (raw[0] === 0x1f && raw[1] === 0x8b) raw = await gunzip(raw);
          bundle = JSON.parse(new TextDecoder().decode(raw));
        } catch { throw new Error("That file isn't a campaign backup from this app."); }
        if (bundle?.format !== BACKUP_FORMAT || !Array.isArray(bundle.campaigns)) throw new Error("That file isn't a campaign backup from this app.");
        if (bundle.version > 1) throw new Error('That backup was made by a newer version of the app. Update the app to import it.');
        const have = await listCampaigns();
        const campaigns = bundle.campaigns.filter(c => safeName(c.name) && c.files?.['campaign.json']);
        if (!campaigns.length) throw new Error('That backup has no campaigns in it.');
        pendingImport = campaigns;
        return {
          file: f.name, exported: bundle.exported,
          campaigns: campaigns.map(c => ({
            name: safeName(c.name), exists: have.includes(safeName(c.name)),
            pages: Object.keys(c.files).filter(x => /^pages\/[^/]+\.md$/.test(x)).length,
            images: Object.keys(c.files).filter(x => x.startsWith('images/')).length,
          })),
        };
      },
      importApply: async (choices = {}) => {
        if (!pendingImport) throw new Error('Choose a backup file first.');
        const have = await listCampaigns();
        const done = [];
        for (const c of pendingImport) {
          const name = safeName(c.name);
          const choice = have.includes(name) ? choices[name] || 'copy' : 'new';
          if (choice === 'skip') continue;
          let target = name;
          if (choice === 'copy') for (let i = 1; have.includes(target) || await fs.exists(join(ROOT, target, 'campaign.json')); i++) target = `${name} (imported${i > 1 ? ` ${i}` : ''})`;
          const dest = join(ROOT, target);
          const files = {};
          for (const [rel, data] of Object.entries(c.files)) {
            const bytes = fromBase64(String(data));
            files[inside(dest, rel)] = /\.(md|json)$/.test(rel) ? new TextDecoder().decode(bytes) : bytes;
          }
          // The campaign being replaced is kept, not deleted, in case it was the wrong one.
          if (choice === 'replace') await fs.renameDir(dest, join(ROOT, '.replaced', `${name} ${new Date().toISOString().replace(/[:.]/g, '-')}`));
          await fs.writeMany(files);
          done.push(target);
        }
        pendingImport = null;
        if (current && done.includes(basename(current))) await openCampaign(basename(current));
        return done;
      },
    },
    pages: {
      list: async () => {
        const dir = join(requireCampaign(), 'pages');
        const out = [];
        for (const f of await fs.listAll(dir)) {
          const name = f.slice(dir.length + 1);
          if (name.includes('/') || !name.endsWith('.md')) continue;
          out.push(parsePage(name.slice(0, -3), await fs.readText(f)));
        }
        return out;
      },
      read: async (id) => parsePage(id, await fs.readText(inside(join(requireCampaign(), 'pages'), id + '.md'))),
      write: async (id, meta, body) => { await fs.write(inside(join(requireCampaign(), 'pages'), id + '.md'), serializePage(meta, body)); return true; },
      create: async (title, meta, body) => {
        const dir = join(requireCampaign(), 'pages');
        const base = slugify(title);
        const binned = new Set((await fs.readdir(trashDir())).map(f => f.replace(/-\d{10,}\.md$/, '')));
        let id = base;
        for (let i = 2; binned.has(id) || await fs.exists(join(dir, id + '.md')); i++) id = `${base}-${i}`;
        await fs.write(inside(dir, id + '.md'), serializePage({ ...meta, title }, body || ''));
        return id;
      },
      delete: async (id) => {
        await fs.rename(inside(join(requireCampaign(), 'pages'), id + '.md'), join(trashDir(), `${id}-${Date.now()}.md`));
        return true;
      },
    },
    trash: {
      list: async () => {
        const dir = trashDir();
        const out = [];
        for (const f of (await fs.readdir(dir)).filter(x => x.endsWith('.md'))) {
          const m = f.match(/^(.+)-(\d{10,})\.md$/);
          const deleted = m ? Number(m[2]) : Date.now();
          if (Date.now() - deleted > TRASH_DAYS * 864e5) { await fs.remove(join(dir, f)); continue; }
          try {
            const page = parsePage(m ? m[1] : f.slice(0, -3), await fs.readText(join(dir, f)));
            out.push({ file: f, id: page.id, title: page.meta.title || page.id, type: page.meta.type || '', deleted });
          } catch {}
        }
        return out.sort((a, b) => b.deleted - a.deleted);
      },
      restore: async (file) => {
        const pages = join(requireCampaign(), 'pages');
        const base = (file.match(/^(.+)-\d{10,}\.md$/) || [, file.slice(0, -3)])[1];
        let id = base;
        for (let i = 2; await fs.exists(join(pages, id + '.md')); i++) id = `${base}-${i}`;
        await fs.rename(inside(trashDir(), file), inside(pages, id + '.md'));
        return id;
      },
      delete: async (file) => { await fs.remove(inside(trashDir(), file)); return true; },
      empty: async () => { await fs.removeDir(trashDir()); return true; },
    },
    images: {
      save: async (fileName, bytes) => {
        const dir = join(requireCampaign(), 'images');
        const ext = '.' + (extOf(fileName) || 'png');
        if (!IMAGE_TYPES[ext.slice(1)]) throw new Error('Not an image file');
        const base = slugify(basename(fileName).replace(/\.[^.]+$/, ''));
        let name = base + ext;
        for (let i = 2; await fs.exists(join(dir, name)); i++) name = `${base}-${i}${ext}`;
        const data = toBytes(bytes);
        await fs.write(inside(dir, name), data);
        cacheImage('images/' + name, data);
        return 'images/' + name;
      },
      read: async (rel) => ({ name: basename(rel), data: toBase64(toBytes(await fs.read(inside(requireCampaign(), rel)))) }),
    },
    data: {
      read: async (name) => JSON.parse(await fs.readText(inside(join(requireCampaign(), 'data'), name + '.json'))),
      list: async () => (await fs.readdir(join(requireCampaign(), 'data'))).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).sort(),
      readRaw: async (name) => fs.readText(inside(join(requireCampaign(), 'data'), name + '.json')),
      writeRaw: async (name, text) => { JSON.parse(text); await fs.write(inside(join(requireCampaign(), 'data'), name + '.json'), text); return true; },
      resetFromStarter: async (name) => {
        const text = starterText(`data/${name}.json`);
        await fs.write(inside(join(requireCampaign(), 'data'), name + '.json'), text);
        return text;
      },
    },
    saved: {
      read: async () => {
        const file = join(requireCampaign(), 'hooks.json');
        return (await fs.exists(file)) ? JSON.parse(await fs.readText(file)) : { hooks: [] };
      },
      write: async (saved) => { await fs.write(join(requireCampaign(), 'hooks.json'), JSON.stringify(saved, null, 1)); return true; },
    },
    rolls: {
      read: async () => {
        const file = join(requireCampaign(), 'rolls.json');
        try { return JSON.parse(await fs.readText(file)); } catch { return { history: {}, kept: [] }; }
      },
      write: async (rolls) => { await fs.write(join(requireCampaign(), 'rolls.json'), JSON.stringify(rolls)); return true; },
    },
    exportMarkdown: async (name, text) => { download(name, text, 'text/markdown'); return true; },
    tourAllowed: async () => true,
    files: {
      saveText: async (name, text) => download(name, text, 'text/plain'),
      openText: async (kind) => {
        const f = await pickFile(kind?.ext ? '.' + kind.ext : undefined);
        return f ? { name: f.name, text: await f.text() } : null;
      },
      saveImage: async (name, bytes) => download(safeName(name) || 'map.png', toBytes(bytes), 'image/png'),
      // The browser's own print dialog turns the handouts into a PDF (or prints them).
      savePdf: async (name, html) => {
        const frame = document.createElement('iframe');
        frame.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
        document.body.appendChild(frame);
        frame.srcdoc = html.replace(/<title>[^<]*<\/title>|(<head[^>]*>)/i, (m, head) => (head || '') + `<title>${safeName(name).replace(/\.pdf$/i, '')}</title>`);
        await new Promise(r => { frame.onload = r; });
        frame.contentWindow.print();
        setTimeout(() => frame.remove(), 60_000);
        return name;
      },
      saveSheetPdf: async (name, fields, imageRel) => {
        let image = null;
        if (imageRel && /\.(png|jpe?g)$/i.test(imageRel)) {
          try { image = { bytes: toBytes(await fs.read(inside(requireCampaign(), imageRel))), type: /\.png$/i.test(imageRel) ? 'png' : 'jpg' }; } catch { image = null; }
        }
        return download(safeName(name) || 'character sheet.pdf', await fillSheet(fields, image), 'application/pdf');
      },
    },
  }),
  // The battle's player view is another tab of this page, kept up to date over a BroadcastChannel.
  battle: {
    openPlayerView: async () => { window.open(location.pathname + '?view=player', 'dnd-player-view', 'width=900,height=700'); return true; },
    publish: (snap) => { lastSnapshot = snap; battle.postMessage({ type: 'update', snap }); },
    onUpdate: (cb) => battle.addEventListener('message', e => { if (e.data?.type === 'update') cb(e.data.snap); }),
    ready: () => battle.postMessage({ type: 'ready' }),
  },
  /** Where an image saved in the campaign can be shown from. */
  imageUrl: rel => imageUrls.get(rel) || '',
};
