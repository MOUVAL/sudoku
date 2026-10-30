importScripts('engine.js');
self.onmessage = e => {
  const { id, level, seed } = e.data;
  const t0 = Date.now();
  const res = self.SudokuEngine.generate(level, seed);
  self.postMessage({ id, ...res, ms: Date.now() - t0 });
};
