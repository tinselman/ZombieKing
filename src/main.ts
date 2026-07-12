// Scorched Earth 3D — main entry: scene, game loop, turns, camera, input.
import * as THREE from 'three'
import { World, GX, GZ, GRAVITY, WIND_ACCEL, CROP, MINE, DERRICK, PRODUCER_SPECS, type Wind, type Fortifications } from './world'
import { WEAPONS, FUNKY_CHILD, newArsenal, speedOf, type WeaponDef } from './weapons'
import { planShot } from './ai'
import { createHud } from './hud'
import * as sfx from './audio'

const COLLAPSE_AT = 0.2 // fort integrity below this = destroyed (≈8/10 of the tower gone)
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

type Phase = 'castle' | 'plant' | 'aim' | 'charge' | 'fly' | 'resolve' | 'aiThink' | 'aiAim' | 'end' | 'shop'

// Match economy: best-of-ROUNDS. Income comes from producers (see sideIncome);
// winning a round plunders half the loser's cash + one card (not per-hit pay).
const ROUNDS = 3 // best-of-3: first side to 2 round wins takes the match
const START_CASH = 3000

let phase: Phase = 'aim'
let turn = 0
let round = 0
let scoreYou = 0
let scoreFoe = 0
const money = [START_CASH, START_CASH]
let lastRoundResult = ''
let lastIncome = 0 // resource income collected at the start of the player's current turn
let roundSeed = 0
// Match-persistent structure upgrades (taller main tower, extra towers).
const forti: Fortifications[] = [
  { height: 0, towers: 0, barricade: 0 },
  { height: 0, towers: 0, barricade: 0 },
]
// Producers the player and AI have planted, positioned on their own half. These
// persist across rounds (rebuilt into each fresh world) until a lost round razes
// them. type is the cell kind (CROP/MINE/DERRICK); baseYield is full per-turn income;
// age counts owner-turns survived (drives crop maturation).
type Planted = { cx: number; cz: number; type: number; baseYield: number; age: number }
const planted: Planted[][] = [[], []]
// Resources the player bought in the market this turn, awaiting placement (buy-then-
// place). Carries over if unplaced. marketFull = the round-start market (weapons too).
const pendingResources: number[] = []
let marketFull = false
let roundStartPending = false

// Crops ramp in over a couple turns (40% → 100%); mines/derricks pay full at once.
function maturity(type: number, age: number): number {
  if (!PRODUCER_SPECS[type].matures) return 1
  return Math.min(1, 0.4 + 0.3 * Math.max(0, age - 1))
}

// A side's per-turn income: full yield × physical integrity × maturity, summed over
// its planted producers. Combat throttles income by shelling producers (integrity).
function sideIncome(side: number): number {
  let sum = 0
  for (const p of planted[side]) {
    sum += p.baseYield * world.integrityAt(p.cx, p.cz) * maturity(p.type, p.age)
  }
  return Math.round(sum)
}

// Refresh the top status bar, always showing the player's current resource income rate
// so it's obvious the economy is paying out (the turn-start message is hidden by the market).
function syncStatus(): void {
  hud.setStatus(round, ROUNDS, scoreYou, scoreFoe, money[0], sideIncome(0))
}

// ---------------------------------------------------------------- stratagem cards
// A weighted deck: common cards (Skip, Bumper Crop) come up far more often than the
// rare power cards (Zombie King, Toaster). Buy as many as you can afford each turn,
// hold a hand across turns, and play cards before your shot.
type CardId = 'skip' | 'bumper' | 'army' | 'ghost' | 'forcefield' | 'steal' | 'rebuild' | 'fireworks' | 'toaster' | 'zombie'
type CardDef = { id: CardId; name: string; blurb: string; weight: number; impl: boolean; emoji: string }
const DECK: CardDef[] = [
  { id: 'skip', name: 'Skip Player', weight: 30, impl: true, emoji: '⏭️', blurb: "Skip the enemy's entire next turn — no income, no building, no shot — and take another turn yourself." },
  { id: 'bumper', name: 'Bumper Crop', weight: 28, impl: true, emoji: '🌾', blurb: 'A bounty harvest! Your next income payout from resources is doubled.' },
  { id: 'army', name: 'Army', weight: 22, impl: true, emoji: '🪖', blurb: '40 warriors zig-zag the field and raid the enemy economy — skimming about an eighth of their income to you.' },
  { id: 'ghost', name: 'Ghost Tower', weight: 16, impl: true, emoji: '👻', blurb: 'Reposition your castle anywhere. You still see it, but the enemy is blind to it until a shell lands within ten voxels of the real tower.' },
  { id: 'forcefield', name: 'Force Field', weight: 15, impl: true, emoji: '🛡️', blurb: 'An invisible shield cloaks your castle. The next shot that actually hits it is blocked completely — any weapon, no penetration.' },
  { id: 'steal', name: 'Steal', weight: 12, impl: true, emoji: '🫳', blurb: "Seize the enemy's richest producer — its cells and its income become yours." },
  { id: 'rebuild', name: 'Rebuild', weight: 11, impl: true, emoji: '🧱', blurb: "Rip half the enemy's tower apart and fly the voxels over to repair your own castle." },
  { id: 'fireworks', name: 'Fireworks', weight: 9, impl: true, emoji: '🎆', blurb: 'Night falls and fireworks bloom; the enemy pockets $1,000. While it lasts, a killing blow rebuilds their castle and bills you $1,000 instead.' },
  { id: 'toaster', name: 'Flying Toaster', weight: 6, impl: true, emoji: '🍞', blurb: "A winged toaster homes onto the enemy castle and strikes with Death's Head force — a free bonus attack on top of your shot." },
  { id: 'zombie', name: 'Zombie King', weight: 4, impl: true, emoji: '🧟', blurb: "A giant king stomps the enemy's producers, razing HALF — and that half becomes your resources." },
]
const CARD_COST = 1500
const hand: CardId[][] = [[], []] // cards each side is holding
// Ghost Tower state: which side's tower is currently ghosted (-1 none), and the decoy
// (old) position the enemy AI keeps aiming at while your real tower is hidden/moved.
let ghostSide = -1
let ghostDecoy: { cx: number; cz: number } | null = null
// Fireworks state: which side triggered it (kill-interception), or -1; plus any unpaid
// $1,000 debt per side (charged when a killing blow is intercepted, paid from income).
let fireworksSide = -1
const fireworksDebt = [0, 0]
// Force Field: side with an active (as-yet-unhit) shield, or -1. Bumper Crop: a ×2
// multiplier on a side's NEXT income payout. Skip Player: this side's next turn is skipped.
let forceFieldSide = -1
const incomeBoost = [1, 1]
const skipNext = [false, false]
// Ghost Tower: set while the player is hand-repositioning their (still-visible) tower.
let ghostReposition = false
function cardDef(id: CardId): CardDef {
  return DECK.find(c => c.id === id)!
}

// Weighted draw over the live cards — weak cards (high weight) come up far more often.
function drawCard(): CardId {
  const pool = DECK.filter(c => c.impl)
  const total = pool.reduce((s, c) => s + c.weight, 0)
  let r = Math.random() * total
  for (const c of pool) {
    r -= c.weight
    if (r <= 0) return c.id
  }
  return pool[pool.length - 1].id
}

function buyCard(side: number): void {
  if (money[side] < CARD_COST) return void (side === 0 && hud.msg('not enough cash'))
  money[side] -= CARD_COST
  const id = drawCard()
  hand[side].push(id)
  if (side === 0) {
    sfx.tick()
    syncStatus()
    refreshHand()
    hud.msg(`drew ${cardDef(id).name}`)
  }
}

function playCard(side: number, idx: number): void {
  const id = hand[side][idx]
  if (!id) return
  if (side === 0 && phase !== 'aim' && phase !== 'plant') return void hud.msg('play cards before firing')
  hand[side].splice(idx, 1)
  if (side === 0) {
    sfx.tick()
    refreshHand()
  }
  applyCard(side, id)
  refreshResources() // steal/zombie move producers between sides
}

// On a round win the victor lifts one random card from the loser's hand. Returns the
// card's name (for the result message), or '' if the loser held none.
function stealRandomCard(winner: number, loser: number): string {
  if (!hand[loser].length) return ''
  const i = Math.floor(Math.random() * hand[loser].length)
  const id = hand[loser].splice(i, 1)[0]
  hand[winner].push(id)
  return cardDef(id).name
}

function applyCard(side: number, id: CardId): void {
  const foe = 1 - side
  if (id === 'steal') cardSteal(side, foe)
  else if (id === 'army') cardArmy(side, foe)
  else if (id === 'toaster') cardToaster(side, foe)
  else if (id === 'zombie') cardZombie(side, foe)
  else if (id === 'ghost') cardGhost(side)
  else if (id === 'fireworks') cardFireworks(side, foe)
  else if (id === 'bumper') cardBumper(side)
  else if (id === 'skip') cardSkip(side, foe)
  else if (id === 'forcefield') cardForcefield(side)
  else if (id === 'rebuild') cardRebuild(side, foe)
}

// Bumper Crop: double this side's NEXT income payout (applied and cleared in startTurn).
function cardBumper(side: number): void {
  incomeBoost[side] = 2
  hud.msg(side === 0 ? 'bumper crop! next income doubled' : 'the enemy banks a bumper crop')
}

// Skip Player: the opponent's entire next turn is skipped; the caster goes again.
function cardSkip(side: number, foe: number): void {
  skipNext[foe] = true
  hud.msg(side === 0 ? 'the enemy will be skipped — you go again' : 'you are about to be skipped!')
}

// Force Field: raise an invisible one-hit shield over your castle (see crater()).
function cardForcefield(side: number): void {
  forceFieldSide = side
  hud.msg(side === 0 ? 'force field up — your castle is shielded' : 'the enemy raises a force field')
}

// Rebuild: rip half the enemy tower out and fly those voxels over to patch yours.
function cardRebuild(side: number, foe: number): void {
  const { from, to } = world.rebuildTransfer(foe, side)
  if (!from.length) return void (side === 0 && hud.msg('the enemy tower has nothing left to take'))
  world.rebuild()
  hud.setIntegrity(world.integrity(0), world.integrity(1))
  spawnVoxelFlight(from, to, side === 0 ? 0xffb0a0 : 0xa0c0ff)
  sfx.rumble()
  hud.msg(side === 0 ? 'rebuild! their tower patches yours' : 'the enemy cannibalises your tower')
}

// Cosmetic: a sample of the transferred voxels arcs from the source cells to the
// destination cells over ~1s (the grid change itself already happened).
const voxFlyGeo = new THREE.BoxGeometry(1, 1, 1)
function spawnVoxelFlight(from: THREE.Vector3[] | { x: number; y: number; z: number }[], to: THREE.Vector3[] | { x: number; y: number; z: number }[], color: number): void {
  const n = Math.min(28, from.length, to.length)
  if (n === 0) return
  const mat = new THREE.MeshLambertMaterial({ color })
  const items: { mesh: THREE.Mesh; from: THREE.Vector3; to: THREE.Vector3 }[] = []
  for (let k = 0; k < n; k++) {
    const fi = Math.floor((k / n) * from.length)
    const ti = Math.floor((k / n) * to.length)
    const f = from[fi]
    const t = to[ti]
    const mesh = new THREE.Mesh(voxFlyGeo, mat)
    mesh.position.set(f.x, f.y, f.z)
    scene.add(mesh)
    items.push({ mesh, from: new THREE.Vector3(f.x, f.y, f.z), to: new THREE.Vector3(t.x, t.y, t.z) })
  }
  tasks.push({ kind: 'voxfly', items, t: 0, dur: 1 })
}

// Steal: move the enemy's richest producer (cells + income) to your side. No world
// rebuild — producers render side-agnostically, so flipping ownership is just data.
function cardSteal(side: number, foe: number): void {
  if (!planted[foe].length) return void (side === 0 && hud.msg('enemy has nothing to steal'))
  let best = 0
  for (let i = 1; i < planted[foe].length; i++) {
    if (planted[foe][i].baseYield > planted[foe][best].baseYield) best = i
  }
  const p = planted[foe].splice(best, 1)[0]
  p.age = Math.max(p.age, 2) // already established — pays you at a decent maturity
  planted[side].push(p)
  const wp = world.producers.find(q => q.cx === p.cx && q.cz === p.cz)
  if (wp) wp.side = side
  if (side === 0) hud.msg(`stole their ${PRODUCER_SPECS[p.type].name}`)
  else hud.msg(`enemy stole your ${PRODUCER_SPECS[p.type].name}`)
}

// Army: a cosmetic charge of runners across the field plus an instant raid that
// skims ~1/8 of the enemy's per-turn income from their treasury to yours.
function cardArmy(side: number, foe: number): void {
  spawnArmy(side)
  const loot = Math.round(sideIncome(foe) / 8)
  if (loot > 0) {
    money[foe] = Math.max(0, money[foe] - loot)
    money[side] += loot
    if (side === 0) syncStatus()
  }
  hud.msg(side === 0 ? `the army raids for $${loot.toLocaleString()}` : `enemy army raids you for $${loot.toLocaleString()}`)
}

// Flying Toaster: a homing bonus strike on the enemy castle at Death's-Head power.
// Routes through the normal fly→resolve pipeline (flyIsCard), then hands the turn
// back to the shooter for their regular shot (unless it collapses the tower → win).
function cardToaster(side: number, foe: number): void {
  const fort = world.forts[foe]?.towers[0]
  if (!fort) return
  const m = muzzleOf(side)
  const start = new THREE.Vector3(m.x, m.y + 24, m.z)
  const target = new THREE.Vector3(fort.cx, fort.baseY + 9, fort.cz)
  const mesh = makeToasterMesh()
  mesh.position.copy(start)
  scene.add(mesh)
  tasks.push({ kind: 'toaster', mesh, pos: start.clone(), target, t: 0 })
  clearLastTrails()
  flyIsCard = true
  worldView = false
  hud.setWorldView(false)
  hud.showCards(false)
  phase = 'fly'
  hud.msg(side === 0 ? 'flying toaster inbound!' : 'enemy toaster incoming!')
}

// Zombie King: a giant stomps the enemy's producers, seizing HALF of them (richest
// first) — cells and income transfer to you. A cosmetic King marches the field.
function cardZombie(side: number, foe: number): void {
  const foeProd = planted[foe]
  if (!foeProd.length) return void (side === 0 && hud.msg('the enemy has no resources to seize'))
  const order = foeProd.map((_, i) => i).sort((a, b) => foeProd[b].baseYield - foeProd[a].baseYield)
  const takeCount = Math.ceil(foeProd.length / 2)
  const takeIdx = order.slice(0, takeCount).sort((a, b) => b - a) // descending → safe splice
  let firstCx = world.forts[foe]?.towers[0]?.cx ?? GX / 2
  let firstCz = GZ / 2
  for (const i of takeIdx) {
    const p = foeProd.splice(i, 1)[0]
    p.age = Math.max(p.age, 2)
    planted[side].push(p)
    const wp = world.producers.find(q => q.cx === p.cx && q.cz === p.cz)
    if (wp) wp.side = side
    firstCx = p.cx
    firstCz = p.cz
  }
  spawnZombieKing(side, firstCx, firstCz)
  hud.msg(side === 0 ? `the Zombie King seizes ${takeCount} of their producers!` : `the enemy Zombie King seizes ${takeCount} of yours!`)
}

// Ghost Tower. You (side 0): reposition your castle by hand; it stays visible to YOU
// but the enemy AI keeps firing at the decoy (old) spot until a shell lands within 10
// of the real tower. Enemy (side 1): auto-jumps and vanishes from YOUR view instead.
function cardGhost(side: number): void {
  const oldT = world.forts[side]?.towers[0]
  ghostDecoy = oldT ? { cx: oldT.cx, cz: oldT.cz } : null
  if (side === 0) {
    // Hand-reposition; ghostSide is set when you confirm placement (placeCastle).
    ghostReposition = true
    beginCastlePlacement()
    return
  }
  // Enemy: jump to a random spot on its half and hide the tower from the human.
  const cx = Math.round(Math.round(GX / 2) + 8 + Math.random() * (GX / 2 - 18))
  const cz = Math.round(8 + Math.random() * (GZ - 16))
  world.castleOverride[1] = { cx, cz }
  rebuildRoundWorld()
  world.hiddenFort = 1
  world.rebuild()
  sides[1].cannon.group.visible = false
  ghostSide = 1
  hud.msg('the enemy tower vanishes!')
}

function revealGhost(): void {
  if (ghostSide < 0) return
  world.hiddenFort = -1
  sides[ghostSide].cannon.group.visible = true
  world.rebuild()
  hud.msg(ghostSide === 0 ? 'the enemy has spotted your tower!' : 'the enemy ghost tower reappears!')
  ghostSide = -1
  ghostDecoy = null
}

// Fireworks: switch to night with a fireworks show; the enemy pockets $1,000. While it
// lasts (this round), a blow that would collapse the enemy castle instead rebuilds it
// and bills you $1,000 (paid now if you can, else carried as debt off future income).
function cardFireworks(side: number, foe: number): void {
  money[foe] += 1000
  if (side === 0) syncStatus()
  fireworksSide = side
  setNight(true)
  spawnFireworks()
  hud.msg(side === 0 ? "fireworks! the enemy pockets $1,000" : 'the enemy lights fireworks — you get $1,000')
}
let wind: Wind = { x: 0, z: 0 }
let chargeT = 0
let chargePower = 0
let lastPlayerPower = 60
let shotThisRound = false // power marker only shows after the first shot of a round
let resolveT = 0
let resolveTotal = 0 // wall-clock in 'resolve' (not reset by the settling guard) — safety net
let flyTotal = 0 // wall-clock in 'fly' — forces a stuck shot (lingering proj/task) to resolve
let aiT = 0
let aiErr = 16 // enemy aim scatter — modest and human; ranges in slowly, never pinpoint
let aiPlanned: { az: number; el: number; power: number } | null = null
let aiAnimT = 0
let aiStart = { az: 0, el: 0 }
let endT = 0
let endShown = false
let endInfo: { title: string; sub: string; center: THREE.Vector3 } | null = null
// Defeated towers crumble first, THEN explode once the rubble has settled.
let pendingBlasts: { cx: number; cz: number; y: number }[] = []
let blastFired = true
const lastImpact = new THREE.Vector3(GX / 2, 12, GZ / 2)
const keys = new Set<string>()

// ---------------------------------------------------------------- projectiles

type Proj = {
  pos: THREE.Vector3
  vel: THREE.Vector3
  hdir: THREE.Vector3 // horizontal travel direction — stable through the apex, used by the chase cam
  launchDir: THREE.Vector3 // horizontal direction at launch — fixes the frisbee's steer/camera frame
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
// Piloted craft get a flat disc silhouette.
const frisbeeGeo = new THREE.CylinderGeometry(2.0, 2.0, 0.5, 16)
const frisbeeMat = new THREE.MeshLambertMaterial({ color: 0xd0563a })
const saucerGeo = new THREE.CylinderGeometry(2.8, 1.6, 0.7, 18)
const saucerMat = new THREE.MeshLambertMaterial({ color: 0x9aa7b5, emissive: 0x223040, emissiveIntensity: 0.5 })

function projMesh(kind: string): THREE.Mesh {
  if (kind === 'frisbee') return new THREE.Mesh(frisbeeGeo, frisbeeMat)
  if (kind === 'saucer') return new THREE.Mesh(saucerGeo, saucerMat)
  return new THREE.Mesh(projGeo, projMat)
}

function spawnProj(pos: THREE.Vector3, vel: THREE.Vector3, weapon: WeaponDef, split: boolean, side: number, hops = 0): void {
  const mesh = projMesh(weapon.kind)
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
  if (hdir.lengthSq() < 0.01) hdir.set(side === 0 ? 1 : -1, 0, 0)
  hdir.normalize()
  projs.push({ pos: pos.clone(), vel: vel.clone(), hdir, launchDir: hdir.clone(), weapon, split, side, hops, mesh, trailPos, trailN: 0, trailLine })
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
  | { kind: 'toaster'; mesh: THREE.Mesh; pos: THREE.Vector3; target: THREE.Vector3; t: number }
  | { kind: 'army'; runners: THREE.Mesh[]; z0: number[]; x: number; dir: number; t: number }
  | { kind: 'king'; mesh: THREE.Mesh; x: number; z: number; dir: number; t: number }
  | { kind: 'voxfly'; items: { mesh: THREE.Mesh; from: THREE.Vector3; to: THREE.Vector3 }[]; t: number; dur: number }
  | { kind: 'shield'; mesh: THREE.Mesh; t: number }
const tasks: Task[] = []
// When true, the current fly→resolve pass is a played card (Flying Toaster), not a
// normal shot: on resolve it hands the turn back to the shooter instead of advancing.
let flyIsCard = false

function crater(at: THREE.Vector3, r: number, fire: boolean): void {
  // Force field: if this blast would reach the shielded castle, the shield eats it
  // entirely (any weapon, no penetration) and is spent. A miss leaves it up.
  if (forceFieldSide >= 0) {
    const ft = world.forts[forceFieldSide]?.towers[0]
    if (ft && Math.hypot(at.x - ft.cx, at.z - ft.cz) < 5 + r) {
      spawnShieldBlock(ft.cx, ft.cz)
      forceFieldSide = -1
      lastImpact.copy(at)
      return // nothing gets through
    }
  }
  world.carve(at.x, at.y, at.z, r)
  if (fire) world.shockwave(at.x, at.y, at.z, r, Math.random)
  world.updateSupport(Math.random)
  spawnExplosion(at, r, fire)
  sfx.boom(r)
  addShake(r, at)
  lastImpact.copy(at)
  // A shell landing within 10 voxels of a ghosted tower snaps it back into view.
  if (ghostSide >= 0) {
    const t = world.forts[ghostSide]?.towers[0]
    if (t && Math.hypot(at.x - t.cx, at.z - t.cz) < 10) revealGhost()
  }
}

// The visible flare when a force field stops a shot: a cyan dome that flares and fades.
function spawnShieldBlock(cx: number, cz: number): void {
  const cy = world.surfaceY(cx, cz) + 4
  const geo = new THREE.SphereGeometry(9, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2)
  const mat = new THREE.MeshBasicMaterial({ color: 0x77d6ff, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.set(cx, cy, cz)
  scene.add(mesh)
  tasks.push({ kind: 'shield', mesh, t: 0 })
  spawnFlash(new THREE.Vector3(cx, cy + 6, cz), 42, 0x99e2ff)
  sfx.boom(3)
  addShake(4, new THREE.Vector3(cx, cy, cz))
  hud.msg('force field holds!')
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
    case 'frisbee':
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
    } else if (t.kind === 'toaster') {
      // Homing bonus strike: fly toward the enemy castle, then detonate at
      // Death's-Head power. Ease in, tumble the toaster as it goes.
      const to = t.target.clone().sub(t.pos)
      const dist = to.length()
      const step = Math.min(dist, (16 + t.t * 26) * dt) // accelerates as it commits
      t.pos.addScaledVector(to.normalize(), step)
      t.mesh.position.copy(t.pos)
      t.mesh.rotation.x += dt * 6
      t.mesh.rotation.y += dt * 9
      if (dist < 2.2) {
        crater(t.target.clone(), 6, true)
        scene.remove(t.mesh)
        tasks.splice(i, 1)
      }
    } else if (t.kind === 'army') {
      // Cosmetic charge: runners sweep toward the enemy with a zig-zag wobble, then
      // vanish. The economic raid already happened when the card was played.
      t.x += t.dir * 34 * dt
      for (let k = 0; k < t.runners.length; k++) {
        const rx = t.x + (k % 5) * t.dir * -2.4
        const rz = t.z0[k] + Math.sin(t.t * 6 + k) * 4
        const sy = world.surfaceY(Math.round(rx), Math.round(rz))
        t.runners[k].position.set(rx, (sy < 0 ? 0 : sy) + 1.4, rz)
      }
      if (t.t > 3 || t.x < 4 || t.x > GX - 4) {
        for (const r of t.runners) scene.remove(r)
        tasks.splice(i, 1)
      }
    } else if (t.kind === 'king') {
      // Lumber across the field with a heavy stomp; fade near the far edge.
      t.x += t.dir * 16 * dt
      const sy = world.surfaceY(Math.round(t.x), Math.round(t.z))
      const stomp = Math.abs(Math.sin(t.t * 4)) * 3
      t.mesh.position.set(t.x, (sy < 0 ? 0 : sy) + 8 + stomp, t.z)
      t.mesh.rotation.y = t.dir > 0 ? 0 : Math.PI
      if (t.t > 4 || t.x < 6 || t.x > GX - 6) {
        scene.remove(t.mesh)
        tasks.splice(i, 1)
      }
    } else if (t.kind === 'voxfly') {
      // Rebuild card: arc each sampled voxel from its old cell to its new one.
      const u = Math.min(1, t.t / t.dur)
      for (const it of t.items) {
        it.mesh.position.lerpVectors(it.from, it.to, u)
        it.mesh.position.y += Math.sin(u * Math.PI) * 14 // lofted arc
        it.mesh.rotation.x += dt * 6
        it.mesh.rotation.y += dt * 5
      }
      if (u >= 1) {
        for (const it of t.items) scene.remove(it.mesh)
        tasks.splice(i, 1)
      }
    } else if (t.kind === 'shield') {
      // Force-field block: a translucent dome flares up and fades.
      const u = Math.min(1, t.t / 0.55)
      const s = 1 + u * 1.4
      t.mesh.scale.set(s, s, s)
      ;(t.mesh.material as THREE.MeshBasicMaterial).opacity = 0.6 * (1 - u)
      if (u >= 1) {
        scene.remove(t.mesh)
        tasks.splice(i, 1)
      }
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

// The army task uses `z0` as each runner's baseline z lane. `t.x` is the leading
// column's x; `t.dir` is +1 (player charges toward +X) or −1 (enemy toward −X).
const armyGeo = new THREE.BoxGeometry(1.2, 2.2, 1.2)
const armyMatA = new THREE.MeshLambertMaterial({ color: 0xd5473a })
const armyMatB = new THREE.MeshLambertMaterial({ color: 0x3a7bd5 })
function spawnArmy(side: number): void {
  const dir = side === 0 ? 1 : -1
  const x0 = side === 0 ? 12 : GX - 12
  const runners: THREE.Mesh[] = []
  const z0: number[] = []
  for (let k = 0; k < 40; k++) {
    const m = new THREE.Mesh(armyGeo, side === 0 ? armyMatA : armyMatB)
    const z = 6 + ((k * 37) % (GZ - 12))
    m.position.set(x0, world.surfaceY(x0, z) + 1.4, z)
    scene.add(m)
    runners.push(m)
    z0.push(z)
  }
  tasks.push({ kind: 'army', runners, z0, x: x0, dir, t: 0 })
}

// A tiny stylized toaster: chrome body with two little wings.
const toasterGeo = new THREE.BoxGeometry(3, 2, 2.2)
const toasterMat = new THREE.MeshLambertMaterial({ color: 0xc8cdd3, emissive: 0x303a44, emissiveIntensity: 0.4 })
const wingGeo = new THREE.BoxGeometry(0.4, 1.6, 3.4)
const wingMat = new THREE.MeshLambertMaterial({ color: 0xffffff })
function makeToasterMesh(): THREE.Mesh {
  const body = new THREE.Mesh(toasterGeo, toasterMat)
  const wing = new THREE.Mesh(wingGeo, wingMat)
  body.add(wing)
  return body
}

// A giant zombie king: a hulking green body with a gold crown, spawned on the loser's
// side; he stomps toward the winner's side dragging the plundered resources, then fades.
const kingBodyGeo = new THREE.BoxGeometry(7, 14, 5)
const kingBodyMat = new THREE.MeshLambertMaterial({ color: 0x4f7a3a, emissive: 0x152510, emissiveIntensity: 0.4 })
const kingCrownGeo = new THREE.BoxGeometry(6, 2.4, 6)
const kingCrownMat = new THREE.MeshLambertMaterial({ color: 0xe8c04a, emissive: 0x5a4410, emissiveIntensity: 0.5 })
function spawnZombieKing(side: number, cx: number, cz: number): void {
  const body = new THREE.Mesh(kingBodyGeo, kingBodyMat)
  const crown = new THREE.Mesh(kingCrownGeo, kingCrownMat)
  crown.position.y = 8
  body.add(crown)
  body.position.set(cx, world.surfaceY(cx, cz) + 8, cz)
  scene.add(body)
  tasks.push({ kind: 'king', mesh: body, x: cx, z: cz, dir: side === 0 ? -1 : 1, t: 0 })
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

// Fireworks card: swap the bright day scene for a deep-blue night and dim the lights.
let isNight = false
function setNight(on: boolean): void {
  if (isNight === on) return
  isNight = on
  const bg = on ? 0x2b3552 : 0xeef1f4 // dusky navy, still clearly readable
  ;(scene.background as THREE.Color).setHex(bg)
  ;(scene.fog as THREE.Fog).color.setHex(bg)
  hemi.intensity = on ? 0.7 : 1.2
  sun.intensity = on ? 0.85 : 1.7
}

// A burst of colourful fireworks over the battlefield (pure spectacle).
function spawnFireworks(): void {
  const colors = [0xff5a5a, 0xffd24a, 0x5adcff, 0x8affa0, 0xff8adf, 0xfff0a0]
  for (let k = 0; k < 10; k++) {
    const at = new THREE.Vector3(30 + Math.random() * (GX - 60), 40 + Math.random() * 34, 6 + Math.random() * (GZ - 12))
    const c = colors[Math.floor(Math.random() * colors.length)]
    spawnExplosion(at, 5 + Math.random() * 4, false)
    spawnFlash(at, 40, c)
  }
  sfx.boom(6)
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

// ---------------------------------------------------------------- plant mode
// Each of your turns opens with a plant step: an overhead camera frames your half
// and a ghost box shows where the next producer would land. Pick a type (1/2/3),
// place as many as you can afford (they persist across rounds), then Enter to aim.
let plantCX = GX / 4
let plantCZ = GZ / 2
let plantType = CROP
let plantGhost: THREE.Mesh | null = null
let ghostForType = -1 // the type the ghost geometry is currently sized for
const PRODUCER_TYPES = [CROP, MINE, DERRICK]

function ensurePlantGhost(): THREE.Mesh {
  if (!plantGhost) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x4caf50, transparent: true, opacity: 0.4, depthWrite: false })
    plantGhost = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat)
    plantGhost.renderOrder = 6
    scene.add(plantGhost)
  }
  // Resize the ghost box to match the selected producer's footprint & height.
  if (ghostForType !== plantType) {
    ghostForType = plantType
    const spec = PRODUCER_SPECS[plantType]
    plantGhost.geometry.dispose()
    plantGhost.geometry = new THREE.BoxGeometry(spec.half * 2 + 1, spec.tall + 1, spec.half * 2 + 1)
  }
  return plantGhost
}

// Four blinking hairline arrows around the ghost, one per side, cueing that the arrow
// keys nudge the resource. They point outward (±X toward enemy/back, ±Z left/right).
let plantArrows: THREE.Group | null = null
let plantBlinkT = 0
const PLANT_UP = new THREE.Vector3(0, 1, 0)
const PLANT_ARROW_DIRS = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)]
function ensurePlantArrows(): THREE.Group {
  if (!plantArrows) {
    plantArrows = new THREE.Group()
    const mat = new THREE.MeshBasicMaterial({ color: 0xffef7a, transparent: true, opacity: 0.95, depthTest: false })
    const geo = new THREE.ConeGeometry(1.0, 3.4, 4) // slim pyramid = arrowhead
    for (const d of PLANT_ARROW_DIRS) {
      const a = new THREE.Mesh(geo, mat)
      a.quaternion.setFromUnitVectors(PLANT_UP, d) // point the tip outward
      plantArrows.add(a)
    }
    plantArrows.renderOrder = 9
    scene.add(plantArrows)
  }
  return plantArrows
}

function plantHudMsg(): void {
  const spec = PRODUCER_SPECS[plantType]
  const left = pendingResources.filter(t => t === plantType).length
  hud.setSetupHint(`Placing ${spec.name} (${left} left, +$${spec.baseYield}/turn) — anywhere, even on water`, '← → ↑ ↓ move  ·  SPACE or ENTER to place  ·  ESC back to aim')
}

// Enter placement mode for one resource type (clicked in the Resources list, during
// your aim step). You place units of that type with SPACE/ENTER; ESC returns to aim.
function beginPlaceResource(type: number): void {
  if (phase !== 'aim' && phase !== 'plant') return
  if (!pendingResources.includes(type)) return
  plantType = type
  phase = 'plant'
  plantCX = GX / 4
  plantCZ = GZ / 2
  ensurePlantGhost().visible = true
  plantHudMsg()
}

// Leave any placement mode and return to aiming — the power/fire bar comes back.
function enterAim(): void {
  if (plantGhost) plantGhost.visible = false
  if (plantArrows) plantArrows.visible = false
  phase = 'aim'
  hud.setSetupHint('') // restore the power/fire bar — you're ready to aim now
  hud.setPower(null, shotThisRound ? lastPlayerPower : null)
  refreshHand()
  refreshResources()
  syncStatus()
}

function placeProducer(): void {
  const type = plantType
  const idx = pendingResources.indexOf(type)
  if (idx < 0) return void enterAim()
  const spec = PRODUCER_SPECS[type]
  const cx = Math.round(plantCX)
  const cz = Math.round(plantCZ)
  if (!world.canPlaceProducer(cx, cz, type)) return void hud.msg('overlaps another structure')
  // Already paid for in the market — placement is free.
  pendingResources.splice(idx, 1)
  planted[0].push({ cx, cz, type, baseYield: spec.baseYield, age: 0 })
  world.buildProducer(cx, cz, 0, type, spec.baseYield, 0)
  sfx.tick()
  refreshResources()
  syncStatus() // update the "resources +$X/turn" readout right away
  hud.msg(`${spec.name} placed — earning income each turn`)
  // Keep placing this type if you have more of it; otherwise back to aiming.
  if (pendingResources.includes(type)) plantHudMsg()
  else enterAim()
}

function updatePlant(dt: number): void {
  if (phase !== 'plant') return
  const half = PRODUCER_SPECS[plantType].half
  // Coarse positioning — a fixed speed (Shift = slow) is plenty for a small plot.
  const speed = (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 10 : 30) * dt
  if (keys.has('ArrowUp')) plantCX += speed
  if (keys.has('ArrowDown')) plantCX -= speed
  if (keys.has('ArrowRight')) plantCZ += speed
  if (keys.has('ArrowLeft')) plantCZ -= speed
  // Resources may be placed anywhere on the whole map now (water and rough terrain
  // included) — clamp only to the world bounds so the footprint stays in-map.
  plantCX = Math.max(half + 1, Math.min(GX - half - 1, plantCX))
  plantCZ = Math.max(half + 1, Math.min(GZ - half - 1, plantCZ))
  const cx = Math.round(plantCX)
  const cz = Math.round(plantCZ)
  const g = ensurePlantGhost()
  const spec = PRODUCER_SPECS[plantType]
  g.position.set(cx, world.surfaceY(cx, cz) + spec.tall / 2 + 1, cz)
  const ok = world.canPlaceProducer(cx, cz, plantType)
  ;(g.material as THREE.MeshBasicMaterial).color.setHex(ok ? 0x4caf50 : 0xd23a3a)
  // Blinking hairline arrows on all four sides, cueing the arrow-key nudge.
  const arrows = ensurePlantArrows()
  arrows.visible = true
  plantBlinkT += dt
  const blinkOn = plantBlinkT % 0.5 < 0.3
  const ay = world.surfaceY(cx, cz) + spec.tall + 2.5
  const reach = half + 3
  for (let k = 0; k < arrows.children.length; k++) {
    const a = arrows.children[k]
    const d = PLANT_ARROW_DIRS[k]
    a.position.set(cx + d.x * reach, ay, cz + d.z * reach)
    a.visible = blinkOn
  }
}

// ---------------------------------------------------------------- castle placement
// At the start of every round you position your own castle anywhere on the map (water
// and rough terrain included); the enemy AI positions its own. Then the world rebuilds
// with the castles where they were placed and the round's first turn begins.
let castleCX = GX / 4
let castleCZ = GZ / 2
let castleGhost: THREE.Mesh | null = null
const CASTLE_HALF = 4 // matches the fort's 9×9 footprint
// Live-rebuild throttle: as you move the castle we regenerate the world (with the pad
// under it) so the REAL tower + terrain follow the cursor, not a floating ghost.
let castleBuildT = 0
let castleBuiltCX = -1
let castleBuiltCZ = -1

function ensureCastleGhost(): THREE.Mesh {
  if (!castleGhost) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xd5473a, transparent: true, opacity: 0.4, depthWrite: false })
    castleGhost = new THREE.Mesh(new THREE.BoxGeometry(CASTLE_HALF * 2 + 1, 18, CASTLE_HALF * 2 + 1), mat)
    castleGhost.renderOrder = 6
    scene.add(castleGhost)
  }
  return castleGhost
}

// The enemy AI positions its own castle somewhere on its half each round.
function aiPlaceCastle(): void {
  const cx = Math.round(GX - 13 - Math.random() * 26)
  const cz = Math.round(6 + CASTLE_HALF + Math.random() * (GZ - 12 - CASTLE_HALF * 2))
  world.castleOverride[1] = { cx, cz }
}

function beginCastlePlacement(): void {
  phase = 'castle'
  // Start the cursor at the player's current castle so "keep it here" is one keypress.
  const t = world.forts[0]?.towers[0]
  castleCX = t ? t.cx : GX / 4
  castleCZ = t ? t.cz : GZ / 2
  // The real tower is already built here, so mark it as such (no rebuild until you move).
  castleBuiltCX = t ? t.cx : -1
  castleBuiltCZ = t ? t.cz : -1
  castleBuildT = 0
  ensureCastleGhost().visible = false // the real (rebuilt) tower is the preview now
  hud.banner('PLACE YOUR CASTLE')
  hud.setSetupHint('Position your castle — it rides the terrain; go anywhere, even on water', '← → ↑ ↓ move  ·  SPACE or ENTER to set it here')
}

function placeCastle(): void {
  const cx = Math.round(castleCX)
  const cz = Math.round(castleCZ)
  if (castleGhost) castleGhost.visible = false
  hud.setSetupHint('')
  world.castleOverride[0] = { cx, cz }
  rebuildRoundWorld() // rebuild the battlefield with both castles where they were placed
  sfx.tick()
  if (ghostReposition) {
    // Ghost Tower: your tower stays visible to you but the enemy can't see it (it aims
    // at the decoy) until a shell lands within 10 of the real one.
    ghostReposition = false
    ghostSide = 0
    hud.msg('ghost tower set — the enemy is blind to it')
  }
  // Income already ran (startTurn opened the market) — go to your turn (aim). Place
  // resources from the left-hand list whenever you like before firing.
  enterAim()
}

function updateCastle(dt: number): void {
  if (phase !== 'castle') return
  const speed = (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 12 : 30) * dt
  if (keys.has('ArrowUp')) castleCX += speed
  if (keys.has('ArrowDown')) castleCX -= speed
  if (keys.has('ArrowRight')) castleCZ += speed
  if (keys.has('ArrowLeft')) castleCZ -= speed
  castleCX = Math.max(CASTLE_HALF + 1, Math.min(GX - CASTLE_HALF - 1, castleCX))
  castleCZ = Math.max(CASTLE_HALF + 1, Math.min(GZ - CASTLE_HALF - 1, castleCZ))
  const cx = Math.round(castleCX)
  const cz = Math.round(castleCZ)
  // Rebuild the world with the castle here so the real tower follows the cursor,
  // riding up and down the existing terrain (the land itself never deforms).
  // Throttled and only when the cell changes, to keep the regen affordable.
  castleBuildT += dt
  if ((cx !== castleBuiltCX || cz !== castleBuiltCZ) && castleBuildT > 0.09) {
    castleBuildT = 0
    castleBuiltCX = cx
    castleBuiltCZ = cz
    world.castleOverride[0] = { cx, cz }
    rebuildRoundWorld()
  }
  // Blinking hairline arrows on all four sides of the tower, cueing the arrow keys —
  // shown whenever the castle is being positioned (round start or Ghost Tower).
  const arrows = ensurePlantArrows()
  arrows.visible = true
  plantBlinkT += dt
  const blinkOn = plantBlinkT % 0.5 < 0.3
  const ay = world.surfaceY(cx, cz) + 12 // mid-tower height reads well from overhead
  const reach = CASTLE_HALF + 4
  for (let k = 0; k < arrows.children.length; k++) {
    const a = arrows.children[k]
    const d = PLANT_ARROW_DIRS[k]
    a.position.set(cx + d.x * reach, ay, cz + d.z * reach)
    a.visible = blinkOn
  }
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

let topDownView = false
function updateCamera(dt: number): void {
  const desiredPos = new THREE.Vector3()
  const desiredLook = new THREE.Vector3()
  let k = 3.5
  topDownView = false

  if (phase === 'castle') {
    // High wide bird's-eye over the WHOLE battlefield so the castle can be positioned
    // anywhere. Screen-up is +X (toward the enemy), screen-right is +Z.
    desiredPos.set(GX / 2 - 96, 150, GZ / 2)
    desiredLook.set(GX / 2, 2, GZ / 2)
    k = 3
  } else if (phase === 'plant') {
    // Wide bird's-eye over the whole map (resources can be placed anywhere now), angled
    // toward the enemy (+X) so screen-up is +X and screen-right is +Z (see updatePlant).
    desiredPos.set(GX / 2 - 96, 150, GZ / 2)
    desiredLook.set(GX / 2, 2, GZ / 2)
    k = 3
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
    const toast = tasks.find(t => t.kind === 'toaster') as { pos: THREE.Vector3; target: THREE.Vector3 } | undefined
    if (toast) {
      // Trail the flying toaster from behind and above, framed on its target castle.
      const back = toast.pos.clone().sub(toast.target).setY(0).normalize()
      desiredPos.copy(toast.pos).addScaledVector(back, 18).add(new THREE.Vector3(0, 12, 0))
      desiredLook.copy(toast.target)
      k = 4
    } else if (lead && lead.weapon.kind === 'saucer') {
      // Top-down drone view straight over the saucer (camera.up = +X so the enemy
      // side is toward the top of the screen).
      topDownView = true
      desiredPos.set(lead.pos.x, lead.pos.y + 58, lead.pos.z)
      desiredLook.copy(lead.pos)
      k = 7
    } else if (lead && lead.weapon.kind === 'frisbee') {
      // Chase cam locked to the LAUNCH direction (not the live heading), so sliding
      // left/right reads as left/right on screen instead of spinning the view.
      desiredPos.copy(lead.pos).addScaledVector(lead.launchDir, -16).add(new THREE.Vector3(0, 8, 0))
      desiredLook.copy(lead.pos).addScaledVector(lead.launchDir, 8)
      k = 7
    } else {
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
  // The saucer's top-down view looks straight down; point "up" toward the enemy
  // (+X) so the map reads consistently. Everything else uses world-up.
  camera.up.set(topDownView ? 1 : 0, topDownView ? 0 : 1, 0)
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
  if (weapon.kind === 'saucer') {
    // The saucer doesn't arc — it rises to a cruising altitude and hovers, piloted.
    const dir = dirOf(side)
    const cruiseY = Math.max(muzzle.y + 12, world.surfaceY(muzzle.x, muzzle.z) + 42)
    spawnProj(new THREE.Vector3(muzzle.x + dir.x * 5, cruiseY, muzzle.z + dir.z * 5), new THREE.Vector3(0, 0, 0), weapon, false, side)
    if (side === 0) hud.msg('arrow keys fly the saucer · SPACE to detonate')
  } else {
    spawnProj(muzzle, dirOf(side).multiplyScalar(speedOf(power)), weapon, false, side)
    if (side === 0 && weapon.kind === 'frisbee') hud.msg('← → curve the frisbee · ↑ ↓ flatten / dive the arc')
  }
  if (side === 0) shotThisRound = true
  flyHold = null
  worldView = false
  hud.setWorldView(false)
  hud.showCards(false)
  phase = 'fly'
  hud.setPower(null, shotThisRound ? lastPlayerPower : null)
}

// Hand off to the other side — unless Skip Player flagged them, in which case their
// turn is skipped entirely and the current side goes again.
function advanceTurn(): void {
  const next = 1 - turn
  if (skipNext[next]) {
    skipNext[next] = false
    if (next === 0) hud.showSkipped()
    else hud.msg('the enemy is skipped — go again!')
    startTurn(turn) // Skip's caster takes another turn
  } else {
    startTurn(next)
  }
}

function startTurn(s: number): void {
  turn = s
  rerollWind()
  flyHold = null
  // Age this side's producers a turn (crops mature), then pay out — scaled by how
  // intact each is (integrity) and how mature (crops ramp in over a couple turns).
  for (const p of planted[s]) p.age++
  // Bumper Crop doubles this one payout, then the boost is spent.
  const income = Math.round(sideIncome(s) * incomeBoost[s])
  incomeBoost[s] = 1
  if (income > 0) money[s] += income
  // Modest AI catch-up: the enemy doesn't optimise its spending like a human, so a
  // small per-turn subsidy keeps it able to field weapons, producers AND stratagems.
  if (s === 1) money[1] += 400
  // Pay down any Fireworks debt from this side's fresh income.
  if (fireworksDebt[s] > 0 && money[s] > 0) {
    const pay = Math.min(fireworksDebt[s], money[s])
    money[s] -= pay
    fireworksDebt[s] -= pay
  }
  if (s === 0) {
    const st = sides[0]
    if ((st.arsenal.get(WEAPONS[st.wsel].id) ?? 0) <= 0) {
      st.wsel = 0 // out of the fancy stuff — back to missiles
      updateWeaponHud()
    }
    syncStatus()
    lastIncome = income // surfaced in the market (the msg here is hidden by the overlay)
    if (income > 0) hud.msg(`income +$${income.toLocaleString()}`)
    refreshHand()
    refreshResources()
    // Every turn opens the market (buy cards + resources; weapons only at round
    // start). Leaving it runs castle placement (round start) then resource placement.
    openMarket(roundStartPending)
    roundStartPending = false
  } else {
    aiCards() // buy/play a stratagem first (so producers don't eat the card budget)
    aiPlant() // then grow the economy with what's left
    // A played Flying Toaster takes over the fly pipeline; don't stomp it with aiThink.
    if (phase !== 'fly') {
      phase = 'aiThink'
      aiT = 0
      aiPlanned = null
      hud.banner('ENEMY TURN')
    }
  }
}

// The enemy buys a card now and then, and plays its best applicable one by simple
// heuristics — toaster to attack, ghost when hurt, seize/steal/army vs your economy.
function aiCards(): void {
  const s = 1
  // Buy a card or two when it can spare the cash (keeping a $300 reserve).
  while (money[s] >= CARD_COST + 300 && Math.random() < 0.5) {
    money[s] -= CARD_COST
    hand[s].push(drawCard())
  }
  if (!hand[s].length || Math.random() > 0.7) return
  const id = pickAiCard(s)
  if (!id) return
  hand[s].splice(hand[s].indexOf(id), 1)
  applyCard(s, id)
}

function pickAiCard(s: number): CardId | null {
  const h = hand[s]
  const foeHasProd = planted[1 - s].length > 0
  const myHurt = world.integrity(s) < 0.7
  if (h.includes('toaster')) return 'toaster'
  if (foeHasProd && h.includes('zombie')) return 'zombie'
  if (foeHasProd && h.includes('steal')) return 'steal'
  if (foeHasProd && h.includes('army')) return 'army'
  if (myHurt && h.includes('ghost')) return 'ghost'
  // Fireworks gifts the opponent and blocks your own kills — only when well behind.
  if (h.includes('fireworks') && scoreFoe < scoreYou && Math.random() < 0.3) return 'fireworks'
  return null
}

// Push the player's current hand to the HUD list (above the weapons).
function refreshHand(): void {
  hud.setHand(
    hand[0].map(id => ({ id, name: cardDef(id).name, blurb: cardDef(id).blurb, emoji: cardDef(id).emoji })),
    { onPlay: (i: number) => playCard(0, i) }
  )
}

// Push the player's UNPLACED resources (bought in the market, awaiting placement) to
// the HUD list. Clicking a type places one; the list empties as you place them.
function refreshResources(): void {
  const counts = new Map<number, number>()
  for (const t of pendingResources) counts.set(t, (counts.get(t) ?? 0) + 1)
  hud.setResources(
    PRODUCER_TYPES.filter(t => (counts.get(t) ?? 0) > 0).map(t => ({ type: t, name: PRODUCER_SPECS[t].name, count: counts.get(t)! })),
    { onSelect: (type: number) => beginPlaceResource(type) }
  )
}

// The enemy grows its economy at a measured pace: one producer per turn, a soft cap so
// it doesn't snowball out of the player's reach, and a reserve so it can still afford
// a stratagem. It auto-positions nearest its fort (players place by hand).
function aiPlant(): void {
  const fort = world.forts[1]?.towers[0]
  if (!fort) return
  if (planted[1].length >= 8) return // soft cap — keeps the AI economy in the player's range
  // Buy the best producer that still leaves ~a card's worth in reserve.
  const type = money[1] >= DERRICK_SPEC.cost + 1600 ? DERRICK
    : money[1] >= MINE_SPEC.cost + 1600 ? MINE
    : money[1] >= CROP_SPEC.cost + 900 ? CROP
    : -1
  if (type < 0) return
  const spec = PRODUCER_SPECS[type]
  const spot = world.findProducerSpot(1, fort.cx, fort.cz, type)
  if (!spot) return
  money[1] -= spec.cost
  planted[1].push({ cx: spot.cx, cz: spot.cz, type, baseYield: spec.baseYield, age: 0 })
  world.buildProducer(spot.cx, spot.cz, 1, type, spec.baseYield, 0)
}
const CROP_SPEC = PRODUCER_SPECS[CROP]
const MINE_SPEC = PRODUCER_SPECS[MINE]
const DERRICK_SPEC = PRODUCER_SPECS[DERRICK]

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

// Straight-line sight test: does terrain rise above the line from a to b? Tells
// whether the enemy can actually see the player (vs. firing blind over a hill).
function losBlocked(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): boolean {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const dz = b.z - a.z
  const dist = Math.hypot(dx, dz)
  const steps = Math.max(2, Math.ceil(dist / 2))
  for (let i = 1; i < steps; i++) {
    const t = i / steps
    const sy = world.surfaceY(Math.round(a.x + dx * t), Math.round(a.z + dz * t))
    if (sy > a.y + dy * t + 1) return true // ground pokes above the sightline
  }
  return false
}

function updateAi(dt: number): void {
  if (phase === 'aiThink') {
    aiT += dt
    if (aiT < 0.75) return
    // Aim at wherever the player's cannon currently sits (it may have moved
    // to a surviving tower). If the player's tower is ghosted, the AI can't see it and
    // keeps firing at the decoy (old) spot — a near miss there reveals the real one.
    const seat = world.cannonSeat(0)
    const mainTower = world.forts[0].towers[0]
    const aimX = ghostSide === 0 && ghostDecoy ? ghostDecoy.cx : seat.x
    const aimZ = ghostSide === 0 && ghostDecoy ? ghostDecoy.cz : seat.z
    const target = {
      x: aimX,
      y: Math.max(mainTower.rubbleY + 2, seat.y - 4),
      z: aimZ,
    }
    // Approximate the muzzle for planning: turret centre nudged toward the target.
    const p1 = sides[1].cannon.group.position
    const toward = new THREE.Vector3(target.x - p1.x, 0, target.z - p1.z).normalize()
    const origin = {
      x: p1.x + toward.x * 2.3,
      y: p1.y + 1.65 + 2.6,
      z: p1.z + toward.z * 2.3,
    }
    // If terrain hides the player, the enemy is reduced to guessing where you are
    // — a big extra scatter on top of its already-human aim.
    const blind = losBlocked(origin, target)
    aiPlanned = planShot(world, origin, target, wind, aiErr + (blind ? 16 : 0), Math.random)
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
      aiErr = Math.max(4, aiErr * 0.82) // ranges in slowly, never gets pinpoint
      fireShot(1, weapon, power)
    }
  }
}

// ---------------------------------------------------------------- projectile stepping

// The player steers the Frisbee Bomb: left/right slide it sideways (opposite ways,
// relative to the fixed chase view), up/down flatten or dive the arc. Gravity applies.
function steerFrisbee(p: Proj, h: number): void {
  const L = p.launchDir
  // Screen-right of the (fixed) launch direction, in the horizontal plane
  // (cross(up, -forward) for a camera looking along L with world-up).
  const rx = -L.z
  const rz = L.x
  const strafe = 26 * h
  let dir = 0
  if (keys.has('ArrowRight')) dir += 1
  if (keys.has('ArrowLeft')) dir -= 1
  if (dir !== 0) {
    p.vel.x += rx * strafe * dir
    p.vel.z += rz * strafe * dir
  }
  if (keys.has('ArrowUp')) p.vel.y += 30 * h // flatten / extend
  if (keys.has('ArrowDown')) p.vel.y -= 30 * h // steepen / dive
}

// The Flying Saucer hovers and is flown like a drone in the top-down view: arrows
// glide it across the map (up = toward the enemy), altitude holds steady.
function steerSaucer(p: Proj, h: number): void {
  const SPEED = 17
  let tx = 0
  let tz = 0
  if (keys.has('ArrowUp')) tx += 1 // screen-up = toward the enemy (+x)
  if (keys.has('ArrowDown')) tx -= 1
  if (keys.has('ArrowRight')) tz += 1
  if (keys.has('ArrowLeft')) tz -= 1
  const len = Math.hypot(tx, tz)
  if (len > 0) {
    tx /= len
    tz /= len
  }
  const ease = Math.min(1, 5 * h)
  p.vel.x += (tx * SPEED - p.vel.x) * ease
  p.vel.z += (tz * SPEED - p.vel.z) * ease
  p.vel.y += (0 - p.vel.y) * ease // hold altitude
}

function stepProjectiles(h: number): void {
  for (let i = projs.length - 1; i >= 0; i--) {
    const p = projs[i]
    const piloted = i === 0 && p.side === 0
    // Flying Saucer: a hovering drone — no gravity/wind, doesn't crash into terrain
    // (it just holds above it); it detonates only when the player presses space.
    if (p.weapon.kind === 'saucer') {
      if (piloted) steerSaucer(p, h)
      const nx = p.pos.x + p.vel.x * h
      const ny = p.pos.y + p.vel.y * h
      const nz = p.pos.z + p.vel.z * h
      if (nx < -30 || nx > GX + 30 || nz < -30 || nz > GZ + 30) {
        hud.msg('saucer lost to the void')
        removeProj(p)
        continue
      }
      const surf = world.surfaceY(Math.round(nx), Math.round(nz))
      p.pos.set(nx, Math.max(ny, surf + 4), nz)
      const hs = p.vel.x * p.vel.x + p.vel.z * p.vel.z
      if (hs > 1) p.hdir.set(p.vel.x, 0, p.vel.z).multiplyScalar(1 / Math.sqrt(hs))
      continue
    }
    p.vel.y -= GRAVITY * h
    p.vel.x += wind.x * WIND_ACCEL * h
    p.vel.z += wind.z * WIND_ACCEL * h
    if (p.weapon.kind === 'frisbee' && piloted) steerFrisbee(p, h)
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

// Player triggers the saucer's nuke: it strikes the ground directly beneath it.
function detonateSaucer(p: Proj): void {
  const gx = Math.round(p.pos.x)
  const gz = Math.round(p.pos.z)
  const gy = Math.max(0, world.surfaceY(gx, gz))
  crater(new THREE.Vector3(gx, gy, gz), p.weapon.blast, true)
  removeProj(p)
}

// ---------------------------------------------------------------- resolve & match end

function finishResolve(force = false): void {
  // One more support pass — settling rubble can undermine what's left. The `force`
  // path (safety timeout) skips this so perpetually-settling rubble can't wedge us.
  if (!force && world.updateSupport(Math.random) > 0) {
    resolveT = 0.5
    return
  }
  // Was this resolve a played card (bonus strike) rather than the turn's shot?
  const wasCard = flyIsCard
  flyIsCard = false
  for (let s = 0; s < 2; s++) {
    const seat = world.cannonSeat(s)
    sides[s].targetX = seat.x
    sides[s].targetY = seat.y
    sides[s].targetZ = seat.z
  }
  const iYou = world.integrity(0)
  const iFoe = world.integrity(1)
  hud.setIntegrity(iYou, iFoe)
  const youDead = iYou < COLLAPSE_AT
  const foeDead = iFoe < COLLAPSE_AT
  // Fireworks interception: while active, the holder's killing blow on the enemy castle
  // instead REBUILDS it and bills the holder $1,000 (debt if short). The round goes on.
  if (fireworksSide >= 0) {
    const targetDead = fireworksSide === 0 ? foeDead : youDead
    if (targetDead) {
      const pay = Math.min(1000, money[fireworksSide])
      money[fireworksSide] -= pay
      fireworksDebt[fireworksSide] += 1000 - pay
      fireworksSide = -1
      setNight(false)
      rebuildRoundWorld() // the enemy castle is magically rebuilt
      hud.setIntegrity(world.integrity(0), world.integrity(1))
      syncStatus()
      hud.banner('REBUILT!', 'fireworks spared the castle — billed $1,000')
      advanceTurn()
      return
    }
  }
  if (youDead || foeDead) {
    // Collapsing the enemy tower wins the round and plunders HALF the loser's cash plus
    // one random card. Everything else — producers, weapons, remaining cards/cash —
    // persists into the next round for both sides (no more razing or arsenal looting).
    let plunder = 0
    let stole = ''
    if (foeDead && !youDead) {
      scoreYou++
      plunder = Math.floor(money[1] / 2)
      money[0] += plunder
      money[1] -= plunder
      stole = stealRandomCard(0, 1)
    } else if (youDead && !foeDead) {
      scoreFoe++
      plunder = Math.floor(money[0] / 2)
      money[1] += plunder
      money[0] -= plunder
      stole = stealRandomCard(1, 0)
    }
    const cardNote = stole ? ` and their ${stole} card` : ''
    lastRoundResult =
      youDead && foeDead
        ? `Round ${round} drawn — mutual destruction.`
        : foeDead
          ? `Round ${round} won! Plundered half their treasury ($${plunder.toLocaleString()})${cardNote}.`
          : `Round ${round} lost — the enemy took half your treasury ($${plunder.toLocaleString()})${cardNote}.`
    const losers: number[] = []
    if (youDead) losers.push(0)
    if (foeDead) losers.push(1)
    // The tower loses its last footing and crumbles straight down into rubble; the
    // explosion is deferred until it has finished falling (see the 'end' phase).
    pendingBlasts = []
    for (const l of losers) {
      world.collapseFort(l, Math.random)
      const lt = world.forts[l].towers[0]
      pendingBlasts.push({ cx: lt.cx, cz: lt.cz, y: lt.baseY })
    }
    blastFired = false
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
    syncStatus()
  } else if (wasCard) {
    // A played-card strike that didn't collapse anything — the shooter still shoots.
    phase = turn === 0 ? 'aim' : 'aiThink'
    if (turn === 0) {
      hud.setPower(null, shotThisRound ? lastPlayerPower : null)
      hud.showCards(true)
      hud.banner('YOUR TURN', 'take your shot')
    } else {
      aiT = 0
      aiPlanned = null
    }
  } else {
    advanceTurn()
  }
}

// ---------------------------------------------------------------- rounds & armory

// (Re)build the current round's battlefield — same seed, so buying a tower in
// the armory adds it to the already-visible terrain.
function rebuildRoundWorld(): void {
  world.generate(roundSeed, forti)
  // Re-raise every planted producer into the fresh terrain (skip any spot a new
  // fort/berm now occupies). Terrain is fixed per match, so positions stay valid.
  for (let s = 0; s < 2; s++) {
    for (const p of planted[s]) {
      if (world.canPlaceProducer(p.cx, p.cz, p.type)) world.buildProducer(p.cx, p.cz, s, p.type, p.baseYield, p.age)
    }
  }
  for (let s = 0; s < 2; s++) {
    const st = sides[s]
    const seat = world.cannonSeat(s)
    st.cannon.group.position.set(seat.x, seat.y, seat.z)
    st.targetX = seat.x
    st.targetY = seat.y
    st.targetZ = seat.z
    st.fallV = 0
  }
}

function setupRoundWorld(): void {
  for (const p of [...projs]) removeProj(p)
  for (const t of tasks) {
    if (t.kind === 'roller' || t.kind === 'toaster' || t.kind === 'king') scene.remove(t.mesh)
    else if (t.kind === 'army') for (const r of t.runners) scene.remove(r)
  }
  tasks.length = 0
  // Card effects don't carry between rounds: clear night/ghost/field and restore cannons.
  setNight(false)
  fireworksSide = -1
  ghostSide = -1
  ghostDecoy = null
  ghostReposition = false
  forceFieldSide = -1
  incomeBoost[0] = 1
  incomeBoost[1] = 1
  skipNext[0] = false
  skipNext[1] = false
  sides[0].cannon.group.visible = true
  sides[1].cannon.group.visible = true
  world.hiddenFort = -1
  // Terrain is fixed for the whole match (seed set at match start) so producers you
  // plant stay on valid ground round to round; each round just rebuilds the same land.
  rebuildRoundWorld()
  for (let s = 0; s < 2; s++) {
    sides[s].az = s === 0 ? 0 : Math.PI
    sides[s].el = 55 * DEG
    applyCannonPose(s)
  }
  aiErr = 16
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
  // Farms are now planted per-turn (see aiPlant), not bought here. The shop spends
  // the enemy's winnings on defenses and weapons.
  // A berm is cheap insurance — the enemy grabs one fairly often.
  if (money[1] >= 2500 && forti[1].barricade < 2 && Math.random() < 0.55) {
    money[1] -= 2500
    forti[1].barricade++
  }
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
  // Keep a war chest back so the enemy can still plant producers on its turns (aiPlant).
  const PLANT_RESERVE = 2400
  let bought = true
  while (bought) {
    bought = false
    for (const id of order) {
      const w = WEAPONS.find(x => x.id === id)!
      const owned = sides[1].arsenal.get(id) ?? 0
      if (w.price !== undefined && money[1] - PLANT_RESERVE >= w.price && owned < (caps[id] ?? 2)) {
        money[1] -= w.price
        sides[1].arsenal.set(id, owned + (w.pack ?? 1))
        bought = true
      }
    }
  }
}

const FORT_UPGRADES = [
  { name: 'Defensive berm (blocks flat shots)', price: 2500, max: 2, owned: () => forti[0].barricade, apply: () => (forti[0].barricade += 1) },
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

function shopResources() {
  return PRODUCER_TYPES.map(t => ({
    name: `${PRODUCER_SPECS[t].name} (+$${PRODUCER_SPECS[t].baseYield}/turn)`,
    price: PRODUCER_SPECS[t].cost,
    queued: pendingResources.filter(x => x === t).length,
  }))
}

function refreshShop(): void {
  syncStatus()
  hud.showShop(
    {
      round,
      rounds: ROUNDS,
      scoreYou,
      scoreFoe,
      money: money[0],
      result: marketFull ? lastRoundResult : lastIncome > 0 ? `Your resources paid +$${lastIncome.toLocaleString()} this turn.` : 'No resource income yet — buy resources below and place them on your turn.',
      full: marketFull,
      startLabel: marketFull ? 'START ROUND' : 'DONE — PLACE & AIM',
      cardCost: CARD_COST,
      cardHint: `hand ${hand[0].length} · buy as many as you like`,
      canBuyCard: money[0] >= CARD_COST,
      resources: shopResources(),
      items: shopItems(),
      forts: shopForts(),
    },
    {
      onBuy: buyWeapon,
      onBuyFort: buyFort,
      onBuyCard: () => {
        buyCard(0)
        refreshShop()
      },
      onBuyRes: buyResource,
      onStart: onMarketDone,
    }
  )
}

// Buy a resource in the market — pay now, place it in the plant step afterward.
function buyResource(index: number): void {
  const type = PRODUCER_TYPES[index]
  const spec = PRODUCER_SPECS[type]
  if (money[0] < spec.cost) return void hud.msg('not enough cash')
  money[0] -= spec.cost
  pendingResources.push(type)
  sfx.tick()
  refreshShop()
}

// Leaving the market: round-start goes through castle placement first, then both
// Leaving the market: round-start goes through castle placement first; otherwise
// straight to your turn (aim), where you place resources from the list and/or fire.
function onMarketDone(): void {
  syncStatus()
  if (marketFull) beginCastlePlacement()
  else enterAim()
}

function openMarket(full: boolean): void {
  phase = 'shop'
  marketFull = full
  hud.showCards(false)
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

// A per-round stipend seeds both treasuries so a plundered/razed loser can rebuild
// its economy (guards against an unrecoverable snowball). Tuned further in balance.
const ROUND_STIPEND = 1200
function nextRound(): void {
  round++
  money[0] += ROUND_STIPEND
  money[1] += ROUND_STIPEND
  aiPlaceCastle() // the enemy positions its own castle for the new round
  aiShop() // the enemy restocks weapons/fortifications (round start only)
  setupRoundWorld()
  // The round's first player turn gets the FULL market (weapons/forts) + castle placement.
  roundStartPending = true
  startTurn(0)
}

function fullReset(): void {
  round = 0
  scoreYou = 0
  scoreFoe = 0
  money[0] = START_CASH
  money[1] = START_CASH
  lastRoundResult = ''
  // Fresh battlefield for the new match, fixed across this match's rounds. Producers
  // can be placed anywhere (even water), so any seed is playable.
  roundSeed = Math.floor(Math.random() * 1e9)
  world.castleOverride = [null, null] // castles revert to the seed's spots until placed
  for (let s = 0; s < 2; s++) {
    sides[s].arsenal = newArsenal()
    sides[s].wsel = 0
    forti[s].height = 0
    forti[s].towers = 0
    forti[s].barricade = 0
    planted[s] = []
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
    if (phase === 'castle' && !e.repeat) {
      placeCastle()
    } else if (phase === 'plant' && !e.repeat) {
      placeProducer()
    } else if (phase === 'aim' && !e.repeat) {
      phase = 'charge'
      chargeT = 0
      chargePower = 0
    } else if (phase === 'fly' && !e.repeat) {
      // Detonate a piloted Flying Saucer wherever it's hovering.
      const lead = projs[0]
      if (lead && lead.side === 0 && lead.weapon.kind === 'saucer') detonateSaucer(lead)
    }
  }
  if (e.code === 'Enter' && phase === 'castle') placeCastle()
  if (e.code === 'Enter' && phase === 'plant') placeProducer() // Enter also places a resource
  if (e.code === 'Escape' && phase === 'plant') enterAim() // back to aiming
  if (e.code === 'KeyV') toggleWorldView()
  if (/^Digit[1-9]$/.test(e.code)) {
    // Digits address the visible (owned) weapon list, not the full roster.
    const n = parseInt(e.code.slice(5)) - 1
    const list = visibleWeapons()
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

// How long each aim axis has been held — drives the exponential acceleration.
let azHoldT = 0
let elHoldT = 0

function updatePlayerAim(dt: number): void {
  if (phase !== 'aim' && phase !== 'charge') return
  const s = sides[0]
  const fine = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 0.28 : 1
  // Exponential acceleration: a quick tap barely nudges the barrel; the longer you
  // hold, the faster it sweeps. The hold timer resets the instant you let go of the
  // axis, so rapid tapping stays as a series of tiny, precise nudges.
  const azActive = keys.has('ArrowLeft') || keys.has('ArrowRight')
  const elActive = keys.has('ArrowUp') || keys.has('ArrowDown')
  azHoldT = azActive ? azHoldT + dt : 0
  elHoldT = elActive ? elHoldT + dt : 0
  const azRate = Math.min(2.8, 0.16 * Math.exp(azHoldT / 0.32)) * fine * dt
  const elRate = Math.min(1.9, 0.12 * Math.exp(elHoldT / 0.32)) * fine * dt
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
  updatePlant(dt)
  updateCastle(dt)
  updateAi(dt)

  acc += dt
  while (acc >= STEP) {
    acc -= STEP
    if (projs.length) stepProjectiles(STEP)
  }

  // Trails advance once per frame, not per physics step.
  for (const p of projs) {
    p.mesh.position.copy(p.pos)
    if (p.weapon.kind === 'frisbee' || p.weapon.kind === 'saucer') {
      // A disc flies flat (horizontal) and spins about its vertical axis.
      p.mesh.rotation.x = 0
      p.mesh.rotation.z = 0
      p.mesh.rotation.y += dt * 9
    } else {
      p.mesh.rotation.x += dt * 4
      p.mesh.rotation.z += dt * 3
    }
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

  // Safety net: if a shot lingers too long (a stuck projectile/task that never clears),
  // force it to resolve so the round can't hang mid-flight.
  flyTotal = phase === 'fly' ? flyTotal + dt : 0
  if (phase === 'fly' && (flyTotal > 16 || (projs.length === 0 && tasks.length === 0))) {
    for (const p of [...projs]) removeProj(p)
    for (const t of tasks) {
      if (t.kind === 'roller' || t.kind === 'toaster' || t.kind === 'king') scene.remove(t.mesh)
      else if (t.kind === 'army') for (const r of t.runners) scene.remove(r)
    }
    tasks.length = 0
    phase = 'resolve'
    resolveT = 0
    resolveTotal = 0
  }
  if (phase === 'resolve') {
    resolveT += dt
    resolveTotal += dt
    // Normal finish once rubble settles; hard fallback so it can never wedge forever.
    if ((world.debris.length === 0 && resolveT > 1.1) || resolveTotal > 8) finishResolve(resolveTotal > 8)
  }
  if (phase === 'end') {
    endT += dt
    // Once the crumbled tower has fallen to the ground (rubble settled, or a short
    // fallback delay), set off the explosion: the pile bursts skyward in fire.
    if (!blastFired && (world.debris.length === 0 || endT > 2.4)) {
      blastFired = true
      for (const b of pendingBlasts) {
        const base = new THREE.Vector3(b.cx, world.surfaceY(b.cx, b.cz), b.cz)
        world.burstRubble(b.cx, b.cz, 8, Math.random)
        spawnExplosion(base.clone().add(new THREE.Vector3(0, 3, 0)), 10, true)
        spawnFlash(base.clone().add(new THREE.Vector3(0, 5, 0)), 44, 0xffe0a0)
        spawnFlash(base.clone().add(new THREE.Vector3(0, 1, 0)), 28, 0xffd070)
        addShake(11, base)
      }
      if (pendingBlasts.length) sfx.boom(10)
      pendingBlasts = []
    }
    // Hold on the wreckage a beat after the blast before the result / next round.
    if (!endShown && endT > 4.2 && endInfo) {
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
  // Keep the wind compass screen-relative: arrow points where the wind pushes on
  // screen, whichever way the camera currently faces (fixes the enemy-turn view
  // showing the arrow mirrored against the actual drift).
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
      newMatch: () => void
      plantAt: (cx: number, cz: number) => void
      finishPlant: () => void
      placeCastleAt: (cx: number, cz: number) => void
      craterAt: (cx: number, cz: number, r: number) => void
      giveCard: (id: string) => void
      playCard: (i: number) => void
      hand: () => string[]
      sampleDraws: (n: number) => Record<string, number>
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
    proj0: projs[0]
      ? { x: projs[0].pos.x, y: projs[0].pos.y, z: projs[0].pos.z, vx: projs[0].vel.x, vy: projs[0].vel.y, vz: projs[0].vel.z }
      : null,
    money: [money[0], money[1]],
    planted: [planted[0].length, planted[1].length],
    plantCursor: { cx: Math.round(plantCX), cz: Math.round(plantCZ) },
    hand: [...hand[0]],
    enemyHand: hand[1].length,
    ghostSide,
    fireworksSide,
  }),
  world,
  newMatch: fullReset,
  // Test hooks: select the first pending resource (if not already placing), position
  // the cursor, and place; and return to aim.
  plantAt(cx: number, cz: number) {
    if (phase !== 'plant' && pendingResources.length) beginPlaceResource(pendingResources[0])
    plantCX = cx
    plantCZ = cz
    placeProducer()
  },
  finishPlant: enterAim,
  // Castle test hook: set the cursor and confirm placement.
  placeCastleAt(cx: number, cz: number) {
    castleCX = cx
    castleCZ = cz
    placeCastle()
  },
  craterAt(cx: number, cz: number, r: number) {
    crater(new THREE.Vector3(cx, world.surfaceY(cx, cz), cz), r, true)
  },
  // Card test hooks: add a specific card to the player's hand and play by index.
  giveCard(id: string) {
    hand[0].push(id as CardId)
    refreshHand()
  },
  playCard(i: number) {
    playCard(0, i)
  },
  hand: () => [...hand[0]],
  sampleDraws(n: number) {
    const counts: Record<string, number> = {}
    for (let i = 0; i < n; i++) {
      const id = drawCard()
      counts[id] = (counts[id] ?? 0) + 1
    }
    return counts
  },
}
