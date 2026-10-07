// ============================================================================
// ワードローグ — 接続詞
//
// 接続詞は「直前の語」に結合する。結合すると 1 つの合成語になる。
//   例 「弾」+「く」 -> 弾く
//
// 枠は語だけを置く。接続詞は枠と枠のあいだに置くので、接続詞を並べても
// 枠は潰れない。
//   業火 の 鋭 く 貫 を 剛 硬 … + 剣
//
// 結合できるかどうかは「直前の語」で決まる。品詞は 5 つに分かれる。
//   体言     … 名詞。属性・形態・効果・自身の語。       の・を・に・へ
//   する体言 … 「〜する」の名詞。爆裂・貫通・侵蝕 …   それら＋する
//   形容     … い形容詞の語幹。鋭・強・速・淡 …       く・い
//   形動     … な形容詞の語幹。妙・急・滑らか…    な・に
//   用言     … 動詞。斬・貫・焼 …                     る・された・せし・り
//
// これが日本語の文法そのもの。全部の組を許すと
// 「業火剛利貫通剛硬された刃剣」のような、世的でない名前ができてしまう。
//   されたは用言にしか付かない → 「剛硬された」はできない
//   くはい形容にしか付かない   → 「剛利く」はできない
//     (ただし「〜く」で連用形になる語 = 響・沸・吐・穿・融・散・瞬 は例外)
//   なはな形容にしか付かない   → 「速な」はできない
//   な形容詞の連体形は「〜な」。妙な刃 / 滑らかな刃。
//   1 漢字語 (`静な` `巨な`) は日本語に無いので作らない。
//   「〜か」を含む な形容詞 (静か 確か 滑らか) は かな で書く。静かな刃 / 確かな刃。
//
// このうち 3 つは語ごとの絞り込みを持つ。
//   する … する体言にだけ。   業火する ✗ / 爆裂する ✓
//   つ   … 付言便乗の語にだけ。 強つい ✗ / 温つい ✓
//   かな … 静・確・滑・適・華・豪・精・良・明・優・巧 にだけ。静かな ✓ / 焔かな ✗
//
// 逆に、品詞之外でしか付かない語もある。日本語に実際にその語形があるため。
//   く … 「〜く」で連用形になる語。  響く(響く) ✓ / 瞬く(瞬く) ✓
//   な … な形容にも使うい形容の語幹。 急な(急な) ✓
//   かな … 「1 漢字語 + か」で な形容詞になる語。 静かな ✓ / 焔かな ✗
//
// さらに接続詞には「形」がある。名詞を修飾できるのは連体形と格助詞だけで、
// 連用形・続用形は名詞の修飾語にはなれない。
//   OK「業火を斬る剣」   … る(連体形) のあとに名詞。日本語として正しい。
//   OK「業火を斬された刃」… された(連体形) のあとに名詞。
//   OK「業火を斬る妙な刃」… な(な形容の連体形) のあとに名詞。
//   NG「業火を斬く剣」    … く(連用形) のあとに名詞。連用形は名詞を修飾しない。
//   NG「剛利く剣」        … 同じ。連体で名詞を修飾するなら「〜い」「〜な」「〜される」。
//   NG「妙に剣」          … 連用形「〜に」(妙に) も名詞を修飾しない。
//   NG「業火を剣」        … をの後ろに動詞 (=目的語) が要る。
//   NG「刃剣」            … 形を表す語どうし。末尾語の判定で弾く。
//
// 規則は 4 つ。文が壊れるのは次の 4 つだけ。
//
// 1. 同じ接続詞は 1 文に 1 回まで。
//      NG 「風の海潮の銃」 … のが 2 回出ている。
//
// 2. 接続詞には優先順位があり、末尾語に近いほど順位が上がる。
//      OK 「業火の爆裂する剛い剣」 … の(3) → する(2) → い(1) の降順。
//      NG 「剛の業火する剣」 … する(2) のあとに の(3) は来ない。
//      形容の接続詞 (く・い・な・つ) は順序を気にしない。
//      OK 「速い業火を斬る剛い剣」 … く と い の並びは順序を気にしない。
//      NG 「速い業火を斬る速い剣」 … 同じ接続詞を 2 回は使えない (規則 1)。
//
// 3. 接続詞は直前の語に結合できなければならない。宙に浮く接続詞は壊れた文。//   NG 「剛された」… された(用言のみ) の直前が体言。結べない。
//   NG 「速な」    … な(形動のみ) の直前がい形容。結べない。
//
// 4. 接続詞のあとに名詞が来るなら、その接続詞は連体形でなければならない。
//      NG「業火を剛硬された刃」… をのあとに名詞で、を のあとに動詞も無い。
//      を のあとに用言が要る。目的語を取らない「〜を」は日本語に無い。
//
// このほか、形容の連体形もな形容の連体形も名詞を修飾する。
// 形容語幹のまま末尾語に置くと「剛硬環」のような略し方になり、自然さが落ちる。
//   OK「業火を斬る妙な剛硬環」  NG(減点)「業火剛硬環」
// ============================================================================

/**
 * 品詞。接続詞の相性はここで決まる。
 *
 *   noun  体言     名詞。の・を・に・へ・するが付く。
 *   adj   形容     い形容詞の語幹。く・いが付く。
 *   naadj 形動     な形容詞の語幹。な・にが付く。
 *   verb  用言     動詞。る・された・われた・られた・せし・り・を・にが付く。
 *
 * 「い形容」と「な形容」を混ぜないことが日本語として自然になる要点。
 *   静か  … な形容。静かな刃 ✓  静く刃 ✗  静い刃 ✗  静に刃 ✗
 *   速い  … い形容。「速い剣」✓  「速な剣」✗
 */
export const POS = {
  noun: '体言',     // 名詞
  adj: '形容',     // い形容詞の語幹
  naadj: '形動',    // な形容詞の語幹
  verb: '用言',     // 動詞
};

/**
 * 接続詞と、その形・優先順位・後続の品詞。
 *   pri   … 1 が最上位。2 が説明。3 が格・接尾。
 *   after … 直前の語がどの品詞なら結合できるか。
 *   adn   … 連体形 (名詞を修飾できる形) か。格助詞も true。
 *            連用形 (く・にの連用) と続用形 (せし / り) は false。
 *   obj   … あとに目的語 (用言) を要求するか。「を」だけ。
 *   words … 品詞とは関係なく、その語にだけ付くという例外。
 *            く はい形容の連用形だが、「響く」(響く) のように
 *            「〜く」で連用形になる語はどれにも付く。
 *   wordsOnly … words の語にだけ結合する (品詞では結べない語を弾く)。
 *            かな は 静・確・滑・適・華・豪・精・良・明・優・巧 にだけ
 *            (静かな刃 / 確かな刃 / 滑かな刃)。
 *   fx    … 合成したときに得る効果。
 */

/**
 * 「〜く」で連用形になる語。い形容以外でも く が付く。
 *   響 + く = 響く (雷の響く斬る剣 … 響かせて斬る剣)
 *   沸 + く = 沸く / 吐 + く = 吐く / 穿 + く = 穿く
 *   融 + く = 融く / 散 + く = 散く / 瞬 + く = 瞬く
 *   貫 + く = 貫く（つらぬく）  焼 + く = 焼く / 叩 + く = 叩く
 *   浮 + く = 浮く / 溶 + く = 溶く（とかす） / 跨 + く = 跨く（またぐ）
 *   轟 + く = 轟く（とどろく） / 裂 + く = 裂く（さく） / 砕 + く = 砕く（くだく）
 * 「速く」(い形容の連用) と同じ並びになるので、く だけ特別に許す。
 * 動詞の「〜く」は終止形・連体形でもあるので、あとに名詞を置ける (貫く刃)。
 */
const KUCHI_WORDS = new Set([
  '響', '沸', '吐', '穿', '融', '散', '瞬',
  '貫', '焼', '叩', '浮', '溶', '跨', '轟', '裂', '砕',
]);

/**
 * 「い形容の語干だが な形容としても使う」語。な と に が追加で付く。
 *   急 + く = 急く / 急 + い = 急い / 急 + な = 急な刃 / 急 + に = 急に
 * 品詞は 1 つしか持てない (この語は 形容) ので、第二の形を個別に指定する。
 */
const KEINA_WORDS = new Set(['急']);

/**
 * 「1 漢字語 + か」で な形容詞になる語。かな が付く。
 *   静 + かな = 静かな ✓（静か の連体形 / しずか）
 *   確 + かな = 確かな ✓（確か の連体形 / たしか）
 *   滑 + かな = 滑かな ✓（滑らか の連体形 / なめらか）
 *   適 + かな = 適かな ✓（適切 の連体形 / てきせつ）
 * な形容詞の語幹が「Xか」の形になるなら、1 漢字語 + かな で書ける。
 *   華 + かな = 華かな ✓（華美）  豪 + かな = 豪かな ✓（豪快）
 *   精 + かな = 精かな ✓（精密）  良 + かな = 良かな ✓（良質）
 *   明 + かな = 明かな ✓（明快）  優 + かな = 優かな ✓（優美）
 *   巧 + かな = 巧かな ✓（巧妙）
 *
 * 語幹が「Xか」にならない な形容詞は かな を結ばない。
 *   強 + かな ✗（強固 — 強固 の語幹は 強か ではない）
 *   頑 + かな ✗（頑強）  神 + かな ✗（神速）  端 + かな ✗（端正）
 *   冷 + かな ✗（冷徹）  巨 + かな ✗（巨大 — な形容詞ではなく名詞+い形容）
 * 「か」を含まないものは 1 漢字語のまま（静な ✗ / 焔な ✗ / 速な ✗）。
 */
const KANA_WORDS = new Set([
  '静', '確', '滑', '適', '華', '豪', '精', '良', '明', '優', '巧',
]);

/**
 * 「〜する」が動詞として通用する語。する が体言以外の語にも付く。
 *   察 + する = 察する ✓（察する / さつする）
 * する は基本は「する-名詞」にだけ付く（業火する ✗ / 爆裂する ✓）。
 * この語だけは名詞ではなく、動詞の意味で使う。
 */
const SURU_VERBS = new Set(['察']);

/**
 * 「〜む」の終止形・命令形。む が付く。一文を閉じるが名詞は修飾しない。
 *   蝕 + む = 蝕む ✓（蝕む）      踏 + む = 踏む ✓（踏む）
 *   挟 + む = 挟む ✓（挟む）      掴 + む = 掴む ✓（掴む）
 *   嚇 + む = 嚇む ✓（嚇む）      沈 + む = 沈む ✓（沈む）
 *   縮 + む = 縮む ✓（縮む）      潜 + む = 潜む ✓（潜む）
 * 「〜む」が無い動詞には付かない。
 *   斬 + む ✗（斬む）  溶 + む ✗（溶む は無い。溶ける）  焼 + む ✗
 */
const MU_WORDS = new Set(['蝕', '踏', '挟', '掴', '嚇', '沈', '縮', '潜']);

/**
 * 「上一段動詞」の連体形・終止形。ける が付く。名詞を修飾できる。
 *   溶 + ける = 溶ける刃 ✓（溶ける刃）  凍 + ける = 凍ける刃 ✓（凍ける刃）
 *   融 + ける = 融ける刃 ✓（融ける刃）  焼 + ける = 焼ける刃 ✓（焼ける刃）
 *   焦 + ける = 焦ける刃 ✓（焦げる刃）  砕 + ける = 砕ける刃 ✓（砕ける刃）
 *   潰 + ける = 潰ける刃 ✓（潰れる刃）  冷 + ける = 冷ける刃 ✓（冷ける刃）
 * 「〜ける」が無い動詞には付かない。
 *   斬 + ける ✗（斬ける）  響 + ける ✗（響ける）  滅 + ける ✗（滅びる）
 */
const KERU_WORDS = new Set(['溶', '凍', '融', '焼', '焦', '砕', '潰', '冷']);

/**
 * 「〜い」で名詞になる語。い が付いて 1 つの名詞を作る。
 *   呪 + い = 呪い ✓（のろい / のろう の連用形が名詞化したもの）
 *   呪い + の = 呪いの刃 ✓
 * い は い形容詞の連体形 (速い) にも付くが、それとは別に、名詞を作る
 * 「い」としてこの語一覧にだけ付ける。作った名詞 (呪い) はさらに
 * 格の接続詞 (の・を・に・へ) を取れる。
 */
const I_NOUN_WORDS = new Set(['呪']);

export const CONNECTORS = {
  // pri 1 … 述語・受身。文を閉じるので最上位。
  された: { pri: 1, after: [POS.verb], adn: true, desc: '受身・状態。「〜された」', fx: { dmg: 2 } },
  われた: { pri: 1, after: [POS.verb], adn: true, desc: '受身。「〜われた」', fx: { dmg: 2, armor: 0.02 } },
  られた: { pri: 1, after: [POS.verb], adn: true, desc: '能動。「〜られる」', fx: { dmg: 2, rate: 0.1 } },
  // 連体形。名詞を修飾できる。「斬る剣」
  る:     { pri: 1, after: [POS.verb], adn: true, desc: '連体。「〜る」', fx: { dmg: 3, rate: 0.12 } },
  // 連用形。名詞を修飾できない。「速く斬る剣」✓ 「速く剣」✗
  // 例外として、「〜く」で連用形になる語にも付ける。
  //   響く(響く) / 沸く(沸く) / 吐く(吐く) / 穿く(穿く) / 融く(融く) / 散く(散く) / 瞬く(瞬く)
  く:     { pri: 1, after: [POS.adj], adn: false, words: KUCHI_WORDS, desc: '連用形。「〜く」', fx: { dmg: 3, crit: 0.02 } },
  // な形容詞の連体形「〜な」。妙な刃 / 急な刃。い形容詞には付かない。
  // 例外として「い形容の語干だが な形容にも使う」語に付く (急な刃)。
  な:     { pri: 1, after: [POS.naadj], adn: true, words: KEINA_WORDS, desc: '連体形。「〜な」', fx: { dmg: 2, area: 4 } },
  // 「か」のな形容詞の連体形。静かな刃 / 確かな刃 / 滑かな刃。
  // 語幹が「Xか」になる な形容詞だけに、1 漢字語 + かな で書く。
  //   静 + かな = 静かな ✓（静か + な）  静 + な = 静な刃 ✗
  // wordsOnly … 品詞ではなく、この語一覧にだけの語に結合する。
  かな:   { pri: 1, after: [POS.noun], adn: true, wordsOnly: true, words: KANA_WORDS, desc: '連体形。「〜かな」', fx: { dmg: 2, area: 4 } },
  // い形容詞の連体形・終止形。「速い剣」。「速な剣」✗
  //   呪 + い = 呪い (名詞) … 品詞は 体言 になり、の・を・に・へ が続く。
  い:     { pri: 1, after: [POS.adj], adn: true, words: I_NOUN_WORDS, form: POS.noun, formWords: I_NOUN_WORDS, desc: '連体形。「〜い」', fx: { dmg: 2, crit: 0.01 } },

  // pri 2 … 説明
  // 「〜する」の「する」。する-名詞にだけ付く。
  //   業火 + する ✗ (業火は名詞。する名詞ではない)
  //   爆裂 + する ✓
  // 例外として「〜する」が動詞として通用する語に付く (察する = 察する)。
  する:   { pri: 2, after: [POS.noun], adn: true, suruOnly: true, words: SURU_VERBS, desc: '説明。「〜する」', fx: { dmg: 3, rate: 0.15 } },
  // 終止形・命令形。「〜む」。一文を閉じると同時に名詞を修飾できる
  //   (辞書形は連体形でもある。「踏む焔」「飲む水」)。
  //   蝕 + む = 蝕む ✓（蝕む）  踏 + む = 踏む ✓（踏む）
  // wordsOnly … 「〜む」が無い動詞には結ばせない (斬む ✗)。
  む:     { pri: 2, after: [POS.verb], adn: true, wordsOnly: true, words: MU_WORDS, desc: '終止形・命令形。「〜む」', fx: { dmg: 5, crit: 0.02 } },
  // 上一段動詞の連体形・終止形。「〜ける」。
  //   溶 + ける = 溶ける刃 ✓（溶ける刃）  凍 + ける = 凍ける刃 ✓（凍ける刃）
  // wordsOnly … 「〜ける」が無い動詞には結ばせない (斬ける ✗)。
  ける:   { pri: 2, after: [POS.verb], adn: true, wordsOnly: true, words: KERU_WORDS, desc: '上一段。「〜ける」', fx: { dmg: 4, pierce: 1 } },
  // 続用形・連用形。「斬シ」「回シ」。名詞を修飾できない。
  //   されたと違い、受身にもならない。
  せし:   { pri: 2, after: [POS.verb], adn: false, desc: '続用形。「〜し」', fx: { dmg: 3, rate: 0.1 } },
  // 続用形・連用形。「斬り」「回り」「吹キ」。名詞を修飾できない。
  //   用言にしか付かない。「された」と違い、受身にもならない。
  り:     { pri: 2, after: [POS.verb], adn: false, desc: '続用形。「〜り」', fx: { dmg: 2, spread: 0.12 } },

  // pri 3 … 格・接尾
  の:     { pri: 3, after: [POS.noun], adn: true, desc: '格。「〜の」', fx: { dmg: 1, size: 0.05 } },
  // 付言便乗。「温つい」「重つい」。その語にだけ付く。
  つ:     { pri: 3, after: [POS.noun, POS.adj], adn: true, tsumi: true, desc: '付言便乗。「〜つい」', fx: { dmg: 2, rate: 0.1 } },
  // 「〜を」「〜に」は体言と用言に来る。目的語・指向語。
  //   「業火を斬る剣」… を のあとに動詞。日本語として正しい。
  //   「貫通を剣」    … をの後ろに名詞が無い。規則 4 (obj) で弾く。
  // に はな形容詞にも付く。連用形「静かに」の「に」。
  //   「静に斬る剣」 ✓  「静に剣」 ✗ (連用形は名詞を修飾しない・規則 4)
  // 例外として「い形容の語干だが な形容にも使う」語に付く (急に斬る刃)。
  に:     { pri: 3, after: [POS.noun, POS.naadj, POS.verb], adn: true, words: KEINA_WORDS, desc: '格。「〜に」', fx: { dmg: 1, homing: 0.1 } },
  を:     { pri: 3, after: [POS.noun, POS.verb], adn: true, obj: true, desc: '格。「〜を」', fx: { dmg: 2, knock: 12 } },
  へ:     { pri: 3, after: [POS.noun], adn: true, desc: '方向。「〜へ」', fx: { dmg: 1, speed: 22 } },
};

/** 接続詞の優先順 (優先順位の高い順)。文の判定とヒントの並びで使う。 */
export const CONNECT_ORDER = Object.keys(CONNECTORS).sort(
  (a, b) => CONNECTORS[a].pri - CONNECTORS[b].pri || a.localeCompare(b, 'ja'),
);

/** 述語になる接続詞。「〜した」「〜する」「〜る」「〜し」「〜む」「〜ける」で節が閉じる。 */
export const PREDICATE_CONNECTORS = new Set(
  ['された', 'われた', 'られた', 'る', 'する', 'せし', 'り', 'む', 'ける'],
);

/**
 * 名詞を修飾できない接続詞。連用形 (く・にの連用) と続用形 (せし / り)。
 * こいらは「連体修飾語」にはなれないので、あとに名詞を置けない。
 */
export const NON_ADNOMINAL_CONNECTORS = new Set(
  Object.keys(CONNECTORS).filter((k) => !CONNECTORS[k].adn),
);

/**
 * 形容 (い形容詞・な形容詞) にしか付かない接続詞。
 * これらは日本語では前置きしても後置きしてもよい。順序の制限には使わない。
 *   「速い業火を斬る剛い剣」… く が 2 つあっても自然。
 */
export const ADJ_CONNECTORS = new Set(
  Object.keys(CONNECTORS).filter((k) => CONNECTORS[k].after
    .every((p) => p === POS.adj || p === POS.naadj)),
);

/**
 * 「優先順位」は参考情報としてだけ残す。文を壊す判定には使わない。
 *   「業火の爆裂する剛い剣」 … の(3) → する(2) → い(1) の降順。
 *   「爆裂する業火の剣」      … する(2) → の(3) の昇順でも日本語としては読める
 *   (「する業火の」は重いが詩的表現)。どちらも成立させる。
 *   形容の接続詞 (く・い・な・つ) は順序を気にしない。
 *
 * 本当に壊れるのは「接続詞どうしが直接隣れる」並び (「業火するの剣」など)。
 * これは規則 3 (直前の語に結合) で宙に浮くので、ここでは見ない。
 */

/** 接続詞かどうか。 */
export function isConnector(text) {
  return Object.prototype.hasOwnProperty.call(CONNECTORS, text);
}
/**
 * この語に結合できる接続詞の一覧。
 * 言葉鍛冶のヒントとテストで使う。
 * @param {{text:string, pos?:string}} word
 * @returns {string[]}
 */
export function connectorFor(word) {
  if (!word || isConnector(word.text)) return [];
  return CONNECT_ORDER.filter((c) => canConnect(word, c));
}

/** この接続詞が付ける品詞。空なら何にも付かない。 */
export function connectorAfter(text) {
  return CONNECTORS[text] ? CONNECTORS[text].after : [];
}

/** 接続詞の優先順位。接続詞でなければ null。 */
export function connectorPri(text) {
  const c = CONNECTORS[text];
  return c ? c.pri : null;
}

/** 連体形 (名詞を修飾できる形) か。格助詞も true。 */
export function isAdnominal(text) {
  const c = CONNECTORS[text];
  return !!(c && c.adn);
}

/**
 * 分割結果の i 番目の接続詞が、その場で連体形として働くか。
 *
 * く は い形容の連用形 (速く) なので名詞を修飾しないが、
 * 「〜く」で終止・連体になる動詞 (貫く・響く…) のときは連体形になる。
 *   「速く斬る剣」✓（連用 → あとに動詞）  「速く剣」✗
 *   「毒を貫く刃」✓（連体 → あとに名詞）  貫く は終止形でもある
 *
 * @param {string[]} segs
 * @param {number} i 接続詞の位置
 */
export function adnominalAt(segs, i) {
  const s = segs[i];
  const c = CONNECTORS[s];
  if (!c) return false;
  if (c.adn) return true;
  // 動詞の「〜く」は連体形でもある。
  if (s === 'く') {
    const src = segs[i - 1];
    if (src && !isConnector(src) && KUCHI_WORDS.has(src)) return true;
  }
  return false;
}

/**
 * この語の直後にこの接続詞を置けるか。
 * 品詞が合わなければ結合しない (宙に浮く)。
 *
 * 語ごとにさらに条件がある。
 *   する … 「する」-able な名詞にだけ。  業火する ✗ / 爆裂する ✓
 *   つ   … 付言便乗の語にだけ。          強つい ✗ / 温つい ✓
 *   く   … 「〜く」で連用形になる語にだけ。  響く ✓ / 斬く ✗ / 瞬く ✓
 *
 * @param {{text:string, pos?:string, suru?:boolean, tsumi?:boolean}} source 直前の語
 * @param {string} connector
 */
export function canConnect(source, connector) {
  const c = CONNECTORS[connector];
  if (!c) return false;
  if (!source) return false;
  if (isConnector(source.text)) return false;   // 接続詞どうしでは結べない
  // 語ごとの例外・絞り込みは品詞より先に評価する。
  //   かな … 「1 漢字語 + か」で な形容詞になる語にだけ。
  //     品詞 (体言) だけでは「焔かな刃」(炎かな刃) を通してしまうので、
  //     この接続詞だけは語一覧で完全に絞る。
  //   wordsOnly … 品詞ではなく語一覧だけで結合を決める (かな)。
  if (c.wordsOnly) return !!(c.words && c.words.has(source.text));
  // 品詞の例外。日本語に実際にその語形があるため、品詞より強い。
  //   く …「〜く」で連用形になる語。響く ✓ / 斬く ✗ / 瞬く ✓
  //   む …「〜む」五段。蝕む ✓ / 踏む ✓ / 斬む ✗
  //   ける … 上一段の「〜ける」。溶ける ✓ / 斬ける ✗
  //   する …「〜する」動詞。察する ✓（する-名詞の絞り込みより先に通す）
  if (c.words && c.words.has(source.text)) return true;
  // 語ごとの絞り込み (する / つ) は品詞より先に弾く。
  //   する … 「する」-able な名詞にだけ。  業火する ✗ / 爆裂する ✓
  //   つ   … 付言便乗の語にだけ。          強つい ✗ / 温つい ✓
  if (c.suruOnly && !source.suru) return false;
  if (c.tsumi && !source.tsumi) return false;
  // 品詞が合えば結合できる。
  if (c.after.includes(source.pos)) return true;
  return false;
}

/**
 * 末尾語 (剣・銃・環 …) の直前に置いてよい語か。
 *
 * 日本語では名詞を修飾するのは連体修飾語だけで、
 *   「斬剣」「貫通を剣」のように用言や格助詞が直前にあるものは無い。
 * 述語・説明の接続詞 (〜された / 〜する) は名詞を修飾できるので許す。
 *   「改造された銃」 ✓
 *
 * @param {string|null} lastText 末尾語の直前の語。接続詞ならその語。
 * @param {string|null} pos その品詞。接続詞なら null。
 * @param {boolean} isConn 接続詞かどうか。
 * @param {Set<string>} unmodifiable 末尾語を直接修飾できない語。
 * @param {boolean} [adnOverride] 連体形かどうかの上書き。動詞の「〜く」用。
 * @returns {{ok:boolean, reason:string, reasonText:string}}
 */
export function checkTailModifier(lastText, pos, isConn, unmodifiable, adnOverride) {
  if (!lastText) {
    return { ok: true, reason: '', reasonText: '' };
  }
  if (isConn) {
    // 連体形 (〜された / 〜る / 〜い) と格助詞は名詞を修飾できる。
    // 連用形 (〜く) と断定形 (〜だ) は名詞を修飾しない。規則 4 で弾くが、
    // 末尾語を判定する入口でも同じ判定をする。
    const adn = adnOverride === undefined ? CONNECTORS[lastText].adn : adnOverride;
    if (adn) return { ok: true, reason: '', reasonText: '' };
    return {
      ok: false,
      reason: 'tailparticle',
      reasonText: `接続詞「${lastText}」は末尾語を修飾できない。`
        + '連用形「〜く」・断定形「〜だ」の後ろに名詞は来ない。'
        + '「〜い」「〜な」「〜された」を置くこと。',
    };
  }
  if (pos === POS.verb) {
    return {
      ok: false,
      reason: 'tailverb',
      reasonText: `「${lastText}」は動詞。末尾語を直接修飾できない。`
        + '動詞のあとは「〜された」や「〜する」を置くこと。',
    };
  }
  if (unmodifiable && unmodifiable.has(lastText)) {
    return {
      ok: false,
      reason: 'tailform',
      reasonText: `「${lastText}」は形を表す語。末尾語を直接修飾できない。`
        + '「刃剣」のような重複は日本語に無い。属性や効果の語を挟むこと。',
    };
  }
  return { ok: true, reason: '', reasonText: '' };
}

const fail = (reason, reasonText, acc) => ({
  ok: false, reason, reasonText,
  compounds: acc.compounds, floats: acc.floats, used: acc.used, order: acc.order,
});

/**
 * 分割結果に接続詞の規則を適用する。
 *
 * 返り値の ok が false のときは、文が壊れている。宙に浮く接続詞もここに来る。
 *
 * @param {string[]} segs 分割結果
 * @param {Record<string, {pos?:string, cat?:string}>} [dict] 語の情報 (品詞)
 * @returns {{
 *   ok: boolean,
 *   reason: string,
 *   reasonText: string,
 *   compounds: Array<{text:string, source:string, connector:string, pri:number, pos:string}>,
 *   floats: string[],
 *   used: string[],
 *   order: number[],
 * }}
 */
export function checkConnectors(segs, dict) {
  const acc = { compounds: [], floats: [], used: [], order: [] };
  const seen = new Map();
  // 直前の接続詞が作った語形 (仮想語)。1 段だけ連鎖を許す。
  //   呪 + い = 呪い (体言) -> 呪いの刃 の「の」はこの語形に結ぶ。
  // 実質語が来たら消える。
  let formWord = null;

  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (!isConnector(s)) { formWord = null; continue; }

    const { pri } = CONNECTORS[s];
    acc.order.push(pri);

    // 規則 1 … 同じ接続詞は 1 回まで。
    const n = (seen.get(s) || 0) + 1;
    seen.set(s, n);
    if (n > 1) {
      return fail('dupconn', `接続詞「${s}」を 2 回使っている。同じ接続詞は 1 文に 1 回まで。`, acc);
    }

    // 規則 2 (旧) … 優先順位による制限は撤廃。昇順・降順のどちらも成立する。
    //   「毒の侵蝕する針」✓ (の→する) 「侵蝕する毒の針」✓ (する→の)
    //   接続詞どうしが直接隣れる並びは、規則 3 の「直前の語に結合」で宙に浮く。

    // 規則 3 … 直前の語と結合する。品詞が合わなければ宙に浮く = 壊れた文。
    //   直前が接続詞でも、その接続詞が語形を作っていれば (呪 + い = 呪い)、
    //   その語形に結べる。作られていなければ、これまで通り宙に浮く。
    const prev = segs[i - 1];
    const prevInfo = prev && !isConnector(prev) ? dict?.[prev] : null;
    const srcWord = prevInfo ? { text: prev, ...prevInfo } : formWord;
    if (!canConnect(srcWord, s)) {
      const okAfter = CONNECTORS[s].after.join(' / ');
      const who = srcWord ? srcWord.text : (prev ?? '(先頭)');
      return fail('floatconn',
        `接続詞「${s}」が直前の「${who}」に結べない。`
        + `「${s}」は ${okAfter} にしか付かない。`
        + '直前の語の品詞に合う接続詞を置き換えること。',
        acc);
    }
    acc.compounds.push({
      text: (srcWord?.text ?? prev ?? '') + s,
      source: prev, connector: s, pri, pos: srcWord?.pos ?? null,
    });
    acc.used.push(s);

    // この接続詞が新しい語形を作るか。作った語形は次の接続詞の結合先になる。
    //   呪 + い = 呪い (体言) -> の・を・に・へ が続く。
    //   い形容の連体 (速い) は語形を作らない (formWords に無い)。
    //   1 段だけ。語形のあとにまた語形を作る連鎖は許さない。
    const cInfo = CONNECTORS[s];
    if (cInfo.form && !formWord && prevInfo
      && (!cInfo.formWords || cInfo.formWords.has(prev))) {
      formWord = { text: prev + s, pos: cInfo.form };
    } else {
      formWord = null;
    }

    // 規則 4 … 接続詞のあとに名詞が来るなら、連体形でなければならない。
    //   「業火を斬く剣」… 連用形「〜く」のあとに名詞は来ない。
    //   「妙に剣」     … 連用形「〜に」(妙に) も名詞を修飾しない。
    // adn (連体形か) で見る。格助詞と述語・連体はここを通る。
    // ただし に は「格」と「連用」の二役なので、結合元の品詞で分ける。
    //   業火 + に (格)  → あとに名詞が来てもよい (「業火に剣」…指向)
    //   妙   + に (連用) → あとに名詞は来ない (「妙に剣」は無い)
    const next = segs[i + 1];
    const nextInfo = next && !isConnector(next) ? dict?.[next] : null;
    const niAdverb = s === 'に' && acc.compounds.length
      && acc.compounds[acc.compounds.length - 1].pos === POS.naadj;
    if (nextInfo && nextInfo.pos === POS.noun
      && (!adnominalAt(segs, i) || niAdverb)) {
      return fail('connnoun',
        `接続詞「${s}」のあとに名詞「${next}」は置けない。`
        + '連用形「〜く」「〜に」・続用形「〜し」「〜り」は名詞を修飾しない。'
        + '「〜い」「〜な」「〜される」を使うこと。',
        acc);
    }

    // 規則 5 … 「〜を」は目的語が要る。後ろに用言が 無ければ壊れた文。
    //   「貫通を剣」… をの後ろに名詞。日本語に無い。
    if (CONNECTORS[s].obj) {
      // 動詞かどうかは品詞で判定する。cat が verb でも「する」-体言 (貫・爆裂) は
      // ここで動詞として受ける。効果語でも品詞が用言なら (回) 目的語を取れる。
      // 名詞の語でも「述語になる接続詞が後ろに続く」なら動詞として働く。
      //   「焔を蝕む」… 蝕(体言) + む = 「焔を蝕む」✓
      //   「毒を感する」… 感(する-名詞) + する ✓
      const verb = nextInfo && (nextInfo.cat === 'verb' || nextInfo.pos === POS.verb
        || CONNECT_ORDER.some((c) => PREDICATE_CONNECTORS.has(c) && canConnect(nextInfo, c)));
      if (!verb) {
        return fail('noobject',
          `接続詞「${s}」のあとに動詞が無い。`
          + '「〜を」は目的語を取るので、そのあとに動作 (斬・貫・焼…) が要る。',
          acc);
      }
    }
  }

  return { ok: true, reason: '', reasonText: '', ...acc };
}
