// Pure generator logic: no DOM, no Electron. Every function takes the
// campaign's data lists (loaded from data/*.json) and an rng, so the same
// code runs in the app and in tests.

import { varyPuzzle } from './puzzles.js';

// ---------- dice and picking ----------

export function makeRng(seed) {
  if (seed === undefined || seed === null) return Math.random;
  // mulberry32
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const int = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
export const pick = (rng, list) => DECK && rng === Math.random && deckable(list) ? deckDraw(list, DECK, deckKey(list), rng) : list[Math.floor(rng() * list.length)];

// No-repeat decks for the small tables. While the app has set a deck (useDeck), a pick with Math.random from a short
// table of sentences (events, rumours, situations, notices) skips the lines it dealt lately. Seeded rolls, the tests
// and the story engine's replays are never affected.
let DECK = null;
export const useDeck = seen => { DECK = seen || null; };
const deckable = l => l.length >= 4 && l.length <= 150 && typeof l[0] === 'string' && l[0].length >= 25 && typeof l[l.length - 1] === 'string';
const deckKey = l => `t${l.length}:${l[0].slice(0, 40)}`;
// Lines are remembered by a short hash, so rolls.json stays small however many tables have decks.
const deckId = x => { const t = typeof x === 'string' ? x : JSON.stringify(x); let h = 2166136261; for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 16777619); return (h >>> 0).toString(36); };
/** One line from a table, skipping those in seen[key]. Once most of the table has come up, the older half goes back in. */
export function deckDraw(l, seen, key, rng = Math.random) {
  const used = (seen[key] ||= []);
  let fresh = l.filter(x => !used.includes(deckId(x)));
  if (!fresh.length || l.length - fresh.length >= Math.ceil(l.length * 0.8)) {
    used.splice(0, Math.ceil(used.length / 2));
    fresh = l.filter(x => !used.includes(deckId(x)));
    if (!fresh.length) fresh = l;
  }
  const x = fresh[Math.floor(rng() * fresh.length)];
  used.push(deckId(x));
  if (used.length > 150) used.splice(0, used.length - 150);
  return x;
}
export const chance = (rng, p) => rng() < p;

export function weighted(rng, list, w = x => x.weight ?? 1) {
  const total = list.reduce((s, x) => s + w(x), 0);
  let r = rng() * total;
  for (const x of list) { r -= w(x); if (r <= 0) return x; }
  return list[list.length - 1];
}

export function sample(rng, list, n) {
  const copy = [...list];
  const out = [];
  while (copy.length && out.length < n) out.push(copy.splice(Math.floor(rng() * copy.length), 1)[0]);
  return out;
}

export function roll(rng, count, sides) {
  let t = 0;
  for (let i = 0; i < count; i++) t += int(rng, 1, sides);
  return t;
}

// ---------- rules from the primers ----------

export const RANKS = ['Normal', 'Iron', 'Bronze', 'Silver', 'Gold', 'Diamond'];

export function rankForLevel(level) {
  if (level <= 1) return 'Normal';
  if (level <= 4) return 'Iron';
  if (level <= 10) return 'Bronze';
  if (level <= 16) return 'Silver';
  if (level <= 20) return 'Gold';
  return 'Diamond';
}

export const RANK_LEVELS = {
  Normal: [1, 1], Iron: [2, 4], Bronze: [5, 10], Silver: [11, 16], Gold: [17, 20], Diamond: [21, 24],
};

export function proficiencyBonus(level) {
  return 2 + Math.floor((Math.min(level, 20) - 1) / 4) + (level > 20 ? Math.floor((level - 17) / 4) : 0);
}

/** Essences held by level, per the DM primer's pacing table. */
/** Essences held at a level. Iron rank and up hold all three (and the confluence); a Normal-rank person holds none to two. */
export function essenceRange(level) {
  return level <= 1 ? [0, 2] : [3, 3];
}
/** How many essences someone of this level holds: with a roll, a Normal-rank person might have one or two. */
export function essenceCount(level, rng = null) {
  if (level > 1) return 3;
  if (!rng) return 0;
  const r = rng();
  return r < 0.6 ? 0 : r < 0.85 ? 1 : 2;
}

/** Highest awakening-stone spell level: half character level rounded up, max 5th. */
export function maxStoneSpellLevel(level) {
  return Math.min(5, Math.ceil(level / 2));
}

export function rankForCR(cr) {
  if (cr <= 4) return 'Iron';
  if (cr <= 10) return 'Bronze';
  if (cr <= 16) return 'Silver';
  if (cr <= 20) return 'Gold';
  return 'Diamond';
}

export const CR_XP = {
  0: 10, 0.125: 25, 0.25: 50, 0.5: 100, 1: 200, 2: 450, 3: 700, 4: 1100, 5: 1800, 6: 2300, 7: 2900, 8: 3900,
  9: 5000, 10: 5900, 11: 7200, 12: 8400, 13: 10000, 14: 11500, 15: 13000, 16: 15000, 17: 18000, 18: 20000,
  19: 22000, 20: 25000, 21: 33000, 22: 41000, 23: 50000, 24: 62000, 25: 75000, 26: 90000, 27: 105000,
  28: 120000, 29: 135000, 30: 155000,
};

export function crLabel(cr) {
  return cr === 0.125 ? '1/8' : cr === 0.25 ? '1/4' : cr === 0.5 ? '1/2' : String(cr);
}

// 2024 DMG XP budget per character: [low, moderate, high]
const XP_BUDGET = [
  null, [50, 75, 100], [100, 150, 200], [150, 225, 400], [250, 375, 500], [500, 750, 1100], [600, 1000, 1400],
  [750, 1300, 1700], [1000, 1700, 2100], [1300, 2000, 2600], [1600, 2300, 3100], [1900, 2900, 4100],
  [2200, 3700, 4700], [2600, 4200, 5400], [2900, 4900, 6200], [3300, 5400, 7800], [3800, 6100, 9800],
  [4500, 7200, 11700], [5000, 8700, 14200], [5500, 10700, 17200], [6400, 13200, 22000],
];
export const DIFFICULTIES = ['low', 'moderate', 'high'];

export function xpBudget(level, partySize, difficulty) {
  const row = XP_BUDGET[Math.max(1, Math.min(20, level))];
  return row[DIFFICULTIES.indexOf(difficulty)] * partySize;
}

// Not every slain monster leaves a usable core: the rest crack or crumble. The `market` list's prices.coreIntact sets the share.
export const coreIntactChance = data => { const v = Number(data?.market?.prices?.coreIntact); return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.5; };
/** How many of `n` cores come out whole. */
export const intactCores = (n, chance, rng = Math.random) => Array.from({ length: n }, () => rng() < chance).filter(Boolean).length;
const CORE_PRICE = { Iron: 50, Bronze: 5000, Silver: 500000, Gold: 50000000, Diamond: null };

/** Spirit coins by rank; each is worth 100 of the rank below. */
export const COIN_RANKS = ['iron', 'bronze', 'silver', 'gold', 'diamond'];
const COIN_VALUE = { iron: 1, bronze: 100, silver: 10000, gold: 1000000, diamond: 100000000 };
export const coinValue = k => COIN_VALUE[k];
/** "a" or "an" for a word: an Iron, a Bronze. */
export const aOrAn = w => /^[aeiou]/i.test(String(w)) ? 'an' : 'a';

/** A purse of spirit coins in gp. */
export const purseValue = coins => COIN_RANKS.reduce((t, k) => t + (Number(coins?.[k]) || 0) * COIN_VALUE[k], 0);

export function formatCoins(gp) {
  // Spirit coins: iron = 1 gp, bronze = 100 gp, silver = 10,000 gp, gold = 1,000,000 gp, diamond = 100,000,000 gp.
  const parts = [];
  let left = Math.round(gp);
  for (const k of [...COIN_RANKS].reverse()) {
    const n = Math.floor(left / COIN_VALUE[k]);
    left -= n * COIN_VALUE[k];
    if (n) parts.push(`${n.toLocaleString()} ${k}`);
  }
  if (!parts.length) parts.push('0 iron');
  return parts.join(', ') + ' spirit coins';
}

// ---------- NPCs ----------

const ABILITIES = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];

function abilityScores(rng, cls, level) {
  const rolls = Array.from({ length: 6 }, () => {
    const d = [int(rng, 1, 6), int(rng, 1, 6), int(rng, 1, 6), int(rng, 1, 6)].sort((a, b) => a - b);
    return d[1] + d[2] + d[3];
  }).sort((a, b) => b - a);
  const order = [...cls.primary, ...ABILITIES.filter(a => !cls.primary.includes(a)).sort(() => rng() - 0.5)];
  // CON tends to be the third-best score for anyone who adventures.
  const conIdx = order.indexOf('CON');
  if (conIdx > 2) { order.splice(conIdx, 1); order.splice(2, 0, 'CON'); }
  const rolled = {};
  order.forEach((ab, i) => { rolled[ab] = rolls[i]; });
  const scores = Object.fromEntries(ABILITIES.map(a => [a, rolled[a]]));
  // Ability score improvements at 4, 8, 12, 16, 19 go to the primary stat.
  const asis = [4, 8, 12, 16, 19].filter(l => level >= l).length;
  for (let i = 0; i < asis; i++) {
    const target = cls.primary.find(a => scores[a] < 20) || order.find(a => scores[a] < 20);
    if (target) scores[target] = Math.min(20, scores[target] + 2);
  }
  return scores;
}

const mod = s => Math.floor((s - 10) / 2);
const signed = n => (n >= 0 ? '+' : '') + n;

function pickRole(rng, data, wantRole) {
  if (wantRole && wantRole !== 'any') return data.npc.roles.find(r => r.name === wantRole) || weighted(rng, data.npc.roles);
  return weighted(rng, data.npc.roles);
}

function pickLevelForRank(rng, rank) {
  const [lo, hi] = RANK_LEVELS[rank];
  return int(rng, lo, hi);
}

/** A people for an NPC: the one asked for, or by weight, with `mix` scaling each people's weight for where they live. */
function pickPeople(rng, data, wantPeople, mix = null) {
  if (wantPeople && wantPeople !== 'any') return data.peoples.peoples.find(p => p.name === wantPeople);
  return weighted(rng, data.peoples.peoples, p => (p.weight ?? 1) * (mix?.[p.name] ?? 1));
}

/** A people's names, or (most of the time) their names in a region's style, like Vitesse humans. */
function nameLists(rng, people, style) {
  const r = style && people.regional?.[style];
  return r && list(r.first).length && chance(rng, people.regionalChance ?? 0.75) ? r : people.names;
}

function pickName(rng, people, data, style = '') {
  const names = nameLists(rng, people, style);
  const first = pick(rng, names.first);
  const last = names.last && names.last.length && chance(rng, 0.8) ? ' ' + pick(rng, names.last) : '';
  return first + last;
}

function pickEssences(rng, data, cls, count) {
  const all = data.essences.essences;
  const out = [];
  while (out.length < count) {
    const pool = all.filter(e => !out.includes(e));
    if (!pool.length) break;
    // Lean toward essences that suit the class, but leave room for odd combinations.
    const e = weighted(rng, pool, x => (cls.essences || []).includes(x.name) ? 4 : 1);
    out.push(e);
  }
  return out;
}

export function findConfluence(rng, data, essenceNames) {
  const key = [...essenceNames].sort().join('+');
  const combo = data.confluences.combos.find(c => [...c.essences].sort().join('+') === key);
  if (combo) return { name: combo.result, source: 'combination table' };
  // No exact match: prefer a confluence listed for any two of the three.
  const partial = data.confluences.combos.filter(c => c.essences.filter(e => essenceNames.includes(e)).length >= 2);
  if (partial.length && chance(rng, 0.6)) return { name: pick(rng, partial).result, source: 'close combination' };
  return { name: pick(rng, data.confluences.fallback), source: 'random suggestion' };
}

function pickStones(rng, essences, level, unpracticed) {
  if (!essences.length) return [];
  const pb = proficiencyBonus(level);
  const count = Math.max(1, int(rng, Math.ceil(pb / 2), pb));
  const cap = maxStoneSpellLevel(level);
  const stones = [];
  const used = new Set();
  for (let i = 0; i < count * 4 && stones.length < count; i++) {
    const e = pick(rng, essences);
    const lvl = int(rng, 1, cap);
    const spells = (e.stoneSpells && e.stoneSpells[lvl]) || [];
    if (!spells.length) continue;
    const spell = pick(rng, spells);
    if (used.has(spell)) continue;
    used.add(spell);
    stones.push({ essence: e.name, spell, level: lvl, note: unpracticed ? '−2 to attack and DC (core user)' : '' });
  }
  return stones.sort((a, b) => a.level - b.level);
}

function baseStatBlock(data, cls, level) {
  const list = data.npc.statBlocks[cls.style] || data.npc.statBlocks.martial;
  const target = Math.max(0.125, Math.round(level * 0.6));
  let best = list[0];
  for (const s of list) if (s.cr <= target && s.cr >= best.cr) best = s;
  return best;
}

// ---------- NPC generator ----------
// A full NPC: a stitched-together description, a backstory tied into the wiki, a DM-only
// roleplay primer, essences from the compendium, and a 5e-style stat block.

const PRONOUNS = {
  he: { their: 'his', them: 'him', themself: 'himself', noun: 'man' },
  she: { their: 'her', them: 'her', themself: 'herself', noun: 'woman' },
  they: { their: 'their', them: 'them', themself: 'themself', noun: 'person' },
};
const SKILL_ABILITY = {
  Acrobatics: 'DEX', 'Animal Handling': 'WIS', Arcana: 'INT', Athletics: 'STR', Deception: 'CHA', History: 'INT',
  Insight: 'WIS', Intimidation: 'CHA', Investigation: 'INT', Medicine: 'WIS', Nature: 'INT', Perception: 'WIS',
  Performance: 'CHA', Persuasion: 'CHA', Religion: 'INT', 'Sleight of Hand': 'DEX', Stealth: 'DEX', Survival: 'WIS',
};
const CLASS_SAVES = {
  Artificer: ['CON', 'INT'], Barbarian: ['STR', 'CON'], Bard: ['DEX', 'CHA'], Cleric: ['WIS', 'CHA'], Druid: ['INT', 'WIS'],
  Fighter: ['STR', 'CON'], Monk: ['STR', 'DEX'], Paladin: ['WIS', 'CHA'], Ranger: ['STR', 'DEX'], Rogue: ['DEX', 'INT'],
  Sorcerer: ['CON', 'CHA'], Warlock: ['WIS', 'CHA'], Wizard: ['INT', 'WIS'],
};
const CLASS_SKILLS = {
  Artificer: ['Arcana', 'Investigation'], Barbarian: ['Athletics', 'Survival', 'Intimidation'], Bard: ['Performance', 'Persuasion', 'Deception'],
  Cleric: ['Religion', 'Insight', 'Medicine'], Druid: ['Nature', 'Survival', 'Animal Handling'], Fighter: ['Athletics', 'Perception', 'Intimidation'],
  Monk: ['Acrobatics', 'Insight', 'Stealth'], Paladin: ['Athletics', 'Persuasion', 'Religion'], Ranger: ['Survival', 'Stealth', 'Perception'],
  Rogue: ['Stealth', 'Sleight of Hand', 'Deception', 'Perception'], Sorcerer: ['Arcana', 'Persuasion'], Warlock: ['Arcana', 'Deception'],
  Wizard: ['Arcana', 'History', 'Investigation'],
};
const ROLE_SKILLS = {
  Adventurer: ['Perception'], 'Adventure Society official': ['Insight', 'Persuasion'], 'Magic Society scholar': ['Arcana', 'History'],
  Crafter: ['Investigation'], Priest: ['Religion', 'Insight'], Noble: ['History', 'Persuasion'], Merchant: ['Persuasion', 'Insight'],
  'Guard or soldier': ['Perception', 'Athletics'], 'Street operator': ['Deception', 'Sleight of Hand'], 'City official': ['History', 'Insight'],
  'Cultist in disguise': ['Deception', 'Religion'], 'Wilderness guide': ['Survival', 'Nature'],
};
// Weapon, damage die, ability, kind ('melee' | 'ranged' | 'finesse'), range.
const CLASS_WEAPONS = {
  Barbarian: [['Greataxe', 'd12', 'STR', 'slashing']], Fighter: [['Longsword', 'd8', 'STR', 'slashing'], ['Heavy Crossbow', 'd10', 'DEX', 'piercing', '100/400 ft.']],
  Paladin: [['Longsword', 'd8', 'STR', 'slashing']], Ranger: [['Shortsword', 'd6', 'DEX', 'piercing'], ['Longbow', 'd8', 'DEX', 'piercing', '150/600 ft.']],
  Rogue: [['Rapier', 'd8', 'DEX', 'piercing'], ['Shortbow', 'd6', 'DEX', 'piercing', '80/320 ft.']], Monk: [['Unarmed Strike', 'martial', 'DEX', 'bludgeoning']],
  Cleric: [['Mace', 'd6', 'STR', 'bludgeoning']], Druid: [['Quarterstaff', 'd6', 'STR', 'bludgeoning']], Bard: [['Rapier', 'd8', 'DEX', 'piercing']],
  Artificer: [['Light Hammer', 'd4', 'STR', 'bludgeoning'], ['Light Crossbow', 'd8', 'DEX', 'piercing', '80/320 ft.']], Sorcerer: [['Dagger', 'd4', 'DEX', 'piercing']], Warlock: [['Dagger', 'd4', 'DEX', 'piercing']],
  Wizard: [['Dagger', 'd4', 'DEX', 'piercing']],
};
// Cantrip: name, die, 'attack' or a save ability, damage type, range.
const CLASS_CANTRIPS = {
  Wizard: ['Fire Bolt', 'd10', 'attack', 'fire', '120 ft.'], Sorcerer: ['Fire Bolt', 'd10', 'attack', 'fire', '120 ft.'],
  Artificer: ['Fire Bolt', 'd10', 'attack', 'fire', '120 ft.'], Warlock: ['Eldritch Blast', 'd10', 'attack', 'force', '120 ft.'],
  Cleric: ['Sacred Flame', 'd8', 'DEX', 'radiant', '60 ft.'], Druid: ['Produce Flame', 'd8', 'attack', 'fire', '30 ft.'],
  Bard: ['Vicious Mockery', 'd4', 'WIS', 'psychic', '60 ft.'],
};
const PEOPLE_STATS = {
  Elf: { darkvision: 60, language: 'Elvish' }, Goblin: { darkvision: 60, language: 'Goblin', size: 'Small' },
  Draconian: { language: 'Draconic' }, Smoulder: { darkvision: 60, language: 'Ignan' }, Celestine: { darkvision: 60, language: 'Celestial' },
  Merfolk: { darkvision: 60, language: 'Aquan', swim: 30 }, Leonid: {}, Runic: {}, Human: {},
};
const OUTWORLDER_STATS = { Dwarf: { darkvision: 60 }, Halfling: { size: 'Small' }, Gnome: { darkvision: 60, size: 'Small' }, Tiefling: { darkvision: 60 }, Orc: { darkvision: 60 } };
const GENERIC_PLACES = ['a hill village', 'a river town on the trade road', 'a fishing port', 'a mining camp in the hills', 'the capital', 'a farming hamlet'];
const GENERIC_FACTIONS = ['the Adventure Society', 'the Magic Society', 'a great house'];
const RARITY_WEIGHTS = {
  Normal: { common: 1, uncommon: 0, rare: 0, legendary: 0 }, Iron: { common: 70, uncommon: 24, rare: 5, legendary: 1 },
  Bronze: { common: 55, uncommon: 30, rare: 12, legendary: 3 }, Silver: { common: 40, uncommon: 33, rare: 20, legendary: 7 },
  Gold: { common: 30, uncommon: 32, rare: 25, legendary: 13 }, Diamond: { common: 25, uncommon: 30, rare: 28, legendary: 17 },
};
const XP = { 0: 10, 0.125: 25, 0.25: 50, 0.5: 100, 1: 200, 2: 450, 3: 700, 4: 1100, 5: 1800, 6: 2300, 7: 2900, 8: 3900, 9: 5000, 10: 5900, 11: 7200, 12: 8400, 13: 10000, 14: 11500, 15: 13000, 16: 15000, 17: 18000, 18: 20000, 19: 22000, 20: 25000, 21: 33000, 22: 41000, 23: 50000, 24: 62000 };

const list = x => Array.isArray(x) ? x : [];
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
/** "The Old City" as a link that reads "the Old City" mid-sentence. */
const linkTo = title => title.startsWith('The ') ? `[[${title}|the ${title.slice(4)}]]` : `[[${title}]]`;
const factionPhrase = title => /^(The|House) /.test(title) ? linkTo(title) : `the ${linkTo(title)}`;
/** Capitalises a sentence, including one that starts with a link. */
const article = w => `${/^[aeiou]/i.test(w) ? 'an' : 'a'} ${w}`;
/** Text finished off: a doubled "the" (a place whose name starts with The), a doubled full stop. */
const tidy = s => String(s)
  .replace(/\b(the) (\[\[[^\]|]*\|)the /gi, (m, t, l) => `${l}${t === 'The' ? 'The' : 'the'} `)
  .replace(/\b(the) the\b/gi, '$1')
  .replace(/(?<!\.)\.\.(?!\.)/g, '.');
const capSentence = s => tidy(s).replace(/^(\[\[[^\]|]+\|)the /, '$1The ').replace(/^[a-z]/, c => c.toUpperCase());

function fillNPC(text, ctx) {
  const p = PRONOUNS[ctx.pronoun];
  return text
    .replace(/\{(their|them|themself)\}/g, (m, k) => p[k])
    .replace(/\{(Their|Them|Themself)\}/g, (m, k) => cap(p[k.toLowerCase()]))
    .replace(/\{name\}/g, ctx.first)
    .replace(/\{place\}/g, () => ctx.place())
    .replace(/\{faction\}/g, () => ctx.faction())
    .replace(/\{npc\}/g, () => ctx.npc())
    .replace(/\{essence\}/g, () => ctx.essence())
    .replace(/\{cult\}/g, () => ctx.cult())
    .replace(/\{god\}/g, () => ctx.god ? ctx.god() : 'the gods');
}

// Looks for a player character, short enough for the PDF sheet's boxes.
const PC_AGES = { Human: [17, 38], Elf: [40, 160], Leonid: [17, 38], Runic: [18, 60], Celestine: [18, 40], Draconian: [18, 50], Smoulder: [18, 60], Goblin: [14, 30], Merfolk: [18, 60] };
const PC_HEIGHTS = { Human: [60, 75], Elf: [62, 76], Leonid: [68, 84], Runic: [58, 74], Celestine: [62, 76], Draconian: [66, 80], Smoulder: [60, 78], Goblin: [40, 50], Merfolk: [60, 74] };
const PC_EYES = ['brown', 'dark brown', 'hazel', 'green', 'grey', 'blue', 'pale blue', 'amber', 'black', 'grey-green', 'one blue, one brown', 'violet'];
const PC_SKIN = ['pale', 'fair and freckled', 'olive', 'tan', 'sun-browned', 'golden brown', 'brown', 'deep brown', 'dark', 'ruddy', 'weathered'];
const PC_SKIN_BY = { Leonid: ['tawny fur', 'golden fur', 'dark brown fur', 'sandy fur'], Draconian: ['bronze scales', 'red scales', 'green scales', 'black scales', 'blue scales'], Goblin: ['green', 'grey-green', 'olive green'] };
const PC_HAIR = ['short black', 'long black', 'cropped brown', 'shaggy brown', 'braided auburn', 'curly red', 'straight blond', 'tousled sandy', 'long silver', 'close-shaved', 'grey at the temples', 'wild dark curls', 'tied-back chestnut', 'white-blond'];
const PC_IDEALS = ['Freedom. No one should be owned, by a master or by a debt.', 'Rank. Power is earned, and earned power deserves respect.', 'Protection. The strong exist to shield the weak.', 'Knowledge. Every mystery can be understood by someone patient enough.', 'Family. Blood and chosen kin come before everything else.', 'Glory. A name worth remembering is worth any risk.', 'Fairness. A deal is a deal, for prince and beggar alike.', 'Faith. The gods are real, and they are watching.', 'Self-reliance. Never owe anyone anything you can\'t repay.', 'Wonder. The world is stranger and bigger than anyone admits.', 'Duty. A promise is kept, even when it costs.', 'Change. The way things are is not the way they must stay.', 'Mercy. Everyone deserves a second chance; some deserve a third.', 'Wealth. Spirit coins buy safety, and safety buys everything else.'];

/**
 * Roll one looks or personality field for a party member's sheet: age, height, eyes, skin, hair, appearance,
 * personality, ideals, bonds or flaws. ctx.species picks fitting ages, heights and skin; ctx.place() and ctx.npc()
 * fill bonds from the wiki.
 */
export function rollPcLook(data, field, ctx = {}, rng = Math.random) {
  const L = data.npc?.looks || {}, persona = data.npc?.persona || {};
  const species = ctx.species in PC_AGES ? ctx.species : 'Human';
  const fill = t => fillNPC(t, { pronoun: 'they', first: ctx.name || 'they', place: ctx.place || (() => 'Greenstone'), faction: ctx.faction || (() => 'the Adventure Society'), npc: ctx.npc || (() => 'an old friend'), essence: () => 'an essence', cult: () => 'a cult' });
  switch (field) {
    case 'age': { const [lo, hi] = PC_AGES[species]; return String(int(rng, lo, hi)); }
    case 'height': { const [lo, hi] = PC_HEIGHTS[species]; const h = int(rng, lo, hi); return `${Math.floor(h / 12)} ft ${h % 12} in`; }
    case 'eyes': return pick(rng, PC_EYES);
    case 'skin': return pick(rng, PC_SKIN_BY[species] && chance(rng, 0.8) ? PC_SKIN_BY[species] : PC_SKIN);
    case 'hair': return pick(rng, PC_HAIR);
    case 'appearance': {
      const bits = [list(L.build).length ? `${cap(pick(rng, L.build))}, with ${pick(rng, list(L.face))} and ${pick(rng, list(L.hair))}.` : '', list(L.marks).length ? pick(rng, L.marks) : ''];
      return fill(bits.filter(Boolean).join(' '));
    }
    case 'personality': { const [a, b] = sample(rng, list(data.npc?.personality), 2); return [a, b].filter(Boolean).join(' '); }
    case 'ideals': return pick(rng, PC_IDEALS);
    case 'bonds': return fill(cap(pick(rng, list(persona.bonds)) || '')).replace(/([^.!?])$/, '$1.');
    case 'flaws': return fill(cap(pick(rng, list(persona.flaws)) || '')).replace(/([^.!?])$/, '$1.');
    default: return '';
  }
}
export const PC_LOOK_ROLLS = ['age', 'height', 'eyes', 'skin', 'hair', 'appearance', 'personality', 'ideals', 'bonds', 'flaws'];

/** Splits "Proficiency in Athletics or with smith's tools." into its options. */
export function proficiencyOptions(text) {
  const body = text.replace(/^Proficiency\s+/i, '').replace(/\.$/, '');
  return body.split(/,?\s+or\s+/).map(s => s.replace(/^(in|with)\s+/, '').trim()).filter(Boolean);
}

export function findCompendiumConfluence(comp, essences) {
  const key = essences.map(e => e.name).sort().join('+');
  // A confluence's own recipes count too, so one added in a later version works without its row in the recipe table.
  const combo = comp.combos.find(c => [...c.essences].sort().join('+') === key)
    || comp.confluences.flatMap(c => (c.recipes || []).map(r => ({ essences: r, result: c.name }))).find(c => [...c.essences].sort().join('+') === key);
  const name = combo ? combo.result : comp.trios[essences.map(e => e.affinity).sort().join('+')];
  const c = comp.confluences.find(x => x.name === name);
  return c ? { ...c, how: combo ? 'exact recipe' : 'affinity trio' } : null;
}

function pickCompendiumEssences(rng, comp, cls, rank, count) {
  const fav = cls.essences || [];
  const rw = RARITY_WEIGHTS[rank] || RARITY_WEIGHTS.Bronze;
  const out = [];
  while (out.length < count) {
    const pool = comp.essences.filter(e => !out.includes(e) && (rw[e.rarity] ?? 1) > 0);
    if (!pool.length) break;
    out.push(weighted(rng, pool, e => (rw[e.rarity] ?? 1) * (fav.includes(e.affinity) ? 3 : 1)));
  }
  return out;
}

function compendiumStones(rng, comp, essences, level, unpracticed) {
  if (!essences.length) return [];
  const pb = proficiencyBonus(level);
  const count = Math.max(1, int(rng, Math.ceil(pb / 2), pb));
  const top = maxStoneSpellLevel(level);
  const stones = [];
  for (let i = 0; i < count * 6 && stones.length < count; i++) {
    const e = pick(rng, essences);
    const lvl = int(rng, 1, top);
    const spells = (e.stoneSpells || comp.affinities[e.affinity]?.stoneSpells)?.[lvl] || [];
    const spell = spells.length ? pick(rng, spells) : null;
    if (!spell || stones.some(s => s.spell === spell)) continue;
    stones.push({ essence: e.name, spell, level: lvl, note: unpracticed ? '−2 to attack and DC (core user)' : '' });
  }
  return stones.sort((a, b) => a.level - b.level || a.spell.localeCompare(b.spell));
}

const dieCount = level => level >= 17 ? 4 : level >= 11 ? 3 : level >= 5 ? 2 : 1;
const avg = (n, die, bonus = 0) => Math.max(1, Math.floor(n * (Number(die.slice(1)) + 1) / 2) + bonus);
const dice = (n, die, bonus = 0) => `${avg(n, die, bonus)} (${n}${die}${bonus ? (bonus > 0 ? ' + ' : ' − ') + Math.abs(bonus) : ''})`;
const martialDie = level => level >= 17 ? 'd10' : level >= 11 ? 'd8' : level >= 5 ? 'd6' : 'd4';

function crFor(level) {
  if (level <= 1) return 0.125;
  if (level === 2) return 0.5;
  if (level === 3) return 1;
  return Math.min(24, Math.max(1, Math.round(level * 0.65)));
}

function statBlock(rng, n, cls, scores, peopleKey, outworlderKind, role, essenceSkills, otherProfs) {
  const level = n.level;
  const pb = proficiencyBonus(level);
  const m = a => mod(scores[a]);
  const ps = { ...(PEOPLE_STATS[peopleKey] || {}), ...(outworlderKind ? OUTWORLDER_STATS[outworlderKind] || {} : {}) };
  const hitDie = cls.hitDie;
  const conMod = m('CON');
  const hp = Math.max(1, hitDie + conMod + (level - 1) * (Math.floor(hitDie / 2) + 1 + conMod));
  const dexMod = m('DEX');
  let ac, armor;
  if (cls.armor === 'heavy') { ac = 16 + Math.min(2, Math.floor(level / 5)); armor = { 16: 'chain mail', 17: 'splint', 18: 'plate' }[ac]; }
  else if (cls.armor === 'medium') { ac = 14 + Math.min(2, dexMod); armor = level >= 8 ? 'half plate' : 'scale mail'; if (level >= 8) ac += 1; }
  else if (cls.armor === 'light') { ac = 12 + dexMod; armor = 'studded leather'; }
  else if (cls.name === 'Monk') { ac = 10 + dexMod + m('WIS'); armor = 'unarmored defense'; }
  else { ac = 10 + dexMod; armor = null; }
  let speed = 30 + (cls.name === 'Monk' && level >= 2 ? [10, 15, 20, 25, 30][Math.min(4, Math.floor((level - 2) / 4))] : 0);
  const saves = (CLASS_SAVES[cls.name] || []).map(a => `${cap(a.toLowerCase())} ${signed(m(a) + pb)}`);
  const skills = [...new Set([...sample(rng, CLASS_SKILLS[cls.name] || [], 2), ...(ROLE_SKILLS[role] || []), ...essenceSkills])]
    .filter(s => SKILL_ABILITY[s]).sort();
  const skillText = skills.map(s => `${s} ${signed(m(SKILL_ABILITY[s]) + pb)}`);
  const passive = 10 + m('WIS') + (skills.includes('Perception') ? pb : 0);
  const senses = [ps.darkvision ? `darkvision ${ps.darkvision} ft.` : null, `passive Perception ${passive}`].filter(Boolean);
  const languages = ['Common', ps.language, outworlderKind ? 'one language from their home world' : null].filter(Boolean);

  const traits = [];
  const divineDC = 8 + pb + Math.max(m('INT'), m('WIS'), m('CHA'));
  const withDC = t => t.replace(/your stone spell DC/g, `DC ${divineDC}`);
  for (const e of n.essences) if (e.grant.type === 'quirk') traits.push({ name: `${e.grant.name} (${e.name} essence)`, text: e.grant.text });
  for (const e of n.essences.filter(x => x.divine)) {
    traits.push({ name: `${e.sense.name} (${1 + Math.max(0, m('WIS')) || 1}/long rest, divine)`, text: withDC(e.sense.text) });
    traits.push({ name: `${e.channel.name} (${pb}/long rest, divine)`, text: withDC(e.channel.text) });
    if (level >= 5) traits.push({ name: `${e.aura.name} (divine, ${level >= 17 ? '2' : '1'}/Short Rest)`, text: withDC(e.aura.text) });
  }
  if (n.confluence?.grant?.type === 'quirk') traits.push({ name: `${n.confluence.grant.name} (${n.confluence.name} confluence)`, text: withDC(n.confluence.grant.text) });
  const feat = (name, text, min = 1) => { if (level >= min) traits.push({ name, text }); };
  const c = cls.name;
  if (c === 'Barbarian') { feat('Rage', `As a bonus action, ${Math.min(6, 2 + Math.floor(level / 3))} times per long rest: for 1 minute, advantage on Strength checks and saves, +${level >= 16 ? 4 : level >= 9 ? 3 : 2} to melee damage, and resistance to bludgeoning, piercing and slashing damage.`); feat('Reckless Attack', 'Can attack with advantage on its turn; attacks against it have advantage until its next turn.', 2); }
  if (c === 'Fighter') { feat('Second Wind', `Once per short rest, as a bonus action, regains ${dice(1, 'd10', level)} hit points.`); feat('Action Surge', 'Once per short rest, takes one additional action on its turn.', 2); }
  if (c === 'Paladin') { feat('Lay on Hands', `A pool of ${5 * level} hit points of healing, restored on a long rest.`); feat('Divine Smite', `When it hits with a melee weapon, it can spend an awakening stone use to deal an extra ${dice(2, 'd8')} radiant damage.`, 2); }
  if (c === 'Rogue') { feat('Sneak Attack', `Once per turn, deals an extra ${dice(Math.ceil(level / 2), 'd6')} damage when it hits with advantage, or when an ally is within 5 feet of the target.`); feat('Cunning Action', 'Can Dash, Disengage or Hide as a bonus action.', 2); }
  if (c === 'Monk') { feat('Martial Arts', 'Can make one unarmed strike as a bonus action after attacking.'); feat('Ki', `${level} ki points per short rest; 1 ki for Flurry of Blows (two unarmed strikes as a bonus action), Patient Defense or Step of the Wind.`, 2); }
  if (c === 'Ranger') feat("Hunter's Mark", `${Math.max(1, m('WIS'))} times per long rest, as a bonus action: marks a creature for 1 hour and deals an extra ${dice(1, 'd6')} damage to it on each hit.`);
  if (c === 'Bard') feat('Bardic Inspiration', `${Math.max(1, m('CHA'))} times per long rest, as a bonus action: an ally within 60 feet gains a d${level >= 15 ? 12 : level >= 10 ? 10 : level >= 5 ? 8 : 6} to add to one roll.`);
  if (c === 'Cleric') feat('Turn Undead', `Once per short rest: each undead within 30 feet must make a DC ${8 + pb + m('WIS')} Wisdom save or flee for 1 minute.`, 2);
  if (c === 'Druid') feat('Wild Shape', `Twice per short rest, becomes a beast of CR ${level >= 8 ? 1 : level >= 4 ? '1/2' : '1/4'} or lower for up to ${Math.max(1, Math.floor(level / 2))} hours.`, 2);
  if (c === 'Sorcerer') feat('Sorcery Points', `${level} points per long rest, spent to twin, quicken or extend its magic.`, 2);
  if (c === 'Warlock') feat('Hex', `Once per short rest, as a bonus action: curses a creature for 1 hour, dealing an extra ${dice(1, 'd6')} necrotic damage on each hit.`);
  if (c === 'Wizard') feat('Arcane Recovery', 'Once per day after a short rest, regains the use of one spent awakening stone of 3rd level or lower.');
  if (c === 'Artificer') feat('Flash of Genius', `${Math.max(1, m('INT'))} times per long rest, as a reaction, adds +${Math.max(1, m('INT'))} to an ally's check or save within 30 feet.`, 7);

  const actions = [];
  const attacks = ['martial', 'skirmisher'].includes(cls.style) && c !== 'Rogue' && c !== 'Monk' ? (c === 'Fighter' ? (level >= 20 ? 4 : level >= 11 ? 3 : level >= 5 ? 2 : 1) : level >= 5 ? 2 : 1) : 1;
  const weapons = CLASS_WEAPONS[c] || [['Club', 'd4', 'STR', 'bludgeoning']];
  if (attacks > 1) actions.push({ name: 'Multiattack', text: `Makes ${['', 'one', 'two', 'three', 'four'][attacks]} ${weapons[0][0].toLowerCase()} attacks${weapons[1] ? ` or ${['', 'one', 'two', 'three', 'four'][attacks]} ${weapons[1][0].toLowerCase()} attacks` : ''}.` });
  if (c === 'Monk' && level >= 5) actions.push({ name: 'Multiattack', text: 'Makes two unarmed strikes.' });
  for (const [name, die0, ab, type, range] of weapons) {
    const die = die0 === 'martial' ? martialDie(level) : die0;
    // Finesse weapons and unarmed strikes use the better of Strength and Dexterity.
    const bonus = /Dagger|Rapier|Shortsword|Unarmed/.test(name) ? Math.max(m('STR'), m('DEX')) : m(ab);
    const kind = range ? `*Ranged Weapon Attack:* ${signed(bonus + pb)} to hit, range ${range}, one target.` : `*Melee Weapon Attack:* ${signed(bonus + pb)} to hit, reach 5 ft., one target.`;
    actions.push({ name, text: `${kind} *Hit:* ${dice(1, die, bonus)} ${type} damage.` });
  }
  const cantrip = CLASS_CANTRIPS[c];
  const castAb = cls.castingAbility || cls.primary[0];
  const dc = 8 + pb + m(castAb);
  if (cantrip) {
    const [cname, die, how, type, range] = cantrip;
    const count = dieCount(level);
    const text = c === 'Warlock'
      ? `*Ranged Spell Attack:* ${signed(m(castAb) + pb)} to hit, range ${range}, ${count > 1 ? `${count} beams at one or more targets` : 'one target'}. *Hit:* ${dice(1, die)} ${type} damage per beam.`
      : how === 'attack'
        ? `*Ranged Spell Attack:* ${signed(m(castAb) + pb)} to hit, range ${range}, one target. *Hit:* ${dice(count, die)} ${type} damage.`
        : `One creature within ${range} must succeed on a DC ${dc} ${{ DEX: 'Dexterity', WIS: 'Wisdom' }[how]} save or take ${dice(count, die)} ${type} damage.`;
    actions.push({ name: `${cname} (Cantrip)`, text });
  }
  const cr = crFor(level);
  return {
    size: ps.size || 'Medium', ac, armor, hp, hpDice: `${level}d${hitDie} ${conMod * level >= 0 ? '+' : '−'} ${Math.abs(conMod * level)}`,
    speed: `${speed} ft.${ps.swim ? `, swim ${ps.swim} ft.` : ''}`, scores, saves, skills: skillText, otherProfs, senses, languages,
    cr, xp: XP[cr] ?? 0, pb, traits, actions, stoneDC: dc, stoneAttack: signed(m(castAb) + pb), castAbility: castAb,
  };
}

/** Builds the NPC. opts: role, rank, people, class, level, and wiki: { npcs, locations, factions } page titles. */
export function generateNPC(data, opts = {}, rng = Math.random) {
  const role = pickRole(rng, data, opts.role);
  let rank = opts.rank && opts.rank !== 'any' ? opts.rank : weighted(rng, data.npc.rankWeights).rank;
  if (role.maxRank && RANKS.indexOf(rank) > RANKS.indexOf(role.maxRank) && (!opts.rank || opts.rank === 'any')) rank = role.maxRank;
  let level = opts.level ? Number(opts.level) : pickLevelForRank(rng, rank);
  rank = rankForLevel(level);

  // A hidden truth that only shows in DM mode. Disguised cultists always have one.
  const twists = list(data.npc.twists);
  let twistDef = null;
  if (role.name === 'Cultist in disguise') twistDef = twists.find(t => t.name === 'Secret cultist') || null;
  else if (opts.twist && opts.twist !== 'any' && opts.twist !== 'none') twistDef = twists.find(t => t.name === opts.twist) || null;
  else if (opts.twist !== 'none' && twists.length && chance(rng, data.npc.twistChance ?? 0.15)) twistDef = weighted(rng, twists);

  // A hidden outworlder passes as a local human.
  if (twistDef?.name === 'Hidden outworlder') opts = { ...opts, people: 'Human' };
  const outworlder = opts.people === 'Outworlder' || ((!opts.people || opts.people === 'any') && chance(rng, data.peoples.outworlderChance));
  let people, speciesLabel, peopleKey, outworlderKind = null;
  if (outworlder) {
    outworlderKind = pick(rng, data.peoples.outworlderSpecies);
    people = { ...pick(rng, data.peoples.peoples), names: data.peoples.outworlderNames };
    speciesLabel = `${outworlderKind} outworlder`;
    peopleKey = 'Human';
  } else {
    people = pickPeople(rng, data, opts.people, opts.peopleMix);
    speciesLabel = people.name;
    peopleKey = people.name;
  }
  const classPool = role.classes && role.classes.length ? data.classes.classes.filter(c => role.classes.includes(c.name)) : data.classes.classes;
  const cls = opts.class && opts.class !== 'any' ? data.classes.classes.find(c => c.name === opts.class) : pick(rng, classPool.length ? classPool : data.classes.classes);
  const coreAllowed = level >= 2 && level <= 16;
  const corePath = coreAllowed && chance(rng, role.corePathChance ?? 0.2);
  const coreLevels = corePath ? Math.min(level - 1, int(rng, 1, Math.min(6, level - 1))) : 0;
  const roleFactions = (role.factions || []).filter(f => f !== 'None');

  const n = {
    kind: 'npc', name: '', pronoun: weighted(rng, [{ k: 'he', weight: 45 }, { k: 'she', weight: 45 }, { k: 'they', weight: 10 }]).k,
    role: role.name, faction: roleFactions.length ? pick(rng, roleFactions) : 'None', people: speciesLabel, peopleKey, outworlderKind,
    species: outworlder ? outworlderKind : people.species, outworlder, namesFrom: outworlder ? 'outworlder' : people.name,
    class: cls.name, level, rank,
    age: weighted(rng, [{ k: 'young', weight: 25 }, { k: 'adult', weight: 35 }, { k: 'middle', weight: 25 }, { k: 'old', weight: 15 }]).k,
    path: corePath ? `Core user (${coreLevels} level${coreLevels > 1 ? 's' : ''} from cores)` : (level >= 2 ? 'Adventurer (natural path)' : 'Normal, no essences yet'),
    corePath, scores: abilityScores(rng, cls, level), essences: [],
    ...(opts.style ? { style: opts.style } : {}),
  };
  // A priest serves one particular church when the wiki has them.
  const churches = list(opts.wiki?.churches);
  const toChurch = f => (f === 'The Churches' || /^Church of /.test(f)) && churches.length ? pick(rng, churches) : f;
  n.faction = toChurch(n.faction);
  n.name = newNPCName(data, n, opts, rng);
  // A cultist shows the world a cover role; the truth goes in the DM notes.
  if (role.name === 'Cultist in disguise') {
    const coverRole = pick(rng, data.npc.roles.filter(r => ['Merchant', 'Crafter', 'Priest', 'City official', 'Adventure Society official'].includes(r.name)));
    n.cover = coverRole ? { role: coverRole.name, faction: toChurch(pick(rng, (coverRole.factions || ['None']))) } : { role: 'Merchant', faction: 'None' };
  }
  if (data.compendium) {
    // Every priest holds a divine essence, so a Normal-rank priest has at least that one.
    const count = Math.max(essenceCount(level, rng), role.name === 'Priest' && list(data.divine?.essences).length ? 1 : 0);
    const divine = count ? divineGrant(data, n, role, opts, rng) : null;
    if (divine) n.essences.push(divine);
    // Sometimes the other two essences complete one of the god's own recipes, forming its divine confluence.
    const rw = RARITY_WEIGHTS[n.rank] || RARITY_WEIGHTS.Bronze;
    const allowed = name => { const e = data.compendium.essences.find(x => x.name === name); return e && (rw[e.rarity] ?? 1) > 0; };
    const recipes = divine && count === 3 ? list(data.divine?.confluences).filter(c => c.god === divine.god).flatMap(c => c.recipes)
      .filter(r => r.slice(1).every(allowed)) : [];
    if (recipes.length && chance(rng, 0.35)) {
      const r = pick(rng, recipes);
      for (const name of r.slice(1)) {
        const e = data.compendium.essences.find(x => x.name === name);
        if (e) n.essences.push(essenceFrom(e, rng));
      }
    }
    while (n.essences.length < count) n.essences.push(newEssence(data, n, cls, rng));
    if (divine && count === 1) n.path = `Divine essence from ${divine.called}`;
    else if (level <= 1 && count) n.path = `Normal, ${count} essence${count > 1 ? 's' : ''} and no confluence yet`;
  }
  if (twistDef) n.twist = { name: twistDef.name };

  const R = npcRollers(data, n, opts, rng);
  if (twistDef) n.twist = R.twist(twistDef);
  n.desc = Object.fromEntries(DESC_PARTS.map(k => [k, R.desc[k](true)]));
  n.backstory = R.backstory.map(f => f()).filter(Boolean);
  n.rumours = [];
  for (let i = 0; i < 2; i++) n.rumours.push(R.rumour(n.rumours));
  n.persona = R.persona();
  for (const k of ONE_LINERS) n[k] = R.one(k);
  n.secrets = [];
  for (let i = 0; i < 2; i++) n.secrets.push(R.secret(n.secrets));
  n.hook = R.hook();
  return finishNPC(data, n, rng);
}

const DESC_PARTS = ['body', 'face', 'eyes', 'feature', 'mark', 'dress', 'voice'];
const ONE_LINERS = ['hope', 'motivation', 'fear', 'bond', 'flaw', 'attitude', 'wantsFromParty', 'tell'];
const ONE_BANKS = { hope: 'hopes', motivation: 'motivations', fear: 'fears', bond: 'bonds', flaw: 'flaws', attitude: 'attitudes', wantsFromParty: 'wantsFromParty', tell: 'tells' };

function newNPCName(data, n, opts, rng) {
  const people = n.namesFrom === 'outworlder' ? { names: data.peoples.outworlderNames } : data.peoples.peoples.find(p => p.name === n.namesFrom) || pick(rng, data.peoples.peoples);
  // Avoid names already taken by NPCs in the wiki, and the NPC's current name.
  const taken = new Set(list(opts.wiki?.npcs).flatMap(t => [t.toLowerCase(), t.split(' ')[0].toLowerCase()]));
  if (n.name) taken.add(n.name.split(' ')[0].toLowerCase());
  const style = n.style || opts.style || '';
  let name = pickName(rng, people, data, style);
  for (let i = 0; i < 30 && (taken.has(name.toLowerCase()) || taken.has(name.split(' ')[0].toLowerCase())); i++) name = pickName(rng, people, data, style);
  return name;
}

// Divine essences: granted by a god to its priests, and to some ordinary worshippers.
const LAY_DIVINE_CHANCE = { 'Guard or soldier': 0.3, Crafter: 0.3, Merchant: 0.25, 'Wilderness guide': 0.25, 'Street operator': 0.15, Adventurer: 0.15 };
// Gods whose worshippers keep it hidden don't turn up on ordinary folk at random.
const HIDDEN_CHURCHES = ['Church of Undeath', 'Church of Disguise'];

export function divineEssence(d, rng) {
  let grant = d.grant;
  if (grant.type === 'proficiency') grant = { ...grant, chosen: pick(rng, proficiencyOptions(grant.text)) };
  return {
    name: d.name, divine: true, god: d.god, called: d.called || d.god, church: d.church, rarity: 'divine', affinity: d.affinity,
    theme: d.theme, look: d.look, grant, sense: d.sense, channel: d.channel, aura: d.aura, stoneSpells: d.stoneSpells,
  };
}

function layDivine(data, opts, rng, not) {
  const all = list(data.divine?.essences).filter(d => d.church !== not);
  const churches = list(opts.wiki?.churches);
  const pool = all.filter(d => churches.length ? churches.includes(d.church) : !HIDDEN_CHURCHES.includes(d.church));
  return pool.length ? divineEssence(pick(rng, pool), rng) : null;
}

function divineGrant(data, n, role, opts, rng) {
  const all = list(data.divine?.essences);
  if (!all.length || role.name === 'Cultist in disguise') return null;
  if (role.name === 'Priest') {
    const own = all.find(d => d.church === n.faction);
    return own ? divineEssence(own, rng) : layDivine(data, opts, rng);
  }
  return chance(rng, LAY_DIVINE_CHANCE[role.name] ?? 0.1) ? layDivine(data, opts, rng) : null;
}

/** The compendium with the gods' own confluences and recipes added in front, so exact divine recipes win. */
export function withDivine(comp, divine) {
  const confs = list(divine?.confluences);
  if (!comp || !confs.length) return comp;
  return {
    ...comp,
    combos: [...confs.flatMap(c => c.recipes.map(r => ({ essences: r, result: c.name }))), ...comp.combos],
    confluences: [...confs, ...comp.confluences],
  };
}

function newEssence(data, n, cls, rng) {
  const comp = data.compendium;
  const owned = new Set(n.essences.map(e => e.name));
  const pool = { ...comp, essences: comp.essences.filter(e => !owned.has(e.name)) };
  const [e] = pickCompendiumEssences(rng, pool, cls, n.rank, 1);
  return essenceFrom(e, rng);
}

function essenceFrom(e, rng) {
  const look = (e.description.match(/Bearers?[^.]*\./) || [''])[0];
  let grant = e.grant;
  if (grant.type === 'proficiency') grant = { ...grant, chosen: pick(rng, proficiencyOptions(grant.text)) };
  return { name: e.name, rarity: e.rarity, affinity: e.affinity, theme: e.theme, look, grant };
}

/** Confluence, awakening stones, description text and the stat block all follow from the parts above. */
function finishNPC(data, n, rng) {
  const comp = data.compendium;
  const cls = data.classes.classes.find(c => c.name === n.class);
  const picked = comp ? n.essences.map(e => e.divine ? e : comp.essences.find(x => x.name === e.name)).filter(Boolean) : [];
  n.confluence = comp && picked.length === 3 ? findCompendiumConfluence(withDivine(comp, data.divine), picked) : null;
  const sameEssences = n.stones && n.stoneKey === picked.map(e => e.name).join('+');
  if (!sameEssences) n.stones = comp ? compendiumStones(rng, comp, picked, n.level, n.corePath) : [];
  n.stoneKey = picked.map(e => e.name).join('+');
  n.description = DESC_PARTS.map(k => n.desc[k]).filter(Boolean).join(' ');
  const essenceSkills = n.essences.map(e => e.grant.chosen).filter(s => s && SKILL_ABILITY[s]);
  const otherProfs = n.essences.map(e => e.grant.chosen).filter(s => s && !SKILL_ABILITY[s]);
  const skillRng = makeRng([...n.name].reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
  n.stats = statBlock(skillRng, n, cls, n.scores, n.peopleKey, n.outworlderKind, n.role, essenceSkills, otherProfs);
  n.stats.base = baseStatBlock(data, cls, n.level);
  return n;
}

/** Everything that can be rolled, and rerolled, for an NPC once its identity is settled. */
function npcRollers(data, n, opts, rng) {
  const role = data.npc.roles.find(r => r.name === n.role) || data.npc.roles[0];
  const { pronoun, age, level, rank } = n;
  const P = PRONOUNS[pronoun];
  const first = n.name.split(' ')[0];
  const wiki = opts.wiki || {};
  const npcs = list(wiki.npcs).filter(t => t !== n.name && !/^key npcs$/i.test(t));
  const locations = list(wiki.locations);
  const wikiFactions = list(wiki.factions);
  const faction = n.faction !== 'None' ? n.faction : null;
  const linkable = t => wikiFactions.length === 0 || wikiFactions.includes(t);
  const ctx = {
    pronoun, first,
    place: () => {
      // Now and then a backstory names a place that doesn't exist yet (opts.newPlace, from the app): it rides along
      // as a draft in n.newPlaces and becomes a page if the NPC is saved.
      const job = opts.newPlace?.({ npc: true }, rng);
      if (job) { if (job.draft) n.newPlaces = [...list(n.newPlaces), job.draft]; return linkTo(job.title); }
      return locations.length && chance(rng, 0.8) ? linkTo(pick(rng, locations)) : pick(rng, GENERIC_PLACES);
    },
    faction: () => {
      const f = faction && chance(rng, 0.7) ? faction : wikiFactions.length ? pick(rng, wikiFactions) : null;
      return f ? (linkable(f) ? factionPhrase(f) : `the ${f}`) : pick(rng, GENERIC_FACTIONS);
    },
    npc: () => npcs.length && chance(rng, 0.85) ? `[[${pick(rng, npcs)}]]` : pickName(rng, pickPeople(rng, data), data),
    essence: () => { const own = n.essences.filter(e => !e.divine); return own.length ? pick(rng, own).name : 'Might'; },
    god: () => n.essences.find(e => e.divine)?.called || 'the gods',
    cult: () => wikiFactions.includes('The Builder Cult') ? linkTo('The Builder Cult') : wikiFactions.includes('Cults') ? 'one of the [[Cults|cults]]' : 'a secret cult',
  };
  const fill = t => capSentence(fillNPC(t, ctx));
  const usable = arr => list(arr).filter(t => n.essences.some(e => !e.divine) ? true : !t.includes('{essence}') && !/\b(absorb|essence)/i.test(t));
  const fresh = (arr, avoid = []) => { const pool = arr.filter(x => !avoid.includes(x)); return pool.length ? pick(rng, pool) : arr.length ? pick(rng, arr) : null; };

  // Description: one paragraph stitched from the looks banks, with the people's own features.
  const L = data.npc.looks || {};
  const pl = L.peoples?.[n.peopleKey] || {};
  // Young faces don't get grey hair or deep lines.
  const OLDISH = /gr[ae]y|white|silver|wrinkl|weathered|lined|lines|balding|thinning|age-spotted|grizzled/i;
  const bank = key => {
    const all = list(pl[key]).length ? pl[key] : list(L[key]);
    let fit = ['young', 'adult'].includes(age) && ['face', 'hair'].includes(key) ? all.filter(x => !OLDISH.test(x)) : all;
    if (key === 'face' && pronoun === 'she') fit = fit.filter(x => !/beard|stubble|moustache|mustache/i.test(x));
    if (key === 'build') fit = fit.filter(x => !/\bas an? /.test(x));
    return fit.length ? fit : all;
  };
  const peopleWord = n.outworlderKind ? n.outworlderKind.toLowerCase() : n.peopleKey;
  const has = k => list(L[k]).length > 0;
  const desc = {
    body: () => has('build') ? fill(`${n.name} is ${article(pick(rng, bank('build')))} ${peopleWord} ${P.noun}${list(L.age?.[age]).length ? ` ${pick(rng, L.age[age])}` : ''}.`) : null,
    face: () => has('face') ? fill(`${first} has ${pick(rng, bank('face'))} and ${pick(rng, bank('hair'))}.`) : null,
    eyes: () => has('eyes') ? fill(pick(rng, L.eyes)) : null,
    feature: initial => list(pl.features).length && (!initial || chance(rng, 0.8)) ? fill(pick(rng, pl.features)) : null,
    mark: () => has('marks') ? fill(pick(rng, L.marks)) : null,
    dress: () => {
      if (!has('gear')) return null;
      const clothes = [...list(L.clothing?.[role.name]), ...list(L.clothing?.[role.name]), ...list(L.clothing?.any)];
      // Rank badges in the gear bank show the NPC's own rank; normal folk carry none.
      const gear = list(L.gear).filter(g => level > 1 || !/rank badge|adventurer's badge/i.test(g));
      const item = pick(rng, gear).replace(/\b(Iron|Bronze|Silver|Gold|Diamond)(?=[- ]rank badge)/, rank);
      return fill(`${first} wears ${pick(rng, clothes)}, and carries ${item}.`);
    },
    voice: () => has('voice') ? fill(`{Their} voice is ${pick(rng, L.voice)}, and ${first} has a habit of ${pick(rng, list(L.mannerism))}.`) : null,
  };

  const S = data.npc.story || {};
  const pathKey = level <= 1 ? 'none' : n.corePath ? 'core' : 'natural';
  const story = arr => () => { const pool = usable(arr); return pool.length ? fill(pick(rng, pool)) : null; };
  const divineStory = n.essences.some(e => e.divine) && list(data.divine?.story).length;
  const backstory = [story(S.origins), story(S.turningPoints), divineStory ? story(data.divine.story) : story(S.rankPaths?.[pathKey]), story(S.roles?.[role.name]), story(S.ties)];

  const R = data.npc.persona || {};
  // Some personas only fit certain NPCs.
  const fits = x => {
    const nm = x.name.toLowerCase();
    if (/child|youth/.test(nm)) return age === 'young';
    if (/elder/.test(nm)) return ['middle', 'old'].includes(age);
    if (/veteran|has-been/.test(nm)) return age !== 'young';
    if (/outworlder/.test(nm)) return n.outworlder || n.twist?.name === 'Hidden outworlder';
    if (/cultist/.test(nm)) return n.twist?.name === 'Secret cultist';
    if (/matriarch/.test(nm)) return pronoun === 'she';
    return true;
  };

  return {
    desc,
    backstory,
    rumour: (avoid = []) => fill(fresh(usable(S.rumours), avoid) || ''),
    persona: () => {
      const p = fresh(list(R.personas).filter(fits), [n.persona?.name].filter(Boolean).map(nm => list(R.personas).find(x => x.name === nm)));
      return p && { ...p, traits: list(p.traits).map(fill), lines: list(p.lines).map(fill) };
    },
    one: key => list(R[ONE_BANKS[key]]).length ? fill(pick(rng, R[ONE_BANKS[key]])) : null,
    secret: (avoid = []) => fill(fresh(list(R.secrets).length ? R.secrets : list(data.npc.secrets), avoid) || ''),
    hook: () => list(data.npc.hooks).length ? pick(rng, data.npc.hooks) : null,
    // Three tells at most, so a long list still reads as a short note.
    twist: def => ({ name: def.name, truth: fill(def.truth), play: fill(def.play), tells: sample(rng, list(def.tells), 3).map(fill), reveal: fill(def.reveal), stats: def.stats ? fill(def.stats) : null }),
  };
}

/**
 * Rerolls one part of an NPC and keeps the rest: 'name', 'desc.face', 'backstory.2', 'rumour.0', 'persona',
 * 'hope' (and the other one-liners), 'secret.1', 'hook', 'twist', 'essence.0' or 'scores'.
 */
export function rerollNPC(data, n, part, rng = Math.random, opts = {}) {
  const next = structuredClone(n);
  const [key, idx] = part.split('.');
  const i = Number(idx);
  if (key === 'name') {
    const old = n.name, oldFirst = old.split(' ')[0];
    next.name = newNPCName(data, n, opts, rng);
    const nf = next.name.split(' ')[0];
    const swap = s => typeof s === 'string' ? (old === oldFirst ? s : s.split(old).join(next.name)).replace(new RegExp(`\\b${oldFirst.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), nf) : s;
    const walk = o => Array.isArray(o) ? o.map(walk) : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, k === 'name' && o === next ? v : walk(v)])) : swap(o);
    for (const k of ['desc', 'backstory', 'rumours', 'persona', 'secrets', 'twist', ...ONE_LINERS]) if (next[k]) next[k] = walk(next[k]);
    // Only the opening sentence uses the full name.
    if (next.desc.body) next.desc.body = next.desc.body.replace(/^.*? is an? /, m => `${next.name}${m.slice(m.lastIndexOf(' is '))}`);
    return finishNPC(data, next, rng);
  }
  if (key === 'essence') {
    const cls = data.classes.classes.find(c => c.name === n.class);
    const old = n.essences[i];
    const fresh = old?.divine ? layDivine(data, opts, rng, old.church) || old : newEssence(data, { ...next, essences: n.essences }, cls, rng);
    next.essences.splice(i, 1);
    next.essences.splice(i, 0, fresh);
    if (old?.divine && next.path?.startsWith('Divine essence')) next.path = `Divine essence from ${fresh.called}`;
    next.stones = null;
    return finishNPC(data, next, rng);
  }
  if (key === 'scores') {
    next.scores = abilityScores(rng, data.classes.classes.find(c => c.name === n.class), n.level);
    return finishNPC(data, next, rng);
  }
  if (key === 'stones') { next.stones = null; return finishNPC(data, next, rng); }
  const R = npcRollers(data, next, opts, rng);
  if (key === 'desc') next.desc[idx] = R.desc[idx](false);
  else if (key === 'backstory') next.backstory[i] = R.backstory[i]?.() ?? next.backstory[i];
  else if (key === 'rumour') next.rumours[i] = R.rumour(n.rumours);
  else if (key === 'secret') next.secrets[i] = R.secret(n.secrets);
  else if (key === 'persona') next.persona = R.persona();
  else if (key === 'hook') next.hook = R.hook();
  else if (key === 'twist') {
    // Another hidden truth that still fits this NPC. Disguised cultists stay cultists.
    if (n.role === 'Cultist in disguise') return n;
    const options = list(data.npc.twists).filter(t => t.name !== n.twist?.name && t.name !== 'Secret cultist'
      && (t.name !== 'Hidden outworlder' || (n.peopleKey === 'Human' && !n.outworlder)));
    if (options.length) next.twist = R.twist(weighted(rng, options));
  } else if (ONE_LINERS.includes(key)) next[key] = R.one(key);
  return finishNPC(data, next, rng);
}

const shortAb = a => cap(a.toLowerCase());

function statBlockMarkdown(n, w = (p, t) => t) {
  const s = n.stats;
  const L = [];
  L.push('<div class="statblock">', '');
  L.push(`### ${n.name}`, '');
  L.push(`*${s.size} humanoid (${n.people}), ${n.rank} rank ${n.class.toLowerCase()} ${n.level}*`, '');
  L.push(`**Armor Class** ${s.ac}${s.armor ? ` (${s.armor})` : ''}  `);
  L.push(`**Hit Points** ${s.hp} (${s.hpDice})  `);
  L.push(`**Speed** ${s.speed}`, '');
  L.push(`| ${ABILITIES.join(' | ')} |`, `| ${ABILITIES.map(() => ':---:').join(' | ')} |`);
  L.push(`| ${ABILITIES.map(a => w('scores', `${s.scores[a]} (${signed(mod(s.scores[a]))})`)).join(' | ')} |`, '');
  if (s.saves.length) L.push(`**Saving Throws** ${s.saves.join(', ')}  `);
  if (s.skills.length) L.push(`**Skills** ${s.skills.join(', ')}  `);
  if (s.otherProfs.length) L.push(`**Proficiencies** ${s.otherProfs.join(', ')}  `);
  L.push(`**Senses** ${s.senses.join(', ')}  `);
  L.push(`**Languages** ${s.languages.join(', ')}  `);
  L.push(`**Challenge** ${crLabel(s.cr)} (${s.xp.toLocaleString('en-US')} XP) · **Proficiency Bonus** +${s.pb}`, '');
  if (s.traits.length) {
    L.push('#### Traits', '');
    for (const t of s.traits) L.push(`***${t.name}.*** ${t.text}`, '');
  }
  L.push('#### Actions', '');
  for (const a of s.actions) L.push(`***${a.name}.*** ${a.text}`, '');
  if (n.stones.length) {
    L.push('#### Awakening stones', '');
    L.push(`Each once per long rest. Spell save DC ${n.corePath ? s.stoneDC - 2 : s.stoneDC}, ${shortAb(s.castAbility)}-based, ${n.corePath ? signed(Number(s.stoneAttack) - 2) : s.stoneAttack} to hit with spell attacks${n.corePath ? ' (already reduced for a core user)' : ''}.`, '');
    for (const st of n.stones) L.push(`- ${w('stones', `*${st.spell}* (level ${st.level}, ${st.essence})`)}`);
    L.push('');
  }
  L.push(`Closest published stat block: **${s.base.name}** (CR ${crLabel(s.base.cr)}, ${s.base.source}).`, '');
  L.push('</div>');
  return L;
}

/** interactive: wraps each rerollable part in a span the generator screen can click. Saved pages leave it off. */
export function npcToMarkdown(n, { interactive = false } = {}) {
  const w = (part, text) => interactive && text ? `<span class="reroll" data-part="${part}" title="Click to reroll">${text}</span>` : text;
  const L = [];
  const shown = n.cover || n;
  const head = `**${n.rank}-rank ${n.people} ${n.class.toLowerCase()} (level ${n.level})** · ${shown.role}${shown.faction && shown.faction !== 'None' ? ` · [[${shown.faction}]]` : ''}`;
  // The stat block leads the page, for the DM only, so it's the first thing to hand in play.
  L.push(':::dm', ...statBlockMarkdown(n, w), ':::', '');
  L.push(head, '');
  if (n.description) L.push(interactive ? DESC_PARTS.filter(k => n.desc[k]).map(k => w(`desc.${k}`, n.desc[k])).join(' ') : n.description, '');
  L.push(`Species: ${n.species}.${n.outworlder ? ' An outworlder: one bonus language, no local reputation.' : ''}`, '');
  if (n.rumours.length) {
    L.push('## What people say', '');
    n.rumours.forEach((r, i) => L.push(`- ${w(`rumour.${i}`, r)}`));
    L.push('');
  }
  L.push(':::dm');
  if (n.twist) {
    L.push(`## The truth: ${w('twist', n.twist.name.toLowerCase())}`, '');
    if (n.cover) L.push(`Not really ${/^[aeiou]/i.test(n.cover.role) ? 'an' : 'a'} ${n.cover.role.toLowerCase()}: that is the cover everyone else sees.`, '');
    L.push(n.twist.truth, '');
    L.push(`- **Keeping the secret:** ${n.twist.play}`);
    L.push(`- **Tells the party might notice:** ${n.twist.tells.map((t, i) => i ? t[0].toLowerCase() + t.slice(1) : t).join('; ')}.`);
    L.push(`- **How it could come out:** ${n.twist.reveal}`);
    if (n.twist.stats) L.push(`- **When revealed:** ${capSentence(n.twist.stats.replace(/^When (revealed|it shows itself), /i, ''))}`);
    L.push('');
  }
  if (n.backstory.length) L.push('## Backstory', '', n.backstory.map((b, i) => w(`backstory.${i}`, b)).join(' '), '');
  L.push(`## Playing ${n.name.split(' ')[0]}`, '');
  if (n.persona) {
    L.push(w('persona', `**${n.persona.name}.** ${n.persona.traits.join('. ').replace(/\.\./g, '.')}${/[.!?]$/.test(n.persona.traits.at(-1) || '') ? '' : '.'}`), '');
    L.push(`- **Speech:** ${w('persona', n.persona.speech)}`);
    L.push(`- **How to play:** ${w('persona', n.persona.play)}`);
  }
  if (n.tell) L.push(`- **Tell:** ${w('tell', n.tell)}`);
  if (n.attitude) L.push(`- **Toward the party:** ${w('attitude', n.attitude)}`);
  if (n.wantsFromParty) L.push(`- **Wants from the party:** ${w('wantsFromParty', n.wantsFromParty)}`);
  L.push(`- **Pronouns:** ${n.pronoun}/${PRONOUNS[n.pronoun].them}`);
  L.push('');
  if (n.persona?.lines?.length) {
    L.push('**Things to say:**', '');
    for (const l of n.persona.lines) L.push(`> ${w('persona', l)}`, '>');
    L.pop();
    L.push('');
  }
  L.push('## Hopes, drives and fears', '');
  if (n.hope) L.push(`- **Hopes:** ${w('hope', n.hope)}`);
  if (n.motivation) L.push(`- **Driven by:** ${w('motivation', n.motivation)}`);
  if (n.fear) L.push(`- **Fears:** ${w('fear', n.fear)}`);
  if (n.bond) L.push(`- **Bond:** ${w('bond', n.bond)}`);
  if (n.flaw) L.push(`- **Flaw:** ${w('flaw', n.flaw)}`);
  L.push('');
  L.push('## Secrets', '');
  n.secrets.forEach((s, i) => L.push(`${i + 1}. ${w(`secret.${i}`, s)}`));
  if (n.hook) L.push('', `**Hook:** ${w('hook', n.hook)}`);
  L.push('');
  L.push('## Essences and powers', '');
  L.push(`Path to rank: ${n.path}.`, '');
  if (n.essences.length) {
    n.essences.forEach((e, i) => {
      const g = e.grant.type === 'proficiency' ? `proficiency: ${e.grant.chosen}` : `**${e.grant.name}**`;
      if (e.divine) {
        const line = `**${e.name}** (granted by [[${e.church}|${e.called}]], ${e.affinity}): ${e.theme.replace(/\.$/, '')}. Grants ${g}, **${e.sense.name}**, **${e.channel.name}**${n.level >= 5 ? ` and **${e.aura.name}**` : ''}. ${e.look} The god can take it back at any time.`;
        L.push(`- ${n.role === 'Priest' ? line : w(`essence.${i}`, line)}`);
        return;
      }
      L.push(`- ${w(`essence.${i}`, `**${e.name}** (${e.rarity}, ${e.affinity}): ${e.theme.replace(/\.$/, '')}. Grants ${g}. ${e.look}`.trim())}`);
    });
    if (n.confluence) L.push(`- **Confluence: ${n.confluence.name}** (${n.confluence.divine ? `divine confluence of ${n.essences.find(e => e.divine)?.called || n.confluence.god}` : `${n.confluence.affinities.join(' + ')}, by ${n.confluence.how}`}): ${n.confluence.theme.replace(/\.$/, '')}. Grants **${n.confluence.grant.name || 'a proficiency'}**.`);
  } else L.push('No essences yet.');
  L.push('');
  L.push(':::', '');
  L.push('## History', '', 'Session notes that mention this character appear below this page automatically.', '');
  return L.join('\n');
}

// ---------- encounters ----------

/**
 * Whether a creature can get at a party travelling on land, on the water or in the air. Fliers go anywhere,
 * swimmers only on the water, and a creature that can only swim never comes up on land.
 */
export function movesIn(stat, way) {
  const sp = speedOf(stat);
  if (way === 'air') return sp.fly > 0;
  if (way === 'water') return sp.fly > 0 || sp.swim > 0;
  return !(sp.swim > 0 && !sp.fly && sp.walk <= 10 && !sp.burrow && !sp.climb);
}

function eligibleMonsters(data, theme, maxCR, kinds = []) {
  // Monsters tagged peaceful (cats, commoners, mules) never turn up in a generated fight.
  let all = data.monsters.monsters.filter(m => m.cr <= maxCR && !m.themes.includes('peaceful'));
  // A place that suits some creature types (an astral environment) draws on those when it has enough of them.
  if (kinds.length) {
    const kind = m => kinds.includes(monsterType(monsterInfo(data, m.name) || {})) || m.themes.some(t => kinds.includes(t));
    const fit = all.filter(kind);
    const fitThemed = fit.filter(m => !theme || theme === 'any' || m.themes.includes(theme));
    if (fitThemed.length >= 3) return fitThemed;
    if (fit.length >= 4) all = fit;
  }
  if (!theme || theme === 'any') return all;
  const themed = all.filter(m => m.themes.includes(theme));
  // Too few themed monsters at this level: widen to anything astral-flavored.
  if (themed.length >= 3) return themed;
  const widened = all.filter(m => m.themes.includes(theme) || m.themes.includes('astral'));
  return widened.length >= 3 ? widened : all;
}

export function generateEncounter(data, opts, rng = Math.random) {
  const level = Math.max(1, Math.min(20, Number(opts.level) || 1));
  const size = Math.max(1, Math.min(8, Number(opts.partySize) || 4));
  const difficulty = opts.difficulty || 'moderate';
  const budget = xpBudget(level, size, difficulty);
  const maxCR = Math.max(0.5, level + (difficulty === 'high' ? 3 : 2));
  let eligible = eligibleMonsters(data, opts.theme, maxCR, list(opts.kinds));
  if (opts.moves) {
    // Only creatures that can reach the party where it is: fliers in the sky, swimmers and fliers at sea.
    const can = m => movesIn(monsterInfo(data, m.name), opts.moves);
    eligible = eligible.filter(can);
    if (eligible.length < 3) eligible = eligibleMonsters(data, 'any', maxCR, []).filter(can);
  }
  let pool = eligible.filter(m => CR_XP[m.cr] <= budget);
  // A lower-rank creature can spawn with more magic in it, at the party's rank: an ape that comes out a silverback.
  const partyRank = rankForLevel(level) === 'Normal' ? 'Iron' : rankForLevel(level);
  const [bandMin, bandMax] = RANK_CR[partyRank];
  if (bandMin > 0 && opts.variants !== false) {
    const crs = Object.keys(CR_XP).map(Number).filter(c => c >= bandMin && c <= Math.min(maxCR, bandMax) && CR_XP[c] <= budget);
    const lower = eligible.filter(m => m.cr < bandMin && monsterInfo(data, m.name));
    if (crs.length) {
      // Prefer the cheaper end of the rank, so a fight can hold more than one of them.
      const cr = () => weighted(rng, crs, c => 1 / (1 + crs.indexOf(c)));
      const variants = sample(rng, lower, Math.min(lower.length, 30)).map(m => ({ ...m, cr: cr(), variantOf: m.name }));
      // Creatures below the party's rank only do it half damage, so a fight at Bronze and above is made of its own rank.
      const ranked = [...pool.filter(m => m.cr >= bandMin), ...variants];
      pool = ranked.length >= 3 ? ranked : [...pool, ...variants];
    }
  }
  if (!pool.length) return { kind: 'encounter', budget, spent: 0, groups: [], cores: [], difficulty, level, partySize: size, theme: opts.theme };

  // Lead monster takes a big slice of the budget; the rest is filled with
  // copies of it or with smaller themed company.
  const leadTarget = budget * (opts.boss ? 0.6 + rng() * 0.35 : 0.35 + rng() * 0.45);
  const leadPool = pool.filter(m => CR_XP[m.cr] <= leadTarget);
  const lead = leadPool.length
    ? weighted(rng, leadPool, m => 0.2 + (CR_XP[m.cr] / leadTarget) ** 2 * 10)
    : pool.reduce((a, b) => (CR_XP[a.cr] < CR_XP[b.cr] ? a : b));

  const groups = [{ monster: lead, count: 1 }];
  let spent = CR_XP[lead.cr];
  let creatures = 1;
  const maxCreatures = opts.boss ? 4 : 8;
  for (let guard = 0; guard < 30 && creatures < maxCreatures; guard++) {
    const left = budget - spent;
    const affordable = pool.filter(m => CR_XP[m.cr] <= left && CR_XP[m.cr] <= CR_XP[lead.cr]);
    // Keep company roughly in the lead's league, so a level 9 fight isn't padded with kobolds.
    const peers = affordable.filter(m => m.cr >= lead.cr / 4);
    // Company that shares a theme with the lead, so a mummy isn't backed up by a brown bear and an imp.
    const kin = peers.filter(m => m === lead || m.themes.some(t => lead.themes.includes(t)));
    // Of the same kind of creature when there are any (beasts with beasts, fiends with fiends), and never more than two different ones.
    const kindOf = m => monsterType(monsterInfo(data, m.variantOf || m.name) || {});
    const sameKind = kin.filter(m => kindOf(m) === kindOf(lead));
    let options = sameKind.length ? sameKind : kin.length ? kin : peers.length ? peers : affordable;
    if (groups.length >= 2) options = options.filter(m => groups.some(g => g.monster === m));
    if (!options.length) break;
    const sameAsLead = !opts.boss && options.includes(lead) && chance(rng, 0.5);
    const m = sameAsLead ? lead : pick(rng, options);
    const g = groups.find(x => x.monster === m);
    if (g) g.count++; else groups.push({ monster: m, count: 1 });
    spent += CR_XP[m.cr];
    creatures++;
    if (spent >= budget * 0.9) break;
  }

  const cores = {}, slain = {};
  const intact = coreIntactChance(data);
  for (const g of groups) {
    if (isPerson(data, monsterInfo(data, g.monster.variantOf || g.monster.name))) continue;
    const r = rankForCR(g.monster.cr);
    slain[r] = (slain[r] || 0) + g.count;
    cores[r] = (cores[r] || 0) + intactCores(g.count, intact, rng);
  }

  return {
    kind: 'encounter',
    level, partySize: size, difficulty, theme: opts.theme, budget, spent,
    groups: groups.map(g => {
      const variant = g.monster.variantOf ? rankUp(data, g.monster.variantOf, g.monster.cr, rng) : null;
      return {
        name: variant ? variant.name : g.monster.name, count: g.count, cr: g.monster.cr, xp: CR_XP[g.monster.cr], rank: rankForCR(g.monster.cr),
        stat: !!variant || !!monsterInfo(data, g.monster.name),
        ...(variant ? { base: g.monster.variantOf, variant } : {}),
      };
    }),
    situation: opts.situation && data.encounters.situations ? pick(rng, data.encounters.situations) : '',
    parts: (() => { const sv = salvageAll(data, groups.flatMap(g => Array(g.count).fill(monsterInfo(data, g.monster.variantOf || g.monster.name) && { ...monsterInfo(data, g.monster.variantOf || g.monster.name), cr: g.monster.cr })).filter(Boolean), rng); return sv.items.length ? sv : null; })(),
    cores: Object.entries(slain).map(([rank, n]) => ({ rank, count: cores[rank], cracked: n - cores[rank], value: CORE_PRICE[rank] && cores[rank] ? CORE_PRICE[rank] * cores[rank] : null })),
    essenceDrop: chance(rng, 0.08) && groups.some(g => !isPerson(data, monsterInfo(data, g.monster.variantOf || g.monster.name))) ? (() => {
      const m = pick(rng, groups.filter(g => !isPerson(data, monsterInfo(data, g.monster.variantOf || g.monster.name)))).monster;
      const theme = essenceThemes(data).find(t => m.themes.includes(t)) || (opts.theme !== 'any' ? opts.theme : null);
      // At Iron a fight gives up a common or uncommon essence at most; rarer ones come from astral bosses.
      const r = rankForCR(m.cr);
      const e = lootEssence(data, theme, r, rng, r === 'Iron' || r === 'Normal' ? ['common', 'uncommon'] : null);
      return { monster: m.name, essence: e ? essenceLabel(e) : null };
    })() : null,
  };
}

/** Cores and parts left by an encounter's creatures, worked out again after the DM changes who is in it. */
export function encounterDrops(data, e, rng = Math.random) {
  const intact = coreIntactChance(data), slain = {}, cores = {};
  for (const g of e.groups) {
    if (isPerson(data, monsterInfo(data, g.base || g.name))) continue;
    const r = rankForCR(g.cr);
    slain[r] = (slain[r] || 0) + g.count;
    cores[r] = (cores[r] || 0) + intactCores(g.count, intact, rng);
  }
  const stats = e.groups.flatMap(g => { const m = monsterInfo(data, g.base || g.name); return m ? Array(g.count).fill({ ...m, cr: g.cr }) : []; });
  const sv = salvageAll(data, stats, rng);
  return {
    ...e,
    parts: sv.items.length ? sv : null,
    cores: Object.entries(slain).map(([rank, n]) => ({ rank, count: cores[rank], cracked: n - cores[rank], value: CORE_PRICE[rank] && cores[rank] ? CORE_PRICE[rank] * cores[rank] : null })),
  };
}

// ---------- Adventure Society contracts ----------
// A board of public notices. Each contract has a tier, and a team may take one of its own rank or lower.

export const CONTRACT_TIERS = ['Iron', 'Bronze', 'Silver', 'Gold', 'Diamond'];

/** Can a party of this rank take a contract of that tier? */
export const canTakeContract = (partyRank, tier) => CONTRACT_TIERS.indexOf(partyRank === 'Normal' ? 'Iron' : partyRank) >= CONTRACT_TIERS.indexOf(tier);

/** "Wolves", "Giant Spiders", "Goblins": a monster name in the plural, for "{count} {monster}". */
export function pluralName(name) {
  const words = String(name).split(' ');
  const last = words.pop();
  const p = /(man)$/i.test(last) ? last.replace(/man$/i, 'men')
    : /[^aeiou]y$/i.test(last) ? last.slice(0, -1) + 'ies'
      : /(wolf|elf|dwarf|calf|half)$/i.test(last) ? last.slice(0, -1) + 'ves'
        : /(s|x|z|ch|sh)$/i.test(last) ? last + 'es' : last + 's';
  return [...words, p].join(' ');
}

/** A monster for a contract of this tier: one native to the rank, or a lower one spawned at it (an ape born a silverback). */
function contractMonster(data, tier, rng) {
  const [lo, hi] = RANK_CR[tier];
  const all = list(data.monsters?.monsters).filter(m => !m.themes.includes('peaceful') && monsterInfo(data, m.name));
  const native = all.filter(m => m.cr >= lo && m.cr <= hi);
  const lower = all.filter(m => m.cr < lo);
  if (native.length && (!lower.length || chance(rng, 0.5))) {
    const m = pick(rng, native);
    return { name: m.name, cr: m.cr, rank: tier };
  }
  if (!lower.length) return null;
  const base = pick(rng, lower);
  const cr = Math.min(hi, lo + int(rng, 0, 3));
  const v = rankUp(data, base.name, cr, rng);
  return v ? { name: v.name, base: base.name, cr, rank: tier, variant: v } : null;
}

// A line that names a rank ("Iron-rank clearance", "a good first contract") only goes on a contract of that tier.
const RANK_NAMED = /\b(Iron|Bronze|Silver|Gold|Diamond)[- ]rank(?!ers? )/;
function forTier(lines, tier) {
  const ok = list(lines).filter(l => { const m = String(l).match(RANK_NAMED); return (!m || m[1] === tier) && (tier === 'Iron' || !/\bfirst contract\b/i.test(l)); });
  return ok.length ? ok : list(lines);
}
/** What the contract's place is like: a settlement or a wild site, and its terrain, from a new place's draft or the app. */
function contractPlaceInfo(c, ctx) {
  if (c.newPlace) return { settled: c.newPlace.group !== 'site', terrain: [...list(c.newPlace.terrain), ...list(c.newPlace.water)], label: c.newPlace.label };
  const title = c.destination || String(c.place).replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, '$1');
  return ctx.placeInfo?.(title) || null;
}
const WATER_CLIENT = /harbour|fishing|ferryman|marsh|Delta|salt trader|coast/i;
const WATER_LAND = /coast|delta|marsh|river|lake|sea|swamp|water|port|fishing/i;
/** Clients who'd plausibly be there: no harbourmaster in a desert hamlet, no town council at a bandit camp. */
function clientsFor(clients, info) {
  if (!info) return clients;
  const wet = [...list(info.terrain), info.label || ''].some(t => WATER_LAND.test(t));
  const ok = clients.filter(t => (wet || !WATER_CLIENT.test(t)) && (info.settled || !/\{place\}/.test(t) || /(near|outside|on the road to) \{place\}/.test(t)));
  return ok.length ? ok : clients;
}

function contractPart(data, b, c, part, ctx, rng) {
  const type = b.types.find(t => t.key === c.type);
  const fill = text => {
    const own = { client: () => c.client, place: () => c.place, item: () => c.item, npc: () => c.npc, faction: () => c.faction, astral: () => c.astral, days: () => c.days, count: () => c.count, monster: () => c.monster ? c.monster.name.toLowerCase() : 'monster' };
    return capSentence(String(text)
      .replace(/\{count\} \{monster\}/g, () => `${c.count} ${c.monster ? pluralName(c.monster.name.toLowerCase()) : 'monsters'}`)
      .replace(/\b([Aa]) \{monster\}/g, (m, a) => `${/^[aeiou]/i.test(c.monster?.name || 'm') ? `${a}n` : a} {monster}`)
      .replace(/\{(\w+)\}/g, (m, k) => own[k] ? own[k]() : m));
  };
  if (part === 'monster') c.monster = contractMonster(data, c.tier, rng);
  if (part === 'client') c.client = fillVenue(pick(rng, clientsFor(b.clients, contractPlaceInfo(c, ctx))).replace(/\{place\}/g, c.place), ctx, false);
  if (part === 'notice') c.notice = fill(pick(rng, forTier(type.notices, c.tier)));
  if (part === 'details') c.details = fill(pick(rng, forTier(type.details, c.tier)));
  if (part === 'complication') c.complication = fill(pick(rng, type.complications));
  if (part === 'twist') c.twist = fill(pick(rng, type.twists));
  if (part === 'proof') c.proof = fill(pick(rng, type.proof));
  if (part === 'terms') {
    c.deadline = fill(pick(rng, b.deadlines));
    // A notice that says "within 14 days" is the deadline: the terms and the Accept dialog say the same.
    delete c.noticeDays;
    if (new RegExp(`within ${c.days} days`, 'i').test(c.notice || '')) { c.noticeDays = c.days; if (!new RegExp(`\\b${c.days} days`).test(c.deadline)) c.deadline = `within ${c.days} days`; }
    c.requirement = chance(rng, 0.45) ? fill(pick(rng, b.requirements)) : '';
    c.bonus = chance(rng, 0.45) ? fill(pick(rng, b.bonuses)) : '';
    // A bonus that is a thing to keep can go into the party inventory (or a player's, for gear) once it's earned.
    const kept = c.bonus && (b.bonusItems || []).find(x => c.bonus.toLowerCase().includes(String(x.match).toLowerCase()));
    if (kept) c.bonusItem = { name: kept.item, gear: !!kept.gear }; else delete c.bonusItem;
  }
  if (part === 'reward') {
    const [lo, hi] = b.tiers[c.tier]?.reward || [5, 40];
    const coins = Math.max(1, Math.round(int(rng, lo, hi) * (type.pay || 1)));
    c.reward = coins * COIN_VALUE[c.tier.toLowerCase()];
  }
  // The monster shows in the DM notes when the job is a fight or the notice names it.
  const named = c.monster && [c.notice, c.details, c.complication, c.twist].some(t => String(t || '').includes(c.monster.name.toLowerCase()) || String(t || '').includes(pluralName(c.monster.name.toLowerCase())));
  c.showMonster = !!c.monster && (named || CONTRACT_FIGHTS.includes(c.type));
  return c;
}

const CONTRACT_FIGHTS = ['hunt', 'surge', 'extermination', 'gather', 'astral', 'defend'];
// Errands pay too little to reach the higher boards often.
const CONTRACT_ERRANDS = ['message', 'survey', 'patrol', 'delivery', 'guard_event'];
const CONTRACT_PARTS = ['monster', 'client', 'notice', 'details', 'complication', 'twist', 'proof', 'terms', 'reward'];

function contractCtx(data, opts, rng) {
  const ctx = venueCtx(data, opts, rng);
  const locations = list(opts.wiki?.locations);
  const names = list(data.contracts?.places).length ? data.contracts.places : ['Millbrook'];
  return { ...ctx, placeInfo: opts.placeInfo, near: () => ctx.here && chance(rng, 0.5) ? ctx.here : locations.length && chance(rng, 0.5) ? pick(rng, locations) : pick(rng, names) };
}

function newContract(data, opts, tier, rng, ctx) {
  const b = data.contracts;
  const types = b.types.filter(t => !opts.type || opts.type === 'any' || t.key === opts.type);
  const type = weighted(rng, types.length ? types : b.types, t => (t.weight ?? 1) * (CONTRACT_ERRANDS.includes(t.key) && !['Iron', 'Bronze'].includes(tier) ? 0.25 : 1));
  const themes = data.astral?.themeWords || {};
  const words = themes[pick(rng, Object.keys(themes))] || themes.default;
  const c = {
    tier, type: type.key, label: type.label,
    place: linkTo(ctx.near()), npc: ctx.npc(), faction: ctx.faction(), item: pick(rng, b.items),
    astral: words ? `the ${pick(rng, words.adjectives)} ${pick(rng, words.nouns)}` : 'a newly charted astral space',
    count: int(rng, 2, tier === 'Iron' ? 6 : 8), days: int(rng, 3, 14),
  };
  contractDestination(c, opts, rng);
  for (const p of CONTRACT_PARTS) contractPart(data, b, c, p, ctx, rng);
  return c;
}

/**
 * Where the job sends the party: opts.newPlace (from the app) may give a generated place nearby, reused or new, for
 * jobs that travel. A new one rides along as c.newPlace, a draft that becomes a wiki page when the contract is kept.
 */
function contractDestination(c, opts, rng) {
  delete c.newPlace;
  const job = opts.newPlace?.({ type: c.type, tier: c.tier }, rng);
  if (!job) return;
  c.place = linkTo(job.title);
  c.destination = job.title;
  if (job.draft) c.newPlace = job.draft;
}

/** opts: where, settlement, partyRank, count, type, wiki. */
export function generateContractBoard(data, opts = {}, rng = Math.random) {
  const b = data.contracts;
  if (!b?.types?.length) return null;
  const ctx = contractCtx(data, opts, rng);
  const settlement = opts.settlement && opts.settlement !== 'any' ? opts.settlement : settlementFor(data, ctx.here, opts.whereMeta) || 'town';
  const mix = Object.entries(b.boards?.[settlement] || b.boards?.town || { Iron: 1 });
  const count = Math.max(1, Math.min(12, Number(opts.count) || int(rng, 5, 8)));
  const partyRank = opts.partyRank && opts.partyRank !== 'any' ? opts.partyRank : null;
  const contracts = [];
  for (let i = 0; i < count; i++) contracts.push(newContract(data, opts, weighted(rng, mix, x => x[1])[0], rng, ctx));
  // A board always has something on it the party can take.
  if (partyRank && !contracts.some(c => canTakeContract(partyRank, c.tier))) contracts[0] = newContract(data, opts, partyRank === 'Normal' ? 'Iron' : partyRank, rng, ctx);
  // Troubles in the area (opts.problems, from the app) often have a notice of their own.
  for (const p of opts.problems || []) {
    if (!p.contract || !chance(rng, 0.6)) continue;
    const i = contracts.findIndex(c => !c.problem);
    if (i < 0) break;
    const c = newContract(data, { ...opts, type: p.contract }, contracts[i].tier, rng, ctx);
    if (c.type !== p.contract) continue;
    c.problem = { id: p.id, name: p.name, summary: p.summary };
    contracts[i] = c;
  }
  contracts.sort((x, y) => CONTRACT_TIERS.indexOf(x.tier) - CONTRACT_TIERS.indexOf(y.tier));
  return {
    kind: 'contracts', where: ctx.here, settlement, partyRank, rule: b.rule,
    name: `${ctx.here ? `${ctx.here} ` : ''}Contract Board`,
    dressing: pick(rng, b.boardDressing), contracts,
  };
}

/** part: "dressing", "add" (one more notice), or "<index>:<part>" with part "all", "remove" or one of the contract's parts. */
export function rerollContracts(data, board, part, rng = Math.random, opts = {}) {
  const r = structuredClone(board);
  const ctx = contractCtx(data, { ...opts, where: r.where }, rng);
  if (part === 'dressing') r.dressing = pick(rng, data.contracts.boardDressing);
  else if (part === 'add') {
    const mix = Object.entries(data.contracts.boards?.[r.settlement] || { Iron: 1 });
    r.contracts.push(newContract(data, opts, weighted(rng, mix, x => x[1])[0], rng, ctx));
  } else {
    const [i, p] = part.split(':');
    const c = r.contracts[Number(i)];
    if (!c) return r;
    if (p === 'remove') r.contracts.splice(Number(i), 1);
    else if (p === 'place') {
      // A different destination: the notice and anything else naming the old one are rewritten around the new one.
      const was = c.place;
      contractDestination(c, { ...opts, newPlace: opts.newPlace && ((q, g) => opts.newPlace({ ...q, fresh: true }, g)) }, rng);
      if (c.place === was) c.place = linkTo(ctx.near());
      swapInContract(c, [[was, c.place]], ['client']);
    } else if (p === 'all') r.contracts[Number(i)] = newContract(data, { ...opts, type: 'any' }, c.tier, rng, ctx);
    else {
      const was = { client: c.client, monster: c.monster?.name };
      contractPart(data, data.contracts, c, p, ctx, rng);
      // Only that part changes: the rest of the notice keeps its words, with the new client or monster put in
      // wherever it named the old one.
      if (p === 'client') swapInContract(c, [[was.client, c.client]]);
      if (p === 'monster' && was.monster && c.monster) {
        const lo = x => x.toLowerCase();
        swapInContract(c, [[lo(pluralName(was.monster)), lo(pluralName(c.monster.name))], [lo(was.monster), lo(c.monster.name)], [pluralName(was.monster), pluralName(c.monster.name)], [was.monster, c.monster.name]]);
        contractPart(data, data.contracts, c, '', ctx, rng);
      }
    }
  }
  return r;
}

// The parts of a contract written as text, where a client, monster or place can be named.
const CONTRACT_TEXTS = ['notice', 'details', 'complication', 'twist', 'proof', 'deadline', 'requirement', 'bonus'];
/** Puts new words in place of old ones across a contract's text, fixing "a"/"an" before them. */
function swapInContract(c, pairs, also = []) {
  for (const k of [...CONTRACT_TEXTS, ...also]) {
    if (typeof c[k] !== 'string' || !c[k]) continue;
    let t = c[k];
    for (const [from, to] of pairs) {
      if (!from || from === to) continue;
      // Capitalised at the start of a sentence too ("A widowed innkeeper…").
      const cap = from[0].toUpperCase() + from.slice(1);
      t = t.split(from).join(`\u0000${to}\u0001`);
      if (cap !== from) t = t.split(cap).join(`\u0000${to[0].toUpperCase()}${to.slice(1)}\u0001`);
    }
    t = t.replace(/\b([Aa])n? \u0000([^\u0001]*)\u0001/g, (m, a, w) => `${/^[aeiou]/i.test(w.replace(/^\[\[/, '')) ? `${a}n` : a} ${w}`).replace(/[\u0000\u0001]/g, '');
    c[k] = t;
  }
}

/** A short name for one contract, for its own page. */
export const contractTitle = c => `${c.label}: ${c.monster && c.notice.includes(c.monster.name.toLowerCase()) ? (c.notice.includes(pluralName(c.monster.name.toLowerCase())) ? pluralName(c.monster.name) : c.monster.name) : c.place.replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, (m, t, l) => l ? l.slice(1) : t)}`;

function contractMd(c, i, { interactive = false, partyRank = null, heading = '###' } = {}) {
  const re = (part, label = 'Reroll') => interactive ? ` <button class="mini-reroll" data-part="${i}:${part}" title="${label}">↻</button>` : '';
  const L = [];
  const tag = partyRank ? (canTakeContract(partyRank, c.tier) ? ' · *the party can take this*' : ` · *above the party's ${partyRank} rank*`) : '';
  L.push(`${heading} ${c.tier} contract: ${c.label}${interactive ? ` <button class="mini-reroll" data-part="${i}:all" title="A different contract of the same tier">↻</button> <button class="mini-reroll" data-part="${i}:remove" title="Take this notice off the board">×</button> ${c.savedAs ? `<button class="mini-reroll save-contract saved" data-save="${i}" title="Saved as ${c.savedAs}. Click to open it.">✓ Saved</button>` : `<button class="mini-reroll save-contract" data-save="${i}" title="Save this contract as its own page">Save</button>`}` : ''}`, '');
  L.push(`> ${c.notice}${re('notice', 'New wording')}`, '');
  if (c.problem) L.push(`**Trouble in the area:** ${c.problem.name}. ${c.problem.summary}  `);
  if (c.destination) {
    const np = c.newPlace;
    const what = np ? `, ${article(np.label)} ${np.miles} miles ${np.bearing} of [[${np.anchor}]]` : '';
    L.push(`**Where:** [[${c.destination}]]${np && interactive && !np.kept ? ' *(new place)*' : ''}${what}${interactive ? ` <button class="mini-reroll" data-part="${i}:place" title="A different place">↻</button>` : ''}  `);
  }
  L.push(`**Open to:** ${c.tier} rank and above${tag}  `);
  L.push(`**Client:** ${c.client}${re('client', 'New client')}  `);
  L.push(`**Reward:** ${formatCoins(c.reward)} (${formatGp(c.reward)})${re('reward', 'New reward')}  `);
  L.push(`**Deadline:** ${capSentence(c.deadline)}${c.requirement ? `  \n**Requirement:** ${c.requirement}` : ''}${c.bonus ? `  \n**Bonus:** ${c.bonus}${c.bonusItem && !interactive ? ` [${c.bonusItem.gear ? 'Give to a party member' : 'Add to the party inventory'}](#bonus-${c.bonusItem.gear ? 'gear' : 'party'}-${encodeURIComponent(c.bonusItem.name).replace(/[()']/g, ch => `%${ch.charCodeAt(0).toString(16)}`)})` : ''}` : ''}${re('terms', 'New terms')}  `);
  L.push(`**Proof of completion:** ${c.proof}${re('proof', 'New proof')}`, '');
  L.push(':::dm');
  L.push(`- **The truth:** ${c.details}${re('details', 'New detail')}`);
  L.push(`- **Complication:** ${c.complication}${re('complication', 'New complication')}`);
  L.push(`- **Twist:** ${c.twist}${re('twist', 'New twist')}`);
  if (c.showMonster) {
    const m = c.monster;
    L.push(`- **Monster:** [[${m.base || m.name} (monster)|${m.name}]] (CR ${crLabel(m.cr)}, ${m.rank}${m.base ? `, ${article(m.base.toLowerCase())} spawned at ${m.rank} rank` : ''})${re('monster', 'New monster')}${m.variant ? `. ${variantSummary(m.variant)}` : ''}`);
  }
  L.push(':::', '');
  return L;
}

export function contractsToMarkdown(r, { interactive = false } = {}) {
  const re = (part, label) => interactive ? ` <button class="mini-reroll" data-part="${part}" title="${label}">↻</button>` : '';
  const L = [];
  L.push(`*The Adventure Society contract board${r.where ? ` in [[${r.where}]]` : ''}.* ${r.dressing}${re('dressing', 'New look')}`, '');
  L.push(`**Rule of the board:** ${r.rule || 'A team may take any contract of its own rank or lower, never higher.'}`, '');
  r.contracts.forEach((c, i) => L.push(...contractMd(c, i, { interactive, partyRank: r.partyRank })));
  if (interactive) L.push(`<button class="mini-reroll" data-part="add" title="Pin another notice to the board">+ Another notice</button>`, '');
  return L.join('\n');
}

/** One contract as its own page, once the party takes it. */
export function contractToMarkdown(c, where = null) {
  const L = [`*${capSentence(article(c.tier))} contract taken from the Adventure Society board${where ? ` in [[${where}]]` : ''}.*`, ''];
  L.push(...contractMd(c, 0, { heading: '##' }).slice(2));
  L.push('## Progress', '', '- Taken by:', '- Outcome:', '');
  return L.join('\n');
}

// ---------- essence loot ----------
// Every generator draws essences from the compendium: themes are its affinities, and loot is one of its essences.

/** The themes generators offer: the compendium's affinities, or the older essence list if a campaign lacks the compendium. */
export function essenceThemes(data) {
  return data.compendium ? Object.keys(data.compendium.affinities) : list(data.essences?.essences).map(e => e.name);
}

/** Stone spells for a theme, by spell level. */
export function themeStoneSpells(data, theme) {
  return data.compendium?.affinities[theme]?.stoneSpells || list(data.essences?.essences).find(e => e.name === theme)?.stoneSpells || {};
}

/** A compendium essence that fits the theme, as rare as the rank allows. */
export function lootEssence(data, theme, rank, rng, rarities = null) {
  const comp = data.compendium;
  if (!comp) return theme ? { name: theme, rarity: '', affinity: theme } : null;
  const rw = RARITY_WEIGHTS[rank] || RARITY_WEIGHTS.Iron;
  // `rarities` limits the pick, as a settlement's shops or an auction house do.
  const pool = comp.essences.filter(e => (!theme || e.affinity === theme) && (rw[e.rarity] ?? 1) > 0 && (!rarities || rarities.includes(e.rarity)));
  return pool.length ? weighted(rng, pool, e => rw[e.rarity] ?? 1) : null;
}

/** Everything the app knows about an essence by name: a divine essence, a compendium essence, or one of the older basic essences. */
export function essenceInfo(data, name) {
  const key = String(name || '').trim().toLowerCase();
  if (!key) return null;
  const d = list(data.divine?.essences).find(x => x.name.toLowerCase() === key);
  if (d) return { name: d.name, kind: 'divine', affinity: d.affinity, rarity: 'divine', theme: d.theme, trait: d.grant, stoneSpells: d.stoneSpells, divine: d };
  const c = list(data.compendium?.essences).find(x => x.name.toLowerCase() === key);
  if (c) return { name: c.name, kind: 'compendium', affinity: c.affinity, rarity: c.rarity, theme: c.theme, trait: c.grant, stoneSpells: data.compendium.affinities[c.affinity]?.stoneSpells || {} };
  const b = list(data.essences?.essences).find(x => x.name.toLowerCase() === key);
  if (b) return { name: b.name, kind: 'basic', affinity: b.name, rarity: '', theme: b.theme, trait: { type: 'proficiency', text: `Choose ${b.traits.join(' or ')}.` }, stoneSpells: b.stoneSpells };
  return { name: String(name).trim(), kind: 'unknown', stoneSpells: {} };
}

/**
 * A player character's rank. Level only suggests a rank: until all three essence slots hold a live essence the
 * character is Normal rank, and a full set makes them at least Iron.
 */
export function pcRank(m) {
  const revoked = list(m?.revoked);
  const held = list(m?.essences).filter(e => e && !revoked.includes(e)).length;
  if (held < 3) return 'Normal';
  const r = rankForLevel(Number(m?.level) || 1);
  return r === 'Normal' ? 'Iron' : r;
}

/**
 * What a sheet still needs for the confluence its player is aiming for: for each empty slot, the affinity (or, for a
 * divine confluence, the exact essence) that would complete it. fits is false when a held essence can't be part of it.
 */
export function confluenceNeeds(data, m) {
  const conf = confluenceInfo(data, m?.confluence);
  if (!conf) return null;
  const revoked = list(m.revoked);
  const slots = [0, 1, 2].map(i => (m.essences?.[i] && !revoked.includes(m.essences[i]) ? m.essences[i] : ''));
  const held = slots.filter(Boolean);
  if (held.length === 3) return null;
  const empty = [0, 1, 2].filter(i => !slots[i] && !m.essences?.[i]);
  const out = { name: conf.name, divine: !!conf.divine, fits: true, slots: {} };
  if (conf.divine) {
    const overlap = r => r.filter(n => held.includes(n)).length;
    const recipe = [...list(conf.recipes)].sort((a, b) => overlap(b) - overlap(a))[0] || [];
    const missing = recipe.filter(n => !held.includes(n));
    out.fits = held.every(n => recipe.includes(n));
    empty.forEach((i, j) => { if (missing[j]) out.slots[i] = { essence: missing[j] }; });
    return out;
  }
  const trio = Object.entries(data.compendium?.trios || {}).find(([, v]) => v === conf.name)?.[0].split('+') || list(conf.affinities);
  const need = [...trio];
  for (const n of held) {
    const k = need.indexOf(essenceInfo(data, n)?.affinity);
    if (k >= 0) need.splice(k, 1); else out.fits = false;
  }
  empty.forEach((i, j) => { if (need[j]) out.slots[i] = { affinity: need[j] }; });
  return out;
}

/**
 * A wiki NPC's stat block (the `<div class="statblock">` markdown on its page) as a bestiary-style monster, so the
 * NPC can join a battle with its numbers and roll its attacks. Null when the page has no stat block.
 */
export function statFromNpcPage(meta, body) {
  const block = String(body || '').match(/<div class="statblock">([\s\S]*?)<\/div>/)?.[1];
  if (!block) return null;
  const strip = t => String(t).replace(/\*\*\*|\*\*|\*/g, '').replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1').trim();
  const field = name => strip(block.match(new RegExp(`\\*\\*${name}\\*\\*\\s*([^\\n]*?)\\s*$`, 'mi'))?.[1].replace(/\s*·.*$/, '') || '');
  const sub = block.match(/^\*([^*\n]+)\*\s*$/m)?.[1] || '';
  const row = block.match(/\|\s*:?-+:?\s*\|[^\n]*\n\|([^\n]+)\|/);
  const abilities = row ? row[1].split('|').map(c => Number(c.match(/\d+/)?.[0]) || 10).slice(0, 6) : [10, 10, 10, 10, 10, 10];
  const hp = field('Hit Points');
  // Each "#### Heading" section's ***Name.*** entries; bonus actions join the actions with their name marked.
  const sections = {};
  for (const part of block.split(/^####\s+/m).slice(1)) {
    const [head, ...rest] = part.split('\n');
    const text = rest.join('\n');
    // Spells are the italic names in an entry ("*fire bolt*"), so a spellcaster's spells roll in battle.
    const italics = t => [...String(t).matchAll(/(?<!\*)\*([^*\n]+)\*(?!\*)/g)].map(x => strip(x[1]).replace(/\[\[|\]\]/g, ''));
    const entries = [...text.matchAll(/\*\*\*(.+?)\.?\*\*\*\s*([\s\S]*?)(?=\n\s*\*\*\*|$)/g)].map(x => ({ name: strip(x[1]).replace(/\.$/, ''), desc: strip(x[2].replace(/\n\s*-\s+/g, '; ').replace(/\s*\n\s*/g, ' ')), spells: italics(x[2]) }));
    sections[head.trim().toLowerCase()] = { entries, text: strip(text.replace(/\n+/g, ' ')), spells: italics(text) };
  }
  const traits = [...list(sections.traits?.entries)];
  if (sections['awakening stones']?.text) traits.push({ name: 'Awakening stones', desc: sections['awakening stones'].text.replace(/\s+-\s+/g, '; ').replace(/\.\s*;\s*/g, '. ').replace(/\s{2,}/g, ' '), spells: sections['awakening stones'].spells });
  const actions = [...list(sections.actions?.entries), ...list(sections['bonus actions']?.entries).map(a => ({ ...a, name: `${a.name} (bonus action)` }))];
  const challenge = field('Challenge');
  const cr = challenge ? (challenge.match(/^(\d+)\/(\d+)/) ? Number(RegExp.$1) / Number(RegExp.$2) : Number(challenge.match(/[\d.]+/)?.[0]) || 0) : 0;
  return {
    name: meta?.title || strip(block.match(/^###\s+(.+)$/m)?.[1] || 'NPC'),
    size: sub.split(/\s+/)[0] || 'Medium', type: sub.replace(/^\S+\s+/, ''), alignment: '',
    ac: field('Armor Class') || '10', hp: Number(hp.match(/\d+/)?.[0]) || 1, hitDice: (hp.match(/\(([^)]+)\)/)?.[1] || '').replace(/\s+/g, ''),
    speed: field('Speed'), abilities, saves: field('Saving Throws'), skills: field('Skills'), senses: field('Senses'), languages: field('Languages'),
    resist: field('Damage Resistances'), immune: field('Damage Immunities'), conditionImmune: field('Condition Immunities'), vulnerable: field('Damage Vulnerabilities'),
    cr, xp: Number(challenge.match(/\(([\d,]+) XP\)/)?.[1].replace(/,/g, '')) || undefined,
    rank: RANKS.includes(meta?.rank) ? meta.rank : sub.match(/\b(Normal|Iron|Bronze|Silver|Gold|Diamond) rank/i)?.[1] || undefined,
    level: Number(sub.match(/\b[a-z]+ (\d+)\b/i)?.[1]) || undefined,
    traits, actions, reactions: list(sections.reactions?.entries), npcPage: true,
  };
}

/** A random compendium essence of one affinity, leaving out any the character already holds or carries. */
export function randomEssenceOf(data, affinity, avoid = [], rng = Math.random) {
  const skip = new Set(list(avoid).map(n => String(n).toLowerCase()));
  const pool = list(data.compendium?.essences).filter(e => e.affinity === affinity && !skip.has(e.name.toLowerCase()));
  return pool.length ? pick(rng, pool).name : null;
}

/** The confluence three essences form, if all three are in the compendium or divine lists. */
export function sheetConfluence(data, names) {
  const infos = names.map(n => essenceInfo(data, n));
  if (infos.length !== 3 || !data.compendium || infos.some(i => !i || !['divine', 'compendium'].includes(i.kind))) return null;
  return findCompendiumConfluence(withDivine(data.compendium, data.divine), infos.map(i => ({ name: i.name, affinity: i.affinity })));
}

export function confluenceInfo(data, name) {
  const key = String(name || '').trim().toLowerCase();
  return [...list(data.divine?.confluences), ...list(data.compendium?.confluences)].find(c => c.name.toLowerCase() === key) || null;
}

/**
 * Every power a party member's essences give, for the sheet: each essence's trait, a divine essence's
 * Sense, Channel and Blessing (kept under `aura` in the data), and the confluence's grant. Powers from a revoked essence, and a confluence
 * without three live essences, are marked lost.
 */
export function sheetPowers(data, { essences = [], revoked = [], confluence = '', level = 1 } = {}) {
  const out = [];
  const gone = new Set([].concat(revoked));
  const grantName = g => g?.name || (g?.type === 'proficiency' ? 'Proficiency' : 'Trait');
  for (const name of [].concat(essences).filter(Boolean)) {
    const info = essenceInfo(data, name);
    const lost = gone.has(name);
    if (info.trait) out.push({ name: grantName(info.trait), from: info.name, text: info.trait.text, lost });
    const d = info.divine;
    if (!d) continue;
    out.push({ name: d.sense.name, from: info.name, uses: '1 + Wisdom modifier per long rest', text: d.sense.text, lost });
    out.push({ name: d.channel.name, from: info.name, uses: `${proficiencyBonus(level)} per long rest`, text: d.channel.text, lost });
    if (level >= 5) out.push({ name: d.aura.name, from: info.name, uses: level >= 17 ? '2 per short rest' : '1 per short rest', text: d.aura.text, lost });
  }
  const c = confluence && confluenceInfo(data, confluence);
  if (c?.grant) {
    const live = [].concat(essences).filter(e => e && !gone.has(e)).length;
    out.push({ name: grantName(c.grant), from: `${c.name} confluence`, text: c.grant.text, lost: live < 3, confluence: true });
  }
  return out;
}

// ---------- essence browser ----------

export const RARITIES = ['common', 'uncommon', 'rare', 'legendary', 'divine'];

/** Every essence the app knows, divine first, as the browser lists them. `hide` names divine essences to leave out. */
export function essenceCatalog(data, hide = []) {
  const out = [];
  for (const d of list(data.divine?.essences)) if (!hide.includes(d.name)) out.push({ ...essenceInfo(data, d.name), god: d.god, church: d.church, called: d.called });
  for (const c of list(data.compendium?.essences)) out.push({ ...essenceInfo(data, c.name), description: c.description, manifests: c.manifests });
  return out;
}

/** An affinity or rarity filter: one value, a list of values, or nothing for all. */
const allows = (want, v) => Array.isArray(want) ? !want.length || want.includes(v) : !want || want === v;

/** Filter the catalog by a search (name, theme, affinity, trait, god), and by affinities and rarities (one or several). */
export function filterEssences(items, { q = '', affinity = '', rarity = '' } = {}) {
  const words = String(q).toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter(e => allows(affinity, e.affinity) && allows(rarity, e.rarity) &&
    words.every(w => [e.name, e.theme, e.affinity, e.trait?.name, e.trait?.text, e.god, e.description].join(' ').toLowerCase().includes(w)));
}

/** Every confluence, divine first, with the affinity trio that forms it and any exact recipes. */
export function confluenceCatalog(data, hide = []) {
  const comp = data.compendium;
  if (!comp) return [];
  const trioOf = new Map(Object.entries(comp.trios).map(([k, v]) => [v, k.split('+')]));
  const recipes = new Map();
  for (const c of comp.combos) recipes.set(c.result, [...(recipes.get(c.result) || []), c.essences]);
  return [
    ...list(data.divine?.confluences).filter(c => !c.recipes.some(r => r.some(n => hide.includes(n))))
      .map(c => ({ ...c, recipes: c.recipes, trio: null })),
    ...comp.confluences.map(c => ({ ...c, recipes: recipes.get(c.name) || [], trio: trioOf.get(c.name) || c.affinities || null })),
  ];
}

/**
 * An affinity trio in words, so a repeated affinity never reads as the same essence twice:
 * ['Fire', 'Fire', 'Sin'] is "two different Fire-affinity essences and one Sin-affinity essence".
 */
export function trioText(trio) {
  const counts = new Map();
  for (const a of trio || []) counts.set(a, (counts.get(a) || 0) + 1);
  const parts = [...counts].map(([a, n]) => (n === 1 ? `one ${a}-affinity essence` : `${n === 2 ? 'two' : 'three'} different ${a}-affinity essences`));
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0] || '';
}

export function filterConfluences(items, { q = '', affinity = '', rarity = '' } = {}) {
  const words = String(q).toLowerCase().split(/\s+/).filter(Boolean);
  const affs = [].concat(affinity || []);
  return items.filter(c => (!affs.length || affs.some(a => (c.trio || c.affinities || []).includes(a))) && (![].concat(rarity || []).includes('divine') || c.divine) &&
    words.every(w => [c.name, c.theme, c.grant?.name, c.grant?.text, c.god, (c.trio || []).join(' '), c.recipes.flat().join(' ')].join(' ').toLowerCase().includes(w)));
}

// ----- spells -----
// data.spells.spells is keyed by lowercase name. SRD spells carry their rules text; the rest a summary in our words.

const aliasCache = new WeakMap();
function spellAliases(data) {
  const all = data.spells?.spells || {};
  let m = aliasCache.get(all);
  if (!m) {
    m = new Map();
    for (const [k, s] of Object.entries(all)) for (const a of list(s.aliases)) m.set(a.toLowerCase(), k);
    aliasCache.set(all, m);
  }
  return m;
}

/** A spell by name or alias ("Leomund's tiny hut" finds Tiny Hut), with its key; null if unknown. */
export function spellInfo(data, name) {
  const all = data?.spells?.spells || {};
  const n = String(name || '').trim().toLowerCase().replace(/^\*|\*$/g, '');
  const key = all[n] ? n : spellAliases(data).get(n);
  return key ? { ...all[key], key, name: all[key].name || cap(key) } : null;
}

export const SPELL_SCHOOLS = ['abjuration', 'conjuration', 'divination', 'enchantment', 'evocation', 'illusion', 'necromancy', 'transmutation'];

/** "Cantrip", "1st level" ... "9th level". */
export function spellLevelText(level) {
  const l = Number(level) || 0;
  return l === 0 ? 'Cantrip' : `${l}${l === 1 ? 'st' : l === 2 ? 'nd' : l === 3 ? 'rd' : 'th'} level`;
}

/** "3rd-level evocation (ritual)" or "Evocation cantrip". */
export function spellKindText(s) {
  const kind = Number(s.level) ? `${spellLevelText(s.level).replace(' ', '-')} ${s.school || ''}`.trim() : `${cap(s.school || '')} cantrip`.trim();
  return kind + (s.ritual ? ' (ritual)' : '');
}

/** Every spell, sorted by name. */
export function spellCatalog(data) {
  return Object.entries(data?.spells?.spells || {}).map(([key, s]) => ({ ...s, key, name: s.name || cap(key) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** All the classes on the spell list, sorted. */
export function spellClasses(items) {
  return [...new Set(items.flatMap(s => list(s.classes)))].sort();
}

/** f: q (name, summary, text), levels, schools, classes (any of), flags ('concentration', 'ritual', 'srd'). */
export function filterSpells(items, f = {}) {
  const words = String(f.q || '').toLowerCase().split(/\s+/).filter(Boolean);
  const levels = list(f.levels).map(Number), schools = list(f.schools), classes = list(f.classes), flags = list(f.flags);
  return items.filter(s => (!levels.length || levels.includes(Number(s.level)))
    && (!schools.length || schools.includes(s.school))
    && (!classes.length || list(s.classes).some(c => classes.includes(c)))
    && (!flags.includes('concentration') || s.concentration) && (!flags.includes('ritual') || s.ritual)
    && (!flags.includes('srd') || /^SRD/.test(s.source || ''))
    && words.every(w => [s.name, ...list(s.aliases), s.summary, s.text, s.material, s.school, list(s.classes).join(' ')].join(' ').toLowerCase().includes(w)));
}

// ----- bestiary -----
// data.bestiary.monsters: full stat blocks, keyed by lowercase name. The encounter list (monsters.json) names monsters by the same names.

/** A monster's stat block by name; null if the bestiary has none. */
export function monsterInfo(data, name) {
  const all = data?.bestiary?.monsters || {};
  const n = String(name || '').trim().toLowerCase();
  return all[n] ? { key: n, ...all[n] } : null;
}

// ----- ranked variants -----
// A creature's kind doesn't fix its rank: an Iron-rank ape can spawn steeped in more magic as a Silver-rank one,
// with the numbers of a Silver-rank creature and a new name and look. Stats are rebuilt against the
// Dungeon Master's Guide table of expected statistics by challenge rating.

// CR: [proficiency, AC, hit points, attack bonus, damage per round, save DC]
const CR_STATS = {
  0: [2, 13, 4, 3, 1, 13], 0.125: [2, 13, 21, 3, 2.5, 13], 0.25: [2, 13, 42, 3, 4.5, 13], 0.5: [2, 13, 60, 3, 7, 13],
  1: [2, 13, 78, 3, 11, 13], 2: [2, 13, 93, 3, 17, 13], 3: [2, 13, 108, 4, 23, 13], 4: [2, 14, 123, 5, 29, 14],
  5: [3, 15, 138, 6, 35, 15], 6: [3, 15, 153, 6, 41, 15], 7: [3, 15, 168, 6, 47, 15], 8: [3, 16, 183, 7, 53, 16],
  9: [4, 16, 198, 7, 59, 16], 10: [4, 17, 213, 7, 65, 16], 11: [4, 17, 228, 8, 71, 17], 12: [4, 17, 243, 8, 77, 17],
  13: [5, 18, 258, 8, 83, 18], 14: [5, 18, 273, 8, 89, 18], 15: [5, 18, 288, 8, 95, 18], 16: [5, 18, 303, 9, 101, 18],
  17: [6, 19, 318, 10, 107, 19], 18: [6, 19, 333, 10, 113, 19], 19: [6, 19, 348, 10, 119, 19], 20: [6, 19, 378, 10, 132, 19],
  21: [7, 19, 423, 11, 150, 20], 22: [7, 19, 468, 11, 168, 20], 23: [7, 19, 513, 11, 186, 20], 24: [7, 19, 558, 12, 204, 21],
  25: [8, 19, 603, 12, 222, 21], 26: [8, 19, 648, 12, 240, 21], 27: [8, 19, 693, 13, 258, 22], 28: [8, 19, 738, 13, 276, 22],
  29: [9, 19, 783, 13, 294, 22], 30: [9, 19, 828, 14, 312, 23],
};
/** The challenge ratings of each rank, from rankForCR. */
export const RANK_CR = { Iron: [0, 4], Bronze: [5, 10], Silver: [11, 16], Gold: [17, 20], Diamond: [21, 30] };
const RANK_ORDER = ['Iron', 'Bronze', 'Silver', 'Gold', 'Diamond'];
const statsFor = cr => CR_STATS[cr] ?? CR_STATS[Math.max(0, Math.min(30, Math.round(cr)))];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** The rank gap: a monster of this rank resists damage from anyone of a lower rank, which cancels out a vulnerability. */
export function rankWardText(rank, vulnerable) {
  if (!rank || rank === 'Iron' || rank === 'Normal') return '';
  return `It is resistant to damage from the attacks, spells and abilities of creatures below ${rank} rank${vulnerable ? `, except ${String(vulnerable).replace(/, ([^,]+)$/, ' and $1')} damage, which it is vulnerable to and so takes normally` : ', unless the damage is of a type it is vulnerable to, which it takes normally'}.`;
}

/** The look of a creature that spawned above its usual rank: a name word, how it looks and a quirk. */
function variantFlavour(data, m, rank, rng) {
  const V = data.variants || {};
  const type = monsterType(m);
  const byType = V.byType?.[type]?.[rank] || {};
  const themes = (list(data.monsters?.monsters).find(x => x.name.toLowerCase() === m.name.toLowerCase())?.themes || []).filter(t => V.byAffinity?.[t]);
  const aff = themes.length && chance(rng, 0.4) ? V.byAffinity[pick(rng, themes)] : null;
  const prefixes = list(aff?.prefixes).length ? aff.prefixes : list(byType.prefixes);
  const looks = [...list(byType.looks), ...list(aff?.looks)];
  const fallback = { Bronze: 'Bronze-Touched', Silver: 'Silverback', Gold: 'Gilded', Diamond: 'Diamond-Hearted' }[rank];
  return {
    prefix: prefixes.length ? pick(rng, prefixes) : fallback,
    look: scaleText(looks.length ? pick(rng, looks) : `Its body shows the magic of ${aOrAn(rank)} ${rank}-rank creature: brighter, larger and harder to look at than its kin.`, rank),
    quirk: list(byType.quirks).length ? scaleText(pick(rng, byType.quirks), rank) : '',
  };
}

/**
 * A monster spawned at a higher rank: its stat block rebuilt for challenge rating `cr`, with a new name, look and quirk.
 * Returns the plain stat block when it is already that strong.
 */
export function rankUp(data, name, cr, rng = Math.random) {
  const m = monsterInfo(data, name);
  if (!m) return null;
  const oldCR = Number(m.cr) || 0;
  cr = Number(cr);
  const rank = rankForCR(cr);
  if (cr <= oldCR || RANK_ORDER.indexOf(rank) <= RANK_ORDER.indexOf(rankForCR(oldCR))) return m;
  const [profO, acO, hpO, atkO, dprO, dcO] = statsFor(oldCR);
  const [profN, acN, hpN, atkN, dprN, dcN] = statsFor(cr);
  const steps = RANK_ORDER.indexOf(rank) - RANK_ORDER.indexOf(rankForCR(oldCR));
  const flav = variantFlavour(data, m, rank, rng);
  // Hit points follow the table for the new challenge rating, scaled by how tough the creature was for its own: a frail
  // one stays frailer than a sturdy one (without the floor every weak creature landed on the same number).
  const hp = Math.round(hpN * clamp(0.7 + 0.3 * (m.hp / hpO), 0.7, 1.3));
  const acBase = parseInt(m.ac, 10) || acO;
  const ac = Math.max(acBase + steps, acN + clamp(acBase - acO, -1, 2));
  const atkShift = (atkN + clamp(0, -2, 2)) - atkO;
  const dcShift = dcN - dcO;
  const modShift = steps;
  // How many attacks a turn, from its Multiattack, so the damage per round lands near the table's.
  const words = { two: 2, three: 3, four: 4, five: 5, six: 6 };
  const multi = list(m.actions).find(a => /^Multiattack/i.test(a.name));
  const attacks = multi ? Math.max(1, ...[...multi.desc.toLowerCase().matchAll(/\b(two|three|four|five|six)\b/g)].map(x => words[x[1]])) : 1;
  const hitAvg = a => [...a.desc.matchAll(/(\d+) \((\d+)d(\d+)(?: ?([+-]) ?(\d+))?\)/g)].reduce((n, x) => n + Number(x[1]), 0);
  const strongest = Math.max(1, ...list(m.actions).map(hitAvg));
  const perAttack = dprN / attacks;
  const scaleDesc = (desc, own) => {
    let d = String(desc);
    const share = own ? own / strongest : 1;
    const target = perAttack * share;
    const factor = own ? target / own : 1;
    d = d.replace(/(\d+) \((\d+)d(\d+)(?: ?([+-]) ?(\d+))?\)/g, (all, avg, n, sides, sign, mod) => {
      const z = (sign === '-' ? -1 : 1) * Number(mod || 0) + (mod ? modShift : 0);
      const want = Number(avg) * factor;
      const dice = Math.max(1, Math.round((want - z) / ((Number(sides) + 1) / 2)));
      const mean = Math.floor(dice * (Number(sides) + 1) / 2 + z);
      return `${mean} (${dice}d${sides}${z ? ` ${z < 0 ? '-' : '+'} ${Math.abs(z)}` : ''})`;
    });
    d = d.replace(/([+-])(\d+) to hit/g, (all, sign, n) => { const v = (sign === '-' ? -1 : 1) * Number(n) + atkShift; return `${v < 0 ? '-' : '+'}${Math.abs(v)} to hit`; });
    d = d.replace(/DC (\d+)/g, (all, n) => `DC ${Number(n) + dcShift}`);
    return d;
  };
  const block = list => (list || []).map(a => ({ ...a, desc: scaleDesc(a.desc, hitAvg(a)) }));
  const bump = text => String(text || '').replace(/([+-])(\d+)/g, (all, sign, n) => { const v = (sign === '-' ? -1 : 1) * Number(n) + (profN - profO) + steps; return `${v < 0 ? '-' : '+'}${Math.abs(v)}`; });
  const abilities = list(m.abilities).map((v, i) => i < 3 ? Math.min(30, v + 2 * steps) : v);
  const traits = [
    { name: `${rank}-Rank Spawn`, desc: `${flav.look} ${flav.quirk}`.trim() },
    ...block(m.traits),
  ];
  const conMod = Math.floor((abilities[2] - 10) / 2);
  const die = Number(String(m.hitDice || '').match(/d(\d+)/)?.[1]) || 8;
  const hd = Math.max(1, Math.round(hp / ((die + 1) / 2 + conMod)));
  return {
    ...m,
    name: `${flav.prefix} ${m.name}`.replace(/\b(\w+) \1\b/i, "Elite $1"),
    variantOf: m.name, baseCR: oldCR, rank,
    cr, xp: CR_XP[cr] ?? m.xp, hp, hitDice: `${hd}d${die}${conMod ? `${conMod < 0 ? '-' : '+'}${Math.abs(conMod * hd)}` : ''}`,
    ac: `${ac}${String(m.ac).replace(/^\d+/, '')}`,
    abilities, saves: bump(m.saves), skills: bump(m.skills),
    traits, actions: block(m.actions), reactions: block(m.reactions), legendary: block(m.legendary),
    look: flav.look, quirk: flav.quirk,
  };
}

/** A variant's key numbers as markdown, for saved encounter pages. */
export function variantSummary(v) {
  const hits = list(v.actions).map(a => a.desc.match(/([+-]\d+) to hit/)?.[1]).filter(Boolean);
  return `**${v.name}** (${article(`${v.rank}-rank`)} ${v.variantOf.toLowerCase()}, CR ${crLabel(v.cr)}): AC ${parseInt(v.ac, 10)}, ${v.hp} hit points, ${hits.length ? `attacks ${hits[0]} to hit, ` : ''}damage, save DCs and abilities raised to its rank. ${v.look}${v.quirk ? ` ${v.quirk}` : ''} ${rankWardText(v.rank, v.vulnerable)}`.trim();
}

export function bestiaryCatalog(data) {
  return Object.entries(data?.bestiary?.monsters || {}).map(([key, m]) => ({ ...m, key, rank: rankForCR(Number(m.cr) || 0) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The creature types in the bestiary ("humanoid (goblinoid)" counts as humanoid). */
export function monsterType(m) { return String(m.type || '').split(' (')[0].toLowerCase(); }
export function monsterTypes(items) { return [...new Set(items.map(monsterType))].filter(Boolean).sort(); }

/** f: q (name, type, traits, actions), ranks, types. */
export function filterMonsters(items, f = {}) {
  const words = String(f.q || '').toLowerCase().split(/\s+/).filter(Boolean);
  const ranks = list(f.ranks), types = list(f.types);
  return items.filter(m => (!ranks.length || ranks.includes(m.rank)) && (!types.length || types.includes(monsterType(m)))
    && words.every(w => [m.name, m.type, m.alignment, ...['traits', 'actions', 'reactions', 'legendary'].flatMap(k => list(m[k]).map(a => a.name + ' ' + a.desc))].join(' ').toLowerCase().includes(w)));
}

/** "+3" for a score of 16. */
export function abilityMod(score) {
  const m = Math.floor((Number(score) - 10) / 2);
  return m >= 0 ? `+${m}` : String(m);
}

// ----- awakening stones -----
// A stone carries one spell of an affinity's list (or a divine essence's own list) and awakens on any essence of
// that affinity (or on that divine essence). Its level sets the rank needed to use it, and its price.

export const STONE_RANK = { 1: 'Iron', 2: 'Bronze', 3: 'Silver', 4: 'Gold', 5: 'Diamond' };
const STONE_PRICE = { 1: 150, 2: 600, 3: 2500, 4: 10000, 5: 40000 };

/** Every awakening stone: one per affinity and spell, then the divine essences' own. `hide` names divine essences to leave out. */
export function stoneCatalog(data, hide = []) {
  const price = l => data.market?.prices?.stone?.[l] ?? STONE_PRICE[l];
  const spell = n => spellInfo(data, n);
  const out = [];
  for (const [aff, a] of Object.entries(data.compendium?.affinities || {})) {
    for (const [l, spells] of Object.entries(a.stoneSpells || {})) for (const sp of spells) {
      out.push({ id: `${aff}: ${sp}`, name: `${aff} awakening stone (${sp})`, affinity: aff, spell: sp, level: Number(l), rank: STONE_RANK[l], price: price(l), info: spell(sp), essences: list(data.compendium.essences).filter(e => e.affinity === aff).length });
    }
  }
  for (const d of list(data.divine?.essences)) {
    if (hide.includes(d.name)) continue;
    for (const [l, spells] of Object.entries(d.stoneSpells || {})) for (const sp of spells) {
      out.push({ id: `${d.name}: ${sp}`, name: `${d.name} awakening stone (${sp})`, affinity: d.affinity, divine: d.name, spell: sp, level: Number(l), rank: STONE_RANK[l], price: price(l), info: spell(sp), essences: 1 });
    }
  }
  return out;
}

/** f: q (search spell, affinity, summary), affinity and level (one value or a list), divine ('only', 'none' or all). */
export function filterStones(items, { q = '', affinity = '', level = '', divine = '' } = {}) {
  const words = String(q).toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter(s => allows(affinity, s.affinity) && allows([].concat(level || []).map(Number), s.level)
    && (divine !== 'only' || s.divine) && (divine !== 'none' || !s.divine)
    && words.every(w => [s.spell, s.affinity, s.divine, s.info?.summary, s.info?.school].join(' ').toLowerCase().includes(w)));
}

/**
 * The confluences an essence can be part of: exact recipes naming it (with the other two essences),
 * and the affinity trios its affinity belongs to (with the other two affinities).
 */
export function confluencesFor(data, name) {
  const info = essenceInfo(data, name);
  const comp = data.compendium;
  if (!info || !comp) return { recipes: [], trios: [] };
  const recipes = [];
  for (const c of [...list(data.divine?.confluences).flatMap(c => c.recipes.map(r => ({ essences: r, result: c.name }))), ...comp.combos]) {
    const i = c.essences.indexOf(info.name);
    if (i >= 0) recipes.push({ name: c.result, with: c.essences.filter((_, j) => j !== i) });
  }
  const trios = [];
  for (const [key, result] of Object.entries(comp.trios)) {
    const parts = key.split('+');
    const i = parts.indexOf(info.affinity);
    if (i >= 0) trios.push({ name: result, with: parts.filter((_, j) => j !== i) });
  }
  return { recipes, trios };
}

export const essenceLabel = e => e.rarity ? `${e.name} essence (${e.rarity}, ${e.affinity})` : `${e.name} essence`;

export function encounterLines(e) {
  if (!e.groups.length) return ['No monsters on the list fit this budget. Add more to the monster list or change the theme.'];
  return e.groups.map(g => `${g.count} × ${g.stat ? `[[${g.base || g.name} (monster)|${g.name}]]` : g.name} (CR ${crLabel(g.cr)}, ${g.rank}${g.base ? `, ${article(g.base.toLowerCase())} spawned at ${g.rank} rank` : ''})`);
}

/** A link that puts every monster in the encounter on the battle screen (the app shows it as a button). */
export function battleLink(e) {
  const groups = e.groups.map(g => ({ k: g.count, m: g.base || g.name, c: g.cr, ...(g.base ? { n: g.name } : {}) }));
  return groups.length ? `[Add to battle](#battle-${encodeURIComponent(JSON.stringify(groups)).replace(/\(/g, '%28').replace(/\)/g, '%29')})` : '';
}
/** Read one of those links back: [{ count, monster, cr, name? }]. */
export function battleGroups(href) {
  try { return JSON.parse(decodeURIComponent(String(href).replace(/^#battle-/, ''))).map(g => ({ count: Number(g.k) || 1, monster: g.m, cr: g.c, name: g.n })); } catch { return []; }
}

const ENC_LABEL = { why: 'Why here', want: 'What they want', feature: 'The ground', tactics: 'How they fight', morale: 'When they break', reinforce: 'Who else comes', exit: 'A way out without a fight' };

/** How a generated encounter came about, kept with the battle it starts so the session notes can say. */
export function encounterOrigin(e) {
  const d = e.details || {};
  return {
    how: `A random ${e.difficulty || ''} encounter${e.terrain ? ` in ${e.terrain.toLowerCase()} country` : ''}, rolled in the encounter generator`.replace(/  +/g, ' '),
    ...(e.where ? { where: e.where } : {}),
    ...(e.situation ? { situation: e.situation } : {}),
    ...(d.nonFight ? { nonFight: `${d.nonFight.name}. ${d.nonFight.text}` } : {}),
    ...Object.fromEntries(['why', 'want'].filter(k => d[k]).map(k => [k, d[k]])),
  };
}

/** opts.interactive adds the ↻ and ± buttons the generator uses. */
export function encounterToMarkdown(e, title = 'Encounter', opts = {}) {
  const lines = [];
  const it = !!opts.interactive;
  const re = (part, label) => it ? ` <button class="mini-reroll" data-enc="${part}" title="${label}">↻</button>` : '';
  const d = e.details;
  lines.push(`**${capitalize(e.difficulty)} encounter** for ${e.partySize} character${e.partySize === 1 ? '' : 's'} of level ${e.level}${e.terrain ? `, ${e.terrain.toLowerCase()}` : ''}${e.theme && e.theme !== 'any' ? `, ${e.theme} theme` : ''}. XP ${e.spent} of a ${e.budget} budget.${e.asked ? ` Nothing on the list came closer to a ${e.asked} fight.` : ''}`);
  const warded = e.partyRank ? e.groups.filter(g => rankWardApplies(e.partyRank, g.rank)) : [];
  if (warded.length) lines.push('', `*Rank ward:* the party is ${e.partyRank} rank, so ${warded.map(g => `the ${g.rank}-rank ${(g.base || g.name).toLowerCase()}`).join(' and ')} ${warded.length > 1 ? 'resist' : 'resists'} their damage (half). It counts double in the difficulty.`);
  lines.push('');
  if (d?.nonFight) lines.push(`**Not a fight yet: ${d.nonFight.name}.** ${d.nonFight.text}${re('nonFight', 'Something else, or a straight fight')}`, '');
  else if (it && d) lines.push(`<button class="mini-reroll" data-enc="nonFight" title="Make it a stand-off, a parley, a chase or something else">Not a fight?</button>`, '');
  if (it) for (const [i, l] of encounterLines(e).entries()) lines.push(`- ${l}${e.groups[i] ? ` <button class="mini-reroll" data-enc-count="${i}:-1" title="One fewer">−</button><button class="mini-reroll" data-enc-count="${i}:1" title="One more">+</button><button class="mini-reroll" data-enc-swap="${i}" title="A different monster of the same challenge">↻</button>` : ''}`);
  else for (const l of encounterLines(e)) lines.push(`- ${l}`);
  if (e.groups.length) { lines.push(''); lines.push(battleLink(e)); }
  const variants = e.groups.filter(g => g.variant);
  if (variants.length) { lines.push(''); for (const g of variants) lines.push(`- ${variantSummary(g.variant)}`); }
  if (e.situation) { lines.push(''); lines.push(`*Situation:* ${e.situation}${re('situation', 'Another situation')}`); }
  if (d) {
    lines.push('', ':::dm', '**Running it**', '');
    for (const k of Object.keys(ENC_LABEL)) if (d[k]) lines.push(`- *${ENC_LABEL[k]}:* ${d[k]}${re(k, `Reroll: ${ENC_LABEL[k].toLowerCase()}`)}`);
    lines.push(':::');
  }
  lines.push('');
  lines.push(`*Drops:* ${e.cores.filter(c => c.count).map(c => `${c.count} ${c.rank.toLowerCase()} core${c.count > 1 ? 's' : ''}${c.value ? ` (~${c.value.toLocaleString()} gp)` : ''}`).join(', ') || (e.cores.length ? 'no intact cores' : 'no cores (people, not monsters)')}${e.cores.some(c => c.cracked) ? ` (${e.cores.reduce((t, c) => t + (c.cracked || 0), 0)} cracked)` : ''}${e.parts ? `; parts to salvage (${salvageText(e.parts)}) worth about ${formatSpirit(e.parts.value)}` : ''}${e.essenceDrop ? `; the ${e.essenceDrop.monster || e.essenceDrop} leaves ${e.essenceDrop.essence ? `a ${e.essenceDrop.essence}` : 'an essence'} behind` : ''}.`);
  return lines.join('\n');
}

const capitalize = s => s ? s[0].toUpperCase() + s.slice(1) : s;

// ---------- astral spaces ----------

function layoutRooms(rng, count) {
  // A main path from entrance to boss, with a few side branches.
  const mainLen = Math.max(3, Math.ceil(count * 0.65));
  const rooms = [];
  for (let i = 0; i < mainLen; i++) rooms.push({ id: i + 1, x: i, y: 0, links: i ? [i] : [] });
  let next = mainLen + 1;
  while (rooms.length < count) {
    // Spread branches out: start from a main-path room with the fewest branches so far.
    const candidates = rooms.slice(1, Math.max(2, mainLen - 1));
    const load = r => rooms.filter(x => x.branch && x.x === r.x).length;
    const least = Math.min(...candidates.map(load));
    const from = pick(rng, candidates.filter(r => load(r) === least));
    const dir = chance(rng, 0.5) ? -1 : 1;
    let y = from.y + dir;
    while (rooms.some(r => r.x === from.x && r.y === y)) y += dir;
    const room = { id: next++, x: from.x, y, links: [from.id], branch: true };
    rooms.push(room);
    // Sometimes a branch continues one room further.
    if (rooms.length < count && chance(rng, 0.4)) {
      let y2 = y + dir;
      while (rooms.some(r => r.x === from.x && r.y === y2)) y2 += dir;
      rooms.push({ id: next++, x: from.x, y: y2, links: [room.id], branch: true });
    }
  }
  return { rooms, mainLen };
}

// Coin treasure grows tenfold a rank, while spirit coins grow a hundredfold, so high-rank spaces pay in coins of their own rank, not above it.
const ASTRAL_COINS = { Iron: 25, Bronze: 250, Silver: 2500, Gold: 25000, Diamond: 250000 };
function astralTreasure(rng, level, isBoss) {
  const rank = rankForLevel(level) === 'Normal' ? 'Iron' : rankForLevel(level);
  const base = ASTRAL_COINS[rank];
  const dice = isBoss ? 6 : 2;
  return roll(rng, dice, 6) * base;
}

// Rank sets the trap and hazard numbers written as {dc}, {dmg} and {half} in the astral lists.
const ASTRAL_SCALE = { Iron: [13, '2d10', '1d10'], Bronze: [15, '4d10', '2d10'], Silver: [17, '10d10', '5d10'], Gold: [19, '14d10', '7d10'], Diamond: [21, '18d10', '9d10'] };
export function scaleText(text, rank) {
  const [dc, dmg, half] = ASTRAL_SCALE[rank] || ASTRAL_SCALE.Iron;
  return String(text ?? '').replace(/\{dc\}/g, dc).replace(/\{dmg\}/g, dmg).replace(/\{half\}/g, half);
}

/** The astral environments, optionally only those that suit a theme. */
export function astralEnvironments(data, theme) {
  const all = list(data.astral?.environments);
  return theme && theme !== 'any' ? all.filter(e => list(e.themes).includes(theme)) : all;
}

/** A deck that deals each entry once before repeating. */
function deck(rng, items) {
  let cards = [];
  return () => { if (!items.length) return null; if (!cards.length) cards = sample(rng, items, items.length); return cards.pop(); };
}

// Words that turn an astral room's lists into a paragraph to read aloud. Openers lead into a room line that starts with "a", "an" or "the".
const ROOM_OPENERS = {
  entrance: ['You step out into', 'The way in leaves you in', 'You arrive in'],
  other: ['You come into', 'Beyond lies', 'Ahead is', 'The way opens on', 'You find yourself in'],
};
const ROOM_CLOSERS = {
  combat: ['Something here is awake, and it has noticed you.', 'You are not alone in here.', 'Movement stirs at the edge of sight.'],
  lair: ['Something has made its home here, and it does not like guests.', 'Gnawed scraps and a nest of sorts say this room belongs to someone.', 'The air is thick with the smell of a creature that sleeps here.'],
  boss: ['The whole space seems to lean toward this room.', 'The air grows heavy, and the pressure of the heart presses on your ears.', 'Everything in this place has been leading here.'],
  treasure: ['Something catches the light where it should not.', 'It looks as though no one has been here in a very long time.', 'A glint in the corner draws the eye.'],
  rest: ['For once the space is quiet, as if it is holding its breath.', 'Nothing here wants to hurt you, at least for now.', 'It is calm enough here to sit and catch your breath.'],
  puzzle: ['Markings here look as if they are meant to be read.', 'Something in this room is waiting to be worked out.', 'The room feels deliberate, as if it was built to test you.'],
  inhabitant: ['You are not the only ones here.', 'Someone has been living in this room.', 'A voice, or something like one, reaches you from inside.'],
};
const SIGHT_LEADS = ['You see ', 'Your eye falls on ', 'Here you see '];
const SOUND_LEADS = ['You hear ', 'Somewhere close, you hear ', 'Listen and you catch '];
const DRESSING_LEADS = ['Look closer and you find ', 'One thing stands out: ', 'Off to one side: '];
const lc = t => /^(A|An|The|[A-Z][a-z])/.test(t) && !/^[A-Z]{2}/.test(t) ? t[0].toLowerCase() + t.slice(1) : t;
const bare = t => String(t || '').trim().replace(/[.!]+$/, '');

// The opening clause of a phrase, a few words long, for a room's at-a-glance line.
function gist(t, max = 6) {
  const x = bare(t).replace(/^the heart,\s*/i, '').replace(/^(a|an|the) /i, '');
  const words = s => s.trim().split(/\s+/).filter(Boolean).length;
  // Cut at the first clause break that leaves at least two words, so "high, clean note" stays whole.
  const cut = /,|;| where | which | whose | that | while | when | as if | like /gi;
  let end = x.length, m;
  while ((m = cut.exec(x))) if (words(x.slice(0, m.index)) >= 2) { end = m.index; break; }
  let w = x.slice(0, end).replace(/,/g, '').split(/\s+/);
  if (w.length > max) w = w.slice(0, max);
  while (w.length > 2 && /^(a|an|the|of|in|on|at|to|from|with|and|or|by|for|into|over|under|its|their|his|her|is|are|was|when|set|felt|until|through|after|across|around|along|before|beside|behind|toward|towards)$/i.test(w[w.length - 1])) w.pop();
  return w.join(' ');
}

/** A room's read-aloud text in a few words: what it is, then what you see, hear and smell. */
export function roomGlance(room) {
  const parts = [room.feature, ...(room.senses || [])].map(t => gist(t)).filter(Boolean);
  return [...new Set(parts.map(lc))].join(' · ');
}

/** One room's look, sounds, smells and details joined into a paragraph to read aloud. */
export function roomDescription(rng, room) {
  const out = [];
  let line = bare(room.feature);
  if (line && /^(a|an|the) /i.test(line) && !/^the heart\b/i.test(line) && (room.type === 'entrance' || chance(rng, 0.6)))
    line = `${pick(rng, room.type === 'entrance' ? ROOM_OPENERS.entrance : ROOM_OPENERS.other)} ${lc(line)}`;
  if (line) out.push(cap(line) + '.');
  const [sight, sound, smell] = (room.senses || []).map(bare);
  if (sight) out.push(pick(rng, SIGHT_LEADS) + lc(sight) + '.');
  if (sound) out.push(pick(rng, SOUND_LEADS) + lc(sound) + '.');
  if (smell) out.push(/scent|smell|stench|reek|odou?r|tang|whiff|perfume|sweetness|aroma|fragrance|stink/i.test(smell) ? `There is ${lc(smell)}.` : `${pick(rng, ['The air smells of', 'It smells of', 'You catch the smell of'])} ${lc(smell)}${smell.length < 40 && chance(rng, 0.5) ? ' here' : ''}.`);
  if (room.dressing) out.push(pick(rng, DRESSING_LEADS) + lc(bare(room.dressing)) + '.');
  const closers = ROOM_CLOSERS[room.type];
  if (closers && (room.type === 'boss' || chance(rng, 0.7))) out.push(pick(rng, closers));
  return out.join(' ');
}

/** The puzzles that suit a theme (those with no themes suit any space). */
function puzzlesFor(data, theme) {
  return list(data.astral?.puzzleBank).filter(p => !list(p.themes).length || list(p.themes).includes(theme));
}

/** A puzzle from the bank, with its DCs and damage set for the space's rank. Hints grow harder as they give more away.
 * A puzzle marked to vary gets its numbers, patterns and orders rolled fresh. */
export function puzzleOf(bank, rank, rng = Math.random) {
  const p = varyPuzzle(bank, rng);
  const [dc] = ASTRAL_SCALE[rank] || ASTRAL_SCALE.Iron;
  return {
    name: p.name, kind: p.kind, setup: scaleText(p.setup, rank), clues: list(p.clues).map(c => scaleText(c, rank)),
    solution: scaleText(p.solution, rank), hints: list(p.hints).map((h, i) => ({ dc: dc - 2 + 2 * i, check: h.check, text: scaleText(h.text, rank) })),
    failure: scaleText(p.failure, rank), reward: scaleText(p.reward, rank), table: scaleText(p.table, rank), stuck: scaleText(p.stuck, rank),
  };
}

/** A different puzzle for one room, one the space doesn't already use. */
export function rerollAstralPuzzle(data, s, roomId, rng = Math.random) {
  const used = new Set(s.rooms.map(r => r.puzzle?.name).filter(Boolean));
  let pool = puzzlesFor(data, s.theme).filter(p => !used.has(p.name));
  if (!pool.length) pool = list(data.astral?.puzzleBank).filter(p => !used.has(p.name));
  if (!pool.length) return s;
  const puzzle = puzzleOf(pick(rng, pool), s.rank, rng);
  return { ...s, rooms: s.rooms.map(r => r.id === roomId ? { ...r, puzzle } : r) };
}

/** One room rolled again: what's in it comes from a fresh space with the same settings; where it sits and how it links stay. */
export function rerollAstralRoom(data, s, roomId, rng = Math.random) {
  const old = s.rooms.find(r => r.id === roomId);
  if (!old) return s;
  const opts = { level: s.level, partySize: s.partySize, theme: s.theme, environment: s.environment || 'any', size: s.size };
  // Prefer a room unlike any already in the space.
  const used = new Set(s.rooms.map(r => r.feature));
  let src = null, any = null;
  for (let i = 0; i < 12 && !src; i++) {
    const same = generateAstralSpace(data, opts, rng).rooms.filter(r => r.type === old.type);
    any ||= same[0] || null;
    const fresh = same.filter(r => !used.has(r.feature));
    if (fresh.length) src = pick(rng, fresh);
  }
  src ||= any;
  if (!src) return s;
  const KEEP = ['id', 'x', 'y', 'links', 'branch', 'passages', 'type', 'label'];
  const room = { ...Object.fromEntries(Object.entries(src).filter(([k]) => !KEEP.includes(k))), ...Object.fromEntries(KEEP.filter(k => k in old).map(k => [k, old[k]])) };
  room.description = roomDescription(rng, room);
  room.glance = roomGlance(room);
  const rooms = s.rooms.map(r => r.id === roomId ? room : r);
  return { ...s, rooms, totalXP: rooms.reduce((t, r) => t + (r.encounter?.spent || 0), 0) };
}

export function generateAstralSpace(data, opts, rng = Math.random) {
  const A = data.astral;
  const level = Math.max(1, Math.min(20, Number(opts.level) || 2));
  const partySize = Math.max(1, Math.min(8, Number(opts.partySize) || 4));
  const rank = rankForLevel(level) === 'Normal' ? 'Iron' : rankForLevel(level);
  const scale = t => scaleText(t, rank);
  const themes = essenceThemes(data);
  // An environment picked by name sets the theme unless one was asked for.
  const envs = list(A.environments);
  let env = opts.environment && opts.environment !== 'any' ? envs.find(e => e.name === opts.environment) : null;
  let theme = opts.theme && opts.theme !== 'any' && themes.includes(opts.theme) ? opts.theme : env && list(env.themes).length ? pick(rng, env.themes) : pick(rng, themes);
  if (!env && envs.length) {
    const fits = astralEnvironments(data, theme);
    env = fits.length && !chance(rng, 0.15) ? pick(rng, fits) : pick(rng, envs);
  }
  const sizeName = opts.size && opts.size !== 'any' ? opts.size : pick(rng, ['small', 'medium', 'large']);
  const count = { small: int(rng, 5, 6), medium: int(rng, 7, 9), large: int(rng, 10, 13) }[sizeName];

  const themeWords = A.themeWords[theme] || A.themeWords.default;
  const words = env?.names?.adjectives?.length && chance(rng, 0.6) ? env.names : themeWords;
  const name = `The ${pick(rng, words.adjectives)} ${pick(rng, words.nouns)}`;
  const origin = weighted(rng, A.origins);
  const rules = sample(rng, [...list(A.rules), ...list(A.quirks)], sizeName === 'large' ? 3 : sizeName === 'medium' ? 2 : 1).map(scale);
  const { rooms, mainLen } = layoutRooms(rng, count);

  const features = A.themeFeatures[theme] || A.themeFeatures.default;
  // An environment's room that begins "The heart" is where its boss waits; the rest are dealt to the other rooms.
  const isHeart = t => /^the heart\b/i.test(String(t));
  const heartRoom = env && list(env.rooms).find(isHeart);
  // The environment's own rooms are dealt first; the theme's general lines fill in only once they run out.
  const envRooms = sample(rng, env ? list(env.rooms).filter(t => !isHeart(t)) : [], 99);
  const nextRoom = () => envRooms.pop() || null;
  const nextFeature = deck(rng, [...features, ...A.themeFeatures.default]);
  const nextHazard = deck(rng, [...list(env?.hazards), ...list(env?.hazards), ...list(A.hazards)]);
  const nextSpecial = deck(rng, [...list(env?.features), ...list(env?.features), ...list(A.features)]);
  const nextTrap = deck(rng, list(A.traps).filter(t => !list(t.themes).length || list(t.themes).includes(theme)).concat(list(A.traps)));
  const nextPuzzle = deck(rng, puzzlesFor(data, theme));
  const nextDressing = deck(rng, list(A.dressing));
  const nextPassage = deck(rng, list(A.passages));
  const sense = { sights: deck(rng, list(env?.sights)), sounds: deck(rng, list(env?.sounds)), smells: deck(rng, list(env?.smells)) };
  const types = [...list(A.roomTypes)];
  // Older lists have no trap or special-feature rooms.
  if (list(A.traps).length && !types.some(t => t.key === 'trap')) types.push({ key: 'trap', label: 'Trap', weight: 11 });
  if ((list(A.features).length || list(env?.features).length) && !types.some(t => t.key === 'feature')) types.push({ key: 'feature', label: 'Feature', weight: 9 });
  const trapOf = t => t && ({ name: t.name, kind: t.kind, trigger: scale(t.trigger), effect: scale(t.effect), detect: scale(t.detect), disarm: scale(t.disarm) });
  let encounterBudgetUsed = 0;
  for (const room of rooms) {
    const isEntrance = room.id === 1;
    const isBoss = !room.branch && room.x === mainLen - 1;
    let type;
    if (isEntrance) type = types.find(t => t.key === 'entrance');
    else if (isBoss) type = types.find(t => t.key === 'boss');
    else type = weighted(rng, types.filter(t => t.weight));
    // Branch dead-ends are good places for treasure.
    if (room.branch && !rooms.some(r => r.links.includes(room.id)) && chance(rng, 0.35)) type = types.find(t => t.key === 'treasure');
    room.type = type.key;
    room.label = type.label;
    room.feature = (isBoss ? heartRoom || (list(A.bossRooms).length ? pick(rng, A.bossRooms) : null) : null) || nextRoom() || nextFeature();
    if (env) room.senses = [sense.sights(), sense.sounds(), sense.smells()].filter(Boolean);
    const dressing = nextDressing();
    if (dressing && !isEntrance) room.dressing = dressing;
    room.passages = room.links.map(from => ({ from, how: nextPassage() })).filter(x => x.how);
    if (!isEntrance && list(A.doors).length && chance(rng, 0.15)) room.door = pick(rng, A.doors);
    if (type.key === 'combat' || type.key === 'boss' || type.key === 'lair') {
      const diff = type.key === 'boss' ? 'high' : type.key === 'lair' ? 'moderate' : pick(rng, ['low', 'low', 'moderate']);
      room.encounter = generateEncounter(data, { level, partySize, difficulty: diff, theme, boss: type.key === 'boss', kinds: list(env?.creatures) }, rng);
      encounterBudgetUsed += room.encounter.spent;
      // Now and then a fight comes with a trap in the room.
      if (type.key === 'combat' && chance(rng, 0.15)) room.trap = trapOf(nextTrap());
    }
    if (type.key === 'trap') room.trap = trapOf(nextTrap());
    if (type.key === 'feature') room.detail = scale(nextSpecial());
    if (type.key === 'hazard') room.detail = scale(nextHazard());
    if (type.key === 'puzzle') {
      const p = nextPuzzle();
      if (p) room.puzzle = puzzleOf(p, rank, rng); else room.detail = pick(rng, A.puzzles);
    }
    if (type.key === 'inhabitant') room.detail = pick(rng, A.inhabitants);
    if (type.key === 'rest') room.detail = pick(rng, A.restPoints);
    if (type.key === 'treasure' || type.key === 'boss') { room.treasureGp = astralTreasure(rng, level, type.key === 'boss'); room.treasure = formatCoins(room.treasureGp); }
    if (type.key === 'boss') room.detail = scale(pick(rng, A.bossFlavors));
    room.description = roomDescription(rng, room);
    room.glance = roomGlance(room);
  }

  const rewards = [];
  const heartGp = astralTreasure(rng, level, true);
  rewards.push(`${formatCoins(heartGp)} in the space's heart ${purseLink(heartGp, 'heart')}`);
  const drop = chance(rng, 0.45) && lootEssence(data, theme, rank, rng);
  if (drop) rewards.push(`A ${essenceLabel(drop)}, dropped by the boss`);
  const stoneSpells = themeStoneSpells(data, theme);
  if (chance(rng, 0.35) && stoneSpells[1]) {
    const cap = maxStoneSpellLevel(level);
    const lvl = int(rng, 1, cap);
    const spells = stoneSpells[lvl] || stoneSpells[1];
    rewards.push(`A ${theme} awakening stone (*${pick(rng, spells)}*, level ${lvl}), for any ${theme}-affinity essence`);
  }
  if (chance(rng, 0.5)) rewards.push(`${pick(rng, A.specialRewards)}`);

  return {
    kind: 'astral', name, theme, rank, level, partySize, size: sizeName,
    environment: env?.name || null, summary: env?.summary || '', readAloud: env && list(env.readAloud).length ? pick(rng, env.readAloud) : '',
    origin: origin.text, rules, entrance: pick(rng, A.entrances), atmosphere: pick(rng, themeWords.atmosphere || A.themeWords.default.atmosphere),
    rooms, rewards, totalXP: encounterBudgetUsed,
    ending: list(A.endings).length ? scale(pick(rng, A.endings)) : '',
  };
}

/** Every monster that turns up in an astral space, merged by name. */
export function astralMonsters(s) {
  const by = new Map();
  for (const r of s.rooms) for (const g of r.encounter?.groups || []) {
    const had = by.get(g.name);
    if (had) had.count += g.count; else by.set(g.name, { ...g });
  }
  return [...by.values()].sort((a, b) => b.cr - a.cr || a.name.localeCompare(b.name));
}

const sentence = t => { const x = String(t || '').trim(); return !x ? '' : /[.!?)"]$/.test(x) ? cap(x) : cap(x) + '.'; };

/** A link that puts found coins into the party purse; once used, the page says so instead. */
export const purseLink = (gp, key) => `[Add to the party purse](#purse-${Math.round(gp)}-${key})`;
export const PURSE_LINK = /\[Add to the party purse\]\(#purse-(\d+)-([\w-]+)\)/g;

const PUZZLE_KIND = { riddle: 'riddle', mechanism: 'mechanism', split: 'split clues: the party must share what each sees' };

/** A link to print a puzzle's handouts as slips to cut out; the app turns it into a button. */
export function handoutLink(p) {
  const data = encodeURIComponent(JSON.stringify({ n: p.name, c: p.clues })).replace(/\(/g, '%28').replace(/\)/g, '%29');
  return `[Print handouts](#handouts-${data})`;
}
export function handoutData(href) {
  try { const d = JSON.parse(decodeURIComponent(String(href).replace(/^#handouts-/, ''))); return { name: String(d.n || 'Puzzle'), clues: list(d.c).map(String) }; } catch { return null; }
}

const GLYPH = { sun: '☀', moon: '☾', star: '★', crown: '♛', skull: '☠', key: '⚷', wave: '≈', flame: '♨', leaf: '❦', eye: '◉', heart: '♥', cross: '✚' };
const escHtml = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** A printable page of handout slips, one per player, with any "Row 1: a, b, c." patterns drawn as grids. */
export function handoutsHTML({ name, clues }) {
  const slips = clues.map((c, i) => {
    let text = String(c).replace(/^(Show one player|Tell one player privately):\s*/i, '');
    let who = '';
    const m = text.match(/^\(([^)]+)\)\s*/);
    if (m) { who = m[1]; text = text.slice(m[0].length); }
    const rows = [];
    text = text.replace(/Row \d+:\s*([^.]+)\.?/gi, (_, cells) => { rows.push(cells.split(/,\s*/)); return ''; }).replace(/\s{2,}/g, ' ').trim();
    const cell = x => { const w = x.trim().replace(/\.$/, ''); return /^(empty|blank|nothing)$/i.test(w) ? '<td></td>' : `<td>${GLYPH[w.toLowerCase()] ? `<b>${GLYPH[w.toLowerCase()]}</b><br>` : ''}${escHtml(w)}</td>`; };
    const grid = rows.length ? `<table>${rows.map(r => `<tr>${r.map(cell).join('')}</tr>`).join('')}</table>` : '';
    return `<div class="slip"><div class="tag">${escHtml(name)} · handout ${i + 1} of ${clues.length}</div>${who ? `<div class="who">${escHtml(who)}</div>` : ''}<p>${escHtml(text)}</p>${grid}</div>`;
  });
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escHtml(name)}</title><style>
body { font: 13pt Georgia, serif; color: #111; margin: 0; }
h1 { font-size: 15pt; margin: 0 0 4mm; }
.slip { border: 1.5px dashed #555; padding: 5mm 6mm; margin: 0 0 6mm; break-inside: avoid; }
.tag { font: 9pt sans-serif; color: #666; text-transform: uppercase; letter-spacing: .05em; }
.who { font-weight: bold; margin-top: 2mm; }
p { margin: 2mm 0; line-height: 1.4; }
table { border-collapse: collapse; margin-top: 3mm; }
td { border: 1px solid #333; width: 24mm; height: 16mm; text-align: center; font-size: 10pt; }
td b { font-size: 18pt; font-weight: normal; }
</style></head><body><h1>${escHtml(name)}: cut along the dashed lines</h1>${slips.join('')}</body></html>`;
}

function puzzleMarkdown(r, interactive) {
  const p = r.puzzle, L = [];
  const re = interactive ? ` <button class="mini-reroll" data-part="puzzle:${r.id}" title="A different puzzle">↻</button>` : '';
  L.push(`**Puzzle: ${p.name}**${p.kind ? ` (${PUZZLE_KIND[p.kind] || p.kind})` : ''}${re}`, '');
  L.push(`> ${p.setup}`, '');
  L.push(':::dm');
  if (p.clues.length) { L.push(p.kind === 'split' ? '*Handouts:*' : '*If they search:*'); for (const c of p.clues) L.push(`- ${sentence(c)}`); L.push(''); }
  if (p.hints.length) { L.push('*Hints:*'); for (const h of p.hints) L.push(`- DC ${h.dc} ${h.check}: ${sentence(h.text)}`); L.push(''); }
  L.push(`*Solution:* ${sentence(p.solution)}`, '');
  if (p.failure) L.push(`*A wrong try:* ${sentence(p.failure)}`, '');
  if (p.reward) L.push(`*Reward:* ${sentence(p.reward)}`, '');
  if (p.table) L.push(`*At the table:* ${sentence(p.table)}`, '');
  if (p.stuck) L.push(`*If they're stuck:* ${sentence(p.stuck)}`, '');
  if (p.kind === 'split' && p.clues.length) L.push(handoutLink(p), '');
  L.push(':::', '');
  return L;
}

export function astralToMarkdown(s, { interactive = false } = {}) {
  const L = [];
  L.push(`**${s.rank}-rank astral space** · ${s.environment ? `${s.environment} · ` : ''}${s.theme} theme · ${s.size}, ${s.rooms.length} rooms · built for ${s.partySize} character${s.partySize === 1 ? '' : 's'} of level ${s.level}`);
  L.push('');
  if (s.readAloud) { L.push(`> ${s.readAloud}`); L.push(''); }
  L.push(`*${s.atmosphere}*`);
  L.push('');
  if (s.summary) { L.push(s.summary); L.push(''); }
  L.push(`- **Origin:** ${s.origin}`);
  L.push(`- **Entrance:** ${s.entrance}`);
  for (const r of s.rules) L.push(`- **Rule of this space:** ${r}`);
  L.push('');
  L.push('## Rooms');
  L.push('');
  for (const r of s.rooms) {
    const link = r.links.length ? ` (from ${r.links.join(', ')})` : '';
    L.push(`### ${r.id}. ${r.label}${link}${interactive ? ` <button class="mini-reroll" data-part="room:${r.id}" title="Roll this room again">↻</button>` : ''}`);
    L.push('');
    if (r.passages?.length) { L.push(r.passages.map(p => `*The way in from ${p.from}:* ${p.how}.`.replace(/\.\.$/, '.')).join(' ')); L.push(''); }
    if (r.door) { L.push(`*Door:* ${sentence(r.door)}`); L.push(''); }
    if (r.glance) { L.push(`*At a glance:* ${r.glance}`); L.push(''); }
    L.push(`> ${r.description || sentence(r.feature)}`);
    L.push('');
    const extra = [];
    if (!r.description) {
      if (r.senses?.length) extra.push(`*Senses:* ${r.senses.map(x => String(x).replace(/\.$/, '')).join('; ')}.`);
      if (r.dressing) extra.push(`*Detail:* ${sentence(r.dressing)}`);
    }
    if (extra.length) { L.push(extra.join(' ')); L.push(''); }
    if (r.detail) { L.push(r.detail); L.push(''); }
    if (r.puzzle) L.push(...puzzleMarkdown(r, interactive));
    if (r.trap) {
      const t = r.trap;
      L.push(`**Trap: ${t.name}**${t.kind ? ` (${t.kind})` : ''}`);
      L.push('');
      if (t.trigger) L.push(`- *Trigger:* ${sentence(t.trigger)}`);
      if (t.effect) L.push(`- *Effect:* ${sentence(t.effect)}`);
      if (t.detect) L.push(`- *Spotting it:* ${sentence(t.detect)}`);
      if (t.disarm) L.push(`- *Disarming it:* ${sentence(t.disarm)}`);
      L.push('');
    }
    if (r.encounter) { L.push(encounterToMarkdown(r.encounter)); L.push(''); }
    if (r.treasure) { L.push(`*Treasure:* ${r.treasure}.${r.treasureGp ? ` ${purseLink(r.treasureGp, `r${r.id}`)}` : r.treasureTaken ? ' *(in the party purse)*' : ''}`); L.push(''); }
  }
  if (s.ending) { L.push('## When the heart falls'); L.push(''); L.push(s.ending); L.push(''); }
  L.push('## Rewards');
  L.push('');
  for (const r of s.rewards) L.push(`- ${r}`);
  L.push('');
  L.push(`Total encounter XP: ${s.totalXP.toLocaleString()}.`);
  L.push('');
  return L.join('\n');
}

export function astralMapSVG(s) {
  const xs = s.rooms.map(r => r.x), ys = s.rooms.map(r => r.y);
  const minY = Math.min(...ys), maxY = Math.max(...ys), maxX = Math.max(...xs);
  const cell = 92, pad = 46, padX = 64;
  const W = maxX * cell + padX * 2, H = (maxY - minY) * cell + pad * 2;
  const pos = r => [padX + r.x * cell, pad + (r.y - minY) * cell];
  const byId = Object.fromEntries(s.rooms.map(r => [r.id, r]));
  let out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="astral-map" role="img" aria-label="Room map">`;
  for (const r of s.rooms) for (const l of r.links) {
    const [x1, y1] = pos(r), [x2, y2] = pos(byId[l]);
    out += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="map-link"/>`;
  }
  for (const r of s.rooms) {
    const [x, y] = pos(r);
    out += `<g class="map-room room-${r.type}"><circle cx="${x}" cy="${y}" r="22"/><text x="${x}" y="${y + 5}" text-anchor="middle" class="map-num">${r.id}</text><text x="${x}" y="${y + 38}" text-anchor="middle" class="map-label">${r.label}</text></g>`;
  }
  return out + '</svg>';
}

// ---------- quirks ----------

export function proficiencyForCR(cr) {
  return cr < 5 ? 2 : cr < 9 ? 3 : cr < 13 ? 4 : cr < 17 ? 5 : cr < 21 ? 6 : cr < 25 ? 7 : cr < 29 ? 8 : 9;
}

/**
 * Rolls one quirk from quirks.json. monster is { name, cr }; numbers in the
 * text scale with cr, and a named classic monster sometimes gets its signature quirk.
 */
export function rollQuirk(quirks, monster, rng = Math.random, kinds = null) {
  const sig = !kinds && monster.name && quirks.signature?.[monster.name];
  let kind, text;
  if (sig && rng() < quirks.signatureChance) {
    ({ kind, text } = sig);
  } else {
    const k = weighted(rng, kinds ? quirks.kinds.filter(x => kinds.includes(x.kind)) : quirks.kinds);
    kind = k.kind;
    text = k.entries ? pick(rng, k.entries) : weighted(rng, k.templates).text;
  }
  const pb = proficiencyForCR(monster.cr);
  const cr = Math.max(1, Math.round(monster.cr));
  const nums = { pb, pb2: pb * 2, dc: 10 + pb, crgold: 10 * cr, crgold25: 25 * cr };
  // Table entries can hold placeholders of their own, so fill until nothing changes.
  for (let i = 0; i < 4 && /\{\w+\}/.test(text); i++) {
    text = text.replace(/\{(\w+)\}/g, (m, key) =>
      key in nums ? String(nums[key]) : quirks.tables[key] ? pick(rng, quirks.tables[key]) : m);
  }
  return { kind, label: quirks.labels[kind] || kind, text };
}
// ---------- word bank ----------

/** A bank is a plain list of words or { group: [words] }; either way, return each word once. */
export function bankWords(bank) {
  if (!bank) return [];
  const list = Array.isArray(bank) ? bank : Object.values(bank).flat();
  return [...new Set(list.map(w => String(w).trim()).filter(Boolean))];
}

export const SLOTS = ['who', 'what', 'where'];
export const SLOT_LABELS = { who: 'Who', what: 'What', where: 'Where' };
/** The What is either a thing you can hold or a happening (an event, a debt, a rumour). */
export const WHAT_KINDS = ['thing', 'happening'];
/** How often the Who or the Where comes from the campaign's own wiki, when it has pages to offer. */
export const WIKI_CHANCE = 0.25;

// Which word groups feed each slot. A campaign's words.json can override this with its own "slots".
// A slot with no groups listed takes every group the other slots don't use.
// A slot given as { variant: [groups] } is split, so the What can be a thing or a happening.
const DEFAULT_SLOTS = {
  nouns: {
    who: ['people', 'creatures', 'animals'],
    what: {
      thing: ['objects', 'weapons_war', 'treasure_trade', 'clothing', 'food_drink', 'materials', 'body'],
      happening: ['concepts', 'events', 'society_law', 'magic_faith', 'signs_sounds', 'sky_time'],
    },
    where: ['buildings_rooms', 'wilderness', 'travel_sea'],
  },
  adjectives: {
    who: ['personality', 'emotion', 'status_value', 'danger_health'],
    what: {
      thing: ['appearance', 'senses', 'condition_age', 'magical', 'scale_time_mystery'],
      happening: ['happening'],
    },
    where: ['condition_age', 'atmosphere', 'magical', 'scale_time_mystery'],
  },
};

function slotGroups(words, kind, slot, variant) {
  const map = words.slots?.[kind] || DEFAULT_SLOTS[kind];
  const entry = map[slot] || [];
  if (!Array.isArray(entry)) return entry[variant] || Object.values(entry).flat();
  if (entry.length) return entry;
  const used = new Set(Object.values(map).flatMap(v => Array.isArray(v) ? v : Object.values(v).flat()));
  return Object.keys(words[kind]).filter(g => !used.has(g));
}

function slotPool(words, kind, slot, variant) {
  const bank = words?.[kind];
  if (!bank || Array.isArray(bank)) return bankWords(bank);
  const pool = bankWords(slotGroups(words, kind, slot, variant).flatMap(g => bank[g] || []));
  return pool.length ? pool : bankWords(bank);
}

/** The What's variants, if this campaign's word list splits it. */
function whatKinds(words) {
  const what = (words.slots?.nouns || DEFAULT_SLOTS.nouns).what;
  return what && !Array.isArray(what) ? Object.keys(what) : [];
}

const pickNew = (rng, pool, avoid) => {
  const fresh = pool.filter(w => !avoid.includes(w));
  return fresh.length ? pick(rng, fresh) : pick(rng, pool);
};

const WIKI_FOR = { who: 'npcs', where: 'locations' };

/** A fresh slot with no adjective. The Who may be one of the campaign's NPCs and the Where one of its locations. */
function newSlot(data, slot, rng, opts, avoid, kind) {
  const names = (opts.wiki?.[WIKI_FOR[slot]] || []).filter(n => !avoid.includes(n));
  if (names.length && chance(rng, WIKI_CHANCE)) return { noun: pick(rng, names), adj: null, wiki: true };
  if (slot === 'what') {
    const kinds = whatKinds(data.words);
    kind = kinds.includes(kind) ? kind : kinds.length ? pick(rng, kinds) : undefined;
    return { noun: pickNew(rng, slotPool(data.words, 'nouns', slot, kind), avoid), adj: null, ...(kind && { kind }) };
  }
  return { noun: pickNew(rng, slotPool(data.words, 'nouns', slot), avoid), adj: null };
}

const HOOK_TEMPLATES = [
  { text: 'The {who} is carrying {object}. {lead}', weight: 30 },
  { text: 'The {who} {behavior}, because {reason}.', weight: 40 },
  { text: '{npc} {connection}.', weight: 30 },
];

/**
 * One story hook. "{who}", "{what}" and "{where}" are left in the text and filled when shown,
 * so swapping a word updates the hooks. About half the hooks are scenes that use all three slots.
 */
function rollHook(data, rng, kind) {
  const hooks = data.words?.hooks;
  if (!hooks?.tables) return rollQuirk(data.quirks, { cr: 5 }, rng, ['Hook']).text;
  const scenes = hooks.scenes?.[kind || 'thing'];
  if (scenes?.length && chance(rng, 0.5)) return pick(rng, scenes);
  const tables = { ...(data.quirks?.tables || {}), ...hooks.tables };
  let text = weighted(rng, hooks.templates || HOOK_TEMPLATES).text;
  const open = /\{(?!(?:who|what|where)\})\w+\}/;
  for (let i = 0; i < 4 && open.test(text); i++) {
    text = text.replace(/\{(\w+)\}/g, (m, key) => !SLOTS.includes(key) && tables[key] ? pick(rng, tables[key]) : m);
  }
  return text;
}

function freshHook(data, rng, avoid, kind) {
  let h;
  for (let i = 0; i < 20; i++) { h = rollHook(data, rng, kind); if (!avoid.includes(h)) break; }
  return h;
}

/**
 * Draws a Who, a What and a Where, with an adjective on the Who and on one of the others, plus two story hooks.
 * opts.keep: slots to carry over unchanged (pinned). opts.wiki: { npcs, locations } page titles to draw from.
 */
export function drawWords(data, opts = {}, rng = Math.random) {
  if (bankWords(data.words?.nouns).length < 3 || bankWords(data.words?.adjectives).length < 2) {
    throw new Error('The word bank needs at least 3 nouns and 2 adjectives');
  }
  const keep = opts.keep || {};
  const draw = { hooks: [] };
  const used = SLOTS.filter(s => keep[s]).map(s => keep[s].noun);
  for (const slot of SLOTS) {
    if (keep[slot]) { draw[slot] = { ...keep[slot] }; continue; }
    draw[slot] = newSlot(data, slot, rng, opts, used);
    used.push(draw[slot].noun);
  }
  const fresh = s => !keep[s] && !draw[s].wiki;
  if (fresh('who')) draw.who.adj = pick(rng, slotPool(data.words, 'adjectives', 'who'));
  const others = ['what', 'where'].filter(fresh);
  if (others.length && !['what', 'where'].some(s => keep[s]?.adj)) {
    const second = pick(rng, others);
    draw[second].adj = pickNew(rng, slotPool(data.words, 'adjectives', second, draw[second].kind), [draw.who.adj]);
  }
  if (data.quirks || data.words.hooks) {
    for (let i = 0; i < 2; i++) draw.hooks.push(freshHook(data, rng, draw.hooks, draw.what.kind));
  }
  return draw;
}

/** Swaps one part of a draw: { slot, part: 'noun' | 'adj' } or { hook: index }. A swapped What stays a thing or a happening. */
export function redrawOne(data, draw, which, rng = Math.random, opts = {}) {
  const next = { ...draw, who: { ...draw.who }, what: { ...draw.what }, where: { ...draw.where }, hooks: [...draw.hooks] };
  if (which.hook !== undefined) {
    next.hooks[which.hook] = freshHook(data, rng, draw.hooks, draw.what.kind);
  } else if (which.part === 'adj') {
    next[which.slot].adj = pickNew(rng, slotPool(data.words, 'adjectives', which.slot, draw[which.slot].kind), SLOTS.map(s => draw[s].adj));
  } else {
    const old = draw[which.slot];
    const slot = newSlot(data, which.slot, rng, opts, SLOTS.map(s => draw[s].noun), old.kind);
    // A proper name takes no adjective; a Who that stops being a name gets one back.
    if (!slot.wiki) slot.adj = old.adj ?? (which.slot === 'who' ? pick(rng, slotPool(data.words, 'adjectives', 'who')) : null);
    next[which.slot] = slot;
  }
  return next;
}

export const slotPhrase = s => (s.adj ? s.adj + ' ' : '') + s.noun;

/** Fills a hook's slots. Names from the wiki replace "the {who}" whole; links: true writes them as [[wiki links]]. */
export function hookText(draw, hook, { links = false } = {}) {
  const fill = (slot, article) => {
    const s = draw[slot];
    if (s.wiki) {
      // "The Old City" reads as "the Old City" mid-sentence; the first letter of the hook is capitalised anyway.
      const shown = s.noun.replace(/^The /, 'the ');
      return !links ? shown : shown === s.noun ? `[[${s.noun}]]` : `[[${s.noun}|${shown}]]`;
    }
    return (article ? article + ' ' : '') + slotPhrase(s);
  };
  const t = hook
    .replace(/\b([Tt]he) \{(who|what|where)\}/g, (m, article, slot) => fill(slot, article))
    .replace(/\{(who|what|where)\}/g, (m, slot) => fill(slot, ''));
  return t[0].toUpperCase() + t.slice(1);
}

export function wordsTitle(draw) {
  return 'Idea: ' + SLOTS.map(s => draw[s].noun).join(', ');
}

export function wordsToMarkdown(draw) {
  const word = s => s.wiki ? `[[${s.noun}]]` : `${s.adj ? `*${s.adj}* ` : ''}${s.noun}`;
  const lines = SLOTS.map(s => `**${SLOT_LABELS[s]}:** ${word(draw[s])}  `);
  if (draw.hooks.length) lines.push('', '## Story hooks', '', ...draw.hooks.map(h => `- ${hookText(draw, h, { links: true })}`));
  lines.push('', '## Idea', '', '');
  return lines.join('\n');
}

export function wordsToText(draw) {
  return [...SLOTS.map(s => `${SLOT_LABELS[s]}: ${slotPhrase(draw[s])}`), ...draw.hooks.map(h => hookText(draw, h))].join('\n');
}

// ---------- saved hooks ----------

/** A story hook worth keeping, with the words it came from so the draw can be reopened later. */
export function savedHook(draw, hook, now = new Date()) {
  return {
    id: now.getTime().toString(36) + Math.floor(Math.random() * 1e6).toString(36),
    text: hookText(draw, hook),
    md: hookText(draw, hook, { links: true }),
    words: SLOTS.map(s => slotPhrase(draw[s])),
    draw: { who: draw.who, what: draw.what, where: draw.where, hooks: draw.hooks },
    saved: now.toISOString(),
    used: null,
  };
}

/** Saved hooks matching every word of a search, in their saved order, optionally leaving out ones already used. */
export function filterSaved(hooks, q = '', hideUsed = false) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return hooks
    .filter(h => !(hideUsed && h.used))
    .filter(h => { const t = (h.text + ' ' + h.words.join(' ')).toLowerCase(); return words.every(w => t.includes(w)); });
}

// ---------- DM-only text ----------

/** Lines between ":::dm" and ":::" are for the DM. Keep them (wrapped for styling) or drop them for players. */
const DM_BLOCK = /^:::dm[^\n]*\n([\s\S]*?)(?:^:::[ \t]*$\n?|(?![\s\S]))/gm;
export function dmBlocks(md, show) {
  return md.replace(DM_BLOCK, (m, inner) => show ? `\n<div class="dm-block">\n\n${inner.replace(/\s*$/, '')}\n\n</div>\n\n` : '');
}
export const stripDM = md => dmBlocks(md, false);

// A :::tree block holds a nested list (each child indented under its parent), drawn as a family tree.
const TREE_BLOCK = /^:::tree[^\n]*\n([\s\S]*?)(?:^:::[ \t]*$\n?|(?![\s\S]))/gm;
export function treeBlocks(md) {
  return md.replace(TREE_BLOCK, (m, inner) => `\n<div class="family-tree">\n\n${inner.replace(/\s*$/, '')}\n\n</div>\n\n`);
}

// ---------- sharing character sheets ----------
// A sheet file carries one party member's page (sheet fields and notes) and portrait, so a player and the DM can pass it back and forth.

export const SHEET_FORMAT = 'dnd-campaign-manager/sheet';

/** Build a sheet file. DM-only blocks are left out unless `dm` is set. */
export function packSheet(meta, body, { dm = false, campaign = '', image = null, date = new Date().toISOString() } = {}) {
  const { image: _img, ...rest } = meta;
  return JSON.stringify({
    format: SHEET_FORMAT, version: 1, exported: date, campaign,
    character: { meta: { ...rest, type: 'pc' }, body: dm ? body : stripDM(body).replace(/\n{3,}/g, '\n\n') },
    image,
  }, null, 1);
}

/** Read a sheet file, or throw a message a person can act on. */
export function readSheet(text) {
  let f;
  try { f = JSON.parse(text); } catch { throw new Error("That file isn't a character sheet from this app."); }
  if (f?.format !== SHEET_FORMAT || !f.character?.meta) throw new Error("That file isn't a character sheet from this app.");
  if (f.version > 1) throw new Error('That sheet was saved by a newer version of the app. Update the app to import it.');
  const meta = { ...f.character.meta, type: 'pc' };
  if (!String(meta.title || '').trim()) throw new Error('That sheet has no character name.');
  meta.title = String(meta.title).trim();
  return { meta, body: String(f.character.body || ''), image: f.image?.data ? f.image : null, campaign: f.campaign || '', exported: f.exported || '' };
}

/** When a sheet comes back without DM notes, keep the DM notes already on this computer's copy. */
export function mergeSheetBody(existing, incoming) {
  if (DM_BLOCK.test(incoming)) { DM_BLOCK.lastIndex = 0; return incoming; }
  DM_BLOCK.lastIndex = 0;
  const notes = [...String(existing || '').matchAll(DM_BLOCK)].map(m => m[0].replace(/\s*$/, ''));
  return notes.length ? `${incoming.replace(/\s*$/, '')}\n\n${notes.join('\n\n')}\n` : incoming;
}

// ---------- markets and taverns ----------
// Both draw from their own banks (market, tavern), the essence compendium for magical goods,
// and the NPC generator for keepers and owners. Every part can be rerolled on its own.

/** Everyday prices in gold, silver and copper. */
// Late-game campaigns can set a floor so nothing costs less than 1 gp (Settings, "Late-game prices").
let PRICE_FLOOR = 0;
export const setPriceFloor = gp => { PRICE_FLOOR = Number(gp) || 0; };
export const floorPrice = gp => gp > 0 && gp < PRICE_FLOOR ? PRICE_FLOOR : gp;

export function formatGp(gp) {
  if (!gp) return 'free';
  gp = floorPrice(gp);
  const cp = Math.round(gp * 100);
  const g = Math.floor(cp / 100), s = Math.floor((cp % 100) / 10), c = cp % 10;
  return [g && `${g.toLocaleString()} gp`, s && `${s} sp`, c && `${c} cp`].filter(Boolean).join(' ');
}

/** Spirit coin prices, short: "25 bronze", "1 silver, 50 bronze". */
export const formatSpirit = gp => formatCoins(gp).replace(/ spirit coins$/, '');

/** Round a price to two significant figures so it reads like a price someone set. */
const roundPrice = gp => { if (gp < 0.1) return Math.max(0.01, Math.round(gp * 100) / 100); if (gp < 1) return Math.round(gp * 10) / 10; const p = 10 ** Math.max(0, Math.floor(Math.log10(gp)) - 1); return Math.round(gp / p) * p; };

/** Pay a price in gp from a purse of spirit coins; the seller makes change. Null if the purse is short. */
export function payCoins(coins, gp) {
  const total = purseValue(coins);
  if (total < gp) return null;
  const out = Object.fromEntries(COIN_RANKS.map(k => [k, Number(coins?.[k]) || 0]));
  let owe = Math.round(gp);
  // Keep the purse's own coins where it can: pay with the biggest coins that fit, then break the smallest coin that covers the rest.
  for (const k of [...COIN_RANKS].reverse()) { const n = Math.min(out[k], Math.floor(owe / COIN_VALUE[k])); out[k] -= n; owe -= n * COIN_VALUE[k]; }
  if (owe > 0) {
    const k = COIN_RANKS.find(x => out[x] > 0 && COIN_VALUE[x] > owe);
    out[k] -= 1;
    let change = COIN_VALUE[k] - owe;
    for (const x of [...COIN_RANKS.slice(0, COIN_RANKS.indexOf(k))].reverse()) { const n = Math.floor(change / COIN_VALUE[x]); out[x] += n; change -= n * COIN_VALUE[x]; }
  }
  // Ranks the purse never had stay off the sheet.
  for (const k of ['gold', 'diamond']) if (!out[k] && coins?.[k] === undefined) delete out[k];
  return out;
}

/** Add a line to a page's Inventory list, making the section if the page has none. */
export function addToInventory(body, line) {
  const m = /^## Inventory[^\n]*\n/m.exec(body);
  if (!m) return `${body.replace(/\s*$/, '')}\n\n## Inventory\n\n- ${line}\n`;
  const start = m.index + m[0].length;
  const rest = body.slice(start);
  const end = rest.search(/^## /m);
  const section = end < 0 ? rest : rest.slice(0, end);
  // An empty "- " placeholder from the page template is replaced, not kept.
  const cleaned = section.replace(/^-\s*$\n?/m, '').replace(/\s*$/, '');
  const next = `${cleaned ? `${cleaned}\n` : '\n'}- ${line}\n\n`;
  return body.slice(0, start) + next + (end < 0 ? '' : rest.slice(end));
}

/** Tokens a market or tavern fills from the wiki: {place}, {faction}, {npc}, {church}, {affinity}, plus plain names for titles. */
function venueCtx(data, opts, rng) {
  const wiki = opts.wiki || {};
  const locations = list(wiki.locations);
  const npcs = list(wiki.npcs).filter(t => !/^key npcs$/i.test(t));
  const factions = list(wiki.factions).filter(f => !/^church of/i.test(f));
  const churches = list(wiki.churches);
  const here = opts.where && opts.where !== 'any' ? opts.where : null;
  let lastChurch = null; // a line never sets a church against itself
  return {
    here,
    place: () => here && chance(rng, 0.5) ? linkTo(here) : locations.length ? linkTo(pick(rng, locations)) : pick(rng, GENERIC_PLACES),
    placeName: () => here || (locations.length ? pick(rng, locations).replace(/^The /, '') : 'Riverside'),
    faction: () => { const others = factions.filter(f => f !== lastChurch); return others.length ? factionPhrase(pick(rng, others)) : pick(rng, GENERIC_FACTIONS); },
    npc: () => npcs.length ? `[[${pick(rng, npcs)}]]` : pickName(rng, pickPeople(rng, data), data),
    church: () => { if (!churches.length) return 'the local church'; lastChurch = pick(rng, churches); return linkTo(lastChurch); },
    churchName: () => churches.length ? pick(rng, churches) : 'Church of the Healer',
    affinity: () => opts.theme && opts.theme !== 'any' ? opts.theme : pick(rng, essenceThemes(data)),
  };
}

function fillVenue(text, ctx, capFirst = true) {
  const out = String(text)
    .replace(/\{place\}/g, () => ctx.place()).replace(/\{faction\}/g, () => ctx.faction()).replace(/\{npc\}/g, () => ctx.npc())
    .replace(/\{church\}/g, () => ctx.church()).replace(/\{affinity\}/g, () => ctx.affinity());
  return capFirst ? capSentence(out) : tidy(out);
}

const fillTitle = (text, ctx, extra = {}) => String(text)
  .replace(/\{place\}/g, () => ctx.placeName()).replace(/\{church\}/g, () => ctx.churchName())
  .replace(/\{(\w+)\}/g, (m, k) => extra[k] ?? m).replace(/\s+/g, ' ').trim();

/** A shopkeeper, innkeeper or member of staff: a full NPC, so they can be saved as their own page. */
function venuePerson(data, role, opts, rng) {
  // Most people behind a counter are ordinary folk or Iron rank; a few have climbed higher.
  const rank = role === 'Priest' ? 'any' : weighted(rng, [['Normal', 5], ['Iron', 4], ['Bronze', 1]], x => x[1])[0];
  return generateNPC(data, { role, rank, twist: 'none', wiki: opts.wiki }, rng);
}

const personLine = (n, link = false) => {
  const who = link ? `[[${n.name}]]` : `**${n.name}**`;
  const trait = n.persona?.traits?.[0];
  return `${who}, ${n.people === 'Human' ? 'a human' : `${/^[AEIOU]/.test(n.people) ? 'an' : 'a'} ${n.people}`} ${n.pronoun === 'she' ? 'woman' : n.pronoun === 'he' ? 'man' : 'person'}${n.rank && n.rank !== 'Normal' ? ` of ${n.rank} rank` : ''}. ${trait ? `${trait.replace(/\.$/, '')}. ` : ''}*Tell:* ${n.tell.replace(/^[A-Z]/, c => c.toLowerCase())}.`;
};

// ----- item catalogue -----
// Everyday equipment, magic items, gems and the world's own goods (items.json). What a shop sells depends on
// the settlement: villages sell everyday goods, cities rarer magic, and only auction houses the rarest.

export const ITEM_RARITIES = ['mundane', 'common', 'uncommon', 'rare', 'very rare', 'legendary', 'artifact'];
export const SETTLEMENTS = ['village', 'town', 'city', 'great city'];
const rarityAt = r => ITEM_RARITIES.indexOf(r || 'mundane');
const ESSENCE_ORDER = ['common', 'uncommon', 'rare', 'legendary'];

export const itemCatalog = data => list(data.items?.items);

export function itemInfo(data, name) {
  const key = String(name || '').trim().toLowerCase();
  return key ? itemCatalog(data).find(i => i.name.toLowerCase() === key) || null : null;
}

export const itemCategories = data => [...new Set(itemCatalog(data).map(i => i.cat))];

export const settlementInfo = (data, s) => data.items?.settlements?.[s] || null;

/** "frontier towns", "great cities": a settlement kind as a plural, for sentences. */
export const settlementPlural = (data, s) => (settlementInfo(data, s)?.label || s).toLowerCase().replace(/y$/, 'ie') + 's';

/** The kind of settlement a wiki location is: the page's own `settlement` field, else items.json's 'places'. */
export function settlementFor(data, where, meta = null) {
  const s = meta?.settlement || data.items?.places?.[where];
  return SETTLEMENTS.includes(s) ? s : null;
}

/** How much magic a place has (low, moderate or high): the page's own `magic` field, else items.json's 'placeMagic'. */
export function placeMagic(data, where, meta = null) {
  const m = meta?.magic || data.items?.placeMagic?.[where];
  return data.items?.magicLevels?.[m] ? m : 'moderate';
}

const magicLevel = (data, m) => data.items?.magicLevels?.[m] || { rareStock: 1, rankScale: {} };

const topRank = S => Object.keys(S?.ranks || { Iron: 1 }).reduce((a, b) => RANKS.indexOf(b) > RANKS.indexOf(a) ? b : a);

/** Whether the shops of a settlement of this kind sell the item. */
export function soldIn(data, item, settlement) {
  const S = settlementInfo(data, settlement);
  if (!S || item.price == null || item.rarity === 'artifact') return false;
  if (rarityAt(item.rarity) > rarityAt(S.maxRarity)) return false;
  if (S.maxPrice != null && item.price > S.maxPrice) return false;
  if (item.rank && RANKS.indexOf(item.rank) > RANKS.indexOf(topRank(S))) return false;
  return true;
}

/** Whether an auction house in a settlement of this kind could put the item up as a lot. */
export function auctionTakes(data, item, settlement) {
  const st = data.auction?.stock?.[settlement];
  if (!st || !settlementInfo(data, settlement)?.auction || item.price == null) return false;
  return st.rarities.includes(item.rarity) || (item.cat === 'Gems' && item.price >= (st.gemMin || 1000));
}

/** Where an item can be found: the smallest settlement whose shops sell it, and the auctions that might. */
export function itemWhere(data, item) {
  const shop = SETTLEMENTS.find(s => soldIn(data, item, s)) || null;
  const auction = SETTLEMENTS.filter(s => auctionTakes(data, item, s));
  return { shop, auction };
}

export function itemWhereText(data, item) {
  if (item.rarity === 'artifact') return 'Never for sale. Artifacts are found, stolen or fought over.';
  if (item.price == null) return 'Not sold.';
  const { shop, auction } = itemWhere(data, item);
  const bigger = s => SETTLEMENTS.slice(SETTLEMENTS.indexOf(s));
  const and = xs => xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0];
  const parts = [];
  if (shop) parts.push(shop === 'village' ? 'In shops everywhere, even villages.' : `In the shops of ${and(bigger(shop).map(s => settlementPlural(data, s)))}.`);
  if (auction.length) parts.push(`${shop ? 'Also at' : 'Only at'} auction, in ${and(auction.map(s => settlementPlural(data, s)))}.`);
  return parts.join(' ') || 'Not sold openly. Found in astral spaces and monster hoards, or made to order by a master crafter.';
}

/** Magic and world goods show their spirit coin price too; everyday goods are in gold, silver and copper. */
export function itemPriceText(item) {
  if (item.price == null) return item.rarity === 'artifact' ? 'priceless' : 'not sold';
  return item.rarity && item.rarity !== 'mundane' ? `${formatGp(item.price)} (${formatSpirit(item.price)} spirit coins)` : formatGp(item.price);
}

/** f: q (search), cat, rarity, where (a settlement, 'auction' or 'none'), source ('srd' or 'world'). */
export function filterItems(data, items, f = {}) {
  const q = String(f.q || '').trim().toLowerCase();
  return items.filter(i => {
    if (f.cat && i.cat !== f.cat) return false;
    if (f.rarity && (i.rarity || 'mundane') !== f.rarity) return false;
    if (f.source && i.source !== f.source) return false;
    if (f.where) {
      const w = itemWhere(data, i);
      if (f.where === 'auction' ? !w.auction.length : f.where === 'none' ? w.shop || w.auction.length : !soldIn(data, i, f.where)) return false;
    }
    if (q && ![i.name, i.desc, i.kind, i.cat, ...(i.tags || [])].some(x => String(x || '').toLowerCase().includes(q))) return false;
    return true;
  });
}

/** How often a shop stocks an item of each rarity: everyday goods are everywhere, magic is a find. */
const STOCK_WEIGHT = { mundane: 6, common: 3, uncommon: 1.5, rare: 0.6, 'very rare': 0.25, legendary: 0.1 };

const catalogMatch = (i, c) => (!c.magic || (i.rarity && i.rarity !== 'mundane'))
  && (!(c.cats || c.tags) || (c.cats || []).includes(i.cat) || (c.tags || []).some(t => (i.tags || []).includes(t)))
  && !(c.not || []).some(t => (i.tags || []).includes(t));

/** The catalogue items a stall of this kind could stock in a settlement of this kind. */
export const stallStock = (data, catalog, settlement) => itemCatalog(data).filter(i => catalogMatch(i, catalog) && soldIn(data, i, settlement));

function weightedSample(rng, pool, n, w) {
  const left = [...pool];
  const out = [];
  while (left.length && out.length < n) { const x = weighted(rng, left, w); out.push(x); left.splice(left.indexOf(x), 1); }
  return out;
}

const catalogGood = (i, price) => ({ kind: 'item', name: i.name, catalog: true, rarity: i.rarity, attune: i.attune || undefined, detail: i.desc.replace(/\.$/, ''), price, magic: !!i.rarity && i.rarity !== 'mundane' });

// ----- market -----

function marketBank(data) {
  if (!data.market) throw new Error('The market list is missing. Reset "market" under Generator lists.');
  return data.market;
}

function marketGoods(data, mkt, stall, rng, opts) {
  const B = marketBank(data);
  const level = B.rankLevel[mkt.rank] || 3;
  const cap = maxStoneSpellLevel(level);
  const mult = B.prices.wealth[mkt.wealth] || 1;
  const price = base => roundPrice(base * mult * (0.85 + rng() * 0.4));
  const S = B.stalls.find(s => s.type === stall.type);
  const n = int(rng, ...(S.count || [3, 5]));
  const theme = opts.theme && opts.theme !== 'any' ? opts.theme : null;
  const out = [];
  if (S.goods === 'essences') {
    const seen = new Set();
    // A settlement's shops only carry essences up to its rarity; the rest go to auction.
    const top = settlementInfo(data, mkt.settlement)?.essenceMax;
    const scarce = magicLevel(data, mkt.magic).rareStock ?? 1;
    const rarities = top ? ESSENCE_ORDER.slice(0, ESSENCE_ORDER.indexOf(top) + 1) : null;
    for (let i = 0; i < n * 6 && out.length < n; i++) {
      const e = lootEssence(data, theme && chance(rng, 0.6) ? theme : null, mkt.rank, rng, rarities);
      // In a low-magic place, rare essences turn up less often.
      if (e && ['rare', 'legendary'].includes(e.rarity) && rng() > scarce) continue;
      if (!e || seen.has(e.name)) continue;
      seen.add(e.name);
      out.push({ kind: 'essence', name: `${e.name} essence`, essence: e.name, detail: `${e.rarity}, ${e.affinity}. ${e.theme.replace(/\.$/, '')}. Grants **${e.grant.name || 'a proficiency'}**`, price: price(B.prices.essence[e.rarity] || 2500), magic: true });
    }
  } else if (S.goods === 'stones') {
    const seen = new Set();
    for (let i = 0; i < n * 5 && out.length < n; i++) {
      const aff = theme && chance(rng, 0.5) ? theme : pick(rng, essenceThemes(data));
      const lvl = weighted(rng, Array.from({ length: cap }, (_, k) => k + 1), l => (1 / l) * (l >= 3 ? magicLevel(data, mkt.magic).rareStock ?? 1 : 1));
      const spells = themeStoneSpells(data, aff)[lvl] || [];
      if (!spells.length) continue;
      const spell = pick(rng, spells);
      if (seen.has(spell)) continue;
      seen.add(spell);
      out.push({ kind: 'stone', name: `${aff} awakening stone`, affinity: aff, spell, level: lvl, detail: `*${spell}*, level ${lvl}. Awakens on any ${aff}-affinity essence`, price: price(B.prices.stone[lvl]), magic: true });
    }
    out.sort((a, b) => a.level - b.level);
  } else if (S.goods === 'cores') {
    const ranks = ['Iron', 'Bronze', 'Silver'].filter(r => RANKS.indexOf(r) <= RANKS.indexOf(mkt.rank) && B.prices.core[r]);
    for (const r of ranks.slice(0, n + 1)) {
      const stock = r === 'Iron' ? int(rng, 4, 30) : r === 'Bronze' ? int(rng, 1, 6) : int(rng, 0, 1);
      if (stock) out.push({ kind: 'core', name: `${r} monster core`, rank: r, detail: `${stock} in stock, sold singly`, price: price(B.prices.core[r]), magic: true });
    }
  } else if (S.goods === 'food' && data.food) {
    // Street food: everyday snacks and monster ones, from creatures a market of this wealth can get.
    const crMax = { poor: 1, common: 4, wealthy: 9 }[mkt.wealth] ?? 4;
    const picked = [];
    for (let i = 0; i < n * 3 && out.length < n; i++) {
      const d = pickDish(data, rng, { course: 'street', monster: chance(rng, 0.5), crMax, avoid: picked });
      if (!d || picked.includes(d.name)) continue;
      picked.push(d.name);
      if (d.monster) picked.push(d.monster);
      out.push({ kind: 'item', name: d.name, detail: [d.note && capitalize(d.note), d.effect && d.effect.replace(/\.$/, '')].filter(Boolean).join('. '), price: price(dishPrice(data, d, S.base || 0.1)) });
    }
  } else {
    const ctx = venueCtx(data, opts, rng);
    // Catalogue goods the settlement's shops can sell, and the stall's own oddments and services.
    const stock = S.catalog && data.items ? stallStock(data, S.catalog, mkt.settlement) : [];
    const own = (S.items || []).filter(([name]) => !stock.length || !itemInfo(data, name));
    const share = !stock.length ? 1 : !own.length ? 0 : S.catalog.flavour ?? 0.25;
    let nOwn = 0;
    for (let i = 0; i < n; i++) if (chance(rng, share)) nOwn++;
    const mw = S.catalog?.magicWeight ?? 1;
    const lvl = magicLevel(data, mkt.magic);
    const weight = i => (STOCK_WEIGHT[i.rarity || 'mundane'] ?? 0.1) * (i.rarity && i.rarity !== 'mundane' ? mw : 1)
      * (rarityAt(i.rarity) >= rarityAt('rare') ? lvl.rareStock ?? 1 : 1) * (i.rank ? lvl.rankScale?.[i.rank] ?? 1 : 1);
    for (const it of weightedSample(rng, stock, n - nOwn, weight)) out.push(catalogGood(it, price(it.price)));
    for (const [name, base] of sample(rng, own, n - out.length)) out.push({ kind: 'item', name: fillVenue(name, ctx), price: price(base) });
  }
  return out;
}

function marketStall(data, mkt, type, rng, opts) {
  const B = marketBank(data);
  const S = B.stalls.find(s => s.type === type);
  const ctx = venueCtx(data, opts, rng);
  // Keepers get names of their own, not a market full of one family.
  const taken = (mkt.stalls || []).map(x => x.keeper.name.split(' ').pop());
  let keeper;
  for (let i = 0; i < 6 && (!keeper || taken.includes(keeper.name.split(' ').pop())); i++) keeper = venuePerson(data, S.role || pick(rng, B.keeperRoles), opts, rng);
  const used = (mkt.stalls || []).map(x => x.haggle?.[0]);
  const stall = { type, keeper, look: pick(rng, S.looks), haggle: pickNew(rng, B.haggle, B.haggle.filter(h => used.includes(h[0]))).map(t => fillVenue(t, ctx)) };
  stall.name = fillTitle(pick(rng, S.names), ctx, { keeper: keeper.name.split(' ')[0] });
  stall.goods = marketGoods(data, mkt, stall, rng, opts);
  return stall;
}

function marketStallTypes(data, kind, rng) {
  const B = marketBank(data);
  const weights = Object.entries(kind.stalls).filter(([t]) => B.stalls.some(s => s.type === t));
  const n = int(rng, 4, 6);
  const types = [];
  while (types.length < n && types.length < weights.length) {
    const t = weighted(rng, weights.filter(([x]) => !types.includes(x)), ([, w]) => w)[0];
    types.push(t);
  }
  return types;
}

const MARKET_PARTS = ['feel', 'event', 'rumours', 'secret'];

function marketPart(data, m, part, rng, opts) {
  const B = marketBank(data);
  const ctx = venueCtx(data, opts, rng);
  if (part === 'feel') m.feel = ['sights', 'sounds', 'smells'].map(k => fillVenue(pick(rng, B.feel[k]), ctx));
  if (part === 'event') m.event = fillVenue(pick(rng, B.events), ctx);
  if (part === 'rumours') m.rumours = sample(rng, B.rumours, 3).map(t => fillVenue(t, ctx));
  if (part === 'secret') {
    m.secret = fillVenue(pick(rng, B.secrets), ctx);
    // Now and then one magical item is a fake; black markets are full of them.
    const magic = m.stalls.flatMap((s, i) => s.goods.map((g, j) => ({ g, i, j }))).filter(x => x.g.magic && x.g.kind !== 'core');
    m.stalls.forEach(s => s.goods.forEach(g => delete g.fake));
    if (magic.length && chance(rng, m.kindName === 'Black market' ? 0.9 : 0.35)) pick(rng, magic).g.fake = true;
  }
  const s = /^(stall|goods|keeper|haggle):(\d+)$/.exec(part);
  if (s) {
    const i = Number(s[2]);
    const st = m.stalls[i];
    if (s[1] === 'stall') {
      const kind = B.kinds.find(k => k.name === m.kindName) || B.kinds[0];
      const types = Object.keys(kind.stalls).filter(t => B.stalls.some(x => x.type === t));
      m.stalls[i] = marketStall(data, m, pickNew(rng, types, m.stalls.map(x => x.type)), rng, opts);
    }
    if (s[1] === 'goods') st.goods = marketGoods(data, m, st, rng, opts);
    if (s[1] === 'keeper') { const old = st.keeper.name.split(' ')[0]; st.keeper = venuePerson(data, B.stalls.find(x => x.type === st.type).role || 'Merchant', opts, rng); st.name = st.name.replace(old, st.keeper.name.split(' ')[0]); }
    if (s[1] === 'haggle') { const used = m.stalls.map(x => x.haggle[0]); st.haggle = pickNew(rng, B.haggle, B.haggle.filter(h => used.includes(h[0]))).map(t => fillVenue(t, ctx)); }
  }
  return m;
}

/** opts: where (a wiki location), kind (a market kind or 'any'), rank (of magical goods), theme (an affinity), wiki. */
export function generateMarket(data, opts = {}, rng = Math.random) {
  const B = marketBank(data);
  const ctx = venueCtx(data, opts, rng);
  // The settlement sets what can be sold: chosen, or known from the place, or else suited to the kind of market.
  let settlement = SETTLEMENTS.includes(opts.settlement) ? opts.settlement : settlementFor(data, ctx.here, opts.whereMeta);
  const fits = k => !settlement || !k.settlements || k.settlements.includes(settlement);
  const kinds = B.kinds.filter(k => opts.kind === k.name || ((!opts.kind || opts.kind === 'any') && !k.dm && fits(k)));
  const kind = pick(rng, kinds.length ? kinds : B.kinds);
  if (!settlement) {
    const byWealth = { poor: 'village', common: 'town', wealthy: 'city' }[kind.wealth] || 'town';
    settlement = !kind.settlements || kind.settlements.includes(byWealth) ? byWealth : kind.settlements[0];
  }
  // Without a chosen rank, goods follow the settlement: villages sell Iron-rank goods, great cities reach Silver.
  // A low-magic place has fewer high-rank goods within the same cap.
  const magic = placeMagic(data, ctx.here, opts.whereMeta);
  const scale = magicLevel(data, magic).rankScale || {};
  const ranks = Object.entries(settlementInfo(data, settlement)?.ranks || { Iron: 6, Bronze: 3, Silver: 1 }).map(([r, w]) => [r, w * (scale[r] ?? 1)]);
  const rank = opts.rank && opts.rank !== 'any' ? opts.rank : kind.wealth === 'poor' ? 'Iron' : weighted(rng, ranks, x => x[1])[0];
  const m = { kind: 'market', kindName: kind.name, where: ctx.here, settlement, settlementLabel: settlementInfo(data, settlement)?.label, magic, wealth: kind.wealth, rank, name: fillTitle(pick(rng, kind.names), ctx), stalls: [] };
  for (const t of marketStallTypes(data, kind, rng)) m.stalls.push(marketStall(data, m, t, rng, opts));
  for (const p of MARKET_PARTS) marketPart(data, m, p, rng, opts);
  return m;
}

export function rerollMarket(data, m, part, rng = Math.random, opts = {}) {
  const copy = structuredClone(m);
  if (part === 'name') { const ctx = venueCtx(data, { ...opts, where: m.where }, rng); copy.name = fillTitle(pick(rng, marketBank(data).kinds.find(k => k.name === m.kindName).names), ctx); return copy; }
  return marketPart(data, copy, part, rng, { ...opts, where: m.where });
}

/** interactive: adds reroll buttons and Buy buttons for the generator screen. linkPeople: keepers saved as pages are linked. */
export function marketToMarkdown(m, { interactive = false, linkPeople = false } = {}) {
  const re = (part, label = 'Reroll') => interactive ? ` <button class="mini-reroll" data-part="${part}" title="${label}">↻</button>` : '';
  const L = [];
  const sLabel = m.settlementLabel || m.settlement;
  const lowMagic = m.magic === 'low' ? ' Low magic here: rare goods are scarce, and high-rank goods rarer still.' : '';
  L.push(`*${m.kindName}${m.where ? ` in [[${m.where}]]` : ''}${sLabel ? `${m.where ? ', a' : ' in a'} ${sLabel.toLowerCase()}` : ''}. ${capitalize(m.wealth)} prices; essences, stones and cores up to ${m.rank} rank. Magical goods are priced in spirit coins (1 iron = 1 gp, 1 bronze = 100 gp, 1 silver = 10,000 gp).${lowMagic}*`, '');
  L.push(`${m.feel.join(' ')}${re('feel', 'New sights, sounds and smells')}`, '');
  L.push('## Stalls', '');
  m.stalls.forEach((s, i) => {
    L.push(`### ${s.name} (${s.type.toLowerCase()})${re(`stall:${i}`, 'A different stall')}`, '');
    L.push(s.look, '');
    L.push(`**Keeper:** ${personLine(s.keeper, linkPeople)}${re(`keeper:${i}`, 'New keeper')}`, '');
    L.push(`**Haggling:** *${s.haggle[0]}.* ${s.haggle[1]}${re(`haggle:${i}`, 'New haggling style')}`, '');
    if (interactive) L.push(`<span class="goods-head">Goods${re(`goods:${i}`, 'New stock')}</span>`, '');
    s.goods.forEach((g, j) => {
      const price = g.magic ? formatSpirit(g.price) : formatGp(g.price);
      const buy = interactive && (g.magic || g.catalog) && !g.sold ? ` <button class="buy-btn" data-buy="${i}:${j}">Buy</button>` : '';
      const name = g.catalog ? `**[[${g.name}]]**${g.magic ? ` (${g.rarity}${g.attune ? ', attunement' : ''})` : ''}` : `**${g.name}**`;
      L.push(`- ${name}${g.detail ? `: ${g.detail}` : ''}. *${price}*${g.sold ? ` (sold to ${g.sold})` : ''}${buy}`);
    });
    L.push('');
  });
  L.push(`## Happening${re('event', 'Something else happens')}`, '', m.event, '');
  L.push(`## Rumours${re('rumours', 'New rumours')}`, '', ...m.rumours.map(r => `- ${r}`), '');
  const fake = m.stalls.flatMap(s => s.goods.filter(g => g.fake).map(g => ({ s, g })))[0];
  L.push(':::dm', `## DM notes${re('secret', 'New secret')}`, '', `- ${m.secret}`);
  if (fake) L.push(`- The **${fake.g.name}** at ${fake.s.name} is a fake${fake.g.kind === 'essence' ? ': a dyed monster core in a velvet box. It does nothing when absorbed, and the keeper knows' : ': it crumbles to dust after one use, and the keeper knows'}. A DC 15 Arcana check, or a Magic Society appraisal, spots it.`);
  for (const s of m.stalls) if (s.keeper.secrets?.[0]) L.push(`- ${s.keeper.name.split(' ')[0]} (${s.name}): ${s.keeper.secrets[0].replace(/\.$/, '')}.`);
  L.push(':::', '');
  return L.join('\n');
}

// ----- auction houses -----
// The rare and the exotic: magic items above what a city's shops sell, rare essences, high-level stones,
// big cores, fine gems and one-of-a-kind lots. Each lot has a hidden reserve and rival bidders with a limit.

function auctionBank(data) {
  if (!data.auction) throw new Error('The auction list is missing. Reset "auction" under Generator lists.');
  return data.auction;
}

const AUCTION_PRICES = { essence: { common: 2500, uncommon: 10000, rare: 50000, legendary: 250000 }, stone: { 1: 150, 2: 600, 3: 2500, 4: 10000, 5: 40000 }, core: { Iron: 60, Bronze: 6000, Silver: 600000 } };
const LOT_WEIGHT = { rare: 4, 'very rare': 2, legendary: 1 };

function lotGoods(data, a, kind, rng, opts) {
  const B = auctionBank(data);
  const st = B.stock[a.settlement];
  const P = data.market?.prices || AUCTION_PRICES;
  const taken = a.lots.map(l => l.name);
  const theme = opts.theme && opts.theme !== 'any' ? opts.theme : null;
  if (kind === 'magic' || kind === 'gem') {
    const pool = itemCatalog(data).filter(i => i.price != null && !taken.includes(i.name)
      && (kind === 'gem' ? i.cat === 'Gems' && i.price >= (st.gemMin || 1000) : st.rarities.includes(i.rarity)));
    if (!pool.length) return null;
    // Lots the city's own shops already sell turn up less often; an auction is for what can't be bought.
    const i = weighted(rng, pool, x => (LOT_WEIGHT[x.rarity] ?? 1) * (soldIn(data, x, a.settlement) ? 0.4 : 1));
    return { ...catalogGood(i, i.price), cat: i.cat, magic: true, kind: 'item', estimate: i.price, what: kind === 'gem' ? 'gemstone' : `${i.rarity} ${(i.kind || 'magic item').toLowerCase()}${i.attune ? ', needs attunement' : ''}` };
  }
  if (kind === 'essence') {
    const e = lootEssence(data, theme && chance(rng, 0.5) ? theme : null, 'Diamond', rng, st.essences);
    if (!e || taken.includes(`${e.name} essence`)) return null;
    return { kind: 'essence', name: `${e.name} essence`, essence: e.name, magic: true, rarity: e.rarity, what: `${e.rarity} essence, ${e.affinity} affinity`, detail: `${e.theme.replace(/\.$/, '')}. Grants **${e.grant?.name || 'a proficiency'}**`, estimate: (P.essence[e.rarity] || 50000) * 1.25 };
  }
  if (kind === 'stone') {
    const aff = theme && chance(rng, 0.5) ? theme : pick(rng, essenceThemes(data));
    const level = pick(rng, st.stones);
    const spells = themeStoneSpells(data, aff)[level] || [];
    if (!spells.length) return null;
    const spell = pick(rng, spells);
    if (a.lots.some(l => l.spell === spell)) return null;
    return { kind: 'stone', name: `${aff} awakening stone`, affinity: aff, spell, level, magic: true, what: `awakening stone, level ${level}`, detail: `*${spell}*. Awakens on any ${aff}-affinity essence`, estimate: (P.stone[level] || 10000) * 1.25 };
  }
  if (kind === 'core') {
    const rank = pick(rng, st.cores);
    const count = rank === 'Silver' ? 1 : int(rng, 3, 12);
    if (taken.some(t => t.includes(`${rank} monster core`))) return null;
    return { kind: 'core', name: count > 1 ? `${count} ${rank} monster cores` : `${cap1(aOrAn(rank))} ${rank} monster core`, rank, count, magic: true, what: `${rank}-rank cores, sold as one lot`, detail: rank === 'Silver' ? 'Flawless, and enough to train a Silver-ranker for weeks' : 'Matched in size and clarity', estimate: (P.core[rank] || 6000) * count };
  }
  if (kind === 'exotic') {
    const left = list(B.exotica).filter(([n]) => !taken.includes(n));
    if (!left.length) return null;
    const [name, base, detail] = pick(rng, left);
    return { kind: 'item', name, exotic: true, magic: true, what: 'one of a kind', detail: detail.replace(/\.$/, ''), estimate: base };
  }
  return null;
}

function auctionLot(data, a, kind, rng, opts) {
  const B = auctionBank(data);
  const ctx = venueCtx(data, opts, rng);
  let lot = null;
  for (let i = 0; i < 12 && !lot; i++) lot = lotGoods(data, a, i < 6 ? kind : 'magic', rng, opts);
  if (!lot) return null;
  // The estimate is the house's guess; the reserve is the seller's secret floor; each rival has a limit they won't pass.
  lot.estimate = roundPrice(lot.estimate * (0.9 + rng() * 0.3));
  lot.opening = roundPrice(lot.estimate * (0.4 + rng() * 0.2));
  lot.reserve = roundPrice(lot.estimate * (0.7 + rng() * 0.3));
  lot.provenance = fillVenue(pick(rng, B.provenance), ctx);
  lot.rivals = sample(rng, B.rivals, int(rng, 1, 3)).map(r => ({ who: fillVenue(r, ctx, false), limit: roundPrice(lot.estimate * (0.7 + rng() * 0.8)) })).sort((x, y) => y.limit - x.limit);
  lot.win = roundPrice(Math.max(lot.reserve, lot.rivals[0].limit) * 1.05);
  delete lot.price;
  return lot;
}

const AUCTION_PARTS = ['look', 'auctioneer', 'rules', 'event', 'secret'];

function auctionPart(data, a, part, rng, opts) {
  const B = auctionBank(data);
  const ctx = venueCtx(data, opts, rng);
  if (part === 'look') a.look = fillVenue(pick(rng, B.looks), ctx);
  if (part === 'auctioneer') { a.auctioneer = venuePerson(data, 'Merchant', opts, rng); a.style = pick(rng, B.auctioneerStyles); }
  if (part === 'rules') a.rules = sample(rng, B.rules, 4).map(t => fillVenue(t, ctx));
  if (part === 'event') a.event = fillVenue(pick(rng, B.events), ctx);
  if (part === 'secret') {
    a.secret = fillVenue(pick(rng, B.secrets), ctx);
    a.lots.forEach(l => delete l.fake);
    // Now and then one lot is a forgery, made well enough to fool the house.
    const fakeable = a.lots.filter(l => l.kind !== 'core');
    if (fakeable.length && chance(rng, 0.4)) pick(rng, fakeable).fake = true;
  }
  const l = /^lot:(\d+)$/.exec(part);
  if (l) {
    const i = Number(l[1]);
    const old = a.lots[i];
    const kind = old.kind === 'essence' ? 'essence' : old.kind === 'stone' ? 'stone' : old.kind === 'core' ? 'core' : old.exotic ? 'exotic' : old.cat === 'Gems' ? 'gem' : 'magic';
    const others = { ...a, lots: a.lots.filter((_, j) => j !== i).concat([old]) };
    a.lots[i] = auctionLot(data, others, kind, rng, opts) || old;
  }
  return a;
}

/** opts: where (a wiki location), settlement ('city', 'great city' or auto), theme (an affinity), wiki. */
export function generateAuction(data, opts = {}, rng = Math.random) {
  const B = auctionBank(data);
  const ctx = venueCtx(data, opts, rng);
  const placeIs = settlementFor(data, ctx.here, opts.whereMeta);
  // Auction houses belong to cities. A sale somewhere smaller is a travelling one, with city stock.
  const settlement = B.stock[opts.settlement] ? opts.settlement : B.stock[placeIs] ? placeIs : 'city';
  const a = {
    kind: 'auction', where: ctx.here, settlement, settlementLabel: settlementInfo(data, settlement)?.label || settlement,
    travelling: !!placeIs && !B.stock[placeIs] ? settlementInfo(data, placeIs)?.label || placeIs : null,
    premium: B.premium ?? 0.1, name: fillTitle(pick(rng, B.names), ctx), lots: [],
  };
  const st = B.stock[settlement];
  // A low-magic city's sales are smaller: about half the lots.
  a.magic = placeMagic(data, ctx.here, opts.whereMeta);
  const share = a.travelling ? 1 : magicLevel(data, a.magic).rareStock ?? 1;
  const n = Math.max(3, Math.round(int(rng, ...(st.lots || [6, 8])) * Math.min(1, share)));
  const kinds = Object.entries(B.lotKinds || { magic: 1 });
  for (let i = 0; i < n; i++) {
    const kind = i < 2 ? 'magic' : weighted(rng, kinds, x => x[1])[0];
    const lot = auctionLot(data, a, kind, rng, opts);
    if (lot) a.lots.push(lot);
  }
  // The sale builds to its best lot.
  a.lots.sort((x, y) => x.estimate - y.estimate);
  for (const p of AUCTION_PARTS) auctionPart(data, a, p, rng, opts);
  return a;
}

export function rerollAuction(data, a, part, rng = Math.random, opts = {}) {
  const copy = structuredClone(a);
  if (part === 'name') { copy.name = fillTitle(pick(rng, auctionBank(data).names), venueCtx(data, { ...opts, where: a.where }, rng)); return copy; }
  return auctionPart(data, copy, part, rng, { ...opts, where: a.where });
}

export function auctionToMarkdown(a, { interactive = false, linkPeople = false } = {}) {
  const re = (part, label = 'Reroll') => interactive ? ` <button class="mini-reroll" data-part="${part}" title="${label}">↻</button>` : '';
  const pct = Math.round(a.premium * 100);
  const L = [];
  L.push(`*${a.travelling ? `Travelling auction in [[${a.where}]]` : `Auction house${a.where ? ` in [[${a.where}]], a` : ' in a'} ${a.settlementLabel.toLowerCase()}`}. Bids are called in spirit coins (1 iron = 1 gp, 1 bronze = 100 gp, 1 silver = 10,000 gp), and the winner pays a ${pct}% buyer's premium on top.*`, '');
  if (a.magic === 'low' && !a.travelling) L.push(`*${a.where || 'This place'} is low in magic, so its sales are small and its best lots are hard to keep powered.*`, '');
  if (a.travelling) L.push(`*${a.where} is a ${a.travelling.toLowerCase()} with no auction house of its own. This is a travelling sale passing through, with ${a.settlementLabel.toLowerCase()} stock, and it won't be back for months.*`, '');
  L.push(`${a.look}${re('look', 'A different hall')}`, '');
  L.push(`**Auctioneer:** ${personLine(a.auctioneer, linkPeople)} *Style:* ${a.style}${re('auctioneer', 'New auctioneer')}`, '');
  L.push(`## House rules${re('rules', 'Different rules')}`, '', ...a.rules.map(r => `- ${r}`), `- The buyer's premium is ${pct}% of the hammer price.`, '');
  L.push('## Lots', '');
  a.lots.forEach((l, i) => {
    L.push(`### Lot ${i + 1}: ${l.catalog ? `[[${l.name}]]` : l.name}${re(`lot:${i}`, 'A different lot')}`, '');
    L.push(`*${capitalize(l.what)}.* ${l.detail}.`, '');
    L.push(`**Estimate:** ${formatSpirit(l.estimate)}. **Opening bid:** ${formatSpirit(l.opening)}.`, '');
    L.push(`**Provenance:** ${l.provenance}`, '');
    L.push(`**Bidding against:** ${l.rivals.map(r => r.who).join('; ')}.`, '');
    if (l.sold) L.push(`*Won by ${l.sold} for ${formatSpirit(l.paid)}, premium included.*`, '');
    else if (interactive) L.push(`<button class="buy-btn win-btn" data-win="${i}">Win this lot</button>`, '');
  });
  L.push(`## Happening${re('event', 'Something else happens')}`, '', a.event, '');
  L.push(':::dm', `## DM notes${re('secret', 'New secret')}`, '', `- ${a.secret}`);
  const fake = a.lots.findIndex(l => l.fake);
  if (fake >= 0) L.push(`- Lot ${fake + 1}, the **${a.lots[fake].name}**, is a forgery${a.lots[fake].kind === 'essence' ? ': a dyed monster core that does nothing when absorbed' : ': its magic is a glamour that fades within a week'}. The house doesn't know. A DC 18 Arcana check during the viewing, or a Magic Society appraisal, spots it.`);
  if (a.auctioneer.secrets?.[0]) L.push(`- The auctioneer, ${a.auctioneer.name.split(' ')[0]}: ${a.auctioneer.secrets[0].replace(/\.$/, '')}.`);
  L.push('', '| Lot | Reserve | Rival limits | Bid to win |', '|---|---|---|---|');
  a.lots.forEach((l, i) => L.push(`| ${i + 1}. ${l.name} | ${formatSpirit(l.reserve)} | ${l.rivals.map(r => formatSpirit(r.limit)).join('; ')} | ${formatSpirit(l.win)} |`));
  L.push('', 'A lot that doesn\'t reach its reserve is withdrawn. Rivals stop at their limit; a rival who is being shown up in public may go one bid further.', ':::', '');
  return L.join('\n');
}

// ---------- food ----------
// Everyday dishes by course, and monster dishes made by putting a creature from the monster list into a template
// that needs a part it has: legs, eggs, tentacles and so on. Monster dishes cost more the higher the monster's CR.

/** The monsters that can be cooked for a course, each with the dish templates that fit it. */
function cookable(data, { course, crMax = 30, kind = 'dishes' } = {}) {
  const F = data.food;
  if (!F) return [];
  const stats = new Map(list(data.monsters?.monsters).map(m => [m.name, m]));
  const out = [];
  for (const mon of list(F.monsters)) {
    const stat = stats.get(mon.name);
    if (!stat || stat.cr > crMax) continue;
    const dishes = list(F[kind]).filter(d => mon.parts.includes(d.part) && (!course || d.course === course));
    if (dishes.length) out.push({ mon, cr: stat.cr, dishes });
  }
  return out;
}

const dishName = (text, monster) => capitalize(text.replace(/\{monster\}/g, monster.toLowerCase()).replace(/\b(\w+) \1\b/i, '$1'));

/**
 * One dish. opts: course (main, side, sweet, street), monster (true for a monster dish, false for an everyday one),
 * crMax (the strongest monster the kitchen can get), rich (lean toward rarer monsters), avoid (names already chosen).
 */
export function pickDish(data, rng, { course = 'main', monster = false, crMax = 30, rich = false, avoid = [] } = {}) {
  const F = data.food;
  if (monster) {
    const pool = cookable(data, { course, crMax }).filter(c => !avoid.includes(c.mon.name));
    if (pool.length) {
      const c = weighted(rng, pool, x => rich ? 1 + x.cr : 1);
      const d = pick(rng, c.dishes);
      return { name: dishName(d.text, c.mon.name), course, monster: c.mon.name, cr: c.cr, note: c.mon.note || '', effect: (c.mon.effect || '').replace(/\.$/, '') };
    }
  }
  const earth = list(F?.earth?.[course]).filter(n => !avoid.includes(n));
  return earth.length ? { name: pick(rng, earth), course, cr: 0 } : null;
}

/** A dish's price: the kitchen's base price for a main, scaled by course and by the monster's CR. */
export function dishPrice(data, dish, base) {
  const course = data.food?.courses?.[dish.course] ?? 1;
  return base * course * (dish.monster ? 1 + dish.cr : 1);
}

const dishLine = d => `${d.name}${d.note ? `. *${capitalize(d.note)}.*` : ''}${d.effect ? ` **Effect:** ${d.effect}` : ''}`;

// ----- tavern -----

function tavernBank(data) {
  if (!data.tavern) throw new Error('The tavern list is missing. Reset "tavern" under Generator lists.');
  return data.tavern;
}

const TAVERN_PARTS = ['look', 'staff', 'patrons', 'entertainment', 'menu', 'event', 'rumours', 'hook', 'secret'];

function tavernPart(data, t, part, rng, opts) {
  const B = tavernBank(data);
  const kind = B.kinds.find(k => k.name === t.kindName) || B.kinds[0];
  const ctx = venueCtx(data, opts, rng);
  const church = t.church;
  const fill = (s, capFirst = true) => fillVenue(String(s).replace(/\{church\}/g, church ? linkTo(church) : '{church}'), ctx, capFirst);
  const Q = B.quality[t.quality] || B.quality.modest;
  if (part === 'name') {
    const N = B.names;
    const pattern = pick(rng, N.patterns.filter(p => t.owner || !p.includes('{owner}')));
    const noun = pick(rng, N.noun);
    t.name = fillTitle(pattern, ctx, { adj: pick(rng, N.adj), noun, noun2: pickNew(rng, N.noun, [noun]), owner: t.owner?.name.split(' ')[0] || 'Old Tam' });
  }
  if (part === 'look') { t.outside = fill(pick(rng, kind.outside)); t.inside = fill(pick(rng, kind.inside)); }
  if (part === 'owner') { const old = t.owner?.name.split(' ')[0]; t.owner = venuePerson(data, kind.church ? 'Priest' : 'Merchant', opts, rng); if (old) t.name = t.name.replace(old, t.owner.name.split(' ')[0]); }
  if (part === 'staff') t.staff = sample(rng, B.staff, 2);
  if (part === 'patrons') t.patrons = sample(rng, kind.patrons, 3).map((g, i) => `${fill(g, i === 0)}, ${fill(pick(rng, B.patronDetails), false)}`);
  if (part === 'entertainment') t.entertainment = fill(pick(rng, B.entertainment));
  if (part === 'menu') {
    const jit = p => roundPrice(p * (0.8 + rng() * 0.5));
    let food;
    if (data.food) {
      // Two mains (one cooked from a monster), then a side or a sweet, and a monster side or sweet when the kitchen has one.
      const F = data.food;
      const crMax = F.crLimit?.[t.quality] ?? 4;
      const rich = t.quality === 'wealthy' || t.quality === 'comfortable';
      const picks = [];
      const add = o => { const d = pickDish(data, rng, { crMax, rich, avoid: picks.flatMap(x => [x.name, x.monster]), ...o }); if (d && !picks.some(x => x.name === d.name)) picks.push(d); };
      add({ course: 'main', monster: true });
      add({ course: 'main' });
      if (chance(rng, 0.75)) add({ course: 'main', monster: true });
      add({ course: pick(rng, ['side', 'sweet']), monster: chance(rng, 0.5) });
      add({ course: pick(rng, ['side', 'sweet']) });
      food = picks.map(d => ({ ...d, price: jit(dishPrice(data, d, Q.meal)) }));
    } else food = sample(rng, B.menu.food, 3).map(n => ({ name: n, price: jit(Q.meal) }));
    const drinks = sample(rng, B.menu.drink, 3).map(n => ({ name: n, price: jit(/wine|brandy|toddy/i.test(n) ? Q.wine : Q.ale) }));
    // Now and then a drink is made from a monster too.
    const brewable = cookable(data, { kind: 'drinks', crMax: data.food?.crLimit?.[t.quality] ?? 4 });
    if (brewable.length && chance(rng, 0.4)) {
      const c = pick(rng, brewable);
      drinks[2] = { name: dishName(pick(rng, c.dishes).text, c.mon.name), monster: c.mon.name, cr: c.cr, price: jit(Q.ale * 3 * (1 + c.cr)) };
    }
    t.menu = {
      food,
      drink: drinks,
      special: chance(rng, 0.7) ? (([n, p]) => ({ name: n, price: p }))(pick(rng, B.menu.special)) : null,
      room: Q.room,
    };
  }
  if (part === 'event') t.event = fill(pick(rng, B.events));
  if (part === 'rumours') t.rumours = sample(rng, B.rumours, 3).map(fill);
  if (part === 'hook') t.hook = fill(pick(rng, B.hooks));
  if (part === 'secret') t.secret = fill(pick(rng, B.secrets));
  return t;
}

/** opts: where (a wiki location), kind (a tavern kind or 'any'), quality ('any' or poor, modest, comfortable, wealthy), wiki. */
export function generateTavern(data, opts = {}, rng = Math.random) {
  const B = tavernBank(data);
  const kinds = B.kinds.filter(k => !opts.kind || opts.kind === 'any' || k.name === opts.kind);
  const kind = weighted(rng, kinds.length ? kinds : B.kinds);
  const ctx = venueCtx(data, opts, rng);
  const quality = opts.quality && opts.quality !== 'any' ? opts.quality : kind.quality;
  const t = { kind: 'tavern', kindName: kind.name, where: ctx.here, quality, church: kind.church ? ctx.churchName() : null };
  tavernPart(data, t, 'owner', rng, opts);
  tavernPart(data, t, 'name', rng, opts);
  for (const p of TAVERN_PARTS) tavernPart(data, t, p, rng, opts);
  return t;
}

export function rerollTavern(data, t, part, rng = Math.random, opts = {}) {
  return tavernPart(data, structuredClone(t), part, rng, { ...opts, where: t.where });
}

export function tavernToMarkdown(t, { interactive = false, linkPeople = false } = {}) {
  const re = (part, label = 'Reroll') => interactive ? ` <button class="mini-reroll" data-part="${part}" title="${label}">↻</button>` : '';
  const L = [];
  L.push(`*${t.kindName}${t.where ? ` in [[${t.where}]]` : ''}${t.church ? `, run by the [[${t.church}]]` : ''}. ${capitalize(t.quality)} prices.*`, '');
  L.push(`${t.outside} ${t.inside}${re('look', 'New look')}`, '');
  L.push(`**Owner:** ${personLine(t.owner, linkPeople)}${re('owner', 'New owner')}`, '');
  L.push(`**Staff:** ${t.staff.join('; ')}.${re('staff', 'New staff')}`, '');
  L.push('## Tonight', '');
  L.push(`- **In the room:** ${t.patrons.join('; ')}.${re('patrons', 'New patrons')}`);
  L.push(`- **Entertainment:** ${t.entertainment}${re('entertainment', 'New entertainment')}`);
  L.push(`- **Happening:** ${t.event}${re('event', 'Something else happens')}`, '');
  L.push(`## Menu${re('menu', 'New menu')}`, '', '| Food and drink | Price |', '| --- | --- |');
  for (const x of [...t.menu.food, ...t.menu.drink]) L.push(`| ${dishLine(x)} | ${formatGp(x.price)} |`);
  L.push(`| Room for the night | ${formatGp(t.menu.room)} |`, '');
  if (t.menu.special) L.push(`**House special:** ${t.menu.special.name} *${formatGp(t.menu.special.price)}*`, '');
  L.push(`## Rumours${re('rumours', 'New rumours')}`, '', ...t.rumours.map(r => `- ${r}`), '');
  L.push(`## Hook${re('hook', 'New hook')}`, '', t.hook, '');
  L.push(':::dm', `## DM notes${re('secret', 'New secret')}`, '', `- ${t.secret}`);
  if (t.owner.secrets?.[0]) L.push(`- ${t.owner.name.split(' ')[0]}'s own secret: ${t.owner.secrets[0].replace(/^[A-Z]/, c => c.toLowerCase()).replace(/\.$/, '')}.`);
  L.push(':::', '');
  return L.join('\n');
}

// ---------- carried essences ----------
// A bought or found essence is carried, not absorbed. Absorbing it takes a ritual in a safe place over a long rest,
// and only then does it fill a slot. Divine essences are the exception: the god grants them straight into a slot.

/** Add an essence to a character's carried essences. Returns an error message, or null. */
export function carryEssence(meta, name) {
  const carried = [].concat(meta.carried || []);
  carried.push(name);
  meta.carried = carried;
  return null;
}

/** Finish the absorption ritual: move one carried essence into the first empty slot. Returns an error message, or null. */
export function absorbEssence(meta, name) {
  const carried = [].concat(meta.carried || []);
  const at = carried.indexOf(name);
  if (at < 0) return `${meta.title || 'They'} isn't carrying ${name}.`;
  const ess = [].concat(meta.essences || []);
  if (ess.some(e => e && e.toLowerCase() === name.toLowerCase())) return `${meta.title || 'They'} already has ${name}. The same essence can't be absorbed twice.`;
  const slot = [0, 1, 2].find(k => !ess[k]);
  if (slot === undefined) return `${meta.title || 'They'} has no empty essence slot.`;
  ess[slot] = name;
  carried.splice(at, 1);
  meta.essences = ess.map(x => x || '');
  meta.carried = carried;
  return null;
}

// ---------- dice rolling and the battle tracker ----------
// Dice expressions like "2d6 + 3", "d20+5" or "1d8 + 2d6 - 1"; attack lines from stat blocks; and the battle's
// order of play. The app draws them; these only do the arithmetic.

const DIE_TERM = /([+-]?)\s*(?:(\d*)d(\d+)|(\d+))/gi;

/** Parse a dice expression into dice terms and a flat modifier, or null if it isn't one. */
export function parseDice(expr) {
  const s = String(expr || '').replace(/\s+/g, '').replace(/−/g, '-');
  if (!s || !/^[+-]?(\d*d\d+|\d+)([+-](\d*d\d+|\d+))*$/i.test(s)) return null;
  const dice = [];
  let mod = 0;
  for (const m of s.matchAll(DIE_TERM)) {
    const sign = m[1] === '-' ? -1 : 1;
    if (m[3]) {
      const n = m[2] === '' ? 1 : Number(m[2]), d = Number(m[3]);
      if (!n || !d || n > 200 || d > 1000) return null;
      dice.push({ n, d, sign });
    } else mod += sign * Number(m[4]);
  }
  return dice.length || mod ? { dice, mod } : null;
}

/** Tidy text for a parsed expression: "2d6 + 3". */
export function diceText(p) {
  const parts = p.dice.map((t, i) => `${i ? (t.sign < 0 ? ' - ' : ' + ') : t.sign < 0 ? '-' : ''}${t.n}d${t.d}`);
  if (p.mod) parts.push(`${parts.length ? (p.mod < 0 ? ' - ' : ' + ') : p.mod < 0 ? '-' : ''}${Math.abs(p.mod)}`);
  return parts.join('');
}

/** Roll an expression. opts.crit doubles the dice (not the modifier); opts.mode 'adv' or 'dis' rolls a lone d20 twice. */
export function rollDice(expr, rng = Math.random, opts = {}) {
  const p = typeof expr === 'string' ? parseDice(expr) : expr;
  if (!p) return null;
  const terms = p.dice.map(t => {
    const n = opts.crit ? t.n * 2 : t.n;
    const rolls = Array.from({ length: n }, () => int(rng, 1, t.d));
    let kept = rolls.reduce((a, b) => a + b, 0);
    let dropped = null;
    if (opts.mode && t.d === 20 && t.n === 1) {
      const second = int(rng, 1, 20);
      const keep = opts.mode === 'adv' ? Math.max(rolls[0], second) : Math.min(rolls[0], second);
      dropped = keep === rolls[0] ? second : rolls[0];
      rolls[0] = keep; kept = keep;
    }
    return { ...t, rolls, dropped, sum: t.sign * kept };
  });
  const total = terms.reduce((a, t) => a + t.sum, 0) + p.mod;
  const natural = p.dice.length === 1 && p.dice[0].n === 1 && p.dice[0].d === 20 ? terms[0].rolls[0] : null;
  return { expr: diceText(p), terms, mod: p.mod, total, natural, crit: !!opts.crit };
}

/** Text for a roll's dice: "[4, 2] + 3", with a dropped advantage die struck out. */
export function rollBreakdown(r) {
  const parts = r.terms.map((t, i) => `${i ? (t.sign < 0 ? ' - ' : ' + ') : ''}[${t.rolls.join(', ')}${t.dropped != null ? `, ~~${t.dropped}~~` : ''}]`);
  if (r.mod) parts.push(`${r.mod < 0 ? ' - ' : ' + '}${Math.abs(r.mod)}`);
  return parts.join('');
}

/** What a stat block entry rolls: its attack bonus, any saving throw, and each damage with its type. */
export function attackOf(desc) {
  const text = String(desc || '');
  const hit = text.match(/([+-]\d+) to hit/i);
  const save = text.match(/DC (\d+) (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) saving throw/i);
  const damage = [];
  for (const m of text.matchAll(/\d+ \((\d+d\d+(?:\s*[+-−]\s*\d+)?)\)\s*([a-z]+)?(?: damage)?/gi)) {
    const p = parseDice(m[1]);
    if (p) damage.push({ expr: diceText(p), type: /^(acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder)$/i.test(m[2] || '') ? m[2].toLowerCase() : '' });
  }
  if (!hit && !save && !damage.length) return null;
  return { toHit: hit ? Number(hit[1]) : null, save: save ? { dc: Number(save[1]), ability: save[2] } : null, damage };
}

/** Roll an attack: to hit (a natural 20 doubles the damage dice), then every damage line. Beams, rays and darts
 * (atk.count) each roll on their own, as parts. */
export function rollAttack(atk, rng = Math.random, mode = '') {
  if ((Number(atk.count) || 1) > 1) {
    const parts = Array.from({ length: Number(atk.count) }, () => rollAttack({ ...atk, count: 1 }, rng, mode));
    const damage = parts.flatMap(x => x.damage);
    return { parts, hit: null, crit: false, miss: false, damage, total: damage.reduce((a, d) => a + d.total, 0), save: atk.save };
  }
  const hit = atk.toHit != null ? rollDice({ dice: [{ n: 1, d: 20, sign: 1 }], mod: atk.toHit }, rng, { mode }) : null;
  const crit = hit?.natural === 20;
  const miss = hit?.natural === 1;
  const damage = atk.damage.map(d => ({ ...rollDice(d.expr, rng, { crit }), type: d.type, ...(d.from ? { from: d.from } : {}) }));
  return { hit, crit, miss, damage, total: damage.reduce((a, d) => a + d.total, 0), save: atk.save };
}

export const CONDITIONS = ['Blinded', 'Charmed', 'Deafened', 'Exhaustion', 'Frightened', 'Grappled', 'Incapacitated', 'Invisible',
  'Paralyzed', 'Petrified', 'Poisoned', 'Prone', 'Restrained', 'Stunned', 'Unconscious', 'Concentrating'];

/** What each condition does, in short (2024 rules, in our own words), for the battle screen's condition dialog. */
export const CONDITION_RULES = {
  Blinded: "Can't see: automatically fails any check that needs sight. Attacks against it have advantage; its own attacks have disadvantage.",
  Charmed: "Can't attack the charmer or target them with harmful abilities or magic. The charmer has advantage on checks to interact with it socially.",
  Deafened: "Can't hear: automatically fails any check that needs hearing.",
  Exhaustion: "Levels 1-6, each adding up: -2 per level to every d20 test (attacks, checks, saves) and -5 ft. speed per level. Level 6 is death. A long rest removes one level.",
  Frightened: "Disadvantage on checks and attacks while the source of its fear is in sight. Can't willingly move closer to that source.",
  Grappled: "Speed 0. Disadvantage on attacks against anyone but the grappler. The grappler can drag it (moving costs them extra). Ends if the grappler is incapacitated or it's pulled out of reach.",
  Incapacitated: "Can't take actions, bonus actions or reactions, and its concentration breaks. Can't speak. Rolls initiative with disadvantage.",
  Invisible: "Can't be seen without magic: rolls initiative with advantage, attacks against it have disadvantage and its attacks have advantage (unless something can see it).",
  Paralyzed: "Incapacitated, speed 0, can't move or speak. Fails Strength and Dexterity saves. Attacks against it have advantage, and a hit from within 5 ft. is a critical hit.",
  Petrified: "Turned to stone with its gear: incapacitated, speed 0, weight x10, unaware of its surroundings. Attacks against it have advantage; fails Str and Dex saves; resists all damage and is immune to poison.",
  Poisoned: "Disadvantage on attack rolls and ability checks.",
  Prone: "Can only crawl, or stand up using half its speed. Disadvantage on its attacks. Attacks against it have advantage from within 5 ft. and disadvantage from farther away.",
  Restrained: "Speed 0. Disadvantage on its attacks and on Dexterity saves. Attacks against it have advantage.",
  Stunned: "Incapacitated and can't move. Fails Strength and Dexterity saves. Attacks against it have advantage.",
  Unconscious: "Incapacitated and prone, drops what it holds, unaware of its surroundings. Fails Str and Dex saves; attacks against it have advantage, and a hit from within 5 ft. is a critical hit.",
  Concentrating: "Holding a spell. Taking damage needs a Constitution save (DC 10 or half the damage, whichever is higher, up to 30) or the spell ends. Ends if incapacitated or it casts another concentration spell.",
};

// ----- spells that last -----
// A spell with a duration leaves an effect on whoever it lands on: a chip on the battle screen that lasts as long as
// the spell (or the caster's concentration). Some add damage to the holder's weapon hits while they last.

/** Spells that add damage to the weapon hits of whoever has them. who: 'self', 'allies' (an aura) or 'pick'. */
export const SPELL_BUFFS = {
  "crusader's mantle": { who: 'allies', dmg: '1d4', type: 'radiant' },
  'divine favor': { who: 'self', dmg: '1d4', type: 'radiant' },
  'spirit shroud': { who: 'self', dmg: '1d8', types: ['radiant', 'necrotic', 'cold'] },
  'elemental weapon': { who: 'pick', dmg: '1d4', types: ['acid', 'cold', 'fire', 'lightning', 'thunder'] },
  'holy weapon': { who: 'pick', dmg: '2d8', type: 'radiant' },
};
export const spellBuff = name => SPELL_BUFFS[String(name || '').toLowerCase()] || null;

/** How many rounds a spell lasts: "1 minute" is 10, "1 round" is 1; an hour or more (or instantaneous) is null. */
export function spellRounds(sp) {
  const m = String(sp?.duration || '').match(/(\d+|an?|one)\s+(round|minute|hour)s?/i);
  if (!m) return null;
  const n = numOf(m[1]) * ROUNDS_PER[m[2].toLowerCase()];
  return n <= 100 ? n : null;
}
/** Whether casting a spell leaves something to track: it isn't instantaneous. */
export const spellLasts = sp => !!sp && !/instantaneous/i.test(String(sp.duration || '')) && !!String(sp.duration || '').trim();

/** A monster ready for the battle tracker: its number, AC, HP (average or rolled) and initiative bonus. */
export function combatantFromMonster(m, rng = Math.random, { rollHp = false, label = '' } = {}) {
  const avg = Number(m.hp) || 1;
  const hd = parseDice(m.hitDice);
  const hp = rollHp && hd ? Math.max(1, rollDice(hd, rng).total) : avg;
  const dex = Number((m.abilities || [])[1]);
  return {
    kind: 'monster', name: label || m.name, monster: m.name, ac: parseInt(m.ac, 10) || 10, hp, hpMax: hp, temp: 0,
    initBonus: Number.isFinite(dex) ? Math.floor((dex - 10) / 2) : 0, init: null, conditions: [],
  };
}

/**
 * Battle order: highest initiative first, ties to the higher bonus; anyone without one yet goes last. A rider goes
 * just before its mount (on the mount's initiative), and a summon that shares its summoner's turn goes right after them.
 */
export function battleOrder(list) {
  const by = new Map(list.map(c => [c.id, c]));
  // A rider whose mount follows it (a summoned steed) leads the pair instead.
  const mountOf = c => c.ride && by.has(c.ride) && by.get(c.ride).after !== c.id ? c.ride : null;
  const leaderOf = c => c.after && by.has(c.after) && c.after !== c.id ? c.after : null;
  const base = list.filter(c => !mountOf(c) && !leaderOf(c)).sort((a, b) => {
    const ai = a.init == null || a.init === '' ? -Infinity : Number(a.init), bi = b.init == null || b.init === '' ? -Infinity : Number(b.init);
    return bi - ai || (Number(b.initBonus) || 0) - (Number(a.initBonus) || 0) || String(a.name).localeCompare(String(b.name));
  });
  const out = [], seen = new Set();
  const place = c => {
    if (seen.has(c.id)) return;
    seen.add(c.id);
    for (const r of list) if (mountOf(r) === c.id && !seen.has(r.id)) { seen.add(r.id); out.push(r); for (const f of list) if (leaderOf(f) === r.id) place(f); }
    out.push(c);
    for (const f of list) if (leaderOf(f) === c.id) place(f);
  };
  base.forEach(place);
  // Anything caught in a loop of links keeps its own place at the end.
  for (const c of list) if (!seen.has(c.id)) out.push(c);
  return out;
}
/** Riders and summons that share a turn carry the same initiative as whoever they go with. */
export function linkInit(list) {
  const by = new Map(list.map(c => [c.id, c]));
  for (let pass = 0; pass < 3; pass++) for (const c of list) {
    const to = c.ride && by.get(c.ride)?.after !== c.id ? by.get(c.ride) : c.after ? by.get(c.after) : null;
    if (to && to !== c && to.init != null && to.init !== '' && c.init !== to.init) c.init = to.init;
  }
  return list;
}

/** Whose turn comes next: skips defeated monsters, and starts a new round after the last. */
export function nextTurn(battle, step = 1) {
  const order = battleOrder(battle.list).filter(c => !(c.kind === 'monster' && Number(c.hp) <= 0));
  if (!order.length) return { ...battle, turn: null };
  let i = order.findIndex(c => c.id === battle.turn);
  let round = Number(battle.round) || 1;
  if (i < 0) return { ...battle, turn: order[0].id, round };
  i += step;
  if (i >= order.length) { i = 0; round++; }
  if (i < 0) { i = order.length - 1; round = Math.max(1, round - 1); }
  return { ...battle, turn: order[i].id, round };
}

/** Damage (positive) or healing (negative) to a combatant: temporary hit points soak damage first. */
export function applyHp(c, amount) {
  const out = { ...c };
  let n = Math.round(Number(amount) || 0);
  if (n > 0 && out.temp) { const soak = Math.min(out.temp, n); out.temp -= soak; n -= soak; }
  out.hp = Math.max(0, Math.min(Number(out.hpMax) || 0, (Number(out.hp) || 0) - n));
  return out;
}

/**
 * Temporary hit points from a new source: they don't stack, so a combatant keeps whichever is more. `{ temp, kept }`.
 */
export function gainTemp(c, amount) {
  const n = Math.max(0, Math.round(Number(amount) || 0)), had = Math.max(0, Number(c.temp) || 0);
  return n > had ? { temp: n, kept: false } : { temp: had, kept: true };
}

/** A name for one more of a monster: "Goblin" alone, then "Goblin 2", "Goblin 3"... (numbered from 1 when several arrive at once). */
export function numberedName(list, name, several = false) {
  const taken = new Set(list.map(c => c.name));
  if (!several && !taken.has(name) && !list.some(c => c.monster === name)) return name;
  let i = several && !list.some(c => c.monster === name) ? 1 : 2;
  while (taken.has(`${name} ${i}`)) i++;
  return `${name} ${i}`;
}

// ----- battle rules: health states, turns, damage, death saves, summaries -----

/** Battle settings a DM can change; anything missing falls back to these. */
export const BATTLE_DEFAULTS = {
  health: [
    { name: 'Bloodied', below: 50, color: '#f2a33a', flash: true },
    { name: 'Critical', below: 10, color: '#ff4d4d', flash: true },
  ],
  healthFor: 'enemies',
  conditionColors: {
    Blinded: '#8a8f98', Charmed: '#ff7ac8', Deafened: '#9aa4b2', Exhaustion: '#b08a5a', Frightened: '#b36bff', Grappled: '#d9a441',
    Incapacitated: '#7a7a7a', Invisible: '#bfe8ff', Paralyzed: '#ffd84d', Petrified: '#a0a0a0', Poisoned: '#5fd35f', Prone: '#c47a3a',
    Restrained: '#e08a2e', Stunned: '#ffe066', Unconscious: '#5a6b8c', Concentrating: '#4db8ff',
  },
  customColor: '#4dd0c8',
  auto: { durations: true, recharge: true, legendary: true, skipDefeated: true, concentration: true, deathSaves: true, resistances: true, seatChecks: true, enemyMounts: true },
  rankWard: 'auto',
  toSession: 'ask',
  player: { partyHp: true, enemyHealth: true, conditions: true },
  // AI mode: monsters suggest their own turns.
  ai: { finishDowned: false },
  // Animations for hits, misses, healing, turns and knockouts.
  effects: true,
};

export function battleSettings(saved) {
  const s = saved || {};
  const d = BATTLE_DEFAULTS;
  return {
    ...d, ...s,
    health: Array.isArray(s.health) ? s.health : d.health,
    conditionColors: { ...d.conditionColors, ...(s.conditionColors || {}) },
    auto: { ...d.auto, ...(s.auto || {}) },
    player: { ...d.player, ...(s.player || {}) },
    ai: { ...d.ai, ...(s.ai || {}) },
  };
}

const isEnemy = c => c.kind === 'monster';
/** The lowest health state a combatant is under ("Critical" before "Bloodied"), or null. Defeated creatures have none. */
export function healthState(c, settings) {
  if (!c.hpMax || c.hp <= 0 || c.kind === 'lair') return null;
  if (settings.healthFor !== 'everyone' && !isEnemy(c)) return null;
  const pct = (c.hp / c.hpMax) * 100;
  return [...settings.health].filter(h => h.name && Number(h.below) > 0).sort((a, b) => a.below - b.below).find(h => pct < Number(h.below)) || null;
}

/** A word for how hurt a creature looks, for the players' view. */
export function healthWord(c, settings) {
  if (c.hp <= 0) return 'Down';
  return healthState({ ...c, kind: 'monster' }, { ...settings, healthFor: 'everyone' })?.name || 'Healthy';
}

/** Conditions are kept as { name, rounds, ends }; older battles kept bare names. */
export const condOf = x => typeof x === 'string' ? { name: x, rounds: null, ends: 'start' } : x;

const COND_WORDS = ['blinded', 'charmed', 'deafened', 'frightened', 'grappled', 'incapacitated', 'invisible', 'paralyzed', 'petrified', 'poisoned', 'prone', 'restrained', 'stunned', 'unconscious'];
const ROUNDS_PER = { round: 1, minute: 10, hour: 600 };
const numOf = w => /^(a|an|one)$/i.test(w) ? 1 : Number(w) || numWord(w) || 1;

/**
 * The condition an attack, spell, item or trap causes, and for how long, from its rules text:
 * "must succeed on a DC 13 Constitution saving throw or be poisoned for 1 minute" → { name: 'Poisoned', rounds: 10, ends: 'start' }.
 * `duration` is a spell's own duration ("Concentration, up to 1 minute"), used when the text gives none. Null when it causes none.
 */
export function conditionIn(text, duration = '') {
  const t = String(text || '').replace(/\s+/g, ' ');
  const re = new RegExp(`\\b(${COND_WORDS.join('|')})\\b`, 'gi');
  for (const m of t.matchAll(re)) {
    const before = t.slice(Math.max(0, m.index - 40), m.index);
    // "immune to being frightened", "advantage on saves against being charmed", "can't be surprised" are not the effect.
    if (/(against|immune to|immunity to|can't be|cannot be|isn't|is not|while|unless|if (?:it|the target) is|ends? (?:the|its|being)|no longer|benefit from|doesn't have|does not have|without|removes?|ending|suppress(?:es)?)\s+(?:being\s+|the\s+)?(?:\w+\s+)?$/i.test(before)) continue;
    // "ends the Blinded, Deafened, and Poisoned conditions", "if it has the Invisible condition".
    if (/\b(?:ends?|removes?|ending|cures?|suppress(?:es)?)\s+(?:the\s+|one\s+)?(?:\w+,?\s+(?:and\s+|or\s+)?){0,4}$/i.test(before) && /^\w+(?:,? (?:and |or )?\w+)* conditions?\b/i.test(t.slice(m.index, m.index + 80))) continue;
    if (/\bif (?:it|the target|a creature|the creature) has (?:the\s+)?$/i.test(before)) continue;
    // The 2024 rules' "the Frightened condition ends".
    if (/^\w+ condition (?:ends|on (?:it|the target) ends)/i.test(t.slice(m.index, m.index + 40))) continue;
    const name = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
    const after = t.slice(m.index, m.index + 220);
    const sentence = after.split(/(?<=[.!?])\s/)[0] + ' ' + (after.split(/(?<=[.!?])\s/)[1] || '');
    let rounds = null, ends = 'start', note = '';
    const till = sentence.match(/until the (end|start) of (?:its|their|your|the target's|the [\w-]+'s|[\w-]+'s) next turn/i);
    const span = sentence.match(/for (\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten) (round|minute|hour)s?\b/i)
      || `${duration} ${t}`.match(/Duration\s*:?\s*(?:Concentration,?\s*)?(?:up to\s*)?(\d+|one|a|an)\s*(round|minute|hour)/i)
      || String(duration).match(/(\d+|one|a|an)\s*(round|minute|hour)/i);
    if (till) { rounds = 1; ends = till[1].toLowerCase(); }
    else if (span) rounds = numOf(span[1]) * ROUNDS_PER[span[2].toLowerCase()];
    if (/escape DC (\d+)/i.test(sentence)) note = `escape DC ${sentence.match(/escape DC (\d+)/i)[1]}`;
    if (/repeat the saving throw at the end of each of its turns/i.test(t)) note = [note, 'save again at the end of each of its turns'].filter(Boolean).join('; ');
    return { name, rounds, ends, ...(note ? { note } : {}) };
  }
  return null;
}

/** Whether a roll heals rather than hurts, from its name and rules text. */
/** Whether a roll gives temporary hit points rather than healing or damage: its name or rules text says so, and no damage type. */
export const tempHpIn = (name, text = '') => /\btemp(?:orary)? (?:hit points|HP)\b/i.test(`${name} ${text}`) && !/\b(?:acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder) damage\b/i.test(`${name} ${text}`);
export const healsIn = (name, text = '') => /\b(heal(?:s|ing)?|cure|regains?|restores? \d|potion of (?:greater |superior |supreme )?healing)\b/i.test(`${name} ${text}`) && !/\b(?:acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder) damage\b/i.test(`${name} ${text}`);

/** How many legendary actions a monster gets a round, from its stat block. */
export function legendaryCount(m) {
  if (!m?.legendary?.length) return 0;
  const n = String(m.legendaryIntro || '').match(/can take (\d+) legendary actions/i);
  return n ? Number(n[1]) : 3;
}

/** The roll an ability needs to come back: "Fire Breath (Recharge 5–6)" needs a 5. */
export function rechargeOf(name) {
  const m = String(name || '').match(/\(Recharge (\d)(?:\s*[–-]\s*\d)?\)/i);
  return m ? Number(m[1]) : null;
}

/** Abilities on a stat block that recharge on a die roll. */
export function recharges(m) {
  return ['actions', 'traits', 'reactions', 'legendary', 'bonusActions'].flatMap(k => (m?.[k] || [])).filter(a => rechargeOf(a.name)).map(a => ({ name: a.name, on: rechargeOf(a.name) }));
}

/** What a damage type does to a creature: 0 if immune, 0.5 if resistant, 2 if vulnerable, with a note. */
export function damageMultiplier(stat, type) {
  if (!stat || !type) return { mult: 1, note: '' };
  const has = field => new RegExp(`\\b${type}\\b`, 'i').test(String(stat[field] || ''));
  const iffy = field => /nonmagical|non-magical|silvered|adamantine/i.test(String(stat[field] || ''));
  if (has('immune')) return { mult: 0, note: `immune to ${type}${iffy('immune') ? ' (unless magical)' : ''}` };
  if (has('resist')) return { mult: 0.5, note: `resists ${type}${iffy('resist') ? ' (unless magical)' : ''}` };
  if (has('vulnerable')) return { mult: 2, note: `vulnerable to ${type}` };
  return { mult: 1, note: '' };
}

const RANK_STEP = ['Normal', 'Iron', 'Bronze', 'Silver', 'Gold', 'Diamond'];
/** The rank ward: a monster of a higher rank resists damage from a lower-rank attacker. */
export function rankWardApplies(attackerRank, targetRank) {
  if (!attackerRank || !targetRank || ['Normal', 'Iron'].includes(targetRank)) return false;
  return RANK_STEP.indexOf(attackerRank) < RANK_STEP.indexOf(targetRank);
}

/**
 * The damage multiplier once the rank ward's resistance is added: half damage, or normal damage where the
 * target is vulnerable (they cancel out). Like any 5e resistance it doesn't stack with one it already has.
 */
export const rankWardMultiplier = mult => (mult >= 1 ? mult / 2 : mult);

/** The DC to keep concentrating after taking damage. */
export const concentrationDC = dmg => Math.max(10, Math.floor(Number(dmg) / 2));

/** Record a death saving throw from a d20: 10+ succeeds, a 1 counts twice, a 20 brings them back with 1 HP. */
export function deathSave(c, d20) {
  const ds = { ok: 0, fail: 0, ...(c.death || {}) };
  if (d20 === 20) return { ...c, hp: 1, death: null, event: `${c.name} rolls a natural 20 and is back on their feet with 1 HP!` };
  if (d20 === 1) ds.fail += 2; else if (d20 >= 10) ds.ok++; else ds.fail++;
  ds.fail = Math.min(3, ds.fail); ds.ok = Math.min(3, ds.ok);
  const event = ds.fail >= 3 ? `${c.name} has died.` : ds.ok >= 3 ? `${c.name} is stable.` : `${c.name}'s death save: ${d20} (${ds.ok} saved, ${ds.fail} failed).`;
  return { ...c, death: { ...ds, dead: ds.fail >= 3, stable: ds.ok >= 3 }, event };
}

/** Things that happen when a turn starts or ends: conditions run out, recharges and legendary actions come back. */
export function turnEffects(c, when, settings, rng = Math.random) {
  const events = [];
  let out = { ...c, conditions: (c.conditions || []).map(condOf) };
  if (settings.auto.durations) {
    const kept = [];
    for (const k of out.conditions) {
      if (k.rounds != null && (k.ends || 'start') === when) {
        const left = Number(k.rounds) - 1;
        if (left <= 0) { events.push(`${c.name} is no longer ${k.name.toLowerCase()}.`); continue; }
        kept.push({ ...k, rounds: left });
      } else kept.push(k);
    }
    out.conditions = kept;
  }
  if (when === 'start') {
    if (settings.auto.legendary && out.legendary) out.legendaryUsed = 0;
    if (settings.auto.recharge && out.recharge) {
      const r = { ...out.recharge };
      for (const [name, v] of Object.entries(r)) {
        if (v.ready) continue;
        const d6 = int(rng, 1, 6);
        if (d6 >= v.on) { r[name] = { ...v, ready: true }; events.push(`${c.name}'s ${name.replace(/\s*\(Recharge.*\)/i, '')} recharges (rolled ${d6}).`); }
        else events.push(`${c.name}'s ${name.replace(/\s*\(Recharge.*\)/i, '')} doesn't recharge (rolled ${d6}).`);
      }
      out.recharge = r;
    }
    // Heroism: a few temporary hit points at the start of each of their turns (they don't stack: the higher stays).
    const each = out.hp > 0 ? out.conditions.find(k => k.tempEach > 0) : null;
    if (each && gainTemp(out, each.tempEach).temp > (Number(out.temp) || 0)) {
      out.temp = each.tempEach; out.tempFrom = each.spell || each.name;
      events.push(`${c.name} gains ${each.tempEach} temporary hit points (${each.spell || each.name}).`);
    }
    if (settings.auto.deathSaves && out.kind === 'pc' && out.hp <= 0 && !out.death?.dead && !out.death?.stable) events.push(`${c.name} is down: roll a death saving throw.`);
    if (out.kind === 'lair') events.push('Lair action: the place itself acts.');
  }
  return { combatant: out, events };
}

/** Move the turn on, running end-of-turn and start-of-turn effects and noting a new round. */
export function advanceTurn(battle, step, settings, rng = Math.random) {
  const skip = settings.auto.skipDefeated;
  const order = battleOrder(battle.list).filter(c => !(skip && c.kind === 'monster' && Number(c.hp) <= 0));
  if (!order.length) return { battle: { ...battle, turn: null }, events: [] };
  const events = [];
  let list = battle.list.map(c => ({ ...c }));
  const put = c => { list = list.map(x => x.id === c.id ? c : x); };
  const was = list.find(c => c.id === battle.turn);
  if (step > 0 && was) { const r = turnEffects(was, 'end', settings, rng); put(r.combatant); events.push(...r.events); }
  let i = order.findIndex(c => c.id === battle.turn);
  let round = Number(battle.round) || 1;
  if (i < 0) i = step > 0 ? 0 : order.length - 1;
  else {
    i += step;
    if (i >= order.length) { i = 0; round++; events.unshift(`Round ${round} begins.`); }
    if (i < 0) { i = order.length - 1; round = Math.max(1, round - 1); }
  }
  const now = list.find(c => c.id === order[i].id);
  if (step > 0) { const r = turnEffects(now, 'start', settings, rng); put(r.combatant); events.push(...r.events); }
  return { battle: { ...battle, list, turn: now.id, round }, events };
}

/** How hard a fight is for the party, from the monsters' XP (2024 budget: low, moderate, high). */
export function battleDifficulty(monsterXp, levels) {
  if (!levels.length) return { xp: monsterXp, label: '' };
  const level = Math.round(levels.reduce((a, b) => a + b, 0) / levels.length);
  const [low, mod, high] = DIFFICULTIES.map(d => xpBudget(level, levels.length, d));
  const label = monsterXp < low * 0.5 ? 'Trivial' : monsterXp < mod ? 'Low' : monsterXp < high ? 'Moderate' : monsterXp <= high * 1.5 ? 'High' : 'Deadly';
  return { xp: monsterXp, label, level, budget: { low, moderate: mod, high } };
}

// ---------- monster parts ----------
// What a party can cut from a kill and sell: parts by creature type (and the food list's parts), worth a share of the
// monster's rank by its size. Sold together, the parts become coins for the party purse.

/** The parts of one slain monster and what they fetch. */
/** People, not monsters: a spy or a knight (any race, or one of the world's peoples) leaves no core and nothing to salvage. */
export function isPerson(data, stat) {
  const t = String(stat?.type || '').toLowerCase();
  if (!t.startsWith('humanoid')) return false;
  const sub = (t.match(/\(([^)]+)\)/)?.[1] || '').trim();
  const peoples = list(data?.peoples?.peoples).map(p => String(p.name).toLowerCase());
  return !sub || sub === 'any race' || sub === 'human' || peoples.some(p => p === sub || p.startsWith(sub) || sub.startsWith(p));
}

export function salvageOf(data, stat, rng = Math.random) {
  const S = data?.market?.salvage;
  if (!S || !stat || isPerson(data, stat)) return null;
  const type = String(stat.type || '').toLowerCase().match(/^[a-z]+/)?.[0] || '';
  const food = list(data.food?.monsters).find(f => f.name === stat.name);
  const pool = [...new Set([...list(S.types?.[type]), ...list(food?.parts)])];
  if (!pool.length) return null;
  const rank = rankForCR(Number(stat.cr) || 0);
  const base = Number(S.value?.[rank]) || 0;
  const size = Number(S.size?.[stat.size]) || 1;
  const parts = sample(rng, pool, Math.min(pool.length, 1 + Math.floor(rng() * 3)));
  // Venom and breath weapons are worth taking too.
  const acts = (stat.actions || []).map(a => `${a.name} ${a.desc}`).join(' ');
  if (/poison damage/i.test(acts) && !parts.some(x => /venom/.test(x))) parts.push('venom gland');
  if (/\bbreath\b/i.test(acts)) parts.push('breath gland');
  return { monster: stat.name, rank, parts, value: Math.round(base * size * (0.5 + rng())) };
}

/** Parts from a list of slain monsters' stat blocks, grouped by monster, with the total they sell for. */
export function salvageAll(data, stats, rng = Math.random) {
  const by = new Map();
  for (const st of stats) {
    const s = salvageOf(data, st, rng);
    if (!s) continue;
    const had = by.get(s.monster);
    if (had) { had.count++; had.value += s.value; for (const p of s.parts) if (!had.parts.includes(p)) had.parts.push(p); }
    else by.set(s.monster, { ...s, count: 1 });
  }
  const items = [...by.values()];
  return { items, value: items.reduce((t, x) => t + x.value, 0) };
}
export const salvageText = sv => sv.items.map(x => `${x.count > 1 ? `${x.count} ${pluralName(x.monster)}` : x.monster}: ${x.parts.join(', ')}`).join('; ');

/** A finished battle in brief: rounds, who fell, XP, and the monster cores left behind by rank. */
export function battleSummary(battle, statFor, levels = [], rng = Math.random, intact = 0.5, data = null) {
  const monsters = battle.list.filter(c => c.kind === 'monster');
  const xpOf = c => { const m = statFor(c); return m ? Number(m.xp ?? CR_XP[m.cr] ?? 0) : 0; };
  const xp = monsters.reduce((a, c) => a + xpOf(c), 0);
  const defeated = monsters.filter(c => c.hp <= 0);
  const cores = {};
  let cracked = 0;
  for (const c of defeated) {
    const m = statFor(c); const r = rankForCR(Number(m?.cr) || 0);
    if (isPerson(data, m)) continue;
    if (intactCores(1, intact, rng)) cores[r] = (cores[r] || 0) + 1; else cracked++;
  }
  const fallen = battle.list.filter(c => c.kind === 'pc' && c.hp <= 0);
  return { rounds: Number(battle.round) || 1, xp, earnedXp: defeated.reduce((a, c) => a + xpOf(c), 0), difficulty: battleDifficulty(xp, levels), defeated, survivors: monsters.filter(c => c.hp > 0), fallen, cores, cracked,
    parts: salvageAll(data, defeated.map(statFor).filter(Boolean), rng) };
}

/** The battle as a section for the session notes. */
export function battleToMarkdown(sum, battle, title = 'Battle') {
  const party = battle.list.filter(c => c.kind === 'pc');
  const o = battle.origin || {};
  const lines = [`### ${title}`, ''];
  // How it came about, so the notes still make sense weeks later.
  const when = [o.date, o.where ? (/\[\[/.test(o.where) ? o.where : `[[${o.where}]]`) : ''].filter(Boolean).join(', near ');
  if (when) lines.push(`*${when}.*`, '');
  if (o.how) lines.push(`- **How it started:** ${o.how}`);
  if (o.situation) lines.push(`- **The situation:** ${o.situation}`);
  if (o.why) lines.push(`- **Why they were there:** ${o.why}`);
  if (o.want) lines.push(`- **What they wanted:** ${o.want}`);
  if (o.nonFight) lines.push(`- **Set up as more than a fight:** ${o.nonFight}`);
  if (o.how || o.situation || o.why || o.want || o.nonFight) lines.push('');
  const foes = battle.list.filter(c => c.kind === 'monster');
  if (foes.length) lines.push(`- **Against:** ${[...new Set(foes.map(c => c.stat?.name || c.monster))].map(n => { const k = foes.filter(c => (c.stat?.name || c.monster) === n).length; return k > 1 ? `${k} × ${n}` : n; }).join(', ')}`);
  lines.push(`- **Outcome:** ${sum.rounds} round${sum.rounds === 1 ? '' : 's'}${sum.difficulty.label ? `, ${sum.difficulty.label.toLowerCase()} difficulty` : ''}; ${sum.survivors.length ? `${sum.survivors.length} enem${sum.survivors.length === 1 ? 'y' : 'ies'} still standing` : 'every enemy down'}; ${sum.xp.toLocaleString()} XP of monsters, ${sum.earnedXp.toLocaleString()} XP earned`);
  if (party.length) lines.push(`- **Party:** ${party.map(c => `[[${c.name}]] (${c.hp}/${c.hpMax} HP${c.death?.dead ? ', died' : c.hp <= 0 ? ', down' : ''})`).join(', ')}`);
  if (sum.defeated.length) lines.push(`- **Defeated:** ${sum.defeated.map(c => c.name).join(', ')}`);
  if (sum.survivors.length) lines.push(`- **Still standing:** ${sum.survivors.map(c => `${c.name} (${c.hp}/${c.hpMax} HP)`).join(', ')}`);
  const cores = Object.entries(sum.cores);
  if (cores.length || sum.cracked) lines.push(`- **Monster cores:** ${cores.map(([r, n]) => `${n} ${r}`).join(', ') || 'none intact'}${sum.cracked ? ` (${sum.cracked} cracked)` : ''}`);
  if (sum.parts?.items.length) lines.push(`- **Monster parts:** ${salvageText(sum.parts)}${sum.partsSold ? ` (sold for ${formatSpirit(sum.parts.value)}, into the party purse)` : ` (worth about ${formatSpirit(sum.parts.value)})`}`);
  // Who did what: damage dealt and taken, healing, and who they brought down.
  const tally = Object.entries(battle.tally || {}).filter(([n, t]) => battle.list.some(c => c.name === n && c.kind !== 'lair') && (t.dealt || t.taken || t.healed));
  const linkName = n => battle.list.find(c => c.name === n)?.kind === 'pc' ? `[[${n}]]` : n;
  if (tally.length) lines.push('', '**Who did what**', '', ...tally.sort(([a], [b]) => (battle.list.find(c => c.name === a)?.kind === 'pc' ? 0 : 1) - (battle.list.find(c => c.name === b)?.kind === 'pc' ? 0 : 1)).map(([n, t]) =>
    `- ${linkName(n)}: ${[t.dealt ? `dealt ${t.dealt}${t.crits ? ` (${t.crits} critical hit${t.crits > 1 ? 's' : ''})` : ''}` : '', t.downed.length ? `brought down ${t.downed.join(', ')}` : '', t.taken ? `took ${t.taken}` : '', t.healed ? `healed ${t.healed}` : ''].filter(Boolean).join(', ')}`));
  const log = (battle.log || []).filter(e => e.key);
  if (log.length) lines.push('', '**What happened**', '', ...log.map(e => `- Round ${e.round}: ${e.text}`));
  return lines.join('\n') + '\n';
}

/** What the players' window shows: turn order and health, without monster numbers or hidden creatures. */
export function playerSnapshot(battle, settings) {
  const shown = battleOrder(battle.list).filter(c => !c.hidden);
  return {
    round: battle.round, turn: shown.some(c => c.id === battle.turn) ? battle.turn : null,
    // The look travels with the snapshot so the player window follows settings changes.
    look: { health: settings.health, conditionColors: settings.conditionColors, customColor: settings.customColor },
    list: shown.map(c => ({
      id: c.id, name: c.shape ? `${c.name} (${c.shape.name})` : c.name, kind: c.kind,
      hp: c.kind === 'pc' && settings.player.partyHp ? `${c.hp} / ${c.hpMax}` : '',
      health: c.kind === 'lair' ? '' : c.kind === 'pc' ? (c.hp <= 0 ? (c.death?.dead ? 'Dead' : c.death?.stable ? 'Stable' : 'Down') : '') : settings.player.enemyHealth ? healthWord(c, settings) : '',
      state: healthState(c, settings)?.name || '',
      conditions: settings.player.conditions ? (c.conditions || []).map(condOf).map(k => k.name) : [],
    })),
  };
}

// ---------- battle AI ----------
// With no battle map, distance is a range band per monster: engaged with someone, near (one move away),
// far (a dash or a ranged attack) or out of reach. A monster with no band yet asks the DM. Tactics decide
// who it goes for and how; the plan is a suggestion the DM carries out, changes or skips.

export const RANGE_BANDS = [
  { key: 'engaged', label: 'Engaged', hint: 'in melee with someone' },
  { key: 'near', label: 'Near', hint: 'can reach the party with a move' },
  { key: 'far', label: 'Far', hint: 'needs a dash or a ranged attack' },
  { key: 'out', label: 'Out of reach', hint: 'can\'t reach anyone this turn' },
];

export const TACTICS = {
  brute: { label: 'Brute', desc: 'Wades in and hits whoever is closest, as hard as it can.' },
  pack: { label: 'Pack hunter', desc: 'Gangs up with its allies on the weakest or most hurt target.' },
  skirmisher: { label: 'Skirmisher', desc: 'Darts in at the softest target, strikes and pulls back.' },
  sniper: { label: 'Sniper', desc: 'Keeps its distance and shoots; backs off if someone closes in.' },
  caster: { label: 'Caster', desc: 'Opens with its biggest ability, then picks off targets from range.' },
  protector: { label: 'Protector', desc: 'Guards its leader and goes for whoever threatens it.' },
  coward: { label: 'Coward', desc: 'Fights while it is winning and runs once it is hurt.' },
};

const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, twenty: 20 };
const numWord = w => NUMBER_WORDS[String(w).toLowerCase()] || Number(w) || 0;
const avgOf = expr => { const p = parseDice(expr); return p ? p.dice.reduce((a, t) => a + t.sign * t.n * (t.d + 1) / 2, 0) + p.mod : 0; };

/** Walking and flying speed in feet. */
/** Its speeds, and how it gets about: walking, or its fastest other way when it can't walk (a shark swims). */
export function speedOf(stat) {
  const t = String(stat?.speed || '30 ft.');
  const n = re => Number(t.match(re)?.[1]) || 0;
  const s = { walk: n(/^(\d+)/), fly: n(/fly (\d+)/i), swim: n(/swim (\d+)/i), climb: n(/climb (\d+)/i), burrow: n(/burrow (\d+)/i) };
  const [mode, best] = s.walk ? ['walk', s.walk] : ['fly', 'swim', 'climb', 'burrow'].map(k => [k, s[k]]).sort((a, b) => b[1] - a[1])[0];
  return { ...s, mode, best };
}
const MOVE_VERB = { walk: 'moves', fly: 'flies', swim: 'swims', climb: 'climbs', burrow: 'burrows' };

/** A monster's actions, sorted out: melee or ranged, reach and range, average damage, and whether it recharges. */
export function monsterActions(stat, data = null) {
  return [...(stat?.actions || []).map(a => {
    const d = String(a.desc || '');
    const atk = attackOf(d);
    const melee = /melee/i.test(d) || /reach \d+ ft/i.test(d);
    const ranged = /ranged/i.test(d) || /range \d+/i.test(d);
    const area = /\b(cone|line|sphere|cube|cylinder|radius|each creature)\b/i.test(d) && !!atk?.save;
    const range = d.match(/range (\d+)(?:\/(\d+))? ft/i);
    return {
      name: a.name, desc: d, atk,
      multi: /^multiattack/i.test(a.name),
      melee: melee && !area, ranged: (ranged || (!!atk?.save && !melee)) && !area, area,
      reach: Number(d.match(/reach (\d+) ft/i)?.[1]) || (melee ? 5 : 0),
      range: range ? Number(range[1]) : 0,
      recharge: rechargeOf(a.name),
      half: /half as much/i.test(d),
      condition: atk?.save ? cap(SPELL_CONDITIONS.find(x => new RegExp(`\\b(${x}|knocked ${x})\\b`, 'i').test(d.slice(d.search(/saving throw/i)))) || '') || null : null,
      avg: (atk?.damage || []).reduce((t, x) => t + avgOf(x.expr), 0) * (area ? 2 : 1),
    };
  }), ...(data ? spellActions(stat, data) : [])];
}

const SPELL_CONDITIONS = ['paralyzed', 'stunned', 'frightened', 'charmed', 'restrained', 'blinded', 'prone', 'incapacitated', 'poisoned'];

/**
 * A spellcaster's combat spells as actions: attack spells use its spell attack bonus, save spells its spell save DC.
 * Cantrips scale with its caster level, and beams and rays each roll on their own (atk.count). Spells with no
 * damage and no condition (light, shield, fly) are left out.
 */
export function spellActions(stat, data) {
  const out = [];
  for (const t of stat?.traits || []) {
    if (!/spellcasting/i.test(t.name) || !t.spells?.length) continue;
    const desc = String(t.desc || '');
    const dc = Number(desc.match(/spell save DC (\d+)/i)?.[1]) || 0;
    const bonus = desc.match(/([+-]\d+) to hit with spell attacks/i);
    const toHit = bonus ? Number(bonus[1]) : dc ? dc - 8 : 0;
    const level = Number(desc.match(/(\d+)(?:st|nd|rd|th)-level spellcaster/i)?.[1]) || Math.max(1, Math.round((Number(stat.cr) || 1) * 1.5));
    for (const name of t.spells) {
      const sp = spellInfo(data, name);
      if (!sp) continue;
      const text = String(sp.text || '').split(/\n\n/)[0];
      const attack = /(melee|ranged) spell attack/i.exec(text);
      const saveAb = text.match(/\b(strength|dexterity|constitution|intelligence|wisdom|charisma) saving throw/i);
      const cast = castSpell(sp, { casterLevel: level });
      let damage = cast.damage;
      // Darts all hit, so they roll together.
      if (cast.kind === 'dart' && damage[0]) { const p = parseDice(damage[0].expr); damage = [{ ...damage[0], expr: diceText({ dice: p.dice.map(x => ({ ...x, n: x.n * cast.count })), mod: p.mod * cast.count }) }]; }
      const count = attack && cast.count > 1 && cast.kind !== 'dart' ? cast.count : 1;
      const condition = !damage.length && saveAb ? SPELL_CONDITIONS.find(c => new RegExp(`\\b${c}\\b`, 'i').test(text)) : null;
      if (!damage.length && !condition) continue;
      const area = cast.area;
      const touch = /^touch$/i.test(sp.range || '');
      const atk = { toHit: attack ? toHit : null, save: saveAb ? { dc, ability: cap(saveAb[1].toLowerCase()) } : null, damage, ...(count > 1 ? { count, kind: cast.kind } : {}) };
      out.push({
        name: sp.name, desc: sp.summary || text, atk, spell: true, level: Number(sp.level) || 0, condition: condition ? cap(condition) : null,
        multi: false, melee: (touch || /melee spell attack/i.test(text)) && !area, ranged: !touch && !area && !/melee spell attack/i.test(text), area,
        reach: touch ? 5 : 0, range: Number(String(sp.range).match(/\d+/)?.[0]) || 0, recharge: null, half: /half as much/i.test(text),
        avg: condition ? 10 + 3 * (Number(sp.level) || 0) : damage.reduce((a, x) => a + avgOf(x.expr), 0) * count * (area ? 2 : 1),
      });
    }
  }
  return out;
}

// ----- spells as they are cast -----

const DMG_WORDS = 'acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder';
const PROJECTILES = { beam: 'beam', ray: 'ray', dart: 'dart', bolt: 'bolt' };
/** Which tier a cantrip is at for a caster level: 1 below 5th, then 2, 3 and 4 at 5th, 11th and 17th. */
export const cantripTier = level => level >= 17 ? 4 : level >= 11 ? 3 : level >= 5 ? 2 : 1;
const addDice = (expr, n, d) => {
  const p = parseDice(expr);
  const hit = p.dice.find(x => x.d === d && x.sign > 0);
  if (hit) hit.n += n; else p.dice.push({ n, d, sign: 1 });
  return diceText(p);
};

/**
 * A spell cast by someone of a caster level with a slot: how many attacks or darts it makes (beams, rays, darts,
 * each rolled on its own), how many creatures it can target, and its damage or healing at that slot. Cantrips grow
 * with the caster's level; levelled spells with the slot, as their "at higher levels" text says. `mod` is added
 * where a spell adds the spellcasting modifier.
 */
// Spells whose two damage types happen at different moments or from different forms, never in one roll.
const SEPARATE_DAMAGE = ['arcane hand', "bigby's hand", 'hunger of hadar', 'wall of thorns'];
const NO_CAST_DAMAGE = ['web', 'alter self', 'enlarge/reduce', 'fire shield'];
export function castSpell(sp, { casterLevel = 1, slot = null, mod = 0 } = {}) {
  const level = Number(sp?.level) || 0;
  const text = String(sp?.text || '');
  const higher = String(sp?.higher || '').replace(/(\d)dl0/g, '$1d10');
  const cantrip = !level;
  const at = cantrip ? 0 : Math.max(level, Math.min(9, Number(slot) || level));
  const up = at - level, tier = cantrip ? cantripTier(casterLevel) : 1;
  // Damage: the first amount of each type, plus "damage equal to 1d8 + your spellcasting ability modifier".
  const damage = [];
  for (const m of text.matchAll(new RegExp(`(\\d+d\\d+(?:\\s*\\+\\s*\\d+)?)\\s+(${DMG_WORDS}) damage|(${DMG_WORDS}) damage equal to (\\d+d\\d+)( (?:\\+|plus) your spellcasting ability modifier)?`, 'gi'))) {
    const type = (m[2] || m[3]).toLowerCase();
    if (damage.some(x => x.type === type)) continue;
    // "3d8 radiant damage (if you are good) or 3d8 necrotic damage": one or the other, not both.
    const before = text.slice(0, m.index);
    if (damage.length && /\bdamage(?:\s*\([^)]*\))?,?\s+or\s+(?:takes?\s+)?$/i.test(before)) { (damage.at(-1).or ||= []).push(type); continue; }
    let expr = diceText(parseDice((m[1] || m[4]).replace(/\s+/g, ' ')));
    if (m[5] && mod) expr = diceText({ ...parseDice(expr), mod: parseDice(expr).mod + mod });
    damage.push({ expr, type });
  }
  // "3d8 damage of the chosen type": damage with no fixed type.
  const anyType = !damage.length && text.match(/(\d+d\d+) damage/i);
  if (anyType) damage.push({ expr: anyType[1], type: '' });
  // A spell with a different damage for each of many effects (prismatic spray), or for separate moments
  // (hunger of hadar's cold at the start of a turn, acid at the end), rolls the first.
  if (damage.length > 2 || SEPARATE_DAMAGE.includes(String(sp.name).toLowerCase())) damage.length = 1;
  // Damage only from a side effect (web burning), not from casting it.
  if (NO_CAST_DAMAGE.includes(String(sp.name).toLowerCase())) damage.length = 0;
  const healM = text.match(/regains?[^.]*?(\d+d\d+)(\s*(?:\+|plus)\s*your spellcasting (?:ability )?modifier)?/i);
  let heal = healM && !damage.length ? healM[1] : null;
  const healMod = healM?.[2] && mod ? mod : 0;
  // Beams, rays and darts each roll on their own.
  const attacks = /spell attack/i.test(text);
  const many = text.match(/\b(two|three|four|five) (?:glowing |fiery )?(beams?|rays?|darts?|bolts?)\b/i);
  let kind = many && (attacks || /dart/i.test(many[2])) ? PROJECTILES[many[2].toLowerCase().replace(/s$/, '')] : cantrip && attacks && /more than one beam|additional beams?|separate beams|for each beam|creates two beams/i.test(`${text} ${higher}`) ? 'beam' : null;
  // "Choose up to five creatures ... and make a melee spell attack against each": one attack per target.
  const upTo = text.match(/\bup to (two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty) (?:willing )?(?:creatures|targets|humanoids)\b/i)
    || text.match(/\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty) or fewer (?:willing )?(?:creatures|targets|humanoids)\b/i);
  const each = !kind && attacks && upTo && /against each/i.test(text);
  if (each) kind = 'strike';
  let count = each ? numWord(upTo[1]) : kind && many ? numWord(many[1]) : 1;
  if (cantrip && kind === 'beam') count = tier;
  else if (cantrip && /increases? by|rises by|increase by one/i.test(`${text} ${higher}`)) for (const x of damage) { const p = parseDice(x.expr); p.dice[0].n *= tier; x.expr = diceText(p); }
  // One more target, dart or ray per slot level above the spell's own.
  let targets = 1 + (numWord(text.match(/leap from that target to as many as (\w+)/i)?.[1]) || 0);
  // "Up to three creatures" (bless, bane, psychic scream), or "one creature, or two within 5 feet of each other".
  if (upTo && !each) targets = Math.max(targets, numWord(upTo[1]));
  else if (/\bor (?:choose )?two creatures\b/i.test(text)) targets = Math.max(targets, 2);
  if (up && kind && /(?:one|an) (?:more|additional) (?:dart|ray|beam|bolt)/i.test(higher)) count += up;
  else if (up && /(?:one|an) additional (?:willing )?(?:creature|humanoid|target)|(?:one|an) additional bolt/i.test(higher)) targets += up;
  // Extra dice, on the type the text names or else the first one.
  const extra = up && !/twice as many|three times/i.test(higher) ? higher.match(/(\d+)d(\d+)/) : null;
  if (extra) {
    const steps = /every two slot levels/i.test(higher) ? Math.floor(up / 2) : up;
    const n = Number(extra[1]) * steps, d = Number(extra[2]);
    const named = higher.match(new RegExp(`\\b(${DMG_WORDS})\\b`, 'i'))?.[1]?.toLowerCase();
    const onto = damage.find(x => x.type === named) || damage[0];
    if (n && /heal/i.test(higher) && heal) heal = addDice(heal, n, d);
    else if (n && onto) onto.expr = addDice(onto.expr, n, d);
  }
  if (heal && healMod) heal = `${heal} ${healMod > 0 ? '+' : '-'} ${Math.abs(healMod)}`;
  // Temporary hit points: "You gain 2d4 + 4 Temporary Hit Points", with more per slot level ("5 additional
  // Temporary Hit Points for each spell slot level above 1", "both ... increase by 5 per slot level").
  const tempM = text.match(/\bgains? (\d+d\d+(?:\s*\+\s*\d+)?|\d+) temporary hit points/i);
  let temp = tempM ? diceText(parseDice(tempM[1].replace(/\s+/g, ' '))) : null;
  const tempUp = Number(higher.match(/(\d+) additional temporary hit points/i)?.[1] || higher.match(/temporary hit points[^.]*?increase by (\d+)/i)?.[1]) || 0;
  if (temp && up && tempUp) temp = diceText({ ...parseDice(temp), mod: parseDice(temp).mod + tempUp * up });
  // Heroism: a few each turn, as many as the caster's spellcasting modifier.
  const tempEach = /temporary hit points equal to your spellcasting ability modifier at the start of each/i.test(text);
  // An area, or as many as the caster picks: each creature of your choice, any number of creatures.
  // The 2024 rules name areas Emanation, Sphere, Cone...; light shed in a radius is no area.
  const areaText = text.replace(/\b(?:bright|dim) light (?:in|out to) an? \d+-foot radius/gi, '');
  const area = !(upTo && !each) && /\b\d+-foot (?:emanation|aura)\b|\b\d+-foot(?:-radius|-wide)?[- ](?:cone|sphere|cube|cylinder|line|radius)|\d+-foot-radius\b|\bline \d+ feet long|each creature[^.]{0,30}?\b(?:in|within)\b|each creature (?:of your choice|you choose)|creatures of your choice|any number of creatures|creatures? in (?:the|that|its) (?:area|wall|line|cyclone|cloud|path|emanation)/i.test(areaText);
  return {
    level, slot: cantrip ? 0 : at, count, kind, targets: area ? null : targets, area, damage, heal, temp, tempEach,
    scales: !cantrip && /slot level|level slot|slot of \d|level or higher/i.test(higher),
  };
}

/** A creature's saving throw bonus from its stat block: its listed save, else the ability's modifier. */
export function saveBonusOf(stat, ability) {
  const ab = String(ability || '').slice(0, 3).toLowerCase();
  const listed = String(stat?.saves || '').match(new RegExp(`\\b${ab}\\w*\\s*([+-]\\d+)`, 'i'));
  if (listed) return Number(listed[1]);
  const i = ['str', 'dex', 'con', 'int', 'wis', 'cha'].indexOf(ab);
  return i >= 0 && stat?.abilities ? Number(abilityMod(stat.abilities[i])) : 0;
}

/** The highest spell slot a stat block's spellcasting lists ("5th level (1 slot)"), or 0. */
export function maxSlotIn(desc) {
  return Math.max(0, ...[...String(desc || '').matchAll(/(\d)(?:st|nd|rd|th)[- ]level \(\d+ slots?\)/gi)].map(m => Number(m[1])));
}

/** What a Multiattack does, as a list of action names: "one with its bite and two with its claws". */
export function multiattackRoutine(actions) {
  const multi = actions.find(a => a.multi);
  if (!multi) return null;
  const d = multi.desc.toLowerCase();
  const named = [];
  for (const a of actions.filter(x => !x.multi && (x.melee || x.ranged))) {
    const stem = a.name.toLowerCase().replace(/\s*\(.*\)/, '').replace(/s$/, '');
    const m = d.match(new RegExp(`\\b(one|two|three|four|five|six|\\d+)\\s+(?:with\\s+its\\s+|\\w+\\s+)?${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    if (m) for (let i = 0; i < numWord(m[1]); i++) named.push(a.name);
  }
  if (named.length) return named;
  const total = numWord(d.match(/makes (\w+)/)?.[1]) || 2;
  const best = actions.filter(x => !x.multi && (x.melee || x.ranged)).sort((a, b) => b.avg - a.avg)[0];
  return best ? Array(total).fill(best.name) : null;
}

/** The tactic a monster plays by if the DM hasn't picked one. */
export function defaultTactic(stat) {
  const acts = monsterActions(stat);
  const traits = (stat?.traits || []).map(t => `${t.name} ${t.desc}`).join(' ');
  const int = Number(stat?.abilities?.[3]) || 10;
  const bestMelee = Math.max(0, ...acts.filter(a => a.melee).map(a => a.avg));
  // A breath weapon doesn't make a caster: a dragon still bites. Only something with no real melee plays from range.
  if (/spellcasting/i.test(traits) || (acts.some(a => a.area && a.recharge) && !bestMelee)) return 'caster';
  if (/pack tactics/i.test(traits)) return 'pack';
  if (/nimble escape|flyby|hit and run|cunning action/i.test(traits)) return 'skirmisher';
  const bestRanged = Math.max(0, ...acts.filter(a => a.ranged).map(a => a.avg));
  if (bestRanged > bestMelee) return 'sniper';
  if (int <= 4) return 'brute';
  return 'brute';
}

const CANT_ACT = ['Incapacitated', 'Paralyzed', 'Petrified', 'Stunned', 'Unconscious'];
const has = (c, name) => (c.conditions || []).some(k => condOf(k).name === name);
const pctHp = c => c.hpMax ? c.hp / c.hpMax : 1;

/** Advantage and disadvantage that apply to one attack, from conditions and traits. */
function attackEdge(c, stat, target, act, battle) {
  const adv = [], dis = [];
  const traits = (stat?.traits || []).map(t => t.name).join(' ');
  if (/pack tactics/i.test(traits) && battle.list.some(x => x !== c && x.kind === 'monster' && x.hp > 0 && x.range?.band === 'engaged' && x.range.with === target.id)) adv.push('Pack Tactics');
  if (['Paralyzed', 'Stunned', 'Unconscious', 'Restrained', 'Blinded'].some(n => has(target, n))) adv.push(`${target.name} is ${(target.conditions.map(condOf).find(k => ['Paralyzed', 'Stunned', 'Unconscious', 'Restrained', 'Blinded'].includes(k.name)).name).toLowerCase()}`);
  if (has(target, 'Prone')) (act.melee ? adv : dis).push(`${target.name} is prone`);
  if (has(target, 'Invisible')) dis.push(`${target.name} is invisible`);
  for (const n of ['Blinded', 'Frightened', 'Poisoned', 'Prone', 'Restrained']) if (has(c, n)) dis.push(`it is ${n.toLowerCase()}`);
  if (act.ranged && !act.melee && c.range?.band === 'engaged') dis.push('a ranged attack while in melee');
  const mode = adv.length && !dis.length ? 'adv' : dis.length && !adv.length ? 'dis' : '';
  return { mode, why: [...adv.map(x => `advantage: ${x}`), ...dis.map(x => `disadvantage: ${x}`)] };
}

/**
 * The monster's turn as a suggestion. Returns { kind, text, why, notes, steps, move, target, tactic }:
 * kind 'act', 'flee' (cowards only), 'ask' (the DM needs to say how far away it is), 'wait' (nothing it can reach) or 'none' (can't act).
 * steps: [{ action, target, mode, save }] to roll in order; move: 'stay' | 'close' | 'dash' | 'withdraw' | 'hit-and-run' | 'flee'.
 * Pass the campaign data to let spellcasters use their spells.
 */
export function aiPlan(battle, c, stat, settings, rng = Math.random, data = null) {
  const tactic = c.ai?.tactic || defaultTactic(stat);
  const out = (kind, text, extra = {}) => ({ kind, text, why: '', notes: [], steps: [], move: 'stay', target: null, tactic, ...extra });
  if (c.hp <= 0) return out('none', `${c.name} is down.`);
  const stopped = (c.conditions || []).map(condOf).find(k => CANT_ACT.includes(k.name));
  if (stopped) return out('none', `${c.name} is ${stopped.name.toLowerCase()} and can't act this turn.`);
  const foes = battle.list.filter(x => (x.kind === 'pc' || x.kind === 'other') && (x.hp > 0 || (settings.ai?.finishDowned && !x.death?.dead)));
  if (!foes.length) return out('wait', `${c.name} has no one left to fight.`);
  const allies = battle.list.filter(x => x.kind === 'monster' && x !== c);
  const band = c.range?.band || null;
  if (!band) return out('ask', `How far is ${c.name} from the party?`);

  // Monsters fight to the end; only one the DM made a coward runs once it is hurt.
  if (tactic === 'coward' && healthState(c, settings)) {
    return out('flee', `${c.name} tries to flee${band === 'engaged' ? ', disengaging first' : ''}.`, { move: 'flee', why: 'It is a coward and it is hurt.' });
  }

  const all = monsterActions(stat, data);
  const acts = all.filter(a => !a.multi);
  const ready = a => !a.recharge || c.recharge?.[a.name]?.ready !== false;
  // No spell slots: a levelled spell it has already cast is just less likely to come again.
  const worth = a => a.avg * (a.spell && a.level && c.spellsUsed?.[a.name] ? 0.6 : 1) * (0.85 + rng() * 0.3);
  const usable = acts.filter(a => (a.melee || a.ranged || a.area) && a.atk && ready(a));
  if (!usable.length) return out('wait', `${c.name} has no attacks to make. Describe what it does.`);
  const routine = multiattackRoutine(all);
  const speed = speedOf(stat);
  const pinned = has(c, 'Grappled') || has(c, 'Restrained') || !speed.best;
  const goes = MOVE_VERB[speed.mode];
  // A swimmer or burrower only gets there if the way allows it; the DM knows the ground.
  const wayNote = { swim: 'it can only swim, so this needs water between them', burrow: 'it can only burrow, so it comes up through the ground', climb: 'it can only climb, so it needs walls or rock to get there' }[speed.mode];
  const scared = has(c, 'Frightened');
  const engagedWith = band === 'engaged' ? foes.find(f => f.id === c.range.with) : null;

  const melee = usable.filter(a => a.melee), ranged = usable.filter(a => a.ranged), area = usable.filter(a => a.area);
  const canMelee = (band === 'engaged' || (band === 'near' && !pinned && !scared)) && melee.length;
  const canShoot = band !== 'out' && ranged.length;
  const canArea = band !== 'out' && area.length;
  if (!canMelee && !canShoot && !canArea) {
    if (band === 'out') return out('wait', `${c.name} can't reach anyone. It ${pinned ? 'struggles where it is' : `${goes} closer (it will be Far next turn)`}.`, { move: pinned ? 'stay' : 'close-far', why: 'Everyone is out of its reach.', notes: !pinned && wayNote ? [wayNote] : [] });
    if (band === 'far' && !pinned) return out('act', `${c.name} ${speed.mode === 'walk' ? 'dashes' : `${goes} hard`} toward the party (it will be Near next turn).`, { move: 'dash', why: 'It has no ranged attack, so it closes the distance.', notes: wayNote ? [wayNote] : [] });
    return out('wait', `${c.name} can't reach anyone this turn.`);
  }

  // Pick a target the tactic likes, remembering why.
  const living = foes.filter(f => f.hp > 0);
  const minAc = Math.min(...living.map(f => Number(f.ac) || 10));
  const minPct = Math.min(...living.map(pctHp));
  const leader = allies.filter(a => a.hp > 0).sort((a, b) => (b.hpMax || 0) - (a.hpMax || 0))[0];
  const alliesOn = f => allies.filter(a => a.hp > 0 && a.range?.band === 'engaged' && a.range.with === f.id).length;
  const score = f => {
    let v = rng() * 0.5;
    const hurt = 1 - pctHp(f);
    if (engagedWith === f) v += tactic === 'sniper' || tactic === 'skirmisher' ? 0.5 : 2;
    if (tactic === 'pack') v += hurt * 3 + alliesOn(f) * 1.5;
    if (tactic === 'skirmisher') v += (20 - (Number(f.ac) || 10)) / 4;
    if (tactic === 'sniper' || tactic === 'caster') v += hurt * 2 + (20 - (Number(f.ac) || 10)) / 6;
    if (tactic === 'brute') v += (f.hpMax || 0) / 40;
    if (tactic === 'protector' && leader?.range?.band === 'engaged' && leader.range.with === f.id) v += 3;
    if (tactic === 'coward') v += hurt * 2;
    if (f.hp <= 0) v -= 5;
    return v;
  };
  const reachable = foes.filter(f => engagedWith && !canShoot && !canArea ? f === engagedWith || band === 'engaged' : true);
  const target = [...reachable].sort((a, b) => score(b) - score(a))[0];
  const reasons = [];
  if (tactic === 'protector' && leader?.range?.with === target.id && leader.range.band === 'engaged') reasons.push(`fighting its leader, ${leader.name}`);
  if (engagedWith === target) reasons.push('already in melee with it');
  if (alliesOn(target) && tactic === 'pack') reasons.push(`${alliesOn(target)} of its allies are already on them`);
  if (pctHp(target) < 1 && pctHp(target) === minPct && living.filter(f => pctHp(f) === minPct).length === 1) reasons.push(`the most hurt (${target.hp}/${target.hpMax} HP)`);
  if ((Number(target.ac) || 10) === minAc && living.filter(f => (Number(f.ac) || 10) === minAc).length === 1) reasons.push(`the lowest AC (${target.ac})`);
  if (tactic === 'brute' && !reasons.length) reasons.push('the biggest threat in reach');
  if (!reasons.length) reasons.push(living.length > 1 ? 'as good a target as any in reach' : 'the only one left');

  // How it attacks.
  const notes = [];
  let move = 'stay', steps = [], text, how;
  const pick = list => [...list].sort((a, b) => worth(b) - worth(a))[0];
  const wantsRange = (tactic === 'sniper' || tactic === 'caster') && (canShoot || canArea);
  const bigArea = canArea ? pick(area) : null;
  const routineOf = kind => routine && routine.every(n => (kind === 'melee' ? melee : ranged).some(a => a.name === n)) ? routine : null;
  const short = n => n.replace(/\s*\(Recharge.*\)/i, '');
  if (bigArea && living.length >= 2 && (tactic === 'caster' || bigArea.recharge || living.length >= 3) && (bigArea.recharge || tactic === 'caster' || rng() < 0.5)) {
    steps = [{ action: bigArea.name, target: target.id, area: true }];
    text = `${c.name} uses ${short(bigArea.name)}, catching as many of the party as it can around ${target.name}.`;
    how = `${short(bigArea.name)} can catch several of them at once`;
  } else if (canMelee && !(wantsRange && band !== 'engaged')) {
    const r = routineOf('melee');
    const best = pick(melee);
    const names = r || [best.name];
    if (band !== 'engaged' || engagedWith !== target) move = 'close';
    steps = names.map(n => ({ action: n, target: target.id }));
    if (move === 'close' && wayNote) notes.push(wayNote);
    text = `${c.name} ${move === 'close' ? `${goes} to ${target.name} and ` : ''}attacks ${target.name}${names.length > 1 ? ` (${names.join(', ')})` : ` with ${short(names[0])}`}.`;
    how = r ? 'its full Multiattack' : `${short(best.name)} is its best melee option`;
    if (tactic === 'skirmisher' || tactic === 'coward') { text += ' Then it pulls back.'; move = move === 'close' ? 'hit-and-run' : 'withdraw'; how += ', then it gets out of reach'; }
  } else if (canShoot || canArea) {
    const r = canShoot ? routineOf('ranged') : null;
    const best = canShoot ? pick(ranged) : bigArea;
    const names = r || [best.name];
    if (band === 'engaged' && (tactic === 'sniper' || tactic === 'caster' || tactic === 'skirmisher') && !pinned) { move = 'withdraw'; notes.push('it backs off first (opportunity attack unless it disengages)'); }
    steps = names.map(n => ({ action: n, target: target.id, area: best.area }));
    text = `${c.name} ${move === 'withdraw' ? 'backs away and ' : ''}${names.length > 1 ? `attacks ${target.name} (${names.join(', ')})` : `uses ${short(names[0])} on ${target.name}`}.`;
    how = tactic === 'sniper' || tactic === 'caster' ? `it keeps its distance (${TACTICS[tactic].label})` : `${short(best.name)} is the best it can do from there`;
  } else {
    return out('wait', `${c.name} can't reach anyone this turn.`);
  }
  for (const st of steps) {
    const act = acts.find(a => a.name === st.action);
    if (!act) continue;
    if (act.atk.save) {
      st.save = { ...act.atk.save, half: act.half, condition: act.condition || null, onHit: act.atk.toHit != null };
      notes.push(act.atk.toHit != null
        ? `on a hit: DC ${act.atk.save.dc} ${act.atk.save.ability} save${act.condition ? ` or ${act.condition.toLowerCase()}` : ''}`
        : `DC ${act.atk.save.dc} ${act.atk.save.ability} save${act.condition ? ` or ${act.condition.toLowerCase()}` : act.half ? ', half damage on a success' : ''}: the players roll`);
    }
    if (act.atk.toHit == null && !act.atk.save) notes.push(`${short(act.name)} hits automatically`);
    if (act.atk.toHit != null) {
      const edge = attackEdge(c, stat, target, act, battle);
      st.mode = edge.mode;
      notes.push(...edge.why);
    }
  }
  if (has(c, 'Prone') && move !== 'stay') notes.push('it stands up first, using half its movement');
  if (scared) notes.push('frightened: it won\'t move closer to what scares it');
  if (has(c, 'Charmed')) notes.push('charmed: it can\'t attack whoever charmed it');
  const why = `${cap(steps[0]?.area ? `aims at ${target.name}: ` : `goes for ${target.name}: `)}${reasons.slice(0, 2).join(' and ')}. ${cap(how)}.`;
  return { kind: 'act', text, why, notes: [...new Set(notes)], steps, move, target: target.id, tactic };
}

/** Where a monster stands after carrying out a plan. */
export function rangeAfter(c, plan) {
  const r = { ...(c.range || {}) };
  if (plan.move === 'close') return { band: 'engaged', with: plan.target };
  if (plan.move === 'hit-and-run' || plan.move === 'withdraw') return { band: 'near', with: null };
  if (plan.move === 'dash') return { band: 'near', with: null };
  if (plan.move === 'close-far') return { band: 'far', with: null };
  if (plan.move === 'flee') return { band: 'out', with: null };
  return r;
}

// ---------- travel ----------
// A day on the road: weather, a Survival check to keep the way, an encounter check and an event check.
// A journey is a run of days from one place to another, kept until the party arrives.

const R_MILES = 3959;
/** Roads and paths wind, so a journey is longer than the straight line between two places. */
export const ROUTE_WINDING = 1.2;

/** Straight-line miles between two [longitude, latitude] points on the world. */
export function travelDistance(a, b) {
  const rad = x => x * Math.PI / 180;
  const [lon1, lat1] = a.map(Number), [lon2, lat2] = b.map(Number);
  const h = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * R_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The journey's settings, with each list entry looked up and anything missing set to its default. */
export function travelSettings(data, opts = {}) {
  const t = data.travel || {};
  const find = (list, name, dflt) => (list || []).find(x => x.name === name) || (list || []).find(x => x.name === dflt) || (list || [])[0] || {};
  const cats = (t.categories || []).map(c => c.key);
  return {
    terrain: find(t.terrains, opts.terrain, 'Road'),
    magic: find(t.magic, opts.magic, 'Normal'),
    mode: find(t.modes, opts.mode, 'On foot'),
    pace: find(t.paces, opts.pace, 'Normal'),
    guide: !!opts.guide && opts.guide !== 'off',
    bonus: opts.bonus !== undefined && opts.bonus !== '' && Number.isFinite(Number(opts.bonus)) ? Number(opts.bonus) : 4,
    eventOn: Math.max(2, Math.min(21, Number(opts.eventOn) || 15)),
    level: Math.max(1, Math.min(20, Number(opts.level) || 1)),
    partySize: Math.max(1, Math.min(8, Number(opts.partySize) || 4)),
    difficulty: opts.difficulty || 'moderate',
    // The party moves at its slowest member's pace, and higher ranks walk faster and longer.
    rank: RANKS.includes(opts.rank) ? opts.rank : rankForLevel(Math.max(1, Math.min(20, Number(opts.level) || 1))),
    cats: Array.isArray(opts.cats) ? opts.cats.filter(k => cats.includes(k)) : cats,
    mood: TRAVEL_MOODS.includes(opts.mood) ? opts.mood : 'Balanced',
    refs: TRAVEL_REFS.some(r => r.key === opts.refs) ? opts.refs : 'all',
  };
}

/** Gentle doubles the feel-good tones and halves the dark ones; Grim does the reverse. */
export const TRAVEL_MOODS = ['Gentle', 'Balanced', 'Grim'];
const MOOD_TONES = { up: ['feel-good', 'funny', 'rewarding'], down: ['grim', 'creepy'] };
/** How many pop-culture references to allow: each level lets in the tiers before it too. */
export const TRAVEL_REFS = [{ key: 'off', name: 'Off', tiers: [] }, { key: 'nods', name: 'Nods only', tiers: ['nod'] },
  { key: 'riffs', name: 'Nods and riffs', tiers: ['nod', 'riff'] }, { key: 'all', name: 'Everything', tiers: ['nod', 'riff', 'outworlder'] }];
const RARITY = { common: 1, uncommon: 0.5, rare: 0.2 };

/** How much faster than a Normal-rank walker this rank travels on its own feet. */
export const rankSpeed = (data, rank) => Number(data.travel?.rankSpeed?.[rank]) || 1;

/** Miles a day at this pace and over this ground, before getting lost or finding shortcuts. Rank speeds up walkers, not horses or boats. */
export const travelDayPace = (s, data = {}) => Math.round((Number(s.mode.miles) || 24) * (s.mode.rank ? rankSpeed(data, s.rank) : 1) * (Number(s.pace.speed) || 1) * (Number(s.terrain.speed) || 1));

// 'land' and 'sea' stand for groups of terrains, in an event's terrains and in what a ride travels over.
const SEA = ['Coast', 'Open sea'];
const terrainIn = (list, terrain) => list.some(t => t === terrain || (t === 'land' && terrain !== 'Open sea') || (t === 'sea' && SEA.includes(terrain)));
/** Whether a ride can go over this ground: boats need water, mounts need land, fliers and astral paths go anywhere. */
export function rideCan(ride, terrain, eventTerrains = null) {
  const how = ride?.travels || (ride?.flies ? 'air' : null);
  if (!how || how === 'air' || how === 'astral') return true;
  if (how === 'sea') return SEA.includes(terrain);
  if (how === 'land') return terrain !== 'Open sea';
  // A river boat goes where the marsh channels are, or wherever the event that offered it said there was a river.
  if (how === 'river') return terrain === 'Delta and marsh' || (eventTerrains || []).includes(terrain);
  return true;
}
/** How the party travels on a day, for which creatures can reach it: 'air' (sky ship, a flying ride), 'water' (a boat, or open sea) or 'land'. */
export function travelWay({ mode = '', terrain = '', ride = null } = {}) {
  if (ride?.flies || ride?.travels === 'air' || mode === 'Sky ship') return 'air';
  if (['Sailing ship', 'River boat'].includes(mode) || ['sea', 'river'].includes(ride?.travels) || terrain === 'Open sea') return 'water';
  return 'land';
}
const asList = x => x === undefined || x === null ? null : [].concat(x);
const fits = (e, terrain, s = null, weather = null) => {
  if (e.terrains && !terrainIn(e.terrains, terrain)) return false;
  if (!s) return true;
  if (e.follow) return false;
  if (e.ride && !rideCan(e.ride, terrain, e.terrains)) return false;
  if (asList(e.magic) && !asList(e.magic).includes(s.magic.name)) return false;
  if (weather && asList(e.weather) && !asList(e.weather).some(w => weather.name.toLowerCase().includes(String(w).toLowerCase()))) return false;
  if (asList(e.rank) && !asList(e.rank).includes(s.rank)) return false;
  if (e.ref && !TRAVEL_REFS.find(r => r.key === s.refs).tiers.includes(e.ref)) return false;
  return true;
};
// On open water, an event that names no terrain only happens if it reads as a sea event, or comes from a kind of
// event that can happen anywhere (omens, strangeness, callbacks) and doesn't mention roads, farms or fields.
const SEA_WORDS = /\b(ship|ships|sea|seas|deck|wave|waves|sail|sails|boat|boats|crew|harbou?r|ocean|island|reef|whale|dolphins?|gulls?|tide|mast|hull|sky ship|fleet|merfolk|kraken|voyage|sailors?|pirates?)\b/i;
const LAND_WORDS = /\b(road|roadside|roads|wagons?|carts?|villages?|farms?|farmers?|farmhouse|forest|woods|trail|path|bridge|hills?|horses?|mules?|meadow|fields?|inn|tavern|crossroads|milestone|ditch|hedge|orchard|caves?|campfire|tents?|graveyard|shrine|mill|toll|fence|towns?|caravan|ruins?|trees?|valley|ridge|cliff|canyon|desert|dunes?|mountains?|swamp|mud|stream|ford|walk|walking|bushes|posse|border)\b/i;
const ANYWHERE_KINDS = ['omen', 'strange', 'callback', 'dilemma', 'shortcut'];
export function seaFits(key, e, terrain) {
  if (terrain !== 'Open sea' || e.terrains) return true;
  const t = [e.name, e.text, e.dm].filter(x => typeof x === 'string').join(' ');
  return SEA_WORDS.test(t) || (ANYWHERE_KINDS.includes(key) && !LAND_WORDS.test(t));
}
const eventWeight = (e, s) => (RARITY[e.rarity] || 1) * (s.mood === 'Balanced' || !e.tone ? 1
  : MOOD_TONES.up.includes(e.tone) ? (s.mood === 'Gentle' ? 2 : 0.5) : MOOD_TONES.down.includes(e.tone) ? (s.mood === 'Gentle' ? 0.5 : 2) : 1);

/**
 * The no-repeat deck: pick an event the campaign hasn't had yet. `seen` holds the names already rolled, per category,
 * oldest first, and is updated in place. Once most of what fits has been seen, the oldest half is forgotten, except
 * rare events, which happen once a campaign.
 */
function deckPick(rng, key, pool, s, seen) {
  const wpick = list => weighted(rng, list, e => eventWeight(e, s));
  if (!seen) return wpick(pool);
  const list = (seen[key] ||= []);
  const rare = new Set(pool.filter(e => e.rarity === 'rare').map(e => e.name));
  let fresh = pool.filter(e => !list.includes(e.name));
  if (pool.length - fresh.length >= 0.8 * pool.length) {
    const old = list.filter(n => !rare.has(n));
    const forget = new Set(old.slice(0, Math.ceil(old.length / 2)));
    seen[key] = list.filter(n => !forget.has(n));
    fresh = pool.filter(e => !seen[key].includes(e.name));
  }
  if (!fresh.length) fresh = pool.filter(e => !rare.has(e.name));
  if (!fresh.length) fresh = pool;
  const e = wpick(fresh);
  if (!seen[key].includes(e.name)) seen[key].push(e.name);
  return e;
}
/** Put a rerolled event back in the deck. */
function unsee(seen, key, name) {
  if (seen?.[key] && name) seen[key] = seen[key].filter(n => n !== name);
}
function pickTime(data, rng, when) {
  const times = data.travel?.times || { day: ['Morning', 'Midday', 'Afternoon', 'Evening'], night: ['First watch', 'Second watch'] };
  return pick(rng, when === 'night' ? times.night : when === 'day' ? times.day : [...times.day, ...times.night]);
}

/**
 * Fill an event's text: {a|b|c} picks one, {iron:...|bronze:...} picks by the party's rank, and {npc}, {place},
 * {faction}, {church} and {hook} come from the wiki and saved hooks. Wiki NPCs used are added to `met`.
 */
function fillTravelText(text, rng, wiki = {}, { rank = null, met = null, made = null } = {}) {
  const fallback = { npc: 'someone the party met before', place: 'the last town they passed through', faction: 'a faction the party has dealt with', church: 'a god', hook: 'an old rumour the party never chased down' };
  const from = { npc: wiki.npcs, place: wiki.locations, faction: wiki.factions, church: wiki.churches };
  // Wiki tokens can sit inside a {a|b} choice, so they're set aside while the choice is made.
  return String(text || '').replace(/\{(npc|place|faction|church|hook)\}/g, '\u0001$1\u0002').replace(/\{([^{}]*\|[^{}]*)\}/g, (m, body) => {
    const opts = body.split('|');
    const byRank = opts.map(o => o.match(/^(normal|iron|bronze|silver|gold|diamond):(.*)$/i));
    if (byRank.every(Boolean)) {
      const want = String(rank || 'Iron').toLowerCase();
      return (byRank.find(x => x[1].toLowerCase() === want) || byRank.find(x => RANKS.indexOf(cap1(x[1].toLowerCase())) > RANKS.indexOf(cap1(want))) || byRank[byRank.length - 1])[2];
    }
    return pick(rng, opts);
  }).replace(/\u0001(npc|place|faction|church|hook)\u0002/g, (m, k) => {
    if (k === 'hook') return wiki.hooks?.length ? pick(rng, wiki.hooks) : fallback.hook;
    // Now and then the place is a new one near the road, which the DM can make a page (wiki.newPlace, once per event).
    if (k === 'place' && made && wiki.newPlace && !made.asked) {
      made.asked = true;
      const got = wiki.newPlace({}, rng);
      if (got) { if (got.draft) made.push(got.draft); return `[[${got.title}]]`; }
    }
    if (!from[k]?.length) return fallback[k];
    const name = pick(rng, from[k]);
    if (k === 'npc' && met && !met.includes(name)) met.push(name);
    return `[[${name}]]`;
  });
}

function travelEventFrom(e, rng, wiki, s = null, n = 1) {
  const met = [], made = [];
  const fill = t => fillTravelText(t, rng, wiki, { rank: s?.rank, met, made });
  const out = { name: e.name, text: fill(e.text) };
  for (const k of ['twist', 'link', 'lose', 'progress', 'next', 'check', 'pass', 'fail', 'failText', 'ride', 'cost', 'tone', 'rarity', 'ref', 'nod', 'npc', 'follow']) {
    if (e[k] === undefined || (k === 'twist' && e[k] === false)) continue;
    out[k] = ['twist', 'check', 'failText', 'cost'].includes(k) ? fill(e[k]) : e[k];
  }
  // A river boat remembers where the river was, so it knows where it has to stop.
  if (e.ride) out.ride = { ...e.ride, ...(e.terrains ? { terrains: e.terrains } : {}) };
  // A ride is an offer: it only starts once the DM accepts it for the party (and pays any fare).
  if (e.ride) out.offer = 'open';
  if (e.then?.name) {
    const [lo, hi] = [].concat(e.then.after ?? [1, 3]).map(Number);
    out.then = { name: e.then.name, due: n + int(rng, lo || 1, hi || lo || 1) };
  }
  if (met.length) out.people = met;
  if (made.length) out.newPlace = made[0];
  return out;
}

/** Coins, sometimes cores and an essence, scaled to the party's rank. */
export function travelLoot(data, level, theme, rng) {
  const rank = rankForLevel(level) === 'Normal' ? 'Iron' : rankForLevel(level);
  const coin = { Iron: ['iron', 5], Bronze: ['bronze', 1], Silver: ['silver', 1], Gold: ['silver', 10], Diamond: ['gold', 1] }[rank];
  const gp = roll(rng, 2, 6) * coin[1] * COIN_VALUE[coin[0]];
  const loot = { gp, coins: formatSpirit(gp) };
  if (chance(rng, 0.4)) loot.cores = { rank, count: int(rng, 1, 3) };
  if (chance(rng, 0.2)) {
    const e = lootEssence(data, theme && theme !== 'any' ? theme : null, rank, rng, rank === 'Iron' ? ['common', 'uncommon'] : null);
    if (e) loot.essence = essenceLabel(e);
  }
  return loot;
}

// ---------- when exploring goes wrong ----------
// A place the party leaves the route to explore isn't free treasure. Most of the time something comes with it: a fight,
// a hazard with a check, a puzzle guarding the prize, a choice with no clean answer, a price paid, or nothing there at all.

export const TWIST_TYPES = ['fight', 'hazard', 'puzzle', 'dilemma', 'cost', 'empty'];
export const TWIST_NAMES = { fight: 'A fight', hazard: 'A hazard', puzzle: 'A puzzle', dilemma: 'A dilemma', cost: 'A price', empty: 'Nothing there' };
export const EXPLORE_RISKS = [{ key: 'low', name: 'Mostly safe' }, { key: 'normal', name: 'Normal' }, { key: 'high', name: 'Dangerous' }];

/**
 * What goes wrong when the party explores a place off the route, or null when nothing does. risk: the Travel tab's
 * Exploring setting; danger: the place kind's explore.danger; seen: surface, shallow or sunken; place: what it is.
 * type forces one sort of twist (one of TWIST_TYPES), or 'none' for none. where: 'sea' or 'land' (land uses the
 * onLand lists where it has them, and the sea's chance, weights and puzzles).
 */
export function exploreTwist(data, { level = 1, risk = 'normal', danger = 0.25, seen = '', place = '', type = '', where = 'sea' } = {}, rng = Math.random) {
  const W = data.places?.sea?.twists;
  if (!W || type === 'none') return null;
  const T = where === 'land' && data.places?.onLand ? { ...W, ...data.places.onLand, chance: W.chance, weights: W.weights, puzzles: W.puzzles } : W;
  const bank = list(data.astral?.puzzleBank);
  if (!type) {
    const base = T.chance?.[risk] ?? T.chance?.normal ?? 0.6;
    if (!chance(rng, Math.min(0.95, Math.max(0.05, base + (danger - 0.25) * 0.4)))) return null;
    const w = T.weights || {}, scale = { fight: 0.5 + 2 * danger, hazard: 0.5 + danger };
    type = weighted(rng, TWIST_TYPES.filter(k => k !== 'puzzle' || bank.length), k => (w[k] ?? 1) * (scale[k] ?? 1));
  }
  const rank = rankForLevel(level) === 'Normal' ? 'Iron' : rankForLevel(level);
  const fill = t => scaleText(String(t || '').replace(/\{place\}/g, place || 'place'), rank);
  if (type === 'fight') return { type, text: fill(pick(rng, list(T.fights)) || 'Something here fights back.') };
  if (type === 'hazard') {
    const pool = list(T.hazards).filter(h => !seen || !list(h.seen).length || list(h.seen).includes(seen));
    const h = pool.length ? pick(rng, pool) : null;
    if (!h) return null;
    return { type, text: fill(h.text), check: fill(h.check), fail: fill(h.fail), lose: Number(h.lose) || 0, result: null };
  }
  if (type === 'puzzle') {
    if (!bank.length) return null;
    return { type, text: fill(pick(rng, list(T.puzzles)) || 'The prize is locked behind a puzzle.'), puzzle: puzzleOf(pick(rng, bank), rank, rng), result: null };
  }
  if (type === 'dilemma') {
    const d = pick(rng, list(T.dilemmas));
    if (!d) return null;
    return { type, text: fill(d.text), choices: list(d.choices).map(c => ({ ...c, label: c.label, text: fill(c.text) })), chose: null };
  }
  if (type === 'cost') {
    const c = pick(rng, list(T.costs));
    return c ? { type, text: fill(c.text), lose: Number(c.lose) || 0 } : null;
  }
  if (type === 'empty') return { type, text: fill(pick(rng, list(T.empty)) || 'There is nothing here worth taking.') };
  return null;
}

/** Extra share of the day a twist costs, as things stand: a failed hazard, a price, or a choice that takes time. */
export function twistLose(t) {
  if (!t) return 0;
  if (t.type === 'hazard') return t.result === 'fail' ? t.lose || 0 : 0;
  if (t.type === 'puzzle') return t.result === 'fail' ? 0.25 : 0;
  if (t.type === 'dilemma') return Number(t.choices?.[t.chose]?.lose) || 0;
  if (t.type === 'cost') return t.lose || 0;
  return 0;
}
/** Whether the party gets the loot: 'yes', 'no', or 'open' while a puzzle or a choice is still to settle. */
export function twistLoot(t) {
  if (!t) return 'yes';
  if (t.type === 'empty') return 'no';
  if (t.type === 'puzzle') return t.result === 'pass' ? 'yes' : t.result === 'fail' ? 'no' : 'open';
  if (t.type === 'dilemma') return t.chose === null || t.chose === undefined ? 'open' : t.choices?.[t.chose]?.loot === false ? 'no' : 'yes';
  return 'yes';
}
/** The share of the day a diversion takes in all: getting there and exploring, plus whatever went wrong. */
export const divertShare = dv => !dv ? 0 : Math.min(1, Math.round(((Number(dv.frac) || 0) + twistLose(dv.twist)) * 100) / 100);

function rollWeather(data, s, rng) {
  const list = (data.travel?.weather || []).filter(w => !w.terrains || w.terrains.includes(s.terrain.name));
  const w = list.length ? weighted(rng, list) : { name: 'Clear', dc: 0, text: '' };
  return { name: w.name, dc: Number(w.dc) || 0, text: w.text || '' };
}

function rollNav(s, weather, rng, advantage) {
  const dc = (Number(s.terrain.dc) || 0) + (weather?.dc || 0);
  if (dc <= 0) return { dc: 0, result: 'auto' };
  const adv = advantage || s.guide || s.pace.name === 'Slow';
  const pen = s.pace.name === 'Fast' ? -5 : 0;
  const rolls = adv ? [int(rng, 1, 20), int(rng, 1, 20)] : [int(rng, 1, 20)];
  const d20 = Math.max(...rolls);
  const total = d20 + s.bonus + pen;
  // A shortcut takes a natural 20, or beating a hard check (DC 10 and up) by 10: an easy road has none to find.
  const result = total < dc - 4 ? 'badly' : total < dc ? 'lost' : d20 === 20 || (dc >= 10 && total >= dc + 10) ? 'shortcut' : 'kept';
  return { dc, rolls, bonus: s.bonus + pen, total, adv, result };
}

const ENC_MOD = { badly: -3 };
function rollEncounter(data, s, nav, rng, wiki, safe, { seen = null, n = 1, weather = null } = {}) {
  if (safe) return { skipped: true };
  const cats = data.travel?.categories || [];
  const way = s.way || 'land';
  // Nobody lies in wait in the sky: up there it's only ever something that flies.
  const kinds = ['monster', 'ambush'].filter(k => s.cats.includes(k) && cats.some(c => c.key === k) && !(way === 'air' && k === 'ambush'));
  if (!kinds.length) return { skipped: true, off: true };
  const need = Math.max(2, (Number(s.magic.encounter) || 16) + (ENC_MOD[nav.result] || 0));
  const r = int(rng, 1, 20);
  if (r < need) return { roll: r, need, hit: false };
  const kind = kinds.length === 1 ? kinds[0] : chance(rng, Number(s.terrain.ambush) || 0.3) ? 'ambush' : 'monster';
  const cat = cats.find(c => c.key === kind);
  // Afloat, the event has to read as happening on the water (a river boat in the marsh keeps the marsh's events);
  // aloft, it can't name any ground at all.
  const ground = way === 'water' && s.terrain.name !== 'Delta and marsh' ? 'Open sea' : s.terrain.name;
  const aloft = e => !e.terrains && !LAND_WORDS.test([e.name, e.text, e.dm].filter(x => typeof x === 'string').join(' '));
  const opts = (cat.events || []).filter(e => way === 'air' ? fits({ ...e, terrains: undefined }, s.terrain.name, s, weather) && aloft(e)
    : fits(e, ground, s, weather) && seaFits(cat.key, e, ground));
  const ev = opts.length ? deckPick(rng, cat.key, opts, s, seen) : { name: cat.name, text: '' };
  const time = pickTime(data, rng, ev.when || cat.when || 'any');
  let encounter;
  if (kind === 'ambush') {
    // People, not beasts: bandits, cultists, soldiers and mages, spawned at the party's rank where they're too weak.
    const who = new Set((ev.foes?.length ? ev.foes : data.travel?.ambushers || []).map(n => n.toLowerCase()));
    const foes = data.monsters.monsters.filter(m => who.has(m.name.toLowerCase()));
    const pool = foes.length >= 2 ? { ...data, monsters: { ...data.monsters, monsters: foes } } : data;
    // Raiders at sea come aboard from their own boat, so they don't need to swim.
    encounter = generateEncounter(pool, { level: s.level, partySize: s.partySize, difficulty: s.difficulty, theme: 'any', kinds: foes.length >= 2 ? [] : ['humanoid'] }, rng);
  } else {
    const theme = way === 'land' ? pick(rng, s.terrain.themes?.length ? s.terrain.themes : ['any']) : way === 'air' ? 'Wind' : chance(rng, 0.8) ? 'Water' : 'Wind';
    encounter = generateEncounter(data, { level: s.level, partySize: s.partySize, difficulty: s.difficulty, theme, kinds: way === 'land' ? s.terrain.kinds || [] : [], moves: way }, rng);
  }
  return { roll: r, need, hit: true, kind, label: cat.name, event: travelEventFrom(ev, rng, wiki, s, n), time, encounter };
}

function rollEvent(data, s, rng, wiki, { seen = null, n = 1, weather = null, pending = [] } = {}) {
  const all = data.travel?.categories || [];
  const cats = all.filter(c => c.check !== 'encounter' && s.cats.includes(c.key)
    && (c.events || []).some(e => fits(e, s.terrain.name, s, weather) && seaFits(c.key, e, s.terrain.name)));
  if (!cats.length) return { skipped: true, off: true };
  const r = int(rng, 1, 20);
  if (r < s.eventOn) return { roll: r, need: s.eventOn, hit: false };
  // A follow-up an earlier event promised comes first, once its day has come.
  const due = pending.find(p => p.due <= n);
  const dueCat = due && all.find(c => c.key === due.key);
  const follow = dueCat && (dueCat.events || []).find(e => e.name === due.name);
  const cat = follow ? dueCat : weighted(rng, cats);
  const e = follow || deckPick(rng, cat.key, cat.events.filter(x => fits(x, s.terrain.name, s, weather) && seaFits(cat.key, x, s.terrain.name)), s, seen);
  // Events happen while the party is moving unless they say otherwise.
  const out = { roll: r, need: s.eventOn, hit: true, key: cat.key, label: cat.name, time: pickTime(data, rng, e.when || cat.when || 'day'), event: travelEventFrom(e, rng, wiki, s, n) };
  if (e.link === 'loot') out.loot = travelLoot(data, s.level, pick(rng, s.terrain.themes || ['any']), rng);
  return out;
}

/** Follow-up events promised by earlier days and not yet met: [{ key, name, due }]. */
export function journeyPending(days) {
  const out = [];
  for (const d of days) {
    const e = d.event?.hit ? d.event.event : null;
    if (e?.follow) { const i = out.findIndex(p => p.name === e.name); if (i >= 0) out.splice(i, 1); }
    if (e?.then) out.push({ key: d.event.key, name: e.then.name, due: e.then.due });
  }
  return out;
}

/**
 * Extra days of distance from the day's event: a lucky break, or a shortcut that pays off when its check is passed
 * (and can cost time when it's failed). Unresolved checks count for nothing yet.
 */
export function travelEventProgress(day) {
  const e = day.event?.hit ? day.event.event : null;
  if (!e) return 0;
  return (Number(e.progress) || 0) + (e.result === 'pass' ? Number(e.pass) || 0 : e.result === 'fail' ? Number(e.fail) || 0 : 0);
}

/** Miles covered on a day: none when lost (unless flying), half again on a shortcut, plus anything an event adds. */
export function travelDayMiles(day) {
  if (day.teleport) return day.miles || 0;
  const base = day.pace || 0;
  const nav = day.ride?.flies ? 1 : { lost: 0, badly: 0, shortcut: 1.5 }[day.nav?.result] ?? 1;
  // A diversion to explore something at sea takes its share of the day.
  const kept = 1 - Math.min(1, divertShare(day.sea?.divert) + divertShare(day.land?.divert));
  return Math.max(0, Math.round((base * nav + (nav ? base * travelEventProgress(day) : 0)) * kept));
}

/**
 * A faster way to travel for a few days: offered by yesterday's event and accepted (once its check is passed, if
 * it has one), or still running from before. It starts the day after it's found. Rides rolled before offers
 * existed have no `offer` and count as taken.
 */
export function travelRide(prev) {
  const e = prev?.event?.hit ? prev.event.event : null;
  if (e?.ride && (e.offer ?? 'taken') === 'taken' && (!e.check || e.result === 'pass')) return { ...e.ride, left: Math.max(1, Number(e.ride.days) || 1) };
  if (prev?.ride?.left > 1) return { ...prev.ride, left: prev.ride.left - 1 };
  return null;
}
function applyRide(day, prev) {
  if (day.teleport) return { ...day };
  const d = { ...day };
  d.basePace ??= d.pace || 0;
  d.ride = travelRide(prev);
  delete d.rideEnded;
  // A boat can't go overland and a horse can't swim: the ride ends where the ground changes.
  if (d.ride && !rideCan(d.ride, d.terrain, d.ride.terrains)) { d.rideEnded = d.ride.name; d.ride = null; }
  if (!d.ride) delete d.ride;
  d.pace = d.ride ? Math.max(d.basePace, Math.round((Number(d.ride.miles) || 0) * (d.ride.flies ? 1 : d.terrainSpeed ?? 1))) : d.basePace;
  d.miles = travelDayMiles(d);
  return d;
}

/**
 * One day of travel. `prev` is the day before, whose events can carry over (good weather, safe company).
 * `wiki` is { npcs, locations, factions, churches, hooks } for callbacks.
 */
export function rollTravelDay(data, opts = {}, rng = Math.random, { prev = null, wiki = {}, n = 1, seen = null, pending = [] } = {}) {
  const s = travelSettings(data, opts);
  const ride = travelRide(prev);
  s.way = travelWay({ mode: s.mode.name, terrain: s.terrain.name, ride: ride && rideCan(ride, s.terrain.name, ride.terrains) ? ride : null });
  const carried = prev?.event?.hit ? prev.event.event?.next : null;
  const weather = rollWeather(data, s, rng);
  const nav = rollNav(s, weather, rng, carried === 'advantage');
  const day = {
    n, terrain: s.terrain.name, magic: s.magic.name, mode: s.mode.name, paceName: s.pace.name, basePace: travelDayPace(s, data),
    terrainSpeed: Number(s.terrain.speed) || 1, rank: s.mode.rank ? s.rank : null,
    weather, nav, carried,
    encounter: rollEncounter(data, s, nav, rng, wiki, carried === 'safe', { seen, n, weather }),
    event: rollEvent(data, s, rng, wiki, { seen, n, weather, pending }),
    scenery: s.terrain.scenery?.length ? pick(rng, s.terrain.scenery) : '',
  };
  return applyRide(day, prev);
}

/** Roll one part of a day again: 'weather', 'nav', 'encounter', 'event', 'scenery' or 'all'. */
export function rerollTravelDay(data, day, part, opts = {}, rng = Math.random, { prev = null, wiki = {}, seen = null, pending = [] } = {}) {
  // What's rolled again goes back in the deck.
  if (['all', 'encounter'].includes(part) && day.encounter?.hit) unsee(seen, day.encounter.kind, day.encounter.event?.name);
  if (['all', 'event'].includes(part) && day.event?.hit && !day.event.event?.follow) unsee(seen, day.event.key, day.event.event?.name);
  // A day already in the session notes stays there when it's rolled again.
  if (part === 'all') return { ...rollTravelDay(data, opts, rng, { prev, wiki, n: day.n, seen, pending }), ...(day.logged ? { logged: day.logged } : {}) };
  const s = travelSettings(data, { ...opts, terrain: day.terrain, magic: day.magic });
  s.way = travelWay({ mode: day.mode || s.mode.name, terrain: day.terrain, ride: day.ride });
  const d = { ...day };
  const ctx = { seen, n: day.n, weather: d.weather, pending };
  if (part === 'weather') { d.weather = rollWeather(data, s, rng); d.nav = rollNav(s, d.weather, rng, d.carried === 'advantage'); }
  if (part === 'nav') d.nav = rollNav(s, d.weather, rng, d.carried === 'advantage');
  if (part === 'encounter') d.encounter = rollEncounter(data, s, d.nav, rng, wiki, d.carried === 'safe', ctx);
  if (part === 'event') d.event = rollEvent(data, s, rng, wiki, ctx);
  if (part === 'scenery') d.scenery = s.terrain.scenery?.length ? pick(rng, s.terrain.scenery) : '';
  return applyRide(d, prev);
}

/** Force the result of the day's Survival check, as when the players roll it themselves. */
export const NAV_RESULTS = ['kept', 'lost', 'badly', 'shortcut'];
export function setTravelNav(day, result) {
  const d = { ...day, nav: { ...day.nav, result, set: true } };
  d.miles = travelDayMiles(d);
  return d;
}

/**
 * The fare for a ride, read from the event's cost ("3 iron spirit coins a head", "2 iron spirit coins a head a day",
 * "a donation of 5 iron spirit coins"). Returns { each, perHead, perDay, total } in iron (gp), or null when the
 * cost isn't in coins (a favour) or there is none.
 */
export function rideFee(cost, { people = 1, days = 1 } = {}) {
  const m = String(cost || '').match(/(\d+)\s+(iron|bronze|silver|gold|diamond)\s+(?:spirit\s+)?coins?/i);
  if (!m) return null;
  const each = Number(m[1]) * COIN_VALUE[m[2].toLowerCase()];
  const rest = String(cost).slice(m.index + m[0].length);
  const perHead = /\b(a head|each|per head|a person|per person)\b/i.test(rest);
  const perDay = /\b(a day|per day|daily)\b/i.test(rest);
  const total = each * (perHead ? Math.max(1, Number(people) || 1) : 1) * (perDay ? Math.max(1, Number(days) || 1) : 1);
  return { each, perHead, perDay, total };
}

/** Take up or turn down the ride a day's event offers: offer is 'taken', 'declined' or 'open'; paid is the fare in gp. */
export function setRideOffer(day, offer, paid = null) {
  if (!day.event?.hit || !day.event.event?.ride) return day;
  const ev = { ...day.event.event, offer };
  if (offer === 'taken' && paid) ev.paid = paid; else delete ev.paid;
  return { ...day, event: { ...day.event, event: ev } };
}

/** Mark the check an event asks for as passed ('pass'), failed ('fail') or not rolled yet (''). */
export function setTravelCheck(day, result) {
  if (!day.event?.hit) return day;
  const ev = { ...day.event.event };
  if (result) ev.result = result; else delete ev.result;
  const d = { ...day, event: { ...day.event, event: ev } };
  d.miles = travelDayMiles(d);
  return d;
}

/** A new journey. `from` and `to` are { name, at: [lon, lat] } or null; `miles` overrides the map distance. Roads wind (a fifth
 * longer than the straight line); ships and sky ships pass `winding: 1`. */
export function newJourney({ from = null, to = null, miles = null, winding = ROUTE_WINDING } = {}, now = new Date()) {
  const straight = from?.at && to?.at ? travelDistance(from.at, to.at) : null;
  const total = Number(miles) > 0 ? Math.round(Number(miles)) : straight ? Math.round(straight * winding) : null;
  return { id: now.getTime().toString(36) + Math.floor(Math.random() * 1e6).toString(36), from, to, miles: total, straight: straight ? Math.round(straight) : null, days: [], started: now.toISOString() };
}

export const journeyDone = j => j.days.reduce((t, d) => t + (d.miles || 0), 0);
export const journeyLeft = j => j.miles ? Math.max(0, j.miles - journeyDone(j)) : null;

/**
 * A journey can go in legs (j.legs: [{ name, mode, terrain, end }], `end` the miles done when the leg ends), each its own way
 * of travelling: a ship to a port, then horses overland. The leg the party is on after `done` miles.
 */
export function journeyLeg(j, done = journeyDone(j)) {
  if (!j.legs?.length) return -1;
  const k = j.legs.findIndex(l => done < l.end);
  return k < 0 ? j.legs.length - 1 : k;
}
/** A day that reaches the end of a leg stops there, at the port or the stop, and says what comes next. */
function legStop(j, day, done) {
  delete day.stop;
  const k = journeyLeg(j, done);
  if (k < 0 || k >= j.legs.length - 1) return;
  const left = j.legs[k].end - done;
  if (day.miles >= left) { day.miles = Math.max(0, left); day.stop = { name: j.legs[k].name, mode: j.legs[k + 1].mode, terrain: j.legs[k + 1].terrain }; }
}

/** Roll up to `count` more days, stopping when the party arrives. Returns the journey with the new days. */
export function travelOn(data, journey, opts, count = 1, rng = Math.random, wiki = {}, seen = null) {
  const j = { ...journey, days: [...journey.days] };
  for (let i = 0; i < count; i++) {
    if (j.miles && journeyLeft(j) <= 0) break;
    const day = rollTravelDay(data, opts, rng, { prev: j.days[j.days.length - 1], wiki, n: j.days.length + 1, seen, pending: journeyPending(j.days) });
    legStop(j, day, journeyDone(j));
    const left = journeyLeft(j);
    if (left !== null && day.miles >= left) { day.miles = left; day.arrived = true; }
    j.days.push(day);
  }
  return j;
}

/** Recount a journey after a day changed: miles are capped so the last day is the day they arrive. */
export function settleJourney(j) {
  const days = [];
  let done = 0;
  for (const d0 of j.days) {
    // Rides depend on the day before, so a check marked passed or failed changes the days after it.
    const d = applyRide(d0, days[days.length - 1]);
    delete d.arrived;
    legStop(j, d, done);
    if (j.miles && done + d.miles >= j.miles) { d.miles = Math.max(0, j.miles - done); d.arrived = true; }
    done += d.miles;
    days.push(d);
    if (d.arrived) break;
  }
  return { ...j, days };
}

/** Who loses what when an event costs food: rations for Normal-rank people, spirit coins of their own rank for essence users. */
export function travelSupplies(daysLost, party = []) {
  const coins = {}, rations = [], eaters = [];
  for (const p of party) {
    const rank = p.rank || 'Normal';
    if (rank === 'Normal') { rations.push(p.name); continue; }
    const k = rank.toLowerCase();
    coins[k] = (coins[k] || 0) + daysLost;
    eaters.push(`${p.name} (${daysLost} ${k})`);
  }
  const gp = Object.entries(coins).reduce((t, [k, n]) => t + n * (COIN_VALUE[k] || 0), 0);
  return { days: daysLost, rations, coins, eaters, gp };
}

/** The fee to teleport: `each` gp a head unless a custom `total` was agreed (a haggle, a favour, a free pass). */
export function teleportFee({ people = 1, each = 0, total = '' } = {}) {
  const custom = total !== '' && total !== null && total !== undefined && Number.isFinite(Number(total));
  return Math.max(0, Math.round(custom ? Number(total) : Math.max(1, Number(people) || 1) * (Number(each) || 0)));
}

/** A journey made in one step through the teleport circle network: it arrives the day it leaves. */
export function teleportJourney({ from, to, people = 1, each = 0, total = '', paid = false, runBy = '' }, now = new Date()) {
  const j = newJourney({ from, to }, now);
  // A circle goes straight there: no winding roads.
  if (j.straight) j.miles = j.straight;
  const fee = teleportFee({ people, each, total });
  j.days = [{ n: 1, teleport: { people: Math.max(1, Number(people) || 1), each: Number(each) || 0, fee, paid: !!paid, runBy }, miles: j.miles || 0, arrived: true }];
  return j;
}

/** "by sailing ship over open sea" for a leg. */
const legHow = l => `${l.mode === 'On foot' ? 'on foot' : `by ${String(l.mode || 'On foot').toLowerCase()}`}${l.terrain ? ` (${l.terrain.toLowerCase()})` : ''}`;
const placeName = p => !p ? '' : p.page ? `[[${p.name}]]` : p.name;

/** A journey's title: the name the DM gave it, or one like "Journey: Greenstone to Rimaros". */
export const journeyTitle = j => j.name ? j.name : j.from && j.to ? `Journey: ${j.from.name} to ${j.to.name}` : j.to ? `Journey to ${j.to.name}` : 'Journey';

export function travelDayToMarkdown(day, { interactive = false, party = [], index = 0 } = {}) {
  if (day.teleport) {
    const t = day.teleport;
    const custom = t.fee !== t.people * t.each;
    return [`### Day ${day.n}: arrived`, '',
      `- **Teleport circle:** stepped through ${t.runBy ? `the circle network run by ${t.runBy}` : 'the circle network'} and arrived the same moment.`,
      `- **Fee:** ${t.fee ? `${formatSpirit(t.fee)} spirit coins` : 'nothing'}${custom ? ` (agreed price; the usual rate is ${formatSpirit(t.each)} a head)` : ` (${t.people} traveller${t.people === 1 ? '' : 's'} at ${formatSpirit(t.each)} each)`}${t.fee ? t.paid ? ', paid from the party purse.' : ', not taken from the party purse.' : '.'}`].join('\n');
  }
  const re = (part, label = 'Reroll') => interactive ? ` <button class="mini-reroll" data-day="${index}" data-part="${part}" title="${label}">↻</button>` : '';
  const L = [];
  const nav = day.nav || {};
  L.push(`### Day ${day.n}${day.arrived ? ': arrived' : ''}`);
  L.push(`*${day.terrain} · ${day.magic} magic · ${day.mode}${day.rank && day.rank !== 'Normal' ? ` at ${day.rank} rank` : ''}, ${day.paceName.toLowerCase()} pace*${re('all', 'Roll this whole day again')}`, '');
  if (day.stop) L.push(`- **Stop:** reached ${day.stop.name}. The next leg is ${legHow(day.stop)}.`);
  if (day.rideEnded) L.push(`- **Riding:** ${day.rideEnded} can go no further over ${day.terrain.toLowerCase()}, and the party goes on without it.`);
  if (day.ride) L.push(`- **Riding:** ${day.ride.name}, ${day.pace} miles today${day.ride.flies ? ', flying, so the party can\'t get lost' : ''}. ${day.ride.left > 1 ? `${day.ride.left - 1} more day${day.ride.left > 2 ? 's' : ''} after this.` : 'The last day of it.'}`);
  L.push(`- **Weather:** ${day.weather.name}. ${day.weather.text}${re('weather', 'Different weather (rolls the Survival check again too)')}`);
  const NAV_TEXT = { auto: 'Clear road; no check needed.', kept: 'Kept the way.', shortcut: `${nav.set ? 'Found' : nav.rolls?.includes(20) ? 'A natural 20: found' : 'Beat the check by 10: found'} a shortcut, half again the distance.`, lost: 'Lost: no progress today.', badly: 'Badly lost: no progress, and wandered into worse ground (encounters are more likely today).' };
  const check = nav.result === 'auto' ? '' : nav.set ? `Survival DC ${nav.dc} (set by hand). ` : `Survival DC ${nav.dc}: rolled ${nav.rolls.join(' and ')}${nav.adv ? ' with advantage' : ''}${nav.bonus ? ` ${nav.bonus > 0 ? '+' : '-'} ${Math.abs(nav.bonus)}` : ''} = ${nav.total}. `;
  const toggle = interactive && nav.result !== 'auto' ? ` <span class="nav-set">${NAV_RESULTS.map(r => `<button class="chip${nav.result === r ? ' on' : ''}" data-day="${index}" data-nav="${r}">${{ kept: 'Kept', lost: 'Lost', badly: 'Badly lost', shortcut: 'Shortcut' }[r]}</button>`).join('')}</span>` : '';
  if (day.ride?.flies) L.push(`- **The way:** Flying, so no Survival check is needed. **${day.miles} mile${day.miles === 1 ? '' : 's'}**.`);
  else L.push(`- **The way:** ${check}${NAV_TEXT[nav.result]} **${day.miles} mile${day.miles === 1 ? '' : 's'}**.${day.carried === 'advantage' ? ' (Advantage from yesterday\'s fine weather.)' : ''}${re('nav', 'Roll the Survival check again')}${toggle}`);
  const enc = day.encounter || {};
  if (enc.skipped) L.push(`- **Encounter:** ${enc.off ? 'switched off.' : 'none; travelling in good company today.'}`);
  else if (!enc.hit) L.push(`- **Encounter:** none (rolled ${enc.roll}, needed ${enc.need}).${re('encounter', 'Roll the encounter check again')}`);
  else {
    L.push(`- **${enc.label} (${enc.time.toLowerCase()}):** ${enc.event.name}. ${enc.event.text}${enc.event.twist ? ` *${enc.event.twist}*` : ''}${re('encounter', 'Roll the encounter check again')}`);
    if (enc.encounter) {
      for (const l of encounterLines(enc.encounter)) L.push(`    - ${l}`);
      if (interactive && enc.encounter.groups.length) L.push(`    - ${battleLink(enc.encounter)} <button class="mini-reroll travel-enc" data-day="${index}" title="Open this fight in the Encounter generator, with stat cards">Stat cards</button>`);
    }
  }
  const ev = day.event || {};
  if (ev.skipped) L.push(`- **Event:** ${ev.off ? 'switched off.' : 'none.'}`);
  else if (!ev.hit) L.push(`- **Event:** none (rolled ${ev.roll}, needed ${ev.need}).${re('event', 'Roll the event check again')}`);
  else {
    const page = ev.event.page ? ` ([[${ev.event.page}]])` : '';
    const link = page ? '' : interactive && (ev.event.link === 'npc' || ev.event.npc) ? ` <button class="mini-reroll travel-npc" data-day="${index}" title="Make this person a page under Minor NPCs">NPC page</button>`
      : interactive && ev.event.link === 'market' ? ` <button class="mini-reroll travel-market" data-day="${index}" title="Open their wares in the Market generator">Wares</button>` : '';
    const nod = interactive && ev.event.nod ? ` <span class="dm-tool travel-nod" title="A reference, for the DM only">${ev.event.ref ? `${cap1(ev.event.ref)}: ` : ''}${escHtml(ev.event.nod)}</span>` : '';
    L.push(`- **${ev.label} (${ev.time.toLowerCase()}):** ${ev.event.name}${ev.event.follow ? ' (follow-up)' : ''}. ${ev.event.text}${ev.event.twist ? ` *${ev.event.twist}*` : ''}${page}${link}${nod}${re('event', 'Roll the event check again')}`);
    const e = ev.event;
    const gain = x => x > 0 ? `gain ${dayWords(x)}` : `lose ${dayWords(-x)}`;
    if (e.cost) L.push(`    - Cost: ${e.cost}.`);
    if (e.check) {
      const chips = interactive ? ` <span class="nav-set">${[['pass', 'Passed'], ['fail', 'Failed'], ['', 'Not rolled']].map(([v, label]) => `<button class="chip${(e.result || '') === v ? ' on' : ''}" data-day="${index}" data-check="${v}">${label}</button>`).join('')}</span>` : '';
      const outcome = e.result === 'pass' ? ' **Passed.**' : e.result === 'fail' ? ' **Failed.**' : '';
      L.push(`    - Check: ${e.check}. On a success: ${e.ride ? `the ride below` : gain(Number(e.pass) || 0)}${e.fail || e.failText ? `; on a failure: ${[e.failText, e.fail ? gain(Number(e.fail)) : ''].filter(Boolean).join(', ')}` : ''}.${outcome}${chips}`);
    } else if (e.progress) L.push(`    - ${cap1(gain(Number(e.progress)))}.`);
    if (e.ride) {
      const state = e.offer === 'taken' ? ` **Taken${e.paid ? `, paid ${formatSpirit(e.paid)}` : ''}.**` : e.offer === 'declined' ? ' **Turned down.**' : e.offer === 'open' && !day.arrived && interactive ? ' Offered: take it or turn it down above.' : '';
      const undo = interactive && ['taken', 'declined'].includes(e.offer) ? ` <button class="mini-reroll" data-ride-reset="${index}" title="Undecide: the offer comes back${e.paid ? ' and the fare goes back in the purse' : ''}">↶</button>` : '';
      L.push(`    - Ride: ${e.ride.name}, about ${e.ride.miles} miles a day${e.ride.flies ? ' flying' : ''}, for ${e.ride.days} day${e.ride.days > 1 ? 's' : ''} starting tomorrow${e.check ? ' if the check is passed' : ''}.${state}${undo}`);
    }
    if (ev.loot) L.push(`    - Found: ${ev.loot.coins} spirit coins${ev.loot.cores ? `, ${ev.loot.cores.count} ${ev.loot.cores.rank.toLowerCase()} core${ev.loot.cores.count > 1 ? 's' : ''}` : ''}${ev.loot.essence ? `, a ${ev.loot.essence}` : ''}.`);
    if (ev.event.lose) {
      const s = travelSupplies(ev.event.lose, party);
      const who = [s.rations.length ? `rations from ${s.rations.join(', ')}` : '', s.eaters.length ? `spirit coins from ${s.eaters.join(', ')}` : ''].filter(Boolean).join('; ');
      L.push(`    - **Food lost:** ${ev.event.lose} day${ev.event.lose > 1 ? 's' : ''}' worth each${who ? `: ${who}` : ' (rations for Normal-rank people, a spirit coin of their rank a day for essence users)'}.${interactive && s.gp ? ` <button class="mini-reroll travel-pay" data-day="${index}" title="Take the spirit coins out of the party purse">Take ${formatSpirit(s.gp)} from purse</button>` : ''}`);
    }
  }
  L.push(...seaLines(day), ...landLines(day));
  if (day.scenery) L.push('', `*${day.scenery}*${re('scenery', 'Different scenery')}`);
  return L.join('\n');
}

/** A sea place in a sentence: its page, its name, or "a ghost ship" for something with no name. */
const seaThing = x => x.page ? `[[${x.page}]]` : x.tier === 'fleeting' ? `${/^[aeiou]/i.test(x.label || x.name) ? 'an' : 'a'} ${x.label || x.name.toLowerCase()}` : x.name;
const SHARE = f => f >= 1 ? 'the whole day' : f >= 0.75 ? 'most of the day' : f >= 0.5 ? 'half the day' : f > 0 ? 'a few hours' : 'no time';
/** What was seen from the water on a day (day.sea, filled in by the app from the map), and any diversion to explore. */
function seaLines(day) {
  const s = day.sea;
  if (!s) return [];
  const L = [];
  const named = p => p.hidden ? `[[${p.title}]] (not known to the players yet)` : `[[${p.title}]]`;
  if (s.passing?.length) L.push(`- **${s.by === 'air' ? 'Seen below' : 'Passed'}:** ${s.passing.map(p => `${named(p)}, ${p.miles ? `${p.miles} mile${p.miles === 1 ? '' : 's'} off` : 'right on the course'}`).join('; ')}.`);
  if (s.found) L.push(`- **Spotted:** ${s.found.page ? `[[${s.found.page}]]` : s.found.name}. ${s.found.description}`);
  L.push(...divertLines(s.divert, seaThing));
  return L;
}
/** Places on land near the route (day.land, from the map) and any diversion to explore one. */
function landLines(day) {
  const s = day.land;
  if (!s) return [];
  const L = [];
  if (s.passing?.length) L.push(`- **Passed near:** ${s.passing.map(p => `[[${p.title}]]${p.hidden ? ' (not known to the players yet)' : ''}, ${p.miles ? `${p.miles} mile${p.miles === 1 ? '' : 's'} off` : 'right by the road'}`).join('; ')}.`);
  L.push(...divertLines(s.divert, x => `[[${x.page || x.name}]]`));
  return L;
}
/** A diversion to explore something off the route, as session-note lines. */
function divertLines(d, thing) {
  const L = [];
  if (d) {
    L.push(`- **Diverted to explore ${thing(d)}** (took ${SHARE(divertShare(d))}): ${d.find}`);
    if (d.check) L.push(`    - Check: ${d.check}.`);
    for (const l of twistLines(d.twist)) L.push(`    - ${l}`);
    if (d.encounter?.groups?.length) for (const l of encounterLines(d.encounter)) L.push(`    - ${l}`);
    const got = twistLoot(d.twist);
    if (d.loot && got !== 'no') L.push(`    - ${got === 'open' ? 'The prize, if they get it' : 'Found'}: ${d.loot.coins} spirit coins${d.loot.cores ? `, ${d.loot.cores.count} ${d.loot.cores.rank.toLowerCase()} core${d.loot.cores.count > 1 ? 's' : ''}` : ''}${d.loot.essence ? `, a ${d.loot.essence}` : ''}.`);
  }
  return L;
}

/** What went wrong on a diversion, as lines for the session notes. */
function twistLines(t) {
  if (!t) return [];
  const res = { pass: 'passed', fail: 'failed' }[t.result];
  if (t.type === 'fight') return [`**Trouble:** ${t.text}`];
  if (t.type === 'hazard') return [`**Hazard:** ${t.text} ${t.check}${res ? `: ${res}.` : '.'}${t.result === 'fail' ? ` ${t.fail}` : ''}`];
  if (t.type === 'puzzle') return [`**Puzzle:** ${t.text} *${t.puzzle?.name || 'A puzzle'}*${t.result ? `: ${t.result === 'pass' ? 'solved' : 'not solved'}.` : '.'}${t.result === 'fail' && t.puzzle?.failure ? ` ${t.puzzle.failure}` : ''}`];
  if (t.type === 'dilemma') {
    const c = t.choices?.[t.chose];
    return [`**Dilemma:** ${t.text} ${c ? `They chose: ${c.label}. ${c.text}` : `Choices: ${(t.choices || []).map(x => x.label).join('; ')}.`}`];
  }
  if (t.type === 'cost') return [`**The price:** ${t.text}`];
  if (t.type === 'empty') return [`**Nothing there:** ${t.text}`];
  return [];
}

const cap1 = t => t[0].toUpperCase() + t.slice(1);
const dayWords = x => `${x === 0.25 ? 'a quarter day\'s' : x === 0.5 ? 'half a day\'s' : x === 1 ? 'a day\'s' : `${x} days'`} distance`;

export function journeyToMarkdown(j, { interactive = false, party = [] } = {}) {
  const L = [];
  const done = journeyDone(j);
  const route = j.from || j.to ? `From ${placeName(j.from) || 'here'} to ${placeName(j.to) || 'wherever the road goes'}.` : 'An open-ended journey.';
  if (j.days[0]?.teleport) return [`${route.replace(/\.$/, '')}, by teleport circle: ${j.miles ? `${j.miles} miles ` : ''}in a single step.`, '', travelDayToMarkdown(j.days[0])].join('\n');
  L.push(`${route} ${j.miles ? `**${done} of ${j.miles} miles**${j.straight ? ` (${j.straight} miles as the crow flies)` : ''}` : `**${done} miles** so far`}, ${j.days.length} day${j.days.length === 1 ? '' : 's'} on the road.`);
  const lost = j.days.filter(d => ['lost', 'badly'].includes(d.nav?.result)).length;
  if (lost) L.push('', `Days spent lost: ${lost}.`);
  const days = interactive ? [...j.days].reverse() : j.days;
  for (const d of days) L.push('', travelDayToMarkdown(d, { interactive, party, index: j.days.indexOf(d) }));
  return L.join('\n');
}

// ---------- travel in the session notes ----------
// The notes get what happened on the road, not every roll: quiet days are grouped into one line.

/** One line for a day that had something in it, or null for a quiet day. */
export function travelDayNote(day) {
  if (day.teleport) return `Stepped through the teleport circle${day.teleport.fee ? ` for ${formatSpirit(day.teleport.fee)}` : ''}.`;
  const bits = [];
  if (['lost', 'badly'].includes(day.nav?.result) && !day.ride?.flies) bits.push(day.nav.result === 'badly' ? 'got badly lost' : 'got lost');
  if (day.nav?.result === 'shortcut' && !day.ride?.flies) bits.push('found a shortcut');
  if (day.ride && day.ride.left === Number(day.ride.days)) bits.push(`travelled by ${day.ride.name.toLowerCase()}`);
  if (day.stop) bits.push(`reached ${day.stop.name}, to go on ${legHow(day.stop)}`);
  if (day.rideEnded) bits.push(`left the ${day.rideEnded.toLowerCase()} behind`);
  const enc = day.encounter;
  if (enc?.hit) {
    const foes = (enc.encounter?.groups || []).map(g => `${g.count} × ${g.name}`).join(', ');
    bits.push(`${enc.kind === 'ambush' ? 'ambushed' : 'attacked'} (${enc.time.toLowerCase()}): ${enc.event.name}${foes ? `, ${foes}` : ''}`);
  }
  const ev = day.event;
  if (ev?.hit) {
    const e = ev.event;
    const outcome = e.check ? e.result === 'pass' ? ', passed the check' : e.result === 'fail' ? ', failed the check' : '' : '';
    bits.push(`${ev.label.toLowerCase()}: ${e.name}${outcome}${e.lose ? `, lost ${e.lose} day${e.lose > 1 ? 's' : ''} of food` : ''}${ev.loot ? `, found ${ev.loot.coins}${ev.loot.essence ? ` and a ${ev.loot.essence}` : ''}` : ''}`);
  }
  const sea = day.sea;
  const diverted = (dv, thing) => {
    const t = dv.twist;
    const went = !t ? '' : t.type === 'fight' ? ', had a fight' : t.type === 'hazard' && t.result === 'fail' ? ', got hurt' : t.type === 'puzzle' && t.result ? `, ${t.result === 'pass' ? 'solved' : 'failed'} a puzzle` : t.type === 'dilemma' && t.choices?.[t.chose] ? `, chose to ${t.choices[t.chose].label.toLowerCase()}` : t.type === 'empty' ? ', found nothing' : '';
    bits.push(`diverted to explore ${thing}${went}${dv.loot && twistLoot(t) === 'yes' ? `, found ${dv.loot.coins}` : ''}`);
  };
  if (day.land?.divert) diverted(day.land.divert, `[[${day.land.divert.page || day.land.divert.name}]]`);
  if (sea?.divert) diverted(sea.divert, seaThing(sea.divert));
  else if (sea?.found) bits.push(`spotted ${seaThing(sea.found)}`);
  if (sea?.passing?.some(p => !p.hidden)) bits.push(`passed ${sea.passing.filter(p => !p.hidden).map(p => `[[${p.title}]]`).join(', ')}`);
  if (!bits.length) return null;
  const s = bits.join('; ');
  return s[0].toUpperCase() + s.slice(1) + '.';
}

/** Everyone the party met on these days with a page of their own: NPC pages made from events, and wiki NPCs events called back. */
export function travelPeopleMet(days) {
  const out = [];
  for (const d of days) for (const x of [d.encounter, d.event]) {
    const e = x?.hit ? x.event : null;
    for (const n of [...(e?.people || []), e?.page]) if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

/** The journey's days as a section for the session notes. */
export function journeySessionMarkdown(j, days, heading = journeyTitle(j)) {
  const L = [`### ${heading}`, ''];
  const first = days[0]?.n, last = days[days.length - 1]?.n;
  const miles = days.reduce((t, d) => t + (d.miles || 0), 0);
  const end = days[days.length - 1]?.arrived;
  const met = travelPeopleMet(days);
  L.push(`${days.length === 1 ? `Day ${first}` : `Days ${first} to ${last}`} on the road: ${miles} miles${end ? `, arriving at ${placeName(j.to) || 'the destination'}` : j.miles ? `, ${journeyLeft({ ...j, days: j.days.filter(d => d.n <= last) })} miles still to go` : ''}.`, '');
  if (met.length) L.push(`People met: ${met.map(n => `[[${n}]]`).join(', ')}.`, '');
  let quiet = [];
  // Quiet days in a row share one line.
  const flush = () => { if (quiet.length) L.push(`- ${quiet.length === 1 ? `Day ${quiet[0]}: a quiet day` : `Days ${quiet[0]} to ${quiet[quiet.length - 1]}: quiet days`} on the road.`); quiet = []; };
  for (const d of days) {
    const note = travelDayNote(d);
    if (!note) { quiet.push(d.n); continue; }
    flush();
    L.push(`- **Day ${d.n}** (${d.teleport ? 'teleport' : `${d.terrain.toLowerCase()}, ${d.weather.name.toLowerCase()}`}): ${note}`);
  }
  flush();
  return L.join('\n') + '\n';
}

/** Put a section into a page body between markers, replacing the one already there with the same key. */
export function putSection(body, key, md) {
  const open = `<!-- ${key} -->`, close = `<!-- /${key} -->`;
  const block = `${open}\n${md.replace(/\s+$/, '')}\n${close}`;
  const i = body.indexOf(open), k = body.indexOf(close);
  if (i >= 0 && k > i) return body.slice(0, i) + block + body.slice(k + close.length);
  return `${body.replace(/\s+$/, '')}\n\n${block}\n`;
}

// ---------- children ----------
// Normal-rank NPCs under 18: nobody takes an essence before they are grown. From parents (sharing their family name
// and people) or orphans in a town's care. Banks are in data/children.json.

/** A child. opts: { surname, people (a people's name), age, orphan, cause, avoid (names to skip) }. */
export function generateChild(data, opts = {}, rng = Math.random) {
  const C = data.children || {};
  const [lo, hi] = list(C.ages).length ? C.ages : [1, 17];
  const age = Math.max(lo, Math.min(hi, Number(opts.age) || int(rng, lo, hi)));
  const people = data.peoples.peoples.find(p => p.name === opts.people) || weighted(rng, data.peoples.peoples);
  const avoid = new Set(list(opts.avoid).map(n => String(n).toLowerCase()));
  const names = nameLists(rng, people, opts.style);
  let first = pick(rng, names.first);
  for (let i = 0; i < 20 && avoid.has(first.toLowerCase()); i++) first = pick(rng, names.first);
  // Orphans keep the family name they were born with.
  const surname = opts.surname ?? (list(names.last).length ? pick(rng, names.last) : '');
  const band = list(C.bands).find(b => age <= b.max) || { word: 'a child' };
  const p = (k, d) => pick(rng, list(C[k])) || d;
  return {
    kind: 'child', name: surname ? `${first} ${surname}` : first, first, age, band: band.word, people: people.name, species: people.species || people.name,
    pronoun: weighted(rng, [{ k: 'he', weight: 47 }, { k: 'she', weight: 47 }, { k: 'they', weight: 6 }]).k,
    looks: p('looks', 'small for their age'), temperament: p('temperament', 'curious about everything'), likes: p('likes', 'stories'),
    wants: p('wants', 'to be an adventurer'), fears: p('fears', 'the dark'), secret: p('secrets', 'They saw something they should not have.'),
    orphan: !!opts.orphan, cause: opts.orphan ? opts.cause || p('orphanCauses', 'a fever') : null,
    scores: [int(rng, 4, 9), int(rng, 8, 14), int(rng, 7, 12), int(rng, 7, 13), int(rng, 7, 13), int(rng, 7, 14)].map(v => Math.max(3, v - (age < 8 ? 2 : 0))),
  };
}

/** A child's page: who they are for everyone, and a small stat block and their secret for the DM. */
export function childToMarkdown(c, { parents = [], home = null, orphanage = null } = {}) {
  const mod = v => Math.floor((v - 10) / 2);
  const sg = v => (v >= 0 ? `+${v}` : `${v}`);
  const small = c.age < 10;
  const hp = Math.max(1, (small ? 1 : 2) * 3 + mod(c.scores[2]));
  const P = { he: 'He', she: 'She', they: 'They' }[c.pronoun];
  const L = [':::dm', '<div class="statblock">', '', `### ${c.name}`, '', `*${small ? 'Small' : 'Medium'} humanoid (${c.people}), Normal rank child*`, '',
    `**Armor Class** ${10 + mod(c.scores[1])}  `, `**Hit Points** ${hp} (${small ? '1d6' : '2d6'}${mod(c.scores[2]) ? ` ${mod(c.scores[2]) > 0 ? '+' : '−'} ${Math.abs(mod(c.scores[2]))}` : ''})  `, `**Speed** ${small ? 25 : 30} ft.`, '',
    '| STR | DEX | CON | INT | WIS | CHA |', '| :---: | :---: | :---: | :---: | :---: | :---: |', `| ${c.scores.map(v => `${v} (${sg(mod(v))})`).join(' | ')} |`, '',
    `**Skills** Stealth ${sg(mod(c.scores[1]) + 2)}, Perception ${sg(mod(c.scores[4]) + 2)}  `, `**Senses** passive Perception ${12 + mod(c.scores[4])}  `, '**Languages** Common  ', '**Challenge** 0 (0 XP) · **Proficiency Bonus** +2', '',
    '#### Traits', '', `***Too young for essences.*** No one takes an essence before they are grown. ${P} can't use spirit coins, awakening stones or essence abilities.`, '',
    '#### Actions', '', `***Flail.*** *Melee Weapon Attack:* ${sg(mod(c.scores[0]) + 2)} to hit, reach 5 ft., one target. *Hit:* 1 bludgeoning damage.`, '',
    '</div>', '', `**Secret:** ${c.secret}`, ':::', '',
    `**${cap(c.band)}, ${c.age} years old.** ${c.people}, Normal rank.${parents.length ? ` Child of ${parents.map(x => `[[${x}]]`).join(' and ')}.` : ''}${c.orphan ? ` An orphan: ${c.cause}.` : ''}${orphanage ? ` Lives at [[${orphanage}]].` : home ? ` Lives in [[${home}]].` : ''}`, '',
    `- **Looks:** ${cap(c.looks)}.`, `- **Temperament:** ${cap(c.temperament)}.`, `- **Loves:** ${c.likes}.`, `- **Wants:** ${c.wants}.`, `- **Afraid of:** ${c.fears}.`, ''];
  return L.join('\n');
}
