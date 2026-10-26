// ルーム・プレイヤー・ゲーム進行の管理。通信（WebSocket）とは切り離してあり、テストから直接呼べる。
// ゲームのルールは createGame に渡されたモジュールが持つ（lib/game.mjs）。

import { randomBytes, randomInt } from 'node:crypto'

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // 読み間違えやすい I O 0 1 は使わない
export const LIMITS = {
  nameMax: 12,
  reconnectGraceMs: 60_000,   // 切断してから席を残しておく時間
  hostGraceMs: 10_000,        // ホストが切れてから次の人にホストを渡すまで
  emptyRoomMs: 60_000,        // 誰もいなくなったルームを消すまで
  idleRoomMs: 2 * 60 * 60_000 // 何も起きないルームを消すまで
}

export function makeCode(len = 4) {
  let s = ''
  for (let i = 0; i < len; i++) s += CODE_CHARS[randomInt(CODE_CHARS.length)]
  return s
}

export function cleanName(name) {
  if (typeof name !== 'string') return null
  const n = name.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, LIMITS.nameMax)
  return n.length ? n : null
}

export class RoomManager {
  // gameDef: { meta: { minPlayers, maxPlayers, tickHz }, createGame(players, opts) }
  // send(sessionId, msg) は外から差し込む（テストではモック）
  constructor(gameDef, { send = () => {}, now = () => Date.now() } = {}) {
    this.def = gameDef
    this.send = send
    this.now = now
    this.rooms = new Map()     // code -> room
    this.sessions = new Map()  // sessionId -> { token, code }
  }

  // ---- セッション（なりすまし防止：秘密の token を持つ人だけがその席に戻れる）
  newSession() {
    const id = randomBytes(8).toString('hex')
    const token = randomBytes(16).toString('hex')
    this.sessions.set(id, { token, code: null })
    return { id, token }
  }

  resume(id, token) {
    const s = this.sessions.get(id)
    if (!s || s.token !== token) return null
    return s
  }

  // ---- ルーム
  create(sessionId, rawName) {
    const name = cleanName(rawName)
    if (!name) return { error: 'bad_name' }
    this.leave(sessionId)
    let code
    do { code = makeCode() } while (this.rooms.has(code))
    const room = {
      code, hostId: sessionId, phase: 'lobby', players: [], game: null,
      result: null, lastActive: this.now(), emptySince: null, round: 0
    }
    this.rooms.set(code, room)
    this._addPlayer(room, sessionId, name)
    return { code }
  }

  join(sessionId, rawCode, rawName) {
    const code = String(rawCode || '').toUpperCase().trim()
    const room = this.rooms.get(code)
    if (!room) return { error: 'not_found' }
    const existing = room.players.find(p => p.id === sessionId)
    if (existing) { existing.connected = true; existing.leftAt = null; this.broadcast(room); return { code } }
    const name = cleanName(rawName)
    if (!name) return { error: 'bad_name' }
    if (room.phase !== 'lobby') return { error: 'started' }
    if (room.players.length >= this.def.meta.maxPlayers) return { error: 'full' }
    this.leave(sessionId)
    this._addPlayer(room, sessionId, name)
    return { code }
  }

  _addPlayer(room, id, name) {
    let n = name, k = 2
    while (room.players.some(p => p.name === n)) n = `${name}${k++}`
    room.players.push({ id, name: n, connected: true, leftAt: null })
    room.lastActive = this.now()
    room.emptySince = null
    this.sessions.get(id).code = room.code
    this.broadcast(room)
  }

  leave(sessionId) {
    const s = this.sessions.get(sessionId)
    if (!s || !s.code) return
    const room = this.rooms.get(s.code)
    s.code = null
    if (!room) return
    room.players = room.players.filter(p => p.id !== sessionId)
    if (room.game && room.game.removePlayer) room.game.removePlayer(sessionId)
    if (room.hostId === sessionId) room.hostId = room.players[0]?.id ?? null
    if (!room.players.length) room.emptySince = this.now()
    this.broadcast(room)
  }

  disconnect(sessionId) {
    const s = this.sessions.get(sessionId)
    const room = s?.code && this.rooms.get(s.code)
    if (!room) return
    const p = room.players.find(p => p.id === sessionId)
    if (!p) return
    p.connected = false
    p.leftAt = this.now()
    this.broadcast(room)
  }

  reconnect(sessionId) {
    const s = this.sessions.get(sessionId)
    const room = s?.code && this.rooms.get(s.code)
    if (!room) return null
    const p = room.players.find(p => p.id === sessionId)
    if (!p) return null
    p.connected = true
    p.leftAt = null
    this.broadcast(room)
    return room.code
  }

  start(sessionId, opts = {}) {
    const room = this._roomOf(sessionId)
    if (!room) return { error: 'no_room' }
    if (room.hostId !== sessionId) return { error: 'not_host' }
    if (room.phase === 'playing') return { error: 'started' }
    const active = room.players.filter(p => p.connected)
    if (active.length < this.def.meta.minPlayers) return { error: 'not_enough', need: this.def.meta.minPlayers }
    room.round++
    room.game = this.def.createGame(active.map(p => ({ id: p.id, name: p.name })), { ...opts, round: room.round })
    room.phase = 'playing'
    room.result = null
    room.lastActive = this.now()
    this.broadcast(room)
    return { ok: true }
  }

  input(sessionId, msg) {
    const room = this._roomOf(sessionId)
    if (!room || room.phase !== 'playing' || !room.game) return { error: 'not_playing' }
    if (!room.players.some(p => p.id === sessionId)) return { error: 'not_in_room' }
    room.lastActive = this.now()
    const r = room.game.input(sessionId, msg) // ゲーム側で検証する。不正な入力は無視して { error } を返す
    if (room.game.isOver()) this._finish(room)
    return r || { ok: true }
  }

  // ホストがロビーで選んだ設定（コースや荷物）を全員に見せる。中身は短い文字列だけ受け取る（ゲーム側でも検証する）
  setup(sessionId, opts) {
    const room = this._roomOf(sessionId)
    if (!room) return { error: 'no_room' }
    if (room.hostId !== sessionId) return { error: 'not_host' }
    const clean = {}
    if (opts && typeof opts === 'object') {
      for (const [k, v] of Object.entries(opts).slice(0, 4)) {
        if (/^[a-z]{1,12}$/.test(k) && typeof v === 'string' && /^[a-z_]{1,24}$/.test(v)) clean[k] = v
      }
    }
    room.setup = clean
    this.broadcast(room)
    return { ok: true }
  }

  // ホストが結果画面から呼ぶ。同じメンバーでロビーに戻る（そのまま start で再戦）
  backToLobby(sessionId) {
    const room = this._roomOf(sessionId)
    if (!room) return { error: 'no_room' }
    if (room.hostId !== sessionId) return { error: 'not_host' }
    if (room.phase === 'playing') return { error: 'started' }
    room.phase = 'lobby'
    room.game = null
    this.broadcast(room)
    return { ok: true }
  }

  rematch(sessionId, opts) {
    const room = this._roomOf(sessionId)
    if (!room) return { error: 'no_room' }
    if (room.phase !== 'result') return { error: 'not_finished' }
    if (room.hostId !== sessionId) return { error: 'not_host' }
    room.phase = 'lobby'
    return this.start(sessionId, opts)
  }

  _finish(room) {
    room.phase = 'result'
    room.result = room.game.result()
    this.broadcast(room)
  }

  // ---- 時間を進める（サーバーのループから呼ぶ）
  tick(dtMs) {
    const now = this.now()
    for (const room of [...this.rooms.values()]) {
      // 切断が長い人を外す
      for (const p of [...room.players]) {
        if (!p.connected && p.leftAt != null && now - p.leftAt > LIMITS.reconnectGraceMs) this.leave(p.id)
      }
      // ホストが切れたままなら次の人に渡す（ゲームが止まらないように）
      const host = room.players.find(p => p.id === room.hostId)
      if (host && !host.connected && host.leftAt != null && now - host.leftAt > LIMITS.hostGraceMs) {
        const next = room.players.find(p => p.connected)
        if (next) { room.hostId = next.id; this.broadcast(room) }
      }
      if (!room.players.length && room.emptySince != null && now - room.emptySince > LIMITS.emptyRoomMs) { this.rooms.delete(room.code); continue }
      if (now - room.lastActive > LIMITS.idleRoomMs) { this._closeRoom(room); continue }
      if (room.phase === 'playing' && room.game) {
        room.game.tick(dtMs / 1000)
        if (room.game.isOver()) this._finish(room)
        else this.broadcast(room)
      }
    }
  }

  _closeRoom(room) {
    for (const p of room.players) {
      this.send(p.id, { t: 'closed', reason: 'idle' })
      const s = this.sessions.get(p.id); if (s) s.code = null
    }
    this.rooms.delete(room.code)
  }

  _roomOf(sessionId) {
    const s = this.sessions.get(sessionId)
    return s?.code ? this.rooms.get(s.code) : null
  }

  // 各プレイヤーに、その人が見てよい状態だけを送る（秘密の役割を漏らさない）
  broadcast(room) {
    for (const p of room.players) this.send(p.id, this.stateFor(room, p.id))
  }

  stateFor(room, viewerId) {
    return {
      t: 'state',
      code: room.code,
      phase: room.phase,
      round: room.round,
      you: viewerId,
      hostId: room.hostId,
      min: this.def.meta.minPlayers,
      max: this.def.meta.maxPlayers,
      players: room.players.map(p => ({ id: p.id, name: p.name, connected: p.connected })),
      setup: room.setup || null,
      game: room.game ? room.game.view(viewerId) : null,
      result: room.phase === 'result' ? room.result : null
    }
  }
}
