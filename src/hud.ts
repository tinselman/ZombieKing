// Scorched Earth 3D — DOM heads-up display: integrity bars, wind, weapons, power, banners.

export type WeaponRow = { idx: number; name: string; ammo: number; selected: boolean }

const CSS = `
#sc-hud { position: fixed; inset: 0; pointer-events: none; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; color: #2c3138; user-select: none; }
#sc-hud .panel { position: absolute; background: rgba(255,255,255,0.78); backdrop-filter: blur(6px); border: 1px solid #d8dde3; border-radius: 10px; padding: 10px 14px; box-shadow: 0 2px 10px rgba(40,50,60,0.08); }
#sc-hud .label { font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #7a838d; margin-bottom: 5px; }
#sc-fortYou { top: 16px; left: 16px; width: 190px; }
#sc-fortFoe { top: 16px; right: 16px; width: 190px; }
#sc-hud .bar { height: 10px; background: #e8ebef; border-radius: 5px; overflow: hidden; }
#sc-hud .bar > div { height: 100%; border-radius: 5px; transition: width 0.5s ease; }
#sc-fortYou .bar > div { background: #d5473a; }
#sc-fortFoe .bar > div { background: #3a7bd5; }
#sc-hud .pct { font-size: 13px; font-weight: 600; margin-top: 4px; }
#sc-wind { top: 16px; left: 50%; transform: translateX(-50%); text-align: center; min-width: 110px; }
#sc-status { top: 130px; left: 50%; transform: translateX(-50%); font-size: 12px; font-weight: 600; letter-spacing: 0.05em; padding: 6px 14px; white-space: nowrap; }
#sc-status span { color: #7a838d; font-weight: 400; }
#sc-nightTurn { top: 168px; left: 50%; transform: translateX(-50%); font-size: 13px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; padding: 7px 18px; white-space: nowrap; background: rgba(20,26,38,0.85); color: #fff; border-color: #3a4a6b; display: none; }
#sc-windArrow { font-size: 22px; line-height: 1; display: inline-block; transition: transform 0.4s ease; }
#sc-windSpeed { font-size: 13px; font-weight: 600; margin-top: 2px; }
#sc-weapons { bottom: 16px; left: 16px; min-width: 170px; pointer-events: auto; }
#sc-weapons .w { font-size: 13px; padding: 2px 6px; border-radius: 5px; display: flex; justify-content: space-between; gap: 14px; color: #6c757e; cursor: pointer; }
#sc-weapons .w:hover { background: #e8ebef; }
#sc-weapons .w.sel { background: #2c3138; color: #fff; font-weight: 600; }
#sc-weapons .w.sel:hover { background: #2c3138; }
#sc-weapons .w.empty { opacity: 0.35; cursor: default; }
#sc-power { bottom: 16px; left: 50%; transform: translateX(-50%); width: 260px; text-align: center; }
#sc-powerBar { position: relative; height: 14px; background: #e8ebef; border-radius: 7px; }
#sc-powerBar > div.fill { height: 100%; width: 0%; background: linear-gradient(90deg, #7db4e8, #d5473a); border-radius: 7px; }
#sc-powerMark { position: absolute; top: -3px; bottom: -3px; width: 3px; margin-left: -1px; background: #2c3138; border-radius: 2px; display: none; }
#sc-powerNum { font-size: 13px; font-weight: 600; margin-top: 4px; }
#sc-angles { bottom: 16px; right: 16px; width: 170px; text-align: right; font-size: 13px; font-weight: 600; line-height: 1.6; }
#sc-angles span { color: #7a838d; font-weight: 400; }
#sc-side { position: fixed; right: 16px; bottom: 96px; width: 198px; height: 118px; border: 1px solid #d8dde3; border-radius: 10px; box-shadow: 0 2px 10px rgba(40,50,60,0.08); pointer-events: none; display: none; }
#sc-worldBtn { position: fixed; right: 16px; bottom: 224px; width: 200px; box-sizing: border-box; padding: 8px 0; font-size: 12px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #2c3138; background: rgba(255,255,255,0.78); backdrop-filter: blur(6px); border: 1px solid #d8dde3; border-radius: 10px; box-shadow: 0 2px 10px rgba(40,50,60,0.08); cursor: pointer; pointer-events: auto; display: none; }
#sc-worldBtn:hover { background: #fff; }
#sc-worldBtn.on { background: #2c3138; color: #fff; }
#sc-side .tag { position: absolute; top: -1px; left: -1px; font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: #7a838d; background: rgba(255,255,255,0.85); border: 1px solid #d8dde3; border-radius: 9px 0 8px 0; padding: 2px 8px; }
#sc-banner { position: absolute; top: 22%; left: 0; right: 0; text-align: center; font-size: 40px; font-weight: 800; letter-spacing: 0.06em; color: #2c3138; text-shadow: 0 2px 12px rgba(255,255,255,0.9); opacity: 0; transition: opacity 0.35s ease; }
#sc-banner small { display: block; font-size: 15px; font-weight: 500; letter-spacing: 0.1em; color: #7a838d; margin-top: 6px; }
#sc-msg { position: absolute; bottom: 92px; left: 50%; transform: translateX(-50%); font-size: 14px; font-weight: 600; color: #2c3138; background: rgba(255,255,255,0.85); border: 1px solid #d8dde3; border-radius: 8px; padding: 6px 14px; opacity: 0; transition: opacity 0.25s ease; }
#sc-help { position: absolute; bottom: 3px; left: 0; right: 0; text-align: center; font-size: 11px; color: #98a1aa; letter-spacing: 0.04em; }
#sc-end { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; flex-direction: column; background: rgba(244,246,248,0.82); backdrop-filter: blur(8px); pointer-events: auto; }
#sc-end h1 { font-size: 56px; font-weight: 800; letter-spacing: 0.05em; color: #2c3138; margin: 0 0 8px; }
#sc-end p { font-size: 16px; color: #7a838d; margin: 0 0 28px; }
#sc-end button { pointer-events: auto; font-size: 16px; font-weight: 700; letter-spacing: 0.08em; padding: 12px 36px; border-radius: 10px; border: 1px solid #2c3138; background: #2c3138; color: #fff; cursor: pointer; }
#sc-end button:hover { background: #454c55; }
#sc-shop { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; background: rgba(244,246,248,0.82); backdrop-filter: blur(8px); pointer-events: auto; }
#sc-shop .box { background: rgba(255,255,255,0.96); border: 1px solid #d8dde3; border-radius: 14px; padding: 24px 28px; width: 780px; max-height: 88vh; overflow-y: auto; box-shadow: 0 10px 40px rgba(40,50,60,0.12); color: #2c3138; }
#sc-shopList { display: grid; grid-template-columns: 1fr 1fr; column-gap: 28px; }
#sc-shopForts { display: grid; grid-template-columns: 1fr 1fr; column-gap: 28px; }
#sc-shop h2 { margin: 0; font-size: 26px; font-weight: 800; letter-spacing: 0.06em; }
#sc-shopResult { color: #7a838d; font-size: 13px; margin: 4px 0 10px; min-height: 16px; }
#sc-shopStatus { font-size: 14px; font-weight: 700; margin-bottom: 14px; display: flex; justify-content: space-between; }
#sc-shopStatus span { color: #7a838d; font-weight: 400; }
#sc-shop .srow { display: grid; grid-template-columns: 1fr 42px 92px 56px; align-items: center; gap: 8px; font-size: 13px; padding: 5px 0; border-bottom: 1px solid #eef1f4; }
#sc-shop .srow .own { color: #7a838d; text-align: center; }
#sc-shop .srow .price { text-align: right; color: #4a5158; }
#sc-shop .srow button { font-size: 12px; font-weight: 700; padding: 4px 0; border-radius: 6px; border: 1px solid #2c3138; background: #2c3138; color: #fff; cursor: pointer; }
#sc-shop .srow button:disabled { opacity: 0.25; cursor: default; }
#sc-shop .slabel { font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #7a838d; margin: 12px 0 2px; }
#sc-time { position: fixed; left: 16px; bottom: 240px; box-sizing: border-box; padding: 7px 12px 8px; background: rgba(255,255,255,0.78); backdrop-filter: blur(6px); border: 1px solid #d8dde3; border-radius: 10px; box-shadow: 0 2px 10px rgba(40,50,60,0.08); pointer-events: none; }
#sc-time .tlabel { display: flex; justify-content: space-between; font-size: 10px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #7a838d; margin-bottom: 4px; }
#sc-timeTrack { height: 8px; background: #e8ebef; border-radius: 4px; overflow: hidden; }
#sc-timeFill { height: 100%; width: 0%; border-radius: 4px; background: #e8b84d; }
#sc-cross { position: fixed; left: 50%; top: 50%; width: 6px; height: 6px; margin: -3px 0 0 -3px; border-radius: 50%; background: #fff; box-shadow: 0 0 5px rgba(0,0,0,0.7); display: none; pointer-events: none; }
#sc-nightHint { position: fixed; left: 50%; bottom: 120px; transform: translateX(-50%); font-size: 13px; font-weight: 600; color: #fff; background: rgba(20,26,38,0.82); border: 1px solid #3a4a6b; border-radius: 10px; padding: 10px 18px; display: none; pointer-events: none; text-align: center; }
#sc-shopStart { margin-top: 18px; width: 100%; font-size: 15px; font-weight: 800; letter-spacing: 0.08em; padding: 12px 0; border-radius: 10px; border: 1px solid #2c3138; background: #2c3138; color: #fff; cursor: pointer; }
#sc-shopStart:hover { background: #454c55; }
`

export function createHud(
  parent: HTMLElement,
  handlers: { onWeapon?: (index: number) => void; onWorldToggle?: () => void } = {}
) {
  const style = document.createElement('style')
  style.textContent = CSS
  document.head.appendChild(style)

  const root = document.createElement('div')
  root.id = 'sc-hud'
  root.innerHTML = `
    <div class="panel" id="sc-fortYou"><div class="label">Your Fort</div><div class="bar"><div></div></div><div class="pct">100%</div></div>
    <div class="panel" id="sc-fortFoe"><div class="label">Enemy Fort</div><div class="bar"><div></div></div><div class="pct">100%</div></div>
    <div class="panel" id="sc-wind"><div class="label">Wind</div><span id="sc-windArrow">➤</span><div id="sc-windSpeed"></div></div>
    <div class="panel" id="sc-status"></div>
    <div class="panel" id="sc-nightTurn"></div>
    <div class="panel" id="sc-weapons"><div class="label">Weapon &nbsp;⇥ / click</div><div id="sc-weaponList"></div></div>
    <div class="panel" id="sc-power"><div class="label">Power — hold space, release to fire</div><div id="sc-powerBar"><div class="fill"></div><div id="sc-powerMark"></div></div><div id="sc-powerNum">–</div></div>
    <div class="panel" id="sc-angles"></div>
    <div id="sc-side"><span class="tag">side view</span></div>
    <button id="sc-worldBtn">World View</button>
    <div id="sc-banner"></div>
    <div id="sc-msg"></div>
    <div id="sc-help">←→↑↓ aim &nbsp;·&nbsp; shift = fine &nbsp;·&nbsp; V = world view &nbsp;·&nbsp; tab / 1–9 weapon &nbsp;·&nbsp; space = power &amp; fire</div>
    <div class="panel" id="sc-time"><div class="tlabel"><span id="sc-timeMode">day</span><span>time</span></div><div id="sc-timeTrack"><div id="sc-timeFill"></div></div></div>
    <div id="sc-cross"></div>
    <div id="sc-nightHint">WASD = hop one space (4 per turn) &nbsp;·&nbsp; arrow keys = look &nbsp;·&nbsp; hold SPACE = draw bow, release to shoot (ends turn) &nbsp;·&nbsp; enter = pass</div>
    <div id="sc-end"><h1></h1><p></p><button>REMATCH</button></div>
    <div id="sc-shop"><div class="box">
      <h2>THE ARMORY</h2>
      <div id="sc-shopResult"></div>
      <div id="sc-shopStatus"></div>
      <div class="slabel">Weapons</div>
      <div id="sc-shopList"></div>
      <div class="slabel">Fortifications</div>
      <div id="sc-shopForts"></div>
      <button id="sc-shopStart">START ROUND</button>
    </div></div>
  `
  parent.appendChild(root)

  const q = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T
  const youBar = q<HTMLElement>('#sc-fortYou .bar > div')
  const youPct = q<HTMLElement>('#sc-fortYou .pct')
  const foeBar = q<HTMLElement>('#sc-fortFoe .bar > div')
  const foePct = q<HTMLElement>('#sc-fortFoe .pct')
  const windArrow = q<HTMLElement>('#sc-windArrow')
  const windSpeed = q<HTMLElement>('#sc-windSpeed')
  const statusEl = q<HTMLElement>('#sc-status')
  const nightTurnEl = q<HTMLElement>('#sc-nightTurn')
  const shop = q<HTMLElement>('#sc-shop')
  const shopResult = q<HTMLElement>('#sc-shopResult')
  const shopStatus = q<HTMLElement>('#sc-shopStatus')
  const shopList = q<HTMLElement>('#sc-shopList')
  const shopForts = q<HTMLElement>('#sc-shopForts')
  const shopStart = q<HTMLButtonElement>('#sc-shopStart')
  const weaponList = q<HTMLElement>('#sc-weaponList')
  const powerBar = q<HTMLElement>('#sc-powerBar > div.fill')
  const powerMark = q<HTMLElement>('#sc-powerMark')
  const powerNum = q<HTMLElement>('#sc-powerNum')
  const angles = q<HTMLElement>('#sc-angles')
  const sideEl = q<HTMLElement>('#sc-side')
  const worldBtn = q<HTMLButtonElement>('#sc-worldBtn')
  const weaponsPanel = q<HTMLElement>('#sc-weapons')
  const timeEl = q<HTMLElement>('#sc-time')
  const timeMode = q<HTMLElement>('#sc-timeMode')
  const timeFill = q<HTMLElement>('#sc-timeFill')
  const crossEl = q<HTMLElement>('#sc-cross')
  const hintEl = q<HTMLElement>('#sc-nightHint')
  worldBtn.addEventListener('click', () => handlers.onWorldToggle?.())
  const banner = q<HTMLElement>('#sc-banner')
  const msgEl = q<HTMLElement>('#sc-msg')
  const end = q<HTMLElement>('#sc-end')
  const endTitle = q<HTMLElement>('#sc-end h1')
  const endSub = q<HTMLElement>('#sc-end p')
  const endBtn = q<HTMLButtonElement>('#sc-end button')

  let bannerTimer = 0
  let msgTimer = 0

  weaponList.addEventListener('click', e => {
    const row = (e.target as HTMLElement).closest('.w') as HTMLElement | null
    if (row && row.dataset.i !== undefined) handlers.onWeapon?.(parseInt(row.dataset.i))
  })

  let shopOnBuy: (index: number) => void = () => {}
  let shopOnBuyFort: (index: number) => void = () => {}
  shopList.addEventListener('click', e => {
    const btn = (e.target as HTMLElement).closest('button') as HTMLElement | null
    if (btn && btn.dataset.i !== undefined) shopOnBuy(parseInt(btn.dataset.i))
  })
  shopForts.addEventListener('click', e => {
    const btn = (e.target as HTMLElement).closest('button') as HTMLElement | null
    if (btn && btn.dataset.i !== undefined) shopOnBuyFort(parseInt(btn.dataset.i))
  })

  // Screen-relative wind compass: the arrow always points where the wind
  // pushes ON SCREEN, no matter which way the camera faces (golf-broadcast
  // style). setWind stores the vector; orientWind re-projects it into the
  // current camera frame every frame.
  let windX = 0
  let windZ = 0
  let windScale = 1
  let camFx = 1
  let camFz = 0

  function drawWindArrow(): void {
    // Screen-up = camera forward (horizontal), screen-right = camera right.
    // With y-up, camera right = (-fz, fx). The ➤ glyph points right at 0°,
    // so rotate -90° to make it point up first.
    const rightComp = -camFz * windX + camFx * windZ
    const upComp = camFx * windX + camFz * windZ
    const deg = (Math.atan2(rightComp, upComp) * 180) / Math.PI - 90
    windArrow.style.transform = `rotate(${deg.toFixed(1)}deg) scale(${windScale.toFixed(2)})`
  }

  return {
    setIntegrity(you: number, foe: number) {
      youBar.style.width = `${Math.round(you * 100)}%`
      youPct.textContent = `${Math.round(you * 100)}%`
      foeBar.style.width = `${Math.round(foe * 100)}%`
      foePct.textContent = `${Math.round(foe * 100)}%`
    },
    // Arrow size and color escalate with strength so gales are unmissable.
    setWind(x: number, z: number) {
      windX = x
      windZ = z
      const speed = Math.hypot(x, z)
      windScale = 1 + Math.min(1.2, speed / 9)
      drawWindArrow()
      windArrow.style.color = speed > 9 ? '#c0392b' : speed > 5 ? '#8a5a2b' : '#2c3138'
      windSpeed.style.color = speed > 9 ? '#c0392b' : '#2c3138'
      windSpeed.textContent = speed < 0.3 ? 'calm' : speed > 9 ? `${speed.toFixed(1)} GALE` : speed.toFixed(1)
    },
    // Called each frame with the camera's horizontal forward direction.
    orientWind(fx: number, fz: number) {
      if (fx * fx + fz * fz < 1e-6) return
      const len = Math.hypot(fx, fz)
      camFx = fx / len
      camFz = fz / len
      drawWindArrow()
    },
    setWeapons(rows: WeaponRow[]) {
      weaponList.innerHTML = rows
        .map(r => `<div class="w${r.selected ? ' sel' : ''}${r.ammo <= 0 ? ' empty' : ''}" data-i="${r.idx}"><span>${r.name}</span><span>${Number.isFinite(r.ammo) ? r.ammo : '∞'}</span></div>`)
        .join('')
    },
    // p = live charging power (null when idle); last = previous shot's power, shown
    // as a marker on the bar and as the readout while lining up the next shot.
    setPower(p: number | null, last: number | null = null) {
      if (last !== null) {
        powerMark.style.display = 'block'
        powerMark.style.left = `${last}%`
      } else {
        powerMark.style.display = 'none'
      }
      if (p === null) {
        powerBar.style.width = last !== null ? `${last}%` : '0%'
        powerBar.style.opacity = '0.35'
        powerNum.textContent = last !== null ? `last shot: ${Math.round(last)}` : '–'
      } else {
        powerBar.style.width = `${p}%`
        powerBar.style.opacity = '1'
        powerNum.textContent = `${Math.round(p)}`
      }
    },
    setAngles(azDeg: number, elDeg: number) {
      angles.innerHTML = `<span>bearing</span> ${azDeg.toFixed(1)}°<br><span>elevation</span> ${elDeg.toFixed(1)}°`
    },
    banner(text: string, sub = '', ms = 1600) {
      banner.innerHTML = `${text}${sub ? `<small>${sub}</small>` : ''}`
      banner.style.opacity = '1'
      clearTimeout(bannerTimer)
      bannerTimer = window.setTimeout(() => (banner.style.opacity = '0'), ms)
    },
    msg(text: string, ms = 1400) {
      msgEl.textContent = text
      msgEl.style.opacity = '1'
      clearTimeout(msgTimer)
      msgTimer = window.setTimeout(() => (msgEl.style.opacity = '0'), ms)
    },
    // Frame for the picture-in-picture cannon close-up; the GL inset renders
    // into the on-canvas rectangle this element covers. The World View button
    // shares its lifecycle.
    showSide(visible: boolean) {
      sideEl.style.display = visible ? 'block' : 'none'
      worldBtn.style.display = visible ? 'block' : 'none'
    },
    setWorldView(on: boolean) {
      worldBtn.textContent = on ? 'Aim View' : 'World View'
      worldBtn.classList.toggle('on', on)
    },
    sideRect(): DOMRect {
      return sideEl.getBoundingClientRect()
    },
    // Day/night bar, docked directly above the weapons panel (tracks its size).
    setTime(mode: 'day' | 'sunset' | 'night' | 'dawn', frac: number) {
      const wr = weaponsPanel.getBoundingClientRect()
      timeEl.style.left = `${wr.left}px`
      timeEl.style.width = `${wr.width}px`
      timeEl.style.bottom = `${window.innerHeight - wr.top + 8}px`
      timeMode.textContent = mode
      timeFill.style.width = `${Math.round(frac * 100)}%`
      timeFill.style.background =
        mode === 'day' ? '#e8b84d' : mode === 'sunset' ? '#e8956b' : mode === 'night' ? '#5a6fa8' : '#e8c8a0'
    },
    setNightHint(show: boolean) {
      hintEl.style.display = show ? 'block' : 'none'
    },
    // Whose turn it is at night (null hides the panel).
    setNightTurn(text: string | null) {
      nightTurnEl.style.display = text ? 'block' : 'none'
      if (text) nightTurnEl.textContent = text
    },
    setCross(show: boolean) {
      crossEl.style.display = show ? 'block' : 'none'
    },
    setStatus(round: number, rounds: number, you: number, foe: number, cash: number) {
      statusEl.innerHTML = `<span>round</span> ${round}/${rounds} &nbsp;·&nbsp; <span>score</span> ${you} — ${foe} &nbsp;·&nbsp; <span>cash</span> $${cash.toLocaleString()}`
    },
    showShop(
      data: {
        round: number
        rounds: number
        scoreYou: number
        scoreFoe: number
        money: number
        result: string
        items: { name: string; owned: number; price: number; pack: number }[]
        forts: { name: string; owned: number; price: number; maxed: boolean }[]
      },
      onBuy: (index: number) => void,
      onBuyFort: (index: number) => void,
      onStart: () => void
    ) {
      shopOnBuy = onBuy
      shopOnBuyFort = onBuyFort
      shopResult.textContent = data.result
      shopStatus.innerHTML = `<div><span>round</span> ${data.round}/${data.rounds} &nbsp;·&nbsp; <span>score</span> ${data.scoreYou} — ${data.scoreFoe}</div><div><span>cash</span> $${data.money.toLocaleString()}</div>`
      shopList.innerHTML = data.items
        .map(
          (it, i) =>
            `<div class="srow"><div>${it.name}</div><div class="own">×${it.owned}</div><div class="price">${it.pack} for $${it.price.toLocaleString()}</div><button data-i="${i}" ${data.money < it.price ? 'disabled' : ''}>BUY</button></div>`
        )
        .join('')
      shopForts.innerHTML = data.forts
        .map(
          (it, i) =>
            `<div class="srow"><div>${it.name}</div><div class="own">×${it.owned}</div><div class="price">$${it.price.toLocaleString()}</div><button data-i="${i}" ${it.maxed || data.money < it.price ? 'disabled' : ''}>${it.maxed ? 'MAX' : 'BUY'}</button></div>`
        )
        .join('')
      shopStart.onclick = () => {
        shop.style.display = 'none'
        onStart()
      }
      shop.style.display = 'flex'
    },
    hideShop() {
      shop.style.display = 'none'
    },
    showEnd(title: string, sub: string, onRematch: () => void) {
      endTitle.textContent = title
      endSub.textContent = sub
      end.style.display = 'flex'
      endBtn.onclick = () => {
        end.style.display = 'none'
        onRematch()
      }
    },
  }
}

export type Hud = ReturnType<typeof createHud>
