/* Sudoku app — UI, state, PWA. Puzzles come from engine.js (via worker.js when available). */
(() => {
  'use strict';

  const E = self.SudokuEngine;
  const PEERS = E.PEERS;
  const I18N = self.I18N;
  let LANG = 'en';
  const t = (k, vars) => { let s = (I18N[LANG] && I18N[LANG][k]) || I18N.en[k] || k; if (vars) for (const v in vars) s = s.replace('{' + v + '}', vars[v]); return s; };
  const LEVEL_NAME = new Proxy({}, { get: (_, k) => t(k) });
  function applyLang(l) {
    LANG = I18N[l] ? l : 'en';
    document.documentElement.lang = LANG;
    document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
    if (S && !screens.game.hidden) { $('#levelLabel').textContent = S.level === 'daily' ? `${t('daily')} ${prettyDate(S.dateKey)}` : LEVEL_NAME[S.level]; render(); }
  }
  const MAX_MISTAKES = 3;

  // ---------- DOM ----------
  const $ = s => document.querySelector(s);
  const screens = { home: $('#home'), game: $('#game'), win: $('#win'), over: $('#over'), stats: $('#stats'), settings: $('#settings'), confirm: $('#confirm'), install: $('#install') };
  const hideOver = () => { if (!$('#over').hidden) { $('#over').hidden = true; $('#pad').hidden = false; applyTools(); } };
  const boardEl = $('#board');
  const cells = [];

  // ---------- State ----------
  let S = null;            // { level, puzzle, solution, grid, notes, time, hints, mistakes, seed?, dateKey? }
  let selected = -1;
  let notesMode = false;
  let tick = null;
  let history = [];
  let paused = false;

  const store = {
    get: (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch { return d; } },
    set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} }
  };
  const save = () => store.set('sudoku.game', S);
  const load = () => store.get('sudoku.game', null);
  const stats = () => store.get('sudoku.stats2', { levels: {}, daily: { streak: 0, last: null, done: {} } });
  const saveStats = st => store.set('sudoku.stats2', st);

  const OPT_DEFAULT = { highlight: true, mistakes: true, limit: true, timer: true, undo: true, erase: true, notes: true, auto: true, hint: true };
  let OPT = { ...OPT_DEFAULT, ...store.get('sudoku.opts', {}) };
  const saveOpts = () => store.set('sudoku.opts', OPT);

  const fmt = s => `${s / 60 | 0}:${String(s % 60).padStart(2, '0')}`;
  const buzz = p => { try { navigator.vibrate && navigator.vibrate(p); } catch {} };

  const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const keyToSeed = k => +k.replace(/-/g, '');
  const prettyDate = k => new Date(k + 'T12:00:00').toLocaleDateString(LANG, { month: 'short', day: 'numeric' });
  const yesterdayKey = () => { const d = new Date(); d.setDate(d.getDate() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  // ---------- Puzzle source (worker with fallback) ----------
  let worker = null, reqId = 0;
  const pending = new Map();
  try {
    worker = new Worker('worker.js');
    worker.onmessage = e => { const cb = pending.get(e.data.id); if (cb) { pending.delete(e.data.id); cb(e.data); } };
    worker.onerror = () => { worker = null; };
  } catch { worker = null; }

  function makePuzzle(level, seed) {
    return new Promise(resolve => {
      if (worker) {
        const id = ++reqId;
        pending.set(id, resolve);
        worker.postMessage({ id, level, seed });
        setTimeout(() => { if (pending.has(id)) { pending.delete(id); resolve(E.generate(level, seed)); } }, 8000);
      } else setTimeout(() => resolve(E.generate(level, seed)), 20);
    });
  }

  // ---------- Board ----------
  function buildBoard() {
    boardEl.innerHTML = '';
    for (let i = 0; i < 81; i++) {
      const d = document.createElement('div');
      d.className = 'cell';
      d.setAttribute('role', 'gridcell');
      d.addEventListener('pointerdown', e => { e.preventDefault(); select(i); });
      boardEl.appendChild(d);
      cells.push(d);
    }
  }

  function render() {
    if (!S) return;
    const selVal = selected >= 0 ? S.grid[selected] : 0;
    const counts = new Array(10).fill(0);
    for (let i = 0; i < 81; i++) {
      const el = cells[i], v = S.grid[i];
      if (v) counts[v]++;
      const given = S.puzzle[i] !== 0;
      let cls = 'cell';
      if (i % 9 === 2 || i % 9 === 5) cls += ' br';
      if ((i / 9 | 0) === 2 || (i / 9 | 0) === 5) cls += ' bb';
      if (given) cls += ' given'; else if (v) cls += ' user';
      if (OPT.mistakes && v && !given && v !== S.solution[i]) cls += ' wrong';
      if (i === selected) cls += ' sel';
      else if (OPT.highlight && selected >= 0 && PEERS[selected].includes(i)) cls += ' peer';
      if (OPT.highlight && selVal && v === selVal && i !== selected) cls += ' same';
      el.className = cls;
      if (v) el.textContent = v;
      else if (S.notes[i]) {
        el.textContent = '';
        const n = document.createElement('div'); n.className = 'notes';
        for (let k = 1; k <= 9; k++) { const s = document.createElement('span'); s.textContent = (S.notes[i] & (1 << k)) ? k : ''; n.appendChild(s); }
        el.appendChild(n);
      } else el.textContent = '';
    }
    document.querySelectorAll('#pad button').forEach(b => b.classList.toggle('done', counts[+b.dataset.n] >= 9));
    $('#undoBtn').disabled = history.length === 0;
    $('#notesBtn').classList.toggle('on', notesMode);
    $('#autoBtn').classList.toggle('on', !!S.auto);
    $('#mistakes').textContent = OPT.limit ? `${t('mistakes')} ${S.mistakes}/${MAX_MISTAKES}` : (S.mistakes ? `${t('mistakes')} ${S.mistakes}` : '');
    $('#mistakes').classList.toggle('warn', OPT.limit && S.mistakes >= MAX_MISTAKES - 1);
    $('#timer').hidden = !OPT.timer;
    $('.game-title .dot').hidden = !OPT.timer;
  }

  function select(i) { if (paused) return; selected = i; render(); }

  function pushHistory() { history.push({ grid: S.grid.slice(), notes: S.notes.slice() }); if (history.length > 300) history.shift(); }

  function input(n) {
    if (!S || paused || selected < 0 || S.puzzle[selected]) return;
    pushHistory();
    if (notesMode) {
      if (S.grid[selected]) S.grid[selected] = 0;
      S.notes[selected] ^= (1 << n);
      buzz(6);
    } else {
      const was = S.grid[selected];
      S.grid[selected] = was === n ? 0 : n;
      S.notes[selected] = 0;
      if (S.grid[selected]) {
        cells[selected].classList.add('pop');
        if (S.grid[selected] === S.solution[selected]) {
          for (const p of PEERS[selected]) S.notes[p] &= ~(1 << n);
          buzz(8);
        } else {
          S.mistakes++;
          buzz([40, 30, 40]);
          const c = cells[selected];
          c.classList.add('shake', 'oops');
          setTimeout(() => c.classList.remove('shake', 'oops'), 700);
          $('#mistakes').classList.add('bump');
          setTimeout(() => $('#mistakes').classList.remove('bump'), 500);
        }
      }
    }
    save(); render();
    if (OPT.limit && S.mistakes >= MAX_MISTAKES) return gameOver();
    checkWin();
  }

  function erase() {
    if (!S || paused || selected < 0 || S.puzzle[selected]) return;
    if (!S.grid[selected] && !S.notes[selected]) return;
    pushHistory();
    S.grid[selected] = 0; S.notes[selected] = 0;
    save(); render();
  }

  function undo() {
    if (!history.length || paused) return;
    const h = history.pop();
    S.grid = h.grid; S.notes = h.notes;
    save(); render();
  }

  function autoNotes() {
    if (!S || paused) return;
    pushHistory();
    if (S.auto) {               // second press: clear all notes again
      for (let i = 0; i < 81; i++) S.notes[i] = 0;
      S.auto = false;
    } else {
      const cand = E.allCandidates(S.grid);
      for (let i = 0; i < 81; i++) if (!S.grid[i]) S.notes[i] = cand[i];
      S.auto = true;
    }
    buzz(8);
    save(); render();
  }

  function hint() {
    if (!S || paused) return;
    let i = selected;
    if (i < 0 || S.puzzle[i] || S.grid[i] === S.solution[i]) {
      const empty = [];
      for (let k = 0; k < 81; k++) if (!S.puzzle[k] && S.grid[k] !== S.solution[k]) empty.push(k);
      if (!empty.length) return;
      i = empty[Math.random() * empty.length | 0];
    }
    pushHistory();
    S.grid[i] = S.solution[i]; S.notes[i] = 0; S.hints++;
    for (const p of PEERS[i]) S.notes[p] &= ~(1 << S.solution[i]);
    selected = i;
    save(); render();
    cells[i].classList.add('flash');
    checkWin();
  }

  function gameOver() {
    stopTimer();
    buzz([80, 40, 80]);
    const snap = S;
    paused = true;                 // board stays visible, input locked, wrong cells stay red
    selected = -1; render();
    store.set('sudoku.game', null);
    const close = () => { $('#over').hidden = true; $('#pad').hidden = false; applyTools(); S = null; };
    $('#retryBtn').onclick = () => {
      close();
      S = { ...snap, grid: snap.puzzle.slice(), notes: new Array(81).fill(0), time: 0, hints: 0, mistakes: 0 };
      history = []; selected = -1; notesMode = false;
      enterGame();
    };
    $('#overNewBtn').onclick = () => { close(); snap.level === 'daily' ? show('home') : start(snap.level); };
    setTimeout(() => { $('#over').hidden = false; $('#tools').hidden = true; $('#pad').hidden = true; }, 500);
  }

  function checkWin() {
    for (let i = 0; i < 81; i++) if (S.grid[i] !== S.solution[i]) return;
    stopTimer();
    buzz([30, 40, 60]);
    const st = stats();
    const L = st.levels[S.level] || (st.levels[S.level] = { won: 0, best: null, total: 0 });
    L.won++; L.total += S.time;
    const isBest = L.best == null || S.time < L.best;
    if (isBest) L.best = S.time;
    if (S.level === 'daily' && S.dateKey) {
      const d = st.daily;
      if (!d.done[S.dateKey]) {
        d.streak = d.last === yesterdayKey() ? d.streak + 1 : 1;
        d.last = S.dateKey;
        d.done[S.dateKey] = S.time;
      }
    }
    saveStats(st);
    $('#winLevel').textContent = S.level === 'daily' ? `${t('daily')} ${prettyDate(S.dateKey)}` : LEVEL_NAME[S.level];
    $('#winTime').textContent = fmt(S.time);
    $('#winBest').hidden = !(isBest && L.won > 1);
    const lvl = S.level;
    S = null; save();
    $('#againBtn').textContent = lvl === 'daily' ? t('home') : t('again');
    $('#againBtn').onclick = () => lvl === 'daily' ? show('home') : start(lvl);
    setTimeout(() => show('win'), 350);
  }

  // ---------- Timer ----------
  function startTimer() {
    stopTimer();
    tick = setInterval(() => { if (!paused && S) { S.time++; $('#timer').textContent = fmt(S.time); if (S.time % 5 === 0) save(); } }, 1000);
  }
  function stopTimer() { clearInterval(tick); tick = null; }
  function setPaused(p) { paused = p; $('#pauseCover').hidden = !p; $('#pauseBtn').hidden = p; if (S) save(); }

  // ---------- Screens ----------
  function show(name) {
    hideOver();
    for (const k in screens) screens[k].hidden = k !== name;
    if (name === 'home') refreshHome();
  }

  function refreshHome() {
    const g = load();
    const st = stats();
    $('#continueBtn').hidden = !g;
    if (g) $('#continueMeta').textContent = `${LEVEL_NAME[g.level]} · ${fmt(g.time)}`;
    const map = { kid: 'bk', easy: 'be', medium: 'bm', hard: 'bh', expert: 'bx', extreme: 'bz' };
    for (const k in map) { const L = st.levels[k]; $('#' + map[k]).textContent = L && L.best != null ? fmt(L.best) : ''; }
    const tk = todayKey();
    $('#dailyDate').textContent = prettyDate(tk);
    const done = st.daily.done[tk];
    $('#dailyRight').textContent = done != null ? `${t('solvedTime')} · ${fmt(done)}` : (st.daily.streak > 0 && st.daily.last === yesterdayKey() ? `${st.daily.streak} ${t('streak')}` : '');
    $('#dailyBtn').classList.toggle('done', done != null);
  }

  function start(level, seed, dateKey) {
    const g = load();
    if (g) {
      const name = g.level === 'daily' ? `${t('daily')} ${prettyDate(g.dateKey)}` : LEVEL_NAME[g.level];
      $('#confirmText').textContent = t('confirmText', { name, time: fmt(g.time) });
      $('#confirmYes').onclick = () => { store.set('sudoku.game', null); show('home'); begin(level, seed, dateKey); };
      $('#confirmNo').onclick = () => resume();
      show('confirm');
      return;
    }
    begin(level, seed, dateKey);
  }

  async function begin(level, seed, dateKey) {
    $('#homeSub').textContent = t('making');
    document.body.classList.add('busy');
    const r = await makePuzzle(level === 'daily' ? 'medium' : level, seed);
    document.body.classList.remove('busy');
    $('#homeSub').textContent = t('pick');
    S = { level, puzzle: r.puzzle, solution: r.solution, grid: r.puzzle.slice(), notes: new Array(81).fill(0), time: 0, hints: 0, mistakes: 0, dateKey: dateKey || null };
    history = []; selected = -1; notesMode = false;
    enterGame();
  }

  function startDaily() {
    const tk = todayKey();
    const g = load();
    if (g && g.level === 'daily' && g.dateKey === tk) return resume();
    start('daily', keyToSeed(tk), tk);
  }

  function resume() {
    const g = load();
    if (!g) return;
    S = g; if (S.mistakes == null) S.mistakes = 0;
    history = []; selected = -1; notesMode = false;
    enterGame();
  }

  function enterGame() {
    $('#levelLabel').textContent = S.level === 'daily' ? `${t('daily')} ${prettyDate(S.dateKey)}` : LEVEL_NAME[S.level];
    $('#timer').textContent = fmt(S.time);
    setPaused(false);
    show('game');
    render();
    startTimer();
  }

  function restart() {
    if (!S) return;
    S.grid = S.puzzle.slice(); S.notes = new Array(81).fill(0); S.time = 0; S.hints = 0; S.mistakes = 0;
    history = []; selected = -1; notesMode = false;
    enterGame();
  }

  const OPT_IDS = [['optHighlight', 'highlight'], ['optMistakes', 'mistakes'], ['optLimit', 'limit'], ['optTimer', 'timer'], ['optUndo', 'undo'], ['optErase', 'erase'], ['optNotes', 'notes'], ['optAuto', 'auto'], ['optHint', 'hint']];
  const TOOL_IDS = { undo: 'undoBtn', erase: 'eraseBtn', notes: 'notesBtn', auto: 'autoBtn', hint: 'hintBtn' };

  function applyTools() {
    let n = 0;
    for (const k in TOOL_IDS) { const on = !!OPT[k]; $('#' + TOOL_IDS[k]).hidden = !on; if (on) n++; }
    $('#tools').hidden = n === 0;
    $('#tools').style.gridTemplateColumns = `repeat(${Math.max(n, 1)}, 1fr)`;
    if (!OPT.notes) notesMode = false;
  }

  function showSettings() {
    for (const [id, key] of OPT_IDS) $('#' + id).checked = !!OPT[key];
    $('#optLang').value = LANG;
    show('settings');
  }

  function goHome() { stopTimer(); if (S && !$('#over').hidden) { S = null; } if (S) save(); S = null; show('home'); }

  function showStats() {
    const st = stats();
    $('#streakNum').textContent = st.daily.last === todayKey() || st.daily.last === yesterdayKey() ? st.daily.streak : 0;
    const tb = $('#statsTable tbody'); tb.innerHTML = '';
    for (const k of ['daily', 'kid', 'easy', 'medium', 'hard', 'expert', 'extreme']) {
      const L = st.levels[k];
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${LEVEL_NAME[k]}</td><td>${L ? L.won : 0}</td><td>${L && L.best != null ? fmt(L.best) : '–'}</td><td>${L && L.won ? fmt(Math.round(L.total / L.won)) : '–'}</td>`;
      tb.appendChild(tr);
    }
    show('stats');
  }

  // ---------- Language ----------
  const sel = $('#optLang');
  for (const k in I18N) { const o = document.createElement('option'); o.value = k; o.textContent = I18N[k].name; sel.appendChild(o); }
  sel.addEventListener('change', () => { applyLang(sel.value); store.set('sudoku.lang', sel.value); });
  applyLang(store.get('sudoku.lang', (navigator.language || 'en').slice(0, 2)));

  // ---------- Theme ----------
  function applyTheme(t) {
    if (t === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
    store.set('sudoku.theme', t);
  }
  function toggleTheme() {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark' ||
      (!document.documentElement.getAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
    applyTheme(dark ? 'light' : 'dark');
  }
  applyTheme(store.get('sudoku.theme', 'system'));

  // ---------- Install (PWA) ----------
  let installEvt = null;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; $('#installBtn').hidden = false; });
  if (!standalone) $('#installBtn').hidden = false;
  $('#installBtn').addEventListener('click', async () => {
    if (installEvt) { installEvt.prompt(); await installEvt.userChoice; installEvt = null; $('#installBtn').hidden = true; }
    else show('install');
  });
  $('#installClose').addEventListener('click', () => show('home'));
  window.addEventListener('appinstalled', () => { $('#installBtn').hidden = true; });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

  // ---------- Wire up ----------
  buildBoard();
  document.querySelectorAll('.level').forEach(b => b.addEventListener('click', () => start(b.dataset.level)));
  $('#dailyBtn').addEventListener('click', startDaily);
  $('#continueBtn').addEventListener('click', resume);
  $('#backBtn').addEventListener('click', goHome);
  $('#homeBtn').addEventListener('click', () => show('home'));
  $('#statsBtn').addEventListener('click', showStats);
  $('#statsClose').addEventListener('click', () => show('home'));
  $('#pauseBtn').addEventListener('click', () => setPaused(true));
  $('#resumeBtn').addEventListener('click', () => setPaused(false));
  $('#restartBtn').addEventListener('click', restart);
  $('#settingsBtn').addEventListener('click', showSettings);
  $('#settingsClose').addEventListener('click', () => show('home'));
  for (const [id, key] of OPT_IDS)
    $('#' + id).addEventListener('change', e => { OPT[key] = e.target.checked; saveOpts(); applyTools(); });
  applyTools();
  if ('serviceWorker' in navigator) { let reloaded = false; navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; if (!S) location.reload(); } }); }
  $('#undoBtn').addEventListener('click', undo);
  $('#eraseBtn').addEventListener('click', erase);
  $('#notesBtn').addEventListener('click', () => { notesMode = !notesMode; render(); });
  $('#autoBtn').addEventListener('click', autoNotes);
  $('#hintBtn').addEventListener('click', hint);
  $('#themeBtn').addEventListener('click', toggleTheme);
  document.querySelectorAll('#pad button').forEach(b => b.addEventListener('pointerdown', e => { e.preventDefault(); input(+b.dataset.n); }));

  document.addEventListener('keydown', e => {
    if (screens.game.hidden) return;
    if (e.key >= '1' && e.key <= '9') input(+e.key);
    else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') erase();
    else if (e.key === 'n' || e.key === 'N') { notesMode = !notesMode; render(); }
    else if ((e.ctrlKey || e.metaKey) && e.key === 'z') undo();
    else if (e.key.startsWith('Arrow') && selected >= 0) {
      const r = selected / 9 | 0, c = selected % 9;
      const m = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
      select(Math.max(0, Math.min(8, r + m[0])) * 9 + Math.max(0, Math.min(8, c + m[1]))); e.preventDefault();
    } else if (e.key === 'Escape') select(-1);
  });

  document.addEventListener('visibilitychange', () => { if (document.hidden && S && !screens.game.hidden) setPaused(true); });
  window.addEventListener('pagehide', () => { if (S) save(); });

  // no pinch zoom, no double-tap zoom, no rubber-band bounce
  document.addEventListener('gesturestart', e => e.preventDefault(), { passive: false });
  document.addEventListener('gesturechange', e => e.preventDefault(), { passive: false });
  document.addEventListener('touchmove', e => { if (e.scale && e.scale !== 1) e.preventDefault(); }, { passive: false });
  let lastTouch = 0;
  document.addEventListener('touchend', e => { const now = Date.now(); if (now - lastTouch < 300) e.preventDefault(); lastTouch = now; }, { passive: false });
  document.addEventListener('dblclick', e => e.preventDefault());

  show('home');
})();
