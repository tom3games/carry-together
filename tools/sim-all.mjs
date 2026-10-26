// 全コース×全荷物×人数で自動操縦を走らせ、結果（到着/秒/耐久/障害物に当たった回数）を表にする。メダルの秒数を決める材料
import { createGame } from '../lib/game.mjs'
import { COURSES, CARGOS } from '../public/stages.js'
import { makePilot } from './autopilot.mjs'
const players = n => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }))
const only = process.argv[2]
for (const course of Object.keys(COURSES)) {
  if (course.startsWith('_') || (only && course !== only)) continue
  for (const cargo of Object.keys(CARGOS)) for (const n of [2, 4, 8]) {
    const g = createGame(players(n), { course, cargo, rng: () => 0.42 })
    const pilot = makePilot(course, cargo, n)
    for (let t = 0; t < 400 && !g.isOver(); t += 0.05) {
      const v = g.view('p0'); const b = g._debug().body
      const ins = pilot.inputs({ ...v, vx: b.vx, vy: b.vy })
      v.hs.forEach(([id], h) => g.input(id, { type: 'push', x: ins[h][0], y: ins[h][1] }))
      g.tick(0.05)
    }
    const r = g.result()
    console.log(course.padEnd(10), cargo.padEnd(9), n, r.outcome.padEnd(7), String(r.time).padStart(6), 'hp', r.hp, 'hit', r.moverHits, 'prog', r.progress, 'wp', pilot.wp, r.medal || '')
  }
}
