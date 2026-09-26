// ============================================================================
// ワードローグ — 報酬画面
//
// ステージクリア時に「ことば / 武器 / 自身の強化」から 1 つ選ぶ。
// 語袋が満杯のときは、捨てる語を選ばせる。
// ============================================================================

import { $, el, clear } from '../core/util.js';
import { WORDS, CATEGORIES, PARTICLES, makeWord, DRAWABLE_ALL } from '../data/words.js';
import { WEAPONS, slotsForLevel } from '../data/weapons.js';
import { WeaponInst } from '../game/weapon.js';

export class RewardScreen {
  /**
   * @param {{audio:object}} opt
   */
  constructor(opt) {
    this.opt = opt;
    this.root = $('#reward');
    this.title = $('#rewardTitle');
    this.sub = $('#rewardSub');
    this.list = $('#rewardList');
    this.swap = $('#rewardSwap');
    this.swapList = $('#swapList');

    /** @type {object|null} いま選んでいるカード */
    this.pending = null;
    /** @type {Function} 実際に確定したときのコールバック */
    this.onPick = null;
  }

  hide() { this.root.hidden = true; this.pending = null; this.onPick = null; }

  /**
   * @param {Array<object>} cards
   * @param {Function} onPick
   * @param {{title?:string, sub?:string}} opt
   */
  show(cards, onPick, opt = {}) {
    this.onPick = onPick;
    this.pending = null;
    this.title.textContent = opt.title || 'クリア報酬';
    this.sub.textContent = opt.sub || '1 つ選べ。';

    clear(this.list);
    for (const c of cards) this.list.append(this.card(c));
    this.swap.hidden = true;
    clear(this.swapList);
    this.root.hidden = false;
  }

  card(c) {
    const node = el('button', {
      class: 'rw-card', type: 'button', dataset: { kind: c.kind },
    },
      el('span', { class: 'rw-kind' }, KIND_LABEL[c.kind] || c.kind),
      el('span', { class: 'rw-glyph', style: { color: c.color || 'var(--fg)' } }, c.glyph),
      el('span', { class: 'rw-name' }, c.name),
      c.desc ? el('span', { class: 'rw-desc' }, c.desc) : null,
      c.fx ? el('span', { class: 'rw-fx' }, c.fx) : null,
    );
    node.addEventListener('click', () => this.choose(c, node));
    return node;
  }

  /** カードを選んだ。語袋が満杯なら交換画面を出す。 */
  choose(c, node) {
    this.opt.audio?.tap?.();

    if (c.kind === 'word' && this.needSwap(c)) {
      this.pending = c;
      this.showSwap(c, node);
      return;
    }
    this.finish(c);
  }

  needSwap(c) {
    const { pouch } = this.opt;
    const free = pouch.filter((x) => !x).length;
    return free < (c.count || 1);
  }

  showSwap(c, node) {
    const { pouch } = this.opt;
    this.swap.hidden = false;
    clear(this.swapList);
    for (const w of pouch) {
      if (!w) continue;
      const info = WORDS[w.text];
      const cat = CATEGORIES[info?.cat] || CATEGORIES.modifier;
      const btn = el('div', {
        class: 'pword' + (PARTICLES.has(w.text) ? ' pword-gram' : ''),
        style: { borderColor: cat.color },
        title: `${w.text} を捨てる`,
      }, el('span', {}, w.text));
      btn.addEventListener('click', () => {
        const idx = pouch.indexOf(w);
        if (idx >= 0) pouch[idx] = null;
        this.opt.onDropWord?.(w);
        this.swap.hidden = true;
        this.finish(c, node);
      });
      this.swapList.append(btn);
    }
  }

  finish(c, node) {
    if (node) node.style.outline = '2px solid var(--accent)';
    this.opt.onGive?.(c);
    const cb = this.onPick;
    this.root.hidden = true;
    this.onPick = null;
    this.pending = null;
    cb?.(c);
  }
}

const KIND_LABEL = {
  word:     'ことば',
  weapon:   '武器',
  weaponup: '武器強化',
  self:     '自身の強化',
};

/**
 * 報酬の候補を組み立てる。
 * @param {object} run
 * @param {object} save
 * @param {object} opts
 */
export function rollRewards(run, save, opts = {}) {
  const rand = run.rand;
  const out = [];
  const stageId = run.stage.id;
  const poolSize = opts.count || 3;

  const has = (id) => run.weapons.some((w) => w.defId === id);
  const unlocked = (id) => {
    const u = WEAPONS[id].unlock;
    return !u || u.stage <= stageId;
  };
  const owned = (id) => run.weapons.some((w) => w.defId === id);

  // ── 武器强化 (持ってる武器のレベルを上げる) ──
  const upgradable = run.weapons.filter((w) => w.level < w.def.maxLevel);
  if (upgradable.length && out.length < poolSize) {
    const w = upgradable[rand.int(upgradable.length)];
    const atCap = w.level + 1 >= 3 && w.level < 3 || w.level + 1 >= 6 && w.level < 6;
    out.push({
      kind: 'weaponup',
      id: `up:${w.defId}`,
      weaponId: w.defId,
      word: null,
      glyph: w.def.name,
      color: 'var(--accent)',
      name: `${w.def.name} を Lv${w.level + 1} に`,
      desc: atCap ? '枠が 1 つ増える。' : w.def.desc,
      fx: `威力 +${w.def.grow.dmg.toFixed(1)}  攻撃/秒 +${w.def.grow.rate.toFixed(2)}`,
      apply: () => {
        w.levelUp();
        run.refreshStats();
      },
    });
  }

  // ── 新武器 ──
  const newWeapons = Object.keys(WEAPONS)
    .filter((id) => unlocked(id) && !has(id) && run.weapons.length < 4);
  if (newWeapons.length && out.length < poolSize) {
    const id = newWeapons[rand.int(newWeapons.length)];
    const d = WEAPONS[id];
    out.push({
      kind: 'weapon',
      id: `new:${id}`,
      word: null,
      glyph: d.name,
      color: 'var(--thunder)',
      name: `${d.name} を手に入れる`,
      desc: `${d.desc} 核語「${d.core}」`,
      fx: `枠 ${slotsForLevel(d, 1)} 個`,
      apply: () => {
        run.weapons.push(new WeaponInst(id, 1));
        save.unlockWeapon(id);
        run.refreshStats();
      },
    });
  }

  // ── 語 ──
  const wordPool = opts.words || null;
  while (out.length < poolSize) {
    const text = wordPool ? wordPool[rand.int(wordPool.length)] : pickWord(rand);
    if (!text) break;
    const info = WORDS[text];
    if (!info) continue;
    const cat = CATEGORIES[info.cat] || CATEGORIES.modifier;
    out.push({
      kind: 'word',
      id: `word:${text}`,
      text,
      count: 1,
      glyph: text,
      color: cat.color,
      name: `「${text}」`,
      desc: PARTICLES.has(text) ? '助詞。文をつなぐ。' : `${cat.name}の語。`,
      fx: fxSummary(info),
      apply: () => {
        run.addWord(makeWord(text), true, true);
      },
    });
  }

  return out.slice(0, poolSize);
}

/** 重み付き抽選で語を引く。助詞 (文語) も候補に入る。 */
function pickWord(rand) {
  const table = DRAWABLE_ALL;
  if (!table.length) return null;
  // 属性語と形態語が多めに混ざるよう重みを付ける。
  const weighted = [];
  for (const w of table) {
    const c = WORDS[w].cat;
    const n = c === 'element' ? 3
      : c === 'form' ? 3
      : c === 'modifier' ? 4
      : c === 'grammar' ? 1
      : 1;
    for (let i = 0; i < n; i++) weighted.push(w);
  }
  return weighted[rand.int(weighted.length)];
}

function fxSummary(info) {
  const parts = [];
  for (const [k, v] of Object.entries(info.fx || {})) {
    if (Math.abs(v) < 0.01) continue;
    parts.push(`${FX_LABEL[k] || k}${v > 0 ? '+' : ''}${Math.round(v * 100) / 100}`);
  }
  for (const [k, v] of Object.entries(info.player || {})) {
    if (Math.abs(v) < 0.01) continue;
    parts.push(`自身${PS_LABEL[k] || k}${v > 0 ? '+' : ''}${Math.round(v * 100) / 100}`);
  }
  return parts.slice(0, 5).join('  ');
}

const FX_LABEL = {
  dmg: '威力', rate: '攻撃/秒', speed: '速さ', count: '数', pierce: '貫通',
  split: '分裂', bounce: '反射', chain: '連鎖', orbit: '回転', size: '大きさ',
  area: '範囲', range: '間合い', arc: '扇', spread: '散り', crit: '会心',
  critDmg: '会心威力', homing: '追尾', duration: '持続', explode: '爆発',
  burn: '炎上', poison: '毒', chill: '減速', shock: '感電', freeze: '凍結',
  lifesteal: '吸血', regen: '回復', shield: 'シールド', knock: '撃退',
  recoil: '反動', magnet: '吸引', slowImmune: '減速耐性', reflect: '反射',
  armor: '装甲', power: '文力', atkMul: '攻撃', xpMul: '経験値',
  dmgMul: '威力',
};

const PS_LABEL = {
  hp: '体力', spd: '移動', atk: '攻撃', armor: '装甲', crit: '会心',
  regen: '回復', lifesteal: '吸血', luck: '幸運', magnet: '吸引',
  xp: '経験値', size: '大きさ', shield: 'シールド',
};
