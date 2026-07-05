// Scorched Earth 3D — main entry: scene, game loop, turns, camera, input.
import * as THREE from 'three'
import { World, GX, GY, GZ, GRAVITY, WIND_ACCEL, EMPTY, WATER, type Wind, type Fortifications } from './world'
import { WEAPONS, FUNKY_CHILD, newArsenal, speedOf, type WeaponDef } from './weapons'
import { planShot } from './ai'
import { createHud } from './hud'
import { makeAvatar, standingY } from './avatar'
import { Village } from './village'
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

const hemi = new THREE.HemisphereLight(0xffffff, 0xd4d9df, 1.2)
scene.add(hemi)
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
const village = new Village(scene)
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
    avatars[s].rotation.y = s === 0 ? 0 : -Math.PI
  }
}

// The Zombie King: a hulking dull-blue figure with a golden crown. He sleeps
// in the cemetery until a flashlight beam lands on him.
const KING_BLUE = 0x3a5170
const kingAvatar = makeAvatar(KING_BLUE)
kingAvatar.scale.setScalar(1.45)
{
  const crownMat = new THREE.MeshLambertMaterial({ color: 0xe8c437 })
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.14, 0.92), crownMat)
  band.position.y = 0.57
  kingAvatar.add(band)
  for (const [px, pz] of [
    [-0.33, -0.33],
    [0.33, -0.33],
    [-0.33, 0.33],
    [0.33, 0.33],
  ]) {
    const spike = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.32, 0.14), crownMat)
    spike.position.set(px, 0.76, pz)
    kingAvatar.add(spike)
  }
}
kingAvatar.visible = false
scene.add(kingAvatar)

// "Zzz" snore sprite that floats over the sleeping King.
const snoreSprite = (() => {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 64
  const g = c.getContext('2d')!
  g.fillStyle = '#cdd6e0'
  g.font = 'bold 30px Helvetica, Arial, sans-serif'
  g.textBaseline = 'middle'
  g.fillText('z', 8, 46)
  g.font = 'bold 40px Helvetica, Arial, sans-serif'
  g.fillText('z', 40, 36)
  g.font = 'bold 52px Helvetica, Arial, sans-serif'
  g.fillText('Z', 80, 26)
  const tex = new THREE.CanvasTexture(c)
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }))
  sp.scale.set(1.6, 0.8, 1)
  sp.visible = false
  scene.add(sp)
  return sp
})()

// Repaint an avatar's body (used for zombification; eyes stay black).
function tintAvatar(av: THREE.Group, hex: number): void {
  av.traverse(o => {
    const m = o as THREE.Mesh
    if (m.isMesh) {
      const mat = m.material as THREE.MeshLambertMaterial
      if (mat.color && mat.color.getHex() !== 0x000000 && mat.color.getHex() !== 0xe8c437) mat.color.setHex(hex)
    }
  })
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

type Phase = 'aim' | 'charge' | 'fly' | 'resolve' | 'aiThink' | 'aiAim' | 'end' | 'shop' | 'night'

// Match economy: a match is best-of-ROUNDS; damage earns cash, spent in the armory.
const ROUNDS = 5
const START_CASH = 0 // wealth comes from the night scavenge
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

// ---------------------------------------------------------------- day/night cycle

const DAY_LEN = 70 // seconds of daylight combat before sunset
const NIGHT_LEN = 150 // seconds of real-time night scavenging
const TRANS_LEN = 3.5 // rapid sunset / dawn

type CycleMode = 'day' | 'sunset' | 'night' | 'dawn'
let cycleMode: CycleMode = 'day'
let dayT = 0
let nightRound = 0
let nightBlend = 0 // 0 = full day, 1 = full night

const SKY_DAY = new THREE.Color(0xeef1f4)
const SKY_DUSK = new THREE.Color(0xe8a06b)
const SKY_NIGHT = new THREE.Color(0x06080d)
const _sky = new THREE.Color()

function applyLighting(): void {
  const b = nightBlend
  // Ramp through a warm sunset on the way down (and back up at dawn).
  // Night is nearly absolute dark — the flashlight is your world.
  if (b < 0.5) _sky.copy(SKY_DAY).lerp(SKY_DUSK, b * 2)
  else _sky.copy(SKY_DUSK).lerp(SKY_NIGHT, (b - 0.5) * 2)
  ;(scene.background as THREE.Color).copy(_sky)
  ;(scene.fog as THREE.Fog).color.copy(_sky)
  // Night is nearly absolute dark — barely any ambient, so the flashlight is
  // genuinely your only world.
  hemi.intensity = 1.2 - b * 1.185
  sun.intensity = 1.7 * (1 - b)
  world.setNightBlend(b)
  village.setNightBlend(b)
  flashlight.visible = b > 0.55 && !walker.zombie
  lantern.visible = b > 0.55
  kingGlow.intensity = 0 // the King does not glow; he sleeps in the dark
}

// Night is TURN-BASED: you → the enemy avatar → the Zombie King, round and
// round until dawn. On your turn: WASD taps hop one grid space each (4 per
// turn), arrow keys look around (free), F or click shoots (that's your whole
// turn), Enter passes. The King moves 2, has no weapons — he turns you.
// yaw = view direction (arrow keys, drives camera + flashlight);
// face = body orientation (follows the last hop). Kept separate so strafing
// never spins your camera.
type NightActor = { x: number; y: number; z: number; yaw: number; face: number; pitch: number; zombie: boolean; stunned: boolean }
const walker: NightActor = { x: 0, y: 0, z: 0, yaw: 0, face: 0, pitch: -0.15, zombie: false, stunned: false }
const foe: NightActor = { x: 0, y: 0, z: 0, yaw: Math.PI, face: Math.PI, pitch: -0.3, zombie: false, stunned: false }
const king: NightActor = { x: 0, y: 0, z: 0, yaw: 0, face: 0, pitch: -0.3, zombie: false, stunned: false }

// Real-time night. Everyone moves at once: you and the enemy at full walking
// speed, the King shambling at a quarter of it — until he SEES someone, when
// he BURSTS at double human speed for 1.5s, rests 2s, and bursts again.
// Hunters only know where you are while they have line of sight.
const WALK_SPEED = 6
const KING_SPEED = WALK_SPEED / 4
const BURST_SPEED = WALK_SPEED * 2
const ZOMBIE_PLAYER_SPEED = WALK_SPEED / 2

// The King sleeps in the cemetery until a flashlight beam lands on him; then he
// wakes and charges the light. He can't enter houses. Catch a player outdoors
// and their night haul is dumped in the cemetery and that player is jailed
// there — freed only when someone else grabs the deposited loot.
type KingMood = 'asleep' | 'chasing' | 'returning'
let kingMood: KingMood = 'asleep'
let kingHuntT = 0 // grace seconds still hunting after losing the light
let kingChaseGoal: { x: number; z: number } | null = null
let kingSeesYou = false // he's awake and coming for YOU (drives the banner)
let snoreT = 0
// Cemetery jail: which player (if any) is imprisoned there.
let jailed: 'you' | 'foe' | null = null
// Deposited loot that lives in the cemetery and PERSISTS across nights until
// someone dares to take it.
type Stash = { kind: 'cash' | 'weapon'; value: number; weaponId?: string }
let cemeteryStash: Stash[] = []
// Flashlight is the night's whole game: space toggles it. Off = hidden but
// blind; on = you can see — and be seen. Catch the other player in your beam
// and they freeze for 4 seconds and drop half their haul.
let flashlightOn = true
let foeTarget: { x: number; z: number } | null = null
let foeStepDir: { x: number; z: number } | null = null
let foeRepathT = 0
const stunImmune = new Map<NightActor, number>()
let foeCashGain = 0
const foeItemsGain: { id: string; qty: number }[] = []
const look = { yaw: 0, pitch: 0 } // eased arrow-key view velocity
let nightCashGain = 0
const nightItemsGain: { id: string; qty: number }[] = []

// Crisp-edged beam: low penumbra so there's no soft ambient halo bleeding
// past the cone — just a hard circle of light in the dark.
const flashlight = new THREE.SpotLight(0xfff1cf, 1050, 60, 0.4, 0.12, 1.7)
flashlight.visible = false
flashlight.castShadow = true // walls really block the beam — interiors stay black
flashlight.shadow.mapSize.set(1024, 1024)
flashlight.shadow.camera.near = 0.4
flashlight.shadow.camera.far = 55
flashlight.shadow.bias = -0.002
scene.add(flashlight)
scene.add(flashlight.target)
// A tight, dim glow hugging the avatar so its body reads — small enough that it
// doesn't pool ambient light on the ground around you.
const lantern = new THREE.PointLight(0xffe4b0, 6, 4.5, 2.2)
lantern.visible = false
scene.add(lantern)
// The King's green aura.
const kingGlow = new THREE.PointLight(0x46e07a, 0, 13, 1.4)
scene.add(kingGlow)
// Zombified players glow green too.
const zombGlowYou = new THREE.PointLight(0x46e07a, 0, 10, 1.5)
const zombGlowFoe = new THREE.PointLight(0x46e07a, 0, 10, 1.5)
scene.add(zombGlowYou)
scene.add(zombGlowFoe)

// Actors also carry a freeze timer (arrow stuns) and a tunnel cooldown —
// kept outside the type via maps.
const frozen = new Map<NightActor, number>()
const tunnelCooldown = new Map<NightActor, number>()

type Loot = {
  mesh: THREE.Mesh
  kind: 'cash' | 'weapon'
  value: number
  weaponId?: string
  baseY: number
  bob: number
  bId: number | null // inside this building — invisible until it's revealed
  cemetery?: boolean // deposited by the King; grabbing it frees the prisoner
}
const loot: Loot[] = []

// Tunnels: red pads near the city's corners, each linked to the opposite
// corner. Players may always use them — but the first use opens them to the
// King and his zombies for the rest of the night.
type Tunnel = { x: number; z: number; mesh: THREE.Mesh; to: number }
const tunnels: Tunnel[] = []
let tunnelsUsed = false

function clearTunnels(): void {
  for (const t of tunnels) {
    scene.remove(t.mesh)
    t.mesh.geometry.dispose()
    ;(t.mesh.material as THREE.Material).dispose()
  }
  tunnels.length = 0
}

// Tunnel mouths hide INSIDE buildings (the board's red dots sit in rooms):
// four random buildings get a pad, linked crosswise — you won't find one
// until you light the room up.
function spawnTunnels(): void {
  clearTunnels()
  tunnelsUsed = false
  const picks = [...village.buildings].sort(() => Math.random() - 0.5).slice(0, 4)
  picks.forEach((b, i) => {
    let x = Math.round(b.cx)
    let z = Math.round(b.cz)
    for (let tries = 0; tries < 14; tries++) {
      if (hopWalkable(x, z, x, z, village.baseY + 0.5)) break
      x = Math.round(b.cx + (Math.random() - 0.5) * 4)
      z = Math.round(b.cz + (Math.random() - 0.5) * 4)
    }
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.55, 0.08, 20),
      new THREE.MeshBasicMaterial({ color: 0xef4444 })
    )
    mesh.position.set(x, solidGroundY(x, z, GY - 1) + 0.56, z)
    mesh.visible = b.revealed // hidden until the room is active
    scene.add(mesh)
    // Pads link crosswise: 0↔2, 1↔3.
    tunnels.push({ x, z, mesh, to: (i + 2) % 4 })
  })
}
type Arrow = { mesh: THREE.Mesh; vel: THREE.Vector3; life: number; stuck: boolean }
const arrows: Arrow[] = []
let lootT = 0

// Weapon drops, cheap-biased.
const LOOT_POOL = ['bigmissile', 'dirtclod', 'tracer', 'babyroller', 'riotcharge', 'babysandhog', 'napalm', 'dirtball', 'leapfrog', 'babynuke', 'roller', 'funky', 'sandhog', 'mirv', 'nuke']

// Highest solid, non-water cell at (x,z) scanning down from fromY — the floor
// under a point, ignoring any roof above it.
function solidGroundY(x: number, z: number, fromY: number): number {
  const rx = Math.round(x)
  const rz = Math.round(z)
  if (rx < 0 || rx >= GX || rz < 0 || rz >= GZ) return 0
  for (let y = Math.min(GY - 1, Math.floor(fromY)); y >= 0; y--) {
    const c = world.cellAt(rx, y, rz)
    if (c !== EMPTY && c !== WATER) return y
  }
  return 0
}

function clearLoot(): void {
  for (const l of loot) {
    scene.remove(l.mesh)
    l.mesh.geometry.dispose()
    ;(l.mesh.material as THREE.Material).dispose()
  }
  loot.length = 0
}

function clearArrows(): void {
  for (const a of arrows) {
    scene.remove(a.mesh)
    a.mesh.geometry.dispose()
  }
  arrows.length = 0
}

// Money bags (gold) and weapon crates (pale blue), scattered through the
// village streets and interiors. Lambert materials: they emit NO light —
// you find them with the flashlight.
function dropLoot(x: number, z: number, kind: 'cash' | 'weapon', value: number, weaponId?: string, cemetery = false): void {
  const gy = solidGroundY(x, z, GY - 1)
  const mesh =
    kind === 'cash'
      ? new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 0.55), new THREE.MeshLambertMaterial({ color: 0xffd34d }))
      : new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.75, 0.75), new THREE.MeshLambertMaterial({ color: 0xaef0ff }))
  const b = cemetery ? null : village.buildingAt(x, z)
  const l: Loot = { mesh, kind, value, weaponId, baseY: gy + 1.1, bob: Math.random() * 6, bId: b ? b.id : null, cemetery }
  mesh.visible = cemetery || !b || b.revealed // items in dark rooms can't be seen at all
  mesh.position.set(x, l.baseY, z)
  scene.add(mesh)
  loot.push(l)
}

// A deposited offering, scattered around the cemetery's grave plots.
function dropCemeteryLoot(s: Stash): void {
  const cx = (village.cemetery.x0 + village.cemetery.x1) / 2
  const cz = (village.cemetery.z0 + village.cemetery.z1) / 2
  const x = Math.round(cx + (Math.random() - 0.5) * 6)
  const z = Math.round(cz + (Math.random() - 0.5) * 4)
  dropLoot(x, z, s.kind, s.value, s.weaponId, true)
}

function spawnLoot(): void {
  clearLoot()
  const target = 12 + Math.floor(Math.random() * 4)
  for (let attempt = 0; attempt < 120 && loot.length < target; attempt++) {
    const x = Math.round(village.ox + 3 + Math.random() * (village.sx - 6))
    const z = Math.round(village.oz + 3 + Math.random() * (village.sz - 6))
    if (world.isWaterTop(x, z)) continue
    if (village.inCemetery(x, z)) continue
    if (!hopWalkable(x, z, x, z, village.baseY + 0.5)) continue
    const isCash = loot.length % 3 !== 2 // ~2/3 cash, 1/3 weapon crates
    if (isCash) {
      dropLoot(x, z, 'cash', 75 + Math.floor(Math.random() * 14) * 25)
    } else {
      const id = LOOT_POOL[Math.floor(Math.pow(Math.random(), 2.2) * LOOT_POOL.length)]
      const def = WEAPONS.find(v => v.id === id)!
      dropLoot(x, z, 'weapon', def.pack ?? 1, id)
    }
  }
  // The cemetery's persistent hoard reappears wherever it was left.
  for (const s of cemeteryStash) dropCemeteryLoot(s)
}

// The enemy scavenges by its own flashlight — a visible beam you can track
// (and sneak around) in the dark. No shadows on it, for performance.
const foeLight = new THREE.SpotLight(0xfff1cf, 650, 40, 0.45, 0.55, 1.6)
foeLight.visible = false
scene.add(foeLight)
scene.add(foeLight.target)

// Is `dst` caught in a beam shone from src's eye along `dir`? Tight cone,
// limited reach, and walls block it.
function inBeam(srcX: number, srcY: number, srcZ: number, dirX: number, dirY: number, dirZ: number, dst: NightActor): boolean {
  const dx = dst.x - srcX
  const dy = dst.y + 1 - srcY
  const dz = dst.z - srcZ
  const dist = Math.hypot(dx, dy, dz)
  if (dist > 20 || dist < 0.5) return false
  const dot = (dx * dirX + dy * dirY + dz * dirZ) / dist
  if (dot < 0.94) return false // ~20° cone
  return los(srcX, srcY, srcZ, dst.x, dst.y + 1, dst.z, 22)
}

// Caught in the light: 4 seconds frozen, half the night's haul spilled.
function beamStun(victim: 'you' | 'foe'): void {
  const a = actorOf(victim)
  frozen.set(a, 4)
  stunImmune.set(a, 9) // 4s stun + 5s grace before they can be caught again
  sfx.boom(1.2)
  if (victim === 'you') {
    const dropCash = Math.floor(nightCashGain / 2)
    if (dropCash > 0) {
      money[0] -= dropCash
      nightCashGain -= dropCash
      dropLoot(Math.round(walker.x), Math.round(walker.z), 'cash', dropCash)
    }
    for (const it of nightItemsGain) {
      const half = Math.floor(it.qty / 2)
      if (half <= 0) continue
      const have = sides[0].arsenal.get(it.id) ?? 0
      sides[0].arsenal.set(it.id, Math.max(0, have - half))
      it.qty -= half
      dropLoot(Math.round(walker.x + (Math.random() - 0.5) * 3), Math.round(walker.z + (Math.random() - 0.5) * 3), 'weapon', half, it.id)
    }
    updateWeaponHud()
    hud.setStatus(round, ROUNDS, scoreYou, scoreFoe, money[0])
    hud.banner('CAUGHT IN THE LIGHT', 'stunned — you dropped half your haul')
  } else {
    const dropCash = Math.floor(foeCashGain / 2)
    if (dropCash > 0) {
      money[1] -= dropCash
      foeCashGain -= dropCash
      dropLoot(Math.round(foe.x), Math.round(foe.z), 'cash', dropCash)
    }
    for (const it of foeItemsGain) {
      const half = Math.floor(it.qty / 2)
      if (half <= 0) continue
      const have = sides[1].arsenal.get(it.id) ?? 0
      sides[1].arsenal.set(it.id, Math.max(0, have - half))
      it.qty -= half
      dropLoot(Math.round(foe.x + (Math.random() - 0.5) * 3), Math.round(foe.z + (Math.random() - 0.5) * 3), 'weapon', half, it.id)
    }
    hud.msg('you caught the enemy in your beam — it dropped loot!')
  }
}

function updateArrows(dt: number): void {
  for (let i = arrows.length - 1; i >= 0; i--) {
    const a = arrows[i]
    if (a.stuck) {
      a.life -= dt
      if (a.life <= 0) {
        scene.remove(a.mesh)
        a.mesh.geometry.dispose()
        arrows.splice(i, 1)
      }
      continue
    }
    a.vel.y -= GRAVITY * 0.55 * dt // arrows arc gently
    a.mesh.position.addScaledVector(a.vel, dt)
    const p = a.mesh.position
    if (a.vel.lengthSq() > 0.01) a.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), a.vel.clone().normalize())
    // Living targets first: the enemy avatar and the King.
    if (phase === 'night') {
      if (Math.hypot(p.x - foe.x, p.y - (foe.y + 1), p.z - foe.z) < 1.1) {
        frozen.set(foe, 1.5)
        dropLoot(Math.round(foe.x), Math.round(foe.z), 'cash', 150) // knocked loose
        hud.msg('hit! the enemy is stunned and drops loot')
        sfx.boom(1)
        scene.remove(a.mesh)
        a.mesh.geometry.dispose()
        arrows.splice(i, 1)
        continue
      }
      if (Math.hypot(p.x - king.x, p.y - (king.y + 1.4), p.z - king.z) < 1.5) {
        knockKing(a.vel.x, a.vel.z)
        hud.msg('the King staggers back')
        sfx.boom(1.4)
        scene.remove(a.mesh)
        a.mesh.geometry.dispose()
        arrows.splice(i, 1)
        continue
      }
    }
    if (world.isSolid(p.x, p.y, p.z) || village.isSolidAt(p.x, p.y, p.z)) {
      a.stuck = true
      a.life = 5
    } else if (p.y < -10 || p.x < -30 || p.x > GX + 30 || p.z < -30 || p.z > GZ + 30) {
      scene.remove(a.mesh)
      a.mesh.geometry.dispose()
      arrows.splice(i, 1)
    }
  }
}

// An arrow can't kill the King, but it shoves him three spaces back.
function knockKing(vx: number, vz: number): void {
  for (let i = 0; i < 3; i++) {
    const dx = Math.abs(vx) >= Math.abs(vz) ? Math.sign(vx) : 0
    const dz = dx === 0 ? Math.sign(vz) || 1 : 0
    const tx = Math.round(king.x) + dx
    const tz = Math.round(king.z) + dz
    if (!hopWalkable(Math.round(king.x), Math.round(king.z), tx, tz, king.y)) break
    king.x = tx
    king.z = tz
    king.y = solidGroundY(tx, tz, king.y + 1.2) + 0.5
  }
}

function solidBody(x: number, y: number, z: number): boolean {
  if (village.isSolidAt(x, y, z)) return true
  const c = world.cellAt(Math.round(x), Math.round(y), Math.round(z))
  return c !== EMPTY && c !== WATER
}

type NightTag = 'you' | 'foe' | 'king'

function actorOf(t: NightTag): NightActor {
  return t === 'you' ? walker : t === 'foe' ? foe : king
}

// Smooth real-time movement with sliding collision. Axis-separated so walls
// deflect rather than stop you. maxStep limits climbing: 1.05 for people
// (stairs, terrain), 0.2-ish for the King (he cannot climb stairs).
function walkAxis(a: NightActor, nx: number, nz: number, maxStep: number, maxFeetY: number): boolean {
  if (nx < 3 || nx > GX - 4 || nz < 3 || nz > GZ - 4) return false
  if (world.isWaterTop(nx, nz)) return false
  const g = solidGroundY(nx, nz, a.y + maxStep + 0.3)
  const feet = g + 0.5
  if (feet - a.y > maxStep) return false
  if (feet > maxFeetY) return false
  if (solidBody(nx, Math.max(a.y, feet) + 0.6, nz) || solidBody(nx, Math.max(a.y, feet) + 1.6, nz)) return false
  a.x = nx
  a.z = nz
  if (feet > a.y) a.y = feet // step / stair up
  return true
}

function moveActor(a: NightActor, dx: number, dz: number, maxStep = 1.05, maxFeetY = 1e9): void {
  if (dx !== 0) walkAxis(a, a.x + dx, a.z, maxStep, maxFeetY)
  if (dz !== 0) walkAxis(a, a.x, a.z + dz, maxStep, maxFeetY)
  if (dx !== 0 || dz !== 0) a.face = Math.atan2(dz, dx)
}

// Gravity: fall when there's air underfoot (balcony drops, roof edges).
function actorGravity(a: NightActor, dt: number, vyRef: { v: number }): void {
  const g = solidGroundY(a.x, a.z, a.y + 0.2)
  const feet = g + 0.5
  if (a.y > feet + 0.02) {
    vyRef.v -= GRAVITY * dt
    a.y = Math.max(feet, a.y + vyRef.v * dt)
  } else {
    a.y = feet
    vyRef.v = 0
  }
}

// Line of sight at eye height — walls block hunters' knowledge of you.
function los(ax: number, ay: number, az: number, bx: number, by: number, bz: number, maxDist = 45): boolean {
  const dx = bx - ax
  const dy = by - ay
  const dz = bz - az
  const dist = Math.hypot(dx, dy, dz)
  if (dist > maxDist) return false
  const steps = Math.ceil(dist / 0.6)
  for (let i = 1; i < steps; i++) {
    const t = i / steps
    if (solidBody(ax + dx * t, ay + dy * t, az + dz * t)) return false
  }
  return true
}

function canSee(a: NightActor, b: NightActor): boolean {
  return los(a.x, a.y + 1.8, a.z, b.x, b.y + 1.8, b.z)
}

// Does a beam from (src, dir) land on the sleeping/standing King? Generous
// cone (he's a big target) with a wall-blocking line of sight.
function beamOnKing(sx: number, sy: number, sz: number, dx: number, dy: number, dz: number): boolean {
  const kx = king.x
  const ky = king.y + 0.7
  const kz = king.z
  const vx = kx - sx
  const vy = ky - sy
  const vz = kz - sz
  const dist = Math.hypot(vx, vy, vz)
  if (dist > 24 || dist < 0.5) return false
  if ((vx * dx + vy * dy + vz * dz) / dist < 0.9) return false // ~25° cone
  return los(sx, sy, sz, kx, ky, kz, 26)
}

// The King moves toward a point but NEVER steps inside a house (its interior
// footprint) and cannot climb — so stairs and second floors are safe from him.
function kingStepToward(tx: number, tz: number, speed: number, dt: number): void {
  const s = speed * dt
  const dxT = tx - king.x
  const dzT = tz - king.z
  const stepX = Math.sign(dxT) * Math.min(s, Math.abs(dxT))
  const stepZ = Math.sign(dzT) * Math.min(s, Math.abs(dzT))
  const nx = king.x + stepX
  if (!village.buildingAt(nx, king.z)) walkAxis(king, nx, king.z, 1.05, village.baseY + 1.6)
  const nz = king.z + stepZ
  if (!village.buildingAt(king.x, nz)) walkAxis(king, king.x, nz, 1.05, village.baseY + 1.6)
  if (dxT || dzT) {
    king.face = Math.atan2(dzT, dxT)
    king.yaw = king.face
  }
}

// Deposit a player's whole night haul into the cemetery hoard (persists across
// nights) and jail them there until someone else grabs the offering.
function kingAttack(who: 'you' | 'foe'): void {
  const idx = who === 'you' ? 0 : 1
  const cashGain = who === 'you' ? nightCashGain : foeCashGain
  const items = who === 'you' ? nightItemsGain : foeItemsGain
  if (cashGain > 0) {
    money[idx] -= cashGain
    const s: Stash = { kind: 'cash', value: cashGain }
    cemeteryStash.push(s)
    dropCemeteryLoot(s)
  }
  for (const it of items) {
    if (it.qty <= 0) continue
    const have = sides[idx].arsenal.get(it.id) ?? 0
    sides[idx].arsenal.set(it.id, Math.max(0, have - it.qty))
    const s: Stash = { kind: 'weapon', value: it.qty, weaponId: it.id }
    cemeteryStash.push(s)
    dropCemeteryLoot(s)
  }
  if (who === 'you') {
    nightCashGain = 0
    nightItemsGain.length = 0
    updateWeaponHud()
    hud.setStatus(round, ROUNDS, scoreYou, scoreFoe, money[0])
    hud.banner('DRAGGED TO THE CEMETERY', 'your haul is the King’s offering — someone must grab it to free you')
  } else {
    foeCashGain = 0
    foeItemsGain.length = 0
    hud.msg('the King seized the enemy — its haul lies in the cemetery')
  }
  // Cast the prisoner into the cemetery; the King lumbers back to sleep.
  const a = actorOf(who)
  const cx = (village.cemetery.x0 + village.cemetery.x1) / 2
  const cz = (village.cemetery.z0 + village.cemetery.z1) / 2
  a.x = cx + (who === 'you' ? -2 : 2)
  a.z = cz
  a.y = solidGroundY(a.x, a.z, GY - 1) + 0.5
  jailed = who
  kingMood = 'returning'
  kingSeesYou = false
  sfx.rumble()
}

// Can an actor hop from (fromX,fromZ) onto cell (tx,tz)? Checks the target
// cell AND the midpoint of the hop, so wall planes sitting on cell boundaries
// really do block — houses can only be entered through their doorways.
function hopWalkable(fromX: number, fromZ: number, tx: number, tz: number, fromY: number): boolean {
  if (tx < 3 || tx > GX - 4 || tz < 3 || tz > GZ - 4) return false
  if (world.isWaterTop(tx, tz)) return false
  const g = solidGroundY(tx, tz, fromY + 1.2)
  const feet = g + 0.5
  if (Math.abs(feet - fromY) > 1.05) return false
  if (solidBody(tx, feet + 0.5, tz) || solidBody(tx, feet + 1.5, tz)) return false
  const mx = (fromX + tx) / 2
  const mz = (fromZ + tz) / 2
  if (solidBody(mx, fromY + 0.5, mz) || solidBody(mx, fromY + 1.5, mz)) return false
  return true
}


// Breadth-first pathfinding on the hop grid (the King must find his way out
// of the cemetery gate; the enemy must find doors). Returns the first step.
function bfsStep(a: NightActor, target: { x: number; z: number }): { dx: number; dz: number } | null {
  const sx = Math.round(a.x)
  const sz = Math.round(a.z)
  const tx = Math.round(target.x)
  const tz = Math.round(target.z)
  if (sx === tx && sz === tz) return null
  const key = (x: number, z: number) => x * 4096 + z
  const cameFrom = new Map<number, number>()
  cameFrom.set(key(sx, sz), -1)
  const queue: { x: number; z: number }[] = [{ x: sx, z: sz }]
  let bestKey = key(sx, sz)
  let bestD = Math.hypot(sx - tx, sz - tz)
  let found = false
  for (let n = 0; n < 2600 && queue.length; n++) {
    const c = queue.shift()!
    if (c.x === tx && c.z === tz) {
      bestKey = key(c.x, c.z)
      found = true
      break
    }
    const d = Math.hypot(c.x - tx, c.z - tz)
    if (d < bestD) {
      bestD = d
      bestKey = key(c.x, c.z)
    }
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = c.x + dx
      const nz = c.z + dz
      const k = key(nx, nz)
      if (cameFrom.has(k)) continue
      if (!hopWalkable(c.x, c.z, nx, nz, a.y)) continue
      cameFrom.set(k, key(c.x, c.z))
      queue.push({ x: nx, z: nz })
    }
  }
  void found
  // Walk back from the best reachable cell to find the first step.
  let cur = bestKey
  let prev = cameFrom.get(cur)
  if (prev === undefined || prev === -1) return null
  while (prev !== -1 && prev !== key(sx, sz)) {
    cur = prev!
    prev = cameFrom.get(cur)
    if (prev === undefined) return null
  }
  const cx2 = Math.floor(cur / 4096)
  const cz2 = cur % 4096
  return { dx: cx2 - sx, dz: cz2 - sz }
}

// AI ----------------------------------------------------------------------

function pickFoeTarget(): { x: number; z: number } {
  if (foe.zombie) return { x: walker.x, z: walker.z }
  const unrevealed = village.buildings.filter(b => !b.revealed)
  if (unrevealed.length) {
    let best = unrevealed[0]
    let bd = 1e9
    for (const b of unrevealed) {
      const d = Math.hypot(b.doorX - foe.x, b.doorZ - foe.z)
      if (d < bd) {
        bd = d
        best = b
      }
    }
    // Head for the door first, then the interior.
    const atDoor = Math.hypot(best.doorX - foe.x, best.doorZ - foe.z) < 1.6
    return atDoor ? { x: best.cx, z: best.cz } : { x: best.doorX, z: best.doorZ }
  }
  if (loot.length) {
    let best = loot[0]
    let bd = 1e9
    for (const l of loot) {
      const d = Math.hypot(l.mesh.position.x - foe.x, l.mesh.position.z - foe.z)
      if (d < bd) {
        bd = d
        best = l
      }
    }
    return { x: best.mesh.position.x, z: best.mesh.position.z }
  }
  return { x: village.ox + village.sx / 2, z: village.oz + village.sz / 2 }
}


// Continuous sensing: reveal buildings you enter, pick up loot you touch,
// travel tunnels you step on.
function senseActor(t: NightTag): void {
  const a = actorOf(t)
  if (t !== 'king') {
    const bld = village.buildingAt(a.x, a.z)
    if (bld && !bld.revealed) {
      const name = village.reveal(bld)
      hud.banner(name.toUpperCase(), t === 'you' ? 'revealed — the lights stay on' : 'revealed by the enemy')
      sfx.pop()
      // The room is active now: its items (and any tunnel mouth) become visible.
      for (const l of loot) if (l.bId === bld.id) l.mesh.visible = true
      for (const tn of tunnels) {
        if (Math.abs(tn.x - bld.cx) < 6 && Math.abs(tn.z - bld.cz) < 6) tn.mesh.visible = true
      }
    }
    for (let i = loot.length - 1; i >= 0; i--) {
      const l = loot[i]
      if (!l.mesh.visible) continue // can't grab what can't be seen
      if (Math.hypot(l.mesh.position.x - a.x, l.mesh.position.z - a.z) > 1.2) continue
      if (t === 'you' && !walker.zombie) {
        if (l.kind === 'cash') {
          money[0] += l.value
          nightCashGain += l.value
          hud.msg(`+$${l.value}`)
          hud.setStatus(round, ROUNDS, scoreYou, scoreFoe, money[0])
        } else {
          const def = WEAPONS.find(v => v.id === l.weaponId)!
          sides[0].arsenal.set(def.id, (sides[0].arsenal.get(def.id) ?? 0) + l.value)
          nightItemsGain.push({ id: def.id, qty: l.value })
          updateWeaponHud()
          hud.msg(`+${l.value} ${def.name}`)
        }
      } else if (t === 'foe' && !foe.zombie) {
        if (l.kind === 'cash') {
          money[1] += l.value
          foeCashGain += l.value
        } else {
          const def = WEAPONS.find(v => v.id === l.weaponId)!
          sides[1].arsenal.set(def.id, (sides[1].arsenal.get(def.id) ?? 0) + l.value)
          foeItemsGain.push({ id: def.id, qty: l.value })
        }
        hud.msg('the enemy grabbed something')
      } else {
        continue // zombies don't loot
      }
      // Grabbing a cemetery offering frees the prisoner and unbanks that item.
      if (l.cemetery) {
        const si = cemeteryStash.findIndex(s => s.kind === l.kind && s.value === l.value && s.weaponId === l.weaponId)
        if (si >= 0) cemeteryStash.splice(si, 1)
        if (jailed && jailed !== t) {
          hud.banner('FREED', 'the prisoner is released from the cemetery')
          jailed = null
        }
      }
      sfx.pop()
      scene.remove(l.mesh)
      l.mesh.geometry.dispose()
      loot.splice(i, 1)
    }
  }
  // Tunnels: step on a red pad and surface at the linked one. Zombies (and
  // the King) may only follow once someone living has used them. A short
  // cooldown stops instant ping-ponging at the destination pad.
  const cd = tunnelCooldown.get(a) ?? 0
  const isZombieActor = t === 'king' || a.zombie
  if (cd <= 0 && (!isZombieActor || tunnelsUsed)) {
    for (const tn of tunnels) {
      if (Math.hypot(tn.x - a.x, tn.z - a.z) > 0.9) continue
      const dest = tunnels[tn.to]
      a.x = dest.x
      a.z = dest.z
      a.y = solidGroundY(dest.x, dest.z, GY - 1) + 0.5
      tunnelCooldown.set(a, 1.6)
      if (!isZombieActor && !tunnelsUsed) {
        tunnelsUsed = true
        hud.msg('the tunnel is open now — for everyone')
      } else {
        hud.msg(t === 'you' ? 'through the tunnel!' : 'something used a tunnel...')
      }
      sfx.pop()
      break
    }
  }
}

// Per-frame night update ---------------------------------------------------

// Per-actor vertical velocity for falls (balcony drops, roof edges).
const fallVel = { you: { v: 0 }, foe: { v: 0 }, king: { v: 0 } }

function updateNight(dt: number): void {
  if (phase !== 'night') return

  for (const [a, t] of frozen) frozen.set(a, Math.max(0, t - dt))
  for (const [a, t] of tunnelCooldown) tunnelCooldown.set(a, Math.max(0, t - dt))
  for (const [a, t] of stunImmune) stunImmune.set(a, Math.max(0, t - dt))

  // Arrow-key view: eased in and out ("slowing when starting and stopping").
  const yawT = (keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0)
  const pitchT = (keys.has('ArrowUp') ? 1 : 0) - (keys.has('ArrowDown') ? 1 : 0)
  look.yaw += (yawT * 2.1 - look.yaw) * Math.min(1, dt * 5)
  look.pitch += (pitchT * 1.4 - look.pitch) * Math.min(1, dt * 5)
  walker.yaw += look.yaw * dt
  walker.pitch = THREE.MathUtils.clamp(walker.pitch + look.pitch * dt, -1.1, 0.75)

  // ---- you: smooth WASD walking, camera-relative (locked while jailed)
  if ((frozen.get(walker) ?? 0) <= 0 && cycleMode !== 'dawn' && jailed !== 'you') {
    const fx = Math.cos(walker.yaw)
    const fz = Math.sin(walker.yaw)
    let mx = 0
    let mz = 0
    if (keys.has('KeyW')) {
      mx += fx
      mz += fz
    }
    if (keys.has('KeyS')) {
      mx -= fx
      mz -= fz
    }
    if (keys.has('KeyD')) {
      mx += -fz
      mz += fx
    }
    if (keys.has('KeyA')) {
      mx -= -fz
      mz -= fx
    }
    const len = Math.hypot(mx, mz)
    if (len > 0) {
      const speed = (walker.zombie ? ZOMBIE_PLAYER_SPEED : WALK_SPEED) * dt
      moveActor(walker, (mx / len) * speed, (mz / len) * speed)
      senseActor('you')
    }
  }
  actorGravity(walker, dt, fallVel.you)

  // ---- the enemy: same speed, loot-seeking (locked while jailed)
  if ((frozen.get(foe) ?? 0) <= 0 && jailed !== 'foe') {
    foeRepathT -= dt
    if (foeRepathT <= 0) {
      foeRepathT = 0.5
      if (foe.zombie) {
        // Zombies only know where you are while they can see you.
        foeTarget = canSee(foe, walker) ? { x: walker.x, z: walker.z } : foeTarget
      } else {
        foeTarget = pickFoeTarget()
      }
      const step = foeTarget ? bfsStep(foe, foeTarget) : null
      foeStepDir = step ? { x: step.dx, z: step.dz } : null
    }
    if (foeStepDir) {
      const speed = (foe.zombie ? ZOMBIE_PLAYER_SPEED : WALK_SPEED) * dt
      moveActor(foe, foeStepDir.x * speed, foeStepDir.z * speed)
      foe.yaw = foe.face
      senseActor('foe')
    }
  }
  actorGravity(foe, dt, fallVel.foe)

  // Beam directions (used by both the King's wake check and the duels).
  const beamDir = new THREE.Vector3(
    Math.cos(walker.yaw) * Math.cos(walker.pitch),
    Math.sin(walker.pitch),
    Math.sin(walker.yaw) * Math.cos(walker.pitch)
  )
  const youBeamOn = flashlightOn && cycleMode === 'night' && !walker.zombie && nightBlend > 0.55
  const foeBeamOn = cycleMode === 'night' && !foe.zombie && nightBlend > 0.55 && (frozen.get(foe) ?? 0) <= 0
  const foeBeamDir = { x: Math.cos(foe.face), y: -0.05, z: Math.sin(foe.face) }

  // ---- the Zombie King: asleep in the cemetery, dull and snoring, until a
  // flashlight beam lands on him. Then he wakes and charges the light. He can
  // never enter a house. Catch a player in the open and their night haul is
  // dumped in the cemetery and that player is jailed there.
  if (cycleMode === 'night') {
    // A jailed player's beam can't provoke the King (they're already his).
    let litBy: 'you' | 'foe' | null = null
    if (youBeamOn && jailed !== 'you' && beamOnKing(walker.x, walker.y + 1.9, walker.z, beamDir.x, beamDir.y, beamDir.z)) litBy = 'you'
    else if (foeBeamOn && jailed !== 'foe' && beamOnKing(foe.x, foe.y + 1.9, foe.z, foeBeamDir.x, foeBeamDir.y, foeBeamDir.z)) litBy = 'foe'

    if (kingMood === 'asleep') {
      snoreT += dt
      if (litBy) {
        kingMood = 'chasing'
        kingHuntT = 6
        kingSeesYou = litBy === 'you'
        kingChaseGoal = { x: actorOf(litBy).x, z: actorOf(litBy).z }
        sfx.rumble()
        hud.msg('the Zombie King wakes!')
      }
    } else if (kingMood === 'chasing') {
      if (litBy && jailed !== litBy) {
        kingHuntT = 6
        kingChaseGoal = { x: actorOf(litBy).x, z: actorOf(litBy).z }
        kingSeesYou = litBy === 'you'
      } else {
        kingHuntT -= dt
        if (kingHuntT <= 0) {
          kingMood = 'returning'
          kingSeesYou = false
        }
      }
      if (kingChaseGoal) kingStepToward(kingChaseGoal.x, kingChaseGoal.z, BURST_SPEED, dt)
      // Attack: seize an outdoor, un-jailed player he's reached.
      for (const who of ['you', 'foe'] as const) {
        const a = actorOf(who)
        if (jailed === who) continue
        if (village.buildingAt(a.x, a.z)) continue // safe indoors
        if (Math.hypot(a.x - king.x, a.z - king.z) < 1.6) kingAttack(who)
      }
    } else {
      // returning to his grave
      kingSeesYou = false
      const cx = (village.cemetery.x0 + village.cemetery.x1) / 2
      const cz = (village.cemetery.z0 + village.cemetery.z1) / 2
      kingStepToward(cx, cz, KING_SPEED * 2, dt)
      if (Math.hypot(king.x - cx, king.z - cz) < 1.4) {
        kingMood = 'asleep'
        snoreT = 0
      }
      // Re-woken en route.
      if (litBy && jailed !== litBy) {
        kingMood = 'chasing'
        kingHuntT = 6
        kingSeesYou = litBy === 'you'
        kingChaseGoal = { x: actorOf(litBy).x, z: actorOf(litBy).z }
      }
    }
  }
  actorGravity(king, dt, fallVel.king)
  hud.setBurst(kingSeesYou && cycleMode === 'night')

  // ---- flashlight duels: catch the other player in your cone and they
  // freeze for 4 seconds, spilling half their haul at their feet.
  if (
    flashlightOn && cycleMode === 'night' && !walker.zombie &&
    (frozen.get(foe) ?? 0) <= 0 && (stunImmune.get(foe) ?? 0) <= 0 &&
    inBeam(walker.x, walker.y + 1.9, walker.z, beamDir.x, beamDir.y, beamDir.z, foe)
  ) {
    beamStun('foe')
  }
  if (
    cycleMode === 'night' && !foe.zombie && (frozen.get(foe) ?? 0) <= 0 &&
    (frozen.get(walker) ?? 0) <= 0 && (stunImmune.get(walker) ?? 0) <= 0 &&
    inBeam(foe.x, foe.y + 1.9, foe.z, Math.cos(foe.face), -0.05, Math.sin(foe.face), walker)
  ) {
    beamStun('you')
  }

  // Drive bodies and lights. Your avatar faces the way you're aiming to go
  // (the view heading), so turning with the arrows spins it to face the
  // direction it will walk.
  avatars[0].position.set(walker.x, walker.y + 1.5, walker.z)
  avatars[0].rotation.y = -walker.yaw
  avatars[1].position.set(foe.x, foe.y + 1.5, foe.z)
  avatars[1].rotation.y = -foe.face
  // The King lies down when asleep (tipped onto his back, low to the ground),
  // and rises to his feet the moment he wakes.
  const asleep = kingMood === 'asleep'
  kingAvatar.rotation.set(asleep ? -Math.PI / 2 : 0, -king.face, 0)
  kingAvatar.position.set(king.x, king.y + (asleep ? 0.7 : 1.9), king.z)
  // Snoring "Zzz" bob above the sleeping King.
  snoreSprite.visible = asleep && cycleMode === 'night'
  if (snoreSprite.visible) {
    snoreSprite.position.set(king.x + 0.6, king.y + 1.6 + Math.sin(snoreT * 2.2) * 0.15, king.z)
    const s = 0.9 + 0.12 * Math.sin(snoreT * 4.4)
    snoreSprite.scale.set(1.6 * s, 0.8 * s, 1)
  }
  kingGlow.position.set(king.x, king.y + 2.6, king.z)
  zombGlowYou.position.set(walker.x, walker.y + 2.4, walker.z)
  zombGlowFoe.position.set(foe.x, foe.y + 2.4, foe.z)
  zombGlowYou.intensity = walker.zombie && nightBlend > 0.5 ? 55 : 0
  zombGlowFoe.intensity = foe.zombie && nightBlend > 0.5 ? 55 : 0

  // Your flashlight — space toggles it; off means hidden but blind.
  flashlight.visible = nightBlend > 0.55 && !walker.zombie && flashlightOn
  flashlight.position.set(walker.x, walker.y + 1.9, walker.z).addScaledVector(beamDir, 0.6)
  flashlight.target.position.copy(flashlight.position).addScaledVector(beamDir, 14)
  lantern.visible = nightBlend > 0.55 && flashlightOn
  lantern.position.set(walker.x, walker.y + 2.4, walker.z)
  lantern.color.setHex(walker.zombie ? 0x46e07a : 0xffe4b0)
  // The enemy's beam, tracking its facing — watch for it in the dark.
  foeLight.visible = nightBlend > 0.55 && !foe.zombie && (frozen.get(foe) ?? 0) <= 0
  foeLight.position.set(foe.x + Math.cos(foe.face) * 0.6, foe.y + 1.9, foe.z + Math.sin(foe.face) * 0.6)
  foeLight.target.position.set(foe.x + Math.cos(foe.face) * 14, foe.y + 1.2, foe.z + Math.sin(foe.face) * 14)

  // Loot: bob and spin (no light of their own — find them with the beam).
  lootT += dt
  for (const l of loot) {
    l.mesh.position.y = l.baseY + Math.sin(lootT * 3 + l.bob) * 0.15
    l.mesh.rotation.y += dt * 2
  }
}

function placeNightActor(a: NightActor, x: number, z: number, yaw: number): void {
  a.x = x
  a.z = z
  a.y = solidGroundY(x, z, GY - 1) + 0.5
  a.yaw = yaw
  a.face = yaw
  a.pitch = -0.15
  a.zombie = false
  a.stunned = false
}

function enterNight(): void {
  phase = 'night'
  cycleMode = 'sunset'
  nightRound = 0
  flyHold = null
  worldView = false
  hud.setWorldView(false)
  hud.banner('SUNSET', 'night falls on the village')
  // START positions: each player tucked BEHIND a building on their own side
  // (the house screens them from the cemetery), the King rising at its center.
  const westB = village.buildings.reduce((a, b) => (b.x0 < a.x0 ? b : a))
  const eastB = village.buildings.reduce((a, b) => (b.x1 > a.x1 ? b : a))
  const tuck = (a: NightActor, bx: number, bz: number, yaw: number) => {
    let x = bx
    let z = bz
    for (let i = 0; i < 14 && !hopWalkable(Math.round(x), Math.round(z), Math.round(x), Math.round(z), village.baseY + 0.5); i++) {
      x = bx + (Math.random() - 0.5) * 4
      z = bz + (Math.random() - 0.5) * 6
    }
    placeNightActor(a, x, z, yaw)
  }
  tuck(walker, westB.x0 - 1.6, (westB.z0 + westB.z1) / 2, 0)
  tuck(foe, eastB.x1 + 1.6, (eastB.z0 + eastB.z1) / 2, Math.PI)
  // The King is asleep dead center in his cemetery.
  placeNightActor(king, (village.cemetery.x0 + village.cemetery.x1) / 2, (village.cemetery.z0 + village.cemetery.z1) / 2, 0)
  nightCashGain = 0
  nightItemsGain.length = 0
  foeCashGain = 0
  foeItemsGain.length = 0
  flashlightOn = true
  kingAvatar.visible = true
  look.yaw = 0
  look.pitch = 0
  kingMood = 'asleep'
  kingHuntT = 0
  kingChaseGoal = null
  kingSeesYou = false
  snoreT = 0
  jailed = null
  foeTarget = null
  foeStepDir = null
  frozen.clear()
  tunnelCooldown.clear()
  stunImmune.clear()
  spawnLoot() // scatters fresh loot AND re-drops the cemetery's persistent hoard
  spawnTunnels()
  hud.setNightHint(true)
  hud.setCross(true)
}

function exitNight(): void {
  cycleMode = 'day'
  dayT = 0
  nightRound = 0
  nightBlend = 0
  applyLighting()
  clearLoot()
  clearArrows()
  clearTunnels()
  foeLight.visible = false
  hud.setNightHint(false)
  hud.setCross(false)
  hud.setNightTurn(null)
  hud.setBurst(false)
  kingAvatar.visible = false
  snoreSprite.visible = false
  // Dawn releases the prisoner back to their tower — but the cemetery hoard
  // they lost stays put (it persists until someone grabs it another night).
  jailed = null
  kingMood = 'asleep'
  walker.zombie = false
  foe.zombie = false
  tintAvatar(avatars[0], 0xc0392b)
  tintAvatar(avatars[1], 0x2f6fd6)
  placeAvatars() // back to the tower perches
  hud.setStatus(round, ROUNDS, scoreYou, scoreFoe, money[0])
  startTurn(0)
  hud.banner('DAWN', 'back to your cannon')
}

function updateCycle(dt: number): void {
  const combat =
    phase === 'aim' || phase === 'charge' || phase === 'fly' || phase === 'resolve' || phase === 'aiThink' || phase === 'aiAim'
  if (cycleMode === 'day') {
    if (combat) {
      dayT += dt
      // Sunset waits for a quiet moment — never mid-flight or mid-AI-turn.
      if (dayT >= DAY_LEN && phase === 'aim') enterNight()
    }
  } else if (cycleMode === 'sunset') {
    nightBlend = Math.min(1, nightBlend + dt / TRANS_LEN)
    applyLighting()
    if (nightBlend >= 1) cycleMode = 'night'
  } else if (cycleMode === 'night') {
    nightRound += dt // repurposed as elapsed night seconds
    if (nightRound >= NIGHT_LEN) {
      cycleMode = 'dawn'
      hud.setBurst(false)
      hud.banner('DAWN BREAKS', 'the night is over')
    }
  } else {
    nightBlend = Math.max(0, nightBlend - dt / TRANS_LEN)
    applyLighting()
    if (nightBlend <= 0) exitNight()
  }
  const frac =
    cycleMode === 'day'
      ? Math.min(1, dayT / DAY_LEN)
      : cycleMode === 'night'
        ? Math.min(1, nightRound / NIGHT_LEN)
        : cycleMode === 'sunset'
          ? nightBlend
          : 1 - nightBlend
  hud.setTime(cycleMode, frac)
}

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
  village.carveSphere(at.x, at.y, at.z, r)
  // Small blasts (the starting Baby Missile) only chip — no wall-toppling
  // shockwave. Real tower damage takes scavenged or purchased ordnance.
  if (fire && r >= 3) world.shockwave(at.x, at.y, at.z, r, Math.random)
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

  if (phase === 'night') {
    const act = walker
    const dir = new THREE.Vector3(
      Math.cos(act.yaw) * Math.cos(act.pitch),
      Math.sin(act.pitch),
      Math.sin(act.yaw) * Math.cos(act.pitch)
    )
    const head = new THREE.Vector3(act.x, act.y + 1.9, act.z)
    const indoors = !!village.buildingAt(act.x, act.z)
    if (indoors) {
      // Indoors the rooms are tight: keep the camera at head height just behind
      // the avatar (horizontal boom only, so it never dives into the floor or
      // pokes the roof), shortened if a wall is closer — you still see the
      // avatar and the stairs it climbs.
      const backH = new THREE.Vector3(Math.cos(act.yaw), 0, Math.sin(act.yaw))
      let ib = 3.2
      for (let t = 1.0; t <= 3.2; t += 0.3) {
        if (solidBody(head.x - backH.x * t, head.y + 0.3, head.z - backH.z * t)) {
          ib = Math.max(1.4, t - 0.35)
          break
        }
      }
      desiredPos.set(head.x - backH.x * ib, head.y + 0.9, head.z - backH.z * ib)
      // Never let the camera rise into the ceiling.
      if (solidBody(desiredPos.x, desiredPos.y + 0.6, desiredPos.z)) desiredPos.y = head.y
      desiredLook.set(head.x + backH.x * 2, act.y + 1.1, head.z + backH.z * 2)
      k = 16
    } else {
      // Outdoors: normal chase boom, shortened when a wall would block it.
      let boom = 7
      for (let t = 1.2; t <= 7; t += 0.35) {
        const px = head.x - dir.x * t
        const py = head.y - dir.y * t + 0.24 * t
        const pz = head.z - dir.z * t
        if (solidBody(px, py, pz)) {
          boom = Math.max(1.1, t - 0.5)
          break
        }
      }
      desiredPos.copy(head).addScaledVector(dir, -boom).add(new THREE.Vector3(0, 0.24 * boom, 0))
      const floor = solidGroundY(desiredPos.x, desiredPos.z, desiredPos.y)
      if (desiredPos.y < floor + 1.2) desiredPos.y = floor + 1.2
      desiredLook.copy(head).addScaledVector(dir, 8)
      k = 18
    }
  } else if (phase === 'aim' || phase === 'charge') {
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
  // The village island sits dead center; layout + identities reshuffle per round.
  village.generate(GX / 2 - village.sx / 2, GZ / 2 - village.sz / 2, world.waterY + 2, roundSeed)
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
  cycleMode = 'day'
  dayT = 0
  nightRound = 0
  nightBlend = 0
  walker.zombie = false
  foe.zombie = false
  tintAvatar(avatars[0], 0xc0392b)
  tintAvatar(avatars[1], 0x2f6fd6)
  kingAvatar.visible = false
  applyLighting()
  clearLoot()
  clearArrows()
  clearTunnels()
  hud.setNightHint(false)
  hud.setCross(false)
  hud.setNightTurn(null)
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
      // Every round opens at night.
      hud.banner(`ROUND ${round}`, 'night falls')
      enterNight()
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
  if (round === 1) {
    // The match opens at night: nothing to spend, everything to find.
    enterNight()
  } else {
    openShop()
  }
}

function fullReset(): void {
  round = 0
  scoreYou = 0
  scoreFoe = 0
  money[0] = START_CASH
  money[1] = START_CASH
  lastRoundResult = ''
  cemeteryStash = []
  jailed = null
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
    // Night: space flicks the flashlight on and off. Dark = hidden but blind.
    if (phase === 'night' && !walker.zombie && !e.repeat) {
      flashlightOn = !flashlightOn
      sfx.tick()
    }
  }
  if (e.code === 'KeyV') toggleWorldView()
  if (phase === 'night' && (e.code === 'KeyW' || e.code === 'KeyA' || e.code === 'KeyS' || e.code === 'KeyD')) {
    hud.setNightHint(false)
  }
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

  updateCycle(dt)
  updateNight(dt)
  updateArrows(dt)
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
    __sv?: {
      pump: (seconds: number) => void
      state: () => object
      world: World
      village: Village
      newMatch: () => void
      sunset: () => void
      wakeKing: () => void
      attackKing: (who: 'you' | 'foe') => void
      stunTest: (who: 'you' | 'foe') => void
      tp: (x: number, z: number, yaw?: number) => void
      giveHaul: () => void
      foeTp: (x: number, z: number) => void
      kingMoodOf: () => string
    }
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
    cycle: {
      mode: cycleMode,
      dayT,
      t: nightRound,
      kingMood,
      kingSeesYou,
      jailed,
      stash: cemeteryStash.length,
      cemLoot: loot.filter(l => l.cemetery).length,
      blend: nightBlend,
      loot: loot.length,
      walker: { ...walker },
      foe: { ...foe },
      king: { ...king },
    },
    proj0: projs[0]
      ? { x: projs[0].pos.x, y: projs[0].pos.y, z: projs[0].pos.z, vx: projs[0].vel.x, vy: projs[0].vel.y, vz: projs[0].vel.z }
      : null,
  }),
  world,
  village,
  newMatch: fullReset,
  wakeKing: () => {
    kingMood = 'chasing'
    kingHuntT = 6
    kingSeesYou = true
    kingChaseGoal = { x: walker.x, z: walker.z }
  },
  attackKing: (who: 'you' | 'foe') => kingAttack(who),
  stunTest: (who: 'you' | 'foe') => beamStun(who),
  tp: (x: number, z: number, yaw?: number) => {
    walker.x = x
    walker.z = z
    walker.y = solidGroundY(x, z, GY - 1) + 0.5
    if (yaw !== undefined) walker.yaw = yaw
  },
  giveHaul: () => {
    money[0] += 400
    nightCashGain += 400
    sides[0].arsenal.set('nuke', (sides[0].arsenal.get('nuke') ?? 0) + 2)
    nightItemsGain.push({ id: 'nuke', qty: 2 })
    updateWeaponHud()
  },
  foeTp: (x: number, z: number) => {
    foe.x = x
    foe.z = z
    foe.y = solidGroundY(x, z, GY - 1) + 0.5
    senseActor('foe')
  },
  kingMoodOf: () => kingMood,
  sunset: () => {
    dayT = DAY_LEN // testing: force the next quiet moment to trigger nightfall
  },
}
