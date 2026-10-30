// Class reference: each class's core traits, its level table and what every class and subclass feature does, as
// the Player's Handbook (2024) lays them out, written in short. The class pages in the wiki are built from this
// (tools/build_classes.mjs), and stat blocks and PDF sheets list the features a character has at their level.
// Artificer is not in the Player's Handbook; it follows Tasha's Cauldron of Everything, like its infusions.

// Features are written one per line: "level|Name|what it does".
const feats = text => text.trim().split('\n').map(l => l.trim()).filter(Boolean).map(l => {
  const [level, name, ...rest] = l.split('|');
  return { level: Number(level), name: name.trim(), text: rest.join('|').trim() };
});
// A per-level column from a [[level, value], …] table.
const col = table => Array.from({ length: 20 }, (_, i) => table.reduce((v, [l, x]) => i + 1 >= l ? x : v, '—'));
const byLevel = (...xs) => xs.map(String);

const ASI = 'Ability Score Improvement';
const SUB = 'Subclass feature';
const ASI_TEXT = 'Take the Ability Score Improvement feat (+2 to one score or +1 to two) or another feat you qualify for.';
const BOON_TEXT = 'Take an Epic Boon feat or another feat you qualify for.';

// Spell slots by level for each kind of caster: [1st, 2nd, … 9th] at each class level.
const FULL_SLOTS = [
  [2], [3], [4, 2], [4, 3], [4, 3, 2], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 2], [4, 3, 3, 3, 1], [4, 3, 3, 3, 2],
  [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1, 1], [4, 3, 3, 3, 3, 1, 1, 1, 1], [4, 3, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 3, 2, 2, 1, 1],
];
const HALF_SLOTS = [
  [2], [2], [3], [3], [4, 2], [4, 2], [4, 3], [4, 3], [4, 3, 2], [4, 3, 2], [4, 3, 3], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 1],
  [4, 3, 3, 2], [4, 3, 3, 2], [4, 3, 3, 3, 1], [4, 3, 3, 3, 1], [4, 3, 3, 3, 2], [4, 3, 3, 3, 2],
];
// Eldritch knights and arcane tricksters, from 3rd level.
export const THIRD_SLOTS = [
  [], [], [2], [3], [3], [3], [4, 2], [4, 2], [4, 2], [4, 3], [4, 3], [4, 3], [4, 3, 2], [4, 3, 2], [4, 3, 2], [4, 3, 3],
  [4, 3, 3], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 1],
];
const slotCols = (slots, upTo) => Object.fromEntries(Array.from({ length: upTo }, (_, i) => [['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th'][i], slots.map(s => s[i] ? String(s[i]) : '—')]));
const FULL_PREPARED = byLevel(4, 5, 6, 7, 9, 10, 11, 12, 14, 15, 16, 16, 17, 17, 18, 18, 19, 20, 21, 22);
const HALF_PREPARED = byLevel(2, 3, 4, 5, 6, 6, 7, 7, 9, 9, 10, 10, 11, 11, 12, 12, 14, 14, 15, 15);

export const CLASSES = {
  Artificer: {
    intro: 'Inventors who channel magic through tools and objects. An artificer sees magic as a craft: their spells come from tinkered devices, and they lend that magic to the gear their friends carry.',
    source: "Tasha's Cauldron of Everything",
    core: {
      'Primary Ability': 'Intelligence', 'Hit Point Die': 'D8 per Artificer level', 'Saving Throw Proficiencies': 'Constitution and Intelligence',
      'Skill Proficiencies': 'Choose 2: Arcana, History, Investigation, Medicine, Nature, Perception or Sleight of Hand',
      'Weapon Proficiencies': 'Simple weapons', 'Tool Proficiencies': "Thieves' Tools, Tinker's Tools and one kind of Artisan's Tools",
      'Armor Training': 'Light and Medium armor and Shields',
      'Starting Equipment': "Two simple weapons, a Light Crossbow and 20 Bolts, Studded Leather Armor or Scale Mail, Thieves' Tools and a Dungeoneer's Pack",
    },
    columns: {
      'Infusions Known': col([[2, 4], [6, 6], [10, 8], [14, 10], [18, 12]]), 'Infused Items': col([[2, 2], [6, 3], [10, 4], [14, 5], [18, 6]]),
      Cantrips: col([[1, 2], [10, 3], [14, 4]]), ...slotCols(HALF_SLOTS, 5),
    },
    features: feats(`
      1|Magical Tinkering|Touch a Tiny nonmagical object to give it one small magical property: light, a recorded message, a lasting smell or sound, or a still image. You keep as many going as your Intelligence modifier.
      1|Spellcasting|You prepare artificer spells with Intelligence, using tools as your spellcasting focus. You prepare your Intelligence modifier plus half your artificer level each long rest.
      2|Infuse Item|After a long rest, turn ordinary objects into magic items with the infusions you know. An infusion lasts until you replace it, and you can keep only so many infused items at once.
      3|Artificer Subclass|Choose a specialism: Alchemist, Armorer, Artillerist or Battle Smith.
      3|The Right Tool for the Job|With an hour's work and tinker's tools, make one set of artisan's tools you need.
      4|${ASI}|${ASI_TEXT}
      5|${SUB}|A feature from your specialism.
      6|Tool Expertise|Double your proficiency bonus on any ability check that uses a tool.
      7|Flash of Genius|Reaction: add your Intelligence modifier to an ability check or saving throw made by you or someone you can see within 30 feet. Uses equal to your Intelligence modifier per long rest.
      8|${ASI}|${ASI_TEXT}
      9|${SUB}|A feature from your specialism.
      10|Magic Item Adept|Attune to up to four magic items, and craft common and uncommon items in a quarter of the time for half the cost.
      11|Spell-Storing Item|Store a 1st- or 2nd-level artificer spell in a weapon or focus. Whoever holds it can cast the spell with your numbers, a number of times equal to twice your Intelligence modifier.
      12|${ASI}|${ASI_TEXT}
      14|Magic Item Savant|Attune to up to five magic items, and ignore class, species, spell and level requirements on items.
      15|${SUB}|A feature from your specialism.
      16|${ASI}|${ASI_TEXT}
      18|Magic Item Master|Attune to up to six magic items.
      19|${ASI}|${ASI_TEXT}
      20|Soul of Artifice|+1 to all saving throws for each item you're attuned to. If you drop to 0 hit points, end an infusion to drop to 1 instead.
    `),
    subclasses: {
      Alchemist: {
        intro: 'An expert at mixing reagents into elixirs that heal, strengthen and protect.',
        spells: { 3: ['Healing Word', 'Ray of Sickness'], 5: ['Flaming Sphere', "Melf's Acid Arrow"], 9: ['Gaseous Form', 'Mass Healing Word'], 13: ['Blight', 'Death Ward'], 17: ['Cloudkill', 'Raise Dead'] },
        features: feats(`
          3|Tool Proficiency|Proficiency with alchemist's supplies.
          3|Alchemist Spells|You always have the Alchemist spells prepared at the levels shown.
          3|Experimental Elixir|After a long rest, make a random elixir in an empty flask (more at 6th, 9th and 15th level): healing, swiftness, resilience, boldness, flight or transformation. You can also spend a spell slot to make one you choose.
          5|Alchemical Savant|Add your Intelligence modifier to one roll of a spell's acid, fire, necrotic or poison damage, or its healing, when you cast it with alchemist's supplies.
          9|Restorative Reagents|Your elixirs also give temporary hit points (2d6 + Intelligence modifier). Cast Lesser Restoration without a slot, your Intelligence modifier times per long rest.
          15|Chemical Mastery|Resistance to acid and poison, immunity to the poisoned condition. Cast Greater Restoration and Heal once each per long rest without a slot.
        `),
      },
      Armorer: {
        intro: 'An artificer who rebuilds their armour into a second skin of magic.',
        spells: { 3: ['Magic Missile', 'Thunderwave'], 5: ['Mirror Image', 'Shatter'], 9: ['Hypnotic Pattern', 'Lightning Bolt'], 13: ['Fire Shield', 'Greater Invisibility'], 17: ['Passwall', 'Wall of Force'] },
        features: feats(`
          3|Tools of the Trade|Heavy armor training and proficiency with smith's tools.
          3|Armorer Spells|You always have the Armorer spells prepared at the levels shown.
          3|Arcane Armor|Turn worn armour into Arcane Armor: no Strength requirement, it covers missing limbs, it doubles as a spellcasting focus, and you don and doff it as an action.
          3|Armor Model|Pick a model each long rest. Guardian: Thunder Gauntlets (1d8 thunder, the target has disadvantage against anyone else) and a Defensive Field of temporary hit points. Infiltrator: a Lightning Launcher (1d6 lightning, 90 feet, extra 1d6 once a turn), +5 speed and advantage on Stealth.
          5|Extra Attack|Attack twice when you take the Attack action.
          9|Armor Modifications|Your armour counts as separate items for infusions (armour, boots, helmet, weapon), and you can infuse two more items as long as they are parts of it.
          15|Perfected Armor|Guardian: reaction to pull a Large or smaller creature 25 feet toward you and attack it. Infiltrator: a creature hit by your launcher glows, and the next attack on it has advantage and deals 1d6 lightning more.
        `),
      },
      Artillerist: {
        intro: 'A specialist in magical cannons and blasting wands.',
        spells: { 3: ['Shield', 'Thunderwave'], 5: ['Scorching Ray', 'Shatter'], 9: ['Fireball', 'Wind Wall'], 13: ['Ice Storm', 'Wall of Fire'], 17: ['Cone of Cold', 'Wall of Force'] },
        features: feats(`
          3|Tool Proficiency|Proficiency with woodcarver's tools.
          3|Artillerist Spells|You always have the Artillerist spells prepared at the levels shown.
          3|Eldritch Cannon|Make a Small or Tiny cannon that lasts an hour: a flamethrower (2d8 fire in a 15-foot cone, Dex save), a force ballista (2d8 force, pushes 5 feet) or a protector (1d8 + Int temporary hit points to those near it). Activate it as a bonus action. Once per long rest, or by spending a spell slot.
          5|Arcane Firearm|Carve a wand, staff or rod into a firearm: spells cast through it deal 1d8 extra damage on one roll.
          9|Explosive Cannon|Cannon damage rises by 1d8, and you can detonate it for 3d8 force in a 20-foot radius.
          15|Fortified Position|Run two cannons at once, and you and allies near a cannon have half cover.
        `),
      },
      'Battle Smith': {
        intro: 'A soldier-engineer who fights beside a mechanical defender of their own making.',
        spells: { 3: ['Heroism', 'Shield'], 5: ['Branding Smite', 'Warding Bond'], 9: ['Aura of Vitality', 'Conjure Barrage'], 13: ['Aura of Purity', 'Fire Shield'], 17: ['Banishing Smite', 'Mass Cure Wounds'] },
        features: feats(`
          3|Tool Proficiency|Proficiency with smith's tools.
          3|Battle Smith Spells|You always have the Battle Smith spells prepared at the levels shown.
          3|Battle Ready|Martial weapon proficiency, and you can attack with Intelligence using magic weapons.
          3|Steel Defender|A loyal construct companion that acts on your turn: it attacks (1d8 + 2 + PB force), repairs itself, and uses its reaction to give an attacker disadvantage against someone next to it.
          5|Extra Attack|Attack twice when you take the Attack action.
          9|Arcane Jolt|Once a turn when you or your defender hit with a magic weapon or its force attack, deal 2d6 force more or heal a creature 2d6. Intelligence modifier uses per long rest.
          15|Improved Defender|Arcane Jolt becomes 4d6, the defender gets +2 AC, and its deflection deals 1d4 + Int force to the attacker.
        `),
      },
    },
  },

  Barbarian: {
    intro: 'Fierce warriors driven by a primal rage. Barbarians shrug off blows that would fell others, charge in recklessly and hit harder the angrier they get.',
    core: {
      'Primary Ability': 'Strength', 'Hit Point Die': 'D12 per Barbarian level', 'Saving Throw Proficiencies': 'Strength and Constitution',
      'Skill Proficiencies': 'Choose 2: Animal Handling, Athletics, Intimidation, Nature, Perception or Survival',
      'Weapon Proficiencies': 'Simple and Martial weapons', 'Armor Training': 'Light and Medium armor and Shields',
      'Starting Equipment': "Choose A or B: (A) Greataxe, 4 Handaxes, Explorer's Pack and 15 GP; or (B) 75 GP",
    },
    columns: { Rages: col([[1, 2], [3, 3], [6, 4], [12, 5], [17, 6]]), 'Rage Damage': col([[1, '+2'], [9, '+3'], [16, '+4']]), 'Weapon Mastery': col([[1, 2], [4, 3], [10, 4]]) },
    features: feats(`
      1|Rage|Bonus action, not in heavy armour: for up to 10 minutes, resistance to bludgeoning, piercing and slashing damage, extra damage on Strength attacks (the Rage Damage column), and advantage on Strength checks and saves. No spells or concentration. It ends early if you don a heavy armour or are incapacitated. Uses per long rest from the Rages column; a short rest gives one back.
      1|Unarmored Defense|Without armour, AC is 10 + Dexterity + Constitution modifiers. A shield still counts.
      1|Weapon Mastery|Use the mastery properties of the weapons shown in the Weapon Mastery column, swapped after a long rest.
      2|Danger Sense|Advantage on Dexterity saves unless incapacitated.
      2|Reckless Attack|On your first attack each turn, take advantage on Strength attacks this turn; attacks against you have advantage until your next turn.
      3|Barbarian Subclass|Choose a path: Berserker, Wild Heart, World Tree or Zealot.
      3|Primal Knowledge|One more barbarian skill, and while raging you can make some checks (Acrobatics, Intimidation, Perception, Stealth, Survival) with Strength.
      4|${ASI}|${ASI_TEXT}
      5|Extra Attack|Attack twice when you take the Attack action.
      5|Fast Movement|+10 feet speed without heavy armour.
      6|${SUB}|A feature from your path.
      7|Feral Instinct|Advantage on initiative rolls.
      7|Instinctive Pounce|When you rage, move up to half your speed as part of it.
      8|${ASI}|${ASI_TEXT}
      9|Brutal Strike|While Reckless, give up advantage on one Strength attack to add 1d10 damage on a hit plus an effect: Forceful Blow (push 15 feet) or Hamstring Blow (−15 feet speed).
      10|${SUB}|A feature from your path.
      11|Relentless Rage|Dropping to 0 hit points while raging, make a DC 10 Constitution save (rising by 5 each time) to drop to twice your barbarian level instead.
      12|${ASI}|${ASI_TEXT}
      13|Improved Brutal Strike|New Brutal Strike effects: Staggering Blow (disadvantage on its next save, no opportunity attacks) or Sundering Blow (+5 to the next attack on it by someone else).
      14|${SUB}|A feature from your path.
      15|Persistent Rage|Roll initiative to regain all rage uses once per long rest, and rage lasts 10 minutes without needing to be kept up.
      16|${ASI}|${ASI_TEXT}
      17|Improved Brutal Strike|Brutal Strike deals 2d10, and you can use two effects at once.
      18|Indomitable Might|A Strength check or save that totals less than your Strength score uses the score instead.
      19|Epic Boon|${BOON_TEXT}
      20|Primal Champion|Strength and Constitution go up by 4, to a maximum of 25.
    `),
    subclasses: {
      'Path of the Berserker': {
        intro: 'Rage as untamed violence.',
        features: feats(`
          3|Frenzy|While raging and Reckless, the first target you hit with a Strength attack each turn takes extra damage: as many d6s as your Rage Damage bonus.
          6|Mindless Rage|Immune to charmed and frightened while raging; rage ends such effects already on you.
          10|Retaliation|Reaction when a creature within 5 feet damages you: make a melee attack against it.
          14|Intimidating Presence|Bonus action: creatures of your choice in a 30-foot emanation make a Wisdom save (DC 8 + Str + PB) or are frightened for a minute. Once per long rest, or by spending a rage use.
        `),
      },
      'Path of the Wild Heart': {
        intro: 'Rage as a bond with the beasts of the wild.',
        features: feats(`
          3|Animal Speaker|Cast Beast Sense and Speak with Animals as rituals.
          3|Rage of the Wilds|Each time you rage, choose Bear (resist every damage but force, necrotic, psychic and radiant), Eagle (Disengage and Dash as a bonus action) or Wolf (allies have advantage on attacks against enemies next to you).
          6|Aspect of the Wilds|After a long rest choose Owl (60-foot darkvision), Panther (climb speed) or Salmon (swim speed).
          10|Nature Speaker|Cast Commune with Nature as a ritual.
          14|Power of the Wilds|Each time you rage choose Falcon (fly speed without armour), Lion (enemies next to you have disadvantage attacking others) or Ram (your Strength hits knock Large or smaller foes prone).
        `),
      },
      'Path of the World Tree': {
        intro: 'Rage drawn from the cosmic tree that binds the planes.',
        features: feats(`
          3|Vitality of the Tree|When you rage, gain temporary hit points equal to your barbarian level. At the start of each raging turn, give an ally within 10 feet temporary hit points (as many d6s as your Rage Damage bonus).
          6|Branches of the Tree|Reaction while raging: a creature within 30 feet makes a Strength save or is pulled to a space next to you and its speed drops to 0.
          10|Battering Roots|Your reach grows by 10 feet with Heavy or Versatile melee weapons, and you can apply Push or Topple on top of the weapon's mastery.
          14|Travel along the Tree|Bonus action while raging: teleport 60 feet; once per rage, teleport 150 feet with up to six willing creatures.
        `),
      },
      'Path of the Zealot': {
        intro: 'Rage as a gift of a god.',
        features: feats(`
          3|Divine Fury|While raging, the first creature you hit each turn takes 1d6 + half your barbarian level necrotic or radiant damage.
          3|Warrior of the Gods|A pool of four d12s (more at higher levels) to heal yourself as a bonus action, restored on a long rest.
          6|Fanatical Focus|Once per rage, reroll a failed saving throw with a bonus equal to your Rage Damage.
          10|Zealous Presence|Bonus action: up to ten creatures in 60 feet get advantage on attacks and saves until your next turn. Once per long rest, or by spending a rage use.
          14|Rage of the Gods|Once per long rest, rage as a divine warrior for a minute: fly speed, resistance to necrotic, psychic and radiant, and a reaction to spend a rage use and keep someone at 0 hit points on their feet with hit points equal to your barbarian level.
        `),
      },
    },
  },

  Bard: {
    intro: 'Performers whose music, words and stories carry magic. Bards inspire their friends, unsettle their foes and know a little of everything.',
    core: {
      'Primary Ability': 'Charisma', 'Hit Point Die': 'D8 per Bard level', 'Saving Throw Proficiencies': 'Dexterity and Charisma',
      'Skill Proficiencies': 'Choose any 3 skills', 'Weapon Proficiencies': 'Simple weapons', 'Tool Proficiencies': 'Choose 3 Musical Instruments',
      'Armor Training': 'Light armor',
      'Starting Equipment': "Choose A or B: (A) Leather Armor, 2 Daggers, a Musical Instrument of your choice, Entertainer's Pack and 19 GP; or (B) 90 GP",
    },
    columns: {
      'Bardic Die': col([[1, 'd6'], [5, 'd8'], [10, 'd10'], [15, 'd12']]), Cantrips: col([[1, 2], [4, 3], [10, 4]]), 'Prepared Spells': FULL_PREPARED,
      ...slotCols(FULL_SLOTS, 9),
    },
    features: feats(`
      1|Bardic Inspiration|Bonus action: a creature within 60 feet gets a Bardic Inspiration die to add to one failed d20 test in the next hour. Uses equal to your Charisma modifier per long rest.
      1|Spellcasting|You cast bard spells with Charisma, using a musical instrument as a focus. Swap one cantrip or prepared spell when you gain a level.
      2|Expertise|Expertise in two skills you're proficient in.
      2|Jack of All Trades|Add half your proficiency bonus to ability checks that don't already include it.
      3|Bard Subclass|Choose a college: Dance, Glamour, Lore or Valor.
      4|${ASI}|${ASI_TEXT}
      5|Font of Inspiration|Bardic Inspiration comes back on a short rest too, and you can spend a spell slot to regain a use.
      6|${SUB}|A feature from your college.
      7|Countercharm|Reaction when a creature within 30 feet fails a save against charm or fear: it rerolls with advantage.
      8|${ASI}|${ASI_TEXT}
      9|Expertise|Expertise in two more skills.
      10|Magical Secrets|Prepare spells from the bard, cleric, druid and wizard lists; they count as bard spells.
      12|${ASI}|${ASI_TEXT}
      14|${SUB}|A feature from your college.
      16|${ASI}|${ASI_TEXT}
      18|Superior Inspiration|When you roll initiative, regain Bardic Inspiration up to two uses.
      19|Epic Boon|${BOON_TEXT}
      20|Words of Creation|Power Word Heal and Power Word Kill are always prepared, and each can target a second creature.
    `),
    subclasses: {
      'College of Dance': {
        intro: 'Bards whose art is movement.',
        features: feats(`
          3|Dazzling Footwork|Without armour or a shield: advantage on Performance to dance, AC 10 + Dex + Cha, unarmed strikes with Dexterity that deal your Bardic die, and spending inspiration on a strike in place of a die roll.
          6|Inspiring Movement|Reaction when an enemy ends its turn near you: spend a Bardic die to move half your speed, and an ally can move too, without provoking.
          6|Tandem Footwork|When you roll initiative, spend a Bardic die to add it to your initiative and that of allies who can see or hear you.
          14|Leading Evasion|On a Dexterity save for half damage, you take none on a success and half on a failure, and so can creatures next to you.
        `),
      },
      'College of Glamour': {
        intro: 'Bards who learned their art in the Feywild.',
        spells: { 3: ['Charm Person', 'Mirror Image'] },
        features: feats(`
          3|Beguiling Magic|Charm Person and Mirror Image are always prepared. After you cast an enchantment or illusion spell, a creature within 60 feet makes a Wisdom save or is charmed or frightened for a minute (once per long rest, or by spending inspiration).
          3|Mantle of Inspiration|Bonus action, spending inspiration: allies within 60 feet gain temporary hit points (2 × the die roll) and can move without provoking.
          6|Mantle of Majesty|Bonus action: cast Command without a slot, and keep casting it as a bonus action each turn for a minute. Once per long rest, or with a 3rd-level slot.
          14|Unbreakable Majesty|Bonus action for a minute: the first time a creature attacks you each turn it makes a Charisma save, or the attack misses.
        `),
      },
      'College of Lore': {
        intro: 'Bards who collect knowledge and use it as a weapon.',
        features: feats(`
          3|Bonus Proficiencies|Proficiency in three more skills.
          3|Cutting Words|Reaction: spend a Bardic die and subtract it from a creature's attack roll, damage roll or ability check within 60 feet.
          6|Magical Discoveries|Two spells of your choice from the cleric, druid or wizard lists are always prepared.
          14|Peerless Skill|Add a Bardic die to a failed ability check or attack roll; the use is spent only if it then succeeds.
        `),
      },
      'College of Valor': {
        intro: 'Skalds who keep the tales of great warriors alive by living them.',
        features: feats(`
          3|Combat Inspiration|A creature with your inspiration can add the die to a weapon's damage, or to its AC against one attack as a reaction.
          3|Martial Training|Martial weapons, medium armour and shields, and a simple or martial weapon as a spellcasting focus.
          6|Extra Attack|Attack twice when you take the Attack action, and you can cast a cantrip in place of one attack.
          14|Battle Magic|After casting a spell with an action, make one weapon attack as a bonus action.
        `),
      },
    },
  },

  Cleric: {
    intro: 'Priests who channel the power of a god. Clerics heal and protect, smite their god\'s enemies and call on miracles.',
    core: {
      'Primary Ability': 'Wisdom', 'Hit Point Die': 'D8 per Cleric level', 'Saving Throw Proficiencies': 'Wisdom and Charisma',
      'Skill Proficiencies': 'Choose 2: History, Insight, Medicine, Persuasion or Religion',
      'Weapon Proficiencies': 'Simple weapons', 'Armor Training': 'Light and Medium armor and Shields',
      'Starting Equipment': "Choose A or B: (A) Chain Shirt, Shield, Mace, Holy Symbol, Priest's Pack and 7 GP; or (B) 110 GP",
    },
    columns: { 'Channel Divinity': col([[2, 2], [6, 3], [18, 4]]), Cantrips: col([[1, 3], [4, 4], [10, 5]]), 'Prepared Spells': FULL_PREPARED, ...slotCols(FULL_SLOTS, 9) },
    features: feats(`
      1|Spellcasting|You prepare cleric spells with Wisdom each long rest, using a holy symbol as your focus.
      1|Divine Order|Choose Protector (martial weapons and heavy armour) or Thaumaturge (an extra cantrip, and Wisdom added to Arcana and Religion checks).
      2|Channel Divinity|Uses per rest from the Channel Divinity column (one back on a short rest). Divine Spark: heal or deal necrotic or radiant damage (1d8 + Wis, more dice at higher levels) to a creature within 30 feet. Turn Undead: undead within 30 feet make a Wisdom save or are frightened and incapacitated for a minute.
      3|Cleric Subclass|Choose a domain: Life, Light, Trickery or War. Its domain spells are always prepared.
      4|${ASI}|${ASI_TEXT}
      5|Sear Undead|Undead that fail against Turn Undead also take radiant damage: as many d8s as your Wisdom modifier.
      6|${SUB}|A feature from your domain.
      7|Blessed Strikes|Choose Divine Strike (once a turn, a weapon hit deals 1d8 necrotic or radiant more) or Potent Spellcasting (add Wisdom to cleric cantrip damage).
      8|${ASI}|${ASI_TEXT}
      10|Divine Intervention|Once per long rest, cast any cleric spell of 5th level or lower that takes an action, without a slot or material components.
      12|${ASI}|${ASI_TEXT}
      14|Improved Blessed Strikes|Divine Strike becomes 2d8, or Potent Spellcasting also gives temporary hit points.
      16|${ASI}|${ASI_TEXT}
      17|${SUB}|A feature from your domain.
      19|Epic Boon|${BOON_TEXT}
      20|Greater Divine Intervention|Divine Intervention can cast Wish. Afterwards you can't use it again for 2d4 long rests.
    `),
    subclasses: {
      'Life Domain': {
        intro: 'Gods of healing, vitality and the living world.',
        spells: { 3: ['Aid', 'Bless', 'Cure Wounds', 'Lesser Restoration'], 5: ['Mass Healing Word', 'Revivify'], 7: ['Aura of Life', 'Death Ward'], 9: ['Greater Restoration', 'Mass Cure Wounds'] },
        features: feats(`
          3|Disciple of Life|A spell slot spent on healing restores 2 + the slot's level more hit points.
          3|Life Domain Spells|Aid, Bless, Cure Wounds and Lesser Restoration always prepared, with more at 5th, 7th and 9th level.
          3|Preserve Life|Channel Divinity: split five times your cleric level in healing among bloodied creatures within 30 feet, up to half each one's maximum.
          6|Blessed Healer|When you heal someone else with a spell slot, you regain 2 + the slot's level hit points.
          17|Supreme Healing|Healing dice from your spells and Channel Divinity roll their maximum.
        `),
      },
      'Light Domain': {
        intro: 'Gods of truth, vigilance, beauty and the sun.',
        spells: { 3: ['Burning Hands', 'Faerie Fire', 'Scorching Ray', 'See Invisibility'], 5: ['Daylight', 'Fireball'], 7: ['Arcane Eye', 'Wall of Fire'], 9: ['Flame Strike', 'Scrying'] },
        features: feats(`
          3|Light Domain Spells|Burning Hands, Faerie Fire, Scorching Ray and See Invisibility always prepared, with more at 5th, 7th and 9th level.
          3|Radiance of the Dawn|Channel Divinity: end magical darkness in 30 feet, and creatures of your choice there make a Constitution save or take 2d10 + cleric level radiant (half on a success).
          3|Warding Flare|Reaction when you or a creature within 30 feet is attacked: the attacker has disadvantage. Wisdom modifier uses per long rest.
          6|Improved Warding Flare|Warding Flare comes back on a short rest, and the target also gains 2d6 + Wis temporary hit points.
          17|Corona of Light|Action, for a minute: bright light 60 feet, and enemies in it have disadvantage on saves against your fire and radiant spells and Radiance of the Dawn. Wisdom modifier uses per long rest.
        `),
      },
      'Trickery Domain': {
        intro: 'Gods of mischief, thieves and change.',
        spells: { 3: ['Charm Person', 'Disguise Self', 'Invisibility', 'Pass without Trace'], 5: ['Hypnotic Pattern', 'Nondetection'], 7: ['Confusion', 'Dimension Door'], 9: ['Dominate Person', 'Modify Memory'] },
        features: feats(`
          3|Blessing of the Trickster|Action: you or a willing creature has advantage on Stealth checks until your next long rest.
          3|Invoke Duplicity|Channel Divinity: an illusory double for a minute. Cast spells as if from its space, have advantage on attacks against a creature near it, and move it 30 feet as a bonus action.
          3|Trickery Domain Spells|Charm Person, Disguise Self, Invisibility and Pass without Trace always prepared, with more at 5th, 7th and 9th level.
          6|Trickster's Transposition|When you make or move your duplicate, you can swap places with it.
          17|Improved Duplicity|You and your allies have advantage on attacks against creatures near the duplicate, and when it ends a creature near it heals hit points equal to your cleric level.
        `),
      },
      'War Domain': {
        intro: 'Gods of war, courage and strategy.',
        spells: { 3: ['Guiding Bolt', 'Magic Weapon', 'Shield of Faith', 'Spiritual Weapon'], 5: ["Crusader's Mantle", 'Spirit Guardians'], 7: ['Fire Shield', 'Freedom of Movement'], 9: ['Hold Monster', 'Steel Wind Strike'] },
        features: feats(`
          3|Guided Strike|Channel Divinity: +10 to an attack roll you or a creature within 30 feet makes, after seeing the roll.
          3|War Domain Spells|Guiding Bolt, Magic Weapon, Shield of Faith and Spiritual Weapon always prepared, with more at 5th, 7th and 9th level.
          3|War Priest|Bonus action: one weapon attack or unarmed strike. Wisdom modifier uses per short or long rest.
          6|War God's Blessing|Spend Channel Divinity to cast Shield of Faith or Spiritual Weapon without a slot, lasting a minute without concentration.
          17|Avatar of Battle|Resistance to bludgeoning, piercing and slashing damage.
        `),
      },
    },
  },

  Druid: {
    intro: 'Priests of nature who draw on the old powers of the wild. Druids call storms and growth, and take the shapes of beasts.',
    core: {
      'Primary Ability': 'Wisdom', 'Hit Point Die': 'D8 per Druid level', 'Saving Throw Proficiencies': 'Intelligence and Wisdom',
      'Skill Proficiencies': 'Choose 2: Arcana, Animal Handling, Insight, Medicine, Nature, Perception, Religion or Survival',
      'Weapon Proficiencies': 'Simple weapons', 'Tool Proficiencies': 'Herbalism Kit', 'Armor Training': 'Light armor and Shields',
      'Starting Equipment': "Choose A or B: (A) Leather Armor, Shield, Sickle, Druidic Focus (Quarterstaff), Explorer's Pack, Herbalism Kit and 9 GP; or (B) 50 GP",
    },
    columns: { 'Wild Shape': col([[2, 2], [6, 3], [17, 4]]), Cantrips: col([[1, 2], [4, 3], [10, 4]]), 'Prepared Spells': FULL_PREPARED, ...slotCols(FULL_SLOTS, 9) },
    features: feats(`
      1|Spellcasting|You prepare druid spells with Wisdom each long rest, using a druidic focus.
      1|Druidic|You know the druids' secret language, and Speak with Animals is always prepared.
      1|Primal Order|Choose Magician (an extra cantrip, and Wisdom added to Arcana and Nature checks) or Warden (martial weapons and medium armour).
      2|Wild Shape|Bonus action: become a beast you've learned (CR 1/4 with no fly speed at first; CR 1/2 at 4th, CR 1 with flying at 8th) for half your druid level in hours, with temporary hit points equal to your druid level. Uses from the Wild Shape column; one back on a short rest.
      2|Wild Companion|Spend a Wild Shape use or a spell slot to cast Find Familiar without components; the familiar is fey and vanishes after a long rest.
      3|Druid Subclass|Choose a circle: Land, Moon, Sea or Stars.
      4|${ASI}|${ASI_TEXT}
      5|Wild Resurgence|Spend a spell slot to regain a Wild Shape use, or once per long rest, a Wild Shape use to regain a 1st-level slot.
      6|${SUB}|A feature from your circle.
      7|Elemental Fury|Choose Potent Spellcasting (add Wisdom to druid cantrip damage) or Primal Strike (once a turn, a weapon or beast-form hit deals 1d8 cold, fire, lightning or thunder more).
      8|${ASI}|${ASI_TEXT}
      10|${SUB}|A feature from your circle.
      12|${ASI}|${ASI_TEXT}
      14|${SUB}|A feature from your circle.
      15|Improved Elemental Fury|Potent Spellcasting reaches 300 feet farther on cantrips of 10 feet or more, or Primal Strike becomes 2d8.
      16|${ASI}|${ASI_TEXT}
      18|Beast Spells|Cast spells in Wild Shape, without costly components.
      19|Epic Boon|${BOON_TEXT}
      20|Archdruid|Regain a Wild Shape use on initiative if you have none. Turn Wild Shape uses into spell slots (Evergreen Wild Shape, Nature Magician), and age at a tenth of the normal rate.
    `),
    subclasses: {
      'Circle of the Land': {
        intro: 'Keepers of the old lore of a land.',
        features: feats(`
          3|Circle of the Land Spells|After each long rest choose a land (arid, polar, temperate or tropical) and its spells are prepared, with more at 5th, 7th and 9th level.
          3|Land's Aid|Spend Wild Shape: a 10-foot sphere within 60 feet deals 2d6 necrotic to creatures that fail a Constitution save, and heals one creature 2d6 (3d6 at 10th, 4d6 at 14th).
          6|Natural Recovery|Once per long rest, cast a circle spell without a slot; and after a short rest, recover slots totalling half your druid level.
          10|Nature's Ward|Immune to poisoned, and resistance to the damage type of your current land.
          14|Nature's Sanctuary|Spend Wild Shape: spectral trees in a 15-foot cube within 120 feet give you and allies half cover and your land's resistance for a minute.
        `),
      },
      'Circle of the Moon': {
        intro: 'Druids who walk as the beasts do, under the moon.',
        spells: { 3: ['Cure Wounds', 'Moonbeam', 'Starry Wisp'], 5: ['Conjure Animals'], 7: ['Fount of Moonlight'], 9: ['Mass Cure Wounds'] },
        features: feats(`
          3|Circle Forms|Wild Shape into beasts up to CR equal to a third of your druid level (minimum 1), with AC at least 13 + Wis and three times your druid level in temporary hit points.
          3|Circle of the Moon Spells|Cure Wounds, Moonbeam and Starry Wisp always prepared, with more at 5th, 7th and 9th; you can cast them in Wild Shape.
          6|Improved Circle Forms|In Wild Shape, add Wisdom to Constitution saves, and deal radiant damage if you choose.
          10|Moonlight Step|Bonus action: teleport 30 feet and have advantage on your next attack. Wisdom modifier uses per long rest, or by spending a 2nd-level slot.
          14|Lunar Form|Once a turn in Wild Shape deal 2d10 radiant more on a hit, and Moonlight Step can take a willing creature with you.
        `),
      },
      'Circle of the Sea': {
        intro: 'Druids of the tides and storms.',
        spells: { 3: ['Fog Cloud', 'Gust of Wind', 'Ray of Frost', 'Shatter', 'Thunderwave'], 5: ['Lightning Bolt', 'Water Breathing'], 7: ['Control Water', 'Ice Storm'], 9: ['Conjure Elemental', 'Hold Monster'] },
        features: feats(`
          3|Circle of the Sea Spells|Fog Cloud, Gust of Wind, Ray of Frost, Shatter and Thunderwave always prepared, with more at 5th, 7th and 9th level.
          3|Wrath of the Sea|Spend Wild Shape: a 5-foot emanation of spray for 10 minutes. As a bonus action, a creature in it makes a Constitution save or takes cold damage (d6s equal to Wis) and is pushed 15 feet.
          6|Aquatic Affinity|The emanation grows to 10 feet, and you gain a swim speed and breathe water.
          10|Stormborn|While the emanation is up, a fly speed and resistance to cold, lightning and thunder.
          14|Oceanic Gift|Put the emanation on a willing ally instead, or on both of you for two uses.
        `),
      },
      'Circle of the Stars': {
        intro: 'Druids who read the heavens and wear their light.',
        features: feats(`
          3|Star Map|A star chart focus: Guidance and Guiding Bolt always prepared, and Guiding Bolt free a few times a day.
          3|Starry Form|Spend Wild Shape: glow as a constellation for 10 minutes. Archer (bonus action ranged spell attack, 1d8 + Wis radiant), Chalice (healing spells heal a creature nearby 1d8 + Wis) or Dragon (treat 9 or lower as 10 on Int and Wis checks and concentration saves).
          6|Cosmic Omen|After a long rest roll for weal or woe: reaction to add or subtract 1d6 from a nearby creature's d20 test. Wisdom modifier uses.
          10|Twinkling Constellations|Starry Form dice become 2d8, the Dragon gives a fly speed, and you can change constellation each turn.
          14|Full of Stars|In Starry Form, resistance to bludgeoning, piercing and slashing damage.
        `),
      },
    },
  },

  Fighter: {
    intro: 'Masters of weapons and armour. Fighters know every way to win a fight, and keep going long after others fall.',
    core: {
      'Primary Ability': 'Strength or Dexterity', 'Hit Point Die': 'D10 per Fighter level', 'Saving Throw Proficiencies': 'Strength and Constitution',
      'Skill Proficiencies': 'Choose 2: Acrobatics, Animal Handling, Athletics, History, Insight, Intimidation, Persuasion, Perception or Survival',
      'Weapon Proficiencies': 'Simple and Martial weapons', 'Armor Training': 'Light, Medium and Heavy armor and Shields',
      'Starting Equipment': "Choose A, B or C: (A) Chain Mail, Greatsword, Flail, 8 Javelins, Dungeoneer's Pack and 4 GP; (B) Studded Leather Armor, Scimitar, Shortsword, Longbow, 20 Arrows, Quiver, Dungeoneer's Pack and 11 GP; or (C) 155 GP",
    },
    columns: { 'Second Wind': col([[1, 2], [4, 3], [10, 4]]), 'Weapon Mastery': col([[1, 3], [4, 4], [10, 5], [16, 6]]) },
    features: feats(`
      1|Fighting Style|Take a Fighting Style feat (Archery, Defense, Great Weapon Fighting, Two-Weapon Fighting and so on). Swap it when you gain a level.
      1|Second Wind|Bonus action: regain 1d10 + fighter level hit points. Uses from the Second Wind column; one back on a short rest.
      1|Weapon Mastery|Use the mastery properties of the weapons shown in the Weapon Mastery column, swapped after a long rest.
      2|Action Surge|Once per short or long rest, take one more action on your turn (not Magic). Twice per rest from 17th level.
      2|Tactical Mind|After failing an ability check, spend a Second Wind use to add 1d10; the use isn't spent if it still fails.
      3|Fighter Subclass|Choose an archetype: Battle Master, Champion, Eldritch Knight or Psi Warrior.
      4|${ASI}|${ASI_TEXT}
      5|Extra Attack|Attack twice when you take the Attack action.
      5|Tactical Shift|When you use Second Wind, move up to half your speed without provoking opportunity attacks.
      6|${ASI}|${ASI_TEXT}
      7|${SUB}|A feature from your archetype.
      8|${ASI}|${ASI_TEXT}
      9|Indomitable|Reroll a failed save with a bonus equal to your fighter level. Once per long rest (twice at 13th, three times at 17th).
      9|Tactical Master|When you attack with a weapon whose mastery you use, you can swap its property for Push, Sap or Slow.
      10|${SUB}|A feature from your archetype.
      11|Two Extra Attacks|Attack three times when you take the Attack action.
      12|${ASI}|${ASI_TEXT}
      13|Indomitable|Reroll a failed save with a bonus equal to your fighter level, twice per long rest (three times at 17th).
      13|Studied Attacks|After you miss a creature, you have advantage on your next attack against it.
      14|${ASI}|${ASI_TEXT}
      15|${SUB}|A feature from your archetype.
      16|${ASI}|${ASI_TEXT}
      17|Action Surge|Twice per short or long rest (once per turn), take one more action on your turn (not Magic).
      17|Indomitable|Reroll a failed save with a bonus equal to your fighter level, three times per long rest.
      18|${SUB}|A feature from your archetype.
      19|Epic Boon|${BOON_TEXT}
      20|Three Extra Attacks|Attack four times when you take the Attack action.
    `),
    subclasses: {
      'Battle Master': {
        intro: 'A student of the art of war, using manoeuvres to control the fight.',
        features: feats(`
          3|Combat Superiority|Learn three maneuvers (more later) fuelled by four d8 superiority dice, regained on a short or long rest. Save DC 8 + PB + Str or Dex.
          3|Student of War|Proficiency with one kind of artisan's tools and one fighter skill.
          7|Know Your Enemy|Bonus action: learn a creature's immunities, resistances and vulnerabilities. Once per long rest, or for a superiority die.
          10|Improved Combat Superiority|Superiority dice become d10s.
          15|Relentless|Once a turn, use a d8 in place of a superiority die when you have none left.
          18|Ultimate Combat Superiority|Superiority dice become d12s.
        `),
      },
      Champion: {
        intro: 'A fighter honed to athletic perfection.',
        features: feats(`
          3|Improved Critical|Weapon attacks and unarmed strikes score a critical hit on a 19 or 20.
          3|Remarkable Athlete|Advantage on initiative and Athletics checks, and you can move half your speed after a critical hit without provoking.
          7|Additional Fighting Style|Take another Fighting Style feat.
          10|Heroic Warrior|At the start of each turn in combat, gain Heroic Inspiration if you have none.
          15|Superior Critical|Critical hits on 18 to 20.
          18|Survivor|Advantage on death saves (18 or more counts as a 20), and while bloodied regain 5 + Con hit points at the start of each turn.
        `),
      },
      'Eldritch Knight': {
        intro: 'A fighter who adds wizard magic to their weapons. They prepare spells from the wizard list with Intelligence, with a third of a full caster\'s spell slots (see the Eldritch Knight Spellcasting table below).',
        caster: 'third',
        features: feats(`
          3|Spellcasting|Cast wizard spells with Intelligence: two cantrips and three prepared spells at 3rd level, reaching 4th-level spells at 19th (see the Eldritch Knight table). Any wizard spell can be chosen. An arcane focus works as your focus.
          3|War Bond|Bond with up to two weapons: you can't be disarmed of them, and you can summon one to your hand as a bonus action.
          7|War Magic|When you take the Attack action, you can replace one attack with casting a cantrip.
          10|Eldritch Strike|A creature you hit with a weapon has disadvantage on the next save it makes against a spell you cast before the end of your next turn.
          15|Arcane Charge|When you use Action Surge, you can teleport 30 feet.
          18|Improved War Magic|When you take the Attack action, you can replace two attacks with a 1st- or 2nd-level spell that takes an action.
        `),
      },
      'Psi Warrior': {
        intro: 'A fighter who strengthens their blows with psionic power.',
        features: feats(`
          3|Psionic Power|Psionic energy dice (four d6s at first) regained on a long rest, one back on a short rest. Protective Field (reaction: cut damage to a nearby creature by a die + Int), Psionic Strike (a hit deals a die + Int force more), Telekinetic Movement (move an object or willing creature 30 feet).
          7|Telekinetic Adept|Psi-Powered Leap (fly speed equal to twice your speed for a turn) and Telekinetic Thrust (a Psionic Strike target makes a Strength save or is knocked prone or pushed 10 feet).
          10|Guarded Mind|Resistance to psychic damage, and spend a die to end charmed or frightened on yourself.
          15|Bulwark of Force|Bonus action: up to Int-modifier creatures within 30 feet get half cover for a minute. Once per long rest, or for a die.
          18|Telekinetic Master|Telekinesis always prepared, cast with Intelligence without a slot once per long rest; while concentrating on it you can make one weapon attack as a bonus action.
        `),
      },
    },
  },

  Monk: {
    intro: 'Martial artists who harness their inner focus. Monks move faster than the eye, catch arrows and strike with stunning blows.',
    core: {
      'Primary Ability': 'Dexterity and Wisdom', 'Hit Point Die': 'D8 per Monk level', 'Saving Throw Proficiencies': 'Strength and Dexterity',
      'Skill Proficiencies': 'Choose 2: Acrobatics, Athletics, History, Insight, Religion or Stealth',
      'Weapon Proficiencies': 'Simple weapons and Martial weapons that have the Light property', 'Tool Proficiencies': "Choose one kind of Artisan's Tools or Musical Instrument",
      'Armor Training': 'None',
      'Starting Equipment': "Choose A or B: (A) Spear, 5 Daggers, Artisan's Tools or Musical Instrument chosen for the tool proficiency above, Explorer's Pack and 11 GP; or (B) 50 GP",
    },
    columns: {
      'Martial Arts': col([[1, '1d6'], [5, '1d8'], [11, '1d10'], [17, '1d12']]), 'Focus Points': col([[1, '—'], ...Array.from({ length: 19 }, (_, i) => [i + 2, i + 2])]),
      'Unarmored Movement': col([[1, '—'], [2, '+10 ft.'], [6, '+15 ft.'], [10, '+20 ft.'], [14, '+25 ft.'], [18, '+30 ft.']]),
    },
    features: feats(`
      1|Martial Arts|Unarmed and without a shield, with unarmed strikes and Monk weapons: attack with Dexterity, roll the Martial Arts die for damage, and make an unarmed strike as a bonus action.
      1|Unarmored Defense|Without armour or a shield, AC is 10 + Dexterity + Wisdom modifiers.
      2|Monk's Focus|Focus points (the Focus Points column), back on a short rest. Flurry of Blows (1 point: two unarmed strikes as a bonus action), Patient Defense (Disengage free, or 1 point: Disengage and Dodge as a bonus action), Step of the Wind (Dash free, or 1 point: Disengage and Dash, double jump). Save DC 8 + Wis + PB.
      2|Unarmored Movement|More speed without armour or a shield (the Unarmored Movement column).
      2|Uncanny Metabolism|Once per long rest when you roll initiative, regain all focus points and heal a Martial Arts die + monk level.
      3|Deflect Attacks|Reaction when hit: cut the damage by 1d10 + Dex + monk level. If it drops to 0, spend 1 point to redirect it at a creature (two Martial Arts dice + Dex).
      3|Monk Subclass|Choose a tradition: Mercy, Shadow, the Elements or the Open Hand.
      4|${ASI}|${ASI_TEXT}
      4|Slow Fall|Reaction: cut falling damage by five times your monk level.
      5|Extra Attack|Attack twice when you take the Attack action.
      5|Stunning Strike|Once a turn when you hit, spend 1 point: the target makes a Constitution save or is stunned until your next turn (on a success its speed halves and your next attack has advantage).
      6|Empowered Strikes|Unarmed strikes can deal force damage.
      6|${SUB}|A feature from your tradition.
      7|Evasion|On a Dexterity save for half damage, take none on a success and half on a failure.
      8|${ASI}|${ASI_TEXT}
      9|Acrobatic Movement|Move along walls and across liquids on your turn.
      10|Heightened Focus|Flurry of Blows makes three strikes, Patient Defense gives temporary hit points, and Step of the Wind can carry a willing creature.
      10|Self-Restoration|End charmed, frightened or poisoned on yourself at the end of each turn, and skip food and drink without exhaustion.
      11|${SUB}|A feature from your tradition.
      12|${ASI}|${ASI_TEXT}
      13|Deflect Energy|Deflect Attacks works against any damage type.
      14|Disciplined Survivor|Proficiency in all saving throws, and spend 1 point to reroll a failed save.
      15|Perfect Focus|On initiative, if you have 3 or fewer focus points, regain up to 4.
      16|${ASI}|${ASI_TEXT}
      17|${SUB}|A feature from your tradition.
      18|Superior Defense|Spend 3 points: resistance to all damage but force for a minute.
      19|Epic Boon|${BOON_TEXT}
      20|Body and Mind|Dexterity and Wisdom go up by 4, to a maximum of 25.
    `),
    subclasses: {
      'Warrior of Mercy': {
        intro: 'Monks who carry both healing and harm in their hands.',
        features: feats(`
          3|Hand of Harm|Once a turn when an unarmed strike hits, spend 1 point to deal a Martial Arts die + Wis necrotic more.
          3|Hand of Healing|Spend 1 point (or replace a Flurry strike) to heal a creature you touch a Martial Arts die + Wis.
          3|Implements of Mercy|Proficiency with Insight, Medicine and the herbalism kit, and a mask.
          6|Physician's Touch|Hand of Harm can poison the target; Hand of Healing ends a condition (blinded, deafened, paralysed, poisoned or stunned).
          11|Flurry of Healing and Harm|Replace each Flurry strike with Hand of Healing for free, and use Hand of Harm free once a turn with Flurry.
          17|Hand of Ultimate Mercy|Once per long rest, spend 5 points to raise a creature dead no more than a day with 4d10 + Wis hit points.
        `),
      },
      'Warrior of Shadow': {
        intro: 'Monks who move through darkness.',
        features: feats(`
          3|Shadow Arts|Spend 1 point to cast Darkness without a slot and see through it, moving it on later turns. 60-foot darkvision, and the Minor Illusion cantrip.
          6|Shadow Step|Bonus action in dim light or darkness: teleport 60 feet to another such spot and have advantage on your next melee attack.
          11|Improved Shadow Step|Spend 1 point to Shadow Step from or to bright light, and make an unarmed strike after.
          17|Cloak of Shadows|Spend 3 points: in dim light or darkness, become invisible and move through creatures and objects for a minute.
        `),
      },
      'Warrior of the Elements': {
        intro: 'Monks who bend the elements to their strikes.',
        features: feats(`
          3|Elemental Attunement|Spend 1 point for 10 minutes: reach grows 10 feet, and unarmed strikes can deal acid, cold, fire, lightning or thunder damage and push or pull 10 feet.
          3|Manipulate Elements|The Elementalism cantrip.
          6|Elemental Burst|Spend 2 points: a 20-foot sphere within 120 feet deals three Martial Arts dice of an element (Dex save for half).
          11|Stride of the Elements|While attuned, fly and swim speed equal to your speed.
          17|Elemental Epitome|While attuned: resistance to one element, Step of the Wind adds 20 feet speed and damages those you pass, and one strike a turn adds a Martial Arts die of the element.
        `),
      },
      'Warrior of the Open Hand': {
        intro: 'Masters of unarmed combat.',
        features: feats(`
          3|Open Hand Technique|A Flurry hit can also stop reactions (Addle), push 15 feet (Push, Str save), or knock prone (Topple, Dex save).
          6|Wholeness of Body|Bonus action: heal a Martial Arts die + Wis. Wisdom modifier uses per long rest.
          11|Fleet Step|After a bonus action other than Step of the Wind, you can also use Step of the Wind.
          17|Quivering Palm|Spend 4 points when a strike hits: later, end it to force a Constitution save for 10d12 force (half on a success).
        `),
      },
    },
  },

  Paladin: {
    intro: 'Holy warriors bound by a sacred oath. Paladins smite evil, shield the weak and carry an aura of divine courage.',
    core: {
      'Primary Ability': 'Strength and Charisma', 'Hit Point Die': 'D10 per Paladin level', 'Saving Throw Proficiencies': 'Wisdom and Charisma',
      'Skill Proficiencies': 'Choose 2: Athletics, Insight, Intimidation, Medicine, Persuasion or Religion',
      'Weapon Proficiencies': 'Simple and Martial weapons', 'Armor Training': 'Light, Medium and Heavy armor and Shields',
      'Starting Equipment': "Choose A or B: (A) Chain Mail, Shield, Longsword, 6 Javelins, Holy Symbol, Priest's Pack and 9 GP; or (B) 150 GP",
    },
    columns: { 'Channel Divinity': col([[1, '—'], [3, 2], [11, 3]]), 'Prepared Spells': HALF_PREPARED, ...slotCols(HALF_SLOTS, 5) },
    features: feats(`
      1|Lay on Hands|A pool of healing (five times your paladin level), restored on a long rest. Bonus action: heal a creature you touch, or spend 5 to end its poisoned condition.
      1|Spellcasting|You prepare paladin spells with Charisma each long rest, using a holy symbol as your focus.
      1|Weapon Mastery|Use the mastery properties of two kinds of weapons, swapped after a long rest.
      2|Fighting Style|Take a Fighting Style feat, or Blessed Warrior (two cleric cantrips, cast with Charisma).
      2|Paladin's Smite|Divine Smite is always prepared, and once per long rest you can cast it without a slot.
      3|Channel Divinity|Uses from the Channel Divinity column (one back on a short rest). Divine Sense: for 10 minutes, sense celestials, fiends and undead within 60 feet.
      3|Paladin Subclass|Choose an oath: Devotion, Glory, the Ancients or Vengeance. Its oath spells are always prepared.
      4|${ASI}|${ASI_TEXT}
      5|Extra Attack|Attack twice when you take the Attack action.
      5|Faithful Steed|Find Steed is always prepared, and once per long rest you can cast it without a slot.
      6|Aura of Protection|You and allies within 10 feet add your Charisma modifier to saving throws.
      7|${SUB}|A feature from your oath.
      8|${ASI}|${ASI_TEXT}
      9|Abjure Foes|Channel Divinity: up to Cha-modifier creatures within 60 feet make a Wisdom save or are frightened for a minute and can only move, act or take a bonus action each turn.
      10|Aura of Courage|You and allies in your aura can't be frightened.
      11|Radiant Strikes|Melee weapon and unarmed hits deal 1d8 radiant more.
      12|${ASI}|${ASI_TEXT}
      14|Restoring Touch|Lay on Hands can also end blinded, charmed, deafened, frightened, paralysed or stunned, 5 points each.
      15|${SUB}|A feature from your oath.
      16|${ASI}|${ASI_TEXT}
      18|Aura Expansion|Your auras reach 30 feet.
      19|Epic Boon|${BOON_TEXT}
      20|${SUB}|A feature from your oath.
    `),
    subclasses: {
      'Oath of Devotion': {
        intro: 'The ideals of justice, virtue and order.',
        spells: { 3: ['Protection from Evil and Good', 'Shield of Faith'], 5: ['Aid', 'Zone of Truth'], 9: ['Beacon of Hope', 'Dispel Magic'], 13: ['Freedom of Movement', 'Guardian of Faith'], 17: ['Commune', 'Flame Strike'] },
        features: feats(`
          3|Oath of Devotion Spells|Protection from Evil and Good and Shield of Faith always prepared, with more at 5th, 9th, 13th and 17th level.
          3|Sacred Weapon|Channel Divinity for 10 minutes: add Charisma to attack rolls with a melee weapon, deal radiant damage if you like, and shed bright light.
          7|Aura of Devotion|You and allies in your aura can't be charmed.
          15|Smite of Protection|When you cast Divine Smite, you and allies in your aura have half cover until your next turn.
          20|Holy Nimbus|Once per long rest, for 10 minutes: advantage on saves against fiends and undead, enemies starting in your aura take radiant damage (Cha + PB), and the aura is sunlight.
        `),
      },
      'Oath of Glory': {
        intro: 'Paladins who strive for heroic deeds.',
        spells: { 3: ['Guiding Bolt', 'Heroism'], 5: ['Enhance Ability', 'Magic Weapon'], 9: ['Haste', 'Protection from Energy'], 13: ['Compulsion', 'Freedom of Movement'], 17: ['Legend Lore', "Yolande's Regal Presence"] },
        features: feats(`
          3|Inspiring Smite|After Divine Smite, spend Channel Divinity to share 2d8 + paladin level temporary hit points among creatures within 30 feet.
          3|Oath of Glory Spells|Guiding Bolt and Heroism always prepared, with more at 5th, 9th, 13th and 17th level.
          3|Peerless Athlete|Channel Divinity for an hour: advantage on Athletics and Acrobatics checks, and longer jumps.
          7|Aura of Alacrity|+10 speed, and allies who start their turn in your aura or enter it gain +10 speed.
          15|Glorious Defense|Reaction when you or an ally in 10 feet is hit: add Charisma to AC against it; if it misses, attack the attacker. Cha-modifier uses per long rest.
          20|Living Legend|Once per long rest, for 10 minutes: advantage on Charisma checks, turn a miss into a hit once a turn, and reroll a failed save.
        `),
      },
      'Oath of the Ancients': {
        intro: 'Keepers of the light, life and beauty of the world.',
        spells: { 3: ['Ensnaring Strike', 'Speak with Animals'], 5: ['Misty Step', 'Moonbeam'], 9: ['Plant Growth', 'Protection from Energy'], 13: ['Ice Storm', 'Stoneskin'], 17: ['Commune with Nature', 'Tree Stride'] },
        features: feats(`
          3|Nature's Wrath|Channel Divinity: creatures of your choice within 15 feet make a Strength save or are restrained by spectral vines for a minute.
          3|Oath of the Ancients Spells|Ensnaring Strike and Speak with Animals always prepared, with more at 5th, 9th, 13th and 17th level.
          7|Aura of Warding|You and allies in your aura have resistance to necrotic, psychic and radiant damage.
          15|Undying Sentinel|Once per long rest, drop to 1 hit point instead of 0 and heal three times your paladin level; you don't age.
          20|Elder Champion|Once per long rest, for a minute: regain 10 hit points each turn, cast paladin spells as a bonus action, and enemies in your aura have disadvantage on saves against your spells and Channel Divinity.
        `),
      },
      'Oath of Vengeance': {
        intro: 'A solemn promise to punish those who do grievous wrong.',
        spells: { 3: ['Bane', "Hunter's Mark"], 5: ['Hold Person', 'Misty Step'], 9: ['Haste', 'Protection from Energy'], 13: ['Banishment', 'Dimension Door'], 17: ['Hold Monster', 'Scrying'] },
        features: feats(`
          3|Oath of Vengeance Spells|Bane and Hunter's Mark always prepared, with more at 5th, 9th, 13th and 17th level.
          3|Vow of Enmity|Channel Divinity when you take the Attack action: advantage on attacks against one creature within 30 feet for a minute.
          7|Relentless Avenger|When you hit with an opportunity attack, the target's speed drops to 0 and you can move half your speed without provoking.
          15|Soul of Vengeance|Reaction when your Vow target attacks: make a melee attack against it.
          20|Avenging Angel|Once per long rest, for 10 minutes: fly speed 60 feet, and enemies starting their turn in your aura make a Wisdom save or are frightened, and attacks on them have advantage.
        `),
      },
    },
  },

  Ranger: {
    intro: 'Hunters and wanderers of the wild places. Rangers track their quarry across any land and mix weapon skill with nature magic.',
    core: {
      'Primary Ability': 'Dexterity and Wisdom', 'Hit Point Die': 'D10 per Ranger level', 'Saving Throw Proficiencies': 'Strength and Dexterity',
      'Skill Proficiencies': 'Choose 3: Animal Handling, Athletics, Insight, Investigation, Nature, Perception, Stealth or Survival',
      'Weapon Proficiencies': 'Simple and Martial weapons', 'Armor Training': 'Light and Medium armor and Shields',
      'Starting Equipment': "Choose A or B: (A) Studded Leather Armor, Scimitar, Shortsword, Longbow, 20 Arrows, Quiver, Druidic Focus (sprig of mistletoe), Explorer's Pack and 7 GP; or (B) 150 GP",
    },
    columns: { 'Favored Enemy': col([[1, 2], [5, 3], [9, 4], [13, 5], [17, 6]]), 'Prepared Spells': HALF_PREPARED, ...slotCols(HALF_SLOTS, 5) },
    features: feats(`
      1|Spellcasting|You prepare ranger spells with Wisdom each long rest, using a druidic focus.
      1|Favored Enemy|Hunter's Mark is always prepared, and you can cast it without a slot a number of times from the Favored Enemy column per long rest.
      1|Weapon Mastery|Use the mastery properties of two kinds of weapons, swapped after a long rest.
      2|Deft Explorer|Expertise in one skill and two more languages.
      2|Fighting Style|Take a Fighting Style feat, or Druidic Warrior (two druid cantrips, cast with Wisdom).
      3|Ranger Subclass|Choose a conclave: Beast Master, Fey Wanderer, Gloom Stalker or Hunter.
      4|${ASI}|${ASI_TEXT}
      5|Extra Attack|Attack twice when you take the Attack action.
      6|Roving|+10 speed without heavy armour, and climb and swim speeds equal to your speed.
      7|${SUB}|A feature from your conclave.
      8|${ASI}|${ASI_TEXT}
      9|Expertise|Expertise in two more skills.
      10|Tireless|Action: gain 1d8 + Wis temporary hit points (Wis-modifier uses per long rest), and a short rest lowers exhaustion by 1.
      11|${SUB}|A feature from your conclave.
      12|${ASI}|${ASI_TEXT}
      13|Relentless Hunter|Taking damage can't break your concentration on Hunter's Mark.
      14|Nature's Veil|Bonus action: become invisible until the end of your next turn. Wis-modifier uses per long rest.
      15|${SUB}|A feature from your conclave.
      16|${ASI}|${ASI_TEXT}
      17|Precise Hunter|Advantage on attacks against the target of your Hunter's Mark.
      18|Feral Senses|Blindsight 30 feet.
      19|Epic Boon|${BOON_TEXT}
      20|Foe Slayer|Hunter's Mark's damage die becomes a d10.
    `),
    subclasses: {
      'Beast Master': {
        intro: 'A ranger bonded to a primal beast.',
        features: feats(`
          3|Primal Companion|A primal beast of the land, sea or sky that acts on your turn; as a bonus action you command it to Attack (Beast's Strike) or take another action. It returns after a long rest if it dies, or for a slot.
          7|Exceptional Training|Your beast can Dash, Disengage, Dodge or Help as a bonus action, and its strikes can deal force damage.
          11|Bestial Fury|When commanded to strike, your beast makes two attacks, and the first hit each turn on your Hunter's Mark target adds its damage.
          15|Share Spells|A spell that targets only you can also affect your beast within 30 feet.
        `),
      },
      'Fey Wanderer': {
        intro: 'A ranger touched by the Feywild.',
        spells: { 3: ['Charm Person'], 5: ['Misty Step'], 9: ['Summon Fey'], 13: ['Dimension Door'], 17: ['Mislead'] },
        features: feats(`
          3|Dreadful Strikes|Once a turn, a weapon hit deals 1d4 psychic more (1d6 at 11th).
          3|Fey Wanderer Spells|Charm Person always prepared, with more at 5th, 9th, 13th and 17th level, plus a fey gift.
          3|Otherworldly Glamour|Add Wisdom to Charisma checks, and one Charisma skill proficiency.
          7|Beguiling Twist|Advantage on saves against charm and fear; when a creature near you resists one, a reaction to charm or frighten another creature.
          11|Fey Reinforcements|Summon Fey always prepared, cast once a long rest without a slot or concentration.
          15|Misty Wanderer|Cast Misty Step without a slot (Wis-modifier times), bringing a willing creature along.
        `),
      },
      'Gloom Stalker': {
        intro: 'A ranger at home in the dark places.',
        spells: { 3: ['Disguise Self'], 5: ['Rope Trick'], 9: ['Fear'], 13: ['Greater Invisibility'], 17: ['Seeming'] },
        features: feats(`
          3|Dread Ambusher|Add Wisdom to initiative, +10 speed on your first turn, and once a turn a hit deals 2d6 psychic more (Wis-modifier uses per long rest).
          3|Gloom Stalker Spells|Disguise Self always prepared, with more at 5th, 9th, 13th and 17th level.
          3|Umbral Sight|60-foot darkvision (or 60 more), and invisible to creatures relying on darkvision to see you in darkness.
          7|Iron Mind|Proficiency in Wisdom saves (or Intelligence or Charisma if you have it).
          11|Stalker's Flurry|Dread Ambusher's psychic damage becomes 2d8 and can also frighten the target or hit a second one nearby.
          15|Shadowy Dodge|Reaction when attacked: impose disadvantage, then teleport 30 feet.
        `),
      },
      Hunter: {
        intro: 'A ranger who protects the world from what preys on it.',
        features: feats(`
          3|Hunter's Lore|Learn the immunities, resistances and vulnerabilities of your Hunter's Mark target.
          3|Hunter's Prey|Colossus Slayer (once a turn, 1d8 more against a creature below its maximum) or Horde Breaker (once a turn, an extra attack on a second creature nearby). Change it after a rest.
          7|Defensive Tactics|Escape the Horde (opportunity attacks against you have disadvantage) or Multiattack Defense (after a creature hits you, its other attacks this turn have disadvantage).
          11|Superior Hunter's Prey|Once a turn, the extra damage of Hunter's Mark also hits a second creature within 30 feet.
          15|Superior Hunter's Defense|Reaction when you take damage: resistance to it and the rest of that type this turn.
        `),
      },
    },
  },

  Rogue: {
    intro: 'Experts in stealth, skill and a well-placed strike. Rogues find the weak spot, slip away and always have a trick left.',
    core: {
      'Primary Ability': 'Dexterity', 'Hit Point Die': 'D8 per Rogue level', 'Saving Throw Proficiencies': 'Dexterity and Intelligence',
      'Skill Proficiencies': 'Choose 4: Acrobatics, Athletics, Deception, Insight, Intimidation, Investigation, Perception, Persuasion, Sleight of Hand or Stealth',
      'Weapon Proficiencies': 'Simple weapons and Martial weapons that have the Finesse or Light property', 'Tool Proficiencies': "Thieves' Tools",
      'Armor Training': 'Light armor',
      'Starting Equipment': "Choose A or B: (A) Leather Armor, 2 Daggers, Shortsword, Shortbow, 20 Arrows, Quiver, Thieves' Tools, Burglar's Pack and 8 GP; or (B) 100 GP",
    },
    columns: { 'Sneak Attack': Array.from({ length: 20 }, (_, i) => `${Math.ceil((i + 1) / 2)}d6`) },
    features: feats(`
      1|Expertise|Expertise in two skills you're proficient in.
      1|Sneak Attack|Once a turn, deal extra damage (the Sneak Attack column) with a Finesse or ranged weapon hit when you have advantage, or when an ally is next to the target and you don't have disadvantage.
      1|Thieves' Cant|You know the rogues' secret tongue and one more language.
      1|Weapon Mastery|Use the mastery properties of two kinds of weapons, swapped after a long rest.
      2|Cunning Action|Bonus action: Dash, Disengage or Hide.
      3|Rogue Subclass|Choose an archetype: Arcane Trickster, Assassin, Soulknife or Thief.
      3|Steady Aim|Bonus action if you haven't moved: advantage on your next attack this turn; your speed is 0 until the end of the turn.
      4|${ASI}|${ASI_TEXT}
      5|Cunning Strike|Give up Sneak Attack dice for effects: Poison (1d6, Con save or poisoned), Trip (1d6, Dex save or prone), Withdraw (1d6, move half speed without provoking).
      5|Uncanny Dodge|Reaction: halve the damage of an attack that hits you.
      6|Expertise|Expertise in two more skills.
      7|Evasion|On a Dexterity save for half damage, take none on a success and half on a failure.
      7|Reliable Talent|Treat a d20 roll of 9 or lower as a 10 on checks with a skill or tool you're proficient in.
      8|${ASI}|${ASI_TEXT}
      9|${SUB}|A feature from your archetype.
      10|${ASI}|${ASI_TEXT}
      11|Improved Cunning Strike|Use two Cunning Strike effects at once.
      12|${ASI}|${ASI_TEXT}
      13|${SUB}|A feature from your archetype.
      14|Devious Strikes|New Cunning Strike effects: Daze (2d6), Knock Out (6d6, unconscious) and Obscure (3d6, blinded).
      15|Slippery Mind|Proficiency in Wisdom and Charisma saves.
      16|${ASI}|${ASI_TEXT}
      17|${SUB}|A feature from your archetype.
      18|Elusive|No attack roll has advantage against you unless you're incapacitated.
      19|Epic Boon|${BOON_TEXT}
      20|Stroke of Luck|Once per short or long rest, turn a failed d20 test into a 20.
    `),
    subclasses: {
      'Arcane Trickster': {
        intro: 'A rogue who sharpens their tricks with wizard magic. They prepare spells from the wizard list with Intelligence, with a third of a full caster\'s spell slots (see the Arcane Trickster Spellcasting table below).',
        caster: 'third',
        features: feats(`
          3|Spellcasting|Cast wizard spells with Intelligence: Mage Hand and two other cantrips, and three prepared spells at 3rd level, reaching 4th-level spells at 19th (see the Arcane Trickster table). Any wizard spell can be chosen.
          3|Mage Hand Legerdemain|Your Mage Hand is invisible, can pick locks and pockets, and you control it as a bonus action.
          9|Magical Ambush|A creature has disadvantage on saves against your spells if you're hidden from it when you cast.
          13|Versatile Trickster|Use Trip from Cunning Strike through your Mage Hand on a creature next to it.
          17|Spell Thief|Reaction when a spell targets you: the caster makes a save, and on a failure the spell fails and you can cast it for 8 hours. Once per long rest.
        `),
      },
      Assassin: {
        intro: 'A rogue trained in disguise, poison and the killing strike.',
        features: feats(`
          3|Assassinate|Advantage on initiative, and on the first round, advantage on attacks against any creature that hasn't acted yet, with extra damage equal to your rogue level on a Sneak Attack.
          3|Assassin's Tools|A disguise kit and a poisoner's kit, with proficiency in both.
          9|Infiltration Expertise|Mimic speech and handwriting, and Steady Aim doesn't stop your movement.
          13|Envenom Weapons|Your Poison Cunning Strike also deals 2d6 poison damage, ignoring resistance.
          17|Death Strike|On the first round, a creature you Sneak Attack makes a Constitution save or takes double damage.
        `),
      },
      Soulknife: {
        intro: 'A rogue who strikes with blades of psychic force.',
        features: feats(`
          3|Psionic Power|Psionic dice (four d6s at first) regained on a long rest, one back on a short rest. Psi-Bolstered Knack (add a die to a failed skill check) and Psychic Whispers (telepathy with up to PB creatures for hours).
          3|Psychic Blades|Manifest a psychic blade when you attack: 1d6 psychic (Finesse, Thrown 60 feet), and a 1d4 off-hand blade as a bonus action.
          9|Soul Blades|Homing Strikes (add a die to a missed blade attack) and Psychic Teleportation (throw a blade and teleport to where it lands).
          13|Psychic Veil|Become invisible for an hour, once per long rest or for a die.
          17|Rend Mind|When you Sneak Attack with a blade, the target makes a Wisdom save or is stunned for a minute. Once per long rest, or for three dice.
        `),
      },
      Thief: {
        intro: 'A rogue skilled in burglary and quick hands.',
        features: feats(`
          3|Fast Hands|Cunning Action can also make a Sleight of Hand check, use thieves' tools, or use a magic item that takes an action.
          3|Second-Story Work|A climb speed equal to your speed, and jump with Dexterity.
          9|Supreme Sneak|A Stealth Attack Cunning Strike: keep hiding after attacking.
          13|Use Magic Device|Attune to four items, use spell scrolls, and roll to keep charges.
          17|Thief's Reflexes|Take two turns in the first round of combat.
        `),
      },
    },
  },

  Sorcerer: {
    intro: 'Spellcasters with magic in their blood. A sorcerer\'s power comes from within, and they can bend and twist their spells as they cast.',
    core: {
      'Primary Ability': 'Charisma', 'Hit Point Die': 'D6 per Sorcerer level', 'Saving Throw Proficiencies': 'Constitution and Charisma',
      'Skill Proficiencies': 'Choose 2: Arcana, Deception, Insight, Intimidation, Persuasion or Religion',
      'Weapon Proficiencies': 'Simple weapons', 'Armor Training': 'None',
      'Starting Equipment': "Choose A or B: (A) Spear, 2 Daggers, Arcane Focus (crystal), Dungeoneer's Pack and 28 GP; or (B) 50 GP",
    },
    columns: {
      'Sorcery Points': col([[1, '—'], ...Array.from({ length: 19 }, (_, i) => [i + 2, i + 2])]), Cantrips: col([[1, 4], [4, 5], [10, 6]]),
      'Prepared Spells': byLevel(2, 4, 6, 7, 9, 10, 11, 12, 14, 15, 16, 16, 17, 17, 18, 18, 19, 20, 21, 22), ...slotCols(FULL_SLOTS, 9),
    },
    features: feats(`
      1|Spellcasting|You cast sorcerer spells with Charisma, using an arcane focus. Swap one when you gain a level.
      1|Innate Sorcery|Bonus action, twice per long rest: for a minute, +1 to your spell save DC and advantage on sorcerer spell attacks.
      2|Font of Magic|Sorcery points (the Sorcery Points column), back on a long rest. Turn slots into points or points into slots (no higher than 5th).
      2|Metamagic|Learn two Metamagic options to shape your spells with sorcery points (more at 10th and 17th).
      3|Sorcerer Subclass|Choose an origin: Aberrant, Clockwork, Draconic or Wild Magic.
      4|${ASI}|${ASI_TEXT}
      5|Sorcerous Restoration|Once per long rest, a short rest restores sorcery points up to half your sorcerer level.
      6|${SUB}|A feature from your origin.
      7|Sorcery Incarnate|With no Innate Sorcery left, spend 2 points to use it; while it's on, use two Metamagic options on one spell.
      8|${ASI}|${ASI_TEXT}
      10|Metamagic|Learn two more Metamagic options.
      12|${ASI}|${ASI_TEXT}
      14|${SUB}|A feature from your origin.
      16|${ASI}|${ASI_TEXT}
      17|Metamagic|Learn two more Metamagic options.
      18|${SUB}|A feature from your origin.
      19|Epic Boon|${BOON_TEXT}
      20|Arcane Apotheosis|While Innate Sorcery is on, one Metamagic option a turn costs no points.
    `),
    subclasses: {
      'Aberrant Sorcery': {
        intro: 'Power from a far realm, or an alien mind.',
        spells: { 3: ['Arms of Hadar', 'Calm Emotions', 'Detect Thoughts', 'Dissonant Whispers', 'Mind Sliver'], 5: ['Hunger of Hadar', 'Sending'], 7: ["Evard's Black Tentacles", 'Summon Aberration'], 9: ["Rary's Telepathic Bond", 'Telekinesis'] },
        features: feats(`
          3|Psionic Spells|Arms of Hadar, Calm Emotions, Detect Thoughts, Dissonant Whispers and Mind Sliver always prepared, with more at 5th, 7th and 9th level.
          3|Telepathic Speech|Bonus action: telepathy with a creature within 30 feet for minutes equal to your sorcerer level.
          6|Psionic Sorcery|Cast a Psionic spell with sorcery points equal to its level and no components.
          6|Psychic Defenses|Resistance to psychic damage, and advantage on saves against charm and fear.
          14|Revelation in Flesh|Spend points for an hour of flight, swimming and water breathing, seeing the invisible, or slipping through tight spaces.
          18|Warping Implosion|Teleport 120 feet; creatures where you were take 3d10 force and are pulled in (Str save). Once per long rest, or for 5 points.
        `),
      },
      'Clockwork Sorcery': {
        intro: 'Power from the cosmic order of Mechanus.',
        spells: { 3: ['Aid', 'Alarm', 'Lesser Restoration', 'Protection from Evil and Good'], 5: ['Dispel Magic', 'Protection from Energy'], 7: ['Freedom of Movement', 'Summon Construct'], 9: ['Greater Restoration', 'Wall of Force'] },
        features: feats(`
          3|Clockwork Spells|Aid, Alarm, Lesser Restoration and Protection from Evil and Good always prepared, with more at 5th, 7th and 9th level, plus a sign of order.
          3|Restore Balance|Reaction: cancel advantage or disadvantage on a d20 roll within 60 feet. Cha-modifier uses per long rest.
          6|Bastion of Law|Spend 1 to 5 points: a creature gets that many d8s to soak damage.
          14|Trance of Order|Bonus action for a minute: rolls under 10 count as 10, and attacks against you can't have advantage. Once per long rest, or for 5 points.
          18|Clockwork Cavalcade|A 30-foot cube of spirits: heal 100 hit points among those in it, repair objects, and end spells of 6th level or lower. Once per long rest, or for 7 points.
        `),
      },
      'Draconic Sorcery': {
        intro: 'Power from a dragon ancestor.',
        spells: { 3: ['Alter Self', 'Chromatic Orb', 'Command', "Dragon's Breath"], 5: ['Fear', 'Fly'], 7: ['Arcane Eye', 'Charm Monster'], 9: ['Legend Lore', 'Summon Dragon'] },
        features: feats(`
          3|Draconic Resilience|Hit point maximum +1 per sorcerer level, and without armour AC is 10 + Dex + Cha.
          3|Draconic Spells|Alter Self, Chromatic Orb, Command and Dragon's Breath always prepared, with more at 5th, 7th and 9th level.
          6|Elemental Affinity|Choose acid, cold, fire, lightning or poison: resistance to it, and add Charisma to one damage roll of a spell of that type.
          14|Dragon Wings|Bonus action: sprout wings for an hour with a 60-foot fly speed. Once per long rest, or for 3 points.
          18|Dragon Companion|Summon Dragon always prepared, cast once per long rest without a slot and without concentration.
        `),
      },
      'Wild Magic Sorcery': {
        intro: 'Power from the chaos of raw magic.',
        features: feats(`
          3|Wild Magic Surge|Once a turn after casting a sorcerer spell with a slot, roll a d20: on a 20, roll on the Wild Magic Surge table.
          3|Tides of Chaos|Give yourself advantage on a d20 test. It comes back on a long rest, or when the DM has you roll a surge.
          6|Bend Luck|Reaction, 1 point: add or subtract 1d4 from a creature's d20 roll.
          14|Controlled Chaos|Roll twice on the surge table and pick one.
          18|Tamed Surge|Once per long rest, choose a surge effect instead of rolling.
        `),
      },
    },
  },

  Warlock: {
    intro: 'Seekers of the knowledge hidden in the fabric of the multiverse, bound by a pact with a patron. Warlocks cast a few spells often, and gather eldritch invocations that grant uncanny gifts.',
    core: {
      'Primary Ability': 'Charisma', 'Hit Point Die': 'D8 per Warlock level', 'Saving Throw Proficiencies': 'Wisdom and Charisma',
      'Skill Proficiencies': 'Choose 2: Arcana, Deception, History, Intimidation, Investigation, Nature or Religion',
      'Weapon Proficiencies': 'Simple weapons', 'Armor Training': 'Light armor',
      'Starting Equipment': "Choose A or B: (A) Leather Armor, Sickle, 2 Daggers, Arcane Focus (orb), Book (occult lore), Scholar's Pack and 15 GP; or (B) 100 GP",
    },
    columns: {
      'Eldritch Invocations': byLevel(1, 3, 3, 3, 5, 5, 6, 6, 7, 7, 7, 8, 8, 8, 9, 9, 9, 10, 10, 10), Cantrips: col([[1, 2], [4, 3], [10, 4]]),
      'Prepared Spells': byLevel(2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15),
      'Spell Slots': byLevel(1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4), 'Slot Level': byLevel(1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5),
    },
    features: feats(`
      1|Eldritch Invocations|Gain invocations (the Eldritch Invocations column), each a lasting gift; some need a certain level or another invocation. Swap one when you gain a level.
      1|Pact Magic|You cast warlock spells with Charisma. All your slots are the same level and come back on a short or long rest.
      2|Magical Cunning|Once per long rest, a 1-minute rite restores half your pact slots.
      3|Warlock Subclass|Choose a patron: Archfey, Celestial, Fiend or Great Old One.
      4|${ASI}|${ASI_TEXT}
      6|${SUB}|A feature from your patron.
      8|${ASI}|${ASI_TEXT}
      9|Contact Patron|Contact Other Plane is always prepared, cast once per long rest without a slot, and you automatically succeed on its save.
      10|${SUB}|A feature from your patron.
      11|Mystic Arcanum|Choose one 6th-level warlock spell to cast once per long rest without a slot. More at 13th (7th level), 15th (8th) and 17th (9th).
      12|${ASI}|${ASI_TEXT}
      13|Mystic Arcanum|One 6th- and one 7th-level warlock spell, each cast once per long rest without a slot. More at 15th (8th level) and 17th (9th).
      14|${SUB}|A feature from your patron.
      15|Mystic Arcanum|One 6th-, 7th- and 8th-level warlock spell, each cast once per long rest without a slot. A 9th-level one at 17th.
      16|${ASI}|${ASI_TEXT}
      17|Mystic Arcanum|One warlock spell each of 6th, 7th, 8th and 9th level, each cast once per long rest without a slot.
      19|Epic Boon|${BOON_TEXT}
      20|Eldritch Master|Magical Cunning restores all your pact slots.
    `),
    subclasses: {
      'Archfey Patron': {
        intro: 'A bargain with a lord or lady of the fey.',
        spells: { 3: ['Calm Emotions', 'Faerie Fire', 'Misty Step', 'Phantasmal Force', 'Sleep'], 5: ['Blink', 'Plant Growth'], 7: ['Dominate Beast', 'Greater Invisibility'], 9: ['Dominate Person', 'Seeming'] },
        features: feats(`
          3|Archfey Spells|Calm Emotions, Faerie Fire, Misty Step, Phantasmal Force and Sleep always prepared, with more at 5th, 7th and 9th level.
          3|Steps of the Fey|Cast Misty Step without a slot (Cha-modifier times per long rest), with a refreshing step (temporary hit points) or a taunting step (disadvantage on attacks against others).
          6|Misty Escape|Cast Misty Step as a reaction when you take damage, and gain Disappearing Step (invisible) or Dreadful Step (2d10 psychic to those near you).
          10|Beguiling Defenses|Immune to charmed, and a reaction to turn a charm back on its caster, with psychic damage.
          14|Bewitching Magic|After casting an enchantment or illusion spell with a slot, cast Misty Step free as part of it.
        `),
      },
      'Celestial Patron': {
        intro: 'A bond with a being of the Upper Planes.',
        spells: { 3: ['Aid', 'Cure Wounds', 'Guiding Bolt', 'Lesser Restoration', 'Light', 'Sacred Flame'], 5: ['Daylight', 'Revivify'], 7: ['Guardian of Faith', 'Wall of Fire'], 9: ['Greater Restoration', 'Summon Celestial'] },
        features: feats(`
          3|Celestial Spells|Aid, Cure Wounds, Guiding Bolt, Lesser Restoration, Light and Sacred Flame always prepared, with more at 5th, 7th and 9th level.
          3|Healing Light|A pool of d6s (1 + warlock level); bonus action to heal a creature within 60 feet with up to Cha-modifier dice.
          6|Radiant Soul|Resistance to radiant damage, and add Charisma to one roll of a spell's fire or radiant damage.
          10|Celestial Resilience|After a rest, you gain temporary hit points (warlock level + Cha) and up to five allies gain half as many.
          14|Searing Vengeance|When you or an ally makes a death save, rise to half hit points and blast nearby enemies with 2d8 + Cha radiant, blinding them. Once per long rest.
        `),
      },
      'Fiend Patron': {
        intro: 'A deal with a fiend of the Lower Planes.',
        spells: { 3: ['Burning Hands', 'Command', 'Scorching Ray', 'Suggestion'], 5: ['Fireball', 'Stinking Cloud'], 7: ['Fire Shield', 'Wall of Fire'], 9: ['Geas', 'Insect Plague'] },
        features: feats(`
          3|Dark One's Blessing|When an enemy near you drops to 0 hit points, or one you drop, gain temporary hit points equal to Cha + warlock level.
          3|Fiend Spells|Burning Hands, Command, Scorching Ray and Suggestion always prepared, with more at 5th, 7th and 9th level.
          6|Dark One's Own Luck|Add 1d10 to an ability check or save after rolling. Cha-modifier uses per long rest.
          10|Fiendish Resilience|After a rest, choose a damage type (not force) to resist.
          14|Hurl Through Hell|Once a turn when you hit, the target makes a Charisma save or vanishes through the Lower Planes and takes 8d10 psychic. Once per long rest, or for a pact slot.
        `),
      },
      'Great Old One Patron': {
        intro: 'A pact with an unknowable being from beyond.',
        spells: { 3: ['Detect Thoughts', 'Dissonant Whispers', 'Phantasmal Force', "Tasha's Hideous Laughter"], 5: ['Clairvoyance', 'Hunger of Hadar'], 7: ['Confusion', 'Summon Aberration'], 9: ['Modify Memory', 'Telekinesis'] },
        features: feats(`
          3|Awakened Mind|Bonus action: telepathy with a creature within 30 feet for minutes equal to your warlock level.
          3|Great Old One Spells|Detect Thoughts, Dissonant Whispers, Phantasmal Force and Tasha's Hideous Laughter always prepared, with more at 5th, 7th and 9th level.
          3|Psychic Spells|Your warlock spells can deal psychic damage, and enchantment and illusion spells need no verbal or somatic components.
          6|Clairvoyant Combatant|When you use Awakened Mind, the creature makes a Wisdom save or has disadvantage against you and you have advantage against it. Once per short or long rest, or for a slot.
          10|Eldritch Hex|Hex always prepared, and its target has disadvantage on saves of the ability you chose.
          10|Thought Shield|Resistance to psychic damage, and a creature that deals psychic damage to you takes the same.
          14|Create Thrall|Summon Aberration always prepared, cast without a slot once per long rest; the aberration gains temporary hit points and adds psychic damage.
        `),
      },
    },
  },

  Wizard: {
    intro: 'Scholars of magic who record their spells in a spellbook. Wizards master the widest range of spells of any class.',
    core: {
      'Primary Ability': 'Intelligence', 'Hit Point Die': 'D6 per Wizard level', 'Saving Throw Proficiencies': 'Intelligence and Wisdom',
      'Skill Proficiencies': 'Choose 2: Arcana, History, Insight, Investigation, Medicine, Nature or Religion',
      'Weapon Proficiencies': 'Simple weapons', 'Armor Training': 'None',
      'Starting Equipment': "Choose A or B: (A) 2 Daggers, Arcane Focus (Quarterstaff), Robe, Spellbook, Scholar's Pack and 5 GP; or (B) 55 GP",
    },
    columns: {
      Cantrips: col([[1, 3], [4, 4], [10, 5]]), 'Prepared Spells': byLevel(4, 5, 6, 7, 9, 10, 11, 12, 14, 15, 16, 16, 17, 18, 19, 21, 22, 23, 24, 25),
      ...slotCols(FULL_SLOTS, 9),
    },
    features: feats(`
      1|Spellcasting|You prepare wizard spells from your spellbook with Intelligence each long rest. The book starts with six 1st-level spells and gains two each level; you can copy more.
      1|Ritual Adept|Cast any ritual spell in your spellbook as a ritual without preparing it.
      1|Arcane Recovery|Once a day after a short rest, recover spell slots totalling half your wizard level (none of 6th level or higher).
      2|Scholar|Expertise in one of Arcana, History, Investigation, Medicine, Nature or Religion.
      3|Wizard Subclass|Choose a school: Abjurer, Diviner, Evoker or Illusionist.
      4|${ASI}|${ASI_TEXT}
      5|Memorize Spell|After a short rest, swap one prepared spell for another in your book.
      6|${SUB}|A feature from your school.
      8|${ASI}|${ASI_TEXT}
      10|${SUB}|A feature from your school.
      12|${ASI}|${ASI_TEXT}
      14|${SUB}|A feature from your school.
      16|${ASI}|${ASI_TEXT}
      18|Spell Mastery|Choose a 1st- and a 2nd-level spell that take an action: cast them at their lowest level without a slot, at will.
      19|Epic Boon|${BOON_TEXT}
      20|Signature Spells|Two 3rd-level spells are always prepared, and you can cast each once without a slot per short or long rest.
    `),
    subclasses: {
      Abjurer: {
        intro: 'A wizard of protective and banishing magic.',
        features: feats(`
          3|Abjuration Savant|Add two abjuration spells to your book for free, and one more each time you gain a new spell level.
          3|Arcane Ward|When you cast an abjuration spell with a slot, make or restore a ward that absorbs damage (twice your wizard level + Int).
          6|Projected Ward|Reaction: your ward takes the damage for a creature within 30 feet.
          10|Spell Breaker|Counterspell and Dispel Magic always prepared; add your proficiency bonus to their ability checks.
          14|Spell Resistance|Advantage on saves against spells, and resistance to spell damage.
        `),
      },
      Diviner: {
        intro: 'A wizard who sees what is coming.',
        features: feats(`
          3|Divination Savant|Add two divination spells to your book for free, and one more each time you gain a new spell level.
          3|Portent|After a long rest roll two d20s; replace any d20 test you can see with one of them.
          6|Expert Divination|After casting a divination spell of 2nd level or higher, regain a lower slot.
          10|The Third Eye|Bonus action until your next rest: darkvision, see the Ethereal Plane, or see invisible creatures.
          14|Greater Portent|Roll three d20s for Portent.
        `),
      },
      Evoker: {
        intro: 'A wizard of raw destructive energy.',
        features: feats(`
          3|Evocation Savant|Add two evocation spells to your book for free, and one more each time you gain a new spell level.
          3|Potent Cantrip|Your damage cantrips deal half damage on a miss or a successful save.
          6|Sculpt Spells|Protect a number of creatures from your evocation spells: they succeed on the save and take no damage.
          10|Empowered Evocation|Add Intelligence to one damage roll of your wizard evocation spells.
          14|Overchannel|Deal maximum damage with a 1st- to 5th-level spell. After the first time each long rest, it costs you necrotic damage.
        `),
      },
      Illusionist: {
        intro: 'A wizard of glamour and deception.',
        features: feats(`
          3|Illusion Savant|Add two illusion spells to your book for free, and one more each time you gain a new spell level.
          3|Improved Illusions|Cast illusions without verbal components, with longer range, and Minor Illusion makes sound and image together as a bonus action.
          6|Phantasmal Creatures|Summon Beast and Summon Fey always prepared; cast once each without a slot as illusions at half hit points.
          10|Illusory Self|Reaction when attacked: an illusion makes the attack miss. Once per short or long rest, or for a 2nd-level slot.
          14|Illusory Reality|When you cast an illusion spell with a slot, make one inanimate object in it real for a minute.
        `),
      },
    },
  },
};

/** The class reference for a class name, case-insensitive. */
export const classRef = name => CLASSES[Object.keys(CLASSES).find(k => k.toLowerCase() === String(name || '').trim().toLowerCase())] || null;
/** A subclass entry (by its full name or a word in it). */
export function subclassRef(cls, sub) {
  const c = classRef(cls);
  if (!c || !sub) return null;
  const t = String(sub).toLowerCase();
  const k = Object.keys(c.subclasses).find(n => n.toLowerCase() === t) || Object.keys(c.subclasses).find(n => t.includes(n.toLowerCase().replace(/^(path|college|circle|oath|warrior) of (the )?|( domain| sorcery| patron)$/g, '')));
  return k ? { name: k, ...c.subclasses[k] } : null;
}
const PLACEHOLDER = /^(Ability Score Improvement|Epic Boon|Subclass feature|\w+ Subclass)$/;
/**
 * The class and subclass features a character has at their level, in level order, leaving out the placeholders
 * (ability score improvements, "subclass feature" rows, the subclass choice itself). Each has from: class or subclass.
 */
export function featuresAt(cls, level, sub = '') {
  const c = classRef(cls);
  if (!c) return [];
  const l = Math.max(1, Math.min(20, Number(level) || 1));
  const s = l >= 3 ? subclassRef(cls, sub) : null;
  const own = c.features.filter(f => f.level <= l && !PLACEHOLDER.test(f.name)).map(f => ({ ...f, from: cls }));
  const subs = s ? s.features.filter(f => f.level <= l).map(f => ({ ...f, from: s.name })) : [];
  // Features gained again at a later level (Expertise, Metamagic) are listed once, with the later text.
  const seen = new Map();
  for (const f of [...own, ...subs].sort((a, b) => a.level - b.level)) seen.set(`${f.from}|${f.name}`, f);
  return [...seen.values()].sort((a, b) => a.level - b.level);
}
/** The numbers from a class's table at a level ("Rages 3, Rage Damage +2"), for the stat block. Spell slots left out. */
export function tableAt(cls, level) {
  const c = classRef(cls);
  if (!c) return [];
  const i = Math.max(1, Math.min(20, Number(level) || 1)) - 1;
  return Object.entries(c.columns).filter(([k]) => !/^\d(st|nd|rd|th)$/.test(k) && !['Prepared Spells', 'Cantrips'].includes(k))
    .map(([k, v]) => [k, v[i]]).filter(([, v]) => v && v !== '—');
}
/** Domain, oath and patron spells always prepared at a level. */
export function subclassSpellsAt(cls, sub, level) {
  const s = subclassRef(cls, sub);
  if (!s?.spells) return [];
  return Object.entries(s.spells).filter(([l]) => Number(level) >= Number(l)).flatMap(([, v]) => v);
}
