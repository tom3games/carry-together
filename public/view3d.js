// ゲーム中の 3D 描画（Three.js）。動きの計算はサーバーがするので、ここは届いた位置を立体で見せるだけ。
// ワールドの座標（x 右、y 下）を 3D では x → x、y → z に置き換え、1単位 = 1cm（S=0.01 で m に直す）。
// カメラは運び手の少し後ろ・低めから、進む先（奥＝北）を見る追いかけ視点。向きは固定なので、
// スティックを上に倒す＝画面の奥へ押す、がずっと一致する。手前へ戻る区間では自動で高く上がって見下ろす。
// 荷物より手前の壁は上を切り取って、荷物と運び手が隠れないようにする。
import * as THREE from './vendor/three.module.js'
import { moverAt, handleOffsets, PLAYER_COLORS, CARGOS, spinnerBox, dropState, windPower } from './stages.js'

const S = 0.01
const CHIBI = 1.25 // 運び手は大きめに描く（表情が見えるように）
const THEMES = {
  wood: { top: 0x4aa8ef, horizon: 0xcfeaff, sun: 0xfff2dc, hemiSky: 0xfff6e6, hemiGround: 0x9a7a52, ground: 0x7fbf5a, wall: 0xc98d4f, cap: 0xe6b277, wallH: 0.9 },
  street: { top: 0x3f9ff0, horizon: 0xd6efff, sun: 0xfff6e2, hemiSky: 0xe6f4ff, hemiGround: 0x7a7468, ground: 0x7fbf5a, wall: 0x5e6c82, cap: 0x8fa0b8, wallH: 0.75 },
  snow: { top: 0x5aa9e6, horizon: 0xe8f3ff, sun: 0xf6faff, hemiSky: 0xf2f8ff, hemiGround: 0xa9bdd2, ground: 0xf4f8fc, wall: 0xf4f8fc, cap: 0xffffff, wallH: 0.6 },
  factory: { top: 0x4f9ad8, horizon: 0xcfe2f2, sun: 0xfff2dc, hemiSky: 0xe0ecf8, hemiGround: 0x5a5f66, ground: 0x6f8a5a, wall: 0x4f6378, cap: 0xffc83a, wallH: 1.0 },
  apartment: { top: 0x4aa8ef, horizon: 0xd9eeff, sun: 0xfff3e0, hemiSky: 0xfff8ec, hemiGround: 0x8a7a66, ground: 0x7fbf5a, wall: 0xe2b98a, cap: 0xf3d3ae, wallH: 1.0 }
}

const v3 = (x, y, z) => new THREE.Vector3(x, y, z)
const lam = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra })

// トゥーン（3段の陰影）
let gradTex = null
function toon(color, extra = {}) {
  if (!gradTex) {
    gradTex = new THREE.DataTexture(new Uint8Array([90, 90, 90, 255, 175, 175, 175, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat)
    gradTex.minFilter = gradTex.magFilter = THREE.NearestFilter; gradTex.needsUpdate = true
  }
  return new THREE.MeshToonMaterial({ color, gradientMap: gradTex, ...extra })
}
const INK = new THREE.MeshBasicMaterial({ color: 0x2a2119, side: THREE.BackSide })
// 輪郭線（裏返した一回り大きい形）
function outline(mesh, k = 1.06) {
  const o = new THREE.Mesh(mesh.geometry, INK)
  o.scale.setScalar(k); o.position.copy(mesh.position); o.rotation.copy(mesh.rotation)
  mesh.parent.add(o)
  return o
}

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h
  draw(c.getContext('2d'))
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace
  return t
}

// 顔の絵（表情ごとに1枚）。頭の前、カメラ側に貼る
function faceTexture(kind) {
  return canvasTex(128, 128, g => {
    g.strokeStyle = '#1b130d'; g.fillStyle = '#1b130d'; g.lineWidth = 7; g.lineCap = 'round'; g.lineJoin = 'round'
    const eye = (x, y, r = 9) => { g.beginPath(); g.ellipse(x, y, r * 0.8, r, 0, 0, Math.PI * 2); g.fill(); g.fillStyle = '#fff'; g.beginPath(); g.arc(x + 2, y - 3, r * 0.3, 0, Math.PI * 2); g.fill(); g.fillStyle = '#1b130d' }
    const brows = (tilt) => { g.lineWidth = 7; g.beginPath(); g.moveTo(30, 38 - tilt); g.lineTo(54, 38 + tilt); g.moveTo(98, 38 - tilt); g.lineTo(74, 38 + tilt); g.stroke() }
    if (kind === 'happy') {
      g.beginPath(); g.arc(42, 58, 11, Math.PI * 1.1, Math.PI * 1.9); g.stroke()
      g.beginPath(); g.arc(86, 58, 11, Math.PI * 1.1, Math.PI * 1.9); g.stroke()
      g.fillStyle = '#7a1d1d'; g.beginPath(); g.arc(64, 76, 20, 0, Math.PI); g.closePath(); g.fill(); g.stroke()
    } else if (kind === 'shout') { // 力いっぱい押している
      brows(8); eye(44, 58, 8); eye(84, 58, 8)
      g.fillStyle = '#7a1d1d'; g.beginPath(); g.moveTo(42, 78); g.quadraticCurveTo(64, 72, 86, 78); g.quadraticCurveTo(80, 108, 64, 108); g.quadraticCurveTo(48, 108, 42, 78); g.fill(); g.lineWidth = 5; g.stroke()
      g.fillStyle = '#fff'; g.fillRect(48, 77, 32, 7)
    } else if (kind === 'shock') {
      g.lineWidth = 5; g.beginPath(); g.arc(42, 54, 11, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(86, 54, 11, 0, Math.PI * 2); g.stroke()
      g.beginPath(); g.arc(42, 54, 4, 0, Math.PI * 2); g.arc(86, 54, 4, 0, Math.PI * 2); g.fill()
      g.fillStyle = '#7a1d1d'; g.beginPath(); g.ellipse(64, 92, 12, 16, 0, 0, Math.PI * 2); g.fill(); g.stroke()
    } else if (kind === 'strain') { // 押しても動かない
      brows(-4)
      g.beginPath(); g.moveTo(32, 52); g.lineTo(50, 60); g.lineTo(32, 66); g.stroke()
      g.beginPath(); g.moveTo(96, 52); g.lineTo(78, 60); g.lineTo(96, 66); g.stroke()
      g.fillStyle = '#fff'; g.fillRect(44, 82, 40, 14); g.lineWidth = 4; g.strokeRect(44, 82, 40, 14)
      g.beginPath(); for (let x = 52; x <= 76; x += 8) { g.moveTo(x, 82); g.lineTo(x, 96) } g.stroke()
      g.fillStyle = '#7fd3ff'; g.beginPath(); g.moveTo(108, 20); g.quadraticCurveTo(122, 42, 108, 48); g.quadraticCurveTo(94, 42, 108, 20); g.fill()
    } else if (kind === 'worry') {
      eye(44, 60); eye(84, 60)
      g.beginPath(); g.moveTo(30, 44); g.lineTo(52, 38); g.moveTo(98, 44); g.lineTo(76, 38); g.stroke()
      g.beginPath(); g.arc(64, 102, 14, 1.2 * Math.PI, 1.8 * Math.PI); g.stroke()
    } else {
      eye(44, 60); eye(84, 60)
      g.beginPath(); g.arc(64, 76, 13, 0.2 * Math.PI, 0.8 * Math.PI); g.stroke()
    }
    g.fillStyle = 'rgba(255,110,110,.45)'; g.beginPath(); g.ellipse(26, 82, 11, 7, 0, 0, Math.PI * 2); g.ellipse(102, 82, 11, 7, 0, 0, Math.PI * 2); g.fill()
  })
}

function textTexture(text, { w = 512, h = 128, bg = '#fff8ea', fg = '#2a2119', font = '400 72px "Dela Gothic One", "Hiragino Sans", sans-serif', border = null } = {}) {
  return canvasTex(w, h, g => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h)
    if (border) { g.strokeStyle = border; g.lineWidth = 12; g.strokeRect(6, 6, w - 12, h - 12) }
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle'
    let size = parseInt(font.match(/(\d+)px/)[1], 10)
    g.font = font
    while (g.measureText(text).width > w * 0.86 && size > 12) { size -= 2; g.font = font.replace(/\d+px/, size + 'px') }
    g.fillText(text, w / 2, h / 2 + 4)
  })
}

function stripeTexture(a, b, n = 8) {
  const t = canvasTex(64, 64, g => {
    g.fillStyle = a; g.fillRect(0, 0, 64, 64)
    g.fillStyle = b
    for (let i = -64; i < 128; i += 64 / n * 2) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 64 / n, 0); g.lineTo(i + 64 / n - 64, 64); g.lineTo(i - 64, 64); g.fill() }
  })
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

function chevronTexture() {
  const t = canvasTex(128, 128, g => {
    g.fillStyle = '#2b2f35'; g.fillRect(0, 0, 128, 128)
    g.strokeStyle = '#ffcc00'; g.lineWidth = 14; g.lineCap = 'round'; g.lineJoin = 'round'
    g.beginPath(); g.moveTo(34, 26); g.lineTo(84, 64); g.lineTo(34, 102); g.stroke()
    g.fillStyle = '#1d2025'; g.fillRect(0, 0, 128, 4); g.fillRect(0, 124, 128, 4)
  })
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

function woodTexture() {
  const t = canvasTex(128, 128, g => {
    g.fillStyle = '#c8935a'; g.fillRect(0, 0, 128, 128)
    for (let i = 0; i < 4; i++) {
      g.fillStyle = i % 2 ? '#bb8650' : '#d29d63'; g.fillRect(0, i * 32, 128, 30)
      g.strokeStyle = 'rgba(90,55,25,.35)'; g.lineWidth = 2
      for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(0, i * 32 + 8 + k * 7); g.bezierCurveTo(40, i * 32 + 4 + k * 7, 80, i * 32 + 12 + k * 7, 128, i * 32 + 7 + k * 7); g.stroke() }
    }
    g.fillStyle = 'rgba(70,40,15,.6)'; for (let i = 1; i < 4; i++) g.fillRect(0, i * 32 - 2, 128, 2)
  })
  return t
}

// ---- 運び手（頭の大きいちびキャラ）。帽子は人ごとに キャップ / ニット帽 / ヘルメット
function makeChibi(color, faceMats, style = 0) {
  const g = new THREE.Group()
  const body = new THREE.Group(); g.add(body)
  const cloth = toon(color)
  const dark = toon(0x2b2f38)
  const skin = toon(0xffd9b3)
  // 足と靴
  const legs = [-0.07, 0.07].map(x => {
    const pv = new THREE.Group(); pv.position.set(x, 0.2, 0)
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.16, 8), style === 1 ? toon(0x5b7a3a) : dark); l.position.y = -0.08; l.castShadow = true; pv.add(l)
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.06, 0.14), toon(style === 2 ? 0xd3312c : 0xf4f1ea)); shoe.position.set(0, -0.17, 0.03); shoe.castShadow = true; pv.add(shoe)
    body.add(pv); return pv
  })
  // 胴（パーカー。オーバーオールの人は胸当てと肩ひも）
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.1, 6, 12), cloth); torso.position.y = 0.33; torso.castShadow = true; body.add(torso)
  outline(torso, 1.08)
  if (style === 0) {
    const bib = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.14, 0.05), dark); bib.position.set(0, 0.3, 0.12); body.add(bib)
  } else {
    const hood = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.035, 6, 12), cloth); hood.rotation.x = Math.PI / 2; hood.position.y = 0.47; body.add(hood)
  }
  // 頭
  const headG = new THREE.Group(); headG.position.y = 0.66; body.add(headG)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.23, 18, 14), skin); head.castShadow = true; headG.add(head)
  outline(head, 1.06)
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.235, 16, 10, Math.PI * 0.75, Math.PI * 1.5, 0, Math.PI * 0.62), toon(0x3a2a20)); headG.add(hair)
  if (style === 0) { // キャップ（つばは前）
    const crown = new THREE.Mesh(new THREE.SphereGeometry(0.245, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.42), cloth); crown.position.y = 0.02; headG.add(crown)
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.025, 14, 1, false, -Math.PI / 2, Math.PI), cloth); brim.position.set(0, 0.1, 0.17); headG.add(brim)
    const front = new THREE.Mesh(new THREE.SphereGeometry(0.247, 12, 6, -Math.PI * 0.25, Math.PI * 0.5, Math.PI * 0.1, Math.PI * 0.3), toon(0xffffff)); front.position.y = 0.02; headG.add(front)
  } else if (style === 1) { // ニット帽
    const crown = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), cloth); crown.position.y = 0.03; headG.add(crown)
    const fold = new THREE.Mesh(new THREE.TorusGeometry(0.235, 0.045, 8, 20), cloth); fold.rotation.x = Math.PI / 2; fold.position.y = 0.06; headG.add(fold)
  } else { // ヘルメット
    const crown = new THREE.Mesh(new THREE.SphereGeometry(0.255, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.45), cloth); crown.position.y = 0.03; headG.add(crown)
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.025, 6, 20), cloth); rim.rotation.x = Math.PI / 2; rim.position.y = 0.06; headG.add(rim)
  }
  const face = new THREE.Sprite(faceMats.calm); face.scale.set(0.32, 0.32, 1); face.renderOrder = 4; g.add(face)
  // 腕2本と手袋（持ち手へ伸ばす）
  const arms = [0, 1].map(() => {
    const a = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1, 6), cloth); a.castShadow = true; g.add(a)
    const glove = new THREE.Mesh(new THREE.SphereGeometry(0.065, 10, 8), toon(0xf8f8f2)); g.add(glove)
    return { a, glove }
  })
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.22, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }))
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.012; g.add(shadow)
  return { g, body, legs, headG, face, arms, faceMats, torso }
}

export function createView3D(canvas, { course, cargo, n, me }) {
  let renderer
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    if (!renderer.getContext()) throw new Error('no gl')
  } catch { return null }
  const theme = THEMES[course.theme] || THEMES.wood
  const coarse = matchMedia('(pointer: coarse)').matches
  let tier = coarse ? 1 : 2 // 2=高 1=中 0=低。fps が出なければ下げる
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(theme.horizon)
  scene.fog = new THREE.Fog(theme.horizon, 16, 42)
  const camera = new THREE.PerspectiveCamera(46, 1, 0.2, 160)
  const hemi = new THREE.HemisphereLight(theme.hemiSky, theme.hemiGround, 1.7); scene.add(hemi)
  const sun = new THREE.DirectionalLight(theme.sun, 2.0)
  sun.castShadow = true
  sun.shadow.camera.left = -8; sun.shadow.camera.right = 8; sun.shadow.camera.top = 8; sun.shadow.camera.bottom = -8
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 30; sun.shadow.bias = -0.0008
  scene.add(sun); scene.add(sun.target)
  const faceMats = {}
  for (const k of ['calm', 'happy', 'shock', 'strain', 'worry', 'shout']) faceMats[k] = new THREE.SpriteMaterial({ map: faceTexture(k), depthWrite: false })
  const [CW, CH] = course.size
  const W = CW * S, H = CH * S

  // ---- 空（上が濃い青、地平線が白っぽい）と雲
  {
    const geo = new THREE.SphereGeometry(80, 24, 12)
    const top = new THREE.Color(theme.top), hor = new THREE.Color(theme.horizon), cols = []
    const pos = geo.attributes.position
    for (let i = 0; i < pos.count; i++) { const k = Math.max(0, Math.min(1, pos.getY(i) / 50)); const c = hor.clone().lerp(top, Math.pow(k, 0.6)); cols.push(c.r, c.g, c.b) }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3))
    const sky = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }))
    sky.renderOrder = -1; sky.userData.follow = true; scene.add(sky)
    var skyMesh = sky
    const cloudTex = canvasTex(256, 128, g => {
      g.fillStyle = '#fff'
      for (const [x, y, r] of [[70, 80, 38], [118, 62, 50], [170, 78, 40], [205, 88, 26], [40, 92, 24]]) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill() }
      g.fillRect(40, 88, 180, 26)
    })
    for (let i = 0; i < 9; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex, fog: false, depthWrite: false, transparent: true, opacity: 0.95 }))
      const a = (i / 9) * Math.PI - Math.PI / 2 + (i % 2) * 0.2
      sp.position.set(Math.sin(a) * 60, 14 + (i % 3) * 6, -Math.cos(a) * 60 - 10)
      sp.scale.set(18 + (i % 3) * 6, 9 + (i % 3) * 3, 1)
      sp.userData.follow = true
      scene.add(sp)
    }
  }

  // ---- 床: 2D の絵（床・飾り・仕掛け・ゴール・穴の縁）を、縦 CHUNK ずつの板に貼る。穴の部分は透明にして下が見えるように。
  // 長いコースでも画質が落ちないよう、カメラの近くの板だけ作り、遠くなったら捨てる
  const CHUNK = 1600, FK = 0.6
  const themeAt = y => { for (const r of course.regions || []) if (y >= r.y0 && y <= r.y1) return r.theme; return course.theme }
  const chunks = new Map()
  function makeChunk(i) {
    const y0 = i * CHUNK, h = Math.min(CHUNK, CH - y0)
    const fc = document.createElement('canvas'); fc.width = Math.round(CW * FK); fc.height = Math.round(h * FK)
    const fctx = fc.getContext('2d')
    fctx.scale(FK, FK); fctx.translate(0, -y0)
    ;(createView3D.paintFloor || (() => {}))(fctx, course)
    for (const [x, y, w, hh] of course.pits) fctx.clearRect(x, y, w, hh)
    const ftex = new THREE.CanvasTexture(fc); ftex.colorSpace = THREE.SRGBColorSpace; ftex.anisotropy = 4
    const m = new THREE.Mesh(new THREE.PlaneGeometry(W, h * S), lam(0xffffff, { map: ftex, alphaTest: 0.5 }))
    m.rotation.x = -Math.PI / 2; m.position.set(W / 2, 0, (y0 + h / 2) * S); m.receiveShadow = true
    scene.add(m)
    return m
  }
  function updateChunks(zWorld, all = false) {
    const ci = Math.floor(zWorld / CHUNK), n = Math.ceil(CH / CHUNK)
    let made = 0
    for (let i = Math.max(0, ci - 1); i <= Math.min(n - 1, ci + 2); i++) {
      if (!chunks.has(i) && (all || made < 1)) { chunks.set(i, makeChunk(i)); made++ }
    }
    for (const [i, m] of chunks) if (i < ci - 2 || i > ci + 3) { scene.remove(m); m.geometry.dispose(); m.material.map.dispose(); m.material.dispose(); chunks.delete(i) }
  }
  updateChunks(course.start.y, true)
  // 周りの地面（真ん中に置くと穴の中から見えるので4枚に分ける）と、遠くの木
  for (const [x, z, w, d] of [[W / 2, -30, W + 120, 60], [W / 2, H + 30, W + 120, 60], [-30, H / 2, 60, H], [W + 30, H / 2, 60, H]]) {
    const o = new THREE.Mesh(new THREE.PlaneGeometry(w, d), lam(theme.ground))
    o.rotation.x = -Math.PI / 2; o.position.set(x, -0.02, z); o.receiveShadow = true; scene.add(o)
  }
  {
    const trunk = new THREE.CylinderGeometry(0.12, 0.16, 0.9, 6), crown = new THREE.ConeGeometry(0.8, 1.8, 7)
    const N = Math.min(320, Math.round(H * 0.9))
    const ti = new THREE.InstancedMesh(trunk, toon(0x7a5230), N), ci = new THREE.InstancedMesh(crown, toon(course.theme === 'snow' ? 0xe8f2fa : 0x3f9a4a), N)
    const mtx = new THREE.Matrix4()
    for (let i = 0; i < N; i++) {
      const side = i % 2 ? -1 : 1
      const x = side > 0 ? W + 1.5 + ((i * 37) % 50) / 10 : -1.5 - ((i * 53) % 50) / 10
      const z = ((i * 211) % Math.round(H * 10)) / 10
      const s = 0.8 + ((i * 7) % 5) / 8
      mtx.makeScale(s, s, s); mtx.setPosition(x, 0.45 * s, z); ti.setMatrixAt(i, mtx)
      mtx.makeScale(s, s, s); mtx.setPosition(x, 1.7 * s, z); ci.setMatrixAt(i, mtx)
    }
    ci.castShadow = true
    scene.add(ti, ci)
  }

  // 穴: 内側だけ見える箱（深さが見える）。雪のコースは水面
  for (const [x, y, w, h] of course.pits) {
    const wet = themeAt(y + h / 2) === 'snow'
    const depth = wet ? 0.6 : 2.4
    const geo = new THREE.BoxGeometry(w * S, depth, h * S)
    const col = new THREE.Color(wet ? 0x24557d : 0x3a2a1e)
    const pos = geo.attributes.position, cols = []
    for (let i = 0; i < pos.count; i++) { const k = pos.getY(i) > 0 ? 1 : 0.12; cols.push(col.r * k, col.g * k, col.b * k) }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3))
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide }))
    m.position.set((x + w / 2) * S, -depth / 2 - 0.001, (y + h / 2) * S)
    scene.add(m)
    if (wet) {
      const water = new THREE.Mesh(new THREE.PlaneGeometry(w * S, h * S), new THREE.MeshPhongMaterial({ color: 0x2e8fd0, shininess: 90, specular: 0xffffff, transparent: true, opacity: 0.92 }))
      water.rotation.x = -Math.PI / 2; water.position.set((x + w / 2) * S, -0.22, (y + h / 2) * S)
      scene.add(water)
    }
  }

  // 床の仕掛け: 氷は光る板、ベルトは流れる模様、階段は段の出っ張り
  const belts = []
  for (const z of course.zones || []) {
    const [x, y, w, h] = z.r
    if (z.type === 'ice') {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w * S, h * S), new THREE.MeshPhongMaterial({ color: 0xbfe8ff, shininess: 120, specular: 0xffffff, transparent: true, opacity: 0.45, depthWrite: false }))
      m.rotation.x = -Math.PI / 2; m.position.set((x + w / 2) * S, 0.006, (y + h / 2) * S); scene.add(m)
    } else if (z.type === 'belt' && z.look !== 'slope') {
      const t = chevronTexture()
      const horiz = Math.abs(z.vx || 0) > Math.abs(z.vy || 0)
      const along = (horiz ? w : h) * S, across = (horiz ? h : w) * S
      t.repeat.set(along / 0.7, Math.max(1, Math.round(across / 0.7)))
      const m = new THREE.Mesh(new THREE.PlaneGeometry(along, across), lam(0xffffff, { map: t }))
      m.rotation.x = -Math.PI / 2
      m.rotation.z = horiz ? (z.vx > 0 ? 0 : Math.PI) : (z.vy > 0 ? -Math.PI / 2 : Math.PI / 2)
      m.position.set((x + w / 2) * S, 0.008, (y + h / 2) * S); m.receiveShadow = true
      scene.add(m)
      belts.push({ t, speed: Math.hypot(z.vx || 0, z.vy || 0) * S / 0.7 })
      const rail = toon(0xffcc00)
      for (const side of [-1, 1]) {
        const r = new THREE.Mesh(new THREE.BoxGeometry(horiz ? w * S : 0.06, 0.06, horiz ? 0.06 : h * S), rail)
        r.position.set((x + w / 2) * S + (horiz ? 0 : side * (w * S / 2)), 0.03, (y + h / 2) * S + (horiz ? side * (h * S / 2) : 0))
        scene.add(r)
      }
    } else if (z.type === 'stairs') {
      const count = Math.floor(h / 34)
      const im = new THREE.InstancedMesh(new THREE.BoxGeometry(w * S, 0.03, 0.06), lam(0xa8987c), count)
      const mtx = new THREE.Matrix4()
      for (let i = 0; i < count; i++) { mtx.makeTranslation((x + w / 2) * S, 0.015, (y + i * 34 + 30) * S); im.setMatrixAt(i, mtx) }
      im.receiveShadow = true; scene.add(im)
    }
  }

  // ---- 荷物より手前の壁を切り取る（低い視点でも荷物が隠れない）
  const cutU = { value: new THREE.Vector3(-99, 0, -99) }
  function cutaway(mat) {
    mat.onBeforeCompile = sh => {
      sh.uniforms.uCut = cutU
      sh.vertexShader = 'varying vec3 vCutW;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
  vec4 cutw = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
  cutw = instanceMatrix * cutw;
  #endif
  vCutW = (modelMatrix * cutw).xyz;`)
      sh.fragmentShader = 'uniform vec3 uCut;\nvarying vec3 vCutW;\n' + sh.fragmentShader.replace('void main() {', `void main() {
  float dz = vCutW.z - uCut.z;
  if (vCutW.y > 0.28 && dz > 0.25 && dz < uCut.y && abs(vCutW.x - uCut.x) < 2.2 + dz * 0.25) discard;`)
    }
    mat.customProgramCacheKey = () => 'cut'
    return mat
  }

  // ---- 壁: 大きい壁は箱（胴と天板）、小さい壁はコースらしい小物にする
  const outerWall = ([x, y, w, h]) => (x <= 0 && w >= CW - 1) || (y <= 0 && h >= CH - 1) || (y + h >= CH - 1 && w >= CW - 1) || (x + w >= CW - 1 && h >= CH - 1)
  const smalls = [], bigs = []
  for (const w of course.walls) (!outerWall(w) && Math.max(w[2], w[3]) <= 150 && Math.min(w[2], w[3]) >= 30 ? smalls : bigs).push(w)
  // 壁は場所のテーマごとにまとめて描く（長いコースは街並みが変わる）
  const wallTheme = w => (outerWall(w) ? course.theme : themeAt(w[1] + w[3] / 2))
  for (const th of new Set(bigs.map(wallTheme))) {
    const T = THEMES[th] || theme
    const list = bigs.filter(w => wallTheme(w) === th)
    const geo = new THREE.BoxGeometry(1, 1, 1)
    const body = new THREE.InstancedMesh(geo, cutaway(toon(T.wall)), list.length)
    const top = new THREE.InstancedMesh(geo, cutaway(toon(T.cap)), list.length)
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion()
    list.forEach(([x, y, w, h], i) => {
      const hh = outerWall([x, y, w, h]) ? T.wallH * 0.7 : T.wallH
      mtx.compose(v3((x + w / 2) * S, hh / 2, (y + h / 2) * S), q, v3(w * S, hh, h * S)); body.setMatrixAt(i, mtx)
      mtx.compose(v3((x + w / 2) * S, hh + 0.03, (y + h / 2) * S), q, v3(w * S + 0.04, 0.06, h * S + 0.04)); top.setMatrixAt(i, mtx)
    })
    body.castShadow = true; body.receiveShadow = true
    scene.add(body, top)
  }
  for (const [x, y, w, h] of smalls) scene.add(prop(themeAt(y + h / 2), (x + w / 2) * S, (y + h / 2) * S, w * S, h * S))

  function prop(themeName, cx, cz, w, d) {
    const g = new THREE.Group(); g.position.set(cx, 0, cz)
    const add = (mesh, y) => { mesh.position.y = y; mesh.castShadow = true; g.add(mesh); return mesh }
    if (themeName === 'snow') { // 雪だるま
      add(new THREE.Mesh(new THREE.SphereGeometry(w * 0.48, 16, 12), toon(0xffffff)), w * 0.42)
      add(new THREE.Mesh(new THREE.SphereGeometry(w * 0.34, 16, 12), toon(0xffffff)), w * 1.05)
      add(new THREE.Mesh(new THREE.CylinderGeometry(w * 0.2, w * 0.24, w * 0.3, 12), toon(0xd3312c)), w * 1.42)
      const nose = add(new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.16, 8), toon(0xff8a2a)), w * 1.08)
      nose.rotation.x = Math.PI / 2; nose.position.z = w * 0.34
    } else if (themeName === 'street') { // 車止め
      add(new THREE.Mesh(new THREE.CylinderGeometry(w * 0.32, w * 0.36, 0.7, 12), toon(0xffc83a)), 0.35)
      add(new THREE.Mesh(new THREE.CylinderGeometry(w * 0.33, w * 0.33, 0.08, 12), toon(0x222222)), 0.55)
    } else if (themeName === 'apartment') { // 鉢植え
      add(new THREE.Mesh(new THREE.CylinderGeometry(w * 0.42, w * 0.32, 0.4, 12), toon(0xd36d3a)), 0.2)
      add(new THREE.Mesh(new THREE.SphereGeometry(w * 0.5, 12, 10), toon(0x4fb14a)), 0.72)
    } else if (themeName === 'factory') { // 木箱
      add(new THREE.Mesh(new THREE.BoxGeometry(w, 0.8, d), cutaway(toon(0xffffff, { map: woodTexture() }))), 0.4)
    } else { // 柱
      add(new THREE.Mesh(new THREE.BoxGeometry(w, 1.6, d), cutaway(toon(0xc98d4f))), 0.8)
      add(new THREE.Mesh(new THREE.BoxGeometry(w * 1.15, 0.08, d * 1.15), cutaway(toon(0xe6b277))), 1.6)
    }
    return g
  }

  // ---- ゴール: 光る床、紅白の柱に GOAL の幕、旗、行き先ののれん
  {
    const [x, y, w, h] = course.goal
    const cx = (x + w / 2) * S, cz = (y + h / 2) * S, gw = w * S
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(gw, h * S), new THREE.MeshBasicMaterial({ color: 0x3ddc97, transparent: true, opacity: 0.38, depthWrite: false }))
    glow.rotation.x = -Math.PI / 2; glow.position.set(cx, 0.01, cz); scene.add(glow)
    const st = stripeTexture('#ffffff', '#d3312c', 3); st.repeat.set(1, 4)
    const postMat = toon(0xffffff, { map: st })
    const gz = y * S + 0.05
    for (const sx of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.6, 10), postMat); p.position.set(cx + sx * (gw / 2 + 0.05), 1.3, gz); p.castShadow = true; scene.add(p)
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.9, 6), toon(0x555555)); pole.position.set(cx + sx * (gw / 2 + 0.05), 3.05, gz); scene.add(pole)
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.28), toon(sx < 0 ? 0xffc83a : 0x3f9ff0, { side: THREE.DoubleSide })); flag.position.set(cx + sx * (gw / 2 + 0.05) + 0.23, 3.35, gz); flag.userData.flag = true; scene.add(flag)
    }
    const banner = new THREE.Mesh(new THREE.BoxGeometry(gw + 0.5, 0.55, 0.08), [toon(0xd3312c), toon(0xd3312c), toon(0xd3312c), toon(0xd3312c), new THREE.MeshBasicMaterial({ map: textTexture('GOAL', { bg: '#d3312c', fg: '#ffffff', font: '400 96px "Dela Gothic One", sans-serif', border: '#ffffff' }) }), toon(0xd3312c)])
    banner.position.set(cx, 2.55, gz); banner.castShadow = true; scene.add(banner)
    const noren = new THREE.Mesh(new THREE.PlaneGeometry(gw - 0.2, 0.55), new THREE.MeshLambertMaterial({ map: textTexture(course.goalLabel || 'ゴール', { bg: '#1f3f6b', fg: '#fff8ea' }), side: THREE.DoubleSide }))
    noren.position.set(cx, 1.98, gz + 0.02); scene.add(noren)
  }

  // 世界の北の外に建物の正面（街角）。横断歩道のコースはラーメン屋
  {
    const facade = new THREE.Group()
    const goalTheme = themeAt(course.goal[1])
    const col = { wood: 0xf0dcb8, street: 0xf3e3c3, snow: 0x9b6a3c, factory: 0x6a8296, apartment: 0xf0d2aa }[goalTheme] || 0xf0dcb8
    const wall = new THREE.Mesh(new THREE.BoxGeometry(W + 4, 4.2, 0.6), toon(col)); wall.position.set(W / 2, 2.1, -0.5); facade.add(wall)
    const roof = new THREE.Mesh(new THREE.BoxGeometry(W + 4.4, 0.35, 1.8), toon(goalTheme === 'snow' ? 0xffffff : 0xb5452d)); roof.position.set(W / 2, 4.3, -0.3); facade.add(roof)
    for (let i = 0; i < 6; i++) { const win = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.7), new THREE.MeshBasicMaterial({ color: 0xfff2c2 })); win.position.set(W / 2 - 3.75 + i * 1.5, 3.1, -0.19); facade.add(win) }
    if (goalTheme === 'street') {
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.8), new THREE.MeshBasicMaterial({ map: textTexture('ラーメン', { bg: '#d3312c', fg: '#fff8ea', border: '#fff8ea' }) }))
      sign.position.set(1.6, 2.1, -0.18); facade.add(sign)
    }
    scene.add(facade)
  }

  // ---- 壊れる飾り（コーン・タイヤ・小箱）。ぶつかると吹き飛ぶだけで、荷物は傷まず進路もふさがない（画面だけの演出）
  const breakables = []
  {
    const cone = () => { const g = new THREE.Group(); const c = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.4, 12), toon(0xff6a2b)); c.position.y = 0.22; c.castShadow = true; g.add(c); const b = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.04, 0.3), toon(0xff6a2b)); b.position.y = 0.02; g.add(b); const r = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.1, 0.07, 12), toon(0xffffff)); r.position.y = 0.24; g.add(r); return g }
    const tires = () => { const g = new THREE.Group(); for (let i = 0; i < 2 + (breakables.length % 2); i++) { const t = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.07, 8, 16), toon(0x2a2a2a)); t.rotation.x = Math.PI / 2; t.position.y = 0.07 + i * 0.14; t.castShadow = true; g.add(t) } return g }
    const box = () => { const g = new THREE.Group(); const b = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.26, 0.3), toon(0xd9a465)); b.position.y = 0.13; b.castShadow = true; g.add(b); const tp = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.005, 0.31), toon(0xead39c)); tp.position.y = 0.262; g.add(tp); return g }
    const makers = course.theme === 'snow' ? [cone, box] : [cone, tires, box]
    const free = (x, y, r) => {
      if (x < 40 + r || x > CW - 40 - r || y < 40 + r || y > CH - 40 - r) return false
      for (const [wx, wy, ww, wh] of course.walls) if (x > wx - r && x < wx + ww + r && y > wy - r && y < wy + wh + r) return false
      for (const [px, py, pw, ph] of course.pits) if (x > px - r && x < px + pw + r && y > py - r && y < py + ph + r) return false
      const [gx, gy, gw, gh] = course.goal
      if (x > gx - r && x < gx + gw + r && y > gy - r && y < gy + gh + r) return false
      return true
    }
    const path = course.path || []
    let k = 0
    for (let i = 1; i < path.length; i++) {
      const [ax, ay] = path[i - 1], [bx, by] = path[i]
      const L = Math.hypot(bx - ax, by - ay)
      if (L < 1) continue
      const nx = -(by - ay) / L, ny = (bx - ax) / L
      for (let s = 120; s < L; s += 260) {
        const side = k % 2 ? 1 : -1
        const off = 120 + (k * 37) % 50
        const x = ax + ((bx - ax) * s) / L + nx * off * side, y = ay + ((by - ay) * s) / L + ny * off * side
        k++
        if (!free(x, y, 25)) continue
        const g = makers[k % makers.length]()
        g.position.set(x * S, 0, y * S); g.rotation.y = k
        scene.add(g)
        breakables.push({ g, x, y, hit: false, vx: 0, vy: 0, vz: 0, spin: 0, py: 0 })
      }
    }
  }

  // ---- 動く障害物
  const movers = (course.movers || []).map(m => ({ m, obj: makeMover(m) }))
  movers.forEach(o => scene.add(o.obj))
  function makeMover(m) {
    const g = new THREE.Group()
    const w = m.w * S, d = m.h * S
    const add = (geo, mat, x, y, z) => { const me = new THREE.Mesh(geo, mat); me.position.set(x, y, z); me.castShadow = true; g.add(me); return me }
    if (m.kind === 'car') {
      const bodyM = add(new THREE.BoxGeometry(w, 0.42, d), toon(m.color), 0, 0.36, 0); outline(bodyM, 1.03)
      add(new THREE.BoxGeometry(w * 0.55, 0.34, d * 0.86), toon(0x1b2733), -w * 0.06, 0.74, 0)
      add(new THREE.BoxGeometry(w * 0.5, 0.05, d * 0.88), toon(m.color), -w * 0.06, 0.92, 0)
      const wheel = new THREE.CylinderGeometry(0.17, 0.17, 0.12, 12); const wm = toon(0x151515)
      for (const [x, z] of [[-w * 0.32, -d / 2], [w * 0.32, -d / 2], [-w * 0.32, d / 2], [w * 0.32, d / 2]]) { const wh = add(wheel, wm, x, 0.17, z); wh.rotation.x = Math.PI / 2 }
      const lamp = new THREE.MeshBasicMaterial({ color: 0xfff1b0 })
      add(new THREE.BoxGeometry(0.04, 0.1, 0.16), lamp, w / 2, 0.44, -d * 0.3); add(new THREE.BoxGeometry(0.04, 0.1, 0.16), lamp, w / 2, 0.44, d * 0.3)
    } else if (m.kind === 'bike') {
      const wheel = new THREE.TorusGeometry(0.16, 0.03, 6, 14)
      add(wheel, toon(0x222222), -w * 0.35, 0.16, 0); add(wheel, toon(0x222222), w * 0.35, 0.16, 0)
      add(new THREE.BoxGeometry(w * 0.8, 0.05, 0.05), toon(m.color), 0, 0.34, 0)
      add(new THREE.CylinderGeometry(0.12, 0.14, 0.4, 8), toon(m.color), 0, 0.6, 0)
      add(new THREE.SphereGeometry(0.15, 10, 8), toon(0xffd9b3), 0.03, 0.92, 0)
      add(new THREE.SphereGeometry(0.16, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), toon(0xffffff), 0.03, 0.95, 0)
    } else if (m.kind === 'plow') {
      const b = add(new THREE.BoxGeometry(w * 0.7, 0.6, d), toon(m.color), -w * 0.1, 0.4, 0); outline(b, 1.03)
      add(new THREE.BoxGeometry(w * 0.3, 0.45, d * 0.9), toon(0x1b2733), -w * 0.18, 0.92, 0)
      add(new THREE.BoxGeometry(0.1, 0.5, d * 1.3), toon(0xc9d2db), w * 0.42, 0.3, 0)
      add(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffa020 }), -w * 0.18, 1.2, 0).castShadow = false
    } else if (m.kind === 'piston') {
      const st = stripeTexture('#ffcc00', '#1b1b1b', 6); st.repeat.set(w / 0.6, 1)
      add(new THREE.BoxGeometry(w, 0.7, d), [toon(0x9aa3ad), toon(0x9aa3ad), toon(0xffffff, { map: st }), toon(0x9aa3ad), toon(0xffffff, { map: st }), toon(0x9aa3ad)], 0, 0.35, 0)
    } else if (m.kind === 'train') {
      const b = add(new THREE.BoxGeometry(w, 0.95, d), toon(m.color), 0, 0.6, 0); outline(b, 1.02)
      add(new THREE.BoxGeometry(w * 0.98, 0.12, d * 0.9), toon(0xe9e4d4), 0, 1.12, 0)
      const win = new THREE.MeshBasicMaterial({ color: 0xfff6d8 })
      for (let x = -w / 2 + 0.6; x < w / 2 - 0.5; x += 0.7) for (const sz of [-1, 1]) add(new THREE.BoxGeometry(0.42, 0.32, 0.02), win, x, 0.78, sz * (d / 2 + 0.005)).castShadow = false
      add(new THREE.BoxGeometry(0.05, 0.2, 0.3), new THREE.MeshBasicMaterial({ color: 0xffe9a0 }), w / 2, 0.55, 0)
      for (let x = -w / 2 + 0.5; x < w / 2; x += 1.2) for (const sz of [-1, 1]) { const wh = add(new THREE.CylinderGeometry(0.15, 0.15, 0.08, 10), toon(0x222222), x, 0.15, sz * d / 2); wh.rotation.x = Math.PI / 2 }
    } else if (m.kind === 'fork') {
      const b = add(new THREE.BoxGeometry(w * 0.7, 0.5, d), toon(m.color), -w * 0.12, 0.35, 0); outline(b, 1.03)
      add(new THREE.BoxGeometry(w * 0.3, 0.5, d * 0.8), toon(0x1b2733), -w * 0.18, 0.85, 0)
      add(new THREE.BoxGeometry(0.06, 1.3, d * 0.8), toon(0x444444), w * 0.25, 0.65, 0)
      for (const z of [-d * 0.25, d * 0.25]) add(new THREE.BoxGeometry(w * 0.32, 0.04, 0.08), toon(0x555555), w * 0.42, 0.08, z)
    } else if (m.kind === 'person') {
      const c = makeChibi(m.color, faceMats, 1)
      c.arms.forEach(a => { a.a.visible = false; a.glove.visible = false })
      g.add(c.g); g.userData.chibi = c
    }
    return g
  }

  // ---- ロングコースの仕掛け
  // 回るバー（紅白の棒と軸）
  const spinners = (course.spinners || []).map(sp => {
    const g = new THREE.Group(); g.position.set(sp.x * S, 0, sp.y * S)
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.9, 12), toon(0x3a3f47)); post.position.y = 0.45; post.castShadow = true; g.add(post)
    const st = stripeTexture('#ffffff', '#d3312c', 4); st.repeat.set(sp.len * S / 0.8, 1)
    const bar = new THREE.Mesh(new THREE.BoxGeometry(sp.len * S, 0.36, sp.thick * S), toon(0xffffff, { map: st })); bar.position.y = 0.55; bar.castShadow = true; g.add(bar)
    outline(bar, 1.03)
    scene.add(g); return { sp, g }
  })
  // 開け閉めの壁: 防火シャッターは上から下りる。踏切は棒が倒れる
  const gates = (course.gates || []).map(gt => {
    const [x, y, w, h] = gt.r
    const g = new THREE.Group(); g.position.set((x + w / 2) * S, 0, (y + h / 2) * S)
    let move
    if (gt.kind === 'crossing') {
      const st = stripeTexture('#ffffff', '#d3312c', 3); st.repeat.set(w * S / 0.8, 1)
      const arms = []
      for (const side of [-1, 1]) {
        const px = side * (w * S / 2 - 0.1)
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.6, 8), toon(0x2a2a2a)); pole.position.set(px, 0.8, 0); pole.castShadow = true; g.add(pole)
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), new THREE.MeshBasicMaterial({ color: 0x5a1a18 })); lamp.position.set(px, 1.5, 0.06); g.add(lamp)
        const pivot = new THREE.Group(); pivot.position.set(px, 0.85, 0); g.add(pivot)
        const arm = new THREE.Mesh(new THREE.BoxGeometry(w * S / 2 - 0.1, 0.14, 0.14), toon(0xffffff, { map: st })); arm.position.x = -side * (w * S / 4 - 0.05); arm.castShadow = true; pivot.add(arm)
        arms.push({ pivot, side, lamp })
      }
      move = (closed, k, now) => {
        for (const a of arms) {
          a.pivot.rotation.z = a.side * (1 - k) * (Math.PI / 2 - 0.05) * -1
          a.lamp.material.color.set(closed && Math.floor(now / 300) % 2 ? 0xff3b30 : 0x5a1a18)
        }
      }
    } else {
      const sh = new THREE.Mesh(new THREE.BoxGeometry(w * S, 1.3, h * S), toon(0x8a939d)); sh.castShadow = true; g.add(sh)
      for (const side of [-1, 1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.2, h * S + 0.1), toon(0x4b525b)); post.position.set(side * (w * S / 2 + 0.06), 1.1, 0); g.add(post) }
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(w * S + 0.24, 0.3, h * S + 0.2), toon(0x4b525b)); lintel.position.y = 2.2; g.add(lintel)
      move = (closed, k) => { sh.position.y = 0.65 + (1 - k) * 1.5; sh.scale.y = 1 }
    }
    scene.add(g); return { gt, g, move, k: 0 }
  })
  // 落ちてくる荷物（影で予告 → 落ちる → 跳ねて消える）
  const drops = (course.drops || []).map(d => {
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(d.r * S, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthWrite: false }))
    shadow.rotation.x = -Math.PI / 2; shadow.position.set(d.x * S, 0.02, d.y * S); scene.add(shadow)
    const ring = new THREE.Mesh(new THREE.RingGeometry(d.r * S - 0.05, d.r * S, 32), new THREE.MeshBasicMaterial({ color: 0xd3312c, transparent: true, opacity: 0, depthWrite: false }))
    ring.rotation.x = -Math.PI / 2; ring.position.set(d.x * S, 0.025, d.y * S); scene.add(ring)
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.6, 0.75), toon(0xffffff, { map: woodTexture() })); box.castShadow = true; box.visible = false; scene.add(box)
    // クレーンのフック（上に吊ってある）
    const hook = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 3, 6), toon(0x333333)); hook.position.set(d.x * S, 6.5, d.y * S); scene.add(hook)
    return { d, shadow, ring, box }
  })
  // 動く床（いかだ）
  const rafts = (course.platforms || []).map(pf => {
    const g = new THREE.Group()
    const n = Math.round(pf.h / 40)
    for (let i = 0; i < n; i++) { const pl = new THREE.Mesh(new THREE.BoxGeometry(pf.w * S, 0.12, (pf.h / n) * S - 0.03), toon(i % 2 ? 0x9b6a3c : 0xb07a46)); pl.position.set(0, -0.06, (-pf.h / 2 + (i + 0.5) * pf.h / n) * S); pl.receiveShadow = true; g.add(pl) }
    for (const sx of [-1, 1]) { const log = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, pf.h * S, 10), toon(0x6b4524)); log.rotation.x = Math.PI / 2; log.position.set(sx * (pf.w * S / 2 - 0.05), -0.12, 0); g.add(log) }
    scene.add(g); return { pf, g }
  })
  // 崩れる床（吹き抜けの上の古い板）
  const planks = (course.crumbles || []).map(q => {
    const [x, y, w, h] = q.r
    const m = new THREE.Mesh(new THREE.BoxGeometry(w * S - 0.04, 0.08, h * S - 0.04), toon(0xc49a64))
    m.position.set((x + w / 2) * S, -0.04, (y + h / 2) * S); m.receiveShadow = true; scene.add(m)
    return { m, base: m.position.clone(), st: '0', t: 0 }
  })
  // チェックポイントの旗（通ると緑になる）
  const cpFlags = (course.checkpoints || []).map(c => {
    const [x, y, w, h] = c.r
    const flags = []
    for (const fx of [x + 30, x + w - 30]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.2, 8), toon(0x2a2119)); pole.position.set(fx * S, 1.1, (y + h / 2) * S); pole.castShadow = true; scene.add(pole)
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.45), toon(0xffc83a, { side: THREE.DoubleSide })); flag.position.set(fx * S + (fx < x + w / 2 ? 0.36 : -0.36), 1.95, (y + h / 2) * S); flag.userData.flag = true; scene.add(flag)
      flags.push(flag)
    }
    return flags
  })
  // 送風機（左の壁の扇風機と、風の筋）
  const fans = [], streaks = []
  for (const z of course.zones || []) {
    if (z.type !== 'wind') continue
    const [x, y, w, h] = z.r
    for (let yy = y + 60; yy < y + h; yy += 120) {
      const g = new THREE.Group(); g.position.set((x + 10) * S, 0.55, yy * S); g.rotation.z = -Math.PI / 2
      const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.2, 18, 1, true), toon(0x5d636c, { side: THREE.DoubleSide })); g.add(housing)
      const blades = new THREE.Group(); g.add(blades)
      for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.04, 0.14), toon(0xffcc00)); b.rotation.y = (i * Math.PI * 2) / 3; blades.add(b) }
      scene.add(g); fans.push({ z, blades })
    }
    const N = 24
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.02, 0.03), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.0, depthWrite: false }), N)
    im.frustumCulled = false; scene.add(im)
    streaks.push({ z, im, N, seed: Array.from({ length: N }, (_, i) => [((i * 37) % 100) / 100, ((i * 61) % 100) / 100, 0.2 + ((i * 13) % 10) / 20]) })
  }

  // ---- 荷物
  const cargoGroup = new THREE.Group(); scene.add(cargoGroup)
  const cargoInner = new THREE.Group(); cargoGroup.add(cargoInner)
  const fish = []
  let cargoTop = 0.6
  buildCargo()
  function buildCargo() {
    const w = cargo.w * S, d = cargo.h * S
    const add = (geo, mat, x, y, z, ol = false) => { const me = new THREE.Mesh(geo, mat); me.position.set(x, y, z); me.castShadow = true; me.receiveShadow = true; cargoInner.add(me); if (ol) outline(me, 1.03); return me }
    if (cargo === CARGOS.crate) {
      const hgt = 0.82
      const wood = toon(0xffffff, { map: woodTexture() })
      add(new THREE.BoxGeometry(w, hgt, d), wood, 0, hgt / 2 + 0.06, 0, true)
      // 枠（縁の角材）と金具
      const frame = toon(0x8a5a2e), metal = toon(0x3a3f47)
      for (const sy of [0.08, hgt + 0.04]) for (const sz of [-1, 1]) add(new THREE.BoxGeometry(w + 0.03, 0.07, 0.07), frame, 0, sy, sz * d / 2)
      for (const sy of [0.08, hgt + 0.04]) for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.07, 0.07, d + 0.03), frame, sx * w / 2, sy, 0)
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(new THREE.BoxGeometry(0.07, hgt, 0.07), frame, sx * w / 2, hgt / 2 + 0.06, sz * d / 2)
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const sy of [0.12, hgt]) add(new THREE.BoxGeometry(0.13, 0.13, 0.13), metal, sx * (w / 2 - 0.02), sy, sz * (d / 2 - 0.02))
      // 運ぶための帯
      for (const sx of [-0.28, 0.28]) add(new THREE.BoxGeometry(0.1, hgt + 0.02, d + 0.02), metal, sx * w, hgt / 2 + 0.06, 0)
      // 取扱注意のラベル（上の面）
      const label = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.34, d * 0.3), new THREE.MeshBasicMaterial({ map: textTexture('取扱注意', { bg: '#fff8ea', fg: '#d3312c', border: '#d3312c', w: 256, h: 128 }) }))
      label.rotation.x = -Math.PI / 2; label.rotation.z = Math.PI / 2; label.position.set(0, hgt + 0.065, 0); cargoInner.add(label)
      // 下の台（パレット）
      add(new THREE.BoxGeometry(w * 0.95, 0.06, d * 0.95), toon(0x6b4524), 0, 0.03, 0)
      cargoTop = hgt + 0.09
    } else if (cargo === CARGOS.tank) {
      add(new THREE.BoxGeometry(w, 0.08, d), toon(0x2f3b44), 0, 0.2, 0, true)
      add(new THREE.BoxGeometry(w * 0.96, 0.46, d * 0.94), new THREE.MeshPhongMaterial({ color: 0x4aa3c7, transparent: true, opacity: 0.55, shininess: 100, specular: 0xffffff, depthWrite: false }), 0, 0.47, 0).castShadow = false
      add(new THREE.BoxGeometry(w, 0.05, d), toon(0x2f3b44), 0, 0.72, 0)
      add(new THREE.BoxGeometry(w * 0.9, 0.06, d * 0.88), toon(0xd9c79a), 0, 0.27, 0)
      for (let i = 0; i < 4; i++) add(new THREE.ConeGeometry(0.04, 0.3, 5), toon(0x3f9a4a), -w * 0.35 + i * 0.07, 0.42, -d * 0.25 + (i % 2) * 0.1).castShadow = false
      for (const c of [0xff9a4d, 0xff6b9a]) {
        const f = new THREE.Group()
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), toon(c)); b.scale.set(1.4, 0.8, 0.7); f.add(b)
        const t = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.1, 6), toon(c)); t.rotation.z = Math.PI / 2; t.position.x = -0.12; f.add(t)
        cargoInner.add(f); fish.push(f)
      }
      cargoTop = 0.75
    } else if (cargo === CARGOS.piano) {
      add(new THREE.BoxGeometry(w, 0.95, d * 0.62), toon(0x1d2026), 0, 0.55, -d * 0.19, true)
      add(new THREE.BoxGeometry(w, 0.1, d * 0.4), toon(0x1d2026), 0, 0.68, d * 0.3)
      add(new THREE.BoxGeometry(w * 0.92, 0.03, d * 0.18), toon(0xf4f1ea), 0, 0.74, d * 0.22)
      const keys = new THREE.InstancedMesh(new THREE.BoxGeometry(0.03, 0.03, d * 0.1), toon(0x111111), 14)
      const mtx = new THREE.Matrix4()
      for (let i = 0; i < 14; i++) { mtx.makeTranslation(-w * 0.42 + i * (w * 0.84 / 13), 0.765, d * 0.18); keys.setMatrixAt(i, mtx) }
      cargoInner.add(keys)
      for (const [x, z] of [[-w * 0.42, d * 0.36], [w * 0.42, d * 0.36], [-w * 0.42, -d * 0.4], [w * 0.42, -d * 0.4]]) add(new THREE.CylinderGeometry(0.04, 0.04, 0.12, 8), toon(0xc9a24a), x, 0.06, z)
      cargoTop = 1.05
    } else if (cargo === CARGOS.mattress) {
      add(new THREE.BoxGeometry(w, 0.24, d), toon(0xe9e4f5), 0, 0.2, 0, true)
      const st = new THREE.InstancedMesh(new THREE.BoxGeometry(0.02, 0.02, d * 0.9), toon(0xb9aed6), 7)
      const mtx = new THREE.Matrix4()
      for (let i = 0; i < 7; i++) { mtx.makeTranslation(-w * 0.42 + i * (w * 0.84 / 6), 0.325, 0); st.setMatrixAt(i, mtx) }
      cargoInner.add(st)
      add(new THREE.BoxGeometry(w * 1.01, 0.04, d * 1.01), toon(0x9b8fc4), 0, 0.09, 0)
      cargoTop = 0.34
    } else {
      add(new THREE.BoxGeometry(w, 0.32, d), toon(0x8f3626), 0, 0.22, 0, true)
      add(new THREE.BoxGeometry(w * 0.86, 0.12, d * 0.62), toon(0xc8553d), 0, 0.43, d * 0.12)
      add(new THREE.BoxGeometry(w, 0.42, d * 0.24), toon(0xa5402d), 0, 0.55, -d * 0.38)
      for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.12, 0.3, d), toon(0xa5402d), sx * (w / 2 - 0.06), 0.5, 0)
      for (const x of [-w * 0.21, w * 0.21]) add(new THREE.BoxGeometry(w * 0.4, 0.04, d * 0.5), toon(0xd76a52), x, 0.5, d * 0.12)
      cargoTop = 0.62
    }
    // 前の印（どっちが前か）
    const tri = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.18, 3), new THREE.MeshBasicMaterial({ color: 0xffffff }))
    tri.rotation.z = -Math.PI / 2; tri.position.set(w / 2 - 0.12, cargoTop + 0.04, 0)
    cargoInner.add(tri)
  }
  // ひび（耐久が減るほど濃く）
  const crackTex = canvasTex(256, 256, g => {
    g.strokeStyle = 'rgba(20,10,5,1)'; g.lineWidth = 5; g.lineCap = 'round'
    let s = 7; const r = () => { s = (s * 9301 + 49297) % 233280; return s / 233280 }
    for (let k = 0; k < 7; k++) { let x = r() * 256, y = r() * 256; g.beginPath(); g.moveTo(x, y); for (let i = 0; i < 5; i++) { x += (r() - 0.5) * 80; y += (r() - 0.5) * 80; g.lineTo(x, y) } g.stroke() }
  })
  const cracks = new THREE.Mesh(new THREE.PlaneGeometry(cargo.w * S * 0.95, cargo.h * S * 0.95), new THREE.MeshBasicMaterial({ map: crackTex, transparent: true, opacity: 0, depthWrite: false }))
  cracks.rotation.x = -Math.PI / 2
  cracks.position.y = cargoTop + 0.01
  cargoInner.add(cracks)
  // 重心の印（真ん中が穴に入ると落ちる）
  const center = new THREE.Mesh(new THREE.RingGeometry(0.07, 0.11, 20), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.9 }))
  center.rotation.x = -Math.PI / 2; center.renderOrder = 5; scene.add(center)

  // ---- 運び手
  const offs = handleOffsets(cargo, n)
  const carriers = offs.map((_, i) => {
    const c = makeChibi(PLAYER_COLORS[i], faceMats, i % 3)
    c.g.scale.setScalar(CHIBI)
    scene.add(c.g)
    // 荷物の手前に立つ人は半透明にする（荷物の向きが見えるように）
    c.mats = []
    c.g.traverse(o => { if (o.isMesh && o.material !== INK && !c.mats.includes(o.material) && !o.material.transparent) c.mats.push(o.material) })
    c.outlines = []
    c.g.traverse(o => { if (o.isMesh && o.material === INK) c.outlines.push(o) })
    c.ghost = false
    // 押す向きの矢印（床に寝かせる）
    const shape = new THREE.Shape(); shape.moveTo(0, -0.05); shape.lineTo(0.3, -0.05); shape.lineTo(0.3, -0.12); shape.lineTo(0.48, 0); shape.lineTo(0.3, 0.12); shape.lineTo(0.3, 0.05); shape.lineTo(0, 0.05)
    const arrow = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: i === me ? 0xffffff : PLAYER_COLORS[i], transparent: true, opacity: 0.95, depthWrite: false }))
    arrow.rotation.x = -Math.PI / 2; arrow.renderOrder = 3; scene.add(arrow)
    c.arrow = arrow
    if (i === me) { // 自分の足もとの輪
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.24, 0.31, 28), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false }))
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.015; c.g.add(ring); c.ring = ring
    }
    return c
  })

  // 進む向きの案内（荷物の先の床に出る矢印）
  const guide = (() => {
    const shape = new THREE.Shape(); shape.moveTo(-0.24, -0.26); shape.lineTo(0.26, 0); shape.lineTo(-0.24, 0.26); shape.lineTo(-0.1, 0)
    const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: 0x3ddc97, transparent: true, opacity: 0.85, depthWrite: false }))
    m.rotation.x = -Math.PI / 2; m.renderOrder = 3; scene.add(m); return m
  })()

  // ---- 粒（破片・紙吹雪）と雪
  const MAXP = 160
  const pmesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.08, 0.05), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), MAXP)
  pmesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  pmesh.frustumCulled = false
  scene.add(pmesh)
  const parts = []
  const dummy = new THREE.Object3D(), tmpCol = new THREE.Color()
  for (let i = 0; i < MAXP; i++) pmesh.setColorAt(i, tmpCol.set(0xffffff))
  let snow = null
  const hasSnow = (course.regions || [{ theme: course.theme }]).some(r => r.theme === 'snow')
  if (hasSnow) {
    const N = 500, pos = new Float32Array(N * 3)
    for (let i = 0; i < N; i++) { pos[i * 3] = Math.random() * 16 - 8; pos[i * 3 + 1] = Math.random() * 9; pos[i * 3 + 2] = Math.random() * 16 - 8 }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    snow = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 0.07, transparent: true, opacity: 0.9, depthWrite: false }))
    snow.frustumCulled = false
    scene.add(snow)
  }

  // ---- カメラ: 荷物の南（手前）の低い所から、北（奥）を見る。進む向きが手前なら高く上がる
  const cam = { x: course.start.x * S, z: course.start.y * S, zoom: 1, far: false, tilt: 36, ax: 0, az: -1 }
  let aspect = 1
  const target = new THREE.Vector3()
  let snapCam = false
  function placeCamera(px, pz, dirx, dirz, dt) {
    const k = snapCam ? 1 : 1 - Math.pow(0.002, dt)
    snapCam = false
    cam.x += (px - cam.x) * k; cam.z += (pz - cam.z) * k
    cam.zoom += ((cam.far ? 1.4 : 1) - cam.zoom) * k
    // 手前（南）へ進む区間ほど高い所から見下ろす
    const south = Math.max(0, dirz)
    const want = 38 + south * 28 + (cam.far ? 10 : 0)
    cam.tilt += (want - cam.tilt) * (1 - Math.pow(0.05, dt))
    cam.ax += (dirx - cam.ax) * k; cam.az += (dirz - cam.az) * k
    const tilt = cam.tilt * Math.PI / 180
    const tv = Math.tan(camera.fov * Math.PI / 360), th = tv * aspect
    let L = Math.max(2.3 / th, 3.3 / tv)
    L = Math.max(6.2, Math.min(11, L)) * cam.zoom
    // 見る点は荷物より少し先（奥へ進むときは奥、手前へ戻るときは手前）
    const ahead = 1.4
    const tx = Math.max(1.2, Math.min(W - 1.2, cam.x + cam.ax * ahead)), tz = Math.max(0.5, Math.min(H, cam.z + cam.az * ahead))
    target.set(tx, 0.4, tz)
    camera.position.set(tx, 0.4 + Math.sin(tilt) * L, tz + Math.cos(tilt) * L)
    camera.lookAt(target)
    scene.fog.near = L * 1.6; scene.fog.far = L * 5
    sun.position.set(tx + 4, 10, tz + 2); sun.target.position.set(tx, 0, tz - 1)
    if (skyMesh) skyMesh.position.set(camera.position.x, 0, camera.position.z)
    // 手前の壁を切る範囲（荷物の位置と、カメラまでの奥行き）
    cutU.value.set(cam.x, Math.cos(tilt) * L - 0.3, cam.z)
  }

  function setTier(t) {
    tier = Math.max(0, Math.min(2, t))
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, [1, 1.5, 2][tier]))
    renderer.shadowMap.enabled = tier > 0
    sun.castShadow = tier > 0
    const ms = tier === 2 ? 1024 : 512
    if (sun.shadow.mapSize.x !== ms) { sun.shadow.mapSize.set(ms, ms); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null } }
    if (snow) snow.visible = tier > 0
  }
  setTier(tier)

  let sizeW = 0, sizeH = 0
  const fpsLog = []
  let lastTierCheck = performance.now() + 3000
  const tmpV = new THREE.Vector3()
  let knocked = 0

  function project(x, y, z) {
    tmpV.set(x, y, z).project(camera)
    return { x: (tmpV.x * 0.5 + 0.5) * sizeW, y: (-tmpV.y * 0.5 + 0.5) * sizeH, behind: tmpV.z > 1 }
  }

  // 荷物の先にある通り道の点（案内の矢印とカメラの向き）
  function nextPathPoint(x, y) {
    const path = course.path || [[course.goal[0] + course.goal[2] / 2, course.goal[1] + course.goal[3] / 2]]
    let best = Infinity, bi = 0
    for (let i = 0; i < path.length - 1; i++) {
      const [ax, ay] = path[i], [bx, by] = path[i + 1]
      const L2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1
      const k = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / L2))
      const d = Math.hypot(ax + (bx - ax) * k - x, ay + (by - ay) * k - y)
      if (d < best) { best = d; bi = i }
    }
    for (let i = bi + 1; i < path.length; i++) if (Math.hypot(path[i][0] - x, path[i][1] - y) > 60) return path[i]
    return path[path.length - 1]
  }

  const api = {
    is3d: true,
    get tier() { return tier },
    // 吹き飛ばした飾りの数（音を鳴らす合図）
    get knocked() { return knocked },
    toggleZoom() { cam.far = !cam.far; return cam.far },
    setSize(w, h) {
      if (w === sizeW && h === sizeH) return
      sizeW = w; sizeH = h; aspect = w / Math.max(1, h)
      renderer.setSize(w, h, false)
      camera.aspect = aspect; camera.updateProjectionMatrix()
    },
    burst(x, y, color, count) {
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2, v = 1 + Math.random() * 2.5
        parts.push({ x: x * S, y: 0.5, z: y * S, vx: Math.cos(a) * v, vy: 2 + Math.random() * 2, vz: Math.sin(a) * v, life: 0.9, age: 0, col: new THREE.Color(color), spin: Math.random() * 10 })
      }
    },
    confetti(x, y) {
      for (let i = 0; i < 90; i++) {
        const a = Math.random() * Math.PI * 2, v = 0.5 + Math.random() * 2.5
        parts.push({ x: x * S, y: 1, z: y * S, vx: Math.cos(a) * v, vy: 3 + Math.random() * 4, vz: Math.sin(a) * v, life: 2.4, age: 0, col: new THREE.Color(PLAYER_COLORS[i % 8]), spin: Math.random() * 12, conf: true })
      }
    },
    // 1フレーム分: p={x,y,a,gt} 荷物、g=サーバーの view
    respawned() { snapCam = true },
    frame({ p, g, now, dt, walk, speed, doneAt, fallAt }) {
      fpsLog.push(dt); if (fpsLog.length > 90) fpsLog.shift()
      if (now > lastTierCheck && fpsLog.length >= 60) {
        lastTierCheck = now + 2500
        const fps = fpsLog.length / fpsLog.reduce((a, b) => a + b, 0)
        if (fps < 42 && tier > 0) setTier(tier - 1)
      }
      const t = now / 1000
      const cx = p.x * S, cz = p.y * S
      // 荷物
      cargoGroup.position.set(cx, 0, cz)
      cargoGroup.rotation.y = -p.a
      let lift = 0
      if (g.dr && fallAt) { const e = (now - fallAt) / 1000; lift = -Math.min(3, e * e * 4); cargoInner.rotation.z = Math.min(0.6, e * 0.8) }
      else if (g.done === 'goal' && doneAt) { const e = (now - doneAt) / 1000; lift = Math.abs(Math.sin(e * 6)) * 0.18 * Math.max(0, 1 - e) }
      else if (g.done === 'broken' && doneAt) { const e = (now - doneAt) / 1000; cargoInner.scale.set(1 + e * 0.15, Math.max(0.35, 1 - e * 0.6), 1 + e * 0.15) }
      else { cargoInner.rotation.z = 0; cargoInner.scale.set(1, 1, 1) }
      const pushing = g.hs.some(h => h[3] && Math.hypot(h[1], h[2]) > 0.2)
      cargoGroup.position.y = lift + (pushing && !g.done ? 0.07 + Math.sin(t * 9) * 0.015 : 0)
      cracks.material.opacity = Math.max(0, Math.min(0.9, (1 - g.hp / cargo.hp - 0.15) * 1.4))
      for (let i = 0; i < fish.length; i++) {
        const sp = g.hp < cargo.hp * 0.4 ? 6 : 1.6
        const f = fish[i], ph = t * sp + i * 2
        f.position.set(Math.cos(ph) * cargo.w * S * 0.3, 0.45 + Math.sin(ph * 1.7) * 0.06, Math.sin(ph) * cargo.h * S * 0.22)
        f.rotation.y = -ph - Math.PI / 2
      }
      center.position.set(cx, cargoTop + 0.02 + cargoGroup.position.y, cz)
      center.visible = !g.dr
      // 運び手
      const c = Math.cos(p.a), s = Math.sin(p.a)
      const hw = cargo.w / 2, hh = cargo.h / 2
      const labels = []
      const hop = g.done === 'goal' && doneAt ? (now - doneAt) / 160 : 0
      const carrierPts = []
      for (let i = 0; i < carriers.length; i++) {
        const ch = carriers[i]
        const [lx, ly] = offs[i]
        let ox = 0, oy = 0
        if (Math.abs(lx) >= hw - 0.5) ox = Math.sign(lx)
        if (Math.abs(ly) >= hh - 0.5) oy = Math.sign(ly)
        const ol = Math.hypot(ox, oy) || 1
        const px = lx + (ox / ol) * 34, py = ly + (oy / ol) * 34
        const wx = (p.x + px * c - py * s) * S, wz = (p.y + px * s + py * c) * S
        const hx = (p.x + lx * c - ly * s) * S, hz = (p.y + lx * s + ly * c) * S
        carrierPts.push([wx / S, wz / S])
        const h = g.hs[i] || [null, 0, 0, 0]
        const on = h[3] === 1
        const ux = h[1], uy = h[2], um = Math.hypot(ux, uy)
        const jump = g.done === 'goal' ? Math.abs(Math.sin(hop + i)) * 0.4 : 0
        const fallDrop = g.dr ? cargoGroup.position.y * 0.15 : 0
        ch.g.position.set(wx, jump + fallDrop, wz)
        // 体は荷物の方を向く（持っているので）。押している向きに少し傾ける
        const yaw = Math.atan2(hx - wx, hz - wz)
        ch.body.rotation.y = yaw
        ch.body.rotation.z = um > 0.1 ? Math.max(-0.25, Math.min(0.25, ux * 0.18)) : 0
        ch.body.rotation.x = um > 0.1 ? Math.max(-0.25, Math.min(0.25, uy * 0.18)) : 0
        const sw = Math.sin(walk + i * 1.7) * Math.min(1, speed / 40) * 0.8
        ch.legs[0].rotation.x = sw; ch.legs[1].rotation.x = -sw
        // 腕2本: 肩から持ち手の左右へ
        const sideX = Math.cos(yaw), sideZ = -Math.sin(yaw)
        ch.arms.forEach((a, k) => {
          const sd = k ? 1 : -1
          const sx0 = wx + sideX * 0.12 * CHIBI * sd, sy0 = ch.g.position.y + 0.42 * CHIBI, sz0 = wz + sideZ * 0.12 * CHIBI * sd
          const ex = hx + sideX * 0.1 * sd, ey = cargoGroup.position.y + Math.min(cargoTop, 0.55), ez = hz + sideZ * 0.1 * sd
          const dx = ex - sx0, dy = ey - sy0, dz = ez - sz0, len = Math.hypot(dx, dy, dz) || 0.01
          a.a.position.set(((sx0 + ex) / 2 - wx) / CHIBI, ((sy0 + ey) / 2 - ch.g.position.y) / CHIBI, ((sz0 + ez) / 2 - wz) / CHIBI)
          a.a.scale.set(1, len / CHIBI, 1)
          a.a.quaternion.setFromUnitVectors(v3(0, 1, 0), v3(dx / len, dy / len, dz / len))
          a.glove.position.set((ex - wx) / CHIBI, (ey - ch.g.position.y) / CHIBI, (ez - wz) / CHIBI)
          const vis = !g.done || g.done === 'goal'
          a.a.visible = vis; a.glove.visible = vis
        })
        if (g.done === 'goal') ch.arms.forEach((a, k) => { a.a.visible = false; a.glove.position.set((k ? 0.22 : -0.22), 1.05, 0); a.glove.visible = true })
        // 顔は頭の前（カメラ側）に置く
        tmpV.copy(camera.position).sub(v3(wx, 0.66 * CHIBI + ch.g.position.y, wz)).normalize().multiplyScalar(0.25)
        ch.face.position.set(tmpV.x, 0.66 + tmpV.y, tmpV.z)
        let face = 'calm'
        if (g.done === 'goal') face = 'happy'
        else if (g.done) face = 'shock'
        else if (on && um > 0.5 && speed < 25) face = 'strain'
        else if (on && um > 0.5) face = 'shout'
        else if (g.hp < cargo.hp * 0.35) face = 'worry'
        ch.face.material = faceMats[face]
        ch.torso.material.color.set(on ? PLAYER_COLORS[i] : 0x888888)
        const ar = ch.arrow
        ar.visible = on && um > 0.05 && !g.done
        if (ar.visible) {
          ar.position.set(wx + (ux / um) * 0.22, 0.03, wz + (uy / um) * 0.22)
          ar.rotation.z = -Math.atan2(uy, ux)
          const k = 0.75 + um * 0.85; ar.scale.set(k, 1, 1)
        }
        if (ch.ring) ch.ring.material.opacity = 0.6 + Math.sin(t * 5) * 0.3
        const ghost = wz > cz + 0.25 && Math.abs(wx - cx) < 0.9 && !g.done
        if (ghost !== ch.ghost) {
          ch.ghost = ghost
          for (const m of ch.mats) { m.transparent = ghost; m.opacity = ghost ? 0.45 : 1; m.depthWrite = !ghost; m.needsUpdate = true }
          for (const o of ch.outlines) o.visible = !ghost
        }
        const head = project(wx, ch.g.position.y + 1.05 * CHIBI, wz)
        labels.push({ i, x: head.x, y: head.y, on })
      }
      // 動く障害物
      for (const o of movers) {
        const q = moverAt(o.m, p.gt || 0)
        o.obj.position.set(q.x * S, 0, q.y * S)
        if (o.m.kind === 'person') {
          const ch = o.obj.userData.chibi
          ch.body.rotation.y = Math.atan2(q.vx, q.vy)
          const sw = Math.sin(q.x * 0.08) * 0.6; ch.legs[0].rotation.x = sw; ch.legs[1].rotation.x = -sw
          tmpV.copy(camera.position).sub(v3(q.x * S, 0.66, q.y * S)).normalize().multiplyScalar(0.25)
          ch.face.position.set(tmpV.x, 0.66 + tmpV.y, tmpV.z)
        } else if (o.m.kind !== 'piston') {
          o.obj.rotation.y = Math.abs(q.vx) > 1 ? (q.vx > 0 ? 0 : Math.PI) : o.obj.rotation.y
        }
      }
      // 壊れる飾り: 荷物か運び手が近づいたら吹き飛ぶ
      const R = Math.hypot(cargo.w, cargo.h) / 2
      for (const b of breakables) {
        if (!b.hit) {
          let dx = b.x - p.x, dy = b.y - p.y, d = Math.hypot(dx, dy)
          let near = d < R + 18
          if (!near) for (const [qx, qy] of carrierPts) { if (Math.hypot(b.x - qx, b.y - qy) < 34) { near = true; dx = b.x - qx; dy = b.y - qy; d = Math.hypot(dx, dy); break } }
          if (near && !g.done) {
            b.hit = true; knocked++
            const v = 2.6 + Math.random() * 1.5
            b.vx = (dx / (d || 1)) * v; b.vz = (dy / (d || 1)) * v; b.vy = 3 + Math.random() * 1.5; b.spin = (Math.random() - 0.5) * 14
          }
        } else if (b.vy !== 0 || b.g.position.y > 0) {
          b.vy -= 9.8 * dt
          b.g.position.x += b.vx * dt; b.g.position.z += b.vz * dt; b.g.position.y = Math.max(0, b.g.position.y + b.vy * dt)
          b.g.rotation.x += b.spin * dt; b.g.rotation.z += b.spin * 0.7 * dt
          if (b.g.position.y <= 0 && b.vy < 0) { b.vy = Math.abs(b.vy) > 1.5 ? -b.vy * 0.3 : 0; b.vx *= 0.6; b.vz *= 0.6; b.spin *= 0.5; if (b.vy === 0) { b.g.rotation.x = Math.PI / 2; b.g.position.y = 0.12 } }
        }
      }
      for (const b of belts) b.t.offset.x = -(t * b.speed) % 1
      // ロングコースの仕掛け
      const gt = p.gt || 0
      for (const q of spinners) q.g.rotation.y = -spinnerBox(q.sp, gt).a
      const gs = g.gs || ''
      gates.forEach((q, i) => { const closed = gs[i] === '1'; q.k += ((closed ? 1 : 0) - q.k) * Math.min(1, dt * 5); q.move(closed, q.k, now) })
      for (const q of drops) {
        const st = dropState(q.d, gt)
        const warn = st.until < q.d.warn ? 1 - st.until / q.d.warn : 0
        q.shadow.material.opacity = warn * 0.45; q.shadow.scale.setScalar(0.5 + warn * 0.5)
        q.ring.material.opacity = warn > 0 ? 0.5 + Math.sin(now / 90) * 0.4 : 0
        if (st.until < 0.6) { q.box.visible = true; q.box.position.set(q.d.x * S, 0.3 + (st.until / 0.6) ** 2 * 6, q.d.y * S); q.box.rotation.set(0, st.until * 3, 0) }
        else if (st.since < 1.1) { q.box.visible = true; const e = st.since; q.box.position.set(q.d.x * S + e * 0.9, 0.3 + Math.abs(Math.sin(e * 6)) * 0.35 * (1 - e) - Math.max(0, e - 0.7) * 1.5, q.d.y * S); q.box.rotation.set(0, 0, -e * 2) }
        else q.box.visible = false
      }
      for (const q of rafts) { const r = moverAt(q.pf, gt); q.g.position.set(r.x * S, Math.sin(now / 500) * 0.02, r.y * S) }
      const cr = g.cr || ''
      planks.forEach((q, i) => {
        const st = cr[i] || '0'
        if (st !== q.st) { q.st = st; q.t = 0 }
        q.t += dt
        if (st === '0') { q.m.visible = true; q.m.position.copy(q.base); q.m.rotation.set(0, 0, 0) }
        else if (st === '1') { q.m.visible = true; q.m.position.set(q.base.x + (Math.random() - 0.5) * 0.03, q.base.y, q.base.z + (Math.random() - 0.5) * 0.03); q.m.material.color.set(0xa8865a) }
        else { q.m.position.y = q.base.y - q.t * q.t * 6; q.m.rotation.x = q.t * 2; q.m.visible = q.t < 1 }
        if (st === '0') q.m.material.color.set(0xc49a64)
      })
      cpFlags.forEach((fl, i) => { for (const f of fl) f.material.color.set(i <= g.cp ? 0x1f9a5c : 0xffc83a) })
      for (const f of fans) f.blades.rotation.y += dt * (2 + windPower(f.z, gt) * 22)
      for (const sk of streaks) {
        const k = windPower(sk.z, gt)
        sk.im.material.opacity = k * 0.7
        const [zx, zy, zw, zh] = sk.z.r
        sk.seed.forEach(([a, b, sp], i) => {
          const u = (a + t * sp * (0.5 + k)) % 1
          dummy.position.set((zx + u * zw) * S, 0.3 + b * 0.8, (zy + b * zh) * S); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix()
          sk.im.setMatrixAt(i, dummy.matrix)
        })
        sk.im.instanceMatrix.needsUpdate = true
      }
      updateChunks(p.y)
      scene.traverse(o => { if (o.userData.flag) o.rotation.y = Math.sin(t * 3 + o.position.x) * 0.4 })
      // 案内の矢印
      const np = nextPathPoint(p.x, p.y)
      const gdx = np[0] - p.x, gdy = np[1] - p.y, gl = Math.hypot(gdx, gdy) || 1
      const RG = R + 80
      guide.visible = !g.done && gl > 40
      guide.position.set((p.x + (gdx / gl) * RG) * S, 0.03, (p.y + (gdy / gl) * RG) * S)
      guide.rotation.z = -Math.atan2(gdy, gdx)
      guide.material.opacity = 0.55 + Math.sin(t * 4) * 0.3
      // 粒
      let k = 0
      for (const q of parts) {
        q.age += dt
        q.vy -= 9 * dt
        if (q.conf) { q.vx *= 0.98; q.vz *= 0.98; if (q.vy < -1.2) q.vy = -1.2 }
        q.x += q.vx * dt; q.y = Math.max(0.02, q.y + q.vy * dt); q.z += q.vz * dt
        if (q.y <= 0.02) { q.vx *= 0.8; q.vz *= 0.8 }
      }
      for (let i = parts.length - 1; i >= 0; i--) if (parts[i].age > parts[i].life) parts.splice(i, 1)
      if (parts.length > MAXP) parts.splice(0, parts.length - MAXP)
      for (const q of parts) {
        dummy.position.set(q.x, q.y, q.z); dummy.rotation.set(q.age * q.spin, q.age * q.spin * 0.7, 0)
        const sc = q.conf ? 1.3 : 1; dummy.scale.set(sc, sc, sc); dummy.updateMatrix()
        pmesh.setMatrixAt(k, dummy.matrix); pmesh.setColorAt(k, q.col); k++
      }
      pmesh.count = k
      pmesh.instanceMatrix.needsUpdate = true; if (pmesh.instanceColor) pmesh.instanceColor.needsUpdate = true
      if (snow) snow.visible = tier > 0 && themeAt(p.y) === 'snow'
      if (snow && snow.visible) {
        const arr = snow.geometry.attributes.position.array
        for (let i = 0; i < arr.length; i += 3) {
          arr[i + 1] -= dt * (0.8 + (i % 7) * 0.1); arr[i] += Math.sin(t + i) * dt * 0.2
          if (arr[i + 1] < 0) arr[i + 1] += 9
        }
        snow.geometry.attributes.position.needsUpdate = true
        snow.position.set(cam.x, 0, cam.z - 2)
      }
      placeCamera(cx, cz, gdx / gl, gdy / gl, dt)
      renderer.render(scene, camera)
      const goal = course.goal
      return { labels, goal: project((goal[0] + goal[2] / 2) * S, 1, (goal[1] + goal[3] / 2) * S), cargoScreen: project(cx, cargoTop + 0.6, cz) }
    },
    // 描けているかの確認用: いまの画面の輝度の分散
    variance() {
      renderer.render(scene, camera)
      const gl = renderer.getContext()
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight
      const px = new Uint8Array(4)
      let s1 = 0, s2 = 0, nn = 0
      for (let yy = 4; yy < h; yy += Math.max(1, h / 24 | 0)) for (let xx = 4; xx < w; xx += Math.max(1, w / 24 | 0)) {
        gl.readPixels(xx, yy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
        const l = px[0] * 0.3 + px[1] * 0.59 + px[2] * 0.11; s1 += l; s2 += l * l; nn++
      }
      return s2 / nn - (s1 / nn) ** 2
    },
    fps() { return fpsLog.length ? fpsLog.length / fpsLog.reduce((a, b) => a + b, 0) : 0 },
    dispose() {
      scene.traverse(o => { if (o.geometry) o.geometry.dispose(); const m = o.material; if (m) (Array.isArray(m) ? m : [m]).forEach(x => { if (x.map) x.map.dispose(); x.dispose() }) })
      renderer.dispose()
    }
  }
  placeCamera(cam.x, cam.z, 0, -1, 1)
  return api
}
