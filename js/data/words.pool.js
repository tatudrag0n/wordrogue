// ============================================================================
// ワードローグ — 語ごとの接続詞プール (送り仮名・接続詞)
//
// 接続詞は「品詞の規則 + 例外表」ではなく、**語ごとに持つ**。
// 語が持っている形 (送り仮名) だけが、その語の直後に付く。
//   斬 … る / られた / り          → 斬る 斬られた 斬り   (斬された ✗)
//   凍 … る / える                 → 凍る 凍える          (凍ける ✗)
//   滑 … らかな / らかに / る      → 滑らかな 滑らかに 滑る (滑かな ✗)
//   妙 … な / に                   → 妙な 妙に
//   速 … い / く                   → 速い 速く
// 名詞は共通の NOUN_POOL (の・を・に・へ) を持つ。この表に無い語は全部これ。
//
// 書式:  語  品詞  形…
//   品詞 … n (体言) / a (い形容) / na (な形容) / v (用言)。自然さの採点に使う。
//   形   … 送り仮名:役割[印]
//     adn        連体。あとに名詞 (か形容) が来てよい。
//     adv        連用。あとは動詞・形容だけ。名詞は修飾しない。
//     case>noun  格「の」。あとは名詞句。
//     case>verb  格「を」。あとに動作 (動詞・する) が要る。
//     case>pred  格「に」「へ」。あとに動作か形容が要る。
//     印 * … 述語 (動詞の形)。「〜を」の受け先になり、述語として加点。
//     印 + … 形容の形。連体加点の対象。
//     印 x … 自動詞。この形は「〜を」の受け先になれない (焔を燃える ✗)。
//   +N … NOUN_POOL (の・を・に・へ) をまとめて足す。
//
// 送り仮名は 1〜4 字 (最長「かされた」「められた」など他動詞の受身)。辞書の最長 5 字・
// 文の 10 字の上限には収まる。かなの並びは必ず 1 つの送り仮名なので、
// 分割 (最少語数の DP) で割れ方が揺れることは無い。
//
// 熟語の接続詞プール:
//   熟語 (words.phrase.js の pool) も自分の送り仮名を持てる。
//     発電 … する:adn*  → 発 + 電 + する = 発電する
//   直前の語列が熟語になっているときだけ、その熟語の形が付く
//   (COMPOUND_POOLS / compoundPoolOf)。「電する」は作れない。
// ============================================================================

import { PHRASE_BONUS } from './words.phrase.js';
import { compoundFormSpec } from './words.compound-forms.js?v=1.49';

/**
 * 名詞が共通で持つ格の接続詞。
 *
 * 名詞は動詞や形容と違って形を持たないので、格で文をつなぐ。
 *   の・と・も・や … 名詞を受ける (炎の剣 / 炎と剣 / 炎も剣 / 炎や剣)
 *   を           … 他動詞を受ける (炎を斬る)
 *   に・へ・で・から・まで・より … 動作か形容を受ける (炎に走る / 炎で斬る)
 *   が・は       … 主体 (炎が燃える / 炎は燃える)
 * 4 つだけだったころは「炎と剣」のような並列や「炎で斬る」のような手段が作れず、
 * 語の組み合わせによっては文にできなかった。
 */
export const NOUN_POOL_SPEC = [
  'の:case>noun', 'と:case>noun', 'も:case>noun', 'や:case>noun',
  'を:case>verb',
  'に:case>pred', 'へ:case>pred', 'で:case>pred', 'から:case>pred',
  'まで:case>pred', 'より:case>pred', 'が:case>pred', 'は:case>pred',
].join(' ');

const RAW_POOL = `
# ── 属性 (既定は体言 +N。形を持つ語だけ書く) ──
熱  a   い:adn+ く:adv+ +N
烈  a   しい:adn+ しく:adv+
震  n   える:adn*x えし:adn*x えて:advx
蝕  n   む:adn* まれた:adn*p んで:adv
輝  n   く:adn*x ける:adn*x いて:advx
耀  n   く:adn*x いて:advx
霞  n   む:adn*x +N
青  a   い:adn+ く:adv+ +N
白  a   い:adn+ く:adv+ +N
赤  a   い:adn+ く:adv+ +N
暗  a   い:adn+ く:adv+
黒  a   い:adn+ く:adv+ +N
突  n   く:adn* き:adv*
疾  n   き:adn
翔  n   ける:adn*x けて:advx
錬  n   る:adn* +N
呪  n   う:adn* われた:adn*p いの:case>noun いを:case>verb
流  n   れる:adn*x す:adn* れて:advx して:adv
閃  n   く:adn*x いた:adn*x き:adv*x
煌  n   めく:adn*x めいて:advx めき:advx
迅  n   き:adn
颯  n   +N
光  n   る:adn*x り:advx +N

# ── 効果語 (い形容) ──
強  a   い:adn+ く:adv+
速  a   い:adn+ く:adv+
鋭  a   い:adn+ く:adv+
重  a   い:adn+ く:adv+
硬  a   い:adn+ く:adv+
明  a   るい:adn+ るく:adv+ らかな:adn+
早  a   い:adn+ く:adv+
遅  a   い:adn+ く:adv+
高  a   い:adn+ く:adv+
深  a   い:adn+ く:adv+
遠  a   い:adn+ く:adv+
近  a   い:adn+ く:adv+
長  a   い:adn+ く:adv+
短  a   い:adn+ く:adv+
大  a   きな:adn+ きい:adn+ きく:adv+
多  a   い:adn+ く:adv+
少  a   ない:adn+ なく:adv+
広  a   い:adn+ く:adv+
小  a   さな:adn+ さい:adn+ さく:adv+
淡  a   い:adn+ く:adv+
濃  a   い:adn+ く:adv+
甘  a   い:adn+ く:adv+
渋  a   い:adn+ く:adv+
寂  a   しい:adn+ しく:adv+ びた:adn+
良  a   い:adn+ く:adv+
悪  a   い:adn+ く:adv+ +N
荒  a   い:adn+ く:adv+ ぶる:adn*x
寒  a   い:adn+ く:adv+
温  a   かい:adn+ かな:adn+ かく:adv+
厚  a   い:adn+ く:adv+
軽  a   い:adn+ く:adv+ やかな:adn+
鈍  a   い:adn+ く:adv+
冷  a   たい:adn+ たく:adv+ える:adn*x
正  a   しい:adn+ しく:adv+
賢  a   い:adn+ く:adv+
巨  a   きな:adn+ きい:adn+ きく:adv+
酷  a   い:adn+ く:adv+
清  a   い:adn+ く:adv+ らかな:adn+
宏  a   い:adn+ く:adv+
斉  a   しい:adn+ しく:adv+
程  a   よい:adn+ よく:adv+
固  a   い:adn+ く:adv+ める:adn*
優  a   しい:adn+ しく:adv+ れた:adn*x
厳  a   しい:adn+ しく:adv+ かな:adn+
麗  a   しい:adn+ しく:adv+ らかな:adn+

# ── 効果語 (な形容) ──
柔  na  らかな:adn+ らかに:adv+
静  na  かな:adn+ かに:adv+
穏  na  やかな:adn+ やかに:adv+
奇  na  なる:adn+ に:adv+
雅  na  な:adn+ やかな:adn+ やかに:adv+
華  na  やかな:adn+ やかに:adv+
密  na  な:adn+ に:adv+
壮  na  なる:adn+ に:adv+
燦  na  なる:adn+ めく:adn*x めいて:advx に:adv+
聖  na  なる:adn+ +N
確  na  かな:adn+ かに:adv+
滑  na  らかな:adn+ らかに:adv+ る:adn*x
妙  na  な:adn+ に:adv+
急  na  な:adn+ に:adv+ ぐ:adn*x

# ── 効果語 (体言だが動詞・副詞の形を持つ) ──
眠  n   る:adn*x れる:adn*x って:advx
香  n   る:adn*x +N
無  n   き:adn +N
豪  n   の:case>noun
真  n   の:case>noun なる:adn+ に:adv
素  n   の:case>noun
剛  n   の:case>noun
活  n   きる:adn*x かす:adn* きて:advx かして:adv
準  n   ずる:adn*x じて:advx
適  n   う:adn*x した:adn*x して:adv いて:advx
圧  n   する:adn* +N
律  n   する:adn* して:adv
引  n   く:adn* き:adv*
導  n   く:adn* き:adv* かれた:adn*p
徹  n   する:adn*x して:advx
執  n   る:adn* する:adn* って:adv して:adv
瞬  n   く:adn*x いて:advx
会  n   う:adn*x の:case>noun って:advx
必  n   ず:adv
反  n   る:adn*x する:adn*x って:advx して:advx
退  n   く:adn*x ける:adn* いて:advx けて:adv
衰  n   える:adn*x えて:advx
合  n   う:adn*x する:adn*x って:advx して:advx
再  n   び:adv
回  n   る:adn*x す:adn* り:adv* された:adn*p
続  n   く:adn*x ける:adn* いて:advx けて:adv
減  n   る:adn*x らす:adn* って:advx らして:adv
特  n   に:adv
囲  n   む:adn* う:adn* まれた:adn*p んで:adv って:advx
昂  n   る:adn* ぶる:adn* って:adv ぶって:adv
打  n   つ:adn* ち:adv*
防  n   ぐ:adn* いで:adv
撃  n   つ:adn* ち:adv*
連  n   なる:adn*x ねる:adn* なって:advx ねて:adv
湧  n   く:adn*x いて:advx
潤  n   う:adn*x す:adn* って:advx して:adv
発  n   する:adn* +N
穢  n   れた:adn*x す:adn* れて:advx して:adv
爛  n   れる:adn*x れた:adn*x れて:advx
護  n   る:adn* って:adv
結  n   ぶ:adn* ばれた:adn*p んで:adv ばれて:adv
穿  n   つ:adn* ち:adv*
通  n   る:adn*x す:adn* って:advx して:adv

# ── 核語 ──
志  n   す:adn* +N
巧  na  みな:adn+ みに:adv+
守  n   る:adn* って:adv
感  n   じる:adn* じて:adv

# ── 動詞 (全部書く) ──
爆  v   ぜる:adn*x ぜて:advx ぜた:adn*x ぜ:advx
殺  v   す:adn* された:adn*p して:adv した:adn*p し:adv*
滅  v   ぼす:adn* びる:adn*x ぼされた:adn*p ぼして:adv びて:advx ぼした:adn*p ぼし:adv* びた:adn*x び:advx
轟  v   く:adn*x いて:advx いた:adn*x き:advx
侵  v   す:adn* された:adn*p して:adv した:adn*p し:adv*
炸  v   ぜる:adn*x ぜて:advx ぜた:adn*x ぜ:advx
破  v   る:adn* れる:adn*x られた:adn*p って:adv れて:advx った:adn*p り:adv* れた:adn*x れ:advx
沸  v   く:adn*x かす:adn* かされた:adn*p いて:advx かして:adv いた:adn*x き:advx かした:adn*p かし:adv*
凍  v   る:adn*x える:adn*x って:advx えて:advx った:adn*x り:advx えた:adn*x え:advx
燃  v   える:adn*x やす:adn* やされた:adn*p えて:advx やして:adv えた:adn*x え:advx やした:adn*p やし:adv*
焼  v   く:adn* ける:adn*x かれた:adn*p いて:adv けて:advx いた:adn*p き:adv* けた:adn*x け:advx
焦  v   げる:adn*x がす:adn* がされた:adn*p げて:advx がして:adv げた:adn*x げ:advx がした:adn*p がし:adv*
溶  v   ける:adn*x かす:adn* かされた:adn*p けて:advx かして:adv けた:adn*x け:advx かした:adn*p
融  v   ける:adn*x かす:adn* かされた:adn*p けて:advx かして:adv けた:adn*x け:advx かした:adn*p
蒸  v   す:adn* された:adn*p して:adv した:adn*p し:adv*
貫  v   く:adn* かれた:adn*p いて:adv き:adv* いた:adn*p
射  v   る:adn* られた:adn*p て:adv った:adn*p り:adv*
斬  v   る:adn* られた:adn*p り:adv* って:adv った:adn*p
砕  v   く:adn* ける:adn*x かれた:adn*p いて:adv けて:advx いた:adn*p き:adv* けた:adn*x
殴  v   る:adn* られた:adn*p って:adv った:adn*p り:adv*
渦  n   +N
乱  n   れる:adn*x れた:adn*x れて:advx +N
還  n   る:adn*x +N
散  v   る:adn*x らす:adn* らされた:adn*p って:advx らして:adv った:adn*x り:advx らした:adn*p
伸  v   びる:adn*x ばす:adn* ばされた:adn*p びて:advx ばして:adv びた:adn*x び:advx ばした:adn*p ばし:adv*
縮  v   む:adn*x める:adn* められた:adn*p んで:advx めて:adv んだ:adn*x み:advx めた:adn*p
跳  v   ねる:adn*x ぶ:adn*x ねて:advx んで:advx ねた:adn*x ね:advx んだ:adn*x び:advx
響  v   く:adn*x いて:advx いた:adn*x き:advx
裂  v   く:adn* ける:adn*x かれた:adn*p いて:adv けて:advx いた:adn*p き:adv* けた:adn*x
舞  v   う:adn*x って:advx い:adv*x った:adn*x
吸  v   う:adn* われた:adn*p って:adv った:adn*p い:adv*
吐  v   く:adn* かれた:adn*p いて:adv いた:adn*p き:adv*
潜  v   む:adn*x る:adn*x んで:advx って:advx んだ:adn*x み:advx った:adn*x り:advx
浮  v   く:adn*x かぶ:adn*x いて:advx んで:advx いた:adn*x き:advx かんだ:adn*x かび:advx
沈  v   む:adn*x める:adn* められた:adn*p んで:advx めて:adv んだ:adn*x み:advx めた:adn*p
昇  v   る:adn*x って:advx った:adn*x り:advx
降  v   る:adn*x って:advx った:adn*x り:advx
挟  v   む:adn* まれた:adn*p んで:adv んだ:adn*p み:adv*
掴  v   む:adn* まれた:adn*p んで:adv んだ:adn*p み:adv*
掘  v   る:adn* られた:adn*p って:adv った:adn*p り:adv*
叩  v   く:adn* かれた:adn*p いて:adv いた:adn*p き:adv*
踏  v   む:adn* まれた:adn*p んで:adv み:adv* んだ:adn*p
擦  v   る:adn* れる:adn*x られた:adn*p って:adv れて:advx った:adn*p り:adv* れた:adn*x れ:advx
潰  v   す:adn* れる:adn*x された:adn*p して:adv れて:advx した:adn*p し:adv* れた:adn*x れ:advx
嚇  v   す:adn* された:adn*p して:adv した:adn*p し:adv*
縛  v   る:adn* られた:adn*p って:adv った:adn*p り:adv*
鍛  v   える:adn* えた:adn* えて:adv え:adv*
研  v   ぐ:adn* ぎ:adv がれた:adn*p いだ:adn*p
駆  v   ける:adn*x けた:adn*x け:adv*x
浴  v   びる:adn* びた:adn* びて:adv び:adv*
浸  v   す:adn* した:adn* された:adn*p して:adv し:adv*
錆  v   びる:adn*x びた:adn*x びて:advx び:advx
癒  v   す:adn* える:adn*x して:adv えて:advx した:adn*p し:adv* えた:adn*x え:advx

# ── 中二病の動詞 ──
絶  v   つ:adn* たれた:adn*p て:adv える:adn*x えて:advx った:adn*p ち:adv* えた:adn*x え:advx
終  v   わる:adn*x わった:adn*x わり:advx わって:advx える:adn* えて:adv
戮  v   する:adn* された:adn*p して:adv した:adn*p し:adv*
屠  v   る:adn* られた:adn*p り:adv* って:adv った:adn*p
討  v   つ:adn* たれた:adn*p ち:adv* って:adv った:adn*p
刈  v   る:adn* られた:adn*p り:adv* って:adv った:adn*p
祓  v   う:adn* われた:adn*p い:adv* って:adv った:adn*p
祟  v   る:adn*x られた:adn*p り:advx って:advx った:adn*x
葬  v   る:adn* られた:adn*p り:adv* って:adv った:adn*p
刺  v   す:adn* された:adn*p して:adv した:adn*p し:adv*
刻  v   む:adn* まれた:adn*p み:adv* んで:adv んだ:adn*p
煉  v   る:adn* られた:adn*p り:adv* って:adv った:adn*p

# ── 追加動詞 (1 文字で動作になる語) ──
分  v   ける:adn* けて:adv かれた:adn*p けた:adn*p け:adv*
切  v   る:adn* り:adv* られた:adn*p った:adn*p
刳  v   る:adn* り:adv* った:adn*p
動  v   く:adn*x き:advx いた:adn*x
化  v   する:adn* して:adv した:adn*p し:adv*
吟  v   じる:adn* じて:adv じた:adn*p じ:adv*
吹  v   く:adn* き:adv* いた:adn*p
呈  v   する:adn* して:adv した:adn*p し:adv*
哭  v   く:adn*x いた:adn*x き:advx
啜  v   る:adn* った:adn*p り:adv*
在  v   る:adn*x った:adn*x り:advx
坐  v   る:adn*x った:adn*x り:advx
垂  v   れる:adn*x れて:advx れた:adn*x れ:advx
壊  v   す:adn* れた:adn*p して:adv した:adn*p し:adv*
変  v   じる:adn* じて:adv わった:adn*x じ:adv*
失  v   う:adn* って:adv った:adn*p い:adv*
奏  v   でる:adn* でて:adv でた:adn*p で:adv*
奔  v   る:adn*x って:advx った:adn*x り:advx
封  v   じる:adn* じて:adv じた:adn*p じ:adv*
尽  v   くす:adn* きる:adn*x くして:adv きて:advx くした:adn*p くし:adv* きた:adn*x き:advx
崩  v   す:adn* れた:adn*p して:adv した:adn*p し:adv*
嵌  v   る:adn*x めた:adn*p り:advx め:adv*
干  v   す:adn* した:adn*p し:adv*
廻  v   る:adn*x す:adn* り:adv った:adn*x した:adn*p
弁  v   じる:adn* じて:adv じた:adn*p じ:adv*
従  v   う:adn*x って:advx った:adn*x い:advx
成  v   る:adn*x した:adn* り:advx し:adv*
戯  v   れる:adn*x れて:advx れた:adn*x れ:advx
拘  v   る:adn*x って:advx った:adn*x り:advx
捕  v   らえる:adn* らえた:adn*p えて:adv らえ:adv*
揺  v   れる:adn*x らす:adn* れて:advx らして:adv れた:adn*x れ:advx らした:adn*p
損  v   じる:adn* じて:adv じた:adn*p じ:adv*
操  v   る:adn* った:adn*p り:adv*
攻  v   める:adn* めて:adv めた:adn*p め:adv*
放  v   つ:adn* って:adv った:adn*p ち:adv*
敗  v   れる:adn*x れて:advx れた:adn*x れ:advx
斂  v   する:adn* して:adv した:adn*p し:adv*
断  v   つ:adn* ち:adv* った:adn*p
来  v   る:adn*x た:adn*x り:advx
枯  v   れる:adn*x らす:adn* れて:advx れた:adn*x れ:advx らした:adn*p らし:adv*
歌  v   う:adn* って:adv った:adn*p い:adv*
歩  v   く:adn*x き:advx いた:adn*x
残  v   る:adn*x す:adn* った:adn*x り:advx した:adn*p し:adv*
毀  v   つ:adn* ち:adv* った:adn*p
消  v   す:adn* えた:adn*x して:adv えて:advx した:adn*p し:adv* え:advx
游  v   ぐ:adn*x いで:advx いだ:adn*x ぎ:advx
犯  v   す:adn* した:adn*p し:adv*
猟  v   る:adn* った:adn*p り:adv*
生  v   きる:adn*x きた:adn*x きて:advx き:advx
盗  v   む:adn* んだ:adn*p んで:adv み:adv*
知  v   る:adn* った:adn*p って:adv り:adv*
移  v   る:adn*x す:adn* って:advx して:adv った:adn*x り:advx した:adn*p
繚  v   る:adn*x った:adn*x り:advx
聚  v   する:adn* して:adv した:adn*p し:adv*
脱  v   する:adn* して:adv した:adn*p し:adv*
落  v   ちる:adn*x とす:adn* ちて:advx として:adv ちた:adn*x ち:advx とした:adn*p とし:adv*
蕩  v   ける:adn*x けた:adn*x け:advx
衝  v   く:adn* いた:adn*x き:adv*
見  v   る:adn* た:adn*p て:adv
誅  v   する:adn* した:adn*p し:adv*
賜  v   る:adn* った:adn*p り:adv*
走  v   る:adn*x り:advx った:adn*x
躇  v   う:adn*x って:advx った:adn*x い:advx
躊  v   う:adn*x って:advx った:adn*x い:advx
躍  v   る:adn*x り:advx った:adn*x
転  v   ぶ:adn*x がす:adn* んで:advx んだ:adn*x び:advx がした:adn*p がし:adv*
追  v   う:adn* った:adn*p って:adv い:adv*
逐  v   う:adn* って:adv った:adn*p い:adv*
造  v   る:adn* った:adn*p り:adv*
遁  v   れる:adn*x れて:advx れた:adn*x れ:advx
遊  v   ぶ:adn*x んで:advx んだ:adn*x び:advx
遡  v   る:adn*x って:advx った:adn*x り:advx
避  v   ける:adn* けて:adv けた:adn*p け:adv*
酌  v   む:adn* んで:adv んだ:adn*p み:adv*
閉  v   じる:adn* じて:adv じた:adn*p じ:adv*
開  v   く:adn*x いた:adn*x いて:advx き:advx
闘  v   う:adn*x った:adn*x って:advx い:advx
闢  v   く:adn*x いた:adn*x き:advx
飛  v   ぶ:adn*x んだ:adn*x んで:advx び:advx
鳴  v   る:adn*x いた:adn*x いて:advx り:advx

# ── 追加の形容語 ──
安  a   い:adn+ く:adv+
太  a   い:adn+ く:adv+
細  a   い:adn+ く:adv+
薄  a   い:adn+ く:adv+
若  a   い:adn+ く:adv+
苦  a   い:adn+ く:adv+
危  a   ない:adn+ なく:adv+
平  na  らかな:adn+ らかに:adv+

# ── 送り仮名の補完 (全語チェックで足した語) ──
# 形容・動詞として使えるのに、形を持っていなかった語。辞書に載っている
# 自然な形だけを、その語の送り仮名として置く。
激  a   しい:adn+ しく:adv+
晴  n   れる:adn*x れた:adn*x れて:advx
凪  n   ぐ:adn*x いだ:adn*x いで:advx +N
紅  a   い:adn+ く:adv+
碧  a   い:adn+ く:adv+
灼  v   く:adn* かれた:adn*p いて:adv いた:adn*p き:adv*
濁  v   る:adn*x った:adn*x り:advx って:advx らす:adn*
汚  a   い:adn+ く:adv+ す:adn* れた:adn*p れて:advx
純  na  な:adn+ に:adv+
怒  n   る:adn*x った:adn*x り:advx
愛  n   する:adn* した:adn* された:adn*p して:adv +N
望  n   む:adn* んだ:adn*p んで:adv
痛  a   い:adn+ く:adv+ む:adn*x んだ:adn*x んで:advx
狂  n   う:adn*x った:adn*x って:advx
満  n   ちる:adn*x ちた:adn*x ちて:advx たす:adn* たした:adn*p たして:adv
異  na  なる:adn+ に:adv+
空  n   く:adn*x いた:adn*x いて:advx +N
超  n   える:adn* えた:adn* えて:adv
怪  a   しい:adn+ しく:adv+
楽  a   しい:adn+ しく:adv+
丸  a   い:adn+ く:adv+
憂  a   い:adn+ く:adv+ う:adn* えた:adn*p えて:adv
勝  n   つ:adn*x った:adn*x って:advx
助  n   ける:adn* けた:adn*p けて:adv
伏  n   せる:adn* せた:adn*p せて:adv
倣  n   う:adn* った:adn*p って:adv
憤  n   る:adn*x った:adn*x り:advx
戒  n   める:adn* めた:adn*p めて:adv
極  n   める:adn* めた:adn*p めて:adv まる:adn*x まった:adn*x
模  n   す:adn* した:adn*p して:adv
想  n   う:adn* った:adn*p って:adv
証  n   する:adn* した:adn*p して:adv
約  n   する:adn* した:adn*p して:adv
服  n   する:adn*x した:adn*x して:advx
離  n   れる:adn*x れた:adn*x れて:advx
限  n   る:adn*x った:adn*x り:advx
量  n   る:adn* った:adn*p って:adv
上  n   る:adn*x った:adn*x り:advx げる:adn* げた:adn*p げて:adv
下  n   る:adn*x り:advx げる:adn* げた:adn*p げて:adv
代  n   わる:adn*x わった:adn*x える:adn* えて:adv
処  n   する:adn* した:adn*p して:adv
和  na  やかな:adn+ やかに:adv+
邪  na  な:adn+ に:adv+
侘  n   びる:adn*x びた:adn*x びて:advx
`;

/** 品詞の略号。 */
export const POS_CODE = { n: '体言', a: '形容', na: '形動', v: '用言' };

/**
 * 形 1 つを読む。「る:adn*」→ { k:'る', role:'adn', pred:true }
 * 「える:adn*x」→ { k:'える', role:'adn', pred:true, intr:true }
 * @returns {{k:string, role:string, next?:string, pred?:boolean, adj?:boolean, passive?:boolean, intr?:boolean}}
 */
export function parseForm(tok) {
  const m = /^([ぁ-ん]+):(adn|adv|case>(?:noun|verb|pred))([*+]?)(p?)(x?)$/.exec(tok);
  if (!m) throw new Error(`接続詞プールの書式が不正: ${tok}`);
  const [, k, roleRaw, mark, pass, intr] = m;
  const [role, next] = roleRaw.split('>');
  const e = { k, role };
  if (next) e.next = next;
  if (mark === '*') e.pred = true;
  if (pass) e.passive = true;
  if (mark === '+') e.adj = true;
  if (intr) e.intr = true;
  return Object.freeze(e);
}

const parseForms = (tokens) => {
  const out = [];
  for (const t of tokens) {
    if (t === '+N') out.push(...NOUN_POOL);
    else out.push(parseForm(t));
  }
  // 同じ送り仮名を 2 回書いたら先のものを残す。
  const seen = new Set();
  return out.filter((e) => (seen.has(e.k) ? false : (seen.add(e.k), true)));
};

/** 名詞の共通プール。 */
export const NOUN_POOL = Object.freeze(NOUN_POOL_SPEC.split(/\s+/).map(parseForm));

/** 語 → { pos, pool }。表に書いた語だけ。 */
export const WORD_POOLS = Object.create(null);
for (const line of RAW_POOL.split('\n')) {
  const row = line.trim();
  if (!row || row.startsWith('#')) continue;
  const [text, posCode, ...forms] = row.split(/\s+/);
  if (!POS_CODE[posCode]) throw new Error(`接続詞プールの品詞が不正: ${row}`);
  if (WORD_POOLS[text]) throw new Error(`接続詞プールの二重定義: ${text}`);
  WORD_POOLS[text] = Object.freeze({ pos: POS_CODE[posCode], pool: Object.freeze(parseForms(forms)) });
}

/**
 * 語の接続詞プール。表に無い語は名詞 (NOUN_POOL)。
 * @param {string} text
 * @returns {ReadonlyArray<{k:string, role:string, next?:string, pred?:boolean, adj?:boolean}>}
 */
export function poolOfText(text) {
  if (!text) return [];
  const p = WORD_POOLS[text];
  return p ? p.pool : NOUN_POOL;
}

/** 語の品詞。表に無い語は体言。 */
export function posOfText(text) {
  const p = WORD_POOLS[text];
  return p ? p.pos : POS_CODE.n;
}

/**
 * 熟語 → 熟語自身の接続詞プール。pool を持つ熟語だけ。
 *   発電 → [する:adn*]
 * 熟語は体言 (サ変名詞) として扱う。
 */
export const COMPOUND_POOLS = Object.create(null);
for (const key of Object.keys(PHRASE_BONUS)) {
  // 手書きの熟語 (words.phrase.js) の pool が最優先。無ければ、熟語ごとに
  // 決めた固定の活用 (words.compound-forms.js) を使う。末尾の 1 字から
  // 活用を作ることはしない —「反射る」のような日本語に無い形を防ぐ。
  const spec = (PHRASE_BONUS[key].pool || compoundFormSpec(key) || '').trim();
  if (!spec) continue;
  COMPOUND_POOLS[key] = Object.freeze({ pos: POS_CODE.n, pool: Object.freeze(parseForms(spec.split(/\s+/))) });
}

/** 接続詞プールを持つ熟語の最長の文字数。 */
export const MAX_COMPOUND_POOL_LEN = Object.keys(COMPOUND_POOLS)
  .reduce((m, k) => Math.max(m, k.length), 0);

/**
 * 熟語の接続詞プール。持たなければ null。
 * @param {string} text 熟語
 */
export function compoundPoolOf(text) {
  const p = COMPOUND_POOLS[text];
  return p ? p.pool : null;
}
