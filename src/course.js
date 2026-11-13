// 구불구불한 크로스컨트리 코스. 직선/원호 조각을 이어 붙여 중심선을 만들고,
// 1m 간격으로 샘플링해 위치·방향·곡률·고도를 미리 계산해 둔다.

export const ROAD_W = 12;          // 도로 폭 (m)
export const RUNOUT = 45;          // 결승선 뒤 감속 구간
export const PRE = 18;             // 가장 긴 코스의 출발선 뒤 여유
export const MAX_RACE = 600;

// [종류, 길이 또는 반지름, 각도(도, +는 왼쪽)]
const SEGMENTS = [
  ['S', 40],
  ['A', 34, 80],
  ['S', 26],
  ['A', 26, -115],
  ['S', 22],
  ['A', 21, 165],   // 헤어핀
  ['S', 48],        // 언덕 오르막
  ['A', 38, -60],
  ['S', 34],        // 강 위 다리
  ['A', 30, -95],
  ['S', 14],
  ['A', 22, 70],    // S자 커브
  ['A', 22, -70],
  ['S', 26],
  ['A', 42, -75],
  ['S', 20],
  ['A', 30, 60],
  ['S', 120],       // 결승 직선
];

const STEP = 1; // 샘플 간격 (m)

/** 언덕 지형 높이 (해석적) */
export function hillHeight(x, z) {
  return (
    6.5 * Math.exp(-((x - 95) ** 2 + (z - 120) ** 2) / (2 * 55 ** 2)) +   // 큰 언덕
    3.2 * Math.sin(x * 0.021 + 1.3) * Math.cos(z * 0.017 - 0.4) +
    1.4 * Math.sin(x * 0.053 + z * 0.031) +
    0.6 * Math.cos(x * 0.11 - z * 0.07)
  );
}

// 강: 지도 가운데를 동서로 흐르며 코스를 두 번 가로지른다 (다리 2개)
export const RIVER_W = 10;
export function riverZ(x) {
  return -136 + 12 * Math.sin(x * 0.02 + 0.5) + 5 * Math.sin(x * 0.051);
}
/** 강 중심선까지의 대략적인 거리 (강이 완만하므로 z 차이로 근사) */
export function riverDist(x, z) {
  return Math.abs(z - riverZ(x)) * 0.97;
}

function buildCenterline() {
  const pts = [];
  let x = 0, z = 0, h = 0; // h: 진행 방향 각도 (x축 기준, +는 -z 쪽 = 왼쪽)
  pts.push([x, z, h]);
  for (const seg of SEGMENTS) {
    if (seg[0] === 'S') {
      const n = Math.round(seg[1] / STEP);
      for (let i = 0; i < n; i++) {
        x += Math.cos(h) * STEP;
        z -= Math.sin(h) * STEP;
        pts.push([x, z, h]);
      }
    } else {
      const r = seg[1];
      const ang = (seg[2] * Math.PI) / 180;
      const len = Math.abs(ang) * r;
      const n = Math.round(len / STEP);
      const dh = ang / n;
      for (let i = 0; i < n; i++) {
        h += dh / 2;
        x += Math.cos(h) * (len / n);
        z -= Math.sin(h) * (len / n);
        h += dh / 2;
        pts.push([x, z, h]);
      }
    }
  }
  return pts;
}

export function createCourse() {
  const raw = buildCenterline();
  const n = raw.length;
  const total = (n - 1) * STEP;

  const px = new Float32Array(n), pz = new Float32Array(n), py = new Float32Array(n);
  const tx = new Float32Array(n), tz = new Float32Array(n), curv = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    px[i] = raw[i][0];
    pz[i] = raw[i][1];
    tx[i] = Math.cos(raw[i][2]);
    tz[i] = -Math.sin(raw[i][2]);
  }
  for (let i = 0; i < n; i++) {
    const a = raw[Math.max(0, i - 2)][2], b = raw[Math.min(n - 1, i + 2)][2];
    const span = (Math.min(n - 1, i + 2) - Math.max(0, i - 2)) * STEP;
    curv[i] = (b - a) / span; // +: 왼쪽으로 도는 중
  }

  // 다리: 코스가 강 위를 지나는 구간들
  const bridges = [];
  let cur = null;
  for (let i = 0; i < n; i++) {
    const over = riverDist(px[i], pz[i]) < RIVER_W / 2 + 2.5;
    if (over && !cur) cur = { from: i, to: i };
    else if (over) cur.to = i;
    else if (cur) { bridges.push(cur); cur = null; }
  }
  if (cur) bridges.push(cur);
  const river = [];
  for (let x = -260; x <= 660; x += 6) river.push([x, riverZ(x)]);

  // 고도: 지형을 따라가되 부드럽게 (이동평균) + 경사 제한
  const rawY = new Float32Array(n);
  for (let i = 0; i < n; i++) rawY[i] = hillHeight(px[i], pz[i]);
  const win = 24;
  for (let i = 0; i < n; i++) {
    let s = 0, c = 0;
    for (let k = -win; k <= win; k++) {
      const j = Math.min(n - 1, Math.max(0, i + k));
      const w = 1 - Math.abs(k) / (win + 1);
      s += rawY[j] * w; c += w;
    }
    py[i] = s / c;
  }
  // 다리 구간은 평평하게
  for (const br of bridges) {
    const mid = Math.round((br.from + br.to) / 2);
    const half = (br.to - br.from) / 2 * STEP;
    const level = py[mid];
    for (let i = 0; i < n; i++) {
      const d = Math.abs(i - mid) * STEP;
      if (d < half + 24) {
        const t = smoothstep(half + 24, half + 8, d);
        py[i] = py[i] * (1 - t) + level * t;
      }
    }
  }

  // 경사 제한 (최대 9%)
  const MAXS = 0.09 * STEP;
  for (let i = 1; i < n; i++) py[i] = Math.min(py[i - 1] + MAXS, Math.max(py[i - 1] - MAXS, py[i]));
  for (let i = n - 2; i >= 0; i--) py[i] = Math.min(py[i + 1] + MAXS, Math.max(py[i + 1] - MAXS, py[i]));

  const finishD = total - RUNOUT;

  function idx(d) {
    const f = Math.min(n - 1.001, Math.max(0, d / STEP));
    const i = Math.floor(f);
    return [i, f - i];
  }

  const course = {
    total, finishD, n, step: STEP, px, py, pz, tx, tz, curv, river, bridges,
    halfW: ROAD_W / 2,
    /** 코스 거리 d, 횡방향 lat(+는 오른쪽)에서의 월드 좌표 */
    point(d, lat = 0, out = {}) {
      const [i, f] = idx(d);
      const j = i + 1;
      const x = px[i] + (px[j] - px[i]) * f;
      const z = pz[i] + (pz[j] - pz[i]) * f;
      const y = py[i] + (py[j] - py[i]) * f;
      let ux = tx[i] + (tx[j] - tx[i]) * f, uz = tz[i] + (tz[j] - tz[i]) * f;
      const l = Math.hypot(ux, uz) || 1; ux /= l; uz /= l;
      // 오른쪽 벡터 = (−uz, ux)를 뒤집은 것: 진행방향 (ux,uz)에서 오른쪽은 (-uz, ux)*-1
      const rx = -uz, rz = ux;
      out.x = x + rx * lat; out.y = y; out.z = z + rz * lat;
      out.tx = ux; out.tz = uz; out.rx = rx; out.rz = rz;
      out.heading = Math.atan2(-uz, ux);
      out.curv = curv[i] + (curv[j] - curv[i]) * f;
      return out;
    },
    slope(d) {
      const [i] = idx(d);
      const j = Math.min(n - 1, i + 3), k = Math.max(0, i - 3);
      return (py[j] - py[k]) / ((j - k) * STEP);
    },
  };
  return course;
}

export function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
