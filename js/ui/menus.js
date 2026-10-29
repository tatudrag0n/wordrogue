// ============================================================================
// ワードローグ — タイトル / ステージ選択 / 武器選択 / 結算 / 設定
// ============================================================================

import { $, el, clear, fmtNum } from '../core/util.js';
import { STAGES } from '../data/stages.js';
import { ENEMIES } from '../data/enemies.js';
import { WEAPONS, BASIC_WEAPONS, startingWeaponsFor, KIND_LABEL, WEAPON_MAX } from '../data/weapons.js?v=1.45';
import { WORDS, CATEGORIES, CONNECTOR_SET, PHRASE_BONUS } from '../data/words.js?v=1.45';
import { evaluatePart, partConnChoices } from '../game/parts.js';
import { partEffectRows, partTotalRows } from '../game/stats.js';
import { GrowPad } from './growpad.js';
import { FX_LABEL, PS_LABEL } from './labels.js';
import {
  PARTS, DECK_MIN, DECK_MAX, GACHA_COST, GACHA_REFUND,
} from '../core/save.js';

/** 語の効果を 1 行にまとめる (ツールチップ用)。 */
function fxText(src, label) {
  const parts = [];
  for (const [k, v] of Object.entries(src || {})) {
    if (typeof v !== 'number' || Math.abs(v) < 0.01) continue;
    parts.push(`${label[k] || k}${v > 0 ? '+' : ''}${Math.round(v * 100) / 100}`);
  }
  return parts.length ? parts.join(' ') : '効果なし';
}

export class Menus {
  /** @param {{save:object, audio:object}} opt */
  constructor(opt) {
    this.opt = opt;
    this.save = opt.save;
    this.audio = opt.audio;

    this.title = $('#title');
    this.stages = $('#stages');
    this.stageList = $('#stageList');
    this.loadout = $('#loadout');
    this.loadoutList = $('#loadoutList');
    this.loadoutCount = $('#loadoutCount');
    this.loadoutGo = $('#loadoutGo');
    this.loadoutTitle = $('#loadoutTitle');
    this.loadoutSub = $('#loadoutSub');
    this.result = $('#result');
    this.resultStats = $('#resultStats');
    this.resultTitle = $('#resultTitle');
    this.resultSub = $('#resultSub');
    this.resultNext = $('#resultNext');
    this.howto = $('#howto');
    this.settings = $('#settings');
    this.dict = $('#dict');
    this.grow = $('#grow');
    this.growInk = $('#growInk');
    this.words = $('#words');
    this.wordsInk = $('#wordsInk');
    this.gachaBtn = $('#gachaBtn');
    this.gachaTenBtn = $('#gachaTenBtn');
    this.gachaResult = $('#gachaResult');
    // くじの幕。テストの最小 DOM には無いので、すべて null 安全に扱う。
    this.gachaVeil = $('#gachaVeil');
    this.gachaReels = $('#gachaReels');
    this.gachaReelSpans = this.gachaReels ? [...this.gachaReels.querySelectorAll('span')] : [];
    this.gachaCard = $('#gachaCard');
    this.gachaWord = $('#gachaWord');
    this.gachaCat = $('#gachaCat');
    this.gachaEff = $('#gachaEff');
    this.gachaLotList = $('#gachaLotList');
    this.gachaNote = $('#gachaNote');
    this.gachaKicker = $('#gachaKicker');
    this.gachaSeal = $('#gachaSeal');
    this.gachaNew = $('#gachaNew');
    this.gachaAgain = $('#gachaAgain');
    this.gachaClose = $('#gachaClose');
    this.gachaX = $('#gachaX');
    /** くじの演出中か。連打で二重に引かないための錠。 */
    this._gachaSpinning = false;
    /** リールに流す語のプール。 */
    this._gachaPool = null;
    /** リールの定期更新と、停止・開示のタイマー。 */
    this._gachaTimer = null;
    this._gachaTimers = [];
    /** 直近に引いた結果。幕を閉じたあとの一行に使う。 */
    this._lastGacha = null;
    this.growParts = $('#growParts');
    this.growTotal = $('#growTotal');
    this.growSelNote = $('#growSelNote');
    this.growWords = $('#growWords');
    this.growWordsNote = $('#growWordsNote');
    this.deckWords = $('#deckWords');
    this.deckCount = $('#deckCount');
    this.deckSelectAll = $('#deckSelectAll');
    this.deckDeselectAll = $('#deckDeselectAll');
    this.deckBack = $('#deckBack');
    /** 部位を組む土台。言葉鍛冶と同じ操作 (senpad.js) を使う。 */
    this.growUndo = $('#btnGrowUndo');
    this.growPad = new GrowPad(this);
    // チュートリアル。初回の 1 回だけ自動で出す (save.d.seenIntro)。
    // #tutorial が無い環境 (テストの最小 DOM) でも死なないように取っておく。
    this.tutorial = $('#tutorial');
    this.tutStepEl = this.tutorial ? $('#tutStep') : null;
    this.tutSteps = this.tutorial ? [...this.tutorial.querySelectorAll('.tut-step')] : [];
    this.tutIdx = 0;


    /** 辞書。検索語と絞り込みカテゴリ。 */
    this.dictQuery = '';
    this.dictCat = 'all';
    /** タブを開く前に見えていた画面。バツで戻る先。 */
    this._tabFrom = null;

    /** @type {number[]} 選択中のステージ */
    this.picked = [];
    /** @type {number} いま選んでいるステージ */
    this.stageId = 1;
    this.cb = {};

    this.bind();
  }

  bind() {
    const tap = () => this.audio?.resume?.();

    $('#btnStart').addEventListener('click', () => { tap(); this.showStages(); });
    $('#btnStages').addEventListener('click', () => { tap(); this.showStages(); });
    $('#btnHowto').addEventListener('click', () => { tap(); this.show('howto'); });
    $('#btnGrow').addEventListener('click', () => { tap(); this.show('grow'); });
    $('#btnWords').addEventListener('click', () => { tap(); this.show('words'); });
    // 言葉デッキの一括操作。
    this.deckSelectAll?.addEventListener('click', () => { tap(); this.selectAllDeck(); });
    this.deckDeselectAll?.addEventListener('click', () => { tap(); this.deselectAllDeck(); });
    this.deckBack?.addEventListener('click', () => { tap(); this.hideDeckBack(); this.closeTab('words'); });
    this.growUndo?.addEventListener('click', () => { tap(); this.growPad.undo(); });
    this.gachaBtn?.addEventListener('click', () => { tap(); this.startGacha(1); });
    this.gachaTenBtn?.addEventListener('click', () => { tap(); this.startGacha(10); });
    // 幕の中の操作。幕が無い最小 DOM ではすべて素通りする。
    this.gachaAgain?.addEventListener('click', () => { tap(); this.startGacha(this._gachaCount || 1); });
    this.gachaClose?.addEventListener('click', () => { tap(); this.closeGacha(); });
    this.gachaX?.addEventListener('click', () => { tap(); this.closeGacha(); });
    this.gachaVeil?.addEventListener('click', (e) => {
      // 幕の外 (背景) を押したときだけ閉じる。
      if (e.target === this.gachaVeil) this.closeGacha();
    });
    $('#btnDict').addEventListener('click', () => { tap(); this.show('dict'); });
    $('#btnSettings').addEventListener('click', () => { tap(); this.show('settings'); });

    this.dictSearch = $('#dictSearch');
    this.dictTabs = $('#dictTabs');
    this.dictList = $('#dictList');
    this.dictCount = $('#dictCount');
    this.dictSearch.addEventListener('input', () => {
      this.dictQuery = this.dictSearch.value.trim();
      this.renderDict();
    });

    for (const b of document.querySelectorAll('[data-close]')) {
      b.addEventListener('click', () => {
        tap();
        // チュートリアルは初回だけ。閉じたら以後は自動で出さない。
        if (b.dataset.close === 'tutorial' && this.save?.d) {
          this.save.d.seenIntro = true;
          this.save.save();
        }
        // ゲーム中の辞書は main.js が時間を戻すので、そちらに任せる。
        // 閉じたあと main.toggleDict が hide() を呼ぶので、
        // タイトル系の戻し先は hide('dict') 側で復元する。
        if (b.dataset.close === 'dict' && this.cb.onCloseDict) {
          this.cb.onCloseDict();
          return;
        }
        if (b.dataset.close === 'tutorial') {
          this.closeTutorial();
          return;
        }
        this.closeTab(b.dataset.close);
      });
    }

    $('#resultRetry').addEventListener('click', () => { tap(); this.cb.onRetry?.(); });
    $('#resultStages').addEventListener('click', () => { tap(); this.cb.onStages?.(); });
    this.resultNext.addEventListener('click', () => {
      tap();
      (this._resultHasNext ? this.cb.onNextStage : this.cb.onNext)?.();
    });

    this.loadoutGo.addEventListener('click', () => { tap(); this.cb.onStart?.(this.picked.slice()); });

    // ── チュートリアル ──
    $('#btnTutorial')?.addEventListener('click', () => { tap(); this.show('tutorial'); });
    $('#tutNext')?.addEventListener('click', () => {
      tap();
      if (this.tutIdx >= this.tutSteps.length - 1) this.closeTutorial();
      else { this.tutIdx++; this.renderTutorialSteps(); }
    });
    $('#tutBack')?.addEventListener('click', () => {
      tap();
      if (this.tutIdx > 0) { this.tutIdx--; this.renderTutorialSteps(); }
    });

    // ボタン全体の小さな木の音。専用音がある操作でも、その下に薄く重なる。
    document.addEventListener('click', (e) => {
      if (!this.audio?.on || !this.audio?.uiSelect) return;
      if (e.target?.closest?.('.btn')) this.audio.uiSelect();
    }, { passive: true });
  }

  hideAll() {
    this.closeGacha();
    for (const k of ['title', 'stages', 'loadout', 'result', 'howto', 'settings', 'dict', 'grow', 'words']) {
      if (this[k]) this[k].hidden = true;
    }
    // #tutorial は DOM ごと無い環境があるので、存在するときだけ伏せる。
    if (this.tutorial) this.tutorial.hidden = true;
  }

  /** 辞書を閉じる。ゲーム中は main.js 側で時間を戻す。 */
  hide(name) {
    if (name === 'grow') this.closeGacha();
    const wasOpen = this[name] && !this[name].hidden;
    this[name].hidden = true;
    if (wasOpen) this.audio?.uiClose?.();
    if (name === 'dict') {
      this.dictSearch.value = '';
      this.dictQuery = '';
      const back = this._tabFrom;
      this._tabFrom = null;
      if (back === 'pause') this.cb.onCloseTabFromPause?.();
      else if (back && back !== name && this[back]) this[back].hidden = false;
    }
  }

  show(name) {
    // タブ系 (遊び方/書庫/辞書/設定) を開くときは、下に見えている画面を覚える。
    if (['howto', 'dict', 'settings', 'grow', 'words', 'tutorial'].includes(name)) {
      const base = ['title', 'stages', 'loadout', 'result']
        .find((k) => !this[k].hidden);
      this._tabFrom = base || null;
    } else {
      this._tabFrom = null;
    }
    this.hideAll();
    this[name].hidden = false;
    this.audio?.uiOpen?.();
    if (name === 'title') this.renderTitle();
    if (name === 'settings') this.renderSettings();
    if (name === 'dict') this.renderDict();
    if (name === 'grow') { this.growPad.reset(); this.renderGrow(); }
    if (name === 'words') this.renderWords();
    if (name === 'tutorial') this.renderTutorial();
  }

  isVisible(name) {
    return !!this[name] && !this[name].hidden;
  }

  back() {
    if (this.gachaVeil && !this.gachaVeil.hidden) { this.closeGacha(); return true; }
    if (this.tutorial && !this.tutorial.hidden) { this.closeTutorial(); return true; }
    for (const name of ['howto', 'settings', 'grow', 'words']) {
      if (!this[name].hidden) { this.closeTab(name); return true; }
    }
    if (!this.dict.hidden) { this.cb.onCloseDict?.(); return true; }
    if (!this.loadout.hidden) { this.showStages(); return true; }
    if (!this.stages.hidden) { this.show('title'); return true; }
    return false;
  }

  closeTab(name) {
    const back = this._tabFrom;
    this._tabFrom = null;
    this.hide(name);
    if (back === 'pause') { this.cb.onCloseTabFromPause?.(); return; }
    if (back && this[back]) this[back].hidden = false;
    else this.show('title');
  }

  showFromPause(name) {
    if (!this[name]) return;
    this._tabFrom = 'pause';
    this.hideAll();
    this[name].hidden = false;
    this.audio?.uiOpen?.();
    if (name === 'settings') this.renderSettings();
  }

  // ── チュートリアル ─────────────────────────────────────────────────────────

  /** 開くときは最初の 1 枚目から。 */
  renderTutorial() {
    this.tutIdx = 0;
    this.renderTutorialSteps();
  }

  /** いまの歩みに合わせて枚とボタンを整える。 */
  renderTutorialSteps() {
    if (!this.tutorial) return;
    const last = this.tutSteps.length - 1;
    this.tutSteps.forEach((s, i) => s.classList.toggle('is-on', i === this.tutIdx));
    if (this.tutStepEl) this.tutStepEl.textContent = String(this.tutIdx + 1) + ' / ' + String(this.tutSteps.length);
    const back = $('#tutBack');
    const next = $('#tutNext');
    if (back) back.disabled = this.tutIdx <= 0;
    if (next) next.textContent = this.tutIdx >= last ? 'とじる' : 'つぎへ';
  }

  /** 最後まで進んだ (または途中で閉じた)。以後は自動で出さない。 */
  closeTutorial() {
    if (!this.tutorial) return;
    if (this.save?.d) { this.save.d.seenIntro = true; this.save.save(); }
    const back = this._tabFrom;
    this._tabFrom = null;
    this.hide('tutorial');
    if (back && back !== 'tutorial') this[back].hidden = false;
    else this.show('title');
  }


  // ── 部位強化 (言葉くじ・部位・言葉デッキ) ──────────────────────────────
  //
  // 部位は 1 文として数える (武器と同じ仕組み)。**10 文字まで**、語の数は自由。
  // 語の直後に **接続詞** が選べる。接続詞はその語のプール (送り仮名) だけ。
  // 組む操作は GrowPad (senpad.js) — 戦闘中の言葉鍛冶と同じ実装。


  /** 能力の差分を 1 行のチップにする (「体力 +25」など)。 */
  effectChips(rows, cls = 'eff') {
    return rows.map((r) => el('span', { class: `${cls} up`, title: r.label + ' ' + r.text },
      el('i', {}, r.label), r.text));
  }

  /**
   * 語のランクは **色だけ** で示す (札の文字は出さない)。
   * 色は語のボタン自身に付く (.grow-word.rk0〜.rk4)。
   * ランク名と段階はツールチップで補う。
   */
  rankTip(text) {
    const r = this.save.rankOf(text);
    const i = this.save.rankIndex(text);
    return `ランク: ${r.name} (効果 ×${r.mul.toFixed(2)})`
      + (i < 4 ? '\n同じ語をもう一度くじで引くと上がる' : '\n最上位');
  }



  /**
   * 部位の評価。**何がどれだけ変わるか** を必ず数字で出す。
   * 語そのものが武器用で効かない場合は、そう言い切る。
   */
  renderGrowPartNote(part, words) {
    if (!words.length) {
      return el('div', { class: 'grow-part-note empty' });
    }
    const p = evaluatePart(words);
    const effects = partEffectRows(this.save.partEntries(), part.id);
    const box = el('div', { class: 'grow-part-note ' + (p.valid ? p.ev.grade : 'bad') });

    if (!p.valid) {
      box.append(el('b', {}, '不成文 — 効果なし'));
      box.append(el('span', {}, p.reasonText || '文になっていない'));
      const fix = partConnChoices(words, words.length - 1).filter((c) => c.valid);
      box.append(el('span', { class: 'grow-part-fix' },
        fix.length
          ? `直すなら「${words[words.length - 1].text}」に ${fix.slice(0, 4).map((c) => c.text).join(' / ')} を付ける`
          : 'この並びでは文にならない — 語を入れ替える (送り仮名はその語のものしか付かない)'));
      return box;
    }

    const head = el('div', { class: 'grow-part-head' },
      el('b', {}, `「${p.text}${part.name}」`),
      el('span', { class: `grow-part-grade grade-${p.ev.grade}` }, p.gradeInfo?.name || ''),
      el('span', {}, `文の力 ${p.power.toFixed(2)}`),
      el('span', {}, `効き ×${p.gain.toFixed(2)}`),
      p.idiom ? el('span', { class: 'grow-part-idiom' }, `熟語「${p.idiom.name}」`) : null,
    );
    box.append(head);

    if (effects.length) {
      box.append(el('div', { class: 'grow-part-eff' }, ...this.effectChips(effects)));
    } else if (words.length < 2) {
      // 1 語だけの部位。文の力は 1.00 なので、語そのものが体に効かないと何も起きない。
      box.append(el('div', { class: 'grow-part-eff none' },
        `この語は${part.name}では働かない — 意味の合う部位に入れるか、もう 1 語足して文にする`));
    } else {
      box.append(el('div', { class: 'grow-part-eff none' },
        `文は成っているが、この語は${part.name}では働かない — 意味の合う部位か、別の語に入れ替える`));
    }
    return box;
  }

  renderGrow() {
    const save = this.save;
    if (this.growInk) this.growInk.textContent = String(save.ink);

    // 全部位の合計。ここだけ見れば「今どう強くなっているか」が分かる。
    if (this.growTotal) {
      const rows = partTotalRows(save.partEntries());
      clear(this.growTotal);
      this.growTotal.append(el('span', { class: 'grow-total-label' }, '部位の合計'));
      if (!rows.length) {
        this.growTotal.append(el('span', { class: 'grow-total-none' },
          'まだ効いていない — 語を入れて文を成らせると体が強くなる'));
      } else {
        this.growTotal.append(el('span', { class: 'grow-total-eff' }, ...this.effectChips(rows, 'eff big')));
      }
      const broken = save.partEntries().filter((x) => {
        const w = x.words.filter(Boolean);
        return w.length && !evaluatePart(w).valid;
      }).length;
      if (broken) {
        this.growTotal.append(el('span', { class: 'grow-total-warn' }, `不成文の部位 ${broken} つ (効果なし)`));
      }
    }

    // 部位 7 行と所持語は GrowPad が描く。組む操作は言葉鍛冶と同じ土台
    // (senpad.js) なので、タップ・ドラッグ・接続詞・戻すがすべて同じ。
    this.growPad.render();
  }

  // ── 言葉 (くじ・デッキ) ──────────────────────────────────────────────────
  // 言葉くじと言葉デッキは部位強化から分けて、独立したタブにした。
  // 部位に入れる語を選ぶ一覧 (所持語) は強化タブに残している。
  renderWords() {
    const save = this.save;
    this.hideDeckBack();
    if (this.wordsInk) this.wordsInk.textContent = String(save.ink);
    if (this.gachaBtn) {
      this.gachaBtn.textContent = `引く (${GACHA_COST} 言玉)`;
      this.gachaBtn.classList.toggle('off', save.ink < GACHA_COST);
    }
    if (this.gachaTenBtn) {
      this.gachaTenBtn.textContent = `十連くじ (${GACHA_COST * 10} 言玉)`;
      this.gachaTenBtn.disabled = false;
      this.gachaTenBtn.classList.toggle('off', save.ink < GACHA_COST * 10);
    }

    // 言葉デッキ。押すと出し入れ。戦闘開始時の語彙になる。
    const maxLabel = Number.isFinite(DECK_MAX) ? `${DECK_MAX}` : '∞';
    if (this.deckCount) this.deckCount.textContent = `${save.deck.length} / ${maxLabel} 語 (最低 ${DECK_MIN})`;
    if (!this.deckWords) return;
    clear(this.deckWords);
    for (const t of save.collection) {
      const inDeck = save.inDeck(t);
      const b = el('button', {
        class: 'btn grow-word deck' + (inDeck ? ' in' : '') + ' rk' + save.rankIndex(t),
        disabled: inDeck && save.deck.length <= DECK_MIN,
        title: (inDeck ? (save.deck.length <= DECK_MIN ? `最低 ${DECK_MIN} 語を保つため外せない` : 'デッキに入っている — 押すと外れる') : '押すとデッキに入る')
          + `\n${this.rankTip(t)}`,
      }, (inDeck ? '✓ ' : '') + t);
      b.addEventListener('click', () => {
        save.toggleDeck(t);
        this.audio?.tap?.();
        this.renderWords();
      });
      this.deckWords.append(b);
    }
  }

  // 言葉デッキの一括選択 / 解除。
  selectAllDeck() {
    const save = this.save;
    for (const t of save.collection) {
      if (!save.inDeck(t) && save.deck.length < DECK_MAX) save.toggleDeck(t);
    }
    this.showDeckBack();
    this.renderWords();
  }
  deselectAllDeck() {
    const save = this.save;
    // 最低 DECK_MIN 語は残す。
    while (save.deck.length > DECK_MIN) {
      const t = save.deck[save.deck.length - 1];
      save.toggleDeck(t);
      if (save.deck.length >= DECK_MIN && save.inDeck(t)) break;
    }
    this.showDeckBack();
    this.renderWords();
  }
  showDeckBack() {
    if (this.deckBack) this.deckBack.hidden = false;
  }
  hideDeckBack() {
    if (this.deckBack) this.deckBack.hidden = true;
  }

  // ── 言葉くじの演出 ──────────────────────────────────────────────────────
  //
  // 抽選そのものは save.drawGacha() が一瞬で終わる。ここで遅らせるのは
  // 「見せ方」だけ。途中で幕を閉じても、引いた語と払った言玉は残る。

  /** リールに流す短い語。1 回だけ作って使い回す。 */
  _reelPoolWords() {
    if (this._gachaPool) return this._gachaPool;
    const pool = [];
    for (const t of Object.keys(WORDS)) {
      if (CONNECTOR_SET.has(t)) continue;
      if ([...t].length <= 2) pool.push(t);
    }
    this._gachaPool = pool;
    return pool;
  }

  /** 幕が用意されているか。無ければ従来の一行表示だけで動く。 */
  _hasGachaStage() {
    return !!(this.gachaVeil && this.gachaWord);
  }

  /** くじを引く。言玉はここで払い、演出だけを遅らせる。 */
  startGacha(count = 1) {
    if (this._gachaSpinning) return;
    count = count === 10 ? 10 : 1;
    const r = count === 10 ? this.save.drawGachaTen() : this.save.drawGacha();
    if (!r.ok) {
      const msg = r.reason === 'ink'
        ? `言玉が足りない — ${GACHA_COST * count} 言玉必要`
        : '引けなかった — 語の抽選に失敗した';
      if (this.gachaResult) this.gachaResult.textContent = msg;
      if (this._hasGachaStage() && !this.gachaVeil.hidden) {
        if (this.gachaNote) this.gachaNote.textContent = msg;
        this._denyGacha(this.gachaAgain);
      } else {
        if (this.gachaResult) {
          this.gachaResult.textContent = msg;
          this._pulseResult();
        }
        this._denyGacha(this.gachaBtn);
      }
      this.audio?.broken?.();
      return;
    }

    // 先に結果を確定し、言玉と所持語の表示を更新してから幕を開く。
    if (count === 10 && (!Array.isArray(r.results) || r.results.length !== 10)) {
      throw new Error('十連くじの結果が10件ではありません');
    }
    this._lastGacha = r;
    this._gachaCount = count;
    this.renderGrow();
    if (!this._hasGachaStage()) {
      this._showGachaSummary(r);
      this.audio?.gachaReveal?.(!!r.dup);
      return;
    }
    this._openGacha(r);
  }

  _openGacha(r) {
    this._clearGachaTimers();
    this._gachaSpinning = true;
    const v = this.gachaVeil;
    v.hidden = false;
    v.classList.remove('is-revealed', 'gacha-deny');
    v.classList.add('is-spinning');
    this.gachaReels?.classList.add('spinning');
    if (this.gachaAgain) this.gachaAgain.disabled = true;
    if (this.gachaNote) this.gachaNote.textContent = '言玉が舞う — どの語が出るか';
    // 開くまではカードの中身を読み上げない。
    this.gachaCard?.setAttribute?.('aria-hidden', 'true');
    this.gachaClose?.focus?.({ preventScroll: true });

    // リールの目を 55ms ごとに差し替える。
    this._gachaTicks = 0;
    this._reelTick();
    this._gachaTimer = setInterval(() => this._reelTick(), 55);

    if (this._prefersReduced()) {
      // 動きを抑える設定なら、回さずにすぐ開示する。
      this._gachaDelay(() => this._finishGacha(r, true), 60);
      return;
    }

    this.audio?.gachaSpin?.();
    // 3 列が少しずつ止まる。音だけ先に鳴らして「止まる予感」を作る。
    this._gachaDelay(() => this.audio?.gachaLock?.(0), 720);
    this._gachaDelay(() => this.audio?.gachaLock?.(1), 880);
    this._gachaDelay(() => this._finishGacha(r), 1080);
  }

  /** リールの目を差し替える。 */
  _reelTick() {
    const pool = this._reelPoolWords();
    if (!pool.length) return;
    for (const s of this.gachaReelSpans) {
      s.textContent = pool[(Math.random() * pool.length) | 0];
    }
    // 流れる音は控えめに。4 目ごとに 1 回。
    if ((this._gachaTicks++ % 4) === 0) this.audio?.gachaTick?.(this._gachaTicks >> 2);
  }

  /** リールを止め、少し溜めてからカードを開く。 */
  _finishGacha(r, instant = false) {
    if (this._gachaTimer != null) {
      clearInterval(this._gachaTimer);
      this._gachaTimer = null;
    }
    this.gachaReels?.classList.remove('spinning');
    // 止まった瞬間、真ん中の列に結果の語を残す。
    if (this.gachaReelSpans[1]) this.gachaReelSpans[1].textContent = r.results?.length > 1 ? '十' : (r.word || r.results?.[0]?.word || '籤');
    if (!instant) this.audio?.gachaLock?.(2);
    this._setGachaCard(r);
    this._gachaDelay(() => this._revealGacha(r), instant ? 40 : 260);
  }

  /** カードの中身を結果で埋める。 */
  _setGachaCard(r) {
    const batch = r.results?.length > 1 ? r.results : null;
    if (this.gachaLotList) {
      this.gachaLotList.hidden = !batch;
      while (this.gachaLotList.firstChild) this.gachaLotList.removeChild(this.gachaLotList.firstChild);
      if (batch) {
        for (const [i, result] of batch.entries()) {
          const item = document.createElement('div');
          item.className = `gacha-lot-item${result.dup ? ' duplicate' : ''}`;
          const number = document.createElement('span');
          number.className = 'gacha-lot-number';
          number.textContent = String(i + 1).padStart(2, '0');
          const word = document.createElement('b');
          word.textContent = result.word;
          const kind = document.createElement('i');
          kind.textContent = result.dup ? '重複' : '新規';
          item.appendChild(number);
          item.appendChild(word);
          item.appendChild(kind);
          this.gachaLotList.appendChild(item);
        }
      }
    }
    this.gachaCard?.classList.toggle('gacha-card-ten', !!batch);
    const singleFields = [this.gachaWord, this.gachaCat, this.gachaEff, this.gachaSeal, this.gachaNew];
    for (const field of singleFields) if (field) field.hidden = !!batch;
    const shownResult = batch ? r.results[0] : r;
    const info = WORDS[shownResult.word] || {};
    const cat = CATEGORIES[info.cat] || null;
    if (this.gachaWord) this.gachaWord.textContent = shownResult.word;
    if (this.gachaCat) {
      this.gachaCat.textContent = cat ? cat.name : '';
      this.gachaCat.hidden = !!batch || !cat;
    }
    if (this.gachaCard?.style?.setProperty) {
      this.gachaCard.style.setProperty('--cat', cat?.color || '#e0482d');
    }
    if (this.gachaEff) {
      const fx = fxText(info.fx, FX_LABEL);
      const body = info.player ? `体 ${fxText(info.player, PS_LABEL)}` : '';
      const eff = [fx, body].filter((x) => x && x !== '効果なし').join(' / ');
      this.gachaEff.textContent = eff || '効果なし — 文にすると力になる';
      this.gachaEff.hidden = !!batch;
    }
    if (this.gachaSeal) this.gachaSeal.textContent = shownResult.dup ? '重' : '新';
    if (this.gachaSeal) this.gachaSeal.hidden = !!batch;
    if (this.gachaNew) this.gachaNew.hidden = !!batch || !!shownResult.dup;
  }

  /** カードを開く。ここで初めて結果を音と文字で知らせる。 */
  _revealGacha(r) {
    this._gachaSpinning = false;
    const v = this.gachaVeil;
    if (!v) return;
    v.classList.remove('is-spinning');
    v.classList.add('is-revealed');
    this.gachaCard?.removeAttribute?.('aria-hidden');
    if (this.gachaAgain) this.gachaAgain.disabled = false;
    const batch = r.results?.length > 1 ? r.results : null;
    const result = batch ? null : (r.results?.[0] || r);
    if (this.gachaNote) {
      if (batch) {
        const duplicates = batch.filter((item) => item.dup).length;
        this.gachaNote.textContent = `十連くじ完了 — 新規 ${batch.length - duplicates} 語、重複 ${duplicates} 語。言玉は残り ${r.ink}。`;
      } else {
        this.gachaNote.textContent = result.dup
          ? (result.rankUp
            ? `すでに持っている語だった — ランクが「${result.rankName}」に上がった。言玉は残り ${r.ink}。`
            : `すでに最上位 (${result.rankName}) だった。言玉が ${GACHA_REFUND} 戻り、残り ${r.ink}。`)
          : `新しい語を引いた (コモン)。部位に入れるか、デッキに加えよう。言玉は残り ${r.ink}。`;
      }
    }
    this.audio?.gachaReveal?.(batch ? batch.every((item) => item.dup) : !!result.dup);
    // 新しい語のときだけ、開いたあとにきらめきを重ねる。
    if (batch ? batch.some((item) => !item.dup) : !result.dup) this.audio?.gachaShine?.();
    this.gachaAgain?.focus?.({ preventScroll: true });
  }

  /** 幕を閉じ、直近の結果を一行で残す。 */
  closeGacha() {
    if (!this.gachaVeil) return;
    const wasOpen = !this.gachaVeil.hidden;
    this._clearGachaTimers();
    this._gachaSpinning = false;
    this.gachaVeil.hidden = true;
    this.gachaVeil.classList.remove('is-spinning', 'is-revealed', 'gacha-deny');
    this.gachaReels?.classList.remove('spinning');
    this.gachaCard?.classList.remove('gacha-card-ten');
    if (this.gachaLotList) {
      this.gachaLotList.hidden = true;
      while (this.gachaLotList.firstChild) this.gachaLotList.removeChild(this.gachaLotList.firstChild);
    }
    for (const field of [this.gachaWord, this.gachaCat, this.gachaEff, this.gachaSeal, this.gachaNew]) if (field) field.hidden = false;
    if (this.gachaAgain) this.gachaAgain.disabled = false;
    if (!wasOpen) return;
    if (this._lastGacha) this._showGachaSummary(this._lastGacha);
    // 閉じたあとは元の「引く」へ戻す。画面ごと閉じた場合は触らない。
    if (this.grow && !this.grow.hidden) this.gachaBtn?.focus?.({ preventScroll: true });
  }

  /** 幕の外に残す一行。幕が無い環境の結果表示も兼ねる。 */
  _showGachaSummary(r) {
    if (!this.gachaResult || !r) return;
    if (r.results?.length > 1) {
      const duplicates = r.results.filter((result) => result.dup).length;
      this.gachaResult.textContent = `十連くじ: 新規 ${r.results.length - duplicates} 語 / 重複 ${duplicates} 語`;
    } else {
      const result = r.results?.[0] || r;
      this.gachaResult.textContent = result.dup
        ? (result.rankUp
          ? `「${result.word}」— ランク「${result.rankName}」に上がった！`
          : `「${result.word}」— 最上位 (${GACHA_REFUND} 言玉戻った)`)
        : `「${result.word}」を手に入れた (コモン)！`;
    }
    this._pulseResult();
  }

  _pulseResult() {
    const n = this.gachaResult;
    if (!n) return;
    n.classList.remove('gacha-reveal');
    void n.offsetWidth;
    n.classList.add('gacha-reveal');
  }

  /** 言玉不足のとき、押したボタンを短く震わせる。 */
  _denyGacha(node) {
    if (!node) return;
    node.classList.remove('gacha-deny');
    void node.offsetWidth;
    node.classList.add('gacha-deny');
    setTimeout(() => node.classList.remove('gacha-deny'), 420);
  }

  _gachaDelay(fn, ms) {
    const id = setTimeout(() => {
      const i = this._gachaTimers.indexOf(id);
      if (i >= 0) this._gachaTimers.splice(i, 1);
      fn();
    }, ms);
    this._gachaTimers.push(id);
    return id;
  }

  _clearGachaTimers() {
    if (this._gachaTimer != null) {
      clearInterval(this._gachaTimer);
      this._gachaTimer = null;
    }
    for (const id of this._gachaTimers) clearTimeout(id);
    this._gachaTimers.length = 0;
  }

  _prefersReduced() {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch {
      return false;
    }
  }

  // ── タイトル ────────────────────────────────────────────────────────────
  renderTitle() {
    const d = this.save.d;
    $('#recBest').textContent = fmtNum(d.bestScore);
    $('#recClear').textContent = String(d.clearedStages.length);
    $('#recKills').textContent = fmtNum(d.totalKills);
    $('#recRuns').textContent = String(d.totalRuns);
    const broken = $('#recBroken');
    if (broken) broken.textContent = fmtNum(d.totalBroken || 0);
    // タイトルの 1 回目でチュートリアルを出す。閉じた瞬間に seenIntro が立つ。
    if (this.tutorial && this.save?.d && !this.save.d.seenIntro) this.show('tutorial');
  }

  // ── ステージ選択 ────────────────────────────────────────────────────────
  showStages() {
    this._tabFrom = null;
    this.renderStages();
    this.hideAll();
    this.stages.hidden = false;
  }

  renderStages() {
    const list = this.stageList;
    clear(list);
    const maxStage = this.save.maxStage;

    for (const st of STAGES) {
      const locked = st.id > maxStage;
      const cleared = this.save.isCleared(st.id);
      const boss = st.boss ? ENEMIES[st.boss] : null;

      const card = el('button', {
        class: 'stage-card', type: 'button', disabled: locked,
      },
        el('span', { class: 'stage-num' }, String(st.id)),
        el('span', { class: 'stage-meta' },
          el('div', { class: 'stage-name' }, st.name),
          el('div', { class: 'stage-intro' }, locked ? 'まだ開いてない。' : st.intro),
          el('div', { class: 'stage-tags' },
            el('span', { class: 'tag' }, `${Math.floor(st.time / 60)}分${st.time % 60}秒`),
            boss ? el('span', { class: 'tag boss' }, boss.name) : null,
            cleared ? el('span', { class: 'tag done' }, 'クリア済み') : null,
          ),
        ),
        el('span', { class: 'stage-stars' }, cleared ? '★' : ''),
      );
      if (!locked) card.addEventListener('click', () => { this.audio?.tap?.(); this.showLoadout(st.id); });
      list.append(card);
    }
  }

  // ── 武器選択 ────────────────────────────────────────────────────────────
  showLoadout(stageId) {
    this._tabFrom = null;
    this.stageId = stageId;
    const avail = startingWeaponsFor(stageId);
    const unlocked = this.save.d.unlockedWeapons.filter((id) => WEAPONS[id] && avail.includes(id));
    this.picked = (unlocked.length ? unlocked : (avail.length ? [avail[0]] : ['sword'])).slice(0, 1);

    const st = STAGES.find((s) => s.id === stageId);
    this.loadoutTitle.textContent = `第 ${stageId} 戦・${st.name}`;
    this.loadoutSub.textContent = '基本武器を 1 つ選択。開始時の文は武器名だけ。'
      + '戦闘中はデッキの語を選び、文を組み立てる。';

    this.renderLoadout();
    this.hideAll();
    this.loadout.hidden = false;
  }

  renderLoadout() {
    const list = this.loadoutList;
    clear(list);
    const avail = startingWeaponsFor(this.stageId);

    for (const id of Object.keys(WEAPONS)) {
      const d = WEAPONS[id];
      // 基本武器 (武器語) のみ選択可能。形態語由来の武器は除外。
      if (!BASIC_WEAPONS.has(d.tail)) continue;
      const usable = avail.includes(id);
      const on = this.picked.includes(id);
      const lockedByProgress = !!d.unlock && d.unlock.stage > this.stageId;

      const card = el('button', {
        class: `lo-card${on ? ' on' : ''}`, type: 'button',
        disabled: !usable,
        title: lockedByProgress ? `第 ${d.unlock.stage} 戦で解放` : d.desc,
      },
        el('div', { class: 'lo-name' },
          el('span', {}, d.name),
          el('span', { class: 'lo-kind' }, KIND_LABEL[d.kind] || d.kind)),
        el('div', { class: 'lo-core' },
          `初期文「${d.name}」・文 10 文字`),
        el('div', { class: 'lo-desc' },
          lockedByProgress ? `第 ${d.unlock.stage} 戦で解放される` : (usable ? d.desc : '使用不可')),
      );
      if (on) card.append(el('span', { class: 'lo-check' }, '✓'));
      else if (this.save.hasWeapon(id)) card.append(el('span', { class: 'lo-lv' }, '所持'));

      if (usable) {
        card.addEventListener('click', () => { this.audio?.tap?.(); this.togglePick(id); });
      }
      list.append(card);
    }

    this.loadoutCount.textContent = `${this.picked.length} / 1`;
    this.loadoutGo.disabled = this.picked.length === 0;
  }

  togglePick(id) {
    const i = this.picked.indexOf(id);
    if (i >= 0) this.picked.splice(i, 1);
    else if (this.picked.length < 1) this.picked.push(id);
    this.renderLoadout();
  }

  // ── 結算 ────────────────────────────────────────────────────────────────
  showResult({ cleared, run, save, isLast, ink = 0 }) {
    const st = run.stage;
    this.resultTitle.textContent = cleared ? 'ステージクリア' : '力尽きた';
    this.resultTitle.style.color = cleared ? 'var(--accent)' : 'var(--ng)';
    this.resultSub.textContent = cleared
      ? `第 ${st.id} 戦・${st.name} を制した。`
      : `第 ${st.id} 戦・${st.name} で倒れた。`;

    const d = save.d;
    const rows = [
      ['スコア', fmtNum(run.score), true],
      ['言玉', `+${fmtNum(ink)}（所持 ${fmtNum(d.ink)}）`, ink > 0],
      ['討伐数', fmtNum(run.kills)],
      ['到達レベル', `Lv ${run.player.level}`],
      ['与ダメージ', fmtNum(run.dmgDealt)],
      ['被ダメージ', fmtNum(run.dmgTaken)],
      ['生存時間', `${Math.floor(run.time / 60)}分${Math.floor(run.time % 60)}秒`],
      ['最高スコア', fmtNum(d.bestScore)],
    ];
    clear(this.resultStats);
    for (const [k, v, big] of rows) {
      this.resultStats.append(el('div', { class: `rs-row${big ? ' big' : ''}` },
        el('span', {}, k), el('b', {}, v)));
    }

    const hasNext = cleared && !isLast && st.id < STAGES.length;
    this._resultHasNext = hasNext;
    this.resultNext.hidden = false;
    this.resultNext.textContent = hasNext ? '次のステージへ' : 'ホームへ';
    this.hideAll();
    this.result.hidden = false;
  }

  // ── 辞書 ────────────────────────────────────────────────────────────────
  renderDict() {
    if (!this.dictTabs.childElementCount) this.buildDictTabs();
    this.renderDictList();
  }

  buildDictTabs() {
    // 形態語は辞書に載せないので「形態」タブも出さない。
    const cats = [
      ['all', `すべて`, '#2b5cb8'],
      ...Object.entries(CATEGORIES)
        .filter(([k]) => k !== 'form')
        .map(([k, v]) => [k, v.name, v.color]),
    ];
    clear(this.dictTabs);
    for (const [key, label, color] of cats) {
      const b = el('button', {
        class: 'dict-tab' + (this.dictCat === key ? ' on' : ''),
        style: { borderColor: color, color: this.dictCat === key ? color : '' },
      }, label);
      b.addEventListener('click', () => {
        this.audio?.tap?.();
        this.dictCat = key;
        this.buildDictTabs();
        this.renderDictList();
      });
      this.dictTabs.append(b);
    }
  }

  /** 語的效果を短い文にまとめる。ラベルの表は labels.js を共有する。 */
  static fxLine(w) {
    const out = [];
    if (w.fx) {
      for (const [k, v] of Object.entries(w.fx)) {
        if (!v) continue;
        out.push(`${FX_LABEL[k] || k} ${v}`);
      }
    }
    // `p.` で置いた体側の効果。部位強化でだけ効く。
    if (w.player) {
      for (const [k, v] of Object.entries(w.player)) {
        if (!v) continue;
        out.push(`体 ${PS_LABEL[k] || k} ${v}`);
      }
    }
    return out;
  }

  renderDictList() {
    // 形態語 (剣・銃・環 …) は武器の末尾語で、語彙から引けない。辞書にも載せない。
    const all = Object.values(WORDS).filter((w) => w.cat !== 'form' || (w.cats || []).length > 1);
    const q = this.dictQuery;
    const rows = all.filter((w) => {
      if (this.dictCat !== 'all' && !(w.cats || [w.cat]).includes(this.dictCat)) return false;
      if (!q) return true;
      if (w.text.includes(q)) return true;
      if (CONNECTOR_SET.has(w.text) && '接続'.includes(q)) return true;
      const c = CATEGORIES[w.cat];
      return !!c && c.name.includes(q);
    });

    this.dictCount.textContent = `${rows.length} / ${all.length} 語`;
    clear(this.dictList);
    if (!rows.length) {
      this.dictList.append(el('div', { class: 'dict-empty' }, '見つからなかった。'));
      return;
    }
    // 属性 → 効果 → 動詞 → 接続 の順に見せたいのでカテゴリ順に並べる。
    const order = Object.keys(CATEGORIES);
    rows.sort((a, b) => {
      const d = order.indexOf(a.cat) - order.indexOf(b.cat);
      return d !== 0 ? d : a.text.localeCompare(b.text, 'ja');
    });

    for (const w of rows) {
      const cat = CATEGORIES[w.cat] || { name: w.cat, color: '#2b5cb8' };
      const isConn = CONNECTOR_SET.has(w.text);
      const lines = Menus.fxLine(w);
      const phrases = PHRASE_BONUS[w.text];
      const tags = [];
      if (isConn) tags.push('接続詞 — 直前の語に結合');
      if (w.el) tags.push(`属性 ${w.el}`);
      if (w.text.length === 1) tags.push('1 文字');
      if (phrases) tags.push(`熟語 ${Object.keys(phrases).length} 種`);

      this.dictList.append(el('div', { class: 'dict-row' },
        el('span', { class: 'dict-w', style: { borderColor: cat.color, color: cat.color } }, w.text),
        el('span', { class: 'dict-cat', style: { color: cat.color } }, cat.name),
        el('span', { class: 'dict-fx' }, lines.length ? lines.join(' / ') : '—'),
        el('span', { class: 'dict-tags' }, tags.join('・')),
      ));
    }
  }

  // ── 設定 ────────────────────────────────────────────────────────────────
  renderSettings() {
    const s = this.save.d.settings;
    const vol = $('#setVolume');
    const volVal = $('#setVolumeVal');
    const shake = $('#setShake');
    const dmg = $('#setDamage');

    vol.value = String(Math.round(s.volume * 100));
    volVal.textContent = String(Math.round(s.volume * 100));
    shake.checked = s.screenShake !== false;
    dmg.checked = s.showDamage !== false;

    vol.oninput = () => {
      const v = Number(vol.value);
      volVal.textContent = String(v);
      this.audio?.setVolume(v / 100);
      this.save.setSetting('volume', v / 100);
    };
    shake.onchange = () => this.save.setSetting('screenShake', shake.checked);
    dmg.onchange = () => this.save.setSetting('showDamage', dmg.checked);

    const wipe = $('#btnWipe');
    wipe.onclick = () => {
      if (!confirm('記録をすべて消去します。よろしいですか?')) return;
      this.save.reset();
      this.audio?.setVolume(0.5);
      this.renderSettings();
      this.renderTitle();
    };
  }
}
