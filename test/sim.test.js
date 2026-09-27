// ヘッドレスで 1 ステージを最後まで回すテスト。  node test/sim.test.js
// DOM を使わないので Node でそのまま実行できる。
import { Run, PICKUP_VMAX, PICKUP_MAGNET } from '../js/game/run.js';
import { makeWord, WORDS, evaluate } from '../js/data/words.js';
import { WEAPONS } from '../js/data/weapons.js';
import { ENEMIES } from '../js/data/enemies.js';
import { WeaponInst } from '../js/game/weapon.js';
import { makePickup, makeEnemy } from '../js/game/entities.js';
import { damage } from '../js/game/combat.js';
import { SELF_TAIL, resolvePlayerStats } from '../js/game/stats.js';
import { STAGES } from '../js/data/stages.js';
import { Save, META_UPGRADES, SHOP_WORDS } from '../js/core/save.js';
import { makeRng } from '../js/core/util.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const sec = (t) => console.log(`\n== ${t} ==`);

// 音声とセーブのスタブ。
const audio = new Proxy({}, { get: () => () => {} });
const save = { d: { meta: {} } };

const input = { ax: 0, ay: 0, moving: false, angle: 0 };
const dt1 = 1 / 60;

/** 独立したランを作り、武器の枠をすべて空にする。テスト間の汚染を防ぐ。 */
function freshWeapon(stageId = 1, weaponIds) {
  const r = newRun(stageId, weaponIds);
  for (const w of r.weapons) w.slots.fill(null);
  return r;
}

/** セーブの初期値。テストごとに分けて、言玉などの持ち越しが混ざらないようにする。 */
function freshSave() {
  return { d: { meta: {} }, unlockWeapon() {} };
}

function newRun(stageId, weaponIds, sv) {
  const save = sv || freshSave();
  return new Run({
    stageId, audio, save, weaponIds,
    // 本番 (main.js) と同じく、恒久の語を渡す。
    startingWords: save.d.startingWords || [],
    rng: makeRng(stageId * 7919 + 13),
  });
}

/** 語彙の状態を文字列に落とす。空き (null) は '·' として、比較用のスナップショットにする。 */
function lexText(r) {
  return r.lexicon.map((w) => (w ? w.text : '·')).join();
}

sec('ラン生成');
let run = newRun(1);
ok(run.state === 'playing', '状態が playing ではない');
ok(run.weapons.length === 2, `武器数 ${run.weapons.length}`);
ok(run.lexicon.every((x) => x !== undefined), '語彙が壊れている');
ok(run.player.hp === run.player.maxHp, 'HP が最大になっていない');
ok(run.player.maxHp > 0, 'maxHp が 0');

sec('武器の初期文');
{
  const wi = run.weapons[0];
  const res = wi.resolve(run.player.stats);
  console.log(`  ${wi.def.name}: 「${res.fullText}」 valid=${res.valid} grade=${res.grade} dmg=${res.stats.dmg.toFixed(0)}`);
  ok(res.valid, '初期の武器が不成文');
  ok(res.stats.dmg > 0, '威力が 0');
  // 核語は無い。すべての武器が 2 語以上入っていること。
  for (const w2 of run.weapons) {
    const r2 = w2.resolve(run.player.stats);
    ok(r2.valid, `${w2.def.name} が開始時に不成文: ${r2.reasonText}`);
  }
  ok(!('core' in wi.def), '核語がまだ定義されている');
}

sec('末尾語は枠の外に固定で付く');
{
  const wi = run.weapons[0];
  const x = wi.resolve(run.player.stats);
  // 文面 = 枠の語の連結 + 末尾語。
  const joined = wi.slots.filter(Boolean).map((w) => w.text).join('') + wi.tail;
  ok(x.fullText === joined, `文面が末尾語つきでない: ${x.fullText} != ${joined}`);
  ok(wi.title.endsWith(wi.tail), `名前が末尾語で終わっていない: ${wi.title}`);

  // 末尾語は枠の 1 つとして数えない。語 1 つでは不成文。
  wi.slots.fill(null);
  wi.setSlot(0, makeWord('刃'));
  const one = wi.resolve(run.player.stats);
  ok(!one.active, '1 語にしても有効になっている');
  ok(one.stats.dmg === 0, `威力が 0 でない: ${one.stats.dmg}`);

  // 語 2 つで成立。
  wi.setSlot(1, makeWord('剛利'));
  ok(wi.resolve(run.player.stats).valid, '2 語でも不成文');
  console.log(`  末尾語「${wi.tail}」/ 1 語 ${one.reasonText} / 2 語で成立`);
}

sec('武器名はその文面になり 末尾は動かない');
{
  const wi = run.weapons[0];
  wi.level = 8; wi.resizeSlots();
  // 「爆裂無双雷」+ 剣 (末尾) = 「爆裂無双雷剣」
  const words = ['爆裂', '無双', '雷'];
  words.forEach((t, i) => wi.setSlot(i, makeWord(t)));
  const res = wi.resolve(run.player.stats);
  console.log(`  「${wi.title}」 ${res.gradeInfo.name} 文力=${res.evalResult.fx.power.toFixed(2)} 攻撃=${res.kind}`);
  ok(wi.title === words.join('') + wi.tail, `武器名が文面と違う: ${wi.title}`);
  ok(res.valid, `「${wi.title}」が不成文: ${res.reasonText}`);
  ok(res.kind === 'slash', `末尾が「剣」なら斬撃のはず: ${res.kind}`);
  ok(res.evalResult.fx.explode > 0, '「爆裂」で爆発が付くはず');
  ok(res.element === 'thunder', `「雷」で雷になるはず: ${res.element}`);
  ok(res.evalResult.fx.power > 1.3, `文の力が低い: ${res.evalResult.fx.power}`);

  // 並べ替えても末尾語と攻撃は変わらない。
  const before = wi.title;
  [wi.slots[0], wi.slots[1]] = [wi.slots[1], wi.slots[0]];
  const swapped = wi.resolve(run.player.stats);
  ok(swapped.kind === 'slash', `並べ替えで攻撃が変わった: ${swapped.kind}`);
  ok(swapped.title.endsWith(wi.tail), '並べ替えで末尾が動いた');
  ok(swapped.title !== before, '並べ替えても名前が変わらない');
  console.log(`  入れ替え → 「${swapped.title}」 ${swapped.kind}`);

  // 途中の形態語は効果だけ足し、攻撃の種類は変えない。
  wi.slots.fill(null);
  wi.setSlot(0, makeWord('刃'));
  wi.setSlot(1, makeWord('剛利'));
  wi.setSlot(2, makeWord('貫通'));
  const mid = wi.resolve(run.player.stats);
  ok(mid.kind === 'slash', `途中の「貫通」で攻撃が変わった: ${mid.kind}`);
  ok(mid.evalResult.fx.pierce > 0, '「貫通」の効果が付いていない');
  console.log(`  途中に「貫通」→ 攻撃 ${mid.kind} / 貫通 ${mid.stats.pierce}`);

  // 爆弾を文に入れても、剣なら斬撃のまま。
  wi.slots.fill(null);
  wi.setSlot(0, makeWord('刃'));
  wi.setSlot(1, makeWord('剛利'));
  wi.setSlot(2, makeWord('爆弾'));
  const bomb = wi.resolve(run.player.stats);
  ok(bomb.kind === 'slash', `途中の「爆弾」で爆弾になった: ${bomb.kind}`);
  ok(bomb.title.endsWith('剣'), `末尾が動いた: ${bomb.title}`);
  ok(bomb.evalResult.fx.explode > 0, '「爆弾」の効果までは付く');
  console.log(`  途中に「爆弾」→ 「${bomb.title}」 ${bomb.kind} (爆発 ${bomb.evalResult.fx.explode.toFixed(0)} は付く)`);

  // 「迅雷」は 1 語として辞書にあるので、2 語を並べても 1 語にまとまる (最長一致)。
  wi.slots.fill(null);
  wi.setSlot(0, makeWord('迅足'));
  wi.setSlot(1, makeWord('雷'));
  const xunlei = wi.resolve(run.player.stats);
  const seg = xunlei.evalResult.segments;
  ok(seg.join('/') === `迅足/雷/${wi.tail}`,
    `迅足+雷 の分割が合わない: ${seg.join('/')}`);
  ok(seg[seg.length - 1] === wi.tail, `末尾語が最後にない: ${seg.join('/')}`);
  console.log(`  「迅足」+「雷」→ ${seg.join('/')}`);
}

sec('すべての武器が末尾語で攻撃を決める');
{
  const PS = { atk: 1, atkMul: 1, crit: 0, lifesteal: 0, magnet: 0, xpMul: 0, armor: 0, slowImmune: 0, hp: 100 };
  for (const [id, def] of Object.entries(WEAPONS)) {
    ok(WORDS[def.tail], `${def.name}: 末尾語「${def.tail}」が辞書に無い`);
    const wi = new WeaponInst(id, 1);
    wi.setSlot(0, makeWord(def.startWord));
    wi.setSlot(1, makeWord(def.startWord2));
    const r = wi.resolve(PS);
    ok(r.active, `${def.name}: 開始語で不成文 (${r.reasonText})`);
    ok(r.kind === def.kind, `${def.name}: 末尾「${def.tail}」で ${r.kind} になるはずが ${r.kind}`);
    ok(r.title.endsWith(def.tail), `${def.name}: 名前が末尾で終わらない: ${r.title}`);
    ok(r.evalResult.segments[r.evalResult.segments.length - 1] === def.tail,
      `${def.name}: 分割の最後が末尾語でない: ${r.evalResult.segments.join('/')}`);
    console.log(`  ${def.name.padEnd(4)} → 「${r.title}」 ${r.kind} / ${r.shape}`);
  }
}


sec('不成文の武器は無効化される');
{
  const r = freshWeapon(1);
  const wi = r.weapons[0];
  // 全部空 -> 末尾語だけ -> 実質語 1 つ -> 不成文。
  let res = wi.resolve(r.player.stats);
  ok(!res.active, '空スロットで有効になっている');
  ok(res.stats.dmg === 0, `威力が 0 でない: ${res.stats.dmg}`);
  ok(res.reasonText, '理由テキストが無い');
  ok(res.reason === 'onelexeme', `理由 ${res.reason}`);
  ok(res.fullText === wi.tail, `空のときの文面 ${res.fullText}`);

  // 1 語だけ -> 実質語が足りない -> 不成文。
  wi.setSlot(0, makeWord('刃'));
  res = wi.resolve(r.player.stats);
  ok(!res.active, '1 語だけで有効になっている');
  ok(res.reason === 'fewwords', `理由 ${res.reason}`);

  // 接続詞だけ -> 不成文。
  wi.setSlot(0, makeWord('ノ'));
  wi.setSlot(1, makeWord('イ'));
  const r2 = wi.resolve(r.player.stats);
  ok(!r2.active, '接続詞だけの文が成立している');
  // 末尾語が実質語 1 つぶん残るので noparticle ではなく onelexeme。
  ok(r2.reason === 'onelexeme', `理由 ${r2.reason}`);

  // 2 語 -> 成立。火球 -> 熟語。
  wi.setSlot(0, makeWord('火'));
  wi.setSlot(1, makeWord('球'));
  const r3 = wi.resolve(r.player.stats);
  ok(r3.active, '「火球」が不成立');
  ok(!!r3.evalResult.idiom, '熟語ボーナスが付かない');
  ok(r3.element === 'fire', `属性 ${r3.element}`);
}

sec('語を並べ替えて 文が変わる');
{
  const r = freshWeapon(1);
  const wi = r.weapons[0];
  const dps = (a, b) => {
    wi.slots.fill(null);
    wi.setSlot(0, makeWord(a));
    wi.setSlot(1, makeWord(b));
    return wi.resolve(r.player.stats).dps;
  };
  const weak = dps('刃', '剛利');
  const strong = dps('激昂', '分裂');
  console.log(`  刃+剛利=${weak.toFixed(1)}  /  激昂+分裂=${strong.toFixed(1)}`);
  ok(strong > weak, '効果の高い語の方が弱い');
  ok(weak > 0, '成立文書でも威力が 0');
}

sec('語彙の操作');
{
  const r = newRun(1);
  const w = makeWord('氷');
  ok(r.addWord(w, true), '語を追加できない');
  const loc = r.findWord(w);
  ok(loc && loc.where === 'lexicon', '追加した語が見つからない');
  ok(r.placeWord(r.weapons[1], 0, w), 'スロットに置けない');
  ok(r.findWord(w)?.where === 'slot', '語がスロットに移動していない');
  ok(r.lexicon.includes(null), '語彙が空いていない');
  // 置いた語を戻す。
  ok(r.toLexicon(w), '語彙に戻せない');
  ok(r.findWord(w)?.where === 'lexicon', '語彙に戻っていない');
  // 満杯。
  while (r.lexicon.includes(null)) r.addWord(makeWord('刃'), true);
  ok(r.addWord(makeWord('炎'), true) === false, '満杯なのに追加できた');
}

sec('1 ステージを最後まで回す (ボスなし)');
{
  const r = newRun(1);
  let steps = 0;
  const dt = 1 / 60;
  // プレイヤーを少し動かす。
  const inp = { ax: Math.cos(r.time), ay: Math.sin(r.time), moving: true, angle: 0 };
  let cleared = false;
  r.onClear = () => { cleared = true; };
  while (r.state === 'playing' && steps < 60 * 120) {
    inp.angle = steps / 30;
    inp.ax = Math.cos(inp.angle); inp.ay = Math.sin(inp.angle);
    r.update(dt, inp);
    steps++;
  }
  ok(r.state === 'clear', `状態が ${r.state} (${steps} フレーム)`);
  ok(cleared, 'onClear が呼ばれなかった');
  ok(r.kills > 0, `一体も倒せなかった (${r.kills})`);
  console.log(`  ${steps} フレーム / 討伐 ${r.kills} / レベル ${r.player.level} / スコア ${r.score}`);
}

sec('ボス戦');
{
  const r = newRun(2);
  const dt = 1 / 60;
  r.spawnBoss();
  ok(r.boss, 'ボスを生成できない');
  const boss = r.boss;
  ok(boss.hp > 1000, `ボスの HP が低い: ${boss.hp}`);

  const inp = { ax: 0, ay: 0, moving: false, angle: 0 };
  let steps = 0, sawRing = false, sawBullet = false, sawField = false, acted = false;
  const startX = boss.x, startY = boss.y;

  for (let i = 0; i < 60 * 20 && !boss.dead; i++) {
    // ボスから離れる。
    const a = Math.atan2(r.player.y - boss.y, r.player.x - boss.x);
    inp.moving = true; inp.angle = a; inp.ax = Math.cos(a); inp.ay = Math.sin(a);
    r.update(dt, inp);
    steps++;
    if (r.rings.length || r.lightnings.length) sawRing = true;
    if (r.bullets.some((b) => b.enemy)) sawBullet = true;
    if (r.fields.length) sawField = true;
    if (Math.abs(boss.x - startX) > 20 || Math.abs(boss.y - startY) > 20) acted = true;
  }
  ok(acted, 'ボスがまったく動かない');
  ok(sawBullet || sawRing || sawField, 'ボスが攻撃を一切しない');
  ok(steps > 60, 'ボスが数秒も持たない');
  console.log(`  ${steps} フレーム / 討伐 ${r.kills} / 状態 ${r.state} / スコア ${r.score}`);
}

sec('ボスを倒すとクリアになる');
{
  const r = newRun(2);
  // refreshStats を呼ぶと stats が作り直されるので、その後にatk を書く。
  r.player.stats.atk = 5000;
  r.hurtPlayer = () => {};
  r.spawnBoss();
  const inp = { ax: 0, ay: 0, moving: false, angle: 0 };
  let cleared = false;
  r.onClear = () => { cleared = true; };
  for (let i = 0; i < 60 * 60 && r.state === 'playing'; i++) r.update(dt1, inp);
  ok(r.state === 'clear', `状態が ${r.state}`);
  ok(cleared, 'onClear が呼ばれなかった');
  ok(r.kills > 0, '何も倒していない');
  console.log(`  討伐 ${r.kills} / スコア ${r.score}`);
}

sec('全ステージのウェーブ定義が妥当');
{
  for (const st of STAGES) {
    ok(st.waves.length > 0, `${st.id} にウェーブがない`);
    ok(st.waves.every((w) => w.at < st.time), `${st.id} のウェーブが制限時間を超えている`);
    ok(st.waves.every((w) => w.list.every(([id, n]) => id && n > 0)), `${st.id} のウェーブ定義が壊れている`);
  }
}

sec('弾とエフェクトの座標が有限値であること (NaN 防止)');
{
  const r = newRun(1, ['sword', 'gun']);
  const inp = { ax: 0, ay: 0, moving: false, angle: 0 };
  r.spawnEnemy('slime', { x: r.player.x + 200, y: r.player.y - 120 });
  r.spawnEnemy('slime', { x: r.player.x - 240, y: r.player.y + 90 });
  r.enemies.forEach((e) => { e.spawned = 1; });

  let checked = 0;
  for (let i = 0; i < 400; i++) {
    r.update(1 / 60, inp);
    for (const b of r.bullets) {
      checked++;
      ok(Number.isFinite(b.x) && Number.isFinite(b.y)
         && Number.isFinite(b.vx) && Number.isFinite(b.vy),
         `弾の座標が NaN: x=${b.x} y=${b.y}`);
    }
    for (const s of r.slashes) {
      ok(Number.isFinite(s.a) && Number.isFinite(s.r), `斬撃の角度が NaN: a=${s.a}`);
    }
    for (const f of r.fields) {
      ok(Number.isFinite(f.x) && Number.isFinite(f.y), `フィールドが NaN: ${f.x},${f.y}`);
    }
    if (checked > 300) break;
  }
  ok(checked > 0, '弾が 1 発も生成されなかった');
  console.log(`  ${checked} 発の弾と各エフェクトの座標を確認`);
}

sec('敵がいないとき也能正常に撃つ');
{
  const r = newRun(1, ['sword', 'gun']);
  const inp = { ax: 0, ay: 0, moving: false, angle: 0.7 };
  for (let i = 0; i < 120; i++) r.update(1 / 60, inp);
  ok(r.bullets.length > 0 || r.slashes.length > 0, '敵が 0 体でも攻撃は出る');
  for (const b of r.bullets) {
    ok(Number.isFinite(b.x) && Number.isFinite(b.y), `弾が NaN: ${b.x},${b.y}`);
  }
  for (const s of r.slashes) {
    ok(Number.isFinite(s.a), `斬撃の角度が NaN: ${s.a}`);
  }
}

sec('敵は画面外からしか出現しない');
{
  const r = newRun(1, ['sword', 'gun']);
  r.viewW = 1280; r.viewH = 800;
  const hw = 1280 / 2, hh = 800 / 2;
  let inside = 0, tooClose = 0, n = 0;
  for (let i = 0; i < 400; i++) {
    const p = r.edgeSpawn(0);
    n++;
    // 画面矩形の内側に入っていないこと。
    if (Math.abs(p.x - r.player.x) < hw && Math.abs(p.y - r.player.y) < hh) inside++;
    // プレイヤーから十分離れていること。
    if (Math.hypot(p.x - r.player.x, p.y - r.player.y) < 280) tooClose++;
  }
  ok(inside === 0, `画面内に出現した: ${inside}/${n}`);
  ok(tooClose === 0, `近すぎて出現した: ${tooClose}/${n}`);

  // 実際に湧いた敵も最初は画面外。
  const r2 = newRun(3);
  r2.viewW = 1280; r2.viewH = 800;
  const inp = { ax: 0, ay: 0, moving: false, angle: 0 };
  let inView = 0, total = 0;
  for (let i = 0; i < 60 * 30; i++) {
    r2.update(1 / 60, inp);
    for (const e of r2.enemies) {
      if (e.spawned > 0.35) continue;   // 出現演出の途中だけ見る
      total++;
      if (Math.abs(e.x - r2.player.x) < hw && Math.abs(e.y - r2.player.y) < hh) inView++;
    }
  }
  ok(inView === 0, `湧いた敵が画面内: ${inView}/${total}`);
  console.log(`  出現位置を ${n} 回抽查 + 実際に湧いた ${total} 体を確認`);
}

sec('攻撃エフェクトは十分長く見える');
{
  const r = newRun(1, ['sword', 'gun']);
  const inp = { ax: 0, ay: 0, moving: false, angle: 0 };
  r.spawnEnemy('bat', { x: r.player.x + 30, y: r.player.y });
  r.enemies.forEach((e) => { e.spawned = 1; e.hp = 1e9; });
  let frames = 0, maxConcurrent = 0;
  for (let i = 0; i < 300; i++) {
    r.update(1 / 60, inp);
    if (r.slashes.length) { frames++; maxConcurrent = Math.max(maxConcurrent, r.slashes.length); }
  }
  ok(frames >= 15, `斬撃が見えるフレーム太少: ${frames} (0.5 秒以上必要)`);
  console.log(`  斬撃エフェクト ${frames} フレーム表示 (最大同時 ${maxConcurrent})`);

  // 敵に命中してもエフェクトが消えないこと。
  const r2 = newRun(1, ['sword', 'gun']);
  r2.spawnEnemy('bat', { x: r2.player.x + 25, y: r2.player.y });
  r2.enemies.forEach((e) => { e.spawned = 1; });
  let afterHit = 0;
  for (let i = 0; i < 120; i++) {
    r2.update(1 / 60, inp);
    if (i > 3 && r2.slashes.length) afterHit++;
  }
  ok(afterHit > 10, `命中後にエフェクトが消える: 残り ${afterHit} フレーム`);
}

sec('入力なし・移動を止められる');
{
  const idle = { ax: 0, ay: 0, moving: false, angle: 0, dash: false };
  const go = { ax: 1, ay: 0, moving: true, angle: 0, dash: false };

  // 一度も入力しない。
  const r1 = newRun(1);
  const s0 = { x: r1.player.x, y: r1.player.y };
  for (let i = 0; i < 180; i++) r1.update(1 / 60, idle);
  const drift = Math.hypot(r1.player.x - s0.x, r1.player.y - s0.y);
  ok(drift < 1, `入力なしでも前に進む: ${drift.toFixed(1)} px`);
  ok(Math.hypot(r1.player.vx, r1.player.vy) < 1, `入力なしで速度が残る: ${r1.player.vx.toFixed(1)}`);
  console.log(`  入力なし 3 秒の移動: ${drift.toFixed(2)} px`);

  // 移動してから離す。
  const r2 = newRun(1);
  for (let i = 0; i < 60; i++) r2.update(1 / 60, go);
  const movingSpeed = Math.hypot(r2.player.vx, r2.player.vy);
  ok(movingSpeed > r2.player.stats.spd * 0.9, `移動していない: ${movingSpeed}`);
  for (let i = 0; i < 30; i++) r2.update(1 / 60, idle);
  const stopSpeed = Math.hypot(r2.player.vx, r2.player.vy);
  ok(stopSpeed < 2, `手を離しても止まらない: ${stopSpeed.toFixed(1)} (移動時 ${movingSpeed.toFixed(0)})`);
  console.log(`  移動 ${movingSpeed.toFixed(0)} → 離す ${stopSpeed.toFixed(1)}`);

  // ダッシュを離しても止まる。
  const r3 = newRun(1);
  const dash = { ax: 1, ay: 0, moving: true, angle: 0, dash: true };
  for (let i = 0; i < 60; i++) r3.update(1 / 60, dash);
  ok(r3.player.dashing, 'ダッシュ状態になっていない');
  ok(Math.hypot(r3.player.vx, r3.player.vy) > r3.player.stats.spd * 2.5, 'ダッシュが速い');
  for (let i = 0; i < 60; i++) r3.update(1 / 60, idle);
  ok(Math.hypot(r3.player.vx, r3.player.vy) < 2, 'ダッシュを離しても流れる');
  console.log(`  ダッシュ後 ${Math.hypot(r3.player.vx, r3.player.vy).toFixed(1)} / スタミナ ${r3.player.stamina.toFixed(0)}`);

  // スタミナが切れると通常移動に戻る。
  const r4 = newRun(1);
  for (let i = 0; i < 60 * 8; i++) r4.update(1 / 60, dash);
  ok(r4.player.stamina < 2, `スタミナが切れなかった: ${r4.player.stamina}`);
  ok(!r4.player.dashing, 'スタミナ切れでもダッシュしたまま');
}

sec('自身の文の末尾は「人」で固定');
{
  const r = freshWeapon(1);
  const p = r.player;
  p.selfSlots.fill(null);

  // 称号は空。
  r.refreshStats();
  ok(p.stats.selfTitle === '', `称号が最初から入っている: ${p.stats.selfTitle}`);

  // 1 語では不成文。末尾の「人」だけでは文にならない。
  p.selfSlots[0] = makeWord('頑強');
  r.refreshStats();
  ok(p.stats.selfValid === false, '1 語で称号が成立している');
  ok(p.stats.selfTitle === '頑強人', `称号が「${p.stats.selfTitle}」`);

  // 2 語で成立。末尾は「人」。
  p.selfSlots[1] = makeWord('疾走');
  r.refreshStats();
  ok(p.stats.selfValid === true, '2 語で称号が成立しない');
  ok(p.stats.selfTitle === '頑強疾走人', `称号が「${p.stats.selfTitle}」`);
  ok(p.stats.selfTitle.endsWith(SELF_TAIL), `末尾が「${SELF_TAIL}」でない: ${p.stats.selfTitle}`);

  // 並べ替えても末尾は動かない。
  [p.selfSlots[0], p.selfSlots[1]] = [p.selfSlots[1], p.selfSlots[0]];
  r.refreshStats();
  ok(p.stats.selfTitle === '疾走頑強人', `並べ替えで称号が変わらない: ${p.stats.selfTitle}`);

  // 「人」を枠に入れても二重にはならない (末尾は別枠)。
  const n = p.selfSlots.filter(Boolean).length;
  ok(n === 2, `枠の数が変わっている: ${n}`);

  // 称号の力がattackと防御に効く。
  ok(p.stats.atkMul > 1, `攻撃に称号の力が乗っていない: ${p.stats.atkMul}`);
  ok(p.stats.armor > 0, `防御に称号の力が乗っていない: ${p.stats.armor}`);

  // 分割の最後が「人」。
  const seg = p.stats.selfSegments;
  ok(seg[seg.length - 1] === SELF_TAIL, `分割の最後が「${SELF_TAIL}」でない: ${seg.join('/')}`);

  // resolvePlayerStats を直接呼んでも同じ称号。
  const direct = resolvePlayerStats([], p.selfSlots, {});
  ok(direct.selfTitle === '疾走頑強人', `直接呼んだ称号が「${direct.selfTitle}」`);

  console.log(`  「${p.stats.selfTitle}」 文の力 x${p.stats.selfPower.toFixed(2)} / ${seg.join('/')} / 攻撃 x${p.stats.atkMul.toFixed(2)}`);
}

sec('経験値の吸引が暴れない');
{
  // 吸引力の中で速度が天井を超えないこと。超えると通り過ぎて振動する。
  const r = freshWeapon(1);
  const p = r.player;
  p.x = 0; p.y = 0;
  r.pickups.length = 0;

  let maxSpeed = 0;
  let overshoot = 0;
  for (let i = 0; i < 20; i++) {
    // 吸引力の中の範囲に並べる。外のものはそもそも寄ってこない。
    const a = (i / 20) * Math.PI * 2;
    r.pickups.push(makePickup(Math.cos(a) * (40 + i * 3), Math.sin(a) * (40 + i * 3), 'xp', 1));
  }
  // 各オーブの「 지금까지の最短距離」を持つ。
  const closest = new Map();
  for (const q of r.pickups) closest.set(q, Math.hypot(q.x, q.y));
  for (let f = 0; f < 240; f++) {
    r.pickupTick(1 / 60);
    for (const q of r.pickups) {
      maxSpeed = Math.max(maxSpeed, Math.hypot(q.vx, q.vy));
      const d = Math.hypot(q.x, q.y);
      const c = closest.get(q);
      // 近づいてから、また遠ざかる = 通り過ぎ。
      if (c < 26 && d > c + 22) overshoot++;
      if (d < c) closest.set(q, d);
    }
  }
  ok(maxSpeed <= PICKUP_VMAX + 1, `速度が天井を超えた: ${maxSpeed.toFixed(0)} > ${PICKUP_VMAX}`);
  ok(overshoot === 0, `通り過ぎ ${overshoot} 回`);
  ok(r.pickups.length === 0, `吸引されずに残った: ${r.pickups.length}`);
  console.log(`  最高速度 ${maxSpeed.toFixed(0)} (天井 ${PICKUP_VMAX}) / 通り越し ${overshoot} / 20 個回収`);

  // 吸引力の外では動かない。最初のふりだし速度だけ 0 にして、吸引の影響だけ見る。
  const r2 = freshWeapon(1);
  r2.player.x = 0; r2.player.y = 0;
  r2.pickups.length = 0;
  const far = makePickup(PICKUP_MAGNET + 200, 0, 'xp', 1);
  far.vx = 0; far.vy = 0;
  r2.pickups.push(far);
  for (let f = 0; f < 120; f++) r2.pickupTick(1 / 60);
  ok(Math.abs(far.x - (PICKUP_MAGNET + 200)) < 1,
    `吸引力の外で引き寄せられた: ${(far.x - (PICKUP_MAGNET + 200)).toFixed(1)} px`);

  // 経験値は時間切れで消えない。
  const r3 = freshWeapon(1);
  r3.pickups.length = 0;
  const xp = makePickup(0, 0, 'xp', 1);
  xp.life = 0;
  r3.pickups.push(xp);
  for (let f = 0; f < 60 * 60; f++) r3.pickupTick(1 / 60);
  ok(r3.pickups.includes(xp) || r3.player.xp > 0, '経験値が時間切れで消えた');
  ok(makePickup(0, 0, 'xp', 1).life === 0, '経験値の life が 0 でない');
  ok(makePickup(0, 0, 'heal', 1).life > 0, '回復の life が 0 になった');
  console.log('  経験値は切らない / 回復は 30 秒');
}

sec('レベルアップは 3 択 1 択');
{
  const { WORD_CHOICES, CHOICE_TIME } = await import('../js/game/run.js');

  //  Coventry 3 つの候補が出て、選ぶまで語彙に入らない。
  const r = newRun(1);
  const before = r.lexicon.filter(Boolean).length;
  r.grantLevelWords(2);
  ok(r.pendingChoices.length === 1, `3 択が出ていない: ${r.pendingChoices.length}`);
  const c = r.pendingChoices[0];
  ok(c.words.length === WORD_CHOICES, `候補が ${WORD_CHOICES} 個でない: ${c.words.length}`);
  ok(new Set(c.words.map((w) => w.text)).size === c.words.length, '候補が重複している');
  ok(c.life === CHOICE_TIME, `制限時間が違う: ${c.life}`);
  ok(r.lexicon.filter(Boolean).length === before, '選ぶ前に語が入った');

  // 1 つ選べば入る。選んだものだけ。
  const picked = c.words[1];
  ok(r.chooseWord(c.id, 1), '選べなかった');
  ok(r.pendingChoices.length === 0, `3 択が残った: ${r.pendingChoices.length}`);
  const now = r.lexicon.filter(Boolean);
  ok(now.length === before + 1, `入らない: ${before} -> ${now.length}`);
  ok(now.some((w) => w === picked), `選んだ語が別simp 东西thing Allocator Opinion 起來`);

  // 5 の倍数なら 2 回分出る。
  const r2 = newRun(1);
  r2.grantLevelWords(5);
  ok(r2.pendingChoices.length === 2, `5 の倍数で 2 回出ていない: ${r2.pendingChoices.length}`);

  // 4 レベルごとに自身の文に 1 語 (これは自動)。
  const r3 = newRun(1);
  r3.grantLevelWords(5);
  const selfFilled = r3.player.selfSlots.filter(Boolean).length;
  ok(selfFilled === 1, `自身の文に語が入らない: ${selfFilled}`);

  // 時間切れなら 1 番目が自動で入る。
  const r4 = newRun(1);
  r4.grantLevelWords(2);
  const n0 = r4.lexicon.filter(Boolean).length;
  const first = r4.pendingChoices[0];
  for (let i = 0; i < 60 * 9; i++) r4.update(1 / 60, { ax: 0, ay: 0, moving: false });
  ok(r4.pendingChoices.length === 0, '時間切れで 3 択が残った');
  ok(r4.lexicon.filter(Boolean).length === n0 + 1,
    `時間切れで入らない: ${n0} -> ${r4.lexicon.filter(Boolean).length}`);
  ok(r4.lexicon.some((w) => w && w.text === first.words[0].text),
    '時間切れで 1 番目が選ばれた');

  // 実際にレベルアップ経由で出ること。
  const r5 = newRun(1);
  r5.collect({ type: 'xp', value: 100 });
  ok(r5.player.level > 1, `レベルが上がらない: ${r5.player.level}`);
  ok(r5.pendingChoices.length >= 1, 'レベルアップで 3 択が出ない');
  console.log(`  Lv${r5.player.level} で ${r5.pendingChoices.length} 件の 3 択 / 語彙 ${n0} -> ${r4.lexicon.filter(Boolean).length}`);
}

sec('語彙の容量は言玉で増える');
{
  const { LEXICON_MAX } = await import('../js/game/run.js');
  const sv = freshSave();
  const r = newRun(1, undefined, sv);
  const size0 = r.lexicon.length;
  ok(size0 === 12, `初期サイズが変わった: ${size0}`);
  r.growLexicon(3);
  ok(r.lexicon.length === size0 + 3, `言玉で広がらない: ${size0} -> ${r.lexicon.length}`);
  // 次のステージへ持ち越す。
  const r2 = newRun(2, undefined, sv);
  ok(r2.lexicon.length === size0 + 3, `持ち越されない: ${r2.lexicon.length}`);
  // 上限がある。
  r.growLexicon(999);
  ok(r.lexicon.length === LEXICON_MAX, `上限を守らない: ${r.lexicon.length}`);
  r.growLexicon(5);
  ok(r.lexicon.length === LEXICON_MAX, `上限を超えて増える: ${r.lexicon.length}`);
  // セーブ側の値がおかしくて配列が肥大化しない。
  const r3 = newRun(3, undefined, sv);
  ok(r3.lexicon.length <= LEXICON_MAX, `壊れたセーブで肥大する: ${r3.lexicon.length}`);
  // 別セーブなら影響を受けない。
  ok(newRun(1).lexicon.length === size0, '別セーブまで影響する');
  console.log(`  語彙 ${size0} -> ${size0 + 3} -> 上限 ${LEXICON_MAX}`);
}

sec('語彙が満杯なら 3 択は「捨てる」を求める');
{
  const fullRun = () => {
    const r = newRun(1);
    // 語が重ならないように別々の語で埋める (文字列比較が曖昧くならないように)。
    const fill = ['火', '氷', '雷', '毒', '厚土', '風', '光', '闇影', '流水', '鋼', '巨岩', '速'];
    let k = 0;
    while (r.lexiconFreeCount > 0) r.addWord(makeWord(fill[k++ % fill.length]), true);
    return r;
  };

  // 捨てる位置を指定すると、その語と入れ替わる。
  const r = fullRun();
  ok(r.lexiconFull, '満杯になっていない');
  r.grantLevelWords(2);
  const c = r.pendingChoices[0];
  const before = r.lexicon.map((w) => (w ? w.text : null));
  const target = before[3];
  ok(r.chooseWord(c.id, 0, 3), '捨てる語を指定しても入らない');
  const after = r.lexicon.map((w) => (w ? w.text : null));
  ok(after[3] === c.words[0].text, `新しい語が 3 番目に入らない: ${after[3]}`);
  ok(!after.includes(target), `捨てる語が残った: ${target}`);
  ok(after.filter(Boolean).length === before.filter(Boolean).length,
    `数が変わる: ${before.filter(Boolean).length} -> ${after.filter(Boolean).length}`);
  console.log(`  満杯の 3 択: 「${target}」を捨てて「${c.words[0].text}」瞪着入れた`);

  // discardIndex を渡さない (時間切れと同じ) なら最も古い語が自動的に消える。
  const r2 = fullRun();
  const ts = r2.lexicon.filter(Boolean).map((w) => w.t || 0);
  const oldest = ts.indexOf(Math.min(...ts));
  r2.grantLevelWords(2);
  const c2 = r2.pendingChoices[0];
  const t0 = r2.lexicon.filter(Boolean).map((w) => w.text);
  ok(r2.chooseWord(c2.id, 0, null), '時間切れでも入らない');
  const t1 = r2.lexicon.filter(Boolean).map((w) => w.text);
  ok(t1.length === t0.length, `数が変わる: ${t0.length} -> ${t1.length}`);
  ok(!t1.includes(t0[oldest]), `最古の語が残った: ${t0[oldest]}`);
  const want = c2.words[0].text;
  ok(t1.includes(want), `新しい語が入っていない: ${want} / ${t1.join(' ')}`);
  console.log(`  時間切れ: 最古の「${t0[oldest]}」が消えて「${want}」が入った`);

  // 語彙が満杯なら、武器から語を外せない。
  const wi = r2.weapons[0];
  const slotWord = wi.slots[0];
  const res = r2.toLexicon(slotWord);
  ok(!res.ok && res.reason === 'full', `満杯なのに外せた: ${JSON.stringify(res)}`);
  ok(wi.slots[0] === slotWord, '語が消失した');
  // 空きを作れば外せる。
  r2.lexicon[0] = null;
  ok(r2.toLexicon(slotWord).ok, '空きがあっても外せない');
  console.log('  満杯時は武器から語を外せない / 空きを作れば外せる');
}

sec('語彙から「忘れる」');
{
  const r = newRun(1);
  const n0 = r.lexicon.filter(Boolean).length;
  const free0 = r.lexiconFreeCount;
  const target = r.lexicon[0];
  ok(r.forgetWord(target) === target.text, '忘れるのに失敗した');
  ok(r.lexiconFreeCount === free0 + 1, `空きが増えていない: ${free0} -> ${r.lexiconFreeCount}`);
  ok(r.lexicon.filter(Boolean).length === n0 - 1, '数が減っていない');
  // 連続してできる。
  r.forgetWord(r.lexicon[1]);
  r.forgetWord(r.lexicon[2]);
  ok(r.lexiconFreeCount === free0 + 3, `連続して忘れる: ${r.lexiconFreeCount}`);
  // 武器にある語は忘れる対象にならない。
  const slotWord = r.weapons[0].slots[0];
  ok(r.forgetWord(slotWord) === null, '武器の語を忘れてしまった');
  ok(r.weapons[0].slots[0] === slotWord, '武器の語が消えた');
  console.log(`  3 つ連続で忘れて空き ${free0} -> ${r.lexiconFreeCount} 個 / 武器の語は対象外`);
}

sec('語彙が満杯のときは語を勝手に捨てない');
{
  const r = newRun(1);
  while (r.lexicon.includes(null)) r.addWord(makeWord('刃'), true);
  ok(!r.lexicon.includes(null), '語彙が埋まっていない');
  const before = r.lexicon.map((w) => w.text);

  // force なしでは入れない (3 択の「捨てる」で決める)。
  ok(!r.giveWord(makeWord('雷')), '満杯なのに無理に入れた');
  ok(r.lexicon.map((w) => w.text).join() === before.join(), '語彙が変わった');

  // force ありなら最古を捨てて入れる。
  const oldestText = r.lexicon[r.oldestLexiconIndex()].text;
  ok(r.giveWord(makeWord('雷'), true), 'force で入れない');
  ok(r.lexicon.some((w) => w && w.text === '雷'), '新しい語が入っていない');
  ok(!r.lexicon.some((w) => w && w.text === oldestText), `最古の語が残った: ${oldestText}`);
  ok(r.lexicon.every(Boolean), '空きが生じた');
  console.log(`  満杯: force なしでは断る / force で「${oldestText}」→「雷」`);
}

sec('ドラッグの入れ替えは語を消さない');
{
  const r = newRun(1);
  const wi = r.weapons[0];
  const self = r.player.selfSlots;

  // 枠 ⇄ 枠。語は入ったまま、数は変わらない。
  const a = makeWord('火');
  const b = makeWord('刃');
  wi.setSlot(0, a);
  wi.setSlot(1, b);
  const lexBefore = lexText(r);
  const r1 = r.swapPlaces(
    { kind: 'slot', wi, index: 0 },
    { kind: 'slot', wi, index: 1 },
  );
  ok(r1.ok, `枠 ⇄ 枠 の入れ替えが失敗: ${r1.reason}`);
  ok(wi.slots[0] === b && wi.slots[1] === a, '枠の語が入れ替わっていない');
  ok(lexText(r) === lexBefore, '入れ替えで語彙が変わった');

  // 枠 ⇄ 自身。
  wi.setSlot(0, a);
  self[0] = b;
  const r2 = r.swapPlaces(
    { kind: 'slot', wi, index: 0 },
    { kind: 'self', index: 0 },
  );
  ok(r2.ok, `枠 ⇄ 自身の入れ替えが失敗: ${r2.reason}`);
  ok(wi.slots[0] === b && self[0] === a, '枠と自身の語が入れ替わっていない');

  // 語彙 ⇄ 枠。空きがあればそのまま移動する。
  const lexWord = r.lexicon.find(Boolean);
  const lexIndex = r.lexicon.indexOf(lexWord);
  const emptySlot = wi.slots.findIndex((w) => !w);
  ok(emptySlot >= 0, '空き枠が見つからない');
  const r3 = r.swapPlaces(
    { kind: 'lexicon', index: lexIndex },
    { kind: 'slot', wi, index: emptySlot },
  );
  ok(r3.ok, `語彙 → 枠 が失敗: ${r3.reason}`);
  ok(wi.slots[emptySlot] === lexWord, '枠に語が入っていない');
  ok(r.lexicon[lexIndex] === null, '語彙に語が残っている');

  // 語彙 ⇄ 語彙。埋まっているセルを 2 つ取り出す。
  const i0 = r.lexicon.findIndex(Boolean);
  const i1 = r.lexicon.findIndex((w, i) => i > i0 && w);
  ok(i1 > i0, '語彙に語が 2 つない');
  const w0 = r.lexicon[i0];
  const w1 = r.lexicon[i1];
  const r4 = r.swapPlaces(
    { kind: 'lexicon', index: i0 },
    { kind: 'lexicon', index: i1 },
  );
  ok(r4.ok, `語彙 ⇄ 語彙 が失敗: ${r4.reason}`);
  ok(r.lexicon[i0] === w1 && r.lexicon[i1] === w0, '語彙の語が入れ替わっていない');

  // 同じ置き場へドロップしても何も起こらない。
  const r5 = r.swapPlaces(
    { kind: 'slot', wi, index: 0 },
    { kind: 'slot', wi, index: 0 },
  );
  ok(r5.ok && r5.reason === 'same', `同じ置き場へのドロップ: ${r5.reason}`);

  console.log('  枠 ⇄ 枠 / 枠 ⇄ 自身 / 語彙 ⇄ 枠 / 語彙 ⇄ 語彙 すべて成立');
}

sec('語彙が満杯なら語を消さない');
{
  const r = newRun(1);
  const wi = r.weapons[0];
  const free = r.lexiconFreeCount;
  // 語彙を埋める。
  const filler = ['火', '流水', '風', '雷', '刃', '短刀', '盾', '剛硬', '王冠', '鋼', '環', '光'];
  for (let k = 0; k < free; k++) r.giveWord(makeWord(filler[k % filler.length]), true);
  ok(r.lexiconFull, '満杯になっていない');
  ok(r.lexicon.every(Boolean), '語彙に空きが残っている');

  // 枠 → 語彙。満杯なので外せない。
  const inSlot = makeWord('弾');
  wi.setSlot(0, inSlot);
  const inSelf = makeWord('火');
  r.player.selfSlots[0] = inSelf;

  // 語が 1 つも減っていないかを数えるのに使う。枠語を置いたあとの数で基を取る。
  const total = () => r.lexicon.filter(Boolean).length
    + r.weapons.reduce((n, w) => n + w.slots.filter(Boolean).length, 0)
    + r.player.selfSlots.filter(Boolean).length;
  const n0 = total();

  const r1 = r.toLexicon(inSlot);
  ok(!r1.ok && r1.reason === 'full', `満杯なのに語彙へ戻せた: ${r1.reason}`);
  ok(wi.slots[0] === inSlot, '枠の語が消えた');
  ok(total() === n0, '語が失われた');

  // 埋まった枠を別の語と交換する。追い出す語の置き場がないので断る。
  const other = r.lexicon[1];
  const r2 = r.placeWord(wi, 0, other);
  ok(!r2.ok && r2.reason === 'full', `placeWord が満杯を素通し: ${r2.reason}`);
  ok(wi.slots[0] === inSlot, 'placeWord で枠の語が消えた');
  ok(r.lexicon[1] === other, 'placeWord で語彙の語が消えた');
  ok(total() === n0, 'placeWord で語が失われた');

  // 自身の文も同じ。
  const r3 = r.placeSelfWord(0, other);
  ok(!r3.ok && r3.reason === 'full', `placeSelfWord が満杯を素通し: ${r3.reason}`);
  ok(r.player.selfSlots[0] === inSelf, 'placeSelfWord で自身の語が消えた');
  ok(r.lexicon[1] === other, 'placeSelfWord で語彙の語が消えた');
  ok(total() === n0, 'placeSelfWord で語が失われた');

  // ただし「埋まったセル ⇄ 埋まった枠」の入れ替えは、埋まりが変わらないので通る。
  const lexWord = r.lexicon[2];
  const r4 = r.swapPlaces(
    { kind: 'lexicon', index: 2 },
    { kind: 'slot', wi, index: 0 },
  );
  ok(r4.ok, `交換まで断られた: ${r4.reason}`);
  ok(wi.slots[0] === lexWord, '枠へ語が入っていない');
  ok(r.lexicon[2] === inSlot, '語彙へ語が戻っていない');
  ok(total() === n0, '入れ替えで語が失われた');

  // 語彙 → 空き枠。語彙の埋まりは変わらないので通る。
  const r5 = r.swapPlaces(
    { kind: 'lexicon', index: 1 },
    { kind: 'slot', wi, index: 1 },
  );
  ok(r5.ok, `空き枠へ移せない: ${r5.reason}`);
  ok(total() === n0, '移動で語が失われた');

  // 空きを作れば語彙へ戻せるようになる。
  const back = wi.slots[1];
  r.forgetWord(r.lexicon[0]);
  const r6 = r.toLexicon(back);
  ok(r6.ok, `空きがあるのに語彙へ戻せない: ${r6.reason}`);
  ok(total() === n0 - 1, '「忘れる」した分だけ数が減った');

  console.log(`  toLexicon / placeWord / placeSelfWord は満杯で拒否 / 入れ替えは通る (空き ${r.lexiconFreeCount})`);
}

sec('形と攻撃は末尾語だけが決める');
{
  // 武器ごとに末尾語を移し替えれば、攻撃の型が変わる。
  // 語を並べ替えても、末尾語は動かない。
  for (const [id, wantShape, wantKind] of [
    ['sword', 'blade', 'slash'],
    ['gun', 'shot', 'shot'],
    ['arrow', 'arrow', 'shot'],
    ['bomb', 'bomb', 'bomb'],
    ['orbit', 'blade', 'orbit'],
    ['thunder', 'shot', 'chain'],
    ['whip', 'blade', 'whip'],
    ['aura', 'orb', 'aura'],
    ['boomerang', 'blade', 'boomerang'],
    ['beam', 'arrow', 'beam'],
  ]) {
    // 解放されているステージで始める。
    const stage = WEAPONS[id].unlock ? WEAPONS[id].unlock.stage : 1;
    const r = freshWeapon(stage, [id]);
    const wi = r.weapons[0];
    ok(wi && wi.defId === id, `${id}: 武器=${wi && wi.defId} (ステージ ${stage})`);
    wi.setSlot(0, makeWord(WEAPONS[id].startWord));
    wi.setSlot(1, makeWord(WEAPONS[id].startWord2));
    const res = wi.resolve(r.player.stats);
    ok(res.shape === wantShape, `${id}: 形 ${res.shape} が ${wantShape} でない`);
    ok(res.kind === wantKind, `${id}: 攻撃 ${res.kind} が ${wantKind} でない`);
  }

  // 途中の形態語は形も攻撃も変えない。
  const r = freshWeapon(1, ['gun']);
  const wi = r.weapons[0];
  const res = (a, b2) => {
    wi.slots.fill(null);
    wi.setSlot(0, makeWord(a));
    wi.setSlot(1, makeWord(b2));
    return wi.resolve(r.player.stats);
  };
  const base = res('火', '弾');
  ok(base.shape === 'shot' && base.kind === 'shot', `末尾「銃」→ ${base.shape}/${base.kind}`);
  for (const [a, b2] of [['火', '剣'], ['火', '球'], ['火', '刃'], ['火', '環'], ['火', '壁']]) {
    const x = res(a, b2);
    ok(x.shape === base.shape, `「${a}${b2}」で形が ${x.shape} に変わった (末尾は${wi.tail})`);
    ok(x.kind === base.kind, `「${a}${b2}」で攻撃が ${x.kind} に変わった (末尾は${wi.tail})`);
  }
  console.log(`  末尾「${wi.tail}」なら途中の形態語でも形も攻撃も ${base.shape}/${base.kind} のまま`);

  // 属性は文中の属性語から決まる (末尾語とは別)。
  ok(res('火', '弾').element === 'fire', '「火の弾」→ fire');
  ok(res('氷', '弾').element === 'ice', '「氷の弾」→ ice');
  ok(res('雷', '弾').element === 'thunder', '「雷の弾」→ thunder');

  // 枠を増やすと 3 つ以上の語も使える。
  wi.level = 6; wi.resizeSlots();
  ok(wi.slots.length === 7, `Lv6 で枠が 7 になる: ${wi.slots.length}`);
  wi.slots.fill(null);
  wi.setSlot(0, makeWord('火'));
  wi.setSlot(1, makeWord('ノ'));
  wi.setSlot(2, makeWord('矢'));
  const s3 = wi.resolve(r.player.stats);
  ok(s3.active, `「火ノ矢」が不成立: ${s3.reasonText}`);
  ok(s3.shape === 'shot', `「火ノ矢銃」で形が ${s3.shape}`);
  ok(s3.element === 'fire', '「火ノ矢」→ fire');
  ok(s3.stats.burn > 0, '「火ノ矢」→ 炎上あり');
  console.log(`  Lv6 の 3 語 → 「${s3.fullText}」 ${s3.kind} / ${s3.shape} / ${s3.element}`);
}

sec('貫通と拡散が実際に効く');
{
  const r = freshWeapon(1, ['gun']);
  const wi = r.weapons[0];
  const st = (a, b2) => {
    wi.slots.fill(null);
    wi.setSlot(0, makeWord(a));
    wi.setSlot(1, makeWord(b2));
    const res = wi.resolve(r.player.stats);
    ok(res.active, `「${a}${b2}」が不成文: ${res.reasonText}`);
    return res.stats;
  };
  const plain = st('弾', '速');
  const piercing = st('貫徹', '弾');
  const spread = st('散弾', '弾');
  ok(piercing.pierce > plain.pierce, `貫通: ${plain.pierce} -> ${piercing.pierce}`);
  ok(spread.count > plain.count, `拡散: ${plain.count} -> ${spread.count}`);
  ok(spread.spread > plain.spread, `扇: ${plain.spread} -> ${spread.spread}`);
  console.log(`  貫通 ${plain.pierce}->${piercing.pierce} / 数 ${plain.count}->${spread.count} / 扇 ${plain.spread}->${spread.spread}`);
}

sec('指数的バグ: 敵が増殖し続ける');
{
  const r = newRun(3);
  const inp = { ax: 0, ay: 0, moving: false, angle: 0 };
  r.player.stats.atk = 200;   // 刷新ulation せずに直接書く
  r.hurtPlayer = () => {};
  for (let i = 0; i < 60 * 100 && r.state === 'playing'; i++) r.update(dt1, inp);
  console.log(`  敵 ${r.enemies.length} 体 / 弾 ${r.bullets.length} / 討伐 ${r.kills} / 状態 ${r.state}`);
  ok(r.enemies.length < 600, `敵が多すぎる: ${r.enemies.length}`);
  ok(r.bullets.length < 600, `弾が多すぎる: ${r.bullets.length}`);
  ok(r.state === 'playing' || r.state === 'clear', `途中で異常終了: ${r.state}`);
}

sec('開始時の語彙に語が入っていること');
{
  const r = newRun(1);
  const filled = r.lexicon.filter(Boolean).length;
  console.log(`  語彙 ${filled} 語: ${r.lexicon.filter(Boolean).map((w) => w.text).join(' ')}`);
  ok(filled >= 6, `語彙が少なすぎる: ${filled}`);

  // すべての武器が最初から文として成立していること。
  for (const wi of r.weapons) {
    const res = wi.resolve(r.player.stats);
    ok(res.active, `${wi.def.name} が開始時に不成文: ${res.reasonText}`);
    ok(res.stats.dmg > 0, `${wi.def.name} の威力が 0`);
  }

  // 語彙の任何一个の語と既存の枠の語を組み合わせれば文が成立できること。
  const wi = r.weapons[0];
  let found = false;
  for (const w of r.lexicon) {
    if (!w) continue;
    wi.setSlot(1, w);
    if (wi.resolve(r.player.stats).active) { found = true; break; }
  }
  ok(found, '語彙のどの語でも既存の枠と合わせて文にできない');

  // 語彙に 2 語以上入る。1 語では 文の組み立て方に幅が出ないため。
  ok(filled >= 9, `語彙が少なすぎる: ${filled} (10 語のはず)`);
  console.log(`  語彙: ${r.lexicon.filter(Boolean).map((w) => w.text).join(' ')}`);
}

sec('武器 1 つにつき複数語を並べられる');
{
  const r = newRun(1, ['sword', 'gun']);
  const wi = r.weapons[0];
  console.log(`  剣の枠: ${wi.slots.length} 個 (Lv1)`);
  ok(wi.slots.length >= 3, `Lv1 の枠が少なすぎる: ${wi.slots.length}`);
  // 開始時に 1 個埋まっているので、自由に使えるのは 2 個以上。
  const free = wi.slots.filter((s) => !s).length;
  ok(free >= 2, `自由に使える枠が少なすぎる: ${free}`);

  // レベルを上げると枠が増える。
  const counts = [];
  for (let lv = 1; lv <= 8; lv++) {
    wi.level = lv; wi.resizeSlots();
    counts.push(wi.slots.length);
  }
  console.log(`  Lv1〜8 の枠数: ${counts.join(' → ')}`);
  ok(counts[0] === 4, `Lv1 が 4 枠でない: ${counts[0]}`);
  ok(counts[7] === 7, `Lv8 が 7 枠でない: ${counts[7]}`);
  for (let i = 1; i < counts.length; i++) {
    ok(counts[i] >= counts[i - 1], 'レベルを上げると枠が減っている');
  }

  // 実際に「火の球」のような文を、Lv1 の枠で組めるか。
  wi.level = 1; wi.resizeSlots();
  ok(wi.slots.length === 4, `Lv1 の枠数 ${wi.slots.length}`);
  wi.slots.fill(null);
  wi.setSlot(0, makeWord('刃'));
  wi.setSlot(1, makeWord('火'));
  wi.setSlot(2, makeWord('球'));
  const res = wi.resolve(r.player.stats);
  const ev = res.evalResult;
  ok(res.valid, `Lv1 の枠で「刃火球${wi.tail}」が成立しない: ${res.reasonText}`);
  ok(res.fullText === '刃火球' + wi.tail, `文面 ${res.fullText}`);
  ok(ev.content === 4, `実質語数 ${ev.content}`);
  ok(!!ev.idiom, `熟語「火球」が乗らない: ${ev.idiom}`);
  console.log(`  Lv1 の枠で → 「${res.fullText}」(${res.gradeInfo.name} / 熟語 ${ev.idiom.name})`);

  // 助詞は文の力を上げる。同じ実質語の並びで比較する。
  wi.level = 6; wi.resizeSlots();
  const set = (...ws) => {
    wi.slots.fill(null);
    ws.forEach((w, i) => wi.setSlot(i, makeWord(w)));
    return wi.resolve(r.player.stats);
  };
  const plain = set('刃', '火', '弾', '球');
  const gram = set('刃', '火', '弾', 'ノ', '球');
  ok(plain.valid && gram.valid, '比較用の文が成立していない');
  ok(gram.evalResult.fx.power > plain.evalResult.fx.power,
    `助詞で文の力が上がらない: ${plain.evalResult.fx.power} -> ${gram.evalResult.fx.power}`);
  // 助詞は分割に効くので、成立は崩れない。
  ok(gram.evalResult.content === plain.evalResult.content, '助詞が実質語に数えられている');
  console.log(`  助詞を足す → 「${plain.fullText}」${plain.evalResult.fx.power.toFixed(2)}`
    + ` → 「${gram.fullText}」${gram.evalResult.fx.power.toFixed(2)}`);
}

sec('敵は文でできている');
{
  // 全敵の文が、辞書だけで閉じる文になっていること。
  for (const [id, def] of Object.entries(ENEMIES)) {
    const words = def.words || [];
    ok(words.length >= 2, `${def.name}: 文が短い (${words.length})`);
    const missing = words.filter((w) => !WORDS[w]);
    ok(missing.length === 0, `${def.name}: 辞書に無い語 ${missing.join(',')}`);
    const r = evaluate(words.map((text) => ({ text })));
    ok(r.valid, `${def.name}: 文が成立しない (${r.reasonText})`);
  }
  // ボスの文は長い。 harder には時間がかかるように。
  const bossWords = ENEMIES.boss_word.words.length;
  ok(bossWords >= 4, `ボスの文が短すぎる: ${bossWords}`);
  console.log(`  敵 ${Object.keys(ENEMIES).length} 種 / 最終ボスの文 ${bossWords} 語`);
}

sec('武器の文で敵の文を斬れる');
{
  const r = newRun(1);
  const wi = r.weapons[0];
  wi.slots.fill(null);
  const PS = r.player.stats;

  // 実在する語だけで組む。
  const set = (...ws) => {
    wi.slots.fill(null);
    ws.forEach((w, i) => wi.setSlot(i, makeWord(w)));
    return wi.resolve(PS);
  };

  // 不成文の武器は斬れない。
  const broken = set('刃');
  ok(!broken.valid, '刃だけでは不成文にならない');
  ok(!broken.stats.cutPower, `不成文が斬れる: cutPower=${broken.stats.cutPower}`);

  // ふつうの成立文は 1 語。
  const plain = set('刃', '必殺', '電', '弾');
  ok(plain.valid, '比較用の文が成立しない');
  ok(plain.stats.cutPower === 1, `成立文の斬り数が 1 でない: ${plain.stats.cutPower}`);

  // 熟語があれば +1。
  const idiom = set('刃', '必殺', '火', '球');
  ok(idiom.valid && idiom.evalResult.idiom, `熟語が成立しない: ${idiom.fullText}`);
  ok(idiom.stats.cutPower === 2, `熟語文の斬り数が 2 でない: ${idiom.stats.cutPower}`);

  // 述語 (接続詞の合成) があれば +1。
  const gram = set('刃', '律', 'スル', '弾');
  ok(gram.valid, `述語の文が成立しない: ${gram.fullText}`);
  ok(gram.evalResult.predicated, `述語になっていない: ${gram.fullText}`);
  ok(gram.stats.cutPower === 2, `述語文の斬り数が 2 でない: ${gram.stats.cutPower}`);

  // 斬る量だけでなく、確率も文で変わる。
  const chance = (res) => res.stats.cutChance;
  ok(chance(plain) < chance(idiom), `熟 ought to 確率も上げる: ${chance(plain)} -> ${chance(idiom)}`);
  ok(chance(plain) < chance(gram), `述 ought to 確率も上げる: ${chance(plain)} -> ${chance(gram)}`);
  ok(!broken.stats.cutChance, `不成文に確率がある: ${chance(broken)}`);
  // 1 割を切るのは少し寂しい。
  ok(chance(plain) >= 0.1, `成立文の確率が低すぎる: ${chance(plain)}`);
  console.log(`  斬る量 成立 ${plain.stats.cutPower} / 熟語 ${idiom.stats.cutPower}`
    + ` / 述語 ${gram.stats.cutPower}`);
  console.log(`  確率   成立 ${(chance(plain) * 100).toFixed(0)}%`
    + ` / 熟語 ${(chance(idiom) * 100).toFixed(0)}% / 述語 ${(chance(gram) * 100).toFixed(0)}%`);

  // 斬る。敵の文が短くなる。確率を 1 にして必ず斬らせる。
  const e = makeEnemy('goblin', 0, 0);
  const before = e.words.join('');
  plain.stats.cutChance = 10;   // 必ず斩らせる
  damage(r, e, plain.stats, {});
  ok(e.words.length === 1, `1 文で 1 語斬れていない: ${e.words.join('')}`);
  ok(e.broken === true, '文が崩れていない');
  console.log(`  「${before}」→ 成立文で 1 斬り → 「${e.words.join('')}」${e.broken ? ' (崩れた)' : ''}`);

  // 崩れた敵は無力。
  ok(e.dmg === 0, `崩れた敵がダメージを返す: ${e.dmg}`);
  ok(e.speed < e.def.speed, '崩れた敵が動く');
}

sec('熟語か述語なら、一撃で 2 語斬る');
{
  const r = newRun(1);
  const wi = r.weapons[0];
  const PS = r.player.stats;
  const set = (...ws) => {
    wi.slots.fill(null);
    ws.forEach((w, i) => wi.setSlot(i, makeWord(w)));
    return wi.resolve(PS);
  };
  const strong = set('刃', '必殺', '火', '球');
  ok(strong.stats.cutPower === 2, `斬り数が 2 でない: ${strong.stats.cutPower}`);

  // 3 語の敵を 1 撃で 2 語斬れる。
  const e = makeEnemy('boss_slime', 0, 0);
  ok(e.words.length === 3, `敵の文が 3 語でない: ${e.words.length}`);
  // ボスは 0.3 倍。即使概率很低也会失败。把 cutChance 设为 10 で必斩。
  strong.stats.cutChance = 10;
  damage(r, e, strong.stats, {});
  ok(e.words.length === 1, `2 語斬れていない: ${e.words.join('')}`);
  ok(e.broken, '3 語 -> 1 語 で崩れていない');
  console.log(`  ${ENEMIES.boss_slime.name}「${ENEMIES.boss_slime.words.join('')}」`
    + ` → 熟語 1 撃で 2 斬り → 「${e.words.join('')}」${e.broken ? ' (崩れた)' : ''}`);
}

sec('書庫の墨で恒久強化を買える');
{
  const save = new Save();
  save.reset();
  ok(save.ink === 0, `最初から墨がある: ${save.ink}`);

  // 買えない。
  let r = save.buyMeta('hp');
  ok(!r.ok && r.reason === 'ink', `墨がないのに買えた: ${r.reason}`);
  ok(save.metaLevel('hp') === 0, '買えなかったのに段階上がった');

  // enough .put って買う。
  save.addInk(1000);
  ok(save.ink === 1000, `墨が入らない: ${save.ink}`);

  const before = save.ink;
  r = save.buyMeta('hp');
  ok(r.ok, `買えない: ${r.reason}`);
  ok(save.ink < before, `墨が減っていない: ${before} -> ${save.ink}`);
  ok(save.metaLevel('hp') === 1, `段階が 1 でない: ${save.metaLevel('hp')}`);

  // 段階ごとに高くなる。
  const c1 = save.metaCost('hp');
  save.buyMeta('hp');
  const c2 = save.metaCost('hp');
  ok(c2 > c1, `段階を上げても値段が変わらない: ${c1} -> ${c2}`);
  ok(save.metaLevel('hp') === 2, `段階が 2 でない: ${save.metaLevel('hp')}`);

  // 上限まで/debug 買えて、それ以上は買えない。
  let lv = save.metaLevel('hp');
  while (save.metaCost('hp') !== null) {
    save.addInk(10000);
    save.buyMeta('hp');
    lv++;
    if (lv > 50) break;
  }
  ok(save.metaLevel('hp') === META_UPGRADES.hp.max, `上限を守らない: ${save.metaLevel('hp')}`);
  r = save.buyMeta('hp');
  ok(!r.ok && r.reason === 'max', `上限を越して買えた: ${r.reason}`);

  console.log(`  体力 ${save.metaLevel('hp')} 段階 (最終値 ${save.metaValue('hp')}) / 上限 ${META_UPGRADES.hp.max}`);
}

sec('買った恒久強化がプレイヤーに効く');
{
  const save = new Save();
  save.reset();
  save.addInk(100000);
  save.buyMeta('hp');
  save.buyMeta('hp');
  save.buyMeta('atk');
  save.buyMeta('armor');
  save.buyMeta('crit');
  save.buyMeta('magnet');
  save.buyMeta('xp');

  const plain = resolvePlayerStats([], [], {});
  const buffed = resolvePlayerStats([], [], save.d.meta);
  ok(buffed.maxHp > plain.maxHp, `体力が上がっていない: ${plain.maxHp} -> ${buffed.maxHp}`);
  ok(buffed.atkMul > plain.atkMul, `攻撃が上がっていない: ${plain.atkMul} -> ${buffed.atkMul}`);
  ok(buffed.armor > plain.armor, `装甲が上がっていない`);
  ok(buffed.crit > plain.crit, `会心が上がっていない`);
  ok(buffed.magnet > plain.magnet, `引き寄せが上がっていない`);
  ok(buffed.xpMul > plain.xpMul, `経験値が上がっていない`);
  console.log(`  体力 ${plain.maxHp}->${buffed.maxHp} / 攻撃 x${plain.atkMul.toFixed(2)}->x${buffed.atkMul.toFixed(2)}`
    + ` / 装甲 ${plain.armor}->${buffed.armor} / 会心 ${(plain.crit * 100).toFixed(0)}%->${(buffed.crit * 100).toFixed(0)}%`);

  // ランにも反映される。
  const r = newRun(1, undefined, save);
  ok(r.player.maxHp === buffed.maxHp, `ランに体力が反映されない: ${r.player.maxHp} != ${buffed.maxHp}`);
}

sec('買った恒久の語が次のランの語彙に入る');
{
  const save = new Save();
  save.reset();
  save.addInk(1000);
  const w = SHOP_WORDS[0];
  const r = save.buyWord(w.text);
  ok(r.ok, `買えない: ${r.reason}`);
  ok(save.hasStartingWord(w.text), '買っても入っていない');
  const r2 = save.buyWord(w.text);
  ok(!r2.ok && r2.reason === 'owned', `2 回買えてしまった: ${r2.reason}`);

  const run = newRun(1, undefined, save);
  const inLex = run.lexicon.some((x) => x && x.text === w.text);
  ok(inLex, `ランの語彙に入っていない: ${run.lexicon.map((x) => x && x.text).join(' ')}`);
  // 語彙の空きを全部埋めても入れる。
  const r3 = newRun(1, undefined, save);
  while (r3.lexicon.includes(null)) r3.addWord(makeWord('剣'), true);
  ok(!r3.addWord(makeWord('鋼')), '満杯なのに追加できた');
  r3.giveWord(makeWord(w.text));
  ok(r3.lexicon.some((x) => x && x.text === w.text), '満杯で語が入らない');
  console.log(`  「${w.text}」を買って次のランの語彙に入る`);
}

console.log(`\n---- 合格 ${pass} / 不合格 ${fail} ----`);
process.exit(fail ? 1 : 0);
