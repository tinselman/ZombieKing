// Zombie King — the village: a ring of 12 Victorian buildings around a glowing
// cemetery, on an island between the two towers. Built from quarter-scale
// voxels (4 per world unit) for architectural detail. Building identities are
// hidden and shuffled every round; interiors are pitch black until someone
// steps inside, then the lights come on for good and the name is revealed.
import * as THREE from 'three'
import { mulberry32 } from './world'

export const FINE = 4 // fine voxels per world unit
const F = FINE

export const BUILDING_NAMES = [
  'Cathedral',
  'Theater',
  'Library',
  'Hospital',
  'Mausoleum',
  'Conservatory',
  'Apothecary',
  'Laboratory',
  'Doll Shop',
  'The Hotel',
  'Mansion',
  'Munitions Store',
]

// Tints (indices into the per-cell tint array).
const T_WALL = 1
const T_TRIM = 2
const T_ROOF = 3
const T_FLOOR = 4
const T_FENCE = 5
const T_GRAVE = 6

// Muted Victorian exterior palette — colors are shuffled independently of
// identities, so paint tells you nothing about what's inside.
const PALETTE = [0x8f9bb0, 0xb8a08e, 0xa8b09a, 0xb09aa5, 0x9ab0ae, 0xb0ab8f, 0x9f96b3, 0xb39a96, 0x96a7b3, 0xb3a696, 0xa2b396, 0x8fa3b0]

// Board-game pastels for revealed room floors.
const PASTELS = [0xf9c6d0, 0xfde9a8, 0xbfe3f2, 0xcfc4ec, 0xc9ecc4, 0xfad2b0, 0xa8d8e8, 0xf7f3b5, 0xd9f2e6, 0xf2d9ee, 0xdce9f9, 0xffe0c2]

export type Building = {
  id: number
  name: string // secret until revealed
  x0: number
  z0: number
  x1: number
  z1: number // interior world-unit bounds (absolute), walls inclusive
  doorX: number
  doorZ: number // world cell just outside the door
  cx: number
  cz: number
  revealed: boolean
  light: THREE.PointLight | null
  color: number
  pastel: number // revealed floor color
}

const MAX_FINE = 260000

export class Village {
  ox = 0 // world-space min corner
  oz = 0
  baseY = 0 // island ground level (top solid voxel y)
  sx = 48 // footprint in world units — condensed, board-game tight
  sz = 40
  sy = 13 // vertical extent covered by the fine grid
  buildings: Building[] = []
  cemetery = { x0: 0, z0: 0, x1: 0, z1: 0 }
  private solid!: Uint8Array // fine occupancy
  private tint!: Uint8Array // fine tint index
  private owner!: Uint8Array // building id + 1 (0 = none)
  private mesh: THREE.InstancedMesh
  private glow: THREE.Mesh | null = null
  private glowLight: THREE.PointLight
  private scene: THREE.Scene
  private tmpM = new THREE.Matrix4()
  private tmpC = new THREE.Color()

  constructor(scene: THREE.Scene) {
    this.scene = scene
    const geo = new THREE.BoxGeometry(1 / F, 1 / F, 1 / F)
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff })
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX_FINE)
    this.mesh.castShadow = true
    this.mesh.receiveShadow = true
    this.mesh.frustumCulled = false
    this.mesh.count = 0
    scene.add(this.mesh)
    // The cemetery's sickly green glow (bright at night).
    this.glowLight = new THREE.PointLight(0x51e87c, 0, 13, 1.8)
    scene.add(this.glowLight)
  }

  private fx(): number {
    return this.sx * F
  }
  private fy(): number {
    return this.sy * F
  }
  private fz(): number {
    return this.sz * F
  }
  private fidx(x: number, y: number, z: number): number {
    return x + this.fx() * (z + this.fz() * y)
  }
  private inFine(x: number, y: number, z: number): boolean {
    return x >= 0 && x < this.fx() && y >= 0 && y < this.fy() && z >= 0 && z < this.fz()
  }

  private put(x: number, y: number, z: number, tint: number, owner: number): void {
    if (!this.inFine(x, y, z)) return
    const i = this.fidx(x, y, z)
    this.solid[i] = 1
    this.tint[i] = tint
    this.owner[i] = owner
  }

  // ---------------------------------------------------------------- generation

  // Build the village onto a prepared flat island. ox/oz/baseY locate it in
  // the world; identities and layout reshuffle from the seed.
  generate(ox: number, oz: number, baseY: number, seed: number): void {
    this.ox = ox
    this.oz = oz
    this.baseY = baseY
    this.solid = new Uint8Array(this.fx() * this.fy() * this.fz())
    this.tint = new Uint8Array(this.solid.length)
    this.owner = new Uint8Array(this.solid.length)
    this.buildings = []
    this.towerHeights.clear()
    for (const b of this.buildingLights) this.scene.remove(b)
    this.buildingLights.length = 0
    for (const s of this.nameSprites) {
      this.scene.remove(s)
      ;(s.material.map as THREE.CanvasTexture | null)?.dispose()
      s.material.dispose()
    }
    this.nameSprites.length = 0

    const rand = mulberry32(seed ^ 0x9e3779b9)

    // Cemetery dead center.
    const ccx = this.sx / 2
    const ccz = this.sz / 2
    this.cemetery = { x0: this.ox + ccx - 5, z0: this.oz + ccz - 4, x1: this.ox + ccx + 5, z1: this.oz + ccz + 4 }
    this.buildCemetery(Math.round(ccx), Math.round(ccz), rand)

    // Shuffle names, paint and floor pastels independently — nothing on the
    // outside hints at what a building is.
    const names = [...BUILDING_NAMES]
    const paints = [...PALETTE]
    const pastels = [...PASTELS]
    for (let i = names.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      ;[names[i], names[j]] = [names[j], names[i]]
      const k = Math.floor(rand() * (i + 1))
      ;[paints[i], paints[k]] = [paints[k], paints[i]]
      const p = Math.floor(rand() * (i + 1))
      ;[pastels[i], pastels[p]] = [pastels[p], pastels[i]]
    }

    // Twelve buildings, board-style: one anchoring each CORNER of the ring,
    // plus an adjacent pair (shared wall, connecting doorway) mid-way along
    // every side. Corners filled, lanes tight, doors inward.
    const inset = 7
    let id = 0
    const spec = () => ({
      w: 7 + Math.floor(rand() * 2),
      d: 6 + Math.floor(rand() * 2),
      h: 4 + Math.floor(rand() * 2),
      twoStory: rand() < 0.45,
    })
    // Corner buildings — the door faces inward along one of the two axes.
    const cornersDef = [
      { x: inset + 1, z: inset, angs: [Math.PI, -Math.PI / 2] }, // NW: door east or south
      { x: this.sx - inset - 1, z: inset, angs: [0, -Math.PI / 2] }, // NE: door west or south
      { x: inset + 1, z: this.sz - inset, angs: [Math.PI, Math.PI / 2] }, // SW: door east or north
      { x: this.sx - inset - 1, z: this.sz - inset, angs: [0, Math.PI / 2] }, // SE: door west or north
    ]
    for (const c of cornersDef) {
      const s = spec()
      this.buildHouse(id, names[id], paints[id], pastels[id], Math.round(c.x), Math.round(c.z), s.w, s.d, s.h, c.angs[Math.floor(rand() * 2)], s.twoStory, rand)
      id++
    }
    // Mid-side adjacent pairs.
    for (let side = 0; side < 4; side++) {
      const horizontal = side < 2
      const rowLen = horizontal ? this.sx : this.sz
      const fixed = side === 0 ? inset : side === 1 ? this.sz - inset : side === 2 ? inset : this.sx - inset
      const ang = side === 0 ? -Math.PI / 2 : side === 1 ? Math.PI / 2 : side === 2 ? Math.PI : 0
      const s1 = spec()
      const s2 = spec()
      const halfAlong = (s: { w: number; d: number }) => (horizontal ? s.w : s.d) / 2
      const bC = Math.round(rowLen * 0.5 - halfAlong(s1) + (rand() - 0.5) * 2)
      const cC = Math.round(bC + halfAlong(s1) + halfAlong(s2)) // shares the wall
      const ids: number[] = []
      for (const [s, along] of [
        [s1, bC],
        [s2, cC],
      ] as const) {
        const bx = horizontal ? along : fixed
        const bz = horizontal ? fixed : along
        this.buildHouse(id, names[id], paints[id], pastels[id], bx, bz, s.w, s.d, s.h, ang, s.twoStory, rand)
        ids.push(id)
        id++
      }
      this.connectPair(ids[0], ids[1], horizontal)
    }

    this.rebuild()
    // Cemetery glow anchor.
    this.glowLight.position.set(this.ox + ccx, baseY + 3, this.oz + ccz)
  }

  // Doorway through the shared wall of two adjacent buildings — ground level
  // always; plus an upper doorway onto the neighbor's roof if one is taller.
  private connectPair(idA: number, idB: number, horizontal: boolean): void {
    const A = this.buildings[idA]
    const B = this.buildings[idB]
    if (!A || !B) return
    // Shared plane sits between the two centers, along the row axis.
    const planeLo = horizontal ? Math.round(((A.x1 - this.ox) * F + (B.x0 - this.ox) * F) / 2) - 2 : Math.round(((A.z1 - this.oz) * F + (B.z0 - this.oz) * F) / 2) - 2
    // Lateral overlap of the two interiors (the other axis).
    const aLo = horizontal ? (A.z0 - this.oz) * F : (A.x0 - this.ox) * F
    const aHi = horizontal ? (A.z1 - this.oz) * F : (A.x1 - this.ox) * F
    const bLo = horizontal ? (B.z0 - this.oz) * F : (B.x0 - this.ox) * F
    const bHi = horizontal ? (B.z1 - this.oz) * F : (B.x1 - this.ox) * F
    const lo = Math.max(aLo, bLo) + 3
    const hi = Math.min(aHi, bHi) - 3
    if (hi - lo < 8) return
    const mid = Math.round((lo + hi) / 2)
    // Ground doorway: clear both wall layers, 9 fine wide, 9 tall.
    for (let p = planeLo; p <= planeLo + 4; p++) {
      for (let lat = mid - 4; lat <= mid + 4; lat++) {
        for (let fy = 0; fy < 9; fy++) {
          const x = horizontal ? p : lat
          const z = horizontal ? lat : p
          if (this.inFine(x, fy, z)) this.solid[this.fidx(x, fy, z)] = 0
        }
      }
    }
    // Escape door: a two-story building opens onto its shorter neighbor's roof.
    const tall = this.tallness(idA) >= 8 ? A : this.tallness(idB) >= 8 ? B : null
    const short = tall === A ? B : A
    if (tall && this.tallness(tall === A ? idB : idA) < 8) {
      void short
      for (let p = planeLo; p <= planeLo + 4; p++) {
        for (let lat = mid - 3; lat <= mid + 3; lat++) {
          for (let fy = 17; fy < 25; fy++) {
            const x = horizontal ? p : lat
            const z = horizontal ? lat : p
            if (this.inFine(x, fy, z)) this.solid[this.fidx(x, fy, z)] = 0
          }
        }
      }
    }
  }

  private towerHeights = new Map<number, number>()
  private tallness(id: number): number {
    return this.towerHeights.get(id) ?? 4
  }

  private buildingLights: THREE.PointLight[] = []

  // One Victorian house: fine-voxel walls, an inward-facing door with a porch,
  // sparse windows on the door side only, a roof (gabled or flat), a chimney —
  // and sometimes a second story with a staircase, upstairs floor, and a
  // balcony escape door out the back.
  private buildHouse(
    id: number,
    name: string,
    color: number,
    pastel: number,
    bx: number,
    bz: number,
    w: number,
    d: number,
    baseWallH: number,
    angToCenter: number,
    twoStory: boolean,
    rand: () => number
  ): void {
    const wallH = twoStory ? 8 : baseWallH
    this.towerHeights.set(id, wallH)
    const owner = id + 1
    const hw = Math.floor((w * F) / 2)
    const hd = Math.floor((d * F) / 2)
    const cx = Math.round(bx * F)
    const cz = Math.round(bz * F)
    const wallTop = wallH * F
    // Door faces the cemetery: pick the wall side closest to the inward direction.
    const inward = { x: -Math.cos(angToCenter), z: -Math.sin(angToCenter) }
    const side = Math.abs(inward.x) > Math.abs(inward.z) ? (inward.x > 0 ? 0 : 1) : inward.z > 0 ? 2 : 3 // 0:+x 1:-x 2:+z 3:-z

    // Walls with windows.
    for (let fx = -hw; fx <= hw; fx++) {
      for (let fz = -hd; fz <= hd; fz++) {
        const onX = Math.abs(fx) === hw
        const onZ = Math.abs(fz) === hd
        if (!onX && !onZ) continue
        for (let fy = 0; fy < wallTop; fy++) {
          // Door: 9 fine (2.25 units) wide — comfortably two hop-cells — and
          // 9 fine tall, on the inward side. The ONLY way in.
          const inDoor =
            fy < 9 &&
            ((side === 0 && fx === hw && Math.abs(fz) <= 4) ||
              (side === 1 && fx === -hw && Math.abs(fz) <= 4) ||
              (side === 2 && fz === hd && Math.abs(fx) <= 4) ||
              (side === 3 && fz === -hd && Math.abs(fx) <= 4))
          if (inDoor) continue
          // Very few windows: only on the door-facing (inward) wall, small and
          // sparse — the outward faces of the city are blind brick.
          const whichSide = onX ? (fx > 0 ? 0 : 1) : fz > 0 ? 2 : 3
          if (whichSide === side && !(onX && onZ)) {
            const along = onX ? fz + hd : fx + hw
            const inWindowBand = along % 10 >= 5 && along % 10 <= 7
            if (inWindowBand && ((fy >= 5 && fy < 10) || (twoStory && fy >= 21 && fy < 26))) continue
          }
          // White trim: a lintel course, the top course, the upstairs floor line.
          const trim = fy === 12 || fy === wallTop - 1 || (twoStory && fy === 16)
          this.put(cx + fx, fy, cz + fz, trim ? T_TRIM : T_WALL, owner)
        }
      }
    }
    // Interior floor (lit when revealed).
    for (let fx = -hw + 1; fx < hw; fx++) {
      for (let fz = -hd + 1; fz < hd; fz++) {
        this.put(cx + fx, 0, cz + fz, T_FLOOR, owner)
      }
    }
    // Roofline: about half the town is flat-roofed with a parapet, the rest
    // get stepped gables — plus chimneys either way.
    const alongX = w >= d
    const flatRoof = rand() < 0.5
    let roofTopY = wallTop
    if (flatRoof) {
      for (let fx = -hw - 1; fx <= hw + 1; fx++) {
        for (let fz = -hd - 1; fz <= hd + 1; fz++) {
          this.put(cx + fx, wallTop, cz + fz, T_ROOF, owner)
          const onEdge = Math.abs(fx) >= hw || Math.abs(fz) >= hd
          if (onEdge) {
            this.put(cx + fx, wallTop + 1, cz + fz, T_WALL, owner)
            if (((fx + fz) & 3) !== 0) this.put(cx + fx, wallTop + 2, cz + fz, T_WALL, owner) // parapet merlons
          }
        }
      }
      roofTopY = wallTop + 2
    } else {
      const spanHalf = alongX ? hd : hw
      const roofRise = Math.floor(spanHalf * 0.9)
      for (let s = 0; s <= roofRise; s++) {
        const lo = -spanHalf - 2 + s
        const hi = spanHalf + 2 - s
        if (lo > hi) break
        for (let a = -(alongX ? hw : hd) - 2; a <= (alongX ? hw : hd) + 2; a++) {
          for (const edge of [lo, hi]) {
            const fx = alongX ? a : edge
            const fz = alongX ? edge : a
            this.put(cx + fx, wallTop + s, cz + fz, T_ROOF, owner)
          }
          // Fill the gable ends.
          if (Math.abs(a) === (alongX ? hw : hd) + 2) {
            for (let e = lo; e <= hi; e++) {
              const fx = alongX ? a : e
              const fz = alongX ? e : a
              this.put(cx + fx, wallTop + s, cz + fz, T_WALL, owner)
            }
          }
        }
      }
      roofTopY = wallTop + roofRise
    }
    // Chimney.
    const chx = cx + (alongX ? hw - 4 : 0)
    const chz = cz + (alongX ? 0 : hd - 4)
    for (let fy = wallTop; fy < roofTopY + 5; fy++) {
      for (let a = 0; a < 2; a++) {
        for (let b = 0; b < 2; b++) this.put(chx + a, fy, chz + b, T_WALL, owner)
      }
    }
    // Porch: slab + two columns + roof over the door.
    const dirs = [
      { x: 1, z: 0 },
      { x: -1, z: 0 },
      { x: 0, z: 1 },
      { x: 0, z: -1 },
    ][side]
    const doorFx = cx + (side === 0 ? hw : side === 1 ? -hw : 0)
    const doorFz = cz + (side === 2 ? hd : side === 3 ? -hd : 0)
    for (let out = 1; out <= 6; out++) {
      for (let lat = -5; lat <= 5; lat++) {
        const px = doorFx + dirs.x * out + (dirs.x === 0 ? lat : 0)
        const pz = doorFz + dirs.z * out + (dirs.z === 0 ? lat : 0)
        this.put(px, 10, pz, T_TRIM, owner) // porch roof
        if (out === 5 && Math.abs(lat) === 5) {
          for (let fy = 0; fy < 10; fy++) this.put(px, fy, pz, T_TRIM, owner) // columns
        }
      }
    }

    void roofTopY
    // Second story: staircase up the back wall, an upstairs floor with a
    // stairwell, and a balcony escape door out the back — drop to the street.
    if (twoStory) {
      const floorY = 16
      const backIsX = side === 0 || side === 1
      const backSign = side === 0 ? -1 : 1 // x-sign when backIsX, else z-sign
      const stairCells = new Set<string>()
      for (let s = 0; s <= 16; s++) {
        for (let v = 1; v <= 5; v++) {
          let x: number
          let z: number
          if (backIsX) {
            x = cx + backSign * (hw - v)
            z = cz - hd + 2 + s
          } else {
            z = cz + (side === 2 ? -1 : 1) * (hd - v)
            x = cx - hw + 2 + s
          }
          for (let fy = 0; fy <= Math.min(s, floorY - 1); fy++) this.put(x, fy, z, T_TRIM, owner)
          if (s >= 8) stairCells.add(`${x},${z}`)
        }
      }
      // Upstairs floor (hole above the top half of the stairs).
      for (let fx = -hw + 1; fx < hw; fx++) {
        for (let fz = -hd + 1; fz < hd; fz++) {
          if (stairCells.has(`${cx + fx},${cz + fz}`)) continue
          this.put(cx + fx, floorY, cz + fz, T_FLOOR, owner)
        }
      }
      // Balcony: carve the upper back doorway, lay a railed platform outside.
      const bSign = backIsX ? backSign : side === 2 ? -1 : 1
      for (let lat = -2; lat <= 2; lat++) {
        for (let fy = floorY + 1; fy < floorY + 9; fy++) {
          const x = backIsX ? cx + bSign * hw : cx + lat
          const z = backIsX ? cz + lat : cz + bSign * hd
          if (this.inFine(x, fy, z)) this.solid[this.fidx(x, fy, z)] = 0
        }
      }
      for (let out = 1; out <= 4; out++) {
        for (let lat = -3; lat <= 3; lat++) {
          const x = backIsX ? cx + bSign * (hw + out) : cx + lat
          const z = backIsX ? cz + lat : cz + bSign * (hd + out)
          this.put(x, floorY, z, T_TRIM, owner)
          if (out === 4 || Math.abs(lat) === 3) {
            this.put(x, floorY + 1, z, T_FENCE, owner)
            this.put(x, floorY + 2, z, T_FENCE, owner)
          }
        }
      }
    }

    const b: Building = {
      id,
      name,
      x0: this.ox + bx - w / 2,
      z0: this.oz + bz - d / 2,
      x1: this.ox + bx + w / 2,
      z1: this.oz + bz + d / 2,
      doorX: this.ox + (doorFx + dirs.x * 3) / F,
      doorZ: this.oz + (doorFz + dirs.z * 3) / F,
      cx: this.ox + bx,
      cz: this.oz + bz,
      revealed: false,
      light: null,
      color,
      pastel,
    }
    void rand
    this.buildings.push(b)
  }

  // Fenced cemetery with headstone rows — the Zombie King's doorstep.
  private buildCemetery(ccx: number, ccz: number, rand: () => number): void {
    const hw = 5 * F
    const hd = 4 * F
    const cx = ccx * F
    const cz = ccz * F
    // Low iron kerb: a knee-high border (3 fine ≈ 0.75u) so the King and the
    // players can step over it in any direction — the cemetery is open ground,
    // not a cage. Slightly taller corner posts for the look.
    for (let fx = -hw; fx <= hw; fx++) {
      for (let fz = -hd; fz <= hd; fz++) {
        const onEdge = Math.abs(fx) === hw || Math.abs(fz) === hd
        if (!onEdge) continue
        const corner = Math.abs(fx) === hw && Math.abs(fz) === hd
        const top = corner ? 3 : 2
        for (let fy = 0; fy < top; fy++) this.put(cx + fx, fy, cz + fz, T_FENCE, 0)
      }
    }
    // Headstones.
    for (let gx = -hw + 4; gx <= hw - 4; gx += 6) {
      for (let gz = -hd + 4; gz <= hd - 4; gz += 5) {
        if (Math.abs(gx) < 3 && Math.abs(gz) < 3) continue // leave the King's plot open
        if (rand() < 0.25) continue
        for (let fy = 0; fy < 3; fy++) {
          this.put(cx + gx, fy, cz + gz, T_GRAVE, 0)
          this.put(cx + gx + 1, fy, cz + gz, T_GRAVE, 0)
        }
        this.put(cx + gx, 3, cz + gz, T_GRAVE, 0)
      }
    }
    // Glowing ground plate (unlit material = it reads as light itself).
    if (this.glow) {
      this.scene.remove(this.glow)
      this.glow.geometry.dispose()
    }
    const g = new THREE.Mesh(
      new THREE.PlaneGeometry((hw * 2 - 2) / F, (hd * 2 - 2) / F),
      new THREE.MeshBasicMaterial({ color: 0x3fdd72, transparent: true, opacity: 0.55, side: THREE.DoubleSide })
    )
    g.rotation.x = -Math.PI / 2
    g.position.set(this.ox + ccx, this.baseY + 0.53, this.oz + ccz)
    this.scene.add(g)
    this.glow = g
  }

  // ---------------------------------------------------------------- queries

  // Solid fine voxel at a world-space point?
  isSolidAt(wx: number, wy: number, wz: number): boolean {
    const fx = Math.floor((wx - this.ox) * F)
    const fy = Math.floor((wy - (this.baseY + 0.5)) * F)
    const fz = Math.floor((wz - this.oz) * F)
    if (!this.inFine(fx, fy, fz)) return false
    return this.solid[this.fidx(fx, fy, fz)] === 1
  }

  contains(wx: number, wz: number): boolean {
    return wx >= this.ox && wx < this.ox + this.sx && wz >= this.oz && wz < this.oz + this.sz
  }

  // Which building's interior is this point inside?
  buildingAt(wx: number, wz: number): Building | null {
    for (const b of this.buildings) {
      if (!b.revealed && wx > b.x0 + 0.6 && wx < b.x1 - 0.6 && wz > b.z0 + 0.6 && wz < b.z1 - 0.6) return b
      if (b.revealed && wx > b.x0 && wx < b.x1 && wz > b.z0 && wz < b.z1) return b
    }
    return null
  }

  inCemetery(wx: number, wz: number): boolean {
    return wx > this.cemetery.x0 && wx < this.cemetery.x1 && wz > this.cemetery.z0 && wz < this.cemetery.z1
  }

  // Flip the lights on: the floor turns its pastel color, the room's name
  // hovers inside it in Helvetica, and everyone now knows what it is.
  reveal(b: Building): string {
    if (b.revealed) return b.name
    b.revealed = true
    const light = new THREE.PointLight(0xffe2b0, 40, 12, 1.3)
    light.position.set(b.cx, this.baseY + 3.2, b.cz)
    this.scene.add(light)
    this.buildingLights.push(light)
    b.light = light
    // Hovering name.
    const c = document.createElement('canvas')
    c.width = 512
    c.height = 128
    const g = c.getContext('2d')!
    g.font = '700 58px Helvetica, Arial, sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.shadowColor = 'rgba(0,0,0,0.85)'
    g.shadowBlur = 14
    g.fillStyle = 'rgba(255,255,255,0.96)'
    g.fillText(b.name.toUpperCase(), 256, 64)
    // A modest label hovering low inside the room — depth-tested so walls hide
    // it from outside and it never fills the screen up close.
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false })
    )
    sprite.scale.set(3.2, 0.8, 1)
    sprite.position.set(b.cx, this.baseY + 2.4, b.cz)
    this.scene.add(sprite)
    this.nameSprites.push(sprite)
    this.rebuild()
    return b.name
  }

  private nameSprites: THREE.Sprite[] = []

  // Night dial: the cemetery glow and revealed windows burn brightest after dark.
  setNightBlend(blend: number): void {
    // A tight green pool right at the cemetery — a marker in the dark, not a
    // town-wide floodlight.
    this.glowLight.intensity = 4 + blend * 26
    if (this.glow) (this.glow.material as THREE.MeshBasicMaterial).opacity = 0.2 + blend * 0.45
    for (const l of this.buildingLights) l.intensity = 6 + blend * 44
  }

  // Artillery damage: carve a sphere out of the fine grid (world coords).
  carveSphere(wx: number, wy: number, wz: number, r: number): void {
    if (wx < this.ox - r || wx > this.ox + this.sx + r || wz < this.oz - r || wz > this.oz + this.sz + r) return
    const fr = Math.ceil(r * F)
    const cxf = Math.round((wx - this.ox) * F)
    const cyf = Math.round((wy - (this.baseY + 0.5)) * F)
    const czf = Math.round((wz - this.oz) * F)
    let removed = 0
    for (let y = Math.max(0, cyf - fr); y <= Math.min(this.fy() - 1, cyf + fr); y++) {
      for (let z = Math.max(0, czf - fr); z <= Math.min(this.fz() - 1, czf + fr); z++) {
        for (let x = Math.max(0, cxf - fr); x <= Math.min(this.fx() - 1, cxf + fr); x++) {
          const dx = x - cxf
          const dy = y - cyf
          const dz = z - czf
          if (dx * dx + dy * dy + dz * dz > fr * fr) continue
          const i = this.fidx(x, y, z)
          if (this.solid[i]) {
            this.solid[i] = 0
            removed++
          }
        }
      }
    }
    if (removed) this.rebuild()
  }

  // ---------------------------------------------------------------- rendering

  rebuild(): void {
    const m = this.tmpM
    const col = this.tmpC
    let n = 0
    const fx0 = this.fx()
    const fy0 = this.fy()
    const fz0 = this.fz()
    for (let y = 0; y < fy0 && n < MAX_FINE; y++) {
      for (let z = 0; z < fz0 && n < MAX_FINE; z++) {
        for (let x = 0; x < fx0 && n < MAX_FINE; x++) {
          const i = this.fidx(x, y, z)
          if (!this.solid[i]) continue
          // Skip fully enclosed cells.
          if (
            x > 0 && x < fx0 - 1 && y > 0 && y < fy0 - 1 && z > 0 && z < fz0 - 1 &&
            this.solid[this.fidx(x - 1, y, z)] && this.solid[this.fidx(x + 1, y, z)] &&
            this.solid[this.fidx(x, y - 1, z)] && this.solid[this.fidx(x, y + 1, z)] &&
            this.solid[this.fidx(x, y, z - 1)] && this.solid[this.fidx(x, y, z + 1)]
          ) {
            continue
          }
          m.makeTranslation(this.ox + (x + 0.5) / F, this.baseY + 0.5 + (y + 0.5) / F, this.oz + (z + 0.5) / F)
          this.mesh.setMatrixAt(n, m)
          const t = this.tint[i]
          const own = this.owner[i]
          const b = own > 0 ? this.buildings[own - 1] : null
          const lit = b?.revealed ?? false
          if (t === T_TRIM) col.setHex(lit ? 0xfff6e0 : 0xf2f2ee)
          else if (t === T_ROOF) col.setHex(0x4a4f5c)
          else if (t === T_FLOOR) col.setHex(lit && b ? b.pastel : 0x1c1e24)
          else if (t === T_FENCE) col.setHex(0x2a2d33)
          else if (t === T_GRAVE) col.setHex(0x9aa3a8)
          else {
            col.setHex(b ? b.color : 0x8a8f99)
            if (lit) col.lerp(this.tmpCWhite, 0.25)
          }
          this.mesh.setColorAt(n, col)
          n++
        }
      }
    }
    this.mesh.count = n
    this.mesh.instanceMatrix.needsUpdate = true
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
  }

  private tmpCWhite = new THREE.Color(0xfff2d8)
}
