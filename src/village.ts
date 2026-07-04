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
}

const MAX_FINE = 260000

export class Village {
  ox = 0 // world-space min corner
  oz = 0
  baseY = 0 // island ground level (top solid voxel y)
  sx = 60 // footprint in world units
  sz = 46
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
    this.glowLight = new THREE.PointLight(0x51e87c, 0, 26, 1.4)
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
    for (const b of this.buildingLights) this.scene.remove(b)
    this.buildingLights.length = 0

    const rand = mulberry32(seed ^ 0x9e3779b9)

    // Cemetery dead center.
    const ccx = this.sx / 2
    const ccz = this.sz / 2
    this.cemetery = { x0: this.ox + ccx - 5, z0: this.oz + ccz - 4, x1: this.ox + ccx + 5, z1: this.oz + ccz + 4 }
    this.buildCemetery(Math.round(ccx), Math.round(ccz), rand)

    // Shuffle names and paint.
    const names = [...BUILDING_NAMES]
    const paints = [...PALETTE]
    for (let i = names.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      ;[names[i], names[j]] = [names[j], names[i]]
      const k = Math.floor(rand() * (i + 1))
      ;[paints[i], paints[k]] = [paints[k], paints[i]]
    }

    // Twelve buildings in a jittered ring around the cemetery, doors inward.
    const ringRx = this.sx / 2 - 9
    const ringRz = this.sz / 2 - 8
    for (let i = 0; i < 12; i++) {
      const ang = (i / 12) * Math.PI * 2 + (rand() - 0.5) * 0.22
      const bw = 7 + Math.floor(rand() * 3) // width (world units)
      const bd = 6 + Math.floor(rand() * 3) // depth
      const bh = 4 + Math.floor(rand() * 2) // wall height
      const bx = Math.round(ccx + Math.cos(ang) * (ringRx - bw / 2) )
      const bz = Math.round(ccz + Math.sin(ang) * (ringRz - bd / 2))
      this.buildHouse(i, names[i], paints[i], bx, bz, bw, bd, bh, ang, rand)
    }
    this.rebuild()
    // Cemetery glow anchor.
    this.glowLight.position.set(this.ox + ccx, baseY + 3, this.oz + ccz)
  }

  private buildingLights: THREE.PointLight[] = []

  // One Victorian house: fine-voxel walls with tall windows, an inward-facing
  // door with a porch, a stepped gable roof with eaves, and a chimney.
  private buildHouse(
    id: number,
    name: string,
    color: number,
    bx: number,
    bz: number,
    w: number,
    d: number,
    wallH: number,
    angToCenter: number,
    rand: () => number
  ): void {
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
          // Door: 5 fine wide, 9 fine tall on the inward side.
          const inDoor =
            fy < 9 &&
            ((side === 0 && fx === hw && Math.abs(fz) <= 2) ||
              (side === 1 && fx === -hw && Math.abs(fz) <= 2) ||
              (side === 2 && fz === hd && Math.abs(fx) <= 2) ||
              (side === 3 && fz === -hd && Math.abs(fx) <= 2))
          if (inDoor) continue
          // Tall Victorian windows: 3 fine wide, 8 fine tall, spaced every 8.
          const along = onX ? fz + hd : fx + hw
          const inWindowBand = along % 8 >= 3 && along % 8 <= 5
          const winV = fy >= 4 && fy < 12
          if (inWindowBand && winV && !(onX && onZ)) continue
          // White trim: sills, lintels and the top course.
          const trim = fy === 3 || fy === 12 || fy === wallTop - 1
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
    // Stepped gable roof with eaves, ridge along the longer axis.
    const alongX = w >= d
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
    // Chimney.
    const chx = cx + (alongX ? hw - 4 : 0)
    const chz = cz + (alongX ? 0 : hd - 4)
    for (let fy = wallTop; fy < wallTop + roofRise + 5; fy++) {
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
      for (let lat = -4; lat <= 4; lat++) {
        const px = doorFx + dirs.x * out + (dirs.x === 0 ? lat : 0)
        const pz = doorFz + dirs.z * out + (dirs.z === 0 ? lat : 0)
        this.put(px, 10, pz, T_TRIM, owner) // porch roof
        if (out === 5 && Math.abs(lat) === 4) {
          for (let fy = 0; fy < 10; fy++) this.put(px, fy, pz, T_TRIM, owner) // columns
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
    // Iron fence: posts every 4 fine cells with a top rail, gate on +x.
    for (let fx = -hw; fx <= hw; fx++) {
      for (let fz = -hd; fz <= hd; fz++) {
        const onEdge = Math.abs(fx) === hw || Math.abs(fz) === hd
        if (!onEdge) continue
        const gate = fx === hw && Math.abs(fz) <= 3
        if (gate) continue
        const post = (fx + hw) % 4 === 0 && (fz + hd) % 4 === 0
        if (post) for (let fy = 0; fy < 5; fy++) this.put(cx + fx, fy, cz + fz, T_FENCE, 0)
        this.put(cx + fx, 4, cz + fz, T_FENCE, 0) // rail
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

  // Flip the lights on, reveal the name to everyone, return it.
  reveal(b: Building): string {
    if (b.revealed) return b.name
    b.revealed = true
    const light = new THREE.PointLight(0xffe2b0, 40, 12, 1.3)
    light.position.set(b.cx, this.baseY + 3.2, b.cz)
    this.scene.add(light)
    this.buildingLights.push(light)
    b.light = light
    this.rebuild()
    return b.name
  }

  // Night dial: the cemetery glow and revealed windows burn brightest after dark.
  setNightBlend(blend: number): void {
    this.glowLight.intensity = 10 + blend * 120
    if (this.glow) (this.glow.material as THREE.MeshBasicMaterial).opacity = 0.25 + blend * 0.5
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
          else if (t === T_FLOOR) col.setHex(lit ? 0xffe9c0 : 0x2b2e35)
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
