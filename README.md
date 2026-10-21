# Mechiavellan

A 2D side-scrolling mech shooter built around **customization above everything
else**. Before you deploy you build your machine in the hangar — chassis, then
hardpoints, then weapons — and the machine you build genuinely plays differently.

There is also now a way to *win*: cross 1500 m of hostile ground and reach the
extraction beacon.

> *mech* + *Machiavellian* = **Mechiavellan**

Zero dependencies. No build step. All art is drawn procedurally with the Canvas
API and all sound is synthesized with the Web Audio API.

## Running it

ES modules must be served over HTTP (opening `index.html` via `file://` is
blocked by browser CORS rules), so start any static server from this folder:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>. Any static server works.

## The hangar

The game opens in the hangar. Pick a chassis, fill its hardpoints, hit
**DEPLOY**. Reopen the hangar from the game-over or victory screen with `H`, or
press `Enter` to redeploy the same loadout.

1. **Chassis** — how many hardpoints you get, plus hull, speed, agility, armour
   and heat sink.
2. **Hardpoints** — select a weapon in the armory, click a hardpoint to install
   it, click a filled hardpoint to clear it. Duplicates are allowed. The readout
   under the slots shows the loadout's heat balance, burst and sustained damage.
3. **Armory** — the full weapon list.

### Chassis

Every chassis has the **same radiator** (14 heat/s) and the same heat-to-damage
ratio, so they end up doing nearly the same *sustained* damage. What differs is
how hard they can hit in a burst, and how well they avoid being hit.

| Frame | Hardpoints | Hull | Speed | Jump | Armor | Heat sink |
| --- | --- | --- | --- | --- | --- | --- |
| WRAITH-2 (Light) | 2 | 100 | 470 | 910 | 0 | 55 |
| BASTION-4 (Medium) | 4 | 135 | 385 | 830 | 1 | 85 |
| LEVIATHAN-6 (Large) | 6 | 165 | 290 | 700 | 2 | 115 |

### How the frames stay level

A naive design has a fatal flaw: six guns is three times the damage for slightly
less speed. Instead, **firing builds heat and heat throttles your rate of fire**:

```
heatRatio  = heat / heatSink
cycleScale = 1 + heatRatio * 1.6        // multiplies every weapon's cooldown
```

At a steady state, heat generated equals heat shed, so:

```
sustained dps ~= cooling * (sum of dps) / (sum of heat)
```

Note what is *absent*: the number of hardpoints. Because every chassis cools at
the same rate, and each weapon's heat cost is set to roughly its damage-per-second
divided by ten, **sustained damage comes out within about 10% whichever frame you
pick** (measured: 138 / 145 / 147 dps). What the frame buys you is **burst** —
138 / 275 / 412 dps — and burst is paid for with speed, size and a vent cycle.

Practical consequences:

- The **light frame never overheats**. It just keeps firing, forever.
- The **medium frame** settles at roughly double cooldown and holds there.
- The **large frame** cannot settle: it saturates its sink, stops firing while it
  vents, then does it again. Huge opening volley, then a breather.
- Filling every hardpoint is always better than leaving one empty, so there is no
  degenerate under-filled build.

### Armory

| Weapon | Class | Dmg | Rate | Heat | Range |
| --- | --- | --- | --- | --- | --- |
| Vulcan Autocannon | Ballistic | 6 | 11.1/s | 6.7 | 735 px |
| Battle Autocannon | Ballistic | 14 | 3.6/s | 5.0 | 990 px |
| Pulse Laser | Energy | 11 | 6.2/s | 6.9 | 1250 px |
| Plasma Projector | Energy | 38 | 1.1/s | 4.4 | 992 px |
| Scatter Cannon | Ballistic | 7 ×5 | 1.3/s | 4.9 | 440 px |
| Missile Pod | Missile | 24 ×2 | 1.4/s | 7.0 | 1034 px |
| Rail Cannon | Energy | 62 | 0.7/s | 4.5 | 2160 px |
| Inferno Flamer | Thermal | 3 | 22.2/s | 6.7 | 234 px |

Range is `speed × lifetime`, so the flamer dies at arm's length while the rail
cannon reaches across the screen. Every weapon's damage-per-heat sits in a
9.5–10.0 band, so no weapon is a strictly better use of your heat budget than
any other — you pick on range, delivery and feel.

## Controls

| Action | Input |
| --- | --- |
| Move | `A` / `D` or `←` / `→` |
| Jump | `Space` / `W` / `↑` |
| Aim | mouse |
| Fire every ready hardpoint | left mouse button / `J` |
| **Fire one hardpoint on its own** | **hold `1` … `6`** |
| Deploy / redeploy | `Enter` |
| Return to hangar | `H` (from the game-over / victory screen) |

Firing individually matters: with a six-gun chassis, firing everything at once is
how you saturate your heat sink, so nibbling with two or three hardpoints is often
better than holding the trigger. The weapon rack along the bottom labels each
hardpoint with its hotkey and shows its reload state.

## Winning

The objective is to travel **1500 m** and reach the **extraction beacon** — a
glowing pad with a light beam, visible on the ground as you approach. A progress
bar sits at the top of the screen. Reaching it is worth a 1000-point bonus and
ends the run in victory rather than death.

It is not just a sprint. A garrison of five enemies is waiting near the pad, and
enemies now spawn **from both directions**, so running flat out means ploughing
into things from the front while being chased from behind.

## Enemies

- **Drone** — fast hoverer that flies straight at you and detonates on contact.
- **Wrecker** — armored walker that closes in for melee.
- **Turret** — stationary; fires aimed shots. Only ever ahead of you (a static gun
  behind you would just be culled).

Roughly a third of spawns arrive **behind** you, so you cannot simply back away
from trouble. Spawn rate ramps up as you approach the extraction point.

## Project layout

```
index.html          canvas + the hangar overlay markup
css/style.css       game shell, hangar UI, responsive layout
js/weapons.js       frames + the 8 weapons + the heat model (pure, no rendering)
js/hangar.js        loadout UI: chassis -> hardpoints -> armory
js/main.js          bootstrap
js/game.js          state machine (hangar -> playing -> victory/game over), the
                    extraction objective, spawning, collisions, camera, HUD
js/entities.js      player mech (loadout + heat driven), 3 enemies, bullets, particles
js/world.js         parallax backdrop + curved terrain
js/input.js         keyboard + mouse with per-frame edge detection
js/audio.js         Web Audio synth sound effects
js/utils.js         math helpers
```

The hangar is a DOM overlay rather than canvas UI — real buttons and focus rings
beat hand-rolled canvas hit-testing for something this central. The simulation
only ever sees a `{ frame, weapons }` loadout, so UI and game stay decoupled.

## Where this is going

Customization is the whole point, so the next steps are part-by-part mech building
(legs, reactor, armour plating, heat sinks and radiators as separate parts),
weapon mass limits, per-hardpoint placement, and loadout save/export.
