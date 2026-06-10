// Shared arcade audio: a synthesized chiptune loop + button click blips,
// with two small corner toggles (music / SFX). No audio files needed.
(() => {
  "use strict";

  const MUSIC_KEY = "arcadeMusicOn";
  const SFX_KEY = "arcadeSfxOn";
  const load = (k, def) => { try { const v = localStorage.getItem(k); return v === null ? def : v === "1"; } catch (e) { return def; } };
  const save = (k, on) => { try { localStorage.setItem(k, on ? "1" : "0"); } catch (e) {} };

  let musicOn = load(MUSIC_KEY, true);
  let sfxOn = load(SFX_KEY, true);

  // ---- Web Audio engine ----
  let ctx = null, master = null, musicGain = null, sfxGain = null;
  let musicPlaying = false, loopTimer = null;

  function ensureCtx() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0.55; master.connect(ctx.destination);
    musicGain = ctx.createGain(); musicGain.gain.value = 0.18; musicGain.connect(master);
    sfxGain = ctx.createGain(); sfxGain.gain.value = 0.3; sfxGain.connect(master);
  }
  function resumeCtx() { if (ctx && ctx.state === "suspended") ctx.resume(); }

  function note(freq, time, dur, type, dest, vol) {
    if (!freq || !ctx) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    o.connect(g); g.connect(dest);
    const atk = 0.008, rel = Math.min(0.08, dur * 0.5);
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(vol, time + atk);
    g.gain.setValueAtTime(vol, time + Math.max(atk, dur - rel));
    g.gain.linearRampToValueAtTime(0, time + dur);
    o.start(time); o.stop(time + dur + 0.02);
  }

  // Upbeat I–vi–IV–V (C–Am–F–G) chiptune loop: arpeggiated lead + bass pulse.
  const STEP = 0.15;
  const LEAD = [659, 784, 1047, 784, 659, 880, 1047, 880, 698, 880, 1047, 880, 587, 784, 988, 784];
  const BASS = [131, 0, 131, 0, 110, 0, 110, 0, 87, 0, 87, 0, 98, 0, 98, 0];
  function scheduleLoop() {
    if (!musicPlaying || !ctx) return;
    const start = ctx.currentTime + 0.05;
    for (let i = 0; i < 16; i++) {
      const t = start + i * STEP;
      note(LEAD[i], t, STEP * 0.9, "square", musicGain, 0.5);
      note(BASS[i], t, STEP * 0.9, "triangle", musicGain, 0.7);
    }
    loopTimer = setTimeout(scheduleLoop, 16 * STEP * 1000);
  }
  function startMusic() { if (musicPlaying) return; ensureCtx(); resumeCtx(); if (!ctx) return; musicPlaying = true; scheduleLoop(); }
  function stopMusic() { musicPlaying = false; clearTimeout(loopTimer); }

  function playClick() {
    if (!sfxOn) return;
    ensureCtx(); resumeCtx(); if (!ctx) return;
    const t = ctx.currentTime;
    note(880, t, 0.05, "square", sfxGain, 0.5);
    note(1320, t + 0.03, 0.05, "square", sfxGain, 0.4);
  }

  // ---- Controls UI ----
  const bar = document.createElement("div");
  bar.id = "audioControls";
  const musicBtn = document.createElement("button");
  const sfxBtn = document.createElement("button");
  musicBtn.type = sfxBtn.type = "button";
  musicBtn.className = sfxBtn.className = "audio-btn";
  bar.appendChild(musicBtn);
  bar.appendChild(sfxBtn);

  function paintBtns() {
    musicBtn.textContent = musicOn ? "🎵" : "🔇";
    musicBtn.title = "Music: " + (musicOn ? "on" : "off");
    musicBtn.classList.toggle("off", !musicOn);
    sfxBtn.textContent = sfxOn ? "🔊" : "🔈";
    sfxBtn.title = "Click sounds: " + (sfxOn ? "on" : "off");
    sfxBtn.classList.toggle("off", !sfxOn);
  }

  const style = document.createElement("style");
  style.textContent =
    "#audioControls{position:fixed;top:12px;right:12px;z-index:9999;display:flex;gap:8px;}" +
    "#audioControls .audio-btn{font-size:16px;width:38px;height:38px;line-height:1;cursor:pointer;" +
    "border-radius:10px;color:#eaf0ff;background:rgba(0,0,20,0.65);border:2px solid rgba(120,160,255,0.5);" +
    "box-shadow:0 0 12px rgba(60,120,255,0.4);display:flex;align-items:center;justify-content:center;" +
    "transition:box-shadow .15s ease,opacity .15s ease,transform .08s ease;}" +
    "#audioControls .audio-btn:hover{box-shadow:0 0 18px rgba(90,150,255,0.7);}" +
    "#audioControls .audio-btn:active{transform:translateY(1px);}" +
    "#audioControls .audio-btn.off{opacity:0.4;border-color:rgba(120,140,170,0.4);box-shadow:none;}";

  function mount() {
    document.head.appendChild(style);
    document.body.appendChild(bar);
    paintBtns();
  }
  if (document.body) mount(); else document.addEventListener("DOMContentLoaded", mount);

  // Browsers block audio until a user gesture: unlock on the first pointer down.
  function firstGesture() {
    ensureCtx(); resumeCtx();
    if (musicOn) startMusic();
    window.removeEventListener("pointerdown", firstGesture);
  }
  window.addEventListener("pointerdown", firstGesture);

  // Click blip on any button / link / game cell (capture so it fires before handlers).
  document.addEventListener("click", (e) => {
    if (!sfxOn) return;
    const t = e.target;
    if (t && t.closest && t.closest("button, a, .cell, .level-card, .game-card")) playClick();
  }, true);

  musicBtn.addEventListener("click", () => {
    musicOn = !musicOn; save(MUSIC_KEY, musicOn); paintBtns();
    if (musicOn) startMusic(); else stopMusic();
  });
  sfxBtn.addEventListener("click", () => {
    sfxOn = !sfxOn; save(SFX_KEY, sfxOn); paintBtns();
    if (sfxOn) playClick(); // confirmation blip when turning it on
  });
})();
