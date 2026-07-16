// Scorched Earth 3D — DOM heads-up display: integrity bars, wind, weapons, power, banners.

import { COUNTRIES, flagOf, type Country } from './countries'
import { WORLD_MAP_SVG } from './countryinfo'

export type WeaponRow = { idx: number; name: string; ammo: number; selected: boolean }

const CSS = `
#sc-hud { position: fixed; inset: 0; pointer-events: none; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; color: #2c3138; user-select: none; }
#sc-hud .panel { position: absolute; background: rgba(255,255,255,0.78); backdrop-filter: blur(6px); border: 1px solid #d8dde3; border-radius: 10px; padding: 10px 14px; box-shadow: 0 2px 10px rgba(40,50,60,0.08); }
#sc-hud .label { font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #7a838d; margin-bottom: 5px; }
/* Up to four fort bars, one per seat, tucked into the screen corners (top-left/right,
   then a second row below for seats 3–4) and tinted to match each player's castle. */
#sc-fort0 { top: 16px; left: 16px; width: 190px; }
#sc-fort1 { top: 16px; right: 16px; width: 190px; }
#sc-fort2 { top: 84px; left: 16px; width: 190px; }
#sc-fort3 { top: 84px; right: 16px; width: 190px; }
#sc-hud .bar { height: 10px; background: #e8ebef; border-radius: 5px; overflow: hidden; }
#sc-hud .bar > div { height: 100%; border-radius: 5px; transition: width 0.5s ease; }
#sc-fort0 .bar > div { background: #d5473a; }
#sc-fort1 .bar > div { background: #3a7bd5; }
#sc-fort2 .bar > div { background: #3a9d4a; }
#sc-fort3 .bar > div { background: #d6a72f; }
#sc-fort0.dead, #sc-fort1.dead, #sc-fort2.dead, #sc-fort3.dead { opacity: 0.4; }
/* Bitter Truth: a fort bar opens the country-info panel. Signal it's clickable. */
#sc-hud .panel.fort.info { transition: border-color 0.15s, box-shadow 0.15s; }
#sc-hud .panel.fort.info::after { content: 'ⓘ'; position: absolute; top: 6px; right: 10px; font-size: 12px; font-weight: 700; color: #7a838d; }
#sc-hud .panel.fort.info:hover { border-color: #2c3138; box-shadow: 0 3px 14px rgba(40,50,60,0.18); }
#sc-hud .panel.fort.info:hover::after { color: #2c3138; }
#sc-hud .fort.turn { outline: 2px solid #16181b; }
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
/* Resource wheels — a centered modal: two bright discs spin under a fixed pointer and settle. */
#sc-wheels { position: fixed; inset: 0; display: none; flex-direction: column; align-items: center; justify-content: center; gap: 22px; background: rgba(18,22,28,0.55); backdrop-filter: blur(3px); pointer-events: auto; z-index: 12; }
#sc-wheels .wcap { font-size: 22px; font-weight: 800; letter-spacing: 0.04em; color: #fff; text-shadow: 0 2px 12px rgba(0,0,0,0.5); text-align: center; max-width: 80vw; }
#sc-wheels .wrow { display: flex; gap: 56px; }
#sc-wheels .wwrap { position: relative; width: 176px; height: 194px; }
#sc-wheels .wptr { position: absolute; top: 0; left: 50%; transform: translateX(-50%); width: 0; height: 0; border-left: 13px solid transparent; border-right: 13px solid transparent; border-top: 22px solid #ffef5a; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5)); z-index: 2; }
#sc-wheels .wdisc { position: absolute; top: 16px; left: 0; width: 176px; height: 176px; border-radius: 50%; background: conic-gradient(#ff5a5a,#ffd24a,#4ad07a,#4aa3ff,#c06aff,#ff5a5a,#ff5a5a); box-shadow: 0 10px 34px rgba(0,0,0,0.45), inset 0 0 0 8px #fff, inset 0 0 0 10px #2c3138; }
#sc-wheels .wdisc .face { position: absolute; top: 50%; left: 50%; width: 42px; height: 42px; margin: -21px 0 0 -21px; display: flex; align-items: center; justify-content: center; font-size: 30px; }
#sc-wheels .whint { font-size: 15px; font-weight: 700; letter-spacing: 0.08em; color: #ffef5a; text-shadow: 0 2px 8px rgba(0,0,0,0.5); min-height: 20px; }
/* Country info panel (Bitter Truth): click a fort bar for real-world stats + a locator map. */
#sc-cinfo { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; background: rgba(18,22,28,0.55); backdrop-filter: blur(3px); pointer-events: auto; z-index: 12; }
#sc-cinfo .cbox { width: 460px; max-width: 92vw; background: #fff; border-radius: 16px; padding: 22px; box-shadow: 0 16px 44px rgba(0,0,0,0.35); }
#sc-cinfo .chead { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
#sc-cinfo .cflag { font-size: 40px; line-height: 1; }
#sc-cinfo .cname { font-size: 26px; font-weight: 800; color: #16181b; }
#sc-cinfo .cmap { position: relative; width: 100%; aspect-ratio: 2 / 1; background: #c3c9cf; border-radius: 10px; overflow: hidden; margin-bottom: 14px; }
#sc-cinfo .cmapinner { position: absolute; inset: 0; }
#sc-cinfo .cmapinner svg { width: 100%; height: 100%; display: block; }
#sc-cinfo .cpin { position: absolute; width: 14px; height: 14px; margin: -13px 0 0 -7px; border-radius: 50% 50% 50% 0; background: #e63232; transform: rotate(-45deg); box-shadow: 0 2px 5px rgba(0,0,0,0.4); }
#sc-cinfo .cpin::after { content: ''; position: absolute; top: 4px; left: 4px; width: 6px; height: 6px; border-radius: 50%; background: #fff; }
#sc-cinfo .cstats { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 18px; margin-bottom: 16px; }
#sc-cinfo .crow { display: flex; flex-direction: column; padding: 8px 0; border-bottom: 1px solid #eef1f4; }
#sc-cinfo .crow span { font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: #7a838d; }
#sc-cinfo .crow b { font-size: 17px; color: #16181b; }
#sc-cinfo .cclose { width: 100%; font-size: 14px; font-weight: 800; letter-spacing: 0.08em; padding: 11px; border-radius: 10px; border: 1px solid #2c3138; background: #2c3138; color: #fff; cursor: pointer; }
#sc-cinfo .cclose:hover { background: #454c55; }
/* Post-roll payout: who earned what from the resource wheels. Stays until dismissed. */
#sc-payout { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; background: rgba(18,22,28,0.5); backdrop-filter: blur(3px); pointer-events: auto; cursor: pointer; z-index: 13; }
#sc-payout .pbox { width: 440px; max-width: 92vw; background: #fff; border-radius: 16px; padding: 20px 22px; box-shadow: 0 16px 44px rgba(0,0,0,0.35); animation: sc-pop 0.16s ease-out; }
@keyframes sc-pop { from { transform: scale(0.94); opacity: 0.4; } to { transform: scale(1); opacity: 1; } }
#sc-payout .pcap { font-size: 20px; font-weight: 800; color: #16181b; text-align: center; margin-bottom: 14px; letter-spacing: 0.02em; }
#sc-payout .prows { display: flex; flex-direction: column; gap: 8px; }
#sc-payout .prow { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 9px 12px; background: #f5f7f9; border-left: 5px solid #999; border-radius: 8px; }
#sc-payout .pname { font-size: 15px; font-weight: 800; color: #16181b; }
#sc-payout .pitems { font-size: 13px; color: #5a636d; margin-top: 2px; }
#sc-payout .pnote { color: #b0402c; font-weight: 700; }
#sc-payout .pamt { font-size: 18px; font-weight: 800; color: #2f8f43; white-space: nowrap; }
#sc-payout .pempty { text-align: center; color: #7a838d; font-size: 15px; padding: 10px 0; }
#sc-payout .pspecial { margin-top: 12px; padding: 9px 12px; background: #fff6e0; border-radius: 8px; font-size: 13px; font-weight: 700; color: #8a6a1a; text-align: center; }
#sc-payout .phint { margin-top: 14px; text-align: center; font-size: 12px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #a2abb4; min-height: 14px; }
#sc-banner small { display: block; font-size: 15px; font-weight: 500; letter-spacing: 0.1em; color: #7a838d; margin-top: 6px; }
/* Round-over celebration banner, shown over the wreckage when a castle bursts. */
#sc-roundover { position: absolute; top: 15%; left: 0; right: 0; text-align: center; opacity: 0; transition: opacity 0.4s ease; pointer-events: none; }
#sc-roundover .l1 { font-size: 32px; font-weight: 800; letter-spacing: 0.18em; color: #2c3138; text-shadow: 0 2px 14px rgba(255,255,255,0.95); }
#sc-roundover .l2 { font-size: 62px; font-weight: 900; letter-spacing: 0.03em; margin-top: 8px; text-shadow: 0 3px 20px rgba(255,255,255,0.9); animation: sc-pop 0.5s cubic-bezier(0.2,1.4,0.5,1) both; }
@keyframes sc-pop { from { transform: scale(0.6); opacity: 0; } to { transform: scale(1); opacity: 1; } }
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
/* Mode picker / title screen: shown at boot and after each match (Rematch routes
   back here). Old-English blackletter title, black on white, no glow — with a
   single small white voxel turning slowly above the name. */
#sc-mode { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; flex-direction: column; background: #fff; pointer-events: auto; z-index: 8; }
#sc-mode .voxwrap { perspective: 700px; margin-bottom: 30px; }
#sc-mode .vox { width: 42px; height: 42px; position: relative; transform-style: preserve-3d; animation: sc-voxspin 11s linear infinite; }
#sc-mode .vox i { position: absolute; inset: 0; border: 1px solid #d8dde3; }
#sc-mode .vox i:nth-child(1) { background: #fdfdfe; transform: rotateY(0deg) translateZ(21px); }
#sc-mode .vox i:nth-child(2) { background: #eef1f4; transform: rotateY(90deg) translateZ(21px); }
#sc-mode .vox i:nth-child(3) { background: #f6f8fa; transform: rotateY(180deg) translateZ(21px); }
#sc-mode .vox i:nth-child(4) { background: #e7ebef; transform: rotateY(270deg) translateZ(21px); }
#sc-mode .vox i:nth-child(5) { background: #ffffff; transform: rotateX(90deg) translateZ(21px); }
#sc-mode .vox i:nth-child(6) { background: #e2e6ea; transform: rotateX(-90deg) translateZ(21px); }
@keyframes sc-voxspin { from { transform: rotateX(-22deg) rotateY(0deg); } to { transform: rotateX(-22deg) rotateY(360deg); } }
#sc-mode h1 { font-family: 'Pirata One', 'Old English Text MT', 'Luminari', fantasy, serif; font-weight: 400; color: #16181b; text-align: center; margin: 0 0 18px; line-height: 1.02; }
#sc-mode h1 .rt { display: block; font-size: 38px; letter-spacing: 0.02em; }
#sc-mode h1 .zk { display: block; font-size: 92px; letter-spacing: 0.01em; }
#sc-mode p { font-size: 13px; color: #6c757e; margin: 0 0 34px; letter-spacing: 0.05em; text-align: center; max-width: 560px; line-height: 1.5; }
#sc-mode p b { color: #16181b; letter-spacing: 0.1em; }
#sc-mode .modes { display: flex; flex-wrap: wrap; gap: 14px; justify-content: center; max-width: 540px; }
#sc-mode .modes button { width: 250px; padding: 18px 16px; border-radius: 14px; border: 1px solid #c4cad1; background: #fff; color: #2c3138; cursor: pointer; text-align: center; }
#sc-mode .modes button:hover { border-color: #16181b; transform: translateY(-2px); box-shadow: 0 6px 18px rgba(40,50,60,0.12); }
#sc-mode .modes .mt { display: block; font-size: 19px; font-weight: 800; letter-spacing: 0.04em; margin-bottom: 5px; color: #16181b; }
#sc-mode .modes .ms { display: block; font-size: 12px; color: #7a838d; line-height: 1.4; }
/* Game-mode picker (Fun Time vs Bitter Truth), shown right after the player count. */
#sc-gamemode { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; flex-direction: column; background: #fff; pointer-events: auto; z-index: 9; }
#sc-gamemode h1 { font-size: 30px; font-weight: 800; letter-spacing: 0.06em; color: #16181b; margin: 0 0 26px; }
#sc-gamemode .modes { display: flex; flex-wrap: wrap; gap: 14px; justify-content: center; max-width: 560px; }
#sc-gamemode .modes button { width: 264px; padding: 22px 18px; border-radius: 14px; border: 1px solid #c4cad1; background: #fff; color: #2c3138; cursor: pointer; text-align: center; }
#sc-gamemode .modes button:hover { border-color: #16181b; transform: translateY(-2px); box-shadow: 0 6px 18px rgba(40,50,60,0.12); }
#sc-gamemode .modes .mt { display: block; font-size: 18px; font-weight: 800; letter-spacing: 0.03em; margin-bottom: 7px; color: #16181b; }
#sc-gamemode .modes .ms { display: block; font-size: 12px; color: #7a838d; line-height: 1.45; }
#sc-gamemode .modes #sc-gmHard:hover { border-color: #a4331f; box-shadow: 0 6px 18px rgba(150,40,30,0.16); }
/* Seat setup (3–4 players): a Human/Computer toggle per seat. */
#sc-seats { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; flex-direction: column; background: #fff; pointer-events: auto; z-index: 9; }
#sc-seats h1 { font-size: 30px; font-weight: 800; letter-spacing: 0.04em; color: #16181b; margin: 0 0 4px; }
#sc-seats p { font-size: 13px; color: #7a838d; margin: 0 0 22px; }
#sc-seatRows { display: flex; flex-direction: column; gap: 10px; }
#sc-seatRows button { width: 320px; padding: 14px 18px; border-radius: 11px; border: 1px solid #c4cad1; background: #fff; cursor: pointer; font-size: 16px; font-weight: 700; display: flex; justify-content: space-between; align-items: center; }
#sc-seatRows button:hover { border-color: #16181b; }
#sc-seatRows .who { font-weight: 800; letter-spacing: 0.06em; }
#sc-seatRows .who.human { color: #d5473a; }
#sc-seatRows .who.cpu { color: #3a7bd5; }
#sc-seatsStart { margin-top: 22px; font-size: 15px; font-weight: 800; letter-spacing: 0.08em; padding: 12px 40px; border-radius: 10px; border: 1px solid #2c3138; background: #2c3138; color: #fff; cursor: pointer; }
#sc-seatsStart:hover { background: #454c55; }
/* Target picker: choose which opponent a hostile card hits (3–4 players). */
#sc-target { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; flex-direction: column; background: rgba(244,246,248,0.9); backdrop-filter: blur(8px); pointer-events: auto; z-index: 10; }
#sc-target h1 { font-size: 24px; font-weight: 800; letter-spacing: 0.03em; color: #16181b; margin: 0 0 18px; text-align: center; max-width: 560px; line-height: 1.35; }
#sc-targetRows { display: flex; flex-direction: column; gap: 10px; }
#sc-targetRows button { width: 340px; padding: 14px 18px; border-radius: 11px; border: 1px solid #c4cad1; background: #fff; cursor: pointer; font-size: 16px; text-align: left; display: flex; justify-content: space-between; align-items: center; }
#sc-targetRows button:hover { border-color: #16181b; background: #f6f8fa; }
/* Trade: a button above the bottom-left stack + a table-style give/receive overlay. */
#sc-tradeBtn { display: none; pointer-events: auto; align-self: flex-start; font-size: 13px; font-weight: 800; letter-spacing: 0.06em; padding: 9px 16px; border-radius: 10px; border: 1px solid #2c3138; background: #2c3138; color: #fff; cursor: pointer; }
#sc-tradeBtn.on { display: block; }
#sc-tradeBtn:hover { background: #454c55; }
#sc-surrenderBtn { display: none; pointer-events: auto; align-self: flex-start; font-size: 13px; font-weight: 800; letter-spacing: 0.06em; padding: 9px 16px; border-radius: 10px; border: 1px solid #8a3120; background: #8a3120; color: #fff; cursor: pointer; }
#sc-surrenderBtn.on { display: block; }
#sc-surrenderBtn:hover { background: #a4331f; }
#sc-trade { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; flex-direction: column; gap: 14px; background: rgba(244,246,248,0.92); backdrop-filter: blur(8px); pointer-events: auto; z-index: 11; }
#sc-trade h1 { font-size: 22px; font-weight: 800; letter-spacing: 0.03em; color: #16181b; margin: 0 0 2px; text-align: center; }
#sc-trade .tsub { font-size: 13px; color: #7a838d; margin: 0 0 8px; text-align: center; }
#sc-trade .tsub:empty { display: none; }
#sc-trade .them, #sc-trade .you, #sc-trade .bundle { width: 640px; max-width: 92vw; background: rgba(255,255,255,0.96); border: 1px solid #d8dde3; border-radius: 12px; padding: 14px 18px; }
#sc-trade .bundle { border-color: #b8c0c8; background: rgba(248,250,252,0.98); }
#sc-trade .tlabel { font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #7a838d; margin-bottom: 9px; }
#sc-trade .items { display: flex; flex-wrap: wrap; gap: 8px; min-height: 30px; }
#sc-trade .items .chip { display: inline-flex; align-items: center; gap: 6px; padding: 7px 11px; border-radius: 9px; border: 1px solid #e2e6ea; background: #fff; font-size: 13px; color: #2c3138; }
#sc-trade .you .chip, #sc-trade .bundle .chip { cursor: pointer; border-color: #c4cad1; }
#sc-trade .you .chip:hover, #sc-trade .bundle .chip:hover { border-color: #16181b; background: #f6f8fa; transform: translateY(-1px); }
#sc-trade .bundle .chip { border-color: #2c3138; background: #eef1f4; font-weight: 700; }
#sc-trade .bundle .chip::after { content: '✕'; font-size: 11px; color: #9aa1a9; margin-left: 2px; }
#sc-trade .them .chip { background: #f2f4f7; color: #7a838d; }
#sc-trade .empty { font-size: 13px; color: #9aa1a9; font-style: italic; }
#sc-tradeBtns { display: flex; gap: 12px; margin-top: 2px; }
#sc-tradeBtns button { font-size: 14px; font-weight: 800; letter-spacing: 0.08em; padding: 11px 30px; border-radius: 10px; border: 1px solid #2c3138; cursor: pointer; }
#sc-tradePrimary { background: #2c3138; color: #fff; }
#sc-tradePrimary:hover { background: #454c55; }
#sc-tradeSecondary { background: #fff; color: #2c3138; }
#sc-tradeSecondary:hover { background: #eef1f4; }
/* Country picker — pick a nation + flag before the match (cosmetic identity). */
#sc-country { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; flex-direction: column; background: #fff; pointer-events: auto; z-index: 9; }
#sc-country h1 { font-size: 30px; font-weight: 800; letter-spacing: 0.04em; color: #16181b; margin: 0 0 4px; text-align: center; }
#sc-country h1 .flag { font-size: 34px; vertical-align: -3px; }
#sc-country p { font-size: 13px; color: #7a838d; margin: 0 0 16px; letter-spacing: 0.04em; }
#sc-country input { width: 420px; max-width: 80vw; padding: 11px 16px; font-size: 15px; border: 1px solid #c4cad1; border-radius: 10px; outline: none; margin-bottom: 14px; }
#sc-country input:focus { border-color: #16181b; }
#sc-countryGrid { width: 640px; max-width: 92vw; height: 52vh; overflow-y: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); grid-auto-rows: min-content; align-content: start; gap: 6px; padding: 4px; }
#sc-countryGrid button { display: flex; align-items: center; gap: 9px; padding: 8px 10px; border: 1px solid #e2e6ea; border-radius: 9px; background: #fff; color: #2c3138; cursor: pointer; font-size: 13px; text-align: left; }
#sc-countryGrid button:hover { border-color: #16181b; background: #f6f8fa; }
#sc-countryGrid button .flag { font-size: 22px; line-height: 1; }
#sc-countryGrid button .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#sc-country .rand { margin-top: 14px; font-size: 13px; font-weight: 700; letter-spacing: 0.06em; padding: 9px 22px; border-radius: 9px; border: 1px solid #c4cad1; background: #fff; color: #2c3138; cursor: pointer; }
#sc-country .rand:hover { border-color: #16181b; }
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
    <div class="panel fort" id="sc-fort0"><div class="label">Your Fort</div><div class="bar"><div></div></div><div class="pct">100%</div></div>
    <div class="panel fort" id="sc-fort1"><div class="label">Enemy Fort</div><div class="bar"><div></div></div><div class="pct">100%</div></div>
    <div class="panel fort" id="sc-fort2" style="display:none"><div class="label">Player 3</div><div class="bar"><div></div></div><div class="pct">100%</div></div>
    <div class="panel fort" id="sc-fort3" style="display:none"><div class="label">Player 4</div><div class="bar"><div></div></div><div class="pct">100%</div></div>
    <div class="panel" id="sc-wind"><div class="label">Wind</div><span id="sc-windArrow">➤</span><div id="sc-windSpeed"></div></div>
    <div class="panel" id="sc-status"></div>
    <div id="sc-blstack">
      <button id="sc-surrenderBtn">🏳️ SURRENDER</button>
      <button id="sc-tradeBtn">🤝 OFFER TRADE</button>
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
    <div id="sc-wheels"><div class="wcap"></div>
      <div class="wrow">
        <div class="wwrap"><div class="wptr"></div><div class="wdisc" id="sc-discA"></div></div>
        <div class="wwrap"><div class="wptr"></div><div class="wdisc" id="sc-discB"></div></div>
      </div>
      <div class="whint"></div></div>
    <div id="sc-cinfo"><div class="cbox">
      <div class="chead"><span class="cflag"></span><span class="cname"></span></div>
      <div class="cmap"><div class="cmapinner"></div><div class="cpin"></div></div>
      <div class="cstats"></div>
      <button class="cclose">CLOSE</button>
    </div></div>
    <div id="sc-payout"><div class="pbox">
      <div class="pcap"></div>
      <div class="prows"></div>
      <div class="pspecial"></div>
      <div class="phint"></div>
    </div></div>
    <div id="sc-roundover"></div>
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
    <div id="sc-mode"><div class="voxwrap"><div class="vox"><i></i><i></i><i></i><i></i><i></i><i></i></div></div>
    <h1><span class="zk">Voxel Wars</span></h1>
    <p><b>WARNING:</b> This game includes massive violence, death, destruction, and war. Play at your own risk.</p>
    <div class="modes">
      <button id="sc-mode1"><span class="mt">1 PLAYER</span><span class="ms">Battle the computer — it builds, schemes, and shoots back.</span></button>
      <button id="sc-mode2"><span class="mt">2 PLAYERS</span><span class="ms">Hotseat duel — share the keyboard, last castle standing wins.</span></button>
      <button id="sc-mode3"><span class="mt">3 PLAYERS</span><span class="ms">Three-corner free-for-all — humans and computers, informal alliances.</span></button>
      <button id="sc-mode4"><span class="mt">4 PLAYERS</span><span class="ms">Four-corner war — mix humans and computers, everyone for themselves.</span></button>
    </div></div>
    <div id="sc-gamemode"><h1>CHOOSE YOUR REALITY</h1>
      <div class="modes">
        <button id="sc-gmFun"><span class="mt">🎉 Just Having a Fun Time</span><span class="ms">The game as you know it — every nation starts equal and fights it out.</span></button>
        <button id="sc-gmHard"><span class="mt">💀 The Bitter Truth</span><span class="ms">Real economies set your starting cash; real militaries set the girth of your fortress. Giants loom over the weak — surrender, or be crushed.</span></button>
      </div></div>
    <div id="sc-seats"><h1>Set up the seats</h1><p>Tap each seat to switch between Human and Computer.</p>
      <div id="sc-seatRows"></div>
      <button id="sc-seatsStart">START WAR</button></div>
    <div id="sc-country"><h1></h1><p>Choose your nation — for honour, for glory, for the flag.</p>
      <input id="sc-countrySearch" type="text" placeholder="Search countries…" autocomplete="off" />
      <div id="sc-countryGrid"></div>
      <button class="rand">🎲 SURPRISE ME</button></div>
    <div id="sc-target"><h1></h1><div id="sc-targetRows"></div></div>
    <div id="sc-trade"><h1></h1><div id="sc-tradeSub" class="tsub"></div>
      <div class="them" id="sc-tradeThemBlock"><div class="tlabel">THEY HOLD</div><div id="sc-tradeThem" class="items"></div></div>
      <div class="you" id="sc-tradePoolBlock"><div class="tlabel" id="sc-tradePoolLabel">YOUR ITEMS</div><div id="sc-tradeMine" class="items"></div></div>
      <div class="bundle" id="sc-tradeBundleBlock"><div class="tlabel" id="sc-tradeBundleLabel">OFFERING</div><div id="sc-tradeBundle" class="items"></div></div>
      <div id="sc-tradeBtns"><button id="sc-tradeSecondary"></button><button id="sc-tradePrimary"></button></div></div>
    <div id="sc-shop"><div class="box">
      <h2>VOXEL WARS MARKET<span id="sc-shopPlayer"></span></h2>
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
  const fortPanels = [0, 1, 2, 3].map(i => q<HTMLElement>(`#sc-fort${i}`))
  const fortBars = fortPanels.map(p => p.querySelector('.bar > div') as HTMLElement)
  const fortPcts = fortPanels.map(p => p.querySelector('.pct') as HTMLElement)
  const fortLabels = fortPanels.map(p => p.querySelector('.label') as HTMLElement)
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
  const wheelsEl = q<HTMLElement>('#sc-wheels')
  const wheelCap = q<HTMLElement>('#sc-wheels .wcap')
  const wheelHint = q<HTMLElement>('#sc-wheels .whint')
  const wheelADisc = q<HTMLElement>('#sc-discA')
  const wheelBDisc = q<HTMLElement>('#sc-discB')
  const cinfoEl = q<HTMLElement>('#sc-cinfo')
  const cinfoFlag = q<HTMLElement>('#sc-cinfo .cflag')
  const cinfoName = q<HTMLElement>('#sc-cinfo .cname')
  const cinfoMap = q<HTMLElement>('#sc-cinfo .cmapinner')
  const cinfoPin = q<HTMLElement>('#sc-cinfo .cpin')
  const cinfoStats = q<HTMLElement>('#sc-cinfo .cstats')
  const cinfoClose = q<HTMLButtonElement>('#sc-cinfo .cclose')
  const payoutEl = q<HTMLElement>('#sc-payout')
  const payoutCap = q<HTMLElement>('#sc-payout .pcap')
  const payoutRows = q<HTMLElement>('#sc-payout .prows')
  const payoutSpecial = q<HTMLElement>('#sc-payout .pspecial')
  const payoutHint = q<HTMLElement>('#sc-payout .phint')
  const roundoverEl = q<HTMLElement>('#sc-roundover')
  let roundoverTimer = 0
  const msgEl = q<HTMLElement>('#sc-msg')
  const skipped = q<HTMLElement>('#sc-skipped')
  const skippedText = q<HTMLElement>('#sc-skipped span')
  const end = q<HTMLElement>('#sc-end')
  const endTitle = q<HTMLElement>('#sc-end h1')
  const endSub = q<HTMLElement>('#sc-end p')
  const endBtn = q<HTMLButtonElement>('#sc-end button')
  const handoff = q<HTMLElement>('#sc-handoff')
  const handoffTitle = q<HTMLElement>('#sc-handoff h1')
  const handoffSub = q<HTMLElement>('#sc-handoff p')
  const handoffBtn = q<HTMLButtonElement>('#sc-handoff button')
  const modeEl = q<HTMLElement>('#sc-mode')
  const modeBtns = [1, 2, 3, 4].map(i => q<HTMLButtonElement>(`#sc-mode${i}`))
  const gamemodeEl = q<HTMLElement>('#sc-gamemode')
  const gmFun = q<HTMLButtonElement>('#sc-gmFun')
  const gmHard = q<HTMLButtonElement>('#sc-gmHard')
  const seatsEl = q<HTMLElement>('#sc-seats')
  const seatRows = q<HTMLElement>('#sc-seatRows')
  const seatsStart = q<HTMLButtonElement>('#sc-seatsStart')
  const targetEl = q<HTMLElement>('#sc-target')
  const targetTitle = q<HTMLElement>('#sc-target h1')
  const targetRows = q<HTMLElement>('#sc-targetRows')
  const tradeBtn = q<HTMLButtonElement>('#sc-tradeBtn')
  const surrenderBtn = q<HTMLButtonElement>('#sc-surrenderBtn')
  const tradeEl = q<HTMLElement>('#sc-trade')
  const tradeTitle = q<HTMLElement>('#sc-trade h1')
  const tradeSub = q<HTMLElement>('#sc-tradeSub')
  const tradeThemBlock = q<HTMLElement>('#sc-tradeThemBlock')
  const tradeThemLabel = q<HTMLElement>('#sc-tradeThemBlock .tlabel')
  const tradeThem = q<HTMLElement>('#sc-tradeThem')
  const tradePoolBlock = q<HTMLElement>('#sc-tradePoolBlock')
  const tradePoolLabel = q<HTMLElement>('#sc-tradePoolLabel')
  const tradeMine = q<HTMLElement>('#sc-tradeMine')
  const tradeBundleBlock = q<HTMLElement>('#sc-tradeBundleBlock')
  const tradeBundleLabel = q<HTMLElement>('#sc-tradeBundleLabel')
  const tradeBundle = q<HTMLElement>('#sc-tradeBundle')
  const tradePrimary = q<HTMLButtonElement>('#sc-tradePrimary')
  const tradeSecondary = q<HTMLButtonElement>('#sc-tradeSecondary')
  const countryEl = q<HTMLElement>('#sc-country')
  const countryTitle = q<HTMLElement>('#sc-country h1')
  const countrySearch = q<HTMLInputElement>('#sc-countrySearch')
  const countryGrid = q<HTMLElement>('#sc-countryGrid')
  const countryRand = q<HTMLButtonElement>('#sc-country .rand')
  const shopPlayer = q<HTMLElement>('#sc-shopPlayer')

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
    // Per-seat integrity. Accepts either the legacy pair (you, foe) or an array of N.
    setIntegrity(...vals: (number | number[])[]) {
      const arr = Array.isArray(vals[0]) ? (vals[0] as number[]) : (vals as number[])
      for (let i = 0; i < 4; i++) {
        const v = i < arr.length ? arr[i] : 0
        fortBars[i].style.width = `${Math.round(v * 100)}%`
        fortPcts[i].textContent = `${Math.round(v * 100)}%`
        fortPanels[i].classList.toggle('dead', i < arr.length && v < 0.01)
      }
    },
    // Show `n` fort bars, label each, and outline whose turn it is.
    showForts(n: number, labels: string[], turnSeat: number) {
      for (let i = 0; i < 4; i++) {
        fortPanels[i].style.display = i < n ? 'block' : 'none'
        if (i < n && labels[i]) fortLabels[i].textContent = labels[i]
        fortPanels[i].classList.toggle('turn', i === turnSeat)
      }
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
    // Open the resource-wheels modal: paint each disc's icons around its rim. `onClick` (if given)
    // fires once on the first click anywhere — how a human stops the spin.
    showWheels(facesA: string[], facesB: string[], caption: string, onClick: (() => void) | null) {
      const paint = (disc: HTMLElement, faces: string[]) => {
        const step = 360 / faces.length
        disc.innerHTML = faces.map((f, i) => `<div class="face" style="transform: rotate(${i * step}deg) translateY(-62px)">${f}</div>`).join('')
      }
      paint(wheelADisc, facesA)
      paint(wheelBDisc, facesB)
      wheelCap.textContent = caption
      wheelHint.textContent = ''
      wheelsEl.onclick = onClick ? () => { wheelsEl.onclick = null; onClick() } : null
      wheelsEl.style.cursor = onClick ? 'pointer' : 'default'
      wheelsEl.style.display = 'flex'
    },
    // Per-frame rotation (degrees) of each disc, driven by the game loop.
    setWheelRotation(rotA: number, rotB: number) {
      wheelADisc.style.transform = `rotate(${rotA}deg)`
      wheelBDisc.style.transform = `rotate(${rotB}deg)`
    },
    setWheelText(caption: string, hint: string) {
      wheelCap.textContent = caption
      wheelHint.textContent = hint
    },
    hideWheels() {
      wheelsEl.style.display = 'none'
      wheelsEl.onclick = null
    },
    // Wire the four fort bars so clicking one opens the country-info panel (Bitter Truth only).
    // `cb(seat)` is called with the bar index; pass null to disable (bars become non-clickable).
    setFortInfoClick(cb: ((seat: number) => void) | null) {
      for (let i = 0; i < 4; i++) {
        const el = fortPanels[i]
        if (!el) continue
        el.onclick = cb ? () => cb(i) : null
        el.style.cursor = cb ? 'pointer' : ''
        // The HUD root is pointer-events:none; a clickable bar must opt back IN or real
        // mouse clicks pass straight through it. The `info` class adds the ⓘ affordance.
        el.style.pointerEvents = cb ? 'auto' : ''
        el.classList.toggle('info', !!cb)
      }
    },
    // Country info panel: real-world stats + a white-on-grey locator map with a red pin.
    showCountryInfo(o: { flag: string; name: string; pop: number; gdp: number; mil: number; area: number; lat: number; lng: number; region: string }) {
      cinfoFlag.textContent = o.flag
      cinfoName.textContent = o.name
      cinfoMap.innerHTML = WORLD_MAP_SVG
      cinfoPin.style.left = `${((o.lng + 180) / 360) * 100}%`
      cinfoPin.style.top = `${((90 - o.lat) / 180) * 100}%`
      const popTxt = o.pop >= 1 ? `${o.pop >= 100 ? Math.round(o.pop) : o.pop.toFixed(1)} million` : `${Math.round(o.pop * 1e6).toLocaleString()} people`
      const areaTxt = `${Math.round(o.area * 1000).toLocaleString()} km²`
      const gdpTxt = o.gdp >= 1000 ? `$${(o.gdp / 1000).toFixed(1)} trillion` : `$${o.gdp.toLocaleString()} billion`
      const rows: [string, string][] = [
        ['Population', popTxt],
        ['GDP', gdpTxt],
        ['Land area', areaTxt],
        ['Military', `${o.mil} / 100`],
        ['Location', o.region],
      ]
      cinfoStats.innerHTML = rows.map(([k, v]) => `<div class="crow"><span>${k}</span><b>${v}</b></div>`).join('')
      cinfoClose.onclick = () => { cinfoEl.style.display = 'none' }
      cinfoEl.onclick = (e) => { if (e.target === cinfoEl) cinfoEl.style.display = 'none' }
      cinfoEl.style.display = 'flex'
    },
    hideCountryInfo() {
      cinfoEl.style.display = 'none'
    },
    // Post-roll payout summary. `done` fires when dismissed — a human roll waits for a click,
    // an AI roll (no dismissHint) auto-advances after a short beat so the game keeps moving.
    showRollPayout(
      o: { caption: string; rows: { color: string; label: string; items: string; amount: number; note: string }[]; special: string; empty: boolean; dismissHint: string },
      done: () => void
    ) {
      payoutCap.textContent = o.caption
      payoutRows.innerHTML = o.empty
        ? '<div class="pempty">No resource income this roll.</div>'
        : o.rows.map(r => `<div class="prow" style="border-left-color:${r.color}"><div><div class="pname">${r.label}</div><div class="pitems">${r.items}${r.note ? ` · <span class="pnote">${r.note}</span>` : ''}</div></div><div class="pamt">${r.amount > 0 ? '+$' + r.amount.toLocaleString() : '—'}</div></div>`).join('')
      payoutSpecial.textContent = o.special
      payoutSpecial.style.display = o.special ? 'block' : 'none'
      payoutHint.textContent = o.dismissHint
      let closed = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const close = () => { if (closed) return; closed = true; if (timer !== undefined) clearTimeout(timer); payoutEl.style.display = 'none'; payoutEl.onclick = null; done() }
      payoutEl.onclick = close
      timer = o.dismissHint ? undefined : setTimeout(close, 2600) // AI roll auto-advances; human clicks
      payoutEl.style.display = 'flex'
    },
    // Big two-line round-over banner. `winner`: 0 (red) / 1 (blue) / -1 (neutral draw).
    roundOver(line1: string, line2: string, winner: number, ms = 4200) {
      const color = winner === 0 ? '#d5473a' : winner === 1 ? '#3f7bd6' : '#2c3138'
      roundoverEl.innerHTML = `<div class="l1">${line1}</div><div class="l2" style="color:${color}">${line2}</div>`
      roundoverEl.style.opacity = '1'
      statusEl.style.opacity = '0' // clear the status pill out from behind the banner
      clearTimeout(roundoverTimer)
      roundoverTimer = window.setTimeout(() => (roundoverEl.style.opacity = '0'), ms)
    },
    hideRoundOver() {
      roundoverEl.style.opacity = '0'
      statusEl.style.opacity = '1'
      clearTimeout(roundoverTimer)
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
      const inc = income > 0 ? ` &nbsp;·&nbsp; <span>resources</span> +$${income.toLocaleString()} when rolled` : ''
      const who = player > 0 ? `<b style="color:#d5473a">P${player}</b> &nbsp;·&nbsp; ` : ''
      statusEl.innerHTML = `${who}<span>round</span> ${round}/${rounds} &nbsp;·&nbsp; <span>score</span> ${you} — ${foe} &nbsp;·&nbsp; <span>cash</span> $${cash.toLocaleString()}${inc}`
      statusEl.style.opacity = '1' // re-shown after a round-over banner hid it
    },
    setFortLabels(you: string, foe: string) {
      fortLabels[0].textContent = you
      fortLabels[1].textContent = foe
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
    showHandoff(player: number, onReady: () => void, title?: string, sub?: string, btnLabel?: string) {
      handoffTitle.textContent = title ?? `PLAYER ${player} — YOUR TURN`
      handoffSub.textContent = sub ?? 'Pass the keyboard — everything on screen is now yours.'
      handoffBtn.textContent = btnLabel ?? 'START TURN'
      handoff.style.display = 'flex'
      handoffBtn.onclick = () => {
        handoff.style.display = 'none'
        onReady()
      }
    },
    // Boot / rematch mode picker: resolves with the chosen player count (1–4).
    showModePicker(onPick: (count: number) => void) {
      modeEl.style.display = 'flex'
      modeBtns.forEach((b, i) => {
        b.onclick = () => {
          modeEl.style.display = 'none'
          onPick(i + 1)
        }
      })
    },
    // The reality picker (right after the player count): Fun Time (as-is) vs Bitter Truth.
    showGameModePicker(onPick: (bitterTruth: boolean) => void) {
      gamemodeEl.style.display = 'flex'
      gmFun.onclick = () => { gamemodeEl.style.display = 'none'; onPick(false) }
      gmHard.onclick = () => { gamemodeEl.style.display = 'none'; onPick(true) }
    },
    // Seat setup (3–4 players): each seat toggles Human/Computer (seat 0 is always human),
    // then START resolves with the human/AI flags.
    showSeatSetup(count: number, onDone: (humanFlags: boolean[]) => void) {
      const flags = Array.from({ length: count }, (_, i) => i === 0)
      const render = () => {
        seatRows.innerHTML = flags
          .map((h, i) => `<button data-i="${i}"${i === 0 ? ' disabled' : ''}>Player ${i + 1}<span class="who ${h ? 'human' : 'cpu'}">${h ? '👤 HUMAN' : '💻 COMPUTER'}</span></button>`)
          .join('')
        seatRows.querySelectorAll('button').forEach(b => {
          b.addEventListener('click', () => {
            const i = +(b as HTMLElement).dataset.i!
            if (i === 0) return // seat 1 is always you
            flags[i] = !flags[i]
            render()
          })
        })
      }
      render()
      seatsStart.onclick = () => {
        seatsEl.style.display = 'none'
        onDone(flags)
      }
      seatsEl.style.display = 'flex'
    },
    // Target picker (3–4 players): pick which opponent a hostile card hits.
    showTargetPicker(title: string, options: { seat: number; label: string }[], onPick: (seat: number) => void) {
      targetTitle.textContent = title
      targetRows.innerHTML = options.map(o => `<button data-seat="${o.seat}">${o.label}<span>›</span></button>`).join('')
      targetRows.querySelectorAll('button').forEach(b => {
        b.addEventListener('click', () => {
          targetEl.style.display = 'none'
          onPick(+(b as HTMLElement).dataset.seat!)
        })
      })
      targetEl.style.display = 'flex'
    },
    // The 🤝 OFFER TRADE button above the bottom-left stack (3–4 players, human's turn).
    setTrade(show: boolean, onClick?: () => void) {
      tradeBtn.classList.toggle('on', show)
      tradeBtn.onclick = onClick ?? null
    },
    // The 🏳️ SURRENDER button (Bitter Truth, human's turn, 3–4 players, not yet a vassal).
    setSurrender(show: boolean, onClick?: () => void) {
      surrenderBtn.classList.toggle('on', show)
      surrenderBtn.onclick = onClick ?? null
    },
    // Assemble a bundle of your OWN items — used both for the opening offer and for a
    // recipient's return. The pool is what you can still add; the bundle is what you've
    // staged; clicking a chip moves it between them. Primary confirms, secondary cancels
    // (or "send nothing"). `them` optionally shows the other side's holdings for context.
    showTradeCompose(opts: {
      title: string
      subtitle?: string
      them?: { label: string; emoji: string }[] | null
      poolLabel: string
      bundleLabel: string
      getPool: () => { kind: string; key: string; label: string; emoji: string }[]
      getBundle: () => { kind: string; key: string; label: string; emoji: string }[]
      onAdd: (idx: number) => void
      onRemove: (idx: number) => void
      primaryLabel: string
      onPrimary: () => void
      secondaryLabel: string
      onSecondary: () => void
    }) {
      const chip = (i: { label: string; emoji: string }, n?: number) =>
        `<span class="chip"${n === undefined ? '' : ` data-n="${n}"`}>${i.emoji} ${i.label}</span>`
      const draw = () => {
        tradeTitle.textContent = opts.title
        tradeSub.textContent = opts.subtitle ?? ''
        if (opts.them) {
          tradeThemBlock.style.display = ''
          tradeThemLabel.textContent = 'THEY HOLD'
          tradeThem.innerHTML = opts.them.length ? opts.them.map(i => chip(i)).join('') : '<span class="empty">nothing</span>'
        } else tradeThemBlock.style.display = 'none'
        tradePoolBlock.style.display = ''
        tradePoolLabel.textContent = opts.poolLabel
        const pool = opts.getPool()
        tradeMine.innerHTML = pool.length ? pool.map((i, n) => chip(i, n)).join('') : '<span class="empty">nothing left to add</span>'
        tradeBundleBlock.style.display = ''
        tradeBundleLabel.textContent = opts.bundleLabel
        const bundle = opts.getBundle()
        tradeBundle.innerHTML = bundle.length ? bundle.map((i, n) => chip(i, n)).join('') : '<span class="empty">nothing selected yet</span>'
        tradeMine.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => { opts.onAdd(+(c as HTMLElement).dataset.n!); draw() }))
        tradeBundle.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => { opts.onRemove(+(c as HTMLElement).dataset.n!); draw() }))
      }
      draw()
      tradePrimary.textContent = opts.primaryLabel
      tradePrimary.onclick = () => { tradeEl.style.display = 'none'; opts.onPrimary() }
      tradeSecondary.textContent = opts.secondaryLabel
      tradeSecondary.onclick = () => { tradeEl.style.display = 'none'; opts.onSecondary() }
      tradeEl.style.display = 'flex'
    },
    // A human recipient's accept/reject decision on an incoming offer (shows what's on the table).
    showTradeDecision(opts: { title: string; subtitle?: string; offered: { label: string; emoji: string }[]; onAccept: () => void; onReject: () => void }) {
      tradeTitle.textContent = opts.title
      tradeSub.textContent = opts.subtitle ?? ''
      tradeThemBlock.style.display = ''
      tradeThemLabel.textContent = 'THEY OFFER YOU'
      tradeThem.innerHTML = opts.offered.length ? opts.offered.map(i => `<span class="chip">${i.emoji} ${i.label}</span>`).join('') : '<span class="empty">nothing</span>'
      tradePoolBlock.style.display = 'none'
      tradeBundleBlock.style.display = 'none'
      tradePrimary.textContent = 'ACCEPT'
      tradePrimary.onclick = () => { tradeEl.style.display = 'none'; opts.onAccept() }
      tradeSecondary.textContent = 'REJECT'
      tradeSecondary.onclick = () => { tradeEl.style.display = 'none'; opts.onReject() }
      tradeEl.style.display = 'flex'
    },
    // Country picker: `who` labels the seat (e.g. "PLAYER 1"); resolves with the chosen
    // country. `taken` codes are hidden so two humans can't pick the same nation.
    showCountryPicker(who: string, taken: string[], onPick: (c: Country) => void) {
      countryTitle.innerHTML = `${who} — pick your country`
      countrySearch.value = ''
      const choose = (c: Country) => {
        countryEl.style.display = 'none'
        onPick(c)
      }
      const render = (filter: string) => {
        const f = filter.trim().toLowerCase()
        const list = COUNTRIES.filter(c => !taken.includes(c.code) && (!f || c.name.toLowerCase().includes(f)))
        countryGrid.innerHTML = list
          .map(c => `<button data-code="${c.code}"><span class="flag">${flagOf(c.code)}</span><span class="nm">${c.name}</span></button>`)
          .join('')
        countryGrid.querySelectorAll('button').forEach(b => {
          b.addEventListener('click', () => {
            const code = (b as HTMLElement).dataset.code!
            choose(COUNTRIES.find(c => c.code === code)!)
          })
        })
      }
      render('')
      countrySearch.oninput = () => render(countrySearch.value)
      countryRand.onclick = () => {
        const pool = COUNTRIES.filter(c => !taken.includes(c.code))
        choose(pool[Math.floor(Math.random() * pool.length)])
      }
      countryEl.style.display = 'flex'
      countrySearch.focus()
    },
  }
}

export type Hud = ReturnType<typeof createHud>
