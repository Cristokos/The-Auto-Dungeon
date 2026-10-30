// Generator tools: who lives where (the people mix for NPCs rolled at a place), the terrain a place stands in,
// the details that make an encounter more than a monster list, quick rolls for the table, treasure, and no-repeat
// decks for small tables. Content is in data/rolls.json. Pure logic: no DOM, so the same code runs in the app and in tests.
import { int, pick, chance, weighted, monsterInfo, monsterType, rankForCR, CR_XP, lootEssence, essenceLabel, stoneCatalog, itemCatalog, formatSpirit, essenceThemes, formatGp, formatCoins, contractTitle, deckDraw, aOrAn } from './generators.js';

const list = x => Array.isArray(x) ? x : [];
const plain = x => x && typeof x === 'object' && !Array.isArray(x);

// ---------- places ----------

/** Travel terrain names for a place page's `terrain` words ("delta", "hills"), in order, without repeats. */
export function placeTerrains(data, words) {
  const W = data.rolls?.terrainWords || {};
  const names = new Set(list(data.travel?.terrains).map(t => t.name));
  const out = [];
  for (const w of list(words)) {
    const k = String(w).toLowerCase().trim();
    const t = W[k] || [...names].find(n => n.toLowerCase() === k);
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/**
 * How much more or less likely each people is at a place: { Merfolk: 3, ... }.
 * ctx: { style, terrains (travel terrain names), own (the page's `peoples`, a map or a list of names) }.
 */
export function peopleMix(data, ctx = {}) {
  const P = data.rolls?.peopleMix;
  if (!P) return null;
  const mix = {};
  const times = m => { for (const [k, v] of Object.entries(m || {})) if (typeof v === 'number') mix[k] = (mix[k] ?? 1) * v; };
  times(P.styles?.[ctx.style]);
  const terr = list(ctx.terrains);
  for (const t of terr) times(P.terrain?.[t]);
  if (terr.length && !terr.some(t => ['Coast', 'Open sea', 'Delta and marsh'].includes(t))) times(P.inland);
  // A page's own list wins: names listed are common there (three times as likely).
  if (Array.isArray(ctx.own)) times(Object.fromEntries(ctx.own.map(n => [n, 3])));
  else if (plain(ctx.own)) times(ctx.own);
  return Object.keys(mix).length ? mix : null;
}

/** The peoples most likely at a place, for a hint under the form: "mostly Human, Merfolk and Elf". */
export function mixText(data, mix) {
  if (!mix) return '';
  const ps = list(data.peoples?.peoples).map(p => ({ name: p.name, w: (p.weight ?? 1) * (mix[p.name] ?? 1) })).sort((a, b) => b.w - a.w);
  const top = ps.slice(0, 3).map(p => p.name);
  return top.length ? `mostly ${top.slice(0, -1).join(', ')}${top.length > 1 ? ' and ' : ''}${top.at(-1)}` : '';
}

// ---------- encounters ----------

const RANK_DC = { Normal: 10, Iron: 12, Bronze: 14, Silver: 16, Gold: 18, Diamond: 20 };
export const ENCOUNTER_PARTS = ['nonFight', 'why', 'want', 'feature', 'tactics', 'morale', 'reinforce', 'exit'];
export const ENCOUNTER_PART_LABEL = { nonFight: 'Not a fight yet', why: 'Why here', want: 'What they want', feature: 'The ground', tactics: 'How they fight', morale: 'When they break', reinforce: 'Who else comes', exit: 'A way out without a fight' };

/** The lead monster's creature type ("beast", "undead"), or 'any'. */
function leadType(data, e) {
  const g = e.groups?.[0];
  const info = g && monsterInfo(data, g.base || g.name);
  const t = info ? monsterType(info) : '';
  // "swarm of tiny beasts" counts as a beast.
  const keys = Object.keys(data.rolls?.encounter?.wants || {});
  return keys.includes(t) ? t : keys.find(k => k !== 'any' && t.includes(k)) || 'any';
}

// Lines that only make sense for a group, or for creatures that can talk and think.
const GROUP_WORDS = /\b(the rest|leader|half their number|half strength|one of them|the others|fighting each other|biggest one|each one|all go|archers|outnumbered|in charge|mob|flank)\b/i;
const TALK_WORDS = /\b(talk|talks|bargain|trade|persuasion|surrender|tell what they know|hostage|told them|favour|language)\b/i;
/** Who's in the fight, for picking lines that suit it: how many, and whether they can think and talk. */
export function encounterCast(data, e) {
  const n = (e.groups || []).reduce((t, g) => t + (Number(g.count) || 1), 0);
  const ints = (e.groups || []).map(g => monsterInfo(data, g.base || g.name)).filter(Boolean).map(m => Number(m.abilities?.[3]) || 10);
  const int = ints.length ? Math.max(...ints) : 10;
  return { n, single: n <= 1, mindless: int <= 3, clever: int >= 6 };
}
const ADVERBS = new Set(['never', 'always', 'only', 'often', 'still', 'all', 'just']);
const MODAL = new Set(['will', "won't", 'can', "can't", 'may', 'might', 'must', 'should', 'would', 'could']);
const third = v => MODAL.has(v) ? v : v === "don't" ? "doesn't" : v === 'do' ? 'does' : v === 'are' ? 'is' : v === 'have' ? 'has' : v === 'were' ? 'was' : /(s|sh|ch|x|o)$/.test(v) ? `${v}es` : /[^aeiou]y$/.test(v) ? `${v.slice(0, -1)}ies` : `${v}s`;
/** A line written for a group, turned to suit one creature: "They never retreat" → "It never retreats". */
export function singular(line) {
  return String(line)
    .replace(/\b(T|t)hey((?: (?:never|always|only|often|still|just))?) ([\w']+)/g, (_, t, adv, v) => `${t === 'T' ? 'I' : 'i'}t${adv} ${ADVERBS.has(v) ? v : third(v)}`)
    // The second verb of the same subject: "It fights until hurt, then runs and tries again".
    .replace(/(\b(?:and|then|or)|,) (look|run|try|take|ignore|keep|offer|lose|switch|hold|stop|come|go|wait|fight)\b/g, (_, c, v) => `${c} ${third(v)}`)
    .replace(/\bthemselves\b/g, 'itself').replace(/\bthem\b/g, 'it').replace(/\b(T|t)heir\b/g, (_, t) => `${t === 'T' ? 'I' : 'i'}ts`)
    .replace(/\b(the )?(creatures|monsters) are\b/gi, (_, a, n) => `${a || ''}${n.slice(0, -1)} is`);
}
/** The lines from a list that suit the cast; all of them if none do. Groups prefer lines about "they", one creature lines about "it". */
export function suiting(lines, cast) {
  if (!cast) return lines;
  let ok = lines.filter(l => !(cast.single && GROUP_WORDS.test(l)) && !(!cast.clever && TALK_WORDS.test(l)));
  const sing = l => /^It\b/.test(l);
  // One creature takes "they" lines too (they're turned to "it"); a group avoids lines about "it".
  const pref = cast.single ? ok : ok.filter(l => !sing(l));
  if (pref.length) ok = pref;
  return ok.length ? ok : lines;
}

/** One detail of an encounter, rolled from data/rolls.json. */
function rollPart(data, e, part, ctx, rng) {
  const E = data.rolls?.encounter;
  if (!E) return null;
  const type = leadType(data, e), terr = ctx.terrain || e.terrain || '';
  const cast = encounterCast(data, e);
  const byType = t => [...list(t?.[type]), ...list(t?.any)];
  const byTerrain = t => [...list(t?.[terr]), ...list(t?.any)];
  const lead = e.groups?.[0]?.name || 'the creatures';
  const dc = RANK_DC[rankForCR(e.groups?.[0]?.cr ?? 0)] || 12;
  const fill = s => s && String(s).replace(/\{dc\}/g, dc).replace(/\{monster\}/g, lead);
  const one = l => l.length ? fill(cast.single ? singular(pick(rng, suiting(l, cast))) : pick(rng, suiting(l, cast))) : null;
  switch (part) {
    case 'nonFight': {
      const N = E.nonFight;
      if (!N || !(ctx.forceNonFight || chance(rng, N.chance ?? 0.2))) return null;
      const ks = list(N.kinds), fit = ks.filter(k => suiting([k.text], cast)[0] === k.text && (cast.clever || !TALK_WORDS.test(k.name + ' ' + k.text)));
      const k = pick(rng, fit.length ? fit : ks);
      return k ? { name: k.name, text: fill(k.text) } : null;
    }
    case 'why': return one(list(E.whyHere));
    case 'want': return one(byType(E.wants));
    case 'feature': return one(byTerrain(E.features));
    case 'tactics': return one(byType(E.tactics));
    case 'morale': return one(list(E.morale));
    case 'reinforce': {
      const R = list(E.reinforcements);
      const none = R.at(-1);
      return chance(rng, E.reinforceChance ?? 0.35) ? one(R.slice(0, -1)) : fill(none);
    }
    case 'exit': return one(list(E.exits));
  }
  return null;
}

/** What makes a fight more than a list: why they're here, what they want, the ground, tactics, morale, help, a way out. */
export function encounterDetails(data, e, ctx = {}, rng = Math.random) {
  if (!data.rolls?.encounter || !e?.groups?.length) return null;
  const d = { terrain: ctx.terrain || '' };
  for (const p of ENCOUNTER_PARTS) d[p] = rollPart(data, e, p, ctx, rng);
  return d;
}

/** Roll one detail again. 'nonFight' toggles between a fight and something else. */
export function rerollEncounterPart(data, e, part, rng = Math.random) {
  if (!e.details) return e;
  const ctx = { terrain: e.details.terrain, forceNonFight: part === 'nonFight' && !e.details.nonFight };
  const v = part === 'nonFight' && e.details.nonFight && chance(rng, 0.5) ? null : rollPart(data, e, part, ctx, rng);
  return { ...e, details: { ...e.details, [part]: v } };
}

/** The situation line for a terrain: its own first, then the general ones. */
export function situationFor(data, terrain, rng = Math.random, e = null) {
  const S = data.rolls?.encounter?.situations;
  const cast = e && encounterCast(data, e);
  const l = suiting([...list(S?.[terrain]), ...list(S?.any)], cast);
  const old = suiting(list(data.encounters?.situations), cast);
  const line = l.length ? pick(rng, l) : (old.length ? pick(rng, old) : '');
  if (!cast?.single || !/\b(the|these) (creatures|monsters)\b/i.test(line)) return line;
  return line.replace(/\b(T|t)hese (creatures|monsters) are\b/g, (_, t, n) => `${t}his ${n.slice(0, -1)} is`).replace(/\b(T|t)he (creatures|monsters) are\b/g, (_, t, n) => `${t}he ${n.slice(0, -1)} is`)
    .replace(/\b(T|t)he (creatures|monsters) (attack|nest|wait|watch|hunt|lurk|come|move|follow|have)\b/g, (_, t, n, v) => `${t}he ${n.slice(0, -1)} ${third(v)}`)
    .replace(/\b(T|t)he (creatures|monsters)\b/g, (_, t, n) => `${t}he ${n.slice(0, -1)}`).replace(/\btheir\b/g, 'its');
}

/** Themes for an encounter in this terrain (travel terrain, or Streets). */
export function terrainThemes(data, terrain) {
  if (terrain === data.rolls?.streets?.name) return list(data.rolls.streets.themes);
  return list(list(data.travel?.terrains).find(t => t.name === terrain)?.themes);
}

/** One group in a fight swapped for another monster of the same challenge (or close to it). */
export function swapGroup(e, i, candidates, rng = Math.random) {
  const g = e.groups[i];
  if (!g) return e;
  const near = candidates.filter(m => m.name !== g.name && m.cr === g.cr);
  const close = near.length ? near : candidates.filter(m => m.name !== g.name && Math.abs(m.cr - g.cr) <= Math.max(0.5, g.cr * 0.25));
  if (!close.length) return e;
  const m = pick(rng, close);
  const groups = [...e.groups];
  groups[i] = { name: m.name, count: g.count, cr: m.cr, xp: CR_XP[m.cr] ?? g.xp, rank: rankForCR(m.cr), stat: true };
  return spend({ ...e, groups });
}

/** Change how many of one group there are (none takes it out); the XP spent follows. */
export function setCount(e, i, n) {
  const groups = e.groups.map((g, k) => k === i ? { ...g, count: Math.max(0, Math.min(20, n)) } : g).filter(g => g.count > 0);
  return spend({ ...e, groups });
}
/** 2024 rules: a fight's XP is the plain sum of its creatures' XP. */
const spend = e => ({ ...e, spent: e.groups.reduce((t, g) => t + (g.xp || CR_XP[g.cr] || 0) * g.count, 0) });

// ---------- dice ----------

/** "4d6x50", "2d6", "1d3" or a plain number, rolled. */
export function rollDice(spec, rng = Math.random) {
  const m = String(spec ?? '0').trim().match(/^(\d+)(?:d(\d+))?(?:\s*[x×*]\s*(\d+))?$/i);
  if (!m) return 0;
  const n = Number(m[1]), sides = m[2] ? Number(m[2]) : 0, mult = m[3] ? Number(m[3]) : 1;
  let t = 0;
  if (!sides) t = n; else for (let i = 0; i < n; i++) t += int(rng, 1, sides);
  return t * mult;
}

// ---------- quick rolls ----------

export const QUICK_KINDS = [
  ['name', 'A name'], ['passer', 'A passer-by'], ['rumour', 'A rumour'], ['complication', 'A complication'],
  ['trinket', 'A trinket'], ['pockets', 'Their pockets'], ['loot', 'Some loot'], ['weather', 'Weather'],
  ['senses', 'A smell and a sound'], ['shop', 'A shop sign'],
];

const their = (s, pr) => String(s).replace(/\{their\}/g, { he: 'his', she: 'her', they: 'their' }[pr] || 'their')
  .replace(/\{they\}/g, pr || 'they').replace(/\{them\}/g, { he: 'him', she: 'her', they: 'them' }[pr] || 'them')
  .replace(/\{themself\}/g, { he: 'himself', she: 'herself', they: 'themself' }[pr] || 'themself');

/** A name from a people (by the place's mix): { name, people, first }. */
export function quickName(data, ctx = {}, rng = Math.random) {
  const P = list(data.peoples?.peoples).filter(p => list(p.names?.first).length);
  if (!P.length) return { name: 'Nobody', people: '' };
  const want = ctx.people && ctx.people !== 'any' ? P.find(p => p.name === ctx.people) : null;
  const p = want || weighted(rng, P, x => (x.weight ?? 1) * (ctx.mix?.[x.name] ?? 1));
  const avoid = ctx.avoid instanceof Set ? ctx.avoid : data.reservedNames instanceof Set && !ctx.avoid ? data.reservedNames : new Set(list(ctx.avoid).map(x => String(x).toLowerCase()));
  // A region's own names most of the time, like Vitesse humans (see generators.js nameLists).
  const r = ctx.style && p.regional?.[ctx.style];
  const names = r && list(r.first).length && chance(rng, p.regionalChance ?? 0.75) ? r : p.names;
  const free = list(names.first).filter(f => !avoid.has(f.toLowerCase()));
  const first = pick(rng, free.length ? free : names.first);
  let name = first;
  for (let i = 0; i < 12; i++) {
    name = first + (list(names.last).length && chance(rng, 0.8) ? ` ${pick(rng, names.last)}` : '');
    if (!avoid.has(name.toLowerCase())) break;
  }
  return { name, first, people: p.name };
}

/** One quick roll: { kind, text, name?, people? }. ctx: { mix, place, wiki: { npcs, locations, factions, churches }, rank, avoid, seen }. */
export function quickRoll(data, kind, ctx = {}, rng = Math.random) {
  const Q = data.rolls?.quick || {};
  const deck = (key, l) => ctx.seen ? drawFrom(l, ctx.seen, `quick:${key}`, rng) : pick(rng, l);
  const wiki = ctx.wiki || {};
  const place = () => ctx.place || (list(wiki.locations).length ? pick(rng, wiki.locations) : 'town');
  switch (kind) {
    case 'name': {
      const n = quickName(data, ctx, rng);
      return { kind, text: `${n.name} (${n.people})`, name: n.name, people: n.people };
    }
    case 'passer': {
      const n = quickName(data, ctx, rng);
      const pr = pick(rng, ['he', 'she', 'he', 'she', 'they']);
      const L = data.npc?.looks || {};
      const cloth = L.clothing ? pick(rng, list(L.clothing.any)) : '';
      const face = list(L.face).length ? pick(rng, L.face) : '';
      const mann = list(L.mannerism).length ? pick(rng, L.mannerism) : '';
      const doing = list(Q.doing).length ? deck('doing', Q.doing) : '';
      const bits = [face && `${face}`, cloth && `in ${cloth}`].filter(Boolean).join(', ');
      return { kind, name: n.name, people: n.people, text: their(`${n.name}, ${n.people.toLowerCase() === 'human' ? 'a human' : `${/^[aeiou]/i.test(n.people) ? 'an' : 'a'} ${n.people}`}${bits ? ` with ${bits}` : ''}, ${doing}${mann ? `, ${mann}` : ''}.`, pr) };
    }
    case 'rumour': {
      const l = [...list(data.tavern?.rumours), ...list(data.market?.rumours)];
      if (!l.length) return { kind, text: 'Nobody is talking.' };
      const fill = {
        place, npc: () => list(wiki.npcs).length ? pick(rng, wiki.npcs) : quickName(data, ctx, rng).name,
        faction: () => list(wiki.factions).length ? pick(rng, wiki.factions) : 'the Adventure Society',
        church: () => list(wiki.churches).length ? pick(rng, wiki.churches) : 'the Church of the Hearth',
        affinity: () => pick(rng, essenceThemes(data).length ? essenceThemes(data) : ['Fire']),
      };
      return { kind, text: String(deck('rumour', l)).replace(/\{(\w+)\}/g, (m, k) => fill[k] ? fill[k]() : m) };
    }
    case 'complication': return { kind, text: list(Q.complications).length ? deck('complication', Q.complications) : '' };
    case 'trinket': return { kind, text: `${cap(deck('trinket', list(Q.trinkets)))}.` };
    case 'pockets': return { kind, text: `In their pockets: ${deck('pockets', list(Q.pockets))}.` };
    case 'weather': {
      const W = list(data.travel?.weather).filter(w => !w.terrains || !ctx.terrain || w.terrains.includes(ctx.terrain));
      const w = W.length ? weighted(rng, W) : null;
      return { kind, text: w ? `${w.name}. ${w.text}` : 'Fair weather.' };
    }
    case 'senses': return { kind, text: `It smells of ${deck('smell', list(Q.smells))}. You hear ${deck('sound', list(Q.sounds))}.` };
    case 'shop': {
      const T = data.tavern?.names || {};
      const pat = list(Q.shops).length ? pick(rng, Q.shops) : 'The {adj} {noun}';
      const nouns = list(T.noun), adj = list(T.adj);
      let n1 = pick(rng, nouns), n2 = pick(rng, nouns);
      for (let i = 0; i < 5 && n2 === n1; i++) n2 = pick(rng, nouns);
      return { kind, text: pat.replace('{name}', quickName(data, ctx, rng).first).replace('{adj}', pick(rng, adj)).replace('{noun2}', n2).replace('{noun}', n1) };
    }
    case 'loot': {
      const t = treasure(data, { rank: ctx.rank || 'Iron', kind: 'individual' }, rng);
      return { kind, text: treasureLine(t), treasure: t };
    }
  }
  return { kind, text: '' };
}
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;

// ---------- treasure ----------

const RANKS = ['Normal', 'Iron', 'Bronze', 'Silver', 'Gold', 'Diamond'];

/**
 * Treasure for a rank: kind 'individual' (one creature's pockets) or 'hoard'. theme favours an affinity for essences and stones.
 * Returns { kind, rank, gp, finds: [{ kind: 'gem'|'item'|'stone'|'essence'|'core'|'trinket', name, value?, ... }] }.
 */
export function treasure(data, { rank = 'Iron', kind = 'hoard', theme = null } = {}, rng = Math.random) {
  const T = data.rolls?.treasure;
  rank = RANKS.includes(rank) ? rank : 'Iron';
  const out = { kind, rank, gp: 0, finds: [] };
  if (!T) return out;
  const gem = value => ({ kind: 'gem', name: pick(rng, list(T.gems?.[value]) .length ? T.gems[value] : ['a gem']), value: Number(value) });
  const trinket = () => ({ kind: 'trinket', name: pick(rng, list(data.rolls?.quick?.trinkets).length ? data.rolls.quick.trinkets : ['an odd little trinket']) });
  if (kind === 'individual') {
    const I = T.individual?.[rank] || {};
    out.gp = rollDice(I.coins, rng);
    if (chance(rng, I.trinket || 0)) out.finds.push(trinket());
    if (chance(rng, I.gem || 0)) { const vals = Object.keys(T.gems || {}).map(Number).filter(v => (T.hoard?.[rank]?.gems?.[1] || []).includes(v)); if (vals.length) out.finds.push(gem(pick(rng, vals))); }
    if (rank !== 'Normal' && chance(rng, I.core || 0)) out.finds.push({ kind: 'core', name: `${rank} monster core`, rank, count: 1 });
    return out;
  }
  const H = T.hoard?.[rank] || {};
  out.gp = rollDice(H.coins, rng);
  const [gn, gvals] = H.gems || ['0', []];
  for (let i = rollDice(gn, rng); i > 0; i--) if (list(gvals).length) out.finds.push(gem(pick(rng, gvals)));
  const [inum, rar, ich] = H.items || ['0', [], 0];
  if (chance(rng, ich ?? 1)) {
    const pool = itemCatalog(data).filter(x => list(rar).includes(x.rarity));
    const taken = new Set();
    for (let i = rollDice(inum, rng); i > 0 && pool.length; i--) {
      const it = pick(rng, pool.filter(x => !taken.has(x.name)).length ? pool.filter(x => !taken.has(x.name)) : pool);
      taken.add(it.name);
      out.finds.push({ kind: 'item', name: it.name, rarity: it.rarity, value: it.price || null, desc: it.desc || '' });
    }
  }
  const [cn, crank] = H.cores || ['0', rank];
  const cores = rollDice(cn, rng);
  if (cores) out.finds.push({ kind: 'core', name: `${crank} monster core${cores > 1 ? 's' : ''}`, rank: crank, count: cores });
  const [sn, slevel] = H.stones || ['0', 1];
  const stones = stoneCatalog(data).filter(x => x.level === slevel && !x.divine && (!theme || theme === 'any' || x.affinity === theme));
  const allStones = stones.length ? stones : stoneCatalog(data).filter(x => x.level === slevel && !x.divine);
  for (let i = rollDice(sn, rng); i > 0 && allStones.length; i--) {
    const st = pick(rng, allStones);
    out.finds.push({ kind: 'stone', name: st.name, affinity: st.affinity, spell: st.spell, level: st.level, value: st.price });
  }
  if (rank !== 'Normal' && chance(rng, H.essence || 0)) {
    const e = lootEssence(data, theme && theme !== 'any' ? theme : null, rank, rng, rank === 'Iron' ? ['common', 'uncommon'] : null);
    if (e) out.finds.push({ kind: 'essence', name: essenceLabel(e), essence: e.name });
  }
  if (chance(rng, T.trinketChance ?? 0.25)) out.finds.push(trinket());
  return out;
}

/** "23 iron spirit coins, a moonstone (50 gp) and a Bronze monster core." */
export function treasureLine(t) {
  const parts = [];
  if (t.gp) parts.push(`${formatSpirit(t.gp)} spirit coins`);
  for (const f of t.finds) parts.push(f.kind === 'gem' ? `${f.name} (${f.value.toLocaleString('en-US')} gp)` : f.kind === 'core' && f.count > 1 ? `${f.count} ${f.name}` : f.kind === 'core' ? `${/^[AEIOU]/.test(f.name) ? 'an' : 'a'} ${f.name}` : f.name);
  if (!parts.length) return 'Nothing worth taking.';
  return cap(parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0]) + '.';
}

// ---------- no-repeat decks ----------
// A small table draws like a deck: nothing comes up twice until most of it has, then the oldest half comes back.
// `seen` is { key: [lines in the order they came up] }, kept with the campaign by the caller.

/** Draw a line from a list without repeating recent ones. Records it in seen[key]. */
export function drawFrom(lines, seen, key, rng = Math.random) {
  const l = list(lines);
  if (!l.length) return '';
  return seen ? deckDraw(l, seen, key, rng) : pick(rng, l);
}

const CORE_GP = { Iron: 50, Bronze: 5000, Silver: 500000, Gold: 50000000, Diamond: 5000000000 };
/** What a treasure is worth in gp, roughly: coins, gems, items, stones and cores (essences aren't counted). */
export const treasureWorth = t => (t.gp || 0) + t.finds.reduce((s, f) => s + (f.kind === 'core' ? (CORE_GP[f.rank] || 0) * (f.count || 1) : Number(f.value) || 0), 0);

/** A treasure as Markdown. interactive adds + Party purse and Give to buttons; taken finds say who has them. */
export function treasureToMarkdown(t, { interactive = false } = {}) {
  const L = [];
  L.push(t.kind === 'hoard' ? `**${aOrAn(t.rank) === 'an' ? 'An' : 'A'} ${t.rank}-rank hoard**, worth about ${formatSpirit(treasureWorth(t))} spirit coins all told.` : `**What one ${t.rank}-rank creature carries.**`, '');
  const give = i => interactive && !t.finds[i].taken ? ` <button class="mini-reroll" data-tr-give="${i}" title="Give it to a party member">Give to…</button>` : '';
  const taken = f => f.taken ? ` *(${f.taken} has it)*` : '';
  if (t.gp) L.push(`- **Coins:** ${formatSpirit(t.gp)} spirit coins${t.coinsTaken ? ' *(in the party purse)*' : interactive ? ' <button class="mini-reroll" data-tr-purse title="Add the coins to the party purse">+ Party purse</button>' : ''}`);
  t.finds.forEach((f, i) => {
    const line = {
      gem: () => `${cap(f.name)} (${Number(f.value).toLocaleString('en-US')} gp)`,
      item: () => `**[[${f.name}]]** (${f.rarity}${f.value ? `, ${Number(f.value).toLocaleString('en-US')} gp` : ''})${f.desc ? `: ${f.desc.split('. ')[0].replace(/\.$/, '')}.` : ''}`,
      stone: () => `**${f.name}**, level ${f.level} (${Number(f.value).toLocaleString('en-US')} gp)`,
      essence: () => `**${f.name}**`,
      core: () => `${f.count > 1 ? f.count : /^[AEIOU]/.test(f.name) ? 'An' : 'A'} ${f.name}`,
      trinket: () => cap(f.name),
    }[f.kind]?.() || f.name;
    L.push(`- ${line}${taken(f)}${give(i)}`);
  });
  if (!t.gp && !t.finds.length) L.push('- Nothing worth taking.');
  return L.join('\n');
}

// ---------- printed handouts ----------
// Player-facing sheets to print and hand round: a notice board, wanted posters, a tavern's menu card, a market's
// price list and an NPC's portrait card. Only what players could see goes on them. The app saves them as a PDF.

const escH = t => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Wiki links and Markdown emphasis down to plain words. */
const plainText = t => String(t ?? '').replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1').replace(/\*\*?([^*]+)\*\*?/g, '$1').replace(/<[^>]+>/g, '');

function page(title, css, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escH(title)}</title><style>
body { font: 12pt Georgia, serif; color: #1b1712; margin: 0; }
h1 { font-size: 20pt; margin: 0 0 4mm; text-align: center; letter-spacing: .04em; }
.sub { text-align: center; font-style: italic; color: #5a5040; margin: 0 0 6mm; }
${css}</style></head><body>${body}</body></html>`;
}

/** The board as a sheet of notices; bounties are drawn as wanted posters on pages of their own. */
export function boardHandoutHTML(board, where = '') {
  const notices = board.contracts.filter(c => c.type !== 'bounty');
  const wanted = board.contracts.filter(c => c.type === 'bounty');
  const note = c => `<div class="note tier-${escH(c.tier.toLowerCase())}"><div class="tier">${escH(c.tier)} contract</div><h2>${escH(contractTitle(c))}</h2>
    <p>${escH(plainText(c.notice))}</p>
    ${c.requirement ? `<p><b>Requires:</b> ${escH(plainText(c.requirement))}</p>` : ''}
    <p><b>Reward:</b> ${escH(formatCoins(c.reward))}${c.bonus ? `, ${escH(plainText(c.bonus))}` : ''}</p>
    ${c.deadline ? `<p><b>Deadline:</b> ${escH(plainText(c.deadline))}</p>` : ''}
    ${c.proof ? `<p class="small"><b>Proof:</b> ${escH(plainText(c.proof))}</p>` : ''}
    <div class="seal">Adventure Society</div></div>`;
  const poster = c => `<div class="poster"><div class="big">WANTED</div><div class="what">${escH(plainText(c.monster?.name && c.showMonster ? c.monster.name : contractTitle(c).replace(/^Bounty:\s*/, '')))}</div>
    <p>${escH(plainText(c.notice))}</p><div class="reward">Reward ${escH(formatCoins(c.reward))}</div>
    <p class="small">${escH(plainText(c.proof || ''))}${c.deadline ? ` · ${escH(plainText(c.deadline))}` : ''}</p><div class="seal">Adventure Society${where ? `, ${escH(where)}` : ''}</div></div>`;
  return page(`${where || 'Contract'} board`, `
.board { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; }
.note { border: 1px solid #7a6a50; background: #f6efdc; padding: 5mm; break-inside: avoid; position: relative; }
.note h2 { font-size: 13pt; margin: 1mm 0 2mm; }
.note p { margin: 1.5mm 0; line-height: 1.35; }
.tier { font: 9pt sans-serif; text-transform: uppercase; letter-spacing: .08em; color: #7a6a50; }
.tier-bronze .tier { color: #8c5a2b; } .tier-silver .tier { color: #5d6b78; } .tier-gold .tier { color: #9a7a10; } .tier-diamond .tier { color: #3b7fa0; }
.small { font-size: 10pt; color: #4a4030; }
.seal { margin-top: 3mm; font: italic 9pt Georgia, serif; text-align: right; color: #7a6a50; }
.poster { break-before: page; border: 3px double #3a2e1e; padding: 12mm; text-align: center; background: #f3e9cf; }
.poster .big { font: bold 54pt Georgia, serif; letter-spacing: .12em; }
.poster .what { font-size: 24pt; margin: 4mm 0 8mm; }
.poster .reward { font-size: 20pt; font-weight: bold; margin: 8mm 0; }
.poster p { font-size: 13pt; line-height: 1.45; }`,
  `<h1>${escH(board.name || 'Contract Board')}</h1><p class="sub">${where ? `${escH(where)} · ` : ''}posted by the Adventure Society</p>
  ${notices.length ? `<div class="board">${notices.map(note).join('')}</div>` : ''}${wanted.map(poster).join('')}`);
}

/** A tavern's menu card: dishes and drinks with prices, the house special and the room rate. */
export function menuHandoutHTML(t) {
  const M = t.menu || {};
  const row = x => `<tr><td>${escH(x.name)}${x.note ? `<div class="note">${escH(x.note)}</div>` : ''}</td><td class="p">${escH(formatGp(x.price))}</td></tr>`;
  const courses = [['starter', 'To start'], ['main', 'Mains'], ['side', 'On the side'], ['sweet', 'Something sweet']];
  const food = list(M.food);
  return page(`${t.name} menu`, `
.card { max-width: 140mm; margin: 0 auto; border: 2px solid #3a2e1e; padding: 10mm 12mm; background: #f8f1e0; }
h2 { font: italic 13pt Georgia, serif; border-bottom: 1px solid #a89878; margin: 6mm 0 2mm; }
table { width: 100%; border-collapse: collapse; } td { padding: 1.4mm 0; vertical-align: top; } .p { text-align: right; white-space: nowrap; padding-left: 6mm; }
.note { font-size: 9.5pt; font-style: italic; color: #6a5a40; } .special { text-align: center; margin: 6mm 0 0; font-style: italic; }`,
  `<div class="card"><h1>${escH(t.name)}</h1><p class="sub">${escH(t.kindName || '')}</p>
  ${courses.map(([k, label]) => { const l = food.filter(x => (x.course || 'main') === k); return l.length ? `<h2>${label}</h2><table>${l.map(row).join('')}</table>` : ''; }).join('')}
  ${food.filter(x => !courses.some(([k]) => k === (x.course || 'main'))).length ? `<h2>Also</h2><table>${food.filter(x => !courses.some(([k]) => k === (x.course || 'main'))).map(row).join('')}</table>` : ''}
  ${list(M.drink).length ? `<h2>To drink</h2><table>${list(M.drink).map(row).join('')}</table>` : ''}
  ${M.special?.name ? `<p class="special">House special: <b>${escH(String(M.special.name).replace(/[.\s]+$/, ''))}</b>, ${escH(formatGp(M.special.price))}</p>` : ''}
  ${M.room ? `<p class="special">A bed for the night: ${escH(formatGp(M.room))}</p>` : ''}</div>`);
}

/** A market's price list, stall by stall. Fakes and DM notes stay off it. */
export function priceListHTML(m) {
  const price = g => g.magic ? `${formatSpirit(g.price)} spirit coins` : formatGp(g.price);
  return page(`${m.name} prices`, `
.stalls { columns: 2; column-gap: 8mm; } .stall { break-inside: avoid; margin: 0 0 6mm; border-top: 2px solid #3a2e1e; padding-top: 2mm; }
.stall h2 { font-size: 13pt; margin: 0 0 1mm; } .stall .who { font-size: 9.5pt; color: #6a5a40; margin: 0 0 2mm; }
table { width: 100%; border-collapse: collapse; font-size: 11pt; } td { padding: .8mm 0; } td.p { text-align: right; white-space: nowrap; padding-left: 4mm; }`,
  `<h1>${escH(m.name)}</h1><p class="sub">${escH(m.kindName || '')}${m.settlementLabel ? ` · ${escH(m.settlementLabel)}` : ''}</p>
  <div class="stalls">${list(m.stalls).map(st => `<div class="stall"><h2>${escH(st.name)}</h2><p class="who">${escH(st.type)}${st.keeper?.name ? `, kept by ${escH(st.keeper.name)}` : ''}</p>
    <table>${list(st.goods).map(g => `<tr><td>${escH(g.name)}</td><td class="p">${escH(price(g))}</td></tr>`).join('')}</table></div>`).join('')}</div>`);
}

/** An NPC's portrait card: name, people, how they look and what people say. Nothing hidden. */
export function npcCardHTML(n) {
  const shown = n.cover || n;
  return page(n.name, `
.card { max-width: 150mm; margin: 0 auto; border: 2px solid #3a2e1e; padding: 10mm; background: #f8f1e0; }
.frame { height: 70mm; border: 1px dashed #a89878; display: flex; align-items: center; justify-content: center; color: #a89878; font-style: italic; margin: 0 0 6mm; }
p { line-height: 1.45; } h2 { font: italic 13pt Georgia, serif; border-bottom: 1px solid #a89878; margin: 5mm 0 2mm; }`,
  `<div class="card"><div class="frame">portrait</div><h1>${escH(n.name)}</h1>
  <p class="sub">${escH(n.people)} · ${escH(shown.role)}${n.rank && n.rank !== 'Normal' ? ` · ${escH(n.rank)} rank` : ''}</p>
  <p>${escH(plainText(n.description || ''))}</p>
  ${list(n.rumours).length ? `<h2>What people say</h2>${list(n.rumours).map(r => `<p>${escH(plainText(r))}</p>`).join('')}` : ''}</div>`);
}

// ---------- list tables ----------
// The list editor's table view and "Never roll this" see a list as sections: every array of strings or of objects,
// however deep. An entry is known by its text, or an object by its name (else text, else the whole object).
// Switched-off entries are kept in rolls.json as off: { [list]: { [path]: [entry keys] } } and taken out on load,
// so the list file itself stays as it is and a reset or an update can't lose them.

const KEY_FIELDS = ['name', 'text', 'title', 'label', 'line'];
/** What an entry is known by. */
export const entryKey = x => typeof x === 'string' ? x : plain(x) ? String(KEY_FIELDS.map(k => x[k]).find(v => typeof v === 'string') ?? JSON.stringify(x)) : String(x);

/** Every section of a list: { path: ['kinds', 2, 'dishes'], label: 'kinds › Inn › dishes', kind: 'text'|'object', items }. */
export function listSections(json, path = [], label = [], out = []) {
  if (path.length > 6) return out;
  if (Array.isArray(json)) {
    const strs = json.length && json.every(x => typeof x === 'string');
    const objs = json.length && json.every(plain);
    if (strs || objs) out.push({ path, label: label.join(' › ') || '(top)', kind: strs ? 'text' : 'object', items: json });
    if (objs) json.forEach((x, i) => { for (const [k, v] of Object.entries(x)) if (typeof v === 'object' && v) listSections(v, [...path, i, k], [...label, entryKey(x).slice(0, 30), k], out); });
  } else if (plain(json)) {
    for (const [k, v] of Object.entries(json)) if (k !== 'version' && k[0] !== '_' && typeof v === 'object' && v) listSections(v, [...path, k], [...label, k], out);
  }
  return out;
}
const pathKey = path => path.join('.');
/** The array at a path, or null. */
export function atPath(json, path) {
  let x = json;
  for (const k of path) { if (x == null || typeof x !== 'object') return null; x = x[k]; }
  return Array.isArray(x) ? x : null;
}

/** The data with switched-off entries taken out (changes the arrays in place, and returns the data). */
export function applyOff(data, off) {
  for (const [name, paths] of Object.entries(off || {})) {
    const json = data[name];
    if (!json) continue;
    for (const [p, keys] of Object.entries(paths || {})) {
      const arr = atPath(json, p === '' ? [] : p.split('.').map(k => /^\d+$/.test(k) ? Number(k) : k));
      if (!arr || !keys?.length) continue;
      const kill = new Set(keys);
      const kept = arr.filter(x => !kill.has(entryKey(x)));
      if (kept.length && kept.length < arr.length) arr.splice(0, arr.length, ...kept); // never empty a table
    }
  }
  return data;
}
/** Switch an entry off (on = false) or back on. Returns the new off map. */
export function setOff(off, name, path, key, on) {
  const o = structuredClone(off || {});
  const p = pathKey(path);
  const keys = new Set(o[name]?.[p] || []);
  if (on) keys.delete(key); else keys.add(key);
  o[name] ||= {};
  if (keys.size) o[name][p] = [...keys]; else delete o[name][p];
  if (!Object.keys(o[name]).length) delete o[name];
  return o;
}

const norm = s => String(s).toLowerCase().replace(/[*_`[\]]/g, '').replace(/\s+/g, ' ').trim();
/**
 * The list entries a rolled line came from: text entries found word for word in it (templates with {slots} can't be
 * matched), and named objects whose name is in it. Longest first, so the most specific entry leads.
 */
export function entriesInLine(data, line, { min = 10 } = {}) {
  const L = norm(line);
  if (L.length < min) return [];
  const found = [];
  for (const [name, json] of Object.entries(data)) {
    if (!json || typeof json !== 'object') continue;
    for (const s of listSections(json)) {
      for (const x of s.items) {
        const k = entryKey(x);
        if (k.includes('{') || k.length < (s.kind === 'text' ? min : 6) || k.length > 400) continue;
        if (L.includes(norm(k))) found.push({ list: name, path: s.path, label: s.label, key: k, kind: s.kind });
      }
    }
  }
  const seen = new Set();
  return found.sort((a, b) => b.key.length - a.key.length).filter(f => { const id = `${f.list}|${pathKey(f.path)}|${f.key}`; return !seen.has(id) && seen.add(id); });
}
