// Shared math and helper functions used across the game.

export const TAU = Math.PI * 2;

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const lerp = (a, b, t) => a + (b - a) * t;

export const rand = (min, max) => min + Math.random() * (max - min);

export const randInt = (min, max) => Math.floor(rand(min, max + 1));

export const pick = (items) => items[Math.floor(Math.random() * items.length)];

/** Axis-aligned bounding box overlap test. Both objects need x, y, w, h. */
export function aabb(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Move `current` toward `target` by at most `maxDelta`. */
export function moveToward(current, target, maxDelta) {
  if (current < target) return Math.min(current + maxDelta, target);
  return Math.max(current - maxDelta, target);
}
