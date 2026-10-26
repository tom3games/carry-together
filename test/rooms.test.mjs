// ルーム管理の単体テスト（通信なし）
import test from 'node:test'
import assert from 'node:assert/strict'
import { RoomManager, LIMITS, cleanName } from '../lib/rooms.mjs'
import * as gameDef from '../lib/game.mjs'
import { COURSES } from '../public/stages.js'
import { PHYS } from '../lib/game.mjs'

function setup() {
  let t = 0
  const sent = []
  const m = new RoomManager(gameDef, { send: (id, msg) => sent.push([id, msg]), now: () => t })
  const s = () => m.newSession().id
  return { m, s, sent, advance: ms => { t += ms; m.tick(ms) } }
}

test('部屋を作るとコードが出て、作った人がホストになる', () => {
  const { m, s } = setup()
  const a = s()
  const r = m.create(a, 'たろう')
  assert.match(r.code, /^[A-Z2-9]{4}$/)
  assert.equal(m.rooms.get(r.code).hostId, a)
})

test('参加コードで入れる。小文字でも入れる', () => {
  const { m, s } = setup()
  const a = s(), b = s()
  const { code } = m.create(a, 'A')
  assert.deepEqual(m.join(b, code.toLowerCase(), 'B'), { code })
  assert.equal(m.rooms.get(code).players.length, 2)
})

test('入れないときは理由を返す（無い・満員・開始後・名前なし）', () => {
  const { m, s } = setup()
  const a = s()
  const { code } = m.create(a, 'A')
  assert.equal(m.join(s(), 'ZZZZ', 'x').error, 'not_found')
  assert.equal(m.join(s(), code, '   ').error, 'bad_name')
  for (let i = 1; i < gameDef.meta.maxPlayers; i++) m.join(s(), code, 'p' + i)
  assert.equal(m.join(s(), code, 'over').error, 'full')
  const { code: c2 } = m.create(s(), 'H')
  const host = m.rooms.get(c2).hostId
  m.join(s(), c2, 'G')
  m.start(host)
  assert.equal(m.join(s(), c2, 'late').error, 'started')
})

test('名前は12文字まで・制御文字と<>は消す・同じ名前には番号がつく', () => {
  assert.equal(cleanName('<b>abcdefghijklmnop'), 'babcdefghijk')
  const { m, s } = setup()
  const { code } = m.create(s(), 'A')
  m.join(s(), code, 'A')
  assert.deepEqual(m.rooms.get(code).players.map(p => p.name), ['A', 'A2'])
})

test('ホスト以外はスタートできない。人数が足りないと始まらない', () => {
  const { m, s } = setup()
  const a = s(), b = s()
  const { code } = m.create(a, 'A')
  assert.equal(m.start(a).error, 'not_enough') // 1人では始まらない
  m.join(b, code, 'B')
  assert.equal(m.start(b).error, 'not_host')
  assert.equal(m.start(a).ok, true)
  assert.equal(m.rooms.get(code).phase, 'playing')
})

test('ゲームが終わると結果になり、ホストが再戦できる（荷物の選択も引き継げる）', () => {
  const { m, s, advance } = setup()
  const a = s(), b = s()
  const { code } = m.create(a, 'A')
  m.join(b, code, 'B')
  m.start(a, { cargo: 'tank' })
  const room = m.rooms.get(code)
  assert.equal(room.game.view(a).cargo, 'tank')
  // 2人で前へ押し続ける（横向きのソファではないので、ドアの壁にぶつかって止まるか時間切れ）
  for (let i = 0; i < (PHYS.countdown + COURSES.warehouse.timeLimit + PHYS.endHold + 1) * 10 && room.phase === 'playing'; i++) {
    m.input(a, { type: 'push', x: 0, y: -0.2 }); m.input(b, { type: 'push', x: 0, y: -0.2 })
    advance(100)
  }
  assert.equal(room.phase, 'result')
  assert.equal(typeof room.result.win, 'boolean')
  assert.equal(room.result.ranking.length, 2)
  assert.equal(m.rematch(a, { cargo: 'sofa' }).ok, true)
  assert.equal(room.game.view(a).cargo, 'sofa')
  assert.equal(room.phase, 'playing')
  assert.equal(room.round, 2)
})

test('不正な入力は状態を変えない', () => {
  const { m, s } = setup()
  const a = s()
  const { code } = m.create(a, 'A')
  m.join(s(), code, 'B')
  m.start(a)
  assert.equal(m.input(a, { type: 'hack', n: 999 }).error, 'bad_input')
  assert.equal(m.input(a, null).error, 'bad_input')
  assert.equal(m.input(a, { type: 'push', x: 99, y: 0 }).error, 'bad_input')
  const v = m.rooms.get(code).game.view(a)
  assert.ok(v.hs.every(h => h[1] === 0 && h[2] === 0))
  assert.equal(m.input(s(), { type: 'push', x: 1, y: 0 }).error, 'not_playing') // 部屋にいない人
})

test('時間切れで負けになる', () => {
  const { m, s, advance } = setup()
  const a = s()
  const { code } = m.create(a, 'A')
  m.join(s(), code, 'B')
  m.start(a)
  for (let i = 0; i < (PHYS.countdown + COURSES.warehouse.timeLimit + PHYS.endHold + 1) * 10; i++) advance(100)
  assert.equal(m.rooms.get(code).phase, 'result')
  assert.equal(m.rooms.get(code).result.win, false)
})

test('ホストが切れたままだと次の人がホストになる。戻れば同じ席', () => {
  const { m, s, advance } = setup()
  const a = s(), b = s()
  const { code } = m.create(a, 'A')
  m.join(b, code, 'B')
  m.disconnect(a)
  advance(LIMITS.hostGraceMs + 100)
  assert.equal(m.rooms.get(code).hostId, b)
  assert.equal(m.reconnect(a), code)
  assert.equal(m.rooms.get(code).players.find(p => p.id === a).connected, true)
})

test('切断が長いと席が消え、誰もいない部屋は消える', () => {
  const { m, s, advance } = setup()
  const a = s()
  const { code } = m.create(a, 'A')
  m.disconnect(a)
  advance(LIMITS.reconnectGraceMs + 100)
  assert.equal(m.rooms.get(code).players.length, 0)
  advance(LIMITS.emptyRoomMs + 100)
  assert.equal(m.rooms.has(code), false)
})

test('他人の token では席を奪えない', () => {
  const { m } = setup()
  const a = m.newSession()
  assert.equal(m.resume(a.id, 'wrong'), null)
  assert.ok(m.resume(a.id, a.token))
})

test('ホストが選んだコースと荷物は全員に見える。ホスト以外は変えられず、変な値は捨てる', () => {
  const sent = []
  const m = new RoomManager(gameDef, { send: (id, msg) => sent.push([id, msg]) })
  const a = m.newSession().id, b = m.newSession().id
  const { code } = m.create(a, 'A')
  m.join(b, code, 'B')
  assert.equal(m.setup(a, { course: 'snow', cargo: 'piano' }).ok, true)
  const last = id => sent.filter(([to, msg]) => to === id && msg.t === 'state').pop()[1]
  assert.deepEqual(last(b).setup, { course: 'snow', cargo: 'piano' })
  assert.equal(m.setup(b, { course: 'factory' }).error, 'not_host')
  m.setup(a, { course: '<script>', cargo: 5, __proto__: { x: 'y' }, ['a'.repeat(30)]: 'snow' })
  assert.deepEqual(last(b).setup, {})
})
