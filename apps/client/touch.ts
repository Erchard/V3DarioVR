export class TouchControls {
  readonly element = document.createElement('div');
  forward = 0;
  sideways = 0;
  private pointers = new Map<number, { role: string; x: number; y: number }>();
  private stick: HTMLElement;
  constructor(
    private look: (x: number, y: number) => void,
    pause: () => void,
  ) {
    this.element.id = 'touch-controls';
    this.element.hidden = true;
    this.element.innerHTML = `
      <div id="touch-look" data-control="look" aria-label="Огляд свайпом"><span>ОГЛЯД</span></div>
      <div id="touch-stick" data-control="move" aria-label="Джойстик руху"><i></i><span>РУХ</span></div>
      <div class="touch-height"><button data-control="up" aria-label="Рух угору">↑</button><button data-control="down" aria-label="Рух униз">↓</button></div>
      <button id="touch-pause" aria-label="Ігрове меню">Ⅱ</button>`;
    document.body.append(this.element);
    this.stick = this.element.querySelector('#touch-stick i')!;
    this.element.querySelector('#touch-pause')!.addEventListener('click', pause);
    this.element.addEventListener('contextmenu', (e) => e.preventDefault());
    this.element.addEventListener('pointerdown', (e) => {
      if (this.element.hidden || e.pointerType !== 'touch') return;
      const target = (e.target as HTMLElement).closest<HTMLElement>('[data-control]');
      if (!target) return;
      const role = target.dataset.control!;
      if ([...this.pointers.values()].some((p) => p.role === role)) return;
      e.preventDefault();
      this.pointers.set(e.pointerId, { role, x: e.clientX, y: e.clientY });
      target.setPointerCapture(e.pointerId);
      this.move(e);
    });
    this.element.addEventListener('pointermove', (e) => this.move(e));
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      this.element.addEventListener(event, (e) => {
        const id = (e as PointerEvent).pointerId;
        if (this.pointers.get(id)?.role === 'move') this.resetStick();
        this.pointers.delete(id);
      });
    }
  }
  get up() {
    const roles = [...this.pointers.values()].map((p) => p.role);
    return Number(roles.includes('up')) - Number(roles.includes('down'));
  }
  private move(e: PointerEvent) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    if (p.role === 'move') {
      const rect = this.element.querySelector('#touch-stick')!.getBoundingClientRect();
      const x = (e.clientX - rect.left - rect.width / 2) / 44;
      const y = (e.clientY - rect.top - rect.height / 2) / 44;
      const length = Math.hypot(x, y);
      const amount = Math.min(1, Math.max(0, (length - 0.12) / 0.88));
      this.sideways = length ? (x / length) * amount : 0;
      this.forward = length ? (-y / length) * amount : 0;
      this.stick.style.transform = `translate(${this.sideways * 44}px, ${-this.forward * 44}px)`;
    } else if (p.role === 'look') {
      this.look(e.clientX - p.x, e.clientY - p.y);
      p.x = e.clientX;
      p.y = e.clientY;
    }
  }
  private resetStick() {
    this.forward = this.sideways = 0;
    this.stick.style.transform = '';
  }
  clear() {
    this.pointers.clear();
    this.resetStick();
  }
  show(visible: boolean) {
    this.clear();
    this.element.hidden = !visible;
  }
}
