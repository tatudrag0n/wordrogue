// 属性融合と動作合成が、文レベルと実戦 (sim) で効くか。  node test/fusion.test.js
//
// 融合 … 文に 2 つの異なる属性が入り、定義済みペアなら振る舞いが変わる
//        (火+水=蒸気の雲、雷+水=感電の伝播…)。定義の無いペアは従来の
//        色ブレンドに落ち、融合は主攻撃の微減と引き換えに範囲・継続で効く。
// 合成 … 異なる型の動作動詞が 2 つあると「主動作 → 副動作」になる
//        (斬り貫く = 斬撃のあとに貫通)。副動作は威力を落として実行され、
//        攻撃間隔 (rate) は変わらない。
//
// DPS の対照は「同等文」: 主属性 + 同じ主属性の相方語 (融合しない) の文と、
// 合成は「同一文で副動作だけを捨てた場合」と比べる。的はボス (文斬り無効・
// 装甲なし) を固定し、HP 減少 (DoT 込み) で実効 DPS を測る。
//
// 乱数は最初に固定する。必ず先頭に置くこと。
import './seed.mjs';
import { Run } from '../js/game/run.js';
import { makeWord, WORDS } from '../js/data/words.js';
import { WeaponInst } from '../js/game/weapon.js';
import { makeEnemy, updateEnemy } from '../js/game/entities.js';
import { fireWeapon } from '../js/game/combat.js';
import { FUSIONS, FUSION_BY_ID, fusionOf } from '../js/data/fusion.js';
import { SUB_ACTION_MUL } from '../js/data/weapons.js';
import { makeRng } from '../js/core/util.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const sec = (t) => console.log(`\n== ${t} ==`);
const audio = new Proxy({}, { get: () => () => {} });

function newRun(weaponId = 'sword', seed = 99) {
  return new Run({
    stageId: 1, audio, save: { d: {} }, weaponIds: [weaponId], lexiconSize: 12,
    rng: makeRng(seed),
  });
}

function setSentence(wi, spec) {
  wi.sentence.clear();
  for (const [t, c] of spec) {
    wi.sentence.push(makeWord(t));
    if (c) wi.sentence.setConnAt(wi.sentence.count - 1, c);
  }
  return wi;
}

function resolve(spec, weaponId = 'sword') {
  const r = newRun(weaponId);
  const wi = setSentence(r.weapons[0], spec);
  return { run: r, wi, res: wi.resolve(r.player.stats) };
}

// ─────────────────────────────────────────────────────────────────────────────
sec('融合テーブル: 定義の健全性');
{
  ok(Object.keys(FUSIONS).length === 7, `融合は 7 ペアのはず: ${Object.keys(FUSIONS).length}`);
  const bad = [];
  for (const [key, f] of Object.entries(FUSIONS)) {
    if (!f.id || !f.name || !f.desc) bad.push(`${key}: id/name/desc が無い`);
    if (!f.palette || !f.palette.core || !f.palette.mid || !f.palette.outer) bad.push(`${key}: パレットが無い`);
    if (FUSION_BY_ID[f.id] !== f) bad.push(`${key}: ID 索引がずれている`);
    const [a, b] = key.split('+');
    if (fusionOf(a, b) !== f || fusionOf(b, a) !== f) bad.push(`${key}: 順序で結果が変わる`);
  }
  ok(!bad.length, `融合テーブル: ${bad.join(' / ')}`);
  ok(fusionOf('fire', 'fire') === null, '同じ属性どうしで融合している');
  ok(fusionOf('fire', 'none') === null, '無属性で融合している');
  ok(fusionOf('fire', 'light') === null, '定義の無いペア (火+光) で融合している');
  console.log(`  融合 ${Object.keys(FUSIONS).length} ペア: ${Object.values(FUSIONS).map((f) => f.name).join(' / ')}`);
}

// ─────────────────────────────────────────────────────────────────────────────
sec('文レベル: 定義ペアで融合が付く');
{
  const cases = [
    ['蒸気', [['炎', 'no'], ['水', 'no'], ['刃']], 'steam', 'fire', 'water'],
    ['蒸気 (逆順)', [['水', 'no'], ['炎', 'no'], ['刃']], 'steam', 'water', 'fire'],
    ['蒸気爆発', [['炎', 'no'], ['氷', 'no'], ['刃']], 'steamblast', 'fire', 'ice'],
    ['感電', [['雷', 'no'], ['水', 'no'], ['刃']], 'conduct', 'thunder', 'water'],
    ['炎嵐', [['炎', 'no'], ['風', 'no'], ['刃']], 'firestorm', 'fire', 'wind'],
    ['吹雪', [['氷', 'no'], ['風', 'no'], ['刃']], 'blizzard', 'ice', 'wind'],
    ['泥', [['土', 'no'], ['水', 'no'], ['刃']], 'mud', 'earth', 'water'],
    ['汚染', [['毒', 'no'], ['水', 'no'], ['刃']], 'pollution', 'poison', 'water'],
  ];
  const bad = [];
  for (const [label, spec, id, el, sub] of cases) {
    const { res } = resolve(spec);
    if (!res.active) { bad.push(`${label}: 不成文 (${res.reasonText})`); continue; }
    if (res.element !== el || res.subElement !== sub) bad.push(`${label}: 属性 ${res.element}/${res.subElement}`);
    if (!res.fusion || res.fusion.id !== id) bad.push(`${label}: 融合 ${res.fusion?.id} (期待 ${id})`);
    if (res.stats.fusion !== id) bad.push(`${label}: stats.fusion ${res.stats.fusion}`);
    if (res.fusion && res.fusion.name !== FUSION_BY_ID[id].name) bad.push(`${label}: 融合名が定義と違う`);
  }
  ok(!bad.length, `融合の付与: ${bad.join(' / ')}`);
  console.log(`  ${cases.length} 文で融合を確認 / 不一致 ${bad.length}`);
}

sec('文レベル: 融合しない文は従来どおり');
{
  const bad = [];
  // 定義の無いペアは色ブレンド (副属性) だけが残り、融合は付かない。
  const blend = resolve([['炎', 'no'], ['光', 'no'], ['刃']]).res;
  if (blend.fusion !== null) bad.push('火+光で融合している');
  if (blend.subElement !== 'light') bad.push(`火+光の副属性が消えた: ${blend.subElement}`);
  if (blend.stats.fusion !== undefined) bad.push('火+光で stats.fusion が付いた');
  // 属性 1 つでは融合しない。
  const single = resolve([['炎', 'no'], ['刃']]).res;
  if (single.fusion !== null) bad.push('火のみで融合している');
  // 手の属性で主属性だけ付いた文 (文中に属性が無い) では融合しない。
  const r = newRun();
  const wi = setSentence(r.weapons[0], [['水', 'no'], ['刃']]);
  const psHand = { ...r.player.stats, handElement: 'fire' };
  const hand = wi.resolve(psHand);
  if (hand.fusion !== null) bad.push('手の属性と文の属性で融合している');
  ok(!bad.length, `融合しない文: ${bad.join(' / ')}`);
  console.log(`  定義外ペア / 単属性 / 手の属性 の 3 ケースを確認`);
}

sec('文レベル: 融合の再配分が stats に出る');
{
  const bad = [];
  // 感電 + 連鎖する武器 (雷): 跳躍 +2 と感電の上乗せが付く。
  // (武器語を入れない文にすると、雷武器の既定の型 chain のままになる。
  //  雷武器はステージ解放の都合で Run からは作れないので WeaponInst で直接見る)
  const psRun = newRun();
  const thunderOf = (spec) => {
    const w = new WeaponInst('thunder', 1);
    setSentence(w, spec);
    return w.resolve(psRun.player.stats);
  };
  const thunder = thunderOf([['雷', 'no'], ['水', 'no']]);
  const thunderBase = thunderOf([['雷']]);
  if (thunder.stats.kind !== 'chain') bad.push(`雷武器の型が chain でない: ${thunder.stats.kind}`);
  if (!((thunder.stats.chain || 0) >= (thunderBase.stats.chain || 0) + 2)) {
    bad.push(`感電の跳躍が伸びない: ${thunder.stats.chain} (素 ${thunderBase.stats.chain})`);
  }
  if (!((thunder.stats.shock || 0) > (thunderBase.stats.shock || 0))) bad.push('感電の shock が伸びない');
  // 泥: 撃退が弱まる (泥に飲まれる)。
  const mud = resolve([['土', 'no'], ['水', 'no'], ['槌']], 'hammer').res;
  const earth = resolve([['土', 'no'], ['岩', 'no'], ['槌']], 'hammer').res;
  if (!(mud.stats.knock < earth.stats.knock)) bad.push(`泥で撃退が弱まらない: ${mud.stats.knock} vs ${earth.stats.knock}`);
  // 蒸気: 主攻撃の威力が微減している (場の原資)。
  const steam = resolve([['炎', 'no'], ['水', 'no'], ['刃']]).res;
  const steamNoCut = (steam.stats.dmg || 0) / 0.9;
  if (!(steam.stats.dmg < steamNoCut)) bad.push('蒸気の威力再配分が無い');
  ok(!bad.length, `融合の再配分: ${bad.join(' / ')}`);
  console.log(`  感電の跳躍 / 泥の撃退減 / 蒸気の威力再配分 を確認`);
}

// ─────────────────────────────────────────────────────────────────────────────
sec('文レベル: 動作合成が付く');
{
  const cases = [
    ['斬り貫く刃', [['斬', 'り'], ['貫', 'く'], ['刃']], 'slash', 'pierce', '斬', '貫'],
    ['貫き斬る刃', [['貫', 'き'], ['斬', 'る'], ['刃']], 'pierce', 'slash', '貫', '斬'],
    ['斬り刺す刃', [['斬', 'り'], ['刺', 'す'], ['刃']], 'slash', 'thrust', '斬', '刺'],
    ['斬り刈る刃', [['斬', 'り'], ['刈', 'る'], ['刃']], 'slash', 'sweep', '斬', '刈'],
  ];
  const bad = [];
  for (const [label, spec, main, sub, mv, sv] of cases) {
    const { res } = resolve(spec);
    if (!res.active) { bad.push(`${label}: 不成文 (${res.reasonText})`); continue; }
    if (!res.compose) { bad.push(`${label}: 合成が付かない`); continue; }
    if (res.compose.main !== main || res.compose.sub !== sub) {
      bad.push(`${label}: 合成 ${res.compose.main}>${res.compose.sub} (期待 ${main}>${sub})`);
    }
    if (res.compose.mainVerb !== mv || res.compose.subVerb !== sv) {
      bad.push(`${label}: 動詞 ${res.compose.mainVerb}>${res.compose.subVerb}`);
    }
    if (res.kind !== main) bad.push(`${label}: 主動作が型になっていない (${res.kind})`);
    if (res.stats.subKind !== sub) bad.push(`${label}: stats.subKind ${res.stats.subKind}`);
    if (res.stats.subMul !== SUB_ACTION_MUL) bad.push(`${label}: 副動作の倍率が定義と違う`);
  }
  ok(!bad.length, `動作合成の付与: ${bad.join(' / ')}`);
  console.log(`  ${cases.length} 文で合成を確認 / 不一致 ${bad.length}`);
}

sec('文レベル: 合成しない文は従来どおり');
{
  const bad = [];
  const single = resolve([['斬', 'る'], ['刃']]).res;
  if (single.compose !== null || single.kind !== 'slash') bad.push(`動詞 1 つで合成/型変化: ${single.kind}`);
  const same = resolve([['斬', 'り'], ['裂', 'く'], ['刃']]).res;
  if (same.compose !== null) bad.push('同じ型どうし (斬+裂) で合成している');
  const blaze = resolve([['斬', 'り'], ['燃', 'やす'], ['刃']]).res;
  if (blaze.compose !== null) bad.push('合成対象外の型 (燃焼) で合成している');
  if (blaze.kind !== 'blaze') bad.push(`従来の型決定が変わった: ${blaze.kind} (期待 blaze)`);
  // 3 つの動作は主+副の 2 つまで。3 つ目は合成に入らない。
  const triple = resolve([['斬', 'り'], ['貫', 'き'], ['刺', 'す'], ['刃']]).res;
  if (!triple.valid) bad.push(`3 動詞の文が不成文: ${triple.reasonText}`);
  else if (!triple.compose || triple.compose.main !== 'slash' || triple.compose.sub !== 'pierce') {
    bad.push(`3 動詞の合成が先頭 2 つでない: ${JSON.stringify(triple.compose)}`);
  }
  ok(!bad.length, `合成しない文: ${bad.join(' / ')}`);
  console.log(`  動詞 1 つ / 同じ型 / 対象外の型 / 3 動詞 の 4 ケースを確認`);
}

// ─────────────────────────────────────────────────────────────────────────────
// sim: 的を固定して撃ち続け、HP 減少 (DoT 込み) から実効 DPS を測る。
// ─────────────────────────────────────────────────────────────────────────────
function measure(spec, { weaponId = 'sword', seconds = 20, targets = [90], dropSub = false } = {}) {
  const r = newRun(weaponId);
  const wi = setSentence(r.weapons[0], spec);
  const res = wi.resolve(r.player.stats);
  if (!res.active) return { dps: 0, res, err: res.reasonText };
  const es = targets.map((dx) => {
    const e = makeEnemy('boss_slime', r.player.x + dx, r.player.y);
    e.def = { ...e.def, ai: 'chase' };
    e.hp = 1e12; e.maxHp = 1e12; e.speed = 0;
    r.enemies.push(e);
    return { e, dx, hp0: e.hp };
  });
  const interval = 1 / res.stats.rate;
  const dt = 1 / 60;
  let next = 0;
  for (let f = 0; f < seconds * 60; f++) {
    const t = f / 60;
    r.t = t;
    if (t >= next) {
      fireWeapon(r, wi, res);
      if (dropSub) r.pendingActions.length = 0;
      next = t + interval;
    }
    r.pendingTick(dt);
    r.bulletTick(dt);
    r.fieldTick(dt);
    for (const { e, dx } of es) {
      updateEnemy(e, r, dt);
      e.x = r.player.x + dx; e.y = r.player.y;
    }
  }
  const total = es.reduce((s, { e, hp0 }) => s + (hp0 - e.hp), 0);
  return { dps: total / seconds, res, es };
}

sec('sim: 融合の単体 DPS は同等文の ±20% 目安に収まる');
{
  const pairs = [
    ['蒸気', [['炎', 'no'], ['水', 'no'], ['刃']], [['炎', 'no'], ['焔', 'no'], ['刃']]],
    ['蒸気爆発', [['炎', 'no'], ['氷', 'no'], ['刃']], [['炎', 'no'], ['焔', 'no'], ['刃']]],
    ['感電', [['雷', 'no'], ['水', 'no'], ['刃']], [['雷', 'no'], ['電', 'no'], ['刃']]],
    ['炎嵐', [['炎', 'no'], ['風', 'no'], ['刃']], [['炎', 'no'], ['焔', 'no'], ['刃']]],
    ['吹雪', [['氷', 'no'], ['風', 'no'], ['刃']], [['氷', 'no'], ['霜', 'no'], ['刃']]],
    ['泥', [['土', 'no'], ['水', 'no'], ['刃']], [['土', 'no'], ['岩', 'no'], ['刃']]],
    ['汚染', [['毒', 'no'], ['水', 'no'], ['刃']], [['毒', 'no'], ['液', 'no'], ['刃']]],
  ];
  const bad = [];
  for (const [label, a, b] of pairs) {
    const ra = measure(a);
    const rb = measure(b);
    if (ra.err || rb.err) { bad.push(`${label}: 不成文 (${ra.err || rb.err})`); continue; }
    const ratio = ra.dps / rb.dps;
    console.log(`  ${label}: 融合 ${ra.dps.toFixed(1)} / 同等 ${rb.dps.toFixed(1)} / 比率 ${ratio.toFixed(2)}`);
    if (!(ratio >= 0.8 && ratio <= 1.25)) bad.push(`${label}: 比率 ${ratio.toFixed(2)} が目安 (0.80〜1.25) の外`);
  }
  ok(!bad.length, `融合 DPS: ${bad.join(' / ')}`);
}

sec('sim: 蒸気は斬撃の届かない敵にも効く (場の継続)');
{
  const setup = (spec) => {
    const r = newRun('sword', 7);
    const wi = setSentence(r.weapons[0], spec);
    const res = wi.resolve(r.player.stats);
    const a = makeEnemy('brute', r.player.x + 70, r.player.y);
    const b = makeEnemy('brute', r.player.x + 130, r.player.y);
    for (const e of [a, b]) { e.hp = 1e9; e.maxHp = 1e9; e.speed = 0; r.enemies.push(e); }
    return { r, wi, res, a, b };
  };
  const step = ({ r, wi, res, a, b }, seconds) => {
    const interval = 1 / res.stats.rate;
    const dt = 1 / 60;
    let next = 0;
    for (let f = 0; f < seconds * 60; f++) {
      const t = f / 60;
      r.t = t;
      if (t >= next) { fireWeapon(r, wi, res); next = t + interval; }
      r.pendingTick(dt); r.bulletTick(dt); r.fieldTick(dt);
      for (const [e, dx] of [[a, 70], [b, 130]]) {
        updateEnemy(e, r, dt);
        e.x = r.player.x + dx; e.y = r.player.y;
      }
    }
  };
  const steam = setup([['炎', 'no'], ['水', 'no'], ['刃']]);
  step(steam, 3);
  const steamField = steam.r.fields.find((f) => f.fusion === 'steam');
  ok(!!steamField, '蒸気の場が残っていない');
  ok(steamField && steamField.tick > 0, '蒸気の場が継続型でない');
  ok(steam.b.hp < steam.b.maxHp || steam.b.burn > 0,
    `斬撃の届かない敵に蒸気が効いていない (hp ${steam.b.hp}/${steam.b.maxHp}, burn ${steam.b.burn})`);
  const ctrl = setup([['炎', 'no'], ['焔', 'no'], ['刃']]);
  step(ctrl, 3);
  ok(ctrl.b.hp >= ctrl.b.maxHp && !(ctrl.b.burn > 0),
    '対照 (融合なし) で届かない敵が傷ついている');
  console.log(`  蒸気: 遠い敵 hp ${steam.b.hp.toFixed(0)}/${steam.b.maxHp} burn ${steam.b.burn} / 対照は無傷`);
}

sec('sim: 蒸気爆発は焦点の周囲を巻き込む');
{
  const setup = (spec) => {
    const r = newRun('sword', 7);
    const wi = setSentence(r.weapons[0], spec);
    const res = wi.resolve(r.player.stats);
    const a = makeEnemy('boss_slime', r.player.x + 90, r.player.y);
    const b = makeEnemy('boss_slime', r.player.x + 145, r.player.y + 30);
    for (const e of [a, b]) { e.def = { ...e.def, ai: 'chase' }; e.hp = 1e9; e.maxHp = 1e9; e.speed = 0; r.enemies.push(e); }
    return { r, wi, res, a, b };
  };
  const blast = setup([['炎', 'no'], ['氷', 'no'], ['刃']]);
  fireWeapon(blast.r, blast.wi, blast.res);
  ok(blast.b.hp < blast.b.maxHp, '爆発が隣の敵を巻き込んでいない');
  const ctrl = setup([['炎', 'no'], ['焔', 'no'], ['刃']]);
  fireWeapon(ctrl.r, ctrl.wi, ctrl.res);
  ok(ctrl.b.hp >= ctrl.b.maxHp, '対照 (融合なし) で隣の敵が傷ついている');
  console.log(`  蒸気爆発: 隣接敵 hp ${blast.b.hp.toFixed(0)}/${blast.b.maxHp} / 対照は無傷`);
}

sec('sim: 感電は連鎖しない攻撃からも跳ねる');
{
  const setup = (spec) => {
    const r = newRun('sword', 7);
    const wi = setSentence(r.weapons[0], spec);
    const res = wi.resolve(r.player.stats);
    const a = makeEnemy('boss_slime', r.player.x + 90, r.player.y);
    const b = makeEnemy('boss_slime', r.player.x + 200, r.player.y);
    for (const e of [a, b]) { e.def = { ...e.def, ai: 'chase' }; e.hp = 1e9; e.maxHp = 1e9; e.speed = 0; r.enemies.push(e); }
    return { r, wi, res, a, b };
  };
  const conduct = setup([['雷', 'no'], ['水', 'no'], ['刃']]);
  fireWeapon(conduct.r, conduct.wi, conduct.res);
  ok(conduct.b.hp < conduct.b.maxHp, '感電の稲妻が次の敵へ跳ねていない');
  ok(conduct.r.lightnings.length > 0, '感電の稲妻が描かれていない');
  const ctrl = setup([['雷', 'no'], ['電', 'no'], ['刃']]);
  fireWeapon(ctrl.r, ctrl.wi, ctrl.res);
  ok(ctrl.b.hp >= ctrl.b.maxHp, '対照 (融合なし) で稲妻が跳ねている');
  console.log(`  感電: 先の敵 hp ${conduct.b.hp.toFixed(0)}/${conduct.b.maxHp} / 対照は無傷`);
}

sec('sim: 斬り貫く刃は斬撃のあとに突き (貫通) が続く');
{
  const r = newRun('sword', 7);
  const wi = setSentence(r.weapons[0], [['斬', 'り'], ['貫', 'く'], ['刃']]);
  const res = wi.resolve(r.player.stats);
  const a = makeEnemy('boss_slime', r.player.x + 90, r.player.y);
  const b = makeEnemy('boss_slime', r.player.x + 190, r.player.y);
  for (const e of [a, b]) { e.def = { ...e.def, ai: 'chase' }; e.hp = 1e9; e.maxHp = 1e9; e.speed = 0; r.enemies.push(e); }
  fireWeapon(r, wi, res);
  ok(a.hp < a.maxHp, '主動作 (斬撃) が当たっていない');
  ok(r.pendingActions.length === 1, `副動作が予約されていない: ${r.pendingActions.length}`);
  const dt = 1 / 60;
  let sawBullet = false;
  for (let f = 0; f < 90; f++) {
    r.t = f / 60;
    r.pendingTick(dt);
    r.bulletTick(dt);
    r.fieldTick(dt);
    if (r.bullets.some((x) => x.pierce > 0)) sawBullet = true;
    for (const [e, dx] of [[a, 90], [b, 190]]) { e.x = r.player.x + dx; e.y = r.player.y; }
  }
  ok(sawBullet, '副動作の貫通弾が出ていない');
  ok(b.hp < b.maxHp, '副動作 (貫通) が後ろの敵まで届いていない');
  const thrustMotion = wi.motionLog.some((m) => m.family === 'thrust');
  ok(thrustMotion, '副動作のモーション (突きの所作) が描かれていない');
  console.log(`  斬撃 → 貫通弾 → 後方の敵 hp ${b.hp.toFixed(0)}/${b.maxHp} / 突きの所作 ${thrustMotion ? 'あり' : 'なし'}`);
}

sec('sim: 合成の増加は +30% 目安に収まり、攻撃間隔は変わらない');
{
  const spec = [['斬', 'り'], ['貫', 'く'], ['刃']];
  const on = measure(spec);
  const noSub = measure(spec, { dropSub: true });
  const premium = on.dps / noSub.dps;
  console.log(`  斬り貫く刃: 全体 ${on.dps.toFixed(1)} / 副なし ${noSub.dps.toFixed(1)} / プレミアム ${premium.toFixed(2)}`);
  ok(premium >= 1.05 && premium <= 1.32, `合成プレミアム ${premium.toFixed(2)} が目安 (1.05〜1.32) の外`);

  // 実戦ループ (weaponTick) で数える: 副動作を捨てても主動作の回数は同じ。
  const countFires = (drop) => {
    const r = newRun('sword', 5);
    const wi2 = setSentence(r.weapons[0], spec);
    wi2.resolve(r.player.stats);
    const input = { ax: 0, ay: 0, moving: false, angle: 0 };
    for (let f = 0; f < 600; f++) {
      r.player.invuln = 999;
      r.update(1 / 60, input);
      if (drop) r.pendingActions.length = 0;
    }
    return { attacks: wi2.attackCount, dealt: r.dmgDealt };
  };
  const full = countFires(false);
  const dropped = countFires(true);
  ok(full.attacks === dropped.attacks,
    `主動作の回数が副動作で変わった: ${full.attacks} vs ${dropped.attacks}`);
  ok(full.dealt > dropped.dealt, '副動作ぶんのダメージが増えていない');
  console.log(`  10 秒の実戦: 主動作 ${full.attacks} 回 (副なしでも ${dropped.attacks} 回) / 与ダメージ ${full.dealt.toFixed(0)} vs ${dropped.dealt.toFixed(0)}`);
}

console.log(`\n---- 合格 ${pass} / 不合格 ${fail} ----`);
process.exit(fail ? 1 : 0);
