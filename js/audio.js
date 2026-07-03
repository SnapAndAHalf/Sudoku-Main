/* All audio is synthesized with the Web Audio API — zero asset files.
   SFX + a soft generative pentatonic music loop. */
const GameAudio = (() => {
  let ctx = null;
  let sfxOn = JSON.parse(localStorage.getItem('ds_sfx') ?? 'true');
  let musicOn = JSON.parse(localStorage.getItem('ds_music') ?? 'true');
  let musicTimer = null;
  let musicGain = null;

  function ac() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone({ freq = 440, type = 'sine', dur = 0.15, vol = 0.2, delay = 0, slide = 0, out = null }) {
    const c = ac();
    const t0 = c.currentTime + delay;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(out || c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  const sfx = {
    click()   { tone({ freq: 660, type: 'triangle', dur: .06, vol: .12 }); },
    select()  { tone({ freq: 520, type: 'triangle', dur: .07, vol: .12 }); },
    place() {
      tone({ freq: 620, type: 'sine', dur: .1, vol: .18 });
      tone({ freq: 930, type: 'sine', dur: .12, vol: .1, delay: .04 });
    },
    note()    { tone({ freq: 480, type: 'sine', dur: .06, vol: .1 }); },
    erase()   { tone({ freq: 300, type: 'triangle', dur: .09, vol: .12, slide: -120 }); },
    wrong() {
      tone({ freq: 220, type: 'sawtooth', dur: .22, vol: .16, slide: -80 });
      tone({ freq: 160, type: 'sawtooth', dur: .3, vol: .12, delay: .08, slide: -60 });
    },
    line() { // row/col complete — rising arpeggio
      [523, 659, 784].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: .18, vol: .18, delay: i * .07 }));
    },
    box() { // 3x3 box complete — brighter arpeggio
      [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: .2, vol: .18, delay: i * .06 }));
    },
    exhaust() { // one digit fully placed
      [784, 988].forEach((f, i) => tone({ freq: f, type: 'sine', dur: .16, vol: .16, delay: i * .09 }));
    },
    power() {
      tone({ freq: 440, type: 'square', dur: .1, vol: .1 });
      tone({ freq: 880, type: 'square', dur: .16, vol: .1, delay: .07 });
      tone({ freq: 1320, type: 'sine', dur: .22, vol: .12, delay: .13 });
    },
    heart()   { tone({ freq: 660, type: 'sine', dur: .3, vol: .16, slide: 220 }); },
    win() {
      [523, 659, 784, 1047, 1319, 1568].forEach((f, i) =>
        tone({ freq: f, type: 'triangle', dur: .3, vol: .2, delay: i * .11 }));
      tone({ freq: 2093, type: 'sine', dur: .7, vol: .14, delay: .66 });
    },
    lose() {
      [392, 349, 311, 262].forEach((f, i) =>
        tone({ freq: f, type: 'triangle', dur: .35, vol: .18, delay: i * .18 }));
    },
    join()    { [523, 784].forEach((f, i) => tone({ freq: f, type: 'sine', dur: .15, vol: .15, delay: i * .1 })); },
  };

  function play(name) {
    if (!sfxOn || !sfx[name]) return;
    try { sfx[name](); } catch (_) { /* audio blocked until user gesture */ }
  }

  /* --- generative background music: slow pentatonic plucks over a pad --- */
  const SCALE = [220, 261.63, 293.66, 329.63, 392, 440, 523.25, 587.33];
  function scheduleMusicBar() {
    if (!musicOn || !musicGain) return;
    const c = ac();
    const bar = 3.2;
    // soft pad (root + fifth)
    tone({ freq: 110, type: 'sine', dur: bar, vol: .05, out: musicGain });
    tone({ freq: 165, type: 'sine', dur: bar, vol: .03, out: musicGain });
    // 3–5 gentle plucks at random scale degrees
    const n = 3 + Math.floor(Math.random() * 3);
    for (let k = 0; k < n; k++) {
      const f = SCALE[Math.floor(Math.random() * SCALE.length)];
      tone({ freq: f, type: 'triangle', dur: .9, vol: .055, delay: Math.random() * (bar - 1), out: musicGain });
    }
    musicTimer = setTimeout(scheduleMusicBar, bar * 1000);
  }

  function startMusic() {
    if (!musicOn || musicTimer) return;
    try {
      const c = ac();
      if (!musicGain) {
        musicGain = c.createGain();
        musicGain.gain.value = 0.9;
        musicGain.connect(c.destination);
      }
      scheduleMusicBar();
    } catch (_) {}
  }
  function stopMusic() {
    clearTimeout(musicTimer);
    musicTimer = null;
  }

  return {
    play,
    startMusic, stopMusic,
    get sfxOn() { return sfxOn; },
    get musicOn() { return musicOn; },
    toggleSfx() { sfxOn = !sfxOn; localStorage.setItem('ds_sfx', sfxOn); return sfxOn; },
    toggleMusic() {
      musicOn = !musicOn;
      localStorage.setItem('ds_music', musicOn);
      musicOn ? startMusic() : stopMusic();
      return musicOn;
    },
    unlock() { try { ac(); } catch (_) {} },
  };
})();
