# Архітектура

## Стек і принципи

Запропонований стек: TypeScript, Vite, Three.js/WebGL2; HTML/CSS для desktop-меню; Three.js/WebXR для VR. Node.js LTS та WebSocket-сервер додаються на етапі 3. Vitest — правила, Playwright — браузерні сценарії. Точні сумісні версії перевірити під час M0 та зафіксувати lockfile; «latest» не використовувати як відтворювану залежність.

Three.js містить WebXRManager для XR-камери, сесії та контролерів: [офіційна документація](https://threejs.org/docs/pages/WebXRManager.html). Наше ядро правил від Three.js не залежить.

## Модулі

| Модуль | Відповідальність | Заборонені залежності |
| --- | --- | --- |
| packages/core | World, RNG, tick, рух, поглинання, спавн, рейтинг | DOM, Three.js, WebXR, мережа, системний час |
| packages/bots | Спостереження та команди ботів | Пряме редагування маси/позицій |
| packages/protocol | Схеми повідомлень, версії, перевірки | Рендерер |
| apps/client/input | DesktopInput та XRInput → MoveCommand | Зміна правил |
| apps/client/render | Сфери, освітлення, камера, ефекти, HUD | Присвоєння ігрової маси |
| apps/client/session | LocalSession або NetworkSession | Приховані альтернативні правила |
| apps/server | Авторитетна симуляція, кімнати, ліміти | DOM, WebXR |
| tests | Fixture, unit, integration, e2e, load | Залежність лише від випадкових сценаріїв |

До етапу 3 створюються потрібні локальній грі модулі; сервер і protocol реалізуються пізніше. Усе ядро одразу працює з Vector3.

## Контракти

- createWorld(config, seed) → World.
- step(world, commands) → World + GameEvent[]; рівно один фіксований tick.
- observe(world, actorId, range) → доступні боту сутності.
- Session.start(), pause(), resume(), stop(), submitInput(command), getSnapshot().
- NetworkSession.pause() повертає «локальне меню» і не зупиняє сервер.
- Renderer.render(snapshot, interpolationAlpha, cameraPose).
- Input.sample() → напрямок у світових координатах; схема камери не входить у core.

World містить rulesVersion, seed/RNG state, tick, config, entities, actors, phase, статистику.
Entity: id, kind(cell|food), position{x,y,z}; клітина також actorId, mass, protectedUntilTick.
Actor: id, kind(human|bot), displayName, aliveEntityId|null, stats, respawnAtTick|null.
Stats: peakMass, foodEaten, cellsEaten, deaths, aliveTicks.
Snapshot: tick, phase, immutable копія видимих сутностей, рейтинг, залишок часу.
GameEvent: eventId, tick, type(spawn|consume|death|matchEnd), actor/entity IDs, дані результату.
Радіус виводиться з маси; клієнт не може надсилати його як істину.

## Час і детермінізм

Simulation tick 60 Hz, незалежний від FPS. Локально — accumulator і не більше 5 кроків за кадр. Надлишок після довгого зависання відкинути, порахувати метрику; прихована вкладка ставить одиночний матч на паузу. Матчевий час дорівнює tick/60, тому при перевантаженні локальна гра може сповільнюватися; це провал performance-критерію, а не приховане прискорення.

Рендер interpolates попередній/поточний стан. Сервер працює за monotonic clock; не більше 5 catch-up tick за цикл. Якщо відставання >250 ms тримається 5 s, припинити нові приєднання і завершити уражені матчі з SERVER_OVERLOAD без оголошення переможця.
Не використовувати Date.now/Math.random усередині core. Seeded PRNG та порядок за ID визначені тестами. Побітова тотожність різних JS/runtime не потрібна: сервер авторитетний; replay порівнюється в одному runtime/build.

## Геометрія і візуалізація

Усі колізії — сфери в 3D. Spatial hash використовує AABB сфери для переліку комірок; перевірка кандидатів завершується точною формулою з 02. Сфера має бути зареєстрована в усіх перекритих комірках, включно після росту. На старті допустимий brute force для клітин, їжа — через індекс. Результати порівнювати з brute-force oracle.

Їжа малюється instancing; геометрії/матеріали повторно використовуються. Без динамічних тіней і postprocessing у мінімальному профілі Quest 2. Якість змінює деталізацію та ефекти, але не масу, радіус, кількість видимих небезпечних клітин чи правила.

## Камера і тіло

Центр клітини — авторитетна ігрова позиція. Desktop-камера розташована в центрі; VR-камера має локальний tracked offset від rig. Рух голови не змінює центр, не збирає їжу і не дає прискорення.
Rig переміщується командами, а HMD-поза залишається під контролем WebXR. Відстань камерного offset фізичного руху не повинна давати огляд крізь межі: біля/за межею накладається плавне затемнення, камера не відштовхується примусово. Метри контролера/XR відображаються в ігрові одиниці 1:1; масштаб світу та голови не змінюється при рості клітини.

## Життєвий цикл

BOOT → MENU → LOADING → COUNTDOWN → PLAYING → RESULT → MENU.
PLAYING ↔ PAUSED лише локально. XR-режим є станом представлення, а не новим World. Вхід у VR з меню; вихід з локального VR матчу → пауза з можливістю продовжити на екрані.
На stop: очистити timers, listeners, input, XR/session references, GPU resources та мережу. Після context loss — пауза локально; після відновлення реконструювати графіку, або показати перезапуск.
