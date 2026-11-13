import * as THREE from 'three';
import './style.css';
import { createCourse } from './course.js';
import { createWorld } from './world.js';
import { Runner } from './runner.js';
import { RaceSim, makeRng, startGrid } from './race.js';
import { createConfetti } from './confetti.js';
import { sfx, unlockAudio, setMuted, isMuted } from './audio.js';

const MAX_PLAYERS = 30;
const COLORS = [
  '#e63946', '#3a86ff', '#ffbe0b', '#2a9d8f', '#8338ec', '#fb5607', '#06d6a0', '#ff006e',
  '#118ab2', '#9ef01a', '#f15bb5', '#4361ee', '#e76f51', '#00b4d8', '#b5179e', '#80b918',
  '#ff8fab', '#7209b7', '#f4a261', '#0096c7', '#d00000', '#38b000', '#ffd60a', '#5e60ce',
  '#ef476f', '#43aa8b', '#f9844a', '#577590', '#c77dff', '#90be6d',
];
const DEFAULT_NAMES = ['철수', '영희', '민수', '지은', '현우', '수아'];

const $ = (id) => document.getElementById(id);
const ui = {
  setup: $('setup'), names: $('names'), nameCount: $('nameCount'), nameError: $('nameError'),
  winCount: $('winCount'), winMinus: $('winMinus'), winPlus: $('winPlus'), startBtn: $('startBtn'),
  hud: $('hud'), hudMode: $('hudMode'), hudTime: $('hudTime'), progressBar: $('progressBar'), rankList: $('rankList'),
  feed: $('feed'), countdown: $('countdown'), slowmo: $('slowmo'), minimap: $('minimap'),
  result: $('result'), resultEyebrow: $('resultEyebrow'), winnerNames: $('winnerNames'), resultList: $('resultList'),
  againBtn: $('againBtn'), editBtn: $('editBtn'), soundBtn: $('soundBtn'),
};

// ───────── 설정 ─────────
const settings = { mode: 'first', winners: 1, length: 400 };
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 저장 불가 환경 */ } },
};

function parseNames(text) {
  const raw = text.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
  const seen = new Map();
  return raw.map((n) => {
    const name = n.slice(0, 12);
    const c = (seen.get(name) || 0) + 1;
    seen.set(name, c);
    return c > 1 ? `${name}${c}` : name;
  });
}

// ───────── 렌더러 / 씬 / 코스 ─────────
const canvas = $('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2000);
const course = createCourse();
const world = createWorld(scene, course);
const confetti = createConfetti(scene);
const halfW = course.halfW;

const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();
const wantPos = new THREE.Vector3();
const wantLook = new THREE.Vector3();

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = camera.aspect < 0.8 ? 66 : 50;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ───────── 게임 상태 ─────────
let phase = 'setup'; // setup | countdown | race | result
let names = [];
let runners = [];
let sim = null;
let grid = [];
let startD = course.finishD - settings.length;
let decided = null;
let resultTimer = 0;
let timeScale = 1;
let excitement = 0;
let lastHud = 0;
let clockT = 0;
const P = {}; // course.point 결과 재사용

/** 코스 좌표 → 월드 좌표 */
function cp(d, lat, up, out = new THREE.Vector3()) {
  course.point(d, lat, P);
  return out.set(P.x, P.y + up, P.z);
}

function buildRunners(list) {
  runners.forEach((r) => { scene.remove(r.root); r.dispose(); });
  const rng = makeRng();
  runners = list.map((name, i) => {
    const r = new Runner({ name, color: COLORS[i % COLORS.length], index: i, rng });
    scene.add(r.root);
    return r;
  });
  placeOnGrid(startGrid(list.length, halfW, () => 0.999)); // 미리보기: 입력 순서대로
}

function placeOnGrid(g) {
  grid = g;
  runners.forEach((r, i) => {
    r.crown.visible = false;
    setRunnerPos(r, startD + g[i].dist, g[i].lat);
  });
}

function setRunnerPos(r, d, lat) {
  course.point(d, lat, P);
  r.root.position.set(P.x, P.y + 0.03, P.z);
  r.root.rotation.y = P.heading;
  return P;
}

function setLength(len) {
  settings.length = len;
  startD = course.finishD - len;
  world.setStart(startD);
  drawMinimapBase();
  camMode = { type: 'setup', until: Infinity, cut: true };
  if (runners.length) placeOnGrid(grid.length === runners.length ? grid : startGrid(runners.length, halfW, () => 0.999));
}

// ───────── 미니맵 ─────────
const mm = { ctx: ui.minimap.getContext('2d'), base: document.createElement('canvas'), scale: 1, ox: 0, oz: 0 };
function drawMinimapBase() {
  const W = ui.minimap.width, H = ui.minimap.height;
  mm.base.width = W; mm.base.height = H;
  const c = mm.base.getContext('2d');
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let d = startD - 5; d <= course.finishD + 10; d += 2) {
    course.point(d, 0, P);
    minX = Math.min(minX, P.x); maxX = Math.max(maxX, P.x); minZ = Math.min(minZ, P.z); maxZ = Math.max(maxZ, P.z);
  }
  const pad = 14;
  mm.scale = Math.min((W - pad * 2) / (maxX - minX), (H - pad * 2) / (maxZ - minZ));
  mm.ox = W / 2 - ((minX + maxX) / 2) * mm.scale;
  mm.oz = H / 2 - ((minZ + maxZ) / 2) * mm.scale;
  c.clearRect(0, 0, W, H);
  // 강
  c.strokeStyle = 'rgba(80,160,230,0.55)'; c.lineWidth = 5; c.beginPath();
  course.river.forEach(([x, z], i) => { const X = x * mm.scale + mm.ox, Z = z * mm.scale + mm.oz; i ? c.lineTo(X, Z) : c.moveTo(X, Z); });
  c.stroke();
  // 코스
  c.lineCap = 'round'; c.lineJoin = 'round';
  for (const [w, col] of [[7, 'rgba(255,255,255,0.18)'], [3.5, '#e2553a']]) {
    c.strokeStyle = col; c.lineWidth = w; c.beginPath();
    for (let d = startD; d <= course.finishD; d += 2) {
      course.point(d, 0, P);
      const X = P.x * mm.scale + mm.ox, Z = P.z * mm.scale + mm.oz;
      d === startD ? c.moveTo(X, Z) : c.lineTo(X, Z);
    }
    c.stroke();
  }
  const mark = (d, col) => {
    course.point(d, 0, P);
    c.fillStyle = col; c.strokeStyle = '#0d1830'; c.lineWidth = 2;
    c.beginPath(); c.arc(P.x * mm.scale + mm.ox, P.z * mm.scale + mm.oz, 5, 0, Math.PI * 2); c.fill(); c.stroke();
  };
  mark(startD, '#ffffff');
  mark(course.finishD, '#ffcf3f');
}
function drawMinimap() {
  const c = mm.ctx;
  c.clearRect(0, 0, ui.minimap.width, ui.minimap.height);
  c.drawImage(mm.base, 0, 0);
  if (!sim) return;
  // 뒤에서부터 그려서 선두가 위에 보이게
  [...sim.runners].sort((a, b) => a.dist - b.dist).forEach((p) => {
    course.point(startD + p.dist, p.lat, P);
    c.fillStyle = runners[p.i].color;
    c.strokeStyle = decided && decided.winners.has(p.i) ? '#ffcf3f' : '#0d1830';
    c.lineWidth = 1.5;
    c.beginPath(); c.arc(P.x * mm.scale + mm.ox, P.z * mm.scale + mm.oz, 3.6, 0, Math.PI * 2); c.fill(); c.stroke();
  });
}

// ───────── 설정 화면 ─────────
let rebuildTimer = 0;
function onNamesChanged() {
  const list = parseNames(ui.names.value);
  ui.nameCount.textContent = `${list.length}명`;
  ui.nameError.hidden = true;
  clampWinners(list.length);
  store.set('rr-names', ui.names.value);
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => {
    const show = list.slice(0, MAX_PLAYERS);
    if (show.length && show.join('\n') !== names.join('\n')) {
      names = show;
      buildRunners(names);
    }
  }, 250);
}

function clampWinners(n) {
  const max = Math.max(1, n - 1);
  settings.winners = Math.min(Math.max(1, settings.winners), max);
  ui.winCount.max = String(max);
  ui.winCount.value = String(settings.winners);
}

ui.names.value = store.get('rr-names') ?? DEFAULT_NAMES.join('\n');
ui.names.addEventListener('input', onNamesChanged);
ui.winMinus.addEventListener('click', () => { settings.winners--; clampWinners(parseNames(ui.names.value).length); });
ui.winPlus.addEventListener('click', () => { settings.winners++; clampWinners(parseNames(ui.names.value).length); });
ui.winCount.addEventListener('change', () => { settings.winners = parseInt(ui.winCount.value, 10) || 1; clampWinners(parseNames(ui.names.value).length); });

document.querySelectorAll('.seg-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    btn.parentElement.querySelectorAll('.seg-btn').forEach((b) => { b.classList.toggle('on', b === btn); b.setAttribute('aria-checked', String(b === btn)); });
    if (btn.dataset.mode) settings.mode = btn.dataset.mode;
    if (btn.dataset.len) setLength(Number(btn.dataset.len));
  });
});

ui.soundBtn.addEventListener('click', () => {
  setMuted(!isMuted());
  ui.soundBtn.textContent = isMuted() ? '🔇' : '🔊';
});

ui.startBtn.addEventListener('click', () => {
  const list = parseNames(ui.names.value);
  if (list.length < 2) { showError('참가자를 2명 이상 입력해 주세요.'); return; }
  if (list.length > MAX_PLAYERS) { showError(`참가자는 최대 ${MAX_PLAYERS}명까지 가능해요.`); return; }
  unlockAudio();
  clearTimeout(rebuildTimer);
  if (list.join('\n') !== names.join('\n')) { names = list; buildRunners(names); }
  startRace();
});
ui.againBtn.addEventListener('click', () => { unlockAudio(); startRace(); });
ui.editBtn.addEventListener('click', () => {
  ui.result.hidden = true;
  ui.hud.hidden = true;
  ui.minimap.hidden = true;
  ui.setup.hidden = false;
  confetti.stop();
  sim = null;
  decided = null;
  placeOnGrid(startGrid(runners.length, halfW, () => 0.999));
  phase = 'setup';
});

function showError(msg) { ui.nameError.textContent = msg; ui.nameError.hidden = false; }

// ───────── 레이스 진행 ─────────
function startRace() {
  confetti.stop();
  const rng = makeRng();
  placeOnGrid(startGrid(runners.length, halfW, rng));
  sim = new RaceSim(runners.length, settings.length, rng, {
    halfW,
    grid,
    slopeAt: (d) => course.slope(startD + d),
    curvAt: (d) => { course.point(startD + d, 0, P); return P.curv; },
  });
  decided = null;
  resultTimer = 0;
  timeScale = 1;
  camMode = null;
  ui.setup.hidden = true;
  ui.result.hidden = true;
  ui.hud.hidden = false;
  ui.minimap.hidden = false;
  ui.feed.innerHTML = '';
  const k = settings.winners;
  ui.hudMode.textContent = settings.mode === 'first' ? `🥇 1등 ${k}명` : `🐢 꼴등 ${k}명`;
  ui.hudTime.textContent = '0.00s';
  ui.progressBar.style.width = '0%';
  buildRankRows();
  drawMinimap();
  phase = 'countdown';
  runCountdown();
}

function runCountdown() {
  const steps = ['3', '2', '1', 'GO!'];
  let i = 0;
  const tick = () => {
    if (phase !== 'countdown') return;
    const s = steps[i];
    ui.countdown.hidden = false;
    ui.countdown.textContent = s;
    ui.countdown.classList.remove('pop', 'go');
    void ui.countdown.offsetWidth;
    ui.countdown.classList.add('pop');
    if (s === 'GO!') {
      ui.countdown.classList.add('go');
      sfx.go();
      phase = 'race';
      setTimeout(() => { ui.countdown.hidden = true; }, 800);
      return;
    }
    sfx.beep();
    i++;
    setTimeout(tick, 800);
  };
  setTimeout(tick, 500);
}

function feed(text) {
  const el = document.createElement('div');
  el.className = 'feed-item';
  el.textContent = text;
  ui.feed.prepend(el);
  while (ui.feed.children.length > 4) ui.feed.lastChild.remove();
  setTimeout(() => el.remove(), 2700);
}

function checkDecision() {
  const n = runners.length, k = settings.winners;
  const need = settings.mode === 'first' ? k : n - k;
  if (sim.finishedCount < need) return;
  const rank = sim.ranking();
  const winners = settings.mode === 'first' ? rank.slice(0, k) : rank.slice(n - k);
  decided = { winners: new Set(winners.map((p) => p.i)), rank };
  winners.forEach((p) => { runners[p.i].crown.visible = true; });
  ui.slowmo.hidden = true;
  sfx.fanfare();
  course.point(course.finishD, 0, P);
  confetti.burst(new THREE.Vector3(P.x, P.y, P.z), P.heading, halfW * 2);
  resultTimer = 1.8;
}

/** 당첨이 갈리는 두 선수가 결승선 근처에서 접전인가? */
function needSlowmo() {
  if (decided) return false;
  const n = runners.length, k = settings.winners;
  const need = (settings.mode === 'first' ? k : n - k) - sim.finishedCount;
  const open = sim.runners.filter((p) => !p.finished).sort((a, b) => b.dist - a.dist);
  const a = open[need - 1], b = open[need];
  if (!a || !b) return false;
  return a.dist > settings.length - 7 && a.dist - b.dist < 1.3;
}

function showResult() {
  phase = 'result';
  ui.hud.hidden = true;
  ui.feed.innerHTML = '';
  decided.rank = sim.ranking(); // 결정 이후 골인한 선수 기록까지 반영
  const winners = decided.rank.filter((p) => decided.winners.has(p.i));
  ui.resultEyebrow.textContent = settings.mode === 'first' ? `🥇 1등 당첨 · ${winners.length}명` : `🐢 꼴등 당첨 · ${winners.length}명`;
  ui.winnerNames.innerHTML = '';
  winners.forEach((p) => {
    const el = document.createElement('div');
    el.className = 'winner-name';
    el.innerHTML = `<span class="dot" style="background:${runners[p.i].color}"></span><span></span>`;
    el.lastChild.textContent = runners[p.i].name;
    ui.winnerNames.append(el);
  });
  ui.resultList.innerHTML = '';
  decided.rank.forEach((p, idx) => {
    const li = document.createElement('li');
    if (decided.winners.has(p.i)) li.classList.add('win');
    const time = p.finished ? `${p.finishTime.toFixed(2)}s` : `-${(settings.length - p.dist).toFixed(1)}m`;
    li.innerHTML = `<span class="pos">${idx + 1}</span><span class="dot" style="background:${runners[p.i].color}"></span><span class="nm"></span><span class="tm">${time}</span>`;
    li.querySelector('.nm').textContent = runners[p.i].name + (decided.winners.has(p.i) ? ' 👑' : '');
    ui.resultList.append(li);
  });
  ui.result.hidden = false;
}

// ───────── 순위 HUD ─────────
let rowEls = [];
function buildRankRows() {
  ui.rankList.innerHTML = '';
  const n = runners.length;
  const mobile = window.innerWidth <= 640;
  const rowH = mobile ? (n > 10 ? 15 : 19) : (n > 16 ? 19 : 26);
  ui.rankList.style.height = `${n * rowH}px`;
  ui.rankList.classList.toggle('dense', rowH < 20);
  rowEls = runners.map((r) => {
    const li = document.createElement('li');
    li.className = 'rank-row';
    li.style.height = `${rowH}px`;
    li.innerHTML = `<span class="pos"></span><span class="dot" style="background:${r.color}"></span><span class="nm"></span><span class="st"></span>`;
    li.querySelector('.nm').textContent = r.name;
    ui.rankList.append(li);
    return { li, pos: li.querySelector('.pos'), st: li.querySelector('.st'), rowH };
  });
}

function updateHud() {
  const rank = sim.ranking();
  const n = runners.length, k = settings.winners;
  const leadDist = rank.find((p) => !p.finished)?.dist ?? settings.length;
  rank.forEach((p, idx) => {
    const row = rowEls[p.i];
    row.li.style.transform = `translateY(${idx * row.rowH}px)`;
    row.pos.textContent = idx + 1;
    const hot = settings.mode === 'first' ? idx < k : idx >= n - k;
    row.li.classList.toggle('hot', decided ? decided.winners.has(p.i) : hot);
    row.li.classList.toggle('done', p.finished);
    row.li.classList.toggle('fall', p.fallT >= 0);
    row.li.classList.toggle('boost', p.boostT > 0);
    let st;
    if (p.finished) st = `${p.finishTime.toFixed(2)}s`;
    else if (p.fallT >= 0) st = '꽈당!';
    else if (p.boostT > 0) st = '부스터';
    else if (idx === sim.finishedCount) st = `${Math.max(0, settings.length - p.dist).toFixed(0)}m 남음`;
    else st = `-${(leadDist - p.dist).toFixed(1)}m`;
    row.st.textContent = st;
  });
  ui.hudTime.textContent = `${sim.time.toFixed(2)}s`;
  const maxDist = Math.max(...sim.runners.map((p) => p.dist));
  ui.progressBar.style.width = `${Math.min(100, Math.max(0, maxDist / settings.length) * 100)}%`;
}

// ───────── 카메라 ─────────
// 중계방송처럼 여러 앵글을 몇 초마다 컷 전환한다.
const CAM_MODES = ['chase', 'side', 'aerial', 'front', 'low', 'chase'];
let camMode = null; // { type, until }
const camRight = new THREE.Vector3();

function pickCam(type) {
  if (!type) {
    const pool = CAM_MODES.filter((m) => !camMode || m !== camMode.type);
    type = pool[Math.floor(Math.random() * pool.length)];
  }
  camMode = { type, until: clockT + 4.5 + Math.random() * 3, cut: true };
}

/** 피사체가 화면 한쪽에 오도록 시선을 옆으로 민다 (amount>0: 피사체가 왼쪽에) */
function shiftLook(amount) {
  camRight.subVectors(wantLook, wantPos).setY(0).normalize();
  camRight.set(-camRight.z, 0, camRight.x);
  wantLook.addScaledVector(camRight, amount);
}

function packFocus() {
  const open = sim.runners.filter((p) => !p.finished);
  const pool = open.length ? open : sim.runners;
  let lead = -Infinity, back = Infinity, sum = 0, latSum = 0;
  pool.forEach((p) => { lead = Math.max(lead, p.dist); back = Math.min(back, p.dist); sum += p.dist; latSum += p.lat; });
  const mean = sum / pool.length;
  const w = settings.mode === 'first' ? 0.65 : 0.35;
  const focus = Math.min(settings.length + 8, lead * w + mean * (1 - w));
  return { focus: startD + focus, lead: startD + lead, spread: Math.min(25, lead - back), lat: (latSum / pool.length) * 0.5 };
}

function updateCamera(dt) {
  const portrait = camera.aspect < 0.8;
  let rate = 3.5;

  if (phase === 'setup' || !sim) {
    const t = clockT * 0.2;
    const n = runners.length;
    cp(startD + 7 + n * 0.12 + Math.sin(t) * 2, Math.sin(t * 0.7) * halfW * 0.8, 2.6 + n * 0.08, wantPos);
    cp(startD - 1.5 - Math.floor(n / 11) * 0.7, 0, 1, wantLook);
    if (portrait) wantLook.y -= 5; else shiftLook(-3.2);
    rate = 2;
  } else if (phase === 'countdown') {
    cp(startD + 6, -halfW * 0.5, 1.7, wantPos);
    cp(startD - 1, 0, 1.1, wantLook);
    if (portrait) wantLook.y -= 0.6;
    rate = 2.5;
  } else if (decided) {
    // 당첨자들을 정면에서
    const ws = sim.runners.filter((p) => decided.winners.has(p.i));
    let d = 0, lat = 0, dMin = Infinity, dMax = -Infinity;
    ws.forEach((p) => { d += p.dist; lat += p.lat; dMin = Math.min(dMin, p.dist); dMax = Math.max(dMax, p.dist); });
    d = startD + d / ws.length; lat /= ws.length;
    const spread = Math.min(30, dMax - dMin) + (ws.length > 1 ? 3 : 0);
    const back = 6 + spread * (portrait ? 1.1 : 0.7);
    // 골인 후 감속하며 앞으로 오므로, 멈출 지점보다 앞에 카메라를 둔다
    const camD = Math.max(d + back, startD + settings.length + 34);
    cp(camD, lat + 3 + spread * 0.3, 2.2 + spread * 0.25, wantPos);
    cp(d - spread * 0.2, lat, 1.2, wantLook);
    if (portrait) wantLook.y -= back * 0.45; else shiftLook(back * 0.3);
    rate = 1.8;
  } else {
    const f = packFocus();
    const nearFinish = f.lead > course.finishD - 32 && f.lead < course.finishD + 1;
    if (nearFinish && (!camMode || camMode.type !== 'finish')) pickCam('finish');
    else if (!nearFinish && (!camMode || camMode.type === 'finish' || clockT > camMode.until)) pickCam(camMode ? null : 'chase');

    course.point(f.focus, 0, P);
    const side = P.curv > 0.004 ? 1 : P.curv < -0.004 ? -1 : 1; // 커브 바깥쪽
    const s = f.spread;
    switch (camMode.type) {
      case 'chase':
        cp(f.focus - 10 - s * 0.45, f.lat * 0.5 + (portrait ? 0 : 1.5), 4.2 + s * 0.15, wantPos);
        cp(f.focus + 7, f.lat * 0.5, 0.8, wantLook);
        break;
      case 'low':
        cp(f.focus - 5 - s * 0.3, f.lat + halfW * 0.55, 1.3, wantPos);
        cp(f.focus + 4, f.lat, 1.3, wantLook);
        break;
      case 'side':
        cp(f.focus - 1, side * (halfW + 7 + s * 0.35), 3 + s * 0.1, wantPos);
        cp(f.focus + 1.5, 0, 0.9, wantLook);
        break;
      case 'aerial':
        cp(f.focus - 14 - s * 0.3, -side * 12, 17 + s * 0.4, wantPos);
        cp(f.focus + 5, 0, 0, wantLook);
        break;
      case 'front':
        cp(f.focus + 11 + s * 0.2, f.lat * 0.5 - 1.5, 2.3 + s * 0.1, wantPos);
        cp(f.focus - 2, f.lat * 0.5, 1.1, wantLook);
        break;
      case 'finish':
        cp(course.finishD + 9, halfW * 0.85, 2.5, wantPos);
        cp(Math.min(f.focus, course.finishD) - 3, 0, 1, wantLook);
        break;
    }
    rate = 4.5;
  }

  // 지면 아래로 내려가지 않게
  const g = world.groundAt(wantPos.x, wantPos.z) + 0.8;
  if (wantPos.y < g) wantPos.y = g;

  if (camMode && camMode.cut) {
    camPos.copy(wantPos); camLook.copy(wantLook);
    camMode.cut = false;
  } else {
    const a = 1 - Math.exp(-dt * rate);
    camPos.lerp(wantPos, a);
    camLook.lerp(wantLook, a);
  }
  camera.position.copy(camPos);
  camera.lookAt(camLook);

  world.sun.target.position.copy(camLook);
  world.sun.position.set(camLook.x - 25, camLook.y + 45, camLook.z + 30);
}

// ───────── 메인 루프 ─────────
const clock = new THREE.Clock();
let lastMini = 0;
function loop() {
  requestAnimationFrame(loop);
  const rawDt = Math.min(0.05, clock.getDelta());
  clockT += rawDt;

  if (sim && (phase === 'race' || phase === 'result')) {
    const slow = needSlowmo();
    ui.slowmo.hidden = !slow || phase !== 'race';
    timeScale += ((slow ? 0.3 : 1) - timeScale) * Math.min(1, rawDt * 6);
    const dt = rawDt * timeScale;
    const events = sim.step(dt);
    for (const e of events) {
      const r = runners[e.i];
      if (e.type === 'boost') { feed(`⚡ ${r.name} 부스터!`); sfx.boost(); }
      if (e.type === 'fall') { feed(`💥 ${r.name} 꽈당!`); sfx.fall(); }
      if (e.type === 'finish') { feed(`🏁 ${r.name} ${e.place}위 골인`); sfx.finish(); }
    }
    if (!decided && events.some((e) => e.type === 'finish')) checkDecision();
    if (decided && phase === 'race') {
      resultTimer -= rawDt;
      if (resultTimer <= 0) showResult();
    }

    sim.runners.forEach((p) => {
      const r = runners[p.i];
      const pt = setRunnerPos(r, startD + p.dist, p.lat);
      const won = decided && decided.winners.has(p.i);
      const state = p.v > 0.5 ? 'run' : won ? 'celebrate' : 'idle';
      r.animate(dt, { state, speed: p.v, fall: sim.fallAmount(p), boost: p.boostT > 0, time: clockT, curv: pt.curv });
    });
    if (phase === 'race' && clockT - lastHud > 0.1) { lastHud = clockT; updateHud(); }
    if (clockT - lastMini > 0.066) { lastMini = clockT; drawMinimap(); }

    const lead = Math.max(...sim.runners.map((p) => p.dist));
    const target = decided ? 1 : Math.max(0.15, Math.min(1, (lead / settings.length) ** 2));
    excitement += (target - excitement) * Math.min(1, rawDt * 2);
    confetti.update(rawDt);
  } else {
    const state = phase === 'countdown' ? 'ready' : 'idle';
    runners.forEach((r) => r.animate(rawDt, { state, time: clockT }));
    excitement += (0.1 - excitement) * Math.min(1, rawDt * 2);
  }

  runners.forEach((r) => r.fitLabel(camera.position));
  world.update(rawDt, excitement, camera);
  updateCamera(rawDt);
  renderer.render(scene, camera);
}

// 첫 화면: 예시 참가자들이 출발선에 서 있는 상태
setLength(settings.length);
onNamesChanged();
names = parseNames(ui.names.value).slice(0, MAX_PLAYERS);
clearTimeout(rebuildTimer);
if (names.length) buildRunners(names);
updateCamera(1);
camPos.copy(wantPos); camLook.copy(wantLook);
loop();

// 웹폰트가 늦게 도착하면 이름표를 다시 그린다
document.fonts?.ready.then(() => { if (phase === 'setup' && names.length) buildRunners(names); });
