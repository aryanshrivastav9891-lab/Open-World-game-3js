import { Game } from './Game.js';

// Bootstrap: build the game, then run a fixed-ish timestep render loop.
// dt is clamped so a tab-switch or GC pause can't fling the player across
// the map. A lightweight FPS estimate is fed back for the debug overlay.
const appEl = document.getElementById('app');
const hudEl = document.getElementById('hud');

const game = new Game(appEl, hudEl);

let last = performance.now();
let fpsFrames = 0;
let fpsTime = last;

function loop(now) {
  const dt = Math.min((now - last) / 1000, 0.05); // cap at 50ms (~20fps floor)
  last = now;

  // rolling FPS, refreshed ~4x/sec
  fpsFrames++;
  if (now - fpsTime > 250) {
    game.setFps((fpsFrames * 1000) / (now - fpsTime));
    fpsFrames = 0;
    fpsTime = now;
  }

  try {
    game.update(dt);
  } catch (err) {
    console.error('Game loop error:', err);
  }
  requestAnimationFrame(loop);
}

game
  .init()
  .then(() => {
    last = performance.now();
    requestAnimationFrame(loop);
  })
  .catch((err) => {
    console.error('Failed to start game:', err);
    const s = document.querySelector('.ym-status');
    if (s) s.textContent = 'Failed to start — see console.';
  });
