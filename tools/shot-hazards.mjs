// 仕掛けのある場所の 3D 画面を、通しで遊ばずに撮る（見た目の確認用）。tools/shots/hz-*.png
// 実際の描画コード（view3d.js と床の絵）をページの中で動かし、荷物を決めた場所・時刻に置いて撮る
import { chromium } from 'playwright'
import { startServer } from '../server.mjs'
import { COURSES, moverAt, gateClosed, dropState } from '../public/stages.js'
const SHOTS = new URL('./shots/', import.meta.url).pathname
const srv = await startServer({ port: 0, quiet: true })
const b = await chromium.launch({ channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const W = Number(process.env.W || 390), H = Number(process.env.H || 844)
const page = await (await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 })).newPage()
const errs = []
page.on('pageerror', e => errs.push(e.message)); page.on('console', m => m.type() === 'error' && errs.push(m.text()))
await page.goto(`http://localhost:${srv.port}`); await page.waitForFunction(() => window.__boot)
// 撮る場所: [名前, コース, 荷物の y, 時刻 t, 状態]
const spots = []
for (const [id, c] of Object.entries(COURSES)) {
  if (id === 'grand') continue
  for (const sp of c.spinners) spots.push([`${id}-spinner`, id, sp.y + 330, 3])
  for (const [i, g] of c.gates.entries()) { let t = 0; while (!gateClosed(g, t)) t += 0.1; spots.push([`${id}-gate${i}`, id, g.r[1] + 230, t + 0.8, { gs: c.gates.map(q => (gateClosed(q, t + 0.8) ? 1 : 0)).join('') }]) }
  if (c.drops.length) { const d = c.drops[0]; let t = 1; while (dropState(d, t).until > 0.3) t += 0.05; spots.push([`${id}-drops`, id, d.y + 260, t]) }
  for (const pf of c.platforms) spots.push([`${id}-raft`, id, pf.swing.a[1] + 30, 0.2])
  if (c.crumbles.length) spots.push([`${id}-crumble`, id, c.crumbles[c.crumbles.length - 1].r[1] + 200, 0, { cr: c.crumbles.map((q, i) => (i % 4 === 0 ? 2 : i % 3 === 0 ? 1 : 0)).join('') }])
  for (const z of c.zones.filter(z => z.type === 'wind')) spots.push([`${id}-wind`, id, z.r[1] + z.r[3] / 2, 1])
  if (c.checkpoints.length) spots.push([`${id}-cp`, id, c.checkpoints[0].r[1] + 300, 0, { cp: 0 }])
  spots.push([`${id}-goal`, id, c.goal[1] + 420, 0])
}
const G = COURSES.grand
for (const r of G.regions.filter((r, i, a) => i === 0 || r.theme !== a[i - 1].theme)) spots.push([`grand-${r.theme}`, 'grand', Math.min(G.size[1] - 200, r.y1 - 150), 0])
for (const [name, id, y, t, extra] of (process.argv[2] ? spots.filter(s => s[0].includes(process.argv[2])) : spots)) {
  await page.evaluate(async ({ id, y, t, extra, W, H }) => {
    const { createView3D } = await import('/view3d.js')
    const gv = await import('/game-view.js')
    const { COURSES, CARGOS } = await import('/stages.js')
    document.body.innerHTML = ''
    const cv = document.createElement('canvas'); cv.style.cssText = `position:fixed;inset:0;width:${W}px;height:${H}px`; document.body.append(cv)
    createView3D.paintFloor = gv.paintFloor
    if (window.__v3) window.__v3.dispose()
    const v = window.__v3 = createView3D(cv, { course: COURSES[id], cargo: CARGOS.crate, n: 4, me: 0 })
    v.setSize(W, H)
    const g = { hs: [[null, 0, -1, 1], [null, 0, -1, 1], [null, 0, -1, 1], [null, 0, -1, 1]], hp: 110, done: null, em: [], cp: -1, gs: '', cr: '', ...extra }
    let now = performance.now()
    for (let i = 0; i < 40; i++) { now += 16; v.frame({ p: { x: 500, y, a: -Math.PI / 2, gt: t }, g, now, dt: 0.016, walk: i * 0.3, speed: 60 }) }
  }, { id, y, t, extra: extra || {}, W, H })
  await page.screenshot({ path: `${SHOTS}hz-${name}.png` })
}
console.log('撮った', spots.length, 'errors', errs.length, errs.slice(0, 3))
await b.close(); await srv.close()
