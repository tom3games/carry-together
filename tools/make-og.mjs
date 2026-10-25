// OGP 画像（public/og.png, 1200x630）を SVG から作る。使い方: node tools/make-og.mjs
import { chromium } from 'playwright'
const cols = ['#ffcf3a', '#5ad1ff', '#ff7aa8', '#8be36b']
const people = [[-150, 0, 1, 0.25], [0, -62, 0.7, -0.7], [150, 0, 1, -0.2], [0, 62, 0.9, 0.4]]
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<defs>
  <pattern id="wood" width="240" height="60" patternUnits="userSpaceOnUse">
    <rect width="240" height="60" fill="#b48a5a"/><path d="M0 0H240M120 0V60" stroke="#6e4a26" stroke-opacity=".35" stroke-width="3"/>
  </pattern>
  <marker id="ah" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M0 0L10 5L0 10z" fill="#fff"/></marker>
</defs>
<rect width="1200" height="630" fill="#1b1d22"/>
<rect x="620" y="0" width="580" height="630" fill="url(#wood)"/>
<rect x="620" y="0" width="580" height="90" fill="#3a3f4b"/><rect x="620" y="540" width="580" height="90" fill="#3a3f4b"/>
<rect x="900" y="0" width="160" height="90" fill="#b48a5a"/>
<rect x="905" y="20" width="150" height="60" fill="#3ddc97" fill-opacity=".35" stroke="#3ddc97" stroke-width="5" stroke-dasharray="14 9"/>
<g transform="translate(905 330) rotate(-28)">
  <rect x="-160" y="-60" width="320" height="120" fill="#000" fill-opacity=".25" transform="translate(10 12)"/>
  <rect x="-160" y="-60" width="320" height="120" fill="#8f3626" stroke="#5a1f14" stroke-width="5"/>
  <rect x="-140" y="-32" width="280" height="80" fill="#c8553d"/>
  <rect x="-160" y="-60" width="320" height="28" fill="#a5402d"/>
  <path d="M0 -32V48" stroke="#000" stroke-opacity=".25" stroke-width="4"/>
  <circle r="14" fill="none" stroke="#fff" stroke-width="5"/><path d="M-22 0H22M0 -22V22" stroke="#fff" stroke-width="5"/>
  ${people.map(([x, y, ux, uy], i) => {
    const ox = x === 0 ? 0 : Math.sign(x) * 40, oy = y === 0 ? 0 : Math.sign(y) * 40
    const px = x + ox, py = y + oy, m = Math.hypot(ux, uy)
    return `<path d="M${x} ${y}L${px} ${py}" stroke="${cols[i]}" stroke-width="10" stroke-linecap="round"/>
    <path d="M${px} ${py}l${(ux / m) * 80} ${(uy / m) * 80}" stroke="#fff" stroke-width="9" stroke-linecap="round" marker-end="url(#ah)"/>
    <circle cx="${px}" cy="${py}" r="30" fill="${cols[i]}" stroke="#111" stroke-width="5"/>
    <text x="${px}" y="${py + 11}" font-size="32" font-weight="800" text-anchor="middle" fill="#111" font-family="Hiragino Sans, sans-serif" transform="rotate(28 ${px} ${py})">${i + 1}</text>`
  }).join('')}
</g>
<rect x="56" y="64" width="110" height="16" fill="#d9b27c"/>
<text x="56" y="190" font-size="92" font-weight="900" fill="#f4f1ea" font-family="Hiragino Sans, Noto Sans JP, sans-serif">みんなで</text>
<text x="56" y="300" font-size="92" font-weight="900" fill="#f0a040" font-family="Hiragino Sans, Noto Sans JP, sans-serif">運べ！</text>
<text x="58" y="378" font-size="34" font-weight="700" fill="#f4f1ea" font-family="Hiragino Sans, Noto Sans JP, sans-serif">2〜8人で巨大な荷物を運ぶ</text>
<text x="58" y="426" font-size="34" font-weight="700" fill="#f4f1ea" font-family="Hiragino Sans, Noto Sans JP, sans-serif">協力ゲーム</text>
<text x="58" y="500" font-size="26" fill="#a9adb6" font-family="Hiragino Sans, Noto Sans JP, sans-serif">押す向きがそろわないと回る。</text>
<text x="58" y="540" font-size="26" fill="#a9adb6" font-family="Hiragino Sans, Noto Sans JP, sans-serif">引っぱると裂ける。スマホでリンクから参加。</text>
</svg>`
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1200, height: 630 } })
await p.setContent(`<html><body style="margin:0">${svg}</body></html>`)
await p.screenshot({ path: new URL('../public/og.png', import.meta.url).pathname })
await b.close()
console.log('public/og.png')
