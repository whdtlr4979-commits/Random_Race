import * as THREE from 'three';
import './style.css';
import { createEnvironment, createTrack, laneZ } from './world.js';
import { Runner } from './runner.js';
import { RaceSim, makeRng } from './race.js';
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
  feed: $('feed'), countdown: $('countdown'), slowmo: $('slowmo'),
  result: $('result'), resultEyebrow: $('resultEyebrow'), winnerNames: $('winnerNames'), resultList: $('resultList'),
  againBtn: $('againBtn'), editBtn: $('editBtn'), soundBtn: $('soundBtn'),
};

// ───────── 설정 상태 ─────────
const settings = { mode: 'first', winners: 1, length: 100 };
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

// ───────── 렌더러 / 씬 ─────────
const canvas = $('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1500);
const env = createEnvironment(scene);
const confetti = createConfetti(scene);

const camPos = new THREE.Vector3(-10, 6, 16);
const camLook = new THREE.Vector3(0, 1, 0);
const wantPos = new THREE.Vector3();
const wantLook = new THREE.Vector3();
camera.position.copy(camPos);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // 세로 화면에서는 시야를 넓혀 트랙이 잘리지 않게
  camera.fov = camera.aspect < 0.8 ? 68 : 50;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ───────── 게임 상태 ─────────
let phase = 'setup'; // setup | countdown | race | result
let names = [];
let track = null;
let runners = [];
let sim = null;
let decided = null;    // 당첨자 확정 정보
let resultTimer = 0;
let timeScale = 1;
let excitement = 0;
let lastHud = 0;
let clockT = 0;

function buildField(list) {
  track?.dispose();
  runners.forEach((r) => { scene.remove(r.root); r.dispose(); });
  const rng = makeRng();
  track = createTrack(scene, { lanes: list.length, length: settings.length });
  runners = list.map((name, i) => {
    const r = new Runner({ name, color: COLORS[i % COLORS.length], index: i, z: laneZ(i, list.length), rng });
    scene.add(r.root);
    return r;
  });
}

function resetRunners() {
  runners.forEach((r) => {
    r.x = 0;
    r.crown.visible = false;
    r.fallAmount = 0;
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
      buildField(names);
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
    const group = btn.parentElement;
    group.querySelectorAll('.seg-btn').forEach((b) => { b.classList.toggle('on', b === btn); b.setAttribute('aria-checked', String(b === btn)); });
    if (btn.dataset.mode) settings.mode = btn.dataset.mode;
    if (btn.dataset.len) {
      settings.length = Number(btn.dataset.len);
      if (names.length) buildField(names);
    }
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
  if (list.join('\n') !== names.join('\n')) { names = list; buildField(names); }
  startRace();
});
ui.againBtn.addEventListener('click', () => { unlockAudio(); startRace(); });
ui.editBtn.addEventListener('click', () => {
  ui.result.hidden = true;
  ui.hud.hidden = true;
  ui.setup.hidden = false;
  confetti.stop();
  resetRunners();
  phase = 'setup';
});

function showError(msg) { ui.nameError.textContent = msg; ui.nameError.hidden = false; }

// ───────── 레이스 진행 ─────────
function startRace() {
  resetRunners();
  confetti.stop();
  sim = new RaceSim(runners.length, settings.length, makeRng());
  decided = null;
  resultTimer = 0;
  timeScale = 1;
  ui.setup.hidden = true;
  ui.result.hidden = true;
  ui.hud.hidden = false;
  ui.feed.innerHTML = '';
  const k = settings.winners;
  ui.hudMode.textContent = settings.mode === 'first' ? `🥇 1등 ${k}명` : `🐢 꼴등 ${k}명`;
  ui.hudTime.textContent = '0.00s';
  ui.progressBar.style.width = '0%';
  buildRankRows();
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
    void ui.countdown.offsetWidth; // 애니메이션 재시작
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
  setTimeout(tick, 400);
}

function feed(text) {
  const el = document.createElement('div');
  el.className = 'feed-item';
  el.textContent = text;
  ui.feed.prepend(el);
  while (ui.feed.children.length > 4) ui.feed.lastChild.remove();
  setTimeout(() => el.remove(), 2700);
}

/** 당첨 결정 여부 판단 */
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
  confetti.burst(settings.length, track.width);
  resultTimer = 1.8;
}

/** 지금 접전이라 슬로모션이 필요한가? */
function needSlowmo() {
  if (decided) return false;
  const n = runners.length, k = settings.winners;
  const need = (settings.mode === 'first' ? k : n - k) - sim.finishedCount;
  const open = sim.runners.filter((p) => !p.finished).sort((a, b) => b.dist - a.dist);
  const a = open[need - 1], b = open[need];
  if (!a || !b) return false;
  return a.dist > settings.length - 6 && a.dist - b.dist < 1.3;
}

function showResult() {
  phase = 'result';
  ui.hud.hidden = true;
  ui.feed.innerHTML = '';
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
    else if (idx === sim.finishedCount) st = sim.finishedCount ? `-${(settings.length - p.dist).toFixed(1)}m` : '선두';
    else st = `-${(leadDist - p.dist).toFixed(1)}m`;
    row.st.textContent = st;
  });
  ui.hudTime.textContent = `${sim.time.toFixed(2)}s`;
  const maxDist = Math.max(...sim.runners.map((p) => p.dist));
  ui.progressBar.style.width = `${Math.min(100, (maxDist / settings.length) * 100)}%`;
}

// ───────── 카메라 ─────────
function updateCamera(dt) {
  const W = track ? track.width : 9;
  const L = settings.length;
  const portrait = camera.aspect < 0.8;

  if (phase === 'setup' || phase === 'countdown' || !sim) {
    const t = clockT * 0.18;
    const sway = phase === 'setup' ? Math.sin(t) * 3 : 0;
    wantPos.set(-7 - W * 0.15 + sway, 3.2 + W * 0.22, W / 2 + 4 + W * (portrait ? 0.9 : 0.5));
    wantLook.set(portrait ? 1 : 3.5, 0.9, 0);
  } else if (phase === 'result' || decided) {
    // 당첨자들을 정면에서 비춤
    const ws = runners.filter((r) => decided && decided.winners.has(r.index));
    let cx = 0, cz = 0;
    ws.forEach((r) => { cx += r.x; cz += r.root.position.z; });
    cx /= ws.length || 1; cz /= ws.length || 1;
    let spread = 0;
    ws.forEach((r) => { spread = Math.max(spread, Math.abs(r.root.position.z - cz)); });
    const d = 6.5 + spread * (portrait ? 2.4 : 1.4);
    wantPos.set(cx + d * 0.8, 2.4 + spread * (portrait ? 0.7 : 0.3), cz + d * 0.6);
    wantLook.set(cx, 1.3, cz);
    if (portrait) {
      wantLook.y -= d * 0.45; // 결과 패널이 아래에 있으므로 당첨자를 화면 위쪽에
    } else {
      // 결과 패널이 오른쪽에 있으므로 당첨자를 화면 왼쪽에: 시선을 카메라 오른쪽으로 민다
      const dir = new THREE.Vector3().subVectors(wantLook, wantPos).setY(0).normalize();
      const right = new THREE.Vector3(-dir.z, 0, dir.x);
      wantLook.addScaledVector(right, d * 0.32);
    }
  } else {
    const open = sim.runners.filter((p) => !p.finished);
    const pool = open.length ? open : sim.runners;
    let lead = -Infinity, sum = 0;
    pool.forEach((p) => { lead = Math.max(lead, p.dist); sum += p.dist; });
    const mean = sum / pool.length;
    const w = settings.mode === 'first' ? 0.65 : 0.35;
    const focus = Math.min(L + 6, lead * w + mean * (1 - w));
    if (lead > L - 16 && lead <= L + 2) {
      // 결승선 카메라: 결승선 너머에서 다가오는 선수들을 비춤
      wantPos.set(L + 7 + W * 0.25, 2.6 + W * 0.12, W / 2 + 3 + W * (portrait ? 0.9 : 0.35));
      wantLook.set(Math.min(focus, L) - 3, 1, -W * 0.05);
    } else if (portrait) {
      // 세로 화면: 뒤에서 따라가는 추격 카메라 (레인이 화면 가로로 펼쳐짐)
      const spread = Math.min(18, lead - Math.min(...pool.map((p) => p.dist)));
      wantPos.set(focus - 7 - W * 0.3 - spread * 0.3, 3.4 + W * 0.25 + spread * 0.1, W * 0.12 + 1);
      wantLook.set(focus + 4, 0.6, -W * 0.05);
    } else {
      const spread = Math.min(18, lead - Math.min(...pool.map((p) => p.dist)));
      const back = 5.5 + W * 0.15 + spread * 0.3;
      wantPos.set(focus - back, 3 + W * 0.17 + spread * 0.1, W / 2 + 3 + W * (portrait ? 0.8 : 0.3) + spread * 0.2);
      wantLook.set(focus + 2.5, 0.9, 0);
    }
  }
  const a = 1 - Math.exp(-dt * (phase === 'result' ? 1.6 : 2.6));
  camPos.lerp(wantPos, a);
  camLook.lerp(wantLook, a);
  camera.position.copy(camPos);
  camera.lookAt(camLook);

  // 그림자 카메라가 시점을 따라다니도록
  env.sun.target.position.set(camLook.x, 0, 0);
  env.sun.position.set(camLook.x - 20, 40, 25);
}

// ───────── 메인 루프 ─────────
const clock = new THREE.Clock();
function loop() {
  requestAnimationFrame(loop);
  const rawDt = Math.min(0.05, clock.getDelta());
  clockT += rawDt;

  if (phase === 'race' || phase === 'result') {
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
      r.x = p.dist;
      const won = decided && decided.winners.has(p.i);
      const state = p.v > 0.4 ? 'run' : won ? 'celebrate' : 'idle';
      r.animate(dt, { state, speed: p.v, fall: sim.fallAmount(p), boost: p.boostT > 0, time: clockT });
    });
    if (phase === 'race' && clockT - lastHud > 0.1) { lastHud = clockT; updateHud(); }

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
  track?.update(rawDt, excitement);
  updateCamera(rawDt);
  renderer.render(scene, camera);
}

// 첫 화면: 예시 참가자들이 출발선에 서 있는 상태
onNamesChanged();
names = parseNames(ui.names.value).slice(0, MAX_PLAYERS);
clearTimeout(rebuildTimer);
if (names.length) buildField(names);
loop();

// 웹폰트가 늦게 도착하면 이름표/표지판을 다시 그린다
document.fonts?.ready.then(() => { if (phase === 'setup' && names.length) buildField(names); });
