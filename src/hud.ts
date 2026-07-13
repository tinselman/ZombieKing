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
#sc-windArrow { font-size: 22px; line-height: 1; display: inline-block; transition: transform 0.4s ease; }
#sc-windSpeed { font-size: 13px; font-weight: 600; margin-top: 2px; }
#sc-weapons { position: static; min-width: 170px; pointer-events: auto; }
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
/* Hotseat handoff: gate each human turn behind a "pass the keyboard" screen. */
#sc-handoff { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; flex-direction: column; background: rgba(244,246,248,0.94); backdrop-filter: blur(10px); pointer-events: auto; z-index: 8; }
#sc-handoff h1 { font-size: 52px; font-weight: 800; letter-spacing: 0.05em; color: #2c3138; margin: 0 0 6px; }
#sc-handoff p { font-size: 16px; color: #7a838d; margin: 0 0 26px; }
#sc-handoff button { font-size: 16px; font-weight: 700; letter-spacing: 0.08em; padding: 12px 40px; border-radius: 10px; border: 1px solid #2c3138; background: #2c3138; color: #fff; cursor: pointer; }
#sc-handoff button:hover { background: #454c55; }
/* Mode picker: shown at boot and after each match (Rematch routes back here). */
#sc-mode { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; flex-direction: column; background: rgba(244,246,248,0.94); backdrop-filter: blur(10px); pointer-events: auto; z-index: 8; }
#sc-mode h1 { font-size: 48px; font-weight: 800; letter-spacing: 0.06em; color: #2c3138; margin: 0 0 4px; }
#sc-mode p { font-size: 14px; color: #7a838d; margin: 0 0 30px; letter-spacing: 0.04em; }
#sc-mode .modes { display: flex; gap: 18px; }
#sc-mode .modes button { width: 250px; padding: 22px 18px; border-radius: 14px; border: 1px solid #c4cad1; background: rgba(255,255,255,0.95); color: #2c3138; cursor: pointer; text-align: center; }
#sc-mode .modes button:hover { border-color: #2c3138; background: #fff; transform: translateY(-2px); }
#sc-mode .modes .mt { display: block; font-size: 20px; font-weight: 800; letter-spacing: 0.04em; margin-bottom: 6px; }
#sc-mode .modes .ms { display: block; font-size: 12.5px; color: #7a838d; line-height: 1.45; }
#sc-shop { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; background: rgba(244,246,248,0.82); backdrop-filter: blur(8px); pointer-events: auto; }
#sc-shop .box { background: rgba(255,255,255,0.96); border: 1px solid #d8dde3; border-radius: 14px; padding: 24px 28px; width: 780px; max-height: 88vh; overflow-y: auto; box-shadow: 0 10px 40px rgba(40,50,60,0.12); color: #2c3138; }
#sc-shopList { display: grid; grid-template-columns: 1fr 1fr; column-gap: 28px; }
#sc-shopForts { display: grid; grid-template-columns: 1fr 1fr; column-gap: 28px; }
#sc-shop h2 { margin: 0; font-size: 26px; font-weight: 800; letter-spacing: 0.06em; display: flex; justify-content: space-between; align-items: baseline; }
#sc-shopPlayer { font-size: 14px; font-weight: 800; letter-spacing: 0.1em; color: #d5473a; }
#sc-shopResult { color: #7a838d; font-size: 13px; margin: 4px 0 10px; min-height: 16px; }
#sc-shopStatus { font-size: 14px; font-weight: 700; margin-bottom: 14px; display: flex; justify-content: space-between; }
#sc-shopStatus span { color: #7a838d; font-weight: 400; }
#sc-shop .srow { display: grid; grid-template-columns: 1fr 42px 92px 56px; align-items: center; gap: 8px; font-size: 13px; padding: 5px 0; border-bottom: 1px solid #eef1f4; }
#sc-shop .srow .own { color: #7a838d; text-align: center; }
#sc-shop .srow .price { text-align: right; color: #4a5158; }
#sc-shop .srow button { font-size: 12px; font-weight: 700; padding: 4px 0; border-radius: 6px; border: 1px solid #2c3138; background: #2c3138; color: #fff; cursor: pointer; }
#sc-shop .srow button:disabled { opacity: 0.25; cursor: default; }
#sc-shop .slabel { font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #7a838d; margin: 12px 0 2px; }
#sc-shop .snote { font-size: 12px; color: #9aa1a9; font-style: italic; margin: 10px 0 2px; }
#sc-shopStart { margin-top: 18px; width: 100%; font-size: 15px; font-weight: 800; letter-spacing: 0.08em; padding: 12px 0; border-radius: 10px; border: 1px solid #2c3138; background: #2c3138; color: #fff; cursor: pointer; }
#sc-shopStart:hover { background: #454c55; }
/* Bottom-left stack: the stratagem hand sits directly above the weapon list. */
/* Bottom-left: three stacked lists — Cards (top), Resources, Weapons (bottom).
   The panels must be position:static so they lay out in the flex column (the base
   .panel rule makes them absolute, which is what broke the weapon/card lists). */
#sc-blstack { position: absolute; bottom: 16px; left: 16px; display: flex; flex-direction: column; gap: 10px; align-items: flex-start; }
/* Beats the base "#sc-hud .panel { position:absolute }" rule (equal specificity, later)
   so the three panels lay out in the flex column instead of stacking on one spot. */
#sc-blstack .panel { position: static; }
#sc-hand { position: static; min-width: 170px; pointer-events: auto; display: none; }
#sc-hand.on { display: block; }
#sc-hand .c { font-size: 13px; padding: 3px 6px; border-radius: 5px; display: flex; align-items: center; gap: 8px; color: #4a5158; cursor: pointer; }
#sc-hand .c:hover { background: #e8ebef; }
#sc-hand .c .emoji { font-size: 14px; line-height: 1; }
#sc-hand .c .cn { flex: 1; font-weight: 600; }
#sc-hand .c .go { font-size: 10px; color: #98a1aa; letter-spacing: 0.08em; }
#sc-resources { position: static; min-width: 170px; pointer-events: auto; display: none; }
#sc-resources.on { display: block; }
#sc-resources .r { font-size: 13px; padding: 2px 6px; border-radius: 5px; display: flex; justify-content: space-between; gap: 14px; color: #6c757e; cursor: pointer; }
#sc-resources .r:hover { background: #e8ebef; }
#sc-resources .r .n { color: #4a5158; font-weight: 600; }
#sc-resources .r .ct { color: #7a838d; }
/* Bottom-center setup instructions, shown where the power bar sits during placement. */
#sc-setupMsg { position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%); max-width: 620px; text-align: center; display: none; font-size: 13px; font-weight: 600; color: #2c3138; line-height: 1.5; }
#sc-setupMsg.on { display: block; }
#sc-setupMsg small { display: block; font-weight: 400; color: #7a838d; font-size: 12px; margin-top: 3px; }
#sc-skipped { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; pointer-events: none; z-index: 7; }
#sc-skipped.on { display: flex; }
#sc-skipped span { font-family: Helvetica, Arial, sans-serif; font-size: 72px; font-weight: 800; color: #fff; letter-spacing: 0.03em; text-shadow: 0 3px 24px rgba(20,24,30,0.7); }
/* Big center card with a 3D flip. */
#sc-cardModal { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; background: rgba(20,24,28,0.55); backdrop-filter: blur(3px); pointer-events: auto; z-index: 6; }
#sc-cardModal.on { display: flex; }
#sc-cardModal .stage { perspective: 1500px; display: flex; flex-direction: column; align-items: center; gap: 18px; }
#sc-flip { position: relative; width: 300px; height: 424px; transform-style: preserve-3d; transition: transform 0.55s cubic-bezier(0.2, 0.7, 0.2, 1); cursor: pointer; }
#sc-flip.flipped { transform: rotateY(180deg); }
#sc-flip .face { position: absolute; inset: 0; backface-visibility: hidden; -webkit-backface-visibility: hidden; border-radius: 20px; padding: 30px 26px; box-sizing: border-box; display: flex; flex-direction: column; box-shadow: 0 24px 70px rgba(0,0,0,0.45); border: 1px solid rgba(255,255,255,0.2); }
#sc-flip .front { background: linear-gradient(165deg, #fdfdfd, #e3e8ee); color: #2c3138; align-items: center; text-align: center; }
#sc-flip .front .fname { font-size: 26px; font-weight: 800; letter-spacing: 0.03em; margin-top: 6px; }
#sc-flip .front .femoji { font-size: 128px; line-height: 1.1; margin: auto 0; }
#sc-flip .front .fhint { font-size: 12px; letter-spacing: 0.1em; text-transform: uppercase; color: #9aa1a9; }
#sc-flip .back { transform: rotateY(180deg); background: linear-gradient(165deg, #2c3138, #434b55); color: #eef1f4; }
#sc-flip .back .bname { font-size: 18px; font-weight: 700; letter-spacing: 0.04em; margin-bottom: 14px; color: #fff; }
#sc-flip .back .bdesc { font-size: 18px; line-height: 1.5; font-weight: 300; color: #d3d9df; }
#sc-cardModal .mbtns { display: flex; gap: 12px; }
#sc-cardModal .mbtns button { font-size: 14px; font-weight: 700; letter-spacing: 0.06em; padding: 10px 26px; border-radius: 10px; cursor: pointer; border: 1px solid #2c3138; }
#sc-cardPlay { background: #2c7d3a; border-color: #2c7d3a !important; color: #fff; }
#sc-cardPlay:hover { background: #35953f; }
#sc-cardClose { background: rgba(255,255,255,0.9); color: #2c3138; }
#sc-cardClose:hover { background: #fff; }
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
    <div id="sc-blstack">
      <div class="panel" id="sc-hand"><div class="label">Stratagems &nbsp;· click to view</div><div id="sc-handList"></div></div>
      <div class="panel" id="sc-resources"><div class="label">Resources &nbsp;· click to place</div><div id="sc-resList"></div></div>
      <div class="panel" id="sc-weapons"><div class="label">Weapon &nbsp;⇥ / click</div><div id="sc-weaponList"></div></div>
    </div>
    <div class="panel" id="sc-power"><div class="label">Power — hold space, release to fire</div><div id="sc-powerBar"><div class="fill"></div><div id="sc-powerMark"></div></div><div id="sc-powerNum">–</div></div>
    <div id="sc-setupMsg"></div>
    <div class="panel" id="sc-angles"></div>
    <div id="sc-side"><span class="tag">side view</span></div>
    <button id="sc-worldBtn">World View</button>
    <div id="sc-banner"></div>
    <div id="sc-msg"></div>
    <div id="sc-skipped"><span>You've been SKIPPED!</span></div>
    <div id="sc-cardModal"><div class="stage">
      <div id="sc-flip">
        <div class="face front"><div class="femoji"></div><div class="fname"></div><div class="fhint">tap card to flip</div></div>
        <div class="face back"><div class="bname"></div><div class="bdesc"></div></div>
      </div>
      <div class="mbtns"><button id="sc-cardPlay">Play</button><button id="sc-cardClose">Close</button></div>
    </div></div>
    <div id="sc-help">←→↑↓ aim &nbsp;·&nbsp; shift = fine &nbsp;·&nbsp; V = world view &nbsp;·&nbsp; tab / 1–9 weapon &nbsp;·&nbsp; space = power &amp; fire</div>
    <div id="sc-end"><h1></h1><p></p><button>REMATCH</button></div>
    <div id="sc-handoff"><h1></h1><p>Pass the keyboard — everything on screen is now yours.</p><button>START TURN</button></div>
    <div id="sc-mode"><h1>SCORCHED VOXELS</h1><p>ZOMBIE KING EDITION</p><div class="modes">
      <button id="sc-mode1"><span class="mt">1 PLAYER</span><span class="ms">Battle the computer — it builds, schemes, and shoots back.</span></button>
      <button id="sc-mode2"><span class="mt">2 PLAYERS</span><span class="ms">Hotseat duel — share the keyboard, take turns, last castle standing wins.</span></button>
    </div></div>
    <div id="sc-shop"><div class="box">
      <h2>ZOMBIE KING MARKET<span id="sc-shopPlayer"></span></h2>
      <div id="sc-shopResult"></div>
      <div id="sc-shopStatus"></div>
      <div class="slabel">Stratagem Cards</div>
      <div id="sc-shopCards"></div>
      <div class="slabel">Resources</div>
      <div id="sc-shopRes"></div>
      <div class="slabel">Weapons</div>
      <div id="sc-shopList"></div>
      <div id="sc-shopArms">
        <div class="slabel">Fortifications</div>
        <div id="sc-shopForts"></div>
      </div>
      <div id="sc-shopArmsNote" class="snote">Fortifications restock between rounds — after a castle falls.</div>
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
  const shop = q<HTMLElement>('#sc-shop')
  const shopResult = q<HTMLElement>('#sc-shopResult')
  const shopStatus = q<HTMLElement>('#sc-shopStatus')
  const shopList = q<HTMLElement>('#sc-shopList')
  const shopForts = q<HTMLElement>('#sc-shopForts')
  const shopCards = q<HTMLElement>('#sc-shopCards')
  const shopRes = q<HTMLElement>('#sc-shopRes')
  const shopArms = q<HTMLElement>('#sc-shopArms')
  const shopArmsNote = q<HTMLElement>('#sc-shopArmsNote')
  const shopStart = q<HTMLButtonElement>('#sc-shopStart')
  const weaponList = q<HTMLElement>('#sc-weaponList')
  const powerBar = q<HTMLElement>('#sc-powerBar > div.fill')
  const powerMark = q<HTMLElement>('#sc-powerMark')
  const powerNum = q<HTMLElement>('#sc-powerNum')
  const angles = q<HTMLElement>('#sc-angles')
  const sideEl = q<HTMLElement>('#sc-side')
  const worldBtn = q<HTMLButtonElement>('#sc-worldBtn')
  worldBtn.addEventListener('click', () => handlers.onWorldToggle?.())
  const handEl = q<HTMLElement>('#sc-hand')
  const handList = q<HTMLElement>('#sc-handList')
  const resEl = q<HTMLElement>('#sc-resources')
  const resList = q<HTMLElement>('#sc-resList')
  const powerPanel = q<HTMLElement>('#sc-power')
  const setupMsg = q<HTMLElement>('#sc-setupMsg')
  const cardModal = q<HTMLElement>('#sc-cardModal')
  const flip = q<HTMLElement>('#sc-flip')
  const flipFront = q<HTMLElement>('#sc-flip .front .fname')
  const flipEmoji = q<HTMLElement>('#sc-flip .front .femoji')
  const flipBackName = q<HTMLElement>('#sc-flip .back .bname')
  const flipBackDesc = q<HTMLElement>('#sc-flip .back .bdesc')
  const cardPlay = q<HTMLButtonElement>('#sc-cardPlay')
  const cardClose = q<HTMLButtonElement>('#sc-cardClose')
  const banner = q<HTMLElement>('#sc-banner')
  const msgEl = q<HTMLElement>('#sc-msg')
  const skipped = q<HTMLElement>('#sc-skipped')
  const skippedText = q<HTMLElement>('#sc-skipped span')
  const end = q<HTMLElement>('#sc-end')
  const endTitle = q<HTMLElement>('#sc-end h1')
  const endSub = q<HTMLElement>('#sc-end p')
  const endBtn = q<HTMLButtonElement>('#sc-end button')
  const handoff = q<HTMLElement>('#sc-handoff')
  const handoffTitle = q<HTMLElement>('#sc-handoff h1')
  const handoffBtn = q<HTMLButtonElement>('#sc-handoff button')
  const modeEl = q<HTMLElement>('#sc-mode')
  const mode1 = q<HTMLButtonElement>('#sc-mode1')
  const mode2 = q<HTMLButtonElement>('#sc-mode2')
  const shopPlayer = q<HTMLElement>('#sc-shopPlayer')
  const fortYouLabel = q<HTMLElement>('#sc-fortYou .label')
  const fortFoeLabel = q<HTMLElement>('#sc-fortFoe .label')

  let bannerTimer = 0
  let msgTimer = 0
  let skipTimer = 0

  // The big card flips on click; Close (or a click on the backdrop) dismisses it.
  flip.addEventListener('click', () => flip.classList.toggle('flipped'))
  cardClose.addEventListener('click', () => cardModal.classList.remove('on'))
  cardModal.addEventListener('click', e => {
    if (e.target === cardModal) cardModal.classList.remove('on')
  })

  weaponList.addEventListener('click', e => {
    const row = (e.target as HTMLElement).closest('.w') as HTMLElement | null
    if (row && row.dataset.i !== undefined) handlers.onWeapon?.(parseInt(row.dataset.i))
  })

  let shopOnBuy: (index: number) => void = () => {}
  let shopOnBuyFort: (index: number) => void = () => {}
  let shopOnBuyCard: () => void = () => {}
  let shopOnBuyRes: (index: number) => void = () => {}
  shopList.addEventListener('click', e => {
    const btn = (e.target as HTMLElement).closest('button') as HTMLElement | null
    if (btn && btn.dataset.i !== undefined) shopOnBuy(parseInt(btn.dataset.i))
  })
  shopForts.addEventListener('click', e => {
    const btn = (e.target as HTMLElement).closest('button') as HTMLElement | null
    if (btn && btn.dataset.i !== undefined) shopOnBuyFort(parseInt(btn.dataset.i))
  })
  shopCards.addEventListener('click', e => {
    if ((e.target as HTMLElement).closest('button')) shopOnBuyCard()
  })
  shopRes.addEventListener('click', e => {
    const btn = (e.target as HTMLElement).closest('button') as HTMLElement | null
    if (btn && btn.dataset.i !== undefined) shopOnBuyRes(parseInt(btn.dataset.i))
  })

  // Screen-relative wind compass: the arrow always points where the wind pushes
  // ON SCREEN, no matter which way the camera faces (golf-broadcast style).
  // setWind stores the vector; orientWind re-projects it into the current camera
  // frame every frame.
  let windX = 0
  let windZ = 0
  let windScale = 1
  let camFx = 1
  let camFz = 0

  function drawWindArrow(): void {
    // Screen-up = camera forward (horizontal), screen-right = camera right.
    // With y-up, camera right = (-fz, fx). The ➤ glyph points right at 0°, so
    // rotate -90° to make it point up first.
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
    // `player` (1 or 2) tags the readout with whose numbers these are in hotseat; 0 hides it.
    setStatus(round: number, rounds: number, you: number, foe: number, cash: number, income = 0, player = 0) {
      const inc = income > 0 ? ` &nbsp;·&nbsp; <span>resources</span> +$${income.toLocaleString()}/turn` : ''
      const who = player > 0 ? `<b style="color:#d5473a">P${player}</b> &nbsp;·&nbsp; ` : ''
      statusEl.innerHTML = `${who}<span>round</span> ${round}/${rounds} &nbsp;·&nbsp; <span>score</span> ${you} — ${foe} &nbsp;·&nbsp; <span>cash</span> $${cash.toLocaleString()}${inc}`
    },
    setFortLabels(you: string, foe: string) {
      fortYouLabel.textContent = you
      fortFoeLabel.textContent = foe
    },
    showShop(
      data: {
        round: number
        rounds: number
        scoreYou: number
        scoreFoe: number
        money: number
        result: string
        full: boolean // round-start market shows weapons + fortifications; per-turn hides them
        startLabel: string
        playerLabel: string // "PLAYER 1"/"PLAYER 2" in hotseat; '' hides it
        cardCost: number
        cardHint: string // e.g. "Hand: 2 · one draw per turn" or "already drew this turn"
        canBuyCard: boolean
        resources: { name: string; price: number; queued: number }[]
        items: { name: string; owned: number; price: number; pack: number }[]
        forts: { name: string; owned: number; price: number; maxed: boolean }[]
      },
      handlers: {
        onBuy: (index: number) => void
        onBuyFort: (index: number) => void
        onBuyCard: () => void
        onBuyRes: (index: number) => void
        onStart: () => void
      }
    ) {
      shopOnBuy = handlers.onBuy
      shopOnBuyFort = handlers.onBuyFort
      shopOnBuyCard = handlers.onBuyCard
      shopOnBuyRes = handlers.onBuyRes
      shopPlayer.textContent = data.playerLabel
      shopResult.textContent = data.result
      shopStatus.innerHTML = `<div><span>round</span> ${data.round}/${data.rounds} &nbsp;·&nbsp; <span>score</span> ${data.scoreYou} — ${data.scoreFoe}</div><div><span>cash</span> $${data.money.toLocaleString()}</div>`
      shopCards.innerHTML = `<div class="srow"><div>Draw a stratagem</div><div class="own">${data.cardHint}</div><div class="price">$${data.cardCost.toLocaleString()}</div><button ${data.canBuyCard ? '' : 'disabled'}>DRAW</button></div>`
      shopRes.innerHTML = data.resources
        .map(
          (r, i) =>
            `<div class="srow"><div>${r.name}</div><div class="own">${r.queued ? '+' + r.queued : ''}</div><div class="price">$${r.price.toLocaleString()}</div><button data-i="${i}" ${data.money < r.price ? 'disabled' : ''}>BUY</button></div>`
        )
        .join('')
      shopArms.style.display = data.full ? 'block' : 'none'
      shopArmsNote.style.display = data.full ? 'none' : 'block'
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
      shopStart.textContent = data.startLabel
      shopStart.onclick = () => {
        shop.style.display = 'none'
        handlers.onStart()
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
    // Render the stratagem hand as a compact list above the weapons. Clicking a card
    // opens the big flip modal; playing is done from there (onPlay).
    setHand(
      cards: { id: string; name: string; blurb: string; emoji: string }[],
      opts: { onPlay: (i: number) => void }
    ) {
      handEl.classList.toggle('on', cards.length > 0)
      handList.innerHTML = cards
        .map(
          (c, i) =>
            `<div class="c" data-i="${i}"><span class="emoji">${c.emoji}</span><span class="cn">${c.name}</span><span class="go">view ▸</span></div>`
        )
        .join('')
      handList.querySelectorAll('.c').forEach(el => {
        el.addEventListener('click', () => {
          const i = parseInt((el as HTMLElement).dataset.i!)
          const c = cards[i]
          flip.classList.remove('flipped')
          flipEmoji.textContent = c.emoji
          flipFront.textContent = c.name
          flipBackName.textContent = c.name
          flipBackDesc.textContent = c.blurb
          cardPlay.onclick = () => {
            cardModal.classList.remove('on')
            opts.onPlay(i)
          }
          cardModal.classList.add('on')
        })
      })
    },
    // The hand list is a persistent readout — always visible whenever you hold cards,
    // so a freshly drawn card always shows. (The market overlay covers it anyway.)
    showCards(_visible: boolean) {
      handEl.classList.toggle('on', handList.children.length > 0)
    },
    // Resources list: your UNPLACED units by type. Click one to place it on the map.
    // Hidden when you have nothing to place.
    setResources(rows: { type: number; name: string; count: number }[], opts: { onSelect: (type: number) => void }) {
      resEl.classList.toggle('on', rows.length > 0)
      resList.innerHTML = rows
        .map(r => `<div class="r" data-t="${r.type}"><span class="n">${r.name}</span><span class="ct">×${r.count} place ▸</span></div>`)
        .join('')
      resList.querySelectorAll('.r').forEach(el =>
        el.addEventListener('click', () => opts.onSelect(parseInt((el as HTMLElement).dataset.t!)))
      )
    },
    // Bottom-centre setup instructions during placement steps. Passing text hides the
    // power/fire bar (you're not firing yet); passing '' restores it.
    setSetupHint(text: string, sub = '') {
      if (text) {
        setupMsg.innerHTML = `${text}${sub ? `<small>${sub}</small>` : ''}`
        setupMsg.classList.add('on')
        powerPanel.style.display = 'none'
      } else {
        setupMsg.classList.remove('on')
        powerPanel.style.display = ''
      }
    },
    // Big white "You've been SKIPPED!" for three seconds (Skip Player card on you).
    showSkipped(text = "You've been SKIPPED!") {
      skippedText.textContent = text
      skipped.classList.add('on')
      clearTimeout(skipTimer)
      skipTimer = window.setTimeout(() => skipped.classList.remove('on'), 3000)
    },
    // Hotseat turn gate: names the player, waits for a click, then starts their turn.
    showHandoff(player: number, onReady: () => void) {
      handoffTitle.textContent = `PLAYER ${player} — YOUR TURN`
      handoff.style.display = 'flex'
      handoffBtn.onclick = () => {
        handoff.style.display = 'none'
        onReady()
      }
    },
    // Boot / rematch mode picker: resolves with true for 2-player hotseat.
    showModePicker(onPick: (twoPlayer: boolean) => void) {
      modeEl.style.display = 'flex'
      const pick = (two: boolean) => {
        modeEl.style.display = 'none'
        onPick(two)
      }
      mode1.onclick = () => pick(false)
      mode2.onclick = () => pick(true)
    },
  }
}

export type Hud = ReturnType<typeof createHud>
