// 1つのコースで自動操縦を走らせ、1秒ごとの位置を出す（詰まる場所を探す用）
import { createGame } from '../lib/game.mjs'
import { makePilot } from './autopilot.mjs'
import { COURSES, moverAt } from '../public/stages.js'
const [course, cargo = 'sofa', n = 2, every = 1] = process.argv.slice(2)
const players = Array.from({ length: +n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }))
const g = createGame(players, { course, cargo, rng: () => 0.42 })
const pilot = makePilot(course, cargo, +n)
let next = 0, mh = 0, hp = null
if (process.env.NOLIMIT) COURSES[course].timeLimit = 9999
let fl = 0
for (let t = 0; t < 1500 && !g.isOver(); t += 0.05) {
  const v = g.view('p0'); const b = g._debug().body
  const ins = pilot.inputs({ ...v, vx: b.vx, vy: b.vy })
  v.hs.forEach(([id], h) => g.input(id, { type: 'push', x: ins[h][0], y: ins[h][1] }))
  g.tick(0.05)
  const v2 = g.view('p0')
  if (v2.fl !== fl) { fl = v2.fl; console.log('  FALL at', b.x.toFixed(0), b.y.toFixed(0), 'wp', pilot.wp, 't', v2.t) }
  if (v2.mh !== mh) { mh = v2.mh; const ms = (COURSES[course].movers || []).map((m, i) => { const p = moverAt(m, v2.t); return [i, m.kind, Math.round(Math.hypot(p.x - b.x, p.y - b.y))] }).sort((a, b) => a[2] - b[2]); console.log('  HIT mover', JSON.stringify(ms[0]), 'at', b.x.toFixed(0), b.y.toFixed(0), 'wp', pilot.wp, 'hp', v2.hp) }
  else if (hp != null && v2.hp < hp - 0.5) console.log('  WALL dmg', hp - v2.hp, 'at', b.x.toFixed(0), b.y.toFixed(0), 'a', b.a.toFixed(2))
  hp = v2.hp
  if (t >= next) { next += +every; console.log(t.toFixed(1), 'wp', pilot.wp, 'x', b.x.toFixed(0), 'y', b.y.toFixed(0), 'a', b.a.toFixed(2), 'v', Math.hypot(b.vx, b.vy).toFixed(0), 'hp', v.hp, 'mh', v.mh) }
}
console.log(g.result().outcome, g.result().time)
