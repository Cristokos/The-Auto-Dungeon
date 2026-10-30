// Class options: the small picks a class or subclass makes from a list (a warlock's eldritch invocations, a battle
// master's maneuvers, a sorcerer's metamagic), as the Player's Handbook (2024) gives them. A sheet only shows the
// ones its class, subclass and level have. Each choice has a line on what it does, in short.
// Artificer is not in the Player's Handbook; its infusions follow Tasha's Cauldron of Everything.

/** The Player's Handbook (2024) subclasses, all chosen at 3rd level. */
export const SUBCLASSES = {
  Artificer: ['Alchemist', 'Armorer', 'Artillerist', 'Battle Smith'],
  Barbarian: ['Path of the Berserker', 'Path of the Wild Heart', 'Path of the World Tree', 'Path of the Zealot'],
  Bard: ['College of Dance', 'College of Glamour', 'College of Lore', 'College of Valor'],
  Cleric: ['Life Domain', 'Light Domain', 'Trickery Domain', 'War Domain'],
  Druid: ['Circle of the Land', 'Circle of the Moon', 'Circle of the Sea', 'Circle of the Stars'],
  Fighter: ['Battle Master', 'Champion', 'Eldritch Knight', 'Psi Warrior'],
  Monk: ['Warrior of Mercy', 'Warrior of Shadow', 'Warrior of the Elements', 'Warrior of the Open Hand'],
  Paladin: ['Oath of Devotion', 'Oath of Glory', 'Oath of the Ancients', 'Oath of Vengeance'],
  Ranger: ['Beast Master', 'Fey Wanderer', 'Gloom Stalker', 'Hunter'],
  Rogue: ['Arcane Trickster', 'Assassin', 'Soulknife', 'Thief'],
  Sorcerer: ['Aberrant Sorcery', 'Clockwork Sorcery', 'Draconic Sorcery', 'Wild Magic Sorcery'],
  Warlock: ['Archfey Patron', 'Celestial Patron', 'Fiend Patron', 'Great Old One Patron'],
  Wizard: ['Abjurer', 'Diviner', 'Evoker', 'Illusionist'],
};
export const SUBCLASS_LEVEL = 3;

// How many picks at a level: the last step reached in a [[level, count], …] table.
const steps = table => level => table.reduce((n, [l, c]) => level >= l ? c : n, 0);

const FIGHTING_STYLES = {
  Archery: '+2 to attack rolls with ranged weapons.',
  'Blind Fighting': 'Blindsight 10 feet.',
  Defense: '+1 AC while wearing armour.',
  Dueling: '+2 damage with a one-handed melee weapon and no other weapon.',
  'Great Weapon Fighting': 'Treat 1s and 2s on two-handed weapon damage dice as 3s.',
  Interception: 'Reaction: cut the damage to a nearby ally by 1d10 + proficiency bonus.',
  Protection: 'Reaction with a shield: impose disadvantage on an attack against a nearby ally.',
  'Thrown Weapon Fighting': 'Draw thrown weapons freely; +2 damage with them.',
  'Two-Weapon Fighting': 'Add the ability modifier to the off-hand attack\'s damage.',
  'Unarmed Fighting': 'Unarmed strikes deal 1d6 (1d8 with free hands) + Str, and 1d4 to a grappled foe.',
};
const MASTERY_WEAPONS = {
  Club: 'Slow', Dagger: 'Nick', Greatclub: 'Push', Handaxe: 'Vex', Javelin: 'Slow', 'Light Hammer': 'Nick', Mace: 'Sap', Quarterstaff: 'Topple',
  Sickle: 'Nick', Spear: 'Sap', Dart: 'Vex', 'Light Crossbow': 'Slow', Shortbow: 'Vex', Sling: 'Slow', Battleaxe: 'Topple', Flail: 'Sap',
  Glaive: 'Graze', Greataxe: 'Cleave', Greatsword: 'Graze', Halberd: 'Cleave', Lance: 'Topple', Longsword: 'Sap', Maul: 'Topple',
  Morningstar: 'Sap', Pike: 'Push', Rapier: 'Vex', Scimitar: 'Nick', Shortsword: 'Vex', Trident: 'Topple', Warhammer: 'Push', 'War Pick': 'Sap',
  Whip: 'Slow', Blowgun: 'Vex', 'Hand Crossbow': 'Vex', 'Heavy Crossbow': 'Push', Longbow: 'Slow', Musket: 'Slow', Pistol: 'Vex',
};
const MASTERY_TEXT = {
  Cleave: 'a hit lets you hit a second creature next to it',
  Graze: 'a miss still deals the ability modifier in damage',
  Nick: 'the light weapon\'s extra attack is part of the Attack action',
  Push: 'a hit pushes a Large or smaller creature 10 feet',
  Sap: 'a hit gives the target disadvantage on its next attack',
  Slow: 'a hit cuts the target\'s speed by 10 feet',
  Topple: 'a hit forces a Con save or the target falls prone',
  Vex: 'a hit gives you advantage on your next attack against it',
};
const FEATS = {
  'Ability Score Improvement': '+2 to one ability score or +1 to two.', Actor: 'Mimicry and advantage on impersonation; +1 Cha.',
  Athlete: 'Climb speed, quick standing, running jumps; +1 Str or Dex.', Charger: 'Dash and strike for extra damage or a push; +1 Str or Dex.',
  Chef: 'Treats that heal and give temporary hit points; +1 Con or Wis.', 'Crossbow Expert': 'No loading, no disadvantage in melee, two-weapon crossbows; +1 Dex.',
  Crusher: 'Bludgeoning hits push, crits give advantage to allies; +1 Str or Con.', 'Defensive Duelist': 'Reaction: add proficiency bonus to AC against a melee hit; +1 Dex.',
  'Dual Wielder': 'Extra attack with a non-light weapon in the off hand; +1 Str or Dex.', Durable: 'Advantage on death saves, bonus action hit die; +1 Con.',
  'Elemental Adept': 'Spells ignore resistance to a damage type, 1s count as 2s; +1 casting ability.', 'Fey Touched': 'Misty Step and a 1st-level divination or enchantment spell; +1 Int, Wis or Cha.',
  Grappler: 'Punch and grab in one attack, advantage on the grappled; +1 Str or Dex.', 'Great Weapon Master': 'Heavy weapon hits add proficiency bonus, crits and kills give a bonus attack; +1 Str.',
  'Heavily Armored': 'Heavy armour training; +1 Con or Str.', 'Heavy Armor Master': 'Cut bludgeoning, piercing and slashing damage by proficiency bonus in heavy armour; +1 Con or Str.',
  'Inspiring Leader': 'After a rest, allies gain temporary hit points; +1 Wis or Cha.', 'Keen Mind': 'A knowledge skill, Study as a bonus action; +1 Int.',
  'Lightly Armored': 'Light armour and shield training; +1 Str or Dex.', 'Mage Slayer': 'Concentration breakers, auto-succeed a mental save once; +1 Str or Dex.',
  'Martial Weapon Training': 'Martial weapon training; +1 Str or Dex.', 'Medium Armor Master': 'Dex up to +3 in medium armour; +1 Str or Dex.',
  'Moderately Armored': 'Medium armour and shield training; +1 Str or Dex.', 'Mounted Combatant': 'Advantage against the unmounted, protect the mount; +1 Str, Dex or Wis.',
  Observant: 'An awareness skill, Search as a bonus action; +1 Int or Wis.', Piercer: 'Reroll a piercing damage die, bigger crits; +1 Str or Dex.',
  Poisoner: 'Brew poison doses, poison damage ignores resistance; +1 Dex or Int.', 'Polearm Master': 'Bonus attack with the butt end, strike those who come into reach; +1 Str or Dex.',
  Resilient: 'Proficiency in one saving throw; +1 to that ability.', 'Ritual Caster': 'Cast ritual spells from a list; +1 Int, Wis or Cha.',
  Sentinel: 'Opportunity attacks stop movement and protect allies; +1 Str or Dex.', 'Shadow Touched': 'Invisibility and a 1st-level illusion or necromancy spell; +1 Int, Wis or Cha.',
  Sharpshooter: 'Ignore cover, no long-range or melee disadvantage; +1 Dex.', 'Shield Master': 'Shield bash push or prone, shield on Dex saves; +1 Str.',
  'Skill Expert': 'A skill, and expertise in one; +1 to any ability.', Skulker: 'Blindsight 10 feet, hide in fog, misses keep you hidden; +1 Dex.',
  Slasher: 'Slashing hits slow, crits impose disadvantage; +1 Str or Dex.', Speedy: '+10 speed, difficult terrain from Dash is ignored; +1 Dex or Con.',
  'Spell Sniper': 'Longer range for attack spells, no cover; +1 casting ability.', Telekinetic: 'Mage Hand unseen, bonus action shove; +1 Int, Wis or Cha.',
  Telepathic: 'Telepathy 60 feet and Detect Thoughts; +1 Int, Wis or Cha.', 'War Caster': 'Advantage on concentration, spells as opportunity attacks; +1 Int, Wis or Cha.',
  'Weapon Master': 'The mastery property of one more weapon; +1 Str or Dex.',
};
const EPIC_BOONS = {
  'Boon of Combat Prowess': 'Once a turn, turn a miss into a hit.', 'Boon of Dimensional Travel': 'Teleport 30 feet after an attack or spell.',
  'Boon of Energy Resistance': 'Resist two damage types and redirect them.', 'Boon of Fate': 'Add or take 2d4 from a nearby roll.',
  'Boon of Fortitude': '+40 hit point maximum and extra healing.', 'Boon of Irresistible Offense': 'Damage ignores resistance; a natural 20 deals extra.',
  'Boon of Recovery': 'Regain half your hit points once, and a pool of d10s to heal.', 'Boon of Skill': 'Proficiency in every skill, expertise in one.',
  'Boon of Speed': '+30 speed, disengage as a bonus action.', 'Boon of Spell Recall': 'Cast a 1st- to 4th-level spell without a slot once per rest.',
  'Boon of the Night Spirit': 'Invisible in dim light or darkness, resist damage there.', 'Boon of Truesight': 'Truesight 60 feet.',
};
// Levels that give a feat (Ability Score Improvement) for each class; fighters and rogues get extra.
const FEAT_LEVELS = { Fighter: [4, 6, 8, 12, 14, 16], Rogue: [4, 8, 10, 12, 16] };
const featCount = cls => level => (FEAT_LEVELS[cls] || [4, 8, 12, 16]).filter(l => level >= l).length;

/**
 * Every class option. `cls` and `sub` (a word the subclass name contains) say who has it, `count(level)` how many
 * picks, and `choices` maps each pick to a line on what it does; `min` gives the level a pick needs.
 */
export const CLASS_OPTIONS = [
  { key: 'fightingStyle', label: 'Fighting Style', cls: ['Fighter'], count: steps([[1, 1]]), choices: FIGHTING_STYLES },
  { key: 'fightingStyle', label: 'Fighting Style', cls: ['Fighter'], sub: 'Champion', count: steps([[1, 1], [7, 2]]), choices: FIGHTING_STYLES, replaces: true },
  { key: 'fightingStyle', label: 'Fighting Style', cls: ['Paladin'], count: steps([[2, 1]]), choices: { ...FIGHTING_STYLES, 'Blessed Warrior': 'Two cleric cantrips, cast with Charisma.' } },
  { key: 'fightingStyle', label: 'Fighting Style', cls: ['Ranger'], count: steps([[2, 1]]), choices: { ...FIGHTING_STYLES, 'Druidic Warrior': 'Two druid cantrips, cast with Wisdom.' } },
  { key: 'mastery', label: 'Weapon Mastery', cls: ['Barbarian'], count: steps([[1, 2], [4, 3], [10, 4]]), choices: 'weapons' },
  { key: 'mastery', label: 'Weapon Mastery', cls: ['Fighter'], count: steps([[1, 3], [4, 4], [10, 5], [16, 6]]), choices: 'weapons' },
  { key: 'mastery', label: 'Weapon Mastery', cls: ['Paladin', 'Ranger', 'Rogue'], count: steps([[1, 2]]), choices: 'weapons' },
  { key: 'invocations', label: 'Eldritch Invocations', cls: ['Warlock'], count: steps([[1, 1], [2, 3], [5, 5], [7, 6], [9, 7], [12, 8], [15, 9], [18, 10]]), choices: {
    'Pact of the Blade': 'Conjure or bond a pact weapon; attack with Charisma.', 'Pact of the Chain': 'Find Familiar with special forms; it can attack.',
    'Pact of the Tome': 'A Book of Shadows with three cantrips and two rituals.', 'Armor of Shadows': 'Mage Armor at will.',
    'Eldritch Mind': 'Advantage on Constitution saves to keep concentration.', 'Agonizing Blast': 'Add Charisma to the damage of a warlock damage cantrip.',
    "Devil's Sight": 'See normally in magical and nonmagical darkness to 120 feet.', 'Eldritch Spear': 'A damage cantrip reaches 30 feet × warlock level.',
    'Fiendish Vigor': 'False Life at will, at its highest number.', 'Lessons of the First Ones': 'An origin feat.',
    'Mask of Many Faces': 'Disguise Self at will.', 'Misty Visions': 'Silent Image at will.', 'Otherworldly Leap': 'Jump at will, on yourself.',
    'Repelling Blast': 'A damage cantrip hit pushes Large or smaller 10 feet.', 'Ascendant Step': 'Levitate at will, on yourself.',
    'Eldritch Smite': 'Spend a pact slot on a pact weapon hit: +1d8 per slot level and knock prone.', 'Gaze of Two Minds': 'See and hear through a willing creature, cast from it.',
    'Gift of the Depths': 'Breathe underwater, swim speed, Water Breathing once a day.', 'Investment of the Chain Master': 'The familiar flies or swims, attacks harder, resists.',
    'Master of Myriad Forms': 'Alter Self at will.', 'One with Shadows': 'Invisible in dim light or darkness until you act.', 'Thirsting Blade': 'Attack twice with the pact weapon.',
    'Whispers of the Grave': 'Speak with Dead at will.', 'Gift of the Protectors': 'Names in the Book of Shadows drop to 1 HP instead of 0, once each.',
    Lifedrinker: 'Pact weapon hits add 1d6 necrotic, psychic or radiant and can heal.', 'Visions of Distant Realms': 'Arcane Eye at will.',
    'Devouring Blade': 'Thirsting Blade becomes three attacks.', 'Witch Sight': 'Truesight 30 feet.',
  }, min: {
    'Agonizing Blast': 2, "Devil's Sight": 2, 'Eldritch Spear': 2, 'Fiendish Vigor': 2, 'Lessons of the First Ones': 2, 'Mask of Many Faces': 2, 'Misty Visions': 2,
    'Otherworldly Leap': 2, 'Repelling Blast': 2, 'Ascendant Step': 5, 'Eldritch Smite': 5, 'Gaze of Two Minds': 5, 'Gift of the Depths': 5,
    'Investment of the Chain Master': 5, 'Master of Myriad Forms': 5, 'One with Shadows': 5, 'Thirsting Blade': 5, 'Whispers of the Grave': 7,
    'Gift of the Protectors': 9, Lifedrinker: 9, 'Visions of Distant Realms': 9, 'Devouring Blade': 12, 'Witch Sight': 15,
  }, needs: {
    'Eldritch Smite': 'Pact of the Blade', 'Thirsting Blade': 'Pact of the Blade', Lifedrinker: 'Pact of the Blade', 'Devouring Blade': 'Thirsting Blade',
    'Investment of the Chain Master': 'Pact of the Chain', 'Gift of the Protectors': 'Pact of the Tome', 'Agonizing Blast': 'a warlock cantrip that deals damage',
    'Eldritch Spear': 'a warlock cantrip that deals damage', 'Repelling Blast': 'a warlock cantrip that deals damage',
  },
  // The older books' invocations (2014 Player's Handbook, Xanathar's and Tasha's), for tables that still use them.
  legacy: {
    'Beast Speech': 'Speak with Animals at will.', 'Beguiling Influence': 'Proficiency in Deception and Persuasion.',
    'Book of Ancient Secrets': 'Rituals from any class written into your Book of Shadows (Pact of the Tome).', 'Eldritch Sight': 'Detect Magic at will.',
    'Eyes of the Rune Keeper': 'Read all writing.', 'Thief of Five Fates': 'Bane once a long rest with a warlock slot.',
    'Aspect of the Moon': 'No need to sleep; rest by light activity (Pact of the Tome).', 'Grasp of Hadar': 'Once a turn, an eldritch blast hit pulls the target 10 feet.',
    'Improved Pact Weapon': '+1 pact weapon that can be a bow or crossbow, and a spellcasting focus (Pact of the Blade).',
    'Gift of the Ever-Living Ones': 'Healing dice roll their maximum while the familiar is near (Pact of the Chain).', 'Voice of the Chain Master': 'Speak through and sense through your familiar (Pact of the Chain).',
    'Cloak of Flies': 'Bonus action: an aura of flies for Intimidation advantage and Cha poison damage nearby, once a rest.', 'Far Scribe': 'Send messages to creatures who signed your book (Pact of the Tome).',
    'Maddening Hex': 'Bonus action: psychic damage (Cha) around your Hex or curse target.', 'Mire the Mind': 'Slow once a long rest with a warlock slot.',
    'Sign of Ill Omen': 'Bestow Curse once a long rest with a warlock slot.', 'Tomb of Levistus': 'Reaction: encase yourself in ice for temporary hit points, once a rest.',
    'Undying Servitude': 'Animate Dead once a long rest without a slot.', 'Bewitching Whispers': 'Compulsion once a long rest with a warlock slot.',
    'Dreadful Word': 'Confusion once a long rest with a warlock slot.', 'Ghostly Gaze': 'See through solid objects 30 feet for a minute, once a rest.',
    'Protection of the Talisman': 'The talisman wearer adds 1d4 to failed saves (Pact of the Talisman).', 'Relentless Hex': 'Teleport next to your curse target.',
    'Sculptor of Flesh': 'Polymorph once a long rest with a warlock slot.', "Trickster's Escape": 'Freedom of Movement on yourself once a long rest.',
    'Minions of Chaos': 'Conjure Elemental once a long rest with a warlock slot.', 'Rebuke of the Talisman': 'Reaction: psychic damage and a push to whoever hits the talisman wearer.',
    'Bond of the Talisman': 'Teleport to the talisman wearer, or bring them to you (Pact of the Talisman).', 'Chains of Carceri': 'Hold Monster at will on celestials, fiends and elementals (Pact of the Chain).',
    'Shroud of Shadow': 'Invisibility at will.', 'Pact of the Talisman': 'An amulet that adds 1d4 to failed ability checks (Tasha\'s).',
  }, legacyMin: {
    'Cloak of Flies': 5, 'Far Scribe': 5, 'Maddening Hex': 5, 'Mire the Mind': 5, 'Sign of Ill Omen': 5, 'Tomb of Levistus': 5, 'Undying Servitude': 5,
    'Bewitching Whispers': 7, 'Dreadful Word': 7, 'Ghostly Gaze': 7, 'Protection of the Talisman': 7, 'Relentless Hex': 7, 'Sculptor of Flesh': 7, "Trickster's Escape": 7,
    'Minions of Chaos': 9, 'Bond of the Talisman': 12, 'Chains of Carceri': 15, 'Shroud of Shadow': 15,
  } },
  { key: 'metamagic', label: 'Metamagic', cls: ['Sorcerer'], count: steps([[2, 2], [10, 4], [17, 6]]), choices: {
    'Careful Spell': '1 point: chosen creatures pass the save and take no damage.', 'Distant Spell': '1 point: double the range, or touch becomes 30 feet.',
    'Empowered Spell': '1 point: reroll damage dice up to your Charisma modifier.', 'Extended Spell': '1 point: double the duration, advantage on concentration.',
    'Heightened Spell': '2 points: one target has disadvantage on its saves.', 'Quickened Spell': '2 points: an action spell as a bonus action.',
    'Seeking Spell': '1 point: reroll a missed spell attack.', 'Subtle Spell': '1 point: no verbal, somatic or material components.',
    'Transmuted Spell': '1 point: swap the damage type among acid, cold, fire, lightning, poison and thunder.', 'Twinned Spell': '1 point: one more target for a single-target spell.',
  } },
  { key: 'maneuvers', label: 'Maneuvers', cls: ['Fighter'], sub: 'Battle Master', count: steps([[3, 3], [7, 5], [10, 7], [15, 9]]), note: 'Superiority dice: 4 d8 (5 at 7th level, 6 at 15th; d10 at 10th, d12 at 18th).', choices: {
    Ambush: 'Add the die to a Stealth check or initiative.', 'Bait and Switch': 'Swap places with an ally; one of you gains the die to AC.',
    "Commander's Strike": 'An ally strikes with its reaction, adding the die to damage.', 'Commanding Presence': 'Add the die to Intimidation, Performance or Persuasion.',
    'Disarming Attack': 'Add the die to damage; the target drops an item on a failed Str save.', 'Distracting Strike': 'Add the die to damage; an ally gets advantage on the target.',
    'Evasive Footwork': 'Move, and add the die to AC until you stop.', 'Feinting Attack': 'Bonus action: advantage on the next attack, die added to damage.',
    'Goading Attack': 'Add the die to damage; on a failed Wis save the target has disadvantage against others.', 'Lunging Attack': 'Step 5 feet more and add the die to damage.',
    'Maneuvering Attack': 'Add the die to damage; an ally moves without provoking.', 'Menacing Attack': 'Add the die to damage; the target is frightened on a failed Wis save.',
    Parry: 'Reaction: cut melee damage by the die + Str or Dex.', 'Precision Attack': 'Add the die to an attack roll.',
    'Pushing Attack': 'Add the die to damage; a failed Str save pushes it 15 feet.', Rally: 'Bonus action: an ally gains temporary hit points.',
    Riposte: 'Reaction when missed: attack back, adding the die to damage.', 'Sweeping Attack': 'On a hit, another creature in reach takes the die in damage.',
    'Tactical Assessment': 'Add the die to History, Insight or Investigation.', 'Trip Attack': 'Add the die to damage; a failed Str save knocks it prone.',
  } },
  { key: 'divineOrder', label: 'Divine Order', cls: ['Cleric'], count: steps([[1, 1]]), choices: {
    Protector: 'Martial weapons and heavy armour.', Thaumaturge: 'An extra cantrip and Wisdom to Arcana or Religion.' } },
  { key: 'blessedStrikes', label: 'Blessed Strikes', cls: ['Cleric'], count: steps([[7, 1]]), choices: {
    'Divine Strike': 'Once a turn, a weapon hit deals 1d8 (2d8 at 14th) necrotic or radiant.', 'Potent Spellcasting': 'Add Wisdom to cleric cantrip damage.' } },
  { key: 'primalOrder', label: 'Primal Order', cls: ['Druid'], count: steps([[1, 1]]), choices: {
    Magician: 'An extra cantrip and Wisdom to Arcana or Nature.', Warden: 'Martial weapons and medium armour.' } },
  { key: 'elementalFury', label: 'Elemental Fury', cls: ['Druid'], count: steps([[7, 1]]), choices: {
    'Potent Spellcasting': 'Add Wisdom to druid cantrip damage.', 'Primal Strike': 'Once a turn, a weapon or beast-form hit deals 1d8 (2d8 at 15th) cold, fire, lightning or thunder.' } },
  { key: 'land', label: 'Land', cls: ['Druid'], sub: 'Land', count: steps([[3, 1]]), note: 'Can change after a long rest.', choices: {
    Arid: 'Blur, Burning Hands, Fire Bolt; then Fireball, Blight, Wall of Stone.', Polar: 'Fog Cloud, Hold Person, Ray of Frost; then Sleet Storm, Ice Storm, Cone of Cold.',
    Temperate: 'Misty Step, Shocking Grasp, Sleep; then Lightning Bolt, Freedom of Movement, Tree Stride.', Tropical: 'Acid Splash, Ray of Sickness, Web; then Stinking Cloud, Polymorph, Insect Plague.' } },
  { key: 'rageOfTheWilds', label: 'Rage of the Wilds', cls: ['Barbarian'], sub: 'Wild Heart', count: steps([[3, 1]]), note: 'Chosen each time they rage.', choices: {
    Bear: 'Resist every damage but force, necrotic, psychic and radiant while raging.', Eagle: 'Disengage and Dash as a bonus action when raging.', Wolf: 'Allies have advantage on attacks against enemies next to you.' } },
  { key: 'aspectOfTheWilds', label: 'Aspect of the Wilds', cls: ['Barbarian'], sub: 'Wild Heart', count: steps([[6, 1]]), note: 'Can change after a long rest.', choices: {
    Owl: 'Darkvision 60 feet (or 60 more).', Panther: 'Climb speed equal to speed.', Salmon: 'Swim speed equal to speed.' } },
  { key: 'powerOfTheWilds', label: 'Power of the Wilds', cls: ['Barbarian'], sub: 'Wild Heart', count: steps([[14, 1]]), note: 'Chosen each time they rage.', choices: {
    Falcon: 'Fly speed while raging without armour.', Lion: 'Enemies next to you have disadvantage against others.', Ram: 'Melee hits knock Large or smaller prone.' } },
  { key: 'huntersPrey', label: "Hunter's Prey", cls: ['Ranger'], sub: 'Hunter', count: steps([[3, 1]]), note: 'Can change after a rest.', choices: {
    'Colossus Slayer': 'Once a turn, +1d8 damage to a creature below its hit point maximum.', 'Horde Breaker': 'Once a turn, an extra attack on a second creature nearby.' } },
  { key: 'defensiveTactics', label: 'Defensive Tactics', cls: ['Ranger'], sub: 'Hunter', count: steps([[7, 1]]), note: 'Can change after a rest.', choices: {
    'Escape the Horde': 'Opportunity attacks against you have disadvantage.', 'Multiattack Defense': 'After a creature hits you, its other attacks this turn have disadvantage.' } },
  { key: 'companion', label: 'Primal Companion', cls: ['Ranger'], sub: 'Beast Master', count: steps([[3, 1]]), choices: {
    'Beast of the Land': 'Charges to knock prone; climbs.', 'Beast of the Sea': 'Swims, breathes water; its hits grapple.', 'Beast of the Sky': 'Flies; flyby keeps it safe.' } },
  { key: 'elementalAffinity', label: 'Elemental Affinity', cls: ['Sorcerer'], sub: 'Draconic', count: steps([[6, 1]]), choices: {
    Acid: 'Resist acid; add Charisma to acid spell damage.', Cold: 'Resist cold; add Charisma to cold spell damage.', Fire: 'Resist fire; add Charisma to fire spell damage.',
    Lightning: 'Resist lightning; add Charisma to lightning spell damage.', Poison: 'Resist poison; add Charisma to poison spell damage.' } },
  { key: 'infusions', label: 'Infusions known', cls: ['Artificer'], count: steps([[2, 4], [6, 6], [10, 8], [14, 10], [18, 12]]), note: 'From Tasha\'s Cauldron of Everything. Infused items: half as many as infusions known.', choices: {
    'Enhanced Arcane Focus': '+1 spell attacks and ignore half cover (+2 at 10th).', 'Enhanced Defense': '+1 AC for armour or a shield (+2 at 10th).',
    'Enhanced Weapon': '+1 attack and damage (+2 at 10th).', 'Homunculus Servant': 'A small helper that flies and delivers touch spells.',
    'Repeating Shot': '+1 to a ranged weapon, no loading, makes its own ammunition.', 'Returning Weapon': '+1 to a thrown weapon, which flies back.',
    'Replicate Magic Item': 'Make a common or uncommon item from the artificer list.', 'Mind Sharpener': 'Reaction: turn a failed concentration save into a success.',
    'Repulsion Shield': '+1 AC; reaction pushes an attacker 15 feet.', 'Resistant Armor': 'Resistance to one damage type.',
    'Spell-Refueling Ring': 'Once a day, recover a 3rd-level or lower slot.', 'Boots of the Winding Path': 'Teleport back 15 feet to a spot you were in.',
    'Radiant Weapon': '+1 weapon that sheds light and can blind an attacker.',
  }, min: { 'Homunculus Servant': 2, 'Mind Sharpener': 6, 'Repulsion Shield': 6, 'Resistant Armor': 6, 'Spell-Refueling Ring': 6, 'Boots of the Winding Path': 6, 'Radiant Weapon': 6 } },
  { key: 'feats', label: 'Feats', cls: '*', count: null, choices: FEATS, note: 'An Ability Score Improvement level can take a feat instead.' },
  { key: 'epicBoon', label: 'Epic Boon', cls: '*', count: steps([[19, 1]]), choices: EPIC_BOONS },
];
/** A weapon's mastery property and what it does, when the character picked that weapon for Weapon Mastery; else null. */
export function masteryOf(m, weapon) {
  const picked = Array.isArray(m.classOpts?.mastery) ? m.classOpts.mastery : [];
  const name = String(weapon || '').toLowerCase();
  const w = picked.find(x => name === x.toLowerCase() || new RegExp(`\\b${x.toLowerCase()}\\b`).test(name));
  return w && MASTERY_WEAPONS[w] ? { weapon: w, name: MASTERY_WEAPONS[w], text: MASTERY_TEXT[MASTERY_WEAPONS[w]] } : null;
}
for (const o of CLASS_OPTIONS) if (o.choices === 'weapons') o.choices = Object.fromEntries(Object.entries(MASTERY_WEAPONS).map(([w, k]) => [w, `${k}: ${MASTERY_TEXT[k]}.`]));

const list = x => Array.isArray(x) ? x : [];
const hasSub = (o, sub) => !o.sub || new RegExp(`\\b${o.sub}\\b`, 'i').test(String(sub || ''));
/**
 * The class options a character has: for their class, subclass (only from 3rd level) and level, each with how many
 * picks it allows, the choices open to them, and what they have picked.
 */
export function classOptionsFor(m) {
  const cls = String(m.class || '');
  const level = Math.max(1, Math.min(20, Number(m.level) || 1));
  const sub = level >= SUBCLASS_LEVEL ? m.subclass : '';
  const picked = m.classOpts || {};
  const out = new Map();
  for (const o of CLASS_OPTIONS) {
    if (o.cls !== '*' && !o.cls.includes(cls)) continue;
    if (!hasSub(o, sub) || (o.sub && !sub)) continue;
    const count = o.count ? o.count(level) : featCount(cls)(level);
    if (!count) continue;
    // A subclass version (a champion's second fighting style) takes the place of the class's own.
    if (out.has(o.key) && !o.replaces) continue;
    const choices = Object.fromEntries(Object.entries(o.choices).filter(([n]) => (o.min?.[n] || 0) <= level));
    // The ones a higher level opens, so the whole list shows (greyed) with the level each needs.
    const locked = Object.fromEntries(Object.entries(o.min || {}).filter(([n, l]) => l > level && o.choices[n]));
    const legacy = Object.fromEntries(Object.entries(o.legacy || {}).filter(([n]) => (o.legacyMin?.[n] || 0) <= level && !o.choices[n]));
    const legacyLocked = Object.fromEntries(Object.entries(o.legacyMin || {}).filter(([n, l]) => l > level && o.legacy?.[n]));
    out.set(o.key, { key: o.key, label: o.label, note: o.note || '', count, choices, locked, legacy, legacyLocked, needs: o.needs || {}, picked: list(picked[o.key]), all: { ...o.legacy, ...o.choices } });
  }
  return [...out.values()];
}
/** What a pick does, from any option's list. */
export const classChoiceText = (key, name) => { const o = CLASS_OPTIONS.find(x => x.key === key && (x.choices[name] || x.legacy?.[name])); return o ? o.choices[name] || o.legacy[name] : ''; };

/** The subclass list entry a typed-in or stat block subclass matches ("School of Evocation" → Evoker stays as typed). */
export function matchSubclass(cls, text) {
  const t = String(text || '').trim();
  if (!t) return '';
  const known = SUBCLASSES[cls] || [];
  return known.find(s => s.toLowerCase() === t.toLowerCase()) || known.find(s => new RegExp(`\\b${s.replace(/^(Path|College|Circle|Oath|Warrior) of (the )?|( Domain| Sorcery| Patron)$/g, '')}\\b`, 'i').test(t)) || t;
}

/** Picks for someone who hasn't chosen (an NPC): anything its text names first, then the same picks each time for the same seed. */
export function autoClassOpts(m, seed = '', text = '') {
  let h = 0;
  for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const out = {};
  for (const o of classOptionsFor({ ...m, classOpts: {} })) {
    const names = Object.keys(o.choices).filter(n => n !== 'Ability Score Improvement' && !['Musket', 'Pistol'].includes(n));
    const pick = names.filter(n => new RegExp(`\\b${n}s?\\b`, 'i').test(text)).slice(0, o.count);
    for (let i = 0; pick.length < Math.min(o.count, names.length); i++) {
      const n = names[(h + i * 7) % names.length];
      if (!pick.includes(n)) pick.push(n); else h++;
    }
    out[o.key] = pick;
  }
  return out;
}

/** The class options on a PDF sheet's features: "Eldritch invocations: **Agonizing Blast**, **Devil's Sight**." */
export function classOptionLines(m, picked = m.classOpts || {}) {
  return classOptionsFor({ ...m, classOpts: picked }).filter(o => o.picked.length)
    .map(o => `${o.label[0]}${o.label.slice(1).toLowerCase()}: ${o.picked.map(n => `**${n}**`).join(', ')}.`);
}
