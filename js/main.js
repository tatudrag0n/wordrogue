// ============================================================================
// ワードローグ — 起動とメインループ
// ============================================================================

import { $, clamp } from './core/util.js?v=1.47';
import { Input } from './core/input.js?v=1.47';
import { Audio } from './core/audio.js?v=1.47';
import { Save } from './core/save.js?v=1.47';
import { Run } from './game/run.js?v=1.47';
import { Renderer } from './ui/render.js?v=1.47';
import { Hud } from './ui/hud.js?v=1.47';
import { Forge } from './ui/forge.js?v=1.47';
import { Menus } from './ui/menus.js?v=1.47';

import { STAGES } from './data/stages.js?v=1.47';
import { WORDS, makeWord, CONNECTOR_SET, segment } from './data/words.js?v=1.47';

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
  mode: 'title',       // title | play | pause | forge | dict | settings | howto | result | error
  last: 0,
  acc: 0,
  crashed: false,
};

const canvas = $('#game');
const KONAMI_CODE = ['arrowup', 'arrowup', 'arrowdown', 'arrowdown', 'arrowleft', 'arrowright', 'arrowleft', 'arrowright', 'b', 'a'];
let konamiProgress = 0;
let devReturnMode = 'title';

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
  window.addEventListener('keydown', onKonamiKey, true);

  const leave = () => {
    app.input?.clear?.();
    if (app.mode === 'play') pauseRun();
  };
  window.addEventListener('blur', leave);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) leave();
  });

  $('#devClose')?.addEventListener('click', closeDevMode);
  // 全語彙解除 + ゲーム中指定語入手 (開発者モード)。
  const unlockAllWords = () => {
    const r = app.save.unlockAllWords?.() || app.save.unlockAllVocabulary?.();
    app.save.save();
    const status = `全語彙を解除しました (所持 ${app.save.collection.length} 語)。`;
    $('#devStatus').textContent = status;
    if (app.menus?.grow && !app.menus.grow.hidden) app.menus.renderGrow();
    if (app.menus?.words && !app.menus.words.hidden) app.menus.renderWords();
    return r;
  };
  const giveSpecifiedWord = () => {
    const inputs = [
      $('#devWordInput'), $('#devWord'), $('#devWordText'), $('#devGiveWordInput'), $('#devTargetWord'),
    ].filter(Boolean);
    const text = (inputs.map((n) => (n.value || '').trim()).find((v) => v) || '').trim();
    if (!text) {
      $('#devStatus').textContent = '入手する語を入力してください。';
      return;
    }
    // 入手する語を決める。
    // 1 語そのものが辞書にあれば (接続詞以外) それを 1 語入手し、
    // 無い場合は「残火太刀」のように連結して書かれた語として分割し、
    // 構成される各語 (残・火・太・刀) をそれぞれ入手する。
    let targets = null;
    if (WORDS[text] && !CONNECTOR_SET.has(text)) {
      targets = [text];
    } else {
      const segs = segment(text);
      if (segs && segs.length && segs.every((s) => WORDS[s] && !CONNECTOR_SET.has(s))) {
        targets = segs;
      }
    }
    if (!targets) {
      $('#devStatus').textContent = `「${text}」は入手できない語です。`;
      return;
    }
    // 開発者モードは文の鍛冶中でも開けるが、入手先は実際に動いているランに限る。
    if (!app.run) {
      $('#devStatus').textContent = '指定語の入手はラン中のみ使用できます (先にステージを開始してください)。';
      return;
    }
    const got = [];
    for (const t of targets) {
      const ok = app.run.giveWord(makeWord(t), true);
      if (!ok) break;
      got.push(t);
      // 入手した語を所持語にも加えておくと、デッキや部位で使い回せる。
      if (!app.save.ownsWord(t)) {
        app.save.data.collection.push(t);
        if (!app.save.data.ranks || typeof app.save.data.ranks !== 'object') app.save.data.ranks = {};
        if (!Number.isInteger(app.save.data.ranks[t])) app.save.data.ranks[t] = 0;
      }
    }
    app.save.save();
    // 入力欄はすべて空に戻す。
    for (const n of inputs) n.value = '';
    if (targets.length === 1) {
      $('#devStatus').textContent = `「${text}」を手に入れました。`;
    } else {
      $('#devStatus').textContent = `「${text}」を「${got.join('」「')}」に分けて手に入れました。`;
    }
  };

  const unlockIds = ['devUnlockAllWords', 'devUnlockWords', 'devUnlockVocabulary', 'devAllWords', 'devUnlockAll'];
  const giveIds = ['devGiveWord', 'devAddWord', 'devGrantWord', 'devObtainWord', 'devGetWord', 'devGiveSpecifiedWord'];
  // エイリアス (別の id で呼ばれても動くように、存在しなければ隠し要素を作る)。
  const ensureButton = (id, srcId) => {
    if (document.getElementById(id)) return;
    const src = document.getElementById(srcId);
    if (!src) return;
    const el = src.cloneNode(true);
    el.id = id;
    el.hidden = true;
    src.parentElement?.appendChild(el);
  };
  const ensureInput = (id, srcId) => {
    if (document.getElementById(id)) return;
    const src = document.getElementById(srcId);
    if (!src) return;
    const el = src.cloneNode(true);
    el.id = id;
    el.hidden = true;
    src.parentElement?.appendChild(el);
  };
  for (const id of unlockIds) ensureButton(id, 'devUnlockAllWords');
  for (const id of giveIds) ensureButton(id, 'devGiveWord');
  for (const id of ['devWord', 'devWordText', 'devGiveWordInput', 'devTargetWord']) ensureInput(id, 'devWordInput');

  for (const id of unlockIds) document.getElementById(id)?.addEventListener('click', unlockAllWords);
  for (const id of giveIds) document.getElementById(id)?.addEventListener('click', giveSpecifiedWord);
  const inputIds = ['devWordInput', 'devWord', 'devWordText', 'devGiveWordInput', 'devTargetWord'];
  for (const id of inputIds) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); giveSpecifiedWord(); }
    });
  }

  $('#devAddInk')?.addEventListener('click', () => {
    app.save.addInk(1000);
    app.save.save();
    $('#devStatus').textContent = `言玉を追加しました（所持 ${app.save.ink}）。`;
    if (app.menus.grow && !app.menus.grow.hidden) app.menus.renderGrow();
    if (app.menus.words && !app.menus.words.hidden) app.menus.renderWords();
  });
  $('#devHeal')?.addEventListener('click', () => {
    if (!app.run) {
      $('#devStatus').textContent = '体力全回復はラン中のみ使用できます。';
      return;
    }
    app.run.healPlayer(app.run.player.maxHp);
    $('#devStatus').textContent = '体力を全回復しました。';
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
  // プレイヤーの強さ (部位強化) で報酬が上乗せされる。
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
function onKonamiKey(e) {
  if (e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
  // Capture phase lets the sequence work even when a menu handler stops bubbling.
  // Buttons and game canvases should not prevent the code; only text-entry fields do.
  const target = e.target;
  if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
  const key = String(e.key || '').toLowerCase();
  if (key === KONAMI_CODE[konamiProgress]) {
    konamiProgress++;
  } else {
    konamiProgress = key === KONAMI_CODE[0] ? 1 : 0;
  }
  if (konamiProgress !== KONAMI_CODE.length) return;
  konamiProgress = 0;
  e.preventDefault();
  toggleDevMode();
}

function toggleDevMode() {
  const panel = $('#devMode');
  if (!panel) return;
  if (!panel.hidden) {
    closeDevMode();
    return;
  }
  devReturnMode = app.mode;
  app.input?.clear?.();
  if (app.run) {
    app.run.paused = true;
    app.hud?.show?.(true);
    if (devReturnMode === 'play' || devReturnMode === 'pause') {
      $('#hudPaused').hidden = true;
      app.hud?.setPaused?.(false);
    }
  } else {
    app.menus.hideAll();
  }
  app.mode = 'dev';
  panel.hidden = false;
  $('#devStatus').textContent = '';
}

function closeDevMode() {
  const panel = $('#devMode');
  if (!panel || panel.hidden) return;
  panel.hidden = true;
  app.mode = devReturnMode;
  if (app.run) {
    if (devReturnMode === 'forge') app.forge?.open?.();
    else if (devReturnMode === 'play' || devReturnMode === 'pause') app.hud?.show?.(true);
    app.run.paused = devReturnMode !== 'play';
    if (devReturnMode === 'play') {
      app.acc = 0;
      app.last = performance.now();
    }
    if (devReturnMode !== 'forge') app.hud?.setPaused?.(devReturnMode === 'pause', app.run);
  }
  if (!app.run) {
    if (devReturnMode === 'title') app.menus.show('title');
    else if (devReturnMode === 'stages') app.menus.showStages();
    else if (devReturnMode === 'loadout') app.menus.show('loadout');
    else if (devReturnMode === 'result') app.menus.show('result');
    else if (devReturnMode === 'howto' || devReturnMode === 'words' || devReturnMode === 'settings' || devReturnMode === 'grow' || devReturnMode === 'dict') {
      app.menus.show(devReturnMode);
    }
  }
}

function onKey(e) {
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  if (app.mode === 'dev') {
    if (k === 'escape') { e.preventDefault(); closeDevMode(); }
    return;
  }
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

/** 例外を画面に知らせる。INDEX の #fatal が受け取る。 */
function fatal(what, err) {
  const detail = err instanceof Error ? (err.stack || err.message) : (err ? String(err) : '');
  if (typeof window.__wordrogueFatal === 'function') window.__wordrogueFatal(what, detail);
  else console.error(what, err);   // 案内を出せない環境 (テスト) ではログだけ。
}

function loop(now) {
  requestAnimationFrame(loop);
  // 一度壊れたら毎フレーム同じ例外を投げ続けない。
  if (app.crashed) return;
  try {
    step(now);
  } catch (err) {
    app.crashed = true;
    if (app.run) app.run.paused = true;
    fatal('実行中にエラーが起きました', err);
  }
}

function step(now) {
  // フレーム時間を上限 0.1 秒に丸める (タブ復帰時の飛びを防ぐ)。
  let dt = (now - app.last) / 1000;
  app.last = now;
  if (!(dt > 0)) dt = STEP;
  dt = Math.min(dt, 0.1);

  app.input.update(dt);

  const run = app.run;

  if (run && (app.mode === 'play' || app.mode === 'forge')) {
    // 固定の刻みで進める。60fps 基準。
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
  document.addEventListener('DOMContentLoaded', () => { try { boot(); } catch (err) { fatal('起動に失敗しました', err); } });
} else {
  try { boot(); } catch (err) { fatal('起動に失敗しました', err); }
}

// デバッグ用。
window.__wordrogue = app;
