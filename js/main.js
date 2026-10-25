// ============================================================================
// ワードローグ — 起動とメインループ
// ============================================================================

import { $, clamp } from './core/util.js?v=1.5';
import { Input } from './core/input.js?v=1.5';
import { Audio } from './core/audio.js?v=1.9';
import { Save } from './core/save.js?v=1.5';
import { Run } from './game/run.js?v=1.5';
import { Renderer } from './ui/render.js?v=1.5';
import { Hud } from './ui/hud.js?v=1.5';
import { Forge } from './ui/forge.js?v=1.7';
import { Menus } from './ui/menus.js?v=1.7';

import { STAGES } from './data/stages.js?v=1.5';

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
  run: null,
  mode: 'title',       // title | play | pause | forge | dict | settings | howto | result
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
  app.hud.bindDash(app.input);
  app.menus = new Menus({ save: app.save, audio: app.audio });
  // クリア報酬は言玉の直接払い。三択の報酬画面は廃止した。

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
  $('#btnForgeDict').addEventListener('click', () => toggleDict());
  $('#btnDictInGame').addEventListener('click', () => toggleDict());
  $('#btnPause').addEventListener('click', () => togglePause());
  $('#btnResume').addEventListener('click', () => resumeRun());
  $('#btnPauseForge').addEventListener('click', () => openForge());
  $('#btnPauseDict').addEventListener('click', () => openDictFromPause());
  $('#btnPauseSettings').addEventListener('click', () => openTabFromPause('settings'));
  $('#btnPauseHowto').addEventListener('click', () => openTabFromPause('howto'));
  $('#btnPauseTitle').addEventListener('click', onPauseTitleClick);
  window.addEventListener('keydown', onKey);

  const leave = () => {
    app.input?.clear?.();
    if (app.mode === 'play') pauseRun();
  };
  window.addEventListener('blur', leave);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) leave();
  });

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
    onStages: () => {
      app.mode = 'title';
      app.hud.show(false);
      app.hud.setPaused(false);
      app.forge?.close();
      app.run = null;
      app.menus.showStages();
    },
    onCloseDict: () => {
      if (app.mode === 'dict') toggleDict();   // 戦闘/鍛冶から開いた辞書を閉じる
      else app.menus.hide('dict');             // タイトル系から開いたタブを閉じる
    },
    onNext: () => {
      app.mode = 'title';
      app.hud.show(false);
      app.hud.setPaused(false);
      app.forge?.close();
      app.run = null;
      app.menus.show('title');
    },
    onNextStage: () => {
      const nextId = Math.min((app.run?.stage.id || 1) + 1, STAGES.length);
      app.mode = 'title';
      app.hud.show(false);
      app.hud.setPaused(false);
      app.forge?.close();
      app.run = null;
      app.menus.stageId = nextId;
      startRun(app.lastLoadout);
    },
    onCloseTabFromPause: () => {
      if (!app.run) return;
      app.mode = 'pause';
      app.run.paused = true;
      app.hud.setPaused(true, app.run);
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
  app.lastLoadout = (weaponIds || ['sword']).slice(0, 1);

  const run = new Run({
    stageId,
    save: app.save,
    audio: app.audio,
    weaponIds: app.lastLoadout,
    lexiconSize: 12,
    deckWords: app.save.deck,
    partEntries: app.save.partEntries(),
  });
  run.shakeOn = app.save.setting('screenShake') !== false;
  run.showDamage = app.save.setting('showDamage') !== false;
  run.viewR = app.renderer.viewR;

  run.onDeath = () => onRunEnd(false);
  run.onClear = () => onRunEnd(true);
  run.onLevelUp = (lv) => {
    app.audio.levelup();
    run.levelBurst?.(lv);
    run.pushHint(`レベル ${lv} — 体力回復`);
    run.healPlayer(run.player.maxHp);
  };
  // 3 択を選んだとき。語彙が満杯なら run 側で「捨てる」を決めてから入る。
  run.onWordChoice = (list) => {
    app.hud.forgetIndex = null;
    app.hud._choiceSig = '';
    if (!list.length) app.audio.tap?.();
  };
  run.onWordChoiceExpired = () => {
    // 時間切れの 1 番目は run 側で採用済み。UI の更新だけする。
    app.hud.forgetIndex = null;
    app.hud._choiceSig = '';
  };

  app.run = run;
  app.mode = 'play';
  app.acc = 0;
  app.last = performance.now();
  app.menus.hideAll();
  app.hud.show(true);
  app.hud.setPaused(false);
  app.forge?.close();
  app.forge = new Forge(run, {
    audio: app.audio,
    onClose: () => {
      if (app.mode !== 'forge') return;
      app.mode = 'play';
      app.acc = 0;
      app.last = performance.now();
      app.hud.setPaused(false);
    },
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
  app.input?.clear?.();
  app.hud.setPaused(false);
  app.acc = 0;
  // 書庫の通貨「言玉」。文を崩した敵の数で入り、クリアするとまとまって入る。
  const broken = app.run.brokenCount || 0;
  // プレイヤーの強さ (恒久強化と部位強化) で報酬が上乗せされる。
  const buff = 1 + (app.run.player.stats.atkMul - 1) * 0.5;
  const ink = cleared
    ? Math.round((100 + app.run.stage.id * 100) * buff)
    : Math.round((100 + broken * 15) * buff);
  app.save.recordRun({
    score: app.run.score,
    kills: app.run.kills,
    stageId: app.run.stage.id,
    cleared,
    broken,
    ink,
  });
  app.lastInk = ink;

  app.mode = 'result';
  app.menus.showResult({
    cleared,
    run: app.run,
    save: app.save,
    ink,
    isLast: app.run.stage.id >= STAGES.length,
  });
}

function openForge() {
  if (!app.run || (app.mode !== 'play' && app.mode !== 'pause')) return;
  app.input?.clear?.();
  app.mode = 'forge';
  app.acc = 0;
  resetQuitButton();
  app.hud.setPaused(false);
  app.forge.setRun(app.run);
  app.forge.open();
}
function toggleForge() {
  if (app.mode === 'forge') { app.forge.close(); return; }
  openForge();
}
function pauseRun() {
  if (app.mode !== 'play' || !app.run) return false;
  app.input?.clear?.();
  app.run.paused = true;
  app.mode = 'pause';
  app.acc = 0;
  resetQuitButton();
  app.hud.setPaused(true, app.run);
  return true;
}
function resumeRun() {
  if (app.mode !== 'pause' || !app.run) return false;
  app.run.paused = false;
  app.mode = 'play';
  app.acc = 0;
  app.last = performance.now();
  resetQuitButton();
  app.hud.setPaused(false);
  return true;
}
function togglePause() {
  if (app.mode === 'pause') resumeRun();
  else if (app.mode === 'forge') app.forge.close();
  else if (app.mode === 'play') pauseRun();
}
function openDictFromPause() {
  if (app.mode !== 'pause' || !app.run) return;
  app.hud.setPaused(false);
  app.mode = 'dict';
  app.dictFrom = 'pause';
  app.run.paused = true;
  app.menus.show('dict');
}
function openTabFromPause(name) {
  if (app.mode !== 'pause' || !app.run) return;
  app.hud.setPaused(false);
  app.mode = name;
  app.menus.showFromPause(name);
}
let quitTimer = 0;
const QUIT_ARM_MS = 3500;
function resetQuitButton() {
  if (quitTimer) clearTimeout(quitTimer);
  quitTimer = 0;
  const b = $('#btnPauseTitle');
  b.classList.remove('armed');
  b.textContent = 'タイトルへ戻る';
}
function onPauseTitleClick() {
  const b = $('#btnPauseTitle');
  if (b.classList.contains('armed')) { returnToTitle(); return; }
  b.classList.add('armed');
  b.textContent = 'もう一度押すと放棄';
  if (quitTimer) clearTimeout(quitTimer);
  quitTimer = setTimeout(resetQuitButton, QUIT_ARM_MS);
}
function returnToTitle() {
  resetQuitButton();
  app.mode = 'title';
  app.hud.show(false);
  app.hud.setPaused(false);
  app.forge?.close();
  app.run = null;
  app.menus.show('title');
}

/**
 * 辞書を開閉する。戦闘中でも、言葉鍛冶の上からでも開ける。
 *
 * 言葉鍛冶を開いているときは「閉じずに上に重ねる」。
 * 語を組み立てている最中に語を引きたくなる。鍛冶を閉じてから開き直すと
 * 選び直すことになる。閉じるときは元の画面 (鍛冶) に戻る。
 */
function toggleDict() {
  if (app.mode === 'dict') {
    // どこから開いたかを覚えているので、元の画面へ戻す。
    const from = app.dictFrom || 'play';
    app.menus.hide('dict');
    app.dictFrom = null;
    if (from === 'forge') {
      app.mode = 'forge';
      app.run.paused = true;
      app.hud.setPaused(false);
    } else if (from === 'pause') {
      app.mode = 'pause';
      app.run.paused = true;
      app.hud.setPaused(true, app.run);
    } else {
      app.mode = 'play';
      app.run.paused = false;
      app.acc = 0;
      app.last = performance.now();
      app.hud.setPaused(false);
    }
    return;
  }
  app.menus.show('dict');
  if (app.mode === 'play' || app.mode === 'forge' || app.mode === 'pause') {
    app.dictFrom = app.mode;
    app.run.paused = true;
    app.hud.setPaused(false);
    app.mode = 'dict';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// キー操作
// ─────────────────────────────────────────────────────────────────────────────
function onKey(e) {
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  if (app.mode === 'play') {
    if (k === 'q' || k === 'tab') { e.preventDefault(); openForge(); return; }
    if (k === 'escape' || k === 'p') { e.preventDefault(); pauseRun(); return; }
    return;
  }
  if (app.mode === 'pause') {
    if (k === 'escape' || k === 'p') { e.preventDefault(); resumeRun(); return; }
    if (k === 'q' || k === 'tab') { e.preventDefault(); openForge(); return; }
    return;
  }
  if (app.mode === 'forge') {
    if (k === 'q' || k === 'escape') { e.preventDefault(); app.forge.close(); return; }
    return;
  }
  if (app.mode === 'dict') {
    if (k === 'escape') { e.preventDefault(); toggleDict(); return; }
    return;
  }
  if (app.mode === 'settings' || app.mode === 'howto') {
    if (k === 'escape') { e.preventDefault(); app.menus.back(); return; }
    return;
  }
  if (app.mode === 'result') {
    if (k === 'escape') { e.preventDefault(); returnToTitle(); }
    return;
  }
  if (app.mode === 'title') {
    if (k === 'escape') {
      if (app.menus.back()) e.preventDefault();
      return;
    }
    if ((k === 'enter' || k === ' ') && app.menus.isVisible('title')) {
      e.preventDefault();
      app.menus.showStages();
    }
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

  app.input.update(dt);

  const run = app.run;

  if (run && (app.mode === 'play' || app.mode === 'forge')) {
    // 固定歩长で進める。60fps 基準。
    app.acc += dt;
    let guard = 0;
    while (app.acc >= STEP && guard++ < 5) {
      app.acc -= STEP;
      run.viewR = app.renderer.viewR;
      run.viewW = app.renderer.w;
      run.viewH = app.renderer.h;
      run.update(STEP, app.input);
    }
    if (guard >= 5) app.acc = 0;

    app.renderer.draw(run, app.input.stickState());
    app.hud.update(run, (wi) => {
      if (app.mode === 'play') toggleForge();
    });
    // 3 択。選択中はゲームが止まり、中央の大きな札で選ぶ。
    app.hud.renderChoices(run, (id, index, discardIndex) => {
      if (run.chooseWord(id, index, discardIndex)) app.audio.phrase();
    });

    // 音楽。激昂度は経過時間から求める。
    if (app.mode === 'play' && !run.paused) {
      const t = clamp(run.time / run.stage.time, 0, 1);
      const near = run.boss ? 1 : t;
      const track = run.boss ? 'boss' : 'stage' + run.stage.id;
      app.audio.musicTick(dt, near, track);
    }

    // 死亡/クリアは Run が通知するので、ここでは何もしない。
  } else if (run && app.mode === 'pause') {
    app.renderer.draw(run, app.input.stickState());
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
