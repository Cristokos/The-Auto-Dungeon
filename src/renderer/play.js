// The Auto DM's own words and rules for Play: ability checks, how hard things are, and the lines it narrates.
// Everything here is plain functions of what it's given. app.js gathers the world (the place, the people, the news),
// calls these, and saves the journal.
import * as S from './sheet.js';

export const PARTS = ['morning', 'afternoon', 'evening'];
const pick = (rng, l) => l[Math.floor(rng() * l.length)];
const cap = s => String(s).charAt(0).toUpperCase() + String(s).slice(1);
const article = w => /^[aeiou]/i.test(String(w)) ? 'an' : 'a';
/** The first full sentence of a line ("Fog. Thick and grey." → "Fog."). */
const firstSentence = s => (String(s).match(/^.*?[.!?](\s|$)/)?.[0] || String(s)).trim();
const lower = s => String(s).charAt(0).toLowerCase() + String(s).slice(1);

/** A fresh journal: who they play, the part of the day, and what happened, oldest first. */
export const newPlay = () => ({ pc: null, part: 0, log: [] });
export const LOG_KEEP = 300;

/** A d20 ability check for a character sheet's skill against a DC. */
export function check(m, skill, dc, rng = Math.random) {
  const roll = 1 + Math.floor(rng() * 20);
  const bonus = S.skillBonus(m, skill);
  const total = roll + bonus;
  return { skill, roll, bonus, total, dc, ok: roll === 20 || (roll !== 1 && total >= dc), crit: roll === 20, fumble: roll === 1 };
}
export const checkText = c => `${c.skill} ${c.roll}${c.bonus >= 0 ? '+' : ''}${c.bonus} = ${c.total} vs DC ${c.dc}${c.crit ? ', a natural 20' : c.fumble ? ', a natural 1' : ''}: ${c.ok ? 'success' : 'failure'}`;

/** How hard it is to get by somewhere: safer places are easier. Safety runs 0 to 100. */
export const dcFor = (safety = 50, base = 10) => Math.round(base + (100 - Math.max(0, Math.min(100, safety))) / 12);

/** The character's best skill of a few, for checks where the player gets to play to their strengths. */
export function bestSkill(m, skills) {
  return skills.reduce((best, s) => S.skillBonus(m, s) > S.skillBonus(m, best) ? s : best, skills[0]);
}

const MOOD = {
  prosperity: [[25, 'Shutters hang loose and the market stalls are half empty.'], [50, 'People get by, if not much more.'], [75, 'Trade is brisk and the streets are busy.'], [101, 'Money is everywhere: new roofs, fine cloth, full stalls.']],
  safety: [[25, 'Folk walk in groups and watch the alleys.'], [50, 'The watch is thin, and people keep a hand near their purse.'], [75, 'It feels safe enough by daylight.'], [101, 'Guards are everywhere, and nobody seems worried.']],
};
const moodLine = (k, v) => MOOD[k].find(([max]) => v < max)?.[1] || '';

const PART_OPEN = {
  morning: ['Morning comes to {place}.', 'Dawn light reaches {place}.', 'It is early in {place}.'],
  afternoon: ['The afternoon wears on in {place}.', 'The sun is high over {place}.', 'It is afternoon in {place}.'],
  evening: ['Evening settles over {place}.', 'Lamps are being lit across {place}.', 'The day is ending in {place}.'],
};

/**
 * The scene the player wakes to or arrives in.
 * ctx: { place, kind, part, date, season, weather, senses, nums: {prosperity, safety}, people: [names], about }
 */
export function sceneText(ctx, rng = Math.random) {
  const part = PARTS[ctx.part] || 'morning';
  const open = pick(rng, PART_OPEN[part]).replace('{place}', ctx.place || 'the wilds');
  const lines = [`${open} It is ${ctx.date}${ctx.season ? `, ${lower(ctx.season)}` : ''}.`];
  if (ctx.about) lines.push(firstSentence(ctx.about));
  if (ctx.weather) lines.push(firstSentence(ctx.weather));
  if (ctx.nums) lines.push(moodLine('prosperity', ctx.nums.prosperity), moodLine('safety', ctx.nums.safety));
  if (ctx.senses) lines.push(ctx.senses);
  return lines.filter(Boolean).join(' ');
}

/** A line for exploring: what turns up, or what goes wrong. found: a quick-roll line (loot, trinket, passer-by). */
export function exploreText(c, found, place, rng = Math.random) {
  if (c.ok) {
    const lead = c.crit ? pick(rng, ['Luck is with you.', 'You have a sharp eye today.']) : pick(rng, ['You take your time and look around.', 'You wander the less travelled corners.', 'You follow your nose.']);
    return `${lead} ${found}`;
  }
  const lead = c.fumble ? pick(rng, ['It goes badly.', 'You choose the wrong turning, and then another.']) : pick(rng, ['You poke around, but the day gets away from you.', `${cap(place || 'This place')} keeps its secrets for now.`]);
  return `${lead} ${found}`;
}

/** What someone says when the player talks to them. */
export function talkText(c, who, said, rng = Math.random) {
  if (c.ok) {
    const lead = pick(rng, [`${who} warms to you.`, `${who} leans in and lowers their voice.`, `${who} is glad of the company.`]);
    return `${lead} "${said}"`;
  }
  return pick(rng, [`${who} has no time for strangers today.`, `${who} gives you a long look and goes back to work.`, `${who} answers in single words, and you learn nothing.`]);
}

/** Where talk comes from when the person has nothing particular to say. */
export const smallTalk = rng => pick(rng, [
  'Keep your head down and your coin purse closer.', 'Mind the roads after dark. Things come out of the ground these days.',
  'The Adventure Society always wants hands, if you can stand the paperwork.', 'Prices are up again. Blame whoever you like.',
]);

export function restText(place, hurt, rng = Math.random) {
  const where = place ? ` in ${place}` : '';
  return hurt ? pick(rng, [`You find a bed${where} and sleep the day away. Your wounds close and your strength returns.`, `A long rest${where} puts you right again.`])
    : pick(rng, [`You rest a day${where}. Nothing much happens, which is no bad thing.`, `A quiet day${where}. You sleep late and eat well.`]);
}

export function travelText(from, to, days, rng = Math.random) {
  const span = days === 1 ? 'a day' : `${days} days`;
  return pick(rng, [`You set out from ${from} and reach ${to} after ${span} on the road.`, `${cap(span)} of travel bring you from ${from} to ${to}.`]);
}

export const waitText = (days, place) => `You stay ${place ? `in ${place} ` : ''}and let ${days === 10 ? 'a tenday' : `${days} days`} go by.`;

/** A job on offer, in the words of whoever is offering it. */
export function jobText(p, rng = Math.random) {
  const by = pick(rng, ['A notice on the board reads:', 'Word in the taproom is this:', 'A worried local stops you:']);
  return `${by} ${p.text}${p.goal ? ` They want someone to ${lower(p.goal).replace(/\.$/, '')}.` : ''}`;
}

export const tookJobText = p => `You take the job: ${p.title}.${p.goal ? ` ${cap(p.goal).replace(/\.?$/, '.')}` : ''}`;
export const passedJobText = p => `You pass on ${p.title}. Someone else will deal with it, or nobody will.`;

/** A line for each thing the world did while time passed, from the chronicle's public entries. */
export const newsText = entries => entries.map(e => `${e.title}${e.places?.[0] ? ` (${e.places[0]})` : ''}${e.text ? `: ${firstSentence(e.text)}` : ''}`);

/** Day's end, when the evening's action is done. */
export const nightText = (place, rng = Math.random) => pick(rng, [`Night falls${place ? ` over ${place}` : ''}. You find somewhere to sleep.`, 'The day is done. You sleep.']);

/** "a human" / "an elf". */
export const aPeople = p => `${article(p)} ${String(p).toLowerCase()}`;
