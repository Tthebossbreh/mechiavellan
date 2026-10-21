# Mechiavellan

A small 2D side-scrolling mech shooter that runs in the browser. No build step,
no dependencies, no image or audio assets — everything is drawn with the Canvas
API and the sound effects are synthesized with the Web Audio API.

> *mech* + *Machiavellian* = **Mechiavellan**

## Running it

ES modules must be served over HTTP (opening `index.html` via `file://` will be
blocked by browser CORS rules), so start any static server from this folder:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

Any static server works: `npx serve`, `php -S localhost:8000`, `busybox httpd`, etc.

## Controls

| Action          | Input                          |
| --------------- | ------------------------------ |
| Move            | `A` / `D` or `←` / `→`        |
| Jump            | `Space` / `W` / `↑`           |
| Aim             | mouse                          |
| Fire            | left mouse button / `J`       |
| Start / restart | `Enter`, `Space`, or click     |

## Enemies

- **Drone** — fast hoverer that flies straight at you and detonates on contact.
- **Wrecker** — armored walker that closes in for melee.
- **Turret** — stationary; fires aimed shots.

Difficulty (spawn rate) increases as you travel further.

## How it works

- `js/main.js` — bootstraps the game.
- `js/game.js` — state machine (title → playing → game over), spawning, collision
  handling, camera, and the render pass.
- `js/entities.js` — the player mech, the three enemy types, bullets, and a
  particle system. All art is procedural.
- `js/world.js` — the parallax backdrop (stars, city skyline, ridge) plus the
  curved terrain surface the mech walks on.
- `js/input.js` — keyboard/mouse state with per-frame edge detection.
- `js/audio.js` — the tiny tone-based synth for sound effects.
- `js/utils.js` — math helpers.

The game renders in CSS-pixel space and scales the canvas by `devicePixelRatio`
(capped at 2) for crisp output on high-DPI displays. The loop is
`requestAnimationFrame`-driven and clamps `dt` to avoid tunneling after a
background-tab stall.
