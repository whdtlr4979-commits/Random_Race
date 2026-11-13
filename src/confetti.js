import * as THREE from 'three';

const COUNT = 500;
const COLORS = ['#e2553a', '#ffcf3f', '#3f86e0', '#2f8f4e', '#f15bb5', '#ffffff', '#00bbf9'];

/** 결승선 위로 쏟아지는 색종이 */
export function createConfetti(scene) {
  const geo = new THREE.PlaneGeometry(0.16, 0.1);
  const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const mesh = new THREE.InstancedMesh(geo, mat, COUNT);
  mesh.frustumCulled = false;
  mesh.visible = false;
  scene.add(mesh);
  const col = new THREE.Color();
  for (let i = 0; i < COUNT; i++) mesh.setColorAt(i, col.set(COLORS[i % COLORS.length]));

  const parts = Array.from({ length: COUNT }, () => ({
    p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), rv: new THREE.Vector3(),
  }));
  const dummy = new THREE.Object3D();
  let active = false;
  let life = 0;

  return {
    /** center: 결승선 중심, heading: 코스 방향(라디안), width: 도로 폭 */
    burst(center, heading, width) {
      active = true; life = 0; mesh.visible = true;
      const fx = Math.cos(heading), fz = -Math.sin(heading); // 진행 방향
      for (const q of parts) {
        const a = (Math.random() - 0.5) * 8, b = (Math.random() - 0.5) * (width + 4);
        q.p.set(center.x + fx * a - fz * b, center.y + 6 + Math.random() * 4, center.z + fz * a + fx * b);
        q.floor = center.y + 0.05;
        q.v.set((Math.random() - 0.5) * 6, 4 + Math.random() * 6, (Math.random() - 0.5) * 6);
        q.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
        q.rv.set(Math.random() * 10, Math.random() * 10, Math.random() * 10);
      }
    },
    stop() { active = false; mesh.visible = false; },
    update(dt) {
      if (!active) return;
      life += dt;
      for (let i = 0; i < COUNT; i++) {
        const q = parts[i];
        q.v.y -= 9 * dt;
        q.v.multiplyScalar(1 - 1.8 * dt);           // 공기저항
        q.v.y = Math.max(q.v.y, -1.6);
        q.p.addScaledVector(q.v, dt);
        q.p.x += Math.sin(life * 2 + i) * dt * 0.6;  // 팔랑팔랑
        if (q.p.y < q.floor) { q.p.y = q.floor; q.v.set(0, 0, 0); q.rv.set(0, 0, 0); q.r.x = -Math.PI / 2; }
        q.r.x += q.rv.x * dt; q.r.y += q.rv.y * dt; q.r.z += q.rv.z * dt;
        dummy.position.copy(q.p);
        dummy.rotation.copy(q.r);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}
