// 効果音と BGM。Web Audio で鳴らすだけ（音声ファイルなし）。最初に画面を触るまで鳴らない（ブラウザの決まり）。
const KEY = 'ct-mute'
let ctx = null, master = null, muted = false, bgmTimer = 0, bgmWanted = false, beat = 0
try { muted = localStorage.getItem(KEY) === '1' } catch {}

export function unlock() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return }
  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC) return
  try {
    ctx = new AC()
    master = ctx.createGain()
    master.gain.value = muted ? 0 : 0.5
    master.connect(ctx.destination)
    if (bgmWanted) startBgm()
  } catch { ctx = null }
}
addEventListener('pointerdown', unlock, { passive: true })
addEventListener('keydown', unlock)

function tone(freq, dur, { type = 'square', vol = 0.15, at = 0, slide = 0 } = {}) {
  if (!ctx || muted) return
  const t = ctx.currentTime + at
  const o = ctx.createOscillator(), g = ctx.createGain()
  o.type = type
  o.frequency.setValueAtTime(freq, t)
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur)
  g.gain.setValueAtTime(vol, t)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  o.connect(g); g.connect(master)
  o.start(t); o.stop(t + dur + 0.02)
}

function noise(dur, vol, cutoff) {
  if (!ctx || muted) return
  const len = Math.floor(ctx.sampleRate * dur)
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len)
  const src = ctx.createBufferSource(); src.buffer = buf
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff
  const g = ctx.createGain(); g.gain.value = vol
  src.connect(f); f.connect(g); g.connect(master)
  src.start()
}

export function bump(glass) {
  noise(0.18, 0.5, 500)
  tone(90, 0.15, { type: 'sine', vol: 0.3, slide: -40 })
  if (glass) { tone(1800, 0.12, { type: 'triangle', vol: 0.08 }); tone(2400, 0.1, { type: 'triangle', vol: 0.06, at: 0.04 }) }
}
export function count(n) { if (n > 0) tone(660, 0.12, { vol: 0.12 }); else tone(990, 0.3, { vol: 0.14 }) }
export function win() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.25, { vol: 0.12, at: i * 0.12 })) }
export function lose() { [392, 330, 262].forEach((f, i) => tone(f, 0.3, { type: 'sawtooth', vol: 0.08, at: i * 0.18 })) }

// BGM: ベースと刻みだけの短いループ（運搬のテンポ感）
const BASS = [110, 110, 147, 131, 110, 110, 165, 147]
export function startBgm() {
  bgmWanted = true
  if (!ctx || bgmTimer) return
  bgmTimer = setInterval(() => {
    if (muted || document.hidden) return
    const f = BASS[beat % BASS.length]
    tone(f, 0.22, { type: 'triangle', vol: 0.1 })
    if (beat % 2) noise(0.04, 0.08, 3000)
    beat++
  }, 300)
}
export function stopBgm() { bgmWanted = false; clearInterval(bgmTimer); bgmTimer = 0 }

const ICON_ON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>'
const ICON_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 9l6 6M22 9l-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
export function bindMuteButton(btn) {
  const paint = () => { btn.innerHTML = muted ? ICON_OFF : ICON_ON; btn.setAttribute('aria-label', muted ? '音を出す' : '音を消す'); btn.dataset.muted = muted ? '1' : '0' }
  paint()
  btn.onclick = () => {
    unlock()
    muted = !muted
    try { localStorage.setItem(KEY, muted ? '1' : '0') } catch {}
    if (master) master.gain.value = muted ? 0 : 0.5
    paint()
  }
}
