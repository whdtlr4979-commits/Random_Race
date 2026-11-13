import * as THREE from 'three';

const SKIN = ['#f6d3b3', '#eec19a', '#d9a47a', '#b97f55', '#8d5a3b', '#f3c9a6'];
const HAIR = ['#2b1d14', '#1c1c1c', '#5a3820', '#8a5a2b', '#d9a441', '#3b2a4a'];

const boxCache = new Map();
function box(w, h, d) {
  const key = `${w}|${h}|${d}`;
  if (!boxCache.has(key)) boxCache.set(key, new THREE.BoxGeometry(w, h, d));
  return boxCache.get(key);
}
const headGeo = new THREE.SphereGeometry(0.2, 20, 14);
const hairGeo = new THREE.SphereGeometry(0.212, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.55);
const eyeGeo = new THREE.SphereGeometry(0.028, 8, 6);
const starGeo = new THREE.OctahedronGeometry(0.09);
const darkMat = new THREE.MeshStandardMaterial({ color: '#1d2433', roughness: 0.8 });
const shoeMat = new THREE.MeshStandardMaterial({ color: '#f2f2f2', roughness: 0.6 });
const eyeMat = new THREE.MeshBasicMaterial({ color: '#111' });
const starMat = new THREE.MeshBasicMaterial({ color: '#ffd84a' });
const goldMat = new THREE.MeshStandardMaterial({ color: '#ffcf3f', metalness: 0.7, roughness: 0.25, emissive: '#5a3c00' });
const trailMat = new THREE.MeshBasicMaterial({ color: '#8fe3ff', transparent: true, opacity: 0.55, depthWrite: false });

function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

/** 이름표 스프라이트 (캔버스로 그림) */
function makeLabel(text, color) {
  const fontPx = 44;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const font = `900 ${fontPx}px 'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif`;
  ctx.font = font;
  const tw = Math.ceil(ctx.measureText(text).width);
  const padX = 22, h = 72;
  c.width = tw + padX * 2 + 24;
  c.height = h + 14;
  ctx.font = font;
  // 말풍선 몸통
  const w = c.width;
  const r = h / 2;
  ctx.fillStyle = 'rgba(12,20,40,0.88)';
  ctx.beginPath();
  ctx.moveTo(r, 0); ctx.lineTo(w - r, 0); ctx.arc(w - r, r, r, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(w / 2 + 10, h); ctx.lineTo(w / 2, h + 12); ctx.lineTo(w / 2 - 10, h);
  ctx.lineTo(r, h); ctx.arc(r, r, r, Math.PI / 2, -Math.PI / 2);
  ctx.fill();
  // 색 점
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(30, r, 11, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 30 + 20, r + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const s = new THREE.Sprite(mat);
  const scale = 0.0085;
  s.scale.set(c.width * scale, c.height * scale, 1);
  s.center.set(0.5, 0);
  s.renderOrder = 10;
  return s;
}

/** 등번호 텍스처 */
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

export class Runner {
  constructor({ name, color, index, z, rng }) {
    this.name = name;
    this.color = color;
    this.index = index;
    this.root = new THREE.Group();
    this.root.position.set(0, 0, z);

    const shirt = new THREE.MeshStandardMaterial({ color, roughness: 0.55 });
    const skin = new THREE.MeshStandardMaterial({ color: SKIN[Math.floor(rng() * SKIN.length)], roughness: 0.75 });
    const hair = new THREE.MeshStandardMaterial({ color: HAIR[Math.floor(rng() * HAIR.length)], roughness: 0.9 });
    this.materials = [shirt, skin, hair];

    // body: 넘어질 때 발끝을 축으로 회전하는 그룹
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.bob = new THREE.Group();
    this.body.add(this.bob);

    // 상체
    this.torso = new THREE.Group();
    this.torso.position.y = 0.95;
    this.bob.add(this.torso);
    this.torso.add(mesh(box(0.3, 0.62, 0.48), shirt, 0, 0.36, 0));
    this.torso.add(mesh(box(0.32, 0.22, 0.5), darkMat, 0, 0.02, 0));
    const bib = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.2), makeBib(index + 1));
    bib.position.set(0.152, 0.4, 0);
    bib.rotation.y = Math.PI / 2;
    this.torso.add(bib);
    this.materials.push(bib.material);

    // 머리
    this.head = new THREE.Group();
    this.head.position.y = 0.88;
    this.torso.add(this.head);
    this.head.add(mesh(box(0.12, 0.1, 0.12), skin, 0, -0.06, 0));
    this.head.add(mesh(headGeo, skin, 0, 0.12, 0));
    const hairMesh = mesh(hairGeo, hair, -0.02, 0.13, 0);
    hairMesh.rotation.z = 0.35;
    this.head.add(hairMesh);
    this.head.add(mesh(box(0.06, 0.06, 0.42), shirt, -0.01, 0.2, 0)); // 헤어밴드
    const eL = new THREE.Mesh(eyeGeo, eyeMat); eL.position.set(0.185, 0.14, 0.07);
    const eR = new THREE.Mesh(eyeGeo, eyeMat); eR.position.set(0.185, 0.14, -0.07);
    this.head.add(eL, eR);

    // 팔
    const makeArm = (side) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(0, 0.6, side * 0.3);
      shoulder.add(mesh(box(0.12, 0.34, 0.12), shirt, 0, -0.15, 0));
      const elbow = new THREE.Group();
      elbow.position.y = -0.32;
      elbow.add(mesh(box(0.11, 0.3, 0.11), skin, 0, -0.14, 0));
      shoulder.add(elbow);
      this.torso.add(shoulder);
      return { shoulder, elbow };
    };
    this.armL = makeArm(1);
    this.armR = makeArm(-1);

    // 다리
    const makeLeg = (side) => {
      const hip = new THREE.Group();
      hip.position.set(0, 0.92, side * 0.13);
      hip.add(mesh(box(0.17, 0.46, 0.17), skin, 0, -0.22, 0));
      const knee = new THREE.Group();
      knee.position.y = -0.45;
      knee.add(mesh(box(0.15, 0.42, 0.15), skin, 0, -0.2, 0));
      knee.add(mesh(box(0.28, 0.1, 0.17), shoeMat, 0.05, -0.43, 0));
      hip.add(knee);
      this.bob.add(hip);
      return { hip, knee };
    };
    this.legL = makeLeg(1);
    this.legR = makeLeg(-1);

    // 이름표
    this.label = makeLabel(name, color);
    this.label.position.y = 2.25 + (index % 2) * 0.55;
    this.labelBase = this.label.scale.clone();
    this.root.add(this.label);

    // 부스터 잔상
    this.trail = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const t = new THREE.Mesh(box(1.2, 0.05, 0.05), trailMat);
      t.position.set(-0.9 - i * 0.2, 0.7 + i * 0.4, (i - 1) * 0.25);
      this.trail.add(t);
    }
    this.trail.visible = false;
    this.root.add(this.trail);

    // 넘어졌을 때 머리 위 별
    this.stars = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Mesh(starGeo, starMat);
      const a = (i / 3) * Math.PI * 2;
      s.position.set(Math.cos(a) * 0.32, 0, Math.sin(a) * 0.32);
      this.stars.add(s);
    }
    this.stars.visible = false;
    this.root.add(this.stars);

    // 당첨 왕관
    this.crown = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.18, 0.12, 16, 1, true), goldMat);
    ring.material.side = THREE.DoubleSide;
    this.crown.add(ring);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 6), goldMat);
      spike.position.set(Math.cos(a) * 0.18, 0.13, Math.sin(a) * 0.18);
      this.crown.add(spike);
    }
    this.crown.visible = false;
    this.crown.position.y = 2.15;
    this.root.add(this.crown);

    this.phase = rng() * Math.PI * 2;
    this.idleT = rng() * 10;
    this.fallAmount = 0; // 0 = 서 있음, 1 = 완전히 엎어짐
  }

  get x() { return this.root.position.x; }
  set x(v) { this.root.position.x = v; }

  /** 매 프레임 포즈 갱신. state: idle | ready | run | celebrate */
  animate(dt, { state, speed = 0, fall = 0, boost = false, time = 0 }) {
    const L = this.legL, R = this.legR, aL = this.armL, aR = this.armR;
    this.fallAmount = fall;

    if (state === 'run') {
      const intensity = Math.min(1, speed / 6);
      this.phase += dt * (4 + speed * 1.15);
      const s = Math.sin(this.phase);
      const sw = 0.95 * intensity;
      L.hip.rotation.z = s * sw;
      R.hip.rotation.z = -s * sw;
      L.knee.rotation.z = -(0.2 + 1.3 * Math.max(0, Math.sin(this.phase + Math.PI * 0.55))) * intensity;
      R.knee.rotation.z = -(0.2 + 1.3 * Math.max(0, Math.sin(this.phase + Math.PI * 1.55))) * intensity;
      aL.shoulder.rotation.z = -s * 0.85 * intensity;
      aR.shoulder.rotation.z = s * 0.85 * intensity;
      aL.elbow.rotation.z = aR.elbow.rotation.z = 1.35;
      aL.shoulder.rotation.x = aR.shoulder.rotation.x = 0;
      this.torso.rotation.z = -0.18 * intensity - (boost ? 0.12 : 0);
      this.bob.position.y = Math.abs(Math.cos(this.phase)) * 0.09 * intensity;
    } else if (state === 'ready') {
      // 출발 자세: 살짝 웅크림
      this.idleT += dt;
      L.hip.rotation.z = 0.55; R.hip.rotation.z = -0.35;
      L.knee.rotation.z = -0.8; R.knee.rotation.z = -0.5;
      aL.shoulder.rotation.z = -0.6; aR.shoulder.rotation.z = 0.6;
      aL.elbow.rotation.z = aR.elbow.rotation.z = 1.2;
      aL.shoulder.rotation.x = aR.shoulder.rotation.x = 0;
      this.torso.rotation.z = -0.45;
      this.bob.position.y = -0.14 + Math.sin(this.idleT * 3) * 0.01;
    } else if (state === 'celebrate') {
      this.idleT += dt;
      const j = Math.abs(Math.sin(this.idleT * 5.5));
      this.bob.position.y = j * 0.45;
      L.hip.rotation.z = R.hip.rotation.z = -0.1 * j;
      L.knee.rotation.z = R.knee.rotation.z = -0.4 * (1 - j);
      aL.shoulder.rotation.z = aR.shoulder.rotation.z = 2.9;
      aL.shoulder.rotation.x = -0.35 - Math.sin(this.idleT * 11) * 0.15;
      aR.shoulder.rotation.x = 0.35 + Math.sin(this.idleT * 11) * 0.15;
      aL.elbow.rotation.z = aR.elbow.rotation.z = 0.15;
      this.torso.rotation.z = 0.05;
    } else {
      // idle: 숨쉬기
      this.idleT += dt;
      const b = Math.sin(this.idleT * 2.2);
      L.hip.rotation.z = R.hip.rotation.z = 0;
      L.knee.rotation.z = R.knee.rotation.z = 0;
      aL.shoulder.rotation.z = 0.08 + b * 0.04;
      aR.shoulder.rotation.z = -0.08 - b * 0.04;
      aL.shoulder.rotation.x = -0.12; aR.shoulder.rotation.x = 0.12;
      aL.elbow.rotation.z = aR.elbow.rotation.z = 0.2;
      this.torso.rotation.z = 0;
      this.bob.position.y = b * 0.012;
    }

    // 넘어짐 (발끝 기준으로 앞으로 엎어짐)
    const f = fall;
    this.body.rotation.z = -1.45 * easeInOut(f);
    this.body.position.x = 0.15 * f;
    this.body.position.y = 0.12 * Math.sin(f * Math.PI);
    if (f > 0.01 && state === 'run') {
      // 엎어진 동안 팔다리 버둥
      L.hip.rotation.z = Math.sin(time * 18) * 0.4 * f;
      R.hip.rotation.z = -Math.sin(time * 18) * 0.4 * f;
      aL.shoulder.rotation.z = 2.4 * f;
      aR.shoulder.rotation.z = 2.4 * f;
    }
    this.stars.visible = f > 0.6;
    if (this.stars.visible) {
      this.stars.position.set(1.85, 0.45, 0);
      this.stars.rotation.y += dt * 6;
    }

    this.trail.visible = boost;
    if (boost) {
      this.trail.children.forEach((t, i) => {
        t.scale.x = 0.6 + Math.abs(Math.sin(time * 20 + i * 2)) * 0.8;
      });
    }

    if (this.crown.visible) {
      this.crown.rotation.y += dt * 2;
      this.crown.position.y = 2.17 + this.bob.position.y;
    }
    this.label.visible = f < 0.5;
  }

  /** 이름표가 멀면 너무 작고 가까우면 너무 커지지 않도록 거리에 맞춰 크기 조절 */
  fitLabel(cameraPos) {
    const d = cameraPos.distanceTo(this.root.position);
    const k = Math.min(1.8, Math.max(0.4, d / 12));
    this.label.scale.set(this.labelBase.x * k, this.labelBase.y * k, 1);
  }

  dispose() {
    this.root.traverse((o) => {
      if (o.isSprite) { o.material.map.dispose(); o.material.dispose(); }
    });
    this.materials.forEach((m) => { m.map?.dispose(); m.dispose(); });
  }
}

function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
