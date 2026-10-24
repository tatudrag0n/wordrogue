// ============================================================================
// ワードローグ — タイトル / ステージ選択 / 武器選択 / 結算 / 設定
// ============================================================================

import { $, el, clear, fmtNum } from '../core/util.js';
import { STAGES } from '../data/stages.js';
import { ENEMIES } from '../data/enemies.js';
import { WEAPONS, BASIC_WEAPONS, startingWeaponsFor, KIND_LABEL, WEAPON_MAX } from '../data/weapons.js';
import { WORDS, CATEGORIES, CONNECTOR_SET, PHRASE_BONUS } from '../data/words.js';
import { evaluatePart, partConnChoices, partWordForms } from '../game/parts.js';
import {
  partEffectRows, partTotalRows, wordEffectRows, wordDirectEffectRows,
} from '../game/stats.js';
import { ROLE_LABEL } from '../data/words.connect.js';
import { FX_LABEL, PS_LABEL } from './labels.js';
import {
  META_UPGRADES, PARTS, PART_SLOTS, DECK_MIN, DECK_MAX, GACHA_COST, GACHA_REFUND,
} from '../core/save.js';

/** 接続詞の役割の見出し。 */
const ROLE_ORDER = ['adn', 'adv', 'case'];
function roleLabelOf(role) { return `${ROLE_LABEL[role] || role}の形`; }

/**
 * この枠に今この接続詞を付けたとき、部位の文が成っているか。
 * 接続詞を外した状態は語だけで決まる。
 */
function partValidWithConn(words, index, conn) {
  const w = (words || []).map((x) => ({ text: x.text, conn: x.conn }));
  if (w[index]) w[index].conn = conn || null;
  return evaluatePart(w.filter(Boolean)).valid;
}

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
    this.archive = $('#archive');
    this.archiveInk = $('#archiveInk');
    this.archiveUpgrades = $('#archiveUpgrades');
    this.archiveWords = $('#archiveWords');
    this.grow = $('#grow');
    this.growInk = $('#growInk');
    this.gachaBtn = $('#gachaBtn');
    this.gachaResult = $('#gachaResult');
    this.growParts = $('#growParts');
    this.growTotal = $('#growTotal');
    this.growSelNote = $('#growSelNote');
    this.growWords = $('#growWords');
    this.deckWords = $('#deckWords');
    this.deckCount = $('#deckCount');
    /** 部位に入れるために選んでいる語。 */
    this.growSel = null;
    /** 接続詞の一覧を開いている枠 { part, slot }。 */
    this.growConn = null;
    // チュートリアル。初回の 1 回だけ自動で出す (save.d.seenIntro)。
    // #tutorial が無い環境 (テストの最小 DOM) でも死なないように取っておく。
    this.tutorial = $('#tutorial');
    this.tutStepEl = this.tutorial ? $('#tutStep') : null;
    this.tutSteps = this.tutorial ? [...this.tutorial.querySelectorAll('.tut-step')] : [];
    this.tutIdx = 0;
    /** 「ほかの接続詞」を開いている枠 ("part:slot")。 */
    this.growConnAll = null;
    /** 詳細 note に出す一次性のメッセージ。renderGrow で消す。 */
    this.growNote = '';

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
    $('#btnArchive').addEventListener('click', () => { tap(); this.show('archive'); });
    this.gachaBtn.addEventListener('click', () => {
      tap();
      this.gachaBtn.classList.remove('gacha-spin');
      this.gachaResult.classList.remove('gacha-reveal');
      void this.gachaBtn.offsetWidth;
      this.gachaBtn.classList.add('gacha-spin');
      const r = this.save.drawGacha();
      this.renderGrow();
      if (!r.ok) {
        this.gachaResult.textContent = r.reason === 'ink' ? '言玉が足りない' : '引けなかった';
        this.audio?.broken?.();
      } else if (r.dup) {
        this.gachaResult.textContent = `「${r.word}」— すでに持っている (${GACHA_REFUND} 言玉戻った)`;
        this.audio?.tap?.();
      } else {
        this.gachaResult.textContent = `「${r.word}」を手に入れた！`;
        this.audio?.phrase?.();
      }
      this.gachaResult.classList.remove('gacha-reveal');
      void this.gachaResult.offsetWidth;
      this.gachaResult.classList.add('gacha-reveal');
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
  }

  hideAll() {
    for (const k of ['title', 'stages', 'loadout', 'result', 'howto', 'settings', 'dict', 'archive', 'grow']) {
      this[k].hidden = true;
    }
    // #tutorial は DOM ごと無い環境があるので、存在するときだけ伏せる。
    if (this.tutorial) this.tutorial.hidden = true;
  }

  /** 辞書を閉じる。ゲーム中は main.js 側で時間を戻す。 */
  hide(name) {
    this[name].hidden = true;
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
    if (['howto', 'archive', 'dict', 'settings', 'grow', 'tutorial'].includes(name)) {
      const base = ['title', 'stages', 'loadout', 'result']
        .find((k) => !this[k].hidden);
      this._tabFrom = base || null;
    } else {
      this._tabFrom = null;
    }
    this.hideAll();
    this[name].hidden = false;
    if (name === 'title') this.renderTitle();
    if (name === 'settings') this.renderSettings();
    if (name === 'dict') this.renderDict();
    if (name === 'archive') this.renderArchive();
    if (name === 'grow') this.renderGrow();
    if (name === 'tutorial') this.renderTutorial();
  }

  isVisible(name) {
    return !!this[name] && !this[name].hidden;
  }

  back() {
    if (this.tutorial && !this.tutorial.hidden) { this.closeTutorial(); return true; }
    for (const name of ['howto', 'settings', 'archive', 'grow']) {
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
  // 部位は 1 文として数える (武器と同じ仕組み)。1 部位に 2 語まで入れられて、
  // 語の直後に **接続詞** が選べる。接続詞はその語のプール (送り仮名) だけ。
  // 枠の ✕ でいつでも外れる — 語を選んだまま枠を押しても外れる。

  /** 空いている部位の枠。選んだ語をここに置く。 */
  renderGrowGap(part, i) {
    const slot = el('button', {
      class: 'btn grow-slot empty', type: 'button',
      title: this.growSel ? `選んだ「${this.growSel}」をここに入れる` : 'まず下の所持語から語を選んでください',
    }, el('span', {}, '＋'));
    slot.addEventListener('click', () => {
      if (!this.growSel) {
        this.growNote = '先に下の「所持語」から語を選んでください';
        this.audio?.broken?.();
        this.renderGrow();
        return;
      }
      this.save.setPart(part.id, i, this.growSel);
      this.audio?.phrase?.();
      this.renderGrow();
    });
    return slot;
  }

  /** 能力の差分を 1 行のチップにする (「体力 +25」など)。 */
  effectChips(rows, cls = 'eff') {
    return rows.map((r) => el('span', { class: `${cls} up`, title: r.label + ' ' + r.text },
      el('i', {}, r.label), r.text));
  }

  /** 語が入っている部位の枠。語 (タップで接続詞が回る) + 接続詞 + ✕。 */
  renderGrowSlot(part, i, entry, words) {
    const save = this.save;
    const box = el('div', { class: 'grow-slot filled' });
    const open = this.growConn && this.growConn.part === part.id && this.growConn.slot === i;
    // 接続詞は自由に選べる。まず「その語の形」、次に「熟語の形」、最後に残り。
    // 全部を試すのは一覧を開いているときだけ (1 枠 105 通りの評価になるため)。
    const choices = open ? partConnChoices(words, i) : null;
    const own = partWordForms(entry.text);
    const cycle = own.filter((k) => partValidWithConn(words, i, k));
    const list = cycle.length ? cycle : own;

    const word = el('button', {
      class: 'btn gs-word', type: 'button',
      title: `「${entry.text}」\nタップ: 接続詞を順に切り替える (${list.join(' → ') || '無し'} → 無し)`
        + (this.growSel && this.growSel !== entry.text
            ? `\n今「${this.growSel}」を選んでいるので、押すとその語に置き換わる` : '')
        + (this.growSel === entry.text ? '\n選んでいる語と同じなので、押すとこの枠から外れる' : ''),
    }, el('span', {}, entry.text));
    word.addEventListener('click', () => {
      if (this.growSel && this.growSel !== entry.text) {
        save.setPart(part.id, i, this.growSel);   // 選んでいる語で置き換える
        this.audio?.phrase?.();
      } else if (this.growSel === entry.text) {
        save.setPart(part.id, i, entry.text);      // 同じ語 → 外す (取り外せる)
        this.audio?.tap?.();
      } else {
        // 接続詞を 1 つ進める。一周したら無し。
        const at = list.indexOf(entry.conn);
        const next = at + 1 < list.length ? list[at + 1] : null;
        save.setPartConn(part.id, i, next);
        if (next) this.audio?.phrase?.(); else this.audio?.tap?.();
      }
      this.renderGrow();
    });

    const validNow = partValidWithConn(words, i, entry.conn);
    const conn = el('button', {
      class: 'btn gs-conn' + (entry.conn ? ' filled' : '') + (entry.conn && !validNow ? ' bad' : ''),
      type: 'button',
      title: entry.conn
        ? `接続詞「${entry.conn}」— 別の接続詞を選ぶ`
        : '接続詞を選ぶ (押すと一覧が開く)',
    }, el('span', {}, entry.conn || '接続詞'));
    if (open) conn.classList.add('on');
    conn.addEventListener('click', () => {
      this.growConn = open ? null : { part: part.id, slot: i };
      this.audio?.tap?.();
      this.renderGrow();
    });

    const out = el('button', {
      class: 'gs-out', type: 'button',
      title: `${entry.text} を部位から外す`, 'aria-label': `${entry.text} を外す`,
    }, el('span', {}, '✕'));
    out.addEventListener('click', () => {
      save.setPart(part.id, i, null);
      this.growConn = null;
      this.audio?.tap?.();
      this.renderGrow();
    });

    box.append(word, conn, out);
    if (open) box.append(this.renderGrowConnMenu(part, i, words, choices));
    return box;
  }

  /**
   * 接続詞の一覧。枠の下にインラインで出す (画面の位置を計算しない)。
   * 部位はどの接続詞でも選べるので、3 段に分けて出す。
   *   ① 無し
   *   ② その語の形 (プールの送り仮名) と、熟語の形 … まずこれを選べばよい
   *   ③ ほか全部 … 並びによっては文が壊れる。✓ / ✕ を付けて出す
   * ✓ の付いた形は文が成り立って効果が出る。✕ は不成文 (理由を下に出す)。
   */
  renderGrowConnMenu(part, i, words, choices) {
    const menu = el('div', { class: 'grow-conn-menu' });
    const cur = (words[i] && words[i].conn) || null;
    const pick = (text) => {
      this.save.setPartConn(part.id, i, text);
      this.growConn = null;
      this.audio?.phrase?.();
      this.renderGrow();
    };
    const chip = (c) => {
      const b = el('button', {
        class: 'btn grow-conn-pick' + (c.text === cur ? ' cur' : '')
          + (c.valid ? ' ok' : ' no') + (c.source !== 'other' ? ' own' : ''),
        type: 'button',
        title: `${words[i].text}${c.text} — ${c.valid ? '文が成る' : '不成文'}\n${c.roleLabel}。${c.desc}`
          + (c.source === 'word' ? '\nこの語の形' : c.source === 'compound' ? '\n熟語の形' : '')
          + (!c.valid && c.reason ? `\n${c.reason}` : ''),
      }, el('span', {}, c.text));
      b.addEventListener('click', () => pick(c.text));
      return b;
    };

    const off = el('button', {
      class: 'btn grow-conn-pick' + (!cur ? ' cur' : ''), type: 'button', title: '接続詞を外す',
    }, el('span', {}, '無し'));
    off.addEventListener('click', () => pick(null));
    menu.append(off);

    const own = choices.filter((c) => c.source !== 'other');
    const rest = choices.filter((c) => c.source === 'other');
    const okOwn = own.filter((c) => c.valid);
    const okRest = rest.filter((c) => c.valid);

    if (own.length) {
      menu.append(el('span', { class: 'grow-conn-head' }, 'この語の形'));
      for (const c of own) menu.append(chip(c));
    } else {
      menu.append(el('span', { class: 'grow-conn-none' },
        `「${words[i].text}」に元から付く送り仮名は無い`));
    }

    // その並びで文が成る形は、語の形でなくても先に出す。
    for (const c of okRest) menu.append(chip(c));

    // それ以外は畳んでおく。押すと開く。
    if (rest.length > okRest.length) {
      const others = rest.filter((c) => !c.valid);
      const open = this.growConnAll === `${part.id}:${i}`;
      const more = el('button', {
        class: 'btn grow-conn-more', type: 'button',
        title: 'ほかの接続詞 (並びによっては不成文になる)',
      }, open ? 'ほかを閉じる' : `ほかの接続詞 (${others.length})`);
      more.addEventListener('click', () => {
        this.growConnAll = open ? null : `${part.id}:${i}`;
        this.audio?.tap?.();
        this.renderGrow();
      });
      menu.append(more);
      if (open) {
        const groups = el('div', { class: 'grow-conn-all' });
        for (const role of ROLE_ORDER) {
          const inRole = others.filter((c) => c.role === role);
          if (!inRole.length) continue;
          groups.append(el('span', { class: 'grow-conn-head' }, roleLabelOf(role)));
          for (const c of inRole) groups.append(chip(c));
        }
        menu.append(groups);
      }
    }

    const mark = el('span', { class: 'grow-conn-legend' },
      el('i', { class: 'ok' }, '✓'), 'は文が成る形。', el('i', { class: 'no' }, '✕'), 'は不成文 (効果なし)。');
    menu.append(mark);
    return menu;
  }

  /**
   * 部位の評価。**何がどれだけ変わるか** を必ず数字で出す。
   * 語そのものが武器用で効かない場合は、そう言い切る。
   */
  renderGrowPartNote(part, words) {
    if (!words.length) {
      return el('div', { class: 'grow-part-note empty' },
        'から — 下の所持語を選んで枠を押すと入る');
    }
    const p = evaluatePart(words);
    const effects = partEffectRows(this.save.partEntries(), part.id, this.save.d.meta);
    const box = el('div', { class: 'grow-part-note ' + (p.valid ? p.ev.grade : 'bad') });

    if (!p.valid) {
      box.append(el('b', {}, '不成文 — 効果なし'));
      box.append(el('span', {}, p.reasonText || '文になっていない'));
      const fix = partConnChoices(words, words.length - 1).filter((c) => c.valid);
      box.append(el('span', { class: 'grow-part-fix' },
        fix.length
          ? `直すなら「${words[words.length - 1].text}」に ${fix.slice(0, 4).map((c) => c.text).join(' / ')}`
          : 'この 2 語では文にならない。語を入れ替えるか、並びを変える'));
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
        'この語は体に直接は効かない — もう 1 語足して文にすると、文の力ぶんだけ強くなる'));
    } else {
      box.append(el('div', { class: 'grow-part-eff none' },
        '文は成っているが、この語は体に効かない — 装甲・盾などの効果を持つ語 (甲・鍔 など) に入れ替える'));
    }
    return box;
  }

  renderGrow() {
    const save = this.save;
    this.growInk.textContent = String(save.ink);
    this.gachaBtn.textContent = `引く (${GACHA_COST} 言玉)`;
    this.gachaBtn.classList.toggle('off', save.ink < GACHA_COST);

    // 全部位の合計。ここだけ見れば「今どう強くなっているか」が分かる。
    if (this.growTotal) {
      const meta = save.d.meta || {};
      const rows = partTotalRows(save.partEntries(), meta);
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

    // 部位。空いた枠に選んだ語が入る。語の右が接続詞、✕ で外れる。
    clear(this.growParts);
    for (const p of PARTS) {
      const words = save.partRaw(p.id).filter(Boolean);
      const box = el('div', { class: 'grow-part' + (words.length ? ' filled' : '') });
      box.append(el('span', { class: 'grow-part-name' }, p.name));
      const sen = el('div', { class: 'grow-sen' });
      for (let i = 0; i < PART_SLOTS; i++) {
        sen.append(words[i]
          ? this.renderGrowSlot(p, i, words[i], words)
          : this.renderGrowGap(p, i));
      }
      box.append(sen);
      box.append(this.renderGrowPartNote(p, words));
      this.growParts.append(box);
    }

    const note = this.growNote ? `${this.growNote} — ` : '';
    const body = this.growSel
      ? `「${this.growSel}」を選択中 — 空いた枠を押すと入り、入っている語を押すと外れる。語の右の「接続詞」で文を整えられる`
      : '部位は 1 文。語の右の「接続詞」を押すと、その語に付く形を選べる';
    const extra = this._growEffectNote ? ` — ${this._growEffectNote}` : '';
    this.growSelNote.textContent = `${note}${body}${extra}`;
    this.growNote = '';
    this._growEffectNote = '';

    // 所持語 (部位用)。押すと選択。部位の語はそのまま能力に効く。
    clear(this.growWords);
    for (const t of save.collection) {
      const info = WORDS[t];
      if (!info) continue;
      // 語が持つ効果は武器側 (fx) と体側 (player) の 2 つ。両方見せる。
      const src = [fxText(info.fx, FX_LABEL), info.player ? `体 ${fxText(info.player, PS_LABEL)}` : '']
        .filter((x) => x && x !== '効果なし').join(' / ') || '効果なし';
      const used = save.partWordList().filter((x) => x === t).length;
      // この語を単体で部位に入れると何が変わるか。
      //   direct … 語そのものが体に効くか (体力 +25 など)
      //   eff    … 文の力ぶんも含めた効き (文が成ればどの語でも少し乗る)
      const direct = wordDirectEffectRows(t, save.d.meta || {});
      const eff = wordEffectRows(t, save.d.meta || {});
      const b = el('button', {
        class: 'btn grow-word' + (this.growSel === t ? ' sel' : '') + (used ? ' used' : '')
          + (direct.length ? ' has-eff' : ' no-eff'),
        title: `${CATEGORIES[info.cat]?.name || info.cat}: ${src}`
          + (direct.length ? `\n体に効く: ${direct.map((r) => `${r.label} ${r.text}`).join(' / ')}`
            : '\n体に直接は効かない (文にすれば文の力ぶん強くなる)')
          + (eff.length && !direct.length ? '\n文にすれば文の力ぶんだけ強くなる' : '')
          + (used ? `\n部位に ${used} 語入っている (同じ語をいくつでも置ける)` : ''),
      }, t, used ? el('i', { class: 'grow-word-used' }, `×${used}`) : null);
      if (direct.length) b.append(el('i', { class: 'grow-word-eff' }, direct.map((r) => r.text).join(' ')));
      b.addEventListener('click', () => {
        this.growSel = this.growSel === t ? null : t;
        this.growConn = null;
        this.growConnAll = null;
        if (!direct.length) this._growEffectNote = `「${t}」は体に直接は効かない — 装甲・盾などの効果を持つ語 (甲・鍔…) は部位で強く効く`;
        this.audio?.tap?.();
        this.renderGrow();
      });
      this.growWords.append(b);
    }

    // 言葉デッキ。押すと出し入れ。戦闘開始時の語彙になる。
    const maxLabel = Number.isFinite(DECK_MAX) ? `${DECK_MAX}` : '∞';
    this.deckCount.textContent = `${save.deck.length} / ${maxLabel} 語 (最低 ${DECK_MIN})`;
    clear(this.deckWords);
    for (const t of save.collection) {
      const inDeck = save.inDeck(t);
      const b = el('button', {
        class: 'btn grow-word deck' + (inDeck ? ' in' : ''),
        disabled: inDeck && save.deck.length <= DECK_MIN,
        title: inDeck ? (save.deck.length <= DECK_MIN ? `最低 ${DECK_MIN} 語を保つため外せない` : 'デッキに入っている — 押すと外れる') : '押すとデッキに入る',
      }, (inDeck ? '✓ ' : '') + t);
      b.addEventListener('click', () => {
        save.toggleDeck(t);
        this.audio?.tap?.();
        this.renderGrow();
      });
      this.deckWords.append(b);
    }
  }

  // ── 書庫 (恒久進行) ──────────────────────────────────────────────────────
  renderArchive() {
    const save = this.save;
    this.archiveInk.textContent = String(save.ink);

    clear(this.archiveUpgrades);
    for (const [key, u] of Object.entries(META_UPGRADES)) {
      const lv = save.metaLevel(key);
      const cost = save.metaCost(key);
      const maxed = cost === null;
      const can = !maxed && save.ink >= cost;
      const row = el('div', { class: 'up-row' + (can ? ' can' : '') },
        el('span', { class: 'up-name' }, u.name),
        el('span', { class: 'up-lv' }, `${lv} / ${u.max}`),
        el('span', { class: 'up-desc' }, u.desc),
        el('button', {
          class: 'btn up-buy' + (can ? '' : ' off'),
        }, maxed ? '最大' : `${cost} 言玉`),
      );
      if (!maxed) {
        row.querySelector('.up-buy').addEventListener('click', () => {
          const r = this.save.buyMeta(key);
          if (r.ok) this.audio?.phrase?.();
          else this.audio?.broken?.();
          this.renderArchive();
        });
      }
      this.archiveUpgrades.append(row);
    }

    clear(this.archiveWords);
    this.archiveWords.append(el('p', { class: 'muted' },
      '言玉は恒久強化と「語彙」の枠 (最大 30 個) のほか、'
      + 'タイトルの「部位強化」の言葉くじでも使う。'));
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
