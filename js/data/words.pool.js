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

/** 名詞が共通で持つ格の接続詞。 */
export const NOUN_POOL_SPEC = 'の:case>noun を:case>verb に:case>pred へ:case>pred';

const RAW_POOL = `
# ── 属性 (既定は体言 +N。形を持つ語だけ書く) ──
熱  a   い:adn+ く:adv+ +N
烈  n   しい:adn+ しく:adv+
震  n   える:adn*x えし:adn*x えて:advx
蝕  n   む:adn* まれた:adn*p
輝  n   く:adn*x ける:adn*x
耀  n   く:adn*x
霞  n   む:adn*x +N
青  a   い:adn+ く:adv+ +N
白  a   い:adn+ く:adv+ +N
赤  a   い:adn+ く:adv+ +N
暗  a   い:adn+ く:adv+
黒  a   い:adn+ く:adv+ +N
突  n   く:adn* き:adv*
疾  n   き:adn
翔  n   ける:adn*x
錬  n   る:adn* +N
呪  n   う:adn* われた:adn*p いの:case>noun いを:case>verb
流  n   れる:adn*x す:adn*
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
巨  a   きな:adn+ きい:adn+
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
奇  na  なる:adn+
雅  na  な:adn+ やかな:adn+
華  na  やかな:adn+ やかに:adv+
密  na  な:adn+ に:adv+
壮  na  なる:adn+
燦  na  なる:adn+ めく:adn*x
聖  na  なる:adn+ +N
確  na  かな:adn+ かに:adv+
滑  na  らかな:adn+ らかに:adv+ る:adn*x
妙  na  な:adn+ に:adv+
急  na  な:adn+ に:adv+ ぐ:adn*x

# ── 効果語 (体言だが動詞・副詞の形を持つ) ──
眠  n   る:adn*x れる:adn*x
香  n   る:adn*x +N
無  n   き:adn +N
豪  n   の:case>noun
真  n   の:case>noun なる:adn+
素  n   の:case>noun
剛  n   の:case>noun
活  n   きる:adn*x かす:adn*
準  n   ずる:adn*x
適  n   う:adn*x した:adn*x
圧  n   する:adn* +N
律  n   する:adn*
引  n   く:adn* き:adv*
導  n   く:adn* き:adv* かれた:adn*p
徹  n   する:adn*x
執  n   る:adn* する:adn*
瞬  n   く:adn*x
会  n   う:adn*x の:case>noun
必  n   ず:adv
反  n   る:adn*x する:adn*x
退  n   く:adn*x ける:adn*
衰  n   える:adn*x
合  n   う:adn*x する:adn*x
再  n   び:adv
回  n   る:adn*x す:adn* り:adv* された:adn*p
続  n   く:adn*x ける:adn*
減  n   る:adn*x らす:adn*
特  n   に:adv
囲  n   む:adn* う:adn* まれた:adn*p
昂  n   る:adn* ぶる:adn*
打  n   つ:adn* ち:adv*
防  n   ぐ:adn*
撃  n   つ:adn* ち:adv*
連  n   なる:adn*x ねる:adn*
湧  n   く:adn*x
潤  n   う:adn*x す:adn*
発  n   する:adn* +N
穢  n   れた:adn*x す:adn*
爛  n   れる:adn*x れた:adn*x れて:advx
護  n   る:adn*
結  n   ぶ:adn* ばれた:adn*p
穿  n   つ:adn* ち:adv*
通  n   る:adn*x す:adn*

# ── 核語 ──
志  n   す:adn* +N
巧  na  みな:adn+ みに:adv+
守  n   る:adn*
感  n   じる:adn*

# ── 動詞 (全部書く) ──
爆  v   ぜる:adn*x ぜて:advx
殺  v   す:adn* された:adn*p して:adv
滅  v   ぼす:adn* びる:adn*x ぼされた:adn*p ぼして:adv びて:advx
轟  v   く:adn*x いて:advx
侵  v   す:adn* された:adn*p して:adv
炸  v   ぜる:adn*x ぜて:advx
破  v   る:adn* れる:adn*x られた:adn*p って:adv れて:advx
沸  v   く:adn*x かす:adn* かされた:adn*p いて:advx かして:adv
凍  v   る:adn*x える:adn*x って:advx えて:advx
燃  v   える:adn*x やす:adn* やされた:adn*p えて:advx やして:adv
焼  v   く:adn* ける:adn*x かれた:adn*p いて:adv けて:advx
焦  v   げる:adn*x がす:adn* がされた:adn*p げて:advx がして:adv
溶  v   ける:adn*x かす:adn* かされた:adn*p けて:advx かして:adv
融  v   ける:adn*x かす:adn* かされた:adn*p けて:advx かして:adv
蒸  v   す:adn* された:adn*p して:adv
貫  v   く:adn* かれた:adn*p いて:adv き:adv*
射  v   る:adn* られた:adn*p て:adv
斬  v   る:adn* られた:adn*p り:adv* って:adv
砕  v   く:adn* ける:adn*x かれた:adn*p いて:adv けて:advx
殴  v   る:adn* られた:adn*p って:adv
渦  n   +N
乱  n   れる:adn*x れた:adn*x れて:advx +N
還  n   る:adn*x +N
散  v   る:adn*x らす:adn* らされた:adn*p って:advx らして:adv
伸  v   びる:adn*x ばす:adn* ばされた:adn*p びて:advx ばして:adv
縮  v   む:adn*x める:adn* められた:adn*p んで:advx めて:adv
跳  v   ねる:adn*x ぶ:adn*x ねて:advx んで:advx
響  v   く:adn*x いて:advx
裂  v   く:adn* ける:adn*x かれた:adn*p いて:adv けて:advx
舞  v   う:adn*x って:advx い:adv*x
吸  v   う:adn* われた:adn*p って:adv
吐  v   く:adn* かれた:adn*p いて:adv
潜  v   む:adn*x る:adn*x んで:advx って:advx
浮  v   く:adn*x かぶ:adn*x いて:advx んで:advx
沈  v   む:adn*x める:adn* められた:adn*p んで:advx めて:adv
昇  v   る:adn*x って:advx
降  v   る:adn*x って:advx
挟  v   む:adn* まれた:adn*p んで:adv
掴  v   む:adn* まれた:adn*p んで:adv
掘  v   る:adn* られた:adn*p って:adv
叩  v   く:adn* かれた:adn*p いて:adv
踏  v   む:adn* まれた:adn*p んで:adv み:adv*
擦  v   る:adn* れる:adn*x られた:adn*p って:adv れて:advx
潰  v   す:adn* れる:adn*x された:adn*p して:adv れて:advx
嚇  v   す:adn* された:adn*p して:adv
縛  v   る:adn* られた:adn*p って:adv
鍛  v   える:adn* えた:adn* えて:adv
研  v   ぐ:adn* ぎ:adv がれた:adn*p
駆  v   ける:adn*x けた:adn*x け:adv*x
浴  v   びる:adn* びた:adn* びて:adv
浸  v   す:adn* した:adn* された:adn*p して:adv
錆  v   びる:adn*x びた:adn*x びて:advx
癒  v   す:adn* える:adn*x

# ── 中二病の動詞 ──
絶  v   つ:adn* たれた:adn*p て:adv える:adn*x えて:advx
終  v   わる:adn*x わった:adn*x わり:advx わって:advx える:adn* えて:adv
戮  v   する:adn* された:adn*p
屠  v   る:adn* られた:adn*p り:adv* って:adv
討  v   つ:adn* たれた:adn*p ち:adv* って:adv
刈  v   る:adn* られた:adn*p り:adv* って:adv
祓  v   う:adn* われた:adn*p い:adv* って:adv
祟  v   る:adn*x られた:adn*p り:advx って:advx
葬  v   る:adn* られた:adn*p り:adv* って:adv
刺  v   す:adn* された:adn*p して:adv
刻  v   む:adn* まれた:adn*p み:adv* んで:adv
煉  v   る:adn* られた:adn*p り:adv* って:adv
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
  const spec = (PHRASE_BONUS[key].pool || '').trim();
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
