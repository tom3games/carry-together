// 画面の切り替え（ホーム → ロビー → ゲーム → 結果）。ゲーム中の描画と操作は game-view.js に任せる。
import { connect } from './net.js'
import * as view from './game-view.js'
import { COURSES, CARGOS, DEFAULT_COURSE, DEFAULT_CARGO } from './stages.js'

const $ = s => document.querySelector(s)
const screens = ['home', 'lobby', 'game', 'result']
const ERR = {
  not_found: 'その部屋は見つかりません。コードを確かめてください',
  full: 'その部屋は満員です',
  started: 'その部屋はもうゲームを始めています。終わるまで待ってください',
  bad_name: 'ニックネームを入れてください（12文字まで）',
  not_host: 'ゲームを始められるのはホストだけです',
  not_enough: '人数が足りません',
  not_playing: 'いまはゲーム中ではありません',
  no_room: '部屋に入っていません',
  closed: 'しばらく動きがなかったので、部屋を閉じました'
}

let me = null, state = null, gameMeta = null, leftCode = null
const NAME_KEY = 'pg-name'
// ホストが選ぶ荷物とコース（スタートと再戦のときにサーバーへ送る。サーバー側でも検証する）
const pick = { course: DEFAULT_COURSE, cargo: 'crate' } // ロビーでは木箱から選び始める（サーバーの既定はソファのまま）
const COURSE_IDS = Object.keys(COURSES).filter(k => !k.startsWith('_'))
const CARGO_IDS = Object.keys(CARGOS)
try {
  const c = localStorage.getItem('ct-cargo'); if (CARGO_IDS.includes(c)) pick.cargo = c
  const k = localStorage.getItem('ct-course'); if (COURSE_IDS.includes(k)) pick.course = k
} catch {}
const MEDAL_NAME = { gold: '金', silver: '銀', bronze: '銅' }
const CHEV = d => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d < 0 ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'}" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`

const net = connect({
  onStatus: s => {
    const el = $('#net')
    el.dataset.s = s
    el.textContent = s === 'online' ? '接続中' : s === 'connecting' ? '接続しています' : '切断。つなぎ直しています'
  },
  onMessage: msg => {
    if (msg.t === 'welcome') {
      me = msg.id; gameMeta = msg.game
      document.title = gameMeta.title
      // 招待URL（/r/ABCD）で開いたら、コード欄を埋めておく
      const m = location.pathname.match(/^\/r\/([A-Z0-9]{4})/i)
      if (m && !msg.code) { $('#code').value = m[1].toUpperCase(); $('#joinBox').open = true; $('#name').focus() }
      if (!msg.code) show('home')
    } else if (msg.t === 'state') {
      if (leftCode && msg.code === leftCode) return // 抜けた直後に届いた古い部屋の状態で、画面を戻さない
      state = msg
      render()
    } else if (msg.t === 'joined') {
      history.replaceState(null, '', '/r/' + msg.code)
    } else if (msg.t === 'error') {
      if (msg.code === 'too_fast' || msg.code === 'over' || (msg.code === 'not_playing' && msg.req === 'input')) return // かけ声の連打・終了直後の操作は黙って捨てる
      toast(ERR[msg.code] ? ERR[msg.code] + (msg.need ? `（${msg.need}人から）` : '') : 'エラー: ' + msg.code)
    } else if (msg.t === 'closed') {
      state = null; toast(ERR.closed); history.replaceState(null, '', '/'); show('home')
    } else if (msg.t === 'pong') {
      $('#ping').textContent = Math.round(performance.now() - msg.at) + 'ms'
    }
  }
})

function show(name) {
  for (const s of screens) $('#' + s).hidden = s !== name
  document.body.dataset.screen = name
}

function toast(text) {
  const t = $('#toast')
  t.textContent = text; t.hidden = false
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3500)
}

function render() {
  if (!state) return show('home')
  const isHost = state.hostId === state.you
  if (state.phase === 'lobby') {
    show('lobby')
    $('#roomCode').textContent = state.code
    $('#invite').value = `${location.origin}/r/${state.code}`
    $('#count').textContent = `${state.players.length} / ${state.max}人`
    $('#players').replaceChildren(...state.players.map(p => {
      const li = document.createElement('li')
      li.textContent = p.name
      if (p.id === state.hostId) li.append(badge('ホスト'))
      if (p.id === state.you) li.append(badge('あなた'))
      if (!p.connected) { li.append(badge('切断中')); li.classList.add('off') }
      return li
    }))
    const short = state.min - state.players.filter(p => p.connected).length
    $('#startBtn').hidden = !isHost
    $('#startBtn').disabled = short > 0
    renderSetup(isHost)
    $('#lobbyHint').textContent = short > 0 ? `あと${short}人でスタートできます。招待URLを送ってください` : isHost ? 'そろったらスタート' : 'ホストがスタートするのを待っています'
  } else if (state.phase === 'playing') {
    show('game')
    view.render(state, { send: data => net.send({ t: 'input', data }) })
  } else if (state.phase === 'result') {
    show('result')
    const r = state.result || {}
    $('#resultTitle').textContent = r.title || '結果'
    $('#resultTitle').dataset.win = r.win ? '1' : '0'
    $('#resultBody').replaceChildren(view.renderResult ? view.renderResult(state) : document.createTextNode(''))
    $('#rematchBtn').hidden = !isHost
    $('#lobbyBtn').hidden = !isHost
    $('#resultHint').textContent = isHost ? '' : 'ホストが次を選ぶのを待っています'
  }
}

function renderSetup(isHost) {
  // ホストは自分の選択、ほかの人はホストが選んだもの（サーバー経由で届く）を見る
  const sh = state.setup || {}
  const cur = isHost ? pick : { course: COURSE_IDS.includes(sh.course) ? sh.course : DEFAULT_COURSE, cargo: CARGO_IDS.includes(sh.cargo) ? sh.cargo : DEFAULT_CARGO }
  if (isHost && (sh.course !== pick.course || sh.cargo !== pick.cargo)) net.send({ t: 'setup', opts: { ...pick } })
  const best = view.loadBest()
  const rec = best[`${cur.course}:${cur.cargo}`]
  picker($('#coursePick'), {
    ids: COURSE_IDS, id: cur.course, kind: 'コース', isHost, thumb: courseThumb(cur.course),
    title: COURSES[cur.course].name, lead: COURSES[cur.course].lead,
    note: rec ? `自己ベスト ${rec.time}秒${rec.medal ? `・${MEDAL_NAME[rec.medal]}` : ''}` : 'まだ記録なし', medal: rec && rec.medal,
    onPick: id => { pick.course = id; try { localStorage.setItem('ct-course', id) } catch {}; render() }
  })
  picker($('#cargoPick'), {
    ids: CARGO_IDS, id: cur.cargo, kind: '荷物', isHost, thumb: CARGO_THUMB[cur.cargo],
    title: CARGOS[cur.cargo].name, lead: CARGOS[cur.cargo].lead, note: isHost ? '' : 'ホストが選ぶ',
    onPick: id => { pick.cargo = id; try { localStorage.setItem('ct-cargo', id) } catch {}; render() }
  })
}

// 左右の矢印で1つずつ切り替える選択欄（絵入りのカード。狭い画面でも2段で収まる）
function picker(el, { ids, id, kind, isHost, title, lead, note, medal, thumb, onPick }) {
  const i = ids.indexOf(id)
  el.dataset.host = isHost ? '1' : '0'
  el.innerHTML = `
    <button type="button" class="pk-btn" data-d="-1" aria-label="前の${kind}">${CHEV(-1)}</button>
    <div class="pk-body" data-id="${id}"><div class="pk-thumb">${thumb}</div><div class="pk-text"><small>${kind} ${i + 1}/${ids.length}</small><b></b><span class="pk-lead"></span><span class="pk-note"></span></div></div>
    <button type="button" class="pk-btn" data-d="1" aria-label="次の${kind}">${CHEV(1)}</button>`
  el.querySelector('b').textContent = title
  el.querySelector('.pk-lead').textContent = lead
  const nt = el.querySelector('.pk-note')
  if (note) { if (medal) { const m = document.createElement('i'); m.className = 'md'; m.style.background = MEDAL_COLOR[medal]; nt.append(m) } nt.append(note) }
  for (const b of el.querySelectorAll('.pk-btn')) {
    b.hidden = !isHost
    b.onclick = () => onPick(ids[(i + Number(b.dataset.d) + ids.length) % ids.length])
  }
}

const MEDAL_COLOR = { gold: '#f5c542', silver: '#cfd6de', bronze: '#d08a4e' }
const THEME_FLOOR = { wood: '#d9b27c', street: '#c9c4ba', snow: '#f4f8fc', factory: '#a3a8ae', apartment: '#e6dbc6' }
// コースの小さな地図（データから描く）
const thumbCache = {}
function courseThumb(id) {
  if (thumbCache[id]) return thumbCache[id]
  const c = COURSES[id]
  const [W, H] = c.size
  const r = (q, fill) => `<rect x="${q[0]}" y="${q[1]}" width="${q[2]}" height="${q[3]}" fill="${fill}"/>`
  let out = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="${W}" height="${H}" fill="${THEME_FLOOR[c.theme] || '#d9b27c'}"/>`
  for (const d of c.deco || []) if (d[0] === 'road') out += r(d.slice(1), '#3b3e44')
  for (const z of c.zones || []) out += r(z.r, z.type === 'ice' ? '#9fd6f0' : z.type === 'stairs' ? '#bfae90' : z.look === 'slope' ? 'rgba(90,120,160,.25)' : '#2b2f35')
  for (const q of c.pits) out += r(q, c.theme === 'snow' ? '#2e78b0' : '#1b1511')
  for (const q of c.walls) out += r(q, '#2a2119')
  out += r(c.goal, '#1f9a5c')
  out += `<polyline points="${c.path.map(p => p[0] + ',' + p[1]).join(' ')}" fill="none" stroke="#d3312c" stroke-width="${W / 28}" stroke-dasharray="${W / 18} ${W / 24}" stroke-linecap="round"/>`
  out += '</svg>'
  return (thumbCache[id] = out)
}
const CARGO_THUMB = {
  crate: '<svg viewBox="0 0 52 60" aria-hidden="true"><rect x="6" y="12" width="40" height="36" fill="#c8935a" stroke="#2a2119" stroke-width="3"/><path d="M6 24h40M6 36h40" stroke="#8a5a2e" stroke-width="2"/><path d="M9 15l34 30" stroke="#8a5a2e" stroke-width="4"/><rect x="4" y="10" width="9" height="9" fill="#3a3f47"/><rect x="39" y="10" width="9" height="9" fill="#3a3f47"/><rect x="4" y="41" width="9" height="9" fill="#3a3f47"/><rect x="39" y="41" width="9" height="9" fill="#3a3f47"/></svg>',
  mattress: '<svg viewBox="0 0 52 60" aria-hidden="true"><rect x="6" y="12" width="40" height="36" rx="6" fill="#e9e4f5" stroke="#2a2119" stroke-width="3"/><path d="M14 14v32M22 14v32M30 14v32M38 14v32" stroke="#9b8fc4" stroke-width="2"/></svg>',
  sofa: '<svg viewBox="0 0 52 60" aria-hidden="true"><rect x="5" y="22" width="42" height="22" rx="4" fill="#c8553d" stroke="#2a2119" stroke-width="3"/><rect x="9" y="14" width="34" height="12" rx="3" fill="#a5402d" stroke="#2a2119" stroke-width="3"/><path d="M8 44v6M44 44v6" stroke="#2a2119" stroke-width="3"/></svg>',
  tank: '<svg viewBox="0 0 52 60" aria-hidden="true"><rect x="6" y="14" width="40" height="32" rx="3" fill="#9fd6ea" stroke="#2a2119" stroke-width="3"/><path d="M8 24h36" stroke="#4aa3c7" stroke-width="2"/><ellipse cx="24" cy="32" rx="7" ry="4" fill="#ff9a4d"/><path d="M30 32l6-4v8z" fill="#ff9a4d"/><path d="M12 44v-8M15 44v-5" stroke="#3f9a4a" stroke-width="2"/></svg>',
  piano: '<svg viewBox="0 0 52 60" aria-hidden="true"><rect x="6" y="10" width="40" height="34" rx="3" fill="#22252b" stroke="#2a2119" stroke-width="3"/><rect x="9" y="30" width="34" height="9" fill="#f4f1ea"/><path d="M14 30v5M19 30v5M27 30v5M32 30v5M37 30v5" stroke="#111" stroke-width="2.4"/><path d="M10 44v8M42 44v8" stroke="#c9a24a" stroke-width="3"/></svg>'
}

function badge(text) { const b = document.createElement('span'); b.className = 'badge'; b.textContent = text; return b }

// ---- ボタン
const nameInput = $('#name')
try { nameInput.value = localStorage.getItem(NAME_KEY) || '' } catch {}
const name = () => { const n = nameInput.value.trim(); try { localStorage.setItem(NAME_KEY, n) } catch {}; return n }

$('#createBtn').onclick = () => { leftCode = null; if (!name()) return toast(ERR.bad_name); net.send({ t: 'create', name: name() }) }
$('#joinBtn').onclick = () => {
  leftCode = null
  const code = $('#code').value.trim().toUpperCase()
  if (!name()) return toast(ERR.bad_name)
  if (!/^[A-Z0-9]{4}$/.test(code)) return toast('参加コードは4文字です')
  net.send({ t: 'join', code, name: name() })
}
$('#copyBtn').onclick = async () => {
  const url = $('#invite').value
  try {
    if (navigator.share && matchMedia('(pointer:coarse)').matches) await navigator.share({ title: document.title, url })
    else { await navigator.clipboard.writeText(url); toast('招待URLをコピーしました') }
  } catch { $('#invite').select(); toast('URLを長押ししてコピーしてください') }
}
$('#startBtn').onclick = () => net.send({ t: 'start', opts: { ...pick } })
function leaveRoom() { leftCode = state && state.code; net.send({ t: 'leave' }); state = null; history.replaceState(null, '', '/'); show('home') }
$('#leaveBtn').onclick = leaveRoom
$('#rematchBtn').onclick = () => net.send({ t: 'rematch', opts: { ...pick } })
$('#lobbyBtn').onclick = () => net.send({ t: 'lobby' })
// 抜けるボタンは2回押しで確定（ブラウザの確認ダイアログは使わない）
$('#quitBtn').onclick = () => {
  const b = $('#quitBtn')
  if (b.dataset.armed !== '1') { const icon = b.innerHTML; b.dataset.armed = '1'; b.textContent = 'もう一度で退出'; setTimeout(() => { b.dataset.armed = ''; b.innerHTML = icon }, 2500); return }
  leaveRoom()
}

// 遊び方
$('#howBtn').onclick = () => { $('#howto').hidden = false; $('#howClose').focus() }
$('#howClose').onclick = () => { $('#howto').hidden = true }
$('#howto').onclick = e => { if (e.target.id === 'howto') $('#howto').hidden = true }
addEventListener('keydown', e => { if (e.key === 'Escape') $('#howto').hidden = true })

window.__boot = true
{ const d = document.getElementById('bootErr'); if (d) d.hidden = true } // 遅れて起動できたときは誤報を消す
show('home')
