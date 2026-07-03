/* Auth + cloud sync via Supabase (email/password).
   - Welcome gate on first visit: Sign up / Log in / Play as guest
   - DPDP (India) compliance: explicit consent + 18+ confirmation at signup,
     consent record stored, in-app account deletion (right to erasure).
   - Cloud sync: daily streak + highscores merged across devices. */
const Auth = (() => {
  const SUPABASE_URL = 'https://ktqxaixifvuhdsnhabfo.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_lR1H8iHOQsHXsarCCbUc8A_RwqYsekI';
  const CONSENT_VERSION = '1.0 (2026-07-03)';

  const $ = (id) => document.getElementById(id);
  let sb = null;          // supabase client
  let user = null;        // current user or null
  let syncing = false;

  // captured before Main.init strips it — a friend joining via invite link
  // shouldn't be blocked by the welcome gate
  const joiningRoom = !!new URLSearchParams(location.search).get('room');

  /* ---------- client ---------- */
  function loadSdk() {
    return new Promise((resolve, reject) => {
      if (window.supabase) return resolve();
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('Could not load sign-in service. Check your connection.'));
      document.head.appendChild(s);
    });
  }

  async function init() {
    try {
      await loadSdk();
      sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
      const { data } = await sb.auth.getSession();
      user = data.session ? data.session.user : null;

      sb.auth.onAuthStateChange((event, session) => {
        user = session ? session.user : null;
        renderAccountBtn();
        if (event === 'SIGNED_IN') {
          localStorage.setItem('ds_guest', '1'); // never re-show the welcome gate
          // close the welcome gate if it's open (e.g. arriving via email confirm link)
          if ($('wg-signup')) Main.closeModal();
          pullAndMerge();
        }
        if (event === 'PASSWORD_RECOVERY') showNewPasswordModal();
      });

      renderAccountBtn();
      if (user) pullAndMerge();
      else if (!joiningRoom && !localStorage.getItem('ds_guest')) showWelcomeGate();
    } catch (_) {
      // offline / blocked: game still fully playable as guest
      renderAccountBtn();
    }
  }

  /* ---------- welcome gate ---------- */
  function showWelcomeGate() {
    Main.openModal(`
      <h2>Welcome! 👋</h2>
      <p>Create a free account to save your streaks and highscores across devices — or just play.</p>
      <div class="modal-actions" style="flex-direction:column">
        <button class="btn btn-primary" id="wg-signup" style="width:100%">Sign Up</button>
        <button class="btn btn-ghost" id="wg-login" style="width:100%">Log In</button>
        <button class="btn btn-ghost" id="wg-guest" style="width:100%">Play as Guest</button>
      </div>
      <p class="auth-fineprint">Guests: no personal data is collected — progress stays in this browser.
      See our <a href="privacy-policy.html" target="_blank">Privacy Policy</a> &amp; <a href="terms.html" target="_blank">Terms</a>.</p>`);
    $('wg-signup').addEventListener('click', () => showAuthModal('signup'));
    $('wg-login').addEventListener('click', () => showAuthModal('login'));
    $('wg-guest').addEventListener('click', () => {
      localStorage.setItem('ds_guest', '1');
      Main.closeModal();
      GameAudio.play('click');
    });
  }

  /* ---------- login / signup ---------- */
  function showAuthModal(mode) {
    const isSignup = mode === 'signup';
    Main.openModal(`
      <h2>${isSignup ? 'Create Account' : 'Log In'}</h2>
      <input class="modal-input" id="auth-email" type="email" placeholder="Email" autocomplete="email">
      <input class="modal-input" id="auth-pass" type="password" placeholder="Password${isSignup ? ' (min 8 characters)' : ''}"
        autocomplete="${isSignup ? 'new-password' : 'current-password'}">
      ${isSignup ? `
      <label class="auth-check"><input type="checkbox" id="auth-consent">
        <span>I agree to the <a href="terms.html" target="_blank">Terms</a> and consent to my email &amp; game
        progress being processed as described in the <a href="privacy-policy.html" target="_blank">Privacy Policy</a>.</span></label>
      <label class="auth-check"><input type="checkbox" id="auth-age">
        <span>I confirm I am 18 years of age or older.</span></label>` : ''}
      <p class="auth-error" id="auth-error" hidden></p>
      <div class="modal-actions">
        <button class="btn btn-primary" id="auth-submit">${isSignup ? 'Sign Up' : 'Log In'}</button>
        <button class="btn btn-ghost" onclick="Main.closeModal()">Cancel</button>
      </div>
      <p class="auth-fineprint">
        ${isSignup
          ? `Already have an account? <a href="#" id="auth-switch">Log in</a>`
          : `New here? <a href="#" id="auth-switch">Create an account</a> · <a href="#" id="auth-forgot">Forgot password?</a>`}
      </p>`);

    $('auth-switch').addEventListener('click', (e) => { e.preventDefault(); showAuthModal(isSignup ? 'login' : 'signup'); });
    if (!isSignup) $('auth-forgot').addEventListener('click', (e) => { e.preventDefault(); forgotPassword(); });
    $('auth-submit').addEventListener('click', () => isSignup ? doSignup() : doLogin());
    $('auth-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') (isSignup ? doSignup() : doLogin()); });
    $('auth-email').focus();
  }

  function authError(msg) {
    const el = $('auth-error');
    if (el) { el.textContent = msg; el.hidden = false; }
  }

  async function doSignup() {
    const email = $('auth-email').value.trim();
    const pass = $('auth-pass').value;
    if (!email || !/\S+@\S+\.\S+/.test(email)) return authError('Please enter a valid email address.');
    if (pass.length < 8) return authError('Password must be at least 8 characters.');
    if (!$('auth-consent').checked) return authError('Please agree to the Terms and Privacy Policy to create an account.');
    if (!$('auth-age').checked) return authError('Accounts are for users 18+. You can still play as a guest!');

    $('auth-submit').disabled = true;
    const consent = { consent_version: CONSENT_VERSION, consent_at: new Date().toISOString(), age_confirmed: true };
    const { data, error } = await sb.auth.signUp({
      email, password: pass,
      options: { data: consent, emailRedirectTo: location.origin + location.pathname },
    });
    $('auth-submit') && ($('auth-submit').disabled = false);
    if (error) return authError(error.message);

    localStorage.setItem('ds_guest', '1'); // don't re-show gate
    if (!data.session) {
      Main.openModal(`
        <h2>Check your inbox 📬</h2>
        <p>We sent a confirmation link to <b>${email}</b>. Click it to activate your account, then come back and log in.</p>
        <div class="modal-actions"><button class="btn btn-primary" onclick="Main.closeModal()">OK</button></div>`);
    } else {
      Main.closeModal();
      FX.toast('🎉 Account created — progress will now sync!');
    }
  }

  async function doLogin() {
    const email = $('auth-email').value.trim();
    const pass = $('auth-pass').value;
    if (!email || !pass) return authError('Enter your email and password.');
    $('auth-submit').disabled = true;
    const { error } = await sb.auth.signInWithPassword({ email, password: pass });
    $('auth-submit') && ($('auth-submit').disabled = false);
    if (error) return authError(error.message === 'Invalid login credentials'
      ? 'Wrong email or password.' : error.message);
    localStorage.setItem('ds_guest', '1');
    Main.closeModal();
    FX.toast('👋 Welcome back!');
  }

  async function forgotPassword() {
    const email = ($('auth-email').value || '').trim();
    if (!email) return authError('Type your email above first, then click "Forgot password".');
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    if (error) return authError(error.message);
    authError('');
    Main.openModal(`
      <h2>Reset link sent 📬</h2>
      <p>If an account exists for <b>${email}</b>, a password reset link is on its way.</p>
      <div class="modal-actions"><button class="btn btn-primary" onclick="Main.closeModal()">OK</button></div>`);
  }

  function showNewPasswordModal() {
    Main.openModal(`
      <h2>Set a new password</h2>
      <input class="modal-input" id="np-pass" type="password" placeholder="New password (min 8 characters)" autocomplete="new-password">
      <p class="auth-error" id="auth-error" hidden></p>
      <div class="modal-actions"><button class="btn btn-primary" id="np-save">Save Password</button></div>`);
    $('np-save').addEventListener('click', async () => {
      const pass = $('np-pass').value;
      if (pass.length < 8) return authError('Password must be at least 8 characters.');
      const { error } = await sb.auth.updateUser({ password: pass });
      if (error) return authError(error.message);
      Main.closeModal();
      FX.toast('✓ Password updated!');
    });
  }

  /* ---------- account ---------- */
  function showAccountModal() {
    if (!user) return showAuthModal('login');
    Main.openModal(`
      <h2>Your Account</h2>
      <p><b>${user.email}</b><br>Streaks &amp; highscores sync automatically on this account.</p>
      <div class="modal-actions" style="flex-direction:column">
        <button class="btn btn-ghost" id="acc-logout" style="width:100%">Log Out</button>
        <button class="btn btn-danger" id="acc-delete" style="width:100%">Delete Account &amp; Data</button>
      </div>
      <p class="auth-fineprint">Deleting your account permanently erases your email, consent record and synced
      game data from our servers (your right to erasure under India's DPDP Act). Questions or requests:
      <a href="privacy-policy.html" target="_blank">Privacy Policy</a>.</p>`);
    $('acc-logout').addEventListener('click', async () => {
      await sb.auth.signOut();
      Main.closeModal();
      FX.toast('Logged out — playing as guest.');
    });
    $('acc-delete').addEventListener('click', confirmDelete);
  }

  function confirmDelete() {
    Main.openModal(`
      <h2 class="lose">Delete account?</h2>
      <p>This permanently erases your account and all synced data from our servers. This cannot be undone.
      Progress saved in this browser is kept.</p>
      <p class="auth-error" id="auth-error" hidden></p>
      <div class="modal-actions">
        <button class="btn btn-danger" id="del-yes">Yes, delete everything</button>
        <button class="btn btn-ghost" onclick="Main.closeModal()">Cancel</button>
      </div>`);
    $('del-yes').addEventListener('click', async () => {
      $('del-yes').disabled = true;
      const { error } = await sb.rpc('delete_account');
      if (error) { $('del-yes').disabled = false; return authError('Could not delete: ' + error.message); }
      await sb.auth.signOut();
      Main.openModal(`
        <h2>Account deleted</h2>
        <p>Your account and synced data have been erased. Thanks for playing — you're welcome back anytime.</p>
        <div class="modal-actions"><button class="btn btn-primary" onclick="Main.closeModal()">OK</button></div>`);
    });
  }

  function renderAccountBtn() {
    const btn = $('btn-account');
    if (!btn) return;
    btn.textContent = user ? '👤✓' : '👤';
    btn.title = user ? `Account: ${user.email}` : 'Log in / Sign up';
    btn.classList.toggle('logged-in', !!user);
  }

  /* ---------- cloud sync ---------- */
  function localData() {
    let daily = {}, scores = {};
    try { daily = JSON.parse(localStorage.getItem('ds_daily') || '{}'); } catch (_) {}
    try { scores = JSON.parse(localStorage.getItem('ds_scores') || '{}'); } catch (_) {}
    return { daily, scores };
  }

  function mergeData(local, remote) {
    // highscores: keep per-difficulty max
    const scores = { ...(remote.scores || {}) };
    for (const k of Object.keys(local.scores || {}))
      scores[k] = Math.max(scores[k] || 0, local.scores[k]);
    // daily streak: trust whichever completed a puzzle more recently
    const l = local.daily || {}, rDone = remote.last_done || '', lDone = l.lastDone || '';
    let lastDone, streak;
    if (lDone === rDone) { lastDone = lDone; streak = Math.max(l.streak || 0, remote.streak || 0); }
    else if (lDone > rDone) { lastDone = lDone; streak = l.streak || 0; }
    else { lastDone = rDone; streak = remote.streak || 0; }
    const best = Math.max(l.best || 0, remote.daily_best || 0);
    return { scores, lastDone, streak, best, lastScore: l.lastScore || 0 };
  }

  async function pullAndMerge() {
    if (!sb || !user || syncing) return;
    syncing = true;
    try {
      const { data: row } = await sb.from('player_data').select('*').eq('user_id', user.id).maybeSingle();
      const merged = mergeData(localData(), row || {});
      localStorage.setItem('ds_daily', JSON.stringify({
        lastDone: merged.lastDone || undefined, streak: merged.streak,
        lastScore: merged.lastScore, best: merged.best,
      }));
      localStorage.setItem('ds_scores', JSON.stringify(merged.scores));
      const meta = user.user_metadata || {};
      await sb.from('player_data').upsert({
        user_id: user.id,
        scores: merged.scores, streak: merged.streak,
        last_done: merged.lastDone || null, daily_best: merged.best,
        consent_version: meta.consent_version || CONSENT_VERSION,
        consent_at: meta.consent_at || null,
        age_confirmed: !!meta.age_confirmed,
        updated_at: new Date().toISOString(),
      });
      // refresh menu numbers with the merged data
      try { Main.renderMenuStats(); } catch (_) {}
    } catch (_) { /* sync is best-effort; never break the game */ }
    syncing = false;
  }

  /* push after a win — call from game flow */
  async function pushSync() {
    if (!sb || !user) return;
    const { daily, scores } = localData();
    try {
      await sb.from('player_data').upsert({
        user_id: user.id,
        scores, streak: daily.streak || 0,
        last_done: daily.lastDone || null, daily_best: daily.best || 0,
        updated_at: new Date().toISOString(),
      });
    } catch (_) {}
  }

  document.addEventListener('DOMContentLoaded', () => {
    const btn = $('btn-account');
    if (btn) btn.addEventListener('click', () => { GameAudio.play('click'); showAccountModal(); });
    init();
  });

  return { showAuthModal, showAccountModal, pushSync, get user() { return user; } };
})();
