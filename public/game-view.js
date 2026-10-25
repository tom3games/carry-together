// ゲーム中の描画と操作。render(state, { send }) は状態が届くたびに呼ばれる。state.game はサーバーの view(自分)。
// 画面は届いた位置を少し遅らせて補間し、滑らかに見せるだけ。動きの計算はサーバーがする。
import { COURSES, CARGOS, handleOffsets, handleLabel, PLAYER_COLORS } from './stages.js'
import * as sfx from './sound.js'

const $ = s => document.querySelector(s)
const INTERP_MS = 110 // サーバーは 20Hz。2コマ分ほど遅らせて間を埋める

let ui = null // 1ラウンド分の画面の部品と状態

function build(state, send) {
  const g = state.game
  const root = $('#stage')
  root.innerHTML = `
    <div class="hud">
      <div class="hud-item" id="g-timeBox"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10 7v4l3 2M8 2h4" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg><span id="g-time"></span></div>
      <div class="hud-bar" aria-label="耐久"><span class="hud-lbl">耐久</span><div class="bar"><i id="g-hp"></i></div><span id="g-hpNum"></span></div>
      <button id="g-mute" class="icon-btn" aria-label="音"></button>
    </div>
    <div class="field-wrap" id="g-wrap"><canvas id="g-cv"></canvas>
      <div class="banner" id="g-banner" hidden></div>
    </div>
    <div class="ctl">
      <div class="me-card" id="g-me"></div>
      <div class="pad" id="g-pad" aria-label="押す向き（ドラッグ）"><div class="pad-ring"></div><div class="knob" id="g-knob"></div></div>
    </div>`
  const cv = $('#g-cv')
  ui = {
    round: state.round, send, cv, ctx: cv.getContext('2d'),
    course: COURSES[g.course], cargo: CARGOS[g.cargo], n: g.n,
    offs: handleOffsets(CARGOS[g.cargo], g.n),
    snaps: [], last: g, cam: null, shake: 0, bumpSeen: g.bump, cdSeen: g.cd,
    stick: [0, 0], keys: new Set(), sentAt: 0, sent: [0, 0], raf: 0, names: new Map()
  }
  setupPad()
  setupKeys()
  sfx.bindMuteButton($('#g-mute'))
  sfx.startBgm()
  // 送信ループ。変わったらすぐ、押している間は 250ms ごとに送り直す（サーバーは 0.8 秒届かないと手を離したとみなす）
  ui.sendTimer = setInterval(pushLoop, 50)
  window.__ct = { // e2e 用の読み取りと操作口
    view: () => ui && ui.last,
    push: (x, y) => { if (ui) { ui.auto = [x, y] } }
  }
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
  ui.snaps.push({ t: performance.now(), x: g.x, y: g.y, a: g.a })
  if (ui.snaps.length > 12) ui.snaps.shift()
  if (g.bump !== ui.bumpSeen) { ui.bumpSeen = g.bump; ui.shake = 1; sfx.bump(ui.cargo === CARGOS.tank) }
  if (g.cd !== ui.cdSeen) { ui.cdSeen = g.cd; sfx.count(g.cd) }
  updateHud(state)
  if (!ui.raf) ui.raf = requestAnimationFrame(frame)
}

function teardown() {
  if (!ui) return
  clearInterval(ui.sendTimer)
  cancelAnimationFrame(ui.raf)
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
  const label = g.me >= 0 ? handleLabel(ui.cargo, ui.offs[g.me]) : '-'
  const col = PLAYER_COLORS[g.me] || '#888'
  $('#g-me').innerHTML = `<span class="me-dot" style="background:${col}">${g.me + 1}</span><span><b>${label}</b>の持ち手<br><small>${ui.cargo.name}・${g.n}人</small></span>`
  const b = $('#g-banner')
  if (g.cd > 0) { b.hidden = false; b.dataset.kind = 'cd'; b.innerHTML = `<b>${g.cd}</b><span>あなたは「${label}」を持つ</span>` }
  else if (g.pull) { b.hidden = false; b.dataset.kind = 'warn'; b.innerHTML = '<span>引っぱりすぎ！ 裂ける</span>' }
  else b.hidden = true
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
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, a: a.a + da * k }
    }
  }
  return s[s.length - 1]
}

function frame() {
  ui.raf = 0
  if ($('#game').hidden) { teardown(); return } // 退出などでゲーム画面を離れたら、送信と BGM も止める
  const cv = ui.cv, ctx = ui.ctx
  const wrap = $('#g-wrap')
  const dpr = Math.min(2, devicePixelRatio || 1)
  const W = wrap.clientWidth, H = wrap.clientHeight
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr)
    cv.style.width = W + 'px'; cv.style.height = H + 'px'
  }
  const p = sample()
  if (p && W > 0 && H > 0) draw(ctx, W, H, dpr, p)
  ui.raf = requestAnimationFrame(frame)
}

function draw(ctx, W, H, dpr, p) {
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

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = '#0e0f13'
  ctx.fillRect(0, 0, W, H)
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * (W / 2 - cx * scale + sx), dpr * (H / 2 - cy * scale + sy))

  drawFloor(ctx, course)
  drawGoal(ctx, course.goal)
  for (const pit of course.pits) drawPit(ctx, pit)
  for (const w of course.walls) drawWall(ctx, w)
  drawCargo(ctx, cargo, p)
  drawHandles(ctx, cargo, p, scale)

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  drawMinimap(ctx, W, H, course, p)
  drawGoalArrow(ctx, W, H, scale, cx, cy, course.goal)
}

function drawFloor(ctx, course) {
  const [CW, CH] = course.size
  ctx.fillStyle = '#b48a5a'
  ctx.fillRect(0, 0, CW, CH)
  // 板の目
  ctx.strokeStyle = 'rgba(70,40,15,.28)'
  ctx.lineWidth = 2
  ctx.beginPath()
  for (let y = 0; y < CH; y += 46) {
    ctx.moveTo(0, y); ctx.lineTo(CW, y)
    const off = (y / 46) % 2 ? 0 : 90
    for (let x = off; x < CW; x += 180) { ctx.moveTo(x, y); ctx.lineTo(x, y + 46) }
  }
  ctx.stroke()
  // スタートの印
  const s = course.start
  ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.setLineDash([10, 8]); ctx.lineWidth = 3
  ctx.strokeRect(s.x - 110, s.y - 70, 220, 140)
  ctx.setLineDash([])
  ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.font = '700 22px system-ui, sans-serif'; ctx.textAlign = 'center'
  ctx.fillText('スタート', s.x, s.y + 100)
}

function drawWall(ctx, [x, y, w, h]) {
  ctx.fillStyle = '#3a3f4b'
  ctx.fillRect(x, y, w, h)
  ctx.fillStyle = '#4b5261'
  ctx.fillRect(x, y, w, Math.min(10, h))
  ctx.strokeStyle = '#22252d'; ctx.lineWidth = 3
  ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3)
}

function drawPit(ctx, [x, y, w, h]) {
  ctx.save()
  ctx.fillStyle = '#ffcc00'
  ctx.fillRect(x - 8, y - 8, w + 16, h + 16)
  ctx.beginPath(); ctx.rect(x - 8, y - 8, w + 16, h + 16); ctx.clip()
  ctx.strokeStyle = '#1b1b1b'; ctx.lineWidth = 8
  ctx.beginPath()
  for (let k = -h; k < w + h; k += 22) { ctx.moveTo(x - 8 + k, y - 8); ctx.lineTo(x - 8 + k - h - 16, y + h + 8) }
  ctx.stroke()
  ctx.restore()
  const gr = ctx.createRadialGradient(x + w / 2, y + h / 2, 4, x + w / 2, y + h / 2, Math.max(w, h) * 0.7)
  gr.addColorStop(0, '#000'); gr.addColorStop(1, '#1d1712')
  ctx.fillStyle = gr
  ctx.fillRect(x, y, w, h)
  if (w > 120) {
    ctx.fillStyle = 'rgba(255,204,0,.75)'; ctx.font = '800 26px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText('穴', x + w / 2, y + h / 2)
    ctx.textBaseline = 'alphabetic'
  }
}

function drawGoal(ctx, [x, y, w, h]) {
  ctx.fillStyle = 'rgba(61,220,151,.28)'
  ctx.fillRect(x, y, w, h)
  ctx.strokeStyle = '#3ddc97'; ctx.lineWidth = 5; ctx.setLineDash([16, 10])
  ctx.strokeRect(x, y, w, h)
  ctx.setLineDash([])
  ctx.fillStyle = '#e9fff4'; ctx.font = '800 30px system-ui, sans-serif'; ctx.textAlign = 'center'
  ctx.fillText('ゴール', x + w / 2, y + h / 2 + 10)
}

function drawCargo(ctx, cargo, p) {
  const hw = cargo.w / 2, hh = cargo.h / 2
  ctx.save()
  ctx.translate(p.x, p.y); ctx.rotate(p.a)
  // 影
  ctx.fillStyle = 'rgba(0,0,0,.25)'
  ctx.fillRect(-hw + 6, -hh + 8, cargo.w, cargo.h)
  if (cargo === CARGOS.tank) {
    ctx.fillStyle = '#9fd6ea'; ctx.fillRect(-hw, -hh, cargo.w, cargo.h)
    ctx.fillStyle = '#4aa3c7'; ctx.fillRect(-hw + 6, -hh + 6, cargo.w - 12, cargo.h - 12)
    ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.fillRect(-hw + 10, -hh + 10, 10, cargo.h - 20)
    // 魚
    ctx.fillStyle = '#ff9a4d'
    ctx.beginPath(); ctx.ellipse(18, -10, 12, 6, 0, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.moveTo(30, -10); ctx.lineTo(40, -17); ctx.lineTo(40, -3); ctx.fill()
    ctx.strokeStyle = '#1d4e63'; ctx.lineWidth = 3; ctx.strokeRect(-hw, -hh, cargo.w, cargo.h)
  } else {
    ctx.fillStyle = '#8f3626'; ctx.fillRect(-hw, -hh, cargo.w, cargo.h)
    ctx.fillStyle = cargo.color; ctx.fillRect(-hw + 10, -hh + 14, cargo.w - 20, cargo.h - 20)
    // 背もたれ（左側）と肘かけ（前と後ろ）
    ctx.fillStyle = '#a5402d'; ctx.fillRect(-hw, -hh, cargo.w, 14); ctx.fillRect(-hw, -hh, 10, cargo.h); ctx.fillRect(hw - 10, -hh, 10, cargo.h)
    ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 2
    ctx.beginPath(); ctx.moveTo(0, -hh + 14); ctx.lineTo(0, hh - 6); ctx.stroke()
    ctx.strokeStyle = '#5a1f14'; ctx.lineWidth = 3; ctx.strokeRect(-hw, -hh, cargo.w, cargo.h)
  }
  // 前の印（三角）
  ctx.fillStyle = 'rgba(255,255,255,.9)'
  ctx.beginPath(); ctx.moveTo(hw - 4, 0); ctx.lineTo(hw - 16, -8); ctx.lineTo(hw - 16, 8); ctx.closePath(); ctx.fill()
  ctx.restore()
  // 真ん中（重心）の印。ここが穴に入ると落ちる
  ctx.save()
  ctx.translate(p.x, p.y)
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 3
  ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(-13, 0); ctx.lineTo(13, 0); ctx.moveTo(0, -13); ctx.lineTo(0, 13); ctx.stroke()
  ctx.strokeStyle = '#111'; ctx.lineWidth = 1.2
  ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.stroke()
  ctx.restore()
}

function drawHandles(ctx, cargo, p, scale) {
  const g = ui.last
  const c = Math.cos(p.a), s = Math.sin(p.a)
  const hw = cargo.w / 2, hh = cargo.h / 2
  for (let i = 0; i < ui.offs.length; i++) {
    const [lx, ly] = ui.offs[i]
    // 持ち手から外へ少し出た所に人を立たせる
    let ox = 0, oy = 0
    if (Math.abs(lx) >= hw - 0.5) ox = Math.sign(lx)
    if (Math.abs(ly) >= hh - 0.5) oy = Math.sign(ly)
    const ol = Math.hypot(ox, oy) || 1
    const px = lx + (ox / ol) * 20, py = ly + (oy / ol) * 20
    const wx = p.x + px * c - py * s, wy = p.y + px * s + py * c
    const hx = p.x + lx * c - ly * s, hy = p.y + lx * s + ly * c
    const h = g.hs[i] || [null, 0, 0, 0]
    const on = h[3] === 1
    const col = on ? PLAYER_COLORS[i] : '#777'
    const mine = i === g.me
    // 腕
    ctx.strokeStyle = col; ctx.lineWidth = 5; ctx.lineCap = 'round'
    ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(wx, wy); ctx.stroke()
    // 押す向きの矢印
    const ux = h[1], uy = h[2], um = Math.hypot(ux, uy)
    if (on && um > 0.05) {
      const L = 22 + um * 34
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
    // 体
    if (mine) { ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.beginPath(); ctx.arc(wx, wy, 19, 0, Math.PI * 2); ctx.fill() }
    ctx.fillStyle = col
    ctx.beginPath(); ctx.arc(wx, wy, 15, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = '#111'; ctx.lineWidth = 2.5; ctx.stroke()
    ctx.fillStyle = '#111'; ctx.font = '800 16px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(on ? String(i + 1) : '×', wx, wy + 1)
    ctx.textBaseline = 'alphabetic'
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
      const reach = 22 + Math.abs(dx / dl) * tw / 2 + Math.abs(dy / dl) * th / 2
      const lx2 = wx + (dx / dl) * reach, ly2 = wy + (dy / dl) * reach
      ctx.fillStyle = mine ? '#fff' : 'rgba(0,0,0,.72)'
      ctx.fillRect(lx2 - tw / 2, ly2 - th / 2, tw, th)
      ctx.fillStyle = mine ? '#111' : '#fff'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, lx2, ly2 + fs * 0.05)
      ctx.textBaseline = 'alphabetic'
    }
  }
}

function drawMinimap(ctx, W, H, course, p) {
  const [CW, CH] = course.size
  const mh = Math.min(150, H * 0.34), mw = (mh * CW) / CH
  const x0 = W - mw - 8, y0 = 8
  const k = mh / CH
  ctx.fillStyle = 'rgba(14,15,19,.72)'
  ctx.fillRect(x0 - 3, y0 - 3, mw + 6, mh + 6)
  ctx.fillStyle = 'rgba(180,138,90,.55)'; ctx.fillRect(x0, y0, mw, mh)
  ctx.fillStyle = '#3ddc97'; const g = course.goal; ctx.fillRect(x0 + g[0] * k, y0 + g[1] * k, g[2] * k, g[3] * k)
  ctx.fillStyle = '#000'; for (const q of course.pits) ctx.fillRect(x0 + q[0] * k, y0 + q[1] * k, q[2] * k, q[3] * k)
  ctx.fillStyle = '#2a2e37'; for (const q of course.walls) ctx.fillRect(x0 + q[0] * k, y0 + q[1] * k, Math.max(1, q[2] * k), Math.max(1, q[3] * k))
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
let playedRound = 0
export function renderResult(state) {
  teardown()
  const r = state.result
  if (playedRound !== state.round) { playedRound = state.round; if (r.win) sfx.win(); else sfx.lose() }
  const box = document.createElement('div')
  box.className = 'res'
  const stamp = document.createElement('p')
  stamp.className = 'res-reason'
  stamp.textContent = r.reason
  const stats = document.createElement('div')
  stats.className = 'res-stats'
  const stat = (k, v) => { const d = document.createElement('div'); d.innerHTML = `<small>${k}</small><b>${v}</b>`; return d }
  stats.append(
    stat('スコア', r.score),
    stat('時間', `${r.time}秒`),
    stat('耐久', `${r.hp}/${r.maxHp}`),
    stat('進んだ', `${r.progress}%`)
  )
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
  box.append(stamp, stats, head, ol)
  return box
}
