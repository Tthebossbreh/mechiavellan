// Every gameplay object: the player mech, enemies, bullets, ammo crates and
// particles.
//
// Visuals are drawn procedurally with canvas primitives, so the project ships
// with no image assets. Coordinates are world-space unless noted otherwise.
//
// The player is built from a loadout ({ frame, weapons }) and tracks, per
// hardpoint: cooldown, magazine, reserve, reload timer, burst queue and charge.
// Heat is global to the mech.

import { clamp, rand } from './utils.js';
import {
  cycleScaleAt,
  heatPerShot,
  armoredValue,
  heatDamagePerSecond,
} from './weapons.js';

const GRAVITY = 2400;
const GROUND_FRICTION = 4200;
const AIR_FRICTION = 400;

/** Weapon banks: even hardpoints aim at the cursor, odd ones aim independently. */
const BANK_MODES = ['REAR', 'MIRROR', 'SYNC'];
const BANK_REAR = 0;

// --- Small draw helpers -----------------------------------------------------

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawHealthBar(ctx, cx, topY, width, ratio) {
  const h = 4;
  const x = cx - width / 2;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.fillRect(x, topY, width, h);
  ctx.fillStyle = ratio > 0.5 ? '#7fe6ff' : ratio > 0.25 ? '#ffd257' : '#ff6b6b';
  ctx.fillRect(x, topY, width * clamp(ratio, 0, 1), h);
}

/**
 * Distance along a ray at which it enters an axis-aligned box, or null.
 * Slab method; zero components are handled explicitly to avoid 0 * Infinity.
 */
function rayBoxEntry(px, py, dx, dy, bx, by, bw, bh) {
  let tmin = 0;
  let tmax = Infinity;

  if (dx === 0) {
    if (px < bx || px > bx + bw) return null;
  } else {
    let t1 = (bx - px) / dx;
    let t2 = (bx + bw - px) / dx;
    if (t1 > t2) {
      const swap = t1;
      t1 = t2;
      t2 = swap;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
  }

  if (dy === 0) {
    if (py < by || py > by + bh) return null;
  } else {
    let t1 = (by - py) / dy;
    let t2 = (by + bh - py) / dy;
    if (t1 > t2) {
      const swap = t1;
      t1 = t2;
      t2 = swap;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
  }

  if (tmax < tmin) return null;
  return tmin;
}

// --- Bullets ----------------------------------------------------------------

export class Bullet {
  /** @param {object} opts */
  constructor(opts = {}) {
    this.x = opts.x ?? 0;
    this.y = opts.y ?? 0;
    this.vx = opts.vx ?? 0;
    this.vy = opts.vy ?? 0;
    this.friendly = !!opts.friendly;
    this.damage = opts.damage ?? 10;
    this.color = opts.color ?? '#8fe9ff';
    this.w = opts.w ?? 10;
    this.h = opts.h ?? 6;
    this.life = opts.life ?? 1.6;
    this.maxLife = this.life;
    this.pierce = opts.pierce ?? 0;
    this.homing = opts.homing ?? 0;
    this.kind = opts.kind ?? 'ballistic';
    this.divergence = opts.divergence ?? 0; // radians/second of extra spread
    this.gravity = opts.gravity ?? 0;
    this.splash = opts.splash ?? 0;
    this.splashDamage = opts.splashDamage ?? 0;
    this.fragments = opts.fragments ?? 0;
    this.fragmentSpread = opts.fragmentSpread ?? 0;
    this.fragmentSpeed = opts.fragmentSpeed ?? 0;
    this.fragmentDamage = opts.fragmentDamage ?? 0;
    this.fragmentLife = opts.fragmentLife ?? 0;
    this.interceptable = !!opts.interceptable;
    this.angle = Math.atan2(this.vy, this.vx);
    this.dead = false;
    this.deathHandled = false;
    // Enemies already damaged by this projectile, so piercing shots do not
    // tick the same target twice.
    this.hits = new Set();
  }

  /** Bounding box for collision tests (x/y are the projectile centre). */
  get box() {
    return { x: this.x - this.w / 2, y: this.y - this.h / 2, w: this.w, h: this.h };
  }

  update(dt, ctx = {}) {
    // A widening cone (Flamer Warfer) rotates as it travels.
    if (this.divergence) {
      const speed = Math.hypot(this.vx, this.vy) || 1;
      const a = this.angle + this.divergence * dt;
      this.vx = Math.cos(a) * speed;
      this.vy = Math.sin(a) * speed;
      this.angle = a;
    }

    if (this.gravity) this.vy += this.gravity * dt;

    if (this.homing > 0 && ctx.enemies && ctx.enemies.length) {
      this._steer(dt, ctx.enemies);
    }

    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.angle = Math.atan2(this.vy, this.vx);
    this.life -= dt;
    if (this.life <= 0) this.dead = true;
  }

  _steer(dt, enemies) {
    let best = null;
    let bestDist = Infinity;
    for (const enemy of enemies) {
      if (enemy.dead) continue;
      const dx = enemy.x + enemy.w / 2 - this.x;
      const dy = enemy.y + enemy.h / 2 - this.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDist) {
        bestDist = d2;
        best = enemy;
      }
    }
    if (!best || bestDist > 720 * 720) return;

    const target = Math.atan2(best.y + best.h / 2 - this.y, best.x + best.w / 2 - this.x);
    const speed = Math.hypot(this.vx, this.vy) || 1;
    const diff = ((target - this.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    const turn = clamp(diff, -this.homing * dt, this.homing * dt);
    const angle = this.angle + turn;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.angle = angle;
  }

  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 12;
    ctx.fillStyle = this.color;

    if (this.kind === 'missile') {
      ctx.fillRect(-9, -3, 18, 6);
      ctx.beginPath();
      ctx.moveTo(9, -3);
      ctx.lineTo(15, 0);
      ctx.lineTo(9, 3);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 225, 150, 0.9)';
      ctx.fillRect(-15, -2, 6, 4);
    } else if (this.kind === 'energy') {
      roundRect(ctx, -this.w / 2, -this.h / 2, this.w, this.h, Math.min(this.h, 8) / 2);
      ctx.fill();
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = '#ffffff';
      roundRect(ctx, -this.w / 4, -this.h / 4, this.w / 2, this.h / 2, Math.min(this.h, 8) / 4);
      ctx.fill();
    } else {
      ctx.fillRect(-this.w / 2, -this.h / 2, this.w, this.h);
    }

    ctx.restore();
  }
}

// --- Player -----------------------------------------------------------------

export class Player {
  /**
   * @param {number} x
   * @param {number} y
   * @param {{frame: object, weapons: object[]}} loadout
   */
  constructor(x, y, loadout) {
    this.frame = loadout.frame;
    this.weaponDefs = loadout.weapons.slice();
    this.scale = this.frame.scale;

    this.x = x;
    this.y = y;
    this.w = 44 * this.scale;
    this.h = 58 * this.scale;

    this.vx = 0;
    this.vy = 0;
    this.onGround = false;
    this.facing = 1;

    // Two weapon banks. Bank A tracks the cursor; bank B is aimed separately.
    this.armAngle = 0;
    this.armAngleB = Math.PI;
    this.bankMode = BANK_REAR;

    // Loadout-driven stats.
    this.maxHealth = this.frame.hull;
    this.health = this.maxHealth;
    this.armor = this.frame.armor;
    this.effectiveArmor = this.frame.armor;
    this.moveSpeed = this.frame.speed;
    this.jumpVelocity = this.frame.jump;
    this.accel = this.frame.accel;
    this.mass = this.frame.mass;

    // Heat.
    this.heat = 0;
    this.heatRatio = 0;
    this.overheated = false;
    this.cycleScale = 1;
    this.heatDamage = 0;

    // Per-hardpoint state.
    const n = this.weaponDefs.length;
    this.cooldowns = new Array(n).fill(0);
    this.mag = this.weaponDefs.map((w) => (w.ammo ? w.ammo.magazine : Infinity));
    this.reserve = this.weaponDefs.map((w) => (w.ammo ? w.ammo.reserve : Infinity));
    this.reloadTimers = new Array(n).fill(0);
    this.burstLeft = new Array(n).fill(0);
    this.burstTimer = new Array(n).fill(0);
    this.charges = new Array(n).fill(0);
    this.aimAngles = new Array(n).fill(0);

    this.beams = [];
    this.walkPhase = 0;
    this.invuln = 0;
    this.recoil = 0;
    this.muzzleFlash = 0;
    this.dead = false;
    this._firedThisFrame = false;
  }

  get cx() {
    return this.x + this.w / 2;
  }

  get cy() {
    return this.y + this.h / 2;
  }

  get bankModeName() {
    return BANK_MODES[this.bankMode];
  }

  /** Which bank a hardpoint belongs to (0 = cursor, 1 = independent). */
  bankOf(index) {
    return index % 2;
  }

  update(dt, ctx) {
    const { input, world, aim, particles, audio } = ctx;

    // --- horizontal movement
    const left = input.anyDown('KeyA', 'ArrowLeft');
    const right = input.anyDown('KeyD', 'ArrowRight');
    const dir = (right ? 1 : 0) - (left ? 1 : 0);

    if (dir !== 0) {
      this.vx += dir * this.accel * dt;
    } else {
      const friction = (this.onGround ? GROUND_FRICTION : AIR_FRICTION) * dt;
      if (Math.abs(this.vx) <= friction) this.vx = 0;
      else this.vx -= Math.sign(this.vx) * friction;
    }
    this.vx = clamp(this.vx, -this.moveSpeed, this.moveSpeed);

    // --- jump
    if (this.onGround && input.anyPressed('Space', 'KeyW', 'ArrowUp')) {
      this.vy = -this.jumpVelocity;
      this.onGround = false;
      particles.spawnDust(this.cx, this.y + this.h, 8);
      audio.jump();
    }

    // --- gravity + integration
    this.vy = Math.min(this.vy + GRAVITY * dt, 2000);
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    if (this.x < 20) {
      this.x = 20;
      this.vx = 0;
    }

    // --- ground collision
    const surface = world.groundY(this.cx);
    if (this.y + this.h >= surface) {
      if (!this.onGround && this.vy > 400) particles.spawnDust(this.cx, surface, 6);
      this.y = surface - this.h;
      this.vy = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
    }

    // --- heat: shed it, then derive the throttle
    this.heat = Math.max(0, this.heat - this.frame.cooling * dt);
    if (this.overheated && this.heat <= this.frame.capacity * 0.35) {
      this.overheated = false;
    }
    this.heatRatio = clamp(this.heat / this.frame.capacity, 0, 1);
    this.cycleScale = cycleScaleAt(this.frame, this.heat);

    // --- heat consequences: armour softens, then the hull itself burns
    this.effectiveArmor = armoredValue(this.armor, this.heatRatio);
    this.heatDamage = heatDamagePerSecond(this.heatRatio);
    if (this.heatDamage > 0 && !this.dead) {
      this.health -= this.heatDamage * dt;
      if (Math.random() < 0.4) {
        particles.spawnSparks(this.cx + rand(-10, 10), this.y + rand(0, this.h), 1, '#ff7a3c');
      }
      if (this.health <= 0) {
        this.health = 0;
        this.dead = true;
      }
    }

    // --- aiming: bank A follows the cursor, bank B is independent
    const shoulderY = this.y + this.h * 0.4;
    this.armAngle = Math.atan2(aim.y - shoulderY, aim.x - this.cx);
    if (Math.abs(aim.x - this.cx) > 6) this.facing = aim.x < this.cx ? -1 : 1;
    this.armAngleB = this._bankBAngle(ctx.enemies, shoulderY);

    for (let i = 0; i < this.weaponDefs.length; i++) {
      this.aimAngles[i] = this.bankOf(i) === 0 ? this.armAngle : this.armAngleB;
    }

    if (input.anyPressed('KeyV')) {
      this.bankMode = (this.bankMode + 1) % BANK_MODES.length;
    }
    if (input.anyPressed('KeyR')) this.reloadAll();

    // --- walk animation
    if (this.onGround && Math.abs(this.vx) > 20) {
      this.walkPhase += dt * (6 + Math.abs(this.vx) * 0.03);
    }

    // --- weapons
    this._firedThisFrame = false;
    this._updateHardpoints(dt, ctx);
    this._updateBeams(dt, ctx);
    if (this._firedThisFrame) {
      this.recoil = 1;
      this.muzzleFlash = 0.06;
      audio.shoot();
    }

    this.beams = this.beams.filter((b) => {
      b.life -= dt;
      return b.life > 0;
    });

    this.recoil = Math.max(0, this.recoil - dt * 6);
    this.muzzleFlash = Math.max(0, this.muzzleFlash - dt);
    this.invuln = Math.max(0, this.invuln - dt);
  }

  /** Direction for the independent bank. */
  _bankBAngle(enemies, shoulderY) {
    if (this.bankMode === 2) return this.armAngle; // SYNC
    if (this.bankMode === 1) return this.armAngle + Math.PI; // MIRROR

    // REAR: track the nearest enemy that is behind the mech, else mirror.
    const forwardX = Math.cos(this.armAngle);
    const forwardY = Math.sin(this.armAngle);
    let best = null;
    let bestDist = Infinity;
    for (const enemy of enemies || []) {
      if (enemy.dead) continue;
      const ex = enemy.x + enemy.w / 2 - this.cx;
      const ey = enemy.y + enemy.h / 2 - shoulderY;
      const dist = Math.hypot(ex, ey) || 1;
      if ((ex / dist) * forwardX + (ey / dist) * forwardY > -0.15) continue;
      if (dist < bestDist) {
        bestDist = dist;
        best = enemy;
      }
    }

    if (!best) return this.armAngle + Math.PI;
    return Math.atan2(best.y + best.h / 2 - shoulderY, best.x + best.w / 2 - this.cx);
  }

  /** True when this hardpoint's trigger is held. */
  _wantsFire(index, input) {
    if (input.isDown(`Digit${index + 1}`)) return true;
    return this.bankOf(index) === 0
      ? input.mouse.down || input.isDown('KeyJ')
      : input.mouse.rightDown || input.isDown('KeyK');
  }

  _updateHardpoints(dt, ctx) {
    const { input } = ctx;

    for (let i = 0; i < this.weaponDefs.length; i++) {
      const weapon = this.weaponDefs[i];
      this.cooldowns[i] = Math.max(0, this.cooldowns[i] - dt);

      if (this.reloadTimers[i] > 0) {
        this.reloadTimers[i] = Math.max(0, this.reloadTimers[i] - dt);
        if (this.reloadTimers[i] === 0) this._finishReload(i);
        continue;
      }

      // Out of rounds: reload if there is anything left in reserve.
      if (this.mag[i] <= 0) {
        if (this.reserve[i] > 0) this._startReload(i);
        continue;
      }

      // A burst already in flight finishes regardless of the trigger.
      if (this.burstLeft[i] > 0) {
        this.burstTimer[i] -= dt;
        if (this.burstTimer[i] <= 0) {
          this.burstTimer[i] = weapon.burstGap;
          this.burstLeft[i] -= 1;
          this._fireOnce(i, ctx);
        }
        continue;
      }

      const wants = this._wantsFire(i, input);
      if (weapon.mode === 'beam') continue; // handled continuously
      if (this.overheated || !wants) {
        if (weapon.mode === 'charge') this.charges[i] = 0;
        continue;
      }

      if (weapon.mode === 'charge') {
        this.charges[i] += dt;
        if (this.charges[i] >= weapon.charge) {
          this.charges[i] = 0;
          this.cooldowns[i] = weapon.cooldown * this.cycleScale;
          this._fireOnce(i, ctx);
        }
        continue;
      }

      if (this.cooldowns[i] > 0) continue;

      if (weapon.mode === 'burst') {
        // Kick off a burst; the rounds themselves fire from the branch above.
        this.burstLeft[i] = weapon.burst;
        this.burstTimer[i] = 0;
        this.cooldowns[i] = weapon.cooldown * this.cycleScale;
        continue;
      }

      this.cooldowns[i] = weapon.cooldown * this.cycleScale;
      this._fireOnce(i, ctx);
    }
  }

  /** One trigger pull: spend a round, add heat, deliver the shot. */
  _fireOnce(index, ctx) {
    const weapon = this.weaponDefs[index];
    if (weapon.ammo) this.mag[index] -= 1;

    this.heat += heatPerShot(weapon) + (weapon.launchHeat || 0);
    this._firedThisFrame = true;

    const angle = this.aimAngles[index];
    if (weapon.mode === 'chain') this._fireChain(index, weapon, angle, ctx);
    else this._spawnProjectiles(index, weapon, angle, ctx);

    if (this.heat >= this.frame.capacity) this._overheat(ctx);
  }

  _spawnProjectiles(index, weapon, angle, ctx) {
    const { spawnBullet, particles } = ctx;
    const count = this.weaponDefs.length;
    const perp = angle + Math.PI / 2;
    const offset = (index - (count - 1) / 2) * 11;
    const ox = this.cx + Math.cos(angle) * 26 + Math.cos(perp) * offset;
    const oy = this.y + this.h * 0.4 + Math.sin(angle) * 26 + Math.sin(perp) * offset;

    const pellets = weapon.pellets || 1;
    for (let p = 0; p < pellets; p++) {
      const spread = (Math.random() * 2 - 1) * (weapon.spread || 0);
      const a = angle + spread;
      spawnBullet(
        new Bullet({
          x: ox,
          y: oy,
          vx: Math.cos(a) * weapon.speed,
          vy: Math.sin(a) * weapon.speed,
          friendly: true,
          damage: weapon.damage,
          color: weapon.color,
          w: weapon.size.w,
          h: weapon.size.h,
          life: weapon.life,
          pierce: weapon.pierce || 0,
          homing: weapon.homing || 0,
          kind: weapon.kind,
          divergence: weapon.divergence ? (Math.random() * 2 - 1) * weapon.divergence : 0,
          splash: weapon.splash || 0,
          splashDamage: weapon.splashDamage || 0,
          fragments: weapon.fragments || 0,
          fragmentSpread: weapon.fragmentSpread || 0,
          fragmentSpeed: weapon.fragmentSpeed || 0,
          fragmentDamage: weapon.fragmentDamage || 0,
          fragmentLife: weapon.fragmentLife || 0,
          interceptable: !!weapon.interceptable,
        })
      );
    }

    this.vx -= (Math.cos(angle) * (weapon.weight || 3) * 2.2) / this.mass;
    particles.spawnMuzzle(ox, oy, angle);
  }

  /** Instant hit that leaps between nearby enemies. */
  _fireChain(index, weapon, angle, ctx) {
    const enemies = ctx.enemies || [];
    const oy = this.y + this.h * 0.4;
    const points = [{ x: this.cx, y: oy }];
    const used = new Set();

    let cx = this.cx;
    let cy = oy;
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);

    for (let step = 0; step <= (weapon.chain || 0); step++) {
      const range = step === 0 ? weapon.seekRange : weapon.chainRange;
      let best = null;
      let bestDist = Infinity;

      for (const enemy of enemies) {
        if (enemy.dead || used.has(enemy)) continue;
        const ex = enemy.x + enemy.w / 2;
        const ey = enemy.y + enemy.h / 2;
        const dx = ex - cx;
        const dy = ey - cy;
        const dist = Math.hypot(dx, dy) || 1;
        if (dist > range) continue;
        if (step === 0 && (dx / dist) * dirX + (dy / dist) * dirY < 0.35) continue;
        if (dist < bestDist) {
          bestDist = dist;
          best = enemy;
        }
      }

      if (!best) break;
      used.add(best);
      const bx = best.x + best.w / 2;
      const by = best.y + best.h / 2;
      points.push({ x: bx, y: by });
      if (best.hit(weapon.damage)) ctx.killEnemy(best);
      cx = bx;
      cy = by;
    }

    if (points.length > 1) {
      this.beams.push({
        kind: 'chain',
        points,
        color: weapon.color,
        width: 3,
        life: 0.18,
        maxLife: 0.18,
      });
      ctx.particles.spawnSparks(cx, cy, 6, weapon.color);
    }
  }

  /** Continuous hitscan weapons (beam laser). */
  _updateBeams(dt, ctx) {
    for (let i = 0; i < this.weaponDefs.length; i++) {
      const weapon = this.weaponDefs[i];
      if (weapon.mode !== 'beam') continue;
      if (this.overheated || this.reloadTimers[i] > 0) continue;
      if (!this._wantsFire(i, ctx.input)) continue;

      this._firedThisFrame = true;
      this.heat += weapon.heat * dt; // per second, not per shot

      const angle = this.aimAngles[i];
      const ox = this.cx + Math.cos(angle) * 26;
      const oy = this.y + this.h * 0.4 + Math.sin(angle) * 26;
      const hit = this._castRay(ox, oy, angle, weapon.beamRange, ctx.enemies);

      if (hit) {
        if (hit.enemy.hit(weapon.dps * dt)) ctx.killEnemy(hit.enemy);
      }

      this.beams.push({
        kind: 'beam',
        points: [
          { x: ox, y: oy },
          {
            x: hit ? hit.x : ox + Math.cos(angle) * weapon.beamRange,
            y: hit ? hit.y : oy + Math.sin(angle) * weapon.beamRange,
          },
        ],
        color: weapon.color,
        width: 2.5 + Math.random() * 2,
        life: 0.05,
        maxLife: 0.05,
      });

      if (this.heat >= this.frame.capacity) this._overheat(ctx);
    }
  }

  _castRay(x, y, angle, range, enemies) {
    if (!enemies || !enemies.length) return null;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    let bestT = range;
    let bestEnemy = null;

    for (const enemy of enemies) {
      if (enemy.dead) continue;
      const t = rayBoxEntry(x, y, dx, dy, enemy.x, enemy.y, enemy.w, enemy.h);
      if (t === null || t < 0 || t >= bestT) continue;
      bestT = t;
      bestEnemy = enemy;
    }

    if (!bestEnemy) return null;
    return { enemy: bestEnemy, x: x + dx * bestT, y: y + dy * bestT };
  }

  _overheat(ctx) {
    this.heat = this.frame.capacity;
    if (this.overheated) return;
    this.overheated = true;
    ctx.particles.spawnDust(this.cx, this.y + this.h * 0.45, 18);
    ctx.audio.hurt();
  }

  // --- Ammo -----------------------------------------------------------------

  _startReload(index) {
    const weapon = this.weaponDefs[index];
    if (!weapon.ammo) return;
    this.reloadTimers[index] = weapon.ammo.reload;
    this.charges[index] = 0;
  }

  _finishReload(index) {
    const weapon = this.weaponDefs[index];
    if (!weapon.ammo) return;
    const need = weapon.ammo.magazine - this.mag[index];
    const take = Math.min(need, this.reserve[index]);
    this.mag[index] += take;
    this.reserve[index] -= take;
  }

  /** Reload every weapon that has room and spare rounds. Bound to R. */
  reloadAll() {
    for (let i = 0; i < this.weaponDefs.length; i++) {
      const weapon = this.weaponDefs[i];
      if (!weapon.ammo || this.reloadTimers[i] > 0) continue;
      if (this.mag[i] >= weapon.ammo.magazine || this.reserve[i] <= 0) continue;
      this._startReload(i);
    }
  }

  /** Called when an ammo crate is collected. Returns true if anything changed. */
  resupply() {
    let gained = false;
    for (let i = 0; i < this.weaponDefs.length; i++) {
      const weapon = this.weaponDefs[i];
      if (!weapon.ammo) continue;
      const cap = weapon.ammo.magazine * 4;
      if (this.reserve[i] >= cap) continue;
      this.reserve[i] = Math.min(cap, this.reserve[i] + weapon.ammo.magazine);
      gained = true;
    }
    return gained;
  }

  takeDamage(amount) {
    if (this.invuln > 0 || this.dead) return false;
    const dealt = Math.max(1, amount - this.effectiveArmor);
    this.health -= dealt;
    this.invuln = 0.85;
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
    }
    return true;
  }

  // --- Draw -----------------------------------------------------------------

  /** Beam and chain visuals, drawn in world space behind the mech. */
  drawBeams(ctx) {
    for (const beam of this.beams) {
      const alpha = clamp(beam.life / beam.maxLife, 0, 1);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = beam.color;
      ctx.shadowColor = beam.color;
      ctx.shadowBlur = 16;
      ctx.lineWidth = beam.width || 3;

      if (beam.kind === 'chain') {
        for (let i = 0; i + 1 < beam.points.length; i++) {
          const a = beam.points[i];
          const b = beam.points[i + 1];
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          for (let s = 1; s < 6; s++) {
            const t = s / 6;
            ctx.lineTo(
              a.x + (b.x - a.x) * t + rand(-9, 9),
              a.y + (b.y - a.y) * t + rand(-9, 9)
            );
          }
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      } else {
        const a = beam.points[0];
        const b = beam.points[1];
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        // Hot core.
        ctx.globalAlpha = alpha * 0.9;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.max(1, (beam.width || 3) * 0.4);
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  draw(ctx) {
    const f = this.facing;
    const blink = this.invuln > 0 && Math.floor(this.invuln * 20) % 2 === 0;

    ctx.save();
    ctx.translate(this.cx, this.y + this.h); // origin at the feet
    ctx.scale(f * this.scale, this.scale);
    if (blink) ctx.globalAlpha = 0.45;

    const walk = this.onGround ? Math.sin(this.walkPhase) * 7 : 0;
    const bob = this.onGround ? Math.abs(Math.cos(this.walkPhase)) * 2 : 0;

    this._leg(ctx, -12 + walk * 0.5);
    this._leg(ctx, 12 - walk * 0.5);

    ctx.save();
    ctx.translate(0, -bob);

    // Hip
    ctx.fillStyle = '#39404f';
    roundRect(ctx, -18, -22, 36, 14, 4);
    ctx.fill();

    // Torso — turns red-hot as the mech cooks.
    const body = ctx.createLinearGradient(0, -48, 0, -18);
    if (this.heatRatio > 0.6) {
      body.addColorStop(0, '#b08a7a');
      body.addColorStop(1, '#7a4038');
    } else {
      body.addColorStop(0, '#8892a6');
      body.addColorStop(1, '#4a5262');
    }
    ctx.fillStyle = body;
    roundRect(ctx, -20, -48, 40, 30, 7);
    ctx.fill();
    ctx.strokeStyle = '#20252f';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Cockpit
    ctx.fillStyle = '#0d1b2a';
    roundRect(ctx, -11, -44, 22, 16, 4);
    ctx.fill();
    const glass = ctx.createLinearGradient(-11, -44, 11, -28);
    glass.addColorStop(0, this.overheated ? '#ff9d6b' : '#7fe6ff');
    glass.addColorStop(1, '#1f6d8f');
    ctx.fillStyle = glass;
    roundRect(ctx, -9, -42, 18, 12, 3);
    ctx.fill();

    // Core light
    ctx.fillStyle = this.overheated ? '#ff5d5d' : '#4fd6ff';
    ctx.shadowColor = this.overheated ? '#ff5d5d' : '#4fd6ff';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(0, -34, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // One barrel per hardpoint, each rotated to its own bank's aim.
    const count = this.weaponDefs.length;
    const bankCounts = [0, 0];
    for (let i = 0; i < count; i++) bankCounts[this.bankOf(i)] += 1;

    const bankSeen = [0, 0];
    const kick = -this.recoil * 5;

    for (let i = 0; i < count; i++) {
      const bank = this.bankOf(i);
      const local = bankSeen[bank]++;
      const total = bankCounts[bank];
      const off = (local - (total - 1) / 2) * 6.5;

      const world = this.aimAngles[i] || 0;
      const localAngle = f === 1 ? world : Math.PI - world;

      ctx.save();
      ctx.translate(0, -34);
      ctx.rotate(localAngle);
      ctx.fillStyle = bank === 0 ? '#5b6475' : '#55617b';
      roundRect(ctx, -6 + kick, off - 3, 32, 6, 2);
      ctx.fill();
      ctx.fillStyle = '#3a4150';
      roundRect(ctx, 22 + kick, off - 2.5, 9, 5, 2);
      ctx.fill();

      if (i === 0 && this.muzzleFlash > 0) {
        ctx.fillStyle = 'rgba(255, 240, 170, 0.95)';
        ctx.shadowColor = '#ffd257';
        ctx.shadowBlur = 16;
        ctx.beginPath();
        ctx.arc(38 + kick, off, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
      ctx.restore();
    }

    ctx.restore(); // bob
    ctx.restore(); // facing/feet
  }

  _leg(ctx, dx) {
    ctx.fillStyle = '#2f3643';
    roundRect(ctx, dx - 6, -20, 12, 22, 3);
    ctx.fill();
    ctx.fillStyle = '#454d5d';
    roundRect(ctx, dx - 7, -3, 14, 9, 3);
    ctx.fill();
  }
}

// --- Ammo crates ------------------------------------------------------------

/** Dropped by destroyed enemies; tops up the reserve of every ammo weapon. */
export class AmmoBox {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.w = 26;
    this.h = 22;
    this.vx = rand(-40, 40);
    this.vy = rand(-380, -220);
    this.onGround = false;
    this.life = 26;
    this.maxLife = 26;
    this.dead = false;
    this.bob = rand(0, Math.PI * 2);
  }

  update(dt, ctx) {
    const { world } = ctx;
    this.vy += 1800 * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.bob += dt * 4;

    const surface = world.groundY(this.x + this.w / 2);
    if (this.y + this.h >= surface) {
      this.y = surface - this.h;
      this.vy = 0;
      this.vx *= 0.7;
      this.onGround = true;
    }

    this.life -= dt;
    if (this.life <= 0) this.dead = true;
  }

  draw(ctx) {
    const cx = this.x + this.w / 2;
    const cy = this.y + this.h / 2;
    const expiring = this.life < 5 && Math.floor(this.life * 6) % 2 === 0;
    const lift = this.onGround ? Math.sin(this.bob) * 3 : 0;

    ctx.save();
    ctx.globalAlpha = expiring ? 0.4 : 1;
    ctx.translate(cx, cy + lift);

    ctx.shadowColor = '#7fe6ff';
    ctx.shadowBlur = 14;
    ctx.fillStyle = '#2b3a4d';
    roundRect(ctx, -13, -11, 26, 22, 4);
    ctx.fill();
    ctx.strokeStyle = '#7fe6ff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.fillStyle = '#7fe6ff';
    ctx.fillRect(-7, -6, 14, 4);
    ctx.fillRect(-7, 1, 14, 4);

    ctx.restore();
  }
}

// --- Enemies ----------------------------------------------------------------

/** Fast hoverer that flies straight at the player and detonates on contact. */
export class Drone {
  constructor(x, y) {
    this.type = 'drone';
    this.x = x;
    this.y = y;
    this.w = 40;
    this.h = 30;
    this.maxHealth = 14;
    this.health = 14;
    this.contactDamage = 12;
    this.kamikaze = true;
    this.speed = rand(90, 155);
    this.spin = 0;
    this.hitFlash = 0;
    this.dead = false;
  }

  update(dt, ctx) {
    const { player, particles } = ctx;
    const cx = this.x + this.w / 2;
    const cy = this.y + this.h / 2;
    const dx = player.cx - cx;
    const dy = player.y + player.h * 0.4 - cy;
    const d = Math.hypot(dx, dy) || 1;

    this.x += (dx / d) * this.speed * dt;
    this.y += (dy / d) * this.speed * 0.5 * dt;
    this.spin += dt * 6;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 4);

    if (Math.random() < 0.4) particles.spawnThruster(cx, cy + this.h / 2);
  }

  hit(damage) {
    this.health -= damage;
    this.hitFlash = 1;
    if (this.health <= 0) this.dead = true;
    return this.dead;
  }

  draw(ctx) {
    const cx = this.x + this.w / 2;
    const cy = this.y + this.h / 2;

    ctx.save();
    ctx.translate(cx, cy);

    ctx.shadowColor = '#ff6b6b';
    ctx.shadowBlur = 14;
    ctx.fillStyle = this.hitFlash > 0 ? '#ffffff' : '#b23a48';
    roundRect(ctx, -16, -6, 32, 20, 6);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.fillStyle = '#ffd0d0';
    ctx.beginPath();
    ctx.arc(0, 2, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2b0d12';
    ctx.beginPath();
    ctx.arc(0, 2, 1.8, 0, Math.PI * 2);
    ctx.fill();

    ctx.rotate(this.spin);
    ctx.strokeStyle = 'rgba(200, 220, 255, 0.7)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-24, -10);
    ctx.lineTo(24, -10);
    ctx.stroke();

    ctx.restore();

    if (this.health < this.maxHealth) {
      drawHealthBar(ctx, cx, this.y - 10, 34, this.health / this.maxHealth);
    }
  }
}

/** Armored ground walker that closes in for melee. */
export class Wrecker {
  constructor(x, y) {
    this.type = 'wrecker';
    this.x = x;
    this.y = y;
    this.w = 52;
    this.h = 64;
    this.maxHealth = 42;
    this.health = 42;
    this.contactDamage = 20;
    this.kamikaze = false;
    this.speed = rand(70, 115);
    this.walkPhase = 0;
    this.hitFlash = 0;
    this.dead = false;
  }

  update(dt, ctx) {
    const { player, world } = ctx;
    const cx = this.x + this.w / 2;
    const dx = player.cx - cx;
    const dir = Math.sign(dx) || 1;

    if (Math.abs(dx) > 44) this.x += dir * this.speed * dt;
    this.walkPhase += dt * 8;

    this.y = world.groundY(cx) - this.h;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 4);
  }

  hit(damage) {
    this.health -= damage;
    this.hitFlash = 1;
    if (this.health <= 0) this.dead = true;
    return this.dead;
  }

  draw(ctx) {
    const cx = this.x + this.w / 2;
    const feet = this.y + this.h;
    const flash = this.hitFlash > 0;

    ctx.save();
    ctx.translate(cx, feet);

    const walk = Math.sin(this.walkPhase) * 6;

    ctx.fillStyle = '#2b3140';
    roundRect(ctx, -20 + walk * 0.4, -24, 16, 26, 4);
    ctx.fill();
    roundRect(ctx, 4 - walk * 0.4, -24, 16, 26, 4);
    ctx.fill();

    const body = ctx.createLinearGradient(0, -60, 0, -18);
    body.addColorStop(0, flash ? '#ffffff' : '#9c4b4b');
    body.addColorStop(1, '#4d2027');
    ctx.fillStyle = body;
    roundRect(ctx, -26, -60, 52, 42, 8);
    ctx.fill();
    ctx.strokeStyle = '#1d1013';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = flash ? '#ffffff' : '#ffb15c';
    ctx.shadowColor = '#ff7a3c';
    ctx.shadowBlur = 12;
    roundRect(ctx, -12, -54, 24, 8, 3);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.restore();

    if (this.health < this.maxHealth) {
      drawHealthBar(ctx, cx, this.y - 12, 46, this.health / this.maxHealth);
    }
  }
}

/** Stationary turret that fires aimed shots at the player. */
export class Turret {
  constructor(x, y) {
    this.type = 'turret';
    this.x = x;
    this.y = y;
    this.w = 46;
    this.h = 44;
    this.maxHealth = 32;
    this.health = 32;
    this.contactDamage = 8;
    this.kamikaze = false;
    this.cooldown = rand(0.8, 1.6);
    this.aimAngle = Math.PI;
    this.hitFlash = 0;
    this.dead = false;
  }

  update(dt, ctx) {
    const { player, spawnBullet, particles, audio } = ctx;
    const cx = this.x + this.w / 2;
    const muzzleY = this.y + this.h * 0.28;

    this.aimAngle = Math.atan2(player.y + player.h * 0.5 - muzzleY, player.cx - cx);

    this.cooldown -= dt;
    if (this.cooldown <= 0) {
      this.cooldown = rand(1.3, 2.2);
      const speed = 520;
      const mx = cx + Math.cos(this.aimAngle) * 26;
      const my = muzzleY + Math.sin(this.aimAngle) * 26;
      spawnBullet(
        new Bullet({
          x: mx,
          y: my,
          vx: Math.cos(this.aimAngle) * speed,
          vy: Math.sin(this.aimAngle) * speed,
          friendly: false,
          damage: 10,
          color: '#ff7a6b',
          w: 10,
          h: 6,
          life: 2.0,
        })
      );
      particles.spawnMuzzle(mx, my, this.aimAngle);
      audio.tone({ freq: 300, type: 'sawtooth', duration: 0.08, gain: 0.025, sweep: -140 });
    }

    this.hitFlash = Math.max(0, this.hitFlash - dt * 4);
  }

  hit(damage) {
    this.health -= damage;
    this.hitFlash = 1;
    if (this.health <= 0) this.dead = true;
    return this.dead;
  }

  draw(ctx) {
    const cx = this.x + this.w / 2;
    const base = this.y + this.h;
    const flash = this.hitFlash > 0;

    ctx.save();
    ctx.translate(cx, base);

    ctx.fillStyle = '#333b4c';
    roundRect(ctx, -23, -22, 46, 22, 5);
    ctx.fill();
    ctx.fillStyle = '#222834';
    roundRect(ctx, -15, -16, 30, 16, 3);
    ctx.fill();

    ctx.save();
    ctx.translate(0, -22);
    ctx.rotate(this.aimAngle);
    ctx.fillStyle = flash ? '#ffffff' : '#5b6475';
    roundRect(ctx, -8, -9, 20, 18, 5);
    ctx.fill();
    ctx.fillStyle = '#3a4150';
    roundRect(ctx, 8, -4, 22, 8, 3);
    ctx.fill();
    ctx.fillStyle = '#4fd6ff';
    ctx.shadowColor = '#4fd6ff';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(0, 0, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();

    ctx.restore();

    if (this.health < this.maxHealth) {
      drawHealthBar(ctx, cx, this.y - 10, 40, this.health / this.maxHealth);
    }
  }
}

// --- Particles --------------------------------------------------------------

/** Lightweight particle pool for explosions, muzzle flashes and dust. */
export class ParticleSystem {
  constructor() {
    this.items = [];
    this.max = 600;
  }

  clear() {
    this.items.length = 0;
  }

  add(p) {
    if (this.items.length < this.max) this.items.push(p);
  }

  spawnExplosion(x, y, count = 20, color = '#ffb15c') {
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2);
      const s = rand(60, 360);
      this.add({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: rand(0.3, 0.7),
        maxLife: 0.7,
        size: rand(1.5, 4.5),
        color,
        gravity: 500,
        drag: 2.2,
      });
    }
  }

  spawnMuzzle(x, y, angle) {
    for (let i = 0; i < 8; i++) {
      const a = angle + rand(-0.35, 0.35);
      const s = rand(120, 420);
      this.add({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: rand(0.08, 0.18),
        maxLife: 0.18,
        size: rand(2, 4),
        color: '#ffe08a',
        gravity: 0,
        drag: 6,
      });
    }
  }

  spawnSparks(x, y, count, color = '#ffd06b') {
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2);
      const s = rand(40, 220);
      this.add({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: rand(0.12, 0.3),
        maxLife: 0.3,
        size: rand(1.5, 3),
        color,
        gravity: 400,
        drag: 3,
      });
    }
  }

  spawnDust(x, y, count) {
    for (let i = 0; i < count; i++) {
      const a = rand(Math.PI, Math.PI * 2);
      const s = rand(40, 180);
      this.add({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s * 0.5 - rand(20, 80),
        life: rand(0.25, 0.5),
        maxLife: 0.5,
        size: rand(2, 5),
        color: '#9fb0c8',
        gravity: 300,
        drag: 3,
      });
    }
  }

  spawnThruster(x, y) {
    this.add({
      x: x + rand(-4, 4),
      y,
      vx: rand(-20, 20),
      vy: rand(40, 120),
      life: rand(0.15, 0.35),
      maxLife: 0.35,
      size: rand(1.5, 3.5),
      color: '#7fe0ff',
      gravity: 0,
      drag: 1,
    });
  }

  update(dt) {
    for (const p of this.items) {
      p.life -= dt;
      p.vy += (p.gravity || 0) * dt;
      if (p.drag) {
        p.vx -= p.vx * p.drag * dt;
        p.vy -= p.vy * p.drag * dt;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.items = this.items.filter((p) => p.life > 0);
  }

  draw(ctx) {
    for (const p of this.items) {
      ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }
}
