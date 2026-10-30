// The story engine's backbone: the world calendar and clock, the chronicle of what happened, and Advance time,
// which plays the days forward. Advancing moves the slow numbers (prosperity, safety, population) on its own and
// lets small events happen near the party; each of those can be rerolled or undone later. Big events only come
// from the storyteller's pitches, once the DM accepts them. Content is in data/calendar.json and data/story.json.
// Pure logic: no DOM, so the same code runs in the app and in tests.
import { int, pick, chance, weighted, makeRng } from './generators.js';
import { milesBetween } from './places.js';

const list = x => Array.isArray(x) ? x : [];
const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(n)));
const ORDINAL = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'];
const newId = (rng, pre) => `${pre}${Date.now().toString(36)}${Math.floor(rng() * 1e6).toString(36)}`;

// ---------- the calendar ----------
// A date is a day number: day 0 is the first day of year 1. Months and holy days are laid out in order, and
// the leap day falls after its holy day in every year divisible by `every`.

const monthIndex = (cal, m) => typeof m === 'number' ? m : list(cal.months).findIndex(x => x.name.toLowerCase() === String(m || '').toLowerCase());
const isLeap = (cal, year) => !!cal.leapDay && year % (cal.leapDay.every || 4) === 0;

/** The parts of one year in order: { month } blocks of monthDays, and { holy } single days. */
function yearLayout(cal, year) {
  const out = [];
  const md = cal.monthDays || 30;
  list(cal.months).forEach((m, i) => {
    out.push({ month: i, days: md });
    for (const h of list(cal.holyDays).filter(h => monthIndex(cal, h.after) === i)) {
      out.push({ holy: h, days: 1 });
      if (isLeap(cal, year) && cal.leapDay.after === h.name) out.push({ holy: { ...cal.leapDay, leap: true }, days: 1 });
    }
  });
  return out;
}
export const yearDays = (cal, year) => yearLayout(cal, year).reduce((t, x) => t + x.days, 0);

/** Day number -> { year, month (index, or -1 on a holy day), day, holy, dayOfYear, season, tenday }. */
export function dateOf(cal, n) {
  n = Math.floor(Number(n) || 0);
  let year = 1;
  const every = cal.leapDay?.every || 4;
  const cycle = Array.from({ length: every }, (_, i) => yearDays(cal, i + 1)).reduce((a, b) => a + b, 0);
  if (n >= cycle) { const k = Math.floor(n / cycle); year += k * every; n -= k * cycle; }
  while (n < 0) { year--; n += yearDays(cal, year); }
  while (n >= yearDays(cal, year)) { n -= yearDays(cal, year); year++; }
  const dayOfYear = n;
  let lastMonth = 0;
  for (const part of yearLayout(cal, year)) {
    if (n < part.days) {
      if (part.holy) return { year, month: -1, day: 0, holy: part.holy, dayOfYear, season: cal.months[lastMonth]?.season || '', tenday: 0 };
      const day = n + 1;
      return { year, month: part.month, day, holy: null, dayOfYear, season: cal.months[part.month]?.season || '', tenday: Math.ceil(day / (cal.weekLength || 10)) };
    }
    n -= part.days;
    if (part.month !== undefined) lastMonth = part.month;
  }
  return { year, month: 0, day: 1, holy: null, dayOfYear, season: '', tenday: 1 };
}

/** { year, month, day } or { year, holy } -> day number. Unknown months count as the first. */
export function dayNumber(cal, { year = 1, month = 0, day = 1, holy = null } = {}) {
  let n = 0;
  for (let y = 1; y < year; y++) n += yearDays(cal, y);
  for (let y = year; y < 1; y++) n -= yearDays(cal, y);
  const mi = Math.max(0, monthIndex(cal, month));
  for (const part of yearLayout(cal, year)) {
    if (holy && part.holy?.name.toLowerCase() === String(holy).toLowerCase()) return n;
    if (!holy && part.month === mi) return n + Math.max(1, Math.min(part.days, Number(day) || 1)) - 1;
    n += part.days;
  }
  return n;
}

/** "year 3"; before the first year, "2 years before year 1" (worldgen history can reach back that far). */
export const yearName = y => y >= 1 ? `year ${y}` : `${1 - y} year${1 - y === 1 ? '' : 's'} before year 1`;
/** "12 Ches, year 3", or "Hearthnight, year 3". `short` leaves out the year. */
export function formatDate(cal, n, { short = false, weekday = false } = {}) {
  const d = dateOf(cal, n);
  const yr = short ? '' : `, ${yearName(d.year)}`;
  if (d.holy) return `${d.holy.name}${yr}`;
  const td = weekday ? ` (day ${((d.day - 1) % (cal.weekLength || 10)) + 1} of the ${ORDINAL[d.tenday - 1] || 'last'} tenday)` : '';
  return `${d.day} ${cal.months[d.month].name}${yr}${td}`;
}

/** Read a date typed by the DM: "12 Ches 3", "12 Ches, year 3", "Hearthnight 3". Returns a day number or null. */
export function parseDate(cal, text, fallbackYear = 1) {
  const t = String(text || '').trim().replace(/,/g, ' ').replace(/\byear\b/i, ' ').replace(/\s+/g, ' ');
  if (!t) return null;
  const holy = [...list(cal.holyDays), ...(cal.leapDay ? [cal.leapDay] : [])].find(h => t.toLowerCase().startsWith(h.name.toLowerCase()));
  if (holy) {
    const y = Number(t.slice(holy.name.length).trim()) || fallbackYear;
    if (holy === cal.leapDay && !isLeap(cal, y)) return null;
    return dayNumber(cal, { year: y, holy: holy.name });
  }
  const m = t.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([A-Za-z]+)(?:\s+(-?\d+))?$/);
  if (!m) return null;
  const mi = monthIndex(cal, m[2]);
  const day = Number(m[1]);
  if (mi < 0 || day < 1 || day > (cal.monthDays || 30)) return null;
  return dayNumber(cal, { year: m[3] ? Number(m[3]) : fallbackYear, month: mi, day });
}

/** The day a campaign's clock starts on, from the calendar's start. */
export const startDay = cal => dayNumber(cal, cal.start || { year: 1, month: 0, day: 1 });

const whereList = w => w === 'Everywhere' || !w ? null : list(w);

/** Festivals and holy days on a day: [{ name, by, where (null = everywhere), text, holy }]. */
export function eventsOn(cal, n) {
  const d = dateOf(cal, n);
  const out = [];
  if (d.holy) out.push({ name: d.holy.name, by: d.holy.by || '', where: whereList(d.holy.where), text: d.holy.text || '', holy: true });
  for (const e of list(cal.events)) {
    if (monthIndex(cal, e.month) < 0) continue;
    const first = dayNumber(cal, { year: d.year, month: e.month, day: e.day });
    const span = Number(e.days) || 1;
    const since = n - first;
    if (since < 0 || since >= span) continue;
    if (e.every && since % e.every) continue;
    out.push({ name: e.name, by: e.by || '', where: whereList(e.where), text: e.text || '', days: e.every ? 1 : span, first: since === 0 });
  }
  return out;
}

/** Festivals in the next `days` days from n (inclusive): [{ day, ...event }], each named once per run. */
export function upcoming(cal, n, days = 30) {
  const out = [];
  const seen = new Set();
  for (let i = 0; i < days; i++) {
    for (const e of eventsOn(cal, n + i)) {
      const key = `${e.name}`;
      if (seen.has(key) && !e.holy) continue;
      seen.add(key);
      out.push({ day: n + i, ...e });
    }
  }
  return out;
}

/** The days of one month (or the holy days that follow it) for a calendar grid. */
export function monthGrid(cal, year, month) {
  const first = dayNumber(cal, { year, month, day: 1 });
  const days = Array.from({ length: cal.monthDays || 30 }, (_, i) => ({ day: first + i, n: i + 1, events: eventsOn(cal, first + i) }));
  const after = [];
  for (let k = first + days.length; ; k++) {
    const d = dateOf(cal, k);
    if (!d.holy) break;
    after.push({ day: k, holy: d.holy, events: eventsOn(cal, k) });
  }
  return { first, days, after, name: cal.months[month]?.name, season: cal.months[month]?.season };
}

// ---------- the world record ----------
// Kept in the campaign's saved state: { today, chronicle, advances, partyAt, settings }.

export const DEFAULT_SETTINGS = { journeysMove: true, drift: true, minor: true, chains: true, grow: false, people: true, factions: true };

export function newWorld(cal) {
  return { version: 1, today: startDay(cal), began: startDay(cal), chronicle: [], advances: [], partyAt: null, settings: { ...DEFAULT_SETTINGS } };
}

/** A chronicle entry. kind: festival, minor, drift, trouble, party, session, note, event. */
export function entry({ day, kind = 'note', title = '', text = '', dm = '', places = [], people = [], factions = [], tags = [], causes = [], isPublic = true, source = '', at = null }, rng = Math.random) {
  return { id: newId(rng, 'ch'), day, kind, title, text, dm, places: list(places), people: list(people), factions: list(factions), tags: list(tags), causes: list(causes), public: !!isPublic, source, at };
}

const WIKILINK = /\[\[([^\]|\n]+)(?:\|[^\]\n]+)?\]\]/g;
/** A small event from before strangers were kept apart: the names in its people are strangers, not pages. */
export const oldLocals = e => !!e.source && !Array.isArray(e.locals) && (e.kind === 'minor' || e.kind === 'history');
/** Every page title an entry names: its places, people and factions, and any [[links]] in its text. */
export function namesIn(e) {
  const out = new Set([...list(e.places), ...(oldLocals(e) ? [] : list(e.people)), ...list(e.factions)].map(s => s.toLowerCase()));
  for (const t of [e.text, e.dm]) for (const m of String(t || '').matchAll(WIKILINK)) out.add(m[1].trim().toLowerCase());
  return out;
}

/**
 * Point an entry's names at the pages they mean, by page id, so later matching never goes by name: e.refs
 * { name: id | null }. A name with no page yet stays null and is looked up again next time (the DM may make it).
 * resolveId(name) gives a page id or null.
 */
export function stampRefs(chronicle, resolveId) {
  for (const e of list(chronicle)) {
    const refs = (e.refs ||= {});
    for (const n of new Set([...list(e.places), ...(oldLocals(e) ? [] : list(e.people)), ...list(e.factions), ...[e.text, e.dm].flatMap(t => [...String(t || '').matchAll(WIKILINK)].map(m => m[1].trim()))])) {
      if (refs[n] == null) refs[n] = resolveId(n) || null;
    }
  }
}

/** Entries that concern a page, oldest first: by its id where an entry has refs, otherwise by its title or aliases. */
export function historyOf(chronicle, titles, id = null) {
  const want = list(titles).map(t => t.toLowerCase());
  return list(chronicle).filter(e => {
    if (id && e.refs && Object.keys(e.refs).length) return Object.values(e.refs).includes(id);
    const n = namesIn(e); return want.some(t => n.has(t));
  }).sort((a, b) => a.day - b.day);
}

/**
 * A page was renamed: every record that names it by its old title now uses the new one (keys and exact values, in
 * the world and anything else passed), and chronicle entries that point at it say the new name in their text.
 */
export function renameIn(root, oldTitle, newTitle, id = null) {
  const walk = v => {
    if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) { if (v[i] === oldTitle) v[i] = newTitle; else if (v[i] && typeof v[i] === 'object') walk(v[i]); } return; }
    if (!v || typeof v !== 'object') return;
    for (const k of Object.keys(v)) {
      const val = v[k];
      if (val === oldTitle) v[k] = newTitle;
      else if (val && typeof val === 'object') walk(val);
      if (k === oldTitle && !(newTitle in v)) { v[newTitle] = v[k]; delete v[k]; }
    }
  };
  const rx = new RegExp(`(^|[^\\w\\[])${oldTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w\\]])`, 'g');
  for (const e of list(root?.chronicle)) {
    const mine = id && e.refs ? Object.values(e.refs).includes(id) : namesIn(e).has(oldTitle.toLowerCase());
    if (!mine) continue;
    for (const f of ['title', 'text', 'dm']) if (e[f]) e[f] = e[f].replace(rx, `$1${newTitle}`);
  }
  walk(root);
}

/**
 * Has word of a public entry reached the party? Word travels wordMiles a day from where it happened, so a
 * village 90 miles away hears in three days. The DM can hide an entry (hidden) or reveal it early (shown).
 * Returns { heard, inDays }.
 */
export function heard(e, { today, at = null, wordMiles = 30 } = {}) {
  if (!e.public || e.hidden) return { heard: false, inDays: null };
  if (e.shown) return { heard: true, inDays: 0 };
  const miles = e.at && at ? milesBetween(e.at, at) : 0;
  const arrives = e.day + Math.ceil(miles / Math.max(1, wordMiles));
  return { heard: arrives <= today, inDays: Math.max(0, arrives - today) };
}

// ---------- places' slow numbers ----------

/** A place's prosperity, safety and population: its own (from its page) or its settlement's defaults. */
export function placeState(story, place) {
  const d = story?.defaults?.[place.settlement] || story?.defaults?.village || { prosperity: 50, safety: 50, population: 400 };
  const m = place.meta || {};
  const num = (k, dflt) => Number.isFinite(Number(m[k])) && m[k] !== '' && m[k] != null ? Number(m[k]) : dflt;
  return { prosperity: num('prosperity', d.prosperity), safety: num('safety', d.safety), population: num('population', d.population) };
}

// "The Big Three have a goal", "The Iron Wolves want": a name that is plural takes a plural verb.
const NUMBERS = /^(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|hundred|folk|people|men|women|kin)$/i;
export const pluralTitle = name => { const last = String(name).trim().split(/\s+/).at(-1) || ''; return NUMBERS.test(last) || (/[^su]s$/i.test(last) && !/(ss|us|is)$/i.test(last)); };
const PLURAL_VERB = { has: 'have', is: 'are', was: 'were', wants: 'want' };
const verb = (name, v) => pluralTitle(name) ? PLURAL_VERB[v] || v.replace(/s$/, '') : v;
/** Fills {tokens}; "a {goods}" becomes "an iron" when the word it is filled with starts with a vowel. */
const fill = (text, t) => String(text || '')
  .replace(/\b([Aa])n? \{(\w+)\}/g, (all, a, k) => t[k] == null ? all : `${a}${/^[aeiou]/i.test(String(t[k])) && !/^(one|once|uni|use|eu|ur)/i.test(String(t[k])) ? 'n' : ''} ${t[k]}`)
  .replace(/\{(\w+)\}/g, (all, k) => t[k] ?? all);

function localName(data, rng, taken = new Set(), avoid = null) {
  const peoples = list(data.peoples?.peoples);
  if (!peoples.length) return pick(rng, ['Aldo', 'Bettany', 'Corran', 'Dessa', 'Emrin', 'Fara']);
  let name = '';
  const firsts = new Set([...taken].map(t => String(t).split(' ')[0].toLowerCase()));
  // data.reservedNames: the names (and first names) of the campaign's people, so a stranger never shares one.
  const reserved = data.reservedNames instanceof Set ? data.reservedNames : new Set();
  const clash = n => taken.has(n) || !!avoid?.has(n) || firsts.has(n.split(' ')[0].toLowerCase()) || reserved.has(n.toLowerCase()) || reserved.has(n.split(' ')[0].toLowerCase());
  for (let i = 0; i < 40 && (!name || clash(name)); i++) {
    const p = weighted(rng, peoples);
    const first = pick(rng, list(p.names?.first)) || 'Tam';
    const last = list(p.names?.last).length && chance(rng, 0.7) ? ' ' + pick(rng, p.names.last) : '';
    name = first + last;
  }
  taken.add(name);
  return name;
}

const CHURCHES = ['Church of the Healer', 'Church of the Hearth', 'Church of the Journey', 'Church of Trade', 'Church of the Revels', 'Church of Death', 'Church of Justice', 'Church of the Hero', 'Church of Knowledge'];

/** Can a minor event card happen at a place? ctx: { state, settlement, season, troubles }. */
export function cardFits(card, ctx) {
  const s = ctx.state;
  if (card.safetyBelow != null && !(s.safety < card.safetyBelow)) return false;
  if (card.safetyAbove != null && !(s.safety > card.safetyAbove)) return false;
  if (card.prosperityBelow != null && !(s.prosperity < card.prosperityBelow)) return false;
  if (card.prosperityAbove != null && !(s.prosperity > card.prosperityAbove)) return false;
  if (card.settlements && !card.settlements.includes(ctx.settlement)) return false;
  if (card.seasons && !card.seasons.some(w => String(ctx.season).toLowerCase().includes(w))) return false;
  if (card.trouble && !list(ctx.troubles).length) return false;
  return true;
}

/**
 * One minor event at a place: an entry with its effects ({ safety, prosperity, population% }) kept on it, so it can
 * be undone or rerolled later. place: { title, map, settlement, meta }; avoid: card ids not to use.
 */
/** A small event card by id: one that can happen by itself (minor) or only as what another leads to (followups). */
export const storyCard = (story, id) => list(story?.minor).find(c => c.id === id) || list(story?.followups).find(c => c.id === id) || null;

/**
 * A small event at a place. Options: troubles reaching it, cards to avoid, its numbers now; card (an id: this card,
 * for a follow-up), fill (people and goods it keeps from the event that led to it), locals (the town's familiar
 * strangers, who may turn up again), strangers (every stranger's name, so a new one is never a second of them).
 */
export function minorEvent(data, place, day, cal, rng = Math.random, { troubles = [], avoid = [], stateNow = null, card: forced = null, fill: kept = null, locals = [], strangers = null } = {}) {
  const story = data.story || {};
  const st = stateNow || placeState(story, place);
  const season = dateOf(cal, day).season;
  const cards = list(story.minor).filter(c => !avoid.includes(c.id) && cardFits(c, { state: st, settlement: place.settlement, season, troubles }));
  const card = forced ? storyCard(story, forced) : weighted(rng, cards);
  if (!card) return null;
  const taken = new Set(Object.values(kept || {}).filter(Boolean));
  const familiar = list(locals).filter(n => !taken.has(n));
  const someone = () => {
    const n = familiar.length && chance(rng, story.recurChance ?? 0.4) ? familiar.splice(Math.floor(rng() * familiar.length), 1)[0] : localName(data, rng, taken, strangers);
    taken.add(n);
    return n;
  };
  // A kingdom or region is too big for street-level news: it happens in one of its towns. A follow-up keeps the church.
  const where = place.wide ? `a town in ${place.title}` : place.title;
  const t = { place: where, name: kept?.name || someone(), name2: kept?.name2 || someone(), goods: kept?.goods || pick(rng, list(story.goods)) || 'grain', church: kept?.church || pick(rng, CHURCHES), trouble: troubles[0]?.name ? troubles[0].name.toLowerCase().replace(/^./, c => c.toUpperCase()) : 'The trouble' };
  if (card.econ && !card.econ.good && !kept?.goods && data.factions?.econ) {
    const ec = economyOf(data, place);
    const from = card.econ.kind === 'short' ? ec.needs : ec.makes;
    if (from.length) t.goods = pick(rng, from);
  }
  const say = x => fill(x, t).replace(/(^|[.!?]\s+)a town in /g, '$1A town in ');
  const e = entry({ day, kind: 'minor', title: card.name, text: say(card.text), dm: say(card.dm), places: [place.title], tags: list(card.tags), at: place.map, source: card.id, isPublic: card.public !== false }, rng);
  if (card.econ) e.econ = { kind: card.econ.kind, good: card.econ.good || t.goods, until: day + (card.econ.days || 30) };
  e.effects = { ...(card.effects || {}) };
  // The locals it names are strangers, not pages: they may get pages later (a tie between them, or a death, comes
  // with them), and only then does the entry count as theirs.
  // Someone a follow-up keeps who has since been made a page (data.pageNames) is that page now.
  const used = ['name', 'name2'].filter(k => `${card.text} ${card.dm || ''}`.includes(`{${k}}`)).map(k => t[k]);
  const isPage = n => data.pageNames instanceof Set && data.pageNames.has(n);
  e.people = used.filter(isPage);
  e.locals = used.filter(n => !isPage(n));
  if (card.tie) e.tie = card.tie;
  // Who and what it was about, for whatever it leads to.
  e.cast = { name: t.name, name2: t.name2, goods: card.econ?.good || t.goods, church: t.church };
  return e;
}

/** What an event may lead to: follow-ups due later at the same place, with the same people. */
export function chainsFrom(story, e, rng = Math.random) {
  const card = storyCard(story, e.source);
  const out = [];
  for (const th of list(card?.then)) {
    if (!storyCard(story, th.card) || !chance(rng, th.chance ?? 0.3)) continue;
    const [lo, hi] = list(th.after).length ? th.after : [10, 30];
    out.push({ id: newId(rng, 'pd'), card: th.card, name: storyCard(story, th.card).name, place: e.places[0], due: e.day + int(rng, lo, hi), cause: e.id, fill: { ...(e.cast || {}) } });
  }
  return out;
}

/** The town's familiar strangers: each time one turns up in an event, they are seen once more (and a death ends it). */
export function noteLocals(story, roster, e) {
  const card = storyCard(story, e.source);
  const place = e.places[0];
  if (!place || !list(e.locals).length) return;
  const here = (roster[place] ||= []);
  for (const [slot, name] of Object.entries(e.cast || {})) {
    if (!['name', 'name2'].includes(slot) || !e.locals.includes(name)) continue;
    let r = here.find(x => x.name === name);
    if (!r) here.push(r = { name, seen: 0, first: e.day, entries: [] });
    r.seen++;
    r.last = e.day;
    r.entries = [...list(r.entries), e.id].slice(-12);
    if (card?.dies === slot) r.dead = true;
  }
}
/** Names of the strangers a town knows who are still about, and every stranger's name anywhere. */
export const aliveLocals = (roster, place) => list(roster?.[place]).filter(r => !r.dead && !r.made).map(r => r.name);
export const allLocals = roster => new Set(Object.values(roster || {}).flat().map(r => r.name));

/**
 * The people an entry names, pages or not: its people, and for a small event the locals its card filled in
 * (older entries only kept the first). Each { name, key } where key is the card's slot (name, name2) if known.
 */
export function entryPeople(data, e) {
  const old = oldLocals(e);
  const out = [...(old ? [] : list(e.people).map(name => ({ name, key: null, local: false }))), ...list(old ? e.people : e.locals).map(name => ({ name, key: null, local: true }))];
  const card = e.kind === 'minor' || e.kind === 'history' ? storyCard(data?.story, e.source) : null;
  if (card) {
    const keys = [];
    const rx = new RegExp('^' + String(card.text).replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{(\w+)\}/g, (_, k) => { keys.push(k); return '(.+?)'; }) + '$');
    const m = String(e.text || '').match(rx);
    if (m) keys.forEach((k, i) => {
      if (!/^name2?$/.test(k)) return;
      const hit = out.find(x => x.name === m[i + 1]);
      if (hit) hit.key = k; else if (!list(e.people).includes(m[i + 1]) || old) out.push({ name: m[i + 1], key: k, local: true });
    });
  }
  return out;
}

/** Add (sign 1) or take away (sign -1) an event's effects on a place's numbers. */
export function applyEffects(st, effects = {}, sign = 1) {
  const out = { ...st };
  if (effects.safety) out.safety = clamp(out.safety + sign * effects.safety);
  if (effects.prosperity) out.prosperity = clamp(out.prosperity + sign * effects.prosperity);
  if (effects.population) out.population = Math.max(0, Math.round(out.population * (1 + sign * effects.population / 100)));
  return out;
}

// ---------- advancing time ----------

/**
 * Play the world forward `days` days. ctx: { cal, data, world, places: [{ title, map, settlement, meta }],
 * problems, party: { title, map } | null }. Nothing is changed in place. Returns
 * { advance, entries, placeChanges: { title: { before, after } }, problemChanges: [{ id, before, after }] },
 * where advance is the record kept for undo.
 */
export function advanceTime(ctx, days, seed = Math.floor(Math.random() * 2 ** 31)) {
  const { cal, data, world } = ctx;
  const rng = makeRng(seed);
  const story = data.story || {};
  const settings = { ...DEFAULT_SETTINGS, ...(world.settings || {}) };
  const from = world.today;
  const to = from + Math.max(0, Math.floor(days));
  const party = ctx.party?.map ? ctx.party : null;
  const focus = story.focusMiles || 200;
  const near = p => !party || milesBetween(p.map, party.map) <= focus;
  // Locked places (and people) are left as they are.
  const places = list(ctx.places).filter(p => p.map && !p.meta?.locked && !list(p.meta?.tags).includes('locked'));
  const nums = new Map(places.map(p => [p.title, placeState(story, p)]));
  const before = new Map([...nums].map(([k, v]) => [k, { ...v }]));
  const problems = list(ctx.problems).map(p => ({ ...p }));
  const problemsBefore = new Map(problems.map(p => [p.id, { radius: p.radius }]));
  const entries = [];
  const troublesAt = p => problems.filter(x => x.status !== 'solved' && x.centre && milesBetween(x.centre, p.map) <= x.radius);
  const D = story.drift || {};
  const crossed = (title, stat, old, now) => {
    for (const th of list(D.thresholds).filter(t => t.stat === stat)) {
      const hit = th.below != null ? old >= th.below && now < th.below : th.above != null && old <= th.above && now > th.above;
      const p = places.find(x => x.title === title);
      if (hit) entries.push({ ...entry({ day: dayNow, kind: 'drift', title: `${title}: ${stat}`, text: fill(th.text, { place: title }), places: [title], tags: [stat], at: p?.map }, rng) });
    }
  };
  let dayNow = from;
  // What earlier events may lead to, and the strangers each town knows: working copies, kept with the advance.
  const pending = copy(world.pending || []);
  const roster = copy(world.locals || {});
  const happen = (e, p) => {
    nums.set(p.title, applyEffects(nums.get(p.title), e.effects));
    entries.push(e);
    noteLocals(story, roster, e);
    if (settings.chains) pending.push(...chainsFrom(story, e, rng));
  };
  // The same small event doesn't happen twice in one place within a season.
  const recent = p => entries.concat(list(world.chronicle)).filter(e => e.kind === 'minor' && e.places?.[0] === p.title && dayNow - e.day < 90).map(e => e.source);
  const opts = p => ({ troubles: troublesAt(p), stateNow: nums.get(p.title), locals: aliveLocals(roster, p.title), strangers: allLocals(roster), avoid: recent(p) });
  // Small events fall on random days: drawn for a whole tenday (or month, far away) when it starts, or when an
  // advance starts partway through one; days already past are dropped, so short advances don't add extra.
  const minorDays = [], farDays = [];
  // The major NPCs near the party act once a month, on a working copy of their records.
  const work = { ...world, people: copy(world.people || {}) };
  const actors = list(ctx.people).filter(p => p.map && p.major && !p.locked && !p.dead && near(p));
  work.factions = copy(world.factions || {});
  work.control = copy(world.control || {});
  const hard = copy(world.hardship || {});
  const powers = list(ctx.factions).filter(f => f.map && !f.locked && near(f));

  for (let day = from + 1; day <= to; day++) {
    dayNow = day;
    const d = dateOf(cal, day);
    // Festivals and holy days.
    for (const f of eventsOn(cal, day)) {
      if (f.days > 1 && !f.first) continue;
      const where = f.where || [];
      const at = where.length ? places.find(p => p.title === where[0])?.map || null : null;
      entries.push({ ...entry({ day, kind: 'festival', title: f.name, text: f.text, places: where, factions: String(f.by || '').split(/,\s*/).filter(Boolean), tags: ['festival'], at }, rng) });
    }
    // Follow-ups that are due: the feud that turns bloody, the riot after the shortage.
    for (const q of pending.filter(x => x.due <= day)) {
      pending.splice(pending.indexOf(q), 1);
      const p = places.find(x => x.title === q.place);
      if (!p || !settings.chains) continue;
      const e = minorEvent(data, p, day, cal, rng, { ...opts(p), card: q.card, fill: q.fill });
      if (!e) continue;
      e.causes = [q.cause];
      if (!near(p)) e.far = true;
      happen(e, p);
    }
    const tendayEnd = !d.holy && d.day % (cal.weekLength || 10) === 0;
    const monthEnd = !d.holy && d.day === (cal.monthDays || 30);
    // Slow drift: every tenday near the party, every month elsewhere.
    if (settings.drift && tendayEnd) {
      for (const p of places) {
        if (!near(p) && !monthEnd) continue;
        const scale = near(p) ? 1 : 3;
        const s = nums.get(p.title);
        const base = placeState(story, { ...p, meta: {} });
        const tr = troublesAt(p);
        const old = { ...s };
        if (tr.length) {
          s.safety = clamp(s.safety + (D.troubleSafety ?? -2) * tr.length * scale);
          s.prosperity = clamp(s.prosperity + (D.troubleProsperity ?? -1) * scale);
        } else {
          const rec = (D.recover ?? 1) * scale;
          if (s.safety < base.safety) s.safety = clamp(Math.min(base.safety, s.safety + rec));
          if (s.prosperity < base.prosperity && s.safety >= 40) s.prosperity = clamp(Math.min(base.prosperity, s.prosperity + rec));
        }
        if (chance(rng, D.noise ?? 0.3)) s.prosperity = clamp(s.prosperity + (chance(rng, 0.5) ? 1 : -1));
        if (monthEnd) {
          const pct = s.prosperity >= 60 && s.safety >= 45 ? (D.growthPerMonth ?? 0.4) : s.prosperity < 35 || s.safety < 30 ? (D.declinePerMonth ?? -0.6) : 0;
          if (pct) s.population = Math.max(0, Math.round(s.population * (1 + pct / 100)));
        }
        crossed(p.title, 'safety', old.safety, s.safety);
        crossed(p.title, 'prosperity', old.prosperity, s.prosperity);
      }
    }
    // Troubles left alone grow (off unless the DM turns it on).
    if (settings.grow && tendayEnd) {
      for (const x of problems.filter(q => q.status !== 'solved' && q.centre)) {
        const start = Number.isFinite(x.startedDay) ? x.startedDay : from;
        const orig = x.baseRadius || problemsBefore.get(x.id).radius;
        if (day - start < 20 || x.radius >= orig * 2) continue;
        x.baseRadius = orig;
        x.radius = Math.min(orig * 2, Math.round(x.radius * 1.1));
        entries.push({ ...entry({ day, kind: 'trouble', title: `${x.name} spreads`, text: `${x.name} around ${x.origin} has been left alone and is spreading: it now reaches ${x.radius} miles.`, places: [x.origin], tags: ['trouble'], at: x.centre }, rng), problem: x.id });
      }
    }
    // Small events near the party, and now and then far away.
    const week = cal.weekLength || 10;
    if (settings.minor && !d.holy && (d.day % week === 1 || day === from + 1)) {
      const [lo, hi] = story.minorPerTenday || [0, 2];
      const start = day - (d.day - 1) % week;
      // At least one a tenday (when any are allowed), so a quiet stretch still brings a rumour or two.
      for (let i = int(rng, hi > 0 ? Math.max(1, lo) : lo, hi); i > 0; i--) { const at = start + int(rng, 0, week - 1); if (at >= day) minorDays.push(at); }
    }
    if (settings.minor && party && !d.holy && (d.day === 1 || day === from + 1) && chance(rng, story.farPerMonth ?? 0.5)) {
      const at = day - (d.day - 1) + int(rng, 0, (cal.monthDays || 30) - 1);
      if (at >= day) farDays.push(at);
    }
    for (let i = minorDays.filter(x => x === day).length; i > 0; i--) {
      const pool = places.filter(near);
      if (!pool.length) break;
      const p = weighted(rng, pool, x => party ? 1 + 2 * (1 - Math.min(1, milesBetween(x.map, party.map) / focus)) : 1);
      const e = minorEvent(data, p, day, cal, rng, opts(p));
      if (e) happen(e, p);
    }
    if (settings.people !== false && monthEnd && actors.length && data.people) entries.push(...peopleMonth({ data, world: work, faction: ctx.faction }, actors, day, rng));
    if (settings.factions !== false && monthEnd && powers.length && data.factions) entries.push(...factionsMonth({ data, world: work, points: ctx.points, placesNear: f => places.filter(p => milesBetween(p.map, f.map) <= 60).map(p => p.title) }, powers, day, rng));
    // A place that stays in a bad way for months empties out: its people go to the nearest town. NPC pages stay.
    const X = D.exodus;
    if (settings.drift && monthEnd && X) {
      for (const p of places) {
        const s = nums.get(p.title);
        const hungry = entries.concat(list(world.chronicle)).some(e => e.econ?.kind === 'short' && e.places[0] === p.title && e.day <= day && e.econ.until > day && /grain|food|bread|flour|rice/i.test(e.econ.good));
        const beset = troublesAt(p).length > 0;
        const bad = s.safety < (X.safetyBelow ?? 25) || s.prosperity < (X.prosperityBelow ?? 20) || hungry;
        hard[p.title] = bad ? (hard[p.title] || 0) + 1 : 0;
        if (!bad || hard[p.title] < (X.months ?? 3)) continue;
        hard[p.title] = 0;
        const pct = int(rng, ...(list(X.loss).length ? X.loss : [5, 12]));
        const gone = Math.round(s.population * pct / 100);
        if (gone < 1) continue;
        s.population -= gone;
        const why = hungry || s.prosperity < (X.prosperityBelow ?? 20) ? 'hunger and hard times' : beset ? `${(troublesAt(p)[0]?.name || 'trouble').toLowerCase()} and fear` : 'danger';
        const to = places.filter(q => q !== p && milesBetween(q.map, p.map) <= (X.refugeeMiles ?? 80)).sort((a, b) => milesBetween(a.map, p.map) - milesBetween(b.map, p.map))[0];
        const e = entry({ day, kind: 'drift', title: `${p.title} empties out`, text: fill(to ? X.text : X.alone, { place: p.title, why, to: to?.title }), places: [p.title, ...(to ? [to.title] : [])], tags: ['exodus', 'population'], at: p.map }, rng);
        e.effects = { population: -pct };
        entries.push(e);
        if (to) {
          const t = nums.get(to.title);
          t.population += gone;
          t.prosperity = clamp(t.prosperity - 1);
          entries.push({ ...entry({ day, kind: 'drift', title: `Refugees in ${to.title}`, text: fill(X.refugees, { place: to.title, from: p.title, church: pick(rng, CHURCHES) }), places: [to.title, p.title], tags: ['refugees', 'population'], at: to.map }, rng), effects: { prosperity: -1 } });
        }
      }
    }
    if (farDays.includes(day)) {
      const far = places.filter(p => !near(p));
      const p = far.length ? pick(rng, far) : null;
      const e = p && minorEvent(data, p, day, cal, rng, opts(p));
      if (e) { e.far = true; happen(e, p); }
    }
  }

  const placeChanges = {};
  for (const [title, after] of nums) {
    const b = before.get(title);
    if (b.prosperity !== after.prosperity || b.safety !== after.safety || b.population !== after.population) placeChanges[title] = { before: b, after };
  }
  const problemChanges = problems.filter(p => p.radius !== problemsBefore.get(p.id).radius).map(p => ({ id: p.id, before: problemsBefore.get(p.id).radius, after: p.radius, baseRadius: p.baseRadius }));
  const peopleChanges = {};
  const shape = r => r ? { traits: r.traits || [], goal: r.goal || null, ties: r.ties || [] } : { traits: [], goal: null, ties: [] };
  for (const [title, r] of Object.entries(work.people)) {
    const b = shape(world.people?.[title]), a = shape(r);
    if (JSON.stringify(a) !== JSON.stringify(b)) peopleChanges[title] = { before: b, after: a };
  }
  const factionChanges = {};
  for (const [title, r] of Object.entries(work.factions)) {
    const b = world.factions?.[title] || null;
    if (JSON.stringify(r) !== JSON.stringify(b)) factionChanges[title] = { before: copy(b), after: copy(r) };
  }
  const advance = { id: newId(rng, 'adv'), from, to, seed, made: new Date().toISOString(), entries: entries.map(e => e.id), placeChanges, problemChanges, peopleChanges, factionChanges, partyAt: party?.title || null,
    pendingBefore: copy(world.pending || []), localsBefore: copy(world.locals || {}), controlBefore: copy(world.control || {}), hardshipBefore: copy(world.hardship || {}) };
  return { advance, entries, placeChanges, problemChanges, peopleChanges, factionChanges, pending, locals: roster, control: work.control, hardship: hard };
}

/** "3 days", "2 tendays", "1 month" from a day -> days. Months keep the day of the month, so 1 Ches + 2 months is 1 Mirtul. */
export function spanDays(n, unit, cal, from = null) {
  const k = Math.max(0, Number(n) || 0);
  if (unit === 'months' && from !== null && cal?.months?.length) {
    const d = dateOf(cal, from);
    const at = d.holy ? { ...dateOf(cal, from + 1) } : d;
    const total = at.month + Math.round(k);
    const to = dayNumber(cal, { year: at.year + Math.floor(total / cal.months.length), month: total % cal.months.length, day: at.day });
    return Math.max(0, to - from);
  }
  return Math.round(k * ({ days: 1, tendays: cal?.weekLength || 10, weeks: 7, months: cal?.monthDays || 30 }[unit] || 1));
}

/** How long between two days, in words. */
export function spanText(days) {
  if (days === 0) return 'today';
  const a = Math.abs(days);
  return a === 1 ? (days > 0 ? 'tomorrow' : 'yesterday') : days > 0 ? `in ${a} days` : `${a} days ago`;
}

// ---------- the storyteller ----------
// A session-prep assistant. It pitches a few incidents, each with reasons drawn from the world, and never fires on
// its own: the DM accepts, rerolls, edits or turns down each pitch. Quiet stretches build up a tension budget that
// big incidents spend; the personality decides how that budget turns into drama. Cards are in data/incidents.json.

export const PERSONALITIES = {
  steady: { label: 'Steady', text: 'Builds slowly, with regular peaks.', rate: 0.12, maxDrama: 5, kinds: {} },
  gentle: { label: 'Gentle', text: 'Long calm, mostly social and economic events.', rate: 0.07, maxDrama: 3, kinds: { society: 2, economy: 2, personal: 1.5, disaster: 0.4, monster: 0.5, faction: 0.7 } },
  wild: { label: 'Wild', text: 'Pure chance, sometimes brutal.', rate: 0, maxDrama: 5, kinds: {} },
  slowburn: { label: 'Slow burn', text: 'Few incidents, but each grows into a long situation.', rate: 0.06, maxDrama: 5, kinds: {}, situations: 4 },
};
export const DEFAULT_TELLER = { personality: 'steady', difficulty: 1, frequency: 1, quiet: false, lastDrama: null, declined: {}, accepted: [], pitches: [] };

export function teller(world) {
  const t = (world.teller ||= { ...DEFAULT_TELLER, declined: {}, accepted: [], pitches: [] });
  for (const [k, v] of Object.entries(DEFAULT_TELLER)) if (t[k] === undefined) t[k] = Array.isArray(v) ? [] : v && typeof v === 'object' ? {} : v;
  return t;
}

/** Days since the campaign's clock started (for a storyteller that hasn't had anything accepted yet). */
const quietSince = world => Math.max(0, world.today - (Number.isFinite(world.began) ? world.began : world.chronicle?.[0]?.day ?? world.today));

/** The tension budget (0 to 5): how much drama has built up since the last big accepted pitch. */
export function tension(world) {
  const t = teller(world);
  const P = PERSONALITIES[t.personality] || PERSONALITIES.steady;
  const since = t.lastDrama === null ? 10 + quietSince(world) : world.today - t.lastDrama;
  return Math.max(0, Math.min(5, since * P.rate * (Number(t.frequency) || 1)));
}

/** The drama level the storyteller is reaching for now (1 to 5). */
export function targetDrama(world, rng = Math.random) {
  const t = teller(world);
  const P = PERSONALITIES[t.personality] || PERSONALITIES.steady;
  let d = t.personality === 'wild' ? int(rng, 1, 5) : 1 + Math.floor(tension(world));
  d += Math.round(((Number(t.difficulty) || 1) - 1) * 2);
  if (t.quiet) d = Math.min(d, 2);
  return Math.max(1, Math.min(t.quiet ? 2 : P.maxDrama, d));
}

const RANK_ORDER = ['Normal', 'Iron', 'Bronze', 'Silver', 'Gold', 'Diamond'];
const days = n => n === 1 ? 'a day' : n < 14 ? `${n} days` : n < 60 ? `${Math.round(n / 7)} weeks` : `${Math.round(n / 30)} months`;

/** Does a card fit a place and moment? ctx: { state, settlement, season, troubles, festival, rank }. */
export function incidentFits(card, ctx) {
  const w = card.when || {};
  if (!cardFits(w, ctx)) return false;
  if (w.festival && !ctx.festival) return false;
  if (w.rankMin && RANK_ORDER.indexOf(ctx.rank || 'Iron') < RANK_ORDER.indexOf(w.rankMin)) return false;
  if (w.rankMax && RANK_ORDER.indexOf(ctx.rank || 'Iron') > RANK_ORDER.indexOf(w.rankMax)) return false;
  if (w.follows && !list(ctx.recent).some(e => list(e.tags).some(t => w.follows.includes(t)))) return false;
  if (w.standingBelow != null && !((ctx.standing ?? 0) < w.standingBelow)) return false;
  if (w.standingAbove != null && !((ctx.standing ?? 0) > w.standingAbove)) return false;
  if (w.renownAbove != null && !((ctx.renown ?? 0) > w.renownAbove)) return false;
  if (w.factionBelow != null && !(ctx.grudge && ctx.grudge.value < w.factionBelow)) return false;
  if (w.factionAbove != null && !(ctx.friend && ctx.friend.value > w.factionAbove)) return false;
  if (w.shortage && !ctx.shortage) return false;
  return true;
}

/** Why the storyteller is pitching this here and now, in a sentence or two drawn from the world. */
export function pitchReasons(card, ctx) {
  const w = card.when || {};
  const out = [];
  const tr = ctx.troubles?.[0];
  if (w.trouble && tr) {
    const age = Number.isFinite(tr.startedDay) ? ctx.today - tr.startedDay : null;
    out.push(`${tr.name} near ${tr.origin} has ${age && age > 6 ? `gone unchecked for ${days(age)}` : 'not been dealt with'}`);
  }
  if (w.follows) {
    const e = list(ctx.recent).find(x => list(x.tags).some(t => w.follows.includes(t)));
    if (e) out.push(`it follows on from "${e.title}" in ${e.places[0] || ctx.place.title}${Number.isFinite(e.day) ? `, ${days(Math.max(1, ctx.today - e.day))} ago` : ''}`);
  }
  if (w.safetyBelow != null) out.push(`safety in ${ctx.place.title} is down to ${ctx.state.safety}`);
  if (w.prosperityBelow != null) out.push(`${ctx.place.title} is struggling (prosperity ${ctx.state.prosperity})`);
  if (w.prosperityAbove != null) out.push(`${ctx.place.title} is doing well (prosperity ${ctx.state.prosperity})`);
  if (w.standingBelow != null) out.push(`the party is ${ctx.standingName || 'disliked'} in ${ctx.place.title} (${ctx.standing})`);
  if (w.standingAbove != null) out.push(`the party is ${ctx.standingName || 'liked'} in ${ctx.place.title} (+${ctx.standing})`);
  if (w.renownAbove != null) out.push(`the party's name is known across ${ctx.regionName || 'the region'} (renown ${ctx.renown})`);
  if (w.factionBelow != null && ctx.grudge) out.push(`${ctx.grudge.title} holds a grudge against the party (${ctx.grudge.value})`);
  if (w.factionAbove != null && ctx.friend) out.push(`${ctx.friend.title} thinks well of the party (+${ctx.friend.value})`);
  if (w.shortage && ctx.shortage) out.push(`${ctx.place.title} is short of ${ctx.shortage}`);
  if (w.festival && ctx.festival) out.push(`${ctx.festival.name} is ${ctx.festival.day === ctx.today ? 'today' : `in ${days(ctx.festival.day - ctx.today)}`}`);
  if (w.seasons) out.push(`it's ${String(ctx.season).toLowerCase()}`);
  if (ctx.heading) out.push(`the party is heading to ${ctx.place.title}`);
  else if (ctx.here) out.push(`the party is in ${ctx.place.title}`);
  else if (ctx.miles != null) out.push(`${ctx.place.title} is ${Math.round(ctx.miles)} miles from the party`);
  if (card.drama >= 3 && ctx.quietDays >= 20) out.push(`nothing dramatic has happened for ${days(ctx.quietDays)}`);
  const parts = out.slice(0, 3);
  const s = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0] || '';
  return s ? s[0].toUpperCase() + s.slice(1) + '.' : '';
}

function castFor(card, data, place, rng, wikiPeople = [], avoidNames = []) {
  const taken = new Set(avoidNames);
  const cast = {};
  for (const c of list(card.cast)) {
    const known = wikiPeople.filter(p => !taken.has(p.title) && (!c.role || !p.role || p.role === c.role));
    const use = c.wiki !== false && known.length && chance(rng, c.wiki ? 0.8 : 0.3) ? pick(rng, known) : null;
    const name = use ? use.title : localName(data, rng, taken);
    taken.add(name);
    cast[c.key] = { key: c.key, name, role: c.role || null, label: c.label || '', page: use ? use.title : null };
  }
  return cast;
}

/** Build one pitch from a card at a place. ctx as for pitchReasons plus data, cal, rank. */
export function makePitch(card, ctx, rng = Math.random) {
  const { data, place } = ctx;
  const I = data.incidents || {};
  const cast = castFor(card, data, place, rng, ctx.wikiPeople?.(place) || [], ctx.takenNames || []);
  const rank = ctx.rank || 'Iron';
  const tr = ctx.troubles?.[0];
  const t = {
    place: place.title, goods: (card.when?.shortage && ctx.shortage) || pick(rng, list(data.story?.goods)) || 'grain', church: pick(rng, CHURCHES),
    trouble: tr?.name?.toLowerCase() || 'the trouble', festival: ctx.festival?.name || 'the festival',
    faction: (card.when?.factionBelow != null && ctx.grudge?.title) || (card.when?.factionAbove != null && ctx.friend?.title) || ctx.faction || pick(rng, list(I.factions)) || 'a great house', monster: pick(rng, list(I.monsters?.[rank] || I.monsters?.Iron)) || 'a monster',
    newplace: '', rank,
    ...Object.fromEntries(Object.values(cast).map(c => [c.key, c.name])),
    ...(ctx.fillExtra || {}),
  };
  if (card.newPlace) t.newplace = ctx.newPlaceName || `a ${card.newPlace === 'site' ? 'ruin' : 'hamlet'} nearby`;
  // Cast labels can name the faction or place too ("{faction}'s agent").
  for (const c of Object.values(cast)) c.label = fill(c.label, t);
  const scenes = list(card.scenes).length ? card.scenes : list(I.scenes?.[card.kind]);
  const reward = card.reward || list(I.rewardByDrama)[card.drama - 1] || '100 spirit coins';
  return {
    id: newId(rng, 'pt'), card: card.id, kind: card.kind, drama: card.drama, name: card.name,
    place: place.title, at: place.map, day: ctx.today,
    reason: pitchReasons(card, ctx),
    title: fill(card.title || card.name, t), text: fill(card.text, t), dm: fill(card.dm, t),
    goal: fill(card.goal, t), scenes: scenes.map(s => fill(s, t)), reward: fill(reward, t),
    rumour: fill(card.rumour || '', t), cast: Object.values(cast), effects: { ...(card.effects || {}) },
    trouble: card.trouble ? { name: fill(card.trouble.name, t), summary: fill(card.trouble.summary, t), effect: fill(card.trouble.effect || '', t), radius: card.trouble.radius || null } : null,
    newPlace: card.newPlace || null, tags: list(card.tags), faction: [card.text, card.dm, card.goal].some(x => x?.includes('{faction}')) ? t.faction : null,
  };
}

/**
 * A few pitches for the DM, near the party, at the drama the storyteller is reaching for. ctx: { cal, data, world,
 * places: [{ title, map, settlement, meta }], problems, party, heading (title), rank, wikiPeople(place), faction }.
 * avoid: card ids not to use (the pitches already showing).
 */
export function pitchIncidents(ctx, n = 3, rng = Math.random, avoid = []) {
  const { cal, data, world } = ctx;
  const T = teller(world);
  const P = PERSONALITIES[T.personality] || PERSONALITIES.steady;
  const cards = list(data.incidents?.cards);
  const focus = data.story?.focusMiles || 200;
  const party = ctx.party?.map ? ctx.party : null;
  const places = list(ctx.places).filter(p => p.map && (!party || milesBetween(p.map, party.map) <= focus * 1.5));
  if (!cards.length || !places.length) return [];
  const want = targetDrama(world, rng);
  const season = dateOf(cal, world.today).season;
  const soon = upcoming(cal, world.today, 12);
  const quietDays = T.lastDrama === null ? quietSince(world) : world.today - T.lastDrama;
  const facs = Object.entries(rep(world).factions).map(([title, s]) => ({ title, value: s.value }));
  const grudge = facs.sort((a, b) => a.value - b.value)[0]?.value < 0 ? facs[0] : null;
  const friend = [...facs].sort((a, b) => b.value - a.value)[0]?.value > 0 ? [...facs].sort((a, b) => b.value - a.value)[0] : null;
  const recentAt = title => list(world.chronicle).filter(e => e.places?.includes(title) && world.today - e.day <= 45 && e.kind !== 'festival');
  const opts = [];
  for (const place of places) {
    const st = placeState(data.story, place);
    const troubles = list(ctx.problems).filter(x => x.status !== 'solved' && x.centre && milesBetween(x.centre, place.map) <= x.radius);
    const festival = soon.find(f => !f.where || f.where.includes(place.title)) || null;
    const miles = party ? milesBetween(place.map, party.map) : null;
    const here = party && place.title === party.title;
    const heading = ctx.heading === place.title;
    const standing = standingOf(world, 'place', place.title).value;
    const region = ctx.regionOf ? ctx.regionOf(place) : null;
    const renown = region ? standingOf(world, 'region', region).value : 0;
    const pctx = { ...ctx, place, state: st, settlement: place.settlement, season, troubles, festival, recent: recentAt(place.title), today: world.today, miles, here, heading, quietDays,
      standing, standingName: tierFor(data.story, standing).name.toLowerCase(), renown, regionName: region, grudge, friend,
      shortage: marketAt(world.chronicle, place.title, world.today).find(m => m.kind === 'short')?.good || null };
    const nearW = party ? 1 + 3 * (1 - Math.min(1, miles / focus)) : 1;
    for (const card of cards) {
      if (avoid.includes(card.id) || card.drama > P.maxDrama || (T.quiet && card.drama > 2)) continue;
      const key = `${card.id}@${place.title}`;
      if (Number.isFinite(T.declined[key]) && world.today - T.declined[key] < 60) continue;
      if (list(T.accepted).some(a => a.card === card.id && a.place === place.title && world.today - a.day < 120)) continue;
      if (!incidentFits(card, pctx)) continue;
      const gap = Math.abs(card.drama - want);
      let wt = (card.weight ?? 1) * nearW * (P.kinds[card.kind] ?? 1) * [4, 2, 0.8, 0.3, 0.1][Math.min(4, gap)];
      if (here || heading) wt *= 1.5;
      if (P.situations && card.trouble) wt *= P.situations;
      if (card.when?.follows || card.when?.trouble || card.when?.festival) wt *= 2;
      if (card.when?.shortage) wt *= 3;
      opts.push({ card, pctx, wt });
    }
  }
  const out = [];
  const used = new Set();
  // A person's goal that has come to a head takes a slot most of the time.
  const ready = goalPitches(ctx, list(ctx.people).filter(p => p.map && p.major && !p.locked && !p.dead && (!party || milesBetween(p.map, party.map) <= focus * 1.5)), rng)
    .filter(p => !avoid.includes(p.card) && !list(T.pitches).some(x => x.goalOf === p.goalOf));
  ready.push(...factionPitches(ctx, list(ctx.factions).filter(f => f.map && !f.locked && (!party || milesBetween(f.map, party.map) <= focus * 1.5)), rng)
    .filter(p => !avoid.includes(p.card) && !list(T.pitches).some(x => x.goalOf === p.goalOf)));
  if (ready.length && chance(rng, 0.7)) { const g = pick(rng, ready); out.push(g); used.add(g.card); }
  for (let i = 0; i < n * 4 && out.length < n; i++) {
    const o = weighted(rng, opts.filter(x => !used.has(x.card.id)), x => x.wt);
    if (!o) break;
    used.add(o.card.id);
    out.push(makePitch(o.card, o.pctx, rng));
  }
  return out;
}

/** Turn a pitch down: it won't be offered at that place again for sixty days. */
export function declinePitch(world, pitch) {
  const T = teller(world);
  T.declined[pitch.goalOf ? `goal:${pitch.goalOf}` : `${pitch.card}@${pitch.place}`] = world.today;
  T.pitches = T.pitches.filter(p => p.id !== pitch.id);
}

/** Accepting spends the tension (for anything dramatic) and remembers the card for that place. */
export function acceptPitch(world, pitch) {
  const T = teller(world);
  if (pitch.drama >= 3) T.lastDrama = world.today;
  else if (T.lastDrama !== null) T.lastDrama = Math.min(world.today, T.lastDrama + pitch.drama * 3);
  T.accepted.push({ card: pitch.card, place: pitch.place, day: world.today, title: pitch.title });
  T.pitches = T.pitches.filter(p => p.id !== pitch.id);
}

/** The quest page an accepted pitch makes: premise, how the party hears, scenes, people, rewards. */
export function questMarkdown(p, { link = t => `[[${t}]]` } = {}) {
  const people = p.cast.map(c => `- ${link(c.name)}${c.label ? `: ${c.label}` : ''}`);
  return [
    `## Premise`, '', p.text, '', ':::dm', p.dm, ':::', '',
    `**Where:** ${link(p.place)}${p.newPlaceTitle ? `, and ${link(p.newPlaceTitle)} nearby` : ''}  `,
    `**What the party is asked to do:** ${p.goal}`, '',
    `## Hooks`, '', `- ${p.rumour || p.text}`, ...(p.reason ? [`- The storyteller's reason: ${p.reason}`] : []), '',
    `## Scenes`, '', ...p.scenes.map((s, i) => `${i + 1}. ${s}`), '',
    ...(people.length ? ['## People', '', ...people, ''] : []),
    `## Rewards`, '', `- ${p.reward}`, '',
  ].join('\n');
}

// ---------- reputation ----------
// What the party has done, as standing with each place and faction (-100 to +100, RimWorld's goodwill) and renown
// in each region (0 to 100). Every change is logged with its reason, so pages can say why. Tiers and how much each
// deed is worth are in data/story.json (reputation).

export function rep(world) {
  const r = (world.rep ||= {});
  r.places ||= {}; r.factions ||= {}; r.regions ||= {};
  return r;
}
const repBook = (world, kind) => rep(world)[kind === 'faction' ? 'factions' : kind === 'region' ? 'regions' : 'places'];

/** { value, log: [{ day, delta, why }] } for a place, faction or region. */
export function standingOf(world, kind, title) {
  return repBook(world, kind)[title] || { value: 0, log: [] };
}

/** Move a standing (or a region's renown) and log why. Returns the change actually made after clamping. */
export function addStanding(world, kind, title, delta, why = '', day = world.today) {
  if (!title || !delta) return 0;
  const book = repBook(world, kind);
  const s = (book[title] ||= { value: 0, log: [] });
  const lo = kind === 'region' ? 0 : -100;
  const next = Math.max(lo, Math.min(100, Math.round(s.value + delta)));
  const made = next - s.value;
  if (!made) return 0;
  s.value = next;
  s.log.push({ day, delta: made, why });
  if (s.log.length > 40) s.log.splice(0, s.log.length - 40);
  return made;
}

const DEFAULT_TIERS = [
  { min: 60, name: 'Honoured', price: -10, pay: 10, text: 'Doors open everywhere. Prices drop and the best contracts come to the party first.' },
  { min: 20, name: 'Liked', price: -5, pay: 5, text: 'People are glad to see the party and give them the benefit of the doubt.' },
  { min: -19, name: 'Neutral', price: 0, pay: 0, text: 'Just another band of adventurers.' },
  { min: -59, name: 'Disliked', price: 10, pay: -5, text: 'Prices go up, doors close, and some contracts go to other teams.' },
  { min: -100, name: 'Hated', price: 25, pay: -10, text: 'People refuse to deal with the party, and someone may come looking for them.' },
];
/** The tier a standing falls in: { name, price (% on prices), pay (% on contract pay), text }. */
export function tierFor(story, value) {
  const tiers = list(story?.reputation?.tiers).length ? story.reputation.tiers : DEFAULT_TIERS;
  return tiers.find(t => value >= t.min) || tiers.at(-1);
}
/** Renown in words. */
export function renownName(value) {
  return value >= 75 ? 'Legendary' : value >= 50 ? 'Famous' : value >= 25 ? 'Known' : value >= 10 ? 'Heard of' : 'Unknown';
}

export const OUTCOMES = [
  { key: 'success', label: 'They succeeded', place: 4, region: 3, faction: 4 },
  { key: 'partial', label: 'Partly: a mixed result', place: 2, region: 1, faction: 2 },
  { key: 'failed', label: 'They tried and failed', place: -1, region: 0, faction: -1 },
  { key: 'ignored', label: 'They ignored it', place: -2, region: -1, faction: -2 },
  { key: 'worse', label: 'They made it worse', place: -5, region: -2, faction: -5 },
];
/** How much an outcome is worth: scaled by the incident's drama. Returns { place, region, faction }. */
export function outcomeDeltas(outcome, drama = 2, story = null) {
  const o = OUTCOMES.find(x => x.key === outcome) || OUTCOMES[0];
  const k = (story?.reputation?.scale ?? 2) * Math.max(1, drama);
  return { place: Math.round(o.place * k), region: Math.round(o.region * k / 2), faction: Math.round(o.faction * k) };
}

// ---------- people ----------
// Traits, goals, ties and memories for NPCs (data/people.json). Records live in world.people by page title. Only the
// major NPCs near the party act on their own; everyone keeps an opinion of the party, which starts from how their
// home place sees it and moves with what the party does to them.

const blankPerson = () => ({ traits: [], goal: null, ties: [], opinion: 0, pcs: {}, log: [] });
const copy = x => x == null ? x : JSON.parse(JSON.stringify(x));
export function folk(world) { return (world.people ||= {}); }
export function person(world, title) {
  const r = (folk(world)[title] ||= blankPerson());
  for (const [k, v] of Object.entries(blankPerson())) if (r[k] === undefined) r[k] = v;
  return r;
}
export const traitInfo = (P, key) => list(P?.traits).find(t => t.key === key) || null;
export const goalInfo = (P, key) => list(P?.goals).find(g => g.key === key) || null;
export const tieInfo = (P, key) => list(P?.ties).find(t => t.key === key) || { key, name: key, back: key };
const tagsOf = (P, traits) => list(traits).flatMap(k => list(traitInfo(P, k)?.tags));
const clash = (P, a, b) => list(P?.opposed).some(([x, y]) => (a.includes(x) && b.includes(y)) || (a.includes(y) && b.includes(x)));

/** Three (or n) traits that don't contradict each other. */
export function rollTraits(P, rng = Math.random, n = 3, keep = []) {
  const out = [...keep];
  const pool = list(P?.traits).filter(t => !out.includes(t.key));
  for (let i = 0; i < 40 && out.length < n && pool.length; i++) {
    const t = pick(rng, pool);
    pool.splice(pool.indexOf(t), 1);
    if (!clash(P, tagsOf(P, out), t.tags)) out.push(t.key);
  }
  return out;
}
export const traitText = (P, traits) => {
  const n = list(traits).map(k => (traitInfo(P, k)?.name || k).toLowerCase());
  return n.length > 1 ? `${n.slice(0, -1).join(', ')} and ${n.at(-1)}` : n[0] || '';
};
/** How well two people get on, from their traits: shared leanings pull together, opposed ones push apart. */
export function compat(P, a, b) {
  const ta = tagsOf(P, a), tb = tagsOf(P, b);
  let c = new Set(ta.filter(x => tb.includes(x))).size;
  for (const [x, y] of list(P?.opposed)) if ((ta.includes(x) && tb.includes(y)) || (ta.includes(y) && tb.includes(x))) c -= 2;
  return c;
}

const RANKS = ['Normal', 'Iron', 'Bronze', 'Silver', 'Gold', 'Diamond'];
/** A goal that suits the traits. fill: { place, rank, rival, faction, church, goods } for its words. */
export function newGoal(P, traits, rng = Math.random, fill = {}, day = 0, avoid = []) {
  const tags = tagsOf(P, traits);
  const g = weighted(rng, list(P?.goals).filter(x => !avoid.includes(x.key)), x => 1 + 3 * list(x.likes).filter(l => tags.includes(l)).length);
  if (!g) return null;
  const next = RANKS[Math.min(RANKS.length - 1, RANKS.indexOf(fill.rank || 'Normal') + 1)];
  return { key: g.key, step: 0, since: day, fill: { place: fill.place || 'town', rival: fill.rival || 'a rival', faction: fill.faction || 'a great house', church: fill.church || pick(rng, CHURCHES), goods: fill.goods || 'grain', craft: pick(rng, list(g.craft)) || 'smith', nextrank: next === 'Normal' ? 'Iron' : next } };
}
const goalFill = (g, who) => ({ ...(g?.fill || {}), person: who });
export const goalText = (P, g, who = '') => g ? fill(goalInfo(P, g.key)?.wants || g.key, goalFill(g, who)) : '';
/** Who a goal is about: the person, and the rival it names (who may not have a page yet). */
export const goalPeople = (P, g, who) => [who, ...(g?.fill?.rival && g.fill.rival !== 'a rival' && list(goalInfo(P, g.key)?.steps).concat(goalInfo(P, g.key)?.wants || '').some(x => x.includes('{rival}')) ? [g.fill.rival] : [])];
export const goalSteps = (P, g) => list(goalInfo(P, g?.key)?.steps).length || 3;
export const stepText = (P, g, who, step = g?.step) => step > 0 ? fill(list(goalInfo(P, g.key)?.steps)[step - 1] || '', goalFill(g, who)) : '';
/** A goal at its last step is ready to come to a head: the storyteller can pitch it. */
export const goalReady = (P, g) => !!g && !g.done && g.step >= goalSteps(P, g);

export const tiesOf = (world, title) => list(folk(world)[title]?.ties);
export const tieBetween = (world, a, b) => tiesOf(world, a).find(t => t.to === b) || null;
/** Tie a to b (and b back to a with the matching kind), replacing any tie they had. kind null unties them. */
export function setTie(world, P, a, b, kind, day = world.today) {
  if (!a || !b || a === b) return;
  const ra = person(world, a), rb = person(world, b);
  ra.ties = ra.ties.filter(t => t.to !== b);
  rb.ties = rb.ties.filter(t => t.to !== a);
  if (!kind) return;
  ra.ties.push({ to: b, kind, since: day });
  rb.ties.push({ to: a, kind: tieInfo(P, kind).back || kind, since: day });
}

export function opinionName(P, v) {
  const tiers = list(P?.opinion).length ? P.opinion : [{ min: 25, name: 'Friendly' }, { min: -24, name: 'Indifferent' }, { min: -100, name: 'Hostile' }];
  return (tiers.find(t => v >= t.min) || tiers.at(-1)).name;
}
/** Something the party (or one member, pc) did that this person remembers. Returns how much it moved. */
export function remember(world, title, delta, why = '', pc = null, day = world.today) {
  if (!title || !delta) return 0;
  const r = person(world, title);
  const old = pc ? r.pcs[pc] || 0 : r.opinion;
  const next = clamp(old + delta, -100, 100);
  if (next === old) return 0;
  if (pc) r.pcs[pc] = next; else r.opinion = next;
  r.log.push({ day, delta: next - old, why, ...(pc ? { pc } : {}) });
  if (r.log.length > 40) r.log.splice(0, r.log.length - 40);
  return next - old;
}
/** What they think of the party (or of one member): base (from their place's standing) plus their own memories. */
export function opinionOf(world, title, { base = 0, pc = null } = {}) {
  const r = folk(world)[title];
  return clamp(base + (r?.opinion || 0) + (pc ? r?.pcs?.[pc] || 0 : 0), -100, 100);
}

/** Undo one simulated change to a person, kept on its chronicle entry as fx. */
export function undoPersonFx(world, P, fx) {
  if (!fx) return;
  if (fx.type === 'traits') person(world, fx.title).traits = copy(fx.prev) || [];
  if (fx.type === 'goal') person(world, fx.title).goal = copy(fx.prev);
  if (fx.type === 'step') { const g = person(world, fx.title).goal; if (g && g.key === fx.key && g.step > 0) g.step--; }
  if (fx.type === 'tie') setTie(world, P, fx.a, fx.b, fx.prev?.kind || null, fx.prev?.since);
}

/**
 * One month for the major NPCs near the party: traits and goals for those without, goals moving a step, and ties
 * forming, deepening or breaking between people in the same place. Changes `world` (a working copy) and returns
 * chronicle entries, each with the fx to undo it. people: [{ title, place, map, rank }].
 */
export function peopleMonth(ctx, people, day, rng) {
  const { data, world } = ctx;
  const P = data.people || {};
  const S = P.sim || {};
  const E = P.events || {};
  const out = [];
  const push = (fields, fx) => { const e = entry({ day, kind: 'person', isPublic: false, ...fields }, rng); e.fx = fx; out.push(e); };
  // Everyone gets traits quietly (they show on their page); a few each month work on their goals.
  for (const p of people) { const r = person(world, p.title); if (!r.traits.length) r.traits = rollTraits(P, rng); }
  const pool = [...people], acting = [];
  while (pool.length && acting.length < (S.actorsPerMonth ?? 8)) acting.push(...pool.splice(Math.floor(rng() * pool.length), 1));
  for (const p of acting) {
    const r = person(world, p.title);
    if (!r.goal || r.goal.done) {
      if (!chance(rng, S.newGoalPerMonth ?? 0.5)) continue;
      const prev = copy(r.goal);
      const rivals = people.filter(x => x.title !== p.title && x.place === p.place);
      const foe = r.ties.find(t => ['rival', 'enemy', 'lover', 'owed'].includes(t.kind));
      r.goal = newGoal(P, r.traits, rng, { place: p.place, rank: p.rank, rival: foe?.to || pick(rng, rivals)?.title || localName(data, rng), faction: ctx.faction || pick(rng, list(data.incidents?.factions)), goods: pick(rng, list(data.story?.goods)) }, day, [...(prev ? [prev.key] : []), ...rivals.map(x => folk(world)[x.title]?.goal?.key).filter(Boolean)]);
      if (r.goal) push({ title: `${p.title} has a goal`, text: fill(E.goal || '{person} wants to {wants}.', { person: p.title, wants: goalText(P, r.goal, p.title) }), places: [p.place], people: goalPeople(P, r.goal, p.title), tags: ['goal'], at: p.map }, { type: 'goal', title: p.title, prev });
      continue;
    }
    if (goalReady(P, r.goal)) continue;
    const pace = list(r.traits).reduce((t, k) => t + (traitInfo(P, k)?.pace || 0), 0);
    if (!chance(rng, Math.max(0.05, (S.goalStepPerMonth ?? 0.35) * (1 + 0.3 * pace)))) continue;
    r.goal.step++;
    const ready = goalReady(P, r.goal);
    push({ title: `${p.title}: ${ready ? 'ready to act' : 'a step closer'}`, text: stepText(P, r.goal, p.title), dm: ready ? 'Their goal is coming to a head: the storyteller can pitch it.' : '', places: [p.place], people: goalPeople(P, r.goal, p.title), tags: ['goal', ready ? 'ready' : 'step'], at: p.map }, { type: 'step', title: p.title, key: r.goal.key });
  }
  // Ties between people in the same place.
  const byPlace = new Map();
  for (const p of people) byPlace.set(p.place, [...(byPlace.get(p.place) || []), p]);
  for (const [place, here] of byPlace) {
    if (here.length < 2 || !chance(rng, S.tiesPerMonth ?? 0.35)) continue;
    const a = pick(rng, here), b = pick(rng, here.filter(x => x !== a));
    const ra = person(world, a.title), rb = person(world, b.title);
    const was = tieBetween(world, a.title, b.title);
    const c = compat(P, ra.traits, rb.traits);
    let kind = null, ev = null, isPublic = false;
    if (!was) {
      const love = [...tagsOf(P, ra.traits), ...tagsOf(P, rb.traits)].includes('love');
      if (c >= 1) { kind = love && chance(rng, 0.5) ? 'lover' : 'friend'; ev = kind; }
      else if (c <= -1) { kind = 'rival'; ev = 'rival'; }
      else if (chance(rng, 0.5)) { kind = chance(rng, 0.6) ? 'friend' : 'rival'; ev = kind; }
    } else if (was.kind === 'lover' && day - (was.since ?? day) >= (S.marryAfterDays ?? 150) && chance(rng, (S.marryPerMonth ?? 0.12) * 4)) { kind = 'spouse'; ev = 'spouse'; isPublic = true; }
    else if (was.kind === 'spouse' && chance(rng, (S.childPerMonth ?? 0.03) * 4)) {
      push({ title: `A child for ${a.title} and ${b.title}`, text: fill(pick(rng, list(E.child)) || 'A child was born to {a} and {b}.', { a: a.title, b: b.title, place, child: localName(data, rng).split(' ')[0] }), places: [place], people: [a.title, b.title], tags: ['family'], at: a.map, isPublic: true }, null);
      continue;
    } else if (['friend', 'lover'].includes(was.kind) && c < 0 && chance(rng, (S.breakupPerMonth ?? 0.04) * 4)) { kind = 'rival'; ev = 'breakup'; }
    else if (['rival', 'enemy'].includes(was.kind) && c > 0 && chance(rng, (S.reconcilePerMonth ?? 0.04) * 4)) { kind = 'friend'; ev = 'reconcile'; }
    if (!kind) continue;
    const prev = was ? { kind: was.kind, since: was.since } : null;
    setTie(world, P, a.title, b.title, kind, day);
    push({ title: `${a.title} and ${b.title}`, text: fill(pick(rng, list(E[ev])) || `${a.title} and ${b.title}: ${tieInfo(P, kind).name}.`, { a: a.title, b: b.title, place }), places: [place], people: [a.title, b.title], tags: ['tie', kind], at: a.map, isPublic }, { type: 'tie', a: a.title, b: b.title, prev });
  }
  return out;
}

/** Storyteller pitches from goals that have come to a head. people: [{ title, place, map }] near the party. */
export function goalPitches(ctx, people, rng = Math.random) {
  const { data, world } = ctx;
  const P = data.people || {};
  const T = teller(world);
  const out = [];
  for (const p of list(people)) {
    const g = folk(world)[p.title]?.goal;
    if (!goalReady(P, g)) continue;
    const key = `goal:${p.title}`;
    if (Number.isFinite(T.declined[key]) && world.today - T.declined[key] < 60) continue;
    const G = goalInfo(P, g.key);
    const place = list(ctx.places).find(x => x.title === p.place);
    if (!G?.climax || !place) continue;
    const card = { id: `goal-${g.key}`, name: G.name, ...G.climax, newPlace: G.newPlace || G.climax.newPlace || null, tags: ['goal'] };
    const pitch = makePitch(card, { ...ctx, place, fillExtra: goalFill(g, p.title), today: world.today }, rng);
    pitch.cast = [{ key: 'person', name: p.title, role: null, label: 'whose goal it is', page: p.title }, ...pitch.cast];
    pitch.reason = `${p.title} wants to ${goalText(P, g, p.title)}, and it is coming to a head.`;
    pitch.goalOf = p.title;
    out.push(pitch);
  }
  return out;
}

// ---------- economy ----------
// A place makes a few goods (from its terrain and size, or meta.makes) and needs others. Minor events with econ make it
// short of or rich in one for a while; that lives on the chronicle entry, so undoing the event ends it too.

const hashSeed = s => [...String(s)].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);
export function economyOf(data, place) {
  const X = data.factions?.econ || {};
  const goods = list(data.story?.goods);
  const meta = place.meta || {};
  // What its industry makes (a generated place carries the industry as a tag) always counts.
  const tags = list(meta.tags).map(t => String(t).toLowerCase());
  const industry = list(data.places?.industries).filter(i => tags.includes(i.name.toLowerCase())).map(i => i.goods);
  let makes = list(meta.makes).length ? list(meta.makes) : [...new Set([...list(place.terrain || meta.terrain).flatMap(t => list(X.terrain?.[t])), ...list(X.settlement?.[place.settlement])])];
  const rng = makeRng(hashSeed(place.title));
  if (makes.length > 3) { const keep = []; const pool = [...makes]; while (keep.length < 3) keep.push(...pool.splice(Math.floor(rng() * pool.length), 1)); makes = keep; }
  makes = [...new Set([...industry, ...makes])];
  let needs = list(meta.needs);
  if (!needs.length) { const pool = goods.filter(g => !makes.includes(g)); while (needs.length < 2 && pool.length) needs.push(...pool.splice(Math.floor(rng() * pool.length), 1)); }
  return { makes, needs };
}
/** The shortages and gluts at a place today, from the chronicle. */
export function marketAt(chronicle, title, today) {
  return list(chronicle).filter(e => e.econ && e.places?.[0] === title && e.day <= today && today < e.econ.until)
    .map(e => ({ good: e.econ.good, kind: e.econ.kind, until: e.econ.until, id: e.id }));
}
/** How much more (or less) things cost at a place because of its shortages and gluts, in percent. */
export function marketPrice(data, market) {
  const X = data.factions?.econ || {};
  return list(market).reduce((t, m) => t + (m.kind === 'short' ? X.shortPrice ?? 10 : X.plentyPrice ?? -5), 0);
}

// ---------- factions ----------
// Houses, churches, guilds, societies and cults with goals, power, wealth, influence by place, allies and rivals.
// Records live in world.factions by page title. The ones seated near the party act once a month.

const blankFaction = () => ({ goal: null, power: 50, wealth: 50, influence: {}, ties: [] });
export function factionRec(world, title) {
  const r = ((world.factions ||= {})[title] ||= blankFaction());
  for (const [k, v] of Object.entries(blankFaction())) if (r[k] === undefined) r[k] = v;
  return r;
}
export const factionKind = (title, type) => type === 'cult' ? 'cult' : /^church\b/i.test(title) ? 'church' : /^house\b/i.test(title) ? 'house' : /society/i.test(title) ? 'society' : /guild|company|league/i.test(title) ? 'guild' : 'any';
export const fGoalInfo = (F, key) => list(F?.goals).find(g => g.key === key) || null;
export const fGoalText = (F, g, who = '') => g ? fill(fGoalInfo(F, g.key)?.wants || g.key, { ...g.fill, faction: who }) : '';
export const fStepText = (F, g, who, step = g?.step) => step > 0 ? fill(list(fGoalInfo(F, g.key)?.steps)[step - 1] || '', { ...g.fill, faction: who }) : '';
export const fGoalSteps = (F, g) => list(fGoalInfo(F, g?.key)?.steps).length || 3;
export const fGoalReady = (F, g) => !!g && !g.done && g.step >= fGoalSteps(F, g);
export const fTieBetween = (world, a, b) => list(world.factions?.[a]?.ties).find(t => t.to === b) || null;
export function setFactionTie(world, a, b, kind, day = world.today) {
  if (!a || !b || a === b) return;
  const ra = factionRec(world, a), rb = factionRec(world, b);
  ra.ties = ra.ties.filter(t => t.to !== b);
  rb.ties = rb.ties.filter(t => t.to !== a);
  if (kind) { ra.ties.push({ to: b, kind, since: day }); rb.ties.push({ to: a, kind, since: day }); }
}
export function newFactionGoal(F, kind, rng, fill = {}, day = 0, avoid = []) {
  const g = weighted(rng, list(F?.goals).filter(x => !avoid.includes(x.key) && (list(x.kinds).includes(kind) || list(x.kinds).includes('any'))), x => list(x.kinds).includes(kind) ? 3 : 1);
  if (!g) return null;
  // fill.rivals: [{ title, kind }] to choose the rival from; a goal with rivalKind wants one of that kind.
  const pool = list(fill.rivals).filter(x => !g.rivalKind || x.kind === g.rivalKind);
  const rival = fill.rival || pick(rng, pool)?.title || (g.rivalKind ? `a rival ${g.rivalKind}` : 'its rivals');
  return { key: g.key, step: 0, since: day, fill: { place: fill.place || 'the city', rival, goods: fill.goods || 'grain' } };
}
/** What winning its goal gives a faction (and costs its rival). Returns the fx to undo it. */
export function factionWins(world, F, title, day = world.today) {
  const r = factionRec(world, title);
  const g = r.goal;
  const win = fGoalInfo(F, g?.key)?.win || {};
  const prev = { [title]: copy(r) };
  const rival = g?.fill?.rival && world.factions?.[g.fill.rival] ? g.fill.rival : null;
  if (rival) prev[rival] = copy(world.factions[rival]);
  if (win.influence && g.fill.place) r.influence[g.fill.place] = clamp((r.influence[g.fill.place] || 0) + win.influence);
  if (win.power) r.power = clamp(r.power + win.power);
  if (win.wealth) r.wealth = clamp(r.wealth + win.wealth);
  if (rival && win.rivalPower) factionRec(world, rival).power = clamp(world.factions[rival].power + win.rivalPower);
  if (win.tie && g.fill.rival) setFactionTie(world, title, g.fill.rival, win.tie, day);
  if (g) g.done = day;
  return { type: 'faction', prev };
}
export function undoFactionFx(world, fx) {
  if (fx?.type === 'fgoal') factionRec(world, fx.title).goal = copy(fx.prev);
  if (fx?.type === 'fstep') {
    const r = factionRec(world, fx.title);
    if (r.goal?.key === fx.key && r.goal.step > 0) r.goal.step--;
    if (fx.place && fx.inf) r.influence[fx.place] = Math.max(0, (r.influence[fx.place] || 0) - fx.inf);
  }
  if (fx?.type === 'ftie') setFactionTie(world, fx.a, fx.b, fx.prev?.kind || null, fx.prev?.since);
  if (fx?.type === 'control') { const c = (world.control ||= {}); if (fx.prev) c[fx.point] = copy(fx.prev); else delete c[fx.point]; if (fx.tie) setFactionTie(world, fx.tie.a, fx.tie.b, fx.tie.prev?.kind || null, fx.tie.prev?.since); }
  if (fx?.type !== 'faction') return;
  const book = (world.factions ||= {});
  for (const [t, r] of Object.entries(fx.prev || {})) {
    if (r == null) delete book[t]; else book[t] = copy(r);
    // Ties are kept both ways: put the other side back to match.
    for (const [o, ro] of Object.entries(book)) if (o !== t && !fx.prev[o]) {
      const mine = list(book[t]?.ties).find(x => x.to === o);
      ro.ties = list(ro.ties).filter(x => x.to !== t);
      if (mine) ro.ties.push({ to: t, kind: mine.kind, since: mine.since });
    }
  }
}

/**
 * One month for the factions seated near the party: goals for those without, a step for some, influence where they
 * work, and now and then a new ally or rival. factions: [{ title, kind, place, map }]; places: titles they can work in.
 */
export function factionsMonth(ctx, factions, day, rng) {
  const { data, world } = ctx;
  const F = data.factions || {};
  const S = F.sim || {};
  const out = [];
  const push = (fields, fx) => { const e = entry({ day, kind: 'faction', isPublic: false, ...fields }, rng); e.fx = fx; out.push(e); };
  const pool = [...factions], acting = [];
  while (pool.length && acting.length < (S.actorsPerMonth ?? 3)) acting.push(...pool.splice(Math.floor(rng() * pool.length), 1));
  for (const f of acting) {
    const r = factionRec(world, f.title);
    if (!r.goal || r.goal.done) {
      const prev = copy(r.goal);
      if (!chance(rng, S.newGoalPerMonth ?? 0.5)) continue;
      const others = factions.filter(x => x.title !== f.title);
      const foe = r.ties.find(t => t.kind === 'enemy' || t.kind === 'rival')?.to;
      const near = list(ctx.placesNear?.(f)).length ? ctx.placesNear(f) : [f.place];
      r.goal = newFactionGoal(F, f.kind, rng, { place: pick(rng, near), rival: foe, rivals: others, goods: pick(rng, list(data.story?.goods)) }, day, r.goal ? [r.goal.key] : []);
      if (r.goal) push({ title: `${f.title} ${verb(f.title, 'has')} a goal`, text: `${f.title} ${verb(f.title, 'wants')} to ${fGoalText(F, r.goal, f.title)}.`, places: [r.goal.fill.place], factions: [f.title], tags: ['goal'], at: f.map }, { type: 'fgoal', title: f.title, prev });
      continue;
    }
    if (fGoalReady(F, r.goal)) continue;
    if (!chance(rng, (S.goalStepPerMonth ?? 0.3) * (0.6 + r.power / 100))) continue;
    r.goal.step++;
    const pl = r.goal.fill.place;
    const inf = pl ? clamp((r.influence[pl] || 0) + (S.influencePerStep ?? 5)) - (r.influence[pl] || 0) : 0;
    if (inf) r.influence[pl] += inf;
    const ready = fGoalReady(F, r.goal);
    push({ title: `${f.title}: ${ready ? 'ready to act' : 'a step closer'}`, text: fStepText(F, r.goal, f.title), dm: ready ? 'Its goal is coming to a head: the storyteller can pitch it.' : '', places: pl ? [pl] : [], factions: [f.title], tags: ['goal', ready ? 'ready' : 'step'], at: f.map }, { type: 'fstep', title: f.title, key: r.goal.key, place: pl, inf });
  }
  // Control points: each one held pays its holder; now and then a faction tries to claim or take one near its seat.
  const control = (world.control ||= {});
  for (const [, c] of Object.entries(control)) if (c.by && world.factions?.[c.by]) factionRec(world, c.by).wealth = clamp(factionRec(world, c.by).wealth + (S.pointWealth ?? 2));
  const points = list(ctx.points);
  if (points.length && factions.length && chance(rng, S.contestPerMonth ?? 0.25)) {
    const f = pick(rng, factions);
    const near = points.filter(x => x.map && f.map && milesBetween(x.map, f.map) <= (S.pointMiles ?? 60) && control[x.title]?.by !== f.title);
    const x = near.length ? pick(rng, near) : null;
    if (x) {
      const held = control[x.title]?.by || null;
      const r = factionRec(world, f.title);
      const odds = held ? r.power / Math.max(1, r.power + factionRec(world, held).power) : 0.7;
      const won = chance(rng, odds);
      const prev = control[x.title] ? copy(control[x.title]) : null;
      const was = held ? fTieBetween(world, f.title, held) : null;
      const tie = held && (won || chance(rng, 0.6)) && was?.kind !== 'rival' ? { a: f.title, b: held, prev: was ? { kind: was.kind, since: was.since } : null } : null;
      if (won) control[x.title] = { ...(prev || {}), kind: x.kind || prev?.kind || 'control point', by: f.title, since: day };
      if (tie) setFactionTie(world, f.title, held, 'rival', day);
      const text = won ? (held ? `${f.title} ${verb(f.title, 'has')} taken ${x.title} from ${held}.` : `${f.title} ${verb(f.title, 'has')} taken charge of ${x.title}.`) : `${f.title} tried to take ${x.title} from ${held}, and ${verb(f.title, 'was')} driven off.`;
      if (won || held) push({ title: `${x.title}: ${won ? `held by ${f.title}` : 'an attempt beaten off'}`, text, places: [x.title, ...(x.place && x.place !== x.title ? [x.place] : [])], factions: [f.title, ...(held ? [held] : [])], tags: ['control', won ? 'won' : 'lost'], at: x.map, isPublic: true }, { type: 'control', point: x.title, prev, tie });
    }
  }
  if (factions.length >= 2 && chance(rng, S.tiesPerMonth ?? 0.15)) {
    const a = pick(rng, factions), b = pick(rng, factions.filter(x => x !== a));
    if (!fTieBetween(world, a.title, b.title)) {
      const same = a.kind === b.kind && a.kind !== 'any';
      const kind = chance(rng, same ? 0.65 : 0.4) ? 'rival' : 'ally';
      setFactionTie(world, a.title, b.title, kind, day);
      push({ title: `${a.title} and ${b.title}`, text: kind === 'ally' ? `${a.title} and ${b.title} have made common cause.` : `${a.title} and ${b.title} are at odds, and everyone in ${a.place} knows it.`, places: [a.place], factions: [a.title, b.title], tags: ['tie', kind], at: a.map, isPublic: kind === 'rival' }, { type: 'ftie', a: a.title, b: b.title, prev: null });
    }
  }
  return out;
}

/** Storyteller pitches from faction goals that have come to a head. factions: [{ title, place, map }] near the party. */
export function factionPitches(ctx, factions, rng = Math.random) {
  const { data, world } = ctx;
  const F = data.factions || {};
  const T = teller(world);
  const out = [];
  for (const f of list(factions)) {
    const g = world.factions?.[f.title]?.goal;
    if (!fGoalReady(F, g)) continue;
    const key = `goal:${f.title}`;
    if (Number.isFinite(T.declined[key]) && world.today - T.declined[key] < 60) continue;
    const G = fGoalInfo(F, g.key);
    const place = list(ctx.places).find(x => x.title === g.fill.place) || list(ctx.places).find(x => x.title === f.place);
    if (!G?.climax || !place) continue;
    const card = { id: `fgoal-${g.key}`, name: G.name, ...G.climax, tags: ['goal', 'faction'] };
    const pitch = makePitch(card, { ...ctx, place, faction: f.title, fillExtra: { ...g.fill, faction: f.title }, today: world.today }, rng);
    pitch.reason = `${f.title} ${verb(f.title, 'wants')} to ${fGoalText(F, g, f.title)}, and it is coming to a head.`;
    pitch.goalOf = f.title;
    pitch.factionGoal = true;
    pitch.faction = f.title;
    out.push(pitch);
  }
  return out;
}

// ---------- legends and history ----------

/** Everyone and everywhere the chronicle mentions, with how often. entries: those the viewer may see. */
export function legendsIndex(entries) {
  const book = { places: new Map(), people: new Map(), factions: new Map(), strangers: new Set() };
  const add = (k, t) => { if (t) book[k].set(t, (book[k].get(t) || 0) + 1); };
  for (const e of list(entries)) {
    if (e.kind === 'festival') continue;
    new Set(list(e.places)).forEach(t => add('places', t));
    if (!oldLocals(e)) new Set(list(e.people)).forEach(t => add('people', t));
    // Townsfolk the engine named, who have no page yet, are people too.
    if (Array.isArray(e.locals)) new Set(e.locals).forEach(t => { add('people', t); book.strangers.add(t); });
    new Set(list(e.factions)).forEach(t => add('factions', t));
  }
  return book;
}

/** The ties between people (and between factions) as a graph: { nodes: [{ id, kind }], edges: [{ a, b, kind }] }. */
export function webOf(world, { factions = true, only = null } = {}) {
  const nodes = new Map(), edges = [];
  const seen = new Set();
  const add = (book, kind) => {
    for (const [t, r] of Object.entries(book || {})) for (const tie of list(r.ties)) {
      if (only && !only.has(t) && !only.has(tie.to)) continue;
      const key = [t, tie.to].sort().join('\u0000');
      if (seen.has(key)) continue;
      seen.add(key);
      if (!nodes.has(t)) nodes.set(t, { id: t, kind });
      if (!nodes.has(tie.to)) nodes.set(tie.to, { id: tie.to, kind });
      edges.push({ a: t, b: tie.to, kind: tie.kind });
    }
  };
  add(world.people, 'person');
  if (factions) add(world.factions, 'faction');
  return { nodes: [...nodes.values()], edges };
}

/**
 * Lay a graph out the same way every time: each group of connected nodes gets springs and repulsion in its own box,
 * and the boxes are packed in rows across the width. Returns a Map of id -> { x, y }, with .height for the whole.
 */
export function layoutWeb(graph, w = 900, h = 600, seed = 1) {
  const rng = makeRng(seed);
  const near = new Map(graph.nodes.map(nd => [nd.id, []]));
  for (const e of graph.edges) { near.get(e.a)?.push(e.b); near.get(e.b)?.push(e.a); }
  const groups = [], seen = new Set();
  for (const nd of graph.nodes) {
    if (seen.has(nd.id)) continue;
    const g = [], todo = [nd.id];
    seen.add(nd.id);
    while (todo.length) { const x = todo.pop(); g.push(x); for (const y of near.get(x) || []) if (!seen.has(y)) { seen.add(y); todo.push(y); } }
    groups.push(g);
  }
  groups.sort((a, b) => b.length - a.length);
  const pos = new Map();
  let x0 = 0, y0 = 0, rowH = 0;
  for (const g of groups) {
    const gw = Math.min(w, 170 + 95 * Math.sqrt(g.length) * 1.4), gh = Math.min(h * 2, 90 + 70 * Math.sqrt(g.length));
    if (x0 + gw > w && x0 > 0) { x0 = 0; y0 += rowH; rowH = 0; }
    const local = new Map(g.map((id, i) => { const a = (i / g.length) * Math.PI * 2; return [id, { x: gw / 2 + Math.cos(a) * gw * 0.3 + (rng() - 0.5) * 4, y: gh / 2 + Math.sin(a) * gh * 0.3 + (rng() - 0.5) * 4 }]; }));
    const edges = graph.edges.filter(e => local.has(e.a));
    const k = Math.sqrt((gw * gh) / g.length) * 0.55;
    for (let it = 0; it < 300 && g.length > 1; it++) {
      const disp = new Map(g.map(id => [id, { x: 0, y: 0 }]));
      for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
        const pa = local.get(g[i]), pb = local.get(g[j]);
        const dx = pa.x - pb.x, dy = pa.y - pb.y, d = Math.max(1, Math.hypot(dx, dy)), f = (k * k) / d;
        disp.get(g[i]).x += (dx / d) * f; disp.get(g[i]).y += (dy / d) * f;
        disp.get(g[j]).x -= (dx / d) * f; disp.get(g[j]).y -= (dy / d) * f;
      }
      for (const e of edges) {
        const pa = local.get(e.a), pb = local.get(e.b);
        const dx = pa.x - pb.x, dy = pa.y - pb.y, d = Math.max(1, Math.hypot(dx, dy)), f = (d * d) / k;
        disp.get(e.a).x -= (dx / d) * f; disp.get(e.a).y -= (dy / d) * f;
        disp.get(e.b).x += (dx / d) * f; disp.get(e.b).y += (dy / d) * f;
      }
      const t = (gw / 8) * (1 - it / 300) + 0.5;
      for (const id of g) {
        const p = local.get(id), dd = disp.get(id), l = Math.max(1, Math.hypot(dd.x, dd.y));
        p.x = Math.max(60, Math.min(gw - 60, p.x + (dd.x / l) * Math.min(l, t)));
        p.y = Math.max(28, Math.min(gh - 20, p.y + (dd.y / l) * Math.min(l, t)));
      }
    }
    for (const [id, p] of local) pos.set(id, { x: x0 + p.x, y: y0 + p.y });
    x0 += gw; rowH = Math.max(rowH, gh);
  }
  pos.height = Math.max(120, y0 + rowH);
  return pos;
}

/**
 * About the last `years` years of a region's history, for the DM to review: small events in its places, ties between
 * its major NPCs, and what its factions won or lost. Nothing is changed: each entry carries `apply`, what keeping it
 * does. ctx: { cal, data, world, places (the region's settlements), people (its major NPCs), factions (seated in it) }.
 */
export function worldgen(ctx, years = 10, seed = Math.floor(Math.random() * 2 ** 31)) {
  const { cal, data, world } = ctx;
  const rng = makeRng(seed);
  const P = data.people || {}, F = data.factions || {}, E = P.events || {};
  const end = world.today - 1, start = world.today - Math.round(years * 365.25);
  const when = () => int(rng, start, end);
  const out = [];
  const big = new Set(['death', 'disaster', 'feud', 'family', 'politics', 'church', 'monster', 'hero', 'harvest', 'economy', 'crime']);
  for (const place of list(ctx.places)) {
    const n = int(rng, 1, ({ city: 5, town: 4, village: 3, hamlet: 2 })[place.settlement] || 3);
    const used = [];
    for (let i = 0; i < n; i++) {
      const day = when();
      const e = minorEvent(data, place, day, cal, rng, { avoid: used, stateNow: placeState(data.story, place) });
      if (!e || !list(e.tags).some(t => big.has(t))) continue;
      used.push(e.source);
      e.kind = 'history';
      e.effects = {};
      delete e.econ;
      out.push(e);
    }
  }
  // Ties between the region's people, from their traits.
  const traits = new Map();
  for (const p of list(ctx.people)) {
    const have = list(world.people?.[p.title]?.traits);
    if (have.length) traits.set(p.title, have);
    else { const t = rollTraits(P, rng); traits.set(p.title, t); out.push({ ...entry({ day: end, kind: 'history', title: `${p.title}: who they are`, text: `${p.title} is ${traitText(P, t)}.`, people: [p.title], places: [p.place], isPublic: false }, rng), quiet: true, apply: { type: 'traits', title: p.title, traits: t } }); }
  }
  const byPlace = new Map();
  for (const p of list(ctx.people)) byPlace.set(p.place, [...(byPlace.get(p.place) || []), p]);
  for (const [place, here] of byPlace) {
    const n = Math.min(6, Math.floor(here.length / 2) + int(rng, 0, 1));
    const done = new Set();
    for (let i = 0; i < n * 3 && done.size < n && here.length >= 2; i++) {
      const a = pick(rng, here), b = pick(rng, here.filter(x => x !== a));
      const key = [a.title, b.title].sort().join('|');
      if (done.has(key) || tieBetween(world, a.title, b.title)) continue;
      done.add(key);
      const c = compat(P, traits.get(a.title), traits.get(b.title));
      const kind = c >= 2 ? pick(rng, ['friend', 'friend', 'spouse', 'mentor']) : c >= 0 ? pick(rng, ['friend', 'rival', 'owes', 'sibling']) : pick(rng, ['rival', 'enemy', 'enemy']);
      const ev = { friend: 'friend', spouse: 'spouse', rival: 'rival', enemy: 'enemy', sibling: 'sibling', mentor: 'mentor', owes: 'owes' }[kind];
      const text = ev ? fill(pick(rng, list(E[ev])) || '', { a: a.title, b: b.title, place }) : `${a.title} ${tieInfo(P, kind).name} ${b.title}.`;
      out.push({ ...entry({ day: when(), kind: 'history', title: `${a.title} and ${b.title}`, text, people: [a.title, b.title], places: [place], tags: ['tie', kind], isPublic: kind === 'spouse' }, rng), apply: { type: 'tie', a: a.title, b: b.title, kind } });
    }
  }
  // What each faction set out to do, and whether it managed.
  const fs = list(ctx.factions);
  for (const f of fs) {
    for (let i = int(rng, 1, 2); i > 0; i--) {
      const g = newFactionGoal(F, f.kind, rng, { place: pick(rng, list(ctx.places))?.title || f.place, rivals: fs.filter(x => x !== f), goods: pick(rng, list(data.story?.goods)) });
      if (!g) continue;
      const won = chance(rng, 0.6);
      const win = fGoalInfo(F, g.key)?.win || {};
      const day = when();
      out.push({ ...entry({ day, kind: 'history', title: `${f.title} ${won ? 'gets its way' : 'is thwarted'}`, text: `${f.title} set out to ${fGoalText(F, g, f.title)}${won ? ', and did.' : ', and failed.'}`, factions: [f.title, ...(g.fill.rival && fs.some(x => x.title === g.fill.rival) ? [g.fill.rival] : [])], places: [g.fill.place], tags: ['faction', won ? 'won' : 'lost'], isPublic: true }, rng),
        apply: { type: 'faction', title: f.title, place: g.fill.place, influence: won ? win.influence || 10 : 0, power: won ? win.power || 0 : -5, rival: g.fill.rival, tie: won ? win.tie || null : 'rival' } });
    }
  }
  return out.sort((a, b) => a.day - b.day);
}

/** Keep the history entries the DM ticked: apply what each one does. Returns the records it touched, as they were. */
export function keepHistory(world, P, entries) {
  const before = { people: {}, factions: {} };
  const snap = (k, t) => { if (!(t in before[k])) before[k][t] = copy(world[k]?.[t] ?? null); };
  for (const e of list(entries)) {
    const a = e.apply;
    if (a?.type === 'traits') { snap('people', a.title); person(world, a.title).traits = [...a.traits]; }
    if (a?.type === 'tie') { snap('people', a.a); snap('people', a.b); setTie(world, P, a.a, a.b, a.kind, e.day); }
    if (a?.type === 'faction') {
      snap('factions', a.title);
      const r = factionRec(world, a.title);
      if (a.influence && a.place) r.influence[a.place] = clamp((r.influence[a.place] || 0) + a.influence);
      if (a.power) r.power = clamp(r.power + a.power);
      if (a.tie && a.rival && a.rival !== a.title) { snap('factions', a.rival); if (!fTieBetween(world, a.title, a.rival)) setFactionTie(world, a.title, a.rival, a.tie, e.day); }
    }
  }
  return before;
}
/** Put back what keepHistory changed. */
export function unkeepHistory(world, before) {
  for (const k of ['people', 'factions']) for (const [t, r] of Object.entries(before?.[k] || {})) {
    world[k] ||= {};
    if (r == null) delete world[k][t]; else world[k][t] = copy(r);
  }
  // Ties are kept both ways: drop the other side of any tie that no longer exists.
  for (const k of ['people', 'factions']) for (const [t, r] of Object.entries(world[k] || {})) r.ties = list(r.ties).filter(x => list(world[k]?.[x.to]?.ties).some(y => y.to === t));
}

/**
 * What trade goods cost at a place: for each good with a price, the price the party pays to buy and gets to sell,
 * after what the place makes and needs, its shortages and gluts, and extraPct (the party's standing there).
 */
export function tradePrices(data, eco, market = [], extraPct = 0) {
  const X = data.factions?.econ || {};
  const T = X.trade || {};
  const goods = [...new Set([...list(eco.makes), ...list(eco.needs), ...list(market).map(m => m.good), ...list(data.story?.goods)])].filter(g => X.prices?.[g]);
  return goods.map(good => {
    const [unit, base] = X.prices[good];
    const notes = [];
    let pct = extraPct;
    if (list(eco.makes).includes(good)) { pct += T.makes ?? -25; notes.push('made here'); }
    if (list(eco.needs).includes(good)) { pct += T.needs ?? 25; notes.push('bought in'); }
    for (const m of list(market).filter(x => x.good === good)) { pct += m.kind === 'short' ? T.short ?? 50 : T.plenty ?? -35; notes.push(m.kind === 'short' ? 'short' : 'plenty'); }
    const buy = Math.max(0.01, Math.round(base * (1 + pct / 100) * 100) / 100);
    const sell = Math.max(0.01, Math.round(buy * (1 - (T.spread ?? 20) / 100) * 100) / 100);
    return { good, unit, base, pct, buy, sell, notes, local: notes.length > 0 };
  }).sort((a, b) => (b.local - a.local) || a.good.localeCompare(b.good));
}


// ---------- deadlines and grudges ----------

/**
 * The world day a contract's deadline falls on, read from its words ("within 6 days", "by the end of the month",
 * "before the harvest festival"), counted from the day it was posted. null for "no deadline" or "open until filled".
 */
export function deadlineDay(cal, text, posted, rng = Math.random) {
  const t = String(text || '').toLowerCase();
  if (!t || /no deadline|open until filled/.test(t)) return null;
  if (/same day|urgent/.test(t)) return posted + 1;
  const n = t.match(/(\d+)\s*days?/);
  if (n) return posted + Number(n[1]);
  if (/as soon as possible/.test(t)) return posted + 10;
  if (/end of the month/.test(t)) { for (let d = posted; d < posted + 40; d++) { const x = dateOf(cal, d); if (!x.holy && x.day === (cal.monthDays || 30)) return d; } }
  if (/moon/.test(t)) return posted + int(rng, 5, 28);
  const festival = /harvest/.test(t) ? /harvest|sheaf|granary|orchard|reed|hunters/i : /fair/.test(t) ? /fair|market/i : null;
  if (festival) { const f = upcoming(cal, posted + 1, 360).find(e => festival.test(e.name)); if (f) return f.day; }
  if (/snow|winter/.test(t)) { for (let d = posted + 1; d < posted + 366; d++) if (/winter/i.test(dateOf(cal, d).season || '')) return d; }
  if (/flood/.test(t)) return posted + int(rng, 20, 60);
  return posted + int(rng, 14, 30);
}

/**
 * Someone the party has angered acts on it, once a month at most and no more often than the cooldown. holders:
 * [{ title, kind: 'person' | 'faction', value (opinion or standing), place, map, friends: [titles] }]. Each entry
 * comes with .plan: standing changes to make ({ kind, title, delta }) and .friendsPlan: opinions to move.
 * last: { [title]: day } of each holder's last act, updated.
 */
export function grudgeActs(data, holders, day, last, rng = Math.random) {
  const out = [];
  for (const h of list(holders)) {
    const G = (h.kind === 'faction' ? data.factions : data.people)?.grudges;
    if (!G || !(h.value <= (G.threshold ?? -25))) continue;
    if (Number.isFinite(last[h.title]) && day - last[h.title] < (G.cooldownDays ?? 60)) continue;
    // The angrier, the likelier.
    const p = (G.chancePerMonth ?? 0.3) * (1 + Math.max(0, -(h.value) - 25) / 50);
    if (!chance(rng, Math.min(0.9, p))) continue;
    const acts = list(G.acts).filter(a => h.value <= (a.min ?? -25) && (a.needs !== 'friends' || list(h.friends).length));
    const a = weighted(rng, acts, x => x.weight || 1);
    if (!a) continue;
    last[h.title] = day;
    const t = { person: h.title, faction: h.title, place: h.place || 'town', friends: list(h.friends).slice(0, 3).join(' and '), bounty: String(int(rng, 2, 8) * 25) };
    const e = entry({ day, kind: 'grudge', title: `${h.title}: ${a.name.toLowerCase()}`, text: fill(a.text, t), dm: fill(a.dm || '', t), places: h.place ? [h.place] : [], people: h.kind === 'person' ? [h.title] : [], factions: h.kind === 'faction' ? [h.title] : [], tags: ['grudge', a.key, ...(a.threat ? ['threat'] : [])], at: h.map || null, isPublic: !!a.public }, rng);
    e.grudge = { by: h.title, kind: h.kind, act: a.key };
    // What the players read in News: what's being said, not that it's a lie.
    if (a.public) e.news = fill(a.news || 'Talk about the party in {place}', t);
    e.plan = a.standing && h.place ? [{ kind: 'place', title: h.place, delta: a.standing }] : [];
    e.friendsPlan = a.friends ? list(h.friends).slice(0, 3).map(f => ({ title: f, delta: a.friends })) : [];
    out.push(e);
  }
  return out;
}
