/* Co-op multiplayer over WebRTC via PeerJS (free public broker, no backend).
   Lobby system: host creates a room with a short code → players gather in the
   lobby → host picks difficulty (or the Daily Challenge) and starts. After a
   game ends everyone can fall back to the lobby for another round.
   Host acts as message hub; every action carries the player's name. */
const Multi = (() => {
  let peer = null;
  let conns = [];           // open DataConnections (host: all guests; guest: [host])
  let isHost = false;
  let active = false;
  let myName = 'Player';
  let roomCode = '';
  let lobby = { players: [], difficulty: 'medium', started: false };

  const $ = (id) => document.getElementById(id);

  /* ---------- witty remarks ---------- */
  const MISTAKE_QUIPS = [
    '💥 {n} angered the grid!',
    '💔 {n} donated a heart to the sudoku gods',
    '🙈 {n} zigged when the puzzle zagged',
    '📉 Bold strategy from {n}. It did not pay off.',
    '🧯 Someone get {n} a calculator',
    '😅 {n} is just keeping things interesting',
  ];
  const POWER_QUIPS = [
    '{i} {n} splashed the cash on {p}!',
    '{i} {n} unleashed {p}!',
    '{i} Big spender {n} just bought {p}',
    '{i} {n} said “skill is optional” and used {p}',
    '{i} {p}, courtesy of {n}',
  ];
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const quipMistake = (n) => pick(MISTAKE_QUIPS).replace('{n}', n);
  const quipPower = (n, p, icon) => pick(POWER_QUIPS).replace('{n}', n).replace('{p}', p).replace('{i}', icon);

  /* ---------- plumbing ---------- */
  function loadPeerJS() {
    return new Promise((resolve, reject) => {
      if (window.Peer) return resolve();
      const s = document.createElement('script');
      s.src = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('Could not load multiplayer library. Check your connection.'));
      document.head.appendChild(s);
    });
  }

  function broadcast(msg, except) {
    for (const c of conns) if (c !== except && c.open) c.send(msg);
  }

  function wireGameEvents() {
    Game.onEvent = (type, payload) => broadcast({ t: type, from: myName, ...payload });
  }

  /* Host: recompute roster + push lobby state to everyone. */
  function sendLobby() {
    if (!isHost) return;
    lobby.players = [myName + ' ⭐', ...conns.filter(c => c.open).map(c => c.metadata_name || 'Friend')];
    broadcast({ t: 'lobby', lobby });
    renderLobby();
  }

  function handleMessage(msg, fromConn) {
    if (!msg || !msg.t) return;

    if (msg.t === 'state') {
      // full state from host — start playing
      Main.enterMultiplayerGame(() => Game.loadState(msg.state));
      return;
    }
    if (msg.t === 'lobby') {
      lobby = msg.lobby;
      renderLobby();
      // first lobby snapshot after joining → move guest onto the lobby screen
      if (!$('screen-game').classList.contains('active')) {
        Main.closeModal();
        Main.showScreen('screen-lobby');
      }
      return;
    }
    if (msg.t === 'hello') {
      fromConn.metadata_name = (msg.name || 'Friend').slice(0, 14);
      FX.toast(`👋 ${fromConn.metadata_name} joined the lobby!`);
      GameAudio.play('join');
      updatePresence();
      if (isHost) {
        sendLobby();
        // game already running (and not finished)? beam them straight onto the board
        if (lobby.started && Game.state.board && Game.state.mode === 'multi' && !Game.state.over)
          fromConn.send({ t: 'state', state: Game.snapshot() });
      }
      return;
    }
    // gameplay events: relay (host = hub), then apply locally
    if (isHost) broadcast(msg, fromConn);
    const { t, ...payload } = msg;
    Game.applyRemote(t, payload);
  }

  function wireConnection(conn) {
    conn.on('data', (msg) => handleMessage(msg, conn));
    conn.on('close', () => onConnGone(conn));
    conn.on('error', () => onConnGone(conn));
  }

  function onConnGone(conn) {
    if (!conns.includes(conn)) return;
    conns = conns.filter(c => c !== conn);
    updatePresence();
    if (isHost) {
      FX.toast(`👋 ${conn.metadata_name || 'A player'} left`);
      sendLobby();
    } else {
      // we lost the host
      if ($('screen-lobby').classList.contains('active')) {
        FX.toast('Host closed the lobby');
        Main.backToMenu();
      } else if ($('screen-game').classList.contains('active')) {
        if (!Game.state.over) FX.toast('Connection lost — keep solving solo!');
        else FX.toast('The host left the room'); // end screen stays up; its buttons still work
      } else {
        // stuck mid-join (e.g. "Connecting…" modal)
        FX.toast('Disconnected from the room');
        Main.closeModal();
        Main.backToMenu();
      }
      active = false;
    }
  }

  function updatePresence() {
    const el = $('multi-presence');
    if (!el) return;
    if (!active) { el.hidden = true; return; }
    el.hidden = false;
    const n = conns.filter(c => c.open).length;
    el.innerHTML = `<span class="presence-dot"></span>${n} friend${n === 1 ? '' : 's'} connected`;
  }

  /* ---------- room codes ---------- */
  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no confusable 0/O, 1/I/L
  function randCode() {
    let c = '';
    for (let k = 0; k < 6; k++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    return c;
  }
  const peerIdFor = (code) => 'daily-sudoku-' + code.toLowerCase();

  /* ---------- host / join ---------- */
  async function createRoom(name) {
    await loadPeerJS();
    myName = name;
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const tryCreate = () => {
        const code = randCode();
        const p = new Peer(peerIdFor(code));
        let opened = false;
        const timeout = setTimeout(() => { if (!opened) { try { p.destroy(); } catch (_) {} reject(new Error('Connection to the matchmaking server timed out.')); } }, 15000);
        p.on('open', () => {
          opened = true;
          clearTimeout(timeout);
          peer = p;
          isHost = true; active = true;
          roomCode = code;
          lobby = { players: [myName + ' ⭐'], difficulty: lobby.difficulty || 'medium', started: false };
          wireGameEvents();
          p.on('connection', (conn) => {
            conns.push(conn);
            wireConnection(conn);
          });
          resolve({ code, link: inviteLink() });
        });
        p.on('error', (err) => {
          if (opened) return; // post-setup broker hiccups: ignore here
          clearTimeout(timeout);
          try { p.destroy(); } catch (_) {}
          if (err.type === 'unavailable-id' && ++attempts < 4) tryCreate();
          else reject(err);
        });
      };
      tryCreate();
    });
  }

  async function joinRoom(code, name) {
    await loadPeerJS();
    myName = name;
    return new Promise((resolve, reject) => {
      peer = new Peer();
      const timeout = setTimeout(() => reject(new Error('Could not reach the room. Ask for a fresh code.')), 15000);
      peer.on('open', () => {
        const conn = peer.connect(peerIdFor(code), { reliable: true });
        conn.on('open', () => {
          clearTimeout(timeout);
          isHost = false; active = true;
          roomCode = code.toUpperCase();
          conns = [conn];
          wireConnection(conn);
          wireGameEvents();
          conn.send({ t: 'hello', name: myName });
          updatePresence();
          resolve();
        });
        conn.on('error', (err) => { clearTimeout(timeout); reject(err); });
      });
      peer.on('error', (err) => {
        clearTimeout(timeout);
        reject(err.type === 'peer-unavailable' ? new Error('Room not found — check the code or ask for a fresh link.') : err);
      });
    });
  }

  function inviteLink() {
    return `${location.origin}${location.pathname}?room=${roomCode}`;
  }

  /* ---------- lobby UI ---------- */
  function showLobby() {
    Main.closeModal();
    Main.showScreen('screen-lobby');
    if (isHost) { lobby.started = false; sendLobby(); }
    renderLobby();
  }

  function renderLobby() {
    const screen = $('screen-lobby');
    if (!screen) return;
    $('lobby-code').textContent = roomCode || '—';

    // players
    const list = $('lobby-players');
    list.innerHTML = '';
    const players = lobby.players.length ? lobby.players : [myName + (isHost ? ' ⭐' : '')];
    for (const p of players) {
      const li = document.createElement('li');
      li.className = 'lobby-player';
      li.innerHTML = `<span class="presence-dot"></span>${escapeHtml(p)}`;
      list.appendChild(li);
    }
    $('lobby-count').textContent = `${players.length} player${players.length === 1 ? '' : 's'}`;

    // difficulty buttons
    document.querySelectorAll('#lobby-diff-row .diff-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.diff === lobby.difficulty);
      b.disabled = !isHost;
    });
    const key = typeof Daily !== 'undefined' ? Daily.todayKey() : '';
    $('lobby-diff-note').textContent = lobby.difficulty === 'daily'
      ? `Today's Daily (${key}) — finishing it together counts toward everyone's streak! 🔥`
      : isHost ? 'You choose — everyone plays the same board.' : 'The host picks the difficulty.';

    // actions
    $('btn-lobby-start').hidden = !isHost;
    $('btn-lobby-start').disabled = isHost && players.length <= 1;
    $('lobby-hint').textContent = isHost
      ? (players.length === 1 ? 'Share the code or link — friends appear here when they join.' : 'Everyone\'s in? Hit Start!')
      : 'Waiting for the host to start the game…';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function setDifficulty(d) {
    if (!isHost) return;
    lobby.difficulty = d;
    GameAudio.play('click');
    sendLobby();
    
    // Auto-start game if there are other players
    const players = lobby.players.length ? lobby.players : [myName + ' ⭐'];
    if (players.length > 1) {
      startGame();
    }
  }

  /* Host: launch the game for everyone. */
  function startGame() {
    if (!isHost) return;
    GameAudio.play('click');
    let seed, difficulty, daily = false;
    if (lobby.difficulty === 'daily') {
      const key = Daily.todayKey();
      seed = Daily.seedFor(key);
      difficulty = Daily.difficultyFor(key);
      daily = true;
    } else {
      seed = 'mp:' + Date.now() + ':' + Math.floor(Math.random() * 1e9);
      difficulty = lobby.difficulty;
    }
    lobby.started = true;
    sendLobby();
    Main.showScreen('screen-game');
    Game.newGame({ seed, difficulty, mode: 'multi', daily });
    broadcast({ t: 'state', state: Game.snapshot() });
    updatePresence();
  }

  /* Everyone: return to the lobby after a game ends. */
  function backToLobby() {
    GameAudio.play('click');
    Game.stopTimer();
    if (!active) { // room is gone (host left) — nothing to return to
      FX.toast('The room has closed');
      Main.backToMenu();
      return;
    }
    showLobby();
  }

  function leave() {
    try { peer && peer.destroy(); } catch (_) {}
    peer = null; conns = []; isHost = false; active = false; roomCode = '';
    lobby = { players: [], difficulty: lobby.difficulty || 'medium', started: false };
    Game.onEvent = null;
    updatePresence();
  }

  return {
    createRoom, joinRoom, leave, updatePresence,
    showLobby, renderLobby, setDifficulty, startGame, backToLobby, inviteLink,
    quipMistake, quipPower,
    get isHost() { return isHost; },
    get active() { return active; },
    get playerCount() { return conns.filter(c => c.open).length; },
    get myName() { return myName; },
  };
})();
