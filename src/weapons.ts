// Scorched Earth 3D — weapon definitions and shared ballistic constants.
// The roster follows the original Scorched Earth armory: missile and nuke
// lines, Leap Frog, Funky Bomb, MIRVs, napalms, tracers, the roller /
// sandhog / riot / dirt families.

export type WeaponKind =
  | 'blast'
  | 'mirv'
  | 'dirt'
  | 'digger'
  | 'napalm'
  | 'roller'
  | 'leap'
  | 'funky'
  | 'tracer'
  | 'riot'

export type WeaponDef = {
  id: string
  name: string
  ammo: number // starting ammo; Infinity for the basic missile
  blast: number // crater radius (per warhead for MIRVs)
  kind: WeaponKind
  split?: number // warheads (mirv/funky), fire blobs (napalm), dig steps (digger)
  price?: number // armory price per pack (undefined = not for sale)
  pack?: number // rounds per pack
}

export const WEAPONS: WeaponDef[] = [
  { id: 'missile', name: 'Baby Missile', ammo: Infinity, blast: 2.8, kind: 'blast' },
  { id: 'bigmissile', name: 'Missile', ammo: 0, blast: 3.8, kind: 'blast', price: 500, pack: 10 },
  { id: 'babynuke', name: 'Baby Nuke', ammo: 1, blast: 6.0, kind: 'blast', price: 1200, pack: 2 },
  { id: 'nuke', name: 'Nuke', ammo: 0, blast: 9.5, kind: 'blast', price: 2800, pack: 1 },
  { id: 'leapfrog', name: 'Leap Frog', ammo: 0, blast: 3.4, kind: 'leap', price: 1000, pack: 2 },
  { id: 'funky', name: 'Funky Bomb', ammo: 0, blast: 5.0, kind: 'funky', split: 7, price: 1400, pack: 2 },
  { id: 'mirv', name: 'MIRV', ammo: 0, blast: 3.4, kind: 'mirv', split: 5, price: 2000, pack: 2 },
  { id: 'deathshead', name: "Death's Head", ammo: 0, blast: 5.5, kind: 'mirv', split: 7, price: 5000, pack: 1 },
  { id: 'napalm', name: 'Napalm', ammo: 0, blast: 1.6, kind: 'napalm', split: 10, price: 900, pack: 2 },
  { id: 'hotnapalm', name: 'Hot Napalm', ammo: 0, blast: 2.2, kind: 'napalm', split: 16, price: 1800, pack: 1 },
  { id: 'tracer', name: 'Tracer', ammo: 0, blast: 0, kind: 'tracer', price: 200, pack: 10 },
  { id: 'babyroller', name: 'Baby Roller', ammo: 0, blast: 3.5, kind: 'roller', price: 500, pack: 2 },
  { id: 'roller', name: 'Roller', ammo: 0, blast: 5.5, kind: 'roller', price: 900, pack: 2 },
  { id: 'heavyroller', name: 'Heavy Roller', ammo: 0, blast: 8.0, kind: 'roller', price: 1800, pack: 1 },
  { id: 'riotcharge', name: 'Riot Charge', ammo: 0, blast: 4.0, kind: 'riot', price: 400, pack: 2 },
  { id: 'riotblast', name: 'Riot Blast', ammo: 0, blast: 6.0, kind: 'riot', price: 700, pack: 2 },
  { id: 'riotbomb', name: 'Riot Bomb', ammo: 0, blast: 9.0, kind: 'riot', price: 1200, pack: 1 },
  { id: 'babysandhog', name: 'Baby Sandhog', ammo: 0, blast: 2.1, kind: 'digger', split: 8, price: 700, pack: 2 },
  { id: 'sandhog', name: 'Sandhog', ammo: 0, blast: 2.1, kind: 'digger', split: 16, price: 1200, pack: 2 },
  { id: 'heavysandhog', name: 'Heavy Sandhog', ammo: 0, blast: 2.1, kind: 'digger', split: 26, price: 2200, pack: 1 },
  { id: 'dirtclod', name: 'Dirt Clod', ammo: 0, blast: 3.0, kind: 'dirt', price: 300, pack: 3 },
  { id: 'dirtball', name: 'Dirt Ball', ammo: 2, blast: 5.5, kind: 'dirt', price: 700, pack: 2 },
  { id: 'tondirt', name: 'Ton of Dirt', ammo: 0, blast: 8.5, kind: 'dirt', price: 1400, pack: 1 },
]

// Bomblets spawned by the Funky Bomb (not purchasable, not in the roster).
export const FUNKY_CHILD: WeaponDef = { id: 'funkychild', name: 'Bomblet', ammo: 0, blast: 2.6, kind: 'blast' }

export function newArsenal(): Map<string, number> {
  const m = new Map<string, number>()
  for (const w of WEAPONS) m.set(w.id, w.ammo)
  return m
}

// Power (0..100) → muzzle speed. Shared by player firing, AI planning, and the
// aim hint. Tuned so full power spans the widest battlefields.
export function speedOf(power: number): number {
  return 14 + 0.54 * power
}
