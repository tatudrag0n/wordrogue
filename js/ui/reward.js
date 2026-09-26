// ============================================================================
// ワードローグ — 報酬画面
//
// ステージクリア時に「武器 / 武器強化 / 休息」から 1 つ選ぶ。
// ことばは戦闘中のレベルアップで入るので、ここでは配らない。
// ============================================================================

import { $, el, clear } from '../core/util.js';
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

    /** @type {Function} 実際に確定したときのコールバック */
    this.onPick = null;
  }

  hide() { this.root.hidden = true; this.onPick = null; }

  /**
   * @param {Array<object>} cards
   * @param {Function} onPick
   * @param {{title?:string, sub?:string}} opt
   */
  show(cards, onPick, opt = {}) {
    this.onPick = onPick;
    this.title.textContent = opt.title || 'クリア報酬';
    this.sub.textContent = opt.sub || '1 つ選べ。';

    clear(this.list);
    for (const c of cards) this.list.append(this.card(c));
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

  /** カードを選んだ。 */
  choose(c, node) {
    this.opt.audio?.tap?.();
    this.finish(c, node);
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
  weapon:   '武器',
  weaponup: '武器強化',
  self:     '自身の強化',
  rest:     '休息',
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

  // ── 武器強化。持ってる武器は 1 枚ずつ候補に出す ──
  // 強化できる武器が 1 つしかないとカードの枠が空くので、
  // 持ってるものを順番をばらして並べる。
  const upgradable = run.weapons.filter((w) => w.level < w.def.maxLevel);
  for (let i = upgradable.length - 1; i > 0; i--) {
    const j = rand.int(i + 1);
    [upgradable[i], upgradable[j]] = [upgradable[j], upgradable[i]];
  }
  for (const w of upgradable) {
    if (out.length >= poolSize) break;
    const atCap = (w.level + 1 >= 3 && w.level < 3) || (w.level + 1 >= 6 && w.level < 6);
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
      desc: `${d.desc} 開始「${d.startWord}${d.startWord2}」`,
      fx: `枠 ${slotsForLevel(d, 1)} 個`,
      apply: () => {
        run.weapons.push(new WeaponInst(id, 1));
        save.unlockWeapon(id);
        run.refreshStats();
      },
    });
  }

  // ── 休息。候補が足りないときの埋め。ことばは配らない ──
  if (out.length < poolSize) {
    const p = run.player;
    const full = p.hp >= p.maxHp;
    const amount = full ? p.maxHp : Math.round(p.maxHp * 0.4);
    out.push({
      kind: 'rest',
      id: 'rest',
      word: null,
      glyph: '休',
      color: '#6fcf97',
      name: full ? '休んで全回復' : '休んで回復',
      desc: full ? '体力をすべて戻す。' : '体力を 4 割戻す。',
      fx: `HP +${amount}`,
      apply: () => run.healPlayer(amount),
    });
  }

  // ことばは戦闘中のレベルアップで入るので、ステージ報酬では配らない。

  return out.slice(0, poolSize);
}
