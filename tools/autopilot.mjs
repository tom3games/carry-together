// テストと e2e 用の自動操縦。全員がそろって押したらコースを抜けられることを確かめるために使う（ゲーム本体は使わない）。
// 荷物の位置と向き（view の x, y, a）だけから、各持ち手が押す向きを決める。
import { COURSES, CARGOS, handleOffsets } from '../public/stages.js'

// コースごとの通り道（荷物の真ん中の位置と、そこでの向き）
export const ROUTES = {
  warehouse: [
    [450, 2000, -Math.PI / 2], // その場で縦にする
    [450, 1760, -Math.PI / 2], // ドアを抜ける
    [450, 1700, -Math.PI / 2],
    [730, 1700, -Math.PI / 2], // 右の道へ
    [730, 1250, -Math.PI / 2], // 穴の横を上がる
    [730, 1060, -Math.PI / 2], // ジグザグの1つ目を抜ける
    [170, 1045, -Math.PI / 2], // 左へ
    [170, 800, -Math.PI / 2],  // 2つ目を抜ける
    [330, 700, -Math.PI / 2],  // 柱の間
    [420, 600, -Math.PI / 2],
    [440, 500, -Math.PI / 2],
    [440, 330, -Math.PI / 2],  // 細い通路
    [450, 150, -Math.PI / 2]   // ゴール
  ]
}

const wrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a }

export function makePilot(courseId, cargoId, n) {
  const route = ROUTES[courseId]
  const offs = handleOffsets(CARGOS[cargoId], n)
  let k = 0
  return {
    get wp() { return k },
    // g: { x, y, a }。戻り値: 持ち手ごとの [ux, uy]
    inputs(g) {
      let [tx, ty, ta] = route[Math.min(k, route.length - 1)]
      let dx = tx - g.x, dy = ty - g.y
      let ae = wrap(ta - g.a)
      if (k < route.length - 1 && Math.hypot(dx, dy) < 22 && Math.abs(ae) < 0.12) {
        k++;[tx, ty, ta] = route[k]; dx = tx - g.x; dy = ty - g.y; ae = wrap(ta - g.a)
      }
      const d = Math.hypot(dx, dy)
      // 向きが大きくずれている間は進むのを控える
      const go = Math.min(1, d / 50) * (Math.abs(ae) > 0.35 ? 0.25 : 0.85)
      const lx = d ? (dx / d) * go : 0, ly = d ? (dy / d) * go : 0
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
