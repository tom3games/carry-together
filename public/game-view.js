// ゲーム中の描画と操作。render(state, { send }) は状態が届くたびに呼ばれる。state.game はサーバーの view(自分)。
// 画面は届いた位置を少し遅らせて補間し、滑らかに見せるだけ。動きの計算はサーバーがする。
import { COURSES, CARGOS, EMOTES, handleOffsets, handleLabel, moverAt, PLAYER_COLORS } from './stages.js'
import * as sfx from './sound.js'
import { createView3D } from './view3d.js'

const $ = s => document.querySelector(s)
const INTERP_MS = 110 // サーバーは 20Hz。2コマ分ほど遅らせて間を埋める

// かけ声スタンプのアイコン（24x24、線だけ）
const EMOTE_ICONS = [
  '<path d="M5 15l4-4 3 3 7-7M15 7h4v4" />',                                  // せーの（上がる矢印）
  '<path d="M19 12a7 7 0 1 1-2.1-5M19 4v4h-4" />',                             // 右回り
  '<path d="M5 12a7 7 0 1 0 2.1-5M5 4v4h4" />',                                // 左回り
  '<path d="M8 3h8l5 5v8l-5 5H8l-5-5V8z" /><path d="M8 12h8" />',              // 止まって
  '<path d="M6 9l6 6 6-6" /><path d="M6 4l6 6 6-6" opacity=".45" />',          // ゆっくり
  '<path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z" />' // ナイス
]
const DONE_TEXT = { goal: '到着！', fall: '落ちた！', broken: '壊れた！', time: '時間切れ！' }

let ui = null // 1ラウンド分の画面の部品と状態

// HUD のアイコン（SVG、線だけ）
const ICON = {
  clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/></svg>',
  box: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8l9-4 9 4v9l-9 4-9-4z"/><path d="M3 8l9 4 9-4M12 12v9"/></svg>',
  zoom: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21M8 10.5h5"/></svg>',
  truck: '<svg viewBox="0 0 32 20" aria-hidden="true"><path d="M1 3h18v12H1zM19 7h6l5 5v3H19z" fill="#ffc83a" stroke="#2a2119" stroke-width="1.6" stroke-linejoin="round"/><circle cx="7" cy="16" r="3" fill="#2a2119"/><circle cx="24" cy="16" r="3" fill="#2a2119"/></svg>',
  quit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10"/></svg>'
}

function build(state, send) {
  const g = state.game
  const root = $('#stage')
  root.innerHTML = `
    <div class="play" id="g-wrap">
      <canvas id="g-cv"></canvas>
      <canvas id="g-ov" aria-hidden="true"></canvas>
      <div class="labels" id="g-labels" aria-hidden="true"></div>
      <div class="hud-top">
        <div class="chip time" id="g-timeBox">${ICON.clock}<span id="g-time"></span></div>
        <div class="hp" aria-label="耐久">${ICON.box}<div class="bar"><i id="g-hp"></i></div><span id="g-hpNum"></span></div>
        <button id="g-zoom" class="icon-btn" aria-label="カメラを引く">${ICON.zoom}</button>
        <button id="g-mute" class="icon-btn" aria-label="音"></button>
      </div>
      <div class="route" aria-hidden="true"><div class="route-line"><i id="g-prog"></i></div><span class="route-truck" id="g-truck">${ICON.truck}</span><span class="route-flag">着</span></div>
      <div class="me-chip" id="g-me"></div>
      <div class="banner" id="g-banner" hidden></div>
      <div class="emotes" id="g-em" role="group" aria-label="かけ声">${EMOTES.map((t, i) => `<button type="button" class="em-btn" data-k="${i}" aria-label="${t}"><svg viewBox="0 0 24 24" aria-hidden="true">${EMOTE_ICONS[i]}</svg><span>${t}</span></button>`).join('')}</div>
      <div class="pad" id="g-pad" aria-label="押す向き（ドラッグ）"><div class="pad-ring"></div><div class="pad-arrows" aria-hidden="true"></div><div class="knob" id="g-knob"></div></div>
    </div>`
  const cv = $('#g-cv')
  const cargo = CARGOS[g.cargo]
  const course = COURSES[g.course]
  ui = {
    round: state.round, send, cv, ov: $('#g-ov'),
    course, cargo, n: g.n,
    offs: handleOffsets(cargo, g.n),
    snaps: [], last: g, cam: null, shake: 0, bumpSeen: g.bump, cdSeen: g.cd, mhSeen: g.mh, emSeen: new Set(), doneSeen: g.done,
    stick: [0, 0], keys: new Set(), sentAt: 0, sent: [0, 0], raf: 0, names: new Map(),
    parts: [], pops: [], walk: 0, lastP: null, lastFrame: performance.now(), doneAt: null, emAt: 0, flakes: null, tags: []
  }
  ui.ovCtx = ui.ov.getContext('2d')
  // 3D で描く。WebGL が使えない端末は 2D の見下ろし描画に戻す
  if (!new URLSearchParams(location.search).has('2d')) {
    createView3D.paintFloor = paintFloor
    try { ui.v3 = createView3D(cv, { course, cargo, n: g.n, me: g.me }) } catch (e) { console.warn('3D を使えないので 2D で描く', e); ui.v3 = null }
  }
  if (!ui.v3) ui.ctx = cv.getContext('2d')
  $('#g-wrap').dataset.mode = ui.v3 ? '3d' : '2d'
  $('#g-zoom').hidden = !ui.v3
  $('#g-zoom').onclick = () => { if (!ui || !ui.v3) return; const far = ui.v3.toggleZoom(); $('#g-zoom').setAttribute('aria-pressed', far ? 'true' : 'false') }
  // 名前の札（人数ぶん）
  const lab = $('#g-labels')
  ui.tags = ui.offs.map((_, i) => {
    const t = document.createElement('div'); t.className = 'tag'; t.style.setProperty('--c', PLAYER_COLORS[i])
    const b = document.createElement('div'); b.className = 'bubble'; b.style.setProperty('--c', PLAYER_COLORS[i]); b.hidden = true
    lab.append(t, b); return { t, b, key: '' }
  })
  ui.popEl = document.createElement('div'); ui.popEl.className = 'pop'; lab.append(ui.popEl)
  setupPad()
  setupKeys()
  setupEmotes()
  sfx.bindMuteButton($('#g-mute'))
  sfx.startBgm(ui.course.theme)
  // 送信ループ。変わったらすぐ、押している間は 250ms ごとに送り直す（サーバーは 0.8 秒届かないと手を離したとみなす）
  ui.sendTimer = setInterval(pushLoop, 50)
  window.__ct = { // e2e 用の読み取りと操作口
    view: () => ui && ui.last,
    push: (x, y) => { if (ui) { ui.auto = [x, y] } },
    emote: k => sendEmote(k),
    mode: () => ui && (ui.v3 ? '3d' : '2d'),
    variance: () => ui && ui.v3 ? ui.v3.variance() : null,
    fps: () => ui && ui.v3 ? ui.v3.fps() : null,
    tier: () => ui && ui.v3 ? ui.v3.tier : null
  }
}

// 3D の床に貼る絵（2D の描き方をそのまま使う）
function paintFloor(ctx, course) {
  drawFloor(ctx, course)
  for (const d of course.deco || []) drawDeco(ctx, d, course)
  for (const z of course.zones || []) drawZone(ctx, z, 0)
  drawGoal(ctx, course)
  for (const pit of course.pits) drawPit(ctx, pit, course.theme)
}

function currentVec() {
  if (ui.auto) return ui.auto
  let [x, y] = ui.stick
  if (ui.keys.size) {
    const k = ui.keys
    x = (k.has('r') ? 1 : 0) - (k.has('l') ? 1 : 0)
    y = (k.has('d') ? 1 : 0) - (k.has('u') ? 1 : 0)
    const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m }
  }
  return [Math.round(x * 20) / 20, Math.round(y * 20) / 20]
}

function pushLoop() {
  if (!ui || $('#game').hidden) return
  const [x, y] = currentVec()
  const now = performance.now()
  const changed = x !== ui.sent[0] || y !== ui.sent[1]
  const idle = x === 0 && y === 0
  if (changed || (!idle && now - ui.sentAt > 250)) {
    ui.send({ type: 'push', x, y })
    ui.sent = [x, y]; ui.sentAt = now
  }
}

function sendEmote(k) {
  if (!ui || !(k >= 0 && k < EMOTES.length)) return
  const now = performance.now()
  if (now - ui.emAt < 700) return // サーバーも間引くが、押した感触のために画面でもそろえる
  ui.emAt = now
  ui.send({ type: 'emote', k })
  const b = document.querySelector(`.em-btn[data-k="${k}"]`)
  if (b) { b.classList.remove('hit'); void b.offsetWidth; b.classList.add('hit') }
}

function setupEmotes() {
  for (const b of document.querySelectorAll('.em-btn')) {
    b.addEventListener('pointerdown', e => { e.preventDefault(); sfx.unlock(); sendEmote(Number(b.dataset.k)) })
  }
}

function setupPad() {
  const pad = $('#g-pad'), knob = $('#g-knob')
  let pid = null
  const move = e => {
    const r = pad.getBoundingClientRect()
    const R = r.width * 0.36
    let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2)
    const m = Math.hypot(dx, dy)
    if (m > R) { dx *= R / m; dy *= R / m }
    knob.style.transform = `translate(${dx}px, ${dy}px)`
    // 真ん中の少しは遊び（指のぶれで勝手に押さない）
    const k = Math.hypot(dx, dy) / R
    ui.stick = k < 0.15 ? [0, 0] : [dx / R, dy / R]
  }
  pad.addEventListener('pointerdown', e => { e.preventDefault(); pid = e.pointerId; pad.setPointerCapture(pid); pad.classList.add('on'); sfx.unlock(); move(e) })
  pad.addEventListener('pointermove', e => { if (e.pointerId === pid) move(e) })
  const end = e => { if (e.pointerId !== pid) return; pid = null; ui.stick = [0, 0]; knob.style.transform = ''; pad.classList.remove('on') }
  pad.addEventListener('pointerup', end)
  pad.addEventListener('pointercancel', end)
}

const KEYMAP = { ArrowUp: 'u', KeyW: 'u', ArrowDown: 'd', KeyS: 'd', ArrowLeft: 'l', KeyA: 'l', ArrowRight: 'r', KeyD: 'r' }
function onKey(e) {
  if (!ui || $('#game').hidden) return
  if (e.type === 'keydown' && /^Digit[1-6]$/.test(e.code)) { sfx.unlock(); sendEmote(Number(e.code.slice(5)) - 1); return }
  const k = KEYMAP[e.code]; if (!k) return
  e.preventDefault()
  sfx.unlock()
  if (e.type === 'keydown') ui.keys.add(k); else ui.keys.delete(k)
}
let keysBound = false
function setupKeys() {
  if (keysBound) return
  keysBound = true
  addEventListener('keydown', onKey)
  addEventListener('keyup', onKey)
  addEventListener('blur', () => ui && ui.keys.clear())
}

export function render(state, { send }) {
  const g = state.game
  if (!ui || ui.round !== state.round || !$('#g-cv')) { teardown(); build(state, send) }
  ui.last = g
  ui.names = new Map(state.players.map(p => [p.id, p.name]))
  ui.snaps.push({ t: performance.now(), x: g.x, y: g.y, a: g.a, gt: g.t })
  if (ui.snaps.length > 12) ui.snaps.shift()
  if (g.bump !== ui.bumpSeen) {
    ui.bumpSeen = g.bump; ui.shake = 1
    if (g.mh !== ui.mhSeen) { ui.mhSeen = g.mh; sfx.honk(); pop('ドン！', '#ff6b6b') }
    else { sfx.bump(ui.cargo === CARGOS.tank); pop('ゴン', '#ffd36b') }
    burst(g.x, g.y, ui.cargo === CARGOS.tank ? '#bfe9ff' : '#fff1c2', 10)
    if (navigator.vibrate) try { navigator.vibrate(40) } catch {}
  }
  if (g.cd !== ui.cdSeen) { ui.cdSeen = g.cd; sfx.count(g.cd) }
  for (const [h, k, id] of g.em || []) {
    if (ui.emSeen.has(id)) continue
    ui.emSeen.add(id)
    sfx.emote(k)
    if (k === 0) { ui.seeno = performance.now() }
  }
  if (g.done && g.done !== ui.doneSeen) {
    ui.doneSeen = g.done; ui.doneAt = performance.now()
    if (g.done === 'goal') { sfx.arrive(); for (let i = 0; i < 70; i++) confetti(g.x, g.y) }
    else if (g.done === 'broken') { sfx.crash(); burst(g.x, g.y, ui.cargo.color, 26) }
    else if (g.done === 'fall') sfx.fall()
    else sfx.lose()
  }
  updateHud(state)
  if (!ui.raf) ui.raf = requestAnimationFrame(frame)
}

function teardown() {
  if (!ui) return
  clearInterval(ui.sendTimer)
  cancelAnimationFrame(ui.raf)
  if (ui.v3) ui.v3.dispose()
  sfx.stopBgm()
  ui = null
}

function updateHud(state) {
  const g = ui.last
  $('#g-time').textContent = `${g.time}秒`
  $('#g-timeBox').dataset.low = g.time <= 20 ? '1' : '0'
  const ratio = g.hp / ui.cargo.hp
  $('#g-hp').style.width = `${Math.max(0, ratio * 100)}%`
  $('#g-hp').dataset.lv = ratio > 0.6 ? 'ok' : ratio > 0.3 ? 'mid' : 'low'
  $('#g-hpNum').textContent = g.hp
  $('#g-prog').style.width = `${g.prog}%`
  const label = g.me >= 0 ? handleLabel(ui.cargo, ui.offs[g.me]) : '-'
  const col = PLAYER_COLORS[g.me] || '#888'
  const meKey = `${g.me}|${label}`
  if (ui.meKey !== meKey) { ui.meKey = meKey; $('#g-me').innerHTML = `<span class="me-dot" style="background:${col}">${g.me + 1}</span><span><b>${label}</b>を持つ</span>` }
  $('#g-truck').style.left = `${Math.max(0, Math.min(100, g.prog))}%`
  updateBanner()
}

// 画面中央の帯。中身が変わったときだけ書き換える（毎フレーム書くと点滅のアニメが止まる）
function updateBanner() {
  const g = ui.last
  let kind = '', html = ''
  if (g.cd > 0) { kind = 'cd'; html = `<b>${g.cd}</b><span>あなたは「${handleLabel(ui.cargo, ui.offs[g.me] || [0, 0])}」を持つ</span>` }
  else if (g.done) { kind = g.done === 'goal' ? 'win' : 'lose'; html = `<b>${DONE_TEXT[g.done]}</b>` }
  else if (g.pull) { kind = 'warn'; html = '<span>引っぱりすぎ！ 裂ける</span>' }
  else if (ui.seeno && performance.now() - ui.seeno < 1100) { kind = 'seeno'; html = '<b>せーの！</b>' }
  const b = $('#g-banner')
  const key = kind + html
  if (ui.bannerKey === key) return
  ui.bannerKey = key
  b.hidden = !kind
  b.dataset.kind = kind
  b.innerHTML = html
}

// ---- 演出の粒
function pop(text, color) {
  ui.pops.push({ text, color, t: performance.now() })
  if (ui.popEl) { ui.popEl.textContent = text; ui.popEl.style.color = color; ui.popEl.classList.remove('on'); void ui.popEl.offsetWidth; ui.popEl.classList.add('on') }
}
function burst(x, y, color, n) {
  if (ui.v3) return ui.v3.burst(x, y, color, n)
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = 60 + Math.random() * 160
    ui.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.6 + Math.random() * 0.4, age: 0, r: 3 + Math.random() * 4, color, kind: 'chip' })
  }
}
function confetti(x, y) {
  if (ui.v3) { if (!ui.confDone) { ui.confDone = true; ui.v3.confetti(x, y) } return }
  const a = Math.random() * Math.PI * 2, v = 120 + Math.random() * 260
  ui.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120, life: 1.6 + Math.random() * 0.6, age: 0, r: 4 + Math.random() * 4, color: PLAYER_COLORS[Math.floor(Math.random() * 8)], kind: 'conf', spin: Math.random() * 6 })
}

// ---- 描画
function sample() {
  const s = ui.snaps
  const t = performance.now() - INTERP_MS
  if (!s.length) return null
  if (t <= s[0].t) return s[0]
  for (let i = s.length - 1; i > 0; i--) {
    const a = s[i - 1], b = s[i]
    if (t >= a.t) {
      if (t >= b.t) return b
      const k = (t - a.t) / (b.t - a.t)
      let da = b.a - a.a
      if (da > Math.PI) da -= 2 * Math.PI
      if (da < -Math.PI) da += 2 * Math.PI
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, a: a.a + da * k, gt: a.gt + (b.gt - a.gt) * k }
    }
  }
  return s[s.length - 1]
}

function frame() {
  ui.raf = 0
  if ($('#game').hidden) { teardown(); return } // 退出などでゲーム画面を離れたら、送信と BGM も止める
  const cv = ui.cv
  const wrap = $('#g-wrap')
  const dpr = Math.min(2, devicePixelRatio || 1)
  const W = wrap.clientWidth, H = wrap.clientHeight
  const ov = ui.ov
  if (ov.width !== Math.round(W * dpr) || ov.height !== Math.round(H * dpr)) { ov.width = Math.round(W * dpr); ov.height = Math.round(H * dpr) }
  if (!ui.v3 && (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr))) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr) }
  const now = performance.now()
  const dt = Math.min(0.05, (now - ui.lastFrame) / 1000)
  ui.lastFrame = now
  const p = sample()
  if (p && W > 0 && H > 0) {
    // 歩く足の動きは荷物が進んだ距離から
    if (ui.lastP) {
      const d = Math.hypot(p.x - ui.lastP.x, p.y - ui.lastP.y)
      ui.walk += d * 0.12 + Math.abs(p.a - ui.lastP.a) * 6
      ui.speed = ui.speed == null ? d / Math.max(dt, 1e-3) : ui.speed * 0.85 + (d / Math.max(dt, 1e-3)) * 0.15
      if (!ui.v3 && d > 0.8 && !ui.last.done && Math.random() < 0.5) dust(p)
    }
    ui.lastP = { x: p.x, y: p.y, a: p.a }
    const o = ui.ovCtx
    o.setTransform(dpr, 0, 0, dpr, 0, 0)
    o.clearRect(0, 0, W, H)
    if (ui.v3) {
      ui.v3.setSize(W, H)
      const r = ui.v3.frame({ p, g: ui.last, now, dt: Math.max(dt, 1 / 240), walk: ui.walk, speed: ui.speed || 0, doneAt: ui.doneAt })
      placeTags(r.labels, now)
      if (ui.v3.knocked !== (ui.knockSeen || 0)) { ui.knockSeen = ui.v3.knocked; sfx.knock() }
      placePop(r.cargoScreen)
      if (ui.shake > 0.01) { wrap.style.setProperty('--sx', `${(Math.random() - 0.5) * 10 * ui.shake}px`); wrap.style.setProperty('--sy', `${(Math.random() - 0.5) * 10 * ui.shake}px`); ui.shake *= 0.85 }
      else { wrap.style.setProperty('--sx', '0px'); wrap.style.setProperty('--sy', '0px') }
      drawMinimap(o, W, H, ui.course, p, p.gt || 0)
      edgeArrow(o, W, H, r.goal)
    } else {
      stepParts(dt)
      draw(ui.ctx, W, H, dpr, p, now)
    }
    updateBanner()
  }
  ui.raf = requestAnimationFrame(frame)
}

// 名前の札とかけ声の吹き出し（3D の頭の上に HTML を重ねる）
function placeTags(labels, now) {
  const g = ui.last
  const em = new Map((g.em || []).map(e => [e[0], e[1]]))
  for (const L of labels) {
    const tg = ui.tags[L.i]
    if (!tg) continue
    const h = g.hs[L.i] || [null]
    const mine = L.i === g.me
    let name = mine ? 'あなた' : ((h[0] && ui.names.get(h[0])) || '')
    if (!mine && ui.n > 4) name = '' // 5人以上は番号だけ（札が重ならないように）
    const key = `${L.i + 1}|${name}|${L.on}|${mine}`
    if (tg.key !== key) {
      tg.key = key
      tg.t.innerHTML = `<b>${L.on ? L.i + 1 : '×'}</b><span></span>`
      tg.t.querySelector('span').textContent = name
      tg.t.classList.toggle('mine', mine); tg.t.classList.toggle('off', !L.on)
    }
    tg.t.style.transform = `translate(${L.x}px, ${L.y}px) translate(-50%, -100%)`
    tg.t.style.zIndex = L.i === g.me ? 2 : 1
    const k = em.get(L.i)
    if (k != null) {
      if (tg.b.hidden || tg.b.dataset.k !== String(k)) { tg.b.textContent = EMOTES[k]; tg.b.dataset.k = k; tg.b.hidden = false; tg.b.classList.remove('in'); void tg.b.offsetWidth; tg.b.classList.add('in') }
      tg.b.style.transform = `translate(${L.x}px, ${L.y - 26}px) translate(-50%, -100%)`
    } else if (!tg.b.hidden) tg.b.hidden = true
  }
}
function placePop(sc) {
  if (!ui.popEl || !sc) return
  ui.popEl.style.left = sc.x + 'px'; ui.popEl.style.top = sc.y + 'px'
}

// ゴールが画面の外にあるとき、その向きを画面の縁に出す（3D 用）
function edgeArrow(ctx, W, H, gp) {
  if (!gp || (!gp.behind && gp.x > 0 && gp.x < W && gp.y > 0 && gp.y < H)) return
  let dx = gp.x - W / 2, dy = gp.y - H / 2
  if (gp.behind) { dx = -dx; dy = -dy }
  const k = Math.min((W / 2 - 30) / Math.abs(dx || 1e-6), (H / 2 - 30) / Math.abs(dy || 1e-6))
  const ax = W / 2 + dx * k, ay = H / 2 + dy * k, ang = Math.atan2(dy, dx)
  ctx.save(); ctx.translate(ax, ay); ctx.rotate(ang)
  ctx.fillStyle = '#3ddc97'; ctx.strokeStyle = '#0b5d38'; ctx.lineWidth = 3
  ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(-12, -14); ctx.lineTo(-5, 0); ctx.lineTo(-12, 14); ctx.closePath(); ctx.fill(); ctx.stroke()
  ctx.restore()
}

function dust(p) {
  const { course } = ui
  const col = course.theme === 'snow' ? '#ffffff' : course.theme === 'street' ? '#cfd3d8' : '#e8d3a8'
  const a = Math.random() * Math.PI * 2
  ui.parts.push({ x: p.x + Math.cos(a) * 40, y: p.y + Math.sin(a) * 30, vx: Math.cos(a) * 20, vy: Math.sin(a) * 20, life: 0.6, age: 0, r: 5 + Math.random() * 5, color: col, kind: 'dust' })
}

function stepParts(dt) {
  for (const q of ui.parts) {
    q.age += dt
    q.x += q.vx * dt; q.y += q.vy * dt
    if (q.kind === 'conf') { q.vy += 260 * dt; q.vx *= 0.99 } else { q.vx *= 0.92; q.vy *= 0.92 }
  }
  ui.parts = ui.parts.filter(q => q.age < q.life)
  if (ui.parts.length > 260) ui.parts.splice(0, ui.parts.length - 260)
}

function draw(ctx, W, H, dpr, p, now) {
  const { course, cargo } = ui
  const [CW, CH] = course.size
  // 見える広さを画面の面積で決める（縦でも横でも同じくらいの範囲が見える）。ワールドより広くは映さない
  const scale = Math.max(Math.sqrt((W * H) / 260000), W / CW, H / CH)
  // カメラは荷物を追う。少しだけ前（上）を広く見せる
  const want = { x: p.x, y: p.y - 40 }
  if (!ui.cam) ui.cam = { ...want }
  ui.cam.x += (want.x - ui.cam.x) * 0.15
  ui.cam.y += (want.y - ui.cam.y) * 0.15
  const halfW = W / 2 / scale, halfH = H / 2 / scale
  const cx = Math.max(halfW, Math.min(CW - halfW, ui.cam.x))
  const cy = Math.max(halfH, Math.min(CH - halfH, ui.cam.y))
  let sx = 0, sy = 0
  if (ui.shake > 0.01) { sx = (Math.random() - 0.5) * 10 * ui.shake; sy = (Math.random() - 0.5) * 10 * ui.shake; ui.shake *= 0.85 }
  const gt = p.gt || 0

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = '#0e0f13'
  ctx.fillRect(0, 0, W, H)
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * (W / 2 - cx * scale + sx), dpr * (H / 2 - cy * scale + sy))

  drawFloor(ctx, course)
  for (const d of course.deco || []) drawDeco(ctx, d, course)
  for (const z of course.zones || []) drawZone(ctx, z, now)
  drawGoal(ctx, course)
  for (const pit of course.pits) drawPit(ctx, pit, course.theme)
  for (const m of course.movers || []) if (m.kind !== 'person') drawMover(ctx, m, moverAt(m, gt))
  for (const w of course.walls) drawWall(ctx, w, course.theme)
  drawParts(ctx, 'dust')
  // 落ちたときは穴へ吸い込まれるように小さくする
  let k = 1
  if (ui.last.done === 'fall' && ui.doneAt) k = Math.max(0.15, 1 - (now - ui.doneAt) / 900)
  drawCargo(ctx, cargo, p, k)
  drawHandles(ctx, cargo, p, scale, now)
  for (const m of course.movers || []) if (m.kind === 'person') drawMover(ctx, m, moverAt(m, gt))
  drawParts(ctx, 'chip'); drawParts(ctx, 'conf')
  drawBubbles(ctx, cargo, p, scale, now)
  drawPops(ctx, p, scale, now)

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  if (course.theme === 'snow') drawSnowfall(ctx, W, H, now)
  drawMinimap(ctx, W, H, course, p, gt)
  drawGoalArrow(ctx, W, H, scale, cx, cy, course.goal)
}

const FLOOR = {
  wood: ['#b48a5a', 'rgba(70,40,15,.28)'],
  street: ['#b9b4aa', 'rgba(60,55,50,.18)'],
  snow: ['#eef3f8', 'rgba(120,150,190,.18)'],
  factory: ['#8d9196', 'rgba(30,35,40,.22)'],
  apartment: ['#d9cdb8', 'rgba(90,75,55,.2)']
}
function drawFloor(ctx, course) {
  const [CW, CH] = course.size
  const [base, line] = FLOOR[course.theme] || FLOOR.wood
  ctx.fillStyle = base
  ctx.fillRect(0, 0, CW, CH)
  ctx.strokeStyle = line
  ctx.lineWidth = 2
  ctx.beginPath()
  if (course.theme === 'wood') {
    // 板の目
    for (let y = 0; y < CH; y += 46) {
      ctx.moveTo(0, y); ctx.lineTo(CW, y)
      const off = (y / 46) % 2 ? 0 : 90
      for (let x = off; x < CW; x += 180) { ctx.moveTo(x, y); ctx.lineTo(x, y + 46) }
    }
  } else if (course.theme === 'snow') {
    // 雪のでこぼこ（決まった並びの点）
    ctx.fillStyle = line
    for (let i = 0; i < 900; i++) { const x = (i * 397) % CW, y = (i * 733) % CH; ctx.moveTo(x + 4, y); ctx.arc(x, y, 3 + (i % 3), 0, Math.PI * 2) }
    ctx.fill()
  } else {
    // 石畳・タイル・コンクリートの目地
    const step = course.theme === 'street' ? 60 : course.theme === 'factory' ? 120 : 50
    for (let y = 0; y < CH; y += step) { ctx.moveTo(0, y); ctx.lineTo(CW, y) }
    for (let x = 0; x < CW; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, CH) }
  }
  ctx.stroke()
  // スタートの印
  const s = course.start
  ctx.strokeStyle = course.theme === 'snow' ? 'rgba(40,60,90,.35)' : 'rgba(255,255,255,.4)'
  ctx.setLineDash([10, 8]); ctx.lineWidth = 3
  ctx.strokeRect(s.x - 100, s.y - 100, 200, 200)
  ctx.setLineDash([])
  ctx.fillStyle = course.theme === 'snow' ? 'rgba(40,60,90,.5)' : 'rgba(255,255,255,.6)'
  ctx.font = '700 22px system-ui, sans-serif'; ctx.textAlign = 'center'
  ctx.fillText('スタート', s.x, s.y + 128)
}

function drawDeco(ctx, [type, x, y, w, h]) {
  if (type === 'road') {
    ctx.fillStyle = '#3b3e44'; ctx.fillRect(x, y, w, h)
    ctx.fillStyle = '#e7e2d3'; ctx.fillRect(x, y, w, 6); ctx.fillRect(x, y + h - 6, w, 6)
  } else if (type === 'island') {
    ctx.fillStyle = '#c9c3b5'; ctx.fillRect(x, y + 14, w, h - 28)
    ctx.save(); ctx.beginPath(); ctx.rect(x, y + 14, w, h - 28); ctx.clip()
    ctx.strokeStyle = '#e8c33a'; ctx.lineWidth = 8
    ctx.beginPath(); for (let k = x - h; k < x + w; k += 40) { ctx.moveTo(k, y + h); ctx.lineTo(k + h, y) } ctx.stroke()
    ctx.restore()
    ctx.fillStyle = 'rgba(30,30,30,.55)'; ctx.font = '800 22px system-ui, sans-serif'; ctx.textAlign = 'center'
    ctx.fillText('中央の島', x + 120, y + h / 2 + 8)
  } else if (type === 'zebra') {
    ctx.fillStyle = 'rgba(245,245,240,.85)'
    for (let yy = y + 22; yy < y + h - 20; yy += 46) ctx.fillRect(x, yy, w, 24)
  } else if (type === 'shop' || type === 'cabin' || type === 'dock') {
    // 行き先の建物の床
    ctx.fillStyle = type === 'shop' ? '#e6d2b0' : type === 'cabin' ? '#a8754a' : '#6f757c'
    ctx.fillRect(x, y, w, h)
    if (type === 'shop') { // 日よけの縞
      for (let i = 0; i < w; i += 60) { ctx.fillStyle = (i / 60) % 2 ? '#e84d4d' : '#fff4e6'; ctx.fillRect(x + i, y + h - 26, 60, 26) }
    }
    if (type === 'cabin') { ctx.strokeStyle = 'rgba(60,30,10,.35)'; ctx.lineWidth = 3; ctx.beginPath(); for (let yy = y; yy < y + h; yy += 30) { ctx.moveTo(x, yy); ctx.lineTo(x + w, yy) } ctx.stroke() }
    if (type === 'dock') { ctx.fillStyle = '#ffcc00'; for (let i = 0; i < w; i += 80) ctx.fillRect(x + i, y + h - 12, 40, 12) }
  } else if (type === 'door') {
    ctx.fillStyle = '#7a4a2a'; ctx.fillRect(x, y, w, h)
  }
}

function drawZone(ctx, z, now) {
  const [x, y, w, h] = z.r
  ctx.save()
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip()
  if (z.type === 'ice') {
    ctx.fillStyle = 'rgba(150,215,245,.55)'; ctx.fillRect(x, y, w, h)
    ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 4
    ctx.beginPath()
    for (let i = 0; i < (w * h) / 22000; i++) { const px = x + ((i * 211) % w), py = y + ((i * 137) % h); ctx.moveTo(px, py); ctx.lineTo(px + 34, py - 18) }
    ctx.stroke()
  } else if (z.type === 'stairs') {
    ctx.fillStyle = '#c7b89d'; ctx.fillRect(x, y, w, h)
    for (let yy = y; yy < y + h; yy += 34) {
      ctx.fillStyle = 'rgba(0,0,0,.16)'; ctx.fillRect(x, yy + 26, w, 8)
      ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fillRect(x, yy, w, 4)
    }
  } else if (z.type === 'belt') {
    const slope = z.look === 'slope'
    if (!slope) { ctx.fillStyle = '#2b2f35'; ctx.fillRect(x, y, w, h) }
    // 流れる向きの矢じるし（時間で動く）
    const sp = Math.hypot(z.vx || 0, z.vy || 0) || 1
    const ux = (z.vx || 0) / sp, uy = (z.vy || 0) / sp
    const off = ((now / 1000) * sp) % 80
    ctx.strokeStyle = slope ? 'rgba(90,120,160,.25)' : 'rgba(255,204,0,.55)'; ctx.lineWidth = slope ? 5 : 7; ctx.lineCap = 'round'
    ctx.beginPath()
    for (let i = -1; i < (Math.abs(ux) > 0.5 ? w : h) / 80 + 1; i++) {
      for (let j = 0; j < (Math.abs(ux) > 0.5 ? h : w) / 70; j++) {
        const along = i * 80 + off, across = j * 70 + 35
        const px = Math.abs(ux) > 0.5 ? x + (ux > 0 ? along : w - along) : x + across
        const py = Math.abs(ux) > 0.5 ? y + across : y + (uy > 0 ? along : h - along)
        ctx.moveTo(px - ux * 12 - uy * 14, py - uy * 12 + ux * 14); ctx.lineTo(px + ux * 8, py + uy * 8); ctx.lineTo(px - ux * 12 + uy * 14, py - uy * 12 - ux * 14)
      }
    }
    ctx.stroke()
    if (!slope) { ctx.fillStyle = '#ffcc00'; ctx.fillRect(x, y, w, 5); ctx.fillRect(x, y + h - 5, w, 5) }
  }
  ctx.restore()
}

function drawWall(ctx, [x, y, w, h], theme) {
  const c = { snow: ['#ffffff', '#dfe8f1', '#a9bcd0'], street: ['#5b5f68', '#6d727c', '#33363c'], factory: ['#4a4f57', '#5d636c', '#2a2d32'], apartment: ['#8a7c6a', '#9c8e7b', '#5b5044'] }[theme] || ['#3a3f4b', '#4b5261', '#22252d']
  ctx.fillStyle = c[0]
  ctx.fillRect(x, y, w, h)
  ctx.fillStyle = c[1]
  ctx.fillRect(x, y, w, Math.min(10, h))
  ctx.strokeStyle = c[2]; ctx.lineWidth = 3
  ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3)
}

function drawPit(ctx, [x, y, w, h], theme) {
  ctx.save()
  if (theme === 'snow') {
    // 冷たい水
    const gr = ctx.createLinearGradient(x, y, x, y + h)
    gr.addColorStop(0, '#1f4f78'); gr.addColorStop(1, '#0d2740')
    ctx.fillStyle = gr; ctx.fillRect(x, y, w, h)
    ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 3
    ctx.beginPath(); for (let yy = y + 20; yy < y + h; yy += 36) { ctx.moveTo(x + 10, yy); ctx.quadraticCurveTo(x + w / 2, yy - 10, x + w - 10, yy) } ctx.stroke()
  } else {
    ctx.fillStyle = '#ffcc00'
    ctx.fillRect(x - 8, y - 8, w + 16, h + 16)
    ctx.beginPath(); ctx.rect(x - 8, y - 8, w + 16, h + 16); ctx.clip()
    ctx.strokeStyle = '#1b1b1b'; ctx.lineWidth = 8
    ctx.beginPath()
    for (let k = -h; k < w + h; k += 22) { ctx.moveTo(x - 8 + k, y - 8); ctx.lineTo(x - 8 + k - h - 16, y + h + 8) }
    ctx.stroke()
    ctx.restore(); ctx.save()
    const gr = ctx.createRadialGradient(x + w / 2, y + h / 2, 4, x + w / 2, y + h / 2, Math.max(w, h) * 0.7)
    gr.addColorStop(0, '#000'); gr.addColorStop(1, '#1d1712')
    ctx.fillStyle = gr
    ctx.fillRect(x, y, w, h)
  }
  if (w > 120 && h > 80) {
    ctx.fillStyle = 'rgba(255,204,0,.75)'; ctx.font = '800 26px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(theme === 'snow' ? '川' : theme === 'apartment' ? '吹き抜け' : '穴', x + w / 2, y + h / 2)
    ctx.textBaseline = 'alphabetic'
  }
  ctx.restore()
}

function drawGoal(ctx, course) {
  const [x, y, w, h] = course.goal
  ctx.fillStyle = 'rgba(61,220,151,.3)'
  ctx.fillRect(x, y, w, h)
  ctx.strokeStyle = '#1fbf7a'; ctx.lineWidth = 5; ctx.setLineDash([16, 10])
  ctx.strokeRect(x, y, w, h)
  ctx.setLineDash([])
  ctx.textAlign = 'center'
  ctx.fillStyle = '#0d5c3a'; ctx.font = '800 30px system-ui, sans-serif'
  ctx.fillText('ゴール', x + w / 2, y + h / 2 + 2)
  if (course.goalLabel) { ctx.font = '700 18px system-ui, sans-serif'; ctx.fillText(course.goalLabel, x + w / 2, y + h / 2 + 26) }
}

function drawMover(ctx, m, p) {
  const { w, h } = m
  const dir = Math.abs(p.vx) > 1 ? Math.sign(p.vx) : 1
  if (m.kind === 'person') {
    drawPerson(ctx, p.x, p.y, m.color, { look: [p.vx, p.vy], walk: p.x * 0.08, face: 'calm', badge: null, scale: 1.1 })
    return
  }
  ctx.save()
  ctx.translate(p.x, p.y)
  ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(-w / 2 + 5, -h / 2 + 7, w, h)
  if (m.kind === 'car') {
    ctx.scale(dir, 1)
    rr(ctx, -w / 2, -h / 2, w, h, 18, m.color)
    rr(ctx, -w / 2 + 34, -h / 2 + 10, w - 66, h - 20, 10, 'rgba(255,255,255,.18)')
    ctx.fillStyle = '#1b2733'; ctx.fillRect(w / 2 - 44, -h / 2 + 10, 14, h - 20) // 前の窓
    ctx.fillRect(-w / 2 + 18, -h / 2 + 12, 10, h - 24)
    ctx.fillStyle = '#ffe9a0'; ctx.fillRect(w / 2 - 6, -h / 2 + 8, 6, 14); ctx.fillRect(w / 2 - 6, h / 2 - 22, 6, 14)
    ctx.fillStyle = '#111'; for (const [ax, ay] of [[-w / 2 + 22, -h / 2 - 4], [w / 2 - 46, -h / 2 - 4], [-w / 2 + 22, h / 2 - 4], [w / 2 - 46, h / 2 - 4]]) ctx.fillRect(ax, ay, 24, 8)
  } else if (m.kind === 'bike') {
    ctx.scale(dir, 1)
    ctx.strokeStyle = '#222'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(-w / 2, 0); ctx.lineTo(w / 2, 0); ctx.stroke()
    ctx.fillStyle = m.color; ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#ffd9b3'; ctx.beginPath(); ctx.arc(4, 0, 7, 0, Math.PI * 2); ctx.fill()
  } else if (m.kind === 'plow') {
    ctx.scale(dir, 1)
    rr(ctx, -w / 2, -h / 2, w - 30, h, 8, m.color)
    ctx.fillStyle = '#c9d2db'; ctx.fillRect(w / 2 - 30, -h / 2 - 8, 26, h + 16) // 雪かきの刃
    ctx.fillStyle = '#1b2733'; ctx.fillRect(w / 2 - 66, -h / 2 + 10, 18, h - 20)
  } else if (m.kind === 'piston') {
    ctx.fillStyle = '#9aa3ad'; ctx.fillRect(-w / 2, -h / 2, w, h)
    ctx.fillStyle = '#c3cad2'; ctx.fillRect(-w / 2, -h / 2, w, 10)
    ctx.save(); ctx.beginPath(); ctx.rect(-w / 2, -h / 2, w, h); ctx.clip()
    ctx.strokeStyle = 'rgba(255,204,0,.8)'; ctx.lineWidth = 10
    const face = (m.swing.b[0] - m.swing.a[0]) > 0 ? 1 : -1
    ctx.beginPath(); for (let k = -h; k < 60; k += 26) { ctx.moveTo(face * (w / 2 - 60 + k), -h / 2); ctx.lineTo(face * (w / 2 - 60 + k + h), h / 2) } ctx.stroke()
    ctx.restore()
    ctx.strokeStyle = '#3d434b'; ctx.lineWidth = 4; ctx.strokeRect(-w / 2 + 2, -h / 2 + 2, w - 4, h - 4)
  } else if (m.kind === 'fork') {
    ctx.scale(dir, 1)
    rr(ctx, -w / 2, -h / 2, w - 34, h, 10, m.color)
    ctx.fillStyle = '#555'; ctx.fillRect(w / 2 - 34, -h / 2 + 10, 34, 8); ctx.fillRect(w / 2 - 34, h / 2 - 18, 34, 8)
    ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(-10, 0, 12, 0, Math.PI * 2); ctx.fill()
  }
  ctx.restore()
}

function rr(ctx, x, y, w, h, r, fill) {
  ctx.fillStyle = fill
  ctx.beginPath()
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath(); ctx.fill()
}

function drawCargo(ctx, cargo, p, k = 1) {
  const hw = cargo.w / 2, hh = cargo.h / 2
  ctx.save()
  ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.scale(k, k)
  // 影
  ctx.fillStyle = 'rgba(0,0,0,.25)'
  ctx.fillRect(-hw + 6, -hh + 8, cargo.w, cargo.h)
  if (cargo === CARGOS.tank) {
    ctx.fillStyle = '#9fd6ea'; ctx.fillRect(-hw, -hh, cargo.w, cargo.h)
    ctx.fillStyle = '#4aa3c7'; ctx.fillRect(-hw + 6, -hh + 6, cargo.w - 12, cargo.h - 12)
    ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.fillRect(-hw + 10, -hh + 10, 10, cargo.h - 20)
    // 魚（傷むと慌てて泳ぐ）
    const wob = ui.last.hp < cargo.hp * 0.4 ? Math.sin(performance.now() / 60) * 6 : Math.sin(performance.now() / 400) * 3
    ctx.fillStyle = '#ff9a4d'
    ctx.beginPath(); ctx.ellipse(18 + wob, -10, 12, 6, 0, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.moveTo(30 + wob, -10); ctx.lineTo(40 + wob, -17); ctx.lineTo(40 + wob, -3); ctx.fill()
    ctx.fillStyle = '#ff6b9a'
    ctx.beginPath(); ctx.ellipse(-20 - wob, 14, 9, 5, 0, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = '#1d4e63'; ctx.lineWidth = 3; ctx.strokeRect(-hw, -hh, cargo.w, cargo.h)
  } else if (cargo === CARGOS.crate) {
    ctx.fillStyle = '#c8935a'; ctx.fillRect(-hw, -hh, cargo.w, cargo.h)
    ctx.strokeStyle = '#8a5a2e'; ctx.lineWidth = 8; ctx.strokeRect(-hw + 4, -hh + 4, cargo.w - 8, cargo.h - 8)
    ctx.beginPath(); ctx.moveTo(-hw + 6, -hh + 6); ctx.lineTo(hw - 6, hh - 6); ctx.stroke()
    ctx.fillStyle = '#3a3f47'; for (const [x, y] of [[-hw, -hh], [hw - 14, -hh], [-hw, hh - 14], [hw - 14, hh - 14]]) ctx.fillRect(x, y, 14, 14)
  } else if (cargo === CARGOS.piano) {
    rr(ctx, -hw, -hh, cargo.w, cargo.h, 8, '#1d1f24')
    ctx.fillStyle = '#34373e'; ctx.fillRect(-hw + 8, -hh + 8, cargo.w - 16, cargo.h - 34)
    // 鍵盤（右側の辺に沿って）
    ctx.fillStyle = '#f4f1ea'; ctx.fillRect(-hw + 8, hh - 22, cargo.w - 16, 16)
    ctx.fillStyle = '#111'; for (let x = -hw + 14; x < hw - 12; x += 11) ctx.fillRect(x, hh - 22, 5, 9)
    ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(-hw + 12, -hh + 12, cargo.w - 24, 6)
  } else if (cargo === CARGOS.mattress) {
    rr(ctx, -hw, -hh, cargo.w, cargo.h, 14, '#e9e4f5')
    ctx.strokeStyle = 'rgba(120,100,170,.35)'; ctx.lineWidth = 2
    ctx.beginPath(); for (let x = -hw + 20; x < hw; x += 20) { ctx.moveTo(x, -hh + 6); ctx.lineTo(x, hh - 6) } ctx.stroke()
    ctx.fillStyle = 'rgba(120,100,170,.4)'; for (let x = -hw + 20; x < hw; x += 20) for (const y of [-hh / 2, hh / 2]) { ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill() }
    ctx.strokeStyle = '#8f83b5'; ctx.lineWidth = 3; ctx.stroke()
  } else {
    ctx.fillStyle = '#8f3626'; ctx.fillRect(-hw, -hh, cargo.w, cargo.h)
    ctx.fillStyle = cargo.color; ctx.fillRect(-hw + 10, -hh + 14, cargo.w - 20, cargo.h - 20)
    // 背もたれ（左側）と肘かけ（前と後ろ）
    ctx.fillStyle = '#a5402d'; ctx.fillRect(-hw, -hh, cargo.w, 14); ctx.fillRect(-hw, -hh, 10, cargo.h); ctx.fillRect(hw - 10, -hh, 10, cargo.h)
    ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 2
    ctx.beginPath(); ctx.moveTo(0, -hh + 14); ctx.lineTo(0, hh - 6); ctx.stroke()
    ctx.strokeStyle = '#5a1f14'; ctx.lineWidth = 3; ctx.strokeRect(-hw, -hh, cargo.w, cargo.h)
  }
  // 傷（耐久が減るほどひびが増える）
  const dmg = 1 - ui.last.hp / cargo.hp
  if (dmg > 0.25) {
    ctx.strokeStyle = 'rgba(20,10,5,.6)'; ctx.lineWidth = 2
    ctx.beginPath()
    const n = Math.floor(dmg * 6)
    for (let i = 0; i < n; i++) { const sx = -hw + ((i * 47) % cargo.w), sy = -hh + ((i * 29) % cargo.h); ctx.moveTo(sx, sy); ctx.lineTo(sx + 12, sy + 8); ctx.lineTo(sx + 6, sy + 18) }
    ctx.stroke()
  }
  // 前の印（三角）
  ctx.fillStyle = cargo === CARGOS.mattress ? 'rgba(80,60,130,.9)' : 'rgba(255,255,255,.9)'
  ctx.beginPath(); ctx.moveTo(hw - 4, 0); ctx.lineTo(hw - 16, -8); ctx.lineTo(hw - 16, 8); ctx.closePath(); ctx.fill()
  ctx.restore()
  // 真ん中（重心の印）。ここが穴に入ると落ちる
  ctx.save()
  ctx.translate(p.x, p.y)
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 3
  ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(-13, 0); ctx.lineTo(13, 0); ctx.moveTo(0, -13); ctx.lineTo(0, 13); ctx.stroke()
  ctx.strokeStyle = '#111'; ctx.lineWidth = 1.2
  ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.stroke()
  ctx.restore()
}

// 運ぶ人（上から見下ろした絵ではなく、顔が見える立ち姿で描く）
function drawPerson(ctx, x, y, col, { look = [0, 0], walk = 0, face = 'calm', badge = null, mine = false, scale = 1, hop = 0 }) {
  ctx.save()
  ctx.translate(x, y - hop); ctx.scale(scale, scale)
  ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); ctx.ellipse(0, 16 + hop / scale, 15, 6, 0, 0, Math.PI * 2); ctx.fill()
  // 足（歩くと交互に出る）
  const sw = Math.sin(walk) * 5
  ctx.fillStyle = '#2b2f38'
  ctx.fillRect(-8, 6 + sw * 0.4, 6, 10); ctx.fillRect(2, 6 - sw * 0.4, 6, 10)
  // 体
  if (mine) rr(ctx, -13, -9, 26, 20, 8, '#ffffff')
  rr(ctx, -11, -7, 22, 17, 7, col)
  if (badge != null) { ctx.fillStyle = '#111'; ctx.font = '800 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(badge, 0, 2) }
  // 頭
  ctx.fillStyle = '#ffd9b3'; ctx.beginPath(); ctx.arc(0, -17, 11, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#3a2a20'; ctx.beginPath(); ctx.arc(0, -19, 11, Math.PI * 1.05, Math.PI * 1.95); ctx.fill()
  ctx.strokeStyle = '#111'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(0, -17, 11, 0, Math.PI * 2); ctx.stroke()
  // 目は押す向きを見る
  const lm = Math.hypot(look[0], look[1]) || 1
  const ex = (look[0] / lm) * 2.2, ey = (look[1] / lm) * 1.6
  ctx.fillStyle = '#111'
  if (face === 'shock') { ctx.beginPath(); ctx.arc(-4, -18, 2.6, 0, Math.PI * 2); ctx.arc(4, -18, 2.6, 0, Math.PI * 2); ctx.fill() }
  else if (face === 'happy') { ctx.lineWidth = 1.8; ctx.beginPath(); ctx.arc(-4, -17, 2.4, Math.PI, 0); ctx.moveTo(6.4, -17); ctx.arc(4, -17, 2.4, Math.PI, 0); ctx.stroke() }
  else { ctx.beginPath(); ctx.arc(-4 + ex, -18 + ey, 1.8, 0, Math.PI * 2); ctx.arc(4 + ex, -18 + ey, 1.8, 0, Math.PI * 2); ctx.fill() }
  // 口
  ctx.lineWidth = 1.8; ctx.beginPath()
  if (face === 'happy') { ctx.arc(0, -13, 4, 0.15 * Math.PI, 0.85 * Math.PI) }
  else if (face === 'shock') { ctx.moveTo(2.6, -11); ctx.arc(0, -11, 2.6, 0, Math.PI * 2) }
  else if (face === 'strain') { ctx.moveTo(-4, -11); ctx.lineTo(4, -11) }
  else if (face === 'worry') { ctx.arc(0, -9, 3.5, 1.2 * Math.PI, 1.8 * Math.PI) }
  else { ctx.arc(0, -12.5, 2.5, 0.2 * Math.PI, 0.8 * Math.PI) }
  ctx.stroke()
  if (face === 'strain') { // 汗
    ctx.fillStyle = '#7fd3ff'; ctx.beginPath(); ctx.moveTo(12, -26); ctx.quadraticCurveTo(16, -19, 12, -17); ctx.quadraticCurveTo(8, -19, 12, -26); ctx.fill()
  }
  ctx.restore()
}

function handleWorld(p, i) {
  const { cargo } = ui
  const c = Math.cos(p.a), s = Math.sin(p.a)
  const hw = cargo.w / 2, hh = cargo.h / 2
  const [lx, ly] = ui.offs[i]
  // 持ち手から外へ少し出た所に人を立たせる
  let ox = 0, oy = 0
  if (Math.abs(lx) >= hw - 0.5) ox = Math.sign(lx)
  if (Math.abs(ly) >= hh - 0.5) oy = Math.sign(ly)
  const ol = Math.hypot(ox, oy) || 1
  const px = lx + (ox / ol) * 24, py = ly + (oy / ol) * 24
  return { wx: p.x + px * c - py * s, wy: p.y + px * s + py * c, hx: p.x + lx * c - ly * s, hy: p.y + lx * s + ly * c }
}

function drawHandles(ctx, cargo, p, scale, now) {
  const g = ui.last
  const done = g.done
  const hop = done === 'goal' && ui.doneAt ? Math.abs(Math.sin((now - ui.doneAt) / 160)) * 14 : 0
  for (let i = 0; i < ui.offs.length; i++) {
    const { wx, wy, hx, hy } = handleWorld(p, i)
    const h = g.hs[i] || [null, 0, 0, 0]
    const on = h[3] === 1
    const col = on ? PLAYER_COLORS[i] : '#777'
    const mine = i === g.me
    const ux = h[1], uy = h[2], um = Math.hypot(ux, uy)
    // 腕
    ctx.strokeStyle = col; ctx.lineWidth = 5; ctx.lineCap = 'round'
    ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(wx, wy - 4); ctx.stroke()
    // 押す向きの矢印
    if (on && um > 0.05 && !done) {
      const L = 26 + um * 34
      const ex = wx + (ux / um) * L, ey = wy + (uy / um) * L
      ctx.strokeStyle = mine ? '#fff' : col; ctx.lineWidth = mine ? 6 : 4
      ctx.beginPath(); ctx.moveTo(wx, wy); ctx.lineTo(ex, ey); ctx.stroke()
      const ang = Math.atan2(uy, ux)
      ctx.fillStyle = mine ? '#fff' : col
      ctx.beginPath(); ctx.moveTo(ex + Math.cos(ang) * 10, ey + Math.sin(ang) * 10)
      ctx.lineTo(ex + Math.cos(ang + 2.4) * 11, ey + Math.sin(ang + 2.4) * 11)
      ctx.lineTo(ex + Math.cos(ang - 2.4) * 11, ey + Math.sin(ang - 2.4) * 11)
      ctx.closePath(); ctx.fill()
    }
    // 表情: 着いたら笑う、落ちた・壊れたら驚く、力んでいるのに進まないと汗、荷物が傷むと不安
    let face = 'calm'
    if (done === 'goal') face = 'happy'
    else if (done) face = 'shock'
    else if (!on) face = 'calm'
    else if (um > 0.5 && (ui.speed || 0) < 25) face = 'strain'
    else if (g.hp < ui.cargo.hp * 0.35) face = 'worry'
    drawPerson(ctx, wx, wy, col, { look: um > 0.05 ? [ux, uy] : [p.x - wx, p.y - wy], walk: ui.walk + i * 1.7, face, badge: on ? String(i + 1) : '×', mine, hop: hop * ((i % 2) ? 0.7 : 1) })
    // 名前。人の外側（持ち手の向き）に置いて、隣の人の名前と重なりにくくする。人数が多いときは4文字まで
    const name = (h[0] && ui.names.get(h[0])) || ''
    let label = mine ? 'あなた' : name
    if (!mine && ui.n > 4 && [...label].length > 4) label = [...label].slice(0, 4).join('') + '…'
    if (label) {
      const fs = 12 / scale // 画面上で 12px に見える大きさ（縮尺に引きずられて読めなくならない）
      ctx.font = `700 ${fs}px system-ui, sans-serif`
      const tw = ctx.measureText(label).width + fs * 0.8, th = fs * 1.45
      const dx = wx - p.x, dy = wy - p.y, dl = Math.hypot(dx, dy) || 1
      // 外向きの先に、札の中心を置く（札の幅の半分だけ余分に離す）
      const reach = 26 + Math.abs(dx / dl) * tw / 2 + Math.abs(dy / dl) * th / 2
      const lx2 = wx + (dx / dl) * reach, ly2 = wy + (dy / dl) * reach
      ctx.fillStyle = mine ? '#fff' : 'rgba(0,0,0,.72)'
      ctx.fillRect(lx2 - tw / 2, ly2 - th / 2, tw, th)
      ctx.fillStyle = mine ? '#111' : '#fff'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(label, lx2, ly2 + fs * 0.05)
      ctx.textBaseline = 'alphabetic'
    }
  }
}

// かけ声の吹き出し（言った人の頭の上）
function drawBubbles(ctx, cargo, p, scale, now) {
  const em = ui.last.em || []
  for (const [h, k] of em) {
    if (h >= ui.offs.length) continue
    const { wx, wy } = handleWorld(p, h)
    const fs = 15 / scale
    const text = EMOTES[k] || ''
    ctx.font = `800 ${fs}px system-ui, sans-serif`
    const tw = ctx.measureText(text).width + fs * 1.1, th = fs * 1.7
    // 名前の札が頭の上にある人（荷物より上に立つ人）は、札のさらに上に出す
    const above = wy < p.y - 10 && Math.abs(wy - p.y) > Math.abs(wx - p.x) * 0.6
    const bx = wx, by = wy - (above ? 44 + 26 / scale : 40) - th / 2
    const bw = 3 / scale // 縁は言った人の色
    rr(ctx, bx - tw / 2 - bw, by - th / 2 - bw, tw + bw * 2, th + bw * 2, th / 2 + bw, PLAYER_COLORS[h])
    ctx.beginPath(); ctx.moveTo(bx - 7, by + th / 2); ctx.lineTo(bx + 7, by + th / 2); ctx.lineTo(bx, by + th / 2 + 10 + bw); ctx.fill()
    rr(ctx, bx - tw / 2, by - th / 2, tw, th, th / 2, '#ffffff')
    ctx.fillStyle = '#111'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(text, bx, by + fs * 0.05)
    ctx.textBaseline = 'alphabetic'
  }
}

function drawPops(ctx, p, scale, now) {
  ui.pops = ui.pops.filter(q => now - q.t < 800)
  for (const q of ui.pops) {
    const k = (now - q.t) / 800
    const fs = (26 + k * 10) / scale
    ctx.globalAlpha = 1 - k
    ctx.font = `900 ${fs}px system-ui, sans-serif`; ctx.textAlign = 'center'
    ctx.lineWidth = 5 / scale; ctx.strokeStyle = '#111'; ctx.strokeText(q.text, p.x, p.y - 70 - k * 40)
    ctx.fillStyle = q.color; ctx.fillText(q.text, p.x, p.y - 70 - k * 40)
    ctx.globalAlpha = 1
  }
}

function drawParts(ctx, kind) {
  for (const q of ui.parts) {
    if (q.kind !== kind) continue
    const a = 1 - q.age / q.life
    ctx.globalAlpha = kind === 'dust' ? a * 0.5 : a
    ctx.fillStyle = q.color
    if (kind === 'conf') {
      ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.age * q.spin); ctx.fillRect(-q.r, -q.r / 2, q.r * 2, q.r); ctx.restore()
    } else {
      ctx.beginPath(); ctx.arc(q.x, q.y, q.r * (kind === 'dust' ? 1 + q.age * 2 : 1), 0, Math.PI * 2); ctx.fill()
    }
  }
  ctx.globalAlpha = 1
}

function drawSnowfall(ctx, W, H, now) {
  if (!ui.flakes) ui.flakes = Array.from({ length: 60 }, (_, i) => ({ x: (i * 97) % 1000 / 1000, y: (i * 389) % 1000 / 1000, s: 0.5 + ((i * 7) % 10) / 10 }))
  ctx.fillStyle = 'rgba(255,255,255,.85)'
  for (const f of ui.flakes) {
    const y = ((f.y + (now / 1000) * 0.06 * f.s) % 1) * H
    const x = ((f.x + Math.sin(now / 1500 + f.y * 9) * 0.01) % 1) * W
    ctx.beginPath(); ctx.arc(x, y, 1.2 + f.s * 1.6, 0, Math.PI * 2); ctx.fill()
  }
}

function drawMinimap(ctx, W, H, course, p, gt) {
  const [CW, CH] = course.size
  const mh = Math.min(130, H * 0.3), mw = (mh * CW) / CH
  const x0 = W - mw - 10, y0 = 94 // 上の HUD と道のりの帯の下
  const k = mh / CH
  ctx.fillStyle = 'rgba(14,15,19,.72)'
  ctx.fillRect(x0 - 3, y0 - 3, mw + 6, mh + 6)
  ctx.fillStyle = 'rgba(180,138,90,.55)'; ctx.fillRect(x0, y0, mw, mh)
  for (const z of course.zones || []) { ctx.fillStyle = z.type === 'ice' ? 'rgba(150,215,245,.8)' : z.type === 'stairs' ? 'rgba(220,200,160,.8)' : 'rgba(255,204,0,.45)'; ctx.fillRect(x0 + z.r[0] * k, y0 + z.r[1] * k, z.r[2] * k, z.r[3] * k) }
  for (const d of course.deco || []) if (d[0] === 'road') { ctx.fillStyle = 'rgba(40,42,48,.85)'; ctx.fillRect(x0 + d[1] * k, y0 + d[2] * k, d[3] * k, d[4] * k) }
  ctx.fillStyle = '#3ddc97'; const g = course.goal; ctx.fillRect(x0 + g[0] * k, y0 + g[1] * k, g[2] * k, g[3] * k)
  ctx.fillStyle = '#000'; for (const q of course.pits) ctx.fillRect(x0 + q[0] * k, y0 + q[1] * k, q[2] * k, q[3] * k)
  ctx.fillStyle = '#2a2e37'; for (const q of course.walls) ctx.fillRect(x0 + q[0] * k, y0 + q[1] * k, Math.max(1, q[2] * k), Math.max(1, q[3] * k))
  ctx.fillStyle = '#ff6b6b'
  for (const m of course.movers || []) { const q = moverAt(m, gt); ctx.fillRect(x0 + (q.x - m.w / 2) * k, y0 + (q.y - m.h / 2) * k, Math.max(2, m.w * k), Math.max(2, m.h * k)) }
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5
  ctx.beginPath(); ctx.arc(x0 + p.x * k, y0 + p.y * k, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
}

// ゴールが画面の外にあるとき、その向きを画面の縁に出す
function drawGoalArrow(ctx, W, H, scale, cx, cy, [gx, gy, gw, gh]) {
  const tx = (gx + gw / 2 - cx) * scale + W / 2, ty = (gy + gh / 2 - cy) * scale + H / 2
  if (tx > 0 && tx < W && ty > 0 && ty < H) return
  const dx = tx - W / 2, dy = ty - H / 2
  const k = Math.min((W / 2 - 28) / Math.abs(dx || 1e-6), (H / 2 - 28) / Math.abs(dy || 1e-6))
  const ax = W / 2 + dx * k, ay = H / 2 + dy * k, ang = Math.atan2(dy, dx)
  ctx.save(); ctx.translate(ax, ay); ctx.rotate(ang)
  ctx.fillStyle = '#3ddc97'; ctx.strokeStyle = '#0b3'; ctx.lineWidth = 2
  ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(-10, -12); ctx.lineTo(-4, 0); ctx.lineTo(-10, 12); ctx.closePath(); ctx.fill(); ctx.stroke()
  ctx.restore()
}

// ---- 結果
const BEST_KEY = 'ct-best-v1'
const MEDAL = { gold: ['金', '#f5c542'], silver: ['銀', '#cfd6de'], bronze: ['銅', '#d08a4e'] }
export function loadBest() { try { return JSON.parse(localStorage.getItem(BEST_KEY) || '{}') || {} } catch { return {} } }
const RANK = { gold: 3, silver: 2, bronze: 1 }
// 自己ベストを記録する（このブラウザだけ）。同じラウンドを二度数えない
function saveBest(r, round) {
  const all = loadBest()
  const key = `${r.courseId}:${r.cargoId}`
  const old = all[key]
  const seen = `${round}:${r.time}`
  if (old && old.seen === seen) return { isBest: old.bestSeen === seen, old: old.prev }
  const better = !old || r.time < old.time
  const medal = !old || (RANK[r.medal] || 0) > (RANK[old.medal] || 0) ? r.medal : old.medal
  all[key] = { time: better ? r.time : old.time, medal, seen, bestSeen: better ? seen : old.bestSeen, prev: old ? old.time : null }
  try { localStorage.setItem(BEST_KEY, JSON.stringify(all)) } catch {}
  return { isBest: better, old: old ? old.time : null }
}

let playedRound = 0
export function renderResult(state) {
  teardown()
  const r = state.result
  if (playedRound !== state.round) { playedRound = state.round; if (r.win) sfx.win(r.medal); else sfx.lose() }
  const box = document.createElement('div')
  box.className = 'res'
  const top = document.createElement('div')
  top.className = 'res-top'
  if (r.win && r.medal) {
    const [nm, col] = MEDAL[r.medal]
    const m = document.createElement('div')
    m.className = 'medal'
    m.dataset.m = r.medal
    m.innerHTML = `<svg viewBox="0 0 64 74" aria-hidden="true"><path d="M18 2h10l6 22-10 4zM46 2H36l-6 22 10 4z" fill="#e84d4d"/><circle cx="32" cy="46" r="24" fill="${col}" stroke="#0006" stroke-width="3"/><circle cx="32" cy="46" r="16" fill="none" stroke="#fff8" stroke-width="2"/></svg><b>${nm}</b>`
    top.append(m)
  }
  const stamp = document.createElement('p')
  stamp.className = 'res-reason'
  stamp.textContent = `${r.course}　${r.reason}`
  top.append(stamp)
  if (r.win && r.courseId && r.cargoId) {
    const b = saveBest(r, state.round)
    const best = document.createElement('p')
    best.className = 'res-best'
    best.textContent = b.isBest ? (b.old != null ? `自己ベスト更新！（前は ${b.old}秒）` : '初めての配達記録！') : `自己ベスト ${loadBest()[`${r.courseId}:${r.cargoId}`].time}秒`
    if (b.isBest) best.dataset.new = '1'
    top.append(best)
  }
  const stats = document.createElement('div')
  stats.className = 'res-stats'
  const stat = (k, v) => { const d = document.createElement('div'); d.innerHTML = `<small>${k}</small><b>${v}</b>`; return d }
  stats.append(
    stat('スコア', r.score),
    stat('時間', `${r.time}秒`),
    stat('耐久', `${r.hp}/${r.maxHp}`),
    stat('進んだ', `${r.progress}%`)
  )
  // ひとこと（MVP と、ぶつけた人）
  const notes = []
  const act = r.ranking.filter(p => !p.left && p.push > 2)
  if (act.length && act[0].value > 0) notes.push(`MVP ${act[0].name}（息ぴったり ${act[0].value}%）`)
  const basher = [...r.ranking].sort((a, b) => b.hits - a.hits)[0]
  if (basher && basher.hits >= 3) notes.push(`ぶつけ番長 ${basher.name}（${basher.hits}回）`)
  if (r.moverHits) notes.push(`${r.moverHits}回ひかれた・はさまれた`)
  const note = document.createElement('p')
  note.className = 'res-note'
  for (const t of notes) { const sp = document.createElement('span'); sp.textContent = t; note.append(sp) }
  const head = document.createElement('p')
  head.className = 'res-head'
  head.textContent = '息ぴったり率（押した向きが荷物の動きと合っていた割合）'
  const ol = document.createElement('ol')
  ol.className = r.ranking.length > 4 ? 'rank many' : 'rank'
  for (const p of r.ranking) {
    const li = document.createElement('li')
    const dot = document.createElement('span')
    dot.className = 'me-dot sm'
    dot.style.background = p.left ? '#777' : PLAYER_COLORS[p.h]
    dot.textContent = p.h + 1
    const nm = document.createElement('span')
    nm.className = 'rk-name'
    nm.textContent = r.ranking.length > 4 ? `${p.name}${p.left ? ' 退出' : ''}` : `${p.name}（${p.label}）${p.left ? ' 退出' : ''}`
    const v = document.createElement('span')
    v.className = 'rk-val'
    v.textContent = `${p.value}%`
    li.append(dot, nm, v)
    if (p.id === state.you) li.classList.add('me')
    ol.append(li)
  }
  box.append(top, stats)
  if (notes.length) box.append(note)
  box.append(head, ol)
  if (r.win) {
    const cf = document.createElement('div')
    cf.className = 'confetti'
    cf.setAttribute('aria-hidden', 'true')
    for (let i = 0; i < 28; i++) { const s = document.createElement('i'); s.style.left = `${(i * 37) % 100}%`; s.style.background = PLAYER_COLORS[i % 8]; s.style.animationDelay = `${(i % 7) * 0.12}s`; cf.append(s) }
    box.append(cf)
  }
  return box
}
