/* Co-op multiplayer over WebRTC via PeerJS (free public broker, no backend).
   Host creates a room → shares link ?room=<id>. Guests connect and receive
   full game state; all moves broadcast to every connection. */
const Multi = (() => {
  let peer = null;
  let conns = [];           // open DataConnections
  let isHost = false;
  let active = false;
  let onReady = null;

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
    Game.onEvent = (type, payload) => broadcast({ t: type, ...payload });
  }

  function handleMessage(msg, fromConn) {
    if (!msg || !msg.t) return;
    if (msg.t === 'state') {
      // full state from host — start playing
      Main.enterMultiplayerGame(() => Game.loadState(msg.state));
      return;
    }
    if (msg.t === 'hello') {
      FX.toast(`👋 ${msg.name || 'A friend'} joined!`);
      GameAudio.play('join');
      updatePresence();
      // only share state once the host has actually started the puzzle
      if (isHost && Game.state.board && Game.state.mode === 'multi')
        fromConn.send({ t: 'state', state: Game.snapshot() });
      return;
    }
    // relay to other peers (host acts as hub)
    if (isHost) broadcast(msg, fromConn);
    const { t, ...payload } = msg;
    Game.applyRemote(t, payload);
  }

  function wireConnection(conn) {
    conn.on('data', (msg) => handleMessage(msg, conn));
    conn.on('close', () => {
      conns = conns.filter(c => c !== conn);
      FX.toast('A player left the room');
      updatePresence();
    });
    conn.on('error', () => {
      conns = conns.filter(c => c !== conn);
      updatePresence();
    });
  }

  function updatePresence() {
    const el = document.getElementById('multi-presence');
    if (!active) { el.hidden = true; return; }
    el.hidden = false;
    const n = conns.filter(c => c.open).length;
    el.innerHTML = `<span class="presence-dot"></span>${n} friend${n === 1 ? '' : 's'} connected`;
  }

  /* Host: create a room. Resolves with the share link. */
  async function createRoom() {
    await loadPeerJS();
    return new Promise((resolve, reject) => {
      peer = new Peer();
      const timeout = setTimeout(() => reject(new Error('Connection to the matchmaking server timed out.')), 15000);
      peer.on('open', (id) => {
        clearTimeout(timeout);
        isHost = true;
        active = true;
        wireGameEvents();
        peer.on('connection', (conn) => {
          conns.push(conn);
          wireConnection(conn);
        });
        const link = `${location.origin}${location.pathname}?room=${id}`;
        resolve({ id, link });
      });
      peer.on('error', (err) => { clearTimeout(timeout); reject(err); });
    });
  }

  /* Guest: join an existing room by id. */
  async function joinRoom(roomId) {
    await loadPeerJS();
    return new Promise((resolve, reject) => {
      peer = new Peer();
      const timeout = setTimeout(() => reject(new Error('Could not reach the room. Ask for a fresh link.')), 15000);
      peer.on('open', () => {
        const conn = peer.connect(roomId, { reliable: true });
        conn.on('open', () => {
          clearTimeout(timeout);
          isHost = false;
          active = true;
          conns = [conn];
          wireConnection(conn);
          wireGameEvents();
          conn.send({ t: 'hello', name: 'Friend' });
          updatePresence();
          resolve();
        });
        conn.on('error', (err) => { clearTimeout(timeout); reject(err); });
      });
      peer.on('error', (err) => { clearTimeout(timeout); reject(err); });
    });
  }

  /* Host: push full state to everyone (e.g. right after starting the puzzle). */
  function broadcastState() {
    if (isHost) broadcast({ t: 'state', state: Game.snapshot() });
  }

  function leave() {
    try { peer && peer.destroy(); } catch (_) {}
    peer = null; conns = []; isHost = false; active = false;
    Game.onEvent = null;
    updatePresence();
  }

  return {
    createRoom, joinRoom, leave, updatePresence, broadcastState,
    get isHost() { return isHost; },
    get active() { return active; },
    get playerCount() { return conns.filter(c => c.open).length; },
  };
})();
