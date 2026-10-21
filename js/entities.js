// Every gameplay object: the player mech, enemies, bullets and particles.
//
// Visuals are drawn procedurally with canvas primitives, so the project ships
// with no image assets. Coordinates are world-space unless noted otherwise.
//
// The player is built from a loadout ({ frame, weapons }), so almost every
// number that matters here — hull, speed, jump, armor, how many guns you have
// and how they fire — comes from the hangar rather than from this file.

import { clamp, rand } from './utils.js';

const GRAVITY = 2400;
const MOVE_ACCEL = 5200;
const GROUND_FRICTION = 4200;
const AIR_FRICTION = 400;

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
    this.angle = Math.atan2(this.vy, this.vx);
    this.dead = false;
    // Enemies already damaged by this projectile (so piercing shots do not
    // tick the same target twice).
    this.hits = new Set();
  }

  /** Bounding box for collision tests (x/y are the projectile centre). */
  get box() {
    return { x: this.x - this.w / 2, y: this.y - this.h / 2, w: this.w, h: this.h };
  }

  update(dt, ctx = {}) {
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
    this.armAngle = 0;

    // Everything below is loadout-driven.
    this.maxHealth = this.frame.hull;
    this.health = this.maxHealth;
    this.armor = this.frame.armor;
    this.moveSpeed = this.frame.speed;
    this.jumpVelocity = this.frame.jump;

    this.cooldowns = this.weaponDefs.map(() => 0);
    this.walkPhase = 0;
    this.invuln = 0;
    this.recoil = 0;
    this.muzzleFlash = 0;
    this.dead = false;
  }

  get cx() {
    return this.x + this.w / 2;
  }

  get cy() {
    return this.y + this.h / 2;
  }

  get slotCount() {
    return this.weaponDefs.length;
  }

  update(dt, ctx) {
    const { input, world, aim, particles, audio } = ctx;

    // --- horizontal movement
    const left = input.anyDown('KeyA', 'ArrowLeft');
    const right = input.anyDown('KeyD', 'ArrowRight');
    const dir = (right ? 1 : 0) - (left ? 1 : 0);

    if (dir !== 0) {
      this.vx += dir * MOVE_ACCEL * dt;
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

    // --- aiming + facing
    const shoulderY = this.y + this.h * 0.4;
    this.armAngle = Math.atan2(aim.y - shoulderY, aim.x - this.cx);
    if (Math.abs(aim.x - this.cx) > 6) this.facing = aim.x < this.cx ? -1 : 1;

    // --- walk animation
    if (this.onGround && Math.abs(this.vx) > 20) {
      this.walkPhase += dt * (6 + Math.abs(this.vx) * 0.03);
    }

    // --- weapons: every hardpoint runs its own cooldown
    for (let i = 0; i < this.cooldowns.length; i++) {
      this.cooldowns[i] = Math.max(0, this.cooldowns[i] - dt);
    }

    const firing = input.mouse.down || input.isDown('KeyJ');
    if (firing) {
      let fired = false;
      for (let i = 0; i < this.weaponDefs.length; i++) {
        const weapon = this.weaponDefs[i];
        if (this.cooldowns[i] > 0) continue;
        this.cooldowns[i] = weapon.cooldown;
        this._fireWeapon(i, weapon, ctx);
        fired = true;
      }
      if (fired) {
        this.recoil = 1;
        this.muzzleFlash = 0.06;
        audio.shoot();
      }
    }

    this.recoil = Math.max(0, this.recoil - dt * 6);
    this.muzzleFlash = Math.max(0, this.muzzleFlash - dt);
    this.invuln = Math.max(0, this.invuln - dt);
  }

  /** Spawn one shot's worth of projectiles from a specific hardpoint. */
  _fireWeapon(index, weapon, { spawnBullet, particles }) {
    const count = this.weaponDefs.length;
    const angle = this.armAngle;
    const perp = angle + Math.PI / 2;
    const offset = (index - (count - 1) / 2) * 11;

    const ox = this.cx + Math.cos(angle) * 24 + Math.cos(perp) * offset;
    const oy = this.y + this.h * 0.4 + Math.sin(angle) * 24 + Math.sin(perp) * offset;

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
        })
      );
    }

    // Heavier weapons shove the mech around more.
    this.vx -= Math.cos(angle) * (weapon.weight || 3) * 2.2;
    particles.spawnMuzzle(ox, oy, angle);
  }

  takeDamage(amount) {
    if (this.invuln > 0 || this.dead) return false;
    const dealt = Math.max(1, amount - this.armor);
    this.health -= dealt;
    this.invuln = 0.85;
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
    }
    return true;
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

    // Torso
    const body = ctx.createLinearGradient(0, -48, 0, -18);
    body.addColorStop(0, '#8892a6');
    body.addColorStop(1, '#4a5262');
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
    glass.addColorStop(0, '#7fe6ff');
    glass.addColorStop(1, '#1f6d8f');
    ctx.fillStyle = glass;
    roundRect(ctx, -9, -42, 18, 12, 3);
    ctx.fill();

    // Core light
    ctx.fillStyle = '#4fd6ff';
    ctx.shadowColor = '#4fd6ff';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(0, -34, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Hardpoints: one barrel per installed weapon, fanned around the arm.
    const count = this.weaponDefs.length;
    const local = f === 1 ? this.armAngle : Math.PI - this.armAngle;
    const kick = -this.recoil * 5;

    ctx.save();
    ctx.translate(4, -34);
    ctx.rotate(local);
    for (let i = 0; i < count; i++) {
      const off = (i - (count - 1) / 2) * 6.5;
      ctx.fillStyle = i === 0 ? '#5b6475' : '#4b5364';
      roundRect(ctx, -6 + kick, off - 3, 32, 6, 2);
      ctx.fill();
      ctx.fillStyle = '#3a4150';
      roundRect(ctx, 22 + kick, off - 2.5, 9, 5, 2);
      ctx.fill();
    }
    if (this.muzzleFlash > 0) {
      ctx.fillStyle = 'rgba(255, 240, 170, 0.95)';
      ctx.shadowColor = '#ffd257';
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.arc(38 + kick, 0, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.restore();

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

// --- Enemies ----------------------------------------------------------------

/** Fast hoverer that flies straight at the player and detonates on contact. */
export class Drone {
  constructor(x, y) {
    this.type = 'drone';
    this.x = x;
    this.y = y;
    this.w = 40;
    this.h = 30;
    this.maxHealth = 26;
    this.health = 26;
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
    this.maxHealth = 70;
    this.health = 70;
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
    this.maxHealth = 55;
    this.health = 55;
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
