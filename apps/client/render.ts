import * as THREE from 'three';
import { PALETTE, radius, getCell, type Snapshot, type Vec3 } from '../../packages/core';
import { cellHighlight } from './highlight';
export class ArenaRenderer {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(75, 1, 0.05, 220);
  rig = new THREE.Group();
  cells = new Map<string, THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>>();
  halos = new Map<string, THREE.Sprite>();
  glowTexture = this.makeGlowTexture();
  labels = new Map<string, THREE.Sprite>();
  geometry = new THREE.SphereGeometry(1, 24, 16);
  food: THREE.InstancedMesh;
  shell = new THREE.Group();
  dummy = new THREE.Object3D();
  menuTime = 0;
  foodKey = '';
  preview = new THREE.Group();
  backgroundStars: THREE.Points;
  constructor(public container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.4;
    container.append(this.renderer.domElement);
    this.renderer.domElement.setAttribute('aria-label', 'Тривимірна ігрова арена');
    this.scene.background = new THREE.Color('#050b15');
    this.scene.fog = new THREE.FogExp2('#071421', 0.009);
    this.rig.add(this.camera);
    this.scene.add(this.rig);
    this.scene.add(new THREE.HemisphereLight(0xbbeeff, 0x24304c, 2.3));
    const key = new THREE.DirectionalLight(0xffeee3, 3);
    key.position.set(15, 30, 10);
    this.scene.add(key);
    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(80, 80, 80)),
      new THREE.LineBasicMaterial({ color: 0x45667b, transparent: true, opacity: 0.55 }),
    );
    this.scene.add(edge);
    const grid = new THREE.GridHelper(80, 20, 0x356177, 0x142c40);
    grid.position.y = -40;
    this.scene.add(grid);
    const ceiling = grid.clone();
    ceiling.position.y = 40;
    this.scene.add(ceiling);
    const wall = grid.clone();
    wall.rotation.x = Math.PI / 2;
    wall.position.set(0, 0, -40);
    this.scene.add(wall);
    const side = grid.clone();
    side.rotation.z = Math.PI / 2;
    side.position.set(-40, 0, 0);
    this.scene.add(side);
    const starPositions = new Float32Array(1500 * 3);
    // Decorative deterministic star field, outside collision space.
    let seed = 123;
    for (let i = 0; i < starPositions.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      starPositions[i] = (seed / 4294967296 - 0.5) * 300;
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    this.backgroundStars = new THREE.Points(
      starGeometry,
      new THREE.PointsMaterial({ color: 0xa3cbe3, size: 0.12, transparent: true, opacity: 0.65 }),
    );
    this.scene.add(this.backgroundStars);
    this.food = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.24, 1),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
      1200,
    );
    this.food.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.food.frustumCulled = false;
    this.scene.add(this.food);
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1, 0.006, 3, 64),
        new THREE.MeshBasicMaterial({ color: 0x63efd0, transparent: true, opacity: 0.14 }),
      );
      if (i === 0) ring.rotation.x = Math.PI / 2;
      if (i === 1) ring.rotation.y = Math.PI / 2;
      this.shell.add(ring);
    }
    this.scene.add(this.shell);
    const hero = new THREE.Mesh(
      this.geometry,
      new THREE.MeshStandardMaterial({
        color: 0x70efd0,
        emissive: 0x246e5b,
        emissiveIntensity: 0.35,
        roughness: 0.25,
        metalness: 0.12,
      }),
    );
    hero.scale.setScalar(2.6);
    this.preview.add(hero);
    const orbit = new THREE.Mesh(
      new THREE.TorusGeometry(3.8, 0.018, 6, 128),
      new THREE.MeshBasicMaterial({ color: 0x70efd0, transparent: true, opacity: 0.28 }),
    );
    orbit.rotation.set(1, 0.3, 0.2);
    this.preview.add(orbit);
    for (let i = 0; i < 6; i++) {
      const orb = new THREE.Mesh(
        this.geometry,
        new THREE.MeshStandardMaterial({
          color: PALETTE[i + 1],
          emissive: PALETTE[i + 1],
          emissiveIntensity: 0.2,
          roughness: 0.4,
        }),
      );
      const a = (i * Math.PI) / 3;
      orb.position.set(Math.cos(a) * 4, Math.sin(a) * 3, -1 + Math.sin(a) * 2);
      orb.scale.setScalar(i === 0 ? 0.8 : 0.2 + i * 0.07);
      this.preview.add(orb);
    }
    this.preview.position.set(5.2, 0.1, -13);
    this.camera.add(this.preview);
    this.resize();
  }
  resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
  }
  quality(low: boolean) {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, low ? 1 : 1.5));
    this.resize();
  }
  private makeGlowTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(255,255,255,0)');
    gradient.addColorStop(0.58, 'rgba(255,255,255,0)');
    gradient.addColorStop(0.72, 'rgba(255,255,255,0.8)');
    gradient.addColorStop(0.82, 'rgba(255,255,255,0.3)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(canvas);
  }
  makeLabel(text: string, color: number) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.font = '600 25px system-ui';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
    ctx.fillText(text, 128, 40);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(canvas),
        transparent: true,
        depthTest: false,
      }),
    );
    sprite.scale.set(3.8, 0.95, 1);
    return sprite;
  }
  sync(state: Snapshot, playerId: string | null, previous?: Snapshot, alpha = 1) {
    const visible = new Set<string>();
    const own = getCell(state, playerId);
    for (const c of state.cells) {
      if (c.actorId === playerId) continue;
      visible.add(c.id);
      let mesh = this.cells.get(c.id);
      const actor = state.actors.find((a) => a.id === c.actorId)!;
      if (!mesh) {
        mesh = new THREE.Mesh(
          this.geometry,
          new THREE.MeshStandardMaterial({
            color: actor.color,
            emissive: actor.color,
            emissiveIntensity: 0.22,
            roughness: 0.25,
            metalness: 0.18,
          }),
        );
        const halo = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: this.glowTexture,
            transparent: true,
            depthWrite: false,
            depthTest: true,
            blending: THREE.AdditiveBlending,
            toneMapped: false,
          }),
        );
        halo.scale.set(2.8, 2.8, 1);
        mesh.add(halo);
        this.halos.set(c.id, halo);
        this.cells.set(c.id, mesh);
        this.scene.add(mesh);
        const label = this.makeLabel(actor.name, actor.color);
        this.labels.set(c.id, label);
        this.scene.add(label);
      }
      const old = previous?.cells.find((x) => x.id === c.id);
      mesh.position.set(c.position.x, c.position.y, c.position.z);
      if (old)
        mesh.position.lerp(
          new THREE.Vector3(old.position.x, old.position.y, old.position.z),
          1 - alpha,
        );
      const r = radius(c.mass);
      mesh.scale.setScalar(r);
      const highlight = cellHighlight(own, c, state.tick);
      const halo = this.halos.get(c.id)!;
      halo.visible = highlight.intensity > 0;
      halo.material.color.setHex(highlight.kind === 'danger' ? 0xff3547 : 0x38ff80);
      halo.material.opacity = highlight.intensity * 0.9;
      mesh.material.emissive.setHex(actor.color);
      if (halo.visible) mesh.material.emissive.lerp(halo.material.color, highlight.intensity);
      mesh.material.emissiveIntensity =
        c.protectedUntil > state.tick ? 0.65 : 0.2 + highlight.intensity * 0.45;
      const label = this.labels.get(c.id)!;
      label.position.copy(mesh.position);
      label.position.y += r + 0.8;
      label.visible =
        mesh.position.distanceTo(this.camera.getWorldPosition(new THREE.Vector3())) < 30;
    }
    for (const [id, mesh] of this.cells)
      if (!visible.has(id)) {
        this.scene.remove(mesh);
        mesh.material.dispose();
        this.halos.get(id)!.material.dispose();
        this.halos.delete(id);
        this.cells.delete(id);
        const label = this.labels.get(id)!;
        this.scene.remove(label);
        label.material.map?.dispose();
        label.material.dispose();
        this.labels.delete(id);
      }
    const foodKey = state.food.map((f) => f.id).join(',') + '@' + state.food[0]?.position.x;
    if (foodKey !== this.foodKey) {
      this.foodKey = foodKey;
      this.food.count = Math.min(state.food.length, 1200);
      for (let i = 0; i < this.food.count; i++) {
        const f = state.food[i];
        this.dummy.position.set(f.position.x, f.position.y, f.position.z);
        this.dummy.rotation.set(i * 0.37, i * 0.19, 0);
        this.dummy.updateMatrix();
        this.food.setMatrixAt(i, this.dummy.matrix);
        this.food.setColorAt(i, new THREE.Color(PALETTE[f.color % PALETTE.length]));
      }
      this.food.instanceMatrix.needsUpdate = true;
      if (this.food.instanceColor) this.food.instanceColor.needsUpdate = true;
    }
    this.shell.visible = !!own;
    if (own) {
      this.shell.position.set(own.position.x, own.position.y, own.position.z);
      this.shell.scale.setScalar(radius(own.mass));
    }
  }
  position(p: Vec3) {
    this.preview.visible = false;
    this.rig.position.set(p.x, p.y, p.z);
  }
  menu(dt: number) {
    this.preview.visible = true;
    this.preview.rotation.y += dt * 0.06;
    this.menuTime += dt;
    this.rig.position.set(15 * Math.sin(this.menuTime * 0.035), 7, 24);
    this.camera.position.set(0, 0, 0);
    this.camera.lookAt(0, 0, 0);
  }
  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
