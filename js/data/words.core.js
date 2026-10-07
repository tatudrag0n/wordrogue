// ============================================================================
// ワードローグ — 語テーブル (属性)
// フォーマット: 語  種別  属性  効果(半角スペース区切り)
//   種別: element / form / modifier / buff / grammar / core
//   属性: element のときだけ必須。それ以外は -
//   効果: key+数値 の並び。buff は player のステータス。
//
// 語は「すべて 1 文字の漢字」。語を並べるだけで日本語の文になるので、
// 部品だけの 2 文字の語は置かない。効果語も動詞も属性語も全部 1 文字。
// 例 「炎」「を」「斬」「された」「妙」「な」「刃」 -> 炎を斬された妙な刃
// 接続詞 (された・われた・かな…) だけがひらがな。
//
// 「静かな刃」「確かな刃」「滑らかな刃」は語を 2 つに割って置かず、
// 1 漢字語 + 接続詞 かな で作る。静かな刃 / 確かな刃 / 滑かな刃。
// なので辞書には漢字だけが残り、かな混じりの語も入らない。
// ============================================================================

/** 属性定義。色と纏わる状態異常の紐付け。 */
export const ELEMENTS = {
  none:    { name: '無属性', color: '#dfe8f2', glow: 'rgba(223,232,242,.55)', status: null },
  fire:    { name: '火',     color: '#ff7a2f', glow: 'rgba(255,122,47,.60)',  status: 'burn' },
  ice:     { name: '氷',     color: '#7ad7ff', glow: 'rgba(122,215,255,.60)', status: 'chill' },
  thunder: { name: '雷',     color: '#ffe14d', glow: 'rgba(255,225,77,.60)',  status: 'shock' },
  poison:  { name: '毒',     color: '#9dff5c', glow: 'rgba(157,255,92,.60)',  status: 'poison' },
  light:   { name: '光',     color: '#fff3b0', glow: 'rgba(255,243,176,.60)', status: 'none' },
  dark:    { name: '闇',     color: '#b47bff', glow: 'rgba(180,123,255,.60)', status: 'none' },
  earth:   { name: '土',     color: '#d4a373', glow: 'rgba(212,163,115,.60)', status: 'none' },
  wind:    { name: '風',     color: '#a8f0e0', glow: 'rgba(168,240,224,.60)', status: 'none' },
  nature:  { name: '草',     color: '#7dff9b', glow: 'rgba(125,255,155,.60)', status: 'poison' },
  steel:   { name: '鉄',     color: '#cfe3ef', glow: 'rgba(207,227,239,.60)', status: 'none' },
  blood:   { name: '血',     color: '#ff4d6d', glow: 'rgba(255,77,109,.60)',  status: 'none' },
  water:   { name: '水',     color: '#5fb8ff', glow: 'rgba(95,184,255,.60)',  status: 'chill' },
  gold:    { name: '金',     color: '#ffd23f', glow: 'rgba(255,210,63,.60)',  status: 'none' },
};

/** 語の種類。UI 表示と抽選重みに使う。 */
export const CATEGORIES = {
  element:  { name: '属性', color: '#ffb347', weight: 30 },
  form:     { name: '形態', color: '#7ad7ff', weight: 26 },
  modifier: { name: '効果', color: '#9dff5c', weight: 24 },
  verb:     { name: '動詞', color: '#ff8fab', weight: 18 },
  buff:     { name: '自身', color: '#b47bff', weight: 12 },
  connect:  { name: '接続', color: '#8ab4ff', weight: 18 },
};

/**
 * 品詞: い形容詞の語幹。
 *
 * 接続詞が付くのは く・い。「〜い / 〜く」になるものだけを置く。
 *   鋭 + い = 鋭い   鋭 + く = 鋭く   強 + く = 強く
 * 「静か」のように「〜い / 〜く」にならないものは入れない。
 * そちらは NA_ADJ_STEMS (な形容詞) に置く。
 */
export const ADJ_STEMS = new Set([
  // 形が明らかにい形容詞のもの
  '強', '高', '深', '遠', '広', '重', '硬', '柔', '鋭', '明', '早', '遅',
  '近', '長', '短', '多', '少', '速', '大', '熱', '小',
  // 色。青い、白い、黒い、赤い、暗い。
  '青', '白', '黒', '赤', '暗',
  // 味・手ざわり・心当たり。はすべて「〜い / 〜く」。
  '淡', '濃', '甘', '渋', '寂', '眠', '香', '良', '悪', '荒', '寒',
  // 手ざわり。温つい・冷たい・厚い・重つい。
  '温', '厚', '軽', '鈍', '冷',
  // 効果語に書かれていても、文法上はい形容詞の語幹。
  //   通 + い = とおい / 通 + く = とおく
  //   急 + い = 急い (はやか-い) / 急 + く = 急く (きゅうく・はやく)
  '通', '急',
]);

/**
 * 品詞: な形容詞の語幹。
 *
 * 「〜な / 〜に / 〜だ」になるもの。接続詞は な が付く。
 * い形容詞に「な」は付かない。「強いな」は無い。日本語の区別。
 * な形容詞の連体形は「〜な」なので、末尾語を修飾できる。
 *   妙な刃 ✓ / 急な刃 ✓
 *
 * 1 漢字で「〜な」が直接付く語だけを置く。
 *   妙 + な = 妙な刃 ✓   急 + な = 急な刃 ✓
 * 2 漢字のな形容詞（滑らか 適切 確実…）は辞書に置かない。
 *   「〜か」の形になるものは接続詞 かな で作る (滑 かな 滑かな刃)。
 *   それ以外は 1 漢字語 + かな でも書けないので置かない。
 * 1 漢字語どうしの連結 (華麗・精密・端正…) も置かない。
 *   語 1 個 1 語なので `華` と `麗` と同じ扱いで増やすと、
 *   `華麗` の連結が分割で `華` `麗` になって効果が変わる。
 *
 * 「1 漢字語 + か」で な形容詞になるものは、接続詞 かな で作る。
 *   静 + かな = 静かな刃 ✓   確 + かな = 確かな刃 ✓   滑 + かな = 滑かな刃 ✓
 *   「静か」「確か」「滑らか」を 2 語の辞書項目には置かない。
 *   かなは接続詞側 (かな) で足すので、辞書には漢字だけが残る。
 *
 * ここに置いてはいけないのは「X + な が日本語に無い語」。
 *   静な ✗ (静かは な形容詞だが「静か」二字。1 字の「静」からは「静な」が無い)
 *   巨な ✗ (な形容詞は「巨大」。要 大)
 *   剛な ✗ (接尾語。「剛刃」「剛硬」)
 *   豪な ✗ (豪快) / 精な ✗ (精密) / 密な ✗ / 滑な ✗ (滑らか) / 適な ✗ (適切)
 * それらは体言（名詞）として扱うので、接続詞は の・を・に・へ になる。
 *   静の刃 ✓ / 剛の刃 ✓ / 巨大刃 ✓ (巨 + 大 + 刃)
 *   (静かな刃・確かな刃・滑らかな刃は、接続詞 かな で作る)
 *
 * い形容詞と な形容詞 で接続詞が違う。
 *   い形容 … く・い       強い 強く
 *   な形容 … な           妙だ。妙な / 急だ。急な
 * 「強いな」「急い」みたいな混ざり方は作るが、「急な」は作る（実際の語だから）。
 */
export const NA_ADJ_STEMS = new Set([
  // 1 漢字で「〜な」が直接付く。
  '妙',
  // 「い形容の語幹だが な形容にも使う」語。
  //   急 + な = 急な刃 / 急 + に = 急に
  // 両方の語幹表に入れても矛盾しない。「急く」「急いて」「急な」。
  '急',
  // 2 漢字のな形容詞 (滑らか 適切 確実 緻密 妖艶…) はここに置かない。
  //   語幹が「〜か」になるものは 接続詞 かな で作る (滑 + かな = 滑かな刃)。
  // 「1 漢字語どうしを連結した語」(華麗 精密 端正 頑強 神速…) も置かない。
  //   `華` `麗` の連結が分割で `華麗` になり、品詞と効果が替わる。
]);

/**
 * 付言便乗「〜つい」に取れる語。
 *
 * 連用形に「つ」を足して形容詞を作る便乗。「つい」と読んで通る語だけ。
 *   温 + つ = 温つい   冷 + つ = 冷つい   厚 + つ = 厚つい   重 + つ = 重つい
 *   泡 + つ = 泡立つ → 泡つい
 * 他のい形容詞に「つ」を付けると「強つい」のような言葉にならない。
 */
export const TSUMI_STEMS = new Set(['温', '冷', '厚', '泡', '重']);

/**
 * 名詞 + する の語。
 *
 * 動詞の表に入れてあるが、文法上は体言として扱う。
 * 「爆」は動詞ではなく「爆する」の名詞の方。
 *   爆 + する = 爆する ✓
 *   爆 + された = 爆された ✗ (動詞じゃない)
 *
 * 属性語との重複も許す。「感電」「凍る」は属性としてもっているが、
 * 日本語に「〜する」が通用するのでする-体言としても扱う。
 *
 * 「重」はここに入れてはいけない。「重する」は無い。
 * 重い・重く・重ついなので、い形容詞の語幹 (ADJ_STEMS) に入れる。
 */
export const SURU_STEMS = new Set([
  '爆', '轟', '破', '膨', '侵', '蝕', '感', '催', '断', '裂', '貫', '改',
  '合', '衰', '蒸', '再', '生', '続', '発', '覆', '転', '減', '食',
  '縛', '退', '追', '避',
  // 効果語に書かれているが「〜する」が通用する名詞。全部 サ変。
  //   圧 + する = 圧する   律 + する = 律する   執 + する = 執する
  //   導 + する = 導する   反 + する = 反する   徹 + する = 徹する
  '圧', '律', '執', '導', '反', '徹',
]);

/**
 * 品詞: 動詞。効果語に書かれていても、文法上は用言。
 *
 * 効果語表中だけでは名詞に見えるが、そのまま動詞の語幹になる語。
 *   回 + る = 回る / 回 + り = 回り / 回 + せし = 回す / 回 + された = 回された
 *
 * 名詞のままでいると「の・を・に・へ・する」しか付かないので、
 * 本来の語形に合わせて動詞に寄せる。
 */
export const VERB_STEMS = new Set(['回']);

/**
 * 末尾語を直接修飾できない語。
 *
 * 日本語に「刃剣」「弾銃」「矢弓」は無い。末尾語が既に形を表すので、
 * その直前に別の形を表す語を置くと名詞の叠字になる。
 * 効果としての「貫通」「散弾」は末尾語を普通に修飾できるので、
 * 対象は「物としての形」だけの語に限っている。
 */
export const TAIL_UNMODIFIABLE = new Set([
  '刃', '剣', '刀', '斧', '槍', '矛', '戈', '牙', '爪',
  '弾', '銃', '玉', '矢', '針', '弓', '球', '珠', '光', '雷',
  '塊', '岩', '石', '環', '輪', '鞭', '鎖', '壁', '網', '盾',
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

氷     element ice     dmg+2  chill+0.10
雪     element ice     dmg+2  chill+0.12  count+1
霜     element ice     dmg+3  chill+0.18  area+6
冬     element ice     dmg+4  chill+0.24  speed-10

電     element thunder dmg+3  shock+0.14
震     element thunder dmg+4  shock+0.22  area+8
磁     element thunder dmg+5  shock+0.18  magnet+0.35

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
陽     element light   dmg+2  regen+0.5  area+6
霞     element light   dmg+1  pierce+1
皓     element light   dmg+1  crit+0.03  speed+10
青     element light   dmg+2  crit+0.02  speed+8
白     element light   dmg+1  speed+8  pierce+1
赤     element blood   dmg+3  burn+1

闇     element dark    dmg+3  crit+0.02
暗     element dark    dmg+2  crit+0.04  homing+0.10
黒     element dark    dmg+3  pierce+2  armor+1
夜     element dark    dmg+5  pierce+3  crit+0.04
死     element dark    dmg+3  lifesteal+0.03
魔     element dark    dmg+4  crit+0.07  lifesteal+0.03
影     element dark    dmg+1  crit+0.02  homing+0.10
漆     element dark    dmg+2  crit+0.03  homing+0.14

土     element earth   dmg+2  size+0.15  speed-10
砂     element earth   dmg+2  count+2  size-0.05
塵     element earth   dmg+1  count+2  size-0.05  speed-10
地     element earth   dmg+5  area+12  speed-25
陸     element earth   dmg+4  speed-20  size+0.25  knock+30
崖     element earth   dmg+4  explode+14  size+0.30  speed-15
原     element earth   dmg+3  knock+60  speed-20  area+8

風     element wind    dmg+1  speed+45  homing+0.08
嵐     element wind    dmg+3  area+14  speed+40  knock+40
突     element wind    dmg+3  pierce+5  speed+60
旋     element wind    dmg+4  area+18  rate+0.6  orbit+1
疾     element wind    dmg+2  speed+70  count+1
翔     element wind    dmg+2  homing+0.12  speed+50

草     element nature  dmg+1  poison+1.5  regen+0.3
樹     element nature  dmg+2  regen+1.2  area+6
苔     element nature  dmg+1  poison+1  chill+0.05
芽     element nature  dmg+1  regen+0.6  homing+0.08
緑     element nature  dmg+2  regen+0.6  speed-5
根     element nature  dmg+2  pierce+3  poison+1
花     element nature  dmg+1  regen+0.8  lifesteal+0.01

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
波     element water   dmg+3  knock+45  pierce+2
流     element water   dmg+2  chill+0.06  count+1
泡     element water   dmg+1  chill+0.08  count+2
淵     element dark    dmg+3  pierce+2
露     element water   dmg+1  regen+0.8  chill+0.04
潮     element water   dmg+2  knock+20
浪     element water   dmg+4  knock+70  area+14

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
槍     form  -  dmg+7  crit+0.04  speed+40
矛     form  -  dmg+13  pierce+5  crit+0.06  speed+30
戈     form  -  dmg+9  arc+0.8  size+0.25
牙     form  -  dmg+6  crit+0.03
爪     form  -  dmg+4  count+2  speed+20  arc+0.6

弾     form  -  dmg+6  count+1  explode+30
銃     form  -  dmg+7  count+1  speed+40
玉     form  -  dmg+4  count+2  spread+0.3
矢     form  -  dmg+5  speed+90  pierce+1
針     form  -  dmg+3  speed+130  count+2  pierce+1
弓     form  -  dmg+5  speed+110  pierce+1
球     form  -  dmg+6  area+6  size+0.15
珠     form  -  dmg+10  pierce+4  bounce+2  crit+0.06
還     form  -  dmg+11  pierce+5  bounce+3  speed+40
光     form  -  dmg+8  pierce+8  speed+60  size+0.20
雷     form  -  dmg+7  pierce+5  crit+0.06  speed+30

塊     form  -  dmg+8  speed-25  size+0.30  knock+25
岩     form  -  dmg+9  explode+20  size+0.35  area+12  speed-20
石     form  -  dmg+7  speed-20  size+0.25  knock+20

環     form  -  orbit+1  count+2  dmg+5
輪     form  -  orbit+1  dmg+7  size+0.15
鞭     form  -  dmg+7  area+12  range+40
鎖     form  -  dmg+6  area+14  bounce+3
壁     form  -  dmg+6  shield+18  area+10
網     form  -  dmg+5  area+14  slowImmune+1
盾     form  -  dmg+4  shield+22  armor+2
`;

// ─────────────────────────────────────────────────────────────────────────────
// 効果語: 修飾
//
// 品詞で接続詞が決まる。
//   い形容詞 … く・いが付く。
//   な形容詞 … なが付く。
//   名詞・動詞 … 名詞なら の・を・に・へ、動詞なら る・された・われた・られた・せし・り。
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
遅    modifier  -  rate-0.20
高    modifier  -  crit+0.05
深    modifier  -  dmg+3  pierce+1
遠    modifier  -  range+30
近    modifier  -  range-20
長    modifier  -  range+25
短    modifier  -  range-15
大    modifier  -  size+0.35  area+12
多    modifier  -  count+2  spread+0.18
少    modifier  -  count-1
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
衰    modifier  -  dmg-2  area+8
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
優    modifier  -  regen+0.4  speed+5
護    modifier  -  shield+16  regen+0.3
結    modifier  -  dmg+4  chill+0.15
穿    modifier  -  dmg+5  pierce+6
通    modifier  -  dmg+4  pierce+4
`;

// ─────────────────────────────────────────────────────────────────────────────
// 自身強化語: 語彙に置いてある間、プレイヤーに常時効く
// ─────────────────────────────────────────────────────────────────────────────
const RAW_BUFF = `
人       buff  -  atk+0.03  spd+0.02
頑    buff  -  hp+25  armor+1
健    buff  -  hp+20  regen+0.3
躯    buff  -  size+0.15  hp+10
柄    buff  -  size-0.12  spd+0.06  atk-0.02
走    buff  -  spd+0.12
鎧    buff  -  armor+1  hp+8
甲    buff  -  armor+2  shield+20
王    buff  -  atk+0.16  hp+12  luck+0.06
戒    buff  -  atk+0.09  crit+0.05
符    buff  -  hp+15  regen+0.4
薬    buff  -  regen+0.5  hp+6
癒    buff  -  regen+0.8
晶    buff  -  atk+0.12
書    buff  -  xp+0.15
察    buff  -  crit+0.08  atk+0.06
永    buff  -  hp+30  regen+0.6  armor+1
楽    buff  -  atk+0.07  crit+0.03
幸    buff  -  luck+0.12  magnet+0.2
`;

// ─────────────────────────────────────────────────────────────────────────────
// 核語: 武器に最初から埋め込まれ、語彙には出ない
// ただし語彙にも引ける。強い語なので。
// ─────────────────────────────────────────────────────────────────────────────
const RAW_CORE = `
志    modifier  -  dmg+3   rate+0.20
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
// 1 個の漢字にしておくと、接続詞で自然と文になる。
//   斬 + された = 斬された / 貫 + する = 貫する / 沸 + く = 沸く
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
渦      verb  -  dmg+5  orbit+2
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
嗅      verb  -  dmg+2  homing+0.35
舐      verb  -  dmg+3  lifesteal+0.03  count+1
跨      verb  -  dmg+4  speed+50  area+8
擦      verb  -  dmg+3  burn+2  pierce+1
潰      verb  -  dmg+6  area+14  knock+35
嚇      verb  -  dmg+3  slowImmune+1  chill+1
縛      verb  -  dmg+2  slowImmune+1  magnet+0.3
撫      verb  -  dmg+2  lifesteal+0.04  homing+0.2
`;

// ─────────────────────────────────────────────────────────────────────────────
// 接続詞: 直前の語に結合する。優先順位と結合先は words.connect.js が持つ。
// 効果の値はそちらの CONNECTORS を正とする。ここでは並びだけ決める。
// ─────────────────────────────────────────────────────────────────────────────
const RAW_CONNECT = `
された   connect  -  dmg+2
われた   connect  -  dmg+2  armor+0.02
られた   connect  -  dmg+2  rate+0.10
く       connect  -  dmg+3  crit+0.02
な       connect  -  dmg+2  area+4
かな     connect  -  dmg+2  area+4
する     connect  -  dmg+3  rate+0.15
む       connect  -  dmg+5  crit+0.02
ける     connect  -  dmg+4  pierce+1
せし     connect  -  dmg+3  rate+0.10
り       connect  -  dmg+2  spread+0.12
る       connect  -  dmg+3  rate+0.12
の       connect  -  dmg+1  size+0.05
い       connect  -  dmg+2  crit+0.01
つ       connect  -  dmg+2  rate+0.10
に       connect  -  dmg+1  homing+0.10
を       connect  -  dmg+2  knock+12
へ       connect  -  dmg+1  speed+22
`;

export const RAW_TABLES = [
  RAW_ELEMENT, RAW_FORM, RAW_MODIFIER, RAW_VERB, RAW_BUFF,
  RAW_CONNECT, RAW_CORE,
];