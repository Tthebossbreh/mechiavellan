// Mech parts data. Customization is the core pillar of the game, so this file
// is deliberately data-only: everything here is pure and unit-testable, and is
// read both by the hangar UI and the simulation.
//
// ===========================================================================
// WEAPON DIVERSITY
// ===========================================================================
// Weapons are not "a damage number at a different rate". Each one has a
// distinct *delivery*, dispatched on `mode`:
//
//   projectile - ordinary shot (may carry pierce / homing / splash / fragments)
//   burst      - a fixed number of rounds per trigger pull, fired in sequence
//   charge     - hold to charge, releases automatically at full power
//   beam       - continuous hitscan ray, damages whatever it touches
//   chain      - instant hit that arcs on to further targets
//
// ...plus per-weapon extras: `pellets`, `spread` + `divergence` (a cone that
// widens with distance), `splash` radius, `fragments` (submunitions), `pierce`,
// `homing`, and `interceptable` (the missile can be shot down in flight).
//
// ===========================================================================
// AMMO
// ===========================================================================
// Weapons whose `ammo` is non-null carry limited rounds. They are the only
// weapons that need ammo, which is the whole point of the axis: ballistics and
// missiles hit hard and run cool, but they run *dry*; energy weapons never need
// a box of shells but cook you alive.
//
// ===========================================================================
// HEAT  (this is what keeps the frames honest, and now what kills you)
// ===========================================================================
//   heatRatio  = heat / heatSink
//   cycleScale = 1 + heatRatio * HEAT_THROTTLE        // multiplies cooldowns
//
// Firing adds heat, cooling removes it. Sustained damage works out to about
// `cooling * (sum of dps) / (sum of heat)` -- note the absence of hardpoint
// count, which is what stops six guns being three times the damage.
//
// Heat is now genuinely dangerous, in escalating tiers:
//   * heatRatio > ARMOR_MELT_AT   -> armour plating softens, then vanishes
//   * heatRatio > HEAT_DAMAGE_AT  -> the mech itself starts burning
//   * heatRatio >= 1              -> OVERHEAT: weapons lock until it vents
//
// Using ammo adds heat on top of the weapon's own (`AMMO_HEAT` per round), so
// holding the trigger on a belt-fed gun cooks you faster than the numbers on
// the weapon card alone suggest.

import { clamp } from './utils.js';

/** How much heat throttles rate of fire: cycleScale at 100% heat is 1 + this. */
export const HEAT_THROTTLE = 1.6;

/** Radiator throughput, identical on every chassis. */
export const COOLING = 8;

/** Extra heat per round fired by any ammo-consuming weapon. */
export const AMMO_HEAT = 0.35;

/** Above this heat ratio, armour plating starts to soften (gone at 1.0). */
export const ARMOR_MELT_AT = 0.55;

/** Above this heat ratio, the mech takes continuous heat damage. */
export const HEAT_DAMAGE_AT = 0.8;

/** Hull damage per second at maximum heat. */
export const MAX_HEAT_DPS = 10;

/**
 * Chassis. Frames decide hardpoint count, how big a heat sink you have, and how
 * well you survive being hit.
 * @typedef {object} Frame
 * @property {string} id
 * @property {string} name
 * @property {string} codename
 * @property {number} hull
 * @property {number} speed      max horizontal speed (px/s)
 * @property {number} jump       jump impulse (px/s)
 * @property {number} accel      horizontal acceleration (px/s^2)
 * @property {number} armor      flat damage reduction while cool
 * @property {number} mass       recoil resistance
 * @property {number} slots      hardpoints
 * @property {number} cooling    heat shed per second
 * @property {number} capacity   heat sink size
 * @property {number} scale      visual + hitbox scale
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
    capacity: 30,
    scale: 0.88,
    blurb:
      'Fastest chassis, smallest target, and by far the easiest to keep from cooking. Two hardpoints only.',
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
    capacity: 40,
    scale: 1,
    blurb:
      'The all-rounder. Four hardpoints and a middling heat sink: enough for a real alpha strike, not enough to hold the trigger.',
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
    capacity: 55,
    scale: 1.2,
    blurb:
      'A walking fortress. Six hardpoints means an enormous opening volley, then a long, exposed vent in a very large target.',
  },
];

/**
 * @typedef {object} AmmoSpec
 * @property {number} magazine  rounds per magazine
 * @property {number} reload    seconds to reload
 * @property {number} reserve   spare rounds carried at deployment
 */

/**
 * @typedef {object} Weapon
 * @property {string} id
 * @property {string} name
 * @property {string} abbr
 * @property {string} klass        Ballistic | Energy | Missile | Thermal
 * @property {string} kind         projectile look: ballistic | energy | missile
 * @property {string} mode         projectile | burst | charge | beam | chain
 * @property {number} damage
 * @property {number} cooldown     seconds between shots (or between bursts)
 * @property {number} speed        projectile speed (px/s)
 * @property {number} life         projectile lifetime (s)
 * @property {number} pellets      projectiles per shot
 * @property {number} spread       max inaccuracy (radians)
 * @property {number} [divergence] extra radians/second of spread as it flies
 * @property {{w:number,h:number}} size
 * @property {string} color
 * @property {number} pierce
 * @property {number} homing
 * @property {number} weight
 * @property {number} heat         heat per second at nominal rate
 * @property {AmmoSpec|null} ammo
 * @property {number} [burst]      rounds per trigger pull (mode 'burst')
 * @property {number} [burstGap]   seconds between rounds inside a burst
 * @property {number} [charge]     seconds to charge (mode 'charge')
 * @property {number} [dps]        damage per second (mode 'beam')
 * @property {number} [beamRange]  ray length (mode 'beam')
 * @property {number} [chain]      extra targets (mode 'chain')
 * @property {number} [chainRange] jump distance between chain targets
 * @property {number} [seekRange]  acquisition range for chain
 * @property {number} [splash]     blast radius on death
 * @property {number} [splashDamage]
 * @property {number} [fragments]  submunitions spawned on death
 * @property {number} [fragmentSpread]
 * @property {number} [fragmentSpeed]
 * @property {number} [fragmentDamage]
 * @property {number} [fragmentLife]
 * @property {number} [launchHeat] flat heat added when the weapon fires
 * @property {boolean} [interceptable] can be shot down in flight
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
    mode: 'projectile',
    damage: 5,
    cooldown: 0.07,
    speed: 1050,
    life: 0.6,
    pellets: 1,
    spread: 0.06,
    size: { w: 9, h: 4 },
    color: '#ffe08a',
    pierce: 0,
    homing: 0,
    weight: 3,
    heat: 2.1,
    ammo: { magazine: 120, reload: 2.2, reserve: 360 },
    blurb: 'Belt-fed stream. Endless chatter until the belt runs out, then a long, loud reload.',
  },
  {
    id: 'burst',
    name: 'Battle Autocannon',
    abbr: 'ACN',
    klass: 'Ballistic',
    kind: 'ballistic',
    mode: 'burst',
    damage: 12,
    cooldown: 0.85,
    burst: 3,
    burstGap: 0.07,
    speed: 950,
    life: 1.05,
    pellets: 1,
    spread: 0.02,
    size: { w: 12, h: 6 },
    color: '#ffd257',
    pierce: 0,
    homing: 0,
    weight: 5,
    heat: 2.6,
    ammo: { magazine: 45, reload: 2.0, reserve: 135 },
    blurb: 'Three-round bursts. Punchy and accurate, and it paces your heat for you.',
  },
  {
    id: 'shotgun',
    name: 'Scatter Cannon',
    abbr: 'SCT',
    klass: 'Ballistic',
    kind: 'ballistic',
    mode: 'projectile',
    damage: 7,
    cooldown: 0.85,
    speed: 880,
    life: 0.5,
    pellets: 6,
    spread: 0.26,
    size: { w: 7, h: 7 },
    color: '#ffb15c',
    pierce: 0,
    homing: 0,
    weight: 6,
    heat: 4.6,
    ammo: { magazine: 16, reload: 2.4, reserve: 48 },
    blurb: 'Six pellets of pure contact-range violence. Nothing at all past a few metres.',
  },
  {
    id: 'flak',
    name: 'Flak Cannon',
    abbr: 'FLK',
    klass: 'Ballistic',
    kind: 'ballistic',
    mode: 'projectile',
    damage: 20,
    cooldown: 0.95,
    speed: 700,
    life: 0.85,
    pellets: 1,
    spread: 0.02,
    size: { w: 12, h: 12 },
    color: '#ffd08a',
    pierce: 0,
    homing: 0,
    weight: 6,
    heat: 4.3,
    ammo: { magazine: 20, reload: 2.2, reserve: 60 },
    fragments: 6,
    fragmentSpread: 0.9,
    fragmentSpeed: 620,
    fragmentDamage: 8,
    fragmentLife: 0.35,
    blurb: 'A shell that cracks open into six fragments at the end of its flight. Great against a crowd.',
  },
  {
    id: 'railgun',
    name: 'Rail Cannon',
    abbr: 'RAI',
    klass: 'Energy',
    kind: 'energy',
    mode: 'charge',
    damage: 90,
    charge: 0.9,
    cooldown: 0.35,
    speed: 1900,
    life: 1.3,
    pellets: 1,
    spread: 0,
    size: { w: 30, h: 8 },
    color: '#7fe6ff',
    pierce: 4,
    homing: 0,
    weight: 10,
    heat: 7.2,
    ammo: null,
    blurb: 'Hold to spool the capacitors, release at full charge. Punches through four enemies in a line.',
  },
  {
    id: 'beam',
    name: 'Beam Laser',
    abbr: 'BEM',
    klass: 'Energy',
    kind: 'energy',
    mode: 'beam',
    damage: 0,
    dps: 62,
    cooldown: 0,
    speed: 0,
    life: 0,
    pellets: 1,
    spread: 0,
    size: { w: 0, h: 0 },
    color: '#8fe9ff',
    pierce: 0,
    homing: 0,
    weight: 5,
    heat: 6,
    ammo: null,
    beamRange: 1150,
    blurb: 'A continuous ray. No ammo, no reload, no mercy — but it pours heat in the whole time it burns.',
  },
  {
    id: 'arc',
    name: 'Arc Emitter',
    abbr: 'ARC',
    klass: 'Energy',
    kind: 'energy',
    mode: 'chain',
    damage: 18,
    cooldown: 0.7,
    speed: 0,
    life: 0,
    pellets: 1,
    spread: 0,
    size: { w: 0, h: 0 },
    color: '#b58cff',
    pierce: 0,
    homing: 0,
    weight: 4,
    heat: 7.5,
    ammo: null,
    chain: 2,
    chainRange: 260,
    seekRange: 760,
    blurb: 'Lightning that leaps between targets. Point it at a crowd and it does the rest.',
  },
  {
    id: 'plasma',
    name: 'Plasma Projector',
    abbr: 'PLZ',
    klass: 'Energy',
    kind: 'energy',
    mode: 'projectile',
    damage: 44,
    cooldown: 1,
    speed: 600,
    life: 1.6,
    pellets: 1,
    spread: 0.02,
    size: { w: 24, h: 24 },
    color: '#b07cff',
    pierce: 0,
    homing: 0,
    weight: 9,
    heat: 4.6,
    ammo: null,
    splash: 110,
    splashDamage: 26,
    blurb: 'Slow, fat, and it detonates. Lead your targets and it clears the whole area.',
  },
  {
    id: 'missiles',
    name: 'Missile Pod',
    abbr: 'MSL',
    klass: 'Missile',
    kind: 'missile',
    mode: 'projectile',
    damage: 26,
    cooldown: 0.85,
    speed: 460,
    life: 2.4,
    pellets: 2,
    spread: 0.14,
    size: { w: 16, h: 6 },
    color: '#ff8a6b',
    pierce: 0,
    homing: 2.8,
    weight: 7,
    heat: 2.5,
    ammo: { magazine: 12, reload: 2.8, reserve: 36 },
    launchHeat: 3,
    interceptable: true,
    blurb: 'Guidance, but they light off hot and they can be shot down in flight. Fragile and lethal.',
  },
  {
    id: 'flamer',
    name: 'Flamer Warfer',
    abbr: 'FLM',
    klass: 'Thermal',
    kind: 'energy',
    mode: 'projectile',
    damage: 2,
    cooldown: 0.05,
    speed: 480,
    life: 0.5,
    pellets: 2,
    spread: 0.45,
    divergence: 0.55,
    size: { w: 12, h: 12 },
    color: '#ff7a3c',
    pierce: 0,
    homing: 0,
    weight: 4,
    heat: 8,
    ammo: null,
    blurb: 'A double-wide cone of fire that fans out as it travels. Everything in front of you, briefly.',
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

/** True if the weapon consumes ammo. */
export function usesAmmo(weapon) {
  return !!weapon.ammo;
}

/** Seconds per shot (per round, for burst weapons). 0 for continuous weapons. */
export function timePerShot(weapon) {
  switch (weapon.mode) {
    case 'burst':
      return (weapon.cooldown + weapon.burstGap * Math.max(0, weapon.burst - 1)) / weapon.burst;
    case 'charge':
      return weapon.charge + weapon.cooldown;
    case 'beam':
      return 0;
    default:
      return weapon.cooldown;
  }
}

/** Shots per second at nominal rate. 0 for beam weapons. */
export function fireRate(weapon) {
  const t = timePerShot(weapon);
  return t > 0 ? 1 / t : 0;
}

/** Damage per trigger pull (all pellets/burst rounds). */
export function burstDamage(weapon) {
  if (weapon.mode === 'burst') return weapon.damage * (weapon.burst || 1);
  if (weapon.mode === 'chain') return weapon.damage * (1 + (weapon.chain || 0));
  return weapon.damage * (weapon.pellets || 1);
}

/** Effective reach in px. */
export function weaponRange(weapon) {
  if (weapon.mode === 'beam') return weapon.beamRange;
  if (weapon.mode === 'chain') return weapon.seekRange;
  return weapon.speed * weapon.life;
}

/** Nominal damage per second. */
export function weaponDps(weapon) {
  if (weapon.mode === 'beam') return weapon.dps;
  if (weapon.mode === 'chain') {
    // Chain damage lands instantly; assume the full chain connects.
    return (weapon.damage * (1 + (weapon.chain || 0))) / weapon.cooldown;
  }
  const t = timePerShot(weapon);
  const perShot = weapon.mode === 'burst' ? weapon.damage : weapon.damage * (weapon.pellets || 1);
  return t > 0 ? perShot / t : 0;
}

/**
 * Heat per second at nominal rate, including the cost of burning ammo.
 * @param {object} weapon
 */
export function heatPerSecond(weapon) {
  const t = timePerShot(weapon);
  if (t <= 0) return weapon.heat; // beam: per second, directly
  const ammoCost = weapon.ammo ? AMMO_HEAT / t : 0;
  return weapon.heat + ammoCost;
}

/** Heat added by a single trigger pull (beam weapons add heat per second). */
export function heatPerShot(weapon) {
  const t = timePerShot(weapon);
  if (t <= 0) return weapon.heat;
  return heatPerSecond(weapon) * t;
}

/**
 * Build a loadout. Empty slots are dropped so the simulation only ever sees
 * installed weapons.
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

/** Total heat per second with every weapon firing. */
export function totalHeatRate(weapons) {
  let total = 0;
  for (const w of weapons) if (w) total += heatPerSecond(w);
  return total;
}

/** Total damage per second with every weapon at nominal rate. */
export function burstDps(weapons) {
  let total = 0;
  for (const w of weapons) if (w) total += weaponDps(w);
  return total;
}

/** Sustained damage per second once heat generation balances heat shedding. */
export function sustainedDps(frame, weapons) {
  const burst = burstDps(weapons);
  if (burst <= 0) return 0;
  const heat = totalHeatRate(weapons);
  if (heat <= frame.cooling) return burst;
  return burst * (frame.cooling / heat);
}

/** The cooldown multiplier a loadout settles at. 1 = runs cool. */
export function settleCycle(frame, weapons) {
  const heat = totalHeatRate(weapons);
  if (heat <= frame.cooling) return 1;
  return heat / frame.cooling;
}

/** True when sustained fire cannot settle below the throttle ceiling. */
export function willOverheat(frame, weapons) {
  return settleCycle(frame, weapons) > 1 + HEAT_THROTTLE;
}

/**
 * Cooldown multiplier at a given heat level. One definition, shared by the
 * simulation and the hangar.
 * @param {object} frame
 * @param {number} heat
 */
export function cycleScaleAt(frame, heat) {
  return 1 + clamp(heat / frame.capacity, 0, 1) * HEAT_THROTTLE;
}

/**
 * Armour remaining at a given heat ratio. Plating softens above ARMOR_MELT_AT
 * and is completely gone at maximum heat.
 * @param {number} armor
 * @param {number} heatRatio
 */
export function armoredValue(armor, heatRatio) {
  if (heatRatio <= ARMOR_MELT_AT) return armor;
  const melt = clamp((heatRatio - ARMOR_MELT_AT) / (1 - ARMOR_MELT_AT), 0, 1);
  return armor * (1 - melt);
}

/**
 * Hull damage per second from heat, 0 until HEAT_DAMAGE_AT is passed.
 * @param {number} heatRatio
 */
export function heatDamagePerSecond(heatRatio) {
  if (heatRatio <= HEAT_DAMAGE_AT) return 0;
  const severity = clamp((heatRatio - HEAT_DAMAGE_AT) / (1 - HEAT_DAMAGE_AT), 0, 1);
  return MAX_HEAT_DPS * severity;
}

/** Total rounds carried when deploying (magazine + reserve). */
export function totalRounds(weapon) {
  if (!weapon.ammo) return Infinity;
  return weapon.ammo.magazine + weapon.ammo.reserve;
}
