// 公開URL（または手元）で2人（chromium と webkit）つなぎ、ロングコース「引越し大移動」を始めて、
// 1つ目のチェックポイントを通ったあと穴に落とし、そのチェックポイントからやり直すところまで確かめる。
// 使い方: node tools/live-check.mjs https://xxxx.trycloudflare.com   （URL を省くと手元にサーバーを立てる）
import { chromium, webkit } from 'playwright'
import { COURSES } from '../public/stages.js'
import { makePilot } from './autopilot.mjs'
let base = process.argv[2], srv = null
if (!base) { const { startServer } = await import('../server.mjs'); srv = await startServer({ port: 0, quiet: true }); base = `http://localhost:${srv.port}` }
const G = COURSES.grand
const pit = G.pits.find(p => p[2] === 380 && p[3] === 140) // 回るバーの区間の先の、細い通路のあとの穴（左）
const cp0 = G.checkpoints[0]
let fail = 0
const check = (ok, label) => { console.log(ok ? 'OK  ' : 'NG  ', label); if (!ok) fail++ }
const errs = []
const bc = await chromium.launch({ channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const bw = await webkit.launch()
const mk = async b => { const c = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'ja-JP', hasTouch: true }); const p = await c.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text())); return p }
const h = await mk(bc), g = await mk(bw)
await h.goto(base); await h.fill('#name', 'ホスト'); await h.click('#createBtn'); await h.waitForSelector('#lobby:not([hidden])')
for (let i = 0; i < 8 && await h.getAttribute('#coursePick .pk-body', 'data-id') !== 'grand'; i++) await h.click('#coursePick .pk-btn[data-d="1"]')
await g.goto(await h.inputValue('#invite')); await g.fill('#name', 'ゲスト'); await g.click('#joinBtn'); await g.waitForSelector('#lobby:not([hidden])')
await g.waitForFunction(() => document.querySelector('#coursePick .pk-body')?.dataset.id === 'grand', null, { timeout: 8000 }).then(() => check(true, 'ロングコースがゲストにも見える'), () => check(false, 'ゲストにロングコースが届かない'))
await h.click('#startBtn')
await g.waitForFunction(() => window.__ct && window.__ct.view() && window.__ct.view().cd === 0, null, { timeout: 15000 })
const v0 = await h.evaluate(() => window.__ct.view())
check(v0.course === 'grand', `ロングコースが始まった（${v0.cargo}・${v0.n}人）`)
const pilot = makePilot(v0.course, v0.cargo, v0.n)
const mine = [v0.me, (await g.evaluate(() => window.__ct.view())).me]
const t0 = Date.now()
let phase = 'go', fellAt = null, shot = false
while (Date.now() - t0 < 240000) {
  const v = await h.evaluate(() => window.__ct.view())
  if (!v || v.done) break
  let ins = pilot.inputs(v)
  if (phase === 'go' && v.cp >= 0 && !shot) { shot = true; check(true, `1つ目のチェックポイントを通った（${Math.round((Date.now() - t0) / 1000)}秒）`); await h.screenshot({ path: 'tools/shots/live-cp.png' }) }
  // チェックポイントを通り、細い通路を抜けたら、左の穴へ押し込む
  if (phase === 'go' && v.cp >= 0 && v.y < pit[1] + pit[3] + 120) phase = 'drop'
  if (phase === 'drop') { ins = ins.map(() => [-1, -0.2]); if (v.fl >= 1) { phase = 'fell'; fellAt = Date.now(); await h.screenshot({ path: 'tools/shots/live-fall.png' }) } }
  if (phase === 'fell' && !v.dr && Date.now() - fellAt > 300) {
    const near = Math.hypot(v.x - cp0.at[0], v.y - cp0.at[1]) < 60
    check(near, `落ちたあと1つ目のチェックポイントからやり直した（${v.x}, ${v.y}）／ 耐久 ${v.hp}`)
    const gv = await g.evaluate(() => window.__ct.view())
    check(Math.hypot(gv.x - cp0.at[0], gv.y - cp0.at[1]) < 80 && gv.fl >= 1, 'ゲストの画面でも同じ場所に戻った')
    await h.waitForTimeout(400); await h.screenshot({ path: 'tools/shots/live-respawn.png' })
    phase = 'done'; break
  }
  await Promise.all([h.evaluate(([x, y]) => window.__ct.push(x, y), ins[mine[0]]), g.evaluate(([x, y]) => window.__ct.push(x, y), ins[mine[1]])])
  await h.waitForTimeout(70)
}
check(phase === 'done', `チェックポイントでのやり直しまで進んだ（${phase}）`)
check(errs.length === 0, `コンソールエラー0件 ${errs.slice(0, 3).join(' / ')}`)
const html = await (await fetch(base)).text()
const img = html.match(/og:image" content="([^"]+)/)
if (img) { const r = await fetch(img[1]); check(r.status === 200, `OGP 画像 ${r.status} ${img[1]}`) }
await bc.close(); await bw.close(); if (srv) await srv.close()
console.log(fail ? `NG ${fail}件` : 'すべてOK')
process.exit(fail ? 1 : 0)
