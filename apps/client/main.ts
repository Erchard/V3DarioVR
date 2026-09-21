import './style.css';
import * as THREE from 'three';
import {
  createWorld,
  step,
  snapshot,
  getCell,
  leaderboard,
  place,
  distance,
  zero,
  type World,
  type Snapshot,
  type Vec3,
} from '../../packages/core';
import { ArenaRenderer } from './render';
import { ScreenInput } from './input';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
<div id="scene"></div>
<div class="brand"><i class="mark"></i>V3<span>DARIO</span></div>
<div class="top-status"><i class="dot"></i><span id="status">3D АРЕНА</span></div>
<div class="vignette"></div>
<div id="hud" class="hud" hidden>
  <div class="mass"><div class="label">ВАША МАСА</div><strong id="mass">20</strong><small id="growth">Початок еволюції</small></div>
  <div id="timer" class="timer">05:00</div>
  <div class="board"><div class="label">ЛІДЕРИ АРЕНИ</div><ol id="leaders"></ol></div>
  <div class="crosshair"></div><div class="hint"><div id="target">Збирайте світлові частинки</div><div class="keys"><span><kbd>W A S D</kbd> рух</span><span><kbd>SPACE</kbd> ↑ <kbd>CTRL</kbd> ↓</span><span><kbd>ESC</kbd> пауза</span></div></div>
</div>
<div id="overlay" class="overlay"><section id="panel" class="panel"></section></div>
<div class="bottom"><span>ДОСЛІДЖУЙ · ЗРОСТАЙ · ВИЖИВАЙ</span><span id="footer">V3DARIO / 01</span></div>
<div id="toast" hidden role="status"></div><div id="countdown" hidden></div>
`;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
let renderer: ArenaRenderer;
try {
  renderer = new ArenaRenderer($('scene'));
} catch (error) {
  $('panel').innerHTML =
    '<h2>3D-графіка недоступна</h2><p class="lead">Увімкніть апаратне прискорення у Chrome та перезавантажте сторінку.</p>';
  throw error;
}
let world: World = createWorld(42);
let current: Snapshot = snapshot(world),
  previous: Snapshot = current,
  playerId: string | null = null;
let mode: 'menu' | 'local' | 'online' = 'menu';
let paused = false,
  countdown = 0,
  accumulator = 0,
  lastTime = 0,
  lastHud = 0;
let toastTimer: ReturnType<typeof setTimeout>;
let settings = {
  schemaVersion: 1,
  sensitivity: 0.002,
  volume: 0.25,
  low: matchMedia('(pointer: coarse)').matches,
  invert: false,
  comfort: 0.6,
  fov: 75,
};
try {
  const s = JSON.parse(localStorage.getItem('v3dario.settings') ?? 'null');
  if (s?.schemaVersion === 1) {
    settings = {
      ...settings,
      sensitivity: Math.max(0.0005, Math.min(0.005, Number(s.sensitivity) || 0.002)),
      volume: Math.max(0, Math.min(1, Number(s.volume) || 0)),
      low: !!s.low,
      invert: !!s.invert,
      comfort: Math.max(0.3, Math.min(1, Number(s.comfort) || 0.6)),
      fov: Math.max(60, Math.min(95, Number(s.fov) || 75)),
    };
  }
} catch {}
const input = new ScreenInput(renderer.renderer.domElement, renderer.camera, () => pause());
let audio: AudioContext | undefined;
let lastFood = 0;
function tone(freq: number) {
  if (!audio || !settings.volume) return;
  const o = audio.createOscillator(),
    g = audio.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(freq, audio.currentTime);
  o.frequency.exponentialRampToValueAtTime(freq * 1.6, audio.currentTime + 0.07);
  g.gain.setValueAtTime(settings.volume * 0.08, audio.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.12);
  o.connect(g).connect(audio.destination);
  o.start();
  o.stop(audio.currentTime + 0.13);
}
function applySettings() {
  input.sensitivity = settings.sensitivity;
  input.invert = settings.invert;
  renderer.quality(settings.low);
  renderer.camera.fov = settings.fov;
  renderer.camera.updateProjectionMatrix();
}
applySettings();
function toast(text: string) {
  $('toast').textContent = text;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($('toast').hidden = true), 5000);
}
function panel(html: string) {
  $('panel').innerHTML = html;
  $('overlay').hidden = false;
}
function on(id: string, fn: () => void) {
  $(id).addEventListener('click', fn);
}
function hidePanel() {
  $('overlay').hidden = true;
}
function statsHTML(state: Snapshot) {
  const a = state.actors.find((x) => x.id === playerId);
  if (!a) return '';
  return `<div class="stats"><div class="stat"><span class="label">НАЙБІЛЬША МАСА</span><b>${a.stats.peakMass}</b></div><div class="stat"><span class="label">ПОГЛИНУТО КЛІТИН</span><b>${a.stats.cellsEaten}</b></div><div class="stat"><span class="label">ЗІБРАНО ЇЖІ</span><b>${a.stats.foodEaten}</b></div><div class="stat"><span class="label">МІСЦЕ</span><b>#${place(state, a.id, state.reason === 'death' && mode === 'local')}</b></div></div>`;
}
function menu() {
  input.stop();
  network?.close();
  network = undefined;
  mode = 'menu';
  paused = false;
  playerId = null;
  $('hud').hidden = true;
  $('countdown').hidden = true;
  $('status').textContent = '3D АРЕНА';
  renderer.rig.rotation.set(0, 0, 0);
  world = createWorld(42);
  current = snapshot(world);
  previous = current;
  panel(
    `<div class="eyebrow">НЕСКІНЧЕННО МАЛИЙ. ПОТЕНЦІЙНО ВЕЛИЧЕЗНИЙ.</div><h1>Твій простір.<br>Твоя <em>еволюція.</em></h1><p class="lead">Пірнай у живий тривимірний світ.<br>Збирай енергію, поглинай менших<br>і не ставай чиїмось обідом.</p><div class="actions"><button id="play" class="primary play">Грати проти ботів <span>↗</span></button><button id="online">Онлайн</button></div><div class="actions"><button id="vr" class="small">◉ Увійти у VR</button><button id="settings" class="ghost small">Налаштування</button><button id="help" class="ghost small">Як грати</button></div><div class="features"><div><strong>3D</strong>ПОВНА СВОБОДА</div><div><strong>8</strong>СУПЕРНИКІВ</div><div><strong>5 хв</strong>ОДИН МАТЧ</div></div>`,
  );
  on('play', () => startLocal());
  on('settings', () => settingsPanel(menu));
  on('help', () => help(menu));
  on('online', () => onlineMenu());
  on('vr', () => enterVR());
  if (!navigator.xr) {
    $('vr').setAttribute('title', 'Відкрийте сайт у браузері Quest через HTTPS');
  }
}
function help(back: () => void) {
  panel(
    `<div class="eyebrow">ШВИДКИЙ СТАРТ</div><h2>Рухайся у трьох вимірах.</h2><p class="lead">Ти всередині своєї клітини. Малі світлові частинки — їжа. Більша маса дає більший радіус, але зменшує швидкість.</p><dl class="control-list"><dt>Миша</dt><dd>Огляд навколо</dd><dt>W / S</dt><dd>Уперед / назад у напрямку погляду</dd><dt>A / D</dt><dd>Рух ліворуч / праворуч</dd><dt>Space / Ctrl</dt><dd>Угору / вниз</dd><dt>Esc</dt><dd>Меню й звільнення курсора</dd></dl><p class="notice">Для поглинання потрібно бути щонайменше на 15% важчим. Після появи діє захист 3 секунди. У разі відмови захоплення курсора оглядайся, затиснувши праву кнопку миші.</p><div class="actions"><button id="back">Зрозуміло</button></div>`,
  );
  if (input.touch) {
    $('panel').querySelector('.control-list')!.innerHTML =
      '<dt>Лівий джойстик</dt><dd>Рух у напрямку погляду та вбік</dd><dt>Свайп праворуч</dt><dd>Огляд навколо</dd><dt>↑ / ↓</dt><dd>Угору / вниз</dd><dt>Ⅱ</dt><dd>Ігрове меню</dd>';
    $('panel').querySelector('.notice')!.textContent =
      'Для поглинання потрібно бути на 15% важчим. Захист після появи — 3 секунди. Для зручності поверніть телефон горизонтально.';
  }
  on('back', back);
}
function settingsPanel(back: () => void) {
  panel(
    `<div class="eyebrow">ПІД СЕБЕ</div><h2>Налаштування</h2><label class="field">Чутливість огляду<input id="sensitivity" type="range" min="0.0005" max="0.005" step="0.0001" value="${settings.sensitivity}"></label><label class="field">Гучність<input id="volume" type="range" min="0" max="1" step=".05" value="${settings.volume}"></label><label class="field">Поле зору на екрані<input id="fov" type="range" min="60" max="95" step="1" value="${settings.fov}"></label><label class="field">VR: комфортна швидкість<input id="comfort" type="range" min=".3" max="1" step=".05" value="${settings.comfort}"></label><label class="field"><input id="low" type="checkbox" ${settings.low ? 'checked' : ''}> Економна графіка</label><label class="field"><input id="invert" type="checkbox" ${settings.invert ? 'checked' : ''}> Інвертувати вертикальний огляд</label><div class="actions"><button id="save" class="primary">Зберегти</button></div>`,
  );
  on('save', () => {
    for (const key of ['sensitivity', 'volume', 'comfort', 'fov'] as const)
      settings[key] = Number($<HTMLInputElement>(key).value);
    settings.low = $<HTMLInputElement>('low').checked;
    settings.invert = $<HTMLInputElement>('invert').checked;
    applySettings();
    try {
      localStorage.setItem('v3dario.settings', JSON.stringify(settings));
    } catch {
      toast('Налаштування діятимуть до закриття сторінки.');
    }
    back();
  });
}
function newAudio() {
  try {
    audio ??= new AudioContext();
    void audio.resume();
  } catch {}
}
async function startLocal() {
  newAudio();
  network?.close();
  network = undefined;
  mode = 'local';
  world = createWorld(crypto.getRandomValues(new Uint32Array(1))[0]);
  current = snapshot(world);
  previous = current;
  playerId = world.humanId;
  paused = false;
  countdown = 3;
  accumulator = 0;
  lastFood = 0;
  renderer.rig.rotation.set(0, 0, 0);
  renderer.camera.position.set(0, 0, 0);
  input.yaw = 0;
  input.pitch = 0;
  input.apply();
  hidePanel();
  $('hud').hidden = false;
  $('countdown').hidden = false;
  $('status').textContent = 'ОДИНОЧНА ГРА';
  if (!xr?.active) {
    if (!(await input.start())) toast('Огляд: затисніть праву кнопку миші.');
  }
}
function pause() {
  if (mode === 'menu' || paused || current.phase === 'result') return;
  paused = true;
  input.stop();
  $('countdown').hidden = true;
  panel(
    `<div class="eyebrow">${mode === 'online' ? 'СВІТ ПРОДОВЖУЄ РУХ' : 'МОЖНА ВИДИХНУТИ'}</div><h2>${mode === 'online' ? 'Ігрове меню' : 'Пауза'}</h2><p class="lead">${mode === 'online' ? 'Ваша клітина лишається на арені та може бути поглинута.' : 'Твій світ зачекає. Продовжуй, коли будеш готовий.'}</p><div class="actions"><button id="resume" class="primary">Продовжити</button><button id="settings">Налаштування</button><button id="exit">Головне меню</button></div>`,
  );
  on('resume', () => resume());
  on('exit', () => {
    if (xr?.active) void xr.end();
    menu();
  });
  on('settings', () =>
    settingsPanel(() => {
      paused = false;
      pause();
    }),
  );
}
async function resume() {
  paused = false;
  hidePanel();
  if (countdown > 0) $('countdown').hidden = false;
  if (!xr?.active && !(await input.start())) toast('Для огляду затисніть праву кнопку миші.');
}
function result() {
  input.stop();
  $('countdown').hidden = true;
  panel(
    `<div class="eyebrow">ЕВОЛЮЦІЯ ТРИВАЄ</div><h2>${current.reason === 'death' ? 'Вас поглинули' : place(current, playerId!) === 1 ? 'Ти — найбільший.' : 'Матч завершено'}</h2><p class="lead">Кожна спроба — нова історія. ${current.reason === 'death' ? 'Місце показано на момент смерті.' : ''}</p>${statsHTML(current)}<div class="actions"><button id="again" class="primary">Ще один матч</button><button id="exit">Головне меню</button></div>`,
  );
  on('again', () => {
    if (mode === 'local') void startLocal();
    else {
      hidePanel();
      toast('Наступний матч — після повернення кімнати в лобі.');
    }
  });
  on('exit', () => {
    if (xr?.active) void xr.end();
    menu();
  });
}
function updateHUD() {
  const c = getCell(current, playerId),
    a = current.actors.find((a) => a.id === playerId);
  $('mass').textContent = String(c?.mass ?? a?.stats.lastMass ?? 20);
  $('growth').textContent =
    c && c.protectedUntil > current.tick
      ? '◈ Захист після появи'
      : a
        ? 'Рекорд матчу: ' + a.stats.peakMass
        : '';
  const seconds = Math.max(0, Math.ceil((current.config.durationTicks - current.tick) / 60));
  $('timer').textContent =
    String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
  $('leaders').replaceChildren(
    ...leaderboard(current)
      .slice(0, 5)
      .map((a, i) => {
        const li = document.createElement('li');
        if (a.id === playerId) li.className = 'me';
        const rank = document.createElement('span'),
          name = document.createElement('b'),
          score = document.createElement('span');
        rank.textContent = String(i + 1).padStart(2, '0');
        name.textContent = a.name;
        score.textContent = String(getCell(current, a.id)?.mass ?? 0);
        li.append(rank, name, score);
        return li;
      }),
  );
  if (a && a.stats.foodEaten > lastFood) {
    tone(500 + Math.min(700, a.stats.foodEaten * 3));
    lastFood = a.stats.foodEaten;
  }
  if (c) {
    const threats = current.cells
      .filter(
        (x) =>
          x.actorId !== playerId && x.mass >= c.mass * 1.15 && x.protectedUntil <= current.tick,
      )
      .sort((a, b) => distance(a.position, c.position) - distance(b.position, c.position));
    const target =
      threats[0] && distance(threats[0].position, c.position) < 15
        ? threats[0]
        : current.food.reduce<(typeof current.food)[number] | undefined>(
            (best, f) =>
              !best || distance(f.position, c.position) < distance(best.position, c.position)
                ? f
                : best,
            undefined,
          );
    if (target) {
      const rel = new THREE.Vector3(
        target.position.x - c.position.x,
        target.position.y - c.position.y,
        target.position.z - c.position.z,
      ).applyQuaternion(renderer.camera.getWorldQuaternion(new THREE.Quaternion()).invert());
      const arrow =
        rel.z > 0
          ? '↶'
          : Math.abs(rel.x) > Math.abs(rel.y)
            ? rel.x > 0
              ? '→'
              : '←'
            : rel.y > 0
              ? '↑'
              : '↓';
      const danger = 'mass' in target;
      $('target').textContent =
        (danger ? '⚠ Більша клітина' : '✧ Найближча їжа') +
        ' · ' +
        Math.round(distance(target.position, c.position)) +
        ' м ' +
        arrow;
      $('target').classList.toggle('warning', danger);
    }
  }
}
// Online and XR modules are loaded only when requested.
import type { NetworkSession } from './network';
import type { XRMode } from './xr';
let network: NetworkSession | undefined, xr: XRMode | undefined;
async function enterVR() {
  if (!navigator.xr || !(await navigator.xr.isSessionSupported('immersive-vr'))) {
    toast('VR доступний у Meta Quest Browser через HTTPS. На ноутбуці оберіть гру проти ботів.');
    return;
  }
  try {
    const { XRMode } = await import('./xr');
    xr ??= new XRMode(
      renderer,
      () => pause(),
      () => resume(),
      () => {
        if (mode === 'online') {
          if (network?.phase === 'lobby') network.ready();
          else if (!getCell(current, playerId)) network?.respawn();
        } else if (mode === 'menu' || current.phase === 'result') void startLocal();
      },
      () => {
        if (mode !== 'menu') pause();
      },
    );
    await xr.start();
    input.stop();
    if (mode === 'menu') await startLocal();
    else if (paused) await resume();
  } catch (e) {
    toast('Не вдалося увійти у VR: ' + (e instanceof Error ? e.message : String(e)));
  }
}
function onlineMenu() {
  panel(
    `<div class="eyebrow">РАЗОМ В ОДНОМУ СВІТІ</div><h2>Онлайн-арена</h2><label class="field">Ваше ім'я<input id="name" maxlength="20" value="Мандрівник" autocomplete="nickname"></label><label class="field">Код кімнати<input id="room" maxlength="8" placeholder="8 символів" autocomplete="off" style="text-transform:uppercase"></label><p class="notice">Chrome і VR грають разом. В онлайні пауза не зупиняє світ. Потрібне з'єднання з ігровим сервером.</p><div class="actions"><button id="create" class="primary">Створити кімнату</button><button id="join">Приєднатися</button><button id="back" class="ghost">Назад</button></div>`,
  );
  on('back', menu);
  on('create', () => connectOnline(false));
  on('join', () => connectOnline(true));
}
async function connectOnline(join: boolean) {
  const name = $<HTMLInputElement>('name').value.trim() || 'Мандрівник',
    code = $<HTMLInputElement>('room').value.trim().toUpperCase();
  if (join && code.length !== 8) {
    toast('Введіть код кімнати з 8 символів.');
    return;
  }
  $('create').setAttribute('disabled', '');
  $('join').setAttribute('disabled', '');
  try {
    const { NetworkSession } = await import('./network');
    network?.close();
    network = new NetworkSession(
      (s, id) => {
        current = s;
        playerId = id;
      },
      (text) => toast(text),
    );
    await network.connect(join ? 'joinRoom' : 'createRoom', name, code);
    mode = 'online';
    onlinePhase = '';
    paused = false;
    lastFood = 0;
    renderer.rig.rotation.set(0, 0, 0);
    renderer.camera.position.set(0, 0, 0);
    input.yaw = 0;
    input.pitch = 0;
    input.apply();
    $('hud').hidden = false;
    showLobby();
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
    network?.close();
    network = undefined;
    onlineMenu();
  }
}
let lobbyStamp = '',
  onlinePhase = '';
function showLobby() {
  input.stop();
  panel(
    `<div class="eyebrow">КІМНАТА · CHROME + VR</div><h2>Збираємо команду</h2><div class="room-code" id="code"></div><p class="muted">Поділіться кодом. Вільні місця займуть боти.</p><ul id="roster" class="roster"></ul><div class="actions"><button id="ready" class="primary">Я готовий</button><button id="lobby-vr">Увійти у VR</button><button id="leave">Вийти</button></div>`,
  );
  $('code').textContent = network?.roomCode ?? '';
  on('ready', () => network?.ready());
  on('lobby-vr', () => enterVR());
  on('leave', menu);
  lobbyStamp = '';
}
function onlineUpdate(dt: number, direction: Vec3) {
  if (!network) return;
  network.update(dt, direction);
  const phase = network.phase;
  if (phase !== onlinePhase) {
    onlinePhase = phase;
    if (phase === 'lobby') {
      showLobby();
      paused = false;
    }
    if (phase === 'countdown') {
      hidePanel();
      $('countdown').hidden = false;
    }
    if (phase === 'playing') {
      hidePanel();
      $('countdown').hidden = true;
      paused = false;
      if (!xr?.active) void input.start();
    }
    if (phase === 'result') {
      result();
    }
  }
  if (phase === 'lobby' && $('roster')) {
    const stamp = JSON.stringify(network.roster);
    if (stamp !== lobbyStamp) {
      lobbyStamp = stamp;
      $('roster').replaceChildren(
        ...network.roster.map((p) => {
          const li = document.createElement('li');
          const n = document.createElement('span'),
            r = document.createElement('span');
          n.textContent = p.name;
          r.textContent = p.ready ? '✓ Готовий' : p.connected ? 'Очікує' : 'Перепідключення';
          li.append(n, r);
          return li;
        }),
      );
    }
  }
  if (phase === 'countdown')
    $('countdown').textContent = String(Math.max(1, Math.ceil(network.countdown)));
  if (phase === 'playing' && !getCell(current, playerId) && !paused && !$('respawn')) {
    input.stop();
    panel(
      `<div class="eyebrow">НОВА СПРОБА</div><h2>Вас поглинули</h2>${statsHTML(current)}<p class="muted">Відродження доступне через 3 секунди після смерті.</p><div class="actions"><button id="respawn" class="primary">Відродитися</button><button id="leave">Вийти</button></div>`,
    );
    on('respawn', () => network?.respawn());
    on('leave', menu);
  }
  if (phase === 'playing' && getCell(current, playerId) && $('respawn')) {
    hidePanel();
    $('panel').innerHTML = '';
    if (!xr?.active) void input.start();
  }
  if (phase === 'playing' && $('respawn')) {
    const actor = current.actors.find((a) => a.id === playerId);
    const remaining =
      !actor || actor.respawnAt === null ? 0 : Math.max(0, actor.respawnAt - current.tick);
    const button = $<HTMLButtonElement>('respawn');
    button.disabled = remaining > 0;
    button.textContent =
      remaining > 0 ? 'Відродження через ' + Math.ceil(remaining / 60) + ' с' : 'Відродитися';
  }
  $('status').textContent = network.connected
    ? 'КІМНАТА ' + network.roomCode + ' · ' + network.rtt + ' MS'
    : 'ПЕРЕПІДКЛЮЧЕННЯ…';
}
window.addEventListener('resize', () => renderer.resize());
renderer.renderer.domElement.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  pause();
  toast('Графічний контекст втрачено. Чекаємо відновлення.');
});
renderer.renderer.domElement.addEventListener('webglcontextrestored', () =>
  toast('Графіку відновлено. Можна продовжити.'),
);
menu();
renderer.renderer.setAnimationLoop((time: number) => {
  const elapsed = lastTime ? (time - lastTime) / 1000 : 0;
  const dt = Math.min(0.1, elapsed);
  lastTime = time;
  const direction = xr?.active ? xr.sample(settings.comfort) : paused ? zero() : input.sample();
  if (mode === 'menu') {
    step(world);
    if (world.phase === 'result') world = createWorld(42);
    current = snapshot(world);
    renderer.menu(dt);
  } else if (mode === 'local' && !paused && current.phase !== 'result') {
    if (countdown > 0) {
      countdown -= elapsed;
      $('countdown').textContent = String(Math.max(1, Math.ceil(countdown)));
      if (countdown <= 0) {
        $('countdown').hidden = true;
        tone(600);
      }
    } else {
      accumulator += dt;
      let n = 0;
      while (accumulator >= 1 / 60 && n++ < 5) {
        previous = current;
        step(world, playerId ? { [playerId]: direction } : {});
        current = snapshot(world);
        accumulator -= 1 / 60;
      }
      if (accumulator >= 1 / 60) accumulator = 0;
      if (current.phase === 'result') result();
    }
  } else if (mode === 'online') onlineUpdate(dt, direction);
  let display = current,
    prior = previous,
    alpha = mode === 'local' && !paused ? Math.min(1, accumulator * 60) : 1;
  if (mode === 'online' && network?.state) {
    display = network.renderState();
    prior = display;
    alpha = 1;
  }
  renderer.sync(display, playerId, mode === 'menu' ? undefined : prior, alpha);
  const c = getCell(display, playerId);
  if (c && mode !== 'menu') {
    const old = prior.cells.find((x) => x.id === c.id);
    const p =
      old && mode === 'local'
        ? {
            x: old.position.x + (c.position.x - old.position.x) * alpha,
            y: old.position.y + (c.position.y - old.position.y) * alpha,
            z: old.position.z + (c.position.z - old.position.z) * alpha,
          }
        : c.position;
    renderer.position(p);
  }
  if (mode !== 'menu' && time - lastHud > 100) {
    updateHUD();
    lastHud = time;
  }
  if (xr?.active && network && network.correction > 0.25) xr.flash = 0.35;
  if (xr?.active)
    xr.update(
      current,
      playerId,
      paused,
      mode === 'online' ? (network?.phase ?? 'lobby') : countdown > 0 ? 'countdown' : current.phase,
      mode === 'online' ? (network?.countdown ?? 0) : countdown,
    );
  renderer.render();
});
// Explicit opt-in diagnostics for reproducible local E2E; never changes online rules.
if (import.meta.env.DEV && new URLSearchParams(location.search).has('test')) {
  Object.assign(window, {
    __game: {
      get state() {
        return current;
      },
      get mode() {
        return mode;
      },
      get paused() {
        return paused;
      },
      get view() {
        return { yaw: input.yaw, pitch: input.pitch };
      },
      get playerId() {
        return playerId;
      },
      finish() {
        if (mode === 'local') {
          world.tick = world.config.durationTicks - 1;
          countdown = 0;
          paused = false;
        }
      },
      die() {
        if (mode === 'local') {
          world.cells = world.cells.filter((c) => c.actorId !== playerId);
          countdown = 0;
          paused = false;
        }
      },
    },
  });
}
