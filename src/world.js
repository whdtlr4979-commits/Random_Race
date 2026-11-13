import * as THREE from 'three';

export const LANE_W = 1.5;
const RUNOUT = 40;   // 결승선 뒤 감속 구간
const PRE = 18;      // 출발선 뒤 여유

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

/** 하늘, 조명, 잔디처럼 레이스마다 바뀌지 않는 환경 */
export function createEnvironment(scene) {
  // 하늘 그라데이션 돔
  const skyGeo = new THREE.SphereGeometry(600, 32, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color('#3f86e0') },
      mid: { value: new THREE.Color('#9fd0f5') },
      bottom: { value: new THREE.Color('#e9f3f7') },
    },
    vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; varying vec3 vP;
      void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(mid, top, smoothstep(0.0, 0.55, h)) : mix(mid, bottom, smoothstep(0.0, 0.2, -h));
      gl_FragColor = vec4(c, 1.0); }`,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  scene.add(sky);
  scene.fog = new THREE.Fog('#bcdcf2', 90, 320);

  const hemi = new THREE.HemisphereLight('#dff1ff', '#4c7a3a', 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff4de', 2.4);
  sun.position.set(-20, 40, 25);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -40; sc.right = 40; sc.top = 40; sc.bottom = -40; sc.near = 1; sc.far = 140;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  // 잔디 (줄무늬 깎은 자국)
  const grassTex = canvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#3f9a52'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#378c49'; ctx.fillRect(0, 0, w / 2, h);
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = `rgba(${20 + Math.random() * 40},${90 + Math.random() * 60},${40 + Math.random() * 30},0.35)`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
  }, { repeat: [60, 60] });
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1200, 1200),
    new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  ground.receiveShadow = true;
  scene.add(ground);

  // 먼 구름
  const cloudMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, emissive: '#c9def0', emissiveIntensity: 0.35 });
  const puff = new THREE.IcosahedronGeometry(1, 1);
  for (let i = 0; i < 14; i++) {
    const g = new THREE.Group();
    const n = 3 + Math.floor(Math.random() * 3);
    for (let k = 0; k < n; k++) {
      const m = new THREE.Mesh(puff, cloudMat);
      const s = 5 + Math.random() * 6;
      m.scale.set(s * 1.4, s * 0.8, s);
      m.position.set(k * 7 - n * 3.5, Math.random() * 2, Math.random() * 4);
      g.add(m);
    }
    g.position.set(-150 + Math.random() * 450, 60 + Math.random() * 40, -200 - Math.random() * 120);
    scene.add(g);
  }

  return { sun };
}

/** 레인 수와 거리에 맞춘 트랙/관중석/결승선 */
export function createTrack(scene, { lanes, length }) {
  const group = new THREE.Group();
  const disposables = [];
  const W = lanes * LANE_W;
  const halfW = W / 2;
  const x0 = -PRE, x1 = length + RUNOUT;
  const trackLen = x1 - x0;

  const keep = (o) => { disposables.push(o); return o; };

  // 트랙 바닥 (우레탄 질감)
  const trackTex = keep(canvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#d8553b'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 2200; i++) {
      const v = Math.random();
      ctx.fillStyle = v > 0.5 ? 'rgba(255,140,110,0.25)' : 'rgba(120,30,15,0.25)';
      ctx.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5);
    }
  }, { repeat: [trackLen / 4, (W + 3) / 4] }));
  const trackMat = keep(new THREE.MeshStandardMaterial({ map: trackTex, roughness: 0.95 }));
  const track = new THREE.Mesh(keep(new THREE.PlaneGeometry(trackLen, W + 3)), trackMat);
  track.rotation.x = -Math.PI / 2;
  track.position.set((x0 + x1) / 2, 0, 0);
  track.receiveShadow = true;
  group.add(track);

  // 연석(트랙 가장자리)
  const curbMat = keep(new THREE.MeshStandardMaterial({ color: '#f2f2ee', roughness: 0.7 }));
  const curbGeo = keep(new THREE.BoxGeometry(trackLen, 0.12, 0.25));
  for (const s of [-1, 1]) {
    const c = new THREE.Mesh(curbGeo, curbMat);
    c.position.set((x0 + x1) / 2, 0.06, s * (halfW + 1.6));
    c.receiveShadow = true;
    group.add(c);
  }

  // 레인 라인
  const lineMat = keep(new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  const lineGeo = keep(new THREE.PlaneGeometry(trackLen, 0.06));
  for (let i = 0; i <= lanes; i++) {
    const l = new THREE.Mesh(lineGeo, lineMat);
    l.rotation.x = -Math.PI / 2;
    l.position.set((x0 + x1) / 2, 0.005, -halfW + i * LANE_W);
    group.add(l);
  }

  // 출발선
  const start = new THREE.Mesh(keep(new THREE.PlaneGeometry(0.12, W)), lineMat);
  start.rotation.x = -Math.PI / 2;
  start.position.set(0, 0.006, 0);
  group.add(start);

  // 레인 번호 (출발선 뒤 바닥에 그림)
  for (let i = 0; i < lanes; i++) {
    const tex = keep(canvasTex(128, 128, (ctx) => {
      ctx.fillStyle = '#ffffff';
      ctx.font = "900 96px 'Noto Sans KR', sans-serif";
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), 64, 70);
    }));
    const m = new THREE.Mesh(keep(new THREE.PlaneGeometry(1, 1)), keep(new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.85 })));
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = -Math.PI / 2;
    m.position.set(-1.6, 0.007, laneZ(i, lanes));
    group.add(m);
  }

  // 결승선 (체커 무늬)
  const checker = keep(canvasTex(64, 512, (ctx, w, h) => {
    const s = 16;
    for (let y = 0; y < h; y += s) for (let x = 0; x < w; x += s) {
      ctx.fillStyle = ((x + y) / s) % 2 ? '#111' : '#fff';
      ctx.fillRect(x, y, s, s);
    }
  }, { repeat: [1, Math.max(1, W / 8)] }));
  const finish = new THREE.Mesh(keep(new THREE.PlaneGeometry(1, W)), keep(new THREE.MeshBasicMaterial({ map: checker })));
  finish.rotation.x = -Math.PI / 2;
  finish.position.set(length, 0.008, 0);
  group.add(finish);

  // 결승 아치
  const archMat = keep(new THREE.MeshStandardMaterial({ color: '#1b2a52', roughness: 0.5, metalness: 0.2 }));
  const pillarGeo = keep(new THREE.BoxGeometry(0.5, 5.2, 0.5));
  for (const s of [-1, 1]) {
    const p = new THREE.Mesh(pillarGeo, archMat);
    p.position.set(length, 2.6, s * (halfW + 2.1));
    p.castShadow = true;
    group.add(p);
  }
  const bannerTex = keep(canvasTex(1024, 128, (ctx, w, h) => {
    ctx.fillStyle = '#1b2a52'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ffcf3f'; ctx.fillRect(0, h - 14, w, 14); ctx.fillRect(0, 0, w, 6);
    ctx.fillStyle = '#ffffff';
    ctx.font = "900 84px 'Black Han Sans', 'Noto Sans KR', sans-serif";
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('FINISH', w / 2, h / 2);
  }));
  bannerTex.wrapS = THREE.RepeatWrapping;
  bannerTex.repeat.set(Math.max(1, Math.round(W / 10)), 1);
  const bannerMat = keep(new THREE.MeshStandardMaterial({ map: bannerTex, roughness: 0.6 }));
  // BoxGeometry 면 순서: +x, -x, +y, -y, +z, -z → 글씨가 들어갈 넓은 면은 ±x
  const banner = new THREE.Mesh(keep(new THREE.BoxGeometry(0.4, 1.3, W + 4.7)), [bannerMat, bannerMat, archMat, archMat, archMat, archMat]);
  banner.position.set(length, 5.4, 0);
  banner.castShadow = true;
  group.add(banner);

  // 거리 표지판 (먼 쪽 연석 옆)
  const signMat = keep(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6 }));
  const postGeo = keep(new THREE.BoxGeometry(0.08, 1, 0.08));
  const step = length > 120 ? 20 : 10;
  for (let d = step; d < length; d += step) {
    const tex = keep(canvasTex(256, 128, (ctx, w, h) => {
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#1b2a52';
      ctx.font = "900 72px 'Noto Sans KR', sans-serif";
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(`${d}m`, w / 2, h / 2 + 4);
    }));
    const board = new THREE.Mesh(keep(new THREE.PlaneGeometry(1.4, 0.7)), keep(new THREE.MeshBasicMaterial({ map: tex })));
    board.position.set(d, 1.3, -(halfW + 2.2));
    group.add(board);
    const post = new THREE.Mesh(postGeo, signMat);
    post.position.set(d, 0.5, -(halfW + 2.25));
    group.add(post);
  }

  // 관중석 (먼 쪽)
  const standMat = keep(new THREE.MeshStandardMaterial({ color: '#8f9bb3', roughness: 0.9 }));
  const standBack = halfW + 4;
  const tiers = 5;
  const standLen = trackLen + 10;
  for (let t = 0; t < tiers; t++) {
    const step = new THREE.Mesh(keep(new THREE.BoxGeometry(standLen, 0.6 + t * 0.6, 1.4)), standMat);
    step.position.set((x0 + x1) / 2, (0.6 + t * 0.6) / 2, -(standBack + t * 1.4));
    step.receiveShadow = true;
    group.add(step);
  }
  // 관중석 지붕 기둥 + 광고판
  const boardTex = keep(canvasTex(1024, 64, (ctx, w, h) => {
    const cols = ['#e2553a', '#1b2a52', '#ffcf3f', '#2f8f4e'];
    const words = ['RANDOM RACE', '랜덤 레이스', 'GO GO GO', '행운을 빌어요'];
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = cols[i]; ctx.fillRect(i * w / 4, 0, w / 4, h);
      ctx.fillStyle = i === 2 ? '#1b2a52' : '#fff';
      ctx.font = "900 34px 'Noto Sans KR', sans-serif";
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(words[i], i * w / 4 + w / 8, h / 2 + 2);
    }
  }));
  boardTex.wrapS = THREE.RepeatWrapping;
  boardTex.repeat.set(Math.round(standLen / 24), 1);
  const ad = new THREE.Mesh(keep(new THREE.PlaneGeometry(standLen, 0.8)), keep(new THREE.MeshBasicMaterial({ map: boardTex })));
  ad.position.set((x0 + x1) / 2, 0.4, -(halfW + 3.25));
  group.add(ad);

  // 관중 (인스턴싱)
  const perMeter = 1.1;
  const crowdCount = Math.floor(standLen * perMeter * (tiers - 1));
  const crowdGeo = keep(new THREE.CapsuleGeometry(0.22, 0.4, 3, 6));
  const crowdMat = keep(new THREE.MeshStandardMaterial({ roughness: 0.8 }));
  const crowd = new THREE.InstancedMesh(crowdGeo, crowdMat, crowdCount);
  const palette = ['#e2553a', '#ffcf3f', '#3f86e0', '#ffffff', '#2f8f4e', '#9b5de5', '#f15bb5', '#00bbf9', '#222831'].map((c) => new THREE.Color(c));
  const base = [];
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < crowdCount; i++) {
    const t = 1 + (i % (tiers - 1));
    const x = x0 - 5 + Math.random() * standLen;
    const y = 0.6 + t * 0.6 + 0.42;
    const z = -(standBack + t * 1.4) + (Math.random() - 0.5) * 0.5;
    base.push({ x, y, z, ph: Math.random() * Math.PI * 2, sp: 4 + Math.random() * 5 });
    m4.makeTranslation(x, y, z);
    crowd.setMatrixAt(i, m4);
    crowd.setColorAt(i, palette[Math.floor(Math.random() * palette.length)]);
  }
  crowd.castShadow = true;
  group.add(crowd);

  // 나무 (관중석 뒤)
  const trunkGeo = keep(new THREE.CylinderGeometry(0.2, 0.28, 2, 6));
  const leafGeo = keep(new THREE.ConeGeometry(1.6, 4, 7));
  const trunkMat = keep(new THREE.MeshStandardMaterial({ color: '#6b4a2f' }));
  const leafMat = keep(new THREE.MeshStandardMaterial({ color: '#2c6e3f', roughness: 0.9 }));
  for (let x = x0 - 10; x < x1 + 20; x += 6 + Math.random() * 6) {
    const z = -(standBack + tiers * 1.4 + 4 + Math.random() * 10);
    const s = 0.8 + Math.random() * 0.8;
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.set(x, 1 * s, z); trunk.scale.setScalar(s);
    const leaf = new THREE.Mesh(leafGeo, leafMat);
    leaf.position.set(x, 3.6 * s, z); leaf.scale.setScalar(s);
    leaf.castShadow = true;
    group.add(trunk, leaf);
  }

  // 결승선 옆 깃발들
  const flagCols = ['#e2553a', '#ffcf3f', '#3f86e0', '#2f8f4e'];
  const poleGeo = keep(new THREE.CylinderGeometry(0.04, 0.04, 3.4, 6));
  const flagGeo = keep(new THREE.PlaneGeometry(0.9, 0.55));
  const flags = [];
  for (let i = 0; i < 8; i++) {
    const fx = length - 30 + i * 8;
    const pole = new THREE.Mesh(poleGeo, signMat);
    pole.position.set(fx, 1.7, -(halfW + 2.6));
    const flag = new THREE.Mesh(flagGeo, keep(new THREE.MeshStandardMaterial({ color: flagCols[i % 4], side: THREE.DoubleSide })));
    flag.position.set(fx + 0.45, 3.1, -(halfW + 2.6));
    flags.push(flag);
    group.add(pole, flag);
  }

  scene.add(group);

  let crowdT = 0;
  return {
    width: W,
    finishX: length,
    /** excitement 0~1: 관중이 들썩이는 정도 */
    update(dt, excitement) {
      crowdT += dt;
      for (let i = 0; i < crowdCount; i++) {
        const b = base[i];
        const jump = Math.max(0, Math.sin(crowdT * b.sp + b.ph)) * (0.05 + excitement * 0.35);
        m4.makeTranslation(b.x, b.y + jump, b.z);
        crowd.setMatrixAt(i, m4);
      }
      crowd.instanceMatrix.needsUpdate = true;
      flags.forEach((f, i) => { f.rotation.y = Math.sin(crowdT * 3 + i) * 0.35; });
    },
    dispose() {
      scene.remove(group);
      crowd.dispose();
      disposables.forEach((d) => d.dispose());
    },
  };
}

export function laneZ(i, lanes) {
  return -((lanes - 1) * LANE_W) / 2 + i * LANE_W;
}
