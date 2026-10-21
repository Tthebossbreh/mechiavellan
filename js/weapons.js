// Mech parts data. Customization is the core pillar of the game, so this file
// is deliberately data-only: everything here is pure and unit-testable, and is
// read both by the hangar UI and the simulation.
//
// ---------------------------------------------------------------------------
// HEAT MODEL  (this is what keeps the frames honest)
// ---------------------------------------------------------------------------
// Every weapon has a `heat` (heat generated per second at its nominal rate).
// Every chassis has a `cooling` (heat shed per second) and a `capacity` (heat
// sink size). Firing adds heat, cooling removes it, and the *current* heat
// level throttles every weapon's rate of fire:
//
//     heatRatio = heat / capacity
//     cycleScale = 1 + heatRatio * HEAT_THROTTLE      (> 1 = slower cycling)
//     effectiveCooldown = weapon.cooldown * cycleScale
//
// At a steady state, heat generated == heat shed, which means:
//
//     sustained dps ~= cooling * (sum of dps) / (sum of heat)
//
// Note what is *missing* from that equation: the number of hardpoints. Because
// cooling is the same on every chassis, and because each weapon's `heat` is set
// to roughly its damage-per-second / 10, sustained damage ends up near-identical
// whichever frame you pick. What the frame changes is **burst**:
//
//   * Light frame: two guns, low heat, so it never really overheats. It just
//     keeps firing, all day, forever.
//   * Large frame: six guns -> triple the alpha strike, but the reactor
//     saturates in a few seconds and you must let it vent.
//
// So six guns is no longer "three times the damage for a bit less speed". It is
// three times the *burst*, paid for with speed, size, and a vent cycle.
//
// Filling every hardpoint is always better than leaving one empty (more guns =
// more burst, same sustained), so there is no reason to under-fill.

import { clamp } from './utils.js';

/**
 * How much heat throttles rate of fire: cycleScale at 100% heat is 1 + this.
 *
 * Kept low deliberately. A loadout settles where heat generated == heat shed,
 * i.e. cycleScale ~= heatRate / cooling. If that target is above 1 + throttle
 * the mech cannot settle and will saturate and overheat instead -- which is
 * exactly the large frame's identity, and the light frame can never reach it.
 */
export const HEAT_THROTTLE = 1.6;

/** Radiator throughput is identical on every chassis. */
export const COOLING = 14;

/**
 * Chassis. The frame decides how big a heat sink you have (i.e. how long an
 * alpha strike you can sustain) and how well you can avoid being hit.
 * @typedef {object} Frame
 * @property {string} id
 * @property {string} name
 * @property {string} codename
 * @property {number} hull      max health
 * @property {number} speed     max horizontal speed (px/s)
 * @property {number} jump      jump impulse (px/s)
 * @property {number} accel     horizontal acceleration (px/s^2)
 * @property {number} armor     flat damage reduction
 * @property {number} mass      recoil resistance (heavier frames kick less)
 * @property {number} slots     how many weapons this frame can carry
 * @property {number} cooling   heat shed per second
 * @property {number} capacity  heat sink size
 * @property {number} scale     visual + hitbox scale
 * @property {string} blurb
 */

/** @type {Frame[]} */
export const FRAMES = [
  {
    id: 'light',
    name: 'Light Frame',
    codename: 'WRAITH-2',
    hull: 100,
    speed: 470,
    jump: 910,
    accel: 6600,
    armor: 0,
    mass: 1,
    slots: 2,
    cooling: COOLING,
    capacity: 55,
    scale: 0.88,
    blurb:
      'Fastest chassis and the smallest target. It runs cool, so its two guns keep cycling while bigger machines are venting.',
  },
  {
    id: 'medium',
    name: 'Medium Frame',
    codename: 'BASTION-4',
    hull: 135,
    speed: 385,
    jump: 830,
    accel: 5200,
    armor: 1,
    mass: 1.6,
    slots: 4,
    cooling: COOLING,
    capacity: 85,
    scale: 1,
    blurb:
      'The all-rounder. Four hardpoints: double the alpha strike of a light frame, with enough heat sink to hold it for a few seconds.',
  },
  {
    id: 'large',
    name: 'Large Frame',
    codename: 'LEVIATHAN-6',
    hull: 165,
    speed: 290,
    jump: 700,
    accel: 4000,
    armor: 2,
    mass: 2.4,
    slots: 6,
    cooling: COOLING,
    capacity: 115,
    scale: 1.2,
    blurb:
      'A walking fortress. Six hardpoints means a monstrous opening volley — then the reactor saturates and you must vent, slowly, in a very large target.',
  },
];

/**
 * Weapons. `cooldown` is seconds between shots, `speed` is projectile speed in
 * px/s and `life` is the projectile's lifetime in seconds, so speed * life is
 * the weapon's effective range.
 *
 * `heat` is heat generated per second at the nominal rate, and is deliberately
 * close to damage-per-second / 10 so that no weapon is a strictly better use of
 * your heat budget than another. The outliers are nudged for range and for
 * whether the shots are guaranteed to connect.
 *
 * @typedef {object} Weapon
 * @property {string} id
 * @property {string} name
 * @property {string} abbr     3-letter hardpoint label
 * @property {string} klass    display class
 * @property {string} kind     projectile style: ballistic | energy | missile
 * @property {number} damage   damage per projectile
 * @property {number} cooldown seconds between shots
 * @property {number} speed    projectile speed (px/s)
 * @property {number} life     projectile lifetime (s)
 * @property {number} pellets  projectiles per shot
 * @property {number} spread   max inaccuracy in radians
 * @property {{w:number,h:number}} size projectile size
 * @property {string} color
 * @property {number} pierce   extra enemies a projectile can pass through
 * @property {number} homing   turn rate in rad/s (0 = unguided)
 * @property {number} weight   recoil mass and flavour
 * @property {number} heat     heat per second at nominal rate
 * @property {string} blurb
 */

/** @type {Weapon[]} */
export const WEAPONS = [
  {
    id: 'vulcan',
    name: 'Vulcan Autocannon',
    abbr: 'VUL',
    klass: 'Ballistic',
    kind: 'ballistic',
    damage: 6,
    cooldown: 0.09,
    speed: 1050,
    life: 0.7,
    pellets: 1,
    spread: 0.05,
    size: { w: 9, h: 4 },
    color: '#ffe08a',
    pierce: 0,
    homing: 0,
    weight: 3,
    heat: 6.7,
    blurb: 'Shredder. Trades punch for a constant wall of lead.',
  },
  {
    id: 'autocannon',
    name: 'Battle Autocannon',
    abbr: 'ACN',
    klass: 'Ballistic',
    kind: 'ballistic',
    damage: 14,
    cooldown: 0.28,
    speed: 900,
    life: 1.1,
    pellets: 1,
    spread: 0.03,
    size: { w: 12, h: 6 },
    color: '#ffd257',
    pierce: 0,
    homing: 0,
    weight: 5,
    heat: 5,
    blurb: 'Dependable mid-calibre rounds. Runs cool for its damage.',
  },
  {
    id: 'pulse',
    name: 'Pulse Laser',
    abbr: 'PLS',
    klass: 'Energy',
    kind: 'energy',
    damage: 11,
    cooldown: 0.16,
    speed: 1250,
    life: 1.0,
    pellets: 1,
    spread: 0.01,
    size: { w: 18, h: 6 },
    color: '#8fe9ff',
    pierce: 0,
    homing: 0,
    weight: 4,
    heat: 6.9,
    blurb: 'Accurate, flat-trajectory bolts. Best when you can hold the line.',
  },
  {
    id: 'plasma',
    name: 'Plasma Projector',
    abbr: 'PLZ',
    klass: 'Energy',
    kind: 'energy',
    damage: 38,
    cooldown: 0.9,
    speed: 620,
    life: 1.6,
    pellets: 1,
    spread: 0.02,
    size: { w: 22, h: 22 },
    color: '#b07cff',
    pierce: 0,
    homing: 0,
    weight: 9,
    heat: 4.4,
    blurb: 'Cheap on heat, slow to arrive, and it hits like a truck. Lead your targets.',
  },
  {
    id: 'scatter',
    name: 'Scatter Cannon',
    abbr: 'SCT',
    klass: 'Ballistic',
    kind: 'ballistic',
    damage: 7,
    cooldown: 0.75,
    speed: 880,
    life: 0.5,
    pellets: 5,
    spread: 0.22,
    size: { w: 7, h: 7 },
    color: '#ffb15c',
    pierce: 0,
    homing: 0,
    weight: 6,
    heat: 4.9,
    blurb: 'Five pellets, brutal up close, near-useless at range. Runs cool.',
  },
  {
    id: 'missiles',
    name: 'Missile Pod',
    abbr: 'MSL',
    klass: 'Missile',
    kind: 'missile',
    damage: 24,
    cooldown: 0.7,
    speed: 470,
    life: 2.2,
    pellets: 2,
    spread: 0.12,
    size: { w: 16, h: 6 },
    color: '#ff8a6b',
    pierce: 0,
    homing: 2.6,
    weight: 7,
    heat: 7,
    blurb: 'Guided warheads that always connect. You pay full heat for that.',
  },
  {
    id: 'railgun',
    name: 'Rail Cannon',
    abbr: 'RAI',
    klass: 'Energy',
    kind: 'energy',
    damage: 62,
    cooldown: 1.4,
    speed: 1800,
    life: 1.2,
    pellets: 1,
    spread: 0,
    size: { w: 28, h: 7 },
    color: '#7fe6ff',
    pierce: 3,
    homing: 0,
    weight: 10,
    heat: 4.5,
    blurb: 'Hypervelocity slug that punches through a line of enemies. Line them up.',
  },
  {
    id: 'flamer',
    name: 'Inferno Flamer',
    abbr: 'FLM',
    klass: 'Thermal',
    kind: 'energy',
    damage: 3,
    cooldown: 0.045,
    speed: 520,
    life: 0.45,
    pellets: 1,
    spread: 0.22,
    size: { w: 11, h: 11 },
    color: '#ff7a3c',
    pierce: 0,
    homing: 0,
    weight: 4,
    heat: 6.7,
    blurb: 'A cone of fire with a surprising reach. Cheap on heat, hungry for contact range.',
  },
];

/** @param {string} id */
export function weaponById(id) {
  return WEAPONS.find((w) => w.id === id) || null;
}

/** @param {string} id */
export function frameById(id) {
  return FRAMES.find((f) => f.id === id) || null;
}

/** Shots per second at nominal cooldown, for display. */
export function fireRate(weapon) {
  return weapon.cooldown > 0 ? 1 / weapon.cooldown : 0;
}

/** Damage in one shot (all pellets). */
export function burstDamage(weapon) {
  return weapon.damage * (weapon.pellets || 1);
}

/** Effective reach in px. */
export function weaponRange(weapon) {
  return weapon.speed * weapon.life;
}

/** Damage per second at nominal rate (no heat throttling). */
export function weaponDps(weapon) {
  return burstDamage(weapon) / weapon.cooldown;
}

/** Heat added by a single shot (heat rate x time between shots). */
export function heatPerShot(weapon) {
  return weapon.heat * weapon.cooldown;
}

/**
 * Build a loadout object. `weaponIds` is a list of weapon ids or nulls; empty
 * slots are dropped so the simulation only ever sees installed weapons.
 * @param {string} frameId
 * @param {(string|null)[]} weaponIds
 */
export function makeLoadout(frameId, weaponIds) {
  const frame = frameById(frameId) || FRAMES[0];
  const weapons = [];
  for (let i = 0; i < frame.slots; i++) {
    const w = weaponById(weaponIds[i]);
    if (w) weapons.push(w);
  }
  return { frame, weapons };
}

/** Total heat generated per second with every weapon firing. */
export function totalHeatRate(weapons) {
  let total = 0;
  for (const w of weapons) if (w) total += w.heat || 0;
  return total;
}

/** Total damage per second with every weapon at nominal rate (burst). */
export function burstDps(weapons) {
  let total = 0;
  for (const w of weapons) if (w) total += weaponDps(w);
  return total;
}

/**
 * Sustained damage per second once heat generation balances heat shedding.
 * Independent of hardpoint count, which is what keeps the frames level.
 * @param {object} frame
 * @param {(object|null)[]} weapons
 */
export function sustainedDps(frame, weapons) {
  const burst = burstDps(weapons);
  if (burst <= 0) return 0;
  const heat = totalHeatRate(weapons);
  if (heat <= frame.cooling) return burst; // never throttles: full rate, forever
  return burst * (frame.cooling / heat);
}

/**
 * The cooldown multiplier a loadout settles at under sustained fire. 1 means it
 * runs cool and never throttles.
 * @param {object} frame
 * @param {(object|null)[]} weapons
 */
export function settleCycle(frame, weapons) {
  const heat = totalHeatRate(weapons);
  if (heat <= frame.cooling) return 1;
  return heat / frame.cooling;
}

/**
 * True when sustained fire cannot settle below the throttle ceiling, so the
 * mech will saturate its heat sink and be forced to vent.
 * @param {object} frame
 * @param {(object|null)[]} weapons
 */
export function willOverheat(frame, weapons) {
  return settleCycle(frame, weapons) > 1 + HEAT_THROTTLE;
}

/**
 * Cooldown multiplier at a given heat level. Exposed so the hangar and the
 * simulation agree on exactly one definition.
 * @param {object} frame
 * @param {number} heat
 */
export function cycleScaleAt(frame, heat) {
  return 1 + clamp(heat / frame.capacity, 0, 1) * HEAT_THROTTLE;
}
