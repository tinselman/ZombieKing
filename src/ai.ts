// Scorched Earth 3D — computer opponent aiming.
// Classic "Shooter" feel: it solves the shot properly, but against a target
// perturbed by an error radius that shrinks every turn, so it brackets in on you.
import type { World, Vec3, Wind } from './world'
import { speedOf } from './weapons'

export type AiPlan = { az: number; el: number; power: number; err: number }

const DEG = Math.PI / 180

function landingError(world: World, muzzle: Vec3, target: Vec3, wind: Wind, az: number, el: number, power: number): number {
  const s = speedOf(power)
  const vel = {
    x: Math.cos(el) * Math.cos(az) * s,
    y: Math.sin(el) * s,
    z: Math.cos(el) * Math.sin(az) * s,
  }
  const r = world.simShot(muzzle, vel, wind)
  if (!r.hit) return 1e9
  const dx = r.pos.x - target.x
  const dy = (r.pos.y - target.y) * 0.4 // vertical miss matters less than horizontal
  const dz = r.pos.z - target.z
  return Math.hypot(dx, dy, dz)
}

export function planShot(world: World, muzzle: Vec3, target: Vec3, wind: Wind, errMag: number, rand: () => number): AiPlan {
  // Aim at a point perturbed by the current error radius — the "skill" knob.
  const errAng = rand() * Math.PI * 2
  const errR = errMag * (0.4 + 0.6 * rand())
  const goal = {
    x: target.x + Math.cos(errAng) * errR,
    y: target.y,
    z: target.z + Math.sin(errAng) * errR,
  }

  const baseAz = Math.atan2(goal.z - muzzle.z, goal.x - muzzle.x)
  let best = { az: baseAz, el: 55 * DEG, power: 70, d: 1e9 }

  // Coarse grid search over the whole envelope...
  for (let azo = -14; azo <= 14; azo += 3.5) {
    for (let el = 28; el <= 74; el += 5.5) {
      for (let power = 30; power <= 100; power += 8) {
        const az = baseAz + azo * DEG
        const d = landingError(world, muzzle, goal, wind, az, el * DEG, power)
        if (d < best.d) best = { az, el: el * DEG, power, d }
      }
    }
  }
  // ...then refine around the winner.
  for (let azo = -2; azo <= 2; azo += 1) {
    for (let elo = -3; elo <= 3; elo += 1.5) {
      for (let po = -5; po <= 5; po += 2.5) {
        const az = best.az + azo * DEG
        const el = best.el + elo * DEG
        const power = Math.max(20, Math.min(100, best.power + po))
        const d = landingError(world, muzzle, goal, wind, az, el, power)
        if (d < best.d) best = { az, el, power, d }
      }
    }
  }
  return { az: best.az, el: best.el, power: best.power, err: best.d }
}
