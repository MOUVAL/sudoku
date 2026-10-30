/* Sudoku engine: generator + human-technique grader. No DOM. Works in a Worker and on the page. */
(function (root) {
  'use strict';

  // ---------- seeded random (mulberry32) ----------
  function makeRng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const shuffle = (a, rnd) => { for (let i = a.length - 1; i > 0; i--) { const j = rnd() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };

  // ---------- geometry ----------
  const ROWS = [], COLS = [], BOXES = [], UNITS = [], PEERS = [];
  for (let u = 0; u < 9; u++) {
    ROWS.push([]); COLS.push([]); BOXES.push([]);
    for (let k = 0; k < 9; k++) {
      ROWS[u].push(u * 9 + k);
      COLS[u].push(k * 9 + u);
      BOXES[u].push(((u / 3 | 0) * 3 + (k / 3 | 0)) * 9 + (u % 3) * 3 + k % 3);
    }
  }
  const ALL_UNITS = [...ROWS, ...COLS, ...BOXES];
  for (let i = 0; i < 81; i++) {
    const r = i / 9 | 0, c = i % 9, b = (r / 3 | 0) * 3 + (c / 3 | 0);
    UNITS.push([ROWS[r], COLS[c], BOXES[b]]);
    const s = new Set([...ROWS[r], ...COLS[c], ...BOXES[b]]); s.delete(i);
    PEERS.push([...s]);
  }

  function candidates(g, i) {
    let mask = 0x3FE; // bits 1..9
    for (const p of PEERS[i]) if (g[p]) mask &= ~(1 << g[p]);
    return mask;
  }
  const bits = m => { const o = []; for (let n = 1; n <= 9; n++) if (m & (1 << n)) o.push(n); return o; };
  const popcount = m => { let c = 0; while (m) { m &= m - 1; c++; } return c; };

  // ---------- backtracking ----------
  function fill(g, rnd) {
    let best = -1, bestM = 0, bestC = 10;
    for (let i = 0; i < 81; i++) {
      if (g[i]) continue;
      const m = candidates(g, i), c = popcount(m);
      if (c === 0) return false;
      if (c < bestC) { best = i; bestM = m; bestC = c; if (c === 1) break; }
    }
    if (best === -1) return true;
    for (const n of shuffle(bits(bestM), rnd)) { g[best] = n; if (fill(g, rnd)) return true; }
    g[best] = 0;
    return false;
  }

  function countSolutions(g, limit) {
    let count = 0;
    const rec = () => {
      let best = -1, bestM = 0, bestC = 10;
      for (let i = 0; i < 81; i++) {
        if (g[i]) continue;
        const m = candidates(g, i), c = popcount(m);
        if (c === 0) return;
        if (c < bestC) { best = i; bestM = m; bestC = c; if (c === 1) break; }
      }
      if (best === -1) { count++; return; }
      for (const n of bits(bestM)) { g[best] = n; rec(); if (count >= limit) { g[best] = 0; return; } }
      g[best] = 0;
    };
    rec();
    return count;
  }

  // ---------- human-technique grader ----------
  // Returns the hardest technique level needed: 1 singles, 2 pairs/pointing, 3 hidden pairs/triples/x-wing, 4 beyond.
  function grade(puzzle) {
    const g = puzzle.slice();
    const C = new Array(81).fill(0);
    for (let i = 0; i < 81; i++) if (!g[i]) C[i] = candidates(g, i);
    let maxLevel = 1;
    const place = (i, n) => { g[i] = n; C[i] = 0; for (const p of PEERS[i]) C[p] &= ~(1 << n); };

    const nakedSingle = () => { for (let i = 0; i < 81; i++) if (!g[i] && popcount(C[i]) === 1) { place(i, bits(C[i])[0]); return true; } return false; };
    const hiddenSingle = () => {
      for (const u of ALL_UNITS) for (let n = 1; n <= 9; n++) {
        let where = -1, cnt = 0;
        for (const i of u) if (!g[i] && (C[i] & (1 << n))) { cnt++; where = i; }
        if (cnt === 1) { place(where, n); return true; }
      }
      return false;
    };
    const nakedPair = () => {
      for (const u of ALL_UNITS) {
        const cells = u.filter(i => !g[i] && popcount(C[i]) === 2);
        for (let a = 0; a < cells.length; a++) for (let b = a + 1; b < cells.length; b++) {
          if (C[cells[a]] !== C[cells[b]]) continue;
          const m = C[cells[a]]; let changed = false;
          for (const i of u) if (!g[i] && i !== cells[a] && i !== cells[b] && (C[i] & m)) { C[i] &= ~m; changed = true; }
          if (changed) return true;
        }
      }
      return false;
    };
    const pointing = () => { // candidates of n in a box confined to one row/col -> remove from rest of that line; and line->box
      for (let n = 1; n <= 9; n++) {
        for (const box of BOXES) {
          const cells = box.filter(i => !g[i] && (C[i] & (1 << n)));
          if (cells.length < 2 || cells.length > 3) continue;
          const rows = new Set(cells.map(i => i / 9 | 0)), cols = new Set(cells.map(i => i % 9));
          const line = rows.size === 1 ? ROWS[[...rows][0]] : cols.size === 1 ? COLS[[...cols][0]] : null;
          if (!line) continue;
          let changed = false;
          for (const i of line) if (!g[i] && !box.includes(i) && (C[i] & (1 << n))) { C[i] &= ~(1 << n); changed = true; }
          if (changed) return true;
        }
        for (const line of [...ROWS, ...COLS]) {
          const cells = line.filter(i => !g[i] && (C[i] & (1 << n)));
          if (cells.length < 2 || cells.length > 3) continue;
          const boxes = new Set(cells.map(i => ((i / 9 | 0) / 3 | 0) * 3 + ((i % 9) / 3 | 0)));
          if (boxes.size !== 1) continue;
          const box = BOXES[[...boxes][0]];
          let changed = false;
          for (const i of box) if (!g[i] && !line.includes(i) && (C[i] & (1 << n))) { C[i] &= ~(1 << n); changed = true; }
          if (changed) return true;
        }
      }
      return false;
    };
    const hiddenPair = () => {
      for (const u of ALL_UNITS) {
        const pos = [];
        for (let n = 1; n <= 9; n++) pos[n] = u.filter(i => !g[i] && (C[i] & (1 << n)));
        for (let a = 1; a <= 9; a++) for (let b = a + 1; b <= 9; b++) {
          if (pos[a].length !== 2 || pos[b].length !== 2 || pos[a][0] !== pos[b][0] || pos[a][1] !== pos[b][1]) continue;
          const m = (1 << a) | (1 << b); let changed = false;
          for (const i of pos[a]) if (C[i] & ~m) { C[i] &= m; changed = true; }
          if (changed) return true;
        }
      }
      return false;
    };
    const nakedTriple = () => {
      for (const u of ALL_UNITS) {
        const cells = u.filter(i => !g[i] && popcount(C[i]) <= 3 && popcount(C[i]) >= 2);
        for (let a = 0; a < cells.length; a++) for (let b = a + 1; b < cells.length; b++) for (let c = b + 1; c < cells.length; c++) {
          const m = C[cells[a]] | C[cells[b]] | C[cells[c]];
          if (popcount(m) !== 3) continue;
          let changed = false;
          for (const i of u) if (!g[i] && i !== cells[a] && i !== cells[b] && i !== cells[c] && (C[i] & m)) { C[i] &= ~m; changed = true; }
          if (changed) return true;
        }
      }
      return false;
    };
    const xWing = () => {
      for (let n = 1; n <= 9; n++) {
        for (const [lines, cross, idx] of [[ROWS, COLS, i => i % 9], [COLS, ROWS, i => i / 9 | 0]]) {
          const sets = lines.map(l => l.filter(i => !g[i] && (C[i] & (1 << n))).map(idx)).map(a => a.length === 2 ? a : null);
          for (let a = 0; a < 9; a++) for (let b = a + 1; b < 9; b++) {
            if (!sets[a] || !sets[b] || sets[a][0] !== sets[b][0] || sets[a][1] !== sets[b][1]) continue;
            let changed = false;
            for (const k of sets[a]) for (const i of cross[k]) {
              if (!g[i] && !lines[a].includes(i) && !lines[b].includes(i) && (C[i] & (1 << n))) { C[i] &= ~(1 << n); changed = true; }
            }
            if (changed) return true;
          }
        }
      }
      return false;
    };

    const steps = [[1, nakedSingle], [1, hiddenSingle], [2, nakedPair], [2, pointing], [3, hiddenPair], [3, nakedTriple], [3, xWing]];
    for (;;) {
      if (g.every(v => v)) return maxLevel;
      let progressed = false;
      for (const [lvl, fn] of steps) {
        if (fn()) { if (lvl > maxLevel) maxLevel = lvl; progressed = true; break; }
      }
      if (!progressed) return 4;
    }
  }

  // ---------- puzzle generation ----------
  const LEVELS = {
    kid:     { clues: 46, want: l => l === 1 },
    easy:    { clues: 38, want: l => l === 1 },
    medium:  { clues: 32, want: l => l === 2 },
    hard:    { clues: 28, want: l => l === 3 },
    expert:  { clues: 26, want: l => l === 4 },
    extreme: { clues: 22, want: (l, c) => l === 4 && c <= 25 }
  };

  function carve(solution, target, rnd) {
    const puzzle = solution.slice();
    let clues = 81;
    for (const i of shuffle([...Array(81).keys()], rnd)) {
      if (clues <= target) break;
      const keep = puzzle[i];
      puzzle[i] = 0;
      if (countSolutions(puzzle.slice(), 2) !== 1) puzzle[i] = keep; else clues--;
    }
    return { puzzle, clues };
  }

  function generate(level, seed) {
    const spec = LEVELS[level] || LEVELS.easy;
    const rnd = makeRng(seed == null ? (Math.random() * 2 ** 32) >>> 0 : seed);
    let fallback = null;
    for (let attempt = 0; attempt < 400; attempt++) {
      const solution = new Array(81).fill(0);
      fill(solution, rnd);
      const { puzzle, clues } = carve(solution, spec.clues, rnd);
      const lvl = grade(puzzle);
      const out = { puzzle, solution, clues, level, grade: lvl };
      if (spec.want(lvl, clues)) return out;
      // keep the closest miss as a fallback
      const dist = Math.abs(lvl - (level === 'kid' || level === 'easy' ? 1 : level === 'medium' ? 2 : level === 'hard' ? 3 : 4));
      if (!fallback || dist < fallback.dist) fallback = { ...out, dist };
    }
    return fallback;
  }

  function allCandidates(grid) {
    const out = new Array(81).fill(0);
    for (let i = 0; i < 81; i++) if (!grid[i]) out[i] = candidates(grid, i);
    return out;
  }

  root.SudokuEngine = { generate, grade, countSolutions, allCandidates, PEERS, LEVELS };
})(typeof self !== 'undefined' ? self : globalThis);
