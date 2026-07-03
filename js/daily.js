/* Daily challenge: seeded by UTC date → identical puzzle for everyone.
   Streak + completion state live in localStorage. */
const Daily = (() => {
  function todayKey() {
    const d = new Date();
    // UTC so "today's puzzle" flips at the same moment worldwide
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }

  function seedFor(dateKey) { return 'daily:' + dateKey; }

  // Difficulty rotates through the week (UTC): gentle start, spicy weekend.
  const WEEK_DIFF = ['medium', 'easy', 'medium', 'medium', 'hard', 'hard', 'expert']; // Sun..Sat
  function difficultyFor(dateKey) {
    const d = new Date(dateKey + 'T00:00:00Z');
    return WEEK_DIFF[d.getUTCDay()];
  }

  function getState() {
    try { return JSON.parse(localStorage.getItem('ds_daily') || '{}'); }
    catch (_) { return {}; }
  }
  function setState(s) { localStorage.setItem('ds_daily', JSON.stringify(s)); }

  function isDoneToday() { return getState().lastDone === todayKey(); }

  function currentStreak() {
    const s = getState();
    if (!s.lastDone || !s.streak) return 0;
    const last = new Date(s.lastDone + 'T00:00:00Z');
    const today = new Date(todayKey() + 'T00:00:00Z');
    const diffDays = Math.round((today - last) / 86400000);
    // streak survives if last completion was today or yesterday
    return diffDays <= 1 ? s.streak : 0;
  }

  function markDone(score) {
    const s = getState();
    const today = todayKey();
    if (s.lastDone === today) return s.streak; // already counted
    const streak = currentStreak() + 1;
    setState({ lastDone: today, streak, lastScore: score, best: Math.max(score, s.best || 0) });
    return streak;
  }

  return { todayKey, seedFor, difficultyFor, isDoneToday, currentStreak, markDone };
})();
