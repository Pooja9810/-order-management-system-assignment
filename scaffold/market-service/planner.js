// What the market is going to do with an order.
//
// The whole plan is decided the moment the order is accepted, from the seed and
// the clientOrderId alone. Nothing here looks at the clock, at how many other
// orders exist, or at the order in which they arrived. Same seed, same plan.

import { streamFor, intBetween, weightedPick, hashString } from '../lib/rng.js';

export const PLAN_KINDS = [
  'FILL_FAST',     // fills completely, quickly
  'FILL_SLOW',     // fills completely, in several pieces, over a few seconds
  'REJECT',        // the venue refuses it
  'REST_PARTIAL',  // fills part of the way and then sits there
  'REST_NONE',     // sits there without trading at all
];

const KIND_WEIGHTS = [
  { value: 'FILL_FAST', weight: 30 },
  { value: 'FILL_SLOW', weight: 25 },
  { value: 'REJECT', weight: 15 },
  { value: 'REST_PARTIAL', weight: 15 },
  { value: 'REST_NONE', weight: 15 },
];

const REJECT_REASONS = [
  'INSUFFICIENT_LIQUIDITY',
  'PRICE_AWAY_FROM_MARKET',
  'VENUE_REJECTED_SIZE',
  'SYMBOL_NOT_TRADED_HERE',
];

/** A made-up but stable price for a symbol at a venue, in minor units. */
export function basePriceMinor(symbol, venue) {
  return 5000 + (hashString(`${symbol}@${venue}`) % 45000);
}

/** Split `total` into `parts` positive integers that sum to `total`. */
function splitQuantity(rng, total, parts) {
  if (parts <= 1 || total <= 1) return [total];
  const cuts = [];
  for (let i = 0; i < parts - 1; i++) cuts.push(intBetween(rng, 1, total - 1));
  cuts.sort((a, b) => a - b);
  const pieces = [];
  let previous = 0;
  for (const cut of cuts) {
    pieces.push(cut - previous);
    previous = cut;
  }
  pieces.push(total - previous);
  return pieces.filter((n) => n > 0);
}

/**
 * The kind of plan an order will get. Depends on the seed and clientOrderId
 * only, so it can be worked out before the order is ever sent.
 */
export function planKindFor(seed, clientOrderId) {
  return weightedPick(streamFor(seed, clientOrderId), KIND_WEIGHTS);
}

/**
 * Build the full plan.
 *
 * Returns { kind, restsForever, events: [{ atMs, type, ... }] } where atMs is
 * milliseconds after the order was accepted.
 */
export function buildPlan(seed, order) {
  const rng = streamFor(seed, order.clientOrderId);
  const kind = weightedPick(rng, KIND_WEIGHTS);

  const events = [];
  let clock = intBetween(rng, 15, 60);
  events.push({ atMs: clock, type: 'ACCEPTED' });

  const priceFor = (index) => {
    if (order.orderType === 'LIMIT') return order.limitPriceMinor;
    const base = basePriceMinor(order.symbol, order.venue);
    const drift = intBetween(rng, -50, 50); // up to half a percent either way
    return Math.max(1, base + Math.round((base * drift) / 10000) + index);
  };

  if (kind === 'REJECT') {
    clock += intBetween(rng, 40, 200);
    events.push({
      atMs: clock,
      type: 'REJECTED',
      reason: REJECT_REASONS[intBetween(rng, 0, REJECT_REASONS.length - 1)],
    });
    return { kind, restsForever: false, events };
  }

  let fillTotal = order.quantity;
  let pieces;

  if (kind === 'FILL_FAST') {
    pieces = splitQuantity(rng, fillTotal, intBetween(rng, 1, 2));
  } else if (kind === 'FILL_SLOW') {
    pieces = splitQuantity(rng, fillTotal, intBetween(rng, 3, 4));
  } else if (kind === 'REST_PARTIAL') {
    const percent = intBetween(rng, 30, 70);
    fillTotal = Math.max(1, Math.floor((order.quantity * percent) / 100));
    if (fillTotal >= order.quantity) fillTotal = order.quantity - 1;
    pieces = fillTotal > 0 ? splitQuantity(rng, fillTotal, intBetween(rng, 1, 2)) : [];
  } else {
    pieces = [];
  }

  const slow = kind === 'FILL_SLOW';
  pieces.forEach((quantity, index) => {
    clock += slow ? intBetween(rng, 200, 900) : intBetween(rng, 30, 150);
    events.push({
      atMs: clock,
      type: 'FILL',
      quantity,
      priceMinor: priceFor(index),
    });
  });

  return {
    kind,
    restsForever: kind === 'REST_PARTIAL' || kind === 'REST_NONE',
    events,
  };
}
