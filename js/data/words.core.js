// ============================================================================
// ワードローグ — 語テーブル (属性)
// フォーマット: 語  種別  属性  効果(半角スペース区切り)
//   種別: element / phenom / form / modifier / verb / connect
//   属性: element のときだけ必須。それ以外は -
//   効果: key+数値 の並び。
//     効果は武器の文で読む。装甲・回復・吸血・会心・幸運・吸引・盾など、
//     体に効くキーは部位強化でもプレイヤーに乗る。
//     体に効く専用語という分類は無い — どの語も武器の文で読める語だけにする。
//
// 語は「すべて 1 文字の漢字」。語を並べるだけで日本語の文になるので、
// 部品だけの 2 文字の語は置かない。効果語も動詞も属性語も全部 1 文字。
// 例 「炎」「を」「斬」「られた」「妙」「な」「刃」 -> 炎を斬られた妙な刃
// 接続詞 (送り仮名) だけがひらがな。語ごとに words.pool.js で持つ。
//   静 + かな = 静かな / 滑 + らかな = 滑らかな / 凍 + える = 凍える
// ============================================================================

/** 属性定義。色と纏わる状態異常の紐付け。 */
export const ELEMENTS = {
  none:     { name: '無属性', color: '#6b7383', glow: 'rgba(107,115,131,.34)', status: null },
  fire:     { name: '火', color: '#d9480f', glow: 'rgba(217,72,15,.34)', status: 'burn' },
  ice:      { name: '氷', color: '#1971c2', glow: 'rgba(25,113,194,.34)', status: 'chill' },
  thunder:  { name: '雷', color: '#c2870a', glow: 'rgba(194,135,10,.38)', status: 'shock' },
  poison:   { name: '毒', color: '#4f9b13', glow: 'rgba(79,155,19,.34)', status: 'poison' },
  light:    { name: '光', color: '#d9a406', glow: 'rgba(217,164,6,.42)', status: 'none' },
  dark:     { name: '闇', color: '#5f3dc4', glow: 'rgba(95,61,196,.34)', status: 'none' },
  earth:    { name: '土', color: '#a3703f', glow: 'rgba(163,112,63,.34)', status: 'none' },
  wind:     { name: '風', color: '#2f9e8f', glow: 'rgba(47,158,143,.34)', status: 'none' },
  nature:   { name: '草', color: '#2f9e44', glow: 'rgba(47,158,68,.34)', status: 'poison' },
  steel:    { name: '鉄', color: '#64748b', glow: 'rgba(100,116,139,.34)', status: 'none' },
  blood:    { name: '血', color: '#c92a46', glow: 'rgba(201,42,70,.34)', status: 'none' },
  water:    { name: '水', color: '#1c7ed6', glow: 'rgba(28,126,214,.34)', status: 'chill' },
  gold:     { name: '金', color: '#e8a30a', glow: 'rgba(232,163,10,.42)', status: 'none' },
};

/** 語の種類。UI 表示と抽選重みに使う。色は明るい紙地 (和紙) を前提にする。 */
export const CATEGORIES = {
  element:  { name: '属性', color: '#e8762a', weight: 30 },
  phenom:   { name: '現象', color: '#12a58a', weight: 20 },
  // 形態語は武器語ではない「ただの語」。数だけ多いので抽選の重みは落としてある。
  form:     { name: '形態', color: '#2f7fc4', weight: 12 },
  modifier: { name: '効果', color: '#4e9b1f', weight: 24 },
  verb:     { name: '動詞', color: '#d94f7a', weight: 18 },
  connect:  { name: '接続', color: '#5b7fb5', weight: 18 },
};

/**
 * 武器語 = **基本武器の語だけ**。
 *
 * 武器語といえるのは次の 3 つをまとめて満たす語だけだった。
 *   1. レベルアップの 3 択で「武器語」として出る
 *   2. 文の中にあると攻撃の型を決める
 *   3. 文の末尾 (武器の名前) になれる
 * 環・弾・玉・球・壁 のような形態語は 1 を満たさない (語彙から引けるただの語) ので、
 * 武器語から外した。武器語はこの 15 語だけ。
 */
export const WEAPON_WORDS = [
  '刃', '剣', '刀', '斧', '槌', '槍', '矛', '牙', '爪', '弓', '鞭', '鎖', '杖', '拳', '銃', '針',
];
export const WEAPON_WORD_SET = new Set(WEAPON_WORDS);

/** 武器語 (基本武器) か。 */
export const isWeaponWord = (text) => WEAPON_WORD_SET.has(text);

// ─────────────────────────────────────────────────────────────────────────
// カテゴリ分類の基準 (文の中での働きで決める。迷ったら上から順に当てる)
//   1. 属性 element … 属性値 (el) を持ち、文全体の属性を決める体言。特殊武器になれる。
//   2. 現象 phenom  … 属性値は持たないが、自然現象・自然の力そのものを指す体言 (渦)。
//                     属性と同じく特殊武器になれる。
//   3. 形態 form    … 具体的な物の形・道具を指す体言。武器の頭になれるのは基本武器だけ。
//   4. 動詞 verb    … 動作・作用そのものが主役で、述語になる語。
//   5. 効果 modifier… 上のどれでもなく、他の語を修飾するのが主役の語。
//   6. 接続 connect … 送り仮名。語ではない。
// 「体に効く語」という分類は無い。部位強化では、語の効果のうち体に効くキー
// (装甲・回復・吸血・会心・幸運・吸引・盾・体力) だけがプレイヤーにも乗る。
// 1 語が複数カテゴリに属してよい (words.js の cats)。
//   動詞の形 (述語) を持つ語は、本来の分類に加えて verb も持つ (震える・還る・走る)。
//   形容の形は品詞 (pos) で表し、分類は増やさない。
// 境界の例: 岩は地の力として属性、小さい石は投擲する弾体として形態。
//           圧・律は現象そのものより作用の修飾が主役なので効果。
// ─────────────────────────────────────────────────────────────────────────

// 品詞と接続詞 (送り仮名) は語ごとに words.pool.js で決める。
// ここは語の種別・属性・効果だけを持つ。

/**
 * 末尾語を直接修飾できない語。
 *
 * 日本語に「刃剣」「弾銃」「矢弓」は無い。末尾語が既に形を表すので、
 * その直前に別の形を表す語を置くと名詞の叠字になる。
 * 効果としての「貫通」「散弾」は末尾語を普通に修飾できるので、
 * 対象は「物としての形」だけの語に限っている。
 * 甲・鞘・鍔・柄・晶 のような道具の語は入れない — 形の語そのものではなく、
 * 「長柄の槍」「氷晶の剣」は の で係れば普通に読める。
 */
export const TAIL_UNMODIFIABLE = new Set([
  '刃', '剣', '刀', '斧', '槌', '槍', '矛', '戈', '牙', '爪',
  '弾', '銃', '玉', '矢', '針', '弓', '球', '珠', '光', '雷',
  '岩', '石', '環', '輪', '鞭', '鎖', '壁', '網', '盾', '杖', '拳',
]);

const RAW_ELEMENT = `
火     element fire    dmg+2  burn+1.5
炎     element fire    dmg+3  burn+1
熱     element fire    dmg+1  burn+1  area+4
焔     element fire    dmg+4  burn+3
創     element fire    dmg+1  burn+3.5
炭     element fire    dmg+3  burn+2  area+6
烈     element fire    dmg+5  burn+4  explode+14
煙     element fire    dmg+2  burn+3.5  area+10
灰     element fire    dmg+1  burn+2  speed+15
獄     element fire    dmg+4  burn+4  explode+12
劫     element fire    dmg+3  burn+6  area+14
燼     element fire    dmg+2  burn+7  area+12

氷     element ice     dmg+2  chill+0.10
雪     element ice     dmg+2  chill+0.12  count+1
霜     element ice     dmg+3  chill+0.18  area+6
冬     element ice     dmg+4  chill+0.24  speed-10

電     element thunder dmg+3  shock+0.14
震     element thunder dmg+4  shock+0.22  area+8
磁     element thunder dmg+5  shock+0.18  magnet+0.35
雷     element thunder dmg+7  pierce+5  crit+0.06  speed+30  shock+0.14
閃     element thunder dmg+5  crit+0.08  speed+50  shock+0.10

毒     element poison  dmg+1  poison+2
液     element poison  dmg+2  poison+3  area+4
蝕     element poison  dmg+2  poison+2.5  pierce+2
霧     element poison  dmg+2  poison+3.5  area+10
菌     element poison  dmg+3  poison+5  count+3  area+8
瘴     element poison  dmg+3  poison+5  count+2  area+6

聖     element light   dmg+3  pierce+1
神     element light   dmg+5  lifesteal+0.02
輝     element light   dmg+3  burn+1
耀     element light   dmg+2  crit+0.04
虹     element light   dmg+2  pierce+1  chain+2
陽     element light   dmg+2  regen+0.5  area+6
天     element light   dmg+2  pierce+1  speed+20
光     element light   dmg+8  pierce+8  speed+60  size+0.20
霞     element light   dmg+1  pierce+1
皓     element light   dmg+1  crit+0.03  speed+10
青     element light   dmg+2  crit+0.02  speed+8
白     element light   dmg+1  speed+8  pierce+1
煌     element light   dmg+4  crit+0.06  area+8
赤     element blood   dmg+3  burn+1

闇     element dark    dmg+3  crit+0.02
暗     element dark    dmg+2  crit+0.04  homing+0.10
黒     element dark    dmg+3  pierce+2  armor+1
夜     element dark    dmg+5  pierce+3  crit+0.04
死     element dark    dmg+3  lifesteal+0.03
亡     element dark    dmg+3  crit+0.03
魔     element dark    dmg+4  crit+0.07  lifesteal+0.03
影     element dark    dmg+1  crit+0.02  homing+0.10
漆     element dark    dmg+2  crit+0.03  homing+0.14
冥     element dark    dmg+4  lifesteal+0.03  pierce+1
羅     element dark    dmg+3  crit+0.05  count+1
刹     element dark    dmg+2  crit+0.06  speed+40
虚     element dark    dmg+3  homing+0.20  pierce+2
幻     element dark    dmg+2  count+2  homing+0.25

土     element earth   dmg+2  size+0.15  speed-10
砂     element earth   dmg+2  count+2  size-0.05
塵     element earth   dmg+1  count+2  size-0.05  speed-10
地     element earth   dmg+5  area+12  speed-25
陸     element earth   dmg+4  speed-20  size+0.25  knock+30
崖     element earth   dmg+4  explode+14  size+0.30  speed-15
原     element earth   dmg+3  knock+60  speed-20  area+8
岩     element earth   dmg+9  explode+20  size+0.35  area+12  speed-20

風     element wind    dmg+1  speed+45  homing+0.08
嵐     element wind    dmg+3  area+14  speed+40  knock+40
突     element wind    dmg+3  pierce+5  speed+60
旋     element wind    dmg+4  area+18  rate+0.6  orbit+1
疾     element wind    dmg+2  speed+70  count+1
翔     element wind    dmg+2  homing+0.12  speed+50
迅     element wind    dmg+3  speed+65  rate+0.3
颯     element wind    dmg+2  speed+55  homing+0.12  knock+25

草     element nature  dmg+1  poison+1.5  regen+0.3
樹     element nature  dmg+2  poison+1.2  regen+1.2  area+6
苔     element nature  dmg+1  poison+1  chill+0.05
芽     element nature  dmg+1  poison+0.8  regen+0.6  homing+0.08
緑     element nature  dmg+2  poison+0.8  regen+0.6  speed-5
根     element nature  dmg+2  pierce+3  poison+1
花     element nature  dmg+1  poison+1  regen+0.8  lifesteal+0.01

鉄     element steel   dmg+3  speed+10  size+0.10
鋼     element steel   dmg+4  pierce+2  size+0.12
銀     element steel   dmg+2  crit+0.03  speed+25
錬     element steel   dmg+3  armor+1  size+0.10
峰     element steel   dmg+4  pierce+3
嶺     element steel   dmg+2  range+12
鉱     element steel   dmg+2  speed+20  pierce+1

血     element blood   dmg+3  lifesteal+0.04
呪     element blood   dmg+3  poison+2  homing+0.10
蓮     element blood   dmg+5  burn+5  lifesteal+0.05  area+12
紅     element blood   dmg+2  burn+2  crit+0.02

水     element water   dmg+2  chill+0.06
波     element water   dmg+3  chill+0.07  knock+45  pierce+2
流     element water   dmg+2  chill+0.06  count+1
泡     element water   dmg+1  chill+0.08  count+2
淵     element dark    dmg+3  pierce+2
露     element water   dmg+1  regen+0.8  chill+0.04
潮     element water   dmg+2  chill+0.06  knock+20
浪     element water   dmg+4  chill+0.08  knock+70  area+14

金     element gold    dmg+2  magnet+0.25
財     element gold    dmg+3  magnet+0.60
宝     element gold    dmg+4  magnet+0.50  atkMul+0.04
`;

// ─────────────────────────────────────────────────────────────────────────────
// 形態語: 何を一般に撃つかを決める核
//
// 武器語はすべて 1 文字。「太刀」「大剣」のように 2 文字では作らない。
// 末尾語と並べたときに日本語として破綻しない形だけを置く。
// ─────────────────────────────────────────────────────────────────────────────
const RAW_FORM = `
刃     form  -  dmg+5  speed+60  pierce+2
剣     form  -  dmg+8  size+0.20
刀     form  -  dmg+9  arc+0.5  size+0.30
斧     form  -  dmg+11  speed-10  size+0.35  knock+30
槌     form  -  dmg+14  speed-20  size+0.35  knock+45
槍     form  -  dmg+7  crit+0.04  speed+40
矛     form  -  dmg+13  pierce+5  crit+0.06  speed+30
戈     form  -  dmg+9  arc+0.8  size+0.25
牙     form  -  dmg+6  crit+0.03
爪     form  -  dmg+4  count+2  speed+20  arc+0.6
拳     form  -  dmg+7  speed+40  arc+0.6

弾     form  -  dmg+6  count+1  explode+30
銃     form  -  dmg+7  count+1  speed+40
玉     form  -  dmg+4  count+2  spread+0.3
矢     form  -  dmg+5  speed+90  pierce+1
針     form  -  dmg+2  speed+90  count+1
弓     form  -  dmg+5  speed+110  pierce+1
杖     form  -  dmg+6  pierce+2  speed+30
球     form  -  dmg+6  area+6  size+0.15
珠     form  -  dmg+10  pierce+4  bounce+2  crit+0.06
還     form  -  dmg+11  pierce+5  bounce+3  speed+40

石     form  -  dmg+7  speed-20  size+0.25  knock+20

環     form  -  orbit+1  count+2  dmg+5
輪     form  -  orbit+1  dmg+7  size+0.15
鞭     form  -  dmg+7  area+12  range+40
鎖     form  -  dmg+6  area+14  bounce+3
壁     form  -  dmg+6  shield+18  area+10
網     form  -  dmg+5  area+14  slowImmune+1
盾     form  -  dmg+4  shield+22  armor+2

# ── 鍛冶と具足 (盾・壁と同じ「ただの物」の語。部位強化でも効く) ──
#   体の強化に使う語を別の分類にはしない。甲・鍔・盾・壁はみな形態語で、
#   文の中でも体の中でも同じ効き方をする。
甲     form  -  dmg+4  armor+3  shield+12
鞘     form  -  dmg+3  speed+30  rate+0.15
鍔     form  -  dmg+2  armor+3  shield+16
釘     form  -  dmg+4  pierce+3  speed+25
柄     form  -  size-0.12  speed+20  rate+0.15
晶     form  -  dmg+4  crit+0.04  pierce+1
`;

// ─────────────────────────────────────────────────────────────────────────────
// 効果語: 修飾
//
// 付く接続詞 (送り仮名) は語ごとに words.pool.js で決める。
//
// ここの分類は「武器名の主題をどう強めるか」の分類で、品詞ではない。
// プールが名詞 (の・を・に・へ) だけの効果語 (敵・魂・力…) は、
// 文の中では名詞句として使う。敵を斬る剣 / 敵の剣を斬る剣。
// 自然さの topicmod (効果で始まる −0.3) は、格を取った名詞用法には付けない。
// ─────────────────────────────────────────────────────────────────────────────
const RAW_MODIFIER = `
# ── い形容詞 (く・い) ──
強    modifier  -  dmg+4
速    modifier  -  rate+0.4  speed+35
鋭    modifier  -  crit+0.05  speed+15
重    modifier  -  dmg+5  knock+25
硬    modifier  -  armor+2  dmg+2
柔    modifier  -  speed+18
明    modifier  -  pierce+2  crit+0.02
早    modifier  -  rate+0.30
遅    modifier  -  rate-0.20  dmg+7  knock+30  area+6
高    modifier  -  crit+0.05
深    modifier  -  dmg+3  pierce+1
遠    modifier  -  range+30
近    modifier  -  range-20  dmg+6  crit+0.05
長    modifier  -  range+25
短    modifier  -  range-15  dmg+7  rate+0.25
大    modifier  -  size+0.35  area+12
多    modifier  -  count+2  spread+0.18
少    modifier  -  count-1  dmg+9  crit+0.04  size+0.12
広    modifier  -  area+8
小    modifier  -  size-0.25  speed+30  rate+0.3
淡    modifier  -  speed+15  pierce+2
濃    modifier  -  dmg+4  area+6
甘    modifier  -  regen+1.2
渋    modifier  -  crit+0.04  speed+10
寂    modifier  -  chill+0.10  regen+0.4
眠    modifier  -  regen+0.6  speed-10
香    modifier  -  poison+2  regen+0.3
良    modifier  -  dmg+3  armor+1
悪    modifier  -  dmg+6  lifesteal+0.03
荒    modifier  -  area+10  dmg+3
寒    modifier  -  chill+0.30  speed-8
温    modifier  -  regen+1.0  size+0.05
厚    modifier  -  armor+4  size+0.15  speed-10
軽    modifier  -  speed+45  size-0.15  rate+0.3
鈍    modifier  -  rate-0.5  dmg+5  area+10
冷    modifier  -  chill+0.30  speed-8

# ── な形容詞 (な・に) ──
#   見出しは「名詞を修飾する効果語」の意味。敵・精・端・霊 はプールが
#   名詞 (の・を・に・へ) だけで、な形容詞の形は持たない (名詞として使う)。
静    modifier  -  chill+0.25
穏    modifier  -  speed+10  armor+1
無    modifier  -  dmg+7  crit+0.06  rate+0.3
厳    modifier  -  armor+3  size+0.10
敵    modifier  -  crit+0.06  dmg+5  pierce+1
奇    modifier  -  crit+0.10  homing+0.3  speed+10
豪    modifier  -  dmg+5  area+6  speed+10
雅    modifier  -  crit+0.06  speed+15
華    modifier  -  area+12  crit+0.05
麗    modifier  -  area+10  crit+0.04
燦    modifier  -  crit+0.05  dmg+2
精    modifier  -  crit+0.08  dmg+2
密    modifier  -  pierce+2  crit+0.05
真    modifier  -  crit+0.04  dmg+3
素    modifier  -  speed+15  pierce+1
正    modifier  -  crit+0.10  pierce+2
賢    modifier  -  xpMul+0.10  dmg+3
巨    modifier  -  size+0.40  area+10  speed-8
酷    modifier  -  dmg+9  area+6
確    modifier  -  crit+0.10  pierce+2
活    modifier  -  rate+0.5  dmg+2
端    modifier  -  dmg+3  armor+1
滑    modifier  -  speed+30  homing+0.2
準    modifier  -  crit+0.05  dmg+2
妙    modifier  -  crit+0.06  rate+0.2
霊    modifier  -  regen+0.5  armor+1
適    modifier  -  speed+25  range+10
剛    modifier  -  dmg+5  armor+3
壮    modifier  -  dmg+4  size+0.20
清    modifier  -  speed+20  crit+0.03
宏    modifier  -  size+0.80  area+22  speed-16  dmg+2

# ── 名詞・動詞的效果語 ──
心    modifier  -  crit+0.08  homing+0.25
渦    phenom    -  dmg+5  orbit+2
乱    phenom    -  dmg+1  count+2  spread+0.25
圧    modifier  -  knock+90  size+0.2  speed-10
律    modifier  -  rate+0.6  count+1  dmg+3
斉    modifier  -  count+3  dmg+4  rate+0.3
引    modifier  -  magnet+0.9  size+0.05
導    modifier  -  homing+0.70  speed+15
徹    modifier  -  pierce+2
執    modifier  -  dmg+7  rate+0.2
瞬    modifier  -  dmg+6  crit+0.12  critDmg+0.6
会    modifier  -  crit+0.12  critDmg+0.4
必    modifier  -  crit+0.20  critDmg+0.8  dmg+3
急    modifier  -  crit+0.15  critDmg+0.5
反    modifier  -  recoil+60  dmg+6  size+0.20
退    modifier  -  knock+55
衰    modifier  -  dmg+3  area+10  chill+0.15
合    modifier  -  count+2  split+2
再    modifier  -  regen+1.4
回    modifier  -  regen+0.9
続    modifier  -  duration+1.2  area+8
減    modifier  -  chill+0.20
特    modifier  -  atkMul+0.10  crit+0.05  pierce+2
囲    modifier  -  area+20  duration+0.8
捷    modifier  -  rate+0.8  speed+40
衆    modifier  -  count+4  spread+0.16
昂    modifier  -  dmg+12
威    modifier  -  dmg+8  crit+0.04
打    modifier  -  dmg+8  knock+35
防    modifier  -  armor+4  shield+16
程    modifier  -  range+28
撃    modifier  -  dmg+6  pierce+2
連    modifier  -  count+1  rate+0.2  dmg+3
固    modifier  -  armor+2
湧    modifier  -  count+3  area+8
潤    modifier  -  regen+0.6  armor+1
発    modifier  -  dmg+4  area+8  speed+25
穢    modifier  -  poison+3  area+8
爛    modifier  -  poison+3  dmg+2
覇    modifier  -  dmg+8  size+0.18  armor+2
優    modifier  -  regen+0.4  speed+5
護    modifier  -  shield+16  regen+0.3
結    modifier  -  dmg+4  chill+0.15
穿    modifier  -  dmg+5  pierce+6
通    modifier  -  dmg+4  pierce+4

骨    modifier  -  dmg+3  armor+2
魂    modifier  -  dmg+2  lifesteal+0.03
`;

// ─────────────────────────────────────────────────────────────────────────────
// 核語: 武器に最初から埋め込まれ、語彙には出ない
// ただし語彙にも引ける。強い語なので。
// ─────────────────────────────────────────────────────────────────────────────
const RAW_CORE = `
志    modifier  -  dmg+3   rate+0.20
気    modifier  -  dmg+2   homing+0.08
己    modifier  -  dmg+1   regen+0.3
皆    modifier  -  area+8   count+1
力    modifier  -  dmg+6
巧    modifier  -  crit+0.08  dmg+2
守    modifier  -  shield+20  regen+0.4
感    modifier  -  area+10  size+0.15
智    modifier  -  xpMul+0.20  atkMul+0.05
`;

// ─────────────────────────────────────────────────────────────────────────────
// 動詞: これ 1 枚で 1 つの動作になる。
//
// 全部 1 個の漢字。かなの動詞は使わない。
// 1 個の漢字にしておくと、送り仮名で自然と文になる。
//   斬 + られた = 斬られた / 貫 + く = 貫く / 爆 + ぜる = 爆ぜる
// ─────────────────────────────────────────────────────────────────────────────
const RAW_VERB = `
爆      verb  -  dmg+5  explode+32  area+8
殺      verb  -  dmg+7  crit+0.06
滅      verb  -  dmg+5  area+10  pierce+2
轟      verb  -  dmg+6  explode+38  area+12  knock+60
侵      verb  -  dmg+4  burn+2  pierce+2
炸      verb  -  dmg+5  explode+32  area+6
破      verb  -  dmg+4  explode+26  area+8
沸      verb  -  dmg+2  area+14  burn+2
凍      verb  -  dmg+4  chill+0.32  freeze+0.25
燃      verb  -  dmg+4  burn+5  area+6
焼      verb  -  dmg+3  burn+4
焦      verb  -  dmg+2  burn+3  poison+1
溶      verb  -  dmg+2  chill+0.16  size-0.10
融      verb  -  dmg+1  chill+0.12  regen+0.3
蒸      verb  -  dmg+2  burn+3  area+8
貫      verb  -  dmg+5  pierce+4
射      verb  -  dmg+3  speed+60
斬      verb  -  dmg+8  crit+0.08
砕      verb  -  dmg+6  knock+40
殴      verb  -  dmg+6  rate+0.3
散      verb  -  dmg+2  count+3  spread+0.4
伸      verb  -  dmg+2  size+0.30
縮      verb  -  dmg+1  speed+50  size-0.15
跳      verb  -  dmg+2  homing+0.35
響      verb  -  dmg+4  chain+3
裂      verb  -  dmg+3  split+3
舞      verb  -  dmg+4  orbit+1  bounce+3
吸      verb  -  dmg+1  lifesteal+0.05  magnet+0.30
吐      verb  -  dmg+3  explode+14
潜      verb  -  dmg+2  homing+0.3  speed+40
浮      verb  -  dmg+2  homing+0.4  speed+60
沈      verb  -  dmg+3  size+0.3  speed-15
昇      verb  -  dmg+3  speed+80  homing+0.2
降      verb  -  dmg+3  area+16  speed-20
挟      verb  -  dmg+2  count+2  spread+0.3
掴      verb  -  dmg+3  size+0.35  speed-20
掘      verb  -  dmg+3  pierce+2  speed+20
叩      verb  -  dmg+4  knock+40  rate+0.2
踏      verb  -  dmg+4  size+0.25  knock+25
擦      verb  -  dmg+3  burn+2  pierce+1
潰      verb  -  dmg+6  area+14  knock+35
嚇      verb  -  dmg+3  slowImmune+1  chill+1
縛      verb  -  dmg+2  slowImmune+1  magnet+0.3
浴      verb  -  dmg+3  burn+3  area+10
浸      verb  -  dmg+3  poison+4  duration+0.8
錆      verb  -  dmg+4  poison+2  rate-0.05
癒      verb  -  dmg+1  regen+0.8
鍛      verb  -  dmg+4  armor+2

# ── 中二病の語。意味のままに強い効果だけを乗せる (弱くなるだけの語は作らない) ──
絶      verb  -  dmg+8  crit+0.05  pierce+2
終      verb  -  dmg+7  crit+0.03
戮      verb  -  dmg+9  crit+0.08
屠      verb  -  dmg+8  crit+0.06  knock+35
討      verb  -  dmg+7  rate+0.15  knock+30
刈      verb  -  dmg+5  area+10  arc+0.4
祓      verb  -  dmg+4  regen+0.5  pierce+2
祟      verb  -  dmg+4  poison+3  lifesteal+0.02
葬      verb  -  dmg+8  lifesteal+0.03  crit+0.03
刺      verb  -  dmg+5  pierce+3
刻      verb  -  dmg+4  count+1  crit+0.04
駆      verb  -  dmg+3  speed+70  rate+0.2
研      verb  -  dmg+5  crit+0.07  pierce+2
煉      verb  -  dmg+4  burn+3  area+6
`;

// ─────────────────────────────────────────────────────────────────────────────
// 追加語彙
//
// 「一」「山」「海」「砲」のような、1 文字で意味の通る語をまとめて足した。
// 分類は既存の語と同じ基準で決めている (属性 → 現象 → 形態 → 動詞 → 効果)。
// どの語も 1 文字なので、並べただけで文になる。
//   山の剣 / 海を斬る / 砲の弾 / 七の刃
// 動詞の活用形は words.pool.js に置く (る・られた・り …)。
// ─────────────────────────────────────────────────────────────────────────────
const RAW_EXT_ELEMENT = `
朱     element fire    dmg+2  burn+2
灼     element fire    dmg+4  burn+4
炮     element fire    dmg+5  burn+5  explode+18
赫     element fire    dmg+3  burn+2  crit+0.04
碧     element water   dmg+2  crit+0.03  chill+0.04
汰     element water   dmg+2  speed+20  chill+0.04
沫     element water   dmg+1  count+2  chill+0.05
濁     element water   dmg+3  poison+2  chill+0.05
滝     element water   dmg+4  knock+55  chill+0.05
湖     element water   dmg+3  chill+0.07  area+10
海     element water   dmg+3  chill+0.07  area+14
濤     element water   dmg+5  chill+0.10  knock+70  area+14
雨     element water   dmg+1  count+2  chill+0.05
雫     element water   dmg+2  chill+0.08
洞     element earth   dmg+2  pierce+3
山     element earth   dmg+6  size+0.28  knock+30
雲     element wind    dmg+1  speed+30  area+8
霹     element thunder dmg+4  shock+0.20  area+8
靂     element thunder dmg+5  shock+0.25
竜     element thunder dmg+6  pierce+3  shock+0.12
龍     element thunder dmg+8  pierce+4  speed+30  shock+0.14
霓     element light   dmg+2  pierce+2
鳳     element light   dmg+6  speed+40
麒     element light   dmg+5  crit+0.04
麟     element light   dmg+4  regen+0.5
皎     element light   dmg+2  crit+0.03  speed+10
日     element light   dmg+3  burn+2
紫     element dark    dmg+2  crit+0.04
黎     element dark    dmg+1  speed+10
鬼     element dark    dmg+6  crit+0.05
屍     element dark    dmg+4  poison+2  lifesteal+0.02
閻     element dark    dmg+5  crit+0.04  lifesteal+0.02
黄     element gold    dmg+2  magnet+0.20
純     element steel   dmg+2  armor+1
木     element nature  dmg+3  poison+1  regen+0.5
松     element nature  dmg+3  armor+1  poison+1
桜     element nature  dmg+2  count+2  poison+1
稲     element nature  dmg+2  regen+0.5  poison+1
葛     element nature  dmg+2  poison+2
薇     element nature  dmg+1  poison+1
薔     element nature  dmg+2  poison+2
檸     element nature  dmg+2  poison+1
檬     element nature  dmg+2  regen+0.4  poison+1
汚     element poison  dmg+1  poison+2
`;

const RAW_EXT_PHENOM = `
凪     phenom  -  speed+40  armor+1
暈     phenom  -  area+10  crit+0.04
朧     phenom  -  homing+0.20  crit+0.03
晴     phenom  -  dmg+2  pierce+1
星     phenom  -  count+2  crit+0.04
昼     phenom  -  dmg+2  speed+10
朝     phenom  -  dmg+2  speed+15
月     phenom  -  dmg+3  crit+0.03
夕     phenom  -  dmg+2  crit+0.02
秋     phenom  -  regen+0.4  poison+1
激     phenom  -  dmg+4  area+10  knock+40
`;

const RAW_EXT_FORM = `
井     form  -  dmg+3  pierce+2
孔     form  -  dmg+3  pierce+3
器     form  -  dmg+4  count+1
園     form  -  dmg+2  area+10
壷     form  -  dmg+5  area+10
宮     form  -  dmg+3  armor+2
宿     form  -  dmg+2  regen+0.5
尾     form  -  dmg+3  speed+20
巣     form  -  dmg+2  count+2
幕     form  -  dmg+2  area+10  shield+10
庭     form  -  dmg+2  area+10
廬     form  -  dmg+2  armor+2
房     form  -  dmg+2  area+8
手     form  -  dmg+4  rate+0.3
指     form  -  dmg+2  crit+0.03  pierce+1
掌     form  -  dmg+3  knock+35
斗     form  -  dmg+4  size+0.20
朶     form  -  dmg+2  count+2
杆     form  -  dmg+3  range+30
束     form  -  dmg+3  count+2
棺     form  -  dmg+5  lifesteal+0.03
殿     form  -  dmg+3  armor+3
牛     form  -  dmg+7  knock+40
犀     form  -  dmg+6  pierce+4
犬     form  -  dmg+4  speed+30
狼     form  -  dmg+6  crit+0.05
獅     form  -  dmg+7  knock+35
獣     form  -  dmg+6
虎     form  -  dmg+7  crit+0.05  knock+30
蚊     form  -  dmg+1  count+2  speed+30
蛇     form  -  dmg+4  poison+3
蝦     form  -  dmg+3  armor+2
螺     form  -  dmg+4  orbit+1
蟇     form  -  dmg+5  poison+2
袖     form  -  dmg+2  speed+20
裹     form  -  dmg+3  pierce+2
製     form  -  dmg+3  armor+1
褥     form  -  dmg+2  regen+0.5
象     form  -  dmg+7  knock+45
車     form  -  dmg+6  knock+30
釭     form  -  dmg+3  burn+2
鉾     form  -  dmg+9  pierce+4
鎌     form  -  dmg+6  arc+0.7  count+1
鎗     form  -  dmg+8  pierce+3
鎚     form  -  dmg+13  knock+40
鏡     form  -  dmg+4  reflect+0.6
門     form  -  dmg+4  armor+2  area+8
雀     form  -  dmg+2  speed+50  count+1
靫     form  -  dmg+3  count+2  speed+20
頤     form  -  dmg+2  armor+1
頭     form  -  dmg+4  crit+0.04
顔     form  -  dmg+3  armor+1
魚     form  -  dmg+3  speed+30  count+1
鱗     form  -  shield+14  armor+2
鳥     form  -  dmg+2  speed+50  count+1
鹿     form  -  dmg+4  speed+40
羽     form  -  dmg+2  speed+40  count+1
翼     form  -  dmg+3  speed+50
砲     form  -  dmg+8  explode+34  count+1
符     form  -  dmg+3  count+2  homing+0.15
箍     form  -  dmg+2  shield+14
箱     form  -  dmg+3  shield+14
籠     form  -  dmg+4  area+12
蓋     form  -  dmg+2  shield+16  armor+1
綱     form  -  dmg+4  area+10  knock+30
線     form  -  dmg+3  pierce+3  range+40
縄     form  -  dmg+4  area+8
脚     form  -  dmg+2  speed+35
種     form  -  dmg+2  count+2
`;

const RAW_EXT_MODIFIER = `
# ── 数 ──
一     modifier  -  dmg+1  count+1
二     modifier  -  count+2
三     modifier  -  count+3
四     modifier  -  dmg+2  count+1  area+4
五     modifier  -  area+6  count+1
六     modifier  -  count+2  area+4
七     modifier  -  crit+0.07
八     modifier  -  area+8
九     modifier  -  count+4
十     modifier  -  dmg+6
百     modifier  -  count+5  area+10
千     modifier  -  count+6  spread+0.20
万     modifier  -  dmg+10  area+20

# ── 抽象・情・意 ──
上     modifier  -  dmg+4
下     modifier  -  armor+2  dmg+2
不     modifier  -  dmg+3  pierce+3
世     modifier  -  area+12
中     modifier  -  crit+0.06
丸     modifier  -  size+0.20
乖     modifier  -  dmg+5  crit+0.05
乙     modifier  -  crit+0.05
人     modifier  -  count+1  dmg+2
代     modifier  -  count+1  dmg+2
伏     modifier  -  crit+0.08  homing+0.20
伽     modifier  -  regen+0.5
体     modifier  -  size+0.20  armor+1
侘     modifier  -  regen+0.6  armor+1
倣     modifier  -  dmg+3
倶     modifier  -  count+2
傀     modifier  -  count+2  homing+0.30
傷     modifier  -  dmg+5
僕     modifier  -  dmg+3  count+1
儡     modifier  -  count+2
元     modifier  -  dmg+4
兎     modifier  -  speed+60
全     modifier  -  dmg+2  area+10  count+1
共     modifier  -  count+2
兵     modifier  -  count+2
円     modifier  -  area+10  size+0.15
処     modifier  -  dmg+3  pierce+2
利     modifier  -  crit+0.05  pierce+2
助     modifier  -  regen+1.0  armor+1
勁     modifier  -  dmg+6  armor+2
勝     modifier  -  dmg+4  crit+0.04
北     modifier  -  armor+2  dmg+2
博     modifier  -  dmg+3  count+1
卦     modifier  -  homing+0.30
危     modifier  -  crit+0.12
厨     modifier  -  dmg+3
叉     modifier  -  count+2  pierce+2
双     modifier  -  count+2
叢     modifier  -  count+4
名     modifier  -  atkMul+0.05
和     modifier  -  armor+2  regen+0.5
唯     modifier  -  crit+0.04
嘘     modifier  -  crit+0.06
太     modifier  -  size+0.30  dmg+2
女     modifier  -  regen+0.8
如     modifier  -  count+1  speed+10
子     modifier  -  count+2
字     modifier  -  crit+0.05
安     modifier  -  armor+2  regen+0.4
宗     modifier  -  dmg+3
客     modifier  -  count+1  dmg+2
将     modifier  -  atkMul+0.06
常     modifier  -  dmg+2  armor+2
平     modifier  -  armor+2  speed+10
底     modifier  -  dmg+3
彌     modifier  -  dmg+4
徒     modifier  -  speed+30  count+1
御     modifier  -  armor+3
怒     modifier  -  dmg+6
怪     modifier  -  dmg+3  crit+0.05
情     modifier  -  regen+0.6  homing+0.10
想     modifier  -  homing+0.40
意     modifier  -  crit+0.06  rate+0.2
愛     modifier  -  regen+0.8  lifesteal+0.02
愧     modifier  -  regen+0.3
慈     modifier  -  regen+1.2
慚     modifier  -  dmg+2
憂     modifier  -  poison+2  dmg+2
憤     modifier  -  dmg+7
我     modifier  -  atkMul+0.08
戒     modifier  -  armor+3
文     modifier  -  atkMul+0.05  dmg+2
族     modifier  -  count+3
時     modifier  -  rate+0.4
景     modifier  -  area+10
有     modifier  -  dmg+2
服     modifier  -  armor+2
望     modifier  -  homing+0.30
本     modifier  -  dmg+4
格     modifier  -  dmg+2  crit+0.05
極     modifier  -  dmg+7  crit+0.06
楽     modifier  -  speed+20  regen+0.5
模     modifier  -  count+1
横     modifier  -  dmg+3  arc+0.6
機     modifier  -  rate+0.5  count+1
母     modifier  -  regen+1.0
法     modifier  -  dmg+3  pierce+1
満     modifier  -  dmg+4  area+8
為     modifier  -  dmg+2
爺     modifier  -  armor+3
物     modifier  -  count+1  dmg+2
狂     modifier  -  dmg+6  crit+0.04
独     modifier  -  dmg+3
王     modifier  -  dmg+3  atkMul+0.08
理     modifier  -  pierce+3
界     modifier  -  area+14
異     modifier  -  crit+0.08
疵     modifier  -  dmg+4
痛     modifier  -  dmg+5
相     modifier  -  dmg+3
空     modifier  -  pierce+3  speed+20
童     modifier  -  count+1  crit+0.03
約     modifier  -  dmg+2
紋     modifier  -  dmg+2  crit+0.03
細     modifier  -  speed+30  crit+0.02
罪     modifier  -  dmg+5
翳     modifier  -  crit+0.05  homing+0.15
者     modifier  -  count+2
耶     modifier  -  crit+0.03
胎     modifier  -  count+2
胞     modifier  -  count+2
腸     modifier  -  regen+0.6
自     modifier  -  atkMul+0.06
般     modifier  -  count+1  area+6
色     modifier  -  crit+0.04
若     modifier  -  speed+20
苦     modifier  -  poison+2  dmg+2
莫     modifier  -  dmg+4
蔵     modifier  -  regen+0.5
薄     modifier  -  dmg+2  speed+20
蘊     modifier  -  dmg+4
術     modifier  -  count+1  dmg+2
裏     modifier  -  crit+0.06  dmg+3
証     modifier  -  dmg+3
賊     modifier  -  dmg+4
贋     modifier  -  dmg+3
超     modifier  -  dmg+6  speed+30
身     modifier  -  speed+20  armor+1
軍     modifier  -  count+3
逆     modifier  -  dmg+5
遍     modifier  -  count+1
道     modifier  -  dmg+3
邪     modifier  -  dmg+4  poison+1
釈     modifier  -  dmg+3
野     modifier  -  area+12
量     modifier  -  count+2
間     modifier  -  range+35
阿     modifier  -  dmg+3
限     modifier  -  range+20
離     modifier  -  range+30
面     modifier  -  armor+2  area+6
音     modifier  -  chain+3
韻     modifier  -  chain+4
頓     modifier  -  dmg+4
`;

const RAW_EXT_VERB = `
分     verb  -  count+2  split+2
切     verb  -  dmg+5  arc+0.6
刳     verb  -  dmg+4  pierce+6
動     verb  -  speed+50
化     verb  -  dmg+2  count+1
吟     verb  -  dmg+3  chain+2
吹     verb  -  dmg+2  knock+40
呈     verb  -  dmg+2  area+4
哭     verb  -  dmg+3
啜     verb  -  regen+0.6  lifesteal+0.02
在     verb  -  armor+2
坐     verb  -  dmg+3  size+0.20
垂     verb  -  dmg+2  area+8
壊     verb  -  dmg+6  explode+20
変     verb  -  dmg+3  count+1
失     verb  -  dmg+4
奏     verb  -  dmg+4  chain+3
奔     verb  -  speed+70
封     verb  -  dmg+3  slowImmune+1
尽     verb  -  dmg+4
崩     verb  -  dmg+5  explode+18  knock+40
嵌     verb  -  dmg+3  pierce+3
干     verb  -  dmg+3
廻     verb  -  dmg+3  orbit+1
弁     verb  -  dmg+2  pierce+2
従     verb  -  homing+0.30
成     verb  -  dmg+3
戯     verb  -  dmg+3  count+1
拘     verb  -  dmg+3
捕     verb  -  dmg+3  slowImmune+1
揺     verb  -  dmg+3  area+6
損     verb  -  dmg+3
操     verb  -  dmg+3  orbit+1
攻     verb  -  dmg+4  rate+0.2
放     verb  -  dmg+3  speed+50
敗     verb  -  dmg+2
斂     verb  -  dmg+3  magnet+0.30
断     verb  -  dmg+6  arc+0.5
来     verb  -  speed+40
枯     verb  -  dmg+2  poison+2
歌     verb  -  dmg+3  chain+2
歩     verb  -  speed+55
残     verb  -  dmg+3
毀     verb  -  dmg+5  explode+16
消     verb  -  dmg+4
游     verb  -  speed+45  homing+0.20
犯     verb  -  dmg+4
猟     verb  -  dmg+4  crit+0.03
生     verb  -  regen+0.8
盗     verb  -  dmg+3  magnet+0.30
知     verb  -  crit+0.06
移     verb  -  speed+30
繚     verb  -  orbit+1
聚     verb  -  count+3
脱     verb  -  speed+30
落     verb  -  dmg+4  knock+30
蕩     verb  -  dmg+3  area+10
衝     verb  -  dmg+6  pierce+3
見     verb  -  crit+0.05
誅     verb  -  dmg+7  crit+0.05
賜     verb  -  dmg+2  atkMul+0.04
走     verb  -  speed+60
躇     verb  -  dmg+2
躊     verb  -  dmg+2
躍     verb  -  speed+45
転     verb  -  orbit+1
追     verb  -  homing+0.40
逐     verb  -  speed+40
造     verb  -  dmg+3
遁     verb  -  speed+50
遊     verb  -  speed+40
遡     verb  -  speed+30
避     verb  -  speed+35
酌     verb  -  regen+0.6
閉     verb  -  dmg+3
開     verb  -  dmg+3  count+2
闘     verb  -  dmg+6  rate+0.2
闢     verb  -  dmg+4
飛     verb  -  speed+60  homing+0.20
鳴     verb  -  dmg+3  chain+2
`;

// 接続詞 (送り仮名) は words.connect.js が語ごとのプールから作る。
// 辞書にも words.js がそこから登録するので、ここには並べない。

export const RAW_TABLES = [
  RAW_ELEMENT, RAW_FORM, RAW_MODIFIER, RAW_VERB, RAW_CORE,
  RAW_EXT_ELEMENT, RAW_EXT_PHENOM, RAW_EXT_FORM, RAW_EXT_MODIFIER, RAW_EXT_VERB,
];
