# Scorched Voxels

A 3D take on *Scorched Earth* — an artillery duel against the computer in a
stylized white voxel world. Aim your cannon over dramatic terrain, read the
wind, and demolish the enemy's fort before yours crumbles.

Built with [three.js](https://threejs.org) + TypeScript + Vite. No framework,
no backend — the whole game is a handful of self-contained modules under `src/`.

## Play

```bash
npm install
npm run dev      # open the printed localhost URL
```

`npm run build` type-checks and produces a static bundle in `dist/` you can host
anywhere; `npm run preview` serves that build.

## Controls

| Input | Action |
| --- | --- |
| ← → ↑ ↓ | Aim the cannon (bearing / elevation) |
| Shift + arrows | Fine adjustment |
| Space (hold, release) | Charge power, release to fire |
| Tab / 1–9 / click | Select weapon |
| V or the **World View** button | Pull back to survey the whole battlefield |

## How it plays

- **Best-of-5 match** with a cash economy. Damage earns money; between rounds
  the **Armory** sells the classic arsenal — Baby Nuke, MIRV, Death's Head,
  Leap Frog, Funky Bomb, rollers, sandhogs, napalm, riot charges, dirt, and
  more — plus **fortifications** (a taller keep, extra towers).
- **Win a round and you plunder** the loser's treasury and remaining ammo.
- **Destructible voxel forts**: blasts carve craters, shockwaves topple walls,
  and shooting out a castle's foundation drops it into the cavity.
- **Dramatic procedural terrain** every round: tall peaks, mesa plateaus,
  river valleys, and lakes of stylized flowing water. Shells splash and die in
  water; dirt weapons fill it in.
- **Wind** shifts each turn and genuinely curves shots — read the compass.
- The computer opponent brackets in over successive shots and shops with its
  own winnings.

## Layout

| File | Responsibility |
| --- | --- |
| `src/main.ts` | Scene, game loop, turns, camera, input, projectiles, FX |
| `src/world.ts` | Voxel grid, terrain & water generation, forts, destruction |
| `src/weapons.ts` | Weapon roster and ballistic constants |
| `src/ai.ts` | Computer opponent's shot planning |
| `src/hud.ts` | DOM heads-up display, armory, banners |
| `src/audio.ts` | WebAudio sound effects |
