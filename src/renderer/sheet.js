// Character sheet rules: ability scores, saves and skills, armour class from worn armour, equipped weapons as
// attacks, and the fields of a fillable 5e character sheet PDF. Worked out from the sheet and the item catalogue
// so the numbers follow the rules; the DM can still set AC by hand.
import { classOptionLines, autoClassOpts, matchSubclass, masteryOf } from './classopts.js';
export { masteryOf };
import { featuresAt, subclassSpellsAt } from './classref.js';
import { itemInfo, itemCatalog, proficiencyBonus, parseDice, diceText, rankForLevel, pcRank, sheetPowers, essenceInfo, confluenceInfo, spellInfo, castSpell, spellBuff } from './generators.js';

const list = x => Array.isArray(x) ? x : [];

export const ABILITIES = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
export const ABILITY_NAMES = { STR: 'Strength', DEX: 'Dexterity', CON: 'Constitution', INT: 'Intelligence', WIS: 'Wisdom', CHA: 'Charisma' };
export const SKILLS = [
  ['Acrobatics', 'DEX'], ['Animal Handling', 'WIS'], ['Arcana', 'INT'], ['Athletics', 'STR'], ['Deception', 'CHA'], ['History', 'INT'],
  ['Insight', 'WIS'], ['Intimidation', 'CHA'], ['Investigation', 'INT'], ['Medicine', 'WIS'], ['Nature', 'INT'], ['Perception', 'WIS'],
  ['Performance', 'CHA'], ['Persuasion', 'CHA'], ['Religion', 'INT'], ['Sleight of Hand', 'DEX'], ['Stealth', 'DEX'], ['Survival', 'WIS'],
];
/** Each class's saving throw proficiencies, as the class tables give them. */
export const CLASS_SAVES = {
  Artificer: ['CON', 'INT'], Barbarian: ['STR', 'CON'], Bard: ['DEX', 'CHA'], Cleric: ['WIS', 'CHA'], Druid: ['INT', 'WIS'], Fighter: ['STR', 'CON'],
  Monk: ['STR', 'DEX'], Paladin: ['WIS', 'CHA'], Ranger: ['STR', 'DEX'], Rogue: ['DEX', 'INT'], Sorcerer: ['CON', 'CHA'], Warlock: ['WIS', 'CHA'], Wizard: ['INT', 'WIS'],
};
const DAMAGE_TYPES = /^(acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder)$/i;

export const modNum = score => Math.floor(((Number(score) || 10) - 10) / 2);
export const signed = n => `${n >= 0 ? '+' : '-'}${Math.abs(n)}`;
/** Ability scores as they stand, with attuned items that set or raise them ("Your Strength becomes 21", "+2 Constitution"). */
export function abilities(m) {
  const fx = gearFx(m);
  return ABILITIES.map((a, i) => {
    const base = Number(list(m.abilities)[i]) || 10;
    return Math.max(base, fx.set[a] || 0, fx.add[a] ? Math.min(20, base + fx.add[a]) : 0);
  });
}
export const abilityModOf = (m, ab) => modNum(abilities(m)[ABILITIES.indexOf(ab)]);
export const sheetPb = m => proficiencyBonus(Number(m.level) || 1);

/** Saving throws they're proficient in: the sheet's own list, else their class's. */
export const saveProfs = m => Array.isArray(m.saveProf) ? m.saveProf : (CLASS_SAVES[m.class] || []);
export const saveBonus = (m, ab) => abilityModOf(m, ab) + (saveProfs(m).includes(ab) ? sheetPb(m) : 0) + gearFx(m).saves;

/** 0 untrained, 1 proficient, 2 expertise. */
export const skillLevel = (m, skill) => list(m.expertise).includes(skill) ? 2 : list(m.skills).includes(skill) ? 1 : 0;
export function skillBonus(m, skill) {
  const ab = SKILLS.find(s => s[0] === skill)?.[1] || 'STR';
  return abilityModOf(m, ab) + skillLevel(m, skill) * sheetPb(m) + gearFx(m).checks;
}

// ----- attunement -----
// A character can be attuned to three magic items. An item that needs attunement only works while they're attuned to it.

export const MAX_ATTUNED = 3;
const ABILITY_WORD = { strength: 'STR', dexterity: 'DEX', constitution: 'CON', intelligence: 'INT', wisdom: 'WIS', charisma: 'CHA' };

/** What a magic item does to the numbers, read from its description. Spells are kept only when the spell list knows them. */
export function itemEffects(item, data) {
  const fx = { set: {}, add: {}, saves: 0, checks: 0, spellAttack: 0, spellDC: 0, spells: [], extra: '' };
  if (!item) return fx;
  const desc = String(item.desc || '');
  for (const x of desc.matchAll(/\b(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)(?: score)? becomes (\d+)/gi)) fx.set[ABILITY_WORD[x[1].toLowerCase()]] = Number(x[2]);
  for (const x of desc.matchAll(/\+(\d) (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\b/gi)) fx.add[ABILITY_WORD[x[2].toLowerCase()]] = Number(x[1]);
  fx.saves = Number(desc.match(/\+(\d+) to (?:ability checks and )?(?:all )?(?:saving throws|saves)\b/i)?.[1]) || 0;
  fx.checks = Number(desc.match(/\+(\d+) to ability checks\b/i)?.[1]) || 0;
  const spellAtk = desc.match(/\+(\d+) to (?:\w+ )?spell attack(?:s| rolls)?( and DCs)?/i);
  if (spellAtk) { fx.spellAttack = Number(spellAtk[1]); if (spellAtk[2]) fx.spellDC = Number(spellAtk[1]); }
  // "Has charges to cast charm person, command or comprehend languages." "Cast jump on yourself at will."
  for (const x of desc.matchAll(/\bcast (?:the )?([^.;:]+)/gi)) {
    for (const part of x[1].split(/,\s*|\s+(?:and|or)\s+/)) {
      const name = part.replace(/\s+(?:on yourself|at will|once a day|spell|on |for |with ).*$/i, '').trim();
      const sp = data && spellInfo(data, name);
      if (sp && !fx.spells.includes(sp.name)) fx.spells.push(sp.name);
    }
  }
  // Extra weapon damage that always applies; "extra radiant damage to fiends and undead" is left to the DM.
  const extra = desc.match(/(\d+d\d+) extra ([a-z]+) damage(?! to| against)/i);
  if (extra && DAMAGE_TYPES.test(extra[2])) fx.extra = `${extra[1]} ${extra[2].toLowerCase()}`;
  return fx;
}
const NO_FX = { set: {}, add: {}, saves: 0, checks: 0, spellAttack: 0, spellDC: 0, spells: [], extra: '' };

/** Whether an equipped item is working: it needs no attunement, or they're attuned to it. */
export const isActive = (m, e) => !e?.attune || list(m.attuned).includes(e.name);
/** The equipped items they're attuned to. */
export const attunedItems = m => list(m.equipped).filter(e => e.attune && list(m.attuned).includes(e.name));

/** Everything their working items add, summed. */
export function gearFx(m) {
  const fx = { set: {}, add: {}, saves: 0, checks: 0, spellAttack: 0, spellDC: 0, spells: [] };
  for (const e of list(m.equipped)) {
    if (!e.fx || !isActive(m, e)) continue;
    for (const [k, v] of Object.entries(e.fx.set || {})) fx.set[k] = Math.max(fx.set[k] || 0, v);
    for (const [k, v] of Object.entries(e.fx.add || {})) fx.add[k] = (fx.add[k] || 0) + v;
    for (const k of ['saves', 'checks', 'spellAttack', 'spellDC']) fx[k] += Number(e.fx[k]) || 0;
    for (const sp of list(e.fx.spells)) fx.spells.push({ spell: sp, from: e.name });
  }
  return fx;
}

// ----- defences from magic items -----

const PHYSICAL = ['bludgeoning', 'piercing', 'slashing'];
export const DAMAGE_TYPE_LIST = ['acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder'];
/**
 * What a magic item does to attacks, saves and damage against its wearer, read from its description: resistances,
 * vulnerabilities and immunities, advantage on saves against spells, disadvantage on attacks against them, and so on.
 * `choose` lists the damage types to pick from when the item resists "one damage type" (picked as `choice`).
 * Once-a-day and reaction effects are left to the DM.
 */
export function itemDefences(item, choice = '') {
  const out = { resist: [], vuln: [], immune: [], condImmune: [], spellImmune: [], choose: null };
  if (!item) return out;
  const from = item.name;
  const desc = String(item.desc || '').split(/;?\s*once a day\b/i)[0].replace(/^as a reaction.*$/i, '');
  const type = x => x && DAMAGE_TYPES.test(x) ? x.toLowerCase() : null;
  const one = desc.match(/resistance to one (physical )?damage type/i);
  if (one) {
    out.choose = one[1] ? PHYSICAL : DAMAGE_TYPE_LIST;
    const t = out.choose.includes(String(choice).toLowerCase()) ? String(choice).toLowerCase() : '';
    if (t) out.resist.push(t);
    // Armour of vulnerability: the other physical types hurt more.
    if (t && one[1] && /vulnerability to the others/i.test(desc)) out.vuln.push(...PHYSICAL.filter(x => x !== t));
  }
  if (/resistance to all damage/i.test(desc)) out.resist.push('*');
  if (/resistance to nonmagical damage/i.test(desc)) out.resist.push('nonmagical');
  for (const x of desc.matchAll(/\bresistance to (\w+) damage|(?<!ignores )\b(\w+) resistance\b|\bresist (\w+)\b/gi)) { const t = type(x[1] || x[2] || x[3]); if (t) out.resist.push(t); }
  for (const x of desc.matchAll(/\bimmunity to (\w+) damage/gi)) { const t = type(x[1]); if (t) out.immune.push(t); }
  for (const x of desc.matchAll(/\bthe (\w+) condition\b/gi)) out.condImmune.push(x[1][0].toUpperCase() + x[1].slice(1).toLowerCase());
  if (/can'?t (?:be )?paraly[sz]e or restrain/i.test(desc)) out.condImmune.push('Paralyzed', 'Restrained');
  const spellImm = desc.match(/\bimmunity to ([a-z' ]+?)(?:\.|,|$| and )/i);
  if (spellImm && !/damage|condition|disease/i.test(spellImm[1])) out.spellImmune.push(spellImm[1].trim().toLowerCase());
  if (/advantage on saves against (?:single-target )?spells/i.test(desc)) out.spellSaveAdv = from;
  if (/spell attacks have disadvantage against you/i.test(desc)) out.spellAttackDisadv = from;
  if (/(?<!spell )\battacks (?:against you )?have disadvantage/i.test(desc)) out.attackDisadv = from;
  if (/resistance to damage from ranged weapons/i.test(desc)) out.rangedResist = from;
  const rangedAc = desc.match(/\+(\d) AC against ranged attacks/i);
  if (rangedAc) out.rangedAc = Number(rangedAc[1]);
  if (/critical hit against you becomes a normal hit/i.test(desc)) out.critNormal = from;
  for (const k of ['resist', 'vuln', 'immune', 'condImmune', 'spellImmune']) out[k] = [...new Set(out[k])].map(x => ({ x, from }));
  return out;
}
/** The working magic items a party member wears or carries (worn armour and shield too), each with its picked damage type. */
export function wornItems(data, m) {
  const out = [];
  for (const e of list(m.equipped)) if (isActive(m, e)) out.push({ item: itemInfo(data, e.item || e.name), choice: e.choice });
  for (const name of [m.armor, m.shield]) {
    const item = name && itemInfo(data, name);
    if (item && (!item.attune || list(m.attuned).includes(item.name)) && !out.some(x => x.item?.name === item.name)) out.push({ item });
  }
  return out.filter(x => x.item);
}
/** Everything a set of items does against attacks on their owner, merged, each part naming the item it comes from. */
export function defencesOf(items) {
  const out = { resist: [], vuln: [], immune: [], condImmune: [], spellImmune: [], unpicked: [] };
  for (const { item, choice } of items) {
    const d = itemDefences(item, choice);
    for (const k of ['resist', 'vuln', 'immune', 'condImmune', 'spellImmune']) out[k].push(...d[k]);
    for (const k of ['spellSaveAdv', 'spellAttackDisadv', 'attackDisadv', 'rangedResist', 'critNormal']) if (d[k] && !out[k]) out[k] = d[k];
    if (d.rangedAc) out.rangedAc = { n: d.rangedAc, from: item.name };
    if (d.choose && !d.resist.length) out.unpicked.push(item.name);
  }
  return out;
}

/** A short list of what an item's effects add up to, for the sheet: "+1 to saves, Strength 19, casts jump". */
export function fxText(fx) {
  if (!fx) return '';
  return [
    ...Object.entries(fx.set || {}).map(([a, v]) => `${ABILITY_NAMES[a]} ${v}`),
    ...Object.entries(fx.add || {}).map(([a, v]) => `${ABILITY_NAMES[a]} +${v}`),
    fx.saves ? `+${fx.saves} to saves` : '', fx.checks ? `+${fx.checks} to ability checks` : '',
    fx.spellAttack ? `+${fx.spellAttack} to spell attacks${fx.spellDC ? ' and DCs' : ''}` : '',
    fx.extra ? `+${fx.extra} on hits` : '', list(fx.spells).length ? `casts ${list(fx.spells).join(', ')}` : '',
  ].filter(Boolean).join(', ');
}
export const passivePerception = m => 10 + skillBonus(m, 'Perception');
export const initiative = m => abilityModOf(m, 'DEX') + (Number(m.initMisc) || 0);

// ----- armour -----

/** What a catalogue item does as armour: body armour (light, medium or heavy) with its base AC and Dex cap, or a shield. */
export function armourOf(item) {
  if (!item) return null;
  const desc = String(item.desc || '');
  const tags = list(item.tags);
  if (tags.includes('shield') || (/shield/i.test(item.name) && tags.includes('armour'))) return { kind: 'shield', bonus: Number(item.shieldAC) || 2 + (Number(item.name.match(/^\+(\d)/)?.[1]) || 0) };
  const ac = desc.match(/\bAC (\d+)/);
  if (!ac) return null;
  const dex = /\+ Dex modifier/i.test(desc);
  const cap = desc.match(/Dex modifier \(max (\d+)\)/i);
  return {
    kind: !dex ? 'heavy' : cap ? 'medium' : 'light', base: Number(ac[1]), dexMax: !dex ? 0 : cap ? Number(cap[1]) : null,
    stealth: /disadvantage on Stealth/i.test(desc), str: Number(desc.match(/Strength (\d+)/)?.[1]) || 0,
  };
}
export const armourChoices = data => itemCatalog(data).filter(i => armourOf(i) && armourOf(i).kind !== 'shield');
export const shieldChoices = data => itemCatalog(data).filter(i => armourOf(i)?.kind === 'shield');

/** How many attacks the Attack action gives, from Extra Attack and its later steps (1 without it). */
export function attacksPerAction(m) {
  const feats = featuresAt(m.class, m.level, m.subclass);
  if (feats.some(f => /^Three Extra Attacks/i.test(f.name))) return 4;
  if (feats.some(f => /^Two Extra Attacks/i.test(f.name))) return 3;
  return feats.some(f => /^Extra Attack/i.test(f.name)) ? 2 : 1;
}

// The armour each class is trained in (2024 rules). Clerics and druids can take more with their Divine or Primal Order.
const ARMOUR_TRAINING = { Artificer: 'medium', Barbarian: 'medium', Bard: 'light', Cleric: 'medium', Druid: 'light', Fighter: 'heavy', Monk: 'none', Paladin: 'heavy', Ranger: 'medium', Rogue: 'light', Sorcerer: 'none', Warlock: 'light', Wizard: 'none' };
const SHIELD_TRAINING = ['Artificer', 'Barbarian', 'Cleric', 'Druid', 'Fighter', 'Paladin', 'Ranger'];
const ARMOUR_ORDER = ['none', 'light', 'medium', 'heavy'];
/**
 * A warning when a character wears armour or a shield their class isn't trained in, or '' when it's fine (or the class
 * is unknown). A feat or another class can also give training, so it only warns.
 */
export function armourWarning(m, data) {
  if (!ARMOUR_TRAINING[m.class]) return '';
  const opts = m.classOpts || {};
  let has = ARMOUR_TRAINING[m.class];
  let how = '';
  if (m.class === 'Cleric') { if (list(opts.divineOrder).includes('Protector')) has = 'heavy'; else how = ' unless they take the Protector Divine Order'; }
  if (m.class === 'Druid') { if (list(opts.primalOrder).includes('Warden')) has = 'medium'; else how = ' unless they take the Warden Primal Order'; }
  const out = [];
  const worn = m.armor && !['none', 'manual'].includes(m.armor) ? armourOf(itemInfo(data, m.armor)) : null;
  if (worn && worn.kind !== 'shield' && ARMOUR_ORDER.indexOf(worn.kind) > ARMOUR_ORDER.indexOf(has)) {
    out.push(`${m.class}s aren't trained in ${worn.kind} armour${worn.kind === 'heavy' || (worn.kind === 'medium' && m.class === 'Druid') ? how : ''}`);
  }
  if (m.shield && m.shield !== 'none' && !SHIELD_TRAINING.includes(m.class)) out.push(`${m.class}s aren't trained with shields`);
  return out.length ? `${out.join(', and ')}. Without training: disadvantage on Strength and Dexterity rolls and no spellcasting, unless a feat or another class gives it.` : '';
}

/** The AC an equipped (non-armour) item adds: "+1 AC while worn", "Orbits your head and grants +1 AC". */
export function itemAcBonus(item) {
  if (!item || armourOf(item)) return 0;
  const m = String(item.desc || '').match(/(?:^|grants?|granting)\s*\+(\d+) AC\b/i);
  return m ? Number(m[1]) : 0;
}

/** Their armour class and how it adds up. A sheet with `armor: 'manual'` (or an older sheet with only an AC) keeps the AC typed in. */
export function sheetAC(m, data) {
  if (m.armor === 'manual' || (m.armor == null && m.ac != null)) return { ac: Number(m.ac) || 10, manual: true, parts: ['set by hand'] };
  const dex = abilityModOf(m, 'DEX');
  const parts = [];
  let ac;
  // 'none' (or an empty value) means no armour.
  const worn = m.armor && m.armor !== 'none' ? m.armor : '';
  const item = worn ? itemInfo(data, worn) : null;
  const a = armourOf(item);
  const shield = m.shield ? armourOf(itemInfo(data, m.shield)) : null;
  if (a && a.kind !== 'shield') {
    const d = a.dexMax === 0 ? 0 : Math.min(dex, a.dexMax ?? 99);
    ac = a.base + d;
    parts.push(`${item.name} ${a.base}`);
    if (a.dexMax !== 0) parts.push(`Dex ${signed(d)}${a.dexMax != null && dex > a.dexMax ? ` (max ${a.dexMax})` : ''}`);
  } else {
    // Unarmoured defence: barbarians add Con, monks add Wis (and lose it behind a shield).
    const extra = m.class === 'Barbarian' ? 'CON' : m.class === 'Monk' && !shield ? 'WIS' : '';
    ac = 10 + dex + (extra ? abilityModOf(m, extra) : 0);
    parts.push(worn && !item ? `${worn} isn't in the item list, so no armour counted: 10` : 'no armour 10', `Dex ${signed(dex)}`);
    if (extra) parts.push(`${ABILITY_NAMES[extra]} ${signed(abilityModOf(m, extra))} (unarmoured defence)`);
  }
  if (shield) { ac += shield.bonus; parts.push(`${m.shield} +${shield.bonus}`); }
  for (const e of list(m.equipped)) {
    if (!Number(e.ac) || !isActive(m, e) || (e.acUnarmoured && (a || shield))) continue;
    ac += Number(e.ac); parts.push(`${e.name} ${signed(Number(e.ac))}`);
  }
  if (Number(m.acMisc)) { ac += Number(m.acMisc); parts.push(`other ${signed(Number(m.acMisc))}`); }
  return { ac, parts, armour: a, stealth: !!a?.stealth };
}

// ----- weapons -----

/** A catalogue weapon's damage and properties: "1d8 slashing. Versatile (1d10)." */
export function weaponOf(item) {
  if (!item) return null;
  const tags = list(item.tags);
  if (!tags.includes('weapon') || tags.includes('ammo')) return null;
  const desc = String(item.desc || '');
  const hit = desc.match(/^(\d+d\d+|\d+) ([a-z]+)\.\s*(.*)$/i);
  const props = hit ? hit[3].replace(/\.$/, '') : '';
  const thrown = /\bthrown\b/i.test(props);
  return {
    dice: hit?.[1] || '', type: hit && DAMAGE_TYPES.test(hit[2]) ? hit[2].toLowerCase() : '', props,
    finesse: /\bfinesse\b/i.test(props), ranged: /\bammunition\b/i.test(props) || (tags.includes('ranged') && !thrown && !hit), thrown,
    versatile: props.match(/versatile \((\d+d\d+)\)/i)?.[1] || '',
    range: props.match(/\((\d+\/\d+)\)/)?.[1] || '', reach: /\breach\b/i.test(props),
    magic: Number(item.magic) || Number(item.name.match(/^\+(\d)/)?.[1] || desc.match(/^\+(\d) [a-z]/i)?.[1]) || 0,
  };
}

// Magic weapons are described by what they are ("+2 scimitar", "a sword that bursts into flame"); these find the
// plain weapon underneath, for its damage and properties.
const BASE_WEAPONS = [
  ['greatsword'], ['greataxe'], ['longsword'], ['shortsword'], ['scimitar'], ['rapier'], ['warhammer'], ['maul'], ['mace'], ['longbow'], ['shortbow'],
  ['quarterstaff', /\bstaff\b/], ['trident'], ['battleaxe', /\baxe\b/], ['longsword', /\bsword\b|\bblade\b/], ['dagger'], ['spear'], ['javelin'],
];
export function baseWeapon(data, item) {
  const text = `${item?.name || ''} ${item?.desc || ''}`.toLowerCase();
  for (const [name, re] of BASE_WEAPONS) {
    if ((re || new RegExp(`\\b${name}\\b`)).test(text)) {
      const base = itemInfo(data, name);
      if (weaponOf(base)?.dice) return base;
    }
  }
  return null;
}

/** A new equipped entry for a catalogue item (or a name typed in): a weapon gets an attack to roll, and a magic item notes
 * whether it needs attunement and what it does. */
export function equipEntry(data, name) {
  const item = itemInfo(data, name);
  const e = { name: item?.name || String(name).trim() };
  if (item) e.item = item.name;
  let w = weaponOf(item);
  if (w && !w.dice) {
    const base = weaponOf(baseWeapon(data, item));
    // "a +2 longsword that deals radiant damage" changes the damage type too.
    const own = String(item.desc).match(/\bthat deals ([a-z]+) damage/i)?.[1];
    if (base) w = { ...base, magic: w.magic, type: own && DAMAGE_TYPES.test(own) ? own.toLowerCase() : base.type };
  }
  const fx = itemEffects(item, data);
  if (w) e.weapon = { attack: e.name, dice: w.dice || '1d4', type: w.type, ability: 'auto', bonus: w.magic, prof: true, finesse: w.finesse, ranged: w.ranged, range: w.range, reach: w.reach, extra: fx.extra || '' };
  const ac = itemAcBonus(item);
  if (ac) e.ac = ac;
  if (/no armou?r and no shield/i.test(item?.desc || '')) e.acUnarmoured = true;
  if (item?.attune) e.attune = true;
  if (fxText({ ...fx, extra: '' })) e.fx = { ...fx, extra: undefined };
  return e;
}

/** Brings an older equipped entry up to date with its catalogue item: attunement and effects. Returns true if it changed. */
export function refreshEntry(data, e) {
  const item = itemInfo(data, e.item || e.name);
  if (!item) return false;
  const fresh = equipEntry(data, item.name);
  const before = JSON.stringify(e);
  if (fresh.attune || e.attuneManual) e.attune = true; else delete e.attune;
  if (fresh.fx) e.fx = fresh.fx; else delete e.fx;
  if (fresh.acUnarmoured) e.acUnarmoured = true;
  return JSON.stringify(e) !== before;
}

// Martial Arts (2024): a monk's unarmed strikes and monk weapons (simple melee weapons, and martial melee weapons
// with the Light property) use Dex if it's better, and can roll the martial arts die in place of their own.
const MONK_WEAPONS = ['club', 'dagger', 'greatclub', 'handaxe', 'javelin', 'light hammer', 'mace', 'quarterstaff', 'sickle', 'spear', 'scimitar', 'shortsword'];
export const martialArtsDie = level => (Number(level) || 1) >= 17 ? 'd12' : level >= 11 ? 'd10' : level >= 5 ? 'd8' : 'd6';
const monkWeapon = (m, w) => m.class === 'Monk' && !w.ranged && (w.unarmed || MONK_WEAPONS.some(n => new RegExp(`\\b${n}\\b`, 'i').test(String(w.attack || ''))));

/** The ability an equipped weapon attacks with: ranged weapons use Dex, finesse (and a monk's weapons) the better of Str and Dex. */
export function weaponAbility(m, w) {
  if (w.ability && w.ability !== 'auto') return w.ability;
  if (w.ranged) return 'DEX';
  if (w.finesse || monkWeapon(m, w)) return abilityModOf(m, 'DEX') > abilityModOf(m, 'STR') ? 'DEX' : 'STR';
  return 'STR';
}
/** A monk's Unarmed Strike, as an equipped entry: always there, so it shows with their weapons. */
export const unarmedEntry = m => ({ name: 'Unarmed Strike', weapon: { attack: 'Unarmed Strike', dice: `1${martialArtsDie(m.level)}`, type: 'bludgeoning', ability: 'auto', prof: true, unarmed: true } });
/** Every attack on a sheet: their equipped weapons, and a monk's Unarmed Strike. */
export function pcAttacks(m) {
  const eq = list(m.equipped).filter(e => e.weapon);
  if (m.class === 'Monk' && !eq.some(e => /unarmed/i.test(e.name))) eq.push(unarmedEntry(m));
  return eq.map(e => ({ e, atk: weaponAttack(m, e) }));
}

/** An equipped weapon as an attack the dice tray can roll: { name, toHit, damage: [{ expr, type }] }. */
export function weaponAttack(m, e) {
  const w = e?.weapon;
  if (!w) return null;
  const ab = weaponAbility(m, w);
  const mod = ab === 'none' ? 0 : abilityModOf(m, ab);
  // A weapon that needs attunement is only an ordinary weapon until they're attuned to it.
  const on = isActive(m, e);
  const bonus = on ? Number(w.bonus) || 0 : 0;
  const dmgMod = mod + bonus;
  // A monk weapon rolls the martial arts die when it's bigger than its own.
  const sides = x => Number(String(x || '').match(/d(\d+)/)?.[1]) || 0;
  const dice = monkWeapon(m, w) && sides(martialArtsDie(m.level)) > sides(w.dice) ? `1${martialArtsDie(m.level)}` : w.dice;
  const base = parseDice(`${dice || '1'}${dmgMod ? signed(dmgMod) : ''}`) || parseDice(dice || '1');
  const damage = [{ expr: diceText(base), type: w.type || '' }];
  const extra = !on ? null : String(w.extra || '').trim().match(/^(\d*d\d+(?:\s*[+-]\s*\d+)?)\s*([a-z]+)?/i);
  if (extra && parseDice(extra[1])) damage.push({ expr: diceText(parseDice(extra[1])), type: DAMAGE_TYPES.test(extra[2] || '') ? extra[2].toLowerCase() : '' });
  return { name: w.attack || e.name, toHit: mod + (w.prof === false ? 0 : sheetPb(m)) + bonus, damage, ability: ab };
}

const average = expr => {
  const p = parseDice(expr);
  return p ? Math.max(1, Math.floor(p.dice.reduce((t, d) => t + d.sign * d.n * (d.d + 1) / 2, 0) + p.mod)) : 0;
};

/** Stat block text for an attack, in the bestiary's words, so the same roll buttons work on it. */
export function attackText(atk, w = {}) {
  const kind = w.ranged ? 'Ranged' : w.range ? 'Melee or Ranged' : 'Melee';
  const reach = w.ranged ? `range ${w.range || '80/320'} ft.` : `reach ${w.reach ? 10 : 5} ft.${w.range ? ` or range ${w.range} ft.` : ''}`;
  const dmg = atk.damage.map(d => `${average(d.expr)} (${d.expr.replace(/([+-])/g, ' $1 ').replace(/\s+/g, ' ').trim()})${d.type ? ` ${d.type}` : ''} damage`).join(' plus ');
  return `${kind} Weapon Attack: ${signed(atk.toHit)} to hit, ${reach}, one target. Hit: ${dmg}.`;
}

// ----- spells from awakening stones -----

/** The ability their stone spells use: the class's casting ability, else their best mental one. */
export function spellAbility(m, data) {
  if (m.spellAbility && ABILITIES.includes(m.spellAbility)) return m.spellAbility;
  const cls = list(data.classes?.classes).find(c => c.name === m.class);
  if (cls?.castingAbility) return cls.castingAbility;
  if (thirdCaster(m.class, m.subclass, m.level)) return 'INT';
  return ['INT', 'WIS', 'CHA'].reduce((a, b) => abilityModOf(m, b) > abilityModOf(m, a) ? b : a);
}
export function spellNumbers(m, data) {
  const ab = spellAbility(m, data);
  const core = Number(m.coreLevels) ? 2 : 0;
  const fx = gearFx(m);
  return { ability: ab, dc: 8 + sheetPb(m) + abilityModOf(m, ab) - core + fx.spellDC, attack: sheetPb(m) + abilityModOf(m, ab) - core + fx.spellAttack };
}

// ----- class spells -----

// How each class casts: full casters reach 9th-level spells, half casters 5th, and a warlock's pact magic 5th
// (with one higher spell a day from 11th level, its mystic arcanum).
const CASTING = { Bard: 'full', Cleric: 'full', Druid: 'full', Sorcerer: 'full', Wizard: 'full', Artificer: 'half', Paladin: 'half', Ranger: 'half', Warlock: 'pact' };
// Subclasses that give a class without spells a third of a caster's: they cast wizard spells with Intelligence.
const THIRD_CASTERS = { Fighter: /eldritch knight/i, Rogue: /arcane trickster/i };
const thirdCaster = (cls, sub, level) => !!THIRD_CASTERS[cls]?.test(String(sub || '')) && (Number(level) || 1) >= 3;
/** The class whose spell list they use: their own, or the wizard's for an eldritch knight or arcane trickster. */
export const spellListClass = m => thirdCaster(m.class, m.subclass, m.level) ? 'Wizard' : m.class;
/** The highest spell level a class (and subclass) can cast at a level; −1 for one without spells. */
export function maxSpellLevel(cls, level, sub = '') {
  const l = Math.max(1, Math.min(20, Number(level) || 1));
  if (thirdCaster(cls, sub, l)) return l >= 19 ? 4 : l >= 13 ? 3 : l >= 7 ? 2 : 1;
  const kind = CASTING[cls];
  if (kind === 'full') return Math.min(9, Math.ceil(l / 2));
  if (kind === 'half') return Math.min(5, Math.ceil(l / 4));
  if (kind === 'pact') return l >= 17 ? 9 : l >= 15 ? 8 : l >= 13 ? 7 : l >= 11 ? 6 : Math.min(5, Math.ceil(l / 2));
  return -1;
}
/** Their class's spell list, up to the highest level they can cast, cantrips first. */
export function classSpellsFor(data, m) {
  const max = maxSpellLevel(m.class, m.level, m.subclass);
  if (max < 0) return [];
  const cls = spellListClass(m);
  return Object.values(data?.spells?.spells || {}).filter(s => list(s.classes).includes(cls) && Number(s.level) <= max)
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
}
/** The spells on a sheet: picked ones, plus anything typed into the older cantrips box. */
export function knownSpells(m) { return [...new Set([...list(m.spells), ...splitList(m.cantrips)])]; }
/** Spell save DC and attack for class spells: like stone spells, but without the core user's −2. */
export function castingNumbers(m, data) {
  const n = spellNumbers(m, data);
  const core = Number(m.coreLevels) ? 2 : 0;
  return { ...n, dc: n.dc + core, attack: n.attack + core, mod: abilityModOf(m, n.ability) };
}

/** What their class options add to their spells' damage (see spellAction). */
export function classSpellBonus(m) {
  const o = m.classOpts || {};
  const has = (k, n) => list(o[k]).includes(n);
  const cantripMod = [has('invocations', 'Agonizing Blast') && 'Warlock', has('blessedStrikes', 'Potent Spellcasting') && 'Cleric', has('elementalFury', 'Potent Spellcasting') && 'Druid'].filter(Boolean);
  const typeMod = /draconic/i.test(m.subclass || '') && Number(m.level) >= 6 ? String(list(o.elementalAffinity)[0] || '').toLowerCase() : '';
  return { cantripMod, typeMod };
}

/** The spell slot levels someone can cast a spell with, lowest first; a warlock's pact slots are all their highest. */
export function slotChoices(m, spellLevel) {
  const base = Number(spellLevel) || 0;
  if (!base) return [];
  const l = Math.max(1, Math.min(20, Number(m.level) || 1));
  if (CASTING[m.class] === 'pact') {
    const pact = Math.min(5, Math.ceil(l / 2));
    return [base <= pact ? pact : base];
  }
  const max = maxSpellLevel(m.class, l, m.subclass);
  return max >= base ? Array.from({ length: max - base + 1 }, (_, i) => base + i) : [base];
}
/** The slot a spell is cast with unless the DM picks another: a warlock's highest, else the spell's own level. */
export const defaultSlot = (m, spellLevel) => CASTING[m.class] === 'pact' ? slotChoices(m, spellLevel)[0] ?? 0 : Number(spellLevel) || 0;

/**
 * A spell as something to roll at the table: its spell attack or saving throw and its damage, or its healing, at a
 * caster level and slot. Cantrips grow at character levels 5, 11 and 17, beams and rays each roll on their own
 * (count), and a higher slot adds dice, darts, rays or targets as the spell says. Null when nothing rolls.
 */
export function spellAction(data, name, { attack = 0, dc = 10, mod = 0, level = 1, slot = null, cantripMod = [], typeMod = '' } = {}) {
  const s = spellInfo(data, name);
  // A spell that adds damage to weapon hits (crusader's mantle) is cast, not rolled: its dice go on the hits.
  if (!s || spellBuff(s.name)) return null;
  const text = String(s.text || '');
  const c = castSpell(s, { casterLevel: level, slot, mod });
  // Class options that add the casting modifier: agonizing blast or potent spellcasting on a class's cantrips,
  // a draconic sorcerer's elemental affinity on one damage type.
  const plus = x => ({ ...x, expr: diceText({ ...parseDice(x.expr), mod: parseDice(x.expr).mod + mod }) });
  if (mod && !c.level && list(s.classes).some(k => cantripMod.includes(k)) && c.damage.length) c.damage = c.damage.map((x, i) => i ? x : plus(x));
  else if (mod && typeMod && c.damage.some(x => x.type === typeMod)) { const i = c.damage.findIndex(x => x.type === typeMod); c.damage[i] = plus(c.damage[i]); }
  // A save the spell grants advantage or a bonus on (haste, beacon of hope) isn't one the targets roll against it.
  const save = text.replace(/\b(?:dis)?advantage on [^.]*?saving throws?|\bbonus to [^.]*?saving throws?/gi, '').match(/(strength|dexterity|constitution|intelligence|wisdom|charisma) sav/i);
  const out = {
    name: s.name, level: c.level, slot: c.slot, beams: c.kind === 'beam' ? c.count : 1, count: c.count, kind: c.kind, targets: c.targets, area: c.area, scales: c.scales,
    toHit: /spell attack/i.test(text) ? attack : null,
    save: save ? { dc, ability: cap(save[1].toLowerCase()), half: /half as much/i.test(text) } : null,
    damage: c.damage,
  };
  if (c.heal) out.heal = c.heal;
  if (c.temp) out.temp = c.temp;
  return out.toHit != null || out.save || out.damage.length || out.heal || out.temp ? out : null;
}

// ----- a fillable 5e character sheet -----

const PDF_SKILL = { 'Animal Handling': 'Animal', 'Sleight of Hand': 'SleightofHand', Deception: 'Deception ', History: 'History ', Investigation: 'Investigation ', Perception: 'Perception ', Stealth: 'Stealth ' };
const PDF_SAVE_BOX = { STR: 'Check Box 11', DEX: 'Check Box 18', CON: 'Check Box 19', INT: 'Check Box 20', WIS: 'Check Box 21', CHA: 'Check Box 22' };
const PDF_MOD = { STR: 'STRmod', DEX: 'DEXmod ', CON: 'CONmod', INT: 'INTmod', WIS: 'WISmod', CHA: 'CHamod' };
const PDF_WEAPONS = [['Wpn Name', 'Wpn1 AtkBonus', 'Wpn1 Damage'], ['Wpn Name 2', 'Wpn2 AtkBonus ', 'Wpn2 Damage '], ['Wpn Name 3', 'Wpn3 AtkBonus  ', 'Wpn3 Damage ']];
// The spell lines of the sheet's third page, top to bottom, for cantrips and each spell level.
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => `Spells ${a + i}`);
const PDF_SPELLS = [
  ['Spells 1014', ...range(1016, 1022)],
  ['Spells 1015', ...range(1023, 1033)],
  ['Spells 1046', ...range(1034, 1045)],
  ['Spells 1048', 'Spells 1047', ...range(1049, 1059)],
  ['Spells 1061', 'Spells 1060', ...range(1062, 1072)],
  ['Spells 1074', 'Spells 1073', ...range(1075, 1081)],
  ['Spells 1083', 'Spells 1082', ...range(1084, 1090)],
  ['Spells 1092', 'Spells 1091', ...range(1093, 1099)],
  ['Spells 10101', 'Spells 10100', ...range(10102, 10106)],
  ['Spells 10108', 'Spells 10107', 'Spells 10109', 'Spells 101010', 'Spells 101011', 'Spells 101012', 'Spells 101013'],
];

// ----- origins -----
// The Player's Handbook (2024) backgrounds. Each gives an origin feat, which is worth having on the sheet.

export const ORIGINS = {
  Acolyte: { feat: 'Magic Initiate (Cleric)', skills: ['Insight', 'Religion'] },
  Artisan: { feat: 'Crafter', skills: ['Investigation', 'Persuasion'] },
  Charlatan: { feat: 'Skilled', skills: ['Deception', 'Sleight of Hand'] },
  Criminal: { feat: 'Alert', skills: ['Sleight of Hand', 'Stealth'] },
  Entertainer: { feat: 'Musician', skills: ['Acrobatics', 'Performance'] },
  Farmer: { feat: 'Tough', skills: ['Animal Handling', 'Nature'] },
  Guard: { feat: 'Alert', skills: ['Athletics', 'Perception'] },
  Guide: { feat: 'Magic Initiate (Druid)', skills: ['Stealth', 'Survival'] },
  Hermit: { feat: 'Healer', skills: ['Medicine', 'Religion'] },
  Merchant: { feat: 'Lucky', skills: ['Animal Handling', 'Persuasion'] },
  Noble: { feat: 'Skilled', skills: ['History', 'Persuasion'] },
  Sage: { feat: 'Magic Initiate (Wizard)', skills: ['Arcana', 'History'] },
  Sailor: { feat: 'Tavern Brawler', skills: ['Acrobatics', 'Perception'] },
  Scribe: { feat: 'Skilled', skills: ['Investigation', 'Perception'] },
  Soldier: { feat: 'Savage Attacker', skills: ['Athletics', 'Intimidation'] },
  Wayfarer: { feat: 'Lucky', skills: ['Insight', 'Stealth'] },
};
/** What each origin feat does, in short. */
export const ORIGIN_FEATS = {
  Alert: 'Adds proficiency bonus to initiative, and can swap initiative with a willing ally.',
  Crafter: 'Proficient with three artisan’s tools, 20% off nonmagical gear, and crafts faster.',
  Healer: 'Rerolls 1s on healing dice, and with a healer’s kit can spend an action to let someone spend a hit die to heal.',
  Lucky: 'Luck points equal to proficiency bonus each long rest, spent for advantage or to give an attacker disadvantage.',
  'Magic Initiate (Cleric)': 'Two cleric cantrips, and one 1st-level cleric spell cast once per long rest without a slot.',
  'Magic Initiate (Druid)': 'Two druid cantrips, and one 1st-level druid spell cast once per long rest without a slot.',
  'Magic Initiate (Wizard)': 'Two wizard cantrips, and one 1st-level wizard spell cast once per long rest without a slot.',
  Musician: 'Proficient with three instruments; a song after a rest gives allies Heroic Inspiration.',
  'Savage Attacker': 'Once per turn, rolls weapon damage dice twice and uses either roll.',
  Skilled: 'Proficient in any three skills or tools.',
  'Tavern Brawler': 'Unarmed strikes deal 1d4 + Str, damage 1s are rerolled, and a hit can push 5 feet.',
  Tough: 'Hit point maximum rises by twice the level, and by 2 more with each level.',
};
const ROLE_ORIGIN = {
  'Adventure Society official': 'Scribe', 'Magic Society scholar': 'Sage', Crafter: 'Artisan', Priest: 'Acolyte', Noble: 'Noble', Merchant: 'Merchant',
  'Guard or soldier': 'Guard', 'Street operator': 'Criminal', 'City official': 'Scribe', 'Cultist in disguise': 'Charlatan', 'Wilderness guide': 'Guide',
};
const CLASS_ORIGIN = {
  Artificer: 'Artisan', Barbarian: 'Wayfarer', Bard: 'Entertainer', Cleric: 'Acolyte', Druid: 'Guide', Fighter: 'Soldier', Monk: 'Hermit',
  Paladin: 'Noble', Ranger: 'Guide', Rogue: 'Criminal', Sorcerer: 'Sage', Warlock: 'Charlatan', Wizard: 'Sage',
};
/** A likely origin for someone from their role (an NPC's job) or class. */
export const originFor = (role = '', cls = '') => ROLE_ORIGIN[role] || CLASS_ORIGIN[cap(String(cls).toLowerCase())] || 'Wayfarer';
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
/** The origin feat a sheet has: the one typed in, else the origin's own. */
export const originFeat = m => m.originFeat || ORIGINS[m.background]?.feat || '';
// **…** marks what the PDF sheet prints in bold.
const featLine = (origin, feat) => feat ? `Origin feat: **${feat}**${origin ? ` (${origin})` : ''}. ${ORIGIN_FEATS[feat] || ''}`.trim() : '';

// ----- appearance -----
/** The languages a sheet's dropdown offers: those of Pallimustus's peoples first, then rarer ones. */
export const LANGUAGES = ['Common', 'Elvish', 'Draconic', 'Goblin', 'Celestial', 'Ignan', 'Aquan', 'Auran', 'Terran', 'Sylvan', 'Giant', 'Primordial', 'Infernal', 'Abyssal', 'Undercommon', 'Deep Speech', "Thieves' Cant", 'Druidic'];
/** Armour, weapon and tool proficiencies for the sheet's dropdown, by group. */
export const PROFICIENCY_GROUPS = {
  Armour: ['Light armour', 'Medium armour', 'Heavy armour', 'Shields'],
  Weapons: ['Simple weapons', 'Martial weapons', 'Firearms'],
  Tools: ["Alchemist's supplies", "Brewer's supplies", "Calligrapher's supplies", "Carpenter's tools", "Cartographer's tools", "Cobbler's tools", "Cook's utensils", "Glassblower's tools", "Jeweller's tools", "Leatherworker's tools", "Mason's tools", "Painter's supplies", "Potter's tools", "Smith's tools", "Tinker's tools", "Weaver's tools", "Woodcarver's tools", 'Disguise kit', 'Forgery kit', 'Herbalism kit', "Navigator's tools", "Poisoner's kit", "Thieves' tools"],
  'Games and instruments': ['Dice set', 'Playing cards', 'Bagpipes', 'Drum', 'Flute', 'Horn', 'Lute', 'Lyre', 'Pan flute', 'Shawm', 'Viol'],
  Vehicles: ['Vehicles (land)', 'Vehicles (water)'],
};
/** A comma-separated sheet field as a list, and back. */
export const splitList = v => String(v || '').split(',').map(x => x.trim()).filter(Boolean);
export const joinList = a => [...new Set(a)].join(', ');

const LOOK_FIELDS = ['age', 'height', 'eyes', 'skin', 'hair', 'appearance', 'personality', 'ideals', 'bonds', 'flaws', 'backstory'];
export { LOOK_FIELDS };

// What each people looks like in plain sheet terms: adult age range in years, height range in inches, and the usual
// eyes, skin and hair. Used when a description doesn't say.
const BODIES = {
  Human: { age: [18, 75], height: [60, 75], eyes: ['brown', 'dark brown', 'hazel', 'blue', 'grey', 'green'], skin: ['fair', 'pale', 'olive', 'tan', 'brown', 'dark brown', 'freckled'], hair: ['black', 'dark brown', 'brown', 'auburn', 'red', 'blond', 'sandy'] },
  Elf: { age: [100, 650], height: [62, 76], eyes: ['green', 'silver', 'grey', 'violet', 'amber', 'pale blue'], skin: ['pale', 'fair', 'golden', 'olive', 'ivory'], hair: ['silver', 'black', 'pale gold', 'white', 'auburn', 'copper'] },
  Leonid: { age: [16, 65], height: [70, 86], eyes: ['amber', 'gold', 'green', 'brown'], skin: ['tawny fur', 'golden fur', 'sandy fur', 'dark brown fur', 'cream fur'], hair: ['golden mane', 'tawny mane', 'dark mane', 'russet mane', 'cream mane'] },
  Runic: { age: [18, 90], height: [60, 74], eyes: ['blue', 'grey', 'silver', 'dark'], skin: ['pale, rune-marked', 'olive, rune-marked', 'brown, rune-marked', 'fair, rune-marked'], hair: ['black', 'white', 'dark brown', 'silver'] },
  Celestine: { age: [18, 120], height: [62, 76], eyes: ['silver-flecked blue', 'silver', 'pale gold', 'violet'], skin: ['pearly pale', 'luminous fair', 'golden'], hair: ['white', 'silver', 'pale gold', 'platinum'] },
  Draconian: { age: [15, 80], height: [66, 82], eyes: ['gold', 'amber', 'red', 'green', 'slitted yellow'], skin: ['bronze scales', 'copper scales', 'green scales', 'red scales', 'blue scales', 'black scales'], hair: ['horned crest', 'scaled crest', 'swept-back horns', 'spined ridge'] },
  Smoulder: { age: [18, 90], height: [62, 76], eyes: ['orange glow', 'ember red', 'amber'], skin: ['ash grey, ember-cracked', 'charcoal', 'dark red', 'warm bronze'], hair: ['black', 'smoke grey', 'deep red', 'ember orange'] },
  Goblin: { age: [12, 60], height: [36, 46], eyes: ['yellow', 'amber', 'red', 'green'], skin: ['green', 'olive green', 'grey-green', 'yellow-green'], hair: ['black', 'none', 'dark green', 'grey'] },
  Merfolk: { age: [18, 120], height: [62, 76], eyes: ['dark', 'black', 'sea green', 'deep blue'], skin: ['sea green, scaled', 'blue-grey, scaled', 'silvery, scaled', 'pale, scaled'], hair: ['sea green', 'black', 'blue-black', 'white', 'coral red'] },
  Dwarf: { age: [50, 350], height: [48, 56], eyes: ['brown', 'grey', 'blue', 'dark'], skin: ['ruddy', 'tan', 'brown', 'fair'], hair: ['red', 'brown', 'black', 'grey', 'iron grey'] },
  Halfling: { age: [20, 150], height: [33, 40], eyes: ['brown', 'hazel', 'green', 'blue'], skin: ['tan', 'fair', 'ruddy', 'brown'], hair: ['brown', 'sandy', 'black', 'curly brown'] },
  Gnome: { age: [40, 450], height: [36, 44], eyes: ['blue', 'brown', 'green', 'violet'], skin: ['tan', 'fair', 'brown', 'ruddy'], hair: ['white', 'brown', 'blond', 'grey'] },
  Tiefling: { age: [18, 90], height: [60, 76], eyes: ['solid red', 'gold', 'black', 'silver'], skin: ['red', 'purple', 'blue-grey', 'dusky'], hair: ['black', 'dark red', 'deep purple', 'blue-black'] },
  Orc: { age: [12, 60], height: [68, 82], eyes: ['red', 'brown', 'yellow', 'black'], skin: ['grey-green', 'grey', 'dark green', 'olive'], hair: ['black', 'grey', 'dark brown'] },
};
const COLOURS = 'green|blue|grey|gray|greying|brown|hazel|amber|gold|golden|silver|violet|black|dark|pale|red|orange|yellow|white|copper|auburn|sandy|blond|blonde|russet|tawny|cream|bronze|steel|iron|ash|ember|chestnut|ginger|flaxen|raven|honey|salt-and-pepper|fair';
const hashOf = s => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const feetInches = n => `${Math.floor(n / 12)}'${Math.round(n % 12)}"`;

/** Age, height, eyes, skin and hair in plain words, from what an NPC's description says, filled in from their people
 * where it says nothing. The same NPC always comes out the same. */
export function looksFrom(text, data, { species = '', seed = text } = {}) {
  const t = String(text || '').replace(/\s+/g, ' ');
  const body = BODIES[Object.keys(BODIES).find(k => new RegExp(`\\b${k}`, 'i').test(species))] || BODIES.Human;
  const h = hashOf(seed);
  const pick = (arr, n) => arr[(h >>> n) % arr.length];
  const between = ([lo, hi], f) => Math.round(lo + (hi - lo) * f);
  const frac = n => ((h >>> n) % 1000) / 1000;
  // Age: a number in the text, or how old the description makes them sound.
  const L = data?.npc?.looks || {};
  const fill = x => x.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\\\{their\\\}|\{their\}/gi, '(?:his|her|their)');
  const bucket = Object.entries(L.age || {}).find(([, arr]) => list(arr).some(x => new RegExp(fill(x), 'i').test(t)))?.[0]
    || (/\b(teen|youth|young|boy|girl|lad|lass)\b/i.test(t) ? 'young' : /\b(elderly|ancient|wizened|grey-haired|white-haired|an old|old (?:man|woman|soldier|priest|sailor|scholar|merchant|veteran))\b/i.test(t) ? 'old' : /\bmiddle-aged\b/i.test(t) ? 'middle' : '');
  const spans = { young: [0, 0.12], adult: [0.12, 0.4], middle: [0.4, 0.65], old: [0.65, 1] };
  const greyed = /\b(white|grey|greying|grizzled|salt-and-pepper)[a-z -]*\s(hair|beard)/i.test(t);
  const [a, b] = spans[bucket || (greyed ? 'middle' : '')] || spans.adult;
  const age = t.match(/\b(\d{2,3})(?:\s*years? old| years of age)\b/i)?.[1] || String(between(body.age, a + (b - a) * frac(3)));
  // Height: the build words decide where in their people's range they fall.
  const tall = /\b(tall|towering|rangy|lanky|long-limbed|giant|huge|hulking|heavily muscled)\b/i.test(t), short = /\b(short|small|slight|tiny|diminutive|bird-boned|petite|squat)\b/i.test(t);
  const height = feetInches(between(body.height, tall ? 0.75 + frac(5) * 0.25 : short ? frac(5) * 0.25 : 0.3 + frac(5) * 0.4));
  // Eyes, skin and hair: colour words near the word, else their people's usual look.
  const near = (word, before = true) => {
    const m = t.match(new RegExp(before ? `\\b((?:(?:${COLOURS})[- ,]*(?:and )?){1,2})${word}` : `${word}[^.]{0,40}?\\b((?:${COLOURS})(?:[- ](?:${COLOURS}))?)\\b`, 'i'));
    return m ? m[1].replace(/[-, ]+(and )?$/, '').replace(/gray/i, 'grey').toLowerCase() : '';
  };
  const eyes = near('eyes') || near('eyes are', false) || pick(body.eyes, 7);
  const skinWord = t.match(/\b(freckled|sun-browned|sunburnt|weathered|pale|ruddy|olive|tanned|dark-skinned|scarred)\b/i)?.[1]?.toLowerCase();
  const skin = near('(?:skin|scales|fur)') || skinWord || pick(body.skin, 9);
  // Hair: the few words just before "hair" (or mane, braid…), kept when one of them is a colour.
  const STOP = /^(a|an|the|with|and|has|his|her|their|of|in|to|skin|eyes?|that|is|wears?)$/i;
  const hairM = t.match(/((?:[A-Za-z-]+ ){1,3})(hair|mane|braids?|curls|locks)\b/i);
  const words = hairM ? hairM[1].trim().split(' ') : [];
  while (words.length && !STOP.test(words[words.length - 1]) && words.some(w => STOP.test(w))) words.shift();
  const hairWords = words.filter(w => !STOP.test(w)).join(' ').toLowerCase();
  const hair = /\bshaved (?:scalp|head)\b|\bbald\b/i.test(t) ? 'shaved'
    : hairWords && new RegExp(`\\b(${COLOURS})\\b`, 'i').test(hairWords) ? `${hairWords}${/mane|braid|curls|locks/i.test(hairM[2]) ? ` ${hairM[2].toLowerCase()}` : ''}` : pick(body.hair, 11);
  return { age, height, eyes: cap(eyes), skin: cap(skin), hair: cap(hair) };
}

const section = (md, name, level = 2) => (String(md).match(new RegExp(`^${'#'.repeat(level)}\\s*${name}[^\\n]*\\n([\\s\\S]*?)(?=^#{1,${level}}\\s|^:::\\s*$|(?![\\s\\S]))`, 'mi'))?.[1] || '').trim();
const clean = s => String(s).replace(/:::\w*|<\/?div[^>]*>|<!--[\s\S]*?-->/g, '').replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_, a, b) => b || a)
  .replace(/\*\*|__|\*/g, '').replace(/^\s*-\s*$/gm, '').replace(/^>\s?/gm, '').replace(/\n{3,}/g, '\n\n').trim();

/**
 * A character in the sheet's terms, from a party member's sheet. `body` is their page text (inventory and notes).
 */
/** Spells that items cast, put on the spell page by level (cantrips at 0; anything above 5th goes with the 5th). */
function itemSpellLevels(data, spells) {
  const levels = Array.from({ length: 10 }, () => []);
  for (const { spell, from } of spells) {
    const lvl = Number(spellInfo(data, spell)?.level) || 0;
    levels[Math.min(9, lvl)].push(`${spell} (${from})`);
  }
  return levels;
}

export function pcSheetCharacter(m, data, body = '') {
  const level = Number(m.level) || 1;
  const pb = sheetPb(m);
  const ab = abilities(m);
  const ac = sheetAC(m, data);
  const eq = list(m.equipped);
  const attacks = pcAttacks(m);
  const revoked = list(m.revoked);
  const powers = sheetPowers(data, { essences: list(m.essences), revoked, confluence: m.confluence, level });
  const sp = spellNumbers(m, data);
  const stones = list(m.stones).filter(s => s.spell && !revoked.includes(s.essence));
  const essences = list(m.essences).filter(Boolean);
  const die = list(data.classes?.classes).find(c => c.name === m.class)?.hitDie || 8;
  const live = essences.filter(e => !revoked.includes(e)).length;
  const conf = m.confluence ? `${m.confluence}${live < 3 ? ' (dormant)' : ''}` : '';
  const essenceText = essences.map(name => {
    const i = essenceInfo(data, name);
    // Rarity and affinity stay off the sheet (Austin); a divine essence still says who granted it.
    const kind = i?.divine ? `divine, granted by ${i.divine.called || i.divine.god}` : '';
    const own = powers.filter(w => w.from === (i?.name || name)).map(w => `  **${w.name}**${w.uses ? ` (${w.uses})` : ''}: ${w.text}`);
    return [`**${i?.name || name} essence**${kind ? ` (${kind})` : ''}${revoked.includes(name) ? ', revoked by the god' : ''}`, ...own].join('\n');
  });
  const ci = m.confluence && confluenceInfo(data, m.confluence);
  const confPower = powers.find(w => w.confluence);
  const known = Array.from({ length: 10 }, () => []);
  for (const n of knownSpells(m)) { const i = spellInfo(data, n); known[Math.min(9, Number(i?.level) || 0)].push(i?.name || n); }
  // Domain, oath and patron spells are always prepared.
  for (const n of subclassSpellsAt(m.class, m.subclass, level)) {
    const i = spellInfo(data, n), name = i?.name || n;
    if (!known.flat().some(k => k.toLowerCase() === name.toLowerCase())) known[Math.min(9, Number(i?.level) || 1)].push(`${name} (${m.subclass})`);
  }
  return {
    name: m.title, player: m.player || '', classLevel: `${m.class || ''} ${level} · ${pcRank(m)}`.trim(), race: m.species || '', alignment: m.alignment || '',
    background: m.background || '', confluence: conf || (live < 3 ? 'None yet' : ''),
    abilities: ab, pb,
    saves: Object.fromEntries(ABILITIES.map(a => [a, { bonus: saveBonus(m, a), prof: saveProfs(m).includes(a) }])),
    skills: Object.fromEntries(SKILLS.map(([s]) => [s, { bonus: skillBonus(m, s), prof: skillLevel(m, s) > 0 }])),
    passive: passivePerception(m), ac: ac.ac, init: initiative(m), speed: `${Number(m.speed) || 30} ft`,
    hpMax: Number(m.hpMax) || 0, hp: Number(m.hp) || 0, hitDice: `${level}d${die}`, hitDiceLeft: `${Math.max(0, level - (Number(m.hitDiceUsed) || 0))}d${die}`,
    attacks: attacks.map(({ atk }) => ({ name: atk.name, bonus: signed(atk.toHit), damage: atk.damage.map(d => `${d.expr.replace(/\s+/g, '')} ${d.type}`.trim()).join(' + ') })),
    attackNotes: attacks.slice(3).map(({ atk }) => `${atk.name}: ${signed(atk.toHit)} to hit, ${atk.damage.map(d => `${d.expr} ${d.type}`.trim()).join(' + ')}`).join('\n'),
    equipment: [
      ...(m.armor && !['manual', 'none'].includes(m.armor) ? [`${m.armor} (worn)`] : []), ...(m.shield ? [`${m.shield} (carried)`] : []),
      ...eq.map(e => `${e.name}${e.weapon && e.weapon.attack && e.weapon.attack !== e.name ? ` ("${e.weapon.attack}")` : ''} (equipped${!e.attune ? '' : isActive(m, e) ? ', attuned' : ', not attuned'})`),
      ...clean(section(body, 'Inventory')).split('\n').map(l => l.replace(/^\s*[-*]\s*/, '').trim()).filter(Boolean),
    ].join('\n'),
    attuned: attunedItems(m).map(e => e.name),
    rank: pcRank(m),
    features: [m.subclass && `Subclass: **${m.subclass}**${level < 3 ? ' (from level 3)' : ''}.`, ...featuresAt(m.class, level, m.subclass).map(f => `**${f.name}.** ${f.text}`), ...classOptionLines(m), featLine(m.background, originFeat(m)), `Rank: ${pcRank(m)}${Number(m.coreLevels) ? ` (${m.coreLevels} level${m.coreLevels > 1 ? 's' : ''} from cores)` : ''}`].filter(Boolean).join('\n\n'),
    extraFeatures: [
      essenceText.length ? `**ESSENCES**\n${essenceText.join('\n')}` : '**ESSENCES**\nNone yet.',
      ci || m.confluence ? `**CONFLUENCE: ${m.confluence}**${live < 3 ? ' (dormant until three essences are held)' : ''}${ci?.theme ? `\n  ${ci.theme}` : ''}${confPower ? `\n  **${confPower.name}**: ${confPower.text}` : ''}` : '',
    ].filter(Boolean).join('\n\n'),
    profsLang: [m.languages ? `Languages: ${m.languages}` : '', m.proficiencies || ''].filter(Boolean).join('\n'),
    spellClass: maxSpellLevel(m.class, level, m.subclass) >= 0 ? `${m.class} spells, essences and stones` : 'Essences and awakening stones', spellAbility: ABILITY_NAMES[sp.ability], spellDC: String(sp.dc), spellAttack: signed(sp.attack),
    spells: [known[0], ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(l => [...known[l], ...stones.filter(s => (Number(s.level) || 1) === l).map(s => `${s.spell} (${s.essence})`)])]
      .map((names, l) => [...names, ...itemSpellLevels(data, gearFx(m).spells)[l]]),
    age: m.age || '', height: m.height || '', eyes: m.eyes || '', skin: m.skin || '', hair: m.hair || '', appearance: m.appearance || '',
    personality: m.personality || '', ideals: m.ideals || '', bonds: m.bonds || '', flaws: m.flaws || '',
    faction: m.faction || '', allies: '',
    backstory: m.backstory || clean(section(body, 'Backstory') || section(body, 'Notes')),
    treasure: blankTreasure([
      ...['iron', 'bronze', 'silver', 'gold', 'diamond'].filter(k => Number(m.cores?.[k])).map(k => `${m.cores[k]} ${k} cores`),
      ...list(m.carried).map(e => `${e} essence (carried)`),
    ]),
  };
}

/** The treasure box: blank lines for coins, which change too often to print, then anything else they hold. */
// Each coin line has empty rows under it, room for large handwriting.
const COIN_GAP = ['', '', ''];
const blankTreasure = rest => ['Spirit coins:', ...COIN_GAP, 'Gold coins:', ...COIN_GAP, ...rest].join('\n').trimEnd();

/** A character in the sheet's terms from an NPC page: its stat block, essences, looks, personality and backstory. */
export function npcSheetCharacter(meta, body = '', notes = body, data = {}) {
  return withNpcAttunement(npcBase(meta, body, notes, data), meta, data);
}

/** An NPC's class, level and subclass, from its stat block's line: "Silver rank fighter 11 (Battle Master)". */
export function npcClassInfo(body) {
  const block = String(body).match(/<div class="statblock">([\s\S]*?)<\/div>/)?.[1] || '';
  const sub = block.match(/^\*([^*\n]+)\*\s*$/m)?.[1] || '';
  const m = sub.replace(/^.*?,\s*/, '').replace(/^\w+ rank\s*/i, '').match(/^([a-z]+)\s+(\d+)(?:\s*\(([^)]+)\))?$/i);
  return m ? { cls: cap(m[1].toLowerCase()), level: Number(m[2]), subclass: m[3] || '' } : null;
}
/** An NPC's class options: the ones saved on its page, else picks made for it from its class, level and subclass. */
export function npcClassOpts(meta, body) {
  const info = npcClassInfo(body);
  if (!info) return null;
  const m = { class: info.cls, level: info.level, subclass: meta.subclass ?? matchSubclass(info.cls, info.subclass) };
  // Made-up picks lean on what the stat block already shows (the weapons it attacks with).
  return { m, picked: meta.classOpts || autoClassOpts(m, meta.title || '', String(body)) };
}
function npcClassOptionLines(meta, body) {
  const o = npcClassOpts(meta, body);
  return o ? classOptionLines(o.m, o.picked) : [];
}

/** An NPC's attuned items (kept in its page data, as `attuned`) worked into the numbers from its stat block. */
export function withNpcAttunement(c, meta, data) {
  const entries = list(meta.attuned).slice(0, MAX_ATTUNED).map(n => ({ ...equipEntry(data, n) }));
  if (!entries.length) return c;
  const m = { abilities: c.abilities, equipped: entries, attuned: entries.map(e => e.name), level: 1 };
  const fx = gearFx(m);
  const ab = abilities(m);
  const shift = a => modNum(ab[ABILITIES.indexOf(a)]) - modNum(c.abilities[ABILITIES.indexOf(a)]);
  const attacks = entries.filter(e => e.weapon).map(e => {
    // Worked out at level 1, then the stat block's own proficiency bonus swapped in.
    const atk = weaponAttack({ ...m, abilities: ab }, e);
    return { name: atk.name, bonus: signed(atk.toHit - sheetPb(m) + c.pb), damage: atk.damage.map(d => `${d.expr.replace(/\s+/g, '')} ${d.type}`.trim()).join(' + ') };
  });
  const spells = itemSpellLevels(data, fx.spells);
  const spellKey = Object.keys(ABILITY_NAMES).find(k => ABILITY_NAMES[k] === c.spellAbility);
  const spellShift = spellKey ? shift(spellKey) : 0;
  const allAttacks = [...attacks, ...c.attacks];
  return {
    ...c,
    abilities: ab, attuned: entries.map(e => e.name),
    ac: c.ac + entries.reduce((t, e) => t + (Number(e.ac) || 0), 0),
    saves: Object.fromEntries(ABILITIES.map(a => [a, { ...c.saves[a], bonus: c.saves[a].bonus + shift(a) + fx.saves }])),
    skills: Object.fromEntries(SKILLS.map(([sk, a]) => [sk, { ...c.skills[sk], bonus: c.skills[sk].bonus + shift(a) + fx.checks }])),
    passive: c.passive + shift('WIS') + fx.checks,
    attacks: allAttacks.slice(0, 3),
    attackNotes: [allAttacks.slice(3).map(x => `${x.name}: ${x.bonus} to hit, ${x.damage}`).join('\n'), c.attackNotes].filter(Boolean).join('\n'),
    equipment: [c.equipment, ...entries.map(e => `${e.name} (attuned)`)].filter(Boolean).join('\n'),
    spellDC: String(Number(c.spellDC) + fx.spellDC + spellShift), spellAttack: signed(Number(c.spellAttack) + fx.spellAttack + spellShift),
    spells: c.spells.map((names, l) => [...names, ...(spells[l] || [])]),
  };
}

/** The spells a Spellcasting trait lists, with their levels (cantrips are 0; "1/day" counts as its own spell's level unknown, so 1). */
function classSpellList(t) {
  const out = [];
  for (const g of t.text.matchAll(/(Cantrips|At will|\d+(?:st|nd|rd|th)(?: level)?|\d+\/day(?: each)?)\s*(?:\([^)]*\))?:\s*([^.]+)\./gi)) {
    const level = /^cantrips|^at will/i.test(g[1]) ? 0 : /^\d+(st|nd|rd|th)/i.test(g[1]) ? Number(g[1].match(/\d+/)[0]) : 1;
    for (const x of g[2].split(/,\s*/)) { const spell = cap(x.replace(/\*/g, '').trim()); if (spell) out.push({ spell, level }); }
  }
  return out;
}

/** A Spellcasting trait with one row per spell and its level; NPCs don't count slots. */
function spellRows(t, onSpellPage = false) {
  const groups = [...t.text.matchAll(/(Cantrips|At will|\d+(?:st|nd|rd|th)(?: level)?|\d+\/day(?: each)?)\s*(?:\([^)]*\))?:\s*([^.]+)\./gi)];
  if (!groups.length) return `**${t.name}.** ${t.text}`;
  const before = t.text.slice(0, groups[0].index).trim();
  // Just the numbers that matter at the table: "Spell save DC 15, +7 to hit."
  const dc = before.match(/DC (\d+)/i)?.[1], hit = before.match(/([+-]\d+) to hit/i)?.[1];
  const intro = dc || hit ? `${[dc && `Spell save DC ${dc}`, hit && `${hit} to hit`].filter(Boolean).join(', ')}.` : before;
  const rows = groups.flatMap(g => {
    const lvl = /^cantrips$/i.test(g[1]) ? 'Cantrip' : /^\d+(st|nd|rd|th)$/i.test(g[1]) ? `${g[1]} level` : cap(g[1].toLowerCase());
    return g[2].split(/,\s*/).map(x => x.replace(/\*/g, '').trim()).filter(Boolean).map(x => `  ${lvl}: ${cap(x)}`);
  });
  // When the spells fit on the spell page they go there, which keeps this box short for high-level casters.
  if (onSpellPage) return `**${t.name}.** ${intro} Spells are on the spell page.`;
  return [`**${t.name}.** ${intro}`, ...rows].join('\n');
}

function npcBase(meta, body = '', notes = body, data = {}) {
  const text = String(body);
  const block = text.match(/<div class="statblock">([\s\S]*?)<\/div>/)?.[1] || text;
  const field = name => block.match(new RegExp(`\\*\\*${name}\\*\\*\\s*([^\\n]*?)\\s*(?:\\s{2})?$`, 'mi'))?.[1].replace(/\s*·.*$/, '').trim() || '';
  const row = block.match(/\|\s*:?-+:?\s*\|[^\n]*\n\|([^\n]+)\|/);
  const ab = row ? row[1].split('|').map(c => Number(c.match(/\d+/)?.[0]) || 10).slice(0, 6) : [10, 10, 10, 10, 10, 10];
  const sub = block.match(/^\*([^*\n]+)\*\s*$/m)?.[1] || '';
  const lvl = Number(sub.match(/\b(\d+)\s*(?:\([^)]*\))?\s*$/)?.[1]) || 1;
  const pb = Number(block.match(/\*\*Proficiency Bonus\*\*\s*\+(\d+)/)?.[1]) || proficiencyBonus(lvl);
  const m = { abilities: ab };
  const listed = s => Object.fromEntries(String(s).split(',').map(x => x.trim().match(/^(.+?)\s*([+-−]\s*\d+)$/)).filter(Boolean).map(x => [x[1].toLowerCase(), Number(x[2].replace(/\s/g, '').replace('−', '-'))]));
  const saves = listed(field('Saving Throws')), skills = listed(field('Skills'));
  const entries = s => [...s.matchAll(/\*\*\*(.+?)\.?\*\*\*\s*([^\n]+)/g)].map(x => ({ name: x[1].replace(/\.$/, ''), text: x[2].replace(/\*/g, '').trim() }));
  const actions = entries(section(block, 'Actions', 4));
  const attacks = actions.map(a => ({ name: a.name, hit: a.text.match(/([+-]\d+) to hit/)?.[1], dmg: [...a.text.matchAll(/\d+ \((\d+d\d+(?:\s*[+-−]\s*\d+)?)\)\s*([a-z]+)?/gi)].map(x => `${x[1].replace(/\s+/g, '')} ${x[2] || ''}`.trim()).join(' + ') }))
    .filter(a => a.hit || a.dmg).map(a => ({ name: a.name, bonus: a.hit || '', damage: a.dmg }));
  const hp = field('Hit Points');
  const traits = entries(section(block, 'Traits', 4));
  const essenceTraits = traits.filter(t => /essence|confluence|divine/i.test(t.name));
  const classSpells = traits.filter(t => /spellcasting/i.test(t.name)).flatMap(classSpellList);
  // Essences and the confluence, from the page's list (or the stat block's traits when there is no list).
  const essLines = section(text, 'Essences and powers').split('\n').filter(l => /^\s*-\s/.test(l)).map(l => clean(l.replace(/^\s*-\s*/, '')));
  const confLine = essLines.find(l => /^Confluence:/i.test(l));
  // "Hammer (common, Might): …" loses its rarity and affinity on the sheet.
  const essList = essLines.filter(l => l !== confLine).map(l => l.replace(/^([^(:]+?)\s*\((?:common|uncommon|rare|epic|legendary|basic|mythic)[^)]*\)/i, '$1'));
  const path = section(text, 'Essences and powers').match(/Path to rank: ([^.\n]+)/)?.[1] || '';
  // Spells: stone spells from the stat block, cantrips from its actions.
  const stoneSec = section(block, 'Awakening stones', 4);
  const stones = [...stoneSec.matchAll(/^\s*-\s*\*?([^*(\n]+?)\*?\s*\(level (\d)(?:, ([^)]+))?\)/gmi)].map(x => ({ spell: cap(x[1].trim()), level: Number(x[2]), from: x[3] || '' }));
  const cantrips = actions.filter(a => /\(cantrip\)/i.test(a.name)).map(a => a.name.replace(/\s*\(cantrip\)/i, ''));
  const stoneAb = stoneSec.match(/\b(Str|Dex|Con|Int|Wis|Cha)-based/i)?.[1]?.toUpperCase() || ['INT', 'WIS', 'CHA'].reduce((a, b) => modNum(ab[ABILITIES.indexOf(b)]) > modNum(ab[ABILITIES.indexOf(a)]) ? b : a);
  const dc = Number(stoneSec.match(/spell save DC (\d+)/i)?.[1]) || 8 + pb + modNum(ab[ABILITIES.indexOf(stoneAb)]);
  const atk = stoneSec.match(/([+-]\d+) to hit with spell attacks/i)?.[1] || signed(pb + modNum(ab[ABILITIES.indexOf(stoneAb)]));
  // Looks, personality and backstory from the rest of the page.
  const notesText = String(notes);
  const intro = notesText.replace(/:::dm[\s\S]*?\n:::\s*\n/g, '').split(/\n#{1,3}\s/)[0];
  const desc = clean(intro.split('\n').filter(l => l.trim() && !/^\*\*.*\*\*\s*·|^(5e )?species:?|^\*\*[^*]+-rank/i.test(l.trim())).join(' '));
  // Starter pages write the intro as a lead line and **Looks:** / **Personality:** bullets.
  const bullet = k => clean(intro.match(new RegExp(`^\\s*-\\s*\\*\\*${k}:\\*\\*\\s*([^\\n]+)`, 'mi'))?.[1] || '');
  const lead = clean(intro.split('\n').filter(l => l.trim() && !/^\s*-\s/.test(l)).join(' ').replace(/^\s*\S+ rank\.\s*/i, ''));
  const appearance = bullet('Looks') ? `${lead ? lead + ' ' : ''}${bullet('Looks')}` : desc;
  // Kept on the page once chosen (the PDF dialog saves them), else read from the description.
  const read = looksFrom(appearance, data, { species: sub.match(/\(([^)]+)\)/)?.[1] || appearance, seed: meta.title || appearance });
  const looks = Object.fromEntries(['age', 'height', 'eyes', 'skin', 'hair'].map(k => [k, meta[k] ? String(meta[k]) : read[k]]));
  const playing = section(notesText, 'Playing [^\\n]+');
  const hopes = section(notesText, 'Hopes, drives and fears');
  const item = (s, k) => clean(s.match(new RegExp(`\\*\\*${k}:\\*\\*\\s*([^\\n]+)`, 'i'))?.[1] || '');
  const faction = text.match(/^\*\*[^\n]*\*\*\s*·[^\n]*·\s*\[\[([^\]|]+)/m)?.[1] || meta.parent || '';
  const cls = sub.match(/([A-Za-z]+)\s+\d+\b/)?.[1] || '';
  // "Silver rank fighter 11 (Eldritch Knight)" is written the players' way: "Fighter 11 · Silver", the subclass under features.
  const rank = cap(String(meta.rank || sub.match(/\b(Normal|Iron|Bronze|Silver|Gold|Diamond) rank/i)?.[1] || rankForLevel(lvl)).toLowerCase());
  const parts = sub.replace(/^.*?,\s*/, '').replace(/^\w+ rank\s*/i, '').match(/^([a-z][a-z ]*?)(?:\s+(\d+))?(?:\s*\(([^)]+)\))?$/i);
  const classLine = parts ? `${cap(parts[1])}${parts[2] ? ` ${parts[2]}` : ''} · ${rank}` : `${rank} rank`;
  const subclass = parts?.[3] || '';
  const origin = meta.origin || originFor(meta.role, cls);
  return {
    rank, name: meta.title, player: '', classLevel: classLine, race: sub.match(/\(([^)]+)\)/)?.[1] || '', alignment: meta.alignment || '',
    background: origin, confluence: confLine ? confLine.replace(/^Confluence:\s*/i, '').split(/\s*\(|:/)[0] : essList.length ? 'None yet' : '',
    abilities: ab, pb,
    saves: Object.fromEntries(ABILITIES.map(a => { const v = saves[a.toLowerCase()] ?? saves[ABILITY_NAMES[a].toLowerCase()]; return [a, { bonus: v ?? modNum(ab[ABILITIES.indexOf(a)]), prof: v != null }]; })),
    skills: Object.fromEntries(SKILLS.map(([s, a]) => { const v = skills[s.toLowerCase()]; return [s, { bonus: v ?? abilityModOf(m, a), prof: v != null }]; })),
    passive: Number(field('Senses').match(/passive Perception (\d+)/i)?.[1]) || 10 + (skills.perception ?? abilityModOf(m, 'WIS')),
    ac: Number(field('Armor Class').match(/\d+/)?.[0]) || 10, init: abilityModOf(m, 'DEX'), speed: field('Speed'),
    hpMax: Number(hp.match(/\d+/)?.[0]) || 0, hp: Number(hp.match(/\d+/)?.[0]) || 0, hitDice: hp.match(/\((\d+d\d+)/)?.[1] || '',
    attacks: attacks.slice(0, 3),
    attackNotes: actions.filter(a => !attacks.slice(0, 3).some(x => x.name === a.name) && !/\(cantrip\)/i.test(a.name)).map(a => `${a.name}. ${a.text}`).join('\n'),
    equipment: field('Armor Class').match(/\(([^)]+)\)/)?.[1] || '',
    features: [subclass && `Subclass: **${cap(subclass)}**.`, ...featuresAt(cls, lvl, subclass).filter(f => !traits.some(t => t.name?.toLowerCase() === f.name.toLowerCase())).map(f => `**${f.name}.** ${f.text}`), ...npcClassOptionLines(meta, body), featLine(origin, meta.originFeat || ORIGINS[origin]?.feat), ...traits.filter(t => !essenceTraits.includes(t)), ...entries(section(block, 'Reactions', 4)).map(r => ({ ...r, name: `${r.name} (reaction)` }))]
      .map(t => typeof t === 'string' ? t : /spellcasting/i.test(t.name) ? spellRows(t, classSpells.length) : `**${t.name}.** ${t.text}`).filter(Boolean).join('\n\n'),
    extraFeatures: [
      `**ESSENCES**${path ? ` (path to rank: ${path})` : ''}\n${essList.length ? essList.map(l => l.replace(/^([^:]+):/, '**$1**:')).join('\n') : 'None yet.'}`,
      confLine ? `**CONFLUENCE: ${confLine.replace(/^Confluence:\s*/i, '').replace(/^([^(:]+?)(\s*[(:])/, '$1**$2')}` : '',
      essenceTraits.length ? `**POWERS**\n${essenceTraits.map(t => `**${t.name}.** ${t.text}`).join('\n')}` : '',
    ].filter(Boolean).join('\n\n'),
    profsLang: [field('Languages') && `Languages: ${field('Languages')}`, field('Tools') && `Tools: ${field('Tools')}`, field('Senses') && `Senses: ${field('Senses')}`].filter(Boolean).join('\n'),
    spellClass: classSpells.length ? `${cap(cls.toLowerCase()) || 'Class'} spells, essences and stones` : 'Essences and awakening stones', spellAbility: ABILITY_NAMES[stoneAb], spellDC: String(dc), spellAttack: atk,
    // Class spells sit on the spell page with the stone spells, each marked with where it comes from.
    spells: [cantrips, ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(l => stones.filter(s => s.level === l).map(s => `${s.spell}${s.from ? ` (${s.from})` : ''}`))]
      .map((names, l) => [...classSpells.filter(x => x.level === l).map(x => `${x.spell} (${cap(cls.toLowerCase()) || 'class'})`), ...names]),
    ...looks, appearance,
    personality: [bullet('Personality'), clean(playing.split('\n')[0] || '')].filter(Boolean).join(' '), ideals: [item(hopes, 'Hopes'), item(hopes, 'Driven by')].filter(Boolean).join('. '),
    bonds: item(hopes, 'Bond'), flaws: [item(hopes, 'Flaw'), item(hopes, 'Fears') && `Fears: ${item(hopes, 'Fears')}`].filter(Boolean).join('. '),
    faction, allies: '',
    backstory: [clean(section(notesText, 'Backstory')), section(notesText, 'Secrets') ? `Secrets:\n${clean(section(notesText, 'Secrets'))}` : ''].filter(Boolean).join('\n\n')
      || [lead, bullet('Wants') && `Wants: ${bullet('Wants')}`, clean(section(notesText, 'What people say')) && `What people say: ${clean(section(notesText, 'What people say'))}`].filter(Boolean).join('\n\n'),
    treasure: blankTreasure([]),
  };
}

/** The fields of the fillable 5e sheet: { text: { field: value }, checks: [box names] }. `Appearance` is a box the app adds. */
export function sheetPdfFields(c) {
  const t = {
    CharacterName: c.name, 'CharacterName 2': c.name, PlayerName: c.player, ClassLevel: c.classLevel, 'Race ': c.race, Alignment: c.alignment, Background: c.background, XP: c.confluence,
    ProfBonus: signed(c.pb), AC: String(c.ac), Initiative: signed(c.init), Speed: c.speed, HPMax: String(c.hpMax), HPCurrent: String(c.hp), HDTotal: c.hitDice, HD: c.hitDiceLeft ?? c.hitDice,
    Passive: String(c.passive), AttacksSpellcasting: c.attackNotes, Equipment: c.equipment, 'Features and Traits': c.features, 'Feat+Traits': c.extraFeatures, ProficienciesLang: c.profsLang,
    'Spellcasting Class 2': c.spellClass, 'SpellcastingAbility 2': c.spellAbility, 'SpellSaveDC  2': c.spellDC, 'SpellAtkBonus 2': c.spellAttack,
    Weight: c.rank, Age: c.age, Height: c.height, Eyes: c.eyes, Skin: c.skin, Hair: c.hair, Appearance: c.appearance,
    'PersonalityTraits ': c.personality, Ideals: c.ideals, Bonds: c.bonds, Flaws: c.flaws, FactionName: c.faction, Allies: c.allies,
    Backstory: c.backstory, Treasure: c.treasure,
    ...Object.fromEntries(list(c.attuned).slice(0, MAX_ATTUNED).map((n, i) => [`Attuned ${i + 1}`, n])),
  };
  ABILITIES.forEach((a, i) => { t[a] = String(c.abilities[i]); t[PDF_MOD[a]] = signed(modNum(c.abilities[i])); t[`ST ${ABILITY_NAMES[a]}`] = signed(c.saves[a].bonus); });
  for (const [s] of SKILLS) t[PDF_SKILL[s] || s] = signed(c.skills[s].bonus);
  c.attacks.slice(0, 3).forEach((a, i) => { const [n, b, d] = PDF_WEAPONS[i]; t[n] = a.name; t[b] = a.bonus; t[d] = a.damage; });
  c.spells.forEach((names, l) => names.slice(0, PDF_SPELLS[l]?.length || 0).forEach((n, i) => { t[PDF_SPELLS[l][i]] = n; }));
  // Spells with no row left on the spell page go on an extra page at the end.
  const more = c.spells.flatMap((names, l) => names.slice(PDF_SPELLS[l]?.length || 0).map(n => `  ${l ? `Level ${l}` : 'Cantrip'}: ${n}`));
  const extra = more.length ? [{ title: 'More spells', text: more.join('\n') }] : [];
  const checks = [
    ...ABILITIES.filter(a => c.saves[a].prof).map(a => PDF_SAVE_BOX[a]),
    ...SKILLS.map(([s], i) => c.skills[s].prof ? `Check Box ${23 + i}` : null).filter(Boolean),
  ];
  for (const k of Object.keys(t)) if (t[k] == null || t[k] === '') delete t[k];
  return { text: t, checks, extra };
}

// ----- spell slots -----

// A full caster's slots by caster level, 1st-level slots first. Half and third casters use it at half or a third of
// their level, rounded up (the 2024 tables).
const FULL_SLOTS = [[], [2], [3], [4, 2], [4, 3], [4, 3, 2], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 2], [4, 3, 3, 3, 1], [4, 3, 3, 3, 2],
  [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1, 1], [4, 3, 3, 3, 3, 1, 1, 1, 1], [4, 3, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 3, 2, 2, 1, 1]];
/**
 * The spell slots a party member has, as rows of { key, level, max }: one row per slot level, or for a warlock one
 * row of pact slots (all their highest level, back on a short rest) and one row per mystic arcanum (once a day).
 * Spent slots live in meta.slotsUsed by key.
 */
export function slotsFor(m) {
  const l = Math.max(1, Math.min(20, Number(m.level) || 1));
  const kind = thirdCaster(m.class, m.subclass, l) ? 'third' : CASTING[m.class];
  if (kind === 'pact') {
    const rows = [{ key: 'pact', level: Math.min(5, Math.ceil(l / 2)), max: l >= 17 ? 4 : l >= 11 ? 3 : l >= 2 ? 2 : 1, pact: true }];
    for (const [at, lvl] of [[11, 6], [13, 7], [15, 8], [17, 9]]) if (l >= at) rows.push({ key: `a${lvl}`, level: lvl, max: 1, arcanum: true });
    return rows;
  }
  const casterLevel = kind === 'full' ? l : kind === 'half' ? Math.ceil(l / 2) : kind === 'third' ? Math.ceil(l / 3) : 0;
  return (FULL_SLOTS[casterLevel] || []).map((max, i) => ({ key: String(i + 1), level: i + 1, max }));
}
/** How many of a slot row are left. */
export const slotsLeft = (m, row) => Math.max(0, row.max - (Number(m.slotsUsed?.[row.key]) || 0));
/**
 * The slot row a spell of `spellLevel` would use when cast with a `wanted` slot level (or the lowest that will do):
 * the wanted level if it has one left, else the lowest higher level with one left. Null when none is left.
 */
export function slotToSpend(m, spellLevel, wanted = null) {
  const base = Number(spellLevel) || 0;
  if (!base) return null;
  const rows = slotsFor(m).filter(r => r.level >= base && (!r.arcanum || r.level === base));
  const want = Number(wanted) || base;
  return rows.find(r => r.level === want && slotsLeft(m, r)) || rows.filter(r => r.level >= want).sort((a, b) => a.level - b.level).find(r => slotsLeft(m, r))
    || null;
}
