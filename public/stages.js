// コースと荷物のデータ。サーバー（lib/game.mjs）と画面（game-view.js）の両方がこのファイルを読む。
// 座標は「ワールド単位」。x は右、y は下が正。角度はラジアンで、荷物の「前」はローカルの +x。
//
// コースを足すときは COURSES に1つ足すだけでよい。持つもの:
//   name, lead, theme   画面に出す名前と一言、床の描き方（wood / street / snow / factory / apartment）
//   goalLabel           ゴールに書く行き先
//   size: [W, H]        ワールドの大きさ
//   timeLimit           秒
//   start: { x, y, a }  荷物の初期位置と向き
//   path: [[x,y,a]]     通り道（荷物の真ん中と向き）。進み具合の計算と自動操縦（テスト用）が使う。最後はゴールの中
//   walls: [[x,y,w,h]]  ぶつかる壁（軸にそろった四角）
//   pits:  [[x,y,w,h]]  穴。荷物の真ん中（重心の印）が入ると落ちて失敗
//   goal:  [x,y,w,h]    荷物の真ん中が入ればクリア
//   zones: [{ type, r:[x,y,w,h], vx, vy }]  床の仕掛け。荷物の真ん中がある所の効果がかかる
//          ice=よく滑る ／ stairs=階段（重くて遅い）／ belt=ベルトコンベアや坂（vx,vy の向きへ流される）
//   deco:  [[type, x,y,w,h]]  見た目だけ（road=車道 など）
//   movers: 動く障害物。当たると跳ね飛ばされて傷む（hurt × 荷物の割れやすさ）。位置は時刻だけで決まる（moverAt）
//          loop:  [x0, x1] を speed で x0→x1 へ進み、端まで行くと x0 から出直す（車・自転車）
//          swing: a と b の間を period 秒で往復する（ピストン・除雪車・住人）
//   medals: { gold, silver }  ソファで到着した秒数がこれ以下でメダル（gold は耐久 60 以上も要る）。到着すれば銅。
//                            荷物ごとに par 倍する（重い荷物ほど遅くてよい）。ただし制限時間の 0.85 / 0.95 倍まで

const UP = -Math.PI / 2

export const COURSES = {
  warehouse: {
    goalLabel: '新居',
    name: '倉庫から新居まで',
    lead: '狭いドア、穴、ジグザグ、柱の林、最後に細い通路',
    theme: 'wood',
    size: [900, 2300],
    timeLimit: 120,
    start: { x: 450, y: 2090, a: 0 },
    path: [
      [450, 2090, 0], [450, 2000, UP], [450, 1760, UP], [450, 1700, UP], [730, 1700, UP], [730, 1250, UP],
      [730, 1060, UP], [170, 1045, UP], [170, 800, UP], [330, 700, UP], [420, 600, UP], [440, 500, UP],
      [440, 330, UP], [450, 150, UP]
    ],
    walls: [
      [0, 0, 900, 40], [0, 2260, 900, 40], [0, 0, 40, 2300], [860, 0, 40, 2300],
      // ドア（幅140。ソファは横向きのままでは通らない）
      [40, 1800, 340, 70], [520, 1800, 340, 70],
      // ジグザグ
      [40, 1150, 560, 60], [300, 880, 560, 60],
      // 柱
      [520, 700, 80, 80], [180, 560, 80, 80], [600, 520, 80, 80],
      // 細い通路（幅120）
      [40, 250, 340, 180], [500, 250, 360, 180]
    ],
    pits: [[300, 1400, 300, 260], [40, 1440, 90, 140]],
    goal: [300, 70, 300, 150],
    medals: { gold: 40, silver: 60 }
  },

  crosswalk: {
    goalLabel: 'お店',
    name: '商店街の横断歩道',
    lead: '車道を2本わたる。車にひかれると吹っ飛ぶ。中央の島で待つのも作戦',
    theme: 'street',
    size: [1000, 2800],
    timeLimit: 150,
    start: { x: 500, y: 2620, a: UP },
    path: [
      [500, 2620, UP], [590, 2480, UP], [590, 2310, UP], [590, 2035, UP], [590, 1720, UP], [850, 1700, UP],
      [850, 1430, UP], [300, 1430, UP], [300, 1240, UP], [300, 935, UP], [300, 620, UP], [500, 560, UP],
      [500, 380, UP], [500, 170, UP]
    ],
    walls: [
      [0, 0, 1000, 40], [0, 2760, 1000, 40], [0, 0, 40, 2800], [960, 0, 40, 2800],
      // 歩道の車止め（すき間 140）
      [300, 2380, 40, 40], [480, 2380, 40, 40], [660, 2380, 40, 40],
      // 商店街の立て看板
      [40, 1600, 420, 40], [520, 1290, 440, 40],
      // お店の入口（幅160）
      [40, 420, 380, 60], [580, 420, 380, 60]
    ],
    pits: [[560, 1470, 180, 110]],
    goal: [330, 80, 340, 180],
    deco: [['road', 40, 1800, 920, 470], ['island', 40, 1940, 920, 190], ['zebra', 500, 1800, 180, 470], ['road', 40, 700, 920, 470], ['island', 40, 840, 920, 190], ['zebra', 210, 700, 180, 470], ['shop', 40, 40, 920, 380]],
    movers: [
      { kind: 'car', loop: [-300, 1300], y: 2200, w: 150, h: 80, speed: 150, phase: 0, hurt: 18, color: '#2f6fd6' },
      { kind: 'car', loop: [1300, -300], y: 1870, w: 150, h: 80, speed: 175, phase: 0.45, hurt: 18, color: '#e8e8e8' },
      { kind: 'car', loop: [1300, -300], y: 1100, w: 150, h: 80, speed: 210, phase: 0.2, hurt: 18, color: '#d64545' },
      { kind: 'car', loop: [-300, 1300], y: 770, w: 150, h: 80, speed: 160, phase: 0.1, hurt: 18, color: '#f2c230' },
      { kind: 'bike', loop: [-300, 1300], y: 770, w: 70, h: 34, speed: 160, phase: 0.6, hurt: 10, color: '#3ddc97' }
    ],
    medals: { gold: 75, silver: 110 }
  },

  snow: {
    goalLabel: '山小屋',
    name: '雪の坂道と橋',
    lead: '氷の上はよく滑る。坂は押し戻される。手すりの無い橋',
    theme: 'snow',
    size: [1000, 2400],
    timeLimit: 150,
    start: { x: 500, y: 2230, a: UP },
    path: [
      [500, 2230, UP], [485, 2060, UP], [485, 1760, UP], [760, 1660, UP], [760, 1440, UP], [240, 1440, UP],
      [240, 1200, UP], [500, 1140, UP], [500, 800, UP], [500, 700, UP], [400, 560, UP], [420, 420, UP],
      [500, 320, UP], [500, 160, UP]
    ],
    walls: [
      [0, 0, 1000, 40], [0, 2360, 1000, 40], [0, 0, 40, 2400], [960, 0, 40, 2400],
      // 雪の壁（ジグザグ）
      [40, 1540, 520, 50], [440, 1280, 520, 50],
      // 雪だるま
      [180, 620, 70, 70], [740, 620, 70, 70], [600, 400, 70, 70],
      // 山小屋の入口（幅160）
      [40, 260, 380, 40], [580, 260, 380, 40]
    ],
    pits: [
      // 氷の穴
      [150, 1850, 200, 140], [620, 1800, 200, 160],
      // 川（橋は x 370〜630）
      [40, 800, 330, 300], [630, 800, 330, 300]
    ],
    goal: [330, 70, 340, 170],
    zones: [
      { type: 'ice', r: [40, 1740, 920, 420] },
      { type: 'belt', r: [40, 1150, 920, 560], vx: 0, vy: 35, look: 'slope' },
      { type: 'ice', r: [370, 800, 260, 300] }
    ],
    deco: [['cabin', 40, 40, 920, 220]],
    movers: [
      { kind: 'plow', swing: { a: [120, 520], b: [880, 520], period: 9 }, w: 160, h: 60, phase: 0, hurt: 15, color: '#ff8a2a' }
    ],
    medals: { gold: 60, silver: 90 }
  },

  factory: {
    goalLabel: '出荷口',
    name: '工場のベルトコンベア',
    lead: '流れるベルト、飛び出すピストン、走るフォークリフト',
    theme: 'factory',
    size: [1000, 2400],
    timeLimit: 150,
    start: { x: 500, y: 2230, a: UP },
    path: [
      [500, 2230, UP], [500, 1960, UP], [500, 1780, UP], [650, 1760, UP], [650, 1510, UP], [350, 1510, UP],
      [350, 1240, UP], [500, 1150, UP], [500, 880, UP], [650, 720, UP], [650, 560, UP], [500, 330, UP], [500, 160, UP]
    ],
    walls: [
      [0, 0, 1000, 40], [0, 2360, 1000, 40], [0, 0, 40, 2400], [960, 0, 40, 2400],
      // 細い通路（x 250〜750）
      [40, 850, 210, 950], [750, 850, 210, 950],
      // 積んだ箱
      [120, 430, 140, 110], [740, 430, 140, 110],
      // 出荷口（幅160）
      [40, 260, 380, 40], [580, 260, 380, 40]
    ],
    pits: [[860, 1850, 100, 230]],
    goal: [330, 70, 340, 170],
    zones: [
      { type: 'belt', r: [40, 1850, 820, 230], vx: 60, vy: 0 },
      { type: 'belt', r: [250, 850, 500, 350], vx: 0, vy: 40 }
    ],
    deco: [['dock', 40, 40, 920, 220]],
    movers: [
      { kind: 'piston', swing: { a: [100, 1660], b: [400, 1660], period: 3.2 }, w: 300, h: 80, phase: 0, hurt: 12 },
      { kind: 'piston', swing: { a: [900, 1360], b: [600, 1360], period: 3.2 }, w: 300, h: 80, phase: 0.5, hurt: 12 },
      { kind: 'fork', swing: { a: [100, 640], b: [520, 640], period: 6 }, w: 120, h: 70, phase: 0.25, hurt: 15, color: '#f2c230' }
    ],
    medals: { gold: 60, silver: 90 }
  },

  stairs: {
    goalLabel: '3階の部屋',
    name: 'マンションの階段',
    lead: '階段は重い。吹き抜けの手すりは所々こわれている。住人に注意',
    theme: 'apartment',
    size: [1000, 2000],
    timeLimit: 170,
    start: { x: 290, y: 1840, a: UP },
    path: [
      [290, 1840, UP], [290, 1500, UP], [290, 760, UP], [290, 370, UP], [710, 370, UP], [710, 760, UP],
      [710, 1500, UP], [710, 1840, UP]
    ],
    walls: [
      [0, 0, 1000, 40], [0, 1960, 1000, 40], [0, 0, 40, 2000], [960, 0, 40, 2000],
      // 左右の部屋の壁（階段の幅 180）
      [40, 480, 160, 1480], [800, 480, 160, 1480],
      // 1階の真ん中（スタートと部屋を分ける）
      [380, 1680, 240, 280],
      // 吹き抜けの手すり（すき間がある）
      [380, 480, 20, 460], [380, 1200, 20, 480], [600, 480, 20, 560], [600, 1320, 20, 360],
      // 踊り場の鉢植え
      [60, 60, 80, 80], [860, 60, 80, 80]
    ],
    pits: [[400, 480, 200, 1200]],
    goal: [640, 1760, 140, 160],
    zones: [
      { type: 'stairs', r: [200, 660, 180, 860] },
      { type: 'stairs', r: [620, 660, 180, 860] }
    ],
    movers: [
      { kind: 'person', swing: { a: [150, 300], b: [850, 300], period: 9 }, w: 44, h: 44, phase: 0, hurt: 6, color: '#7a5cff' }
    ],
    medals: { gold: 80, silver: 120 }
  }
}

// 荷物。mass が大きいほど遅く、fragile が大きいほどぶつけたときに傷む。
export const CARGOS = {
  mattress: { name: 'マットレス', lead: '軽くて丈夫。でも一番長い', w: 160, h: 60, mass: 0.75, fragile: 0.45, hp: 100, par: 0.85, color: '#e9e4f5' },
  sofa: { name: 'ソファ', lead: '長い。ドアと通路では縦にする', w: 150, h: 56, mass: 1, fragile: 1, hp: 100, par: 1, color: '#c8553d' },
  tank: { name: '水槽', lead: '短いが重くて割れやすい', w: 110, h: 72, mass: 1.45, fragile: 2.2, hp: 100, par: 1.45, color: '#4aa3c7' },
  piano: { name: 'ピアノ', lead: 'とにかく重い。止まりにくい', w: 130, h: 84, mass: 1.9, fragile: 1.3, hp: 140, par: 2, color: '#22252b' }
}

export const DEFAULT_COURSE = 'warehouse'
export const DEFAULT_CARGO = 'sofa'

// かけ声スタンプ。番号で送る（文字は送らない）
export const EMOTES = ['せーの', '右回り', '左回り', '止まって', 'ゆっくり', 'ナイス']

// 動く障害物の、時刻 t（スタートからの秒）での中心と速度
export function moverAt(m, t) {
  if (m.loop) {
    const [x0, x1] = m.loop
    const L = Math.abs(x1 - x0), dir = Math.sign(x1 - x0)
    const s = ((((m.phase || 0) * L + m.speed * t) % L) + L) % L
    return { x: x0 + dir * s, y: m.y, vx: dir * m.speed, vy: 0 }
  }
  const { a, b, period } = m.swing
  const ph = 2 * Math.PI * (t / period + (m.phase || 0))
  const k = 0.5 - 0.5 * Math.cos(ph), dk = 0.5 * Math.sin(ph) * (2 * Math.PI / period)
  return { x: a[0] + (b[0] - a[0]) * k, y: a[1] + (b[1] - a[1]) * k, vx: (b[0] - a[0]) * dk, vy: (b[1] - a[1]) * dk }
}

// 通り道に沿って、点 (x,y) がどこまで進んだか（0〜1）
export function pathProgress(path, x, y) {
  let total = 0
  const lens = []
  for (let i = 1; i < path.length; i++) { const l = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]); lens.push(l); total += l }
  let best = Infinity, at = 0, acc = 0
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i]
    const l = lens[i - 1]
    const k = l ? Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / (l * l))) : 0
    const d = Math.hypot(ax + (bx - ax) * k - x, ay + (by - ay) * k - y)
    if (d < best) { best = d; at = acc + l * k }
    acc += l
  }
  return total ? at / total : 0
}

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
