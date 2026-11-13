import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────
// 실제 달리기 보행 데이터를 단순화한 관절 각도 곡선 (도 단위)
// 한 주기 = 한쪽 발이 땅에 닿는 순간(0)부터 다시 닿을 때까지(1)
// hip: +는 허벅지를 앞으로, knee: 굽힘 각도, ankle: +는 발끝을 들어 올림
// 0 ~ stance 구간은 발이 땅을 딛고, 나머지는 공중에서 다리를 앞으로 가져옴
// ─────────────────────────────────────────────────────────────
const JOG = {
  stance: 0.38,
  keys: [
    [0.00, 24, 14, 2],
    [0.12, 14, 38, 14],
    [0.25, 0, 26, 8],
    [0.38, -16, 16, -24],
    [0.50, -6, 58, -12],
    [0.62, 18, 88, 4],
    [0.76, 33, 66, 10],
    [0.89, 30, 24, 6],
  ],
};
const SPRINT = {
  stance: 0.3,
  keys: [
    [0.00, 33, 20, 2],
    [0.10, 22, 42, 12],
    [0.21, 2, 28, 4],
    [0.30, -20, 18, -32],
    [0.43, -10, 84, -18],
    [0.57, 34, 122, 4],
    [0.71, 60, 88, 16],
    [0.86, 52, 30, 10],
  ],
};

const TABLE = 64;
/** 키프레임 → 균일 표본 + 원형 블러로 매끈한 주기 곡선 */
function bake(def) {
  const out = { stance: def.stance, hip: new Float32Array(TABLE), knee: new Float32Array(TABLE), ankle: new Float32Array(TABLE) };
  const keys = def.keys;
  for (let i = 0; i < TABLE; i++) {
    const t = i / TABLE;
    let a = keys[keys.length - 1], b = keys[0], ta = a[0] - 1, tb = b[0];
    for (let k = 0; k < keys.length; k++) {
      const k2 = (k + 1) % keys.length;
      const t0 = keys[k][0], t1 = k2 === 0 ? 1 + keys[0][0] : keys[k2][0];
      if (t >= t0 && t < t1) { a = keys[k]; b = keys[k2]; ta = t0; tb = t1; break; }
    }
    const f = (t - ta) / (tb - ta);
    const s = f * f * (3 - 2 * f);
    out.hip[i] = (a[1] + (b[1] - a[1]) * s) * Math.PI / 180;
    out.knee[i] = (a[2] + (b[2] - a[2]) * s) * Math.PI / 180;
    out.ankle[i] = (a[3] + (b[3] - a[3]) * s) * Math.PI / 180;
  }
  for (const key of ['hip', 'knee', 'ankle']) {
    for (let pass = 0; pass < 3; pass++) {
      const src = out[key].slice();
      for (let i = 0; i < TABLE; i++) {
        out[key][i] = (src[(i - 1 + TABLE) % TABLE] + 2 * src[i] + src[(i + 1) % TABLE]) / 4;
      }
    }
  }
  return out;
}
const GAIT_JOG = bake(JOG);
const GAIT_SPRINT = bake(SPRINT);

function sample(arr, frac) {
  const f = (((frac % 1) + 1) % 1) * TABLE;
  const i = Math.floor(f), j = (i + 1) % TABLE, t = f - i;
  return arr[i] + (arr[j] - arr[i]) * t;
}

// 신체 치수 (m)
const THIGH = 0.44, SHIN = 0.44, ANKLE_H = 0.085;
const HEEL = [-0.06, -ANKLE_H], TOE = [0.17, -ANKLE_H];
const STAND_HIP = THIGH + SHIN + ANKLE_H;

/** 다리 하나의 발바닥 최저점 높이 (엉덩이 관절 기준, 시상면 2D 순운동학) */
function footLowY(hip, knee, ankle) {
  const ky = -Math.cos(hip) * THIGH;
  const b = hip - knee;                // 정강이 절대각
  const ay = ky - Math.cos(b) * SHIN;
  const c = b + ankle;                 // 발 절대각
  const cs = Math.cos(c), sn = Math.sin(c);
  const hy = ay + HEEL[0] * sn + HEEL[1] * cs;
  const ty = ay + TOE[0] * sn + TOE[1] * cs;
  return Math.min(hy, ty);
}

const SKIN = ['#f6d3b3', '#eec19a', '#d9a47a', '#b97f55', '#8d5a3b', '#f3c9a6'];
const HAIR = ['#2b1d14', '#1c1c1c', '#5a3820', '#8a5a2b', '#d9a441', '#3b2a4a'];

const geoCache = new Map();
function cached(key, make) {
  if (!geoCache.has(key)) geoCache.set(key, make());
  return geoCache.get(key);
}
const capsule = (r, len) => cached(`c${r}|${len}`, () => new THREE.CapsuleGeometry(r, len, 4, 10));
const boxG = (w, h, d) => cached(`b${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d));
const sphereG = (r) => cached(`s${r}`, () => new THREE.SphereGeometry(r, 18, 14));

const darkMat = new THREE.MeshStandardMaterial({ color: '#1d2433', roughness: 0.8 });
const shoeSoleMat = new THREE.MeshStandardMaterial({ color: '#f4f4f4', roughness: 0.6 });
const eyeMat = new THREE.MeshBasicMaterial({ color: '#111' });
const starMat = new THREE.MeshBasicMaterial({ color: '#ffd84a' });
const goldMat = new THREE.MeshStandardMaterial({ color: '#ffcf3f', metalness: 0.7, roughness: 0.25, emissive: '#5a3c00', side: THREE.DoubleSide });
const trailMat = new THREE.MeshBasicMaterial({ color: '#8fe3ff', transparent: true, opacity: 0.5, depthWrite: false });

function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

/** 이름표 스프라이트 */
function makeLabel(text, color) {
  const fontPx = 44;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const font = `900 ${fontPx}px 'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif`;
  ctx.font = font;
  const tw = Math.ceil(ctx.measureText(text).width);
  const h = 72;
  c.width = tw + 44 + 24;
  c.height = h + 14;
  ctx.font = font;
  const w = c.width, r = h / 2;
  ctx.fillStyle = 'rgba(12,20,40,0.88)';
  ctx.beginPath();
  ctx.moveTo(r, 0); ctx.lineTo(w - r, 0); ctx.arc(w - r, r, r, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(w / 2 + 10, h); ctx.lineTo(w / 2, h + 12); ctx.lineTo(w / 2 - 10, h);
  ctx.lineTo(r, h); ctx.arc(r, r, r, Math.PI / 2, -Math.PI / 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(30, r, 11, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 50, r + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  const scale = 0.0085;
  s.scale.set(c.width * scale, c.height * scale, 1);
  s.center.set(0.5, 0);
  s.renderOrder = 10;
  return s;
}

function makeBib(num) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 96;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 128, 96);
  ctx.fillStyle = '#111';
  ctx.font = "900 64px 'Noto Sans KR', sans-serif";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(num), 64, 52);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshBasicMaterial({ map: tex });
}

/** 관절 각도 묶음 */
function makePose() {
  return {
    hipL: 0, kneeL: 0, ankleL: 0, hipR: 0, kneeR: 0, ankleR: 0,
    armL: 0, armR: 0, elbowL: 0.3, elbowR: 0.3, spreadL: 0, spreadR: 0,
    lean: 0, pelvisYaw: 0, chestYaw: 0, headPitch: 0, lift: 0,
  };
}
function lerpPose(a, b, t, out) {
  for (const k in a) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
}

export class Runner {
  constructor({ name, color, index, rng }) {
    this.name = name;
    this.color = color;
    this.index = index;
    this.root = new THREE.Group();
    this.root.rotation.order = 'YXZ';

    const shirt = new THREE.MeshStandardMaterial({ color, roughness: 0.55 });
    const skin = new THREE.MeshStandardMaterial({ color: SKIN[Math.floor(rng() * SKIN.length)], roughness: 0.7 });
    const hair = new THREE.MeshStandardMaterial({ color: HAIR[Math.floor(rng() * HAIR.length)], roughness: 0.9 });
    const shoe = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).lerp(new THREE.Color('#222'), 0.35), roughness: 0.5 });
    this.materials = [shirt, skin, hair, shoe];

    this.body = new THREE.Group();          // 넘어질 때 발끝 기준 회전
    this.root.add(this.body);
    this.pelvis = new THREE.Group();
    this.pelvis.position.y = STAND_HIP;
    this.body.add(this.pelvis);

    // 반바지 (골반)
    this.pelvis.add(mesh(capsule(0.15, 0.12), darkMat, 0, -0.02, 0));
    this.pelvis.children[0].rotation.x = Math.PI / 2;
    this.pelvis.children[0].scale.set(0.85, 1, 1);

    // 다리
    const makeLeg = (side) => {
      const hip = new THREE.Group();
      hip.position.set(0, -0.04, side * 0.1);
      hip.add(mesh(capsule(0.085, THIGH - 0.12), darkMat, 0, -0.1, 0));         // 반바지 덮인 허벅지 윗부분
      hip.children[0].scale.set(1.08, 0.45, 1.08);
      hip.add(mesh(capsule(0.078, THIGH - 0.1), skin, 0, -THIGH / 2 - 0.02, 0));
      const knee = new THREE.Group();
      knee.position.y = -THIGH;
      knee.add(mesh(capsule(0.062, SHIN - 0.08), skin, 0, -SHIN / 2, 0));
      const ankle = new THREE.Group();
      ankle.position.y = -SHIN;
      const shoeBody = mesh(capsule(0.05, 0.16), shoe, 0.055, -0.04, 0);
      shoeBody.rotation.z = Math.PI / 2;
      shoeBody.scale.set(0.95, 1, 1.1);
      ankle.add(shoeBody);
      ankle.add(mesh(boxG(0.25, 0.028, 0.105), shoeSoleMat, 0.055, -ANKLE_H + 0.014, 0));
      knee.add(ankle);
      hip.add(knee);
      this.pelvis.add(hip);
      return { hip, knee, ankle };
    };
    this.legL = makeLeg(1);
    this.legR = makeLeg(-1);

    // 상체
    this.spine = new THREE.Group();
    this.spine.position.y = 0.05;
    this.pelvis.add(this.spine);
    const chest = mesh(capsule(0.17, 0.26), shirt, 0, 0.27, 0);
    chest.scale.set(0.72, 1, 1.12);
    this.spine.add(chest);
    const bib = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.15), makeBib(index + 1));
    bib.position.set(0.128, 0.3, 0);
    bib.rotation.y = Math.PI / 2;
    this.spine.add(bib);
    this.materials.push(bib.material);

    // 머리
    this.neck = new THREE.Group();
    this.neck.position.y = 0.5;
    this.spine.add(this.neck);
    this.neck.add(mesh(capsule(0.05, 0.06), skin, 0, 0.03, 0));
    this.head = new THREE.Group();
    this.head.position.y = 0.1;
    this.neck.add(this.head);
    const skull = mesh(sphereG(0.125), skin, 0.01, 0.08, 0);
    skull.scale.set(1, 1.12, 0.95);
    this.head.add(skull);
    const hairCap = mesh(new THREE.SphereGeometry(0.133, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hair, -0.012, 0.095, 0);
    hairCap.rotation.z = 0.4;
    hairCap.scale.set(1, 1.1, 0.98);
    this.head.add(hairCap);
    const band = mesh(cached('band', () => new THREE.CylinderGeometry(0.134, 0.134, 0.035, 20, 1, true)), shirt, 0, 0.13, 0);
    band.material = band.material.clone();
    band.material.side = THREE.DoubleSide;
    band.rotation.z = 0.25;
    this.materials.push(band.material);
    this.head.add(band);                                                         // 헤어밴드
    for (const s of [1, -1]) {
      const e = new THREE.Mesh(sphereG(0.017), eyeMat);
      e.position.set(0.118, 0.1, s * 0.045);
      this.head.add(e);
    }
    this.head.add(mesh(boxG(0.03, 0.04, 0.03), skin, 0.13, 0.06, 0));           // 코

    // 팔
    const makeArm = (side) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(0, 0.43, side * 0.205);
      shoulder.add(mesh(capsule(0.06, 0.08), shirt, 0, -0.03, 0));               // 소매
      shoulder.add(mesh(capsule(0.048, 0.2), skin, 0, -0.14, 0));
      const elbow = new THREE.Group();
      elbow.position.y = -0.28;
      elbow.add(mesh(capsule(0.042, 0.18), skin, 0, -0.12, 0));
      elbow.add(mesh(sphereG(0.05), skin, 0.005, -0.26, 0));                    // 주먹
      shoulder.add(elbow);
      this.spine.add(shoulder);
      return { shoulder, elbow };
    };
    this.armL = makeArm(1);
    this.armR = makeArm(-1);

    // 이름표
    this.label = makeLabel(name, color);
    this.label.position.y = 2.2 + (index % 3) * 0.45;
    this.labelBase = this.label.scale.clone();
    this.root.add(this.label);

    // 부스터 잔상
    this.trail = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const t = new THREE.Mesh(boxG(1.2, 0.05, 0.05), trailMat);
      t.position.set(-0.9 - i * 0.2, 0.7 + i * 0.4, (i - 1) * 0.25);
      this.trail.add(t);
    }
    this.trail.visible = false;
    this.root.add(this.trail);

    // 넘어졌을 때 머리 위 별
    this.stars = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Mesh(cached('star', () => new THREE.OctahedronGeometry(0.09)), starMat);
      const a = (i / 3) * Math.PI * 2;
      s.position.set(Math.cos(a) * 0.32, 0, Math.sin(a) * 0.32);
      this.stars.add(s);
    }
    this.stars.visible = false;
    this.root.add(this.stars);

    // 당첨 왕관
    this.crown = new THREE.Group();
    this.crown.add(new THREE.Mesh(cached('ring', () => new THREE.CylinderGeometry(0.17, 0.15, 0.1, 16, 1, true)), goldMat));
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const spike = new THREE.Mesh(cached('spike', () => new THREE.ConeGeometry(0.04, 0.13, 6)), goldMat);
      spike.position.set(Math.cos(a) * 0.15, 0.11, Math.sin(a) * 0.15);
      this.crown.add(spike);
    }
    this.crown.visible = false;
    this.root.add(this.crown);

    this.cycle = rng();                 // 보행 주기 위치 (0~1)
    this.idleT = rng() * 10;
    this.stride = 0.96 + rng() * 0.08;  // 사람마다 살짝 다른 보폭
    this.pose = makePose();
    this.tmpPose = makePose();
    this.fallPose = makePose();
    this.smoothLean = 0;
    this.roll = 0;
  }

  // ───────── 포즈 계산 ─────────
  runPose(dt, speed, boost, out) {
    const t = Math.min(1, Math.max(0, (speed - 3) / 7)); // 0 = 조깅, 1 = 전력질주
    const freq = (0.75 + 0.16 * speed) / this.stride;   // 초당 주기 수
    this.cycle = (this.cycle + dt * freq) % 1;
    const c = this.cycle;
    const amp = Math.min(1, speed / 3);                  // 아주 느릴 때는 동작을 줄임
    const g = (arr0, arr1, frac) => (sample(arr0, frac) * (1 - t) + sample(arr1, frac) * t) * amp;
    out.hipL = g(GAIT_JOG.hip, GAIT_SPRINT.hip, c);
    out.kneeL = g(GAIT_JOG.knee, GAIT_SPRINT.knee, c);
    out.ankleL = g(GAIT_JOG.ankle, GAIT_SPRINT.ankle, c);
    out.hipR = g(GAIT_JOG.hip, GAIT_SPRINT.hip, c + 0.5);
    out.kneeR = g(GAIT_JOG.knee, GAIT_SPRINT.knee, c + 0.5);
    out.ankleR = g(GAIT_JOG.ankle, GAIT_SPRINT.ankle, c + 0.5);

    // 팔은 반대쪽 다리와 같이 움직임 (약간 늦게)
    const meanHip = 0.3 * amp;
    const armGain = (0.85 + 0.5 * t) * amp;
    out.armL = (g(GAIT_JOG.hip, GAIT_SPRINT.hip, c + 0.5 - 0.03) - meanHip) * armGain * 1.1;
    out.armR = (g(GAIT_JOG.hip, GAIT_SPRINT.hip, c - 0.03) - meanHip) * armGain * 1.1;
    out.elbowL = 1.35 + 0.35 * out.armL + 0.15 * t;
    out.elbowR = 1.35 + 0.35 * out.armR + 0.15 * t;
    out.spreadL = out.spreadR = 0.06;

    // 골반은 앞으로 나간 다리 쪽으로, 어깨는 반대로 비틀림
    out.pelvisYaw = 0.22 * (out.hipL - out.hipR) * 0.5;
    out.chestYaw = 0.25 * (out.armL - out.armR) * 0.5;
    const leanTarget = 0.1 + 0.12 * t + (boost ? 0.12 : 0);
    this.smoothLean += (leanTarget - this.smoothLean) * Math.min(1, dt * 4);
    out.lean = this.smoothLean;
    out.headPitch = -this.smoothLean * 0.75;

    // 체공기: 두 발이 모두 떠 있을 때 살짝 뜸
    const st = GAIT_JOG.stance * (1 - t) + GAIT_SPRINT.stance * t;
    const half = c % 0.5;
    out.lift = half > st ? Math.sin(((half - st) / (0.5 - st)) * Math.PI) * (0.025 + 0.06 * t) * amp : 0;
    return out;
  }

  idlePose(dt, out) {
    this.idleT += dt;
    const b = Math.sin(this.idleT * 2.2);
    Object.assign(out, makePose());
    out.hipL = 0.04; out.hipR = -0.03; out.kneeL = 0.08; out.kneeR = 0.05;
    out.armL = 0.05 + b * 0.02; out.armR = -0.02 - b * 0.02;
    out.elbowL = 0.25; out.elbowR = 0.3; out.spreadL = out.spreadR = 0.12;
    out.lean = 0.02 + b * 0.01;
    return out;
  }

  readyPose(dt, out) {
    this.idleT += dt;
    Object.assign(out, makePose());
    // 스탠딩 스타트: 왼발 앞, 오른발 뒤, 몸을 앞으로 기울임
    out.hipL = 0.55; out.kneeL = 0.75; out.ankleL = 0.15;
    out.hipR = -0.32; out.kneeR = 0.35; out.ankleR = -0.2;
    out.armL = -0.7; out.armR = 0.75; out.elbowL = 1.2; out.elbowR = 1.5;
    out.spreadL = out.spreadR = 0.05;
    out.lean = 0.5 + Math.sin(this.idleT * 3) * 0.01;
    out.headPitch = -0.35;
    return out;
  }

  celebratePose(dt, out) {
    this.idleT += dt;
    Object.assign(out, makePose());
    const ph = (this.idleT * 1.6) % 1;
    const air = Math.sin(ph * Math.PI);
    out.lift = air * 0.45;
    out.hipL = out.hipR = 0.25 * air + 0.1;
    out.kneeL = out.kneeR = 0.5 * air + 0.2;
    out.ankleL = out.ankleR = -0.3 * air;
    out.armL = out.armR = 2.85 + Math.sin(this.idleT * 9) * 0.12;
    out.spreadL = out.spreadR = 0.35;
    out.elbowL = out.elbowR = 0.2;
    out.lean = -0.08;
    out.headPitch = 0.2;
    return out;
  }

  /** state: idle | ready | run | celebrate */
  animate(dt, { state, speed = 0, fall = 0, boost = false, time = 0, curv = 0 }) {
    const p = this.tmpPose;
    if (state === 'run') this.runPose(dt, speed, boost, p);
    else if (state === 'ready') this.readyPose(dt, p);
    else if (state === 'celebrate') this.celebratePose(dt, p);
    else this.idlePose(dt, p);

    // 넘어짐: 팔을 앞으로 뻗으며 엎어짐
    if (fall > 0) {
      const fp = this.fallPose;
      Object.assign(fp, makePose());
      fp.hipL = 0.15 + Math.sin(time * 16) * 0.25; fp.hipR = 0.1 - Math.sin(time * 16) * 0.25;
      fp.kneeL = 0.5; fp.kneeR = 0.3;
      fp.armL = fp.armR = 2.3; fp.elbowL = fp.elbowR = 0.3; fp.spreadL = fp.spreadR = 0.3;
      fp.headPitch = 0.5;
      lerpPose(p, fp, Math.min(1, fall * 1.5), p);
    }
    this.applyPose(p);

    // 발바닥이 땅에 닿도록 골반 높이 결정
    const yL = footLowY(p.hipL, p.kneeL, p.ankleL);
    const yR = footLowY(p.hipR, p.kneeR, p.ankleR);
    const ground = -Math.min(yL, yR) + 0.04; // 0.04: 골반 관절 오프셋
    this.pelvis.position.y = fall > 0 ? (ground + p.lift) * (1 - fall) + 0.98 * fall : ground + p.lift;

    // 넘어짐: 발끝을 축으로 앞으로
    const e = fall < 0.5 ? 2 * fall * fall : 1 - Math.pow(-2 * fall + 2, 2) / 2;
    this.body.rotation.z = -1.4 * e;
    this.body.position.x = 0.2 * fall;

    // 커브에서 안쪽으로 기울기 (구심가속도 기준)
    const rollTarget = state === 'run' && fall === 0 ? -Math.max(-0.3, Math.min(0.3, Math.atan((speed * speed * curv) / 9.8))) : 0;
    this.roll += (rollTarget - this.roll) * Math.min(1, dt * 5);
    this.root.rotation.x = this.roll;

    this.stars.visible = fall > 0.6;
    if (this.stars.visible) {
      this.stars.position.set(1.8, 0.45, 0);
      this.stars.rotation.y += dt * 6;
    }
    this.trail.visible = boost && fall === 0;
    if (this.trail.visible) {
      this.trail.children.forEach((tr, i) => { tr.scale.x = 0.6 + Math.abs(Math.sin(time * 20 + i * 2)) * 0.8; });
    }
    if (this.crown.visible) {
      this.crown.rotation.y += dt * 2;
      this.crown.position.y = this.pelvis.position.y + 0.92;
      this.crown.position.x = 0;
    }
    this.label.visible = fall < 0.5;
  }

  applyPose(p) {
    const L = this.legL, R = this.legR;
    L.hip.rotation.z = p.hipL; L.knee.rotation.z = -p.kneeL; L.ankle.rotation.z = p.ankleL;
    R.hip.rotation.z = p.hipR; R.knee.rotation.z = -p.kneeR; R.ankle.rotation.z = p.ankleR;
    this.armL.shoulder.rotation.set(-p.spreadL, 0, p.armL);
    this.armR.shoulder.rotation.set(p.spreadR, 0, p.armR);
    this.armL.elbow.rotation.z = p.elbowL;
    this.armR.elbow.rotation.z = p.elbowR;
    this.pelvis.rotation.y = p.pelvisYaw;
    this.spine.rotation.set(0, p.chestYaw - p.pelvisYaw, -p.lean);
    this.head.rotation.set(0, -p.chestYaw * 0.8, -p.headPitch);
  }

  /** 이름표가 멀면 너무 작고 가까우면 너무 커지지 않도록 크기 조절 */
  fitLabel(cameraPos) {
    const d = cameraPos.distanceTo(this.root.position);
    const k = Math.min(2.2, Math.max(0.4, d / 12));
    this.label.scale.set(this.labelBase.x * k, this.labelBase.y * k, 1);
  }

  dispose() {
    this.label.material.map.dispose();
    this.label.material.dispose();
    this.materials.forEach((m) => { m.map?.dispose(); m.dispose(); });
  }
}
