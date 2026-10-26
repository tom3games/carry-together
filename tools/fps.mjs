// 3D の fps を測る（GPU を使う設定の headless Chromium）。スマホ相当（390x844・画素比3・タッチ）と横持ちで、5コースを数秒ずつ動かす
import { chromium } from 'playwright'
import { startServer } from '../server.mjs'
import { COURSES } from '../public/stages.js'
import { makePilot } from './autopilot.mjs'
const srv = await startServer({ port: 0, quiet: true })
const base = `http://localhost:${srv.port}`
const b = await chromium.launch({ channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
for (const [w, h] of [[390, 844], [844, 390]]) {
  const mk = async () => (await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'ja-JP' })).newPage()
  for (const id of Object.keys(COURSES).filter(k => !k.startsWith('_'))) {
    const hp = await mk(), gp = await mk()
    await hp.goto(base); await hp.fill('#name', 'A'); await hp.click('#createBtn'); await hp.waitForSelector('#lobby:not([hidden])')
    for (let i = 0; i < 6 && await hp.getAttribute('#coursePick .pk-body', 'data-id') !== id; i++) await hp.click('#coursePick .pk-btn[data-d="1"]')
    await gp.goto(await hp.inputValue('#invite')); await gp.fill('#name', 'B'); await gp.click('#joinBtn'); await gp.waitForSelector('#lobby:not([hidden])')
    await hp.click('#startBtn')
    await hp.waitForFunction(() => window.__ct && window.__ct.view() && window.__ct.view().cd === 0, null, { timeout: 10000 })
    const v0 = await hp.evaluate(() => window.__ct.view()); const pilot = makePilot(v0.course, v0.cargo, v0.n)
    const mine = [v0.me, (await gp.evaluate(() => window.__ct.view())).me]
    const t0 = Date.now()
    while (Date.now() - t0 < 6000) {
      const v = await hp.evaluate(() => window.__ct.view()); if (!v || v.done) break
      const ins = pilot.inputs(v)
      await hp.evaluate(([x, y]) => window.__ct.push(x, y), ins[mine[0]]); await gp.evaluate(([x, y]) => window.__ct.push(x, y), ins[mine[1]])
      await hp.waitForTimeout(100)
    }
    const r = await hp.evaluate(() => ({ fps: window.__ct.fps(), tier: window.__ct.tier() }))
    console.log(`${w}x${h} ${id.padEnd(10)} fps ${r.fps.toFixed(1)} 画質 ${r.tier}`)
    await hp.context().close(); await gp.context().close()
  }
}
await b.close(); await srv.close()
