// Zombie King — voxel avatars, structured like the VoxPop builder's avatars:
// a single cube head with two black square eyes on the facing side, two box
// legs with forward-pointing feet below, and thin arms hanging from the side
// faces at eye level. Tinted per side (red = player, blue = enemy).
//
// The group's origin is the head center; it is built facing local +X, so
// setting group.rotation.y = -az points it the same way as the cannons.
// With the default avatarHeight of 2 (head + 1-voxel legs), the feet soles
// sit at local y = -1.5 — see standingY() for planting them on a surface.
import * as THREE from 'three'

export const AVATAR_HEIGHT = 2 // total voxels tall, VoxPop's default

export function makeAvatar(color: number, avatarHeight = AVATAR_HEIGHT): THREE.Group {
  const group = new THREE.Group()
  const bodyMat = new THREE.MeshLambertMaterial({ color })
  const dir = new THREE.Vector3(1, 0, 0) // built facing +X
  const side = new THREE.Vector3(-dir.z, 0, dir.x) // right vector

  // Head/body: one voxel cube.
  const head = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), bodyMat)
  head.castShadow = true
  group.add(head)

  // Two small black square eyes on the front face, halfway up, near the edges.
  const eyeG = new THREE.PlaneGeometry(0.1, 0.1)
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide })
  for (const sgn of [-1, 1]) {
    const eye = new THREE.Mesh(eyeG, eyeMat)
    eye.position.set(dir.x * 0.501 + side.x * sgn * 0.32, 0, dir.z * 0.501 + side.z * sgn * 0.32)
    eye.lookAt(eye.position.x + dir.x, eye.position.y, eye.position.z + dir.z)
    group.add(eye)
  }

  // Legs + feet below the body voxel — (height - 1) voxels of leg reaching the ground.
  const legLen = Math.max(0, avatarHeight - 1)
  if (legLen > 0) {
    const legW = 0.25
    const legD = 0.25
    const legOff = 0.18
    for (const sgn of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(legW, legLen, legD), bodyMat)
      leg.position.set(side.x * sgn * legOff, -0.5 - legLen / 2, side.z * sgn * legOff)
      leg.castShadow = true
      group.add(leg)
      // Feet sit on the ground, pointing the way the avatar faces.
      const footL = legW * 1.6
      const footH = 0.12
      const foot = new THREE.Mesh(new THREE.BoxGeometry(legD, footH, footL), bodyMat)
      foot.position.set(
        side.x * sgn * legOff + dir.x * footL * 0.25,
        -0.5 - legLen + footH / 2,
        side.z * sgn * legOff + dir.z * footL * 0.25
      )
      foot.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir)
      group.add(foot)
    }
  }

  // Arms — thin square boxes hanging flush against the sides, tops at eye level.
  const armW = 0.1
  const armLen = Math.min(3, Math.max(0.4, legLen))
  for (const sgn of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(armW, armLen, armW), bodyMat)
    arm.position.set(side.x * sgn * (0.5 + armW / 2), -armLen / 2, side.z * sgn * (0.5 + armW / 2))
    arm.castShadow = true
    group.add(arm)
  }

  return group
}

// Head-center Y that plants the avatar's soles on top of the voxel at grid
// height `surfaceY` (voxel tops are at surfaceY + 0.5).
export function standingY(surfaceY: number, avatarHeight = AVATAR_HEIGHT): number {
  return surfaceY + 0.5 + Math.max(0, avatarHeight - 1) + 0.5
}
