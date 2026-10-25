// コースと荷物のデータ。サーバー（lib/game.mjs）と画面（game-view.js）の両方がこのファイルを読む。
// 座標は「ワールド単位」。x は右、y は下が正。角度はラジアンで、荷物の「前」はローカルの +x。
//
// コースを足すときは COURSES に1つ足すだけでよい。持つもの:
//   name, lead          画面に出す名前と一言
//   size: [W, H]        ワールドの大きさ
//   timeLimit           秒
//   start: { x, y, a }  荷物の初期位置と向き
//   walls: [[x,y,w,h]]  ぶつかる壁（軸にそろった四角）
//   pits:  [[x,y,w,h]]  穴。荷物の真ん中（重心の印）が入ると落ちて失敗
//   goal:  [x,y,w,h]    荷物の真ん中が入ればクリア
// 後で足す予定のもの（まだ実装していない。足すときは game.mjs の step() に処理を1つ足す）:
//   movers  動く障害物（時間 t から四角を返す）／ stairs 階段（通る間だけ速度が落ちる帯）
//   荷物側: tiltLimit（傾けると失敗）／ blind（前が見えにくい＝画面を暗くする）

export const COURSES = {
  warehouse: {
    name: '倉庫から新居まで',
    lead: '狭いドア、穴、ジグザグ、柱の林、最後に細い通路',
    size: [900, 2300],
    timeLimit: 120,
    start: { x: 450, y: 2090, a: 0 },
    walls: [
      // 外周
      [0, 0, 900, 40], [0, 2260, 900, 40], [0, 0, 40, 2300], [860, 0, 40, 2300],
      // B: ドア（幅140。ソファは横向きのままでは通らない）
      [40, 1800, 340, 70], [520, 1800, 340, 70],
      // D: ジグザグ
      [40, 1150, 560, 60], [300, 880, 560, 60],
      // E: 柱
      [520, 700, 80, 80], [180, 560, 80, 80], [600, 520, 80, 80],
      // F: 細い通路（幅120）
      [40, 250, 340, 180], [500, 250, 360, 180]
    ],
    pits: [
      [300, 1400, 300, 260],
      [40, 1440, 90, 140]
    ],
    goal: [300, 70, 300, 150]
  }
}

// 荷物。mass が大きいほど遅く、fragile が大きいほどぶつけたときに傷む。
export const CARGOS = {
  sofa: { name: 'ソファ', lead: '長い。ドアと通路では縦にしないと通らない', w: 150, h: 56, mass: 1, fragile: 1, hp: 100, color: '#c8553d' },
  tank: { name: '水槽', lead: '短いが重くて割れやすい。ぶつけると大きく傷む', w: 110, h: 72, mass: 1.45, fragile: 2.2, hp: 100, color: '#4aa3c7' }
}

export const DEFAULT_COURSE = 'warehouse'
export const DEFAULT_CARGO = 'sofa'

// 持ち手の位置（荷物のローカル座標）。人数 n に合わせて外周に等間隔で並べる。
// 前の辺の真ん中から反時計回り（画面上では前→左→後→右）。2人なら前と後ろ、4人なら前後左右。
export function handleOffsets(cargo, n) {
  const hw = cargo.w / 2, hh = cargo.h / 2
  const P = 2 * (cargo.w + cargo.h)
  // 外周を前の辺の真ん中 (hw,0) から y を負の向き（左手側）へ進む
  const segs = [
    [hw, 0, hw, -hh], [hw, -hh, -hw, -hh], [-hw, -hh, -hw, hh], [-hw, hh, hw, hh], [hw, hh, hw, 0]
  ]
  const out = []
  for (let i = 0; i < n; i++) {
    let s = (i * P) / n
    for (const [x1, y1, x2, y2] of segs) {
      const len = Math.hypot(x2 - x1, y2 - y1)
      if (s <= len + 1e-9) { const k = len ? s / len : 0; out.push([x1 + (x2 - x1) * k, y1 + (y2 - y1) * k]); break }
      s -= len
    }
  }
  return out
}

// 持ち手の呼び名（ローカルの位置から）。前=+x、右=+y（前を向いたときの右手）
export function handleLabel(cargo, [lx, ly]) {
  const fx = lx / (cargo.w / 2), fy = ly / (cargo.h / 2)
  const front = fx > 0.5 ? '前' : fx < -0.5 ? '後ろ' : ''
  const side = fy > 0.5 ? '右' : fy < -0.5 ? '左' : ''
  if (front && side) return front + side
  return front || side || '真ん中'
}

export const PLAYER_COLORS = ['#ffcf3a', '#5ad1ff', '#ff7aa8', '#8be36b', '#c69bff', '#ff9a4d', '#4de0c0', '#f0f0f0']
