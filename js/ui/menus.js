// ============================================================================
// ワードローグ — タイトル / ステージ選択 / 武器選択 / 結算 / 設定
// ============================================================================

import { $, el, clear, fmtNum } from '../core/util.js';
import { STAGES } from '../data/stages.js';
import { ENEMIES } from '../data/enemies.js';
import { WEAPONS, startingWeaponsFor, slotsForLevel, KIND_LABEL } from '../data/weapons.js';
import { WORDS, CATEGORIES, CONNECTOR_SET, PHRASE_BONUS } from '../data/words.js';
import { FX_LABEL, PS_LABEL } from './labels.js';
import { META_UPGRADES, SHOP_WORDS } from '../core/save.js';

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

    /** 辞書。検索語と絞り込みカテゴリ。 */
    this.dictQuery = '';
    this.dictCat = 'all';

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
    $('#btnArchive').addEventListener('click', () => { tap(); this.show('archive'); });
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
        // ゲーム中の辞書は main.js が時間を戻すので、そちらに任せる。
        if (b.dataset.close === 'dict' && this.cb.onCloseDict) {
          this.cb.onCloseDict();
          return;
        }
        this.hide(b.dataset.close);
        if (this.stages.hidden && this.title.hidden === false) this.show('title');
      });
    }

    $('#resultRetry').addEventListener('click', () => { tap(); this.cb.onRetry?.(); });
    $('#resultStages').addEventListener('click', () => { tap(); this.cb.onStages?.(); });
    this.resultNext.addEventListener('click', () => { tap(); this.cb.onNext?.(); });

    this.loadoutGo.addEventListener('click', () => { tap(); this.cb.onStart?.(this.picked.slice()); });
  }

  hideAll() {
    for (const k of ['title', 'stages', 'loadout', 'result', 'howto', 'settings', 'dict', 'archive']) {
      this[k].hidden = true;
    }
  }

  /** 辞書を閉じる。ゲーム中は main.js 側で時間を戻す。 */
  hide(name) {
    this[name].hidden = true;
    if (name === 'dict') this.dictSearch.value = '';
  }

  show(name) {
    this.hideAll();
    this[name].hidden = false;
    if (name === 'title') this.renderTitle();
    if (name === 'settings') this.renderSettings();
    if (name === 'dict') this.renderDict();
    if (name === 'archive') this.renderArchive();
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
        }, maxed ? '最大' : `${cost} 墨`),
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
    for (const w of SHOP_WORDS) {
      const owned = save.hasStartingWord(w.text);
      const can = !owned && save.ink >= w.cost;
      const word = WORDS[w.text];
      const b = el('button', {
        class: 'shop-word' + (owned ? ' owned' : '') + (can ? ' can' : ''),
        style: { borderColor: (CATEGORIES[word?.cat] || {}).color || '#8ab4ff' },
        title: `${w.text} [${(CATEGORIES[word?.cat] || {}).name || '?'}]`,
      }, owned ? `${w.text} ✓` : `${w.text}  ${w.cost}`);
      b.addEventListener('click', () => {
        if (owned) return;
        const r = this.save.buyWord(w.text);
        if (r.ok) this.audio?.phrase?.();
        else this.audio?.broken?.();
        this.renderArchive();
      });
      this.archiveWords.append(b);
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
  }

  // ── ステージ選択 ────────────────────────────────────────────────────────
  showStages() {
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
    this.stageId = stageId;
    this.picked = this.save.d.unlockedWeapons
      .filter((id) => WEAPONS[id])
      .slice(0, 2);
    if (!this.picked.length) this.picked = ['sword', 'gun'];

    const st = STAGES.find((s) => s.id === stageId);
    this.loadoutTitle.textContent = `第 ${stageId} 戦・${st.name}`;
    this.loadoutSub.textContent = '武器を 1〜4 つ選べ。武器ごとに末尾の語が決まっている。';

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
          `枠 ${slotsForLevel(d, 1)}・開始「${d.startWord}${d.startWord2}」・末尾「${d.tail}」`),
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

    this.loadoutCount.textContent = `${this.picked.length} / 4`;
    this.loadoutGo.disabled = this.picked.length === 0;
  }

  togglePick(id) {
    const i = this.picked.indexOf(id);
    if (i >= 0) this.picked.splice(i, 1);
    else if (this.picked.length < 4) this.picked.push(id);
    this.renderLoadout();
  }

  // ── 結算 ────────────────────────────────────────────────────────────────
  showResult({ cleared, run, save, isLast }) {
    const st = run.stage;
    this.resultTitle.textContent = cleared ? 'ステージクリア' : '力尽きた';
    this.resultTitle.style.color = cleared ? 'var(--accent)' : 'var(--ng)';
    this.resultSub.textContent = cleared
      ? `第 ${st.id} 戦・${st.name} を制した。`
      : `第 ${st.id} 戦・${st.name} で倒れた。`;

    const d = save.d;
    const rows = [
      ['スコア', fmtNum(run.score), true],
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

    this.resultNext.hidden = !cleared || isLast;
    this.resultNext.textContent = isLast ? '全ステージ制覇' : '次のステージ';
    this.hideAll();
    this.result.hidden = false;
  }

  // ── 辞書 ────────────────────────────────────────────────────────────────
  renderDict() {
    if (!this.dictTabs.childElementCount) this.buildDictTabs();
    this.renderDictList();
  }

  buildDictTabs() {
    const cats = [
      ['all', `すべて`, '#8ab4ff'],
      ...Object.entries(CATEGORIES).map(([k, v]) => [k, v.name, v.color]),
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
    // 「自身」向けの語は fx と player が同じ内容。そっち側にだけ出す。
    const own = w.cat === 'buff';
    if (w.fx && !own) {
      for (const [k, v] of Object.entries(w.fx)) {
        if (!v) continue;
        out.push(`${FX_LABEL[k] || k} ${v}`);
      }
    }
    if (w.player) {
      for (const [k, v] of Object.entries(w.player)) {
        if (!v) continue;
        out.push(`自身 ${PS_LABEL[k] || k} ${v}`);
      }
    }
    return out;
  }

  renderDictList() {
    const all = Object.values(WORDS);
    const q = this.dictQuery;
    const rows = all.filter((w) => {
      if (this.dictCat !== 'all' && w.cat !== this.dictCat) return false;
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
      const cat = CATEGORIES[w.cat] || { name: w.cat, color: '#8ab4ff' };
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
