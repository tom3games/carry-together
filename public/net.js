// サーバーとの通信。切れたら自動でつなぎ直し、前の席に戻る（id と token を sessionStorage に持つ）。
const KEY = 'pg-session'

export function connect({ onMessage, onStatus }) {
  let ws = null
  let retry = 0
  let closedByUs = false
  const queue = []

  const saved = () => { try { return JSON.parse(sessionStorage.getItem(KEY) || 'null') } catch { return null } }
  const save = v => { try { sessionStorage.setItem(KEY, JSON.stringify(v)) } catch {} }

  function open() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    ws = new WebSocket(`${proto}://${location.host}/ws`)
    onStatus('connecting')
    ws.onopen = () => {
      retry = 0
      const s = saved()
      ws.send(JSON.stringify({ t: 'hello', id: s?.id, token: s?.token }))
      onStatus('online')
      while (queue.length) ws.send(queue.shift())
    }
    ws.onmessage = e => {
      let msg
      try { msg = JSON.parse(e.data) } catch { return }
      if (msg.t === 'session') save({ id: msg.id, token: msg.token })
      onMessage(msg)
    }
    ws.onclose = () => {
      if (closedByUs) return
      onStatus('offline')
      const wait = Math.min(8000, 500 * 2 ** retry++)
      setTimeout(open, wait)
    }
    ws.onerror = () => {}
  }
  open()

  // 回線の遅れを測る
  setInterval(() => send({ t: 'ping', at: performance.now() }), 5000)

  function send(msg) {
    const s = JSON.stringify(msg)
    if (ws && ws.readyState === 1) ws.send(s)
    else if (msg.t !== 'ping' && msg.t !== 'input') queue.push(s)
  }
  return { send, close() { closedByUs = true; ws?.close() } }
}
