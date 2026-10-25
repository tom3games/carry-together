// みんなで運べ！のルール。荷物の位置・向き・速度はサーバーだけが持つ。
// 各プレイヤーは自分の持ち手を押す向き（スティックの向き）だけを送る。
// 全員の押す力の合力で荷物が進み、持ち手の位置で生まれるトルクで回る。
//
// 約束（rooms.mjs から呼ばれる）: meta / createGame → tick, input, view, isOver, result, removePlayer

import { COURSES, CARGOS, DEFAULT_COURSE, DEFAULT_CARGO, handleOffsets, handleLabel } from '../public/stages.js'

export const meta = {
  id: 'carry-together',
  title: 'みんなで運べ！',
  minPlayers: 2,
  maxPlayers: 8,
  tickHz: 20 // 画面へ送る回数。物理はこの中で 60Hz の固定ステップに刻む
}

export const PHYS = {
  step: 1 / 60,
  force: 330,        // 全員が同じ向きに押したときの合計の力（質量1で最高速 110）
  linDamp: 3,        // 速度の減衰（毎秒）
  angDamp: 6,        // 回転の減衰（毎秒）
  restitution: 0.15, // 壁に当たったときの跳ね返り
  friction: 0.25,
  hitSafe: 28,       // この速さ以下でぶつけても傷まない
  hitDamage: 0.55,   // それを超えた速さ1あたりのダメージ（fragile 倍）
  pullLimit: 0.55,   // 全員の力のうち、外へ引っぱる成分がこの割合を超えると「引っぱりすぎ」
  pullDamage: 6,     // 引っぱりすぎの間、毎秒のダメージ（fragile 倍）
  inputTtl: 0.8,     // この秒数だけ操作が届かなければ、その人は手を離したとみなす
  countdown: 3
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const r1 = v => Math.round(v * 10) / 10

export function createGame(players, opts) {
  if (!opts || typeof opts !== 'object') opts = {}
  const rng = typeof opts.rng === 'function' ? opts.rng : Math.random // 画面から届く opts に関数は入らない。文字列などは無視
  const courseId = Object.hasOwn(COURSES, opts.course) ? opts.course : DEFAULT_COURSE
  const cargoId = Object.hasOwn(CARGOS, opts.cargo) ? opts.cargo : DEFAULT_CARGO
  const course = COURSES[courseId]
  const cargo = CARGOS[cargoId]

  const n = players.length
  const offs = handleOffsets(cargo, n)
  // 持ち手の割り当てはランダム
  const order = players.map(p => p.id)
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]] }
  const seats = new Map() // id -> seat
  order.forEach((id, i) => seats.set(id, {
    id, name: players.find(p => p.id === id).name, h: i, off: offs[i], label: handleLabel(cargo, offs[i]),
    ux: 0, uy: 0, at: -1, active: true, pushT: 0, goodT: 0, hits: 0
  }))

  const I = cargo.mass * (cargo.w ** 2 + cargo.h ** 2) / 12
  const body = { x: course.start.x, y: course.start.y, a: course.start.a, vx: 0, vy: 0, w: 0 }
  // 当たり判定に使う荷物の外周の点（ローカル）。10単位おき
  const samples = []
  {
    const hw = cargo.w / 2, hh = cargo.h / 2
    const nx = Math.ceil(cargo.w / 10), ny = Math.ceil(cargo.h / 10)
    for (let i = 0; i <= nx; i++) { const x = -hw + (cargo.w * i) / nx; samples.push([x, -hh], [x, hh]) }
    for (let i = 1; i < ny; i++) { const y = -hh + (cargo.h * i) / ny; samples.push([-hw, y], [hw, y]) }
  }

  let clock = 0          // ゲーム内の経過秒（カウントダウン込み）
  let acc = 0
  let hp = cargo.hp
  let over = false, outcome = null // 'goal' | 'fall' | 'broken' | 'time'
  let pulling = 0        // 引っぱりすぎ中か（画面の警告用）
  let bump = 0           // このステップでぶつけた強さ
  let hitMem = 0         // 直近に傷として数えた衝突の強さ（少しずつ減る）
  let bumpSeq = 0        // 傷むほどぶつけた回数（画面が揺れと音を出す合図）
  let finishedAt = null
  const startY = course.start.y
  const goalY = course.goal[1] + course.goal[3] / 2

  const playTime = () => Math.max(0, clock - PHYS.countdown)
  const timeLeft = () => Math.max(0, course.timeLimit - playTime())
  const inRect = (x, y, [rx, ry, rw, rh]) => x >= rx && x <= rx + rw && y >= ry && y <= ry + rh

  function worldOf([lx, ly]) {
    const c = Math.cos(body.a), s = Math.sin(body.a)
    return [body.x + lx * c - ly * s, body.y + lx * s + ly * c]
  }

  // 接触点に撃力を加える（速度だけ変える）。めり込みの位置直しは collide() でまとめてやる
  function impulse(px, py, nx, ny) {
    const rx = px - body.x, ry = py - body.y
    const vpx = body.vx - body.w * ry, vpy = body.vy + body.w * rx
    const vn = vpx * nx + vpy * ny
    if (vn >= 0) return
    const rn = rx * ny - ry * nx
    const j = (-(1 + PHYS.restitution) * vn) / (1 / cargo.mass + (rn * rn) / I)
    body.vx += (j * nx) / cargo.mass; body.vy += (j * ny) / cargo.mass
    body.w += (rn * j) / I
    // 摩擦（接線方向を少し止める）
    const tx = -ny, ty = nx
    const vt = vpx * tx + vpy * ty
    const rt = rx * ty - ry * tx
    let jt = -vt / (1 / cargo.mass + (rt * rt) / I)
    jt = clamp(jt, -PHYS.friction * j, PHYS.friction * j)
    body.vx += (jt * tx) / cargo.mass; body.vy += (jt * ty) / cargo.mass
    body.w += (rt * jt) / I
  }

  // めり込んでいる点をすべて集める。荷物の外周の点が壁に入った／壁の角が荷物に入った の2通り
  function contacts() {
    const out = []
    const c = Math.cos(body.a), s = Math.sin(body.a)
    const R = Math.hypot(cargo.w, cargo.h) / 2 + 2
    for (const [wx, wy, ww, wh] of course.walls) {
      if (body.x + R < wx || body.x - R > wx + ww || body.y + R < wy || body.y - R > wy + wh) continue // 遠い壁は飛ばす
      for (const sp of samples) {
        const [px, py] = worldOf(sp)
        if (px <= wx || px >= wx + ww || py <= wy || py >= wy + wh) continue
        const dl = px - wx, dr = wx + ww - px, dt = py - wy, db = wy + wh - py
        const m = Math.min(dl, dr, dt, db)
        const nrm = m === dl ? [-1, 0] : m === dr ? [1, 0] : m === dt ? [0, -1] : [0, 1]
        out.push({ px, py, nx: nrm[0], ny: nrm[1], d: m })
      }
      for (const [cx, cy] of [[wx, wy], [wx + ww, wy], [wx, wy + wh], [wx + ww, wy + wh]]) {
        const dx = cx - body.x, dy = cy - body.y
        const lx = dx * c + dy * s, ly = -dx * s + dy * c
        const ex = cargo.w / 2 - Math.abs(lx), ey = cargo.h / 2 - Math.abs(ly)
        if (ex <= 0 || ey <= 0) continue
        // 荷物を角から離れる向きへ押す
        let nlx = 0, nly = 0, d
        if (ex < ey) { nlx = -Math.sign(lx) || 1; d = ex } else { nly = -Math.sign(ly) || 1; d = ey }
        out.push({ px: cx, py: cy, nx: nlx * c - nly * s, ny: nlx * s + nly * c, d })
      }
    }
    return out
  }

  function collide() {
    for (let iter = 0; iter < 6; iter++) {
      const list = contacts()
      if (!list.length) break
      // ぶつけた強さは撃力を当てる前の速さで測る（当てた後は回転が混ざって大きく出る）
      if (iter === 0) for (const ct of list) {
        const rx = ct.px - body.x, ry = ct.py - body.y
        const vn = (body.vx - body.w * ry) * ct.nx + (body.vy + body.w * rx) * ct.ny
        if (-vn > bump) bump = -vn
      }
      // 速度: 全部の接触点に順番に撃力を当てる（2点で同時に当たっても片方だけで回り出さない）
      for (let k = 0; k < 2; k++) for (const ct of list) impulse(ct.px, ct.py, ct.nx, ct.ny)
      // 位置: いちばん深い所だけ押し戻す（次の周で残りを見る）
      let best = list[0]
      for (const ct of list) if (ct.d > best.d) best = ct
      body.x += best.nx * (best.d + 0.01); body.y += best.ny * (best.d + 0.01)
    }
  }

  function step(dt) {
    clock += dt
    if (clock < PHYS.countdown) return
    const active = [...seats.values()].filter(s => s.active)
    const per = active.length ? PHYS.force / active.length : 0
    let fx = 0, fy = 0, tq = 0, out = 0
    const c = Math.cos(body.a), s = Math.sin(body.a)
    for (const st of active) {
      if (clock - st.at > PHYS.inputTtl) { st.ux = 0; st.uy = 0 }
      const ux = st.ux * per, uy = st.uy * per
      const [lx, ly] = st.off
      const rx = lx * c - ly * s, ry = lx * s + ly * c
      fx += ux; fy += uy
      tq += rx * uy - ry * ux
      const rl = Math.hypot(rx, ry) || 1
      out += (ux * rx + uy * ry) / rl // 外へ引っぱる成分（内へ押すのは負）
      // 成績: 押している間、その持ち手の動きと押す向きがそろっているか
      const mag = Math.hypot(st.ux, st.uy)
      if (mag > 0.3) {
        st.pushT += dt
        const hvx = body.vx - body.w * ry, hvy = body.vy + body.w * rx
        const hv = Math.hypot(hvx, hvy)
        if (hv > 15 && (st.ux * hvx + st.uy * hvy) / (mag * hv) > 0.6) st.goodT += dt
      }
    }
    body.vx += (fx / cargo.mass - PHYS.linDamp * body.vx) * dt
    body.vy += (fy / cargo.mass - PHYS.linDamp * body.vy) * dt
    body.w += (tq / I - PHYS.angDamp * body.w) * dt
    body.x += body.vx * dt; body.y += body.vy * dt; body.a += body.w * dt
    if (body.a > Math.PI) body.a -= 2 * Math.PI
    if (body.a < -Math.PI) body.a += 2 * Math.PI

    bump = 0
    collide()
    // 1回の衝突が数ステップにまたがっても二重に数えない: 直近に数えた強さを超えた分だけ傷む
    hitMem = Math.max(0, hitMem - 200 * dt)
    const floor = Math.max(PHYS.hitSafe, hitMem)
    if (bump > floor) {
      hp -= (bump - floor) * PHYS.hitDamage * cargo.fragile
      if (hitMem < PHYS.hitSafe) {
        bumpSeq++
        for (const st of active) if (Math.hypot(st.ux, st.uy) > 0.3) st.hits++
      }
      hitMem = bump
    }
    // 引っぱりすぎ（全員の力のうち、外へ向かう成分の割合）
    pulling = out / PHYS.force > PHYS.pullLimit ? 1 : 0
    if (pulling) hp -= PHYS.pullDamage * cargo.fragile * dt

    if (hp <= 0) { hp = 0; return finish('broken') }
    if (course.pits.some(p => inRect(body.x, body.y, p))) return finish('fall')
    if (inRect(body.x, body.y, course.goal)) return finish('goal')
    if (timeLeft() <= 0) return finish('time')
  }

  function finish(o) { over = true; outcome = o; finishedAt = playTime() }

  const progress = () => outcome === 'goal' ? 100 : Math.round(clamp((startY - body.y) / (startY - goalY), 0, 1) * 100)

  return {
    tick(dt) {
      if (over) return
      acc += clamp(Number(dt) || 0, 0, 0.25)
      while (acc >= PHYS.step - 1e-9 && !over) { step(PHYS.step); acc -= PHYS.step }
    },
    input(id, data) {
      if (over) return { error: 'over' }
      const st = seats.get(id)
      if (!st || !st.active) return { error: 'not_player' }
      if (!data || typeof data !== 'object' || data.type !== 'push') return { error: 'bad_input' }
      const { x, y } = data
      if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return { error: 'bad_input' }
      if (Math.abs(x) > 1.01 || Math.abs(y) > 1.01) return { error: 'bad_input' }
      const m = Math.hypot(x, y)
      const k = m > 1 ? 1 / m : 1
      st.ux = x * k; st.uy = y * k
      st.at = clock
      return { ok: true }
    },
    // このゲームに秘密の情報は無い。毎 tick 送るので小さく保つ（コースの形は stages.js の定数を画面側も読む）
    view(id) {
      const me = seats.get(id)
      return {
        course: courseId, cargo: cargoId, n,
        cd: Math.max(0, Math.ceil(PHYS.countdown - clock)),
        time: Math.ceil(timeLeft()),
        x: r1(body.x), y: r1(body.y), a: Math.round(body.a * 1000) / 1000,
        hp: Math.max(0, Math.round(hp)),
        pull: pulling, bump: bumpSeq,
        prog: progress(),
        me: me ? me.h : -1,
        hs: [...seats.values()].sort((a, b) => a.h - b.h).map(s => [s.id, r1(s.ux), r1(s.uy), s.active ? 1 : 0])
      }
    },
    isOver: () => over,
    result() {
      const win = outcome === 'goal'
      const title = { goal: '到着！', fall: '穴に落とした', broken: '壊れた', time: '時間切れ', left: '全員抜けた' }[outcome] || '終了'
      const reason = {
        goal: `${cargo.name}を無事に運んだ`,
        fall: `${cargo.name}の真ん中が穴の上に出た`,
        broken: `${cargo.name}の耐久が0になった`,
        time: `${course.timeLimit}秒以内に届かなかった`,
        left: '運ぶ人がいなくなった'
      }[outcome] || ''
      const hpLeft = Math.max(0, Math.round(hp))
      const score = win ? 1000 + Math.floor(timeLeft()) * 10 + hpLeft * 5 : progress() * 5
      return {
        win, title, reason, outcome, score,
        time: Math.round((finishedAt ?? playTime()) * 10) / 10,
        hp: hpLeft, maxHp: cargo.hp, progress: progress(),
        course: course.name, cargo: cargo.name,
        ranking: [...seats.values()].map(s => ({
          id: s.id, name: s.name, label: s.label, h: s.h, left: !s.active,
          value: s.pushT > 0.5 ? Math.round((s.goodT / s.pushT) * 100) : 0,
          push: Math.round(s.pushT), hits: s.hits
        })).sort((a, b) => b.value - a.value)
      }
    },
    removePlayer(id) {
      const st = seats.get(id)
      if (st) { st.active = false; st.ux = 0; st.uy = 0 }
      if (![...seats.values()].some(s => s.active) && !over) finish('left')
    },
    // テスト用の読み取り（状態は変えない）
    _debug: () => ({ body: { ...body }, hp, clock, seats: [...seats.values()].map(s => ({ id: s.id, h: s.h, off: s.off, label: s.label })), I, cargo, course })
  }
}
