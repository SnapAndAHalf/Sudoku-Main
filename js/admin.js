/* Admin dashboard: users, sessions (daily/weekly/monthly/yearly), feedback inbox.
   Access is enforced server-side: every stats RPC and the feedback table
   require is_admin() — this page just renders what the server allows. */
(() => {
  const SUPABASE_URL = 'https://ktqxaixifvuhdsnhabfo.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_lR1H8iHOQsHXsarCCbUc8A_RwqYsekI';

  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  const $ = (id) => document.getElementById(id);

  let period = 'daily';
  let fbNewOnly = false;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function showPanel(id) {
    for (const p of ['admin-loading', 'admin-login', 'admin-denied']) $(p).hidden = p !== id;
    $('admin-dash').hidden = true;
    $('btn-refresh').hidden = $('btn-admin-logout').hidden = true;
  }
  function showDash() {
    for (const p of ['admin-loading', 'admin-login', 'admin-denied']) $(p).hidden = true;
    $('admin-dash').hidden = false;
    $('btn-refresh').hidden = $('btn-admin-logout').hidden = false;
  }

  /* ---------- boot ---------- */
  async function boot() {
    const { data } = await sb.auth.getSession();
    if (!data.session) return showPanel('admin-login');
    const { data: isAdmin, error } = await sb.rpc('is_admin');
    if (error || isAdmin !== true) return showPanel('admin-denied');
    showDash();
    loadAll();
  }

  async function login() {
    const err = $('adm-error');
    err.hidden = true;
    $('adm-login-btn').disabled = true;
    const { error } = await sb.auth.signInWithPassword({
      email: $('adm-email').value.trim(),
      password: $('adm-pass').value,
    });
    $('adm-login-btn').disabled = false;
    if (error) {
      err.textContent = error.message === 'Invalid login credentials' ? 'Wrong email or password.' : error.message;
      err.hidden = false;
      return;
    }
    showPanel('admin-loading');
    boot();
  }

  function loadAll() {
    loadStats();
    loadSeries();
    loadFeedback();
  }

  /* ---------- stat cards ---------- */
  async function loadStats() {
    const { data: s, error } = await sb.rpc('admin_stats');
    if (error || !s) { $('stat-grid').innerHTML = '<div class="admin-panel">Could not load stats.</div>'; return; }

    const finishRate = s.total_sessions ? Math.round(100 * s.finished_sessions / s.total_sessions) : 0;
    const winRate = s.finished_sessions ? Math.round(100 * s.wins / s.finished_sessions) : 0;
    const avgMin = Math.floor((s.avg_duration || 0) / 60);
    const avgSec = String((s.avg_duration || 0) % 60).padStart(2, '0');

    const cards = [
      ['👥', s.total_users, 'Registered users', `+${s.users_today} today · +${s.users_7d} this week · +${s.users_30d} this month`],
      ['🎮', s.total_sessions, 'Sessions played', `${s.sessions_today} today · ${s.sessions_7d} this week · ${s.sessions_30d} this month`],
      ['🏁', `${finishRate}%`, 'Sessions finished', `${s.finished_sessions} finished · ${winRate}% of those were wins`],
      ['⏱️', `${avgMin}:${avgSec}`, 'Avg finished game', 'minutes : seconds'],
      ['🔥', s.active_players_7d, 'Active players (7d)', 'signed-in players who started a game'],
      ['💬', s.feedback_total, 'Feedback received', `${s.feedback_new} unread`],
    ];
    $('stat-grid').innerHTML = cards.map(([ico, big, label, sub]) => `
      <div class="stat-card">
        <div class="stat-ico">${ico}</div>
        <div class="stat-big">${esc(big)}</div>
        <div class="stat-label">${esc(label)}</div>
        <div class="stat-sub">${esc(sub)}</div>
      </div>`).join('');

    // breakdowns
    renderBreakdown('bd-mode', s.by_mode, { single: 'Singleplayer', daily: 'Daily challenge', multi: 'Multiplayer' });
    renderBreakdown('bd-diff', s.by_difficulty, {});

    const badge = $('fb-badge');
    badge.hidden = !s.feedback_new;
    badge.textContent = s.feedback_new ? `${s.feedback_new} new` : '';
  }

  function renderBreakdown(elId, obj, labels) {
    const entries = Object.entries(obj || {}).sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((t, [, n]) => t + n, 0) || 1;
    $(elId).innerHTML = entries.length
      ? entries.map(([k, n]) => `
        <li>
          <span class="bd-name">${esc(labels[k] || k)}</span>
          <span class="bd-bar"><span style="width:${Math.round(100 * n / total)}%"></span></span>
          <span class="bd-num">${n}</span>
        </li>`).join('')
      : '<li><span class="bd-name">No data yet</span></li>';
  }

  /* ---------- sessions chart ---------- */
  async function loadSeries() {
    $('chart').textContent = 'Loading…';
    const { data, error } = await sb.rpc('admin_sessions_series', { p_period: period });
    if (error) { $('chart').textContent = 'Could not load chart.'; return; }
    if (!data || !data.length) { $('chart').textContent = 'No sessions in this period yet.'; $('chart-note').textContent = ''; return; }

    const max = Math.max(...data.map(r => Number(r.sessions)));
    $('chart').innerHTML = `<div class="chart-bars">` + data.map(r => {
      const h = Math.max(4, Math.round(100 * Number(r.sessions) / max));
      const label = period === 'daily' ? r.bucket.slice(5)        // MM-DD
                  : period === 'weekly' ? r.bucket.slice(5)       // week start MM-DD
                  : r.bucket;                                     // YYYY-MM / YYYY
      return `
        <div class="chart-col" title="${esc(r.bucket)}: ${r.sessions} session(s), ${r.signed_in_players} signed-in player(s)">
          <span class="chart-count">${r.sessions}</span>
          <span class="chart-bar" style="height:${h}%"></span>
          <span class="chart-label">${esc(label)}</span>
        </div>`;
    }).join('') + `</div>`;

    const totals = data.reduce((t, r) => t + Number(r.sessions), 0);
    const span = { daily: 'last 30 days', weekly: 'last 12 weeks', monthly: 'last 12 months', yearly: 'all time' }[period];
    $('chart-note').textContent = `${totals} sessions over the ${span}. Hover a bar for details. Guest sessions are counted; only signed-in players can be told apart.`;
  }

  /* ---------- feedback inbox ---------- */
  async function loadFeedback() {
    const el = $('feedback-list');
    el.textContent = 'Loading…';
    let q = sb.from('feedback').select('*').order('created_at', { ascending: false }).limit(200);
    if (fbNewOnly) q = q.eq('status', 'new');
    const { data, error } = await q;
    if (error) { el.textContent = 'Could not load feedback.'; return; }
    if (!data.length) { el.innerHTML = `<p class="fb-empty">${fbNewOnly ? 'No unread feedback — inbox zero! 🎉' : 'No feedback yet.'}</p>`; return; }

    el.innerHTML = data.map(f => `
      <article class="fb-item ${f.status === 'new' ? 'is-new' : ''}" data-id="${esc(f.id)}">
        <div class="fb-meta">
          <span class="fb-when">${new Date(f.created_at).toLocaleString()}</span>
          <span class="fb-who">${esc(f.email || (f.user_id ? 'account user' : 'guest'))}</span>
          ${f.page && f.page !== '/' ? `<span class="fb-page">${esc(f.page)}</span>` : ''}
          <button class="btn btn-ghost btn-xs fb-toggle">${f.status === 'new' ? 'Mark read' : 'Mark unread'}</button>
        </div>
        <p class="fb-msg">${esc(f.message)}</p>
      </article>`).join('');

    el.querySelectorAll('.fb-toggle').forEach(btn => btn.addEventListener('click', async (e) => {
      const item = e.target.closest('.fb-item');
      const toNew = !item.classList.contains('is-new');
      btn.disabled = true;
      const { error: uerr } = await sb.from('feedback')
        .update({ status: toNew ? 'new' : 'read' })
        .eq('id', item.dataset.id);
      btn.disabled = false;
      if (!uerr) { loadFeedback(); loadStats(); }
    }));
  }

  /* ---------- wiring ---------- */
  document.addEventListener('DOMContentLoaded', () => {
    $('adm-login-btn').addEventListener('click', login);
    $('adm-pass').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });

    document.querySelectorAll('#period-tabs .period-tab').forEach(t =>
      t.addEventListener('click', () => {
        period = t.dataset.period;
        document.querySelectorAll('#period-tabs .period-tab').forEach(x => x.classList.toggle('active', x === t));
        loadSeries();
      }));

    $('fb-filter-all').addEventListener('click', () => {
      fbNewOnly = false;
      $('fb-filter-all').classList.add('active'); $('fb-filter-new').classList.remove('active');
      loadFeedback();
    });
    $('fb-filter-new').addEventListener('click', () => {
      fbNewOnly = true;
      $('fb-filter-new').classList.add('active'); $('fb-filter-all').classList.remove('active');
      loadFeedback();
    });

    $('btn-refresh').addEventListener('click', loadAll);
    $('btn-admin-logout').addEventListener('click', async () => {
      await sb.auth.signOut();
      location.reload();
    });

    boot();
  });
})();
