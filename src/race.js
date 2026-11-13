// 레이스 물리/확률 시뮬레이션. 모든 참가자가 같은 분포에서 난수를 받으므로 당첨 확률은 동일하다.

const FALL_DOWN = 0.35, FALL_LIE = 0.9, FALL_UP = 0.45;
const FALL_TOTAL = FALL_DOWN + FALL_LIE + FALL_UP;
const STOP_AFTER = 28; // 결승선 통과 후 이 거리 안에 멈춤

/** 코스 길이별 목표 소요 시간(초) */
function targetDuration(length) {
  return 6 + length * 0.105;
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

export class RaceSim {
  constructor(count, length, rng) {
    this.length = length;
    this.rng = rng;
    this.time = 0;
    this.finishedCount = 0;
    const avg = (length / targetDuration(length)) * 1.06;
    this.runners = Array.from({ length: count }, (_, i) => ({
      i,
      dist: 0,
      v: 0,
      base: avg * (0.97 + rng() * 0.06),
      mood: 0,                    // 현재 컨디션 (-0.16 ~ +0.16)
      moodTarget: (rng() - 0.5) * 0.3,
      nextMood: 0.4 + rng(),
      reaction: 0.05 + rng() * 0.25, // 출발 반응 속도
      spurt: (rng() - 0.35) * 0.16,  // 70% 지점 이후 막판 스퍼트
      boostT: 0,
      fallT: -1,
      cooldown: 1.5 + rng() * 2,
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
    this.time += dt;
    const L = this.length;
    let leader = 0;
    for (const p of this.runners) if (!p.finished && p.dist > leader) leader = p.dist;

    for (const p of this.runners) {
      if (p.finished) {
        // 골인 후 감속
        const left = L + STOP_AFTER - p.dist;
        const vt = left > 0 ? Math.min(p.v, Math.max(0, left * 0.6)) : 0;
        p.v += (vt - p.v) * Math.min(1, dt * 2.5);
        p.dist += p.v * dt;
        p.boostT = 0;
        continue;
      }

      // 출발 반응
      if (this.time < p.reaction) continue;

      // 컨디션 변화
      p.nextMood -= dt;
      if (p.nextMood <= 0) {
        p.moodTarget = (r() - 0.5) * 0.32;
        p.nextMood = 0.5 + r() * 1.1;
      }
      p.mood += (p.moodTarget - p.mood) * Math.min(1, dt * 1.8);

      // 랜덤 이벤트
      const progress = p.dist / L;
      p.cooldown -= dt;
      if (p.fallT < 0 && p.boostT <= 0 && p.cooldown <= 0 && progress > 0.1 && progress < 0.94) {
        const roll = r();
        if (roll < 0.03 * dt) {
          p.fallT = 0;
          p.cooldown = FALL_TOTAL + 2.5;
          events.push({ type: 'fall', i: p.i });
        } else if (roll < 0.13 * dt) {
          p.boostT = 0.9 + r() * 0.8;
          p.cooldown = p.boostT + 2;
          events.push({ type: 'boost', i: p.i });
        }
      }

      // 목표 속도
      let factor = 1 + p.mood;
      if (progress > 0.7) factor += p.spurt;
      const gap = leader - p.dist;
      factor += 0.07 * Math.min(1, gap / 10);           // 뒤처지면 살짝 힘이 남 (막판까지 접전)
      if (p.boostT > 0) { factor *= 1.5; p.boostT -= dt; }
      let target = p.base * factor;

      if (p.fallT >= 0) {
        p.fallT += dt;
        target = p.fallT < FALL_DOWN ? p.v * 0.5 : 0;
        if (p.fallT >= FALL_TOTAL) p.fallT = -1;
      }

      const accel = this.time < p.reaction + 1.4 ? 3.2 : 2.4;
      p.v += (target - p.v) * Math.min(1, dt * accel);
      if (p.fallT >= FALL_DOWN) p.v = Math.max(0, p.v - dt * 30);
      const prev = p.dist;
      p.dist += p.v * dt;

      if (p.dist >= L) {
        p.finished = true;
        // 결승선을 넘은 정확한 시각을 보간
        p.finishTime = this.time - (p.dist - L) / Math.max(0.01, p.dist - prev) * dt;
        p.fallT = -1;
        crossed.push(p);
      }
    }
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
