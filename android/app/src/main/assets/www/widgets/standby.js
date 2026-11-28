// StandBy (local patch): an iOS StandBy-style full-screen clock.
// Faces: "playful" (big rounded digits overlapping in two tones) and "tall" (condensed digits with a side column:
// day + date, temperature, Claude session quota). Swipe up/down on the clock to change face (remembered per widget).
// Focus: a pomodoro (25/5/15 × 4, trackMe's defaults and phase rules). Tap the Focus pill to start; while it runs the
// big digits count down, a tap pauses/resumes and a long press stops it. Under the clock one line of motivation in
// trackMe's wording and tone (options.tone: brutal | honest | encouraging), about blocks done today vs options.goal.
// Colours: hold the clock for the editor (swipe ← → colour, ↑ ↓ face, or tap a swatch); options.color sets the default.
// While something plays on the computer the clock glides left and a frosted media panel (30 % wide) slides in on the
// right; it leaves again after playback has been stopped for a short while.
import { LOCALE, chime, clockPeriod, gotoPageRef, h, haptic, hour12, media, pad, quotaProviders, store, wxLines } from '../main.js';
import { W } from '../registry.js';
import { EXTRA_FACES } from './standby-faces.js';

const FACES = ['playful', 'tall', 'flip', 'vapor', 'disk'];
const FACE_NAME = { playful: 'Playful', tall: 'Tall', flip: 'Flip', vapor: 'Vapor', disk: 'Flip-disk' };
// Colour choices per face (iOS system colours). playful: [main, overlap tone]; tall: [digits].
const PALETTES = {
  playful: [
    { id: 'coral', name: 'Coral', c: ['#eb6a59', '#f08f84'] },
    { id: 'blue', name: 'Blue', c: ['#0a62c0', '#52a2ea'] },
    { id: 'green', name: 'Green', c: ['#30d158', '#7fe39a'] },
    { id: 'purple', name: 'Purple', c: ['#bf5af2', '#d996ff'] },
    { id: 'yellow', name: 'Yellow', c: ['#ffcc00', '#ffe066'] },
    { id: 'pink', name: 'Pink', c: ['#ff375f', '#ff8aa1'] },
    { id: 'white', name: 'White', c: ['#e5e5ea', '#aeaeb2'] },
  ],
  tall: [
    { id: 'blue', name: 'Blue', c: ['#7aacf4'] },
    { id: 'coral', name: 'Coral', c: ['#f08f84'] },
    { id: 'green', name: 'Green', c: ['#7fe39a'] },
    { id: 'purple', name: 'Purple', c: ['#c99bff'] },
    { id: 'yellow', name: 'Yellow', c: ['#ffd60a'] },
    { id: 'red', name: 'Red', c: ['#ff6961'] },
    { id: 'white', name: 'White', c: ['#f2f2f7'] },
  ],
  // flip: [digits]
  flip: [
    { id: 'white', name: 'White', c: ['#f2f2f7'] },
    { id: 'amber', name: 'Amber', c: ['#ffd60a'] },
    { id: 'blue', name: 'Blue', c: ['#64b5ff'] },
    { id: 'coral', name: 'Coral', c: ['#f08f84'] },
    { id: 'green', name: 'Green', c: ['#7fe39a'] },
    { id: 'purple', name: 'Purple', c: ['#c99bff'] },
    { id: 'red', name: 'Red', c: ['#ff6961'] },
  ],
  // vapor: [glow, core]
  vapor: [
    { id: 'cyan', name: 'Cyan', c: ['#64d2ff', '#e6f6ff'] },
    { id: 'lavender', name: 'Lavender', c: ['#b794ff', '#efe6ff'] },
    { id: 'coral', name: 'Coral', c: ['#ff8a7a', '#ffe9e5'] },
    { id: 'green', name: 'Green', c: ['#30d158', '#e0ffe8'] },
    { id: 'amber', name: 'Amber', c: ['#ffb340', '#fff3dd'] },
    { id: 'pink', name: 'Pink', c: ['#ff6aa1', '#ffe6ef'] },
    { id: 'white', name: 'White', c: ['#d1d1d6', '#ffffff'] },
  ],
  // disk: [disc colour]; lime is the original flip-disk-matrix colour
  disk: [
    { id: 'lime', name: 'Lime', c: ['#e5fd52'] },
    { id: 'blue', name: 'Blue', c: ['#52a2ea'] },
    { id: 'coral', name: 'Coral', c: ['#f08f84'] },
    { id: 'green', name: 'Green', c: ['#30d158'] },
    { id: 'amber', name: 'Amber', c: ['#ffd60a'] },
    { id: 'white', name: 'White', c: ['#f2f2f7'] },
    { id: 'purple', name: 'Purple', c: ['#bf5af2'] },
  ],
};
const BREAK = { std: ['#30d158', '#7fe39a'], alt: ['#64d2ff', '#9be4ff'] }; // breaks are green; teal when green is chosen
const EDIT_IDLE_MS = 8000;
const MEDIA_LINGER_MS = 20000; // paused/stopped media keeps its place this long (track changes, short pauses)
const MIN = 60_000;

// ---------------------------------------------------------------- pomodoro (as trackMe lib/timer/pomodoro.ts)
// Phase i: even = work block i/2; odd = the break after it, long after every `cycles`-th work block.
const kindOf = (i, cycles) => (i % 2 === 0 ? 'work' : ((i - 1) / 2 + 1) % cycles === 0 ? 'long_break' : 'short_break');
const lengthOf = (kind, c) => (kind === 'work' ? c.workMin : kind === 'short_break' ? c.shortMin : c.longMin) * MIN;
const PHASE_LABEL = { work: 'Focus', short_break: 'Short break', long_break: 'Long break' };

const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function durWords(ms) {
  const hrs = Math.floor(ms / 3_600_000);
  if (hrs < 48) return `${hrs} ${hrs === 1 ? 'hour' : 'hours'}`;
  return `${Math.floor(hrs / 24)} days`;
}

// trackMe lib/accountability/reality.ts + pushes.ts, scoped to what the panel knows: blocks done here and today's
// goal. Copy is about what was done, never about the person. Several lines per state; the line changes every 5 min.
function motive(tone, s) {
  const slot = Math.floor(Date.now() / 300_000);
  const pick = (m) => { const v = m[tone] || m.brutal; return Array.isArray(v) ? v[slot % v.length] : v; };
  const left = s.goal - s.today;
  const b = (n) => `${n} ${n === 1 ? 'block' : 'blocks'}`;
  if (s.paused) return pick({
    brutal: ['Paused. The block is still waiting.', 'Paused. Your goal is not.', 'Paused. Finish what you started.'],
    honest: 'Timer paused.',
    encouraging: 'Paused. Pick it back up when you are ready.',
  });
  if (s.running && s.kind === 'work') return pick({
    brutal: ['Timer running. Finish the block before you touch your phone.', 'Block in progress. Phone down.', 'Stay on it. The block is not done.'],
    honest: 'Timer running.',
    encouraging: "You're studying. Keep going.",
  });
  if (s.running) return pick({
    brutal: ['Break. Stand up, then get back to it.', 'Break, not the end of the day.', `Break. ${b(Math.max(left, 0))} still open today.`],
    honest: 'Break.',
    encouraging: 'Break. You earned it.',
  });
  if (!s.lastEnd) return pick({
    brutal: ['Not a single minute logged yet.', 'Zero blocks so far. Start the first one.'],
    honest: 'No study time logged yet.',
    encouraging: 'Your first session starts here.',
  });
  const idleMs = Date.now() - s.lastEnd;
  if (s.today === 0 && idleMs >= 20 * 3_600_000) {
    const idle = durWords(idleMs);
    return pick({
      brutal: [`${idle} without studying.`, `Last block: ${idle} ago.`, `${idle} without studying. One block ends that.`],
      honest: `Last study session: ${idle} ago.`,
      encouraging: `It's been ${idle}. A short session today restarts the habit.`,
    });
  }
  // the evening check (trackMe pushes.ts): late, nothing or too little done
  const late = new Date().getHours() >= 21;
  if (late && left > 0) return pick({
    brutal: s.today === 0
      ? ['Not one minute today. One 25 min block before bed.', 'Nothing studied today. One block before bed.']
      : [`${b(s.today)} today. ${b(left)} short. One more block before bed.`, `Your plan needed ${b(s.goal)} today. ${b(left)} short.`],
    honest: `${s.today} of ${s.goal} blocks today. One block still fits in tonight.`,
    encouraging: `Still time today. ${b(left)} to go, one short block helps.`,
  });
  if (left > 0) return pick({
    brutal: s.today === 0
      ? ['Nothing studied today.', `Zero blocks today. Your goal is ${s.goal}.`, `${b(s.goal)} planned. ${b(s.goal)} still open.`]
      : [`${b(left)} short of your own goal today.`, `${s.today} of ${s.goal} blocks. The rest will not do themselves.`, `${b(left)} left. Start the next one now.`],
    honest: `${s.today} of ${s.goal} blocks today.`,
    encouraging: `${b(left)} to go today. One at a time.`,
  });
  return pick({
    brutal: ["Goal done. Don't get comfortable.", `${b(s.today)} today. One more puts you ahead.`, 'Goal met. Tomorrow counts too.'],
    honest: `Goal done: ${s.today} blocks today.`,
    encouraging: `Goal done: ${s.today} blocks today. Well played.`,
  });
}

W.standby = {
  bare: true,
  needs: ['tick', 'state', 'fast', 'media', 'weather', 'quotas'],
  create(box, ctx) {
    const o = ctx.o || {};
    const id = ctx.w?.id || 'standby';
    const faceKey = `standby-face:${id}`, pomoKey = `standby-pomo:${id}`, logKey = `standby-log:${id}`;
    let face = FACES.includes(store.get(faceKey, null)) ? store.get(faceKey, null) : (FACES.includes(o.face) ? o.face : 'playful');
    const tone = ['brutal', 'honest', 'encouraging'].includes(o.tone) ? o.tone : 'brutal';
    const conf = {
      workMin: Math.max(1, +o.workMin || 25), shortMin: Math.max(1, +o.shortMin || 5),
      longMin: Math.max(1, +o.longMin || 15), cycles: Math.max(1, +o.cycles || 4),
    };
    const goal = Math.max(1, +o.goal || 4);

    // pomo: { index, phaseStart, pausedAt|null } while running; log: { day, today, lastEnd }
    const colorKey = (f) => `standby-color:${id}:${f}`;
    const colorOf = (f) => {
      const want = store.get(colorKey(f), null) ?? (f === face ? o.color : null);
      return PALETTES[f].find((x) => x.id === want) || PALETTES[f][0];
    };
    let pomo = store.get(pomoKey, null);
    let log = store.get(logKey, { day: dayKey(), today: 0, lastEnd: 0 });
    const saveLog = () => store.set(logKey, log);
    const savePomo = () => store.set(pomoKey, pomo);

    const root = h('div', 'sbx');
    const stage = h('div', 'sbx-stage');
    const main = h('div', 'sbx-main');
    const clock = h('div', 'sbx-clock');
    const digits = [0, 1, 2, 3].map((i) => h('span', `sbx-d sbx-d${i}`));
    const colon = h('span', 'sbx-colon', h('i'), h('i'));
    const ap = h('span', 'sbx-ap');
    clock.append(digits[0], digits[1], colon, digits[2], digits[3], ap);
    const phaseEl = h('div', 'sbx-phase');
    const motiveEl = h('div', 'sbx-motive');
    // the extra faces (flip, vapor, disk) render into this instead of the text clock
    const alt = h('div', 'sbx-alt');
    let altFace = null, lastStr = '    ';
    // the date, small, under the clock's bottom-right edge (where Apple's StandBy puts its one line)
    const dateLine = h('div', 'sbx-date');
    main.append(phaseEl, clock, alt, dateLine);

    const dayEl = h('b'), dateEl = h('span');
    const tempEl = h('div', 'sbx-temp');
    const blocksEl = h('div', 'sbx-blocks');
    const side = h('div', 'sbx-side', h('div', 'sbx-day', dayEl, dateEl), tempEl, h('div', 'sbx-spacer'), blocksEl);
    stage.append(main, side);

    const focusBtn = h('button', 'sbx-focus');
    focusBtn.type = 'button';
    // AI usage: one frosted pill bottom right (mirrors Focus); tap opens the AI quotas page
    const aiBtn = h('button', 'sbx-ai');
    aiBtn.type = 'button';
    aiBtn.setAttribute('aria-label', 'AI usage');
    aiBtn.addEventListener('click', () => { haptic(); gotoPageRef('ai'); });

    // the media player: a real media widget on frosted glass, created once and kept, so it slides instead of rebuilding
    const mediaBox = h('div', 'w w-media sbx-media');
    const glass = h('div', 'sbx-glass');
    let mediaInst = {};
    try { mediaInst = W.media.create(mediaBox, { ...ctx, w: { ...ctx.w, id: `${id}:media`, type: 'media', options: {} }, o: {}, box: mediaBox }) || {}; } catch (e) { console.warn('standby media', e); }
    mediaBox.prepend(glass);
    const art = mediaBox.querySelector('.art');
    const syncGlass = () => { glass.style.backgroundImage = art?.classList.contains('on') && art.src ? `url("${art.src}")` : ''; };
    art?.addEventListener('load', syncGlass);
    art?.addEventListener('error', syncGlass);
    const mediaNeeds = mediaInst.needs || W.media.needs;

    // colour editor (hold the clock): frosted bar with the face name, swatches and Done
    const edName = h('div', 'sbx-ed-name');
    const edHint = h('div', 'sbx-ed-hint', 'Swipe ← → colour · ↑ ↓ style');
    const swatches = h('div', 'sbx-swatches');
    const doneBtn = h('button', 'sbx-ed-done', 'Done');
    doneBtn.type = 'button';
    const editor = h('div', 'sbx-editor', h('div', 'sbx-ed-text', edName, edHint), swatches, doneBtn);
    editor.inert = true;

    // the row under the clock, spanning the clock's width: Focus | motive | AI usage
    const row = h('div', 'sbx-row', focusBtn, motiveEl, aiBtn);
    const tag = h('div', 'sbx-tag'); tag.textContent = '#INAN';  // local patch: name tag, top-left corner
    root.append(stage, row, mediaBox, editor, tag);
    box.append(root);

    let isBreak = false;
    const applyColor = () => {
      const pal = colorOf(face);
      const c = isBreak ? (pal.id === 'green' ? BREAK.alt : BREAK.std) : pal.c;
      root.style.setProperty('--sb-a', c[0]);
      root.style.setProperty('--sb-b', c[1] || c[0]);
      root.style.setProperty('--sb-tall', face === 'tall' ? (isBreak ? c[1] : c[0]) : c[1] || c[0]);
      altFace?.color(c[0], face === 'vapor' ? (isBreak ? '#ffffff' : pal.c[1]) : c[1]);
      // one theme across every page: the StandBy colour is the app's accent (rings, charts, labels, shortcut icons)
      const de = document.documentElement.style, acc = face === 'playful' ? (pal.c[1] || pal.c[0]) : pal.c[0];
      globalThis.__sbxAccent = acc; // main.js uses it when it (re)applies the display settings
      de.setProperty('--accent', acc);
      de.setProperty('--theme-accent', acc);       // hex on purpose: charts append an alpha suffix to it
      de.setProperty('--theme-accent-2', pal.c[0]);
    };
    let editing = false, editTimer = 0;
    const renderEditor = () => {
      const pal = colorOf(face);
      edName.textContent = `${FACE_NAME[face]} · ${pal.name}`;
      swatches.replaceChildren(...PALETTES[face].map((x) => {
        const b = h('button', `sbx-sw${x.id === pal.id ? ' on' : ''}`);
        b.type = 'button';
        b.setAttribute('aria-label', x.name);
        b.style.background = x.c.length > 1 ? `linear-gradient(135deg, ${x.c[0]} 50%, ${x.c[1]} 50%)` : x.c[0];
        b.addEventListener('click', (e) => { e.stopPropagation(); pickColor(x.id); });
        return b;
      }));
    };
    const bumpEdit = () => { clearTimeout(editTimer); editTimer = setTimeout(() => exitEdit(), EDIT_IDLE_MS); };
    const pickColor = (cid) => { haptic(); store.set(colorKey(face), cid); applyColor(); renderEditor(); bumpEdit(); };
    const stepColor = (dir) => {
      const list = PALETTES[face], i = list.indexOf(colorOf(face));
      pickColor(list[(i + dir + list.length) % list.length].id);
    };
    const enterEdit = () => {
      if (editing) return;
      editing = true; haptic(); renderEditor();
      root.classList.add('sbx-editing'); editor.inert = false; bumpEdit();
    };
    function exitEdit() {
      if (!editing) return;
      editing = false; clearTimeout(editTimer);
      root.classList.remove('sbx-editing'); editor.inert = true;
    }
    doneBtn.addEventListener('click', (e) => { e.stopPropagation(); haptic(); exitEdit(); });
    editor.addEventListener('pointerdown', (e) => e.stopPropagation());

    const mountAlt = (f) => {
      try { altFace?.destroy(); } catch (_) {}
      alt.replaceChildren();
      altFace = EXTRA_FACES[f] ? EXTRA_FACES[f]() : null;
      if (altFace) { alt.append(altFace.el); altFace.set(lastStr, false); }
    };
    const setFace = (f, animate) => {
      face = f;
      if (!animate) { root.dataset.face = f; mountAlt(f); applyColor(); if (editing) renderEditor(); return; }
      root.classList.add('sbx-swap');
      setTimeout(() => { root.dataset.face = f; mountAlt(f); applyColor(); if (editing) renderEditor(); root.classList.remove('sbx-swap'); }, 220);
    };
    setFace(face, false);

    // ------------------------------------------------ pomodoro
    const phaseNow = () => {
      if (!pomo) return null;
      const kind = kindOf(pomo.index, conf.cycles);
      const len = lengthOf(kind, conf);
      const elapsed = (pomo.pausedAt ?? Date.now()) - pomo.phaseStart;
      return { kind, len, left: Math.max(0, len - elapsed), block: Math.floor(pomo.index / 2) % conf.cycles + 1 };
    };
    const rollDay = () => { if (log.day !== dayKey()) { log = { ...log, day: dayKey(), today: 0 }; saveLog(); } };
    const advance = () => {
      // finish every phase that has ended (the panel may have been off for a while)
      let p = phaseNow();
      let rang = false;
      while (pomo && !pomo.pausedAt && p && p.left <= 0) {
        if (p.kind === 'work') { rollDay(); log.today += 1; log.lastEnd = pomo.phaseStart + p.len; saveLog(); }
        pomo = { index: pomo.index + 1, phaseStart: pomo.phaseStart + p.len, pausedAt: null };
        rang = true; p = phaseNow();
      }
      if (rang) { savePomo(); try { chime(0.7, true); } catch (_) {} haptic(); }
    };
    const start = () => { pomo = { index: 0, phaseStart: Date.now(), pausedAt: null }; savePomo(); haptic(); render(); };
    const stop = () => { pomo = null; savePomo(); haptic(); render(); };
    const togglePause = () => {
      if (!pomo) return;
      if (pomo.pausedAt) pomo = { ...pomo, phaseStart: pomo.phaseStart + (Date.now() - pomo.pausedAt), pausedAt: null };
      else pomo = { ...pomo, pausedAt: Date.now() };
      savePomo(); haptic(); render();
    };
    focusBtn.addEventListener('click', () => (pomo ? stop() : start()));

    // gestures on the clock:
    //   hold = colour editor;  vertical swipe = face;  tap = pause/resume a running pomodoro
    //   in the editor: horizontal swipe = colour, vertical swipe = face, tap = done
    let y0 = null, x0 = 0, t0 = 0, holdTimer = 0, held = false;
    stage.addEventListener('pointerdown', (e) => {
      y0 = e.clientY; x0 = e.clientX; t0 = Date.now(); held = false;
      clearTimeout(holdTimer);
      if (!editing) holdTimer = setTimeout(() => { held = true; enterEdit(); }, 550);
    });
    stage.addEventListener('pointermove', (e) => {
      if (y0 != null && Math.hypot(e.clientX - x0, e.clientY - y0) > 12) clearTimeout(holdTimer);
    });
    stage.addEventListener('pointerup', (e) => {
      clearTimeout(holdTimer);
      if (y0 == null || held) { y0 = null; return; }
      const dy = e.clientY - y0, dx = e.clientX - x0; y0 = null;
      const vertical = Math.abs(dy) >= 40 && Math.abs(dy) >= Math.abs(dx) * 1.3;
      const horizontal = Math.abs(dx) >= 40 && Math.abs(dx) >= Math.abs(dy) * 1.3;
      const tap = Math.abs(dx) < 12 && Math.abs(dy) < 12 && Date.now() - t0 < 500;
      if (vertical) {
        const next = FACES[(FACES.indexOf(face) + (dy < 0 ? 1 : FACES.length - 1)) % FACES.length];
        haptic(); store.set(faceKey, next); setFace(next, true);
        if (editing) bumpEdit();
      } else if (editing && horizontal) stepColor(dx < 0 ? 1 : -1);
      else if (editing && tap) { haptic(); exitEdit(); }
      else if (!editing && pomo && tap) togglePause();
    });
    stage.addEventListener('pointercancel', () => { y0 = null; clearTimeout(holdTimer); });

    // ------------------------------------------------ media
    let lastPlaying = 0, shown = null;
    const syncMedia = () => {
      const now = Date.now();
      if (media && media.playing) lastPlaying = now;
      const show = !!media && (media.playing || now - lastPlaying < MEDIA_LINGER_MS) && o.media !== false;
      if (show !== shown) { shown = show; root.classList.toggle('with-media', show); mediaBox.inert = !show; syncGlass(); }
    };

    // ------------------------------------------------ render
    // iOS numeric-text transition: a changed digit rolls — the old glyph rises, blurs and fades, the new one comes up
    // from below with a little spring. Only digits that change move; the first paint and reduced motion don't animate.
    const glyphs = digits.map(() => null);
    const reduceMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; } };
    const setDigits = (s, animate = true) => {
      lastStr = s;
      if (altFace) { try { altFace.set(s, animate); } catch (e) { console.warn('standby face', e); } }
      for (let i = 0; i < 4; i++) {
        const c = s[i] === ' ' ? '' : s[i];
        digits[i].hidden = c === '';
        const cur = glyphs[i];
        if (cur && cur.textContent === c) continue;
        const g = h('b', 'sbx-g', c);
        if (cur && animate && c !== '' && !reduceMotion() && !document.hidden) {
          cur.classList.add('sbx-out');
          g.classList.add('sbx-in');
          digits[i].append(g);
          const old = cur;
          setTimeout(() => old.remove(), 700);
          requestAnimationFrame(() => requestAnimationFrame(() => g.classList.remove('sbx-in')));
        } else {
          digits[i].replaceChildren(g);
        }
        glyphs[i] = g;
      }
    };
    const render = () => {
      advance(); rollDay();
      const now = new Date();
      const p = phaseNow();
      root.classList.toggle('pomo', !!p);
      root.classList.toggle('pomo-break', !!p && p.kind !== 'work');
      if (isBreak !== (!!p && p.kind !== 'work')) { isBreak = !isBreak; applyColor(); }
      root.classList.toggle('pomo-paused', !!pomo?.pausedAt);
      if (p) {
        const secs = Math.ceil(p.left / 1000);
        const mm = Math.floor(secs / 60), ss = secs % 60;
        setDigits((mm < 10 ? ' ' : '') + String(Math.min(mm, 99)) + pad(ss));
        ap.textContent = '';
        phaseEl.textContent = pomo.pausedAt ? 'Paused · tap to resume'
          : `${PHASE_LABEL[p.kind]}${p.kind === 'work' ? ` · ${p.block}/${conf.cycles}` : ''}`;
        focusBtn.textContent = '■ Stop';
      } else {
        const H = now.getHours(), h12 = hour12();
        const hh = h12 ? String(H % 12 || 12) : pad(H);
        setDigits((hh.length === 1 ? ' ' : '') + hh + pad(now.getMinutes()));
        ap.textContent = h12 ? clockPeriod(now) : '';
        phaseEl.textContent = '';
        focusBtn.textContent = `▶ Focus ${conf.workMin}`;
      }
      // a running session keeps the panel out of the night screen until it ends or is paused
      globalThis.__sbxFocusing = !!p && !pomo.pausedAt;
      blocksEl.replaceChildren(h('span', 'sbx-b-ic', '◉'), h('span', '', `${log.today}/${goal}`));
      // local patch: no motive line any more; the row keeps an empty spacer between Focus and AI
      dayEl.textContent = now.toLocaleDateString(LOCALE, { weekday: 'short' }).replace('.', '').toUpperCase();
      dateEl.textContent = ' ' + now.getDate();
      const dl = now.toLocaleDateString(LOCALE, { weekday: 'short', day: 'numeric', month: 'short' });
      if (dateLine.textContent !== dl) dateLine.textContent = dl;
    };
    const renderWeather = () => { const l = wxLines(); tempEl.textContent = l ? l.temp : ''; };
    const ring = (pct, color) => {
      const r = 15.9155, c = Math.max(0, Math.min(100, pct));
      const el = h('span', 'sbx-ring');
      el.innerHTML = `<svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="${r}" class="bg"/>` +
        `<circle cx="18" cy="18" r="${r}" class="fg" stroke="${color}" stroke-dasharray="${c} 100" transform="rotate(-90 18 18)"/></svg>`;
      return el;
    };
    const untilWords = (ms) => {
      if (!(ms > 0)) return '';
      const m = Math.round(ms / MIN);
      return m < 60 ? `${m}m` : m < 48 * 60 ? `${Math.floor(m / 60)}h ${pad(m % 60)}m` : `${Math.round(m / 1440)}d`;
    };
    const renderQuota = () => {
      const items = quotaProviders().filter((x) => !x.error && x.limits?.length).slice(0, 2).map((p) => {
        const lim = p.limits[0];
        const pct = Math.round(lim.percent);
        const color = pct >= 90 ? '#ff453a' : pct >= 70 ? '#ff9f0a' : '#30d158';
        const name = String(p.id).split('@')[0] === 'claude' ? '✳' : (p.name || p.id).slice(0, 1);
        return h('span', 'sbx-ai-item', ring(pct, color), h('span', 'sbx-ai-ic', name), h('b', '', `${pct}%`),
          h('span', 'sbx-ai-reset', untilWords((lim.resetsAt || 0) - Date.now())));
      });
      aiBtn.hidden = items.length === 0;
      aiBtn.replaceChildren(...items);
    };

    render(); renderWeather(); renderQuota(); syncMedia();
    return {
      needs: W.standby.needs,
      update(kind, background) {
        if (kind === 'tick') { render(); syncMedia(); if (new Date().getSeconds() === 0) renderQuota(); }
        else if (kind === 'state') syncMedia();
        else if (kind === 'weather') renderWeather();
        else if (kind === 'quotas') renderQuota();
        if (mediaNeeds.includes(kind)) { try { mediaInst.update?.(kind, background); } catch (e) { console.warn('standby media', e); } }
      },
      destroy() { try { altFace?.destroy(); } catch (_) {} globalThis.__sbxFocusing = false; clearTimeout(holdTimer); clearTimeout(editTimer); try { mediaInst.destroy?.(); } catch (_) {} },
    };
  },
};

// The agent keeps only widget types it knows (its catalog), so StandBy rides on the clock widget:
// a clock with options.face = "playful" | "tall" becomes the StandBy clock; any other clock is unchanged.
const plainClock = W.clock.create;
W.clock.create = function (box, ctx) {
  if (FACES.includes(ctx?.o?.face)) { box.classList.add('w-standby'); return W.standby.create(box, ctx); }
  return plainClock.call(this, box, ctx);
};
