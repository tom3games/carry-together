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

let me = null, state = null, gameMeta = null
const NAME_KEY = 'pg-name'
// ホストが選ぶ荷物とコース（スタートと再戦のときにサーバーへ送る。サーバー側でも検証する）
const pick = { course: DEFAULT_COURSE, cargo: DEFAULT_CARGO }
try { const c = localStorage.getItem('ct-cargo'); if (CARGOS[c]) pick.cargo = c } catch {}

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
      state = msg
      render()
    } else if (msg.t === 'joined') {
      history.replaceState(null, '', '/r/' + msg.code)
    } else if (msg.t === 'error') {
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
  $('#courseName').textContent = COURSES[pick.course].name
  const box = $('#cargoChoice')
  box.hidden = !isHost
  if (!isHost) { $('#courseName').textContent += '（荷物はホストが選ぶ）'; return }
  box.replaceChildren(...Object.entries(CARGOS).map(([id, c]) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'opt'
    b.setAttribute('role', 'radio')
    b.setAttribute('aria-checked', pick.cargo === id ? 'true' : 'false')
    b.dataset.id = id
    b.innerHTML = `<b>${c.name}</b><small>${c.lead}</small>`
    b.onclick = () => { pick.cargo = id; try { localStorage.setItem('ct-cargo', id) } catch {}; renderSetup(true) }
    return b
  }))
}

function badge(text) { const b = document.createElement('span'); b.className = 'badge'; b.textContent = text; return b }

// ---- ボタン
const nameInput = $('#name')
try { nameInput.value = localStorage.getItem(NAME_KEY) || '' } catch {}
const name = () => { const n = nameInput.value.trim(); try { localStorage.setItem(NAME_KEY, n) } catch {}; return n }

$('#createBtn').onclick = () => { if (!name()) return toast(ERR.bad_name); net.send({ t: 'create', name: name() }) }
$('#joinBtn').onclick = () => {
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
$('#leaveBtn').onclick = () => { net.send({ t: 'leave' }); state = null; history.replaceState(null, '', '/'); show('home') }
$('#rematchBtn').onclick = () => net.send({ t: 'rematch', opts: { ...pick } })
$('#lobbyBtn').onclick = () => net.send({ t: 'lobby' })
// 抜けるボタンは2回押しで確定（ブラウザの確認ダイアログは使わない）
$('#quitBtn').onclick = () => {
  const b = $('#quitBtn')
  if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'もう一度で退出'; setTimeout(() => { b.dataset.armed = ''; b.textContent = '退出' }, 2500); return }
  net.send({ t: 'leave' }); state = null; history.replaceState(null, '', '/'); show('home')
}

window.__boot = true
show('home')
