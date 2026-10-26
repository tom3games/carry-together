// 5コースを2人でつないで、開始数秒後の盤面を撮る（見た目の確認用）。tools/shots/course-*.png
import { chromium } from 'playwright'
import { startServer } from '../server.mjs'
import { COURSES } from '../public/stages.js'
import { makePilot } from './autopilot.mjs'
const SHOTS = new URL('./shots/', import.meta.url).pathname
const srv = await startServer({ port: 0, quiet: true })
const base = `http://localhost:${srv.port}`
const browser = await chromium.launch()
const errors = []
const mk = async (w, h) => { const c = await browser.newContext({ viewport: { width: w, height: h }, locale: 'ja-JP', hasTouch: true, isMobile: true }); const p = await c.newPage(); p.on('pageerror', e => errors.push(e.message)); p.on('console', m => m.type() === 'error' && errors.push(m.text())); return p }
const W = Number(process.env.W || 390), H = Number(process.env.H || 844)
const host = await mk(W, H), guest = await mk(W, H)
await host.goto(base); await host.fill('#name', 'たろう'); await host.click('#createBtn'); await host.waitForSelector('#lobby:not([hidden])')
await guest.goto(await host.inputValue('#invite')); await guest.fill('#name', 'はなこ'); await guest.click('#joinBtn'); await guest.waitForSelector('#lobby:not([hidden])')
const only = process.argv[2]
const secs = Number(process.argv[3] || 8)
for (const id of Object.keys(COURSES).filter(k => !k.startsWith('_') && (!only || k === only))) {
  for (let i = 0; i < 6 && await host.getAttribute('#coursePick .pk-body', 'data-id') !== id; i++) await host.click('#coursePick .pk-btn[data-d="1"]')
  await host.click(process.env.REMATCH ? '#rematchBtn' : '#startBtn').catch(() => {})
  await host.waitForFunction(() => window.__ct && window.__ct.view() && window.__ct.view().cd === 0, null, { timeout: 10000 })
  const v0 = await host.evaluate(() => window.__ct.view())
  const pilot = makePilot(v0.course, v0.cargo, v0.n)
  const mine = [await host.evaluate(() => window.__ct.view().me), await guest.evaluate(() => window.__ct.view().me)]
  const t0 = Date.now()
  while (Date.now() - t0 < secs * 1000) {
    const v = await host.evaluate(() => window.__ct.view())
    if (!v || v.done) break
    const ins = pilot.inputs(v)
    await host.evaluate(([x, y]) => window.__ct.push(x, y), ins[mine[0]]); await guest.evaluate(([x, y]) => window.__ct.push(x, y), ins[mine[1]])
    await host.waitForTimeout(60)
  }
  await host.evaluate(() => window.__ct.emote(1)); await host.waitForTimeout(200)
  await host.screenshot({ path: `${SHOTS}course-${id}-${W}x${H}.png` })
  // 次のコースへ: 抜けずにロビーへ戻る（ホストは結果を待たず退出→作り直すのは重いので、時間切れまで待たない）
  await host.click('#quitBtn'); await host.click('#quitBtn')
  await host.waitForSelector('#home:not([hidden])')
  await guest.click('#quitBtn'); await guest.click('#quitBtn'); await guest.waitForSelector('#home:not([hidden])')
  await host.click('#createBtn'); await host.waitForSelector('#lobby:not([hidden])')
  await guest.goto(await host.inputValue('#invite')); await guest.click('#joinBtn'); await guest.waitForSelector('#lobby:not([hidden])')
}
console.log('errors', errors.length, errors.slice(0, 3).join(' / '))
await browser.close(); await srv.close()
