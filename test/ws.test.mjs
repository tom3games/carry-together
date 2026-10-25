// 本物のサーバーを立てて、WebSocket で複数人がつなぐ統合テスト
import test from 'node:test'
import assert from 'node:assert/strict'
import WebSocket from 'ws'
import { startServer } from '../server.mjs'
import { COURSES } from '../public/stages.js'

// 統合テスト用の短いコース（サーバーは同じプロセスで動くので、ここで足せば選べる）
COURSES._ws = {
  name: '通信テスト', size: [600, 600], timeLimit: 20,
  start: { x: 300, y: 450, a: 0 },
  walls: [[0, 0, 600, 40], [0, 560, 600, 40], [0, 0, 40, 600], [560, 0, 40, 600]],
  pits: [],
  goal: [250, 60, 100, 100]
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

function client(port, saved) {
  const ws = new WebSocket(`ws://localhost:${port}/ws`)
  const c = { ws, msgs: [], id: null, token: null, state: null }
  ws.on('message', d => {
    const m = JSON.parse(d)
    c.msgs.push(m)
    if (m.t === 'session') { c.id = m.id; c.token = m.token }
    if (m.t === 'state') c.state = m
  })
  c.ready = new Promise(r => ws.on('open', () => { ws.send(JSON.stringify({ t: 'hello', ...(saved || {}) })); r() }))
  c.send = m => ws.send(JSON.stringify(m))
  c.wait = (pred, ms = 3000) => new Promise((res, rej) => {
    const t0 = Date.now()
    const iv = setInterval(() => {
      const hit = c.msgs.find(pred)
      if (hit) { clearInterval(iv); res(hit) } else if (Date.now() - t0 > ms) { clearInterval(iv); rej(new Error('timeout')) }
    }, 10)
  })
  return c
}

test('2人がつないで、作成・参加・開始・操作・終了・再戦まで通る', async () => {
  const srv = await startServer({ port: 0, quiet: true })
  try {
    const a = client(srv.port), b = client(srv.port)
    await a.ready; await b.ready
    await a.wait(m => m.t === 'welcome'); await b.wait(m => m.t === 'welcome')
    a.send({ t: 'create', name: 'A' })
    const { code } = await a.wait(m => m.t === 'joined')
    b.send({ t: 'join', code, name: 'B' })
    await b.wait(m => m.t === 'joined')
    await a.wait(m => m.t === 'state' && m.players.length === 2)
    b.send({ t: 'start' })
    await b.wait(m => m.t === 'error' && m.code === 'not_host')
    a.send({ t: 'start', opts: { course: '_ws', cargo: 'sofa' } })
    await b.wait(m => m.t === 'state' && m.phase === 'playing')
    // 2人で上へ押し続ける（250ms ごとに送り直す。画面と同じやり方）
    let end = null
    for (let i = 0; i < 60 && !end; i++) {
      a.send({ t: 'input', data: { type: 'push', x: 0, y: -1 } })
      b.send({ t: 'input', data: { type: 'push', x: 0, y: -1 } })
      await sleep(250)
      end = b.msgs.find(m => m.t === 'state' && m.phase === 'result')
    }
    assert.ok(end, '時間内にゴールしない')
    assert.equal(end.result.win, true)
    assert.equal(end.result.outcome, 'goal')
    // 2人に届いた位置は同じ（状態はサーバーだけが持つ）
    const sa = a.msgs.filter(m => m.t === 'state' && m.phase === 'playing').map(m => `${m.game.x},${m.game.y},${m.game.a}`)
    const sb = b.msgs.filter(m => m.t === 'state' && m.phase === 'playing').map(m => `${m.game.x},${m.game.y},${m.game.a}`)
    assert.ok(sa.length > 40, `状態がほとんど届いていない ${sa.length}`)
    assert.deepEqual(sa.slice(-20), sb.slice(-20))
    a.send({ t: 'rematch', opts: { course: '_ws', cargo: 'tank' } })
    await b.wait(m => m.t === 'state' && m.phase === 'playing' && m.round === 2)
    a.ws.close(); b.ws.close()
  } finally { await srv.close() }
})

test('切れても id と token で同じ席に戻れる。token が違うと別人になる', async () => {
  const srv = await startServer({ port: 0, quiet: true })
  try {
    const a = client(srv.port)
    await a.ready; await a.wait(m => m.t === 'session')
    a.send({ t: 'create', name: 'A' })
    const { code } = await a.wait(m => m.t === 'joined')
    const saved = { id: a.id, token: a.token }
    a.ws.close()
    await new Promise(r => setTimeout(r, 100))
    const a2 = client(srv.port, saved)
    const w = await a2.wait(m => m.t === 'welcome')
    assert.equal(w.code, code)
    const st = await a2.wait(m => m.t === 'state')
    assert.equal(st.you, saved.id)
    const evil = client(srv.port, { id: saved.id, token: 'x'.repeat(32) })
    const w2 = await evil.wait(m => m.t === 'welcome')
    assert.notEqual(w2.id, saved.id)
    assert.equal(w2.code, null)
    a2.ws.close(); evil.ws.close()
  } finally { await srv.close() }
})

test('操作を送りすぎても、部屋の操作（再戦など）は捨てられない', async () => {
  const srv = await startServer({ port: 0, quiet: true })
  try {
    const a = client(srv.port), b = client(srv.port)
    await a.ready; await a.wait(m => m.t === 'welcome'); await b.ready; await b.wait(m => m.t === 'welcome')
    a.send({ t: 'create', name: 'A' }); const { code } = await a.wait(m => m.t === 'joined')
    b.send({ t: 'join', code, name: 'B' }); await b.wait(m => m.t === 'joined')
    a.send({ t: 'start' }); await a.wait(m => m.t === 'state' && m.phase === 'playing')
    for (let i = 0; i < 300; i++) a.send({ t: 'input', data: { type: 'push', x: 1, y: 0 } }) // 一気に送る
    a.send({ t: 'leave' })
    await new Promise(r => setTimeout(r, 200))
    assert.equal(srv.rooms.rooms.get(code).players.length, 1)
    a.ws.close(); b.ws.close()
  } finally { await srv.close() }
})

test('壊れたメッセージを送ってもサーバーは落ちない', async () => {
  const srv = await startServer({ port: 0, quiet: true })
  try {
    const a = client(srv.port)
    await a.ready
    a.ws.send('not json')
    a.send({ nope: 1 })
    a.send({ t: 'input', data: { type: 'push', x: 1, y: 0 } })
    a.send({ t: 'start', opts: { rng: 'boom', course: '__proto__' } })
    await a.wait(m => m.t === 'error' && m.code === 'bad_json')
    const res = await fetch(`http://localhost:${srv.port}/healthz`)
    assert.equal((await res.json()).ok, true)
    a.ws.close()
  } finally { await srv.close() }
})

test('画面と招待URL（/r/コード）が返る。フォルダの外は読めない', async () => {
  const srv = await startServer({ port: 0, quiet: true })
  try {
    const base = `http://localhost:${srv.port}`
    assert.equal((await fetch(base + '/')).status, 200)
    assert.match(await (await fetch(base + '/r/ABCD')).text(), /<html/)
    const html = await (await fetch(base + '/', { headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'carry.example.com' } })).text()
    assert.match(html, /property="og:image" content="https:\/\/carry\.example\.com\/og\.png"/)
    assert.equal((await fetch(base + '/og.png')).headers.get('content-type'), 'image/png')
    assert.equal((await fetch(base + '/app.js')).status, 200)
    const r = await fetch(base + '/..%2fpackage.json')
    assert.notEqual(r.status, 200)
  } finally { await srv.close() }
})

test('スタートに変な opts（rng に文字列など）を送ってもサーバーは落ちず、既定の荷物で始まる', async () => {
  const srv = await startServer({ port: 0, quiet: true })
  try {
    const a = client(srv.port), b = client(srv.port)
    await a.ready; await a.wait(m => m.t === 'welcome'); await b.ready; await b.wait(m => m.t === 'welcome')
    a.send({ t: 'create', name: 'A' }); const { code } = await a.wait(m => m.t === 'joined')
    b.send({ t: 'join', code, name: 'B' }); await b.wait(m => m.t === 'joined')
    a.send({ t: 'start', opts: { rng: 'boom', course: '__proto__', cargo: 'toString' } })
    const st = await b.wait(m => m.t === 'state' && m.phase === 'playing')
    assert.equal(st.game.cargo, 'sofa')
    assert.equal(st.game.course, 'warehouse')
    assert.equal((await (await fetch(`http://localhost:${srv.port}/healthz`)).json()).ok, true)
    a.ws.close(); b.ws.close()
  } finally { await srv.close() }
})
