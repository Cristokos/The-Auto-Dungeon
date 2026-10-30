// Summons, Wild Shape and mounts for the battle screen. The 2024 rules' summoned spirits, the Otherworldly Steed,
// the Steel Defender and the Primal Companion are built here as stat blocks scaled by the spell's level or the
// caster's numbers; anything else (a familiar, an animated skeleton, a figurine's creature) comes from the bestiary.
// The traits are written in our own words; the numbers follow the rules.

const avg = (n, d, mod = 0) => Math.floor(n * (d + 1) / 2 + mod);
const signed = n => `${n < 0 ? '-' : '+'}${Math.abs(n)}`;
const dice = (n, d, mod = 0) => `${avg(n, d, mod)} (${n}d${d}${mod ? ` ${mod < 0 ? '-' : '+'} ${Math.abs(mod)}` : ''})`;
const mod = score => Math.floor((Number(score) - 10) / 2);

/** A stat block attack line the battle screen can roll: "Melee Weapon Attack: +7 to hit, reach 5 ft., one target. Hit: 9 (1d8 + 5) piercing damage." */
export function attackLine({ ranged = false, both = false, toHit, reach = 5, range = '', n = 1, d = 8, plus = 0, type, extra = '' }) {
  const kind = both ? 'Melee or Ranged' : ranged ? 'Ranged' : 'Melee';
  const where = both ? `reach ${reach} ft. or range ${range} ft.` : ranged ? `range ${range} ft.` : `reach ${reach} ft.`;
  return `${kind} Weapon Attack: ${signed(toHit)} to hit, ${where}, one target. Hit: ${dice(n, d, plus)} ${type} damage.${extra ? ` ${extra}` : ''}`;
}
/** How many attacks a summoned spirit makes: half the spell's level, rounded down. */
const attacksAt = level => Math.max(1, Math.floor(level / 2));
const multi = (level, what) => attacksAt(level) > 1 ? [{ name: 'Multiattack', desc: `It makes ${['', 'one', 'two', 'three', 'four', 'five'][attacksAt(level)]} ${what} attacks.` }] : [];

function block(o) {
  return {
    alignment: 'unaligned', languages: 'understands the languages of its summoner', senses: 'passive Perception 10',
    cr: 0, xp: 0, summoned: true, traits: [], actions: [], reactions: [], ...o,
    hitDice: '', hp: Math.max(1, Math.round(o.hp)),
  };
}

// ----- summoning spells -----
// Each entry: the creature's name, its forms (a choice when cast), the lowest spell level, and a builder from the
// spell's level and the caster's numbers ({ attack, dc, mod }). `after`: it acts right after the caster on the same
// initiative. `conc`: it lasts while the caster concentrates. `count`: how many come, by spell level.

export const SUMMON_SPELLS = {
  'Summon Beast': {
    creature: 'Bestial Spirit', level: 2, forms: ['Air', 'Land', 'Water'], after: true,
    build: (L, n, form) => block({
      name: `Bestial Spirit (${form})`, size: 'Small', type: 'beast', ac: `${11 + L} (natural armor)`, hp: (form === 'Air' ? 20 : 30) + 5 * (L - 2),
      speed: form === 'Air' ? '30 ft., fly 60 ft.' : form === 'Land' ? '30 ft., climb 30 ft.' : '30 ft., swim 30 ft.', abilities: [18, 11, 16, 4, 14, 5],
      senses: 'darkvision 60 ft., passive Perception 12',
      traits: form === 'Air' ? [{ name: 'Flyby', desc: "It doesn't provoke opportunity attacks when it flies out of an enemy's reach." }]
        : [{ name: 'Pack Tactics', desc: 'It has advantage on an attack roll against a creature if at least one of its allies is within 5 ft. of that creature and isn\'t incapacitated.' },
          ...(form === 'Water' ? [{ name: 'Water Breathing', desc: 'It can breathe only underwater.' }] : [])],
      actions: [...multi(L, 'Rend'), { name: 'Rend', desc: attackLine({ toHit: n.attack, d: 8, plus: 4 + L, type: 'piercing' }) }],
    }),
  },
  'Summon Fey': {
    creature: 'Fey Spirit', level: 3, forms: ['Fuming', 'Mirthful', 'Tricksy'], after: true,
    build: (L, n, form) => block({
      name: `Fey Spirit (${form})`, size: 'Small', type: 'fey', ac: `${12 + L} (natural armor)`, hp: 30 + 10 * (L - 3), speed: '30 ft., fly 30 ft.',
      abilities: [13, 16, 14, 14, 11, 16], senses: 'darkvision 60 ft., passive Perception 10', conditionImmune: 'charmed',
      actions: [...multi(L, 'Fey Blade'), { name: 'Fey Blade', desc: attackLine({ toHit: n.attack, n: 2, d: 6, plus: 3 + L, type: 'force' }) }],
      reactions: [],
      traits: [{ name: 'Fey Step (bonus action)', desc: `It teleports up to 30 ft. to a space it can see. ${form === 'Fuming' ? 'It then has advantage on its next attack roll this turn.' : form === 'Mirthful' ? `One creature it can see within 10 ft. must succeed on a DC ${n.dc} Wisdom saving throw or be charmed by it and its summoner for 1 minute, or until it takes damage.` : 'It can fill a 10-foot cube within 5 ft. of it with magical darkness until the end of its next turn.'}` }],
    }),
  },
  'Summon Undead': {
    creature: 'Undead Spirit', level: 3, forms: ['Ghostly', 'Putrid', 'Skeletal'], after: true,
    build: (L, n, form) => block({
      name: `Undead Spirit (${form})`, size: 'Medium', type: 'undead', ac: `${11 + L} (natural armor)`, hp: (form === 'Skeletal' ? 20 : 30) + 10 * (L - 3),
      speed: form === 'Ghostly' ? '30 ft., fly 40 ft. (hover)' : '30 ft.', abilities: [12, 16, 15, 4, 10, 9], immune: 'necrotic, poison', conditionImmune: 'exhaustion, frightened, paralyzed, poisoned',
      senses: 'darkvision 60 ft., passive Perception 10',
      traits: form === 'Ghostly' ? [{ name: 'Incorporeal Passage', desc: 'It can move through creatures and objects as if they were difficult terrain; it takes 5 (1d10) force damage if it ends its turn inside an object.' }]
        : form === 'Putrid' ? [{ name: 'Festering Aura', desc: `Any creature other than its summoner that starts its turn within 5 ft. of it must succeed on a DC ${n.dc} Constitution saving throw or be poisoned until the start of its next turn.` }] : [],
      actions: [...multi(L, form === 'Ghostly' ? 'Deathly Touch' : form === 'Putrid' ? 'Rotting Claw' : 'Grave Bolt'),
        form === 'Ghostly' ? { name: 'Deathly Touch', desc: attackLine({ toHit: n.attack, d: 8, plus: 3 + L, type: 'necrotic', extra: `The target must succeed on a DC ${n.dc} Wisdom saving throw or be frightened until the end of its next turn.` }) }
        : form === 'Putrid' ? { name: 'Rotting Claw', desc: attackLine({ toHit: n.attack, d: 6, plus: 3 + L, type: 'slashing', extra: `If the target is poisoned, it must succeed on a DC ${n.dc} Constitution saving throw or be paralyzed until the end of its next turn.` }) }
        : { name: 'Grave Bolt', desc: attackLine({ ranged: true, range: 150, toHit: n.attack, n: 2, d: 4, plus: 3 + L, type: 'necrotic' }) }],
    }),
  },
  'Summon Construct': {
    creature: 'Construct Spirit', level: 4, forms: ['Clay', 'Metal', 'Stone'], after: true,
    build: (L, n, form) => block({
      name: `Construct Spirit (${form})`, size: 'Medium', type: 'construct', ac: `${13 + L} (natural armor)`, hp: 40 + 15 * (L - 4), speed: '30 ft.',
      abilities: [18, 10, 18, 14, 11, 5], resist: 'poison', conditionImmune: 'charmed, exhaustion, frightened, incapacitated, paralyzed, petrified, poisoned',
      senses: 'darkvision 60 ft., passive Perception 10',
      traits: form === 'Metal' ? [{ name: 'Heated Body', desc: 'A creature that touches it or hits it with a melee attack while within 5 ft. of it takes 5 (1d10) fire damage.' }]
        : form === 'Stone' ? [{ name: 'Stony Lethargy', desc: `When a creature it can see starts its turn within 10 ft. of it, it can force that creature to make a DC ${n.dc} Wisdom saving throw. On a failure, the target can't take reactions and its speed is halved until the start of its next turn.` }] : [],
      actions: [...multi(L, 'Slam'), { name: 'Slam', desc: attackLine({ toHit: n.attack, d: 8, plus: 4 + L, type: 'bludgeoning' }) }],
      reactions: form === 'Clay' ? [{ name: 'Berserk Lashing', desc: 'When it takes damage, it makes a Slam attack against a random creature within 5 ft. of it.' }] : [],
    }),
  },
  'Summon Aberration': {
    creature: 'Aberrant Spirit', level: 4, forms: ['Beholderkin', 'Mind Flayer', 'Slaad'], after: true,
    build: (L, n, form) => block({
      name: `Aberrant Spirit (${form})`, size: 'Medium', type: 'aberration', ac: `${11 + L} (natural armor)`, hp: 40 + 10 * (L - 4),
      speed: form === 'Beholderkin' ? '30 ft., fly 30 ft. (hover)' : '30 ft.', abilities: [16, 10, 15, 16, 10, 6], immune: 'psychic',
      senses: 'darkvision 60 ft., passive Perception 10',
      traits: form === 'Slaad' ? [{ name: 'Regeneration', desc: 'It regains 5 hit points at the start of its turn if it has at least 1 hit point.' }]
        : form === 'Mind Flayer' ? [{ name: 'Whispering Aura', desc: `At the start of each of its turns, each creature of its choice within 5 ft. of it must succeed on a DC ${n.dc} Wisdom saving throw or take 5 (2d4) psychic damage.` }] : [],
      actions: [...multi(L, form === 'Beholderkin' ? 'Eye Ray' : form === 'Mind Flayer' ? 'Psychic Slam' : 'Claws'),
        form === 'Beholderkin' ? { name: 'Eye Ray', desc: attackLine({ ranged: true, range: 150, toHit: n.attack, d: 8, plus: 3 + L, type: 'psychic' }) }
        : form === 'Mind Flayer' ? { name: 'Psychic Slam', desc: attackLine({ toHit: n.attack, d: 8, plus: 3 + L, type: 'psychic' }) }
        : { name: 'Claws', desc: attackLine({ toHit: n.attack, d: 10, plus: 3 + L, type: 'slashing' }) }],
    }),
  },
  'Summon Elemental': {
    creature: 'Elemental Spirit', level: 4, forms: ['Air', 'Earth', 'Fire', 'Water'], after: true,
    build: (L, n, form) => block({
      name: `Elemental Spirit (${form})`, size: 'Large', type: 'elemental', ac: `${11 + L} (natural armor)`, hp: 50 + 10 * (L - 4),
      speed: { Air: '40 ft., fly 40 ft. (hover)', Earth: '40 ft., burrow 40 ft.', Fire: '40 ft.', Water: '40 ft., swim 40 ft.' }[form], abilities: [18, 15, 17, 4, 10, 16],
      resist: { Air: 'lightning, thunder', Earth: 'piercing, slashing', Fire: '', Water: 'acid' }[form], immune: form === 'Fire' ? 'fire, poison' : 'poison',
      conditionImmune: 'exhaustion, paralyzed, petrified, poisoned, unconscious', senses: 'darkvision 60 ft., passive Perception 10',
      traits: form === 'Earth' ? [] : [{ name: 'Amorphous Form', desc: 'It can move through a space as narrow as 1 inch wide without squeezing.' }],
      actions: [...multi(L, 'Slam'), { name: 'Slam', desc: attackLine({ toHit: n.attack, d: 10, plus: 4 + L, type: form === 'Fire' ? 'fire' : 'bludgeoning' }) }],
    }),
  },
  'Summon Celestial': {
    creature: 'Celestial Spirit', level: 5, forms: ['Avenger', 'Defender'], after: true,
    build: (L, n, form) => block({
      name: `Celestial Spirit (${form})`, size: 'Large', type: 'celestial', ac: `${11 + L + (form === 'Defender' ? 2 : 0)} (natural armor)`, hp: 40 + 10 * (L - 5),
      speed: '30 ft., fly 40 ft.', abilities: [16, 14, 16, 10, 14, 16], resist: 'radiant', conditionImmune: 'charmed, frightened', senses: 'darkvision 60 ft., passive Perception 12',
      actions: [...multi(L, form === 'Avenger' ? 'Radiant Bow' : 'Radiant Mace'),
        form === 'Avenger' ? { name: 'Radiant Bow', desc: attackLine({ ranged: true, range: '150/600', toHit: n.attack, n: 2, d: 6, plus: 2 + L, type: 'radiant' }) }
        : { name: 'Radiant Mace', desc: attackLine({ toHit: n.attack, d: 10, plus: 3 + L, type: 'radiant', extra: 'It can then give itself or a creature it can see within 10 ft. 1d10 temporary hit points.' }) },
        { name: 'Healing Touch (1/Day)', desc: `It touches a creature, which regains ${dice(2, 8, L)} hit points.` }],
    }),
  },
  'Summon Dragon': {
    creature: 'Draconic Spirit', level: 5, forms: ['Chromatic', 'Metallic', 'Gem'], after: true,
    build: (L, n, form) => block({
      name: `Draconic Spirit (${form})`, size: 'Large', type: 'dragon', ac: `${14 + L} (natural armor)`, hp: 50 + 10 * (L - 5), speed: '30 ft., fly 60 ft., swim 30 ft.',
      abilities: [19, 14, 17, 10, 14, 14], resist: 'acid, cold, fire, lightning, poison', conditionImmune: 'charmed, frightened, poisoned',
      senses: 'blindsight 30 ft., darkvision 60 ft., passive Perception 12', languages: 'Draconic, understands the languages of its summoner',
      traits: [{ name: 'Shared Resistances', desc: 'Its summoner has resistance to one damage type the spirit resists, chosen when it is summoned.' }],
      actions: [...multi(L, 'Rend'), { name: 'Rend', desc: attackLine({ toHit: n.attack, reach: 10, d: 6, plus: 4 + L, type: 'piercing' }) },
        { name: 'Breath Weapon', desc: `It breathes in a 30-foot cone (it can do this in place of one of its attacks). Each creature there must make a DC ${n.dc} Dexterity saving throw, taking ${dice(2, 6)} damage of a type it resists on a failed save, or half as much on a successful one.` }],
    }),
  },
  'Summon Fiend': {
    creature: 'Fiendish Spirit', level: 6, forms: ['Demon', 'Devil', 'Yugoloth'], after: true,
    build: (L, n, form) => block({
      name: `Fiendish Spirit (${form})`, size: 'Large', type: 'fiend', ac: `${12 + L} (natural armor)`, hp: { Demon: 50, Devil: 40, Yugoloth: 60 }[form] + 15 * (L - 6),
      speed: { Demon: '40 ft., climb 40 ft.', Devil: '40 ft., fly 60 ft.', Yugoloth: '40 ft.' }[form], abilities: [13, 16, 15, 10, 10, 16],
      resist: 'fire', immune: 'poison', conditionImmune: 'poisoned', senses: 'darkvision 60 ft., passive Perception 10', languages: 'Abyssal, Infernal, telepathy 60 ft.',
      traits: [{ name: 'Magic Resistance', desc: 'It has advantage on saving throws against spells and other magical effects.' },
        ...(form === 'Demon' ? [{ name: 'Death Throes', desc: `When it drops to 0 hit points or the spell ends, it explodes: each creature within 10 ft. must make a DC ${n.dc} Dexterity saving throw, taking ${dice(2, 10, L)} fire damage on a failed save, or half as much on a successful one.` }] : []),
        ...(form === 'Devil' ? [{ name: "Devil's Sight", desc: 'Magical darkness doesn\'t stop its darkvision.' }] : [])],
      actions: [...multi(L, form === 'Demon' ? 'Bite' : form === 'Devil' ? 'Fiery Strike' : 'Claws'),
        form === 'Demon' ? { name: 'Bite', desc: attackLine({ toHit: n.attack, d: 12, plus: 3 + L, type: 'necrotic' }) }
        : form === 'Devil' ? { name: 'Fiery Strike', desc: attackLine({ both: true, range: 150, toHit: n.attack, n: 2, d: 6, plus: 3 + L, type: 'fire' }) }
        : { name: 'Claws', desc: attackLine({ toHit: n.attack, d: 8, plus: 3 + L, type: 'slashing', extra: 'After it attacks, it can teleport up to 30 ft. to a space it can see.' }) }],
    }),
  },
  'Giant Insect': {
    creature: 'Giant Insect', level: 4, forms: ['Centipede', 'Spider', 'Wasp'], after: true,
    build: (L, n, form) => block({
      name: `Giant ${form}`, size: 'Large', type: 'beast', ac: `${11 + L} (natural armor)`, hp: 30 + 10 * (L - 4),
      speed: form === 'Wasp' ? '40 ft., fly 40 ft.' : '40 ft., climb 40 ft.', abilities: [17, 13, 15, 4, 14, 3], senses: 'darkvision 60 ft., passive Perception 12',
      traits: form === 'Wasp' ? [] : [{ name: 'Spider Climb', desc: 'It can climb difficult surfaces, upside down on ceilings too, without an ability check.' }],
      actions: [...multi(L, 'Poison Jab'), { name: 'Poison Jab', desc: attackLine({ toHit: n.attack, reach: 10, d: 6, plus: 3 + L, type: 'piercing', extra: `It also deals 1d4 poison damage.${form === 'Centipede' ? ` The target must succeed on a DC ${n.dc} Constitution saving throw or be poisoned until the start of its summoner's next turn.` : ''}` }) },
        ...(form === 'Spider' ? [{ name: 'Web Bolt', desc: attackLine({ ranged: true, range: 60, toHit: n.attack, d: 10, plus: 3 + L, type: 'bludgeoning', extra: "The target's speed is 0 until the start of the spider's next turn." }) }] : [])],
    }),
  },
  'Find Steed': {
    creature: 'Otherworldly Steed', level: 2, forms: ['Celestial', 'Fey', 'Fiend'], after: true, mount: true, lasting: true,
    build: (L, n, form) => block({
      name: `Otherworldly Steed (${form})`, size: 'Large', type: form.toLowerCase(), ac: `${10 + L} (natural armor)`, hp: 5 + 10 * L,
      speed: L >= 4 ? '60 ft., fly 60 ft.' : '60 ft.', abilities: [18, 12, 14, 6, 12, 8], senses: 'passive Perception 11', languages: 'telepathy 1 mile (with its summoner only)',
      traits: [{ name: 'Life Bond', desc: 'When its summoner regains hit points from a spell of level 1 or higher, the steed regains the same number if it is within 5 ft. of them.' }],
      actions: [{ name: 'Otherworldly Slam', desc: attackLine({ toHit: n.attack, d: 8, plus: L, type: { Celestial: 'radiant', Fey: 'psychic', Fiend: 'necrotic' }[form] }) },
        { name: form === 'Celestial' ? 'Healing Touch (1/Day, bonus action)' : form === 'Fey' ? 'Fey Step (bonus action)' : 'Fell Glare (bonus action)',
          desc: form === 'Celestial' ? `It touches a creature within 5 ft., which regains ${dice(2, 8, L)} hit points.` : form === 'Fey' ? 'It teleports, with its rider, to a space it can see within 60 ft.'
            : `A creature it can see within 60 ft. must succeed on a DC ${n.dc} Wisdom saving throw or be frightened of it until the end of its next turn.` }],
    }),
  },
};
/** Find Familiar's forms, those the bestiary has. */
export const FAMILIARS = ['Bat', 'Cat', 'Crab', 'Frog', 'Hawk', 'Lizard', 'Octopus', 'Owl', 'Poisonous Snake', 'Quipper', 'Rat', 'Raven', 'Sea Horse', 'Spider', 'Weasel'];
/** Spells that bring creatures straight from the bestiary: the choices, how many, how long and whether they share the caster's turn. */
export const BESTIARY_SUMMONS = {
  'Find Familiar': { level: 1, choices: FAMILIARS, count: () => 1, lasting: true, note: 'It acts on its own initiative and can\'t attack, but can take other actions.' },
  'Animate Dead': { level: 3, choices: ['Skeleton', 'Zombie'], count: L => 1 + 2 * (L - 3), lasting: true, note: 'Each obeys its creator for 24 hours; a bonus action commands any of them.' },
  'Create Undead': { level: 6, choices: L => L >= 9 ? ['Ghoul', 'Ghast', 'Wight', 'Mummy'] : L >= 8 ? ['Ghoul', 'Ghast', 'Wight'] : ['Ghoul'], count: L => L - 3, lasting: true, note: 'Each obeys its creator for 24 hours.' },
  'Phantom Steed': { level: 3, choices: ['Riding Horse'], count: () => 1, lasting: true, after: true, mount: true, rename: 'Phantom Steed', speed: '100 ft.', note: 'A quasi-real horse; it vanishes if it takes any damage.' },
  'Find Greater Steed': { level: 4, choices: ['Griffon', 'Pegasus', 'Dire Wolf', 'Rhinoceros', 'Saber-Toothed Tiger'], count: () => 1, lasting: true, after: true, mount: true },
  'Animate Objects': { level: 5, choices: ['Animated Object'], count: () => 1, custom: true },
};

/** Whether a spell summons something the battle screen can bring in. */
export const summonSpell = name => SUMMON_SPELLS[name] || BESTIARY_SUMMONS[name] || null;

/** Animate Objects (2024): one animated object of a size, with the caster's numbers. */
export function animatedObject(size, L, n) {
  const big = { Huge: [2, 12, 40], Large: [2, 6, 20] }[size] || [1, 4, 10];
  return block({
    name: `Animated Object (${size})`, size, type: 'construct', ac: '15 (natural armor)', hp: big[2], speed: '30 ft.', abilities: [16, 10, 10, 3, 3, 1],
    immune: 'poison, psychic', conditionImmune: 'charmed, exhaustion, frightened, paralyzed, poisoned', senses: 'blindsight 30 ft., passive Perception 6',
    actions: [{ name: 'Slam', desc: attackLine({ toHit: n.attack, n: big[0] + Math.max(0, L - 5), d: big[1], plus: n.mod || 3, type: 'force' }) }],
  });
}

// ----- class features -----

/** The Battle Smith's Steel Defender, from the artificer's level, Intelligence modifier, proficiency bonus and spell attack. */
export function steelDefender({ level = 3, int = 0, pb = 2, attack = 4 }) {
  return block({
    name: 'Steel Defender', size: 'Medium', type: 'construct', ac: '15 (natural armor)', hp: 2 + int + 5 * level, speed: '40 ft.', abilities: [14, 12, 14, 4, 10, 6],
    saves: `Dex ${signed(1 + pb)}, Con ${signed(2 + pb)}`, skills: `Athletics ${signed(2 + pb)}, Perception ${signed(2 * pb)}`, immune: 'poison', conditionImmune: 'charmed, exhaustion, poisoned',
    senses: `darkvision 60 ft., passive Perception ${10 + 2 * pb}`, languages: 'understands the languages of its maker',
    traits: [{ name: 'Vigilant', desc: "It can't be surprised." }, { name: 'Dodge unless commanded', desc: 'On its turn it takes the Dodge action unless its maker spends a bonus action to command another action.' }],
    actions: [{ name: 'Force-Empowered Rend', desc: attackLine({ toHit: attack, d: 8, plus: 2 + pb, type: 'force' }) },
      { name: 'Repair (3/Day)', desc: `It restores ${dice(2, 8, pb)} hit points to itself or to one construct or object within 5 ft.` }],
    reactions: [{ name: 'Deflect Attack', desc: 'When a creature it can see within 5 ft. attacks someone other than the defender, it gives that attack disadvantage.' }],
  });
}
/** The Beast Master's Primal Companion (2024): a beast of the land, sea or sky from the ranger's level, Wisdom modifier and spell numbers. */
export function primalCompanion(form, { level = 3, wis = 0, attack = 4, dc = 12 }) {
  const sky = form === 'Sky';
  return block({
    name: `Beast of the ${form}`, size: sky ? 'Small' : 'Medium', type: 'beast', ac: `${13 + wis} (natural armor)`, hp: sky ? 4 + 4 * level : 5 + 5 * level,
    speed: { Land: '40 ft., climb 40 ft.', Sea: '5 ft., swim 60 ft.', Sky: '10 ft., fly 60 ft.' }[form],
    abilities: sky ? [6, 16, 13, 8, 14, 11] : [14, 14, 15, 8, 14, 11], senses: 'darkvision 60 ft., passive Perception 12', languages: 'understands the languages of its ranger',
    traits: [{ name: 'Primal Bond', desc: "It adds its ranger's proficiency bonus to any ability check or saving throw it makes." },
      ...(form === 'Land' ? [{ name: 'Charge', desc: `If it moves at least 20 ft. straight toward a target and then hits it with a Beast's Strike attack on the same turn, the target takes an extra 3 (1d6) piercing damage. If the target is a creature, it must succeed on a DC ${dc} Strength saving throw or be knocked prone.` }] : []),
      ...(form === 'Sea' ? [{ name: 'Amphibious', desc: 'It can breathe air and water.' }] : []),
      ...(sky ? [{ name: 'Flyby', desc: "It doesn't provoke opportunity attacks when it flies out of an enemy's reach." }] : [])],
    actions: [{ name: "Beast's Strike", desc: attackLine({ toHit: attack, d: sky ? 4 : form === 'Sea' ? 6 : 8, plus: (sky ? 3 : 2) + wis, type: sky ? 'slashing' : form === 'Sea' ? 'bludgeoning' : 'piercing',
      extra: form === 'Sea' ? `The target is grappled (escape DC ${dc}).` : '' }) }],
  });
}

/** A creature typed in by hand (a custom Wild Shape form or summon): its AC, HP, speed and one attack. */
export function customCreature({ name, size = 'Medium', type = 'beast', ac = 12, hp = 10, speed = '30 ft.', attack = '', toHit = 4, damage = '1d6 + 2', dmgType = 'bludgeoning' }) {
  const m = String(damage).match(/(\d+)d(\d+)(?:\s*([+-])\s*(\d+))?/);
  const actions = attack && m ? [{ name: attack, desc: attackLine({ toHit: Number(toHit) || 0, n: Number(m[1]), d: Number(m[2]), plus: (m[3] === '-' ? -1 : 1) * Number(m[4] || 0), type: dmgType || 'bludgeoning' }) }] : [];
  return block({ name, size, type, ac: String(ac), hp: Number(hp) || 1, speed, abilities: [10, 10, 10, 10, 10, 10], actions, custom: true });
}

// ----- Wild Shape (2024) -----

/** What a druid's Wild Shape allows at a level: the highest CR, whether flying forms are allowed, temporary HP, hours, uses and forms known. */
export function wildShapeLimits(level, subclass = '', wis = 0) {
  const moon = /moon/i.test(subclass || '') && level >= 3;
  const base = level >= 8 ? 1 : level >= 4 ? 0.5 : 0.25;
  return {
    moon, maxCr: moon ? Math.max(1, Math.floor(level / 3)) : base, fly: level >= 8,
    temp: moon ? 3 * level : level, hours: Math.max(1, Math.floor(level / 2)), uses: level >= 17 ? 4 : level >= 6 ? 3 : 2,
    known: level >= 8 ? 8 : level >= 4 ? 6 : 4, acMin: moon ? 13 + wis : 0,
  };
}
const flies = m => /\bfly\b/i.test(String(m.speed || ''));
/** Whether a beast is within a druid's Wild Shape limits, and if not, why. */
export function wildShapeFits(m, lim) {
  if (!/^beast/i.test(String(m.type || ''))) return 'not a beast';
  if ((Number(m.cr) || 0) > lim.maxCr) return `CR ${m.cr} is over ${lim.maxCr}`;
  if (flies(m) && !lim.fly) return 'it flies (allowed from druid level 8)';
  return '';
}

// ----- mounts and riders -----

export const SIZES = ['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan'];
export const sizeRank = size => Math.max(0, SIZES.indexOf(String(size || 'Medium').split(' ')[0]));
/** A mount must be at least one size larger than its rider. */
export const canCarry = (mountSize, riderSize) => sizeRank(mountSize) > sizeRank(riderSize);
/** Creatures in the bestiary that make sensible mounts: beasts or monstrosities, not clever, that walk or fly. */
export function mountCandidates(monsters, riderSize = 'Medium') {
  return Object.values(monsters || {}).filter(m => /^(beast|monstrosity)/i.test(String(m.type || '')) && canCarry(m.size, riderSize) && sizeRank(m.size) <= 4
    && (Number((m.abilities || [])[3]) || 10) <= 7 && Number(String(m.speed || '').match(/^(\d+)/)?.[1] || 0) >= 30 && !/swim/i.test(String(m.speed || '').split(',')[0]));
}
// Mounts that suit humanoid riders: the usual steeds first, by the rider's size.
const STEEDS = { Small: ['Wolf', 'Mastiff', 'Pony', 'Giant Lizard', 'Giant Goat', 'Giant Badger', 'Boar'], Medium: ['Riding Horse', 'Warhorse', 'Giant Lizard', 'Dire Wolf', 'Elk', 'Camel', 'Giant Boar', 'Giant Elk', 'Hippogriff', 'Griffon', 'Giant Goat'] };
/** A mount for a humanoid enemy: a usual steed of fitting size, not much stronger than its rider. */
export function pickMount(monsters, rider, rng = Math.random) {
  const size = String(rider.size || 'Medium');
  const cap = Math.max(1, (Number(rider.cr) || 0) + 1);
  const named = (STEEDS[size] || STEEDS.Medium).map(n => monsters?.[n.toLowerCase()]).filter(m => m && (Number(m.cr) || 0) <= cap);
  const pool = named.length ? named : mountCandidates(monsters, size).filter(m => (Number(m.cr) || 0) <= cap);
  return pool.length ? pool[Math.floor(rng() * pool.length)] : null;
}
/** Whether a stat block is a humanoid that could ride: Small or Medium. */
export const couldRide = m => /^humanoid/i.test(String(m?.type || '')) && ['Small', 'Medium'].includes(String(m?.size || ''));

/**
 * A creature's charges: a trait like Trampling Charge or Pounce that adds to one of its attacks after a run-up.
 * Each: { trait, action, distance, extra: {expr, type} | null, save: {dc, ability} | null, prone }.
 */
export function chargesOf(m) {
  const out = [];
  for (const t of m?.traits || []) {
    const d = String(t.desc || '');
    const run = d.match(/moves? at least (\d+) (?:ft\.?|feet)/i);
    const hit = d.match(/hits? (?:it|the target|a creature|that creature)? ?with an? ([\w']+(?: [\w']+)?) attack/i);
    if (!run || !hit) continue;
    const word = hit[1].toLowerCase().replace(/^(\w+?)s?\b.*$/, '$1');
    const action = (m.actions || []).find(a => a.name.toLowerCase().startsWith(word) || a.name.toLowerCase().replace(/s$/, '').startsWith(word));
    if (!action) continue;
    const extra = d.match(/extra \d+ \((\d+d\d+(?:\s*[+-]\s*\d+)?)\)\s*(\w+)? damage/i);
    const save = d.match(/DC (\d+) (Strength|Dexterity|Constitution) saving throw/i);
    out.push({ trait: t.name, action: action.name, distance: Number(run[1]), extra: extra ? { expr: extra[1].replace(/\s+/g, ' '), type: (extra[2] || '').toLowerCase() } : null,
      save: save ? { dc: Number(save[1]), ability: save[2] } : null, prone: /prone/i.test(d) });
  }
  return out;
}

/** Traits and actions a creature can't use while it rides: they need its own legs (a run-up, a leap, climbing, burrowing). */
export const needsOwnLegs = entry => /moves? at least \d+ (?:ft|feet)|\b(pounce|charge|trampl\w*|standing leap|running leap|spider climb|burrow\w*)\b/i.test(`${entry?.name || ''} ${entry?.desc || ''}`)
  && !/\bmount\b/i.test(entry?.desc || '');

export { mod as abilityModOf };
