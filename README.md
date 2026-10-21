# Mechiavellan

A 2D side-scrolling mech shooter where **customization comes first**: before you
deploy, you build your machine part by part in the hangar — chassis, then
hardpoints, then weapons.

> *mech* + *Machiavellian* = **Mechiavellan**

Zero dependencies. No build step. All art is drawn procedurally with the Canvas
API and all sound is synthesized with the Web Audio API, so there are no image
or audio files to manage.

## Running it

ES modules must be served over HTTP (opening `index.html` via `file://` is
blocked by browser CORS rules), so start any static server from this folder:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

Any static server works: `npx serve`, `php -S localhost:8000`, `busybox httpd`, etc.

## The hangar

The game opens in the hangar. You pick a chassis, fill its hardpoints with
weapons, and hit **DEPLOY**. You can reopen the hangar from the game-over screen
with `H` (or `Enter` to redeploy the same loadout).

1. **Chassis** — decides how many weapons you can carry, plus hull, top speed,
   jump and flat damage reduction.
2. **Hardpoints** — the slots the chassis exposes. Select a weapon, click a slot
   to install it; click a filled slot to clear it. The same weapon can be
   installed more than once.
3. **Armory** — the full weapon list.

### Frames

| Frame | Hardpoints | Hull | Speed | Jump | Armor |
| --- | --- | --- | --- | --- | --- |
| WRAITH-2 (Light) | 2 | 80 | 470 | 910 | 0 |
| BASTION-4 (Medium) | 4 | 120 | 385 | 830 | 1 |
| LEVIATHAN-6 (Large) | 6 | 180 | 300 | 745 | 2 |

Want to go fast with two guns, or lumber along with six? That is the choice.

### Weapons

Each weapon projectile has its own damage, speed, size, lifetime and behaviour.
Lifetime is effectively range: the flamer dies out almost immediately, the
railgun reaches across the screen.

| Weapon | Class | Dmg | Rate | Notes |
| --- | --- | --- | --- | --- |
| Vulcan Autocannon | Ballistic | 6 | 11.1/s | Wall of lead, low punch |
| Battle Autocannon | Ballistic | 14 | 3.6/s | Dependable mid-calibre |
| Pulse Laser | Energy | 11 | 6.3/s | Accurate, flat trajectory |
| Plasma Projector | Energy | 34 | 1.1/s | Slow, fat, punishing |
| Scatter Cannon | Ballistic | 7 ×5 | 1.3/s | Brutal up close |
| Missile Pod | Missile | 24 ×2 | 1.4/s | Guided warheads |
| Rail Cannon | Energy | 62 | 0.7/s | Pierces up to 3 enemies |
| Inferno Flamer | Thermal | 3 | 22/s | Cone of fire, contact range |

Every hardpoint runs its own cooldown, so a six-gun Leviathan really does spit
six different streams of fire. Heavier weapons also kick the mech harder.

## Controls

| Action | Input |
| --- | --- |
| Move | `A` / `D` or `←` / `→` |
| Jump | `Space` / `W` / `↑` |
| Aim | mouse |
| Fire (all ready weapons) | left mouse button / `J` |
| Deploy / redeploy | `Enter` |
| Return to hangar | `H` (on the game-over screen) |

## Enemies

- **Drone** — fast hoverer that flies straight at you and detonates on contact.
- **Wrecker** — armored walker that closes in for melee.
- **Turret** — stationary; fires aimed shots.

Spawn rate ramps up the further you travel. Score is 100 per kill plus distance.
Best score is stored in `localStorage`.

## Project layout

```
index.html          canvas + the hangar overlay markup
css/style.css       game shell, hangar UI, responsive layout
js/weapons.js       frames + the 8 weapons (all tuning data, no logic)
js/hangar.js        loadout UI: chassis -> hardpoints -> armory
js/main.js          bootstrap
js/game.js          state machine (hangar -> playing -> game over), spawning,
                    collisions, camera, HUD and the weapon rack
js/entities.js      player mech (loadout-driven), 3 enemies, bullets, particles
js/world.js         parallax backdrop (stars / skyline / ridge) + curved terrain
js/input.js         keyboard + mouse with per-frame edge detection
js/audio.js         Web Audio synth sound effects
js/utils.js         math helpers
```

The hangar is a DOM overlay rather than canvas UI — real buttons, focus rings
and scrolling text are worth far more here than hand-rolled canvas hit-testing.
The simulation only ever sees the resulting `{ frame, weapons }` loadout, so the
UI and the game stay decoupled.

## Where this is going

Customization is the whole point, so the obvious next steps are part-by-part
mech building (legs, reactor, armour plating, heat sinks), weapon weight and
reactor capacity limits, per-hardpoint placement in the painter, and a loadout
save/import system.
