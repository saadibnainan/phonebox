// StandBy (local patch): an iOS StandBy-style full-screen clock.
// Faces: "playful" (big rounded digits overlapping in two tones) and "tall" (condensed digits with a side column:
// day + date, temperature, Claude session quota). Swipe up/down on the clock to change face (remembered per widget).
// Focus: a pomodoro (25/5/15 × 4, trackMe's defaults and phase rules). Tap the Focus pill to start; while it runs the
// big digits count down, a tap pauses/resumes and a long press stops it. Under the clock one line of motivation in
// trackMe's wording and tone (options.tone: brutal | honest | encouraging), about blocks done today vs options.goal.
// While something plays on the computer the clock glides left and a frosted media panel (30 % wide) slides in on the
// right; it leaves again after playback has been stopped for a short while.
import { LOCALE, chime, clockPeriod, h, haptic, hour12, media, pad, quotaProviders, store, wxLines } from '../main.js';
import { W } from '../registry.js';

const FACES = ['playful', 'tall'];
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

// trackMe lib/accountability/reality.ts, scoped to what the panel knows: blocks done here and today's goal
function motive(tone, s) {
  const pick = (m) => m[tone] || m.brutal;
  if (s.running && s.kind === 'work') return pick({
    brutal: 'Timer running. Finish the block before you touch your phone.',
    honest: 'Timer running.',
    encouraging: "You're studying. Keep going.",
  });
  if (s.running) return pick({
    brutal: 'Break. Stand up, then get back to it.',
    honest: 'Break.',
    encouraging: 'Break. You earned it.',
  });
  if (!s.lastEnd) return pick({
    brutal: 'Not a single minute logged yet.',
    honest: 'No study time logged yet.',
    encouraging: 'Your first session starts here.',
  });
  const idleMs = Date.now() - s.lastEnd;
  if (s.today === 0 && idleMs >= 20 * 3_600_000) {
    const idle = durWords(idleMs);
    return pick({
      brutal: `${idle} without studying.`,
      honest: `Last study session: ${idle} ago.`,
      encouraging: `It's been ${idle}. A short session today restarts the habit.`,
    });
  }
  const left = s.goal - s.today;
  if (left > 0) {
    const b = `${left} ${left === 1 ? 'block' : 'blocks'}`;
    return pick({
      brutal: `${b} short of your own goal today.`,
      honest: `${s.today} of ${s.goal} blocks today.`,
      encouraging: `${b} to go today. One at a time.`,
    });
  }
  return pick({
    brutal: "Goal done. Don't get comfortable.",
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
    main.append(phaseEl, clock, motiveEl);

    const dayEl = h('b'), dateEl = h('span');
    const tempEl = h('div', 'sbx-temp');
    const quotaEl = h('div', 'sbx-quota');
    const side = h('div', 'sbx-side', h('div', 'sbx-day', dayEl, dateEl), tempEl, h('div', 'sbx-spacer'), quotaEl);
    stage.append(main, side);

    const focusBtn = h('button', 'sbx-focus');
    focusBtn.type = 'button';

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

    root.append(stage, focusBtn, mediaBox);
    box.append(root);

    const setFace = (f, animate) => {
      face = f;
      if (!animate) { root.dataset.face = f; return; }
      root.classList.add('sbx-swap');
      setTimeout(() => { root.dataset.face = f; root.classList.remove('sbx-swap'); }, 220);
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

    // gestures on the clock: vertical swipe = face, tap = pause/resume a running pomodoro, long press = stop it
    let y0 = null, x0 = 0, t0 = 0, holdTimer = 0, held = false;
    stage.addEventListener('pointerdown', (e) => {
      y0 = e.clientY; x0 = e.clientX; t0 = Date.now(); held = false;
      clearTimeout(holdTimer);
      if (pomo) holdTimer = setTimeout(() => { held = true; stop(); }, 700);
    });
    stage.addEventListener('pointerup', (e) => {
      clearTimeout(holdTimer);
      if (y0 == null || held) { y0 = null; return; }
      const dy = e.clientY - y0, dx = e.clientX - x0; y0 = null;
      if (Math.abs(dy) >= 50 && Math.abs(dy) >= Math.abs(dx) * 1.5) {
        const next = FACES[(FACES.indexOf(face) + (dy < 0 ? 1 : FACES.length - 1)) % FACES.length];
        haptic(); store.set(faceKey, next); setFace(next, true);
      } else if (pomo && Math.abs(dx) < 12 && Math.abs(dy) < 12 && Date.now() - t0 < 500) togglePause();
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
    const setDigits = (s) => {
      for (let i = 0; i < 4; i++) {
        const c = s[i] === ' ' ? '' : s[i];
        if (digits[i].textContent !== c) digits[i].textContent = c;
        digits[i].hidden = c === '';
      }
    };
    const render = () => {
      advance(); rollDay();
      const now = new Date();
      const p = phaseNow();
      root.classList.toggle('pomo', !!p);
      root.classList.toggle('pomo-break', !!p && p.kind !== 'work');
      root.classList.toggle('pomo-paused', !!pomo?.pausedAt);
      if (p) {
        const secs = Math.ceil(p.left / 1000);
        const mm = Math.floor(secs / 60), ss = secs % 60;
        setDigits((mm < 10 ? ' ' : '') + String(Math.min(mm, 99)) + pad(ss));
        ap.textContent = '';
        phaseEl.textContent = `${PHASE_LABEL[p.kind]}${p.kind === 'work' ? ` · ${p.block}/${conf.cycles}` : ''}${pomo.pausedAt ? ' · paused' : ''}`;
        focusBtn.textContent = '■ Stop';
      } else {
        const H = now.getHours(), h12 = hour12();
        const hh = h12 ? String(H % 12 || 12) : pad(H);
        setDigits((hh.length === 1 ? ' ' : '') + hh + pad(now.getMinutes()));
        ap.textContent = h12 ? clockPeriod(now) : '';
        phaseEl.textContent = '';
        focusBtn.textContent = `▶ Focus ${conf.workMin}`;
      }
      const m = motive(tone, { running: !!p && !pomo.pausedAt, kind: p?.kind, lastEnd: log.lastEnd, today: log.today, goal });
      if (motiveEl.textContent !== m) motiveEl.textContent = m;
      dayEl.textContent = now.toLocaleDateString(LOCALE, { weekday: 'short' }).replace('.', '').toUpperCase();
      dateEl.textContent = ' ' + now.getDate();
    };
    const renderWeather = () => { const l = wxLines(); tempEl.textContent = l ? l.temp : ''; };
    const renderQuota = () => {
      const p = quotaProviders().find((x) => String(x.id).split('@')[0] === 'claude');
      const lim = p?.limits?.[0];
      quotaEl.replaceChildren(...(lim ? [h('span', 'sbx-q-ic', '✳'), h('span', '', `${Math.round(lim.percent)}%`)] : []));
    };

    render(); renderWeather(); renderQuota(); syncMedia();
    return {
      needs: W.standby.needs,
      update(kind, background) {
        if (kind === 'tick') { render(); syncMedia(); }
        else if (kind === 'state') syncMedia();
        else if (kind === 'weather') renderWeather();
        else if (kind === 'quotas') renderQuota();
        if (mediaNeeds.includes(kind)) { try { mediaInst.update?.(kind, background); } catch (e) { console.warn('standby media', e); } }
      },
      destroy() { clearTimeout(holdTimer); try { mediaInst.destroy?.(); } catch (_) {} },
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
