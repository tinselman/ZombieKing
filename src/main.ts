// Scorched Earth 3D — main entry: scene, game loop, turns, camera, input.
import * as THREE from 'three'
import { World, GX, GZ, GRAVITY, WIND_ACCEL, CROP, MINE, DERRICK, PLANT, PRODUCER_SPECS, type Wind, type Fortifications } from './world'
import { WEAPONS, FUNKY_CHILD, newArsenal, speedOf, type WeaponDef } from './weapons'
import { planShot } from './ai'
import { createHud } from './hud'
import { flagOf, randomCountry, type Country } from './countries'
import { statOf, cashFromGdp, girthFromMil } from './worldstats'
import { infoOf } from './countryinfo'
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
scene.fog = new THREE.Fog(0xeef1f4, 240, 620)

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

// Up to four seats, one cannon each, tinted to match the fort colours (red / blue /
// green / gold). Only the first `numPlayers` are in play; the rest sit idle (hidden).
const SEAT_CANNON_COLORS = [0xc0392b, 0x2f6fd6, 0x3a9d4a, 0xd6a72f]
// CSS colours matching the four fort bars (red / blue / green / gold), for HUD accents.
const SEAT_HEX = ['#d5473a', '#3a7bd5', '#3a9d4a', '#d6a72f']
function seatColorHex(s: number): string { return SEAT_HEX[s] ?? '#2c3138' }
const sides: SideState[] = SEAT_CANNON_COLORS.map((c, i) => ({
  cannon: makeCannon(c),
  az: i === 0 ? 0 : Math.PI,
  el: 55 * DEG,
  arsenal: newArsenal(),
  wsel: 0,
  targetX: 0,
  targetY: 0,
  targetZ: 0,
  fallV: 0,
}))

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

type Phase = 'castle' | 'plant' | 'aim' | 'charge' | 'fly' | 'resolve' | 'fallout' | 'aiThink' | 'aiAim' | 'end' | 'shop'

// Match economy: best-of-ROUNDS. Income comes from producers (see sideIncome);
// winning a round plunders half the loser's cash + one card (not per-hit pay).
const ROUNDS = 3 // best-of-3: first side to 2 round wins takes the match
const START_CASH = 2500 // turn-1 bankroll — enough for producers/cards, not a decisive weapon

let phase: Phase = 'aim'
let turn = 0
let round = 0
// Seat model (2–4 players). `numPlayers` seats are in play; `seatHuman[s]` = human vs AI;
// `alive[s]` = still standing THIS round (an eliminated seat sits out until the next round);
// `score[s]` = round wins in the match. 1P = [human, AI]; 2P = [human, human].
let numPlayers = 2
const seatHuman = [true, false, false, false]
const alive = [true, true, false, false]
const score = [0, 0, 0, 0]
const money = [START_CASH, START_CASH, START_CASH, START_CASH]
let lastRoundResult = ''
const lastIncome = [0, 0, 0, 0] // resource income collected at the start of each seat's turn
let roundSeed = 0
// True when more than one human shares the keyboard (hotseat) — gates the handoff screen
// and the "Player N" labelling. Derived from seatHuman when a match starts.
let twoPlayer = false
// "The Bitter Truth" mode: real-world economies set starting cash, militaries set fortress
// girth, and the Surrender button unlocks. False = "Just Having a Fun Time" (the base game).
let bitterTruth = false
// Cosmetic per-seat nation (flag + name shown on the fort bars); null until chosen.
const playerCountry: (Country | null)[] = [null, null, null, null]
// The fort-bar label for a seat: its flag + country name if picked, else a plain label.
function fortLabel(s: number): string {
  const c = playerCountry[s]
  if (c) return `${flagOf(c.code)} ${c.name}`
  return twoPlayer || numPlayers > 2 ? `Player ${s + 1}` : s === 0 ? 'Your fort' : 'Enemy fort'
}
function isHuman(s: number): boolean {
  return seatHuman[s]
}
// Screen mirror for the placement/overview cameras + their arrow keys: 2-player seat 2
// views from the opposite end (−1); 3–4 players all share a fixed overhead (+1), with
// per-seat aim handled separately by aimCamera(turn).
function seatMirror(): number {
  return numPlayers > 2 ? 1 : turn === 0 ? 1 : -1
}
// Seats still standing this round (used for turn rotation + win detection).
function livingSeats(): number[] {
  const out: number[] = []
  for (let s = 0; s < numPlayers; s++) if (alive[s]) out.push(s)
  return out
}
// How a seat is named in messages. Prefer its flag + nation (fortLabel) so that when a card is
// played ON you it's always obvious WHO did it — and so 3–4 player games don't call every rival
// "the enemy". Falls back to a plain label only if no country was picked.
function nameOf(s: number): string {
  return fortLabel(s)
}
function capName(s: number): string {
  const n = nameOf(s)
  return /^[a-z]/.test(n) ? n[0].toUpperCase() + n.slice(1) : n // never mangle a leading flag emoji
}
// Match-persistent structure upgrades (taller main tower, extra towers), one per seat.
const forti: Fortifications[] = Array.from({ length: 4 }, () => ({ height: 0, towers: 0, barricade: 0 }))
// Producers the player and AI have planted, positioned on their own half. These persist
// across rounds for BOTH sides (rebuilt into each fresh world) — a lost round only costs
// half your cash and one card, never the economy. type is the cell kind
// (CROP/MINE/DERRICK/CEMETERY); baseYield is full per-turn income; age counts owner-turns
// survived (drives crop maturation).
type Planted = { cx: number; cz: number; type: number; baseYield: number; age: number }
const planted: Planted[][] = [[], [], [], []]
// Resources each side bought in the market, awaiting placement (buy-then-place).
// Carries over if unplaced. marketFull = the round-start market (fortifications too).
const pendingResources: number[][] = [[], [], [], []]
let marketFull = false
const roundStartPending = [false, false, false, false] // each seat's first turn of a round = full market

// Crops ramp in fast (55% → 100% by the second payout); mines/derricks pay full at once.
function maturity(type: number, age: number): number {
  if (!PRODUCER_SPECS[type].matures) return 1
  return Math.min(1, 0.55 + 0.45 * Math.max(0, age - 1))
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

// Refresh the top status bar for the acting player: their cash and resource income
// rate (the turn-start income message is hidden by the market, so keep this visible).
function syncStatus(): void {
  const s = isHuman(turn) ? turn : firstHuman() // during AI turns keep showing a human's numbers
  hud.setStatus(round, ROUNDS, score[0], score[1], money[s], sideIncome(s), twoPlayer || numPlayers > 2 ? turn + 1 : 0)
}
// The lowest-indexed human seat (whose numbers the status bar shows during AI turns).
function firstHuman(): number {
  for (let s = 0; s < numPlayers; s++) if (seatHuman[s]) return s
  return 0
}
// Push all seats' current integrity to their fort bars.
function refreshIntegrity(): void {
  hud.setIntegrity(Array.from({ length: numPlayers }, (_, s) => world.integrity(s)))
}
// Show the right number of fort bars, label each with its nation, highlight whose turn it is.
function refreshForts(): void {
  hud.showForts(numPlayers, Array.from({ length: numPlayers }, (_, s) => fortLabel(s)), turn)
  // In The Bitter Truth, each fort bar is a window onto a real nation: click it for the
  // educational country panel (population, GDP, military, land area + a world locator map).
  hud.setFortInfoClick(bitterTruth ? openCountryInfo : null)
}
// Open the country-info panel for a seat's real-world nation (Bitter Truth only).
function openCountryInfo(s: number): void {
  const c = playerCountry[s]
  if (!c) return
  const stat = statOf(c.code)
  const info = infoOf(c.code)
  hud.showCountryInfo({ flag: flagOf(c.code), name: c.name, pop: info.pop, gdp: stat.gdp, mil: stat.mil, area: info.area, lat: info.lat, lng: info.lng, region: info.region })
}

// ---------------------------------------------------------------- stratagem cards
// A weighted deck: common cards (Skip, Bumper Crop) come up far more often than the
// rare power cards (Zombie King, Toaster). Buy as many as you can afford each turn,
// hold a hand across turns, and play cards before your shot.
type CardId = 'skip' | 'bumper' | 'army' | 'ghost' | 'forcefield' | 'steal' | 'stealres' | 'rebuild' | 'toaster' | 'money1' | 'money2' | 'money5'
type CardDef = { id: CardId; name: string; blurb: string; weight: number; impl: boolean; emoji: string }
const DECK: CardDef[] = [
  { id: 'skip', name: 'Skip Player', weight: 18, impl: true, emoji: '⏭️', blurb: "Skip the enemy's entire next turn — no income, no building, no shot — and take another turn yourself." },
  { id: 'bumper', name: 'Bumper Crop', weight: 28, impl: true, emoji: '🌾', blurb: 'A bounty harvest! Your next income payout from resources is doubled.' },
  { id: 'army', name: 'Army', weight: 22, impl: true, emoji: '🪖', blurb: "An army overruns the enemy's resources — their producers glow pink and their ENTIRE next payout is delivered to you instead. They collect nothing." },
  { id: 'ghost', name: 'Stealth', weight: 16, impl: true, emoji: '👻', blurb: 'Reposition your castle anywhere and vanish. You still see it, but every other player is blind to it — turn after turn — until a shell lands within ten voxels of the real tower.' },
  { id: 'forcefield', name: 'Force Field', weight: 15, impl: true, emoji: '🛡️', blurb: 'A hidden shield no other player can see. It holds, turn after turn, until one hostile hit — a shell, a toaster, an army, or a theft — is blocked completely; then the field is spent. It never blocks twice.' },
  { id: 'steal', name: 'Steal', weight: 12, impl: true, emoji: '🫳', blurb: "Seize the enemy's richest producer — it's ripped off the map and added to YOUR resources, to place anywhere you like." },
  { id: 'stealres', name: 'Steal Resources!', weight: 6, impl: true, emoji: '🏴‍☠️', blurb: 'A world-wide heist — the single richest producer from EVERY opponent is ripped off the map at once and added to YOUR resources to re-place.' },
  { id: 'rebuild', name: 'Rebuild', weight: 11, impl: true, emoji: '🧱', blurb: "Repair your castle voxel by voxel — every missing block refills using bricks ripped from the enemy tower, spending up to half their tower. Never builds past the turret top." },
  { id: 'toaster', name: 'Flying Toaster', weight: 6, impl: true, emoji: '🍞', blurb: 'A winged toaster homes onto the enemy castle and strikes with the power of a nuke — a free bonus attack on top of your shot.' },
  { id: 'money1', name: 'Money: $2,000', weight: 6, impl: true, emoji: '💵', blurb: 'Found money. Play to pocket $2,000.' },
  { id: 'money2', name: 'Money: $3,500', weight: 4, impl: true, emoji: '💰', blurb: 'A fat purse. Play to pocket $3,500.' },
  { id: 'money5', name: 'Money: $6,000', weight: 2, impl: true, emoji: '🤑', blurb: "A king's ransom. Play to pocket $6,000." },
]
const CARD_COST = 1500
const hand: CardId[][] = [[], [], [], []] // cards each seat is holding
// Ghost Tower state, per seat: the decoy (old) position an opponent keeps aiming at while
// that seat's real tower is hidden/moved (null = not ghosted). In hotseat a ghosted tower
// is hidden only during OTHER seats' turns (see reallyStartTurn).
const ghostDecoyOf: ({ cx: number; cz: number } | null)[] = [null, null, null, null]
// Army raid, per VICTIM: who raided them ({caster,done}) — their next payout goes to caster.
const armyRaidOf: ({ caster: number; done: boolean } | null)[] = [null, null, null, null]
// Diplomacy (3+ players). trust[a][b] = how much seat a trusts b: a reciprocated trade lifts
// both over ALLY (allied — AIs don't shoot each other + keep trading); a betrayal or an attack
// drops it hard (into the negatives), and it only climbs back with repeated gifts. giftOwed[g][r]
// = g gave r an as-yet-unreciprocated gift (the betrayal trigger once r has had a turn since).
const ALLY_TRUST = 2
const trust: number[][] = [0, 1, 2, 3].map(() => [0, 0, 0, 0])
const giftOwed: boolean[][] = [0, 1, 2, 3].map(() => [false, false, false, false])
const owedActedSince: boolean[][] = [0, 1, 2, 3].map(() => [false, false, false, false])
function alliedWith(a: number, b: number): boolean {
  return a !== b && trust[a][b] >= ALLY_TRUST && trust[b][a] >= ALLY_TRUST
}
// The Bitter Truth surrender/vassalage: overlord[s] = the seat s knelt to (-1 if independent).
// Surrender forms a LOYAL ALLIANCE — a permanent team that never fires on itself and wins
// together. Teams follow the overlord chain to a root; two seats share a team iff same root.
const overlord = [-1, -1, -1, -1]
function teamRoot(s: number): number {
  let r = s
  const seen = new Set<number>()
  while (overlord[r] >= 0 && !seen.has(r)) { seen.add(r); r = overlord[r] }
  return r
}
function sameTeam(a: number, b: number): boolean {
  return teamRoot(a) === teamRoot(b)
}
function teamSize(s: number): number {
  return livingSeats().filter(o => sameTeam(o, s)).length
}
// Force Field: per-seat active (as-yet-unhit) shield. Bumper Crop: ×2 on the seat's NEXT
// income payout. Skip Player: the seat's next turn is skipped.
const forceField = [false, false, false, false]
const incomeBoost = [1, 1, 1, 1]
const skipNext = [false, false, false, false]
// Extra turns a seat must sit out (nuclear meltdown on its own reactor, or a fallout cloud
// drifting over it) — counts DOWN one per would-be turn, on top of the one-shot Skip card.
const skipTurns = [0, 0, 0, 0]
// Resource-wheel state: a Blockade denies a seat its wheel income. (Nothing grants attack-immunity
// any more — only the Force Field card blocks.)
const resourceBlocked = [false, false, false, false]
// ---- one-turn DEBUFF lifetimes --------------------------------------------------------------
// One-turn effects are the DEBUFFS you inflict on a rival: a Blockade (no wheel income) and an
// Army raid (next payout forfeit). `turnSerial` ticks once per turn; each records the serial it
// was applied on, and expireTurnEffects() clears it at the END of the victim's turn — but never
// on the turn it was applied — so it costs them exactly their next turn and no more.
// (Force Field and Stealth are NOT here: those self-buffs persist until TRIGGERED — a shield
// until it eats a hit, a cloaked fort until a shell lands near its real tower — see below.)
let turnSerial = 0
const appliedAt = { blocked: [0, 0, 0, 0], raid: [0, 0, 0, 0] }
function blockSeat(s: number): void { resourceBlocked[s] = true; appliedAt.blocked[s] = turnSerial }
function expireTurnEffects(s: number): void {
  if (resourceBlocked[s] && appliedAt.blocked[s] < turnSerial) resourceBlocked[s] = false
  if (armyRaidOf[s] && appliedAt.raid[s] < turnSerial) armyRaidOf[s] = null
}
// Drifting radioactive clouds from meltdowns — a roiling mass of dark particle puffs per
// exploded reactor (chain reactions loose several at once). Each rises from its plant, then
// rides a live, meandering wind; every nation it passes over loses its crops and two turns.
// While ANY cloud (or a pending chain detonation) is in the sky, the game holds the next turn
// so every player watches where the fallout goes (see finishResolve / updateFallouts).
type FalloutCloud = {
  pos: THREE.Vector3
  life: number
  group: THREE.Group
  puffs: { m: THREE.Mesh; base: THREE.Vector3; ph: number; sp: number }[]
  hit: Set<number>
}
let fallouts: FalloutCloud[] = []
// The fallout's own weather: seeded from the turn's wind, then meandering smoothly (layered
// sines ≈ Perlin) — so venting a reactor when the wind points at an enemy is a real gamble;
// the sky can turn on you mid-drift. The HUD wind arrow tracks it live.
let falloutWind: { baseAng: number; baseMag: number; t: number; p1: number; p2: number; p3: number } | null = null
const pendingMeltdowns: { owner: number; cx: number; cz: number; delay: number }[] = [] // staggered chain blasts
let falloutContinuation: (() => void) | null = null // the held remainder of finishResolve
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
  if (money[side] < CARD_COST) return void (isHuman(side) && hud.msg('not enough cash'))
  money[side] -= CARD_COST
  const id = drawCard()
  hand[side].push(id)
  if (isHuman(side)) {
    sfx.tick()
    syncStatus()
    refreshHand()
    hud.msg(`drew ${cardDef(id).name}`)
  }
}

// Cards that strike a CHOSEN opponent (vs. self-buff/economy cards, or Steal Resources! which
// hits every opponent at once — neither needs the target picker).
const HOSTILE_CARDS = new Set<CardId>(['skip', 'army', 'steal', 'rebuild', 'toaster'])

function playCard(side: number, idx: number): void {
  const id = hand[side][idx]
  if (!id) return
  if (isHuman(side) && phase !== 'aim' && phase !== 'plant') return void hud.msg('play cards before firing')
  const finish = (target?: number) => {
    hand[side].splice(idx, 1)
    if (isHuman(side)) {
      sfx.tick()
      refreshHand()
    }
    applyCard(side, id, target)
    refreshResources() // steal/zombie move producers between sides
  }
  // In a 3–4 player game a human chooses which opponent a hostile card hits (never a teammate).
  const foes = livingSeats().filter(s => !sameTeam(s, side))
  if (isHuman(side) && HOSTILE_CARDS.has(id) && foes.length > 1) {
    hud.showTargetPicker(
      `${cardDef(id).emoji} ${cardDef(id).name} — strike whom?`,
      foes.map(s => ({ seat: s, label: fortLabel(s) })),
      seat => finish(seat)
    )
    return
  }
  finish() // 1–2 player, self-card, or AI: auto-target the sole/weakest opponent
}

// ---- Trade & diplomacy (3+ players) -----------------------------------------------
type TradeKind = 'card' | 'resource' | 'weapon'

// What seat `s` currently owns that could be traded (used to build the trade overlay + AI gifts).
function tradableItems(s: number): { kind: TradeKind; key: string; label: string; emoji: string }[] {
  const out: { kind: TradeKind; key: string; label: string; emoji: string }[] = []
  for (const id of hand[s]) out.push({ kind: 'card', key: id, label: cardDef(id).name, emoji: cardDef(id).emoji })
  for (const t of pendingResources[s]) out.push({ kind: 'resource', key: String(t), label: PRODUCER_SPECS[t].name, emoji: '📦' })
  for (const w of WEAPONS) {
    if (w.ammo === Infinity || w.price === undefined) continue // Baby Missile is infinite — not tradable
    const n = sides[s].arsenal.get(w.id) ?? 0
    for (let k = 0; k < n; k++) out.push({ kind: 'weapon', key: w.id, label: w.name, emoji: '💥' })
  }
  return out
}

// Physically move one item from seat `from` to seat `to` and arc a couple of voxels across
// in the giver's colour — no diplomacy side-effects (used for the extra items in a bundle).
function moveItem(from: number, to: number, kind: TradeKind, key: string): boolean {
  if (kind === 'card') {
    const i = hand[from].indexOf(key as CardId)
    if (i < 0) return false
    hand[from].splice(i, 1)
    hand[to].push(key as CardId)
  } else if (kind === 'resource') {
    const type = Number(key)
    const i = pendingResources[from].indexOf(type)
    if (i < 0) return false
    pendingResources[from].splice(i, 1)
    pendingResources[to].push(type)
  } else {
    const n = sides[from].arsenal.get(key) ?? 0
    if (n <= 0) return false
    sides[from].arsenal.set(key, n - 1)
    sides[to].arsenal.set(key, (sides[to].arsenal.get(key) ?? 0) + 1)
  }
  const a = sides[from].cannon.group.position
  const b = sides[to].cannon.group.position
  const pts = [
    new THREE.Vector3(a.x, a.y + 3, a.z),
    new THREE.Vector3(a.x + 1, a.y + 4, a.z + 1),
    new THREE.Vector3(a.x - 1, a.y + 4, a.z - 1),
  ]
  spawnVoxelFlight(pts, [
    new THREE.Vector3(b.x, b.y + 3, b.z),
    new THREE.Vector3(b.x + 1, b.y + 4, b.z + 1),
    new THREE.Vector3(b.x - 1, b.y + 4, b.z - 1),
  ], SEAT_CANNON_COLORS[from])
  sfx.pop()
  refreshHand()
  refreshResources()
  updateWeaponHud()
  return true
}

// Move one item AND update trust: a gift raises the receiver's trust; a gift that answers an
// outstanding one is a completed trade, pushing BOTH directions across ALLY (the giver gains
// a second bump for this direction and the original giver climbs too). Otherwise the giver is
// now owed a trade-back. Used for AI one-way gifts and the FIRST item each way in a trade.
function transferItem(from: number, to: number, kind: TradeKind, key: string): boolean {
  if (!moveItem(from, to, kind, key)) return false
  trust[to][from] += 1
  if (giftOwed[to][from]) {
    trust[to][from] += 1
    trust[from][to] += 1
    giftOwed[to][from] = false
    owedActedSince[to][from] = false
  } else {
    giftOwed[from][to] = true
    owedActedSince[from][to] = false
  }
  return true
}

// Settle a negotiated trade: `offered` flows from→to, `returned` flows to→from. The first
// item each way carries the trust bookkeeping (so a bundle counts as one reciprocated gift,
// regardless of size); the rest are plain moves. An empty `returned` leaves the offerer owed
// a trade-back — the one-way-gift (and possible betrayal) path.
function resolveTrade(from: number, to: number, offered: { kind: TradeKind; key: string }[], returned: { kind: TradeKind; key: string }[]): void {
  offered.forEach((it, i) => (i === 0 ? transferItem : moveItem)(from, to, it.kind, it.key))
  returned.forEach((it, i) => (i === 0 ? transferItem : moveItem)(to, from, it.kind, it.key))
}

// ---- Trade negotiation (human offers; recipient accepts/rejects) ------------------------
type StagedItem = { kind: TradeKind; key: string; label: string; emoji: string }
let stagingBundle: StagedItem[] = [] // items being assembled for an offer or a return

// Items in `items` minus one occurrence of each entry already staged in `bundle` (matched by
// kind+key) — i.e. what's still available to add.
function remainingItems(items: StagedItem[], bundle: StagedItem[]): StagedItem[] {
  const used = new Map<string, number>()
  for (const b of bundle) used.set(b.kind + b.key, (used.get(b.kind + b.key) ?? 0) + 1)
  const out: StagedItem[] = []
  for (const it of items) {
    const k = it.kind + it.key
    const u = used.get(k) ?? 0
    if (u > 0) used.set(k, u - 1)
    else out.push(it)
  }
  return out
}

// Human trade flow: pick a living opponent, assemble an offer, send it — the recipient then
// accepts (choosing what to send back) or rejects (nothing changes hands). Trade is free.
function offerTrade(side: number): void {
  if (phase !== 'aim') return
  const foes = livingSeats().filter(s => s !== side)
  if (!foes.length) return void hud.msg('no one left to trade with')
  if (foes.length === 1) return void composeOffer(side, foes[0])
  hud.showTargetPicker(
    '🤝 Trade with whom?',
    foes.map(s => ({ seat: s, label: fortLabel(s) })),
    to => composeOffer(side, to)
  )
}

function composeOffer(from: number, to: number): void {
  stagingBundle = []
  const avail = () => remainingItems(tradableItems(from), stagingBundle)
  hud.showTradeCompose({
    title: `🤝 OFFER TO ${fortLabel(to)}`,
    subtitle: 'Click items to add them to your offer, then send it across.',
    them: tradableItems(to).map(i => ({ label: i.label, emoji: i.emoji })),
    poolLabel: 'YOUR ITEMS — click to add',
    bundleLabel: 'OFFERING',
    getPool: avail,
    getBundle: () => stagingBundle,
    onAdd: idx => { const p = avail()[idx]; if (p) stagingBundle.push(p) },
    onRemove: idx => stagingBundle.splice(idx, 1),
    primaryLabel: 'SEND OFFER',
    onPrimary: () => {
      if (!stagingBundle.length) return void (hud.msg('add at least one item to offer'), composeOffer(from, to))
      submitOffer(from, to, stagingBundle.slice())
    },
    secondaryLabel: 'CANCEL',
    onSecondary: () => {},
  })
}

function submitOffer(from: number, to: number, offered: StagedItem[]): void {
  if (isHuman(to)) humanRespondToTrade(from, to, offered)
  else aiRespondToTrade(from, to, offered)
}

// The computer decides instantly by trust: a hard grudge rejects; otherwise it accepts and
// sends back a fair token when it's friendly / allied / already owes you, else it takes the
// gift and returns nothing (the owed-gift is repaid later on its own turn, per aiDiplomacy).
function aiRespondToTrade(from: number, to: number, offered: StagedItem[]): void {
  const label = fortLabel(to)
  if (trust[to][from] <= -2) return void hud.msg(`${label} rejects your offer`)
  const wantReturn = alliedWith(to, from) || giftOwed[from][to] || trust[to][from] >= 1
  const spares = wantReturn ? tradableItems(to).slice(0, Math.max(1, offered.length)) : []
  resolveTrade(from, to, offered, spares)
  hud.msg(spares.length ? `${label} accepts — sends back ${spares.map(s => s.label).join(', ')}` : `${label} accepts your gift — sends nothing back`)
}

// A human recipient (hotseat) gets the keyboard, sees the offer, and accepts (then picks a
// return) or rejects. Afterwards the keyboard passes back to the offerer, still mid-turn.
function humanRespondToTrade(from: number, to: number, offered: StagedItem[]): void {
  const decide = () =>
    hud.showTradeDecision({
      title: `${fortLabel(from)} OFFERS YOU A TRADE`,
      subtitle: 'Accept and choose what to send back, or reject — on reject nothing changes hands.',
      offered: offered.map(i => ({ label: i.label, emoji: i.emoji })),
      onAccept: () => composeReturn(from, to, offered),
      onReject: () => {
        hud.msg(`${fortLabel(to)} rejected the offer`)
        backToOfferer(from)
      },
    })
  if (twoPlayer) hud.showHandoff(to + 1, decide, `PLAYER ${to + 1} — TRADE OFFER`, `${fortLabel(from)} wants to trade. Pass the keyboard to ${fortLabel(to)}.`, 'REVIEW OFFER')
  else decide()
}

function composeReturn(from: number, to: number, offered: StagedItem[]): void {
  stagingBundle = []
  const avail = () => remainingItems(tradableItems(to), stagingBundle)
  hud.showTradeCompose({
    title: `SEND BACK TO ${fortLabel(from)}?`,
    subtitle: 'Pick what to send back (a fair trade builds an alliance), or send nothing.',
    them: offered.map(i => ({ label: i.label, emoji: i.emoji })),
    poolLabel: 'YOUR ITEMS — click to add',
    bundleLabel: 'SENDING BACK',
    getPool: avail,
    getBundle: () => stagingBundle,
    onAdd: idx => { const p = avail()[idx]; if (p) stagingBundle.push(p) },
    onRemove: idx => stagingBundle.splice(idx, 1),
    primaryLabel: 'SEND BACK',
    onPrimary: () => {
      resolveTrade(from, to, offered, stagingBundle.slice())
      backToOfferer(from)
    },
    secondaryLabel: 'SEND NOTHING',
    onSecondary: () => {
      resolveTrade(from, to, offered, []) // accepted the gift, returns nothing
      backToOfferer(from)
    },
  })
}

// Hand the keyboard back to the offerer (hotseat only); their turn never left the aim phase.
function backToOfferer(from: number): void {
  if (twoPlayer) hud.showHandoff(from + 1, () => {}, `PLAYER ${from + 1} — BACK TO YOU`, 'Trade settled. Pass the keyboard back and take your shot.', 'CONTINUE')
}

// ---- Surrender / vassalage (The Bitter Truth) -------------------------------------------
// Kneel to `master`: a permanent loyal alliance. The vassal and master (and all their kin)
// form one team that never fires on itself and wins together; the vassal fights the master's
// enemies from here on. Trust is pinned high so no diplomacy code treats them as foes.
function surrender(vassal: number, master: number): void {
  if (vassal === master || sameTeam(vassal, master)) return
  overlord[vassal] = master
  trust[vassal][master] = Math.max(trust[vassal][master], ALLY_TRUST + 2)
  trust[master][vassal] = Math.max(trust[master][vassal], ALLY_TRUST + 2)
  giftOwed[vassal][master] = false
  giftOwed[master][vassal] = false
  refreshForts()
  hud.setSurrender(false) // you can only kneel once
  sfx.rumble()
  hud.banner(`${fortLabel(vassal)} SURRENDERS`, `now fights for ${fortLabel(master)}`, 2400)
  // If that leaves only one faction on the field, the war is already won — no shot needed.
  if (new Set(livingSeats().map(teamRoot)).size <= 1) concludeRound([])
}

// A human presses SURRENDER (aim phase, Bitter Truth): choose which rival to kneel to. Only
// rival TEAMS are offered (no point surrendering to your own side).
function offerSurrender(side: number): void {
  if (phase !== 'aim') return
  const foes = livingSeats().filter(s => !sameTeam(s, side))
  if (!foes.length) return void hud.msg('no rival left to surrender to')
  const pick = (master: number) => surrender(side, master)
  if (foes.length === 1) return void pick(foes[0])
  hud.showTargetPicker(
    '🏳️ Who do you surrender to?',
    foes.map(s => ({ seat: s, label: fortLabel(s) })),
    pick
  )
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

// The default victim for a hostile card: the weakest living opponent (the sole opponent
// in a 2-player game). Callers may override with an explicit target (human picker / AI).
function defaultFoe(side: number): number {
  const foes = livingSeats().filter(s => !sameTeam(s, side))
  if (!foes.length) return (side + 1) % Math.max(2, numPlayers)
  foes.sort((a, b) => world.integrity(a) - world.integrity(b))
  return foes[0]
}

function applyCard(side: number, id: CardId, target = defaultFoe(side)): void {
  const foe = target
  if (id === 'steal') cardSteal(side, foe)
  else if (id === 'stealres') cardStealResources(side)
  else if (id === 'army') cardArmy(side, foe)
  else if (id === 'toaster') cardToaster(side, foe)
  else if (id === 'ghost') cardGhost(side)
  else if (id === 'bumper') cardBumper(side)
  else if (id === 'skip') cardSkip(side, foe)
  else if (id === 'forcefield') cardForcefield(side)
  else if (id === 'rebuild') cardRebuild(side, foe)
  else if (id === 'money1') cardMoney(side, 2000)
  else if (id === 'money2') cardMoney(side, 3500)
  else if (id === 'money5') cardMoney(side, 6000)
}

// Force Field: if the victim has an active shield, it eats this hostile act — flare
// at their castle, shield spent — and the act is fully blocked.
function shieldBlocks(victim: number): boolean {
  if (!forceField[victim]) return false
  forceField[victim] = false
  const t = world.forts[victim]?.towers[0]
  if (t) spawnShieldBlock(t.cx, t.cz)
  return true
}

// Money cards: rare found cash, banked the moment they're played.
function cardMoney(side: number, amount: number): void {
  money[side] += amount
  syncStatus()
  hud.msg(`${capName(side)} pocketed $${amount.toLocaleString()}`)
}

// Bumper Crop: double this side's NEXT income payout (applied and cleared in startTurn).
function cardBumper(side: number): void {
  incomeBoost[side] = 2
  hud.msg(`${capName(side)} banked a bumper crop — next income doubled`)
}

// Skip Player: the opponent's entire next turn is skipped; the caster goes again.
function cardSkip(side: number, foe: number): void {
  skipNext[foe] = true
  hud.msg(`${capName(side)} played Skip — ${nameOf(foe)} loses the next turn`)
}

// Force Field: raise an INVISIBLE one-hit shield over your castle (see crater()). It is unseen by
// every other player and holds — turn after turn — until it eats a single hostile hit, then it's
// spent (it can never block twice). The confirmation shows only on the caster's own turn.
function cardForcefield(side: number): void {
  forceField[side] = true
  hud.msg(`${capName(side)} raised a hidden force field — it holds until it takes a hit`)
}

// Rebuild: repair your own tower's missing voxels, brick by brick from the ground up,
// using voxels ripped from the enemy tower (at most half of it). Never exceeds the
// original blueprint — a whole tower gains nothing.
function cardRebuild(side: number, foe: number): void {
  if (shieldBlocks(foe)) return void hud.msg('the force field guards their bricks!')
  const { from, to } = world.repairTransfer(foe, side, forti[side])
  if (!to.length) return void (isHuman(side) && hud.msg('your castle has no missing voxels to repair'))
  world.rebuild()
  refreshIntegrity()
  spawnVoxelFlight(from, to, side === 0 ? 0xffb0a0 : 0xa0c0ff)
  sfx.rumble()
  hud.msg(`${capName(side)} repaired ${to.length} voxels with ${nameOf(foe)}'s bricks`)
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
// Steal: the enemy's richest producer is ripped off the map and lands in YOUR
// unplaced-resources list — place it anywhere you like on your turns.
function cardSteal(side: number, foe: number): void {
  const income = planted[foe]
  if (!income.length) return void (isHuman(side) && hud.msg(`${nameOf(foe)} has nothing to steal`))
  if (shieldBlocks(foe)) return void hud.msg('the force field repels the thief!')
  let richest = income[0]
  for (const p of income) if (p.baseYield > richest.baseYield) richest = p
  const best = planted[foe].indexOf(richest)
  const p = planted[foe].splice(best, 1)[0]
  world.removeProducer(p.cx, p.cz)
  pendingResources[side].push(p.type)
  if (isHuman(side)) refreshResources()
  syncStatus()
  hud.msg(`${capName(side)} stole ${nameOf(foe)}'s ${PRODUCER_SPECS[p.type].name} — it's in ${side === turn ? 'your' : 'their'} Resources list`)
}

// Army: overruns the enemy economy. Their producers glow pink and their ENTIRE next
// resource payout is delivered to the raider — the victim collects nothing that turn.
// The pink lifts when the victim's turn is over.
function cardArmy(side: number, foe: number): void {
  if (shieldBlocks(foe)) return void hud.msg('the force field turns the army away!')
  spawnArmy(side)
  armyRaidOf[foe] = { caster: side, done: false }
  appliedAt.raid[foe] = turnSerial
  world.setRaided(foe)
  hud.msg(`${capName(side)}'s army overruns ${nameOf(foe)}'s resources — their next payout is forfeit!`)
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
  hud.msg(`${capName(side)}'s flying toaster is inbound!`)
}

// Steal Resources!: a world-wide heist — the single richest producer of EVERY opponent is
// ripped off the map at once and dropped into the caster's unplaced-resources list. A foe's
// Force Field saves theirs.
function cardStealResources(side: number): void {
  const foes = livingSeats().filter(s => !sameTeam(s, side))
  let taken = 0
  for (const foe of foes) {
    if (shieldBlocks(foe) || !planted[foe].length) continue
    let richest = planted[foe][0]
    for (const p of planted[foe]) if (p.baseYield > richest.baseYield) richest = p
    const p = planted[foe].splice(planted[foe].indexOf(richest), 1)[0]
    world.removeProducer(p.cx, p.cz)
    pendingResources[side].push(p.type)
    taken++
  }
  if (isHuman(side)) refreshResources()
  syncStatus()
  hud.msg(taken ? `${capName(side)} raided ${taken} producer${taken > 1 ? "s" : ""} from across the map — re-place them from your Resources list` : "nothing to steal — no one has producers")
}

// Ghost Tower. A HUMAN caster repositions their castle by hand; it stays visible to
// them but the opponent can't find it — the AI fires at the decoy (old) spot, and in
// hotseat the tower is simply hidden during the other player's turn (see startTurn) —
// until a shell lands within 10 of the real tower. The 1P AI auto-jumps instead.
function cardGhost(side: number): void {
  const oldT = world.forts[side]?.towers[0]
  ghostDecoyOf[side] = oldT ? { cx: oldT.cx, cz: oldT.cz } : null
  if (isHuman(side)) {
    // Hand-reposition; the ghost is confirmed on placement (placeCastle sets the decoy).
    ghostReposition = true
    beginCastlePlacement()
    return
  }
  // AI seat: jump to a random spot near its own corner and vanish from its opponents.
  const home = world.forts[side].towers[0]
  const cx = Math.max(12, Math.min(GX - 12, Math.round(home.cx + (Math.random() - 0.5) * 40)))
  const cz = Math.max(8, Math.min(GZ - 8, Math.round(home.cz + (Math.random() - 0.5) * 30)))
  world.castleOverride[side] = { cx, cz }
  world.moveFort(side, cx, cz, forti[side]) // carries the tower's damage to the new spot
  world.hiddenForts[side] = true
  world.rebuild()
  refreshIntegrity()
  snapCannonToSeat(side)
  sides[side].cannon.group.visible = false
  hud.msg(`${capName(side)}'s tower vanishes!`)
}

// A shell landed near seat `g`'s ghosted tower — it snaps back into view for everyone.
function revealGhost(g: number): void {
  if (!ghostDecoyOf[g]) return
  world.hiddenForts[g] = false
  sides[g].cannon.group.visible = true
  world.rebuild()
  hud.msg(g === turn ? `${capName(g)}'s ghost tower has been spotted!` : `${capName(g)}'s ghost tower is found!`)
  ghostDecoyOf[g] = null
}

let wind: Wind = { x: 0, z: 0 }
let chargeT = 0
let chargePower = 0
const lastPlayerPower = [60, 60, 60, 60] // per seat: last shot power (aim marker)
const shotThisRound = [false, false, false, false] // power marker only shows after a seat's first shot
let resolveT = 0
let resolveTotal = 0 // wall-clock in 'resolve' (not reset by the settling guard) — safety net
let flyTotal = 0 // wall-clock in 'fly' — forces a stuck shot (lingering proj/task) to resolve
// Per-seat integrity captured when the current shot took flight — finishResolve compares
// against it to see whom the acting seat just damaged (drops trust: allies you shell defect).
const preShotIntegrity = [1, 1, 1, 1]
let aiT = 0
let aiErr = 16 // enemy aim scatter — modest and human; ranges in slowly, never pinpoint
let aiPlanned: { az: number; el: number; power: number } | null = null
let aiAnimT = 0
let aiStart = { az: 0, el: 0 }
let endT = 0
let endShown = false
let endInfo: { line1: string; line2: string; winner: number; center: THREE.Vector3 } | null = null
// Defeated towers crumble first, THEN explode once the rubble has settled.
let pendingBlasts: { cx: number; cz: number; y: number }[] = []
let blastFired = true
// Celebratory fireworks that keep popping over the wreckage after the first burst.
let victoryT = 0
let victoryBursts = 0
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
  | { kind: 'roller'; x: number; z: number; dx: number; dz: number; flat: number; steps: number; t: number; mesh: THREE.Mesh }
  | { kind: 'napalm'; blobs: { x: number; z: number; life: number }[]; t: number }
  | { kind: 'toaster'; mesh: THREE.Mesh; pos: THREE.Vector3; target: THREE.Vector3; t: number }
  | { kind: 'army'; runners: THREE.Mesh[]; z0: number[]; x: number; dir: number; t: number }
  | { kind: 'voxfly'; items: { mesh: THREE.Mesh; from: THREE.Vector3; to: THREE.Vector3 }[]; t: number; dur: number }
  | { kind: 'shield'; mesh: THREE.Mesh; t: number }
const tasks: Task[] = []
// When true, the current fly→resolve pass is a played card (Flying Toaster), not a
// normal shot: on resolve it hands the turn back to the shooter instead of advancing.
let flyIsCard = false

function crater(at: THREE.Vector3, r: number, fire: boolean): void {
  // Force field: an ANOTHER player's blast reaching a shielded castle is eaten entirely (any
  // weapon, no penetration) and the shield is spent — it never blocks twice, and it holds across
  // turns until that one hit lands. Your own shell can't trip your own shield (fsel === turn).
  for (let fsel = 0; fsel < numPlayers; fsel++) {
    if (!forceField[fsel] || fsel === turn) continue
    const ft = world.forts[fsel]?.towers[0]
    if (ft && Math.hypot(at.x - ft.cx, at.z - ft.cz) < 5 + r) {
      spawnShieldBlock(ft.cx, ft.cz)
      forceField[fsel] = false
      lastImpact.copy(at)
      return // nothing gets through
    }
  }
  // Loyal-alliance ceasefire (Bitter Truth): a shell reaching a TEAMMATE of the acting seat is
  // turned aside at their walls.
  for (let a = 0; a < numPlayers; a++) {
    if (a === turn || !alive[a]) continue
    if (!(bitterTruth && sameTeam(a, turn))) continue
    const ft = world.forts[a]?.towers[0]
    if (ft && Math.hypot(at.x - ft.cx, at.z - ft.cz) < 5 + r) {
      spawnShieldBlock(ft.cx, ft.cz)
      lastImpact.copy(at)
      return
    }
  }
  world.carve(at.x, at.y, at.z, r)
  // Berms armor the whole fort against the shockwave: 0/1/2 berms → ×1 / ×0.72 / ×0.52
  // removal chance, so an economy-funded defense can survive an otherwise-lethal nuke.
  const armor = forti.map(f => Math.pow(0.72, f.barricade))
  if (fire) world.shockwave(at.x, at.y, at.z, r, Math.random, armor)
  world.updateSupport(Math.random)
  spawnExplosion(at, r, fire)
  sfx.boom(r)
  addShake(r, at)
  lastImpact.copy(at)
  // A shell landing within 10 voxels of any ghosted tower snaps it back into view.
  for (let g = 0; g < numPlayers; g++) {
    if (!ghostDecoyOf[g]) continue
    const t = world.forts[g]?.towers[0]
    if (t && Math.hypot(at.x - t.cx, at.z - t.cz) < 10) revealGhost(g)
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
    if (t.kind === 'roller') {
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
        crater(t.target.clone(), 5, true) // nuke-class single blast, toned down a tier
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

// A big celebratory particle burst when a castle is destroyed — a dense, colourful
// fountain of confetti/sparks in the winner's colours plus festive gold, far larger
// and longer-lived than a shell explosion. Gravity (in updateFx) arcs it back down.
function spawnVictoryBurst(at: THREE.Vector3, winner: number, count = 900): void {
  // Warm reds/golds for the red side, cool blues/golds for the blue side, festive
  // rainbow for a draw — always laced with gold and white sparkle.
  const palettes: number[][][] = [
    [[1, 0.42, 0.38], [1, 0.7, 0.3], [1, 0.9, 0.5], [1, 1, 1]],
    [[0.42, 0.66, 1], [0.4, 0.85, 1], [1, 0.9, 0.5], [1, 1, 1]],
    [[1, 0.5, 0.4], [0.5, 0.85, 1], [0.6, 1, 0.6], [1, 0.9, 0.5]],
  ]
  const palette = palettes[winner === 0 ? 0 : winner === 1 ? 1 : 2]
  const n = count
  const pos = new Float32Array(n * 3)
  const col = new Float32Array(n * 3)
  const vel = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    const th = Math.random() * Math.PI * 2
    const ph = Math.acos(2 * Math.random() - 1)
    const sp = (0.25 + Math.random()) * 26
    vel[i * 3] = Math.sin(ph) * Math.cos(th) * sp
    vel[i * 3 + 1] = Math.abs(Math.cos(ph)) * sp * 1.1 + 10 // bias up — a fountain
    vel[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * sp
    pos[i * 3] = at.x
    pos[i * 3 + 1] = at.y
    pos[i * 3 + 2] = at.z
    const c = palette[(Math.random() * palette.length) | 0]
    col[i * 3] = c[0]
    col[i * 3 + 1] = c[1]
    col[i * 3 + 2] = c[2]
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  const mat = new THREE.PointsMaterial({ size: 1.5, vertexColors: true, transparent: true, opacity: 1, depthWrite: false })
  const pts = new THREE.Points(g, mat)
  pts.frustumCulled = false
  scene.add(pts)
  fxs.push({ pts, vel, age: 0, life: 2.8, mat })
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
const PRODUCER_TYPES = [CROP, MINE, DERRICK, PLANT]

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

// Blinking steering arrows that ring the Flying Saucer while you pilot it (top-down), one per
// horizontal direction the arrow keys glide it — the same cue used for resource placement.
let saucerArrows: THREE.Group | null = null
let saucerBlinkT = 0
const SAUCER_ARROW_DIRS = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)]
function ensureSaucerArrows(): THREE.Group {
  if (!saucerArrows) {
    saucerArrows = new THREE.Group()
    const mat = new THREE.MeshBasicMaterial({ color: 0x7ad0ff, transparent: true, opacity: 0.95, depthTest: false })
    const geo = new THREE.ConeGeometry(1.3, 4.2, 4)
    for (const d of SAUCER_ARROW_DIRS) {
      const a = new THREE.Mesh(geo, mat)
      a.quaternion.setFromUnitVectors(PLANT_UP, d) // lay the cone flat, tip pointing outward
      saucerArrows.add(a)
    }
    saucerArrows.renderOrder = 9
    scene.add(saucerArrows)
  }
  return saucerArrows
}

function plantHudMsg(): void {
  const spec = PRODUCER_SPECS[plantType]
  const left = pendingResources[turn].filter(t => t === plantType).length
  hud.setSetupHint(`Placing ${spec.name} (${left} left, +$${spec.baseYield} when rolled) — anywhere, even on water`, '← → ↑ ↓ move  ·  SPACE or ENTER to place  ·  ESC back to aim')
}

// Enter placement mode for one resource type (clicked in the Resources list, during
// your aim step). You place units of that type with SPACE/ENTER; ESC returns to aim.
function beginPlaceResource(type: number): void {
  if (phase !== 'aim' && phase !== 'plant') return
  if (!pendingResources[turn].includes(type)) return
  plantType = type
  phase = 'plant'
  plantCX = turn === 0 ? GX / 4 : (3 * GX) / 4 // start the cursor on the placer's half
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
  hud.setPower(null, shotThisRound[turn] ? lastPlayerPower[turn] : null)
  updateWeaponHud()
  refreshHand()
  refreshResources()
  syncStatus()
  // Trading is a free action offered only on a human's turn in a 3–4 player game.
  const canTrade = isHuman(turn) && numPlayers > 2
  hud.setTrade(canTrade, () => offerTrade(turn))
  // Surrender: a human in The Bitter Truth (3–4P) who hasn't already knelt to someone.
  hud.setSurrender(bitterTruth && isHuman(turn) && numPlayers > 2 && overlord[turn] < 0, () => offerSurrender(turn))
  // Nudge a human who was gifted last round: trading back forms an alliance.
  if (canTrade) {
    const gifter = livingSeats().find(g => g !== turn && giftOwed[g][turn])
    if (gifter !== undefined) hud.msg(`${fortLabel(gifter)} sent you a gift — 🤝 trade back to become allies`)
  }
}

function placeProducer(): void {
  const type = plantType
  const idx = pendingResources[turn].indexOf(type)
  if (idx < 0) return void enterAim()
  const spec = PRODUCER_SPECS[type]
  const cx = Math.round(plantCX)
  const cz = Math.round(plantCZ)
  if (!world.canPlaceProducer(cx, cz, type)) return void hud.msg('overlaps another structure')
  // Already paid for in the market — placement is free.
  pendingResources[turn].splice(idx, 1)
  planted[turn].push({ cx, cz, type, baseYield: spec.baseYield, age: 0 })
  world.buildProducer(cx, cz, turn, type, spec.baseYield, 0)
  sfx.tick()
  refreshResources()
  syncStatus() // update the "resources +$X/turn" readout right away
  hud.msg(`${spec.name} placed — pays out when its resource is rolled`)
  // Keep placing this type if you have more of it; otherwise back to aiming.
  if (pendingResources[turn].includes(type)) plantHudMsg()
  else enterAim()
}

function updatePlant(dt: number): void {
  if (phase !== 'plant') return
  const half = PRODUCER_SPECS[plantType].half
  // Coarse positioning — a fixed speed (Shift = slow) is plenty for a small plot.
  // Screen-relative arrows: mirrored for Player 2 (camera sits on their side).
  const m = seatMirror()
  const speed = (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 10 : 30) * dt
  if (keys.has('ArrowUp')) plantCX += m * speed
  if (keys.has('ArrowDown')) plantCX -= m * speed
  if (keys.has('ArrowRight')) plantCZ += m * speed
  if (keys.has('ArrowLeft')) plantCZ -= m * speed
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

// A computer seat positions its castle for the round. In a 3–4 player game it simply
// keeps its corner (null override); in a 2-player duel it roams its right half for variety.
function aiPlaceCastle(s: number): void {
  if (numPlayers > 2) {
    world.castleOverride[s] = null
    return
  }
  // Keep the AI on its OWN half (seat 0 = left, seat 1 = right) rather than a hardcoded
  // right edge — matters now that the map is square and both seats can be AI.
  const cx = s === 0 ? Math.round(13 + Math.random() * 26) : Math.round(GX - 13 - Math.random() * 26)
  const cz = Math.round(6 + CASTLE_HALF + Math.random() * (GZ - 12 - CASTLE_HALF * 2))
  world.castleOverride[s] = { cx, cz }
}

// After a fort moves, its cannon must sit on the new tower right away (no slow slide).
function snapCannonToSeat(s: number): void {
  const seat = world.cannonSeat(s)
  sides[s].cannon.group.position.set(seat.x, seat.y, seat.z)
  sides[s].targetX = seat.x
  sides[s].targetY = seat.y
  sides[s].targetZ = seat.z
  sides[s].fallV = 0
}

function beginCastlePlacement(): void {
  phase = 'castle'
  // Start the cursor at the acting player's current castle so "keep it" is one keypress.
  const t = world.forts[turn]?.towers[0]
  castleCX = t ? t.cx : turn === 0 ? GX / 4 : (3 * GX) / 4
  castleCZ = t ? t.cz : GZ / 2
  // The real tower is already built here, so mark it as such (no rebuild until you move).
  castleBuiltCX = t ? t.cx : -1
  castleBuiltCZ = t ? t.cz : -1
  castleBuildT = 0
  ensureCastleGhost().visible = false // the real (rebuilt) tower is the preview now
  hud.banner(twoPlayer ? `PLAYER ${turn + 1} — PLACE YOUR CASTLE` : 'PLACE YOUR CASTLE')
  hud.setSetupHint('Position your castle — it rides the terrain; go anywhere, even on water', '← → ↑ ↓ move  ·  SPACE or ENTER to set it here')
}

function placeCastle(): void {
  const cx = Math.round(castleCX)
  const cz = Math.round(castleCZ)
  if (castleGhost) castleGhost.visible = false
  hud.setSetupHint('')
  world.castleOverride[turn] = { cx, cz } // honoured by the next full regen (new round)
  world.moveFort(turn, cx, cz, forti[turn]) // move the fort NOW, carrying its damage
  world.rebuild()
  refreshIntegrity()
  snapCannonToSeat(turn)
  sfx.tick()
  if (ghostReposition) {
    // Ghost Tower: the tower stays visible to its owner but opponents can't see it
    // (AI aims at the decoy; in hotseat it hides on other players' turns) until a
    // shell lands within 10 of the real one. The decoy was recorded in cardGhost.
    ghostReposition = false
    hud.msg('ghost tower set — opponents are blind to it')
  }
  // Income already ran (startTurn opened the market) — go to your turn (aim). Place
  // resources from the left-hand list whenever you like before firing.
  enterAim()
}

function updateCastle(dt: number): void {
  if (phase !== 'castle') return
  // Screen-relative arrows: the placement camera sits on the acting player's side,
  // so Player 2's axes mirror — Up always pushes toward the enemy / top of screen.
  const m = seatMirror()
  const speed = (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 12 : 30) * dt
  if (keys.has('ArrowUp')) castleCX += m * speed
  if (keys.has('ArrowDown')) castleCX -= m * speed
  if (keys.has('ArrowRight')) castleCZ += m * speed
  if (keys.has('ArrowLeft')) castleCZ -= m * speed
  castleCX = Math.max(CASTLE_HALF + 1, Math.min(GX - CASTLE_HALF - 1, castleCX))
  castleCZ = Math.max(CASTLE_HALF + 1, Math.min(GZ - CASTLE_HALF - 1, castleCZ))
  const cx = Math.round(castleCX)
  const cz = Math.round(castleCZ)
  // Move the fort (voxels only — no world regen, damage preserved) so the real tower
  // follows the cursor, riding up and down the existing terrain. Throttled per cell.
  castleBuildT += dt
  if ((cx !== castleBuiltCX || cz !== castleBuiltCZ) && castleBuildT > 0.09) {
    castleBuildT = 0
    castleBuiltCX = cx
    castleBuiltCZ = cz
    world.moveFort(turn, cx, cz, forti[turn])
    world.rebuild()
    snapCannonToSeat(turn)
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

  if (phase === 'castle' || phase === 'plant') {
    // High wide bird's-eye over the WHOLE battlefield, seen from the ACTING player's
    // side — Player 2 places from the opposite end, own territory nearest the camera,
    // enemy at the top of the screen. Screen-up is "toward the enemy" for both, and
    // the arrow keys in updateCastle/updatePlant mirror to stay screen-relative.
    const m = seatMirror()
    desiredPos.set(GX / 2 - m * 96, 150, GZ / 2)
    desiredLook.set(GX / 2, 2, GZ / 2)
    k = 3
  } else if (phase === 'aim' || phase === 'charge') {
    if (worldView) {
      // Pulled-back vantage from the acting player's own side of the field.
      const m = seatMirror()
      desiredPos.set(GX / 2 - m * 115, 85, GZ / 2 + m * 70)
      desiredLook.set(GX / 2 + m * 8, 6, GZ / 2)
      k = 2.5
    } else {
      aimCamera(turn, desiredPos, desiredLook)
    }
  } else if (phase === 'fallout') {
    // Everyone watches the sky: the whole board from the SHOOTER's side (turn hasn't advanced
    // while the fallout holds the game), so the player who lit the fuse sees where it drifts.
    const m = seatMirror()
    desiredPos.set(GX / 2 - m * 96, 150, GZ / 2)
    desiredLook.set(GX / 2, 2, GZ / 2)
    k = 2.2
  } else if (phase === 'aiThink' || phase === 'aiAim') {
    aimCamera(turn, desiredPos, desiredLook) // frame the acting AI seat's cannon
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
  // The saucer's top-down view looks straight down; point "up" toward the pilot's
  // enemy (+X for P1, -X for P2) so the map reads consistently. Else world-up.
  const upX = turn === 0 ? 1 : -1
  camera.up.set(topDownView ? upX : 0, topDownView ? 0 : 1, 0)
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
  const s = sides[turn]
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
  const power = phase === 'charge' ? chargePower : lastPlayerPower[turn]
  const vel = dirOf(turn).multiplyScalar(speedOf(Math.max(8, power)))
  const path: { x: number; y: number; z: number }[] = []
  world.simShot(muzzleOf(turn), vel, { x: 0, z: 0 }, path) // hint ignores wind — reading the wind is the game
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

// The in-game list shows only weapons the acting player owns (full roster in the shop).
function hudSide(): number {
  return isHuman(turn) ? turn : 0
}

function visibleWeapons(): number[] {
  const s = sides[hudSide()]
  return WEAPONS.map((_, i) => i).filter(i => i === s.wsel || (s.arsenal.get(WEAPONS[i].id) ?? 0) > 0)
}

function updateWeaponHud(): void {
  const s = sides[hudSide()]
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
  const s = sides[turn]
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
  if (idx < 0 || idx >= WEAPONS.length) return
  if (phase !== 'aim' && phase !== 'charge') return
  if ((sides[turn].arsenal.get(WEAPONS[idx].id) ?? 0) > 0) {
    sides[turn].wsel = idx
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
  if (isHuman(side)) {
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
    if (isHuman(side)) hud.msg('arrow keys fly the saucer · SPACE to detonate')
  } else {
    spawnProj(muzzle, dirOf(side).multiplyScalar(speedOf(power)), weapon, false, side)
    if (isHuman(side) && weapon.kind === 'frisbee') hud.msg('← → curve the frisbee · ↑ ↓ flatten / dive the arc')
  }
  if (isHuman(side)) shotThisRound[side] = true
  flyHold = null
  worldView = false
  hud.setWorldView(false)
  hud.showCards(false)
  phase = 'fly'
  hud.setPower(null, shotThisRound[side] ? lastPlayerPower[side] : null)
}

// Hand off to the other side — unless Skip Player flagged them, in which case their
// turn is skipped entirely and the current side goes again.
function advanceTurn(): void {
  expireTurnEffects(turn) // the finishing seat's one-turn effects lapse here
  // Rotate to the next LIVING seat, bypassing any eliminated or Skip-flagged seat. In a
  // 2-player game bypassing the (only) foe lands back on the caster — the classic Skip
  // "go again". In 3–4 players it simply denies the skipped seat its turn.
  let next = turn
  for (let k = 0; k < numPlayers; k++) {
    next = (next + 1) % numPlayers
    if (!alive[next]) continue
    if (skipNext[next] || skipTurns[next] > 0) {
      if (skipNext[next]) skipNext[next] = false
      else skipTurns[next]--
      if (isHuman(next)) hud.showSkipped(twoPlayer || numPlayers > 2 ? `Player ${next + 1}, you've been SKIPPED!` : "You've been SKIPPED!")
      else hud.msg(`${capName(next)} is skipped!`)
      continue
    }
    startTurn(next)
    return
  }
  startTurn(turn) // fallback (shouldn't happen while >1 seat is alive)
}

// ---- Resource wheels — the income engine ----------------------------------------------
// Two discs spun at the start of EVERY turn. Wheel A carries the four producers + Blockade;
// Wheel B carries the four producers + two Tribute tiers. Whatever a wheel lands on, EVERY
// owner of that resource is paid its income (doubled when both wheels match). Income comes from
// nowhere else. Blockade lets the spinner deny one rival a round of income; Foreign Aid (rare)
// makes every other country send a chosen one a random card out of their hand.
type WheelSlice = number | 'blockade' | 'aid'
const WHEEL_A: { s: WheelSlice; w: number }[] = [
  { s: CROP, w: 22 }, { s: MINE, w: 22 }, { s: DERRICK, w: 22 }, { s: PLANT, w: 20 }, { s: 'blockade', w: 12 },
]
const WHEEL_B: { s: WheelSlice; w: number }[] = [
  { s: CROP, w: 24 }, { s: MINE, w: 24 }, { s: DERRICK, w: 24 }, { s: PLANT, w: 22 }, { s: 'aid', w: 5 },
]
function pickSlice(wheel: { s: WheelSlice; w: number }[]): WheelSlice {
  const total = wheel.reduce((a, e) => a + e.w, 0)
  let r = Math.random() * total
  for (const e of wheel) { r -= e.w; if (r <= 0) return e.s }
  return wheel[0].s
}
function sliceIcon(s: WheelSlice): string {
  return s === 'blockade' ? '🚫' : s === 'aid' ? '🎁' : s === CROP ? '🌾' : s === MINE ? '⛏️' : s === DERRICK ? '🛢️' : '☢️'
}
// A seat's live income from producers of one type (yield × integrity × maturity).
function incomeFromType(s: number, type: number): number {
  let sum = 0
  for (const p of planted[s]) if (p.type === type) sum += p.baseYield * world.integrityAt(p.cx, p.cz) * maturity(p.type, p.age)
  return Math.round(sum)
}

// The two discs' visual rim order (each face shown once), used to land the pointer on the result.
const WHEEL_A_FACES: WheelSlice[] = [CROP, MINE, DERRICK, PLANT, 'blockade']
const WHEEL_B_FACES: WheelSlice[] = [CROP, MINE, DERRICK, PLANT, 'aid']

type WheelState = {
  roller: number; a: WheelSlice; b: WheelSlice; done: () => void
  rotA: number; rotB: number; spA: number; spB: number // live rotation (deg) + spin speed (deg/s)
  mode: 'spin' | 'decel' | 'hold'; t: number
  startA: number; startB: number; targetA: number; targetB: number; decelDur: number
}
let wheelSpin: WheelState | null = null
let wheelForce: { a: WheelSlice; b: WheelSlice } | null = null // test hook: preset the next spin
const wheelSkipFirst = [true, true, true, true] // each seat's first spin of the match is skipped (build first)

function spinWheels(roller: number, done: () => void): void {
  // Skip a seat's VERY FIRST turn of the match — you plant/build once before income starts.
  // From the second turn on, the wheels spin every turn.
  if (wheelSkipFirst[roller] && !wheelForce) { wheelSkipFirst[roller] = false; return void done() }
  phase = 'shop' // inert while the wheels are up
  const a = wheelForce ? wheelForce.a : pickSlice(WHEEL_A)
  const b = wheelForce ? wheelForce.b : pickSlice(WHEEL_B)
  wheelForce = null
  wheelSpin = {
    roller, a, b, done,
    rotA: 0, rotB: 0, spA: 900 + Math.random() * 220, spB: 820 + Math.random() * 220,
    mode: 'spin', t: 0, startA: 0, startB: 0, targetA: 0, targetB: 0, decelDur: 1.7,
  }
  // The wheels slow down on their own — nobody has to click to stop them.
  hud.showWheels(WHEEL_A_FACES.map(sliceIcon), WHEEL_B_FACES.map(sliceIcon), `${fortLabel(roller)} spins the resource wheels`, null)
  hud.setWheelRotation(0, 0)
  hud.setWheelText(`${fortLabel(roller)} spins the wheels…`, '')
}

function beginWheelDecel(w: WheelState): void {
  w.mode = 'decel'
  w.t = 0
  w.startA = w.rotA
  w.startB = w.rotB
  const land = (faces: WheelSlice[], win: WheelSlice, cur: number) => {
    const step = 360 / faces.length
    const at = (360 - faces.indexOf(win) * step) % 360 // disc rotation that puts the winning face at the top pointer
    let t = cur - (cur % 360) + at
    while (t < cur + 900) t += 360 // at least ~2.5 more turns before it lands
    return t
  }
  w.targetA = land(WHEEL_A_FACES, w.a, w.rotA)
  w.targetB = land(WHEEL_B_FACES, w.b, w.rotB)
}

function updateWheels(dt: number): void {
  const w = wheelSpin
  if (!w) return
  w.t += dt
  if (w.mode === 'spin') {
    w.rotA += w.spA * dt
    w.rotB += w.spB * dt
    hud.setWheelRotation(w.rotA, w.rotB)
    if (w.t > 0.9) beginWheelDecel(w) // every spin slows itself after a beat — no click needed
  } else if (w.mode === 'decel') {
    const u = Math.min(1, w.t / w.decelDur)
    const e = 1 - Math.pow(1 - u, 3) // ease-out: fast → gliding to a stop
    w.rotA = w.startA + (w.targetA - w.startA) * e
    w.rotB = w.startB + (w.targetB - w.startB) * e
    hud.setWheelRotation(w.rotA, w.rotB)
    if (u >= 1) {
      const rows = payWheels(w.roller, w.a, w.b) // settled → pay every owner, get the breakdown
      sfx.tick()
      const { roller, a, b, done } = w
      wheelSpin = null
      hud.hideWheels()
      // Show who-earned-what, then continue the turn (Blockade / Tribute may still prompt).
      showRollPayout(roller, a, b, rows, () => runWheelSpecials(roller, a, b, done))
    }
  }
}

// Post-roll summary: for the resource(s) that came up, list each country, what it owns of
// them, and the cash it earned — so the payout is never invisible. Stays until dismissed
// (a human clicks; an AI's roll auto-advances after a beat so the game doesn't stall).
function showRollPayout(roller: number, a: WheelSlice, b: WheelSlice, rows: RollPayout[], done: () => void): void {
  const special = a === 'blockade' ? '🚫 Blockade — the spinner cuts a rival off next.' : b === 'aid' ? '🎁 Foreign Aid — a country is about to be sent everyone else’s cards.' : ''
  const hudRows = rows.map(r => {
    const items = [...r.items.entries()].map(([type, n]) => `${sliceIcon(type)}×${n}`).join('  ')
    const note = r.blocked ? '🚫 blockaded — earned nothing' : r.diverted > 0 ? `⚔️ raided — $${r.diverted.toLocaleString()} taken` : ''
    return { color: seatColorHex(r.seat), label: fortLabel(r.seat), items, amount: r.amount, note }
  })
  hud.showRollPayout({
    caption: wheelCaption(a, b),
    rows: hudRows,
    special,
    empty: rows.length === 0,
    dismissHint: isHuman(roller) ? 'CLICK to continue' : '',
  }, done)
}

function wheelCaption(a: WheelSlice, b: WheelSlice): string {
  if (typeof a === 'number' && a === b) return `DOUBLE ${PRODUCER_SPECS[a].name.toUpperCase()}!`
  const label = (s: WheelSlice) => (typeof s === 'number' ? PRODUCER_SPECS[s].name : s === 'blockade' ? 'Blockade' : 'Foreign Aid')
  return `${label(a)}  +  ${label(b)}`
}

// A per-country line of the post-roll payout summary: what they own of the rolled
// resource(s), how much cash it paid them, and whether it was blocked/raided.
type RollPayout = { seat: number; amount: number; items: Map<number, number>; diverted: number; blocked: boolean }

// Pay every owner of the shown resource(s); a matching pair pays double. Returns a breakdown
// (one row per affected country) so the HUD can show exactly who earned what this roll.
function payWheels(roller: number, a: WheelSlice, b: WheelSlice): RollPayout[] {
  const aRes = typeof a === 'number' ? a : -1
  const bRes = typeof b === 'number' ? b : -1
  const acc = new Map<number, RollPayout>()
  const row = (s: number) => { let r = acc.get(s); if (!r) { r = { seat: s, amount: 0, items: new Map(), diverted: 0, blocked: false }; acc.set(s, r) } return r }
  const pay = (type: number, mult: number) => {
    for (let s = 0; s < numPlayers; s++) {
      if (!alive[s]) continue
      const own = planted[s].filter(p => p.type === type).length
      if (own > 0) { const r = row(s); r.items.set(type, (r.items.get(type) ?? 0) + own) } // records ownership even if $0
      if (resourceBlocked[s]) { if (own > 0) row(s).blocked = true; continue }
      let inc = incomeFromType(s, type) * mult
      if (s === roller) inc = Math.round(inc * incomeBoost[s]) // Bumper Crop doubles the spinner's take
      if (inc <= 0) continue
      const raid = armyRaidOf[s]
      if (raid && !raid.done) { raid.done = true; money[raid.caster] += inc; row(s).diverted += inc; row(raid.caster).amount += inc } // Army diverts the payout
      else { money[s] += inc; row(s).amount += inc }
    }
  }
  if (aRes >= 0 && aRes === bRes) pay(aRes, 2)
  else { if (aRes >= 0) pay(aRes, 1); if (bRes >= 0) pay(bRes, 1) }
  incomeBoost[roller] = 1
  syncStatus()
  if (isHuman(turn)) updateWeaponHud()
  return [...acc.values()].sort((x, y) => y.amount - x.amount)
}

// Blockade / Tribute resolve in sequence (each may prompt the human roller), then `done`.
function runWheelSpecials(roller: number, a: WheelSlice, b: WheelSlice, done: () => void): void {
  const steps: ((next: () => void) => void)[] = []
  if (a === 'blockade') steps.push(next => blockadeStep(roller, next))
  if (b === 'aid') steps.push(next => foreignAidStep(roller, next))
  const run = (i: number) => (i >= steps.length ? done() : steps[i](() => run(i + 1)))
  run(0)
}

function blockadeStep(roller: number, next: () => void): void {
  const foes = livingSeats().filter(s => s !== roller)
  if (!foes.length) return void next()
  const apply = (t: number) => {
    blockSeat(t)
    refreshForts()
    hud.banner('🚫 BLOCKADE', `${fortLabel(roller)} cuts off ${fortLabel(t)} — no resource income on their next turn!`, 3000)
    next()
  }
  if (isHuman(roller)) hud.showTargetPicker('🚫 Blockade — starve whom of income for a turn?', foes.map(s => ({ seat: s, label: fortLabel(s) })), apply)
  else apply(aiPickBlockade(roller))
}

// 🎁 Foreign Aid: every OTHER living country sends the chosen one a random card out of its hand
// (nothing to send if their hand is empty). In a 1v1 there's no choice to make — the spinner is
// the only possible donor, so it ships a card across to its rival.
function foreignAidStep(roller: number, next: () => void): void {
  const others = livingSeats().filter(s => s !== roller) // who could receive the aid
  if (!others.length) return void next()
  const apply = (t: number) => {
    const givers = livingSeats().filter(s => s !== t && hand[s].length)
    for (const g of givers) {
      const card = hand[g][Math.floor(Math.random() * hand[g].length)] // a RANDOM card, donor's choice denied
      moveItem(g, t, 'card', card) // pure move + voxel flight; forced aid builds no trust
    }
    refreshForts()
    syncStatus()
    hud.banner('🎁 FOREIGN AID', givers.length
      ? `${givers.map(g => fortLabel(g)).join(', ')} → ${fortLabel(t)}: ${givers.length} random card${givers.length > 1 ? 's' : ''} sent!`
      : `nobody had a card to send ${fortLabel(t)}`, 3400)
    next()
  }
  if (numPlayers <= 2) return void apply(others[0]) // 1v1: the spinner is the donor, its rival receives
  if (isHuman(roller)) hud.showTargetPicker('🎁 Foreign Aid — which country receives aid? Every other player (you too) sends them a random card from their hand.', others.map(s => ({ seat: s, label: fortLabel(s) })), apply)
  else apply(aiPickAid(roller))
}

// AI blockades the richest/strongest non-teammate; sends Foreign Aid to a teammate (arm an ally)
// if it has one, else it's forced to aid the weakest rival (least harmful).
function aiPickBlockade(roller: number): number {
  const foes = livingSeats().filter(s => !sameTeam(s, roller))
  if (!foes.length) return livingSeats().filter(s => s !== roller)[0]
  foes.sort((a, b) => money[b] + world.integrity(b) * 5000 - (money[a] + world.integrity(a) * 5000))
  return foes[0]
}
function aiPickAid(roller: number): number {
  const mates = livingSeats().filter(s => s !== roller && sameTeam(s, roller))
  if (mates.length) return mates[0] // arm an ally
  const foes = livingSeats().filter(s => s !== roller)
  foes.sort((a, b) => money[a] + world.integrity(a) * 5000 - (money[b] + world.integrity(b) * 5000))
  return foes[0] // forced to arm a rival — pick the weakest, least dangerous one
}

function startTurn(s: number): void {
  turnSerial++ // stamps effect lifetimes — see expireTurnEffects
  // Hotseat: gate every human turn behind a "pass the keyboard" screen so the other
  // player's leftover keypresses can't act, and it's unmistakable whose turn it is.
  if (twoPlayer && isHuman(s)) {
    hud.showHandoff(s + 1, () => reallyStartTurn(s))
  } else {
    reallyStartTurn(s)
  }
}

function reallyStartTurn(s: number): void {
  turn = s
  refreshForts() // update which fort bar is highlighted for the acting seat
  rerollWind()
  flyHold = null
  // Diplomacy bookkeeping. Betrayal (giver's view): a gift `s` gave that the receiver has
  // since had a full turn to answer and didn't is a snub — `s` trusts them much less.
  for (let b = 0; b < numPlayers; b++) {
    if (giftOwed[s][b] && owedActedSince[s][b]) {
      trust[s][b] -= 3
      giftOwed[s][b] = false
      owedActedSince[s][b] = false
    }
  }
  // Receiver's view: `s` is taking a turn while still owing someone a trade-back — mark it,
  // so if `s` doesn't reciprocate this turn the giver counts it as a betrayal next time.
  for (let g = 0; g < numPlayers; g++) if (giftOwed[g][s]) owedActedSince[g][s] = true
  // Ghost Tower in hotseat: each ghosted tower is visible only on its owner's turn —
  // everyone shares one screen, so hide it while any other seat acts.
  if (twoPlayer) {
    let changed = false
    for (let g = 0; g < numPlayers; g++) {
      if (!ghostDecoyOf[g]) continue
      world.hiddenForts[g] = s !== g
      sides[g].cannon.group.visible = s === g
      changed = true
    }
    if (changed) world.rebuild()
  }
  // The pink lifts once each raided player's own turn is over.
  for (let v = 0; v < numPlayers; v++) {
    const r = armyRaidOf[v]
    if (r && r.done && s !== v) armyRaidOf[v] = null
  }
  if (!livingSeats().some(v => armyRaidOf[v])) world.clearRaided()
  for (const p of planted[s]) p.age++ // age this side's producers a turn (crops mature)
  beginTurnActions(s)
}

// Open the market (human) or run the computer's shopping (AI). The resource wheels spin AFTER
// this "store" step — for a human, once they leave the market (onMarketDone); for the AI, right
// after it has bought its cards/producers — then income lands and the shot phase begins.
function beginTurnActions(s: number): void {
  if (!isHuman(s)) money[s] += 400 // modest per-turn subsidy so each AI seat can keep up
  if (isHuman(s)) {
    const st = sides[s]
    if ((st.arsenal.get(WEAPONS[st.wsel].id) ?? 0) <= 0) st.wsel = 0 // out of the fancy stuff
    updateWeaponHud()
    syncStatus()
    refreshHand()
    refreshResources()
    openMarket(roundStartPending[s])
    roundStartPending[s] = false
  } else {
    aiMaybeSurrender(s) // a broken seat may kneel to a stronger power (Bitter Truth)
    if (phase === 'end') return // that surrender just decided the round
    if (numPlayers > 2) aiDiplomacy(s) // repay gifts / keep allies / open overtures, before cards
    aiCards(s) // buy/play a stratagem first (so producers don't eat the card budget)
    aiPlant(s) // then grow the economy with what's left
    if (phase === 'fly') return // a played Toaster took over the turn — no wheel this turn
    spinWheels(s, () => startAiThink(s)) // wheels spin after the AI's shopping, then it aims
  }
}

function startAiThink(s: number): void {
  if (phase === 'fly') return
  phase = 'aiThink'
  aiT = 0
  aiPlanned = null
  hud.banner(twoPlayer || numPlayers > 2 ? `PLAYER ${s + 1} (COMPUTER)` : 'ENEMY TURN')
}

// The enemy buys a card now and then, and plays its best applicable one by simple
// heuristics — toaster to attack, ghost when hurt, seize/steal/army vs your economy.
// The living opponent an AI seat focuses on: the weakest tower (closest to elimination),
// ties broken by nearest to this seat's cannon. Used for both its shot and hostile cards.
function aiTarget(s: number): number {
  const living = livingSeats()
  // Teammates (surrendered vassals / masters) are never targets.
  const foes = living.filter(o => o !== s && !sameTeam(o, s))
  if (!foes.length) return -1
  // Trade-allies are spared too — unless every remaining foe is an ally, or only two seats are
  // left (last castle standing forces the final betrayal). Attacking then breaks the pact.
  const nonAllies = foes.filter(o => !alliedWith(s, o))
  const pool = nonAllies.length && living.length > 2 ? nonAllies : foes
  const me = sides[s].cannon.group.position
  let best = -1
  let bestScore = Infinity
  for (const o of pool) {
    const t = world.forts[o].towers[0]
    // Weakest + nearest, biased toward the least-trusted (betrayers get shelled first).
    const score = world.integrity(o) * 1000 + Math.hypot(t.cx - me.x, t.cz - me.z) + trust[s][o] * 200
    if (score < bestScore) {
      bestScore = score
      best = o
    }
  }
  return best
}

// Bitter Truth: a badly-battered computer seat bends the knee to the strongest rival left,
// joining their team to survive rather than be finished off. Called at its turn start.
function aiMaybeSurrender(s: number): void {
  if (!bitterTruth || numPlayers <= 2 || overlord[s] >= 0) return
  if (world.integrity(s) > 0.42) return // only when its fort is more than half gone
  const foes = livingSeats().filter(o => !sameTeam(o, s))
  if (!foes.length) return
  let best = -1
  let bestScore = -Infinity
  for (const o of foes) {
    // Kneel to the mightiest: most-intact fort, richest treasury, biggest team.
    const sc = world.integrity(o) * 2 + money[o] / 20000 + teamSize(o)
    if (sc > bestScore) { bestScore = sc; best = o }
  }
  if (best >= 0 && Math.random() < 0.6) surrender(s, best)
}

// Diplomacy at an AI seat's turn start: repay outstanding gifts (which seals alliances),
// keep trading with existing allies, and sometimes open a fresh overture. A hard grudge
// (trust ≤ -2) is never repaid or courted.
function aiDiplomacy(s: number): void {
  const spare = (): { kind: TradeKind; key: string } | null => {
    const items = tradableItems(s)
    return items.length ? { kind: items[0].kind, key: items[0].key } : null
  }
  // 1) Repay outstanding gifts → reciprocation seals an alliance.
  for (const g of livingSeats()) {
    if (g === s) continue
    if (giftOwed[g][s] && trust[s][g] > -2) {
      const item = spare()
      if (item) transferItem(s, g, item.kind, item.key)
    }
  }
  // 2) Allies occasionally send another gift to keep the friendship warm.
  for (const o of livingSeats()) {
    if (o === s || !alliedWith(s, o)) continue
    if (Math.random() < 0.3) {
      const item = spare()
      if (item) transferItem(s, o, item.kind, item.key)
    }
  }
  // 3) Sometimes make an opening overture — but only with a genuine surplus card (2+ in
  // hand), to a promising, un-betrayed non-ally it doesn't already owe. The recipient can
  // answer to forge an alliance; ignoring the gift is the betrayal path.
  if (Math.random() < 0.2 && hand[s].length >= 2) {
    const cand = livingSeats().filter(o => o !== s && !alliedWith(s, o) && trust[s][o] > -2 && !giftOwed[s][o])
    if (cand.length) {
      const to = cand[Math.floor(Math.random() * cand.length)]
      transferItem(s, to, 'card', hand[s][hand[s].length - 1])
    }
  }
}

function aiCards(s: number): void {
  // Buy a card or two when it can spare the cash (keeping a $300 reserve).
  while (money[s] >= CARD_COST + 300 && Math.random() < 0.5) {
    money[s] -= CARD_COST
    hand[s].push(drawCard())
  }
  if (!hand[s].length || Math.random() > 0.7) return
  const id = pickAiCard(s)
  if (!id) return
  hand[s].splice(hand[s].indexOf(id), 1)
  applyCard(s, id, aiTarget(s)) // hostile cards hit the AI's focus target
}

function pickAiCard(s: number): CardId | null {
  const h = hand[s]
  const foes = livingSeats().filter(o => o !== s)
  const foeHasProd = foes.some(o => planted[o].length > 0)
  const myHurt = world.integrity(s) < 0.7
  if (h.includes('money5')) return 'money5' // free cash — always cash it in
  if (h.includes('money2')) return 'money2'
  if (h.includes('money1')) return 'money1'
  if (h.includes('toaster')) return 'toaster'
  if (foeHasProd && h.includes('stealres')) return 'stealres' // rob everyone at once
  if (foeHasProd && h.includes('steal')) return 'steal'
  if (foeHasProd && h.includes('army')) return 'army'
  if (myHurt && h.includes('ghost')) return 'ghost'
  if (myHurt && h.includes('forcefield') && !forceField[s]) return 'forcefield'
  return null
}

// Push the acting player's hand to the HUD list (above the weapons).
function refreshHand(): void {
  const s = isHuman(turn) ? turn : 0
  hud.setHand(
    hand[s].map(id => ({ id, name: cardDef(id).name, blurb: cardDef(id).blurb, emoji: cardDef(id).emoji })),
    { onPlay: (i: number) => playCard(s, i) }
  )
}

// Push the player's UNPLACED resources (bought in the market, awaiting placement) to
// the HUD list. Clicking a type places one; the list empties as you place them.
function refreshResources(): void {
  const s = isHuman(turn) ? turn : 0
  const counts = new Map<number, number>()
  for (const t of pendingResources[s]) counts.set(t, (counts.get(t) ?? 0) + 1)
  hud.setResources(
    PRODUCER_TYPES.filter(t => (counts.get(t) ?? 0) > 0).map(t => ({ type: t, name: PRODUCER_SPECS[t].name, count: counts.get(t)! })),
    { onSelect: (type: number) => beginPlaceResource(type) }
  )
}

// The enemy grows its economy at a measured pace: one producer per turn, a soft cap so
// it doesn't snowball out of the player's reach, and a reserve so it can still afford
// a stratagem. It auto-positions nearest its fort (players place by hand).
function aiPlant(s: number): void {
  const fort = world.forts[s]?.towers[0]
  if (!fort) return
  if (planted[s].length >= 8) return // soft cap — keeps the AI economy in range
  // A cash-flush AI splurges on ONE Nuclear Power Plant (if a water-side spot exists near its
  // fort); otherwise it buys the best affordable producer, keeping ~a card's worth in reserve.
  const hasPlant = planted[s].some(p => p.type === PLANT)
  let type = money[s] >= PLANT_SPEC.cost + 4000 && !hasPlant ? PLANT
    : money[s] >= DERRICK_SPEC.cost + 1600 ? DERRICK
    : money[s] >= MINE_SPEC.cost + 1600 ? MINE
    : money[s] >= CROP_SPEC.cost + 900 ? CROP
    : -1
  if (type < 0) return
  let spot = world.findProducerSpot(s, fort.cx, fort.cz, type)
  if (!spot && type === PLANT) { type = DERRICK; spot = world.findProducerSpot(s, fort.cx, fort.cz, type) } // no water — fall back
  if (!spot) return
  const spec = PRODUCER_SPECS[type]
  money[s] -= spec.cost
  planted[s].push({ cx: spot.cx, cz: spot.cz, type, baseYield: spec.baseYield, age: 0 })
  world.buildProducer(spot.cx, spot.cz, s, type, spec.baseYield, 0)
}
const CROP_SPEC = PRODUCER_SPECS[CROP]
const MINE_SPEC = PRODUCER_SPECS[MINE]
const DERRICK_SPEC = PRODUCER_SPECS[DERRICK]
const PLANT_SPEC = PRODUCER_SPECS[PLANT]

function aiPickWeapon(seat: number): WeaponDef {
  const s = sides[seat]
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
  const me = turn // the acting AI seat
  if (phase === 'aiThink') {
    aiT += dt
    if (aiT < 0.75) return
    // Focus on a living opponent (weakest/nearest). If that tower is ghosted, the AI
    // can't see it and fires at the decoy (old) spot — a near miss there reveals it.
    const tgt = aiTarget(me)
    if (tgt < 0) {
      advanceTurn()
      return
    } // no target left
    const seat = world.cannonSeat(tgt)
    const mainTower = world.forts[tgt].towers[0]
    const decoy = ghostDecoyOf[tgt]
    const aimX = decoy ? decoy.cx : seat.x
    const aimZ = decoy ? decoy.cz : seat.z
    const target = { x: aimX, y: Math.max(mainTower.rubbleY + 2, seat.y - 4), z: aimZ }
    // Approximate the muzzle for planning: turret centre nudged toward the target.
    const pm = sides[me].cannon.group.position
    const toward = new THREE.Vector3(target.x - pm.x, 0, target.z - pm.z).normalize()
    const origin = { x: pm.x + toward.x * 2.3, y: pm.y + 1.65 + 2.6, z: pm.z + toward.z * 2.3 }
    // If terrain hides the target, the AI is reduced to guessing — extra scatter.
    const blind = losBlocked(origin, target)
    aiPlanned = planShot(world, origin, target, wind, aiErr + (blind ? 16 : 0), Math.random)
    aiStart = { az: sides[me].az, el: sides[me].el }
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
    sides[me].az = aiStart.az + (aiPlanned.az - aiStart.az) * e
    sides[me].el = aiStart.el + (aiPlanned.el - aiStart.el) * e
    applyCannonPose(me)
    if (t >= 1 && aiAnimT > 1.25) {
      const weapon = aiPickWeapon(me)
      const power = aiPlanned.power
      sides[me].az = aiPlanned.az
      sides[me].el = aiPlanned.el
      aiPlanned = null
      aiErr = Math.max(4, aiErr * 0.82) // ranges in slowly, never gets pinpoint
      fireShot(me, weapon, power)
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
// glide it across the map (up = toward the pilot's enemy), altitude holds steady.
function steerSaucer(p: Proj, h: number): void {
  const SPEED = 17
  const m = p.side === 0 ? 1 : -1 // the top-down camera flips for Player 2
  let tx = 0
  let tz = 0
  if (keys.has('ArrowUp')) tx += m // screen-up = toward the pilot's enemy
  if (keys.has('ArrowDown')) tx -= m
  if (keys.has('ArrowRight')) tz += m
  if (keys.has('ArrowLeft')) tz -= m
  const len = Math.hypot(tx, tz)
  if (len > 0) {
    tx /= len
    tz /= len
  }
  const ease = Math.min(1, 5 * h)
  p.vel.x += (tx * SPEED - p.vel.x) * ease
  p.vel.z += (tz * SPEED - p.vel.z) * ease
  p.vel.y += (0 - p.vel.y) * ease // hold altitude
  // Blinking arrows around the drone cueing the four steer directions.
  const arrows = ensureSaucerArrows()
  arrows.visible = true
  saucerBlinkT += h
  const blinkOn = saucerBlinkT % 0.5 < 0.32
  for (let k = 0; k < arrows.children.length; k++) {
    const d = SAUCER_ARROW_DIRS[k]
    arrows.children[k].position.set(p.pos.x + d.x * 7, p.pos.y, p.pos.z + d.z * 7)
    arrows.children[k].visible = blinkOn
  }
}

function stepProjectiles(h: number): void {
  if (saucerArrows) saucerArrows.visible = false // re-shown each step only while a saucer is piloted
  for (let i = projs.length - 1; i >= 0; i--) {
    const p = projs[i]
    const piloted = i === 0 && isHuman(p.side) && p.side === turn
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

// Newly-collapsed seats are out for the round (their producers linger as neutral rubble).
// If ≤1 seat is still standing the round is OVER — the survivor scores + the 'end'
// celebration fires — and this returns true; otherwise the round continues (the dead
// fort just crumbles) and it returns false so the caller keeps the rotation going.
function concludeRound(dead: number[]): boolean {
  for (const l of dead) {
    if (!alive[l]) continue
    alive[l] = false
    world.collapseFort(l, Math.random)
  }
  sfx.rumble()
  const survivors = livingSeats()
  // The round ends only when a single FACTION is left standing — a lone survivor, or one
  // surrendered team (Bitter Truth). More than one team still in the fight → play on.
  const teamsLeft = new Set(survivors.map(teamRoot))
  if (teamsLeft.size > 1) {
    // Round goes on: pop the crumbled fort(s) now (no deferred 'end' blast) and continue.
    for (const l of dead) {
      const lt = world.forts[l].towers[0]
      const base = new THREE.Vector3(lt.cx, world.surfaceY(lt.cx, lt.cz) + 3, lt.cz)
      world.burstRubble(lt.cx, lt.cz, 8, Math.random)
      spawnExplosion(base, 10, true)
      addShake(11, base)
    }
    world.rebuild()
    refreshIntegrity()
    hud.banner(`${capName(dead[0])} IS OUT!`, `${teamsLeft.size} factions still standing`, 2600)
    return false
  }
  // Round over — the surviving faction wins (its whole team scores), or nobody on a mutual kill.
  const winner = survivors.length ? teamRoot(survivors[0]) : -1
  for (const w of survivors) score[w]++
  // Plunder (2-player only): the winner takes half the loser's cash + one random card.
  let plunder = 0
  let stole = ''
  if (numPlayers === 2 && winner >= 0) {
    const loser = 1 - winner
    plunder = Math.floor(money[loser] / 2)
    money[winner] += plunder
    money[loser] -= plunder
    stole = stealRandomCard(winner, loser)
  }
  const cardNote = stole ? ` and their ${stole} card` : ''
  lastRoundResult =
    winner < 0
      ? `Round ${round} drawn — mutual destruction.`
      : numPlayers > 2
        ? survivors.length > 1
          ? `Round ${round}: ${capName(winner)} and their vassals stand victorious!`
          : `Round ${round}: ${capName(winner)} is the last castle standing!`
        : twoPlayer
          ? `Round ${round}: Player ${winner + 1} wins! Plundered half of Player ${(1 - winner) + 1}'s treasury ($${plunder.toLocaleString()})${cardNote}.`
          : winner === 0
            ? `Round ${round} won! Plundered half their treasury ($${plunder.toLocaleString()})${cardNote}.`
            : `Round ${round} lost — the enemy took half your treasury ($${plunder.toLocaleString()})${cardNote}.`
  // Deferred celebratory blast: the crumbled fort(s) burst once they've settled ('end').
  pendingBlasts = []
  for (const l of dead) {
    const lt = world.forts[l].towers[0]
    pendingBlasts.push({ cx: lt.cx, cz: lt.cz, y: lt.baseY })
  }
  blastFired = false
  const focus = dead.length ? world.forts[dead[0]].towers[0] : world.forts[winner].towers[0]
  const center = dead.length > 1 ? new THREE.Vector3(GX / 2, 14, GZ / 2) : new THREE.Vector3(focus.cx, focus.baseY + 6, focus.cz)
  const line1 = `ROUND ${round} OVER`
  const line2 =
    winner < 0
      ? 'MUTUAL DESTRUCTION!'
      : twoPlayer || numPlayers > 2
        ? `PLAYER ${winner + 1} WINS!`
        : winner === 0
          ? 'YOU WON!'
          : 'YOU LOST!'
  endInfo = { line1, line2, winner, center }
  phase = 'end'
  endT = 0
  endShown = false
  refreshIntegrity()
  syncStatus()
  return true
}

// ---- Nuclear meltdown & fallout (Nuclear Power Plant) -----------------------------------
const MELT_R = 16 // radius of the initial radioactive blast around a destroyed reactor

// A reactor is a hair-trigger: ANY damage to it (even a graze, and even self-inflicted) sets
// off the full meltdown. It stops producing the instant a single voxel is gone.
function checkMeltdowns(): void {
  for (let s = 0; s < numPlayers; s++) {
    for (let i = planted[s].length - 1; i >= 0; i--) {
      const p = planted[s][i]
      if (p.type !== PLANT || world.integrityAt(p.cx, p.cz) >= 0.98) continue
      planted[s].splice(i, 1)
      world.removeProducer(p.cx, p.cz)
      meltdown(s, p.cx, p.cz)
    }
  }
  syncStatus()
  if (isHuman(turn)) refreshResources()
}

function meltdown(owner: number, cx: number, cz: number): void {
  sfx.rumble()
  sfx.boom(9)
  hud.banner('☢️ NUCLEAR MELTDOWN', `${capName(owner)}'s reactor detonates — the fallout spreads!`, 3600)
  killCropsNear(cx, cz, MELT_R) // every crop in the blast (anyone's) dies
  world.contaminated.push({ cx, cz, r: MELT_R }) // and the ground is poisoned for the round
  // The reactor goes up with the force of a Nuke — a real crater that carves terrain and
  // caves in anything (forts included) caught in the blast.
  crater(new THREE.Vector3(cx, world.surfaceY(cx, cz), cz), 9.5, true)
  const sy = world.surfaceY(cx, cz)
  // A big, tall detonation: a ground fireball, a fireball rising up the stem, a blinding
  // double flash, and a hard shake — so the meltdown reads as a genuine nuclear blast.
  spawnExplosion(new THREE.Vector3(cx, sy + 6, cz), 28, true)
  spawnExplosion(new THREE.Vector3(cx, sy + 22, cz), 18, true) // a second burst higher up the column
  spawnFlash(new THREE.Vector3(cx, sy + 14, cz), 34, 0xfff0c8)
  addShake(26, new THREE.Vector3(cx, sy, cz))
  skipTurns[owner] = Math.max(skipTurns[owner], 2) // the owner is knocked out for two turns
  spawnFalloutCloud(cx, cz) // the black cloud can drift over anyone — the owner included
  // CHAIN REACTION: any other reactor whose 9×9 pad sits within a ~3-voxel gap of this one
  // (centre-to-centre ≤ 11) cooks off moments later — each with its own blast and cloud.
  // They're pulled off the map NOW (a cooking reactor produces nothing and can't re-chain).
  let chainDelay = 0.45
  for (let s = 0; s < numPlayers; s++) {
    for (let i = planted[s].length - 1; i >= 0; i--) {
      const p = planted[s][i]
      if (p.type !== PLANT || Math.max(Math.abs(p.cx - cx), Math.abs(p.cz - cz)) > 11) continue
      planted[s].splice(i, 1)
      world.removeProducer(p.cx, p.cz)
      pendingMeltdowns.push({ owner: s, cx: p.cx, cz: p.cz, delay: chainDelay })
      chainDelay += 0.45
    }
  }
}

// Destroy every crop (any seat's) whose bed sits within `r` of (cx,cz). Permanent — they're
// ripped off the map, not merely shelled.
function killCropsNear(cx: number, cz: number, r: number): void {
  for (let s = 0; s < numPlayers; s++) {
    for (let i = planted[s].length - 1; i >= 0; i--) {
      const p = planted[s][i]
      if (p.type !== CROP || Math.hypot(p.cx - cx, p.cz - cz) > r) continue
      planted[s].splice(i, 1)
      world.removeProducer(p.cx, p.cz)
    }
  }
}

// Loose a towering black mushroom cloud of roiling particle puffs from a meltdown site. It erupts
// up out of the wreck as a tall plume — a broad billowing cap over a narrower stem — then leans
// over and rides the (meandering) wind. Nothing is safe: it rolls over anyone, the reactor's
// owner included, and keeps going until it blows clean off the map.
const FALLOUT_RISE = 2.2 // seconds spent erupting upward before the drift begins
const FALLOUT_CAP_H = 34 // height (above terrain) the cap rides at once risen
function spawnFalloutCloud(cx: number, cz: number): void {
  const group = new THREE.Group()
  const puffs: FalloutCloud['puffs'] = []
  const puff = (base: THREE.Vector3, r: number, op: number) => {
    const geo = new THREE.SphereGeometry(r, 8, 7)
    const mat = new THREE.MeshLambertMaterial({
      color: 0x0b0d07, emissive: 0x1f2c0a, emissiveIntensity: 0.5, // near-black, sickly nuclear-green glow
      transparent: true, opacity: op, depthWrite: false, // soft, blurred overlap
    })
    const m = new THREE.Mesh(geo, mat)
    m.position.copy(base)
    group.add(m)
    puffs.push({ m, base, ph: Math.random() * Math.PI * 2, sp: 0.6 + Math.random() * 1.2 })
  }
  // Broad billowing CAP (24 big puffs, disc up to r≈13, around the group origin = cap centre).
  for (let i = 0; i < 24; i++) {
    const a = Math.random() * Math.PI * 2
    const rad = Math.pow(Math.random(), 0.7) * 13
    puff(new THREE.Vector3(Math.cos(a) * rad, (Math.random() - 0.4) * 12, Math.sin(a) * rad), 3.5 + Math.random() * 4, 0.5 + Math.random() * 0.32)
  }
  // Narrower STEM (13 puffs) reaching from the cap down toward the ground.
  for (let i = 0; i < 13; i++) {
    puff(new THREE.Vector3((Math.random() - 0.5) * 8, -6 - Math.random() * (FALLOUT_CAP_H - 8), (Math.random() - 0.5) * 8), 2.5 + Math.random() * 2.2, 0.4 + Math.random() * 0.3)
  }
  const pos = new THREE.Vector3(cx, world.surfaceY(cx, cz) + 4, cz)
  group.position.copy(pos)
  group.scale.setScalar(0.25)
  scene.add(group)
  fallouts.push({ pos, life: 0, group, puffs, hit: new Set() })
  if (!falloutWind) {
    // Seed the fallout's weather from the turn's wind (that's the read the shooter gambled on).
    const baseAng = wind.x || wind.z ? Math.atan2(wind.z, wind.x) : Math.random() * Math.PI * 2
    const baseMag = Math.max(3, Math.hypot(wind.x, wind.z))
    falloutWind = { baseAng, baseMag, t: 0, p1: Math.random() * 6.28, p2: Math.random() * 6.28, p3: Math.random() * 6.28 }
  }
}

// Per-frame: pop staggered chain detonations, evolve the meandering wind, drift every cloud,
// damage whoever it rolls over, and — once the sky is clear — release the held turn.
function updateFallouts(dt: number): void {
  for (let i = pendingMeltdowns.length - 1; i >= 0; i--) {
    const p = pendingMeltdowns[i]
    p.delay -= dt
    if (p.delay <= 0) {
      pendingMeltdowns.splice(i, 1)
      meltdown(p.owner, p.cx, p.cz) // may chain further plants + loose another cloud
    }
  }
  if (fallouts.length && falloutWind) {
    const fw = falloutWind
    fw.t += dt
    // Smooth pseudo-Perlin meander: the heading wanders up to ~±77° off the seed wind, and the
    // strength breathes — a cloud aimed at an enemy can genuinely turn back on its maker.
    const ang = fw.baseAng + 0.85 * Math.sin(fw.t * 0.21 + fw.p1) + 0.5 * Math.sin(fw.t * 0.57 + fw.p2)
    const mag = fw.baseMag * (0.8 + 0.3 * Math.sin(fw.t * 0.37 + fw.p3))
    hud.setWind(Math.cos(ang) * mag, Math.sin(ang) * mag) // the HUD arrow tracks the shifting sky
    const speed = 4.5 + mag * 0.55
    for (let ci = fallouts.length - 1; ci >= 0; ci--) {
      const f = fallouts[ci]
      f.life += dt
      const gx = Math.round(Math.max(0, Math.min(GX - 1, f.pos.x)))
      const gz = Math.round(Math.max(0, Math.min(GZ - 1, f.pos.z)))
      const gy = world.surfaceY(gx, gz)
      if (f.life < FALLOUT_RISE) {
        // Erupt upward out of the wreck, the cap climbing to full height and swelling to size.
        const e = 1 - Math.pow(1 - f.life / FALLOUT_RISE, 2)
        f.pos.y = gy + 4 + e * FALLOUT_CAP_H
        f.group.scale.setScalar(0.25 + e * 0.9)
      } else {
        f.pos.x += Math.cos(ang) * speed * dt
        f.pos.z += Math.sin(ang) * speed * dt
        f.pos.y += (gy + FALLOUT_CAP_H - f.pos.y) * Math.min(1, dt * 2)
        for (let s = 0; s < numPlayers; s++) {
          if (f.hit.has(s) || !alive[s]) continue
          const ft = world.forts[s]?.towers[0]
          const overFort = ft && Math.hypot(f.pos.x - ft.cx, f.pos.z - ft.cz) < 13
          const overCrop = planted[s].some(p => p.type === CROP && Math.hypot(f.pos.x - p.cx, f.pos.z - p.cz) < 13)
          if (overFort || overCrop) {
            f.hit.add(s)
            killCropsNear(f.pos.x, f.pos.z, 15)
            skipTurns[s] = Math.max(skipTurns[s], 2)
            if (isHuman(turn)) refreshResources()
            syncStatus()
            hud.banner('☢️ FALLOUT', `the radioactive cloud rolls over ${nameOf(s)} — crops ruined, two turns lost!`, 3200)
            sfx.boom(4)
          }
        }
      }
      f.group.position.copy(f.pos)
      f.group.rotation.y += dt * 0.25
      for (const p of f.puffs) {
        // Each puff churns around its anchor — the roiling, blurred look.
        p.m.position.set(
          p.base.x + Math.sin(fw.t * p.sp + p.ph) * 2.4,
          p.base.y + Math.sin(fw.t * p.sp * 0.8 + p.ph * 1.7) * 1.6,
          p.base.z + Math.cos(fw.t * p.sp + p.ph) * 2.4
        )
      }
      // Gone once it clears the map (or a 40s hard cap so the game can never wedge).
      if (f.life > 40 || f.pos.x < -6 || f.pos.x > GX + 6 || f.pos.z < -6 || f.pos.z > GZ + 6) {
        scene.remove(f.group)
        fallouts.splice(ci, 1)
      }
    }
    if (!fallouts.length) falloutWind = null
  }
  // Sky clear + no chain blasts pending → release the held turn (the rest of finishResolve).
  if (!fallouts.length && !pendingMeltdowns.length && falloutContinuation) {
    const go = falloutContinuation
    falloutContinuation = null
    go()
  }
}

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
  for (let s = 0; s < numPlayers; s++) {
    const seat = world.cannonSeat(s)
    sides[s].targetX = seat.x
    sides[s].targetY = seat.y
    sides[s].targetZ = seat.z
  }
  refreshIntegrity()
  checkMeltdowns() // a nuclear plant reduced to rubble this shot melts down
  // A meltdown holds the game: nobody takes a turn until every player has watched the fallout
  // ride the wind to wherever it lands (and any chain reactions finish going off). The rest of
  // this resolve — deaths, round end, next turn — runs when the sky clears (updateFallouts).
  if (fallouts.length || pendingMeltdowns.length) {
    falloutContinuation = () => finishResolveTail(wasCard)
    phase = 'fallout'
    return
  }
  finishResolveTail(wasCard)
}

// The tail of a resolve — trust fallout, eliminations, and the handoff to the next turn.
// Split out so a nuclear-fallout sequence can hold it until the clouds clear the map.
function finishResolveTail(wasCard: boolean): void {
  // Attacking a seat costs their trust in you — an ally you shell defects (and a betrayer
  // you already dislike sinks further). Only the acting seat `turn` is blamed for this shot.
  if (numPlayers > 2) {
    for (let v = 0; v < numPlayers; v++) {
      if (v === turn || !alive[v]) continue
      if (world.integrity(v) < preShotIntegrity[v] - 0.02) trust[v][turn] -= 3
    }
  }
  // Any living seat whose tower just collapsed is newly eliminated this resolve.
  const dead: number[] = []
  for (let s = 0; s < numPlayers; s++) if (alive[s] && world.integrity(s) < COLLAPSE_AT) dead.push(s)
  if (dead.length) {
    const roundEnded = concludeRound(dead)
    if (!roundEnded) advanceTurn() // a seat is out but the round goes on
  } else if (wasCard) {
    // A played-card strike that didn't collapse anything — the shooter still shoots.
    phase = isHuman(turn) ? 'aim' : 'aiThink'
    if (isHuman(turn)) {
      hud.setPower(null, shotThisRound[turn] ? lastPlayerPower[turn] : null)
      hud.showCards(true)
      hud.banner(twoPlayer ? `PLAYER ${turn + 1} — TAKE YOUR SHOT` : 'YOUR TURN', 'take your shot')
    } else {
      aiT = 0
      aiPlanned = null
    }
  } else {
    advanceTurn()
  }
}

// ---------------------------------------------------------------- rounds & armory

// Nearest spot to (cx,cz) where a producer of `type` can legally sit, searched in growing
// rings. Used to rescue a producer whose original spot got blocked between rounds, so it's
// nudged aside rather than silently lost. Returns null only if nothing within range works.
function nearestProducerSpot(cx: number, cz: number, type: number): { cx: number; cz: number } | null {
  for (let r = 2; r <= 34; r += 2) {
    for (let dx = -r; dx <= r; dx += 2) {
      for (let dz = -r; dz <= r; dz += 2) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue // ring only
        const x = cx + dx, z = cz + dz
        if (world.canPlaceProducer(x, z, type)) return { cx: x, cz: z }
      }
    }
  }
  return null
}

// (Re)build the current round's battlefield — same seed, so buying a tower in
// the armory adds it to the already-visible terrain.
function rebuildRoundWorld(): void {
  world.generate(roundSeed, forti, numPlayers)
  // Re-raise every planted producer into the fresh terrain. A producer MUST come back —
  // income counts its physical cells (integrityAt), so a producer left un-raised becomes an
  // invisible "zombie" that you still own but that pays nothing (the bug where placed Nuclear
  // Plants stopped paying). If its original spot is now blocked (a relocated fort/berm, or a
  // Plant's water cell got covered), nudge it to the nearest valid spot instead of dropping it.
  for (let s = 0; s < numPlayers; s++) {
    for (const p of planted[s]) {
      if (!world.canPlaceProducer(p.cx, p.cz, p.type)) {
        const spot = nearestProducerSpot(p.cx, p.cz, p.type)
        if (spot) { p.cx = spot.cx; p.cz = spot.cz }
      }
      world.buildProducer(p.cx, p.cz, s, p.type, p.baseYield, p.age)
    }
  }
  for (let s = 0; s < numPlayers; s++) {
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
    if (t.kind === 'roller' || t.kind === 'toaster') scene.remove(t.mesh)
    else if (t.kind === 'army') for (const r of t.runners) scene.remove(r)
  }
  tasks.length = 0
  // Card effects don't carry between rounds: clear ghost/field/raid, restore cannons.
  ghostReposition = false
  // No cloud, pending chain blast, or held turn carries into a new round.
  for (const f of fallouts) scene.remove(f.group)
  fallouts = []
  pendingMeltdowns.length = 0
  falloutWind = null
  falloutContinuation = null
  if (wheelSpin) { wheelSpin = null; hud.hideWheels() }
  for (let s = 0; s < 4; s++) {
    ghostDecoyOf[s] = null
    forceField[s] = false
    skipTurns[s] = 0
    resourceBlocked[s] = false // a blockade lasts the round
    armyRaidOf[s] = null
    world.hiddenForts[s] = false
    // Stale trade obligations don't carry between rounds, but TRUST/alliances do (they build
    // over a match); trust is reset only at a fresh match (fullReset).
    for (let o = 0; o < 4; o++) {
      giftOwed[s][o] = false
      owedActedSince[s][o] = false
    }
  }
  world.clearRaided()
  for (let s = 0; s < 4; s++) {
    incomeBoost[s] = 1
    skipNext[s] = false
    shotThisRound[s] = false
    alive[s] = s < numPlayers // everyone back in for the new round
    sides[s].cannon.group.visible = s < numPlayers
  }
  // Terrain is fixed for the whole match (seed set at match start) so producers you
  // plant stay on valid ground round to round; each round just rebuilds the same land.
  rebuildRoundWorld()
  for (let s = 0; s < numPlayers; s++) {
    // Aim starts pointed toward the map centre (free aim lets each player sweep anywhere).
    const t = world.forts[s]?.towers[0]
    sides[s].az = t ? Math.atan2(GZ / 2 - t.cz, GX / 2 - t.cx) : s === 0 ? 0 : Math.PI
    sides[s].el = 55 * DEG
    applyCannonPose(s)
  }
  aiErr = 16
  endInfo = null
  flyHold = null
  clearLastTrails()
  refreshIntegrity()
  updateWeaponHud()
  hud.setPower(null, null)
  hud.setAngles(0, 55)
}

// The computer spends its winnings too: fortifications when flush, then
// cheap weapon volume first, big-ticket when rich.
function aiShop(s: number): void {
  // Farms are now planted per-turn (see aiPlant), not bought here. The shop spends
  // this computer seat's winnings on defenses and weapons.
  // A berm is cheap insurance — the AI grabs one fairly often.
  if (money[s] >= 2500 && forti[s].barricade < 2 && Math.random() < 0.55) {
    money[s] -= 2500
    forti[s].barricade++
  }
  if (money[s] >= 8000 && forti[s].towers < 2 && Math.random() < 0.5) {
    money[s] -= 8000
    forti[s].towers++
  }
  if (money[s] >= 5000 && forti[s].height < 12 && Math.random() < 0.5) {
    money[s] -= 5000
    forti[s].height += 6
  }
  const caps: Record<string, number> = {
    babynuke: 4, mirv: 3, bigmissile: 20, nuke: 2, roller: 3, funky: 2,
    leapfrog: 2, heavyroller: 2, deathshead: 1,
  }
  const order = ['babynuke', 'mirv', 'bigmissile', 'nuke', 'roller', 'funky', 'leapfrog', 'heavyroller', 'deathshead']
  // Keep a war chest back so the AI can still plant producers on its turns (aiPlant).
  const PLANT_RESERVE = 2400
  let bought = true
  while (bought) {
    bought = false
    for (const id of order) {
      const w = WEAPONS.find(x => x.id === id)!
      const owned = sides[s].arsenal.get(id) ?? 0
      if (w.price !== undefined && money[s] - PLANT_RESERVE >= w.price && owned < (caps[id] ?? 2)) {
        money[s] -= w.price
        sides[s].arsenal.set(id, owned + (w.pack ?? 1))
        bought = true
      }
    }
  }
}

const FORT_UPGRADES = [
  { name: 'Curtain wall (rings the keep, +higher each)', price: 2500, max: 4, owned: (s: number) => forti[s].barricade, apply: (s: number) => (forti[s].barricade += 1) },
  { name: 'Raise main tower (+6 levels, from the base)', price: 5000, max: 10, owned: (s: number) => Math.max(0, Math.round(forti[s].height / 6)), apply: (s: number) => (forti[s].height += 6) },
  { name: 'Extra tower', price: 8000, max: 2, owned: (s: number) => forti[s].towers, apply: (s: number) => (forti[s].towers += 1) },
]

function shopItems() {
  // Only offer weapons the player can actually afford (or already owns) — the big guns stay
  // out of reach until you've raised the money, so the smart opening is to build an economy
  // first. Equal for everyone (same rule, same prices); the free Baby Missile is always in hand.
  const cash = money[turn]
  return WEAPONS.filter(w => w.price !== undefined && (w.price <= cash || (sides[turn].arsenal.get(w.id) ?? 0) > 0)).map(w => ({
    name: w.name,
    owned: sides[turn].arsenal.get(w.id) ?? 0,
    price: w.price!,
    pack: w.pack ?? 1,
  }))
}

function shopForts() {
  return FORT_UPGRADES.map(u => ({
    name: u.name,
    owned: u.owned(turn),
    price: u.price,
    maxed: u.owned(turn) >= u.max,
  }))
}

function shopResources() {
  return PRODUCER_TYPES.map(t => ({
    name: t === PLANT ? `${PRODUCER_SPECS[t].name} (+$${PRODUCER_SPECS[t].baseYield} when rolled — needs water, MELTDOWN if destroyed)` : `${PRODUCER_SPECS[t].name} (+$${PRODUCER_SPECS[t].baseYield} when rolled)`,
    price: PRODUCER_SPECS[t].cost,
    queued: pendingResources[turn].filter(x => x === t).length,
  }))
}

function refreshShop(): void {
  syncStatus()
  const s = turn
  hud.showShop(
    {
      round,
      rounds: ROUNDS,
      scoreYou: score[0],
      scoreFoe: score[1],
      money: money[s],
      result: marketFull
        ? lastRoundResult
        : lastIncome[s] > 0
          ? `Your resources paid +$${lastIncome[s].toLocaleString()} this turn.`
          : 'No resource income yet — buy resources below and place them on your turn.',
      full: marketFull,
      startLabel: marketFull ? 'START ROUND' : 'DONE — PLACE & AIM',
      playerLabel: twoPlayer ? `PLAYER ${s + 1}` : '',
      cardCost: CARD_COST,
      cardHint: `hand ${hand[s].length} · buy as many as you like`,
      canBuyCard: money[s] >= CARD_COST,
      resources: shopResources(),
      items: shopItems(),
      forts: shopForts(),
    },
    {
      onBuy: buyWeapon,
      onBuyFort: buyFort,
      onBuyCard: () => {
        buyCard(s)
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
  if (money[turn] < spec.cost) return void hud.msg('not enough cash')
  money[turn] -= spec.cost
  pendingResources[turn].push(type)
  sfx.tick()
  refreshShop()
}

// Leaving the market: round-start goes through castle placement first; otherwise
// straight to your turn (aim), where you place resources from the list and/or fire.
function onMarketDone(): void {
  syncStatus()
  // Purchases done → NOW spin the resource wheels; income lands, then placement / aiming begins.
  spinWheels(turn, () => {
    syncStatus()
    if (marketFull) beginCastlePlacement()
    else enterAim()
  })
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
  if (!w || money[turn] < w.price!) return
  money[turn] -= w.price!
  sides[turn].arsenal.set(w.id, (sides[turn].arsenal.get(w.id) ?? 0) + (w.pack ?? 1))
  sfx.tick()
  updateWeaponHud()
  refreshShop()
}

function buyFort(index: number): void {
  const u = FORT_UPGRADES[index]
  if (!u || money[turn] < u.price || u.owned(turn) >= u.max) return
  money[turn] -= u.price
  u.apply(turn)
  // Construction happens on the spot, behind the shop — scoped to the buyer's own
  // fort so mid-round purchases never regenerate (and heal) the battlefield.
  const fort = world.forts[turn]
  const t = fort?.towers[0]
  if (t) {
    if (index === 0) world.buildBarricade(t.cx, t.cz, fort.facing, forti[turn].towers, forti[turn].barricade)
    else world.moveFort(turn, t.cx, t.cz, forti[turn]) // re-raise towers (+ berm) with the upgrade
    world.rebuild()
    snapCannonToSeat(turn)
  }
  sfx.tick()
  refreshShop()
}

// A per-round stipend seeds both treasuries so a plundered/razed loser can rebuild
// its economy (guards against an unrecoverable snowball). Tuned further in balance.
const ROUND_STIPEND = 1200
function nextRound(): void {
  hud.hideRoundOver()
  round++
  // The stipend seeds rounds 2+ only — round 1 is just START_CASH (no double-dip, so the
  // opening bankroll can't afford a decisive weapon and building economy comes first).
  for (let s = 0; s < numPlayers; s++) {
    if (round > 1) money[s] += ROUND_STIPEND
    roundStartPending[s] = true // each seat's first turn of the round = FULL market + castle
  }
  // Each computer seat positions its castle + restocks (round start only).
  for (let s = 0; s < numPlayers; s++) if (!isHuman(s)) { aiPlaceCastle(s); aiShop(s) }
  setupRoundWorld()
  startTurn(0)
}

function fullReset(): void {
  round = 0
  lastRoundResult = ''
  // Fresh diplomacy for the new match — no one trusts anyone yet, no vassals.
  for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) { trust[a][b] = 0; giftOwed[a][b] = false; owedActedSince[a][b] = false }
  for (let s = 0; s < 4; s++) overlord[s] = -1
  // Fresh battlefield for the new match, fixed across this match's rounds. Producers
  // can be placed anywhere (even water), so any seed is playable.
  roundSeed = Math.floor(Math.random() * 1e9)
  world.castleOverride = Array.from({ length: numPlayers }, () => null) // revert to seed spots
  for (let s = 0; s < numPlayers; s++) {
    score[s] = 0
    // Bitter Truth: your nation's real economy is your war chest, and its military might is
    // the girth of your fortress (extra towers + storeys). Fun Time keeps everyone equal.
    const stat = statOf(playerCountry[s]?.code)
    money[s] = bitterTruth ? cashFromGdp(stat.gdp) : START_CASH
    const girth = bitterTruth ? girthFromMil(stat.mil) : { towers: 0, height: 0, half: 4 }
    sides[s].arsenal = newArsenal()
    sides[s].wsel = 0
    forti[s].height = girth.height
    forti[s].towers = girth.towers
    forti[s].half = girth.half // Bitter Truth: weak militaries get a thin, narrow keep
    forti[s].barricade = 0
    planted[s] = []
    pendingResources[s] = []
    hand[s] = []
    lastIncome[s] = 0
    shotThisRound[s] = false
    alive[s] = true
  }
  refreshForts()
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
      hud.setTrade(false) // no trading once you commit to the shot
      hud.setSurrender(false)
      chargeT = 0
      chargePower = 0
    } else if (phase === 'fly' && !e.repeat) {
      // Detonate a piloted Flying Saucer wherever it's hovering.
      const lead = projs[0]
      if (lead && isHuman(lead.side) && lead.side === turn && lead.weapon.kind === 'saucer') detonateSaucer(lead)
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
    lastPlayerPower[turn] = power
    const weapon = WEAPONS[sides[turn].wsel]
    fireShot(turn, weapon, power)
  }
})

window.addEventListener('blur', () => keys.clear())
window.addEventListener('pointerdown', () => sfx.unlock())

// How long each aim axis has been held — drives the exponential acceleration.
let azHoldT = 0
let elHoldT = 0

function updatePlayerAim(dt: number): void {
  if (phase !== 'aim' && phase !== 'charge') return
  const s = sides[turn]
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
  applyCannonPose(turn)
  let azDeg = (s.az * 180) / Math.PI
  while (azDeg > 180) azDeg -= 360
  while (azDeg < -180) azDeg += 360
  hud.setAngles(azDeg, (s.el * 180) / Math.PI)
  if (phase === 'charge') {
    chargeT += dt
    const cyc = (chargeT * 62) % 200
    chargePower = cyc <= 100 ? cyc : 200 - cyc
    hud.setPower(chargePower, shotThisRound[turn] ? lastPlayerPower[turn] : null)
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
  updateFallouts(dt)
  updateWheels(dt)
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

  // On the first frame of flight, snapshot integrity so finishResolve can attribute damage.
  if (phase === 'fly' && flyTotal === 0) for (let s = 0; s < numPlayers; s++) preShotIntegrity[s] = world.integrity(s)
  // Safety net: if a shot lingers too long (a stuck projectile/task that never clears),
  // force it to resolve so the round can't hang mid-flight.
  flyTotal = phase === 'fly' ? flyTotal + dt : 0
  if (phase === 'fly' && (flyTotal > 16 || (projs.length === 0 && tasks.length === 0))) {
    for (const p of [...projs]) removeProj(p)
    for (const t of tasks) {
      if (t.kind === 'roller' || t.kind === 'toaster') scene.remove(t.mesh)
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
      victoryT = 0
      victoryBursts = 0
      const winner = endInfo ? endInfo.winner : -1
      for (const b of pendingBlasts) {
        const base = new THREE.Vector3(b.cx, world.surfaceY(b.cx, b.cz), b.cz)
        world.burstRubble(b.cx, b.cz, 8, Math.random)
        spawnExplosion(base.clone().add(new THREE.Vector3(0, 3, 0)), 10, true)
        spawnFlash(base.clone().add(new THREE.Vector3(0, 5, 0)), 44, 0xffe0a0)
        spawnFlash(base.clone().add(new THREE.Vector3(0, 1, 0)), 28, 0xffd070)
        spawnVictoryBurst(base.clone().add(new THREE.Vector3(0, 4, 0)), winner)
        addShake(11, base)
      }
      if (pendingBlasts.length) sfx.boom(10)
      // The big two-line round-over banner appears over the wreckage as it bursts.
      if (endInfo) hud.roundOver(endInfo.line1, endInfo.line2, endInfo.winner)
      pendingBlasts = []
    }
    // Celebratory fireworks keep popping above the wreckage for a couple of seconds.
    if (blastFired && endInfo && victoryBursts < 6) {
      victoryT += dt
      if (victoryT > 0.32) {
        victoryT = 0
        victoryBursts++
        const c = endInfo.center
        const at = new THREE.Vector3(c.x + (Math.random() - 0.5) * 34, c.y + 16 + Math.random() * 18, c.z + (Math.random() - 0.5) * 34)
        spawnVictoryBurst(at, endInfo.winner, 260)
        spawnFlash(at, 22, endInfo.winner === 1 ? 0x8ab4ff : 0xffb060)
        sfx.boom(3)
      }
    }
    // Hold on the wreckage a beat after the blast before the result / next round.
    if (!endShown && endT > 4.2 && endInfo) {
      endShown = true
      // The match ends when a seat reaches the win threshold (2 in best-of-3) or rounds run out.
      const winThreshold = Math.floor(ROUNDS / 2) + 1
      const best = score.slice(0, numPlayers).reduce((a, b) => Math.max(a, b), 0)
      const leaders = []
      for (let s = 0; s < numPlayers; s++) if (score[s] === best) leaders.push(s)
      const decided = best >= winThreshold || round >= ROUNDS
      if (decided) {
        const champ = leaders.length === 1 ? leaders[0] : -1
        const title =
          champ < 0 ? 'DRAW' : twoPlayer || numPlayers > 2 ? `PLAYER ${champ + 1} WINS` : champ === 0 ? 'VICTORY' : 'DEFEAT'
        const scoreLine = score.slice(0, numPlayers).join(' — ')
        // Rematch returns to the mode picker so you can switch modes between matches.
        hud.showEnd(title, `Final score ${scoreLine} over ${round} rounds.`, showModePicker)
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

// Boot: pick a mode first (1 Player vs computer / 2 Players hotseat), then the match
// starts. The Rematch button routes back here so the mode can change between matches.
function showModePicker(): void {
  phase = 'shop' // inert while the picker is up — no aiming/firing behind the overlay
  hud.showModePicker(count => {
    // Right after the player count, choose the reality: Fun Time (as-is) or The Bitter Truth.
    hud.showGameModePicker(hard => {
      bitterTruth = hard
      if (count === 1) startWithSeats(2, [true, false]) // you vs the computer
      else if (count === 2) startWithSeats(2, [true, true]) // hotseat duel
      else hud.showSeatSetup(count, flags => startWithSeats(count, flags)) // 3–4 player lobby
    })
  })
}

// Configure the seat model (count + which seats are human), run the country picker for
// each human seat (AI seats fly a random flag), then start the match. The 3–4 player
// lobby (2.4) calls this the same way with more seats / mixed human-AI flags.
function startWithSeats(count: number, humanFlags: boolean[]): void {
  numPlayers = count
  for (let s = 0; s < 4; s++) {
    seatHuman[s] = s < count ? !!humanFlags[s] : false
    playerCountry[s] = null
  }
  twoPlayer = seatHuman.slice(0, count).filter(Boolean).length > 1 // >1 human = hotseat
  const humans: number[] = []
  for (let s = 0; s < count; s++) if (seatHuman[s]) humans.push(s)
  const taken: string[] = []
  let i = 0
  const next = () => {
    if (i >= humans.length) {
      for (let s = 0; s < count; s++) {
        if (!seatHuman[s]) {
          const c = randomCountry(taken)
          playerCountry[s] = c
          taken.push(c.code)
        }
      }
      startMatch()
      return
    }
    const seat = humans[i++]
    hud.showCountryPicker(twoPlayer || count > 2 ? `PLAYER ${seat + 1}` : 'YOU', taken, c => {
      playerCountry[seat] = c
      taken.push(c.code)
      next()
    })
  }
  next()
}

function startMatch(): void {
  fullReset()
  const c0 = playerCountry[0]
  hud.banner(
    'VOXEL WARS',
    c0 ? `${flagOf(c0.code)} ${c0.name} marches to war!` : 'to war!',
    2600
  )
}
showModePicker()
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
      setMode: (two: boolean) => void
      setBerms: (side: number, n: number) => void
      setPlayers: (count: number, humanFlags: boolean[], hard?: boolean, codes?: string[]) => void
      trust: () => number[][]
      giftOwed: () => boolean[][]
      tradable: (s: number) => { kind: string; key: string; label: string; emoji: string }[]
      giveItem: (from: number, to: number, kind: string, key: string) => boolean
      aiTarget: (s: number) => number
      allied: (a: number, b: number) => boolean
      setTrust: (a: number, b: number, v: number) => void
      surrender: (vassal: number, master: number) => void
      overlord: () => number[]
      team: (s: number) => number
      aiSurrenderCheck: (s: number) => void
      giveProducer: (seat: number, type: number, cx: number, cz: number) => void
      meltdownAt: (owner: number, cx: number, cz: number) => void
      moveFallout: (x: number, z: number) => void
      forceWheel: (a: number | string, b: number | string) => void
      testWheel: (roller: number, a: number | string, b: number | string) => void
      wheelState: () => { blocked: boolean[]; spinning: boolean }
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
    fxCount: fxs.length,
    numPlayers,
    alive: alive.slice(0, numPlayers),
    score: score.slice(0, numPlayers),
    integrity: Array.from({ length: numPlayers }, (_, s) => +world.integrity(s).toFixed(3)),
    wind,
    power: chargePower,
    lastImpact: { x: lastImpact.x, y: lastImpact.y, z: lastImpact.z },
    proj0: projs[0]
      ? { x: projs[0].pos.x, y: projs[0].pos.y, z: projs[0].pos.z, vx: projs[0].vel.x, vy: projs[0].vel.y, vz: projs[0].vel.z }
      : null,
    money: money.slice(0, numPlayers),
    planted: Array.from({ length: numPlayers }, (_, s) => planted[s].length),
    plantCursor: { cx: Math.round(plantCX), cz: Math.round(plantCZ) },
    hand: [...hand[isHuman(turn) ? turn : 0]],
    enemyHand: hand[1].length,
    ghosted: ghostDecoyOf.slice(0, numPlayers).map(d => !!d),
    armyRaidOn: armyRaidOf.slice(0, numPlayers).map(r => (r ? r.caster : -1)),
    forceField: forceField.slice(0, numPlayers),
    skipTurns: skipTurns.slice(0, numPlayers),
    contaminated: world.contaminated.length,
    fallout: fallouts[0] ? { x: Math.round(fallouts[0].pos.x), z: Math.round(fallouts[0].pos.z), hit: [...fallouts[0].hit] } : null,
    fallouts: fallouts.length,
    pendingMeltdowns: pendingMeltdowns.length,
    plantedTypes: Array.from({ length: numPlayers }, (_, s) => planted[s].map(p => p.type)),
  }),
  world,
  newMatch: fullReset,
  // Test hooks: select the first pending resource (if not already placing), position
  // the cursor, and place; and return to aim.
  plantAt(cx: number, cz: number) {
    if (phase !== 'plant' && pendingResources[turn].length) beginPlaceResource(pendingResources[turn][0])
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
  // Card test hooks: add a card to the ACTING player's hand and play by index.
  giveCard(id: string) {
    hand[isHuman(turn) ? turn : 0].push(id as CardId)
    refreshHand()
  },
  playCard(i: number) {
    playCard(isHuman(turn) ? turn : 0, i)
  },
  hand: () => [...hand[isHuman(turn) ? turn : 0]],
  sampleDraws(n: number) {
    const counts: Record<string, number> = {}
    for (let i = 0; i < n; i++) {
      const id = drawCard()
      counts[id] = (counts[id] ?? 0) + 1
    }
    return counts
  },
  // Mode test hook: pick 1P/2P headlessly (the UI picker does the same).
  setMode(two: boolean) {
    numPlayers = 2
    bitterTruth = false
    seatHuman[0] = true
    seatHuman[1] = two
    seatHuman[2] = false
    seatHuman[3] = false
    twoPlayer = two
    for (let s = 0; s < 4; s++) playerCountry[s] = randomCountry([])
    fullReset()
  },
  // Test hook: start a headless N-player match (humanFlags[s] = human vs AI) — the lobby
  // (2.4) does the same with real UI. `hard` toggles The Bitter Truth (default Fun Time).
  setPlayers(count: number, humanFlags: boolean[], hard = false, codes?: string[]) {
    numPlayers = count
    bitterTruth = hard
    for (let s = 0; s < 4; s++) {
      seatHuman[s] = s < count ? !!humanFlags[s] : false
      playerCountry[s] = s < count ? (codes && codes[s] ? { code: codes[s], name: codes[s] } : randomCountry([])) : null
    }
    twoPlayer = seatHuman.slice(0, count).filter(Boolean).length > 1
    fullReset()
  },
  // Test hook: set a side's berm (barricade) count and rebuild so armor takes effect.
  setBerms(side: number, n: number) {
    forti[side].barricade = n
    rebuildRoundWorld()
  },
  // Diplomacy test hooks (Phase 3): read the trust matrix + owed flags, and gift an item
  // directly (bypassing the UI) to exercise the alliance/betrayal rules headlessly.
  trust: () => trust.slice(0, numPlayers).map(row => row.slice(0, numPlayers)),
  giftOwed: () => giftOwed.slice(0, numPlayers).map(row => row.slice(0, numPlayers)),
  tradable: (s: number) => tradableItems(s),
  giveItem(from: number, to: number, kind: string, key: string) {
    return transferItem(from, to, kind as TradeKind, key)
  },
  aiTarget: (s: number) => aiTarget(s),
  allied: (a: number, b: number) => alliedWith(a, b),
  setTrust(a: number, b: number, v: number) {
    trust[a][b] = v
  },
  surrender: (vassal: number, master: number) => surrender(vassal, master),
  overlord: () => overlord.slice(0, numPlayers),
  team: (s: number) => teamRoot(s),
  aiSurrenderCheck: (s: number) => aiMaybeSurrender(s),
  giveProducer(seat: number, type: number, cx: number, cz: number) {
    const spec = PRODUCER_SPECS[type]
    planted[seat].push({ cx, cz, type, baseYield: spec.baseYield, age: 3 })
    world.buildProducer(cx, cz, seat, type, spec.baseYield, 3)
  },
  // Mirrors the real path (checkMeltdowns): the plant leaves the map BEFORE it blows, so the
  // chain scan can't re-trigger on the origin.
  meltdownAt: (owner: number, cx: number, cz: number) => {
    const i = planted[owner].findIndex(p => p.type === PLANT && p.cx === cx && p.cz === cz)
    if (i >= 0) { planted[owner].splice(i, 1); world.removeProducer(cx, cz) }
    meltdown(owner, cx, cz)
  },
  moveFallout(x: number, z: number) {
    const f0 = fallouts[0]
    if (f0) { f0.pos.x = x; f0.pos.z = z; f0.life = Math.max(f0.life, FALLOUT_RISE) } // skip the rise so damage checks run
  },
  forceWheel(a: number | string, b: number | string) {
    wheelForce = { a: a as WheelSlice, b: b as WheelSlice }
  },
  // Resolve a spin synchronously (payout + any Blockade/Tribute) for an AI roller — test only.
  testWheel(roller: number, a: number | string, b: number | string) {
    payWheels(roller, a as WheelSlice, b as WheelSlice)
    runWheelSpecials(roller, a as WheelSlice, b as WheelSlice, () => {})
  },
  wheelState: () => ({ blocked: resourceBlocked.slice(0, numPlayers), spinning: !!wheelSpin }),
}
