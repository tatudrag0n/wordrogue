// ヘッドレスで 1 ステージを最後まで回すテスト。  node test/sim.test.js
// DOM を使わないので Node でそのまま実行できる。
import { Run } from '../js/game/run.js';
import { makeWord } from '../js/data/words.js';
import { STAGES } from '../js/data/stages.js';
import { makeRng } from '../js/core/util.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const sec = (t) => console.log(`\n== ${t} ==`);

// 音声とセーブのスタブ。
const audio = new Proxy({}, { get: () => () => {} });
const save = { d: { meta: {} } };

const input = { ax: 0, ay: 0, moving: false, angle: 0 };
const dt1 = 1 / 60;

function newRun(stageId, weaponIds) {
  return new Run({ stageId, audio, save, weaponIds, rng: makeRng(stageId * 7919 + 13) });
}

sec('ラン生成');
let run = newRun(1);
ok(run.state === 'playing', '状態が playing ではない');
ok(run.weapons.length === 2, `武器数 ${run.weapons.length}`);
ok(run.pouch.every((x) => x !== undefined), '語袋が壊れている');
ok(run.player.hp === run.player.maxHp, 'HP が最大になっていない');
ok(run.player.maxHp > 0, 'maxHp が 0');

sec('武器の初期文');
{
  const wi = run.weapons[0];
  const res = wi.resolve(run.player.stats);
  console.log(`  ${wi.def.name}: 「${res.fullText}」 valid=${res.valid} grade=${res.grade} dmg=${res.stats.dmg}`);
  ok(res.valid, '初期の武器が不成文');
  ok(res.stats.dmg > 0, '威力が 0');
}

sec('不成文の武器は無効化される');
{
  const wi = run.weapons[0];
  // スロットを空にする -> 核語だけ -> 不成文。
  wi.slots[0] = null;
  wi.slots[1] = null;
  const res = wi.resolve(run.player.stats);
  ok(!res.active, '空スロットで有効になっている');
  ok(res.stats.dmg === 0, `威力が 0 でない: ${res.stats.dmg}`);
  ok(res.reasonText, '理由テキストが無い');

  // 助詞だけを並べる -> 核語しか残らない -> 不成文。
  wi.setSlot(0, makeWord('の'));
  wi.setSlot(1, makeWord('は'));
  const r2 = wi.resolve(run.player.stats);
  ok(!r2.active, '助詞だけの文が成立している');
  ok(r2.reason === 'onelexeme', `理由 ${r2.reason}`);

  // 火球 -> 熟語成立。
  wi.setSlot(0, makeWord('火'));
  wi.setSlot(1, makeWord('球'));
  const r3 = wi.resolve(run.player.stats);
  ok(r3.active, '「火球」が不成立');
  ok(!!r3.evalResult.idiom, '熟語ボーナスが付かない');
  ok(r3.element === 'fire', `属性 ${r3.element}`);
}

sec('語を並べ替えて 文が変わる');
{
  const wi = run.weapons[0];
  const dps = (a, b) => { wi.setSlot(0, makeWord(a)); wi.setSlot(1, makeWord(b)); return wi.resolve(run.player.stats).dps; };
  const weak = dps('刃', 'の');
  const strong = dps('激', '分裂');
  console.log(`  刃の=${weak.toFixed(1)}  /  激+分裂=${strong.toFixed(1)}`);
  ok(strong > weak, '効果の高い語の方が弱い');
  ok(weak > 0, '成立文書でも威力が 0');
}

sec('語袋の操作');
{
  const r = newRun(1);
  const w = makeWord('氷');
  ok(r.addWord(w, true), '語を追加できない');
  const loc = r.findWord(w);
  ok(loc && loc.where === 'pouch', '追加した語が見つからない');
  ok(r.placeWord(r.weapons[1], 0, w), 'スロットに置けない');
  ok(r.findWord(w)?.where === 'slot', '語がスロットに移動していない');
  ok(r.pouch.includes(null), '語袋が空いていない');
  // 置いた語を戻す。
  ok(r.toPouch(w), '語袋に戻せない');
  ok(r.findWord(w)?.where === 'pouch', '語袋に戻っていない');
  // 満杯。
  while (r.pouch.includes(null)) r.addWord(makeWord('刃'), true);
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

sec('形態語が弾の形に反映される');
{
  const r = newRun(1, ['gun']);
  const wi = r.weapons[0];
  // スロットは Lv1 なので 2 枠。並び順によって後ろの形態語が勝つことを確認する。
  const res = (a, b2) => {
    wi.setSlot(0, makeWord(a));
    wi.setSlot(1, makeWord(b2));
    return wi.resolve(r.player.stats).stats;
  };
  ok(res('矢', '炎').shape === 'arrow', '「炎の矢」→ arrow');
  ok(res('球', '雷').shape === 'orb', '「雷の球」→ orb');
  ok(res('刃', '氷').shape === 'blade', '「氷の刃」→ blade');
  ok(res('弾', '毒').shape === 'shot', '「毒の弾」→ shot');
  // 文の語順を逆にすると形が変わる。
  ok(res('球', 'の').shape === 'orb', '「の球」→ orb');
  ok(res('の', '球').shape === 'orb', '「球の」→ orb');

  // 属性も同じように合成語から決まる。
  ok(res('火', 'の').el === 'fire', '「の火」→ fire');
  ok(res('氷', 'の').el === 'ice', '「の氷」→ ice');
  ok(res('雷', 'の').el === 'thunder', '「の雷」→ thunder');

  // レベルを上げると枠が増えて複数形にできる。
  wi.levelUp(); wi.levelUp();
  ok(wi.slots.length === 3, `Lv3 で枠が 3 になる: ${wi.slots.length}`);
  wi.setSlot(0, makeWord('火'));
  wi.setSlot(1, makeWord('の'));
  wi.setSlot(2, makeWord('矢'));
  const s3 = wi.resolve(r.player.stats).stats;
  ok(s3.shape === 'arrow', '「火の矢」→ arrow');
  ok(s3.el === 'fire', '「火の矢」→ fire');
  ok(s3.burn > 0, '「火の矢」→ 炎上あり');
}

sec('貫通と拡散が実際に効く');
{
  const r = newRun(1, ['gun']);
  const wi = r.weapons[0];
  const st = (a, b2) => {
    wi.setSlot(0, makeWord(a));
    wi.setSlot(1, makeWord(b2));
    return wi.resolve(r.player.stats).stats;
  };
  const plain = st('弾', 'の');
  const piercing = st('貫', 'の');
  const spread = st('散弾', 'の');
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

sec('開始時の語袋に語が入っていること');
{
  const r = newRun(1);
  const filled = r.pouch.filter(Boolean).length;
  console.log(`  語袋 ${filled} 語: ${r.pouch.filter(Boolean).map((w) => w.text).join(' ')}`);
  ok(filled >= 6, `語袋が少なすぎる: ${filled}`);

  // すべての武器が最初から文として成立していること。
  for (const wi of r.weapons) {
    const res = wi.resolve(r.player.stats);
    ok(res.active, `${wi.def.name} が開始時に不成文: ${res.reasonText}`);
    ok(res.stats.dmg > 0, `${wi.def.name} の威力が 0`);
  }

  // 語袋の任何一个の語と既存の枠の語を組み合わせれば文が成立できること。
  const wi = r.weapons[0];
  let found = false;
  for (const w of r.pouch) {
    if (!w) continue;
    wi.setSlot(1, w);
    if (wi.resolve(r.player.stats).active) { found = true; break; }
  }
  ok(found, '語袋のどの語でも既存の枠と合わせて文にできない');
}

console.log(`\n---- 合格 ${pass} / 不合格 ${fail} ----`);
process.exit(fail ? 1 : 0);
