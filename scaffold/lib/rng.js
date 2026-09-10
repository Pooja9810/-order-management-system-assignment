// Deterministic pseudo-random numbers.
//
// Everything the market does that looks random is driven from here, so a given
// MARKET_SEED always produces the same decisions. Nothing in this file depends
// on the wall clock or on the order in which requests arrive.

/** FNV-1a: turns a string into a 32-bit unsigned integer. */
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32: small, fast, well-behaved 32-bit PRNG. */
export function makeRng(seedInt) {
  let a = seedInt >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * An independent random stream per key. Two orders never draw from the same
 * stream, so the numbers an order sees do not depend on how many other orders
 * came before it.
 */
export function streamFor(seed, key) {
  return makeRng(hashString(`${seed}::${key}`));
}

export function intBetween(rng, lo, hi) {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

export function pick(rng, items) {
  return items[Math.floor(rng() * items.length)];
}

/** Pick one item from [{ value, weight }, ...]. */
export function weightedPick(rng, weighted) {
  const total = weighted.reduce((sum, w) => sum + w.weight, 0);
  let roll = rng() * total;
  for (const entry of weighted) {
    roll -= entry.weight;
    if (roll < 0) return entry.value;
  }
  return weighted[weighted.length - 1].value;
}
