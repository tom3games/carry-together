// テストと e2e 用の自動操縦。全員がそろって押したらコースを抜けられることを確かめるために使う（ゲーム本体は使わない）。
// 荷物の位置と向き（view の x, y, a, t）だけから、各持ち手が押す向きを決める。通り道はコースの path。
// 動く物（車・回るバー・落ちてくる荷物・閉まる壁）は時刻から位置が分かるので、通り道にかかるなら手前で待つ。
// 動く床は、こちら岸に来るまで待って乗り、向こう岸に着いたら降りる。穴に落ちてチェックポイントに戻されたら、そこから続ける。
import { COURSES, CARGOS, handleOffsets, moverAt, hazardAt, windPower } from '../public/stages.js'
import { PHYS } from '../lib/game.mjs'

const wrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a }

export function makePilot(courseId, cargoId, n) {
  const course = COURSES[courseId]
  const route = course.path.slice(1)
  const cargo = CARGOS[cargoId]
  const offs = handleOffsets(cargo, n)
  const R = Math.hypot(cargo.w, cargo.h) / 2
  const v = (0.85 * PHYS.force) / cargo.mass / PHYS.linDamp // ふつうに押したときの速さ
  let k = 0
  let waitFrom = null, rushUntil = -1 // 待ちすぎたら（9秒）しばらく待たずに進む
  let riding = null, last = null

  // 近くの危ない物だけにしぼったコース（遠くまで毎回調べない）
  function near(y) {
    const keep = o => Math.abs((o.y ?? (o.r ? o.r[1] + o.r[3] / 2 : o.swing ? o.swing.a[1] : 0)) - y) < 900
    return { movers: (course.movers || []).filter(keep), spinners: (course.spinners || []).filter(keep), drops: (course.drops || []).filter(keep), gates: (course.gates || []).filter(keep) }
  }
  function threatened(sub, x, y, a, t0, ahead) {
    for (let dt = 0; dt <= ahead; dt += 0.1) if (hazardAt(sub, cargo, t0 + dt, x, y, a)) return true
    return false
  }

  return {
    get wp() { return k },
    // g: { x, y, a, t }。戻り値: 持ち手ごとの [ux, uy]
    inputs(g) {
      const t = g.t || 0
      // チェックポイントに戻された（大きく飛んだ）: いちばん近い通り道の点から続ける
      if (last && Math.hypot(g.x - last.x, g.y - last.y) > 250) {
        let bi = 0, bd = Infinity
        route.forEach((p, i) => { const d = Math.hypot(p[0] - g.x, p[1] - g.y); if (d < bd) { bd = d; bi = i } })
        k = bi; riding = null
      }
      last = { x: g.x, y: g.y }
      if (g.dr) return offs.map(() => [0, 0]) // 落ちている最中
      let [tx, ty, ta, opt] = route[Math.min(k, route.length - 1)]
      // 動く床: こちら岸で待つ → 乗る（床の真ん中を追う）→ 向こう岸で降りる
      let hold = false
      if (opt && opt.ride != null) {
        const pf = course.platforms[opt.ride]
        const p = moverAt(pf, t)
        const ends = [pf.swing.a, pf.swing.b]
        const nearEnd = ends.reduce((a, b) => (Math.hypot(a[0] - tx, a[1] - ty) < Math.hypot(b[0] - tx, b[1] - ty) ? a : b))
        const farEnd = nearEnd === ends[0] ? ends[1] : ends[0]
        const onIt = Math.abs(g.x - p.x) < pf.w / 2 - 10 && Math.abs(g.y - p.y) < pf.h / 2 - 10
        if (!riding) {
          // 着いている間に乗り移れるときだけ乗る（離れていく床を追わない）
          const dAt = dt => { const q = moverAt(pf, t + dt); return Math.hypot(q.x - nearEnd[0], q.y - nearEnd[1]) }
          const ready = dAt(0) < 30 && dAt(1.2) < 40 && dAt(2.4) < 90
          if (ready || onIt) { riding = true }
          else hold = true
        }
        if (riding) {
          // 向こう岸に近づいたら、着く前から降り始める（床が戻り始める前に岸へ移る）
          const dFar = dt => { const q = moverAt(pf, t + dt); return Math.hypot(q.x - farEnd[0], q.y - farEnd[1]) }
          if (onIt && dFar(0) < 90 && dFar(0.3) <= dFar(0) + 1) { riding = null; k++; [tx, ty, ta, opt] = route[Math.min(k, route.length - 1)] }
          else { tx = p.x; ty = p.y }
        }
      }
      let dx = tx - g.x, dy = ty - g.y
      let ae = wrap(ta - g.a)
      if (!riding && !hold && k < route.length - 1 && Math.hypot(dx, dy) < 22 && Math.abs(ae) < 0.12) {
        k++;[tx, ty, ta, opt] = route[k]; dx = tx - g.x; dy = ty - g.y; ae = wrap(ta - g.a)
        if (opt && opt.ride != null) hold = true // 乗る所に着いた。次の呼び出しで床を待つ
      }
      const d = Math.hypot(dx, dy)
      // 向きが大きくずれている間は進むのを控える
      let go = Math.min(1, d / 50) * (Math.abs(ae) > 0.35 ? 0.25 : 0.85)
      if (riding) go = Math.min(1, d / 30)
      // 障害物: いまの所が安全で、少し先が危ないなら止まる（いまの所が危ないなら、止まらずに抜ける）
      // 先の点ほど、着く時刻を遅らせて調べる（重い荷物ほど長く道をふさぐ）
      let wait = hold
      if (!wait && !riding && d > 1) {
        const sub = near(g.y)
        if (t > rushUntil) {
          // いま出発したら、τ 秒後にどこにいるか（動き出しの遅れ 0.35 秒）。その時その場所に何か来るなら待つ
          const nx = route[Math.min(k + 1, route.length - 1)]
          const at = dist => {
            if (dist <= d) return [g.x + (dx / d) * dist, g.y + (dy / d) * dist]
            const e = Math.hypot(nx[0] - tx, nx[1] - ty) || 1, r = Math.min(dist - d, e)
            return [tx + ((nx[0] - tx) / e) * r, ty + ((nx[1] - ty) / e) * r]
          }
          for (let tau = 0.2; tau <= 520 / v && !wait; tau += 0.1) {
            const [px, py] = at(Math.max(0, v * (tau - 0.35)))
            for (const slack of [-0.3, 0, 0.3]) if (hazardAt(sub, cargo, t + tau + slack, px, py, ta)) { wait = true; break }
          }
          // 先がふさがっていても、ここで待つと危ない（危ない所の中にいる）なら、止まらずに抜ける
          if (wait && threatened(sub, g.x, g.y, g.a, t, 3.0)) wait = false
        }
        if (wait) { if (waitFrom == null) waitFrom = t; else if (t - waitFrom > 9) { rushUntil = t + 2; waitFrom = null; wait = false } }
        else waitFrom = null
      }
      let lx = wait ? 0 : d ? (dx / d) * go : 0, ly = wait ? 0 : d ? (dy / d) * go : 0
      // 待つ間は、いまの速さを打ち消す（氷やベルトの上で流されないように）
      if (wait && g.vx != null) { lx = -g.vx / 120; ly = -g.vy / 120 }
      // ベルト・坂・風の上では、流される分を先に押し返しておく
      for (const z of course.zones || []) {
        const [zx, zy, zw, zh] = z.r
        if ((z.type !== 'belt' && z.type !== 'wind') || g.x < zx || g.x > zx + zw || g.y < zy || g.y > zy + zh) continue
        const kz = z.type === 'wind' ? windPower(z, t) : 1
        lx -= (PHYS.beltGrip * kz * (z.vx || 0) * cargo.mass) / PHYS.force
        ly -= (PHYS.beltGrip * kz * (z.vy || 0) * cargo.mass) / PHYS.force
      }
      const rot = Math.max(-0.8, Math.min(0.8, ae * 2.2))
      const c = Math.cos(g.a), s = Math.sin(g.a)
      return offs.map(([ox, oy]) => {
        const rx = ox * c - oy * s, ry = ox * s + oy * c
        const rl = Math.hypot(rx, ry) || 1
        let ux = lx + rot * (-ry / rl), uy = ly + rot * (rx / rl)
        const m = Math.hypot(ux, uy)
        if (m > 1) { ux /= m; uy /= m }
        return [Math.round(ux * 100) / 100, Math.round(uy * 100) / 100]
      })
    }
  }
}

export { COURSES }
