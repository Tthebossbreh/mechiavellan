// The scrolling battlefield: a parallax backdrop plus a curved terrain surface.
//
// All layers are generated once with a seeded RNG and drawn in tiles that
// wrap every TILE pixels, which keeps the render loop allocation-free.

const TILE = 1400;

/** Deterministic pseudo-random generator so the world looks the same each run. */
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export class World {
  constructor(width, height) {
    this.resize(width, height);
  }

  resize(width, height) {
    this.width = width;
    this.height = height;
    this.groundBase = height * 0.8;
    this._build();
  }

  _build() {
    const rng = makeRng(0x5eed);

    this.stars = [];
    for (let i = 0; i < 240; i++) {
      this.stars.push({
        x: rng() * TILE,
        y: rng() * this.groundBase * 0.8,
        r: 0.5 + rng() * 1.6,
        a: 0.25 + rng() * 0.6,
      });
    }

    // Distant city blocks.
    this.skyline = [];
    for (let i = 0; i < 70; i++) {
      this.skyline.push({
        x: rng() * TILE,
        w: 34 + rng() * 88,
        h: 60 + rng() * 200,
      });
    }

    // Mid-distance rolling ridge (overlapping circles for a soft silhouette).
    this.ridge = [];
    for (let i = 0; i < 30; i++) {
      this.ridge.push({ x: rng() * TILE, r: 100 + rng() * 170 });
    }
  }

  /** World-space y of the terrain surface at the given world x. */
  groundY(worldX) {
    return (
      this.groundBase -
      Math.sin(worldX * 0.0016) * 44 -
      Math.sin(worldX * 0.0051 + 1.3) * 18
    );
  }

  draw(ctx, camera, view) {
    const { w, h } = view;

    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#0a1024');
    sky.addColorStop(0.55, '#141d3c');
    sky.addColorStop(1, '#2b2242');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    this._drawStars(ctx, camera, w);
    this._drawSkyline(ctx, camera, w);
    this._drawRidge(ctx, camera, w);
    this._drawGround(ctx, camera, w);
  }

  /** Draw a repeating layer; `factor` is the parallax depth (0 = static). */
  _tile(ctx, camera, viewWidth, factor, layer, drawItem) {
    const offset = camera.x * factor;
    for (const item of layer) {
      let x = ((item.x - offset) % TILE + TILE) % TILE;
      for (; x < viewWidth; x += TILE) drawItem(item, x);
    }
  }

  _drawStars(ctx, camera, w) {
    ctx.save();
    this._tile(ctx, camera, w, 0.05, this.stars, (s, x) => {
      const twinkle = 0.6 + 0.4 * Math.sin(s.x * 0.13 + camera.x * 0.02);
      ctx.globalAlpha = s.a * twinkle;
      ctx.fillStyle = '#cfe3ff';
      ctx.fillRect(x, s.y, s.r, s.r);
    });
    ctx.restore();
  }

  _drawSkyline(ctx, camera, w) {
    const base = this.groundBase - 20;
    ctx.save();
    ctx.fillStyle = '#111a30';
    ctx.globalAlpha = 0.95;
    this._tile(ctx, camera, w, 0.18, this.skyline, (b, x) => {
      ctx.fillRect(x, base - b.h, b.w, b.h);
    });
    ctx.restore();
  }

  _drawRidge(ctx, camera, w) {
    const base = this.groundBase + 6;
    ctx.save();
    ctx.fillStyle = '#161f38';
    this._tile(ctx, camera, w, 0.36, this.ridge, (c, x) => {
      ctx.beginPath();
      ctx.arc(x, base, c.r, Math.PI, 0);
      ctx.fill();
    });
    ctx.restore();
  }

  _drawGround(ctx, camera, w) {
    // Filled body.
    ctx.beginPath();
    ctx.moveTo(0, this.height + 10);
    for (let x = 0; x <= w; x += 8) {
      ctx.lineTo(x, this.groundY(camera.x + x));
    }
    ctx.lineTo(w, this.height + 10);
    ctx.closePath();

    const fill = ctx.createLinearGradient(0, this.groundBase - 80, 0, this.height);
    fill.addColorStop(0, '#1c2436');
    fill.addColorStop(1, '#070a12');
    ctx.fillStyle = fill;
    ctx.fill();

    // Glowing top edge so the play surface reads clearly.
    ctx.beginPath();
    for (let x = 0; x <= w; x += 8) {
      const y = this.groundY(camera.x + x);
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(79, 214, 255, 0.75)';
    ctx.lineWidth = 3;
    ctx.shadowColor = 'rgba(79, 214, 255, 0.9)';
    ctx.shadowBlur = 16;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
}
