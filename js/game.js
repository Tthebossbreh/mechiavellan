// Game orchestration: fixed identities (camera, player, bullets) plus the
// state machine (title -> playing -> gameover) and the render pass.

import { Input } from './input.js';
import { World } from './world.js';
import { AudioManager } from './audio.js';
import { Player, Drone, Wrecker, Turret, Bullet, ParticleSystem } from './entities.js';
import { clamp, rand, aabb } from './utils.js';

const BEST_KEY = 'mechiavellan.best';

/** localStorage can throw (private mode, sandboxed iframes); never let it crash. */
function loadBest() {
  try {
    return Number(localStorage.getItem(BEST_KEY) || 0) || 0;
  } catch {
    return 0;
  }
}

function saveBest(value) {
  try {
    localStorage.setItem(BEST_KEY, String(value));
  } catch {
    /* ignore */
  }
}

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.input = new Input(canvas);
    this.audio = new AudioManager();

    this.dpr = 1;
    this.view = { w: 960, h: 540 };
    this.camera = { x: 0 };

    this.world = new World(this.view.w, this.view.h);
    this.particles = new ParticleSystem();
    this.bullets = [];
    this.enemies = [];
    this.player = null;

    this.state = 'title';
    this.time = 0;
    this.shake = 0;
    this.score = 0;
    this.kills = 0;
    this.distance = 0;
    this.spawnTimer = 0;
    this.best = loadBest();

    window.addEventListener('resize', () => this.resize());

    // Audio can only start after a user gesture.
    const unlock = () => this.audio.resume();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);

    this.resize();
    this.reset();

    this._frame = this._frame.bind(this);
    this.last = null;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.dpr = dpr;
    this.view.w = w;
    this.view.h = h;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.world.resize(w, h);
  }

  reset() {
    this.player = new Player(180, 0);
    this.player.y = this.world.groundY(this.player.x + this.player.w / 2) - this.player.h - 30;
    this.bullets.length = 0;
    this.enemies.length = 0;
    this.particles.clear();
    this.camera.x = this.player.x - this.view.w * 0.35;
    this.spawnTimer = 1.5;
    this.score = 0;
    this.kills = 0;
    this.distance = 0;
    this.shake = 0;
  }

  start() {
    requestAnimationFrame(this._frame);
  }

  _frame(now) {
    if (this.last === null) this.last = now;
    const dt = Math.min((now - this.last) / 1000, 1 / 30) || 0;
    this.last = now;

    this.update(dt);
    this.render();
    this.input.endFrame();

    requestAnimationFrame(this._frame);
  }

  // --- Update ---------------------------------------------------------------

  update(dt) {
    this.time += dt;

    if (this.state === 'title') {
      // Slow drift so the parallax has something to do behind the title.
      this.camera.x += 70 * dt;
      if (this.input.anyPressed('Enter', 'NumpadEnter', 'Space') || this.input.mouse.clicked) {
        this.audio.resume();
        this.state = 'playing';
        this.reset();
      }
      return;
    }

    if (this.state === 'gameover') {
      this.particles.update(dt);
      if (this.input.anyPressed('Enter', 'NumpadEnter', 'Space')) {
        this.state = 'playing';
        this.reset();
      }
      return;
    }

    this.updatePlaying(dt);
  }

  updatePlaying(dt) {
    const aim = {
      x: this.camera.x + this.input.mouse.x,
      y: this.input.mouse.y,
    };

    const ctx = {
      input: this.input,
      world: this.world,
      aim,
      player: this.player,
      particles: this.particles,
      audio: this.audio,
      spawnBullet: (b) => this.bullets.push(b),
    };

    this.player.update(dt, ctx);
    for (const enemy of this.enemies) enemy.update(dt, ctx);
    for (const bullet of this.bullets) bullet.update(dt);
    this.particles.update(dt);

    // Smooth camera follow.
    const targetX = this.player.x - this.view.w * 0.35;
    this.camera.x += (targetX - this.camera.x) * Math.min(1, dt * 5);

    // Difficulty ramps with distance travelled.
    const difficulty = clamp(this.distance / 5000, 0, 1);
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.enemies.length < 16) {
      this.spawnEnemy();
      this.spawnTimer = rand(1.3, 2.2) * (1 - difficulty * 0.5);
    }

    this.handleCollisions();

    // Cull anything that has left the action.
    const far = this.view.w * 1.5;
    this.bullets = this.bullets.filter(
      (b) => !b.dead && Math.abs(b.x - this.camera.x - this.view.w / 2) < far
    );
    this.enemies = this.enemies.filter((e) => !e.dead);

    this.distance = Math.max(this.distance, Math.max(0, this.player.x - 180));
    this.score = this.kills * 100 + Math.floor(this.distance / 12);
    this.shake = Math.max(0, this.shake - dt * 40);

    if (this.player.dead && this.state === 'playing') {
      this.state = 'gameover';
      if (this.score > this.best) {
        this.best = this.score;
        saveBest(this.best);
      }
      this.particles.spawnExplosion(this.player.cx, this.player.cy, 34, '#8fe9ff');
      this.audio.explode();
      this.shake = 18;
    }
  }

  spawnEnemy() {
    const x = this.camera.x + this.view.w + rand(80, 260);
    const roll = Math.random();

    let enemy;
    if (roll < 0.5) {
      const y = this.world.groundBase - rand(120, 280);
      enemy = new Drone(x, y);
    } else if (roll < 0.82) {
      enemy = new Wrecker(x, 0);
    } else {
      enemy = new Turret(x, 0);
    }

    if (enemy.type !== 'drone') {
      enemy.y = this.world.groundY(x + enemy.w / 2) - enemy.h;
    }

    this.enemies.push(enemy);
  }

  killEnemy(enemy, award = true) {
    this.particles.spawnExplosion(
      enemy.x + enemy.w / 2,
      enemy.y + enemy.h / 2,
      22,
      enemy.type === 'drone' ? '#ff9d6b' : '#ffd257'
    );
    this.audio.explode();
    this.shake = Math.max(this.shake, 6);
    if (award) this.kills += 1;
  }

  handleCollisions() {
    // Bullets.
    for (const bullet of this.bullets) {
      if (bullet.dead) continue;

      if (bullet.friendly) {
        for (const enemy of this.enemies) {
          if (enemy.dead) continue;
          if (aabb(bullet.box, enemy)) {
            bullet.dead = true;
            this.particles.spawnSparks(bullet.x, bullet.y, 5);
            if (enemy.hit(bullet.damage)) this.killEnemy(enemy);
            else this.audio.hit();
            break;
          }
        }
      } else if (aabb(bullet.box, this.player)) {
        bullet.dead = true;
        if (this.player.takeDamage(bullet.damage)) {
          this.audio.hurt();
          this.shake = Math.max(this.shake, 8);
          this.particles.spawnSparks(bullet.x, bullet.y, 8, '#ff8a6b');
        }
      }
    }

    // Player <-> enemy contact.
    if (!this.player.dead) {
      for (const enemy of this.enemies) {
        if (enemy.dead) continue;
        if (aabb(this.player, enemy)) {
          if (this.player.takeDamage(enemy.contactDamage)) {
            this.audio.hurt();
            this.shake = Math.max(this.shake, 10);
            this.particles.spawnExplosion(this.player.cx, this.player.cy, 10, '#ff9d6b');
          }
          if (enemy.kamikaze) {
            enemy.dead = true;
            this.killEnemy(enemy, false);
          }
        }
      }
    }

    // Despawn enemies that fall far behind the camera.
    for (const enemy of this.enemies) {
      if (enemy.x + enemy.w < this.camera.x - 260) enemy.dead = true;
    }
  }

  // --- Render ---------------------------------------------------------------

  render() {
    const ctx = this.ctx;
    const { w, h } = this.view;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const shakeX = this.shake ? rand(-this.shake, this.shake) : 0;
    const shakeY = this.shake ? rand(-this.shake, this.shake) : 0;

    ctx.save();
    ctx.translate(shakeX, shakeY);
    this.world.draw(ctx, this.camera, this.view);

    if (this.state !== 'title') {
      ctx.save();
      ctx.translate(-Math.round(this.camera.x), 0);
      this.particles.draw(ctx);
      for (const enemy of this.enemies) enemy.draw(ctx);
      if (!this.player.dead) this.player.draw(ctx);
      for (const bullet of this.bullets) bullet.draw(ctx);
      ctx.restore();
    }
    ctx.restore();

    // Vignette.
    const vg = ctx.createRadialGradient(
      w / 2, h / 2, Math.min(w, h) * 0.35,
      w / 2, h / 2, Math.max(w, h) * 0.75
    );
    vg.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vg.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);

    if (this.state === 'title') {
      this.drawTitle(ctx);
    } else if (this.state === 'playing') {
      this.drawHUD(ctx);
      this.drawCrosshair(ctx);
    } else {
      this.drawHUD(ctx);
      this.drawGameOver(ctx);
    }
  }

  drawHUD(ctx) {
    const { w } = this.view;
    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.font = '600 13px ui-monospace, SFMono-Regular, Menlo, monospace';

    // Hull bar.
    const barW = 240;
    const barH = 16;
    const x = 22;
    const y = 26;

    ctx.fillStyle = 'rgba(8, 12, 22, 0.7)';
    ctx.fillRect(x - 4, y - 4, barW + 8, barH + 8);
    ctx.fillStyle = '#2a3346';
    ctx.fillRect(x, y, barW, barH);

    const hp = clamp(this.player.health / this.player.maxHealth, 0, 1);
    const grad = ctx.createLinearGradient(x, 0, x + barW, 0);
    grad.addColorStop(0, hp < 0.35 ? '#ff5d5d' : '#3ee08a');
    grad.addColorStop(1, hp < 0.35 ? '#ff9d6b' : '#7fe6ff');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, barW * hp, barH);
    ctx.strokeStyle = 'rgba(120, 180, 220, 0.5)';
    ctx.strokeRect(x + 0.5, y + 0.5, barW, barH);

    ctx.fillStyle = '#9fb3d1';
    ctx.fillText('HULL', x, y + barH + 15);

    // Score.
    ctx.textAlign = 'right';
    ctx.fillStyle = '#dfeaff';
    ctx.font = '700 22px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText(String(this.score).padStart(6, '0'), w - 22, 32);
    ctx.font = '600 13px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = '#8fa6c9';
    ctx.fillText(
      `${Math.floor(this.distance / 10)} m   ·   ${this.kills} kills`,
      w - 22,
      56
    );

    ctx.restore();
  }

  drawCrosshair(ctx) {
    const { x, y } = this.input.mouse;
    ctx.save();
    ctx.strokeStyle = 'rgba(127, 230, 255, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, 12, 0, Math.PI * 2);
    ctx.moveTo(x - 18, y);
    ctx.lineTo(x - 6, y);
    ctx.moveTo(x + 6, y);
    ctx.lineTo(x + 18, y);
    ctx.moveTo(x, y - 18);
    ctx.lineTo(x, y - 6);
    ctx.moveTo(x, y + 6);
    ctx.lineTo(x, y + 18);
    ctx.stroke();
    ctx.fillStyle = 'rgba(127, 230, 255, 0.9)';
    ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
    ctx.restore();
  }

  drawTitle(ctx) {
    const { w, h } = this.view;
    ctx.save();
    ctx.fillStyle = 'rgba(4, 7, 14, 0.55)';
    ctx.fillRect(0, 0, w, h);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const cy = h / 2;

    ctx.fillStyle = '#7fe6ff';
    ctx.shadowColor = '#4fd6ff';
    ctx.shadowBlur = 26;
    ctx.font = '800 64px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText('MECHIAVELLAN', w / 2, cy - 70);
    ctx.shadowBlur = 0;

    ctx.fillStyle = '#9fb3d1';
    ctx.font = '600 15px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText('PILOT THE MACHINE.  OUT-SCHEME THE SWARM.', w / 2, cy - 18);

    const pulse = 0.6 + 0.4 * Math.sin(this.time * 3);
    ctx.globalAlpha = pulse;
    ctx.fillStyle = '#dfeaff';
    ctx.font = '700 20px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText('[ ENTER ]  OR  CLICK  TO DEPLOY', w / 2, cy + 34);
    ctx.globalAlpha = 1;

    ctx.fillStyle = '#6f83a3';
    ctx.font = '600 13px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText('MOVE  A / D      JUMP  SPACE      AIM  MOUSE      FIRE  CLICK / J', w / 2, cy + 82);

    if (this.best > 0) {
      ctx.fillStyle = '#8fa6c9';
      ctx.fillText(`BEST  ${String(this.best).padStart(6, '0')}`, w / 2, cy + 116);
    }

    ctx.restore();
  }

  drawGameOver(ctx) {
    const { w, h } = this.view;
    ctx.save();
    ctx.fillStyle = 'rgba(10, 2, 4, 0.55)';
    ctx.fillRect(0, 0, w, h);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const cy = h / 2;

    ctx.fillStyle = '#ff7a6b';
    ctx.shadowColor = '#ff3b3b';
    ctx.shadowBlur = 22;
    ctx.font = '800 52px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText('SYSTEMS CRITICAL', w / 2, cy - 70);
    ctx.shadowBlur = 0;

    ctx.fillStyle = '#dfeaff';
    ctx.font = '700 26px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText(String(this.score).padStart(6, '0'), w / 2, cy - 8);

    ctx.fillStyle = '#8fa6c9';
    ctx.font = '600 14px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText(
      `${Math.floor(this.distance / 10)} m   ·   ${this.kills} kills   ·   best ${String(this.best).padStart(6, '0')}`,
      w / 2,
      cy + 28
    );

    const pulse = 0.6 + 0.4 * Math.sin(this.time * 3);
    ctx.globalAlpha = pulse;
    ctx.fillStyle = '#dfeaff';
    ctx.font = '700 18px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText('[ ENTER ]  TO REDEPLOY', w / 2, cy + 78);
    ctx.globalAlpha = 1;

    ctx.restore();
  }
}
