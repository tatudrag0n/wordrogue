// ============================================================================
// ワードローグ — ラン (1 ステージのプレイ単位)
//
// 状態遷移:
//   playing -> clear | dead
// paused は時間だけを止めるフラグ。言葉鍛冶を開いている間も世界は止まる。
// ============================================================================

import { TAU, clamp, dist2, rng } from '../core/util.js';
import { getStage } from '../data/stages.js';
import { ENEMIES } from '../data/enemies.js';
import { makeWord, drawWord, ELEMENTS } from '../data/words.js';
import { WEAPONS, startingWeaponsFor } from '../data/weapons.js';
import { resolvePlayerStats, BASE_PLAYER } from './stats.js';
import { WeaponInst } from './weapon.js';
import { fireWeapon, damage as damageEnemy } from './combat.js';
import {
  makeEnemy, makeBullet, makePickup, makeField,
  updateEnemy, updateBullet, hitsEnemy, ensureHitSet,
} from './entities.js';

// ダッシュ。1 秒あたりの消費量と回復量。
export const DASH_COST = 34;           // 押している間、毎秒 34 消費
export const DASH_MULT = 3.1;           // 移動速度の 3.1 倍
export const STAMINA_REGEN = 26;        // 回復は毎秒 26
export const DASH_RECOVER_DELAY = 0.28; // ダッシュをやめてから回復が始まるまでの秒数

export class Run {
  /**
   * @param {object} opt
   * @param {number}  opt.stageId
   * @param {object}  opt.save
   * @param {object}  opt.audio
   * @param {number}  [opt.pouchSize]
   * @param {string}[][opt.startingWords]
   * @param {string[]}[opt.weaponIds]
   */
  constructor(opt) {
    this.stage = getStage(opt.stageId);
    this.save = opt.save;
    this.audio = opt.audio;
    this.pouchSize = opt.pouchSize ?? 12;
    this.rand = opt.rng || rng;
    // 描画側から毎フレーム更新される画面サイズ。
    this.viewW = opt.viewW || 960;
    this.viewH = opt.viewH || 600;
    this.viewR = 480;

    this.player = {
      x: 0, y: 0, vx: 0, vy: 0,
      r: 13,
      hp: 100, maxHp: 100,
      level: 1, xp: 0, xpNext: 6,
      face: -Math.PI / 2,
      invuln: 0, flash: 0, anim: 0,
      shield: 0,
      // スタミナとダッシュ
      stamina: 100, maxStamina: 100,
      dashing: false, dashCd: 0, dashTrail: [],
      // プレイヤー自身の文
      selfSlots: new Array(opt.selfSlots ?? 4).fill(null),
      stats: { ...BASE_PLAYER },
      alive: true,
    };

    /** @type {Array<object|null>} 語袋 */
    this.pouch = new Array(this.pouchSize).fill(null);
    this.wordSeq = 0;   // 語袋から古い順に捨てるための通し番号

    // ── 武器 ──
    this.weapons = [];
    const avail = startingWeaponsFor(this.stage.id);
    const wantIds = (opt.weaponIds && opt.weaponIds.length ? opt.weaponIds : ['sword', 'gun']).slice(0, 4);
    for (const id of wantIds) {
      if (!WEAPONS[id]) continue;
      if (!avail.includes(id)) continue;
      this.weapons.push(new WeaponInst(id, opt.weaponLevels?.[id] || 1));
    }
    if (!this.weapons.length) this.weapons.push(new WeaponInst('sword', 1));

    // 各武器の開始時の 2 語。核語は無いので 2 語ないと文にならない。
    for (const wi of this.weapons) {
      if (wi.def.startWord) wi.setSlot(0, makeWord(wi.def.startWord));
      if (wi.def.startWord2) wi.setSlot(1, makeWord(wi.def.startWord2));
    }

    // 語袋に語を渡す。セーブの恒久語 → 抽選の順。
    for (const w of (opt.startingWords || [])) this.addWord(makeWord(w), true);
    const fill = opt.pouchFill ?? 10;
    for (let i = this.pouch.filter(Boolean).length; i < fill; i++) {
      const w = drawWord(this.rand);
      if (w) this.addWord(w, true);
    }
    for (const w of (opt.extraWords || [])) this.addWord(makeWord(w.text), true, true);

    // プレイヤー自身の文。最初は何も入れない。
    for (const t of (opt.selfWords || [])) {
      const idx = this.player.selfSlots.indexOf(null);
      if (idx < 0) break;
      this.player.selfSlots[idx] = makeWord(t);
    }

    // ── ワールド ──
    this.t = 0;
    this.time = 0;
    this.state = 'playing';
    this.paused = false;
    this.waveIdx = 0;
    this.pending = [];
    this.boss = null;
    this.bossSpawned = false;
    this.enemies = [];
    this.bullets = [];
    this.fields = [];
    this.pickups = [];
    this.slashes = [];
    this.rings = [];
    this.lightnings = [];
    this.beams = [];
    this.dmgTexts = [];
    this.corpses = [];

    this.kills = 0;
    this.dmgDealt = 0;
    this.dmgTaken = 0;
    this.shakeAmt = 0;
    this.shakeOn = true;
    this.showDamage = true;
    this.hint = '';
    this.hintT = 0;
    this.slowmo = 0;
    this.magnetPulse = 0;
    this.chains = 0;
    this.crafts = 0;

    this.refreshStats(true);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 能力
  // ───────────────────────────────────────────────────────────────────────────
  refreshStats(full = false) {
    const s = resolvePlayerStats(this.pouch, this.player.selfSlots, this.save?.d.meta || {});
    const p = this.player;
    const ratio = p.maxHp > 0 ? clamp(p.hp / p.maxHp, 0, 1) : 1;
    p.stats = s;
    const newMax = Math.round(s.maxHp);
    if (full) {
      p.maxHp = newMax;
      p.hp = newMax;
      p.shield = Math.round(s.shield || 0);
    } else {
      const delta = newMax - p.maxHp;
      p.maxHp = newMax;
      p.hp = clamp(Math.round(p.hp + delta), 0, newMax);
      if (p.hp <= 0 && ratio > 0) p.hp = 1;
    }
    p.r = 13 * s.size;
  }

  /**
   * 語袋に語を渡す。満杯なら最も古い 1 語を捨てる。
   * レベルアップの報酬で呼ばれる。
   * @returns {boolean} 入れたか
   */
  giveWord(word) {
    if (!word) return false;
    word.t = ++this.wordSeq;
    const i = this.pouch.indexOf(null);
    if (i >= 0) {
      this.pouch[i] = word;
      this.refreshStats();
      this.pushHint(`「${word.text}」を手に入れた`);
      return true;
    }
    // 満杯。最も古い 1 語を捨てる。
    let drop = 0;
    for (let k = 1; k < this.pouch.length; k++) {
      if ((this.pouch[k].t || 0) < (this.pouch[drop].t || 0)) drop = k;
    }
    const lost = this.pouch[drop];
    this.pouch[drop] = word;
    this.refreshStats();
    this.pushHint(`「${word.text}」を手に入れた（「${lost.text}」は消えた）`);
    return true;
  }

  /**
   * レベルアップ。ことばを数枚配る。
   * ステージ終わりの報酬ではなく、戦闘の中で手に入る。
   */
  grantLevelWords(level) {
    this.growPouch(level);
    const n = level % 5 === 0 ? 2 : 1;   // 5 の倍数のときは 2 枚
    for (let i = 0; i < n; i++) {
      const w = drawWord(this.rand);
      if (w) this.giveWord(w);
    }
    // 自分自身の文にも入ることがある。
    if (level % 4 === 1) {
      const free = this.player.selfSlots.indexOf(null);
      if (free >= 0) {
        const w = drawWord(this.rand, { cat: 'buff' });
        if (w) {
          w.t = ++this.wordSeq;
          this.player.selfSlots[free] = w;
          this.refreshStats();
          this.pushHint(`自身の文に「${w.text}」を迎えた`);
        }
      }
    }
  }

  /** 語袋に追加。満杯で replace=false なら false。 */
  addWord(word, silent = false, replace = false) {
    if (!word) return false;
    word.t = ++this.wordSeq;
    const i = this.pouch.indexOf(null);
    if (i < 0) {
      if (!replace) return false;
      let drop = 0;
      for (let k = 1; k < this.pouch.length; k++) {
        if ((this.pouch[k].t || 0) < (this.pouch[drop].t || 0)) drop = k;
      }
      this.pouch[drop] = word;
    } else {
      this.pouch[i] = word;
    }
    this.refreshStats();
    if (!silent) this.pushHint(`「${word.text}」を語袋に入れた`);
    return true;
  }

  removeWord(word) {
    const i = this.pouch.indexOf(word);
    if (i < 0) return false;
    this.pouch[i] = null;
    this.refreshStats();
    return true;
  }

  get pouchFree() { return this.pouch.filter((x) => !x).length; }

  /** 語袋と武器スロットをまとめて検索する。 */
  findWord(word) {
    const i = this.pouch.indexOf(word);
    if (i >= 0) return { where: 'pouch', index: i, wi: null };
    for (const wi of this.weapons) {
      const k = wi.slots.indexOf(word);
      if (k >= 0) return { where: 'slot', index: k, wi };
    }
    return null;
  }

  /**
   * 語袋へ戻す。置き場があれば入れる。
   */
  toPouch(word) {
    const loc = this.findWord(word);
    if (!loc) return false;
    const free = this.pouch.indexOf(null);
    if (loc.wi) loc.wi.setSlot(loc.index, null);
    else if (loc.self !== undefined) this.player.selfSlots[loc.index] = null;
    else this.pouch[loc.index] = null;
    if (free >= 0) this.pouch[free] = word;
    this.refreshStats();
    return true;
  }

  /**
   * 語袋と全武器のスロットを検索する。
   * @returns {{where:string, index:number, wi:object|null, self?:number}|null}
   */
  findWordAnywhere(word) {
    const loc = this.findWord(word);
    if (loc) return loc;
    const i = this.player.selfSlots.indexOf(word);
    if (i >= 0) return { where: 'self', index: i, wi: null };
    return null;
  }

  /** 語袋・武器・自身のうちどれかへ装着する。 */
  placeWordAnywhere(wi, slotIndex, word) {
    if (!word) return false;
    const prev = wi.slots[slotIndex] || null;
    const loc = this.findWordAnywhere(word);
    if (loc) {
      if (loc.wi === wi && loc.index === slotIndex) return true;
      if (loc.wi) loc.wi.setSlot(loc.index, null);
      else if (loc.where === 'self') this.player.selfSlots[loc.index] = null;
      else this.pouch[loc.index] = null;
    }
    wi.setSlot(slotIndex, word);
    // もともとあった語は、置き場があれば語袋へ戻す。
    if (prev && prev !== word) {
      const free = this.pouch.indexOf(null);
      if (free >= 0) this.pouch[free] = prev;
    }
    this.refreshStats();
    return true;
  }

  /** プレイヤーの文に語を入れる。 */
  placeSelfWord(index, word) {
    const slots = this.player.selfSlots;
    if (index < 0 || index >= slots.length) return false;
    const prev = slots[index] || null;
    const loc = this.findWordAnywhere(word);
    if (loc) {
      if (loc.where === 'self' && loc.index === index) return true;
      if (loc.wi) loc.wi.setSlot(loc.index, null);
      else if (loc.where === 'self') slots[loc.index] = null;
      else this.pouch[loc.index] = null;
    }
    slots[index] = word || null;
    if (prev && prev !== word) {
      const free = this.pouch.indexOf(null);
      if (free >= 0) this.pouch[free] = prev;
    }
    this.refreshStats();
    return true;
  }

  /**
  /**
   * 語を武器のスロットに入れる。語袋か自身の文から取り除く。
   */
  placeWord(wi, slotIndex, word) {
    if (!word) return false;
    return this.placeWordAnywhere(wi, slotIndex, word);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 補助
  // ───────────────────────────────────────────────────────────────────────────
  pushHint(text) { this.hint = text; this.hintT = 2.6; }
  shake(v) { if (this.shakeOn) this.shakeAmt = Math.min(26, this.shakeAmt + v); }

  damageNumbers(x, y, v, crit) {
    if (!this.showDamage || this.dmgTexts.length > 70) return;
    this.dmgTexts.push({
      x: x + (this.rand() - 0.5) * 14, y: y - 8, v, crit: !!crit,
      life: crit ? 0.85 : 0.6, maxLife: crit ? 0.85 : 0.6,
      vy: crit ? -52 : -38,
    });
  }

  nearestEnemy(x, y, exclude = null, maxDist = Infinity) {
    let best = null, bd = maxDist * maxDist;
    for (const e of this.enemies) {
      if (e.dead) continue;
      if (exclude && exclude.includes(e.uid)) continue;
      const d2 = dist2(e.x, e.y, x, y);
      if (d2 < bd) { bd = d2; best = e; }
    }
    return best;
  }

  healPlayer(v) {
    const p = this.player;
    if (p.hp >= p.maxHp && p.shield <= 0) return;
    if (p.shield > 0) {
      const used = Math.min(p.shield, v);
      p.shield -= used;
      v -= used;
    }
    if (v > 0) p.hp = Math.min(p.maxHp, p.hp + v);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // スポーン
  // ───────────────────────────────────────────────────────────────────────────
  /**
   * 画面の外から出現させる座標を返す。
   * 円ではなく「画面の外接矩形」上から位置を選ぶ。
   * 半径 viewR の円だと横・縦の端でちょうど画面端に着地して見えてしまうため。
   */
  edgeSpawn(pad = 0) {
    const hw = (this.viewW || 960) / 2 + 48 + pad;
    const hh = (this.viewH || 600) / 2 + 48 + pad;
    const p = this.player;
    let x, y;
    switch (this.rand.int(4)) {
      case 0: x = -hw; y = this.rand.range(-hh, hh); break;
      case 1: x = hw; y = this.rand.range(-hh, hh); break;
      case 2: x = this.rand.range(-hw, hw); y = -hh; break;
      default: x = this.rand.range(-hw, hw); y = hh; break;
    }
    // 万一プレイヤーに近すぎたら外側へ押しやる。
    const dx = p.x + x - p.x, dy = p.y + y - p.y;
    const d = Math.hypot(dx, dy);
    const min = 300;
    if (d < min && d > 0) {
      const k = min / d;
      x *= k; y *= k;
    }
    return { x: p.x + x, y: p.y + y };
  }

  spawnEnemy(id, at) {
    const d = ENEMIES[id];
    if (!d) return null;
    const prog = clamp(this.time / this.stage.time, 0, 1);
    const st = this.stage.id;
    const hpScale = (1 + (st - 1) * 0.30) * (1 + prog * 0.75);
    const dmgScale = 1 + (st - 1) * 0.20;

    const pos = at || this.edgeSpawn(d.r + 24);
    const e = makeEnemy(id, pos.x, pos.y, hpScale, dmgScale);
    e.spawned = 0;
    if (d.boss) { e.atkCd = 2.4; e.patIdx = 0; e.ring = 0; e.spawned = 1; }
    this.enemies.push(e);
    return e;
  }

  spawnBoss() {
    if (this.bossSpawned || !this.stage.boss) return;
    this.bossSpawned = true;
    // ボスも画面外の上端から来る。
    const e = this.spawnEnemy(this.stage.boss, {
      x: this.player.x + this.rand.range(-160, 160),
      y: this.player.y - (this.viewH || 600) / 2 - 120,
    });
    if (!e) return;
    this.boss = e;
    this.audio.boss();
    this.pushHint(`${e.def.name} が来る`);
    this.shake(16);
  }

  killEnemy(e, st) {
    if (e.dead) return;
    e.dead = true;
    this.kills++;
    this.corpses.push({ x: e.x, y: e.y, r: e.r, color: e.def.color, life: 0.4, maxLife: 0.4 });
    this.audio.kill();

    const xp = e.xp * (1 + (this.stage.id - 1) * 0.12);
    const n = clamp(Math.floor(xp / 2.5), 1, 6);
    const per = Math.max(1, Math.ceil(xp / n));
    for (let i = 0; i < n; i++) this.pickups.push(makePickup(e.x, e.y, 'xp', per));
    if (this.rand.chance(0.025)) this.pickups.push(makePickup(e.x, e.y, 'heal', 14));

    if (e.boss) {
      this.shake(26);
      this.audio.explode();
      this.pushHint(`${e.def.name} を討伐した!`);
      for (let i = 0; i < 30; i++) this.pickups.push(makePickup(e.x, e.y, 'xp', Math.ceil(e.xp / 30)));
      this.finish(true);
    }

    if (st && st.split > 0) this.spawnSplit(e, st);
  }

  spawnSplit(e, st) {
    const n = Math.round(st.split);
    const dmg = Math.max(1, (st.dmg || 1) * 0.45);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + this.rand.angle() * 0.4;
      const b = makeBullet({
        x: e.x, y: e.y,
        vx: Math.cos(a) * 180, vy: Math.sin(a) * 180,
        r: 4 * (st.size || 1), size: (st.size || 1) * 0.8,
        life: 0.75, pierce: 0,
        burn: st.burn, poison: st.poison, chill: st.chill,
        color: (ELEMENTS[st.el] || ELEMENTS.none).color,
        kindName: 'split',
      });
      b.st = { ...st, split: 0, dmg, el: st.el, crit: 0, critDmg: 1.5, lifesteal: 0, knock: 0 };
      this.bullets.push(b);
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // ダメージ
  // ───────────────────────────────────────────────────────────────────────────
  damage(e, st, opt) {
    if (!e || e.dead || !st) return;
    const before = Math.max(0, e.hp);
    const d = damageEnemy(this, e, st, opt);
    if (d > 0) this.dmgDealt += Math.min(d, before);
  }

  hurtPlayer(amount) {
    const p = this.player;
    if (p.invuln > 0 || !p.alive || this.state !== 'playing') return;
    const armor = p.stats.armor || 0;
    const dmg = Math.max(1, Math.round(amount * (1 - armor)));
    p.hp -= dmg;
    p.invuln = 0.6;
    p.flash = 1;
    this.dmgTaken += dmg;
    this.shake(7);
    this.audio.hurt();
    this.slowmo = 0.06;

    // 反射。
    const rf = p.stats.reflect || 0;
    if (rf > 0) {
      const near = this.nearestEnemy(p.x, p.y, null, 96);
      if (near) {
        this.damage(near, {
          dmg: amount * rf * 2, crit: 0, critDmg: 1.5, lifesteal: 0, pierce: 1, knock: 60,
        }, { crit: false, knock: 60 });
      }
    }

    if (p.hp <= 0) {
      p.hp = 0;
      p.alive = false;
      this.state = 'dead';
      this.audio.lose();
      this.onDeath?.();
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // メイン更新
  // ───────────────────────────────────────────────────────────────────────────
  update(dt, input) {
    if (this.paused || this.state !== 'playing') { this.fxTick(dt); return; }

    if (this.slowmo > 0) this.slowmo = Math.max(0, this.slowmo - dt);
    const d = dt * (this.slowmo > 0 ? 0.35 : 1);
    this._lastDt = d;

    this.t += d;
    this.time += d;
    if (this.hintT > 0) this.hintT -= dt;
    if (this.shakeAmt > 0) this.shakeAmt = Math.max(0, this.shakeAmt - dt * 34);
    if (this.magnetPulse > 0) this.magnetPulse = Math.max(0, this.magnetPulse - dt * 3);
    if (this.boss && this.boss.dead) this.boss = null;

    this.playerTick(d, input);
    this.waveTick();
    this.weaponTick(d);
    this.enemyTick(d);
    this.bulletTick(d);
    this.fieldTick(d);
    this.pickupTick(d);
    this.contactTick();
    this.sweep();
    this.fxTick(dt);

    if (!this.stage.boss && this.time >= this.stage.time) this.finish(true);
  }

  playerTick(dt, input) {
    const p = this.player;
    if (p.invuln > 0) p.invuln -= dt;
    if (p.flash > 0) p.flash = Math.max(0, p.flash - dt * 3);
    p.anim += dt;

    const ax = input?.ax || 0, ay = input?.ay || 0;
    const moving = Math.hypot(ax, ay) > 0.08;

    // ── ダッシュ ──
    // スペースを押している間だけ。スタミナを交会しながら加速する。
    const wantDash = !!input?.dash && p.stamina > 1;
    if (wantDash) {
      p.stamina = Math.max(0, p.stamina - DASH_COST * dt);
      p.dashCd = DASH_RECOVER_DELAY;
      p.dashing = true;
    } else {
      p.dashing = false;
    }
    if (p.dashCd > 0) p.dashCd -= dt;
    if (!p.dashing && p.dashCd <= 0) {
      p.stamina = Math.min(p.maxStamina, p.stamina + STAMINA_REGEN * dt);
    }

    // 入力がなければその場で止まる。ダッシュ中だけ向いている方向へ進む。
    let dirX = 0, dirY = 0;
    if (moving) {
      dirX = ax; dirY = ay;
      p.face = input.angle;
    } else if (p.dashing) {
      dirX = Math.cos(p.face);
      dirY = Math.sin(p.face);
    }
    if (!p.dashing && !moving) {
      // 摩擦。放したキーの勢いが残らないようにする。
      const f = Math.exp(-18 * dt);
      p.vx *= f;
      p.vy *= f;
      if (Math.abs(p.vx) < 1) p.vx = 0;
      if (Math.abs(p.vy) < 1) p.vy = 0;
    } else {
      const spd = p.stats.spd * (p.dashing ? DASH_MULT : 1);
      const k = Math.min(1, (p.dashing ? 26 : 16) * dt);
      p.vx += (dirX * spd - p.vx) * k;
      p.vy += (dirY * spd - p.vy) * k;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;

    // 残像。
    if (p.dashing) {
      p.dashTrail.push({ x: p.x, y: p.y, a: p.face, life: 0.22, maxLife: 0.22 });
      if (p.dashTrail.length > 14) p.dashTrail.shift();
    }
    for (let i = p.dashTrail.length - 1; i >= 0; i--) {
      p.dashTrail[i].life -= dt;
      if (p.dashTrail[i].life <= 0) p.dashTrail.splice(i, 1);
    }

    // ダッシュ中は敵を弾き飛ばす。
    if (p.dashing) {
      for (const e of this.enemies) {
        if (e.dead) continue;
        const rr = p.r + e.r + 10;
        if (dist2(e.x, e.y, p.x, p.y) > rr * rr) continue;
        const a = Math.atan2(e.y - p.y, e.x - p.x);
        e.x += Math.cos(a) * 260 * dt;
        e.y += Math.sin(a) * 260 * dt;
      }
    }

    if (p.stats.regen > 0 && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + p.stats.regen * dt);
  }

  waveTick() {
    const st = this.stage;
    while (this.waveIdx < st.waves.length && this.time >= st.waves[this.waveIdx].at) {
      for (const [id, n] of st.waves[this.waveIdx].list) {
        for (let i = 0; i < n; i++) this.pending.push({ t: this.time + this.rand() * 2.2, id });
      }
      this.waveIdx++;
    }
    for (let i = this.pending.length - 1; i >= 0; i--) {
      if (this.time >= this.pending[i].t) {
        this.spawnEnemy(this.pending[i].id);
        this.pending.splice(i, 1);
      }
    }
    if (st.boss && !this.bossSpawned && this.time >= st.time) this.spawnBoss();
  }

  weaponTick(dt) {
    for (const wi of this.weapons) {
      const res = wi.resolve(this.player.stats);
      wi._res = res;
      if (wi.flash > 0) wi.flash = Math.max(0, wi.flash - dt * 4);

      if (!res.active) {
        // 不成文。出力ゼロ。軌道だけが 回す。
        wi.orbitAngle += dt * 0.8;
        continue;
      }
      const st = res.stats;

      if (st.kind === 'orbit') { this.orbitTick(wi, st, dt); continue; }
      if (st.kind === 'aura')  { this.auraTick(wi, st, dt); continue; }

      wi.cd -= dt;
      if (wi.cd <= 0) {
        wi.cd = 1 / Math.max(0.05, st.rate);
        fireWeapon(this, wi, res);
      }
    }
  }

  /** 軌道刃。生存する体数を保つ。 */
  orbitTick(wi, st, dt) {
    const want = Math.max(1, Math.round(st.orbit) + 1);
    const w = 1.1 + st.rate * 0.25;
    wi.orbitAngle += dt * w;
    const radius = (44 + (st.area || 0)) * (this.player.stats.size || 1) * (0.7 + st.size * 0.4);
    const col = (ELEMENTS[st.el] || ELEMENTS.none).color;

    for (let i = 0; i < want; i++) {
      const a = wi.orbitAngle + (i / want) * TAU;
      const b = makeBullet({
        x: this.player.x + Math.cos(a) * radius,
        y: this.player.y + Math.sin(a) * radius,
        vx: 0, vy: 0,
        r: 9 * st.size * (this.player.stats.size || 1),
        size: st.size, life: 0.2, pierce: 99,
        orbit: { a, r: radius, w },
        color: col, kindName: 'orbit',
      });
      b.st = st; b.wi = wi; b.continuous = true;
      this.bullets.push(b);
    }
  }

  auraTick(wi, st, dt) {
    wi.cd -= dt;
    if (wi.cd <= 0) {
      wi.cd = 1 / Math.max(0.05, st.rate);
      fireWeapon(this, wi, wi._res);
    }
  }

  enemyTick(dt) {
    // 敵 AI は Run 自身をコンテキストとして受け取る。
    // bossRing / bossBreath などの行動は Run に定義されている。
    const ctx = this;
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.dead) { this.enemies.splice(i, 1); continue; }
      if (e.spawned < 1) {
        e.spawned += dt * 2.4;
        if (e.spawned < 1) continue;
      }
      updateEnemy(e, ctx, dt);
      if (e.hp <= 0) {
        e.dead = true;
        this.kills++;
        this.killEnemy(e, null);
      }
    }
  }

  bulletTick(dt) {
    const ctx = { enemies: this.enemies, player: this.player, t: this.t };
    const lim = (this.viewR * 2.4) ** 2;
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      if (b.dead) { this.bullets.splice(i, 1); continue; }

      if (b.gravity) { b.vy += b.gravity * dt; b.vx *= 0.995; }
      updateBullet(b, ctx, dt);
      if (b.dead) { this.bullets.splice(i, 1); continue; }

      // 爆弾は敵に触れたら炸る。
      if (b.kindName === 'bomb') {
        if (this.nearestEnemy(b.x, b.y, null, 20 + b.r)) {
          this.explode(b, b.st);
          this.bullets.splice(i, 1);
          continue;
        }
      }
      if (b.enemy) { this.bullets.splice(i, 1); continue; }

      const st = b.st || {
        dmg: b.dmg || 5, crit: 0, critDmg: 1.5, lifesteal: 0, pierce: 0, knock: 0, size: 1, el: 'none',
      };
      const hit = ensureHitSet(b);

      for (let j = 0; j < this.enemies.length; j++) {
        const e = this.enemies[j];
        if (e.dead || hit.has(e.uid)) continue;
        if (!hitsEnemy(e, b)) continue;
        hit.add(e.uid);

        this.damage(e, st, {
          crit: this.rand() < (st.crit || 0),
          knock: st.knock,
          element: b.element || st.el,
          burn: b.burn, poison: b.poison, chill: b.chill, shock: b.shock, freeze: b.freeze,
        });
        this.audio.hit();

        if (b.pierce > 0) b.pierce--;
        else b.dead = true;

        if (b.explode > 0) { this.explode(b, st); b.dead = true; }

        if (b.bounceLeft > 0) {
          b.bounceLeft--;
          b.vx *= -0.85; b.vy *= -0.85;
          if (b.pierce <= 0) b.pierce = 2;
          hit.clear();
        }
        if (b.dead) break;
      }

      if (!b.dead && !b.orbit && !b.continuous && dist2(b.x, b.y, this.player.x, this.player.y) > lim) {
        b.dead = true;
      }
      if (b.dead) this.bullets.splice(i, 1);
    }
  }

  explode(b, st) {
    const r = 40 + (st?.area || 0) + (b.explode || 0) * 0.55;
    this.fields.push(makeField(b.x, b.y, r, Math.max(1, (st?.dmg || 6) * 0.8), {
      life: 0.3,
      element: b.element || st?.el,
      burn: b.burn, poison: b.poison, chill: b.chill, shock: b.shock, freeze: b.freeze,
      knock: st?.knock,
    }));
    this.audio.explode();
    this.shake(5 + (b.explode || 0) * 0.07);
  }

  fieldTick(dt) {
    for (let i = this.fields.length - 1; i >= 0; i--) {
      const f = this.fields[i];
      f.life -= dt;
      if (f.attached) { f.x = this.player.x; f.y = this.player.y; }
      if (f.life <= 0) { this.fields.splice(i, 1); continue; }

      for (const e of this.enemies) {
        if (e.dead || f.hitIds.has(e.uid)) continue;
        if (dist2(e.x, e.y, f.x, f.y) > (f.r + e.r) ** 2) continue;
        f.hitIds.add(e.uid);
        this.damage(e, {
          dmg: f.dmg, crit: 0, critDmg: 1.5, lifesteal: 0, pierce: 99, knock: f.knock, el: f.element,
        }, {
          crit: false, knock: f.knock, element: f.element,
          burn: f.burn, poison: f.poison, chill: f.chill, shock: f.shock, freeze: f.freeze,
        });
        if (f.knock) {
          const a = Math.atan2(e.y - f.y, e.x - f.x);
          e.x += Math.cos(a) * f.knock * 0.1;
          e.y += Math.sin(a) * f.knock * 0.1;
        }
      }
    }
  }

  pickupTick(dt) {
    const p = this.player;
    const magnet = 76 * (p.stats.magnet || 1) * (1 + this.magnetPulse);
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const q = this.pickups[i];
      q.t += dt;
      q.life -= dt;
      if (q.life <= 0) { this.pickups.splice(i, 1); continue; }

      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (d < magnet) {
        const a = Math.atan2(p.y - q.y, p.x - q.x);
        const pull = (1 - d / magnet) * 950;
        q.vx += Math.cos(a) * pull * dt;
        q.vy += Math.sin(a) * pull * dt;
      } else {
        q.vx *= 0.94; q.vy *= 0.94;
      }
      q.x += q.vx * dt;
      q.y += q.vy * dt;

      if (d < p.r + q.r) {
        this.collect(q);
        this.pickups.splice(i, 1);
      }
    }
  }

  collect(q) {
    const p = this.player;
    if (q.type === 'xp') {
      p.xp += q.value * (p.stats.xpMul || 1);
      while (p.xp >= p.xpNext) {
        p.xp -= p.xpNext;
        p.level++;
        p.xpNext = Math.round(5 + p.level * 4 + p.level ** 1.7);
        this.grantLevelWords(p.level);
        this.onLevelUp?.(p.level);
      }
    } else if (q.type === 'heal') {
      this.healPlayer(q.value);
      this.audio.pickup();
      this.pushHint(`回復 ${q.value}`);
    }
  }

  /**
   * 語袋を 8 レベルごとに 1 つずつ広げる。
   * レベルアップで語が入ってくるので、袋がすぐ埋まらないようにする。
   */
  growPouch(level = this.player.level) {
    const want = Math.min(20, 12 + Math.floor(level / 8));
    while (this.pouch.length < want) this.pouch.push(null);
  }

  contactTick() {
    const p = this.player;
    for (const e of this.enemies) {
      if (e.dead || e.spawned < 1) continue;
      const rr = p.r + e.r;
      if (dist2(e.x, e.y, p.x, p.y) > rr * rr) continue;
      this.hurtPlayer(e.dmg);
      if (!p.alive) return;
      const a = Math.atan2(e.y - p.y, e.x - p.x);
      p.vx -= Math.cos(a) * 190;
      p.vy -= Math.sin(a) * 190;
    }
  }

  /** 各エフェクトの後片付け。経過時間で life を進める。 */
  sweep() {
    const dec = (arr) => {
      for (let i = arr.length - 1; i >= 0; i--) {
        arr[i].life -= this._lastDt;
        if (arr[i].life <= 0) arr.splice(i, 1);
      }
    };
    dec(this.slashes);
    dec(this.rings);
    dec(this.lightnings);
    dec(this.beams);
    dec(this.corpses);
    for (let i = this.dmgTexts.length - 1; i >= 0; i--) {
      const t = this.dmgTexts[i];
      t.life -= this._lastDt;
      t.y += t.vy * this._lastDt;
      t.vy *= Math.pow(0.06, this._lastDt);
      if (t.life <= 0) this.dmgTexts.splice(i, 1);
    }
  }

  fxTick() { /* 画面上の告诉了は描画側 */ }

  // ───────────────────────────────────────────────────────────────────────────
  // ボス行動
  // ───────────────────────────────────────────────────────────────────────────
  bossRing(b) {
    const n = 14;
    for (let i = 0; i < n; i++) this.spawnEnemyShot(b.x, b.y, (i / n) * TAU, 210, 14, '#fff');
    this.shake(6);
  }

  bossBreath(b) {
    const a = Math.atan2(this.player.y - b.y, this.player.x - b.x);
    for (let i = -3; i <= 3; i++) {
      this.spawnEnemyShot(b.x, b.y, a + i * 0.17, 210, 16, '#ff9a6a');
    }
    this.shake(8);
  }

  bossSummon(b) {
    const pool = ['swarm', 'bat', 'slime'];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      this.spawnEnemy(pool[this.rand.int(pool.length)], {
        x: b.x + Math.cos(a) * 64, y: b.y + Math.sin(a) * 64,
      });
    }
    this.audio.tone({ freq: 300, type: 'sawtooth', dur: 0.3, vol: 0.08, slide: 0.5 });
  }

  bossSlam(b) {
    this.fields.push(makeField(b.x, b.y, 190, 30, {
      life: 0.4, element: 'earth', knock: 140, chill: 0.2,
    }));
    this.shake(18);
    this.audio.explode();
    if (dist2(this.player.x, this.player.y, b.x, b.y) < 190 ** 2) this.hurtPlayer(18);
  }

  bossDrain(b) {
    const p = this.player;
    if (dist2(p.x, p.y, b.x, b.y) < 320 ** 2) {
      p.hp = Math.max(1, p.hp - 8);
      this.damageNumbers(p.x, p.y, 8, false);
    }
    this.lightnings.push({
      x1: b.x, y1: b.y, x2: p.x, y2: p.y, life: 0.25, maxLife: 0.25, color: '#b47bff',
    });
  }

  spawnEnemyShot(x, y, a, speed, dmg, color) {
    this.bullets.push(makeBullet({
      x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
      r: 9, size: 1, life: 5, pierce: 0,
      color: color || '#f88', kindName: 'eshot', enemy: true,
    }));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 終幕
  // ───────────────────────────────────────────────────────────────────────────
  finish(cleared) {
    if (this.state !== 'playing') return;
    this.state = cleared ? 'clear' : 'dead';
    if (cleared) { this.audio.win(); this.onClear?.(); }
  }

  get score() {
    return Math.round(this.kills * 12 + this.time * 6 + this.dmgDealt * 0.05 + this.player.level * 40);
  }

  /** 武器の現状を UI 用にまとめる。 */
  weaponReport() {
    return this.weapons.map((wi) => {
      const res = wi.resolve(this.player.stats);
      return { wi, res, ok: res.active };
    });
  }
}
