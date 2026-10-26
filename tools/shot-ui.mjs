// ホーム・遊び方・ロビーを4サイズで撮る（見た目の確認用）。tools/shots/ui-*.png
import { chromium } from 'playwright'
import { startServer } from '../server.mjs'
const SHOTS = new URL('./shots/', import.meta.url).pathname
const srv = await startServer({ port: 0, quiet: true })
const base = `http://localhost:${srv.port}`
const b = await chromium.launch()
const errs = []
for (const [w, h] of [[390, 844], [360, 640], [844, 390], [568, 320]]) {
  const c = await b.newContext({ viewport: { width: w, height: h }, locale: 'ja-JP', hasTouch: true, isMobile: true })
  const p = await c.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()))
  await p.goto(base); await p.waitForSelector('#home:not([hidden])'); await p.waitForTimeout(600)
  await p.screenshot({ path: `${SHOTS}ui-home-${w}x${h}.png` })
  await p.click('#howBtn'); await p.waitForTimeout(200); await p.screenshot({ path: `${SHOTS}ui-howto-${w}x${h}.png` }); await p.click('#howClose')
  await p.fill('#name', 'たろう'); await p.click('#createBtn'); await p.waitForSelector('#lobby:not([hidden])')
  const g = await c.newPage(); await g.goto(await p.inputValue('#invite')); await g.fill('#name', 'とても長い名前のひと'); await g.click('#joinBtn'); await g.waitForSelector('#lobby:not([hidden])')
  await p.waitForTimeout(400); await p.screenshot({ path: `${SHOTS}ui-lobby-${w}x${h}.png` }); await g.screenshot({ path: `${SHOTS}ui-lobbyguest-${w}x${h}.png` })
  await c.close()
}
console.log('errors', errs.length, errs.slice(0, 3))
await b.close(); await srv.close()
