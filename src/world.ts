// Scorched Earth 3D — voxel world: terrain generation, forts, destruction, debris physics.
// Standalone from the voxel-builder app; shares nothing but the three.js dependency.
import * as THREE from 'three'

export const GX = 160
export const GY = 96
export const GZ = 160 // square footprint so 3–4 player forts sit equidistant (was 72, oblong)
export const GRAVITY = 28
export const WIND_ACCEL = 0.45 // projectile acceleration per unit of wind speed

export const EMPTY = 0
export const TERRAIN = 1
export const FORT_A = 2 // player 1 fort voxel
export const FORT_B = 3 // player 2 fort voxel
export const WATER = 4 // lakes & rivers — solid light blue, stylized
export const BARRICADE = 5 // bought defensive berm in front of a fort — soaks hits
export const CROP = 6 // income-producer (crop bed) planted on a side's land
export const MINE = 7 // income-producer (ore mine) — smaller, richer than a crop
export const DERRICK = 8 // income-producer (oil derrick) — smallest, richest
export const PLANT = 9 // Nuclear Power Plant — richest producer; must sit beside water; melts down if destroyed
export const FORT_C = 10 // player 3 fort voxel (3–4 player free-for-all)
export const FORT_D = 11 // player 4 fort voxel

// Fort cells are one-per-seat; these helpers keep the destruction/render code seat-count
// agnostic (the cells aren't a contiguous range, so isFortCell is an explicit test).
export function cellOfSide(side: number): number {
  return side === 0 ? FORT_A : side === 1 ? FORT_B : side === 2 ? FORT_C : FORT_D
}
export function sideOfCell(cell: number): number {
  return cell === FORT_A ? 0 : cell === FORT_B ? 1 : cell === FORT_C ? 2 : cell === FORT_D ? 3 : -1
}
export function isFortCell(cell: number): boolean {
  return cell === FORT_A || cell === FORT_B || cell === FORT_C || cell === FORT_D
}
// Per-seat fort tint (light so blast damage reads); `h` is a per-voxel hash for variation.
export function fortColorRGB(side: number, h: number, out: THREE.Color): void {
  const v = 0.92 + h * 0.05
  if (side === 1) out.setRGB(v * 0.82, v * 0.89, Math.min(1, v + 0.06)) // blue
  else if (side === 2) out.setRGB(v * 0.72, Math.min(1, v + 0.05), v * 0.74) // green
  else if (side === 3) out.setRGB(Math.min(1, v + 0.05), v * 0.9, v * 0.6) // gold
  else out.setRGB(Math.min(1, v + 0.06), v * 0.86, v * 0.82) // red (side 0 / default)
}

// Per-seat spawn anchors: 2 players face off across the mid-edges (as before); 3 spread
// into a triangle, 4 into the corners. Each anchor faces toward the map centre (x-sign).
function spawnAnchors(n: number, rand: () => number): { cx: number; cz: number; facing: number }[] {
  const mk = (cx: number, cz: number) => ({
    cx: Math.max(14, Math.min(GX - 14, Math.round(cx + (rand() - 0.5) * 12))),
    cz: Math.max(10, Math.min(GZ - 10, Math.round(cz + (rand() - 0.5) * 10))),
    facing: cx < GX / 2 ? 1 : -1,
  })
  const midX = GX / 2, midZ = GZ / 2
  // 2 players: opposed on the mid-line. 3: a centred equilateral triangle (all pairs
  // equidistant). 4: a centred square of corners (all adjacent pairs equidistant). On the
  // now-square footprint these are genuinely symmetric — an oblong map used to squash them.
  if (n <= 2) return [mk(18, midZ), mk(GX - 18, midZ)]
  if (n === 3) {
    const R = Math.min(GX, GZ) * 0.36 // circumradius; side = R·√3 ≈ 0.62·S
    return [mk(midX, midZ - R), mk(midX + R * 0.866, midZ + R * 0.5), mk(midX - R * 0.866, midZ + R * 0.5)]
  }
  const lo = 0.18, hi = 0.82
  return [mk(GX * lo, GZ * lo), mk(GX * hi, GZ * lo), mk(GX * lo, GZ * hi), mk(GX * hi, GZ * hi)]
}

// Per-type producer geometry & economy. half = footprint radius (half=4 → 9×9),
// tall = voxel height, baseYield = full per-turn income, cost = plant price.
// matures: crops ramp up over a couple turns; mines/derricks pay in full at once.
export const PRODUCER_SPECS: Record<number, { half: number; tall: number; baseYield: number; cost: number; name: string; matures: boolean }> = {
  [CROP]: { half: 4, tall: 2, baseYield: 150, cost: 800, name: 'Crop farm', matures: true },
  [MINE]: { half: 2, tall: 3, baseYield: 320, cost: 1500, name: 'Ore mine', matures: false },
  [DERRICK]: { half: 1, tall: 6, baseYield: 560, cost: 3000, name: 'Oil derrick', matures: false },
  // Nuclear Power Plant: premium income (~$6,000/turn, best-in-game per dollar) for its $20,000
  // cost — but it must be built beside water, and a meltdown if destroyed is a catastrophe.
  [PLANT]: { half: 4, tall: 8, baseYield: 6000, cost: 20000, name: 'Nuclear Power Plant', matures: false },
}

export type Vec3 = { x: number; y: number; z: number }
export type Wind = { x: number; z: number }

const MAX_INSTANCES = 140000
const MAX_DEBRIS = 1600
const RUBBLE_MARGIN = 3 // fort voxels below baseY+margin no longer count as "standing"

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Deterministic per-cell hash so instance colors don't flicker across rebuilds.
function cellHash(x: number, y: number, z: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 1274126177) | 0
  h = Math.imul(h ^ (h >>> 13), 1103515245)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t)
}

// 2D Perlin gradient noise + fBm for the heightmap.
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10)
}

function gradDot(ix: number, iz: number, dx: number, dz: number, seed: number): number {
  const a = cellHash(ix, seed, iz) * Math.PI * 2
  return Math.cos(a) * dx + Math.sin(a) * dz
}

function perlin2(x: number, z: number, seed: number): number {
  const xi = Math.floor(x)
  const zi = Math.floor(z)
  const fx = x - xi
  const fz = z - zi
  const u = fade(fx)
  const v = fade(fz)
  const n00 = gradDot(xi, zi, fx, fz, seed)
  const n10 = gradDot(xi + 1, zi, fx - 1, fz, seed)
  const n01 = gradDot(xi, zi + 1, fx, fz - 1, seed)
  const n11 = gradDot(xi + 1, zi + 1, fx - 1, fz - 1, seed)
  const nx0 = n00 + (n10 - n00) * u
  const nx1 = n01 + (n11 - n01) * u
  return (nx0 + (nx1 - nx0) * v) * 1.4 // ≈ [-1, 1]
}

function fbmPerlin(x: number, z: number, seed: number, octaves = 5): number {
  let amp = 0.5
  let freq = 1
  let sum = 0
  let norm = 0
  for (let o = 0; o < octaves; o++) {
    sum += amp * perlin2(x * freq, z * freq, seed + o * 131)
    norm += amp
    amp *= 0.5
    freq *= 2
  }
  return sum / norm // ≈ [-1, 1]
}

type Debris = {
  x: number; y: number; z: number
  vx: number; vy: number; vz: number
  rx: number; ry: number; rz: number
  wx: number; wy: number; wz: number
  cell: number
}

// support[] records, per footprint column, the y of the first solid cell under
// the structure at build time — the reference for detecting undermining.
export type Tower = { cx: number; cz: number; baseY: number; rubbleY: number; support: number[] }

export type FortInfo = {
  cell: number
  towers: Tower[] // towers[0] is the main tower
  origCount: number
  facing: number // door/berm x-direction toward map center (+1 left seats, -1 right seats)
}

// Purchasable, match-persistent structure upgrades per side.
export type Fortifications = { height: number; towers: number; barricade: number }

// A planted income-producer. Its income scales with how many of its voxels survive.
export type ProducerInfo = { type: number; side: number; cx: number; cz: number; cells: number[]; origCount: number; baseYield: number; age: number }

export type ShotResult = { hit: boolean; pos: Vec3; t: number }

const FORT_HALF = 4 // 9x9 footprint
const FORT_HEIGHT = 17

export class World {
  grid: Uint8Array
  forts: FortInfo[] = []
  producers: ProducerInfo[] = []
  // Player-chosen castle positions (per side); null = use the seed's random spot.
  // Set by the castle-placement step, then honoured on the next generate().
  castleOverride: ({ cx: number; cz: number } | null)[] = [null, null]
  // Ghost Tower: which side's fort voxels to skip rendering (invisible), or -1. The
  // cells stay solid (integrity/collisions intact) — only their instances are hidden.
  hiddenForts: boolean[] = [false, false, false, false] // Ghost Tower: skip rendering these seats' forts
  contaminated: { cx: number; cz: number; r: number }[] = [] // radioactive meltdown zones — no building
  mesh: THREE.InstancedMesh
  debrisMesh: THREE.InstancedMesh
  debris: Debris[] = []
  dirty = false
  waterY = -1 // global water table; -1 = dry map
  private scene: THREE.Scene
  private waterTex!: THREE.CanvasTexture
  private waterMat!: THREE.MeshBasicMaterial
  private waterMesh: THREE.Mesh | null = null

  private tmpM = new THREE.Matrix4()
  private tmpQ = new THREE.Quaternion()
  private tmpE = new THREE.Euler()
  private tmpS = new THREE.Vector3(1, 1, 1)
  private tmpP = new THREE.Vector3()
  private tmpC = new THREE.Color()
  private colorSeed = 0

  constructor(scene: THREE.Scene) {
    this.scene = scene
    this.grid = new Uint8Array(GX * GY * GZ)
    const geo = new THREE.BoxGeometry(1, 1, 1)
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff })
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX_INSTANCES)
    this.mesh.castShadow = true
    this.mesh.receiveShadow = true
    this.mesh.frustumCulled = false
    this.mesh.count = 0
    scene.add(this.mesh)

    const dmat = new THREE.MeshLambertMaterial({ color: 0xf4f4f6 })
    this.debrisMesh = new THREE.InstancedMesh(geo, dmat, MAX_DEBRIS)
    this.debrisMesh.castShadow = true
    this.debrisMesh.frustumCulled = false
    this.debrisMesh.count = 0
    scene.add(this.debrisMesh)

    // Stylized water top: solid light blue with thick white flow-dashes that
    // scroll to show movement. Drawn once; animated via texture offset.
    const wc = document.createElement('canvas')
    wc.width = 256
    wc.height = 256
    const wg = wc.getContext('2d')!
    wg.fillStyle = '#7cc4ea'
    wg.fillRect(0, 0, 256, 256)
    wg.strokeStyle = 'rgba(255,255,255,0.92)'
    wg.lineCap = 'round'
    for (let i = 0; i < 7; i++) {
      wg.lineWidth = 6 + (i % 3) * 3
      wg.setLineDash([20 + (i % 4) * 9, 30 + (i % 3) * 12])
      wg.lineDashOffset = i * 17
      const y0 = 16 + i * 34
      wg.beginPath()
      for (let x = -24; x <= 280; x += 8) {
        const y = y0 + Math.sin((x / 256) * Math.PI * 2 * (1 + (i % 2)) + i * 1.7) * 6
        if (x === -24) wg.moveTo(x, y)
        else wg.lineTo(x, y)
      }
      wg.stroke()
    }
    this.waterTex = new THREE.CanvasTexture(wc)
    this.waterTex.wrapS = THREE.RepeatWrapping
    this.waterTex.wrapT = THREE.RepeatWrapping
    this.waterMat = new THREE.MeshBasicMaterial({ map: this.waterTex, side: THREE.DoubleSide })
  }

  // Scroll the flow-dashes; call once per frame.
  updateWater(dt: number): void {
    this.waterTex.offset.x -= dt * 0.05
    this.waterTex.offset.y += dt * 0.012
  }

  idx(x: number, y: number, z: number): number {
    return x + GX * (z + GZ * y)
  }

  inBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && x < GX && y >= 0 && y < GY && z >= 0 && z < GZ
  }

  cellAt(x: number, y: number, z: number): number {
    if (!this.inBounds(x, y, z)) return EMPTY
    return this.grid[this.idx(x, y, z)]
  }

  isSolid(x: number, y: number, z: number): boolean {
    const rx = Math.round(x)
    const ry = Math.round(y)
    const rz = Math.round(z)
    if (!this.inBounds(rx, ry, rz)) return false
    return this.grid[this.idx(rx, ry, rz)] !== EMPTY
  }

  surfaceY(x: number, z: number): number {
    const rx = Math.round(x)
    const rz = Math.round(z)
    if (rx < 0 || rx >= GX || rz < 0 || rz >= GZ) return -1
    for (let y = GY - 1; y >= 0; y--) {
      if (this.grid[this.idx(rx, y, rz)] !== EMPTY) return y
    }
    return -1
  }

  // ---------------------------------------------------------------- generation

  generate(seed: number, forti: Fortifications[] = [{ height: 0, towers: 0, barricade: 0 }, { height: 0, towers: 0, barricade: 0 }], playerCount?: number): void {
    this.grid.fill(EMPTY)
    this.debris.length = 0
    this.debrisMesh.count = 0
    this.forts = []
    this.producers = []
    this.raidedCells = null
    this.hiddenForts = [false, false, false, false]
    this.contaminated = [] // a fresh battlefield each round has no fallout craters
    this.colorSeed = seed & 0xffff
    const rand = mulberry32(seed)

    // One seed anchor per seat (2 players: opposite mid-edges; 3–4: corners), each with a
    // facing toward the map centre. The SEED sites shape the terrain (pads rise there and
    // never move); a castle-placement override only moves the BUILT tower, which rides the
    // existing surface — repositioning a castle must never deform the landscape.
    // Build exactly one fort per living seat. `forti` is a fixed length-4 pool, so the caller
    // passes the real player count — otherwise a 2-player duel would spawn 4 towers.
    const N = Math.max(2, Math.min(forti.length, playerCount ?? forti.length))
    const seeds = spawnAnchors(N, rand)
    // Built positions honour any per-seat castle override.
    const built = seeds.map((a, i) => {
      const o = this.castleOverride[i]
      return { cx: o ? o.cx : a.cx, cz: o ? o.cz : a.cz, facing: a.facing }
    })

    const nseed = Math.floor(rand() * 100000)
    // Per-match character: rolling plains, jagged peaks, ridged badlands, or
    // terraced mesa plateaus — with extremely tall relief and a water table
    // that turns basins into lakes and river valleys into rivers.
    const amp = 20 + rand() * 44
    const sharp = 1.1 + rand() * 1.1 // exponent >1 exaggerates peaks vs valleys
    const ridged = rand() < 0.3
    const plateau = rand() < 0.35
    const plateauLevels = 3 + Math.floor(rand() * 3)
    const waterY = Math.round(6 + rand() * 10) // higher table → more basins flood into lakes
    const hasRiver = true // every battlefield gets a river
    const riverSlant = (rand() - 0.5) * 0.6
    const riverWidth = 6 + rand() * 8
    const riverBed = waterY - 3 // channel floor always below the water table
    // A broad lake sits somewhere between the forts, pulling terrain below the
    // water table into open water.
    const hasLake = rand() < 0.7
    const lakeCX = GX / 2 + (rand() - 0.5) * 34
    const lakeCZ = GZ / 2 + (rand() - 0.5) * 34
    const lakeR = 14 + rand() * 16
    // Each fort's pad elevation rolls independently; in a 2-player duel, 40% of matches
    // force real drama (one castle high on a mountain, the other in a valley).
    const padOf: number[] = []
    if (N === 2 && rand() < 0.4) {
      const high = 24 + rand() * 16
      const low = 5 + rand() * 7
      if (rand() < 0.5) { padOf[0] = high; padOf[1] = low } else { padOf[0] = low; padOf[1] = high }
    } else {
      for (let i = 0; i < N; i++) padOf[i] = 6 + rand() * 30
    }
    for (let i = 0; i < N; i++) padOf[i] = Math.max(padOf[i], waterY + 3) // clear of the water

    // Tower sites for a fort: the main tower plus any purchased extras, spread in z.
    const towerSites = (cx: number, cz: number, extra: number, dir: number): { cx: number; cz: number }[] => {
      const sites = [{ cx, cz }]
      if (extra >= 1) sites.push({ cx: cx + dir * 3, cz: Math.min(GZ - 8, cz + 13) })
      if (extra >= 2) sites.push({ cx: cx + dir * 3, cz: Math.max(7, cz - 13) })
      return sites
    }
    // Terrain pads rise at the natural SEED sites only, so the land is identical no matter
    // where the castles were placed — a moved tower stands on raw terrain.
    const pads: { cx: number; cz: number; pad: number }[] = []
    for (let i = 0; i < N; i++) {
      for (const s of towerSites(seeds[i].cx, seeds[i].cz, forti[i].towers, seeds[i].facing)) {
        pads.push({ ...s, pad: padOf[i] })
      }
    }
    this.waterY = waterY
    for (let x = 0; x < GX; x++) {
      for (let z = 0; z < GZ; z++) {
        let n01 = 0.5 + 0.5 * fbmPerlin(x / 36, z / 36, nseed)
        if (ridged) {
          const r = 1 - Math.abs(fbmPerlin(x / 48, z / 48, nseed + 777, 4))
          n01 = n01 * 0.45 + r * r * 0.55
        }
        if (plateau) {
          // Terraced mesas: quantize height into stepped levels with cliffs.
          const t = Math.floor(n01 * plateauLevels) / plateauLevels
          n01 = n01 * 0.25 + t * 0.75
        }
        const detail = fbmPerlin(x / 12, z / 12, nseed + 999, 3) * 4.5
        let h = 4 + Math.pow(Math.max(0, n01), sharp) * amp + detail
        // A meandering river carves clear down to the water table, gorge-style
        // through mountains, wide valley through plains.
        if (hasRiver) {
          const xr = GX / 2 + riverSlant * (z - GZ / 2) + fbmPerlin(z / 34, 3.3, nseed + 555) * 30
          const d = x - xr
          const g = Math.exp(-(d * d) / (2 * riverWidth * riverWidth))
          h -= Math.max(0, h - riverBed) * g
        }
        // A broad lake basin — pulled below the water table into open water.
        if (hasLake) {
          const dl = Math.hypot(x - lakeCX, z - lakeCZ)
          if (dl < lakeR) {
            const t = smoothstep(Math.min(1, dl / lakeR))
            h = Math.min(h, riverBed) * (1 - t) + h * t
          }
        }
        // Blend toward each tower's pad height: a high pad grows a mountain
        // beneath the fort, a low pad sinks it into a bowl.
        for (const f of pads) {
          const R = 11 + Math.abs(f.pad - 12) * 0.5
          const d = Math.hypot(x - f.cx, z - f.cz)
          if (d < R) {
            const t = smoothstep(Math.min(1, d / R))
            h = f.pad * (1 - t) + h * t
          }
        }
        const hi = Math.max(2, Math.min(GY - 26, Math.round(h)))
        for (let y = 0; y <= hi; y++) this.grid[this.idx(x, y, z)] = TERRAIN
        // Basins and river cuts below the water table fill with water.
        for (let y = hi + 1; y <= waterY; y++) this.grid[this.idx(x, y, z)] = WATER
      }
    }

    // Build each seat's towers (main tower + purchased extras); only the main gets height.
    for (let side = 0; side < N; side++) {
      const cell = cellOfSide(side)
      const b = built[side]
      const sites = towerSites(b.cx, b.cz, forti[side].towers, b.facing)
      const fort: FortInfo = { cell, towers: [], origCount: 0, facing: b.facing }
      for (let ti = 0; ti < sites.length; ti++) {
        const extraH = ti === 0 ? forti[side].height : 0
        fort.origCount += this.buildTower(fort, sites[ti].cx, sites[ti].cz, cell, extraH)
      }
      this.forts.push(fort)
      this.buildBarricade(b.cx, b.cz, b.facing, forti[side].towers, forti[side].barricade)
    }
    // Producers are player/AI-placed each turn; main.ts rebuilds them here from its
    // persistent placement lists (see rebuildRoundWorld). generate() leaves the land bare.
    this.rebuild()
  }

  // Relocate one side's fort to (cx,cz) WITHOUT regenerating the world: the old fort's
  // voxels vanish, the tower(s) rebuild on the current surface at the new spot, and all
  // battlefield damage, craters, and producers stay exactly as they are.
  moveFort(side: number, cx: number, cz: number, forti: Fortifications): void {
    const cell = cellOfSide(side)
    const facing = this.forts[side]?.facing ?? (side === 0 ? 1 : -1)
    // Capture the current tower damage (blueprint cells that are missing) per tower so
    // a relocation — e.g. the Ghost Tower card — carries the damage instead of healing
    // the tower to full. Recorded as offsets from each tower's origin, re-applied to the
    // matching tower after the rebuild. A full-health tower records nothing (no-op).
    const old = this.forts[side]
    const damage: { dx: number; dy: number; dz: number }[][] = []
    if (old) {
      for (let ti = 0; ti < old.towers.length; ti++) {
        const t = old.towers[ti]
        const extraH = ti === 0 ? forti.height : 0
        const miss: { dx: number; dy: number; dz: number }[] = []
        for (const p of this.towerBlueprint(t.cx, t.cz, t.baseY, cell, extraH, facing)) {
          if (this.cellAt(p.x, p.y, p.z) === EMPTY) miss.push({ dx: p.x - t.cx, dy: p.y - t.baseY, dz: p.z - t.cz })
        }
        damage.push(miss)
      }
    }
    for (let i = 0; i < this.grid.length; i++) if (this.grid[i] === cell) this.grid[i] = EMPTY
    // Tear down THIS fort's old berm (BARRICADE near the old keep) so it moves with the tower
    // rather than being left behind. Forts sit far apart, so a local box only clears our own.
    if (old) {
      const oc = old.towers[0]
      for (let x = Math.max(0, oc.cx - 32); x < Math.min(GX, oc.cx + 32); x++)
        for (let z = Math.max(0, oc.cz - 32); z < Math.min(GZ, oc.cz + 32); z++)
          for (let y = 0; y < GY; y++) if (this.grid[this.idx(x, y, z)] === BARRICADE) this.grid[this.idx(x, y, z)] = EMPTY
    }
    const sites = this.fortSites(cx, cz, facing, forti.towers)
    const fort: FortInfo = { cell, towers: [], origCount: 0, facing }
    for (let ti = 0; ti < sites.length; ti++) {
      const extraH = ti === 0 ? forti.height : 0
      fort.origCount += this.buildTower(fort, sites[ti].cx, sites[ti].cz, cell, extraH)
    }
    // Re-punch the captured damage into the matching relocated towers (move as-is).
    for (let ti = 0; ti < fort.towers.length; ti++) {
      const miss = damage[ti]
      if (!miss) continue
      const t = fort.towers[ti]
      for (const m of miss) {
        const x = t.cx + m.dx
        const y = t.baseY + m.dy
        const z = t.cz + m.dz
        if (this.inBounds(x, y, z) && this.cellAt(x, y, z) === cell) this.grid[this.idx(x, y, z)] = EMPTY
      }
    }
    this.forts[side] = fort
    this.buildBarricade(cx, cz, facing, forti.towers, forti.barricade) // the curtain wall moves too
    this.dirty = true
  }

  // ---------------------------------------------------------------- producers (economy)

  // Can a producer of `type` sit at (cx,cz)? Producers may go anywhere on the map now
  // — including water and rough terrain — so we only reject out-of-bounds and overlap
  // with a fort, berm, or another producer. Public so main.ts can validate.
  canPlaceProducer(cx: number, cz: number, type = CROP): boolean {
    const half = PRODUCER_SPECS[type].half
    for (let dx = -half; dx <= half; dx++) {
      for (let dz = -half; dz <= half; dz++) {
        const x = cx + dx
        const z = cz + dz
        if (!this.inBounds(x, 0, z)) return false
        const sy = this.surfaceY(x, z)
        if (sy < 0) return false
        const top = this.cellAt(x, sy, z)
        if (isFortCell(top) || top === BARRICADE || top === CROP || top === MINE || top === DERRICK || top === PLANT) return false
      }
    }
    // A Nuclear Power Plant needs water for cooling: at least one water cell must border its
    // footprint (the ring one cell out on each side).
    if (type === PLANT && !this.waterAdjacent(cx, cz, half)) return false
    // Nothing grows on radioactive ground left by a meltdown.
    for (const z of this.contaminated) if (Math.hypot(cx - z.cx, cz - z.cz) <= z.r + half) return false
    return true
  }

  // Is there open water immediately bordering the (2·half+1) footprint at (cx,cz)?
  waterAdjacent(cx: number, cz: number, half: number): boolean {
    for (let d = -half - 1; d <= half + 1; d++) {
      if (this.isWaterTop(cx + d, cz - half - 1) || this.isWaterTop(cx + d, cz + half + 1)) return true
      if (this.isWaterTop(cx - half - 1, cz + d) || this.isWaterTop(cx + half + 1, cz + d)) return true
    }
    return false
  }

  // Raise one raised bed of producer voxels (footprint & height per type) on the
  // terrain surface, recording its cells so income can scale with how many survive.
  buildProducer(cx: number, cz: number, side: number, type = CROP, baseYield = PRODUCER_SPECS[type].baseYield, age = 0): ProducerInfo {
    const spec = PRODUCER_SPECS[type]
    const cells: number[] = []
    for (let dx = -spec.half; dx <= spec.half; dx++) {
      for (let dz = -spec.half; dz <= spec.half; dz++) {
        const x = cx + dx
        const z = cz + dz
        if (!this.inBounds(x, 0, z)) continue
        const base = this.surfaceY(x, z) + 1
        for (let dy = 0; dy < spec.tall; dy++) {
          if (!this.inBounds(x, base + dy, z)) continue
          const i = this.idx(x, base + dy, z)
          this.grid[i] = type
          cells.push(i)
        }
      }
    }
    const p: ProducerInfo = { type, side, cx, cz, cells, origCount: cells.length, baseYield, age }
    this.producers.push(p)
    this.dirty = true
    return p
  }

  // Nearest valid producer spot within a box around (cx,cz) — the seat's own fort — or
  // null if that ground is full. Used by the AI to auto-place near its castle; the human
  // positions by hand. A box keeps each seat's economy on its own turf (its corner).
  findProducerSpot(_side: number, cx: number, cz: number, type = CROP): { cx: number; cz: number } | null {
    const R = 34
    const xMin = Math.max(6, Math.round(cx - R))
    const xMax = Math.min(GX - 6, Math.round(cx + R))
    const zMin = Math.max(6, Math.round(cz - R))
    const zMax = Math.min(GZ - 6, Math.round(cz + R))
    const spots: { px: number; pz: number; d: number }[] = []
    for (let px = xMin; px <= xMax; px += 6) {
      for (let pz = zMin; pz <= zMax; pz += 6) {
        spots.push({ px, pz, d: Math.hypot(px - cx, pz - cz) })
      }
    }
    spots.sort((a, b) => a.d - b.d) // nearest the fort first
    for (const s of spots) {
      if (this.canPlaceProducer(s.px, s.pz, type)) return { cx: s.px, cz: s.pz }
    }
    return null
  }

  // Physical integrity (0..1) of the producer at (cx,cz), or 0 if none. Lets main.ts
  // compute income from its persistent placement list without tracking cells itself.
  integrityAt(cx: number, cz: number): number {
    const p = this.producers.find(q => q.cx === cx && q.cz === cz)
    return p ? this.producerIntegrity(p) : 0
  }

  // Every voxel position a tower at (cx,cz,baseY) is SUPPOSED to occupy — the same
  // geometry buildTower raises (walls, floors, roof, crenellations, doorway gap, and
  // foundations rooted to the current ground). Used by repairTransfer to find holes.
  private towerBlueprint(cx: number, cz: number, baseY: number, _cell: number, extraH: number, facing: number): Vec3[] {
    const height = Math.max(9, FORT_HEIGHT + extraH) // a stub (negative bonus) never sinks below a keepable minimum
    const out: Vec3[] = []
    const add = (x: number, y: number, z: number) => {
      if (this.inBounds(x, y, z)) out.push({ x, y, z })
    }
    for (let dy = 0; dy < height; dy++) {
      for (let dx = -FORT_HALF; dx <= FORT_HALF; dx++) {
        for (let dz = -FORT_HALF; dz <= FORT_HALF; dz++) {
          const onWall = Math.abs(dx) === FORT_HALF || Math.abs(dz) === FORT_HALF
          const isFloor = dy > 0 && dy < height - 1 && dy % 5 === 0
          const isTop = dy === height - 1
          if (!onWall && !isFloor && !isTop) continue
          if (onWall && dx === facing * FORT_HALF && Math.abs(dz) <= 1 && dy >= 1 && dy <= 3) continue
          add(cx + dx, baseY + dy, cz + dz)
        }
      }
    }
    for (let dx = -FORT_HALF; dx <= FORT_HALF; dx++) {
      for (let dz = -FORT_HALF; dz <= FORT_HALF; dz++) {
        const onWall = Math.abs(dx) === FORT_HALF || Math.abs(dz) === FORT_HALF
        if (!onWall) continue
        if (((dx + dz) & 1) === 0) add(cx + dx, baseY + height, cz + dz)
        if (Math.abs(dx) === FORT_HALF && Math.abs(dz) === FORT_HALF) {
          add(cx + dx, baseY + height, cz + dz)
          add(cx + dx, baseY + height + 1, cz + dz)
        }
        let fy = baseY - 1
        while (fy >= 0 && this.cellAt(cx + dx, fy, cz + dz) === EMPTY) {
          add(cx + dx, fy, cz + dz)
          fy--
        }
      }
    }
    return out
  }

  // Rebuild card: repair `toSide`'s towers voxel by voxel — every blueprint cell that
  // is currently missing refills, from the ground up, using voxels ripped off the top
  // of `fromSide`'s tower. Spends at most HALF the donor tower's current size, and
  // never builds past the original shape (no stacking above the turret top). Returns
  // the removed and filled positions so the caller can animate the voxels flying.
  repairTransfer(fromSide: number, toSide: number, forti: Fortifications): { from: Vec3[]; to: Vec3[] } {
    const ff = this.forts[fromSide]
    const tf = this.forts[toSide]
    const from: Vec3[] = []
    const to: Vec3[] = []
    if (!ff || !tf || !tf.towers.length) return { from, to }
    const seen = new Set<number>()
    const missing: Vec3[] = []
    for (let ti = 0; ti < tf.towers.length; ti++) {
      const t = tf.towers[ti]
      const extraH = ti === 0 ? forti.height : 0
      for (const p of this.towerBlueprint(t.cx, t.cz, t.baseY, tf.cell, extraH, tf.facing)) {
        const i = this.idx(p.x, p.y, p.z)
        if (seen.has(i)) continue
        seen.add(i)
        if (this.grid[i] === EMPTY) missing.push(p)
      }
    }
    if (!missing.length) return { from, to }
    missing.sort((a, b) => a.y - b.y) // brick by brick, from the ground up
    const donor: Vec3[] = []
    for (const t of ff.towers) {
      for (let y = 0; y < GY; y++)
        for (let x = t.cx - FORT_HALF - 1; x <= t.cx + FORT_HALF + 1; x++)
          for (let z = t.cz - FORT_HALF - 1; z <= t.cz + FORT_HALF + 1; z++)
            if (this.cellAt(x, y, z) === ff.cell) donor.push({ x, y, z })
    }
    const used = Math.min(Math.floor(donor.length / 2), missing.length)
    if (used <= 0) return { from, to }
    donor.sort((a, b) => b.y - a.y) // rip their top off first
    for (let k = 0; k < used; k++) {
      const c = donor[k]
      this.grid[this.idx(c.x, c.y, c.z)] = EMPTY
      from.push(c)
      const m = missing[k]
      this.grid[this.idx(m.x, m.y, m.z)] = tf.cell
      to.push(m)
    }
    this.dirty = true
    return { from, to }
  }

  // Ghost strike (Full Moon): knock out `frac` of a side's STANDING fort voxels,
  // top-first so the tower visibly shortens. frac>=1 razes it entirely (a collapse).
  // The voxels are removed cleanly (no settling debris — the ghosts spirit them away,
  // and re-settling bricks would just restack onto the tower and heal it). Returns the
  // removed positions so the caller can play a spooky poof there.
  damageFortFraction(side: number, frac: number, rand: () => number): Vec3[] {
    const f = this.forts[side]
    if (!f) return []
    const cells: Vec3[] = []
    for (const t of f.towers) {
      for (let y = t.rubbleY; y < GY; y++)
        for (let x = t.cx - FORT_HALF - 1; x <= t.cx + FORT_HALF + 1; x++)
          for (let z = t.cz - FORT_HALF - 1; z <= t.cz + FORT_HALF + 1; z++)
            if (this.cellAt(x, y, z) === f.cell) cells.push({ x, y, z })
    }
    cells.sort((a, b) => b.y - a.y) // top of the towers first
    const n = Math.min(cells.length, Math.ceil(cells.length * frac))
    const removed: Vec3[] = []
    for (let k = 0; k < n; k++) {
      const c = cells[k]
      this.grid[this.idx(c.x, c.y, c.z)] = EMPTY
      removed.push(c)
    }
    this.updateSupport(rand)
    this.dirty = true
    return removed
  }

  // Remove a placed producer entirely (Steal / Zombie King seizures): its surviving
  // voxels vanish from the map and it stops earning. Returns its type, or -1.
  removeProducer(cx: number, cz: number): number {
    const k = this.producers.findIndex(p => p.cx === cx && p.cz === cz)
    if (k < 0) return -1
    const p = this.producers[k]
    for (const i of p.cells) if (this.grid[i] === p.type) this.grid[i] = EMPTY
    this.producers.splice(k, 1)
    this.dirty = true
    return p.type
  }

  // Army raid: the victim's producers glow pink until their turn is over. The set
  // holds the raided cells; rebuild() tints them.
  raidedCells: Set<number> | null = null
  setRaided(side: number): void {
    this.raidedCells = new Set<number>()
    for (const p of this.producers) if (p.side === side) for (const i of p.cells) this.raidedCells.add(i)
    this.dirty = true
  }
  clearRaided(): void {
    if (!this.raidedCells) return
    this.raidedCells = null
    this.dirty = true
  }

  // Fraction of a producer still standing (0..1) — drives its income.
  producerIntegrity(p: ProducerInfo): number {
    let n = 0
    for (const i of p.cells) if (this.grid[i] === p.type) n++
    return n / Math.max(1, p.origCount)
  }

  // A side's total per-turn income = Σ baseYield × integrity over its producers.
  producerIncome(side: number): number {
    let sum = 0
    for (const p of this.producers) {
      if (p.side !== side) continue
      sum += p.baseYield * this.producerIntegrity(p)
    }
    return Math.round(sum)
  }

  // A destructible berm a few voxels in front of a fort (toward the enemy). It
  // blocks and soaks flat shots so they must be lobbed over — bought in the shop,
  // taller/thicker with each level. Not counted in fort integrity.
  // The tower footprints for a fort with `extraTowers` extras at (cx,cz) facing `facing` —
  // shared by generation, relocation, and the berm so they always agree.
  private fortSites(cx: number, cz: number, facing: number, extraTowers: number): { cx: number; cz: number }[] {
    const sites = [{ cx, cz }]
    if (extraTowers >= 1) sites.push({ cx: cx + facing * 3, cz: Math.min(GZ - 8, cz + 13) })
    if (extraTowers >= 2) sites.push({ cx: cx + facing * 3, cz: Math.max(7, cz - 13) })
    return sites
  }

  // A defensive berm builds a full CURTAIN WALL that rings the fortress on all four sides.
  // With more than one tower the wall grows to ENCLOSE every tower (a rectangle around their
  // combined footprint), and each extra berm bought makes it taller and thicker.
  buildBarricade(cx: number, cz: number, facing: number, extraTowers: number, level: number): void {
    if (level <= 0) return
    const height = 4 + level * 4 // 1 berm: 8 tall, 2: 12, 3: 16 — more berms → higher wall
    const thick = 1 + level // 1: 2 thick, 2: 3, 3: 4 (a chunkier wall soaks more)
    const gap = 4 // clear space between the outermost tower wall and the inner face of the berm
    // Bounding box of every tower footprint, then the open interior (hole) and outer extent.
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
    for (const s of this.fortSites(cx, cz, facing, extraTowers)) {
      minX = Math.min(minX, s.cx - FORT_HALF); maxX = Math.max(maxX, s.cx + FORT_HALF)
      minZ = Math.min(minZ, s.cz - FORT_HALF); maxZ = Math.max(maxZ, s.cz + FORT_HALF)
    }
    const ix0 = minX - gap, ix1 = maxX + gap, iz0 = minZ - gap, iz1 = maxZ + gap // open hole
    const ox0 = ix0 - thick, ox1 = ix1 + thick, oz0 = iz0 - thick, oz1 = iz1 + thick // outer edge
    // Tear down any existing berm in this footprint FIRST, so a rebuild (buying more berms, or a
    // relocation) starts from bare terrain. Otherwise surfaceY sees the old wall and the new one
    // stacks on top of it, ballooning the height each purchase (and a later move "shrinks" it).
    for (let x = Math.max(0, minX - 14); x <= Math.min(GX - 1, maxX + 14); x++)
      for (let z = Math.max(0, minZ - 14); z <= Math.min(GZ - 1, maxZ + 14); z++)
        for (let y = 0; y < GY; y++) { const i = this.idx(x, y, z); if (this.grid[i] === BARRICADE) this.grid[i] = EMPTY }
    for (let x = ox0; x <= ox1; x++) {
      for (let z = oz0; z <= oz1; z++) {
        if (x >= ix0 && x <= ix1 && z >= iz0 && z <= iz1) continue // inside the hole → open
        if (x < 0 || x >= GX || z < 0 || z >= GZ) continue
        const base = this.surfaceY(x, z) + 1
        for (let dy = 0; dy < height; dy++) {
          if (this.inBounds(x, base + dy, z)) this.grid[this.idx(x, base + dy, z)] = BARRICADE
        }
        let fy = base - 1
        while (fy >= 0 && this.cellAt(x, fy, z) === EMPTY) {
          this.grid[this.idx(x, fy, z)] = BARRICADE
          fy--
        }
      }
    }
  }

  // Build one tower; returns the voxel count above its rubble line.
  private buildTower(fort: FortInfo, cx: number, cz: number, cell: number, extraH: number): number {
    const baseY = this.surfaceY(cx, cz) + 1
    const height = Math.max(9, FORT_HEIGHT + extraH) // a stub (negative bonus) never sinks below a keepable minimum
    const facing = fort.facing // door faces toward the map centre
    const put = (x: number, y: number, z: number) => {
      if (this.inBounds(x, y, z)) this.grid[this.idx(x, y, z)] = cell
    }
    for (let dy = 0; dy < height; dy++) {
      for (let dx = -FORT_HALF; dx <= FORT_HALF; dx++) {
        for (let dz = -FORT_HALF; dz <= FORT_HALF; dz++) {
          const onWall = Math.abs(dx) === FORT_HALF || Math.abs(dz) === FORT_HALF
          const isFloor = dy > 0 && dy < height - 1 && dy % 5 === 0
          const isTop = dy === height - 1
          if (!onWall && !isFloor && !isTop) continue
          // Doorway on the enemy-facing wall.
          if (onWall && dx === facing * FORT_HALF && Math.abs(dz) <= 1 && dy >= 1 && dy <= 3) continue
          put(cx + dx, baseY + dy, cz + dz)
        }
      }
    }
    // Crenellations + raised corners, and foundations: every wall column is
    // rooted down to the actual terrain so nothing hovers over the blended
    // pad edges (and undermining has something real to blast away).
    for (let dx = -FORT_HALF; dx <= FORT_HALF; dx++) {
      for (let dz = -FORT_HALF; dz <= FORT_HALF; dz++) {
        const onWall = Math.abs(dx) === FORT_HALF || Math.abs(dz) === FORT_HALF
        if (!onWall) continue
        if (((dx + dz) & 1) === 0) put(cx + dx, baseY + height, cz + dz)
        if (Math.abs(dx) === FORT_HALF && Math.abs(dz) === FORT_HALF) {
          put(cx + dx, baseY + height, cz + dz)
          put(cx + dx, baseY + height + 1, cz + dz)
        }
        let fy = baseY - 1
        while (fy >= 0 && this.cellAt(cx + dx, fy, cz + dz) === EMPTY) {
          put(cx + dx, fy, cz + dz)
          fy--
        }
      }
    }

    const rubbleY = baseY + RUBBLE_MARGIN
    let count = 0
    for (let y = rubbleY; y < GY; y++) {
      for (let x = cx - FORT_HALF; x <= cx + FORT_HALF; x++) {
        for (let z = cz - FORT_HALF; z <= cz + FORT_HALF; z++) {
          if (this.cellAt(x, y, z) === cell) count++
        }
      }
    }
    // Snapshot each column's natural support depth (first solid under the
    // lowest fort voxel) so sinkUndermined only fires on real excavation.
    const side = 2 * FORT_HALF + 1
    const support: number[] = new Array(side * side).fill(-1)
    for (let dx = -FORT_HALF; dx <= FORT_HALF; dx++) {
      for (let dz = -FORT_HALF; dz <= FORT_HALF; dz++) {
        const x = cx + dx
        const z = cz + dz
        if (x < 0 || x >= GX || z < 0 || z >= GZ) continue
        let lowest = -1
        for (let y = 0; y < GY; y++) {
          if (this.grid[this.idx(x, y, z)] === cell) {
            lowest = y
            break
          }
        }
        if (lowest <= 0) continue
        let s = lowest - 1
        while (s >= 0 && this.grid[this.idx(x, s, z)] === EMPTY) s--
        support[(dx + FORT_HALF) * side + (dz + FORT_HALF)] = s
      }
    }
    fort.towers.push({ cx, cz, baseY, rubbleY, support })
    return count
  }

  // Fraction of the fort still standing above each tower's rubble line (0..1).
  integrity(side: number): number {
    const f = this.forts[side]
    if (!f) return 0
    let count = 0
    for (const t of f.towers) {
      for (let y = t.rubbleY; y < GY; y++) {
        for (let x = t.cx - FORT_HALF - 1; x <= t.cx + FORT_HALF + 1; x++) {
          for (let z = t.cz - FORT_HALF - 1; z <= t.cz + FORT_HALF + 1; z++) {
            if (this.cellAt(x, y, z) === f.cell) count++
          }
        }
      }
    }
    return Math.min(1, count / Math.max(1, f.origCount))
  }

  // Where the cannon rests: always on top of the castle — never down inside a
  // hollow shaft. Scans every tower the side owns; among columns within 2
  // voxels of the overall summit, prefers the one most central to its tower
  // (roof platform when intact, highest surviving wall after damage). Falls
  // back to the terrain at the main tower if nothing is standing.
  cannonSeat(side: number): Vec3 {
    const f = this.forts[side]
    const tops: { x: number; y: number; z: number; d: number }[] = []
    let maxY = -1
    for (const t of f.towers) {
      for (let dx = -FORT_HALF; dx <= FORT_HALF; dx++) {
        for (let dz = -FORT_HALF; dz <= FORT_HALF; dz++) {
          const x = t.cx + dx
          const z = t.cz + dz
          if (x < 0 || x >= GX || z < 0 || z >= GZ) continue
          for (let y = GY - 1; y >= 0; y--) {
            if (this.grid[this.idx(x, y, z)] !== f.cell) continue
            tops.push({ x, y, z, d: Math.abs(dx) + Math.abs(dz) })
            if (y > maxY) maxY = y
            break
          }
        }
      }
    }
    if (!tops.length) {
      const main = f.towers[0]
      return { x: main.cx, y: this.surfaceY(main.cx, main.cz) + 1, z: main.cz }
    }
    let best = tops[0]
    for (const t of tops) {
      if (t.y < maxY - 2) continue
      if (best.y < maxY - 2 || t.d < best.d || (t.d === best.d && t.y > best.y)) best = t
    }
    // Climb past anything piled on top (e.g. a dirt ball burying the platform).
    let sy = best.y + 1
    while (sy < GY && this.grid[this.idx(best.x, sy, best.z)] !== EMPTY) sy++
    return { x: best.x, y: sy, z: best.z }
  }

  // ---------------------------------------------------------------- destruction

  // terrainOnly = riot charges: they clear dirt but leave fort structure intact.
  carve(cx: number, cy: number, cz: number, r: number, terrainOnly = false): number {
    let removed = 0
    const ri = Math.ceil(r)
    const r2 = r * r
    const x0 = Math.max(0, Math.round(cx) - ri)
    const x1 = Math.min(GX - 1, Math.round(cx) + ri)
    const z0 = Math.max(0, Math.round(cz) - ri)
    const z1 = Math.min(GZ - 1, Math.round(cz) + ri)
    for (let y = Math.max(0, Math.round(cy) - ri); y <= Math.min(GY - 1, Math.round(cy) + ri); y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          const dx = x - cx
          const dy = y - cy
          const dz = z - cz
          if (dx * dx + dy * dy + dz * dz > r2) continue
          const i = this.idx(x, y, z)
          if (this.grid[i] === EMPTY) continue
          if (terrainOnly && this.grid[i] !== TERRAIN) continue
          this.grid[i] = EMPTY
          removed++
        }
      }
    }
    if (removed) {
      this.dirty = true
      // Water instantly re-levels: craters below the waterline flood back.
      if (this.waterY >= 0) {
        for (let z = z0; z <= z1; z++) {
          for (let x = x0; x <= x1; x++) this.refillColumn(x, z)
        }
      }
    }
    return removed
  }

  // Restore water in one column up to the water table (above the first solid).
  private refillColumn(x: number, z: number): void {
    let s = this.waterY
    while (s >= 0) {
      const c = this.grid[this.idx(x, s, z)]
      if (c !== EMPTY && c !== WATER) break
      s--
    }
    for (let y = s + 1; y <= this.waterY; y++) {
      this.grid[this.idx(x, y, z)] = WATER
    }
  }

  isWater(x: number, y: number, z: number): boolean {
    const rx = Math.round(x)
    const ry = Math.round(y)
    const rz = Math.round(z)
    if (!this.inBounds(rx, ry, rz)) return false
    return this.grid[this.idx(rx, ry, rz)] === WATER
  }

  // Is the top of this column open water? (Rollers sink, napalm fizzles.)
  isWaterTop(x: number, z: number): boolean {
    const sy = this.surfaceY(x, z)
    return sy >= 0 && this.cellAt(Math.round(x), sy, Math.round(z)) === WATER
  }

  addDirt(cx: number, cy: number, cz: number, r: number): void {
    const ri = Math.ceil(r)
    const r2 = r * r
    let added = 0
    for (let y = Math.max(0, Math.round(cy) - ri); y <= Math.min(GY - 3, Math.round(cy) + ri); y++) {
      for (let z = Math.max(0, Math.round(cz) - ri); z <= Math.min(GZ - 1, Math.round(cz) + ri); z++) {
        for (let x = Math.max(0, Math.round(cx) - ri); x <= Math.min(GX - 1, Math.round(cx) + ri); x++) {
          const dx = x - cx
          const dy = y - cy
          const dz = z - cz
          if (dx * dx + dy * dy + dz * dz > r2) continue
          const i = this.idx(x, y, z)
          if (this.grid[i] === EMPTY || this.grid[i] === WATER) {
            this.grid[i] = TERRAIN // dirt displaces water — fill in the lake
            added++
          }
        }
      }
    }
    if (added) this.dirty = true
  }

  // Blast shockwave: fort voxels around and above a crater get knocked loose and
  // topple as debris, so a hit brings down a whole section of wall rather than just
  // denting it. Reach and knock-loose odds are generous so towers crumble fast —
  // a solid hit gouges a tall bite out of a tower. Falloff by horizontal distance
  // and height above the blast.
  // `armor[side]` (default 1 each) scales that seat's shockwave resistance — a berm hardens
  // the whole fort against blasts, including plunging fire the line-of-sight shield can't stop.
  shockwave(cx: number, cy: number, cz: number, r: number, rand: () => number, armor: number[] = []): number {
    const hReach = r * 2.4 // wide horizontal bite — reaches across a tower
    const vReach = r * 3.5 // tall vertical bite — a hit gouges high up
    const vDown = r * 1.2 // and a little below, so mid hits detach the top
    const hr = Math.ceil(hReach)
    const vr = Math.ceil(vReach)
    let count = 0
    for (let y = Math.max(0, Math.round(cy - vDown)); y <= Math.min(GY - 1, Math.round(cy) + vr); y++) {
      const dy = y - cy
      for (let z = Math.max(0, Math.round(cz) - hr); z <= Math.min(GZ - 1, Math.round(cz) + hr); z++) {
        for (let x = Math.max(0, Math.round(cx) - hr); x <= Math.min(GX - 1, Math.round(cx) + hr); x++) {
          const i = this.idx(x, y, z)
          const c = this.grid[i]
          if (!isFortCell(c)) continue
          const h = Math.hypot(x - cx, z - cz)
          // Full strength near the blast (so the core punches clean through and
          // detaches whatever is above), falling off with distance and height.
          const armorS = armor[sideOfCell(c)] ?? 1
          const p = (1 - h / hReach) * (1 - (dy > 0 ? dy / vReach : -dy / (vDown + 1))) * armorS
          if (p <= 0 || rand() > p * 2.4) continue
          // A standing berm between the blast and this wall shields it (until breached).
          if (this.barricadeShields(cx, cy, cz, x, y, z)) continue
          this.grid[i] = EMPTY
          this.spawnDebris(x, y, z, c, rand, 1.5)
          count++
        }
      }
    }
    if (count) this.dirty = true
    return count
  }

  // Is there an intact berm on the straight line between a blast and a target cell?
  // If so, the target is shielded from the shockwave until the berm is breached.
  private barricadeShields(bx: number, by: number, bz: number, x: number, y: number, z: number): boolean {
    const steps = Math.ceil(Math.hypot(x - bx, y - by, z - bz))
    for (let s = 1; s < steps; s++) {
      const t = s / steps
      const sx = Math.round(bx + (x - bx) * t)
      const sy = Math.round(by + (y - by) * t)
      const sz = Math.round(bz + (z - bz) * t)
      if (this.cellAt(sx, sy, sz) === BARRICADE) return true
    }
    return false
  }

  // Find fort voxels no longer connected to the ground and turn them into falling debris.
  updateSupport(rand: () => number): number {
    const fortCells: number[] = []
    const supported = new Set<number>()
    const queue: number[] = []
    for (let y = 0; y < GY; y++) {
      const yOff = GX * GZ * y
      for (let z = 0; z < GZ; z++) {
        const zOff = yOff + GX * z
        for (let x = 0; x < GX; x++) {
          const i = x + zOff
          const c = this.grid[i]
          if (!isFortCell(c)) continue
          fortCells.push(i)
          // Rooted on ANY solid ground — terrain, water, a berm, or a producer bed.
          // (Castles may be placed anywhere now, so water/crops must count as footing
          // or a fort standing there shreds on the first support pass.)
          const below = y === 0 ? TERRAIN : this.grid[i - GX * GZ]
          if (y === 0 || (below !== EMPTY && !isFortCell(below))) {
            supported.add(i)
            queue.push(i)
          }
        }
      }
    }
    if (!fortCells.length) return 0

    const stride = GX * GZ
    while (queue.length) {
      const i = queue.pop()!
      const x = i % GX
      const z = Math.floor(i / GX) % GZ
      const y = Math.floor(i / stride)
      const neighbors = [
        x > 0 ? i - 1 : -1,
        x < GX - 1 ? i + 1 : -1,
        z > 0 ? i - GX : -1,
        z < GZ - 1 ? i + GX : -1,
        y > 0 ? i - stride : -1,
        y < GY - 1 ? i + stride : -1,
      ]
      for (const n of neighbors) {
        if (n < 0 || supported.has(n)) continue
        const c = this.grid[n]
        if (isFortCell(c)) {
          supported.add(n)
          queue.push(n)
        }
      }
    }

    let dislodged = 0
    for (const i of fortCells) {
      if (supported.has(i)) continue
      const cell = this.grid[i]
      this.grid[i] = EMPTY
      dislodged++
      this.spawnDebris(i % GX, Math.floor(i / stride), Math.floor(i / GX) % GZ, cell, rand, 0.6)
    }
    dislodged += this.sinkUndermined(rand)
    dislodged += this.toppleUnstable(rand)
    if (dislodged) this.dirty = true
    return dislodged
  }

  // Undermining: walls that lose their foundation crumble into the cavity.
  // A column collapses when the first solid cell beneath its lowest fort voxel
  // is now DEEPER than it was at build time — i.e. someone excavated under it.
  // The contiguous stack above breaks into debris and pours into the hole.
  private sinkUndermined(rand: () => number): number {
    const side = 2 * FORT_HALF + 1
    let dropped = 0
    for (const f of this.forts) {
      for (const t of f.towers) {
        for (let dx = -FORT_HALF; dx <= FORT_HALF; dx++) {
          for (let dz = -FORT_HALF; dz <= FORT_HALF; dz++) {
            const ref = t.support[(dx + FORT_HALF) * side + (dz + FORT_HALF)]
            if (ref < 0) continue
            const x = t.cx + dx
            const z = t.cz + dz
            if (x < 0 || x >= GX || z < 0 || z >= GZ) continue
            let lowest = -1
            for (let y = 0; y < GY; y++) {
              if (this.grid[this.idx(x, y, z)] === f.cell) {
                lowest = y
                break
              }
            }
            if (lowest <= 0) continue
            if (this.grid[this.idx(x, lowest - 1, z)] !== EMPTY) continue
            let solid = lowest - 1
            while (solid >= 0 && this.grid[this.idx(x, solid, z)] === EMPTY) solid--
            if (solid >= ref) continue
            for (let y = lowest; y < GY && this.grid[this.idx(x, y, z)] === f.cell; y++) {
              this.grid[this.idx(x, y, z)] = EMPTY
              this.spawnDebris(x, y, z, f.cell, rand, 0.35)
              dropped++
            }
          }
        }
      }
    }
    if (dropped) this.dirty = true
    return dropped
  }

  // A defeated fort crumbles straight DOWN to the ground (only a little spread), so
  // it collapses into a rubble pile rather than blowing apart — the explosion comes
  // afterwards, once it has fallen.
  collapseFort(side: number, rand: () => number): void {
    const f = this.forts[side]
    const stride = GX * GZ
    for (let y = 0; y < GY; y++) {
      for (let z = 0; z < GZ; z++) {
        for (let x = 0; x < GX; x++) {
          const i = x + GX * z + stride * y
          if (this.grid[i] !== f.cell) continue
          this.grid[i] = EMPTY
          this.spawnDebris(x, y, z, f.cell, rand, 0.9)
        }
      }
    }
    this.dirty = true
  }

  // The finale: blow the settled rubble pile up and out in a blast. Turns any fort
  // rubble (and loose terrain) near (cx,cz) back into debris flung skyward.
  burstRubble(cx: number, cz: number, r: number, rand: () => number): void {
    const ri = Math.ceil(r)
    for (let y = 0; y < GY; y++) {
      for (let z = Math.max(0, cz - ri); z <= Math.min(GZ - 1, cz + ri); z++) {
        for (let x = Math.max(0, cx - ri); x <= Math.min(GX - 1, cx + ri); x++) {
          const dx = x - cx
          const dz = z - cz
          if (dx * dx + dz * dz > r * r) continue
          const i = this.idx(x, y, z)
          const c = this.grid[i]
          if (!isFortCell(c) && c !== TERRAIN) continue
          if (this.debris.length >= MAX_DEBRIS) continue
          this.grid[i] = EMPTY
          const dist = Math.hypot(dx, dz) + 0.1
          this.debris.push({
            x, y, z,
            vx: (dx / dist) * (2 + rand() * 4),
            vy: 3 + rand() * 6,
            vz: (dz / dist) * (2 + rand() * 4),
            rx: 0, ry: 0, rz: 0,
            wx: (rand() - 0.5) * 7,
            wy: (rand() - 0.5) * 7,
            wz: (rand() - 0.5) * 7,
            cell: c,
          })
        }
      }
    }
    this.dirty = true
  }

  private spawnDebris(x: number, y: number, z: number, cell: number, rand: () => number, kick: number): void {
    if (this.debris.length >= MAX_DEBRIS) return
    this.debris.push({
      x, y, z,
      vx: (rand() - 0.5) * 2 * kick,
      vy: rand() * 1.5,
      vz: (rand() - 0.5) * 2 * kick,
      rx: 0, ry: 0, rz: 0,
      wx: (rand() - 0.5) * 4,
      wy: (rand() - 0.5) * 4,
      wz: (rand() - 0.5) * 4,
      cell,
    })
  }

  // A brick flung as part of a tower TOPPLING: it swings out in the fall direction
  // with a speed that grows with its height above the pivot (so the top whips over
  // fastest, like a felled tree), tumbling about the horizontal axis it rolls over.
  private spawnDebrisTopple(x: number, y: number, z: number, cell: number, rand: () => number, dirx: number, dirz: number, hAbove: number): void {
    if (this.debris.length >= MAX_DEBRIS) return
    const lat = 0.7 + hAbove * 0.34 // higher up → farther out
    const spin = 1.3 + hAbove * 0.13
    this.debris.push({
      x, y, z,
      vx: dirx * lat + (rand() - 0.5) * 0.7,
      vy: rand() * 0.6,
      vz: dirz * lat + (rand() - 0.5) * 0.7,
      rx: 0, ry: 0, rz: 0,
      // rotate about the horizontal axis perpendicular to the fall direction.
      wx: dirz * spin + (rand() - 0.5) * 1.2,
      wy: (rand() - 0.5) * 1.2,
      wz: -dirx * spin + (rand() - 0.5) * 1.2,
      cell,
    })
  }

  // Gravity/toppling: a standing tower whose remaining mass leans past its footing,
  // or that has been whittled to a thin tall stump, tips over as a whole — every
  // brick flung in the lean direction and tumbling — instead of hovering upright.
  private toppleUnstable(rand: () => number): number {
    let toppled = 0
    for (const f of this.forts) {
      for (const t of f.towers) {
        const cells: { x: number; y: number; z: number; i: number }[] = []
        let sumX = 0
        let sumZ = 0
        let minY = GY
        let maxY = -1
        let baseSumX = 0
        let baseSumZ = 0
        const baseCols: { x: number; z: number }[] = []
        for (let y = 0; y < GY; y++) {
          for (let dx = -FORT_HALF - 1; dx <= FORT_HALF + 1; dx++) {
            for (let dz = -FORT_HALF - 1; dz <= FORT_HALF + 1; dz++) {
              const x = t.cx + dx
              const z = t.cz + dz
              if (!this.inBounds(x, y, z)) continue
              const i = this.idx(x, y, z)
              if (this.grid[i] !== f.cell) continue
              cells.push({ x, y, z, i })
              sumX += x
              sumZ += z
              if (y < minY) minY = y
              if (y > maxY) maxY = y
              // Footing = any solid ground (terrain, water, berm, producer bed) —
              // matches updateSupport's rooting rule for castles placed anywhere.
              const below = y === 0 ? TERRAIN : this.grid[this.idx(x, y - 1, z)]
              if (below !== EMPTY && !isFortCell(below)) {
                baseSumX += x
                baseSumZ += z
                baseCols.push({ x, z })
              }
            }
          }
        }
        if (cells.length < 6 || baseCols.length === 0) continue
        const n = cells.length
        const comX = sumX / n
        const comZ = sumZ / n
        const baseX = baseSumX / baseCols.length
        const baseZ = baseSumZ / baseCols.length
        let baseR = 0
        for (const b of baseCols) baseR = Math.max(baseR, Math.hypot(b.x - baseX, b.z - baseZ))
        const lean = Math.hypot(comX - baseX, comZ - baseZ)
        const height = maxY - minY
        // Unstable if the centre of mass overhangs the footing, or the standing
        // remnant is a thin, tall stump with barely any base.
        const unstable = lean > baseR * 0.55 + 1.0 || (baseCols.length <= 5 && height > baseR * 2.5 + 7)
        if (!unstable) continue
        // Fall the way it already leans; a perfectly balanced spike picks a random way.
        let dirx = comX - baseX
        let dirz = comZ - baseZ
        let dl = Math.hypot(dirx, dirz)
        if (dl < 0.5) {
          const a = rand() * Math.PI * 2
          dirx = Math.cos(a)
          dirz = Math.sin(a)
          dl = 1
        }
        dirx /= dl
        dirz /= dl
        for (const c of cells) {
          this.grid[c.i] = EMPTY
          this.spawnDebrisTopple(c.x, c.y, c.z, f.cell, rand, dirx, dirz, c.y - minY)
          toppled++
        }
      }
    }
    if (toppled) this.dirty = true
    return toppled
  }

  // Advance falling debris; returns number still airborne.
  stepDebris(dt: number): number {
    const list = this.debris
    for (let n = list.length - 1; n >= 0; n--) {
      const d = list[n]
      d.vy -= GRAVITY * dt
      d.x += d.vx * dt
      d.y += d.vy * dt
      d.z += d.vz * dt
      d.rx += d.wx * dt
      d.ry += d.wy * dt
      d.rz += d.wz * dt
      const rx = Math.round(d.x)
      const rz = Math.round(d.z)
      if (d.y < -6 || rx < 0 || rx >= GX || rz < 0 || rz >= GZ) {
        list.splice(n, 1)
        continue
      }
      const below = Math.floor(d.y - 0.5)
      const bc = below < 0 ? TERRAIN : this.cellAt(rx, below, rz)
      // Debris falls straight through water and settles on the lakebed.
      if (d.vy <= 0 && (below < 0 || (bc !== EMPTY && bc !== WATER))) {
        let sy = Math.max(0, below + 1)
        while (sy < GY && this.cellAt(rx, sy, rz) !== EMPTY && this.cellAt(rx, sy, rz) !== WATER) sy++
        if (sy < GY) {
          this.grid[this.idx(rx, sy, rz)] = d.cell
          this.dirty = true
        }
        list.splice(n, 1)
      }
    }
    return list.length
  }

  renderDebris(): void {
    const m = this.tmpM
    const col = this.tmpC
    for (let n = 0; n < this.debris.length; n++) {
      const d = this.debris[n]
      this.tmpE.set(d.rx, d.ry, d.rz)
      this.tmpQ.setFromEuler(this.tmpE)
      this.tmpP.set(d.x, d.y, d.z)
      m.compose(this.tmpP, this.tmpQ, this.tmpS)
      this.debrisMesh.setMatrixAt(n, m)
      if (isFortCell(d.cell)) fortColorRGB(sideOfCell(d.cell), 0.5, col)
      else col.setRGB(0.93, 0.93, 0.94)
      this.debrisMesh.setColorAt(n, col)
    }
    this.debrisMesh.count = this.debris.length
    this.debrisMesh.instanceMatrix.needsUpdate = true
    if (this.debrisMesh.instanceColor) this.debrisMesh.instanceColor.needsUpdate = true
  }

  // ---------------------------------------------------------------- rendering

  rebuild(): void {
    this.dirty = false
    const m = this.tmpM
    const col = this.tmpC
    const stride = GX * GZ
    let i = 0
    for (let y = 0; y < GY && i < MAX_INSTANCES; y++) {
      for (let z = 0; z < GZ && i < MAX_INSTANCES; z++) {
        const zOff = stride * y + GX * z
        for (let x = 0; x < GX && i < MAX_INSTANCES; x++) {
          const c = this.grid[x + zOff]
          if (c === EMPTY) continue
          // Ghost Tower: skip rendering the hidden side's fort voxels (still solid).
          if (this.hiddenForts[sideOfCell(c)]) continue
          const boundary = x === 0 || x === GX - 1 || z === 0 || z === GZ - 1
          const exposed = boundary ||
            y === GY - 1 ||
            this.grid[x + zOff + 1] === EMPTY ||
            this.grid[x + zOff - 1] === EMPTY ||
            this.grid[x + zOff + GX] === EMPTY ||
            this.grid[x + zOff - GX] === EMPTY ||
            this.grid[x + zOff + stride] === EMPTY ||
            (y > 0 && this.grid[x + zOff - stride] === EMPTY)
          if (!exposed) continue
          m.makeTranslation(x, y, z)
          this.mesh.setMatrixAt(i, m)
          const h = cellHash(x + this.colorSeed, y, z)
          if (c === WATER) {
            // Solid light blue, flat — matches the flow-line overlay.
            col.setRGB(0.49, 0.77, 0.92)
          } else if (c === TERRAIN) {
            const v = 0.86 + 0.09 * (y / 28) + h * 0.04
            col.setRGB(Math.min(1, v), Math.min(1, v + 0.005), Math.min(1, v + 0.015))
          } else if (isFortCell(c)) {
            // Castle, tinted by which player owns it (red / blue / green / gold).
            fortColorRGB(sideOfCell(c), h, col)
          } else if (c === BARRICADE) {
            // Sandbag berm: earthy tan.
            const v = 0.62 + h * 0.08
            col.setRGB(Math.min(1, v + 0.14), v * 0.92, v * 0.66)
          } else if ((c === CROP || c === MINE || c === DERRICK) && this.raidedCells && this.raidedCells.has(x + zOff)) {
            // Army-raided producers glow pink until the victim's turn is over.
            const v = 0.82 + h * 0.08
            col.setRGB(Math.min(1, v + 0.18), v * 0.62, v * 0.74)
          } else if (c === CROP) {
            // Crop bed: lush green with a little variation.
            const v = 0.5 + h * 0.12
            col.setRGB(v * 0.55, Math.min(1, v + 0.18), v * 0.42)
          } else if (c === MINE) {
            // Ore mine: dark slate gray with a faint metallic glint.
            const v = 0.34 + h * 0.1
            col.setRGB(v, v * 1.02, v * 1.08)
          } else if (c === DERRICK) {
            // Oil derrick: near-black industrial with a warm-brown cast.
            const v = 0.2 + h * 0.08
            col.setRGB(v * 1.15, v * 0.95, v * 0.8)
          } else if (c === PLANT) {
            // Nuclear Power Plant: pale concrete with a sickly radioactive-green glow.
            const v = 0.55 + h * 0.12
            col.setRGB(v * 0.72, Math.min(1, v + 0.22), v * 0.5)
          } else {
            // Fallback (all known cells are handled above).
            const v = 0.7 + h * 0.1
            col.setRGB(v, v, v)
          }
          this.mesh.setColorAt(i, col)
          i++
        }
      }
    }
    this.mesh.count = i
    this.mesh.instanceMatrix.needsUpdate = true
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
    this.buildWaterOverlay()
  }

  // Merged quads floating just above every open-water cell, textured with the
  // scrolling white flow-dashes.
  private buildWaterOverlay(): void {
    if (this.waterMesh) {
      this.scene.remove(this.waterMesh)
      this.waterMesh.geometry.dispose()
      this.waterMesh = null
    }
    if (this.waterY < 0) return
    const pos: number[] = []
    const uvs: number[] = []
    const indices: number[] = []
    const yTop = this.waterY + 0.52
    const s = 0.055 // world units → texture repeat scale
    for (let x = 0; x < GX; x++) {
      for (let z = 0; z < GZ; z++) {
        if (this.cellAt(x, this.waterY, z) !== WATER) continue
        if (this.cellAt(x, this.waterY + 1, z) !== EMPTY) continue
        const n = pos.length / 3
        pos.push(x - 0.5, yTop, z - 0.5, x + 0.5, yTop, z - 0.5, x + 0.5, yTop, z + 0.5, x - 0.5, yTop, z + 0.5)
        uvs.push(x * s, z * s, (x + 1) * s, z * s, (x + 1) * s, (z + 1) * s, x * s, (z + 1) * s)
        indices.push(n, n + 2, n + 1, n, n + 3, n + 2)
      }
    }
    if (!pos.length) return
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    g.setIndex(indices)
    this.waterMesh = new THREE.Mesh(g, this.waterMat)
    this.waterMesh.frustumCulled = false
    this.scene.add(this.waterMesh)
  }

  // ---------------------------------------------------------------- ballistics

  // Shared trajectory integrator: the AI and the aim-hint both use exactly the
  // physics the live projectile uses (GRAVITY + WIND_ACCEL), step 1/120 s.
  simShot(origin: Vec3, vel: Vec3, wind: Wind, path?: Vec3[]): ShotResult {
    const h = 1 / 120
    let { x, y, z } = origin
    let { x: vx, y: vy, z: vz } = vel
    let t = 0
    let step = 0
    while (t < 16) {
      vy -= GRAVITY * h
      vx += wind.x * WIND_ACCEL * h
      vz += wind.z * WIND_ACCEL * h
      const nx = x + vx * h
      const ny = y + vy * h
      const nz = z + vz * h
      if (this.isSolid(nx, ny, nz)) {
        if (path) path.push({ x, y, z })
        return { hit: true, pos: { x, y, z }, t }
      }
      x = nx; y = ny; z = nz
      t += h
      step++
      if (path && step % 6 === 0) path.push({ x, y, z })
      if (y < -10 || x < -40 || x > GX + 40 || z < -40 || z > GZ + 40) break
    }
    return { hit: false, pos: { x, y, z }, t }
  }

  // Best downhill step for rollers/napalm: lowest neighbouring column, or null at a local minimum.
  downhill(x: number, z: number): { x: number; z: number; y: number } | null {
    const cy = this.surfaceY(x, z)
    let best: { x: number; z: number; y: number } | null = null
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (!dx && !dz) continue
        const nx = Math.round(x) + dx
        const nz = Math.round(z) + dz
        if (nx < 0 || nx >= GX || nz < 0 || nz >= GZ) continue
        const ny = this.surfaceY(nx, nz)
        if (ny >= 0 && ny < cy && (!best || ny < best.y)) best = { x: nx, z: nz, y: ny }
      }
    }
    return best
  }
}
