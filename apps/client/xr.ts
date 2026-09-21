import * as THREE from 'three';
import { getCell, zero, type Snapshot, type Vec3 } from '../../packages/core';
import type { ArenaRenderer } from './render';
import { xrDirection, snapTurn } from './control-math';
export class XRMode {
  active = false;
  calibrated = false;
  respawnDelay = 0;
  session?: XRSession;
  controllers: THREE.Group[] = [];
  sources = new Map<THREE.Group, XRInputSource>();
  panel: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  hud: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  fade: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  canvas = document.createElement('canvas');
  hudCanvas = document.createElement('canvas');
  moving = 0;
  flash = 0;
  tunnel: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  lastPaint = 0;
  lastPanel = false;
  currentPhase = 'playing';
  isPaused = false;
  dead = false;
  turnArmed = true;
  pauseHeld = false;
  lastYaw = 0;
  missing = false;
  constructor(
    private arena: ArenaRenderer,
    private pause: () => void,
    private resume: () => void,
    private action: () => void,
    private ended: () => void,
  ) {
    this.canvas.width = 1024;
    this.canvas.height = 768;
    this.panel = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 1.2),
      new THREE.MeshBasicMaterial({
        map: new THREE.CanvasTexture(this.canvas),
        transparent: true,
        depthTest: false,
      }),
    );
    this.panel.renderOrder = 20;
    this.panel.visible = false;
    arena.scene.add(this.panel);
    this.hudCanvas.width = 1024;
    this.hudCanvas.height = 160;
    this.hud = new THREE.Mesh(
      new THREE.PlaneGeometry(1.2, 0.1875),
      new THREE.MeshBasicMaterial({
        map: new THREE.CanvasTexture(this.hudCanvas),
        transparent: true,
        depthTest: false,
      }),
    );
    this.hud.position.set(0, -0.42, -1.8);
    this.hud.renderOrder = 15;
    arena.camera.add(this.hud);
    this.hud.visible = false;
    this.fade = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 32, 16),
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0,
        side: THREE.BackSide,
        depthTest: false,
      }),
    );
    this.fade.renderOrder = 10;
    arena.camera.add(this.fade);
    this.fade.visible = false;
    this.tunnel = new THREE.Mesh(
      new THREE.PlaneGeometry(0.8, 0.8),
      new THREE.ShaderMaterial({
        transparent: true,
        depthTest: false,
        uniforms: { strength: { value: 0 } },
        vertexShader:
          'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
        fragmentShader:
          'varying vec2 vUv; uniform float strength; void main(){float a=smoothstep(0.13,0.46,length(vUv-0.5));gl_FragColor=vec4(0.0,0.0,0.0,a*strength);}',
      }),
    );
    this.tunnel.position.z = -0.2;
    this.tunnel.renderOrder = 11;
    this.tunnel.visible = false;
    arena.camera.add(this.tunnel);
    for (let i = 0; i < 2; i++) {
      const c = arena.renderer.xr.getController(i);
      arena.rig.add(c);
      const points = [new THREE.Vector3(), new THREE.Vector3(0, 0, -3)];
      const ray = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({ color: 0x70efd0, transparent: true, opacity: 0.6 }),
      );
      c.add(ray);
      const tip = new THREE.Mesh(
        new THREE.SphereGeometry(0.015, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0x70efd0 }),
      );
      tip.position.z = -0.035;
      c.add(tip);
      c.addEventListener('connected', (event) => this.sources.set(c, event.data as XRInputSource));
      c.addEventListener('disconnected', () => {
        this.sources.delete(c);
        if (this.active) this.pause();
      });
      c.addEventListener('select', () => this.select(c));
      this.controllers.push(c);
    }
  }
  async start() {
    const xr = navigator.xr;
    if (!xr) throw Error('WebXR недоступний');
    this.arena.renderer.xr.enabled = true;
    // local-floor is optional: local reference space remains available on compatible headsets.
    const session = await xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] });
    this.session = session;
    this.calibrated = false;
    let floor = true;
    try {
      await session.requestReferenceSpace('local-floor');
    } catch {
      floor = false;
    }
    this.arena.renderer.xr.setReferenceSpaceType(floor ? 'local-floor' : 'local');
    this.arena.renderer.xr.setFramebufferScaleFactor(0.85);
    await this.arena.renderer.xr.setSession(session);
    this.active = true;
    this.hud.visible = true;
    this.fade.visible = true;
    this.tunnel.visible = true;
    this.arena.camera.position.set(0, 0, 0);
    session.addEventListener('visibilitychange', () => {
      if (session.visibilityState !== 'visible') this.pause();
    });
    session.addEventListener('end', () => {
      this.active = false;
      this.panel.visible = false;
      this.hud.visible = false;
      this.fade.visible = false;
      this.tunnel.visible = false;
      this.arena.rig.rotation.set(0, 0, 0);
      this.arena.camera.position.set(0, 0, 0);
      this.sources.clear();
      this.session = undefined;
      this.ended();
    });
    // Optional capability: unsupported refresh APIs must never prevent entering VR.
    const rates = session.supportedFrameRates;
    if (rates?.includes(72))
      try {
        await session.updateTargetFrameRate(72);
      } catch {}
  }
  async end() {
    await this.session?.end();
  }
  sample(comfort: number): Vec3 {
    if (!this.active) return zero();
    const frame = this.arena.renderer.xr.getFrame(),
      space = this.arena.renderer.xr.getReferenceSpace();
    if (!this.calibrated && frame && space) {
      const pose = frame.getViewerPose(space);
      if (!pose) return zero();
      const p = pose.transform.position;
      this.arena.renderer.xr.setReferenceSpace(
        space.getOffsetReferenceSpace(new XRRigidTransform({ x: p.x, y: p.y, z: p.z })),
      );
      this.calibrated = true;
      return zero();
    }
    const entries = [...this.sources.entries()];
    const left = entries.find(([, s]) => s.handedness === 'left'),
      right = entries.find(([, s]) => s.handedness === 'right');
    const tracked = (entry: typeof left) =>
      !!entry && !!frame && !!space && !!frame.getPose(entry[1].targetRaySpace, space);
    if (!tracked(left) || !tracked(right) || this.session?.visibilityState !== 'visible') {
      if (!this.missing) {
        this.missing = true;
        this.pause();
      }
      return zero();
    }
    this.missing = false;
    const lg = left![1].gamepad,
      rg = right![1].gamepad;
    if (!lg || !rg) return zero();
    const b = rg.buttons[5]?.pressed ?? false;
    if (b && !this.pauseHeld) {
      if (this.isPaused) this.resume();
      else this.pause();
    }
    this.pauseHeld = b;
    if (this.isPaused || this.dead || this.currentPhase !== 'playing') {
      this.moving = 0;
      return zero();
    }
    let rx = rg.axes[2] ?? rg.axes[0] ?? 0,
      ry = rg.axes[3] ?? rg.axes[1] ?? 0;
    if (Math.abs(rx) > Math.abs(ry)) ry = 0;
    else rx = 0;
    const turn = snapTurn(rx, this.turnArmed);
    this.turnArmed = turn.armed;
    this.arena.rig.rotation.y += turn.angle;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(
      left![0].getWorldQuaternion(new THREE.Quaternion()),
    );
    if (Math.hypot(forward.x, forward.z) > 0.01) this.lastYaw = Math.atan2(-forward.x, -forward.z);
    const move = xrDirection(
      forward,
      lg.axes[2] ?? lg.axes[0] ?? 0,
      lg.axes[3] ?? lg.axes[1] ?? 0,
      ry,
      this.lastYaw,
      comfort,
    );
    this.lastYaw = move.yaw;
    this.moving = Math.hypot(move.direction.x, move.direction.y, move.direction.z);
    return move.direction;
  }
  select(controller: THREE.Group) {
    if (!this.panel.visible) return;
    const origin = controller.getWorldPosition(new THREE.Vector3()),
      dir = new THREE.Vector3(0, 0, -1).applyQuaternion(
        controller.getWorldQuaternion(new THREE.Quaternion()),
      );
    const hit = new THREE.Raycaster(origin, dir).intersectObject(this.panel)[0];
    if (!hit?.uv) return;
    const y = (1 - hit.uv.y) * 768,
      x = hit.uv.x * 1024;
    if (x < 100 || x > 924) return;
    if (y >= 400 && y < 520) {
      if (this.isPaused) this.resume();
      else if (!this.dead || this.respawnDelay === 0) this.action();
    }
    if (y >= 550 && y < 660) void this.end();
  }
  placePanel() {
    const camera = this.arena.renderer.xr.getCamera();
    const p = camera.getWorldPosition(new THREE.Vector3());
    const q = camera.getWorldQuaternion(new THREE.Quaternion());
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    f.y = 0;
    f.normalize();
    if (f.lengthSq() < 0.1) f.set(0, 0, -1);
    this.panel.position.copy(p).addScaledVector(f, 2);
    this.panel.lookAt(p);
  }
  update(
    state: Snapshot,
    playerId: string | null,
    paused: boolean,
    phase: string,
    countdown: number,
  ) {
    this.isPaused = paused;
    this.currentPhase = phase;
    const c = getCell(state, playerId);
    this.dead = !c && phase === 'playing';
    const actor = state.actors.find((a) => a.id === playerId);
    this.respawnDelay =
      this.dead && actor && actor.respawnAt !== null
        ? Math.max(0, actor.respawnAt - state.tick)
        : 0;
    const show = paused || this.dead || phase === 'result' || phase === 'lobby';
    this.panel.visible = show;
    if (show && !this.lastPanel) this.placePanel();
    this.lastPanel = show;
    const camera = this.arena.renderer.xr.getCamera(),
      head = camera.getWorldPosition(new THREE.Vector3());
    const outside =
      Math.max(Math.abs(head.x), Math.abs(head.y), Math.abs(head.z)) - state.config.halfSize + 1;
    this.flash *= 0.85;
    this.fade.material.opacity = Math.max(this.flash, Math.max(0, Math.min(1, outside)));
    this.tunnel.material.uniforms.strength.value = paused ? 0 : Math.min(0.6, this.moving * 0.7);
    const now = performance.now();
    if (now - this.lastPaint < 100) return;
    this.lastPaint = now;
    const ctx = this.hudCanvas.getContext('2d')!;
    ctx.clearRect(0, 0, 1024, 160);
    ctx.fillStyle = '#071421dd';
    ctx.fillRect(0, 0, 1024, 160);
    ctx.textAlign = 'center';
    ctx.font = '32px system-ui';
    ctx.fillStyle = '#8bffdf';
    const seconds = Math.ceil((state.config.durationTicks - state.tick) / 60);
    const text =
      phase === 'countdown'
        ? 'Початок через ' + Math.ceil(countdown)
        : 'МАСА ' +
          (c?.mass ?? 0) +
          '     ·     ' +
          Math.floor(seconds / 60) +
          ':' +
          String(seconds % 60).padStart(2, '0');
    ctx.fillText(text, 512, 60);
    ctx.fillStyle = '#9fbacc';
    ctx.font = '23px system-ui';
    ctx.fillText('Лівий стік — рух · Правий — висота / поворот · B — меню', 512, 118);
    this.hud.material.map!.needsUpdate = true;
    if (show) {
      const p = this.canvas.getContext('2d')!;
      p.clearRect(0, 0, 1024, 768);
      p.fillStyle = '#0a192af5';
      p.fillRect(0, 0, 1024, 768);
      p.strokeStyle = '#3d677b';
      p.lineWidth = 4;
      p.strokeRect(4, 4, 1016, 760);
      p.textAlign = 'center';
      p.fillStyle = '#70efd0';
      p.font = '26px system-ui';
      p.fillText('V3DARIO · VR', 512, 100);
      p.font = 'bold 58px system-ui';
      p.fillStyle = '#f0f8fc';
      p.fillText(
        paused
          ? 'Пауза'
          : phase === 'lobby'
            ? 'Онлайн-кімната'
            : this.dead
              ? 'Вас поглинули'
              : 'Матч завершено',
        512,
        230,
      );
      p.font = '26px system-ui';
      p.fillStyle = '#b0c5d3';
      p.fillText('Наведіть промінь і натисніть trigger', 512, 310);
      p.fillStyle = '#70efd0';
      p.fillRect(100, 400, 824, 120);
      p.fillStyle = '#06251e';
      p.font = 'bold 34px system-ui';
      p.fillText(
        paused
          ? 'Продовжити'
          : phase === 'lobby'
            ? 'Я готовий'
            : this.dead
              ? this.respawnDelay > 0
                ? 'Ще ' + Math.ceil(this.respawnDelay / 60) + ' с'
                : 'Відродитися'
              : 'Наступний матч',
        512,
        475,
      );
      p.fillStyle = '#233d52';
      p.fillRect(100, 550, 824, 110);
      p.fillStyle = '#e1eff7';
      p.fillText('Вийти з VR', 512, 620);
      this.panel.material.map!.needsUpdate = true;
    }
  }
}
