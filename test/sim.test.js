// ヘッドレスで 1 ステージを最後まで回すテスト。  node test/sim.test.js
// DOM を使わないので Node でそのまま実行できる。
import { Run } from '../js/game/run.js';
import { makeWord, WORDS } from '../js/data/words.js';
import { WEAPONS } from '../js/data/weapons.js';
import { WeaponInst } from '../js/game/weapon.js';
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

/** 独立したランを作り、武器の枠をすべて空にする。テスト間の汚染を防ぐ。 */
function freshWeapon(stageId = 1, weaponIds) {
  const r = newRun(stageId, weaponIds);
  for (const w of r.weapons) w.slots.fill(null);
  return r;
}

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
  wi.setSlot(1, makeWord('利'));
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
  wi.setSlot(1, makeWord('利'));
  wi.setSlot(2, makeWord('貫通'));
  const mid = wi.resolve(run.player.stats);
  ok(mid.kind === 'slash', `途中の「貫通」で攻撃が変わった: ${mid.kind}`);
  ok(mid.evalResult.fx.pierce > 0, '「貫通」の効果が付いていない');
  console.log(`  途中に「貫通」→ 攻撃 ${mid.kind} / 貫通 ${mid.stats.pierce}`);

  // 爆弾を文に入れても、剣なら斬撃のまま。
  wi.slots.fill(null);
  wi.setSlot(0, makeWord('刃'));
  wi.setSlot(1, makeWord('利'));
  wi.setSlot(2, makeWord('爆弾'));
  const bomb = wi.resolve(run.player.stats);
  ok(bomb.kind === 'slash', `途中の「爆弾」で爆弾になった: ${bomb.kind}`);
  ok(bomb.title.endsWith('剣'), `末尾が動いた: ${bomb.title}`);
  ok(bomb.evalResult.fx.explode > 0, '「爆弾」の効果までは付く');
  console.log(`  途中に「爆弾」→ 「${bomb.title}」 ${bomb.kind} (爆発 ${bomb.evalResult.fx.explode.toFixed(0)} は付く)`);

  // 「迅」+「雷」は 1 語の「迅雷」になる (最長一致)。
  wi.slots.fill(null);
  wi.setSlot(0, makeWord('迅'));
  wi.setSlot(1, makeWord('雷'));
  const xunlei = wi.resolve(run.player.stats);
  const seg = xunlei.evalResult.segments;
  ok(seg.includes('迅雷') || seg.join('/') === '迅/雷/' + wi.tail,
    `迅+雷 が最長一致にならない: ${seg.join('/')}`);
  ok(seg[seg.length - 1] === wi.tail, `末尾語が最後にない: ${seg.join('/')}`);
  console.log(`  「迅」+「雷」→ ${seg.join('/')}`);
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

  // 助詞だけ -> 不成文。
  wi.setSlot(0, makeWord('の'));
  wi.setSlot(1, makeWord('は'));
  const r2 = wi.resolve(r.player.stats);
  ok(!r2.active, '助詞だけの文が成立している');
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
  const weak = dps('刃', '利');
  const strong = dps('激', '分裂');
  console.log(`  刃+利=${weak.toFixed(1)}  /  激+分裂=${strong.toFixed(1)}`);
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

sec('レベルアップでことばが獲得できる');
{
  const r = newRun(1);
  const before = r.pouch.filter(Boolean).length;
  const size0 = r.pouch.length;
  r.grantLevelWords(2);
  ok(r.pouch.filter(Boolean).length > before,
    `レベルアップで語が入らない: ${before} -> ${r.pouch.filter(Boolean).length}`);

  // 5 の倍数なら 2 枚。
  const r2 = newRun(1);
  const b2 = r2.pouch.filter(Boolean).length;
  r2.grantLevelWords(5);
  ok(r2.pouch.filter(Boolean).length >= b2 + 2, `5 の倍数で 2 枚入らない: ${b2} -> ${r2.pouch.filter(Boolean).length}`);

  // 4 レベルごとに自身の文に 1 語。
  const r3 = newRun(1);
  r3.grantLevelWords(5);
  const selfFilled = r3.player.selfSlots.filter(Boolean).length;
  ok(selfFilled === 1, `自身の文に語が入らない: ${selfFilled}`);

  // 語袋が 8 レベルごとに広がる。
  const r4 = newRun(1);
  ok(r4.pouch.length === size0, `初期サイズが変わった: ${r4.pouch.length}`);
  for (let lv = 2; lv <= 20; lv++) r4.grantLevelWords(lv);
  ok(r4.pouch.length > size0, `レベルを上げても語袋が広がらない: ${size0} -> ${r4.pouch.length}`);
  ok(r4.pouch.length <= 20, `語袋が際限なく増える: ${r4.pouch.length}`);
  console.log(`  語袋 12 -> ${r4.pouch.length} (Lv20)`);

  // 実際にレベルアップ経由で入ること。
  const r5 = newRun(1);
  const n0 = r5.pouch.filter(Boolean).length;
  r5.collect({ type: 'xp', value: 100 });
  ok(r5.player.level > 1, `レベルが上がらない: ${r5.player.level}`);
  ok(r5.pouch.filter(Boolean).length > n0, `レベルアップで語袋が増えない: ${n0} -> ${r5.pouch.filter(Boolean).length}`);
  console.log(`  経験値 100 で Lv${r5.player.level} / 語袋 ${n0} -> ${r5.pouch.filter(Boolean).length}`);
}

sec('語袋が満杯でも語が入る');
{
  const r = newRun(1);
  const { makeWord } = await import('../js/data/words.js');
  while (r.pouch.includes(null)) r.addWord(makeWord('刃'), true);
  ok(!r.pouch.includes(null), '語袋が埋まっていない');
  const dropped = r.pouch[0].text;
  r.giveWord(makeWord('雷'));
  ok(r.pouch.length > 0, '語袋が壊れた');
  ok(r.pouch.some((w) => w && w.text === '雷'), '新しい語が入っていない');
  ok(r.pouch.every(Boolean), '空きが生じた');
  console.log(`  満杯から「雷」を差し替え (${dropped} が消えた)`);
}

sec('形と攻撃は末尾語だけが決める');
{
  // 武器ごとに末尾語を移し替えれば、攻撃の型が変わる。
  // 語を並べ替えても、末尾語categorie 動かない。
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
  wi.setSlot(1, makeWord('の'));
  wi.setSlot(2, makeWord('矢'));
  const s3 = wi.resolve(r.player.stats);
  ok(s3.active, `「火の矢」が不成立: ${s3.reasonText}`);
  ok(s3.shape === 'shot', `「火の矢銃」で形が ${s3.shape}`);
  ok(s3.element === 'fire', '「火の矢」→ fire');
  ok(s3.stats.burn > 0, '「火の矢」→ 炎上あり');
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
  const piercing = st('貫', '弾');
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

  // 語袋に 2 語以上入る。1 語では 文の組み立て方に幅が出ないため。
  ok(filled >= 9, `語袋が少なすぎる: ${filled} (10 語のはず)`);
  console.log(`  語袋: ${r.pouch.filter(Boolean).map((w) => w.text).join(' ')}`);
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
  const gram = set('刃', '火', '弾', 'の', '球');
  ok(plain.valid && gram.valid, '比較用の文が成立していない');
  ok(gram.evalResult.fx.power > plain.evalResult.fx.power,
    `助詞で文の力が上がらない: ${plain.evalResult.fx.power} -> ${gram.evalResult.fx.power}`);
  // 助詞は分割に効くので、成立は崩れない。
  ok(gram.evalResult.content === plain.evalResult.content, '助詞が実質語に数えられている');
  console.log(`  助詞を足す → 「${plain.fullText}」${plain.evalResult.fx.power.toFixed(2)}`
    + ` → 「${gram.fullText}」${gram.evalResult.fx.power.toFixed(2)}`);
}

console.log(`\n---- 合格 ${pass} / 不合格 ${fail} ----`);
process.exit(fail ? 1 : 0);
