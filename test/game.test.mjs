// みんなで運べ！のルールの単体テスト（通信なし）
import test from 'node:test'
import assert from 'node:assert/strict'
import { createGame, meta, PHYS } from '../lib/game.mjs'
import { COURSES, CARGOS, EMOTES, handleOffsets, handleLabel, moverAt, pathProgress } from '../public/stages.js'
import { makePilot } from '../tools/autopilot.mjs'

const players = n => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }))
const fixed = () => 0.42
function run(g, sec, inputs) {
  // inputs: (view) => { id: [x,y] }。0.1 秒ごとに送り直す
  for (let t = 0; t < sec && !g.isOver(); t += 0.05) {
    if (inputs) { const v = g.view('p0'); for (const [id, [x, y]] of Object.entries(inputs(v))) g.input(id, { type: 'push', x, y }) }
    g.tick(0.05)
  }
}
const afterCountdown = g => run(g, PHYS.countdown + 0.05)
const allPush = (n, x, y) => () => Object.fromEntries(players(n).map(p => [p.id, [x, y]]))
function seatOf(g, id) { return g._debug().seats.find(s => s.id === id) }

// テスト専用の短いコース（穴・壁・ゴールの判定を短時間で試す）
COURSES._test = {
  name: 'テスト', size: [1000, 1000], timeLimit: 30,
  start: { x: 500, y: 500, a: 0 },
  walls: [[0, 0, 1000, 40], [0, 960, 1000, 40], [0, 0, 40, 1000], [960, 0, 40, 1000]],
  pits: [[700, 450, 100, 100]],
  goal: [450, 60, 100, 100]
}

test('人数は2〜8人', () => {
  assert.equal(meta.minPlayers, 2)
  assert.equal(meta.maxPlayers, 8)
})

test('持ち手は人数ぶん外周に並ぶ。2人なら前と後ろ、4人なら前・左・後ろ・右', () => {
  for (const cargo of Object.values(CARGOS)) {
    for (let n = 2; n <= 8; n++) {
      const offs = handleOffsets(cargo, n)
      assert.equal(offs.length, n)
      const keys = new Set(offs.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`))
      assert.equal(keys.size, n, `${cargo.name} ${n}人で持ち手が重なる`)
      for (const [x, y] of offs) {
        const onEdge = Math.abs(Math.abs(x) - cargo.w / 2) < 1e-6 || Math.abs(Math.abs(y) - cargo.h / 2) < 1e-6
        assert.ok(onEdge, `${cargo.name} ${n}人: 持ち手が外周にない ${x},${y}`)
      }
    }
  }
  const sofa = CARGOS.sofa
  assert.deepEqual(handleOffsets(sofa, 2).map(o => handleLabel(sofa, o)), ['前', '後ろ'])
  assert.deepEqual(handleOffsets(sofa, 4).map(o => handleLabel(sofa, o)), ['前', '左', '後ろ', '右'])
})

test('持ち手の割り当ては全員に1つずつ、重ならない', () => {
  for (let n = 2; n <= 8; n++) {
    const g = createGame(players(n))
    const hs = g._debug().seats.map(s => s.h).sort((a, b) => a - b)
    assert.deepEqual(hs, [...Array(n).keys()])
    for (const p of players(n)) assert.equal(g.view(p.id).me, seatOf(g, p.id).h)
  }
})

test('カウントダウン中は押しても動かない', () => {
  const g = createGame(players(2), { rng: fixed })
  run(g, PHYS.countdown - 0.3, allPush(2, 0, -1))
  const v = g.view('p0')
  assert.equal(v.y, COURSES.warehouse.start.y)
  assert.ok(v.cd > 0)
})

test('全員が同じ向きに押すと、2人でも8人でもその向きにまっすぐ進み、回らない', () => {
  for (const cargoId of Object.keys(CARGOS)) {
    for (const n of [2, 3, 5, 8]) {
      const g = createGame(players(n), { course: '_test', cargo: cargoId, rng: fixed })
      afterCountdown(g)
      run(g, 1.5, allPush(n, 1, 0))
      const v = g.view('p0')
      assert.ok(v.x > 500 + 60, `${cargoId} ${n}人: 右へ進んでいない x=${v.x}`)
      assert.ok(Math.abs(v.y - 500) < 1, `${cargoId} ${n}人: 横にそれた y=${v.y}`)
      assert.ok(Math.abs(v.a) < 0.01, `${cargoId} ${n}人: 回った a=${v.a}`)
    }
  }
})

test('人数が違っても最高速はほぼ同じ（1人あたりの力は 全体/人数）', () => {
  const speeds = [2, 8].map(n => {
    const g = createGame(players(n), { course: '_test', rng: fixed })
    afterCountdown(g)
    run(g, 1.5, allPush(n, 0, 1))
    return g.view('p0').y - 500
  })
  assert.ok(Math.abs(speeds[0] - speeds[1]) < 2, `2人 ${speeds[0]} / 8人 ${speeds[1]}`)
})

test('前と後ろが逆向きに押すと、その場で回る（全員の操作が向きに効く）', () => {
  const g = createGame(players(2), { course: '_test', rng: fixed })
  const front = g._debug().seats.find(s => s.label === '前').id
  const back = g._debug().seats.find(s => s.label === '後ろ').id
  afterCountdown(g)
  run(g, 0.6, () => ({ [front]: [0, -1], [back]: [0, 1] }))
  const v = g.view('p0')
  assert.ok(v.a < -0.5, `回っていない a=${v.a}`)
  assert.ok(Math.hypot(v.x - 500, v.y - 500) < 3, '回すだけで位置はほぼ動かない')
})

test('1人だけが押すと、力は 1/人数 になり、横の持ち手なら回りながら進む', () => {
  const g = createGame(players(4), { course: '_test', rng: fixed })
  const side = g._debug().seats.find(s => s.label === '左').id
  afterCountdown(g)
  run(g, 1.0, () => ({ [side]: [1, 0] }))
  const v = g.view('p0')
  assert.ok(v.x > 505 && v.x < 560, `1/4 の力で少しだけ進む x=${v.x}`)
  assert.ok(Math.abs(v.a) > 0.05, '端を押したので回る')
})

test('外へ引っぱり合うと「引っぱりすぎ」になり、荷物が傷む', () => {
  const g = createGame(players(2), { course: '_test', rng: fixed })
  const front = g._debug().seats.find(s => s.label === '前').id
  const back = g._debug().seats.find(s => s.label === '後ろ').id
  afterCountdown(g)
  run(g, 1.0, () => ({ [front]: [1, 0], [back]: [-1, 0] }))
  const v = g.view('p0')
  assert.equal(v.pull, 1)
  assert.ok(v.hp < 100, `傷んでいない hp=${v.hp}`)
  assert.ok(Math.abs(v.x - 500) < 1, '引っぱり合いでは動かない')
})

test('壁に勢いよくぶつけると傷み、壁を突き抜けない。ゆっくりなら傷まない', () => {
  const g = createGame(players(2), { course: '_test', rng: fixed })
  afterCountdown(g)
  run(g, 5, allPush(2, 0, 1)) // 下の壁へ全力
  const v = g.view('p0')
  assert.ok(v.hp < 100, '全力でぶつけたのに傷んでいない')
  assert.ok(v.bump >= 1)
  assert.ok(v.y + CARGOS.sofa.h / 2 <= 960 + 1.5, `壁にめり込んだ y=${v.y}`)
  const soft = createGame(players(2), { course: '_test', rng: fixed })
  afterCountdown(soft)
  run(soft, 25, allPush(2, 0, 0.2)) // 最高速 22 < 安全な速さ
  assert.equal(soft.view('p0').hp, 100)
  assert.ok(soft.view('p0').y > 900, 'ゆっくりでも壁際まで進む')
})

test('ソファは横向きのままではドアを通れない（縦にすれば通れる）', () => {
  const g = createGame(players(4), { rng: fixed })
  afterCountdown(g)
  run(g, 10, allPush(4, 0, -1))
  const v = g.view('p0')
  assert.ok(v.y > 1800, `横向きでドアを抜けた y=${v.y}`)
  assert.equal(g.isOver(), false)
})

test('荷物の真ん中が穴に入ると落ちて失敗', () => {
  const g = createGame(players(2), { course: '_test', rng: fixed })
  afterCountdown(g)
  run(g, 5, allPush(2, 0.6, 0))
  assert.equal(g.isOver(), true)
  const r = g.result()
  assert.equal(r.outcome, 'fall')
  assert.equal(r.win, false)
})

test('ゴールに入るとクリア。スコアは 1000 + 残り秒×10 + 耐久×5', () => {
  const g = createGame(players(2), { course: '_test', rng: fixed })
  afterCountdown(g)
  run(g, 6, allPush(2, 0, -0.8))
  assert.equal(g.isOver(), true)
  const r = g.result()
  assert.equal(r.outcome, 'goal')
  assert.equal(r.win, true)
  assert.equal(r.progress, 100)
  assert.equal(r.score, 1000 + Math.floor(COURSES._test.timeLimit - r.time) * 10 + r.hp * 5)
  assert.equal(r.ranking.length, 2)
  assert.ok(r.ranking.every(p => p.value > 50), '全員そろえて押したので息ぴったり率が高い')
})

test('全コース・全荷物を、2人でも8人でも、そろえて押せば制限時間内に運べる（自動操縦）', () => {
  const realCourses = Object.keys(COURSES).filter(c => !c.startsWith('_'))
  assert.equal(realCourses.length, 5)
  assert.equal(Object.keys(CARGOS).length, 4)
  for (const course of realCourses) {
    for (const cargo of Object.keys(CARGOS)) {
      for (const n of [2, 8]) {
        const g = createGame(players(n), { course, cargo, rng: fixed })
        const pilot = makePilot(course, cargo, n)
        run(g, 260, v => {
          const b = g._debug().body
          const ins = pilot.inputs({ ...v, vx: b.vx, vy: b.vy })
          return Object.fromEntries(v.hs.map(([id], h) => [id, ins[h]]))
        })
        const r = g.result()
        assert.equal(r.outcome, 'goal', `${course} ${cargo} ${n}人: ${r.outcome} 進み ${r.progress}%`)
        assert.ok(r.time < COURSES[course].timeLimit)
        assert.ok(['gold', 'silver', 'bronze'].includes(r.medal))
      }
    }
  }
})

test('コースの通り道は壁と穴の中を通らず、最後はゴールの中。スタートは通り道の始まり', () => {
  for (const [id, c] of Object.entries(COURSES)) {
    if (id.startsWith('_')) continue
    assert.deepEqual(c.path[0].slice(0, 2), [c.start.x, c.start.y], id)
    const [gx, gy, gw, gh] = c.goal
    const [lx, ly] = c.path[c.path.length - 1]
    assert.ok(lx > gx && lx < gx + gw && ly > gy && ly < gy + gh, `${id}: 通り道の終わりがゴールの外`)
    for (const [x, y] of c.path) for (const [wx, wy, ww, wh] of c.walls) assert.ok(!(x > wx && x < wx + ww && y > wy && y < wy + wh), `${id}: 通り道 ${x},${y} が壁の中`)
    for (const [x, y] of c.path) for (const [px, py, pw, ph] of c.pits) assert.ok(!(x > px && x < px + pw && y > py && y < py + ph), `${id}: 通り道 ${x},${y} が穴の中`)
    assert.ok(c.medals.gold < c.medals.silver, id)
  }
  assert.ok(pathProgress(COURSES.stairs.path, 710, 1840) > 0.99)
  assert.ok(pathProgress(COURSES.stairs.path, 290, 1840) < 0.01)
})

test('動く障害物は時刻だけで位置が決まり、車は端まで行くと出直す。ピストンは往復する', () => {
  const car = COURSES.crosswalk.movers[0]
  assert.deepEqual(moverAt(car, 3), moverAt(car, 3))
  const L = Math.abs(car.loop[1] - car.loop[0])
  assert.ok(Math.abs(moverAt(car, L / car.speed).x - moverAt(car, 0).x) < 1e-6, '1周で元の位置')
  const pis = COURSES.factory.movers[0]
  const p0 = moverAt(pis, 0), ph = moverAt(pis, pis.swing.period / 2)
  assert.ok(Math.abs(p0.x - pis.swing.a[0]) < 1e-6 && Math.abs(ph.x - pis.swing.b[0]) < 1e-6)
})

test('車に当たると横へ跳ね飛ばされて傷む。同じ車に続けては数えない', () => {
  COURSES._car = {
    name: '車テスト', size: [1600, 1000], timeLimit: 30, start: { x: 800, y: 500, a: -Math.PI / 2 },
    walls: [[0, 0, 1600, 40], [0, 960, 1600, 40]], pits: [], goal: [700, 60, 200, 60],
    movers: [{ kind: 'car', loop: [0, 1600], y: 500, w: 150, h: 80, speed: 200, phase: 0, hurt: 20 }]
  }
  const g = createGame(players(2), { course: '_car', rng: fixed })
  afterCountdown(g)
  run(g, 4.5)
  const v = g.view('p0')
  assert.equal(v.mh, 1, `当たった回数 ${v.mh}`)
  assert.equal(v.hp, 80)
  assert.ok(Math.abs(v.y - 500) > 20, `横にはじかれていない y=${v.y}`)
  delete COURSES._car
})

test('氷の上はよく滑り、ベルトの上は流される', () => {
  const base = { size: [1000, 1000], timeLimit: 30, start: { x: 500, y: 500, a: 0 }, walls: [], pits: [], goal: [900, 900, 50, 50] }
  COURSES._ice = { ...base, name: '氷', zones: [{ type: 'ice', r: [0, 0, 1000, 1000] }] }
  COURSES._plain = { ...base, name: '床' }
  COURSES._belt = { ...base, name: 'ベルト', zones: [{ type: 'belt', r: [0, 0, 1000, 1000], vx: 0, vy: 60 }] }
  const coast = id => {
    const g = createGame(players(2), { course: id, rng: fixed })
    afterCountdown(g); run(g, 0.5, allPush(2, 1, 0)); const x0 = g.view('p0').x
    run(g, 1.5); return g.view('p0').x - x0 // 手を離してからどれだけ進むか
  }
  const ice = coast('_ice'), plain = coast('_plain')
  assert.ok(ice > plain * 3, `氷で滑らない ${ice} / ${plain}`)
  const g = createGame(players(2), { course: '_belt', rng: fixed })
  afterCountdown(g); run(g, 2)
  assert.ok(g.view('p0').y > 540, 'ベルトで流されない')
  delete COURSES._ice; delete COURSES._belt; delete COURSES._plain
})

test('かけ声スタンプは全員の画面に出て、連打は間引かれ、変な番号は通らない', () => {
  const g = createGame(players(3), { course: '_test', rng: fixed })
  afterCountdown(g)
  assert.equal(g.input('p1', { type: 'emote', k: 0 }).ok, true)
  assert.equal(g.input('p1', { type: 'emote', k: 1 }).error, 'too_fast')
  for (const k of [-1, EMOTES.length, 1.5, '0', null]) assert.ok(g.input('p2', { type: 'emote', k }).error)
  const h1 = seatOf(g, 'p1').h
  for (const id of ['p0', 'p1', 'p2']) assert.deepEqual(g.view(id).em.map(e => [e[0], e[1]]), [[h1, 0]])
  run(g, PHYS.emoteShow + 0.1)
  assert.equal(g.view('p0').em.length, 0, '時間がたつと消える')
  assert.equal(g.input('p1', { type: 'emote', k: 5 }).ok, true)
})

test('メダル: 速く傷めずに着けば金、遅いと銅。基準のないコースは着けば銅', () => {
  const play = () => { const g = createGame(players(2), { course: '_test', rng: fixed }); afterCountdown(g); run(g, 8, allPush(2, 0, -0.8)); return g.result() }
  assert.equal(play().medal, 'bronze')
  COURSES._test.medals = { gold: 10, silver: 20 }
  assert.equal(play().medal, 'gold')
  COURSES._test.medals = { gold: 1, silver: 2 }
  assert.equal(play().medal, 'bronze')
  delete COURSES._test.medals
})

test('到着・落下のあとは少し余韻を見せてから終わる（done で画面に知らせる）', () => {
  const g = createGame(players(2), { course: '_test', rng: fixed })
  afterCountdown(g)
  for (let t = 0; t < 6 && !g.view('p0').done; t += 0.05) { g.input('p0', { type: 'push', x: 0, y: -0.8 }); g.input('p1', { type: 'push', x: 0, y: -0.8 }); g.tick(0.05) }
  assert.equal(g.view('p0').done, 'goal')
  assert.equal(g.isOver(), false)
  const y = g.view('p0').y
  run(g, PHYS.endHold - 0.2)
  assert.equal(g.view('p0').y, y, '余韻の間は止まっている')
  run(g, 0.4)
  assert.equal(g.isOver(), true)
})

test('時間切れで負け', () => {
  const g = createGame(players(2), { course: '_test', rng: fixed })
  run(g, PHYS.countdown + COURSES._test.timeLimit + 0.2)
  assert.equal(g.isOver(), false, '時間切れの直後は余韻を見せる')
  assert.equal(g.view('p0').done, 'time')
  run(g, PHYS.endHold + 0.1)
  assert.equal(g.isOver(), true)
  assert.equal(g.result().outcome, 'time')
  assert.equal(g.result().win, false)
  assert.equal(g.result().title, '時間切れ')
})

test('不正な入力は { error } を返し、状態を変えない', () => {
  const g = createGame(players(2), { course: '_test', rng: fixed })
  afterCountdown(g)
  const bad = [null, undefined, 'push', 5, {}, { type: 'tap' }, { type: 'push' }, { type: 'push', x: '1', y: 0 },
    { type: 'push', x: NaN, y: 0 }, { type: 'push', x: Infinity, y: 0 }, { type: 'push', x: 5, y: 0 }, { type: 'push', x: 0, y: -2 }]
  for (const b of bad) assert.ok(g.input('p0', b).error, `通ってしまった ${JSON.stringify(b)}`)
  assert.equal(g.input('nobody', { type: 'push', x: 1, y: 0 }).error, 'not_player')
  run(g, 1)
  const v = g.view('p0')
  assert.equal(v.x, 500); assert.equal(v.y, 500)
  assert.ok(v.hs.every(h => h[1] === 0 && h[2] === 0))
})

test('斜めの入力は長さ1に丸める（速く押す裏技は無い）', () => {
  const g = createGame(players(2), { course: '_test', rng: fixed })
  assert.equal(g.input('p0', { type: 'push', x: 1, y: 1 }).ok, true)
  const h = g.view('p0').hs.find(x => x[0] === 'p0')
  assert.ok(Math.hypot(h[1], h[2]) <= 1.01)
})

test('操作が0.8秒届かないと手を離したとみなす（切断した人が押しっぱなしにならない）', () => {
  const g = createGame(players(2), { course: '_test', rng: fixed })
  afterCountdown(g)
  g.input('p0', { type: 'push', x: 1, y: 0 }); g.input('p1', { type: 'push', x: 1, y: 0 })
  run(g, 3)
  const x1 = g.view('p0').x
  run(g, 2)
  assert.ok(Math.abs(g.view('p0').x - x1) < 1, '止まっていない')
  assert.ok(g.view('p0').hs.every(h => h[1] === 0))
})

test('物理は固定ステップ。tick の刻み方が違っても同じ結果になる', () => {
  const a = createGame(players(2), { course: '_test', rng: fixed })
  const b = createGame(players(2), { course: '_test', rng: fixed })
  const send = g => { g.input('p0', { type: 'push', x: 0.7, y: -0.2 }); g.input('p1', { type: 'push', x: -0.1, y: 0.5 }) }
  for (let i = 0; i < 100; i++) { if (i % 4 === 0) send(a); a.tick(0.05) }
  for (let i = 0; i < 500; i++) { if (i % 20 === 0) send(b); b.tick(0.01) }
  assert.deepEqual([a.view('p0').x, a.view('p0').y, a.view('p0').a], [b.view('p0').x, b.view('p0').y, b.view('p0').a])
  assert.notEqual(a.view('p0').x, 500)
  const c = createGame(players(2), { course: '_test', rng: fixed })
  c.tick(100) // 長く止まっていても一度に進むのは 0.25 秒まで
  assert.ok(c.view('p0').cd > 0)
})

test('途中で抜けた人の持ち手は止まり、残りの人で運べる。全員抜けたら終わる', () => {
  const g = createGame(players(3), { course: '_test', rng: fixed })
  afterCountdown(g)
  g.removePlayer('p1')
  assert.equal(g.input('p1', { type: 'push', x: 1, y: 0 }).error, 'not_player')
  run(g, 1.5, () => ({ p0: [0, -1], p2: [0, -1] }))
  const v = g.view('p0')
  assert.ok(v.y < 500 - 60, `残り2人で進まない y=${v.y}`)
  assert.equal(v.hs.find(h => h[0] === 'p1')[3], 0)
  g.removePlayer('p0'); g.removePlayer('p2')
  assert.equal(g.isOver(), true)
  assert.equal(g.result().outcome, 'left')
  assert.equal(g.result().ranking.find(r => r.id === 'p1').left, true)
})

test('view は小さく、自分の持ち手番号以外は全員同じ中身（隠す情報はない）', () => {
  const g = createGame(players(8), { rng: fixed })
  run(g, 4, allPush(8, 0.3, -0.7))
  const size = JSON.stringify(g.view('p0')).length
  assert.ok(size < 700, `view が大きい ${size}バイト`)
  const strip = v => { const { me, ...rest } = v; return rest }
  for (let i = 1; i < 8; i++) assert.deepEqual(strip(g.view('p' + i)), strip(g.view('p0')))
  assert.equal(g.view('stranger').me, -1)
})

test('画面から変な opts が届いても落ちず、既定のコースと荷物になる', () => {
  for (const opts of [{ rng: 'x' }, { course: '__proto__', cargo: 'constructor' }, { cargo: 123 }, 'abc', null, undefined]) {
    const g = createGame(players(2), opts ?? undefined)
    const v = g.view('p0')
    assert.equal(v.course, 'warehouse')
    assert.equal(v.cargo, 'sofa')
  }
  assert.equal(createGame(players(2), { cargo: 'tank' }).view('p0').cargo, 'tank')
})

test('でたらめに押し続けても、荷物は壁を抜けず、世界の外に出ず、速さも回転も暴れない（2〜8人・両方の荷物）', () => {
  let seed = 7
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
  for (const cargo of Object.keys(CARGOS)) {
    for (const n of [2, 5, 8]) {
      for (let trial = 0; trial < 3; trial++) {
        const g = createGame(players(n), { cargo, rng: rnd })
        const course = COURSES.warehouse
        let cur = Object.fromEntries(players(n).map(p => [p.id, [0, 0]]))
        let maxV = 0, maxW = 0
        for (let t = 0; t < 60 && !g.isOver(); t += 0.05) {
          if (rnd() < 0.08) cur = Object.fromEntries(players(n).map(p => [p.id, [rnd() * 2 - 1, rnd() * 2 - 1.3].map(v => Math.max(-1, Math.min(1, v)))]))
          for (const [id, [x, y]] of Object.entries(cur)) g.input(id, { type: 'push', x, y })
          g.tick(0.05)
          const b = g._debug().body
          assert.ok([b.x, b.y, b.a, b.vx, b.vy, b.w].every(Number.isFinite), 'NaN が出た')
          assert.ok(b.x > 40 && b.x < course.size[0] - 40 && b.y > 40 && b.y < course.size[1] - 40, `世界の外 ${b.x},${b.y}`)
          for (const [wx, wy, ww, wh] of course.walls) {
            const inside = b.x > wx + 2 && b.x < wx + ww - 2 && b.y > wy + 2 && b.y < wy + wh - 2
            assert.ok(!inside, `荷物の真ん中が壁の中 ${b.x},${b.y}`)
          }
          maxV = Math.max(maxV, Math.hypot(b.vx, b.vy)); maxW = Math.max(maxW, Math.abs(b.w))
        }
        assert.ok(maxV < 170, `速すぎる ${maxV}`)
        assert.ok(maxW < 6, `回りすぎる ${maxW}`)
      }
    }
  }
})

test('全力でドアの壁に突っ込んでも、1回の衝突で壊れきらない（ソファ）', () => {
  const g = createGame(players(2), { rng: fixed })
  afterCountdown(g)
  run(g, 4, allPush(2, 0, -1))
  const v = g.view('p0')
  assert.equal(g.isOver(), false, g.isOver() ? g.result().outcome : '')
  assert.ok(v.hp >= 40 && v.hp < 100, `hp=${v.hp}`)
})
