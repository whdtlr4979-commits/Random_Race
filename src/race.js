// 레이스 물리/확률 시뮬레이션. 모든 참가자가 같은 분포에서 난수를 받으므로 당첨 확률은 동일하다.
// 출발 위치(앞줄/뒷줄, 안쪽/바깥쪽)도 매 레이스 무작위로 섞는다.

const FALL_DOWN = 0.35, FALL_LIE = 0.9, FALL_UP = 0.5;
const FALL_TOTAL = FALL_DOWN + FALL_LIE + FALL_UP;
const STOP_AFTER = 30; // 결승선 통과 후 이 거리 안에 멈춤

/** 코스 길이별 목표 소요 시간(초): 250m≈26s, 400m≈39s, 600m≈55s */
function targetDuration(length) {
  return 6 + length * 0.082;
}

/** 공정한 난수: crypto 기반 [0,1) */
export function makeRng() {
  const buf = new Uint32Array(256);
  let i = buf.length;
  return () => {
    if (i >= buf.length) { crypto.getRandomValues(buf); i = 0; }
    return buf[i++] / 4294967296;
  };
}

/** 출발 그리드: 한 줄에 perRow명, 뒷줄은 1.4m씩 뒤. 자리는 무작위 배정 */
export function startGrid(count, halfW, rng) {
  const perRow = Math.max(1, Math.floor((halfW * 2 - 1.2) / 1.0));
  const rows = Math.ceil(count / perRow);
  const slots = [];
  for (let k = 0; k < count; k++) {
    const row = Math.floor(k / perRow);
    const inRow = row === rows - 1 ? count - row * perRow : perRow;
    const col = k % perRow;
    const span = Math.min(halfW * 2 - 1.2, (inRow - 1) * 1.0);
    slots.push({ dist: -row * 1.4, lat: inRow === 1 ? 0 : -span / 2 + (col * span) / (inRow - 1) });
  }
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  return slots;
}

export class RaceSim {
  /**
   * @param {object} opt halfW, grid([{dist,lat}]), slopeAt(d), curvAt(d)  (d는 출발선 기준 거리)
   */
  constructor(count, length, rng, opt) {
    this.length = length;
    this.rng = rng;
    this.opt = opt;
    this.time = 0;
    this.finishedCount = 0;
    const avg = (length / targetDuration(length)) * 1.08;
    this.runners = Array.from({ length: count }, (_, i) => ({
      i,
      dist: opt.grid[i].dist,
      lat: opt.grid[i].lat,
      v: 0,
      base: avg * (0.97 + rng() * 0.06),
      mood: 0,                        // 현재 컨디션
      moodTarget: (rng() - 0.5) * 0.3,
      nextMood: 0.4 + rng(),
      pref: (rng() - 0.5) * 1.2,      // 선호 주행 라인 (-0.6~0.6 × 반폭)
      nextPref: 3 + rng() * 4,
      reaction: 0.05 + rng() * 0.3,   // 출발 반응 속도
      spurt: (rng() - 0.35) * 0.14,   // 75% 지점 이후 막판 스퍼트
      boostT: 0,
      fallT: -1,
      cooldown: 2 + rng() * 3,
      finished: false,
      finishTime: 0,
      place: 0,
    }));
  }

  /** dt 만큼 진행. 발생한 이벤트 목록을 돌려준다. */
  step(dt) {
    const events = [];
    const crossed = [];
    const r = this.rng;
    const { halfW, slopeAt, curvAt } = this.opt;
    this.time += dt;
    const L = this.length;
    let leader = -Infinity;
    for (const p of this.runners) if (!p.finished && p.dist > leader) leader = p.dist;

    for (const p of this.runners) {
      // 주행 라인: 선호 라인 + 다가오는 커브의 안쪽
      p.nextPref -= dt;
      if (p.nextPref <= 0) { p.pref = (r() - 0.5) * 1.2; p.nextPref = 3 + r() * 4; }
      const c = curvAt(p.dist + 10);
      const k = Math.min(1, Math.abs(c) * 22);
      const inside = -Math.sign(c) * (halfW - 1.3);
      const want = p.pref * halfW * (1 - k * 0.7) + inside * k * 0.7;
      if (p.fallT < 0 && this.time > p.reaction + 0.8) p.lat += (want - p.lat) * Math.min(1, dt * 0.7);

      if (p.finished) {
        const left = L + STOP_AFTER - p.dist;
        const vt = left > 0 ? Math.min(p.v, Math.max(0, left * 0.5)) : 0;
        p.v += (vt - p.v) * Math.min(1, dt * 2);
        p.dist += p.v * dt;
        p.boostT = 0;
        continue;
      }
      if (this.time < p.reaction) continue;

      // 컨디션 변화
      p.nextMood -= dt;
      if (p.nextMood <= 0) { p.moodTarget = (r() - 0.5) * 0.3; p.nextMood = 0.6 + r() * 1.4; }
      p.mood += (p.moodTarget - p.mood) * Math.min(1, dt * 1.5);

      // 랜덤 이벤트
      const progress = p.dist / L;
      p.cooldown -= dt;
      if (p.fallT < 0 && p.boostT <= 0 && p.cooldown <= 0 && progress > 0.06 && progress < 0.96) {
        const roll = r();
        if (roll < 0.016 * dt) {
          p.fallT = 0;
          p.cooldown = FALL_TOTAL + 3;
          events.push({ type: 'fall', i: p.i });
        } else if (roll < 0.075 * dt) {
          p.boostT = 1 + r() * 1;
          p.cooldown = p.boostT + 2.5;
          events.push({ type: 'boost', i: p.i });
        }
      }

      // 목표 속도
      let factor = 1 + p.mood;
      if (progress > 0.75) factor += p.spurt;
      factor += 0.07 * Math.min(1, (leader - p.dist) / 15);                 // 뒤처지면 힘을 냄
      factor *= 1 - Math.max(-0.1, Math.min(0.1, slopeAt(p.dist))) * 1.6;  // 오르막은 느리게, 내리막은 빠르게
      if (p.boostT > 0) { factor *= 1.45; p.boostT -= dt; }
      let target = p.base * factor;

      if (p.fallT >= 0) {
        p.fallT += dt;
        target = 0;
        if (p.fallT >= FALL_TOTAL) p.fallT = -1;
      }

      const accel = this.time < p.reaction + 2 ? 1.6 : 2.2;
      p.v += (target - p.v) * Math.min(1, dt * accel);
      if (p.fallT >= 0) p.v = Math.max(0, p.v - dt * (p.fallT < FALL_DOWN ? 14 : 40));
      const prev = p.dist;
      p.dist += p.v * dt;

      if (p.dist >= L) {
        p.finished = true;
        p.finishTime = this.time - ((p.dist - L) / Math.max(0.01, p.dist - prev)) * dt;
        p.fallT = -1;
        crossed.push(p);
      }
    }

    // 서로 겹치지 않게 옆으로 비켜섬
    const list = this.runners;
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        const A = list[a], B = list[b];
        const dd = Math.abs(A.dist - B.dist);
        if (dd > 1.5) continue;
        const dl = B.lat - A.lat;
        const overlap = 0.85 - Math.abs(dl);
        if (overlap <= 0) continue;
        const push = overlap * (1 - dd / 1.5) * Math.min(1, dt * 6);
        const dir = dl === 0 ? (a % 2 ? 1 : -1) : Math.sign(dl);
        if (A.fallT < 0) A.lat -= dir * push * 0.5;
        if (B.fallT < 0) B.lat += dir * push * 0.5;
      }
    }
    const lim = halfW - 0.6;
    for (const p of list) p.lat = Math.max(-lim, Math.min(lim, p.lat));

    // 같은 프레임에 들어온 선수들은 보간된 기록 순으로 등수를 매김
    crossed.sort((a, b) => a.finishTime - b.finishTime).forEach((p) => {
      p.place = ++this.finishedCount;
      events.push({ type: 'finish', i: p.i, place: p.place });
    });
    return events;
  }

  /** 넘어짐 애니메이션 진행도 0~1 */
  fallAmount(p) {
    if (p.fallT < 0) return 0;
    if (p.fallT < FALL_DOWN) return p.fallT / FALL_DOWN;
    if (p.fallT < FALL_DOWN + FALL_LIE) return 1;
    return 1 - (p.fallT - FALL_DOWN - FALL_LIE) / FALL_UP;
  }

  /** 현재 순위 (골인한 사람은 골인 순, 나머지는 거리 순) */
  ranking() {
    return [...this.runners].sort((a, b) => {
      if (a.finished && b.finished) return a.place - b.place;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.dist - a.dist;
    });
  }
}
