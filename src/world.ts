// Scorched Earth 3D — voxel world: terrain generation, forts, destruction, debris physics.
// Standalone from the voxel-builder app; shares nothing but the three.js dependency.
import * as THREE from 'three'

export const GX = 160
export const GY = 96
export const GZ = 72
export const GRAVITY = 28
export const WIND_ACCEL = 0.45 // projectile acceleration per unit of wind speed

export const EMPTY = 0
export const TERRAIN = 1
export const FORT_A = 2 // player fort voxel
export const FORT_B = 3 // enemy fort voxel
export const WATER = 4 // lakes & rivers — solid light blue, stylized
export const CITY = 5 // ruined city buildings between the forts — night scavenging ground

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
}

// Purchasable, match-persistent structure upgrades per side.
export type Fortifications = { height: number; towers: number }

export type ShotResult = { hit: boolean; pos: Vec3; t: number }

const FORT_HALF = 4 // 9x9 footprint
const FORT_HEIGHT = 17

export class World {
  grid: Uint8Array
  forts: FortInfo[] = []
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

  // The stylized water surface is unlit, so it must be dimmed manually as
  // night falls (blend 0 = day, 1 = night).
  setNightBlend(b: number): void {
    const v = 1 - b * 0.75
    this.waterMat.color.setRGB(v, v, v + b * 0.06)
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

  generate(seed: number, forti: Fortifications[] = [{ height: 0, towers: 0 }, { height: 0, towers: 0 }]): void {
    this.grid.fill(EMPTY)
    this.debris.length = 0
    this.debrisMesh.count = 0
    this.forts = []
    this.colorSeed = seed & 0xffff
    const rand = mulberry32(seed)

    // Fort separation varies per battle: sometimes close-quarters, sometimes long-range.
    const cxA = Math.round(12 + rand() * 20)
    const cxB = Math.round(GX - 13 - rand() * 20)
    const czA = Math.round(GZ / 2 + (rand() - 0.5) * 18)
    const czB = Math.round(GZ / 2 + (rand() - 0.5) * 18)

    const nseed = Math.floor(rand() * 100000)
    // Per-match character: rolling plains, jagged peaks, ridged badlands, or
    // terraced mesa plateaus — with extremely tall relief and a water table
    // that turns basins into lakes and river valleys into rivers.
    const amp = 20 + rand() * 44
    const sharp = 1.1 + rand() * 1.1 // exponent >1 exaggerates peaks vs valleys
    const ridged = rand() < 0.3
    const plateau = rand() < 0.35
    const plateauLevels = 3 + Math.floor(rand() * 3)
    const waterY = Math.round(5 + rand() * 8)
    const hasRiver = rand() < 0.75
    const riverSlant = (rand() - 0.5) * 0.5
    const riverWidth = 5 + rand() * 7
    const riverBed = waterY - 3 // channel floor always below the water table
    // Fort elevations roll independently — and 40% of matches force real drama:
    // one fort high on a mountain, the other down in a valley.
    let padA: number
    let padB: number
    if (rand() < 0.4) {
      const high = 24 + rand() * 16
      const low = 5 + rand() * 7
      if (rand() < 0.5) {
        padA = high
        padB = low
      } else {
        padA = low
        padB = high
      }
    } else {
      padA = 6 + rand() * 30
      padB = 6 + rand() * 30
    }
    // Castles always stand clear of the water.
    padA = Math.max(padA, waterY + 3)
    padB = Math.max(padB, waterY + 3)

    // Tower sites per side: the main tower plus any purchased extras, spread in z.
    const towerSites = (cx: number, cz: number, extra: number, dir: number): { cx: number; cz: number }[] => {
      const sites = [{ cx, cz }]
      if (extra >= 1) sites.push({ cx: cx + dir * 3, cz: Math.min(GZ - 8, cz + 13) })
      if (extra >= 2) sites.push({ cx: cx + dir * 3, cz: Math.max(7, cz - 13) })
      return sites
    }
    const sitesA = towerSites(cxA, czA, forti[0].towers, 1)
    const sitesB = towerSites(cxB, czB, forti[1].towers, -1)

    const pads = [
      ...sitesA.map(s => ({ ...s, pad: padA })),
      ...sitesB.map(s => ({ ...s, pad: padB })),
    ]
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

    // Build each side's towers; only the main tower gets the height upgrade.
    for (let side = 0; side < 2; side++) {
      const cell = side === 0 ? FORT_A : FORT_B
      const sites = side === 0 ? sitesA : sitesB
      const fort: FortInfo = { cell, towers: [], origCount: 0 }
      for (let ti = 0; ti < sites.length; ti++) {
        const extraH = ti === 0 ? forti[side].height : 0
        fort.origCount += this.buildTower(fort, sites[ti].cx, sites[ti].cz, cell, extraH)
      }
      this.forts.push(fort)
    }

    // Ruined city in the lowlands between the forts: hollow gray shells with
    // doorways and window holes. Night-phase scavenging ground; daytime cover
    // that artillery can level.
    const cityX0 = Math.min(cxA, cxB) + 20
    const cityX1 = Math.max(cxA, cxB) - 20
    const ruins: { x: number; z: number; r: number }[] = []
    const ruinTarget = 10 + Math.floor(rand() * 6)
    for (let attempt = 0; attempt < 70 && ruins.length < ruinTarget; attempt++) {
      const w = 2 + Math.floor(rand() * 3) // half-extents: footprint 5..9
      const d = 2 + Math.floor(rand() * 3)
      const hgt = 5 + Math.floor(rand() * 10)
      const bx = Math.round(cityX0 + rand() * (cityX1 - cityX0))
      const bz = Math.round(6 + rand() * (GZ - 12))
      const r = Math.max(w, d) + 3
      if (ruins.some(p => Math.hypot(p.x - bx, p.z - bz) < p.r + r)) continue
      // Survey the footprint: skip water and steep slopes.
      let gmin = GY
      let gmax = -1
      let bad = false
      for (let x = bx - w; x <= bx + w && !bad; x++) {
        for (let z = bz - d; z <= bz + d && !bad; z++) {
          if (x < 1 || x >= GX - 1 || z < 1 || z >= GZ - 1) {
            bad = true
            break
          }
          const sy = this.surfaceY(x, z)
          if (this.cellAt(x, sy, z) === WATER) {
            bad = true
            break
          }
          gmin = Math.min(gmin, sy)
          gmax = Math.max(gmax, sy)
        }
      }
      if (bad || gmax - gmin > 5) continue
      this.buildRuin(bx, bz, w, d, hgt, gmax, rand)
      ruins.push({ x: bx, z: bz, r })
    }

    this.rebuild()
  }

  // One hollow building shell: perimeter walls with a doorway and window
  // holes, flat roof, walls rooted down to the terrain.
  private buildRuin(bx: number, bz: number, hw: number, hd: number, hgt: number, groundTop: number, rand: () => number): void {
    const floorY = groundTop + 1
    const doorSide = Math.floor(rand() * 4) // 0:+x 1:-x 2:+z 3:-z
    const put = (x: number, y: number, z: number) => {
      if (this.inBounds(x, y, z) && this.grid[this.idx(x, y, z)] === EMPTY) this.grid[this.idx(x, y, z)] = CITY
    }
    for (let dx = -hw; dx <= hw; dx++) {
      for (let dz = -hd; dz <= hd; dz++) {
        const onWall = Math.abs(dx) === hw || Math.abs(dz) === hd
        const x = bx + dx
        const z = bz + dz
        for (let dy = 0; dy < hgt; dy++) {
          const y = floorY + dy
          if (y >= GY) break
          const isRoof = dy === hgt - 1
          if (!onWall && !isRoof) continue
          if (onWall && !isRoof) {
            // Doorway: 2 wide, 3 tall, on the chosen side.
            const inDoor =
              dy <= 2 &&
              ((doorSide === 0 && dx === hw && Math.abs(dz) <= 1) ||
                (doorSide === 1 && dx === -hw && Math.abs(dz) <= 1) ||
                (doorSide === 2 && dz === hd && Math.abs(dx) <= 1) ||
                (doorSide === 3 && dz === -hd && Math.abs(dx) <= 1))
            if (inDoor) continue
            // Window holes on upper floors.
            if (dy > 2 && dy % 3 === 1 && ((dx + dz) & 1) === 0) continue
          }
          put(x, y, z)
        }
        // Root walls to the terrain so buildings hug slopes.
        if (onWall) {
          let fy = floorY - 1
          while (fy >= 0 && this.cellAt(x, fy, z) === EMPTY) {
            put(x, fy, z)
            fy--
          }
        }
      }
    }
  }

  // Build one tower; returns the voxel count above its rubble line.
  private buildTower(fort: FortInfo, cx: number, cz: number, cell: number, extraH: number): number {
    const baseY = this.surfaceY(cx, cz) + 1
    const height = FORT_HEIGHT + extraH
    const facing = cell === FORT_A ? 1 : -1 // door faces the enemy
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

  // Blast shockwave: fort voxels above and around a crater get knocked loose and
  // topple as debris, so a hit at a wall's base brings the wall down rather than
  // just denting the terrain. Falloff by horizontal distance and height above the
  // blast; reaches ~2.4x the crater radius upward.
  shockwave(cx: number, cy: number, cz: number, r: number, rand: () => number): number {
    const hr = Math.ceil(r)
    const vr = Math.ceil(r * 2.4)
    let count = 0
    for (let y = Math.max(0, Math.round(cy)); y <= Math.min(GY - 1, Math.round(cy) + vr); y++) {
      const dy = y - cy
      for (let z = Math.max(0, Math.round(cz) - hr); z <= Math.min(GZ - 1, Math.round(cz) + hr); z++) {
        for (let x = Math.max(0, Math.round(cx) - hr); x <= Math.min(GX - 1, Math.round(cx) + hr); x++) {
          const i = this.idx(x, y, z)
          const c = this.grid[i]
          if (c !== FORT_A && c !== FORT_B) continue
          const h = Math.hypot(x - cx, z - cz)
          const p = (1 - h / r) * (1 - dy / (r * 2.4))
          if (p <= 0 || rand() > p * 1.1) continue
          this.grid[i] = EMPTY
          this.spawnDebris(x, y, z, c, rand, 1.2)
          count++
        }
      }
    }
    if (count) this.dirty = true
    return count
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
          if (c !== FORT_A && c !== FORT_B) continue
          fortCells.push(i)
          const below = y === 0 ? TERRAIN : this.grid[i - GX * GZ]
          if (y === 0 || below === TERRAIN) {
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
        if (c === FORT_A || c === FORT_B) {
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

  // Dramatic full collapse of a defeated fort.
  collapseFort(side: number, rand: () => number): void {
    const f = this.forts[side]
    const stride = GX * GZ
    for (let y = 0; y < GY; y++) {
      for (let z = 0; z < GZ; z++) {
        for (let x = 0; x < GX; x++) {
          const i = x + GX * z + stride * y
          if (this.grid[i] !== f.cell) continue
          this.grid[i] = EMPTY
          this.spawnDebris(x, y, z, f.cell, rand, 2.2)
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
      if (d.cell === FORT_A) col.setRGB(0.99, 0.84, 0.8)
      else if (d.cell === FORT_B) col.setRGB(0.8, 0.87, 0.99)
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
          } else if (c === CITY) {
            // Ruined buildings: concrete gray against the white terrain.
            const v = 0.48 + h * 0.08
            col.setRGB(v, v + 0.01, v + 0.03)
          } else if (c === TERRAIN) {
            const v = 0.86 + 0.09 * (y / 28) + h * 0.04
            col.setRGB(Math.min(1, v), Math.min(1, v + 0.005), Math.min(1, v + 0.015))
          } else if (c === FORT_A) {
            // Player castle: light red.
            const v = 0.92 + h * 0.05
            col.setRGB(Math.min(1, v + 0.06), v * 0.86, v * 0.82)
          } else {
            // Enemy castle: light blue.
            const v = 0.92 + h * 0.05
            col.setRGB(v * 0.82, v * 0.89, Math.min(1, v + 0.06))
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
