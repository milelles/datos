import { mulberry32, randRange, randInt, weightedPick, seedFromString } from "./rng.js";

// ---------------------------------------------------------------------
// Constantes de diseño (todo ajustable acá para probar el "feel")
// ---------------------------------------------------------------------
const PPM = 50; // píxeles por metro (para mostrar altura en metros)
const GRAVITY = 2600; // px/s^2

const JUMP_VY_MIN = 950; // px/s, tap corto
const JUMP_VY_MAX = 1500; // px/s, carga completa
const JUMP_VX_MIN = 230; // px/s horizontal, tap corto
const JUMP_VX_MAX = 720; // px/s horizontal, carga completa
const CHARGE_MS_MAX = 550; // ms para llegar a carga completa

const PLAYER_W = 34;
const PLAYER_H = 46;

const CAMERA_ANCHOR_FRAC = 0.6; // el jugador vive al 60% de la altura del canvas
const CAMERA_SMOOTH = 6; // más alto = cámara más "pegada" al jugador
const DEATH_MARGIN_PX = 340; // cuánto puede caer por debajo de cámara antes de morir

const WAVE_START_DELAY_S = 3.5;
const WAVE_BASE_SPEED = 26; // px/s
const WAVE_SPEED_PER_METER = 0.6; // acelera con la altura alcanzada
const WAVE_MAX_SPEED = 260;

const PLATFORM_H = 16;
const MOVING_SPEED_RANGE = [60, 140];
const BREAK_DELAY_S = 0.32;
const SINK_SPEED = 70;

// Biomas / dificultad por altura (metros)
const BIOMES = [
  { minAlt: 0, name: "praderas", sky: ["#8fd3ff", "#eaffea"], types: { normal: 1 } },
  { minAlt: 60, name: "nubes", sky: ["#5fb4ff", "#dff3ff"], types: { normal: 0.7, moving: 0.3 } },
  { minAlt: 160, name: "hielo", sky: ["#7d8fff", "#dfe8ff"], types: { normal: 0.45, moving: 0.3, breakable: 0.25 } },
  { minAlt: 300, name: "cumbres", sky: ["#4a5bd6", "#c9d1ff"], types: { normal: 0.3, moving: 0.3, breakable: 0.25, sinking: 0.15 } },
  { minAlt: 460, name: "lava", sky: ["#3a1c46", "#ff6a3d"], types: { normal: 0.2, moving: 0.25, breakable: 0.25, sinking: 0.15, spikes: 0.15 } },
];

function biomeFor(altitudeM) {
  let b = BIOMES[0];
  for (const cand of BIOMES) if (altitudeM >= cand.minAlt) b = cand;
  return b;
}

function lerpColor(a, b, t) {
  const pa = hexToRgb(a), pb = hexToRgb(b);
  const r = Math.round(pa.r + (pb.r - pa.r) * t);
  const g = Math.round(pa.g + (pb.g - pa.g) * t);
  const bl = Math.round(pa.b + (pb.b - pa.b) * t);
  return `rgb(${r},${g},${bl})`;
}
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

// ---------------------------------------------------------------------
// Setup canvas
// ---------------------------------------------------------------------
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
let cw = 0, ch = 0, dpr = 1;

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  cw = window.innerWidth;
  ch = window.innerHeight;
  canvas.width = Math.floor(cw * dpr);
  canvas.height = Math.floor(ch * dpr);
  canvas.style.width = cw + "px";
  canvas.style.height = ch + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener("resize", resize);
resize();

// ---------------------------------------------------------------------
// Semilla: la torre entera depende de esto. Compartir el link con
// ?seed=XYZ es, en miniatura, lo que hará la sala: todos generan
// exactamente el mismo patrón de plataformas.
// ---------------------------------------------------------------------
function getSeedFromUrl() {
  const params = new URLSearchParams(location.search);
  const s = params.get("seed");
  if (!s) return null;
  return /^\d+$/.test(s) ? Number(s) >>> 0 : seedFromString(s);
}

let currentSeedLabel;
let currentSeedNum;

function pickSeed(forceNew) {
  const fromUrl = forceNew ? null : getSeedFromUrl();
  if (fromUrl !== null) {
    currentSeedNum = fromUrl;
    currentSeedLabel = new URLSearchParams(location.search).get("seed");
  } else {
    currentSeedNum = (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0;
    currentSeedLabel = String(currentSeedNum);
    const url = new URL(location.href);
    url.searchParams.set("seed", currentSeedLabel);
    history.replaceState(null, "", url);
  }
  document.getElementById("seed-value").textContent = currentSeedLabel;
}

document.getElementById("copy-seed").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    const btn = document.getElementById("copy-seed");
    const old = btn.textContent;
    btn.textContent = "copiado!";
    setTimeout(() => (btn.textContent = old), 1200);
  } catch {
    /* clipboard no disponible, no pasa nada grave */
  }
});

// ---------------------------------------------------------------------
// Generación de plataformas
// ---------------------------------------------------------------------
class PlatformGen {
  constructor(seed) {
    this.rng = mulberry32(seed);
    this.platforms = [];
    this.lastAltitudeM = 0;
    this.lastX = null;
  }

  reset() {
    this.rng = mulberry32(currentSeedNum);
    this.platforms = [];
    this.lastAltitudeM = 0;
    this.lastX = null;
    this._seedGround();
  }

  _seedGround() {
    const groundW = Math.min(220, cw * 0.5);
    const x = cw / 2;
    const p = this._makePlatform(0, x, groundW, "normal");
    this.platforms.push(p);
    this.lastAltitudeM = 0;
    this.lastX = x;
  }

  _makePlatform(altitudeM, x, w, type) {
    return {
      id: Math.random(),
      altitudeM,
      worldY: -altitudeM * PPM,
      x,
      w,
      type,
      state: "idle", // idle | breaking | gone
      timer: 0,
      moveDir: this.rng() < 0.5 ? -1 : 1,
      moveSpeed: randRange(this.rng, MOVING_SPEED_RANGE[0], MOVING_SPEED_RANGE[1]),
      moveRange: randRange(this.rng, 40, 110),
      baseX: x,
    };
  }

  ensureGeneratedTo(altitudeMTarget) {
    while (this.lastAltitudeM < altitudeMTarget) {
      const biome = biomeFor(this.lastAltitudeM);
      const difficulty = Math.min(1, this.lastAltitudeM / 500);
      const minGap = 1.6 + difficulty * 0.6; // metros
      const maxGap = 3.4 + difficulty * 1.6;
      const gap = randRange(this.rng, minGap, maxGap);
      const altitudeM = this.lastAltitudeM + gap;

      const w = randRange(this.rng, 70, 130) - difficulty * 20;
      const maxDx = 90 + difficulty * 120; // qué tan lejos en X puede aparecer la próxima
      const margin = w / 2 + 12;
      let x = this.lastX + randRange(this.rng, -maxDx, maxDx);
      x = Math.max(margin, Math.min(cw - margin, x));

      const type = weightedPick(this.rng, Object.entries(biome.types));
      const p = this._makePlatform(altitudeM, x, Math.max(46, w), type);
      this.platforms.push(p);
      this.lastAltitudeM = altitudeM;
      this.lastX = x;
    }
  }

  cullBelow(worldYLimit) {
    // worldY más grande = más abajo. Sacamos plataformas muy por debajo
    // del punto visible para no acumular memoria en una torre infinita.
    while (this.platforms.length && this.platforms[0].worldY > worldYLimit) {
      this.platforms.shift();
    }
  }
}

// ---------------------------------------------------------------------
// Jugador
// ---------------------------------------------------------------------
class Player {
  reset() {
    this.x = cw / 2;
    this.worldY = -PLAYER_H / 2 - PLATFORM_H / 2;
    this.vx = 0;
    this.vy = 0;
    this.grounded = true;
    this.groundedPlatform = null;
    this.altitudeM = 0;
    this.bestAltitudeM = 0;
    this.squash = 1;
    this.facing = 1;
    this.dead = false;
  }
}

// ---------------------------------------------------------------------
// Input: tap/hold para saltar, dirección por lado tocado o flechas
// ---------------------------------------------------------------------
class InputController {
  constructor() {
    this.charging = false;
    this.chargeStart = 0;
    this.direction = 0; // -1, 0, 1
    this.keyDir = 0;
    this.jumpRequested = null; // {charge, direction} cuando se suelta

    canvas.addEventListener("pointerdown", (e) => this._down(e.clientX));
    canvas.addEventListener("pointerup", () => this._up());
    canvas.addEventListener("pointercancel", () => this._up());

    window.addEventListener("keydown", (e) => {
      if (e.code === "ArrowLeft") this.keyDir = -1;
      else if (e.code === "ArrowRight") this.keyDir = 1;
      else if (e.code === "Space" && !this.charging) this._down(null);
    });
    window.addEventListener("keyup", (e) => {
      if (e.code === "ArrowLeft" && this.keyDir === -1) this.keyDir = 0;
      else if (e.code === "ArrowRight" && this.keyDir === 1) this.keyDir = 0;
      else if (e.code === "Space") this._up();
    });
  }

  _down(clientX) {
    if (this.charging) return;
    this.charging = true;
    this.chargeStart = performance.now();
    if (clientX === null) {
      this.direction = this.keyDir;
    } else {
      const third = cw / 3;
      if (clientX < third) this.direction = -1;
      else if (clientX > third * 2) this.direction = 1;
      else this.direction = 0;
    }
  }

  _up() {
    if (!this.charging) return;
    this.charging = false;
    const heldMs = performance.now() - this.chargeStart;
    const charge = Math.max(0, Math.min(1, heldMs / CHARGE_MS_MAX));
    const dir = this.keyDir !== 0 ? this.keyDir : this.direction;
    this.jumpRequested = { charge, direction: dir };
  }

  currentCharge() {
    if (!this.charging) return 0;
    const heldMs = performance.now() - this.chargeStart;
    return Math.max(0, Math.min(1, heldMs / CHARGE_MS_MAX));
  }

  consumeJump() {
    const j = this.jumpRequested;
    this.jumpRequested = null;
    return j;
  }
}

// ---------------------------------------------------------------------
// Juego
// ---------------------------------------------------------------------
class Game {
  constructor() {
    this.gen = new PlatformGen(0);
    this.player = new Player();
    this.input = new InputController();
    this.cameraTopWorldY = 0;
    this.waveWorldY = 0;
    this.elapsed = 0;
    this.running = false;
    this.lastTime = performance.now();
    this.notices = []; // notificaciones tipo "X llegó a Ym" (placeholder multijugador)

    document.getElementById("start-btn").addEventListener("click", () => this.start(false));
    document.getElementById("retry-btn").addEventListener("click", () => this.start(false));
    document.getElementById("new-seed-btn").addEventListener("click", () => this.start(true));

    this.bestKey = "subida_infinita_best_altitude";
    this.player.reset(); // asegura campos válidos para el render previo a "Jugar"
    requestAnimationFrame((t) => this.loop(t));
  }

  start(forceNewSeed = true) {
    pickSeed(forceNewSeed);
    this.gen.reset();
    this.player.reset();
    this.player.bestAltitudeM = Number(localStorage.getItem(this.bestKey) || 0);
    this.cameraTopWorldY = this.player.worldY - ch * CAMERA_ANCHOR_FRAC;
    this.waveWorldY = 500;
    this.elapsed = 0;
    this.running = true;
    document.getElementById("start-screen").classList.add("hidden");
    document.getElementById("game-over-screen").classList.add("hidden");
  }

  gameOver() {
    if (!this.running) return;
    this.running = false;
    const alt = Math.floor(this.player.altitudeM);
    const best = Math.max(alt, Number(localStorage.getItem(this.bestKey) || 0));
    localStorage.setItem(this.bestKey, String(best));
    document.getElementById("final-altitude").textContent = `Llegaste a ${alt}m`;
    document.getElementById("best-altitude-msg").textContent =
      alt >= best ? "¡Nuevo récord!" : `Tu mejor marca: ${best}m`;
    document.getElementById("game-over-screen").classList.remove("hidden");
  }

  update(dt) {
    if (!this.running) return;
    this.elapsed += dt;

    const p = this.player;
    const gen = this.gen;

    // -- salto --
    const jump = this.input.consumeJump();
    if (jump && p.grounded) {
      const vy = JUMP_VY_MIN + jump.charge * (JUMP_VY_MAX - JUMP_VY_MIN);
      const vx = jump.direction * (JUMP_VX_MIN + jump.charge * (JUMP_VX_MAX - JUMP_VX_MIN));
      p.vy = -vy;
      p.vx = vx;
      p.grounded = false;
      p.groundedPlatform = null;
      p.squash = 1.35;
      if (jump.direction !== 0) p.facing = jump.direction;
    }

    // -- física --
    if (!p.grounded) {
      p.vy += GRAVITY * dt;
      p.worldY += p.vy * dt;
      p.x += p.vx * dt;
      p.x = Math.max(PLAYER_W / 2, Math.min(cw - PLAYER_W / 2, p.x));
    } else if (p.groundedPlatform) {
      const gp = p.groundedPlatform;
      if (gp.state === "gone") {
        p.grounded = false;
        p.groundedPlatform = null;
      } else {
        p.x += (gp.x - gp.prevX || 0);
        p.worldY = gp.worldY - PLAYER_H / 2 - PLATFORM_H / 2;
      }
    }

    p.squash += (1 - p.squash) * Math.min(1, dt * 10);

    // -- altitud --
    p.altitudeM = Math.max(p.altitudeM, -p.worldY / PPM);
    if (p.altitudeM > p.bestAltitudeM) p.bestAltitudeM = p.altitudeM;

    // -- generar/limpiar plataformas --
    gen.ensureGeneratedTo(p.altitudeM + ch / PPM + 6);

    // -- actualizar plataformas (movimiento, rotura, hundimiento) --
    for (const plat of gen.platforms) {
      plat.prevX = plat.x;
      if (plat.state === "gone") continue;
      if (plat.type === "moving") {
        const t = this.elapsed * (plat.moveSpeed / 60) * plat.moveDir;
        plat.x = plat.baseX + Math.sin(t) * plat.moveRange;
      }
      if (plat.type === "breakable" && plat.state === "breaking") {
        plat.timer += dt;
        if (plat.timer >= BREAK_DELAY_S) plat.state = "gone";
      }
      if (plat.type === "sinking" && plat.state === "sinking") {
        plat.worldY += SINK_SPEED * dt;
        if (plat.worldY - -plat.altitudeM * PPM > 260) plat.state = "gone";
      }
    }

    // -- colisiones (solo cuando cae) --
    if (!p.grounded && p.vy > 0) {
      for (const plat of gen.platforms) {
        if (plat.state === "gone") continue;
        const platTop = plat.worldY - PLATFORM_H / 2;
        const feetPrev = p.worldY + PLAYER_H / 2 - p.vy * dt;
        const feetNow = p.worldY + PLAYER_H / 2;
        const withinX = Math.abs(p.x - plat.x) < plat.w / 2 + PLAYER_W / 2 - 4;
        if (withinX && feetPrev <= platTop && feetNow >= platTop) {
          if (plat.type === "spikes") {
            this.gameOver();
            return;
          }
          p.worldY = plat.worldY - PLAYER_H / 2 - PLATFORM_H / 2;
          p.vy = 0;
          p.vx = 0;
          p.grounded = true;
          p.groundedPlatform = plat;
          p.squash = 0.72;
          if (plat.type === "breakable" && plat.state === "idle") plat.state = "breaking";
          if (plat.type === "sinking" && plat.state === "idle") plat.state = "sinking";
          break;
        }
      }
    }

    // -- cámara (solo sube) --
    const desiredTop = p.worldY - ch * CAMERA_ANCHOR_FRAC;
    if (desiredTop < this.cameraTopWorldY) {
      this.cameraTopWorldY += (desiredTop - this.cameraTopWorldY) * Math.min(1, dt * CAMERA_SMOOTH);
    }

    // -- ola --
    if (this.elapsed > WAVE_START_DELAY_S) {
      const speed = Math.min(WAVE_MAX_SPEED, WAVE_BASE_SPEED + p.bestAltitudeM * WAVE_SPEED_PER_METER);
      this.waveWorldY -= speed * dt;
    }
    gen.cullBelow(this.waveWorldY + 400);

    // -- condiciones de muerte --
    const screenBottomWorldY = this.cameraTopWorldY + ch;
    if (p.worldY > screenBottomWorldY + DEATH_MARGIN_PX) {
      this.gameOver();
      return;
    }
    if (p.worldY >= this.waveWorldY) {
      this.gameOver();
      return;
    }
  }

  render() {
    const p = this.player;
    const biome = biomeFor(p.altitudeM);
    const idx = BIOMES.indexOf(biome);
    const next = BIOMES[idx + 1];
    let skyTop = biome.sky[0], skyBottom = biome.sky[1];
    if (next) {
      const span = next.minAlt - biome.minAlt;
      const t = Math.max(0, Math.min(1, (p.altitudeM - biome.minAlt) / span));
      skyTop = lerpColor(biome.sky[0], next.sky[0], t);
      skyBottom = lerpColor(biome.sky[1], next.sky[1], t);
    }
    const grad = ctx.createLinearGradient(0, 0, 0, ch);
    grad.addColorStop(0, skyTop);
    grad.addColorStop(1, skyBottom);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, cw, ch);

    const toScreenY = (worldY) => worldY - this.cameraTopWorldY;

    // plataformas
    for (const plat of this.gen.platforms) {
      if (plat.state === "gone") continue;
      const sy = toScreenY(plat.worldY);
      if (sy < -40 || sy > ch + 40) continue;
      this._drawPlatform(plat, sy);
    }

    // jugador
    this._drawPlayer(toScreenY(p.worldY));

    // ola
    const waveSy = toScreenY(this.waveWorldY);
    if (waveSy < ch) {
      const waveGrad = ctx.createLinearGradient(0, Math.max(0, waveSy), 0, ch);
      waveGrad.addColorStop(0, "rgba(255,90,90,0.85)");
      waveGrad.addColorStop(1, "rgba(120,0,20,0.95)");
      ctx.fillStyle = waveGrad;
      ctx.fillRect(0, Math.max(0, waveSy), cw, ch - Math.max(0, waveSy));
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.fillRect(0, Math.max(0, waveSy) - 3, cw, 3);
    }

    // HUD dinámico
    document.getElementById("alt-current").textContent = Math.floor(p.altitudeM) + "";
    document.getElementById("alt-best").textContent = "mejor: " + Math.floor(p.bestAltitudeM) + "m";
    document.getElementById("charge-bar").style.width = this.input.currentCharge() * 100 + "%";
  }

  _drawPlatform(plat, sy) {
    ctx.save();
    ctx.translate(plat.x, sy);
    const w = plat.w;
    let color = "#4b3a2f";
    if (plat.type === "moving") color = "#3d6fbf";
    if (plat.type === "breakable") color = plat.state === "breaking" ? "#a8552f" : "#8a5a3a";
    if (plat.type === "sinking") color = "#3f6b5a";
    if (plat.type === "spikes") color = "#7a1f2b";

    ctx.fillStyle = color;
    roundRect(ctx, -w / 2, -PLATFORM_H / 2, w, PLATFORM_H, 6);
    ctx.fill();

    if (plat.type === "spikes") {
      ctx.fillStyle = "#e6e6e6";
      const n = Math.max(3, Math.floor(w / 18));
      for (let i = 0; i < n; i++) {
        const sx = -w / 2 + (i + 0.5) * (w / n);
        ctx.beginPath();
        ctx.moveTo(sx - 7, -PLATFORM_H / 2);
        ctx.lineTo(sx + 7, -PLATFORM_H / 2);
        ctx.lineTo(sx, -PLATFORM_H / 2 - 14);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
  }

  _drawPlayer(sy) {
    const p = this.player;
    ctx.save();
    ctx.translate(p.x, sy);
    const sx = 1 / p.squash;
    const syScale = p.squash;
    ctx.scale(sx, syScale);

    // cuerpo
    ctx.fillStyle = "#ffd166";
    roundRect(ctx, -PLAYER_W / 2, -PLAYER_H / 2, PLAYER_W, PLAYER_H, 10);
    ctx.fill();

    // cara con esfuerzo si está en el aire
    const inAir = !p.grounded;
    ctx.fillStyle = "#2b2b2b";
    const eyeY = -PLAYER_H / 2 + 16;
    const eyeDx = p.facing * 2;
    ctx.beginPath();
    ctx.ellipse(-7 + eyeDx, eyeY, inAir ? 2.6 : 3.2, inAir ? 3.6 : 3.2, 0, 0, Math.PI * 2);
    ctx.ellipse(7 + eyeDx, eyeY, inAir ? 2.6 : 3.2, inAir ? 3.6 : 3.2, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#2b2b2b";
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (inAir) {
      ctx.arc(0, eyeY + 12, 4, Math.PI * 0.15, Math.PI * 0.85);
    } else {
      ctx.moveTo(-5, eyeY + 12);
      ctx.lineTo(5, eyeY + 12);
    }
    ctx.stroke();

    ctx.restore();
  }

  loop(time) {
    const dt = Math.min(0.033, (time - this.lastTime) / 1000);
    this.lastTime = time;
    this.update(dt);
    this.render();
    requestAnimationFrame((t) => this.loop(t));
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

pickSeed(false);
new Game();
