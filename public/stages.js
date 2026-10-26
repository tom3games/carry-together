// コースと荷物のデータ。サーバー（lib/game.mjs）と画面（game-view.js / view3d.js）の両方がこのファイルを読む。
// 座標は「ワールド単位」（1単位=1cm）。x は右、y は下が正。角度はラジアンで、荷物の「前」はローカルの +x。
//
// コースは「区画（セグメント）」を下から上へ積んで作る。区画は幅1000、下の真ん中 (500, 下端) から入って上の真ん中 (500, 上端) へ抜ける。
// どのコースも 3つの区間（易しい → 仕掛けが重なる → 山場）で、区間の境目にチェックポイントの帯がある。
// 区間ごとに新しい仕掛けを1種類ずつ足していく（何で難しくなったか分かるように）。
//
// コースが持つもの（build() が区画から組み立てる）:
//   name, lead, goalLabel, theme   画面に出す名前と一言、ゴールの行き先、空と床の基本の見た目
//   regions: [{ y0, y1, theme }]   床と壁の見た目の切り替え（長いコースは途中で街並みが変わる）
//   size: [W, H] / timeLimit 秒 / start: { x, y, a }
//   path: [[x, y, a, opt]]         通り道。進み具合・案内の矢印・自動操縦（テスト用）が使う。opt.ride は動く床に乗る所
//   walls / pits / goal            ぶつかる壁・穴（真ん中が入ると落ちて、直前のチェックポイントからやり直し）・ゴール
//   checkpoints: [{ r, at, bonus }] 真ん中が r に入ると通過。落ちたら at からやり直す。通ると bonus 秒ふえる
//   zones: ice=滑る / stairs=重い / belt=流される（坂も） / wind=時間で強弱が変わる風（vx,vy の向き、period 秒で強くなって止む）
//   movers: 車・自転車・除雪車・ピストン・フォークリフト・住人・電車。当たると横へはじかれて傷む（moverAt）
//   spinners: 回るバー（中心 x,y・長さ len・太さ thick・回る速さ w ラジアン/秒）
//   gates: 開け閉めする壁（r, period, open=開いている割合, phase）。閉まると壁になる（荷物がいる間は閉まらない）
//   drops: 上から落ちてくる荷物（x,y を中心に r の範囲、period 秒ごと、warn 秒前から影で予告）
//   platforms: 穴の上を往復する動く床（swing）。荷物の真ん中が乗っている間は落ちず、床と一緒に運ばれる
//   crumbles: 崩れる床（穴の上の板）。真ん中が乗ると crumbleDelay 秒で抜け、しばらくすると戻る
//   deco: [[type, x,y,w,h]] 見た目だけ / medals: { gold, silver } ソファでの秒数（荷物ごとに par 倍）
//   timeLimit と medals は tools/sim-all.mjs（NOLIMIT=1）で全荷物の自動操縦の秒数を見て決めた（一番遅い荷物 ×1.2 からボーナス分を引く）

const UP = -Math.PI / 2
const L0 = 40, R0 = 960 // 外壁の内側

// ---- 区画（h は高さ、make(y0) は上端 y0 からの中身を返す）
// 倉庫
const wDoor = { h: 760, theme: 'wood', make: y => ({
  walls: [[L0, y + 380, 390, 70], [570, y + 380, 390, 70]], // ドア幅140。ソファは横向きでは通らない
  path: [[500, y + 560], [500, y + 240], [500, y]]
}) }
const wPits = { h: 900, theme: 'wood', make: y => ({
  pits: [[300, y + 320, 300, 260], [L0, y + 360, 90, 140]],
  path: [[760, y + 720], [760, y + 180], [500, y]]
}) }
const wZig = { h: 900, theme: 'wood', make: y => ({
  walls: [[L0, y + 620, 600, 60], [360, y + 260, 600, 60]],
  path: [[800, y + 780], [800, y + 460], [200, y + 460], [200, y + 160], [500, y]]
}) }
const wPillars = { h: 900, theme: 'wood', make: y => ({
  walls: [[520, y + 560, 80, 80], [180, y + 420, 80, 80], [600, y + 380, 80, 80], [L0, y + 60, 400, 200], [560, y + 60, 400, 200]],
  path: [[330, y + 760], [330, y + 560], [420, y + 460], [500, y + 300], [500, y]]
}) }
// 回るバー2本。真ん中のすき間はまっすぐ縦に通せば当たらないが、横を向いたり寄ったりすると当たる
const wSpin = { h: 1000, theme: 'wood', make: y => ({
  spinners: [
    { x: 285, y: y + 500, len: 360, thick: 40, w: 0.45, phase: 0, hurt: 10 },
    { x: 715, y: y + 500, len: 360, thick: 40, w: -0.45, phase: Math.PI, hurt: 10 }
  ],
  path: [[500, y + 860], [500, y + 150], [500, y]]
}) }
const wNarrow = { h: 600, theme: 'wood', make: y => ({
  walls: [[L0, y + 250, 400, 120], [560, y + 250, 400, 120]], // 幅120の通路
  pits: [[L0, y + 60, 380, 140]],
  path: [[500, y + 430], [500, y + 180], [500, y]]
}) }

// 商店街
const sBollards = { h: 500, theme: 'street', make: y => ({
  walls: [[300, y + 230, 40, 40], [480, y + 230, 40, 40], [660, y + 230, 40, 40]],
  path: [[590, y + 380], [590, y + 120], [500, y]]
}) }
const sShop = { h: 700, theme: 'street', make: y => ({
  walls: [[L0, y + 450, 420, 40], [540, y + 150, 420, 40]], // 立て看板
  pits: [[560, y + 330, 180, 110]], // 工事の穴
  deco: [['sign', 560, y + 300, 180, 30]],
  path: [[800, y + 600], [800, y + 290], [250, y + 290], [250, y + 120], [500, y]]
}) }
// 細い路地の坂（押し戻される）
const sAlley = { h: 900, theme: 'street', make: y => ({
  walls: [[L0, y, 350, 900], [610, y, 350, 900], [390, y + 600, 60, 40], [550, y + 350, 60, 40]],
  zones: [{ type: 'belt', r: [390, y, 220, 900], vx: 0, vy: 30, look: 'slope' }],
  path: [[540, y + 760], [540, y + 520], [460, y + 460], [460, y + 230], [500, y]]
}) }
// 車道（片側1車線ずつ）。両側に歩道、真ん中に島。車道の手前の歩道で待てる
const road = (speedA, speedB, bike) => ({ h: 700, theme: 'street', make: y => ({
  deco: [['road', L0, y + 115, 920, 470], ['island', L0, y + 255, 920, 190], ['zebra', 410, y + 115, 180, 470]],
  movers: [
    { kind: 'car', loop: [-300, 1300], y: y + 515, w: 150, h: 80, speed: speedA, phase: 0, hurt: 18, color: '#2f6fd6' },
    { kind: 'car', loop: [1300, -300], y: y + 185, w: 150, h: 80, speed: speedB, phase: 0.45, hurt: 18, color: '#e8e8e8' },
    ...(bike ? [{ kind: 'bike', loop: [-300, 1300], y: y + 515, w: 70, h: 34, speed: speedA, phase: 0.55, hurt: 10, color: '#3ddc97' }] : [])
  ],
  path: [[500, y + 650], [500, y + 350], [500, y + 50], [500, y]]
}) })
// 踏切: 閉まっている間に電車が通る。遮断機は閉まると壁になる
const sCrossing = { h: 650, theme: 'street', make: y => ({
  deco: [['rail', L0, y + 250, 920, 150]],
  gates: [
    { kind: 'crossing', r: [L0, y + 420, 920, 24], period: 14, open: 0.711, phase: 0.57 },
    { kind: 'crossing', r: [L0, y + 206, 920, 24], period: 14, open: 0.711, phase: 0.57 }
  ],
  movers: [{ kind: 'train', loop: [-1500, 5500], y: y + 325, w: 600, h: 110, speed: 500, phase: 0, hurt: 30, color: '#3a8f5a' }],
  path: [[500, y + 540], [500, y + 120], [500, y]]
}) }

// 雪
const nIce = { h: 700, theme: 'snow', make: y => ({
  zones: [{ type: 'ice', r: [L0, y + 40, 920, 620] }],
  pits: [[150, y + 200, 200, 140], [620, y + 160, 200, 160]],
  path: [[485, y + 560], [485, y + 80], [500, y]]
}) }
const nSlope = { h: 900, theme: 'snow', make: y => ({
  walls: [[L0, y + 600, 520, 50], [440, y + 300, 520, 50]],
  zones: [{ type: 'belt', r: [L0, y, 920, 900], vx: 0, vy: 35, look: 'slope' }],
  path: [[760, y + 780], [760, y + 460], [240, y + 460], [240, y + 180], [500, y]]
}) }
const nBridge = { h: 800, theme: 'snow', make: y => ({
  pits: [[L0, y + 250, 330, 300], [630, y + 250, 330, 300]],
  zones: [{ type: 'ice', r: [370, y + 250, 260, 300] }],
  path: [[500, y + 640], [500, y + 140], [500, y]]
}) }
const nPlow = { h: 700, theme: 'snow', make: y => ({
  walls: [[180, y + 500, 70, 70], [740, y + 500, 70, 70], [600, y + 120, 70, 70]],
  movers: [{ kind: 'plow', swing: { a: [120, y + 360], b: [880, y + 360], period: 9 }, w: 160, h: 60, phase: 0, hurt: 15, color: '#ff8a2a' }],
  path: [[500, y + 600], [420, y + 230], [500, y]]
}) }
// 川を渡る動く床（いかだ）
const nRaft = { h: 900, theme: 'snow', make: y => ({
  pits: [[L0, y + 200, 920, 500]],
  platforms: [{ w: 240, h: 250, swing: { a: [500, y + 600], b: [500, y + 300], period: 13 }, phase: 0 }],
  path: [[500, y + 800], [500, y + 770, UP, { ride: 0, exit: [500, y + 110] }], [500, y + 110], [500, y]]
}) }

// 工場
const belt = dir => ({ h: 520, theme: 'factory', make: y => ({
  zones: [{ type: 'belt', r: dir > 0 ? [L0, y + 150, 820, 230] : [140, y + 150, 820, 230], vx: 60 * dir, vy: 0 }],
  pits: [dir > 0 ? [860, y + 150, 100, 230] : [L0, y + 150, 100, 230]],
  path: [[500, y + 420], [500, y + 100], [500, y]]
}) })
const fPistons = { h: 950, theme: 'factory', make: y => ({
  walls: [[L0, y, 210, 950], [750, y, 210, 950]],
  movers: [
    { kind: 'piston', swing: { a: [100, y + 810], b: [400, y + 810], period: 3.2 }, w: 300, h: 80, phase: 0, hurt: 12 },
    { kind: 'piston', swing: { a: [900, y + 510], b: [600, y + 510], period: 3.2 }, w: 300, h: 80, phase: 0.5, hurt: 12 }
  ],
  path: [[650, y + 910], [650, y + 660], [350, y + 660], [350, y + 390], [500, y + 300], [500, y]]
}) }
const fFork = { h: 700, theme: 'factory', make: y => ({
  walls: [[120, y + 330, 140, 110], [740, y + 330, 140, 110]],
  movers: [{ kind: 'fork', swing: { a: [140, y + 540], b: [860, y + 540], period: 7 }, w: 120, h: 70, phase: 0.25, hurt: 15, color: '#f2c230' }],
  path: [[500, y + 640], [500, y + 120], [500, y]]
}) }
// 送風機: 時間で強くなって止む横風。右は穴
const fFans = { h: 900, theme: 'factory', make: y => ({
  pits: [[760, y + 200, 200, 500]],
  zones: [{ type: 'wind', r: [L0, y + 200, 720, 500], vx: 70, vy: 0, period: 4, phase: 0 }],
  deco: [['fans', L0, y + 200, 30, 500]],
  path: [[300, y + 760], [300, y + 120], [500, y]]
}) }
// クレーンから落ちてくる荷物（影で予告）
const fDrops = { h: 1100, theme: 'factory', make: y => ({
  walls: [[L0, y, 240, 1100], [760, y, 200, 1100]],
  // 落ちた直後が通りどき。落ちる場所のあいだに、待てるすき間がある
  drops: [
    { x: 500, y: y + 830, r: 60, period: 7, phase: 0, warn: 2, hurt: 16 },
    { x: 500, y: y + 490, r: 60, period: 7, phase: 0.33, warn: 2, hurt: 16 },
    { x: 500, y: y + 150, r: 60, period: 7, phase: 0.66, warn: 2, hurt: 16 }
  ],
  path: [[500, y + 1060], [500, y + 660], [500, y + 320], [500, y]]
}) }

// マンション
const aStairs = side => ({ h: 1000, theme: 'apartment', make: y => {
  const L = side > 0
  return {
    walls: L ? [[L0, y, 260, 1000], [690, y + 150, 10, 300], [690, y + 600, 10, 250]] : [[700, y, 260, 1000], [300, y + 150, 10, 300], [300, y + 600, 10, 250]],
    pits: [L ? [700, y + 150, 260, 700] : [L0, y + 150, 260, 700]], // 吹き抜け（手すりは所々こわれている）
    zones: [{ type: 'stairs', r: L ? [300, y + 100, 390, 800] : [310, y + 100, 390, 800] }],
    path: [[L ? 480 : 520, y + 800], [L ? 480 : 520, y + 150], [500, y]]
  }
} })
const aResidents = { h: 900, theme: 'apartment', make: y => ({
  walls: [[L0, y, 160, 900], [800, y, 160, 900]],
  movers: [
    { kind: 'person', swing: { a: [230, y + 650], b: [770, y + 650], period: 6 }, w: 44, h: 44, phase: 0, hurt: 6, color: '#7a5cff' },
    { kind: 'person', swing: { a: [770, y + 300], b: [230, y + 300], period: 5 }, w: 44, h: 44, phase: 0.3, hurt: 6, color: '#ff8a2a' }
  ],
  path: [[500, y + 800], [500, y + 120], [500, y]]
}) }
// 防火シャッター: 開いている間に通る
const aShutter = { h: 700, theme: 'apartment', make: y => ({
  walls: [[L0, y, 160, 700], [800, y, 160, 700]],
  gates: [{ kind: 'shutter', r: [200, y + 330, 600, 40], period: 6, open: 0.6, phase: 0 }],
  path: [[500, y + 560], [500, y + 120], [500, y]]
}) }
// 崩れる床: 吹き抜けの上の古い板。乗ると少しして抜ける
const aCrumble = { h: 1000, theme: 'apartment', make: y => {
  const crumbles = []
  for (let r = 0; r < 7; r++) for (let c = 0; c < 3; c++) crumbles.push({ r: [350 + c * 100, y + 150 + r * 100, 100, 100] })
  return {
    pits: [[L0, y + 150, 920, 700]],
    crumbles,
    path: [[500, y + 900], [500, y + 100], [500, y]]
  }
} }

// ---- 組み立て
const START_H = 320, CP_H = 220, GOAL_H = 380
const GOAL_DECO = { wood: 'house', street: 'shop', snow: 'cabin', factory: 'dock', apartment: 'room' }
function build({ name, lead, goalLabel, theme, sections, startA = UP, cpBonus = 20, timeLimit, medals }) {
  const segs = []
  sections.forEach((sec, i) => { if (i > 0) segs.push('cp'); segs.push(...sec) })
  const body = segs.reduce((a, s) => a + (s === 'cp' ? CP_H : s.h), 0)
  const H = START_H + body + GOAL_H
  const W = 1000
  const c = { name, lead, goalLabel, theme, size: [W, H], timeLimit, medals, regions: [], walls: [], pits: [], zones: [], deco: [], movers: [], spinners: [], gates: [], drops: [], platforms: [], crumbles: [], checkpoints: [], path: [] }
  // 外壁
  c.walls.push([0, 0, W, 40], [0, H - 40, W, 40], [0, 0, 40, H], [W - 40, 0, 40, H])
  // スタート（一番下）
  let y = H - START_H
  c.start = { x: 500, y: y + 200, a: startA }
  c.path.push([500, y + 200, startA])
  const firstTheme = sections[0][0].theme
  c.regions.push({ y0: y, y1: H, theme: firstTheme })
  let lastTheme = firstTheme
  for (const s of segs) {
    if (s === 'cp') {
      y -= CP_H
      c.checkpoints.push({ r: [L0, y, 920, CP_H], at: [500, y + 110, UP], bonus: cpBonus })
      c.deco.push(['cp', L0, y, 920, CP_H])
      c.path.push([500, y + 110, UP])
      c.regions.push({ y0: y, y1: y + CP_H, theme: lastTheme })
      continue
    }
    y -= s.h
    const m = s.make(y)
    for (const k of ['walls', 'pits', 'zones', 'deco', 'movers', 'spinners', 'gates', 'drops', 'platforms', 'crumbles']) if (m[k]) c[k].push(...m[k])
    for (const p of m.path) c.path.push([p[0], p[1], p[2] ?? UP, ...(p[3] ? [p[3]] : [])])
    c.regions.push({ y0: y, y1: y + s.h, theme: s.theme })
    lastTheme = s.theme
  }
  // ゴール（一番上）: 幅160の入口と、行き先の床
  y -= GOAL_H
  if (y !== 0) throw new Error('コースの高さの計算が合わない')
  c.walls.push([L0, y + 260, 380, 40], [580, y + 260, 380, 40])
  c.goal = [330, y + 70, 340, 170]
  c.deco.push([GOAL_DECO[lastTheme] || 'house', L0, L0, 920, 220])
  c.path.push([500, y + 320, UP], [500, y + 160, UP])
  c.regions.push({ y0: 0, y1: GOAL_H, theme: lastTheme })
  return c
}

export const COURSES = {
  warehouse: build({
    name: '倉庫から新居まで', lead: 'ドアと穴 → ジグザグと柱 → 回るバー', goalLabel: '新居', theme: 'wood', startA: 0,
    sections: [[wDoor, wPits], [wZig, wPillars], [wSpin, wNarrow]],
    timeLimit: 200, medals: { gold: 105, silver: 150 }
  }),
  crosswalk: build({
    name: '商店街の横断歩道', lead: '路地の坂 → 車道を2本 → 踏切と電車', goalLabel: 'ラーメン屋', theme: 'street',
    sections: [[sBollards, sShop, sAlley], [road(150, 175, false), road(190, 210, true)], [sCrossing, road(210, 230, true)]],
    timeLimit: 255, medals: { gold: 145, silver: 210 }
  }),
  snow: build({
    name: '雪の坂道と川', lead: '氷と坂 → 手すりの無い橋と除雪車 → いかだで川を渡る', goalLabel: '山小屋', theme: 'snow',
    sections: [[nIce, nSlope], [nBridge, nPlow], [nRaft, nIce]],
    timeLimit: 170, medals: { gold: 105, silver: 150 }
  }),
  factory: build({
    name: '工場のベルトコンベア', lead: 'ベルト → ピストンとフォークリフト → 送風機と落ちてくる荷物', goalLabel: '出荷口', theme: 'factory',
    sections: [[belt(1), belt(-1)], [fPistons, fFork], [fFans, fDrops]],
    timeLimit: 200, medals: { gold: 145, silver: 215 }
  }),
  stairs: build({
    name: 'マンションの階段', lead: '階段と吹き抜け → 住人と防火シャッター → 崩れる床', goalLabel: '最上階の部屋', theme: 'apartment',
    sections: [[aStairs(1), aStairs(-1)], [aResidents, aShutter], [aCrumble, aStairs(1)]],
    timeLimit: 260, medals: { gold: 160, silver: 230 }
  }),
  grand: build({
    name: '引越し大移動', lead: '倉庫から商店街、雪道、工場、マンションまで1本道。6〜8分', goalLabel: '新しい部屋', theme: 'wood', startA: 0,
    sections: [[wDoor, wPits], [wSpin, wNarrow], [sBollards, sAlley], [road(170, 200, true)], [sCrossing], [nIce, nSlope], [nRaft], [belt(1), fPistons], [fFans, fDrops], [aStairs(1), aShutter], [aCrumble]],
    cpBonus: 15, timeLimit: 570, medals: { gold: 370, silver: 540 }
  })
}

// 1区間ずつ違う仕掛けにしたいので、ロングコースの各区間は短め。どの区間も新しい仕掛けを1つ以上含む

// 荷物。mass が大きいほど遅く、fragile が大きいほどぶつけたときに傷む。
export const CARGOS = {
  crate: { name: '木箱', lead: '金具つきの大きな木箱。重いが丈夫', w: 120, h: 92, mass: 1.3, fragile: 0.8, hp: 110, par: 1.3, color: '#b8864e' },
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

// 回るバーの、時刻 t での箱（中心・向き・半分の長さと太さ）
export function spinnerBox(s, t) {
  return { x: s.x, y: s.y, a: (s.phase || 0) + s.w * t, hw: s.len / 2, hh: s.thick / 2 }
}
// 開け閉めする壁が閉まっている時刻か（荷物がいて閉まれない、はサーバーだけが知る）
export function gateClosed(g, t) {
  const f = (((t / g.period + (g.phase || 0)) % 1) + 1) % 1
  return f >= g.open
}
// 落ちてくる荷物: 次の着地まで until 秒、前の着地から since 秒
export function dropState(d, t) {
  const u = t / d.period + (d.phase || 0)
  const f = ((u % 1) + 1) % 1
  return { until: (1 - f) * d.period, since: f * d.period }
}
// 送風機の強さ（0〜1）。強くなって止むをくり返す
export function windPower(z, t) {
  return Math.max(0, Math.sin(2 * Math.PI * (t / z.period + (z.phase || 0))))
}

// 向きのある箱どうしが重なっているか（分離軸）。重なっていれば B から A を押し出す向き（長さ1）と深さを返す
// 箱は { x, y, a, hw, hh }
export function obbOverlap(A, B) {
  const axes = [[Math.cos(A.a), Math.sin(A.a)], [-Math.sin(A.a), Math.cos(A.a)], [Math.cos(B.a), Math.sin(B.a)], [-Math.sin(B.a), Math.cos(B.a)]]
  const dx = A.x - B.x, dy = A.y - B.y
  let best = Infinity, bn = null
  const rad = (box, ax) => {
    const c = Math.cos(box.a), s = Math.sin(box.a)
    return box.hw * Math.abs(c * ax[0] + s * ax[1]) + box.hh * Math.abs(-s * ax[0] + c * ax[1])
  }
  for (const ax of axes) {
    const d = dx * ax[0] + dy * ax[1]
    const o = rad(A, ax) + rad(B, ax) - Math.abs(d)
    if (o <= 0) return null
    if (o < best) { best = o; bn = d < 0 ? [-ax[0], -ax[1]] : ax }
  }
  return { nx: bn[0], ny: bn[1], depth: best }
}

// 荷物を (x,y,a) に置いたとき、時刻 t にぶつかる物があるか（自動操縦の待ち合わせ用。margin だけ大きめに見る）
export function hazardAt(course, cargo, t, x, y, a, margin = 12) {
  const me = { x, y, a, hw: cargo.w / 2 + margin, hh: cargo.h / 2 + margin }
  for (const m of course.movers || []) {
    const p = moverAt(m, t)
    if (obbOverlap(me, { x: p.x, y: p.y, a: 0, hw: m.w / 2, hh: m.h / 2 })) return true
  }
  for (const s of course.spinners || []) if (obbOverlap(me, spinnerBox(s, t))) return true
  for (const d of course.drops || []) {
    const st = dropState(d, t)
    if (st.until < 0.35 && obbOverlap(me, { x: d.x, y: d.y, a: 0, hw: d.r, hh: d.r })) return true
  }
  for (const g of course.gates || []) {
    if (!gateClosed(g, t)) continue
    const [gx, gy, gw, gh] = g.r
    if (obbOverlap(me, { x: gx + gw / 2, y: gy + gh / 2, a: 0, hw: gw / 2, hh: gh / 2 })) return true
  }
  return false
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
