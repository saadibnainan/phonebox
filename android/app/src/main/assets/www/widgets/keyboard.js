// Keyboard (local patch): a remote keyboard for the PC, riding on the Dictation widget (options.keyboard = true),
// because the agent keeps only widget types from its catalog and checks typing permission on a dictate widget.
//   text box  → typed on the PC with the dictation endpoint ("Type", or "Type ↵" to press Enter after it)
//   key grid  → the agent's builtin:keys shortcuts kb-* (Esc, Tab, ⌫, Del, arrows, Home/End, Space, ↵, Ctrl+C/V/X/Z/A/S, ⌘Q = Alt+Q)
// ⌫, Del, Home/End and the arrows go down and up like real keys (the PC repeats them while held). Needs the dictation widget's "Type the text on the computer" (control) on.
import { API, PANEL_HEADERS, api, h, haptic, toast } from '../main.js';
import { W } from '../registry.js';

const KEYS = [
  ['kb-esc', 'Esc'], ['kb-tab', 'Tab'], ['kb-backspace', '⌫'], ['kb-delete', 'Del'],
  ['kb-home', 'Home'], ['kb-up', '↑'], ['kb-end', 'End'], ['kb-enter', '↵'],
  ['kb-left', '←'], ['kb-down', '↓'], ['kb-right', '→'], ['kb-space', 'Space'],
  ['kb-ctrl-c', 'Ctrl C'], ['kb-ctrl-v', 'Ctrl V'], ['kb-ctrl-x', 'Ctrl X'], ['kb-ctrl-z', 'Ctrl Z'],
  ['kb-ctrl-a', 'Ctrl A'], ['kb-ctrl-s', 'Ctrl S'], ['kb-cmd-q', '⌘ Q'], // ⌘ = Alt here: Alt+Q closes the window (hypr/user.lua)
];
const MAX_CHARS = 2000;

function createKeyboard(box, ctx) {
  const o = ctx.o || {};
  const wq = 'widget=' + encodeURIComponent(`${ctx.page.id}/${ctx.w.id}`);
  const root = h('div', 'kbx');
  const input = h('input', 'kbx-input');
  input.type = 'text';
  input.placeholder = 'Type here…';
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('autocapitalize', 'off');
  input.setAttribute('spellcheck', 'false');
  const send = h('button', 'kbx-send', 'Type');
  const sendEnter = h('button', 'kbx-send kbx-send-enter', 'Type ↵');
  [send, sendEnter].forEach((b) => { b.type = 'button'; });
  const note = h('div', 'kbx-note');
  const grid = h('div', 'kbx-keys');
  root.append(h('div', 'kbx-row', input, send, sendEnter), note, grid);
  box.append(root);

  const say = (msg, kind = '') => { note.textContent = msg; note.dataset.kind = kind; clearTimeout(say.t); say.t = setTimeout(() => { note.textContent = ''; }, 2500); };
  const press = async (id) => {
    try { await api('/run/' + encodeURIComponent(id), 'POST', 4000); return true; }
    catch (_) { say('The PC did not answer', 'err'); return false; }
  };

  async function typeText(enter) {
    const text = input.value;
    if (!text.trim()) { if (enter) { haptic(); press('kb-enter'); } return; }
    if (o.control !== true) { say('Typing is off in this widget\'s settings', 'err'); return; }
    if (text.length > MAX_CHARS) { say('Too long', 'err'); return; }
    haptic();
    try {
      const r = await fetch(`${API}/dictate?${wq}&text=${encodeURIComponent(text)}`, { method: 'POST', cache: 'no-store', headers: PANEL_HEADERS });
      if (!r.ok) { let e = 'HTTP ' + r.status; try { e = (await r.json()).error || e; } catch (_) {} throw new Error(e); }
      input.value = '';
      if (enter) await press('kb-enter');
      say('Typed', 'ok');
    } catch (e) { say(String(e.message || e), 'err'); }
  }
  send.addEventListener('click', () => typeText(false));
  sendEnter.addEventListener('click', () => typeText(true));
  // the phone keyboard's own Enter sends the text and presses Enter on the PC
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); typeText(true); } });

  // Keys that repeat (arrows, ⌫, Del, Home, End) work like a real keyboard: the key goes down when the finger lands and
  // up when it lifts, and the computer repeats it while it is held, at its own rate (pb-pointerd's virtual keyboard,
  // hidden shortcuts kb-<key>-down / kb-<key>-up). Each "up" waits for its "down", so they never arrive the wrong way
  // round. Other keys are one tap each (builtin:keys).
  const HOLDABLE = new Set(['kb-left', 'kb-right', 'kb-up', 'kb-down', 'kb-backspace', 'kb-delete', 'kb-home', 'kb-end']);
  const releases = new Set();
  for (const [id, label] of KEYS) {
    const b = h('button', 'kbx-key', label);
    b.type = 'button';
    b.setAttribute('aria-label', label);
    if (HOLDABLE.has(id)) {
      let chain = Promise.resolve(), down = false;
      const release = () => {
        b.classList.remove('down');
        if (!down) return;
        down = false; releases.delete(release);
        chain = chain.then(() => press(`${id}-up`));
      };
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault(); // keep the text box (and the phone keyboard) as they are
        try { b.setPointerCapture(e.pointerId); } catch (_) {}
        if (down) return;
        down = true; releases.add(release);
        b.classList.add('down'); haptic();
        chain = chain.then(() => press(`${id}-down`));
      });
      ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => b.addEventListener(ev, release));
    } else {
      let busy = false;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        b.classList.add('down'); haptic();
        if (!busy) { busy = true; press(id).finally(() => { busy = false; }); }
      });
      ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => b.addEventListener(ev, () => b.classList.remove('down')));
    }
    grid.append(b);
  }
  // a panel that is left or hidden lets go of every held key
  const releaseAll = () => { for (const r of [...releases]) r(); };
  const onHide = () => { if (document.hidden) releaseAll(); };
  document.addEventListener('visibilitychange', onHide);

  return {
    needs: [],
    update() {},
    destroy() { releaseAll(); document.removeEventListener('visibilitychange', onHide); },
  };
}

const plainDictate = W.dictate.create;
W.dictate.create = function (box, ctx) {
  if (ctx?.o?.keyboard === true) { box.classList.add('w-keyboard'); return createKeyboard(box, ctx); }
  return plainDictate.call(this, box, ctx);
};
