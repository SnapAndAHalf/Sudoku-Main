/* Visual effects: confetti canvas, toasts, floating point popups. */
const FX = (() => {
  const canvas = document.getElementById('fx-canvas');
  const cx = canvas.getContext('2d');
  let particles = [];
  let raf = null;

  function resize() {
    canvas.width = innerWidth * devicePixelRatio;
    canvas.height = innerHeight * devicePixelRatio;
    cx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  }
  addEventListener('resize', resize);
  resize();

  const COLORS = ['#e8543f', '#e3a51f', '#2b7a6c', '#26221a', '#f3ecdd', '#e0454f'];

  function burst(x, y, count = 30, spread = 6) {
    for (let i = 0; i < count; i++) {
      particles.push({
        x, y,
        vx: (Math.random() - .5) * spread * 2,
        vy: -Math.random() * spread - 2,
        size: 4 + Math.random() * 6,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        rot: Math.random() * Math.PI,
        vr: (Math.random() - .5) * .3,
        life: 1,
        decay: .012 + Math.random() * .01,
      });
    }
    if (!raf) loop();
  }

  function confettiRain() {
    for (let i = 0; i < 120; i++) {
      particles.push({
        x: Math.random() * innerWidth,
        y: -20 - Math.random() * innerHeight * .5,
        vx: (Math.random() - .5) * 2,
        vy: 2 + Math.random() * 3,
        size: 5 + Math.random() * 7,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        rot: Math.random() * Math.PI,
        vr: (Math.random() - .5) * .25,
        life: 1,
        decay: .004,
      });
    }
    if (!raf) loop();
  }

  function loop() {
    raf = requestAnimationFrame(loop);
    cx.clearRect(0, 0, innerWidth, innerHeight);
    particles = particles.filter(p => p.life > 0 && p.y < innerHeight + 30);
    if (particles.length === 0) { cancelAnimationFrame(raf); raf = null; return; }
    for (const p of particles) {
      p.x += p.vx; p.y += p.vy;
      p.vy += .12; p.rot += p.vr; p.life -= p.decay;
      cx.save();
      cx.translate(p.x, p.y);
      cx.rotate(p.rot);
      cx.globalAlpha = Math.max(0, p.life);
      cx.fillStyle = p.color;
      cx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * .6);
      cx.restore();
    }
  }

  function toast(text, kind = '') {
    const layer = document.getElementById('toast-layer');
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.textContent = text;
    layer.appendChild(el);
    setTimeout(() => el.remove(), 2300);
  }

  function floatPoints(x, y, text) {
    const el = document.createElement('div');
    el.className = 'float-points';
    el.textContent = text;
    el.style.left = (x - 20) + 'px';
    el.style.top = (y - 30) + 'px';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1150);
  }

  function shake() {
    document.body.classList.remove('shake');
    void document.body.offsetWidth; // restart animation
    document.body.classList.add('shake');
  }

  return { burst, confettiRain, toast, floatPoints, shake };
})();
