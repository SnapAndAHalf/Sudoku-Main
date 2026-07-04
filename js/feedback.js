/* Feedback button + modal (anyone can send, guest or logged in)
   and Track: lightweight session telemetry for the admin dashboard.
   Both are best-effort — if Supabase is unreachable, the game just plays on. */

const Feedback = (() => {
  const $ = (id) => document.getElementById(id);
  const client = () => (typeof Auth !== 'undefined' ? Auth.client : null);

  function escAttr(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function showModal() {
    GameAudio.play('click');
    const email = (typeof Auth !== 'undefined' && Auth.user) ? Auth.user.email : '';
    Main.openModal(`
      <h2>Send Feedback 💬</h2>
      <p>Found a bug? Have an idea? We read everything.</p>
      <textarea class="modal-input feedback-text" id="fb-message" maxlength="2000" rows="5"
        placeholder="What's on your mind?"></textarea>
      <input class="modal-input" id="fb-email" type="email" placeholder="Email (optional, if you'd like a reply)"
        value="${escAttr(email)}">
      <p class="auth-error" id="fb-error" hidden></p>
      <div class="modal-actions">
        <button class="btn btn-primary" id="fb-send">Send</button>
        <button class="btn btn-ghost" onclick="Main.closeModal()">Cancel</button>
      </div>
      <p class="auth-fineprint">Your message${email ? '' : ' (and email, if given)'} is stored so we can act on it —
      see the <a href="privacy-policy.html" target="_blank">Privacy Policy</a>.</p>`);
    $('fb-send').addEventListener('click', send);
    $('fb-message').focus();
  }

  async function send() {
    const sb = client();
    const message = $('fb-message').value.trim();
    const email = $('fb-email').value.trim();
    const err = $('fb-error');
    if (!message) { err.textContent = 'Please write a message first.'; err.hidden = false; return; }
    if (email && !/\S+@\S+\.\S+/.test(email)) { err.textContent = 'That email looks off — fix it or leave it empty.'; err.hidden = false; return; }
    if (!sb) { err.textContent = 'Could not reach the server. Please try again in a moment.'; err.hidden = false; return; }

    $('fb-send').disabled = true;
    const { error } = await sb.from('feedback').insert({
      user_id: (typeof Auth !== 'undefined' && Auth.user) ? Auth.user.id : null,
      email: email || null,
      message,
      page: location.pathname,
    });
    if (error) {
      $('fb-send').disabled = false;
      err.textContent = 'Sending failed — please try again.';
      err.hidden = false;
      return;
    }
    Main.closeModal();
    FX.toast('💌 Thanks for the feedback!');
  }

  document.addEventListener('DOMContentLoaded', () => {
    const btn = $('btn-feedback');
    if (btn) btn.addEventListener('click', showModal);
  });

  return { showModal };
})();

/* ---------- session telemetry ---------- */
const Track = (() => {
  let sessionId = null;

  const client = () => (typeof Auth !== 'undefined' ? Auth.client : null);

  /* Called from Game.newGame / Game.loadState. One row per game started.
     The row id is generated client-side because players may not SELECT
     from game_sessions (that's admin-only). */
  async function gameStarted(mode, difficulty) {
    sessionId = null;
    const sb = client();
    if (!sb || !window.crypto || !crypto.randomUUID) return;
    const id = crypto.randomUUID();
    try {
      const { error } = await sb.from('game_sessions').insert({
        id,
        user_id: (typeof Auth !== 'undefined' && Auth.user) ? Auth.user.id : null,
        mode, difficulty,
      });
      if (!error) sessionId = id;
    } catch (_) { /* telemetry must never break the game */ }
  }

  /* Called from Game win/lose. Fills in the result of the row we created. */
  async function gameEnded(won, durationSeconds) {
    const sb = client();
    const id = sessionId;
    sessionId = null; // write-once per game
    if (!sb || !id) return;
    try {
      await sb.rpc('finish_session', { p_id: id, p_won: won, p_duration: durationSeconds });
    } catch (_) {}
  }

  return { gameStarted, gameEnded };
})();
