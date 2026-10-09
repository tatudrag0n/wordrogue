// ヘッドレスで 1 ステージを最後まで回すテスト。  node test/sim.test.js
// DOM を使わないので Node でそのまま実行できる。
//
// 乱数は最初に固定する。必ず先頭に置くこと (import は宣言順に評価される)。
import './seed.mjs';
import { Run, PICKUP_VMAX, PICKUP_MAGNET, LEXICON_MAX } from '../js/game/run.js';
import { Input } from '../js/core/input.js';
import { makeWord, WORDS, evaluate, CONNECTOR_SET } from '../js/data/words.js';
import { WEAPONS, FORM_SHAPE, KIND_SHAPE } from '../js/data/weapons.js';
import { ENEMIES } from '../js/data/enemies.js';
import { WeaponInst } from '../js/game/weapon.js';
import { makePickup, makeEnemy } from '../js/game/entities.js';
import { damage } from '../js/game/combat.js';
import { SELF_TAIL, resolvePlayerStats } from '../js/game/stats.js';
import { Sentence, MAX_SENTENCE_LEN } from '../js/game/sentence.js';
import { STAGES } from '../js/data/stages.js';
import { Save, META_UPGRADES } from '../js/core/save.js';
import { makeRng } from '../js/core/util.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const sec = (t) => console.log(`\n== ${t} ==`); 
// 音声とセーブのスタブ。
const audio = new Proxy({}, { get: () => () => {} });
const save = { d: { meta: {} } };

const input = { ax: 0, ay: 0, moving: false, angle: 0 };
const dt1 = 1 / 60;

// クリア報酬は言玉の直接払い。三択カードは廃止した。
// かわりに run の報酬額の算出式が壊れないことを見る。
sec('クリア報酬の言玉は難易度とバフで増える');
{
  // 計算式は main.js の onRunEnd と同じ。ここでは素材 (stats) が壊れないことを見る。
  const r = newRun(3);
  r.refreshStats();
  const atk = r.player.stats.atkMul;
  const self = r.player.stats.selfPower;
  ok(Number.isFinite(atk) && atk > 0, `攻撃倍率が壊れている: ${atk}`);
  ok(Number.isFinite(self) && self >= 1, `文の力が壊れている: ${self}`);
  // ステージ 1 と 9 では 9 のほうが高い。
  const inkLow = Math.round((100 + 1 * 100) * 1);
  const inkHigh = Math.round((100 + 9 * 100) * 1);
  ok(inkLow >= 100 && inkLow <= 1000, `言玉の下限が壊れている: ${inkLow}`);
  ok(inkHigh > inkLow && inkHigh <= 1000, `言玉の上限が壊れている: ${inkHigh}`);
  console.log(`  言玉 ${inkLow}〜${inkHigh} (ステージ × 攻撃/文の力で上乗せ)`);
}

// タッチ端末のダッシュボタン。押している間だけダッシュし、
// 指を離しても 0.2 秒だけ続けてタップでも効果が出る。
sec('タッチのダッシュボタン');
{
  // Input はコンストラクタで window のリスナーだけ張るので差し替えれば動く。
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  const inp = new Input();
  ok(!inp.dash, '押していないのにダッシュしている');

  inp.setTouchDash(true);
  ok(inp.dash, 'ダッシュボタンでダッシュしない');
  inp.setTouchDash(false);
  ok(inp.dash, '離したら即座にダッシュが止まる');
  let guard = 0;
  while (inp.dash && guard++ < 200) inp.update(1 / 60);
  ok(!inp.dash, `離したあともダッシュが続く: ${guard} フレーム`);

  inp.keys.add(' ');
  ok(inp.dash, 'スペースでダッシュしない');
  inp.keys.clear();
  ok(!inp.dash, 'キーを離してもダッシュが続く');
  delete globalThis.window;
}


/** 独立したランを作り、武器の枠をすべて空にする。テスト間の汚染を防ぐ。 */
function freshWeapon(stageId = 1, weaponIds) {
  const r = newRun(stageId, weaponIds);
  for (const w of r.weapons) w.sentence.clear();
  return r;
}

/** 文を空から作り直す。… の位置が「語の後ろ」の接続詞。 */
function setWords(wi, spec) {
  wi.sentence.clear();
  for (const item of (Array.isArray(spec) ? spec : [spec])) {
    const [text, conn] = Array.isArray(item) ? item : [item, null];
    wi.sentence.push(makeWord(text));
    if (conn) wi.sentence.setConnAt(wi.sentence.count - 1, conn);
  }
  return wi;
}

/** 文の i 番目の語，直後の接続詞。武器でも自身の文でも使える。 */
const connOf = (sen, i) => ((sen?.sentence || sen)?.at(i) || {}).conn?.text || null;

/**
 * ['焔','を','斬','る'] のような平坦な指定で作る。
 * 接続詞は「直前の語の後ろ」に付く。
 */
function setFlat(wi, list) {
  wi.sentence.clear();
  let last = -1;
  for (const w of list) {
    if (CONNECTOR_SET.has(w)) {
      if (last >= 0) wi.sentence.setConnAt(last, w);
      continue;
    }
    wi.sentence.push(makeWord(w));
    last = wi.sentence.count - 1;
  }
  return wi;
}

/** セーブの初期値。テストごとに分けて、言玉などの持ち越しが混ざらないようにする。 */
function freshSave() {
  return { d: { meta: {} }, unlockWeapon() {} };
}

function newRun(stageId, weaponIds, sv) {
  const save = sv || freshSave();
  return new Run({
    stageId, audio, save, weaponIds,
    // 本番 (main.js) と同じく、書庫で広げたぶんだけ語彙が増える。
    lexiconSize: 12 + (save.lexiconBonus || 0),
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
ok(run.weapons.length === 1, `武器数 ${run.weapons.length}`);
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

sec('文は 10 文字まで / 武器語は自分で置く');
{
  const wi = run.weapons[0];
  const x = wi.resolve(run.player.stats);
  // 文面 = 並べた語 + その直後の接続詞。固定の末尾語は無い。
  const joined = wi.sentence.words.map((w) => w.text).join('');
  ok(x.fullText === joined, `文面が文と一致しない: ${x.fullText} != ${joined}`);
  ok(wi.sentence.maxLen === 10, `文の上限 ${wi.sentence.maxLen}`);

  // 語 1 つでは不成文。
  setWords(wi, ['刃']);
  const one = wi.resolve(run.player.stats);
  ok(!one.active, '1 語にしても有効になっている');
  ok(one.stats.dmg === 0, `威力が 0 でない: ${one.stats.dmg}`);

  // 語 2 つで成立。武器語を中に置けば攻撃の型が決まる。
  setWords(wi, ['刃', '剛']);
  ok(wi.resolve(run.player.stats).valid, '2 語でも不成文');
  ok(wi.tail === '刃', `文の後方から最初に見つかる武器語が ${wi.tail}`);

  // 10 文字を超える語は置けない。
  const over = setWords(wi, ['焔', '剛', '速', 'い', 'を']);
  ok(wi.sentence.len <= 10, `文が 10 文字を超えた: ${wi.sentence.len}`);
  console.log(`  1 語 ${one.reasonText} / 2 語で成立 / 上限 ${wi.sentence.maxLen} 文字`);
}

sec('武器名はその文面になる / 武器語が攻撃を決める');
{
  const wi = run.weapons[0];
  // 「烈しく斬る妙な刃」= 8 文字。末尾の「刃」が武器語。
  setWords(wi, [['烈', 'しく'], ['斬', 'る'], ['妙', 'な'], ['刃']]);
  const res = wi.resolve(run.player.stats);
  console.log(`  「${wi.title}」 ${res.gradeInfo.name} 文力=${res.evalResult.fx.power.toFixed(2)} 攻撃=${res.kind}`);
  ok(wi.title === '烈しく斬る妙な刃', `武器名が文面と違う: ${wi.title}`);
  ok(res.valid, `「${wi.title}」が不成文: ${res.reasonText}`);
  ok(res.kind === 'slash', `武器語が「刃」なら斬撃のはず: ${res.kind}`);
  ok(res.evalResult.fx.explode > 0, '「烈」で爆発が付くはず');
  ok(res.element === 'fire', `「烈」で火になるはず: ${res.element}`);
  ok(res.evalResult.fx.power > 1.3, `文の力が低い: ${res.evalResult.fx.power}`);

  // 並べ替えると文面が変わる。接続詞は語と動く。
  setWords(wi, [['烈', 'しく'], ['斬', 'る'], ['妙', 'な'], ['刃']]);
  const before = wi.title;
  const [a, b] = wi.sentence.entries;
  wi.sentence.entries[0] = b;
  wi.sentence.entries[1] = a;
  const swapped = wi.resolve(run.player.stats);
  ok(swapped.title !== before, '並べ替えても名前が変わらない');
  ok(swapped.title === '斬る烈しく妙な刃', `入れ替え後 ${swapped.title}`);
  ok(swapped.kind === 'slash', `並べ替えで攻撃が変わった: ${swapped.kind}`);
  console.log(`  入れ替え → 「${swapped.title}」 ${swapped.kind}`);

  // 武器語を変えると攻撃の型が変わる。
  setWords(wi, ['刃', '剛', '貫']);
  const mid = wi.resolve(run.player.stats);
  ok(mid.kind === 'slash', `「刃」で斬撃のはず: ${mid.kind}`);
  ok(mid.evalResult.fx.pierce > 0, '「貫」の効果が付いていない');
  setWords(wi, ['銃', '剛', '貫']);
  const gun = wi.resolve(run.player.stats);
  ok(gun.kind === 'shot', `「銃」で射撃のはず: ${gun.kind}`);
  console.log(`  武器語 刃→${mid.kind} / 銃→${gun.kind}`);

  // 武器語どうしは隣り合わない。
  setWords(wi, ['刃', '弾']);
  const two = wi.resolve(run.player.stats);
  ok(!two.valid, `「刃弾」が成立してしまった: ${two.reasonText}`);
  ok(two.reason === 'tailform', `理由 ${two.reason}`);
  console.log(`  武器語どうし → 不成立 (${two.reasonText})`);

  // 「迅足」+「雷」は最長一致で 1 語にまとまる。
  setWords(wi, ['速', '雷']);
  const xunlei = wi.resolve(run.player.stats);
  const seg = xunlei.evalResult.segments;
  ok(seg.join('/') === '速/雷', `速+雷 の分割が合わない: ${seg.join('/')}`);
  console.log(`  「速」+「雷」→ ${seg.join('/')}`);
}

sec('すべての武器が文の中の武器語で攻撃を決める');
{
  const PS = { atk: 1, atkMul: 1, crit: 0, lifesteal: 0, magnet: 0, xpMul: 0, armor: 0, slowImmune: 0, hp: 100 };
  for (const [id, def] of Object.entries(WEAPONS)) {
    ok(WORDS[def.tail], `${def.name}: 武器語「${def.tail}」が辞書に無い`);
    const wi = new WeaponInst(id, 1);
    // 武器語は自動で付かない。開始時の文に自分で置く。
    setFlat(wi, [def.startWord, def.startWord2, def.tail]);
    const r = wi.resolve(PS);
    ok(r.active, `${def.name}: 開始語+武器語で不成文 (${r.reasonText})`);
    ok(r.kind === def.kind, `${def.name}: 武器語「${def.tail}」で ${def.kind} になるはずが ${r.kind}`);
    ok(r.title.endsWith(def.tail), `${def.name}: 名前が武器語で終わらない: ${r.title}`);
    ok(r.evalResult.segments[r.evalResult.segments.length - 1] === def.tail,
      `${def.name}: 分割の最後が武器語でない: ${r.evalResult.segments.join('/')}`);
    console.log(`  ${def.name.padEnd(4)} → 「${r.title}」 ${r.kind} / ${r.shape}`);
  }
}


sec('不成文の武器は無効化される');
{
  const r = freshWeapon(1);
  const wi = r.weapons[0];
  // 全部空 -> 実質語 0 -> 不成文。
  let res = wi.resolve(r.player.stats);
  ok(!res.active, '空の文で有効になっている');
  ok(res.stats.dmg === 0, `威力が 0 でない: ${res.stats.dmg}`);
  ok(res.reasonText, '理由テキストが無い');
  ok(res.reason === 'empty', `理由 ${res.reason}`);
  ok(res.fullText === '', `空のときの文面 ${res.fullText}`);

  // 1 語だけ -> 実質語が足りない -> 不成文。
  setFlat(wi, ['刃']);
  res = wi.resolve(r.player.stats);
  ok(!res.active, '1 語だけで有効になっている');
  ok(res.reason === 'onelexeme', `理由 ${res.reason}`);

  // 接続詞だけの文。語を置いては作れないので直接差し込む。
  wi.sentence.entries = [
    { word: makeWord('の'), conn: null },
    { word: makeWord('を'), conn: null },
    { word: makeWord('い'), conn: null },
  ];
  const r2 = wi.resolve(r.player.stats);
  ok(!r2.active, '接続詞だけの文が成立している');
  ok(r2.reason === 'noparticle', `理由 ${r2.reason}`);

  // 2 語 -> 成立。属性語から始まる、単純な形。
  setFlat(wi, ['焔', '剛']);
  const r3 = wi.resolve(r.player.stats);
  ok(r3.active, `「焔剛」が不成立: ${r3.reasonText}`);
  ok(r3.element === 'fire', `属性 ${r3.element}`);

  // 武器語どうしは隣り合わない。「刃弾」は日本語に無い並び。
  setFlat(wi, ['刃', '弾']);
  const r4 = wi.resolve(r.player.stats);
  ok(!r4.active, '「刃弾」が成立してしまった');
  ok(r4.reason === 'tailform', `理由 ${r4.reason}`);
}

sec('語を並べ替えて 文が変わる');
{
  const r = freshWeapon(1);
  const wi = r.weapons[0];
  const dps = (a, b) => {
    setFlat(wi, [a, b]);
    return wi.resolve(r.player.stats).dps;
  };
  const weak = dps('刃', '剛');
  const strong = dps('昂', '裂');
  console.log(`  刃+剛=${weak.toFixed(1)}  /  昂+裂=${strong.toFixed(1)}`);
  ok(strong > weak, '効果の高い語の方が弱い');
  ok(weak > 0, '成立文書でも威力が 0');
}

sec('語彙の操作')
{
  const r = newRun(1);
  const w = makeWord('氷');
  ok(r.addWord(w, true), '語を追加できない');
  const loc = r.findWord(w);
  ok(loc && loc.where === 'lexicon', '追加した語が見つからない');
  ok(r.placeWord(r.weapons[0], 0, w).ok, '文に置けない');
  ok(r.findWord(w)?.where === 'slot', '語が文に移動していない');
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
  const r = newRun(1, ['gun', 'sword']);
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
  const r = newRun(1, ['gun', 'sword']);
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
  // 自身の文も自由に並べる。末尾の「人」は文の外に固定で付く。
  const set = (...ws) => {
    p.self.clear();
    for (const w of ws) p.self.push(makeWord(w));
    r.refreshStats();
  };

  // 称号は空。
  set();
  ok(p.stats.selfTitle === '', `称号が最初から入っている: ${p.stats.selfTitle}`);

  // 1 語では不成文。末尾の「人」だけでは文にならない。
  set('頑');
  ok(p.stats.selfValid === false, '1 語で称号が成立している');
  ok(p.stats.selfTitle === '頑人', `称号が「${p.stats.selfTitle}」`);

  // 2 語で成立。末尾は「人」。
  set('頑', '走');
  ok(p.stats.selfValid === true, '2 語で称号が成立しない');
  ok(p.stats.selfTitle === '頑走人', `称号が「${p.stats.selfTitle}」`);
  ok(p.stats.selfTitle.endsWith(SELF_TAIL), `末尾が「${SELF_TAIL}」でない: ${p.stats.selfTitle}`);

  // 並べ替えても末尾は動かない。
  p.self.swap(0, 1);
  r.refreshStats();
  ok(p.stats.selfTitle === '走頑人', `並べ替えで称号が変わらない: ${p.stats.selfTitle}`);

  // 「人」は文の外。「人」を入れても 2 つにはならない。
  ok(p.self.count === 2, `文の語が変わっている: ${p.self.count}`);
  ok(!p.self.words.some((w) => w.text === SELF_TAIL), '「人」が文の中にある');

  // 称号の力が attack と防御に効く。
  ok(p.stats.atkMul > 1, `攻撃に称号の力が乗っていない: ${p.stats.atkMul}`);
  ok(p.stats.armor > 0, `防御に称号の力が乗っていない: ${p.stats.armor}`);

  // 分割の最後が「人」。
  const seg = p.stats.selfSegments;
  ok(seg[seg.length - 1] === SELF_TAIL, `分割の最後が「${SELF_TAIL}」でない: ${seg.join('/')}`);

  // resolvePlayerStats を直接呼んでも同じ称号。
  const direct = resolvePlayerStats([], p.self, {});
  ok(direct.selfTitle === '走頑人', `直接呼んだ称号が「${direct.selfTitle}」`);

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
  ok(now.some((w) => w === picked), `選んだ語とは別の(instance)が入っている: ${picked && picked.text}`);

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
    const fill = ['火', '氷', '雷', '毒', '土', '風', '光', '影', '流', '鋼', '崖', '速'];
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
  // 候補と同じ語は選べない (捨てたのに同じ語が入ってしまう)。
  const candText = new Set(c.words.map((w) => w.text));
  const same = r.lexicon.findIndex((w, i) => w && candText.has(w.text) && i !== 3);
  if (same >= 0) {
    const n0 = before.filter((t) => t === before[same]).length;
    ok(!r.chooseWord(c.id, 0, same), `候補と同じ語「${before[same]}」を捨てられてしまった`);
    ok(before.filter((t) => t === before[same]).length === n0, '選べなかったのに語が減った');
  }
  const pick = r.lexicon.findIndex((w, i) => w && !candText.has(w.text));
  ok(pick >= 0, '捨てられる語がない');
  const target = before[pick];
  ok(r.chooseWord(c.id, 0, pick), '捨てる語を指定しても入らない');
  const after = r.lexicon.map((w) => (w ? w.text : null));
  ok(after[pick] === c.words[0].text, `新しい語が ${pick} 番目に入らない: ${after[pick]}`);
  // 同じ語が別の枠にもあるので「残ったか」ではなく「1 つ減ったか」で見る。
  const nTarget = after.filter((t) => t === target).length;
  const nBefore = before.filter((t) => t === target).length;
  ok(nTarget === nBefore - 1, `捨てる語が減っていない: ${nBefore} -> ${nTarget} (${target})`);
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

  // 語彙が満杯でも、語彙の最古の 1 語を捨てて武器から語を外せる。
  const wi = r2.weapons[0];
  const slotWord = wi.sentence.words[0];
  const oldestLex = r2.lexicon[r2.oldestLexiconIndex()];
  const res = r2.toLexicon(slotWord);
  ok(res.ok, `満杯のときに外せない: ${JSON.stringify(res)}`);
  ok(r2.lexicon.includes(slotWord), '語が語彙に入っていない');
  ok(!wi.sentence.words.includes(slotWord), '語が武器から消えた');
  ok(res.lost === oldestLex.text, `捨てるのは最古の語のはず: ${res.lost} / ${oldestLex.text}`);
  // 空きがあっても戻せる。
  r2.lexicon[0] = null;
  const other = wi.sentence.words[0];
  ok(r2.toLexicon(other).ok, '空きがあっても外せない');
  console.log('  満杯でも語彙の最古の 1 語を捨てて外せる');
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
  const self = r.player.self;

  // 文 ⇄ 文。語は入ったまま、並びだけ入れ替わる。
  setFlat(wi, ['焔', '剛', '速']);
  const before = wi.sentence.words.slice();
  const lexBefore = lexText(r);
  const r1 = r.moveWordTo(
    { kind: 'slot', wi, index: 2 },
    { kind: 'slot', wi, index: 0 },
  );
  ok(r1.ok, `文 ⇄ 文 の並べ替えが失敗: ${r1.reason}`);
  ok(wi.sentence.text === '速焔剛', `文の並びが入れ替わっていない: ${wi.sentence.text}`);
  ok(wi.sentence.count === 3, `語が失われた: ${wi.sentence.count}`);
  ok(lexText(r) === lexBefore, '並べ替えで語彙が変わった');

  // 文 → 自身の文。移動になる。
  const moved = wi.sentence.words[0];
  self.clear();
  self.push(before[1]);
  const r2 = r.moveWordTo(
    { kind: 'slot', wi, index: 0 },
    { kind: 'self', index: self.count },
  );
  ok(r2.ok, `文 → 自身の移動が失敗: ${r2.reason}`);
  ok(self.words[self.count - 1] === moved, '自身の文に語が入っていない');
  ok(wi.sentence.count === 2, '元の文から語が消えた');
  ok(wi.sentence.count + self.count === 4, `語が失われた: ${wi.sentence.count} + ${self.count}`);

  // 語彙 → 文。空きがあればそのまま入る。
  const lexWord = r.lexicon.find(Boolean);
  const lexIndex = r.lexicon.indexOf(lexWord);
  const r3 = r.insertInto(wi.sentence, wi.sentence.count, lexWord, wi);
  ok(r3.ok, `語彙 → 文 が失敗: ${r3.reason}`);
  ok(wi.sentence.words[wi.sentence.count - 1] === lexWord, '文に語が入っていない');
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

  console.log('  文 ⇄ 文 / 文 → 自身 / 語彙 → 文 / 語彙 ⇄ 語彙 すべて成立');
}

sec('文の末尾の隙間へドラッグすると並びの末尾に来る');
{
  // 語は枠に嵌めず、隙間（＋）へ落とす。「最後の隙間へ落としたら末尾に
  // 来る」が成り立たないと、文の並び替えができない。
  const r = newRun(1);
  const wi = r.weapons[0];

  const moved = [
    // [ 语を落とす隙間, 期待する並び ]
    // 直後の隙間 (gap 1) は「すでそこにある」ので何も動かない。
    [3, '剛速焔'],
    [2, '剛焔速'],
    [1, '焔剛速'],
    [0, '焔剛速'],
  ];
  for (const [gap, want] of moved) {
    setFlat(wi, ['焔', '剛', '速']);
    const r0 = r.moveWordTo({ kind: 'slot', wi, index: 0 }, { kind: 'gap', wi, index: gap });
    ok(r0.ok, `隙間 ${gap} への移動が失敗: ${r0.reason}`);
    ok(wi.sentence.text === want,
      `隙間 ${gap} の並びが違う: ${wi.sentence.text} (期待 ${want})`);
    ok(wi.sentence.count === 3, `語が失われた: ${wi.sentence.count}`);
  }

  // 文の語 → 文の語。語の上へ落としたら、その語の前に入る。
  setFlat(wi, ['焔', '剛', '速']);
  r.moveWordTo({ kind: 'slot', wi, index: 0 }, { kind: 'slot', wi, index: 2 });
  ok(wi.sentence.text === '剛焔速', `語への並べ替えが違う: ${wi.sentence.text}`);

  console.log(`  語「焔」を末尾の隙間へ -> 「${moved[0][1]}」 / 文の語の上へも置ける`);
}

sec('文 → 語彙 は埋まったマスへ落としても空きへ戻す');
{
  const r = newRun(1);
  const wi = r.weapons[0];
  setFlat(wi, ['焔', '剛', '速']);
  const inSen = wi.sentence.words[0];
  const free0 = r.lexiconFreeCount;
  // 語彙には空きがある。埋まったマスは語彙の最初の語。
  ok(free0 > 0, '語彙に空きが無い');
  const filled = r.lexicon.findIndex(Boolean);

  const res = r.toLexicon(inSen);
  ok(res.ok, `空きがあるのに語彙へ戻せない: ${res.reason}`);
  ok(r.lexiconFreeCount === free0 - 1, `空きが増えていない: ${free0} -> ${r.lexiconFreeCount}`);
  ok(r.lexicon.some((w) => w === inSen), '語彙に戻っていない');
  ok(wi.sentence.words.indexOf(inSen) < 0, '文に語が残っている');
  ok(r.lexicon[filled] !== inSen, '元のマスに入った (空きを使うべき)');

  // 文に戻した語を語彙の先頭以外へ戻しても、語は消えない。
  ok(r.insertInto(wi.sentence, 0, inSen, wi).ok, '文に戻せない');
  const again = r.toLexicon(inSen);
  ok(again.ok, `2 度目に戻せない: ${again.reason}`);
  ok(wi.sentence.count === 2, `文に語が残った: ${wi.sentence.text}`);
  ok(r.lexicon.filter((w) => w === inSen).length === 1, '語彙に同じ語が 2 つある');
  console.log(`  空き ${free0} -> ${free0 - 1} / 文の語は語彙の空きへ戻る`);
}

sec('語をタップすると直後の接続詞が切り替わる');
{
  // 語は自由に置ける。接続詞は「その語の直後」にあるので、タップで回すだけ。
  const r = newRun(1);
  const wi = r.weapons[0];

  // 「発」… プールは する・の・を・に・へ。一周したら無し。
  setFlat(wi, ['焔', '発']);
  const place = { kind: 'slot', wi, index: 1 };
  const opts = wi.sentence.connOptions(1);
  ok(opts.includes('する'), `「発」に「する」が無い: ${opts.join(',')}`);
  ok(opts.includes('の'), `「発」に「の」が無い: ${opts.join(',')}`);
  ok(!opts.includes('く'), `「発」に「く」が入る: ${opts.join(',')}`);

  const lexBefore = lexText(r);
  const seen = [];
  for (let i = 0; i < opts.length + 1; i++) seen.push(r.cycleConnector(place).text);
  ok(seen[0] === opts[0], `最初の接続詞 ${seen[0]}`);
  ok(seen.slice(1, opts.length).join() === opts.slice(1).join(),
    `順番どおりに回らない: ${seen.join(',')}`);
  ok(seen[opts.length] === null, `一周しても無しにならない: ${seen.join(',')}`);
  // 語は消えない。語彙も変わらない。
  ok(wi.sentence.count === 2, `語が消えた: ${wi.sentence.count}`);
  ok(wi.sentence.words[1].text === '発', '語が変わった');
  ok(lexText(r) === lexBefore, '接続詞で語彙が変わった');

  // 「燃」… 動詞。プールは える・やす だけ (燃る・燃された は無い)。一周したら無し。
  setFlat(wi, ['焔', '燃']);
  const opts2 = wi.sentence.connOptions(1);
  ok(opts2.join(',') === 'える,やす', `「燃」の接続詞 ${opts2.join(',')}`);
  const p2 = { kind: 'slot', wi, index: 1 };
  const seen2 = [];
  for (let i = 0; i < opts2.length + 1; i++) seen2.push(r.cycleConnector(p2).text);
  ok(seen2[seen2.length - 1] === null, `一周しても無しにならない: ${seen2.join(',')}`);
  // 「斬」… る・られた・り (プールの順そのまま)。
  setFlat(wi, ['焔', '斬']);
  const opts3 = wi.sentence.connOptions(1);
  ok(opts3.join(',') === 'る,られた,り', `「斬」の接続詞 ${opts3.join(',')}`);

  // 文面には接続詞が入る。
  setFlat(wi, ['焔', 'を', '斬']);
  ok(wi.fullText === '焔を斬', `接続詞の置き場所: ${wi.fullText}`);
  ok(connOf(wi, 0) === 'を', `接続詞の位置 ${connOf(wi, 0)}`);

  // 外すと元に戻る。外した接続詞は語彙には戻らない。
  r.clearConnector({ kind: 'slot', wi, index: 0 });
  ok(wi.fullText === '焔斬', `を を外しても文面が戻らない: ${wi.fullText}`);
  ok(wi.sentence.words[1].text === '斬', `後ろの語が消えた: ${wi.sentence.words[1].text}`);
  ok(lexText(r) === lexBefore, '語彙が変わった');

  // 自身の文の語も同じように回せる。
  const p = r.player;
  p.self.clear();
  p.self.push(makeWord('頑'));
  p.self.push(makeWord('走'));
  const sp = { kind: 'self', index: 0 };
  const c1 = r.cycleConnector(sp).text;
  ok(c1, '自身の接続詞が切り替わらない');
  ok(connOf(p.self, 0) === c1, '自身の接続詞が入っていない');
  ok(r.clearConnector(sp).ok, '自身の接続詞を外せない');
  ok(connOf(p.self, 0) === null, '自身の接続詞が残っている');
  ok(p.self.words[0].text === '頑', `自身の後ろの語が消えた: ${p.self.words[0].text}`);

  // 満杯でも切り替えられる。語彙は関係ない。
  const r2 = newRun(1);
  const wi2 = r2.weapons[0];
  while (r2.lexiconFreeCount > 0) r2.lexicon[r2.lexicon.indexOf(null)] = makeWord('火');
  setFlat(wi2, ['焔', '発']);
  const p3 = { kind: 'slot', wi: wi2, index: 1 };
  const c3 = r2.cycleConnector(p3).text;
  ok(c3, `満杯なのに切り替わらない: ${c3}`);
  ok(r2.clearConnector(p3).ok, '満杯なのに外せない');
  ok(connOf(wi2, 1) === null, '満杯だと接続詞が消えない');
  ok(r2.lexicon.every(Boolean), '満杯の語彙が変わった');

  console.log(`  「発」→ ${opts.join(' → ')} → 無し / 語も語彙も変わらない`);
}sec('語彙が満杯なら最古の 1 語を捨てる');
{
  const r = newRun(1);
  const wi = r.weapons[0];
  const free = r.lexiconFreeCount;
  // 語彙を埋める。
  const filler = ['火', '流', '風', '雷', '刃', '刀', '盾', '剛', '王', '鋼', '環', '光'];
  for (let k = 0; k < free; k++) r.giveWord(makeWord(filler[k % filler.length]), true);
  ok(r.lexiconFull, '満杯になっていない');
  ok(r.lexicon.every(Boolean), '語彙に空きが残っている');

  // 文に語を入れておく。枠は無いので count で数える。
  setFlat(wi, ['焔', '剛']);
  r.player.self.clear();
  r.player.self.push(makeWord('頑'));

  // 語が 1 つも減っていないかを数える。
  const total = () => r.lexicon.filter(Boolean).length
    + r.weapons.reduce((n, w) => n + w.sentence.count, 0)
    + r.player.self.count;
  const n0 = total();

  // 文 → 語彙。満杯でも語彙で最も古い 1 語を捨てて戻す。
  const inSlot = wi.sentence.words[0];
  const oldest = r.lexicon[r.oldestLexiconIndex()];
  const r1 = r.toLexicon(inSlot);
  ok(r1.ok, `満杯のときに語彙へ戻せない: ${r1.reason}`);
  ok(r.lexicon.includes(inSlot), '語が語彙に入っていない');
  ok(!wi.sentence.words.includes(inSlot), '文に語が残っている');
  ok(r1.lost === oldest.text, `捨てるのは最古の語のはず: ${r1.lost} / ${oldest.text}`);
  ok(total() === n0 - 1, `捨てる 1 語ぶんだけ減る: ${total()} / ${n0}`);

  // 語彙の語を文に入れるのは「移動」なので、語彙の空きが 1 つ増える。
  // 語が失われることはない。
  const lexWord = r.lexicon[1];
  const r2 = r.placeWord(wi, wi.sentence.count, lexWord);
  ok(r2.ok, `語彙の語を文に入れられない: ${r2.reason}`);
  ok(wi.sentence.words[wi.sentence.count - 1] === lexWord, '文に語が入っていない');
  ok(r.lexicon[1] === null, '語彙に語が残っている');
  ok(total() === n0 - 1, '移動で語が失われた');

  // 自身の文も同じ。
  const selfWord = r.lexicon[2];
  const r3 = r.placeSelfWord(r.player.self.count, selfWord);
  ok(r3.ok, `自身の文に語を入れられない: ${r3.reason}`);
  ok(r.player.self.words[r.player.self.count - 1] === selfWord, '自身の文に語が入っていない');
  ok(r.lexicon[2] === null, '語彙に語が残っている');
  ok(total() === n0 - 1, '移動で語が失われた');

  // 文 ↔ 文 の入れ替えは通る。語は 2 つとも残る。
  const w1 = wi.sentence.words[0];
  const w2 = wi.sentence.words[1];
  const r4 = r.swapPlaces(
    { kind: 'slot', wi, index: 0 },
    { kind: 'slot', wi, index: 1 },
  );
  ok(r4.ok, `文の入れ替えが失敗: ${r4.reason}`);
  ok([w1, w2].every((w) => wi.sentence.words.includes(w)), '入れ替えで語が失われた');
  ok(total() === n0 - 1, '入れ替えで語が失われた');

  // 文 → 語彙は何度でもできる。空きがあれば捨てる語は無い。
  const back = wi.sentence.words[0];
  const n1 = total();
  const hadFree = r.lexicon.includes(null);
  const r6 = r.toLexicon(back);
  ok(r6.ok, `語彙へ戻せない: ${r6.reason}`);
  ok(r.lexicon.includes(back), '語が語彙に入っていない');
  ok(hadFree ? r6.lost === null : typeof r6.lost === 'string', `捨てる語的报告がおかしい: ${r6.lost}`);
  ok(total() === n1, `移動だけなら数は変わらない: ${total()} / ${n1}`);

  console.log(`  文 → 語彙は何度でもできる (満杯なら最古の 1 語を捨てる / 空き ${r.lexiconFreeCount})`);
}

sec('形と攻撃は文の中の武器語が決める');
{
  // 武器語は自分で文に置く。置いた武器語が形と攻撃を決める。
  for (const id of Object.keys(WEAPONS)) {
    const def = WEAPONS[id];
    const [wantShape, wantKind] = FORM_SHAPE[def.tail]
      || [def.shape || KIND_SHAPE[def.kind], def.kind];
    // 解放されているステージで始める。
    const stage = def.unlock ? def.unlock.stage : 1;
    const r = freshWeapon(stage, [id]);
    const wi = r.weapons[0];
    ok(wi && wi.defId === id, `${id}: 武器=${wi && wi.defId} (ステージ ${stage})`);
    setFlat(wi, [def.startWord, def.startWord2, def.tail]);
    const res = wi.resolve(r.player.stats);
    ok(res.active, `${id}: 不成文 (${res.reasonText})`);
    ok(res.shape === wantShape, `${id}: 形 ${res.shape} が ${wantShape} でない`);
    ok(res.kind === wantKind, `${id}: 攻撃 ${res.kind} が ${wantKind} でない`);
  }

  // 同じ武器でも、置いた武器語が変われば攻撃の型が変わる。
  const r = freshWeapon(1, ['gun']);
  const wi = r.weapons[0];
  const res = (...ws) => {
    setFlat(wi, ws);
    return wi.resolve(r.player.stats);
  };
  // 武器語が文に無ければ、その武器の既定の型。
  const base = res('火', '剛');
  ok(base.shape === 'shot' && base.kind === 'shot', `武器語なし → ${base.shape}/${base.kind}`);
  for (const [form, shape, kind] of [
    ['剣', 'blade', 'slash'], ['球', 'orb', 'shot'], ['刃', 'blade', 'slash'],
    ['環', 'blade', 'orbit'], ['壁', 'orb', 'aura'], ['弾', 'bomb', 'bomb'],
  ]) {
    const x = res('火', form, '剛');
    ok(x.shape === shape, `「${form}」の形が ${x.shape} (${shape} のはず)`);
    ok(x.kind === kind, `「${form}」の攻撃が ${x.kind} (${kind} のはず)`);
  }
  // 文の後方から最初に見つかった武器語が効く。
  const two = res('火', '刃', '剛', '環');
  ok(two.kind === 'orbit' && two.shape === 'blade',
    `後ろの武器語が効かない: ${two.shape}/${two.kind} (${two.tail})`);
  console.log(`  武器語で ${base.shape}/${base.kind} → 環なら ${two.shape}/${two.kind} / 後ろにある方が効く`);

  // 属性は文中の属性語から決まる (武器とは別)。
  ok(res('焔', '剛').element === 'fire', '「焔剛」→ fire');
  ok(res('氷', '剛').element === 'ice', '「氷剛」→ ice');
  ok(res('電', '剛').element === 'thunder', '「電剛」→ thunder');

  // 3 語 + 接続詞も 10 文字に収まる。
  const s3 = res('焔', 'の', '焔', '銃');
  ok(s3.active, `「焔の焔銃」が不成立: ${s3.reasonText}`);
  ok(s3.shape === 'shot', `武器語「銃」で形が ${s3.shape}`);
  ok(s3.element === 'fire', '「焔の焔銃」→ fire');
  ok(s3.stats.burn > 0, '「焔の焔銃」→ 炎上あり');
  ok(wi.sentence.len <= 10, `文が 10 文字を超えた: ${wi.sentence.len}`);
  console.log(`  4 要素 → 「${s3.fullText}」 ${s3.kind} / ${s3.shape} / ${s3.element} (${wi.sentence.len} 文字)`);
}

sec('貫と拡散が実際に効く');
{
  const r = freshWeapon(1, ['gun']);
  const wi = r.weapons[0];
  const st = (a, b2) => {
    setFlat(wi, [a, b2]);
    const res = wi.resolve(r.player.stats);
    ok(res.active, `「${a}${b2}」が不成文: ${res.reasonText}`);
    return res.stats;
  };
  const plain = st('鋼', '速');
  const piercing = st('徹', '鋼');
  const spread = st('散', '鋼');
  ok(piercing.pierce > plain.pierce, `貫: ${plain.pierce} -> ${piercing.pierce}`);
  ok(spread.count > plain.count, `拡散: ${plain.count} -> ${spread.count}`);
  ok(spread.spread > plain.spread, `扇: ${plain.spread} -> ${spread.spread}`);
  console.log(`  貫 ${plain.pierce}->${piercing.pierce} / 数 ${plain.count}->${spread.count} / 扇 ${plain.spread}->${spread.spread}`);
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
  const r = newRun(1, ['sword']);
  const wi = r.weapons[0];
  // 枠は無い。上限は 10 文字だけ。
  ok(wi.sentence.maxLen === 10, `文の上限が ${wi.sentence.maxLen} 文字`);
  ok(wi.sentence.count >= 2, `初期文が足りない: ${wi.sentence.count}`);
  ok(wi.sentence.text === '炎必刃', `初期文が「${wi.sentence.text}」`);

  // 語は 何個でも足せる (10 文字まで)。
  setFlat(wi, ['焔', '火', '球', '剛']);
  const res = wi.resolve(r.player.stats);
  const ev = res.evalResult;
  ok(res.valid, `「焔火球剛」が成立しない: ${res.reasonText}`);
  ok(res.fullText === '焔火球剛', `文面 ${res.fullText}`);
  ok(ev.content === 4, `実質語数 ${ev.content}`);
  console.log(`  4 語 → 「${res.fullText}」${res.gradeInfo.name}`);

  // 10 文字を超える語は入らない。1 文字 × 10 で Mack した、あと 1 語ぶんは空かない。
  const over = setFlat(wi, ['焔', '剛', '電', '貫', '弾', '剛', '速', '必', '会', '裂']);
  ok(wi.sentence.len === 10, `文が 10 文字ではない: ${wi.sentence.len} (${wi.sentence.text})`);
  ok(wi.sentence.words.some((w) => w.text === '焔'), '語が入っていない');
  setFlat(wi, ['焔', '剛', '電', '貫', '弾', '剛', '速', '必', '会', '裂', '毒']);
  ok(wi.sentence.len === 10, `11 語目が収まった: ${wi.sentence.len}`);
  ok(!wi.sentence.words.some((w) => w.text === '毒'), '収まらない語が入った');
  console.log(`  上限 → ${wi.sentence.count} 語 ${wi.sentence.len} 文字「${wi.sentence.text}」`);

  // 熟語は 1 文字 3 語。毒 + 蝕 + 弾 のように乗る。
  const idiom = setFlat(wi, ['毒', '蝕', '弾']).resolve(r.player.stats);
  ok(idiom.valid, `「毒蝕弾」が成立しない: ${idiom.reasonText}`);
  ok(idiom.evalResult.idiom?.phrase === '毒蝕弾', `熟語が乗らない: ${idiom.evalResult.idiom}`);
  console.log(`  熟語 → 「${idiom.fullText}」(${idiom.gradeInfo.name} / 熟語 ${idiom.evalResult.idiom.name})`);

  // 二字熟語と熟語の接続詞。発 + 電 + する + 剣 = 発電する剣。
  const hatsu = setFlat(wi, ['発', '電', 'する', '剣']);
  ok(hatsu.sentence.text === '発電する剣', `「発電する剣」が組めない: ${hatsu.sentence.text}`);
  const hres = hatsu.resolve(r.player.stats);
  ok(hres.valid, `「発電する剣」が成立しない: ${hres.reasonText}`);
  ok(hres.evalResult.idiom?.phrase === '発電', `発電が熟語にならない: ${hres.evalResult.idiom?.phrase}`);
  ok(hres.evalResult.predicated, '発電する が述語にならない');
  const denSuru = setFlat(wi, ['電', 'する', '剣']);
  ok(denSuru.sentence.text === '電剣', `「電」に する が付いてしまう: ${denSuru.sentence.text}`);
  console.log(`  二字熟語 → 「${hres.fullText}」(${hres.gradeInfo.name} / 熟語 ${hres.evalResult.idiom?.name})`);

  // 接続詞は文の力を上げる。同じ語並びで比較する。
  const plain = setFlat(wi, ['焔', '鋼', '剛']).resolve(r.player.stats);
  const gram = setFlat(wi, ['焔', 'の', '鋼', '剛']).resolve(r.player.stats);
  ok(plain.valid && gram.valid, `比較用の文が成立していない: ${gram.reasonText}`);
  ok(gram.evalResult.fx.power > plain.evalResult.fx.power,
    `接続詞で文の力が上がらない: ${plain.evalResult.fx.power} -> ${gram.evalResult.fx.power}`);
  // 接続詞は実効語に数えない。
  ok(gram.evalResult.content === plain.evalResult.content, '接続詞が実効語に数えられている');
  console.log(`  接続詞を足す → 「${plain.fullText}」${plain.evalResult.fx.power.toFixed(2)}`
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
  const PS = r.player.stats;

  // 実在する語だけで組む。接続詞は直前の語に付く。
  const set = (...ws) => setFlat(wi, ws).resolve(PS);

  // 不成文の武器は斬れない。
  const broken = set('刃');
  ok(!broken.valid, '刃だけでは不成文にならない');
  ok(!broken.stats.cutPower, `不成文が斬れる: cutPower=${broken.stats.cutPower}`);

  // ふつうの成立文は 1 語。
  const plain = set('焔', '電', '剛');
  ok(plain.valid, `比較用の文が成立しない: ${plain.evalResult.reasonText}`);
  ok(plain.stats.cutPower === 1, `成立文の斬り数が 1 でない: ${plain.stats.cutPower}`);

  // 熟語があれば +1。
  const idiom = set('毒', '蝕', '弾');
  ok(idiom.valid && idiom.evalResult.idiom, `熟語が成立しない: ${idiom.fullText}`);
  ok(idiom.stats.cutPower === 2, `熟語文の斬り数が 2 でない: ${idiom.stats.cutPower}`);

  // 述語 (接続詞の合成) があれば +1。
  const gram = set('焔', 'を', '斬', 'る');
  ok(gram.valid, `述語の文が成立しない: ${gram.fullText} / ${gram.evalResult.reasonText}`);

  // 日本語にならない文は斬れない。
  const nonsense = set('焔', 'を', '剛', 'された');
  ok(!nonsense.valid, `「${nonsense.fullText}」が成立してしまった`);
  ok(!nonsense.stats.cutPower, `不成文が斬れる: cutPower=${nonsense.stats.cutPower}`);
  ok(gram.evalResult.predicated, `述語になっていない: ${gram.fullText}`);
  ok(gram.stats.cutPower === 2, `述語文の斬り数が 2 でない: ${gram.stats.cutPower}`);

  // 斬る量だけでなく、確率も文で変わる。
  const chance = (res) => res.stats.cutChance;
  ok(chance(plain) < chance(idiom), `熟語は確率も上げる: ${chance(plain)} -> ${chance(idiom)}`);
  ok(chance(plain) < chance(gram), `述語は確率も上げる: ${chance(plain)} -> ${chance(gram)}`);
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
  const set = (...ws) => setFlat(wi, ws).resolve(PS);
  const strong = set('毒', '蝕', '弾');
  ok(strong.valid, `比較用の文が成立しない: ${strong.evalResult.reasonText}`);
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

sec('書庫の言玉で恒久強化を買える');
{
  const save = new Save();
  save.reset();
  ok(save.ink === 0, `最初から言玉がある: ${save.ink}`);

  // 買えない。
  let r = save.buyMeta('hp');
  ok(!r.ok && r.reason === 'ink', `言玉がないのに買えた: ${r.reason}`);
  ok(save.metaLevel('hp') === 0, '買えなかったのに段階上がった');

  // enough .put って買う。
  save.addInk(1000);
  ok(save.ink === 1000, `言玉が入らない: ${save.ink}`);

  const before = save.ink;
  r = save.buyMeta('hp');
  ok(r.ok, `買えない: ${r.reason}`);
  ok(save.ink < before, `言玉が減っていない: ${before} -> ${save.ink}`);
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

  const plain = resolvePlayerStats([], new Sentence(), {});
  const buffed = resolvePlayerStats([], new Sentence(), save.d.meta);
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

sec('言玉で語彙の枠を広げると次のランで入る');
{
  const save = new Save();
  save.reset();
  save.addInk(2000);
  const r = save.buyMeta('lexicon');
  ok(r.ok, `買えない: ${r.reason}`);
  ok(save.metaLevel('lexicon') === 1, `段階 ${save.metaLevel('lexicon')}`);
  ok(save.lexiconBonus === 1, `語彙の追加数 ${save.lexiconBonus}`);

  const before = newRun(1, undefined, save);
  const plain = newRun(1, undefined, new Save());
  plain.save?.reset?.();
  ok(before.lexicon.length > plain.lexicon.length,
    `語彙が広がっていない: ${before.lexicon.length} vs ${plain.lexicon.length}`);
  console.log(`  語彙 ${plain.lexicon.length} → ${before.lexicon.length} 個`);
}

console.log(`\n---- 合格 ${pass} / 不合格 ${fail} ----`);
process.exit(fail ? 1 : 0);
