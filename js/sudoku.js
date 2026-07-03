/* Sudoku generation & solving.
   Boards are flat arrays of 81 ints, 0 = empty. */
const Sudoku = (() => {
  const N = 81;

  const rowOf = (i) => Math.floor(i / 9);
  const colOf = (i) => i % 9;
  const boxOf = (i) => Math.floor(rowOf(i) / 3) * 3 + Math.floor(colOf(i) / 3);

  // Precompute peer indices per cell (same row/col/box).
  const PEERS = [];
  for (let i = 0; i < N; i++) {
    const s = new Set();
    for (let j = 0; j < N; j++) {
      if (j === i) continue;
      if (rowOf(j) === rowOf(i) || colOf(j) === colOf(i) || boxOf(j) === boxOf(i)) s.add(j);
    }
    PEERS.push([...s]);
  }

  function candidates(board, i) {
    if (board[i] !== 0) return [];
    const used = new Set();
    for (const p of PEERS[i]) if (board[p] !== 0) used.add(board[p]);
    const out = [];
    for (let v = 1; v <= 9; v++) if (!used.has(v)) out.push(v);
    return out;
  }

  // Backtracking fill of an empty board with seeded ordering.
  function fillBoard(board, rng) {
    let best = -1, bestCands = null;
    for (let i = 0; i < N; i++) {
      if (board[i] !== 0) continue;
      const c = candidates(board, i);
      if (c.length === 0) return false;
      if (bestCands === null || c.length < bestCands.length) { best = i; bestCands = c; }
      if (bestCands.length === 1) break;
    }
    if (best === -1) return true; // full
    for (const v of rng.shuffle(bestCands)) {
      board[best] = v;
      if (fillBoard(board, rng)) return true;
      board[best] = 0;
    }
    return false;
  }

  // Count solutions up to `limit` (used for uniqueness check).
  function countSolutions(board, limit = 2) {
    let count = 0;
    function rec(b) {
      if (count >= limit) return;
      let best = -1, bestCands = null;
      for (let i = 0; i < N; i++) {
        if (b[i] !== 0) continue;
        const c = candidates(b, i);
        if (c.length === 0) return;
        if (bestCands === null || c.length < bestCands.length) { best = i; bestCands = c; }
        if (bestCands.length === 1) break;
      }
      if (best === -1) { count++; return; }
      for (const v of bestCands) {
        b[best] = v;
        rec(b);
        b[best] = 0;
        if (count >= limit) return;
      }
    }
    rec(board.slice());
    return count;
  }

  const DIFFICULTY_TARGETS = {
    easy:   { clues: 40 },
    medium: { clues: 32 },
    hard:   { clues: 27 },
    expert: { clues: 24 },
  };

  /* Generate { puzzle, solution } deterministically from a seed string. */
  function generate(seedStr, difficulty = 'medium') {
    const rng = RNG.fromSeed(seedStr + ':' + difficulty);
    const solution = new Array(N).fill(0);
    fillBoard(solution, rng);

    const target = DIFFICULTY_TARGETS[difficulty] || DIFFICULTY_TARGETS.medium;
    const puzzle = solution.slice();
    let clues = N;

    // Remove cells in seeded random order, keeping the solution unique.
    const order = rng.shuffle([...Array(N).keys()]);
    for (const i of order) {
      if (clues <= target.clues) break;
      const saved = puzzle[i];
      puzzle[i] = 0;
      if (countSolutions(puzzle, 2) !== 1) {
        puzzle[i] = saved; // removal broke uniqueness — restore
      } else {
        clues--;
      }
    }

    return { puzzle, solution, difficulty, seed: seedStr, clues };
  }

  return { generate, candidates, PEERS, rowOf, colOf, boxOf };
})();
