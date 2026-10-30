// Generated places: when a contract, story hook, NPC or travel event needs somewhere to go, a place is made with
// a name, a reason to be interesting and a pin on the World map. Places start as drafts and become wiki pages only
// when the result that named them is kept. Content is in data/places.json; the coastline is worldmap.js.
import WORLD from './worldmap.js';
import { int, pick, chance, weighted, sample } from './generators.js';

const list = x => Array.isArray(x) ? x : [];
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const article = w => `${/^[aeiou]/i.test(w) ? 'an' : 'a'} ${w}`;

// ---------- the map: land, lakes, rivers ----------

const MILES_PER_DEG = 69.1;
const toXY = ([lon, lat]) => [(lon + 180) * WORLD.k, (WORLD.top - lat) * WORLD.k];

function parsePath(d, closed = true) {
  const shapes = [];
  for (const part of String(d || '').split('M').filter(Boolean)) {
    const pts = part.replace(/Z/g, '').split('L').map(p => p.split(',').map(Number)).filter(p => p.length === 2 && p.every(Number.isFinite));
    if (pts.length < (closed ? 3 : 2)) continue;
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    shapes.push({ pts, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
  }
  return shapes;
}
let geo = null;
const geometry = () => (geo ||= { land: parsePath(WORLD.land), lakes: parsePath(WORLD.lakes), rivers: parsePath(WORLD.rivers, false) });

function inside(shapes, [x, y]) {
  let n = 0;
  for (const s of shapes) {
    if (x < s.box[0] || x > s.box[2] || y < s.box[1] || y > s.box[3]) continue;
    const p = s.pts;
    let c = false;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      if ((p[i][1] > y) !== (p[j][1] > y) && x < (p[j][0] - p[i][0]) * (y - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0]) c = !c;
    }
    if (c) n++;
  }
  return n % 2 === 1;
}
export const onLand = ll => inside(geometry().land, toXY(ll)) && !inside(geometry().lakes, toXY(ll));
const inLake = ll => inside(geometry().lakes, toXY(ll));

function segDist([x, y], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len)) : 0;
  return Math.hypot(x - ax - t * dx, y - ay - t * dy);
}
function nearRiver(ll, miles) {
  const p = toXY(ll), r = miles / MILES_PER_DEG * WORLD.k;
  for (const s of geometry().rivers) {
    if (p[0] < s.box[0] - r || p[0] > s.box[2] + r || p[1] < s.box[1] - r || p[1] > s.box[3] + r) continue;
    for (let i = 1; i < s.pts.length; i++) if (segDist(p, s.pts[i - 1], s.pts[i]) <= r) return true;
  }
  return false;
}

/** Miles between two [lon, lat] points. */
export function milesBetween([lon1, lat1], [lon2, lat2]) {
  const r = Math.PI / 180;
  const a = Math.sin((lat2 - lat1) * r / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lon2 - lon1) * r / 2) ** 2;
  return 3959 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}
/** The point a number of miles away on a compass bearing (degrees, 0 = north). */
export function offset([lon, lat], miles, bearing) {
  const r = Math.PI / 180;
  const dLat = miles * Math.cos(bearing * r) / MILES_PER_DEG;
  const dLon = miles * Math.sin(bearing * r) / (MILES_PER_DEG * Math.max(0.05, Math.cos(lat * r)));
  return [Math.round((lon + dLon) * 1000) / 1000, Math.round((lat + dLat) * 1000) / 1000];
}
const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
export function bearingName(from, to) {
  const r = Math.PI / 180;
  const y = Math.sin((to[0] - from[0]) * r) * Math.cos(to[1] * r);
  const x = Math.cos(from[1] * r) * Math.sin(to[1] * r) - Math.sin(from[1] * r) * Math.cos(to[1] * r) * Math.cos((to[0] - from[0]) * r);
  return COMPASS[Math.round(((Math.atan2(y, x) / r + 360) % 360) / 45) % 8];
}

/** Water around a point on land: the coast (sea within a few miles), a lake shore, or a river. */
export function waterNear(ll) {
  const out = [];
  let sea = false, lake = false;
  for (let b = 0; b < 360; b += 45) {
    const p = offset(ll, 7, b);
    if (inLake(p)) lake = true;
    else if (!inside(geometry().land, toXY(p))) sea = true;
  }
  if (sea) out.push('coast');
  if (lake) out.push('lake');
  if (nearRiver(ll, 6)) out.push('river');
  return out;
}

// ---------- routes over water ----------
// A ship can't sail over land: its route is found on a grid of the map around the journey, over sea, lakes and the
// bigger rivers. Out at sea it keeps a distance from the coast where it can (the buffer), except near where it
// leaves, calls and arrives. A route goes through any waypoints in order; each stretch between them is a leg.

/** How far inland a port can be from the water it sails on, in miles. */
export const PORT_MILES = 15;
/** How far a ship keeps from the coast out at sea when it can, in miles. */
export const COAST_BUFFER = 25;

/** Where shape edges cross the horizontal line at y, in x order. */
function crossings(shapes, y, x0, x1) {
  const xs = [];
  for (const s of shapes) {
    if (y < s.box[1] || y > s.box[3] || s.box[2] < x0 || s.box[0] > x1) continue;
    const p = s.pts;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      if ((p[i][1] > y) !== (p[j][1] > y)) xs.push((p[j][0] - p[i][0]) * (y - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0]);
    }
  }
  return xs.sort((a, b) => a - b);
}

/** The map around a box ([west, south, east, north]) as a grid of cells `c` degrees across: 0 land, 1 sea or lake, 2 river. */
function waterGrid(box, c, rivers) {
  const [w, s, e, n] = box;
  const cols = Math.max(2, Math.ceil((e - w) / c)), rows = Math.max(2, Math.ceil((n - s) / c));
  const cell = new Uint8Array(cols * rows);
  const G = geometry();
  const fill = (shapes, val, only) => {
    for (let r = 0; r < rows; r++) {
      const y = (WORLD.top - (n - (r + 0.5) * c)) * WORLD.k;
      const xs = crossings(shapes, y, (w + 180) * WORLD.k, (e + 180) * WORLD.k);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const a = Math.max(0, Math.ceil(((xs[i] / WORLD.k - 180) - w) / c - 0.5)), b = Math.min(cols - 1, Math.floor(((xs[i + 1] / WORLD.k - 180) - w) / c - 0.5));
        for (let q = a; q <= b; q++) if (only === undefined || cell[r * cols + q] === only) cell[r * cols + q] = val;
      }
    }
  };
  cell.fill(1);
  fill(G.land, 0);
  fill(G.lakes, 1, 0);
  if (rivers) for (const sh of G.rivers) {
    if (sh.box[2] < (w + 180) * WORLD.k || sh.box[0] > (e + 180) * WORLD.k || sh.box[3] < (WORLD.top - n) * WORLD.k || sh.box[1] > (WORLD.top - s) * WORLD.k) continue;
    for (let i = 1; i < sh.pts.length; i++) {
      const [ax, ay] = sh.pts[i - 1], [bx, by] = sh.pts[i];
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (c * WORLD.k / 3)));
      for (let k = 0; k <= steps; k++) {
        const lon = (ax + (bx - ax) * k / steps) / WORLD.k - 180, lat = WORLD.top - (ay + (by - ay) * k / steps) / WORLD.k;
        const q = Math.floor((lon - w) / c), r = Math.floor((n - lat) / c);
        if (q >= 0 && q < cols && r >= 0 && r < rows && cell[r * cols + q] === 0) cell[r * cols + q] = 2;
      }
    }
  }
  return { cell, cols, rows, c, w, n };
}

/** Miles from each water cell to the nearest land (rivers don't count as coast), worked out up to `cap` miles. */
function coastMiles(g, cap) {
  const { cell, cols, rows, c, n } = g;
  const d = new Float32Array(cols * rows).fill(cap);
  const dy = c * MILES_PER_DEG;
  const dxAt = r => Math.max(0.05, Math.cos((n - (r + 0.5) * c) * Math.PI / 180)) * c * MILES_PER_DEG;
  for (let i = 0; i < d.length; i++) if (cell[i] === 0) d[i] = 0;
  // Two sweeps of an 8-way distance, close enough for keeping off the coast.
  for (let r = 0; r < rows; r++) {
    const dx = dxAt(r), dd = Math.hypot(dx, dy);
    for (let q = 0; q < cols; q++) {
      const i = r * cols + q;
      let v = d[i];
      if (q > 0) v = Math.min(v, d[i - 1] + dx);
      if (r > 0) { v = Math.min(v, d[i - cols] + dy); if (q > 0) v = Math.min(v, d[i - cols - 1] + dd); if (q < cols - 1) v = Math.min(v, d[i - cols + 1] + dd); }
      d[i] = v;
    }
  }
  for (let r = rows - 1; r >= 0; r--) {
    const dx = dxAt(r), dd = Math.hypot(dx, dy);
    for (let q = cols - 1; q >= 0; q--) {
      const i = r * cols + q;
      let v = d[i];
      if (q < cols - 1) v = Math.min(v, d[i + 1] + dx);
      if (r < rows - 1) { v = Math.min(v, d[i + cols] + dy); if (q < cols - 1) v = Math.min(v, d[i + cols + 1] + dd); if (q > 0) v = Math.min(v, d[i + cols - 1] + dd); }
      d[i] = v;
    }
  }
  return d;
}

/** The water cell nearest a point, within `miles` of the water's edge (so a cell's middle can be a bit further), or -1. */
function nearestWater(g, ll, miles) {
  const { cell, cols, rows, c, w, n } = g;
  miles += c * MILES_PER_DEG * 0.75;
  const q0 = Math.floor((ll[0] - w) / c), r0 = Math.floor((n - ll[1]) / c);
  const reach = Math.ceil(miles / (c * MILES_PER_DEG * Math.max(0.2, Math.cos(ll[1] * Math.PI / 180)))) + 1;
  let best = -1, bd = Infinity;
  for (let r = r0 - reach; r <= r0 + reach; r++) for (let q = q0 - reach; q <= q0 + reach; q++) {
    if (r < 0 || r >= rows || q < 0 || q >= cols || !cell[r * cols + q]) continue;
    const m = milesBetween(ll, cellLL(g, r * cols + q));
    if (m <= miles && m < bd) { bd = m; best = r * cols + q; }
  }
  return best;
}
const cellLL = (g, i) => [g.w + (i % g.cols + 0.5) * g.c, g.n - (Math.floor(i / g.cols) + 0.5) * g.c];

/** A small binary heap of [cost, index]. */
function heap() {
  const a = [];
  return {
    get size() { return a.length; },
    push(k, v) { a.push([k, v]); let i = a.length - 1; while (i) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } },
    pop() {
      const top = a[0], last = a.pop();
      if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } }
      return top;
    },
  };
}

/** The cheapest way over water between two cells: A* with the coast buffer as extra cost. Returns cell indexes or null. */
function searchWater(g, coast, s, t, { buffer, ends }) {
  const { cell, cols, rows } = g;
  const cost = new Float64Array(cols * rows).fill(Infinity), from = new Int32Array(cols * rows).fill(-1), done = new Uint8Array(cols * rows);
  const goal = cellLL(g, t);
  const free = i => ends.some(e => milesBetween(cellLL(g, i), e) <= buffer + 10);
  const open = heap();
  cost[s] = 0; open.push(milesBetween(cellLL(g, s), goal), s);
  while (open.size) {
    const [, i] = open.pop();
    if (done[i]) continue;
    done[i] = 1;
    if (i === t) break;
    const r = Math.floor(i / cols), q = i % cols, here = cellLL(g, i);
    for (let dr = -1; dr <= 1; dr++) for (let dq = -1; dq <= 1; dq++) {
      if (!dr && !dq) continue;
      const rr = r + dr, qq = q + dq;
      if (rr < 0 || rr >= rows || qq < 0 || qq >= cols) continue;
      const j = rr * cols + qq;
      if (!cell[j] || done[j]) continue;
      // No slipping diagonally between two land cells at sea (a river runs diagonally between them all the time).
      if (dr && dq && cell[i] === 1 && cell[j] === 1 && !cell[r * cols + qq] && !cell[rr * cols + q]) continue;
      const ll = cellLL(g, j);
      let step = milesBetween(here, ll);
      if (buffer > 0 && cell[j] === 1 && coast[j] < buffer && !free(j)) step *= 1 + 6 * (buffer - coast[j]) / buffer;
      const c2 = cost[i] + step;
      if (c2 >= cost[j]) continue;
      cost[j] = c2; from[j] = i;
      open.push(c2 + milesBetween(ll, goal), j);
    }
  }
  if (from[t] < 0 && s !== t) return null;
  const path = [t];
  while (path[0] !== s) path.unshift(from[path[0]]);
  return path;
}

/** Straightens a cell path: skips ahead while a straight line stays on water no nearer the coast than the path did
 * (near the ends, where the ship comes in to port, any water will do). */
function straighten(g, coast, path, buffer, ends) {
  const free = ll => ends.some(e => milesBetween(ll, e) <= buffer + 10);
  const clear = (a, b) => {
    const A = cellLL(g, path[a]), B = cellLL(g, path[b]);
    let need = buffer;
    for (let k = a; k <= b; k++) if (!free(cellLL(g, path[k]))) need = Math.min(need, coast[path[k]]);
    const steps = Math.ceil(Math.hypot(B[0] - A[0], B[1] - A[1]) / (g.c / 3));
    for (let k = 1; k < steps; k++) {
      const ll = [A[0] + (B[0] - A[0]) * k / steps, A[1] + (B[1] - A[1]) * k / steps];
      const i = Math.floor((g.n - ll[1]) / g.c) * g.cols + Math.floor((ll[0] - g.w) / g.c);
      if (!g.cell[i]) return false;
      if (g.cell[i] === 1 && coast[i] < need && !free(ll)) return false;
    }
    return true;
  };
  const out = [path[0]];
  let a = 0;
  while (a < path.length - 1) {
    let b = path.length - 1;
    while (b > a + 1 && !clear(a, b)) b--;
    out.push(path[b]);
    a = b;
  }
  return out;
}

const round3 = ll => [Math.round(ll[0] * 1000) / 1000, Math.round(ll[1] * 1000) / 1000];
/** Miles along a line of [lon, lat] points. */
export const routeMiles = pts => pts.reduce((t, p, i) => i ? t + milesBetween(pts[i - 1], p) : 0, 0);

/** One leg over water, from a to b. Returns { pts } or { error: 'from' | 'to' | 'none' }. */
function waterLeg(a, b, { buffer, rivers }) {
  const span = Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
  // Look close in first, then wider for a way round a continent.
  for (const [pad, max] of [[span * 0.35 + 4, 90000], [span + 20, 110000], [180, 140000]]) {
    const box = [Math.max(-180, Math.min(a[0], b[0]) - pad), Math.max(-85, Math.min(a[1], b[1]) - pad), Math.min(180, Math.max(a[0], b[0]) + pad), Math.min(84, Math.max(a[1], b[1]) + pad)];
    const c = Math.max(0.04, Math.sqrt((box[2] - box[0]) * (box[3] - box[1]) / max));
    const g = waterGrid(box, c, rivers);
    const s = nearestWater(g, a, PORT_MILES), t = nearestWater(g, b, PORT_MILES);
    if (s < 0) return { error: 'from' };
    if (t < 0) return { error: 'to' };
    const coast = coastMiles(g, buffer + 1);
    const path = searchWater(g, coast, s, t, { buffer, ends: [a, b] });
    if (!path) continue;
    const pts = straighten(g, coast, path, buffer, [a, b]).map(i => cellLL(g, i));
    return { pts: [a, ...pts, b].map(round3) };
  }
  return { error: 'none' };
}

/**
 * A route over water through `points` ([lon, lat], start, waypoints, end). opts: { buffer: miles to keep off the coast
 * (0 to hug it), rivers: whether rivers can be sailed }. Returns { pts, legs: [index in pts where each leg starts],
 * miles } or { error, at: the index in `points` that isn't on the water, or of the leg with no way through }.
 */
export function waterRoute(points, { buffer = COAST_BUFFER, rivers = true } = {}) {
  const pts = [], legs = [];
  for (let i = 1; i < points.length; i++) {
    const leg = waterLeg(points[i - 1], points[i], { buffer, rivers });
    if (leg.error) return { error: leg.error === 'none' ? 'none' : 'land', at: leg.error === 'to' ? i : leg.error === 'from' ? i - 1 : i - 1 };
    legs.push(Math.max(0, pts.length - 1));
    pts.push(...(pts.length ? leg.pts.slice(1) : leg.pts));
  }
  return { pts, legs, miles: Math.round(routeMiles(pts)) };
}
/** Whether a ship can put in at a point: water within PORT_MILES of it. */
export function onWater(ll, { rivers = true } = {}) {
  const c = 0.05, g = waterGrid([ll[0] - 0.5, ll[1] - 0.5, ll[0] + 0.5, ll[1] + 0.5], c, rivers);
  return nearestWater(g, ll, PORT_MILES) >= 0;
}

// ---------- regions ----------

/** The style of a region: the anchor's own nameStyle, else the first style whose map box holds the point. */
export function styleFor(data, ll, wanted = '') {
  const styles = data.places?.styles || {};
  if (wanted && styles[wanted]) return wanted;
  for (const [k, s] of Object.entries(styles)) {
    if (list(s.boxes).some(([w, so, e, n]) => ll[0] >= w && ll[0] <= e && ll[1] >= so && ll[1] <= n)) return k;
  }
  return styles.common ? 'common' : Object.keys(styles)[0];
}

// ---------- names ----------

function styleName(rng, st) {
  if (list(st.whole).length && chance(rng, 0.12)) return pick(rng, st.whole);
  const pre = pick(rng, st.prefixes), suf = pick(rng, st.suffixes);
  if (/[\s-]$/.test(pre)) return pre + cap(suf);
  return pre + suf.toLowerCase();
}
function uniqueName(rng, make, taken) {
  for (let i = 0; i < 40; i++) {
    const n = make();
    if (!taken.has(n.toLowerCase())) return n;
  }
  return null;
}

// ---------- making a place ----------

const fill = (text, p) => String(text).replace(/\{name\}/g, p.name).replace(/\{anchor\}/g, p.anchor || 'the city').replace(/\{goods\}/g, p.goods || 'their goods');

/** Industries that fit the terrain, magical ones weighted by how much magic the region has. */
function industryFor(rng, P, terrain, magic) {
  const fits = list(P.industries).filter(i => !list(i.terrain).length || i.terrain.includes('any') || i.terrain.some(t => terrain.includes(t)));
  const pool = fits.length ? fits : list(P.industries);
  const mw = P.magicWeight?.[magic] ?? 1;
  return pool.length ? weighted(rng, pool, i => i.magic ? mw : 1) : null;
}

/**
 * A draft place near an anchor (a wiki place with a map pin). Returns null when nowhere fits.
 * ctx: { anchor: { title, map, terrain, magic, style }, want: ['settlement' | 'industry' | 'site'], miles: [min, max],
 *        pins: [[lon, lat]], taken: Set of lower-case page titles, from: what asked for it, peoples }
 */
export function generatePlace(data, ctx, rng = Math.random) {
  const P = data.places;
  if (!P || !ctx.anchor?.map) return null;
  const want = list(ctx.want).length ? ctx.want : ['settlement', 'industry', 'site'];
  const [lo, hi] = ctx.miles || [5, 40];
  const gap = P.minGapMiles ?? 5;
  let map = null;
  for (let i = 0; i < 80 && !map; i++) {
    const p = offset(ctx.anchor.map, lo + rng() * Math.max(0, hi - lo), rng() * 360);
    if (!onLand(p)) continue;
    if (list(ctx.pins).some(q => milesBetween(p, q) < gap)) continue;
    map = p;
  }
  if (!map) return null;
  const water = waterNear(map);
  const terrain = [...new Set([...list(ctx.anchor.terrain), ...water, 'any'])];
  const styleKey = styleFor(data, map, ctx.anchor.style);
  const st = P.styles[styleKey];
  const magic = ctx.anchor.magic || 'moderate';
  const taken = ctx.taken || new Set();
  // ctx.siteKinds narrows the choice, for a site whose name is already given ("Greywater Caves" is a cave).
  const fitting = Object.entries(P.sites || {}).filter(([k]) => !list(ctx.siteKinds).length || ctx.siteKinds.includes(k));
  const byTerrain = fitting.filter(([, s]) => !list(s.terrain).length || s.terrain.some(t => terrain.includes(t)));
  const siteKinds = byTerrain.length || !list(ctx.siteKinds).length ? byTerrain : fitting;
  const group = pick(rng, want.filter(g => g !== 'site' || siteKinds.length));
  if (!group) return null;
  const place = {
    draft: true, group, map, terrain: terrain.filter(t => t !== 'any'), water, style: styleKey, magic,
    anchor: ctx.anchor.title, miles: Math.round(milesBetween(ctx.anchor.map, map)), bearing: bearingName(ctx.anchor.map, map),
    from: ctx.from || '',
  };
  if (group === 'site') {
    const [kind, s] = pick(rng, siteKinds);
    place.kind = kind; place.label = s.label;
    place.name = uniqueName(rng, () => chance(rng, 0.5) ? `The ${pick(rng, P.siteAdjectives)} ${pick(rng, s.nouns)}` : `${styleName(rng, st)} ${pick(rng, s.nouns)}`, taken);
    place.description = pick(rng, s.descriptions);
    place.secret = pick(rng, P.secrets.site);
  } else {
    const ind = industryFor(rng, P, terrain, magic);
    const size = group === 'industry' ? weighted(rng, P.settlements.filter(x => x.kind !== 'town')) : weighted(rng, P.settlements);
    place.kind = size.kind;
    place.settlement = size.settlement;
    place.population = Math.round(int(rng, size.population[0], size.population[1]) / 10) * 10 || size.population[0];
    if (ind) { place.industry = ind.name; place.goods = ind.goods; place.magical = !!ind.magic; place.knownFor = pick(rng, ind.knownFor); }
    place.label = group === 'industry' && ind ? ind.label : size.kind;
    place.name = uniqueName(rng, () => styleName(rng, st), taken);
    place.architecture = pick(rng, list(st.architecture));
    place.priorities = sample(rng, list(st.priorities), chance(rng, 0.5) ? 2 : 1);
    place.quirk = pick(rng, P.quirks);
    place.secret = pick(rng, P.secrets.settlement);
    place.people = peopleFor(data, rng, place, ctx.peoples);
  }
  if (!place.name) return null;
  place.rumours = sample(rng, P.rumours, 2);
  for (const k of ['description', 'secret', 'quirk', 'knownFor']) if (place[k]) place[k] = fill(place[k], place);
  place.rumours = place.rumours.map(r => fill(r, place));
  return place;
}

const ROLES = {
  hamlet: ['elder'], village: ['headman', 'innkeeper'], town: ['mayor', 'innkeeper', 'watch captain'],
};
function peopleFor(data, rng, place, peoples) {
  const pool = list(peoples || data.peoples?.peoples).filter(p => list(p.names?.first).length);
  if (!pool.length) return [];
  const roles = [...(ROLES[place.kind] || ROLES.village)];
  if (place.industry) roles.push(place.magical ? 'master of the works' : 'foreman');
  return roles.map(role => {
    const pp = weighted(rng, pool);
    const last = list(pp.names.last).length && chance(rng, 0.8) ? ` ${pick(rng, pp.names.last)}` : '';
    return { role, name: pick(rng, pp.names.first) + last, people: pp.name };
  });
}

/** One line saying what and where a place is: "a fishing village 38 miles south of Greenstone". */
export function placeLine(p) {
  return `${article(p.label)} ${p.miles} miles ${p.bearing} of ${p.anchor}`;
}

/** The page a kept place becomes. */
export function placeToMarkdown(p) {
  const L = [];
  const pop = p.population ? `, about ${p.population.toLocaleString('en-US')} people` : '';
  L.push(`**${cap(p.label)}** ${p.miles} miles ${p.bearing} of [[${p.anchor}]]${pop}.`, '');
  if (p.description) L.push(p.description, '');
  if (p.architecture) L.push(p.architecture, '');
  if (p.knownFor) L.push(`**Known for:** ${p.knownFor}.`, '');
  if (p.priorities?.length) L.push(`**What matters here:** ${p.priorities.join('; ')}.`, '');
  if (p.quirk) L.push(`**Quirk:** ${p.quirk}`, '');
  if (p.people?.length) {
    L.push('## Who is there', '');
    for (const x of p.people) L.push(`- **${cap(x.role)}:** ${x.name} (${x.people})`);
    L.push('');
  }
  if (p.rumours?.length) {
    L.push('## Rumours', '');
    for (const r of p.rumours) L.push(`- ${r}`);
    L.push('');
  }
  L.push(':::dm');
  L.push(`- **Secret:** ${p.secret}`);
  if (p.from) L.push(`- **First heard of in:** ${p.from}`);
  if (p.industry) L.push(`- **Industry:** ${p.industry}${p.magical ? ' (magical)' : ''}`);
  L.push(`- **Terrain:** ${p.terrain.join(', ') || 'open country'}. Generated near ${p.anchor}.`);
  L.push(':::', '');
  return L.join('\n');
}

/** Frontmatter for a kept place: a location under its anchor, pinned, hidden from players until revealed. */
export function placeMeta(p) {
  const meta = { type: 'location', parent: p.anchor, map: p.map, tags: ['generated', p.kind, ...(p.industry ? [p.industry.toLowerCase()] : [])], dmOnly: true };
  if (p.settlement) meta.settlement = p.settlement;
  // Its own head count, so the page's numbers say the same as its text ("a hamlet, about 40 people").
  if (p.population) meta.population = p.population;
  if (p.magic && p.magic !== 'moderate') meta.magic = p.magic;
  if (p.terrain?.length) meta.terrain = p.terrain;
  meta.nameStyle = p.style;
  return meta;
}

/**
 * Pick somewhere for a job: a generated place already near the anchor (more often as the area fills up), or a
 * new draft. near: [{ title, map, generated }] wiki places with pins. Returns { title, draft? } or null.
 */
export function placeForJob(data, ctx, near, rng = Math.random) {
  const P = data.places;
  if (!P || !ctx.anchor?.map) return null;
  const [lo, hi] = ctx.miles || [5, 40];
  const inRange = list(near).filter(n => n.generated && n.title !== ctx.anchor.title && n.map && (d => d >= lo * 0.5 && d <= hi * 1.25)(milesBetween(ctx.anchor.map, n.map)));
  const r = ctx.reuse || P.reuse || {};
  const fresh = inRange.length < (r.fewNearby ?? 4) ? (r.newWhenFew ?? 0.7) : (r.newWhenMany ?? 0.25);
  if (inRange.length && !chance(rng, fresh)) return { title: pick(rng, inRange).title };
  const draft = generatePlace(data, ctx, rng);
  return draft ? { title: draft.name, draft } : inRange.length ? { title: pick(rng, inRange).title } : null;
}

// ---------- regional problems ----------
// A problem (wolves, bandits, blight) is a campaign record with a centre and a radius, not part of any page. Every
// place within the radius shows it while it lasts, and solving it clears it everywhere at once.

/** The problems a place in this style tends to have: its region's own, then the common ones. */
export function problemsFor(data, style) {
  const S = data.places?.styles || {};
  return [...list(S[style]?.problems), ...list(S.common?.problems)];
}

/**
 * A new active problem centred on a place. from: { title, map, style }; kind: one of problemsFor's entries (picked
 * at random when left out). Returns null when there is nothing to pick from.
 */
export function newProblem(data, from, rng = Math.random, kind = null) {
  const P = data.places?.problemSettings || {};
  const k = kind || pick(rng, problemsFor(data, from.style));
  if (!k || !from?.map) return null;
  const [lo, hi] = P.radius || [25, 60];
  return {
    id: `pr${Date.now().toString(36)}${Math.floor(rng() * 1e6).toString(36)}`,
    name: k.name, summary: k.summary, effect: k.effect, contract: k.contract || null, monster: k.monster || null,
    origin: from.title, centre: from.map, radius: int(rng, lo, hi), status: 'active', started: new Date().toISOString().slice(0, 10),
  };
}

/** Problems that reach a point, nearest first. With `solved`, the solved ones instead. */
export function problemsAt(problems, ll, { solved = false } = {}) {
  if (!ll) return [];
  return list(problems).filter(p => (p.status === 'solved') === solved && milesBetween(p.centre, ll) <= p.radius)
    .sort((a, b) => milesBetween(a.centre, ll) - milesBetween(b.centre, ll));
}

/** How a problem shows on one place's page: where it started, or how far off it is. */
export function problemLine(p, here) {
  const at = here.title === p.origin ? 'here' : `${Math.round(milesBetween(p.centre, here.map))} miles away, around ${p.origin}`;
  return { name: p.name, text: `${p.summary} ${p.effect}`, where: at };
}

/**
 * Suggested thanks from each place a solved problem reached: places is [{ title, map, settlement }].
 * Bigger places pay more, nearer ones are more grateful. Returns [{ title, gp, goodwill }].
 */
export function problemRewards(data, p, places) {
  const P = data.places?.problemSettings || {};
  const pay = P.rewards || { hamlet: 10, village: 40, town: 150, city: 400 };
  const thanks = list(P.goodwill);
  return list(places).filter(x => x.map && milesBetween(p.centre, x.map) <= p.radius).map((x, i) => {
    const near = milesBetween(p.centre, x.map) <= p.radius / 2;
    return {
      title: x.title, near, gp: Math.round((pay[x.settlement] ?? pay.village) * (near ? 1 : 0.5)),
      goodwill: thanks.length ? thanks[i % thanks.length] : 'Goodwill with the people there.',
    };
  });
}

// ---------- adding to a place ----------
// Buildings and features the DM adds from a place's page (lists in data/buildings.json). The page keeps them.

const ROLE_FOR = { elder: 'City official', headman: 'City official', mayor: 'City official', innkeeper: 'Merchant', 'watch captain': 'Guard or soldier', foreman: 'Crafter', 'master of the works': 'Crafter' };
/** The NPC generator role for someone listed under "Who is there". */
export const npcRoleFor = role => ROLE_FOR[String(role).toLowerCase()] || null;

/**
 * A temple or shrine for a place. churches: [{ title, weight }] (the churches with a hold there weigh more).
 * Returns { name, size, church, services: [{ name, gp }], detail, secret, priestRole }.
 */
export function generateTemple(data, place, churches, rng = Math.random) {
  const B = data.buildings?.temples || {};
  const size = B.sizes?.[place.settlement] || 'shrine';
  const ch = weighted(rng, list(churches), c => c.weight ?? 1)?.title || 'the Church of the Hearth';
  const short = ch.replace(/^(the )?church of (the )?/i, '');
  const name = pick(rng, list(B.names).length ? B.names : ['The {size} of {church}'])
    .replace('{size}', cap(size)).replace('{church}', ch).replace('{place}', place.name).replace('{adj}', pick(rng, list(B.adjectives)) || 'Old');
  const fits = list(B.services).filter(s => list(s.churches).some(c => short.toLowerCase().includes(c.toLowerCase())));
  const scale = { 'wayside shrine': 0.5, shrine: 1, temple: 1.5, 'great temple': 2 }[size] || 1;
  const services = [...fits, ...sample(rng, list(B.services).filter(s => !fits.includes(s)), size === 'wayside shrine' ? 1 : 2)]
    .slice(0, size === 'great temple' ? 6 : 4).map(s => ({ name: s.name, gp: Math.round(s.gp * scale) }));
  return { name: name.startsWith('The The') ? name.slice(4) : name, size, church: ch, services, detail: pick(rng, list(B.details)) || '', secret: pick(rng, list(B.secrets)) || '', priestRole: B.priest?.[size] || 'priest' };
}
export function templeToMarkdown(t, place, priest = null) {
  const L = [`*${cap(article(t.size))} of [[${t.church}]] in [[${place}]].* ${t.detail}`, ''];
  if (priest) L.push(`**${cap(t.priestRole)}:** ${priest}`, '');
  L.push('## Services', '', ...t.services.map(s => `- ${s.name}: ${s.gp ? `${s.gp} gp` : 'free, or what you can give'}`), '');
  L.push(':::dm', `- **Secret:** ${t.secret}`, ':::', '');
  return L.join('\n');
}
/** Another quirk for a place, not one it already has. */
export function extraQuirk(data, name, body, rng = Math.random) {
  const pool = list(data.places?.quirks).map(q => fill(q, { name })).filter(q => !String(body).includes(q));
  return pick(rng, pool) || null;
}
/** A feature a place could have been built around. kind: decorative, defensive, important, historical or any. */
export function placeFeature(data, name, body, kind = 'any', rng = Math.random) {
  const pool = list(data.buildings?.features).filter(f => (kind === 'any' || f.kind === kind) && !String(body).includes(`**${f.name.replace(/^The /, '')}`) && !String(body).includes(`### ${f.name}`));
  const f = pick(rng, pool);
  return f ? { ...f, text: fill(f.text, { name }), dm: fill(f.dm, { name }) } : null;
}

// ---------- orphanages and control points ----------

/** A town's orphanage: who runs it, what it's like, its trouble and its secret. town: { name }. */
export function generateOrphanage(data, town, rng = Math.random) {
  const O = data.buildings?.orphanage || {};
  const fill = s => String(s || '').replace(/\{town\}/g, town.name);
  const [lo, hi] = list(O.count).length ? O.count : [3, 6];
  return { name: fill(pick(rng, list(O.names)) || `The ${town.name} Foundling House`), runBy: pick(rng, list(O.runBy)) || 'the city council', detail: pick(rng, list(O.details)) || '',
    trouble: pick(rng, list(O.troubles)) || '', secret: pick(rng, list(O.secrets)) || '', count: int(rng, lo, hi) };
}
/** children: [{ name, age, line }]; carer: a [[link]] or a name. */
export function orphanageToMarkdown(o, town, carer, children) {
  return [`An orphanage in [[${town}]], run by ${o.runBy}. ${o.detail}`, '', '## Who is there', '', `- **Carer:** ${carer}`, '', '## Children', '',
    ...children.map(c => `- **${c.name}** (${c.age}): ${c.line}`), '', '## Trouble', '', o.trouble, '', ':::dm', `**Secret:** ${o.secret}`, ':::', ''].join('\n');
}

/** A place a faction would want to hold near a town: an outpost, a watchtower, a quarry, a magical industry. */
export function generateControlPoint(data, town, kind = 'any', rng = Math.random, taken = []) {
  const all = list(data.buildings?.controlPoints);
  const pool = all.filter(c => (kind === 'any' || c.kind === kind) && !taken.includes(c.kind));
  const c = pick(rng, pool.length ? pool : all);
  if (!c) return null;
  const fill = s => String(s || '').replace(/\{town\}/g, town.name);
  return { kind: c.kind, name: fill(c.name), text: fill(c.text), yields: c.yields || '', dm: fill(c.dm) };
}
export function controlPointToMarkdown(c, town, holder) {
  return [`${c.text}`, '', `- **Near:** [[${town}]]`, `- **What it gives its holder:** ${c.yields}`, `- **Held by:** ${holder ? `[[${holder}]]` : 'no one, yet'}`, '', ':::dm', c.dm, ':::', ''].join('\n');
}

// ---------- places in the sea ----------
// Major and minor sea places are pins on the World map, made in batches for a stretch of sea (data/places.json
// sea). Fleeting ones are only met on journeys at sea: a ghost ship, castaways, a dead sea monster. Ships and sky
// ships see what's near their route each day, and the DM can divert to explore.

const inSea = ll => !inside(geometry().land, toXY(ll));
/** Whether there is land within this many miles of a point in the sea. */
function landWithin(ll, miles) {
  for (const f of [1 / 3, 2 / 3, 1]) for (let b = 0; b < 360; b += 30) if (inside(geometry().land, toXY(offset(ll, miles * f, b)))) return true;
  return false;
}
const seaKinds = (data, tier) => list(data.places?.sea?.[tier]);
/** Where a kind of sea place can be: by the coast, out in the deep, and warm or cold water. */
function seaFits(S, kind, ll) {
  const set = S.settings || {};
  const lat = Math.abs(ll[1]);
  if (kind.climate === 'warm' && lat > (set.warmLat ?? 35)) return false;
  if (kind.climate === 'cold' && lat < (set.coldLat ?? 45)) return false;
  if (kind.where === 'coast') return landWithin(ll, set.coastMiles ?? 60);
  if (kind.where === 'deep') return !landWithin(ll, set.deepMiles ?? 120);
  return true;
}

/** How much of a map box ([west, south, east, north]) is sea, in square miles, by sampling a grid. */
export function seaArea(box) {
  const [w, s, e, n] = box;
  let wet = 0, all = 0;
  for (let i = 0; i < 24; i++) for (let k = 0; k < 24; k++) {
    const ll = [w + (e - w) * (i + 0.5) / 24, s + (n - s) * (k + 0.5) / 24];
    all++;
    if (inSea(ll) && Math.abs(ll[1]) < 75) wet++;
  }
  const mid = (s + n) / 2 * Math.PI / 180;
  const sq = Math.abs(e - w) * MILES_PER_DEG * Math.cos(mid) * Math.abs(n - s) * MILES_PER_DEG;
  return Math.round(sq * wet / Math.max(1, all));
}
/** How many major and minor places a stretch of sea should get: one per so many square miles. */
export function seaCounts(data, box) {
  const per = data.places?.sea?.settings?.perSquareMile || { major: 1000000, minor: 120000 };
  const area = seaArea(box);
  return { area, major: Math.min(30, Math.round(area / per.major)), minor: Math.min(120, Math.round(area / per.minor)) };
}

function seaName(rng, data, kind, ll, taken) {
  const S = data.places.sea;
  const st = data.places.styles?.[styleFor(data, ll)] || {};
  return uniqueName(rng, () => {
    const noun = pick(rng, kind.nouns);
    if (list(kind.names).length && chance(rng, 0.3)) return pick(rng, kind.names);
    if (list(st.prefixes).length && chance(rng, 0.4)) return `${styleName(rng, st)} ${noun}`;
    return `The ${pick(rng, S.adjectives)} ${noun}`;
  }, taken);
}

/**
 * A draft sea place. tier: 'major', 'minor' or 'fleeting'. ctx: { box: [w, s, e, n] to place it somewhere in, or
 * at: [lon, lat] for a fixed spot; pins: [[lon, lat]] to keep clear of; taken: Set of lower-case titles;
 * places: [{ title, map }] for saying where it is; by: 'ship' or 'air' (fleeting finds only); kind: a kind key }.
 * Returns null when nowhere fits.
 */
export function generateSeaPlace(data, tier, ctx = {}, rng = Math.random) {
  const S = data.places?.sea;
  if (!S) return null;
  const kinds = seaKinds(data, tier).filter(k => (!ctx.kind || k.key === ctx.kind) && (!ctx.by || !list(k.by).length || k.by.includes(ctx.by)));
  if (!kinds.length) return null;
  const gap = S.settings?.gap?.[tier] ?? 0;
  let map = null, kind = null;
  for (let i = 0; i < (ctx.at ? 12 : 120) && !map; i++) {
    const k = weighted(rng, kinds);
    let p = ctx.at;
    if (!p) {
      const [w, s, e, n] = ctx.box || [-180, -60, 180, 75];
      p = [Math.round((w + rng() * (e - w)) * 1000) / 1000, Math.round((s + rng() * (n - s)) * 1000) / 1000];
      if (!inSea(p) || Math.abs(p[1]) > 75) continue;
      if (list(ctx.pins).some(q => milesBetween(p, q) < gap)) continue;
    }
    if (!seaFits(S, k, p)) continue;
    map = p; kind = k;
  }
  if (!map) return null;
  const taken = ctx.taken || new Set();
  // Fleeting things aren't places with names: a ghost ship is just "a ghost ship".
  const name = tier === 'fleeting' ? cap(kind.label) : seaName(rng, data, kind, map, taken);
  if (!name) return null;
  const place = {
    draft: true, sea: kind.key, tier, kind: kind.key, label: kind.label, name, map, style: styleFor(data, map),
    description: pick(rng, kind.descriptions), secret: pick(rng, [...list(kind.secrets), ...list(S.secrets)]),
    seen: kind.seen || 'surface', marks: kind.marks !== false, people: !!kind.people, terrain: ['sea'],
  };
  const near = list(ctx.places).filter(x => x.map);
  const n = near.length ? near.reduce((a, b) => milesBetween(map, b.map) < milesBetween(map, a.map) ? b : a) : null;
  Object.assign(place, n ? { anchor: n.title, miles: Math.round(milesBetween(n.map, map)), bearing: bearingName(n.map, map) } : { anchor: '', miles: 0, bearing: '' });
  place.rumours = sample(rng, list(S.rumours), 2).map(r => fill(r, place));
  return place;
}

/** A batch of new sea places for a stretch of sea: { major, minor } of each, kept apart from each other and from pins. */
export function seedSea(data, ctx, rng = Math.random) {
  const out = [];
  const pins = [...list(ctx.pins)];
  const taken = new Set(ctx.taken || []);
  for (const tier of ['major', 'minor']) for (let i = 0; i < (Number(ctx[tier]) || 0); i++) {
    const p = generateSeaPlace(data, tier, { ...ctx, pins, taken }, rng);
    if (!p) continue;
    out.push(p); pins.push(p.map); taken.add(p.name.toLowerCase());
  }
  return out;
}

/** "A shipwreck 38 miles south-west of Greenstone", or "A shipwreck in the open sea". */
export function seaLine(p) {
  return p.anchor ? placeLine(p) : `${article(p.label)} in the open sea`;
}

/** The page a kept sea place becomes. */
export function seaToMarkdown(data, p) {
  const kind = seaKind(data, p.sea);
  const L = [`**${cap(p.label)}** ${p.anchor ? `${p.miles} miles ${p.bearing} of [[${p.anchor}]]` : 'in the open sea'}.`, '', p.description, ''];
  const seen = { surface: 'Seen from a ship or a sky ship.', shallow: 'Just under the water: seen from a ship, or from the air on a clear day.', sunken: 'Under the water: only seen from close by on a ship.' }[p.seen];
  if (seen) L.push(`*${seen}*`, '');
  if (p.found) L.push(`**Found:** ${p.found}`, '');
  if (kind?.explore?.finds?.length) {
    L.push('## What is there', '');
    for (const f of kind.explore.finds) L.push(`- ${f}`);
    L.push('');
  }
  if (p.rumours?.length) {
    L.push('## Rumours', '');
    for (const r of p.rumours) L.push(`- ${r}`);
    L.push('');
  }
  L.push(':::dm', `- **Secret:** ${p.secret}`);
  if (kind?.explore?.check) L.push(`- **Getting in:** ${kind.explore.check}.`);
  L.push(`- **Sea place:** ${p.tier}, ${p.label}. Exploring takes about ${dayShare(kind?.explore?.cost ?? 0.5)} plus the detour.`, ':::', '');
  return L.join('\n');
}
/** Frontmatter for a kept sea place. Majors are known to players; minors start hidden unless found by the party. */
export function seaMeta(p, { hidden = p.tier !== 'major', parent = p.anchor } = {}) {
  const meta = { type: 'location', map: p.map, sea: p.sea, seen: p.seen, tags: ['generated', 'sea place', p.tier, p.label] };
  if (parent) meta.parent = parent;
  if (hidden) meta.dmOnly = true;
  return meta;
}
export const seaKind = (data, key) => ['major', 'minor', 'fleeting'].flatMap(t => seaKinds(data, t)).find(k => k.key === key) || null;
const dayShare = f => f >= 1 ? 'a day' : f >= 0.5 ? 'half a day' : f > 0 ? 'a few hours' : 'no time at all';

// ---------- sighting sea places on a journey ----------

/** Miles from point p to the segment a-b, all [lon, lat], flattened around them (fine for a day's travel). */
function segMiles(p, a, b) {
  const lat = (a[1] + b[1]) / 2 * Math.PI / 180;
  const xy = q => [q[0] * MILES_PER_DEG * Math.cos(lat), q[1] * MILES_PER_DEG];
  const [P, A, B] = [p, a, b].map(xy);
  return segDist(P, A, B);
}
const along = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/**
 * What the party sees from the water on a day's travel. ctx: { a, b: where the day started and ended ([lon, lat],
 * either may be missing on an open-ended journey), by: 'ship' | 'air' | 'shore', weather: its name, openSea: the day's
 * terrain is at sea, places: sea places on the map [{ title, map, seen, hidden }], taken, pins }.
 * Returns { by, passing: [{ title, miles, hidden }], found: a fleeting draft or null }, or null when there's no sea.
 */
export function seaSightings(data, ctx, rng = Math.random) {
  const S = data.places?.sea;
  if (!S || !ctx.by) return null;
  const set = S.settings || {};
  const foul = list(set.foul?.weather).some(w => String(ctx.weather || '').toLowerCase().includes(w.toLowerCase()));
  const range = (set.sight?.[ctx.by] ?? 12) * (foul ? set.foul?.factor ?? 0.5 : 1);
  const { a, b } = ctx;
  const known = a && b;
  const wet = known ? [0, 0.25, 0.5, 0.75, 1].map(t => along(a, b, t)).filter(inSea) : [];
  if (known && !wet.length) return null;
  if (!known && !ctx.openSea) return null;
  const passing = [];
  if (known) for (const p of list(ctx.places)) {
    if (!p.map) continue;
    const kind = seaKind(data, p.sea);
    const seen = p.seen || kind?.seen || 'surface';
    if (ctx.by === 'air' && (seen === 'sunken' || (seen === 'shallow' && foul))) continue;
    const reach = range * (seen === 'sunken' ? 0.5 : 1) + (Number(kind?.sight) || 0) * (foul ? 0.5 : 1);
    const d = segMiles(p.map, a, b);
    if (d <= reach) passing.push({ title: p.title, miles: Math.round(d), hidden: !!p.hidden, cost: kind?.explore?.cost ?? 0.5 });
  }
  passing.sort((x, y) => x.miles - y.miles);
  let found = null;
  if (ctx.by !== 'shore' && chance(rng, set.findChance?.[ctx.by] ?? 0.25)) {
    // Somewhere off to one side of the day's course: a spot on the map if the route is known.
    const base = known ? pick(rng, wet) : null;
    const spot = base ? offset(base, 2 + rng() * range * 0.8, rng() * 360) : null;
    const at = spot && inSea(spot) ? spot : base;
    const minor = chance(rng, set.findMinor ?? 0.4);
    const opts = { at, by: ctx.by === 'air' ? 'air' : 'ship', taken: ctx.taken, places: ctx.anchors };
    found = (minor && at && generateSeaPlace(data, 'minor', opts, rng)) || generateSeaPlace(data, 'fleeting', opts, rng)
      || (at ? null : generateSeaPlace(data, 'fleeting', { ...opts, at: [0, 0] }, rng));
    if (found && !at) { found.map = null; found.marks = false; }
    if (found && ctx.by === 'air' && found.seen === 'sunken') found = null;
    if (found) found.offRoute = known && found.map ? Math.round(segMiles(found.map, a, b)) : 2;
  }
  if (!passing.length && !found) return { by: ctx.by, passing: [], found: null };
  return { by: ctx.by, passing, found };
}

/**
 * What the party finds when it diverts to a sea place. kind: its sea kind; offMiles: how far off the course it is;
 * pace: the day's miles. Returns { find, check, frac (share of the day lost), fight, loot } where fight and loot
 * are flags for the app to fill in with the encounter and travel loot generators.
 */
export function exploreSea(kind, { offMiles = 0, pace = 24 } = {}, rng = Math.random) {
  const ex = kind?.explore || {};
  const detour = pace > 0 ? 2 * offMiles / pace : 0;
  return {
    find: pick(rng, list(ex.finds)) || 'Nothing much, in the end: a story to tell.',
    check: ex.check || '',
    frac: Math.min(1, Math.round(((ex.cost ?? 0.5) + detour) * 100) / 100),
    fight: chance(rng, ex.danger ?? 0.25),
    loot: chance(rng, ex.loot ?? 0.3),
  };
}

/**
 * Places on the map near a day's route over land, for the party to leave the road and explore. ctx: { a, b: where the
 * day started and ended ([lon, lat]), weather: its name, places: [{ title, map, hidden }] }. Returns
 * [{ title, miles, hidden }], nearest first, or null when the route isn't on the map.
 */
export function landSightings(data, ctx) {
  const L = data.places?.onLand;
  const { a, b } = ctx;
  if (!L || !a || !b) return null;
  const foul = list(data.places?.sea?.settings?.foul?.weather).some(w => String(ctx.weather || '').toLowerCase().includes(w.toLowerCase()));
  const reach = (Number(L.sight) || 6) * (foul ? Number(L.foulFactor) || 0.5 : 1);
  return list(ctx.places).filter(p => p.map).map(p => ({ title: p.title, miles: Math.round(segMiles(p.map, a, b)), hidden: !!p.hidden }))
    .filter(p => p.miles <= reach).sort((x, y) => x.miles - y.miles);
}
