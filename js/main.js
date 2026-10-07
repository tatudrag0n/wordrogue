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
  run: null,
  mode: 'title',       // title | play | forge | dict | result
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
    onStages: () => { app.mode = 'title'; app.hud.show(false); app.run = null; app.menus.showStages(); },
    onCloseDict: () => {
      if (app.mode === 'dict') toggleDict();   // 戦闘/鍛冶から開いた辞書を閉じる
      else app.menus.hide('dict');             // タイトル系から開いたタブを閉じる
    },
    onNext: () => {
      // ステージクリア後は一旦ホームへ。次のステージはホームから選ぶ。
      app.mode = 'title';
      app.hud.show(false);
      app.hud.setPaused(false);
      app.forge?.close();
      app.run = null;
      app.menus.show('title');
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
  // 書庫の通貨「言玉」。文を崩した敵の数で入り、クリアするとまとまって入る。
  const broken = app.run.brokenCount || 0;
  // プレイヤーの強さ (恒久強化と自身の文) で報酬が上乗せされる。
  const buff = 1 + (app.run.player.stats.atkMul - 1) * 0.5
    + (app.run.player.stats.selfPower - 1);
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
      app.hud.setPaused(true);
    } else {
      app.mode = 'play';
      app.run.paused = false;
      app.hud.setPaused(false);
    }
    return;
  }
  // タイトル系画面 (タイトル/ステージ/編成/結果) からも開ける。
  // 閉じるときは menus.hide('dict') が _tabFrom の画面を復元する。
  app.menus.show('dict');
  if (app.mode === 'play' || app.mode === 'forge') {
    app.dictFrom = app.mode;
    app.run.paused = true;
    app.hud.setPaused(true);
    app.mode = 'dict';
  }
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

  if (app.mode === 'dict') {
    // 辞書はボタンと ✕ だけで開く。キーに割り当てない。
    if (k === 'escape') { e.preventDefault(); toggleDict(); return; }
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
    // 3 択。時間制限つきで、時間は止まらない。
    app.hud.renderChoices(run, (id, index, discardIndex) => {
      if (run.chooseWord(id, index, discardIndex)) app.audio.phrase();
    });

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
