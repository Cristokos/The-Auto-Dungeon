// Puzzles whose numbers, patterns and orders are rolled fresh each time, so the same
// puzzle plays differently in every space. A puzzle in the astral puzzleBank opts in
// with "vary": "<maker>"; the maker returns new setup, clues, solution and hints, and
// keeps the puzzle's name, failure and reward. Every maker checks its answer is the only one.

const rint = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
const shuffle = (rng, xs) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pickOne = (rng, xs) => xs[Math.floor(rng() * xs.length)];
const WORD = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const ORD = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'];
const listText = xs => xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
const cap = s => s[0].toUpperCase() + s.slice(1);

function permutations(xs) {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map(p => [x, ...p]));
}

// ---------- The Lock of Old Attempts: a code and the glows old guesses earned ----------
function lock(rng) {
  const codes = [];
  for (let a = 1; a <= 9; a++) for (let b = 1; b <= 9; b++) for (let c = 1; c <= 9; c++) if (a !== b && b !== c && a !== c) codes.push([a, b, c]);
  const score = (g, c) => ({ place: g.filter((d, i) => c[i] === d).length, other: g.filter((d, i) => c[i] !== d && c.includes(d)).length });
  const same = (x, y) => x.place === y.place && x.other === y.other;
  for (let tries = 0; tries < 300; tries++) {
    const code = pickOne(rng, codes);
    const attempts = [];
    let left = codes;
    while (left.length > 1 && attempts.length < 6) {
      // Of a few random guesses, keep the one that narrows things most, so five or six attempts settle it.
      let best = null;
      for (let k = 0; k < 12; k++) {
        const g = pickOne(rng, codes);
        const s = score(g, code);
        if (s.place === 3) continue;
        const rest = left.filter(c => same(score(g, c), s));
        if (rest.length < left.length && (!best || rest.length < best.rest.length)) best = { g, s, rest };
      }
      if (!best) break;
      attempts.push(best); left = best.rest;
    }
    if (left.length !== 1 || attempts.length < 4) continue;
    const glow = s => {
      if (!s.place && !s.other) return 'no glow at all';
      const parts = [];
      if (s.place) parts.push(`${WORD[s.place]} numeral${s.place > 1 ? 's' : ''} correct and in the right place`);
      if (s.other) parts.push(`${WORD[s.other]} ${s.place ? '' : `numeral${s.other > 1 ? 's' : ''} `}correct but in the wrong place`);
      return parts.join(', and ');
    };
    const dark = attempts.find(a => !a.s.place && !a.s.other);
    return {
      setup: `A vault door bears three dials, each turning through the numerals 1 to 9, and the true combination uses three different numerals. Around the door, earlier visitors have scratched their failed attempts along with the glow the lock gave each one. They read: ${attempts.map(a => `${a.g.join(' ')}, ${glow(a.s)}`).join('; ')}.`,
      clues: ['A numeral that is "correct" is in the combination somewhere; "in the right place" means it sits on the same dial as in the true answer.',
        dark ? `The attempt ${dark.g.join(' ')} rules out ${listText(dark.g.map(String))} completely.` : 'Every old attempt got at least some glow, so compare the attempts that share numerals.'],
      solution: `The combination is ${code.join(', ')}, the only combination that fits every glow.`,
      hints: [
        { check: 'Intelligence (Investigation)', text: dark ? `The attempt ${dark.g.join(' ')} glowed not at all, so none of its numerals is in the code.` : 'Line up the attempts that share a numeral and compare their glows.' },
        { check: 'Intelligence', text: `The first numeral is ${code[0]}.` },
        { check: 'Wisdom (Insight)', text: `The code ends in ${code[2]}.` },
      ],
      table: `Write the ${WORD[attempts.length]} old attempts and their glows on paper exactly as given, and let players cross off numerals as they reason.`,
    };
  }
  return null;
}

// ---------- The Silent Sigil: a fresh pattern of suns and moons ----------
function sigil(rng) {
  const cells = shuffle(rng, [...Array(16).keys()]);
  const suns = rint(rng, 3, 5), moons = rint(rng, 2, 3);
  const grid = Array(16).fill('empty');
  cells.slice(0, suns).forEach(i => { grid[i] = 'sun'; });
  cells.slice(suns, suns + moons).forEach(i => { grid[i] = 'moon'; });
  const rows = [0, 1, 2, 3].map(r => `Row ${r + 1}: ${grid.slice(r * 4, r * 4 + 4).join(', ')}.`).join(' ');
  const where = kind => grid.map((g, i) => g === kind ? `row ${Math.floor(i / 4) + 1} column ${i % 4 + 1}` : null).filter(Boolean);
  return {
    clues: [`Show one player: (In the sigil room) The sigil, rows from the top, columns from the left. ${rows} Only gestures and knocks reach the pegboard room.`,
      `Show one player: (In the pegboard room) Draw a four by four grid on paper: that is your pegboard. Your bowl holds ${WORD[suns + 2]} sun pegs and ${WORD[moons + 1]} moon pegs; not all are needed. A note on the frame reads, 'Rows count from the top, columns from the left. Press the frame when the board is complete; a wrong board burns.'`],
    solution: `Sun pegs go in ${listText(where('sun'))}; moon pegs go in ${listText(where('moon'))}; every other hole stays empty.`,
    hints: [
      { check: 'Intelligence', text: 'Knocks can carry numbers: one group of knocks for the row, a pause, then one group for the column.' },
      { check: 'Wisdom (Insight)', text: 'Agree on a sign for each peg before you start, such as pointing up for sun and down for moon.' },
      { check: 'Wisdom (Perception)', text: `The sigil holds ${WORD[suns]} suns and ${WORD[moons]} moons; every other hole stays empty.` },
    ],
  };
}

// ---------- The Tally Tiles: a count to encode and a sum for the lock ----------
function tally(rng) {
  const [beast, perch] = pickOne(rng, [['ravens', 'perched on the frame'], ['bats', 'hanging from the frame'], ['doves', 'perched on the frame'], ['owls', 'perched on the frame']]);
  const rows = rint(rng, 3, 5), per = rint(rng, 4, 7), extra = rint(rng, 1, 6);
  const n = rows * per + extra;
  const [say, k] = pickOne(rng, [['twice', 2], ['three times', 3]]);
  const code = String(n * k).padStart(3, '0');
  const t = Math.floor(n / 10), s = Math.floor((n % 10) / 5), l = n % 5;
  const tiles = [t && `${WORD[t]} triangle${t > 1 ? 's' : ''}`, s && 'one star', l && `${WORD[l]} line${l > 1 ? 's' : ''}`].filter(Boolean);
  return {
    clues: [`Tell one player privately: (In the gallery) The mural shows ${beast}: ${WORD[rows]} rows of ${WORD[per]} ${beast} each, and ${WORD[extra]} more ${perch}. Your basket holds ${WORD[t + 1]} triangle tiles, two star tiles and six line tiles. Only tiles hung on the board can be seen from the tower.`,
      `Tell one player privately: (In the tower) Your lock has three number wheels, each from 0 to 9. Its rim reads, 'Give me ${say} what the wall holds.'`],
    solution: `There are ${n} ${beast}, so the gallery player hangs ${listText(tiles)}; the tower reads ${n}, multiplies it by ${k} and sets the lock to ${code}.`,
    hints: [
      { check: 'Wisdom (Perception)', text: `Count the ${beast} ${perch.replace(/^(perched|hanging) /, '')} as well as the rows.` },
      { check: 'Intelligence', text: 'Use the biggest tiles first: as many triangles as fit, then a star, then lines.' },
      { check: 'Intelligence (Investigation)', text: 'The tower must do something with the number before it goes into the lock.' },
    ],
  };
}

// ---------- The Two Houses of Light: which runes glow ----------
const RUNES = ['hammer', 'tongs', 'single moon', 'twin moons', 'open hand', 'fist', 'whole chain', 'broken chain', 'crown'];
const RUNE_TWIN = { 'single moon': 'twin moons', 'twin moons': 'single moon', 'open hand': 'fist', fist: 'open hand', 'whole chain': 'broken chain', 'broken chain': 'whole chain', hammer: 'tongs', tongs: 'hammer' };
const article = r => ['twin moons', 'tongs'].includes(r) ? r : /^[aeiou]/.test(r.split(' ')[0]) || r.startsWith('open') ? `an ${r}` : `a ${r}`;
function houses(rng) {
  const lit = shuffle(rng, RUNES).slice(0, rint(rng, 3, 5));
  const litSet = new Set(lit);
  const dark = RUNES.filter(r => !litSet.has(r));
  const ordered = RUNES.filter(r => litSet.has(r));
  const nots = ordered.filter(r => RUNE_TWIN[r] && !litSet.has(RUNE_TWIN[r])).map(r => `${article(r)}, not the ${RUNE_TWIN[r]}`);
  return {
    setup: `The portal splits the party between two stone houses on opposite sides of a lava moat, joined only by a speaking tube that twists through the lava's heat; any rune's true name spoken into it burns away, so only descriptions get through. One house has a floor of nine tiles, each carved with a rune, some of them glowing; the other house has nine switches, each carved with a rune. A meter on the switch house wall fills one mark for each correct switch thrown, and a wrong switch empties it to start again.`,
    clues: [`Tell one player privately: (In the floor house) ${cap(WORD[lit.length])} tiles glow: ${listText(ordered.map(article))}. The other ${WORD[dark.length]} are dark: ${listText(dark.map(article))}. Through the tube you may describe runes, but never say their names.`,
      `Show one player: (In the switch house) Your nine switches are carved: ${listText(RUNES)}. The meter on your wall has ${WORD[lit.length]} marks; each correct switch fills one, and a wrong switch empties it.`],
    solution: `Throw the ${listText(ordered)} switches, in any order, without touching any other switch.`,
    hints: [
      { check: 'Wisdom (Perception)', text: 'Several runes come in near-identical pairs, so the descriptions must be exact.' },
      { check: 'Intelligence (Investigation)', text: `${cap(WORD[lit.length])} marks on the meter means ${WORD[lit.length]} glowing tiles.` },
      { check: 'Intelligence', text: nots.length ? `${cap(nots.join('; '))}.` : `The ${ordered[0]} is one of the glowing runes.` },
    ],
  };
}

// ---------- The Pedestals of the Five Sins: an order fixed by a few rules ----------
function sins(rng) {
  const names = ['Pride', 'Greed', 'Wrath', 'Envy', 'Sloth'];
  const perms = permutations(names);
  for (let tries = 0; tries < 100; tries++) {
    const order = pickOne(rng, perms);
    const at = (p, x) => p.indexOf(x);
    const pool = [];
    for (const x of names) {
      pool.push({ text: `${x} stands at neither end`, ok: p => at(p, x) > 0 && at(p, x) < 4 });
      pool.push({ text: `${x} does not stand on the westmost pedestal`, ok: p => at(p, x) !== 0 });
      pool.push({ text: `${x} does not stand on the eastmost pedestal`, ok: p => at(p, x) !== 4 });
      for (const y of names) if (x !== y) {
        pool.push({ text: `${x} stands directly east of ${y}`, ok: p => at(p, x) === at(p, y) + 1 });
        pool.push({ text: `${x} stands somewhere west of ${y}`, ok: p => at(p, x) < at(p, y) });
        if (x < y) pool.push({ text: `${x} and ${y} stand side by side`, ok: p => Math.abs(at(p, x) - at(p, y)) === 1 });
      }
    }
    const rules = [];
    let left = perms;
    for (const c of shuffle(rng, pool.filter(c => c.ok(order)))) {
      const rest = left.filter(c.ok);
      if (rest.length < left.length) { rules.push(c); left = rest; }
      if (left.length === 1) break;
    }
    // Drop any rule the others already imply, so every line on the wall matters.
    for (const c of [...rules]) {
      const without = rules.filter(r => r !== c);
      if (perms.filter(p => without.every(r => r.ok(p))).length === 1) rules.splice(rules.indexOf(c), 1);
    }
    if (rules.length < 3 || rules.length > 6) continue;
    const ruleText = shuffle(rng, rules).map(r => `${r.text}.`).join(' ');
    return {
      setup: `Five sealed urns, each marked with a sin, sit on a table: Pride, Greed, Wrath, Envy and Sloth, beside five empty pedestals in a row from west to east. Graven on the wall: "${ruleText}" Each pedestal glows faintly once an urn is set on it, and the door opens only when all five are placed.`,
      clues: ['Every rule on the wall is true, and together they allow only one order.', 'West is on the left as you face the pedestals, east on the right.'],
      solution: `From west to east: ${order.join(', ')}.`,
      hints: [
        { check: 'Intelligence (Investigation)', text: 'Draw five boxes and place the urns the rules pin down most tightly first.' },
        { check: 'Intelligence', text: `${order[2]} stands on the middle pedestal.` },
        { check: 'Wisdom (Insight)', text: `${order[0]} takes the westmost pedestal.` },
      ],
      table: `Read the ${WORD[rules.length]} rules twice and let players draw five boxes in a row to fill in.`,
    };
  }
  return null;
}

// ---------- The Four Lanterns: a starting pattern and the rings that light them all ----------
function lanterns(rng) {
  const flip = (state, ring) => state.map((on, i) => Math.abs(i - ring) <= 1 ? !on : on);
  for (let tries = 0; tries < 50; tries++) {
    const start = [0, 1, 2, 3].map(() => chanceOf(rng));
    if (start.every(Boolean)) continue;
    const answers = [];
    for (let m = 0; m < 16; m++) {
      let s = start;
      for (let r = 0; r < 4; r++) if (m & (1 << r)) s = flip(s, r);
      if (s.every(Boolean)) answers.push([0, 1, 2, 3].filter(r => m & (1 << r)));
    }
    if (answers.length !== 1) continue;
    const pulls = answers[0];
    const test = rint(rng, 0, 3);
    const tested = flip(start, test);
    const word = on => on ? 'lit' : 'dark';
    const skipped = [0, 1, 2, 3].filter(r => !pulls.includes(r));
    return {
      setup: `Four glass lanterns hang in a row above a dark doorway, and beneath each one is a brass pull-ring. From left to right the lanterns are ${listText(start.map(word))}. Pulling a ring flips its own lantern and the lanterns directly beside it, so a lit lantern goes dark and a dark one lights; the end rings each have only one neighbour. A plate on the door reads: "Let all four burn, and each ring be pulled no more than once."`,
      clues: [`Testing the ${ORD[test]} ring on its own leaves the lanterns ${listText(tested.map(word))}.`, 'The rings reset whenever the door is touched.'],
      solution: `Pull the ${listText(pulls.map(r => ORD[r]))} ring${pulls.length > 1 ? 's' : ''} once each, in any order; that lights all four.`,
      hints: [
        { check: 'Intelligence (Investigation)', text: 'The order of the pulls never matters, only which rings are pulled.' },
        { check: 'Intelligence', text: `The ${ORD[pulls[0]]} ring is part of the answer.` },
        { check: 'Wisdom (Insight)', text: skipped.length ? `The ${ORD[skipped[0]]} ring is never pulled.` : 'Every ring is pulled once.' },
      ],
      table: `Write the four lanterns as ${start.map(word).join(', ')} on paper and let players flip them in pencil before they pull.`,
    };
  }
  return null;
}
const chanceOf = rng => rng() < 0.5;

// ---------- The Heart on the Scale: weights that balance only one way ----------
function scale(rng) {
  for (let tries = 0; tries < 400; tries++) {
    const heart = rint(rng, 2, 9);
    const weights = shuffle(rng, [...Array(12).keys()].map(i => i + 1)).slice(0, 3).sort((a, b) => a - b);
    const ways = [];
    for (let m = 0; m < 8; m++) {
      const withHeart = weights.filter((_, i) => m & (1 << i)), other = weights.filter((_, i) => !(m & (1 << i)));
      if (other.length && heart + withHeart.reduce((s, w) => s + w, 0) === other.reduce((s, w) => s + w, 0)) ways.push({ withHeart, other });
    }
    if (ways.length !== 1) continue;
    const { withHeart, other } = ways[0];
    const total = heart + withHeart.reduce((s, w) => s + w, 0);
    const sum = [heart, ...withHeart].join(' plus ');
    return {
      setup: `A great brass scale stands before a sealed door, its two pans empty and level. Beside it rest a crystal heart stamped with the number ${heart} and three brass weights stamped ${listText(weights.map(String))}. A line cut into the scale's beam reads: "Lay the heart down and let every weight be spent, and the beam must lie level."`,
      solution: `Place the heart${withHeart.length ? ` with the ${listText(withHeart.map(String))} weight${withHeart.length > 1 ? 's' : ''}` : ''} on one pan and the ${listText(other.map(String))} weight${other.length > 1 ? 's' : ''} on the other: both pans weigh ${total}. This is the only way to use all three weights and balance the scale.`,
      hints: [
        { check: 'Intelligence (Investigation)', text: 'Nothing says the weights all have to go on the opposite pan from the heart.' },
        { check: 'Wisdom (Perception)', text: withHeart.length ? 'The heart pan is worn as though more than the heart has sat there; weights may join the heart.' : 'The far pan is worn deep, as though it has borne every weight at once.' },
        { check: 'Intelligence', text: `${cap(sum)} makes ${total}.` },
      ],
    };
  }
  return null;
}

// ---------- The Pressure Gauges: fresh readings, the same three valves ----------
function gauges(rng) {
  const fx = { Red: [1, 1, 0, 0], Blue: [0, 0, 2, -1], Green: [1, -2, 0, 1] };
  for (let tries = 0; tries < 200; tries++) {
    const turns = { Red: rint(rng, 0, 3), Blue: rint(rng, 1, 3), Green: rint(rng, 0, 3) };
    const target = rint(rng, 5, 8);
    const start = [0, 1, 2, 3].map(g => target - Object.keys(fx).reduce((s, v) => s + fx[v][g] * turns[v], 0));
    if (start.some(x => x < 1 || x > 9) || start.every(x => x === target)) continue;
    const times = n => n === 1 ? 'once' : n === 2 ? 'twice' : `${WORD[n]} times`;
    const said = Object.keys(turns).filter(v => turns[v]).map(v => `${v} ${times(turns[v])}`);
    const steps = g => `${start[g]}${Object.keys(fx).map(v => fx[v][g] * turns[v]).filter(Boolean).map(d => d > 0 ? `+${d}` : `${d}`).join('')}`;
    return {
      setup: `Four brass gauges are set into a wall, numbered 1 to 4, and currently read ${listText(start.map(String))}; a silver line marks ${target} on every dial. Beneath them are three valve wheels that turn only one way, a quarter turn at a time, and plates beside them explain what each quarter turn does; nothing happens until someone hauls the release lever below the valves. Red raises gauges 1 and 2 by 1 each; Blue raises gauge 3 by 2 and lowers gauge 4 by 1; Green raises gauge 1 by 1, lowers gauge 2 by 2 and raises gauge 4 by 1.`,
      clues: ['The pipes rattle when a gauge leaves its silver line, but nothing breaks until someone hauls the release lever below the valves.',
        `Only Blue touches gauge 3, which needs to rise by exactly ${target - start[2]}.`],
      solution: `Turn ${listText(said)}, then pull the release lever. The gauges read ${[0, 1, 2, 3].map(steps).join(', ')}, so all four show ${target}.`,
      hints: [
        { check: 'Intelligence (Investigation)', text: `Gauge 3 is moved only by Blue, so Blue is turned ${times(turns.Blue)}.` },
        { check: 'Intelligence', text: `Blue lowers gauge 4, and only Green raises it back, so Green is turned ${turns.Green ? times(turns.Green) : 'not at all'}.` },
        { check: 'Wisdom (Insight)', text: `Red fixes gauges 1 and 2 together; it is turned ${turns.Red ? times(turns.Red) : 'not at all'}.` },
      ],
    };
  }
  return null;
}

// ---------- The Conquering Sigils: a chain of who conquers whom ----------
function sigils(rng) {
  const verb = { Flame: 'melts', Rain: 'drowns', Stone: 'crushes', Root: 'drinks', Frost: 'freezes' };
  const order = shuffle(rng, Object.keys(verb));
  const lines = shuffle(rng, order.slice(1).map((x, i) => `${x} ${verb[x]} ${order[i]}.`));
  return {
    setup: `Five cold sigils are carved in a ring on the floor, each beside an unlit brazier: ${listText(shuffle(rng, order))}. Above the ring, letters of dull bronze read: "${lines.join(' ')}" Beneath them, in larger letters: "Wake each sigil only after the one it conquers already burns." A brazier lights when someone touches its sigil with an open hand.`,
    clues: [`${order[0]} is the only sigil that conquers nothing, so the inscription places no demand on it.`,
      `Scorch marks around the ${order[4]} sigil suggest someone once tried to light it first and paid for it.`],
    solution: `Light the sigils in the order ${listText(order)}. Each sigil conquers the one lit just before it, forming a single unbroken chain.`,
    hints: [
      { check: 'Intelligence (Investigation)', text: 'Each sentence names a conqueror and its victim; the victim must be lit before the conqueror.' },
      { check: 'Wisdom (Insight)', text: 'The four sentences link into one chain, so there is only one possible order. Start with the sigil that conquers nothing.' },
      { check: 'Intelligence (Arcana)', text: `${order[0]} first, because ${order[1]} ${verb[order[1]]} it; then follow who beats whom until you reach ${order[4]}.` },
    ],
  };
}

// ---------- The Fifteen Furnace: six levers, one separated three that make fifteen ----------
function furnace(rng) {
  const sets = [[0, 2, 4], [0, 2, 5], [0, 3, 5], [1, 3, 5]];
  for (let tries = 0; tries < 2000; tries++) {
    const v = [0, 1, 2, 3, 4, 5].map(() => rint(rng, 1, 9));
    const hits = sets.filter(s => s.reduce((t, i) => t + v[i], 0) === 15);
    if (hits.length !== 1) continue;
    const ans = hits[0];
    const out = [0, 1, 2, 3, 4, 5].filter(i => !ans.includes(i));
    // A tempting wrong try: three side by side, for the soot marks.
    const soot = [0, 1, 2, 3].map(i => [i, i + 1, i + 2]).find(s => s.some(i => !ans.includes(i)));
    return {
      setup: `Six iron levers stand in a row before a cold furnace, and from left to right they are stamped ${listText(v.map(String))}. A brass plate above the furnace reads: "Pull three and no more. Let no two pulled levers stand side by side. Feed me fifteen." A chain beside the furnace lights it once the levers are set.`,
      clues: ['The levers stay down once pulled and only reset when the furnace is lit.',
        `Soot marks show someone once tried the ${ORD[soot[0]]}, ${ORD[soot[1]]} and ${ORD[soot[2]]} levers together.`],
      solution: `Pull the ${listText(ans.map(i => ORD[i]))} levers (stamped ${listText(ans.map(i => String(v[i])))}), which total 15 with no two side by side, then pull the chain. No other set of three separated levers makes 15.`,
      hints: [
        { check: 'Intelligence (Investigation)', text: 'With six levers and no neighbours allowed, only four sets of three are even possible.' },
        { check: 'Intelligence', text: `The ${ORD[out[0]]} lever is not part of the answer.` },
        { check: 'Wisdom (Insight)', text: `The ${ORD[ans[2]]} lever, stamped ${v[ans[2]]}, belongs in the answer.` },
      ],
    };
  }
  return null;
}

// ---------- The Floor of Sun, Moon and Star: a path that follows the cycle ----------
function floor(rng) {
  const SYM = ['Sun', 'Moon', 'Star'];
  const name = i => `${'ABCD'[i % 4]}${Math.floor(i / 4) + 1}`;
  const nbrs = i => [i - 4, i + 4, i % 4 ? i - 1 : -1, i % 4 < 3 ? i + 1 : -1].filter(j => j >= 0 && j < 16);
  for (let tries = 0; tries < 3000; tries++) {
    // A random walk from the near row (row 4) to the exit row (row 1) whose last tile is a Star.
    const path = [rint(rng, 12, 15)];
    while (Math.floor(path[path.length - 1] / 4) !== 0 && path.length < 12) {
      const next = nbrs(path[path.length - 1]).filter(j => !path.includes(j) && !(Math.floor(j / 4) === 0 && path.length % 3 !== 2));
      if (!next.length) break;
      path.push(pickOne(rng, next));
    }
    const end = path[path.length - 1];
    if (Math.floor(end / 4) !== 0 || path.length % 3 !== 0 || path.length < 6) continue;
    const grid = Array(16).fill(null);
    path.forEach((t, k) => { grid[t] = SYM[k % 3]; });
    for (let i = 0; i < 16; i++) if (!grid[i]) grid[i] = Math.floor(i / 4) === 3 ? pickOne(rng, ['Moon', 'Star']) : pickOne(rng, SYM);
    if ([12, 13, 14, 15].filter(i => grid[i] === 'Sun').length !== 1) continue;
    // Count every path that obeys the rules; there must be exactly one.
    let count = 0;
    const walk = (at, k, seen) => {
      if (count > 1) return;
      if (Math.floor(at / 4) === 0 && grid[at] === 'Star') { count++; return; }
      for (const j of nbrs(at)) if (!seen.has(j) && grid[j] === SYM[(k + 1) % 3]) { seen.add(j); walk(j, k + 1, seen); seen.delete(j); }
    };
    walk(path[0], 0, new Set([path[0]]));
    if (count !== 1) continue;
    const decoy = [...Array(16).keys()].find(i => !path.includes(i) && nbrs(i).some(j => path.includes(j)));
    const rowText = r => grid.slice(r * 4, r * 4 + 4).join(', ');
    return {
      setup: `A floor of sixteen tiles stands between you and the north exit, four rows of four, with columns A to D running west to east and rows 1 (by the exit) to 4 (by you) running north to south. Reading each row west to east, row 1 is ${rowText(0)}; row 2 is ${rowText(1)}; row 3 is ${rowText(2)}; and row 4 is ${rowText(3)}. Painted at your feet: "Step first on the Sun. Then Moon, then Star, then Sun again, round and round. Never step on a tile twice, never step corner to corner, and leave from a Star in the farthest row."`,
      clues: ['Only one tile in the row nearest you shows a Sun.', `A skeleton lies on tile ${name(decoy)}, one hand reaching for the exit.`],
      solution: `Step on ${listText(path.map(t => `${name(t)} (${grid[t]})`))}, then walk out through the exit. It is the only path that follows the pattern from the south row to a Star in the north row.`,
      hints: [
        { check: 'Wisdom (Perception)', text: `You must start on ${name(path[0])}, the only Sun in your row.` },
        { check: 'Intelligence (Investigation)', text: `The path passes through ${name(path[Math.floor(path.length / 2)])}.` },
        { check: 'Intelligence', text: `You leave from the Star at ${name(end)}.` },
      ],
    };
  }
  return null;
}

// ---------- The Chain of Cells: a fresh order for the four symbol stones ----------
function cells(rng) {
  const order = shuffle(rng, ['moon', 'wave', 'crown', 'key']);
  const holds = shuffle(rng, [0, 1, 2, 3]);
  const who = ['Cell one, at the west end', 'Cell two', 'Cell three', 'Cell four, at the east end'];
  const near = ['Your only neighbour is cell two.', 'Your neighbours are cells one and three.', 'Your neighbours are cells two and four.', 'Your only neighbour is cell three.'];
  return {
    clues: holds.map((pos, c) => `Tell one player privately: (${who[c]}) ${near[c]} Your carved tile shows ${order[pos] === 'wave' ? 'a wave' : `a ${order[pos]}`}, marked '${ORD[pos]}'.`),
    solution: `Every tray is set ${order.join(', ')}, and all four trays are pushed in during the same round of initiative, on a round agreed down the chain.`,
  };
}

export const PUZZLE_MAKERS = { lock, sigil, tally, houses, sins, lanterns, scale, gauges, sigils, furnace, floor, cells };

/** A bank puzzle with its varying parts rolled fresh; puzzles without a maker come back as they are. */
export function varyPuzzle(p, rng = Math.random) {
  const make = p && PUZZLE_MAKERS[p.vary];
  const fresh = make ? make(rng) : null;
  return fresh ? { ...p, ...fresh } : p;
}
