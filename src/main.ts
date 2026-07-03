// Scorched Earth 3D — main entry: scene, game loop, turns, camera, input.
import * as THREE from 'three'
import { World, GX, GZ, GRAVITY, WIND_ACCEL, type Wind, type Fortifications } from './world'
import { WEAPONS, FUNKY_CHILD, newArsenal, speedOf, type WeaponDef } from './weapons'
import { planShot } from './ai'
import { createHud } from './hud'
import { makeAvatar, standingY } from './avatar'
import * as sfx from './audio'

const COLLAPSE_AT = 0.4 // fort integrity below this = destroyed
const STEP = 1 / 120 // fixed physics step, must match World.simShot
const DEG = Math.PI / 180

// ---------------------------------------------------------------- scene setup

const app = document.getElementById('app')!
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
app.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0xeef1f4)
scene.fog = new THREE.Fog(0xeef1f4, 180, 460)

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 1200)

scene.add(new THREE.HemisphereLight(0xffffff, 0xd4d9df, 1.2))
const sun = new THREE.DirectionalLight(0xffffff, 1.7)
sun.position.set(GX / 2 + 70, 145, GZ / 2 - 55)
sun.target.position.set(GX / 2, 0, GZ / 2)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
sun.shadow.camera.left = -140
sun.shadow.camera.right = 140
sun.shadow.camera.top = 140
sun.shadow.camera.bottom = -140
sun.shadow.camera.near = 20
sun.shadow.camera.far = 430
sun.shadow.bias = -0.0005
scene.add(sun)
scene.add(sun.target)

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(3000, 3000),
  new THREE.MeshLambertMaterial({ color: 0xf1f3f6 })
)
ground.rotation.x = -Math.PI / 2
ground.position.set(GX / 2, -0.02, GZ / 2)
ground.receiveShadow = true
scene.add(ground)

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})

const world = new World(scene)
const hud = createHud(document.body, { onWeapon: i => selectWeapon(i), onWorldToggle: () => toggleWorldView() })

// ---------------------------------------------------------------- cannons

function makeCannon(body: number) {
  const group = new THREE.Group()
  const metal = new THREE.MeshLambertMaterial({ color: body })
  const accent = new THREE.Color(body).multiplyScalar(0.45).getHex()
  const base = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.1, 2.6), metal)
  base.position.y = 0.55
  base.castShadow = true
  group.add(base)
  const yaw = new THREE.Group()
  yaw.position.y = 1.35
  group.add(yaw)
  const turret = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, 1.6), metal)
  turret.castShadow = true
  yaw.add(turret)
  const pitch = new THREE.Group()
  pitch.position.y = 0.3
  yaw.add(pitch)
  const barrelGeo = new THREE.CylinderGeometry(0.28, 0.34, 3.4, 10)
  barrelGeo.rotateZ(-Math.PI / 2) // axis → +X, so yaw/pitch math is simple
  barrelGeo.translate(1.7, 0, 0) // pivot at the breech
  const barrel = new THREE.Mesh(barrelGeo, metal)
  barrel.castShadow = true
  pitch.add(barrel)
  const tip = new THREE.Mesh(
    new THREE.BoxGeometry(0.45, 0.45, 0.45),
    new THREE.MeshLambertMaterial({ color: accent })
  )
  tip.position.set(3.3, 0, 0)
  pitch.add(tip)
  scene.add(group)
  return { group, yaw, pitch }
}

type SideState = {
  cannon: ReturnType<typeof makeCannon>
  az: number
  el: number
  arsenal: Map<string, number>
  wsel: number
  targetX: number
  targetY: number
  targetZ: number
  fallV: number
}

// Player is red (light-red castle); the computer is blue (light-blue castle).
const sides: SideState[] = [
  { cannon: makeCannon(0xc0392b), az: 0, el: 55 * DEG, arsenal: newArsenal(), wsel: 0, targetX: 0, targetY: 0, targetZ: 0, fallV: 0 },
  { cannon: makeCannon(0x2f6fd6), az: Math.PI, el: 55 * DEG, arsenal: newArsenal(), wsel: 0, targetX: 0, targetY: 0, targetZ: 0, fallV: 0 },
]

// VoxPop-style voxel avatars, one per side, standing watch beside their cannon.
// (Core of the coming night-cycle gameplay — for now they just take the field.)
const avatars = [makeAvatar(0xc0392b), makeAvatar(0x2f6fd6)]
avatars[1].rotation.y = -Math.PI // enemy avatar faces back toward the player
for (const a of avatars) scene.add(a)

function placeAvatars(): void {
  for (let s = 0; s < 2; s++) {
    const seat = world.cannonSeat(s)
    const zOff = s === 0 ? 2 : -2 // stand beside the cannon, not on it
    const x = seat.x
    const z = Math.max(1, Math.min(GZ - 2, seat.z + zOff))
    avatars[s].position.set(x, standingY(world.surfaceY(x, z)), z)
  }
}

function dirOf(side: number): THREE.Vector3 {
  const s = sides[side]
  return new THREE.Vector3(
    Math.cos(s.el) * Math.cos(s.az),
    Math.sin(s.el),
    Math.cos(s.el) * Math.sin(s.az)
  )
}

function muzzleOf(side: number): THREE.Vector3 {
  const s = sides[side]
  return dirOf(side).multiplyScalar(3.6).add(s.cannon.group.position).add(new THREE.Vector3(0, 1.65, 0))
}

function applyCannonPose(side: number): void {
  const s = sides[side]
  s.cannon.yaw.rotation.y = -s.az
  s.cannon.pitch.rotation.z = s.el
}

// ---------------------------------------------------------------- game state

type Phase = 'aim' | 'charge' | 'fly' | 'resolve' | 'aiThink' | 'aiAim' | 'end' | 'shop'

// Match economy: a match is best-of-ROUNDS; damage earns cash, spent in the armory.
const ROUNDS = 5
const START_CASH = 3000
const WIN_BONUS = 2500
const DMG_PAY = 4000 // pay for demolishing 100% of the enemy fort

let phase: Phase = 'aim'
let turn = 0
let round = 0
let scoreYou = 0
let scoreFoe = 0
const money = [START_CASH, START_CASH]
let lastRoundResult = ''
let roundSeed = 0
// Match-persistent structure upgrades (taller main tower, extra towers).
const forti: Fortifications[] = [
  { height: 0, towers: 0 },
  { height: 0, towers: 0 },
]
let wind: Wind = { x: 0, z: 0 }
let chargeT = 0
let chargePower = 0
let lastPlayerPower = 60
let shotThisRound = false // power marker only shows after the first shot of a round
let resolveT = 0
let aiT = 0
let aiErr = 13
let aiPlanned: { az: number; el: number; power: number } | null = null
let aiAnimT = 0
let aiStart = { az: 0, el: 0 }
let endT = 0
let endShown = false
let endInfo: { title: string; sub: string; center: THREE.Vector3 } | null = null
const lastImpact = new THREE.Vector3(GX / 2, 12, GZ / 2)
const keys = new Set<string>()

// ---------------------------------------------------------------- projectiles

type Proj = {
  pos: THREE.Vector3
  vel: THREE.Vector3
  hdir: THREE.Vector3 // horizontal travel direction — stable through the apex, used by the chase cam
  weapon: WeaponDef
  split: boolean
  side: number
  hops: number // Leap Frog bounce count
  mesh: THREE.Mesh
  trailPos: Float32Array
  trailN: number
  trailLine: THREE.Line
}
const projs: Proj[] = []
const projGeo = new THREE.BoxGeometry(0.9, 0.9, 0.9)
const projMat = new THREE.MeshLambertMaterial({ color: 0x23272c })

function spawnProj(pos: THREE.Vector3, vel: THREE.Vector3, weapon: WeaponDef, split: boolean, side: number, hops = 0): void {
  const mesh = new THREE.Mesh(projGeo, projMat)
  mesh.castShadow = true
  mesh.position.copy(pos)
  scene.add(mesh)
  const trailPos = new Float32Array(600 * 3)
  const tg = new THREE.BufferGeometry()
  tg.setAttribute('position', new THREE.BufferAttribute(trailPos, 3))
  tg.setDrawRange(0, 0)
  const trailLine = new THREE.Line(
    tg,
    new THREE.LineBasicMaterial({ color: 0x8a929b, transparent: true, opacity: 0.6 })
  )
  trailLine.frustumCulled = false
  scene.add(trailLine)
  const hdir = new THREE.Vector3(vel.x, 0, vel.z)
  if (hdir.lengthSq() < 0.01) hdir.set(1, 0, 0)
  hdir.normalize()
  projs.push({ pos: pos.clone(), vel: vel.clone(), hdir, weapon, split, side, hops, mesh, trailPos, trailN: 0, trailLine })
}

// The player's arcs linger after impact (highlighted while lining up the next shot).
const lastTrails: THREE.Line[] = []

function clearLastTrails(): void {
  for (const t of lastTrails) {
    scene.remove(t)
    t.geometry.dispose()
    ;(t.material as THREE.Material).dispose()
  }
  lastTrails.length = 0
}

function removeProj(p: Proj): void {
  scene.remove(p.mesh)
  if (p.side === 0) {
    lastTrails.push(p.trailLine)
  } else {
    scene.remove(p.trailLine)
    p.trailLine.geometry.dispose()
  }
  const i = projs.indexOf(p)
  if (i >= 0) projs.splice(i, 1)
}

function doSplit(p: Proj): void {
  sfx.pop()
  spawnFlash(p.pos, 6, 0xfff2d8)
  const n = p.weapon.split ?? 5
  const f = p.vel.clone().normalize()
  const s1 = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0)).normalize()
  if (s1.lengthSq() < 0.1) s1.set(0, 0, 1)
  const s2 = new THREE.Vector3().crossVectors(f, s1).normalize()
  const speed = p.vel.length()
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    const spread = i === 0 ? 0 : speed * (0.06 + 0.05 * Math.random())
    const v = p.vel
      .clone()
      .addScaledVector(s1, Math.cos(a) * spread)
      .addScaledVector(s2, Math.sin(a) * spread * 0.7)
      .multiplyScalar(0.96 + Math.random() * 0.06)
    spawnProj(p.pos, v, p.weapon, true, p.side)
  }
  removeProj(p)
}

// ---------------------------------------------------------------- special-weapon tasks

type Task =
  | { kind: 'dig'; pos: THREE.Vector3; dir: THREE.Vector3; steps: number; maxSteps: number; t: number }
  | { kind: 'roller'; x: number; z: number; dx: number; dz: number; flat: number; steps: number; t: number; mesh: THREE.Mesh }
  | { kind: 'napalm'; blobs: { x: number; z: number; life: number }[]; t: number }
const tasks: Task[] = []

function crater(at: THREE.Vector3, r: number, fire: boolean): void {
  world.carve(at.x, at.y, at.z, r)
  if (fire) world.shockwave(at.x, at.y, at.z, r, Math.random)
  world.updateSupport(Math.random)
  spawnExplosion(at, r, fire)
  sfx.boom(r)
  addShake(r, at)
  lastImpact.copy(at)
}

// Shell lost to the drink: white plume, no crater.
function splash(p: Proj): void {
  spawnExplosion(p.pos, 2.4, false)
  sfx.boom(1.1)
  lastImpact.copy(p.pos)
  hud.msg('splash!')
  removeProj(p)
}

function impact(p: Proj, at: THREE.Vector3): void {
  const w = p.weapon
  switch (w.kind) {
    case 'blast':
    case 'mirv':
      crater(at, w.blast, true)
      break
    case 'dirt':
      world.addDirt(at.x, at.y, at.z, w.blast)
      spawnExplosion(at, w.blast * 0.7, false)
      sfx.boom(2.5)
      lastImpact.copy(at)
      break
    case 'digger': {
      const dir = p.vel.clone().normalize()
      tasks.push({ kind: 'dig', pos: at.clone(), dir, steps: 0, maxSteps: w.split ?? 16, t: 0 })
      spawnExplosion(at, 2, false)
      sfx.boom(1.6)
      lastImpact.copy(at)
      break
    }
    case 'napalm': {
      const blobs = []
      const n = w.split ?? 10
      for (let i = 0; i < n; i++) {
        blobs.push({
          x: at.x + (Math.random() - 0.5) * 4,
          z: at.z + (Math.random() - 0.5) * 4,
          life: 5 + Math.floor(Math.random() * 5),
        })
      }
      tasks.push({ kind: 'napalm', blobs, t: 0 })
      spawnExplosion(at, 3, true)
      sfx.boom(3)
      lastImpact.copy(at)
      break
    }
    case 'leap': {
      crater(at, w.blast, true)
      // Leap Frog: bounces on, exploding each time — three blasts total.
      if (p.hops < 2) {
        const v = new THREE.Vector3(p.vel.x * 0.75, Math.abs(p.vel.y) * 0.55 + 9, p.vel.z * 0.75)
        spawnProj(at.clone().add(new THREE.Vector3(0, 1.5, 0)), v, w, false, p.side, p.hops + 1)
        sfx.pop()
      }
      break
    }
    case 'funky': {
      crater(at, w.blast, true)
      const n = w.split ?? 6
      for (let i = 0; i < n; i++) {
        const v = new THREE.Vector3((Math.random() - 0.5) * 18, 12 + Math.random() * 12, (Math.random() - 0.5) * 18)
        spawnProj(at.clone().add(new THREE.Vector3(0, 1.5, 0)), v, FUNKY_CHILD, true, p.side)
      }
      sfx.pop()
      break
    }
    case 'tracer':
      spawnExplosion(at, 1.2, false)
      sfx.tick()
      lastImpact.copy(at)
      break
    case 'riot':
      // Clears dirt without touching fort structure — the un-burying tool.
      world.carve(at.x, at.y, at.z, w.blast, true)
      world.updateSupport(Math.random)
      spawnExplosion(at, w.blast * 0.8, false)
      sfx.boom(w.blast * 0.5)
      lastImpact.copy(at)
      break
    case 'roller': {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 10), projMat)
      mesh.castShadow = true
      const x = Math.round(at.x)
      const z = Math.round(at.z)
      mesh.position.set(x, world.surfaceY(x, z) + 0.8, z)
      scene.add(mesh)
      // Landing momentum lets it start rolling even on flat ground.
      tasks.push({ kind: 'roller', x, z, dx: Math.sign(Math.round(p.vel.x)), dz: Math.sign(Math.round(p.vel.z)), flat: 0, steps: 0, t: 0, mesh })
      sfx.boom(1.2)
      lastImpact.copy(at)
      break
    }
  }
  removeProj(p)
}

function updateTasks(dt: number): void {
  for (let i = tasks.length - 1; i >= 0; i--) {
    const t = tasks[i]
    t.t += dt
    if (t.kind === 'dig') {
      let done = false
      while (t.t > 0.055 && !done) {
        t.t -= 0.055
        t.pos.addScaledVector(t.dir, 1.15)
        t.steps++
        const p = t.pos
        const outOfWorld = p.x < 1 || p.x > GX - 2 || p.z < 1 || p.z > GZ - 2 || p.y < 0
        const exited = !world.isSolid(p.x, p.y, p.z) && t.steps > 4
        world.carve(p.x, p.y, p.z, 2.1)
        if (outOfWorld || exited || t.steps >= t.maxSteps) {
          crater(p, 3.2, true)
          done = true
        }
      }
      if (done) tasks.splice(i, 1)
    } else if (t.kind === 'roller') {
      let done = false
      while (t.t > 0.07 && !done) {
        t.t -= 0.07
        if (world.isWaterTop(t.x, t.z)) {
          // Rolled into water — glug.
          spawnExplosion(new THREE.Vector3(t.x, world.surfaceY(t.x, t.z) + 1, t.z), 2, false)
          sfx.boom(1)
          scene.remove(t.mesh)
          done = true
          continue
        }
        const dh = world.downhill(t.x, t.z)
        if (dh && t.steps < 90) {
          t.dx = Math.sign(dh.x - t.x)
          t.dz = Math.sign(dh.z - t.z)
          t.flat = 0
          t.x = dh.x
          t.z = dh.z
          t.steps++
          t.mesh.position.set(t.x, dh.y + 0.8, t.z)
        } else if (t.steps < 90 && t.flat < 6 && (t.dx !== 0 || t.dz !== 0)) {
          // No downhill here — momentum carries it across level ground for a
          // few cells so it can find the next slope instead of stopping on a ledge.
          const cy = world.surfaceY(t.x, t.z)
          let moved = false
          for (const [mx, mz] of [[t.dx, t.dz], [t.dx, 0], [0, t.dz]]) {
            if (mx === 0 && mz === 0) continue
            const nx = t.x + mx
            const nz = t.z + mz
            const ny = world.surfaceY(nx, nz)
            if (ny >= 0 && ny === cy) {
              t.x = nx
              t.z = nz
              t.flat++
              t.steps++
              t.mesh.position.set(t.x, ny + 0.8, t.z)
              moved = true
              break
            }
          }
          if (!moved) {
            crater(new THREE.Vector3(t.x, world.surfaceY(t.x, t.z) + 1, t.z), 5.5, true)
            scene.remove(t.mesh)
            done = true
          }
        } else {
          crater(new THREE.Vector3(t.x, world.surfaceY(t.x, t.z) + 1, t.z), 5.5, true)
          scene.remove(t.mesh)
          done = true
        }
      }
      if (done) tasks.splice(i, 1)
    } else {
      let acted = false
      while (t.t > 0.09) {
        t.t -= 0.09
        acted = true
        for (const b of t.blobs) {
          if (b.life <= 0) continue
          if (world.isWaterTop(b.x, b.z)) {
            b.life = 0 // fire meets water
            continue
          }
          const sy = world.surfaceY(b.x, b.z)
          if (sy >= 0) {
            world.carve(b.x, sy, b.z, 1.7)
            if (Math.random() < 0.4) spawnExplosion(new THREE.Vector3(b.x, sy + 1, b.z), 1.2, true)
          }
          const dh = world.downhill(b.x, b.z)
          if (dh) {
            b.x = dh.x
            b.z = dh.z
          }
          b.life--
        }
      }
      if (acted && t.blobs.every(b => b.life <= 0)) {
        world.updateSupport(Math.random)
        tasks.splice(i, 1)
      }
    }
  }
}

// ---------------------------------------------------------------- explosion FX

type Fx = { pts: THREE.Points; vel: Float32Array; age: number; life: number; mat: THREE.PointsMaterial }
const fxs: Fx[] = []
type Flash = { light: THREE.PointLight; age: number; life: number; base: number }
const flashes: Flash[] = []

function spawnExplosion(at: THREE.Vector3, r: number, fire: boolean): void {
  const n = Math.min(220, Math.floor(40 + r * 20))
  const pos = new Float32Array(n * 3)
  const col = new Float32Array(n * 3)
  const vel = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    const th = Math.random() * Math.PI * 2
    const ph = Math.acos(2 * Math.random() - 1)
    const sp = (0.3 + 0.7 * Math.random()) * (3 + r * 2.4)
    vel[i * 3] = Math.sin(ph) * Math.cos(th) * sp
    vel[i * 3 + 1] = Math.abs(Math.cos(ph)) * sp * 0.9
    vel[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * sp
    pos[i * 3] = at.x
    pos[i * 3 + 1] = at.y
    pos[i * 3 + 2] = at.z
    if (fire && Math.random() < 0.3) {
      col[i * 3] = 1
      col[i * 3 + 1] = 0.5 + Math.random() * 0.2
      col[i * 3 + 2] = 0.2
    } else {
      const v = 0.75 + Math.random() * 0.2
      col[i * 3] = v
      col[i * 3 + 1] = v
      col[i * 3 + 2] = v
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  const mat = new THREE.PointsMaterial({
    size: 0.9,
    vertexColors: true,
    transparent: true,
    opacity: 1,
    depthWrite: false,
  })
  const pts = new THREE.Points(g, mat)
  pts.frustumCulled = false
  scene.add(pts)
  fxs.push({ pts, vel, age: 0, life: 0.8 + r * 0.05, mat })
  if (fire) spawnFlash(at, Math.min(26, 8 + r * 2), 0xffd9a0)
}

function spawnFlash(at: THREE.Vector3, intensity: number, color: number): void {
  const light = new THREE.PointLight(color, intensity, intensity * 6, 1.6)
  light.position.copy(at)
  scene.add(light)
  flashes.push({ light, age: 0, life: 0.18, base: intensity })
}

function updateFx(dt: number): void {
  for (let i = fxs.length - 1; i >= 0; i--) {
    const f = fxs[i]
    f.age += dt
    if (f.age >= f.life) {
      scene.remove(f.pts)
      f.pts.geometry.dispose()
      f.mat.dispose()
      fxs.splice(i, 1)
      continue
    }
    const pos = f.pts.geometry.getAttribute('position') as THREE.BufferAttribute
    const arr = pos.array as Float32Array
    for (let j = 0; j < f.vel.length; j += 3) {
      f.vel[j + 1] -= 10 * dt
      arr[j] += f.vel[j] * dt
      arr[j + 1] += f.vel[j + 1] * dt
      arr[j + 2] += f.vel[j + 2] * dt
    }
    pos.needsUpdate = true
    f.mat.opacity = 1 - f.age / f.life
  }
  for (let i = flashes.length - 1; i >= 0; i--) {
    const fl = flashes[i]
    fl.age += dt
    if (fl.age >= fl.life) {
      scene.remove(fl.light)
      flashes.splice(i, 1)
    } else {
      fl.light.intensity = fl.base * (1 - fl.age / fl.life)
    }
  }
}

// ---------------------------------------------------------------- camera rig

const camPosCur = new THREE.Vector3(GX / 2, 80, GZ / 2 - 110)
const camLookCur = new THREE.Vector3(GX / 2, 12, GZ / 2)
// When the shell is about to land, the chase cam stops advancing and holds this
// position so the whole impact (blast, crumbling fort) stays in view.
let flyHold: THREE.Vector3 | null = null
let shakeAmp = 0
let endOrbit = 0
// "World View": pulled-back angled vantage over the whole battlefield from the
// player's side. You can still aim and fire from here; firing snaps back.
let worldView = false

function toggleWorldView(): void {
  if (phase !== 'aim' && phase !== 'charge') return
  worldView = !worldView
  hud.setWorldView(worldView)
  sfx.tick()
}

function addShake(r: number, at: THREE.Vector3): void {
  const dist = camPosCur.distanceTo(at)
  const amp = Math.min(2.2, r * 0.35) * Math.max(0.15, 1 - dist / 180)
  shakeAmp = Math.max(shakeAmp, amp)
}

function aimCamera(side: number, outPos: THREE.Vector3, outLook: THREE.Vector3): void {
  const s = sides[side]
  const p = s.cannon.group.position
  const dx = Math.cos(s.az)
  const dz = Math.sin(s.az)
  outPos.set(p.x - dx * 17, p.y + 9.5, p.z - dz * 17)
  const minY = world.surfaceY(outPos.x, outPos.z) + 3
  if (outPos.y < minY) outPos.y = minY
  outLook.set(p.x + dx * 26, p.y + 2 + s.el * 3, p.z + dz * 26)
}

function updateCamera(dt: number): void {
  const desiredPos = new THREE.Vector3()
  const desiredLook = new THREE.Vector3()
  let k = 3.5

  if (phase === 'aim' || phase === 'charge') {
    if (worldView) {
      desiredPos.set(GX / 2 - 115, 85, GZ / 2 + 70)
      desiredLook.set(GX / 2 + 8, 6, GZ / 2)
      k = 2.5
    } else {
      aimCamera(0, desiredPos, desiredLook)
    }
  } else if (phase === 'aiThink' || phase === 'aiAim') {
    aimCamera(1, desiredPos, desiredLook)
  } else if (phase === 'fly') {
    const lead = projs[0]
    if (lead && !flyHold && lead.vel.y < 0) {
      const pr = world.simShot(lead.pos, lead.vel, wind)
      if (pr.hit && pr.t < 1.0) {
        // Landing soon — stop advancing and watch the shell fly on to its target.
        flyHold = camPosCur.clone()
        flyHold.y = Math.max(flyHold.y + 2, world.surfaceY(flyHold.x, flyHold.z) + 6)
      }
    }
    if (flyHold) {
      desiredPos.copy(flyHold)
      desiredLook.copy(lead ? lead.pos : lastImpact)
      k = 2.2
    } else if (lead) {
      desiredPos.copy(lead.pos).addScaledVector(lead.hdir, -13).add(new THREE.Vector3(0, 5.5, 0))
      desiredLook.copy(lead.pos)
      k = 6
    } else {
      desiredPos.copy(camPosCur)
      desiredLook.copy(lastImpact)
    }
  } else if (phase === 'resolve') {
    if (flyHold) {
      desiredPos.copy(flyHold)
      desiredLook.copy(lastImpact)
    } else {
      desiredPos.set(GX / 2, 60, GZ / 2 - 80)
      desiredLook.copy(lastImpact)
    }
    k = 2.5
  } else if (phase === 'end' && endInfo) {
    endOrbit += dt * 0.35
    desiredPos.set(
      endInfo.center.x + Math.cos(endOrbit) * 40,
      endInfo.center.y + 26,
      endInfo.center.z + Math.sin(endOrbit) * 40
    )
    desiredLook.copy(endInfo.center)
    k = 2.2
  } else if (phase === 'shop') {
    // Slow scenic orbit of the fresh battlefield behind the armory overlay.
    endOrbit += dt * 0.18
    desiredPos.set(GX / 2 + Math.cos(endOrbit) * 58, 44, GZ / 2 + Math.sin(endOrbit) * 58)
    desiredLook.set(GX / 2, 14, GZ / 2)
    k = 1.8
  } else {
    desiredPos.copy(camPosCur)
    desiredLook.copy(camLookCur)
  }

  const a = 1 - Math.exp(-k * dt)
  camPosCur.lerp(desiredPos, a)
  camLookCur.lerp(desiredLook, a)
  camera.position.copy(camPosCur)
  if (shakeAmp > 0.002) {
    camera.position.x += (Math.random() - 0.5) * shakeAmp
    camera.position.y += (Math.random() - 0.5) * shakeAmp
    camera.position.z += (Math.random() - 0.5) * shakeAmp
    shakeAmp *= Math.exp(-2.8 * dt)
  }
  camera.lookAt(camLookCur)
}

// ---------------------------------------------------------------- side-view inset

// Picture-in-picture close-up of the player's cannon, rendered side-on so the
// barrel's elevation angle reads at a glance. Only shown while aiming.
const sideCam = new THREE.PerspectiveCamera(38, 198 / 118, 0.1, 300)

function renderSideView(): void {
  const active = phase === 'aim' || phase === 'charge'
  hud.showSide(active)
  if (!active) return
  const s = sides[0]
  const p = s.cannon.group.position
  // Camera sits perpendicular to the firing direction, so the barrel points
  // screen-right and its pitch is the on-screen angle.
  const sx = -Math.sin(s.az)
  const sz = Math.cos(s.az)
  sideCam.position.set(p.x + sx * 12, p.y + 2.6, p.z + sz * 12)
  sideCam.lookAt(p.x, p.y + 2.4, p.z)
  const rect = hud.sideRect()
  if (rect.width < 4) return
  const x = rect.left
  const y = window.innerHeight - rect.bottom
  sideCam.aspect = rect.width / rect.height
  sideCam.updateProjectionMatrix()
  renderer.setScissorTest(true)
  renderer.setScissor(x, y, rect.width, rect.height)
  renderer.setViewport(x, y, rect.width, rect.height)
  renderer.render(scene, sideCam)
  renderer.setScissorTest(false)
  renderer.setViewport(0, 0, window.innerWidth, window.innerHeight)
}

// ---------------------------------------------------------------- aim hint

const hintLine = new THREE.Line(
  new THREE.BufferGeometry(),
  new THREE.LineDashedMaterial({ color: 0x7a838d, transparent: true, opacity: 0.75, dashSize: 1.1, gapSize: 0.9 })
)
hintLine.frustumCulled = false
scene.add(hintLine)

function updateHint(): void {
  const show = phase === 'aim' || phase === 'charge'
  hintLine.visible = show
  if (!show) return
  const power = phase === 'charge' ? chargePower : lastPlayerPower
  const vel = dirOf(0).multiplyScalar(speedOf(Math.max(8, power)))
  const path: { x: number; y: number; z: number }[] = []
  world.simShot(muzzleOf(0), vel, { x: 0, z: 0 }, path) // hint ignores wind — reading the wind is the game
  const pts = path.slice(0, 42).map(p => new THREE.Vector3(p.x, p.y, p.z))
  if (pts.length < 2) {
    hintLine.visible = false
    return
  }
  hintLine.geometry.setFromPoints(pts)
  hintLine.computeLineDistances()
}

// ---------------------------------------------------------------- turns & firing

function rerollWind(): void {
  // Near-uniform strength up to a real gale — strong wind is common, not rare.
  const mag = Math.pow(Math.random(), 0.8) * 15
  const ang = Math.random() * Math.PI * 2
  wind = { x: Math.cos(ang) * mag, z: Math.sin(ang) * mag }
  hud.setWind(wind.x, wind.z)
}

// The in-game list shows only weapons you own (the full roster lives in the shop).
function visibleWeapons(): number[] {
  const s = sides[0]
  return WEAPONS.map((_, i) => i).filter(i => i === s.wsel || (s.arsenal.get(WEAPONS[i].id) ?? 0) > 0)
}

function updateWeaponHud(): void {
  const s = sides[0]
  hud.setWeapons(
    visibleWeapons().map(i => ({
      idx: i,
      name: WEAPONS[i].name,
      ammo: s.arsenal.get(WEAPONS[i].id) ?? 0,
      selected: i === s.wsel,
    }))
  )
}

function cycleWeapon(dirn: number): void {
  const s = sides[0]
  for (let i = 1; i <= WEAPONS.length; i++) {
    const j = (s.wsel + dirn * i + WEAPONS.length * i) % WEAPONS.length
    if ((s.arsenal.get(WEAPONS[j].id) ?? 0) > 0) {
      s.wsel = j
      break
    }
  }
  sfx.tick()
  updateWeaponHud()
}

// Shared by the number keys and mouse clicks on the weapon list.
function selectWeapon(idx: number): void {
  if (phase !== 'aim' && phase !== 'charge') return
  if (idx < 0 || idx >= WEAPONS.length) return
  if ((sides[0].arsenal.get(WEAPONS[idx].id) ?? 0) > 0) {
    sides[0].wsel = idx
    sfx.tick()
    updateWeaponHud()
  } else {
    hud.msg(`${WEAPONS[idx].name}: out of ammo`)
  }
}

function fireShot(side: number, weapon: WeaponDef, power: number): void {
  const s = sides[side]
  const ammo = s.arsenal.get(weapon.id) ?? 0
  if (Number.isFinite(ammo)) s.arsenal.set(weapon.id, Math.max(0, ammo - 1))
  if (side === 0) {
    updateWeaponHud()
    clearLastTrails()
  }
  applyCannonPose(side)
  const muzzle = muzzleOf(side)
  sfx.shot()
  spawnFlash(muzzle, 14, 0xffe0b0)
  spawnProj(muzzle, dirOf(side).multiplyScalar(speedOf(power)), weapon, false, side)
  if (side === 0) shotThisRound = true
  flyHold = null
  worldView = false
  hud.setWorldView(false)
  phase = 'fly'
  hud.setPower(null, shotThisRound ? lastPlayerPower : null)
}

function startTurn(s: number): void {
  turn = s
  rerollWind()
  flyHold = null
  if (s === 0) {
    const st = sides[0]
    if ((st.arsenal.get(WEAPONS[st.wsel].id) ?? 0) <= 0) {
      st.wsel = 0 // out of the fancy stuff — back to missiles
      updateWeaponHud()
    }
    phase = 'aim'
    hud.banner('YOUR TURN', 'wind has shifted')
    hud.setPower(null, shotThisRound ? lastPlayerPower : null)
  } else {
    phase = 'aiThink'
    aiT = 0
    aiPlanned = null
    hud.banner('ENEMY TURN')
  }
}

function aiPickWeapon(): WeaponDef {
  const s = sides[1]
  const has = (id: string) => (s.arsenal.get(id) ?? 0) > 0
  if (aiErr < 5 && Math.random() < 0.7) {
    for (const id of ['deathshead', 'nuke', 'funky', 'mirv', 'babynuke', 'bigmissile']) {
      if (has(id) && Math.random() < 0.6) return WEAPONS.find(w => w.id === id)!
    }
  } else if (aiErr < 9 && Math.random() < 0.35) {
    for (const id of ['babynuke', 'heavyroller', 'roller', 'leapfrog', 'bigmissile']) {
      if (has(id)) return WEAPONS.find(w => w.id === id)!
    }
  }
  return WEAPONS[0]
}

function updateAi(dt: number): void {
  if (phase === 'aiThink') {
    aiT += dt
    if (aiT < 0.75) return
    // Aim at wherever the player's cannon currently sits (it may have moved
    // to a surviving tower).
    const seat = world.cannonSeat(0)
    const mainTower = world.forts[0].towers[0]
    const target = {
      x: seat.x,
      y: Math.max(mainTower.rubbleY + 2, seat.y - 4),
      z: seat.z,
    }
    // Approximate the muzzle for planning: turret centre nudged toward the target.
    const p1 = sides[1].cannon.group.position
    const toward = new THREE.Vector3(target.x - p1.x, 0, target.z - p1.z).normalize()
    const origin = {
      x: p1.x + toward.x * 2.3,
      y: p1.y + 1.65 + 2.6,
      z: p1.z + toward.z * 2.3,
    }
    aiPlanned = planShot(world, origin, target, wind, aiErr, Math.random)
    aiStart = { az: sides[1].az, el: sides[1].el }
    // Normalize so the barrel swings the short way round.
    let dAz = aiPlanned.az - aiStart.az
    while (dAz > Math.PI) dAz -= Math.PI * 2
    while (dAz < -Math.PI) dAz += Math.PI * 2
    aiPlanned.az = aiStart.az + dAz
    aiAnimT = 0
    phase = 'aiAim'
  } else if (phase === 'aiAim' && aiPlanned) {
    aiAnimT += dt
    const t = Math.min(1, aiAnimT / 1.0)
    const e = t * t * (3 - 2 * t)
    sides[1].az = aiStart.az + (aiPlanned.az - aiStart.az) * e
    sides[1].el = aiStart.el + (aiPlanned.el - aiStart.el) * e
    applyCannonPose(1)
    if (t >= 1 && aiAnimT > 1.25) {
      const weapon = aiPickWeapon()
      const power = aiPlanned.power
      sides[1].az = aiPlanned.az
      sides[1].el = aiPlanned.el
      aiPlanned = null
      aiErr = Math.max(1.2, aiErr * 0.62)
      fireShot(1, weapon, power)
    }
  }
}

// ---------------------------------------------------------------- projectile stepping

function stepProjectiles(h: number): void {
  for (let i = projs.length - 1; i >= 0; i--) {
    const p = projs[i]
    p.vel.y -= GRAVITY * h
    p.vel.x += wind.x * WIND_ACCEL * h
    p.vel.z += wind.z * WIND_ACCEL * h
    if (p.weapon.kind === 'mirv' && !p.split && p.vel.y < 0) {
      doSplit(p)
      continue
    }
    const nx = p.pos.x + p.vel.x * h
    const ny = p.pos.y + p.vel.y * h
    const nz = p.pos.z + p.vel.z * h
    if (world.isSolid(nx, ny, nz)) {
      // Water swallows everything except dirt (which fills the lake).
      if (p.weapon.kind !== 'dirt' && world.isWater(nx, ny, nz)) {
        splash(p)
        continue
      }
      impact(p, p.pos.clone())
      continue
    }
    p.pos.set(nx, ny, nz)
    const hs = p.vel.x * p.vel.x + p.vel.z * p.vel.z
    if (hs > 1) p.hdir.set(p.vel.x, 0, p.vel.z).multiplyScalar(1 / Math.sqrt(hs))
    if (ny < -10 || nx < -40 || nx > GX + 40 || nz < -40 || nz > GZ + 40) {
      hud.msg('lost to the void')
      removeProj(p)
    }
  }
}

// ---------------------------------------------------------------- resolve & match end

function finishResolve(): void {
  // One more support pass — settling rubble can undermine what's left.
  if (world.updateSupport(Math.random) > 0) {
    resolveT = 0.5
    return
  }
  for (let s = 0; s < 2; s++) {
    const seat = world.cannonSeat(s)
    sides[s].targetX = seat.x
    sides[s].targetY = seat.y
    sides[s].targetZ = seat.z
  }
  placeAvatars()
  const iYou = world.integrity(0)
  const iFoe = world.integrity(1)
  hud.setIntegrity(iYou, iFoe)
  const youDead = iYou < COLLAPSE_AT
  const foeDead = iFoe < COLLAPSE_AT
  if (youDead || foeDead) {
    // Payout scales with damage dealt (measured before the collapse animation).
    const payYou = Math.round((1 - iFoe) * DMG_PAY) + (foeDead && !youDead ? WIN_BONUS : 0)
    const payFoe = Math.round((1 - iYou) * DMG_PAY) + (youDead && !foeDead ? WIN_BONUS : 0)
    // To the victor the spoils: the winner takes the loser's treasury and
    // arsenal before damage pay lands (so the loser isn't left with nothing).
    let plunder = 0
    if (foeDead && !youDead) {
      scoreYou++
      plunder = money[1]
      money[0] += plunder
      money[1] = 0
      lootArsenal(0, 1)
    } else if (youDead && !foeDead) {
      scoreFoe++
      plunder = money[0]
      money[1] += plunder
      money[0] = 0
      lootArsenal(1, 0)
    }
    money[0] += payYou
    money[1] += payFoe
    lastRoundResult =
      youDead && foeDead
        ? `Round ${round} drawn — mutual destruction. Salvage pay: $${payYou.toLocaleString()}`
        : foeDead
          ? `Round ${round} won! Earned $${payYou.toLocaleString()} and plundered $${plunder.toLocaleString()} plus their arsenal.`
          : `Round ${round} lost — the enemy plundered your treasury and arsenal. Damage pay: $${payYou.toLocaleString()}`
    const losers: number[] = []
    if (youDead) losers.push(0)
    if (foeDead) losers.push(1)
    for (const l of losers) world.collapseFort(l, Math.random)
    sfx.rumble()
    const loserTower = world.forts[losers[0]].towers[0]
    const center =
      losers.length === 2
        ? new THREE.Vector3(GX / 2, 14, GZ / 2)
        : new THREE.Vector3(loserTower.cx, loserTower.baseY + 6, loserTower.cz)
    endInfo =
      losers.length === 2
        ? { title: 'MUTUAL DESTRUCTION', sub: 'Both forts have fallen.', center }
        : youDead
          ? { title: 'ROUND LOST', sub: 'Your fort has crumbled to rubble.', center }
          : { title: 'ROUND WON', sub: 'The enemy fort is demolished.', center }
    phase = 'end'
    endT = 0
    endShown = false
    hud.setIntegrity(youDead ? 0 : iYou, foeDead ? 0 : iFoe)
    hud.setStatus(round, ROUNDS, scoreYou, scoreFoe, money[0])
  } else {
    startTurn(1 - turn)
  }
}

// ---------------------------------------------------------------- rounds & armory

// Winner strips the loser's ammo stores; the loser restarts on the base loadout.
function lootArsenal(winner: number, loser: number): void {
  for (const w of WEAPONS) {
    const l = sides[loser].arsenal.get(w.id) ?? 0
    if (!Number.isFinite(l) || l <= 0) continue
    sides[winner].arsenal.set(w.id, (sides[winner].arsenal.get(w.id) ?? 0) + l)
  }
  sides[loser].arsenal = newArsenal()
  updateWeaponHud()
}

// (Re)build the current round's battlefield — same seed, so buying a tower in
// the armory adds it to the already-visible terrain.
function rebuildRoundWorld(): void {
  world.generate(roundSeed, forti)
  for (let s = 0; s < 2; s++) {
    const st = sides[s]
    const seat = world.cannonSeat(s)
    st.cannon.group.position.set(seat.x, seat.y, seat.z)
    st.targetX = seat.x
    st.targetY = seat.y
    st.targetZ = seat.z
    st.fallV = 0
  }
  placeAvatars()
}

function setupRoundWorld(): void {
  for (const p of [...projs]) removeProj(p)
  for (const t of tasks) {
    if (t.kind === 'roller') scene.remove(t.mesh)
  }
  tasks.length = 0
  roundSeed = Math.floor(Math.random() * 1e9)
  rebuildRoundWorld()
  for (let s = 0; s < 2; s++) {
    sides[s].az = s === 0 ? 0 : Math.PI
    sides[s].el = 55 * DEG
    applyCannonPose(s)
  }
  aiErr = 13
  endInfo = null
  flyHold = null
  shotThisRound = false
  clearLastTrails()
  hud.setIntegrity(1, 1)
  updateWeaponHud()
  hud.setPower(null, null)
  hud.setAngles(0, 55)
}

// The computer spends its winnings too: fortifications when flush, then
// cheap weapon volume first, big-ticket when rich.
function aiShop(): void {
  if (money[1] >= 8000 && forti[1].towers < 2 && Math.random() < 0.5) {
    money[1] -= 8000
    forti[1].towers++
  }
  if (money[1] >= 5000 && forti[1].height < 12 && Math.random() < 0.5) {
    money[1] -= 5000
    forti[1].height += 6
  }
  const caps: Record<string, number> = {
    babynuke: 4, mirv: 3, bigmissile: 20, nuke: 2, roller: 3, funky: 2,
    leapfrog: 2, heavyroller: 2, sandhog: 2, deathshead: 1,
  }
  const order = ['babynuke', 'mirv', 'bigmissile', 'nuke', 'roller', 'funky', 'leapfrog', 'heavyroller', 'sandhog', 'deathshead']
  let bought = true
  while (bought) {
    bought = false
    for (const id of order) {
      const w = WEAPONS.find(x => x.id === id)!
      const owned = sides[1].arsenal.get(id) ?? 0
      if (w.price !== undefined && money[1] >= w.price && owned < (caps[id] ?? 2)) {
        money[1] -= w.price
        sides[1].arsenal.set(id, owned + (w.pack ?? 1))
        bought = true
      }
    }
  }
}

const FORT_UPGRADES = [
  { name: 'Raise main tower (+6 levels)', price: 5000, max: 2, owned: () => forti[0].height / 6, apply: () => (forti[0].height += 6) },
  { name: 'Extra tower', price: 8000, max: 2, owned: () => forti[0].towers, apply: () => (forti[0].towers += 1) },
]

function shopItems() {
  return WEAPONS.filter(w => w.price !== undefined).map(w => ({
    name: w.name,
    owned: sides[0].arsenal.get(w.id) ?? 0,
    price: w.price!,
    pack: w.pack ?? 1,
  }))
}

function shopForts() {
  return FORT_UPGRADES.map(u => ({
    name: u.name,
    owned: u.owned(),
    price: u.price,
    maxed: u.owned() >= u.max,
  }))
}

function refreshShop(): void {
  hud.setStatus(round, ROUNDS, scoreYou, scoreFoe, money[0])
  hud.showShop(
    { round, rounds: ROUNDS, scoreYou, scoreFoe, money: money[0], result: lastRoundResult, items: shopItems(), forts: shopForts() },
    buyWeapon,
    buyFort,
    () => {
      hud.setStatus(round, ROUNDS, scoreYou, scoreFoe, money[0])
      startTurn(0)
      hud.banner(`ROUND ${round}`, 'your turn')
    }
  )
}

function openShop(): void {
  phase = 'shop'
  aiShop()
  rebuildRoundWorld() // the AI may have bought towers — show them
  refreshShop()
}

function buyWeapon(index: number): void {
  const forSale = WEAPONS.filter(w => w.price !== undefined)
  const w = forSale[index]
  if (!w || money[0] < w.price!) return
  money[0] -= w.price!
  sides[0].arsenal.set(w.id, (sides[0].arsenal.get(w.id) ?? 0) + (w.pack ?? 1))
  sfx.tick()
  updateWeaponHud()
  refreshShop()
}

function buyFort(index: number): void {
  const u = FORT_UPGRADES[index]
  if (!u || money[0] < u.price || u.owned() >= u.max) return
  money[0] -= u.price
  u.apply()
  sfx.tick()
  rebuildRoundWorld() // construction happens on the spot, behind the shop
  refreshShop()
}

function nextRound(): void {
  round++
  setupRoundWorld()
  openShop()
}

function fullReset(): void {
  round = 0
  scoreYou = 0
  scoreFoe = 0
  money[0] = START_CASH
  money[1] = START_CASH
  lastRoundResult = ''
  for (let s = 0; s < 2; s++) {
    sides[s].arsenal = newArsenal()
    sides[s].wsel = 0
    forti[s].height = 0
    forti[s].towers = 0
  }
  nextRound()
}

// ---------------------------------------------------------------- input

window.addEventListener('keydown', e => {
  sfx.unlock()
  keys.add(e.code)
  if (e.code === 'Tab') {
    e.preventDefault()
    if (phase === 'aim' || phase === 'charge') cycleWeapon(e.shiftKey ? -1 : 1)
  }
  if (e.code === 'Space') {
    e.preventDefault()
    if (phase === 'aim' && !e.repeat) {
      phase = 'charge'
      chargeT = 0
      chargePower = 0
    }
  }
  if (e.code === 'KeyV') toggleWorldView()
  if (/^Digit[1-9]$/.test(e.code)) {
    // Digits address the visible (owned) list, not the full roster.
    const list = visibleWeapons()
    const n = parseInt(e.code.slice(5)) - 1
    if (n < list.length) selectWeapon(list[n])
  }
})

window.addEventListener('keyup', e => {
  keys.delete(e.code)
  if (e.code === 'Space' && phase === 'charge') {
    const power = Math.max(8, chargePower)
    lastPlayerPower = power
    const weapon = WEAPONS[sides[0].wsel]
    fireShot(0, weapon, power)
  }
})

window.addEventListener('blur', () => keys.clear())
window.addEventListener('pointerdown', () => sfx.unlock())

function updatePlayerAim(dt: number): void {
  if (phase !== 'aim' && phase !== 'charge') return
  const s = sides[0]
  const fine = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 0.28 : 1
  const azRate = 0.9 * fine * dt
  const elRate = 0.6 * fine * dt
  if (keys.has('ArrowLeft')) s.az -= azRate
  if (keys.has('ArrowRight')) s.az += azRate
  if (keys.has('ArrowUp')) s.el = Math.min(85 * DEG, s.el + elRate)
  if (keys.has('ArrowDown')) s.el = Math.max(12 * DEG, s.el - elRate)
  applyCannonPose(0)
  let azDeg = (s.az * 180) / Math.PI
  while (azDeg > 180) azDeg -= 360
  while (azDeg < -180) azDeg += 360
  hud.setAngles(azDeg, (s.el * 180) / Math.PI)
  if (phase === 'charge') {
    chargeT += dt
    const cyc = (chargeT * 62) % 200
    chargePower = cyc <= 100 ? cyc : 200 - cyc
    hud.setPower(chargePower, shotThisRound ? lastPlayerPower : null)
  }
}

// ---------------------------------------------------------------- cannon settling

function updateCannons(dt: number): void {
  for (let s = 0; s < 2; s++) {
    const st = sides[s]
    const g = st.cannon.group
    // Slide toward the current top-of-castle column, fall/climb to its height.
    const step = 6 * dt
    g.position.x += Math.max(-step, Math.min(step, st.targetX - g.position.x))
    g.position.z += Math.max(-step, Math.min(step, st.targetZ - g.position.z))
    if (g.position.y > st.targetY + 0.02) {
      st.fallV += GRAVITY * 0.8 * dt
      g.position.y = Math.max(st.targetY, g.position.y - st.fallV * dt)
      if (g.position.y === st.targetY) st.fallV = 0
    } else if (g.position.y < st.targetY - 0.02) {
      // Buried by a dirt ball — climb back on top of the pile.
      g.position.y = Math.min(st.targetY, g.position.y + 6 * dt)
    }
  }
}

// ---------------------------------------------------------------- main loop

let acc = 0
let last = performance.now()

function tick(now: number): void {
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000))
  last = now

  updatePlayerAim(dt)
  updateAi(dt)

  acc += dt
  while (acc >= STEP) {
    acc -= STEP
    if (projs.length) stepProjectiles(STEP)
  }

  // Trails advance once per frame, not per physics step.
  for (const p of projs) {
    p.mesh.position.copy(p.pos)
    p.mesh.rotation.x += dt * 4
    p.mesh.rotation.z += dt * 3
    if (p.trailN < 600) {
      p.trailPos[p.trailN * 3] = p.pos.x
      p.trailPos[p.trailN * 3 + 1] = p.pos.y
      p.trailPos[p.trailN * 3 + 2] = p.pos.z
      p.trailN++
      p.trailLine.geometry.setDrawRange(0, p.trailN)
      ;(p.trailLine.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
    }
  }

  updateTasks(dt)
  world.stepDebris(dt)
  world.renderDebris()
  world.updateWater(dt)
  if (world.dirty) world.rebuild()
  updateFx(dt)
  updateCannons(dt)

  if (phase === 'fly' && projs.length === 0 && tasks.length === 0) {
    phase = 'resolve'
    resolveT = 0
  }
  if (phase === 'resolve') {
    resolveT += dt
    if (world.debris.length === 0 && resolveT > 1.1) finishResolve()
  }
  if (phase === 'end') {
    endT += dt
    if (!endShown && endT > 3.0 && endInfo) {
      endShown = true
      const decided = round >= ROUNDS || scoreYou > ROUNDS / 2 || scoreFoe > ROUNDS / 2
      if (decided) {
        const title = scoreYou > scoreFoe ? 'VICTORY' : scoreYou < scoreFoe ? 'DEFEAT' : 'DRAW'
        hud.showEnd(title, `Final score ${scoreYou} — ${scoreFoe} over ${round} rounds.`, fullReset)
      } else {
        nextRound()
      }
    }
  }

  // Your previous arc lights up while you line up the next shot.
  const readying = phase === 'aim' || phase === 'charge'
  for (const t of lastTrails) {
    const m = t.material as THREE.LineBasicMaterial
    m.opacity = readying ? 0.95 : 0.3
    m.color.setHex(readying ? 0xd5473a : 0x8a929b)
  }

  updateHint()
  updateCamera(dt)
  // Keep the wind compass screen-relative: arrow points where the wind pushes
  // on screen, whichever way the camera currently faces.
  hud.orientWind(camLookCur.x - camPosCur.x, camLookCur.z - camPosCur.z)
  if (!skipRender) {
    renderer.render(scene, camera)
    renderSideView()
  }
}

let skipRender = false

fullReset()
hud.banner('SCORCHED VOXELS', 'demolish the enemy fort before yours falls', 2600)
renderer.setAnimationLoop(tick)

// Debug hook: lets automated tooling drive the simulation when rAF is throttled
// (e.g. headless preview tabs). Harmless in normal play.
declare global {
  interface Window {
    __sv?: { pump: (seconds: number) => void; state: () => object; world: World; newMatch: () => void }
  }
}
let fakeNow = 0
window.__sv = {
  pump(seconds: number) {
    if (fakeNow < last) fakeNow = last
    const frames = Math.ceil(seconds * 60)
    for (let i = 0; i < frames; i++) {
      fakeNow += 1000 / 60
      skipRender = i < frames - 1
      tick(fakeNow)
    }
    skipRender = false
  },
  state: () => ({
    phase,
    turn,
    projs: projs.length,
    tasks: tasks.length,
    debris: world.debris.length,
    integrity: [world.integrity(0), world.integrity(1)],
    wind,
    power: chargePower,
    lastImpact: { x: lastImpact.x, y: lastImpact.y, z: lastImpact.z },
    avatars: avatars.map(a => ({ x: a.position.x, y: a.position.y, z: a.position.z })),
    proj0: projs[0]
      ? { x: projs[0].pos.x, y: projs[0].pos.y, z: projs[0].pos.z, vx: projs[0].vel.x, vy: projs[0].vel.y, vz: projs[0].vel.z }
      : null,
  }),
  world,
  newMatch: fullReset,
}
