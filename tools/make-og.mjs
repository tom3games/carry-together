// OGP 画像（public/og.png, 1200x630）を作る。使い方: node tools/make-og.mjs
// 1) サーバーを立てて4人で横断歩道を運び始め、3D の画面だけを撮る（HUD は隠す）
// 2) その上にタイトルのロゴ（筆のかすれ＋白と橙の文字）と手書きの一言を重ねる
import { chromium } from 'playwright'
import { readFile } from 'node:fs/promises'
import { startServer } from '../server.mjs'
import { makePilot } from './autopilot.mjs'

const OUT = new URL('../public/og.png', import.meta.url).pathname
const srv = await startServer({ port: 0, quiet: true })
const base = `http://localhost:${srv.port}`
const b = await chromium.launch({ channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const pages = []
for (let i = 0; i < 4; i++) pages.push(await (await b.newContext({ viewport: i ? { width: 390, height: 844 } : { width: 1200, height: 630 }, deviceScaleFactor: i ? 1 : 1.5, locale: 'ja-JP' })).newPage())
const [h] = pages
await h.goto(base); await h.fill('#name', 'たろう'); await h.click('#createBtn'); await h.waitForSelector('#lobby:not([hidden])')
for (let i = 0; i < 6 && await h.getAttribute('#coursePick .pk-body', 'data-id') !== 'crosswalk'; i++) await h.click('#coursePick .pk-btn[data-d="1"]')
const inv = await h.inputValue('#invite')
for (const [i, nm] of [[1, 'はなこ'], [2, 'けんた'], [3, 'みお']]) { await pages[i].goto(inv); await pages[i].fill('#name', nm); await pages[i].click('#joinBtn'); await pages[i].waitForSelector('#lobby:not([hidden])') }
await h.click('#startBtn')
await h.waitForFunction(() => window.__ct && window.__ct.view() && window.__ct.view().cd === 0, null, { timeout: 10000 })
const v0 = await h.evaluate(() => window.__ct.view())
const pilot = makePilot(v0.course, v0.cargo, v0.n)
const mine = []
for (const p of pages) mine.push((await p.evaluate(() => window.__ct.view())).me)
const t0 = Date.now()
while (Date.now() - t0 < 7000) {
  const v = await h.evaluate(() => window.__ct.view())
  const ins = pilot.inputs(v)
  await Promise.all(pages.map((p, i) => p.evaluate(([x, y]) => window.__ct.push(x, y), ins[mine[i]])))
  await h.waitForTimeout(80)
}
await pages[2].evaluate(() => window.__ct.emote(0))
await h.waitForTimeout(400)
await h.addStyleTag({ content: '.hud-top,.route,.me-chip,.emotes,.pad,#g-ov,#quitBtn,.banner,.tag{display:none!important}' })
await h.waitForTimeout(200)
const shot = await h.locator('#g-wrap').screenshot()
const bg = 'data:image/png;base64,' + shot.toString('base64')
const logo = (await readFile(new URL('../public/index.html', import.meta.url), 'utf8')).match(/<svg class="logo-svg"[\s\S]*?<\/svg>/)[0]
const og = await (await b.newContext({ viewport: { width: 1200, height: 630 } })).newPage()
await og.setContent(`<!doctype html><html><head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=M+PLUS+Rounded+1c:wght@900&family=Yomogi&display=swap"><style>
  body{margin:0;width:1200px;height:630px;position:relative;overflow:hidden;font-family:"M PLUS Rounded 1c",sans-serif}
  .bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
  .logo{position:absolute;left:18px;top:6px;width:560px;filter:drop-shadow(0 8px 0 rgba(0,0,0,.25))}
  .logo svg{width:100%;height:auto}
  .hand{position:absolute;font-family:Yomogi,sans-serif;color:#fff;font-size:36px;line-height:1.3;transform:rotate(-4deg);text-shadow:3px 0 0 #17120e,-3px 0 0 #17120e,0 3px 0 #17120e,0 -3px 0 #17120e,2px 2px 0 #17120e,-2px 2px 0 #17120e,2px -2px 0 #17120e,-2px -2px 0 #17120e}
  .hand::after{content:"";display:block;width:85%;height:5px;margin-top:4px;border-radius:4px;background:#fff;box-shadow:0 0 0 3px #17120e;transform:rotate(-3deg)}
</style></head><body><img class="bg" src="${bg}"><div class="logo">${logo}</div>
<p class="hand" style="right:40px;top:26px">2〜8人で協力して<br>荷物を運べ！</p>
<p class="hand" style="left:40px;bottom:30px;transform:rotate(3deg)">壊してもいい、<br>それで進める。</p>
<p class="hand" style="right:44px;bottom:34px">一緒に運ぶから<br>楽しい！</p></body></html>`)
await og.waitForLoadState('networkidle').catch(() => {})
await og.evaluate(() => document.fonts.ready)
await og.screenshot({ path: OUT })
await b.close(); await srv.close()
console.log('public/og.png')
