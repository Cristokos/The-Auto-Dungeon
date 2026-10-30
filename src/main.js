// Electron main process: owns the campaign folders on disk and exposes a
// small, path-checked file API to the renderer over IPC.
const { app, BrowserWindow, ipcMain, protocol, net, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { pathToFileURL } = require('url');
const crypto = require('crypto');
const yaml = require('js-yaml');
const { fillSheet } = require('./sheetpdf');
const zlib = require('zlib');
const { promisify } = require('util');
const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

protocol.registerSchemesAsPrivileged([
  { scheme: 'campaign', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

const STARTER_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'starter')
  : path.join(__dirname, '..', 'starter');
const STARTER_NAME = 'Pallimustus';
const OLD_STARTER_NAME = 'Pallimustus Day One';

let campaignsRoot;
let settingsFile;
let settings = { lastCampaign: null };
let current = null; // absolute path of the open campaign

// ---------- helpers ----------

function inside(base, rel) {
  const full = path.resolve(base, rel);
  if (full !== base && !full.startsWith(base + path.sep)) throw new Error('Path escapes campaign folder');
  return full;
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
  // A date typed by hand ("date: 2026-10-18") stays as written, and a title YAML reads as a number ("title: 1984") is still text.
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

async function copyDir(src, dest) {
  await fsp.mkdir(dest, { recursive: true });
  for (const entry of await fsp.readdir(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) await copyDir(s, d);
    else await fsp.copyFile(s, d);
  }
}

async function exists(p) {
  try { await fsp.access(p); return true; } catch { return false; }
}

async function saveSettings() {
  await fsp.writeFile(settingsFile, JSON.stringify(settings, null, 2));
}

async function listCampaigns() {
  await fsp.mkdir(campaignsRoot, { recursive: true });
  const out = [];
  for (const e of await fsp.readdir(campaignsRoot, { withFileTypes: true })) {
    if (e.isDirectory() && await exists(path.join(campaignsRoot, e.name, 'campaign.json'))) out.push(e.name);
  }
  return out.sort();
}

async function createCampaign(name, fromStarter) {
  const safe = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim();
  if (!safe) throw new Error('Campaign name is empty');
  const dest = path.join(campaignsRoot, safe);
  if (await exists(dest)) throw new Error(`A campaign called "${safe}" already exists`);
  if (fromStarter) {
    await copyDir(STARTER_DIR, dest);
  } else {
    // A blank campaign still gets the generator lists, which are rules data.
    await fsp.mkdir(path.join(dest, 'pages'), { recursive: true });
    await fsp.mkdir(path.join(dest, 'images'), { recursive: true });
    await copyDir(path.join(STARTER_DIR, 'data'), path.join(dest, 'data'));
    await fsp.writeFile(path.join(dest, 'pages', 'home.md'),
      serializePage({ title: 'Home', type: 'lore' }, `# ${safe}\n\nA new campaign. Start adding pages with **New page**.\n`));
  }
  const info = { name: safe, created: new Date().toISOString(), starter: fromStarter ? STARTER_NAME : null };
  await fsp.writeFile(path.join(dest, 'campaign.json'), JSON.stringify(info, null, 2));
  return safe;
}

const plain = x => x && typeof x === 'object' && !Array.isArray(x);

// Copy in what a newer starter list has and this one lacks: missing keys, and missing entries in lists of
// named things (market stalls, tavern kinds). Lists of plain words are left alone, so words the DM cut stay cut.
/** Swap every string, and every object key, that exactly matches an old wording for its new one. */
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

// Generator lists added in a newer version of the app are copied into older
// campaigns. Lists the campaign already has are never touched.
async function addNewStarterLists(dir) {
  const dataDir = path.join(dir, 'data');
  try {
    await fsp.mkdir(dataDir, { recursive: true });
    for (const f of await fsp.readdir(path.join(STARTER_DIR, 'data'))) {
      if (f.endsWith('.json') && !(await exists(path.join(dataDir, f)))) {
        await fsp.copyFile(path.join(STARTER_DIR, 'data', f), path.join(dataDir, f));
      }
    }
    // Other lists that gained new sections in a newer version get those sections; anything already there is kept.
    for (const f of await fsp.readdir(path.join(STARTER_DIR, 'data'))) {
      if (!f.endsWith('.json') || f === 'words.json') continue;
      // A list broken by hand is left as it is (the app says it can't read it), and the others still upgrade.
      let mine;
      try { mine = JSON.parse(await fsp.readFile(path.join(dataDir, f), 'utf8')); } catch { continue; }
      if (!plain(mine)) continue;
      const theirs = JSON.parse(await fsp.readFile(path.join(STARTER_DIR, 'data', f), 'utf8'));
      if ((mine.version || 1) >= (theirs.version || 1)) continue;
      // Changes a newer version makes to what's already there: values it sets and entries it removes.
      for (const [v, up] of Object.entries(theirs._upgrades || {})) {
        if (Number(v) <= (mine.version || 1)) continue;
        // A key inside a list names an entry by its name, like ["peoples", "Celestine", "weight", 3].
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
        // Words a newer version adds to (or drops from) a list of plain words, like ["peoples", "Elf", "names", "first", ["Aeris"]].
        // Words the DM added stay; a word the DM cut comes back only if it is new in this version.
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
        // A section brought to a new edition, like ["spells", ["SRD", "summary"]]: entries the starter wrote (by their
        // source) take the new version's, and ones it now keeps under another name go; the DM's own entries stay.
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
        // Rewordings: any entry (or key) still exactly as the starter wrote it gets the new words.
        if (up.replace?.length) replaceText(mine, new Map(up.replace));
      }
      addMissing(mine, theirs);
      mine.version = theirs.version;
      mine._about = theirs._about;
      await fsp.writeFile(path.join(dataDir, f), JSON.stringify(mine, null, 1));
    }
    // Older word banks are brought up to the starter's version: new slots and hooks, new words added,
    // retired words dropped. Words the campaign added itself are kept.
    const wordsFile = path.join(dataDir, 'words.json');
    const words = JSON.parse(await fsp.readFile(wordsFile, 'utf8'));
    const starter = JSON.parse(await fsp.readFile(path.join(STARTER_DIR, 'data', 'words.json'), 'utf8'));
    if ((words.version || 1) < (starter.version || 1)) {
      const merge = (mine, theirs, kind) => {
        const retired = new Set(starter.retired?.[kind] || []);
        if (Array.isArray(mine) || !mine) return theirs;
        const out = { ...mine };
        for (const [g, list] of Object.entries(theirs)) {
          out[g] = [...new Set([...(mine[g] || []).filter(w => !retired.has(w)), ...list])];
        }
        return out;
      };
      await fsp.writeFile(wordsFile, JSON.stringify({
        ...words, version: starter.version, _about: starter._about, retired: starter.retired,
        nouns: merge(words.nouns, starter.nouns, 'nouns'), adjectives: merge(words.adjectives, starter.adjectives, 'adjectives'),
        slots: starter.slots, hooks: starter.hooks,
      }, null, 1));
    }
  } catch (e) {
    console.error('Could not add new generator lists:', e);
  }
}

// Wiki pages added to the starter in a newer version reach campaigns made from it. A page the
// campaign already had is replaced only if it was never edited (its text matches an old starter
// version in upgrades.json), and a page the DM deleted is not brought back.
const pageBodyHash = raw => crypto.createHash('sha256')
  .update(parsePage('', raw).body.replace(/^\n+/, '').trimEnd()).digest('hex');

async function addNewStarterPages(dir) {
  try {
    const infoFile = path.join(dir, 'campaign.json');
    const info = JSON.parse(await fsp.readFile(infoFile, 'utf8'));
    // A campaign not made from the starter still gets the class reference pages (Classes and one per class),
    // so the class on a stat block has a page to link to. Nothing else from the starter is added to it.
    const classPagesOnly = !info.starter;
    const upgradesFile = path.join(STARTER_DIR, 'upgrades.json');
    const upgrades = (await exists(upgradesFile)) ? JSON.parse(await fsp.readFile(upgradesFile, 'utf8')) : {};
    const seen = new Set(info.starterPages || []);
    const trashed = new Set((await fsp.readdir(path.join(dir, '.trash')).catch(() => [])).map(f => f.replace(/-\d+\.md$/, '')));
    // Starter pages that were folded into others or replaced by a browser leave the sidebar,
    // unless the DM edited them. They go to .trash, so nothing is lost.
    for (const [id, hashes] of Object.entries(classPagesOnly ? {} : upgrades.retired || {})) {
      const file = path.join(dir, 'pages', id + '.md');
      if (!(await exists(file)) || !hashes.includes(pageBodyHash(await fsp.readFile(file, 'utf8')))) continue;
      await fsp.mkdir(path.join(dir, '.trash'), { recursive: true });
      await fsp.rename(file, path.join(dir, '.trash', `${id}-${Date.now()}.md`));
    }
    // New details on starter pages (like which page one sits under) are added once, and only where the page has none.
    const metaDone = new Set(info.metaUpgrades || []);
    // A key like "page#map" adds more fields to a page that already had an entry.
    for (const [id, fields] of Object.entries(classPagesOnly ? {} : upgrades.meta || {})) {
      const file = path.join(dir, 'pages', id.split('#')[0] + '.md');
      const key = `${id}:${Object.keys(fields).join(',')}`;
      if (metaDone.has(key)) continue;
      metaDone.add(key);
      if (!(await exists(file))) continue;
      const page = parsePage(id.split('#')[0], await fsp.readFile(file, 'utf8'));
      const add = Object.fromEntries(Object.entries(fields).filter(([k]) => page.meta[k] === undefined));
      if (Object.keys(add).length) await fsp.writeFile(file, serializePage({ ...page.meta, ...add }, page.body));
    }
    info.metaUpgrades = [...metaDone].sort();
    for (const f of await fsp.readdir(path.join(STARTER_DIR, 'pages'))) {
      if (!f.endsWith('.md')) continue;
      const id = f.slice(0, -3);
      const src = path.join(STARTER_DIR, 'pages', f);
      if (classPagesOnly && f !== 'classes.md' && !/^tags:.*"class"/m.test(await fsp.readFile(src, 'utf8'))) continue;
      const dest = path.join(dir, 'pages', f);
      if (await exists(dest)) {
        const old = upgrades.pages?.[id] || [];
        if (old.includes(pageBodyHash(await fsp.readFile(dest, 'utf8')))) await fsp.copyFile(src, dest);
      } else if (!seen.has(id) && !trashed.has(id)) {
        await fsp.copyFile(src, dest);
      }
      seen.add(id);
    }
    info.starterPages = [...seen].sort();
    await fsp.writeFile(infoFile, JSON.stringify(info, null, 2));
  } catch (e) {
    console.error('Could not add new starter pages:', e);
  }
}

async function openCampaign(name) {
  const dir = path.join(campaignsRoot, name);
  if (!(await exists(path.join(dir, 'campaign.json')))) throw new Error(`No campaign called "${name}"`);
  current = dir;
  await fsp.mkdir(path.join(dir, 'pages'), { recursive: true });
  await fsp.mkdir(path.join(dir, 'images'), { recursive: true });
  await addNewStarterLists(dir);
  await addNewStarterPages(dir);
  settings.lastCampaign = name;
  await saveSettings();
  return { name, path: dir };
}

// Older versions named the starter campaign "Pallimustus Day One". Its folder takes the plain name once,
// unless a campaign called Pallimustus already exists.
async function renameOldStarter() {
  const from = path.join(campaignsRoot, OLD_STARTER_NAME), to = path.join(campaignsRoot, STARTER_NAME);
  if (!(await exists(path.join(from, 'campaign.json'))) || await exists(to)) return;
  try {
    await fsp.rename(from, to);
    const infoFile = path.join(to, 'campaign.json');
    const info = JSON.parse(await fsp.readFile(infoFile, 'utf8'));
    info.name = STARTER_NAME;
    if (info.starter) info.starter = STARTER_NAME;
    await fsp.writeFile(infoFile, JSON.stringify(info, null, 2));
    if (settings.lastCampaign === OLD_STARTER_NAME) { settings.lastCampaign = STARTER_NAME; await saveSettings(); }
  } catch {}
}

async function ensureFirstRun() {
  await renameOldStarter();
  const list = await listCampaigns();
  if (list.length === 0) {
    const name = await createCampaign(STARTER_NAME, true);
    return name;
  }
  if (settings.lastCampaign && list.includes(settings.lastCampaign)) return settings.lastCampaign;
  return list[0];
}

// ---------- IPC ----------

function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try { return { ok: true, value: await fn(...args) }; }
    catch (err) { return { ok: false, error: err.message || String(err) }; }
  });
}

handle('campaign:list', listCampaigns);
handle('campaign:current', async () => current ? { name: path.basename(current), path: current } : null);
handle('campaign:open', openCampaign);
handle('campaign:create', async (name, fromStarter) => {
  const n = await createCampaign(name, fromStarter);
  return openCampaign(n);
});
handle('campaign:reveal', async () => { await shell.openPath(requireCampaign()); return true; });

handle('pages:list', async () => {
  const dir = path.join(requireCampaign(), 'pages');
  const files = (await fsp.readdir(dir)).filter(f => f.endsWith('.md'));
  const pages = await Promise.all(files.map(async f => {
    const id = f.slice(0, -3);
    return parsePage(id, await fsp.readFile(path.join(dir, f), 'utf8'));
  }));
  return pages;
});

handle('pages:read', async (id) => {
  const file = inside(path.join(requireCampaign(), 'pages'), id + '.md');
  return parsePage(id, await fsp.readFile(file, 'utf8'));
});

handle('pages:write', async (id, meta, body) => {
  const dir = path.join(requireCampaign(), 'pages');
  const file = inside(dir, id + '.md');
  // Each save writes its own temporary file, so two saves of one page close together can't trip over each other.
  const tmp = `${file}.${process.hrtime.bigint()}.tmp`;
  await fsp.writeFile(tmp, serializePage(meta, body));
  await fsp.rename(tmp, file);
  return true;
});

handle('pages:create', async (title, meta, body) => {
  const dir = path.join(requireCampaign(), 'pages');
  const base = slugify(title);
  // A page's id is its own for good: one in the trash keeps it, so a new page with the same title gets another and
  // never inherits the deleted page's history in the story engine.
  const trash = path.join(requireCampaign(), '.trash');
  const binned = new Set((await exists(trash) ? await fsp.readdir(trash) : []).map(f => f.replace(/-\d{10,}\.md$/, '')));
  let id = base;
  for (let i = 2; binned.has(id) || await exists(path.join(dir, id + '.md')); i++) id = `${base}-${i}`;
  await fsp.writeFile(inside(dir, id + '.md'), serializePage({ ...meta, title }, body || ''));
  return id;
});

handle('pages:delete', async (id) => {
  const file = inside(path.join(requireCampaign(), 'pages'), id + '.md');
  // Deleted pages go to a trash folder inside the campaign rather than vanishing.
  const trash = path.join(requireCampaign(), '.trash');
  await fsp.mkdir(trash, { recursive: true });
  await fsp.rename(file, path.join(trash, `${id}-${Date.now()}.md`));
  return true;
});

// The trash keeps deleted pages for 30 days. Files are named <page id>-<time deleted>.md.
const TRASH_DAYS = 30;
const trashDir = () => path.join(requireCampaign(), '.trash');
handle('trash:list', async () => {
  const dir = trashDir();
  if (!(await exists(dir))) return [];
  const out = [];
  for (const f of (await fsp.readdir(dir)).filter(x => x.endsWith('.md'))) {
    const m = f.match(/^(.+)-(\d{10,})\.md$/);
    const deleted = m ? Number(m[2]) : (await fsp.stat(path.join(dir, f))).mtimeMs;
    if (Date.now() - deleted > TRASH_DAYS * 864e5) { await fsp.rm(path.join(dir, f), { force: true }); continue; }
    try {
      const page = parsePage(m ? m[1] : f.slice(0, -3), await fsp.readFile(path.join(dir, f), 'utf8'));
      out.push({ file: f, id: page.id, title: page.meta.title || page.id, type: page.meta.type || '', deleted });
    } catch {}
  }
  return out.sort((a, b) => b.deleted - a.deleted);
});
handle('trash:restore', async (file) => {
  const from = inside(trashDir(), file);
  const pages = path.join(requireCampaign(), 'pages');
  const base = (file.match(/^(.+)-\d{10,}\.md$/) || [, file.slice(0, -3)])[1];
  let id = base;
  for (let i = 2; await exists(path.join(pages, id + '.md')); i++) id = `${base}-${i}`;
  await fsp.rename(from, inside(pages, id + '.md'));
  return id;
});
handle('trash:delete', async (file) => { await fsp.rm(inside(trashDir(), file), { force: true }); return true; });
handle('trash:empty', async () => { await fsp.rm(trashDir(), { recursive: true, force: true }); return true; });

handle('images:save', async (fileName, bytes) => {
  const dir = path.join(requireCampaign(), 'images');
  const ext = (path.extname(fileName) || '.png').toLowerCase();
  if (!['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.avif'].includes(ext)) throw new Error('Not an image file');
  const base = slugify(path.basename(fileName, path.extname(fileName)));
  let name = base + ext;
  for (let i = 2; await exists(path.join(dir, name)); i++) name = `${base}-${i}${ext}`;
  await fsp.writeFile(inside(dir, name), Buffer.from(bytes));
  return 'images/' + name;
});

handle('data:read', async (name) => {
  const file = inside(path.join(requireCampaign(), 'data'), name + '.json');
  return JSON.parse(await fsp.readFile(file, 'utf8'));
});

handle('data:list', async () => {
  const dir = path.join(requireCampaign(), 'data');
  return (await fsp.readdir(dir)).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).sort();
});

handle('data:readRaw', async (name) => {
  return fsp.readFile(inside(path.join(requireCampaign(), 'data'), name + '.json'), 'utf8');
});

handle('data:writeRaw', async (name, text) => {
  JSON.parse(text); // refuse to save broken JSON
  await fsp.writeFile(inside(path.join(requireCampaign(), 'data'), name + '.json'), text);
  return true;
});

handle('data:resetFromStarter', async (name) => {
  const src = inside(path.join(STARTER_DIR, 'data'), name + '.json');
  const text = await fsp.readFile(src, 'utf8');
  await fsp.writeFile(inside(path.join(requireCampaign(), 'data'), name + '.json'), text);
  return text;
});

// Saved story hooks live beside the pages, in hooks.json, so they aren't mistaken for a generator list.
// The welcome tour shows once per computer. Runs with their own campaigns folder (the tests) skip it unless SHOW_TOUR is set.
handle('app:tourAllowed', async () => !process.env.CAMPAIGNS_HOME || process.env.SHOW_TOUR === '1');

handle('saved:read', async () => {
  const file = path.join(requireCampaign(), 'hooks.json');
  if (!(await exists(file))) return { hooks: [] };
  return JSON.parse(await fsp.readFile(file, 'utf8'));
});

handle('saved:write', async (saved) => {
  const file = path.join(requireCampaign(), 'hooks.json');
  const tmp = `${file}.${process.hrtime.bigint()}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(saved, null, 1));
  await fsp.rename(tmp, file);
  return true;
});

// Generator results (each tab's recent rolls and the ones kept for later) live in rolls.json, apart from hooks.json,
// so the big ones (astral spaces) aren't rewritten every time the world moves.
handle('rolls:read', async () => {
  const file = path.join(requireCampaign(), 'rolls.json');
  if (!(await exists(file))) return { history: {}, kept: [] };
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch { return { history: {}, kept: [] }; }
});

handle('rolls:write', async (rolls) => {
  const file = path.join(requireCampaign(), 'rolls.json');
  const tmp = `${file}.${process.hrtime.bigint()}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(rolls));
  await fsp.rename(tmp, file);
  return true;
});

handle('export:markdown', async (suggestedName, text) => {
  const { canceled, filePath } = await dialog.showSaveDialog({ defaultPath: suggestedName });
  if (canceled || !filePath) return false;
  await fsp.writeFile(filePath, text);
  return true;
});

// ---------- sharing: sheet files and campaign backups ----------
// A campaign backup is one gzipped JSON file holding every file in one or more campaign folders,
// so a whole campaign moves to another computer with Export and Import, no folder copying.

const BACKUP_FORMAT = 'dnd-campaign-manager/campaigns';

async function campaignFiles(dir, rel = '') {
  const out = [];
  for (const e of await fsp.readdir(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...await campaignFiles(dir, r));
    else if (e.isFile() && !e.name.endsWith('.tmp')) out.push(r);
  }
  return out;
}

const safeName = name => String(name || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/^\.+/, '').trim();

let pendingImport = null;

handle('file:saveText', async (suggestedName, text, kind) => {
  const filters = kind ? [{ name: kind.name, extensions: [kind.ext] }] : undefined;
  const { canceled, filePath } = await dialog.showSaveDialog({ defaultPath: path.join(app.getPath('documents'), suggestedName), filters });
  if (canceled || !filePath) return null;
  await fsp.writeFile(filePath, text);
  return filePath;
});

handle('file:saveImage', async (suggestedName, bytes) => {
  const { canceled, filePath } = await dialog.showSaveDialog({ defaultPath: path.join(app.getPath('documents'), safeName(suggestedName) || 'map.png'), filters: [{ name: 'PNG image', extensions: ['png'] }] });
  if (canceled || !filePath) return null;
  await fsp.writeFile(filePath, Buffer.from(bytes));
  return filePath;
});

// Prints a page of HTML to a PDF the user picks, then opens it so they can print it.
handle('file:savePdf', async (suggestedName, html) => {
  const { canceled, filePath } = await dialog.showSaveDialog({ defaultPath: path.join(app.getPath('documents'), safeName(suggestedName) || 'handouts.pdf'), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (canceled || !filePath) return null;
  const win = new BrowserWindow({ show: false, webPreferences: { javascript: false } });
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    const pdf = await win.webContents.printToPDF({ pageSize: 'A4', margins: { marginType: 'default' }, printBackground: true });
    await fsp.writeFile(filePath, pdf);
  } finally { win.destroy(); }
  shell.openPath(filePath);
  return filePath;
});

// A character's numbers filled into the fillable 5e character sheet, saved where the user picks, then opened.
// A PNG or JPEG portrait goes in the sheet's picture box.
handle('file:saveSheetPdf', async (suggestedName, fields, imageRel) => {
  const { canceled, filePath } = await dialog.showSaveDialog({ defaultPath: path.join(app.getPath('documents'), safeName(suggestedName) || 'character sheet.pdf'), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (canceled || !filePath) return null;
  let image = null;
  if (imageRel && /\.(png|jpe?g)$/i.test(imageRel)) {
    try { image = { bytes: await fsp.readFile(inside(requireCampaign(), imageRel)), type: /\.png$/i.test(imageRel) ? 'png' : 'jpg' }; } catch { image = null; }
  }
  await fsp.writeFile(filePath, await fillSheet(fields, image));
  shell.openPath(filePath);
  return filePath;
});

handle('file:openText', async (kind) => {
  const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: kind.name, extensions: [kind.ext] }, { name: 'All files', extensions: ['*'] }] });
  if (canceled || !filePaths?.length) return null;
  return { name: path.basename(filePaths[0]), text: await fsp.readFile(filePaths[0], 'utf8') };
});

handle('images:read', async (rel) => {
  const file = inside(requireCampaign(), rel);
  return { name: path.basename(file), data: (await fsp.readFile(file)).toString('base64') };
});

handle('campaign:export', async (names) => {
  const list = names?.length ? names : await listCampaigns();
  const day = new Date().toISOString().slice(0, 10);
  const suggested = list.length === 1 ? `${list[0]} ${day}.dndcampaign` : `D&D Campaigns ${day}.dndcampaign`;
  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: path.join(app.getPath('documents'), suggested),
    filters: [{ name: 'Campaign backup', extensions: ['dndcampaign'] }],
  });
  if (canceled || !filePath) return null;
  const bundle = { format: BACKUP_FORMAT, version: 1, app: app.getVersion(), exported: new Date().toISOString(), campaigns: [] };
  let count = 0;
  for (const name of list) {
    const dir = path.join(campaignsRoot, name);
    const files = {};
    for (const rel of await campaignFiles(dir)) { files[rel] = (await fsp.readFile(path.join(dir, rel))).toString('base64'); count++; }
    bundle.campaigns.push({ name, files });
  }
  await fsp.writeFile(filePath, await gzip(JSON.stringify(bundle)));
  return { path: filePath, campaigns: list, files: count };
});

// Import happens in two steps: read the file and say what's in it, then write it once the person has
// chosen what to do with any campaign that already exists here.
handle('campaign:importRead', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Campaign backup', extensions: ['dndcampaign'] }, { name: 'All files', extensions: ['*'] }] });
  if (canceled || !filePaths?.length) return null;
  let raw = await fsp.readFile(filePaths[0]);
  let bundle;
  try {
    if (raw[0] === 0x1f && raw[1] === 0x8b) raw = await gunzip(raw);
    bundle = JSON.parse(raw.toString('utf8'));
  } catch { throw new Error("That file isn't a campaign backup from this app."); }
  if (bundle?.format !== BACKUP_FORMAT || !Array.isArray(bundle.campaigns)) throw new Error("That file isn't a campaign backup from this app.");
  if (bundle.version > 1) throw new Error('That backup was made by a newer version of the app. Update the app to import it.');
  const have = await listCampaigns();
  const campaigns = bundle.campaigns.filter(c => safeName(c.name) && c.files?.['campaign.json']);
  if (!campaigns.length) throw new Error('That backup has no campaigns in it.');
  pendingImport = campaigns;
  return {
    file: path.basename(filePaths[0]), exported: bundle.exported,
    campaigns: campaigns.map(c => ({
      name: safeName(c.name), exists: have.includes(safeName(c.name)),
      pages: Object.keys(c.files).filter(f => /^pages\/[^/]+\.md$/.test(f)).length,
      images: Object.keys(c.files).filter(f => f.startsWith('images/')).length,
    })),
  };
});

/** choices: { [name]: 'replace' | 'copy' | 'skip' } for campaigns that already exist here. */
handle('campaign:importApply', async (choices = {}) => {
  if (!pendingImport) throw new Error('Choose a backup file first.');
  const have = await listCampaigns();
  const done = [];
  for (const c of pendingImport) {
    const name = safeName(c.name);
    const choice = have.includes(name) ? choices[name] || 'copy' : 'new';
    if (choice === 'skip') continue;
    let target = name;
    if (choice === 'copy') for (let i = 1; have.includes(target) || await exists(path.join(campaignsRoot, target)); i++) target = `${name} (imported${i > 1 ? ` ${i}` : ''})`;
    const dest = path.join(campaignsRoot, target);
    // Unpack beside the campaigns first, so a bad file never leaves half a campaign behind.
    const staging = path.join(campaignsRoot, '.importing', `${Date.now()}`);
    for (const [rel, data] of Object.entries(c.files)) {
      const file = inside(staging, rel);
      await fsp.mkdir(path.dirname(file), { recursive: true });
      await fsp.writeFile(file, Buffer.from(String(data), 'base64'));
    }
    if (choice === 'replace') {
      // The campaign being replaced is kept, not deleted, in case it was the wrong one.
      const kept = path.join(campaignsRoot, '.replaced', `${name} ${new Date().toISOString().replace(/[:.]/g, '-')}`);
      await fsp.mkdir(path.dirname(kept), { recursive: true });
      await fsp.rename(dest, kept);
    }
    await fsp.rename(staging, dest);
    done.push(target);
  }
  await fsp.rm(path.join(campaignsRoot, '.importing'), { recursive: true, force: true });
  pendingImport = null;
  // A replaced campaign that was open is reopened from its imported files.
  if (current && done.includes(path.basename(current))) await openCampaign(path.basename(current));
  return done;
});

// ---------- window ----------

const webPreferences = () => ({
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
});

// The player view is a second window the DM can drag to a table screen.
// It only ever sees the snapshot the battle screen publishes.
let playerWin = null;
let lastSnapshot = null;

handle('window:player', async () => {
  if (playerWin && !playerWin.isDestroyed()) { playerWin.focus(); return true; }
  playerWin = new BrowserWindow({
    width: 900, height: 700, minWidth: 500, minHeight: 400,
    title: 'Battle - player view',
    backgroundColor: '#15131a',
    autoHideMenuBar: true,
    webPreferences: webPreferences(),
  });
  playerWin.on('closed', () => { playerWin = null; });
  playerWin.loadFile(path.join(__dirname, 'renderer', 'index.html'), { query: { view: 'player' } });
  return true;
});

ipcMain.on('battle:publish', (_e, snap) => {
  lastSnapshot = snap;
  if (playerWin && !playerWin.isDestroyed()) playerWin.webContents.send('battle:update', snap);
});
ipcMain.on('battle:ready', (e) => e.sender.send('battle:update', lastSnapshot));

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'D&D Campaign Manager',
    backgroundColor: '#15131a',
    autoHideMenuBar: true,
    webPreferences: webPreferences(),
  });
  win.on('closed', () => { if (playerWin && !playerWin.isDestroyed()) playerWin.close(); });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // Links to the outside world open in the system browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url, frameName }) => {
    // The dice tray can pop out into a blank window of its own, which the app fills itself.
    if (frameName === 'dice-tray' && (!url || url === 'about:blank')) {
      return { action: 'allow', overrideBrowserWindowOptions: { title: 'Dice', minWidth: 300, minHeight: 300, autoHideMenuBar: true, backgroundColor: '#15131a' } };
    }
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file:')) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); }
  });
}

app.whenReady().then(async () => {
  campaignsRoot = process.env.CAMPAIGNS_HOME || path.join(app.getPath('documents'), 'D&D Campaigns');
  // Version 0.1 kept campaigns under the old app name; carry them over once.
  const oldRoot = path.join(app.getPath('documents'), 'Pallimustus Campaigns');
  if (!process.env.CAMPAIGNS_HOME && !(await exists(campaignsRoot)) && await exists(oldRoot)) {
    try { await fsp.rename(oldRoot, campaignsRoot); } catch {}
  }
  settingsFile = path.join(app.getPath('userData'), 'settings.json');
  try { settings = { ...settings, ...JSON.parse(await fsp.readFile(settingsFile, 'utf8')) }; } catch {}

  // campaign://images/foo.png serves files from the open campaign folder.
  protocol.handle('campaign', (request) => {
    try {
      const url = new URL(request.url);
      const rel = decodeURIComponent(url.hostname + url.pathname);
      const file = inside(requireCampaign(), rel);
      return net.fetch(pathToFileURL(file).toString());
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });

  const name = await ensureFirstRun();
  await openCampaign(name);
  createWindow();
});

app.on('window-all-closed', () => app.quit());
