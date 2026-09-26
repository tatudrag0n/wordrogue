// ============================================================================
// ワードローグ — 起動とメインループ
// ============================================================================

import { $, clamp } from './core/util.js';
import { Input } from './core/input.js';
import { Audio } from './core/audio.js';
import { Save } from './core/save.js';
import { Run } from './game/run.js';
import { Renderer } from './ui/render.js';
import { Hud } from './ui/hud.js';
import { Forge } from './ui/forge.js';
import { Menus } from './ui/menus.js';
import { RewardScreen, rollRewards } from './ui/reward.js';
import { STAGES } from './data/stages.js';

// ─────────────────────────────────────────────────────────────────────────────
// 状態
// ─────────────────────────────────────────────────────────────────────────────
const app = {
  save: new Save(),
  audio: new Audio(),
  input: null,
  renderer: null,
  hud: null,
  forge: null,
  menus: null,
  reward: null,
  run: null,
  mode: 'title',       // title | play | forge | reward | result
  pendingRewards: 0,
  last: 0,
  acc: 0,
};

const canvas = $('#game');

// ─────────────────────────────────────────────────────────────────────────────
// 初期化
// ─────────────────────────────────────────────────────────────────────────────
function boot() {
  app.renderer = new Renderer(canvas);
  app.input = new Input(canvas);
  app.input.attachTouch();
  app.hud = new Hud();
  app.menus = new Menus({ save: app.save, audio: app.audio });
  app.reward = new RewardScreen({
    audio: app.audio,
    pouch: [],
    onGive: (card) => card.apply?.(),
  });

  // 音は最初のユーザ操作で鳴らす。
  const kick = () => {
    app.audio.resume();
    app.audio.setVolume(app.save.setting('volume') ?? 0.5);
  };
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) {
    window.addEventListener(ev, kick, { once: false, passive: true });
  }

  // 入力
  $('#btnForge').addEventListener('click', () => toggleForge());
  $('#btnPause').addEventListener('click', () => togglePause());
  window.addEventListener('keydown', onKey);

  window.addEventListener('resize', () => app.renderer.resize());
  window.addEventListener('orientationchange', () => setTimeout(() => app.renderer.resize(), 120));

  // セーブの初期化
  if (app.save.d.unlockedWeapons.length < 2) {
    app.save.d.unlockedWeapons = ['sword', 'gun'];
  }
  app.save.save();

  app.menus.show('title');
  app.menus.cb = {
    onStart: (weaponIds) => startRun(weaponIds),
    onRetry: () => startRun(app.lastLoadout),
    onStages: () => { app.mode = 'title'; app.menus.showStages(); },
    onNext: () => {
      const next = Math.min(STAGES.length, app.run.stage.id + 1);
      app.menus.showLoadout(next);
    },
  };

  app.last = performance.now();
  requestAnimationFrame(loop);
}

// ─────────────────────────────────────────────────────────────────────────────
// 画面遷移
// ─────────────────────────────────────────────────────────────────────────────
function startRun(weaponIds) {
  app.audio.resume();
  const stageId = app.menus.stageId || 1;
  app.lastLoadout = (weaponIds || ['sword', 'gun']).slice();

  const run = new Run({
    stageId,
    save: app.save,
    audio: app.audio,
    weaponIds: app.lastLoadout,
    startingWords: app.save.d.startingWords,
    pouchSize: 12,
  });
  run.shakeOn = app.save.setting('screenShake') !== false;
  run.showDamage = app.save.setting('showDamage') !== false;
  run.viewR = app.renderer.viewR;

  run.onDeath = () => onRunEnd(false);
  run.onClear = () => onRunEnd(true);
  run.onLevelUp = (lv) => {
    app.audio.levelup();
    run.pushHint(`レベル ${lv} — 体力回復`);
    run.healPlayer(run.player.maxHp);
  };

  app.run = run;
  app.mode = 'play';
  app.pendingRewards = STAGES.find((s) => s.id === stageId)?.reward ?? 2;
  app.menus.hideAll();
  app.hud.show(true);
  app.hud.setPaused(false);
  app.forge?.close();
  app.forge = new Forge(run, {
    audio: app.audio,
    onClose: () => { app.mode = 'play'; app.hud.setPaused(false); },
    onChange: () => { /* 武器は毎フレーム解決し直すので何もしない */ },
  });
  // Forge のタップ音を足す。
  app.audio.tap = () => app.audio.tone({ freq: 700, type: 'sine', dur: 0.04, vol: 0.05 });
  app.audio.worn = (res) => {
    if (res && !res.active) app.audio.broken();
    else app.audio.phrase();
  };
}

function onRunEnd(cleared) {
  app.hud.setPaused(false);
  app.save.recordRun({
    score: app.run.score,
    kills: app.run.kills,
    stageId: app.run.stage.id,
    cleared,
  });

  if (!cleared) {
    app.mode = 'result';
    app.menus.showResult({
      cleared: false, run: app.run, save: app.save,
      isLast: app.run.stage.id >= STAGES.length,
    });
    return;
  }

  // クリアしたら報酬を回数分選ぶ。
  app.pendingRewards = STAGES.find((s) => s.id === app.run.stage.id)?.reward ?? 2;
  showNextReward();
}

function showNextReward() {
  const run = app.run;
  if (app.pendingRewards <= 0) {
    app.mode = 'result';
    app.menus.showResult({
      cleared: true, run, save: app.save,
      isLast: run.stage.id >= STAGES.length,
    });
    return;
  }
  app.pendingRewards--;
  app.mode = 'reward';
  app.hud.show(false);
  app.reward.pouch = run.pouch;
  const cards = rollRewards(run, app.save, { count: 3 });
  app.reward.show(cards, () => showNextReward(), {
    title: 'クリア報酬',
    sub: `あと ${app.pendingRewards + 1} 回選べます。`,
  });
}

function toggleForge() {
  if (app.mode !== 'play' && app.mode !== 'forge') return;
  if (app.mode === 'forge') {
    app.forge.close();
    app.mode = 'play';
    app.hud.setPaused(false);
  } else {
    app.mode = 'forge';
    app.forge.setRun(app.run);
    app.forge.open();
    app.hud.setPaused(true);
  }
}

function togglePause() {
  if (app.mode !== 'play' && app.mode !== 'forge') return;
  if (app.mode === 'forge') { toggleForge(); return; }
  app.run.paused = true;
  app.mode = 'forge';
  app.forge.setRun(app.run);
  app.forge.open();
  app.hud.setPaused(true);
}

// ─────────────────────────────────────────────────────────────────────────────
// キー操作
// ─────────────────────────────────────────────────────────────────────────────
function onKey(e) {
  const k = e.key.toLowerCase();

  if (app.mode === 'play') {
    if (k === 'q' || k === 'tab') { e.preventDefault(); toggleForge(); return; }
    if (k === 'escape') { e.preventDefault(); togglePause(); return; }
    return;
  }

  if (app.mode === 'forge') {
    if (k === 'q' || k === 'escape') { e.preventDefault(); toggleForge(); return; }
    return;
  }

  if (app.mode === 'title' && (k === 'enter' || k === ' ')) {
    e.preventDefault();
    app.menus.showStages();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// メインループ
// ─────────────────────────────────────────────────────────────────────────────
const STEP = 1 / 60;

function loop(now) {
  requestAnimationFrame(loop);

  // フレーム時間を上限 0.1 秒に丸める (タブ復帰時の飛びを防ぐ)。
  let dt = (now - app.last) / 1000;
  app.last = now;
  if (!(dt > 0)) dt = STEP;
  dt = Math.min(dt, 0.1);

  app.input.update();

  const run = app.run;

  if (run && (app.mode === 'play' || app.mode === 'forge')) {
    // 固定歩长で進める。60fps 基準。
    app.acc += dt;
    let guard = 0;
    while (app.acc >= STEP && guard++ < 5) {
      app.acc -= STEP;
      run.viewR = app.renderer.viewR;
      run.update(STEP, app.input);
    }
    if (guard >= 5) app.acc = 0;

    app.renderer.draw(run, app.input.stickState());
    app.hud.update(run, (wi) => {
      if (app.mode === 'play') toggleForge();
    });
    if (app.forge.isOpen) app.forge.tick();

    // 音楽。激昂度は経過時間から求める。
    if (app.mode === 'play' && !run.paused) {
      const t = clamp(run.time / run.stage.time, 0, 1);
      const near = run.boss ? 1 : t;
      app.audio.musicTick(dt, near);
    }

    // 死亡/クリアは Run が通知するので、ここでは何もしない。
  } else if (app.input.stickState().active) {
    // メニュー中は操作しない。
  }

  app.input.flush();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

// デバッグ用。
window.__wordrogue = app;
