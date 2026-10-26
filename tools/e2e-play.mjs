// 「最後まで遊ぶ」手順。まず本物の操作（スティックのドラッグとキーボード）が荷物に届くことを確かめ、
// そのあと自動操縦（tools/autopilot.mjs）で全員の押す向きを決めてゴールまで運ぶ。
import { makePilot } from './autopilot.mjs'

const view = p => p.evaluate(() => window.__ct && window.__ct.view())

export async function checkRealInput(pages, check, label) {
  const [host, guest] = pages
  await host.waitForFunction(() => window.__ct && window.__ct.view() && window.__ct.view().cd === 0, null, { timeout: 10000 })
  // スティック: 真ん中から右上へドラッグ
  const box = await host.locator('#g-pad').boundingBox()
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2
  await host.mouse.move(cx, cy); await host.mouse.down(); await host.mouse.move(cx + 40, cy - 40, { steps: 4 })
  const meH = (await view(host)).me
  await host.waitForFunction(h => { const v = window.__ct.view(); return v.hs[h][1] > 0.5 && v.hs[h][2] < -0.5 }, meH, { timeout: 3000 }).then(() => check(true, `${label}: スティックの向きがサーバーに届き、全員の画面に返ってくる`), () => check(false, `${label}: スティックの向きが届かない`))
  await guest.waitForFunction(h => { const v = window.__ct.view(); return v.hs[h][1] > 0.5 }, meH, { timeout: 3000 }).then(() => check(true, `${label}: 他の人の画面にもその人の矢印が出る`), () => check(false, `${label}: 他の人の画面に届かない`))
  await host.mouse.up()
  await host.waitForFunction(h => window.__ct.view().hs[h][1] === 0, meH, { timeout: 3000 }).then(() => check(true, `${label}: 指を離すと押すのをやめる`), () => check(false, `${label}: 指を離しても押し続けている`))
  // キーボード
  const meG = (await view(guest)).me
  await guest.keyboard.down('ArrowLeft')
  await guest.waitForFunction(h => window.__ct.view().hs[h][1] < -0.5, meG, { timeout: 3000 }).then(() => check(true, `${label}: キーボード（矢印）でも押せる`), () => check(false, `${label}: キーボードが効かない`))
  await guest.keyboard.up('ArrowLeft')
  await guest.waitForTimeout(400)
}

export async function playToEnd(pages, { shot } = {}) {
  const host = pages[0]
  const v0 = await view(host)
  const pilot = makePilot(v0.course, v0.cargo, v0.n)
  const mine = []
  for (const p of pages) mine.push((await view(p)).me)
  const t0 = Date.now()
  let shotDone = false
  while (Date.now() - t0 < 170000) {
    const v = await view(host)
    if (!v || await host.evaluate(() => document.querySelector('#result') && !document.querySelector('#result').hidden)) break
    const ins = pilot.inputs(v)
    await Promise.all(pages.map((p, i) => p.evaluate(([x, y]) => window.__ct && window.__ct.push(x, y), ins[mine[i]])))
    if (shot && !shotDone && pilot.wp >= 5) { shotDone = true; await shot() }
    await host.waitForTimeout(60)
  }
}
