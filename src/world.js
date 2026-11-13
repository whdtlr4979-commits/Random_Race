import * as THREE from 'three';
import { hillHeight, riverDist, RIVER_W, smoothstep } from './course.js';

const TMP = {};

function canvasTex(w, h, draw, { repeat } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}

function textTex(text, { w = 512, h = 128, bg = '#1b2a52', fg = '#ffffff', font = 84, stripe = '#ffcf3f' } = {}) {
  return canvasTex(w, h, (ctx) => {
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    if (stripe) { ctx.fillStyle = stripe; ctx.fillRect(0, h * 0.9, w, h * 0.1); ctx.fillRect(0, 0, w, h * 0.05); }
    ctx.fillStyle = fg;
    ctx.font = `900 ${font}px 'Black Han Sans', 'Noto Sans KR', sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 2);
  });
}

/**
 * 코스를 따라가는 띠 모양 메시. A/B는 띠의 두 가장자리(횡위치 lat, 높이 y).
 * 기본 UV: u = A→B, v = 거리/vScale. alongU면 u = 거리/vScale, v = A→B.
 */
function ribbon(course, d0, d1, { latA, latB, yA = 0, yB = 0, step = 1, vScale = 1, alongU = false }) {
  const pos = [], uv = [], idx = [];
  const n = Math.max(1, Math.ceil((d1 - d0) / step));
  for (let k = 0; k <= n; k++) {
    const d = d0 + ((d1 - d0) * k) / n;
    const a = course.point(d, latA, TMP);
    pos.push(a.x, a.y + yA, a.z);
    const b = course.point(d, latB, TMP);
    pos.push(b.x, b.y + yB, b.z);
    const v = d / vScale;
    if (alongU) uv.push(v, 0, v, 1); else uv.push(0, v, 1, v);
    if (k < n) {
      const i = k * 2;
      idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** 코스 위치(d, lat)에 진행방향(+x)을 맞춰 오브젝트 배치 */
function placeOn(obj, course, d, lat, yOff = 0) {
  const p = course.point(d, lat, TMP);
  obj.position.set(p.x, p.y + yOff, p.z);
  obj.rotation.y = p.heading;
  return obj;
}

export function createWorld(scene, course) {
  const halfW = course.halfW;
  const root = new THREE.Group();
  scene.add(root);

  // ───────── 도로 근접 탐색용 격자 ─────────
  const CELL = 16;
  const grid = new Map();
  for (let i = 0; i < course.n; i += 2) {
    const key = `${Math.floor(course.px[i] / CELL)},${Math.floor(course.pz[i] / CELL)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(i);
  }
  /** 가장 가까운 도로 중심선 샘플: [거리, 인덱스]. 반경 ~32m 밖이면 [Infinity, -1] */
  function nearestRoad(x, z) {
    const gx = Math.floor(x / CELL), gz = Math.floor(z / CELL);
    let best = Infinity, bi = -1;
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) {
      const list = grid.get(`${gx + a},${gz + b}`);
      if (!list) continue;
      for (const i of list) {
        const d = (course.px[i] - x) ** 2 + (course.pz[i] - z) ** 2;
        if (d < best) { best = d; bi = i; }
      }
    }
    return [Math.sqrt(best), bi];
  }

  /** 지형 높이: 언덕 + 강바닥 + 도로 주변 평탄화 */
  function groundAt(x, z) {
    let h = hillHeight(x, z);
    const rd = riverDist(x, z);
    const inRiver = rd < RIVER_W / 2 + 7;
    if (inRiver) h -= 2.6 * smoothstep(RIVER_W / 2 + 7, RIVER_W / 2 - 1, rd);
    const [dr, i] = nearestRoad(x, z);
    if (i >= 0 && dr < halfW + 14 && !(rd < RIVER_W / 2 + 4)) {
      const roadY = course.py[i] - 0.12;
      const t = smoothstep(halfW + 1, halfW + 14, dr);
      h = roadY * (1 - t) + h * t;
    }
    return h;
  }

  // ───────── 하늘 / 조명 ─────────
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(900, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color('#3f86e0') }, mid: { value: new THREE.Color('#a7d3f2') }, bottom: { value: new THREE.Color('#e3f0f5') } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; varying vec3 vP;
        void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(mid, top, smoothstep(0.0, 0.5, h)) : mix(mid, bottom, smoothstep(0.0, 0.2, -h)); gl_FragColor = vec4(c, 1.0); }`,
    })
  );
  sky.renderOrder = -1;
  scene.add(sky);
  scene.fog = new THREE.Fog('#bcdcf0', 140, 520);

  scene.add(new THREE.HemisphereLight('#e2f2ff', '#56743a', 1.15));
  const sun = new THREE.DirectionalLight('#fff3dc', 2.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 200 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  // ───────── 지형 ─────────
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < course.n; i++) {
    minX = Math.min(minX, course.px[i]); maxX = Math.max(maxX, course.px[i]);
    minZ = Math.min(minZ, course.pz[i]); maxZ = Math.max(maxZ, course.pz[i]);
  }
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const SIZE = 900, SEG = 300;
  const tg = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  tg.rotateX(-Math.PI / 2);
  tg.translate(cx, 0, cz);
  const tp = tg.attributes.position;
  const colors = new Float32Array(tp.count * 3);
  const cGrass = new THREE.Color('#4f9a45'), cGrass2 = new THREE.Color('#7fb24f'), cDirt = new THREE.Color('#a8865a'),
    cSand = new THREE.Color('#d7c79a'), cBed = new THREE.Color('#5d6f5a'), col = new THREE.Color();
  for (let i = 0; i < tp.count; i++) {
    const x = tp.getX(i), z = tp.getZ(i);
    tp.setY(i, groundAt(x, z));
    const nz = 0.5 + 0.5 * Math.sin(x * 0.07 + Math.cos(z * 0.05) * 2) * Math.cos(z * 0.06 - x * 0.02);
    col.copy(cGrass).lerp(cGrass2, nz * 0.8);
    const [dr] = nearestRoad(x, z);
    if (dr < halfW + 4) col.lerp(cDirt, smoothstep(halfW + 4, halfW + 1, dr) * 0.9);
    const rd = riverDist(x, z);
    if (rd < RIVER_W / 2 + 7) col.lerp(cSand, smoothstep(RIVER_W / 2 + 7, RIVER_W / 2 + 2, rd));
    if (rd < RIVER_W / 2 + 1) col.lerp(cBed, smoothstep(RIVER_W / 2 + 1, RIVER_W / 2 - 1, rd));
    colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
  }
  tg.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  tg.computeVertexNormals();
  const grassTex = canvasTex(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 1400; i++) {
      const v = 195 + Math.random() * 60;
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 1.5, 3);
    }
  }, { repeat: [SIZE / 5, SIZE / 5] });
  const terrain = new THREE.Mesh(tg, new THREE.MeshLambertMaterial({ vertexColors: true, map: grassTex }));
  terrain.receiveShadow = true;
  root.add(terrain);

  // ───────── 강 ─────────
  const waterTex = canvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#3f8fd2'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 140; i++) {
      ctx.strokeStyle = `rgba(255,255,255,${0.08 + Math.random() * 0.2})`;
      ctx.lineWidth = 1 + Math.random() * 2;
      const x = Math.random() * w, y = Math.random() * h, l = 10 + Math.random() * 40;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 3, y + l / 2, x, y + l); ctx.stroke();
    }
  }, { repeat: [1, 1] });
  {
    const pos = [], uv = [], idx = [];
    const pts = course.river;
    for (let k = 0; k < pts.length; k++) {
      const [x, z] = pts[k];
      const [x2, z2] = pts[Math.min(pts.length - 1, k + 1)];
      const [x0, z0] = pts[Math.max(0, k - 1)];
      let dx = x2 - x0, dz = z2 - z0; const l = Math.hypot(dx, dz); dx /= l; dz /= l;
      const y = hillHeight(x, z) - 1.7;
      const hw = RIVER_W / 2 + 2.5;
      pos.push(x - dz * hw, y, z + dx * hw, x + dz * hw, y, z - dx * hw);
      uv.push(0, k * 0.3, 1, k * 0.3);
      if (k < pts.length - 1) { const i = k * 2; idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    root.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: waterTex, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.9, side: THREE.DoubleSide })));
  }

  // ───────── 도로 ─────────
  const roadTex = canvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#c75a3e'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 3000; i++) {
      ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255,150,120,0.22)' : 'rgba(110,30,15,0.22)';
      ctx.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5);
    }
    ctx.fillStyle = '#f4f1ea';
    ctx.fillRect(6, 0, 6, h); ctx.fillRect(w - 12, 0, 6, h);       // 가장자리 실선
    ctx.fillRect(w / 2 - 2, 0, 4, h * 0.45);                         // 가운데 점선
  });
  roadTex.wrapT = THREE.RepeatWrapping;
  const road = new THREE.Mesh(
    ribbon(course, 0, course.total, { latA: -halfW, latB: halfW, yA: 0.03, yB: 0.03, step: 1, vScale: 8 }),
    new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.92 })
  );
  road.receiveShadow = true;
  root.add(road);
  // 연석
  const curbMat = new THREE.MeshStandardMaterial({ color: '#e9e6df', roughness: 0.8, side: THREE.DoubleSide });
  for (const s of [-1, 1]) {
    const inner = s * halfW, outer = s * (halfW + 0.35);
    const top = new THREE.Mesh(ribbon(course, 0, course.total, { latA: Math.min(inner, outer), latB: Math.max(inner, outer), yA: 0.13, yB: 0.13, step: 2 }), curbMat);
    top.receiveShadow = true;
    const side = new THREE.Mesh(ribbon(course, 0, course.total, { latA: outer, latB: outer, yA: -0.5, yB: 0.13, step: 2 }), curbMat);
    root.add(top, side);
  }

  // ───────── 다리 ─────────
  const stoneMat = new THREE.MeshStandardMaterial({ color: '#9a8f80', roughness: 0.9, side: THREE.DoubleSide });
  const woodMat = new THREE.MeshStandardMaterial({ color: '#7a5233', roughness: 0.8, side: THREE.DoubleSide });
  const postGeo = new THREE.BoxGeometry(0.16, 1.1, 0.16);
  for (const br of course.bridges) {
    const d0 = br.from * course.step - 10, d1 = br.to * course.step + 10;
    for (const s of [-1, 1]) {
      const lat = s * (halfW + 0.45);
      root.add(new THREE.Mesh(ribbon(course, d0, d1, { latA: lat, latB: lat, yA: -1.3, yB: 0.2 }), stoneMat));   // 거더
      root.add(new THREE.Mesh(ribbon(course, d0, d1, { latA: lat, latB: lat, yA: 1.05, yB: 1.25 }), woodMat));   // 난간
      root.add(new THREE.Mesh(ribbon(course, d0, d1, { latA: lat, latB: lat, yA: 0.55, yB: 0.65 }), woodMat));
      for (let d = d0; d <= d1; d += 2) {
        const p = placeOn(new THREE.Mesh(postGeo, woodMat), course, d, lat, 0.7);
        p.castShadow = true;
        root.add(p);
      }
    }
    root.add(new THREE.Mesh(ribbon(course, d0, d1, { latA: halfW + 0.45, latB: -halfW - 0.45, yA: -1.3, yB: -1.3 }), stoneMat));
    const mid = ((br.from + br.to) / 2) * course.step;
    const pier = placeOn(new THREE.Mesh(new THREE.BoxGeometry(1.4, 4, halfW * 2 + 1), stoneMat), course, mid, 0, -3.3);
    root.add(pier);
  }

  // ───────── 아치 / 결승선 / 출발선 ─────────
  const archMat = new THREE.MeshStandardMaterial({ color: '#1b2a52', roughness: 0.5, metalness: 0.2 });
  function makeArch(label, bg) {
    const g = new THREE.Group();
    const pillarGeo = new THREE.BoxGeometry(0.6, 5.6, 0.6);
    for (const s of [-1, 1]) {
      const p = new THREE.Mesh(pillarGeo, archMat);
      p.position.set(0, 2.8, s * (halfW + 1.2));
      p.castShadow = true;
      g.add(p);
    }
    const bm = new THREE.MeshStandardMaterial({ map: textTex(label, { w: 1024, h: 128, bg, font: 86 }), roughness: 0.6 });
    const banner = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.4, halfW * 2 + 3), [bm, bm, archMat, archMat, archMat, archMat]);
    banner.position.y = 5.8;
    banner.castShadow = true;
    g.add(banner);
    return g;
  }
  root.add(placeOn(makeArch('FINISH', '#1b2a52'), course, course.finishD, 0));
  const checker = canvasTex(64, 64, (ctx) => {
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#111' : '#fff';
      ctx.fillRect(x * 16, y * 16, 16, 16);
    }
  }, { repeat: [5, 0.5] });
  root.add(new THREE.Mesh(
    ribbon(course, course.finishD - 0.6, course.finishD + 0.6, { latA: -halfW, latB: halfW, yA: 0.05, yB: 0.05, step: 1.2, vScale: 1.2 }),
    new THREE.MeshBasicMaterial({ map: checker })
  ));

  const startGroup = new THREE.Group();
  startGroup.add(makeArch('START', '#c0392b'));
  const startLine = new THREE.Mesh(new THREE.PlaneGeometry(0.25, halfW * 2), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  startLine.rotation.x = -Math.PI / 2;
  startLine.position.y = 0.06;
  startGroup.add(startLine);
  root.add(startGroup);

  // ───────── 남은 거리 표지판 ─────────
  const signs = [];
  const signPost = new THREE.BoxGeometry(0.1, 1.6, 0.1);
  const whiteMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6 });
  for (const left of [500, 400, 300, 200, 100, 50]) {
    const g = new THREE.Group();
    const tex = textTex(`${left}m`, { w: 256, h: 128, bg: '#ffffff', fg: '#1b2a52', font: 72, stripe: '#e2553a' });
    const board = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.9), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
    board.position.y = 2;
    board.rotation.y = -Math.PI / 2; // 다가오는 선수 쪽을 바라봄
    const post = new THREE.Mesh(signPost, whiteMat);
    post.position.y = 0.8;
    g.add(board, post);
    placeOn(g, course, course.finishD - left, -(halfW + 1.6));
    g.userData.d = course.finishD - left;
    signs.push(g);
    root.add(g);
  }

  // ───────── 관중석 + 광고판 (결승 직선) ─────────
  const standMat = new THREE.MeshStandardMaterial({ color: '#8f9bb3', roughness: 0.9 });
  const standD0 = course.finishD - 75, standLen = 85, standMid = standD0 + standLen / 2;
  const standY = course.point(standMid).y;
  const stand = new THREE.Group();
  const TIERS = 5;
  for (let t = 0; t < TIERS; t++) {
    const hgt = 0.6 + t * 0.6;
    const step = new THREE.Mesh(new THREE.BoxGeometry(standLen, hgt + 1, 1.4), standMat);
    step.position.set(0, hgt / 2 - 0.5, halfW + 4 + t * 1.4);
    step.receiveShadow = true; step.castShadow = true;
    stand.add(step);
  }
  placeOn(stand, course, standMid, 0);
  stand.position.y = standY;
  root.add(stand);

  const adTex = canvasTex(1024, 64, (ctx, w, h) => {
    const cols = ['#e2553a', '#1b2a52', '#ffcf3f', '#2f8f4e'];
    const words = ['RANDOM RACE', '랜덤 레이스', 'GO GO GO', '행운을 빌어요'];
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = cols[i]; ctx.fillRect(i * w / 4, 0, w / 4, h);
      ctx.fillStyle = i === 2 ? '#1b2a52' : '#fff';
      ctx.font = "900 34px 'Noto Sans KR', sans-serif";
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(words[i], i * w / 4 + w / 8, h / 2 + 2);
    }
  });
  adTex.wrapS = THREE.RepeatWrapping;
  // 도로 쪽에서 봤을 때 글씨가 바로 보이도록 오른쪽 광고판은 텍스처를 좌우 반전
  const adTexR = adTex.clone();
  adTexR.repeat.x = -1;
  for (const s of [-1, 1]) {
    const lat = s * (halfW + 1.3);
    const mat = new THREE.MeshBasicMaterial({ map: s > 0 ? adTexR : adTex, side: THREE.DoubleSide });
    root.add(new THREE.Mesh(ribbon(course, course.finishD - 110, course.finishD + 30, { latA: lat, latB: lat, yA: 0, yB: 0.9, step: 2, vScale: 24, alongU: true }), mat));
  }

  // ───────── 관중 (인스턴싱) ─────────
  const spots = [];
  const addCrowd = (d0, d1, side, rows, density) => {
    for (let d = d0; d < d1; d += 1 / density) {
      for (let r = 0; r < rows; r++) {
        if (Math.random() < 0.25) continue;
        const p = course.point(d + Math.random() * 0.6, side * (halfW + 2.3 + r * 0.9 + Math.random() * 0.3), TMP);
        if (riverDist(p.x, p.z) < RIVER_W / 2 + 3) continue;
        spots.push({ x: p.x, z: p.z, y: groundAt(p.x, p.z) });
      }
    }
  };
  // 관중석 위
  for (let d = standD0 + 2; d < standD0 + standLen - 2; d += 0.9) {
    for (let t = 1; t < TIERS; t++) {
      if (Math.random() < 0.2) continue;
      const p = course.point(d + Math.random() * 0.4, halfW + 4 + t * 1.4, TMP);
      spots.push({ x: p.x, z: p.z, y: standY + 0.1 + t * 0.6 });
    }
  }
  addCrowd(course.finishD - 105, course.finishD + 25, -1, 2, 1.3);
  for (const br of course.bridges) {
    addCrowd(br.from - 34, br.from - 14, 1, 2, 1);
    addCrowd(br.to + 14, br.to + 34, -1, 2, 1);
  }
  // 급커브 바깥쪽
  let lastCurve = -100;
  for (let i = 40; i < course.n - 140; i++) {
    const c = course.curv[i];
    if (Math.abs(c) > 0.035 && i - lastCurve > 45) { addCrowd(i - 6, i + 8, c > 0 ? 1 : -1, 2, 1.2); lastCurve = i; }
  }
  const crowdN = spots.length;
  const bodies = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.24, 0.55, 3, 8), new THREE.MeshLambertMaterial(), crowdN);
  const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.17, 10, 8), new THREE.MeshLambertMaterial(), crowdN);
  const pal = ['#e2553a', '#ffcf3f', '#3f86e0', '#ffffff', '#2f8f4e', '#9b5de5', '#f15bb5', '#00bbf9', '#222831', '#ff8c42'].map((c) => new THREE.Color(c));
  const skins = ['#f6d3b3', '#e0b08a', '#c68c62', '#8d5a3b'].map((c) => new THREE.Color(c));
  const m4 = new THREE.Matrix4();
  spots.forEach((s, i) => {
    s.ph = Math.random() * Math.PI * 2; s.sp = 4 + Math.random() * 5;
    bodies.setColorAt(i, pal[Math.floor(Math.random() * pal.length)]);
    heads.setColorAt(i, skins[Math.floor(Math.random() * skins.length)]);
  });
  bodies.castShadow = true;
  root.add(bodies, heads);
  function updateCrowd(t, excitement) {
    for (let i = 0; i < crowdN; i++) {
      const s = spots[i];
      const j = Math.max(0, Math.sin(t * s.sp + s.ph)) * (0.04 + excitement * 0.4);
      m4.makeTranslation(s.x, s.y + 0.52 + j, s.z);
      bodies.setMatrixAt(i, m4);
      m4.makeTranslation(s.x, s.y + 1.12 + j, s.z);
      heads.setMatrixAt(i, m4);
    }
    bodies.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
  }

  // ───────── 나무 / 덤불 / 바위 / 집 ─────────
  const pines = [], rounds = [], bushes = [], rocks = [];
  const nearStand = (x, z) => {
    const [dr, i] = nearestRoad(x, z);
    const d = i * course.step;
    return i >= 0 && d > standD0 - 12 && d < standD0 + standLen + 12 && dr < halfW + 16;
  };
  for (let k = 0; k < 12000 && pines.length + rounds.length < 1800; k++) {
    const x = cx + (Math.random() - 0.5) * SIZE * 0.95, z = cz + (Math.random() - 0.5) * SIZE * 0.95;
    const [dr] = nearestRoad(x, z);
    if (dr < halfW + 9 || riverDist(x, z) < RIVER_W / 2 + 6 || nearStand(x, z)) continue;
    const dens = 0.5 + 0.5 * Math.sin(x * 0.03) * Math.cos(z * 0.027 + 1); // 숲처럼 뭉치게
    if (Math.random() > dens * 0.9 + 0.1) continue;
    const t = { x, z, y: groundAt(x, z) - 0.1, s: 0.7 + Math.random() * 0.9, r: Math.random() * 6 };
    (Math.random() < 0.55 ? pines : rounds).push(t);
  }
  for (let k = 0; k < 4000 && bushes.length < 420; k++) {
    const d = Math.random() * course.total;
    if (Math.abs(d - course.finishD) < 120) continue;
    const p = course.point(d, (Math.random() < 0.5 ? -1 : 1) * (halfW + 2.5 + Math.random() * 5), TMP);
    if (riverDist(p.x, p.z) < RIVER_W / 2 + 4 || nearestRoad(p.x, p.z)[0] < halfW + 2) continue;
    bushes.push({ x: p.x, z: p.z, y: groundAt(p.x, p.z), s: 0.5 + Math.random() * 0.7, r: Math.random() * 6 });
  }
  for (let k = 0; k < 3000 && rocks.length < 170; k++) {
    const x = cx + (Math.random() - 0.5) * SIZE * 0.8, z = cz + (Math.random() - 0.5) * SIZE * 0.8;
    if (nearestRoad(x, z)[0] < halfW + 4) continue;
    if (riverDist(x, z) > RIVER_W / 2 + 9 && Math.random() < 0.7) continue;
    rocks.push({ x, z, y: groundAt(x, z), s: 0.4 + Math.random() * 1.3, r: Math.random() * 6 });
  }

  function instanced(list, geo, mat, yOff, { shadow = true, scaleY = 1 } = {}) {
    const im = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
    im.count = list.length;
    const o = new THREE.Object3D();
    list.forEach((t, i) => {
      o.position.set(t.x, t.y + yOff * t.s, t.z);
      o.rotation.set(0, t.r, 0);
      o.scale.set(t.s, t.s * scaleY, t.s);
      o.updateMatrix();
      im.setMatrixAt(i, o.matrix);
    });
    im.castShadow = shadow;
    im.receiveShadow = true;
    root.add(im);
  }
  const trunkMat = new THREE.MeshLambertMaterial({ color: '#6b4a2f' });
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.32, 2.4, 6);
  instanced(pines, trunkGeo, trunkMat, 1.2, { shadow: false });
  instanced(pines, new THREE.ConeGeometry(1.9, 5.2, 7), new THREE.MeshLambertMaterial({ color: '#2e6b3c', flatShading: true }), 4.4);
  instanced(pines, new THREE.ConeGeometry(1.4, 3.6, 7), new THREE.MeshLambertMaterial({ color: '#357a45', flatShading: true }), 6.4);
  instanced(rounds, trunkGeo, trunkMat, 1.2, { shadow: false });
  instanced(rounds, new THREE.IcosahedronGeometry(2.1, 1), new THREE.MeshLambertMaterial({ color: '#4f8f3a', flatShading: true }), 3.8);
  instanced(bushes, new THREE.IcosahedronGeometry(0.9, 1), new THREE.MeshLambertMaterial({ color: '#3f7f35', flatShading: true }), 0.35, { scaleY: 0.7 });
  instanced(rocks, new THREE.DodecahedronGeometry(0.8, 0), new THREE.MeshLambertMaterial({ color: '#8c8f93', flatShading: true }), 0.2, { scaleY: 0.6 });

  const wallMat = new THREE.MeshLambertMaterial({ color: '#efe3cf' });
  const roofMats = ['#b5462f', '#3d5a80', '#6d4c41'].map((c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true }));
  let houses = 0;
  for (let k = 0; k < 600 && houses < 9; k++) {
    const x = cx + (Math.random() - 0.5) * SIZE * 0.6, z = cz + (Math.random() - 0.5) * SIZE * 0.6;
    const [dr] = nearestRoad(x, z);
    if (dr < halfW + 22 || riverDist(x, z) < 22) continue;
    const g = new THREE.Group();
    const w = 5 + Math.random() * 3, dp = 4 + Math.random() * 2;
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, 3, dp), wallMat);
    body.position.y = 1.5; body.castShadow = true;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.hypot(w, dp) / 2 + 0.4, 2.4, 4), roofMats[houses % 3]);
    roof.position.y = 4.2; roof.rotation.y = Math.PI / 4; roof.castShadow = true;
    g.add(body, roof);
    g.position.set(x, groundAt(x, z) - 0.2, z);
    g.rotation.y = Math.random() * Math.PI;
    root.add(g);
    houses++;
  }

  // 결승 직선 깃발
  const flagCols = ['#e2553a', '#ffcf3f', '#3f86e0', '#2f8f4e'];
  const poleGeo = new THREE.CylinderGeometry(0.05, 0.05, 4, 6);
  const flagGeo = new THREE.PlaneGeometry(1.1, 0.7);
  const flags = [];
  for (let i = 0; i < 10; i++) {
    const g = placeOn(new THREE.Group(), course, course.finishD - 100 + i * 12, -(halfW + 2.4));
    g.position.y = groundAt(g.position.x, g.position.z);
    const pole = new THREE.Mesh(poleGeo, whiteMat); pole.position.y = 2;
    const flag = new THREE.Mesh(flagGeo, new THREE.MeshLambertMaterial({ color: flagCols[i % 4], side: THREE.DoubleSide }));
    flag.position.set(0.55, 3.6, 0);
    g.add(pole, flag);
    flags.push(flag);
    root.add(g);
  }

  // 먼 산
  const mtnMat = new THREE.MeshLambertMaterial({ color: '#86a4bd', flatShading: true, fog: false });
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + Math.random() * 0.2;
    const r = 620 + Math.random() * 120;
    const h = 60 + Math.random() * 90;
    const m = new THREE.Mesh(new THREE.ConeGeometry(70 + Math.random() * 70, h, 6), mtnMat);
    m.position.set(cx + Math.cos(a) * r, h / 2 - 10, cz + Math.sin(a) * r);
    m.rotation.y = Math.random() * 3;
    root.add(m);
  }
  // 구름
  const cloudMat = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#cfe0ee', emissiveIntensity: 0.45, fog: false });
  const puff = new THREE.IcosahedronGeometry(1, 1);
  for (let i = 0; i < 22; i++) {
    const g = new THREE.Group();
    const n = 3 + Math.floor(Math.random() * 3);
    for (let k = 0; k < n; k++) {
      const m = new THREE.Mesh(puff, cloudMat);
      const s = 7 + Math.random() * 8;
      m.scale.set(s * 1.4, s * 0.7, s);
      m.position.set(k * 9 - n * 4.5, Math.random() * 3, Math.random() * 5);
      g.add(m);
    }
    const a = Math.random() * Math.PI * 2, r = 250 + Math.random() * 350;
    g.position.set(cx + Math.cos(a) * r, 90 + Math.random() * 50, cz + Math.sin(a) * r);
    g.rotation.y = Math.random() * 3;
    root.add(g);
  }

  let time = 0;
  return {
    sun, groundAt,
    /** 레이스 거리에 맞춰 출발 아치 이동 */
    setStart(startD) {
      placeOn(startGroup, course, startD, 0);
      signs.forEach((s) => { s.visible = s.userData.d > startD + 5; });
    },
    update(dt, excitement, camera) {
      time += dt;
      updateCrowd(time, excitement);
      flags.forEach((f, i) => { f.rotation.y = Math.sin(time * 3 + i) * 0.35; });
      waterTex.offset.y -= dt * 0.12;
      sky.position.copy(camera.position);
    },
  };
}
