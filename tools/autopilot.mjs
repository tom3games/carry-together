// テストと e2e 用の自動操縦。全員がそろって押したらコースを抜けられることを確かめるために使う（ゲーム本体は使わない）。
// 荷物の位置と向き（view の x, y, a, t）だけから、各持ち手が押す向きを決める。通り道はコースの path。
// 動く障害物は時刻から位置が分かるので、この先1.6秒で通り道にかかるなら手前で待つ。
import { COURSES, CARGOS, handleOffsets, moverAt } from '../public/stages.js'
import { PHYS } from '../lib/game.mjs'

const wrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a }

export function makePilot(courseId, cargoId, n) {
  const course = COURSES[courseId]
  const route = course.path.slice(1)
  const cargo = CARGOS[cargoId]
  const offs = handleOffsets(cargo, n)
  const R = Math.hypot(cargo.w, cargo.h) / 2
  let k = 0
  let waitFrom = null, rushUntil = -1 // 待ちすぎたら（9秒）しばらく待たずに進む

  // 荷物を (x,y) に置いたとき（向きは a のまま）、時刻 t0〜t0+ahead の間に障害物と重なるか
  function threatened(x, y, a, t0, ahead) {
    const ex = Math.abs(Math.cos(a)) * cargo.w / 2 + Math.abs(Math.sin(a)) * cargo.h / 2 + 12
    const ey = Math.abs(Math.sin(a)) * cargo.w / 2 + Math.abs(Math.cos(a)) * cargo.h / 2 + 12
    for (const m of course.movers || []) {
      for (let dt = 0; dt <= ahead; dt += 0.1) {
        const p = moverAt(m, t0 + dt)
        if (Math.abs(x - p.x) < m.w / 2 + ex && Math.abs(y - p.y) < m.h / 2 + ey) return true
      }
    }
    return false
  }

  return {
    get wp() { return k },
    // g: { x, y, a, t }。戻り値: 持ち手ごとの [ux, uy]
    inputs(g) {
      let [tx, ty, ta] = route[Math.min(k, route.length - 1)]
      let dx = tx - g.x, dy = ty - g.y
      let ae = wrap(ta - g.a)
      if (k < route.length - 1 && Math.hypot(dx, dy) < 22 && Math.abs(ae) < 0.12) {
        k++;[tx, ty, ta] = route[k]; dx = tx - g.x; dy = ty - g.y; ae = wrap(ta - g.a)
      }
      const d = Math.hypot(dx, dy)
      // 向きが大きくずれている間は進むのを控える
      let go = Math.min(1, d / 50) * (Math.abs(ae) > 0.35 ? 0.25 : 0.85)
      // 障害物: いまの所が安全で、少し先が危ないなら止まる（いまの所が危ないなら、止まらずに抜ける）
      // 先の点ほど、着く時刻を遅らせて調べる（重い荷物ほど長く道をふさぐ）
      let wait = false
      if (course.movers && d > 1) {
        const t = g.t || 0
        const v = (0.85 * PHYS.force) / cargo.mass / PHYS.linDamp
        const here = threatened(g.x, g.y, g.a, t, 1.0)
        if (!here && t > rushUntil) {
          // 次の通り道の点の先まで見る
          const nx = route[Math.min(k + 1, route.length - 1)]
          for (let s = 30; s <= 270 && !wait; s += 30) {
            let px, py
            if (s <= d) { px = g.x + (dx / d) * s; py = g.y + (dy / d) * s }
            else { const e = Math.hypot(nx[0] - tx, nx[1] - ty) || 1, r = Math.min(s - d, e); px = tx + ((nx[0] - tx) / e) * r; py = ty + ((nx[1] - ty) / e) * r }
            if (threatened(px, py, ta, t + Math.max(0, s / v - 0.5), 1.1)) wait = true
          }
        }
      }
      if (wait) { if (waitFrom == null) waitFrom = g.t || 0; else if ((g.t || 0) - waitFrom > 9) { rushUntil = (g.t || 0) + 2; waitFrom = null; wait = false } }
      else waitFrom = null
      let lx = wait ? 0 : d ? (dx / d) * go : 0, ly = wait ? 0 : d ? (dy / d) * go : 0
      // ベルトや坂の上では、流される分を先に押し返しておく（止まりたい所で止まれるように）
      for (const z of course.zones || []) {
        const [zx, zy, zw, zh] = z.r
        if (z.type !== 'belt' || g.x < zx || g.x > zx + zw || g.y < zy || g.y > zy + zh) continue
        lx -= (PHYS.beltGrip * (z.vx || 0) * cargo.mass) / PHYS.force
        ly -= (PHYS.beltGrip * (z.vy || 0) * cargo.mass) / PHYS.force
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
