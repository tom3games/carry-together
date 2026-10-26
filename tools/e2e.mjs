// 実ブラウザ（chromium と webkit）で3人つないで、作成→招待URLで参加→荷物を選ぶ→開始→本物の操作→ゴールまで運ぶ→結果→再戦 を通す。
// あわせて、各画面が 390x844 / 360x640 / 844x390 で上下にスクロールせず収まるかを数値で確かめる。スクショは tools/shots/
// 使い方: node tools/e2e.mjs   （サーバーは自前で立てる）
import { chromium, webkit } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { startServer } from '../server.mjs'
import * as play from './e2e-play.mjs'

const SHOTS = new URL('./shots/', import.meta.url).pathname
await mkdir(SHOTS, { recursive: true })
const srv = await startServer({ port: 0, quiet: true })
const base = `http://localhost:${srv.port}`
let fail = 0
const check = (ok, label) => { console.log(ok ? 'OK  ' : 'NG  ', label); if (!ok) fail++ }
const SIZES = [[390, 844], [360, 640], [844, 390], [568, 320]]
const COURSE = process.env.COURSE || 'crosswalk' // 動く障害物のあるコースで通す
// 選択欄の矢印を押して目当てのものにする
async function choose(page, kind, id) {
  for (let i = 0; i < 8; i++) {
    if (await page.getAttribute(`#${kind}Pick .pk-body`, 'data-id') === id) return
    await page.click(`#${kind}Pick .pk-btn[data-d="1"]`)
  }
  throw new Error(`${kind} ${id} を選べない`)
}

// 画面が一画面に収まり、見えているボタンが画面の中にあり、44px 以上あるか
async function fits(page, label) {
  for (const [w, h] of SIZES) {
    await page.setViewportSize({ width: w, height: h })
    await page.waitForTimeout(250)
    const r = await page.evaluate(() => {
      const de = document.documentElement
      const bad = []
      for (const b of document.querySelectorAll('button, input, summary')) {
        if (!b.offsetParent && getComputedStyle(b).position !== 'fixed') continue
        const rc = b.getBoundingClientRect()
        if (rc.width === 0) continue
        if (rc.bottom > innerHeight + 1 || rc.right > innerWidth + 1 || rc.top < -1) bad.push((b.id || b.textContent.trim()).slice(0, 12) + ' 画面外')
        else if (rc.height < 43.5) bad.push((b.id || b.textContent.trim()).slice(0, 12) + ` 高さ${Math.round(rc.height)}`)
      }
      const cv = document.querySelector('#g-cv')
      return { sh: Math.max(de.scrollHeight, document.body.scrollHeight), sw: de.scrollWidth, ih: innerHeight, iw: innerWidth, bad, cvH: cv && cv.offsetParent ? cv.getBoundingClientRect().height : null }
    })
    check(r.sh <= r.ih + 1 && r.sw <= r.iw + 1 && r.bad.length === 0 && (r.cvH === null || r.cvH >= 120),
      `${label} ${w}x${h}: 一画面に収まる（高さ ${r.sh}/${r.ih} 幅 ${r.sw}/${r.iw}${r.cvH !== null ? ` 盤面 ${Math.round(r.cvH)}px` : ''}）${r.bad.join(' ')}`)
    await page.screenshot({ path: `${SHOTS}${label}-${w}x${h}.png` })
  }
  await page.setViewportSize({ width: 390, height: 844 })
}

// chromium は GPU を使う設定で起動する（既定のソフトウェア描画だと 3D が 20fps になり、操作の確認が間に合わない）
const GPU = { channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] }
for (const [bname, bt] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await bt.launch(bname === 'chromium' ? GPU : {})
  const errors = []
  const mk = async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ja-JP', hasTouch: true, isMobile: bname === 'chromium' })
    const p = await ctx.newPage()
    p.on('pageerror', e => errors.push(e.message))
    p.on('console', m => m.type() === 'error' && errors.push(m.text()))
    p.on('requestfailed', r => errors.push('requestfailed ' + r.url()))
    p.on('response', r => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`))
    return p
  }
  const host = await mk(), g1 = await mk(), g2 = await mk()
  await host.goto(base)
  await host.waitForSelector('#home:not([hidden])')
  check((await host.title()).includes('みんなで運べ'), `${bname}: 題名が出る`)
  await fits(host, `${bname}-home`)
  await host.fill('#name', 'ホスト')
  await host.click('#createBtn')
  await host.waitForSelector('#lobby:not([hidden])')
  const invite = await host.inputValue('#invite')
  check(/\/r\/[A-Z0-9]{4}$/.test(invite), `${bname}: 招待URLが出る ${invite}`)
  for (const [g, nm] of [[g1, 'ゲスト1'], [g2, 'とても長い名前のひと']]) {
    await g.goto(invite)
    check((await g.inputValue('#code')).length === 4, `${bname}: 招待URLを開くと参加コードが入っている`)
    if (g === g1) await fits(g1, `${bname}-invite`)
    await g.fill('#name', nm)
    await g.click('#joinBtn')
    await g.waitForSelector('#lobby:not([hidden])')
  }
  await host.waitForFunction(() => document.querySelectorAll('#players li').length === 3)
  check(true, `${bname}: 3人がロビーにそろう`)
  check(await g1.isHidden('#cargoPick .pk-btn'), `${bname}: 荷物とコースを選べるのはホストだけ`)
  await choose(host, 'cargo', 'tank'); await choose(host, 'cargo', 'sofa')
  await choose(host, 'course', COURSE)
  check(await host.getAttribute('#cargoPick .pk-body', 'data-id') === 'sofa', `${bname}: 荷物を選べる`)
  await g1.waitForFunction(c => document.querySelector('#coursePick .pk-body')?.dataset.id === c, COURSE, { timeout: 3000 }).then(() => check(true, `${bname}: ホストが選んだコースが参加者にも見える`), () => check(false, `${bname}: 参加者にコースが届かない`))
  await fits(host, `${bname}-lobby`)
  await fits(g1, `${bname}-lobby-guest`)
  await host.click('#startBtn')
  await g1.waitForSelector('#game:not([hidden])')
  check(true, `${bname}: ゲームが始まる`)
  await host.waitForTimeout(600)
  const cdText = await host.textContent('#g-banner')
  check(/あなたは「.+」を持つ/.test(cdText), `${bname}: カウントダウン中に自分の持ち手が出る（${cdText.replace(/\s+/g, ' ')}）`)
  await host.screenshot({ path: `${SHOTS}${bname}-countdown.png` })
  const mes = await Promise.all([host, g1, g2].map(p => p.evaluate(() => window.__ct.view().me)))
  check(new Set(mes).size === 3, `${bname}: 3人の持ち手が別々 ${mes}`)
  await play.checkRealInput([host, g1], check, bname)
  // かけ声: ボタンを押すと全員の画面に吹き出しが出る
  await host.locator('.em-btn[data-k="0"]').dispatchEvent('pointerdown')
  await g2.waitForFunction(() => (window.__ct.view().em || []).some(e => e[1] === 0), null, { timeout: 3000 }).then(() => check(true, `${bname}: かけ声ボタンが全員に届く`), () => check(false, `${bname}: かけ声が届かない`))
  await g1.keyboard.press('Digit6')
  await host.waitForFunction(() => (window.__ct.view().em || []).some(e => e[1] === 5), null, { timeout: 3000 }).then(() => check(true, `${bname}: 数字キーでもかけ声を出せる`), () => check(false, `${bname}: 数字キーのかけ声が届かない`))
  await host.waitForTimeout(300)
  await host.screenshot({ path: `${SHOTS}${bname}-emote.png` })
  // 盤面が描けているか（ほぼ単色なら描けていない）
  const mode = await host.evaluate(() => window.__ct.mode())
  check(mode === '3d', `${bname}: 3D で描いている（${mode}）`)
  const variance = await host.evaluate(() => window.__ct.variance())
  check(variance > 200, `${bname}: 3D の盤面が描けている（輝度の分散 ${Math.round(variance)}）`)
  const fps = await host.evaluate(() => window.__ct.fps())
  console.log(`     ${bname}: fps ${fps.toFixed(1)}（headless の参考値。スマホ相当の測定は tools/fps.mjs）`)
  await play.playToEnd([host, g1, g2], { shot: async () => {
    await host.screenshot({ path: `${SHOTS}${bname}-game.png` })
    await fits(g1, `${bname}-game`)
  } })
  await g1.waitForSelector('#result:not([hidden])', { timeout: 90000 })
  const title = await g1.textContent('#resultTitle')
  check(title === '到着！', `${bname}: 3人でゴールまで運べて結果画面が出る（${title}）`)
  const medal = await g1.getAttribute('.medal', 'data-m').catch(() => null)
  check(['gold', 'silver', 'bronze'].includes(medal), `${bname}: メダルが出る（${medal}）`)
  check(/自己ベスト|初めて/.test(await g1.textContent('.res-best')), `${bname}: 自己ベストが出る`)
  await g1.waitForTimeout(900) // メダルの登場アニメが終わってから
  const mw = await g1.evaluate(() => document.querySelector('.medal').getBoundingClientRect().width)
  check(mw >= 40, `${bname}: メダルが小さくつぶれていない（幅 ${Math.round(mw)}px）`)
  await g1.screenshot({ path: `${SHOTS}${bname}-result.png` })
  await fits(g2, `${bname}-result`)
  await host.waitForSelector('#result:not([hidden])')
  check(await g1.isHidden('#rematchBtn'), `${bname}: 再戦ボタンはホストだけ`)
  await host.click('#rematchBtn')
  await g1.waitForSelector('#game:not([hidden])')
  const round2 = await g2.evaluate(() => window.__ct.view().cd)
  check(round2 > 0, `${bname}: 再戦できる（新しいカウントダウン）`)
  check(errors.length === 0, `${bname}: コンソールエラー0件 ${errors.slice(0, 3).join(' / ')}`)
  await browser.close()
}
// 8人（最大人数）: ロビー・ゲーム中・結果が収まるか。全員で外へ引っぱり合って、水槽が裂けて終わるところまで
{
  const browser = await webkit.launch()
  const errors = []
  const pages = []
  for (let i = 0; i < 8; i++) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ja-JP', hasTouch: true })
    const p = await ctx.newPage()
    p.on('pageerror', e => errors.push(e.message))
    p.on('console', m => m.type() === 'error' && errors.push(m.text()))
    pages.push(p)
  }
  const [host] = pages
  await host.goto(base); await host.fill('#name', 'ホスト'); await host.click('#createBtn'); await host.waitForSelector('#lobby:not([hidden])')
  const inv = await host.inputValue('#invite')
  for (let i = 1; i < 8; i++) { await pages[i].goto(inv); await pages[i].fill('#name', 'なかまのなまえ' + i); await pages[i].click('#joinBtn'); await pages[i].waitForSelector('#lobby:not([hidden])') }
  await host.waitForFunction(() => document.querySelectorAll('#players li').length === 8)
  check(true, 'webkit 8人: ロビーにそろう')
  await fits(host, 'webkit8-lobby')
  await choose(host, 'cargo', 'tank')
  await host.click('#startBtn')
  await host.waitForFunction(() => window.__ct && window.__ct.view() && window.__ct.view().cd === 0, null, { timeout: 10000 })
  const mes = await Promise.all(pages.map(p => p.evaluate(() => window.__ct.view().me)))
  check(new Set(mes).size === 8, `webkit 8人: 持ち手が8つ別々 ${mes}`)
  // 外向き（持ち手の並びは前から左回り＝角度 -2πi/n）に引っぱる
  let warned = false
  for (let k = 0; k < 120; k++) {
    if (await host.evaluate(() => !document.querySelector('#result').hidden)) break
    await Promise.all(pages.map(p => p.evaluate(() => { const v = window.__ct.view(); if (!v) return; const t = v.a - v.me * 2 * Math.PI / v.n; window.__ct.push(Math.round(Math.cos(t) * 100) / 100, Math.round(Math.sin(t) * 100) / 100) })))
    if (!warned && await pages[3].evaluate(() => { const b = document.querySelector('#g-banner'); return b && !b.hidden && b.dataset.kind === 'warn' })) {
      warned = true
      check(true, 'webkit 8人: 引っぱり合うと「引っぱりすぎ」の警告が出る')
      await pages[3].screenshot({ path: `${SHOTS}webkit8-pull.png` })
      await fits(pages[3], 'webkit8-game')
    }
    await host.waitForTimeout(100)
  }
  check(warned, 'webkit 8人: 警告を確認した')
  await host.waitForSelector('#result:not([hidden])', { timeout: 30000 })
  check(await host.textContent('#resultTitle') === '壊れた', `webkit 8人: 裂けて「壊れた」で終わる（${await host.textContent('#resultTitle')}）`)
  await fits(host, 'webkit8-result')
  check(errors.length === 0, `webkit 8人: コンソールエラー0件 ${errors.slice(0, 3).join(' / ')}`)
  await browser.close()
}

await srv.close()
console.log(fail ? `NG ${fail}件` : 'すべてOK')
process.exit(fail ? 1 : 0)
