// Runs at most `max` async tasks at once; the rest wait their turn. Returns limit(fn) -> promise
// of fn's result — used by POS so a burst of scans doesn't fire dozens of lookups together.
export function createLimiter(max) {
  let active = 0;
  const waiting = [];

  function next() {
    if (active >= max || !waiting.length) return;
    active++;
    const { fn, resolve, reject } = waiting.shift();
    Promise.resolve()
      .then(fn)
      .then(resolve, reject)
      .finally(() => {
        active--;
        next();
      });
  }

  return (fn) => new Promise((resolve, reject) => {
    waiting.push({ fn, resolve, reject });
    next();
  });
}
