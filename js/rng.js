/* Seeded RNG: xmur3 string hash + mulberry32 PRNG.
   Deterministic across browsers — required so the daily puzzle
   is identical for every player worldwide. */
const RNG = (() => {
  function xmur3(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return () => {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      return (h ^= h >>> 16) >>> 0;
    };
  }

  function mulberry32(a) {
    return () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function fromSeed(seedStr) {
    const seed = xmur3(String(seedStr))();
    const rand = mulberry32(seed);
    return {
      next: rand,
      int: (max) => Math.floor(rand() * max),          // [0, max)
      shuffle(arr) {
        const a = arr.slice();
        for (let i = a.length - 1; i > 0; i--) {
          const j = Math.floor(rand() * (i + 1));
          [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
      },
      pick: (arr) => arr[Math.floor(rand() * arr.length)],
    };
  }

  return { fromSeed };
})();
