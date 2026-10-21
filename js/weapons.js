// Mech parts data. Customization is the core pillar of the game, so this file
// is deliberately data-only: everything here is pure and unit-testable, and is
// read both by the hangar UI and the simulation.

/**
 * Chassis. The frame decides how many weapons you can carry, how fast the
 * machine moves, how much hull it has and how much damage it shrugs off.
 * @typedef {object} Frame
 * @property {string} id
 * @property {string} name
 * @property {string} codename
 * @property {number} hull      max health
 * @property {number} speed     max horizontal speed (px/s)
 * @property {number} jump      jump impulse (px/s)
 * @property {number} armor     flat damage reduction
 * @property {number} slots     how many weapons this frame can carry
 * @property {number} scale     visual + hitbox scale
 * @property {string} blurb
 */

/** @type {Frame[]} */
export const FRAMES = [
  {
    id: 'light',
    name: 'Light Frame',
    codename: 'WRAITH-2',
    hull: 80,
    speed: 470,
    jump: 910,
    armor: 0,
    slots: 2,
    scale: 0.88,
    blurb: 'Fastest chassis on the field. Paper plating, and only two hardpoints to work with.',
  },
  {
    id: 'medium',
    name: 'Medium Frame',
    codename: 'BASTION-4',
    hull: 120,
    speed: 385,
    jump: 830,
    armor: 1,
    slots: 4,
    scale: 1,
    blurb: 'The workhorse. Balanced armor, speed and four hardpoints to fill.',
  },
  {
    id: 'large',
    name: 'Large Frame',
    codename: 'LEVIATHAN-6',
    hull: 180,
    speed: 300,
    jump: 745,
    armor: 2,
    slots: 6,
    scale: 1.18,
    blurb: 'A walking fortress. Heavy, slow, and it carries a full six hardpoints.',
  },
];

/**
 * Weapons. `cooldown` is seconds between shots, `speed` is projectile speed in
 * px/s and `life` is the projectile's lifetime in seconds (which is what gives
 * each weapon its effective range).
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
 * @property {number} weight   used for recoil and as flavour
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
    blurb: 'Dependable mid-calibre rounds. Nothing fancy, nothing wasted.',
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
    blurb: 'Accurate, flat-trajectory bolts. Best when you can hold the line.',
  },
  {
    id: 'plasma',
    name: 'Plasma Projector',
    abbr: 'PLZ',
    klass: 'Energy',
    kind: 'energy',
    damage: 34,
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
    blurb: 'Slow, fat, punishing. Land it and most things notice.',
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
    life: 0.42,
    pellets: 5,
    spread: 0.22,
    size: { w: 7, h: 7 },
    color: '#ffb15c',
    pierce: 0,
    homing: 0,
    weight: 6,
    blurb: 'Five pellets, brutal up close, near-useless at range.',
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
    blurb: 'Guided warheads. Fire them and get on with your day.',
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
    blurb: 'Hypervelocity slug that punches clean through a line of enemies.',
  },
  {
    id: 'flamer',
    name: 'Inferno Flamer',
    abbr: 'FLM',
    klass: 'Thermal',
    kind: 'energy',
    damage: 3,
    cooldown: 0.045,
    speed: 430,
    life: 0.28,
    pellets: 1,
    spread: 0.3,
    size: { w: 11, h: 11 },
    color: '#ff7a3c',
    pierce: 0,
    homing: 0,
    weight: 4,
    blurb: 'A cone of fire. Terrifying at contact range, dead weight beyond it.',
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

/** Shots per second, for display. */
export function fireRate(weapon) {
  return weapon.cooldown > 0 ? 1 / weapon.cooldown : 0;
}

/** Nominal sustained damage per second if every projectile connects. */
export function burstDamage(weapon) {
  return weapon.damage * (weapon.pellets || 1);
}

/**
 * Build a loadout object. `weapons` is a list of weapon ids or nulls; empty
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

/** Slots armed vs slots available. */
export function loadoutSummary(frame, weaponIds) {
  const armed = weaponIds.slice(0, frame.slots).filter(Boolean).length;
  return { armed, slots: frame.slots };
}
