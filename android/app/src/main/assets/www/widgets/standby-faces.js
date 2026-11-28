// StandBy extra faces (local patch), each { el, set(text4, animate), color(c0, c1), destroy() }.
// text4 is the clock as four characters ("1035", " 935" for 12 h without a leading zero, or a MM:SS countdown).
//   flip  — split-flap cards: the top half folds down over the new digit (two-half flip, not a fade)
//   vapor — glowing digits on a canvas; a changed digit dissolves into rising particles while the new one condenses
//   disk  — flip-disk matrix (port of flip-disk-matrix.tsx: 5×7 glyphs, 31×11 disks, springy rotateX flip),
//           disks flip with a small left-to-right ripple like a real electromechanical board
import { h } from '../main.js';

const reduce = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; } };

// ---------------------------------------------------------------- flip (split-flap)
function flipFace() {
  const el = h('div', 'sbf');
  const cards = [];
  const mkCard = () => {
    const c = h('div', 'sbf-card');
    const half = (cls, ch) => { const d = h('div', `sbf-half ${cls}`); d.append(h('span', '', ch)); return d; };
    c.append(half('sbf-top', ''), half('sbf-bot', ''));
    c.__ch = '';
    return c;
  };
  for (let i = 0; i < 4; i++) {
    const c = mkCard(); cards.push(c);
    el.append(c);
    if (i === 1) el.append(h('div', 'sbf-colon', h('i'), h('i')));
  }
  const setHalf = (half, ch) => { half.firstChild.textContent = ch; };
  function set(s, animate) {
    for (let i = 0; i < 4; i++) {
      const c = cards[i], ch = s[i] === ' ' ? '' : s[i];
      c.hidden = ch === '' && i === 0;
      if (c.__ch === ch) continue;
      const old = c.__ch; c.__ch = ch;
      const top = c.querySelector('.sbf-top'), bot = c.querySelector('.sbf-bot');
      if (!animate || reduce() || document.hidden || old === '') { setHalf(top, ch); setHalf(bot, ch); continue; }
      // static halves: new top shows behind the falling flap, old bottom stays until the flap lands
      setHalf(top, ch); setHalf(bot, old);
      const flapTop = h('div', 'sbf-half sbf-top sbf-flap-top'); flapTop.append(h('span', '', old));
      const flapBot = h('div', 'sbf-half sbf-bot sbf-flap-bot'); flapBot.append(h('span', '', ch));
      c.append(flapTop, flapBot);
      setTimeout(() => { setHalf(bot, ch); flapTop.remove(); flapBot.remove(); }, 620);
    }
  }
  return { el, set, color() {}, destroy() {} };
}

// ---------------------------------------------------------------- vapor (canvas particles)
function vaporFace() {
  const el = h('div', 'sbv');
  const cv = h('canvas', 'sbv-cv');
  el.append(cv);
  const g = cv.getContext('2d');
  let text = '    ', prev = '    ', glow = '#64d2ff', core = '#e6f6ff';
  let W = 0, H = 0, dpr = 1, font = '', slots = [], raf = 0, dead = false;
  const parts = [];                // dissolving particles
  const born = [0, 0, 0, 0];      // per slot: when its new digit started condensing
  const CONDENSE = 900, LIFE = 1400;

  function layout() {
    const r = el.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const size = Math.min(H * 0.92, W / 2.7);
    // the font picker's clock font (style.css --pf-clock): Ndot under "Nothing", otherwise the text font, bolder
    const fam = getComputedStyle(document.documentElement).getPropertyValue('--pf-clock').trim() || 'Inter, sans-serif';
    font = `${document.documentElement.dataset.font === 'nothing' ? 400 : 600} ${size}px ${fam}`;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.font = font;
    const dw = g.measureText('0').width, cw = size * 0.32;
    const total = dw * 4 + cw;
    let x = (W - total) / 2;
    slots = [];
    for (let i = 0; i < 4; i++) { slots.push({ x: x + dw / 2, w: dw }); x += dw + (i === 1 ? cw : 0); }
    slots.colon = { x: slots[1].x + dw / 2 + cw / 2 };
    // where the digits really end, so the date line under the clock can line up with them
    (el.closest('.sbx-main') || el).style.setProperty('--ink-r', `${Math.max(0, (W - total) / 2)}px`);
    slots.y = H / 2 + size * 0.36;
    slots.size = size;
  }

  function sample(ch, cx) {
    // the old glyph's pixels become particles
    const s = slots.size, off = document.createElement('canvas');
    const w = Math.ceil(s * 0.8), hh = Math.ceil(s * 1.1);
    off.width = w; off.height = hh;
    const o = off.getContext('2d');
    o.font = font; o.textAlign = 'center'; o.fillStyle = '#fff';
    o.fillText(ch, w / 2, hh * 0.85);
    const data = o.getImageData(0, 0, w, hh).data;
    const step = Math.max(2, Math.round(s / 90));
    const now = performance.now();
    for (let y = 0; y < hh; y += step) for (let x = 0; x < w; x += step) {
      if (data[(y * w + x) * 4 + 3] > 120) {
        parts.push({ x: cx - w / 2 + x, y: slots.y - hh * 0.85 + y, vx: (Math.random() - 0.3) * 0.6, vy: -(0.4 + Math.random() * 1.4),
          t0: now + Math.random() * 180, r: step * (0.5 + Math.random() * 0.6) });
      }
    }
  }

  function drawGlyph(ch, x, alpha, blur) {
    if (!ch || alpha <= 0) return;
    g.save();
    g.globalAlpha = alpha;
    if (blur > 0.3) g.filter = `blur(${blur}px)`;
    g.textAlign = 'center';
    g.shadowColor = glow; g.shadowBlur = slots.size * 0.12;
    g.fillStyle = core;
    g.fillText(ch, x, slots.y);
    g.restore();
  }

  function frame(now) {
    raf = 0;
    if (dead) return;
    g.clearRect(0, 0, W, H);
    g.font = font;
    let busy = false;
    for (let i = 0; i < 4; i++) {
      const ch = text[i] === ' ' ? '' : text[i];
      const k = born[i] ? Math.min(1, (now - born[i]) / CONDENSE) : 1;
      if (k < 1) busy = true;
      const e = 1 - Math.pow(1 - k, 3);
      drawGlyph(ch, slots[i].x, e, (1 - e) * slots.size * 0.08);
    }
    // colon: two soft dots
    g.save(); g.fillStyle = core; g.shadowColor = glow; g.shadowBlur = slots.size * 0.12;
    for (const fy of [-0.42, -0.08]) { g.beginPath(); g.arc(slots.colon.x, slots.y + slots.size * fy, slots.size * 0.045, 0, 7); g.fill(); }
    g.restore();
    // vapor
    if (parts.length) {
      busy = true;
      g.save(); g.fillStyle = glow;
      for (let j = parts.length - 1; j >= 0; j--) {
        const p = parts[j], age = now - p.t0;
        if (age < 0) { g.globalAlpha = 1; g.fillRect(p.x, p.y, p.r, p.r); continue; }
        if (age > LIFE) { parts.splice(j, 1); continue; }
        const a = 1 - age / LIFE;
        p.x += p.vx + Math.sin((p.y + age) * 0.02) * 0.35;
        p.y += p.vy; p.vy *= 0.995;
        g.globalAlpha = a * a;
        g.fillRect(p.x, p.y, p.r * (1 + age / LIFE), p.r * (1 + age / LIFE));
      }
      g.restore();
    }
    if (busy) raf = requestAnimationFrame(frame);
  }
  const kick = () => { if (!raf && !dead) raf = requestAnimationFrame(frame); };

  const ro = new ResizeObserver(() => { layout(); kick(); });
  const relayout = () => { if (dead) return; layout(); kick(); };
  const loadFont = () => { if (document.fonts) document.fonts.load(font || '400 40px Ndot').then(relayout, () => {}); };
  loadFont();
  const onFont = () => { layout(); loadFont(); kick(); };
  window.addEventListener('pb-font', onFont);
  ro.observe(el);

  function set(s, animate) {
    if (!W) layout();
    if (s === text && W) return; // the same time again: nothing to draw (StandBy calls this every second)
    prev = text; text = s;
    for (let i = 0; i < 4; i++) {
      if (prev[i] === s[i]) continue;
      const old = prev[i] === ' ' ? '' : prev[i];
      if (animate && !reduce() && !document.hidden && old) { sample(old, slots[i].x); born[i] = performance.now(); }
      else born[i] = 0;
    }
    kick();
  }
  return {
    el, set,
    color(c0, c1) { glow = c0; core = c1 || '#ffffff'; kick(); },
    destroy() { dead = true; ro.disconnect(); window.removeEventListener('pb-font', onFont); if (raf) cancelAnimationFrame(raf); },
  };
}

// ---------------------------------------------------------------- disk (flip-disk matrix)
const GLYPHS = {
  0: [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
  1: [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  2: [0b01110, 0b10001, 0b00001, 0b00110, 0b01000, 0b10000, 0b11111],
  3: [0b01110, 0b10001, 0b00001, 0b00110, 0b00001, 0b10001, 0b01110],
  4: [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
  5: [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
  6: [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
  7: [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
  8: [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
  9: [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100],
  ':': [0b00000, 0b00100, 0b00000, 0b00000, 0b00000, 0b00100, 0b00000],
  ' ': [0, 0, 0, 0, 0, 0, 0],
};
function bitmap(str, cols, rows) {
  const grid = Array.from({ length: rows }, () => Array(cols).fill(false));
  const chars = str.split(''), gw = 5, gh = 7;
  const totalW = chars.length * (gw + 1) - 1;
  let ox = Math.max(0, Math.floor((cols - totalW) / 2));
  const oy = Math.max(0, Math.floor((rows - gh) / 2));
  for (const c of chars) {
    const bits = GLYPHS[c] || GLYPHS[' '];
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      if (oy + y < rows && ox + x < cols) grid[oy + y][ox + x] = !!(bits[y] & (1 << (gw - 1 - x)));
    }
    ox += gw + 1;
  }
  return grid;
}
function diskFace() {
  const COLS = 31, ROWS = 11;
  const el = h('div', 'sbk');
  const screen = h('div', 'sbk-screen');
  screen.style.setProperty('--cols', COLS);
  el.append(screen);
  const disks = [];
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const d = h('div', 'sbk-d');
    const inner = h('div', 'sbk-in', h('div', 'sbk-off'), h('div', 'sbk-on'));
    d.append(inner);
    d.style.setProperty('--dly', `${x * 14 + y * 6}ms`); // the ripple
    screen.append(d);
    disks.push(d);
  }
  let shown = '';
  function set(s, animate) {
    const str = `${s.slice(0, 2)}:${s.slice(2, 4)}`;
    if (str === shown) return;
    shown = str;
    el.classList.toggle('sbk-instant', !animate || reduce());
    const grid = bitmap(str, COLS, ROWS);
    grid.forEach((row, y) => row.forEach((on, x) => disks[y * COLS + x].classList.toggle('on', on)));
  }
  return { el, set, color() {}, destroy() {} };
}

export const EXTRA_FACES = { flip: flipFace, vapor: vaporFace, disk: diskFace };
