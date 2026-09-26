// ============================================================================
// ワードローグ — 語テーブル (属性)
// フォーマット: 語  種別  属性  効果(半角スペース区切り)
//   種別: element / form / modifier / buff / grammar / core
//   属性: element のときだけ必須。それ以外は -
//   効果: key+数値 の並び。buff は player のステータス。
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
  buff:     { name: '自身', color: '#b47bff', weight: 12 },
  grammar:  { name: '文語', color: '#c8b6ff', weight: 8 },
};

const RAW_ELEMENT = `
火     element fire    dmg+2  burn+1.5
炎     element fire    dmg+3  burn+1
熱     element fire    dmg+1  burn+1  area+4
灼熱   element fire    dmg+4  burn+3
爆     element fire    dmg+3  explode+12
火傷   element fire    dmg+1  burn+3.5
熔     element fire    dmg+3  burn+2  area+6
業火   element fire    dmg+5  burn+4  explode+14
氷     element ice     dmg+2  chill+0.10
氷結   element ice     dmg+3  chill+0.18
冷     element ice     dmg+1  chill+0.08
凍結   element ice     dmg+3  chill+0.24  area+6
雪     element ice     dmg+2  chill+0.12  count+1
凍     element ice     dmg+1  chill+0.16
雷     element thunder dmg+3  shock+0.12
電     element thunder dmg+2  shock+0.10
電撃   element thunder dmg+4  shock+0.20  chain+1
稲妻   element thunder dmg+3  shock+0.14  speed+40
雷鳴   element thunder dmg+4  shock+0.26  area+8
感電   element thunder dmg+2  shock+0.30
雷神   element thunder dmg+6  chain+3  shock+0.30
毒     element poison  dmg+1  poison+2
猛毒   element poison  dmg+3  poison+5
毒液   element poison  dmg+2  poison+3  area+4
腐     element poison  dmg+2  poison+2.5
毒霧   element poison  dmg+2  poison+3.5  area+10
百花   element poison  dmg+3  poison+5  count+3  area+8
光     element light   dmg+3  crit+0.03
聖     element light   dmg+3  pierce+1
神聖   element light   dmg+4  pierce+2  crit+0.04
輝     element light   dmg+2  area+6  crit+0.02
光線   element light   dmg+4  pierce+4  speed+60
神     element light   dmg+5  lifesteal+0.02
陽     element light   dmg+2  regen+0.5  area+6
闇     element dark    dmg+3  crit+0.05
暗     element dark    dmg+2  crit+0.04  homing+0.10
影     element dark    dmg+2  crit+0.03  homing+0.14
黒     element dark    dmg+3  pierce+2
闇黒   element dark    dmg+5  pierce+3  crit+0.04
死     element dark    dmg+3  lifesteal+0.03
黒魔   element dark    dmg+4  crit+0.07  lifesteal+0.03
土     element earth   dmg+2  size+0.15  speed-10
岩     element earth   dmg+4  speed-20  size+0.25  knock+30
石     element earth   dmg+3  speed-10  size+0.15
大地   element earth   dmg+5  area+12  speed-25
砂     element earth   dmg+2  count+2  size-0.05
重力   element earth   dmg+3  knock+60  speed-20  area+8
落石   element earth   dmg+6  explode+14  size+0.30  speed-15
風     element wind    dmg+1  speed+45  homing+0.08
疾風   element wind    dmg+2  speed+70  count+1
嵐     element wind    dmg+3  area+14  speed+40  knock+40
旋     element wind    dmg+2  speed+35
突破   element wind    dmg+3  pierce+5  speed+60
旋風   element wind    dmg+4  area+18  rate+0.6  orbit+1
草     element nature  dmg+1  poison+1.5  regen+0.3
花     element nature  dmg+1  regen+0.8  lifesteal+0.01
樹     element nature  dmg+2  regen+1.2  area+6
苔     element nature  dmg+1  poison+1  chill+0.05
棘     element nature  dmg+2  pierce+3  poison+1
根     element nature  dmg+2  regen+0.6  speed-5
鉄     element steel   dmg+3  speed+10  size+0.10
鋼     element steel   dmg+4  pierce+2  size+0.12
刃物   element steel   dmg+4  crit+0.05
鉄壁   element steel   dmg+1  shield+12  size+0.10
鋼鉄   element steel   dmg+5  pierce+3  armor+1
血     element blood   dmg+3  lifesteal+0.04
紅     element blood   dmg+2  lifesteal+0.03  speed+15
呪     element blood   dmg+3  poison+2  homing+0.10
瘴     element blood   dmg+2  poison+4  area+10
紅蓮   element blood   dmg+5  burn+5  lifesteal+0.05  area+12
水     element water   dmg+2  chill+0.06  count+1
海     element water   dmg+3  knock+35  area+10
波     element water   dmg+3  knock+45  pierce+2
泡     element water   dmg+1  chill+0.08  count+2
怒涛   element water   dmg+4  knock+70  area+14
金     element gold    dmg+2  magnet+0.25
宝     element gold    dmg+2  magnet+0.35  crit+0.02
財宝   element gold    dmg+3  magnet+0.60
黄金   element gold    dmg+4  magnet+0.50  atkMul+0.04
`;

// ─────────────────────────────────────────────────────────────────────────────
// 形態語: 何を一般に撃つかを決める核
// ─────────────────────────────────────────────────────────────────────────────
const RAW_FORM = `
弾       form  -  dmg+6  count+1
矢       form  -  dmg+5  speed+90  pierce+1
剣       form  -  dmg+8  size+0.20
刀       form  -  dmg+7  crit+0.04  speed+40
太刀     form  -  dmg+9  arc+0.5  size+0.30
大剣     form  -  dmg+11  speed-10  size+0.35  knock+30
針       form  -  dmg+3  speed+130  count+2  pierce+1
球       form  -  dmg+6  area+6  size+0.15
塊       form  -  dmg+8  speed-25  size+0.30  knock+25
刃       form  -  dmg+5  speed+60  pierce+2
爪       form  -  dmg+4  count+2  speed+25
牙       form  -  dmg+6  size+0.10  crit+0.03
環       form  -  orbit+1  count+2  dmg+5
回転     form  -  orbit+1  dmg+6  rate+0.3
回転刃   form  -  orbit+2  dmg+6  size+0.05
鞭       form  -  dmg+7  area+12  range+40
爆弾     form  -  dmg+10  explode+26  speed-20  size+0.30
複製     form  -  dmg+3  split+2  count+1
貫通     form  -  dmg+4  pierce+4  speed+30
反射     form  -  dmg+4  bounce+4  speed+40  pierce+2
殲滅     form  -  dmg+8  area+18  count+1
竜頭     form  -  dmg+7  pierce+5  crit+0.06  speed+30
彗星     form  -  dmg+9  explode+20  size+0.35  area+16  speed-20
夾撃     form  -  dmg+5  count+2  spread+0.9  speed+20
乱打     form  -  dmg+4  count+3  spread+0.7  rate+0.5
殲       form  -  dmg+9  pierce+3  knock+20
壁       form  -  dmg+6  shield+18  area+10
棘壁     form  -  dmg+5  area+14  slowImmune+1
`;

// ─────────────────────────────────────────────────────────────────────────────
// 効果語: 修飾
// ─────────────────────────────────────────────────────────────────────────────
const RAW_MODIFIER = `
巨大     modifier  -  size+0.40  area+10  speed-8
極大     modifier  -  size+0.80  area+22  speed-16  dmg+2
巨大化   modifier  -  size+0.50  dmg+5  area+12  speed-12
広       modifier  -  area+14  size+0.15
小的     modifier  -  size-0.35  speed+45  rate+0.4
迅       modifier  -  rate+0.6
疾       modifier  -  rate+0.4  speed+35
緩       modifier  -  rate-0.5  dmg+5  area+10
鋭       modifier  -  dmg+6  crit+0.05
鋭利     modifier  -  dmg+7  crit+0.06
強       modifier  -  dmg+8
激       modifier  -  dmg+12
破壊     modifier  -  dmg+10  area+8
執念     modifier  -  dmg+7  rate+0.2
多       modifier  -  count+2  spread+0.18
多数     modifier  -  count+4  spread+0.16
散弾     modifier  -  count+3  spread+0.42
分裂     modifier  -  split+3
貫       modifier  -  pierce+2
追尾     modifier  -  homing+0.35
導       modifier  -  homing+0.55  speed+20
誘導     modifier  -  homing+0.70  speed+15
爆発     modifier  -  explode+38  size+0.10
連鎖     modifier  -  chain+3
吸血     modifier  -  lifesteal+0.06
瞬殺     modifier  -  dmg+6  crit+0.12  critDmg+0.6
会心     modifier  -  crit+0.12  critDmg+0.4
必殺     modifier  -  crit+0.20  critDmg+0.8  dmg+3
急所     modifier  -  crit+0.15  critDmg+0.5
反動     modifier  -  recoil+60  dmg+6  size+0.20
撃退     modifier  -  knock+55
吹き     modifier  -  knock+40  area+8
硬化     modifier  -  shield+20  size+0.10
再生     modifier  -  regen+1.4
回復     modifier  -  regen+0.9
持続     modifier  -  duration+1.2  area+8
重装     modifier  -  dmg+3  speed-18  size+0.25
軽装     modifier  -  speed+45  size-0.15  rate+0.3
磁力     modifier  -  magnet+0.5
引力     modifier  -  magnet+0.9  size+0.05
絆       modifier  -  count+1  rate+0.2  dmg+3
加速     modifier  -  rate+0.8  speed+30
減速     modifier  -  chill+0.20
毒化     modifier  -  poison+4
蝕       modifier  -  poison+2  pierce+2
精神     modifier  -  crit+0.06  regen+0.5
特攻     modifier  -  atkMul+0.10  crit+0.05  pierce+2
白化     modifier  -  area+20  duration+0.8
心眼     modifier  -  crit+0.08  homing+0.25
韻律     modifier  -  rate+0.6  count+1  dmg+3
斉唱     modifier  -  count+3  dmg+4  rate+0.3
極小     modifier  -  size-0.5  rate+0.8  speed+40
重圧     modifier  -  knock+90  size+0.2  speed-10
瞬発     modifier  -  rate+1.4  dmg-3
秘匿     modifier  -  crit+0.10  homing+0.3  speed+10
`;

// ─────────────────────────────────────────────────────────────────────────────
// 自身強化語: 語袋に置いてある間、プレイヤーに常時効く
// ─────────────────────────────────────────────────────────────────────────────
const RAW_BUFF = `
頑       buff  -  hp+12
頑強     buff  -  hp+25  armor+1
健       buff  -  hp+20  regen+0.3
巨躯     buff  -  size+0.15  hp+10
小柄     buff  -  size-0.12  spd+0.06  atk-0.02
疾走     buff  -  spd+0.12
韋駄天   buff  -  spd+0.18  atk+0.06
鎧       buff  -  armor+1  hp+8
堅       buff  -  armor+1  hp+12
盾       buff  -  armor+2  shield+20
冠       buff  -  atk+0.10  crit+0.04
王冠     buff  -  atk+0.16  hp+12  luck+0.06
宝玉     buff  -  atk+0.14  spd+0.06
指輪     buff  -  atk+0.09  crit+0.05
護符     buff  -  hp+15  regen+0.4
薬       buff  -  regen+0.5  hp+6
癒       buff  -  regen+0.8
砂金     buff  -  luck+0.12  magnet+0.2
賢者     buff  -  atk+0.10  xp+0.10
水晶     buff  -  atk+0.12
古書     buff  -  xp+0.15
洞察     buff  -  crit+0.08  atk+0.06
不死     buff  -  hp+30  regen+0.6  armor+1
磁石     buff  -  magnet+0.6
成長     buff  -  xp+0.20  atk+0.05
韻人     buff  -  atk+0.07  crit+0.03
御       buff  -  armor+1  hp+10  shield+12
`;

// ─────────────────────────────────────────────────────────────────────────────
// 文語: 助詞・接続詞。文をつなぐ役目と小さなボーナス。
// 「火の弾」「雷の矢」のような文を作れる 要。
// ただし助詞だけの羅列は文として成立しない (実質語が 2 つ以上必要)。
// ─────────────────────────────────────────────────────────────────────────────
const RAW_GRAMMAR = `
の       grammar  -  dmg+1
は       grammar  -  dmg+1
が       grammar  -  dmg+1
を       grammar  -  dmg+1
に       grammar  -  dmg+1
で       grammar  -  dmg+1
と       grammar  -  dmg+1
も       grammar  -  dmg+1
や       grammar  -  dmg+1
へ       grammar  -  dmg+1
、       grammar  -  dmg+1
。       grammar  -  dmg+1
から     grammar  -  dmg+1  speed+12
まで     grammar  -  dmg+1  pierce+1
ほど     grammar  -  dmg+1  rate+0.15
だけ     grammar  -  dmg+1  area+4
ずつ     grammar  -  dmg+1  size+0.05
より     grammar  -  dmg+1  crit+0.02
こそ     grammar  -  dmg+2  crit+0.02
さえ     grammar  -  dmg+1  shield+6
ながら   grammar  -  dmg+1  duration+0.4
ばかり   grammar  -  dmg+1  regen+0.3
など     grammar  -  dmg+1  magnet+0.2
さらに   grammar  -  dmg+2  atkMul+0.03
まだ     grammar  -  dmg+1  rate+0.10
すぐ     grammar  -  dmg+1  rate+0.20
よく     grammar  -  dmg+1  crit+0.02
とても   grammar  -  dmg+2  pierce+1
かなり   grammar  -  dmg+2  size+0.10
ずっと   grammar  -  dmg+1  duration+0.6
ちょっと grammar  -  dmg+1  size-0.10  rate+0.30
り        grammar  -  dmg+1
れ        grammar  -  dmg+1
て        grammar  -  dmg+1
よ        grammar  -  dmg+1
な        grammar  -  dmg+1
`;

// ─────────────────────────────────────────────────────────────────────────────
// 核語: 武器に最初から埋め込まれ、語袋には出ない
// ただし語袋にも引ける。強い語なので。
// ─────────────────────────────────────────────────────────────────────────────
const RAW_CORE = `
心   modifier  -  dmg+3   rate+0.20
力   modifier  -  dmg+6
技   modifier  -  crit+0.08  dmg+2
守   modifier  -  shield+20  regen+0.4
感   modifier  -  area+10  size+0.15
縛   modifier  -  slowImmune+1  magnet+0.4
智   modifier  -  xpMul+0.20  atkMul+0.05
`;

// ─────────────────────────────────────────────────────────────────────────────
// 構成語: 熟語 (火事場の馬鹿力 とか) を作るために必要な部品。
// 単独でも効果を持つので語袋から引ける。
// ─────────────────────────────────────────────────────────────────────────────
const RAW_EXTRA = `
一     modifier  -  count+1  dmg+1
二     modifier  -  count+1  dmg+2
十     modifier  -  count+3
百     modifier  -  count+5
千     modifier  -  count+7  spread+0.2
万     modifier  -  count+9  spread+0.3
人     modifier  -  count+1  dmg-1
鳥     modifier  -  speed+40  count+1
馬     modifier  -  speed+60
虎     modifier  -  crit+0.08  dmg+6
穴     modifier  -  pierce+2
入     modifier  -  homing+0.30
子     modifier  -  split+2
卵     modifier  -  pierce+4  dmg-2
撃     modifier  -  dmg+7  rate+0.3
打     modifier  -  dmg+4  knock+25
尽     modifier  -  burn+3  poison+3
網     modifier  -  area+18  chill+0.15
玉     modifier  -  area+8  size+0.10
烈     modifier  -  burn+5  dmg+3
河     modifier  -  area+16  knock+30
極     modifier  -  crit+0.06  dmg+5
寒     modifier  -  chill+0.20
獄     modifier  -  area+16  dmg+6
絶     modifier  -  pierce+6
対     modifier  -  pierce+3
零     modifier  -  crit+0.08  dmg+2
度     modifier  -  rate+0.5
怒     modifier  -  dmg+8  rate+0.4
繚     modifier  -  split+3  spread+0.3
乱     modifier  -  split+4  spread+0.4
霧     modifier  -  area+20  chill+0.10
以     modifier  -  pierce+2
攻     modifier  -  dmg+7
沼     modifier  -  poison+5  area+14
角     modifier  -  pierce+4  knock+30
秘     modifier  -  crit+0.12  homing+0.30
孔     modifier  -  crit+0.15  critDmg+0.5
速     modifier  -  rate+0.5  speed+25
閃     modifier  -  crit+0.10  speed+70
免     modifier  -  shield+20  crit+0.05
台     modifier  -  count+2  dmg+2
大     modifier  -  size+0.35  area+12
地     modifier  -  area+18  knock+40
城     modifier  -  size+0.20  area+14  shield+10
龍     modifier  -  pierce+6  dmg+8  crit+0.06
巻     modifier  -  homing+0.40  area+10
事     modifier  -  rate+0.4
場     modifier  -  area+20
鹿     modifier  -  rate+0.3  speed+20
中     modifier  -  pierce+3
送     modifier  -  speed+45
炭     modifier  -  burn+4
流     modifier  -  speed+55  homing+0.25
星     modifier  -  count+2  crit+0.05
無     modifier  -  dmg+5  atkMul+0.06
双     modifier  -  count+3
蒼     modifier  -  chill+0.12  area+10
穹     modifier  -  area+22  pierce+3
灼     modifier  -  burn+5
蓬     modifier  -  regen+1.2
莱     modifier  -  regen+0.8  lifesteal+0.02
救     modifier  -  regen+1.5
済     modifier  -  shield+15  regen+0.6
袈     modifier  -  area+16
裟     modifier  -  area+16
羅     modifier  -  pierce+3  knock+30
盤     modifier  -  area+14  duration+0.8
彗     modifier  -  explode+20
尾     modifier  -  homing+0.35
静     modifier  -  chill+0.25
寂     modifier  -  freeze+0.30
咆     modifier  -  knock+70  area+12
哮     modifier  -  dmg+6  shock+0.15
黄     modifier  -  magnet+0.30  dmg+3
律     modifier  -  rate+0.7  dmg+3
豊     modifier  -  xpMul+0.25  count+1
饒     modifier  -  xpMul+0.30  area+12
化     modifier  -  split+2
拳     modifier  -  dmg+9  rate+0.2
軍     modifier  -  count+4  spread+0.25
色     modifier  -  count+3  atkMul+0.04
`;

export const RAW_TABLES = [
  RAW_ELEMENT, RAW_FORM, RAW_MODIFIER, RAW_BUFF, RAW_GRAMMAR, RAW_CORE, RAW_EXTRA,
];
