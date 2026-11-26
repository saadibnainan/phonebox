// StandBy (local patch): an iOS StandBy-style full-screen clock.
// Faces: "playful" (big rounded digits overlapping in two tones) and "tall" (condensed digits with a side column:
// day + date, temperature, Claude session quota). Swipe up/down on the clock to change face (remembered per widget).
// While something plays on the computer the clock glides to the left half and the media player slides in on the
// right; it leaves again after playback has been stopped for a short while.
import { D, LOCALE, cfg, clockPeriod, h, haptic, hour12, media, pad, quotaProviders, store, wxLines } from '../main.js';
import { W } from '../registry.js';

const FACES = ['playful', 'tall'];
const MEDIA_LINGER_MS = 20000; // paused/stopped media keeps its place this long (track changes, short pauses)

W.standby = {
  bare: true,
  needs: ['tick', 'state', 'fast', 'media', 'weather', 'quotas'],
  create(box, ctx) {
    const o = ctx.o || {};
    const key = `standby-face:${ctx.w?.id || 'standby'}`;
    let face = FACES.includes(store.get(key, null)) ? store.get(key, null) : (FACES.includes(o.face) ? o.face : 'playful');

    const root = h('div', 'sbx');
    const stage = h('div', 'sbx-stage');
    const clock = h('div', 'sbx-clock');
    const digits = [0, 1, 2, 3].map((i) => h('span', `sbx-d sbx-d${i}`));
    const colon = h('span', 'sbx-colon', h('i'), h('i'));
    const ap = h('span', 'sbx-ap');
    clock.append(digits[0], digits[1], colon, digits[2], digits[3], ap);

    const dayEl = h('b'), dateEl = h('span');
    const tempEl = h('div', 'sbx-temp');
    const quotaEl = h('div', 'sbx-quota');
    const side = h('div', 'sbx-side', h('div', 'sbx-day', dayEl, dateEl), tempEl, h('div', 'sbx-spacer'), quotaEl);
    stage.append(clock, side);

    // the media player: a real media widget, created once and kept, so it slides instead of rebuilding
    const mediaBox = h('div', 'w w-media card sbx-media');
    try { globalThis.PhoneBoxAppearance?.widget(mediaBox, ctx.appearance); } catch (_) {}
    let mediaInst = {};
    try { mediaInst = W.media.create(mediaBox, { ...ctx, w: { ...ctx.w, id: `${ctx.w?.id}:media`, type: 'media', options: {} }, o: {}, box: mediaBox }) || {}; } catch (e) { console.warn('standby media', e); }
    const mediaNeeds = mediaInst.needs || W.media.needs;

    root.append(stage, mediaBox);
    box.append(root);

    const setFace = (f, animate) => {
      face = f;
      if (!animate) { root.dataset.face = f; return; }
      root.classList.add('sbx-swap');
      setTimeout(() => { root.dataset.face = f; root.classList.remove('sbx-swap'); }, 220);
    };
    setFace(face, false);

    // vertical swipe on the clock changes face (horizontal swipes stay with page navigation)
    let y0 = null, x0 = 0;
    stage.addEventListener('pointerdown', (e) => { y0 = e.clientY; x0 = e.clientX; });
    stage.addEventListener('pointerup', (e) => {
      if (y0 == null) return;
      const dy = e.clientY - y0, dx = e.clientX - x0; y0 = null;
      if (Math.abs(dy) < 50 || Math.abs(dy) < Math.abs(dx) * 1.5) return;
      const next = FACES[(FACES.indexOf(face) + (dy < 0 ? 1 : FACES.length - 1)) % FACES.length];
      haptic(); store.set(key, next); setFace(next, true);
    });
    stage.addEventListener('pointercancel', () => { y0 = null; });

    let lastPlaying = 0, shown = null;
    const syncMedia = () => {
      const now = Date.now();
      if (media && media.playing) lastPlaying = now;
      const show = !!media && (media.playing || now - lastPlaying < MEDIA_LINGER_MS) && o.media !== false;
      if (show !== shown) { shown = show; root.classList.toggle('with-media', show); mediaBox.inert = !show; }
    };

    const renderClock = () => {
      const now = new Date();
      const H = now.getHours(), h12 = hour12();
      const hh = h12 ? String(H % 12 || 12) : pad(H), mm = pad(now.getMinutes());
      const s = (hh.length === 1 ? ' ' : '') + hh + mm;
      for (let i = 0; i < 4; i++) {
        const c = s[i] === ' ' ? '' : s[i];
        if (digits[i].textContent !== c) digits[i].textContent = c;
        digits[i].hidden = c === '';
      }
      ap.textContent = h12 ? clockPeriod(now) : '';
      dayEl.textContent = now.toLocaleDateString(LOCALE, { weekday: 'short' }).replace('.', '').toUpperCase();
      dateEl.textContent = ' ' + now.getDate();
    };
    const renderWeather = () => {
      const l = wxLines();
      tempEl.textContent = l ? l.temp : '';
    };
    const renderQuota = () => {
      const p = quotaProviders().find((x) => String(x.id).split('@')[0] === 'claude');
      const lim = p?.limits?.[0];
      quotaEl.replaceChildren(...(lim ? [h('span', 'sbx-q-ic', '✳'), h('span', '', `${Math.round(lim.percent)}%`)] : []));
    };

    renderClock(); renderWeather(); renderQuota(); syncMedia();
    return {
      needs: W.standby.needs,
      update(kind, background) {
        if (kind === 'tick') { renderClock(); syncMedia(); }
        else if (kind === 'state') syncMedia();
        else if (kind === 'weather') renderWeather();
        else if (kind === 'quotas') renderQuota();
        if (mediaNeeds.includes(kind)) { try { mediaInst.update?.(kind, background); } catch (e) { console.warn('standby media', e); } }
      },
      destroy() { try { mediaInst.destroy?.(); } catch (_) {} },
    };
  },
};
