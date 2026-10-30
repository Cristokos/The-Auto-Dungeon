import { marked } from './vendor/marked.esm.js';
import * as G from './generators.js';
import * as S from './sheet.js';
import WORLD from './worldmap.js';
import * as PL from './places.js';
import * as C from './classopts.js';
import * as CR from './classref.js';
import * as ST from './story.js';
import * as R from './rolls.js';
import * as SU from './summons.js';

const api = window.api;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- page types ----------

const TYPES = [
  { key: 'lore', label: 'Lore', group: 'Lore' },
  { key: 'rules', label: 'Rules', group: 'Rules' },
  { key: 'location', label: 'Location', group: 'Locations' },
  { key: 'npc', label: 'NPC', group: 'NPCs' },
  { key: 'faction', label: 'Faction', group: 'Factions' },
  { key: 'cult', label: 'Cult', group: 'Cults' },
  { key: 'people', label: 'People', group: 'Peoples' },
  { key: 'essence', label: 'Essence', group: 'Essences' },
  { key: 'astral-space', label: 'Astral space', group: 'Astral spaces' },
  { key: 'adventure', label: 'Adventure', group: 'Adventures' },
  { key: 'encounter', label: 'Encounter', group: 'Encounters' },
  { key: 'item', label: 'Item', group: 'Items' },
  { key: 'pc', label: 'Player character', group: 'Party' },
  { key: 'session', label: 'Session', group: 'Sessions' },
];
const typeInfo = key => TYPES.find(t => t.key === key) || { key, label: key, group: key };
const TREE_ORDER = ['adventure', 'location', 'npc', 'faction', 'cult', 'astral-space', 'encounter', 'item', 'people', 'essence', 'rules', 'lore'];

const TEMPLATES = {
  npc: '## Who they are\n\n\n## At the table\n\nRank:  \nEssences:  \n\n## Roleplay\n\n- **Wants:** \n- **Secret:** \n',
  location: '## Overview\n\n\n## Notable places\n\n- \n\n## People\n\n- \n\n## Hooks\n\n- \n',
  faction: '## What they want\n\n\n## How they hold power\n\n\n## Key members\n\n- \n',
  cult: '## Who they serve\n\n\n## What they want\n\n\n## How they hide\n\n\n## Members\n\n- \n\n## Signs of them\n\n- \n',
  adventure: '## Premise\n\n\n## Hooks\n\n- \n\n## Scenes\n\n1. \n\n## Rewards\n\n- \n',
  session: '## Summary\n\n\n## What happened\n\n- \n\n## Loot and rewards\n\n- \n\n## Loose threads\n\n- \n',
  pc: '## Inventory\n\n\n## Notes\n\n',
  item: '## Description\n\n\n## Properties\n\n',
};

// ---------- state ----------

const state = {
  campaign: null,
  pages: new Map(),
  titleIndex: new Map(),
  data: null,
  view: null,
  history: [],
  future: [],
  editing: null, // { id, meta, body, originalTitle }
  saveTimer: null,
  gen: { tab: 'all', npc: null, astral: null, encounter: null, words: null, wordHistory: [], wordPins: {}, opts: {} },
  saved: { hooks: [] },
  dm: true,
  savedView: { q: '', hideUsed: false, picked: null },
};

// ---------- helpers ----------

function toast(msg, isError = false, ms = 0) {
  const t = $('#toast');
  t.textContent = msg;
  const dur = ms || (isError ? 4000 : 1800);
  t.style.setProperty('--toast-ms', `${dur}ms`);
  t.className = '';
  void t.offsetWidth;
  t.className = 'show' + (isError ? ' error' : '');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.className = isError ? 'error' : ''; }, dur);
}

// ---------- app effects ----------
// Small animations outside the battle screen, so a change shows where it happened: rerolled text shimmers in,
// a page or section revealed to the players clears from a mist in player view, rests pulse across the party,
// a new essence, confluence or stone ability glows on the sheet, and pins, toasts and trashed pages move
// rather than snap. Settings has a switch to turn them off; the battle screen has its own.
const appFxOn = () => { try { return localStorage.getItem('app-fx') !== '0'; } catch { return true; } };
function applyAppFx() { document.body.classList.toggle('no-fx', !appFxOn()); }
/** Plays cls on el once, taking it off after ms so it can play again next time. */
function playOnce(el, cls, ms = 1200, vars = {}) {
  if (!el || !appFxOn()) return;
  clearTimeout(el._fx?.[cls]);
  el.classList.remove(cls);
  void el.offsetWidth;
  for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
  el.classList.add(cls);
  (el._fx ||= {})[cls] = setTimeout(() => el.classList.remove(cls), ms);
}
/** A short pause so a row or page can fade out before it is gone. */
const fadeOut = (el, cls = 'fx-leave') => new Promise(done => {
  if (!el || !appFxOn() || matchMedia('(prefers-reduced-motion: reduce)').matches) return done();
  el.classList.add(...cls.split(' '));
  setTimeout(done, 260);
});

// Rerolls: the text in a result that changed since the last draw shimmers in, so it's clear what's new.
const REDRAW_SEL = '.reroll, li, p, h1, h2, h3, h4, td, th, .word-chip';
const redrawSnapshot = box => new Set($$(REDRAW_SEL, box).map(x => x.textContent.trim()));
function markRedrawn(box, before) {
  if (!before || !appFxOn()) return;
  const changed = $$(REDRAW_SEL, box).filter(x => x.textContent.trim() && !before.has(x.textContent.trim()));
  // The innermost changed bit is marked, so one rerolled detail lights up rather than its whole line.
  // A whole new draw deals in its sections one after another instead.
  const leaves = changed.filter(x => !changed.some(y => y !== x && x.contains(y)));
  const marked = leaves.length > 24 ? $$('.prose > *, .word-group', box).slice(0, 30) : leaves;
  marked.forEach((x, i) => { x.style.setProperty('--d', `${Math.min(i * 30, 450)}ms`); x.classList.add('fx-redraw'); });
}

// Reveals: what the DM shows the players is remembered on this computer until player view has shown it once.
const revealKey = () => `reveals:${state.campaign?.name || ''}`;
function reveals() { try { return { pages: [], lines: {}, ...JSON.parse(localStorage.getItem(revealKey()) || '{}') }; } catch { return { pages: [], lines: {} }; } }
function saveReveals(r) { try { localStorage.setItem(revealKey(), JSON.stringify(r)); } catch {} }
function noteReveal(id, shown) {
  const r = reveals();
  r.pages = r.pages.filter(x => x !== id);
  if (shown) r.pages.push(id); else delete r.lines[id];
  saveReveals(r);
}
/** Lines that were in a :::dm block before an edit and are now in the players' text. */
function noteRevealedLines(id, oldBody, newBody) {
  const plain = new Set(G.stripDM(oldBody).split('\n').map(l => l.trim()));
  const secret = new Set(oldBody.split('\n').map(l => l.trim()).filter(l => l && !plain.has(l)));
  const out = G.stripDM(newBody).split('\n').map(l => l.trim()).filter(l => l && !l.startsWith(':::') && secret.has(l) && !plain.has(l));
  if (!out.length) return;
  const r = reveals();
  r.lines[id] = [...new Set([...(r.lines[id] || []), ...out])].slice(-40);
  saveReveals(r);
}
const plainText = s => s.replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_, a, b) => b || a).replace(/[*_#>`]|^\s*[-+]\s+|^\s*\d+\.\s+/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
/** In player view, a page or section the DM has just revealed clears from a mist the first time it's shown. */
function playReveal(article, id) {
  if (state.dm || !article) return;
  const r = reveals();
  const page = r.pages.includes(id), lines = (r.lines[id] || []).map(plainText).filter(l => l.length > 2);
  if (!page && !lines.length) return;
  r.pages = r.pages.filter(x => x !== id);
  delete r.lines[id];
  saveReveals(r);
  $$(`#page-tree [data-id="${CSS.escape(id)}"]`).forEach(b => b.classList.remove('fx-new-reveal'));
  if (!appFxOn()) return;
  const mist = (host, big) => {
    host.classList.add('fx-mist-host');
    const m = document.createElement('span');
    m.className = `fx-mist${big ? ' big' : ''}`;
    host.append(m);
    setTimeout(() => { m.remove(); host.classList.remove('fx-mist-host'); }, 2600);
  };
  if (page) {
    mist(article, true);
    $('.badges', article)?.insertAdjacentHTML('beforeend', '<span class="badge fx-revealed">✦ Newly revealed</span>');
    return;
  }
  const blocks = $$('.prose > *, .prose li', article).filter(b => !b.querySelector('li'));
  for (const b of blocks) {
    const t = plainText(b.textContent);
    if (t && lines.some(l => t.includes(l.slice(0, 60)) || l.includes(t))) mist(b, false);
  }
}

// Rests: a wave across the party cards, blue for a short rest and gold for a long one, with HP filling back up.
function playRest(view, rest) {
  if (!rest || !appFxOn()) return;
  const banner = document.createElement('div');
  banner.className = `fx-banner ${rest.long ? 'long' : 'short'}`;
  banner.innerHTML = rest.long ? '☾ Long rest' : '☕ Short rest';
  $('.cards', view)?.append(banner);
  setTimeout(() => banner.remove(), 2200);
  $$('.cards > .card', view).forEach((card, i) => {
    const id = $('h3', card)?.dataset.id;
    const was = rest.before[id];
    if (!was) return;
    const d = `${300 + i * 140}ms`;
    const wave = document.createElement('span');
    wave.className = `fx-layer fx-rest ${rest.long ? 'long' : 'short'}`;
    wave.style.setProperty('--fx-at', d);
    card.append(wave);
    const fill = $('.hp .bar > span', card);
    const p = state.pages.get(id);
    const gain = (Number(p?.meta.hp) || 0) - was.hp;
    if (fill && gain > 0) { fill.style.setProperty('--from', `${was.pct}%`); fill.style.setProperty('--fx-at', d); fill.classList.add('fx-grow'); }
    const dice = was.used - (Number(p?.meta.hitDiceUsed) || 0);
    const label = [gain > 0 ? `+${gain} HP` : '', dice > 0 ? `+${dice} hit ${dice > 1 ? 'dice' : 'die'}` : ''].filter(Boolean).join(' · ');
    if (label) {
      const f = document.createElement('span');
      f.className = 'fx-float heal';
      f.style.setProperty('--fx-at', d);
      f.textContent = label;
      card.append(f);
    }
    setTimeout(() => card.querySelectorAll('.fx-rest, .fx-float').forEach(x => x.remove()), 2600 + i * 140);
  });
}

// Essences and stones: a new essence, confluence or stone ability on a sheet glows in its affinity's colour.
const sheetSeen = new Map();
function essenceHue(name) {
  const i = G.essenceInfo(state.data, name);
  if (i?.kind === 'divine' || i?.divine) return 'var(--gold)';
  const key = (i?.affinity || name || '').toLowerCase();
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 85% 62%)`;
}
function essenceGlow(el, name, big = false) {
  if (!el) return;
  el.classList.add('fx-glow-host');
  const glow = document.createElement('span');
  glow.className = `fx-layer fx-ess-glow${big ? ' big' : ''}`;
  glow.style.setProperty('--ess', essenceHue(name));
  glow.innerHTML = '<span class="fx-rune"></span>';
  el.append(glow);
  setTimeout(() => glow.remove(), 1900);
}
function playSheet(el, p, conf) {
  const m = p.meta;
  const now = {
    ess: [0, 1, 2].map(i => m.essences[i] || ''),
    conf: conf && !$('.slots > .slot.dormant', el) ? conf.name : '',
    stones: m.stones.map(s => s.spell ? `${s.essence}|${s.spell}` : ''),
    powers: $$('.powers .power strong', el).map(x => x.textContent),
  };
  const was = sheetSeen.get(p.id);
  sheetSeen.set(p.id, now);
  if (!was || !appFxOn()) return;
  const slots = $$('.slots > .slot', el);
  now.ess.forEach((e, i) => { if (e && e !== was.ess[i]) essenceGlow(slots[i], e); });
  if (now.conf && now.conf !== was.conf) essenceGlow(slots[3], now.conf, true);
  const rows = $$('.stone-row', el);
  now.stones.forEach((s, i) => { if (s && !was.stones.includes(s)) essenceGlow(rows[i], s.split('|')[0]); });
  $$('.powers .power', el).forEach(w => { const n = $('strong', w)?.textContent; if (n && !was.powers.includes(n)) playOnce(w, 'fx-power-new', 1600); });
}

async function attempt(fn) {
  try { return await fn(); } catch (e) { console.error(e); toast(e.message, true); return undefined; }
}

function setSaveState(text, dirty = false) {
  const el = $('#save-state');
  el.textContent = text;
  el.classList.toggle('dirty', dirty);
}

function rebuildIndex() {
  state.titleIndex.clear();
  for (const p of state.pages.values()) {
    state.titleIndex.set(p.meta.title.toLowerCase(), p.id);
    for (const a of [].concat(p.meta.aliases || [])) state.titleIndex.set(String(a).toLowerCase(), p.id);
  }
  for (const p of state.pages.values()) if (!state.titleIndex.has(p.id)) state.titleIndex.set(p.id, p.id);
  reserveNames();
}
/** The names the story engine's strangers must not share: every page's title and alias, and every person's first name. */
function reserveNames() {
  if (!state.data) return;
  const out = new Set(state.titleIndex.keys());
  for (const p of state.pages.values()) if (['npc', 'pc'].includes(p.meta.type)) for (const n of [p.meta.title, ...[].concat(p.meta.aliases || [])]) out.add(String(n).split(' ')[0].toLowerCase());
  state.data.reservedNames = out;
  state.data.pageNames = new Set([...state.pages.values()].map(p => p.meta.title));
}

function resolve(target) {
  const key = String(target).trim().toLowerCase();
  return state.titleIndex.get(key) || null;
}

// ---------- DM mode ----------
// In player view, DM-only pages vanish and :::dm blocks are left out wherever page text is shown.

const DM_VIEWS = ['world', 'digest', 'generators', 'hooks', 'lists', 'bestiary', 'battle', 'trash'];
const hiddenPage = p => !state.dm && !!p?.meta.dmOnly;
const visiblePages = () => [...state.pages.values()].filter(p => !hiddenPage(p));
const shownBody = p => state.dm ? p.body : G.stripDM(p.body);

function applyDM() {
  document.body.classList.toggle('player', !state.dm);
  $('#dm-toggle').innerHTML = state.dm ? 'DM mode <b>on</b>' : 'Player view';
  $('#dm-toggle').title = state.dm ? 'Switch to player view: hides secrets, DM-only pages and DM tools' : 'Switch back to DM mode';
  updateNavGroups();
}

function setDM(on) {
  state.dm = on;
  localStorage.setItem('dm-mode', on ? '1' : '0');
  applyDM();
  renderTree();
  refreshDate();
  const v = state.view;
  if (!on && (DM_VIEWS.includes(v?.kind) || (v?.kind === 'page' && v.edit))) return go(v.kind === 'page' ? { kind: 'page', id: v.id } : { kind: 'page', id: 'home' }, { replace: true });
  render();
  toast(on ? 'DM mode on' : 'Player view: secrets hidden');
}

// ---------- systems ----------
// Whole systems can be switched off per campaign (Settings → Systems), so a new group can start small and add more
// as it learns the app. A switched-off system is only put away: its data stays, and switching it on brings it back.

const SYSTEMS = [
  { key: 'world', label: 'The living world', hint: 'The date and calendar, Advance time, the chronicle, News and rumours, Legends and the Since last session digest' },
  { key: 'storyteller', parent: 'world', label: 'Storyteller and small events', hint: 'Pitch me some ideas, and small events and follow-ups that happen by themselves as time passes' },
  { key: 'people', parent: 'world', label: 'NPC lives', hint: 'Their story on NPC pages: traits, goals, ties, what they think of the party, grudges, and familiar faces in towns' },
  { key: 'factions', parent: 'world', label: 'Faction aims and control points', hint: 'Its aims on faction pages, influence, control points, and factions acting on grudges' },
  { key: 'reputation', parent: 'world', label: 'Reputation', hint: "The party's standing with places and factions, and renown by region" },
  { key: 'trade', parent: 'world', label: 'Trade and prices', hint: 'Trade goods tables, what places make and need, shortages and gluts' },
  { key: 'towntools', label: 'Town building buttons', hint: '+ Tavern, + Market, + Temple, + Quirk, + Feature and + Orphanage on settlement pages, and Add a child on NPC pages' },
  { key: 'battle', label: 'Battle tracker', hint: 'The Battle screen and the Add to battle buttons' },
  { key: 'battleAi', parent: 'battle', label: 'AI monster turns', hint: 'The Manual | AI switch: monsters suggest their own turns' },
  { key: 'travel', label: 'Travel and teleport circles', hint: 'The Travel generator, Plan journey on the World map, journey pins and teleport circles' },
  { key: 'contracts', label: 'Adventure Society contracts', hint: 'The contract board generator' },
  { key: 'astral', label: 'Astral spaces', hint: 'The astral space generator' },
  { key: 'auction', label: 'Auction houses', hint: 'The auction house generator' },
  { key: 'hooks', label: 'Word bank and saved hooks', hint: 'The Word bank generator and Saved hooks' },
];
// Simple: the wiki, party sheets, sessions, the reference pages, the map, the everyday generators and a plain battle tracker.
const SIMPLE_SYSTEMS = ['battle', 'hooks'];

/** Whether a system is on for this campaign. Everything is on until the DM switches something off. */
function sysOn(key) {
  const s = SYSTEMS.find(x => x.key === key);
  if (s?.parent && !sysOn(s.parent)) return false;
  return state.saved?.systems?.[key] !== false;
}

/** Hides everything tagged data-sys="key" for the systems that are off, and folds away nav groups left empty. */
function applySystems() {
  let st = document.getElementById('sys-style');
  if (!st) { st = document.createElement('style'); st.id = 'sys-style'; document.head.append(st); }
  const off = SYSTEMS.filter(s => !sysOn(s.key)).map(s => s.key);
  const sel = off.map(k => `[data-sys~="${k}"]`);
  if (off.includes('battle')) sel.push('.battle-btn', '[data-battle-groups]', '[data-battle-monster]');
  st.textContent = sel.length ? `${sel.join(',')} { display: none !important; }` : '';
  updateNavGroups();
}

function updateNavGroups() {
  let closed = [];
  try { closed = JSON.parse(localStorage.getItem('nav-closed') || '[]'); } catch {}
  $$('.nav-group').forEach(g => {
    g.classList.toggle('closed', closed.includes(g.dataset.group));
    g.hidden = ![...g.querySelectorAll('.nav-items > button')].some(b => getComputedStyle(b).display !== 'none');
  });
}

function wireNavGroups() {
  $$('.nav-group .nav-head').forEach(h => h.onclick = () => {
    const g = h.closest('.nav-group').dataset.group;
    let closed = [];
    try { closed = JSON.parse(localStorage.getItem('nav-closed') || '[]'); } catch {}
    closed = closed.includes(g) ? closed.filter(x => x !== g) : [...closed, g];
    try { localStorage.setItem('nav-closed', JSON.stringify(closed)); } catch {}
    updateNavGroups();
  });
}

/** Views that belong to a system: opening one while it's off says so, with the way to switch it back on. */
const VIEW_SYSTEMS = { world: 'world', digest: 'world', news: 'world', legends: 'world', battle: 'battle', hooks: 'hooks' };

function systemsHtml(cur = key => sysOn(key)) {
  return SYSTEMS.map(s => `<label class="check sys-check${s.parent ? ' sys-child' : ''}" title="${esc(s.hint)}"><input type="checkbox" name="sys-${s.key}" data-parent="${s.parent || ''}" ${cur(s.key) ? 'checked' : ''}> ${esc(s.label)}<small>${esc(s.hint)}</small></label>`).join('');
}

/** A preset fills in the boxes; a child box is dimmed while its parent is off, and keeps its tick for when the parent comes back. */
function wireSystemsForm(form) {
  const sync = () => $$('input[data-parent]', form).forEach(i => { if (i.dataset.parent) i.closest('label').classList.toggle('sys-dim', !form.elements['sys-' + i.dataset.parent].checked); });
  $$('[data-sys-preset]', form).forEach(b => b.onclick = () => {
    for (const s of SYSTEMS) form.elements['sys-' + s.key].checked = b.dataset.sysPreset === 'all' || SIMPLE_SYSTEMS.includes(s.key);
    sync();
  });
  form.addEventListener('change', sync);
  sync();
}

async function saveSystems(r) {
  state.saved.systems = Object.fromEntries(SYSTEMS.map(s => [s.key, !!r['sys-' + s.key]]));
  await saveSaved();
  applySystems();
  renderTree();
  refreshDate();
  render();
}

const WIKILINK = /\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g;

function linksOf(body) {
  const out = [];
  for (const m of body.matchAll(WIKILINK)) out.push(m[1].trim());
  return out;
}

function renderMarkdown(md) {
  const withLinks = G.treeBlocks(G.dmBlocks(md, state.dm)).replace(WIKILINK, (_, target, label) => {
    const id = resolve(target);
    if (id && hiddenPage(state.pages.get(id))) return esc((label || target).trim());
    // Catalogue items with no page of their own open in the items browser, so they aren't shown as missing.
    const known = !id && catalogTarget(target);
    return `<a class="wikilink${id ? '' : known ? ' catalog' : ' missing'}" data-target="${esc(target.trim())}">${esc((label || target).trim())}</a>`;
  });
  // A bare "- " line (an empty list started in a template) would draw a lone bullet.
  const html = marked.parse(withLinks.replace(/^[ \t]*[-*][ \t]*$/gm, ''), { gfm: true, breaks: false });
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  // Strip anything scripty that might sneak in through raw HTML in a page.
  $$('script, iframe, object, embed', tpl.content).forEach(n => n.remove());
  $$('*', tpl.content).forEach(n => [...n.attributes].forEach(a => { if (/^on/i.test(a.name)) n.removeAttribute(a.name); }));
  $$('img', tpl.content).forEach(img => {
    const src = img.getAttribute('src') || '';
    if (src.startsWith('images/')) img.src = imageSrc(src);
  });
  // Found coins: a button that puts them in the party purse.
  $$('a[href^="#purse-"]', tpl.content).forEach(a => {
    const [, gp, key] = a.getAttribute('href').match(/^#purse-(\d+)-([\w-]+)$/) || [];
    if (!gp) return;
    const b = document.createElement('button');
    b.className = 'btn small purse-btn'; b.dataset.gp = gp; b.dataset.key = key; b.textContent = `+ Party purse`;
    b.title = `Add ${G.formatSpirit(Number(gp))} to the party purse`;
    a.replaceWith(b);
  });
  // A contract's bonus that is a thing: a button that puts it in the party inventory, or gives gear to one player.
  $$('a[href^="#bonus-"]', tpl.content).forEach(a => {
    const [, kind] = a.getAttribute('href').match(/^#bonus-(gear|party)-/) || [];
    if (!kind) return;
    const b = document.createElement('button');
    b.className = 'btn small bonus-item-btn'; b.dataset.href = a.getAttribute('href');
    b.textContent = kind === 'gear' ? '+ Give to a party member' : '+ Party inventory';
    a.replaceWith(b);
  });
  // An encounter's monsters: a button that puts them all on the battle screen.
  $$('a[href^="#battle-"]', tpl.content).forEach(a => {
    const b = document.createElement('button');
    b.className = 'btn small battle-btn dm-tool'; b.dataset.battle = a.getAttribute('href'); b.textContent = '⚔ Add to battle';
    b.title = 'Put every monster in this encounter on the battle screen';
    a.replaceWith(b);
  });
  // A split-clue puzzle's handouts: a button that makes a page of slips to print.
  $$('a[href^="#handouts-"]', tpl.content).forEach(a => {
    const b = document.createElement('button');
    b.className = 'btn small handouts-btn dm-tool'; b.dataset.handouts = a.getAttribute('href'); b.textContent = '🖨 Print handouts';
    b.title = 'Save a PDF of slips to cut out and hand to each player';
    a.replaceWith(b);
  });
  // Family trees: each person's line becomes a box, with their children's list below it.
  $$('.family-tree li', tpl.content).forEach(li => {
    const box = document.createElement('span');
    box.className = 'ft-node';
    for (const n of [...li.childNodes]) if (!(n.nodeType === 1 && /^(UL|OL)$/.test(n.tagName))) box.append(n.nodeType === 1 && n.tagName === 'P' ? [...n.childNodes].reduce((f, c) => (f.append(c), f), document.createDocumentFragment()) : n);
    li.prepend(box);
  });
  $$('a[href]', tpl.content).forEach(a => { a.target = '_blank'; });
  diceLinks(tpl.content);
  return tpl.innerHTML;
}

// Dice in page text ("2d6 + 3", "a d20", "+5 to hit") roll when clicked.
const DICE_IN_TEXT = /\b(\d*d(?:4|6|8|10|12|20|100)(?:\s*[+\u2212-]\s*\d+(?!\s*d\d))?)\b|([+-]\d+) to hit\b/g;
function diceLinks(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) {
    const n = walker.currentNode;
    if (!n.parentElement?.closest('a, code, pre, h1, h2, h3') && DICE_IN_TEXT.test(n.nodeValue)) nodes.push(n);
    DICE_IN_TEXT.lastIndex = 0;
  }
  for (const n of nodes) {
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const m of n.nodeValue.matchAll(DICE_IN_TEXT)) {
      const expr = m[1] ? m[1].replace(/\u2212/g, '-') : `1d20 ${m[2][0]} ${m[2].slice(1)}`;
      if (!G.parseDice(expr)) continue;
      frag.append(n.nodeValue.slice(last, m.index));
      const a = document.createElement('a');
      a.className = 'roll'; a.dataset.roll = expr; a.textContent = m[0];
      if (m[2]) a.dataset.label = 'To hit';
      frag.append(a);
      last = m.index + m[0].length;
    }
    frag.append(n.nodeValue.slice(last));
    n.replaceWith(frag);
  }
}

function inlineMarkdown(md) {
  const div = document.createElement('div');
  div.innerHTML = renderMarkdown(md);
  const p = div.firstElementChild;
  return p && p.tagName === 'P' ? p.innerHTML : div.innerHTML;
}

function imageSrc(path) {
  return path ? api.imageUrl(path) : '';
}

async function loadPages() {
  const list = await api.pages.list();
  state.pages = new Map(list.map(p => [p.id, p]));
  rebuildIndex();
}

async function loadData() {
  const names = ['essences', 'confluences', 'classes', 'peoples', 'npc', 'monsters', 'astral', 'encounters', 'words', 'quirks', 'compendium', 'divine', 'market', 'tavern', 'food', 'items', 'auction', 'spells', 'bestiary', 'contracts', 'variants', 'travel', 'places', 'calendar', 'story', 'incidents', 'people', 'factions', 'buildings', 'children', 'rolls'];
  const data = {};
  for (const n of names) {
    try { data[n] = await api.data.read(n); }
    catch (e) { toast(`Generator list "${n}" could not be read: ${e.message}`, true); }
  }
  state.data = state.genRolls?.off ? R.applyOff(data, state.genRolls.off) : data;
  reserveNames();
}

/** The top bar's refresh: reread the pages and saved campaign data from disk and draw the same view again, where it was. */
async function refreshView() {
  const btn = $('#refresh');
  if (btn.disabled) return;
  btn.disabled = true;
  const view = $('#view'), top = view.scrollTop;
  try {
    await loadPages();
    try { state.saved = await api.saved.read(); } catch {}
    applySystems();
    state.worldCal = null;
    refreshDate();
    renderTree();
    if (state.view?.kind === 'page' && !state.pages.has(state.view.id)) openPage('home');
    else await render();
    view.scrollTop = top;
    toast('Refreshed');
  } finally { btn.disabled = false; }
}

async function loadCampaign() {
  state.campaign = await api.campaigns.current();
  $('#campaign-name').innerHTML = `${esc(state.campaign.name)}<small>Switch or back up</small>`;
  document.title = `${state.campaign.name} · D&D Campaign Manager`;
  await loadPages();
  // Lines switched off belong to each campaign: don't apply the last campaign's to this one's lists.
  state.genRolls = null;
  await loadData();
  try { state.saved = await api.saved.read(); }
  catch (e) { state.saved = { hooks: [] }; toast('Saved hooks could not be read: ' + e.message, true); }
  await loadRolls();
  applySystems();
  G.setPriceFloor(state.saved.priceFloor ? 1 : 0);
  if (state.data.travel && sysOn('travel')) await learnHereCircle().catch(() => {});
  resetBattleUndo();
  state.worldCal = null;
  refreshDate();
  renderTree();
}

// ---------- party purse ----------
// Spirit coins: one shared party purse, kept with the campaign, plus each member's own coins on their sheet. Items stay on each sheet.

function partyPurse() {
  const p = (state.saved.purse ||= {});
  for (const k of G.COIN_RANKS) p[k] = Number(p[k]) || 0;
  return p;
}
const purseText = () => coinSummary({ coins: partyPurse() });
async function savePurse(next) {
  if (next) state.saved.purse = next;
  await attempt(() => api.saved.write(state.saved));
}
/** A party member's own spirit coins, as a full purse object. */
function ownCoins(p) {
  const c = (p.meta.coins ||= {});
  for (const k of G.COIN_RANKS) c[k] = Number(c[k]) || 0;
  return c;
}
/** The "Pay from" choice for a purchase: the party purse, or one party member's own coins. */
function payFromField(dflt = 'purse', label = 'Pay from', none = '') {
  return `<label class="field">${esc(label)}<select name="payFrom">${none ? `<option value="none" ${dflt === 'none' ? 'selected' : ''}>${esc(none)}</option>` : ''}<option value="purse" ${dflt === 'purse' ? 'selected' : ''}>The party purse (${esc(purseText())})</option>
    ${pcs().map(p => `<option value="${esc(p.id)}" ${dflt === p.id ? 'selected' : ''}>${esc(p.meta.title)}'s own coins (${esc(coinSummary(p.meta))})</option>`).join('')}</select></label>`;
}
/** Who pays by default: the buyer's own coins when they hold enough, else the party purse. */
const payDefault = (who, gp) => {
  const holds = id => G.purseValue(state.pages.get(id)?.meta.coins) >= gp;
  if (!(gp > 0)) return 'purse';
  if (who && holds(who)) return who;
  if (G.purseValue(partyPurse()) >= gp) return 'purse';
  return pcs().find(p => holds(p.id))?.id || 'purse';
};
const payerName = from => from === 'purse' ? 'the party purse' : `${state.pages.get(from)?.meta.title}'s own coins`;
/** Takes gp from the purse or a member’s own coins and saves it. False (with a toast) if they can't cover it. */
async function payFrom(from, gp, what = '') {
  if (!(gp > 0)) return true;
  if (!from || from === 'purse') { const next = payFromPurse(gp); if (!next) return false; await savePurse(next); return true; }
  const p = state.pages.get(from);
  const next = p && G.payCoins(ownCoins(p), gp);
  if (!next) { toast(`${p?.meta.title || 'They'} can't cover ${G.formatSpirit(gp)}${what ? ` for ${what}` : ''}: they hold ${coinSummary(p?.meta || {}).replace(/ \(.*/, '')}.`, true); return false; }
  p.meta.coins = next;
  await attempt(() => api.pages.write(p.id, p.meta, p.body));
  return true;
}
/** Can the purse or a member cover gp? For warnings shown before a dialog's button is pressed. */
const canPay = (from, gp) => G.purseValue(!from || from === 'purse' ? partyPurse() : state.pages.get(from)?.meta.coins) >= gp;
/** The party member who bought something last, so the next purchase starts with them. */
const lastBuyer = () => state.pages.has(state.lastBuyer) ? state.lastBuyer : pcs()[0]?.id;
const buyerOptions = () => pcs().map(p => `<option value="${esc(p.id)}" ${p.id === lastBuyer() ? 'selected' : ''}>${esc(p.meta.title)}</option>`).join('');
/** Under a purchase dialog: says up front when whoever pays can't cover the price, and by how much. */
function wireAfford(form, cost) {
  const show = () => {
    const from = form.elements.payFrom.value, gp = cost();
    const has = G.purseValue(from === 'purse' ? partyPurse() : state.pages.get(from)?.meta.coins);
    const box = $('[data-afford]', form);
    box.textContent = has >= gp ? '' : `Short by ${G.formatSpirit(gp - has)}: ${from === 'purse' ? 'the party purse' : `${state.pages.get(from).meta.title}'s own coins`} hold${from === 'purse' ? 's' : ''} ${G.formatSpirit(has) || 'nothing'}.`;
    box.classList.toggle('bad', has < gp);
  };
  form.addEventListener('input', show);
  form.addEventListener('change', show);
  show();
}
/** Coins found in a page (an astral space's treasure): into the purse, and the page notes they're taken. */
async function claimCoins(btn) {
  const gp = Number(btn.dataset.gp), key = btn.dataset.key;
  const link = `[Add to the party purse](#purse-${gp}-${key})`;
  btn.disabled = true;
  const page = state.view?.kind === 'page' && state.pages.get(state.view.id);
  if (page && page.body.includes(link)) {
    page.body = page.body.replace(link, '*(in the party purse)*');
    await attempt(() => api.pages.write(page.id, page.meta, page.body));
  }
  // A space still in the generator remembers it too, so saving it later doesn't offer the coins again.
  const sp = state.gen.astral;
  if (!page && sp) {
    if (key === 'heart') sp.rewards = sp.rewards.map(r => r.replace(link, '*(in the party purse)*'));
    else { const room = sp.rooms.find(r => `r${r.id}` === key); if (room) { room.treasureGp = 0; room.treasureTaken = true; } }
  }
  await addToPurse(gp, page ? page.meta.title : sp?.name);
  if (page) render(); else if (sp) showGenResult();
}

// ---------- party inventory ----------
// Things the whole party owns (a horse, a crate of wine, a map), kept with the campaign. Gear a player wears or wields
// goes on that player's sheet instead.

const partyItems = () => (state.saved.partyItems ||= []);
const savePartyItems = () => attempt(() => api.saved.write(state.saved));
async function addPartyItem(name, from = '') {
  partyItems().push({ name, from, added: new Date().toISOString().slice(0, 10) });
  await savePartyItems();
  toast(`${name} is in the party inventory.`);
}
/** Ask which party member gets something. Returns their page, or null. */
async function pickPartyMember(title) {
  const list = pcs();
  if (!list.length) { toast('Add a party member first.', true); return null; }
  const r = await formDialog(title, `<label class="field">Who<select name="who">${list.map(p => `<option value="${esc(p.id)}">${esc(p.meta.title)}</option>`).join('')}</select></label>`, 'Give');
  return r ? state.pages.get(r.who) : null;
}
async function giveToMember(p, line) {
  p.body = G.addToInventory(p.body, line);
  await attempt(() => api.pages.write(p.id, p.meta, p.body));
  toast(`${line} added to ${p.meta.title}'s inventory.`);
}
/** A saved contract's bonus: into the party inventory, or (gear) onto a player's sheet; the page notes where it went. */
async function claimBonusItem(btn) {
  const href = btn.dataset.href;
  const [, kind, enc] = href.match(/^#bonus-(gear|party)-(.+)$/) || [];
  if (!kind) return;
  const name = decodeURIComponent(enc);
  const page = state.view?.kind === 'page' && state.pages.get(state.view.id);
  const from = page ? page.meta.title : '';
  let where = 'in the party inventory';
  if (kind === 'gear') {
    const who = await pickPartyMember(`Who gets the ${name.replace(/ \(.*$/, '').toLowerCase()}?`);
    if (!who) return;
    await giveToMember(who, `${name}${from ? ` (${from})` : ''}`);
    where = `given to ${who.meta.title}`;
  } else await addPartyItem(name, from);
  btn.disabled = true;
  const link = new RegExp(`\\[[^\\]]*\\]\\(${href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`);
  if (page && link.test(page.body)) {
    page.body = page.body.replace(link, `*(${where})*`);
    await attempt(() => api.pages.write(page.id, page.meta, page.body));
    render();
  }
}
function partyItemsSection() {
  const items = partyItems();
  return `<div class="party-items" id="party-items">
    ${items.length ? `<ul>${items.map((x, i) => `<li><span>${esc(x.name)}${x.from ? ` <span class="muted">from ${esc(x.from)}</span>` : ''}</span>
      <button class="btn small" data-give-item="${i}" title="Move it onto one party member's sheet">Give to…</button>
      <button class="btn small" data-drop-item="${i}" title="Sold, used up or lost">Remove</button></li>`).join('')}</ul>` : '<p class="hint" style="margin:0 0 6px">Nothing yet.</p>'}
    <div class="carried-add"><input id="party-item-name" placeholder="Something the whole party owns"><button class="btn small" id="party-item-add">Add</button></div></div>`;
}
function wirePartyItems(again) {
  const add = async () => { const v = $('#party-item-name').value.trim(); if (!v) return; await addPartyItem(v); again(); };
  $('#party-item-add').onclick = add;
  $('#party-item-name').onkeydown = e => { if (e.key === 'Enter') add(); };
  $$('[data-drop-item]').forEach(b => b.onclick = async () => { partyItems().splice(Number(b.dataset.dropItem), 1); await savePartyItems(); again(); });
  $$('[data-give-item]').forEach(b => b.onclick = async () => {
    const x = partyItems()[Number(b.dataset.giveItem)];
    const who = x && await pickPartyMember(`Who gets the ${x.name}?`);
    if (!who) return;
    partyItems().splice(partyItems().indexOf(x), 1);
    await savePartyItems();
    await giveToMember(who, `${x.name}${x.from ? ` (${x.from})` : ''}`);
    again();
  });
}

/** Pay from the party purse. Returns the purse after paying, or null (with a message) if it can't cover it. */
function payFromPurse(gp) {
  const next = G.payCoins(partyPurse(), gp);
  if (!next) toast(`The party purse can't cover ${G.formatSpirit(gp)}: it holds ${purseText().replace(/ \(.*/, '')}.`, true);
  return next;
}
/** Add coins (in gp) to the party purse, as the coins themselves where they come in round amounts. */
async function addToPurse(gp, why = '') {
  const purse = partyPurse();
  let left = Math.round(gp);
  for (const k of [...G.COIN_RANKS].reverse()) { const v = G.coinValue(k); const n = Math.floor(left / v); purse[k] += n; left -= n * v; }
  await savePurse();
  toast(`${G.formatSpirit(gp)} added to the party purse${why ? ` from ${why}` : ''}.`);
}
function purseEditor(id = 'purse') {
  const p = partyPurse();
  return `<div class="purse" id="${id}"><div class="coin-row">${G.COIN_RANKS.map(c => `<label class="field">${cap(c)} coins<input data-pcoin="${c}" type="number" min="0" value="${p[c]}"></label>`).join('')}</div>
    <p class="hint" data-purse-total>${esc(purseText())}</p></div>`;
}
function wirePurse(root = document) {
  $$('[data-pcoin]', root).forEach(inp => inp.addEventListener('change', () => {
    partyPurse()[inp.dataset.pcoin] = Math.max(0, Number(inp.value) || 0);
    savePurse();
    $$('[data-purse-total]').forEach(x => { x.textContent = purseText(); });
  }));
}

// ---------- navigation ----------

function sameView(a, b) { return a && b && JSON.stringify(a) === JSON.stringify(b); }

async function go(view, { replace = false } = {}) {
  await finishEditing();
  if (state.view && !replace && !sameView(state.view, view)) { state.history.push(state.view); state.future = []; }
  state.view = view;
  render();
}

async function back() {
  if (!state.history.length) return;
  await finishEditing();
  state.future.push(state.view);
  state.view = state.history.pop();
  render();
}

async function forward() {
  if (!state.future.length) return;
  await finishEditing();
  state.history.push(state.view);
  state.view = state.future.pop();
  render();
}

function openPage(id) { return go({ kind: 'page', id }); }

/** Where a link with no wiki page goes instead: an essence, confluence, item, spell or (for the DM) monster in its browser. */
function catalogTarget(target) {
  // "Wolf (monster)" is the bestiary's wolf, not the Wolf essence.
  const asMonster = String(target).match(/^(.+) \(monster\)$/i);
  if (asMonster) { const m = state.dm && G.monsterInfo(state.data, asMonster[1]); return m ? { kind: 'bestiary', sel: m.key } : null; }
  const ess = G.essenceInfo(state.data, target) || {};
  const plain = ess.kind === 'unknown' ? G.essenceInfo(state.data, String(target).replace(/ essence$/i, '')) : ess;
  if (plain && plain.kind && plain.kind !== 'unknown' && !hiddenDivine().includes(plain.name)) return { kind: 'essences', tab: 'essences', sel: plain.name };
  const conf = G.confluenceInfo(state.data, target);
  if (conf) return { kind: 'essences', tab: 'confluences', sel: conf.name };
  const item = G.itemInfo(state.data, target);
  if (item) return { kind: 'items', sel: item.name };
  const spell = G.spellInfo(state.data, target);
  if (spell) return { kind: 'spell', key: spell.key };
  const monster = state.dm && G.monsterInfo(state.data, target);
  if (monster) return { kind: 'bestiary', sel: monster.key };
  return null;
}

async function followLink(target) {
  const id = resolve(target);
  if (id) return openPage(id);
  // A link to an essence, confluence or item with no wiki page of its own opens it in its browser.
  const to = catalogTarget(target);
  if (to?.kind === 'spell') return showSpell(to.key);
  if (to) return go(to);
  // Players just make the page; the DM can have a generator fill it in instead.
  if (!state.dm) {
    const ok = await confirmDialog(`Create "${target}"?`, 'No page with this name exists yet.', 'Create page');
    if (ok) await newPageFlow(target);
    return;
  }
  const page = state.view?.kind === 'page' && state.pages.get(state.view.id);
  const r = await formDialog(`Create "${target}"?`, `
    <p class="muted" style="margin:0 0 10px">No page with this name exists yet.</p>
    <label class="inline-check" style="display:flex;gap:6px;margin:4px 0"><input type="radio" name="how" value="gen" checked> Generate it with a generator</label>
    <label class="field" style="margin-left:22px">Generator<select name="kind">${genKindOptions(guessKind(target))}</select></label>
    <label class="inline-check" style="display:flex;gap:6px;margin:4px 0"><input type="radio" name="how" value="blank"> Create a blank page</label>`, 'Create', form => {
    const kind = $('select[name=kind]', form);
    form.addEventListener('change', () => { kind.disabled = form.how.value !== 'gen'; });
    kind.addEventListener('focus', () => { form.how.value = 'gen'; });
  });
  if (!r) return;
  if (r.how === 'blank') return newPageFlow(target);
  const where = page ? page.meta.title : '';
  // The NPC maker asks where they live and what they do first.
  if (r.kind === 'npc') return npcFromName(target, { place: placeAnchor(where)?.title || null });
  if (await generateNamed(target, r.kind, { where, from: page ? `named on ${page.meta.title}` : '' })) {
    await saveWorld();
    openPage(resolve(target));
  }
}

// ---------- generating a page for a red link ----------

const GEN_KINDS = [['place', 'Place (a settlement or wild site, pinned on the map)'], ['npc', 'Person (NPC)'], ['tavern', 'Tavern or inn'], ['market', 'Market']];
const genKindOptions = cur => GEN_KINDS.map(([k, label]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${esc(label)}</option>`).join('');

/** The kinds of wild site whose names end the way this one does ("Greywater Caves" is a cave). */
function siteKindsFor(name) {
  const last = String(name).trim().split(/\s+/).pop().toLowerCase();
  return Object.entries(state.data.places?.sites || {}).filter(([, s]) => (s.nouns || []).some(n => n.toLowerCase() === last)).map(([k]) => k);
}

/** Which generator most likely suits a name with no page yet. A guess: the DM can pick another. */
function guessKind(name) {
  const n = String(name).trim();
  if (/\b(market|markets|bazaar|emporium|stalls|exchange)\b/i.test(n)) return 'market';
  if (/\b(tavern|inn|arms|tankard|flagon|alehouse|taproom)\b/i.test(n)) return 'tavern';
  if ((state.data.contracts?.places || []).includes(n) || siteKindsFor(n).length) return 'place';
  if (/\b(ford|hill|bridge|hollow|mere|point|landing|cross|crossing|gate|well|harbour|port|vale|wood|town|village|fort|reach|rest|flats|pans|springs?)$/i.test(n)) return 'place';
  if (/(wick|ton|bury|ham|stead|field|brook|ford|mouth|moor|marsh|dale|mere|well|ridge|hurst|bank|gate)$/i.test(n)) return 'place';
  // Two or three capitalised words ("Mira Ashdown") read as someone's name.
  if (/^[A-Z][a-z'’-]+( [A-Z][a-z'’-]+){1,2}$/.test(n) && !/^The /.test(n)) return 'npc';
  return 'place';
}

/** A quick NPC page for a name, with no questions asked (the contract's checklist makes several at once). */
async function quickNpc(name, home) {
  const n = G.generateNPC(state.data, { wiki: wikiTitles(), twist: 'none' });
  n.name = name;
  const h = home && state.pages.get(resolve(home));
  const id = await attempt(() => api.pages.create(name, { type: 'npc', rank: n.rank, ...(h ? { parent: h.meta.title } : {}), origin: S.originFor(n.role, n.class), tags: ['generated'] },
    G.npcToMarkdown(n) + (h ? `\n## Home\n\n${n.pronoun === 'they' ? 'They live' : `${cap(n.pronoun)} lives`} in [[${h.meta.title}]].\n` : '')));
  if (!id) return false;
  state.pages.set(id, await api.pages.read(id));
  if (state.data.people && state.saved?.world) {
    const rec = ST.person(world(), name);
    if (!rec.traits.length) rec.traits = ST.rollTraits(PEOPLE(), Math.random);
  }
  return true;
}

/**
 * Makes a page called `name` with a generator: kind is place, npc, tavern or market. A place is put on the map
 * near `where` (or the nearest pinned place above it, else the campaign's start). True when the page was made.
 * The caller saves the world afterwards.
 */
async function generateNamed(name, kind, { where = '', from = '', miles = null } = {}) {
  if (resolve(name)) return false;
  const d = state.data;
  const anchor = placeAnchor(where);
  if (kind === 'npc') { const ok = await quickNpc(name, anchor?.title); if (ok) { rebuildIndex(); renderTree(); } return ok; }
  if (kind === 'place') {
    if (!d.places || !anchor) { toast(`There's no pinned place on the map to put ${name} near, so it wasn't made. Pin a place first, or make a blank page.`, true); return false; }
    const sites = siteKindsFor(name);
    const ctx = {
      anchor, want: sites.length ? ['site'] : ['settlement', 'industry'], siteKinds: sites, miles: miles || [5, 40],
      pins: pinnedPlaces().map(x => x.map), taken: takenTitles(), peoples: d.peoples?.peoples,
    };
    const draft = PL.generatePlace(d, ctx);
    if (!draft) { toast(`Couldn't find open land near ${anchor.title} for ${name}.`, true); return false; }
    draft.name = name;
    return (await keepPlaces([draft], from)) > 0;
  }
  // A tavern or market sits under the place it's in.
  const here = anchor?.title || '';
  const opts = { where: here || 'any', whereMeta: here ? state.pages.get(resolve(here))?.meta : null, settlement: 'any', kind: 'any', quality: 'any', rank: 'any', theme: 'any', wiki: wikiTitles() };
  const v = kind === 'tavern' ? G.generateTavern(d, opts) : G.generateMarket(d, opts);
  if (!v) return false;
  v.name = name;
  const md = kind === 'tavern' ? G.tavernToMarkdown(v) : G.marketToMarkdown(v);
  const id = await attempt(() => api.pages.create(name, { type: 'location', ...(kind === 'market' && v.rank ? { rank: v.rank } : {}), ...(here ? { parent: here } : {}), tags: [kind, 'generated'] }, md));
  if (!id) return false;
  state.pages.set(id, await api.pages.read(id));
  rebuildIndex(); renderTree();
  return true;
}

/** The links on a page that lead nowhere yet (red links), each once, in the order they first appear. */
function redLinksOf(body) {
  return [...new Set(linksOf(body))].filter(t => !resolve(t) && !catalogTarget(t));
}

// ---------- sidebar ----------

/** The page a page sits under in the sidebar: its `parent`, or The Churches for a church. */
function parentOf(p) {
  if (p.meta.parent === 'none') return null; // moved out to the top level by hand
  const id = (p.meta.parent && resolve(p.meta.parent)) || ([].concat(p.meta.tags || []).includes('church') && resolve('The Churches'));
  return id && id !== p.id && state.pages.has(id) && !hiddenPage(state.pages.get(id)) ? id : null;
}

/** Sidebar order and your own headers, kept with the campaign. */
function sidebarLayout() {
  const l = (state.saved.sidebar ||= {});
  l.order ||= []; l.headers ||= [];
  return l;
}
async function saveLayout() { await attempt(() => api.saved.write(state.saved)); }

/** The sidebar group a page sits in: one of your headers if it names one, else its type. */
function groupOf(p) {
  return p.meta.group && sidebarLayout().headers.includes(p.meta.group) ? 'hdr:' + p.meta.group : p.meta.type;
}
const groupLabel = k => k.startsWith('hdr:') ? k.slice(4) : typeInfo(k).group;

/** Groups in your order, with any you haven't placed in their usual spot. */
function sortGroups(keys) {
  const order = sidebarLayout().order;
  const base = k => { const i = TREE_ORDER.indexOf(k); return i < 0 ? (k.startsWith('hdr:') ? 50 : 99) : i; };
  const placed = keys.filter(k => order.includes(k)).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const rest = keys.filter(k => !order.includes(k)).sort((a, b) => base(a) - base(b));
  // Unplaced groups slot in before the first placed group that normally comes after them.
  const out = [...placed];
  for (const k of rest) {
    const i = out.findIndex(x => base(x) > base(k));
    out.splice(i >= 0 ? i : out.length, 0, k);
  }
  return out;
}

async function newHeader() {
  const r = await formDialog('New sidebar header', '<label class="field">Name<input name="name" required placeholder="e.g. Act One, The Delta, Villains"></label><p class="hint" style="margin:0">Drag pages onto it to group them there. Drag headers to reorder them.</p>', 'Add header');
  const name = r?.name?.trim();
  if (!name) return;
  const l = sidebarLayout();
  if (l.headers.includes(name) || TYPES.some(t => t.group.toLowerCase() === name.toLowerCase())) return toast('There is already a header with that name.', true);
  l.headers.push(name);
  await saveLayout();
  renderTree();
}

async function renameHeader(old) {
  const r = await formDialog('Rename header', `<label class="field">Name<input name="name" required value="${esc(old)}"></label>`, 'Rename');
  const name = r?.name?.trim();
  if (!name || name === old) return;
  const l = sidebarLayout();
  if (l.headers.includes(name)) return toast('There is already a header with that name.', true);
  l.headers = l.headers.map(h => h === old ? name : h);
  l.order = l.order.map(k => k === 'hdr:' + old ? 'hdr:' + name : k);
  try {
    const open = JSON.parse(localStorage.getItem('tree-open') || '{}');
    if ('hdr:' + old in open) { open['hdr:' + name] = open['hdr:' + old]; delete open['hdr:' + old]; localStorage.setItem('tree-open', JSON.stringify(open)); }
  } catch {}
  for (const p of state.pages.values()) if (p.meta.group === old) {
    p.meta = { ...p.meta, group: name };
    await attempt(() => api.pages.write(p.id, p.meta, p.body));
  }
  await saveLayout();
  renderTree();
}

async function deleteHeader(name) {
  const pages = [...state.pages.values()].filter(p => p.meta.group === name);
  if (pages.length && !(await confirmDialog(`Remove "${name}"?`, `Its ${pages.length} page${pages.length > 1 ? 's go' : ' goes'} back to ${pages.length > 1 ? 'their' : 'its'} own group. No page is deleted.`, 'Remove header'))) return;
  for (const p of pages) {
    const meta = { ...p.meta };
    delete meta.group;
    p.meta = meta;
    await attempt(() => api.pages.write(p.id, meta, p.body));
  }
  const l = sidebarLayout();
  l.headers = l.headers.filter(h => h !== name);
  l.order = l.order.filter(k => k !== 'hdr:' + name);
  await saveLayout();
  renderTree();
}

function renderTree() {
  const tree = $('#page-tree');
  const shown = [...state.pages.values()].filter(p => p.meta.type !== 'session' && p.meta.type !== 'pc' && p.id !== 'home' && !hiddenPage(p));
  // Pages with a parent sit under it, in its group, whatever their own type.
  const kids = new Map();
  const groups = new Map();
  for (const p of shown) {
    const up = parentOf(p);
    if (up && shown.some(x => x.id === up)) { if (!kids.has(up)) kids.set(up, []); kids.get(up).push(p); continue; }
    const k = groupOf(p);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }
  // Essences live in the compendium browser; the sidebar group links to it. Your own headers show even when empty.
  if (!groups.has('essence')) groups.set('essence', []);
  for (const h of sidebarLayout().headers) if (!groups.has('hdr:' + h)) groups.set('hdr:' + h, []);
  const openState = JSON.parse(localStorage.getItem('tree-open') || '{}');
  const keys = sortGroups([...groups.keys()]);
  const byTitle = (a, b) => a.meta.title.localeCompare(b.meta.title);
  const count = p => (kids.get(p.id) || []).reduce((n, c) => n + 1 + count(c), 0);
  // In player view, pages the DM has just revealed glow until they're opened.
  const fresh = state.dm ? [] : (r => [...r.pages, ...Object.keys(r.lines)])(reveals());
  const item = (p, depth = 0) => {
    const vis = state.dm ? `<span role="button" class="vis-btn${p.meta.dmOnly ? ' hidden-page' : ''}" data-vis="${esc(p.id)}" title="${p.meta.dmOnly ? 'Hidden from players. Click to reveal this page to them.' : 'Players can see this page. Click to hide it from them.'}">${p.meta.dmOnly ? '🔒' : '👁'}</span>` : '';
    const btn = `<button class="item${p.meta.dmOnly ? ' dm-only' : ''}${fresh.includes(p.id) ? ' fx-new-reveal' : ''}" data-id="${esc(p.id)}"${state.dm ? ' draggable="true"' : ''} title="${esc(p.meta.title)}${p.meta.dmOnly ? ' (DM only)' : ''}">${vis}${esc(p.meta.title)}</button>`;
    const under = depth < 4 ? (kids.get(p.id) || []).sort(byTitle) : [];
    if (!under.length) return btn;
    const open = openState[`page:${p.id}`] ?? false;
    return `<details class="sub" data-group="page:${esc(p.id)}" ${open ? 'open' : ''}><summary>${btn}<span class="count">${count(p)}</span></summary>
      <div class="sub-items">${under.map(c => item(c, depth + 1)).join('')}</div></details>`;
  };
  tree.innerHTML = keys.map(k => {
    const items = groups.get(k).sort(byTitle);
    const open = openState[k] ?? ['adventure', 'location', 'npc'].includes(k);
    const links = k === 'essence' ? `<button class="item link" data-nav="essences" data-tab="essences">Essence compendium</button>
      <button class="item link" data-nav="essences" data-tab="confluences">Confluences</button>
      <button class="item link" data-nav="essences" data-tab="stones">Awakening stones</button>` : '';
    const total = items.reduce((n, p) => n + 1 + count(p), 0);
    const custom = k.startsWith('hdr:');
    const tools = custom && state.dm ? `<span class="hdr-tools"><button class="hdr-btn" data-hdr-rename="${esc(k.slice(4))}" title="Rename this header">✎</button><button class="hdr-btn" data-hdr-delete="${esc(k.slice(4))}" title="Remove this header; its pages go back to their own groups">×</button></span>` : '';
    return `<details data-group="${esc(k)}" ${open ? 'open' : ''}${custom ? ' class="custom"' : ''}><summary>${state.dm ? '<span class="grip" title="Drag to move this group up or down">⠿</span>' : ''}${esc(groupLabel(k))}${tools}${total ? `<span class="count">${total}</span>` : ''}</summary>
      ${links}${items.map(p => item(p)).join('')}${custom && !items.length ? '<p class="hint tree-empty">Drag pages here.</p>' : ''}
    </details>`;
  }).join('') + (state.dm ? '<button class="link-btn new-header" id="new-header" title="Add your own heading to group pages under">+ New header</button>' : '');
  $('#new-header', tree)?.addEventListener('click', newHeader);
  $$('[data-vis]', tree).forEach(b => b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); toggleReveal(b.dataset.vis); }));
  $$('[data-hdr-rename]', tree).forEach(b => b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); renameHeader(b.dataset.hdrRename); }));
  $$('[data-hdr-delete]', tree).forEach(b => b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); deleteHeader(b.dataset.hdrDelete); }));
  $$('details', tree).forEach(d => d.addEventListener('toggle', () => {
    const s = JSON.parse(localStorage.getItem('tree-open') || '{}');
    s[d.dataset.group] = d.open;
    localStorage.setItem('tree-open', JSON.stringify(s));
  }));
  // Clicking a parent's name opens its page; the arrow beside it opens and closes the list.
  $$('details.sub > summary > button.item', tree).forEach(b => b.addEventListener('click', e => e.preventDefault()));
  renderQuick();
}

/** Shows a hidden page to players, or hides it from them again. */
async function toggleReveal(id) {
  const p = state.pages.get(id);
  if (!p) return;
  const meta = { ...p.meta };
  if (meta.dmOnly) delete meta.dmOnly; else meta.dmOnly = true;
  p.meta = meta;
  await attempt(() => api.pages.write(p.id, meta, p.body));
  noteReveal(id, !meta.dmOnly);
  rebuildIndex();
  renderTree();
  if (state.view?.kind === 'page' && state.view.id === id && !state.view.edit) render();
  // The DM sees the lock open; the players see the page clear from a mist the first time they open it.
  if (!meta.dmOnly) {
    $$(`#page-tree [data-vis="${CSS.escape(id)}"]`).forEach(b => playOnce(b, 'fx-unlock', 900));
    if (state.view?.kind === 'page' && state.view.id === id) playOnce($('#view article.page'), 'fx-unveil', 1400);
  }
  toast(meta.dmOnly ? `"${meta.title}" is hidden from players.` : `"${meta.title}" is now visible to players.`);
}

// Drag a page in the sidebar onto another page to nest it there, or onto a group's heading to move it to the
// top of that group (which also changes its type). DM mode only.
let dragId = null, dragGroup = null;
function dropTarget(e) {
  const head = e.target.closest('#page-tree details:not(.sub) > summary');
  const group = head?.parentElement.dataset.group;
  // A dragged group moves to where the group it's dropped on is.
  if (dragGroup) return group && group !== dragGroup ? { el: head, before: group } : null;
  const btn = e.target.closest('#page-tree button.item[data-id]');
  if (btn) return btn.dataset.id === dragId ? null : { el: btn, page: btn.dataset.id };
  return group && (TYPES.some(t => t.key === group) || group.startsWith('hdr:')) ? { el: head, group } : null;
}

async function moveGroup(key, onto) {
  const all = $$('#page-tree > details').map(d => d.dataset.group);
  // Dragged down, a group lands after the one it's dropped on; dragged up, before it.
  const down = all.indexOf(key) < all.indexOf(onto);
  const keys = all.filter(k => k !== key);
  keys.splice(keys.indexOf(onto) + (down ? 1 : 0), 0, key);
  sidebarLayout().order = keys;
  await saveLayout();
  renderTree();
}
function wireTreeDrag() {
  const tree = $('#page-tree');
  const clear = () => $$('.drop-on', tree).forEach(x => x.classList.remove('drop-on'));
  tree.addEventListener('dragstart', e => {
    if (!state.dm) return e.preventDefault();
    const b = e.target.closest('button.item[data-id]');
    if (!b) return e.preventDefault();
    dragId = b.dataset.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', state.pages.get(dragId)?.meta.title || '');
    b.classList.add('dragging');
  });
  // Groups move with the grip beside their name. A summary can't start a native drag, so this follows the mouse itself.
  tree.addEventListener('mousedown', e => {
    const grip = e.target.closest('.grip');
    if (!grip || !state.dm || e.button !== 0) return;
    e.preventDefault();
    const head = grip.closest('summary');
    dragGroup = head.parentElement.dataset.group;
    head.classList.add('dragging');
    const over = ev => dropTarget({ target: document.elementFromPoint(ev.clientX, ev.clientY) || tree });
    const move = ev => { clear(); const t = over(ev); if (t) t.el.classList.add('drop-on'); };
    const up = async ev => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      const t = over(ev);
      const group = dragGroup;
      dragGroup = null;
      clear(); head.classList.remove('dragging');
      if (t?.before) await moveGroup(group, t.before);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
  tree.addEventListener('click', e => { if (e.target.closest('.grip')) e.preventDefault(); });
  tree.addEventListener('dragend', e => { dragId = null; dragGroup = null; clear(); $$('.dragging', tree).forEach(x => x.classList.remove('dragging')); e.target.closest?.('button')?.classList.remove('dragging'); });
  tree.addEventListener('dragover', e => {
    if (!dragId && !dragGroup) return;
    const t = dropTarget(e);
    clear();
    if (!t) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    t.el.classList.add('drop-on');
  });
  tree.addEventListener('dragleave', e => { if (!tree.contains(e.relatedTarget)) clear(); });
  tree.addEventListener('drop', async e => {
    const t = (dragId || dragGroup) && dropTarget(e);
    const id = dragId, group = dragGroup;
    dragId = null; dragGroup = null;
    clear();
    if (!t) return;
    e.preventDefault();
    if (group) await moveGroup(group, t.before);
    else await movePage(id, t);
  });
}

async function movePage(id, to) {
  const p = state.pages.get(id);
  if (!p) return;
  if (state.editing?.id === id) await finishEditing();
  const meta = { ...p.meta };
  if (to.page) {
    // Not under itself or anything nested inside it.
    for (let up = to.page, n = 0; up && n < 20; up = parentOf(state.pages.get(up)), n++) {
      if (up === id) return toast(`${p.meta.title} can't go inside a page nested under it.`, true);
    }
    const parent = state.pages.get(to.page);
    if (parentOf(p) === to.page) return;
    meta.parent = parent.meta.title;
  } else {
    if (!parentOf(p) && groupOf(p) === to.group) return;
    meta.parent = [].concat(meta.tags || []).includes('church') ? 'none' : undefined;
    if (to.group.startsWith('hdr:')) meta.group = to.group.slice(4);
    else {
      delete meta.group;
      if (meta.type !== to.group && !['pc', 'session'].includes(to.group)) meta.type = to.group;
    }
  }
  if (meta.parent === undefined) delete meta.parent;
  await attempt(async () => {
    await api.pages.write(p.id, meta, p.body);
    p.meta = meta;
    renderTree();
    toast(to.page ? `${p.meta.title} is now under ${meta.parent}.` : `${p.meta.title} moved to ${groupLabel(to.group)}.`);
    if (state.view?.kind === 'page' && state.view.id === id && !state.view.edit) render();
  });
}

// ---------- pinned and recent pages ----------
// Pins are kept with the campaign; the recent list is just this computer's last few pages.

const pinned = () => (state.saved.pinned ||= []);
const recentKey = () => `recent:${state.campaign?.name || ''}`;
function recentPages() { try { return JSON.parse(localStorage.getItem(recentKey()) || '[]'); } catch { return []; } }
function noteRecent(id) {
  if (id === 'home') return;
  const list = [id, ...recentPages().filter(x => x !== id)].slice(0, 12);
  try { localStorage.setItem(recentKey(), JSON.stringify(list)); } catch {}
  renderQuick();
}
async function togglePin(id) {
  const list = pinned();
  const i = list.indexOf(id);
  if (i >= 0) list.splice(i, 1); else list.push(id);
  await attempt(() => api.saved.write(state.saved));
  renderQuick();
  if (i < 0) playOnce($(`#quick-pages button.item[data-id="${CSS.escape(id)}"]`), 'fx-pin-in', 900);
  playOnce($('#pin-btn'), 'fx-pin-btn', 700);
  return i < 0;
}
function renderQuick() {
  const box = $('#quick-pages');
  if (!box || !state.saved) return;
  const ok = id => state.pages.has(id) && !hiddenPage(state.pages.get(id));
  const pins = pinned().filter(ok);
  const recent = recentPages().filter(id => ok(id) && !pins.includes(id)).slice(0, 5);
  // Redrawing keeps the Recent list open or closed as it is; a fresh start remembers the last choice.
  let open = $('.qp-recent', box)?.open;
  if (open == null) try { open = localStorage.getItem('recent-open') === '1'; } catch { open = false; }
  const btn = (id, pin) => `<button class="item" data-id="${esc(id)}" title="${esc(state.pages.get(id).meta.title)}${pin ? '. Right-click to unpin.' : ''}">${pin ? '📌 ' : ''}${esc(state.pages.get(id).meta.title)}</button>`;
  box.hidden = !pins.length && !recent.length;
  box.innerHTML = (pins.length ? `<div class="qp-head">Pinned</div>${pins.map(id => btn(id, true)).join('')}` : '')
    + (recent.length ? `<details class="qp-recent"${open ? ' open' : ''}><summary class="qp-head">Recent</summary>${recent.map(id => btn(id, false)).join('')}</details>` : '');
  $('.qp-recent', box)?.addEventListener('toggle', e => { try { localStorage.setItem('recent-open', e.target.open ? '1' : '0'); } catch {} });
  renderJourneyPins();
}

function highlightNav() {
  const v = state.view || {};
  $$('#quick-pages button.item').forEach(b => b.classList.toggle('active', v.kind === 'page' && b.dataset.id === v.id));
  $$('#journey-pins [data-journey]').forEach(b => b.classList.toggle('active', v.kind === 'generators' && state.gen.tab === 'travel' && curJourney()?.id === b.dataset.journey));
  $$('#page-tree button.item').forEach(b => b.classList.toggle('active', b.dataset.id ? v.kind === 'page' && b.dataset.id === v.id : b.dataset.nav === v.kind && b.dataset.tab === (v.tab || 'essences')));
  $$('.primary-nav button').forEach(b => {
    const n = b.dataset.nav;
    const active = (n === 'home' && v.kind === 'page' && v.id === 'home') || (n === 'classes' && v.kind === 'page' && v.id === resolve('Classes')) || n === v.kind;
    b.classList.toggle('active', active);
  });
  $('#back').disabled = !state.history.length;
  $('#forward').disabled = !state.future.length;
}

// ---------- rendering ----------

function render() {
  closePicker();
  undockTray();
  const v = state.view;
  const view = $('#view');
  setSaveState('');
  view.scrollTop = 0;
  if (!state.dm && (DM_VIEWS.includes(v.kind) || (v.kind === 'page' && (v.edit || hiddenPage(state.pages.get(v.id)))))) {
    view.innerHTML = `<div class="page empty"><p>That's only available in DM mode.</p><button class="btn" data-nav="home">Go home</button></div>`;
  } else if (VIEW_SYSTEMS[v.kind] && !sysOn(VIEW_SYSTEMS[v.kind])) {
    const s = SYSTEMS.find(x => x.key === VIEW_SYSTEMS[v.kind]);
    view.innerHTML = `<div class="page empty"><p><b>${esc(s.label)}</b> is switched off for this campaign.</p><p class="muted">${esc(s.hint)}.</p>
      ${state.dm ? '<button class="btn" id="sys-open-settings">Switch it on in Settings</button> ' : ''}<button class="btn" data-nav="home">Go home</button></div>`;
    $('#sys-open-settings')?.addEventListener('click', openSettings);
  } else if (v.kind === 'page') { renderPage(v.id, v.edit); if (state.pages.has(v.id)) noteRecent(v.id); }
  else if (v.kind === 'party') renderParty();
  else if (v.kind === 'sessions') renderSessions();
  else if (v.kind === 'world') renderWorld();
  else if (v.kind === 'digest') renderDigest();
  else if (v.kind === 'news') renderNews();
  else if (v.kind === 'legends') renderLegends();
  else if (v.kind === 'hooks') renderSavedHooks();
  else if (v.kind === 'generators') renderGenerators();
  else if (v.kind === 'lists') renderLists();
  else if (v.kind === 'search') renderSearch(v.q);
  else if (v.kind === 'essences') renderEssences();
  else if (v.kind === 'items') renderItems();
  else if (v.kind === 'spells') renderSpells();
  else if (v.kind === 'bestiary') renderBestiary();
  else if (v.kind === 'map') renderMap();
  else if (v.kind === 'battle') renderBattle();
  else if (v.kind === 'campaigns') renderCampaigns();
  else if (v.kind === 'trash') renderTrash();
  highlightNav();
  $('#crumbs').textContent = crumb(v);
}

function crumb(v) {
  if (v.kind === 'page') {
    const p = state.pages.get(v.id);
    return p ? `${typeInfo(p.meta.type).group} / ${p.meta.title}` : '';
  }
  return { world: 'The world', news: 'News and rumours', party: 'Party', essences: 'Essences', items: 'Items', spells: 'Spells', bestiary: 'Bestiary', battle: 'Battle', map: 'World map', sessions: 'Sessions', generators: 'Generators', hooks: 'Saved hooks', lists: 'Generator lists', search: 'Search', campaigns: 'Campaigns', trash: 'Trash' }[v.kind] || '';
}

function backlinksFor(id) {
  const sessions = [];
  const others = [];
  for (const p of visiblePages()) {
    if (p.id === id) continue;
    const lines = shownBody(p).split('\n').filter(line => linksOf(line).some(t => resolve(t) === id));
    if (!lines.length) continue;
    if (p.meta.type === 'session') sessions.push({ p, lines });
    else others.push(p);
  }
  sessions.sort((a, b) => (Number(a.p.meta.number) || 0) - (Number(b.p.meta.number) || 0));
  others.sort((a, b) => a.meta.title.localeCompare(b.meta.title));
  return { sessions, others };
}

function renderPage(id, edit) {
  const view = $('#view');
  const p = state.pages.get(id);
  if (!p) {
    view.innerHTML = `<div class="page empty"><p>This page no longer exists.</p><button class="btn" data-nav="home">Go home</button></div>`;
    return;
  }
  if (edit) return renderEditor(p);
  const m = p.meta;
  const rank = m.type === 'pc' ? G.pcRank(m) : m.rank;
  const { sessions, others } = backlinksFor(id);
  const told = pageChronicle(p);
  const nums = m.type === 'location' && mapPoint(p) && state.data.story ? placeNums(m.title) : null;
  // Sheets and stat blocks use the window's width; the page's own text keeps a readable line length.
  const sheetPage = m.type === 'pc' || m.type === 'npc' || /class="statblock"/.test(p.body);
  view.innerHTML = `<article class="page${sheetPage ? ' sheet-page' : ''}" data-who="${esc(m.title)}">
    <div class="page-head">
      <h1>${esc(m.title)}</h1>
      ${m.type === 'pc' ? '<button class="btn" id="export-sheet" title="Save this sheet as a file to send to the DM or a player">Export sheet</button>' : ''}
      ${m.type === 'pc' || (m.type === 'npc' && npcFights(p)) ? `<button class="btn${m.type === 'npc' ? ' dm-tool' : ''}" id="export-pdf" title="Fill in a classic 5e character sheet PDF with ${m.type === 'pc' ? 'this sheet' : 'this stat block'}. Its fields stay editable.">PDF sheet</button>` : ''}
      <button class="btn" id="pin-btn" title="${pinned().includes(id) ? 'Take it off the pinned list in the sidebar' : 'Keep this page at the top of the sidebar'}">${pinned().includes(id) ? 'Unpin' : '📌 Pin'}</button>
      <button class="btn dm-tool" id="reveal-btn" title="${m.dmOnly ? 'Players cannot see this page. Click to reveal it to them.' : 'Players can see this page. Click to hide it from them.'}">${m.dmOnly ? '🔒 Reveal to players' : '👁 Hide from players'}</button>
      <button class="btn dm-tool" id="edit-btn" title="Edit (Ctrl+E)">Edit</button>
      <button class="btn danger dm-tool" id="delete-btn">Delete</button>
    </div>
    <div class="badges">
      <span class="badge type">${esc(typeInfo(m.type).label)}</span>
      ${rank ? `<span class="badge rank rank-${esc(rank)}">${esc(rank)}</span>` : ''}
      ${m.type === 'session' && m.date ? `<span class="badge">${esc(m.date)}</span>` : ''}
      ${m.type === 'session' && Number.isFinite(Number(m.worldDay)) && m.worldDay !== '' && state.data.calendar ? `<span class="badge" title="The date in the world when this session began">${esc(fmtDay(Number(m.worldDay)))}</span>` : ''}
      ${nums ? `<span class="badge dm-tool" title="How the place is doing. Advance time moves these; change them in Edit.">Prosperity ${nums.prosperity} · Safety ${nums.safety} · ${nums.population.toLocaleString()} people</span>` : ''}
      ${m.type === 'location' && G.settlementFor(state.data, m.title, m) ? `<span class="badge" title="What its shops sell: see Items and Equipment">${esc(G.settlementInfo(state.data, G.settlementFor(state.data, m.title, m))?.label || '')}${G.placeMagic(state.data, m.title, m) !== 'moderate' ? `, ${esc((state.data.items?.magicLevels?.[G.placeMagic(state.data, m.title, m)]?.label || '').toLowerCase())}` : ''}</span>` : ''}
      ${[].concat(m.tags || []).map(t => `<span class="badge">#${esc(t)}</span>`).join('')}
      ${m.dmOnly ? '<span class="badge dm">DM only</span>' : ''}
    </div>
    ${m.type === 'essence' && G.essenceThemes(state.data).includes(m.title.replace(/ essence$/i, '')) ? `<p class="hint"><a href="#" class="jump" data-aff="${esc(m.title.replace(/ essence$/i, ''))}">Browse every ${esc(m.title.replace(/ essence$/i, ''))}-affinity essence</a> in the essences browser.</p>` : ''}
    ${m.type === 'item' && G.itemInfo(state.data, m.title) ? `<p class="hint"><a href="#" class="jump" data-jump="items" data-name="${esc(G.itemInfo(state.data, m.title).name)}">Price and where to find it</a> in the items browser.</p>` : ''}
    ${mapPoint(p) || mapBorder(p).length >= 3 || journeyTarget(p) ? `<p class="hint">${mapPoint(p) || mapBorder(p).length >= 3 ? `<a href="#" class="jump" data-jump="map" data-id="${esc(p.id)}">Show on the world map</a>` : ''}${journeyTarget(p) ? `<span class="dm-tool" data-sys="travel">${mapPoint(p) || mapBorder(p).length >= 3 ? ' · ' : ''}<a href="#" class="jump" data-jump="journey" data-id="${esc(journeyTarget(p).id)}">🧭 Plan journey to ${esc(journeyTarget(p).name)}</a></span>` : ''}</p>` : ''}
    ${m.type === 'pc' ? '<div id="sheet"></div>' : ''}
    ${m.type === 'npc' && npcFights(p) ? `<div class="npc-panels">${npcAttunedPanel(p) + npcClassPanel(p)}</div>` : ''}
    ${m.image ? `<figure class="portrait"><img src="${esc(imageSrc(m.image))}" alt=""></figure>` : ''}
    <div class="prose">${renderMarkdown(p.body)}</div>
    ${troublesSection(p)}
    ${sysOn('trade') && state.data.calendar && state.saved ? marketLine(p) : ''}
    ${sysOn('world') ? questOutcome(p) : ''}
    ${pagePanels(p)}
    ${told.length && sysOn('world') ? `<section class="backlinks chronicle-history"><h2>History</h2><ul class="chronicle">${told.map(e => entryRow(e, { actions: false })).join('')}</ul></section>` : ''}
    ${sessions.length ? `<section class="backlinks"><h2>${told.length ? 'In the sessions' : 'History'}</h2><ul>
      ${sessions.map(s => `<li><a class="wikilink" data-id="${esc(s.p.id)}">${esc(s.p.meta.title)}</a>${s.p.meta.date ? ` <span class="muted">(${esc(s.p.meta.date)})</span>` : ''}
        ${s.lines.slice(0, 3).map(l => `<div class="snippet">${inlineMarkdown(l.replace(/^\s*[-*]\s+/, ''))}</div>`).join('')}</li>`).join('')}
    </ul></section>` : ''}
    ${others.length ? `<section class="backlinks"><h2>Linked from</h2><p>${others.map(o => `<a class="wikilink" data-id="${esc(o.id)}">${esc(o.meta.title)}</a>`).join(' · ')}</p></section>` : ''}
  </article>`;
  $('#edit-btn').onclick = () => go({ kind: 'page', id, edit: true }, { replace: true });
  $('#delete-btn').onclick = () => deletePage(id);
  $('#reveal-btn').onclick = () => toggleReveal(id);
  $('#pin-btn').onclick = async () => { const on = await togglePin(id); $('#pin-btn').textContent = on ? 'Unpin' : '📌 Pin'; };
  if (m.type === 'pc') { renderSheet($('#sheet'), p); $('#export-sheet').onclick = () => exportSheet(id); }
  if (m.type === 'npc') {
    // The stat block comes first; attuned items and class features sit under it.
    const sb = $('.prose .statblock', view), panels = $('.npc-panels', view);
    if (sb && panels) sb.after(panels);
    wireNpcAttuned(p); wireNpcClass(p);
  }
  if ($('#export-pdf')) $('#export-pdf').onclick = () => exportSheetPdf(id);
  wireDmStrip(p);
  wireTroubles(p);
  wireStanding(p);
  wirePerson(p);
  wireFaction(p);
  wireControl(p);
  wireChildren(p);
  linkStatClasses($('article.page') || document);
  $('#person-child')?.addEventListener('click', () => addChildDialog(p));
  wireWhoIsThere(p);
  wireTrade(p);
  $$('[data-add-here]').forEach(b => b.onclick = () => addHere(p, b.dataset.addHere));
  $('#quest-outcome')?.addEventListener('click', async e => { await outcomeDialog(e.currentTarget.dataset.entry); renderPage(p.id); });
  $('#contract-accept')?.addEventListener('click', async () => { if (await acceptContract(p.meta.title)) renderPage(p.id); });
  $('#world-to-notes')?.addEventListener('click', () => worldToNotes(p));
  playReveal($('article.page', view), id);
}

/** The world's panels on a page. For the DM they fold into one strip of tabs, closed until one is opened,
 * so the page's own text comes first. Players see their parts of them as before. */
function pagePanels(p) {
  const panels = [
    ['tools', 'Add here', sysOn('towntools') && state.dm ? placeToolsSection(p) : ''],
    ['trade', 'Trade goods', sysOn('trade') && state.dm && state.data.calendar && state.saved ? tradeSection(p) : ''],
    ['standing', 'Standing', sysOn('reputation') ? standingSection(p) : ''],
    ['control', 'Control point', sysOn('factions') ? controlSection(p) : ''],
    ['faces', 'Familiar faces', sysOn('people') ? facesSection(p) : ''],
    ['person', 'Their story', sysOn('people') ? personSection(p) : ''],
    ['faction', 'Its aims', sysOn('factions') ? factionSection(p) : ''],
    ['world', 'In the world', sysOn('world') ? sessionWorld(p) : ''],
    ['roll', 'Roll here', state.dm && p.meta.type === 'location' ? rollHereSection(p) : ''],
  ].filter(x => x[2]);
  if (!state.dm || !panels.length) return panels.map(x => x[2]).join('');
  const cur = panels.some(x => x[0] === stripOpen(p.meta.type)) ? stripOpen(p.meta.type) : '';
  return `<section class="dm-strip dm-tool"><div class="dm-strip-tabs"><span class="dm-strip-label" title="Tools and the world's workings for this page. Players never see this strip.">DM tools</span>
    ${panels.map(([k, label]) => `<button class="chip${k === cur ? ' on' : ''}" data-strip="${k}">${esc(label)}</button>`).join('')}</div>
    ${panels.map(([k, , html]) => `<div class="dm-strip-panel" data-strip-panel="${k}"${k === cur ? '' : ' hidden'}>${html}</div>`).join('')}</section>`;
}

/** Which strip tab is open, kept per kind of page on this computer: open Trade on one town and the next town opens on Trade too. */
function stripOpen(type, set) {
  let o = {};
  try { o = JSON.parse(localStorage.getItem('dm-strip') || '{}'); } catch {}
  if (set === undefined) return o[type] || '';
  o[type] = set;
  try { localStorage.setItem('dm-strip', JSON.stringify(o)); } catch {}
}

/** The DM tools strip's Roll here tab on a place: any generator, with this place already picked. */
function rollHereSection(p) {
  const tabs = [['visit', 'Prep a visit'], ['npc', 'An NPC'], ['encounter', 'An encounter'], ['tavern', 'A tavern'], ['market', 'A market'], ['contracts', 'A contract board', 'contracts'], ['auction', 'An auction', 'auction']]
    .filter(([t, , sys]) => (!sys || sysOn(sys)) && (t !== 'contracts' || hasBoard(p)));
  return `<div class="roll-here"><p class="hint" style="margin:0 0 6px">Opens the generator with ${esc(p.meta.title)} as the place, and rolls.</p>
    ${tabs.map(([t, label]) => `<button class="btn small" data-roll-here="${t}">${esc(label)}</button>`).join(' ')}</div>`;
}
async function rollHere(tab, where) {
  const g = state.gen;
  g.tab = tab;
  g.opts[tab] = { ...(g.opts[tab] || {}), where };
  await go({ kind: 'generators' });
  const f = $('#gen-form');
  if (f && f.elements.where) { f.elements.where.value = where; f.requestSubmit(); }
}

function wireDmStrip(p) {
  $$('[data-roll-here]').forEach(b => b.onclick = () => rollHere(b.dataset.rollHere, p.meta.title));
  $$('[data-strip]').forEach(b => b.onclick = () => {
    const k = b.classList.contains('on') ? '' : b.dataset.strip;
    stripOpen(p.meta.type, k);
    $$('[data-strip]').forEach(x => x.classList.toggle('on', x.dataset.strip === k));
    $$('[data-strip-panel]').forEach(x => { x.hidden = x.dataset.stripPanel !== k; });
  });
}

async function deletePage(id) {
  const p = state.pages.get(id);
  if (id === 'home') return toast('The home page cannot be deleted.', true);
  const ok = await confirmDialog(`Delete "${p.meta.title}"?`, 'It goes to the Trash (at the bottom of the sidebar), where you can restore it for 30 days.', 'Delete');
  if (!ok) return;
  await fadeOut($('#view article.page'));
  await attempt(async () => {
    await api.pages.delete(id);
    state.pages.delete(id);
    // Their story goes in the trash with them: a new page with the same title starts fresh, and Restore brings it back.
    const w = state.saved?.world;
    if (w && (w.people?.[p.meta.title] || w.factions?.[p.meta.title])) {
      (w.binned ||= {})[id] = { title: p.meta.title, person: w.people?.[p.meta.title] || null, faction: w.factions?.[p.meta.title] || null };
      if (w.people) delete w.people[p.meta.title];
      if (w.factions) delete w.factions[p.meta.title];
      await saveWorld();
    }
    rebuildIndex();
    renderTree();
    state.history = state.history.filter(v => !(v.kind === 'page' && v.id === id));
    state.view = null;
    go({ kind: 'page', id: 'home' });
    toast(`"${p.meta.title}" is in the Trash.`);
  });
  // If it couldn't be deleted, the page fades back in.
  if (state.pages.has(id)) $('#view article.page')?.classList.remove('fx-leave');
}

// ---------- trash ----------

async function renderTrash() {
  const view = $('#view');
  const list = await attempt(() => api.trash.list()) || [];
  if (state.view?.kind !== 'trash') return;
  const when = t => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  view.innerHTML = `<div class="wide">
    <div class="row" style="margin-bottom:12px"><h1 style="flex:1;margin:0;font:600 32px var(--serif)">Trash</h1>
      ${list.length ? '<button class="btn danger" id="trash-empty">Empty the trash</button>' : ''}</div>
    <p class="hint">Deleted pages stay here for 30 days. Restoring one puts it back where it was, links and all.</p>
    ${list.length ? `<div class="trash-list">${list.map(t => `<div class="trash-row" data-file="${esc(t.file)}">
        <div><b>${esc(t.title)}</b> <span class="muted">${esc(typeInfo(t.type).label || '')} · deleted ${esc(when(t.deleted))}</span></div>
        <span class="spacer"></span><button class="btn small primary" data-restore>Restore</button><button class="btn small danger" data-forever>Delete forever</button></div>`).join('')}</div>`
      : '<div class="empty"><p>The trash is empty.</p></div>'}
  </div>`;
  $$('.trash-row [data-restore]', view).forEach(b => b.onclick = () => attempt(async () => {
    const id = await api.trash.restore(b.closest('[data-file]').dataset.file);
    await fadeOut(b.closest('[data-file]'), 'fx-leave restore');
    state.pages.set(id, await api.pages.read(id));
    const w = state.saved?.world, was = w?.binned?.[id];
    if (was) {
      const t = state.pages.get(id).meta.title;
      if (was.person && !w.people?.[t]) (w.people ||= {})[t] = was.person;
      if (was.faction && !w.factions?.[t]) (w.factions ||= {})[t] = was.faction;
      delete w.binned[id];
      await saveWorld();
    }
    rebuildIndex();
    renderTree();
    toast(`"${state.pages.get(id).meta.title}" is back.`);
    renderTrash();
  }));
  $$('.trash-row [data-forever]', view).forEach(b => b.onclick = async () => {
    const row = b.closest('[data-file]');
    if (!(await confirmDialog(`Delete "${$('b', row).textContent}" forever?`, 'This can\'t be undone.', 'Delete forever'))) return;
    await attempt(() => api.trash.delete(row.dataset.file));
    await fadeOut(row);
    renderTrash();
  });
  $('#trash-empty', view)?.addEventListener('click', async () => {
    if (!(await confirmDialog('Empty the trash?', `${list.length} page${list.length > 1 ? 's' : ''} will be gone for good.`, 'Empty the trash'))) return;
    await attempt(() => api.trash.empty());
    $$('.trash-row', view).forEach((r, i) => r.style.setProperty('--d', `${Math.min(i * 40, 400)}ms`));
    await fadeOut($('.trash-list', view), 'fx-leave-all');
    renderTrash();
  });
}

// ---------- editor ----------

function renderEditor(p) {
  const view = $('#view');
  state.editing = { id: p.id, meta: structuredClone(p.meta), body: p.body, originalTitle: p.meta.title };
  const ed = state.editing;
  view.innerHTML = `<div class="page editor">
    <div class="row">
      <h1 style="flex:1;margin:0;font:600 24px var(--serif)">Editing</h1>
      <span class="hint">Changes save automatically.</span>
      <button class="btn primary" id="done-btn" title="Done (Ctrl+E)">Done</button>
    </div>
    <div class="meta">
      <label class="field">Title<input id="ed-title" value="${esc(ed.meta.title)}"></label>
      <label class="field">Type<select id="ed-type">${TYPES.map(t => `<option value="${t.key}" ${t.key === ed.meta.type ? 'selected' : ''}>${t.label}</option>`).join('')}</select></label>
      <label class="field">Tags (comma separated)<input id="ed-tags" value="${esc([].concat(ed.meta.tags || []).join(', '))}"></label>
    </div>
    <div class="row">
      ${!['pc', 'session'].includes(ed.meta.type) ? `<label class="field" style="width:160px">Rank<select id="ed-rank"><option value="">(none)</option>${G.RANKS.map(r => `<option ${r === ed.meta.rank ? 'selected' : ''}>${r}</option>`).join('')}</select></label>` : ''}
      ${ed.meta.type === 'location' ? (() => { const dflt = G.settlementFor(state.data, ed.meta.title); return `<label class="field" style="width:190px" title="Sets what its shops sell and whether it has an auction house">Settlement<select id="ed-settlement"><option value="">${dflt ? `Default (${esc(G.settlementInfo(state.data, dflt)?.label || dflt)})` : '(not a settlement)'}</option>${G.SETTLEMENTS.map(x => `<option value="${esc(x)}" ${x === ed.meta.settlement ? 'selected' : ''}>${esc(G.settlementInfo(state.data, x)?.label || cap(x))}</option>`).join('')}</select></label>
        <label class="field" style="width:170px" title="In a low-magic place, rare goods are scarce and high-rank goods rarer still">Magic level<select id="ed-magic"><option value="">Default (${esc(state.data.items?.magicLevels?.[G.placeMagic(state.data, ed.meta.title)]?.label || 'Moderate magic')})</option>${Object.entries(state.data.items?.magicLevels || {}).map(([k, x]) => `<option value="${esc(k)}" ${k === ed.meta.magic ? 'selected' : ''}>${esc(x.label || k)}</option>`).join('')}</select></label>`; })() : ''}
      ${ed.meta.type === 'session' ? `<label class="field" style="width:110px">Session no.<input id="ed-number" type="number" value="${esc(ed.meta.number ?? '')}"></label>
        <label class="field" style="width:170px">Date<input id="ed-date" value="${esc(ed.meta.date ?? '')}"></label>
        ${state.data.calendar ? `<label class="field" style="width:200px" title="The date in the world when this session began">World date<input id="ed-worldday" value="${esc(Number.isFinite(Number(ed.meta.worldDay)) && ed.meta.worldDay !== '' && ed.meta.worldDay != null ? fmtDay(Number(ed.meta.worldDay)) : '')}" placeholder="12 Ches, year 1"></label>` : ''}` : ''}
      ${ed.meta.type === 'location' && state.data.story && storySettlement({ meta: ed.meta }) ? (() => { const n = ST.placeState(state.data.story, { settlement: storySettlement({ meta: ed.meta }), meta: {} }); const f = (k, label, hint, max = 100) => `<label class="field" style="width:110px" title="${hint}">${label}<input id="ed-${k}" type="number" min="0" ${max ? `max="${max}"` : ''} value="${esc(ed.meta[k] ?? '')}" placeholder="${n[k]}"></label>`; return f('prosperity', 'Prosperity', 'How well off the place is, 0 to 100. Advance time moves it.') + f('safety', 'Safety', 'How safe the place and its roads are, 0 to 100. Troubles wear it down.') + f('population', 'Population', 'How many people live there', 0); })() : ''}
      ${!['pc', 'session'].includes(ed.meta.type) ? `<label class="field" style="width:220px" title="Show this page under another one in the sidebar, like a church under The Churches">Nested under<input id="ed-parent" value="${esc(ed.meta.parent === 'none' ? '' : ed.meta.parent ?? '')}" placeholder="(top level)"></label>` : ''}
      <div class="field image-slot" id="image-slot"></div>
    </div>
    <div class="toolbar">
      <button class="btn small" data-wrap="**">Bold</button>
      <button class="btn small" data-wrap="*">Italic</button>
      <button class="btn small" data-prefix="## ">Heading</button>
      <button class="btn small" data-prefix="- ">List</button>
      <button class="btn small" id="link-btn" title="Or type [[ in the text">Link to page</button>
      <button class="btn small" id="img-btn">Insert image</button>
      <button class="btn small" id="dm-btn" title="Text inside a DM block is hidden in player view">DM block</button>
      <label class="check" title="Hide the whole page in player view"><input type="checkbox" id="ed-dmonly" ${ed.meta.dmOnly ? 'checked' : ''}> DM-only page</label>
      <span class="hint">Type <code>[[</code> to link a page. Drag or paste images into the text.</span>
    </div>
    <textarea class="body" id="ed-body" spellcheck="true">${esc(ed.body)}</textarea>
    <input type="file" id="img-file" accept="image/*" hidden>
  </div>`;

  const body = $('#ed-body');
  const changed = () => scheduleSave();
  $('#ed-title').oninput = e => { ed.meta.title = e.target.value; changed(); };
  $('#ed-type').onchange = e => { ed.meta.type = e.target.value; if (ed.meta.type === 'cult') ed.meta.dmOnly = true; changed(); saveNow().then(() => go({ kind: 'page', id: ed.id, edit: true }, { replace: true })); };
  $('#ed-tags').oninput = e => { ed.meta.tags = e.target.value.split(',').map(s => s.trim()).filter(Boolean); changed(); };
  if ($('#ed-rank')) $('#ed-rank').onchange = e => { ed.meta.rank = e.target.value || undefined; changed(); };
  if ($('#ed-parent')) {
    attachPicker($('#ed-parent'), () => [...state.pages.values()].filter(x => x.id !== ed.id && !['pc', 'session'].includes(x.meta.type)).map(x => ({ value: x.meta.title, label: typeInfo(x.meta.type).label })));
    $('#ed-parent').addEventListener('change', e => { ed.meta.parent = e.target.value.trim() || undefined; changed(); });
  }
  if ($('#ed-settlement')) $('#ed-settlement').onchange = e => { ed.meta.settlement = e.target.value || undefined; changed(); };
  if ($('#ed-magic')) $('#ed-magic').onchange = e => { ed.meta.magic = e.target.value || undefined; changed(); };
  if ($('#ed-number')) $('#ed-number').oninput = e => { ed.meta.number = e.target.value ? Number(e.target.value) : undefined; changed(); };
  if ($('#ed-date')) $('#ed-date').oninput = e => { ed.meta.date = e.target.value; changed(); };
  if ($('#ed-worldday')) $('#ed-worldday').onchange = e => {
    const n = e.target.value.trim() ? ST.parseDate(cal(), e.target.value, ST.dateOf(cal(), today()).year) : null;
    if (e.target.value.trim() && n === null) return toast(`"${e.target.value}" isn't a date I can read. Try "12 Ches, year 1".`, true);
    ed.meta.worldDay = n ?? undefined;
    changed();
  };
  for (const k of ['prosperity', 'safety', 'population']) if ($(`#ed-${k}`)) $(`#ed-${k}`).oninput = e => { ed.meta[k] = e.target.value === '' ? undefined : Number(e.target.value); changed(); };
  body.oninput = () => { ed.body = body.value; changed(); autocomplete(body); };
  $('#ed-dmonly').onchange = e => { ed.meta.dmOnly = e.target.checked || undefined; changed(); };
  $('#dm-btn').onclick = () => {
    const { selectionStart: s, selectionEnd: e, value } = body;
    const sel = value.slice(s, e) || 'Secret notes';
    const before = s && value[s - 1] !== '\n' ? '\n' : '';
    body.value = value.slice(0, s) + `${before}:::dm\n${sel}\n:::\n` + value.slice(e);
    body.selectionStart = s + before.length + 6;
    body.selectionEnd = body.selectionStart + sel.length;
    body.dispatchEvent(new Event('input'));
    body.focus();
  };
  body.onkeydown = e => autocompleteKey(e, body);
  body.onblur = () => setTimeout(closeAutocomplete, 150);
  $('#done-btn').onclick = () => go({ kind: 'page', id: ed.id }, { replace: true });

  $$('[data-wrap]').forEach(b => b.onclick = () => wrapSelection(body, b.dataset.wrap));
  $$('[data-prefix]').forEach(b => b.onclick = () => prefixLine(body, b.dataset.prefix));
  $('#link-btn').onclick = () => { insertAtCursor(body, '[['); autocomplete(body); };
  $('#img-btn').onclick = () => $('#img-file').click();
  $('#img-file').onchange = async e => {
    for (const f of e.target.files) await insertImageFile(body, f);
    e.target.value = '';
  };

  body.addEventListener('dragover', e => { if (hasFiles(e)) { e.preventDefault(); body.classList.add('drop-hot'); } });
  body.addEventListener('dragleave', () => body.classList.remove('drop-hot'));
  body.addEventListener('drop', async e => {
    body.classList.remove('drop-hot');
    if (!hasFiles(e)) return;
    e.preventDefault();
    for (const f of e.dataTransfer.files) if (f.type.startsWith('image/')) await insertImageFile(body, f);
  });
  body.addEventListener('paste', async e => {
    const files = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    for (const f of files) await insertImageFile(body, f);
  });

  renderImageSlot();
  body.focus();
}

function renderImageSlot() {
  const ed = state.editing;
  const slot = $('#image-slot');
  if (!slot) return;
  const label = ed.meta.type === 'pc' || ed.meta.type === 'npc' ? 'Portrait' : 'Page image';
  slot.innerHTML = `<span>${label}</span>
    ${ed.meta.image ? `<img src="${esc(imageSrc(ed.meta.image))}" alt="">` : ''}
    <button class="btn small" id="portrait-btn">${ed.meta.image ? 'Replace' : 'Add'}</button>
    ${ed.meta.image ? '<button class="btn small" id="portrait-clear">Remove</button>' : ''}
    <input type="file" id="portrait-file" accept="image/*" hidden>`;
  slot.style.flexDirection = 'row';
  $('#portrait-btn').onclick = () => $('#portrait-file').click();
  $('#portrait-file').onchange = async e => {
    const f = e.target.files[0];
    if (!f) return;
    const path = await attempt(async () => api.images.save(f.name, await f.arrayBuffer()));
    if (path) { ed.meta.image = path; scheduleSave(); renderImageSlot(); }
  };
  if ($('#portrait-clear')) $('#portrait-clear').onclick = () => { delete ed.meta.image; scheduleSave(); renderImageSlot(); };
  slot.ondragover = e => { if (hasFiles(e)) { e.preventDefault(); slot.classList.add('drop-hot'); } };
  slot.ondragleave = () => slot.classList.remove('drop-hot');
  slot.ondrop = async e => {
    slot.classList.remove('drop-hot');
    const f = [...e.dataTransfer.files].find(x => x.type.startsWith('image/'));
    if (!f) return;
    e.preventDefault();
    const path = await attempt(async () => api.images.save(f.name, await f.arrayBuffer()));
    if (path) { ed.meta.image = path; scheduleSave(); renderImageSlot(); }
  };
}

const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');

async function insertImageFile(textarea, file) {
  const path = await attempt(async () => api.images.save(file.name || 'pasted.png', await file.arrayBuffer()));
  if (!path) return;
  insertAtCursor(textarea, `\n![${file.name.replace(/\.[^.]+$/, '')}](${path})\n`);
  toast('Image added');
}

function insertAtCursor(ta, text) {
  const { selectionStart: s, selectionEnd: e, value } = ta;
  ta.value = value.slice(0, s) + text + value.slice(e);
  ta.selectionStart = ta.selectionEnd = s + text.length;
  ta.dispatchEvent(new Event('input'));
  ta.focus();
}

function wrapSelection(ta, mark) {
  const { selectionStart: s, selectionEnd: e, value } = ta;
  const sel = value.slice(s, e) || 'text';
  ta.value = value.slice(0, s) + mark + sel + mark + value.slice(e);
  ta.selectionStart = s + mark.length;
  ta.selectionEnd = s + mark.length + sel.length;
  ta.dispatchEvent(new Event('input'));
  ta.focus();
}

function prefixLine(ta, prefix) {
  const { selectionStart: s, value } = ta;
  const lineStart = value.lastIndexOf('\n', s - 1) + 1;
  ta.value = value.slice(0, lineStart) + prefix + value.slice(lineStart);
  ta.selectionStart = ta.selectionEnd = s + prefix.length;
  ta.dispatchEvent(new Event('input'));
  ta.focus();
}

// ---------- searchable pickers ----------
// A long list in a dropdown that scrolls and stays on screen, in place of a <datalist>, whose popup
// can't be scrolled and runs off the window when it holds hundreds of essences.

let picker = null;

function closePicker() { if (picker) { picker.el.remove(); picker = null; } }

/** items: a function returning [{ value, label }]. Choosing one fills the input and fires its change event. */
/** True while a dialog puts the cursor in its first field, so the suggestion list doesn't open over the buttons. */
let pickerQuiet = false;
function attachPicker(input, items) {
  input.setAttribute('autocomplete', 'off');
  input.removeAttribute('list');
  const draw = (showAll = false) => {
    const q = input.value.trim().toLowerCase();
    const all = items();
    const filter = !showAll && q;
    let hits = filter ? all.filter(x => x.value.toLowerCase().includes(q) || (x.label || '').toLowerCase().includes(q)) : all;
    if (filter) hits = [...hits.filter(x => x.value.toLowerCase().startsWith(q)), ...hits.filter(x => !x.value.toLowerCase().startsWith(q))];
    if (!picker || picker.input !== input) { closePicker(); picker = { el: document.createElement('div'), input, sel: -1 }; picker.el.className = 'picker'; (input.closest('dialog') || document.body).appendChild(picker.el); }
    picker.items = hits.slice(0, 300);
    picker.sel = Math.min(picker.sel, picker.items.length - 1);
    picker.el.innerHTML = picker.items.length
      ? picker.items.map((x, i) => `<div data-i="${i}" class="${i === picker.sel ? 'sel' : ''}"><span>${esc(x.value)}</span>${x.label ? `<small>${esc(x.label)}</small>` : ''}</div>`).join('') + (hits.length > 300 ? `<div class="muted">${hits.length - 300} more; keep typing to narrow it down</div>` : '')
      : '<div class="muted">No match</div>';
    $$('div[data-i]', picker.el).forEach(d => d.onmousedown = e => { e.preventDefault(); choose(Number(d.dataset.i)); });
    place();
  };
  const place = () => {
    if (!picker) return;
    const r = input.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 8, above = r.top - 8;
    const up = below < 220 && above > below;
    const h = Math.min(320, up ? above : below);
    Object.assign(picker.el.style, { left: `${Math.max(4, Math.min(r.left, window.innerWidth - Math.max(r.width, 300) - 4))}px`, width: `${Math.max(r.width, 300)}px`, maxHeight: `${h}px`,
      top: up ? '' : `${r.bottom + 2}px`, bottom: up ? `${window.innerHeight - r.top + 2}px` : '' });
  };
  const choose = i => {
    const x = picker?.items[i];
    closePicker();
    if (!x) return;
    input.value = x.value;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  input.addEventListener('focus', () => { if (!pickerQuiet) draw(true); });
  input.addEventListener('click', () => { if (!picker) draw(true); });
  input.addEventListener('input', () => draw());
  input.addEventListener('blur', () => setTimeout(() => { if (picker?.input === input) closePicker(); }, 150));
  input.addEventListener('keydown', e => {
    if (!picker || picker.input !== input || !picker.items.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = picker.items.length;
      picker.sel = e.key === 'ArrowDown' ? (picker.sel + 1) % n : (picker.sel - 1 + n) % n;
      $$('div[data-i]', picker.el).forEach((d, i) => d.classList.toggle('sel', i === picker.sel));
      $(`div[data-i="${picker.sel}"]`, picker.el)?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && picker.sel >= 0) {
      e.preventDefault();
      const x = picker.items[picker.sel];
      closePicker();
      input.value = x.value;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (e.key === 'Escape') { e.preventDefault(); closePicker(); } // in a dialog, Escape closes the list first
  });
}

// [[ autocomplete

let ac = null;

function closeAutocomplete() { if (ac) { ac.el.remove(); ac = null; } }

function autocomplete(ta) {
  const before = ta.value.slice(0, ta.selectionStart);
  const m = before.match(/\[\[([^\]\n|]*)$/);
  if (!m) return closeAutocomplete();
  const q = m[1].toLowerCase();
  const matches = [...state.pages.values()]
    .filter(p => p.meta.title.toLowerCase().includes(q))
    .sort((a, b) => (a.meta.title.toLowerCase().startsWith(q) ? 0 : 1) - (b.meta.title.toLowerCase().startsWith(q) ? 0 : 1) || a.meta.title.localeCompare(b.meta.title))
    .slice(0, 12);
  if (!ac) { ac = { el: document.createElement('div'), sel: 0 }; ac.el.className = 'autocomplete'; document.body.appendChild(ac.el); }
  ac.items = matches;
  ac.query = m[1];
  ac.sel = Math.min(ac.sel, Math.max(0, matches.length - 1));
  if (!matches.length) {
    ac.el.innerHTML = `<div class="muted">No match. Close with ]] to make a new link.</div>`;
  } else {
    ac.el.innerHTML = matches.map((p, i) => `<div data-i="${i}" class="${i === ac.sel ? 'sel' : ''}">${esc(p.meta.title)}<small>${esc(typeInfo(p.meta.type).label)}</small></div>`).join('');
  }
  $$('div[data-i]', ac.el).forEach(d => d.onmousedown = e => { e.preventDefault(); chooseAutocomplete(ta, Number(d.dataset.i)); });
  const rect = ta.getBoundingClientRect();
  const pos = caretCoords(ta);
  ac.el.style.left = Math.min(rect.left + pos.left, window.innerWidth - 260) + 'px';
  ac.el.style.top = Math.min(rect.top + pos.top + 24, window.innerHeight - 270) + 'px';
}

function autocompleteKey(e, ta) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') return; // handled globally
  if (!ac || !ac.items?.length) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); ac.sel = (ac.sel + 1) % ac.items.length; autocomplete(ta); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); ac.sel = (ac.sel - 1 + ac.items.length) % ac.items.length; autocomplete(ta); }
  else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); chooseAutocomplete(ta, ac.sel); }
  else if (e.key === 'Escape') { closeAutocomplete(); }
}

function chooseAutocomplete(ta, i) {
  const p = ac.items[i];
  const s = ta.selectionStart;
  const start = s - ac.query.length;
  const after = ta.value.slice(s);
  const closing = after.startsWith(']]') ? '' : ']]';
  ta.value = ta.value.slice(0, start) + p.meta.title + closing + after;
  ta.selectionStart = ta.selectionEnd = start + p.meta.title.length + (closing ? 2 : 2);
  closeAutocomplete();
  ta.dispatchEvent(new Event('input'));
  closeAutocomplete();
  ta.focus();
}

function caretCoords(ta) {
  // Mirror the textarea to measure where the caret is.
  const div = document.createElement('div');
  const cs = getComputedStyle(ta);
  for (const prop of ['fontFamily', 'fontSize', 'lineHeight', 'padding', 'border', 'width', 'letterSpacing', 'whiteSpace', 'wordWrap', 'tabSize']) div.style[prop] = cs[prop];
  div.style.position = 'absolute';
  div.style.visibility = 'hidden';
  div.style.whiteSpace = 'pre-wrap';
  div.style.wordWrap = 'break-word';
  div.textContent = ta.value.slice(0, ta.selectionStart);
  const span = document.createElement('span');
  span.textContent = '​';
  div.appendChild(span);
  document.body.appendChild(div);
  const top = span.offsetTop - ta.scrollTop;
  const left = span.offsetLeft;
  div.remove();
  return { top, left };
}

// saving

function scheduleSave() {
  setSaveState('Unsaved changes…', true);
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(saveNow, 600);
}

async function saveNow() {
  clearTimeout(state.saveTimer);
  const ed = state.editing;
  if (!ed) return;
  if (!ed.meta.title.trim()) { setSaveState('A page needs a title', true); return; }
  await attempt(async () => {
    await api.pages.write(ed.id, ed.meta, ed.body);
    const old = state.pages.get(ed.id);
    if (old && !ed.meta.dmOnly) noteRevealedLines(ed.id, old.body, ed.body);
    state.pages.set(ed.id, { id: ed.id, meta: structuredClone(ed.meta), body: ed.body });
    rebuildIndex();
    setSaveState('Saved');
  });
}

async function finishEditing() {
  closeAutocomplete();
  const ed = state.editing;
  if (!ed) return;
  await saveNow();
  state.editing = null;
  const newTitle = ed.meta.title.trim();
  if (newTitle && newTitle !== ed.originalTitle) await propagateRename(ed.originalTitle, newTitle);
  renderTree();
}

/** Rewrites [[Old Title]] links across the campaign when a page is renamed. */
async function propagateRename(oldTitle, newTitle) {
  const escRe = oldTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\[\\[\\s*${escRe}\\s*(\\|[^\\]\\n]+)?\\]\\]`, 'gi');
  let count = 0;
  for (const p of state.pages.values()) {
    // Pages nested under the renamed one name it as their parent, so they follow it too.
    const child = typeof p.meta.parent === 'string' && p.meta.parent.trim().toLowerCase() === oldTitle.trim().toLowerCase();
    const linked = re.test(p.body);
    re.lastIndex = 0;
    if (!linked && !child) continue;
    const body = linked ? p.body.replace(re, (_, label) => `[[${newTitle}${label || ''}]]`) : p.body;
    const meta = child ? { ...p.meta, parent: newTitle } : p.meta;
    await api.pages.write(p.id, meta, body);
    p.body = body;
    p.meta = meta;
    if (linked) count++;
  }
  rebuildIndex();
  // Saved hooks link to pages too.
  let hooks = 0;
  for (const h of state.saved.hooks) {
    if (!h.md || !re.test(h.md)) continue;
    re.lastIndex = 0;
    h.md = h.md.replace(re, (_, label) => `[[${newTitle}${label || ''}]]`);
    h.text = String(h.text || '').split(oldTitle).join(newTitle);
    for (const slot of G.SLOTS) if (h.draw?.[slot]?.wiki && h.draw[slot].noun === oldTitle) h.draw[slot].noun = newTitle;
    h.words = (h.words || []).map(w => w === oldTitle ? newTitle : w);
    hooks++;
  }
  if (hooks) await saveSaved();
  // The story engine's records follow the page too: its people, factions, standing, troubles and the chronicle.
  if (state.saved?.world || state.saved?.problems) {
    const id = resolve(newTitle);
    if (state.saved.world) ST.renameIn(state.saved.world, oldTitle, newTitle, id);
    if (state.saved.problems) ST.renameIn({ problems: state.saved.problems }, oldTitle, newTitle, id);
    await saveWorld();
  }
  if (count) toast(`Updated links on ${count} page${count > 1 ? 's' : ''}`);
}

// ---------- new page ----------

async function newPageFlow(title = '', type = 'lore', extraMeta = {}) {
  const result = await formDialog('New page', `
    <label class="field">Title<input name="title" required value="${esc(title)}"></label>
    <label class="field">Type<select name="type">${TYPES.map(t => `<option value="${t.key}" ${t.key === type ? 'selected' : ''}>${t.label}</option>`).join('')}</select></label>`, 'Create');
  if (!result) return;
  const t = result.title.trim();
  if (resolve(t)) { toast('A page with that title already exists'); return openPage(resolve(t)); }
  await createPage(t, { type: result.type, ...extraMeta }, TEMPLATES[result.type] || '', true);
}

async function createPage(title, meta, body, edit = false) {
  // Cults start hidden from players until the DM reveals them.
  if (meta.type === 'cult' && meta.dmOnly === undefined) meta = { ...meta, dmOnly: true };
  return attempt(async () => {
    const id = await api.pages.create(title, meta, body);
    const page = await api.pages.read(id);
    state.pages.set(id, page);
    rebuildIndex();
    renderTree();
    await go({ kind: 'page', id, edit });
    return id;
  });
}

// ---------- party and character sheets ----------

function pcs() {
  return [...state.pages.values()].filter(p => p.meta.type === 'pc').sort((a, b) => a.meta.title.localeCompare(b.meta.title));
}

function partyLevel() {
  const list = pcs();
  if (!list.length) return 1;
  return Math.round(list.reduce((s, p) => s + (Number(p.meta.level) || 1), 0) / list.length);
}

// ---------- where the party is ----------
// The party can split: each group in state.saved.partyGroups {id, name, members: [pc page ids], at: page title, point: {name, at}}
// keeps its own place. Everyone not in a group is the main party, whose place is world().partyAt (or partyPoint, a spot
// on the map), or its latest journey. A journey with .group moves only that group.

const partyGroups = () => (state.saved.partyGroups ||= []);
const GROUP_COLORS = ['hsl(28 85% 60%)', 'hsl(190 60% 50%)', 'hsl(320 60% 62%)', 'hsl(95 45% 55%)', 'hsl(48 80% 58%)'];
const groupColor = g => g ? GROUP_COLORS[Math.max(0, partyGroups().indexOf(g)) % GROUP_COLORS.length] : 'var(--accent)';
/** The party members who haven't split off. */
const mainMembers = () => { const away = new Set(partyGroups().flatMap(g => g.members)); return pcs().filter(p => !away.has(p.id)); };
const mainPartyName = () => partyGroups().length ? 'The main party' : 'The party';
const groupMembers = g => pcs().filter(p => g.members.includes(p.id));
/** The journey the main party is on now, unless the DM has put them somewhere since. */
function mainRoad() {
  const w = world(), j = mainJourneys().at(-1);
  return !w.partyAt && !w.partyPoint && j && journeyActive(j) ? j : null;
}
const groupRoad = g => journeys().filter(j => j.group === g.id && journeyActive(j)).at(-1) || null;
const groupSpot = g => (g.at && spotOf(g.at)) || (g.point?.at ? { title: g.point.name, map: g.point.at } : null);
const placeLink = t => resolve(t) ? `<a class="wikilink" data-id="${esc(resolve(t))}">${esc(state.pages.get(resolve(t)).meta.title)}</a>` : esc(t);
/** Quests and contracts the party has taken on and not finished. */
const questsUnderWay = () => state.saved?.world ? world().chronicle.filter(e => e.kind === 'event' && e.quest && !e.outcome && e.taken !== false && resolve(e.quest)) : [];

/** On the party page: where the party (and each group split from it) is, and the quests and contracts under way. */
function partyWhereSection() {
  const groups = partyGroups(), list = pcs();
  const names = ps => ps.map(p => p.meta.title).join(', ');
  const row = (g, name, members, spot, road) => `<div class="where-row">
      <span class="where-flag" style="--party:${groupColor(g)}">⚑</span>
      <div class="where-text"><b>${esc(name)}</b>${groups.length && members.length ? ` <span class="muted">${esc(names(members))}</span>` : ''}<br>
        ${road ? `On the road: <button class="btn small" data-where-journey="${esc(road.id)}" title="Open the journey">🧭 ${esc(G.journeyTitle(road))}</button> <span class="muted">day ${road.days.length}${road.miles ? `, ${G.journeyDone(road)} of ${road.miles} miles` : ''}</span>`
          : spot ? resolve(spot.title) ? `At ${placeLink(spot.title)}` : esc(cap(spot.title)) : '<span class="muted">Not set yet</span>'}</div>
      <span class="dm-tool where-actions">
        <button class="btn small" data-move-party="${g ? esc(g.id) : 'main'}" title="Then click the World map where they are">Move on map</button>
        ${g ? `<button class="btn small" data-edit-group="${esc(g.id)}" title="Its name, who is in it and where it is">Edit</button><button class="btn small" data-rejoin="${esc(g.id)}" title="They go back to the main party">Rejoin</button>` : ''}
      </span></div>`;
  const main = mainMembers();
  const quests = questsUnderWay().map(e => {
    const left = Number.isFinite(e.due) ? e.due - today() : null;
    return `<li>${placeLink(e.quest)} <span class="badge">${e.contract ? 'Contract' : 'Quest'}</span>${e.dest ? ` <span class="muted">to</span> ${placeLink(e.dest)}` : ''}
      ${left === null ? '' : left >= 0 ? `<span class="muted">· due ${esc(fmtDay(e.due, { short: true }))}${left <= 3 ? ` (${left ? `${left} day${left === 1 ? '' : 's'}` : 'today'})` : ''}</span>` : '<span class="warn">· overdue</span>'}</li>`;
  });
  return `<section class="party-where">
    <div class="row" style="align-items:center"><h2 style="flex:1;margin:0">Where the party is</h2>
      ${list.length > 1 ? '<button class="btn small dm-tool" id="split-party" title="Some of the party go their own way: they get their own place and journeys">Split the party</button>' : ''}</div>
    ${main.length || !groups.length ? row(null, mainPartyName(), main, partyPlace(), mainRoad()) : ''}
    ${groups.map(g => row(g, g.name, groupMembers(g), groupSpot(g), groupRoad(g))).join('')}
    <h3 style="margin:10px 0 4px">Quests and contracts under way</h3>
    ${quests.length ? `<ul class="where-quests">${quests.join('')}</ul>` : '<p class="muted" style="margin:0">None right now. Accepted contracts and storyteller quests show here until you record how they ended.</p>'}
  </section>`;
}
function wirePartyWhere(box, redo) {
  $$('[data-where-journey]', box).forEach(b => b.onclick = () => openJourney(b.dataset.whereJourney));
  $$('[data-move-party]', box).forEach(b => b.onclick = () => {
    const m = (state.map ||= { vb: null, tool: null, draft: [] });
    Object.assign(m, { tool: 'party', moveWho: b.dataset.moveParty, draft: [] });
    go({ kind: 'map' });
  });
  $$('[data-edit-group]', box).forEach(b => b.onclick = async () => { if (await groupDialog(partyGroups().find(g => g.id === b.dataset.editGroup))) redo(); });
  $$('[data-rejoin]', box).forEach(b => b.onclick = async () => {
    const g = partyGroups().find(x => x.id === b.dataset.rejoin);
    if (!g || !(await confirmDialog(`${g.name} rejoin the party?`, `They go back to the main party${partyPlace() ? `, at ${partyPlace().title}` : ''}.`, 'Rejoin'))) return;
    state.saved.partyGroups = partyGroups().filter(x => x !== g);
    await saveWorld();
    redo();
  });
  const split = $('#split-party', box);
  if (split) split.onclick = async () => { if (await groupDialog(null)) redo(); };
}
/** Split some of the party off into a group, or change a group: its name, who is in it and where it is. */
async function groupDialog(g) {
  const list = pcs();
  const inIt = p => g ? g.members.includes(p.id) : false;
  const elsewhere = p => partyGroups().find(x => x !== g && x.members.includes(p.id));
  const here = g ? groupSpot(g) : partyPlace();
  const r = await formDialog(g ? `Edit ${g.name}` : 'Split the party', `
    <label class="field">Name<input name="name" required value="${esc(g?.name || `Group ${partyGroups().length + 2}`)}"></label>
    <p class="settings-group" style="margin:10px 0 4px">Who goes</p>
    <div class="chip-row">${list.map(p => `<label class="inline-check"><input type="checkbox" name="m:${esc(p.id)}" ${inIt(p) ? 'checked' : ''}> ${esc(p.meta.title)}${elsewhere(p) ? ` <span class="muted">(${esc(elsewhere(p).name)})</span>` : ''}</label>`).join('')}</div>
    <label class="field" style="margin-top:10px">Where they are<input name="at" value="${esc(here?.title || '')}" placeholder="A place on the map, or move them on the map later"></label>`,
    g ? 'Save' : 'Split', form => attachPicker($('input[name=at]', form), () => storyPlaces().map(p => ({ value: p.title, label: cap(p.settlement) }))));
  if (!r) return false;
  const members = list.filter(p => r[`m:${p.id}`]).map(p => p.id);
  if (!members.length) { toast('Tick at least one party member.', true); return false; }
  const at = r.at.trim();
  const pg = at && state.pages.get(resolve(at));
  if (at && !pg && at !== here?.title) { toast(`There's no page called ${at}.`, true); return false; }
  const x = g || { id: `grp-${Date.now().toString(36)}`, members: [] };
  x.name = r.name.trim() || x.name || 'Group';
  // Someone can only be in one place: ticking them here takes them out of any other group.
  for (const o of partyGroups()) if (o !== x) o.members = o.members.filter(id => !members.includes(id));
  x.members = members;
  if (pg) Object.assign(x, { at: pg.meta.title, point: null });
  else if (!at) Object.assign(x, { at: null, point: null });
  else if (!g && here) Object.assign(x, here.map && !resolve(here.title) ? { at: null, point: { name: here.title, at: here.map } } : { at: here.title, point: null });
  if (!g) partyGroups().push(x);
  // Groups left with nobody in them are gone.
  state.saved.partyGroups = partyGroups().filter(o => o.members.length);
  await saveWorld();
  toast(g ? `${x.name} saved.` : `${x.name} split from the party.`);
  return true;
}
/** Put the main party, or a group, at a place or a point on the map (from the map's Move party tool). */
async function moveParty(who, pt) {
  const pg = pt.id && state.pages.get(pt.id);
  const title = pg?.meta.title || null, point = title ? null : { name: pt.name, at: pt.at };
  const g = who !== 'main' && partyGroups().find(x => x.id === who);
  if (g) Object.assign(g, { at: title, point });
  else Object.assign(world(), { partyAt: title, partyPoint: point });
  await saveWorld();
  toast(`${g ? g.name : mainPartyName()} ${title ? 'is at' : 'is'} ${title || pt.name}.`);
}
/** The party's flags on the map: the main party and each group, where they are. Those on the road show as their journey's marker. */
function partySVG() {
  if (!state.saved) return '';
  const w = world();
  if (!pcs().length && !w.partyAt && !w.partyPoint) return '';
  const marks = [];
  const main = mainMembers();
  if ((main.length || !partyGroups().length) && !mainRoad()) marks.push({ key: 'main', name: partyGroups().length ? 'Main party' : 'Party', who: main, spot: partyPlace(), color: groupColor(null) });
  for (const g of partyGroups()) if (!groupRoad(g)) marks.push({ key: g.id, name: g.name, who: groupMembers(g), spot: groupSpot(g), color: groupColor(g) });
  const seen = {};
  return `<g class="party-marks">${marks.filter(x => x.spot?.map).map(x => {
    const [px, py] = mapXY(x.spot.map);
    // Groups at the same spot stand side by side.
    const k = `${px},${py}`, n = (seen[k] = (seen[k] ?? -1) + 1);
    return `<g class="scaled party-mark" data-party="${esc(x.key)}" data-x="${px}" data-y="${py}" style="--party:${x.color}"><title>${esc(x.name)}${x.who.length ? `: ${esc(x.who.map(p => p.meta.title).join(', '))}` : ''}, at ${esc(x.spot.title)}. Click to see the party.</title>
      <g transform="translate(${n * 16},0)"><path class="pole" d="M0,0V-20"/><path class="flag" d="M0,-20L13,-15.5L0,-11Z"/><circle r="2.5"/><text x="4" y="-24">${esc(x.name)}</text></g></g>`;
  }).join('')}</g>`;
}

function renderParty() {
  const list = pcs();
  $('#view').innerHTML = `<div class="wide">
    <div class="row" style="margin-bottom:16px">
      <h1 style="flex:1;margin:0;font:600 32px var(--serif)">The party</h1>
      <button class="btn" id="short-rest" title="Players spend hit dice and type what they regained">Short rest</button>
      <button class="btn" id="long-rest" title="Everyone back to full HP, half their hit dice back">Long rest</button>
      <button class="btn" id="import-pc" title="Add or update a party member from a sheet file">Import sheet</button>
      <button class="btn primary" id="add-pc">+ Add party member</button>
    </div>
    ${partyWhereSection()}
    <h2 style="margin:0 0 6px">Party purse</h2>
    <p class="hint" style="margin:0 0 6px">Spirit coins the whole party shares. Coins the party finds go here; purchases can come from here or from a member's own coins, kept on their sheet. Items stay on each sheet.</p>
    ${purseEditor()}
    ${list.length ? `<div class="cards party-cards">${list.map(p => partyCard(p)).join('')}</div>`
      : `<div class="empty"><p>No party members yet.</p><p>Add one for each player character, or import a sheet file a player sent you. Their sheets track level, HP, essences, awakening stones and cores, and save as you change them. Spirit coins go in the party purse above.</p></div>`}
    <section class="party-inventory">
      <h2 style="margin:0 0 6px">Party inventory</h2>
      <p class="hint" style="margin:0 0 6px">Things the whole party owns. Weapons and armour someone uses go on their own sheet.</p>
      ${partyItemsSection()}
    </section>
    ${reputationSection()}
  </div>`;
  wirePurse($('#view'));
  wirePartyWhere($('#view'), renderParty);
  wirePartyItems(renderParty);
  $('#short-rest').onclick = shortRest;
  $('#long-rest').onclick = longRest;
  $('#import-pc').onclick = async () => { await importSheet(); if (state.view?.kind === 'party') renderParty(); };
  $('#add-pc').onclick = async () => {
    const r = await formDialog('New party member', `
      <label class="field">Character name<input name="title" required></label>
      <label class="field">Player<input name="player"></label>
      <div class="row"><label class="field">Class<select name="class">${(state.data.classes?.classes || []).map(c => `<option>${c.name}</option>`).join('')}</select></label>
      <label class="field">People<select name="species">${(state.data.peoples?.peoples || []).map(p => `<option>${p.name}</option>`).join('')}<option>Outworlder</option></select></label>
      <label class="field" style="width:80px">Level<input name="level" type="number" min="1" max="20" value="1"></label></div>
      <p class="settings-group" style="margin:10px 0 4px">Ability scores</p>
      <div class="row new-pc-abils">${S.ABILITIES.map((a, i) => `<label class="field" style="width:62px">${a}<input name="ab${i}" type="number" min="1" max="30" value="10"></label>`).join('')}</div>
      <div class="row" style="gap:6px;align-items:center"><button type="button" class="btn small" data-abils="array" title="15, 14, 13, 12, 10 and 8, placed for the class">Standard array</button><button type="button" class="btn small" data-abils="roll" title="4d6, drop the lowest, placed for the class">Roll 4d6</button><span class="hint" id="new-pc-points"></span></div>
      <div class="row" style="align-items:flex-end"><label class="field" style="width:150px" title="The background raises one score by 2 and another by 1 (or three by 1: set them on the sheet)">Background +2<select name="bg2"><option value="">None</option>${S.ABILITIES.map(a => `<option>${a}</option>`).join('')}</select></label>
        <label class="field" style="width:150px">Background +1<select name="bg1"><option value="">None</option>${S.ABILITIES.map(a => `<option>${a}</option>`).join('')}</select></label>
        <p class="hint" style="margin:0 0 8px;flex:1">Scores above are before the background. Typing final scores? Set both to None.</p></div>
      <div id="new-pc-class-picks"></div>
      <div id="new-pc-level-picks"></div>
      <label class="inline-check" style="margin-top:8px"><input type="checkbox" name="kit" checked> Starting equipment: <span class="muted" id="new-pc-kit"></span></label>
      <p class="hint" style="margin:4px 0 0">Max HP follows Constitution. Background skills, feats and languages go on the sheet.</p>`, 'Add', form => {
      const boxes = S.ABILITIES.map((_, i) => form.elements[`ab${i}`]);
      const points = () => {
        const v = boxes.map(b => Number(b.value) || 0);
        const cost = v.every(x => x >= 8 && x <= 15) ? v.reduce((a, x) => a + POINT_COST[x], 0) : null;
        $('#new-pc-points', form).textContent = cost == null ? '' : `Point buy: ${cost} of 27 points`;
      };
      // A class's best abilities get the highest scores: the standard array, or a set of 4d6 rolls, sorted.
      const place = scores => { const order = ABILITY_ORDER[form.elements.class.value] || S.ABILITIES; scores.sort((a, b) => b - a).forEach((x, i) => { boxes[S.ABILITIES.indexOf(order[i])].value = x; }); points(); };
      let touched = false;
      boxes.forEach(b => b.addEventListener('input', () => { touched = true; points(); }));
      // The background bonus goes to the class's two best abilities until the DM picks otherwise; skills, the cleric's
      // or druid's order and the kit follow the class.
      let bgTouched = false;
      ['bg2', 'bg1'].forEach(k => form.elements[k].addEventListener('change', () => { bgTouched = true; }));
      const classPicks = () => {
        const cls = form.elements.class.value, order = ABILITY_ORDER[cls] || S.ABILITIES;
        if (!bgTouched) { form.elements.bg2.value = order[0]; form.elements.bg1.value = order[1]; }
        const [n, skills] = CLASS_SKILLS[cls] || [0, []];
        const ord = LEVEL1_ORDER[cls];
        $('#new-pc-class-picks', form).innerHTML = `${n ? `<p class="settings-group" style="margin:10px 0 4px">Skills <span class="muted">(pick ${n})</span></p>
          <div class="new-pc-skills">${skills.map(x => `<label class="inline-check"><input type="checkbox" name="sk:${esc(x)}"> ${esc(x)}</label>`).join('')}</div>` : ''}
          ${ord ? `<label class="field" style="margin-top:8px">${esc(ord[1])}<select name="order">${Object.entries(ord[2]).map(([k, t]) => `<option value="${esc(k)}">${esc(k)}: ${esc(t)}</option>`).join('')}</select></label>` : ''}`;
        const boxes = $$('[name^="sk:"]', form);
        boxes.forEach(b => b.addEventListener('change', () => { const on = boxes.filter(x => x.checked).length; boxes.forEach(x => { x.disabled = !x.checked && on >= n; }); }));
        $('#new-pc-kit', form).textContent = kitText(STARTING_KIT[cls]) || 'none for this class';
        levelPicks();
      };
      // What their level brings: subclass, feats or ability increases, class picks, expertise and spells.
      const levelPicks = () => {
        const cls = form.elements.class.value, level = Math.max(1, Math.min(20, Number(form.elements.level.value) || 1));
        const sub = form.elements.sub?.value || '';
        const gold = higherLevelGold(level);
        $('#new-pc-kit', form).textContent = `${kitText(STARTING_KIT[cls]) || 'none for this class'}${gold ? `, and about ${gold.toLocaleString()} gp more for starting at level ${level}${level >= 11 ? ` (with ${level >= 17 ? 'two' : 'one'} uncommon magic item${level >= 17 ? 's' : ''} of their choice)` : ''}` : ''}`;
        const box = $('#new-pc-level-picks', form);
        box.innerHTML = newPcLevelPicks(cls, level, sub);
        // Checkbox groups stop at their count.
        $$('[data-limit]', box).forEach(g => {
          const n = Number(g.dataset.limit), bs = $$('input[type=checkbox]', g);
          const cap = () => { const on = bs.filter(x => x.checked).length; bs.forEach(x => { x.disabled = !x.checked && on >= n; }); };
          bs.forEach(b => b.addEventListener('change', cap)); cap();
        });
        form.elements.sub?.addEventListener('change', levelPicks);
      };
      form.elements.level.addEventListener('input', levelPicks);
      form.elements.class.addEventListener('change', () => { if (!touched) place([15, 14, 13, 12, 10, 8]); classPicks(); });
      classPicks();
      $$('[data-abils]', form).forEach(b => b.onclick = () => { touched = true; place(b.dataset.abils === 'array' ? [15, 14, 13, 12, 10, 8] : Array.from({ length: 6 }, () => { const d = Array.from({ length: 4 }, () => 1 + Math.floor(Math.random() * 6)).sort((x, y) => x - y); return d[1] + d[2] + d[3]; })); });
      place([15, 14, 13, 12, 10, 8]);
    });
    if (!r) return;
    const cls = state.data.classes?.classes.find(c => c.name === r.class);
    const level = Number(r.level) || 1;
    const bonus = a => (r.bg2 === a ? 2 : 0) + (r.bg1 === a ? 1 : 0);
    // The bonus can't take a score past 20; a score typed above 20 is kept as it is.
    const abilities = S.ABILITIES.map((a, i) => { const v = Math.max(1, Math.min(30, Number(r[`ab${i}`]) || 10)); return v >= 20 ? v : Math.min(20, v + bonus(a)); });
    // Level choices: ability score improvements raise the scores (to 20 at most), feats and class picks are kept.
    const featPicks = [];
    for (let i = 0; r[`feat${i}`] !== undefined; i++) {
      const v = r[`feat${i}`];
      if (!v) continue;
      const asi = v.match(/^asi:(\w+)(?::(\w+))?$/);
      if (!asi) { featPicks.push(v); continue; }
      const ups = asi[2] ? [asi[1], asi[2]] : [asi[1], asi[1]];
      for (const a of ups) { const k = S.ABILITIES.indexOf(a); if (k >= 0 && abilities[k] < 20) abilities[k]++; }
      featPicks.push(`Ability Score Improvement (${asi[2] ? `+1 ${asi[1]}, +1 ${asi[2]}` : `+2 ${asi[1]}`})${featPicks.some(x => x.startsWith('Ability Score Improvement')) ? ` #${featPicks.filter(x => x.startsWith('Ability Score Improvement')).length + 1}` : ''}`);
    }
    const levelOpts = {};
    for (const k of Object.keys(r).filter(k => k.startsWith('co:'))) { const [, key, ...name] = k.split(':'); (levelOpts[key] ||= []).push(name.join(':')); }
    if (featPicks.length) levelOpts.feats = featPicks;
    const expertise = Object.keys(r).filter(k => k.startsWith('ex:')).map(k => k.slice(3));
    const subclass = level >= C.SUBCLASS_LEVEL && r.sub ? r.sub : '';
    const hpMax = sheetHp({ class: r.class, level, abilities });
    const kit = r.kit ? STARTING_KIT[r.class] : null;
    const skills = Object.keys(r).filter(k => k.startsWith('sk:')).map(k => k.slice(3));
    const ord = LEVEL1_ORDER[r.class];
    // Weapon Mastery starts on the kit's weapons, as many as the class gets at this level.
    const mOpt = C.classOptionsFor({ class: r.class, level }).find(o => o.key === 'mastery');
    const masteries = kit && mOpt ? [...new Set(kit.weapons.map(w => Object.keys(mOpt.choices).find(k => k.toLowerCase() === w.toLowerCase())).filter(Boolean))].slice(0, mOpt.count) : [];
    await createPage(r.title.trim(), {
      type: 'pc', player: r.player, class: r.class, species: r.species, level,
      hp: hpMax, hpMax, ac: 10, armor: kit?.armor || 'none', ...(kit?.shield ? { shield: kit.shield } : {}), abilities, speed: 30, essences: [], confluence: '', stones: [],
      ...(skills.length ? { skills } : {}), ...(expertise.length ? { expertise } : {}), ...(subclass ? { subclass } : {}),
      ...(ord && r.order || masteries.length || Object.keys(levelOpts).length ? { classOpts: { ...levelOpts, ...(ord && r.order ? { [ord[0]]: [r.order] } : {}), ...(masteries.length ? { mastery: masteries } : {}) } } : {}),
      ...(r.spells ? { spells: startingSpells({ class: r.class, level, subclass, abilities }) } : {}),
      ...(kit ? { equipped: kit.weapons.map(w => S.equipEntry(state.data, w)) } : {}),
      coins: gpToCoins((kit?.gp || 0) + (r.kit ? higherLevelGold(level, true) : 0)), cores: { iron: 0, bronze: 0, silver: 0 }, coreLevels: 0,
    }, kit ? TEMPLATES.pc.replace('## Inventory\n\n', `## Inventory\n\n${[...kit.carry, ...(level >= 11 ? Array(level >= 17 ? 2 : 1).fill('An uncommon magic item of their choice (for starting above level 10)') : [])].map(x => `- ${x}`).join('\n')}\n`) : TEMPLATES.pc);
  };
  $$('.card h3').forEach(h => h.onclick = () => openPage(h.dataset.id));
  $$('.card [data-hp]').forEach(b => b.onclick = () => adjustHP(b.dataset.id, Number(b.dataset.hp)));
  playRest($('#view'), state.restFx);
  state.restFx = null;
}

// Point buy costs (27 points), and which abilities each class wants highest, for a new character's scores.
const POINT_COST = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
const ABILITY_ORDER = {
  Artificer: ['INT', 'CON', 'DEX', 'WIS', 'STR', 'CHA'], Barbarian: ['STR', 'CON', 'DEX', 'WIS', 'CHA', 'INT'], Bard: ['CHA', 'DEX', 'CON', 'WIS', 'INT', 'STR'],
  Cleric: ['WIS', 'CON', 'STR', 'DEX', 'CHA', 'INT'], Druid: ['WIS', 'CON', 'DEX', 'INT', 'CHA', 'STR'], Fighter: ['STR', 'CON', 'DEX', 'WIS', 'CHA', 'INT'],
  Monk: ['DEX', 'WIS', 'CON', 'STR', 'INT', 'CHA'], Paladin: ['STR', 'CHA', 'CON', 'WIS', 'DEX', 'INT'], Ranger: ['DEX', 'WIS', 'CON', 'STR', 'INT', 'CHA'],
  Rogue: ['DEX', 'CON', 'INT', 'WIS', 'CHA', 'STR'], Sorcerer: ['CHA', 'CON', 'DEX', 'WIS', 'INT', 'STR'], Warlock: ['CHA', 'CON', 'DEX', 'WIS', 'INT', 'STR'],
  Wizard: ['INT', 'CON', 'DEX', 'WIS', 'CHA', 'STR'],
};
// Each class's skill choices and how many it picks, and its starting kit (2024 rules, the first equipment option).
const CLASS_SKILLS = {
  Artificer: [2, ['Arcana', 'History', 'Investigation', 'Medicine', 'Nature', 'Perception', 'Sleight of Hand']],
  Barbarian: [2, ['Animal Handling', 'Athletics', 'Intimidation', 'Nature', 'Perception', 'Survival']],
  Bard: [3, S.SKILLS.map(([s]) => s)],
  Cleric: [2, ['History', 'Insight', 'Medicine', 'Persuasion', 'Religion']],
  Druid: [2, ['Animal Handling', 'Arcana', 'Insight', 'Medicine', 'Nature', 'Perception', 'Religion', 'Survival']],
  Fighter: [2, ['Acrobatics', 'Animal Handling', 'Athletics', 'History', 'Insight', 'Intimidation', 'Perception', 'Persuasion', 'Survival']],
  Monk: [2, ['Acrobatics', 'Athletics', 'History', 'Insight', 'Religion', 'Stealth']],
  Paladin: [2, ['Athletics', 'Insight', 'Intimidation', 'Medicine', 'Persuasion', 'Religion']],
  Ranger: [3, ['Animal Handling', 'Athletics', 'Insight', 'Investigation', 'Nature', 'Perception', 'Stealth', 'Survival']],
  Rogue: [4, ['Acrobatics', 'Athletics', 'Deception', 'Insight', 'Intimidation', 'Investigation', 'Perception', 'Persuasion', 'Sleight of Hand', 'Stealth']],
  Sorcerer: [2, ['Arcana', 'Deception', 'Insight', 'Intimidation', 'Persuasion', 'Religion']],
  Warlock: [2, ['Arcana', 'Deception', 'History', 'Intimidation', 'Investigation', 'Nature', 'Religion']],
  Wizard: [2, ['Arcana', 'History', 'Insight', 'Investigation', 'Medicine', 'Nature', 'Religion']],
};
const STARTING_KIT = {
  Artificer: { armor: 'Studded leather armour', weapons: ['Light crossbow', 'Dagger'], carry: ['Arrows (20)', "Thieves' tools", "Dungeoneer's pack"], gp: 16 },
  Barbarian: { weapons: ['Greataxe', 'Handaxe'], carry: ['Handaxe (3 more)', "Explorer's pack"], gp: 15 },
  Bard: { armor: 'Leather armour', weapons: ['Dagger'], carry: ['Dagger', 'Lute', "Entertainer's pack"], gp: 19 },
  Cleric: { armor: 'Chain shirt', shield: 'Shield', weapons: ['Mace'], carry: ['Holy symbol', "Priest's pack"], gp: 7 },
  Druid: { armor: 'Leather armour', shield: 'Shield', weapons: ['Sickle', 'Quarterstaff'], carry: ['Druidic focus (sprig, totem or yew wand)', "Explorer's pack", 'Herbalism kit'], gp: 9 },
  Fighter: { armor: 'Chain mail', weapons: ['Greatsword', 'Flail', 'Javelin'], carry: ['Javelin (7 more)', "Dungeoneer's pack"], gp: 4 },
  Monk: { weapons: ['Spear', 'Dagger'], carry: ['Dagger (4 more)', 'Lute', "Explorer's pack"], gp: 11 },
  Paladin: { armor: 'Chain mail', shield: 'Shield', weapons: ['Longsword', 'Javelin'], carry: ['Javelin (5 more)', 'Holy symbol', "Priest's pack"], gp: 9 },
  Ranger: { armor: 'Studded leather armour', weapons: ['Scimitar', 'Shortsword', 'Longbow'], carry: ['Arrows (20)', 'Quiver', 'Druidic focus (sprig, totem or yew wand)', "Explorer's pack"], gp: 7 },
  Rogue: { armor: 'Leather armour', weapons: ['Shortsword', 'Shortbow', 'Dagger'], carry: ['Dagger', 'Arrows (20)', 'Quiver', "Thieves' tools", "Burglar's pack"], gp: 8 },
  Sorcerer: { weapons: ['Spear', 'Dagger'], carry: ['Dagger', 'Arcane focus (crystal, orb, rod or wand)', "Dungeoneer's pack"], gp: 28 },
  Warlock: { armor: 'Leather armour', weapons: ['Sickle', 'Dagger'], carry: ['Dagger', 'Arcane focus (crystal, orb, rod or wand)', 'A book of occult lore', "Scholar's pack"], gp: 15 },
  Wizard: { weapons: ['Quarterstaff', 'Dagger'], carry: ['Dagger', 'Robes', 'Spellbook', "Scholar's pack"], gp: 5 },
};
const kitText = k => k ? [k.armor, k.shield, ...k.weapons, ...k.carry, `${k.gp} gp`].filter(Boolean).join(', ') : '';
// The choice a cleric or druid makes at level 1, asked when they're made.
/**
 * Extra gold for a character made above 4th level, after the DMG's guideline: 500 gp plus 1d10 × 25 from 5th,
 * 5,000 plus 1d10 × 250 from 11th, 20,000 plus 1d10 × 250 from 17th. `roll` adds the d10; without it, the average.
 */
function higherLevelGold(level, roll = false) {
  const t = level >= 17 ? [20000, 250] : level >= 11 ? [5000, 250] : level >= 5 ? [500, 25] : null;
  return t ? t[0] + (roll ? 1 + Math.floor(Math.random() * 10) : 5.5) * t[1] : 0;
}
/** Gold pieces as spirit coins, the biggest coins first (1 iron = 1 gp). */
function gpToCoins(gp) {
  const out = Object.fromEntries(G.COIN_RANKS.map(k => [k, 0]));
  let left = Math.round(gp);
  for (const k of [...G.COIN_RANKS].reverse()) { const v = G.coinValue(k); out[k] = Math.floor(left / v); left -= out[k] * v; }
  return out;
}
// Cantrips and prepared spells by level (2024 rules; the artificer's from Tasha's: Int modifier + half its level).
const CANTRIPS = { Bard: [[1, 2], [4, 3], [10, 4]], Cleric: [[1, 3], [4, 4], [10, 5]], Druid: [[1, 2], [4, 3], [10, 4]], Sorcerer: [[1, 4], [4, 5], [10, 6]], Warlock: [[1, 2], [4, 3], [10, 4]], Wizard: [[1, 3], [4, 4], [10, 5]], Artificer: [[1, 2], [10, 3], [14, 4]] };
const FULL_PREP = [4, 5, 6, 7, 9, 10, 11, 12, 14, 15, 16, 16, 17, 17, 18, 18, 19, 20, 21, 22];
const HALF_PREP = [2, 3, 4, 5, 6, 6, 7, 7, 9, 9, 10, 10, 11, 11, 12, 12, 14, 14, 15, 15];
const PREPARED = { Bard: FULL_PREP, Cleric: FULL_PREP, Druid: FULL_PREP, Paladin: HALF_PREP, Ranger: HALF_PREP,
  Sorcerer: [2, 4, 6, 7, 9, 10, 11, 12, 14, 15, 16, 16, 17, 17, 18, 18, 19, 20, 21, 22], Warlock: [2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15],
  Wizard: [4, 5, 6, 7, 9, 10, 11, 12, 14, 15, 16, 16, 17, 18, 19, 21, 22, 23, 24, 25] };
const spellCounts = m => {
  const level = Math.max(1, Math.min(20, Number(m.level) || 1));
  const at = t => (t || []).reduce((n, [l, c]) => level >= l ? c : n, 0);
  const prep = m.class === 'Artificer' ? Math.max(1, S.modNum(m.abilities?.[3] ?? 10) + Math.floor(level / 2)) : PREPARED[m.class]?.[level - 1] || 0;
  return { cantrips: at(CANTRIPS[m.class]), prepared: prep };
};
/** A starting set from their class list: the cantrips they know, and prepared spells spread over the levels they can cast. */
function startingSpells(m) {
  const { cantrips, prepared } = spellCounts(m);
  const all = S.classSpellsFor(state.data, m);
  const take = (pool, n) => { const p = [...pool], out = []; while (out.length < n && p.length) out.push(p.splice(Math.floor(Math.random() * p.length), 1)[0].name); return out; };
  const out = take(all.filter(x => !x.level), cantrips);
  const max = Math.max(0, ...all.map(x => x.level));
  // Highest levels first, round and round, so a level 9 caster has a 5th-level spell or two and plenty of 1st.
  const byLevel = Array.from({ length: max }, (_, i) => all.filter(x => x.level === max - i));
  for (let i = 0, got = 0; got < prepared && byLevel.some(l => l.length); i++) {
    const l = byLevel[i % byLevel.length];
    if (!l.length) continue;
    out.push(l.splice(Math.floor(Math.random() * l.length), 1)[0].name);
    got++;
  }
  return out;
}
// Expertise: rogues at 1st and 6th level, bards at 2nd and 9th, two skills each time.
const EXPERTISE = { Rogue: [[1, 2], [6, 4]], Bard: [[2, 2], [9, 4]] };
/** The level choices on the new character dialog for this class and level. */
function newPcLevelPicks(cls, level, sub) {
  const ord = LEVEL1_ORDER[cls];
  const m = { class: cls, level, subclass: sub };
  const opts = C.classOptionsFor(m).filter(o => !['mastery', 'feats', ord?.[0]].includes(o.key));
  const featN = C.classOptionsFor(m).find(o => o.key === 'feats')?.count || 0;
  const order = ABILITY_ORDER[cls] || S.ABILITIES;
  const asis = [...S.ABILITIES.map(a => [`asi:${a}`, `Ability Score Improvement: +2 ${a}`]), [`asi:${order[0]}:${order[1]}`, `Ability Score Improvement: +1 ${order[0]}, +1 ${order[1]}`], [`asi:${order[0]}:${order[2]}`, `Ability Score Improvement: +1 ${order[0]}, +1 ${order[2]}`]];
  const featNames = Object.keys(C.classOptionsFor({ class: cls, level: 20 }).find(o => o.key === 'feats')?.choices || {}).filter(n => n !== 'Ability Score Improvement');
  const exN = (EXPERTISE[cls] || []).reduce((n, [l, c]) => level >= l ? c : n, 0);
  const { cantrips, prepared } = spellCounts({ class: cls, level, abilities: [10, 10, 10, 10, 10, 10] });
  const group = (title, n, items, name) => `<p class="settings-group" style="margin:10px 0 4px">${esc(title)} <span class="muted">(pick ${n})</span></p>
    <div class="new-pc-skills pick-box" data-limit="${n}">${items.map(([v, t]) => `<label class="inline-check" title="${esc(t || '')}"><input type="checkbox" name="${esc(name(v))}"> ${esc(v)}</label>`).join('')}</div>`;
  return `${level >= C.SUBCLASS_LEVEL && C.SUBCLASSES[cls] ? `<label class="field" style="margin-top:8px">Subclass<select name="sub"><option value="">Choose later</option>${C.SUBCLASSES[cls].map(x => `<option ${x === sub ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>` : ''}
    ${featN ? `<p class="settings-group" style="margin:10px 0 4px">Ability score improvements and feats <span class="muted">(${featN}, one for each level that gives one)</span></p>
      <div class="row" style="flex-wrap:wrap">${Array.from({ length: featN }, (_, i) => `<label class="field" style="flex:1 1 240px">${i + 1}.<select name="feat${i}"><option value="">Choose later</option>${asis.map(([v, t]) => `<option value="${esc(v)}" ${v === `asi:${order[0]}` && !i ? 'selected' : ''}>${esc(t)}</option>`).join('')}<optgroup label="Feats">${featNames.map(n => `<option>${esc(n)}</option>`).join('')}</optgroup></select></label>`).join('')}</div>` : ''}
    ${opts.map(o => group(o.label, o.count, Object.entries(o.choices), v => `co:${o.key}:${v}`)).join('')}
    ${exN ? group('Expertise', exN, (CLASS_SKILLS[cls]?.[1] || []).map(x => [x, 'Double proficiency: pick from the skills they are proficient in']), v => `ex:${v}`) : ''}
    ${cantrips || prepared ? `<label class="inline-check" style="margin-top:8px"><input type="checkbox" name="spells" checked> Starting spells: ${cantrips ? `${cantrips} cantrip${cantrips === 1 ? '' : 's'}${prepared ? ' and ' : ''}` : ''}${prepared ? `about ${prepared} prepared spell${prepared === 1 ? '' : 's'}` : ''} from the ${esc(cls.toLowerCase())} list, to change on the sheet</label>` : ''}`;
}
const LEVEL1_ORDER = { Cleric: ['divineOrder', 'Divine Order', { Protector: 'martial weapons and heavy armour', Thaumaturge: 'an extra cantrip, and Wisdom to Arcana and Religion' }],
  Druid: ['primalOrder', 'Primal Order', { Magician: 'an extra cantrip, and Wisdom to Arcana and Nature', Warden: 'martial weapons and medium armour' }] };

const rollBtn = k => `<button type="button" class="link-btn roll-btn" data-roll-look="${k}" title="Roll a random ${k === 'skin' ? 'skin' : k}">🎲</button>`;

/** A sheet field kept as a comma-separated list: removable tags, and a dropdown of common choices with a custom option. */
function tagField(key, label, value, groups) {
  const have = S.splitList(value);
  const opts = Object.entries(groups).map(([g, items]) => {
    const left = items.filter(x => !have.includes(x)).map(x => `<option>${esc(x)}</option>`).join('');
    return left && g ? `<optgroup label="${esc(g)}">${left}</optgroup>` : left;
  }).join('');
  return `<div class="field tag-field"><span>${esc(label)}</span><div class="tags">
    ${have.map(x => `<span class="chip tag">${esc(x)} <button type="button" class="link-btn" data-tag-del="${esc(key)}" data-v="${esc(x)}" title="Remove ${esc(x)}">×</button></span>`).join('')}
    <select data-tag-add="${esc(key)}" title="Add to ${esc(label.toLowerCase())}"><option value="">Add…</option>${opts}<option value="__custom">Custom…</option></select></div></div>`;
}

const spellLevelName = l => Number(l) ? `level ${l}` : 'cantrip';
const ordinal = n => ['', '1st', '2nd', '3rd'][n] || `${n}th`;

/**
 * Subclass and class options (invocations, maneuvers, metamagic, fighting styles, weapon masteries, feats…): only
 * the ones their class, subclass and level have, each with how many they can pick. `prefix` keeps an NPC panel's
 * controls apart from a sheet's.
 */
function classOptionsSection(m, { prefix = '' } = {}) {
  const level = Number(m.level) || 1;
  const subs = C.SUBCLASSES[m.class] || [];
  const custom = m.subclass && !subs.includes(m.subclass);
  const subPick = `<label class="field subclass-field">Subclass<select data-${prefix}subclass>
    <option value="">${level >= C.SUBCLASS_LEVEL ? 'None yet' : `Chosen at level ${C.SUBCLASS_LEVEL}`}</option>
    ${subs.map(x => `<option ${x === m.subclass ? 'selected' : ''}>${esc(x)}</option>`).join('')}${custom ? `<option selected>${esc(m.subclass)}</option>` : ''}<option value="__custom">Custom…</option></select></label>`;
  const opts = C.classOptionsFor(m);
  const short = t => t.length > 70 ? `${t.slice(0, 68)}…` : t;
  // What they can take now, then what a higher level opens (greyed, with the level), then the older books' options.
  const copts = (o, left) => {
    const opt = ([n, t], extra = '') => `<option value="${esc(n)}" title="${esc(t)}">${esc(n)}${extra} — ${esc(short(t))}</option>`;
    const off = ([n, l], t) => `<option disabled title="${esc(t)}">${esc(n)} (level ${l}) — ${esc(short(t))}</option>`;
    const free = ([n]) => !o.picked.includes(n);
    const legacy = Object.entries(o.legacy || {}).filter(free), legacyLocked = Object.entries(o.legacyLocked || {});
    return left.map(x => opt(x, o.needs[x[0]] ? ` (needs ${o.needs[x[0]]})` : '')).join('')
      + (Object.keys(o.locked || {}).length ? `<optgroup label="At a higher level">${Object.entries(o.locked).map(x => off(x, o.all[x[0]])).join('')}</optgroup>` : '')
      + (legacy.length || legacyLocked.length ? `<optgroup label="Older books (2014 rules)">${legacy.map(x => opt(x)).join('')}${legacyLocked.map(x => off(x, o.all[x[0]] || "")).join('')}</optgroup>` : '');
  };
  const block = o => {
    const left = Object.entries(o.choices).filter(([n]) => !o.picked.includes(n));
    const over = o.picked.length - o.count;
    return `<div class="copt"><div class="copt-head"><b>${esc(o.label)}</b> <span class="muted">${o.picked.length} of ${o.count}</span>${over > 0 ? ` <span class="warn">${over} more than level ${level} allows</span>` : ''}${o.note ? ` <span class="hint">${esc(o.note)}</span>` : ''}</div>
      <div class="tags">${o.picked.map(n => `<span class="chip tag" title="${esc(o.all[n] || '')}">${esc(n)} <button type="button" class="link-btn" data-${prefix}copt-del="${esc(o.key)}" data-v="${esc(n)}" title="Remove ${esc(n)}">×</button></span>`).join('')}
      ${o.picked.length < o.count || over > 0 ? `<select data-${prefix}copt-add="${esc(o.key)}" title="Add to ${esc(o.label.toLowerCase())}"><option value="">Add…</option>${copts(o, left)}<option value="__custom">Custom…</option></select>` : ''}</div>
      ${o.picked.length ? `<ul class="copt-list">${o.picked.map(n => `<li><b>${esc(n)}.</b> ${esc(o.all[n] || '')}</li>`).join('')}</ul>` : ''}</div>`;
  };
  const feats = CR.featuresAt(m.class, level, m.subclass);
  const featList = feats.length ? `<details class="class-feats"><summary>What a level ${level} ${classLink(m.class, m.class.toLowerCase())}${m.subclass && level >= C.SUBCLASS_LEVEL ? ` (${esc(m.subclass)})` : ''} has (${feats.length} features)</summary>
    <ul class="copt-list">${feats.map(f => `<li><b>${esc(f.name)}.</b> <span class="muted">(${f.from === m.class ? `level ${f.level}` : esc(f.from)})</span> ${esc(f.text)}</li>`).join('')}</ul></details>` : '';
  return `${subPick}${featList}${opts.length ? opts.map(block).join('') : `<p class="hint">${m.class ? `Nothing for a level ${level} ${esc(m.class.toLowerCase())} to pick yet.` : 'Pick a class to see its options.'}</p>`}`;
}
/** Wires a class options section; `done(picks, subclass)` saves. */
function wireClassOptions(el, m, done, prefix = '') {
  const picks = () => ({ ...(m.classOpts || {}) });
  const attr = name => (prefix + name).replace(/-(\w)/g, (_, c) => c.toUpperCase());
  $$(`[data-${prefix}subclass]`, el).forEach(sel => sel.addEventListener('change', async () => {
    let v = sel.value;
    if (v === '__custom') v = (await formDialog('Subclass', '<label class="field">Name<input name="v" required></label>', 'Set'))?.v?.trim() || m.subclass || '';
    done(picks(), v);
  }));
  $$(`[data-${prefix}copt-add]`, el).forEach(sel => sel.addEventListener('change', async () => {
    const k = sel.dataset[attr('copt-add')];
    let v = sel.value;
    if (v === '__custom') v = (await formDialog('Add one of your own', '<label class="field">Name<input name="v" required></label>', 'Add'))?.v?.trim() || '';
    sel.value = '';
    if (!v) return;
    const p = picks();
    p[k] = [...new Set([...(p[k] || []), v])];
    done(p, m.subclass);
  }));
  $$(`[data-${prefix}copt-del]`, el).forEach(b => b.onclick = () => {
    const k = b.dataset[attr('copt-del')];
    const p = picks();
    p[k] = (p[k] || []).filter(x => x !== b.dataset.v);
    if (!p[k].length) delete p[k];
    done(p, m.subclass);
  });
}

/** The sheet's spells: the ones they know or prepare, picked from their class list (or any list), and what their items cast. */
function spellsSection(m, d) {
  const level = Number(m.level) || 1;
  const max = S.maxSpellLevel(m.class, level, m.subclass);
  const listOf = S.spellListClass(m);
  const n = S.castingNumbers(m, d);
  const known = S.knownSpells(m).map(x => G.spellInfo(d, x) || { name: x, level: 0 }).sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  const left = S.classSpellsFor(d, m).filter(s => !known.some(k => k.name === s.name));
  const items = S.gearFx(m).spells;
  return `<p class="hint">${max >= 0 ? `${esc(m.class)} ${level}${listOf !== m.class ? ` (${esc(m.subclass)})` : ''}: cantrips and spells up to ${ordinal(max)} level from the ${esc(listOf.toLowerCase())} list.` : `${esc(m.class || 'This class')} has no spell list of its own; add spells from feats, essences or anything else.`} Spell save DC ${n.dc}, ${S.signed(n.attack)} to hit. Spells that attack, deal damage or heal get a roll button on the battle screen.</p>
    <div class="tags spell-tags">${known.map(s => `<span class="chip tag">${spellName(s.name)} <small class="muted">${spellLevelName(s.level)}</small> <button type="button" class="link-btn" data-spell-del="${esc(s.name)}" title="Remove ${esc(s.name)}">×</button></span>`).join('') || '<span class="hint">No spells yet.</span>'}</div>
    <div class="carried-add"><input id="spell-add" placeholder="Add a spell they know or have prepared"></div>
    ${subclassSpells(m).length ? `<p class="hint">Always prepared from ${esc(subclassSpells(m)[0].from)}: ${subclassSpells(m).map(x => spellName(x.name)).join(', ')}.</p>` : ''}
    ${items.length ? `<p class="hint">Cast by their items: ${items.map(x => `${spellName(x.spell)} (${esc(x.from)})`).join(', ')}</p>` : ''}
    ${left.length ? `<details class="class-spells" ${state.classSpellsOpen ? 'open' : ''}><summary>The ${esc(listOf.toLowerCase())} spells they can cast (${left.length} more)</summary>
      ${[...new Set(left.map(s => s.level))].map(l => `<div class="class-spell-level"><b>${cap(spellLevelName(l))}</b> ${left.filter(s => s.level === l).map(s => `<button type="button" class="chip" data-spell-pick="${esc(s.name)}" title="${esc(s.summary || '')}">+ ${esc(s.name)}</button>`).join(' ')}</div>`).join('')}</details>` : ''}`;
}

/**
 * One spell on a stat block, with a roll button for its attack or save and damage, or for its healing. `slots` are
 * the slot levels it can be cast with: when a higher slot does more, the DM picks one (remembered per caster), and
 * the numbers and the roll follow it.
 */
function spellLine(name, nums, level, note = '', { slots = [], who = '' } = {}) {
  const d = state.data, i = G.spellInfo(d, name);
  const key = `${who}|${i?.name || name}`;
  const slot = slots.includes(state.castSlots?.[key]) ? state.castSlots[key] : slots[0] ?? null;
  // A summoning spell brings its creature into the battle instead of rolling anything itself.
  const summons = i && SU.summonSpell(i.name);
  const a = summons ? null : S.spellAction(d, name, { ...nums, level, slot });
  const each = a?.count > 1 ? ' each' : '';
  const what = a ? [a.toHit != null ? `${S.signed(a.toHit)} to hit${a.count > 1 ? `, ${a.count} ${a.kind}s (each rolls on its own)` : ''}` : a.count > 1 ? `${a.count} ${a.kind}s` : '',
    a.save ? `DC ${a.save.dc} ${a.save.ability} save${a.area ? ', everyone in the area' : a.targets > 1 ? `, up to ${a.targets} targets` : ''}` : '',
    a.damage.map(x => `${x.expr}${x.type ? ` ${[x.type, ...(x.or || [])].join(' or ')}` : ''}`).join(' + ') + (a.damage.length ? each : ''), a.heal ? `heals ${a.heal}` : '', a.temp ? `${a.temp} temporary hit points` : ''].filter(Boolean).join(', ') : '';
  const atk = a && (a.toHit != null || a.save || a.damage.length) ? ` <button class="roll-btn" data-attack="${esc(JSON.stringify({ toHit: a.toHit, save: a.save, damage: a.damage, count: a.count, kind: a.kind, targets: a.targets, area: a.area, slot: a.slot > a.level ? a.slot : 0, name: a.name, section: '' }))}" title="Roll ${a.toHit != null ? 'to hit and ' : ''}damage${a.save ? ', and each target\'s save' : ''}">⚄ Roll</button>` : '';
  const heal = a?.heal ? ` <button class="roll-btn" data-roll="${esc(a.heal)}" data-label="${esc(a.name)} (healing${a.slot > a.level ? `, level ${a.slot}` : ''})" title="Roll the healing">⚄ Heal</button>` : '';
  const summon = summons ? ` <button class="roll-btn" data-summon="${esc(JSON.stringify({ spell: i.name, slot: slot ?? i.level, attack: nums.attack, dc: nums.dc, mod: nums.mod ?? Math.max(1, (Number(nums.dc) || 13) - 11) }))}" title="Summon it into the battle: pick its form, and it joins the initiative order${i.concentration ? ', tied to the caster\'s concentration' : ''}">✦ Summon</button>` : '';
  const pick = (a?.scales || summons) && slots.length > 1 ? ` <select class="slot-pick" data-slot-key="${esc(key)}" title="The spell slot it is cast with">${slots.map(l => `<option value="${l}" ${l === (a ? a.slot : slot) ? 'selected' : ''}>${l === (a ? a.level : i.level) ? `Level ${l}` : `Level ${l} slot`}</option>`).join('')}</select>`
    : a?.scales && a.slot > a.level ? ` <span class="badge" title="Cast with their level ${a.slot} slot">level ${a.slot} slot</span>` : '';
  // A spell that lasts with nothing to roll (bless, crusader's mantle) is cast onto people in the battle instead.
  const cast = !atk && !heal && !summons && G.spellLasts(i) ? ` <button class="roll-btn" data-cast="${esc(i.name)}" title="Cast it in the battle: pick who it is on, and track it${i.concentration ? ' with their concentration' : ''}${a?.temp ? `. They gain ${a.temp} temporary hit points` : ''}">✦ Cast</button>` : '';
  // Temporary hit points to roll (false life), unless casting it gives them already.
  const temp = a?.temp && !cast ? ` <button class="roll-btn" data-roll="${esc(a.temp)}" data-label="${esc(a.name)} (temp HP${a.slot > a.level ? `, level ${a.slot}` : ''})" title="Roll the temporary hit points">⚄ Temp HP</button>` : '';
  const line = esc(JSON.stringify({ name, nums, level, note, slots, who }));
  return `<div class="sb-line" data-line="${line}">${spellName(name, i?.name || name)} <span class="muted">(${[i ? spellLevelName(i.level) : '', i?.time, note].filter(Boolean).map(esc).join(', ')})</span>${pick}${atk}${heal}${temp}${cast}${summon}${what ? ` <span class="muted">${esc(what)}</span>` : ''}</div>`;
}
/** A new slot picked for a spell: remember it for that caster and redraw just that line. */
function pickSlot(sel) {
  (state.castSlots ||= {})[sel.dataset.slotKey] = Number(sel.value);
  const line = sel.closest('[data-line]');
  const o = JSON.parse(line.dataset.line);
  line.outerHTML = spellLine(o.name, o.nums, o.level, o.note, { slots: o.slots, who: o.who });
}

/** A monster's or NPC's spellcasting as roll lines: its save DC and attack, its caster level, and the slots it lists. */
function monsterSpellLines(t, who) {
  const desc = String(t.desc || '');
  const dc = Number(desc.match(/spell save DC (\d+)/i)?.[1]) || 0;
  const bonus = desc.match(/([+-]\d+) to hit with spell attacks/i);
  const level = Number(desc.match(/(\d+)(?:st|nd|rd|th)-level spellcaster/i)?.[1]) || Number(t.level) || 1;
  // "Its spellcasting ability is Charisma", or an NPC's awakening stones: "Cha-based".
  const ab = desc.match(/spellcasting ability is (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)/i)?.[1] || desc.match(/\b(Str|Dex|Con|Int|Wis|Cha)-based\b/i)?.[1];
  const mod = ab && t.abilities ? Number(G.abilityMod(t.abilities[S.ABILITIES.indexOf(ab.slice(0, 3).toUpperCase())])) : 0;
  const top = G.maxSlotIn(desc);
  const nums = { dc, attack: bonus ? Number(bonus[1]) : dc ? dc - 8 : 0, mod };
  const rows = [...new Set(t.spells)].filter(n => S.spellAction(state.data, n, { ...nums, level }) || G.spellLasts(G.spellInfo(state.data, n)));
  if (!rows.length) return '';
  return `<div class="sb-spell-rolls">${rows.map(n => {
    const l = Number(G.spellInfo(state.data, n)?.level) || 0;
    return spellLine(n, nums, level, '', { slots: l && top >= l ? Array.from({ length: top - l + 1 }, (_, i) => l + i) : [], who });
  }).join('')}</div>`;
}

/** An escaped stat block line with its "paladin 7" turned into a link to the class page. */
function linkClassText(html) {
  const names = Object.keys(CR.CLASSES).filter(n => resolve(n));
  return names.length ? html.replace(new RegExp(`\\b(${names.join('|')})(?= \\d)`, 'i'), w => classLink(w, w)) : html;
}
/** A class name as a link to its reference page in the wiki, when the campaign has one. */
function classLink(cls, text = cls) {
  const ref = CR.classRef(cls);
  const id = ref && resolve(Object.keys(CR.CLASSES).find(k => k.toLowerCase() === String(cls).toLowerCase()));
  return id ? `<a class="wikilink class-link" data-id="${esc(id)}" title="The ${esc(String(cls).toLowerCase())} class page: features, level table and subclasses">${esc(text)}</a>` : esc(text);
}
/** Beside a Class field: a link to that class's page, when the campaign has one. */
function classPageLink(cls) {
  const ref = cls && CR.classRef(cls);
  return ref ? ` ${classLink(cls, `${Object.keys(CR.CLASSES).find(k => k.toLowerCase() === String(cls).trim().toLowerCase())} page`).replace('<a ', '<a data-field-link ')}` : '';
}
/** Spells their subclass always has prepared (domain, oath and patron spells), with where they come from. */
const subclassSpells = m => CR.subclassSpellsAt(m.class, m.subclass, m.level).map(n => ({ name: n, from: CR.subclassRef(m.class, m.subclass)?.name || m.subclass }));
/** The class options they've picked, for a stat block: what each does, so it's there in battle. */
/** A class feature that does something in a battle gets a button: Wild Shape changes the card, companions join it. */
function featureButton(name) {
  if (name === 'Wild Shape') return ' <button class="roll-btn" data-wildshape title="Turn into a beast from the bestiary (or a custom creature): their battle card takes its stat block and AC, with temporary hit points">✦ Wild Shape</button>';
  if (['Steel Defender', 'Primal Companion', 'Wild Companion'].includes(name)) return ` <button class="roll-btn" data-summon-feature="${esc(name)}" title="Bring it into the battle${name === 'Wild Companion' ? ': a fey familiar on its own initiative' : ', acting right after them'}">✦ Summon</button>`;
  return '';
}
function classFeatureEntries(m) {
  // A mastery for a weapon they carry already shows on that weapon's attack under Actions.
  const onAttacks = new Set([].concat(m.equipped || []).filter(e => e.weapon).map(e => C.masteryOf(m, e.item || e.name)?.weapon).filter(Boolean));
  const opts = C.classOptionsFor(m).map(o => o.key === 'mastery' ? { ...o, picked: o.picked.filter(n => !onAttacks.has(n)) } : o).filter(o => o.picked.length);
  const level = Number(m.level) || 1;
  const feats = CR.featuresAt(m.class, level, m.subclass);
  const table = CR.tableAt(m.class, level);
  if (!opts.length && !feats.length) return '';
  const sub = feats.find(f => f.from !== m.class)?.from;
  return `<h3>Class Features</h3>${table.length ? `<p class="muted">${classLink(m.class)} ${level}: ${table.map(([k, v]) => `${esc(k)} ${esc(v)}`).join(' · ')}</p>` : ''}
    ${feats.map(f => `<div class="sb-entry"><b><i>${esc(f.name)}.</i></b>${featureButton(f.name)} <span class="muted">(${f.from === m.class ? `${esc(f.from)} ${f.level}` : esc(f.from)})</span> ${esc(f.text)}</div>`).join('')}
    ${sub ? '' : m.subclass && level >= C.SUBCLASS_LEVEL ? `<p class="muted">${esc(m.subclass)}: no features listed for it here.</p>` : ''}
    ${opts.map(o => `${o.key === 'maneuvers' && o.note ? `<p class="muted">${esc(o.note)}</p>` : ''}${o.picked.map(n => `<div class="sb-entry"><b><i>${esc(n)}.</i></b> <span class="muted">(${esc(o.label)})</span> ${esc(o.all[n] || '')}</div>`).join('')}`).join('')}`;
}

function partyCard(p) {
  const m = p.meta;
  const level = Number(m.level) || 1;
  const rank = G.pcRank(m);
  const hp = Number(m.hp) || 0, max = Number(m.hpMax) || 1;
  const pct = Math.max(0, Math.min(100, hp / max * 100));
  const revoked = [].concat(m.revoked || []);
  const ess = [].concat(m.essences || []).filter(Boolean).map(e => revoked.includes(e) ? `${e} (revoked)` : e);
  return `<div class="card">
    <div>${m.image ? `<img class="thumb" src="${esc(imageSrc(m.image))}" alt="">` : ''}
    <h3 data-id="${esc(p.id)}">${esc(m.title)}</h3>
    <div class="sub">${esc(m.species || '')} ${esc(m.class || '')} · level ${level} · <span class="rank rank-${rank}">${rank}</span>${m.player ? ` · played by ${esc(m.player)}` : ''}</div></div>
    <div class="hp"><span class="bar ${pct <= 25 ? 'crit' : pct <= 50 ? 'low' : ''}"><span style="width:${pct}%"></span></span>
      <button class="btn small" data-hp="-5" data-id="${esc(p.id)}">−5</button><button class="btn small" data-hp="-1" data-id="${esc(p.id)}">−1</button>
      <span class="num">${hp} / ${max}</span>
      <button class="btn small" data-hp="1" data-id="${esc(p.id)}">+1</button><button class="btn small" data-hp="5" data-id="${esc(p.id)}">+5</button></div>
    <div class="sub">AC ${esc(m.ac ?? '–')} · hit dice ${hitDiceLeft(p)}/${level} d${hitDieOf(p)} · ${ess.length ? esc(ess.join(', ')) + (m.confluence ? ` → ${esc(m.confluence)}` : '') : 'No essences yet'}${G.purseValue(m.coins) ? ` · ${esc(coinSummary(m).replace(/ \(.*/, ''))} of their own` : ''}${[].concat(m.carried || []).length ? ` · carrying ${esc([].concat(m.carried).join(', '))}` : ''}</div>
  </div>`;
}

function coinSummary(m) {
  const c = m.coins || {};
  // Every kind of coin they hold, biggest first; an empty purse says 0 iron.
  const shown = G.COIN_RANKS.filter(k => Number(c[k])).reverse();
  return `${(shown.length ? shown : ['iron']).map(k => `${Number(c[k]) || 0} ${k}`).join(' · ')} (${G.purseValue(c).toLocaleString()} gp)`;
}

// ---------- rests ----------
/** Max HP by the rules: the class's hit die at 1st level, its average after, plus the Constitution modifier each level. */
function sheetHp(m) {
  const die = state.data.classes?.classes?.find(c => c.name === m.class)?.hitDie || 8;
  const level = Math.max(1, Number(m.level) || 1), con = S.modNum(Number(m.abilities?.[2]) || 10);
  return Math.max(level, die + con + (level - 1) * (die / 2 + 1 + con));
}
/** After Constitution, level or class changes: a Max HP still at the rules' number follows it; one set by hand stays. */
function followHp(m, before) {
  const was = sheetHp(before), now = sheetHp(m);
  if (Number(m.hpMax) !== was || now === was) return false;
  m.hpMax = now;
  m.hp = Math.max(0, Math.min(now, (Number(m.hp) || 0) + now - was));
  return true;
}
const hitDieOf = p => state.data.classes?.classes?.find(c => c.name === p.meta.class)?.hitDie || 8;
const hitDiceLeft = p => Math.max(0, (Number(p.meta.level) || 1) - (Number(p.meta.hitDiceUsed) || 0));
/** A party member's new HP reaches the battle too, if they're in one. */
function restInBattle(p, long) {
  const b = state.saved.battle;
  let changed = false;
  for (const c of b?.list || []) if (c.kind === 'pc' && c.page === p.id) {
    c.hp = Number(p.meta.hp) || 0;
    if (long) { c.temp = 0; c.death = null; c.conditions = []; }
    changed = true;
  }
  return changed;
}
/** Everyone's HP and spent hit dice before a rest, for the rest effect to fill up from. */
const restBefore = (list, long) => ({ long, before: Object.fromEntries(list.map(p => {
  const hp = Number(p.meta.hp) || 0, max = Number(p.meta.hpMax) || 1;
  return [p.id, { hp, pct: Math.max(0, Math.min(100, hp / max * 100)), used: Number(p.meta.hitDiceUsed) || 0 }];
})) });
async function shortRest() {
  const list = pcs();
  if (!list.length) return toast('Add a party member first.', true);
  const r = await formDialog('Short rest', `<p class="hint" style="margin:0 0 8px">Players roll the hit dice they spend. Type the HP each got back and how many dice they used.</p>
    <div class="rest-grid">${list.map(p => `<div class="rest-row"><div><b>${esc(p.meta.title)}</b><div class="muted">${Number(p.meta.hp) || 0}/${Number(p.meta.hpMax) || 0} HP · ${hitDiceLeft(p)} of ${Number(p.meta.level) || 1} d${hitDieOf(p)} left</div></div>
      <label class="field">HP back<input name="hp:${esc(p.id)}" type="number" min="0"></label>
      <label class="field">Dice spent<input name="hd:${esc(p.id)}" type="number" min="0" max="${hitDiceLeft(p)}"></label></div>`).join('')}</div>`, 'Rest');
  if (!r) return;
  const done = [];
  let inBattle = false;
  state.restFx = restBefore(list, false);
  for (const p of list) {
    const gain = Math.max(0, Number(r[`hp:${p.id}`]) || 0), spent = Math.min(hitDiceLeft(p), Math.max(0, Number(r[`hd:${p.id}`]) || 0));
    // A warlock's pact slots come back on a short rest.
    const pact = Number(p.meta.slotsUsed?.pact) > 0;
    if (pact) { const { pact: _, ...rest } = p.meta.slotsUsed; p.meta = { ...p.meta, slotsUsed: rest }; }
    // A druid gets one Wild Shape use back.
    if (Number(p.meta.slotsUsed?.wild) > 0) { p.meta = { ...p.meta, slotsUsed: { ...p.meta.slotsUsed, wild: p.meta.slotsUsed.wild - 1 } }; if (!pact) await attempt(() => api.pages.write(p.id, p.meta, p.body)); }
    if (!gain && !spent) { if (pact) { await attempt(() => api.pages.write(p.id, p.meta, p.body)); done.push(`${p.meta.title}'s pact slots back`); } continue; }
    p.meta = { ...p.meta, hp: Math.min(Number(p.meta.hpMax) || 0, (Number(p.meta.hp) || 0) + gain), hitDiceUsed: (Number(p.meta.hitDiceUsed) || 0) + spent };
    await attempt(() => api.pages.write(p.id, p.meta, p.body));
    inBattle = restInBattle(p, false) || inBattle;
    done.push(`${p.meta.title} +${gain}`);
  }
  if (inBattle) saveBattle();
  toast(done.length ? `Short rest: ${done.join(', ')}.` : 'Short rest: nobody spent anything.');
  render();
}
async function longRest() {
  const list = pcs();
  if (!list.length) return toast('Add a party member first.', true);
  if (!(await confirmDialog('Long rest?', 'Everyone goes back to full HP, gets back half their hit dice (at least one) and all their spell slots. In a running battle, their temporary HP, death saves and conditions clear too.', 'Long rest'))) return;
  let inBattle = false;
  state.restFx = restBefore(list, true);
  for (const p of list) {
    const level = Number(p.meta.level) || 1;
    p.meta = { ...p.meta, hp: Number(p.meta.hpMax) || 0, hitDiceUsed: Math.max(0, (Number(p.meta.hitDiceUsed) || 0) - Math.max(1, Math.floor(level / 2))), slotsUsed: {} };
    await attempt(() => api.pages.write(p.id, p.meta, p.body));
    inBattle = restInBattle(p, true) || inBattle;
  }
  if (inBattle) saveBattle();
  toast('Long rest: the party is back to full HP.');
  render();
}

async function adjustHP(id, delta) {
  const p = state.pages.get(id);
  p.meta.hp = Math.max(0, Math.min(Number(p.meta.hpMax) || 0, (Number(p.meta.hp) || 0) + delta));
  await attempt(() => api.pages.write(id, p.meta, p.body));
  render();
}

function renderSheet(el, p) {
  const m = p.meta;
  const d = state.data;
  m.essences = [].concat(m.essences || []);
  m.stones = [].concat(m.stones || []);
  closePicker();
  m.coins = m.coins || { iron: 0, bronze: 0, silver: 0 };
  m.cores = m.cores || { iron: 0, bronze: 0, silver: 0 };
  const level = Number(m.level) || 1;
  const pb = G.proficiencyBonus(level);
  m.revoked = [].concat(m.revoked || []).filter(r => m.essences.includes(r));
  // Sheets saved before confluences formed on their own kept a revoked essence's confluence here.
  if (m.dormantConfluence && !m.confluence) m.confluence = m.dormantConfluence;
  delete m.dormantConfluence;
  // A revoked divine essence stays on the sheet so it can be restored, but its slot counts as empty.
  m.carried = [].concat(m.carried || []);
  const freeSlot = [0, 1, 2].some(i => !m.essences[i]);
  const live = m.essences.filter(e => e && !m.revoked.includes(e));
  const held = live.length;
  // The confluence forms by itself from three compendium or divine essences, unless it was typed in by hand.
  let changed = false;
  if (m.confluenceAuto === undefined) m.confluenceAuto = !m.confluence;
  const formed = held === 3 ? G.sheetConfluence(d, live) : null;
  if (formed && m.confluenceAuto && m.confluence !== formed.name) { m.confluence = formed.name; changed = true; }
  const dormant = Boolean(m.confluence) && held < 3;
  const infos = [0, 1, 2].map(i => G.essenceInfo(d, m.essences[i]));
  const powers = G.sheetPowers(d, { essences: m.essences, revoked: m.revoked, confluence: m.confluence, level });
  const liveStones = m.stones.filter(s => !m.revoked.includes(s.essence)).length;
  const capLevel = G.maxStoneSpellLevel(level);
  const coreLevels = Number(m.coreLevels) || 0;
  const conf = G.confluenceInfo(d, m.confluence);
  // A confluence picked before the set is full is the player's goal: each empty slot shows what it needs.
  const needs = held < 3 && !m.confluenceAuto ? G.confluenceNeeds(d, m) : null;
  // Sheets from before ability scores keep their initiative bonus, as an extra on top of Dex.
  if (!Array.isArray(m.abilities)) { m.abilities = [10, 10, 10, 10, 10, 10]; if (m.initMisc == null) m.initMisc = Number(m.initBonus) || 0; changed = true; }
  m.equipped = [].concat(m.equipped || []);
  // Equipped items learn whether they need attunement and what they do; on an older sheet, the first three that
  // need it start attuned, so nothing they had stops working.
  for (const e of m.equipped) if (S.refreshEntry(d, e)) changed = true;
  if (!Array.isArray(m.attuned)) {
    m.attuned = m.equipped.filter(e => e.attune).slice(0, S.MAX_ATTUNED).map(e => e.name);
    changed = true;
  }
  const attunedCount = S.attunedItems(m).length;
  const acInfo = S.sheetAC(m, d);
  const sp = S.spellNumbers(m, d);
  const saveList = S.saveProfs(m);

  const opt = (v, label, cur) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(label)}</option>`;
  const armourCur = acInfo.manual ? 'manual' : m.armor || 'none';
  const armours = S.armourChoices(d);
  const armourOptions = opt('manual', 'Set AC by hand', armourCur) + opt('none', 'No armour', armourCur)
    + ['light', 'medium', 'heavy'].map(k => `<optgroup label="${cap(k)} armour">${armours.filter(i => S.armourOf(i).kind === k).map(i => { const a = S.armourOf(i); return opt(i.name, `${i.name} (AC ${a.base}${a.dexMax === 0 ? '' : a.dexMax ? ' + Dex, max 2' : ' + Dex'})`, armourCur); }).join('')}</optgroup>`).join('')
    + (!['manual', 'none'].includes(armourCur) && !G.itemInfo(d, armourCur) ? opt(armourCur, `${armourCur} (not in the item list)`, armourCur) : '')
    + opt('__custom', '+ Custom armour…', armourCur);
  const shieldOptions = opt('', 'No shield', m.shield || '') + S.shieldChoices(d).map(i => opt(i.name, `${i.name} (+${S.armourOf(i).bonus})`, m.shield || '')).join('')
    + (m.shield && !G.itemInfo(d, m.shield) ? opt(m.shield, `${m.shield} (not in the item list)`, m.shield) : '') + opt('__custom', '+ Custom shield…', m.shield || '');
  const armourItem = S.armourOf(G.itemInfo(d, m.armor));
  const strShort = armourItem?.str && m.abilities[0] < armourItem.str;

  const equipRow = (e, i) => {
    const atk = S.weaponAttack(m, e);
    const w = e.weapon;
    return `<div class="equip-row">
      <div class="equip-head"><strong>${e.item && G.itemInfo(d, e.item) ? `<a href="#" class="jump" data-jump="items" data-name="${esc(e.item)}" title="See it in the item list">${esc(e.name)}</a>` : esc(e.name)}</strong>
        ${atk ? `<span class="muted">${esc(atk.name !== e.name ? `${atk.name}: ` : '')}${esc(S.signed(atk.toHit))} to hit, ${esc(atk.damage.map(x => `${x.expr} ${x.type}`.trim()).join(' plus '))}</span>
          <button class="roll-btn" data-attack="${esc(JSON.stringify({ ...atk, section: '' }))}" title="Roll to hit and damage">⚄ Roll</button>` : ''}
        <span class="spacer"></span>
        ${e.attune ? `<label class="revoke attune${S.isActive(m, e) ? ' on' : ''}" title="${S.isActive(m, e) ? 'Attuned: it works.' : 'It only works once they attune to it (a short rest with it). Up to three items at a time.'}"><input type="checkbox" data-attune="${i}" ${S.isActive(m, e) ? 'checked' : attunedCount >= S.MAX_ATTUNED ? 'disabled' : ''}> Attuned</label>` : ''}
        ${resistPick(G.itemInfo(d, e.item || e.name), e.choice, `data-eq="${i}" data-f="choice"`)}
        ${w ? '' : `<label class="inline-field" title="Added to their AC while it's equipped">AC bonus <input data-eq="${i}" data-f="ac" type="number" value="${esc(e.ac ?? 0)}"></label>`}
        <button class="btn small danger" data-unequip="${i}" title="Take it off the equipped list">Remove</button></div>
      ${e.fx && S.fxText(e.fx) ? `<div class="hint${S.isActive(m, e) ? '' : ' muted'}">${esc(S.isActive(m, e) ? 'Gives' : 'Once attuned, gives')} ${esc(S.fxText(e.fx))}.</div>` : ''}
      ${w ? `<div class="equip-weapon">
        <label class="field" title="What the attack is called when it's rolled">Attack name<input data-eq="${i}" data-w="attack" value="${esc(w.attack ?? '')}" placeholder="${esc(e.name)}"></label>
        <label class="field">Damage dice<input data-eq="${i}" data-w="dice" value="${esc(w.dice ?? '')}" placeholder="1d8"></label>
        <label class="field">Damage type<input data-eq="${i}" data-w="type" value="${esc(w.type ?? '')}" placeholder="slashing"></label>
        <label class="field" title="Ranged weapons use Dex; finesse weapons the better of Str and Dex">Ability<select data-eq="${i}" data-w="ability">${opt('auto', `Auto (${S.weaponAbility(m, { ...w, ability: 'auto' })})`, w.ability || 'auto')}${S.ABILITIES.map(a => opt(a, a, w.ability)).join('')}${opt('none', 'None', w.ability)}</select></label>
        <label class="field" title="Magic bonus to hit and damage">Bonus<input data-eq="${i}" data-w="bonus" type="number" value="${esc(w.bonus ?? 0)}"></label>
        <label class="field" title="Extra damage on a hit, like 1d6 fire">Extra damage<input data-eq="${i}" data-w="extra" value="${esc(w.extra ?? '')}" placeholder="1d6 fire"></label>
        <label class="revoke"><input type="checkbox" data-eq="${i}" data-w="prof" ${w.prof === false ? '' : 'checked'}> Proficient</label>
      </div>` : ''}
    </div>`;
  };

  const essenceCard = (info, i) => {
    if (!info) return '<div class="ess-card empty">Empty. Absorb a carried essence to fill it.</div>';
    if (info.kind === 'unknown') return '<div class="ess-card"><span class="warn">Not in the compendium.</span> It works as a custom essence, but has no listed trait or stone spells.</div>';
    const dv = info.divine;
    const off = dv && m.revoked.includes(m.essences[i]);
    return `<div class="ess-card">
      <div><span class="rarity rarity-${esc(info.rarity || 'basic')}">${esc(info.rarity || 'basic')}</span> ${info.affinity && info.affinity !== info.name ? `${esc(info.affinity)} affinity` : ''}</div>
      ${info.theme ? `<div class="muted">${esc(info.theme.replace(/\.$/, ''))}</div>` : ''}
      <a href="#" class="jump" data-jump="essences" data-name="${esc(info.name)}">Details and confluences</a>
      ${dv ? `<div class="divine-note">Granted by <a class="wikilink" data-target="${esc(dv.church)}">${esc(dv.called || dv.god)}</a>, who can take it back.
        <label class="revoke"><input type="checkbox" data-revoke="${esc(m.essences[i])}" ${off ? 'checked' : ''}> Revoked by the god</label></div>` : ''}
    </div>`;
  };

  const heldOptions = cur => {
    const names = [...new Set([...m.essences.filter(Boolean), cur].filter(Boolean))];
    return `<option value="">Choose an essence</option>` + names.map(n => `<option value="${esc(n)}" ${n === cur ? 'selected' : ''}>${esc(n)}${m.revoked.includes(n) ? ' (revoked)' : ''}</option>`).join('');
  };

  const stoneRow = (s, i) => {
    const off = m.revoked.includes(s.essence);
    const spells = stoneSpellList(s.essence, capLevel);
    const known = spells.some(x => x.spell === s.spell);
    const spellField = spells.length
      ? `<select data-stone="${i}" data-f="spell"><option value="">Choose a spell</option>
          ${[1, 2, 3, 4, 5].filter(l => spells.some(x => x.level === l)).map(l => `<optgroup label="Level ${l}">${spells.filter(x => x.level === l).map(x => `<option value="${esc(x.spell)}" ${x.spell === s.spell ? 'selected' : ''}>${esc(x.spell)}</option>`).join('')}</optgroup>`).join('')}
          ${s.spell && !known ? `<option value="${esc(s.spell)}" selected>${esc(s.spell)} (custom)</option>` : ''}
        </select>`
      : `<input data-stone="${i}" data-f="spell" value="${esc(s.spell ?? '')}" placeholder="Spell">`;
    // A listed spell sets its own level; only a custom spell needs one typed in.
    const levelField = spells.length && (known || !s.spell)
      ? `<span class="muted stone-level">${known ? `level ${esc(s.level ?? 1)}` : ''}</span>`
      : `<input data-stone="${i}" data-f="level" type="number" min="1" max="5" value="${esc(s.level ?? 1)}" title="Spell level">`;
    return `<div class="stone-row${off ? ' revoked' : ''}" ${off ? 'title="Lost: the god has taken this essence back"' : ''}>
      <select data-stone="${i}" data-f="essence">${heldOptions(s.essence)}</select>
      ${spellField}${levelField}
      <button class="btn small danger" data-remove-stone="${i}">Remove</button>
    </div>`;
  };

  el.innerHTML = `${pcStatBlock(p)}<div class="sheet">
    <div class="grid">
      <label class="field">Player<input data-k="player" value="${esc(m.player ?? '')}"></label>
      <label class="field">People<input data-k="species" value="${esc(m.species ?? '')}"></label>
      <label class="field">Class${classPageLink(m.class)}<input data-k="class" value="${esc(m.class ?? '')}" list="class-list"></label>
      <label class="field">Level<input data-k="level" data-num type="number" min="1" max="20" value="${level}"></label>
      <label class="field" title="${esc(acInfo.manual ? 'Set by hand. Choose their armour under Armour and equipment to work it out instead.' : acInfo.parts.join(' + '))}">AC${acInfo.manual ? `<input data-k="ac" data-num type="number" value="${esc(m.ac ?? 10)}">` : `<input class="calc" readonly value="${acInfo.ac}">`}</label>
      <label class="field" title="Dex modifier plus any extra (under Abilities). Added to their d20 when the battle screen rolls initiative">Initiative<input class="calc" readonly value="${S.signed(S.initiative(m))}"></label>
      <label class="field">Speed (ft)<input data-k="speed" data-num type="number" step="5" min="0" value="${esc(m.speed ?? 30)}"></label>
      <label class="field">Max HP<input data-k="hpMax" data-num type="number" value="${esc(m.hpMax ?? 0)}">${Number(m.hpMax) !== sheetHp(m) ? `<button type="button" class="link-btn" id="hp-rules" title="Average hit points for their class and level, with their Constitution modifier each level">Rules: ${sheetHp(m)}</button>` : ''}</label>
      <label class="field">XP<input data-k="xp" data-num type="number" value="${esc(m.xp ?? 0)}"></label>
      <label class="field" title="Their origin (background) from the Player's Handbook. It gives an origin feat, which goes on the PDF sheet">Origin<input data-k="background" value="${esc(m.background ?? '')}" placeholder="Soldier, Sage, …"></label>
      <label class="field" title="Leave blank to use the origin's own feat">Origin feat<input data-k="originFeat" value="${esc(m.originFeat ?? '')}" placeholder="${esc(S.ORIGINS[m.background]?.feat || '')}"></label>
      <label class="field">Alignment<input data-k="alignment" value="${esc(m.alignment ?? '')}"></label>
      <label class="field" title="Spent on short rests since the last long rest. They have one d${hitDieOf(p)} per level.">Hit dice spent<input data-k="hitDiceUsed" data-num type="number" min="0" max="${level}" value="${esc(m.hitDiceUsed ?? 0)}"></label>
    </div>
    <div class="hp"><strong>HP</strong>
      <button class="btn small" data-hp="-10">−10</button><button class="btn small" data-hp="-5">−5</button><button class="btn small" data-hp="-1">−1</button>
      <input data-k="hp" data-num type="number" value="${esc(m.hp ?? 0)}" style="width:80px;text-align:center">
      <span class="muted">/ ${esc(m.hpMax ?? 0)}</span>
      <button class="btn small" data-hp="1">+1</button><button class="btn small" data-hp="5">+5</button><button class="btn small" data-hp="10">+10</button>
      <button class="btn small" data-hp="full">Full</button>
      <span class="spacer"></span>
      <span title="${G.pcRank(m) === G.rankForLevel(level) ? '' : `${G.rankForLevel(level)} is the usual rank at level ${level}; a character is Normal rank until all three essence slots are filled`}">Rank <span class="rank rank-${G.pcRank(m)}">${G.pcRank(m)}</span>${G.pcRank(m) !== G.rankForLevel(level) ? ` <span class="muted">(${G.rankForLevel(level)} suggested for level ${level})</span>` : ''} · Proficiency +${pb}</span>
    </div>
    <div>
      <h3>Abilities</h3>
      <div class="abil-row">${S.ABILITIES.map((a, i) => `<div class="abil">
        <span class="abil-name" title="${S.ABILITY_NAMES[a]}">${a}</span>
        <input data-abil="${i}" type="number" min="1" max="30" value="${esc(m.abilities[i] ?? 10)}">
        <b class="abil-mod"${S.abilities(m)[i] !== (Number(m.abilities[i]) || 10) ? ` title="${S.abilities(m)[i]} from an attuned item"` : ''}>${S.signed(S.modNum(S.abilities(m)[i]))}${S.abilities(m)[i] !== (Number(m.abilities[i]) || 10) ? `<small class="muted"> (${S.abilities(m)[i]})</small>` : ''}</b>
        <label class="abil-save" title="Proficient in ${S.ABILITY_NAMES[a]} saving throws"><input type="checkbox" data-save="${a}" ${saveList.includes(a) ? 'checked' : ''}> Save ${S.signed(S.saveBonus(m, a))}</label></div>`).join('')}</div>
      <p class="hint">${Array.isArray(m.saveProf) ? 'Saving throw proficiencies set on this sheet.' : `Saving throw proficiencies from their class${m.class && S.CLASS_SAVES[m.class] ? ` (${esc(m.class)})` : ''}; tick or untick to change them.`} Click a skill to go from untrained to proficient to expertise. Passive Perception ${S.passivePerception(m)}.</p>
      <div class="skill-grid">${S.SKILLS.map(([s, a]) => { const l = S.skillLevel(m, s); return `<button class="skill lvl-${l}" data-skill="${esc(s)}" title="${['Untrained', 'Proficient', 'Expertise'][l]}"><span class="skill-dot">${['○', '●', '◆'][l]}</span><span class="skill-name">${esc(s)} <span class="muted">${a}</span></span><b>${S.signed(S.skillBonus(m, s))}</b></button>`; }).join('')}</div>
      <div class="row sheet-extras">
        <label class="field" style="width:130px" title="Feats, items or features that add to initiative on top of Dex">Initiative extra<input data-k="initMisc" data-num type="number" value="${esc(m.initMisc ?? 0)}"></label>
        ${tagField('languages', 'Languages', m.languages, { '': S.LANGUAGES })}
        ${tagField('proficiencies', 'Other proficiencies', m.proficiencies, S.PROFICIENCY_GROUPS)}
      </div>
    </div>
    <div>
      <h3>Armour and equipment</h3>
      <div class="row armour-row">
        <label class="field">Armour<select id="armor-sel">${armourOptions}</select></label>
        <label class="field">Shield<select id="shield-sel">${shieldOptions}</select></label>
        ${acInfo.manual ? '' : `<label class="field" style="width:130px" title="Anything else that adds to AC, like a spell or a feature">Other AC bonus<input data-k="acMisc" data-num type="number" value="${esc(m.acMisc ?? 0)}"></label>`}
      </div>
      <p class="hint">${acInfo.manual ? `AC ${acInfo.ac} is set by hand. Choose their armour to have it worked out.` : `AC ${acInfo.ac}: ${esc(acInfo.parts.join(' + '))}.`}${acInfo.stealth ? ' Disadvantage on Stealth checks.' : ''}${strShort ? ` <span class="warn">${esc(m.armor)} needs Strength ${armourItem.str}: speed drops by 10 feet.</span>` : ''}</p>
      ${S.armourWarning(m, d) ? `<p class="hint warn-text">⚠ ${esc(S.armourWarning(m, d))}</p>` : ''}
      <h4>Equipped <span class="muted attune-count" title="A character can be attuned to three magic items at a time">· ${attunedCount}/${S.MAX_ATTUNED} attuned</span></h4>
      ${m.equipped.length ? m.equipped.map(equipRow).join('') : '<p class="hint">Nothing equipped yet. Equipped weapons get an attack to roll here, on the stat block and in battle.</p>'}
      <div class="carried-add"><input id="equip-name" placeholder="Equip something from the item list or their inventory"><button class="btn small" id="equip-add">Equip</button><button class="btn small" id="equip-custom" title="Make a new item. It's added to the item list too.">+ Custom item…</button></div>
      ${pcAttunedSlots(m)}
    </div>
    <div>
      <h3>Essences</h3>
      <p class="hint">${held}/3 held. ${held < 3 ? 'Until all three slots are filled the character is Normal rank, whatever their level. Filling the third makes them Iron rank or higher, and the confluence forms.' : 'A full set: the character holds a rank, and the confluence has formed.'} ${level >= 2 && held < 3 ? `<span class="warn">Level ${level} usually has a full set (${esc(G.rankForLevel(level))} rank).</span>` : ''}</p>
      <div class="slots">
        ${[0, 1, 2].map(i => `<div class="slot${infos[i]?.divine && m.revoked.includes(m.essences[i]) ? ' revoked' : ''}">
          <label><span>Essence ${i + 1}</span><input data-ess="${i}" list="essence-list" value="${esc(m.essences[i] ?? '')}" placeholder="Search essences"></label>
          ${needs?.slots[i] ? `<div class="hint need" title="Aiming for the ${esc(needs.name)} confluence">${needs.slots[i].essence
            ? `For ${esc(needs.name)}: the ${jumpEss(needs.slots[i].essence)} essence <button type="button" class="link-btn" data-need-set="${i}" data-name="${esc(needs.slots[i].essence)}">Add it</button>`
            : `For ${esc(needs.name)}: any ${jumpAff(needs.slots[i].affinity)}-affinity essence <button type="button" class="link-btn" data-need-rand="${i}" data-aff="${esc(needs.slots[i].affinity)}" title="Put a random ${esc(needs.slots[i].affinity)}-affinity essence in this slot">🎲 Random ${esc(needs.slots[i].affinity)}</button>`}</div>` : ''}
          ${essenceCard(infos[i], i)}</div>`).join('')}
        <div class="slot${dormant && !needs ? ' dormant' : ''}">
          <label><span>Confluence${m.confluence && m.confluenceAuto ? ' · formed by the three essences' : ''}</span>
          <input data-conf list="confluence-list" value="${esc(m.confluence ?? '')}" placeholder="${held === 3 ? 'No listed confluence; type one' : 'Forms with the third essence'}"></label>
          <div class="ess-card">${conf ? `${conf.divine ? '<span class="rarity rarity-divine">divine</span> ' : ''}<span class="muted">${esc(conf.theme || '')}</span> <a href="#" class="jump" data-jump="confluences" data-name="${esc(conf.name)}">Details</a>` : ''}
            ${needs ? `<div class="hint">${needs.fits ? 'The goal for this set: the empty slots show what it still needs.' : `<span class="warn">The essences held can't form ${esc(needs.name)}; the empty slots show what's left of it.</span>`}</div>` : dormant ? '<div class="warn">Dormant until three essences are held.</div>' : ''}
            ${m.confluence && !m.confluenceAuto && formed && formed.name !== m.confluence ? `<div class="hint">These essences form ${esc(formed.name)}. <button class="link-btn" id="use-formed">Use it</button></div>` : ''}</div>
        </div>
      </div>
      <div class="carried">
        <h4>Carried, not yet absorbed</h4>
        <p class="hint">A found or bought essence is carried until it is absorbed, which takes a ritual in a safe place over a long rest.</p>
        ${m.carried.map((c, i) => { const ci = G.essenceInfo(d, c); return `<div class="carried-row">
          <strong>${esc(c)}</strong>${ci.kind !== 'unknown' ? ` <span class="rarity rarity-${esc(ci.rarity || 'basic')}">${esc(ci.rarity || 'basic')}</span> <span class="muted">${esc(ci.affinity || '')}</span> <a href="#" class="jump" data-jump="essences" data-name="${esc(ci.name)}">Details</a>` : ''}
          <span class="spacer"></span>
          <button class="btn small" data-absorb="${i}" ${freeSlot ? '' : 'disabled title="No empty essence slot"'}>Absorb…</button>
          <button class="btn small danger" data-drop="${i}" title="Sold, lost or given away">Remove</button></div>`; }).join('')}
        <div class="carried-add"><input id="carry-name" list="essence-list" placeholder="Add a found or bought essence"><button class="btn small" id="carry-add">Carry it</button></div>
      </div>
    </div>
    <div>
      <h3>Powers</h3>
      ${powers.length ? `<div class="powers">${powers.map(w => `<div class="power${w.lost ? ' lost' : ''}">
        <div><strong>${esc(w.name)}</strong> <span class="muted">${esc(w.from)}${w.uses ? ` · ${esc(w.uses)}` : ''}</span></div>
        ${w.lost ? `<div class="warn">${w.confluence ? 'Dormant until three essences are held' : 'Lost while the god has it back'}</div>` : ''}
        <div>${esc(w.text)}</div></div>`).join('')}</div>`
        : '<p class="hint">Each essence and the confluence add a power here.</p>'}
    </div>
    <div>
      <h3>Awakening stones</h3>
      <p class="hint stone-numbers">Stone spells use <select id="spell-ab" title="The ability their stone spells cast with">${opt('', `Auto (${S.ABILITY_NAMES[S.spellAbility({ ...m, spellAbility: '' }, d)]})`, m.spellAbility || '')}${S.ABILITIES.map(a => opt(a, S.ABILITY_NAMES[a], m.spellAbility || '')).join('')}</select>: spell save DC ${sp.dc}, ${S.signed(sp.attack)} to hit. Each is cast once per long rest, without a slot.</p>
      <p class="hint">${liveStones}/${pb} abilities held (limit equals proficiency bonus). Spells up to level ${capLevel}.${coreLevels ? ' Core user: −2 to stone spell attacks and DCs.' : ''} ${liveStones > pb ? '<span class="warn">Over the limit; the oldest should be replaced.</span>' : ''}</p>
      ${m.stones.map(stoneRow).join('')}
      <button class="btn small" id="add-stone" ${m.essences.some(Boolean) ? '' : 'disabled title="Add an essence first"'}>+ Add stone ability</button>
    </div>
    <div>
      <h3>Class features</h3>
      ${classOptionsSection(m)}
    </div>
    <div>
      <h3>Spells</h3>
      ${spellsSection(m, d)}
    </div>
    <div>
      <h3>Spirit coins and cores</h3>
      <p class="hint" style="margin:0 0 4px">Their own spirit coins:</p>
      <div class="coin-row">${G.COIN_RANKS.map(c => `<label class="field">${cap(c)} coins<input data-own-coin="${c}" type="number" min="0" value="${esc(ownCoins(p)[c])}"></label>`).join('')}</div>
      <p class="hint" style="margin:0 0 4px"><span data-own-total>${esc(coinSummary(m))}</span>. <a href="#" id="own-to-purse">Put them all in the party purse</a></p>
      <p class="hint" style="margin:8px 0 4px">The party purse, shared by everyone:</p>
      ${purseEditor('sheet-purse')}
      ${state.saved?.partyItems?.length ? `<p class="hint" style="margin:0 0 4px">Party inventory: ${state.saved.partyItems.map(x => esc(x.name)).join(', ')}. <a href="#" data-nav="party">On the Party page</a></p>` : ''}
      <div class="coin-row">
        ${G.COIN_RANKS.map(c => `<label class="field">${cap(c)} cores<input data-core="${c}" type="number" min="0" value="${esc(m.cores[c] ?? 0)}"></label>`).join('')}
        <label class="field">Levels from cores<input data-k="coreLevels" data-num type="number" min="0" value="${coreLevels}"></label>
      </div>
      <p class="hint">${coreLevels ? ` XP earned is cut by ${Math.min(100, coreLevels * 25)}%.${coreLevels >= 4 ? ' Can now advance only with cores.' : ''} Core users cannot rise above Silver.` : ''}</p>
    </div>
    <details class="looks"${S.LOOK_FIELDS.some(k => m[k]) ? ' open' : ''}>
      <summary>Looks and personality <span class="muted">(for the PDF sheet)</span></summary>
      <div class="looks-head"><button type="button" class="btn small" id="roll-looks" title="Fill every empty field below with a random roll">🎲 Roll empty fields</button></div>
      <div class="grid">${['age', 'height', 'eyes', 'skin', 'hair'].map(k => `<label class="field"><span>${cap(k)} ${rollBtn(k)}</span><input data-k="${k}" value="${esc(m[k] ?? '')}"></label>`).join('')}
        <label class="field">Faction<input data-k="faction" value="${esc(m.faction ?? '')}"></label></div>
      ${[['appearance', 'Appearance', 'What they look like, in words'], ['personality', 'Personality traits'], ['ideals', 'Ideals'], ['bonds', 'Bonds'], ['flaws', 'Flaws'], ['backstory', 'Backstory', 'Left blank, the Backstory or Notes section of this page is used']]
        .map(([k, label, ph]) => `<label class="field"><span>${label} ${G.PC_LOOK_ROLLS.includes(k) ? rollBtn(k) : ''}</span><textarea data-k="${k}" rows="${k === 'backstory' ? 4 : 2}" placeholder="${esc(ph || '')}">${esc(m[k] ?? '')}</textarea></label>`).join('')}
    </details>
  </div>`;

  const save = async (rerender = false) => {
    // AC and initiative are kept on the page too, for the party list and the battle screen.
    m.ac = S.sheetAC(m, d).ac;
    m.initBonus = S.initiative(m);
    let moved = false;
    for (const c of state.saved.battle?.list || []) if (c.kind === 'pc' && c.page === p.id && (c.ac !== m.ac || c.initBonus !== m.initBonus)) { c.ac = m.ac; c.initBonus = m.initBonus; moved = true; }
    if (moved) saveBattle({ history: false });
    await attempt(() => api.pages.write(p.id, m, p.body));
    setSaveState('Saved');
    if (rerender) renderSheet(el, p);
  };
  let t;
  const saveSoon = (rerender) => { setSaveState('Saving…', true); clearTimeout(t); t = setTimeout(() => save(rerender), 400); };
  if (changed) save();

  // Long lists get a dropdown that scrolls and stays on screen.
  $$('[data-ess], #carry-name', el).forEach(inp => attachPicker(inp, essenceItems));
  attachPicker($('[data-conf]', el), () => [...(d.divine?.confluences || []), ...(d.compendium?.confluences || [])].map(c => ({ value: c.name, label: c.divine ? 'divine' : `${(c.affinities || c.trio || []).join(' + ')} affinities` })));
  const classInput = $('[data-k="class"]', el);
  if (classInput) attachPicker(classInput, () => (d.classes?.classes || []).map(c => ({ value: c.name })));
  const originInput = $('[data-k="background"]', el);
  if (originInput) attachPicker(originInput, () => Object.entries(S.ORIGINS).map(([value, o]) => ({ value, label: o.feat })));
  const hpRules = $('#hp-rules', el);
  if (hpRules) hpRules.onclick = e => { e.preventDefault(); const now = sheetHp(m), was = Number(m.hpMax) || 0; m.hpMax = now; m.hp = Math.max(0, Math.min(now, (Number(m.hp) || 0) + now - was)); save(true); };
  $$('[data-k]', el).forEach(inp => inp.addEventListener('change', () => {
    const before = { ...m };
    m[inp.dataset.k] = inp.hasAttribute('data-num') ? Number(inp.value) : inp.value;
    if (['level', 'class'].includes(inp.dataset.k) && followHp(m, before)) return save(true);
    saveSoon(true);
  }));
  // Random looks and personality, one field at a time or every empty one at once.
  const lookCtx = () => {
    const titles = type => [...state.pages.values()].filter(x => x.meta.type === type && !x.meta.dmOnly).map(x => x.meta.title);
    const places = titles('location'), people = titles('npc');
    return { species: m.species, name: m.title, place: () => places.length ? G.pick(Math.random, places) : 'Greenstone', npc: () => people.length ? G.pick(Math.random, people) : 'an old friend' };
  };
  $$('[data-roll-look]', el).forEach(b => b.onclick = e => {
    e.preventDefault();
    m[b.dataset.rollLook] = G.rollPcLook(d, b.dataset.rollLook, lookCtx());
    save(true);
  });
  const rl = $('#roll-looks', el);
  if (rl) rl.onclick = () => {
    const empty = G.PC_LOOK_ROLLS.filter(k => !String(m[k] ?? '').trim());
    if (!empty.length) return toast('Every field already has something in it. Use a field\'s 🎲 to reroll it.');
    for (const k of empty) m[k] = G.rollPcLook(d, k, lookCtx());
    save(true);
  };
  wireClassOptions(el, m, (picks, sub) => { m.classOpts = picks; m.subclass = sub; save(true); });
  $$('[data-tag-add]', el).forEach(sel => sel.addEventListener('change', async () => {
    const k = sel.dataset.tagAdd;
    let v = sel.value;
    if (v === '__custom') {
      const r = await formDialog(k === 'languages' ? 'Add a language' : 'Add a proficiency', `<label class="field">Name<input name="v" required></label>`, 'Add');
      v = r?.v?.trim() || '';
    }
    sel.value = '';
    if (!v) return;
    m[k] = S.joinList([...S.splitList(m[k]), v]);
    save(true);
  }));
  $$('[data-tag-del]', el).forEach(b => b.onclick = () => {
    const k = b.dataset.tagDel;
    m[k] = S.joinList(S.splitList(m[k]).filter(x => x !== b.dataset.v));
    save(true);
  });
  // Spells: picked from their class list first, then any spell; the older cantrips box counts as picked spells too.
  const addSpell = name => {
    const i = G.spellInfo(d, name);
    if (!i) return toast(`There's no spell called ${name} in the spell list.`, true);
    if (S.knownSpells(m).some(x => x.toLowerCase() === i.name.toLowerCase())) return;
    m.spells = [...[].concat(m.spells || []), i.name];
    save(true);
  };
  const spellIn = $('#spell-add', el);
  if (spellIn) {
    attachPicker(spellIn, () => {
      const mine = S.classSpellsFor(d, m), have = new Set(S.knownSpells(m).map(x => x.toLowerCase()));
      const others = Object.values(d.spells?.spells || {}).filter(s => !mine.includes(s)).sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
      return [...mine.map(s => ({ value: s.name, label: `${m.class} ${spellLevelName(s.level)}` })),
        ...others.map(s => ({ value: s.name, label: `${spellLevelName(s.level)} · ${(s.classes || []).join(', ') || 'other'}` }))].filter(x => !have.has(x.value.toLowerCase()));
    });
    spellIn.addEventListener('change', () => { if (spellIn.value.trim()) addSpell(spellIn.value.trim()); });
  }
  $$('[data-spell-pick]', el).forEach(b => b.onclick = () => addSpell(b.dataset.spellPick));
  $$('[data-spell-del]', el).forEach(b => b.onclick = () => {
    const v = b.dataset.spellDel.toLowerCase();
    m.spells = [].concat(m.spells || []).filter(x => x.toLowerCase() !== v && G.spellInfo(d, x)?.name.toLowerCase() !== v);
    m.cantrips = S.joinList(S.splitList(m.cantrips).filter(x => x.toLowerCase() !== v && G.spellInfo(d, x)?.name.toLowerCase() !== v));
    save(true);
  });
  const cs = $('.class-spells', el);
  if (cs) cs.addEventListener('toggle', () => { state.classSpellsOpen = cs.open; });
  $$('[data-ess]', el).forEach(inp => inp.addEventListener('change', () => {
    // Match the list's spelling, so "healer (Divine)" finds the Healer's essence.
    const info = G.essenceInfo(d, inp.value);
    const i = Number(inp.dataset.ess), was = m.essences[i];
    const name = info?.name || '';
    m.essences[i] = name;
    m.essences = m.essences.map(x => x || '');
    while (m.essences.length && !m.essences[m.essences.length - 1]) m.essences.pop();
    // Stones awakened on the old essence move to the new one.
    if (was && name) for (const s of m.stones) if (s.essence === was) s.essence = name;
    saveSoon(true);
  }));
  $('[data-conf]', el).addEventListener('change', e => {
    const v = e.target.value.trim();
    m.confluence = G.confluenceInfo(d, v)?.name || v;
    // Clearing the field hands the confluence back to the essences.
    m.confluenceAuto = !v;
    saveSoon(true);
  });
  const uf = $('#use-formed', el);
  if (uf) uf.onclick = () => { m.confluenceAuto = true; save(true); };
  const fillSlot = (i, name) => {
    m.essences[i] = name;
    m.essences = [0, 1, 2].map(j => m.essences[j] || '');
    while (m.essences.length && !m.essences[m.essences.length - 1]) m.essences.pop();
    save(true);
  };
  $$('[data-need-set]', el).forEach(b => b.onclick = () => fillSlot(Number(b.dataset.needSet), b.dataset.name));
  $$('[data-need-rand]', el).forEach(b => b.onclick = () => {
    const name = G.randomEssenceOf(d, b.dataset.aff, [...m.essences, ...m.carried]);
    if (!name) return toast(`No ${b.dataset.aff}-affinity essence left to pick`, true);
    toast(`${name} essence added to slot ${Number(b.dataset.needRand) + 1}`);
    fillSlot(Number(b.dataset.needRand), name);
  });
  $$('[data-stone]', el).forEach(inp => inp.addEventListener('change', () => {
    const s = m.stones[Number(inp.dataset.stone)];
    const f = inp.dataset.f;
    s[f] = f === 'level' ? Number(inp.value) : inp.value;
    if (f === 'spell') {
      const hit = stoneSpellList(s.essence, 5).find(x => x.spell === s.spell);
      if (hit) s.level = hit.level;
    }
    if (f === 'essence' && !stoneSpellList(s.essence, 5).some(x => x.spell === s.spell)) s.spell = '';
    saveSoon(f !== 'level');
  }));
  $$('[data-revoke]', el).forEach(box => box.addEventListener('change', () => {
    const name = box.dataset.revoke;
    m.revoked = box.checked ? [...new Set([...m.revoked, name])] : m.revoked.filter(r => r !== name);
    toast(box.checked ? `${name} revoked: its awakening stone abilities are lost and the confluence goes dormant` : `${name} restored`);
    save(true);
  }));
  $$('[data-absorb]', el).forEach(b => b.onclick = async () => {
    const name = m.carried[Number(b.dataset.absorb)];
    const r = await formDialog(`Absorb ${name}`, `<p class="muted" style="margin:0 0 10px">Absorbing an essence takes a ritual in a safe place, over a long rest. Once it's done, the essence is bonded for life and fills an empty slot.</p>
      <label class="revoke"><input type="checkbox" name="done" required> ${esc(m.title)} has finished the ritual</label>`, 'Absorb');
    if (!r) return;
    const err = G.absorbEssence(m, name);
    if (err) return toast(err, true);
    toast(`${m.title} absorbed ${name}`);
    save(true);
  });
  $$('[data-drop]', el).forEach(b => b.onclick = async () => {
    const name = m.carried[Number(b.dataset.drop)];
    if (!await confirmDialog(`Remove ${name}?`, `Take ${name} off ${m.title}'s carried essences, because it was sold, lost or given away.`, 'Remove')) return;
    m.carried.splice(Number(b.dataset.drop), 1);
    save(true);
  });
  const addCarried = () => {
    const info = G.essenceInfo(d, $('#carry-name', el).value);
    if (!info) return;
    if (info.kind === 'divine') return toast('Divine essences are granted by a god, never carried. Put it straight into an essence slot.', true);
    G.carryEssence(m, info.name);
    save(true);
  };
  $('#carry-add', el).onclick = addCarried;
  $('#carry-name', el).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addCarried(); } });
  $$('[data-remove-stone]', el).forEach(b => b.onclick = () => { m.stones.splice(Number(b.dataset.removeStone), 1); save(true); });
  $('#add-stone', el).onclick = () => { m.stones.push({ essence: live[0] || m.essences.find(Boolean) || '', spell: '', level: 1 }); save(true); };
  $$('[data-abil]', el).forEach(inp => inp.addEventListener('change', () => {
    const before = { ...m, abilities: [...m.abilities] };
    m.abilities[Number(inp.dataset.abil)] = Math.max(1, Math.min(30, Number(inp.value) || 10));
    if (followHp(m, before)) return save(true);
    saveSoon(true);
  }));
  $$('[data-save]', el).forEach(box => box.addEventListener('change', () => {
    m.saveProf = $$('[data-save]', el).filter(b => b.checked).map(b => b.dataset.save);
    save(true);
  }));
  $$('[data-skill]', el).forEach(b => b.onclick = () => {
    const s = b.dataset.skill, next = (S.skillLevel(m, s) + 1) % 3;
    m.skills = [].concat(m.skills || []).filter(x => x !== s);
    m.expertise = [].concat(m.expertise || []).filter(x => x !== s);
    if (next >= 1) m.skills.push(s);
    if (next === 2) m.expertise.push(s);
    save(true);
  });
  $('#armor-sel', el).onchange = async e => {
    let v = e.target.value;
    if (v === '__custom') v = await customItemDialog('armour');
    if (v == null) return renderSheet(el, p);
    m.armor = v;
    save(true);
  };
  $('#shield-sel', el).onchange = async e => {
    let v = e.target.value;
    if (v === '__custom') v = await customItemDialog('shield');
    if (v == null) return renderSheet(el, p);
    m.shield = v;
    save(true);
  };
  $('#spell-ab', el).onchange = e => { m.spellAbility = e.target.value; save(true); };
  $$('[data-eq]', el).forEach(inp => inp.addEventListener('change', () => {
    const e = m.equipped[Number(inp.dataset.eq)];
    if (inp.dataset.f === 'ac') e.ac = Number(inp.value) || 0;
    else if (inp.dataset.f === 'choice') e.choice = inp.value || undefined;
    else if (inp.dataset.w === 'prof') e.weapon.prof = inp.checked;
    else if (inp.dataset.w === 'bonus') e.weapon.bonus = Number(inp.value) || 0;
    else e.weapon[inp.dataset.w] = inp.value.trim();
    saveSoon(true);
  }));
  $$('[data-unequip]', el).forEach(b => b.onclick = () => {
    const [gone] = m.equipped.splice(Number(b.dataset.unequip), 1);
    if (gone && !m.equipped.some(e => e.name === gone.name)) m.attuned = m.attuned.filter(n => n !== gone.name);
    save(true);
  });
  $$('[data-attune]', el).forEach(b => b.onchange = () => {
    const name = m.equipped[Number(b.dataset.attune)].name;
    m.attuned = m.attuned.filter(n => n !== name);
    if (b.checked) {
      if (S.attunedItems(m).length >= S.MAX_ATTUNED) { toast(`${m.title} is already attuned to ${S.MAX_ATTUNED} items. Unattune one first.`, true); return renderSheet(el, p); }
      m.attuned.push(name);
    }
    save(true);
  });
  const equipInput = $('#equip-name', el);
  attachPicker(equipInput, () => equipItems(p));
  let equipped = false;
  const equip = name => {
    name = String(name || '').trim();
    if (!name || equipped) return;
    equipped = true;
    const a = S.armourOf(G.itemInfo(d, name));
    // Armour and shields go in their own slots, where they count towards AC.
    if (a?.kind === 'shield') { m.shield = G.itemInfo(d, name).name; toast(`${m.shield} is now ${m.title}'s shield.`); }
    else if (a) { m.armor = G.itemInfo(d, name).name; toast(`${m.title} now wears ${m.armor}.`); }
    else m.equipped.push(S.equipEntry(d, name));
    save(true);
  };
  // Picking from the list equips it straight away; a typed name waits for Equip or Enter.
  equipInput.addEventListener('change', e => { if (!e.isTrusted) equip(equipInput.value); });
  equipInput.addEventListener('keydown', e => { if (e.key === 'Enter' && (!picker || picker.sel < 0)) { e.preventDefault(); closePicker(); equip(equipInput.value); } });
  $('#equip-add', el).onclick = () => equip(equipInput.value);
  $('#equip-custom', el).onclick = async () => { const name = await customItemDialog('weapon'); if (name) equip(name); };
  wirePcAttuned(el, p, save);
  wirePurse(el);
  $$('[data-own-coin]', el).forEach(inp => inp.addEventListener('change', () => { ownCoins(p)[inp.dataset.ownCoin] = Math.max(0, Number(inp.value) || 0); $('[data-own-total]', el).textContent = coinSummary(m); saveSoon(true); }));
  $('#own-to-purse', el)?.addEventListener('click', async e => {
    e.preventDefault();
    const c = ownCoins(p);
    if (!G.purseValue(c)) return toast(`${m.title} has no coins of their own.`);
    const purse = partyPurse();
    for (const k of G.COIN_RANKS) { purse[k] += c[k]; c[k] = 0; }
    await savePurse();
    save(true);
    toast(`${m.title}'s coins went into the party purse.`);
  });
  $$('[data-core]', el).forEach(inp => inp.addEventListener('change', () => { m.cores[inp.dataset.core] = Number(inp.value) || 0; saveSoon(true); }));
  $$('[data-hp]', el).forEach(b => b.onclick = () => {
    const max = Number(m.hpMax) || 0;
    m.hp = b.dataset.hp === 'full' ? max : Math.max(0, Math.min(max, (Number(m.hp) || 0) + Number(b.dataset.hp)));
    save(true);
  });
  playSheet(el, p, conf);
}

/** A party member's three attunement slots: the items they're attuned to, and a box to attune another (which equips it). */
function pcAttunedSlots(m) {
  const d = state.data;
  const on = S.attunedItems(m);
  const slot = i => {
    const e = on[i];
    if (!e) return `<div class="attuned-slot empty"><b>${i + 1}</b>${i === on.length ? '<input id="pc-attune-name" placeholder="Attune a magic item (it is equipped too)"><button class="btn small" id="pc-attune-add">Attune</button>' : '<span class="muted">Empty</span>'}</div>`;
    const item = G.itemInfo(d, e.item || e.name);
    const fx = S.fxText(e.fx);
    return `<div class="attuned-slot"><b>${i + 1}</b><span class="attuned-name">${item ? `<a href="#" class="jump" data-jump="items" data-name="${esc(item.name)}">${esc(e.name)}</a>` : esc(e.name)}${fx ? ` <span class="hint">Gives ${esc(fx)}.</span>` : ''}</span>
      <button class="btn small" data-pc-unattune="${esc(e.name)}" title="End the attunement; the item stays equipped">Unattune</button></div>`;
  };
  return `<div class="pc-attuned"><h4>Attuned items <span class="muted">· ${on.length}/${S.MAX_ATTUNED}</span></h4>
    ${[0, 1, 2].map(slot).join('')}
    <p class="hint">These fill the Attuned 1–3 rows on the PDF sheet. An item that needs attunement only works while it's here.</p></div>`;
}
function wirePcAttuned(el, p, save) {
  const m = p.meta, d = state.data;
  $$('[data-pc-unattune]', el).forEach(b => b.onclick = () => { m.attuned = m.attuned.filter(n => n !== b.dataset.pcUnattune); save(true); });
  const input = $('#pc-attune-name', el);
  if (!input) return;
  // Equipped items waiting for attunement come first, then every magic item that needs it.
  attachPicker(input, () => {
    const waiting = m.equipped.filter(e => e.attune && !S.isActive(m, e)).map(e => ({ value: e.name, label: 'Equipped, not attuned' }));
    return [...waiting, ...G.itemCatalog(d).filter(i => i.attune && !waiting.some(w => w.value === i.name)).map(i => ({ value: i.name, label: `${i.rarity} · ${String(i.desc || '').slice(0, 70)}` }))];
  });
  let busy = false;
  const add = () => {
    const name = G.itemInfo(d, input.value)?.name || input.value.trim();
    if (!name || busy) return;
    if (m.attuned.includes(name) && m.equipped.some(e => e.name === name && e.attune)) return toast(`${m.title} is already attuned to ${name}.`, true);
    if (S.attunedItems(m).length >= S.MAX_ATTUNED) return toast(`${m.title} is already attuned to ${S.MAX_ATTUNED} items. Unattune one first.`, true);
    busy = true;
    let e = m.equipped.find(x => x.name === name);
    if (!e) { e = S.equipEntry(d, name); m.equipped.push(e); }
    // Anything typed in is taken to need attunement, even when the item list doesn't say so.
    if (!e.attune) { e.attune = true; e.attuneManual = true; }
    m.attuned = [...m.attuned.filter(n => n !== name), name];
    save(true);
  };
  input.addEventListener('change', e => { if (!e.isTrusted) add(); });
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && (!picker || picker.sel < 0)) { e.preventDefault(); closePicker(); add(); } });
  $('#pc-attune-add', el).onclick = add;
}

/**
 * An NPC's subclass and class options, from the class and level on its stat block. Until the DM picks, the app picks
 * for them (the same each time), and the PDF sheet lists them under features.
 */
function npcClassPanel(p) {
  const o = S.npcClassOpts(p.meta, p.body);
  if (!o) return '';
  const m = { ...o.m, classOpts: o.picked };
  return `<section class="npc-class dm-tool">
    <h3>Class features <span class="muted">· ${classLink(o.m.class)} ${o.m.level}</span></h3>
    ${p.meta.classOpts ? '' : '<p class="hint">Picked for them from their class and level. Change any of it to keep your own.</p>'}
    ${classOptionsSection(m, { prefix: 'npc-' })}
  </section>`;
}
function wireNpcClass(p) {
  const box = $('.npc-class');
  const o = box && S.npcClassOpts(p.meta, p.body);
  if (!o) return;
  wireClassOptions(box, { ...o.m, classOpts: o.picked }, async (picks, sub) => {
    p.meta.classOpts = picks;
    if (sub !== o.m.subclass) p.meta.subclass = sub;
    await attempt(() => api.pages.write(p.id, p.meta, p.body));
    renderPage(p.id);
  }, 'npc-');
}

/** For an item that resists "one damage type" (ring of resistance, armour of vulnerability): which one, so the battle screen applies it. */
function resistPick(item, choice, attrs) {
  const types = S.itemDefences(item).choose;
  if (!types) return '';
  return `<label class="inline-field" title="The damage type it resists. The battle screen halves that damage for them${types.length === 3 ? ' and doubles the other two' : ''}.">Resists <select ${attrs}${choice ? '' : ' class="unset"'}><option value="">Pick a type…</option>${types.map(t => `<option ${t === choice ? 'selected' : ''}>${t}</option>`).join('')}</select></label>`;
}
/** An NPC's attuned magic items (up to three), kept in the page's data. The PDF sheet works them into the stat block's numbers. */
/** An NPC with a stat block (or attuned items already): only then do the PDF sheet and attunement panels show. */
const npcFights = p => /<div class="statblock">/.test(p.body || '') || [].concat(p.meta.attuned || []).length > 0;
function npcAttunedPanel(p) {
  const d = state.data;
  const names = [].concat(p.meta.attuned || []);
  return `<section class="npc-attuned dm-tool">
    <h3>Attuned items <span class="muted">· ${names.length}/${S.MAX_ATTUNED}</span></h3>
    ${names.map((n, i) => {
      const item = G.itemInfo(d, n);
      const e = S.equipEntry(d, n);
      const fx = [e.ac ? `+${e.ac} AC` : '', S.fxText(e.fx), e.weapon ? `an attack (${e.weapon.dice} ${e.weapon.type}${e.weapon.bonus ? `, +${e.weapon.bonus}` : ''}${e.weapon.extra ? ` plus ${e.weapon.extra}` : ''})` : ''].filter(Boolean).join(', ');
      return `<div class="attuned-item"><strong>${item ? `<a href="#" class="jump" data-jump="items" data-name="${esc(item.name)}">${esc(n)}</a>` : esc(n)}</strong>
        <span class="muted">${esc(item?.desc || '')}</span>${fx ? ` <span class="hint">Adds ${esc(fx)}.</span>` : ''}
        ${resistPick(item, p.meta.attuneChoice?.[n], `data-attune-choice="${esc(n)}"`)}
        <button class="btn small danger" data-unattune="${i}" title="No longer attuned">Remove</button></div>`;
    }).join('') || '<p class="hint">None. Magic items they\'re attuned to can raise their AC, saves and scores, give spells or add an attack; the PDF sheet adds them to the stat block\'s numbers.</p>'}
    ${names.length < S.MAX_ATTUNED ? '<div class="carried-add"><input id="npc-attune-name" placeholder="Add a magic item they\'re attuned to"><button class="btn small" id="npc-attune-add">Attune</button></div>' : ''}
  </section>`;
}

function wireNpcAttuned(p) {
  const box = $('.npc-attuned');
  if (!box) return;
  const save = async names => {
    p.meta.attuned = names;
    if (!names.length) delete p.meta.attuned;
    await attempt(() => api.pages.write(p.id, p.meta, p.body));
    renderPage(p.id);
  };
  $$('[data-attune-choice]', box).forEach(x => x.onchange = async () => {
    p.meta.attuneChoice = { ...(p.meta.attuneChoice || {}), [x.dataset.attuneChoice]: x.value || undefined };
    await attempt(() => api.pages.write(p.id, p.meta, p.body));
  });
  $$('[data-unattune]', box).forEach(b => b.onclick = () => save([].concat(p.meta.attuned || []).filter((_, i) => i !== Number(b.dataset.unattune))));
  const input = $('#npc-attune-name', box);
  if (!input) return;
  attachPicker(input, () => G.itemCatalog(state.data).filter(i => i.attune).map(i => ({ value: i.name, label: `${i.rarity} · ${String(i.desc || '').slice(0, 70)}` })));
  let busy = false;
  const add = () => {
    const name = G.itemInfo(state.data, input.value)?.name || input.value.trim();
    if (!name || busy) return;
    const have = [].concat(p.meta.attuned || []);
    if (have.includes(name)) return toast(`Already attuned to ${name}.`, true);
    busy = true;
    save([...have, name].slice(0, S.MAX_ATTUNED));
  };
  input.addEventListener('change', e => { if (!e.isTrusted) add(); });
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && (!picker || picker.sel < 0)) { e.preventDefault(); closePicker(); add(); } });
  $('#npc-attune-add', box).onclick = add;
}

/** The lines of a party member's inventory list, as typed. */
function inventoryLines(body) {
  const sec = String(body || '').match(/^## Inventory[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m)?.[1] || '';
  return sec.split('\n').map(l => l.match(/^\s*[-*]\s+(.+)$/)?.[1]?.trim()).filter(Boolean);
}

/** What the equip box offers: their inventory first, then every item in the item list. */
function equipItems(p) {
  const d = state.data;
  const inv = inventoryLines(p.body).map(l => ({ value: G.itemInfo(d, l)?.name || l, label: 'in their inventory' }));
  const seen = new Set(inv.map(x => x.value.toLowerCase()));
  return [...inv, ...G.itemCatalog(d).filter(i => !seen.has(i.name.toLowerCase())).map(i => ({ value: i.name, label: `${i.cat} · ${String(i.desc || '').slice(0, 70)}` }))];
}

const DAMAGE_TYPES = ['slashing', 'piercing', 'bludgeoning', 'acid', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'poison', 'psychic', 'radiant', 'thunder'];
const WEAPON_PROPS = ['Finesse', 'Light', 'Heavy', 'Two-handed', 'Reach', 'Thrown', 'Ammunition', 'Loading'];

/** Make a new item (a weapon, armour, a shield or anything else) and add it to the campaign's item list. Gives back its name. */
async function customItemDialog(kind = 'weapon') {
  const kinds = { weapon: 'Weapon', armour: 'Armour', shield: 'Shield', item: 'Other item' };
  const pending = formDialog('New custom item', `
    <p class="hint" style="margin:0 0 8px">It's added to the item list too, so it can be given, sold or equipped again.</p>
    <div class="row"><label class="field" style="flex:2">Name<input name="name" required></label>
      <label class="field">Kind<select name="kind" id="ci-kind">${Object.entries(kinds).map(([k, l]) => `<option value="${k}" ${k === kind ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
    <div class="ci-part" data-for="weapon">
      <div class="row"><label class="field">Damage dice<input name="dice" value="1d8"></label>
        <label class="field">Damage type<select name="dtype">${DAMAGE_TYPES.map(t => `<option>${t}</option>`).join('')}</select></label>
        <label class="field">Range (ft)<input name="range" placeholder="20/60 or 80/320"></label></div>
      <div class="row ci-props">${WEAPON_PROPS.map(x => `<label class="revoke"><input type="checkbox" name="p:${x}"> ${x}</label>`).join('')}</div>
      <div class="row"><label class="field">Versatile damage<input name="versatile" placeholder="1d10"></label>
        <label class="field" title="Added to attack and damage rolls">Magic bonus<input name="magic" type="number" min="0" value="0"></label>
        <label class="field">Weapon class<select name="wclass"><option value="martial">Martial</option><option value="simple">Simple</option></select></label></div>
    </div>
    <div class="ci-part" data-for="armour"><div class="row">
      <label class="field">Type<select name="atype"><option value="light">Light: AC + Dex</option><option value="medium">Medium: AC + Dex (max 2)</option><option value="heavy">Heavy: no Dex</option></select></label>
      <label class="field">Base AC<input name="base" type="number" min="0" value="12"></label>
      <label class="field">Strength needed<input name="str" type="number" min="0" value="0"></label></div>
      <label class="revoke"><input type="checkbox" name="stealth"> Disadvantage on Stealth</label></div>
    <div class="ci-part" data-for="shield"><label class="field" style="max-width:160px">AC bonus<input name="sbonus" type="number" value="2"></label></div>
    <div class="ci-part" data-for="item"><label class="field" style="max-width:220px">AC bonus while equipped<input name="ibonus" type="number" value="0"></label></div>
    <label class="field">Description<textarea name="desc" rows="2" placeholder="What it looks like, and anything special it does"></textarea></label>
    <div class="row"><label class="field">Price (gp)<input name="price" type="number" min="0"></label>
      <label class="field">Rarity<select name="rarity">${G.ITEM_RARITIES.map(r => `<option value="${r}">${cap(r)}</option>`).join('')}</select></label>
      <label class="field">Weight (lb)<input name="weight" type="number" min="0" step="0.5"></label></div>`, 'Create');
  const sel = $('#ci-kind');
  const show = () => $$('#dialog .ci-part').forEach(x => { x.hidden = x.dataset.for !== sel.value; });
  sel.onchange = show;
  show();
  const r = await pending;
  if (!r) return null;
  const name = r.name.trim();
  if (G.itemInfo(state.data, name)) { toast(`There's already an item called ${G.itemInfo(state.data, name).name} in the item list. Pick it from the list, or use another name.`, true); return null; }
  const extra = r.desc.trim().replace(/([^.!?])$/, '$1.');
  const magic = r.rarity !== 'mundane';
  const item = { name, cat: '', price: r.price === '' ? null : Number(r.price), desc: '', rarity: r.rarity, source: 'custom', tags: [] };
  if (r.weight !== '') item.weight = Number(r.weight);
  if (r.kind === 'weapon') {
    const range = r.range.trim() || null;
    const props = WEAPON_PROPS.filter(x => r[`p:${x}`]).map(x => x === 'Thrown' ? `thrown (${range || '20/60'})` : x === 'Ammunition' ? `ammunition (${range || '80/320'})` : x.toLowerCase());
    if (r.versatile.trim()) props.push(`versatile (${r.versatile.trim()})`);
    const dice = G.parseDice(r.dice) ? G.diceText(G.parseDice(r.dice)).replace(/\s+/g, '') : '1d6';
    const bonus = Number(r.magic) || 0;
    item.desc = [`${dice} ${r.dtype}.`, props.length ? `${cap(props.join(', '))}.` : '', bonus ? `+${bonus} to attack and damage rolls.` : '', extra].filter(Boolean).join(' ');
    item.cat = magic ? 'Magic items' : 'Weapons';
    item.tags = ['weapon', r['p:Ammunition'] ? 'ranged' : r.wclass, 'custom'];
    if (bonus) item.magic = bonus;
  } else if (r.kind === 'armour') {
    const base = Number(r.base) || 10;
    item.desc = [`${cap(r.atype)} armour. AC ${base}${r.atype === 'light' ? ' + Dex modifier' : r.atype === 'medium' ? ' + Dex modifier (max 2)' : ''}.`, Number(r.str) ? `Strength ${Number(r.str)}.` : '', r.stealth ? 'Disadvantage on Stealth.' : '', extra].filter(Boolean).join(' ');
    item.cat = magic ? 'Magic items' : 'Armour';
    item.tags = ['armour', 'custom'];
  } else if (r.kind === 'shield') {
    item.shieldAC = Number(r.sbonus) || 2;
    item.desc = [`Carried in one hand. +${item.shieldAC} AC.`, extra].filter(Boolean).join(' ');
    item.cat = magic ? 'Magic items' : 'Armour';
    item.tags = ['armour', 'shield', 'custom'];
  } else {
    const bonus = Number(r.ibonus) || 0;
    item.desc = [bonus ? `+${bonus} AC while equipped.` : '', extra].filter(Boolean).join(' ') || 'A custom item.';
    item.cat = magic ? 'Magic items' : 'Adventuring gear';
    item.tags = ['custom'];
  }
  const ok = await attempt(async () => {
    const all = JSON.parse(await api.data.readRaw('items'));
    all.items = [...(all.items || []), item];
    await api.data.writeRaw('items', JSON.stringify(all, null, 1));
    state.data.items = all;
    return true;
  });
  if (!ok) return null;
  toast(`${name} added to the item list.`);
  return name;
}

/** Fill a classic 5e character sheet PDF from a party member's sheet or an NPC's stat block. */
const NPC_BODY = ['age', 'height', 'eyes', 'skin', 'hair'];
async function exportSheetPdf(id) {
  const p = state.pages.get(id);
  if (!p) return;
  const m = p.meta;
  let notes = G.stripDM(p.body);
  const hasDM = notes.trim() !== p.body.trim();
  const isNpc = m.type !== 'pc';
  // The DM decides whether their notes go on the sheet, and settles an NPC's origin; from player view neither is asked.
  if (state.dm && (hasDM || isNpc)) {
    const draft = isNpc ? S.npcSheetCharacter(m, p.body, p.body, state.data) : null;
    const guess = draft?.background || '';
    const r = await formDialog('PDF character sheet', `${isNpc ? `<label class="field" title="Kept on the page (but not shown) so the sheet lists the origin feat">Origin<select name="origin">${Object.entries(S.ORIGINS).map(([o, x]) => `<option value="${esc(o)}"${o === guess ? ' selected' : ''}>${esc(o)} (${esc(x.feat)})</option>`).join('')}</select></label>
      <p class="hint" style="margin:8px 0 4px">Worked out from their description and people where it doesn't say. Change any of them; they're kept on the page for next time.</p>
      <div class="row">${NPC_BODY.map(k => `<label class="field">${cap(k)}<input name="${k}" value="${esc(draft[k] || '')}"></label>`).join('')}</div>` : ''}
      ${hasDM ? `<label class="field">DM notes<select name="dm">${isNpc
        ? '<option value="yes">Include them: personality, ideals, bonds, flaws and backstory</option><option value="no">Leave them out (for handing to a player)</option>'
        : '<option value="no">Leave them out of the backstory (for handing to a player)</option><option value="yes">Include them</option>'}</select></label>` : ''}`, 'Make PDF');
    if (!r) return;
    if (r.dm === 'yes') notes = p.body;
    if (isNpc) {
      const before = JSON.stringify(m);
      if (r.origin) m.origin = r.origin;
      for (const k of NPC_BODY) { if (r[k]?.trim()) m[k] = r[k].trim(); else delete m[k]; }
      if (JSON.stringify(m) !== before) await attempt(() => api.pages.write(p.id, m, p.body));
    }
  }
  let c;
  if (!isNpc) c = S.pcSheetCharacter(m, state.data, notes);
  else {
    if (!/\|\s*STR\s*\|/i.test(p.body)) toast(`${m.title} has no stat block with ability scores on the page, so most numbers are left at 10.`, true);
    c = S.npcSheetCharacter(m, p.body, notes, state.data);
  }
  const image = m.image && !/^https?:/.test(m.image) ? m.image : null;
  const where = await attempt(() => api.files.saveSheetPdf(`${m.title} character sheet.pdf`, S.sheetPdfFields(c), image));
  if (where) toast(`Saved ${m.title}'s character sheet PDF.`);
}

/** A party member's stat block, laid out like the bestiary's and worked out from their sheet. Weapon attacks roll. */
/** A party member as a stat block. What they do most comes first (actions, spells, stone spells), essence powers last. */
// ----- spell slots -----
const ORD = n => `${n}${['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10] || 'th'}`;
/** A party member's spell slots as rows of pips: filled = left. Clicking a pip spends or gets back slots up to it. */
function slotPips(p) {
  const m = p.meta, rows = S.slotsFor(m);
  if (!rows.length) return '';
  return `<div class="slot-pips" title="Spell slots: click a pip to mark it spent or get it back. A long rest refills them${rows[0].pact ? '; pact slots also come back on a short rest' : ''}.">${rows.map(r => {
    const used = Math.min(r.max, Number(m.slotsUsed?.[r.key]) || 0);
    const label = r.pact ? `Pact (${ORD(r.level)})` : r.arcanum ? `Arcanum ${ORD(r.level)}` : ORD(r.level);
    return `<span class="slot-row${used >= r.max ? ' spent' : ''}"><b>${label}</b>${Array.from({ length: r.max }, (_, i) => `<button type="button" class="slot-pip${i < r.max - used ? ' left' : ''}" data-slot-pip="${esc(p.id)}|${esc(r.key)}|${i}" aria-label="${label} slot ${i + 1}"></button>`).join('')}</span>`;
  }).join('')}</div>`;
}
/** Set how many of one slot row are spent, save the sheet and redraw what shows it. */
async function setSlotsUsed(p, key, used) {
  const rows = S.slotsFor(p.meta), r = rows.find(x => x.key === key);
  if (!r) return;
  const slotsUsed = { ...(p.meta.slotsUsed || {}) };
  slotsUsed[key] = Math.max(0, Math.min(r.max, used));
  if (!slotsUsed[key]) delete slotsUsed[key];
  p.meta = { ...p.meta, slotsUsed };
  await attempt(() => api.pages.write(p.id, p.meta, p.body));
  for (const el of document.querySelectorAll('.slot-pips')) {
    const pip = el.querySelector('[data-slot-pip]');
    if (pip?.dataset.slotPip.startsWith(`${p.id}|`)) el.outerHTML = slotPips(p);
  }
}
/** A pip clicked: a lit pip and the ones after it are spent; an unlit one comes back with the ones before it. */
function clickSlotPip(btn) {
  const [id, key, i] = btn.dataset.slotPip.split('|');
  const p = state.pages.get(id), r = p && S.slotsFor(p.meta).find(x => x.key === key);
  if (!r) return;
  const left = r.max - (Number(p.meta.slotsUsed?.[key]) || 0), n = Number(i);
  setSlotsUsed(p, key, n < left ? r.max - n : r.max - n - 1);
}
/** The party member a stat block line belongs to, by name. */
const pcNamed = name => name ? [...state.pages.values()].find(p => p.meta.type === 'pc' && p.meta.title === name) : null;
/**
 * A party member casting a levelled spell from a stat block spends a slot: the one picked on the line, or the lowest
 * that will do. With none left the cast stops, unless Shift was held, which casts it anyway without a slot.
 * When the picked level is used up, it asks before spending a higher slot, and the roll is then made at that level.
 * Resolves to the button to roll from (the higher slot's, when it changed), or null when the cast should not go ahead.
 */
async function spendSlotFor(btn, force) {
  const line = btn.closest('.sb-line[data-line]');
  if (!line) return btn;
  const o = JSON.parse(line.dataset.line);
  const p = pcNamed(o.who);
  const sp = G.spellInfo(state.data, o.name);
  const lvl = Number(sp?.level) || 0;
  // Cantrips, monsters and spells cast another way (stones, items) don't use slots.
  if (!p || !lvl || !o.slots?.length || !S.slotsFor(p.meta).length) return btn;
  const key = `${o.who}|${sp?.name || o.name}`;
  const wanted = Number(o.slots.includes(state.castSlots?.[key]) ? state.castSlots[key] : o.slots[0]) || lvl;
  const row = S.slotToSpend(p.meta, lvl, wanted);
  if (!row) {
    if (force) { toast(`${o.who} casts ${o.name} with no slot left (Shift+click).`); logSlot(`${o.who} casts ${o.name} without a slot.`); return btn; }
    toast(`${o.who} has no ${ORD(wanted)}-level slot or higher left for ${o.name}. Shift+click to cast it anyway.`, true);
    return null;
  }
  if (row.level !== wanted && !row.pact) {
    if (force) { toast(`${o.who} casts ${o.name} with no ${ORD(wanted)}-level slot left (Shift+click).`); logSlot(`${o.who} casts ${o.name} without a slot.`); return btn; }
    const ok = await confirmDialog(`No ${ORD(wanted)}-level slot left`, `${o.who} has no ${ORD(wanted)}-level slots left. Cast ${o.name} with a ${ORD(row.level)}-level slot instead? It is cast at that level.`, `Use a ${ORD(row.level)}-level slot`);
    if (!ok) return null;
  }
  setSlotsUsed(p, row.key, (Number(p.meta.slotsUsed?.[row.key]) || 0) + 1);
  logSlot(`${o.who} uses a ${row.pact ? 'pact' : ORD(row.level) + '-level'} slot for ${o.name} (${S.slotsLeft(p.meta, row)} left).`);
  if (row.level === wanted || !o.slots.includes(row.level)) return btn;
  // Cast at the higher level: the roll comes from the line as it would be drawn for that slot.
  const slots = (state.castSlots ||= {}), had = slots[key];
  slots[key] = row.level;
  const fresh = document.createElement('div');
  fresh.innerHTML = spellLine(o.name, o.nums, o.level, o.note, { slots: o.slots, who: o.who });
  if (had == null) delete slots[key]; else slots[key] = had;
  const kind = btn.matches('[data-roll]') ? '[data-roll]' : btn.matches('[data-attack]') ? '[data-attack]' : btn.matches('[data-summon]') ? '[data-summon]' : '[data-cast]';
  return fresh.querySelector(kind) || btn;
}
function logSlot(text) {
  if (state.view?.kind === 'battle' && battle().turn) { battleLog(text); saveBattle(); }
}

function pcStatBlock(p, who = p.meta.title) {
  const m = p.meta, d = state.data;
  const level = Number(m.level) || 1;
  const rank = G.pcRank(m);
  const ac = S.sheetAC(m, d);
  const line = (k, val) => val ? `<div><b>${k}</b> ${esc(val)}</div>` : '';
  const revoked = [].concat(m.revoked || []);
  const worn = ac.manual ? '' : [m.armor !== 'none' && m.armor, m.shield].filter(Boolean).map(x => x.toLowerCase()).join(', ');
  const powers = G.sheetPowers(d, { essences: [].concat(m.essences || []), revoked, confluence: m.confluence, level }).filter(w => !w.lost);
  const attacks = S.pcAttacks(m);
  const stones = [].concat(m.stones || []).filter(s => s.spell && !revoked.includes(s.essence));
  const sp = S.spellNumbers(m, d);
  const cast = { ...S.castingNumbers(m, d), ...S.classSpellBonus(m) };
  const always = subclassSpells(m).filter(x => !S.knownSpells(m).some(k => k.toLowerCase() === x.name.toLowerCase()));
  const known = [...S.knownSpells(m), ...always.map(x => x.name)].map(x => G.spellInfo(d, x) || { name: x, level: 0 }).sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  const alwaysOf = n => always.find(x => x.name.toLowerCase() === n.toLowerCase())?.from || '';
  const essences = [].concat(m.essences || []).filter(Boolean);
  return `<div class="mstat pc-stat" data-who="${esc(who)}">
    <h2>${esc(m.title)}</h2>
    <p class="sb-sub">Medium humanoid (${esc(m.species || 'unknown people')}), ${m.class ? classLink(m.class, m.class.toLowerCase()) : 'adventurer'} ${level}${m.subclass ? ` (${esc(m.subclass)}${level < C.SUBCLASS_LEVEL ? `, from level ${C.SUBCLASS_LEVEL}` : ''})` : ''}${m.alignment ? `, ${esc(m.alignment.toLowerCase())}` : ''}</p>
    <div class="badges"><span class="badge rank rank-${esc(rank)}">${esc(rank)} rank</span><span class="badge">Level ${level}</span>${m.player ? `<span class="badge">Played by ${esc(m.player)}</span>` : ''}</div>
    <div class="sb-rule"></div>
    ${line('Armor Class', `${ac.ac}${worn ? ` (${worn})` : ''}`)}${line('Hit Points', `${Number(m.hp) || 0} of ${Number(m.hpMax) || 0} (hit dice ${hitDiceLeft(p)}/${level} d${hitDieOf(p)})`)}${line('Speed', `${Number(m.speed ?? 30)} ft.`)}${line('Initiative', S.signed(S.initiative(m)))}
    <div class="sb-rule"></div>
    <table class="sb-abil"><tr>${S.ABILITIES.map(a => `<th>${a}</th>`).join('')}</tr>
      <tr>${S.abilities(m).map(x => `<td>${x} (${S.signed(S.modNum(x))})</td>`).join('')}</tr></table>
    <div class="sb-rule"></div>
    ${line('Saving Throws', S.saveProfs(m).map(a => `${cap(a.toLowerCase())} ${S.signed(S.saveBonus(m, a))}`).join(', '))}
    ${line('Skills', S.SKILLS.filter(([s]) => S.skillLevel(m, s)).map(([s]) => `${s} ${S.signed(S.skillBonus(m, s))}`).join(', '))}
    ${line('Senses', `passive Perception ${S.passivePerception(m)}`)}${line('Languages', m.languages)}
    ${line('Attuned', S.attunedItems(m).map(e => e.name).join(', '))}
    ${line('Essences', essences.length ? `${essences.map(e => revoked.includes(e) ? `${e} (revoked)` : e).join(', ')}${m.confluence ? `; ${m.confluence} confluence` : ''}` : '')}
    ${line('Proficiency Bonus', S.signed(S.sheetPb(m)))}
    ${attacks.length ? `<h3>Actions</h3>${S.attacksPerAction(m) > 1 ? `<div class="sb-entry"><b><i>${['', '', 'Extra Attack', 'Two Extra Attacks', 'Three Extra Attacks'][S.attacksPerAction(m)]}.</i></b> ${esc(m.title)} attacks ${['', 'once', 'twice', 'three times', 'four times'][S.attacksPerAction(m)]} when they take the Attack action.</div>` : ''}${attacks.map(({ e, atk }) => { const mt = S.masteryOf(m, e.item || e.name); return `<div class="sb-entry"><b><i>${esc(atk.name)}.</i></b> <button class="roll-btn" data-attack="${esc(JSON.stringify({ ...atk, section: '' }))}" title="Roll to hit and damage">⚄ Roll</button> ${statText(S.attackText(atk, e.weapon))}${mt ? ` <i>Mastery: ${esc(mt.name)}</i> (${esc(mt.text)}).` : ''}${atk.name !== e.name ? `<p class="muted"> With their ${esc(e.name)}.</p>` : ''}</div>`; }).join('')}` : ''}
    ${known.length ? `<h3>Spells</h3><p>Spell save DC ${cast.dc}, ${S.signed(cast.attack)} to hit with spell attacks (${esc(S.ABILITY_NAMES[cast.ability])}).${m.class === 'Warlock' ? ' Pact magic: every spell is cast with their highest slot.' : ''}</p>${slotPips(p)}${known.map(s => spellLine(s.name, cast, level, alwaysOf(s.name) ? `always prepared, ${alwaysOf(s.name)}` : '', { slots: S.slotChoices(m, s.level), who })).join('')}` : ''}
    ${S.gearFx(m).spells.length ? `<h3>Item Spells</h3>${S.gearFx(m).spells.map(x => spellLine(x.spell, cast, level, x.from, { who })).join('')}` : ''}
    ${stones.length ? `<h3>Awakening Stones</h3><p>Each spell once per long rest, without a slot. Spell save DC ${sp.dc}, ${S.signed(sp.attack)} to hit with spell attacks (${esc(S.ABILITY_NAMES[sp.ability])}${Number(m.coreLevels) ? ', with the core user’s −2' : ''}).</p>
      ${stones.map(s => spellLine(s.spell, { ...sp, mod: S.abilityModOf(m, sp.ability) }, level, s.essence, { who })).join('')}` : ''}
    ${classFeatureEntries(m)}
    ${powers.length ? `<h3>Essence Powers</h3>${powers.map(w => `<div class="sb-entry"><b><i>${esc(w.name)}.</i></b> <span class="muted">(${esc(w.from)}${w.uses ? `, ${esc(w.uses)}` : ''})</span> ${esc(w.text)}</div>`).join('')}` : ''}
    ${S.originFeat(m) ? `<div class="sb-rule"></div><div class="sb-entry"><b><i>${esc(S.originFeat(m))}.</i></b> <span class="muted">(origin feat${m.background ? `, ${esc(m.background)}` : ''})</span> ${esc(S.ORIGIN_FEATS[S.originFeat(m)] || '')}</div>` : ''}
  </div>`;
}

/** Search options for the essence slots, labelled with rarity, affinity and trait so players can pick by what an essence does. */
/** Every essence a sheet can pick, with its rarity, affinity and trait as a hint. */
function essenceItems() {
  const d = state.data;
  const hide = hiddenDivine();
  const key = d.compendium && `${state.dm}`;
  if (state.essenceItems?.data === d && state.essenceItems.key === key) return state.essenceItems.list;
  const all = [...(d.divine?.essences || []).filter(e => !hide.includes(e.name)), ...(d.compendium?.essences || [])];
  // Campaigns without the compendium still offer the older basic essences.
  if (!d.compendium) all.push(...(d.essences?.essences || []));
  const items = all.map(e => {
    const i = G.essenceInfo(d, e.name);
    const trait = i.trait?.name || (i.trait?.text || '').replace(/\.$/, '');
    return { value: i.name, label: [i.rarity, i.affinity !== i.name ? i.affinity : '', trait].filter(Boolean).join(' · ') };
  });
  state.essenceItems = { data: d, key, list: items };
  return items;
}

/** The stone spells an essence can awaken, up to a spell level. */
function stoneSpellList(essenceName, capLevel) {
  const spells = G.essenceInfo(state.data, essenceName)?.stoneSpells || {};
  const out = [];
  for (let l = 1; l <= capLevel; l++) for (const spell of spells[l] || []) out.push({ spell, level: l });
  return out;
}

const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;

// ---------- sessions ----------

function sessionPages() {
  return [...state.pages.values()].filter(p => p.meta.type === 'session')
    .sort((a, b) => (Number(b.meta.number) || 0) - (Number(a.meta.number) || 0));
}

function renderSessions() {
  const list = sessionPages();
  $('#view').innerHTML = `<div class="page">
    <div class="row" style="margin-bottom:16px">
      <h1 style="flex:1;margin:0;font:600 32px var(--serif)">Session log</h1>
 ${state.data.calendar && state.saved?.world ? '<button class="btn dm-tool" data-nav="digest" data-sys="world" title="Everything that changed in the world since the last session, for prep">Since last session</button>' : ''}
      ${state.data.incidents ? '<button class="btn" id="prep-teller" data-sys="storyteller" title="Ideas for the next session, with reasons from the world">Prep with the storyteller</button>' : ''}
      <button class="btn primary" id="new-session">+ New session</button>
    </div>
    <p class="hint">Link characters, places and factions with <code>[[Name]]</code> in your notes. Each linked page then shows the session in its History.</p>
    ${list.length ? `<input id="session-search" type="search" placeholder="Search the session notes…" title="Finds sessions whose notes have every word you type" value="${esc(sessionQuery)}" style="width:100%;margin-bottom:12px">
      <div id="session-list"></div>`
      : '<div class="empty">No sessions yet. Start one at the table and take notes as you play.</div>'}
  </div>`;
  $('#new-session').onclick = newSession;
  if ($('#prep-teller')) $('#prep-teller').onclick = () => go({ kind: 'world', focus: 'teller' });
  if (!list.length) return;
  const box = $('#session-search');
  const draw = () => { sessionQuery = box.value; drawSessionList(list, box.value); };
  box.oninput = draw;
  draw();
}

// What's typed in the Sessions search, kept while you open a session and come back.
let sessionQuery = '';

/** The session list, or only the sessions whose notes (and title) hold every typed word, with where they were found. */
function drawSessionList(list, q) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const plain = body => body.replace(WIKILINK, (_, t, l) => l || t).replace(/[#*_>`|]/g, '');
  const rows = [];
  for (const p of list) {
    if (!words.length) { rows.push(`<div class="item-row" data-id="${esc(p.id)}">
        <strong>${esc(p.meta.title)}</strong><span class="muted">${esc(p.meta.date || '')}</span>
        <span class="spacer"></span><span class="muted">${esc(firstLine(shownBody(p)))}</span></div>`); continue; }
    const body = plain(shownBody(p)), low = (p.meta.title + '\n' + body).toLowerCase();
    if (!words.every(w => low.includes(w))) continue;
    const re = new RegExp(words.map(reEsc).join('|'), 'ig'), mark = new RegExp(words.map(w => reEsc(esc(w))).join('|'), 'ig');
    // Up to three short extracts from the notes, one around each of the first few matches.
    const bits = [];
    let last = -1, m;
    while ((m = re.exec(body)) && bits.length < 3) {
      if (m.index < last) continue;
      const s = Math.max(0, m.index - 50), e = Math.min(body.length, m.index + m[0].length + 70);
      bits.push((s ? '…' : '') + esc(body.slice(s, e).replace(/\s+/g, ' ')).replace(mark, x => `<mark>${x}</mark>`) + (e < body.length ? '…' : ''));
      last = e;
    }
    const hits = (body.match(re) || []).length;
    rows.push(`<div class="item-row search-hit" data-id="${esc(p.id)}" style="flex-direction:column;align-items:stretch;gap:2px">
      <div class="row" style="gap:8px"><strong>${esc(p.meta.title)}</strong><span class="muted">${esc(p.meta.date || '')}</span><span class="spacer"></span><span class="badge">${hits} ${hits === 1 ? 'match' : 'matches'}</span></div>
      ${bits.map(b => `<div class="muted" style="font-size:14px">${b}</div>`).join('')}</div>`);
  }
  $('#session-list').innerHTML = rows.length ? `<div class="list">${rows.join('')}</div>`
    : `<div class="empty">No session notes mention ${esc(q.trim())}.</div>`;
  $$('#session-list .item-row').forEach(r => r.onclick = () => openPage(r.dataset.id));
}

function firstLine(body) {
  const line = body.split('\n').find(l => l.trim() && !l.startsWith('#') && l.trim() !== '-') || '';
  return line.replace(WIKILINK, (_, t, l) => l || t).replace(/[*_`#>-]/g, '').trim().slice(0, 90);
}

async function newSession() {
  const next = Math.max(0, ...sessionPages().map(p => Number(p.meta.number) || 0)) + 1;
  const date = new Date().toISOString().slice(0, 10);
  const party = pcs().map(p => `[[${p.meta.title}]]`).join(', ');
  const body = TEMPLATES.session + (party ? `\n## Present\n\n${party}\n` : '');
  await createPage(`Session ${next}`, { type: 'session', number: next, date, ...(state.data.calendar ? { worldDay: today() } : {}) }, body, true);
}

// ---------- the world clock and chronicle ----------
// Kept with the campaign (state.saved.world): today's date, the chronicle of what happened, and each Advance time,
// so a whole advance, or any small event in it, can be undone or rerolled later. Logic is in story.js.

const cal = () => state.data.calendar || { months: [{ name: 'Month', season: '' }], monthDays: 30, holyDays: [], events: [] };
function world() {
  const w = (state.saved.world ||= ST.newWorld(cal()));
  w.chronicle ||= [];
  w.advances ||= [];
  w.settings = { ...ST.DEFAULT_SETTINGS, ...(w.settings || {}) };
  if (!Number.isFinite(w.today)) w.today = ST.startDay(cal());
  if (!Number.isFinite(w.began)) w.began = w.chronicle[0]?.day ?? w.today;
  return w;
}
const today = () => world().today;
const fmtDay = (n, o) => ST.formatDate(cal(), n, o);
const saveWorld = () => { if (state.saved?.world) ST.stampRefs(state.saved.world.chronicle, n => resolve(n)); return attempt(() => api.saved.write(state.saved)); };
const wordMiles = () => state.data.story?.wordMilesPerDay || 30;

function refreshDate() {
  const b = $('#world-date');
  if (!b || !state.data) return;
  const d = ST.dateOf(cal(), today());
  b.textContent = fmtDay(today());
  b.title = `${d.season ? d.season + '. ' : ''}${state.dm ? 'Open the world: calendar, chronicle and Advance time' : 'News and rumours'}`;
  // When tension runs high and no pitches are waiting, the Calendar button says the storyteller has ideas.
  const nav = $('#sidebar [data-nav="world"]');
  if (nav && state.saved?.world) {
    const T = ST.teller(world());
    const high = state.dm && sysOn('storyteller') && state.data.incidents && !T.quiet && !T.pitches?.length && ST.tension(world()) >= 4;
    nav.classList.toggle('nudge', !!high);
    nav.title = high ? 'The storyteller has ideas: tension is high. Open the Calendar and press Pitch me some ideas.' : 'The calendar, the chronicle and Advance time';
  }
}

/** Pinned places for the simulation: { id, title, map, settlement, meta }. */
const storyPlaces = () => [...state.pages.values()].filter(p => p.meta.type === 'location' && mapPoint(p))
  .map(p => ({ id: p.id, title: p.meta.title, map: mapPoint(p), settlement: storySettlement(p), wide: (p.meta.tags || []).some(t => ['kingdom', 'realm', 'region'].includes(t)), meta: p.meta })).filter(p => p.settlement);
/** Places big enough for an Adventure Society board: villages, towns and cities. Hamlets send people to the nearest branch. */
// Judged by the page itself (its settlement or tags), so districts, regions, kingdoms and wonders stay off the list.
const hasBoard = p => p?.meta.type === 'location' && ['village', 'town', 'city', 'capital'].includes(pinKind(p));
const boardPlaces = () => [...state.pages.values()].filter(hasBoard).map(p => p.meta.title).sort((a, b) => a.localeCompare(b));

/** What size of place a page is for the simulation: hamlet to capital. Landmarks and wild sites have none. */
function storySettlement(p) {
  const kinds = Object.keys(state.data.story?.defaults || {});
  return G.settlementFor(state.data, p.meta.title, p.meta) || (kinds.includes(p.meta.settlement) ? p.meta.settlement : null)
    || kinds.find(k => (p.meta.tags || []).includes(k)) || null;
}

/** A page's title and map point, when it's on the map (or inside something that is). */
const spotOf = t => { const p = t && state.pages.get(resolve(t)); const q = p && problemHere(p); return q ? { title: p.meta.title, map: q.map } : null; };
/** Where the party is: the place the DM set (or a point on the map), or where the latest journey reached, or the starting place.
 * A group split off from the party keeps its own place, and its journeys don't move the rest. */
function partyPlace() {
  const w = world();
  const at = spotOf;
  if (w.partyAt) { const p = at(w.partyAt); if (p) return p; }
  if (w.partyPoint?.at) return { title: w.partyPoint.name, map: w.partyPoint.at };
  const j = mainJourneys().at(-1);
  if (j) {
    const end = journeyActive(j) ? j.from : j.to;
    const p = at(end?.name);
    if (p) return p;
    if (end?.at) return { title: end.name || 'on the road', map: end.at };
  }
  const start = [...state.pages.values()].find(x => (x.meta.tags || []).includes('start') && mapPoint(x));
  return start ? { title: start.meta.title, map: mapPoint(start) } : null;
}

async function chronicle(fields) {
  const e = ST.entry({ day: today(), ...fields });
  world().chronicle.push(e);
  await saveWorld();
  return e;
}

const placeNums = title => { const p = state.pages.get(resolve(title)); const s = p && storySettlement(p); return s ? ST.placeState(state.data.story, { settlement: s, meta: p.meta }) : null; };
async function setPlaceNums(title, nums) {
  const p = state.pages.get(resolve(title));
  if (!p) return;
  Object.assign(p.meta, { prosperity: nums.prosperity, safety: nums.safety, population: nums.population });
  await attempt(() => api.pages.write(p.id, p.meta, p.body));
}
/** Add the difference between two sets of numbers to a place's numbers now, so later changes are kept. */
async function shiftPlace(title, from, to) {
  const now = placeNums(title);
  if (!now) return;
  await setPlaceNums(title, {
    prosperity: Math.max(0, Math.min(100, now.prosperity + (to.prosperity - from.prosperity))),
    safety: Math.max(0, Math.min(100, now.safety + (to.safety - from.safety))),
    population: Math.max(0, Math.round(now.population * (from.population ? to.population / from.population : 1))),
  });
}

/** Play the world forward. quiet: a toast instead of opening the summary (journeys use it). */
async function advanceWorld(days, { quiet = false, why = '', rest = false, journey = null, arrive = null } = {}) {
  if (!(days > 0) || !state.data.calendar) return null;
  const w = world();
  // The journey ends before the world moves, so the party is where it's going while the days pass.
  if (journey) { journey.ended = w.today + days; await saveJourney(journey); }
  const party = partyPlace();
  // Systems switched off in Settings don't run, whatever the world's own settings say.
  const own = w.settings;
  w.settings = { ...ST.DEFAULT_SETTINGS, ...own, ...(sysOn('storyteller') ? {} : { minor: false, chains: false }), ...(sysOn('people') ? {} : { people: false }), ...(sysOn('factions') ? {} : { factions: false }) };
  let res;
  try { res = ST.advanceTime({ cal: cal(), data: state.data, world: w, places: storyPlaces(), problems: problems(), party, people: simPeople(), factions: simFactions(), faction: party ? factionNear(party) : null, points: controlPoints() }, days); }
  finally { w.settings = own; }
  w.chronicle.push(...res.entries);
  w.pending = res.pending;
  w.locals = res.locals;
  w.control = res.control;
  w.hardship = res.hardship;
  for (const [title, ch] of Object.entries(res.peopleChanges || {})) Object.assign(ST.person(w, title), ch.after);
  for (const [title, ch] of Object.entries(res.factionChanges || {})) (w.factions ||= {})[title] = ch.after;
  for (const [title, ch] of Object.entries(res.placeChanges)) await setPlaceNums(title, ch.after);
  for (const c of res.problemChanges) { const x = problems().find(p => p.id === c.id); if (x) Object.assign(x, { radius: c.after, baseRadius: c.baseRadius }); }
  // The party's own loose ends: deadlines that pass, and the people and factions they angered acting on it.
  res.advance.grudgesBefore = JSON.parse(JSON.stringify(w.grudges || {}));
  const more = [...await deadlinesPassed(res.advance.from, res.advance.to), ...grudgesActing(res.advance.from, res.advance.to)];
  w.chronicle.push(...more);
  res.entries.push(...more);
  res.advance.entries.push(...more.map(e => e.id));
  w.today = res.advance.to;
  res.advance.why = why;
  if (rest) res.advance.rested = await restParty(days);
  if (journey) res.advance.journeyEnded = { id: journey.id, to: arrive || journey.to?.name || '' };
  w.advances.push(res.advance);
  await saveWorld();
  refreshDate();
  const events = res.entries.filter(e => e.kind !== 'festival').length;
  if (quiet) toast(`${days} day${days === 1 ? '' : 's'} pass in the world${events ? `: ${events} thing${events === 1 ? '' : 's'} happened` : ''}. It's now ${fmtDay(w.today)}.`);
  else go({ kind: 'world', advance: res.advance.id });
  return res.advance;
}

const standing = () => world().advances.filter(a => !a.undone);
/** Undo a whole advance: its events go, the places' numbers move back by what it changed, and the clock goes back. */
async function undoAdvance(id) {
  const w = world();
  const a = w.advances.find(x => x.id === id);
  if (!a || a.undone || standing().at(-1) !== a) return false;
  if (!(await confirmDialog('Undo this advance?', `The clock goes back to ${fmtDay(a.from)}, its events are taken out of the chronicle, and the places' numbers move back by what it changed.`, 'Undo it'))) return false;
  for (const [title, ch] of Object.entries(a.placeChanges || {})) await shiftPlace(title, ch.after, ch.before);
  for (const c of a.problemChanges || []) { const x = problems().find(p => p.id === c.id); if (x) x.radius = c.before; }
  for (const [title, ch] of Object.entries(a.peopleChanges || {})) Object.assign(ST.person(w, title), ch.before);
  for (const [title, ch] of Object.entries(a.factionChanges || {})) { w.factions ||= {}; if (ch.before) w.factions[title] = ch.before; else delete w.factions[title]; }
  const gone = new Set(a.entries);
  const goneEntries = w.chronicle.filter(e => gone.has(e.id));
  w.chronicle = w.chronicle.filter(e => !gone.has(e.id));
  if (a.pendingBefore) w.pending = a.pendingBefore;
  if (a.localsBefore) w.locals = a.localsBefore;
  if (a.controlBefore) w.control = a.controlBefore;
  if (a.hardshipBefore) w.hardship = a.hardshipBefore;
  if (a.grudgesBefore) w.grudges = a.grudgesBefore;
  for (const e of goneEntries) {
    undoLooseEnd(e);
    const now = e.expiredOf && e.effects && e.places[0] && placeNums(e.places[0]);
    if (now) await setPlaceNums(e.places[0], ST.applyEffects(now, e.effects, -1));
  }
  for (const b of a.rested || []) {
    const p = state.pages.get(b.id);
    if (p) { p.meta = { ...p.meta, hp: b.hp, hitDiceUsed: b.hitDiceUsed, slotsUsed: b.slotsUsed }; await attempt(() => api.pages.write(p.id, p.meta, p.body)); }
  }
  const j = a.journeyEnded && journeys().find(x => x.id === a.journeyEnded.id);
  if (j) { delete j.ended; await saveJourney(j); }
  w.today = w.today - (a.to - a.from);
  a.undone = true;
  await saveWorld();
  refreshDate();
  toast(`Undone. It's ${fmtDay(w.today)} again.`);
  return true;
}

const advanceOf = e => world().advances.find(a => a.entries.includes(e.id));

// ---------- loose ends: deadlines and grudges ----------

/** Contracts whose deadline falls in (from, to] and that nobody has finished: missed, taken by others, or worse. */
async function deadlinesPassed(from, to) {
  const w = world();
  const out = [];
  const passes = d => Number.isFinite(d) && d > from && d <= to;
  for (const e of w.chronicle.filter(x => x.kind === 'event' && !x.outcome && !x.expired && (x.taken !== false ? passes(x.due) : passes(x.acceptBy)))) {
    const place = e.places[0];
    const day = e.taken !== false ? e.due : e.acceptBy;
    e.expired = day;
    let x;
    if (e.taken !== false) {
      x = ST.entry({ day: e.due, kind: 'party', title: `Missed the deadline: ${e.title}`, text: `The deadline for ${e.title}${place ? ` in ${place}` : ''} passed, and the Adventure Society has marked it against the party.`, places: e.places, tags: ['party', 'deadline'], at: e.at, isPublic: true });
      x.rep = place ? applyRep([{ kind: 'place', title: place, delta: state.data.story?.reputation?.missedDeadline ?? -3 }], `Missed the deadline: ${e.title}`) : [];
    } else if (Math.random() < 0.55) {
      e.outcome = 'ignored'; e.expiredOutcome = true;
      x = ST.entry({ day, kind: 'note', title: `Another team took ${e.title}`, text: `Another team took the contract ${e.title}${place ? ` in ${place}` : ''} before the party did, and claimed the reward.`, places: e.places, tags: ['deadline', 'rivals'], at: e.at, isPublic: true });
    } else {
      e.outcome = 'ignored'; e.expiredOutcome = true;
      x = ST.entry({ day, kind: 'note', title: `${e.title}: it got worse`, text: `No one took the contract ${e.title} in time, and things${place ? ` in ${place}` : ''} have got worse.`, places: e.places, tags: ['deadline', 'worse'], at: e.at, isPublic: true });
      const now = place && placeNums(place);
      if (now) { x.effects = { safety: -2 }; await setPlaceNums(place, ST.applyEffects(now, x.effects)); }
    }
    x.expiredOf = e.id;
    out.push(x);
  }
  return out;
}

/** How far a contract sends the party from its board, and how long the trip there and back takes each way of travel. */
function contractTrip(e) {
  const to = e.dest && state.pages.get(resolve(e.dest));
  const from = e.places[0] && state.pages.get(resolve(e.places[0]));
  const a = to && placeAbove(to), b = from && placeAbove(from);
  if (!a || !b) return null;
  // Roads wind: a quarter again on the straight line.
  // The same road distance the Travel generator uses.
  const miles = Math.round(G.travelDistance(a.map, b.map) * G.ROUTE_WINDING);
  if (miles < 2) return null;
  const ranks = pcs().map(x => G.pcRank(x.meta)).filter(Boolean);
  const slowest = ranks.length ? G.RANKS.find(r => ranks.includes(r)) : 'Normal';
  const modes = (state.data.travel?.modes || [{ name: 'On foot', miles: 24, rank: true }, { name: 'Mounted', miles: 30 }]).map(m => {
    const pace = (Number(m.miles) || 24) * (m.rank ? G.rankSpeed(state.data, slowest) : 1);
    return { name: m.name, pace, days: Math.max(1, Math.ceil(2 * miles / pace)), foot: !!m.rank };
  });
  const walk = (modes.find(m => m.foot) || modes[0]).days;
  return { miles, to: a.title, walk, modes, rank: slowest };
}
/** "Walking there and back takes about 6 days", or what they'd need to make it in time. */
function tripNote(t, days) {
  const base = `${t.to} is about ${t.miles} miles away by road.`;
  if (days === null || t.walk <= days) return `${base} Walking there and back takes about ${t.walk} day${t.walk === 1 ? '' : 's'}${t.rank !== 'Normal' ? ` at ${t.rank} rank` : ''}.`;
  const fits = t.modes.filter(m => !m.foot && m.days <= days).sort((x, y) => x.pace - y.pace)[0];
  return fits ? `${base} They won't make it there and back on foot (about ${t.walk} days). ${fits.name}, they would (about ${fits.days} days).`
    : `${base} They can't make it there and back in ${days} days by any way of travel (on foot about ${t.walk} days).`;
}
/** The party takes a contract: the time to finish it (four times what was left to accept it) starts now. */
async function acceptContract(title) {
  const e = world().chronicle.find(y => y.kind === 'event' && y.quest === title);
  if (!e || e.taken !== false) return false;
  const days = Number.isFinite(e.finishDays) ? e.finishDays : Number.isFinite(e.window) ? e.window * 4 : null;
  const trip = contractTrip(e);
  const note = trip ? tripNote(trip, days) : '';
  if (!(await confirmDialog(`Accept ${title}?`, `${days ? `They'll have ${days} days to finish it, until ${fmtDay(today() + days)}.` : 'There is no deadline to finish it.'}${note ? ` ${note}` : ''}`, 'Accept it'))) return false;
  e.taken = true;
  e.accepted = today();
  if (days) e.due = today() + days;
  e.text = `The party took the contract ${title}${e.places[0] ? ` in ${e.places[0]}` : ''}.`;
  await saveWorld();
  toast(days ? `Accepted. Due ${fmtDay(e.due)}.` : 'Accepted.');
  await offerRedLinks(title, e);
  return true;
}

/** After a contract is taken: offer to generate each red link on its page, ticked off one by one. */
async function offerRedLinks(title, e) {
  const page = state.pages.get(resolve(title));
  const red = page ? redLinksOf(page.body) : [];
  if (!red.length) return;
  const rows = red.map((t, i) => `<div class="row" style="align-items:center;gap:10px;margin:4px 0">
    <label class="inline-check" style="flex:1;display:flex;gap:6px"><input type="checkbox" name="on:${i}" checked> <span>${esc(t)}</span></label>
    <select name="kind:${i}" aria-label="Generator for ${esc(t)}">${genKindOptions(guessKind(t))}</select></div>`).join('');
  const r = await formDialog('Generate what the contract names?', `
    <p class="muted" style="margin:0 0 10px">These have no page yet. Tick the ones to make, and pick a generator for each. New places go on the map near ${esc(e.places[0] || 'the board')}.</p>${rows}`, 'Generate');
  if (!r) return;
  const k = state.data.places?.tierRange?.[page.meta.rank] ?? 1;
  const made = [];
  for (const [i, t] of red.entries()) {
    if (!r[`on:${i}`]) continue;
    const kind = r[`kind:${i}`];
    if (await generateNamed(t, kind, { where: e.places[0] || '', from: title, miles: [3, 25].map(m => Math.round(m * k)) })) made.push({ t, kind });
  }
  // A place the contract sends them to becomes its destination, for the trip and Advance time.
  const places = made.filter(x => x.kind === 'place').map(x => x.t);
  if (!e.dest && places.length) e.dest = places.includes(e.placeName) ? e.placeName : places.length === 1 ? places[0] : e.dest;
  await saveWorld();
  if (made.length) toast(`Made ${made.length} page${made.length === 1 ? '' : 's'}: ${made.map(x => x.t).join(', ')}.`);
}

/** The people and factions who think badly of the party act on it, once a month at most, from Advance time. */
function grudgeHolders() {
  const w = world();
  const near = ['friend', 'spouse', 'sibling', 'parent', 'child', 'lover'];
  const people = npcPages().filter(p => sysOn('people') && !isLocked(p)).map(p => {
    const h = npcHome(p);
    const value = ST.opinionOf(w, p.meta.title, { base: opinionBase(p) });
    return { title: p.meta.title, kind: 'person', value, place: h?.title || null, map: h?.map || null, friends: (w.people?.[p.meta.title]?.ties || []).filter(t => near.includes(t.kind) && resolve(t.to)).map(t => t.to) };
  });
  const facs = simFactions().filter(f => sysOn('factions') && !f.locked).map(f => ({ title: f.title, kind: 'faction', value: ST.standingOf(w, 'faction', f.title).value, place: f.place, map: f.map }));
  return [...people, ...facs];
}
function grudgesActing(from, to) {
  if (!state.data.people?.grudges && !state.data.factions?.grudges) return [];
  const w = world();
  const last = (w.grudges ||= {});
  const out = [];
  for (let d = from + 1; d <= to; d++) {
    const x = ST.dateOf(cal(), d);
    if (x.holy || x.day !== (cal().monthDays || 30)) continue;
    for (const e of ST.grudgeActs(state.data, grudgeHolders(), d, last)) {
      const why = e.title;
      e.rep = applyRep(e.plan || [], why);
      e.mem = (e.friendsPlan || []).map(f => ({ title: f.title, pc: null, delta: ST.remember(w, f.title, f.delta, why, null, d) })).filter(m => m.delta);
      delete e.plan; delete e.friendsPlan;
      out.push(e);
    }
  }
  return out;
}
/** Taking out an entry a deadline or grudge made: put back what it changed. */
function undoLooseEnd(e) {
  undoRep(e.rep);
  undoMem(e.mem);
  const parent = e.expiredOf && world().chronicle.find(x => x.id === e.expiredOf);
  if (parent) { delete parent.expired; if (parent.expiredOutcome) { delete parent.outcome; delete parent.expiredOutcome; } }
}
/** Take a small event back out, with its effects on the place. */
async function undoMinor(id) {
  const w = world();
  const e = w.chronicle.find(x => x.id === id);
  if (!e) return;
  const t = e.places[0];
  const now = t && placeNums(t);
  if (now && e.effects) {
    const back = ST.applyEffects(now, e.effects, -1);
    await setPlaceNums(t, back);
    const a = advanceOf(e);
    const ch = a?.placeChanges?.[t];
    if (ch) ch.after = ST.applyEffects(ch.after, e.effects, -1);
  }
  undoLooseEnd(e);
  ST.undoPersonFx(w, PEOPLE(), e.fx);
  ST.undoFactionFx(w, e.fx);
  // An accepted goal pitch: the goal is ready to pitch again.
  if (e.goalOf) { const g = w.people?.[e.goalOf]?.goal; if (g) delete g.done; }
  // Undoing how a quest ended lets it be recorded again; undoing the quest takes its ending with it.
  const parent = e.outcomeOf && w.chronicle.find(x => x.id === e.outcomeOf);
  if (parent) delete parent.outcome;
  const ends = w.chronicle.filter(x => x.outcomeOf === e.id);
  ends.forEach(x => { undoRep(x.rep); undoMem(x.mem); });
  w.chronicle = w.chronicle.filter(x => x !== e && !ends.includes(x));
  // What it would have led to goes with it.
  if (w.pending) w.pending = w.pending.filter(q => q.cause !== e.id);
  await saveWorld();
  toast(`"${e.title}" is taken out of the world.`);
}
/** Swap a small event for a different one at the same place and day. */
async function rerollMinor(id) {
  const w = world();
  const i = w.chronicle.findIndex(x => x.id === id);
  const e = w.chronicle[i];
  if (!e) return;
  const place = storyPlaces().find(p => p.title === e.places[0]);
  if (!place) return toast(`${e.places[0] || 'That place'} is no longer on the map, so there is nothing to reroll from.`, true);
  let st = placeNums(place.title);
  if (e.effects) st = ST.applyEffects(st, e.effects, -1);
  const troubles = PL.problemsAt(problems(), place.map);
  const next = ST.minorEvent(state.data, place, e.day, cal(), Math.random, { troubles, avoid: [e.source], stateNow: st, locals: ST.aliveLocals(w.locals, place.title), strangers: ST.allLocals(w.locals) });
  if (!next) return toast('No other small event fits that place.', true);
  next.far = e.far;
  const after = ST.applyEffects(st, next.effects);
  await setPlaceNums(place.title, after);
  const a = advanceOf(e);
  if (a) {
    a.entries = a.entries.map(x => x === e.id ? next.id : x);
    const ch = a.placeChanges?.[place.title];
    if (ch) ch.after = ST.applyEffects(ST.applyEffects(ch.after, e.effects || {}, -1), next.effects);
    else a.placeChanges[place.title] = { before: ST.applyEffects(st, {}), after };
  }
  w.chronicle[i] = next;
  w.pending = [...(w.pending || []).filter(q => q.cause !== e.id), ...(w.settings?.chains !== false ? ST.chainsFrom(state.data.story, next) : [])];
  await saveWorld();
}
/** Put one place's numbers back to what they were before an advance changed them. */
async function undoDrift(advId, title) {
  const a = world().advances.find(x => x.id === advId);
  const ch = a?.placeChanges?.[title];
  if (!ch) return;
  await shiftPlace(title, ch.after, ch.before);
  ch.after = { ...ch.before };
  ch.undone = true;
  await saveWorld();
}

async function advanceDialog() {
  const w = world();
  const here = partyPlace();
  const road = mainJourneys().filter(journeyActive).at(-1) || null;
  const r = await formDialog('Advance time', `
    <p class="muted" style="margin:0 0 10px">It's ${esc(fmtDay(w.today))}. As the days pass, places' prosperity and safety drift, festivals come round, and small events happen near the party. You can undo or reroll any of them afterwards. Big events only come from storyteller pitches you accept.</p>
    <div class="row"><label class="field" style="width:110px">How long<input name="n" type="number" min="1" max="3650" value="10"></label>
    <label class="field" style="width:140px">&nbsp;<select name="unit"><option value="days">days</option><option value="tendays">tendays</option><option value="months">months</option></select></label>
    <label class="field" style="flex:1" title="Or type a date to go to, like 12 Ches or Hearthnight 2">Or until<input name="until" placeholder="12 Ches, year ${ST.dateOf(cal(), w.today).year}"></label></div>
    <label class="field">The party is at<input name="at" value="${esc(here?.title || '')}" placeholder="A place on the map"></label>
    ${partyChecks(road)}`, 'Advance', form => attachPicker($('input[name=at]', form), () => storyPlaces().map(p => ({ value: p.title, label: cap(p.settlement) }))));
  if (!r) return;
  // Mid-journey: the party gets there in the time (and the journey ends), or stays on the road where it is.
  const arrive = road && r.journey === 'arrive' ? state.pages.get(resolve(road.to?.name))?.meta.title || null : null;
  const travel = road && r.journey === 'travel';
  if (arrive && (!r.at.trim() || r.at.trim() === here?.title)) r.at = arrive;
  if (r.at.trim() && r.at.trim() !== here?.title) {
    if (!resolve(r.at.trim())) return toast(`There's no page called ${r.at.trim()}.`, true);
    w.partyAt = state.pages.get(resolve(r.at.trim())).meta.title;
    w.partyPoint = null;
  }
  let days = ST.spanDays(r.n, r.unit, cal(), w.today);
  if (r.until.trim()) {
    const to = ST.parseDate(cal(), r.until, ST.dateOf(cal(), w.today).year);
    if (to === null) return toast(`"${r.until}" isn't a date I can read. Try "12 Ches" or "Hearthnight 2".`, true);
    if (to <= w.today) return toast('That date has already passed.', true);
    days = to - w.today;
  }
  if (days > 3650) return toast('Ten years at most at once.', true);
  // The party's accepted contracts that this would run past: they'd be marked missed, so say so first.
  const missed = w.chronicle.filter(e => e.kind === 'event' && !e.outcome && !e.expired && e.taken !== false && Number.isFinite(e.due) && e.due > w.today && e.due <= w.today + days);
  if (missed.length && !(await confirmDialog('Deadlines will pass', `This runs past the deadline for ${missed.map(e => `${e.title} (${fmtDay(e.due)})`).join(', ')}. ${missed.length > 1 ? 'They' : 'It'} will count as missed, and the party's standing${missed.some(e => e.places?.[0]) ? ` in ${[...new Set(missed.map(e => e.places?.[0]).filter(Boolean))].join(', ')}` : ''} will drop. Mark ${missed.length > 1 ? 'them' : 'it'} done or failed on the contract page first, or advance anyway.`, 'Advance anyway'))) return;
  await advanceWorld(days, { why: 'Advance time', rest: r.rest === 'on', journey: road && r.journey === 'arrive' ? road : null, arrive });
  if (travel) await travelDuring(road, days);
  else if (sysOn('travel')) await learnHereCircle(false);
}
/** The days that passed are rolled on the road: the journey moves on by that many days, or stops when they arrive. */
async function travelDuring(road, days) {
  const next = rollDays(road, days);
  await saveJourney(next);
  await journeyTime(road, next, 0);
  const got = next.days.at(-1)?.arrived;
  if (got) await learnCircle(next.to);
  await autoLogJourney();
  toast(got ? `The party reached ${next.to?.name || 'the end of the road'} after ${next.days.length - road.days.length} days on the road.` : `${next.days.length - road.days.length} more days on the road to ${next.to?.name || 'somewhere'}. ${Math.round(G.journeyLeft(next)).toLocaleString()} miles to go.`);
  if (state.view?.kind === 'world') render();
}

const listJoin = xs => xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`;
/** "Tension 3.2 of 5, reaching for big drama", or, with Nothing big this week on, that it's being held back. */
function tensionText(w, t) {
  const aim = esc(DRAMA[ST.targetDrama(w, () => 0.5)].toLowerCase());
  return ST.teller(w).quiet ? `Tension ${t.toFixed(1)} of 5, held to ${aim} drama while Nothing big this week is on` : `Tension ${t.toFixed(1)} of 5, reaching for ${aim} drama`;
}
/** Advance time's questions about the party: the journey still under way, and whether they rest as the days pass. */
/** How far a journey still has to go, and about how many days that takes at the travel settings' pace. Null without a destination. */
function roadDaysLeft(j) {
  const miles = Math.round(G.journeyLeft(j) || 0);
  if (!j.miles || miles <= 0) return null;
  const perDay = journeyPace(j);
  return { miles, days: Math.max(1, Math.ceil(miles / Math.max(1, perDay))) };
}
function partyChecks(road) {
  const hurt = pcs().filter(p => (Number(p.meta.hp) || 0) < (Number(p.meta.hpMax) || 0) || Object.values(p.meta.slotsUsed || {}).some(n => Number(n) > 0) || Number(p.meta.hitDiceUsed) > 0);
  const need = road && roadDaysLeft(road);
  const left = need ? ` (${need.miles.toLocaleString()} miles left, about ${need.days.toLocaleString()} day${need.days === 1 ? '' : 's'})` : '';
  const journey = road ? `<label class="field" title="The party left ${esc(road.from?.name || 'somewhere')} and hasn't arrived yet">On the road to ${esc(road.to?.name || 'somewhere')} (day ${road.days.length})${esc(left)}
      <select name="journey" data-need="${need?.days ?? ''}"><option value="travel">They travel on: each day on the road is rolled, and they arrive if the days cover the distance</option><option value="arrive">They get there anyway: the party is at ${esc(road.to?.name || 'the end')} and the journey ends</option><option value="stay">The journey waits: leave it as it is</option></select></label>` : '';
  const rest = hurt.length ? `<label class="inline-check" style="margin-top:8px"><input type="checkbox" name="rest" checked> The party rests as the days pass: full HP, spell slots and hit dice back
      <span class="muted">(${hurt.map(p => `${esc(p.meta.title)} ${Number(p.meta.hp) || 0}/${Number(p.meta.hpMax) || 0}`).join(', ')})</span></label>` : '';
  return journey || rest ? `<p class="settings-group" style="margin:12px 0 4px">The party</p>${journey}${rest}` : '';
}
/** Days of rest: full HP and spell slots, and half the hit dice (at least one) back for each long rest. Returns who it helped, and how they were, for an undo. */
async function restParty(days) {
  const before = [];
  let inBattle = false;
  for (const p of pcs()) {
    const m = p.meta, level = Number(m.level) || 1;
    const hd = Math.max(0, (Number(m.hitDiceUsed) || 0) - days * Math.max(1, Math.floor(level / 2)));
    const used = Object.values(m.slotsUsed || {}).some(n => Number(n) > 0);
    if ((Number(m.hp) || 0) >= (Number(m.hpMax) || 0) && !used && hd === (Number(m.hitDiceUsed) || 0)) continue;
    before.push({ id: p.id, title: m.title, hp: m.hp, hitDiceUsed: m.hitDiceUsed, slotsUsed: m.slotsUsed });
    p.meta = { ...m, hp: Number(m.hpMax) || 0, hitDiceUsed: hd, slotsUsed: {} };
    await attempt(() => api.pages.write(p.id, p.meta, p.body));
    inBattle = restInBattle(p, true) || inBattle;
  }
  if (inBattle) saveBattle();
  return before;
}

async function setDateDialog() {
  const r = await formDialog('Set the date', `
    <p class="muted" style="margin:0 0 10px">Moves the clock without anything happening in between. To play the days out, use Advance time.</p>
    <label class="field">Today is<input name="date" value="${esc(fmtDay(today()))}" placeholder="1 Ches, year 1"></label>`, 'Set');
  if (!r) return;
  const n = ST.parseDate(cal(), r.date, ST.dateOf(cal(), today()).year);
  if (n === null) return toast(`"${r.date}" isn't a date I can read. Try "12 Ches, year 3" or "Hearthnight 2".`, true);
  world().today = n;
  await saveWorld();
  refreshDate();
  render();
}

async function worldSettingsDialog() {
  const s = world().settings;
  const box = (k, label, hint) => `<label class="check" title="${esc(hint)}"><input type="checkbox" name="${k}" ${(s[k] ?? ST.DEFAULT_SETTINGS[k]) ? 'checked' : ''}> ${esc(label)}</label>`;
  const r = await formDialog('How the world moves', `
    ${box('journeysMove', 'Journeys move the clock', 'Each day rolled on a journey advances the world a day')}
    ${box('drift', 'Places drift: prosperity, safety and population', 'Troubles wear places down; quiet times let them recover')}
    ${sysOn('storyteller') ? box('minor', 'Small events happen by themselves near the party', 'Deaths, feuds, shortages, caravans. Each can be rerolled or undone.') : ''}
    ${sysOn('storyteller') ? box('chains', 'Events lead to events', 'A feud may turn bloody, a shortage may end in a riot: a small event can bring a follow-up some days later, with the same people. Each can be undone.') : ''}
    ${box('grow', 'Troubles left alone spread', 'After twenty days, an unsolved trouble reaches a little further each tenday, up to twice as far')}
    ${sysOn('people') ? box('people', 'Major NPCs near the party live their lives', 'Once a month they work toward their goals and make friends, rivals and lovers. Each can be undone.') : ''}
    ${sysOn('factions') ? box('factions', 'Factions near the party pursue their goals', 'Once a month a few of them take a step, gain influence, or find a new ally or rival. Each can be undone.') : ''}`, 'Save');
  if (!r) return;
  // A box put away with its system keeps its old value.
  for (const k of Object.keys(ST.DEFAULT_SETTINGS)) if ($(`#dialog input[name="${k}"]`)) s[k] = !!r[k];
  await saveWorld();
  render();
}

async function addEntryDialog(e = null) {
  const r = await formDialog(e ? 'Change the entry' : 'Add to the chronicle', `
    <div class="row"><label class="field" style="flex:1">What happened<input name="title" required value="${esc(e?.title || '')}" placeholder="The bridge at Mosswater fell"></label>
    <label class="field" style="width:200px">When<input name="date" value="${esc(fmtDay(e?.day ?? today()))}"></label></div>
    <label class="field">What people know<textarea name="text" rows="3" placeholder="Shown in News and rumours when public">${esc(e?.text || '')}</textarea></label>
    <label class="field">DM notes<textarea name="dm" rows="2">${esc(e?.dm || '')}</textarea></label>
    <div class="row"><label class="field" style="flex:1">Where<input name="place" value="${esc(e?.places?.[0] || '')}" placeholder="A place page"></label>
    <label class="field" style="flex:1">Who (comma separated)<input name="people" value="${esc((e?.people || []).join(', '))}"></label></div>
    ${state.data.factions?.econ ? `<div class="row" title="A burnt granary, a new mine: the place is short of something, or has plenty of it, for a while. It moves prices there."><label class="field" style="width:160px">Market<select name="econ"><option value="">No change</option><option value="short" ${e?.econ?.kind === 'short' ? 'selected' : ''}>Short of</option><option value="plenty" ${e?.econ?.kind === 'plenty' ? 'selected' : ''}>Plenty of</option></select></label>
      <label class="field" style="flex:1">Goods<input name="good" value="${esc(e?.econ?.good || '')}" placeholder="grain, iron, lamp oil"></label>
      <label class="field" style="width:110px">For days<input name="days" type="number" min="1" value="${e?.econ ? e.econ.until - e.day : 30}"></label></div>` : ''}
    <label class="check"><input type="checkbox" name="public" ${!e || e.public ? 'checked' : ''}> Public: word spreads, and players can hear of it</label>`, e ? 'Save' : 'Add', form => {
    attachPicker($('input[name=place]', form), () => storyPlaces().map(p => ({ value: p.title, label: cap(p.settlement) })));
    if ($('input[name=good]', form)) attachPicker($('input[name=good]', form), () => (state.data.story?.goods || []).map(g => ({ value: g })));
  });
  if (!r) return;
  const day = ST.parseDate(cal(), r.date, ST.dateOf(cal(), today()).year);
  if (day === null) return toast(`"${r.date}" isn't a date I can read.`, true);
  const place = r.place.trim() && state.pages.get(resolve(r.place.trim()));
  const fields = { day, title: r.title.trim(), text: r.text.trim(), dm: r.dm.trim(), places: place ? [place.meta.title] : r.place.trim() ? [r.place.trim()] : [], people: r.people.split(',').map(s => s.trim()).filter(Boolean), at: place && problemHere(place)?.map || null };
  const econ = r.econ && r.good?.trim() && fields.places.length ? { kind: r.econ, good: r.good.trim().toLowerCase(), until: day + Math.max(1, Number(r.days) || 30) } : null;
  if (e) { Object.assign(e, fields, { public: !!r.public }); if (econ) e.econ = econ; else if ('econ' in r) delete e.econ; }
  else world().chronicle.push(Object.assign(ST.entry({ ...fields, kind: 'note', isPublic: !!r.public }), econ ? { econ } : {}));
  await saveWorld();
  render();
}

const KIND_LABEL = { festival: 'Festival', minor: 'Event', drift: 'Change', trouble: 'Trouble', party: 'Party', session: 'Session', note: 'Note', event: 'Event', person: 'People', faction: 'Faction', history: 'History', grudge: 'Grudge' };
function entryRow(e, { actions = true } = {}) {
  const dm = state.dm;
  const minorish = e.kind === 'minor';
  const where = e.places.length ? ` · ${e.places.slice(0, 3).map(t => resolve(t) ? `<a class="wikilink" data-id="${esc(resolve(t))}">${esc(t)}</a>` : esc(t)).join(', ')}` : '';
  return `<li class="ch-entry k-${esc(e.kind)}${e.hidden ? ' is-hidden' : ''}" data-entry="${esc(e.id)}">
    <div class="ch-head"><span class="ch-date">${esc(fmtDay(e.day, { short: ST.dateOf(cal(), e.day).year === ST.dateOf(cal(), today()).year }))}</span>
      <b>${esc(e.title)}</b><span class="muted">${where}</span>
      <span class="badge">${esc(KIND_LABEL[e.kind] || e.kind)}</span>
      ${dm && !e.public ? '<span class="badge dm">DM only</span>' : ''}${dm && e.hidden ? '<span class="badge dm">Hidden from news</span>' : ''}${dm && e.far ? '<span class="badge">Far away</span>' : ''}
      ${dm && actions ? `<span class="spacer"></span><span class="ch-actions">
        ${minorish ? `<button class="btn small" data-reroll-entry title="Swap it for a different small event at the same place and day">↻ Reroll</button><button class="btn small" data-undo-entry title="Take it out, and its effect on the place">Undo</button>` : ''}
        ${e.kind === 'event' && !e.outcome && state.data.story ? `<button class="btn small primary" data-outcome-entry title="Record how it ended: it moves the party's standing and renown">How did it end?</button>` : ''}
        ${e.kind === 'event' ? `<button class="btn small" data-undo-entry title="Take it out of the chronicle, and its effect on the place. Pages it made stay, to delete by hand.">Undo</button>` : ''}
        ${e.kind !== 'event' && !minorish && (e.rep?.length || e.mem?.length || e.expiredOf) ? `<button class="btn small" data-undo-entry title="Take it out, and put the party's standing back">Undo</button>` : ''}
        ${['person', 'faction'].includes(e.kind) && e.fx ? `<button class="btn small" data-undo-entry title="Take it out, and put the person back as they were">Undo</button>` : ''}
        ${e.public ? `<button class="btn small" data-hide-entry title="${e.hidden ? 'Let players hear of it again' : 'Keep it out of News and rumours'}">${e.hidden ? 'Show in news' : 'Hide from news'}</button>` : ''}
        ${!minorish ? `<button class="btn small" data-edit-entry>Edit</button>${e.fx || e.rep?.length || e.mem?.length ? '' : '<button class="btn small danger" data-delete-entry>Delete</button>'}` : ''}
      </span>` : ''}</div>
    ${e.text ? `<div class="ch-text">${entryMarkdown(e, e.text)}</div>` : ''}
    ${dm && e.dm ? `<div class="ch-dm">${entryMarkdown(e, e.dm)}</div>` : ''}
    ${dm && e.effects && Object.keys(e.effects).length ? `<div class="muted ch-fx">${esc(effectText(e.effects))}</div>` : ''}
    ${dm && e.rep?.length ? `<div class="muted ch-fx">Standing: ${esc(e.rep.map(c => `${c.title} ${signed(c.delta)}`).join(', '))}</div>` : ''}
    ${causeLine(e)}${dm ? brewingLine(e) : ''}
    ${e.econ ? `<div class="muted ch-fx">${e.econ.kind === 'short' ? 'Short of' : 'Plenty of'} ${esc(e.econ.good)} until ${esc(fmtDay(e.econ.until, { short: true }))}</div>` : ''}
  </li>`;
}
/** Strangers the chronicle keeps naming, each with a button that makes them an NPC (their events come with them). */
function facesHtml(faces, heading) {
  if (!state.dm || !faces.length) return '';
  return `<div class="faces dm-tool"><h3>${esc(heading)}</h3><ul>${faces.sort((x, y) => y.seen - x.seen).map(f => `<li><b>${esc(f.name)}</b> <span class="muted">of ${esc(f.place)}, in ${f.seen} events, last ${esc(fmtDay(f.last, { short: true }))}</span>
    <button class="btn small make-face" data-face="${esc(f.name)}" data-face-place="${esc(f.place)}" title="Make them an NPC page, with every event they were in">Make NPC</button></li>`).join('')}</ul></div>`;
}
/** On a place's page (DM): the strangers its events keep naming, and how many others they've named once. */
function facesSection(p) {
  if (!state.dm || p.meta.type !== 'location' || !state.saved?.world?.locals) return '';
  const fs = (world().locals[p.meta.title] || []).filter(f => !f.dead && !f.made);
  const again = fs.filter(f => f.seen >= 2).map(f => ({ ...f, place: p.meta.title }));
  const once = fs.filter(f => f.seen < 2);
  if (!again.length && !once.length) return '';
  return `<section class="faces-box dm-tool">${facesHtml(again, 'Familiar faces') || '<h3>Familiar faces</h3><p class="muted">No one has turned up twice yet.</p>'}
    ${once.length ? `<details><summary class="muted">${once.length} other${once.length === 1 ? '' : 's'} named once</summary><p class="muted">${once.map(f => esc(f.name)).join(', ')}</p></details>` : ''}</section>`;
}

/** "After: A local feud (3 Ches)", on an event another led to. */
function causeLine(e) {
  const c = e.causes?.length && world().chronicle.find(x => x.id === e.causes[0]);
  return c ? `<div class="muted ch-fx ch-cause">Followed from <b>${esc(c.title)}</b> (${esc(fmtDay(c.day, { short: true }))})</div>` : '';
}
/** What an event may still lead to, for the DM: due later, and undone with it. */
function brewingLine(e) {
  const q = (world().pending || []).filter(x => x.cause === e.id);
  return q.length ? `<div class="muted ch-fx ch-brewing" title="It may happen when time passes. Undo or reroll this event and it won't.">May lead to: ${q.map(x => `${esc(x.name || x.card)} (around ${esc(fmtDay(x.due, { short: true }))})`).join(', ')}</div>` : '';
}

// People an entry names link to their pages; one with no page yet shows in red, and a click makes them an NPC.
const reEsc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function nameLinks(md, names, attrs = '') {
  let out = String(md || '');
  const strangers = [];
  for (const x of names.map(n => typeof n === 'string' ? { name: n, local: false } : n)) {
    const name = x.name;
    if (!name || out.includes(`[[${name}`)) continue;
    const rx = new RegExp(`(^|[^\\w\\[])${reEsc(name)}(?![\\w\\]])`);
    // A stranger the engine made up is never matched to a page by name: they only have one once the DM makes it.
    if (x.local) { if (rx.test(out)) { out = out.replace(rx, `$1NPCSTRANGER${strangers.length}X`); strangers.push(name); } }
    else out = out.replace(rx, `$1[[${name}]]`);
  }
  let html = inlineMarkdown(out);
  const red = (name, local) => `<a class="wikilink missing new-npc" data-target="${esc(name)}"${local ? ' data-local="1"' : ''}${attrs} title="No page yet: click to make ${esc(name)} an NPC">`;
  for (const x of names) { const name = typeof x === 'string' ? x : x.name; html = html.replace(`<a class="wikilink missing" data-target="${esc(name)}">`, red(name)); }
  strangers.forEach((name, i) => { html = html.replace(`NPCSTRANGER${i}X`, `${red(name, true)}${esc(name)}</a>`); });
  return html;
}
const entryMarkdown = (e, md) => nameLinks(md, ST.entryPeople(state.data, e), ` data-npc-entry="${esc(e.id)}"`);

/**
 * Make an NPC page for someone the chronicle (or a tie, a goal, or a town's familiar faces) names: their name, home,
 * and what's known. A stranger's every event in their town becomes theirs, with the ties those events imply.
 */
async function npcFromName(name, { entryId = null, of = null, local = false, place = null } = {}) {
  if (!local && resolve(name)) return followLink(name);
  const w = world();
  const e = entryId ? w.chronicle.find(x => x.id === entryId) : null;
  const ofPage = of ? state.pages.get(resolve(of)) : null;
  const town = e?.places?.[0] || place || null;
  const where = town || (ofPage && npcHome(ofPage)?.title) || '';
  // Their events: this one, and (for a stranger) every other in the same town that names them.
  const theirs = [...new Set([...(e ? [e] : []), ...(local && town ? w.chronicle.filter(x => x.places?.[0] === town && ST.entryPeople(state.data, x).some(y => y.local && y.name === name)) : [])])].sort((x, y) => x.day - y.day);
  const ties = [];
  let dies = false;
  for (const x of theirs) {
    const named = ST.entryPeople(state.data, x);
    const card = ST.storyCard(state.data.story, x.source);
    const me = named.find(y => y.name === name);
    if (card?.dies && me?.key === card.dies) dies = true;
    const tie = x.tie || card?.tie;
    if (tie) for (const o of named.filter(y => y.name !== name)) ties.push({ to: o.local ? o.name : state.pages.get(resolve(o.name))?.meta.title || o.name, kind: tie, day: x.day });
  }
  const lastTie = new Map(ties.map(t => [t.to, t]));
  const taken = resolve(name) && state.pages.get(resolve(name));
  const roles = (state.data.npc?.roles || []).map(r => r.name);
  const r = await formDialog(`Make ${name} an NPC`, `
    ${theirs.length ? `<ul class="hint" style="margin:0 0 10px;padding-left:18px">${theirs.slice(-5).map(x => `<li>${esc(fmtDay(x.day, { short: true }))}: ${esc(x.text || x.title)}</li>`).join('')}</ul>` : of ? `<p class="hint" style="margin:0 0 10px">Named on ${esc(of)}'s page.</p>` : ''}
    <label class="field">Name<input name="name" value="${esc(name)}" required></label>
    ${taken ? `<p class="warn" style="margin:0 0 8px">${esc(taken.meta.title)} already goes by "${esc(name)}", and this is someone else. Give them a fuller name.</p>` : ''}
    <div class="row"><label class="field" style="flex:1">Lives in<input name="place" value="${esc(where)}" placeholder="A place page"></label>
    <label class="field" style="flex:1">Role<select name="role"><option value="">Any</option>${roles.map(x => `<option>${esc(x)}</option>`).join('')}</select></label></div>
    ${[...lastTie.values()].map(t => `<p class="muted" style="margin:6px 0 0">${esc(name)} will be ${esc(ST.tieInfo(PEOPLE(), t.kind).name)} ${esc(t.to)}.</p>`).join('')}
    ${dies ? `<label class="check"><input type="checkbox" name="dead" checked> Dead (the chronicle says so)</label>` : ''}`, 'Make NPC', form => {
    attachPicker($('input[name=place]', form), () => storyPlaces().map(p => ({ value: p.title, label: cap(p.settlement) })));
  });
  if (!r) return;
  const was = name;
  name = r.name.trim().replace(/\s+/g, ' ') || name;
  if (resolve(name)) return toast(`There is already a page called (or also called) ${name}. Pick another name.`, true);
  // Their events are theirs now: the stranger becomes this page, under the name the DM gave them.
  const swap = t => t && was !== name ? t.replace(new RegExp(`(^|[^\\w\\[])${reEsc(was)}(?![\\w\\]])`, 'g'), `$1${name}`) : t;
  for (const x of theirs) {
    const named = ST.entryPeople(state.data, x);
    x.text = swap(x.text); x.dm = swap(x.dm);
    x.people = [...named.filter(y => !y.local).map(y => y.name), name];
    x.locals = named.filter(y => y.local && y.name !== was).map(y => y.name);
    if (x.cast) for (const k of Object.keys(x.cast)) if (x.cast[k] === was) x.cast[k] = name;
    if (x.refs) delete x.refs[was];
  }
  // What their events may still lead to, and the town's familiar faces, know them by their new name.
  for (const q of w.pending || []) for (const k of Object.keys(q.fill || {})) if (q.fill[k] === was && (!town || q.place === town)) q.fill[k] = name;
  const face = town && (w.locals?.[town] || []).find(f => f.name === was);
  if (face) face.made = name;
  // The people whose names they share, if any.
  const [first, ...rest] = name.split(' ');
  const sets = x => [x.names || {}, ...Object.values(x.regional || {})];
  const folk = (state.data.peoples?.peoples || []).filter(x => sets(x).some(n => (n.first || []).includes(first) && (!rest.length || (n.last || []).includes(rest.join(' ')))));
  const n = G.generateNPC(state.data, { wiki: wikiTitles(), twist: 'none', ...(r.role ? { role: r.role } : {}), ...(folk.length ? { people: folk[0].name } : {}) });
  n.name = name;
  const home = r.place.trim() && state.pages.get(resolve(r.place.trim()));
  const story = theirs.length ? `\n## In the chronicle\n\n${theirs.map(x => `- ${fmtDay(x.day)}: ${x.text || x.title}`).join('\n')}\n` : '';
  await attempt(async () => {
    const id = await api.pages.create(name, { type: 'npc', rank: n.rank, ...(home ? { parent: home.meta.title } : {}), origin: S.originFor(n.role, n.class), tags: ['generated'], ...(r.dead ? { dead: true } : {}) },
      G.npcToMarkdown(n) + (home ? `\n## Home\n\n${n.pronoun === 'they' ? 'They live' : `${cap(n.pronoun)} lives`} in [[${home.meta.title}]].\n` : '') + story);
    state.pages.set(id, await api.pages.read(id));
    rebuildIndex();
    if (state.data.people) {
      if (was !== name && w.people?.[was]) ST.renameIn({ people: w.people }, was, name);
      const rec = ST.person(w, name);
      if (!rec.traits.length) rec.traits = ST.rollTraits(PEOPLE(), Math.random);
      for (const t of lastTie.values()) ST.setTie(w, PEOPLE(), name, t.to, t.kind, t.day);
    }
    await saveWorld();
    renderTree();
    toast(`${name} is an NPC page now${home ? `, in ${home.meta.title}` : ''}.`);
    render();
  });
}

const effectText = fx => Object.entries(fx).filter(([, v]) => v).map(([k, v]) => `${cap(k)} ${v > 0 ? '+' : '−'}${Math.abs(v)}${k === 'population' ? '%' : ''}`).join(', ');

function wireEntries(root, again) {
  const of = b => world().chronicle.find(e => e.id === b.closest('[data-entry]').dataset.entry);
  const run = fn => async ev => { const e = of(ev.currentTarget); if (e) { await fn(e); again(); } };
  $$('[data-reroll-entry]', root).forEach(b => b.onclick = run(e => rerollMinor(e.id)));
  $$('[data-undo-entry]', root).forEach(b => b.onclick = run(e => undoMinor(e.id)));
  $$('[data-outcome-entry]', root).forEach(b => b.onclick = run(e => outcomeDialog(e.id)));
  $$('[data-hide-entry]', root).forEach(b => b.onclick = run(async e => { e.hidden = !e.hidden || undefined; await saveWorld(); }));
  $$('[data-edit-entry]', root).forEach(b => b.onclick = async ev => { const e = of(ev.currentTarget); if (e) await addEntryDialog(e); });
  $$('[data-delete-entry]', root).forEach(b => b.onclick = run(async e => {
    if (!(await confirmDialog(`Delete "${e.title}"?`, 'It goes from the chronicle and every page\'s history.', 'Delete'))) return;
    world().chronicle = world().chronicle.filter(x => x !== e);
    await saveWorld();
  }));
}

function advanceCard(a) {
  const w = world();
  const ents = a.entries.map(id => w.chronicle.find(e => e.id === id)).filter(Boolean);
  const fest = ents.filter(e => e.kind === 'festival');
  // What touches the party itself goes first, so it isn't lost among the weddings and harvests.
  const mine = ents.filter(e => e.kind === 'party' || e.kind === 'grudge' || e.rep?.length);
  const happened = ents.filter(e => !['festival', 'person', 'faction'].includes(e.kind) && !mine.includes(e));
  const rested = (a.rested || []).map(b => state.pages.get(b.id)?.meta.title || b.title);
  const forParty = a.undone || !(mine.length || rested.length || a.journeyEnded) ? '' : `<div class="adv-party"><h3 style="margin:0 0 4px">For the party</h3>
    ${a.journeyEnded ? `<p style="margin:0 0 4px">The party reached <b>${esc(a.journeyEnded.to)}</b>, and the journey there is over.</p>` : ''}
    ${rested.length ? `<p style="margin:0 0 4px">${esc(listJoin(rested))} rested: full HP, spell slots and hit dice back.</p>` : ''}
    ${mine.length ? `<ul class="chronicle">${mine.map(e => entryRow(e)).join('')}</ul>` : ''}</div>`;
  const folkEnts = ents.filter(e => e.kind === 'person');
  const facEnts = ents.filter(e => e.kind === 'faction');
  const changes = Object.entries(a.placeChanges || {}).filter(([, c]) => !c.undone && ['prosperity', 'safety', 'population'].some(k => c.before[k] !== c.after[k]));
  const num = (k, c) => c.before[k] === c.after[k] ? '' : k === 'population' ? `${c.after.population > c.before.population ? '+' : '−'}${Math.abs(c.after.population - c.before.population).toLocaleString()} people` : `${k} ${c.before[k]} → ${c.after[k]}`;
  const latest = standing().at(-1) === a;
  return `<section class="adv-card" data-advance="${esc(a.id)}">
    <div class="row"><h2 style="flex:1;margin:0">${esc(fmtDay(a.from, { short: true }))} → ${esc(fmtDay(a.to))} <span class="muted">(${a.to - a.from} day${a.to - a.from === 1 ? '' : 's'}${a.partyAt ? `, party at ${esc(a.partyAt)}` : ''})</span></h2>
      ${a.undone ? '<span class="badge">Undone</span>' : latest ? '<button class="btn small" data-undo-advance title="Put the clock, the events and the numbers back as they were">Undo this advance</button>' : ''}</div>
    ${forParty}
    ${fest.length ? festivalLine(fest) : ''}
    ${happened.length ? `<ul class="chronicle">${happened.map(e => entryRow(e)).join('')}</ul>` : '<p class="muted">Nothing worth noting happened.</p>'}
    ${folkEnts.length ? `<h3>People</h3><ul class="chronicle">${folkEnts.map(e => entryRow(e)).join('')}</ul>` : ''}
    ${facEnts.length ? `<h3>Factions</h3><ul class="chronicle">${facEnts.map(e => entryRow(e)).join('')}</ul>` : ''}
    ${changes.length ? `<h3>Places that changed</h3><ul class="adv-changes">${changes.map(([t, c]) => `<li><b>${resolve(t) ? `<a class="wikilink" data-id="${esc(resolve(t))}">${esc(t)}</a>` : esc(t)}</b>: ${['safety', 'prosperity', 'population'].map(k => num(k, c)).filter(Boolean).join(', ')}
      ${a.undone ? '' : `<button class="btn small dm-tool" data-undo-drift="${esc(t)}" title="Put this place's numbers back as they were before this advance">Undo</button>`}</li>`).join('')}</ul>` : ''}
    ${a.undone ? '' : facesHtml(Object.entries(world().locals || {}).flatMap(([place, fs]) => fs.filter(f => f.seen >= 2 && !f.dead && !f.made && f.last > a.from && f.last <= a.to).map(f => ({ ...f, place }))), 'Familiar faces')}
    ${(a.problemChanges || []).length ? `<p class="muted">Troubles spread: ${a.problemChanges.map(c => `${esc(problems().find(p => p.id === c.id)?.name || 'a trouble')} now reaches ${c.after} miles`).join('; ')}.</p>` : ''}
  </section>`;
}

/** The festivals an advance passed: each once, with how many times it came round, folded away when there are many. */
function festivalLine(fest) {
  const by = new Map();
  for (const e of fest) by.set(e.title, [...(by.get(e.title) || []), e]);
  const one = ([title, es]) => es.length > 1 ? `${esc(title)} ×${es.length}` : `${esc(title)}${fmtDay(es[0].day, { short: true }) === title ? '' : ` (${esc(fmtDay(es[0].day, { short: true }))})`}`;
  const all = [...by];
  if (all.length <= 8) return `<p class="muted" style="margin:8px 0 0">Festivals: ${all.map(one).join(', ')}</p>`;
  return `<details class="muted" style="margin:8px 0 0"><summary>Festivals: ${all.length} kinds, ${fest.length} in all</summary>${all.map(one).join(', ')}</details>`;
}
function calendarGrid(year, month) {
  const g = ST.monthGrid(cal(), year, month);
  const marks = new Set(world().chronicle.filter(e => e.kind !== 'festival').map(e => e.day));
  const t = today();
  // A festival over several days is one bar across them (within a tenday's row), not its name cut short in every cell.
  const runs = [];
  g.days.forEach((d, i) => d.events.forEach(e => {
    if (i % 10 && g.days[i - 1].events.some(x => x.name === e.name)) return;
    let len = 1;
    while (i + len < g.days.length && (i + len) % 10 && g.days[i + len].events.some(x => x.name === e.name)) len++;
    if (len > 1) runs.push({ e, at: i, len, row: Math.floor(i / 10) });
  }));
  const inRun = (i, name) => runs.some(r => r.e.name === name && i >= r.at && i < r.at + r.len);
  const cell = (day, label, events, holy = false, style = '', run = false) => `<div class="cal-day${day === t ? ' today' : ''}${holy ? ' holy' : ''}${events.length || run ? ' fest' : ''}${run ? ' has-run' : ''}"${style ? ` style="${style}"` : ''} title="${esc(events.map(e => `${e.name}: ${e.text}`).join('\n'))}">
    <span class="cal-n">${esc(label)}</span>${marks.has(day) ? '<span class="cal-dot" title="Something happened"></span>' : ''}
    ${events.slice(0, 2).map(e => `<span class="cal-ev">${esc(e.name)}</span>`).join('')}</div>`;
  return `<div class="calendar">
    <div class="row cal-head"><button class="btn small" data-cal="-1" title="Previous month">‹</button><h3 style="flex:1;margin:0;text-align:center">${esc(g.name)} <span class="muted">${esc(g.season)}, year ${year}</span></h3><button class="btn small" data-cal="1" title="Next month">›</button></div>
    <div class="cal-grid">${g.days.map((d, i) => cell(d.day, d.n, d.events.filter(e => !inRun(i, e.name)), false, `grid-row:${Math.floor(i / 10) + 1};grid-column:${i % 10 + 1}`, runs.some(r => r.row === Math.floor(i / 10) && i >= r.at && i < r.at + r.len))).join('')}
      ${runs.map(r => `<div class="cal-run" style="grid-row:${r.row + 1};grid-column:${r.at % 10 + 1} / span ${r.len}" title="${esc(`${r.e.name}: ${r.e.text}`)}">${esc(r.e.name)}</div>`).join('')}</div>
    ${g.after.map(h => `<div class="cal-holy">${cell(h.day, h.holy.name, h.events.filter(e => e.name !== h.holy.name), true)}</div>`).join('')}
  </div>`;
}

function renderWorld() {
  const v = state.view;
  const w = world();
  if (!state.data.calendar) { $('#view').innerHTML = '<div class="page empty"><p>The calendar list (calendar.json) could not be read.</p></div>'; return; }
  const d = ST.dateOf(cal(), w.today);
  const here = partyPlace();
  const road = !w.partyAt && !w.partyPoint && mainJourneys().filter(journeyActive).at(-1);
  if (state.worldCal?.on !== w.today) state.worldCal = { on: w.today, year: d.year, month: d.holy ? Math.max(0, ST.dateOf(cal(), w.today - 1).month) : d.month };
  const shown = state.worldCal;
  const q = (state.worldQ ||= { text: '', kind: '' });
  const adv = v.advance ? w.advances.find(a => a.id === v.advance) : standing().at(-1);
  const soon = ST.upcoming(cal(), w.today, 40);
  const matches = e => (!q.kind || e.kind === q.kind) && (!q.text || [e.title, e.text, e.dm, ...e.places, ...e.people].join(' ').toLowerCase().includes(q.text.toLowerCase()));
  const rows = w.chronicle.filter(e => e.kind !== 'festival' || q.kind === 'festival').filter(matches).sort((a, b) => b.day - a.day).slice(0, 200);
  $('#view').innerHTML = `<div class="wide world">
    <div class="row" style="margin-bottom:6px">
      <h1 style="flex:1;margin:0;font:600 32px var(--serif)">${esc(fmtDay(w.today))}</h1>
      <button class="btn primary" id="advance-btn" title="Play the world forward some days">Advance time</button>
      <button class="btn" id="set-date" title="Move the clock without anything happening">Set date</button>
      <button class="btn" id="add-entry">+ Add to chronicle</button>
      <button class="btn" id="world-settings" title="What happens by itself as time passes">Settings</button>
      <button class="btn" data-nav="digest" title="Everything that changed since the last session, for prep">Since last session</button>
    </div>
    <p class="hint" style="margin:0 0 14px">${esc(d.season)}${d.holy ? `, a holy day between months` : `, day ${(d.day - 1) % (cal().weekLength || 10) + 1} of the ${['first', 'second', 'third'][d.tenday - 1] || 'last'} tenday`}. The party is ${road ? `on the road to <b>${esc(road.to?.name || 'somewhere')}</b>, from ${esc(road.from?.name || 'somewhere')}` : here ? `at <b>${esc(here.title)}</b>` : 'nowhere on the map yet'}. Players see what they've heard in <a href="#" data-nav="news">News and rumours</a>.</p>
    <div class="world-top">
      ${calendarGrid(shown.year, shown.month)}
      <section class="soon"><h2>Coming up</h2>${soon.length ? `<ul>${soon.slice(0, 12).map(e => `<li><span class="ch-date">${esc(ST.spanText(e.day - w.today))}</span> <b>${esc(e.name)}</b> <span class="muted">${fmtDay(e.day, { short: true }) === e.name ? '' : esc(fmtDay(e.day, { short: true }))}${e.where ? ` · ${esc(e.where.join(', '))}` : ''}</span><div class="muted">${esc(e.text)}</div></li>`).join('')}</ul>` : '<p class="muted">No festivals in the next forty days.</p>'}</section>
    </div>
    ${state.data.incidents && sysOn('storyteller') ? tellerSection() : ''}
    ${adv ? advanceCard(adv) : '<p class="muted">Nothing has happened yet. Advance time to set the world moving.</p>'}
    <section class="chronicle-box"><div class="row"><h2 style="flex:1;margin:0">Chronicle</h2>
      <input id="ch-q" type="search" placeholder="Filter by place, person or word" value="${esc(q.text)}" style="width:260px">
      <select id="ch-kind"><option value="">Everything</option>${Object.entries(KIND_LABEL).filter(([k]) => k !== 'event').map(([k, l]) => `<option value="${k}" ${q.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      ${rows.length ? `<ul class="chronicle">${rows.map(e => entryRow(e)).join('')}</ul>` : '<p class="muted">Nothing in the chronicle matches.</p>'}
    </section>
    ${w.advances.length > 1 ? `<section><h2>Earlier advances</h2><ul class="adv-list">${w.advances.slice().reverse().map(a => `<li><a href="#" data-show-advance="${esc(a.id)}">${esc(fmtDay(a.from, { short: true }))} → ${esc(fmtDay(a.to))}</a> <span class="muted">${a.to - a.from} days, ${a.entries.length} entr${a.entries.length === 1 ? 'y' : 'ies'}${a.undone ? ', undone' : ''}</span></li>`).join('')}</ul></section>` : ''}
  </div>`;
  const again = () => renderWorld();
  $('#advance-btn').onclick = advanceDialog;
  $('#set-date').onclick = setDateDialog;
  $('#add-entry').onclick = () => addEntryDialog();
  $('#world-settings').onclick = worldSettingsDialog;
  $$('[data-cal]').forEach(b => b.onclick = () => {
    let m = shown.month + Number(b.dataset.cal);
    if (m < 0) { m = cal().months.length - 1; shown.year--; } else if (m >= cal().months.length) { m = 0; shown.year++; }
    shown.month = m;
    again();
  });
  $('#ch-q').oninput = e => { q.text = e.target.value; clearTimeout(state.worldQT); state.worldQT = setTimeout(() => { again(); $('#ch-q').focus(); const i = $('#ch-q'); i.setSelectionRange(i.value.length, i.value.length); }, 250); };
  $('#ch-kind').onchange = e => { q.kind = e.target.value; again(); };
  $$('[data-show-advance]').forEach(a => a.onclick = e => { e.preventDefault(); go({ kind: 'world', advance: a.dataset.showAdvance }, { replace: true }); });
  $('[data-undo-advance]')?.addEventListener('click', async () => { if (await undoAdvance(adv.id)) again(); });
  $$('[data-undo-drift]').forEach(b => b.onclick = async () => { await undoDrift(adv.id, b.dataset.undoDrift); again(); });
  wireEntries($('#view'), again);
  if ($('#teller')) wireTeller(again);
  if (v.focus === 'teller') $('#teller')?.scrollIntoView();
  refreshDate();
}

// ---------- since last session ----------
// A prep digest for the DM: what changed in the world since the last session began, near the party first, with
// what's brewing, the markets, the troubles, people and factions, and the faces that keep turning up.

function digestData() {
  const w = world();
  const sessions = sessionPages().filter(s => s.meta.worldDay !== '' && s.meta.worldDay != null && Number.isFinite(Number(s.meta.worldDay)));
  const pickId = state.view?.from;
  const from = sessions.find(s => s.id === pickId) || sessions[0] || null;
  const since = from ? Number(from.meta.worldDay) : (w.began ?? w.today) - 1;
  const here = partyPlace();
  const focus = state.data.story?.focusMiles || 200;
  const near = e => !here || !e.at || PL.milesBetween(e.at, here.map) <= focus;
  const ents = w.chronicle.filter(e => e.day > since && e.day <= w.today && !['festival', 'session'].includes(e.kind)).sort((a, b) => a.day - b.day);
  const events = ents.filter(e => !['person', 'faction', 'party', 'grudge'].includes(e.kind));
  const grudges = ents.filter(e => e.kind === 'grudge').sort((a, b) => (b.tags.includes('threat') ? 1 : 0) - (a.tags.includes('threat') ? 1 : 0));
  const due = w.chronicle.filter(e => e.kind === 'event' && !e.outcome && (e.taken !== false ? Number.isFinite(e.due) && e.due >= w.today - 30 : Number.isFinite(e.acceptBy) && e.acceptBy >= w.today)).map(e => e.taken === false ? { ...e, due: e.acceptBy, board: true } : e).sort((a, b) => a.due - b.due);
  const byPlace = new Map();
  for (const e of events.filter(near)) { const t = e.places[0] || 'Elsewhere'; byPlace.set(t, [...(byPlace.get(t) || []), e]); }
  const markets = w.chronicle.filter(e => e.econ && e.day <= w.today && e.econ.until > w.today && near(e)).sort((a, b) => a.econ.until - b.econ.until);
  const troubles = problems().filter(x => x.status !== 'solved' && (!here || !x.centre || PL.milesBetween(x.centre, here.map) <= focus + (x.radius || 0)));
  const brewing = (w.pending || []).filter(q => q.due <= w.today + 30).sort((a, b) => a.due - b.due);
  const faces = Object.entries(w.locals || {}).flatMap(([place, fs]) => fs.filter(f => f.seen >= 2 && !f.dead && !f.made && f.last > since).map(f => ({ ...f, place })));
  const ready = simPeople().filter(p => ST.goalReady(PEOPLE(), w.people?.[p.title]?.goal)).map(p => p.title);
  return { w, sessions, from, since, here, ents, events, byPlace, far: events.filter(e => !near(e)), folk: ents.filter(e => e.kind === 'person'), facs: ents.filter(e => e.kind === 'faction'), party: ents.filter(e => e.kind === 'party' || e.rep?.length), markets, troubles, brewing, faces, ready, grudges, due };
}

function renderDigest() {
  if (!state.data.calendar || !state.saved?.world) { $('#view').innerHTML = '<div class="page empty"><p>The world clock isn\'t running yet.</p></div>'; return; }
  const D = digestData();
  const days = D.w.today - D.since;
  const sec = (title, body) => body ? `<section class="digest-sec"><h2>${esc(title)}</h2>${body}</section>` : '';
  const rows = list => `<ul class="chronicle">${list.map(e => entryRow(e, { actions: false })).join('')}</ul>`;
  const link = t => resolve(t) ? `<a class="wikilink" data-id="${esc(resolve(t))}">${esc(t)}</a>` : esc(t);
  $('#view').innerHTML = `<div class="page digest">
    <div class="row" style="margin-bottom:6px"><h1 style="flex:1;margin:0;font:600 32px var(--serif)">Since last session</h1>
      ${D.sessions.length > 1 ? `<label class="field" style="margin:0">Since<select id="digest-from">${D.sessions.map(s => `<option value="${esc(s.id)}" ${s === D.from ? 'selected' : ''}>${esc(s.meta.title)}</option>`).join('')}</select></label>` : ''}
      <button class="btn primary" id="digest-notes" title="Write this into the latest session page's notes, under its own heading">Add to session notes</button></div>
    <p class="hint" style="margin:0 0 14px">${D.from ? `${esc(D.from.meta.title)} began on ${esc(fmtDay(D.since))}` : `The world began on ${esc(fmtDay(D.since + 1))}`}. It's now ${esc(fmtDay(D.w.today))}: ${days} day${days === 1 ? '' : 's'} later. ${D.here ? `The party is at <b>${link(D.here.title)}</b>.` : 'The party is nowhere on the map yet.'}
      ${D.events.length} event${D.events.length === 1 ? '' : 's'}, ${D.events.length - D.far.length} near the party.</p>
    ${!D.ents.length && !D.brewing.length ? '<p class="muted">Nothing has happened in the world since then. Advance time on the World page to set it moving.</p>' : ''}
    ${sec('Near the party', [...D.byPlace].map(([t, list]) => `<h3>${link(t)} <span class="muted">(${list.length})</span></h3>${rows(list)}`).join(''))}
    ${sec('Grudges', D.grudges.length ? `<p class="hint">People and factions the party angered, acting on it. Dangers to plan for come first.</p>${rows(D.grudges)}` : '')}
    ${sec('Deadlines', D.due.length ? `<ul>${D.due.map(e => `<li><b>${resolve(e.quest || '') ? link(e.quest) : esc(e.title)}</b> <span class="${e.due < D.w.today ? 'warn' : 'muted'}">${e.board ? `not accepted yet, on the board until ${esc(fmtDay(e.due, { short: true }))}, ${esc(ST.spanText(e.due - D.w.today))}` : e.due < D.w.today ? `overdue since ${esc(fmtDay(e.due, { short: true }))}` : `due ${esc(fmtDay(e.due, { short: true }))}, ${esc(ST.spanText(e.due - D.w.today))}`}</span></li>`).join('')}</ul>` : '')}
    ${sec('Brewing', D.brewing.length ? `<p class="hint">What recent events may lead to in the next thirty days, if time passes. Undo or reroll the event and it won't.</p><ul>${D.brewing.map(q => `<li><b>${esc(q.name || q.card)}</b> <span class="muted">at ${link(q.place)}, around ${esc(fmtDay(q.due, { short: true }))}${(() => { const c = D.w.chronicle.find(x => x.id === q.cause); return c ? `, after ${esc(c.title.toLowerCase())}` : ''; })()}</span></li>`).join('')}</ul>` : '')}
    ${sec('Markets', D.markets.length ? `<ul>${D.markets.map(e => `<li>${link(e.places[0])} is ${e.econ.kind === 'short' ? '<b>short of</b>' : 'awash with'} ${esc(e.econ.good)} until ${esc(fmtDay(e.econ.until, { short: true }))}: ${e.econ.kind === 'short' ? 'dearer' : 'cheaper'} there.</li>`).join('')}</ul>` : '')}
    ${sec('Troubles', D.troubles.length ? `<ul>${D.troubles.map(x => `<li><b>${esc(x.name)}</b> <span class="muted">around ${link(x.origin)}, reaching ${x.radius} miles</span></li>`).join('')}</ul>` : '')}
    ${sec('People', (D.ready.length ? `<p><b>Ready to act:</b> ${D.ready.map(link).join(', ')}. Their goals have come to a head, so the storyteller can pitch them. <a href="#" id="digest-teller">Ask the storyteller</a></p>` : '') + (D.folk.length ? rows(D.folk) : ''))}
    ${D.faces.length ? `<section class="digest-sec">${facesHtml(D.faces, 'Familiar faces')}</section>` : ''}
    ${sec('Factions', D.facs.length ? rows(D.facs) : '')}
    ${sec('The party', D.party.length ? rows(D.party) : '')}
    ${sec('Far away', D.far.length ? `<p class="hint">Word of these may not have reached the party yet.</p>${rows(D.far.slice(-8))}` : '')}
  </div>`;
  if ($('#digest-from')) $('#digest-from').onchange = e => go({ kind: 'digest', from: e.target.value }, { replace: true });
  $('#digest-notes').onclick = () => digestToNotes(D);
  if ($('#digest-teller')) $('#digest-teller').onclick = e => { e.preventDefault(); e.stopPropagation(); go({ kind: 'world', focus: 'teller' }); };
  wireEntries($('#view'), () => renderDigest());
}

/** The digest as notes in the latest session page, under its own heading; DM-only, since it's prep. */
async function digestToNotes(D) {
  const s = sessionPages()[0];
  if (!s) return toast('There is no session page yet. Start one with + New session on Sessions.', true);
  const link = t => resolve(t) ? `[[${state.pages.get(resolve(t)).meta.title}]]` : t;
  const line = e => `- **${fmtDay(e.day, { short: true })}, ${e.title}**${e.places.length ? ` (${e.places.map(link).join(', ')})` : ''}: ${e.text}${e.dm ? ` *DM: ${e.dm}*` : ''}`;
  const md = [':::dm', `## Since ${D.from ? D.from.meta.title : 'the start'}`, '',
    ...[...D.byPlace].flatMap(([t, list]) => [`**${link(t)}**`, '', ...list.map(line), '']),
    ...(D.grudges.length ? ['**Grudges**', '', ...D.grudges.map(line), ''] : []),
    ...(D.due.length ? ['**Deadlines**', '', ...D.due.map(e => `- ${link(e.quest || e.title)}: ${e.due < D.w.today ? 'overdue since' : 'due'} ${fmtDay(e.due, { short: true })}`), ''] : []),
    ...(D.brewing.length ? ['**Brewing**', '', ...D.brewing.map(q => `- ${q.name || q.card} at ${link(q.place)}, around ${fmtDay(q.due, { short: true })}`), ''] : []),
    ...(D.markets.length ? ['**Markets**', '', ...D.markets.map(e => `- ${link(e.places[0])}: ${e.econ.kind === 'short' ? 'short of' : 'plenty of'} ${e.econ.good} until ${fmtDay(e.econ.until, { short: true })}`), ''] : []),
    ...(D.troubles.length ? ['**Troubles**', '', ...D.troubles.map(x => `- ${x.name} around ${link(x.origin)}`), ''] : []),
    ...(D.ready.length ? [`**Ready to act:** ${D.ready.map(link).join(', ')}`, ''] : []),
    ...(D.faces.length ? [`**Familiar faces:** ${D.faces.map(f => `${f.name} (${f.place})`).join(', ')}`, ''] : []),
    ...(D.folk.length ? ['**People**', '', ...D.folk.map(line), ''] : []),
    ...(D.facs.length ? ['**Factions**', '', ...D.facs.map(line), ''] : []),
    ':::'].join('\n');
  s.body = G.putSection(s.body, 'prep-digest', md);
  await attempt(() => api.pages.write(s.id, s.meta, s.body));
  toast(`Added to ${s.meta.title}.`);
}

// ---------- news and rumours ----------
// What the party could have heard: public entries whose word has had time to travel to where the party is.

function newsItems() {
  const w = world();
  const at = partyPlace()?.map || null;
  return w.chronicle.filter(e => e.public && e.kind !== 'festival' && e.day <= w.today)
    .map(e => ({ e, h: ST.heard(e, { today: w.today, at, wordMiles: wordMiles() }) }))
    .sort((a, b) => b.e.day - a.e.day);
}
function renderNews() {
  const w = world();
  const here = partyPlace();
  const items = newsItems();
  const heardList = items.filter(x => x.h.heard);
  const coming = state.dm ? items.filter(x => !x.h.heard && !x.e.hidden) : [];
  const row = ({ e, h }) => `<li class="news-item${e.hidden ? ' is-hidden' : ''}" data-entry="${esc(e.id)}"><div class="ch-head"><span class="ch-date">${esc(ST.spanText(e.day - w.today))}</span>
      <b>${esc(state.dm ? e.title : e.news || (e.kind === 'grudge' ? `Talk about the party${e.places[0] ? ` in ${e.places[0]}` : ''}` : e.title))}</b>${e.places.length ? `<span class="muted"> · ${esc(e.places.join(', '))}</span>` : ''}
      ${state.dm ? `<span class="spacer"></span>${!h.heard && !e.hidden ? `<span class="muted">reaches ${esc(here?.title || 'the party')} ${esc(ST.spanText(h.inDays))}</span>` : ''}
        <button class="btn small" data-news-toggle>${e.hidden || !h.heard ? 'Reveal to players' : 'Hide from players'}</button>` : ''}</div>
    ${e.text ? `<div class="ch-text">${entryMarkdown(e, e.text)}</div>` : ''}</li>`;
  const soon = ST.upcoming(cal(), w.today, 20);
  $('#view').innerHTML = `<div class="page news">
    <h1 style="margin:0 0 4px;font:600 32px var(--serif)">News and rumours</h1>
    <p class="hint" style="margin:0 0 14px">${esc(fmtDay(w.today))}${here ? `, as heard in ${esc(here.title)}` : ''}. Word of distant events takes days to arrive.</p>
    ${soon.length ? `<p class="muted">Coming up: ${soon.slice(0, 5).map(e => `${esc(e.name)} ${esc(ST.spanText(e.day - w.today))}`).join(' · ')}</p>` : ''}
    ${heardList.length ? `<ul class="chronicle">${heardList.map(row).join('')}</ul>` : '<div class="empty">No news yet.</div>'}
    ${coming.length ? `<h2>Not heard here yet <span class="muted" style="font-size:14px">(DM only)</span></h2><ul class="chronicle dm-tool">${coming.map(row).join('')}</ul>` : ''}
  </div>`;
  $$('[data-news-toggle]').forEach(b => b.onclick = async () => {
    const it = items.find(x => x.e.id === b.closest('[data-entry]').dataset.entry);
    if (!it) return;
    if (it.e.hidden || !it.h.heard) { delete it.e.hidden; it.e.shown = true; } else { it.e.hidden = true; delete it.e.shown; }
    await saveWorld();
    renderNews();
  });
}

/** The chronicle part of a page's History: entries naming it, newest first; players see only what they've heard. */
function pageChronicle(p) {
  if (!state.saved?.world || p.meta.type === 'session') return [];
  const w = world();
  const at = partyPlace()?.map || null;
  return ST.historyOf(w.chronicle, [p.meta.title, ...[].concat(p.meta.aliases || [])], p.id)
    // A place's history leaves out the private lives of the people in it; their own pages show those.
    .filter(e => e.kind !== 'festival' && (!['person', 'faction'].includes(e.kind) || e.public || ['npc', 'faction', 'cult'].includes(p.meta.type)) && e.day <= w.today && (state.dm || ST.heard(e, { today: w.today, at, wordMiles: wordMiles() }).heard))
    .reverse().slice(0, 12);
}

/** On a session page: what happened in the world between the last session and this one. */
function sessionWorld(p) {
  if (!state.dm || p.meta.type !== 'session' || !Number.isFinite(Number(p.meta.worldDay)) || !state.saved?.world) return '';
  const day = Number(p.meta.worldDay);
  const prev = sessionPages().filter(s => (Number(s.meta.number) || 0) < (Number(p.meta.number) || 0) && Number.isFinite(Number(s.meta.worldDay)))[0];
  const since = prev ? Number(prev.meta.worldDay) : -Infinity;
  const ents = world().chronicle.filter(e => e.day > since && e.day <= day && !['festival', 'party', 'session'].includes(e.kind)).sort((a, b) => a.day - b.day);
  if (!ents.length) return '';
  return `<section class="backlinks dm-tool session-world"><div class="row"><h2 style="flex:1;margin:0">In the world since ${prev ? esc(prev.meta.title) : 'the start'}</h2>
    <button class="btn small" id="world-to-notes" title="Write these into this session's notes, under their own heading">Add to notes</button></div>
    <ul class="chronicle">${ents.map(e => entryRow(e, { actions: false })).join('')}</ul></section>`;
}
async function worldToNotes(p) {
  const day = Number(p.meta.worldDay);
  const prev = sessionPages().filter(s => (Number(s.meta.number) || 0) < (Number(p.meta.number) || 0) && Number.isFinite(Number(s.meta.worldDay)))[0];
  const since = prev ? Number(prev.meta.worldDay) : -Infinity;
  const ents = world().chronicle.filter(e => e.day > since && e.day <= day && !['festival', 'party', 'session'].includes(e.kind)).sort((a, b) => a.day - b.day);
  const link = t => resolve(t) ? `[[${state.pages.get(resolve(t)).meta.title}]]` : t;
  const secret = ents.filter(e => e.dm);
  const md = ['## In the world', '', ...ents.map(e => `- **${fmtDay(e.day, { short: true })}, ${e.title}**${e.places.length ? ` (${e.places.map(link).join(', ')})` : ''}: ${e.text}`),
    ...(secret.length ? ['', ':::dm', ...secret.map(e => `- **${e.title}:** ${e.dm}`), ':::'] : [])].join('\n');
  p.body = G.putSection(p.body, 'world-news', md);
  await attempt(() => api.pages.write(p.id, p.meta, p.body));
  renderPage(p.id);
}

// ---------- the storyteller ----------
// A session-prep assistant: it pitches incidents with reasons from the world, and the DM accepts, rerolls, edits or
// turns each one down. Accepting builds the prep (quest page, NPC pages, a new place, a trouble, the chronicle entry
// and a note in the latest session). Nothing happens without that yes. Logic is in story.js; cards in incidents.json.

const npcPages = () => [...state.pages.values()].filter(p => p.meta.type === 'npc' && !(p.meta.tags || []).includes('minor') && !(p.meta.tags || []).includes('locked') && p.meta.dead !== true);
/** Wiki NPCs tied to a place: nested under it (or under somewhere inside it) or linking to it. */
function peopleOf(place) {
  const title = place.title.toLowerCase();
  const under = p => { for (let q = p, i = 0; q && i < 8; q = q.meta.parent ? state.pages.get(resolve(q.meta.parent)) : null, i++) if (q.meta.title.toLowerCase() === title) return true; return false; };
  return npcPages().filter(p => p.meta.title !== MINOR_NPCS && (under(p) || linksOf(p.body).some(t => t.toLowerCase() === title))).map(p => ({ title: p.meta.title, role: null }));
}
function factionNear(place) {
  const all = [...state.pages.values()].filter(p => p.meta.type === 'faction' && !(p.meta.tags || []).includes('locked'));
  const near = all.filter(p => linksOf(p.body).some(t => t.toLowerCase() === place.title.toLowerCase()) || world().factions?.[p.meta.title]?.influence?.[place.title] > 0);
  const from = near.length ? near : all;
  return from.length ? G.weighted(Math.random, from, p => 1 + (world().factions?.[p.meta.title]?.influence?.[place.title] || 0) / 10).meta.title : null;
}
function tellerCtx() {
  const party = partyPlace();
  const j = mainJourneys().at(-1);
  const heading = j && journeyActive(j) && j.to?.name ? state.pages.get(resolve(j.to.name))?.meta.title || null : null;
  return {
    cal: cal(), data: state.data, world: world(), places: storyPlaces(), problems: problems(), party, heading,
    rank: pcs().length ? slowestRank(partyLevel()) : 'Iron', wikiPeople: peopleOf,
    takenNames: [...state.pages.values()].filter(p => p.meta.type === 'npc').map(p => p.meta.title),
    faction: party ? factionNear(party) : null, regionOf, people: simPeople(), factions: simFactions(),
  };
}
/** A pitch that makes a new place gets its draft now, so the DM sees the name before accepting. */
function draftPlaceFor(p) {
  if (!p.newPlace || !state.data.places) return p;
  const make = placeMaker(p.place, [], { want: [p.newPlace === 'site' ? 'site' : 'settlement'], miles: [4, 30], chance: 1 });
  const out = make?.({ fresh: true });
  if (out?.draft) p.placeDraft = { ...out.draft, from: p.title };
  return p;
}
async function newPitches(replace = true) {
  const T = ST.teller(world());
  const keep = replace ? [] : T.pitches;
  const fresh = ST.pitchIncidents(tellerCtx(), 3 - keep.length, Math.random, keep.map(p => p.card)).map(draftPlaceFor);
  T.pitches = [...keep, ...fresh];
  await saveWorld();
  if (!fresh.length) toast('The storyteller has nothing to pitch near the party. Set where the party is in Advance time, or pin some places on the map.', true);
}
async function rerollPitch(id) {
  const T = ST.teller(world());
  const i = T.pitches.findIndex(p => p.id === id);
  if (i < 0) return;
  const [next] = ST.pitchIncidents(tellerCtx(), 1, Math.random, T.pitches.map(p => p.card)).map(draftPlaceFor);
  if (!next) return toast('Nothing else fits right now.', true);
  T.pitches[i] = next;
  await saveWorld();
}
async function declineOne(id) {
  const p = ST.teller(world()).pitches.find(x => x.id === id);
  if (!p) return;
  ST.declinePitch(world(), p);
  await saveWorld();
  toast(`Turned down. It won't be pitched at ${p.place} again for sixty days.`);
}

/** Look over what accepting would make, change the words, and make it. */
async function acceptDialog(id) {
  const w = world();
  const p = ST.teller(w).pitches.find(x => x.id === id);
  if (!p) return;
  const fresh = p.cast.filter(c => !c.page);
  const latest = sessionPages()[0];
  const box = (name, label, on = true, hint = '') => `<label class="check"${hint ? ` title="${esc(hint)}"` : ''}><input type="checkbox" name="${name}" ${on ? 'checked' : ''}> ${label}</label>`;
  const r = await formDialog(`Accept: ${p.title}`, `
    <p class="muted" style="margin:0 0 8px">${esc(p.reason)}</p>
    <label class="field">Title<input name="title" value="${esc(p.title)}" required></label>
    <label class="field">What happens (public)<textarea name="text" rows="3">${esc(p.text)}</textarea></label>
    <label class="field">The truth (DM only)<textarea name="dm" rows="2">${esc(p.dm)}</textarea></label>
    <label class="field">What the party is asked to do<input name="goal" value="${esc(p.goal)}"></label>
    <div class="accept-list">
      ${box('quest', `A quest page, <b>${esc(p.title)}</b>, with its scenes and rewards (DM only)`)}
      ${fresh.map((c, i) => box(`npc${i}`, `An NPC page for <b>${esc(c.name)}</b>${c.label ? ` (${esc(c.label)})` : ''}`)).join('')}
      ${p.cast.filter(c => c.page).map(c => `<p class="muted" style="margin:2px 0">Uses <b>${esc(c.page)}</b> from the wiki${c.label ? ` as ${esc(c.label)}` : ''}.</p>`).join('')}
      ${p.placeDraft ? box('place', `A new place, <b>${esc(p.placeDraft.name)}</b>: ${esc(PL.placeLine(p.placeDraft))}`) : ''}
      ${p.trouble ? box('trouble', `Start a trouble around ${esc(p.place)}: <b>${esc(p.trouble.name)}</b>`) : ''}
      ${Object.keys(p.effects || {}).length ? box('effects', `Change ${esc(p.place)}: ${esc(effectText(p.effects))}`) : ''}
      ${box('public', 'Word spreads: players can hear of it in News and rumours')}
      ${latest ? box('notes', `Add it to the prep notes of ${esc(latest.meta.title)}`) : ''}
    </div>`, 'Make it');
  if (!r) return;
  let opened = null;
  await attempt(async () => {
    const made = [];
    const pitch = { ...p, title: r.title.trim() || p.title, text: r.text.trim(), dm: r.dm.trim(), goal: r.goal.trim() };
    let placeTitle = null;
    if (r.place && p.placeDraft) { await keepPlaces([p.placeDraft], pitch.title); placeTitle = p.placeDraft.name; made.push(placeTitle); }
    const placePage = state.pages.get(resolve(p.place));
    for (const [i, c] of fresh.entries()) {
      if (!r[`npc${i}`]) continue;
      const n = G.generateNPC(state.data, { wiki: wikiTitles(), twist: 'none', ...(c.role ? { role: c.role } : {}) });
      n.name = c.name;
      let title = c.name;
      for (let k = 2; resolve(title); k++) title = `${c.name} (${k})`;
      // Like the quest, they start hidden from players, and their part in it stays a DM note even once shown.
      const id = await api.pages.create(title, { type: 'npc', rank: n.rank, origin: S.originFor(n.cover?.role || n.role, n.class), ...(placePage ? { parent: placePage.meta.title } : {}), ...(r.quest ? { dmOnly: true } : {}), tags: ['generated', 'storyteller'] },
        G.npcToMarkdown(n) + `\n## In the story\n\n:::dm\n${cap(c.label || 'Part of the story')} in [[${pitch.title}]]${placePage ? `, in [[${placePage.meta.title}]]` : ''}.\n:::\n`);
      state.pages.set(id, await api.pages.read(id));
      c.name = title;
      if (state.data.people) ST.person(w, title).traits = ST.rollTraits(PEOPLE(), Math.random);
      made.push(title);
    }
    let questTitle = null;
    if (r.quest) {
      questTitle = pitch.title;
      for (let k = 2; resolve(questTitle); k++) questTitle = `${pitch.title} (${k})`;
      const id = await api.pages.create(questTitle, { type: 'adventure', dmOnly: true, tags: ['storyteller', p.kind] }, ST.questMarkdown({ ...pitch, newPlaceTitle: placeTitle }));
      state.pages.set(id, await api.pages.read(id));
      made.push(questTitle);
    }
    rebuildIndex(); renderTree();
    if (r.trouble && p.trouble) {
      const here = placePage && problemHere(placePage);
      const x = here && PL.newProblem(state.data, here, Math.random, { name: p.trouble.name, summary: p.trouble.summary, effect: p.trouble.effect });
      if (x) { if (p.trouble.radius) x.radius = p.trouble.radius; x.startedDay = today(); problems().push(x); made.push(`the trouble "${x.name}"`); }
    }
    if (r.effects && p.effects) { const now = placeNums(p.place); if (now) await setPlaceNums(p.place, ST.applyEffects(now, p.effects)); }
    const e = ST.entry({ day: today(), kind: 'event', title: pitch.title, text: pitch.text, dm: pitch.dm, places: [p.place, ...(placeTitle ? [placeTitle] : [])], people: p.cast.map(c => c.name), tags: [...p.tags, p.kind], at: p.at, source: p.card, isPublic: !!r.public });
    if (r.effects) e.effects = p.effects;
    e.quest = questTitle;
    e.drama = p.drama;
    if (p.faction) e.faction = p.faction;
    if (p.factionGoal && w.factions?.[p.goalOf]?.goal) e.fx = ST.factionWins(w, FACTIONS(), p.goalOf, today());
    else if (p.goalOf && w.people?.[p.goalOf]?.goal) { w.people[p.goalOf].goal.done = today(); e.goalOf = p.goalOf; }
    w.chronicle.push(e);
    if (r.notes && latest) {
      const link = t => `[[${t}]]`;
      const md = [`### Prep: ${questTitle ? link(questTitle) : pitch.title}`, '', pitch.text, '', `- **Where:** ${link(p.place)}${placeTitle ? `, ${link(placeTitle)}` : ''}`, ...(p.cast.length ? [`- **Who:** ${p.cast.map(c => link(c.name)).join(', ')}`] : []), `- **Hook:** ${pitch.rumour || pitch.goal}`, '', ':::dm', pitch.dm, ':::'].join('\n');
      latest.body = G.putSection(latest.body, `pitch ${p.id}`, md);
      await api.pages.write(latest.id, latest.meta, latest.body);
    }
    ST.acceptPitch(w, p);
    await saveWorld();
    toast(`Accepted. Made ${made.length ? made.join(', ') : 'the chronicle entry'}.`);
    opened = questTitle;
  });
  return opened;
}

const DRAMA = ['', 'Small', 'Local', 'Serious', 'Big', 'Huge'];
function tellerSection() {
  const w = world();
  const T = ST.teller(w);
  const P = ST.PERSONALITIES;
  const t = ST.tension(w);
  const slider = (name, label, v, hint) => `<label class="field teller-slider" title="${esc(hint)}">${label} <span class="muted">${v}×</span><input type="range" name="${name}" min="0.5" max="2" step="0.25" value="${v}"></label>`;
  return `<section class="teller" id="teller"><div class="row"><h2 style="flex:1;margin:0">Storyteller</h2>
      <button class="btn primary" id="teller-pitch" title="Three ideas for the next session, with reasons from the world">${T.pitches.length ? 'New pitches' : 'Pitch me some ideas'}</button></div>
    <p class="hint" style="margin:4px 0 8px">It only suggests. Nothing happens until you accept a pitch, which makes the quest, people and places as pages you can change.</p>
    <div class="row teller-controls">
      <label class="field" style="width:170px" title="${esc(Object.values(P).map(x => `${x.label}: ${x.text}`).join('\n'))}">Personality<select id="teller-personality">${Object.entries(P).map(([k, x]) => `<option value="${k}" ${T.personality === k ? 'selected' : ''}>${x.label}</option>`).join('')}</select></label>
      ${slider('difficulty', 'Difficulty', T.difficulty, 'Higher pitches more dramatic incidents')}
      ${slider('frequency', 'Frequency', T.frequency, 'Higher builds tension faster in quiet stretches')}
      <label class="inline-check" title="Only small, local pitches until you turn it off"><input type="checkbox" id="teller-quiet" ${T.quiet ? 'checked' : ''}> Nothing big this week</label>
      <span class="muted teller-tension" title="Quiet stretches build tension; accepting something dramatic spends it">${tensionText(w, t)}</span>
    </div>
    ${T.pitches.length ? `<div class="pitches">${T.pitches.map(p => `<article class="pitch k-${esc(p.kind)}" data-pitch="${esc(p.id)}">
        <div class="pitch-head"><span class="badge">${esc(cap(p.kind))}</span><span class="drama" title="${esc(DRAMA[p.drama])} drama">${'●'.repeat(p.drama)}${'○'.repeat(5 - p.drama)}</span></div>
        <h3>${esc(p.title)}</h3>
        <p class="muted pitch-where">${resolve(p.place) ? `<a class="wikilink" data-id="${esc(resolve(p.place))}">${esc(p.place)}</a>` : esc(p.place)}${p.placeDraft ? ` · new place: ${esc(p.placeDraft.name)}` : ''}</p>
        <p class="pitch-reason">${esc(p.reason)}</p>
        <p>${esc(p.text)}</p>
        <p class="ch-dm">${esc(p.dm)}</p>
        ${p.cast.length ? `<p class="muted">Who: ${p.cast.map(c => `${esc(c.name)}${c.page ? ' (wiki)' : ''}`).join(', ')}</p>` : ''}
        ${p.trouble || Object.keys(p.effects || {}).length ? `<p class="muted">${[p.trouble ? `Starts a trouble: ${esc(p.trouble.name)}` : '', Object.keys(p.effects || {}).length ? esc(effectText(p.effects)) : ''].filter(Boolean).join(' · ')}</p>` : ''}
        <div class="row pitch-actions"><button class="btn primary small" data-accept-pitch>Accept…</button><button class="btn small" data-reroll-pitch title="A different idea in its place">↻ Reroll</button><button class="btn small" data-decline-pitch title="Not this one. It won't come back here for sixty days.">Turn down</button></div>
      </article>`).join('')}</div>` : ''}
  </section>`;
}
function wireTeller(again) {
  const T = ST.teller(world());
  const save = async () => { await saveWorld(); again(); };
  $('#teller-pitch').onclick = async () => { await newPitches(); again(); };
  $('#teller-personality').onchange = e => { T.personality = e.target.value; save(); };
  $$('.teller input[type=range]').forEach(i => i.onchange = () => { T[i.name] = Number(i.value); save(); });
  $('#teller-quiet').onchange = e => { T.quiet = e.target.checked; save(); $('.teller-tension').innerHTML = tensionText(world(), ST.tension(world())); };
  const of = b => b.closest('[data-pitch]').dataset.pitch;
  $$('[data-accept-pitch]').forEach(b => b.onclick = async () => { const q = await acceptDialog(of(b)); if (q && resolve(q)) openPage(resolve(q)); else again(); });
  $$('[data-reroll-pitch]').forEach(b => b.onclick = async () => { await rerollPitch(of(b)); again(); });
  $$('[data-decline-pitch]').forEach(b => b.onclick = async () => { await declineOne(of(b)); again(); });
}

// ---------- reputation ----------
// Standing with places and factions, renown in regions (logic in story.js). Deeds move it: troubles solved, how
// storyteller quests end, and the DM's own adjustments. It changes prices, contract pay and what gets pitched.

/** The region a place is in, for renown: its naming style's region, from the place or the nearest place above it. */
function regionOf(place) {
  const a = placeAnchor(place.title || place);
  if (!a?.map || !state.data.places) return null;
  const k = PL.styleFor(state.data, a.map, a.style);
  return k === 'common' ? 'the wider world' : state.data.places.styles?.[k]?.label || k;
}
const standingKind = p => p.meta.type === 'location' ? 'place' : ['faction', 'cult'].includes(p.meta.type) ? 'faction' : null;
/** The standing that applies at a place: its own, or the nearest place above it that has one. */
function standingAt(title) {
  let p = title && state.pages.get(resolve(title));
  for (let i = 0; p && i < 8; i++) {
    const s = ST.standingOf(world(), 'place', p.meta.title);
    if (s.value) return { title: p.meta.title, ...s };
    p = p.meta.parent ? state.pages.get(resolve(p.meta.parent)) : null;
  }
  const t = title && state.pages.get(resolve(title));
  return { title: t?.meta.title || title, value: 0, log: [] };
}
const signed = n => n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0';

/** Change standings and renown, returning what was done (kept on a chronicle entry so it can be undone). */
function applyRep(changes, why) {
  const done = [];
  for (const c of changes) {
    const made = ST.addStanding(world(), c.kind, c.title, c.delta, why);
    if (made) done.push({ kind: c.kind, title: c.title, delta: made });
  }
  return done;
}
const undoRep = list => { for (const c of list || []) ST.addStanding(world(), c.kind, c.title, -c.delta, 'Undone'); };

/** How a storyteller incident ended: moves the place's standing, the region's renown, and a faction's. */
async function outcomeDialog(id) {
  const w = world();
  const e = w.chronicle.find(x => x.id === id);
  if (!e) return;
  const facs = [...state.pages.values()].filter(p => ['faction', 'cult'].includes(p.meta.type)).map(p => ({ value: p.meta.title, label: typeInfo(p.meta.type).label }));
  const r = await formDialog(`How did it end? ${e.title}`, `
    <label class="field">Outcome<select name="outcome">${ST.OUTCOMES.map(o => `<option value="${o.key}">${esc(o.label)}</option>`).join('')}</select></label>
    <div class="row"><label class="field" style="flex:1" title="A faction with a stake in it, if any">Faction<input name="faction" value="${esc(e.faction || '')}" placeholder="(none)"></label>
    <label class="field" style="width:200px">It was<select name="side"><option value="for">on the party's side</option><option value="against">against the party</option></select></label></div>
    <label class="field">What happened (public, for News)<textarea name="text" rows="2" placeholder="Leave empty for a short line"></textarea></label>
    ${state.data.people && e.people.some(t => resolve(t)) ? `<label class="check"><input type="checkbox" name="remember" checked> ${esc(e.people.filter(t => resolve(t)).join(', '))} remember${e.people.filter(t => resolve(t)).length === 1 ? 's' : ''} how the party handled it</label>` : ''}
    <p class="muted" style="margin:6px 0 0">The party's standing in ${esc(e.places[0] || 'the place')}${regionOf(e.places[0] || '') ? ` and renown in ${esc(regionOf(e.places[0]))}` : ''} change by how it went and how big it was.</p>`, 'Record it', form => attachPicker($('input[name=faction]', form), () => facs));
  if (!r) return;
  const o = ST.OUTCOMES.find(x => x.key === r.outcome);
  const d = ST.outcomeDeltas(r.outcome, e.drama || 2, state.data.story);
  const place = e.places[0];
  const region = place ? regionOf(place) : null;
  const fac = r.faction.trim() && state.pages.get(resolve(r.faction.trim()))?.meta.title;
  const why = `${e.title}: ${o.label.toLowerCase()}`;
  const done = applyRep([
    ...(place ? [{ kind: 'place', title: place, delta: d.place }] : []),
    ...(region ? [{ kind: 'region', title: region, delta: d.region }] : []),
    ...(fac ? [{ kind: 'faction', title: fac, delta: r.side === 'against' ? -d.faction : d.faction }] : []),
  ], why);
  const phrase = { success: 'put an end to', partial: 'dealt with part of', failed: 'failed to stop', ignored: 'did nothing about', worse: 'made worse' }[o.key];
  const out = ST.entry({ day: today(), kind: 'party', title: `${e.title}: ${o.label.replace(/^They /, 'the party ').replace(/^Partly: /, '')}`, text: r.text.trim() || `The party ${phrase} ${lc1(e.title)}${place ? ` in ${place}` : ''}.`, places: e.places, people: e.people, factions: fac ? [fac] : [], tags: ['party', o.key], at: e.at, source: e.id, isPublic: true });
  out.rep = done;
  const memDelta = PEOPLE().outcomeMemory?.[o.key] ?? 0;
  out.mem = r.remember && memDelta ? e.people.filter(t => resolve(t)).map(t => ({ title: state.pages.get(resolve(t)).meta.title, pc: null, delta: ST.remember(w, state.pages.get(resolve(t)).meta.title, memDelta, why, null, today()) })).filter(m => m.delta) : [];
  out.outcomeOf = e.id;
  e.outcome = o.key;
  w.chronicle.push(out);
  await saveWorld();
  toast(done.length ? `Recorded. ${done.map(c => `${c.title} ${signed(c.delta)}`).join(', ')}.` : 'Recorded.');
}

async function adjustStanding(kind, title) {
  const s = ST.standingOf(world(), kind, title);
  const r = await formDialog(`${kind === 'region' ? 'Renown in' : 'Standing with'} ${title}`, `
    <p class="muted" style="margin:0 0 8px">Now ${signed(s.value)}${kind === 'region' ? ` (${ST.renownName(s.value)})` : ` (${ST.tierFor(state.data.story, s.value).name})`}.</p>
    <div class="row"><label class="field" style="width:120px">Change by<input name="delta" type="number" min="-100" max="100" value="5"></label>
    <label class="field" style="flex:1">Why<input name="why" placeholder="Shown on the page" required></label></div>`, 'Change');
  if (!r || !Number(r.delta)) return false;
  const done = applyRep([{ kind, title, delta: Number(r.delta) }], r.why.trim());
  if (done.length) world().chronicle.push(Object.assign(ST.entry({ kind: 'party', day: today(), title: `Standing with ${title} ${signed(done[0].delta)}`, text: r.why.trim(), places: kind === 'place' ? [title] : [], factions: kind === 'faction' ? [title] : [], isPublic: false }), { rep: done }));
  await saveWorld();
  return true;
}

/** The standing box on a place or faction page. Players see the tier; the DM sees the number and why. */
function standingSection(p) {
  const kind = standingKind(p);
  if (!kind || !state.saved || !state.data.calendar || !state.data.story) return '';
  const s = ST.standingOf(world(), kind, p.meta.title);
  const region = kind === 'place' && mapPoint(p) ? regionOf(p.meta.title) : null;
  const ren = region ? ST.standingOf(world(), 'region', region) : null;
  if (!s.value && !s.log.length && !state.dm) return '';
  const t = ST.tierFor(state.data.story, s.value);
  return `<section class="standing-box${s.value ? '' : ' dm-tool'}"><div class="row"><h2 style="flex:1;margin:0">The party here: ${esc(t.name)} <span class="muted dm-tool">(${signed(s.value)})</span></h2>
      <button class="btn small dm-tool" data-adjust-standing="${kind}" title="Change the party's standing by hand">Adjust</button></div>
    <p class="muted" style="margin:4px 0">${esc(t.text)}${t.price ? ` Prices ${t.price > 0 ? 'up' : 'down'} ${Math.abs(t.price)}%.` : ''}</p>
    ${ren && (ren.value || state.dm) ? `<p class="muted" style="margin:4px 0">Renown in ${esc(region)}: ${esc(ST.renownName(ren.value))}<span class="dm-tool"> (${ren.value})</span>.</p>` : ''}
    ${s.log.length ? `<ul class="dm-tool standing-log">${s.log.slice(-5).reverse().map(l => `<li><b>${signed(l.delta)}</b> ${esc(l.why || '')} <span class="muted">${esc(fmtDay(l.day, { short: true }))}</span></li>`).join('')}</ul>` : ''}
  </section>`;
}
/** On a storyteller quest page: how it ended, or a button to record that. */
function questOutcome(p) {
  if (p.meta.type !== 'adventure' || !state.saved?.world || !state.data.story) return '';
  const e = world().chronicle.find(x => x.kind === 'event' && x.quest === p.meta.title);
  if (!e) return '';
  const o = e.outcome && ST.OUTCOMES.find(x => x.key === e.outcome);
  const waiting = e.contract && e.taken === false;
  const left = Number.isFinite(e.due) ? e.due - today() : null;
  const trip = e.contract ? contractTrip(e) : null;
  const due = o ? '' : waiting
    ? `<p style="margin:6px 0 0">${Number.isFinite(e.acceptBy) ? (e.acceptBy >= today() ? `On the board until <b>${esc(fmtDay(e.acceptBy))}</b> (${esc(ST.spanText(e.acceptBy - today()))}).` : '<b class="warn">Gone from the board.</b>') : 'On the board until someone takes it.'}
        ${Number.isFinite(e.finishDays) ? `Once the party accepts it, they have ${e.finishDays} days to finish it.` : Number.isFinite(e.window) ? `Once the party accepts it, they have ${e.window * 4} days to finish it.` : 'Once accepted, there is no deadline to finish it.'}</p>
      ${trip ? `<p class="muted" style="margin:4px 0 0">${esc(tripNote(trip, Number.isFinite(e.finishDays) ? e.finishDays : Number.isFinite(e.window) ? e.window * 4 : null))}</p>` : ''}
      ${Number.isFinite(e.acceptBy) && e.acceptBy < today() ? '' : '<button class="btn small primary" id="contract-accept" style="margin-top:6px" title="The party takes the job: the time to finish it starts now">Accept the contract</button>'}`
    : left === null ? (e.contract ? '<p class="muted" style="margin:6px 0 0">No deadline to finish it.</p>' : '')
    : `<p style="margin:6px 0 0">${left >= 0 ? `<b>Due ${esc(fmtDay(e.due))}</b>, ${left === 0 ? 'today' : `${esc(ST.spanText(left))}`}.` : `<b class="warn">Overdue</b> since ${esc(fmtDay(e.due))}. It can still be finished, late.`}</p>
      ${trip && left >= 0 ? `<p class="${trip.walk > left ? 'warn' : 'muted'}" style="margin:4px 0 0">${esc(tripNote(trip, left))}</p>` : ''}`;
  return `<section class="standing-box dm-tool"><div class="row"><h2 style="flex:1;margin:0">${o ? `It ended: ${esc(o.label)}` : 'Still under way'}</h2>
    ${o ? '' : `<button class="btn small primary" id="quest-outcome" data-entry="${esc(e.id)}" title="Record how it ended: it moves the party's standing and renown">How did it end?</button>`}</div>
    ${due}
  </section>`;
}
function wireStanding(p) {
  $('[data-adjust-standing]')?.addEventListener('click', async e => { if (await adjustStanding(e.currentTarget.dataset.adjustStanding, p.meta.title)) renderPage(p.id); });
}

/** The Party page's reputation: renown by region, then standing with places and factions. */
function reputationSection() {
  if (!state.saved?.world || !state.data.story) return '';
  const R = ST.rep(world());
  const rows = (book, kind) => Object.entries(book).filter(([, s]) => s.value).sort((a, b) => b[1].value - a[1].value)
    .map(([title, s]) => `<tr><td>${resolve(title) ? `<a class="wikilink" data-id="${esc(resolve(title))}">${esc(title)}</a>` : esc(title)}</td><td>${kind === 'region' ? esc(ST.renownName(s.value)) : esc(ST.tierFor(state.data.story, s.value).name)}</td><td class="dm-tool">${signed(s.value)}</td><td class="muted">${esc(s.log.at(-1)?.why || '')}</td></tr>`).join('');
  const ren = rows(R.regions, 'region'), pl = rows(R.places, 'place'), fa = rows(R.factions, 'faction');
  return `<h2 style="margin:14px 0 6px">Reputation</h2>
    <p class="hint" style="margin:0 0 6px">What the party's deeds have earned: solved troubles, how quests ended, and anything the DM adds on a place or faction page.</p>
    ${ren || pl || fa ? `<table class="rep-table">
      ${ren ? `<tr><th colspan="4">Renown</th></tr>${ren}` : ''}${pl ? `<tr><th colspan="4">Places</th></tr>${pl}` : ''}${fa ? `<tr><th colspan="4">Factions</th></tr>${fa}` : ''}</table>`
      : '<p class="muted">Nobody has strong feelings about the party yet.</p>'}`;
}

/** The note on a market, tavern, auction or contract board about what the party's standing there changes. */
function repHint(tab, r) {
  if (!r?.where || !state.saved?.world || !state.data.story || !['market', 'tavern', 'auction', 'contracts'].includes(tab)) return '';
  const s = standingAt(r.where);
  const t = s.value ? ST.tierFor(state.data.story, s.value) : null;
  const m = placeMarket(r.where);
  const short = (m?.now || []).filter(x => x.kind === 'short').map(x => x.good);
  const wanted = short.map(g => state.data.factions?.econ?.wanted?.[g]).filter(Boolean);
  const out = [];
  if (t && tab === 'contracts' && t.pay) out.push(`The party is <b>${esc(t.name)}</b> in ${esc(s.title)}: notices here pay ${Math.abs(t.pay)}% ${t.pay > 0 ? 'more' : 'less'} for them.`);
  if (t && tab !== 'contracts' && t.price) out.push(`The party is <b>${esc(t.name)}</b> in ${esc(s.title)}: prices for them are ${Math.abs(t.price)}% ${t.price > 0 ? 'higher' : 'lower'}.`);
  if (tab !== 'contracts' && m?.pct) out.push(`${short.length ? `With ${esc(short.join(' and '))} short` : 'With goods plentiful'}, prices here are ${Math.abs(m.pct)}% ${m.pct > 0 ? 'higher' : 'lower'}.`);
  if (tab === 'contracts' && wanted.length) out.push(`${esc(r.where)} is short of ${esc(short.join(' and '))}: the board wants ${esc(wanted.join(', and '))}.`);
  if (tab === 'market' && out.length && (t?.price || m?.pct)) out.push('Buy starts from that price.');
  return out.length ? `<p class="hint rep-hint" style="margin:8px 0 0">${out.join(' ')}</p>` : '';
}
const priceFor = (where, price) => {
  const s = where && state.saved?.world && state.data.story ? standingAt(where) : null;
  const t = s?.value ? ST.tierFor(state.data.story, s.value) : null;
  const pct = (t?.price || 0) + (where && state.saved?.world ? placeMarket(where)?.pct || 0 : 0);
  return G.floorPrice(pct ? Math.round(price * (1 + pct / 100) * 100) / 100 : price);
};

// ---------- people ----------
// NPC traits, goals, ties and memories (logic in story.js, lists in data/people.json). Major NPCs near the party act
// when time advances; every NPC keeps an opinion of the party. Tag a page "locked" and the engine leaves it alone.

const PEOPLE = () => state.data.people || {};
const hasTag = (p, t) => [].concat(p.meta.tags || []).includes(t);
const isLocked = p => hasTag(p, 'locked') || p.meta.locked === true;
/** Major NPCs act on their own. Pages the DM wrote are major unless set otherwise; generated ones only from the storyteller. */
const isMajor = p => typeof p.meta.major === 'boolean' ? p.meta.major : !hasTag(p, 'generated') || hasTag(p, 'storyteller');
/** Where an NPC lives: the nearest place on the map above their page, or a place on the map their page links to. */
function npcHome(p) {
  const onMap = q => q && q.meta.type === 'location' && mapPoint(q);
  for (let q = p.meta.parent ? state.pages.get(resolve(p.meta.parent)) : null, i = 0; q && i < 8; q = q.meta.parent ? state.pages.get(resolve(q.meta.parent)) : null, i++) if (onMap(q)) return { title: q.meta.title, map: mapPoint(q) };
  for (const t of linksOf(p.body)) { const q = state.pages.get(resolve(t)); if (onMap(q)) return { title: q.meta.title, map: mapPoint(q) }; }
  return null;
}
function simPeople() {
  return [...state.pages.values()].filter(p => p.meta.type === 'npc' && p.meta.title !== MINOR_NPCS).map(p => {
    const h = npcHome(p);
    return h && { title: p.meta.title, place: h.title, map: h.map, rank: p.meta.rank, major: isMajor(p), locked: isLocked(p), dead: p.meta.dead === true };
  }).filter(Boolean);
}
/** How an NPC's home place sees the party: where their opinion starts from. */
function opinionBase(p) {
  const h = npcHome(p);
  const s = h ? standingAt(h.title).value : 0;
  return Math.round(s * (PEOPLE().sim?.standingShare ?? 0.25));
}
const undoMem = list => { for (const m of list || []) ST.remember(world(), m.title, -m.delta, 'Undone', m.pc || null); };

async function rememberDialog(title) {
  const P = PEOPLE();
  const mems = P.memories || [];
  const r = await formDialog(`What ${title} remembers`, `
    <div class="row"><label class="field" style="flex:1">What happened<select name="preset"><option value="">(write your own)</option>${mems.map(m => `<option value="${esc(m.key)}" data-delta="${m.delta}">${esc(m.name)} (${signed(m.delta)})</option>`).join('')}</select></label>
    <label class="field" style="width:110px">Opinion<input name="delta" type="number" min="-100" max="100" value="${mems[0]?.delta ?? 5}"></label></div>
    <label class="field">Who did it<select name="pc"><option value="">The whole party</option>${pcs().map(p => `<option value="${esc(p.meta.title)}">${esc(p.meta.title)}</option>`).join('')}</select></label>
    <label class="field">Why (shown on their page)<input name="why" placeholder="e.g. Pulled her brother out of the river"></label>`, 'Remember it', form => {
    const sel = $('select[name=preset]', form), d = $('input[name=delta]', form);
    sel.value = mems[0]?.key || '';
    sel.onchange = () => { const o = sel.selectedOptions[0]; if (o?.dataset.delta) d.value = o.dataset.delta; };
  });
  if (!r || !Number(r.delta)) return false;
  const m = mems.find(x => x.key === r.preset);
  const why = r.why.trim() || m?.name || 'Something the party did';
  const made = ST.remember(world(), title, Number(r.delta), why, r.pc || null, today());
  if (made) world().chronicle.push(Object.assign(ST.entry({ kind: 'party', day: today(), title: `${title} remembers: ${why}`, text: `${r.pc || 'The party'}: ${why}.`, people: [title, ...(r.pc ? [r.pc] : [])], isPublic: false }), { mem: [{ title, delta: made, pc: r.pc || null }] }));
  await saveWorld();
  return true;
}

async function tieDialog(title) {
  const P = PEOPLE();
  const who = [...state.pages.values()].filter(x => ['npc', 'pc'].includes(x.meta.type) && x.meta.title !== title && x.meta.title !== MINOR_NPCS).map(x => ({ value: x.meta.title, label: typeInfo(x.meta.type).label }));
  const r = await formDialog(`A tie for ${title}`, `
    <div class="row"><label class="field" style="width:200px">${esc(title)} is<select name="kind">${(P.ties || []).map(t => `<option value="${esc(t.key)}">${esc(t.name)}</option>`).join('')}</select></label>
    <label class="field" style="flex:1">Who<input name="to" required placeholder="A person in the wiki"></label></div>`, 'Tie them', form => attachPicker($('input[name=to]', form), () => who));
  if (!r) return false;
  const to = state.pages.get(resolve(r.to.trim()))?.meta.title || r.to.trim();
  if (!to || to === title) return false;
  ST.setTie(world(), P, title, to, r.kind, today());
  await saveWorld();
  return true;
}

async function personDialog(p) {
  const P = PEOPLE();
  const r0 = ST.person(world(), p.meta.title);
  const g = r0.goal;
  const traitBox = t => `<label class="check" title="${esc(t.text)}"><input type="checkbox" name="t:${esc(t.key)}" ${r0.traits.includes(t.key) ? 'checked' : ''}> ${esc(t.name)}</label>`;
  const r = await formDialog(`${p.meta.title}: who they are`, `
    <p class="hint" style="margin:0 0 6px">Traits (three or so)</p><div class="trait-grid">${(P.traits || []).map(traitBox).join('')}</div>
    <div class="row"><label class="field" style="flex:1">Goal<select name="goal"><option value="">(none)</option>${(P.goals || []).map(x => `<option value="${esc(x.key)}" ${g?.key === x.key ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
    <label class="field" style="width:100px" title="How far along it is; at the last step the storyteller can pitch it">Step<input name="step" type="number" min="0" max="5" value="${g?.step || 0}"></label>
    <label class="field" style="width:200px" title="The other person their goal is about, if any">Rival or beloved<input name="rival" value="${esc(g?.fill?.rival || '')}"></label></div>
    <label class="check"><input type="checkbox" name="major" ${isMajor(p) ? 'checked' : ''}> Major: acts on their own when time passes near the party</label>
    <label class="check"><input type="checkbox" name="locked" ${isLocked(p) ? 'checked' : ''}> Locked: the engine never changes them</label>
    <label class="check"><input type="checkbox" name="dead" ${p.meta.dead === true ? 'checked' : ''}> Dead</label>
    <p class="hint" style="margin:6px 0 0"><a href="#" id="roll-person">Roll traits and a goal</a></p>`, 'Save', form => {
    $('#roll-person', form).onclick = e => {
      e.preventDefault();
      const t = ST.rollTraits(P, Math.random);
      $$('input[name^="t:"]', form).forEach(b => { b.checked = t.includes(b.name.slice(2)); });
      const ng = ST.newGoal(P, t, Math.random, {});
      if (ng) $('select[name=goal]', form).value = ng.key;
      $('input[name=step]', form).value = 0;
    };
  });
  if (!r) return false;
  const rec = ST.person(world(), p.meta.title);
  rec.traits = (P.traits || []).filter(t => r[`t:${t.key}`]).map(t => t.key);
  if (!r.goal) rec.goal = null;
  else {
    const home = npcHome(p);
    if (!rec.goal || rec.goal.key !== r.goal) rec.goal = { ...ST.newGoal(P, rec.traits, Math.random, { place: home?.title, rank: p.meta.rank, faction: home ? factionNear(home) : null, goods: G.pick(Math.random, state.data.story?.goods || []) }, today()), key: r.goal };
    rec.goal.step = Math.max(0, Math.min(ST.goalSteps(P, rec.goal), Number(r.step) || 0));
    if (r.rival.trim()) rec.goal.fill.rival = r.rival.trim();
    delete rec.goal.done;
  }
  const meta = { ...p.meta };
  const tags = [].concat(meta.tags || []).filter(t => t !== 'locked');
  meta.tags = r.locked ? [...tags, 'locked'] : tags;
  delete meta.locked;
  if (!!r.major !== isMajor(p)) meta.major = !!r.major;
  const died = r.dead && meta.dead !== true;
  if (r.dead) meta.dead = true; else delete meta.dead;
  await attempt(async () => {
    await api.pages.write(p.id, meta, p.body);
    p.meta = meta;
    if (died) world().chronicle.push(ST.entry({ kind: 'person', day: today(), title: `${p.meta.title} has died`, text: `${p.meta.title} has died.`, places: npcHome(p) ? [npcHome(p).title] : [], people: [p.meta.title], tags: ['death'], at: npcHome(p)?.map || null, isPublic: true }));
    await saveWorld();
  });
  return true;
}

/** The DM's box on an NPC page: traits, goal, ties, and what they think of the party and why. */
function personSection(p) {
  if (p.meta.type !== 'npc' || p.meta.title === MINOR_NPCS || !state.saved || !state.data.calendar || !state.data.people) return '';
  const P = PEOPLE();
  const r = state.saved.world?.people?.[p.meta.title] || { traits: [], goal: null, ties: [], opinion: 0, pcs: {}, log: [] };
  const of = ` data-npc-of="${esc(p.meta.title)}"`;
  const link = t => resolve(t) ? `<a class="wikilink" data-id="${esc(resolve(t))}">${esc(t)}</a>` : `<a class="wikilink missing new-npc" data-target="${esc(t)}"${of} title="No page yet: click to make ${esc(t)} an NPC">${esc(t)}</a>`;
  const g = r.goal;
  const goalMd = md => nameLinks(esc(md), ST.goalPeople(P, g, p.meta.title).slice(1), of);
  const n = g ? ST.goalSteps(P, g) : 0;
  const home = npcHome(p);
  const base = opinionBase(p);
  const op = ST.opinionOf(world(), p.meta.title, { base });
  const flags = [isMajor(p) ? 'Major' : 'Minor', isLocked(p) ? 'Locked' : '', p.meta.dead === true ? 'Dead' : '', home ? `Lives in ${home.title}` : 'Not on the map, so they stay as they are'].filter(Boolean);
  const G0 = P.grudges;
  const grudge = G0 && p.meta.dead !== true && ST.opinionOf(world(), p.meta.title, { base: opinionBase(p) }) <= (G0.threshold ?? -25);
  const lastAct = grudge && [...world().chronicle].reverse().find(e => e.grudge?.by === p.meta.title);
  return `<section class="person-box dm-tool">
    <div class="row"><h2 style="flex:1;margin:0">Their story</h2>
      <button class="btn small" id="person-edit" title="Traits, goal, major or minor, locked, dead">Edit…</button>
      <button class="btn small" id="person-tie" title="Family, friends, rivals, lovers, debts">Add a tie</button>
      ${state.data.children ? '<button class="btn small" id="person-child" data-sys="towntools" title="A normal-rank child (under 18): their family name and people, tied to this parent">Add a child</button>' : ''}
      <button class="btn small primary" id="person-remember" title="Something the party did that they won't forget">Remember…</button></div>
    <p class="muted" style="margin:4px 0 8px">${flags.map(esc).join(' · ')}</p>
    ${grudge ? `<p class="warn" style="margin:0 0 8px"><b>Holds a grudge against the party.</b> When time passes they may act on it: lies, closed doors, thugs, worse.${lastAct ? ` Last: ${esc(lastAct.title.replace(/^[^:]+: /, ''))} (${esc(fmtDay(lastAct.day, { short: true }))}).` : ''}</p>` : ''}
    <p style="margin:4px 0">${r.traits.length ? r.traits.map(k => { const t = ST.traitInfo(P, k); return `<span class="badge trait" title="${esc(t?.text || '')}">${esc(t?.name || k)}</span>`; }).join(' ') : '<span class="muted">No traits yet. They get some the first time time passes near them, or use Edit.</span>'}</p>
    ${g ? `<p style="margin:8px 0 2px"><b>Wants to ${goalMd(ST.goalText(P, g, p.meta.title))}.</b> ${g.done ? '<span class="badge">Done</span>' : ST.goalReady(P, g) ? '<span class="badge dm">Ready: the storyteller can pitch it</span>' : `<span class="muted">Step ${g.step} of ${n}</span>`}</p>
      ${g.step ? `<p class="muted" style="margin:0">${goalMd(ST.stepText(P, g, p.meta.title))}</p>` : ''}` : ''}
    ${r.ties.length ? `<ul class="tie-list">${r.ties.map(t => `<li>${esc(ST.tieInfo(P, t.kind).name)} ${link(t.to)} <button class="btn small" data-untie="${esc(t.to)}" title="Remove this tie, both ways">×</button></li>`).join('')}</ul>` : ''}
    <p style="margin:10px 0 2px"><b>Thinks the party is ${esc(ST.opinionName(P, op).toLowerCase())}</b> <span class="muted">(${signed(op)}${base ? `, ${signed(base)} from how ${esc(home.title)} sees the party` : ''})</span></p>
    ${Object.entries(r.pcs || {}).filter(([, v]) => v).map(([pc, v]) => `<p class="muted" style="margin:0">${esc(pc)}: ${esc(ST.opinionName(P, ST.opinionOf(world(), p.meta.title, { base, pc })).toLowerCase())} (${signed(v)} of their own)</p>`).join('')}
    ${r.log.length ? `<ul class="standing-log">${r.log.slice(-5).reverse().map(l => `<li><b>${signed(l.delta)}</b> ${esc(l.why || '')}${l.pc ? ` <span class="muted">(${esc(l.pc)})</span>` : ''} <span class="muted">${esc(fmtDay(l.day, { short: true }))}</span></li>`).join('')}</ul>` : ''}
  </section>`;
}
function wirePerson(p) {
  const again = ok => { if (ok) renderPage(p.id); };
  $('#person-edit')?.addEventListener('click', async () => again(await personDialog(p)));
  $('#person-tie')?.addEventListener('click', async () => again(await tieDialog(p.meta.title)));
  $('#person-remember')?.addEventListener('click', async () => again(await rememberDialog(p.meta.title)));
  $$('[data-untie]').forEach(b => b.onclick = async () => { ST.setTie(world(), PEOPLE(), p.meta.title, b.dataset.untie, null); await saveWorld(); renderPage(p.id); });
}

// ---------- factions and economy ----------
// Factions' goals, power, wealth, influence and ties (logic in story.js, lists in data/factions.json), and what
// shortages and gluts do to prices and contract boards.

const FACTIONS = () => state.data.factions || {};
const factionPages = () => [...state.pages.values()].filter(p => ['faction', 'cult'].includes(p.meta.type));
function simFactions() {
  return factionPages().map(p => {
    const h = npcHome(p);
    return h && { title: p.meta.title, kind: ST.factionKind(p.meta.title, p.meta.type), place: h.title, map: h.map, locked: isLocked(p) };
  }).filter(Boolean);
}
/** A place's goods and today's shortages and gluts. */
function placeMarket(title) {
  const pg = state.pages.get(resolve(title));
  if (!pg || !state.data.factions?.econ) return null;
  const sp = storyPlaces().find(x => x.title === pg.meta.title);
  const a = placeAnchor(pg.meta.title);
  const eco = ST.economyOf(state.data, { title: pg.meta.title, meta: pg.meta, settlement: sp?.settlement || G.settlementFor(state.data, pg.meta.title, pg.meta), terrain: a?.terrain || [] });
  const now = state.saved?.world ? ST.marketAt(world().chronicle, pg.meta.title, today()) : [];
  return { ...eco, now, pct: ST.marketPrice(state.data, now) };
}
function marketLine(p) {
  if (p.meta.type !== 'location' || !mapPoint(p) || !storySettlement(p)) return '';
  const m = placeMarket(p.meta.title);
  if (!m || (!m.makes.length && !m.needs.length && !m.now.length)) return '';
  const short = m.now.filter(x => x.kind === 'short'), plenty = m.now.filter(x => x.kind === 'plenty');
  const inf = Object.entries(world().factions || {}).map(([t, r]) => [t, r.influence?.[p.meta.title] || 0]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 4);
  return `<p class="hint market-line">${m.makes.length ? `Makes ${esc(m.makes.join(', '))}. ` : ''}${m.needs.length ? `Buys in ${esc(m.needs.join(', '))}. ` : ''}${short.length ? `<b>Short of ${esc(short.map(x => x.good).join(', '))}</b> (until ${esc(fmtDay(Math.max(...short.map(x => x.until)), { short: true }))}). ` : ''}${plenty.length ? `Plenty of ${esc(plenty.map(x => x.good).join(', '))}. ` : ''}${m.pct ? `Prices ${m.pct > 0 ? 'up' : 'down'} ${Math.abs(m.pct)}%.` : ''}
    ${inf.length ? `<span class="dm-tool"> Influence here: ${inf.map(([t, v]) => `${resolve(t) ? `<a class="wikilink" data-id="${esc(resolve(t))}">${esc(t)}</a>` : esc(t)} ${v}`).join(', ')}.</span>` : ''}</p>`;
}

async function factionDialog(p) {
  const F = FACTIONS();
  const r = ST.factionRec(world(), p.meta.title);
  const g = r.goal;
  const res = await formDialog(`${p.meta.title}: its aims`, `
    <div class="row"><label class="field" style="flex:1">Goal<select name="goal"><option value="">(none)</option>${(F.goals || []).map(x => `<option value="${esc(x.key)}" ${g?.key === x.key ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
    <label class="field" style="width:90px">Step<input name="step" type="number" min="0" max="5" value="${g?.step || 0}"></label></div>
    <div class="row"><label class="field" style="flex:1">Where<input name="place" value="${esc(g?.fill?.place || npcHome(p)?.title || '')}"></label>
    <label class="field" style="flex:1" title="The faction its goal is about, if any">Rival<input name="rival" value="${esc(g?.fill?.rival || '')}"></label></div>
    <div class="row"><label class="field" style="width:120px" title="0 to 100: how strong it is">Power<input name="power" type="number" min="0" max="100" value="${r.power}"></label>
    <label class="field" style="width:120px" title="0 to 100: how rich it is">Wealth<input name="wealth" type="number" min="0" max="100" value="${r.wealth}"></label></div>
    <label class="check"><input type="checkbox" name="locked" ${isLocked(p) ? 'checked' : ''}> Locked: the engine never changes it</label>`, 'Save', form => {
    attachPicker($('input[name=place]', form), () => storyPlaces().map(x => ({ value: x.title, label: cap(x.settlement) })));
    attachPicker($('input[name=rival]', form), () => factionPages().filter(x => x !== p).map(x => ({ value: x.meta.title, label: typeInfo(x.meta.type).label })));
  });
  if (!res) return false;
  if (!res.goal) r.goal = null;
  else {
    if (!r.goal || r.goal.key !== res.goal) r.goal = ST.newFactionGoal({ goals: (F.goals || []).filter(x => x.key === res.goal).map(x => ({ ...x, kinds: ['any'] })) }, 'any', Math.random, { goods: G.pick(Math.random, state.data.story?.goods || []) }, today());
    r.goal.step = Math.max(0, Math.min(ST.fGoalSteps(F, r.goal), Number(res.step) || 0));
    r.goal.fill.place = state.pages.get(resolve(res.place.trim()))?.meta.title || res.place.trim() || r.goal.fill.place;
    if (res.rival.trim()) r.goal.fill.rival = state.pages.get(resolve(res.rival.trim()))?.meta.title || res.rival.trim();
    delete r.goal.done;
  }
  r.power = Math.max(0, Math.min(100, Number(res.power) || 0));
  r.wealth = Math.max(0, Math.min(100, Number(res.wealth) || 0));
  if (!!res.locked !== isLocked(p)) {
    const meta = { ...p.meta, tags: [].concat(p.meta.tags || []).filter(t => t !== 'locked') };
    if (res.locked) meta.tags.push('locked');
    delete meta.locked;
    await attempt(async () => { await api.pages.write(p.id, meta, p.body); p.meta = meta; });
  }
  await saveWorld();
  return true;
}
async function factionTieDialog(p) {
  const res = await formDialog(`${p.meta.title} and…`, `
    <div class="row"><label class="field" style="width:160px">Is<select name="kind"><option value="ally">an ally of</option><option value="rival">a rival of</option><option value="enemy">at war with</option></select></label>
    <label class="field" style="flex:1">Faction<input name="to" required></label></div>`, 'Tie them', form => attachPicker($('input[name=to]', form), () => factionPages().filter(x => x !== p).map(x => ({ value: x.meta.title, label: typeInfo(x.meta.type).label }))));
  if (!res) return false;
  const to = state.pages.get(resolve(res.to.trim()))?.meta.title || res.to.trim();
  ST.setFactionTie(world(), p.meta.title, to, res.kind, today());
  await saveWorld();
  return true;
}
/** The DM's box on a faction page: its goal, power and wealth, where it has influence, its allies and rivals. */
function factionSection(p) {
  if (!['faction', 'cult'].includes(p.meta.type) || !state.saved || !state.data.calendar || !state.data.factions) return '';
  const F = FACTIONS();
  const r = state.saved.world?.factions?.[p.meta.title] || { goal: null, power: 50, wealth: 50, influence: {}, ties: [] };
  const link = t => resolve(t) ? `<a class="wikilink" data-id="${esc(resolve(t))}">${esc(t)}</a>` : esc(t);
  const g = r.goal;
  const home = npcHome(p);
  const inf = Object.entries(r.influence || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const TIE = { ally: 'Ally of', rival: 'Rival of', enemy: 'At war with' };
  const bar = (label, v) => `<span class="meter" title="${esc(label)} ${v} of 100"><span style="width:${v}%"></span></span> ${esc(label)} ${v}`;
  return `<section class="person-box dm-tool faction-box">
    <div class="row"><h2 style="flex:1;margin:0">Its aims</h2>
      <button class="btn small" id="faction-edit">Edit…</button><button class="btn small" id="faction-tie">Add a tie</button></div>
    <p class="muted" style="margin:4px 0 8px">${esc(cap(ST.factionKind(p.meta.title, p.meta.type) === 'any' ? 'faction' : ST.factionKind(p.meta.title, p.meta.type)))} · ${home ? `Seated in ${esc(home.title)}` : 'Not on the map, so it stays as it is'}${isLocked(p) ? ' · Locked' : ''}</p>
    <p style="margin:4px 0">${bar('Power', r.power)} &nbsp; ${bar('Wealth', r.wealth)}</p>
    ${g ? `<p style="margin:8px 0 2px"><b>Wants to ${esc(ST.fGoalText(F, g, p.meta.title))}.</b> ${g.done ? '<span class="badge">Done</span>' : ST.fGoalReady(F, g) ? '<span class="badge dm">Ready: the storyteller can pitch it</span>' : `<span class="muted">Step ${g.step} of ${ST.fGoalSteps(F, g)}</span>`}</p>
      ${g.step ? `<p class="muted" style="margin:0">${esc(ST.fStepText(F, g, p.meta.title))}</p>` : ''}` : '<p class="muted">No goal yet. Factions near the party pick one as time passes, or use Edit.</p>'}
    ${inf.length ? `<p style="margin:8px 0 0">Influence: ${inf.slice(0, 8).map(([t, v]) => `${link(t)} ${v}`).join(', ')}</p>` : ''}
    ${(() => { const holds = Object.entries(state.saved.world?.control || {}).filter(([, c]) => c.by === p.meta.title); return holds.length ? `<p style="margin:8px 0 0">Holds: ${holds.map(([t, c]) => `${link(t)} <span class="muted">(${esc(c.kind || 'hold')})</span>`).join(', ')}</p>` : ''; })()}
    ${F.grudges && ST.standingOf(world(), 'faction', p.meta.title).value <= (F.grudges.threshold ?? -25) ? '<p class="warn" style="margin:8px 0 0"><b>Holds a grudge against the party.</b> When time passes it may act on it: smears, blacklists, ambushes, killers.</p>' : ''}
    ${r.ties.length ? `<ul class="tie-list">${r.ties.map(t => `<li>${esc(TIE[t.kind] || t.kind)} ${link(t.to)} <button class="btn small" data-funtie="${esc(t.to)}" title="Remove this tie, both ways">×</button></li>`).join('')}</ul>` : ''}
  </section>`;
}
function wireFaction(p) {
  const again = ok => { if (ok) renderPage(p.id); };
  $('#faction-edit')?.addEventListener('click', async () => again(await factionDialog(p)));
  $('#faction-tie')?.addEventListener('click', async () => again(await factionTieDialog(p)));
  $$('[data-funtie]').forEach(b => b.onclick = async () => { ST.setFactionTie(world(), p.meta.title, b.dataset.funtie, null); await saveWorld(); renderPage(p.id); });
}

// ---------- legends ----------
// The whole chronicle by place, person, faction or year, the web of ties between people and factions, and the
// recent history of a region written on request (worldgen), reviewed by the DM before any of it is kept.

const seesEntry = (e, w = world(), at = partyPlace()?.map || null) => state.dm || (e.public && !e.hidden && e.kind !== 'festival' && e.day <= w.today && (e.shown || ST.heard(e, { today: w.today, at, wordMiles: wordMiles() }).heard));
const TIE_COLOURS = { friend: '#5fae6e', ally: '#5fae6e', spouse: '#d77fb3', lover: '#d77fb3', parent: '#8a9bd6', child: '#8a9bd6', sibling: '#8a9bd6', mentor: '#c9a54a', student: '#c9a54a', rival: '#e08a3c', enemy: '#d95353', owes: '#9a8f80', owed: '#9a8f80', serves: '#9a8f80', employs: '#9a8f80' };

function webSVG(only = null) {
  const w = world();
  const g = ST.webOf(w, { only });
  if (!state.dm) {
    // Players see the ties of people they've heard of, and only public kinds of tie.
    const known = new Set(w.chronicle.filter(e => seesEntry(e, w)).flatMap(e => [...e.people, ...e.factions]));
    g.edges = g.edges.filter(e => known.has(e.a) && known.has(e.b) && ['spouse', 'parent', 'child', 'sibling', 'ally', 'enemy'].includes(e.kind));
    g.nodes = g.nodes.filter(n => g.edges.some(e => e.a === n.id || e.b === n.id));
  }
  if (!g.edges.length) return '<p class="muted">No ties yet. They form as time passes near the party, from the people and factions boxes on their pages, or from a written history.</p>';
  const W = 960;
  const pos = ST.layoutWeb(g, W, 600, g.nodes.length);
  const H = Math.ceil(pos.height);
  const label = id => ST.tieInfo(PEOPLE(), id).name;
  const kinds = [...new Set(g.edges.map(e => e.kind))];
  return `<svg class="web" viewBox="0 0 ${W} ${H}" role="img" aria-label="Ties between people and factions">
    ${g.edges.map(e => { const a = pos.get(e.a), b = pos.get(e.b); return `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="${TIE_COLOURS[e.kind] || '#888'}" stroke-width="2"><title>${esc(`${e.a} ${label(e.kind)} ${e.b}`)}</title></line>`; }).join('')}
    ${g.nodes.map(n => { const p = pos.get(n.id); const id = resolve(n.id); return `<g class="web-node ${n.kind}"${id ? ` data-id="${esc(id)}"` : ''} transform="translate(${p.x.toFixed(1)},${p.y.toFixed(1)})">${n.kind === 'faction' ? '<rect x="-7" y="-7" width="14" height="14" rx="2"/>' : '<circle r="7"/>'}<text y="-11" text-anchor="middle">${esc(n.id)}</text></g>`; }).join('')}
  </svg>
  <p class="web-key">${kinds.map(k => `<span><i style="background:${TIE_COLOURS[k] || '#888'}"></i>${esc(label(k))}</span>`).join('')}<span><i class="sq"></i>faction</span></p>`;
}

function renderLegends() {
  const w = world();
  const L = (state.legends ||= { tab: 'subjects', pick: null, q: '', year: null });
  const at = partyPlace()?.map || null;
  const seen = w.chronicle.filter(e => seesEntry(e, w, at));
  const book = ST.legendsIndex(seen);
  const link = t => resolve(t) && !hiddenPage(state.pages.get(resolve(t))) ? `<a class="wikilink" data-id="${esc(resolve(t))}">${esc(t)}</a>` : esc(t);
  const q = L.q.toLowerCase();
  const group = (key, label) => {
    const rows = [...book[key]].filter(([t]) => !q || t.toLowerCase().includes(q)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return rows.length ? `<h3>${label}</h3><ul>${rows.slice(0, 80).map(([t, n]) => `<li><a href="#" data-legend="${esc(t)}" class="${L.pick === t ? 'on' : ''}">${esc(t)}</a> <span class="muted">${n}</span></li>`).join('')}</ul>` : '';
  };
  // Opens on where the party is, until something else is picked.
  if (L.pick == null) { const here = partyPlace()?.title; if (here && book.places.has(here)) L.pick = here; }
  const stranger = L.pick && book.strangers.has(L.pick) && !resolve(L.pick);
  const years = [...new Set(seen.filter(e => e.kind !== 'festival').map(e => ST.dateOf(cal(), e.day).year))].sort((a, b) => b - a);
  if (L.year == null || !years.includes(L.year)) L.year = years[0] ?? null;
  let body = '';
  if (L.tab === 'subjects') {
    const mine = !L.pick ? [] : (stranger ? seen.filter(e => [].concat(e.locals || []).includes(L.pick)).sort((a, b) => a.day - b.day) : ST.historyOf(seen, [L.pick])).filter(e => e.kind !== 'festival').reverse();
    const ties = L.pick ? [...ST.tiesOf(w, L.pick).map(t => `${ST.tieInfo(PEOPLE(), t.kind).name} ${link(t.to)}`), ...(w.factions?.[L.pick]?.ties || []).map(t => `${({ ally: 'ally of', rival: 'rival of', enemy: 'at war with' })[t.kind] || t.kind} ${link(t.to)}`)] : [];
    body = `<div class="legends-cols"><aside class="legend-list"><input id="legend-q" type="search" placeholder="Find a place, person or faction" value="${esc(L.q)}">
        ${group('places', 'Places')}${group('people', 'People')}${group('factions', 'Factions')}${!book.places.size && !book.people.size && !book.factions.size ? '<p class="muted">Nothing yet.</p>' : ''}</aside>
      <section class="legend-detail">${L.pick ? `<h2>${stranger && state.dm ? `<a class="wikilink missing new-npc" data-target="${esc(L.pick)}" data-local="1" data-npc-entry="${esc(mine.at(-1)?.id || '')}" title="No page yet: click to make ${esc(L.pick)} an NPC from what the chronicle knows">${esc(L.pick)}</a>` : link(L.pick)}</h2>
        ${stranger && state.dm ? '<p class="hint" style="margin:0 0 6px">No page yet. Click the name to make them an NPC from what the chronicle knows.</p>' : ''}
        ${state.dm && ties.length ? `<p class="muted">${ties.join(' · ')}</p>` : ''}
        <ul class="chronicle">${mine.map(e => entryRow(e, { actions: false })).join('')}</ul>` : '<p class="muted">Pick a place, person or faction to read everything the chronicle remembers about it.</p>'}</section></div>`;
  } else if (L.tab === 'years') {
    const ents = seen.filter(e => e.kind !== 'festival' && ST.dateOf(cal(), e.day).year === L.year).sort((a, b) => a.day - b.day);
    const months = [];
    for (const e of ents) { const d = ST.dateOf(cal(), e.day); const m = d.holy ? d.holy : cal().months[d.month]?.name; if (months.at(-1)?.name !== m) months.push({ name: m, list: [] }); months.at(-1).list.push(e); }
    body = `<div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:10px">${years.map(y => `<button class="btn small${y === L.year ? ' primary' : ''}" data-year="${y}">${esc(cap(ST.yearName(y)))}</button>`).join('')}</div>
      ${months.length ? months.map(m => `<h3>${esc(m.name)}</h3><ul class="chronicle">${m.list.map(e => entryRow(e, { actions: false })).join('')}</ul>`).join('') : '<p class="muted">Nothing recorded.</p>'}`;
  } else body = webSVG();
  $('#view').innerHTML = `<div class="wide legends">
    <div class="row" style="margin-bottom:6px"><h1 style="flex:1;margin:0;font:600 32px var(--serif)">Legends</h1>
      ${state.dm && state.data.people ? '<button class="btn dm-tool" id="worldgen-btn" title="Write the last ten years or so of a region\'s history, to review before keeping">Write a region\'s history…</button>' : ''}</div>
    <p class="hint" style="margin:0 0 12px">${state.dm ? 'Everything the chronicle remembers.' : 'Everything the party has heard of.'} ${seen.filter(e => e.kind !== 'festival').length} entries.</p>
    <div class="tabs legend-tabs">${[['subjects', 'Places, people and factions'], ['years', 'By year'], ['web', 'Ties']].map(([k, l]) => `<button data-ltab="${k}" class="${L.tab === k ? 'active' : ''}">${l}</button>`).join('')}</div>
    ${body}
    ${state.dm && (w.histories || []).length ? `<section class="dm-tool"><h2>Written histories</h2><ul>${w.histories.map(h => `<li>${esc(h.region)}: ${h.entries.length} entries, ${h.years} years <span class="muted">(written ${esc(h.made.slice(0, 10))})</span> <button class="btn small" data-unhistory="${esc(h.id)}">Undo</button></li>`).join('')}</ul></section>` : ''}
  </div>`;
  $$('[data-ltab]').forEach(b => b.onclick = () => { L.tab = b.dataset.ltab; renderLegends(); });
  $$('[data-legend]').forEach(a => a.onclick = e => { e.preventDefault(); L.pick = a.dataset.legend; renderLegends(); });
  $$('[data-year]').forEach(b => b.onclick = () => { L.year = Number(b.dataset.year); renderLegends(); });
  $$('.web-node[data-id]').forEach(n => n.onclick = () => openPage(n.dataset.id));
  const qi = $('#legend-q');
  if (qi) qi.oninput = () => { L.q = qi.value; clearTimeout(state.legendT); state.legendT = setTimeout(() => { renderLegends(); const i = $('#legend-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 200); };
  $('#worldgen-btn')?.addEventListener('click', worldgenDialog);
  $$('[data-unhistory]').forEach(b => b.onclick = () => unhistory(b.dataset.unhistory));
}

async function worldgenDialog() {
  const w = world();
  const regions = [...new Set(storyPlaces().map(p => regionOf(p.title)).filter(Boolean))].sort();
  if (!regions.length) return toast('No places on the map to write a history for.', true);
  const here = partyPlace() && regionOf(partyPlace().title);
  const done = new Set((w.histories || []).map(h => h.region));
  const r = await formDialog('Write a region\'s history', `
    <p class="muted" style="margin:0 0 8px">The last few years of a region: what happened in its places, the friendships, feuds and marriages of its people, and what its factions won and lost. You see it all before any of it is kept. Older history stays whatever the wiki says.</p>
    <div class="row"><label class="field" style="flex:1">Region<select name="region">${regions.map(x => `<option ${x === here ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
    <label class="field" style="width:110px">Years<input name="years" type="number" min="1" max="30" value="10"></label></div>
    ${done.size ? `<p class="hint" style="margin:0">Already written: ${esc([...done].join(', '))}.</p>` : ''}`, 'Write it');
  if (!r) return;
  const region = r.region, years = Math.max(1, Math.min(30, Number(r.years) || 10));
  const places = storyPlaces().filter(p => regionOf(p.title) === region);
  const inRegion = x => places.some(p => p.title === x.place);
  const ctx = { cal: cal(), data: state.data, world: w, places: places.map(p => ({ ...p, terrain: placeAnchor(p.title)?.terrain || [] })), people: simPeople().filter(p => p.major && !p.locked && !p.dead && inRegion(p)), factions: simFactions().filter(f => !f.locked && inRegion(f)) };
  let ents = ST.worldgen(ctx, years);
  const shown = () => ents.filter(e => !e.quiet);
  const quiet = ents.filter(e => e.quiet).length;
  const k = await formDialog(`${region}: the last ${years} years`, `
    <p class="muted" style="margin:0 0 8px">Untick anything you don't want. Public entries become things people in the region know about. ${quiet ? `${quiet} of its people also get traits.` : ''}</p>
    <div class="history-review">${shown().map((e, i) => `<label class="check"><input type="checkbox" name="h${i}" checked> <span><span class="ch-date">${esc(fmtDay(e.day))}</span> <b>${esc(e.title)}</b>${e.public ? '' : ' <span class="badge dm">DM only</span>'}<br><span class="muted">${esc(e.text)}</span></span></label>`).join('') || '<p class="muted">Nothing to write: the region has no settlements, people or factions on the map.</p>'}</div>`, 'Keep the ticked ones');
  if (!k) return;
  const kept = [...shown().filter((e, i) => k[`h${i}`]), ...ents.filter(e => e.quiet)];
  const before = ST.keepHistory(w, PEOPLE(), kept);
  const stored = kept.filter(e => !e.quiet).map(e => { const x = { ...e, tags: [...e.tags, 'worldgen'] }; delete x.apply; return x; });
  w.chronicle.push(...stored);
  (w.histories ||= []).push({ id: `hist${Date.now().toString(36)}`, region, years, made: new Date().toISOString(), entries: stored.map(e => e.id), before });
  await saveWorld();
  toast(`${stored.length} entries of ${region}'s history kept.`);
  renderLegends();
}
async function unhistory(id) {
  const w = world();
  const h = (w.histories || []).find(x => x.id === id);
  if (!h || !(await confirmDialog(`Undo ${h.region}'s history?`, 'Its entries leave the chronicle, and the ties and traits it gave people and factions are put back as they were.', 'Undo it'))) return;
  const gone = new Set(h.entries);
  w.chronicle = w.chronicle.filter(e => !gone.has(e.id));
  ST.unkeepHistory(w, h.before);
  w.histories = w.histories.filter(x => x !== h);
  await saveWorld();
  renderLegends();
}

// ---------- adding to a place, and trade ----------
// On a settlement's page the DM can add a tavern, market or temple (each saved as its own page under the place), a
// quirk or a feature, and turn the people under "Who is there" into NPC pages. Trade goods can be bought and sold
// there at prices the economy sets; what the party carries goes in the party inventory as cargo.

const plural = (u, n) => n === 1 ? u : /(s|sh|ch|x)$/.test(u) ? `${u}es` : `${u}s`;
/** Add a line at the end of a "## heading" section, making the section (before the DM notes) if it isn't there. */
function addToSection(body, heading, md) {
  const lines = body.split('\n');
  const at = lines.findIndex(l => l.trim().toLowerCase() === `## ${heading}`.toLowerCase());
  if (at >= 0) {
    let end = lines.findIndex((l, i) => i > at && (/^#{1,2} /.test(l) || l.startsWith(':::')));
    if (end < 0) end = lines.length;
    while (end > at + 1 && !lines[end - 1].trim()) end--;
    lines.splice(end, 0, md);
    return lines.join('\n');
  }
  const dm = lines.findIndex(l => l.startsWith(':::dm'));
  const block = [`## ${heading}`, '', md, ''];
  if (dm >= 0) lines.splice(dm, 0, ...block); else lines.push('', ...block);
  return lines.join('\n');
}
/** Add a line to the page's last DM block, or start one at the end. */
function addToDm(body, md) {
  const lines = body.split('\n');
  let open = -1;
  for (let i = 0; i < lines.length; i++) if (lines[i].startsWith(':::dm')) open = i;
  const close = open >= 0 ? lines.findIndex((l, i) => i > open && l.trim() === ':::') : -1;
  if (close > 0) { lines.splice(close, 0, md); return lines.join('\n'); }
  return `${body.replace(/\s*$/, '')}\n\n:::dm\n${md}\n:::\n`;
}
async function writeBody(p, body) {
  p.body = body;
  await attempt(() => api.pages.write(p.id, p.meta, p.body));
}
/** The place a page trades as: a settlement itself, or the settlement a market or tavern page sits under. */
function tradePlace(p) {
  if (p.meta.type !== 'location') return null;
  if (mapPoint(p) && storySettlement(p)) return p;
  // A market or tavern trades at its town's prices; a temple, an orphanage or a watchtower doesn't.
  if (![].concat(p.meta.tags || []).some(t => ['market', 'tavern', 'industry', 'warehouse', 'granary'].includes(t))) return null;
  const up = p.meta.parent && state.pages.get(resolve(p.meta.parent));
  return up && up.meta.type === 'location' && mapPoint(up) && storySettlement(up) ? up : null;
}

function placeToolsSection(p) {
  if (p.meta.type !== 'location' || !mapPoint(p) || !storySettlement(p) || !state.data.places) return '';
  return `<div class="place-tools dm-tool"><span class="muted">Add to ${esc(p.meta.title)}:</span>
    <button class="btn small" data-add-here="tavern" title="Generate a tavern here, saved as its own page">+ Tavern</button>
    <button class="btn small" data-add-here="market" title="Generate a market here, saved as its own page">+ Market</button>
    ${state.data.buildings ? '<button class="btn small" data-add-here="temple" title="Generate a temple or shrine of a church with a hold here">+ Temple</button>' : ''}
    <button class="btn small" data-add-here="quirk" title="Another quirk for the place">+ Quirk</button>
    ${state.data.buildings ? '<button class="btn small" data-add-here="feature" title="Something the place could have been built around">+ Feature</button>' : ''}
    ${state.data.buildings?.orphanage && ['town', 'city', 'capital'].includes(storySettlement(p)) ? '<button class="btn small" data-add-here="orphanage" title="An orphanage the town runs, with its children, its carer, a trouble and a secret">+ Orphanage</button>' : ''}
    ${state.data.buildings?.controlPoints && state.data.factions ? '<button class="btn small" data-add-here="control" data-sys="factions" title="An outpost, watchtower, quarry or magical industry near here that factions would fight to hold">+ Control point</button>' : ''}</div>`;
}

// Control points: places factions want to hold (outposts, watchtowers, quarries, magical industries, a market or
// tavern they could run). Whole towns are never held. world.control { [page title]: { kind, by, since } }.
const controlOf = title => state.saved?.world?.control?.[title] || null;
/** The map point and town of a page inside a place: the nearest place above it that has a pin. */
function placeAbove(p) {
  for (let q = p, i = 0; q && i < 8; q = q.meta.parent ? state.pages.get(resolve(q.meta.parent)) : null, i++) if (q.meta.type === 'location' && mapPoint(q)) return { title: q.meta.title, map: mapPoint(q) };
  return null;
}
function controlPoints() {
  return Object.entries(state.saved?.world?.control || {}).map(([title, c]) => {
    const pg = state.pages.get(resolve(title));
    const at = pg && placeAbove(pg);
    return pg && at && !isLocked(pg) ? { title: pg.meta.title, kind: c.kind, by: c.by || null, map: at.map, place: at.title === pg.meta.title ? null : at.title } : null;
  }).filter(Boolean);
}
async function addControlPoint(p) {
  const d = state.data;
  const kinds = [...new Set((d.buildings.controlPoints || []).map(c => c.kind))];
  const facs = factionPages().filter(f => !hiddenPage(f) || state.dm).map(f => f.meta.title);
  const r = await formDialog(`A control point near ${p.meta.title}`, `
    <div class="row"><label class="field" style="flex:1">What kind<select name="kind"><option value="any">Any</option>${kinds.map(k => `<option value="${esc(k)}">${esc(cap(k))}</option>`).join('')}</select></label>
    <label class="field" style="flex:1">Held by<input name="by" placeholder="No one, or a faction"></label></div>
    <label class="check"><input type="checkbox" name="pick" checked> If no one is named, a faction with a hold nearby may already have it</label>`, 'Add it', form => attachPicker($('input[name=by]', form), () => facs.map(t => ({ value: t }))));
  if (!r) return null;
  const taken = Object.values(world().control || {}).filter(c => c.near === p.meta.title).map(c => c.kind);
  const c = PL.generateControlPoint(d, { name: p.meta.title }, r.kind, Math.random, taken);
  if (!c) return toast('There are no control points in the buildings list.', true);
  let by = r.by.trim() && state.pages.get(resolve(r.by.trim()))?.meta.title || null;
  if (!by && r.pick && Math.random() < 0.6) {
    const near = simFactions().filter(f => PL.milesBetween(f.map, mapPoint(p)) <= (d.factions?.sim?.pointMiles ?? 60));
    if (near.length) by = G.weighted(Math.random, near, f => 1 + (world().factions?.[f.title]?.influence?.[p.meta.title] || 0) / 10).title;
  }
  let title = c.name;
  for (let k = 2; resolve(title); k++) title = `${c.name} (${k})`;
  const id = await attempt(() => api.pages.create(title, { type: 'location', parent: p.meta.title, tags: ['control point', c.kind, 'generated'] }, PL.controlPointToMarkdown(c, p.meta.title, by)));
  if (!id) return null;
  state.pages.set(id, await api.pages.read(id));
  rebuildIndex();
  (world().control ||= {})[title] = { kind: c.kind, by, since: today(), near: p.meta.title };
  await saveWorld();
  await writeBody(p, addToSection(p.body, 'Nearby', `- **${cap(c.kind)}:** [[${title}]]${by ? `, held by [[${by}]]` : ''}`));
  return title;
}
/** On a page that is (or could be) a control point: who holds it, and a way to change that. Never a whole town. */
function controlSection(p) {
  if (!state.dm || p.meta.type !== 'location' || !state.saved?.world || !state.data.factions || storySettlement(p)) return '';
  const c = controlOf(p.meta.title);
  const link = t => resolve(t) ? `<a class="wikilink" data-id="${esc(resolve(t))}">${esc(t)}</a>` : esc(t);
  if (!c) return placeAbove(p) ? `<div class="place-tools dm-tool"><span class="muted">Factions don't fight over this place yet.</span><button class="btn small" id="control-make" title="Make it a control point: factions near it may try to claim or take it, and whoever holds it grows richer">Make it a control point</button></div>` : '';
  const fights = world().chronicle.filter(e => e.tags?.includes('control') && e.places[0] === p.meta.title).slice(-4).reverse();
  return `<section class="standing-box dm-tool control-box"><div class="row"><h2 style="flex:1;margin:0">Control point: ${esc(cap(c.kind || 'a hold'))}</h2>
      <button class="btn small" id="control-holder">Change holder…</button><button class="btn small" id="control-drop" title="Factions stop fighting over it">Not a control point</button></div>
    <p style="margin:6px 0 0">${c.by ? `Held by <b>${link(c.by)}</b> since ${esc(fmtDay(c.since, { short: true }))}. It adds to their wealth every month.` : 'No one holds it. Factions near it may try to claim it.'}</p>
    ${fights.length ? `<ul class="muted" style="margin:6px 0 0">${fights.map(e => `<li>${esc(fmtDay(e.day, { short: true }))}: ${esc(e.text)}</li>`).join('')}</ul>` : ''}</section>`;
}
function wireControl(p) {
  const set = async by => {
    const c = ((world().control ||= {})[p.meta.title] ||= { kind: (p.meta.tags || []).find(t => t !== 'control point' && t !== 'generated') || 'hold', since: today() });
    if (by !== undefined) { c.by = by; c.since = today(); }
    await saveWorld(); renderPage(p.id);
  };
  $('#control-make')?.addEventListener('click', () => set(undefined));
  $('#control-drop')?.addEventListener('click', async () => { delete world().control[p.meta.title]; await saveWorld(); renderPage(p.id); });
  $('#control-holder')?.addEventListener('click', async () => {
    const facs = factionPages().map(f => f.meta.title);
    const r = await formDialog(`Who holds ${p.meta.title}?`, `<label class="field">Held by<input name="by" value="${esc(controlOf(p.meta.title)?.by || '')}" placeholder="No one"></label>`, 'Save', form => attachPicker($('input[name=by]', form), () => facs.map(t => ({ value: t }))));
    if (!r) return;
    const by = r.by.trim() ? state.pages.get(resolve(r.by.trim()))?.meta.title : null;
    if (r.by.trim() && !by) return toast(`There is no faction page called ${r.by.trim()}.`, true);
    await set(by);
  });
}

// Orphanages and children.
async function addOrphanage(p) {
  const d = state.data;
  const o = PL.generateOrphanage(d, { name: p.meta.title });
  let title = o.name;
  for (let k = 2; resolve(title); k++) title = `${o.name} (${k})`;
  const n = G.generateNPC(d, { wiki: wikiTitles(), role: /church/i.test(o.runBy) ? 'Priest' : 'City official', twist: 'none', style: placeAnchor(p.meta.title)?.style || '' });
  const carerId = !resolve(n.name) && await attempt(() => api.pages.create(n.name, { type: 'npc', rank: n.rank, parent: title, origin: S.originFor(n.role, n.class), tags: ['generated', 'carer'] }, G.npcToMarkdown(n) + `
## At the orphanage

Runs [[${title}]] for ${o.runBy}.
`));
  if (carerId) state.pages.set(carerId, await api.pages.read(carerId));
  const avoid = [...state.data.reservedNames || []];
  const kids = [];
  for (let i = 0; i < o.count; i++) {
    const c = G.generateChild(d, { orphan: true, avoid: [...avoid, ...kids.map(k => k.first)], style: placeAnchor(p.meta.title)?.style || '' });
    kids.push(c);
  }
  const md = PL.orphanageToMarkdown(o, p.meta.title, carerId ? `[[${n.name}]]` : n.name, kids.map(c => ({ name: c.name, age: c.age, line: `${cap(c.temperament)}. Wants ${c.wants}. Lost their family to ${c.cause}.` })));
  const id = await attempt(() => api.pages.create(title, { type: 'location', parent: p.meta.title, tags: ['orphanage', 'generated'] }, md));
  if (!id) return null;
  state.pages.set(id, await api.pages.read(id));
  rebuildIndex();
  await writeBody(p, addToSection(p.body, 'In town', `- **Orphanage:** [[${title}]]`));
  return title;
}
/** Under "Children" on an orphanage's page, a button beside each child who isn't a page yet. */
/** In stat blocks, the class in "Bronze rank paladin 7" links to its class page. */
function linkStatClasses(root) {
  const names = Object.keys(CR.CLASSES).filter(n => resolve(n));
  if (!names.length) return;
  const re = new RegExp(`\\b(${names.join('|')})(?= \\d)`, 'i');
  for (const el of $$('.statblock em, .mstat .sb-sub', root)) {
    if (el.querySelector('a[data-class-link]')) continue;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      const m = t.nodeValue.match(re);
      if (!m || t.parentElement.closest('a')) continue;
      const a = document.createElement('a');
      a.className = 'wikilink class-link'; a.dataset.id = resolve(names.find(n => n.toLowerCase() === m[1].toLowerCase())); a.dataset.classLink = '1';
      a.title = `The ${m[1].toLowerCase()} class page: features, level table and subclasses`; a.textContent = m[1];
      const rest = t.splitText(m.index); rest.nodeValue = rest.nodeValue.slice(m[1].length);
      rest.parentNode.insertBefore(a, rest);
      break;
    }
  }
}
function wireChildren(p) {
  if (!state.dm || p.meta.type !== 'location' || !state.data.children) return;
  const h = [...$$('.prose h2')].find(x => x.textContent.trim().toLowerCase() === 'children');
  const ul = h?.nextElementSibling;
  if (!ul || ul.tagName !== 'UL') return;
  for (const li of ul.children) {
    if (li.querySelector('a.wikilink')) continue;
    const m = li.textContent.match(/^(.+?) \((\d+)\): (.*)$/);
    if (!m || resolve(m[1])) continue;
    const b = document.createElement('button');
    b.className = 'btn small make-npc'; b.textContent = 'Make NPC'; b.title = `Make ${m[1]} an NPC page: a normal-rank child`;
    b.onclick = () => makeOrphanNpc(p, m[1], Number(m[2]), m[3]);
    li.append(' ', b);
  }
}
async function makeOrphanNpc(p, name, age, line) {
  if (resolve(name)) return toast(`There is already a page called ${name}.`, true);
  const c = G.generateChild(state.data, { orphan: true, age, surname: name.split(' ').slice(1).join(' ') });
  c.name = name; c.first = name.split(' ')[0];
  const m = line.match(/^(.+?)\. Wants (.+?)\. Lost their family to (.+?)\.$/);
  if (m) { c.temperament = m[1].toLowerCase(); c.wants = m[2]; c.cause = m[3]; }
  await attempt(async () => {
    const id = await api.pages.create(name, { type: 'npc', rank: 'Normal', parent: p.meta.title, tags: ['generated', 'child', 'orphan'], age: c.age }, G.childToMarkdown(c, { orphanage: p.meta.title }));
    state.pages.set(id, await api.pages.read(id));
    rebuildIndex();
    if (state.data.people) { ST.person(world(), name).traits = ST.rollTraits(PEOPLE(), Math.random); await saveWorld(); }
    const re = new RegExp(`\\*\\*${reEsc(name)}\\*\\* \\(`);
    if (re.test(p.body)) await writeBody(p, p.body.replace(re, `[[${name}]] (`));
    renderTree();
    toast(`${name} is an NPC page now.`);
    renderPage(p.id);
  });
}
/** A child for an NPC: their family name and people, a tie both ways, and (optionally) a second parent. */
async function addChildDialog(p) {
  const npcs = npcPages().map(x => x.meta.title).filter(t => t !== p.meta.title);
  const surname = p.meta.title.split(' ').length > 1 ? p.meta.title.split(' ').slice(1).join(' ') : '';
  const people = (p.body.match(/humanoid \(([^)]+)\)/) || [])[1];
  const peopleName = (state.data.peoples?.peoples || []).find(x => x.name === people)?.name;
  const c0 = G.generateChild(state.data, { surname, people: peopleName, avoid: [...state.data.reservedNames || []] });
  const r = await formDialog(`A child for ${p.meta.title}`, `
    <div class="row"><label class="field" style="flex:1">Name<input name="name" value="${esc(c0.name)}" required></label>
    <label class="field" style="width:110px">Age<input name="age" type="number" min="${state.data.children?.ages?.[0] ?? 1}" max="${state.data.children?.ages?.[1] ?? 17}" value="${c0.age}"></label></div>
    <label class="field">Other parent (optional)<input name="other" placeholder="An NPC page"></label>
    <p class="muted" style="margin:4px 0 0">Under 18, so Normal rank, with no essences.</p>`, 'Make the child', form => attachPicker($('input[name=other]', form), () => npcs.map(t => ({ value: t }))));
  if (!r) return;
  const name = r.name.trim().replace(/\s+/g, ' ');
  if (!name || resolve(name)) return toast(`There is already a page called ${name}.`, true);
  const other = r.other.trim() && state.pages.get(resolve(r.other.trim()))?.meta.title;
  const c = { ...c0, name, first: name.split(' ')[0], age: Math.max(1, Math.min(17, Number(r.age) || c0.age)) };
  const home = npcHome(p);
  const parents = [p.meta.title, ...(other ? [other] : [])];
  await attempt(async () => {
    const id = await api.pages.create(name, { type: 'npc', rank: 'Normal', parent: p.meta.parent || home?.title || undefined, tags: ['generated', 'child'], age: c.age }, G.childToMarkdown(c, { parents, home: home?.title }));
    state.pages.set(id, await api.pages.read(id));
    rebuildIndex();
    if (state.data.people) {
      ST.person(world(), name).traits = ST.rollTraits(PEOPLE(), Math.random);
      for (const t of parents) ST.setTie(world(), PEOPLE(), t, name, 'parent', today());
      await saveWorld();
    }
    renderTree();
    toast(`${name} is ${p.meta.title}'s child now.`);
    renderPage(p.id);
  });
}

async function addVenue(p, kind) {
  const d = state.data;
  const opts = { where: p.meta.title, whereMeta: p.meta, wiki: wikiTitles() };
  const r = kind === 'tavern' ? G.generateTavern(d, opts) : G.generateMarket(d, opts);
  let title = r.name;
  for (let k = 2; resolve(title); k++) title = `${r.name} (${k})`;
  const people = ({ tavern: x => [x.owner], market: x => x.stalls.map(s => s.keeper) })[kind](r);
  for (const n of people) {
    if (!n || resolve(n.name)) continue;
    const id = await attempt(() => api.pages.create(n.name, { type: 'npc', rank: n.rank, parent: title, origin: S.originFor(n.cover?.role || n.role, n.class), tags: ['generated', n.role.toLowerCase()] }, G.npcToMarkdown(n)));
    if (id) state.pages.set(id, await api.pages.read(id));
  }
  rebuildIndex();
  const md = (kind === 'tavern' ? G.tavernToMarkdown : G.marketToMarkdown)(r, { linkPeople: true });
  const id = await attempt(() => api.pages.create(title, { type: 'location', parent: p.meta.title, tags: [kind, 'generated'], ...(kind === 'market' ? { rank: r.rank } : {}) }, md));
  if (!id) return null;
  state.pages.set(id, await api.pages.read(id));
  await writeBody(p, addToSection(p.body, 'In town', `- **${cap(kind)}:** [[${title}]]`));
  return title;
}
async function addTemple(p) {
  const d = state.data;
  const churches = factionPages().filter(f => /^church of/i.test(f.meta.title) && !hiddenPage(f))
    .map(f => ({ title: f.meta.title, weight: 1 + (world().factions?.[f.meta.title]?.influence?.[p.meta.title] || 0) / 5 + (linksOf(f.body).some(t => t.toLowerCase() === p.meta.title.toLowerCase()) ? 3 : 0) }));
  const t = PL.generateTemple(d, { name: p.meta.title, settlement: storySettlement(p) }, churches);
  let title = t.name;
  for (let k = 2; resolve(title); k++) title = `${t.name} (${k})`;
  const n = G.generateNPC(d, { wiki: wikiTitles(), role: 'Priest', twist: 'none', style: placeAnchor(p.meta.title)?.style || '' });
  const priestId = !resolve(n.name) && await attempt(() => api.pages.create(n.name, { type: 'npc', rank: n.rank, parent: title, origin: S.originFor(n.role, n.class), tags: ['generated', 'priest'] }, G.npcToMarkdown(n)));
  if (priestId) state.pages.set(priestId, await api.pages.read(priestId));
  const id = await attempt(() => api.pages.create(title, { type: 'location', parent: p.meta.title, tags: ['temple', 'generated'] }, PL.templeToMarkdown(t, p.meta.title, priestId ? `[[${n.name}]]` : null)));
  if (!id) return null;
  state.pages.set(id, await api.pages.read(id));
  rebuildIndex();
  await writeBody(p, addToSection(p.body, 'In town', `- **${cap(t.size)}:** [[${title}]], of [[${t.church}]]`));
  return title;
}
async function addHere(p, what) {
  const made = await attempt(async () => {
    if (what === 'tavern' || what === 'market') return addVenue(p, what);
    if (what === 'temple') return addTemple(p);
    if (what === 'control') return addControlPoint(p);
    if (what === 'orphanage') return addOrphanage(p);
    if (what === 'quirk') {
      const q = PL.extraQuirk(state.data, p.meta.title, p.body);
      if (!q) return toast('No other quirk fits.', true);
      await writeBody(p, addToSection(p.body, 'Quirks', `- ${q}`));
      return 'a quirk';
    }
    if (what === 'feature') {
      const r = await formDialog(`A feature for ${p.meta.title}`, `<label class="field">What kind<select name="kind"><option value="any">Any</option><option value="decorative">Decorative</option><option value="defensive">Defensive</option><option value="important">Important: something the town lives off</option><option value="historical">Historical</option></select></label>`, 'Add it');
      if (!r) return null;
      const f = PL.placeFeature(state.data, p.meta.title, p.body, r.kind);
      if (!f) return toast('No other feature of that kind fits.', true);
      await writeBody(p, addToDm(addToSection(p.body, 'Features', `- **${cap(f.name.replace(/^The /, ''))}** *(${f.kind})*: ${f.text}`), `- **${cap(f.name.replace(/^The /, ''))}:** ${f.dm}`));
      return f.name.toLowerCase();
    }
  });
  if (!made) return;
  renderTree();
  toast(`Added ${made} to ${p.meta.title}.`);
  renderPage(p.id);
}

/** Under "Who is there", a button beside each person who isn't a page yet. */
function wireWhoIsThere(p) {
  if (!state.dm || p.meta.type !== 'location') return;
  const h = [...$$('.prose h2')].find(x => x.textContent.trim().toLowerCase() === 'who is there');
  const ul = h?.nextElementSibling;
  if (!ul || ul.tagName !== 'UL') return;
  for (const li of ul.children) {
    if (li.querySelector('a.wikilink')) continue;
    const m = li.textContent.trim().match(/^(.+?):\s*(.+?)\s*\(([^)]+)\)\s*$/);
    if (!m) continue;
    const b = document.createElement('button');
    b.className = 'btn small dm-tool make-npc';
    b.textContent = 'Make NPC';
    b.title = `Generate ${m[2]} as an NPC page under ${p.meta.title}`;
    b.onclick = () => makeListedNpc(p, m[1], m[2], m[3]);
    li.append(' ', b);
  }
}
async function makeListedNpc(p, role, name, people) {
  if (resolve(name)) return toast(`There is already a page called ${name}.`, true);
  const known = (state.data.peoples?.peoples || []).some(x => x.name === people);
  const n = G.generateNPC(state.data, { wiki: wikiTitles(), twist: 'none', ...(PL.npcRoleFor(role) ? { role: PL.npcRoleFor(role) } : {}), ...(known ? { people } : {}) });
  n.name = name;
  await attempt(async () => {
    const id = await api.pages.create(name, { type: 'npc', rank: n.rank, parent: p.meta.title, origin: S.originFor(n.role, n.class), tags: ['generated', role.toLowerCase()] },
      G.npcToMarkdown(n) + `\n## In ${p.meta.title}\n\n${cap(role)} of [[${p.meta.title}]].\n`);
    state.pages.set(id, await api.pages.read(id));
    if (state.data.people) { ST.person(world(), name).traits = ST.rollTraits(PEOPLE(), Math.random); await saveWorld(); }
    const esc2 = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const line = new RegExp(`(\\*\\*${esc2(cap(role))}:\\*\\* )${esc2(name)}( \\()`);
    if (line.test(p.body)) await writeBody(p, p.body.replace(line, `$1[[${name}]]$2`));
    rebuildIndex(); renderTree();
    toast(`${name} is an NPC page now, under ${p.meta.title}.`);
    renderPage(p.id);
  });
}

// Trade goods.
const cargo = () => partyItems().filter(x => x.cargo);
function tradeRows(place) {
  const m = placeMarket(place.meta.title);
  if (!m) return [];
  const s = state.saved?.world ? standingAt(place.meta.title) : { value: 0 };
  const t = s.value ? ST.tierFor(state.data.story, s.value) : null;
  return ST.tradePrices(state.data, m, m.now, t?.price || 0);
}
function tradeSection(p) {
  const place = tradePlace(p);
  if (!place || !state.data.factions?.econ?.prices) return '';
  const rows = tradeRows(place);
  if (!rows.length) return '';
  const held = cargo();
  const shown = rows.filter(r => r.local || held.some(c => c.cargo.good === r.good));
  const rest = rows.filter(r => !shown.includes(r));
  const row = r => { const h = held.find(c => c.cargo.good === r.good);
    return `<tr data-good="${esc(r.good)}"><td><b>${esc(cap(r.good))}</b> <span class="muted">per ${esc(r.unit)}</span></td><td>${esc(G.formatGp(r.buy))}</td><td>${esc(G.formatGp(r.sell))}</td>
      <td class="muted">${esc(r.notes.join(', '))}${r.pct && !r.notes.length ? `${r.pct > 0 ? '+' : ''}${r.pct}% (standing)` : ''}</td>
      <td><button class="btn small" data-trade="buy">Buy…</button>${h ? ` <button class="btn small" data-trade="sell" title="The party carries ${h.cargo.qty} ${esc(plural(h.cargo.unit, h.cargo.qty))}">Sell…</button>` : ''}</td></tr>`; };
  return `<section class="trade-box dm-tool"><h2 style="margin:0 0 4px">Trade goods${place !== p ? ` in ${esc(place.meta.title)}` : ''}</h2>
    <p class="hint" style="margin:0 0 6px">What the party pays to buy and gets to sell here today, from what ${esc(place.meta.title)} makes and buys in, its shortages and gluts, and the party's standing. Bought goods go in the party inventory as cargo.</p>
    <table class="trade-table"><tr><th>Good</th><th>Buy</th><th>Sell</th><th>Why</th><th></th></tr>${shown.map(row).join('')}</table>
    ${rest.length ? `<details><summary class="muted">Other goods (${rest.length})</summary><table class="trade-table">${rest.map(row).join('')}</table></details>` : ''}</section>`;
}
function wireTrade(p) {
  const place = tradePlace(p);
  if (!place) return;
  $$('[data-trade]').forEach(b => b.onclick = async () => {
    const r = tradeRows(place).find(x => x.good === b.closest('[data-good]').dataset.good);
    if (r && await (b.dataset.trade === 'buy' ? buyGoods : sellGoods)(place, r)) renderPage(p.id);
  });
}
async function buyGoods(place, r) {
  const f = await formDialog(`Buy ${r.good} in ${place.meta.title}`, `
    <p class="muted" style="margin:0 0 8px">${esc(G.formatGp(r.buy))} a ${esc(r.unit)}. Paid from the party purse: ${esc(purseText())}.</p>
    <div class="row"><label class="field" style="width:140px">How many ${esc(plural(r.unit, 2))}<input name="qty" type="number" min="1" value="10" required></label>
    <label class="field" style="width:160px">Price each, after haggling<input name="each" type="number" min="0" step="0.01" value="${r.buy}"></label></div>
    <p class="hint" id="trade-total"></p>`, 'Buy', form => {
    const total = () => { const q = Number($('input[name=qty]', form).value) || 0, e = Number($('input[name=each]', form).value) || 0; $('#trade-total', form).textContent = `Total ${G.formatGp(Math.max(1, Math.ceil(q * e)))}, rounded up to whole spirit coins.`; };
    form.oninput = total; total();
  });
  if (!f) return false;
  const qty = Math.max(1, Math.floor(Number(f.qty) || 0)), each = Math.max(0, Number(f.each) || 0);
  const total = Math.max(1, Math.ceil(qty * each));
  const purse = payFromPurse(total);
  if (!purse) return false;
  await savePurse(purse);
  const have = cargo().find(c => c.cargo.good === r.good);
  if (have) {
    const q = have.cargo.qty + qty;
    have.cargo.paid = Math.round(((have.cargo.paid * have.cargo.qty) + total) / q * 100) / 100;
    have.cargo.qty = q;
    have.name = `${cap(r.good)} (${q} ${plural(r.unit, q)})`;
    if (!have.from.split(', ').includes(place.meta.title)) have.from = `${have.from}, ${place.meta.title}`;
  } else partyItems().push({ name: `${cap(r.good)} (${qty} ${plural(r.unit, qty)})`, from: place.meta.title, added: new Date().toISOString().slice(0, 10), cargo: { good: r.good, unit: r.unit, qty, paid: Math.round(total / qty * 100) / 100 } });
  await savePartyItems();
  toast(`Bought ${qty} ${plural(r.unit, qty)} of ${r.good} for ${G.formatGp(total)}.`);
  return true;
}
async function sellGoods(place, r) {
  const have = cargo().find(c => c.cargo.good === r.good);
  if (!have) return false;
  const f = await formDialog(`Sell ${r.good} in ${place.meta.title}`, `
    <p class="muted" style="margin:0 0 8px">${esc(G.formatGp(r.sell))} a ${esc(r.unit)} here. The party carries ${have.cargo.qty} ${esc(plural(r.unit, have.cargo.qty))}, bought at about ${esc(G.formatGp(have.cargo.paid))} each.</p>
    <div class="row"><label class="field" style="width:140px">How many<input name="qty" type="number" min="1" max="${have.cargo.qty}" value="${have.cargo.qty}" required></label>
    <label class="field" style="width:160px">Price each, after haggling<input name="each" type="number" min="0" step="0.01" value="${r.sell}"></label></div>`, 'Sell');
  if (!f) return false;
  const qty = Math.max(1, Math.min(have.cargo.qty, Math.floor(Number(f.qty) || 0))), each = Math.max(0, Number(f.each) || 0);
  const total = Math.floor(qty * each);
  const profit = total - Math.round(qty * have.cargo.paid);
  have.cargo.qty -= qty;
  if (have.cargo.qty <= 0) partyItems().splice(partyItems().indexOf(have), 1);
  else have.name = `${cap(r.good)} (${have.cargo.qty} ${plural(r.unit, have.cargo.qty)})`;
  await savePartyItems();
  if (total > 0) await addToPurse(total, `selling ${r.good} in ${place.meta.title}`);
  toast(`Sold ${qty} ${plural(r.unit, qty)} of ${r.good} for ${G.formatGp(total)}: ${profit >= 0 ? `${G.formatGp(profit) === 'free' ? 'no' : G.formatGp(profit)} profit` : `a loss of ${G.formatGp(-profit)}`}.`);
  return true;
}

// ---------- generators ----------

// The launcher: every generator in one grid, grouped, with a search box. Tabs open in the generator screen; page
// tools (a temple, an orphanage, a child...) ask which page they're for, then run there; sea places open the map.
const GEN_LAUNCH = [
  ['People', [
    { tab: 'npc', label: 'NPC', text: 'Anyone the party meets: looks, voice, rank, class, a secret' },
    { page: 'child', sys: 'towntools', label: 'A child', text: 'A son or daughter for an NPC page, with their family name and people', need: d => d.children },
    { quick: true, label: 'Quick rolls', text: 'A name, a trinket, what someone is doing, a smell or sound (F2)' },
  ]],
  ['Places', [
    { tab: 'visit', label: 'Prep a visit', text: 'Everything a town visit needs in one go: tavern, market, board, faces, rumours' },
    { tab: 'tavern', label: 'Tavern', text: 'An inn with its owner, menu, prices, regulars and goings-on' },
    { tab: 'market', label: 'Market', text: 'Stalls, keepers and price lists, by the size of the place' },
    { tab: 'auction', sys: 'auction', label: 'Auction house', text: 'Lots, rival bidders and the auctioneer' },
    { page: 'temple', sys: 'towntools', label: 'Temple', text: 'A temple or shrine of a church with a hold in a town', need: d => d.buildings },
    { page: 'orphanage', sys: 'towntools', label: 'Orphanage', text: 'Its children, its carer, a trouble and a secret', need: d => d.buildings?.orphanage },
    { page: 'feature', sys: 'towntools', label: 'Place feature', text: 'Something a town could have been built around', need: d => d.buildings },
    { page: 'quirk', sys: 'towntools', label: 'Town quirk', text: 'One more odd custom or habit for a place' },
    { page: 'control', sys: 'factions', label: 'Control point', text: 'An outpost, quarry or watchtower factions would fight over', need: d => d.buildings?.controlPoints && d.factions },
    { sea: true, label: 'Sea places', text: 'Islands, wrecks and reefs for the sea in view on the World map', need: d => d.places },
    { tab: 'astral', sys: 'astral', label: 'Astral space', text: 'A mapped dungeon of rooms, guardians and treasure' },
  ]],
  ['Fights and loot', [
    { tab: 'encounter', label: 'Encounter', text: 'A balanced fight with what the monsters want, the ground and a way out' },
    { tab: 'treasure', label: 'Treasure', text: 'A hoard or one creature\'s pockets, by rank, into the purse in one click' },
  ]],
  ['Story', [
    { tab: 'contracts', sys: 'contracts', label: 'Contracts', text: 'An Adventure Society board of notices and bounties' },
    { tab: 'travel', sys: 'travel', label: 'Travel', text: 'Day-by-day journey events, weather and finds' },
    { tab: 'words', sys: 'hooks', label: 'Word bank', text: 'A who, a what and a where to spin an idea from' },
  ]],
];
const launchItems = () => GEN_LAUNCH.map(([group, items]) => [group, items.filter(x => (!x.sys || sysOn(x.sys)) && (!x.need || x.need(state.data)))]).filter(([, items]) => items.length);
const launchKey = x => x.tab || (x.page && `page:${x.page}`) || (x.sea && 'sea') || 'quick';

function launcherHTML() {
  return `<div class="launcher">
    <input id="launch-q" type="search" placeholder="Find a generator…" autocomplete="off">
    ${launchItems().map(([group, items]) => `<section class="launch-group"><h3>${esc(group)}</h3><div class="launch-grid">${items.map(x => `
      <button class="launch-card" data-launch="${esc(launchKey(x))}"><b>${esc(x.label)}</b><span>${esc(x.text)}</span>${x.page ? '<em>on a page</em>' : x.sea ? '<em>on the map</em>' : ''}</button>`).join('')}</div></section>`).join('')}
    <p class="hint">Tip: every place page also has <b>Roll here</b> in its DM strip, and F2 opens quick rolls anywhere.</p></div>`;
}

function wireLauncher() {
  const q = $('#launch-q');
  const filter = () => {
    const t = q.value.trim().toLowerCase();
    $$('.launch-card').forEach(c => { c.hidden = !!t && !c.textContent.toLowerCase().includes(t); });
    $$('.launch-group').forEach(s => { s.hidden = !$$('.launch-card', s).some(c => !c.hidden); });
  };
  q.oninput = filter;
  // Enter opens the best match: a card whose name matches before one whose description does.
  q.onkeydown = e => {
    if (e.key !== 'Enter') return;
    const t = q.value.trim().toLowerCase(), shown = $$('.launch-card').filter(c => !c.hidden);
    (shown.find(c => $('b', c).textContent.toLowerCase().includes(t)) || shown[0])?.click();
  };
  $$('.launch-card').forEach(c => c.onclick = () => launch(c.dataset.launch));
  q.focus();
}

async function launch(key) {
  const g = state.gen;
  if (key === 'quick') return toggleQuick();
  if (key === 'sea') { await go({ kind: 'map' }); return $('#map-sea')?.click(); }
  if (!key.startsWith('page:')) { g.tab = key; return renderGenerators(); }
  const what = key.slice(5);
  const pages = what === 'child' ? npcPages().filter(p => !isLocked(p))
    : [...state.pages.values()].filter(p => p.meta.type === 'location' && mapPoint(p) && storySettlement(p) && !isLocked(p)
      && (what !== 'orphanage' || ['town', 'city', 'capital'].includes(storySettlement(p))));
  if (!pages.length) return toast(what === 'child' ? 'There are no NPC pages yet.' : 'No settlement on the map fits yet.', true);
  const item = GEN_LAUNCH.flatMap(([, xs]) => xs).find(x => x.page === what);
  const r = await formDialog(item.label, `<label class="field">${what === 'child' ? 'Whose child' : 'Which place'}<select name="p">${pages.map(p => p.meta.title).sort((a, b) => a.localeCompare(b)).map(t => `<option>${esc(t)}</option>`).join('')}</select></label>`, 'Go');
  const p = r && state.pages.get(resolve(r.p));
  if (!p) return;
  await openPage(p.id);
  return what === 'child' ? addChildDialog(p) : addHere(p, what);
}

function renderGenerators() {
  const g = state.gen;
  const d = state.data;
  if (!d.essences || !d.monsters || !d.astral || !d.npc) {
    $('#view').innerHTML = '<div class="page empty">Generator lists are missing or broken. Check them under Generator lists.</div>';
    return;
  }
  const TAB_SYS = { astral: 'astral', auction: 'auction', contracts: 'contracts', travel: 'travel', words: 'hooks' };
  if (TAB_SYS[g.tab] && !sysOn(TAB_SYS[g.tab])) g.tab = 'npc';
  const essenceOpts = `<option value="any">Random</option>${G.essenceThemes(d).map(t => `<option>${esc(t)}</option>`).join('')}`;
  const lvl = g.opts.level ?? partyLevel();
  const size = g.opts.partySize ?? (pcs().length >= 2 ? Math.min(20, pcs().length) : 4);
  const forms = {
    npc: `<div class="row">
      ${whereField()}
      <label class="field">Rank<select name="rank"><option value="any">Random</option>${G.RANKS.slice(0, 5).map(r => `<option>${r}</option>`).join('')}</select></label>
      <label class="field">Role<select name="role"><option value="any">Random</option>${d.npc.roles.map(r => `<option>${esc(r.name)}</option>`).join('')}</select></label>
      <label class="field">People<select name="people"><option value="any">Random</option>${d.peoples.peoples.map(p => `<option>${esc(p.name)}</option>`).join('')}<option>Outworlder</option></select></label>
      <label class="field">Class<select name="class"><option value="any">Random</option>${d.classes.classes.map(c => `<option>${esc(c.name)}</option>`).join('')}</select></label>
      <label class="field" title="A hidden truth that only shows in DM mode">Secret<select name="twist"><option value="any">Sometimes</option><option value="none">None</option>${(d.npc.twists || []).map(t => `<option>${esc(t.name)}</option>`).join('')}</select></label>
      <span class="spacer"></span><button class="btn primary" type="submit">Generate NPC</button></div>`,
    astral: `<div class="row">
      <label class="field" style="width:110px">Party level<input name="level" type="number" min="1" max="20" value="${lvl}"></label>
      <label class="field" style="width:110px">Party size<input name="partySize" type="number" min="1" max="20" value="${size}"></label>
      <label class="field">Essence theme<select name="theme">${essenceOpts}</select></label>
      ${(d.astral?.environments || []).length ? `<label class="field">Environment<select name="environment"><option value="any">Random</option>${[...d.astral.environments].sort((x, y) => x.name.localeCompare(y.name)).map(e => `<option>${esc(e.name)}</option>`).join('')}</select></label>` : ''}
      <label class="field">Size<select name="size"><option value="any">Random</option><option value="small">Small (5–6 rooms)</option><option value="medium">Medium (7–9)</option><option value="large">Large (10–13)</option></select></label>
      <span class="spacer"></span><button class="btn primary" type="submit">Generate astral space</button></div>`,
    encounter: `<div class="row">
      <label class="field" style="width:110px">Party level<input name="level" type="number" min="1" max="20" value="${lvl}"></label>
      <label class="field" style="width:110px">Party size<input name="partySize" type="number" min="1" max="20" value="${size}"></label>
      <label class="field">Difficulty<select name="difficulty"><option value="low">Low</option><option value="moderate" selected>Moderate</option><option value="high">High</option></select></label>
      ${whereField({ terrains: true })}
      <label class="field">Essence theme<select name="theme">${essenceOpts}</select></label>
      <span class="spacer"></span><button class="btn primary" type="submit">Generate encounter</button></div>`,
    market: `<div class="row">
      <label class="field">Where<select name="where"><option value="any">Anywhere</option>${wikiTitles().locations.map(l => `<option>${esc(l)}</option>`).join('')}</select></label>
      <label class="field" title="What the shops can sell: villages sell everyday goods, cities rarer magic">Settlement<select name="settlement"><option value="any">By place</option>${G.SETTLEMENTS.map(x => `<option value="${esc(x)}">${esc(G.settlementInfo(d, x)?.label || cap(x))}</option>`).join('')}</select></label>
      <label class="field">Kind<select name="kind"><option value="any">Random</option>${(d.market?.kinds || []).map(k => `<option>${esc(k.name)}</option>`).join('')}</select></label>
      <label class="field" title="The highest rank of essences, stones and cores on sale">Goods up to<select name="rank"><option value="any">By market</option>${['Iron', 'Bronze', 'Silver', 'Gold'].map(r => `<option>${r}</option>`).join('')}</select></label>
      <label class="field">Favoured affinity<select name="theme">${essenceOpts}</select></label>
      <span class="spacer"></span><button class="btn primary" type="submit">Generate market</button></div>`,
    auction: `<div class="row">
      <label class="field">Where<select name="where"><option value="any">Anywhere</option>${wikiTitles().locations.map(l => `<option>${esc(l)}</option>`).join('')}</select></label>
      <label class="field" title="Auction houses are found in cities. Somewhere smaller gets a travelling sale with city stock.">Stock of a<select name="settlement"><option value="any">By place</option>${Object.keys(d.auction?.stock || {}).map(x => `<option value="${esc(x)}">${esc(G.settlementInfo(d, x)?.label || cap(x))}</option>`).join('')}</select></label>
      <label class="field">Favoured affinity<select name="theme">${essenceOpts}</select></label>
      <span class="spacer"></span><button class="btn primary" type="submit">Generate auction</button></div>`,
    tavern: `<div class="row">
      <label class="field">Where<select name="where"><option value="any">Anywhere</option>${wikiTitles().locations.map(l => `<option>${esc(l)}</option>`).join('')}</select></label>
      <label class="field">Kind<select name="kind"><option value="any">Random</option>${(d.tavern?.kinds || []).map(k => `<option>${esc(k.name)}</option>`).join('')}</select></label>
      <label class="field">Prices<select name="quality"><option value="any">By kind</option>${['poor', 'modest', 'comfortable', 'wealthy'].map(q => `<option value="${q}">${cap(q)}</option>`).join('')}</select></label>
      <span class="spacer"></span><button class="btn primary" type="submit">Generate tavern</button></div>`,
    contracts: `<div class="row">
      <label class="field" title="Villages, towns and cities have a board. Hamlets, districts and wild places send people to the nearest branch.">Where<select name="where"><option value="any">Anywhere</option>${boardPlaces().map(l => `<option>${esc(l)}</option>`).join('')}</select></label>
      <label class="field" title="Bigger places post higher-tier contracts">Settlement<select name="settlement"><option value="any">By place</option>${G.SETTLEMENTS.map(x => `<option value="${esc(x)}">${esc(G.settlementInfo(d, x)?.label || cap(x))}</option>`).join('')}</select></label>
      <label class="field" title="Marks which contracts the party may take: its own rank or lower">Party rank<select name="partyRank"><option value="any">Don't mark</option>${G.CONTRACT_TIERS.map(r => `<option ${r === (G.rankForLevel(lvl) === 'Normal' ? 'Iron' : G.rankForLevel(lvl)) ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
      <label class="field">Kind<select name="type"><option value="any">Any</option>${(d.contracts?.types || []).map(t => `<option value="${esc(t.key)}">${esc(t.label)}</option>`).join('')}</select></label>
      <label class="field" style="width:100px">Notices<input name="count" type="number" min="1" max="12" placeholder="5–8"></label>
      <span class="spacer"></span><button class="btn primary" type="submit">Generate board</button></div>`,
    travel: d.travel?.categories ? travelForm(d, lvl, size) : '<p class="hint" style="margin:0">The travel list is missing. Reset "travel" under Generator lists to get it back.</p>',
    visit: `<div class="row">
      ${whereField({ label: 'Visiting' }).replace('<option value="any">Anywhere</option>', '')}
      <span class="spacer"></span><button class="btn primary" type="submit">Prep the visit</button></div>
      <div class="row visit-parts">${VISIT_PARTS.filter(([k]) => !VISIT_SYS[k] || sysOn(VISIT_SYS[k])).map(([k, label]) => `<label class="inline-check"><input type="checkbox" name="part-${k}" value="1" checked> ${esc(label)}</label>`).join('')}</div>
      <p class="hint" style="margin:6px 0 0">Rolls everything the party is likely to need there, in one go. Open any part in its own tab to change it or save it.</p>`,
    treasure: `<div class="row">
      <label class="field">Rank<select name="rank">${['Normal', 'Iron', 'Bronze', 'Silver', 'Gold', 'Diamond'].map(r => `<option ${r === G.rankForLevel(lvl) ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
      <label class="field">Kind<select name="kind"><option value="hoard">A hoard</option><option value="individual">One creature's pockets</option></select></label>
      <label class="field">Favoured affinity<select name="theme">${essenceOpts}</select></label>
      <span class="spacer"></span><button class="btn primary" type="submit">Roll treasure</button></div>`,
    words: `<div class="row" style="align-items:center">
      <p class="hint" style="margin:0;flex:1">A who, a what and a where, with two story hooks to spin an idea from. Click any word or hook to swap just that one, or pin a slot to keep it when you draw again. Now and then the who or the where is a person or place from your own wiki.</p>
      <button class="btn primary" type="submit">Draw</button></div>`,
  };
  $('#view').innerHTML = `<div class="wide">
    <div class="gen-head"><div class="tabs gen-tabs">
      <button data-tab="all" class="${g.tab === 'all' ? 'active' : ''}" title="Every generator, grouped">☰ All</button>
      <button data-tab="npc" class="${g.tab === 'npc' ? 'active' : ''}">NPC</button>
      <button data-tab="astral" data-sys="astral" class="${g.tab === 'astral' ? 'active' : ''}">Astral space</button>
      <button data-tab="encounter" class="${g.tab === 'encounter' ? 'active' : ''}">Encounter</button>
      <button data-tab="market" class="${g.tab === 'market' ? 'active' : ''}">Market</button>
      <button data-tab="auction" data-sys="auction" class="${g.tab === 'auction' ? 'active' : ''}">Auction house</button>
      <button data-tab="tavern" class="${g.tab === 'tavern' ? 'active' : ''}">Tavern</button>
      <button data-tab="contracts" data-sys="contracts" class="${g.tab === 'contracts' ? 'active' : ''}">Contracts</button>
      <button data-tab="treasure" class="${g.tab === 'treasure' ? 'active' : ''}">Treasure</button>
      <button data-tab="visit" class="${g.tab === 'visit' ? 'active' : ''}">Prep a visit</button>
      <button data-tab="travel" data-sys="travel" class="${g.tab === 'travel' ? 'active' : ''}">Travel</button>
      <button data-tab="words" data-sys="hooks" class="${g.tab === 'words' ? 'active' : ''}">Word bank</button>
    </div><button class="btn small" id="kept-btn" title="Rolls you kept for later">☆ Kept (${state.genRolls?.kept.length || 0})</button></div>
    ${g.tab === 'all' ? launcherHTML() : `<form class="gen-form" id="gen-form">${forms[g.tab]}</form>
    <div id="gen-result"></div>`}
  </div>`;
  $$('.tabs button[data-tab]').forEach(b => b.onclick = () => { g.tab = b.dataset.tab; renderGenerators(); });
  $('#kept-btn').onclick = openKept;
  // The tabs scroll sideways when the window is narrow; the mouse wheel scrolls them too.
  const tabsBar = $('.gen-tabs');
  tabsBar.onwheel = e => { if (tabsBar.scrollWidth > tabsBar.clientWidth && Math.abs(e.deltaY) > Math.abs(e.deltaX)) { e.preventDefault(); tabsBar.scrollLeft += e.deltaY; } };
  $('.active', tabsBar)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  if (g.tab === 'all') return wireLauncher();
  const form = $('#gen-form');
  // Restore last-used options for this tab. The travel form sets its own.
  if (g.tab !== 'travel') for (const [k, v] of Object.entries(g.opts[g.tab] || {})) if (form.elements[k]) form.elements[k].value = v;
  if (g.tab === 'visit') {
    const j = curJourney(), dest = j && journeyActive(j) && j.to?.name && state.pages.get(resolve(j.to.name))?.meta.title;
    if (!g.opts.visit?.where && dest && [...form.elements.where.options].some(o => o.value === dest)) form.elements.where.value = dest;
    const had = Object.keys(g.opts.visit || {}).some(k => k.startsWith('part-'));
    for (const [k] of VISIT_PARTS) if (form.elements[`part-${k}`] && had) form.elements[`part-${k}`].checked = !!g.opts.visit[`part-${k}`];
  }
  if (g.tab === 'travel' && d.travel?.categories) wireTravelForm(form);
  // Venues start where the party is, until a place has been picked on this tab.
  const here = partyPlace()?.title;
  if (['market', 'auction', 'tavern', 'contracts'].includes(g.tab) && !g.opts[g.tab]?.where && here && form.elements.where && [...form.elements.where.options].some(o => o.value === here)) form.elements.where.value = here;
  // Who lives there: a hint under the NPC form for the place picked.
  if (g.tab === 'npc' && form.elements.where) {
    const hint = () => {
      const at = rollPlace(form.elements.where.value);
      const t = at?.mix ? R.mixText(d, at.mix) : '';
      let h = $('#where-hint');
      if (!h) { h = document.createElement('p'); h.id = 'where-hint'; h.className = 'hint'; h.style.margin = '6px 0 0'; form.append(h); }
      h.textContent = t ? `People here are ${t}.${at.page ? ' The NPC is saved under this place.' : ''}` : '';
    };
    form.elements.where.addEventListener('change', hint);
    hint();
  }
  form.onsubmit = e => {
    e.preventDefault();
    if (g.tab === 'travel') return startJourney();
    const opts = Object.fromEntries(new FormData(form));
    g.opts[g.tab] = opts;
    if (opts.level) g.opts.level = Number(opts.level);
    if (opts.partySize) g.opts.partySize = Number(opts.partySize);
    runGenerator(opts);
  };
  showGenResult();
}

// ---------- rolling for a place ----------
// Any generator can be told where it is: a wiki place, a terrain, or the party's spot on the road. The place sets
// who lives there (data/rolls.json peopleMix: by region style, by terrain, or the page's own `peoples`) and the
// ground an encounter is fought on (the travel terrains, plus Streets inside a settlement).

/** A Where dropdown: Anywhere, the current journey's spot on the road, terrains (with terrains: true) and wiki places. */
function whereField({ terrains = false, name = 'where', label = 'Where' } = {}) {
  const d = state.data, j = curJourney();
  // Start on the party's own place, so Prep a visit and the rest don't open on the first of the alphabet.
  const here = !(j && journeyActive(j)) && label === 'Visiting' ? partyPlace()?.title : null;
  const road = j && journeyActive(j) ? `<option value="@road">On the road (${esc(G.journeyTitle(j).replace(/^Journey: /, ''))})</option>` : '';
  const T = terrains ? `<optgroup label="Terrain">${[...(d.travel?.terrains || []).map(t => t.name), d.rolls?.streets?.name].filter(Boolean).map(t => `<option value="~${esc(t)}">${esc(t)}</option>`).join('')}</optgroup>` : '';
  return `<label class="field" title="Where it is: who lives there and the ground follow the place">${esc(label)}<select name="${name}"><option value="any">Anywhere</option>${road}${T}<optgroup label="Places">${wikiTitles().locations.map(l => `<option${l === here ? ' selected' : ''}>${esc(l)}</option>`).join('')}</optgroup></select></label>`;
}

const nearestPin = at => pinnedPlaces().reduce((best, p) => !best || PL.milesBetween(at, p.map) < PL.milesBetween(at, best.map) ? p : best, null);

/** What a Where value means: { page, title, style, terrain?, terrains, settled, mix }, or null for Anywhere. */
function rollPlace(where) {
  const d = state.data;
  if (!where || where === 'any') return null;
  if (where.startsWith('~')) {
    const t = where.slice(1);
    return { page: false, title: '', terrain: t, terrains: [t], settled: t === d.rolls?.streets?.name, mix: R.peopleMix(d, { terrains: [t] }) };
  }
  if (where === '@road') {
    const j = curJourney();
    if (!j) return null;
    const at = journeyAt(j, G.journeyDone(j)) || j.from?.at;
    const near = at && nearestPin(at);
    const base = near ? rollPlace(near.title) : null;
    const t = j.days.at(-1)?.terrain || base?.terrains?.[0] || '';
    return { page: false, road: true, title: near ? `the road near ${near.title}` : 'the road', style: base?.style || '', terrain: t, terrains: t ? [t] : [], settled: false, mix: R.peopleMix(d, { style: base?.style, terrains: t ? [t] : [] }) };
  }
  const page = state.pages.get(resolve(where));
  if (!page) return null;
  const a = placeAnchor(page.meta.title);
  const style = a?.style || (a?.map ? PL.styleFor(d, a.map) : '');
  const terrains = R.placeTerrains(d, a?.terrain || []);
  let own = null;
  for (let q = page, i = 0; q && i < 8 && !own; q = q.meta.parent ? state.pages.get(resolve(q.meta.parent)) : null, i++) own = q.meta.peoples || null;
  const anchorPage = a && state.pages.get(resolve(a.title));
  const settled = !!anchorPage && ['capital', 'city', 'town', 'village'].includes(pinKind(anchorPage));
  return { page: true, title: page.meta.title, style, terrains, settled, mix: R.peopleMix(d, { style, terrains, own }) };
}

/** An encounter for a place or terrain, with the details that make it more than a list of monsters. */
function rollEncounter(opts) {
  const d = state.data;
  const at = rollPlace(opts.where);
  // Encounters saved before there were terrains named one of the old places around Greenstone.
  const legacy = (d.encounters?.environments || []).find(e => e.name === opts.environment);
  const streets = d.rolls?.streets?.name || '';
  let terrain = at?.terrain || '';
  if (!terrain && at) terrain = at.settled && (!at.terrains.length || G.chance(Math.random, 0.5)) ? streets : at.terrains.length ? G.pick(Math.random, at.terrains) : '';
  const themes = legacy ? legacy.themes : R.terrainThemes(d, terrain);
  const theme = opts.theme && opts.theme !== 'any' ? opts.theme : themes.length ? G.pick(Math.random, themes) : 'any';
  const kinds = (d.travel?.terrains || []).find(t => t.name === terrain)?.kinds || [];
  const e = G.generateEncounter(d, { ...opts, theme, kinds, situation: !d.rolls?.encounter });
  e.terrain = terrain;
  e.where = at?.page || at?.road ? at.title : legacy?.name || '';
  if (d.rolls?.encounter) e.situation = R.situationFor(d, terrain, Math.random, e);
  e.details = R.encounterDetails(d, e, { terrain });
  e.partyRank = bSettings().rankWard === 'off' ? null : partyRank(e.level);
  // The header says how hard it really is: what fit the budget, with any rank ward counted.
  const band = encounterBand(e), asked = e.difficulty;
  e.difficulty = band === 'trivial' ? 'low' : band === 'beyond high' ? 'high' : band;
  if (asked && asked !== e.difficulty) e.asked = asked;
  return e;
}

/** How hard a fight is now, by the 2024 budgets: Trivial, Low, Moderate, High or Beyond high. */
function encounterBand(e) {
  const b = k => G.xpBudget(e.level, e.partySize, k);
  const spent = e.spent + wardXp(e);
  return spent >= b('high') * 1.5 ? 'beyond high' : spent >= b('high') ? 'high' : spent >= b('moderate') ? 'moderate' : spent >= b('low') ? 'low' : 'trivial';
}
/** The party's lowest rank: their sheets', or what the encounter's level would be. */
const partyRank = level => { const r = pcs().map(p => G.pcRank(p.meta)).filter(Boolean); return r.length ? G.RANKS.find(x => r.includes(x)) : G.rankForLevel(level); };
/** Monsters whose rank ward will halve the party's damage take twice the hits, so they count double. */
function wardXp(e) {
  if (bSettings().rankWard === 'off') return 0;
  const pr = e.partyRank || partyRank(e.level);
  return (e.groups || []).filter(g => G.rankWardApplies(pr, g.rank)).reduce((t, g) => t + (Number(g.xp) || G.CR_XP[g.cr] || 0) * (Number(g.count) || 1), 0);
}
/** A bar of the XP spent against the low, moderate and high budgets, with Easier and Harder. */
function encounterBar(e) {
  if (!e.groups?.length) return '';
  const lo = G.xpBudget(e.level, e.partySize, 'low'), mid = G.xpBudget(e.level, e.partySize, 'moderate'), hi = G.xpBudget(e.level, e.partySize, 'high');
  const top = Math.max(hi * 1.5, e.spent + wardXp(e));
  const pct = x => `${Math.min(100, (x / top) * 100).toFixed(1)}%`;
  return `<div class="xp-bar-row"><div class="xp-bar" title="${e.spent} XP: ${encounterBand(e)}">
      <div class="xp-fill band-${encounterBand(e).replace(' ', '-')}" style="width:${pct(e.spent + wardXp(e))}"></div>
      ${[['Low', lo], ['Moderate', mid], ['High', hi]].map(([k, v]) => `<span class="xp-mark" style="left:${pct(v)}" title="${k}: ${v} XP"><i>${k}</i></span>`).join('')}
    </div>
    <span class="muted" title="${wardXp(e) ? 'Monsters behind a rank ward the party can\'t get past take twice the hits, so they count double' : ''}">${e.spent} XP${wardXp(e) ? ` (${e.spent + wardXp(e)} with the rank ward)` : ''}, ${encounterBand(e)}</span>
    <button class="btn small" id="enc-easier" title="One fewer creature">Easier</button><button class="btn small" id="enc-harder" title="One more creature">Harder</button></div>`;
}
/** After the DM changes who is in a fight: the drops and the difficulty follow. */
function settleEncounter(e) {
  const out = G.encounterDrops(state.data, e);
  const b = encounterBand(out);
  out.difficulty = b === 'trivial' ? 'low' : b === 'beyond high' ? 'high' : b;
  delete out.asked;
  return out;
}
function wireEncounter(box) {
  const g = state.gen, d = state.data;
  const set = e => { g.encounter = e; showGenResult(); };
  $$('[data-enc]', box).forEach(b => b.onclick = e => {
    e.preventDefault();
    const part = b.dataset.enc, r = g.encounter;
    set(part === 'situation' ? { ...r, situation: R.situationFor(d, r.terrain, Math.random, r) } : R.rerollEncounterPart(d, r, part));
  });
  $$('[data-enc-count]', box).forEach(b => b.onclick = e => {
    e.preventDefault();
    const [i, by] = b.dataset.encCount.split(':').map(Number), r = g.encounter;
    if (r.groups.length === 1 && r.groups[0].count + by < 1) return toast('That would leave nobody to fight.', true);
    set(settleEncounter(R.setCount(r, i, r.groups[i].count + by)));
  });
  $$('[data-enc-swap]', box).forEach(b => b.onclick = e => {
    e.preventDefault();
    const r = g.encounter;
    const pool = d.monsters.monsters.filter(m => !m.themes.includes('peaceful') && G.monsterInfo(d, m.name) && (!r.theme || r.theme === 'any' || m.themes.includes(r.theme)));
    const next = R.swapGroup(r, Number(b.dataset.encSwap), pool.length >= 3 ? pool : d.monsters.monsters.filter(m => !m.themes.includes('peaceful')));
    if (next === r) return toast('No other monster of that challenge fits.', true);
    set(settleEncounter(next));
  });
  const nudge = by => {
    const r = g.encounter;
    if (!r.groups.length) return;
    // Easier takes one from the biggest group; Harder adds one to the cheapest.
    const idx = by < 0 ? r.groups.reduce((bi, x, i, a) => x.count > a[bi].count ? i : bi, 0) : r.groups.reduce((bi, x, i, a) => x.cr < a[bi].cr ? i : bi, 0);
    if (by < 0 && r.groups.length === 1 && r.groups[0].count === 1) return toast('It is already a single creature. Try a lower difficulty or level.', true);
    set(settleEncounter(R.setCount(r, idx, r.groups[idx].count + by)));
  };
  $('#enc-easier', box)?.addEventListener('click', () => nudge(-1));
  $('#enc-harder', box)?.addEventListener('click', () => nudge(1));
}

// ---------- quick rolls ----------
// A small panel (✦ Quick in the top bar, or F2) for the answers a DM needs mid-session: a name, a passer-by,
// a rumour, a complication, a trinket, some loot, the weather. Each line can be copied, put in the latest session's
// notes, or (for people) made an NPC page. The last few stay in the panel on this computer.

/** What the small tables have dealt lately, so lines don't repeat (kept in rolls.json; see R.drawFrom). */
const rollDeck = () => state.genRolls ? (state.genRolls.decks ||= {}) : null;
const saveDeck = () => { if (state.genRolls) saveRolls(); };

const QUICK_KEEP = 15;
const quickLog = () => { try { return JSON.parse(localStorage.getItem('quick-log') || '[]'); } catch { return []; } };
const setQuickLog = l => { try { localStorage.setItem('quick-log', JSON.stringify(l.slice(0, QUICK_KEEP))); } catch {} };

function toggleQuick(force) {
  const el = $('#quick-panel');
  const show = force ?? el.hidden;
  el.hidden = !show;
  if (show) renderQuickRolls();
}
function renderQuickRolls() {
  const el = $('#quick-panel');
  const log = quickLog();
  const where = state.quickWhere || 'any';
  el.innerHTML = `<div class="qp-head"><b>Quick rolls</b><span class="spacer"></span><button class="mini-reroll" id="qp-close" title="Close (F2)">✕</button></div>
    <div class="qp-where">${whereField({ name: 'qwhere' })}</div>
    <div class="qp-btns">${R.QUICK_KINDS.map(([k, label]) => `<button class="btn small" data-quick="${k}">${esc(label)}</button>`).join('')}</div>
    <div class="qp-log">${log.length ? log.map((x, i) => `<div class="qp-row"><div class="qp-text">${esc(x.text)}</div>
      <div class="qp-acts"><button class="mini-reroll" data-qcopy="${i}" title="Copy">⧉</button><button class="mini-reroll" data-qnote="${i}" title="Add to the latest session's notes">+ Notes</button>${x.name ? `<button class="mini-reroll" data-qnpc="${i}" title="Make ${esc(x.name)} an NPC page">Make NPC</button>` : ''}${x.gp ? `<button class="mini-reroll" data-qpurse="${i}" title="Add the coins to the party purse">+ Purse</button>` : ''}</div></div>`).join('') : '<p class="hint">Click a button. Answers show here, newest first.</p>'}</div>`;
  const sel = $('select[name=qwhere]', el);
  sel.value = [...sel.options].some(o => o.value === where) ? where : 'any';
  sel.onchange = () => { state.quickWhere = sel.value; };
  $('#qp-close', el).onclick = () => toggleQuick(false);
  $$('[data-quick]', el).forEach(b => b.onclick = () => {
    const at = rollPlace(sel.value);
    const lvl = partyLevel();
    const rank = G.rankForLevel(lvl);
    const x = R.quickRoll(state.data, b.dataset.quick, { mix: at?.mix, style: at?.style || '', place: at?.page ? at.title : '', terrain: at?.terrain || at?.terrains?.[0], wiki: wikiTitles(), rank, seen: rollDeck() }, Math.random);
    saveDeck();
    const row = { kind: x.kind, text: x.text, ...(x.name ? { name: x.name } : {}), ...(x.treasure?.gp ? { gp: x.treasure.gp } : {}), place: at?.page ? at.title : '' };
    setQuickLog([row, ...quickLog()]);
    renderQuickRolls();
    $('.qp-row', el)?.classList.add('fx-new');
  });
  const row = b => quickLog()[Number(b.dataset.qcopy ?? b.dataset.qnote ?? b.dataset.qnpc ?? b.dataset.qpurse)];
  $$('[data-qcopy]', el).forEach(b => b.onclick = () => { navigator.clipboard?.writeText(row(b).text); toast('Copied'); });
  $$('[data-qnote]', el).forEach(b => b.onclick = () => addNoteToSession(row(b).text, 'Quick rolls'));
  $$('[data-qnpc]', el).forEach(b => b.onclick = () => npcFromName(row(b).name, { local: true, place: row(b).place || null }));
  $$('[data-qpurse]', el).forEach(b => b.onclick = async () => {
    const l = quickLog(), i = Number(b.dataset.qpurse);
    if (!l[i]?.gp) return;
    await addToPurse(l[i].gp, 'quick loot');
    delete l[i].gp;
    setQuickLog(l);
    renderQuickRolls();
  });
}

/** Put a line in the latest session's notes, under a heading of its own (made if it isn't there). */
async function addNoteToSession(line, heading) {
  const s = sessionPages()[0];
  if (!s) return toast('There is no session yet. Make one under Sessions first.', true);
  const lines = s.body.replace(/\s*$/, '').split('\n');
  const h = lines.findIndex(l => new RegExp(`^##\\s+${reEsc(heading)}\\s*$`).test(l));
  let body;
  if (h === -1) body = `${lines.join('\n')}\n\n## ${heading}\n\n- ${line}\n`;
  else {
    let i = h + 1;
    while (i < lines.length && !/^#{1,2}\s/.test(lines[i])) i++;
    while (i > h + 1 && lines[i - 1].trim() === '') i--;
    lines.splice(i, 0, ...(i === h + 1 ? ['', `- ${line}`] : [`- ${line}`]));
    body = lines.join('\n') + '\n';
  }
  await attempt(async () => {
    await api.pages.write(s.id, s.meta, body);
    s.body = body;
    toast(`Added to ${s.meta.title}`);
  });
}

// ---------- reading a result ----------
// A summary strip of the facts that matter, a jump list of the result's sections (each folds), and Players see,
// which shows only what players would see on the saved page.

/** [label, value] facts for the top of a result. */
function genSummary(tab, r) {
  const n = x => x?.length || 0;
  const S = {
    npc: () => [['Who', `${r.rank}-rank ${r.people} ${String(r.class).toLowerCase()}, level ${r.level}`], ['Role', (r.cover || r).role], r.where && ['Where', r.where], r.twist && ['Hidden', r.twist.name]],
    astral: () => [['Rank', `${r.rank}, level ${r.level}`], ['Place', r.environment], ['Rooms', n(r.rooms)], ['Theme', r.theme], ['XP', r.totalXP?.toLocaleString('en-US')]],
    encounter: () => [['Fight', r.groups.map(g => `${g.count} ${g.count > 1 ? G.pluralName(g.name) : g.name}`).join(', ') || 'nobody'], ['Difficulty', encounterBand(r)], r.terrain && ['Ground', r.terrain], r.details?.nonFight && ['Starts as', r.details.nonFight.name]],
    market: () => [['Kind', r.kindName], ['Settlement', r.settlementLabel || r.settlement], ['Stalls', n(r.stalls)], ['Goods up to', r.rank]],
    tavern: () => [['Kind', r.kindName], ['Prices', cap(r.quality || '')], ['Owner', r.owner?.name]],
    auction: () => [['Lots', n(r.lots)], ['Best lot', r.lots?.at(-1)?.name], ['Auctioneer', r.auctioneer?.name]],
    contracts: () => [['Notices', n(r.contracts)], ['Tiers', [...new Set(r.contracts.map(c => c.tier))].join(', ')]],
    visit: () => [['Place', r.where], ['Ready', Object.keys(r.parts).filter(k => r.parts[k] && (!Array.isArray(r.parts[k]) || r.parts[k].length)).map(k => VISIT_LABEL[k]).join(', ')]],
    treasure: () => [['Rank', r.rank], ['Kind', r.kind === 'hoard' ? 'Hoard' : 'One creature'], ['Worth', `about ${G.formatSpirit(treasureWorth(r))} spirit coins`]],
  }[tab];
  return S ? S().filter(x => x && x[1] !== undefined && x[1] !== '') : [];
}
function genSummaryHTML(tab, r) {
  const facts = genSummary(tab, r);
  return facts.length ? `<div class="gen-summary">${facts.map(([k, v]) => `<span><i>${esc(k)}</i> ${esc(String(v))}</span>`).join('')}</div>` : '';
}

/** Each ## section of a result folds, and a jump list at the top leads to them (when there are three or more). */
function foldSections(prose) {
  // Fold at ## when there are three or more of them, otherwise at ### (an astral space's rooms, a board's notices).
  const at = lv => $$(`:scope > ${lv}, :scope > .dm-block > ${lv}`, prose);
  const tag = at('h2').length >= 3 ? 'H2' : 'H3';
  const heads = at(tag.toLowerCase());
  if (heads.length < 3) return;
  const stops = tag === 'H2' ? ['H1', 'H2'] : ['H1', 'H2', 'H3'];
  const jump = document.createElement('div');
  jump.className = 'gen-jump';
  heads.forEach((h, i) => {
    const det = document.createElement('details');
    det.open = !(state.gen.folded?.[state.gen.tab] || []).includes(h.textContent);
    det.className = 'gen-fold';
    const sum = document.createElement('summary');
    sum.append(...h.childNodes);
    h.replaceWith(det);
    const sec = document.createElement(tag.toLowerCase());
    sec.append(...sum.childNodes);
    sum.append(sec);
    det.append(sum);
    while (det.nextSibling && !stops.includes(det.nextSibling.nodeName) && !(det.nextSibling.nodeName === 'DETAILS' && det.nextSibling.classList.contains('gen-fold'))) det.append(det.nextSibling);
    det.id = `gen-sec-${i}`;
    det.addEventListener('toggle', () => {
      const f = ((state.gen.folded ||= {})[state.gen.tab] ||= []);
      const t = sec.textContent, k = f.indexOf(t);
      if (det.open && k >= 0) f.splice(k, 1); else if (!det.open && k < 0) f.push(t);
    });
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = [...sec.childNodes].filter(n => n.nodeName !== 'BUTTON').map(n => n.textContent).join('').replace(/[↻×]/g, '').trim();
    b.onclick = () => { det.open = true; det.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
    jump.append(b);
  });
  const all = document.createElement('button');
  all.className = 'chip';
  all.textContent = 'Fold all';
  all.onclick = () => { const open = $$('details.gen-fold', prose).some(x => x.open); $$('details.gen-fold', prose).forEach(x => { x.open = !open; }); all.textContent = open ? 'Unfold all' : 'Fold all'; };
  jump.append(all);
  prose.prepend(jump);
}

// ---------- treasure ----------

const treasureWorth = t => R.treasureWorth(t);
function wireTreasure(box) {
  const g = state.gen;
  $('[data-tr-purse]', box)?.addEventListener('click', async () => {
    const t = g.treasure;
    if (!t.gp || t.coinsTaken) return;
    await addToPurse(t.gp, 'the treasure');
    g.treasure = { ...t, coinsTaken: true };
    showGenResult();
  });
  $$('[data-tr-give]', box).forEach(b => b.onclick = async () => {
    const t = g.treasure, i = Number(b.dataset.trGive), f = t.finds[i];
    const party = pcs();
    if (!party.length) return toast('Add a party member first.', true);
    const r = await formDialog(`Give ${f.name}`, `<label class="field">To<select name="who">${party.map(p => `<option value="${esc(p.id)}">${esc(p.meta.title)}</option>`).join('')}</select></label>`, 'Give');
    if (!r) return;
    const p = state.pages.get(r.who), meta = p.meta;
    const item = f.kind === 'essence' ? { kind: 'essence', essence: f.essence, name: f.name } : f.kind === 'core' ? { kind: 'core', rank: f.rank, count: f.count, name: f.name }
      : f.kind === 'stone' ? { kind: 'stone', name: f.name.replace(/ \(.*\)$/, ''), spell: f.spell, level: f.level, affinity: f.affinity }
      : { kind: 'item', name: f.kind === 'gem' ? `${cap(f.name)} (worth ${f.value} gp)` : f.kind === 'trinket' ? cap(f.name) : f.name };
    const body = stowGoods(meta, p.body, item, 'found in a treasure');
    await attempt(async () => {
      await api.pages.write(p.id, meta, body);
      p.body = body;
      const finds = [...t.finds];
      finds[i] = { ...f, taken: meta.title };
      g.treasure = { ...t, finds };
      toast(`${meta.title} has the ${f.name} now.`);
      showGenResult();
    });
  });
}

// ---------- pinning parts ----------
// 📌 Pin turns clicks on a result's parts (the dotted lines and the ↻ buttons) into pins. With anything pinned,
// Reroll rolls every other part again and leaves the pinned ones as they are. A new roll from the form starts afresh.

const PIN_TABS = ['npc', 'astral', 'encounter', 'market', 'tavern', 'auction', 'contracts'];
const pinsOf = tab => state.gen.pins?.[tab] || [];
/** The pin key of a clickable part, or null for buttons that aren't parts (take down, add, save). */
function partKey(el) {
  if (el.dataset.enc) return `enc:${el.dataset.enc}`;
  if (el.dataset.encSwap !== undefined) return `swap:${el.dataset.encSwap}`;
  const p = el.dataset.part;
  if (!p || p === 'add' || /:(remove|all)$/.test(p) || el.classList.contains('save-contract')) return null;
  return p;
}
const PART_SEL = '.reroll[data-part], .mini-reroll[data-part], [data-enc], [data-enc-swap]';
function wirePins(box) {
  const g = state.gen, tab = g.tab;
  if (!PIN_TABS.includes(tab)) return;
  const pins = new Set(pinsOf(tab));
  $$(PART_SEL, box).forEach(el => {
    const k = partKey(el);
    if (k && pins.has(k)) (el.closest('li, p, h3, h2, .reroll') || el).classList.add('pinned');
  });
  if (pins.has('name')) $('#gen-title', box)?.classList.add('pinned');
  box.classList.toggle('pin-mode', !!g.pinMode);
  $('#gen-pin', box)?.addEventListener('click', () => { g.pinMode = !g.pinMode; showGenResult(); });
  // In pin mode a click pins instead of rerolling (caught before the part's own handler).
  if (!box._pinCatch) {
    box._pinCatch = true;
    box.addEventListener('click', e => {
      if (!state.gen.pinMode) return;
      const el = e.target.closest(`${PART_SEL}, #npc-name, #venue-name`);
      if (!el || !box.contains(el)) return;
      const k = el.id === 'npc-name' || el.id === 'venue-name' ? 'name' : partKey(el);
      if (!k) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const T = state.gen.tab, list = new Set(pinsOf(T));
      if (list.has(k)) list.delete(k); else list.add(k);
      (state.gen.pins ||= {})[T] = [...list];
      showGenResult();
    }, true);
  }
}

/** Roll one part of a result again, for any tab that has parts. */
function rerollPart(tab, r, part) {
  const d = state.data, g = state.gen;
  if (tab === 'npc') return G.rerollNPC(d, r, part, Math.random, { wiki: wikiTitles(), newPlace: npcPlaces(r.newPlaces) });
  if (['market', 'tavern', 'auction'].includes(tab)) return ({ market: G.rerollMarket, tavern: G.rerollTavern, auction: G.rerollAuction })[tab](d, r, part, Math.random, { ...(g.opts[tab] || {}), wiki: wikiTitles() });
  if (tab === 'contracts') return G.rerollContracts(d, r, part, Math.random, { ...(g.opts.contracts || {}), wiki: wikiTitles(), placeInfo, newPlace: placeMaker(r.where || g.opts.contracts?.where, boardDrafts(r)) });
  if (tab === 'astral') {
    const [kind, id] = part.split(':');
    return kind === 'puzzle' ? G.rerollAstralPuzzle(d, r, Number(id)) : kind === 'room' ? G.rerollAstralRoom(d, r, Number(id)) : r;
  }
  if (tab === 'encounter') {
    if (part.startsWith('swap:')) {
      const pool = d.monsters.monsters.filter(m => !m.themes.includes('peaceful') && G.monsterInfo(d, m.name) && (!r.theme || r.theme === 'any' || m.themes.includes(r.theme)));
      return settleEncounter(R.swapGroup(r, Number(part.slice(5)), pool));
    }
    const k = part.replace(/^enc:/, '');
    if (k === 'situation') return { ...r, situation: R.situationFor(d, r.terrain, Math.random, r) };
    if (k === 'nonFight') return r;
    return R.rerollEncounterPart(d, r, k);
  }
  return r;
}

/** Reroll with pins: every part on screen that isn't pinned is rolled again, one after another. */
function rerollUnpinned() {
  const g = state.gen, tab = g.tab, box = $('#gen-result');
  const pins = new Set(pinsOf(tab));
  let keys = [...new Set($$(PART_SEL, box).map(partKey).filter(Boolean))].filter(k => !pins.has(k));
  // A contract notice with nothing pinned is rolled whole.
  if (tab === 'contracts') {
    const whole = new Set();
    for (const c of g.contracts.contracts.keys()) if (![...pins].some(p => p.startsWith(`${c}:`))) whole.add(c);
    keys = [...[...whole].map(c => `${c}:all`), ...keys.filter(k => !whole.has(Number(k.split(':')[0])))];
  }
  if (['npc', 'market', 'tavern', 'auction'].includes(tab) && !pins.has('name')) keys.unshift('name');
  let r = g[tab];
  for (const k of keys) { try { r = rerollPart(tab, r, k); } catch (e) { console.error(e); } }
  g[tab] = r;
  showGenResult();
}

// ---------- prep a visit ----------
// One click before the party reaches a place: a contract board, a tavern, a market, some locals, rumours and a fight
// on the way, all for that place. Each part opens in its own tab to change or save; the whole visit can go into the
// latest session's prep notes.

const VISIT_PARTS = [['contracts', 'Contract board'], ['tavern', 'A tavern'], ['market', 'A market'], ['locals', 'Three locals'], ['rumours', 'Three rumours'], ['encounter', 'A fight on the way']];
const VISIT_SYS = { contracts: 'contracts' };
const VISIT_LABEL = { contracts: 'contract board', tavern: 'tavern', market: 'market', locals: 'locals', rumours: 'rumours', encounter: 'a fight' };

function prepVisit(opts) {
  const d = state.data, where = opts.where;
  const page = where && state.pages.get(resolve(where));
  if (!page) throw new Error('Pick a place to visit.');
  const whereMeta = page.meta, wiki = wikiTitles(), want = k => opts[`part-${k}`] && (!VISIT_SYS[k] || sysOn(VISIT_SYS[k]));
  const at = rollPlace(where);
  const lvl = state.gen.opts.level ?? partyLevel(), size = state.gen.opts.partySize ?? (pcs().length >= 2 ? Math.min(20, pcs().length) : 4);
  const rank = G.rankForLevel(lvl) === 'Normal' ? 'Iron' : G.rankForLevel(lvl);
  const parts = {};
  if (want('contracts') && hasBoard(page)) {
    const near = problemHere(page);
    parts.contracts = G.generateContractBoard(d, { where, whereMeta, settlement: 'any', partyRank: rank, type: 'any', wiki, placeInfo, newPlace: placeMaker(where), problems: near ? PL.problemsAt(problems(), near.map) : [] });
  }
  if (want('tavern')) parts.tavern = G.generateTavern(d, { where, kind: 'any', quality: 'any', wiki });
  if (want('market')) parts.market = G.generateMarket(d, { where, whereMeta, settlement: 'any', kind: 'any', rank: 'any', theme: 'any', wiki });
  if (want('locals')) parts.locals = [0, 1, 2].map(() => { const n = G.generateNPC(d, { peopleMix: at?.mix, wiki, newPlace: npcPlaces() }); n.where = page.meta.title; return n; });
  if (want('rumours')) parts.rumours = [0, 1, 2].map(() => R.quickRoll(d, 'rumour', { place: page.meta.title, wiki, seen: rollDeck() }).text);
  if (want('encounter')) parts.encounter = rollEncounter({ where, level: lvl, partySize: size, difficulty: 'moderate', theme: 'any' });
  saveDeck();
  return { kind: 'visit', where: page.meta.title, parts };
}

function visitToMarkdown(v, { interactive = false } = {}) {
  const P = v.parts, L = [];
  const open = (k, label = 'Open') => interactive ? ` <button class="mini-reroll" data-visit-open="${k}" title="Open it in its own tab, to change or save it">${label}</button>` : '';
  const again = k => interactive ? ` <button class="mini-reroll" data-visit-again="${k}" title="Roll this part again">↻</button>` : '';
  L.push(`Ready for the party's visit to [[${v.where}]].`, '');
  if (P.contracts) {
    L.push(`## Contract board${open('contracts')}${again('contracts')}`, '');
    for (const c of P.contracts.contracts) L.push(`- **${c.tier}:** ${G.contractTitle(c)}${c.reward ? `, for ${G.formatCoins(c.reward)}` : ''}.`);
    L.push('');
  }
  if (P.tavern) {
    const t = P.tavern;
    L.push(`## ${t.name}${open('tavern')}${again('tavern')}`, '', `${t.kindName}, ${t.quality} prices, run by ${t.owner?.name || 'nobody in particular'}. ${t.inside || ''}`, '', `*Tonight:* ${t.event}`, '');
  }
  if (P.market) {
    const m = P.market;
    L.push(`## ${m.name}${open('market')}${again('market')}`, '', `${m.kindName}, ${m.stalls.length} stalls: ${m.stalls.map(x => x.name).join(', ')}.`, '', `*Happening:* ${m.event}`, '');
  }
  if (P.locals?.length) {
    L.push(`## Locals${again('locals')}`, '');
    P.locals.forEach((n, i) => L.push(`- **${n.name}**, ${n.rank}-rank ${n.people} ${String((n.cover || n).role).toLowerCase()}. ${n.hook || ''}${open(`npc:${i}`)}`));
    L.push('');
  }
  if (P.rumours?.length) {
    L.push(`## Rumours${again('rumours')}`, '');
    for (const x of P.rumours) L.push(`- ${x}`);
    L.push('');
  }
  if (P.encounter) {
    const e = P.encounter;
    L.push(`## On the way${open('encounter')}${again('encounter')}`, '', `${e.groups.map(g => `${g.count} ${g.count > 1 ? G.pluralName(g.name) : g.name}`).join(', ') || 'Nothing'} (${encounterBand(e)})${e.terrain ? `, ${e.terrain.toLowerCase()}` : ''}. ${e.situation || ''}`, '');
  }
  return L.join('\n');
}

function wireVisit(box) {
  const g = state.gen;
  $$('[data-visit-open]', box).forEach(b => b.onclick = e => {
    e.preventDefault();
    const [k, i] = b.dataset.visitOpen.split(':'), v = g.visit;
    const tab = k === 'npc' ? 'npc' : k;
    g[tab] = k === 'npc' ? v.parts.locals[Number(i)] : v.parts[k];
    g.fresh = tab;
    g.opts[tab] = { ...(g.opts[tab] || {}), where: v.where };
    g.tab = tab;
    renderGenerators();
  });
  $$('[data-visit-again]', box).forEach(b => b.onclick = e => {
    e.preventDefault();
    const k = b.dataset.visitAgain;
    const one = prepVisit({ where: g.visit.where, [`part-${k}`]: '1' });
    g.visit = { ...g.visit, parts: { ...g.visit.parts, [k]: one.parts[k] } };
    showGenResult();
  });
  $('#visit-notes', box)?.addEventListener('click', async () => {
    const s = sessionPages()[0];
    if (!s) return toast('There is no session yet. Make one under Sessions first.', true);
    const key = `prep-visit-${g.visit.where.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    s.body = G.putSection(s.body, key, `## Visit: ${g.visit.where}\n\n${visitToMarkdown(g.visit).replace(/^## /gm, '### ')}`);
    await attempt(() => api.pages.write(s.id, s.meta, s.body));
    toast(`Added to ${s.meta.title}'s prep notes.`);
  });
}

// ---------- printed handouts ----------

const PRINT_TABS = {
  contracts: [r => R.boardHandoutHTML(r, r.where?.title || state.gen.opts.contracts?.where || ''), 'Print the board as notices for the players (bounties as wanted posters)'],
  tavern: [r => R.menuHandoutHTML(r), 'Print the menu card'],
  market: [r => R.priceListHTML(r), 'Print a price list for the players'],
  npc: [r => R.npcCardHTML(r), 'Print a portrait card with only what players can see'],
};
async function printResult(tab, r) {
  const P = PRINT_TABS[tab];
  if (!P || !r) return;
  const name = `${rollTitle(tab, r)} handout.pdf`.replace(/[\\/:*?"<>|]/g, '');
  const file = await attempt(() => api.files.savePdf(name, P[0](r)));
  if (file) toast('Saved and opened. Print it and hand it round.');
}

// ---------- kept rolls ----------
// Each generator tab keeps its last ROLL_KEEP results with the campaign (rolls.json), so Reroll never loses a good one
// and they are still there after the app closes. ◀ ▶ step through them. ☆ Keep puts one in the Kept tray for later,
// without making a wiki page; it stays there until it's taken out.

const ROLL_KEEP = 20;
const ROLL_TABS = ['npc', 'astral', 'encounter', 'market', 'auction', 'tavern', 'contracts', 'treasure', 'visit'];
const ROLL_LABEL = { npc: 'NPC', astral: 'Astral space', encounter: 'Encounter', market: 'Market', auction: 'Auction', tavern: 'Tavern', contracts: 'Contract board', treasure: 'Treasure', visit: 'Visit' };

async function loadRolls() {
  const r = await attempt(() => api.rolls.read());
  state.genRolls = { history: {}, kept: [], ...(r || {}) };
  if (state.genRolls.off) R.applyOff(state.data, state.genRolls.off);
  G.useDeck(rollDeck());
  state.gen.pos = {};
  // Each tab opens on its last roll.
  for (const t of ROLL_TABS) {
    const h = state.genRolls.history[t];
    if (h?.length) { state.gen[t] = h[0].result; state.gen.pos[t] = 0; }
  }
}
let rollsTimer = null;
function saveRolls() {
  clearTimeout(rollsTimer);
  rollsTimer = setTimeout(() => { rollsTimer = null; attempt(() => api.rolls.write(state.genRolls)); }, 400);
}
/** Writes rolls still waiting to be saved now, before another campaign is opened (they'd land in that one). */
async function flushRolls() {
  if (!rollsTimer) return;
  clearTimeout(rollsTimer);
  rollsTimer = null;
  await attempt(() => api.rolls.write(state.genRolls));
}
/** A short name for a roll, for the history and the Kept tray. */
function rollTitle(tab, r) {
  if (tab === 'visit') return `Visit: ${r.where}`;
  if (tab === 'encounter') return r.where ? `Encounter: ${r.where}` : `Encounter: ${(r.groups || []).map(x => `${x.count > 1 ? `${x.count} ` : ''}${x.count > 1 ? G.pluralName(x.name) : x.name}`).join(', ') || 'nothing'}`;
  return r.name || ROLL_LABEL[tab] || 'Roll';
}
const rollList = tab => (state.genRolls.history[tab] ||= []);
/** Note the result on screen in its tab's history: a new roll goes on top; a change to the one shown replaces it. */
function recordRoll(tab) {
  const g = state.gen, r = g[tab];
  if (!ROLL_TABS.includes(tab) || !state.genRolls || !r) return;
  const h = rollList(tab);
  g.pos ||= {};
  let e = h[g.pos[tab] ?? 0];
  if (g.fresh === tab || !e) {
    e = { id: `${tab}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, at: Date.now(), title: rollTitle(tab, r), result: r };
    h.unshift(e);
    h.splice(ROLL_KEEP);
    g.pos[tab] = 0;
    g.fresh = null;
  } else if (e.result !== r) {
    e.result = r;
    e.title = rollTitle(tab, r);
  } else return;
  // A kept roll follows its changes.
  const k = state.genRolls.kept.find(x => x.id === e.id);
  if (k) Object.assign(k, { result: r, title: e.title });
  saveRolls();
}
function rollNavHTML(tab) {
  if (!ROLL_TABS.includes(tab) || !state.genRolls) return '';
  const h = rollList(tab), i = state.gen.pos?.[tab] ?? 0, e = h[i];
  const kept = e && state.genRolls.kept.some(x => x.id === e.id);
  return `<div class="roll-nav">
    <button class="btn small" id="roll-older" ${i >= h.length - 1 ? 'disabled' : ''} title="The roll before this one">◀</button>
    <span class="muted" title="Your last ${ROLL_KEEP} rolls on this tab are kept with the campaign">${h.length ? `${i + 1} of ${h.length}` : ''}${e ? ` · rolled ${esc(rollWhen(e.at))}` : ''}</span>
    <button class="btn small" id="roll-newer" ${i <= 0 ? 'disabled' : ''} title="The roll after this one">▶</button>
    <span class="spacer"></span>
    <button class="btn small${kept ? ' on' : ''}" id="roll-keep" title="${kept ? 'Take it out of the Kept tray' : 'Keep it in the Kept tray for later, without making a wiki page'}">${kept ? '★ Kept' : '☆ Keep for later'}</button>
  </div>`;
}
/** "today 14:05" or "3 Oct". */
function rollWhen(t) {
  const d = new Date(t), now = new Date();
  return d.toDateString() === now.toDateString() ? `today ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}` : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
function wireRollNav(box) {
  const g = state.gen, tab = g.tab;
  if (!ROLL_TABS.includes(tab) || !state.genRolls) return;
  const step = d => {
    const h = rollList(tab), i = Math.max(0, Math.min(h.length - 1, (g.pos[tab] ?? 0) + d));
    g.pos[tab] = i;
    g[tab] = h[i].result;
    showGenResult();
  };
  $('#roll-older', box)?.addEventListener('click', () => step(1));
  $('#roll-newer', box)?.addEventListener('click', () => step(-1));
  $('#roll-keep', box)?.addEventListener('click', () => {
    const e = rollList(tab)[g.pos[tab] ?? 0];
    if (!e) return;
    const K = state.genRolls.kept, i = K.findIndex(x => x.id === e.id);
    if (i >= 0) K.splice(i, 1); else K.unshift({ id: e.id, tab, at: e.at, title: e.title, result: e.result });
    saveRolls();
    renderKeptButton();
    $('.roll-nav', box).outerHTML = rollNavHTML(tab);
    wireRollNav(box);
    toast(i >= 0 ? 'Taken out of the Kept tray' : 'In the Kept tray. Open it from the Kept button next to the tabs.');
  });
}
function renderKeptButton() {
  const b = $('#kept-btn');
  if (b) b.textContent = `☆ Kept (${state.genRolls?.kept.length || 0})`;
}
/** The Kept tray: every kept roll, newest first. Open one in its tab, or take it out. */
function openKept() {
  const K = state.genRolls?.kept || [];
  const dlg = $('#dialog');
  dlg.innerHTML = `<h2>Kept for later</h2>
    ${K.length ? `<div class="kept-list">${K.map((k, i) => `<div class="kept-row"><span class="badge">${esc(ROLL_LABEL[k.tab] || k.tab)}</span>
      <b>${esc(k.title)}</b> <span class="muted">${esc(rollWhen(k.at))}</span><span class="spacer"></span>
      <button class="btn small primary" data-kept-open="${i}">Open</button><button class="mini-reroll" data-kept-drop="${i}" title="Take it out of the tray">✕</button></div>`).join('')}</div>`
      : '<p class="muted">Nothing kept yet. Click ☆ Keep for later on any roll to put it here.</p>'}
    <div class="actions"><button class="btn" id="kept-close">Close</button></div>`;
  dlg.onclose = null;
  dlg.showModal();
  $('#kept-close').onclick = () => dlg.close();
  $$('[data-kept-drop]', dlg).forEach(b => b.onclick = () => { K.splice(Number(b.dataset.keptDrop), 1); saveRolls(); renderKeptButton(); openKept(); });
  $$('[data-kept-open]', dlg).forEach(b => b.onclick = () => {
    const k = K[Number(b.dataset.keptOpen)];
    const g = state.gen, h = rollList(k.tab);
    // It goes back on top of its tab's history (or is found there), so ◀ ▶ work from it.
    let i = h.findIndex(x => x.id === k.id);
    if (i < 0) { h.unshift({ id: k.id, at: k.at, title: k.title, result: k.result }); h.splice(ROLL_KEEP); i = 0; saveRolls(); }
    g.pos[k.tab] = i;
    g[k.tab] = h[i].result;
    g.tab = k.tab;
    dlg.close();
    if (state.view?.kind === 'generators') renderGenerators(); else go({ kind: 'generators' });
  });
}

// ---------- generated places ----------
// Contracts, hooks, NPCs and travel can name a place that doesn't exist yet. It is a draft (places.js) until the
// result is kept, then it becomes a hidden location page with a pin, under the place it was generated near.

/** Wiki locations with a pin on the World map. */
const pinnedPlaces = () => [...state.pages.values()].filter(p => p.meta.type === 'location' && mapPoint(p))
  .map(p => ({ title: p.meta.title, map: mapPoint(p), generated: (p.meta.tags || []).includes('generated') }));

/** What a generator is anchored to: the chosen place, or the nearest page above it with a pin, else the campaign's start. */
function placeAnchor(where) {
  const up = p => p?.meta.parent ? state.pages.get(resolve(p.meta.parent)) : null;
  let p = where ? state.pages.get(resolve(where)) : null;
  for (let i = 0; p && !mapPoint(p) && i < 8; i++) p = up(p);
  if (!p || !mapPoint(p)) p = [...state.pages.values()].find(x => (x.meta.tags || []).includes('start') && mapPoint(x));
  if (!p) return null;
  // Terrain and naming style come from the place itself or the nearest place above it that has them.
  const inherit = k => { for (let q = p, i = 0; q && i < 8; q = up(q), i++) if (q.meta[k]?.length) return q.meta[k]; return null; };
  return { title: p.meta.title, map: mapPoint(p), terrain: [].concat(inherit('terrain') || []), style: inherit('nameStyle') || '', magic: G.placeMagic(state.data, p.meta.title, p.meta) };
}

/**
 * A newPlace callback for the generators: given what's asking ({ type, tier } for a contract, { want, miles } otherwise),
 * a reused or new place near `where`. `drafts` are drafts already in the result, so names and pins don't clash.
 */
/** What a place page is like, for the generators: a settlement or not, and its terrain. */
function placeInfo(title) {
  const p = title && state.pages.get(resolve(title));
  return p ? { settled: !!storySettlement(p), terrain: [].concat(p.meta.terrain || []), label: [].concat(p.meta.tags || []).join(' ') } : null;
}
function placeMaker(where, drafts = [], spec = null) {
  const d = state.data;
  if (!d.places) return null;
  const found = placeAnchor(where);
  if (!found) return null;
  // spec.at moves the centre (the party's spot on the road) while terrain and style still come from `where`.
  const anchor = spec?.at ? { ...found, map: spec.at } : found;
  const run = [...drafts];
  return (q, rng = Math.random) => {
    const job = spec || d.places.contracts?.[q.type];
    if (!job?.want?.length || (!q.fresh && !G.chance(rng, job.chance ?? 1))) return null;
    const k = q.tier ? d.places.tierRange?.[q.tier] ?? 1 : 1;
    const near = pinnedPlaces();
    const ctx = {
      anchor, want: job.want, miles: job.miles.map(m => Math.round(m * k)), reuse: job.reuse,
      pins: [...near.map(n => n.map), ...run.map(x => x.map)],
      taken: new Set([...[...state.pages.values()].map(x => x.meta.title.toLowerCase()), ...run.map(x => x.name.toLowerCase())]),
      peoples: d.peoples?.peoples,
    };
    const out = q.fresh ? (x => x && { title: x.name, draft: x })(PL.generatePlace(d, ctx, rng)) : PL.placeForJob(d, ctx, near, rng);
    if (out?.draft) run.push(out.draft);
    return out;
  };
}

/** NPC backstories: now and then a new place, mostly a generated one that's already nearby. */
const npcPlaces = (drafts = []) => {
  const P = state.data.places;
  return P ? placeMaker(null, drafts, { want: ['settlement', 'industry'], miles: [10, 150], chance: P.npcChance ?? 0.06, reuse: { fewNearby: 2, newWhenFew: 0.5, newWhenMany: 0.15 } }) : null;
};

/** Travel events: now and then the place an event names is a new one a few miles from the party's spot on the road. */
function roadPlaces(j) {
  const P = state.data.places;
  const a = j?.from?.at, b = j?.to?.at;
  const pins = pinnedPlaces();
  if (!P || !a || !pins.length) return null;
  const t = b && j.miles ? Math.min(1, G.journeyDone(j) / j.miles) : 0;
  const at = b ? [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] : a;
  const nearest = ll => pins.reduce((x, y) => PL.milesBetween(ll, y.map) < PL.milesBetween(ll, x.map) ? y : x);
  const make = placeMaker(nearest(at).title, [], { want: ['settlement', 'industry', 'site'], miles: [2, 20], chance: P.travelChance ?? 0.3, at });
  return make && ((q, rng) => {
    const out = make(q, rng);
    const d = out?.draft;
    // Its page says where it is from the nearest place on the map, not from a spot on the road.
    if (d) { const n = nearest(d.map); Object.assign(d, { anchor: n.title, miles: Math.round(PL.milesBetween(n.map, d.map)), bearing: PL.bearingName(n.map, d.map) }); }
    return out;
  });
}

/** Travel days whose event named a new place the DM hasn't made or turned down yet. */
const travelOffers = j => j.days.flatMap((d, i) => ['event', 'encounter'].map(k => d[k]?.event?.newPlace && !d[k].event.newPlace.kept ? { i, k, day: d, place: d[k].event.newPlace } : null)).filter(Boolean);

/** Turns kept drafts into wiki pages (skipping any whose name is now taken). Returns how many were made. */
async function keepPlaces(drafts, from = '') {
  let made = 0;
  for (const p of drafts) {
    if (!p || p.kept || resolve(p.name)) continue;
    const id = await attempt(() => api.pages.create(p.name, PL.placeMeta(p), PL.placeToMarkdown({ ...p, from: p.from || from })));
    if (!id) continue;
    state.pages.set(id, await api.pages.read(id));
    p.kept = true;
    made++;
    // Now and then a new place brings a problem of its region with it, unless one like it already reaches there.
    const PS = state.data.places?.problemSettings;
    if (state.saved && p.group !== 'site' && PS && G.chance(Math.random, PS.chance ?? 0.2)) {
      const x = PL.newProblem(state.data, { title: p.name, map: p.map, style: p.style });
      if (x && !PL.problemsAt(problems(), p.map).some(q => q.name === x.name)) { x.startedDay = today(); problems().push(x); await saveProblems(); }
    }
  }
  if (made) { rebuildIndex(); renderTree(); }
  return made;
}

// ---------- places in the sea ----------
// Sea places are location pages with a pin in the water (meta.sea is their kind). The World map's Sea places tool
// makes a batch for the sea in view; journeys by ship or sky ship see the ones near their course, and now and then
// something that isn't on the map, which the DM can divert to explore.

/** Sea places on the map: [{ id, title, map, sea, seen, hidden }]. */
const seaPlaces = () => [...state.pages.values()].filter(p => p.meta.sea && mapPoint(p))
  .map(p => ({ id: p.id, title: p.meta.title, map: mapPoint(p), sea: p.meta.sea, seen: p.meta.seen, hidden: !!p.meta.dmOnly }));
/** Places on land with a pin, to say where a sea place is from. */
const landAnchors = () => [...state.pages.values()].filter(p => mapPoint(p) && !p.meta.sea && p.meta.type === 'location').map(p => ({ title: p.meta.title, map: mapPoint(p) }));
const takenTitles = () => new Set([...state.pages.values()].map(x => x.meta.title.toLowerCase()));

/** The page far-out sea places go under, made the first time one needs it. */
async function openSeaPage() {
  const title = state.data.places?.sea?.settings?.openSea || 'The Open Sea';
  if (resolve(title)) return title;
  const id = await attempt(() => api.pages.create(title, { type: 'location', tags: ['sea place'] }, 'Places out in the open sea, too far from any coast to belong to one. Each has a page of its own nested here, and a pin on the World map.\n'));
  if (id) { state.pages.set(id, await api.pages.read(id)); rebuildIndex(); }
  return title;
}
/** Turns sea drafts into pages. hidden: true, false, or null for the usual (majors shown, minors hidden). Returns how many. */
async function keepSeaPlaces(drafts, { hidden = null, from = '' } = {}) {
  const far = state.data.places?.sea?.settings?.parentMiles ?? 250;
  let made = 0;
  for (const p of drafts) {
    if (!p || p.kept || resolve(p.name)) continue;
    const parent = p.anchor && p.miles <= far ? p.anchor : await openSeaPage();
    const meta = PL.seaMeta(p, { parent, ...(hidden === null ? {} : { hidden }) });
    const id = await attempt(() => api.pages.create(p.name, meta, PL.seaToMarkdown(state.data, { ...p, found: from || p.found })));
    if (!id) continue;
    state.pages.set(id, await api.pages.read(id));
    p.kept = true;
    made++;
  }
  if (made) { rebuildIndex(); renderTree(); }
  return made;
}

/** A map view box as [west, south, east, north], kept inside the world. */
function boxOf(vb) {
  const [w, n] = mapLL([vb[0], vb[1]]), [e, s] = mapLL([vb[0] + vb[2], vb[1] + vb[3]]);
  return [Math.max(-180, w), Math.max(-60, s), Math.min(180, e), Math.min(WORLD.top, n)];
}
/** Ask how many sea places to make for a stretch of sea, then show them on the map to keep or throw back. */
async function askSeedSea(box, where = 'the sea in view') {
  const d = state.data;
  if (!d.places?.sea) return toast('The sea places list is missing. Reset "places" under Generator lists to get it back.', true);
  const n = PL.seaCounts(d, box);
  if (n.area < 2000) return toast('There is hardly any sea in view. Move the map over some water first.', true);
  const r = await formDialog('Sea places', `<p class="muted" style="margin:0 0 10px">New places in ${esc(where)}: about ${n.area.toLocaleString('en-US')} square miles of water.
      Major places are landmarks sailors know; minor ones are for the party to find. You see them all on the map before any are kept.</p>
    <div class="row"><label class="field" style="width:130px">Major places<input name="major" type="number" min="0" max="40" value="${Math.max(n.area > 300000 ? 1 : 0, n.major)}"></label>
    <label class="field" style="width:130px">Minor places<input name="minor" type="number" min="0" max="150" value="${Math.max(1, n.minor)}"></label></div>
    <label class="inline-check"><input type="checkbox" name="hideMinor" ${d.places.sea.settings?.hiddenMinor === false ? '' : 'checked'}> Hide minor places from players until they're found</label>`, 'Make them');
  if (!r) return;
  const drafts = PL.seedSea(d, { box, major: r.major, minor: r.minor, pins: [...pinnedPlaces().map(x => x.map)], taken: takenTitles(), places: landAnchors() });
  if (!drafts.length) return toast('Nowhere in view fits a sea place. Try a bigger stretch of sea.', true);
  const m = (state.map ||= { vb: null, tool: null, draft: [] });
  m.seaDrafts = drafts;
  m.seaHideMinor = !!r.hideMinor;
  m.sel = null;
  if (state.view?.kind === 'map') renderMap(); else go({ kind: 'map' });
  toast(`${drafts.length} sea place${drafts.length === 1 ? '' : 's'} to look over. Keep them from the panel on the right.`);
}

/** Drafts waiting on the map, drawn as dashed pins. */
function seaDraftSVG() {
  const list = state.map?.seaDrafts || [];
  return `<g class="sea-drafts">${list.map((p, i) => {
    const [x, y] = mapXY(p.map);
    return `<g class="scaled pin pin-${p.tier === 'major' ? 'sea-major' : 'sea'} sea-draft" data-sea-draft="${i}" data-x="${x}" data-y="${y}" data-kind="${p.tier === 'major' ? 'sea-major' : 'sea'}"><title>${esc(p.name)}: ${esc(p.label)} (not kept yet)</title>
      ${p.tier === 'major' ? SEA_STAR : '<circle/>'}<text x="8" y="4">${esc(p.name)}</text></g>`;
  }).join('')}</g>`;
}
const SEA_STAR = '<path d="M0,-7L2,-2L7,0L2,2L0,7L-2,2L-7,0L-2,-2Z"/>';

/** The map's side panel while there are sea drafts: each one to keep, reroll or drop. */
function seaDraftPanel(side, redraw) {
  const m = state.map;
  const list = m.seaDrafts;
  side.innerHTML = `<div class="map-side-head"><b>New sea places (${list.length})</b></div>
    <p class="hint" style="margin:0 0 8px">Dashed pins on the map. Majors are known to players; minors are ${m.seaHideMinor ? 'hidden until the party finds them' : 'shown to players too'}.</p>
    <div class="sea-draft-list">${list.map((p, i) => `<div class="sea-draft-row" data-row="${i}">
      <div><b>${esc(p.name)}</b> <span class="badge">${p.tier}</span><br><span class="muted">${esc(PL.seaLine(p))}</span><br><span>${esc(p.description)}</span></div>
      <div class="sea-draft-btns"><button class="mini-reroll" data-sea-reroll="${i}" title="A different place here">↻</button><button class="mini-reroll" data-sea-drop="${i}" title="Leave this one out">✕</button></div></div>`).join('')}</div>
    <div class="row" style="margin-top:8px"><button class="btn primary" id="sea-keep">Keep ${list.length === 1 ? 'it' : `all ${list.length}`}</button><button class="btn" id="sea-discard">Discard</button></div>`;
  $$('[data-row]', side).forEach(r => r.onmouseenter = () => $$('#world .sea-draft').forEach(g => g.classList.toggle('selected', g.dataset.seaDraft === r.dataset.row)));
  $$('[data-sea-reroll]', side).forEach(b => b.onclick = () => {
    const i = Number(b.dataset.seaReroll), was = list[i];
    const others = list.filter((_, k) => k !== i);
    const box = [was.map[0] - 4, was.map[1] - 4, was.map[0] + 4, was.map[1] + 4];
    const p = PL.generateSeaPlace(state.data, was.tier, { box, pins: [...pinnedPlaces().map(x => x.map), ...others.map(x => x.map)], taken: new Set([...takenTitles(), ...others.map(x => x.name.toLowerCase())]), places: landAnchors() });
    if (!p) return toast('Nothing else fits near there.', true);
    list[i] = p;
    redraw();
  });
  $$('[data-sea-drop]', side).forEach(b => b.onclick = () => { list.splice(Number(b.dataset.seaDrop), 1); if (!list.length) m.seaDrafts = null; redraw(); });
  $('#sea-discard').onclick = () => { m.seaDrafts = null; redraw(); };
  $('#sea-keep').onclick = async () => {
    const made = await keepSeaPlaces(list.filter(p => p.tier === 'major'), { hidden: false });
    const minor = await keepSeaPlaces(list.filter(p => p.tier !== 'major'), { hidden: m.seaHideMinor });
    m.seaDrafts = null;
    toast(`Kept ${made + minor} sea place${made + minor === 1 ? '' : 's'}.`);
    redraw();
  };
}

// ----- at sea on a journey -----

/** How the party is travelling on a day, for what it can see of the sea: 'air', 'ship', 'shore' or null. */
function seaWay(day) {
  if (!day || day.teleport) return null;
  if (day.ride?.flies || day.mode === 'Sky ship') return 'air';
  if (['Sailing ship', 'River boat'].includes(day.mode) || ['sea', 'river'].includes(day.ride?.travels) || day.terrain === 'Open sea') return 'ship';
  if (day.terrain === 'Coast') return 'shore';
  return null;
}
/** Where the party is after this many miles of a journey, along its route (null if the route isn't on the map). */
function journeyAt(j, miles) {
  let pts = routePts(j);
  if (!pts || !j.miles) return null;
  // In legs, each leg's miles map onto its own stretch of the route, so the party is at the port when the leg ends there.
  if (j.legs?.length > 1 && j.route) {
    const k = G.journeyLeg(j, miles), start = k ? j.legs[k - 1].end : 0;
    pts = pts.slice(k ? j.legs[k - 1].pt : 0, j.legs[k].pt + 1);
    const span = j.legs[k].end - start;
    let go = Math.max(0, Math.min(1, span ? (miles - start) / span : 1)) * PL.routeMiles(pts);
    for (let i = 1; i < pts.length; i++) {
      const leg = PL.milesBetween(pts[i - 1], pts[i]);
      if (go <= leg || i === pts.length - 1) { const t = leg ? Math.min(1, go / leg) : 1; return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]; }
      go -= leg;
    }
    return pts.at(-1);
  }
  let go = Math.max(0, Math.min(1, miles / j.miles)) * PL.routeMiles(pts);
  for (let i = 1; i < pts.length; i++) {
    const leg = PL.milesBetween(pts[i - 1], pts[i]);
    if (go <= leg || i === pts.length - 1) {
      const t = leg ? Math.min(1, go / leg) : 1;
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
    }
    go -= leg;
  }
  return pts[0];
}
/** Look out from the water on each day from `from` on that hasn't looked yet. Changes the journey's days in place. */
function seaLookout(j, from = 0) {
  if (!state.data.places?.sea) return j;
  const places = seaPlaces(), anchors = landAnchors(), taken = takenTitles();
  let done = j.days.slice(0, from).reduce((t, d) => t + (d.miles || 0), 0);
  j.days = j.days.map((d, i) => {
    const start = done;
    done += d.miles || 0;
    if (i < from || d.sea !== undefined) return d;
    const by = seaWay(d);
    const s = by && PL.seaSightings(state.data, { a: journeyAt(j, start), b: journeyAt(j, start + (d.miles || 0)), by, weather: d.weather?.name, openSea: ['Open sea', 'Coast'].includes(d.terrain), places, anchors, taken }, Math.random);
    return { ...d, sea: s && (s.passing.length || s.found) ? s : null };
  });
  return j;
}
/** Sea sightings the DM hasn't dealt with yet, newest day first. */
const seaOffers = j => j.days.map((d, i) => ({ d, i })).filter(({ d }) => d.sea && !d.sea.settled && (d.sea.passing?.length || d.sea.found || d.sea.divert)).reverse();

function seaOfferHTML(j, { d, i }) {
  const s = d.sea, dv = s.divert;
  const head = `🌊 Day ${d.n}${s.by === 'air' ? ', from the air' : ''}:`;
  if (dv) {
    const page = dv.page && resolve(dv.page) && state.pages.get(resolve(dv.page));
    const canMark = !dv.page && dv.to === 'found' && s.found?.marks && s.found?.map;
    const share = G.divertShare(dv), got = G.twistLoot(dv.twist);
    const prize = dv.loot ? `${esc(dv.loot.coins)} spirit coins${dv.loot.cores ? ' and monster cores' : ''}${dv.loot.essence ? ` and a ${esc(dv.loot.essence)}` : ''}` : '';
    const loot = !dv.loot ? (dv.twist?.type === 'empty' ? '' : ' They find nothing worth taking.') : got === 'yes' ? ` They come away with ${prize}.` : got === 'open' ? ` The prize, if they get it: ${prize}.` : ` They leave without the prize (${prize}).`;
    return `<div class="place-offer sea-offer">${head} the party diverted to explore <b>${esc(dv.page || (dv.tier === 'fleeting' ? `the ${dv.label}` : dv.name))}</b>, taking ${share >= 1 ? 'the whole day' : share >= 0.5 ? 'half the day or more' : 'a few hours'}: ${esc(dv.find)}${loot}
      ${twistHTML(dv, i)}
      ${dv.encounter?.groups?.length ? `<button class="btn" data-sea-fight="${i}" title="Open the fight in the Encounter generator, with stat cards">The fight</button>` : ''}
      ${canMark ? `<button class="btn" data-sea-mark="${i}" title="Make it a page with a pin on the World map, known to the players">Mark it on the map</button>` : ''}
      ${page?.meta.dmOnly ? `<button class="btn" data-sea-reveal="${esc(page.id)}" title="The party has been there: let the players see its page">Reveal to players</button>` : ''}
      <button class="mini-reroll" data-sea-again="${i}" title="Roll what they find again">↻</button>
      <button class="btn" data-sea-undo="${i}" title="They didn't go after all: get the time back">Undo</button>
      <button class="btn" data-sea-done="${i}" title="Put this away; the day's log keeps what happened">Done</button></div>`;
  }
  const rows = (s.passing || []).map(p => `<span class="sea-sight">the party passes <b>${esc(p.title)}</b> (${p.miles ? `${p.miles} miles off` : 'right on the course'}${p.hidden ? ', not known to the players' : ''})
      <button class="btn" data-sea-divert="${i}" data-sea-to="${esc(p.title)}" title="Leave the course to explore it">Divert to explore</button></span>`);
  if (s.found) rows.push(`<span class="sea-sight">the party spots <b>${esc(s.found.tier === 'fleeting' ? s.found.label : s.found.name)}</b>${s.found.tier === 'fleeting' ? '' : ` (${esc(s.found.label)}, not on any map)`}: ${esc(s.found.description)}
      <button class="mini-reroll" data-sea-refind="${i}" title="Something else">↻</button>
      <button class="btn" data-sea-divert="${i}" data-sea-to="found" title="Leave the course to explore it">Divert to explore</button>
      ${s.found.marks && s.found.map ? `<button class="btn" data-sea-mark="${i}" title="Make it a page with a pin on the World map, known to the players">Mark it on the map</button>` : ''}</span>`);
  return `<div class="place-offer sea-offer">${head} ${rows.join('<br>')} <button class="btn" data-sea-done="${i}" title="Sail on without stopping">Sail on</button></div>`;
}

/** What went wrong on a diversion, with the DM's controls: pick or reroll it, mark checks, make the choice. */
function twistHTML(dv, i, w = 'sea') {
  const t = dv.twist;
  const pickType = `<select class="twist-type" data-twist-type="${i}" data-w="${w}" title="What goes wrong: pick one to roll it, or Random for the usual odds">
      <option value="">Random</option>${G.TWIST_TYPES.map(k => `<option value="${k}" ${t?.type === k ? 'selected' : ''}>${G.TWIST_NAMES[k]}</option>`).join('')}<option value="none" ${t ? '' : 'selected'}>Nothing goes wrong</option></select>
    ${t ? `<button class="mini-reroll" data-twist-again="${i}" data-w="${w}" title="Another one of the same sort">↻</button>` : ''}`;
  if (!t) return `<div class="twist twist-none">✓ Nothing goes wrong. ${pickType}</div>`;
  const mark = (pass, fail) => ['pass', 'fail'].map(r => `<button class="btn ${t.result === r ? 'primary' : ''}" data-twist-result="${i}" data-w="${w}" data-r="${r}">${r === 'pass' ? pass : fail}</button>`).join('');
  let body = esc(t.text);
  if (t.type === 'fight') body += ' <span class="muted">(open it below with The fight)</span>';
  if (t.type === 'hazard') body += ` <span class="twist-check">${esc(t.check)}.</span> ${mark('Passed', 'Failed')}
      <span class="${t.result === 'fail' ? '' : 'muted'}">${t.result === 'fail' ? '' : 'On a failure: '}${esc(t.fail)}${t.lose ? ` ${t.result === 'fail' ? 'It costs' : 'It would cost'} ${t.lose >= 0.5 ? 'half a day' : 'a few hours'} more.` : ''}</span>`;
  if (t.type === 'puzzle') {
    const p = t.puzzle || {};
    body += ` ${mark('Solved', 'Gave up or failed')}
      <details class="twist-puzzle"><summary>${esc(p.name || 'The puzzle')}</summary>
        <p>${esc(p.setup || '')}</p>${(p.clues || []).length ? `<p><b>Clues:</b></p><ul>${p.clues.map(c => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
        ${p.table ? `<p><b>At the table:</b> ${esc(p.table)}</p>` : ''}
        <p><b>Solution:</b> ${esc(p.solution || '')}</p>${(p.hints || []).map(h => `<p class="muted">Hint (DC ${h.dc} ${esc(h.check)}): ${esc(h.text)}</p>`).join('')}
        ${p.failure ? `<p><b>On a failure:</b> ${esc(p.failure)}</p>` : ''}${p.reward ? `<p><b>Reward:</b> ${esc(p.reward)}</p>` : ''}</details>
      ${t.result === 'fail' ? '<span>No prize, and the attempts cost a few more hours.</span>' : ''}`;
  }
  if (t.type === 'dilemma') {
    const c = t.choices?.[t.chose];
    body += `<br>${(t.choices || []).map((x, k) => `<button class="btn ${t.chose === k ? 'primary' : ''}" data-twist-choose="${i}" data-w="${w}" data-k="${k}" title="${esc(x.text)}">${esc(x.label)}</button>`).join(' ')}
      ${c ? `<br><span>${esc(c.text)}${c.lose ? ` It costs ${c.lose >= 0.5 ? 'half a day' : 'a few hours'} more.` : ''}</span>` : ''}`;
  }
  if (t.type === 'cost' && t.lose) body += ` <span class="muted">(${t.lose >= 0.5 ? 'half a day' : 'a few hours'} more)</span>`;
  return `<div class="twist twist-${t.type}">⚠ <b>${G.TWIST_NAMES[t.type]}:</b> ${body} ${pickType}</div>`;
}

// ---------- places near the road ----------
// Pinned places that aren't settlements (ruins, landmarks, sites) near a land day's route can be explored the same way
// as sea places: it costs part of the day, and something may go wrong.

/** Places on land the party could leave the road for: pinned, not settlements or wild regions, not in the sea. */
const landSites = () => [...state.pages.values()].filter(p => mapPoint(p) && !p.meta.sea && p.meta.type === 'location' && pinKind(p) === 'site' && !p.meta.settlement
  && ![].concat(p.meta.tags || []).map(t => String(t).toLowerCase()).some(t => ['hamlet', 'district', 'realm'].includes(t)))
  .map(p => ({ title: p.meta.title, map: mapPoint(p), hidden: !!p.meta.dmOnly }));
/** Look about from the road on each day from `from` on that hasn't yet. Changes the journey's days in place. */
function landLookout(j, from = 0) {
  if (!state.data.places?.onLand) return j;
  const ends = new Set([j.from?.name, j.to?.name].filter(Boolean).map(x => x.toLowerCase()));
  const places = landSites().filter(p => !ends.has(p.title.toLowerCase()));
  let done = j.days.slice(0, from).reduce((t, d) => t + (d.miles || 0), 0);
  j.days = j.days.map((d, i) => {
    const start = done;
    done += d.miles || 0;
    if (i < from || d.land !== undefined) return d;
    const way = seaWay(d);
    if (d.teleport || (way && way !== 'shore') || !(d.miles > 0)) return { ...d, land: null };
    const passing = PL.landSightings(state.data, { a: journeyAt(j, start), b: journeyAt(j, start + d.miles), weather: d.weather?.name, places });
    return { ...d, land: passing?.length ? { passing } : null };
  });
  return j;
}
/** Both look-outs: the sea and the land. */
const lookout = (j, from = 0) => landLookout(seaLookout(j, from), from);
/** Places near the road the DM hasn't dealt with yet, newest day first. */
const landOffers = j => j.days.map((d, i) => ({ d, i })).filter(({ d }) => d.land && !d.land.settled && (d.land.passing?.length || d.land.divert)).reverse();

function landOfferHTML(j, { d, i }) {
  const s = d.land, dv = s.divert;
  const head = `🧭 Day ${d.n}:`;
  if (dv) {
    const page = resolve(dv.page) && state.pages.get(resolve(dv.page));
    const share = G.divertShare(dv), got = G.twistLoot(dv.twist);
    const prize = dv.loot ? `${esc(dv.loot.coins)} spirit coins${dv.loot.cores ? ' and monster cores' : ''}${dv.loot.essence ? ` and a ${esc(dv.loot.essence)}` : ''}` : '';
    const loot = !dv.loot ? (dv.twist?.type === 'empty' ? '' : ' They find nothing worth taking.') : got === 'yes' ? ` They come away with ${prize}.` : got === 'open' ? ` The prize, if they get it: ${prize}.` : ` They leave without the prize (${prize}).`;
    return `<div class="place-offer land-offer">${head} the party left the road to explore <b>${esc(dv.page)}</b>, taking ${share >= 1 ? 'the whole day' : share >= 0.5 ? 'half the day or more' : 'a few hours'}: ${esc(dv.find)}${loot}
      ${twistHTML(dv, i, 'land')}
      ${dv.encounter?.groups?.length ? `<button class="btn" data-land-fight="${i}" title="Open the fight in the Encounter generator, with stat cards">The fight</button>` : ''}
      ${page?.meta.dmOnly ? `<button class="btn" data-sea-reveal="${esc(page.id)}" title="The party has been there: let the players see its page">Reveal to players</button>` : ''}
      <button class="mini-reroll" data-land-again="${i}" title="Roll what they find again">↻</button>
      <button class="btn" data-land-undo="${i}" title="They didn't go after all: get the time back">Undo</button>
      <button class="btn" data-land-done="${i}" title="Put this away; the day's log keeps what happened">Done</button></div>`;
  }
  const rows = s.passing.map(p => `<span class="sea-sight">the party passes near <b>${esc(p.title)}</b> (${p.miles ? `${p.miles} mile${p.miles === 1 ? '' : 's'} off` : 'right by the road'}${p.hidden ? ', not known to the players' : ''})
      <button class="btn" data-land-divert="${i}" data-land-to="${esc(p.title)}" title="Leave the road to explore it">Divert to explore</button></span>`);
  return `<div class="place-offer land-offer">${head} ${rows.join('<br>')} <button class="btn" data-land-done="${i}" title="Keep to the road">Walk on</button></div>`;
}

/** Explore a place near the road: costs part of the day, and something may go wrong. */
function landDivert(j, i, to) {
  const d = j.days[i], s = d.land, L = state.data.places.onLand;
  const p = s.passing.find(x => x.title === to);
  if (!p) return null;
  const pace = d.pace || d.basePace || 24;
  const terrain = (state.data.travel?.terrains || []).find(t => t.name === d.terrain);
  const themes = terrain?.themes?.length ? terrain.themes : ['any'];
  const dv = { to, name: to, page: to, where: 'land', tier: 'place', label: 'place', theme: G.pick(Math.random, themes),
    frac: Math.min(1, Math.round(((Number(L.cost) || 0.25) + (pace > 0 ? 2 * p.miles / pace : 0)) * 100) / 100), find: G.pick(Math.random, L.finds || []) || 'Nothing much, in the end: a story to tell.' };
  setTwist(dv, G.exploreTwist(state.data, twistCtx(dv)), G.chance(Math.random, Number(L.loot) || 0.35));
  const days = [...j.days];
  days[i] = { ...d, land: { ...s, divert: dv } };
  return G.settleJourney({ ...j, days });
}

function wireLandOffers(j, box) {
  const save = async (next, i) => {
    await saveJourney(next);
    const session = next.days[i]?.logged && resolve(next.days[i].logged);
    if (session) await logJourney(session);
    showGenResult();
  };
  const setLand = (i, land) => { const days = [...j.days]; days[i] = { ...days[i], land }; return { ...j, days }; };
  $$('[data-land-divert]', box).forEach(b => b.onclick = async () => {
    const i = Number(b.dataset.landDivert), next = landDivert(j, i, b.dataset.landTo);
    if (next) await save(next, i);
  });
  $$('[data-land-again]', box).forEach(b => b.onclick = async () => {
    const i = Number(b.dataset.landAgain), next = landDivert(j, i, j.days[i].land.divert.to);
    if (next) await save(next, i);
  });
  $$('[data-land-undo]', box).forEach(b => b.onclick = async () => {
    const i = Number(b.dataset.landUndo);
    const { divert, ...rest } = j.days[i].land;
    await save(G.settleJourney(setLand(i, rest)), i);
  });
  $$('[data-land-done]', box).forEach(b => b.onclick = async () => {
    const i = Number(b.dataset.landDone);
    await save(setLand(i, { ...j.days[i].land, settled: true }), i);
  });
  $$('[data-land-fight]', box).forEach(b => b.onclick = () => {
    const dv = j.days[Number(b.dataset.landFight)].land.divert;
    state.gen.encounter = { ...dv.encounter, where: dv.page };
    state.gen.tab = 'encounter';
    renderGenerators();
  });
}

// ---------- rides offered on the road ----------
// A Faster rides event (a barge, a caravan, a sky ship) is an offer. The DM takes it up or turns it down; taking it
// pays the fare from the party purse, and the ride sets the pace from the next day.

/** Ride offers waiting for an answer, newest day first. One with a check waits until the check is passed. */
const rideOffers = j => j.days.map((d, i) => ({ d, i, e: d.event?.hit ? d.event.event : null }))
  .filter(({ d, e }) => e?.ride && e.offer === 'open' && (!e.check || e.result === 'pass') && !d.arrived && !j.days.at(-1)?.arrived).reverse();
const rideFare = e => G.rideFee(e.cost, { people: pcs().length || Number(travelOpts().partySize) || 4, days: e.ride.days });

function rideOfferHTML(j, { d, i, e }) {
  const fee = rideFare(e);
  const cost = fee ? `${G.formatSpirit(fee.total)} for the party (${esc(e.cost)})` : e.cost ? esc(e.cost) : 'nothing';
  return `<div class="place-offer ride-offer">🛞 Day ${d.n}: <b>${esc(e.ride.name)}</b> offers the party a ride: about ${e.ride.miles} miles a day${e.ride.flies ? ', flying' : ''} for ${e.ride.days} day${e.ride.days > 1 ? 's' : ''}, from day ${d.n + 1}. Fare: ${cost}.
    <button class="btn primary" data-ride-take="${i}" title="Take the ride${fee ? ' and pay the fare from the party purse' : ''}">Take the ride</button>
    <button class="btn" data-ride-decline="${i}" title="Keep going at their own pace">Turn it down</button></div>`;
}

function wireRideOffers(j, box) {
  const save = async (next, i) => {
    const settled = G.settleJourney(next);
    await saveJourney(settled);
    const session = settled.days[i]?.logged && resolve(settled.days[i].logged);
    if (session) await logJourney(session);
    showGenResult();
  };
  const setOffer = (i, offer, paid) => { const days = [...j.days]; days[i] = G.setRideOffer(days[i], offer, paid); return { ...j, days }; };
  $$('[data-ride-take]', box).forEach(b => b.onclick = async () => {
    const i = Number(b.dataset.rideTake), e = j.days[i].event.event, fee = rideFare(e);
    let paid = null;
    if (fee || e.cost) {
      const people = pcs().length || Number(travelOpts().partySize) || 4;
      const r = await formDialog(`Take the ${e.ride.name.toLowerCase().replace(/^(a|an|the) /, '')}?`, `<p class="muted" style="margin:0 0 10px">${esc(e.text)} The fare: ${esc(e.cost || 'nothing')}.${fee ? ` For ${fee.perHead ? `${people} traveller${people === 1 ? '' : 's'}` : 'the party'}${fee.perDay ? ` over ${e.ride.days} day${e.ride.days > 1 ? 's' : ''}` : ''} that is ${esc(G.formatSpirit(fee.total))} spirit coins.` : ''}</p>
        <label class="field" style="width:200px" title="What the party actually pays: haggled, a favour instead, or the fare as it stands">Fare to pay (spirit coins, in gp)<input name="total" type="number" min="0" value="${fee ? fee.total : 0}"></label>
        ${payFromField(fee ? 'purse' : 'none', 'Pay from', "Nobody: it's free or settled another way")}`, 'Take the ride');
      if (!r) return;
      const total = Math.max(0, Math.round(Number(r.total) || 0));
      if (r.payFrom !== 'none' && total > 0) {
        if (!(await payFrom(r.payFrom, total, 'the fare'))) return;
        paid = total;
      }
    }
    await save(setOffer(i, 'taken', paid), i);
    toast(`The party rides the ${e.ride.name.toLowerCase().replace(/^(a|an|the) /, '')} from tomorrow${paid ? `, ${G.formatSpirit(paid)} lighter` : ''}.`);
  });
  $$('[data-ride-decline]', box).forEach(b => b.onclick = async () => {
    const i = Number(b.dataset.rideDecline);
    await save(setOffer(i, 'declined'), i);
  });
  $$('[data-ride-reset]', box).forEach(b => b.onclick = async ev => {
    ev.preventDefault();
    const i = Number(b.dataset.rideReset), e = j.days[i].event.event;
    if (e.paid) await addToPurse(e.paid, `the ${e.ride.name.toLowerCase().replace(/^(a|an|the) /, '')} fare`);
    await save(setOffer(i, 'open'), i);
  });
}

/** Explore a sea place off the course: costs part of the day, and may bring a fight and some loot. */
function seaDivert(j, i, to) {
  const d = j.days[i], s = d.sea;
  const target = to === 'found' ? s.found : seaPlaces().find(p => p.title === to);
  if (!target) return null;
  const kind = PL.seaKind(state.data, target.sea || target.kind);
  const off = to === 'found' ? s.found.offRoute ?? 2 : s.passing.find(p => p.title === to)?.miles ?? 0;
  const o = travelOpts();
  const x = PL.exploreSea(kind, { offMiles: off, pace: d.pace || d.basePace || 24 });
  const lvl = Number(o.level) || state.gen.opts.level || 1;
  const dv = { to, name: to === 'found' ? s.found.name : target.title, tier: to === 'found' ? s.found.tier : 'place', label: kind?.label || '', frac: x.frac, find: x.find, check: x.check, kind: kind?.key || '', seen: target.seen || kind?.seen || '' };
  if (to !== 'found') dv.page = target.title; else if (s.found.page) dv.page = s.found.page;
  setTwist(dv, G.exploreTwist(state.data, twistCtx(dv, kind)), x.loot);
  const days = [...j.days];
  days[i] = { ...d, sea: { ...s, divert: dv } };
  return G.settleJourney({ ...j, days });
}
/** What exploreTwist needs to know about a diversion. type: force one sort of twist ('' rolls, 'none' for none). */
function twistCtx(dv, kind = dv.where === 'land' ? null : PL.seaKind(state.data, dv.kind || seaPlaces().find(p => p.title === dv.page)?.sea), type = '') {
  const o = travelOpts();
  return { level: Number(o.level) || state.gen.opts.level || 1, risk: o.explore || 'normal', danger: kind?.explore?.danger ?? 0.25, seen: dv.seen, place: dv.label || 'place', type, where: dv.where || 'sea' };
}
/** Puts a twist on a diversion, with the fight and loot that go with it. hadLoot: the place's own loot roll came up
 * (left out, the loot stays as it is). */
function setTwist(dv, t, hadLoot) {
  const o = travelOpts(), lvl = Number(o.level) || state.gen.opts.level || 1;
  const was = dv.twist;
  dv.twist = t || null;
  const fights = t?.type === 'fight' || (t?.type === 'dilemma' && t.choices?.[t.chose]?.fight);
  if (fights && !dv.encounter?.groups?.length) dv.encounter = G.generateEncounter(state.data, { level: lvl, partySize: Number(o.partySize) || 4, difficulty: o.difficulty || 'moderate', theme: dv.theme || 'Water', kinds: [] });
  if (!fights) delete dv.encounter;
  // Trouble usually guards something worth having; an empty place has nothing.
  const wantLoot = t?.type === 'empty' ? false : hadLoot !== undefined ? hadLoot || (!!t && G.chance(Math.random, 0.5))
    : !!dv.loot || (!!t && was?.type === 'empty' && G.chance(Math.random, 0.6));
  if (wantLoot && !dv.loot) dv.loot = G.travelLoot(state.data, lvl, dv.theme || 'Water', Math.random);
  if (!wantLoot) delete dv.loot;
  return dv;
}

function wireSeaOffers(j, box) {
  const save = async (next, i) => {
    await saveJourney(next);
    // A day already in the session notes is written again with what changed.
    const session = next.days[i]?.logged && resolve(next.days[i].logged);
    if (session) await logJourney(session);
    showGenResult();
  };
  const setSea = (i, sea) => { const days = [...j.days]; days[i] = { ...days[i], sea }; return { ...j, days }; };
  $$('[data-sea-divert]', box).forEach(b => b.onclick = async () => {
    const i = Number(b.dataset.seaDivert);
    const next = seaDivert(j, i, b.dataset.seaTo);
    if (next) await save(next, i);
  });
  $$('[data-sea-again]', box).forEach(b => b.onclick = async () => {
    const i = Number(b.dataset.seaAgain), dv = j.days[i].sea.divert;
    const next = seaDivert(j, i, dv.to);
    if (next) { if (dv.page) next.days[i].sea.divert.page = dv.page; await save(next, i); }
  });
  // What went wrong, on a diversion at sea (day.sea) or on land (day.land).
  const setDivert = (i, w, f) => {
    const dv = structuredClone(j.days[i][w].divert);
    f(dv);
    const days = [...j.days];
    days[i] = { ...days[i], [w]: { ...days[i][w], divert: dv } };
    return G.settleJourney({ ...j, days });
  };
  $$('[data-twist-type]', box).forEach(el => el.onchange = async () => {
    const i = Number(el.dataset.twistType);
    await save(setDivert(i, el.dataset.w, dv => setTwist(dv, G.exploreTwist(state.data, twistCtx(dv, undefined, el.value)))), i);
  });
  $$('[data-twist-again]', box).forEach(b => b.onclick = async () => {
    const i = Number(b.dataset.twistAgain);
    await save(setDivert(i, b.dataset.w, dv => setTwist(dv, G.exploreTwist(state.data, twistCtx(dv, undefined, dv.twist.type)))), i);
  });
  $$('[data-twist-result]', box).forEach(b => b.onclick = async () => {
    const i = Number(b.dataset.twistResult);
    // Clicking the marked result again clears it.
    await save(setDivert(i, b.dataset.w, dv => { dv.twist.result = dv.twist.result === b.dataset.r ? null : b.dataset.r; }), i);
  });
  $$('[data-twist-choose]', box).forEach(b => b.onclick = async () => {
    const i = Number(b.dataset.twistChoose), k = Number(b.dataset.k);
    await save(setDivert(i, b.dataset.w, dv => { dv.twist.chose = dv.twist.chose === k ? null : k; setTwist(dv, dv.twist); }), i);
  });
  $$('[data-sea-undo]', box).forEach(b => b.onclick = async () => {
    const i = Number(b.dataset.seaUndo);
    const { divert, ...rest } = j.days[i].sea;
    await save(G.settleJourney(setSea(i, rest)), i);
  });
  $$('[data-sea-done]', box).forEach(b => b.onclick = async () => {
    const i = Number(b.dataset.seaDone);
    await save(setSea(i, { ...j.days[i].sea, settled: true }), i);
  });
  $$('[data-sea-refind]', box).forEach(b => b.onclick = async () => {
    const i = Number(b.dataset.seaRefind), s = j.days[i].sea;
    const at = s.found?.map;
    const opts = { by: s.by === 'air' ? 'air' : 'ship', taken: takenTitles(), places: landAnchors() };
    const tier = G.chance(Math.random, state.data.places.sea.settings?.findMinor ?? 0.4) && at ? 'minor' : 'fleeting';
    const f = PL.generateSeaPlace(state.data, tier, { ...opts, at: at || [0, 0] }) || PL.generateSeaPlace(state.data, 'fleeting', { ...opts, at: at || [0, 0] });
    if (!f) return toast('Nothing else turns up.', true);
    if (!at) { f.map = null; f.marks = false; }
    f.offRoute = s.found?.offRoute ?? 2;
    await save(setSea(i, { ...s, found: f }), i);
  });
  $$('[data-sea-mark]', box).forEach(b => b.onclick = async () => {
    const i = Number(b.dataset.seaMark), s = j.days[i].sea, f = { ...s.found };
    const made = await keepSeaPlaces([f], { hidden: false, from: `Found by the party on day ${j.days[i].n} of ${G.journeyTitle(j).replace(/^Journey: /, 'the journey from ')}.` });
    if (!made && !resolve(f.name)) return;
    const sea = { ...s, found: { ...s.found, page: f.name, kept: true } };
    if (sea.divert?.to === 'found') sea.divert = { ...sea.divert, page: f.name };
    toast(`${f.name} is on the World map now.`);
    await save(setSea(i, sea), i);
  });
  $$('[data-sea-reveal]', box).forEach(b => b.onclick = async () => { await toggleReveal(b.dataset.seaReveal); showGenResult(); });
  $$('[data-sea-fight]', box).forEach(b => b.onclick = () => {
    const d = j.days[Number(b.dataset.seaFight)];
    state.gen.encounter = { ...d.sea.divert.encounter, where: d.sea.divert.page || d.sea.divert.name };
    state.gen.tab = 'encounter';
    renderGenerators();
  });
  $('#travel-seed-sea')?.addEventListener('click', () => {
    const [w, s, e, n] = routeBox(routePts(j));
    const pad = Math.max(3, (e - w) * 0.15, (n - s) * 0.15);
    const box = [w - pad, s - pad, e + pad, n + pad];
    const [x0, y1] = mapXY([box[0], box[1]]), [x1, y0] = mapXY([box[2], box[3]]);
    (state.map ||= { vb: null, tool: null, draft: [] }).vb = [x0, y0, x1 - x0, y1 - y0];
    askSeedSea(box, 'the sea along this route');
  });
}
/** A journey by sea or air whose route crosses water with no sea places near it gets a button to add some. */
function seaRouteEmpty(j) {
  if (!state.data.places?.sea || !j.from?.at || !j.to?.at || !j.days.some(d => ['air', 'ship'].includes(seaWay(d)))) return false;
  const pts = [0.25, 0.5, 0.75].map(t => journeyAt({ ...j, miles: 1 }, t));
  if (pts.every(p => PL.onLand(p))) return false;
  const reach = Math.max(150, (j.miles || 0) * 0.3);
  return !seaPlaces().some(p => pts.some(q => PL.milesBetween(q, p.map) <= reach));
}

// ---------- regional problems ----------
// Kept with the campaign (state.saved.problems). A place page shows every active problem whose circle reaches it,
// worked out when the page is drawn, so solving one clears it from every page at once.

const problems = () => (state.saved.problems ||= []);
const saveProblems = () => attempt(() => api.saved.write(state.saved));

/** Where a page is for problems: its own pin, or the pin of the nearest page above it (a tavern in a town). */
function problemHere(p) {
  for (let q = p, i = 0; q && i < 8; q = q.meta.parent ? state.pages.get(resolve(q.meta.parent)) : null, i++) {
    if (mapPoint(q)) {
      const a = placeAnchor(q.meta.title);
      return { title: q.meta.title, map: mapPoint(q), style: a?.style || '', settlement: G.settlementFor(state.data, q.meta.title, q.meta) || 'village' };
    }
  }
  return null;
}

/** The "Troubles in the area" box on a place page. */
function troublesSection(p) {
  const here = p.meta.type === 'location' && state.saved && problemHere(p);
  if (!here || !state.data.places) return '';
  const now = PL.problemsAt(problems(), here.map);
  const past = PL.problemsAt(problems(), here.map, { solved: true }).slice(0, 3);
  const dm = '<button class="btn small dm-tool" data-add-problem title="Start a problem centred here, such as wolves or bandits, that every place nearby will show">+ Add a trouble here</button>';
  if (!now.length && !past.length) return `<section class="troubles empty-troubles dm-tool">${dm}</section>`;
  return `<section class="troubles"><h2>Troubles in the area</h2>
    ${now.length ? `<ul>${now.map(x => { const l = PL.problemLine(x, here); return `<li><b>${esc(l.name)}</b> <span class="muted">(${esc(l.where)})</span>: ${esc(l.text)}
      <span class="dm-tool"><button class="btn small" data-solve-problem="${esc(x.id)}" title="It's dealt with: clear it from every place it reached">Solved</button>
      <button class="btn small" data-remove-problem="${esc(x.id)}" title="Take it away without it being solved">Remove</button></span></li>`; }).join('')}</ul>` : ''}
    ${past.length ? `<p class="muted">Recent history: ${past.map(x => `${esc(x.name)} ${x.origin === here.title ? 'here' : `around ${esc(x.origin)}`} was dealt with${x.solved ? ` (${esc(x.solved)})` : ''}`).join('; ')}.</p>` : ''}
    ${dm}</section>`;
}

function wireTroubles(p) {
  const again = () => renderPage(p.id);
  $('[data-add-problem]')?.addEventListener('click', async () => { if (await addProblem(problemHere(p))) again(); });
  $$('[data-solve-problem]').forEach(b => b.onclick = async () => { if (await solveProblem(b.dataset.solveProblem)) again(); });
  $$('[data-remove-problem]').forEach(b => b.onclick = async () => {
    const x = problems().find(q => q.id === b.dataset.removeProblem);
    if (!x || !(await confirmDialog(`Remove "${x.name}"?`, 'It goes from every place it reached, without counting as solved.', 'Remove'))) return;
    state.saved.problems = problems().filter(q => q !== x);
    await saveProblems();
    again();
  });
}

/** Ask what kind of problem to start at a place, and how far it reaches. */
async function addProblem(here) {
  if (!here) return null;
  const kinds = PL.problemsFor(state.data, here.style);
  const r = await formDialog(`A trouble around ${here.title}`, `
    <label class="field">What<select name="kind"><option value="">Roll one for the region</option>${kinds.map((k, i) => `<option value="${i}">${esc(k.name)}</option>`).join('')}<option value="custom">Something else…</option></select></label>
    <label class="field">Name (for something else)<input name="name" placeholder="The drowned bell"></label>
    <label class="field">What is happening<input name="summary" placeholder="Shown on every place it reaches"></label>
    <label class="field">Reaches (miles)<input name="radius" type="number" min="1" max="1000" placeholder="25 to 60"></label>`, 'Start it');
  if (!r) return null;
  const custom = r.kind === 'custom' ? { name: r.name || 'Trouble', summary: r.summary || '', effect: '' } : r.kind !== '' ? kinds[Number(r.kind)] : null;
  const x = PL.newProblem(state.data, here, Math.random, custom);
  if (!x) return null;
  if (r.kind !== 'custom' && r.summary) x.summary = r.summary;
  if (Number(r.radius) > 0) x.radius = Number(r.radius);
  x.startedDay = today();
  problems().push(x);
  await chronicle({ kind: 'trouble', title: `${x.name} near ${here.title}`, text: x.summary, places: [here.title], tags: ['trouble'], at: here.map, source: x.id });
  toast(`${x.name}: every place within ${x.radius} miles of ${here.title} now shows it.`);
  return x;
}

const lc1 = t => t ? t[0].toLowerCase() + t.slice(1) : t;
/** Mark a problem solved: offer each place it reached a reward or goodwill, and note it in the session. */
async function solveProblem(id) {
  const x = problems().find(q => q.id === id);
  if (!x) return false;
  const places = pinnedPlaces().map(n => { const pg = state.pages.get(resolve(n.title)); return { ...n, settlement: pg && G.settlementFor(state.data, n.title, pg.meta) || 'village' }; });
  const rewards = PL.problemRewards(state.data, x, places);
  const latest = sessionPages()[0];
  const r = await formDialog(`${x.name} is dealt with`, `
    <p class="muted" style="margin:0 0 8px">It clears from every place it reached. Tick the thanks the party gets.</p>
    <div class="reward-list">${rewards.map((w, i) => `<label class="check"><input type="checkbox" name="r${i}" checked> <span><b>${esc(w.title)}</b>: ${esc(G.formatSpirit(w.gp))} spirit coins, or ${esc(lc1(w.goodwill))}</span></label>`).join('') || '<p class="muted">No pinned places are in reach.</p>'}</div>
    ${latest ? `<label class="check"><input type="checkbox" name="notes" checked> Add it to the notes of ${esc(latest.meta.title)}</label>` : ''}`, 'Solved');
  if (!r) return false;
  const kept = rewards.filter((w, i) => r[`r${i}`]);
  Object.assign(x, { status: 'solved', solved: new Date().toISOString().slice(0, 10), solvedDay: today(), rewards: kept });
  const R = state.data.story?.reputation || {};
  const region = regionOf(x.origin);
  const done = state.data.story ? applyRep([
    ...rewards.map(w => ({ kind: 'place', title: w.title, delta: w.near ? R.troubleNear ?? 10 : R.troubleFar ?? 5 })),
    ...(region ? [{ kind: 'region', title: region, delta: R.troubleRenown ?? 4 }] : []),
  ], `Dealt with ${x.name}`) : [];
  const ce = await chronicle({ kind: 'trouble', title: `${x.name} dealt with`, text: `${x.summary} The party put an end to it, and the places around ${x.origin} are breathing again.`, places: [x.origin, ...kept.map(w => w.title).filter(t => t !== x.origin)], tags: ['trouble', 'party'], at: x.centre, source: x.id });
  if (done.length) { ce.rep = done; await saveWorld(); }
  if (latest && r.notes) await attempt(async () => {
    const md = [`### Solved: ${x.name}`, '', `${x.summary} It reached ${rewards.length} place${rewards.length === 1 ? '' : 's'} around [[${x.origin}]].`,
      ...(kept.length ? ['', 'Thanks offered:', ...kept.map(w => `- [[${w.title}]]: ${G.formatSpirit(w.gp)} spirit coins, or ${lc1(w.goodwill)}`)] : [])].join('\n');
    latest.body = G.putSection(latest.body, `problem ${x.id}`, md);
    await api.pages.write(latest.id, latest.meta, latest.body);
  });
  toast(`${x.name} is solved and cleared from every place.`);
  return true;
}

/** Drafts on a contract board that haven't been taken down. */
const boardDrafts = board => (board?.contracts || []).map(c => c.newPlace && { ...c.newPlace, from: G.contractTitle(c) }).filter(Boolean);

function runGenerator(opts) {
  const g = state.gen;
  const d = state.data;
  try {
    if (g.tab === 'npc') {
      const at = rollPlace(opts.where);
      g.npc = G.generateNPC(d, { style: (at ? at.style : placeAnchor('')?.style) || '', ...opts, peopleMix: at?.mix, wiki: wikiTitles(), newPlace: npcPlaces() });
      if (at?.page) g.npc.where = at.title;
    }
    if (g.tab === 'astral') g.astral = G.generateAstralSpace(d, opts);
    if (g.tab === 'encounter') g.encounter = rollEncounter(opts);
    // A location page can say what kind of settlement it is with a `settlement` field.
    const whereMeta = opts.where && state.pages.get(resolve(opts.where))?.meta;
    if (g.tab === 'market') g.market = G.generateMarket(d, { ...opts, whereMeta, wiki: wikiTitles() });
    if (g.tab === 'auction') g.auction = G.generateAuction(d, { ...opts, whereMeta, wiki: wikiTitles() });
    if (g.tab === 'tavern') g.tavern = G.generateTavern(d, { ...opts, wiki: wikiTitles() });
    if (g.tab === 'contracts') {
      const here = opts.where && state.pages.get(resolve(opts.where));
      const near = here && problemHere(here);
      g.contracts = G.generateContractBoard(d, { ...opts, whereMeta, wiki: wikiTitles(), placeInfo, newPlace: placeMaker(opts.where), problems: near ? PL.problemsAt(problems(), near.map) : [] });
      if (!g.contracts) toast('The contracts list is missing. Reset "contracts" under Generator lists.', true);
    }
    if (g.tab === 'visit') g.visit = prepVisit(opts);
    if (g.tab === 'treasure') g.treasure = R.treasure(d, { rank: opts.rank, kind: opts.kind, theme: opts.theme }, Math.random);
    if (g.tab === 'words') {
      g.wordHistory ||= [];
      if (g.words) g.wordHistory = [g.words, ...g.wordHistory].slice(0, 10);
      g.words = G.drawWords(d, wordOpts());
      // Some draws send the story somewhere new: the Where becomes a generated place nearby.
      if (!g.wordPins?.where && !g.words.where.wiki && G.chance(Math.random, d.places?.hookChance ?? 0)) hookPlace(g.words);
    }
    g.fresh = g.tab;
    if (g.pins) g.pins[g.tab] = [];
  } catch (e) {
    console.error(e);
    toast('Generator failed: ' + e.message, true);
  }
  showGenResult();
}

function showGenResult() {
  const g = state.gen;
  const box = $('#gen-result');
  const r = g[g.tab];
  // A redraw of the same generator shimmers in whatever changed; switching tabs just shows the other one.
  const before = box._fxTab === g.tab && box.querySelector('.gen-result, .word-group') ? redrawSnapshot(box) : null;
  const oldTitle = $('#gen-title', box)?.value;
  box._fxTab = g.tab;
  if (g.tab === 'words') { showWords(box); markRedrawn(box, before); return; }
  if (g.tab === 'travel') { showTravel(box); return; }
  if (!r) { box.innerHTML = '<div class="empty">Pick options and generate. Results can be saved straight into the wiki.</div>'; return; }
  recordRoll(g.tab);
  let title, md, type, extra = '';
  let shownMd;
  if (g.tab === 'npc') { title = r.name; md = G.npcToMarkdown(r); shownMd = G.npcToMarkdown(r, { interactive: true }); type = 'npc'; }
  if (g.tab === 'astral') { title = r.name; md = G.astralToMarkdown(r); shownMd = G.astralToMarkdown(r, { interactive: true }); type = 'astral-space'; extra = G.astralMapSVG(r); }
  if (g.tab === 'encounter') { title = r.where || r.terrain ? `Encounter: ${r.where || r.terrain}` : 'Encounter'; md = G.encounterToMarkdown(r); shownMd = G.encounterToMarkdown(r, 'Encounter', { interactive: true }); type = 'encounter'; extra = encounterBar(r); }
  if (g.tab === 'visit') { title = `Visit: ${r.where}`; md = visitToMarkdown(r); shownMd = visitToMarkdown(r, { interactive: true }); type = 'adventure'; }
  if (g.tab === 'treasure') { title = `Treasure: ${r.kind === 'hoard' ? `${r.rank} hoard` : `${r.rank}-rank pockets`}`; md = R.treasureToMarkdown(r); shownMd = R.treasureToMarkdown(r, { interactive: true }); type = 'lore'; }
  if (g.tab === 'contracts') { title = r.name; md = G.contractsToMarkdown(r); shownMd = G.contractsToMarkdown(r, { interactive: true }); type = 'lore'; }
  const venue = ['market', 'tavern', 'auction'].includes(g.tab);
  const VENUE_MD = { market: G.marketToMarkdown, tavern: G.tavernToMarkdown, auction: G.auctionToMarkdown };
  const VENUE_PEOPLE = { market: x => x.stalls.map(s => s.keeper), tavern: x => [x.owner], auction: x => [x.auctioneer] };
  if (venue) {
    const toMd = VENUE_MD[g.tab];
    title = r.name; md = toMd(r); shownMd = toMd(r, { interactive: true }); type = 'location';
  }
  box.innerHTML = `<div class="gen-result">
    <div class="result-head">
      <input id="gen-title" value="${esc(title)}" title="Rename before saving">
      ${g.tab === 'npc' ? '<button class="btn" id="npc-name" title="Roll a new name; the rest of the NPC stays">New name</button>' : ''}
      ${venue ? '<button class="btn" id="venue-name" title="Roll a new name; everything else stays">New name</button>' : ''}
      ${PIN_TABS.includes(g.tab) ? `<button class="btn${g.pinMode ? ' on' : ''}" id="gen-pin" title="Pin parts: click a part to keep it, then Reroll changes everything else">📌 ${g.pinMode ? 'Pinning' : 'Pin'}${pinsOf(g.tab).length ? ` (${pinsOf(g.tab).length})` : ''}</button>` : ''}
      <button class="btn" id="gen-reroll" title="${pinsOf(g.tab).length ? 'Reroll everything that isn\'t pinned' : 'A whole new roll'}">Reroll</button>
      <button class="btn${g.playerPreview ? ' on' : ''}" id="gen-preview" title="Show only what players would see on the saved page">${g.playerPreview ? '👁 Players see' : 'Players see'}</button>
      ${PRINT_TABS[g.tab] ? `<button class="btn" id="gen-print" title="${PRINT_TABS[g.tab][1]}">🖨 Print</button>` : ''}
      ${g.tab === 'visit' ? '<button class="btn" id="visit-notes" title="Put the whole visit in the latest session\'s notes">Add to session notes</button>' : ''}
      <button class="btn primary" id="gen-save">Save to wiki</button>
    </div>
    ${rollNavHTML(g.tab)}
    ${genSummaryHTML(g.tab, r)}
    ${extra}
    ${g.tab === 'npc' ? '<p class="hint" style="margin:8px 0 0">Click any detail with a dotted underline to reroll just that part. <b>New name</b> renames the NPC everywhere it appears.</p>' : ''}
    ${g.tab === 'contracts' ? '<p class="hint" style="margin:8px 0 0">Click ↻ to reroll just that part, × to take a notice down, and <b>Save</b> to keep one contract as its own page when the party takes it. Rewards are paid in spirit coins of the contract\'s tier.</p>' : ''}
    ${venue ? `<p class="hint" style="margin:8px 0 0">Click ↻ to reroll just that part.${g.tab === 'market' ? ' <b>Buy</b> pays from the party purse or a member’s own coins and gives the goods to a party member.' : ''}${g.tab === 'auction' ? ' <b>Win this lot</b> pays the winning bid plus the premium from the party purse or a member’s own coins and gives the lot to a party member. Reserves and rival limits are in the DM notes.' : ''}
      <label class="inline-check"><input type="checkbox" id="save-people" ${g.savePeople ? 'checked' : ''}> When saving, also save the ${{ market: 'stall keepers as NPC pages', tavern: 'owner as an NPC page', auction: 'auctioneer as an NPC page' }[g.tab]}</label></p>` : ''}
    ${repHint(g.tab, r)}
    <div class="prose${g.playerPreview ? ' player-preview' : ''}">${renderMarkdown(g.playerPreview ? G.stripDM(md) : shownMd || md)}</div>
    ${g.tab === 'encounter' ? encounterCards(r, 'Stat cards', r.origin || G.encounterOrigin(r)) : g.tab === 'astral' ? encounterCards({ groups: G.astralMonsters(r) }, 'Monsters in this space', { how: `In ${G.aOrAn(r.rank)} ${r.rank}-rank astral space (${r.theme} theme)` })
      : g.tab === 'contracts' ? encounterCards({ groups: r.contracts.filter(c => c.showMonster).map(c => ({ ...c.monster, count: 1 })) }, 'Contract monsters', { how: `A contract from the Adventure Society board${r.where ? ` in ${r.where}` : ''}` }) : ''}
  </div>`;
  markRedrawn(box, before);
  if (before && oldTitle !== title && appFxOn()) $('#gen-title', box).classList.add('fx-redraw');
  wireRollNav(box);
  foldSections($('.gen-result > .prose', box));
  wireNeverRoll($('.gen-result > .prose', box));
  $('#gen-preview', box).onclick = () => { g.playerPreview = !g.playerPreview; showGenResult(); };
  if (g.tab === 'npc') {
    const reroll = part => { g.npc = G.rerollNPC(state.data, g.npc, part, Math.random, { wiki: wikiTitles(), newPlace: npcPlaces(g.npc.newPlaces) }); showGenResult(); };
    $$('.reroll', box).forEach(el => el.onclick = e => { if (e.target.closest('a')) return; reroll(el.dataset.part); });
    $('#npc-name').onclick = () => reroll('name');
  }
  if (venue) {
    const reroll = { market: G.rerollMarket, tavern: G.rerollTavern, auction: G.rerollAuction }[g.tab];
    const again = part => { g[g.tab] = reroll(state.data, g[g.tab], part, Math.random, { ...(g.opts[g.tab] || {}), wiki: wikiTitles() }); showGenResult(); };
    $$('.mini-reroll', box).forEach(b => b.onclick = e => { e.preventDefault(); again(b.dataset.part); });
    $('#venue-name').onclick = () => again('name');
    $$('.buy-btn[data-buy]', box).forEach(b => b.onclick = () => buyFromMarket(...b.dataset.buy.split(':').map(Number)));
    $$('.win-btn[data-win]', box).forEach(b => b.onclick = () => winAuctionLot(Number(b.dataset.win)));
    $('#save-people').onchange = e => { g.savePeople = e.target.checked; };
  }
  if (g.tab === 'encounter') wireEncounter(box);
  if (g.tab === 'treasure') wireTreasure(box);
  if (g.tab === 'visit') wireVisit(box);
  if (g.tab === 'astral') $$('.mini-reroll[data-part^="puzzle:"], .mini-reroll[data-part^="room:"]', box).forEach(b => b.onclick = e => {
    e.preventDefault();
    g.astral = rerollPart('astral', g.astral, b.dataset.part);
    showGenResult();
  });
  if (g.tab === 'contracts') {
    $$('.mini-reroll[data-part]', box).forEach(b => b.onclick = e => {
      e.preventDefault();
      g.contracts = G.rerollContracts(state.data, g.contracts, b.dataset.part, Math.random, { ...(g.opts.contracts || {}), wiki: wikiTitles(), placeInfo, newPlace: placeMaker(g.contracts.where || g.opts.contracts?.where, boardDrafts(g.contracts)) });
      showGenResult();
    });
    $$('.save-contract', box).forEach(b => b.onclick = async e => {
      e.preventDefault();
      const c = g.contracts.contracts[Number(b.dataset.save)];
      if (c.savedAs && resolve(c.savedAs)) return openPage(resolve(c.savedAs));
      // The place the job sends them to is kept with it, even if they never go.
      const madePlaces = c.newPlace ? await keepPlaces([c.newPlace], G.contractTitle(c)) : 0;
      let t = G.contractTitle(c);
      for (let n = 2; resolve(t); n++) t = `${G.contractTitle(c)} (${n})`;
      const id = await attempt(() => api.pages.create(t, { type: 'adventure', rank: c.tier, tags: ['generated', 'contract'] }, G.contractToMarkdown(c, g.contracts.where)));
      if (!id) return;
      state.pages.set(id, await api.pages.read(id));
      // With the world clock running, the contract's deadline counts down from today.
      if (state.saved?.world && state.data.calendar) {
        const where = g.contracts.where && state.pages.get(resolve(g.contracts.where));
        // The deadline on the notice is for taking the job; once the party accepts, they get four times as long to do it.
        const by = ST.deadlineDay(cal(), c.deadline, today());
        const e = ST.entry({ day: today(), kind: 'event', title: t, text: `The contract ${t} is on the board${where ? ` in ${where.meta.title}` : ''}.`, places: where ? [where.meta.title] : [], tags: ['contract'], at: where ? problemHere(where)?.map || null : null, isPublic: false });
        e.quest = t; e.contract = true; e.taken = false;
        e.drama = Math.max(1, Math.min(3, ['Iron', 'Bronze', 'Silver', 'Gold', 'Diamond'].indexOf(c.tier) + 1));
        if (by !== null) { e.acceptBy = by; e.window = Math.max(1, by - today()); }
        if (c.noticeDays) e.finishDays = c.noticeDays;
        if (c.destination) e.dest = c.destination;
        else e.placeName = String(c.place).replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, '$1');
        world().chronicle.push(e);
        await saveWorld();
      }
      c.savedAs = t;
      rebuildIndex(); renderTree();
      toast(`Saved "${t}" under Adventures${madePlaces ? ', and its new place on the map' : ''}`);
      showGenResult();
    });
  }
  $('#gen-reroll').onclick = () => pinsOf(g.tab).length ? rerollUnpinned() : runGenerator(g.opts[g.tab] || {});
  wirePins(box);
  $('#gen-print', box)?.addEventListener('click', () => printResult(g.tab, r));
  $('#gen-save').onclick = async () => {
    const t = $('#gen-title').value.trim() || title;
    if (resolve(t)) return toast('A page with that title already exists; rename it first', true);
    const meta = { type, rank: r.rank, tags: ['generated'] };
    // NPCs keep a likely origin, out of sight, for the origin feat on their PDF sheet.
    if (type === 'npc' && r.role) meta.origin = S.originFor(r.cover?.role || r.role, r.class);
    // Markets, taverns, auction houses, astral spaces and encounters go under the place they're in.
    if (venue || ['astral', 'encounter', 'contracts', 'treasure', 'visit'].includes(g.tab)) {
      const parent = await pickPlace(t, g.opts[g.tab]?.where || r.where || '');
      if (parent === null) return;
      if (parent) meta.parent = parent;
    }
    if (venue) {
      meta.tags.unshift(g.tab);
      if (g.tab !== 'market') delete meta.rank;
      // Keepers, owners and auctioneers become NPC pages of their own, linked from the venue's page.
      const people = g.savePeople ? VENUE_PEOPLE[g.tab](r) : [];
      for (const n of people) {
        if (resolve(n.name)) continue;
        const id = await attempt(() => api.pages.create(n.name, { type: 'npc', rank: n.rank, origin: S.originFor(n.cover?.role || n.role, n.class), tags: ['generated', n.role.toLowerCase()] }, G.npcToMarkdown(n)));
        if (id) state.pages.set(id, await api.pages.read(id));
      }
      if (people.length) { rebuildIndex(); md = VENUE_MD[g.tab](r, { linkPeople: true }); }
    }
    if (g.tab === 'npc') {
      meta.rank = r.rank; meta.tags.push((r.cover || r).role.toLowerCase());
      // An NPC rolled for a place sits under it.
      if (r.where && resolve(r.where)) meta.parent = state.pages.get(resolve(r.where)).meta.title;
      // A place the backstory invented is kept only if the saved page still names it.
      await keepPlaces((r.newPlaces || []).filter(p => md.includes(`[[${p.name}]]`)), `${t}'s backstory`);
    }
    if (g.tab === 'encounter') meta.rank = undefined;
    if (g.tab === 'treasure') meta.tags.push('treasure');
    if (g.tab === 'contracts') {
      meta.rank = undefined; meta.tags.push('contracts');
      // Every place the board names becomes a page with a pin, whether or not anyone takes the job.
      const drafts = r.contracts.filter(c => c.newPlace);
      for (const c of drafts) c.newPlace.from ||= `${G.contractTitle(c)}, on the ${t}`;
      const made = await keepPlaces(drafts.map(c => c.newPlace));
      if (made) { md = G.contractsToMarkdown(r); toast(`${made} new place${made === 1 ? '' : 's'} added to the map`); }
    }
    // Astral maps are saved as an image file so the page keeps its map.
    let body = md;
    if (g.tab === 'astral') {
      const svg = G.astralMapSVG(r).replace('<svg ', '<svg style="background:#1d1a24" ').replace(/class="([^"]+)"/g, (m0, c) => `class="${c}" ${svgInlineStyle(c)}`);
      const path = await attempt(() => api.images.save(`${t}-map.svg`, new TextEncoder().encode(svg)));
      if (path) body = `![Map of ${t}](${path})\n\n` + md;
    }
    await createPage(t, meta, body);
    toast('Saved to the wiki');
  };
}

// ---------- travel ----------
// Journeys are kept with the campaign (state.saved.journeys), so they carry over between sessions. A split party
// can have several on the go at once; the one shown is state.gen.journeyId, and any can be pinned in the sidebar.
// Places are any page on the World map; a point picked on the map stands in for a place that has no page.

/** Places a journey can start or end at: every page on the World map, by its pin or the middle of its border. */
function travelPlaces() {
  return mapPages().map(p => ({ id: p.id, name: p.meta.title, at: mapPoint(p) || mapLL(centroid(mapBorder(p).map(mapXY))), page: true }))
    .sort((a, b) => a.name.replace(/^The /, '').localeCompare(b.name.replace(/^The /, '')));
}
// The teleport circle network: every capital and city has a circle unless its page says `circle: false`,
// and any other place can have one with `circle: true`. The party can only step through to circles whose address it knows.
const circleInfo = () => ({ runBy: 'the Church of the Journey and the Magic Society', fee: 50, settlements: ['capital', 'city'], places: [], ...(state.data.travel?.circles || {}) });
function hasCircle(page) {
  if (!page) return false;
  const c = String(page.meta.circle ?? '').toLowerCase();
  if (c === 'true' || c === 'yes') return true;
  if (c === 'false' || c === 'no') return false;
  const t = circleInfo();
  return t.settlements.includes(pinKind(page)) || t.places.includes(page.meta.title);
}
const circlePlaces = () => travelPlaces().filter(p => hasCircle(state.pages.get(p.id)));
const knownCircles = () => (state.saved.circles ||= []);
/** The party has stood at this place's circle, so it knows the address from now on. */
async function learnCircle(place, quiet = false) {
  const page = place?.id && state.pages.get(place.id);
  if (!hasCircle(page) || knownCircles().includes(page.meta.title)) return false;
  knownCircles().push(page.meta.title);
  await attempt(() => api.saved.write(state.saved));
  if (!quiet) toast(`The party now knows the teleport circle address of ${page.meta.title}.`);
  return true;
}
/** The party knows the circle of the place it is staying in, the campaign's starting city included. */
async function learnHereCircle(quiet = true) {
  if (!state.saved || journeys().some(journeyActive)) return false;
  const id = resolve(partyPlace()?.title || '');
  return id ? learnCircle({ id }, quiet) : false;
}

/** A place from a From/To value: a page id, or "pt:lon,lat" for a point picked on the map. */
function travelPlace(v) {
  if (!v) return null;
  if (v.startsWith('pt:')) {
    const at = v.slice(3).split(',').map(Number);
    return isPoint(at) ? { name: nearPlaceName(at), at } : null;
  }
  return travelPlaces().find(p => p.id === v) || null;
}
const placeValue = p => !p ? '' : p.page && p.id ? p.id : `pt:${p.at.join(',')}`;
/** Where the party is, as a travel place value, or '' when it isn't on the map. */
function partyPlaceValue() {
  const id = resolve(partyPlace()?.title || '');
  return id && travelPlaces().some(p => p.id === id) ? id : '';
}
/** "near Greenstone": a name for a point on the map, from the closest place. */
function nearPlaceName(at) {
  let best = null, dist = Infinity;
  for (const p of travelPlaces()) { const d = G.travelDistance(at, p.at); if (d < dist) { dist = d; best = p; } }
  return best ? (dist < 5 ? best.name : `${Math.round(dist)} miles from ${best.name}`) : `${at[1]}°, ${at[0]}°`;
}
/** The lowest rank in the party, which sets how fast it walks. */
function slowestRank(lvl) {
  const ranks = travelParty().map(p => p.rank);
  return ranks.length ? ranks.reduce((a, b) => G.RANKS.indexOf(a) <= G.RANKS.indexOf(b) ? a : b) : G.rankForLevel(lvl);
}
const travelParty = () => pcs().map(p => ({ name: p.meta.title, rank: G.pcRank(p.meta) }));
function travelWiki() {
  return { ...wikiTitles(), hooks: (state.saved.hooks || []).filter(h => !h.used).map(h => h.text), newPlace: roadPlaces(curJourney()) };
}
function journeys() {
  const s = state.saved;
  // A campaign from before there could be several journeys kept just one.
  if (s.journey) { (s.journeys ||= []).push(s.journey); delete s.journey; }
  s.journeys ||= [];
  for (const j of s.journeys) j.id ||= j.started || String(Date.now());
  return s.journeys;
}
const journeyPins = () => (state.saved.journeyPins ||= []);
/** The journeys the main party is on: not ones a split-off group took. */
const mainJourneys = () => journeys().filter(j => !j.group);
/** The journeys with a sidebar button: the ones pinned, and any still on the road (unless the DM took its pin off), in the order the DM dragged them. */
function pinnedJourneys() {
  const pins = journeyPins(), order = state.saved.journeyPinOrder || [];
  const shown = journeys().filter(j => pins.includes(j.id) || (journeyActive(j) && !j.unpinned));
  const rank = j => { const i = order.indexOf(j.id); return i >= 0 ? i : 1e6 + (pins.includes(j.id) ? pins.indexOf(j.id) : 1e3 + journeys().indexOf(j)); };
  return shown.sort((a, b) => rank(a) - rank(b));
}
function curJourney() {
  const list = journeys();
  return list.find(j => j.id === state.gen.journeyId) || list[list.length - 1] || null;
}
/** Save a journey (new or changed) and show it; with `remove`, take it away, pin and all. */
async function saveJourney(j, { remove = false } = {}) {
  if (!j) return;
  const list = journeys();
  const i = list.findIndex(x => x.id === j.id);
  if (remove) {
    if (i >= 0) list.splice(i, 1);
    state.saved.journeyPins = journeyPins().filter(id => id !== j.id);
    if (state.gen.journeyId === j.id) state.gen.journeyId = null;
  } else {
    if (i >= 0) list[i] = j; else list.push(j);
    state.gen.journeyId = j.id;
  }
  await attempt(() => api.saved.write(state.saved));
  renderJourneyPins();
}
const journeyActive = j => !j.ended && !j.days.at(-1)?.arrived;
function openJourney(id) {
  state.gen.tab = 'travel';
  state.gen.journeyId = id;
  if (state.view?.kind === 'generators') { renderGenerators(); highlightNav(); } else go({ kind: 'generators' });
}

/** Pinned journeys sit under the main buttons in the sidebar: click to open, drag to move, right-click to unpin. */
function renderJourneyPins() {
  const box = $('#journey-pins');
  if (!box || !state.saved) return;
  const pins = pinnedJourneys();
  box.hidden = !pins.length;
  box.innerHTML = pins.map(j => `<button draggable="true" data-journey="${esc(j.id)}" style="--route:${routeColor(j)}" title="${esc(G.journeyTitle(j))}${journeyActive(j) ? ' (on the road)' : ''}. Click to open; drag to move; right-click to unpin.">
    <span>🧭</span><span class="jp-name">${esc(G.journeyTitle(j))}</span><span class="jp-miles">${journeyActive(j) ? j.miles ? `${G.journeyDone(j)}/${j.miles} mi` : `day ${j.days.length}` : 'arrived'}</span></button>`).join('');
  highlightNav();
}
/** Pin or unpin a journey. A journey on the road shows by itself, so unpinning it marks it to stay off. */
async function toggleJourneyPin(id) {
  const j = journeys().find(x => x.id === id);
  const on = !!j && pinnedJourneys().includes(j);
  state.saved.journeyPins = journeyPins().filter(x => x !== id);
  if (j && on) j.unpinned = true;
  if (j && !on) { delete j.unpinned; journeyPins().push(id); }
  await attempt(() => api.saved.write(state.saved));
  renderJourneyPins();
  return !on;
}
function wireJourneyPins() {
  const box = $('#journey-pins');
  let dragged = null;
  box.addEventListener('click', e => { const b = e.target.closest('[data-journey]'); if (b) openJourney(b.dataset.journey); });
  box.addEventListener('contextmenu', async e => {
    const b = e.target.closest('[data-journey]');
    if (!b) return;
    e.preventDefault();
    await toggleJourneyPin(b.dataset.journey);
    if (state.view?.kind === 'generators' && state.gen.tab === 'travel') showGenResult();
  });
  box.addEventListener('dragstart', e => { dragged = e.target.closest('[data-journey]')?.dataset.journey; e.dataTransfer.effectAllowed = 'move'; });
  box.addEventListener('dragover', e => {
    const b = e.target.closest('[data-journey]');
    if (!dragged || !b) return;
    e.preventDefault();
    $$('#journey-pins .drag-over').forEach(x => x !== b && x.classList.remove('drag-over'));
    b.classList.add('drag-over');
  });
  box.addEventListener('dragleave', e => e.target.closest('[data-journey]')?.classList.remove('drag-over'));
  box.addEventListener('drop', async e => {
    const b = e.target.closest('[data-journey]');
    if (!dragged || !b) return;
    e.preventDefault();
    const shown = pinnedJourneys().map(j => j.id);
    const pins = shown.filter(id => id !== dragged);
    pins.splice(pins.indexOf(b.dataset.journey) + (shown.indexOf(dragged) < shown.indexOf(b.dataset.journey) ? 1 : 0), 0, dragged);
    state.saved.journeyPinOrder = pins;
    dragged = null;
    await attempt(() => api.saved.write(state.saved));
    renderJourneyPins();
  });
  box.addEventListener('dragend', () => { dragged = null; $$('#journey-pins .drag-over').forEach(x => x.classList.remove('drag-over')); });
}

function travelForm(d, lvl, size) {
  const t = d.travel;
  const places = travelPlaces();
  const o = state.gen.opts.travel || {};
  const j = curJourney();
  // A new journey starts where the last one ended.
  const from = o.from ?? (j?.to ? placeValue(j.to) : partyPlaceValue());
  const opt = (list, cur, dflt) => (list || []).map(x => `<option ${x.name === (cur || dflt) ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
  const placeOpts = (cur, none) => {
    const extra = cur && cur.startsWith('pt:') ? `<option value="${esc(cur)}" selected>Point on the map (${esc(travelPlace(cur)?.name || '')})</option>` : '';
    return `<option value="">${none}</option>${extra}${places.map(p => `<option value="${esc(p.id)}" ${p.id === cur ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}`;
  };
  const cats = (t.categories || []);
  const on = new Set(Array.isArray(o.cats) ? o.cats : cats.map(c => c.key));
  return `<div class="row">
      <label class="field">From<select name="from">${placeOpts(from, 'Anywhere')}</select></label>
      <label class="field">To<select name="to">${placeOpts(o.to || '', 'No destination')}</select></label>
      <button class="btn" type="button" id="travel-map-pick" title="Click a start and an end on the World map">Pick on map</button>
      <label class="field" style="width:170px" title="Optional: a name for the journey, like the name of the group travelling">Name<input name="name" placeholder="From the places" value=""></label>
      ${partyGroups().length ? `<label class="field" title="The party is split: who goes on this journey. Only they move when it arrives.">Who<select name="who"><option value="">${esc(mainPartyName())}</option>${partyGroups().map(g => `<option value="${esc(g.id)}" ${g.id === o.who ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select></label>` : ''}
      <label class="field" style="width:120px" title="Leave empty to work it out from the map: the route, plus a fifth for winding roads (ships and sky ships go the way the route shows)">Miles<input name="miles" type="number" min="1" placeholder="From map" value="${esc(o.miles || '')}"></label>
      <span class="spacer"></span>
      <button class="btn" type="button" id="travel-teleport" title="Step through the teleport circle network: both places need a circle, and the party must know where it's going">Teleport</button>
      <button class="btn primary" type="submit">${j ? 'Start a new journey' : 'Start journey'}</button></div>
    <p class="hint travel-route" id="travel-route">${travelRouteHTML({ ...o, from })}</p>
    <div class="row">
      <label class="field">Terrain<select name="terrain">${opt(t.terrains, o.terrain, 'Road')}</select></label>
      <label class="field" title="Stronger magic spawns more monsters">Magic<select name="magic">${opt(t.magic, o.magic, 'Normal')}</select></label>
      <label class="field">Travel by<select name="mode">${opt(t.modes, o.mode, 'On foot')}</select></label>
      <label class="field">Pace<select name="pace">${(t.paces || []).map(p => `<option ${p.name === (o.pace || 'Normal') ? 'selected' : ''} title="${esc(p.text || '')}">${esc(p.name)}</option>`).join('')}</select></label>
      <label class="field" style="width:110px" title="The navigator's Wisdom (Survival) bonus">Survival +<input name="bonus" type="number" min="-5" max="20" value="${esc(o.bonus ?? 4)}"></label>
      <label class="inline-check" title="A guide gives advantage on the Survival check"><input type="checkbox" name="guide" ${o.guide ? 'checked' : ''}> Guide</label>
    </div>
    <div class="row">
      <label class="field" style="width:110px">Party level<input name="level" type="number" min="1" max="20" value="${lvl}"></label>
      <label class="field" style="width:110px">Party size<input name="partySize" type="number" min="1" max="20" value="${size}"></label>
      <label class="field" title="The party travels at its slowest member's speed. Higher ranks walk faster and further in a day.">Slowest rank<select name="rank">${G.RANKS.slice(0, 5).map(r => `<option ${r === (o.rank || slowestRank(lvl)) ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
      <label class="field" title="How hard the fights are">Fights<select name="difficulty">${['low', 'moderate', 'high'].map(x => `<option value="${x}" ${x === (o.difficulty || 'moderate') ? 'selected' : ''}>${cap(x)}</option>`).join('')}</select></label>
      <label class="field" title="How often exploring a place off the route goes wrong: a fight, a hazard, a puzzle, a hard choice, a price, or nothing there">Exploring<select name="explore">${G.EXPLORE_RISKS.map(r => `<option value="${r.key}" ${r.key === (o.explore || 'normal') ? 'selected' : ''}>${r.name}</option>`).join('')}</select></label>
      <label class="field" style="width:130px" title="An event happens on a d20 roll of this or higher">Event on d20 ≥<input name="eventOn" type="number" min="2" max="20" value="${esc(o.eventOn || 15)}"></label>
      <label class="field" title="Gentle makes feel-good, funny and rewarding events twice as likely and grim and creepy ones half as likely; Grim does the reverse">Mood<select name="mood">${G.TRAVEL_MOODS.map(m => `<option ${m === (o.mood || 'Balanced') ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
      <label class="field" title="Events that nod to stories and games from other worlds. Outworlders are the only ones who name them outright.">References<select name="refs">${G.TRAVEL_REFS.map(r => `<option value="${r.key}" ${r.key === (o.refs || 'all') ? 'selected' : ''}>${r.name}</option>`).join('')}</select></label>
    </div>
    <details class="travel-cats"><summary>Event types (${on.size} of ${cats.length})</summary><div class="row">
      ${cats.map(c => `<label class="inline-check" title="${c.check === 'encounter' ? 'Rolled on the encounter check' : 'Rolled on the event check'}"><input type="checkbox" name="cat" value="${esc(c.key)}" ${on.has(c.key) ? 'checked' : ''}> ${esc(c.name)} <span class="muted">(${(c.events || []).filter(e => !e.follow).length})</span></label>`).join('')}
    </div>
    <p class="hint" style="margin:6px 0 0">The campaign doesn't get the same event twice until most of a type has come up; then the oldest half can come back. Rare events come once a campaign.
      ${(() => { const n = Object.values(state.saved.travelSeen || {}).reduce((t, l) => t + l.length, 0); return `<span class="muted">${n} event${n === 1 ? '' : 's'} seen so far.</span> <button type="button" class="btn" id="travel-reset-seen" ${n ? '' : 'disabled'}>Reset seen events</button>`; })()}</p></details>
    ${(() => {
      const circles = circlePlaces(), known = new Set(knownCircles());
      return `<details class="travel-cats" id="travel-circles"><summary>Teleport circle addresses the party knows (${circles.filter(c => known.has(c.name)).length} of ${circles.length})</summary>
        <p class="hint" style="margin:6px 0 0">Run by ${esc(circleInfo().runBy)}, at ${esc(G.formatSpirit(circleInfo().fee))} spirit coins a traveller. The party learns a circle's address by visiting it; click to mark one known or unknown.</p>
        <div class="chip-row" style="margin-top:6px">${circles.map(c => `<button type="button" class="chip${known.has(c.name) ? ' on' : ''}" data-circle="${esc(c.name)}">${esc(c.name)}</button>`).join('') || '<span class="muted">No places with circles yet. Cities and capitals get one; turn one on for any other place from its World map entry.</span>'}</div></details>`;
    })()}
    <p class="hint" style="margin:8px 0 0">Each day rolls the weather, a Survival check to keep the way (fail and the party makes no progress), an encounter check (more likely where magic is strong) and an event check. These settings start a new journey; once one is on the road, change its pace, terrain and the rest from its own Travel settings below. To change how the party travels part of the way (a ship to a port, then horses), add a stop on the route and pick how they go on from there.</p>`;
}

/** The travel form's current choices, as options for the travel generator. */
function travelOpts() {
  const form = $('#gen-form');
  const g = state.gen;
  if (!form || g.tab !== 'travel') return g.opts.travel || {};
  const o = Object.fromEntries(new FormData(form));
  o.cats = new FormData(form).getAll('cat');
  delete o.cat;
  o.guide = !!form.elements.guide.checked;
  o.via = g.opts.travel?.via || [];
  g.opts.travel = o;
  if (o.level) g.opts.level = Number(o.level);
  if (o.partySize) g.opts.partySize = Number(o.partySize);
  return o;
}

function wireTravelForm(form) {
  const d = state.data;
  // A destination with a magic level on its page sets the magic for the road there.
  form.elements.to.onchange = () => {
    const p = travelPlace(form.elements.to.value);
    const m = p?.id && String(state.pages.get(p.id)?.meta.magic || '').toLowerCase();
    const level = m && (d.travel.magic || []).find(x => x.name.toLowerCase() === m);
    if (level) form.elements.magic.value = level.name;
    travelOpts();
  };
  const wireRoute = () => {
    $('#travel-route-edit')?.addEventListener('click', editRoute);
    $('#travel-route-clear')?.addEventListener('click', () => { travelOpts().via = []; drawRouteLine(); });
    const via = () => travelOpts().via;
    $$('[data-leg]', form).forEach(row => {
      const v = via()[Number(row.dataset.leg)];
      if (!v) return;
      const mode = $('[data-leg-mode]', row), terrain = $('[data-leg-terrain]', row);
      mode.onchange = () => { v.mode = mode.value || undefined; if (!v.mode) delete v.terrain; else v.terrain = v.mode === 'Sailing ship' ? 'Open sea' : v.terrain && v.terrain !== 'Open sea' ? v.terrain : 'Road'; };
      if (terrain) terrain.onchange = () => { v.terrain = terrain.value || undefined; };
      $('[data-leg-drop]', row).onclick = () => { via().splice(Number(row.dataset.leg), 1); drawRouteLine(); };
    });
    const add = $('#travel-add-stop');
    if (add) add.onchange = () => {
      const p = travelPlaces().find(x => x.id === add.value), o = travelOpts(), from = travelPlace(o.from), to = travelPlace(o.to);
      if (!p?.at || !from?.at || !to?.at) return;
      // The stop goes where it adds the least to the way.
      const list = o.via, stop = { name: p.name, at: p.at };
      let best = list.length, cost = Infinity;
      for (let i = 0; i <= list.length; i++) {
        const pts = [from.at, ...list.slice(0, i).map(v => v.at), stop.at, ...list.slice(i).map(v => v.at), to.at];
        const c = PL.routeMiles(pts);
        if (c < cost) { cost = c; best = i; }
      }
      list.splice(best, 0, stop);
    };
  };
  const drawRouteLine = () => { $('#travel-route').innerHTML = travelRouteHTML(travelOpts()); wireRoute(); };
  wireRoute();
  form.onchange = () => drawRouteLine();
  // Ships sail the open sea; back on land, the road.
  let wasMode = form.elements.mode.value;
  form.elements.mode.addEventListener('change', () => {
    const m = form.elements.mode.value, t = form.elements.terrain;
    if (m === 'Sailing ship' && t.value === 'Road') t.value = 'Open sea';
    if (BOATS.includes(wasMode) && !BOATS.includes(m) && t.value === 'Open sea') t.value = 'Road';
    wasMode = m;
  });
  $('#travel-map-pick').onclick = () => {
    travelOpts();
    state.map ||= { vb: null, tool: null, draft: [] };
    state.map.tool = 'journey'; state.map.draft = [];
    go({ kind: 'map' });
  };
  $('.travel-cats', form).ontoggle = e => { state.gen.travelCatsOpen = e.target.open; };
  if (state.gen.travelCatsOpen) $('.travel-cats', form).open = true;
  $('#travel-circles').ontoggle = e => { state.gen.circlesOpen = e.target.open; };
  if (state.gen.circlesOpen) $('#travel-circles').open = true;
  $$('[data-circle]', form).forEach(b => b.onclick = async () => {
    const list = knownCircles(), name = b.dataset.circle;
    const i = list.indexOf(name);
    if (i >= 0) list.splice(i, 1); else list.push(name);
    await attempt(() => api.saved.write(state.saved));
    renderGenerators();
  });
  $('#travel-teleport').onclick = () => teleport();
  $('#travel-reset-seen').onclick = async () => {
    if (!await confirmDialog('Reset seen events?', 'Every travel event, rare ones too, can come up again, as in a new campaign.', 'Reset')) return;
    state.saved.travelSeen = {};
    await attempt(() => api.saved.write(state.saved));
    toast('Every event is back in the deck');
    renderGenerators();
  };
}
/** The names of the travel events this campaign has had, per category, for the no-repeat deck. */
const travelSeen = () => (state.saved.travelSeen ||= {});

/** Where a page sends the party: a place on the map (or the place it's in), or a contract's destination. Not where the party already is. */
function journeyTarget(p) {
  const e = p.meta.type !== 'location' && world().chronicle?.find(x => x.kind === 'event' && x.quest === p.meta.title && x.dest);
  const pg = e ? state.pages.get(resolve(e.dest)) : p;
  const at = pg && placeAbove(pg);
  const t = at && travelPlaces().find(x => x.name === at.title);
  return t && t.name !== partyPlace()?.title ? t : null;
}
/** The Travel generator, set up from where the party is to there. */
function planJourneyTo(id) {
  const to = travelPlaces().find(x => x.id === id);
  if (!to) return;
  const here = partyPlace(), from = here && travelPlaces().find(x => x.name === here.title);
  const g = state.gen;
  g.opts.travel = { ...(g.opts.travel || {}), from: from ? placeValue(from) : '', to: placeValue(to), miles: '', via: [] };
  g.tab = 'travel';
  toast(from ? `${from.name} to ${to.name}: about ${Math.round(G.travelDistance(from.at, to.at) * G.ROUTE_WINDING)} miles by road. Start the journey when you're ready.` : `Pick where the journey starts, then start it.`);
  go({ kind: 'generators' });
}
/** A new journey, alongside any already on the road (a split party can travel two ways at once). */
/** The share of a line of map points (straight between them) that runs over open water, from 0 to 1. */
function seaShare(pts) {
  const n = 24;
  let wet = 0;
  for (let i = 1; i < n; i++) if (!PL.onLand(journeyAt({ from: { at: pts[0] }, to: { at: pts.at(-1) }, route: pts, miles: 1 }, i / n))) wet++;
  return wet / (n - 1);
}

// ----- routes -----
// A journey's route runs from where it starts, through any waypoints (opts.via: [{ name, at }], a name when it calls at
// a place), to where it ends. Ships and boats keep to the water and go round the land (places.js waterRoute); everything
// else goes straight from point to point. A started journey keeps its route in j.route.

const BOATS = ['Sailing ship', 'River boat'];
/** Whether a journey with these options sails: over water only, from and to a coast or a river. */
const sails = o => BOATS.includes(o?.mode);
/** A journey's route as [lon, lat] points, or null when it isn't on the map. */
const routePts = j => j.route?.length > 1 ? j.route : j.from?.at && j.to?.at ? [j.from.at, j.to.at] : null;
/** [west, south, east, north] around a line of points. */
const routeBox = pts => [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))];
/** A map view box with a route in it and some room round it. */
function routeView(pts) {
  const xy = pts.map(mapXY), xs = xy.map(p => p[0]), ys = xy.map(p => p[1]);
  const w = Math.max(200, (Math.max(...xs) - Math.min(...xs)) * 1.4), h = Math.max(120, (Math.max(...ys) - Math.min(...ys)) * 1.4);
  return [(Math.max(...xs) + Math.min(...xs)) / 2 - w / 2, (Math.max(...ys) + Math.min(...ys)) / 2 - h / 2, w, h];
}
let routeCache = { key: '', r: null };
/**
 * The route for a journey with these options from one place to another, through its waypoints: { pts, legs (where each
 * leg starts in pts), miles (along the line, before any winding) }, or { error } saying why a ship can't go that way.
 */
function planRoute(o, from, to) {
  if (!from?.at || !to?.at) return null;
  const via = (o.via || []).filter(v => isPoint(v?.at));
  const points = [from.at, ...via.map(v => v.at), to.at];
  if (via.some(v => v.mode)) return planLegs(o, from, to, via);
  if (!sails(o)) return { pts: points, legs: points.slice(0, -1).map((_, i) => i), miles: Math.round(PL.routeMiles(points)) };
  const key = JSON.stringify([points, o.mode]);
  if (routeCache.key === key) return routeCache.r;
  const r = PL.waterRoute(points, { buffer: o.mode === 'River boat' ? 0 : PL.COAST_BUFFER });
  if (r.error) {
    const names = [from.name, ...via.map((v, i) => v.name || `waypoint ${i + 1}`), to.name];
    const boat = o.mode.toLowerCase();
    r.message = r.error === 'land' ? `${names[r.at]} isn't on a coast or a river, so a ${boat} can't ${r.at === 0 ? 'set out from' : r.at === names.length - 1 ? 'put in at' : 'go by way of'} it. Pick a port, or go overland to one first.`
      : `There's no way by water from ${names[r.at]} to ${names[r.at + 1]}.`;
  }
  routeCache = { key, r };
  return r;
}
/**
 * A route in legs: a stop with its own way of travelling (via[i].mode, .terrain) starts a new leg, so a ship can sail to a
 * port and horses go on overland. Also gives `split`, one entry per leg: { name, mode, terrain, miles (winding counted), pt
 * (where it ends in pts) }, and `wound`, the whole way with each leg's winding.
 */
function planLegs(o, from, to, via) {
  const key = JSON.stringify(['legs', [from.at, to.at], via, o.mode, o.terrain]);
  if (routeCache.key === key) return routeCache.r;
  const names = [from.name, ...via.map((v, i) => v.name || `waypoint ${i + 1}`), to.name];
  const stops = [from.at, ...via.map(v => v.at), to.at];
  let way = { mode: o.mode || 'On foot', terrain: o.mode === 'Sailing ship' && (!o.terrain || o.terrain === 'Road') ? 'Open sea' : o.terrain || 'Road' };
  const pts = [from.at], legs = [], split = [];
  let r = null;
  for (let i = 0; i < stops.length - 1; i++) {
    if (i > 0 && via[i - 1].mode) {
      split.at(-1).name = names[i];
      way = { mode: via[i - 1].mode, terrain: via[i - 1].terrain || (via[i - 1].mode === 'Sailing ship' ? 'Open sea' : 'Road') };
    }
    if (!split.length || (i > 0 && via[i - 1].mode)) split.push({ ...way, miles: 0, pt: 0 });
    legs.push(pts.length - 1);
    let seg = [stops[i], stops[i + 1]];
    if (sails(way)) {
      const w = PL.waterRoute(seg, { buffer: way.mode === 'River boat' ? 0 : PL.COAST_BUFFER });
      if (w.error) {
        const boat = way.mode.toLowerCase(), at = i + w.at;
        r = { error: w.error, message: w.error === 'land' ? `${names[at]} isn't on a coast or a river, so a ${boat} can't ${at === i ? 'set out from' : 'put in at'} it. Pick a port for that leg, or travel it another way.` : `There's no way by water from ${names[i]} to ${names[i + 1]}.` };
        break;
      }
      seg = w.pts;
    }
    const leg = split.at(-1);
    leg.miles += PL.routeMiles(seg) * (windless(way) ? 1 : G.ROUTE_WINDING);
    pts.push(...seg.slice(1));
    leg.pt = pts.length - 1;
  }
  if (!r) {
    split.at(-1).name = to.name;
    for (const l of split) l.miles = Math.round(l.miles);
    r = { pts, legs, split, miles: Math.round(PL.routeMiles(pts)), wound: split.reduce((t, l) => t + l.miles, 0) };
  }
  routeCache = { key, r };
  return r;
}
/** The miles a route takes on the ground: roads wind, ships and sky ships don't. */
const routeWound = (o, r) => r.wound ?? Math.round(r.miles * (windless(o) ? 1 : G.ROUTE_WINDING));
/** Ships and sky ships go the way the route shows; roads wind. */
const windless = o => ['Sailing ship', 'River boat', 'Sky ship'].includes(o?.mode) || o?.terrain === 'Open sea';
/** The route line for the Travel form: how far, which way, and a button to see it on the map and bend it. */
function travelRouteHTML(o) {
  const from = travelPlace(o.from), to = travelPlace(o.to);
  if (!from?.at || !to?.at) return sails(o) ? 'A ship or boat keeps to the water, so it sets out from a coast or a river.' : '';
  const r = planRoute(o, from, to);
  const btns = `<button class="btn small" type="button" id="travel-route-edit" title="See the route on the World map, and drag it to add waypoints">Route on map</button>${o.via?.length ? ' <button class="btn small" type="button" id="travel-route-clear" title="Go the shortest way again">Clear waypoints</button>' : ''}`;
  const stops = legsHTML(o, r);
  if (r.error) return `<span class="route-bad">⚠ ${esc(r.message)}</span> ${btns}${stops}`;
  const via = viaText(o.via);
  return `Route: about ${routeWound(o, r).toLocaleString('en-US')} miles${r.split ? ` in ${r.split.length} legs` : sails(o) ? ' by water' : o.mode === 'Sky ship' ? ' through the air' : ''}${via ? `, ${esc(via)}` : ''}. ${btns}${stops}`;
}
/**
 * The stops on the Travel form's route, each with how the party goes on from there (the same way, or a new leg: a ship to a
 * port, then horses), and a picker to add a stop.
 */
function legsHTML(o, r) {
  const t = state.data.travel || {}, via = o.via || [];
  const opts = (list, cur, none) => `<option value="">${none}</option>${(list || []).map(x => `<option ${x.name === cur ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}`;
  const rows = via.map((v, i) => {
    if (!isPoint(v?.at)) return '';
    const at = v.mode && r?.split ? r.split.findIndex(l => l.name === v.name) : -1, leg = at >= 0 ? r.split[at + 1] : null;
    return `<span class="leg-row" data-leg="${i}"><span class="leg-stop">${esc(v.name || `Waypoint ${i + 1}`)}</span>
      <select data-leg-mode title="How the party travels on from here">${opts(t.modes, v.mode, 'Then the same way')}</select>
      ${v.mode ? `<select data-leg-terrain title="The ground for this leg">${opts(t.terrains, v.terrain, v.mode === 'Sailing ship' ? 'Open sea' : 'Road')}</select>` : ''}
      ${leg ? `<span class="muted">${leg.miles.toLocaleString('en-US')} miles to ${esc(leg.name)}</span>` : ''}
      <button type="button" class="mini-reroll" data-leg-drop title="Take this stop out">✕</button></span>`;
  }).join('');
  const first = r?.split?.[0];
  const head = first ? `<span class="leg-row muted">First leg: ${esc((o.mode || 'On foot').toLowerCase())} to ${esc(first.name)}, ${first.miles.toLocaleString('en-US')} miles (set with Travel by and Terrain below).</span>` : '';
  const places = travelPlaces().filter(p => p.id !== o.from && p.id !== o.to && !via.some(v => v.name === p.name));
  return `<span class="travel-legs">${head}${rows}<span class="leg-row"><select id="travel-add-stop" title="Call at a place on the way, to change how the party travels there (a ship to a port, then horses overland)"><option value="">+ Add a stop on the way…</option>${places.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></span></span>`;
}
/** Open the World map on the Travel form's route, to bend it with waypoints. */
function editRoute() {
  const o = travelOpts(), from = travelPlace(o.from), to = travelPlace(o.to);
  if (!from?.at || !to?.at) return toast('Pick where the journey starts and ends first.', true);
  const r = planRoute(o, from, to);
  const m = (state.map ||= { vb: null, tool: null, draft: [] });
  Object.assign(m, { tool: 'route', draft: [], vb: routeView(r && !r.error ? r.pts : [from.at, ...(o.via || []).map(v => v.at), to.at]) });
  go({ kind: 'map' });
}
/** "by way of Yaresh and 2 other waypoints" for a list of waypoints, or ''. */
function viaText(via) {
  const list = (via || []).filter(v => v?.at);
  if (!list.length) return '';
  const named = list.filter(v => v.name).map(v => v.name), more = list.length - named.length;
  const parts = [...named, ...(more ? [`${more}${named.length ? ' other' : ''} waypoint${more === 1 ? '' : 's'}`] : [])];
  return `by way of ${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0]}`;
}
/**
 * A journey over land that crosses open sea: ask how the party gets across, a ship, the teleport circles, or as planned.
 * Resolves to the options to travel with, or null when the party teleports instead or the DM cancels.
 */
async function crossingCheck(o, from, to) {
  if (!from?.at || !to?.at || ['Sailing ship', 'River boat', 'Sky ship'].includes(o.mode) || o.terrain === 'Open sea' || (o.via || []).some(v => v?.mode)) return o;
  const wet = seaShare(planRoute(o, from, to).pts);
  if (wet < 0.25) return o;
  const page = x => x?.id && state.pages.get(x.id);
  const circles = sysOn('travel') && hasCircle(page(from)) && hasCircle(page(to));
  const known = circles && knownCircles().includes(to.name);
  const r = await formDialog('The route crosses the sea', `<p class="muted" style="margin:0 0 10px">About ${Math.round(wet * 100)}% of the way from ${esc(from.name)} to ${esc(to.name)} is open sea, so ${esc((o.mode || 'On foot').toLowerCase())} won't get them there.</p>
    <label class="field">How do they cross?<select name="how">
      <option value="ship">By sailing ship over the open sea</option>
      ${circles ? `<option value="circle"${known ? '' : ' disabled'}>By teleport circle${known ? '' : ` (the party doesn't know ${esc(to.name)}'s address yet)`}</option>` : ''}
      <option value="keep">As planned (${esc(o.mode || 'On foot')}, ${esc(o.terrain || 'Road')})</option></select></label>`, 'Set out');
  if (!r) return null;
  if (r.how === 'circle') { await teleport(); return null; }
  if (r.how !== 'ship') return o;
  const next = { ...o, mode: 'Sailing ship', terrain: 'Open sea' };
  const form = $('#gen-form');
  if (form?.mode) form.mode.value = 'Sailing ship';
  if (form?.terrain) form.terrain.value = 'Open sea';
  state.gen.opts.travel = { ...(state.gen.opts.travel || {}), mode: 'Sailing ship', terrain: 'Open sea' };
  return next;
}
// ----- a journey's own travel settings -----
// A started journey keeps its settings (j.opts), so pace, terrain, the way of travelling and the rest can change on the
// road, from the journey's own settings bar, without touching the Travel form (which is for starting new journeys).
const JOURNEY_KEYS = ['terrain', 'magic', 'mode', 'pace', 'bonus', 'guide', 'level', 'partySize', 'rank', 'difficulty', 'explore', 'eventOn', 'mood', 'refs', 'cats'];
const keepOpts = o => Object.fromEntries(JOURNEY_KEYS.filter(k => o[k] !== undefined).map(k => [k, Array.isArray(o[k]) ? [...o[k]] : o[k]]));
/** The settings a journey travels with: its own, or the Travel form's for a journey from before journeys kept them. */
const journeyOpts = j => j?.opts ? { ...travelOpts(), ...j.opts } : travelOpts();
/** On reaching a new leg, the journey takes up that leg's way of travelling. Changes j in place. */
function enterLeg(j) {
  const k = G.journeyLeg(j);
  if (k < 0 || j.leg === k) return j;
  j.leg = k;
  j.opts = { ...(j.opts || keepOpts(travelOpts())), mode: j.legs[k].mode, terrain: j.legs[k].terrain };
  return j;
}
/** Roll `count` more days, one at a time so a new leg's way of travelling starts the day after the stop. */
function rollDays(j, count, { stopAtRide = false } = {}) {
  let next = j;
  for (let n = 0; n < count; n++) {
    next = enterLeg({ ...next });
    next = lookout(G.travelOn(state.data, next, journeyOpts(next), 1, Math.random, travelWiki(), travelSeen()), next.days.length);
    if (next.days.at(-1)?.arrived || (G.journeyLeft(next) === 0) || (stopAtRide && rideOffers(next).length)) break;
  }
  return enterLeg({ ...next });
}
/** Miles a day for a journey at its current settings. */
const journeyPace = j => G.travelDayPace(G.travelSettings(state.data, journeyOpts(j)), state.data);
/** The journey's settings bar: change how it travels from the next day on. */
function journeySettingsHTML(j) {
  const t = state.data.travel || {}, o = journeyOpts(j);
  const sel = (name, list, cur, dflt, label, tip = '') => `<label class="field"${tip ? ` title="${esc(tip)}"` : ''}>${label}<select data-jopt="${name}">${(list || []).map(x => `<option ${x.name === (cur || dflt) ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>`;
  const k = G.journeyLeg(j);
  const legs = j.legs ? `<p class="hint" style="margin:4px 0 0">Leg ${k + 1} of ${j.legs.length}: to ${esc(j.legs[k].name)}${k < j.legs.length - 1 ? `, then ${esc(j.legs.slice(k + 1).map(l => `${l.mode.toLowerCase()} to ${l.name}`).join(', then '))}` : ''}. A new leg sets Travel by and Terrain when the party gets there.</p>` : '';
  return `<details class="travel-cats journey-settings" ${state.gen.jsetOpen ? 'open' : ''}><summary>Travel settings for this journey: ${esc(o.mode || 'On foot')}, ${esc((o.pace || 'Normal').toLowerCase())} pace, ${esc((o.terrain || 'Road').toLowerCase())}</summary>
    <div class="row">
      ${sel('terrain', t.terrains, o.terrain, 'Road', 'Terrain')}
      ${sel('magic', t.magic, o.magic, 'Normal', 'Magic', 'Stronger magic spawns more monsters')}
      ${sel('mode', t.modes, o.mode, 'On foot', 'Travel by')}
      ${sel('pace', t.paces, o.pace, 'Normal', 'Pace', 'Fast covers more ground; slow is stealthier and safer')}
      <label class="field" title="How hard the fights are">Fights<select data-jopt="difficulty">${['low', 'moderate', 'high'].map(x => `<option value="${x}" ${x === (o.difficulty || 'moderate') ? 'selected' : ''}>${cap(x)}</option>`).join('')}</select></label>
      <label class="field" style="width:110px" title="The navigator's Wisdom (Survival) bonus">Survival +<input data-jopt="bonus" type="number" min="-5" max="20" value="${esc(o.bonus ?? 4)}"></label>
      <label class="field" style="width:120px" title="An event happens on a d20 roll of this or higher">Event on d20 ≥<input data-jopt="eventOn" type="number" min="2" max="20" value="${esc(o.eventOn || 15)}"></label>
      <label class="inline-check" title="A guide gives advantage on the Survival check"><input type="checkbox" data-jopt="guide" ${o.guide && o.guide !== 'off' ? 'checked' : ''}> Guide</label>
    </div>${legs}
    <p class="hint" style="margin:4px 0 0">Changes count from the next day rolled. Days already rolled keep how they went.</p></details>`;
}
function wireJourneySettings(j, box) {
  const det = $('.journey-settings', box);
  if (!det) return;
  det.ontoggle = () => { state.gen.jsetOpen = det.open; };
  $$('[data-jopt]', det).forEach(el => el.onchange = async () => {
    const k = el.dataset.jopt, was = journeyOpts(j);
    const o = { ...(j.opts || keepOpts(travelOpts())), [k]: el.type === 'checkbox' ? el.checked : el.value };
    // Ships sail the open sea; back on land, the road.
    if (k === 'mode' && o.mode === 'Sailing ship' && (!was.terrain || was.terrain === 'Road')) o.terrain = 'Open sea';
    if (k === 'mode' && BOATS.includes(was.mode) && !BOATS.includes(o.mode) && was.terrain === 'Open sea') o.terrain = 'Road';
    await saveJourney({ ...j, opts: o });
    showGenResult();
  });
}
async function startJourney() {
  const from0 = travelPlace(travelOpts().from), to0 = travelPlace(travelOpts().to);
  const o = await crossingCheck(travelOpts(), from0, to0);
  if (!o) return;
  const from = travelPlace(o.from), to = travelPlace(o.to);
  // A ship sets out from a coast or a river and keeps to the water, round the land.
  if (sails(o) && from?.at && !to?.at && !PL.onWater(from.at)) return toast(`${from.name} isn't on a coast or a river, so a ${o.mode.toLowerCase()} can't set out from it. Pick a port, or go overland to one first.`, true);
  const route = planRoute(o, from, to);
  if (route?.error) return toast(route.message, true);
  // Ships and sky ships go the way the route shows; roads wind.
  const straight = windless(o);
  let j = G.newJourney({ from, to, miles: o.miles || (route ? routeWound(o, route) : null), winding: straight ? 1 : G.ROUTE_WINDING });
  if (route?.pts.length > 2) j.route = route.pts;
  const via = (o.via || []).filter(v => isPoint(v?.at));
  if (route && via.length) j.via = via.map(({ name, at }) => (name ? { name, at } : { at }));
  // A route in legs: each leg ends at so many miles (scaled to a distance typed in by hand), and has its own way of travelling.
  if (route?.split?.length > 1) {
    const scale = j.miles / (route.wound || 1);
    let end = 0;
    j.legs = route.split.map(l => ({ name: l.name, mode: l.mode, terrain: l.terrain, end: Math.round(end += l.miles * scale), pt: l.pt }));
    j.legs.at(-1).end = j.miles;
  }
  j.opts = keepOpts(o);
  if (j.legs) Object.assign(j.opts, { mode: j.legs[0].mode, terrain: j.legs[0].terrain });
  if (o.name?.trim()) j.name = o.name.trim();
  if (o.who && partyGroups().some(g => g.id === o.who)) j.group = o.who;
  j = lookout(G.travelOn(state.data, j, journeyOpts(j), 1, Math.random, travelWiki(), travelSeen()), 0);
  await saveJourney(j);
  await journeyTime(null, j);
  // Standing at a circle as they set out teaches the party its address.
  await learnCircle(from);
  if (j.days.at(-1)?.arrived) await learnCircle(to);
  await autoLogJourney();
  showGenResult();
}

/** A journey's new days move the world clock (unless the DM turned that off, or switched the living world off), and arriving puts the party there. */
async function journeyTime(before, after, days = null) {
  if (!state.data.calendar) return;
  const w = world();
  const added = days ?? after.days.length - (before?.days.length || 0);
  // A split-off group's journey moves that group, not the rest of the party.
  const group = after.group && partyGroups().find(g => g.id === after.group);
  if (!before && !group) { w.partyAt = null; w.partyPoint = null; }
  const arrived = after.days.at(-1)?.arrived || after.teleport;
  if (arrived && !before?.days.at(-1)?.arrived) {
    const pg = after.to?.name && state.pages.get(resolve(after.to.name));
    if (group) Object.assign(group, pg ? { at: pg.meta.title, point: null } : { at: null, point: after.to?.at ? { name: after.to.name, at: after.to.at } : null });
    else { w.partyAt = pg ? pg.meta.title : null; w.partyPoint = null; }
  }
  if (added > 0 && sysOn('world') && w.settings.journeysMove) await advanceWorld(added, { quiet: true, why: `Journey: ${G.journeyTitle(after)}` });
  if (arrived && !before?.days.at(-1)?.arrived && after.to?.name) await chronicle({ kind: 'party', title: `The party reached ${after.to.name}`, text: '', places: [after.to.name], isPublic: false, at: after.to.at || null });
  else await saveWorld();
  if (arrived && !before?.days.at(-1)?.arrived && after.to?.name) await offerContractEnd(after.to.name);
}
/** The party reached a place that an accepted contract sent it to: offer to record how that went. */
async function offerContractEnd(place) {
  const id = resolve(place);
  const open = world().chronicle.filter(e => e.kind === 'event' && e.taken === true && !e.outcome && !e.expired && e.dest && resolve(e.dest) === id);
  for (const e of open) {
    if (await confirmDialog(`The party is at ${place}`, `${e.title} sent them here and is still marked as under way. Record how it ended now? You can also do it later from the contract page.`, 'Record it')) await outcomeDialog(e.id);
  }
}

// ---------- travel in the session notes ----------
// Each journey has its own section in a session's notes, rewritten as more days are added, so nothing is doubled up.

const travelLogAuto = () => state.saved.travelLog === 'auto';
async function logJourney(where, heading) {
  const j = curJourney();
  if (!j?.days.length) return;
  await attempt(async () => {
    const sessions = sessionPages();
    if (where === 'new') {
      const next = Math.max(0, ...sessions.map(p => Number(p.meta.number) || 0)) + 1;
      const id = await api.pages.create(`Session ${next}`, { type: 'session', number: next, date: new Date().toISOString().slice(0, 10), ...(state.data.calendar ? { worldDay: today() } : {}) }, TEMPLATES.session);
      state.pages.set(id, await api.pages.read(id));
      rebuildIndex(); renderTree();
      where = id;
    }
    const p = state.pages.get(where);
    const title = p.meta.title;
    await travelNPCPages(j);
    const days = j.days.map(d => d.logged ? d : { ...d, logged: title });
    const head = heading || j.logHeading || G.journeyTitle(j);
    p.body = G.putSection(p.body, `journey ${j.started}`, G.journeySessionMarkdown(j, days.filter(d => d.logged === title), head));
    await api.pages.write(p.id, p.meta, p.body);
    await saveJourney({ ...j, days, logHeading: head });
    return title;
  });
}
/** With the automatic setting on, new days go straight into the latest session's notes. */
async function autoLogJourney() {
  const latest = sessionPages()[0];
  if (travelLogAuto() && latest && curJourney()?.days.some(d => !d.logged)) await logJourney(latest.id);
}
async function askLogJourney() {
  const j = curJourney();
  const sessions = sessionPages();
  const unlogged = j.days.filter(d => !d.logged).length;
  const r = await formDialog('Add the journey to the session notes', `
    <p class="muted" style="margin:0 0 10px">${unlogged ? `${unlogged} day${unlogged === 1 ? '' : 's'} not in the notes yet.` : 'Every day is already in the notes; this brings that section up to date.'} The notes get what happened (encounters, events, getting lost, shortcuts and rides), and quiet days are grouped into one line.</p>
    <label class="field">Session<select name="where">
      ${sessions.map((p, i) => `<option value="${esc(p.id)}" ${i === 0 ? 'selected' : ''}>${esc(p.meta.title)}${i === 0 ? ' (latest)' : ''}</option>`).join('')}
      <option value="new" ${sessions.length ? '' : 'selected'}>A new session note</option></select></label>
    <label class="field">Heading<input name="heading" value="${esc(j.logHeading || G.journeyTitle(j))}"></label>
    <label class="check"><input type="checkbox" name="auto" ${travelLogAuto() ? 'checked' : ''}> From now on, add new days to the latest session by themselves</label>`, 'Add to notes');
  if (!r) return;
  state.saved.travelLog = r.auto ? 'auto' : 'ask';
  await logJourney(r.where, r.heading.trim());
  const where = r.where === 'new' ? sessionPages()[0] : state.pages.get(r.where);
  toast(`The journey is in ${where?.meta.title || 'the session notes'}.`);
  showGenResult();
}

async function travelMore(count) {
  const j = curJourney();
  if (!j) return;
  // Day by day, so a multi-day roll stops at a ride offer that is waiting for an answer.
  const next = rollDays(j, count, { stopAtRide: true });
  if (count > 1 && rideOffers(next).length) toast('A ride is on offer. Take it or turn it down, then carry on.');
  await saveJourney(next);
  await journeyTime(j, next);
  if (next.days.at(-1)?.arrived) await learnCircle(next.to);
  await autoLogJourney();
  showGenResult();
}

/** Step through the circle network: both ends need a circle and the party must know the destination's address. */
async function teleport() {
  const o = travelOpts();
  const from = travelPlace(o.from), to = travelPlace(o.to);
  const page = x => x?.id && state.pages.get(x.id);
  if (!from || !to) return toast('Choose where the party is and where it is going first.', true);
  if (!hasCircle(page(from))) return toast(`${from.name} has no teleport circle. Turn one on from its World map entry if it should.`, true);
  if (!hasCircle(page(to))) return toast(`${to.name} has no teleport circle.`, true);
  if (!knownCircles().includes(to.name)) return toast(`The party doesn't know the circle address of ${to.name} yet. They learn it by visiting, or mark it known under the circle addresses.`, true);
  const c = circleInfo();
  const people = pcs().length || Number(o.partySize) || 4;
  const r = await formDialog(`Teleport from ${from.name} to ${to.name}`, `<p class="muted" style="margin:0 0 10px">The circle is run by ${esc(c.runBy)}. The usual fee is ${esc(G.formatSpirit(c.fee))} spirit coins a traveller.</p>
    <div class="row"><label class="field" style="width:120px">Travellers<input name="people" type="number" min="1" value="${people}"></label>
    <label class="field" style="width:190px" title="Spirit coins, counted in gp: 1 iron = 1 gp, 1 bronze = 100 gp">Fee each (spirit coins, in gp)<input name="each" type="number" min="0" value="${c.fee}"></label>
    <label class="field" style="width:200px" title="Leave empty to charge the fee for each traveller">Custom total (spirit coins, in gp)<input name="total" type="number" min="0" placeholder="Haggled or free"></label></div>
    ${payFromField('purse', 'Pay from', "Nobody: it's free or settled another way")}`, 'Teleport');
  if (!r) return;
  const fee = G.teleportFee(r);
  const pay = r.payFrom !== 'none' && fee > 0;
  if (pay && !(await payFrom(r.payFrom, fee, 'the circle'))) return;
  const tj = G.teleportJourney({ from, to, people: r.people, each: r.each, total: r.total, paid: pay, runBy: c.runBy });
  if (o.name?.trim()) tj.name = o.name.trim();
  if (o.who && partyGroups().some(g => g.id === o.who)) tj.group = o.who;
  await saveJourney(tj);
  await journeyTime(null, tj, 0);
  await autoLogJourney();
  toast(`The party steps through the circle and arrives in ${to.name}${pay ? `, ${G.formatSpirit(fee)} lighter` : ''}.`);
  renderGenerators();
}

// ---------- people met on the road ----------
// Anyone met on a journey who gets a page goes under one Minor NPCs page, so they don't crowd the main NPC list.

const MINOR_NPCS = 'Minor NPCs';
async function minorNPCsPage() {
  if (resolve(MINOR_NPCS)) return;
  const id = await api.pages.create(MINOR_NPCS, { type: 'npc', tags: ['minor'] }, 'People the party has met on the road and in passing. Each has a page of their own nested here.\n');
  state.pages.set(id, await api.pages.read(id));
}
/**
 * Make a page under Minor NPCs for the person in a day's event (or encounter), built by the NPC generator with where
 * they were met. Outworlder references get an outworlder, and the reference goes in a DM-only block.
 * Saves the journey with the page's title on the event, and returns that title.
 */
async function travelNPCPage(j, i, part = 'event', { save = true } = {}) {
  const day = j.days[i];
  const e = day?.[part]?.hit ? day[part].event : null;
  if (!e || e.page) return e?.page || null;
  return attempt(async () => {
    await minorNPCsPage();
    const n = G.generateNPC(state.data, { wiki: wikiTitles(), twist: 'none', ...(e.ref === 'outworlder' ? { people: 'Outworlder' } : {}) });
    let title = n.name;
    for (let k = 2; resolve(title); k++) title = `${n.name} (${k})`;
    const plain = t => String(t || '').replace(/\[\[([^\]]+)\]\]/g, '$1');
    const met = [`## Met on the road`, '', `On day ${day.n} of ${G.journeyTitle(j).replace(/^Journey: /, 'the journey from ')}${day.terrain ? `, in ${day.terrain.toLowerCase()}` : ''}: ${e.name}.`, '', `> ${plain(e.text)}`];
    if (e.nod) met.push('', ':::dm', `Reference${e.ref ? ` (${e.ref})` : ''}: ${e.nod}`, ':::');
    const id = await api.pages.create(title, { type: 'npc', rank: n.rank, origin: S.originFor(n.cover?.role || n.role, n.class), parent: MINOR_NPCS, tags: ['generated', 'traveller', ...(e.ref === 'outworlder' ? ['outworlder'] : [])] },
      G.npcToMarkdown(n) + '\n' + met.join('\n') + '\n');
    state.pages.set(id, await api.pages.read(id));
    rebuildIndex(); renderTree();
    const days = [...j.days];
    days[i] = { ...day, [part]: { ...day[part], event: { ...e, page: title } } };
    j.days = days;
    if (save) await saveJourney({ ...j, days });
    return title;
  });
}
/** People from 'npc' events get their pages once their day goes into the session notes. */
async function travelNPCPages(j) {
  for (let i = 0; i < j.days.length; i++) for (const part of ['encounter', 'event']) {
    const e = !j.days[i].logged && j.days[i][part]?.hit ? j.days[i][part].event : null;
    if (e?.npc && !e.page) await travelNPCPage(j, i, part, { save: false });
  }
}

function showTravel(box) {
  const g = state.gen;
  const j = curJourney();
  const all = journeys();
  if (!state.data.travel?.categories) { box.innerHTML = '<div class="empty">The travel list is missing. Reset "travel" under Generator lists to get it back.</div>'; return; }
  if (!j) { box.innerHTML = '<div class="empty">Choose where the party is going and start the journey. You can also start without a destination and roll one day at a time.</div>'; return; }
  const done = G.journeyDone(j), left = G.journeyLeft(j);
  const arrived = j.days.at(-1)?.arrived;
  const perDay = journeyPace(j);
  const pct = j.miles ? Math.min(100, Math.round(done / j.miles * 100)) : 0;
  const tabs = all.length > 1 ? `<div class="journey-tabs"><span class="muted">Journeys:</span>${all.map(x => `<button class="chip${x.id === j.id ? ' on' : ''}" data-open-journey="${esc(x.id)}" title="${journeyActive(x) ? 'On the road' : 'Arrived'}">${esc(G.journeyTitle(x))}${journeyActive(x) ? '' : ' ✓'}</button>`).join('')}</div>` : '';
  const pinnedNow = pinnedJourneys().includes(j);
  box.innerHTML = `${tabs}<div class="gen-result travel-result">
    <div class="result-head">
      <input id="gen-title" value="${esc(G.journeyTitle(j))}" title="The journey's name: type a new one to rename it">
      <button class="btn" id="travel-pin" title="${pinnedNow ? 'Take it off the sidebar' : 'Keep a button for this journey in the sidebar'}">${pinnedNow ? 'Unpin' : '📌 Pin'}</button>
      ${arrived ? '' : `<button class="btn primary" id="travel-next">Next day</button>
      <button class="btn" id="travel-week" title="Roll seven days, stopping if they arrive">Next 7 days</button>
      ${j.miles ? '<button class="btn" id="travel-all" title="Roll every day until they arrive">Until they arrive</button>' : ''}`}
      ${j.from?.at && j.to?.at ? '<button class="btn" id="travel-show">Show on map</button>' : ''}
      <button class="btn" id="travel-log" title="${travelLogAuto() ? 'New days go into the latest session by themselves. Click to choose another session or turn that off.' : 'Write what happened on the road into a session\'s notes'}">${(() => { const n = j.days.filter(d => !d.logged).length; return n ? `Add to session notes (${n})` : travelLogAuto() ? 'In session notes (auto)' : 'In session notes'; })()}</button>
      <button class="btn" id="gen-save">Save to wiki</button>
      <button class="btn" id="travel-end" title="Clear this journey">End journey</button>
    </div>
    ${j.miles ? `<div class="travel-progress" title="${done} of ${j.miles} miles"><span style="width:${pct}%"></span></div>
      <p class="hint" style="margin:4px 0 10px">${j.via?.length ? `${cap(viaText(j.via))}. ` : ''}${arrived ? j.days[0]?.teleport ? 'Arrived by teleport circle.' : `Arrived after ${j.days.length} day${j.days.length === 1 ? '' : 's'}.` : `${left} miles to go: about ${Math.max(1, Math.ceil(left / Math.max(1, perDay)))} more day${Math.ceil(left / Math.max(1, perDay)) === 1 ? '' : 's'} at ${perDay} miles a day, if they don't get lost.`}</p>` : ''}
    ${arrived || j.days[0]?.teleport ? '' : journeySettingsHTML(j)}
    <p class="hint" style="margin:0 0 8px">Click ↻ to reroll a part of a day. If the players roll the Survival check themselves, set the result with the buttons after it. When an event asks for a check, mark it passed or failed to gain (or lose) the time. Newest day first.</p>
    ${travelOffers(j).map(o => `<div class="place-offer">📍 Day ${o.day.n}: <b>${esc(o.place.name)}</b> isn't on the map yet. It would be ${esc(PL.placeLine(o.place))}. <button class="mini-reroll" data-reroll-place="${o.i}:${o.k}" title="A different new place">↻</button>
      <button class="btn" data-make-place="${o.i}:${o.k}" title="Make it a hidden wiki page with a pin on the map">Make this place</button>
      <button class="btn" data-drop-place="${o.i}:${o.k}" title="Keep the name in the event, without a page">Leave it off the map</button></div>`).join('')}
    ${rideOffers(j).map(o => rideOfferHTML(j, o)).join('')}
    ${seaOffers(j).map(o => seaOfferHTML(j, o)).join('')}
    ${landOffers(j).map(o => landOfferHTML(j, o)).join('')}
    ${seaRouteEmpty(j) ? '<div class="place-offer sea-offer">🌊 There are no sea places along this route yet, so there is nothing to sight on the way. <button class="btn" id="travel-seed-sea" title="Make some for the sea around the route, on the World map">Add sea places along the route</button></div>' : ''}
    <div class="prose">${renderMarkdown(G.journeyToMarkdown(j, { interactive: true, party: travelParty() }))}</div>
  </div>`;
  const redo = async next => { await saveJourney(enterLeg(G.settleJourney(next))); showGenResult(); };
  wireJourneySettings(j, box);
  const prevOf = i => j.days[i - 1] || null;
  wireSeaOffers(j, box);
  wireLandOffers(j, box);
  wireRideOffers(j, box);
  const offerAt = v => { const [i, k] = v.split(':'); return j.days[Number(i)]?.[k]?.event; };
  $$('[data-make-place]', box).forEach(b => b.onclick = async () => {
    const ev = offerAt(b.dataset.makePlace);
    const p = ev?.newPlace;
    if (!p) return;
    await keepPlaces([p], `a travel event on day ${j.days[Number(b.dataset.makePlace.split(':')[0])].n} of ${G.journeyTitle(j)}`);
    // A name someone else took in the meantime stays a link to that page.
    if (resolve(p.name)) p.kept = true;
    await saveJourney(j);
    showGenResult();
  });
  $$('[data-reroll-place]', box).forEach(b => b.onclick = async () => {
    const ev = offerAt(b.dataset.rerollPlace);
    const p = ev?.newPlace;
    const got = p && roadPlaces(j)?.({ fresh: true }, Math.random);
    if (!got?.draft) return toast('No other spot near the road fits a new place.', true);
    const [was, now] = [`[[${p.name}]]`, `[[${got.draft.name}]]`];
    for (const k of ['text', 'twist', 'check', 'failText', 'cost']) if (typeof ev[k] === 'string') ev[k] = ev[k].split(was).join(now);
    ev.newPlace = got.draft;
    await saveJourney(j);
    showGenResult();
  });
  $$('[data-drop-place]', box).forEach(b => b.onclick = async () => {
    const ev = offerAt(b.dataset.dropPlace);
    const p = ev?.newPlace;
    if (!p) return;
    const link = `[[${p.name}]]`;
    for (const k of ['text', 'twist', 'check', 'failText', 'cost']) if (typeof ev[k] === 'string') ev[k] = ev[k].split(link).join(p.name);
    delete ev.newPlace;
    await saveJourney(j);
    showGenResult();
  });
  $$('.mini-reroll[data-part]', box).forEach(b => b.onclick = e => {
    e.preventDefault();
    const i = Number(b.dataset.day);
    const days = [...j.days];
    // A day on an earlier leg is rolled again the way that leg went.
    const o = j.legs ? { ...journeyOpts(j), mode: days[i].mode, terrain: days[i].terrain } : journeyOpts(j);
    days[i] = G.rerollTravelDay(state.data, days[i], b.dataset.part, o, Math.random, { prev: prevOf(i), wiki: travelWiki(), seen: travelSeen(), pending: G.journeyPending(j.days.slice(0, i)) });
    // A whole day rolled again looks out to sea again, unless the party already went exploring that day.
    if (b.dataset.part === 'all') for (const w of ['sea', 'land']) { delete days[i][w]; if (j.days[i][w]?.divert) days[i][w] = j.days[i][w]; }
    redo(lookout({ ...j, days }, i));
  });
  $$('[data-nav]', box).forEach(b => b.onclick = e => {
    e.preventDefault();
    const i = Number(b.dataset.day);
    const days = [...j.days];
    days[i] = G.setTravelNav(days[i], b.dataset.nav);
    redo({ ...j, days });
  });
  $$('[data-check]', box).forEach(b => b.onclick = e => {
    e.preventDefault();
    const i = Number(b.dataset.day);
    const days = [...j.days];
    days[i] = G.setTravelCheck(days[i], b.dataset.check);
    redo({ ...j, days });
  });
  $$('.travel-enc', box).forEach(b => b.onclick = e => {
    e.preventDefault();
    const day = j.days[Number(b.dataset.day)];
    g.encounter = { ...day.encounter.encounter, where: day.terrain, origin: journeyOrigin(j, day) };
    g.tab = 'encounter';
    renderGenerators();
  });
  $$('.travel-npc', box).forEach(b => b.onclick = async e => {
    e.preventDefault();
    const i = Number(b.dataset.day);
    const name = await travelNPCPage(j, i);
    if (!name) return;
    // A day already in the session notes gets its People met line brought up to date.
    const session = j.days[i].logged && resolve(j.days[i].logged);
    if (session) await logJourney(session);
    toast(`Made a page for ${name} under ${MINOR_NPCS}`);
    showGenResult();
  });
  $$('.travel-market', box).forEach(b => b.onclick = e => {
    e.preventDefault();
    g.market = G.generateMarket(state.data, { settlement: 'village', wiki: wikiTitles() });
    g.tab = 'market';
    renderGenerators();
  });
  $$('.travel-pay', box).forEach(b => b.onclick = async e => {
    e.preventDefault();
    const day = j.days[Number(b.dataset.day)];
    const s = G.travelSupplies(day.event.event.lose, travelParty());
    const purse = payFromPurse(s.gp);
    if (!purse) return;
    await savePurse(purse);
    b.disabled = true;
    toast(`Took ${G.formatSpirit(s.gp)} from the party purse for food.`);
  });
  if ($('#travel-next')) $('#travel-next').onclick = () => travelMore(1);
  if ($('#travel-week')) $('#travel-week').onclick = () => travelMore(7);
  if ($('#travel-all')) $('#travel-all').onclick = () => travelMore(365);
  if ($('#travel-show')) $('#travel-show').onclick = () => {
    state.map ||= { vb: null, tool: null, draft: [] };
    state.map.vb = routeView(routePts(j));
    go({ kind: 'map' });
  };
  $('#travel-log').onclick = () => askLogJourney();
  $$('[data-open-journey]', box).forEach(b => b.onclick = () => { g.journeyId = b.dataset.openJourney; renderGenerators(); });
  $('#travel-pin').onclick = async () => { const on = await toggleJourneyPin(j.id); toast(on ? 'Pinned in the sidebar' : 'Unpinned'); showGenResult(); };
  $('#gen-title').onchange = async e => {
    const name = e.target.value.trim();
    await saveJourney({ ...j, name: name || undefined });
    toast(name ? `Renamed to ${name}.` : 'Back to its own name.');
    showGenResult();
  };
  $('#travel-end').onclick = async () => {
    if (!await confirmDialog(`End ${G.journeyTitle(j)}?`, 'This journey and its day log will be cleared, and its sidebar pin removed. Save it to the wiki first if you want to keep it. Any other journeys stay as they are.', 'End journey')) return;
    await saveJourney(j, { remove: true });
    renderGenerators();
  };
  $('#gen-save').onclick = async () => {
    const t = G.journeyTitle(curJourney());
    if (resolve(t)) return toast('A page with that title already exists; rename it first', true);
    await createPage(t, { type: 'lore', tags: ['generated', 'journey'] }, G.journeyToMarkdown(j, { party: travelParty() }));
    toast('Saved to the wiki');
  };
}

/** The path of a location page through its parents, like "Greenstone › Mosswater". */
function placePath(p) {
  const names = [p.meta.title];
  for (let up = parentOf(p), n = 0; up && n < 8; up = parentOf(state.pages.get(up)), n++) names.unshift(state.pages.get(up).meta.title);
  return names.join(' › ');
}

/** Ask where a generated page belongs. Resolves to a place's title, '' for nowhere, or null if cancelled. */
async function pickPlace(title, suggested) {
  const places = visiblePages().filter(p => p.meta.type === 'location').map(p => ({ title: p.meta.title, path: placePath(p) }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const want = places.find(x => x.title.toLowerCase() === String(suggested).toLowerCase())?.title || '';
  const r = await formDialog(`Where is ${title}?`, `<label class="field">Put it under<select name="parent">
      <option value="">Not under a place</option>
      ${places.map(x => `<option value="${esc(x.title)}" ${x.title === want ? 'selected' : ''}>${esc(x.path)}</option>`).join('')}</select></label>
    <p class="hint" style="margin:0">It will sit under that place in the sidebar. You can change it later with <b>Nested under</b> in the page editor.</p>`, 'Save');
  return r ? r.parent : null;
}

const goodsWhere = item => item.kind === 'essence' ? 'into their carried essences, to absorb with a ritual over a long rest' : item.kind === 'core' ? 'onto their monster core count' : 'into their inventory';

/** Put bought or won goods on a party member's sheet: essences are carried, cores counted, everything else goes in the inventory. */
function stowGoods(meta, body, item, from) {
  if (item.kind === 'essence') { G.carryEssence(meta, item.essence); return body; }
  if (item.kind === 'core') {
    const k = item.rank.toLowerCase();
    meta.cores = { iron: 0, bronze: 0, silver: 0, ...(meta.cores || {}) };
    meta.cores[k] = (Number(meta.cores[k]) || 0) + (item.count || 1);
    return body;
  }
  if (item.kind === 'stone') return G.addToInventory(body, `${item.name}: *${item.spell}*, level ${item.level}, for a ${item.affinity}-affinity essence (${from})`);
  return G.addToInventory(body, `${item.name} (${from})`);
}

/** Sell an auction lot to the party: the bid plus the house's premium comes out of the party purse, and the lot goes to one member. */
async function winAuctionLot(i) {
  const a = state.gen.auction;
  const lot = a?.lots[i];
  if (!lot) return;
  const party = pcs();
  if (!party.length) return toast('Add a party member first.', true);
  const pct = Math.round(a.premium * 100);
  const r = await formDialog(`Win lot ${i + 1}: ${lot.name}`, `<p class="muted" style="margin:0 0 10px">The lowest bid that beats the reserve and every rival is ${esc(G.formatSpirit(lot.win))}. The ${pct}% buyer's premium is added on top. It goes ${goodsWhere(lot)}.</p>
    <label class="field">Winner (who keeps it)<select name="who">${buyerOptions()}</select></label>
    ${payFromField(payDefault(lastBuyer(), Math.round(lot.win * (1 + a.premium))))}
    <label class="field" title="In spirit coins, counted in gp: 1 iron = 1 gp, 1 bronze = 100 gp, 1 silver = 10,000 gp">Winning bid (spirit coins, in gp)<input name="bid" type="number" min="0" value="${lot.win}"></label>
    <p class="hint" data-afford style="margin:0"></p>`, 'Win lot', form => wireAfford(form, () => Math.round((Number(form.elements.bid.value) || 0) * (1 + a.premium))));
  if (!r) return;
  const p = state.pages.get(r.who);
  state.lastBuyer = r.who;
  const meta = p.meta;
  const total = Math.round((Math.max(0, Number(r.bid) || 0)) * (1 + a.premium));
  if (!(await payFrom(r.payFrom, total, lot.name))) return;
  const body = stowGoods(meta, p.body, lot, `won at ${a.name}`);
  await attempt(async () => {
    await api.pages.write(p.id, meta, body);
    p.body = body;
    lot.sold = meta.title;
    lot.paid = total;
    toast(`${meta.title} won the ${lot.name} for ${G.formatSpirit(total)}, premium included.`);
    showGenResult();
  });
}

/** Sell goods from the generated market: coins come out of the party purse and the goods go on a member's sheet. */
async function buyFromMarket(i, j) {
  const m = state.gen.market;
  const s = m?.stalls[i];
  const item = s?.goods[j];
  if (!item) return;
  const party = pcs();
  if (!party.length) return toast('Add a party member first.', true);
  const asked = priceFor(m.where, item.price);
  const st = asked !== item.price;
  const r = await formDialog(`Buy ${item.name}`, `<p class="muted" style="margin:0 0 10px">${esc(item.magic ? `${G.formatSpirit(item.price)} spirit coins` : G.formatGp(item.price))} at ${esc(s.name)}. It goes ${goodsWhere(item)}.</p>
    ${st ? `<p class="hint rep-hint" style="margin:0 0 6px">With the party's standing and the market in ${esc(m.where)}, the asking price is ${esc(item.magic ? `${G.formatSpirit(asked)} spirit coins` : G.formatGp(asked))}.</p>` : ''}
    <label class="field">For<select name="who">${buyerOptions()}</select></label>
    ${payFromField(payDefault(lastBuyer(), asked))}
    <label class="field"${item.magic ? ' title="In spirit coins, counted in gp: 1 iron = 1 gp, 1 bronze = 100 gp, 1 silver = 10,000 gp"' : ''}>Price paid, after any haggling (${item.magic ? 'spirit coins, in gp' : 'gp'})<input name="price" type="number" min="0" step="any" value="${asked}"></label>
    <p class="hint" data-afford style="margin:0"></p>`, 'Buy', form => wireAfford(form, () => Number(form.elements.price.value) || 0));
  if (!r) return;
  const p = state.pages.get(r.who);
  state.lastBuyer = r.who;
  const meta = p.meta;
  const price = G.floorPrice(Math.max(0, Number(r.price) || 0));
  if (!(await payFrom(r.payFrom, price, item.name))) return;
  const body = stowGoods(meta, p.body, item, `bought at ${s.name}`);
  await attempt(async () => {
    await api.pages.write(p.id, meta, body);
    p.body = body;
    // Magical goods are one of a kind; cores and everyday goods stay on the shelf.
    if (item.magic && item.kind !== 'core') item.sold = meta.title;
    toast(`${meta.title} bought the ${item.name} for ${item.magic ? G.formatSpirit(price) : G.formatGp(price)}.`);
    showGenResult();
  });
}

/** Titles of the wiki's NPCs, locations and factions, for generators that tie into the world. */
function wikiTitles() {
  const titles = type => [...state.pages.values()].filter(p => p.meta.type === type && p.id !== 'home').map(p => p.meta.title);
  // Churches a priest could openly serve: outlawed and secret ones stay out.
  const churches = [...state.pages.values()].filter(p => (p.meta.tags || []).includes('church') && !(p.meta.tags || []).some(t => t === 'outlawed' || t === 'secret')).map(p => p.meta.title);
  return { npcs: titles('npc'), locations: titles('location'), factions: titles('faction'), churches };
}

/** Pinned slots carry over, and the wiki's NPCs and locations can stand in for the Who and the Where. */
function wordOpts() {
  const g = state.gen;
  const titles = type => [...state.pages.values()].filter(p => p.meta.type === type).map(p => p.meta.title);
  const keep = {};
  for (const s of G.SLOTS) if (g.wordPins?.[s] && g.words) keep[s] = g.words[s];
  return { keep, wiki: { npcs: titles('npc'), locations: titles('location') } };
}

/** Makes a draw's Where a new place near the campaign's start (or the Where's own place). Returns false if none fits. */
function hookPlace(w) {
  const make = placeMaker(w.where?.wiki && !w.where.draft ? w.where.noun : null, [], { want: ['settlement', 'industry', 'site'], miles: [5, 80], chance: 1 });
  const job = make?.({ fresh: true });
  if (!job?.draft) return false;
  w.where = { noun: job.title, wiki: true, draft: job.draft };
  return true;
}

function showWords(box) {
  const g = state.gen;
  const d = state.data;
  if (!d.words) {
    box.innerHTML = '<div class="empty">The word bank list is missing. Reset "words" under Generator lists to get it back.</div>';
    return;
  }
  const w = g.words;
  if (!w) { box.innerHTML = '<div class="empty">Draw to get a who, a what and a where, with two story hooks.</div>'; return; }
  g.wordPins ||= {};
  const note = s => w[s].draft ? `new place: ${PL.placeLine(w[s].draft)}${w[s].draft.kept ? ', saved' : ''}` : w[s].wiki ? 'from your wiki' : s === 'what' && w[s].kind ? (w[s].kind === 'happening' ? 'a happening' : 'a thing') : '';
  const slot = s => `<div class="word-group${g.wordPins[s] ? ' pinned' : ''}"><div class="word-label">${G.SLOT_LABELS[s]}
      <button class="word-pin" data-pin="${s}" title="${g.wordPins[s] ? 'Unpin: draw this slot again' : 'Pin: keep this slot when you draw again'}">${g.wordPins[s] ? 'Pinned' : 'Pin'}</button>
      ${note(s) ? `<span class="word-note">${esc(note(s))}</span>` : ''}
      ${s === 'where' && d.places ? '<button class="word-pin" id="word-newplace" title="Make the Where a new place nearby, with a page and a pin when you keep a hook">📍 New place</button>' : ''}</div><div class="word-chips">
      ${w[s].adj ? `<button class="word-chip adj" data-slot="${s}" data-part="adj" title="Swap this word">${esc(w[s].adj)}</button>` : ''}
      <button class="word-chip${w[s].wiki ? ' wiki' : ''}" data-slot="${s}" data-part="noun" title="Swap this word">${esc(w[s].noun)}</button>
    </div></div>`;
  const history = (g.wordHistory || []).map((h, i) =>
    `<button class="word-past" data-i="${i}" title="Bring this draw back">${esc(G.SLOTS.map(s => G.slotPhrase(h[s])).join(' · '))}</button>`).join('');
  box.innerHTML = `<div class="gen-result">
    <div class="result-head">
      <h2>Word bank</h2>
      <button class="btn" id="gen-reroll">Draw again</button>
      <button class="btn" id="words-copy">Copy</button>
      <button class="btn" data-nav="hooks" title="Hooks you starred">Saved hooks (${state.saved.hooks.length})</button>
      <button class="btn primary" id="gen-save">Save to wiki</button>
    </div>
    <div class="word-slots">${G.SLOTS.map(slot).join('')}</div>
    ${w.hooks.length ? `<div class="word-group"><div class="word-label">Story hooks</div>
      ${w.hooks.map((h, i) => { const on = isHookSaved(w, h); return `<div class="hook-row">
        <button class="word-quirk" data-hook="${i}" title="Swap this hook">${esc(G.hookText(w, h))}</button>
        <button class="hook-star${on ? ' on' : ''}" data-star="${i}" title="${on ? 'Remove from saved hooks' : 'Save this hook for later'}">${on ? '★' : '☆'}</button>
      </div>`; }).join('')}
    </div>` : ''}
  </div>
  ${history ? `<div class="word-history"><div class="word-label">Earlier draws</div>${history}</div>` : ''}`;
  $$('[data-slot]', box).forEach(b => b.onclick = () => {
    g.words = G.redrawOne(d, g.words, { slot: b.dataset.slot, part: b.dataset.part }, Math.random, wordOpts());
    showWords(box);
  });
  $$('[data-pin]', box).forEach(b => b.onclick = () => {
    g.wordPins[b.dataset.pin] = !g.wordPins[b.dataset.pin];
    showWords(box);
  });
  const np = $('#word-newplace', box);
  if (np) np.onclick = () => {
    if (!hookPlace(g.words)) return toast('No room for a new place near the campaign\'s start. Give a place a pin on the World map first.', true);
    showWords(box);
  };
  // Keeping a hook or the draw keeps the new place it names.
  const keepWhere = async (from, text = null) => {
    const dr = g.words.where?.draft;
    if (!dr || dr.kept || (text && !text.includes(dr.name))) return 0;
    return keepPlaces([dr], from);
  };
  $$('[data-hook]', box).forEach(b => b.onclick = () => {
    g.words = G.redrawOne(d, g.words, { hook: Number(b.dataset.hook) });
    showWords(box);
  });
  $$('[data-star]', box).forEach(b => b.onclick = async () => {
    const hook = g.words.hooks[Number(b.dataset.star)];
    const text = G.hookText(g.words, hook);
    const i = state.saved.hooks.findIndex(h => h.text === text);
    if (i >= 0) state.saved.hooks.splice(i, 1);
    else state.saved.hooks.unshift(G.savedHook(g.words, hook));
    const made = i >= 0 ? 0 : await keepWhere(`Story hook: ${text}`, text);
    showWords(box);
    await saveSaved();
    toast(i >= 0 ? 'Removed from saved hooks' : `Saved (${state.saved.hooks.length} hooks)${made ? `, and ${g.words.where.noun} is on the map` : ''}`);
  });
  $$('.word-past', box).forEach(b => b.onclick = () => {
    const i = Number(b.dataset.i);
    const past = g.wordHistory[i];
    g.wordHistory.splice(i, 1, g.words);
    g.words = past;
    showWords(box);
  });
  $('#gen-reroll').onclick = () => runGenerator({});
  $('#words-copy').onclick = async () => {
    try { await navigator.clipboard.writeText(G.wordsToText(w)); toast('Copied'); }
    catch (e) { toast('Could not copy: ' + e.message, true); }
  };
  $('#gen-save').onclick = async () => {
    let t = G.wordsTitle(w);
    for (let i = 2; resolve(t); i++) t = `${G.wordsTitle(w)} (${i})`;
    await keepWhere(t);
    await createPage(t, { type: 'adventure', tags: ['word-bank'] }, G.wordsToMarkdown(w), true);
    toast('Saved to the wiki');
  };
}

// ---------- saved hooks ----------

function isHookSaved(draw, hook) {
  const text = G.hookText(draw, hook);
  return state.saved.hooks.some(h => h.text === text);
}

async function saveSaved() {
  await attempt(() => api.saved.write(state.saved));
}

function renderSavedHooks() {
  const v = state.savedView;
  const all = state.saved.hooks;
  const unused = all.filter(h => !h.used).length;
  $('#view').innerHTML = `<div class="page">
    <div class="row" style="margin-bottom:8px">
      <h1 style="flex:1;margin:0;font:600 32px var(--serif)">Saved hooks</h1>
      <button class="btn primary" id="saved-random" ${unused ? '' : 'disabled'}>Pick one at random</button>
    </div>
    <p class="hint">${all.length ? `${all.length} saved, ${unused} not used yet.` : ''} Star a hook in the Word bank to keep it here, then pull it up at the table. Adding one to a session puts it in that session's notes and marks it used.</p>
    <div class="row" style="align-items:center;margin-bottom:12px">
      <input id="saved-q" type="search" placeholder="Search saved hooks" value="${esc(v.q)}" style="flex:1">
      <label class="check"><input type="checkbox" id="saved-hide" ${v.hideUsed ? 'checked' : ''}> Hide used</label>
    </div>
    <div id="saved-list"></div>
  </div>`;
  $('#saved-q').oninput = e => { v.q = e.target.value; v.picked = null; renderSavedList(); };
  $('#saved-hide').onchange = e => { v.hideUsed = e.target.checked; renderSavedList(); };
  $('#saved-random').onclick = () => {
    const pool = G.filterSaved(all, v.q, true);
    if (!pool.length) return toast('No unused hooks match the search', true);
    v.picked = pool[Math.floor(Math.random() * pool.length)].id;
    renderSavedList();
    $(`.saved-hook[data-id="${v.picked}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  renderSavedList();
}

function renderSavedList() {
  const v = state.savedView;
  const box = $('#saved-list');
  const all = state.saved.hooks;
  const list = G.filterSaved(all, v.q, v.hideUsed);
  const session = sessionPages()[0];
  if (!all.length) { box.innerHTML = '<div class="empty">No saved hooks yet. Draw in the Word bank and star the hooks you like.</div>'; return; }
  if (!list.length) { box.innerHTML = '<div class="empty">No saved hooks match.</div>'; return; }
  box.innerHTML = list.map(h => `<div class="saved-hook${h.used ? ' used' : ''}${h.id === v.picked ? ' picked' : ''}" data-id="${esc(h.id)}">
      <div class="prose">${renderMarkdown(h.md || h.text)}</div>
      <div class="saved-meta muted">${esc(h.words.join(' · '))} · saved ${esc((h.saved || '').slice(0, 10))}${h.used ? ` · <strong>used${h.used.session ? ` in ${esc(h.used.session)}` : ''}</strong>` : ''}</div>
      <div class="saved-actions">
        ${session && !h.used ? `<button class="btn" data-act="session">Add to ${esc(session.meta.title)}</button>` : ''}
        <button class="btn" data-act="used">${h.used ? 'Mark not used' : 'Mark used'}</button>
        <button class="btn" data-act="open">Open in word bank</button>
        <button class="btn" data-act="copy">Copy</button>
        <button class="btn danger-text" data-act="delete">Delete</button>
      </div>
    </div>`).join('');
  $$('.saved-hook [data-act]', box).forEach(b => b.onclick = async () => {
    const h = all.find(x => x.id === b.closest('.saved-hook').dataset.id);
    const act = b.dataset.act;
    if (act === 'session') {
      const body = addHookToSession(session.body, h.md || h.text);
      await attempt(() => api.pages.write(session.id, session.meta, body));
      session.body = body;
      rebuildIndex();
      h.used = { session: session.meta.title, date: new Date().toISOString().slice(0, 10) };
      toast(`Added to ${session.meta.title}`);
    }
    if (act === 'used') h.used = h.used ? null : { date: new Date().toISOString().slice(0, 10) };
    if (act === 'copy') {
      try { await navigator.clipboard.writeText(h.text); toast('Copied'); } catch (e) { toast('Could not copy: ' + e.message, true); }
      return;
    }
    if (act === 'open') {
      const g = state.gen;
      if (g.words) g.wordHistory = [g.words, ...(g.wordHistory || [])].slice(0, 10);
      g.words = h.draw;
      g.tab = 'words';
      return go({ kind: 'generators' });
    }
    if (act === 'delete') {
      if (!(await confirmDialog('Delete this hook?', h.text, 'Delete'))) return;
      all.splice(all.indexOf(h), 1);
    }
    await saveSaved();
    renderSavedHooks();
  });
}

/** Adds a hook to a session's notes, at the end of its "Hooks used" list. */
function addHookToSession(body, hook) {
  const lines = body.replace(/\s*$/, '').split('\n');
  const h = lines.findIndex(l => /^##\s+Hooks used\s*$/.test(l));
  if (h === -1) return lines.join('\n') + `\n\n## Hooks used\n\n- ${hook}\n`;
  let i = h + 1;
  while (i < lines.length && (lines[i].trim() === '' || lines[i].startsWith('- ')) && !(lines[i].trim() === '' && lines[i + 1]?.startsWith('#'))) i++;
  while (i > h + 1 && lines[i - 1].trim() === '') i--;
  if (i === h + 1) lines.splice(i, 0, '');
  lines.splice(i === h + 1 ? i + 1 : i, 0, `- ${hook}`);
  return lines.join('\n') + '\n';
}

function svgInlineStyle(cls) {
  // Saved SVGs are viewed outside the app's stylesheet, so bake colors in.
  if (cls === 'map-link') return 'stroke="#4a4258" stroke-width="3"';
  if (cls === 'map-num') return 'fill="#ebe6f2" stroke="none" font-family="sans-serif" font-weight="700" font-size="15"';
  if (cls === 'map-label') return 'fill="#a69db5" stroke="none" font-family="sans-serif" font-size="11"';
  const room = cls.match(/room-(\w+)/);
  if (room) {
    const stroke = { entrance: '#7fd1a8', boss: '#ff7b7b', combat: '#f2c46d', lair: '#f2c46d', treasure: '#f0c94e', puzzle: '#c9a2ff', inhabitant: '#c9a2ff', feature: '#c9a2ff', trap: '#ff7b7b', hazard: '#ff7b7b' }[room[1]] || '#a69db5';
    return `fill="#262230" stroke="${stroke}" stroke-width="2"`;
  }
  return '';
}

// ---------- generator list editor ----------

// Which generators each list feeds, shown above it so the DM knows what an edit changes.
const LIST_FEEDS = {
  astral: 'Astral space', auction: 'Auction house', bestiary: 'Encounter, the Bestiary, Battle', buildings: 'Temple, Orphanage, Place feature, Control point',
  calendar: 'The calendar and Advance time', children: 'A child', classes: 'NPC (class), character sheets', compendium: 'Reference pages',
  confluences: 'The Essences browser', contracts: 'Contracts, Prep a visit', divine: 'Temples, divine essences', encounters: 'Encounter',
  essences: 'Treasure, Market, Auction house, NPC essences', factions: 'Faction aims and control points', food: 'Tavern menus',
  incidents: 'Storyteller and small events', items: 'Market, Treasure, Auction house', market: 'Market, Prep a visit', monsters: 'Encounter, Astral space, monster cores',
  npc: 'NPC, and everyone the other generators make', people: 'NPC lives', peoples: 'NPC (peoples and names)', places: 'New places, Sea places, town pages',
  quirks: 'Town quirk, new places', rolls: 'Encounter details, Quick rolls, Treasure, who lives where', spells: 'Spells, awakening stones',
  story: 'Storyteller', tavern: 'Tavern, Prep a visit', travel: 'Travel, encounter terrain', variants: 'Monster variants in Encounter', words: 'Word bank',
};

async function renderLists() {
  const v = state.view;
  const names = (await attempt(() => api.data.list()) || []).filter(n => n[0] !== '_');
  const cur = v.list || names[0];
  const mode = v.mode || 'table';
  const text = cur ? await attempt(() => api.data.readRaw(cur)) : '';
  let json = null;
  try { json = JSON.parse(text); } catch {}
  $('#view').innerHTML = `<div class="wide">
    <h1 style="margin:0 0 8px;font:600 32px var(--serif)">Generator lists</h1>
    <p class="hint">These lists drive the generators for this campaign: essences, monsters, names, astral space rooms and more. Edit them here, or open the campaign folder and edit the files in <code>data</code> with any text editor.</p>
    <div class="row" style="margin-bottom:10px">
      <label class="field">List<select id="list-pick">${names.map(n => `<option ${n === cur ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
      <div class="seg" style="align-self:flex-end">${[["table", "Table"], ["raw", "Raw JSON"]].map(([m, l]) => `<button class="chip${mode === m ? " on" : ""}" data-list-mode="${m}">${l}</button>`).join("")}</div>
      <span class="spacer"></span>
      <button class="btn" id="list-reset">Reset to starter default</button>
      ${mode === 'raw' ? '<button class="btn primary" id="list-save">Save</button>' : ''}
    </div>
    ${LIST_FEEDS[cur] ? `<p class="hint list-feeds">Feeds: <b>${esc(LIST_FEEDS[cur])}</b></p>` : ''}
    ${mode === 'raw' || !json ? `<textarea class="json" id="list-text" spellcheck="false">${esc(text || '')}</textarea>
    <p class="hint" id="list-status">${json ? '' : '<span class="warn">This list isn\'t valid JSON, so it can only be edited as text.</span>'}</p>` : '<div id="list-table"></div>'}
  </div>`;
  $('#list-pick').onchange = e => go({ kind: 'lists', list: e.target.value, mode }, { replace: true });
  $$('[data-list-mode]').forEach(b => b.onclick = () => go({ kind: 'lists', list: cur, mode: b.dataset.listMode }, { replace: true }));
  $('#list-reset').onclick = async () => {
    if (!await confirmDialog('Reset this list?', 'Your changes to this list will be replaced with the starter default. Entries you switched off stay off.', 'Reset')) return;
    const t = await attempt(() => api.data.resetFromStarter(cur));
    if (t !== undefined) { await loadData(); toast('List reset'); renderLists(); }
  };
  if ($('#list-text')) {
    $('#list-text').oninput = () => {
      try { JSON.parse($('#list-text').value); $('#list-status').textContent = ''; }
      catch (e) { $('#list-status').innerHTML = `<span class="warn">Not valid JSON yet: ${esc(e.message)}</span>`; }
    };
    if ($('#list-save')) $('#list-save').onclick = async () => {
      const ok = await attempt(() => api.data.writeRaw(cur, $('#list-text').value));
      if (ok) { await loadData(); toast('List saved'); }
    };
    return;
  }
  listTable(cur, json);
}

/** The table view of one list: its sections on the left, the entries of one on the right. */
function listTable(name, json) {
  const v = state.view;
  const sections = R.listSections(json);
  const box = $('#list-table');
  if (!sections.length) { box.innerHTML = '<p class="hint">This list has no tables of entries. Use Raw JSON to edit it.</p>'; return; }
  const offOf = s => new Set(state.genRolls?.off?.[name]?.[s.path.join('.')] || []);
  let sel = sections.find(s => s.path.join('.') === v.section) || sections[0];
  const save = async () => {
    const ok = await attempt(() => api.data.writeRaw(name, JSON.stringify(json, null, 2) + '\n'));
    if (ok) await loadData();
    return ok;
  };
  const drawSections = () => {
    const q = ($('#list-sec-q')?.value || '').toLowerCase();
    $('#list-secs').innerHTML = sections.filter(s => !q || s.label.toLowerCase().includes(q) || s.items.some(x => R.entryKey(x).toLowerCase().includes(q))).map(s => {
      const off = offOf(s).size;
      return `<button class="list-sec${s === sel ? ' active' : ''}" data-sec="${esc(s.path.join('.'))}"><span>${esc(s.label)}</span><span class="muted">${s.items.length}${off ? `, ${off} off` : ''}</span></button>`;
    }).join('') || '<p class="hint">Nothing matches.</p>';
    $$('#list-secs [data-sec]').forEach(b => b.onclick = () => { sel = sections.find(s => s.path.join('.') === b.dataset.sec); v.section = b.dataset.sec; drawSections(); drawEntries(); });
  };
  const drawEntries = () => {
    const off = offOf(sel), q = ($('#list-q')?.value || '').toLowerCase();
    const summary = x => Object.entries(x).filter(([k, val]) => k !== 'name' && ['string', 'number', 'boolean'].includes(typeof val)).slice(0, 4).map(([k, val]) => `${k}: ${String(val).slice(0, 60)}`).join(' · ');
    $('#list-entries').innerHTML = `<div class="list-entries-head"><b>${esc(sel.label)}</b><input id="list-q" type="search" placeholder="Search entries" value="${esc(q)}"></div>
      <div class="list-rows">${sel.items.map((x, i) => {
        const k = R.entryKey(x);
        if (q && !JSON.stringify(x).toLowerCase().includes(q)) return '';
        return `<div class="list-row${off.has(k) ? ' off' : ''}" data-i="${i}">
          <label class="inline-check" title="Switched off entries are never rolled in this campaign, but stay in the list"><input type="checkbox" data-on ${off.has(k) ? '' : 'checked'}></label>
          ${sel.kind === 'text' ? `<span class="list-text" contenteditable="plaintext-only" spellcheck="true">${esc(x)}</span>` : `<span class="list-text"><b>${esc(k.slice(0, 80))}</b> <span class="muted">${esc(summary(x))}</span></span><button class="btn small" data-edit>Edit</button>`}
          <button class="mini-reroll" data-del title="Delete this entry">✕</button></div>`;
      }).join('')}</div>
      <form class="row list-add" id="list-add">${sel.kind === 'text' ? '<input name="text" placeholder="A new entry" style="flex:1" required><button class="btn primary">Add</button>' : '<button class="btn primary" type="submit">+ New entry</button><span class="hint">Starts as a copy of the first entry, to fill in.</span>'}</form>`;
    const lq = $('#list-q');
    lq.oninput = () => { const at = lq.selectionStart; drawEntries(); const n = $('#list-q'); n.focus(); n.setSelectionRange(at, at); };
    $$('#list-entries .list-row').forEach(row => {
      const i = Number(row.dataset.i), x = sel.items[i], k = R.entryKey(x);
      $('[data-on]', row).onchange = async e => {
        state.genRolls.off = R.setOff(state.genRolls.off, name, sel.path, k, e.target.checked);
        saveRolls();
        await loadData();
        row.classList.toggle('off', !e.target.checked);
        drawSections();
      };
      $('[data-del]', row).onclick = async () => {
        if (sel.items.length <= 1) return toast('A table needs at least one entry.', true);
        if (!await confirmDialog('Delete this entry?', k.slice(0, 200), 'Delete')) return;
        sel.items.splice(i, 1);
        if (await save()) { drawSections(); drawEntries(); }
      };
      const t = $('.list-text[contenteditable]', row);
      if (t) t.onblur = async () => {
        const val = t.textContent.trim();
        if (!val || val === x) { t.textContent = x; return; }
        sel.items[i] = val;
        if (await save()) toast('Saved');
      };
      const ed = $('[data-edit]', row);
      if (ed) ed.onclick = async () => {
        const r = await formDialog(`Edit ${k.slice(0, 60)}`, `<textarea class="json" name="json" spellcheck="false" style="min-height:260px">${esc(JSON.stringify(x, null, 2))}</textarea>`, 'Save');
        if (!r) return;
        try { sel.items[i] = JSON.parse(r.json); } catch (e) { return toast('Not valid JSON: ' + e.message, true); }
        if (await save()) drawEntries();
      };
    });
    $('#list-add').onsubmit = async e => {
      e.preventDefault();
      if (sel.kind === 'text') {
        const val = e.target.elements.text.value.trim();
        if (!val) return;
        sel.items.push(val);
      } else {
        const blank = JSON.parse(JSON.stringify(sel.items[0]), (key, val) => typeof val === 'string' && key ? '' : val);
        const r = await formDialog('New entry', `<textarea class="json" name="json" spellcheck="false" style="min-height:260px">${esc(JSON.stringify(blank, null, 2))}</textarea>`, 'Add');
        if (!r) return;
        try { sel.items.push(JSON.parse(r.json)); } catch (err) { return toast('Not valid JSON: ' + err.message, true); }
      }
      if (await save()) { toast('Added'); drawSections(); drawEntries(); $('#list-add input')?.focus(); }
    };
  };
  box.innerHTML = `<div class="list-table"><div class="list-side"><input id="list-sec-q" type="search" placeholder="Find a table or entry"><div id="list-secs"></div></div><div id="list-entries"></div></div>`;
  $('#list-sec-q').oninput = drawSections;
  drawSections();
  drawEntries();
}

/** A small ⊘ beside the line under the mouse in a result; it offers to switch that line's list entry off. */
function wireNeverRoll(prose) {
  if (!prose || !state.dm) return;
  const b = document.createElement('button');
  b.className = 'never-roll';
  b.textContent = '⊘';
  b.title = 'Never roll this: switch this entry off for the campaign';
  b.hidden = true;
  prose.style.position = 'relative';
  prose.append(b);
  let line = null;
  prose.addEventListener('mouseover', e => {
    if (e.target === b) return;
    const el = e.target.closest('li, p, td');
    if (!el || !prose.contains(el) || el.querySelector('li, p')) return;
    line = el;
    const r = el.getBoundingClientRect(), pr = prose.getBoundingClientRect();
    b.style.top = `${r.top - pr.top + prose.scrollTop}px`;
    b.hidden = false;
  });
  prose.addEventListener('mouseleave', () => { b.hidden = true; });
  b.onclick = e => {
    e.preventDefault();
    if (!line) return;
    const c = line.cloneNode(true);
    $$('button', c).forEach(x => x.remove());
    neverRoll(c.textContent);
  };
}

/** "Never roll this": on a rolled line, find the list entry it came from and switch it off for this campaign. */
async function neverRoll(line) {
  const found = R.entriesInLine(state.data, line);
  if (!found.length) return toast('That line isn\'t a single list entry, so it can\'t be switched off from here. Try Generator lists.', true);
  const r = await formDialog('Never roll this', `<p class="muted" style="margin:0 0 8px">Switched off entries stay in the list and can be turned back on under Generator lists.</p>
    ${found.slice(0, 6).map((f, i) => `<label class="inline-check" style="display:flex;gap:6px;margin:4px 0"><input type="radio" name="pick" value="${i}" ${i ? '' : 'checked'}> <span>“${esc(f.key.slice(0, 140))}” <span class="muted">(${esc(f.list)} › ${esc(f.label)})</span></span></label>`).join('')}`, 'Switch it off');
  if (!r) return;
  const f = found[Number(r.pick) || 0];
  state.genRolls.off = R.setOff(state.genRolls.off, f.list, f.path, f.key, false);
  saveRolls();
  await loadData();
  toast(`Switched off. It won't be rolled again in this campaign.`);
}

// ---------- essences browser ----------
// Every essence and confluence in one place: search and filter, then open one to see its trait, stone spells,
// what it forms, and give it to a party member.

/** Divine essences players shouldn't see: those of secret churches, or whose church page is DM-only. */
function hiddenDivine() {
  if (state.dm) return [];
  return (state.data.divine?.essences || []).filter(d => {
    const p = state.pages.get(resolve(d.church));
    return p && (hiddenPage(p) || [].concat(p.meta.tags || []).includes('secret'));
  }).map(d => d.name);
}

function renderEssences() {
  const v = state.view;
  v.tab = v.tab || 'essences';
  const d = state.data;
  const affinities = G.essenceThemes(d);
  // An affinity link opens the browser on that one affinity.
  if (v.affinity) { v.affs = [v.affinity]; delete v.affinity; }
  v.affs ||= []; v.rars ||= []; v.levels ||= [];
  const second = v.tab === 'essences' ? { key: 'rars', label: 'Rarity', options: G.RARITIES.map(r => [r, cap(r)]) }
    : v.tab === 'stones' ? { key: 'levels', label: 'Spell level', options: [1, 2, 3, 4, 5].map(l => [String(l), `${l} (${G.STONE_RANK[l]})`]) }
    : { key: 'rars', label: 'Kind', options: [['divine', 'Divine only']] };
  const chips = (key, options) => options.map(([val, label]) => `<button class="chip${v[key].includes(val) ? ' on' : ''}" data-chip="${key}" data-val="${esc(val)}">${esc(label)}</button>`).join('');
  $('#view').innerHTML = `<div class="wide browser">
    <h1 style="margin:0 0 8px;font:600 32px var(--serif)">Essences</h1>
    <div class="tabs">
      <button class="${v.tab === 'essences' ? 'active' : ''}" data-tab="essences">Essences</button>
      <button class="${v.tab === 'confluences' ? 'active' : ''}" data-tab="confluences">Confluences</button>
      <button class="${v.tab === 'stones' ? 'active' : ''}" data-tab="stones">Awakening stones</button>
    </div>
    <div class="filters">
      <input id="ess-q" type="search" placeholder="${v.tab === 'stones' ? 'Search spells, affinities or what a spell does' : 'Search names, themes, traits or gods'}" value="${esc(v.q || '')}">
      ${v.tab === 'stones' ? `<select id="stone-div"><option value="">Affinity and divine stones</option><option value="none" ${v.divine === 'none' ? 'selected' : ''}>Affinity stones only</option><option value="only" ${v.divine === 'only' ? 'selected' : ''}>Divine stones only</option></select>` : ''}
      <button class="btn small" id="ess-clear">Clear filters</button>
      <span class="muted" id="ess-count"></span>
    </div>
    <div class="chip-row"><span class="chip-label">Affinity</span>${chips('affs', affinities.map(a => [a, a]))}</div>
    <div class="chip-row"><span class="chip-label">${second.label}</span>${chips(second.key, second.options)}</div>
    <div class="browser-body"><div class="browser-list" id="ess-list"></div><div class="browser-detail" id="ess-detail"></div></div>
  </div>`;
  const filters = () => ({ q: v.q || '', affinity: v.affs, rarity: v.rars, level: v.levels, divine: v.divine || '' });
  const keyOf = x => v.tab === 'stones' ? x.id : x.name;
  const drawList = () => {
    const hide = hiddenDivine();
    const all = v.tab === 'essences' ? G.essenceCatalog(d, hide) : v.tab === 'stones' ? G.stoneCatalog(d, hide) : G.confluenceCatalog(d, hide);
    const shown = v.tab === 'essences' ? G.filterEssences(all, filters()) : v.tab === 'stones' ? G.filterStones(all, filters()) : G.filterConfluences(all, filters());
    $('#ess-count').textContent = `${shown.length} of ${all.length}`;
    $('#ess-list').innerHTML = shown.length ? shown.map(x => v.tab === 'essences'
      ? `<button class="ess-item${x.name === v.sel ? ' active' : ''}" data-sel="${esc(x.name)}">
          <span class="ess-name">${esc(x.name)}</span><span class="rarity rarity-${esc(x.rarity)}">${esc(x.rarity)}</span>
          <span class="muted">${esc(x.affinity)}${x.trait?.name ? ` · ${esc(x.trait.name)}` : ''}</span></button>`
      : v.tab === 'stones'
      ? `<button class="ess-item${x.id === v.sel ? ' active' : ''}" data-sel="${esc(x.id)}">
          <span class="ess-name">${esc(cap(x.spell))}</span><span class="item-price">level ${x.level}</span>
          <span class="muted">${esc(x.divine || x.affinity)} · ${esc(x.rank)} · ${esc(G.formatSpirit(x.price))}</span></button>`
      : `<button class="ess-item${x.name === v.sel ? ' active' : ''}" data-sel="${esc(x.name)}">
          <span class="ess-name">${esc(x.name)}</span>${x.divine ? '<span class="rarity rarity-divine">divine</span>' : ''}
          <span class="muted">${x.trio ? `${esc(x.trio.join(' + '))} affinities` : `recipes of ${esc((d.divine?.essences || []).find(e => e.god === x.god)?.called || x.god)}`}${x.grant?.name ? ` · ${esc(x.grant.name)}` : ''}</span></button>`).join('')
      : '<p class="hint">Nothing matches. Clear the search or a filter.</p>';
    if (!v.sel || !shown.some(x => keyOf(x) === v.sel)) v.sel = shown[0] && keyOf(shown[0]);
    $$('#ess-list .ess-item').forEach(b => b.classList.toggle('active', b.dataset.sel === v.sel));
    drawDetail(all);
  };
  const drawDetail = all => {
    const el = $('#ess-detail');
    if (!v.sel) { el.innerHTML = ''; return; }
    el.innerHTML = v.tab === 'essences' ? essenceDetail(v.sel) : v.tab === 'stones' ? stoneDetail(all.find(x => x.id === v.sel)) : confluenceDetail(v.sel);
    el.scrollTop = 0;
    const give = $('#give-btn', el);
    if (give) give.onclick = () => v.tab === 'stones' ? giveStone(all.find(x => x.id === v.sel), $('#give-to', el).value, false) : giveEssence(v.sel, $('#give-to', el).value);
    const buy = $('#stone-buy', el);
    if (buy) buy.onclick = () => giveStone(all.find(x => x.id === v.sel), $('#give-to', el).value, true);
  };
  let all = null;
  $('#ess-list').addEventListener('click', e => {
    const b = e.target.closest('[data-sel]');
    if (!b) return;
    v.sel = b.dataset.sel;
    $$('#ess-list .ess-item').forEach(x => x.classList.toggle('active', x.dataset.sel === v.sel));
    const hide = hiddenDivine();
    drawDetail(all = v.tab === 'stones' ? G.stoneCatalog(d, hide) : null);
  });
  let t;
  $('#ess-q').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => { v.q = e.target.value; drawList(); }, 150); });
  $$('[data-chip]').forEach(b => b.onclick = () => {
    const list = v[b.dataset.chip];
    const i = list.indexOf(b.dataset.val);
    if (i < 0) list.push(b.dataset.val); else list.splice(i, 1);
    b.classList.toggle('on', i < 0);
    drawList();
  });
  if ($('#stone-div')) $('#stone-div').onchange = e => { v.divine = e.target.value; drawList(); };
  $('#ess-clear').onclick = () => { v.affs = []; v.rars = []; v.levels = []; v.q = ''; v.divine = ''; renderEssences(); };
  $$('.tabs [data-tab]').forEach(b => b.onclick = () => go({ kind: 'essences', tab: b.dataset.tab, affs: [...v.affs] }, { replace: true }));
  drawList();
  const active = $('#ess-list .ess-item.active');
  if (active) active.scrollIntoView({ block: 'nearest' });
}

function stoneDetail(s) {
  if (!s) return '';
  const d = state.data;
  const i = s.info;
  const party = pcs();
  const fits = s.divine ? `the ${jumpEss(s.divine)} essence only` : `any ${jumpAff(s.affinity)}-affinity essence (${s.essences} in the compendium)`;
  return `<div class="detail">
    <h2>${esc(cap(s.spell))}</h2>
    <div class="badges"><span class="badge">${esc(s.divine ? `${s.divine} stone` : `${s.affinity} awakening stone`)}</span><span class="badge">spell level ${s.level}</span>
      <span class="badge rank rank-${esc(s.rank)}">${esc(s.rank)}</span>${s.divine ? '<span class="rarity rarity-divine">divine</span>' : ''}</div>
    ${i ? `<p>${esc(i.summary)} ${spellLink(i.key, 'Full spell card')}</p>
      <table class="spells"><tbody>
        <tr><th>School</th><td>${esc(cap(i.school || ''))}</td></tr>
        <tr><th>Casting time</th><td>${esc(i.time || '')}</td></tr>
        <tr><th>Range</th><td>${esc(i.range || '')}</td></tr>
        <tr><th>Duration</th><td>${esc(i.duration || '')}${i.concentration ? ' (concentration)' : ''}</td></tr>
      </tbody></table>` : '<p class="muted">No summary for this spell yet. Add one to the <code>spells</code> list.</p>'}
    <h3>As a stone</h3>
    <table class="spells"><tbody>
      <tr><th>Awakens on</th><td>${fits}</td></tr>
      <tr><th>Usable from</th><td>${esc(s.rank)} rank (spell level ${s.level})</td></tr>
      <tr><th>Use</th><td>Once per long rest, without a spell slot</td></tr>
      <tr><th>Price</th><td>${esc(G.formatGp(s.price))} (${esc(G.formatSpirit(s.price))} spirit coins)${s.divine ? '. Divine stones are rarely sold; most are granted' : ''}</td></tr>
    </tbody></table>
    <p class="hint">See <a class="wikilink" data-target="Awakening Stones">Awakening Stones</a> for how stones are absorbed and used.</p>
    <div class="give">
      ${party.length ? `<label class="field">Party member<select id="give-to">${party.map(p => `<option value="${esc(p.id)}">${esc(p.meta.title)}</option>`).join('')}</select></label>
        <button class="btn" id="give-btn" title="Add it to their inventory for free: found, looted or a gift">Give</button>
        <button class="btn primary" id="stone-buy">Buy for ${esc(G.formatSpirit(s.price))}</button>` : '<p class="hint">Add a party member to give or sell them stones from here.</p>'}
    </div>
  </div>`;
}

/** Give an awakening stone to a party member, or sell it to them: it goes into their inventory, ready to absorb. */
async function giveStone(s, id, pay) {
  const p = state.pages.get(id);
  if (!p || !s) return;
  const meta = p.meta;
  const from = pay ? payDefault(id, s.price) : null;
  if (pay && !(await payFrom(from, s.price, `the ${s.spell} stone`))) return;
  const body = G.addToInventory(p.body, `${s.divine || s.affinity} awakening stone: *${s.spell}*, level ${s.level}, for ${s.divine ? `the ${s.divine} essence` : `a ${s.affinity}-affinity essence`}`);
  await attempt(async () => {
    await api.pages.write(p.id, meta, body);
    p.body = body;
    toast(pay ? `${meta.title} bought the stone for ${G.formatSpirit(s.price)}, from ${payerName(from)}.` : `Stone added to ${meta.title}'s inventory.`);
  });
}

const jumpEss = n => `<a href="#" class="jump" data-jump="essences" data-name="${esc(n)}">${esc(n)}</a>`;
const jumpConf = n => `<a href="#" class="jump" data-jump="confluences" data-name="${esc(n)}">${esc(n)}</a>`;
const jumpAff = a => `<a href="#" class="jump" data-jump="essences" data-aff="${esc(a)}">${esc(a)}</a>`;

function essenceDetail(name) {
  const d = state.data;
  const e = G.essenceCatalog(d, hiddenDivine()).find(x => x.name === name);
  if (!e) return '';
  const dv = e.divine;
  const { recipes, trios } = G.confluencesFor(d, name);
  const hide = hiddenDivine();
  const okRecipe = r => !r.with.some(n => hide.includes(n));
  const wiki = resolve(name) || resolve(`${name} essence`);
  const spells = e.stoneSpells || {};
  const party = pcs();
  return `<div class="detail">
    <h2>${esc(e.name)}</h2>
    <div class="badges"><span class="rarity rarity-${esc(e.rarity)}">${esc(e.rarity)}</span> <span class="badge">${jumpAff(e.affinity)} affinity</span>
      ${dv ? `<span class="badge">granted by <a class="wikilink" data-target="${esc(dv.church)}">${esc(dv.called || dv.god)}</a></span>` : ''}
      ${wiki ? `<span class="badge"><a class="wikilink" data-id="${esc(wiki)}">Wiki page</a></span>` : ''}</div>
    ${e.theme ? `<p class="theme"><em>${esc(e.theme.replace(/\.$/, ''))}.</em></p>` : ''}
    ${e.description ? `<p>${esc(e.description)}</p>` : ''}
    ${dv?.look ? `<p>${esc(dv.look)}</p>` : ''}
    ${e.manifests ? `<p class="muted">Found where it manifests: ${esc(e.manifests)}.</p>` : ''}
    <h3>Powers</h3>
    <div class="powers">
      ${e.trait ? `<div class="power"><div><strong>${esc(e.trait.name || 'Proficiency')}</strong> <span class="muted">essence trait</span></div><div>${esc(e.trait.text)}</div></div>` : ''}
      ${dv ? `<div class="power"><div><strong>${esc(dv.sense.name)}</strong> <span class="muted">1 + Wisdom modifier per long rest</span></div><div>${esc(dv.sense.text)}</div></div>
        <div class="power"><div><strong>${esc(dv.channel.name)}</strong> <span class="muted">proficiency bonus per long rest</span></div><div>${esc(dv.channel.text)}</div></div>
        <div class="power"><div><strong>${esc(dv.aura.name)}</strong> <span class="muted">blessing from Bronze rank (level 5), twice per short rest from level 17</span></div><div>${esc(dv.aura.text)}</div></div>` : ''}
    </div>
    ${dv ? `<h3>What ${esc(dv.called || dv.god)} asks</h3><ul>${dv.demands.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
      <h3>What makes the god take it back</h3><ul>${dv.revoked.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
      <p class="hint">When the god takes it back, the slot counts as empty and every awakening stone ability on it is lost until it is restored.</p>` : ''}
    <h3>Awakening stone spells</h3>
    <table class="spells"><tbody>${[1, 2, 3, 4, 5].filter(l => spells[l]?.length).map(l => `<tr><th>Level ${l}</th><td>${spells[l].map(s => spellName(s)).join(', ')}</td></tr>`).join('')}</tbody></table>
    <p class="hint">Spell levels open up with rank: level 1 at Iron, 2 at Bronze, 3 at Silver, 4 at Gold, 5 at Diamond.</p>
    <h3>Confluences</h3>
    ${recipes.filter(okRecipe).length ? `<p><strong>Exact recipes.</strong> These always win over the affinity table.</p>
      <ul>${recipes.filter(okRecipe).map(r => `<li>with ${r.with.map(jumpEss).join(' and ')} → ${jumpConf(r.name)}</li>`).join('')}</ul>` : ''}
    <p><strong>By affinity.</strong> Any other two essences form a confluence by their affinities. With this ${esc(e.affinity)}-affinity essence, two more essences with these affinities form:</p>
    <div class="trio-grid">${trios.map(t => `<div>${t.with.map(esc).join(' + ')} → ${jumpConf(t.name)}</div>`).join('')}</div>
    <p class="hint">Where ${esc(e.affinity)} appears again, it means a different ${esc(e.affinity)}-affinity essence: no one can absorb the same essence twice.</p>
    <div class="give">
      ${party.length ? `<label class="field">${dv ? 'Granted to a party member' : 'Give to a party member'}<select id="give-to">${party.map(p => `<option value="${esc(p.id)}">${esc(p.meta.title)}</option>`).join('')}</select></label>
        <button class="btn primary" id="give-btn">${dv ? 'Grant it' : 'Add to what they carry'}</button>` : '<p class="hint">Add a party member to give them essences from here.</p>'}
    </div>
  </div>`;
}

function confluenceDetail(name) {
  const d = state.data;
  const c = G.confluenceCatalog(d, hiddenDivine()).find(x => x.name === name);
  if (!c) return '';
  const god = c.divine && (d.divine?.essences || []).find(e => e.god === c.god);
  return `<div class="detail">
    <h2>${esc(c.name)}</h2>
    <div class="badges">${c.divine ? `<span class="rarity rarity-divine">divine</span> <span class="badge">of <a class="wikilink" data-target="${esc(god?.church || c.god)}">${esc(god?.called || c.god)}</a></span>` : ''}
      ${c.trio ? `<span class="badge">${c.trio.map(jumpAff).join(' + ')} affinities</span>` : ''}</div>
    ${c.theme ? `<p class="theme"><em>${esc(c.theme.replace(/\.$/, ''))}.</em></p>` : ''}
    ${c.description ? `<p>${esc(c.description)}</p>` : ''}
    ${c.grant ? `<h3>Power</h3><div class="powers"><div class="power"><div><strong>${esc(c.grant.name || 'Proficiency')}</strong> <span class="muted">confluence</span></div><div>${esc(c.grant.text)}</div></div></div>` : ''}
    <h3>How it forms</h3>
    ${c.divine ? `<p>Only from one of these exact recipes. Any other trio with a divine essence forms by affinity instead.</p>` : c.trio ? `<p>From ${esc(G.trioText(c.trio))}, unless an exact recipe says otherwise.</p>${new Set(c.trio).size < c.trio.length ? '<p class="hint">No one can absorb the same essence twice, so a repeated affinity means different essences that share it, such as Fire and Smoke for Fire.</p>' : ''}` : ''}
    ${c.recipes.length ? `<ul>${c.recipes.map(r => `<li>${r.map(jumpEss).join(' + ')}</li>`).join('')}</ul>` : ''}
  </div>`;
}

/** Give an essence to a party member: a divine essence is granted straight into a slot, any other is carried until absorbed. */
async function giveEssence(name, id) {
  const p = state.pages.get(id);
  if (!p) return;
  const m = p.meta;
  if (G.essenceInfo(state.data, name)?.kind === 'divine') {
    const ess = [].concat(m.essences || []);
    if (ess.some(e => e.toLowerCase() === name.toLowerCase())) return toast(`${m.title} already has ${name}.`, true);
    const slot = [0, 1, 2].find(i => !ess[i]);
    if (slot === undefined) return toast(`${m.title}'s three essence slots are full.`, true);
    ess[slot] = name;
    m.essences = ess.map(x => x || '');
    await attempt(() => api.pages.write(id, m, p.body));
    return toast(`The god grants ${name} to ${m.title}, in slot ${slot + 1}`);
  }
  G.carryEssence(m, name);
  await attempt(() => api.pages.write(id, m, p.body));
  toast(`${m.title} is now carrying ${name}. It needs the absorption ritual before it fills a slot.`);
}

// ---------- items browser ----------

function renderItems() {
  const v = state.view;
  const d = state.data;
  if (!d.items) { $('#view').innerHTML = '<div class="page empty">The item catalogue is missing. Reset "items" under Generator lists to get it back.</div>'; return; }
  const all = G.itemCatalog(d);
  const places = visiblePages().filter(p => p.meta.type === 'location').map(p => [p.meta.title, G.settlementFor(d, p.meta.title, p.meta)]).filter(([, x]) => x).sort((x, y) => x[0].localeCompare(y[0]));
  const whereOpts = `<option value="">Sold anywhere or not</option>
    <optgroup label="Sold in the shops of">${G.SETTLEMENTS.map(s => `<option value="${esc(s)}">${esc(cap(G.settlementPlural(d, s)))}</option>`).join('')}</optgroup>
    ${places.length ? `<optgroup label="Sold in">${places.map(([p, s]) => `<option value="${esc(s)}" data-place="${esc(p)}">${esc(p)} (${esc((G.settlementInfo(d, s)?.label || s).toLowerCase())})</option>`).join('')}</optgroup>` : ''}
    <option value="auction">At auction</option><option value="none">Not sold</option>`;
  $('#view').innerHTML = `<div class="wide browser">
    <h1 style="margin:0 0 8px;font:600 32px var(--serif)">Items</h1>
    <p class="hint" style="margin:0 0 10px">Equipment, magic items, gems and the world's own goods, with prices. Small places sell everyday goods; rarer magic is found only in cities, and the rarest only at auction. Magic prices are also shown in spirit coins (1 iron = 1 gp, 1 bronze = 100 gp, 1 silver = 10,000 gp).</p>
    <div class="filters">
      <input id="item-q" type="search" placeholder="Search names, descriptions or tags" value="${esc(v.q || '')}">
      <select id="item-cat"><option value="">Any category</option>${G.itemCategories(d).map(c => `<option ${c === v.cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
      <select id="item-rar"><option value="">Any rarity</option>${G.ITEM_RARITIES.map(r => `<option value="${r}" ${r === v.rarity ? 'selected' : ''}>${cap(r)}</option>`).join('')}</select>
      <select id="item-where">${whereOpts}</select>
      <select id="item-src"><option value="">All sources</option><option value="srd" ${v.source === 'srd' ? 'selected' : ''}>D&amp;D</option><option value="world" ${v.source === 'world' ? 'selected' : ''}>This world</option></select>
      <span class="muted" id="item-count"></span>
    </div>
    <div class="browser-body"><div class="browser-list" id="item-list"></div><div class="browser-detail" id="item-detail"></div></div>
  </div>`;
  const whereSel = $('#item-where');
  const opt = [...whereSel.options].find(o => o.value === (v.where || '') && (o.dataset.place || '') === (v.place || ''));
  if (opt) opt.selected = true;
  const drawList = () => {
    const shown = G.filterItems(d, all, { q: v.q, cat: v.cat, rarity: v.rarity, where: v.where, source: v.source });
    $('#item-count').textContent = `${shown.length} of ${all.length}`;
    $('#item-list').innerHTML = shown.length ? shown.map(x => `<button class="ess-item item-row${x.name === v.sel ? ' active' : ''}" data-sel="${esc(x.name)}">
        <span class="ess-name">${esc(x.name)}</span><span class="item-price">${esc(x.price == null ? '—' : x.rarity && x.rarity !== 'mundane' ? G.formatSpirit(x.price) : G.formatGp(x.price))}</span>
        <span class="muted">${esc(x.cat)}${x.rarity && x.rarity !== 'mundane' ? ` · <span class="rarity-${esc(x.rarity.replace(' ', '-'))}">${esc(x.rarity)}</span>` : ''}</span></button>`).join('')
      : '<p class="hint">Nothing matches. Clear the search or a filter.</p>';
    if (!v.sel || !shown.some(x => x.name === v.sel)) v.sel = shown[0]?.name;
    $$('#item-list .ess-item').forEach(b => b.classList.toggle('active', b.dataset.sel === v.sel));
    drawDetail();
  };
  const drawDetail = () => {
    const el = $('#item-detail');
    el.innerHTML = v.sel ? itemDetail(v.sel) : '';
    el.scrollTop = 0;
    const give = $('#item-give', el);
    if (give) give.onclick = () => giveItem(v.sel, $('#give-to', el).value, false);
    const buy = $('#item-buy', el);
    if (buy) buy.onclick = () => giveItem(v.sel, $('#give-to', el).value, true);
  };
  $('#item-list').addEventListener('click', e => {
    const b = e.target.closest('[data-sel]');
    if (!b) return;
    v.sel = b.dataset.sel;
    $$('#item-list .ess-item').forEach(x => x.classList.toggle('active', x.dataset.sel === v.sel));
    drawDetail();
  });
  let t;
  $('#item-q').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => { v.q = e.target.value; drawList(); }, 150); });
  $('#item-cat').onchange = e => { v.cat = e.target.value; drawList(); };
  $('#item-rar').onchange = e => { v.rarity = e.target.value; drawList(); };
  $('#item-src').onchange = e => { v.source = e.target.value; drawList(); };
  whereSel.onchange = e => { const o = e.target.selectedOptions[0]; v.where = o.value; v.place = o.dataset.place || ''; drawList(); };
  drawList();
  const active = $('#item-list .ess-item.active');
  if (active) active.scrollIntoView({ block: 'nearest' });
}

function itemDetail(name) {
  const d = state.data;
  const i = G.itemInfo(d, name);
  if (!i) return '';
  const wiki = resolve(i.name);
  const magic = i.rarity && i.rarity !== 'mundane';
  const party = pcs();
  const rows = [
    ['Price', esc(G.itemPriceText(i))],
    i.weight != null && ['Weight', `${esc(String(i.weight))} lb`],
    i.kind && ['Type', esc(i.kind)],
    ['Where to find it', esc(G.itemWhereText(d, i))],
  ].filter(Boolean);
  return `<div class="detail">
    <h2>${esc(i.name)}</h2>
    <div class="badges"><span class="badge">${esc(i.cat)}</span>
      ${magic ? `<span class="rarity rarity-${esc(i.rarity.replace(' ', '-'))}">${esc(i.rarity)}</span>` : ''}
      ${i.attune ? '<span class="badge">needs attunement</span>' : ''}
      ${i.consumable ? '<span class="badge">used up</span>' : ''}
      ${i.rank ? `<span class="badge rank rank-${esc(i.rank)}">${esc(i.rank)}</span>` : ''}
      ${wiki ? `<span class="badge"><a class="wikilink" data-id="${esc(wiki)}">Wiki page</a></span>` : ''}</div>
    <p>${esc(i.desc)}</p>
    <table class="spells"><tbody>${rows.map(([k, val]) => `<tr><th>${k}</th><td>${val}</td></tr>`).join('')}</tbody></table>
    ${(i.tags || []).length ? `<p class="muted">${i.tags.map(t => `#${esc(t)}`).join(' ')}</p>` : ''}
    <div class="give">
      ${party.length ? `<label class="field">Party member<select id="give-to">${party.map(p => `<option value="${esc(p.id)}">${esc(p.meta.title)}</option>`).join('')}</select></label>
        <button class="btn" id="item-give" title="Add it to their inventory for free: found, looted or a gift">Give</button>
        ${i.price != null ? `<button class="btn primary" id="item-buy" title="Pay the list price: from their own coins if they have enough, else the party purse">Buy for ${esc(magic ? G.formatSpirit(i.price) : G.formatGp(i.price))}</button>` : ''}` : '<p class="hint">Add a party member to give or sell them items from here.</p>'}
    </div>
  </div>`;
}

/** Give a catalogue item to a party member, or sell it to them at its list price. */
async function giveItem(name, id, pay) {
  const p = state.pages.get(id);
  const item = G.itemInfo(state.data, name);
  if (!p || !item) return;
  const meta = p.meta;
  const price = G.floorPrice(item.price);
  const from = pay ? payDefault(id, price) : null;
  if (pay && !(await payFrom(from, price, item.name))) return;
  const body = G.addToInventory(p.body, item.name);
  await attempt(async () => {
    await api.pages.write(p.id, meta, body);
    p.body = body;
    toast(pay ? `${meta.title} bought the ${item.name} for ${G.itemPriceText(item).replace(/ \(.*/, '')}, from ${payerName(from)}.` : `${item.name} added to ${meta.title}'s inventory.`);
  });
}

// ---------- spells and bestiary ----------

const SRD_CREDIT = 'Spells marked SRD 5.2 include material from the System Reference Document 5.2, and monsters marked SRD from the System Reference Document 5.1, by Wizards of the Coast LLC, licensed under CC BY 4.0. Other spells are summarised in our own words.';
const SPELL_BOOKS = { PHB: "Player's Handbook", XGE: "Xanathar's Guide to Everything", TCE: "Tasha's Cauldron of Everything", SCAG: "Sword Coast Adventurer's Guide", EEPC: "Elemental Evil Player's Companion" };

const spellLink = (key, label) => `<a class="spell-link" data-spell="${esc(key)}">${esc(label)}</a>`;
/** A spell name as a link to its card when the spell list knows it, else in italics. */
const spellName = (name, label = name) => { const s = G.spellInfo(state.data, name); return s ? spellLink(s.key, label) : `<em>${esc(label)}</em>`; };

/** Rules text: paragraphs, lists and tables, with nothing from the text treated as HTML. */
const rulesText = text => marked.parse(esc(text || ''), { gfm: true, breaks: false });

function spellCard(s) {
  const d = state.data;
  const duration = s.concentration && !/concentration/i.test(s.duration || '') ? `Concentration, ${s.duration}` : s.duration;
  const rows = [
    ['Casting time', esc(s.time)], ['Range', esc(s.range)],
    s.components && ['Components', esc(s.components) + (s.material ? ` <span class="muted">(${esc(s.material)})</span>` : '')],
    ['Duration', esc(duration)],
    (s.classes || []).length && ['Classes', esc(s.classes.join(', '))],
  ].filter(x => x && x[1]);
  const stones = G.stoneCatalog(d, hiddenDivine()).filter(x => G.spellInfo(d, x.spell)?.key === s.key);
  const full = /^SRD/.test(s.source || '');
  return `<h2>${esc(s.name)}</h2>
    <div class="badges"><span class="badge">${esc(G.spellKindText(s))}</span>${s.concentration ? '<span class="badge">concentration</span>' : ''}
      <span class="badge" title="${full ? `Full rules text from the free D&D rules (${s.source === 'SRD 5.2' ? 'SRD 5.2, the 2024 rules' : 'SRD 5.1, the 2014 rules'})` : 'Summary in our own words'}">${full ? esc(s.source) : esc(SPELL_BOOKS[s.source] ? `summary · ${s.source}` : 'summary')}</span></div>
    <table class="spells"><tbody>${rows.map(([k, val]) => `<tr><th>${k}</th><td>${val}</td></tr>`).join('')}</tbody></table>
    <div class="rules">${s.text ? rulesText(s.text) : `<p>${esc(s.summary || 'No description yet. Add one to the spells list.')}</p>`}
      ${s.higher ? `<p><b><i>At higher levels.</i></b> ${esc(s.higher).replace(/^at higher levels\.\s*/i, '')}</p>` : ''}</div>
    ${!full && SPELL_BOOKS[s.source] ? `<p class="hint">This is a summary. The full text is in the ${esc(SPELL_BOOKS[s.source])}.</p>` : ''}
    ${stones.length ? `<p class="muted">As an awakening stone: ${stones.slice(0, 12).map(x => `<a class="jump" data-jump="stones" data-name="${esc(x.id)}">${esc(x.divine || x.affinity)}</a>`).join(', ')}${stones.length > 12 ? ` and ${stones.length - 12} more` : ''} (level ${stones[0].level}, ${esc(stones[0].rank)}).</p>` : ''}`;
}

/** The spell card in a popup, so a stat card or page stays where it is. */
function showSpell(key) {
  const s = G.spellInfo(state.data, key);
  if (!s) return toast(`"${key}" isn't on the spell list.`, true);
  let dlg = $('#spell-pop');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'spell-pop';
    document.body.appendChild(dlg);
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  }
  dlg.innerHTML = `<div class="detail">${spellCard(s)}</div>
    <div class="actions"><button class="btn" id="spell-open">Open in Spells</button><button class="btn primary" id="spell-close">Close</button></div>`;
  $('#spell-close', dlg).onclick = () => dlg.close();
  $('#spell-open', dlg).onclick = () => { dlg.close(); go({ kind: 'spells', sel: s.key }); };
  $$('a.jump', dlg).forEach(a => a.addEventListener('click', () => dlg.close()));
  if (!dlg.open) dlg.showModal();
  dlg.scrollTop = 0;
}

function chipRow(v, key, label, options) {
  return `<div class="chip-row"><span class="chip-label">${esc(label)}</span>${options.map(([val, text]) => `<button class="chip${v[key].includes(val) ? ' on' : ''}" data-chip="${key}" data-val="${esc(val)}">${esc(text)}</button>`).join('')}</div>`;
}

/** A searchable list on the left and the picked entry on the right, with chip filters. */
function browser({ title, intro, placeholder, chipRows, count, list, detail, keys, footer = '', after = () => {} }) {
  const v = state.view;
  for (const k of keys) v[k] ||= [];
  $('#view').innerHTML = `<div class="wide browser">
    <h1 style="margin:0 0 8px;font:600 32px var(--serif)">${esc(title)}</h1>
    ${intro ? `<p class="hint" style="margin:0 0 10px">${intro}</p>` : ''}
    <div class="filters"><input id="br-q" type="search" placeholder="${esc(placeholder)}" value="${esc(v.q || '')}">
      <button class="btn small" id="br-clear">Clear filters</button><span class="muted" id="br-count"></span></div>
    ${chipRows()}
    <div class="browser-body"><div class="browser-list" id="br-list"></div><div class="browser-detail" id="br-detail"></div></div>
    ${footer ? `<p class="hint credit">${esc(footer)}</p>` : ''}
  </div>`;
  const drawDetail = () => { const el = $('#br-detail'); el.innerHTML = v.sel ? detail(v.sel) : ''; el.scrollTop = 0; after(el); };
  const drawList = () => {
    const { shown, total } = list();
    $('#br-count').textContent = `${shown.length} of ${total}`;
    $('#br-list').innerHTML = shown.length ? shown.map(x => x.html).join('') : '<p class="hint">Nothing matches. Clear the search or a filter.</p>';
    if (!v.sel || !shown.some(x => x.key === v.sel)) v.sel = shown[0]?.key;
    $$('#br-list .ess-item').forEach(b => b.classList.toggle('active', b.dataset.sel === v.sel));
    drawDetail();
  };
  $('#br-list').addEventListener('click', e => {
    const b = e.target.closest('[data-sel]');
    if (!b) return;
    v.sel = b.dataset.sel;
    $$('#br-list .ess-item').forEach(x => x.classList.toggle('active', x.dataset.sel === v.sel));
    drawDetail();
  });
  let t;
  $('#br-q').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => { v.q = e.target.value; drawList(); }, 150); });
  $$('[data-chip]').forEach(b => b.onclick = () => {
    const l = v[b.dataset.chip];
    const i = l.indexOf(b.dataset.val);
    if (i < 0) l.push(b.dataset.val); else l.splice(i, 1);
    b.classList.toggle('on', i < 0);
    drawList();
  });
  $('#br-clear').onclick = () => { for (const k of keys) v[k] = []; v.q = ''; render(); };
  drawList();
  $('#br-list .ess-item.active')?.scrollIntoView({ block: 'nearest' });
}

function renderSpells() {
  const d = state.data;
  const v = state.view;
  if (!d.spells?.spells) { $('#view').innerHTML = '<div class="page empty">The spell list is missing. Reset "spells" under Generator lists to get it back.</div>'; return; }
  const all = G.spellCatalog(d);
  const classes = G.spellClasses(all);
  browser({
    title: 'Spells', keys: ['levels', 'schools', 'classes', 'flags'],
    placeholder: 'Search names or what a spell does',
    intro: 'Every spell in the game. Click a spell anywhere in the app, on a stat card, an awakening stone or a page link like <code>[[Fireball]]</code>, to see its card.',
    chipRows: () => chipRow(v, 'levels', 'Level', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(l => [String(l), l ? String(l) : 'Cantrip']))
      + chipRow(v, 'schools', 'School', G.SPELL_SCHOOLS.map(s => [s, cap(s)]))
      + chipRow(v, 'classes', 'Class', classes.map(c => [c, c]))
      + chipRow(v, 'flags', 'Only', [['concentration', 'Concentration'], ['ritual', 'Ritual'], ['srd', 'Full rules text']]),
    list: () => {
      const shown = G.filterSpells(all, { q: v.q, levels: v.levels, schools: v.schools, classes: v.classes, flags: v.flags });
      return { total: all.length, shown: shown.map(s => ({ key: s.key, html: `<button class="ess-item${s.key === v.sel ? ' active' : ''}" data-sel="${esc(s.key)}">
        <span class="ess-name">${esc(s.name)}</span><span class="item-price">${esc(Number(s.level) ? `level ${s.level}` : 'cantrip')}</span>
        <span class="muted">${esc(cap(s.school || ''))}${s.concentration ? ' · concentration' : ''}${s.ritual ? ' · ritual' : ''}</span></button>` })) };
    },
    detail: key => { const s = G.spellInfo(d, key); return s ? `<div class="detail">${spellCard(s)}</div>` : ''; },
    footer: SRD_CREDIT,
  });
}

/** Rules text of a stat block entry: attack rolls in italics, and a caster's spells linked to their cards. */
function statText(text, spells = []) {
  let h = esc(text).replace(/^(Melee or Ranged|Melee|Ranged) (Weapon|Spell) Attack:/, '<em>$&</em>').replace(/ Hit:/g, ' <em>Hit:</em>');
  const names = new Map();
  for (const k of spells) {
    const s = G.spellInfo(state.data, k);
    if (!s) continue;
    for (const n of [k, s.name, ...(s.aliases || [])]) names.set(esc(n).toLowerCase(), s.key);
  }
  if (names.size) {
    const re = new RegExp(`\\b(${[...names.keys()].sort((a, b) => b.length - a.length).map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'gi');
    h = h.replace(re, m => `<a class="spell-link" data-spell="${esc(names.get(m.toLowerCase()) || m)}">${m}</a>`);
  }
  // Attack bonuses and damage dice roll when clicked.
  h = h.replace(/([+-])(\d+) to hit/g, (m, sign, n) => `<a class="roll" data-roll="1d20 ${sign} ${n}" data-label="To hit">${m}</a>`)
    .replace(/\((\d+d\d+(?: [+-] \d+)?)\)/g, (m, dice) => `(<a class="roll" data-roll="${dice}" data-label="Damage">${dice}</a>)`);
  return h.split(/\n+/).map(l => l.startsWith('- ') ? `<div class="sb-line">${l.slice(2)}</div>` : `<p>${l}</p>`).join('');
}

/** A monster's full stat block, with its Pallimustus rank. */
/** opts.actionsFirst (the battle screen): actions and spells come before traits and powers, so they show without scrolling. */
function statBlock(m, who = m.name, { actionsFirst = false, link = null, riding = false } = {}) {
  const rank = m.rank || G.rankForCR(Number(m.cr) || 0);
  const line = (k, val) => val ? `<div><b>${k}</b> ${esc(val)}</div>` : '';
  // An entry that attacks or deals damage gets a button that rolls all of it at once.
  const rollBtn = (a, section) => {
    const atk = G.attackOf(a.desc);
    return atk ? ` <button class="roll-btn" data-attack="${esc(JSON.stringify({ ...atk, name: a.name, section }))}" title="Roll ${atk.toHit != null ? 'to hit and ' : ''}damage">⚄ Roll</button>` : '';
  };
  const isSpells = t => /spell|cantrip|awakening stone/i.test(t.name);
  // Spellcasting lists its combat spells with a roll each, so a caster's spells roll like its attacks.
  const spellRolls = a => isSpells(a) && a.spells?.length ? monsterSpellLines({ ...a, abilities: m.abilities, level: a.level || m.level }, who) : '';
  // A charge (Trampling Charge, Pounce) rolls its attack with the extra damage and the save against being knocked prone.
  const charges = SU.chargesOf(m);
  const chargeBtn = a => {
    const ch = charges.find(x => x.trait === a.name);
    const act = ch && (m.actions || []).find(x => x.name === ch.action);
    const atk = act && G.attackOf(act.desc);
    if (!atk) return '';
    const json = { ...atk, damage: [...atk.damage, ...(ch.extra ? [{ expr: ch.extra.expr, type: ch.extra.type || atk.damage[0]?.type || '' }] : [])], save: ch.save || atk.save, name: `${ch.action} (${ch.trait})`, section: '' };
    return ` <button class="roll-btn" data-attack="${esc(JSON.stringify(json))}" title="${esc(`After a run of at least ${ch.distance} ft.: roll ${ch.action} with the charge's extra damage${ch.save ? ` and the DC ${ch.save.dc} ${ch.save.ability} save${ch.prone ? ' against being knocked prone' : ''}` : ''}`)}">⚄ Charge</button>`;
  };
  // While it rides, what needs its own legs (a run-up, a leap, climbing) is greyed out.
  const off = a => riding && SU.needsOwnLegs(a);
  const entries = (list = [], section = '') => list.map(a => `<div class="sb-entry${off(a) ? ' sb-off' : ''}"><b><i>${esc(a.name)}.</i></b>${off(a) ? ' <span class="badge" title="It moves on its mount, so it can\'t use this">not while riding</span>' : `${rollBtn(a, section)}${chargeBtn(a)}`} ${statText(a.desc, a.spells)}${spellRolls(a)}</div>`).join('');
  const abil = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
  const wiki = resolve(m.name);
  const spellTraits = (m.traits || []).filter(isSpells), otherTraits = (m.traits || []).filter(t => !isSpells(t));
  return `<div class="mstat" data-who="${esc(who)}">
    <h2>${link ? `<a class="monster-link" data-monster="${esc(link)}" title="Open it in the Bestiary">${esc(m.name)}</a>` : esc(m.name)}</h2>
    <p class="sb-sub">${linkClassText(esc([m.size, m.type].filter(Boolean).join(' ')))}${m.alignment ? `, ${esc(m.alignment)}` : ''}</p>
    <div class="badges"><span class="badge rank rank-${esc(rank)}">${esc(rank)} rank</span><span class="badge">CR ${esc(G.crLabel(Number(m.cr)))}</span>
      ${m.variantOf ? `<span class="badge" title="A lower-rank creature that spawned with more magic in it">${esc(m.variantOf)} at ${esc(rank)} rank</span>` : m.summoned ? '<span class="badge">summoned</span>' : m.custom ? '<span class="badge">custom</span>' : m.source === 'SRD' ? '<span class="badge">SRD</span>' : ''}
      ${wiki ? `<span class="badge"><a class="wikilink" data-id="${esc(wiki)}">Wiki page</a></span>` : ''}</div>
    <div class="sb-rule"></div>
    ${line('Armor Class', m.ac)}${line('Hit Points', m.hp != null ? `${m.hp}${m.hitDice ? ` (${String(m.hitDice).replace(/([+-])/g, ' $1 ')})` : ''}` : '')}${line('Speed', m.speed)}
    <div class="sb-rule"></div>
    <table class="sb-abil"><tr>${abil.map(a => `<th>${a}</th>`).join('')}</tr>
      <tr>${(m.abilities || []).map(x => `<td>${x} (${G.abilityMod(x)})</td>`).join('')}</tr></table>
    <div class="sb-rule"></div>
    ${line('Saving Throws', m.saves)}${line('Skills', m.skills)}${line('Damage Vulnerabilities', m.vulnerable)}${line('Damage Resistances', m.resist)}
    ${line('Damage Immunities', m.immune)}${line('Condition Immunities', m.conditionImmune)}${line('Rank', G.rankWardText(rank, m.vulnerable))}${line('Senses', m.senses)}${line('Languages', m.languages)}
    ${line('Challenge', m.summoned ? '' : `${G.crLabel(Number(m.cr))} (${Number(m.xp ?? G.CR_XP[m.cr] ?? 0).toLocaleString()} XP)`)}
    ${!actionsFirst && (m.traits || []).length ? `<div class="sb-rule"></div>${entries(m.traits)}` : ''}
    ${(m.actions || []).length ? `<h3>Actions</h3>${entries(m.actions)}` : ''}
    ${actionsFirst && spellTraits.length ? `<h3>Spells</h3>${entries(spellTraits)}` : ''}
    ${(m.reactions || []).length ? `<h3>Reactions</h3>${entries(m.reactions)}` : ''}
    ${(m.legendary || []).length ? `<h3>Legendary Actions</h3>${m.legendaryIntro ? `<p>${esc(m.legendaryIntro)}</p>` : ''}${entries(m.legendary, 'legendary')}` : ''}
    ${actionsFirst && otherTraits.length ? `<h3>Traits and Powers</h3>${entries(otherTraits)}` : ''}
    ${m.desc ? `<div class="sb-lore">${rulesText(m.desc)}</div>` : ''}
  </div>`;
}

/** A stat card for each monster in a generated encounter; the first starts open. */
function encounterCards(r, heading = 'Stat cards', origin = null) {
  if (!r.groups?.length) return '';
  state.lastCards = r.groups;
  state.lastOrigin = origin;
  return `<div class="enc-cards"><div class="row"><h3 style="flex:1">${esc(heading)}</h3><button class="btn small" data-battle-groups title="Put every monster here on the battle screen">⚔ Add to battle</button></div>${r.groups.map((g, i) => {
    const m = g.variant || G.monsterInfo(state.data, g.name);
    return `<details class="sb-card"${i === 0 ? ' open' : ''}><summary><b>${g.count} × ${esc(g.name)}</b> <span class="muted">CR ${esc(G.crLabel(g.cr))} · ${esc(g.rank)}${m ? ` · AC ${esc(String(m.ac).split(' ')[0])} · HP ${esc(String(m.hp))}` : ''}</span></summary>
      ${m ? statBlock(m) : `<p class="hint">No stat block for ${esc(g.name)} in the bestiary yet. Add one to the <code>bestiary</code> list under Generator lists.</p>`}</details>`;
  }).join('')}</div>`;
}

function renderBestiary() {
  const d = state.data;
  const v = state.view;
  if (!d.bestiary?.monsters) { $('#view').innerHTML = '<div class="page empty">The bestiary is missing. Reset "bestiary" under Generator lists to get it back.</div>'; return; }
  const all = G.bestiaryCatalog(d);
  const onList = new Set((d.monsters?.monsters || []).map(m => m.name.toLowerCase()));
  const detail = key => {
    const m = G.monsterInfo(d, key);
    if (!m) return '';
    // Any monster can spawn with more magic in it, at a higher rank: preview it with that rank's numbers.
    const own = G.rankForCR(Number(m.cr) || 0);
    const higher = ['Bronze', 'Silver', 'Gold', 'Diamond'].filter(r => G.RANK_CR[r][0] > (Number(m.cr) || 0) && r !== own);
    const sp = v.spawn?.key === key ? v.spawn : null;
    const shown = sp ? G.rankUp(d, m.name, Math.min(G.RANK_CR[sp.rank][1], G.RANK_CR[sp.rank][0] + 1), G.makeRng(sp.seed)) : m;
    return `<div class="detail">${higher.length ? `<div class="spawn-row"><span class="muted">Spawned at a higher rank:</span>
      <button class="chip${sp ? '' : ' on'}" data-spawn="">${esc(own)} (as written)</button>
      ${higher.map(r => `<button class="chip${sp?.rank === r ? ' on' : ''}" data-spawn="${r}">${r}</button>`).join('')}
      ${sp ? '<button class="chip" data-spawn-look title="Another name, look and quirk">↻ New look</button>' : ''}</div>` : ''}${(state.bestiaryShown = shown, '')}<div class="row" style="justify-content:flex-end;margin-bottom:6px"><button class="btn small" data-battle-monster title="Put this monster on the battle screen">⚔ Add to battle</button></div>${m.appearance ? `<div class="monster-look"><b>What it looks like</b> <span class="muted">(read aloud)</span><p>${esc(m.appearance)}</p></div>` : ''}${statBlock(shown)}</div>`;
  };
  const after = el => {
    const redraw = () => { el.innerHTML = detail(v.sel); after(el); };
    $$('[data-spawn]', el).forEach(b => b.onclick = () => { v.spawn = b.dataset.spawn ? { key: v.sel, rank: b.dataset.spawn, seed: Date.now() % 100000 } : null; redraw(); });
    const look = $('[data-spawn-look]', el);
    if (look) look.onclick = () => { v.spawn = { ...v.spawn, seed: v.spawn.seed + 1 }; redraw(); };
  };
  browser({
    title: 'Bestiary', keys: ['ranks', 'types'],
    placeholder: 'Search names, types, traits or attacks',
    intro: `Full stat blocks, with each monster's rank in this world. Monsters marked ⚔ are on the encounter list the Encounter generator draws from. Click a spell in a stat block to see it.`,
    chipRows: () => chipRow(v, 'ranks', 'Rank', ['Iron', 'Bronze', 'Silver', 'Gold', 'Diamond'].map(r => [r, r]))
      + chipRow(v, 'types', 'Type', G.monsterTypes(all).map(t => [t, cap(t)])),
    list: () => {
      const shown = G.filterMonsters(all, { q: v.q, ranks: v.ranks, types: v.types });
      return { total: all.length, shown: shown.map(m => ({ key: m.key, html: `<button class="ess-item${m.key === v.sel ? ' active' : ''}" data-sel="${esc(m.key)}">
        <span class="ess-name">${esc(m.name)}${onList.has(m.key) ? ' <span class="muted" title="On the encounter list">⚔</span>' : ''}</span><span class="item-price">CR ${esc(G.crLabel(Number(m.cr)))}</span>
        <span class="muted">${esc(cap(G.monsterType(m)))} · ${esc(m.rank)}</span></button>` })) };
    },
    detail, after,
    footer: SRD_CREDIT,
  });
}

// ---------- world map ----------
// Earth's coastlines (worldmap.js) with your wiki on top: a page with a `map: [longitude, latitude]` is a pin,
// and one with a `border` (a list of points) is a realm drawn on the map. In DM mode, place pages, drag pins and draw borders.

const mapXY = ([lon, lat]) => [(lon + 180) * WORLD.k, (WORLD.top - lat) * WORLD.k];
const mapLL = ([x, y]) => [Math.round((x / WORLD.k - 180) * 100) / 100, Math.round((WORLD.top - y / WORLD.k) * 100) / 100];
const isPoint = v => Array.isArray(v) && v.length === 2 && v.every(n => Number.isFinite(Number(n)));
const mapPoint = p => isPoint(p.meta.map) ? p.meta.map.map(Number) : null;
const mapBorder = p => Array.isArray(p.meta.border) ? p.meta.border.filter(isPoint).map(q => q.map(Number)) : [];
const REALM_HUES = [8, 32, 52, 95, 140, 175, 200, 225, 262, 290, 320, 345];
function realmColor(p) {
  if (/^#[0-9a-f]{3,8}$/i.test(String(p.meta.color || ''))) return p.meta.color;
  let h = 0;
  for (const c of p.meta.title) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `hsl(${REALM_HUES[h % REALM_HUES.length]} 55% 50%)`;
}
/** How a place shows on the map, from its tags: capital, city, town, village, wild land or a site. */
/** Whether the World map hides generated places (remembered on this computer). */
const mapHideGen = () => { try { return localStorage.getItem('map-hide-generated') === '1'; } catch { return false; } };

function pinKind(p) {
  const t = [].concat(p.meta.tags || []).map(x => String(x).toLowerCase());
  if (p.meta.sea || t.includes('sea place')) return t.includes('major') ? 'sea-major' : 'sea';
  if (t.includes('capital')) return 'capital';
  if (t.some(x => ['city', 'great city'].includes(x)) || p.meta.settlement === 'city' || p.meta.settlement === 'great city') return 'city';
  if (t.includes('town') || p.meta.settlement === 'town') return 'town';
  if (t.includes('village') || p.meta.settlement === 'village') return 'village';
  if (t.some(x => ['wilderness', 'region', 'forest', 'mountains', 'desert', 'sea'].includes(x))) return 'wild';
  return 'site';
}
// Small places only show their names once you zoom in (map units across the view).
const LABEL_ZOOM = { capital: Infinity, city: Infinity, town: 300, village: 110, wild: 110, site: 110, 'sea-major': 300, sea: 110 };

function mapPages() {
  return visiblePages().filter(p => p.id !== 'home' && (mapPoint(p) || mapBorder(p).length >= 3));
}

function centroid(pts) {
  const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

const isSettlement = p => ['capital', 'city', 'town', 'village'].includes(pinKind(p));
/** What a place is, for the places list: a realm, a landmark, or its pin kind. */
function placeKind(p) {
  if (mapBorder(p).length >= 3 && !isSettlement(p)) return 'Realm';
  if ([].concat(p.meta.tags || []).map(t => String(t).toLowerCase()).includes('landmark')) return 'Landmark';
  return { capital: 'Capital', city: 'City', town: 'Town', village: 'Village', wild: 'Wild land', site: 'Site', 'sea-major': 'Sea landmark', sea: 'Sea place' }[pinKind(p)];
}
/** Which realm a place is in, for the places list: the realm above it, the realm whose border it sits inside, or its wider region. */
function placeRegion(p) {
  for (let q = p.meta.parent && state.pages.get(resolve(p.meta.parent)), i = 0; q && i < 8; q = q.meta.parent ? state.pages.get(resolve(q.meta.parent)) : null, i++) if (placeKind(q) === 'Realm') return q.meta.title;
  const at = mapPoint(p) || mapLL(centroid(mapBorder(p).map(mapXY)));
  const [x, y] = mapXY(at);
  const inRealm = r => { const pts = mapBorder(r).map(mapXY); let c = false; for (let a = 0, b = pts.length - 1; a < pts.length; b = a++) if ((pts[a][1] > y) !== (pts[b][1] > y) && x < (pts[b][0] - pts[a][0]) * (y - pts[a][1]) / (pts[b][1] - pts[a][1]) + pts[a][0]) c = !c; return c; };
  const realm = mapPages().find(r => r !== p && placeKind(r) === 'Realm' && inRealm(r));
  if (realm) return realm.meta.title;
  const k = state.data.places && PL.styleFor(state.data, at, p.meta.nameStyle);
  return k && k !== 'common' ? cap(state.data.places.styles?.[k]?.label || k) : 'The wider world';
}
const PLACE_SORTS = { name: 'Name', kind: 'Kind', region: 'Region' };

/** The map as SVG markup; `scale` sizes pins and labels later. */
function worldSVG() {
  const W = WORLD.width, H = WORLD.height;
  const grid = [];
  for (let lon = -165; lon < 180; lon += 15) { const [x] = mapXY([lon, 0]); grid.push(`M${x},0V${H}`); }
  for (let lat = -60; lat <= WORLD.top; lat += 15) { const [, y] = mapXY([0, lat]); grid.push(`M0,${y}H${W}`); }
  const pages = mapPages();
  const realms = pages.filter(p => mapBorder(p).length >= 3);
  // Bigger places are drawn last, so their names sit on top.
  const order = ['sea', 'wild', 'site', 'sea-major', 'village', 'town', 'city', 'capital'];
  // A settlement with a border keeps its pin; a realm's point is where its name goes.
  const settlement = isSettlement;
  const pins = pages.filter(p => mapPoint(p) && (mapBorder(p).length < 3 || settlement(p))).sort((a, b) => order.indexOf(pinKind(a)) - order.indexOf(pinKind(b)));
  const known = new Set(state.saved?.circles || []);
  return `<svg id="world" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
    <rect class="sea" x="${-W}" y="${-H}" width="${W * 3}" height="${H * 3}"/>
    <path class="grid" d="${grid.join('')}"/>
    <path class="coast-glow" d="${WORLD.land}"/>
    <path class="land" d="${WORLD.land}"/>
    <path class="lake" d="${WORLD.lakes}"/>
    <path class="river" d="${WORLD.rivers}"/>
    <g class="realms">${realms.map(p => {
      const pts = mapBorder(p).map(mapXY);
      return `<path class="realm" data-id="${esc(p.id)}" style="--realm:${esc(realmColor(p))}" d="M${pts.map(q => q.map(n => n.toFixed(1)).join(',')).join('L')}Z"><title>${esc(p.meta.title)}</title></path>`;
    }).join('')}</g>
    <g class="realm-labels">${realms.filter(p => !settlement(p)).map(p => {
      const [x, y] = mapPoint(p) ? mapXY(mapPoint(p)) : centroid(mapBorder(p).map(mapXY));
      return `<g class="scaled realm-label" data-id="${esc(p.id)}" data-x="${x}" data-y="${y}"><text>${esc(p.meta.title.replace(/^The /, ''))}</text></g>`;
    }).join('')}</g>
    <g class="pins">${pins.map(p => {
      const [x, y] = mapXY(mapPoint(p));
      const kind = pinKind(p);
      const circle = hasCircle(p);
      const gen = (p.meta.tags || []).includes('generated') ? ' generated' : '';
      return `<g class="scaled pin pin-${kind}${gen}" data-id="${esc(p.id)}" data-x="${x}" data-y="${y}" data-kind="${kind}"><title>${esc(p.meta.title)}${circle ? ` (teleport circle${known.has(p.meta.title) ? ', address known' : ''})` : ''}</title>
        ${circle ? `<ellipse class="tc-ring${known.has(p.meta.title) ? ' known' : ''}" rx="10" ry="10"/>` : ''}
        ${kind === 'capital' ? '<rect x="-5" y="-5" width="10" height="10" transform="rotate(45)"/><circle r="2"/>' : kind === 'wild' ? '<path d="M-6,3L-2,-4L1,1L3,-2L7,3Z"/>' : kind === 'sea-major' ? SEA_STAR : '<circle/>'}
        <text x="8" y="4">${esc(p.meta.title)}</text></g>`;
    }).join('')}</g>
    ${problemSVG()}
    ${seaDraftSVG()}
    ${journeySVG()}
    ${partySVG()}
    <g class="route-plan"></g>
    <g class="draft"></g>
  </svg>`;
}

const ROUTE_COLORS = ['var(--good)', 'var(--warn)', 'var(--link)', 'hsl(320 60% 60%)', 'hsl(190 60% 50%)'];
/** Active regional problems as shaded circles (DM only). The map stretches east-west away from the equator. */
function problemSVG() {
  if (!state.saved) return '';
  const off = mapHiddenProblems();
  return `<g class="problems dm-tool">${activeProblems().map(x => {
    const b = problemBox(x);
    return `<ellipse class="problem${off.includes(x.id) ? ' off' : ''}" data-problem="${esc(x.id)}" style="--trouble:${problemColor(x)}" cx="${b.cx.toFixed(1)}" cy="${b.cy.toFixed(1)}" rx="${b.rx.toFixed(1)}" ry="${b.ry.toFixed(1)}"><title>${esc(x.name)} (${x.radius} miles around ${esc(x.origin)}): ${esc(x.summary)}</title></ellipse>`;
  }).join('')}</g>`;
}
const activeProblems = () => problems().filter(x => x.status !== 'solved' && x.centre);
/** A problem's circle in map units. */
function problemBox(x) {
  const [cx, cy] = mapXY(x.centre);
  const ry = x.radius / 69.1 * WORLD.k, rx = ry / Math.max(0.1, Math.cos(x.centre[1] * Math.PI / 180));
  return { cx, cy, rx, ry };
}
// Each problem keeps one colour, picked from its id, so it stays the same as others come and go.
const PROBLEM_COLORS = ['#e8735a', '#e0b44c', '#5fa8e8', '#b98ae8', '#6cc4a4', '#e88ab4'];
const problemColor = x => PROBLEM_COLORS[[...String(x.id)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % PROBLEM_COLORS.length];
/** Problems switched off on the map (this computer only). */
const mapHiddenProblems = () => { try { return JSON.parse(localStorage.getItem('map-hidden-problems') || '[]'); } catch { return []; } };
function setProblemShown(id, on) {
  const off = new Set(mapHiddenProblems());
  if (on) off.delete(id); else off.add(id);
  try { localStorage.setItem('map-hidden-problems', JSON.stringify([...off])); } catch {}
  $$(`#world .problem[data-problem="${CSS.escape(id)}"]`).forEach(el => el.classList.toggle('off', !on));
}
/** The legend in the map's corner: the troubles whose circles are in view, each with a switch. */
function problemLegend(vb) {
  const box = $('#map-legend');
  if (!box) return;
  const inView = activeProblems().filter(x => {
    const b = problemBox(x);
    return b.cx + b.rx > vb[0] && b.cx - b.rx < vb[0] + vb[2] && b.cy + b.ry > vb[1] && b.cy - b.ry < vb[1] + vb[3];
  });
  const key = inView.map(x => x.id).join();
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.hidden = !inView.length;
  const off = mapHiddenProblems();
  box.innerHTML = `<details open><summary>Troubles in view (${inView.length})</summary>
    ${inView.length > 1 ? '<div class="legend-all"><button class="mini-reroll" data-legend-all="1">All on</button> <button class="mini-reroll" data-legend-all="">All off</button></div>' : ''}
    ${inView.map(x => `<label class="legend-row" title="${esc(x.summary)}"><input type="checkbox" data-legend="${esc(x.id)}" ${off.includes(x.id) ? '' : 'checked'}>
      <span class="swatch" style="--trouble:${problemColor(x)}"></span><span>${esc(x.name)} <span class="muted">around ${esc(x.origin)}</span></span></label>`).join('')}</details>`;
  $$('[data-legend]', box).forEach(c => c.onchange = () => setProblemShown(c.dataset.legend, c.checked));
  $$('[data-legend-all]', box).forEach(b => b.onclick = () => {
    for (const c of $$('[data-legend]', box)) { c.checked = !!b.dataset.legendAll; setProblemShown(c.dataset.legend, c.checked); }
  });
}
/** Each journey keeps one colour, the same for its route on the map and its pin in the sidebar. */
const routeColor = j => ROUTE_COLORS[Math.max(0, journeys().indexOf(j)) % ROUTE_COLORS.length];
/** Every journey still on the road (and the open one, even once it has arrived): its route, and a marker for where the
 * party is along it (click it to open the journey). */
function journeySVG() {
  if (!state.saved) return '';
  const open = curJourney();
  return journeys().filter(j => j.from?.at && j.to?.at && (journeyActive(j) || j === open)).map(j => {
    const pts = routePts(j).map(mapXY);
    const [x, y] = mapXY(journeyAt(j, G.journeyDone(j)) || j.from.at);
    return `<g class="journey" style="--route:${routeColor(j)}"><path class="journey-line" d="M${pts.map(q => q.join(',')).join('L')}"/>
    <g class="scaled journey-party" data-journey="${esc(j.id)}" data-x="${x}" data-y="${y}"><title>${esc(G.journeyTitle(j))}: ${G.journeyDone(j)}${j.miles ? ` of ${j.miles}` : ''} miles, day ${j.days.length}. Click to open it.</title><circle r="6"/><text x="9" y="-15">${esc(G.journeyTitle(j).replace(/^Journey: /, ''))}</text></g></g>`;
  }).join('');
}

/** Size pins and labels for the current zoom: `perPx` map units to a screen pixel. */
function scaleMapMarks(svg, vb, perPx) {
  for (const g of svg.querySelectorAll('.scaled')) {
    g.setAttribute('transform', `translate(${g.dataset.x},${g.dataset.y}) scale(${perPx})`);
    const kind = g.dataset.kind;
    if (kind) g.classList.toggle('no-label', vb[2] > (LABEL_ZOOM[kind] ?? Infinity));
  }
  // A realm's name moves up out of the way of a city's pin and name under it, in screen pixels at this zoom.
  const pins = [...svg.querySelectorAll('.pin:not(.no-label)')].map(g => ({ x: Number(g.dataset.x), y: Number(g.dataset.y), w: (g.querySelector('text')?.textContent.length || 0) * 7 + 12 }));
  const placed = [];
  for (const g of svg.querySelectorAll('.realm-label')) {
    const t = g.querySelector('text'), x = Number(g.dataset.x), y = Number(g.dataset.y), half = (t?.textContent.length || 0) * 6.5;
    let dy = 0;
    // Other realms' names count too, once placed.
    const hits = d => pins.some(p => { const px = (p.x - x) / perPx, py = (p.y - y) / perPx - d; return py > -22 && py < 14 && px + p.w > -half && px - 8 < half; })
      || placed.some(q => Math.abs((q.x - x) / perPx) < q.half + half && Math.abs((q.y - y) / perPx + q.dy - d) < 18);
    while (dy > -80 && hits(dy)) dy -= 20;
    if (hits(dy)) dy = 0;
    placed.push({ x, y, half, dy });
    t?.setAttribute('y', dy);
  }
  if (svg.id === 'world') problemLegend(vb);
}

const JOURNEY_HINT = 'Click where the journey starts: a place, or anywhere on the map. Esc to stop.';
const ROUTE_HINT = 'Drag the route to add a waypoint, and drag a waypoint to move it: drop it on a place to call there. Double-click a waypoint to take it out. Esc to stop.';
const MAP_HINT = 'Scroll to zoom and drag to move around. Click a place or realm to see its page.';

function renderMap() {
  const m = (state.map ||= { vb: null, tool: null, draft: [] });
  m.sort ||= { key: 'name', dir: 1 };
  if (m.sel && !state.pages.has(m.sel)) m.sel = null;
  // Pins are for places, and for people and groups with a seat somewhere; rules, lore, items and the like stay off.
  const onMap = new Set(mapPages().map(p => p.id));
  const placeable = visiblePages().filter(p => p.id !== 'home' && (onMap.has(p.id) || !['session', 'pc', 'rules', 'lore', 'essence', 'item', 'encounter', 'adventure'].includes(p.meta.type)))
    .sort((a, b) => a.meta.title.localeCompare(b.meta.title));
  const isPlace = p => ['location', 'astral'].includes(p.meta.type);
  const pick = state.view.focus && state.pages.has(state.view.focus) ? state.view.focus : m.pick || '';
  $('#view').innerHTML = `<div class="wide map-page">
    <div class="map-bar">
      <h1>World map</h1>
      <span class="spacer"></span>
      <span class="dm-tool map-tools">
        <select id="map-pick" title="The page to place, move or give a border">
          <option value="">Choose a page…</option>
          ${[['Places not on the map yet', p => !onMap.has(p.id) && isPlace(p)], ['People and groups not on the map yet', p => !onMap.has(p.id) && !isPlace(p)], ['On the map', p => onMap.has(p.id)]].map(([label, f]) => `<optgroup label="${label}">${placeable.filter(f).map(p => `<option value="${esc(p.id)}" ${p.id === pick ? 'selected' : ''}>${esc(p.meta.title)}</option>`).join('')}</optgroup>`).join('')}
        </select>
        <button class="btn small" id="map-place" title="Then click the map where it is">Place</button>
        <button class="btn small" id="map-border" title="Click around its edge, then double-click or press Enter to finish">Draw border</button>
        <button class="btn small" id="map-remove" title="Take its pin and border off the map; the page stays">Remove</button>
        ${partyGroups().length ? `<select id="map-move-who" title="Who to move">${[['main', mainPartyName()], ...partyGroups().map(g => [g.id, g.name])].map(([v, l]) => `<option value="${esc(v)}" ${v === (m.moveWho || 'main') ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>` : ''}
        <button class="btn small" id="map-move-party" title="Then click the map where the party is: a place, or anywhere">Move party</button>
        <button class="btn small" id="map-journey" data-sys="travel" title="Click where a journey starts and ends, then roll its days in the Travel generator">Plan journey</button>
        <button class="btn small" id="map-sea" title="Fill the sea in view with islands, wrecks, reefs and other places to find, shown here to keep or throw back">Sea places</button>
      </span>
      <button class="btn small dm-tool${mapHideGen() ? '' : ' on'}" id="map-gen" title="Places the generators made (hollow pins). Click to ${mapHideGen() ? 'show' : 'hide'} them.">Generated places</button>
      <button class="btn small" id="map-fit">Whole world</button>
      <button class="btn small" id="map-export" title="Save what you see as a picture">Export image</button>
    </div>
    <p class="hint" id="map-hint">${MAP_HINT}</p>
    <div class="map-body">
      <div class="map-wrap${mapHideGen() ? ' hide-gen' : ''}" id="map-wrap">${worldSVG()}<div class="map-legend dm-tool" id="map-legend" hidden></div><div class="map-route dm-tool" id="map-route" hidden></div></div>
      <aside class="map-side" id="map-side"></aside>
    </div>
    <p class="hint credit">Coastlines from Natural Earth (public domain).</p>
  </div>`;
  const svg = $('#world');
  const wrap = $('#map-wrap');
  const full = [0, 0, WORLD.width, WORLD.height];
  let vb = m.vb || full;
  // Open on a place when asked to show it.
  const focus = state.view.focus && state.pages.get(state.view.focus);
  if (focus && (mapPoint(focus) || mapBorder(focus).length)) {
    const [x, y] = mapPoint(focus) ? mapXY(mapPoint(focus)) : centroid(mapBorder(focus).map(mapXY));
    vb = [x - 130, y - 75, 260, 150];
    m.sel = focus.id;
  }
  // The view keeps its shape, so the scale is set by whichever side fills the frame.
  const perPx = () => Math.max(vb[2] / Math.max(1, wrap.clientWidth), vb[3] / Math.max(1, wrap.clientHeight));
  const apply = () => {
    m.vb = vb;
    svg.setAttribute('viewBox', vb.join(' '));
    scaleMapMarks(svg, vb, perPx());
  };
  const toMap = e => {
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const r = pt.matrixTransform(svg.getScreenCTM().inverse());
    return [r.x, r.y];
  };
  const hint = text => { $('#map-hint').textContent = text || MAP_HINT; };
  // The side panel: every place in a list you can sort and search, or the one you picked with its page.
  const side = $('#map-side');
  const markSel = () => $$('.pin, .realm, .realm-label', svg).forEach(g => g.classList.toggle('selected', g.dataset.id === m.sel));
  const renderSide = () => {
    markSel();
    if (m.seaDrafts?.length) return seaDraftPanel(side, () => renderMap());
    const p = m.sel && state.pages.get(m.sel);
    if (p) {
      side.innerHTML = `<div class="map-side-head">
          <button class="btn small" id="map-list" title="Back to every place">← All places</button>
          <button class="btn small" id="map-open">Open page</button>
        </div>
        <div class="map-preview">
          <h2>${esc(p.meta.title)}</h2>
          <p class="muted">${esc(placeKind(p))} · ${esc(placeRegion(p))}${hasCircle(p) ? ` · Teleport circle${knownCircles().includes(p.meta.title) ? ' (address known)' : ''}` : ''}</p>
          ${state.dm && mapPoint(p) ? `<button class="btn small" id="map-circle" data-sys="travel" title="Whether this place has a circle in the teleport network">${hasCircle(p) ? 'Remove teleport circle' : 'Add teleport circle'}</button>` : ''}
          <div class="prose">${renderMarkdown(p.body)}</div>
        </div>`;
      $('#map-list').onclick = () => { m.sel = null; renderSide(); };
      if ($('#map-circle')) $('#map-circle').onclick = () => saveMeta(p, { circle: !hasCircle(p) }, hasCircle(p) ? `${p.meta.title} has no teleport circle now.` : `${p.meta.title} has a teleport circle.`);
      $('#map-open').onclick = () => openPage(p.id);
      return;
    }
    const q = (m.q || '').trim().toLowerCase();
    const { key, dir } = m.sort;
    const val = { name: x => x.meta.title.replace(/^The /, ''), kind: placeKind, region: placeRegion };
    const rows = mapPages().filter(x => !q || x.meta.title.toLowerCase().includes(q))
      .sort((a, b) => dir * (val[key](a).localeCompare(val[key](b)) || val.name(a).localeCompare(val.name(b))));
    side.innerHTML = `<input id="map-q" type="search" placeholder="Find a place" value="${esc(m.q || '')}">
      <div class="map-sorts">${Object.entries(PLACE_SORTS).map(([k, label]) => `<button class="map-sort${k === key ? ' active' : ''}" data-sort="${k}" title="Sort by ${label.toLowerCase()}">${label}${k === key ? (dir > 0 ? ' ▲' : ' ▼') : ''}</button>`).join('')}</div>
      <div class="map-places">${rows.map(x => `<button class="map-place" data-id="${esc(x.id)}"><span>${esc(x.meta.title)}</span><span class="muted">${esc(placeKind(x))}</span><span class="muted">${esc(placeRegion(x))}</span></button>`).join('') || '<p class="muted">No places match.</p>'}</div>
      <p class="hint">${rows.length} of ${mapPages().length} places</p>`;
    const input = $('#map-q');
    input.oninput = () => { m.q = input.value; renderSide(); const i = $('#map-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); };
    $$('[data-sort]', side).forEach(b => b.onclick = () => {
      m.sort = b.dataset.sort === key ? { key, dir: -dir } : { key: b.dataset.sort, dir: 1 };
      renderSide();
    });
    $$('.map-place', side).forEach(b => b.onclick = () => select(b.dataset.id, true));
  };
  // Pick a place: show its page in the panel, and fly to it when picked from the list.
  const select = (id, fly) => {
    const p = state.pages.get(id);
    if (!p) return;
    m.sel = id;
    if (state.dm && $('#map-pick')) { $('#map-pick').value = id; m.pick = id; }
    if (fly) {
      const pts = mapBorder(p).map(mapXY);
      const [x, y] = mapPoint(p) ? mapXY(mapPoint(p)) : centroid(pts);
      const span = pts.length ? Math.max(...pts.map(q => q[0])) - Math.min(...pts.map(q => q[0])) : 0;
      const w = Math.max(260, Math.min(span * 1.6, WORLD.width)), h = w * vb[3] / vb[2];
      vb = [x - w / 2, y - h / 2, w, h];
      apply();
    }
    renderSide();
  };
  const setTool = (tool, text) => { m.tool = tool; m.draft = []; m.journey = []; drawDraft(); drawRoute(); wrap.classList.toggle('placing', !!tool && tool !== 'route'); hint(text); };
  // Planning a route: drag the line to add a waypoint, drag a waypoint to move it (onto a place to call there),
  // double-click one to take it out. The waypoints are the Travel form's (state.gen.opts.travel.via).
  const routeOpts = () => (state.gen.opts.travel ||= {});
  const routeEnds = () => [travelPlace(routeOpts().from), travelPlace(routeOpts().to)];
  const drawRoute = (preview = false) => {
    const g = $('.route-plan', svg), box = $('#map-route');
    const o = routeOpts(), [from, to] = routeEnds();
    if (m.tool !== 'route' || !from?.at || !to?.at) { g.innerHTML = ''; box.hidden = true; return; }
    const via = (o.via ||= []);
    const r = preview ? null : planRoute(o, from, to);
    const pts = (r && !r.error ? r.pts : [from.at, ...via.map(v => v.at), to.at]).map(mapXY);
    const d = `M${pts.map(q => q.join(',')).join('L')}`;
    g.innerHTML = `<path class="route-line${r?.error ? ' bad' : ''}${preview ? ' preview' : ''}" d="${d}"/><path class="route-hit" d="${d}"><title>Drag to add a waypoint</title></path>`
      + [from, to].map(p => { const [x, y] = mapXY(p.at); return `<g class="scaled route-end" data-x="${x}" data-y="${y}"><circle r="5"/></g>`; }).join('')
      + via.map((v, i) => { const [x, y] = mapXY(v.at); return `<g class="scaled route-via${v.name ? ' stop' : ''}" data-via="${i}" data-x="${x}" data-y="${y}"><title>${esc(v.name || `Waypoint ${i + 1}`)}: drag to move, double-click to take out</title><circle r="6"/></g>`; }).join('');
    scaleMapMarks(svg, vb, perPx());
    if (preview) return;
    const modes = state.data.travel?.modes || [];
    box.hidden = false;
    box.innerHTML = `<b>${esc(from.name)} to ${esc(to.name)}</b>
      <label class="field">Travel by<select id="route-mode">${modes.map(x => `<option ${x.name === (o.mode || 'On foot') ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
      <p class="${r.error ? 'route-bad' : 'muted'}">${r.error ? `⚠ ${esc(r.message)}` : `About ${routeWound(o, r).toLocaleString('en-US')} miles${r.split ? ` in ${r.split.length} legs` : sails(o) ? ' by water, keeping off the coast where it can' : ''}${via.length ? `, ${esc(viaText(via))}` : ''}.`}</p>
      <div class="row">${via.length ? '<button class="btn small" id="route-clear" title="Go the shortest way again">Clear waypoints</button>' : ''}<span class="spacer"></span><button class="btn small primary" id="route-done" title="Back to the Travel generator to start the journey">Done</button></div>`;
    $('#route-mode').onchange = e => {
      const was = o.mode;
      o.mode = e.target.value;
      // Ships sail the open sea; back on land, the road.
      if (o.mode === 'Sailing ship' && (!o.terrain || o.terrain === 'Road')) o.terrain = 'Open sea';
      if (BOATS.includes(was) && !BOATS.includes(o.mode) && o.terrain === 'Open sea') o.terrain = 'Road';
      drawRoute();
    };
    if ($('#route-clear')) $('#route-clear').onclick = () => { o.via = []; drawRoute(); };
    $('#route-done').onclick = () => { setTool(null); state.gen.tab = 'travel'; go({ kind: 'generators' }); };
  };
  /** Where a waypoint added at this spot on the line goes in the list: the leg of the route it's on. */
  const routeInsertAt = xy => {
    const o = routeOpts(), [from, to] = routeEnds(), r = planRoute(o, from, to);
    const ok = r && !r.error;
    const pts = (ok ? r.pts : [from.at, ...o.via.map(v => v.at), to.at]).map(mapXY);
    let best = 0, bd = Infinity;
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i], dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
      const t = len ? Math.max(0, Math.min(1, ((xy[0] - ax) * dx + (xy[1] - ay) * dy) / len)) : 0;
      const dd = Math.hypot(xy[0] - ax - t * dx, xy[1] - ay - t * dy);
      if (dd < bd) { bd = dd; best = i - 1; }
    }
    return ok ? r.legs.filter(k => k <= best).length - 1 : best;
  };
  const drawDraft = () => {
    const g = $('.draft', svg);
    if (!m.draft.length) { g.innerHTML = ''; return; }
    const pts = m.draft.map(mapXY);
    g.innerHTML = `<path class="draft-line" d="M${pts.map(q => q.join(',')).join('L')}"/>` + pts.map(([x, y]) => `<g class="scaled" data-x="${x}" data-y="${y}"><circle r="3"/></g>`).join('');
    scaleMapMarks(svg, vb, perPx());
  };
  const picked = () => {
    const id = $('#map-pick')?.value;
    if (!id) toast('Choose a page first.', true);
    return id ? state.pages.get(id) : null;
  };
  const saveMeta = async (p, change, done) => {
    const meta = { ...p.meta, ...change };
    for (const k of Object.keys(change)) if (change[k] === undefined) delete meta[k];
    await attempt(async () => {
      await api.pages.write(p.id, meta, p.body);
      p.meta = meta;
      m.pick = p.id;
      m.tool = null; m.draft = [];
      renderMap();
      toast(done);
    });
  };
  apply();
  requestAnimationFrame(apply);
  renderSide();
  // One observer at a time: the last map's would keep its old drawing alive.
  state.mapObserver?.disconnect();
  state.mapObserver = new ResizeObserver(() => apply());
  state.mapObserver.observe(wrap);

  wrap.addEventListener('wheel', e => {
    e.preventDefault();
    const [mx, my] = toMap(e);
    const f = Math.exp(e.deltaY * 0.0015);
    const w = Math.min(WORLD.width * 1.2, Math.max(40, vb[2] * f));
    const s = w / vb[2];
    vb = [mx - (mx - vb[0]) * s, my - (my - vb[1]) * s, w, vb[3] * s];
    apply();
  }, { passive: false });

  // Drag the map to pan, or a pin to move it (DM mode). A press that barely moves is a click.
  let drag = null;
  wrap.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    if (m.tool === 'route') {
      const v = e.target.closest('.route-via'), line = !v && e.target.closest('.route-hit');
      if (v || line) {
        const via = (routeOpts().via ||= []);
        const i = v ? Number(v.dataset.via) : routeInsertAt(toMap(e));
        if (line) via.splice(i, 0, { name: '', at: mapLL(toMap(e)) });
        drag = { via: i, added: !!line, was: { ...via[i] }, x: e.clientX, y: e.clientY, moved: false };
        wrap.setPointerCapture(e.pointerId);
        return;
      }
    }
    const pin = state.dm && !m.tool && e.target.closest('.pin:not(.sea-draft)');
    drag = { x: e.clientX, y: e.clientY, vb: [...vb], pin, moved: false, start: toMap(e), hit: e.target.closest('.journey-party, .party-mark, .pin, .realm, .realm-label') };
    wrap.setPointerCapture(e.pointerId);
  });
  wrap.addEventListener('pointermove', e => {
    if (!drag) return;
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 4) drag.moved = true;
    if (!drag.moved) return;
    if (drag.via !== undefined) {
      routeOpts().via[drag.via] = { name: '', at: mapLL(toMap(e)) };
      return drawRoute(true);
    }
    if (drag.pin) {
      const [x, y] = toMap(e);
      drag.pin.dataset.x = x; drag.pin.dataset.y = y;
      scaleMapMarks(svg, vb, perPx());
      return;
    }
    const k = perPx();
    vb = [drag.vb[0] - (e.clientX - drag.x) * k, drag.vb[1] - (e.clientY - drag.y) * k, vb[2], vb[3]];
    apply();
  });
  wrap.addEventListener('pointerup', async e => {
    const d = drag; drag = null;
    if (!d) return;
    if (d.via !== undefined) {
      const o = routeOpts(), via = o.via;
      if (!d.moved) {
        if (d.added) { via.splice(d.via, 1); return; }
        // The map holds the pointer, so a double-click is two quick clicks on the same waypoint.
        const now = Date.now(), last = m.viaClick;
        m.viaClick = { i: d.via, at: now };
        if (last?.i === d.via && now - last.at < 450) { via.splice(d.via, 1); m.viaClick = null; drawRoute(); }
        return;
      }
      // Dropped on or near a place: the route calls there.
      const xy = toMap(e), near = perPx() * 14, at = mapLL(xy);
      const place = travelPlaces().map(p => ({ p, d: Math.hypot(...mapXY(p.at).map((v, i) => v - xy[i])) })).sort((a, b) => a.d - b.d)[0];
      const pt = place && place.d <= near ? { name: place.p.name, at: place.p.at } : { name: '', at };
      if (sails(o) && !PL.onWater(pt.at)) {
        if (d.added) via.splice(d.via, 1); else via[d.via] = d.was;
        toast(`A ${o.mode.toLowerCase()} keeps to the water: put the waypoint at sea, on a river, or at a port.`, true);
      } else via[d.via] = pt;
      return drawRoute();
    }
    if (d.moved && d.pin) {
      const p = state.pages.get(d.pin.dataset.id);
      return p && saveMeta(p, { map: mapLL(toMap(e)) }, `${p.meta.title} moved.`);
    }
    if (d.moved) return;
    const at = mapLL(toMap(e));
    if (m.tool === 'place') { const p = picked(); return p && saveMeta(p, { map: at }, `${p.meta.title} is on the map.`); }
    if (m.tool === 'border') { m.draft.push(at); drawDraft(); return; }
    if (m.tool === 'party') {
      const xy = toMap(e), near = perPx() * 14;
      const place = travelPlaces().map(p => ({ p, d: Math.hypot(...mapXY(p.at).map((v, i) => v - xy[i])) })).sort((a, b) => a.d - b.d)[0];
      const who = m.moveWho || 'main';
      m.tool = null; m.moveWho = null;
      await moveParty(who, place && place.d <= near ? place.p : { name: nearPlaceName(at), at });
      return renderMap();
    }
    if (m.tool === 'journey') {
      // Snap to a place clicked on or near; anywhere else is a point of its own.
      const xy = toMap(e), near = perPx() * 14;
      const place = travelPlaces().map(p => ({ p, d: Math.hypot(...mapXY(p.at).map((v, i) => v - xy[i])) })).sort((a, b) => a.d - b.d)[0];
      const pt = place && place.d <= near ? place.p : { name: nearPlaceName(at), at };
      m.draft.push(pt.at); (m.journey ||= []).push(pt); drawDraft();
      if (m.journey.length < 2) return hint(`From ${pt.name}. Now click where the journey ends. Esc to stop.`);
      const [from, to] = m.journey;
      const g = state.gen;
      g.opts.travel = { ...(g.opts.travel || {}), from: placeValue(from), to: placeValue(to), miles: '', via: [] };
      return setTool('route', ROUTE_HINT);
    }
    if (m.tool === 'route') return;
    // The map holds the pointer while it's down, so what was clicked is what was pressed.
    if (d.hit?.dataset.journey) return openJourney(d.hit.dataset.journey);
    if (d.hit?.dataset.party) return go({ kind: 'party' });
    if (d.hit) select(d.hit.dataset.id);
  });
  wrap.addEventListener('dblclick', e => {
    const hit = !m.tool && e.target.closest('.pin, .realm, .realm-label');
    if (hit) openPage(hit.dataset.id);
  });
  const finishBorder = () => {
    const p = picked();
    if (!p) return;
    if (m.draft.length < 3) return toast('A border needs at least three points.', true);
    saveMeta(p, { border: m.draft.map(q => [...q]) }, `${p.meta.title} has a border.`);
  };
  wrap.addEventListener('dblclick', e => { if (m.tool === 'border') { e.preventDefault(); m.draft.pop(); finishBorder(); } });
  const keys = e => {
    if (state.view?.kind !== 'map') return document.removeEventListener('keydown', keys);
    if (!m.tool) return;
    if (e.key === 'Escape') setTool(null);
    if (e.key === 'Enter' && m.tool === 'border') finishBorder();
    if (e.key === 'Backspace' && m.tool === 'border') { m.draft.pop(); drawDraft(); }
  };
  document.removeEventListener('keydown', state.mapKeys || (() => {}));
  state.mapKeys = keys;
  document.addEventListener('keydown', keys);

  // The legend sits on the map, so its clicks and scrolls mustn't pan, zoom or place anything.
  for (const t of ['wheel', 'pointerdown', 'pointermove', 'pointerup', 'dblclick']) for (const id of ['#map-legend', '#map-route']) $(id).addEventListener(t, e => e.stopPropagation());
  $('#map-fit').onclick = () => { vb = full; apply(); };
  $('#map-gen').onclick = e => {
    const hide = !mapHideGen();
    try { localStorage.setItem('map-hide-generated', hide ? '1' : ''); } catch {}
    $('#map-wrap').classList.toggle('hide-gen', hide);
    e.currentTarget.classList.toggle('on', !hide);
  };
  $('#map-export').onclick = () => exportMap(svg, vb);
  if (!state.dm) return;
  $('#map-pick').onchange = e => { m.pick = e.target.value; };
  $('#map-place').onclick = () => { const p = picked(); if (p) setTool('place', `Click the map where ${p.meta.title} is. Esc to stop.`); };
  $('#map-border').onclick = () => {
    const p = picked();
    if (p) setTool('border', `Click around ${p.meta.title}'s edge. Double-click or press Enter to finish, Backspace to undo a point, Esc to stop.`);
  };
  $('#map-journey').onclick = () => setTool('journey', JOURNEY_HINT);
  const moveHint = () => `Click where ${(partyGroups().find(g => g.id === m.moveWho)?.name || mainPartyName()).replace(/^The /, 'the ')} is: a place, or anywhere on the map. Esc to stop.`;
  if ($('#map-move-who')) $('#map-move-who').onchange = e => { m.moveWho = e.target.value; if (m.tool === 'party') hint(moveHint()); };
  $('#map-move-party').onclick = () => { const who = $('#map-move-who')?.value || 'main'; setTool('party', ''); m.moveWho = who; hint(moveHint()); };
  $('#map-sea').onclick = () => askSeedSea(boxOf(vb));
  $('#map-remove').onclick = () => {
    const p = picked();
    if (p && (mapPoint(p) || mapBorder(p).length)) saveMeta(p, { map: undefined, border: undefined }, `${p.meta.title} is off the map.`);
  };
  if (m.tool) wrap.classList.add('placing');
  if (m.tool === 'journey') { m.draft = []; m.journey = []; }
  if (m.tool === 'route') { wrap.classList.remove('placing'); drawRoute(); }
  if (m.tool) hint(m.tool === 'place' ? 'Click the map to place the page. Esc to stop.' : m.tool === 'journey' ? JOURNEY_HINT : m.tool === 'route' ? ROUTE_HINT : m.tool === 'party' ? moveHint() : 'Click around the edge; Enter to finish.');
}

/** Save the map as you see it as a PNG, colours and all. */
async function exportMap(svg, vb) {
  const width = 2400, height = Math.round(width * vb[3] / vb[2]);
  const clone = svg.cloneNode(true);
  // Computed colours go inline, since the picture has no stylesheet.
  const props = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'opacity', 'font-family', 'font-size', 'font-weight', 'font-style', 'letter-spacing', 'text-anchor', 'paint-order', 'stroke-linejoin', 'display', 'vector-effect', 'r', 'text-transform'];
  const live = [svg, ...svg.querySelectorAll('*')], copy = [clone, ...clone.querySelectorAll('*')];
  live.forEach((el, i) => {
    const cs = getComputedStyle(el);
    copy[i].setAttribute('style', props.map(k => `${k}:${cs.getPropertyValue(k)}`).join(';'));
  });
  clone.setAttribute('width', width); clone.setAttribute('height', height);
  clone.setAttribute('viewBox', vb.join(' '));
  clone.querySelectorAll('title, .draft, .problem.off').forEach(x => x.remove());
  scaleMapMarks(clone, vb, vb[2] / width * 1.6);
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise((ok, bad) => { img.onload = ok; img.onerror = () => bad(new Error('The map could not be drawn')); img.src = url; });
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    canvas.getContext('2d').drawImage(img, 0, 0);
    const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const saved = await attempt(() => api.files.saveImage(`${state.campaign.name} map.png`, bytes));
    if (saved) toast('Map saved');
  } finally { URL.revokeObjectURL(url); }
}

// ---------- search ----------

function renderSearch(q) {
  const query = q.trim().toLowerCase();
  const results = [];
  for (const p of visiblePages()) {
    const t = p.meta.title.toLowerCase();
    const bodyIdx = shownBody(p).toLowerCase().indexOf(query);
    const tagHit = [].concat(p.meta.tags || []).some(x => String(x).toLowerCase().includes(query));
    let score = 0;
    if (t === query) score = 100; else if (t.startsWith(query)) score = 60; else if (t.includes(query)) score = 40;
    if (tagHit) score += 20;
    if (bodyIdx >= 0) score += 10;
    if (score) results.push({ p, score, bodyIdx });
  }
  results.sort((a, b) => b.score - a.score || a.p.meta.title.localeCompare(b.p.meta.title));
  const snippet = (body, i) => {
    if (i < 0) return '';
    const s = Math.max(0, i - 60);
    const raw = body.slice(s, i + query.length + 80).replace(WIKILINK, (_, t, l) => l || t).replace(/[#*_>`|]/g, '');
    const re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig');
    return (s ? '…' : '') + esc(raw).replace(re, m => `<mark>${m}</mark>`) + '…';
  };
  $('#view').innerHTML = `<div class="page">
    <h1 style="margin:0 0 12px;font:600 28px var(--serif)">Search: ${esc(q)}</h1>
    ${results.length ? `<div class="list">${results.map(r => `<div class="item-row search-hit" data-id="${esc(r.p.id)}" style="flex-direction:column;gap:2px">
      <div><strong>${esc(r.p.meta.title)}</strong> <span class="badge">${esc(typeInfo(r.p.meta.type).label)}</span></div>
      <div class="muted" style="font-size:14px">${snippet(shownBody(r.p), r.bodyIdx)}</div></div>`).join('')}</div>`
      : `<div class="empty"><p>Nothing found.</p><button class="btn" id="create-from-search">Create "${esc(q)}"</button></div>`}
  </div>`;
  $$('.item-row').forEach(r => r.onclick = () => openPage(r.dataset.id));
  const c = $('#create-from-search');
  if (c) c.onclick = () => newPageFlow(q);
}

// ---------- campaigns ----------

async function renderCampaigns() {
  const list = await attempt(() => api.campaigns.list()) || [];
  $('#view').innerHTML = `<div class="page">
    <h1 style="margin:0 0 6px;font:600 32px var(--serif)">Campaigns</h1>
    <p class="hint">Each campaign is a folder of pages, images, generator lists and saved hooks on this computer. <strong>Export</strong> puts everything in a campaign into one backup file. On another computer, install the app and use <strong>Import backup</strong> to bring it all across.</p>
    <div class="list" style="margin:16px 0">${list.map(n => `<div class="item-row" data-name="${esc(n)}"><strong>${esc(n)}</strong>
      ${n === state.campaign.name ? '<span class="badge type">Open</span>' : ''}<span class="spacer"></span>
      <button class="btn small" data-export="${esc(n)}" title="Save this campaign as one backup file">Export</button></div>`).join('')}</div>
    <div class="row">
      <button class="btn primary" id="camp-new">+ New campaign</button>
      <button class="btn" id="camp-import">Import backup</button>
      ${list.length > 1 ? '<button class="btn" id="camp-export-all">Export all campaigns</button>' : ''}
      <button class="btn" id="camp-reveal">Show campaign folder</button>
    </div>
  </div>`;
  $$('[data-export]').forEach(b => b.onclick = e => { e.stopPropagation(); exportCampaigns([b.dataset.export]); });
  $('#camp-import').onclick = importCampaigns;
  const all = $('#camp-export-all');
  if (all) all.onclick = () => exportCampaigns();
  $$('.item-row').forEach(r => r.onclick = async () => {
    if (r.dataset.name === state.campaign.name) return go({ kind: 'page', id: 'home' });
    await attempt(async () => {
      await flushRolls();
      await api.campaigns.open(r.dataset.name);
      await switchedCampaign();
    });
  });
  $('#camp-reveal').onclick = () => attempt(() => api.campaigns.reveal());
  $('#camp-new').onclick = async () => {
    const r = await formDialog('New campaign', `
      <label class="field">Name<input name="name" required></label>
      <label class="field">Start from<select name="from"><option value="starter">Pallimustus (world wiki from the primers)</option><option value="blank">Blank (generator lists only)</option></select></label>`, 'Create');
    if (!r) return;
    await attempt(async () => {
      await flushRolls();
      await api.campaigns.create(r.name.trim(), r.from === 'starter');
      await switchedCampaign();
      toast('Campaign created');
    });
  };
}

async function switchedCampaign() {
  state.history = [];
  state.future = [];
  state.view = null;
  state.gen = { tab: 'all', wordHistory: [], opts: {}, pos: {} };
  await loadCampaign();
  await go({ kind: 'page', id: 'home' });
}

// ---------- sharing sheets ----------

const SHEET_FILE = { name: 'Character sheet', ext: 'dndsheet' };

const b64ToBytes = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));

async function exportSheet(id) {
  const p = state.pages.get(id);
  if (!p) return;
  let dm = false;
  // The DM decides whether their notes go with the sheet; from player view they never do.
  if (state.dm && G.stripDM(p.body).trim() !== p.body.trim()) {
    const r = await formDialog('Export sheet', `<p class="muted" style="margin:0 0 10px">This page has DM-only notes.</p>
      <label class="field">DM notes<select name="dm"><option value="no">Leave them out (for sending to the player)</option><option value="yes">Include them</option></select></label>`, 'Export');
    if (!r) return;
    dm = r.dm === 'yes';
  }
  await attempt(async () => {
    const image = p.meta.image && !/^https?:/.test(p.meta.image) ? await api.images.read(p.meta.image).catch(() => null) : null;
    const text = G.packSheet(p.meta, p.body, { dm, image, campaign: state.campaign.name });
    const where = await api.files.saveText(`${p.meta.title}.${SHEET_FILE.ext}`, text, SHEET_FILE);
    if (where) toast(`Saved ${p.meta.title}'s sheet. Send that file to share it.`);
  });
}

async function importSheet() {
  const file = await attempt(() => api.files.openText(SHEET_FILE));
  if (!file) return;
  let s;
  try { s = G.readSheet(file.text); } catch (err) { return toast(err.message, true); }
  const same = pcs().find(p => p.meta.title.toLowerCase() === s.meta.title.toLowerCase());
  let mode = 'new';
  if (same) {
    const r = await formDialog(`Import ${s.meta.title}`, `<p class="muted" style="margin:0 0 10px">${esc(s.meta.title)} is already in the party${s.exported ? `. This file was saved ${esc(new Date(s.exported).toLocaleString())}` : ''}.</p>
      <label class="field">What to do<select name="mode"><option value="update">Update the sheet here with this file (DM notes here are kept)</option><option value="new">Add it as another character</option></select></label>`, 'Import');
    if (!r) return;
    mode = r.mode;
  }
  await attempt(async () => {
    const meta = { ...s.meta };
    if (s.image) meta.image = await api.images.save(s.image.name || 'portrait.png', b64ToBytes(s.image.data));
    if (mode === 'update') {
      const m = { ...meta, title: same.meta.title, image: meta.image || same.meta.image };
      if (!m.image) delete m.image;
      const body = G.mergeSheetBody(same.body, s.body);
      await api.pages.write(same.id, m, body);
      state.pages.set(same.id, await api.pages.read(same.id));
      rebuildIndex();
      toast(`Updated ${same.meta.title}'s sheet`);
      return go({ kind: 'page', id: same.id }, { replace: state.view?.kind === 'page' && state.view.id === same.id });
    }
    let title = meta.title;
    for (let i = 2; state.titleIndex.has(title.toLowerCase()); i++) title = `${meta.title} (${i})`;
    await createPage(title, meta, s.body);
    toast(`Added ${title} to the party`);
  });
}

// ---------- campaign backups ----------

async function exportCampaigns(names) {
  const r = await attempt(() => api.campaigns.exportBackup(names));
  if (r) toast(`Backed up ${r.campaigns.length === 1 ? r.campaigns[0] : `${r.campaigns.length} campaigns`} to one file. Import it on any computer with this app.`);
}

async function importCampaigns() {
  const info = await attempt(() => api.campaigns.importRead());
  if (!info) return;
  const rows = info.campaigns.map(c => `<div class="import-row"><strong>${esc(c.name)}</strong> <span class="muted">${c.pages} pages, ${c.images} images</span>
    ${c.exists ? `<label class="field">Already on this computer<select name="${esc(c.name)}">
      <option value="copy">Keep both (import as a copy)</option>
      <option value="replace">Replace the one here with the backup</option>
      <option value="skip">Skip it</option></select></label>` : ''}</div>`).join('');
  const r = await formDialog('Import campaigns', `<p class="muted" style="margin:0 0 10px">${esc(info.file)}${info.exported ? `, saved ${esc(new Date(info.exported).toLocaleString())}` : ''}.</p>${rows}
    ${info.campaigns.some(c => c.exists) ? '<p class="hint">A replaced campaign is moved to a hidden <code>.replaced</code> folder beside your campaigns, not deleted.</p>' : ''}`, 'Import');
  if (!r) return;
  await flushRolls();
  const done = await attempt(() => api.campaigns.importApply(r));
  if (!done) return;
  if (!done.length) return toast('Nothing imported');
  await attempt(async () => {
    await api.campaigns.open(done[0]);
    await switchedCampaign();
  });
  toast(`Imported ${done.join(', ')}`);
}

// ---------- dialogs ----------

/** setup(form), when given, runs once the fields are in the dialog, before it opens. */
function formDialog(title, fieldsHtml, okLabel = 'OK', setup) {
  const dlg = $('#dialog');
  dlg.innerHTML = `<h2>${esc(title)}</h2><form method="dialog">${fieldsHtml}
    <div class="actions"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary" value="ok">${esc(okLabel)}</button></div></form>`;
  return new Promise(resolve => {
    const form = $('form', dlg);
    if (setup) setup(form);
    dlg.onclose = () => { closePicker(); resolve(dlg.returnValue === 'ok' ? Object.fromEntries(new FormData(form)) : null); };
    dlg.returnValue = '';
    pickerQuiet = true;
    dlg.showModal();
    const first = $('input, select', form);
    if (first) first.focus();
    pickerQuiet = false;
  });
}

function confirmDialog(title, text, okLabel = 'OK') {
  return formDialog(title, `<p class="muted" style="margin:0">${esc(text)}</p>`, okLabel).then(r => !!r);
}

// ---------- dice ----------
// One tray for every roll in the app: dice typed in, quick dice, attacks on stat cards and dice in wiki pages.
// In a battle, a roll with damage can be applied to anyone on the battle screen from the tray.

const QUICK_DICE = [4, 6, 8, 10, 12, 20, 100];
state.rolls = [];
state.rollMode = '';

/** The dice tray, wherever it is: in the main window, docked in a battle, or popped out into its own window. */
const trayEl = () => (state.trayEl ||= document.getElementById('dice-tray'));

/** Drag the tray's top-left corner to resize it; the size is remembered on this computer. */
function wireTrayResize(tray) {
  const apply = sz => {
    if (!sz) return;
    tray.style.setProperty('--dt-w', `${sz.w}px`);
    tray.style.setProperty('--dt-h', `${sz.h}px`);
  };
  try { apply(JSON.parse(localStorage.getItem('dice-size') || 'null')); } catch {}
  $('.dt-grip', tray).addEventListener('pointerdown', e => {
    if (tray.classList.contains('docked') || state.trayWin) return;
    e.preventDefault();
    const r = tray.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY;
    let sz = null;
    const move = ev => {
      sz = { w: Math.round(Math.max(280, Math.min(window.innerWidth - 40, r.width - (ev.clientX - x0)))), h: Math.round(Math.max(240, Math.min(window.innerHeight - 40, r.height - (ev.clientY - y0)))) };
      apply(sz);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      try { if (sz) localStorage.setItem('dice-size', JSON.stringify(sz)); } catch {}
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
}

/** Move the dice tray into a window of its own, which can sit on another screen. Closing it brings the tray back. */
function popOutTray() {
  const tray = trayEl();
  const r = tray.getBoundingClientRect();
  const w = window.open('', 'dice-tray', `width=${Math.round(Math.max(360, r.width || 360))},height=${Math.round(Math.max(480, r.height || 480))}`);
  if (!w) return toast('The dice could not open in a window of their own.', true);
  state.trayWin = w;
  const doc = w.document;
  doc.title = 'Dice';
  // The styles come along as text, since the new window has no file of its own to load them from.
  const css = [...document.styleSheets].map(sh => { try { return [...sh.cssRules].map(x => x.cssText).join('\n'); } catch { return ''; } }).join('\n');
  doc.head.innerHTML = `<meta charset="utf-8"><style>${css}</style>`;
  for (const a of document.documentElement.attributes) doc.documentElement.setAttribute(a.name, a.value);
  for (const a of document.body.attributes) doc.body.setAttribute(a.name, a.value);
  doc.body.classList.add('dice-window');
  undockTray();
  tray.classList.add('popped');
  tray.hidden = false;
  doc.body.append(doc.adoptNode(tray));
  // Dice buttons in the tray roll here too.
  doc.addEventListener('click', e => {
    if (concClick(e) || seatClick(e)) return;
    const rl = e.target.closest('[data-roll]');
    if (rl && !rl.closest('#dt-form')) { e.preventDefault(); rollExpr(rl.dataset.roll, rl.dataset.label || '', '', ''); }
  });
  w.addEventListener('pagehide', returnTray);
  window.addEventListener('beforeunload', () => w.close(), { once: true });
  $('#dt-pop', tray).title = 'Put the dice back in the main window';
  // The battle screen's dice column is empty now: the stat block takes its width.
  $('.battle-body')?.classList.add('dice-out');
  drawTray();
}

function returnTray() {
  const tray = trayEl();
  if (!state.trayWin) return;
  state.trayWin = null;
  tray.classList.remove('popped');
  document.body.append(document.adoptNode(tray));
  tray.dataset.wasOpen = '1';
  tray.hidden = false;
  $('#dt-pop', tray).title = 'Pop the dice out into their own window';
  if (state.view?.kind === 'battle') renderBattle(); else drawTray();
}

function initDice() {
  const tray = trayEl();
  tray.innerHTML = `<div class="dt-head"><b>Dice</b><span class="spacer"></span>
      <span class="dt-modes">${[['dis', 'Dis', 'Disadvantage'], ['', 'Normal', 'Normal rolls'], ['adv', 'Adv', 'Advantage']].map(([k, l, t]) => `<button class="chip" data-mode="${k}" title="${t} on d20 rolls and attacks">${l}</button>`).join('')}</span>
      <button class="icon-btn" id="dt-clear" title="Clear the roll history">🗑</button>
      <button class="icon-btn" id="dt-pop" title="Pop the dice out into their own window">⧉</button>
      <button class="icon-btn" id="dt-close" title="Close">×</button></div>
    <div class="dt-grip" title="Drag to resize"></div>
    <form id="dt-form" class="row"><input id="dt-expr" placeholder="2d6 + 3" autocomplete="off"><button class="btn small primary">Roll</button><button type="button" class="icon-btn" id="dt-fav" title="Save these dice as a favourite">☆</button></form>
    <div class="dt-quick">${QUICK_DICE.map(d => `<button class="chip" data-roll="1d${d}">d${d}</button>`).join('')}</div>
    <div class="dt-favs" id="dt-favs"></div>
    <div class="dt-log" id="dt-log"></div>`;
  $('#dt-close', tray).onclick = () => { if (state.trayWin) return state.trayWin.close(); tray.hidden = true; tray.dataset.wasOpen = ''; };
  $('#dt-clear', tray).onclick = () => { state.rolls = []; drawTray(); };
  $('#dt-pop', tray).onclick = () => (state.trayWin ? state.trayWin.close() : popOutTray());
  wireTrayResize(tray);
  $('#dt-form', tray).onsubmit = e => {
    e.preventDefault();
    const x = $('#dt-expr', tray).value.trim();
    if (x) rollExpr(x, '', '');
  };
  $$('[data-mode]', tray).forEach(b => b.onclick = () => { state.rollMode = b.dataset.mode; drawTray(); });
  $('#dt-fav', tray).onclick = () => editFavourite(null, $('#dt-expr', tray).value.trim());
  $('#dt-favs', tray).addEventListener('click', e => {
    const b = e.target.closest('[data-fav]');
    if (!b) return;
    const f = diceFavs()[Number(b.dataset.fav)];
    if (e.target.closest('.dt-fav-edit')) return editFavourite(Number(b.dataset.fav));
    if (f) rollExpr(f.expr, f.name, '');
  });
  $('#dt-favs', tray).addEventListener('contextmenu', e => { const b = e.target.closest('[data-fav]'); if (b) { e.preventDefault(); editFavourite(Number(b.dataset.fav)); } });
  $('#dice-btn').onclick = () => {
    if (state.trayWin) return state.trayWin.focus();
    if (!tray.classList.contains('docked')) { tray.hidden = !tray.hidden; tray.dataset.wasOpen = tray.hidden ? '' : '1'; }
    if (!tray.hidden) { drawTray(); $('#dt-expr', tray).focus(); }
  };
  tray.addEventListener('change', e => { if (e.target.id === 'dt-target') { state.applyTarget = e.target.value; if (state.rolls[0]) state.rolls[0].target = e.target.value; trayChanged(); } else trayTargets(e); });
  tray.addEventListener('click', e => {
    const b = e.target.closest('[data-apply]');
    if (b) return applyFromTray(b.dataset.apply);
    const ce = e.target.closest('[data-conc-end]');
    if (ce) {
      const c = battle().list.find(x => x.id === ce.dataset.concEnd), k = c?.conditions?.find(x => x.name === 'Concentrating');
      if (k) { endSpellEffects(c.id, k.spell); c.conditions = c.conditions.filter(x => x !== k); battleLog(`${c.name} stops concentrating on ${k.spell}.`, true); }
      if (state.rolls[0]) state.rolls[0].allSaved = null;
      saveBattle(); trayChanged();
      return;
    }
    if (e.target.closest('[data-flip], [data-untarget], [data-add-side]')) trayTargets(e);
  });
  drawTray();
}

/** Named dice the DM rolls often ("Kael's sneak attack", 1d6 + 3d6), kept with the campaign. */
const diceFavs = () => (state.saved.diceFavs ||= []);
async function editFavourite(i, expr = '') {
  const favs = diceFavs();
  const f = i == null ? { name: '', expr } : favs[i];
  if (!f) return;
  const r = await formDialog(i == null ? 'Save a favourite roll' : `Favourite: ${f.name}`, `
    <label class="field">Name<input name="name" required value="${esc(f.name)}" placeholder="Kael's sneak attack"></label>
    <label class="field">Dice<input name="expr" required value="${esc(f.expr)}" placeholder="1d6 + 3d6 + 4"></label>
    ${i == null ? '' : '<label class="check"><input type="checkbox" name="remove"> Remove this favourite</label>'}`, 'Save');
  if (!r) return;
  if (r.remove) favs.splice(i, 1);
  else {
    if (!G.parseDice(r.expr)) return toast(`"${r.expr}" isn't a dice roll. Try something like 2d6 + 3.`, true);
    const next = { name: r.name.trim(), expr: G.diceText(G.parseDice(r.expr)) };
    if (i == null) favs.push(next); else favs[i] = next;
  }
  await attempt(() => api.saved.write(state.saved));
  drawTray();
}
function drawTray() {
  const favBox = $('#dt-favs', trayEl());
  if (favBox) favBox.innerHTML = diceFavs().map((f, i) => `<span class="dt-fav" data-fav="${i}"><button class="chip" title="${esc(f.expr)}. Right-click to edit.">★ ${esc(f.name)}</button><button class="dt-fav-edit" title="Edit or remove">✎</button></span>`).join('');
  $$('[data-mode]', trayEl()).forEach(b => b.classList.toggle('on', b.dataset.mode === state.rollMode));
  const breakdown = t => esc(t).replace(/~~(\d+)~~/g, '<s>$1</s>');
  // The latest roll's targets come first: an attack fits itself to its target's magic items (fitToTarget).
  const bar = state.rolls[0] ? applyBar(state.rolls[0]) : '';
  $('#dt-log', trayEl()).innerHTML = state.rolls.map((r, i) => `<div class="dt-roll${i ? '' : ' latest'}">
      <div class="dt-what">${r.who ? `<b>${esc(r.who)}</b> · ` : ''}${esc(r.label)}</div>
      ${r.lines.map(l => `<div class="dt-line${l.cls ? ' ' + l.cls : ''}"><span class="dt-label">${l.html || esc(l.text)}</span><span class="dt-total">${esc(String(l.total ?? ''))}</span><span class="dt-detail">${breakdown(l.detail || '')}</span></div>`).join('')}
      ${i === 0 ? bar : ''}
    </div>`).join('') || '<p class="hint">Type dice like <code>2d6 + 3</code>, pick a die, or click any ⚄ Roll button or dice in a page.</p>';
}

function logRoll(entry) {
  state.rolls.unshift(entry);
  state.rolls.length = Math.min(state.rolls.length, 40);
  const tray = trayEl();
  tray.hidden = false;
  if (!tray.classList.contains('docked')) tray.dataset.wasOpen = '1';
  drawTray();
}

const lone20 = expr => { const p = G.parseDice(expr); return p && p.dice.length === 1 && p.dice[0].n === 1 && p.dice[0].d === 20; };

/**
 * The last damage, healing or condition rolled, for the battle rows' Auto buttons. `text` is the rules text the roll
 * came from (a stat block entry, a spell, an item or a trap), which says whether it heals and what condition it causes.
 */
function noteEffect(who, label, dmg, text = '', extra = {}) {
  const sp = G.spellInfo(state.data, label);
  const rules = `${text} ${sp ? `${sp.text || sp.summary || ''}` : ''}`;
  const condition = G.conditionIn(rules, sp?.duration || '');
  if (!dmg?.length && !condition) return;
  // Temporary hit points ("False Life (temp HP)", a feature that "gains 1d8 + 4 temporary hit points") aren't healing or damage.
  const temp = !!dmg?.length && (/\(temp HP/i.test(label) || (G.tempHpIn(label, rules) && !G.healsIn(label, text)));
  state.lastEffect = { who, label, dmg: dmg || [], heal: !temp && !!dmg?.length && G.healsIn(label, rules), temp, condition: temp ? null : condition, at: Date.now(), ...extra };
  if (state.view?.kind === 'battle') queueMicrotask(() => { if (state.view?.kind === 'battle') renderBattle(); });
}

/** The last roll stops offering itself to the battle rows: it was applied, the turn moved on or the battle ended. */
/** Compact battle rows (the default): a row shows its buttons only when it is selected or its turn. */
function compactRows() { try { return localStorage.getItem('b-compact') !== '0'; } catch { return true; } }
function disarmRoll() {
  state.lastEffect = null;
  if (state.rolls[0]) state.rolls[0].applied = true;
}
/** Is someone on the same side as the one who rolled (for a heal's default target)? */
const sameSide = (a, b) => (a.kind === 'monster') === (b.kind === 'monster');

function rollExpr(expr, label, who, text = '') {
  const r = G.rollDice(expr, Math.random, { mode: lone20(expr) ? state.rollMode : '' });
  if (!r) return toast(`"${expr}" isn't a dice roll. Try something like 2d6 + 3.`, true);
  const nat = r.natural === 20 ? ' (natural 20)' : r.natural === 1 ? ' (natural 1)' : '';
  const dmg = label === 'Damage' || (!lone20(expr) && label !== 'To hit');
  if (dmg) { state.lastDamage = r.total; noteEffect(who, label || r.expr, [{ total: r.total, type: '' }], text); }
  const heal = !!(dmg && state.lastEffect?.heal && state.lastEffect.label === (label || r.expr));
  const temp = !!(dmg && state.lastEffect?.temp && state.lastEffect.label === (label || r.expr));
  logRoll({ who, label: label || r.expr, heal, temp, dmg: dmg ? [{ total: r.total, type: '' }] : null, hit: lone20(expr) && label === 'To hit' ? r.total : null,
    lines: [{ text: `${r.expr}${nat}`, total: r.total, detail: G.rollBreakdown(r), cls: r.natural === 20 ? 'crit' : r.natural === 1 ? 'fumble' : '' }] });
}

const hitLine = (h, pre = '') => ({ text: `${pre}To hit${h.natural === 20 ? ': critical!' : h.natural === 1 ? ': natural 1' : ''}`, total: h.total, detail: G.rollBreakdown(h), cls: h.natural === 20 ? 'crit' : h.natural === 1 ? 'fumble' : '' });
const dmgLines = (x, pre = '') => x.damage.map(d => ({ text: `${pre}${d.type ? cap(d.type) : 'Damage'}${d.from ? ` (${d.from})` : ''}${x.crit ? ' (doubled dice)' : ''}`, total: d.total, detail: G.rollBreakdown(d) }));

/**
 * One attack roll as it lands on a target with a magic item that changes it: a cloak of displacement or a Spellguard
 * shield (against spell attacks) gives it disadvantage (the spare d20 is the second die), and adamantine armour turns a
 * critical hit into a normal one (the damage is rolled again without the doubled dice). Null when nothing changes.
 */
function fittedRoll(r, u, t) {
  const def = defencesFor(t);
  const dis = def && (r.spell ? def.spellAttackDisadv || def.attackDisadv : def.attackDisadv);
  if (!def || !u.base || (!dis && !def.critNormal)) return null;
  const nat0 = u.base.hit.natural, notes = [];
  let nat = nat0, dropped = u.base.hit.terms[0]?.dropped ?? null;
  if (dis) {
    // Disadvantage on top of advantage is a plain roll; on top of disadvantage it changes nothing.
    if (r.mode === 'adv') { nat = u.alt; dropped = null; }
    else if (r.mode !== 'dis') { nat = Math.min(nat0, u.alt); dropped = Math.max(nat0, u.alt); }
    notes.push({ from: dis, note: `${r.spell ? 'the spell attack' : 'the attack'} has disadvantage${nat !== nat0 ? ` (rolled ${nat} instead of ${nat0})` : ''}` });
  }
  const crit = nat === 20 && !def.critNormal;
  if (nat === 20 && def.critNormal) notes.push({ from: def.critNormal, note: 'the critical hit is a normal hit' });
  const [first, ...rest] = u.base.hit.terms;
  const hit = { ...u.base.hit, terms: [{ ...first, rolls: [nat], dropped, sum: nat }, ...rest], natural: nat, total: u.base.hit.total - nat0 + nat, crit };
  // Damage rolled again only when the critical changes.
  const damage = crit === (nat0 === 20) ? u.base.damage : (u.refit ||= {})[`${t.id}:${crit}`] ||= r.atk.damage.map(d => ({ ...G.rollDice(d.expr, Math.random, { crit }), type: d.type, ...(d.from ? { from: d.from } : {}) }));
  return { hit, crit, damage, notes };
}
/**
 * Fit the latest attack roll to the target it's applied to (see fittedRoll): its to-hit, damage and tray lines follow,
 * and going back to a target without such an item restores the roll as it was. True when an item changed it.
 */
function fitToTarget(r, t) {
  if (!r?.base || r.parts || !t || r.fitFor === t.id) return !!r?.itemFx?.length && r.fitFor === t?.id;
  const f = fittedRoll(r, r, t);
  const hit = f ? f.hit : r.base.hit, damage = f ? f.damage : r.base.damage, crit = f ? f.crit : r.base.hit.natural === 20;
  r.fitFor = t.id;
  r.itemFx = f?.notes || [];
  r.hit = hit.total; r.nat = hit.natural; r.noCrit = hit.natural === 20 && !crit;
  r.dmg = damage.length ? damage.map(d => ({ total: d.total, type: d.type })) : null;
  const keep = r.lines.filter(l => l.cls !== 'item-fx' && !/^To hit/.test(l.text) && !l.dmgLine && l.cls !== 'sum');
  const total = damage.reduce((a, d) => a + d.total, 0);
  r.lines = [hitLine(hit), ...keep, ...dmgLines({ damage, crit }).map(l => ({ ...l, dmgLine: true })),
    ...r.itemFx.map(x => ({ text: `✦ ${t.name}'s ${x.from}: ${x.note}`, total: '', detail: '', cls: 'item-fx' })),
    ...(damage.length > 1 ? [{ text: 'Total damage', total, detail: '', cls: 'sum' }] : [])];
  if (state.lastEffect?.roll === r) Object.assign(state.lastEffect, { dmg: r.dmg || [], nat: r.nat });
  return !!r.itemFx.length;
}
/** The same for one beam or ray of a roll, aimed at its own target. */
function fitPart(r, i, t) {
  const p = r.parts[i];
  if (!p?.base || p.fitFor === t.id) return p?.itemFx || [];
  const f = fittedRoll(r, p, t);
  const hit = f ? f.hit : p.base.hit, damage = f ? f.damage : p.base.damage;
  Object.assign(p, { fitFor: t.id, itemFx: f?.notes || [], hit: hit.total, nat: hit.natural, dmg: damage.map(d => ({ total: d.total, type: d.type })) });
  return p.itemFx;
}

function rollAttackEntry(atk, who, text = '', { ai = false } = {}) {
  const me = battle().list.find(x => x.name === who);
  const sp = G.spellInfo(state.data, atk.name);
  // Spells on the attacker that add damage to weapon hits (crusader's mantle, divine favor) roll with the hit.
  const buffs = me && !sp && atk.toHit != null ? (me.conditions || []).filter(k => k.buff?.dmg) : [];
  if (buffs.length) atk = { ...atk, damage: [...(atk.damage || []), ...buffs.map(k => ({ expr: k.buff.dmg, type: k.buff.type || '', from: k.name }))] };
  // Casting a concentration spell in a battle: the caster is concentrating on it now.
  if (me && sp?.concentration) startConcentration(me, sp);
  const ranged = /\branged (?:weapon |spell )?attack/i.test(text) || !!atk.ranged;
  // Mounted Combatant: a rider's melee attack on an unmounted creature smaller than its mount has advantage.
  const aimed = battle().list.find(x => x.id === state.applyTarget), steed = me?.ride && byId(me.ride);
  const strike = !!steed && !sp && atk.toHit != null && !ranged && hasMountedCombatant(me) && !!aimed && aimed !== me && aimed !== steed && !aimed.ride
    && SU.sizeRank(sizeOfC(aimed)) < SU.sizeRank(sizeOfC(steed)) && /\bMelee\b/i.test(text);
  const rollMode = strike ? (state.rollMode === 'dis' ? '' : 'adv') : state.rollMode;
  const a = G.rollAttack(atk, Math.random, rollMode);
  const lines = [];
  if (strike) lines.push({ text: `Mounted Strike: advantage against ${aimed.name}${state.rollMode === 'dis' ? ' (cancels the disadvantage)' : ''}`, total: '', detail: '', cls: 'note' });
  const kind = cap(atk.kind || 'part');
  if (a.parts) a.parts.forEach((x, i) => { if (x.hit) lines.push(hitLine(x.hit, `${kind} ${i + 1}: `)); lines.push(...dmgLines(x, x.hit ? '' : `${kind} ${i + 1}: `)); });
  else if (a.hit) lines.push(hitLine(a.hit));
  if (a.save) lines.push({ text: `DC ${a.save.dc} ${a.save.ability} save`, total: '', detail: '' });
  if (!a.parts) lines.push(...dmgLines(a).map(l => ({ ...l, dmgLine: true })));
  if (a.damage.length > 1) lines.push({ text: a.parts ? `Total if all ${atk.kind || 'part'}s hit` : 'Total damage', total: a.total, detail: '', cls: 'sum' });
  if (a.damage.length) state.lastDamage = a.total;
  // Saves: half damage on a success when the text says so, and how many creatures it can catch (null: an area).
  const area = atk.area ?? /\b(cone|line|sphere|cube|cylinder|radius|each creature)\b/i.test(text);
  const save = a.save ? { ...a.save, half: a.save.half ?? /half as much/i.test(text) } : null;
  // Each attack roll keeps a spare d20, for a target whose magic item gives the attack disadvantage (see fitToTarget).
  const spare = () => 1 + Math.floor(Math.random() * 20);
  const parts = a.parts?.map(x => ({ hit: x.hit?.total ?? null, nat: x.hit?.natural, dmg: x.damage.map(d => ({ total: d.total, type: d.type })), ...(x.hit ? { alt: spare(), base: { hit: x.hit, damage: x.damage } } : {}) }));
  const entry = { who, label: atk.slot ? `${atk.name} (level ${atk.slot})` : atk.name, lines, dmg: a.damage.length ? a.damage.map(d => ({ total: d.total, type: d.type })) : null, hit: a.hit?.total ?? null, nat: a.hit?.natural, save,
    parts, kind: atk.kind || '', maxTargets: save && area ? null : Number(atk.targets) || 1, spell: !!G.spellInfo(state.data, atk.name), byAi: ai, ranged,
    ...(a.hit ? { atk, mode: rollMode, alt: spare(), base: { hit: a.hit, damage: a.damage } } : {}) };
  logRoll(entry);
  noteEffect(who, atk.name, a.damage.map(d => ({ total: d.total, type: d.type })), text, { nat: a.hit?.natural, miss: !!a.miss, roll: entry });
  // In a battle, using a recharge ability or a legendary action spends it.
  const c = battle().list.find(x => x.name === who);
  if (!c) return;
  const t = a.damage.length || a.hit ? battle().list.find(x => x.id === state.applyTarget) : null;
  if (t && t !== c && state.view?.kind === 'battle') {
    fx('attack', { id: t.id, from: c.id, fkind: c.kind });
    if (a.hit && (a.hit.natural === 1 || (a.hit.natural !== 20 && a.hit.total < t.ac))) fx('tag', { id: t.id, text: a.hit.natural === 1 ? 'Fumble' : 'Miss', tone: 'miss' });
  }
  const rech = c.recharge?.[atk.name];
  if (rech?.ready) { c.recharge[atk.name] = { ...rech, ready: false }; battleLog(`${c.name} uses ${atk.name.replace(/\s*\(Recharge.*\)/i, '')}.`); }
  if (atk.section === 'legendary' && c.legendary) c.legendaryUsed = Math.min(c.legendary, (c.legendaryUsed || 0) + (Number(String(atk.name).match(/Costs (\d+) Actions?/i)?.[1]) || 1));
  saveBattle();
  if (state.view?.kind === 'battle') renderBattle();
}

/**
 * What a combatant's magic items do against attacks on them: a party member's working equipped and worn items, or an
 * NPC's attuned ones. Null when they have none that matter.
 */
function defencesFor(c) {
  const p = c?.page && state.pages.get(c.page);
  if (!p) return null;
  const items = p.meta.type === 'pc' ? S.wornItems(state.data, p.meta)
    : [].concat(p.meta.attuned || []).map(n => ({ item: G.itemInfo(state.data, n), choice: p.meta.attuneChoice?.[n] })).filter(x => x.item);
  return items.length ? S.defencesOf(items) : null;
}
/** Say that someone's magic item changed what happened: a line in the battle log and a tag over their row. */
function itemFxNote(c, items) {
  const seen = [...new Map((items || []).map(x => [`${x.from}|${x.note}`, x])).values()];
  if (!c || !seen.length) return;
  battleLog(`${c.name}'s ${listJoin([...new Set(seen.map(x => x.from))])}: ${listJoin([...new Set(seen.map(x => x.note))])}.`);
  [...new Set(seen.map(x => x.from))].forEach((from, i) => fx('tag', { id: c.id, text: `✦ ${from}`, tone: 'item' }, 450 + i * 500));
}

// What a roll would do to a target: each damage line after resistances (the stat block's and magic items') and the rank ward.
function damageFor(r, target) {
  const set = bSettings();
  const attacker = battle().list.find(c => c.name === r.who);
  const stat = target.kind === 'monster' ? statFor(target) : null;
  const notes = [], items = [];
  const def = set.auto.resistances ? defencesFor(target) : null;
  const spellName = String(r.label || '').replace(/ \(level \d+\)$/, '').toLowerCase();
  const isSpell = r.spell ?? r.roll?.spell ?? !!G.spellInfo(state.data, spellName), ranged = r.ranged ?? r.roll?.ranged;
  let total = 0;
  for (const d of r.dmg) {
    let mult = 1;
    if (set.auto.resistances && stat) {
      const m = G.damageMultiplier(stat, d.type);
      if (m.note) notes.push(m.note);
      mult = m.mult;
    }
    if (def) {
      const t = String(d.type || '').toLowerCase();
      const find = k => def[k].find(x => t && x.x === t);
      const note = (from, n) => { items.push({ from, note: n }); notes.push(`${from}: ${n}`); };
      const imm = (isSpell && def.spellImmune.find(x => x.x === spellName)) || find('immune');
      const res = find('resist') || def.resist.find(x => x.x === '*') || (!isSpell && def.resist.find(x => x.x === 'nonmagical'))
        || (ranged && !isSpell && def.rangedResist ? { from: def.rangedResist } : null);
      const vul = find('vuln');
      if (imm && mult) { note(imm.from, imm.x === spellName ? `immune to ${r.label}` : `immune to ${t}`); mult = 0; }
      else if (mult) {
        // Resistance and vulnerability don't stack with the same from the stat block, and cancel each other out.
        if (res && mult !== 0.5) { note(res.from, `resists ${res.x === '*' || res.x === 'nonmagical' || !res.x ? (res.x === 'nonmagical' ? 'nonmagical damage' : 'the damage') : t}`); mult = mult === 2 ? 1 : 0.5; }
        if (vul && mult !== 2) { note(vul.from, `vulnerable to ${t}`); mult = mult === 0.5 ? 1 : 2; }
      }
    }
    if (set.rankWard !== 'off' && attacker && G.rankWardApplies(rankOf(attacker), rankOf(target))) {
      notes.push(`rank ward: ${rankOf(target)} rank resists ${G.aOrAn(rankOf(attacker))} ${rankOf(attacker)}-rank attacker`);
      if (set.rankWard === 'auto') mult = G.rankWardMultiplier(mult);
    }
    total += Math.floor(d.total * mult);
  }
  return { total, notes: [...new Set(notes)], items };
}

/**
 * A target's saving throw against a roll, from its stat block, with advantage for magic resistance. Party members
 * roll their own: theirs waits (pending) until the DM sets it, with their sheet's bonus as a reminder.
 */
function rollSave(r, t) {
  const ab = String(r.save.ability).slice(0, 3).toUpperCase();
  const stat = t.kind === 'pc' ? null : statFor(t);
  const meta = t.kind === 'pc' ? state.pages.get(t.page)?.meta : null;
  const bonus = meta ? S.saveBonus(meta, ab) : G.saveBonusOf(stat, ab);
  // A spell against someone with a Spellguard shield or a mantle of spell resistance: they save with advantage.
  const item = r.spell ? defencesFor(t)?.spellSaveAdv : null;
  if (t.kind === 'pc') return { pending: true, bonus, pc: true, ...(item ? { adv: true, item } : {}) };
  const adv = !!item || (r.spell && (stat?.traits || []).some(x => /magic resistance/i.test(x.name)));
  const roll = G.rollDice({ dice: [{ n: 1, d: 20, sign: 1 }], mod: bonus }, Math.random, { mode: adv ? 'adv' : '' });
  return { total: roll.total, bonus, detail: G.rollBreakdown(roll), pass: roll.total >= r.save.dc, adv, pc: !!meta, ...(item ? { item } : {}) };
}
/** Whether one beam, ray or attack hits a target: darts always do. */
const partHits = (p, t) => p.hit == null || p.nat === 20 || (p.nat !== 1 && p.hit >= t.ac);
/**
 * What the latest roll does to someone it was aimed at: the damage of each beam that hits them, or their saving
 * throw's outcome (full, half or nothing). Null for anyone it wasn't aimed at.
 */
function effectOn(r, t) {
  if (!r?.targets?.includes(t.id)) return null;
  if (r.parts) {
    const mine = r.parts.filter((_, i) => r.targets[i] === t.id);
    const hits = mine.filter(p => partHits(p, t));
    const outs = hits.map(p => damageFor({ dmg: p.dmg, who: r.who, spell: r.spell, label: r.label, ranged: r.ranged }, t));
    return { n: outs.reduce((a, o) => a + o.total, 0), hits: hits.length, of: mine.length, crit: hits.some(p => p.nat === 20), items: [...mine.flatMap(p => p.fitFor === t.id ? p.itemFx || [] : []), ...outs.flatMap(o => o.items)] };
  }
  if (!r.save) return null;
  const sv = r.saves?.[t.id];
  if (!sv || sv.pending) return null;
  // An attack with a save for its rider: the hit deals the damage, and the save only decides the condition.
  if (r.hit != null) return { failed: !sv.pass, save: sv };
  const d = r.dmg ? damageFor(r, t) : { total: 0, items: [] };
  // Leap Aside (Mounted Combatant): a mount whose rider has the feat takes nothing on a Dexterity save it makes for half, and half if it fails.
  const leap = r.save.half && /^dex/i.test(r.save.ability) && ridersOf(t).some(x => x.hp > 0 && hasMountedCombatant(x) && !x.conditions.some(k => /^(Incapacitated|Paralyzed|Stunned|Unconscious|Petrified)$/.test(k.name)));
  return { n: sv.pass ? (r.save.half && !leap ? Math.floor(d.total / 2) : 0) : leap ? Math.floor(d.total / 2) : d.total, failed: !sv.pass, save: sv, items: d.items, ...(leap ? { leap: true } : {}) };
}
function applyBar(r) {
  const b = battle();
  // A roll from an earlier turn keeps its dice in the tray, but not its targets and Apply buttons.
  if ((!r.dmg && !r.save) || !b.list.length || r.stale) return '';
  const living = G.battleOrder(b.list).filter(c => c.kind !== 'lair' && (r.heal || r.temp || c.name !== r.who)).sort((a, c) => r.heal ? 0 : (a.hp <= 0) - (c.hp <= 0)); // downed ones last, except for a heal
  if (!living.length) return '';
  const attacker = b.list.find(c => c.name === r.who);
  let target = r.target ? living.find(c => c.id === r.target) : null;
  // Temporary hit points: to whoever rolled them ("you gain"), else the picked one on their side.
  if (!target && r.temp) target = living.find(c => c.name === r.who) || living.find(c => c.id === state.applyTarget && (!attacker || sameSide(c, attacker)));
  // Healing goes to the most hurt person on the healer's side; anything else to the picked or obvious enemy.
  if (!target && r.heal) {
    const me = attacker || { kind: 'pc' };
    target = G.battleOrder(b.list).filter(c => c.kind !== 'lair' && sameSide(c, me) && c.hpMax).sort((x, y) => x.hp / x.hpMax - y.hp / y.hpMax)[0];
  }
  if (!target) target = living.find(c => c.id === state.applyTarget);
  if (!target) target = living.find(c => c.id === b.sel) || living.find(c => attacker?.kind === 'monster' ? c.kind === 'pc' && c.hp > 0 : c.kind === 'monster' && c.hp > 0) || living[0];
  state.applyTarget = r.target = target.id;
  if (!r.parts && r.hit != null) fitToTarget(r, target);
  const options = (sel, skip = []) => living.filter(c => c.id === sel || !skip.includes(c.id)).map(c => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.name)}${c.hp <= 0 ? ' (down)' : ''}</option>`).join('');
  const isLiving = id => living.some(c => c.id === id);
  // The battle plan deals out its own beams and saves.
  if (r.byAi && (r.parts || r.save)) return '<div class="dt-apply"><div class="dt-apply-note">The battle plan above deals this out.</div></div>';
  const ender = r.allSaved && b.list.find(c => c.id === r.allSaved && c.conditions?.some(k => k.name === 'Concentrating'));
  const done = r.applied ? `<div class="dt-apply-note">Applied.${ender ? ` Everyone saved, so ${esc(r.label)} does nothing now. <button class="btn small" data-conc-end="${ender.id}">End ${esc(ender.name)}'s concentration</button>` : ''}</div>` : '';
  const applyBtn = n => state.view?.kind === 'battle' && !r.applied ? `<div class="row"><button class="btn small danger" data-apply="targets" title="Deal each target what the roll does to them, and add the condition to anyone who failed">Apply to ${n === 1 ? 'the target' : `${n} targets`}</button></div>` : '';
  // Beams, rays and darts: each picks its own target and hits or misses on its own.
  if (r.parts) {
    r.targets = r.parts.map((_, i) => isLiving(r.targets?.[i]) ? r.targets[i] : target.id);
    const rows = r.parts.map((p, i) => {
      const t = living.find(c => c.id === r.targets[i]);
      const itemNotes = fitPart(r, i, t);
      const vs = p.hit == null ? 'hits' : p.nat === 20 ? 'critical hit' : p.nat === 1 ? 'misses' : p.hit >= t.ac ? `hits AC ${t.ac}` : `misses AC ${t.ac}`;
      const n = partHits(p, t) ? damageFor({ dmg: p.dmg, who: r.who }, t).total : 0;
      return `<div class="row dt-part"><span class="dt-part-n">${esc(cap(r.kind || 'part'))} ${i + 1}</span><select data-part="${i}" title="Who this ${esc(r.kind || 'part')} is aimed at">${options(t.id)}</select>
        <span class="dt-vs ${/miss/.test(vs) ? 'miss' : 'hit'}">${esc(vs)}${n ? `, ${n}` : ''}</span>${itemNotes.map(x => `<span class="item-fx" title="${esc(`${t.name}'s ${x.from}: ${x.note}`)}">✦ ${esc(x.from)}</span>`).join('')}</div>`;
    }).join('');
    return `<div class="dt-apply">${rows}${done}${applyBtn(new Set(r.targets).size)}</div>`;
  }
  // A saving throw: each target rolls it from their stat block (players roll their own), and the DM can flip any result.
  const saveChip = (id, sv) => sv.pending
    ? `<button class="chip dt-save pending" data-flip="${id}" title="${esc(`They roll their own save (${sv.bonus >= 0 ? '+' : '−'}${Math.abs(sv.bonus)} on their sheet${sv.item ? `, with advantage from their ${sv.item}` : ''}). Click to set whether they failed or saved.`)}">${sv.bonus >= 0 ? '+' : '−'}${Math.abs(sv.bonus)}${sv.item ? ' with advantage' : ''} · player rolls</button>${sv.item ? `<span class="item-fx" title="${esc(`${sv.item}: advantage on saves against spells`)}">✦ ${esc(sv.item)}</span>` : ''}`
    : `<button class="chip dt-save ${sv.pass ? 'pass' : 'fail'}" data-flip="${id}" title="${esc(sv.pc ? 'Set from the player\'s roll. Click to flip.' : `d20${sv.adv ? ` with advantage (${sv.item || 'magic resistance'})` : ''} ${sv.bonus >= 0 ? '+' : '−'} ${Math.abs(sv.bonus)}: ${sv.detail}. Click to flip.`)}">${sv.pc ? '' : `${sv.total} · `}${sv.pass ? 'saves' : 'fails'}</button>${sv.item ? `<span class="item-fx" title="${esc(`${sv.item}: advantage on saves against spells`)}">✦ ${esc(sv.item)}</span>` : ''}`;
  if (r.save && r.hit == null) {
    r.targets = (r.targets || [target.id]).filter(isLiving);
    if (!r.targets.length) r.targets = [target.id];
    r.saves ||= {};
    for (const id of r.targets) r.saves[id] ||= rollSave(r, living.find(c => c.id === id));
    const rows = r.targets.map((id, i) => {
      const t = living.find(c => c.id === id), sv = r.saves[id], out = effectOn(r, t);
      return `<div class="row dt-save-row"><select data-tgt="${i}" title="Who makes the save">${options(id, r.targets)}</select>
        ${saveChip(id, sv)}
        <span class="dt-vs ${out?.n ? 'hit' : 'miss'}">${sv.pending ? '' : r.dmg ? out?.n ? `takes ${out.n}` : 'no damage' : sv.pass ? 'unaffected' : 'affected'}</span>
        ${r.targets.length > 1 ? `<button class="link-btn" data-untarget="${i}" title="Take ${esc(t.name)} out of it">×</button>` : ''}</div>`;
    }).join('');
    const more = r.maxTargets == null || r.targets.length < r.maxTargets;
    const left = living.filter(c => !r.targets.includes(c.id));
    const add = more && left.length ? `<div class="row"><select data-add-target title="Someone else caught by it"><option value="">+ ${r.maxTargets == null ? 'Someone else in the area' : `Another target (up to ${r.maxTargets})`}</option>${left.map(c => `<option value="${c.id}">${esc(c.name)}${c.hp <= 0 ? ' (down)' : ''}</option>`).join('')}</select>
      ${r.maxTargets == null ? `<button class="chip" data-add-side title="Everyone on the other side who is still standing">+ All ${attacker?.kind === 'monster' ? 'of the party' : 'enemies'}</button>` : ''}</div>` : '';
    const waiting = r.targets.some(id => r.saves[id].pending);
    return `<div class="dt-apply"><div class="dt-apply-note">DC ${r.save.dc} ${esc(r.save.ability)} save${r.save.half && r.dmg ? ', half damage on a success' : ''}.</div>${rows}${add}${done}${waiting ? '<div class="dt-apply-note">Set each player\'s save to apply it.</div>' : applyBtn(r.targets.length)}</div>`;
  }
  const raw = (r.dmg || []).reduce((a, d) => a + d.total, 0);
  if (r.temp) return `<div class="dt-apply">
    <div class="row"><select id="dt-target" title="Who gains them">${options(target.id)}</select></div>
    ${target.temp > 0 ? `<div class="dt-apply-note">${esc(target.name)} has ${target.temp} temporary hit points already. They don't stack: ${target.temp >= raw ? 'they keep those' : `the ${raw} replace them`}.</div>` : ''}
    ${r.applied ? done : state.view?.kind === 'battle' ? `<div class="row"><button class="btn small good" data-apply="one" title="Give ${esc(target.name)} the temporary hit points (Enter)">Give ${esc(target.name)} ${raw} temp HP <kbd>Enter</kbd></button></div>` : '<div class="dt-apply-note">In a battle, Apply gives them to the target.</div>'}
  </div>`;
  const auto = damageFor({ ...r, dmg: r.dmg || [] }, target);
  const vs = r.hit != null ? (r.nat === 20 ? (r.noCrit ? 'hits (not a critical)' : 'critical hit') : r.nat === 1 ? 'misses' : r.hit >= target.ac ? `hits AC ${target.ac}` : `misses AC ${target.ac}`) : '';
  // A hit with a save on top (a ghoul's paralysing claws): the target's save decides the condition.
  let rider = '';
  if (r.save) {
    r.targets = [target.id];
    r.saves ||= {};
    r.saves[target.id] ||= rollSave(r, target);
    rider = `<div class="row dt-save-row"><span class="dt-apply-note">On a hit, DC ${r.save.dc} ${esc(r.save.ability)} save:</span>${saveChip(target.id, r.saves[target.id])}</div>`;
  }
  return `<div class="dt-apply">
    <div class="row"><select id="dt-target" title="Who takes it">${options(target.id)}</select>
      ${vs ? `<span class="dt-vs ${/miss/.test(vs) ? 'miss' : 'hit'}">${esc(vs)}</span>` : ''}</div>${rider}
    ${auto.notes.length ? `<div class="dt-apply-note">${auto.notes.map(esc).join('; ')}</div>` : ''}
    ${r.applied ? done : state.view?.kind === 'battle' ? `<div class="row"><button class="btn small ${r.heal ? 'good' : 'danger'}" data-apply="one" title="${r.heal ? 'Heal' : 'Deal'} it to ${esc(target.name)} (Enter)">${r.heal ? `Heal ${esc(target.name)} +${raw}` : r.hit != null && !(r.nat === 20 || (r.nat !== 1 && r.hit >= target.ac)) ? `Missed: apply anyway (${auto.total})` : `Apply ${auto.total} to ${esc(target.name)}`} <kbd>Enter</kbd></button></div>${auto.total !== raw && !r.heal ? `<div class="dt-apply-note">${raw} before resistances.</div>` : ''}` : '<div class="dt-apply-note">In a battle, Apply deals it to the target.</div>'}
  </div>`;
}

/** The rules text a roll was clicked in: its stat block entry, spell card, item, or the line of a page. */
const rulesAround = el => (el.closest('.sb-entry') || el.closest('#spell-pop, .browser-detail, .detail') || el.closest('li, p, td'))?.textContent || '';

/** After the tray's targets change: the battle rows' Auto buttons follow. */
const trayChanged = () => { if (state.view?.kind === 'battle') renderBattle(); else drawTray(); };
/** The tray's target pickers: who each beam is aimed at, who makes the save, and flipping a save's result. */
function trayTargets(e) {
  const r = state.rolls[0];
  const el = e.target;
  if (!r) return false;
  if (el.dataset.part != null) r.targets[Number(el.dataset.part)] = el.value;
  else if (el.dataset.tgt != null) { r.targets[Number(el.dataset.tgt)] = el.value; }
  else if (el.matches('[data-add-target]')) { if (el.value) r.targets.push(el.value); }
  else if (el.closest('[data-flip]')) { const sv = r.saves?.[el.closest('[data-flip]').dataset.flip]; if (sv) { sv.pass = sv.pending ? false : !sv.pass; sv.pending = false; } }
  else if (el.closest('[data-untarget]')) r.targets.splice(Number(el.closest('[data-untarget]').dataset.untarget), 1);
  else if (el.closest('[data-add-side]')) {
    const attacker = battle().list.find(c => c.name === r.who);
    const side = battle().list.filter(c => c.hp > 0 && c.name !== r.who && c.kind !== 'lair' && (attacker?.kind === 'monster' ? c.kind === 'pc' || c.kind === 'other' : c.kind === 'monster'));
    for (const c of side) if (!r.targets.includes(c.id)) r.targets.push(c.id);
  } else return false;
  r.applied = false;
  trayChanged();
  return true;
}

function applyFromTray(how) {
  const r = state.rolls[0];
  const b = battle();
  if (how === 'targets') return applyToTargets(r);
  if (how === 'one') return applyToOne(r);
  const c = b.list.find(x => x.id === state.applyTarget);
  if (!r?.dmg || !c) return;
  const raw = r.dmg.reduce((a, d) => a + d.total, 0);
  const n = how === 'auto' ? damageFor(r, c).total : how === 'half' ? Math.floor(raw / 2) : raw;
  changeHp(c, how === 'heal' ? -n : n, r.who ? `${r.who}'s ${r.label}` : r.label, { crit: how !== 'heal' && r.nat === 20 });
  saveBattle();
  if (state.view?.kind === 'battle') renderBattle(); else drawTray();
}
/** Deal (or heal) the latest single-target roll to its target, with its condition when the target failed or had no save. */
function applyToOne(r) {
  const b = battle();
  const c = r && !r.applied && b.list.find(x => x.id === (r.target || state.applyTarget));
  if (!c || !r.dmg) return;
  const src = r.who ? `${r.who}'s ${r.label}` : r.label;
  if (r.temp) giveTemp(c, r.dmg.reduce((a, d) => a + d.total, 0), src);
  else if (r.heal) changeHp(c, -r.dmg.reduce((a, d) => a + d.total, 0), src);
  else {
    const d = damageFor(r, c), n = d.total;
    if (n) changeHp(c, n, src, { crit: r.nat === 20 && !r.noCrit });
    itemFxNote(c, [...(r.fitFor === c.id ? r.itemFx || [] : []), ...d.items]);
    const k = state.lastEffect?.roll === r ? state.lastEffect.condition : null;
    const sv = r.saves?.[c.id];
    if (k && c.hp > 0 && !(sv && (sv.pass || sv.pending)) && !c.conditions.some(x => x.name === k.name) && !condBlocked(c, k.name)) {
      c.conditions.push({ name: k.name, rounds: k.rounds, ends: k.ends, ...concLink(r.who, r.label) });
      battleLog(`${c.name} is ${k.name.toLowerCase()}${k.rounds ? ` for ${k.rounds} round${k.rounds > 1 ? 's' : ''}` : ''} (${src}).`, true);
    }
  }
  r.applied = true;
  state.lastEffect = null;
  saveBattle();
  trayChanged();
}
/** Deal each target what the latest roll does to them; anyone who failed the save gets its condition too. */
function applyToTargets(r) {
  if (!r?.targets?.length || r.applied) return;
  const b = battle();
  const src = r.who ? `${r.who}'s ${r.label}` : r.label;
  const k = state.lastEffect?.roll === r ? state.lastEffect.condition : null;
  for (const id of [...new Set(r.targets)]) {
    const t = b.list.find(x => x.id === id);
    const out = t && effectOn(r, t);
    if (!out) continue;
    if (out.save) battleLog(`${t.name} ${out.save.pass ? 'saves' : 'fails'} the DC ${r.save.dc} ${r.save.ability} save${out.save.total != null ? ` (${out.save.total})` : out.save.pc ? ' (player\'s roll)' : ''}${out.save.item ? ` with advantage from their ${out.save.item}` : ''} against ${src}.`);
    if (out.save?.item) fx('tag', { id: t.id, text: `✦ ${out.save.item}`, tone: 'item' }, 450);
    if (r.parts && !out.hits) { battleLog(`${src} misses ${t.name}${out.of > 1 ? ` with all ${out.of} ${r.kind}s` : ''}.`); fx('tag', { id: t.id, text: 'Miss', tone: 'miss' }); itemFxNote(t, out.items); continue; }
    if (out.n) changeHp(t, out.n, r.parts && out.of > 1 ? `${src} (${out.hits} of ${out.of} ${r.kind}s hit)` : src, { crit: !!out.crit, saved: !!out.save?.pass });
    else if (out.save) fx('tag', { id: t.id, text: out.save.pass ? 'Saved' : 'Failed', tone: out.save.pass ? 'save' : 'fail' });
    if (r.dmg && (out.n || !out.save?.pass)) itemFxNote(t, out.items);
    if (k && out.failed && t.hp > 0 && !t.conditions.some(x => x.name === k.name) && !condBlocked(t, k.name)) {
      t.conditions.push({ name: k.name, rounds: k.rounds, ends: k.ends, ...concLink(r.who, r.label) });
      battleLog(`${t.name} is ${k.name.toLowerCase()}${k.rounds ? ` for ${k.rounds} round${k.rounds > 1 ? 's' : ''}` : ''} (${src}).`, true);
    }
  }
  r.applied = true;
  state.lastEffect = null;
  // A concentration spell that missed everyone (hold person, all saved): offer to end it, since it does nothing now.
  const caster = b.list.find(x => x.name === r.who), sp = G.spellInfo(state.data, String(r.label || '').replace(/ \(level \d+\)$/, ''));
  const conc = caster?.conditions?.find(x => x.name === 'Concentrating' && x.spell === sp?.name);
  if (conc && !r.dmg && r.targets.every(id => r.saves?.[id]?.pass)) r.allSaved = caster.id;
  saveBattle();
  trayChanged();
}

/** A concentration spell's condition (hold person's paralysis) ends when the caster's concentration does: the fields that tie it to them. */
function concLink(who, label) {
  const caster = battle().list.find(x => x.name === who), sp = G.spellInfo(state.data, String(label || '').replace(/ \(level \d+\)$/, ''));
  return caster && sp?.concentration ? { from: caster.id, spell: sp.name, conc: true } : {};
}
/** A condition someone can't get: their magic item (a periapt of proof against poison) or stat block makes them immune. Says so. */
function condBlocked(c, name) {
  const item = defencesFor(c)?.condImmune.find(x => x.x.toLowerCase() === String(name).toLowerCase());
  const stat = !item && c.kind !== 'pc' && new RegExp(`\\b${name}`, 'i').test(String(statFor(c)?.conditionImmune || '').replace(/paralysed/i, 'paralyzed'));
  if (item) itemFxNote(c, [{ from: item.from, note: `immune to being ${name.toLowerCase()}` }]);
  else if (stat) { battleLog(`${c.name} is immune to being ${name.toLowerCase()}.`); fx('tag', { id: c.id, text: 'Immune', tone: 'miss' }); }
  return !!(item || stat);
}
/** The latest roll's outcome on someone it was aimed at (their save, the beams that hit them), else null. */
const autoOutcome = (ef, c) => !ef?.heal && ef?.roll && !ef.roll.byAi && state.rolls[0] === ef.roll ? effectOn(ef.roll, c) : null;
/** What a row's Auto button deals: the roll's outcome on them when it was aimed at them, else all of it after resistances. */
function autoAmount(ef, c) {
  if (ef.heal || ef.temp) return ef.dmg.reduce((a, d) => a + d.total, 0);
  return autoOutcome(ef, c)?.n ?? damageFor(ef, c).total;
}
// The damage and healing steps on each battle row.
const HP_STEPS = [25, 10, 5, 1];
/** A row's one-click buttons: the last damage or healing rolled, and the condition the last attack caused. */
function autoButtons(c) {
  const ef = state.lastEffect;
  const src = ef ? `${ef.who ? `${ef.who}'s ` : ''}${ef.label}` : '';
  let dmg = '<button class="btn small" data-auto disabled title="Roll some damage or healing first">Auto</button>';
  const out = autoOutcome(ef, c);
  // Damage isn't offered to the one who rolled it or to someone already down.
  if (ef?.temp && ef.dmg.length) {
    const n = autoAmount(ef, c);
    dmg = c.hp <= 0 ? `<button class="btn small" data-auto disabled title="${esc(c.name)} is down">Auto</button>`
      : `<button class="btn small good" data-auto title="${esc(`Give the temporary hit points: ${src}${c.temp >= n ? ` (they have ${c.temp} already, and they don't stack)` : ''}`)}">Auto +${n} temp</button>`;
  } else if (ef?.dmg.length && !ef.heal && (c.hp <= 0 || c.name === ef.who)) dmg = `<button class="btn small" data-auto disabled title="${c.hp <= 0 ? `${esc(c.name)} is down` : 'Their own roll'}">Auto</button>`;
  else if (ef?.dmg.length) {
    const raw = ef.dmg.reduce((a, d) => a + d.total, 0);
    const n = autoAmount(ef, c);
    const why = out?.save ? ` (${out.save.pass ? 'saved' : 'failed the save'})` : out?.of ? ` (${out.hits} of ${out.of} ${ef.roll.kind}s hit)` : !ef.heal && n !== raw ? ` (${raw} before resistances)` : '';
    dmg = `<button class="btn small ${ef.heal ? 'good' : 'danger'}" data-auto title="${esc(`${ef.heal ? 'Heal' : 'Deal'} the last roll: ${src}${why}`)}">Auto ${ef.heal ? '+' : '−'}${n}</button>`;
  }
  const k = ef?.condition;
  const caster = ef?.who && state.saved.battle?.list.find(x => x.name === ef.who);
  // A condition the caster's side inflicts isn't offered to their own allies (Bless-type spells have their own dialog).
  const cond = k && caster && caster !== c && sameSide(caster, c) ? `<button class="btn small" data-lastcond disabled title="${esc(`${c.name} is on ${ef.who}'s side`)}">+ ${esc(k.name)}</button>`
    : k && out?.save?.pass ? `<button class="btn small" data-lastcond disabled title="${esc(`${c.name} saved against ${src}`)}">+ ${esc(k.name)}</button>`
    : k ? `<button class="btn small" data-lastcond title="${esc(`From ${src}${k.note ? `; ${k.note}` : ''}`)}">+ ${esc(k.name)}${k.rounds ? ` ${k.rounds} rd${k.rounds > 1 ? 's' : ''}` : ''}</button>`
    : '<button class="btn small" data-lastcond disabled title="The last attack caused no condition">+ Last condition</button>';
  return dmg + cond;
}

// ---------- battle ----------
// The battle screen: everyone in initiative order with AC and HP, whose turn it is, and the round. Turns run
// themselves (conditions run out, recharges roll, legendary actions come back), damage can come straight from
// a roll, and a finished battle goes into the session notes. It is kept with the campaign, so a fight can be
// paused and picked up again, and a second window can show the players the turn order.

/** While the first turn of a battle is still going, the turn belongs to whoever is now top of the initiative order. */
function backToTop() {
  const b = battle();
  if (!b.turn || !b.firstTurn || Number(b.round) > 1) return;
  const skip = bSettings().auto.skipDefeated;
  const top = G.battleOrder(b.list).find(c => !(skip && c.kind === 'monster' && Number(c.hp) <= 0));
  if (top) b.turn = top.id;
}

function battle() {
  const b = (state.saved.battle ||= { round: 1, turn: null, list: [], nextId: 1, sel: null, log: [] });
  b.list ||= [];
  b.log ||= [];
  // Old saves kept conditions as plain names. Only rebuild a list that has one, so a list being pushed to stays the same array.
  for (const c of b.list) if (!c.conditions || c.conditions.some(k => typeof k === 'string')) c.conditions = (c.conditions || []).map(G.condOf);
  G.linkInit(b.list);
  return b;
}
const bSettings = () => G.battleSettings(state.saved.battleSettings);
let battleTimer = null;
// Every saved change to the battle can be undone: the state before it goes on a stack.
const battleUndo = { past: [], future: [], last: null };
function resetBattleUndo() { battleUndo.past = []; battleUndo.future = []; battleUndo.last = null; }
function saveBattle({ history = true } = {}) {
  tidyTemp();
  const now = JSON.stringify(battle());
  if (history && battleUndo.last != null && now !== battleUndo.last) {
    battleUndo.past.push(battleUndo.last);
    if (battleUndo.past.length > 80) battleUndo.past.shift();
    battleUndo.future = [];
  }
  battleUndo.last = now;
  clearTimeout(battleTimer);
  battleTimer = setTimeout(() => attempt(() => api.saved.write(state.saved)), 300);
  api.battle?.publish({ ...G.playerSnapshot(battle(), bSettings()), fx: playerFx() });
}
/** Undo (or redo) the last change to the battle. Party members' sheets follow their HP back. */
function undoBattle(redo = false) {
  const from = redo ? battleUndo.future : battleUndo.past;
  if (!from.length) return toast(redo ? 'Nothing to redo.' : 'Nothing to undo in this battle.');
  const before = battle();
  (redo ? battleUndo.past : battleUndo.future).push(battleUndo.last ?? JSON.stringify(before));
  const snap = from.pop();
  state.saved.battle = JSON.parse(snap);
  battleUndo.last = snap;
  const after = battle();
  for (const c of after.list) if (c.kind === 'pc' && before.list.find(x => x.id === c.id)?.hp !== c.hp) syncPcHp(c);
  const changed = redo ? after.log.slice(before.log.length) : before.log.slice(after.log.length);
  saveBattle({ history: false });
  renderBattle();
  toast(`${redo ? 'Redone' : 'Undone'}${changed.length ? `: ${changed.at(-1).text}` : '.'}`);
}
// ----- concentration and lasting spells -----

/** The caster starts concentrating on a spell; whatever they were concentrating on before ends, with its effects. */
function startConcentration(c, sp) {
  const was = (c.conditions || []).find(k => k.name === 'Concentrating');
  if (was) {
    endSpellEffects(c.id, was.spell);
    c.conditions = c.conditions.filter(k => k !== was);
    if (was.spell && was.spell !== sp.name) battleLog(`${c.name} stops concentrating on ${was.spell}.`, true);
  }
  c.conditions.push({ name: 'Concentrating', spell: sp.name, rounds: G.spellRounds(sp), ends: 'start' });
  battleLog(`${c.name} is concentrating on ${sp.name}.`, true);
}
/** A concentration check in the dice tray: the DC and bonus, then the roll and whether it held once there is one. */
function concLines(entry) {
  const k = entry.conc, sign = k.con >= 0 ? '+' : '−';
  if (k.result == null) {
    entry.lines = [{ text: '', total: '', html: `Constitution save, DC ${k.dc} (${sign}${Math.abs(k.con)}) <button type="button" class="btn small" data-conc="roll">⚄ Roll it</button> <button type="button" class="btn small" data-conc="pass" title="The player rolled it and made it">Made it</button> <button type="button" class="btn small" data-conc="fail" title="The player rolled it and failed: the spell ends">Failed</button>` }];
    return;
  }
  const held = k.result === 'pass';
  entry.lines = [
    ...(k.roll ? [{ text: `1d20 ${sign} ${Math.abs(k.con)} against DC ${k.dc}`, total: k.roll.total, detail: G.rollBreakdown(k.roll), cls: k.roll.natural === 20 ? 'crit' : k.roll.natural === 1 ? 'fumble' : '' }] : []),
    { text: '', total: '', cls: held ? 'conc-held' : 'conc-lost', html: held ? `Holds concentration on ${esc(k.spell)}.` : `Loses concentration: ${esc(k.spell)} ends.` },
  ];
}
/** A Roll it / Made it / Failed button on a concentration check in the dice tray. */
function concClick(e) {
  const cb = e.target.closest('[data-conc]');
  if (!cb) return false;
  e.preventDefault();
  const entry = state.rolls[[...cb.closest('.dt-log').children].indexOf(cb.closest('.dt-roll'))];
  if (entry?.conc && entry.conc.result == null) settleConcentration(entry, cb.dataset.conc === 'roll' ? rollConcentration(entry.conc.con) : cb.dataset.conc);
  return true;
}
const rollConcentration = con => G.rollDice({ dice: [{ n: 1, d: 20, sign: 1 }], mod: con }, Math.random, { mode: '' });
/** Record a concentration check's outcome (a roll, or 'pass' / 'fail' as the player reported); a failure ends the spell. */
function settleConcentration(entry, roll) {
  const k = entry.conc;
  k.roll = typeof roll === 'object' ? roll : null;
  k.result = typeof roll === 'object' ? (roll.total >= k.dc ? 'pass' : 'fail') : roll;
  concLines(entry);
  const c = battle().list.find(x => x.id === k.id);
  if (c && k.result === 'fail') {
    const conc = (c.conditions || []).find(x => x.name === 'Concentrating');
    if (conc) {
      endSpellEffects(c.id, conc.spell);
      c.conditions = c.conditions.filter(x => x !== conc);
      battleLog(`${c.name} fails a concentration check and loses ${conc.spell || 'their spell'}.`, true);
    }
  } else if (c) battleLog(`${c.name} keeps concentrating on ${k.spell}${k.roll ? ` (${k.roll.total} against DC ${k.dc})` : ''}.`);
  saveBattle();
  drawTray();
  if (state.view?.kind === 'battle') renderBattle();
}

/** Take a caster's spell off everyone it was on. */
function endSpellEffects(casterId, spell) {
  for (const t of battle().list) {
    const gone = (t.conditions || []).filter(k => k.from === casterId && k.conc && (!spell || k.spell === spell));
    if (!gone.length) continue;
    t.conditions = t.conditions.filter(k => !gone.includes(k));
    for (const k of gone) battleLog(`${t.name} is no longer ${k.name === k.spell ? `under ${k.name}` : k.name.toLowerCase()}.`);
  }
}
/** Effects tied to someone's concentration go when it does: removed, run out, or they went down. */
function pruneSpellEffects() {
  const b = battle();
  for (const c of b.list) if (c.hp <= 0 && c.kind !== 'lair' && c.conditions?.some(k => k.name === 'Concentrating')) {
    const k = c.conditions.find(x => x.name === 'Concentrating');
    c.conditions = c.conditions.filter(x => x !== k);
    battleLog(`${c.name} loses concentration on ${k.spell || 'their spell'}.`, true);
  }
  const holding = (id, spell) => b.list.find(x => x.id === id)?.conditions?.some(k => k.name === 'Concentrating' && k.spell === spell);
  for (const t of b.list) {
    const gone = (t.conditions || []).filter(k => k.conc && !holding(k.from, k.spell));
    if (gone.length) t.conditions = t.conditions.filter(k => !gone.includes(k));
  }
}

/**
 * Cast a spell that lasts (bless, shield of faith, crusader's mantle) in the battle: pick who it lands on, and each
 * gets it as a chip. A concentration spell's chips go when the caster's concentration does.
 */
async function castLasting(name, who, spend = () => true, { mod = 0, slot = null } = {}) {
  const sp = G.spellInfo(state.data, name);
  const b = battle();
  const c = b.list.find(x => x.name === who);
  if (!sp) return;
  if (!c) return toast(`Put ${who || 'the caster'} in the battle first, then cast ${sp.name} from their stat block there.`, true);
  const buff = G.spellBuff(sp.name);
  const cast = G.castSpell(sp, { slot, mod });
  const self = /^self/i.test(sp.range || '');
  const friends = x => (c.kind === 'monster') === (x.kind === 'monster');
  const people = G.battleOrder(b.list).filter(x => x.kind !== 'lair' && x.hp > 0);
  const most = cast.area ? null : cast.targets > 1 ? cast.targets : self && !buff?.who?.startsWith('all') ? 1 : null;
  // A helping spell with no save (bless, aid) starts ticked on the caster's side, as many as it allows.
  const helps = !/\b(must (succeed on|make)|makes?) (an? )?\w+ saving throws?/i.test(sp.text || '') && !buff && !self && most > 1 ? people.filter(friends).slice(0, most) : [];
  const on = x => x.id === c.id ? (self || buff?.who === 'allies' || helps.includes(x)) : (buff?.who === 'allies' && friends(x)) || helps.includes(x);
  const r = await formDialog(`Cast ${sp.name}`, `
    <p class="muted" style="margin:0 0 8px">${esc(sp.summary || '')}${sp.concentration ? ` <b>Concentration</b>: ${esc(c.name)} concentrates on it${G.spellRounds(sp) ? ` for up to ${G.spellRounds(sp)} rounds` : ''}, and it ends for everyone when that stops.` : ''}</p>
    ${buff?.types ? `<label class="field" style="width:200px">Damage type<select name="type">${buff.types.map(t => `<option>${t}</option>`).join('')}</select></label>` : ''}
    <p class="settings-group" style="margin:6px 0 4px">Who it is on${most ? ` (up to ${most})` : ''}</p>
    <div class="cast-who">${people.map(x => `<label class="check"><input type="checkbox" name="on-${esc(x.id)}" ${on(x) ? 'checked' : ''}> ${esc(x.name)}${x.id === c.id ? ' (the caster)' : ''}</label>`).join('')}</div>`, 'Cast');
  if (!r) return;
  const picked = people.filter(x => r[`on-${x.id}`]);
  if (most && picked.length > most) return toast(`${sp.name} can be on ${most} at most.`, true);
  if (!picked.length) return toast(`Tick who ${sp.name} is on, then press Cast.`, true);
  if (!await spend()) return;
  if (sp.concentration) startConcentration(c, sp);
  const rounds = sp.concentration ? null : G.spellRounds(sp);
  const dmgType = buff?.types ? r.type : buff?.type;
  // Heroism's few temporary hit points each turn: as many as the caster's spellcasting modifier.
  const each = cast.tempEach ? Math.max(0, Number(mod) || 0) : 0;
  for (const t of picked) {
    t.conditions = (t.conditions || []).filter(k => !(k.spell === sp.name && k.from === c.id));
    t.conditions.push({ name: sp.name, spell: sp.name, from: c.id, rounds, ends: 'start', ...(sp.concentration ? { conc: true } : {}), ...(buff ? { buff: { dmg: buff.dmg, type: dmgType } } : {}), ...(each ? { tempEach: each } : {}) });
  }
  battleLog(`${c.name} casts ${sp.name}${picked.length ? ` on ${picked.map(x => x.id === c.id ? 'themself' : x.name).join(', ')}` : ''}.`, true);
  // Temporary hit points that come with it (armour of Agathys), gone when the spell ends.
  const temp = cast.temp && G.rollDice(cast.temp, Math.random)?.total;
  for (const t of picked) if (temp || each) giveTemp(t, temp || each, `${c.name}'s ${sp.name}`, sp.name);
  saveBattle();
  if (state.view?.kind === 'battle') renderBattle();
}

/**
 * Remember how a battle came about and when and where, the first time monsters are put in, for the session notes.
 * `origin` is what the generator knew: how it started, where, and the situation.
 */
/**
 * Monsters from an encounter card or the bestiary onto the battle screen. When a fight is already there (one left
 * from earlier, or still going), the DM chooses whether these join it or the old one is ended first.
 */
async function addToBattle(groups, origin, none = 'Nothing to add.') {
  const b = battle();
  const foes = b.list.filter(c => c.kind === 'monster');
  if (foes.length && groups.length) {
    const names = [...new Set(foes.map(c => c.stat?.name || c.monster))];
    const r = await formDialog('A battle is already set up', `<p class="muted" style="margin:0 0 10px">The battle screen still has ${esc(listJoin(names.slice(0, 3)))}${names.length > 3 ? ' and more' : ''}${b.turn ? `, in round ${b.round}` : ''}.</p>
      <label class="field">What now?<select name="how"><option value="join">Add these monsters to that battle</option><option value="fresh">End that battle first, then start a new one with these</option></select></label>`, 'Go on');
    if (!r) return;
    if (r.how === 'fresh' && !await endBattle()) return;
  }
  let n = 0;
  for (const g of groups) {
    const m = g.variant || G.monsterInfo(state.data, g.name);
    if (m) { const at = battle().list.length; addMonsters(m, g.count || 1); n += g.count || 1; maybeMountEnemies(battle().list.slice(at, at + (g.count || 1))); }
  }
  if (n) noteOrigin(origin);
  saveBattle();
  if (state.view?.kind === 'battle') renderBattle();
  toast(n ? `${n} monster${n > 1 ? 's' : ''} added to the battle.${state.view?.kind === 'battle' ? '' : ' Open Battle to run it.'}` : none, !n, n && state.view?.kind !== 'battle' ? 3600 : 0);
}
function noteOrigin(origin) {
  const b = battle();
  if (b.origin) return;
  const place = sysOn('world') ? partyPlace()?.title : null;
  b.origin = { ...(origin || {}), ...(state.data.calendar && sysOn('world') ? { date: fmtDay(today()) } : {}), ...(place && !(origin && 'where' in origin) ? { where: place } : {}) };
}

function battleLog(text, key = false) {
  const b = battle();
  b.log.push({ round: b.round || 1, text, key });
  if (b.log.length > 300) b.log.splice(0, b.log.length - 300);
}
function addCombatant(c) {
  const b = battle();
  const out = { id: `c${b.nextId++}`, temp: 0, conditions: [], init: null, initBonus: 0, notes: '', ...c };
  // Someone joining a battle already under way rolls initiative straight away.
  if (b.turn && out.init == null && out.kind !== 'pc') out.init = rollInit(out, false);
  b.list.push(out);
  return out;
}
function addMonsters(m, count, opts = {}) {
  const b = battle();
  const several = count > 1;
  for (let i = 0; i < count; i++) {
    const c = G.combatantFromMonster(m, Math.random, { rollHp: opts.rollHp, label: G.numberedName(b.list, m.name, several) });
    const legendary = G.legendaryCount(m);
    const rech = Object.fromEntries(G.recharges(m).map(x => [x.name, { on: x.on, ready: true }]));
    // A ranked variant isn't in the bestiary, so it carries its own stat block.
    addCombatant({ ...(G.monsterInfo(state.data, m.name) && !m.variantOf ? c : { ...c, stat: m }),
      ...(legendary ? { legendary, legendaryUsed: 0 } : {}), ...(Object.keys(rech).length ? { recharge: rech } : {}) });
  }
}
function statFor(c) { return c.stat || G.monsterInfo(state.data, c.monster); }
function rankOf(c) {
  // A friendly creature from the bestiary or a summon has a rank like any monster (a summon takes its caster's).
  if (c.kind === 'monster' || (c.stat && !c.page)) return statFor(c)?.rank || G.rankForCR(Number(statFor(c)?.cr) || 0);
  const p = c.page && state.pages.get(c.page);
  return p?.meta.type === 'pc' ? G.pcRank(p.meta) : p?.meta.rank || null;
}
// ----- summons, Wild Shape and mounts -----
// A summon is a combatant with `summon` ({ by, spell, conc, rounds, vanish, from }): it goes when the caster stops
// concentrating, its time runs out or it drops to 0 hit points. `after` puts it right after its summoner on the same
// initiative. A rider has `ride` (its mount's id) and goes just before the mount on the mount's initiative; `rider`
// says how well it rides ('skilled' with Mounted Combatant, 'normal', or 'poor', who may fall when hit). A druid in
// Wild Shape keeps their card with `shape` ({ name, stat, ac }): the beast's stat block and AC, their own HP.

const byId = id => battle().list.find(x => x.id === id);
/** The stat block a combatant fights with: a Wild Shape form, its own, or the bestiary's. */
const fightStat = c => c.shape?.stat || (c.kind === 'pc' ? null : statFor(c));
function sizeOfC(c) {
  if (c.shape?.stat) return c.shape.stat.size;
  if (c.kind === 'pc') return /halfling|gnome|goblin|kobold|small/i.test(state.pages.get(c.page)?.meta.species || '') ? 'Small' : 'Medium';
  return statFor(c)?.size || 'Medium';
}
/** A party member's sheet has the Mounted Combatant feat. */
function hasMountedCombatant(c) {
  if (c.kind !== 'pc') return c.rider === 'skilled';
  const m = state.pages.get(c.page)?.meta;
  return !!m && [...[].concat(m.classOpts?.feats || []), S.originFeat(m)].some(f => f === 'Mounted Combatant');
}
const ridersOf = mount => battle().list.filter(x => x.ride === mount.id);
/** A party member's (or friend's) mount does as it is told (Dash, Disengage, Dodge); an enemy's acts on its own. */
const controlledMount = mount => ridersOf(mount).some(r => r.rideHow ? r.rideHow === 'controlled' : r.kind !== 'monster');

/** Put a summoned creature into the battle. */
function addSummon(stat, { by = null, spell = '', from = '', conc = false, rounds = null, after = false, hostile = null, count = 1, vanish = true, vanishOnHit = false, mount = false } = {}) {
  const b = battle();
  const caster = by && byId(by);
  const enemy = hostile ?? caster?.kind === 'monster';
  const added = [];
  for (let i = 0; i < count; i++) {
    const c = G.combatantFromMonster(stat, Math.random, { label: G.numberedName(b.list, stat.name, count > 1) });
    const rank = caster ? rankOf(caster) : null;
    added.push(addCombatant({ ...c, kind: enemy ? 'monster' : 'other', stat: rank && stat.summoned ? { ...stat, rank } : stat,
      ...(after && caster ? { after: caster.id, init: caster.init ?? null, initBonus: caster.initBonus } : {}),
      summon: { by: caster?.id || null, byName: caster?.name || '', spell, from: from || spell, conc: !!(conc && caster), rounds: rounds || null, vanish, vanishOnHit, mount } }));
  }
  if (conc && caster && spell) {
    const sp = G.spellInfo(state.data, spell) || { name: spell };
    if (!caster.conditions.some(k => k.name === 'Concentrating' && k.spell === sp.name)) startConcentration(caster, sp);
  }
  // Someone joining a running battle on their own initiative rolls it now; a summon sharing its caster's turn needs none.
  battleLog(`${caster ? `${caster.name} summons` : 'Summoned:'} ${added.length > 1 ? `${added.length} × ${stat.name}` : stat.name}${from || spell ? ` (${from || spell})` : ''}${rounds ? `, for ${rounds} rounds` : ''}${conc && caster ? `, while ${caster.name} concentrates` : ''}.`, true);
  return added;
}
/** A summon leaves the battle (dismissed, its time is up, or the caster lost concentration). */
function dismissSummon(c, why) {
  const b = battle();
  if (b.turn === c.id) b.turn = G.nextTurn(b).turn;
  for (const r of ridersOf(c)) fallOff(r, `${c.name} vanishes from under them`);
  b.list = b.list.filter(x => x !== c);
  battleLog(`${c.name} ${why}.`, true);
  fx('tag', { id: c.id, text: 'Gone', tone: 'miss' });
}
/** Summons whose time is over, riders whose mount went down, and riders knocked prone: run on every redraw. */
function sweepBattle() {
  const b = battle();
  for (const c of [...b.list]) {
    const s = c.summon;
    if (!s) continue;
    const caster = s.by && byId(s.by);
    if (s.ended) dismissSummon(c, s.ended);
    else if (s.conc && !(caster?.conditions || []).some(k => k.name === 'Concentrating' && k.spell === s.spell)) dismissSummon(c, `vanishes: ${caster ? `${caster.name} is no longer concentrating on` : 'its summoner is gone, and with them'} ${s.spell}`);
    else if (s.rounds != null && s.rounds <= 0) dismissSummon(c, `vanishes: ${s.from || s.spell || 'its magic'} runs out`);
  }
  if (!bSettings().auto.seatChecks) return;
  for (const r of b.list.filter(x => x.ride)) {
    const mount = byId(r.ride);
    if (!mount) { r.ride = null; continue; }
    if (mount.hp <= 0) fallOff(r, `${mount.name} goes down`, { feet: r.kind === 'monster' && Math.random() < 0.5 });
    else if (mount.conditions.some(k => k.name === 'Prone')) fallOff(r, `${mount.name} is knocked prone`, { feet: r.kind === 'monster' && Math.random() < 0.5 });
    else {
      const k = r.conditions.find(x => x.name === 'Prone');
      if (k && !k.seatAsked) { k.seatAsked = true; seatCheck(r, 'knocked prone'); }
    }
  }
}
/** A rider comes off its mount. A fall lands them prone at the end of the initiative order; `feet`: they used their reaction to land standing. */
function fallOff(r, why, { feet = false, fall = true } = {}) {
  const b = battle();
  const mount = byId(r.ride);
  r.ride = null;
  if (!fall) { battleLog(`${r.name} dismounts${mount ? ` from ${mount.name}` : ''}.`, true); return; }
  if (!feet) {
    if (!r.conditions.some(k => k.name === 'Prone')) r.conditions.push({ name: 'Prone', rounds: null, ends: 'start', seatAsked: true });
    const others = b.list.filter(x => x !== r && x.kind !== 'lair' && x.init != null && x.init !== '').map(x => Number(x.init));
    r.init = others.length ? Math.min(...others) - 1 : r.init;
    r.after = null;
  }
  battleLog(feet ? `${r.name} leaps clear as ${why}, landing on their feet.` : `${r.name} falls${mount ? ` off ${mount.name}` : ''} (${why}) and lands prone, at the end of the initiative order.`, true);
  fx('tag', { id: r.id, text: feet ? 'Dismounted' : 'Falls!', tone: feet ? 'save' : 'fail' });
}
/** The Dexterity save to stay mounted (DC 10). An enemy's is rolled; a party member's waits for the player. */
function seatCheck(r, why) {
  const meta = r.kind === 'pc' ? state.pages.get(r.page)?.meta : null;
  const dex = meta && !r.shape ? S.saveBonus(meta, 'DEX') : G.saveBonusOf(fightStat(r), 'DEX');
  const entry = { who: r.name, label: `Staying mounted (${why})`, seat: { id: r.id, dc: 10, dex, why }, lines: [] };
  seatLines(entry);
  logRoll(entry);
  if (r.kind !== 'pc') settleSeat(entry, rollConcentration(dex));
}
function seatLines(entry) {
  const k = entry.seat, sign = k.dex >= 0 ? '+' : '−';
  if (k.result == null) {
    entry.lines = [{ text: '', total: '', html: `Dexterity save, DC ${k.dc} (${sign}${Math.abs(k.dex)}) <button type="button" class="btn small" data-seat="roll">⚄ Roll it</button> <button type="button" class="btn small" data-seat="pass" title="The player rolled it and made it">Made it</button> <button type="button" class="btn small" data-seat="fail" title="The player rolled it and failed: they fall">Failed</button>` }];
    return;
  }
  entry.lines = [
    ...(k.roll ? [{ text: `1d20 ${sign} ${Math.abs(k.dex)} against DC ${k.dc}`, total: k.roll.total, detail: G.rollBreakdown(k.roll), cls: k.roll.natural === 20 ? 'crit' : k.roll.natural === 1 ? 'fumble' : '' }] : []),
    { text: '', total: '', cls: k.result === 'pass' ? 'conc-held' : 'conc-lost', html: k.result === 'pass' ? 'Stays in the saddle.' : 'Falls off!' },
  ];
}
function seatClick(e) {
  const cb = e.target.closest('[data-seat]');
  if (!cb) return false;
  e.preventDefault();
  const entry = state.rolls[[...cb.closest('.dt-log').children].indexOf(cb.closest('.dt-roll'))];
  if (entry?.seat && entry.seat.result == null) settleSeat(entry, cb.dataset.seat === 'roll' ? rollConcentration(entry.seat.dex) : cb.dataset.seat);
  return true;
}
function settleSeat(entry, roll) {
  const k = entry.seat;
  k.roll = typeof roll === 'object' ? roll : null;
  k.result = typeof roll === 'object' ? (roll.total >= k.dc ? 'pass' : 'fail') : roll;
  seatLines(entry);
  const r = byId(k.id);
  if (r?.ride) {
    if (k.result === 'fail') fallOff(r, k.why);
    else {
      battleLog(`${r.name} keeps their seat${k.roll ? ` (${k.roll.total} against DC ${k.dc})` : ''}.`);
      // Knocked prone but still in the saddle: they aren't lying down.
      if (k.why === 'knocked prone') r.conditions = r.conditions.filter(x => x.name !== 'Prone');
    }
  }
  saveBattle();
  drawTray();
  if (state.view?.kind === 'battle') renderBattle();
}
/** `rider` gets on `mount`, taking its initiative. */
function mountUp(rider, mount, { skill = null, how = null } = {}) {
  rider.ride = mount.id;
  rider.rider = skill || (rider.kind === 'pc' ? (hasMountedCombatant(rider) ? 'skilled' : 'normal') : 'skilled');
  rider.rideHow = how || null;
  if (mount.init != null && mount.init !== '') rider.init = mount.init;
  battleLog(`${rider.name} rides ${mount.name}${rider.rider === 'poor' ? ', badly' : rider.rider === 'skilled' ? ' (Mounted Combatant)' : ''}.`, true);
}
/** Humanoid enemies sometimes come in riding: a fitting steed joins with each, and now and then one rides badly. */
function maybeMountEnemies(added, chance = 0.2) {
  if (!bSettings().auto.enemyMounts || !added.length || Math.random() >= chance) return;
  const m = statFor(added[0]);
  if (!SU.couldRide(m)) return;
  const steed = SU.pickMount(state.data.bestiary?.monsters, m);
  if (!steed) return;
  for (const r of added) {
    const before = battle().list.length;
    addMonsters(steed, 1);
    const mount = battle().list[before];
    if (r.hidden) mount.hidden = true;
    mountUp(r, mount, { skill: Math.random() < 0.15 ? 'poor' : 'skilled' });
  }
}

/** Wild Shape (2024): a druid becomes a beast they know, keeping their own HP with temporary HP on top. */
async function wildShape(c) {
  const p = c.page && state.pages.get(c.page);
  const m = p?.meta;
  if (!m) return toast('Wild Shape works on a party member with a sheet.', true);
  const level = Number(m.level) || 1;
  const wis = S.abilityModOf(m, 'WIS');
  const lim = SU.wildShapeLimits(level, m.subclass, wis);
  const used = Number(m.slotsUsed?.wild) || 0, left = Math.max(0, lim.uses - used);
  const known = [].concat(m.wildForms || []);
  const beasts = G.bestiaryCatalog(state.data).filter(x => /^beast/i.test(x.type || ''));
  const r = await formDialog(`Wild Shape: ${m.title}`, `
    <p class="muted" style="margin:0 0 8px">Druid ${level}${lim.moon ? ' (Circle of the Moon)' : ''}: beasts up to CR ${G.crLabel(lim.maxCr)}${lim.fly ? '' : ', none that fly'}, for ${lim.hours} hour${lim.hours > 1 ? 's' : ''}. ${esc(m.title)} keeps their own hit points, Intelligence, Wisdom, Charisma and class features, and gains temporary hit points. ${lim.moon ? `AC is at least ${13 + wis} (13 + Wisdom). Circle spells can still be cast.` : 'No spellcasting in beast form, though concentration carries on.'}</p>
    <p class="hint" style="margin:0 0 8px">Uses left: <b>${left}</b> of ${lim.uses} (one back on a short rest, all on a long rest).${known.length ? ` Known forms: ${known.map(esc).join(', ')}.` : ''}</p>
    <label class="field">Beast<input name="form" placeholder="Start typing a beast, or a name for a custom one"></label>
    <details class="ws-custom"><summary>A custom creature</summary>
      <p class="hint" style="margin:4px 0">Used when the name above isn't in the bestiary.</p>
      <div class="row"><label class="field">AC<input name="ac" type="number" value="13"></label><label class="field">Speed<input name="speed" value="40 ft."></label><label class="field">Size<select name="size">${SU.SIZES.slice(0, 5).map(s => `<option ${s === 'Medium' ? 'selected' : ''}>${s}</option>`).join('')}</select></label></div>
      <div class="row"><label class="field">Attack<input name="attack" placeholder="Bite"></label><label class="field">To hit<input name="toHit" type="number" value="${S.sheetPb(m) + Math.max(S.abilityModOf(m, 'STR'), S.abilityModOf(m, 'DEX'))}"></label><label class="field">Damage<input name="damage" value="1d8 + 2"></label><label class="field">Type<input name="dmgType" value="piercing"></label></div></details>
    <div class="row"><label class="field">Temporary HP<input name="temp" type="number" min="0" value="${lim.temp}"></label>
    <label class="check" style="align-self:end"><input type="checkbox" name="free" ${left ? '' : 'checked'}> Don't spend a use</label></div>`, 'Wild Shape', form => {
    attachPicker(form.elements.form, () => [...beasts].sort((a, b) => known.includes(b.name) - known.includes(a.name)).map(x => {
      const why = SU.wildShapeFits(x, lim);
      return { value: x.name, label: `CR ${G.crLabel(Number(x.cr))}${known.includes(x.name) ? ' · known form' : ''}${why ? ` · over the limit (${why})` : ''}` };
    }));
  });
  if (!r || !r.form.trim()) return;
  const name = r.form.trim();
  let stat = G.monsterInfo(state.data, name);
  if (!stat) stat = SU.customCreature({ name, size: r.size, ac: r.ac, hp: 1, speed: r.speed, attack: r.attack.trim(), toHit: r.toHit, damage: r.damage, dmgType: r.dmgType.trim() });
  const why = stat.custom ? '' : SU.wildShapeFits(stat, lim);
  if (why && !await confirmDialog('Over the Wild Shape limit', `${stat.name}: ${why}. Use it anyway?`, 'Use it anyway')) return;
  if (!r.free && left <= 0 && !await confirmDialog('No Wild Shape uses left', `${m.title} has used all ${lim.uses}. Shape-shift anyway?`, 'Shape-shift anyway')) return;
  if (c.shape) endWildShape(c, false);
  const beastAc = parseInt(stat.ac, 10) || 10;
  c.shape = { name: stat.name, stat, ac: c.ac };
  c.ac = Math.max(beastAc, lim.acMin);
  const temp = Math.max(0, Number(r.temp) || 0);
  if (temp > (Number(c.temp) || 0)) c.temp = temp;
  const meta = { ...m, wildForms: [...new Set([stat.name, ...known])].slice(0, Math.max(lim.known, 8)) };
  if (!r.free) meta.slotsUsed = { ...(m.slotsUsed || {}), wild: used + 1 };
  p.meta = meta;
  attempt(() => api.pages.write(p.id, p.meta, p.body));
  battleLog(`${c.name} wild shapes into ${G.aOrAn(stat.name)} ${stat.name}${temp ? `, with ${temp} temporary hit points` : ''}.`, true);
  fx('tag', { id: c.id, text: stat.name, tone: 'save' });
  saveBattle();
  if (state.view?.kind === 'battle') renderBattle();
}
function endWildShape(c, log = true) {
  if (!c.shape) return;
  if (log) battleLog(`${c.name} returns to their own form${c.hp <= 0 ? ' as they drop' : ''}.`, true);
  c.ac = c.shape.ac ?? c.ac;
  c.shape = null;
}

/** A summoning spell cast from a stat block: pick the form (and how many), then it joins the battle. */
async function castSummon(o, spend = async () => o) {
  const def = SU.summonSpell(o.spell);
  const sp = G.spellInfo(state.data, o.spell);
  const caster = battle().list.find(x => x.name === o.who);
  if (!def) return;
  if (!caster) return toast(`Put ${o.who || 'the caster'} in the battle first, then cast ${o.spell} from their stat block there.`, true);
  const L = Math.max(def.level, Number(o.slot) || def.level);
  const nums = { attack: Number(o.attack) || 0, dc: Number(o.dc) || 10, mod: Number(o.mod) || 0 };
  const lasting = def.lasting ? null : def.rounds || G.spellRounds(sp) || null;
  const conc = !!sp?.concentration;
  const choices = def.forms || (typeof def.choices === 'function' ? def.choices(L) : def.choices || []).filter(n => def.custom || G.monsterInfo(state.data, n));
  const count = def.count ? def.count(L) : 1;
  const r = await formDialog(`${o.spell}${L > def.level ? ` (level ${L})` : ''}`, `
    <p class="muted" style="margin:0 0 8px">${esc(sp?.summary || '')} ${def.after ? `It acts right after ${esc(caster.name)}, on the same initiative.` : 'It rolls its own initiative.'}${conc ? ` It vanishes when ${esc(caster.name)} stops concentrating.` : ''}${def.note ? ` ${esc(def.note)}` : ''}</p>
    ${def.custom ? `<div class="row"><label class="field">Size<select name="form">${['Medium', 'Large', 'Huge'].map(s => `<option>${s}</option>`).join('')}</select></label>
      <label class="field">How many<input name="count" type="number" min="1" max="20" value="${Math.max(1, nums.mod)}"></label></div>`
    : `<label class="field">${def.forms ? 'Form' : 'Creature'}<select name="form">${choices.map(n => `<option>${esc(n)}</option>`).join('')}</select></label>
      ${count > 1 ? `<label class="field">How many<input name="count" type="number" min="1" max="${count}" value="${count}"></label>` : ''}`}`, 'Summon');
  if (!r) return;
  const paid = await spend();
  if (!paid) return;
  // With no slot of the level picked left, it may have been cast with a higher one.
  const at = Math.max(L, Number(paid.slot) || L);
  let stat;
  if (def.build) stat = def.build(at, nums, r.form);
  else if (def.custom) stat = SU.animatedObject(r.form, at, nums);
  else {
    const base = G.monsterInfo(state.data, r.form);
    if (!base) return toast(`There's no ${r.form} in the bestiary.`, true);
    stat = def.rename ? { ...base, name: def.rename, speed: def.speed || base.speed, summoned: true } : base;
  }
  addSummon(stat, { by: caster.id, spell: sp?.name || o.spell, conc, rounds: lasting, after: !!def.after, count: Math.max(1, Math.min(def.custom ? 20 : count, Number(r.count) || 1)), vanishOnHit: def.rename === 'Phantom Steed', mount: !!def.mount });
  saveBattle();
  if (state.view?.kind === 'battle') renderBattle();
}
/** A class feature that brings a companion: the Steel Defender, a Primal Companion, or a Wild Companion familiar. */
async function summonFeature(name, who) {
  const c = battle().list.find(x => x.name === who);
  const p = c?.page && state.pages.get(c.page);
  if (!c || !p) return toast(`Put ${who || 'them'} in the battle first, then use ${name} from their stat block there.`, true);
  const m = p.meta, level = Number(m.level) || 1, cast = S.castingNumbers(m, state.data), pb = S.sheetPb(m);
  let stat, opts = { by: c.id, from: name, after: true, vanish: true };
  if (name === 'Steel Defender') stat = SU.steelDefender({ level, int: S.abilityModOf(m, 'INT'), pb, attack: cast.attack });
  else if (name === 'Primal Companion') {
    const r = await formDialog('Primal Companion', '<label class="field">Which beast<select name="form"><option>Land</option><option>Sea</option><option>Sky</option></select></label><p class="hint">It acts on the ranger\'s turn, right after them. Without a command it takes the Dodge action.</p>', 'Summon');
    if (!r) return;
    stat = SU.primalCompanion(r.form, { level, wis: S.abilityModOf(m, 'WIS'), attack: cast.attack, dc: cast.dc });
  } else if (name === 'Wild Companion') {
    const forms = SU.FAMILIARS.filter(n => G.monsterInfo(state.data, n));
    const r = await formDialog('Wild Companion', `<label class="field">Familiar<select name="form">${forms.map(n => `<option>${esc(n)}</option>`).join('')}</select></label>
      <label class="check"><input type="checkbox" name="spend" checked> Spend a Wild Shape use</label><p class="hint">A fey familiar that rolls its own initiative and can't attack. It goes at the next long rest.</p>`, 'Summon');
    if (!r) return;
    stat = { ...G.monsterInfo(state.data, r.form), type: 'fey' };
    opts = { by: c.id, from: 'Wild Companion', after: false, vanish: true };
    if (r.spend) { p.meta = { ...m, slotsUsed: { ...(m.slotsUsed || {}), wild: (Number(m.slotsUsed?.wild) || 0) + 1 } }; attempt(() => api.pages.write(p.id, p.meta, p.body)); }
  } else return;
  const old = battle().list.find(x => x.summon?.by === c.id && x.summon.from === name);
  if (old && name !== 'Wild Companion') dismissSummon(old, 'is replaced by a new one');
  addSummon(stat, opts);
  saveBattle();
  if (state.view?.kind === 'battle') renderBattle();
}
/** + Summon on the battle screen: any creature, from a spell, an item or a feature, for as long as it lasts. */
async function summonDialog() {
  const b = battle();
  const people = G.battleOrder(b.list).filter(c => c.kind !== 'lair');
  const templates = Object.entries(SU.SUMMON_SPELLS).flatMap(([spell, d]) => d.forms.map(f => ({ value: `${d.creature} (${f})`, label: `${spell}, needs a caster`, spell, form: f })));
  const r = await formDialog('Summon a creature', `
    <label class="field">Summoned by<select name="by"><option value="">No one in the battle (an item or a trap on its own)</option>${people.map(c => `<option value="${esc(c.id)}" ${c.id === (b.sel || b.turn) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
    <label class="field">Creature<input name="name" required placeholder="A bestiary creature, a summoned spirit, or any name"></label>
    <div class="row"><label class="field">From<input name="from" placeholder="Figurine of Wondrous Power, a spell, a feature…"></label><label class="field">How many<input name="count" type="number" min="1" max="20" value="1"></label></div>
    <div class="row"><label class="field">Spell level<input name="level" type="number" min="1" max="9" placeholder="For a spirit"></label><label class="field">Lasts (rounds)<input name="rounds" type="number" min="1" placeholder="Until dismissed"></label></div>
    <div class="row"><label class="field">AC<input name="ac" type="number" placeholder="Custom only"></label><label class="field">Hit points<input name="hp" type="number" placeholder="Custom only"></label></div>
    <label class="check"><input type="checkbox" name="after" checked> Acts right after its summoner, on the same initiative</label>
    <label class="check"><input type="checkbox" name="conc"> Vanishes when the summoner stops concentrating</label>
    <label class="check"><input type="checkbox" name="hostile"> Hostile to the party</label>
    <label class="check"><input type="checkbox" name="vanish" checked> Vanishes at 0 hit points</label>`, 'Summon', form => {
    const beasts = G.bestiaryCatalog(state.data).map(m => ({ value: m.name, label: `CR ${G.crLabel(Number(m.cr))}` }));
    attachPicker(form.elements.name, () => [...templates, ...beasts]);
    const sync = () => { const c = b.list.find(x => x.id === form.elements.by.value); form.elements.hostile.checked = c?.kind === 'monster'; };
    form.elements.by.addEventListener('change', sync);
    sync();
  });
  if (!r) return;
  const caster = b.list.find(x => x.id === r.by);
  const name = r.name.trim();
  const tpl = templates.find(t => t.value.toLowerCase() === name.toLowerCase());
  let stat, spell = '';
  if (tpl) {
    const d = SU.SUMMON_SPELLS[tpl.spell];
    const meta = caster?.kind === 'pc' && state.pages.get(caster.page)?.meta;
    const n = meta ? S.castingNumbers(meta, state.data) : { attack: 6, dc: 14 };
    stat = d.build(Math.max(d.level, Number(r.level) || d.level), { attack: n.attack, dc: n.dc }, tpl.form);
    spell = tpl.spell;
  } else stat = G.monsterInfo(state.data, name) || SU.customCreature({ name, ac: Number(r.ac) || 12, hp: Number(r.hp) || 10 });
  if (!G.monsterInfo(state.data, name) && !tpl && (r.ac || r.hp)) stat = { ...stat, ac: String(Number(r.ac) || parseInt(stat.ac, 10) || 12), hp: Number(r.hp) || stat.hp };
  addSummon(stat, { by: caster?.id || null, spell: r.conc ? spell || r.from.trim() || stat.name : spell, from: r.from.trim() || spell, conc: !!r.conc, rounds: Number(r.rounds) || null,
    after: !!r.after && !!caster, hostile: !!r.hostile, count: Math.max(1, Math.min(20, Number(r.count) || 1)), vanish: !!r.vanish });
  saveBattle();
  renderBattle();
}
/** Mount up, get down or fall off: the 🐎 button on a battle row. */
async function mountDialog(c) {
  const b = battle();
  const mount = c.ride && byId(c.ride);
  if (mount) {
    const r = await formDialog(`${c.name} on ${mount.name}`, `<p class="muted" style="margin:0 0 8px">Dismounting keeps ${esc(c.name)}'s place in the order. A fall lands them prone at the end of the initiative order.</p>
      <label class="field">What now?<select name="how"><option value="off">Dismount</option><option value="fall">Falls off</option></select></label>
      <label class="field">How well they ride<select name="skill">${[['skilled', 'Mounted Combatant'], ['normal', 'An ordinary rider'], ['poor', 'Badly: may fall whenever they are hit']].map(([v, l]) => `<option value="${v}" ${c.rider === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`, 'Go on');
    if (!r) return;
    c.rider = r.skill;
    if (r.how === 'fall') fallOff(c, 'they lose their seat'); else fallOff(c, '', { fall: false });
    saveBattle(); renderBattle();
    return;
  }
  const size = sizeOfC(c);
  const here = G.battleOrder(b.list).filter(x => x !== c && x.kind !== 'lair' && x.hp > 0 && !x.ride && !ridersOf(x).length && SU.canCarry(sizeOfC(x), size));
  const r = await formDialog(`${c.name} mounts up`, `
    <p class="muted" style="margin:0 0 8px">A mount must be at least one size larger than its ${esc(size.toLowerCase())} rider. The rider goes just before it, on its initiative.</p>
    <label class="field">Mount<select name="mount">${here.map(x => `<option value="${esc(x.id)}">${esc(x.name)} (${esc(sizeOfC(x).toLowerCase())})</option>`).join('')}<option value="new" ${here.length ? '' : 'selected'}>A new mount from the bestiary…</option></select></label>
    <label class="field">New mount<input name="beast" placeholder="Riding Horse, Warhorse, Giant Lizard…"></label>
    <label class="field">How well they ride<select name="skill">${[['skilled', 'Mounted Combatant'], ['normal', 'An ordinary rider'], ['poor', 'Badly: may fall whenever they are hit']].map(([v, l]) => `<option value="${v}" ${(c.kind === 'pc' ? (hasMountedCombatant(c) ? 'skilled' : 'normal') : 'skilled') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="field">The mount<select name="how"><option value="">${c.kind === 'monster' ? 'Acts on its own (an enemy\'s mount)' : 'Does as it is told (Dash, Disengage or Dodge)'}</option><option value="controlled">Does as it is told (Dash, Disengage or Dodge)</option><option value="independent">Acts on its own, attacks too</option></select></label>`, 'Mount', form => {
    attachPicker(form.elements.beast, () => SU.mountCandidates(state.data.bestiary?.monsters, size).sort((x, y) => x.name.localeCompare(y.name)).map(m => ({ value: m.name, label: `${m.size} · CR ${G.crLabel(Number(m.cr))}` })));
  });
  if (!r) return;
  let steed = b.list.find(x => x.id === r.mount);
  if (!steed) {
    const m = G.monsterInfo(state.data, r.beast);
    if (!m) return toast(r.beast ? `There's no ${r.beast} in the bestiary.` : 'Pick a mount, or type one from the bestiary.', true);
    if (!SU.canCarry(m.size, size)) return toast(`${m.name} is too small to carry ${c.name}.`, true);
    const before = b.list.length;
    addMonsters(m, 1);
    steed = b.list[before];
    // A party member's new mount is on the party's side.
    if (c.kind !== 'monster') { steed.kind = 'other'; steed.stat = m; }
    if (c.init != null && c.init !== '') { steed.init = c.init; }
  }
  mountUp(c, steed, { skill: r.skill, how: r.how || null });
  saveBattle();
  renderBattle();
}

function syncPcHp(c) {
  const p = c.page && state.pages.get(c.page);
  if (!p || p.meta.type !== 'pc') return;
  p.meta = { ...p.meta, hp: c.hp };
  attempt(() => api.pages.write(p.id, p.meta, p.body));
}
const condColor = name => bSettings().conditionColors[name] || bSettings().customColor;
/** What a condition chip does: the rules for a condition, or the spell it comes from (and whose concentration it rides on). */
function condRule(k) {
  const from = k.from && battle().list.find(x => x.id === k.from);
  const sp = k.spell && G.spellInfo(state.data, k.spell);
  if (k.name === 'Concentrating') return `${G.CONDITION_RULES.Concentrating}${k.spell ? ` Concentrating on ${k.spell}${sp?.summary ? `: ${sp.summary}` : '.'}` : ''}`;
  const base = G.CONDITION_RULES[k.name] || (sp && k.name === sp.name ? sp.summary : '') || '';
  const extra = [k.buff ? `Their weapon hits deal an extra ${k.buff.dmg}${k.buff.type ? ` ${k.buff.type}` : ''} damage, added to their rolls.` : '', from ? `From ${from.name}'s ${k.spell}${k.conc ? ', while they keep concentrating' : ''}.` : ''].filter(Boolean).join(' ');
  return [base, extra].filter(Boolean).join(' ');
}

/**
 * Temporary hit points from a spell, feature or item. They don't stack: someone who already has as many keeps theirs.
 * `from` names a lasting spell they vanish with (heroism, armour of Agathys).
 */
function giveTemp(c, amount, source = '', from = null) {
  const n = Math.max(0, Math.round(Number(amount) || 0));
  if (!n || !c) return;
  source = String(source).replace(/ \(temp HP\)$/, '').replace(/ \(temp HP, /, ' (');
  const g = G.gainTemp(c, n);
  if (g.kept) { battleLog(`${c.name} keeps their ${c.temp} temporary hit points${source ? ` (${source} gives ${n}, and they don't stack)` : ''}.`); fx('tag', { id: c.id, text: `Keeps ${c.temp} temp`, tone: 'temp' }); return; }
  c.temp = g.temp; c.tempFrom = from;
  battleLog(`${c.name} gains ${n} temporary hit points${source ? ` from ${source}` : ''}.`);
  fx('tag', { id: c.id, text: `+${n} temp`, tone: 'temp' });
}
/** Temporary hit points from a lasting spell go when the spell does (its chip is removed, it runs out, or concentration breaks). */
function tidyTemp() {
  for (const c of battle().list) {
    if (!c.tempFrom || c.conditions?.some(k => k.spell === c.tempFrom || k.name === c.tempFrom)) continue;
    if (c.temp > 0) battleLog(`${c.name}'s ${c.temp} temporary hit points from ${c.tempFrom} are gone.`);
    c.temp = 0; c.tempFrom = null;
  }
}

/** Damage (positive) or healing (negative), with everything that follows from it: falling, death saves, concentration. */
function changeHp(c, amount, source = '', how = {}) {
  if (!amount) { battleLog(`${c.name} takes no damage${source ? ` from ${source}` : ''}.`); fx('tag', { id: c.id, text: 'No damage', tone: 'miss' }); return 0; }
  const before = c.hp, tempBefore = Number(c.temp) || 0;
  Object.assign(c, G.applyHp(c, amount));
  const lost = before - c.hp, soaked = tempBefore - (Number(c.temp) || 0);
  if (soaked && !c.temp) c.tempFrom = null;
  const pct = n => c.hpMax ? Math.max(0, Math.min(100, (n / c.hpMax) * 100)) : 0;
  fx(amount > 0 ? 'hit' : 'heal', { id: c.id, tkind: c.kind, amount: Math.abs(amount), crit: !!how.crit, saved: !!how.saved, before: pct(before), after: pct(c.hp) });
  if (before > 0 && c.hp <= 0) fx('down', { id: c.id }, 250);
  if (amount > 0) battleLog(`${c.name} takes ${amount}${source ? ` from ${source}` : ''}${soaked ? `, ${soaked === amount ? 'all of it' : soaked} from temporary hit points${c.temp ? ` (${c.temp} left)` : ''}` : ''} (${c.hp}/${c.hpMax}).`);
  else battleLog(`${c.name} heals ${-amount} (${c.hp}/${c.hpMax}).`);
  tallyHp(c, before - c.hp + soaked, source, how);
  if (before > 0 && c.hp <= 0) {
    battleLog(c.kind === 'pc' ? `${c.name} goes down${source ? ` to ${source}` : ''}!` : `${c.name} falls${source ? ` to ${source}` : ''}.`, true);
    endWildShape(c);
    if (c.summon?.vanish) c.summon.ended = `drops to 0 hit points and vanishes${c.summon.from ? ` (${c.summon.from})` : ''}`;
    if (c.kind === 'pc') c.death = { ok: 0, fail: 0 };
    if (c.kind === 'monster' && c.conditions.length) c.conditions = [];
  }
  if (before <= 0 && c.hp > 0) { c.death = null; battleLog(`${c.name} is back up.`, true); }
  if (amount > 0 && c.hp > 0 && c.summon?.vanishOnHit) c.summon.ended = 'takes damage and fades away';
  // A poor rider may come off whenever they are hit.
  if (amount > 0 && c.hp > 0 && c.ride && c.rider === 'poor' && bSettings().auto.seatChecks) seatCheck(c, 'hit while riding badly');
  if (c.kind === 'pc') syncPcHp(c);
  const conc = c.conditions.some(k => k.name === 'Concentrating');
  if (conc && amount > 0 && c.hp > 0 && bSettings().auto.concentration) {
    const dc = G.concentrationDC(amount);
    // A party member's Constitution save from their sheet; anyone else's from their stat block.
    const meta = c.kind === 'pc' ? state.pages.get(c.page)?.meta : null;
    const con = meta ? S.saveBonus(meta, 'CON') : G.saveBonusOf(statFor(c), 'CON');
    const spell = c.conditions.find(k => k.name === 'Concentrating')?.spell || 'their spell';
    // A monster's check is rolled straight away; a party member's waits for the player's roll (or the DM's click).
    const entry = { who: c.name, label: `Concentration on ${spell}`, conc: { id: c.id, dc, con, spell }, lines: [] };
    concLines(entry);
    logRoll(entry);
    if (c.kind !== 'pc') settleConcentration(entry, rollConcentration(con));
  }
  if (c.kind === 'monster' && c.hp <= 0 && battle().list.filter(x => x.kind === 'monster').every(x => x.hp <= 0)) {
    battleLog('Every enemy is down.', true);
    if (before > 0) fx('victory', {}, 600);
  }
  return lost;
}

/** Who dealt and took what, for the session notes: the attacker is read from a source like "Bram's Longsword". */
function tallyHp(c, lost, source, how = {}) {
  if (!lost) return;
  const b = battle();
  const t = (b.tally ||= {});
  const by = source && [...b.list].sort((x, y) => y.name.length - x.name.length).find(x => source.startsWith(`${x.name}'s `));
  const one = n => (t[n] ||= { dealt: 0, taken: 0, healed: 0, downed: [], crits: 0 });
  if (lost > 0) {
    one(c.name).taken += lost;
    if (by && by !== c) { const r = one(by.name); r.dealt += lost; if (how.crit) r.crits++; if (c.hp <= 0 && c.hp + lost > 0) r.downed.push(c.name); }
  } else if (by) one(by.name).healed += -lost;
}

function undockTray() {
  const tray = trayEl();
  if (!tray?.classList.contains('docked')) return;
  tray.classList.remove('docked');
  tray.hidden = !tray.dataset.wasOpen;
  document.body.append(tray);
}

/** Whether the AI suggests this monster's turns: its own setting, else the battle's mode. */
function aiOn(c) {
  return c.kind === 'monster' && sysOn('battleAi') && (c.ai?.on ?? (battle().mode === 'ai'));
}
const foesOf = () => battle().list.filter(x => x.kind === 'pc' || x.kind === 'other');
function rangeSelect(c) {
  const r = c.range || {};
  const v = r.band === 'engaged' ? `engaged:${r.with}` : r.band || '';
  return `<select class="b-range${v ? '' : ' unset'}" data-range title="How far it is from the party (there is no map, so this stands in for distance)">
    <option value="" ${v ? '' : 'selected'}>Distance?</option>
    ${foesOf().map(f => `<option value="engaged:${f.id}" ${v === `engaged:${f.id}` ? 'selected' : ''}>Engaged: ${esc(f.name)}</option>`).join('')}
    ${G.RANGE_BANDS.filter(x => x.key !== 'engaged').map(x => `<option value="${x.key}" ${v === x.key ? 'selected' : ''}>${x.label}</option>`).join('')}</select>`;
}
function setRange(c, v) {
  c.range = !v ? null : v.startsWith('engaged:') ? { band: 'engaged', with: v.slice(8) } : { band: v, with: null };
  c.rangeGuess = false;
  battle().plan = null;
}
/** The suggestion for the monster whose turn it is, kept until the turn moves on or the DM asks for another. */
function currentPlan(c) {
  const b = battle();
  const key = `${c.id}:${b.round}`;
  // No distance yet: guess one rather than stop and ask. Another of its kind's distance, else Near (Far for
  // ranged fighters). The DM can change it on the card.
  if (!c.range) {
    const kin = b.list.find(x => x !== c && x.monster === c.monster && x.range);
    const tac = c.ai?.tactic || G.defaultTactic(statFor(c));
    c.range = kin ? { band: kin.range.band === 'engaged' ? 'near' : kin.range.band, with: null } : { band: ['sniper', 'caster'].includes(tac) ? 'far' : 'near', with: null };
    c.rangeGuess = true;
  }
  if (b.plan?.key === key && b.plan.band === (c.range?.band || null) && b.plan.with === (c.range?.with || null)) return b.plan;
  b.plan = { key, band: c.range?.band || null, with: c.range?.with || null, ...G.aiPlan(b, c, statFor(c), bSettings(), Math.random, state.data) };
  saveBattle();
  return b.plan;
}
function planCard(c, plan) {
  const b = battle();
  const tactic = G.TACTICS[plan.tactic]?.label || '';
  const tgt = plan.target && b.list.find(x => x.id === plan.target);
  if (plan.done) return `<div class="b-ai done"><div class="b-ai-head"><b>${esc(c.name)}</b><span class="muted">${esc(tactic)}</span></div><p>${esc(plan.text)}</p><p class="muted" style="margin:0">Done. Press <b>Next turn</b> when you're ready.</p></div>`;
  if (plan.awaiting) return savesCard(c, plan);
  const btns = plan.kind === 'ask'
    ? `${foesOf().filter(f => f.hp > 0).map(f => `<button class="btn small" data-plan="range" data-v="engaged:${f.id}">Engaged with ${esc(f.name)}</button>`).join('')}
       ${G.RANGE_BANDS.filter(x => x.key !== 'engaged').map(x => `<button class="btn small" data-plan="range" data-v="${x.key}" title="${esc(x.hint)}">${x.label}</button>`).join('')}`
    : plan.kind === 'act' || plan.kind === 'flee'
      ? `<button class="btn small primary" data-plan="do" title="D">${plan.steps.length ? '⚄ Do it' : 'Do it'} <kbd>D</kbd></button><button class="btn small" data-plan="again" title="A">Another idea <kbd>A</kbd></button><button class="btn small" data-plan="skip" title="S">Skip <kbd>S</kbd></button>`
      : `<button class="btn small" data-plan="again">Think again <kbd>A</kbd></button><button class="btn small" data-plan="skip">OK <kbd>S</kbd></button>`;
  return `<div class="b-ai kind-${plan.kind}">
    <div class="b-ai-head"><b>🎲 ${esc(c.name)}'s turn</b><span class="muted">${esc(tactic)}${tgt ? ` · target ${esc(tgt.name)}` : ''}</span></div>
    <p>${esc(plan.text)}</p>
    ${plan.why ? `<p class="b-ai-why"><b>Why:</b> ${esc(plan.why)}</p>` : ''}
    ${plan.kind === 'ask' ? '<p class="hint" style="margin:0 0 6px">There is no map, so say roughly where it is. It remembers, and moves itself as it acts.</p>' : ''}
    ${c.rangeGuess && plan.kind !== 'ask' && !plan.done ? `<details class="b-ai-guess"><summary class="hint">Distance guessed: <b>${esc(G.RANGE_BANDS.find(x => x.key === c.range?.band)?.label || '?')}</b>. Change it</summary><div class="row" style="flex-wrap:wrap;gap:4px;margin-top:4px">${foesOf().filter(f => f.hp > 0).map(f => `<button class="btn small" data-plan="range" data-v="engaged:${f.id}">Engaged with ${esc(f.name)}</button>`).join('')}${G.RANGE_BANDS.filter(x => x.key !== 'engaged').map(x => `<button class="btn small" data-plan="range" data-v="${x.key}" title="${esc(x.hint)}">${x.label}</button>`).join('')}</div></details>` : ''}
    ${(() => {
      // An area aimed at the party catches its own side standing next to them.
      const near = (plan.steps || []).some(st => st.area) ? alliesNear(c, foesOf().map(f => f.id)) : [];
      const notes = [...(plan.notes || []), ...(near.length ? [`Careful: ${near.map(x => `${x.name} (next to ${b.list.find(f => f.id === x.range.with)?.name})`).join(', ')} could be caught in the area too.`] : [])];
      return notes.length ? `<ul class="b-ai-notes">${notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : '';
    })()}
    <div class="row b-ai-btns">${btns}</div></div>`;
}
// ----- legendary actions -----
// At the end of another creature's turn, an AI monster with legendary actions left gets a suggestion for one.

/** The legendary action worth taking now, for this monster: { entry, atk, cost, target } or null. */
function legendaryIdea(c) {
  const b = battle();
  const m = statFor(c);
  const left = (c.legendary || 0) - (c.legendaryUsed || 0);
  if (!m?.legendary?.length || left <= 0 || c.hp <= 0) return null;
  const turnC = b.list.find(x => x.id === b.turn);
  const foes = foesOf().filter(f => f.hp > 0);
  if (!foes.length) return null;
  // The creature whose turn is ending, if it's one of the party; else whoever is engaged with it, else the most hurt.
  const target = (turnC && foes.includes(turnC) && turnC) || foes.find(f => c.range?.with === f.id) || [...foes].sort((x, y) => x.hp - y.hp)[0];
  const ideas = m.legendary.map(e => {
    const cost = Number(String(e.name).match(/Costs (\d+) Actions?/i)?.[1]) || 1;
    const named = String(e.desc || '').match(/makes (?:a|one) ([\w ]+?) attack/i)?.[1];
    const base = named && (m.actions || []).find(a => a.name.toLowerCase().startsWith(named.toLowerCase()));
    const atk = G.attackOf(base?.desc || '') || G.attackOf(e.desc || '');
    return atk && (atk.toHit != null || atk.save) && cost <= left ? { entry: e, base, atk, cost, target } : null;
  }).filter(Boolean);
  return ideas.sort((a, b2) => a.cost - b2.cost)[0] || null;
}
/** Legendary monsters that could act at the end of this turn (not their own), with what they'd do. */
function legendaryPrompts() {
  const b = battle();
  if (!b.turn || !bSettings().auto.legendary) return [];
  const key = `${b.round}:${b.turn}`;
  return b.list.filter(c => c.kind === 'monster' && c.id !== b.turn && aiOn(c) && !(b.legendSkip || []).includes(`${key}:${c.id}`))
    .map(c => ({ c, idea: legendaryIdea(c) })).filter(x => x.idea);
}
function legendaryCard() {
  const turnC = battle().list.find(x => x.id === battle().turn);
  return legendaryPrompts().map(({ c, idea }) => `<div class="b-ai kind-legend">
    <div class="b-ai-head"><b>👑 ${esc(c.name)}: legendary action?</b><span class="muted">${(c.legendary || 0) - (c.legendaryUsed || 0)} left this round</span></div>
    <p>At the end of ${esc(turnC?.name || 'this')}'s turn, ${esc(c.name)} can use <b>${esc(idea.entry.name)}</b>${idea.cost > 1 ? ` (costs ${idea.cost})` : ''} on ${esc(idea.target.name)}.</p>
    <div class="row b-ai-btns"><button class="btn small primary" data-legend-use="${c.id}" data-legend-target="${idea.target.id}">⚄ Use it</button><button class="btn small" data-legend-skip="${c.id}">Not now</button></div></div>`).join('');
}
function useLegendary(id, targetId) {
  const b = battle();
  const c = b.list.find(x => x.id === id);
  const idea = c && legendaryIdea(c);
  const t = b.list.find(x => x.id === targetId);
  if (!idea || !t) return;
  battleLog(`${c.name} uses ${idea.entry.name} on ${t.name}.`, true);
  state.applyTarget = t.id;
  rollAttackEntry({ ...idea.atk, name: idea.entry.name, section: 'legendary' }, c.name, idea.base?.desc || idea.entry.desc || '', { ai: true });
  const r = state.rolls[0];
  if (r && r.hit != null) {
    const hit = r.nat === 20 || (r.nat !== 1 && r.hit >= t.ac);
    if (hit && r.dmg) { queueHit(t, r, `${c.name}'s ${idea.entry.name}`, { crit: r.nat === 20 }); startPending(); }
    else if (!hit) battleLog(`${c.name}'s ${idea.entry.name} misses ${t.name}.`);
  } else if (idea.atk.save) toast(`${t.name} rolls a DC ${idea.atk.save.dc} ${idea.atk.save.ability} save. Apply the result from the dice tray.`);
  saveBattle();
  renderBattle();
}

/** Carry out, rethink or skip the suggestion. "Do it" rolls each attack in the tray and applies hits to the target. */
function planAction(what, v) {
  const b = battle();
  const c = b.list.find(x => x.id === b.turn);
  if (!c || !b.plan) return;
  const plan = b.plan;
  if (what === 'range') { setRange(c, v); saveBattle(); return renderBattle(); }
  if (what === 'again') {
    for (let i = 0; i < 6; i++) {
      const next = G.aiPlan(b, c, statFor(c), bSettings(), Math.random, state.data);
      if (next.text !== plan.text || i === 5) { b.plan = { ...plan, ...next, done: false }; break; }
    }
    saveBattle(); return renderBattle();
  }
  if (what === 'skip') { b.plan = { ...plan, awaiting: null, done: true, text: plan.kind === 'act' ? `${c.name} holds back this turn.` : plan.text }; battleLog(b.plan.text); saveBattle(); return renderBattle(); }
  if (what === 'who') { const [id, how] = v.split(':'); plan.awaiting.who[id] = plan.awaiting.who[id] === how ? '' : how; saveBattle(); return renderBattle(); }
  if (what === 'all') { for (const id of plan.awaiting.targets) if (!(plan.awaiting.allies || []).includes(id)) plan.awaiting.who[id] = v; saveBattle(); return renderBattle(); }
  if (what === 'roll') { rollSavesFor(plan.awaiting); saveBattle(); return renderBattle(); }
  if (what === 'apply') {
    if (unanswered(plan.awaiting).length) return toast(`Mark ${unanswered(plan.awaiting).map(x => x.name).join(', ')} first, or press Roll their saves.`, true);
    return applySaves(c, plan);
  }
  // Do it
  const stat = statFor(c);
  const acts = G.monsterActions(stat, state.data);
  const t = b.list.find(x => x.id === plan.target);
  battleLog(plan.text, true);
  const mode = state.rollMode;
  let awaiting = null;
  for (const st of plan.steps) {
    const a = acts.find(x => x.name === st.action);
    if (!a?.atk) continue;
    if (t && !st.area && t.hp <= 0 && !bSettings().ai.finishDowned) break;
    state.rollMode = st.mode || '';
    if (t) state.applyTarget = t.id;
    rollAttackEntry({ ...a.atk, name: a.name }, c.name, a.desc || '', { ai: true });
    if (a.spell && a.level) (c.spellsUsed ||= {})[a.name] = true;
    const r = state.rolls[0];
    if (t && r && fitToTarget(r, t)) { itemFxNote(t, r.itemFx); drawTray(); }
    if (!t) continue;
    state.applyTarget = t.id;
    const save = a.atk.save ? { name: a.name, dc: a.atk.save.dc, ability: a.atk.save.ability, half: a.half, condition: a.condition || null } : null;
    if (r?.parts) {
      // Beams and rays: each hits or misses on its own.
      const hits = r.parts.filter(p => partHits(p, t));
      for (const p of hits) queueHit(t, { dmg: p.dmg, who: r.who }, `${c.name}'s ${a.name}`, { crit: p.nat === 20 });
      if (hits.length < r.parts.length) battleLog(`${c.name}'s ${a.name}: ${hits.length} of ${r.parts.length} ${r.kind}s hit ${t.name}.`);
      continue;
    }
    if (r?.hit == null) {
      // A saving throw: the players roll theirs, then the DM marks who failed.
      if (save) {
        const targets = (st.area ? b.list.filter(x => (x.kind === 'pc' || x.kind === 'other') && x.hp > 0) : [t]).map(x => x.id);
        // Its own side, fighting next to the party, can be caught too: listed as not in it until the DM says otherwise.
        const allies = st.area ? alliesNear(c, targets).map(x => x.id) : [];
        awaiting = { ...save, dmg: r?.dmg || [], area: !!st.area, targets: [...targets, ...allies], allies, who: Object.fromEntries(allies.map(id => [id, 'out'])) };
        break;
      }
      if (r?.dmg) queueHit(t, r, `${c.name}'s ${a.name}`);
      continue;
    }
    const hit = r.nat === 20 || (r.nat !== 1 && r.hit >= t.ac);
    if (hit) {
      if (r.dmg) queueHit(t, r, `${c.name}'s ${a.name}`, { crit: r.nat === 20 });
      if (save && (save.condition || save.half)) { awaiting = { ...save, dmg: [], half: false, area: false, rider: true, targets: [t.id], who: {} }; }
    } else battleLog(`${c.name}'s ${a.name} misses ${t.name}.`);
  }
  state.rollMode = mode;
  if (state.pendingHits?.list.length) startPending();
  c.range = G.rangeAfter(c, plan);
  c.rangeGuess = false;
  b.plan = { ...plan, done: !awaiting, awaiting, band: c.range?.band || null, with: c.range?.with || null };
  saveBattle();
  renderBattle();
}

// ----- damage the AI is about to deal -----
// "Do it" doesn't hurt anyone straight away: the hits wait on the battle screen for 5 seconds, where the DM can
// change who takes them, halve them or drop them. Touching any of that stops the clock until Apply is pressed,
// and the clock holds while the mouse is over the card, so there's time to read it.
const PENDING_MS = 5000;
let pendingTimer = null;
function queueHit(t, r, src, { crit = false } = {}) {
  const p = (state.pendingHits ||= { list: [], start: 0, paused: false });
  p.list.push({ target: t.id, dmg: r.dmg, who: r.who, label: r.label, spell: r.spell, ranged: r.ranged, src, crit, half: false });
  // The hit lands from the card, so the roll isn't offered again in the tray or on the rows.
  disarmRoll();
}
const pendingAmount = h => {
  const t = battle().list.find(x => x.id === h.target);
  const n = t ? damageFor(h, t).total : 0;
  return h.half ? Math.floor(n / 2) : n;
};
function startPending() {
  clearTimeout(pendingTimer);
  Object.assign(state.pendingHits, { start: Date.now(), paused: false, held: false });
  pendingTimer = setTimeout(commitPending, PENDING_MS);
}
const pendingLeft = p => p.held ? p.left : Math.max(0, PENDING_MS - (Date.now() - p.start));
/** Mouse over the card: stop the clock where it is. */
function holdPending() {
  const p = state.pendingHits;
  if (!p || p.paused || p.held) return;
  clearTimeout(pendingTimer);
  Object.assign(p, { left: pendingLeft(p), held: true });
  $('.b-pending')?.classList.add('held');
  const note = $('.b-pending .b-ai-head .muted');
  if (note) note.textContent = 'Held while your mouse is here';
}
/** Mouse away again: the clock carries on from where it stopped. */
function releasePending() {
  const p = state.pendingHits;
  if (!p || p.paused || !p.held) return;
  Object.assign(p, { held: false, start: Date.now() - (PENDING_MS - p.left) });
  pendingTimer = setTimeout(commitPending, p.left);
  $('.b-pending')?.classList.remove('held');
  const note = $('.b-pending .b-ai-head .muted');
  if (note) note.textContent = `in ${Math.ceil(p.left / 1000)} seconds, unless you change something`;
}
function pausePending() {
  clearTimeout(pendingTimer);
  if (state.pendingHits) state.pendingHits.paused = true;
}
function commitPending() {
  clearTimeout(pendingTimer);
  const p = state.pendingHits;
  state.pendingHits = null;
  if (!p?.list.length) return;
  for (const h of p.list) {
    const t = battle().list.find(x => x.id === h.target);
    if (!t) continue;
    changeHp(t, pendingAmount(h), h.half ? `${h.src}, halved` : h.src, { crit: h.crit });
    itemFxNote(t, damageFor(h, t).items);
  }
  saveBattle();
  if (state.view?.kind === 'battle') renderBattle();
}
function pendingCard() {
  const p = state.pendingHits;
  if (!p?.list.length) return '';
  const b = battle();
  const who = b.list.filter(c => c.kind !== 'lair');
  const left = pendingLeft(p);
  return `<div class="b-pending${p.paused ? ' paused' : ''}${p.held ? ' held' : ''}">
    <div class="b-ai-head"><b>${p.paused ? 'Waiting for you' : 'Applying damage'}</b><span class="muted">${p.paused ? 'Press Apply when it\u2019s right' : p.held ? 'Held while your mouse is here' : `in ${Math.ceil(left / 1000)} seconds, unless you change something`}</span></div>
    ${p.paused ? '' : `<div class="b-pending-clock"><i style="animation-duration:${PENDING_MS}ms;animation-delay:-${PENDING_MS - left}ms"></i></div>`}
    ${p.list.map((h, i) => `<div class="b-pending-row">
      <span class="b-pending-src">${esc(h.src)}${h.crit ? ' <b class="crit">critical</b>' : ''}</span>
      <select data-ph="${i}" data-phf="target" title="Who takes it">${who.map(c => `<option value="${c.id}" ${c.id === h.target ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      <b class="b-pending-amt">${pendingAmount(h)}</b>
      <button class="chip${h.half ? ' on' : ''}" data-ph="${i}" data-phf="half" title="Only half (a successful save)">½</button>
      <button class="icon-btn" data-ph="${i}" data-phf="drop" title="Don't apply this one">×</button></div>`).join('')}
    <div class="row b-ai-btns"><button class="btn small primary" data-ph-apply>Apply now</button><button class="btn small" data-ph-cancel>Cancel all</button></div></div>`;
}

/** The caster's own side standing engaged with any of these party members: an area there catches them too. */
function alliesNear(c, targetIds) {
  return battle().list.filter(x => x.kind === 'monster' && x.id !== c.id && x.hp > 0 && x.range?.band === 'engaged' && targetIds.includes(x.range.with));
}
/** Targets on a saves card nobody has marked yet. */
const unanswered = w => w.targets.map(id => battle().list.find(x => x.id === id)).filter(t => t && !w.who[t.id]);
/** Rolls each unmarked target's save: party members from their sheets, everyone else from their stat blocks. */
/** The magic item that gives someone advantage on a save against this (when it's a spell), if any. */
const spellSaveItem = (w, t) => G.spellInfo(state.data, w.name) ? defencesFor(t)?.spellSaveAdv || null : null;
function rollSavesFor(w) {
  const ab = String(w.ability || '').slice(0, 3).toUpperCase();
  const lines = [];
  for (const t of unanswered(w)) {
    const meta = t.kind === 'pc' ? state.pages.get(t.page)?.meta : null;
    const bonus = meta ? S.saveBonus(meta, ab) : G.saveBonusOf(statFor(t), ab);
    const item = spellSaveItem(w, t);
    const d = Math.max(1 + Math.floor(Math.random() * 20), item ? 1 + Math.floor(Math.random() * 20) : 0);
    w.who[t.id] = d + bonus >= w.dc ? 'save' : 'fail';
    lines.push(`${t.name} ${d} ${bonus < 0 ? '−' : '+'} ${Math.abs(bonus)} = ${d + bonus}${item ? ` (advantage from their ${item})` : ''}, ${w.who[t.id] === 'save' ? 'saved' : 'failed'}`);
  }
  if (lines.length) battleLog(`DC ${w.dc} ${w.ability} saves: ${lines.join('; ')}.`, true);
}

/** The players have rolled: who failed, who saved, and (for an area) who wasn't in it. */
function savesCard(c, plan) {
  const b = battle();
  const w = plan.awaiting;
  const total = w.dmg.reduce((a, d) => a + d.total, 0);
  const what = `${total ? `${total} ${[...new Set(w.dmg.map(d => d.type).filter(Boolean))].join(' and ')} damage` : ''}${total && w.condition ? ', and ' : ''}${w.condition ? `${w.condition.toLowerCase()}` : ''}`;
  const rows = w.targets.map(id => b.list.find(x => x.id === id)).filter(Boolean).map(t => {
    const v = w.who[t.id] || '';
    const chip = (k, label) => `<button class="chip${v === k ? ' on' : ''}" data-plan="who" data-v="${t.id}:${k}">${label}</button>`;
    const ally = (w.allies || []).includes(t.id) ? ` <span class="muted">(its side, next to ${esc(b.list.find(x => x.id === t.range?.with)?.name || 'the party')})</span>` : '';
    const item = spellSaveItem(w, t);
    return `<div class="b-save-row"><span>${esc(t.name)}${ally}${item ? ` <span class="item-fx" title="${esc(`${item}: advantage on saves against spells`)}">✦ ${esc(item)}: with advantage</span>` : ''}</span>${chip('fail', 'Failed')}${chip('save', 'Saved')}${w.area ? chip('out', 'Not in it') : ''}</div>`;
  }).join('');
  const left = unanswered(w).length;
  return `<div class="b-ai kind-save">
    <div class="b-ai-head"><b>🎲 ${esc(c.name)}: ${esc(w.name.replace(/\s*\(Recharge.*\)/i, ''))}</b><span class="muted">${w.rider ? 'on a hit' : w.area ? 'area' : 'one target'}</span></div>
    <p>Players roll a <b>DC ${w.dc} ${esc(w.ability)} save</b>. On a fail: ${esc(what || 'the effect')}${w.half && total ? `; on a success, half (${Math.floor(total / 2)})` : '; on a success, nothing'}.</p>
    <div class="b-saves">${rows}</div>
    ${w.allies?.length ? '<p class="hint" style="margin:0 0 6px">Its own side is fighting next to the party. Mark them Failed or Saved if the area catches them.</p>' : ''}
    <div class="row b-ai-btns"><button class="btn small primary" data-plan="apply" ${left ? `disabled title="Mark everyone first (${left} left), or roll their saves"` : ''}>Apply <kbd>D</kbd></button>
      ${left ? '<button class="btn small" data-plan="roll" title="Roll each save from their sheet or stat block">Roll their saves</button>' : ''}
      ${w.targets.length > 1 ? '<button class="btn small" data-plan="all" data-v="fail">All failed</button><button class="btn small" data-plan="all" data-v="save">All saved</button>' : ''}
      <button class="btn small" data-plan="skip">Skip <kbd>S</kbd></button></div></div>`;
}
function applySaves(c, plan) {
  const b = battle();
  const w = plan.awaiting;
  const r = { dmg: w.dmg, who: c.name, label: w.name };
  const src = `${c.name}'s ${w.name.replace(/\s*\(Recharge.*\)/i, '')}`;
  for (const id of w.targets) {
    const t = b.list.find(x => x.id === id);
    const v = w.who[id];
    if (!t || !v || v === 'out') continue;
    const full = w.dmg.length ? damageFor(r, t).total : 0;
    if (v === 'fail') {
      if (full) changeHp(t, full, src);
      else fx('tag', { id: t.id, text: 'Failed', tone: 'fail' });
      if (w.dmg.length) itemFxNote(t, damageFor(r, t).items);
      if (w.condition && t.hp > 0 && !t.conditions.some(k => k.name === w.condition) && !condBlocked(t, w.condition)) { t.conditions.push({ name: w.condition, rounds: null, ends: 'end' }); battleLog(`${t.name} is ${w.condition.toLowerCase()} (${src}).`, true); }
      else if (!full) battleLog(`${t.name} fails the save against ${src}.`);
    } else if (w.half && full) changeHp(t, Math.floor(full / 2), `${src}, saved`, { saved: true });
    else { battleLog(`${t.name} saves against ${src}.`); fx('tag', { id: t.id, text: 'Saved', tone: 'save' }); }
  }
  b.plan = { ...plan, awaiting: null, done: true };
  saveBattle();
  renderBattle();
}

/** A party member's class, level and player, from their sheet: "Rogue 5 · Austin". */
function pcLine(c) {
  const m = state.pages.get(c.page)?.meta || {};
  const who = [m.class, m.class && m.level ? m.level : ''].filter(Boolean).join(' ') || 'Party';
  return m.player ? `${who} · ${m.player}` : who;
}
/** Saves a puzzle's handouts as a PDF of slips and opens it to print. */
async function printHandouts(href) {
  const h = G.handoutData(href);
  if (!h?.clues.length) return toast('This puzzle has no handouts.', true);
  const file = await attempt(() => api.files.savePdf(`${h.name} handouts.pdf`, G.handoutsHTML(h)));
  if (file) toast('Handouts saved and opened. Print them and cut along the dashed lines.');
}
/** Every monster from an encounter's battle link (in an astral space room or a saved encounter page) joins the battle. */
/** How a journey day's fight came about: the road event, for the battle's session notes. */
function journeyOrigin(j, day) {
  const enc = day.encounter || {};
  return {
    how: `On the road from ${j.from?.name || 'somewhere'} to ${j.to?.name || 'somewhere'}, day ${day.n}${enc.time ? ` (${enc.time.toLowerCase()})` : ''}: ${enc.event ? `${enc.event.name}. ${enc.event.text}` : 'an encounter'}`,
    ...(enc.event?.twist ? { situation: enc.event.twist } : {}),
    where: null,
  };
}
function addEncounterLink(href, origin = null) {
  const groups = [];
  for (const g of G.battleGroups(href)) {
    let m = G.monsterInfo(state.data, g.monster);
    if (!m) continue;
    // A monster spawned above its rank is raised again from its base, keeping the name the page gave it.
    if (g.name) {
      const seed = [...g.name].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
      m = { ...G.rankUp(state.data, g.monster, g.cr, G.makeRng(seed)), name: g.name };
    }
    groups.push({ variant: m, count: g.count });
  }
  const here = state.view?.kind === 'page' && state.pages.get(state.view.id);
  return addToBattle(groups, origin || (here ? { how: `From [[${here.meta.title}]]` } : null), 'Those monsters are not in the bestiary.');
}
// ---------- battle effects ----------
// Short animations that show what just happened: a hit flashes and shakes the card and its number floats off,
// a miss or a save pops a tag, the HP bar drains, the spotlight moves to whoever's turn it is, and a line runs
// from attacker to target. Each one is kept, with the time it started, for as long as it plays, so a redraw in
// the middle carries it on from where it was. The player window gets the same ones with every change.
const FX_MS = { hit: 1100, heal: 1200, tag: 1200, down: 1500, attack: 1000, turn: 1000, round: 1700, victory: 3000 };
let fxList = [];
const liveFx = () => { const now = Date.now(); return (fxList = fxList.filter(e => now - e.at < FX_MS[e.kind])); };
function fx(kind, data = {}, delay = 0) {
  if (!bSettings().effects) return;
  const now = Date.now();
  // A hit or a miss waits for the attack line that just went out to reach its target.
  const line = liveFx().find(e => e.kind === 'attack' && e.id === data.id && now - e.at < 100);
  if (line && kind !== 'attack') delay = Math.max(delay, line.at + 300 - now);
  fxList.push({ kind, at: now + delay, ...data });
}
/** What the players see: no hidden monsters' doings, and no monster damage numbers. */
function playerFx() {
  const b = battle();
  const set = bSettings();
  const shown = id => { const c = b.list.find(x => x.id === id); return c && !c.hidden; };
  return liveFx().filter(e => (!e.id || shown(e.id)) && (!e.from || shown(e.from))).map(e =>
    (e.kind === 'hit' || e.kind === 'heal') && (e.tkind !== 'pc' || !set.player.partyHp) ? { ...e, amount: null } : e);
}
/** Plays the live effects on freshly drawn cards inside root (the battle page or the player window). */
function playFx(root, list) {
  if (!root) return;
  const now = Date.now();
  const rowOf = id => id && root.querySelector(`[data-id="${CSS.escape(id)}"]`);
  const add = (parent, cls, e, html = '') => {
    const el = document.createElement('span');
    el.className = cls;
    el.style.setProperty('--fx-at', `${e.at - now}ms`);
    el.innerHTML = html;
    parent.append(el);
    return el;
  };
  for (const e of list) {
    if (e.kind === 'round') { add(root, 'fx-round', e, `Round <b>${e.round}</b>`); continue; }
    if (e.kind === 'victory') {
      const banner = root.querySelector('.b-banner');
      if (!banner) continue;
      add(banner, 'fx-shine', e);
      for (let i = 0; i < 24; i++) {
        const bit = add(banner, 'fx-confetti', e);
        const ang = (i / 24) * Math.PI * 2;
        bit.style.cssText += `;--x:${Math.round(Math.cos(ang) * (90 + (i % 3) * 40))}px;--y:${Math.round(Math.sin(ang) * (40 + (i % 4) * 14) - 30)}px;--r:${i * 47}deg;--c:${['var(--gold)', 'var(--good)', 'var(--accent)', 'var(--danger)'][i % 4]}`;
      }
      continue;
    }
    const row = rowOf(e.id);
    if (!row) continue;
    const at = `${e.at - now}ms`;
    if (e.kind === 'attack') {
      const from = rowOf(e.from);
      if (!from) continue;
      add(from, 'fx-layer fx-attacker', e);
      add(row, 'fx-layer fx-target', e);
      attackLine(root, from, row, e, now);
    } else if (e.kind === 'hit') {
      add(row, `fx-layer fx-hit${e.crit ? ' crit' : ''}`, e);
      row.classList.add(e.crit ? 'fx-shake-big' : 'fx-shake');
      row.style.setProperty('--fx-shake-at', at);
      add(row, `fx-float hit${e.crit ? ' crit' : ''}`, e, e.amount == null ? (e.crit ? 'Critical!' : 'Hit!') : `${e.crit ? '<small>Crit</small> ' : e.saved ? '<small>Saved</small> ' : ''}−${e.amount}`);
    } else if (e.kind === 'heal') {
      add(row, 'fx-layer fx-heal', e);
      for (let i = 0; i < 6; i++) add(row, 'fx-spark', e).style.cssText += `;left:${12 + i * 15}%;--d:${(i % 3) * 120}ms`;
      add(row, 'fx-float heal', e, e.amount == null ? 'Healed' : `+${e.amount}`);
    } else if (e.kind === 'tag') add(row, `fx-float tag ${e.tone || ''}`, e, esc(e.text));
    else if (e.kind === 'down') add(row, 'fx-layer fx-down', e, '<span class="fx-stamp">☠</span>');
    else if (e.kind === 'turn') add(row, 'fx-layer fx-turn', e);
    // The HP bar: damage leaves a pale strip that drains away behind it, healing fills it back up.
    const bar = $('.hpbar', row);
    if (bar && (e.kind === 'hit' || e.kind === 'heal')) {
      if (e.kind === 'hit') add(bar, 'fx-ghost', e).style.cssText += `;--from:${e.before}%;--to:${e.after}%`;
      else { const fill = $('i', bar); fill.classList.add('fx-grow'); fill.style.setProperty('--from', `${e.before}%`); fill.style.setProperty('--fx-at', at); }
    }
  }
}
/** A curved arrow from the attacker's card to the target's, drawn over the list. */
function attackLine(root, from, to, e, now) {
  const box = root.getBoundingClientRect();
  const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
  const x1 = a.left - box.left + a.width * 0.42, y1 = a.top - box.top + a.height / 2;
  const x2 = b.left - box.left + b.width * 0.42, y2 = b.top - box.top + b.height / 2 + (b.top > a.top ? -6 : 6);
  const bend = Math.min(220, 60 + Math.abs(y2 - y1) * 0.35);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', `fx-line from-${e.fkind || 'monster'}`);
  svg.style.setProperty('--fx-at', `${e.at - now}ms`);
  svg.innerHTML = `<defs><marker id="fx-arrow-${e.at}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z"/></marker></defs>
    <path pathLength="100" marker-end="url(#fx-arrow-${e.at})" d="M${x1},${y1} C${x1 + bend},${y1} ${x2 + bend},${y2} ${x2},${y2}"/>`;
  root.append(svg);
}

/** The divider between the battle list and the stat block: drag to share the width, double-click for equal halves. Remembered on this computer. */
function wireBattleSplit() {
  const page = $('.battle-page'), grip = $('.b-split'), body = $('.battle-body');
  if (!page || !body) return;
  const apply = r => { page.style.setProperty('--b-list', `${r}fr`); page.style.setProperty('--b-stat', `${1 - r}fr`); };
  const saved = (() => { try { return Number(localStorage.getItem('battle-split')); } catch { return 0; } })();
  apply(saved > 0.15 && saved < 0.85 ? saved : 0.5);
  if (!grip) return;
  const keep = r => { apply(r); try { localStorage.setItem('battle-split', String(r)); } catch {} };
  grip.ondblclick = () => keep(0.5);
  grip.onpointerdown = e => {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    grip.classList.add('dragging');
    const list = $('.b-left', body).getBoundingClientRect(), stat = $('.b-detail-wrap', body).getBoundingClientRect();
    const left = list.left, width = stat.right - list.left - 12;
    grip.onpointermove = ev => keep(Math.max(0.2, Math.min(0.8, (ev.clientX - left - 6) / width)));
    grip.onpointerup = () => { grip.classList.remove('dragging'); grip.onpointermove = grip.onpointerup = null; };
  };
}

function renderBattle() {
  undockTray();
  pruneSpellEffects();
  sweepBattle();
  const b = battle();
  battleUndo.last ??= JSON.stringify(b);
  const set = bSettings();
  const order = G.battleOrder(b.list);
  if (b.sel && !b.list.some(c => c.id === b.sel)) b.sel = null;
  const sel = b.list.find(c => c.id === (b.sel || b.turn));
  const levels = b.list.filter(c => c.kind === 'pc').map(c => Number(state.pages.get(c.page)?.meta.level) || 1);
  const diff = G.battleDifficulty(b.list.filter(c => c.kind === 'monster').reduce((a, c) => { const m = statFor(c); return a + Number(m?.xp ?? G.CR_XP[m?.cr] ?? 0); }, 0), levels);
  const allDown = b.list.some(c => c.kind === 'monster') && b.list.filter(c => c.kind === 'monster').every(c => c.hp <= 0);
  const hpBar = c => {
    const pct = c.hpMax ? Math.max(0, Math.min(100, (c.hp / c.hpMax) * 100)) : 0;
    const temp = c.temp > 0 && c.hpMax ? Math.min(100, (c.temp / c.hpMax) * 100) : 0;
    return `<div class="hpbar ${pct <= 25 ? 'low' : pct <= 50 ? 'mid' : ''}"><i style="width:${pct}%"></i>${temp ? `<b class="hp-temp" style="width:${temp}%"></b>` : ''}</div>`;
  };
  const pips = (n, used) => Array.from({ length: n }, (_, i) => i < n - used ? '◆' : '◇').join('');
  const row = c => {
    const hs = G.healthState(c, set);
    const conds = c.conditions;
    const style = [hs ? `--hs:${hs.color}` : '', conds.length ? `--cond:${condColor(conds[0].name)}` : ''].filter(Boolean).join(';');
    if (c.kind === 'lair') return `<div class="b-row kind-lair${c.id === b.turn ? ' current' : ''}" data-id="${c.id}">
      <input class="b-init" data-f="init" type="number" value="${c.init ?? ''}" title="Initiative">
      <div class="b-name"><b>${esc(c.name)}</b><span class="muted">Loses ties: acts after everyone else on ${c.init ?? 20}</span></div>
      <div class="b-act"><button class="icon-btn" data-remove title="Take out of the battle">×</button></div></div>`;
    const dead = c.hp <= 0 && (c.kind !== 'pc' || c.death?.dead);
    const mount = c.ride && b.list.find(x => x.id === c.ride), riders = b.list.filter(x => x.ride === c.id);
    const lead = c.after && b.list.find(x => x.id === c.after);
    const linked = mount && mount.after !== c.id ? `rides ${mount.name}: goes on its initiative` : lead ? `acts right after ${lead.name}` : '';
    const what = c.shape ? `<span class="b-shape" title="In Wild Shape: the beast's stat block and AC, their own hit points">🐾 ${esc(c.shape.name)}</span>`
      : esc(c.kind === 'pc' ? pcLine(c) : c.kind === 'monster' ? (c.stat?.variantOf ? `${c.stat.variantOf}, ranked up` : c.monster) : c.stat ? `${c.stat.name}${c.summon ? '' : ', friendly'}` : 'Other');
    const tags = [c.summon ? `<span class="b-tag summon" title="${esc(`${c.summon.from || c.summon.spell || 'Summoned'}${c.summon.conc ? `, while ${c.summon.byName} concentrates` : ''}${c.summon.rounds != null ? `, ${c.summon.rounds} rounds left` : ''}`)}">✦ ${c.summon.byName ? `${esc(c.summon.byName)}'s` : 'summoned'}${c.summon.rounds != null ? ` · ${c.summon.rounds} rd${c.summon.rounds === 1 ? '' : 's'}` : ''}</span>` : '',
      mount ? `<span class="b-tag ride" title="${c.rider === 'poor' ? 'Rides badly: may fall when hit' : c.rider === 'skilled' ? 'Mounted Combatant' : 'Riding'}">🐎 on ${esc(mount.name)}${c.rider === 'poor' ? ' (badly)' : ''}</span>` : '',
      riders.length ? `<span class="b-tag ride">carries ${esc(riders.map(r => r.name).join(', '))}${controlledMount(c) ? ' · controlled' : ''}</span>` : ''].filter(Boolean).join(' ');
    return `<div class="b-row${c.id === b.turn ? ' current' : ''}${c.id === sel?.id ? ' sel' : ''}${c.hp <= 0 ? ' down' : ''}${dead ? ' dead' : ''}${hs ? ' hs' : ''}${hs?.flash ? ' flash' : ''}${conds.length ? ' has-cond' : ''}${c.hidden ? ' hidden-c' : ''}${linked ? ' linked' : ''} kind-${c.kind}" data-id="${c.id}"${style ? ` style="${style}"` : ''}>
      <input class="b-init" data-f="init" type="number" value="${c.init ?? ''}" title="${linked ? esc(`Initiative: ${linked}`) : 'Initiative'}" placeholder="–"${linked ? ' readonly tabindex="-1"' : ''}>
      <div class="b-name"><b>${esc(c.name)}</b><span class="muted">${rankOf(c) ? `<span class="rank rank-${esc(rankOf(c))}">${esc(rankOf(c))}</span> · ` : ''}${hs ? `<span class="b-hs" style="color:${esc(hs.color)}">${esc(hs.name)}</span> · ` : ''}${c.hidden ? 'hidden · ' : ''}${what} · init ${c.initBonus >= 0 ? '+' : ''}${c.initBonus}</span>${tags ? `<div class="b-tags">${tags}</div>` : ''}
        <div class="b-conds">${conds.map(k => `<button class="chip cond" style="--c:${esc(condColor(k.name))}" data-cond="${esc(k.name)}" title="${esc(`${condRule(k) || ''} Click to see it, set how long it lasts, or remove it.`.trim())}">${esc(k.name)}${k.name === 'Concentrating' && k.spell ? `: ${esc(k.spell)}` : ''}${k.buff ? ` <small>+${esc(k.buff.dmg)}</small>` : ''}${k.rounds != null ? ` <b>${k.rounds}</b>` : ''}</button>`).join('')}
          ${c.legendary ? `<button class="chip leg" data-leg title="Legendary actions left this round. Click to spend one; right-click to give one back.">Legendary ${pips(c.legendary, c.legendaryUsed || 0)}</button>` : ''}
          ${Object.entries(c.recharge || {}).map(([n, v]) => `<button class="chip rech${v.ready ? ' ready' : ''}" data-rech="${esc(n)}" title="${v.ready ? 'Ready. Click to mark it used.' : `Used. Recharges on ${v.on}–6 at the start of its turn; click to mark it ready.`}">${esc(n.replace(/\s*\(Recharge.*\)/i, ''))} ${v.ready ? '✓' : '✗'}</button>`).join('')}</div>
        ${c.kind === 'pc' && c.hp <= 0 ? `<div class="b-death">${c.death?.dead ? '<b class="dead">Dead</b>' : c.death?.stable ? '<b>Stable</b>' : ''}
          <span>Saves ${[0, 1, 2].map(i => `<button class="ds ok${i < (c.death?.ok || 0) ? ' on' : ''}" data-ds="ok" data-i="${i}"></button>`).join('')}</span>
          <span>Fails ${[0, 1, 2].map(i => `<button class="ds fail${i < (c.death?.fail || 0) ? ' on' : ''}" data-ds="fail" data-i="${i}"></button>`).join('')}</span>
          <button class="btn small" data-dsroll>⚄ Death save</button></div>` : ''}</div>
      <div class="b-ac" title="Armor Class">AC <b>${esc(String(c.ac))}</b></div>
      <div class="b-hp">${hpBar(c)}<span>${c.hp} / ${c.hpMax}${c.temp > 0 ? ` <span class="b-temp-hp" title="${esc(`Temporary hit points${c.tempFrom ? ` from ${c.tempFrom}` : ''}: damage takes these first, and healing doesn't bring them back`)}">+${c.temp} temp</span>` : ''}</span></div>
      <div class="b-act">
        <div class="b-hprow b-dmg">${HP_STEPS.map(n => `<button class="b-step" data-step="${n}" title="${n} damage">−${n}</button>`).join('')}<input class="b-amt" data-amt="1" type="number" min="0" placeholder="Damage" title="Type the damage and press Enter"></div>
        <div class="b-hprow b-heal"><input class="b-amt" data-amt="-1" type="number" min="0" placeholder="Heal" title="Type the healing and press Enter">${[...HP_STEPS].reverse().map(n => `<button class="b-step" data-step="-${n}" title="Heal ${n}">+${n}</button>`).join('')}<input class="b-amt b-temp" data-temp type="number" min="0" placeholder="Temp" title="Set their temporary hit points (from a feat, a class feature, an item...) and press Enter. Damage takes these first; 0 clears them."></div>
        <div class="b-hprow b-auto">${autoButtons(c)}
          <select class="b-cond" title="Add a condition"><option value="">+ Condition</option>${G.CONDITIONS.filter(x => !conds.some(k => k.name === x)).map(x => `<option>${x}</option>`).join('')}<option value="*">Other…</option></select>
          ${c.kind === 'monster' && aiOn(c) ? rangeSelect(c) : ''}
          <button class="icon-btn${c.ride ? ' on' : ''}" data-mount title="${c.ride ? 'Riding: dismount or fall off' : 'Mount up: ride a creature in the battle or a new one'}">🐎</button>
          ${c.kind !== 'pc' ? `<button class="icon-btn" data-hide title="${c.hidden ? 'Hidden from the players. Click to reveal.' : 'Hide from the players’ view'}">${c.hidden ? '◌' : '◉'}</button>` : ''}
          <button class="icon-btn" data-remove title="Take out of the battle">×</button></div></div>
      ${dead ? '<span class="b-skull" aria-hidden="true">☠</span>' : ''}
    </div>`;
  };
  // What a summon, a rider, a mount or a druid in Wild Shape is doing, with its buttons, above the stat block.
  const notes = () => {
    const out = [];
    const s = sel.summon, mount = sel.ride && b.list.find(x => x.id === sel.ride), riders = b.list.filter(x => x.ride === sel.id);
    if (sel.shape) out.push(`<div class="b-note shape">🐾 <b>${esc(sel.name)}</b> is in Wild Shape as ${esc(G.aOrAn(sel.shape.name))} <b>${esc(sel.shape.name)}</b>: its AC, speed and attacks, with their own hit points (${sel.hp}/${sel.hpMax}${sel.temp ? `, +${sel.temp} temporary` : ''}). It ends if they drop to 0. <button class="btn small" data-wild-again>Change form</button> <button class="btn small" data-wild-end>End Wild Shape</button></div>`);
    if (s) out.push(`<div class="b-note summon">✦ Summoned${s.byName ? ` by <b>${esc(s.byName)}</b>` : ''}${s.from ? ` (${esc(s.from)})` : ''}. ${s.conc ? `It lasts while ${esc(s.byName)} concentrates on ${esc(s.spell)}. ` : ''}${s.rounds != null ? `${s.rounds} round${s.rounds === 1 ? '' : 's'} left. ` : ''}${s.vanish ? 'It vanishes at 0 hit points. ' : ''}${sel.after ? `It acts right after ${esc(b.list.find(x => x.id === sel.after)?.name || 'its summoner')}. ` : ''}<button class="btn small" data-dismiss>Dismiss</button></div>`);
    if (mount) out.push(`<div class="b-note ride">🐎 Riding <b>${esc(mount.name)}</b>, on its initiative${controlledMount(mount) ? ' (a controlled mount: it only Dashes, Disengages or Dodges)' : ' (it acts on its own)'}. ${hasMountedCombatant(sel) ? '<b>Mounted Combatant</b>: advantage on melee attacks against unmounted creatures smaller than the mount (rolled for you when one is the target); a hit meant for the mount can hit them instead; the mount takes no damage from a Dexterity save it makes for half, and half if it fails. ' : ''}${sel.rider === 'poor' ? 'Rides badly: a DC 10 Dexterity save each time they are hit, or they fall. ' : ''}<button class="btn small" data-mount-sel>Dismount or fall…</button></div>`);
    if (riders.length) out.push(`<div class="b-note ride">🐎 Carrying <b>${esc(riders.map(r => r.name).join(', '))}</b>. ${controlledMount(sel) ? 'A controlled mount: on its turn it only Dashes, Disengages or Dodges, and it moves where its rider wants.' : 'It acts on its own and attacks too.'} If it is knocked prone or drops, its rider falls.</div>`);
    return out.join('');
  };
  const detail = () => {
    if (!sel || sel.kind === 'lair') return '<p class="hint">Click someone in the list to see their stat block and roll their attacks.</p>';
    return notes() + detailBody();
  };
  const detailBody = () => {
    const fields = `<div class="b-fields">
      ${[['ac', 'AC'], ['hp', 'HP'], ['hpMax', 'Max HP'], ['temp', 'Temp HP'], ['initBonus', 'Init bonus']].map(([k, l]) => `<label class="field">${l}<input type="number" data-sf="${k}" value="${esc(String(sel[k] ?? 0))}"></label>`).join('')}
      <button class="btn small" data-rollinit title="Roll initiative for ${esc(sel.name)}">⚄ Initiative</button></div>
      <label class="field">Notes<input data-sf="notes" value="${esc(sel.notes || '')}" placeholder="Hiding behind the cart, owes the party a favour…"></label>`;
    if (sel.kind === 'monster') {
      const m = statFor(sel);
      const auto = m ? G.defaultTactic(m) : 'brute';
      const tac = sel.ai?.tactic || auto;
      const ai = `<div class="b-fields b-aiset">
        <label class="field" data-sys="battleAi">Turns<select data-ai="on"><option value="" ${sel.ai?.on == null ? 'selected' : ''}>Battle setting (${b.mode === 'ai' ? 'AI' : 'manual'})</option><option value="1" ${sel.ai?.on === true ? 'selected' : ''}>AI suggests</option><option value="0" ${sel.ai?.on === false ? 'selected' : ''}>Manual</option></select></label>
        <label class="field">Tactic<select data-ai="tactic"><option value="" ${sel.ai?.tactic ? '' : 'selected'}>Auto: ${esc(G.TACTICS[auto].label)}</option>${Object.entries(G.TACTICS).map(([k, t]) => `<option value="${k}" ${sel.ai?.tactic === k ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select></label></div>
        <p class="hint" style="margin:0 0 6px">${esc(G.TACTICS[tac].desc)}</p>`;
      // The stat block comes first; the numbers to edit and the AI settings sit under it.
      // Its name opens the Bestiary entry (a spawned variant opens the creature it was made from).
      const key = G.monsterInfo(state.data, sel.monster)?.key || (m?.variantOf && G.monsterInfo(state.data, m.variantOf)?.key) || null;
      return (m ? statBlock(m, sel.name, { actionsFirst: true, link: key, riding: !!sel.ride }) : `<p class="hint">No stat block for ${esc(sel.monster)}.</p>`) + fields + ai;
    }
    const p = sel.page && state.pages.get(sel.page);
    // In Wild Shape the beast's stat block comes first; their own sheet (class features, circle spells) is folded below.
    if (sel.shape) return `${statBlock(sel.shape.stat, sel.name, { actionsFirst: true, riding: !!sel.ride })}${p ? `<details class="b-own"><summary>${esc(sel.name)}'s own stat block</summary>${pcStatBlock(p, sel.name)}</details>` : ''}${fields}`;
    // A party member shows the stat block from their sheet, with their weapon attacks ready to roll.
    if (sel.kind === 'pc' && p) return `${pcStatBlock(p, sel.name)}<p><a class="wikilink" data-id="${esc(p.id)}">Open ${esc(sel.name)}'s sheet</a></p>${fields}`;
    // An NPC brought in from the wiki shows the stat block from their page.
    if (sel.stat) return `${statBlock(sel.stat, sel.name, { actionsFirst: true, riding: !!sel.ride })}${p ? `<p><a class="wikilink" data-id="${esc(p.id)}">Open ${esc(sel.name)}'s page</a></p>` : ''}${fields}`;
    return `<h2>${esc(sel.name)}</h2>${p ? `<p><a class="wikilink" data-id="${esc(p.id)}">Open ${esc(sel.name)}'s ${sel.kind === 'pc' ? 'sheet' : 'page'}</a></p>` : ''}${fields}
      <p class="hint">Dice to roll? Type them in the dice tray, like <code>1d20 + 5</code>.</p>`;
  };
  const log = b.log.slice(-14).reverse();
  const turnC = b.list.find(c => c.id === b.turn);
  const plan = turnC?.kind === 'monster' && aiOn(turnC) ? currentPlan(turnC) : null;
  $('#view').innerHTML = `<div class="wide battle-page">
    <div class="b-head"><div class="map-bar"><h1>Battle</h1><span class="spacer"></span>
      ${b.list.length ? `${diff.label ? `<span class="b-diff diff-${diff.label.toLowerCase()}" title="${diff.xp.toLocaleString()} XP of monsters against a party of ${levels.length} at level ${diff.level}">${esc(diff.label)} · ${diff.xp.toLocaleString()} XP</span>` : ''}
      <span class="b-round">Round <b>${b.round}</b></span>
      <span class="seg" data-sys="battleAi" title="AI: monsters suggest their own turns. Manual: you decide.">${['manual', 'ai'].map(m => `<button class="chip${(b.mode || 'manual') === m ? ' on' : ''}" data-bmode="${m}">${m === 'ai' ? 'AI' : 'Manual'}</button>`).join('')}</span>
      <button class="icon-btn" id="b-undo" title="Undo (Ctrl+Z)" ${battleUndo.past.length ? '' : 'disabled'}>↶</button><button class="icon-btn" id="b-redo" title="Redo (Ctrl+Y)" ${battleUndo.future.length ? '' : 'disabled'}>↷</button>
      <button class="btn small" id="b-prev" title="Back a turn">‹ Back</button><button class="btn primary" id="b-next" title="Next turn (N)">${b.turn ? 'Next turn ›' : 'Start ›'}</button>` : ''}</div>
    <div class="row b-tools">
      <button class="btn small" id="b-party">+ Party</button><button class="btn small" id="b-monster">+ Monster</button><button class="btn small" id="b-other">+ Someone else</button><button class="btn small" id="b-summon" title="A creature summoned by a spell, an item or a feature: it can share its summoner's turn, last a number of rounds or end with their concentration">+ Summon</button>
      <button class="btn small" id="b-lair" title="A marker at initiative 20 for lair actions">+ Lair action</button>
      <span class="spacer"></span>
      <button class="btn small" id="b-init" title="Roll for every monster, and anyone without an initiative yet">⚄ Roll initiative</button>
      <button class="btn small" id="b-player" title="Open a window for the players: turn order and health, no monster numbers">Player view</button>
      <button class="btn small${compactRows() ? ' on' : ''}" id="b-compact" title="Compact rows: only the selected and current rows show their damage, heal and condition buttons">☰ Compact</button>
      <button class="btn small" id="b-settings" title="Health states, condition colours, what runs by itself">⚙ Settings</button>
      ${b.list.length ? '<button class="btn small danger" id="b-end">End battle</button>' : ''}
    </div></div>
    ${allDown ? '<div class="b-banner">Every enemy is down. <button class="btn small primary" id="b-end2">End the battle and add it to the session notes</button></div>' : ''}
    ${b.list.length ? `<div class="battle-body${state.trayWin ? ' dice-out' : ''}"><div class="b-left"><div class="b-list${b.turn ? ' has-turn' : ''}${compactRows() ? ' compact' : ''}">${order.map(row).join('')}</div>
        ${log.length ? `<details class="b-log"${state.battleLogClosed ? '' : ' open'}><summary>Battle log</summary>${log.map(e => `<div class="${e.key ? 'key' : ''}"><span class="muted">R${e.round}</span> ${esc(e.text)}</div>`).join('')}</details>` : ''}</div>
      <div class="b-detail-wrap"><div class="b-split" title="Drag to share the width between the list and the stat block. Double-click to make them equal."></div><div class="b-detail">${pendingCard()}${plan ? planCard(turnC, plan) : ''}${legendaryCard()}${detail()}</div></div><div class="b-dice" id="b-dice"></div></div>`
      : `<div class="empty"><p>No battle running.</p><p>Add the party and some monsters, roll initiative, and press <b>Start</b>. Encounters from the generator and monsters in the bestiary have an <b>Add to battle</b> button too.</p></div>`}
  </div>`;
  const slot = $('#b-dice');
  if (slot && !state.trayWin) {
    const tray = trayEl();
    tray.dataset.wasOpen = tray.hidden ? '' : '1';
    tray.classList.add('docked');
    tray.hidden = false;
    slot.append(tray);
    drawTray();
  }
  // The header stays put while the list scrolls; the stat block and dice sit just under it.
  const head = $('.b-head');
  if (head) $('.battle-page').style.setProperty('--b-head-h', `${head.offsetHeight}px`);
  wireBattleSplit();
  playFx($('.battle-page'), liveFx());
  const logBox = $('.b-log');
  if (logBox) logBox.ontoggle = () => { state.battleLogClosed = !logBox.open; };
  const redraw = () => { saveBattle(); renderBattle(); };
  const find = el => b.list.find(c => c.id === el.closest('[data-id]').dataset.id);
  // A positive amount is damage, a negative one healing.
  const hurt = (el, amount, src = '', how = {}) => {
    if (!amount) return toast('Type an amount first.', true);
    changeHp(find(el), amount, src, how);
    redraw();
  };
  $$('.b-row').forEach(r => r.addEventListener('click', e => {
    if (e.target.closest('input, button, select')) return;
    b.sel = r.dataset.id; state.applyTarget = r.dataset.id;
    // Clicking someone also aims the latest single-target roll at them.
    const last = state.rolls[0];
    if (last && !last.applied && !last.targets?.length && !last.parts) last.target = r.dataset.id;
    renderBattle();
  }));
  $$('.b-row [data-f="init"]:not([readonly])').forEach(i => i.onchange = () => { find(i).init = i.value === '' ? null : Number(i.value); backToTop(); redraw(); });
  $$('[data-step]').forEach(x => x.onclick = () => hurt(x, Number(x.dataset.step)));
  $$('.b-amt:not([data-temp])').forEach(x => x.onkeydown = e => { if (e.key === 'Enter' && x.value !== '') hurt(x, Number(x.dataset.amt) * Math.abs(Number(x.value))); });
  // Temporary hit points typed in by hand: set to exactly that (0 clears them).
  $$('.b-amt[data-temp]').forEach(x => x.onkeydown = e => {
    if (e.key !== 'Enter' || x.value === '') return;
    const c = find(x), n = Math.max(0, Math.round(Math.abs(Number(x.value)) || 0));
    c.temp = n; c.tempFrom = null;
    battleLog(n ? `${c.name} has ${n} temporary hit points.` : `${c.name}'s temporary hit points are gone.`);
    if (n) fx('tag', { id: c.id, text: `+${n} temp`, tone: 'temp' });
    redraw();
  });
  $$('[data-auto]').forEach(x => x.onclick = () => {
    const ef = state.lastEffect, c = find(x);
    if (!ef?.dmg.length) return;
    const out = autoOutcome(ef, c);
    if (ef.temp) { giveTemp(c, autoAmount(ef, c), ef.who ? `${ef.who}'s ${ef.label}` : ef.label); return redraw(); }
    const n = ef.heal ? -autoAmount(ef, c) : autoAmount(ef, c);
    if (!n) return toast(out?.save?.pass ? `${c.name} saved and takes no damage.` : out?.of ? `None of it hits ${c.name}.` : `${c.name} takes no damage from that after resistances.`);
    if (!ef.heal) itemFxNote(c, out ? out.items : damageFor(ef, c).items);
    hurt(x, n, ef.who ? `${ef.who}'s ${ef.label}` : ef.label, { crit: !ef.heal && (out ? !!out.crit : ef.nat === 20), saved: !!out?.save?.pass });
  });
  $$('[data-lastcond]').forEach(x => x.onclick = () => {
    const k = state.lastEffect?.condition, c = find(x);
    if (!k) return;
    if (condBlocked(c, k.name)) return redraw();
    const src = state.lastEffect.who ? `${state.lastEffect.who}'s ${state.lastEffect.label}` : state.lastEffect.label;
    c.conditions = c.conditions.filter(y => y.name !== k.name);
    c.conditions.push({ name: k.name, rounds: k.rounds, ends: k.ends, ...concLink(state.lastEffect.who, state.lastEffect.label) });
    battleLog(`${c.name} is ${k.name.toLowerCase()}${k.rounds ? ` for ${k.rounds} round${k.rounds > 1 ? 's' : ''}` : ''} (${src}${k.note ? `; ${k.note}` : ''}).`, true);
    redraw();
  });
  $$('.b-cond').forEach(x => x.onchange = async () => {
    const c = find(x);
    let name = x.value;
    if (!name) return;
    if (name === '*') {
      const r = await formDialog('Another condition', `<label class="field">Name<input name="name" required placeholder="Blessed, Hasted, On fire…"></label>
        <label class="field">Rounds<input name="rounds" type="number" min="1" placeholder="Until removed"></label>`, 'Add');
      if (!r) return renderBattle();
      name = r.name.trim();
      c.conditions.push({ name, rounds: r.rounds ? Number(r.rounds) : null, ends: 'start' });
    } else c.conditions.push({ name, rounds: null, ends: 'start' });
    battleLog(`${c.name} is ${name.toLowerCase()}.`, true);
    redraw();
  });
  $$('[data-cond]').forEach(x => x.onclick = async () => {
    const c = find(x);
    const k = c.conditions.find(y => y.name === x.dataset.cond);
    const rule = condRule(k);
    const r = await formDialog(`${k.name}: ${c.name}`, `
      <p class="cond-rule" style="margin:0 0 10px">${rule ? esc(rule) : '<span class="muted">A condition added by hand: no rules text for it.</span>'}</p>
      ${k.name === 'Concentrating' && k.spell ? `<p class="hint" style="margin:0 0 10px">Removing it ends ${esc(k.spell)} on everyone it is on.</p>` : ''}
      <div class="row"><label class="field">Rounds left<input name="rounds" type="number" min="1" value="${k.rounds ?? ''}" placeholder="Until removed"></label>
      <label class="field">Counts down at<select name="ends"><option value="start" ${k.ends !== 'end' ? 'selected' : ''}>the start of ${esc(c.name)}'s turn</option><option value="end" ${k.ends === 'end' ? 'selected' : ''}>the end of ${esc(c.name)}'s turn</option></select></label></div>
      <label class="check"><input type="checkbox" name="remove"> Remove ${esc(k.name.toLowerCase())} now</label>`, 'Save');
    if (!r) return;
    if (r.remove) { c.conditions = c.conditions.filter(y => y !== k); battleLog(`${c.name} is no longer ${k.name.toLowerCase()}.`, true); }
    else Object.assign(k, { rounds: r.rounds ? Number(r.rounds) : null, ends: r.ends });
    redraw();
  });
  $$('[data-leg]').forEach(x => {
    x.onclick = () => { const c = find(x); c.legendaryUsed = Math.min(c.legendary, (c.legendaryUsed || 0) + 1); redraw(); };
    x.oncontextmenu = e => { e.preventDefault(); const c = find(x); c.legendaryUsed = Math.max(0, (c.legendaryUsed || 0) - 1); redraw(); };
  });
  $$('[data-rech]').forEach(x => x.onclick = () => { const c = find(x); const v = c.recharge[x.dataset.rech]; v.ready = !v.ready; redraw(); });
  $$('[data-ds]').forEach(x => x.onclick = () => {
    const c = find(x);
    const d = { ok: 0, fail: 0, ...(c.death || {}) };
    const k = x.dataset.ds, i = Number(x.dataset.i);
    d[k] = d[k] > i ? i : i + 1;
    d.dead = d.fail >= 3; d.stable = d.ok >= 3;
    c.death = d;
    if (d.dead) battleLog(`${c.name} has died.`, true);
    else if (d.stable) battleLog(`${c.name} is stable.`, true);
    redraw();
  });
  $$('[data-dsroll]').forEach(x => x.onclick = () => {
    const c = find(x);
    const r = G.rollDice('1d20', Math.random);
    const out = G.deathSave(c, r.total);
    logRoll({ who: c.name, label: 'Death saving throw', lines: [{ text: out.event, total: r.total, detail: '', cls: r.total === 20 ? 'crit' : r.total === 1 ? 'fumble' : '' }] });
    const { event, ...rest } = out;
    Object.assign(c, rest);
    battleLog(event, /died|stable|feet/.test(event));
    if (c.hp > 0) syncPcHp(c);
    redraw();
  });
  $$('.b-row [data-mount]').forEach(x => x.onclick = () => mountDialog(find(x)));
  if ($('[data-mount-sel]')) $('[data-mount-sel]').onclick = () => mountDialog(sel);
  if ($('[data-dismiss]')) $('[data-dismiss]').onclick = () => { dismissSummon(sel, 'is dismissed'); redraw(); };
  if ($('[data-wild-end]')) $('[data-wild-end]').onclick = () => { endWildShape(sel); redraw(); };
  if ($('[data-wild-again]')) $('[data-wild-again]').onclick = () => wildShape(sel);
  $('#b-summon').onclick = summonDialog;
  $$('[data-hide]').forEach(x => x.onclick = () => { const c = find(x); c.hidden = !c.hidden; if (!c.hidden) battleLog(`${c.name} appears!`, true); redraw(); });
  $$('[data-remove]').forEach(x => x.onclick = () => {
    const c = find(x);
    if (b.turn === c.id) Object.assign(b, G.nextTurn(b));
    b.list = b.list.filter(k => k !== c);
    redraw();
  });
  $$('[data-sf]').forEach(i => i.onchange = () => {
    const k = i.dataset.sf;
    sel[k] = k === 'notes' ? i.value : Number(i.value) || 0;
    if (k === 'hp' || k === 'hpMax') sel.hp = Math.max(0, Math.min(sel.hp, sel.hpMax));
    if (sel.kind === 'pc' && k === 'hp') syncPcHp(sel);
    redraw();
  });
  $$('[data-bmode]').forEach(x => x.onclick = () => { b.mode = x.dataset.bmode; b.plan = null; redraw(); });
  $$('[data-range]').forEach(x => x.onchange = () => { const c = find(x); setRange(c, x.value); redraw(); });
  $$('[data-ai]').forEach(x => x.onchange = () => {
    sel.ai ||= {};
    if (x.dataset.ai === 'on') sel.ai.on = x.value === '' ? null : x.value === '1';
    else sel.ai.tactic = x.value || null;
    b.plan = null;
    redraw();
  });
  $$('[data-plan]').forEach(x => x.onclick = () => { if (state.pendingHits) commitPending(); planAction(x.dataset.plan, x.dataset.v); });
  $$('[data-legend-use]').forEach(x => x.onclick = () => { if (state.pendingHits) commitPending(); useLegendary(x.dataset.legendUse, x.dataset.legendTarget); });
  $$('[data-legend-skip]').forEach(x => x.onclick = () => { const b = battle(); (b.legendSkip ||= []).push(`${b.round}:${b.turn}:${x.dataset.legendSkip}`); b.legendSkip = b.legendSkip.slice(-40); saveBattle(); renderBattle(); });
  $$('[data-ph]').forEach(x => x[x.tagName === 'SELECT' ? 'onchange' : 'onclick'] = () => {
    const p = state.pendingHits, h = p?.list[Number(x.dataset.ph)];
    if (!h) return;
    pausePending();
    if (x.dataset.phf === 'target') h.target = x.value;
    else if (x.dataset.phf === 'half') h.half = !h.half;
    else p.list.splice(Number(x.dataset.ph), 1);
    if (!p.list.length) state.pendingHits = null;
    renderBattle();
  });
  $$('[data-ph-apply]').forEach(x => x.onclick = commitPending);
  const card = $('.b-pending');
  if (card) {
    card.onmouseenter = holdPending;
    card.onmouseleave = releasePending;
    // Drawn again under a resting mouse (or after it left): hold or carry on to match.
    if (card.matches(':hover')) holdPending(); else releasePending();
  }
  $$('[data-ph-cancel]').forEach(x => x.onclick = () => { clearTimeout(pendingTimer); state.pendingHits = null; battleLog('The DM held that damage back.'); renderBattle(); });
  const one = $('[data-rollinit]');
  if (one) one.onclick = () => { sel.init = rollInit(sel); backToTop(); redraw(); };
  const step = async n => {
    // Everyone needs an initiative before the first turn, or the order shifts under it once they're rolled.
    if (!b.turn && n > 0 && b.list.some(c => (c.init == null || c.init === '') && c.kind !== 'lair') && !await rollAllInit()) return;
    const was = { turn: b.turn, round: b.round };
    // An AI monster whose turn passes without its plan being done says so in the log.
    const leaving = b.list.find(c => c.id === b.turn);
    if (n > 0 && leaving?.kind === 'monster' && aiOn(leaving) && leaving.hp > 0 && b.plan && !b.plan.done && b.plan.key === `${leaving.id}:${b.round}`) battleLog(`${leaving.name}'s turn passed without its plan (${b.plan.kind === 'act' ? 'not done' : 'no distance set'}).`);
    const r = G.advanceTurn(b, n, set);
    Object.assign(b, r.battle);
    // Until the first turn is over, a change to initiative moves the turn back to whoever now goes first.
    b.firstTurn = !was.turn && n > 0;
    if (b.turn && b.turn !== was.turn) fx('turn', { id: b.turn });
    if (n > 0 && b.turn && (!was.turn || b.round > was.round)) fx('round', { round: b.round });
    // A summon's rounds count down at the start of its summoner's turn (its own, with no summoner left).
    if (n > 0 && b.turn !== was.turn) for (const c of b.list) if (c.summon?.rounds != null && (c.summon.by === b.turn || (!b.list.some(x => x.id === c.summon.by) && c.id === b.turn))) c.summon.rounds--;
    for (const e of r.events) battleLog(e, /died|Lair/.test(e));
    if (r.events.length) toast(r.events.join(' '));
    // A new turn starts clean: the last roll's Auto buttons go, so nothing old gets dealt by mistake.
    if (b.turn !== was.turn) { disarmRoll(); if (state.rolls[0]) state.rolls[0].stale = true; }
    b.sel = null;
    redraw();
    // Whoever's turn it is comes into view, and their stat block (with any AI plan on top) starts at the top.
    if (b.turn !== was.turn) { $('.b-detail')?.scrollTo(0, 0); $(`.b-row[data-id="${b.turn}"]`)?.scrollIntoView({ block: 'nearest' }); }
  };
  // Moving the turn on applies any damage still waiting.
  if ($('#b-next')) { $('#b-next').onclick = () => { if (state.pendingHits) commitPending(); step(1); }; $('#b-prev').onclick = () => step(-1); }
  $('#b-party').onclick = () => {
    const have = new Set(b.list.map(c => c.page));
    const add = pcs().filter(p => !have.has(p.id));
    if (!add.length) return toast(pcs().length ? 'The whole party is already here.' : 'No party members yet. Add them on the Party screen.', true);
    for (const p of add) addCombatant({ kind: 'pc', page: p.id, name: p.meta.title, ac: Number(p.meta.ac) || 10, hp: Number(p.meta.hp) || 0, hpMax: Number(p.meta.hpMax) || 0, initBonus: Number(p.meta.initBonus) || 0 });
    redraw();
  };
  $('#b-monster').onclick = async () => {
    const r = await formDialog('Add monsters', `
      <label class="field">Monster<input name="name" required placeholder="Start typing a name"></label>
      <div class="row"><label class="field">How many<input name="count" type="number" min="1" max="30" value="1"></label>
      <label class="field">Hit points<select name="hp"><option value="avg">Average</option><option value="roll">Roll each</option></select></label></div>
      <label class="field">Riding <span class="muted">(optional: each one comes on its own mount)</span><input name="mount" placeholder="Riding Horse, Wolf, Giant Lizard…"></label>
      <label class="check"><input type="checkbox" name="hostile" checked> Hostile: an enemy of the party (untick for a friendly creature on the party's side)</label>
      <label class="check"><input type="checkbox" name="hidden"> Hidden from the players for now</label>`, 'Add', form => {
      const beasts = G.bestiaryCatalog(state.data).map(m => ({ value: m.name, label: `CR ${G.crLabel(Number(m.cr))}` }));
            attachPicker($('[name="name"]', form), () => beasts);
      attachPicker(form.elements.mount, () => SU.mountCandidates(state.data.bestiary?.monsters, G.monsterInfo(state.data, form.elements.name.value)?.size || 'Medium').sort((x, y) => x.name.localeCompare(y.name)).map(m => ({ value: m.name, label: `${m.size} · CR ${G.crLabel(Number(m.cr))}` })));
    });
    if (!r) return;
    const m = G.monsterInfo(state.data, r.name);
    if (!m) return toast(`There's no ${r.name} in the bestiary.`, true);
    const steed = r.mount?.trim() ? G.monsterInfo(state.data, r.mount) : null;
    if (r.mount?.trim() && !steed) return toast(`There's no ${r.mount} in the bestiary to ride.`, true);
    if (steed && !SU.canCarry(steed.size, m.size)) return toast(`${steed.name} (${steed.size}) is too small to carry ${m.name} (${m.size}).`, true);
    const before = b.list.length;
    addMonsters(m, Math.max(1, Math.min(30, Number(r.count) || 1)), { rollHp: r.hp === 'roll' });
    const added = b.list.slice(before);
    // A friendly creature is on the party's side: it fights with its stat block but isn't counted as an enemy.
    if (!r.hostile) added.forEach(c => { c.kind = 'other'; c.stat ||= m; });
    if (r.hidden) added.forEach(c => { c.hidden = true; });
    for (const c of added) if (steed) {
      const at = b.list.length;
      addMonsters(steed, 1);
      const ride = b.list[at];
      if (!r.hostile) { ride.kind = 'other'; ride.stat ||= steed; }
      if (r.hidden) ride.hidden = true;
      mountUp(c, ride);
    }
    if (r.hostile && !steed) maybeMountEnemies(added, 0.1);
    redraw();
  };
  $('#b-other').onclick = async () => {
    // Wiki NPCs to pick from; one with a stat block on its page comes in with its numbers and attacks.
    const npcs = () => [...state.pages.values()].filter(p => p.meta.type === 'npc').sort((x, y) => x.meta.title.localeCompare(y.meta.title));
    const npcNamed = name => npcs().find(p => p.meta.title.toLowerCase() === String(name).trim().toLowerCase());
    let picked = null;
    const r = await formDialog('Add someone else', `
      <label class="field">Name<input name="name" required placeholder="Pick an NPC from the wiki, or type a summoned wolf, a trap…"></label>
      <p class="hint" data-npc-hint style="margin:0 0 6px">Pick an NPC from the list to bring in their stat block, or type any name.</p>
      <div class="row"><label class="field">AC<input name="ac" type="number" value="12"></label><label class="field">Hit points<input name="hp" type="number" value="10"></label>
      <label class="field">Init bonus<input name="init" type="number" value="0"></label></div>
      <label class="check"><input type="checkbox" name="enemy"> An enemy (gets health warnings and counts as a monster)</label>`, 'Add', form => {
      const name = form.elements.name, hint = $('[data-npc-hint]', form);
      attachPicker(name, () => npcs().map(p => ({ value: p.meta.title, label: `${p.meta.rank ? `${p.meta.rank} rank · ` : ''}${/class="statblock"/.test(p.body) ? 'stat block' : 'no stat block'}` })));
      name.addEventListener('change', () => {
        const p = npcNamed(name.value);
        const stat = p && G.statFromNpcPage(p.meta, p.body);
        picked = stat ? { page: p, stat } : null;
        if (!p) { hint.textContent = 'Pick an NPC from the list to bring in their stat block, or type any name.'; return; }
        if (!stat) { hint.textContent = `${p.meta.title}'s page has no stat block, so set the numbers here.`; return; }
        form.elements.ac.value = parseInt(stat.ac, 10) || 10;
        form.elements.hp.value = stat.hp || 1;
        form.elements.init.value = Number(G.abilityMod(stat.abilities?.[1] ?? 10));
        hint.textContent = `Using the stat block on ${p.meta.title}'s page: AC ${stat.ac}, ${stat.hp} hit points, ${stat.actions.length} action${stat.actions.length === 1 ? '' : 's'}.`;
      });
    });
    if (!r) return;
    const name = r.name.trim();
    const npc = picked && picked.page.meta.title.toLowerCase() === name.toLowerCase() ? picked : null;
    const page = npc?.page.id || resolve(name);
    addCombatant({ kind: r.enemy ? 'monster' : 'other', name, monster: name, page, ...(npc ? { stat: npc.stat } : {}),
      ac: Number(r.ac) || 10, hp: Number(r.hp) || 1, hpMax: Number(r.hp) || 1, initBonus: Number(r.init) || 0 });
    redraw();
  };
  $('#b-lair').onclick = () => {
    if (b.list.some(c => c.kind === 'lair')) return toast('There is already a lair action marker.', true);
    addCombatant({ kind: 'lair', name: 'Lair action', init: 20, initBonus: -99, ac: 0, hp: 0, hpMax: 0 });
    redraw();
  };
  // Players roll their own initiative: one box each for what they rolled. Everyone else is rolled here.
  // True once everyone has an initiative, false if the DM closed the party's box.
  const rollAllInit = async () => {
    const party = b.list.filter(c => c.kind === 'pc');
    if (party.length) {
      const r = await formDialog('Party initiative', `<p class="hint" style="margin:0 0 8px">Type each player's total. Left empty, it's rolled for them with their bonus.</p>
        <div class="b-pcinit">${party.map(c => `<label class="field">${esc(c.name)} <span class="muted">(${c.initBonus >= 0 ? '+' : ''}${c.initBonus})</span><input name="${esc(c.id)}" type="number" value="${c.init ?? ''}" placeholder="Roll for them"></label>`).join('')}</div>`, 'Roll the rest');
      if (!r) return false;
      for (const c of party) c.init = r[c.id] === '' || r[c.id] == null ? null : Number(r[c.id]);
    }
    const rolled = [];
    for (const c of b.list) if ((c.kind === 'monster' || c.init == null || c.init === '') && c.kind !== 'lair') { c.init = rollInit(c, false); rolled.push(c); }
    if (!rolled.length && !party.length) { toast('Everyone has an initiative already.', true); return true; }
    // The whole order, typed totals and all, so the tray shows who goes when.
    const typed = party.filter(c => !rolled.includes(c) && c.init != null);
    if (rolled.length || typed.length) logRoll({ who: '', label: 'Initiative', lines: G.battleOrder([...rolled, ...typed]).map(c => ({ text: c.name, total: c.init, detail: typed.includes(c) ? 'typed' : '' })) });
    backToTop();
    redraw();
    return true;
  };
  $('#b-init').onclick = rollAllInit;
  $('#b-player').onclick = () => attempt(async () => { await api.battle.openPlayerView(); saveBattle(); });
  $('#b-settings').onclick = openBattleSettings;
  $('#b-compact').onclick = () => { try { localStorage.setItem('b-compact', compactRows() ? '0' : '1'); } catch {} renderBattle(); };
  if ($('#b-undo')) { $('#b-undo').onclick = () => undoBattle(); $('#b-redo').onclick = () => undoBattle(true); }
  for (const id of ['#b-end', '#b-end2']) if ($(id)) $(id).onclick = endBattle;
  const keys = e => {
    if (state.view?.kind !== 'battle') return document.removeEventListener('keydown', keys);
    const z = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && (z === 'z' || z === 'y') && !e.target.closest('input, textarea, dialog')) {
      e.preventDefault();
      return undoBattle(z === 'y' || e.shiftKey);
    }
    if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest('input, textarea, select, dialog')) return;
    const k = e.key.toLowerCase();
    if (k === 'n' && b.list.length) step(1);
    // Enter applies the dice tray's latest roll to its target(s).
    if (e.key === 'Enter' && !e.target.closest('button, a')) { const ap = $('#dt-log .dt-roll.latest [data-apply]', trayEl()); if (ap) { e.preventDefault(); ap.click(); return; } }
    const card = $('.b-ai:not(.done)');
    if (!card) return;
    const btn = { d: '[data-plan="do"], [data-plan="apply"]', a: '[data-plan="again"]', s: '[data-plan="skip"]' }[k];
    if (btn && $(btn, card)) { e.preventDefault(); $(btn, card).click(); }
  };
  document.removeEventListener('keydown', state.battleKeys || (() => {}));
  state.battleKeys = keys;
  document.addEventListener('keydown', keys);
}

function rollInit(c, log = true) {
  const r = G.rollDice({ dice: [{ n: 1, d: 20, sign: 1 }], mod: Number(c.initBonus) || 0 }, Math.random);
  if (log) logRoll({ who: c.name, label: 'Initiative', lines: [{ text: r.expr, total: r.total, detail: G.rollBreakdown(r) }] });
  return r.total;
}

/** End the battle: a summary, and the battle written into a session's notes. */
async function endBattle() {
  if (state.pendingHits) commitPending();
  const b = battle();
  const set = bSettings();
  const levels = b.list.filter(c => c.kind === 'pc').map(c => Number(state.pages.get(c.page)?.meta.level) || 1);
  // Summoned creatures vanish: no cores, parts or XP from them.
  const sum = G.battleSummary({ ...b, list: b.list.filter(c => !c.summon) }, statFor, levels, Math.random, G.coreIntactChance(state.data), state.data);
  const sessions = sessionPages();
  const foes = [...new Set(b.list.filter(c => c.kind === 'monster').map(c => c.stat?.name || c.monster))];
  const title = foes.length ? `Battle: ${foes.slice(0, 3).join(', ')}${foes.length > 3 ? ' and more' : ''}` : 'Battle';
  let where = set.toSession === 'never' ? 'none' : sessions.length ? sessions[0].id : 'new';
  let heading = title;
  if (set.toSession === 'ask') {
    const cores = Object.entries(sum.cores).map(([r, n]) => `${n} ${r}`).join(', ');
    const r = await formDialog('End the battle', `
      <div class="b-sum"><p><b>${sum.rounds}</b> round${sum.rounds === 1 ? '' : 's'}${sum.difficulty.label ? ` · <b>${esc(sum.difficulty.label)}</b>` : ''} · ${sum.xp.toLocaleString()} XP of monsters, <b>${sum.earnedXp.toLocaleString()}</b> earned</p>
        ${sum.defeated.length ? `<p>Defeated: ${esc(sum.defeated.map(c => c.name).join(', '))}</p>` : ''}
        ${cores || sum.cracked ? `<p>Monster cores to loot: <b>${esc(cores || 'none intact')}</b>${sum.cracked ? ` <span class="muted">(${sum.cracked} cracked)</span>` : ''}</p>` : ''}
        ${sum.parts.items.length ? `<p>Monster parts: ${esc(G.salvageText(sum.parts))}, worth about <b>${esc(G.formatSpirit(sum.parts.value))}</b></p>` : ''}
        ${sum.fallen.length ? `<p>Down: ${esc(sum.fallen.map(c => c.name).join(', '))}</p>` : ''}</div>
      ${sum.parts.value ? `<label class="check"><input type="checkbox" name="sell" checked> Sell the parts: add ${esc(G.formatSpirit(sum.parts.value))} to the party purse</label>` : ''}
      <label class="field">Add to the session notes<select name="where">
        ${sessions.map((p, i) => `<option value="${esc(p.id)}" ${i === 0 ? 'selected' : ''}>${esc(p.meta.title)}${i === 0 ? ' (latest)' : ''}</option>`).join('')}
        <option value="new" ${sessions.length ? '' : 'selected'}>A new session note</option><option value="none">Don't add it</option></select></label>
      <label class="field">Heading<input name="heading" value="${esc(title)}"></label>
      <p class="hint" style="margin:0">Everyone is then taken off the battle screen. Party members keep their HP on their sheets.</p>`, 'End battle');
    if (!r) return false;
    where = r.where; heading = r.heading.trim() || title;
    sum.partsSold = !!r.sell && sum.parts.value > 0;
  } else sum.partsSold = sum.parts.value > 0;
  if (sum.partsSold) await addToPurse(sum.parts.value, 'monster parts');
  if (where !== 'none') {
    const md = G.battleToMarkdown(sum, b, heading);
    await attempt(async () => {
      if (where === 'new') {
        const next = Math.max(0, ...sessions.map(p => Number(p.meta.number) || 0)) + 1;
        const id = await api.pages.create(`Session ${next}`, { type: 'session', number: next, date: new Date().toISOString().slice(0, 10) }, md);
        state.pages.set(id, await api.pages.read(id));
        rebuildIndex(); renderTree();
        where = id;
      } else {
        const p = state.pages.get(where);
        p.body = `${p.body.replace(/\s+$/, '')}\n\n${md}`;
        await api.pages.write(p.id, p.meta, p.body);
      }
      toast(`The battle is in ${state.pages.get(where).meta.title}.`);
    });
  }
  state.saved.battle = { round: 1, turn: null, list: [], nextId: 1, sel: null, log: [] };
  disarmRoll();
  resetBattleUndo();
  saveBattle();
  renderBattle();
  return true;
}

/** Battle settings: health states, condition colours, and what runs by itself. */
async function openBattleSettings() {
  const s = bSettings();
  const rows = [...s.health, {}, {}].slice(0, Math.max(3, s.health.length));
  const check = (name, on, label) => `<label class="check"><input type="checkbox" name="${name}" ${on ? 'checked' : ''}> ${label}</label>`;
  const r = await formDialog('Battle settings', `
    <p class="settings-group">Health states</p>
    <p class="hint" style="margin:0 0 6px">A creature under the percentage of its HP gets the name, an outline in the colour and, if ticked, a slow flash. The lowest that fits is shown.</p>
    <div class="bs-health">${rows.map((h, i) => `<div class="row"><input name="h${i}name" value="${esc(h.name || '')}" placeholder="Name"><span class="muted">under</span><input name="h${i}below" type="number" min="1" max="100" value="${h.below ?? ''}" style="width:64px"><span class="muted">%</span>
      <input name="h${i}color" type="color" value="${esc(h.color || '#ff9f43')}">${check(`h${i}flash`, h.flash, 'Flash')}</div>`).join('')}</div>
    <label class="field">Show them on<select name="healthFor"><option value="enemies" ${s.healthFor !== 'everyone' ? 'selected' : ''}>Enemies only</option><option value="everyone" ${s.healthFor === 'everyone' ? 'selected' : ''}>Everyone, the party too</option></select></label>
    <p class="settings-group">Condition colours</p>
    <div class="bs-colors">${[...G.CONDITIONS, '*'].map(n => `<label><input type="color" name="c:${esc(n)}" value="${esc(n === '*' ? s.customColor : s.conditionColors[n] || s.customColor)}"> ${n === '*' ? 'Others' : esc(n)}</label>`).join('')}</div>
    <p class="settings-group">Runs by itself</p>
    ${check('a:durations', s.auto.durations, 'Conditions with a number of rounds count down and run out')}
    ${check('a:recharge', s.auto.recharge, 'Used recharge abilities roll to come back at the start of the monster\'s turn')}
    ${check('a:legendary', s.auto.legendary, 'Legendary actions come back at the start of the monster\'s turn')}
    ${check('a:skipDefeated', s.auto.skipDefeated, 'Defeated monsters are skipped')}
    ${check('a:deathSaves', s.auto.deathSaves, 'A downed party member is reminded to roll a death save on their turn')}
    ${check('a:concentration', s.auto.concentration, 'Damage to someone concentrating asks for a Constitution save')}
    ${check('a:resistances', s.auto.resistances, 'Damage applied from a roll counts resistances, immunities and vulnerabilities')}
    ${check('a:seatChecks', s.auto.seatChecks, 'Riders knocked prone (and poor riders when hit) roll a DC 10 Dexterity save to stay on; a mount that drops or falls prone throws its rider')}
    ${check('a:enemyMounts', s.auto.enemyMounts, 'Humanoid enemies from encounters sometimes arrive riding a mount')}
    <label class="field">Rank ward (a higher-rank creature resists lower-rank attackers: half damage)<select name="rankWard">
      ${[['auto', 'Applied: the damage is halved'], ['warn', 'Only a warning'], ['off', 'Off']].map(([v, l]) => `<option value="${v}" ${s.rankWard === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="field">When a battle ends<select name="toSession">
      ${[['ask', 'Ask, with a summary, which session to add it to'], ['latest', 'Add it to the latest session without asking'], ['never', 'Don\'t add it to the session notes']].map(([v, l]) => `<option value="${v}" ${s.toSession === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <p class="settings-group">Effects</p>
    ${check('effects', s.effects, 'Animate hits, misses, healing, turns and knockouts')}
    <p class="settings-group">AI mode</p>
    ${check('i:finishDowned', s.ai.finishDowned, 'AI monsters may keep attacking party members who are down')}
    <p class="settings-group">Player view</p>
    ${check('p:partyHp', s.player.partyHp, 'Show the party\'s hit points')}
    ${check('p:enemyHealth', s.player.enemyHealth, 'Show how hurt enemies look (Healthy, your health states, Down)')}
    ${check('p:conditions', s.player.conditions, 'Show conditions')}
    <label class="check"><input type="checkbox" name="reset"> Put everything back to the defaults</label>`, 'Save');
  if (!r) return;
  if (r.reset) { delete state.saved.battleSettings; saveBattle(); return renderBattle(); }
  const health = rows.map((_, i) => ({ name: (r[`h${i}name`] || '').trim(), below: Number(r[`h${i}below`]) || 0, color: r[`h${i}color`], flash: !!r[`h${i}flash`] })).filter(h => h.name && h.below > 0);
  const conditionColors = Object.fromEntries(G.CONDITIONS.map(n => [n, r[`c:${n}`]]));
  const flag = p => k => !!r[`${p}:${k}`];
  state.saved.battleSettings = {
    health, healthFor: r.healthFor, conditionColors, customColor: r['c:*'], rankWard: r.rankWard, toSession: r.toSession, effects: !!r.effects,
    auto: Object.fromEntries(Object.keys(G.BATTLE_DEFAULTS.auto).map(k => [k, flag('a')(k)])),
    player: Object.fromEntries(Object.keys(G.BATTLE_DEFAULTS.player).map(k => [k, flag('p')(k)])),
    ai: Object.fromEntries(Object.keys(G.BATTLE_DEFAULTS.ai).map(k => [k, flag('i')(k)])),
  };
  saveBattle();
  renderBattle();
}

/** The players' window: turn order, health words and conditions, kept up to date from the DM's window. */
function startPlayerView() {
  document.body.classList.add('player-window');
  document.body.innerHTML = '<main id="player-view"><p class="hint">Waiting for the battle…</p></main>';
  const draw = s => {
    const set = { ...bSettings(), ...(s?.look || {}) };
    const root = $('#player-view');
    if (!s?.list?.length) { root.innerHTML = '<div class="pv-empty">No battle right now.</div>'; return; }
    root.innerHTML = `<div class="pv-head"><h1>Round ${s.round}</h1></div>
      <div class="pv-list">${s.list.map(c => {
        const hs = set.health.find(h => h.name === c.state);
        return `<div data-id="${esc(c.id)}" class="pv-row kind-${c.kind}${c.id === s.turn ? ' current' : ''}${hs ? ' hs' : ''}${hs?.flash ? ' flash' : ''}${c.health === 'Down' || c.health === 'Dead' ? ' down' : ''}"${hs ? ` style="--hs:${esc(hs.color)}"` : ''}>
          <span class="pv-name">${c.id === s.turn ? '▶ ' : ''}${esc(c.name)}</span>
          <span class="pv-health">${esc(c.hp || c.health)}</span>
          <span class="pv-conds">${c.conditions.map(n => `<span class="chip cond" style="--c:${esc(set.conditionColors[n] || set.customColor)}">${esc(n)}</span>`).join('')}</span>
          ${c.health === 'Dead' || (c.kind === 'monster' && c.health === 'Down') ? '<span class="b-skull" aria-hidden="true">☠</span>' : ''}</div>`;
      }).join('')}</div>`;
    playFx(root, s.fx || []);
  };
  draw(null);
  api.battle.onUpdate(s => draw(s));
  api.battle.ready();
}

// ---------- settings ----------

const MODES = [['dark', 'Dark'], ['light', 'Light'], ['system', 'Match my computer']];
const ACCENTS = [
  ['amethyst', 'Amethyst', '#c9a2ff'], ['ember', 'Ember', 'hsl(22 90% 62%)'], ['gold', 'Gold', 'hsl(42 90% 58%)'],
  ['forest', 'Forest', 'hsl(135 60% 52%)'], ['teal', 'Teal', 'hsl(172 70% 48%)'], ['ocean', 'Ocean', 'hsl(208 90% 62%)'],
  ['crimson', 'Crimson', 'hsl(354 85% 60%)'], ['rose', 'Rose', 'hsl(328 85% 66%)'], ['slate', 'Slate', 'hsl(215 25% 62%)'],
];

/** The look is kept per computer, like a window size: mode (dark, light, system) and colour theme. */
function readLook() {
  let mode = 'dark', accent = 'amethyst';
  try { mode = localStorage.getItem('theme') || mode; accent = localStorage.getItem('accent') || accent; } catch {}
  return { mode: MODES.some(m => m[0] === mode) ? mode : 'dark', accent: ACCENTS.some(a => a[0] === accent) ? accent : 'amethyst' };
}

function applyLook({ mode, accent }) {
  const light = mode === 'light' || (mode === 'system' && matchMedia('(prefers-color-scheme: light)').matches);
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
  document.documentElement.dataset.accent = accent;
}

async function openSettings() {
  const was = readLook();
  const radios = (name, items, cur, swatch) => items.map(([v, label, color]) => `<label class="swatch"><input type="radio" name="${name}" value="${v}" ${v === cur ? 'checked' : ''}>${swatch ? `<i style="background:${color}"></i>` : ''}${esc(label)}</label>`).join('');
  const pending = formDialog('Settings', `
    <p class="settings-group">Mode</p><div class="swatches">${radios('mode', MODES, was.mode)}</div>
    <p class="settings-group">Colour theme</p><div class="swatches">${radios('accent', ACCENTS, was.accent, true)}</div>
    <p class="settings-group">Effects</p><label class="inline-check" style="margin-left:0"><input type="checkbox" name="fx" ${appFxOn() ? 'checked' : ''}> Animate rerolls, reveals, rests, essences, pins, toasts and the trash</label>
    <p class="hint" style="margin:0">The battle screen has its own Effects switch in its ⚙ Settings.</p>
    <p class="hint" style="margin:0">Changes show as you pick them. These settings are kept on this computer and apply to every campaign.</p>
    ${state.dm ? `<p class="settings-group">Systems in this campaign</p>
    <p class="hint" style="margin:0 0 6px">Turn off what your table doesn't use yet. Anything off is put away everywhere, and its data is kept for when you switch it back on.</p>
    <div class="row" style="margin-bottom:6px"><button type="button" class="btn small" data-sys-preset="simple" title="The wiki, party sheets, sessions, reference pages, the map, the everyday generators and a plain battle tracker">Simple</button><button type="button" class="btn small" data-sys-preset="all">Everything</button></div>
    <div class="sys-list">${systemsHtml()}</div>
    <p class="settings-group">Prices</p>
    <label class="inline-check" style="margin-left:0" title="For late-game campaigns: copper and silver pieces stop mattering, so a flask of oil or a meal costs 1 gp"><input type="checkbox" name="priceFloor" ${state.saved.priceFloor ? 'checked' : ''}> Late-game prices: nothing costs less than 1 gp</label>
    <p class="hint" style="margin:6px 0 0"><a href="#" id="settings-tour">Take the tour again</a></p>` : ''}`, 'Save');
  const form = $('#dialog form');
  form.addEventListener('change', () => { const f = new FormData(form); applyLook({ mode: f.get('mode'), accent: f.get('accent') }); });
  if (state.dm) {
    wireSystemsForm(form);
    $('#settings-tour', form).onclick = e => { e.preventDefault(); $('#dialog').close(); setTimeout(() => startTour(), 50); };
  }
  const r = await pending;
  const look = r ? { mode: r.mode, accent: r.accent } : was;
  if (r) try { localStorage.setItem('theme', look.mode); localStorage.setItem('accent', look.accent); localStorage.setItem('app-fx', r.fx ? '1' : '0'); } catch {}
  applyAppFx();
  applyLook(look);
  if (r && state.dm && !!r.priceFloor !== !!state.saved.priceFloor) {
    state.saved.priceFloor = !!r.priceFloor;
    G.setPriceFloor(r.priceFloor ? 1 : 0);
    await saveSaved();
    if (!SYSTEMS.some(x => !!r['sys-' + x.key] !== (state.saved.systems?.[x.key] !== false))) render();
  }
  if (r && state.dm && SYSTEMS.some(x => !!r['sys-' + x.key] !== (state.saved.systems?.[x.key] !== false))) await saveSystems(r);
}

// ---------- help ----------
// The ? in the top bar (or F1) says in a few lines what the screen in front of you is for.
// The first time the app opens on a computer, a short tour points out where things are.

const GETTING_STARTED = 'Getting Started';
const HELP = {
  home: ['Home', 'The front page of the campaign wiki. Every underlined name is a link; red ones are pages nobody has written yet.', 'Use the sidebar groups to get around: Play for the table, World for the calendar and map, Reference for rules, Prep for generators.'],
  party: ['Party', "Everyone's character sheet, the shared purse of spirit coins and the party inventory.", 'Click a character to open their sheet. Changes save by themselves.'],
  sessions: ['Sessions', 'One page of notes per session. Anyone you link in the notes gets that session in their History.', 'New session starts the next one.'],
  world: ['Calendar', "The world's date, what's coming up and the chronicle of what happened.", 'Advance time moves the date on, and the world changes as the days pass. Every change can be undone. Turn parts of it off in Settings, under Systems.'],
  digest: ['Since last session', 'Everything that changed in the world since the last session began, for prep.', 'Add to session notes copies it into the latest session as DM notes.'],
  news: ['News and rumours', 'What the party could have heard: word travels about 30 miles a day.', 'Players see this too. DM-only entries never show here.'],
  legends: ['Legends', 'Everything the chronicle remembers, by place, person, faction or year, and a web of who is tied to whom.', 'Players see only what they have heard.'],
  essences: ['Essences', 'Every essence, divine essence, confluence and awakening stone.', 'Search by name or theme, and filter by affinity and rarity.'],
  items: ['Items', 'Armour, weapons, gear, magic items and the goods of this world, with prices and where they are sold.', 'Search, and filter by category, rarity or where it is sold.'],
  spells: ['Spells', 'Every spell, with a filter by level, school and class.', 'Click a spell name anywhere in the app to see its card.'],
  bestiary: ['Bestiary', "Monster stat blocks, with each monster's rank in this world.", 'Add to battle puts the monster on the battle screen.'],
  map: ['World map', 'The world with your places on it. Scroll to zoom and drag to move.', 'Click a place to see its page in the panel beside the map.'],
  battle: ['Battle', 'An initiative tracker: add the party and monsters, roll initiative and press Start.', 'Click a card for its stat block. Next turn (N) moves on; Ctrl+Z undoes any change.', [
    'Rolling: press ⚄ Roll on a stat block. The dice tray picks a target (a heal picks the most hurt ally). Change it there if you need to, then press Apply, or Enter.',
    'Areas and saves: add everyone caught (+ All enemies does the lot), check the saves, then Apply to all of them at once.',
    'Auto on a row deals the last roll to that row instead, which suits an area with no save. It clears when the turn moves on.',
    'Spell slots: party members\' slots show as pips on their stat block, and casting spends one. Out of slots? Shift+click casts it anyway.',
    'Concentration: when a concentrating creature is hurt, a check appears in the tray. Monsters roll it; for a player press Roll it, Made it or Failed. A failure ends the spell and its effects.',
    'Summons: ✦ Summon on a summoning spell or a companion feature (Steel Defender, Primal Companion) brings the creature in, right after its summoner. + Summon covers items and anything else. A summon goes when its rounds run out, its summoner stops concentrating, or it drops to 0.',
    'Wild Shape: ✦ Wild Shape on a druid\'s stat block swaps their card for a beast (or a custom creature), with temporary hit points; End Wild Shape, or dropping to 0, turns them back.',
    'Mounts: 🐎 on a row puts it on a creature (or a new one from the bestiary); + Monster can bring riders in too. A rider goes just before its mount, on its initiative, and a fall puts it prone at the end of the order.',
    'AI turns: in AI mode a monster\'s plan shows at the top of its stat block. Say roughly how far away it is the first time; then D does it, A gives another idea and S skips.',
    'End battle writes the fight into the session notes: who was there, who did what and how it ended.',
  ]],
  generators: ['Generators', 'Roll NPCs, encounters, taverns, markets and more, then Save to wiki to keep them as pages.', 'Click any rolled detail to reroll just that part. Some tabs belong to systems you can turn off in Settings.'],
  hooks: ['Saved hooks', 'Story hooks you starred in the Word bank, ready to pull out at the table.', 'Add to a session puts the hook in its notes and marks it used.'],
  lists: ['Generator lists', 'The lists the generators roll from. Edit them to make the generators your own.', 'Reset puts a list back the way it came.'],
  trash: ['Trash', 'Deleted pages, kept for 30 days.', 'Restore puts a page back where it was.'],
  search: ['Search', 'Pages whose title or text match what you typed.', 'Ctrl+K jumps to the search box from anywhere. Enter opens the best match.'],
  campaigns: ['Campaigns', 'Switch campaigns, start a new one, and export or import backups.', 'Each campaign is a folder in Documents\\D&D Campaigns.'],
};
const PAGE_HELP = {
  pc: ["A character's sheet", 'The stat block at the top is worked out from the sheet below it. Change anything on the sheet and it saves by itself.', 'PDF sheet fills in a classic character sheet to print.'],
  npc: ['An NPC page', 'Who they are, how to play them and, if they fight, their stat block.', 'In DM mode, the DM tools strip under the text holds their story, ties and opinion of the party.'],
  location: ['A place', 'What the place is like, who is there and what troubles it.', 'In DM mode, the DM tools strip under the text has buttons to add taverns, markets and temples, and the trade and standing panels.'],
  faction: ['A faction', 'Who they are and what they want.', "In DM mode, the DM tools strip under the text shows its aims, power and allies."],
  cult: ['A cult', 'Cults start hidden from players. Reveal to players shows the page to them.', "In DM mode, the DM tools strip under the text shows its aims, power and allies."],
  session: ['Session notes', 'What happened at the table. Link names with [[ ]] and the session shows in their History.', 'Edit (Ctrl+E) to write.'],
};

function helpFor(v) {
  if (v?.kind === 'page') {
    const p = state.pages.get(v.id);
    if (v.edit) return ['Editing a page', 'Type [[ to link another page. Wrap secrets in a DM block so players never see them.', 'It saves as you type. Ctrl+E goes back to reading.'];
    if (v.id === 'home') return HELP.home;
    return PAGE_HELP[p?.meta.type] || ['A wiki page', 'Underlined names are links. Red ones are pages nobody has written yet; click one to make it.', 'Edit (Ctrl+E) to change it, and 📌 Pin to keep it at the top of the sidebar.'];
  }
  return HELP[v?.kind] || HELP.home;
}

function toggleHelp() {
  const was = $('#help-pop');
  if (was) return was.remove();
  const [title, what, how, more] = helpFor(state.view);
  const gs = resolve(GETTING_STARTED);
  const box = document.createElement('div');
  box.id = 'help-pop';
  box.innerHTML = `<b>${esc(title)}</b><p>${esc(what)}</p><p class="muted">${esc(how)}</p>${more ? `<ul class="help-more">${more.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    <div class="row">${gs ? `<button class="btn small" data-help="guide">${esc(GETTING_STARTED)}</button>` : ''}${state.dm ? '<button class="btn small" data-help="tour">Take the tour</button>' : ''}</div>`;
  document.body.append(box);
  const r = $('#help-btn').getBoundingClientRect();
  box.style.top = `${r.bottom + 6}px`;
  box.style.right = `${Math.max(8, innerWidth - r.right)}px`;
  $$('[data-help]', box).forEach(b => b.onclick = () => { box.remove(); b.dataset.help === 'tour' ? startTour() : openPage(gs); });
  const close = e => { if (!box.contains(e.target) && e.target.id !== 'help-btn') { box.remove(); document.removeEventListener('mousedown', close); } };
  setTimeout(() => document.addEventListener('mousedown', close));
}

const TOUR = [
  { title: 'Welcome', text: 'This app keeps your whole campaign in one place: the world wiki, the party, session notes, generators and a battle tracker. This tour takes a minute.' },
  { sel: '.nav-group[data-group="play"]', title: 'Play', text: 'What you use at the table: the home page, the party\'s sheets, session notes and the battle tracker.' },
  { sel: '.nav-group[data-group="world"]', title: 'World', text: "The world's calendar, the news the party has heard, its legends and the map." },
  { sel: '.nav-group[data-group="reference"]', title: 'Reference', text: 'Rules to look up: essences, items, spells and monsters.' },
  { sel: '.nav-group[data-group="prep"]', title: 'Prep', text: 'Generators roll NPCs, encounters, taverns and more, ready to save as pages. Click a group\'s name to fold it away.' },
  { sel: '#search', title: 'Search', text: 'Find any page. Ctrl+K jumps here from anywhere.' },
  { sel: '#page-tree', title: 'The wiki', text: 'Every page, grouped by kind. Underlined names in a page are links; red ones are pages nobody has written yet.' },
  { sel: '#dm-toggle', title: 'DM mode and player view', text: 'Player view hides secrets, DM-only pages and DM tools, so you can turn the screen to the players.' },
  { sel: '#help-btn', title: 'Help on every screen', text: 'Not sure what a screen is for? Press ? (or F1).' },
  { sel: '#settings-btn', title: 'Settings', text: 'Colours, dark or light, and the systems this campaign uses. Switch on more as your table gets used to the app.' },
];

/** The tour runs once per computer. Tests and other runs with their own campaigns folder skip it unless asked. */
async function maybeTour() {
  let done = true;
  try { done = localStorage.getItem('tour-done') === '1'; } catch {}
  if (done || !state.dm) return;
  if (!(await api.tourAllowed().catch(() => false))) return;
  startTour();
}

function startTour(i = 0) {
  $('#tour')?.remove();
  try { localStorage.setItem('tour-done', '1'); } catch {}
  const steps = TOUR.filter(t => !t.sel || ($(t.sel) && $(t.sel).getClientRects().length));
  const step = steps[i];
  if (!step) return;
  const el = step.sel ? $(step.sel) : null;
  const first = i === 0, last = i === steps.length - 1;
  const gs = resolve(GETTING_STARTED);
  const box = document.createElement('div');
  box.id = 'tour';
  box.innerHTML = `<div class="tour-ring"${el ? '' : ' hidden'}></div><div class="tour-card" role="dialog" aria-label="Tour">
    <div class="muted tour-count">${i + 1} of ${steps.length}</div><b>${esc(step.title)}</b><p>${esc(step.text)}</p>
    ${first && !state.saved?.systems ? `<p class="tour-simple">New to the app? <b>Start simple</b> puts away the advanced systems (the living world, NPC lives, factions, trade, travel and more). Switch them back on any time in Settings.</p>
      <div class="row"><button class="btn small" data-tour="simple">Start simple</button><button class="btn small" data-tour="all">Keep everything</button></div>` : ''}
    ${last && gs ? `<p><a href="#" data-tour="guide">Read ${esc(GETTING_STARTED)}</a> for a walk through your first session.</p>` : ''}
    <div class="row tour-nav"><button class="link-btn" data-tour="end">${last ? 'Close' : 'Skip the tour'}</button><span style="flex:1"></span>
      ${first ? '' : '<button class="btn small" data-tour="back">Back</button>'}<button class="btn small primary" data-tour="next">${last ? 'Done' : 'Next'}</button></div></div>`;
  document.body.append(box);
  const card = $('.tour-card', box);
  if (el) {
    el.scrollIntoView({ block: 'nearest' });
    const r = el.getBoundingClientRect(), ring = $('.tour-ring', box);
    Object.assign(ring.style, { left: `${r.left - 4}px`, top: `${r.top - 4}px`, width: `${r.width + 8}px`, height: `${r.height + 8}px` });
    const right = r.right + 16 + 320 < innerWidth;
    card.style.left = `${right ? r.right + 16 : Math.max(16, r.left - 336)}px`;
    card.style.top = `${Math.max(16, Math.min(r.top, innerHeight - card.offsetHeight - 16))}px`;
  } else card.classList.add('centred');
  $$('[data-tour]', box).forEach(b => b.onclick = async e => {
    e.preventDefault();
    const a = b.dataset.tour;
    if (a === 'simple' || a === 'all') {
      await saveSystems(Object.fromEntries(SYSTEMS.map(x => ['sys-' + x.key, a === 'all' || SIMPLE_SYSTEMS.includes(x.key)])));
      return startTour(i + 1);
    }
    if (a === 'next') return last ? box.remove() : startTour(i + 1);
    if (a === 'back') return startTour(i - 1);
    box.remove();
    if (a === 'guide') openPage(gs);
  });
  box.onkeydown = e => { if (e.key === 'Escape') box.remove(); };
  $('[data-tour="next"]', box).focus();
}

// ---------- wiring ----------

// ---------- link previews ----------
// Resting the mouse on a link to a wiki page shows the start of that page, so a name can be checked without leaving.

function pagePreview(p) {
  const m = p.meta;
  const tpl = document.createElement('template');
  tpl.innerHTML = renderMarkdown(shownBody(p));
  const bits = [...tpl.content.querySelectorAll('p, li')].filter(x => !x.querySelector('p, li') && x.textContent.trim()).slice(0, 3);
  const rank = m.type === 'pc' ? G.pcRank(m) : m.rank;
  const facts = [typeInfo(m.type).label, rank,
    m.type === 'pc' ? `${m.class || ''} level ${Number(m.level) || 1}, ${Number(m.hp) || 0}/${Number(m.hpMax) || 0} HP`.trim() : '',
    m.type === 'session' && m.date ? m.date : ''].filter(Boolean);
  return `<div class="lp-head">${m.image ? `<img src="${esc(imageSrc(m.image))}" alt="">` : ''}<div><b>${esc(m.title)}</b><div class="muted">${esc(facts.join(' · '))}</div></div></div>
    ${bits.map(x => `<p>${x.innerHTML}</p>`).join('') || '<p class="muted">Nothing written yet.</p>'}`;
}
function wirePreviews() {
  const box = document.createElement('div');
  box.id = 'link-preview';
  box.hidden = true;
  document.body.append(box);
  let timer = null;
  const hide = () => { clearTimeout(timer); box.hidden = true; };
  document.addEventListener('mouseover', e => {
    const a = e.target.closest?.('a.wikilink');
    if (!a) return;
    const id = a.dataset.id || resolve(a.dataset.target || '');
    const p = id && state.pages.get(id);
    if (!p || hiddenPage(p) || (state.view?.kind === 'page' && state.view.id === id && !state.view.edit)) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      box.innerHTML = pagePreview(p);
      box.hidden = false;
      const r = a.getBoundingClientRect();
      const w = box.offsetWidth, h = box.offsetHeight;
      box.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left))}px`;
      box.style.top = `${r.bottom + 6 + h > innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6}px`;
    }, 450);
    a.addEventListener('mouseleave', hide, { once: true });
  });
  document.addEventListener('mousedown', hide);
  // Scrolling hides a preview that's showing; one about to show still appears, placed where the link is now.
  document.addEventListener('scroll', () => { box.hidden = true; }, true);
}

// The sidebar's width: drag its right edge; double-click puts it back. Remembered on this computer.
const SIDEBAR_W = [200, 520, 270];
function setSidebarWidth(w, save = true) {
  const px = Math.round(Math.max(SIDEBAR_W[0], Math.min(SIDEBAR_W[1], Number(w) || SIDEBAR_W[2])));
  document.body.style.setProperty('--sidebar-w', px + 'px');
  if (save) try { localStorage.setItem('sidebar-w', String(px)); } catch {}
}
function wireSidebarResize() {
  try { setSidebarWidth(localStorage.getItem('sidebar-w'), false); } catch {}
  const grip = $('#sidebar-resize');
  if (!grip) return;
  grip.addEventListener('dblclick', () => setSidebarWidth(SIDEBAR_W[2]));
  grip.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    document.body.classList.add('resizing');
    // A click (or the double-click that resets it) doesn't move the edge; only a drag does.
    let moved = false;
    const move = ev => { moved = true; setSidebarWidth(ev.clientX, false); };
    const up = ev => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.classList.remove('resizing');
      if (moved) setSidebarWidth(ev.clientX);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
}

function wire() {
  wirePreviews();
  wireSidebarResize();
  wireJourneyPins();
  $('#quick-pages').addEventListener('contextmenu', async e => {
    const b = e.target.closest('button[data-id]');
    if (!b || !pinned().includes(b.dataset.id)) return;
    e.preventDefault();
    await togglePin(b.dataset.id);
    if (state.view?.kind === 'page' && state.view.id === b.dataset.id) render();
  });
  wireTreeDrag();
  document.addEventListener('change', e => { if (e.target.matches('.slot-pick')) pickSlot(e.target); });
  document.addEventListener('click', e => {
    // Dice and attacks roll into the dice tray, from anywhere in the app.
    if (concClick(e) || seatClick(e)) return;
    const pip = e.target.closest('[data-slot-pip]');
    if (pip) { e.preventDefault(); clickSlotPip(pip); return; }
    const rl = e.target.closest('[data-roll]');
    if (rl && !rl.closest('#dt-form')) {
      e.preventDefault();
      const who = rl.closest('[data-who]')?.dataset.who || '', rules = rulesAround(rl);
      spendSlotFor(rl, e.shiftKey).then(b => { if (b) rollExpr(b.dataset.roll, b.dataset.label || '', who, rules); });
      return;
    }
    const at = e.target.closest('[data-attack]');
    if (at) {
      e.preventDefault();
      const who = at.closest('[data-who]')?.dataset.who || '', rules = rulesAround(at);
      spendSlotFor(at, e.shiftKey).then(b => { if (b) rollAttackEntry(JSON.parse(b.dataset.attack), who, rules); });
      return;
    }
    const cs = e.target.closest('[data-cast]');
    if (cs) {
      e.preventDefault();
      // The line's caster numbers and picked slot: heroism needs the spellcasting modifier, armour of Agathys the slot.
      let line = {};
      try { line = JSON.parse(cs.closest('.sb-line')?.dataset.line || '{}'); } catch { line = {}; }
      const slot = state.castSlots?.[`${line.who}|${cs.dataset.cast}`] ?? line.slots?.[0] ?? null;
      castLasting(cs.dataset.cast, cs.closest('[data-who]')?.dataset.who || '', () => spendSlotFor(cs, e.shiftKey).then(Boolean), { mod: Number(line.nums?.mod) || 0, slot });
      return;
    }
    // Summoning spells and companion features bring creatures into the battle; Wild Shape changes a druid's card.
    const su = e.target.closest('[data-summon]');
    if (su) {
      e.preventDefault();
      const who = su.closest('[data-who]')?.dataset.who || '';
      const o = { ...JSON.parse(su.dataset.summon), who };
      castSummon(o, () => spendSlotFor(su, e.shiftKey).then(b => b ? { ...o, ...JSON.parse(b.dataset.summon), who } : null));
      return;
    }
    const sf = e.target.closest('[data-summon-feature]');
    if (sf) { e.preventDefault(); summonFeature(sf.dataset.summonFeature, sf.closest('[data-who]')?.dataset.who || ''); return; }
    const ws = e.target.closest('[data-wildshape]');
    if (ws) {
      e.preventDefault();
      const who = ws.closest('[data-who]')?.dataset.who || '', c = battle().list.find(x => x.name === who);
      if (!c) toast(`Put ${who || 'them'} in the battle first, then use Wild Shape from their stat block there.`, true); else wildShape(c);
      return;
    }
    const handouts = e.target.closest('.handouts-btn[data-handouts]');
    if (handouts) { e.preventDefault(); printHandouts(handouts.dataset.handouts); return; }
    const linkBattle = e.target.closest('.battle-btn[data-battle]');
    if (linkBattle) {
      e.preventDefault();
      // A fight from a journey day keeps the road event that started it.
      const dayBtn = linkBattle.closest('li')?.querySelector('.travel-enc'), j = dayBtn && curJourney();
      addEncounterLink(linkBattle.dataset.battle, j?.days[Number(dayBtn.dataset.day)] ? journeyOrigin(j, j.days[Number(dayBtn.dataset.day)]) : null);
      return;
    }
    const toBattle = e.target.closest('[data-battle-groups], [data-battle-monster]');
    if (toBattle) {
      e.preventDefault();
      const groups = toBattle.dataset.battleMonster != null ? [{ count: 1, variant: state.bestiaryShown, name: state.bestiaryShown?.name }] : state.lastCards || [];
      const origin = toBattle.dataset.battleMonster != null ? null : state.lastOrigin;
      addToBattle(groups, origin);
      return;
    }
    // Spell links open the spell in a popup, wherever they are; monster links open the bestiary.
    const sl = e.target.closest('a.spell-link');
    if (sl) { e.preventDefault(); showSpell(sl.dataset.spell); return; }
    const ml = e.target.closest('a.monster-link');
    if (ml) { e.preventDefault(); $('#spell-pop')?.close(); go({ kind: 'bestiary', sel: ml.dataset.monster }); return; }
    // Essence, confluence and affinity links open the essences browser.
    const jump = e.target.closest('a.jump');
    if (jump) {
      e.preventDefault();
      if (jump.dataset.jump === 'items') go({ kind: 'items', sel: jump.dataset.name });
      else if (jump.dataset.jump === 'map') go({ kind: 'map', focus: jump.dataset.id });
      else if (jump.dataset.jump === 'journey') planJourneyTo(jump.dataset.id);
      else go(jump.dataset.aff ? { kind: 'essences', tab: 'essences', affinity: jump.dataset.aff } : { kind: 'essences', tab: jump.dataset.jump, sel: jump.dataset.name });
      return;
    }
    const purseBtn = e.target.closest('.purse-btn');
    if (purseBtn) { claimCoins(purseBtn); return; }
    const bonusBtn = e.target.closest('.bonus-item-btn');
    if (bonusBtn) { claimBonusItem(bonusBtn); return; }
    const face = e.target.closest('.make-face');
    if (face) { npcFromName(face.dataset.face, { local: true, place: face.dataset.facePlace }); return; }
    const link = e.target.closest('a.wikilink');
    if (link?.classList.contains('new-npc') && (link.dataset.local || !resolve(link.dataset.target))) { e.preventDefault(); npcFromName(link.dataset.target, { entryId: link.dataset.npcEntry || null, of: link.dataset.npcOf || null, local: !!link.dataset.local }); return; }
    if (link) {
      e.preventDefault();
      if (link.dataset.id) openPage(link.dataset.id);
      else followLink(link.dataset.target);
      return;
    }
    const nav = e.target.closest('[data-nav]');
    if (nav) {
      const n = nav.dataset.nav;
      if (n === 'home') openPage('home');
      else if (n === 'classes') { if (resolve('Classes')) openPage(resolve('Classes')); else toast('This campaign has no Classes page.', true); }
      else if (n === 'generators' && state.view?.kind === 'generators') { state.gen.tab = 'all'; renderGenerators(); }
      else go(nav.dataset.tab ? { kind: n, tab: nav.dataset.tab } : { kind: n });
      return;
    }
    const item = e.target.closest('#page-tree button.item[data-id], #quick-pages button.item[data-id]');
    if (item) openPage(item.dataset.id);
  });
  $('#new-page').onclick = () => newPageFlow();
  $('#campaign-name').onclick = () => go({ kind: 'campaigns' });
  $('#world-date').onclick = () => go({ kind: state.dm ? 'world' : 'news' });
  $('#back').onclick = back;
  $('#forward').onclick = forward;
  $('#refresh').onclick = refreshView;
  window.addEventListener('keydown', e => { if (e.key === 'F5' && !e.ctrlKey && !e.altKey) { e.preventDefault(); refreshView(); } });
  let st;
  $('#search').addEventListener('input', e => {
    clearTimeout(st);
    const q = e.target.value;
    st = setTimeout(() => {
      if (q.trim()) go({ kind: 'search', q }, { replace: state.view?.kind === 'search' });
    }, 200);
  });
  $('#search').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const id = resolve(e.target.value);
      // The results the typing asked for mustn't open over the page a moment later.
      if (id) { clearTimeout(st); e.target.value = ''; openPage(id); }
    }
    if (e.key === 'Escape') { e.target.value = ''; e.target.blur(); }
  });
  document.addEventListener('keydown', e => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#search').focus(); $('#search').select(); }
    if (mod && e.key.toLowerCase() === 'e' && state.view?.kind === 'page' && state.dm) {
      e.preventDefault();
      go({ kind: 'page', id: state.view.id, edit: !state.view.edit }, { replace: true });
    }
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveNow(); }
    if (e.key === 'F1') { e.preventDefault(); toggleHelp(); }
    if (e.key === 'F2' && state.dm) { e.preventDefault(); toggleQuick(); }
    if (e.altKey && e.key === 'ArrowLeft') back();
    if (e.altKey && e.key === 'ArrowRight') forward();
  });
  applyLook(readLook());
  applyAppFx();
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => applyLook(readLook()));
  state.dm = localStorage.getItem('dm-mode') !== '0';
  applyDM();
  $('#dm-toggle').onclick = () => setDM(!state.dm);
  $('#settings-btn').onclick = openSettings;
  $('#help-btn').onclick = toggleHelp;
  $('#quick-btn').onclick = toggleQuick;
  wireNavGroups();
  window.addEventListener('beforeunload', () => { if (state.editing) saveNow(); });
}

async function start() {
  if (new URLSearchParams(location.search).get('view') === 'player') {
    applyLook(readLook());
    try { state.saved = await api.saved.read(); } catch {}
    return startPlayerView();
  }
  wire();
  initDice();
  await attempt(loadCampaign);
  await go({ kind: 'page', id: state.pages.has('home') ? 'home' : [...state.pages.keys()][0] });
  maybeTour();
}

start();
