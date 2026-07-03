/* Game controller: board rendering, input, hearts, points, powers,
   timer, pen notes, celebrations, win/lose. */
const Game = (() => {
  const POINTS = { place: 10, comboStep: 2, comboCap: 20, line: 40, box: 60, digit: 30 };
  const DIFF_BONUS = { easy: 0, medium: 250, hard: 500, expert: 800 };
  const MAX_HEARTS = 3;

  const S = {
    puzzle: null, solution: null, board: null,
    notes: null,               // array of 81 Sets
    given: null,               // bool[81]
    mode: 'single',            // 'single' | 'daily' | 'multi'
    difficulty: 'medium',
    seed: '',
    hearts: MAX_HEARTS,
    score: 0,
    combo: 0,
    activeDigit: 0,            // number-first selection, 0 = none
    selectedCell: -1,
    penMode: false,
    eraseMode: false,
    timer: 0, timerId: null, frozen: 0,
    paused: false, over: false,
    shield: false,
    powers: [], powersUsed: {},
    doneRows: new Set(), doneCols: new Set(), doneBoxes: new Set(), doneDigits: new Set(),
    onEvent: null,             // multiplayer hook: (type, payload) => {}
  };

  const $ = (id) => document.getElementById(id);
  const boardEl = () => $('board');

  /* ---------- setup ---------- */
  function newGame({ seed, difficulty, mode }) {
    const gen = Sudoku.generate(seed, difficulty);
    Object.assign(S, {
      puzzle: gen.puzzle.slice(), solution: gen.solution, board: gen.puzzle.slice(),
      notes: Array.from({ length: 81 }, () => new Set()),
      given: gen.puzzle.map(v => v !== 0),
      mode, difficulty, seed,
      hearts: MAX_HEARTS, score: 0, combo: 0,
      activeDigit: 0, selectedCell: -1,
      penMode: false, eraseMode: false,
      timer: 0, frozen: 0, paused: false, over: false, shield: false,
      powers: drawPowers(seed), powersUsed: {},
      doneRows: new Set(), doneCols: new Set(), doneBoxes: new Set(), doneDigits: new Set(),
    });
    // pre-mark units already complete in the puzzle (rare, but keeps events honest)
    scanCompletedUnits(true);
    renderAll();
    startTimer();
    GameAudio.startMusic();
  }

  /* Load a state received from a multiplayer host. */
  function loadState(st) {
    Object.assign(S, {
      puzzle: st.puzzle.slice(), solution: st.solution.slice(), board: st.board.slice(),
      notes: st.notes.map(a => new Set(a)),
      given: st.puzzle.map(v => v !== 0),
      mode: 'multi', difficulty: st.difficulty, seed: st.seed,
      hearts: st.hearts, score: st.score, combo: 0,
      activeDigit: 0, selectedCell: -1,
      penMode: false, eraseMode: false,
      timer: st.timer, frozen: 0, paused: false, over: false, shield: st.shield,
      powers: drawPowers(st.seed), powersUsed: st.powersUsed || {},
      doneRows: new Set(), doneCols: new Set(), doneBoxes: new Set(), doneDigits: new Set(),
    });
    scanCompletedUnits(true);
    renderAll();
    startTimer();
    GameAudio.startMusic();
  }

  function snapshot() {
    return {
      puzzle: S.puzzle, solution: S.solution, board: S.board,
      notes: S.notes.map(s => [...s]),
      difficulty: S.difficulty, seed: S.seed,
      hearts: S.hearts, score: S.score, timer: S.timer,
      shield: S.shield, powersUsed: S.powersUsed,
    };
  }

  /* ---------- rendering ---------- */
  function renderAll() {
    buildBoardDOM();
    buildNumpad();
    buildPowers();
    renderHearts();
    renderScore();
    renderTimer();
    $('game-mode-label').textContent =
      S.mode === 'daily' ? `Daily · ${cap(S.difficulty)}` :
      S.mode === 'multi' ? `Co-op · ${cap(S.difficulty)}` : cap(S.difficulty);
    $('btn-pen').setAttribute('aria-pressed', 'false');
    $('numpad').classList.remove('pen-mode');
    $('board-overlay').hidden = true;
  }

  function cap(s) { return s[0].toUpperCase() + s.slice(1); }

  function buildBoardDOM() {
    const b = boardEl();
    b.innerHTML = '';
    for (let i = 0; i < 81; i++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.i = i;
      cell.setAttribute('role', 'gridcell');
      const c = i % 9, r = Math.floor(i / 9);
      if (c === 2 || c === 5) cell.classList.add('bx-r');
      if (r === 2 || r === 5) cell.classList.add('bx-b');
      cell.addEventListener('pointerdown', () => onCellTap(i));
      b.appendChild(cell);
    }
    refreshCells();
  }

  function refreshCells() {
    const cells = boardEl().children;
    for (let i = 0; i < 81; i++) {
      const el = cells[i];
      const v = S.board[i];
      el.classList.toggle('given', S.given[i]);
      el.classList.toggle('user', !S.given[i] && v !== 0);
      // value or notes
      if (v !== 0) {
        el.textContent = v;
      } else if (S.notes[i].size) {
        el.textContent = '';
        const wrap = document.createElement('div');
        wrap.className = 'notes';
        for (let n = 1; n <= 9; n++) {
          const sp = document.createElement('span');
          if (S.notes[i].has(n)) {
            sp.textContent = n;
            if (S.activeDigit === n) sp.classList.add('hl');
          }
          wrap.appendChild(sp);
        }
        el.appendChild(wrap);
      } else {
        el.textContent = '';
      }
    }
    refreshHighlights();
  }

  function refreshHighlights() {
    const cells = boardEl().children;
    const sel = S.selectedCell;
    for (let i = 0; i < 81; i++) {
      const el = cells[i];
      el.classList.remove('selected', 'same-num', 'peer');
      if (sel >= 0) {
        if (i === sel) el.classList.add('selected');
        else if (Sudoku.rowOf(i) === Sudoku.rowOf(sel) || Sudoku.colOf(i) === Sudoku.colOf(sel) || Sudoku.boxOf(i) === Sudoku.boxOf(sel))
          el.classList.add('peer');
      }
      if (S.activeDigit && S.board[i] === S.activeDigit) el.classList.add('same-num');
    }
  }

  function buildNumpad() {
    const pad = $('numpad');
    pad.innerHTML = '';
    for (let n = 1; n <= 9; n++) {
      const btn = document.createElement('button');
      btn.className = 'num-btn';
      btn.dataset.n = n;
      btn.innerHTML = `<span class="n-digit">${n}</span><span class="n-count"></span>`;
      btn.addEventListener('click', () => onNumTap(n));
      pad.appendChild(btn);
    }
    refreshNumpad();
  }

  function countsLeft() {
    const used = new Array(10).fill(0);
    for (const v of S.board) if (v) used[v]++;
    const left = [];
    for (let n = 1; n <= 9; n++) left[n] = 9 - used[n];
    return left;
  }

  function refreshNumpad() {
    const left = countsLeft();
    const pad = $('numpad');
    for (const btn of pad.children) {
      const n = +btn.dataset.n;
      const remaining = left[n];
      btn.querySelector('.n-count').textContent = remaining;
      const exhausted = remaining <= 0;
      btn.disabled = exhausted && !S.penMode; // still selectable for notes cleanup? no — fully disable
      if (exhausted) btn.disabled = true;
      btn.classList.toggle('active', S.activeDigit === n && !exhausted);
      if (exhausted && S.activeDigit === n) S.activeDigit = 0;
    }
  }

  function buildPowers() {
    const row = $('powers-row');
    row.innerHTML = '';
    for (const p of S.powers) {
      const btn = document.createElement('button');
      btn.className = 'power-btn';
      btn.dataset.pid = p.id;
      btn.title = p.desc;
      btn.innerHTML = `<span class="p-ico">${p.icon}</span><span class="p-name">${p.name}</span><span class="p-cost">★ ${p.cost}</span>`;
      btn.addEventListener('click', () => usePower(p.id));
      row.appendChild(btn);
    }
    refreshPowers();
  }

  function refreshPowers() {
    for (const btn of $('powers-row').children) {
      const p = S.powers.find(x => x.id === btn.dataset.pid);
      const affordable = S.score >= p.cost;
      let blocked = false;
      if (p.id === 'secondwind' && S.hearts >= MAX_HEARTS) blocked = true;
      if (p.id === 'shield' && S.shield) blocked = true;
      btn.disabled = !affordable || blocked || S.over;
      btn.classList.toggle('affordable', affordable && !blocked);
      let badge = btn.querySelector('.p-active-badge');
      if (p.id === 'shield' && S.shield) {
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'p-active-badge';
          badge.textContent = 'ON';
          btn.appendChild(badge);
        }
      } else if (badge) badge.remove();
    }
  }

  function renderHearts() {
    const hearts = $('hearts').children;
    for (let i = 0; i < MAX_HEARTS; i++)
      hearts[i].classList.toggle('lost', i >= S.hearts);
  }

  function renderScore() {
    const el = $('score');
    el.textContent = S.score;
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
    const cc = $('combo-chip');
    $('combo').textContent = 1 + S.combo;
    cc.classList.toggle('on', S.combo >= 2);
    if (S.combo >= 2) { cc.classList.remove('on'); void cc.offsetWidth; cc.classList.add('on'); }
    refreshPowers();
  }

  /* ---------- timer ---------- */
  function startTimer() {
    stopTimer();
    S.timerId = setInterval(() => {
      if (S.paused || S.over) return;
      if (S.frozen > 0) { S.frozen--; if (S.frozen === 0) $('timer').classList.remove('frozen'); return; }
      S.timer++;
      renderTimer();
    }, 1000);
    renderTimer();
  }
  function stopTimer() { clearInterval(S.timerId); S.timerId = null; }
  function renderTimer() {
    const m = String(Math.floor(S.timer / 60)).padStart(2, '0');
    const s = String(S.timer % 60).padStart(2, '0');
    $('timer').textContent = `${m}:${s}`;
  }

  function setPaused(p) {
    if (S.over) return;
    S.paused = p;
    const ov = $('board-overlay');
    ov.hidden = !p;
    if (p) $('overlay-inner').innerHTML = '<span class="big">⏸</span>PAUSED<br><button class="btn btn-primary" style="margin-top:14px" onclick="Game.setPaused(false)">Resume</button>';
    GameAudio.play('click');
  }

  /* ---------- input ---------- */
  function onCellTap(i) {
    if (S.paused || S.over) return;
    GameAudio.unlock();
    const cellFilled = S.board[i] !== 0;

    if (S.eraseMode) {
      if (!S.given[i]) eraseCell(i, true);
      return;
    }

    if (cellFilled) {
      // select the cell + adopt its digit for highlighting
      S.selectedCell = i;
      setActiveDigit(S.board[i], false);
      GameAudio.play('select');
      refreshCells(); refreshNumpad();
      emit('cursor', { i });
      return;
    }

    // empty cell
    S.selectedCell = i;
    emit('cursor', { i });
    if (S.activeDigit) {
      if (S.penMode) toggleNote(i, S.activeDigit, true);
      else placeNumber(i, S.activeDigit, true);
    } else {
      GameAudio.play('select');
      refreshCells();
    }
  }

  function onNumTap(n) {
    if (S.paused || S.over) return;
    GameAudio.unlock();
    S.eraseMode = false;
    $('btn-erase').setAttribute('aria-pressed', 'false');
    // if a digit is already active and an empty cell is selected → place there
    if (S.selectedCell >= 0 && S.board[S.selectedCell] === 0) {
      setActiveDigit(n, false);
      if (S.penMode) toggleNote(S.selectedCell, n, true);
      else placeNumber(S.selectedCell, n, true);
      return;
    }
    // otherwise toggle number-first selection
    setActiveDigit(S.activeDigit === n ? 0 : n, true);
    GameAudio.play('select');
    refreshCells();
    refreshNumpad();
  }

  function setActiveDigit(n, exclusive) {
    S.activeDigit = n;
    if (exclusive) S.selectedCell = -1;
    refreshNumpad();
  }

  function togglePen() {
    S.penMode = !S.penMode;
    S.eraseMode = false;
    $('btn-pen').setAttribute('aria-pressed', String(S.penMode));
    $('btn-erase').setAttribute('aria-pressed', 'false');
    $('numpad').classList.toggle('pen-mode', S.penMode);
    GameAudio.play('click');
  }

  function toggleErase() {
    S.eraseMode = !S.eraseMode;
    if (S.eraseMode) { S.penMode = false; $('btn-pen').setAttribute('aria-pressed', 'false'); $('numpad').classList.remove('pen-mode'); }
    $('btn-erase').setAttribute('aria-pressed', String(S.eraseMode));
    GameAudio.play('click');
  }

  /* ---------- moves ---------- */
  function toggleNote(i, n, local) {
    if (S.board[i] !== 0 || S.given[i]) return;
    S.notes[i].has(n) ? S.notes[i].delete(n) : S.notes[i].add(n);
    if (local) { GameAudio.play('note'); emit('note', { i, n }); }
    refreshCells();
  }

  function eraseCell(i, local) {
    if (S.given[i]) return;
    if (S.board[i] === 0 && S.notes[i].size === 0) return;
    S.board[i] = 0;
    S.notes[i].clear();
    if (local) { GameAudio.play('erase'); emit('erase', { i }); }
    refreshCells(); refreshNumpad();
  }

  function placeNumber(i, n, local) {
    if (S.given[i] || S.board[i] !== 0 || S.over) return;
    const correct = S.solution[i] === n;
    const cellEl = boardEl().children[i];

    if (!correct) {
      if (local) {
        cellEl.classList.remove('wrong'); void cellEl.offsetWidth; cellEl.classList.add('wrong');
        FX.shake();
        GameAudio.play('wrong');
        S.combo = 0;
        renderScore();
        if (S.shield) {
          S.shield = false;
          FX.toast('🛡️ Shield absorbed the mistake!', 'event');
          refreshPowers();
          emit('shield', {});
        } else {
          loseHeart(true);
        }
      }
      return;
    }

    // correct placement
    S.board[i] = n;
    S.notes[i].clear();
    // strip this note from peers
    for (const p of Sudoku.PEERS[i]) S.notes[p].delete(n);

    cellEl.classList.remove('pop'); void cellEl.offsetWidth; cellEl.classList.add('pop');

    if (local) {
      GameAudio.play('place');
      S.combo++;
      const pts = POINTS.place + Math.min(POINTS.comboCap, (S.combo - 1) * POINTS.comboStep);
      addScore(pts, cellEl);
      emit('place', { i, n });
    }

    checkUnitCompletions(i, local);
    refreshCells();
    refreshNumpad();
    checkWin(local);
  }

  function addScore(pts, anchorEl) {
    S.score += pts;
    renderScore();
    if (anchorEl) {
      const r = anchorEl.getBoundingClientRect();
      FX.floatPoints(r.left + r.width / 2, r.top, `+${pts}`);
    }
    emit('score', { score: S.score });
  }

  /* ---------- events: line / box / digit completions ---------- */
  function unitCells(kind, idx) {
    const out = [];
    for (let i = 0; i < 81; i++) {
      if (kind === 'row' && Sudoku.rowOf(i) === idx) out.push(i);
      if (kind === 'col' && Sudoku.colOf(i) === idx) out.push(i);
      if (kind === 'box' && Sudoku.boxOf(i) === idx) out.push(i);
    }
    return out;
  }

  function unitDone(cells) { return cells.every(i => S.board[i] !== 0); }

  function scanCompletedUnits(silent) {
    for (let k = 0; k < 9; k++) {
      if (unitDone(unitCells('row', k))) S.doneRows.add(k);
      if (unitDone(unitCells('col', k))) S.doneCols.add(k);
      if (unitDone(unitCells('box', k))) S.doneBoxes.add(k);
    }
    const left = countsLeft();
    for (let n = 1; n <= 9; n++) if (left[n] === 0) S.doneDigits.add(n);
  }

  function celebrateCells(cells, delayStep = 40) {
    const els = boardEl().children;
    cells.forEach((i, k) => {
      setTimeout(() => {
        els[i].classList.remove('celebrate'); void els[i].offsetWidth; els[i].classList.add('celebrate');
      }, k * delayStep);
    });
  }

  function checkUnitCompletions(i, local) {
    const r = Sudoku.rowOf(i), c = Sudoku.colOf(i), b = Sudoku.boxOf(i), n = S.board[i];
    const events = [];

    if (!S.doneRows.has(r) && unitDone(unitCells('row', r))) { S.doneRows.add(r); events.push({ kind: 'line', cells: unitCells('row', r), label: 'ROW COMPLETE!', pts: POINTS.line, sfx: 'line' }); }
    if (!S.doneCols.has(c) && unitDone(unitCells('col', c))) { S.doneCols.add(c); events.push({ kind: 'line', cells: unitCells('col', c), label: 'COLUMN COMPLETE!', pts: POINTS.line, sfx: 'line' }); }
    if (!S.doneBoxes.has(b) && unitDone(unitCells('box', b))) { S.doneBoxes.add(b); events.push({ kind: 'box', cells: unitCells('box', b), label: 'BOX COMPLETE!', pts: POINTS.box, sfx: 'box' }); }
    const left = countsLeft();
    if (n && !S.doneDigits.has(n) && left[n] === 0) {
      S.doneDigits.add(n);
      events.push({ kind: 'digit', cells: S.board.map((v, idx) => v === n ? idx : -1).filter(x => x >= 0), label: `ALL ${n}s PLACED!`, pts: POINTS.digit, sfx: 'exhaust', numBtn: n });
    }

    events.forEach((ev, k) => {
      setTimeout(() => {
        celebrateCells(ev.cells);
        if (local) {
          GameAudio.play(ev.sfx);
          FX.toast(`${ev.label} +${ev.pts}`, 'event');
          addScore(ev.pts, null);
          const mid = boardEl().children[ev.cells[Math.floor(ev.cells.length / 2)]].getBoundingClientRect();
          FX.burst(mid.left + mid.width / 2, mid.top + mid.height / 2, ev.kind === 'box' ? 40 : 26);
        }
        if (ev.numBtn) {
          const btn = document.querySelector(`.num-btn[data-n="${ev.numBtn}"]`);
          if (btn) { btn.classList.add('exhaust-flash'); setTimeout(() => btn.classList.remove('exhaust-flash'), 700); }
        }
      }, k * 350);
    });
  }

  /* ---------- hearts / lose ---------- */
  function loseHeart(local) {
    if (S.hearts <= 0) return;
    S.hearts--;
    const heartEl = $('hearts').children[S.hearts];
    heartEl.classList.add('breaking');
    setTimeout(() => { heartEl.classList.remove('breaking'); renderHearts(); }, 650);
    refreshPowers();
    if (local) emit('heart', { hearts: S.hearts });
    if (S.hearts === 0) gameOver(local);
  }

  function gameOver(local) {
    S.over = true;
    stopTimer();
    GameAudio.play('lose');
    if (local) emit('lose', {});
    setTimeout(() => Main.showGameOver({ score: S.score, time: S.timer, mode: S.mode, difficulty: S.difficulty, seed: S.seed }), 800);
  }

  /* ---------- win ---------- */
  function checkWin(local) {
    if (S.over) return;
    if (S.board.some(v => v === 0)) return;
    S.over = true;
    stopTimer();

    GameAudio.play('win');
    FX.confettiRain();
    setTimeout(() => FX.confettiRain(), 700);
    if (local) emit('win', {});

    // compute the final score after queued celebration points have landed
    setTimeout(() => {
      const timeBonus = Math.max(0, 1000 - S.timer);
      const heartBonus = S.hearts * 100;
      const diffBonus = DIFF_BONUS[S.difficulty] || 0;
      Main.showWin({
        base: S.score, timeBonus, heartBonus, diffBonus,
        final: S.score + timeBonus + heartBonus + diffBonus,
        time: S.timer, hearts: S.hearts,
        mode: S.mode, difficulty: S.difficulty,
      });
    }, 1600);
  }

  /* ---------- powers ---------- */
  function usePower(id, local = true) {
    const p = S.powers.find(x => x.id === id);
    if (!p || S.over || S.paused) return;
    if (local) {
      if (S.score < p.cost) return;
      if (id === 'secondwind' && S.hearts >= MAX_HEARTS) return;
      if (id === 'shield' && S.shield) return;
    }

    let ok = true;
    switch (id) {
      case 'oracle': {
        let target = (S.selectedCell >= 0 && S.board[S.selectedCell] === 0) ? S.selectedCell : -1;
        if (target === -1) {
          const empties = S.board.map((v, i) => v === 0 ? i : -1).filter(i => i >= 0);
          if (!empties.length) { ok = false; break; }
          target = empties[Math.floor(Math.random() * empties.length)];
        }
        const n = S.solution[target];
        S.board[target] = n;
        S.notes[target].clear();
        for (const pr of Sudoku.PEERS[target]) S.notes[pr].delete(n);
        const el = boardEl().children[target];
        el.classList.add('reveal-flash');
        setTimeout(() => el.classList.remove('reveal-flash'), 900);
        if (local) emit('place', { i: target, n });
        checkUnitCompletions(target, local);
        refreshCells(); refreshNumpad();
        break;
      }
      case 'secondwind':
        if (S.hearts >= MAX_HEARTS) { ok = false; break; }
        S.hearts++;
        renderHearts();
        GameAudio.play('heart');
        if (local) emit('heart', { hearts: S.hearts });
        break;
      case 'freeze':
        S.frozen += 45;
        $('timer').classList.add('frozen');
        break;
      case 'autonotes':
        for (let i = 0; i < 81; i++) {
          if (S.board[i] === 0) S.notes[i] = new Set(Sudoku.candidates(S.board, i));
        }
        refreshCells();
        break;
      case 'shield':
        S.shield = true;
        break;
      case 'beacon': {
        const d = S.activeDigit || (S.selectedCell >= 0 ? S.board[S.selectedCell] : 0);
        if (!d) { FX.toast('Select a number first!'); ok = false; break; }
        const els = boardEl().children;
        const spots = [];
        for (let i = 0; i < 81; i++)
          if (S.board[i] === 0 && Sudoku.candidates(S.board, i).includes(d)) spots.push(i);
        spots.forEach(i => els[i].classList.add('beacon'));
        setTimeout(() => spots.forEach(i => els[i].classList.remove('beacon')), 8000);
        break;
      }
    }

    if (!ok) return;
    if (local) {
      S.score -= p.cost;
      S.powersUsed[id] = (S.powersUsed[id] || 0) + 1;
      GameAudio.play('power');
      FX.toast(`${p.icon} ${p.name}!`, '');
      emit('power', { id });
      emit('score', { score: S.score });
    }
    renderScore();
    const btn = document.querySelector(`.power-btn[data-pid="${id}"]`);
    if (btn) { btn.classList.add('used-flash'); setTimeout(() => btn.classList.remove('used-flash'), 600); }
    checkWin(local);
  }

  /* ---------- multiplayer glue ---------- */
  function emit(type, payload) {
    if (S.mode === 'multi' && S.onEvent) S.onEvent(type, payload);
  }

  function applyRemote(type, payload) {
    switch (type) {
      case 'place': placeNumber(payload.i, payload.n, false); break;
      case 'note': toggleNote(payload.i, payload.n, false); break;
      case 'erase': eraseCell(payload.i, false); break;
      case 'heart': {
        const prev = S.hearts;
        S.hearts = payload.hearts;
        renderHearts(); refreshPowers();
        if (S.hearts < prev) { FX.shake(); GameAudio.play('wrong'); }
        if (S.hearts === 0 && !S.over) gameOver(false);
        break;
      }
      case 'score': S.score = payload.score; renderScore(); break;
      case 'shield': S.shield = false; refreshPowers(); FX.toast('🛡️ Partner\'s shield absorbed a mistake!'); break;
      case 'power': {
        const p = S.powers.find(x => x.id === payload.id);
        if (p) FX.toast(`Partner used ${p.icon} ${p.name}`);
        if (payload.id === 'shield') { S.shield = true; refreshPowers(); }
        if (payload.id === 'freeze') { S.frozen += 45; $('timer').classList.add('frozen'); }
        if (payload.id === 'autonotes') {
          for (let i = 0; i < 81; i++)
            if (S.board[i] === 0) S.notes[i] = new Set(Sudoku.candidates(S.board, i));
          refreshCells();
        }
        break;
      }
      case 'cursor': {
        const els = boardEl().children;
        for (const el of els) el.classList.remove('remote-cursor');
        if (payload.i >= 0 && els[payload.i]) els[payload.i].classList.add('remote-cursor');
        break;
      }
      case 'win': if (!S.over) checkWin(false); break;
      case 'lose': if (!S.over) { S.hearts = 0; renderHearts(); gameOver(false); } break;
    }
  }

  /* ---------- keyboard ---------- */
  document.addEventListener('keydown', (e) => {
    if (!document.getElementById('screen-game').classList.contains('active')) return;
    if (S.over) return;
    if (e.key >= '1' && e.key <= '9') onNumTap(+e.key);
    else if (e.key === 'n' || e.key === 'N') togglePen();
    else if (e.key === 'e' || e.key === 'E') toggleErase();
    else if (e.key === 'Escape') { setActiveDigit(0, true); refreshCells(); }
    else if (e.key === 'p' || e.key === 'P') setPaused(!S.paused);
    else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      let i = S.selectedCell >= 0 ? S.selectedCell : 40;
      if (e.key === 'ArrowUp' && i >= 9) i -= 9;
      if (e.key === 'ArrowDown' && i < 72) i += 9;
      if (e.key === 'ArrowLeft' && i % 9 > 0) i -= 1;
      if (e.key === 'ArrowRight' && i % 9 < 8) i += 1;
      S.selectedCell = i;
      refreshCells();
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      if (S.selectedCell >= 0 && !S.given[S.selectedCell]) eraseCell(S.selectedCell, true);
    }
  });

  return {
    newGame, loadState, snapshot, applyRemote,
    setPaused, togglePen, toggleErase, usePower,
    stopTimer,
    get state() { return S; },
    set onEvent(fn) { S.onEvent = fn; },
  };
})();
