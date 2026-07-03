// Scorched Earth 3D — tiny WebAudio synth for shot / explosion / collapse sounds.

let ctx: AudioContext | null = null

function ac(): AudioContext {
  if (!ctx) ctx = new AudioContext()
  // Browsers suspend the context until a user gesture; try to wake it on every
  // use so the first post-gesture sound always comes through.
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

export function unlock(): void {
  ac()
}

function noiseBuffer(c: AudioContext, seconds: number): AudioBuffer {
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * seconds), c.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  return buf
}

// Cannon shot: sharp noise crack + low thump.
export function shot(): void {
  const c = ac()
  const t = c.currentTime
  const n = c.createBufferSource()
  n.buffer = noiseBuffer(c, 0.25)
  const nf = c.createBiquadFilter()
  nf.type = 'bandpass'
  nf.frequency.value = 900
  const ng = c.createGain()
  ng.gain.setValueAtTime(0.5, t)
  ng.gain.exponentialRampToValueAtTime(0.001, t + 0.22)
  n.connect(nf).connect(ng).connect(c.destination)
  n.start(t)

  const o = c.createOscillator()
  o.type = 'sine'
  o.frequency.setValueAtTime(120, t)
  o.frequency.exponentialRampToValueAtTime(40, t + 0.3)
  const og = c.createGain()
  og.gain.setValueAtTime(0.6, t)
  og.gain.exponentialRampToValueAtTime(0.001, t + 0.32)
  o.connect(og).connect(c.destination)
  o.start(t)
  o.stop(t + 0.35)
}

// Explosion boom; size ~ crater radius.
export function boom(size: number): void {
  const c = ac()
  const t = c.currentTime
  const dur = 0.5 + Math.min(1.2, size * 0.09)
  const n = c.createBufferSource()
  n.buffer = noiseBuffer(c, dur)
  const f = c.createBiquadFilter()
  f.type = 'lowpass'
  f.frequency.setValueAtTime(1400 + size * 120, t)
  f.frequency.exponentialRampToValueAtTime(60, t + dur)
  const g = c.createGain()
  const vol = Math.min(0.9, 0.35 + size * 0.06)
  g.gain.setValueAtTime(vol, t)
  g.gain.exponentialRampToValueAtTime(0.001, t + dur)
  n.connect(f).connect(g).connect(c.destination)
  n.start(t)

  const o = c.createOscillator()
  o.type = 'sine'
  o.frequency.setValueAtTime(90, t)
  o.frequency.exponentialRampToValueAtTime(28, t + dur * 0.8)
  const og = c.createGain()
  og.gain.setValueAtTime(vol * 0.8, t)
  og.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.8)
  o.connect(og).connect(c.destination)
  o.start(t)
  o.stop(t + dur)
}

// Low rumble for a fort collapse.
export function rumble(): void {
  const c = ac()
  const t = c.currentTime
  const n = c.createBufferSource()
  n.buffer = noiseBuffer(c, 2.2)
  const f = c.createBiquadFilter()
  f.type = 'lowpass'
  f.frequency.value = 120
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(0.7, t + 0.15)
  g.gain.exponentialRampToValueAtTime(0.001, t + 2.1)
  n.connect(f).connect(g).connect(c.destination)
  n.start(t)
}

// Soft UI tick for weapon switching.
export function tick(): void {
  const c = ac()
  const t = c.currentTime
  const o = c.createOscillator()
  o.type = 'square'
  o.frequency.value = 660
  const g = c.createGain()
  g.gain.setValueAtTime(0.08, t)
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.06)
  o.connect(g).connect(c.destination)
  o.start(t)
  o.stop(t + 0.08)
}

// MIRV separation pop.
export function pop(): void {
  const c = ac()
  const t = c.currentTime
  const o = c.createOscillator()
  o.type = 'triangle'
  o.frequency.setValueAtTime(300, t)
  o.frequency.exponentialRampToValueAtTime(900, t + 0.1)
  const g = c.createGain()
  g.gain.setValueAtTime(0.25, t)
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.14)
  o.connect(g).connect(c.destination)
  o.start(t)
  o.stop(t + 0.16)
}
