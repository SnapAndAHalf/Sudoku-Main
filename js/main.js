/* Main: menu, navigation, modals, highscores, daily UI, multiplayer lobby. */
const Main = (() => {
  const $ = (id) => document.getElementById(id);

  /* ---------- screens ---------- */
  function show(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    $(screenId).classList.add('active');
    window.scrollTo(0, 0);
  }

  /* ---------- highscores ---------- */
  function getScores() {
    try { return JSON.parse(localStorage.getItem('ds_scores') || '{}'); }
    catch (_) { return {}; }
  }
  function saveScore(difficulty, score) {
    const s = getScores();
    const isRecord = score > (s[difficulty] || 0);
    if (isRecord) { s[difficulty] = score; localStorage.setItem('ds_scores', JSON.stringify(s)); }
    return isRecord;
  }

  function renderMenuStats() {
    // daily card
    const streak = Daily.currentStreak();
    $('streak-count').textContent = streak;
    $('streak-flame').classList.toggle('lit', streak > 0);
    const today = new Date();
    $('daily-date').textContent = today.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const status = $('daily-status');
    if (Daily.isDoneToday()) {
      status.textContent = '✓ Completed! Come back tomorrow for a new puzzle.';
      status.classList.add('done');
    } else {
      status.textContent = `Today: ${cap(Daily.difficultyFor(Daily.todayKey()))} — same puzzle for everyone!`;
      status.classList.remove('done');
    }
    // highscores
    const s = getScores();
    const parts = ['easy', 'medium', 'hard', 'expert']
      .filter(d => s[d]).map(d => `${cap(d)} ${s[d]}`);
    $('highscore-line').textContent = parts.length ? 'Best: ' + parts.join(' · ') : 'Best: no games finished yet';
  }

  function cap(x) { return x[0].toUpperCase() + x.slice(1); }

  /* ---------- modal helpers ---------- */
  function openModal(html) {
    $('modal-card').innerHTML = html;
    $('modal').hidden = false;
  }
  function closeModal() { $('modal').hidden = true; }

  $('modal').addEventListener('click', (e) => {
    if (e.target === $('modal')) closeModal();
  });

  /* ---------- game starters ---------- */
  function startSingle(difficulty) {
    GameAudio.unlock();
    GameAudio.play('click');
    closeModal();
    Multi.leave();
    show('screen-game');
    Game.newGame({ seed: 'sp:' + Date.now() + ':' + Math.random(), difficulty, mode: 'single' });
  }

  function startDaily() {
    GameAudio.unlock();
    GameAudio.play('click');
    closeModal();
    Multi.leave();
    const key = Daily.todayKey();
    show('screen-game');
    Game.newGame({ seed: Daily.seedFor(key), difficulty: Daily.difficultyFor(key), mode: 'daily' });
    if (Daily.isDoneToday()) FX.toast('Already completed today — playing for fun!');
  }

  /* ---------- multiplayer ---------- */
  async function createRoom() {
    GameAudio.unlock();
    openModal(`<h2>Creating room…</h2><p>Contacting matchmaking server</p>`);
    try {
      const { link } = await Multi.createRoom();
      openModal(`
        <h2>Room Ready! 🎉</h2>
        <p>Share this link with friends. The game starts for you now — friends join your board live.</p>
        <div class="room-link-box" id="room-link" title="Click to copy">${link}</div>
        <p style="font-size:.8rem" id="copy-hint">Click the link to copy it</p>
        <div class="modal-actions">
          <button class="btn btn-primary" id="btn-start-multi">Start Puzzle</button>
        </div>`);
      $('room-link').addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(link);
          $('copy-hint').textContent = '✓ Copied to clipboard!';
        } catch (_) { $('copy-hint').textContent = 'Copy it manually (Ctrl+C)'; }
      });
      $('btn-start-multi').addEventListener('click', () => {
        closeModal();
        show('screen-game');
        Game.newGame({ seed: 'mp:' + Daily.todayKey() + ':' + Math.floor(Math.random() * 1e9), difficulty: 'medium', mode: 'multi' });
        Multi.broadcastState(); // friends who joined the lobby early get the board now
        Multi.updatePresence();
      });
    } catch (err) {
      openModal(`<h2>Couldn't create room</h2><p>${err.message || err.type || 'Unknown error'}</p>
        <div class="modal-actions"><button class="btn btn-ghost" onclick="Main.closeModal()">Close</button></div>`);
    }
  }

  function joinRoomPrompt(prefill = '') {
    openModal(`
      <h2>Join a Room</h2>
      <p>Paste the invite link or room code your friend sent you.</p>
      <input class="modal-input" id="room-code-input" placeholder="Invite link or room code" value="${prefill}">
      <div class="modal-actions">
        <button class="btn btn-primary" id="btn-do-join">Join</button>
        <button class="btn btn-ghost" onclick="Main.closeModal()">Cancel</button>
      </div>`);
    const doJoin = () => {
      const raw = $('room-code-input').value.trim();
      if (!raw) return;
      let code = raw;
      try { const u = new URL(raw); code = u.searchParams.get('room') || raw; } catch (_) {}
      joinRoom(code);
    };
    $('btn-do-join').addEventListener('click', doJoin);
    $('room-code-input').addEventListener('keydown', e => { if (e.key === 'Enter') doJoin(); });
    $('room-code-input').focus();
  }

  async function joinRoom(code) {
    GameAudio.unlock();
    openModal(`<h2>Joining room…</h2><p>Connecting to your friend's board</p>`);
    try {
      await Multi.joinRoom(code);
      openModal(`<h2>Connected! 🎉</h2><p>Waiting for the host's board…</p>`);
      // Game starts when the host's state arrives (enterMultiplayerGame)
    } catch (err) {
      openModal(`<h2>Couldn't join</h2><p>${err.message || err.type || 'Room not found — ask for a fresh link.'}</p>
        <div class="modal-actions"><button class="btn btn-ghost" onclick="Main.closeModal()">Close</button></div>`);
    }
  }

  /* Called by Multi when host state arrives. */
  function enterMultiplayerGame(loadFn) {
    closeModal();
    show('screen-game');
    loadFn();
    Multi.updatePresence();
    FX.toast('🤝 Solving together — good luck!');
    GameAudio.play('join');
  }

  /* ---------- end screens ---------- */
  function showWin({ base, timeBonus, heartBonus, diffBonus, final, time, hearts, mode, difficulty }) {
    const mm = String(Math.floor(time / 60)).padStart(2, '0');
    const ss = String(time % 60).padStart(2, '0');

    let recordLine = '';
    if (mode === 'single') {
      if (saveScore(difficulty, final)) recordLine = `<p class="new-record">★ NEW HIGHSCORE! ★</p>`;
    }
    let streakLine = '';
    if (mode === 'daily') {
      const wasDone = Daily.isDoneToday();
      const streak = Daily.markDone(final);
      if (!wasDone) streakLine = `<p class="new-record">🔥 ${streak}-day streak!</p>`;
    }

    openModal(`
      <h2 class="win">PUZZLE SOLVED!</h2>
      ${recordLine}${streakLine}
      <div class="modal-stats">
        <div class="mstat"><b>${base}</b><small>Points earned</small></div>
        <div class="mstat"><b>+${timeBonus}</b><small>Time bonus</small></div>
        <div class="mstat"><b>+${heartBonus}</b><small>${hearts} hearts kept</small></div>
        <div class="mstat"><b>+${diffBonus}</b><small>${cap(difficulty)} bonus</small></div>
        <div class="mstat gold" style="grid-column: 1 / -1"><b>${final}</b><small>Final score · ${mm}:${ss}</small></div>
      </div>
      <div class="modal-actions">
        ${mode === 'single' ? `<button class="btn btn-primary" onclick="Main.closeModal(); Main.startSingle('${difficulty}')">Play Again</button>` : ''}
        <button class="btn btn-ghost" onclick="Main.closeModal(); Main.backToMenu()">Menu</button>
      </div>`);
    renderMenuStats();
  }

  function showGameOver({ score, time, mode, difficulty, seed }) {
    const retry = mode === 'daily'
      ? `<button class="btn btn-primary" onclick="Main.closeModal(); Main.startDaily()">Try Again</button>`
      : mode === 'single'
        ? `<button class="btn btn-primary" onclick="Main.closeModal(); Main.startSingle('${difficulty}')">New Game</button>`
        : '';
    openModal(`
      <h2 class="lose">OUT OF HEARTS 💔</h2>
      <p>The grid got the better of you this time. You banked <b>${score}</b> points before falling.</p>
      <div class="modal-actions">
        ${retry}
        <button class="btn btn-ghost" onclick="Main.closeModal(); Main.backToMenu()">Menu</button>
      </div>`);
  }

  function backToMenu() {
    Game.stopTimer();
    Multi.leave();
    show('screen-menu');
    renderMenuStats();
  }

  /* ---------- how to play ---------- */
  function showHow() {
    GameAudio.play('click');
    openModal(`
      <h2>How to Play</h2>
      <ul class="how-list">
        <li><b>Goal:</b> fill every row, column and 3×3 box with digits 1–9, no repeats.</li>
        <li><b>Input:</b> tap a number then tap cells, or tap a cell then a number. Arrow keys + 1–9 work too.</li>
        <li><b>Hearts:</b> a wrong placement costs one of your 3 ♥. Zero hearts = game over.</li>
        <li><b>Points:</b> earn ★ for correct moves (combos multiply!), completed lines (+40), boxes (+60) and finishing all of a digit (+30).</li>
        <li><b>Powers:</b> spend ★ on 3 powers drawn from a pool of 6 each game — reveal, shield, freeze time and more.</li>
        <li><b>Pen mode (N):</b> jot candidate notes in cells. Auto-cleaned as you solve.</li>
        <li><b>Daily:</b> one worldwide puzzle a day. Complete it daily to grow your 🔥 streak.</li>
        <li><b>Multiplayer:</b> create a room, share the link, solve the same board together.</li>
      </ul>
      <div class="modal-actions"><button class="btn btn-primary" onclick="Main.closeModal()">Got it!</button></div>`);
  }

  /* ---------- wiring ---------- */
  function init() {
    $('btn-daily').addEventListener('click', startDaily);
    document.querySelectorAll('.diff-btn').forEach(b =>
      b.addEventListener('click', () => startSingle(b.dataset.diff)));
    $('btn-create-room').addEventListener('click', createRoom);
    $('btn-join-room').addEventListener('click', () => joinRoomPrompt());
    $('btn-how').addEventListener('click', showHow);

    $('btn-back').addEventListener('click', () => {
      GameAudio.play('click');
      if (!Game.state.over && Game.state.board && Game.state.board.some((v, i) => v !== 0 && !Game.state.given[i])) {
        openModal(`
          <h2>Leave game?</h2><p>Your progress in this puzzle will be lost.</p>
          <div class="modal-actions">
            <button class="btn btn-primary" onclick="Main.closeModal(); Main.backToMenu()">Leave</button>
            <button class="btn btn-ghost" onclick="Main.closeModal()">Keep Playing</button>
          </div>`);
      } else backToMenu();
    });
    $('btn-pause').addEventListener('click', () => Game.setPaused(!Game.state.paused));
    $('btn-pen').addEventListener('click', Game.togglePen);
    $('btn-erase').addEventListener('click', Game.toggleErase);

    // sound toggles
    const st = $('toggle-sound'), mt = $('toggle-music');
    st.classList.toggle('off', !GameAudio.sfxOn);
    mt.classList.toggle('off', !GameAudio.musicOn);
    st.addEventListener('click', () => { st.classList.toggle('off', !GameAudio.toggleSfx()); GameAudio.play('click'); });
    mt.addEventListener('click', () => { GameAudio.unlock(); mt.classList.toggle('off', !GameAudio.toggleMusic()); });

    // music starts on first interaction anywhere (autoplay policy)
    document.addEventListener('pointerdown', function once() {
      GameAudio.unlock();
      if (GameAudio.musicOn) GameAudio.startMusic();
      document.removeEventListener('pointerdown', once);
    }, { once: true });

    renderMenuStats();

    // deep link: ?room=xyz → join flow
    const room = new URLSearchParams(location.search).get('room');
    if (room) {
      history.replaceState(null, '', location.pathname);
      joinRoomPrompt(room);
    }
  }

  document.addEventListener('DOMContentLoaded', init);

  return {
    startSingle, startDaily, backToMenu, closeModal,
    showWin, showGameOver, enterMultiplayerGame,
  };
})();
