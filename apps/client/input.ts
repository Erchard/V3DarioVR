import * as THREE from 'three';
import { zero, type Vec3 } from '../../packages/core';
import { desktopDirection } from './control-math';
export class DesktopInput {
  keys = new Set<string>();
  yaw = 0;
  pitch = 0;
  enabled = false;
  drag = false;
  sensitivity = 0.002;
  invert = false;
  constructor(
    public canvas: HTMLCanvasElement,
    public camera: THREE.Camera,
    public onPause: () => void,
  ) {
    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (['Space', 'ControlLeft', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) {
        e.preventDefault();
        this.keys.add(e.code);
      }
      if (e.code === 'Escape') this.onPause();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('mousemove', (e) => {
      if (!this.enabled || (!this.locked && !this.drag)) return;
      this.yaw -= e.movementX * this.sensitivity;
      this.pitch = Math.max(
        (-Math.PI * 85) / 180,
        Math.min(
          (Math.PI * 85) / 180,
          this.pitch - e.movementY * this.sensitivity * (this.invert ? -1 : 1),
        ),
      );
      this.apply();
    });
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 2 && this.enabled) this.drag = true;
    });
    window.addEventListener('pointerup', () => (this.drag = false));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      if (!this.locked && this.enabled) this.onPause();
    });
    window.addEventListener('blur', () => {
      this.clear();
      if (this.enabled) this.onPause();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.clear();
        if (this.enabled) this.onPause();
      }
    });
  }
  get locked() {
    return document.pointerLockElement === this.canvas;
  }
  apply() {
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
  clear() {
    this.keys.clear();
    this.drag = false;
  }
  async start() {
    this.enabled = true;
    this.apply();
    try {
      await this.canvas.requestPointerLock();
      return true;
    } catch {
      return false;
    }
  }
  stop() {
    this.enabled = false;
    this.clear();
    if (this.locked) document.exitPointerLock();
  }
  sample(): Vec3 {
    if (!this.enabled) return zero();
    const forward = Number(this.keys.has('KeyW')) - Number(this.keys.has('KeyS'));
    const sideways = Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA'));
    const up = Number(this.keys.has('Space')) - Number(this.keys.has('ControlLeft'));
    return desktopDirection(this.yaw, this.pitch, forward, sideways, up);
  }
}
