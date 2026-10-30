/* Sudoku — vanilla JS, no dependencies */
(() => {
  'use strict';

  // ---------- Generator / solver ----------
  const CLUES = { kid: 48, easy: 38, hard: 28 };
  const LEVEL_NAME = { kid: 'Kid', easy: 'Easy', hard: 'Hard' };

  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };

  const peersOf = (() => {
    const p = [];
    for (let i = 0; i < 81; i++) {
      const r = i / 9 | 0, c = i % 9, br = r - r % 3, bc = c - c % 3, s = new Set();
      for (let k = 0; k < 9; k++) { s.add(r * 9 + k); s.add(k * 9 + c); s.add((br + (k / 3 | 0)) * 9 + bc + k % 3); }
      s.delete(i); p.push([...s]);
    }
    return p;
  })();

  function candidates(g, i) {
    const used = new Set();
    for (const p of peersOf[i]) if (g[p]) used.add(g[p]);
    const out = [];
    for (let n = 1; n <= 9; n++) if (!used.has(n)) out.push(n);
    return out;
  }

  function fill(g) {
    let best = -1, bestC = null;
    for (let i = 0; i < 81; i++) {
      if (g[i]) continue;
      const c = candidates(g, i);
      if (c.length === 0) return false;
      if (!bestC || c.length < bestC.length) { best = i; bestC = c; if (c.length === 1) break; }
    }
    if (best === -1) return true;
    for (const n of shuffle(bestC)) { g[best] = n; if (fill(g)) return true; }
    g[best] = 0;
    return false;
  }

  function countSolutions(g, limit) {
    let count = 0;
    const rec = () => {
      let best = -1, bestC = null;
      for (let i = 0; i < 81; i++) {
        if (g[i]) continue;
        const c = candidates(g, i);
        if (c.length === 0) return;
        if (!bestC || c.length < bestC.length) { best = i; bestC = c; if (c.length === 1) break; }
      }
      if (best === -1) { count++; return; }
      for (const n of bestC) { g[best] = n; rec(); if (count >= limit) { g[best] = 0; return; } }
      g[best] = 0;
    };
    rec();
    return count;
  }

  function generate(level) {
    const solution = new Array(81).fill(0);
    fill(solution);
    const puzzle = solution.slice();
    const target = CLUES[level];
    let clues = 81;
    const order = shuffle([...Array(81).keys()]);
    for (const i of order) {
      if (clues <= target) break;
      const keep = puzzle[i];
      puzzle[i] = 0;
      if (countSolutions(puzzle.slice(), 2) !== 1) puzzle[i] = keep; else clues--;
    }
    return { puzzle, solution };
  }

  // ---------- State ----------
  const $ = s => document.querySelector(s);
  const screens = { home: $('#home'), game: $('#game'), win: $('#win') };
  const boardEl = $('#board');
  const cells = [];

  let S = null;         // current game state
  let selected = -1;
  let notesMode = false;
  let tick = null;
  let history = [];
  let paused = false;

  const save = () => { try { S ? localStorage.setItem('sudoku.game', JSON.stringify(S)) : localStorage.removeItem('sudoku.game'); } catch {} };
  const load = () => { try { return JSON.parse(localStorage.getItem('sudoku.game')); } catch { return null; } };
  const stats = () => { try { return JSON.parse(localStorage.getItem('sudoku.stats')) || { won: 0, best: {} }; } catch { return { won: 0, best: {} }; } };
  const saveStats = st => { try { localStorage.setItem('sudoku.stats', JSON.stringify(st)); } catch {} };

  const fmt = s => `${s / 60 | 0}:${String(s % 60).padStart(2, '0')}`;

  // ---------- Board ----------
  function buildBoard() {
    boardEl.innerHTML = '';
    for (let i = 0; i < 81; i++) {
      const d = document.createElement('div');
      d.className = 'cell';
      d.setAttribute('role', 'gridcell');
      const c = i % 9, r = i / 9 | 0;
      if (c === 2 || c === 5) d.classList.add('br');
      if (r === 2 || r === 5) d.classList.add('bb');
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
      el.className = 'cell' + (i % 9 === 2 || i % 9 === 5 ? ' br' : '') + ((i / 9 | 0) === 2 || (i / 9 | 0) === 5 ? ' bb' : '');
      if (given) el.classList.add('given'); else if (v) el.classList.add('user');
      if (v && !given && v !== S.solution[i]) el.classList.add('wrong');
      if (i === selected) el.classList.add('sel');
      else if (selected >= 0 && peersOf[selected].includes(i)) el.classList.add('peer');
      if (selVal && v === selVal && i !== selected) el.classList.add('same');
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
    $('#notesState').textContent = notesMode ? 'on' : 'off';
  }

  function select(i) {
    if (paused) return;
    selected = i;
    render();
  }

  function pushHistory() { history.push({ grid: S.grid.slice(), notes: S.notes.slice() }); if (history.length > 200) history.shift(); }

  const buzz = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch {} };

  function input(n) {
    if (!S || paused || selected < 0 || S.puzzle[selected]) return;
    buzz(8);
    pushHistory();
    if (notesMode) {
      if (S.grid[selected]) S.grid[selected] = 0;
      S.notes[selected] ^= (1 << n);
    } else {
      S.grid[selected] = S.grid[selected] === n ? 0 : n;
      S.notes[selected] = 0;
      if (S.grid[selected]) {
        cells[selected].classList.add('pop');
        // clear this number from notes in peers
        for (const p of peersOf[selected]) S.notes[p] &= ~(1 << n);
      }
    }
    save(); render(); checkWin();
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
    for (const p of peersOf[i]) S.notes[p] &= ~(1 << S.solution[i]);
    selected = i;
    save(); render();
    cells[i].classList.add('flash');
    checkWin();
  }

  function checkWin() {
    for (let i = 0; i < 81; i++) if (S.grid[i] !== S.solution[i]) return;
    stopTimer();
    buzz([30, 40, 60]);
    const st = stats();
    st.won++;
    const prev = st.best[S.level];
    const isBest = !prev || S.time < prev;
    if (isBest) st.best[S.level] = S.time;
    saveStats(st);
    $('#winLevel').textContent = LEVEL_NAME[S.level];
    $('#winTime').textContent = fmt(S.time);
    $('#winBest').hidden = !isBest;
    const lvl = S.level;
    S = null; save();
    $('#againBtn').onclick = () => start(lvl);
    setTimeout(() => show('win'), 350);
  }

  // ---------- Timer ----------
  function startTimer() {
    stopTimer();
    tick = setInterval(() => { if (!paused && S) { S.time++; $('#timer').textContent = fmt(S.time); if (S.time % 5 === 0) save(); } }, 1000);
  }
  function stopTimer() { clearInterval(tick); tick = null; }

  function setPaused(p) {
    paused = p;
    $('#pauseCover').hidden = !p;
    $('#pauseBtn').hidden = p;
    if (S) save();
  }

  // ---------- Screens ----------
  function show(name) {
    for (const k in screens) screens[k].hidden = k !== name;
    if (name === 'home') refreshHome();
  }

  function refreshHome() {
    const g = load();
    const st = stats();
    $('#continueBtn').hidden = !g;
    if (g) $('#continueMeta').textContent = `${LEVEL_NAME[g.level]} · ${fmt(g.time)}`;
    $('#statWon').textContent = st.won;
    const bests = Object.values(st.best);
    $('#statBest').textContent = bests.length ? fmt(Math.min(...bests)) : '–';
  }

  function start(level) {
    $('#homeSub').textContent = 'Making your puzzle…';
    requestAnimationFrame(() => setTimeout(() => {
      const { puzzle, solution } = generate(level);
      S = { level, puzzle, solution, grid: puzzle.slice(), notes: new Array(81).fill(0), time: 0, hints: 0 };
      history = []; selected = -1; notesMode = false;
      enterGame();
      $('#homeSub').textContent = 'Pick a level';
    }, 20));
  }

  function resume() {
    const g = load();
    if (!g) return;
    S = g; history = []; selected = -1; notesMode = false;
    enterGame();
  }

  function enterGame() {
    $('#levelLabel').textContent = LEVEL_NAME[S.level];
    $('#timer').textContent = fmt(S.time);
    setPaused(false);
    show('game');
    render();
    startTimer();
  }

  function goHome() {
    stopTimer();
    if (S) save();
    S = null;
    show('home');
  }

  // ---------- Theme ----------
  const themeOrder = ['system', 'light', 'dark'];
  function applyTheme(t) {
    if (t === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('sudoku.theme', t); } catch {}
  }
  function cycleTheme() {
    const cur = localStorage.getItem('sudoku.theme') || 'system';
    const dark = document.documentElement.getAttribute('data-theme') === 'dark' ||
      (!document.documentElement.getAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
    applyTheme(dark ? 'light' : 'dark');
    void cur; void themeOrder;
  }
  applyTheme(localStorage.getItem('sudoku.theme') || 'system');

  // ---------- Install (PWA) ----------
  let installEvt = null;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; $('#installBtn').hidden = false; });
  if (isIOS && !standalone) $('#installBtn').hidden = false;
  $('#installBtn').addEventListener('click', async () => {
    if (installEvt) { installEvt.prompt(); await installEvt.userChoice; installEvt = null; $('#installBtn').hidden = true; }
    else if (isIOS) $('#iosHint').hidden = false;
  });
  $('#iosHintClose').addEventListener('click', () => { $('#iosHint').hidden = true; });
  window.addEventListener('appinstalled', () => { $('#installBtn').hidden = true; });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

  // ---------- Wire up ----------
  buildBoard();
  document.querySelectorAll('.level').forEach(b => b.addEventListener('click', () => start(b.dataset.level)));
  $('#continueBtn').addEventListener('click', resume);
  $('#backBtn').addEventListener('click', goHome);
  $('#homeBtn').addEventListener('click', () => show('home'));
  $('#pauseBtn').addEventListener('click', () => setPaused(true));
  $('#resumeBtn').addEventListener('click', () => setPaused(false));
  $('#undoBtn').addEventListener('click', undo);
  $('#eraseBtn').addEventListener('click', erase);
  $('#notesBtn').addEventListener('click', () => { notesMode = !notesMode; render(); });
  $('#hintBtn').addEventListener('click', hint);
  $('#themeBtn').addEventListener('click', cycleTheme);
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
      const nr = Math.max(0, Math.min(8, r + m[0])), nc = Math.max(0, Math.min(8, c + m[1]));
      select(nr * 9 + nc); e.preventDefault();
    } else if (e.key === 'Escape') select(-1);
  });

  document.addEventListener('visibilitychange', () => { if (document.hidden && S && !screens.game.hidden) setPaused(true); });

  show('home');
})();
