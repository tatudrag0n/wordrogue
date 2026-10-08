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
//   +N … NOUN_POOL (の・を・に・へ) をまとめて足す。
//
// 送り仮名は 1〜3 字 (最長「らかな」「やかな」「られた」)。辞書の最長 5 字・
// 文の 10 字の上限には収まる。かなの並びは必ず 1 つの送り仮名なので、
// 分割 (最少語数の DP) で割れ方が揺れることは無い。
// ============================================================================

/** 名詞が共通で持つ格の接続詞。 */
export const NOUN_POOL_SPEC = 'の:case>noun を:case>verb に:case>pred へ:case>pred';

const RAW_POOL = `
# ── 属性 (既定は体言 +N。形を持つ語だけ書く) ──
熱  a   い:adn+ く:adv+ +N
烈  n   しい:adn+ しく:adv+
震  n   える:adn*
蝕  n   む:adn* まれた:adn*
輝  n   く:adn* ける:adn*
耀  n   く:adn*
霞  n   む:adn* +N
青  a   い:adn+ く:adv+ +N
白  a   い:adn+ く:adv+ +N
赤  a   い:adn+ く:adv+ +N
暗  a   い:adn+ く:adv+
黒  a   い:adn+ く:adv+ +N
突  n   く:adn* き:adv*
疾  n   き:adn
翔  n   ける:adn*
錬  n   る:adn* +N
呪  n   う:adn* われた:adn* いの:case>noun いを:case>verb
流  n   れる:adn* す:adn*

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
荒  a   い:adn+ く:adv+ ぶる:adn*
寒  a   い:adn+ く:adv+
温  a   かい:adn+ かな:adn+ かく:adv+
厚  a   い:adn+ く:adv+
軽  a   い:adn+ く:adv+ やかな:adn+
鈍  a   い:adn+ く:adv+
冷  a   たい:adn+ たく:adv+ える:adn*
正  a   しい:adn+ しく:adv+
賢  a   い:adn+ く:adv+
巨  a   きな:adn+ きい:adn+
酷  a   い:adn+ く:adv+
清  a   い:adn+ く:adv+ らかな:adn+
宏  a   い:adn+ く:adv+
斉  a   しい:adn+ しく:adv+
程  a   よい:adn+ よく:adv+
固  a   い:adn+ く:adv+ める:adn*
優  a   しい:adn+ しく:adv+ れた:adn*
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
確  na  かな:adn+ かに:adv+
滑  na  らかな:adn+ らかに:adv+ る:adn*
妙  na  な:adn+ に:adv+
急  na  な:adn+ に:adv+ ぐ:adn*

# ── 効果語 (体言だが動詞・副詞の形を持つ) ──
眠  n   る:adn* れる:adn*
香  n   る:adn* +N
無  n   き:adn +N
豪  n   の:case>noun
真  n   の:case>noun なる:adn+
素  n   の:case>noun
剛  n   の:case>noun
活  n   きる:adn* かす:adn*
準  n   ずる:adn*
適  n   う:adn* した:adn*
圧  n   する:adn* +N
律  n   する:adn*
引  n   く:adn* き:adv*
導  n   く:adn* き:adv* かれた:adn*
徹  n   する:adn*
執  n   る:adn* する:adn*
瞬  n   く:adn*
会  n   う:adn* の:case>noun
必  n   ず:adv
反  n   る:adn* する:adn*
退  n   く:adn* ける:adn*
衰  n   える:adn*
合  n   う:adn* する:adn*
再  n   び:adv
回  n   る:adn* す:adn* り:adv* された:adn*
続  n   く:adn* ける:adn*
減  n   る:adn* らす:adn*
特  n   に:adv
囲  n   む:adn* う:adn* まれた:adn*
昂  n   る:adn* ぶる:adn*
打  n   つ:adn* ち:adv*
防  n   ぐ:adn*
撃  n   つ:adn* ち:adv*
連  n   なる:adn* ねる:adn*
湧  n   く:adn*
潤  n   う:adn* す:adn*
発  n   する:adn* +N
穢  n   れた:adn* す:adn*
護  n   る:adn*
結  n   ぶ:adn* ばれた:adn*
穿  n   つ:adn*
通  n   る:adn* す:adn*

# ── 自身 ──
頑  na  な:adn+ に:adv+
健  na  やかな:adn+ やかに:adv+
走  n   る:adn*
戒  n   める:adn*
癒  n   す:adn* える:adn*
書  n   く:adn* +N
察  n   する:adn*
永  a   い:adn+ く:adv+
楽  a   しい:adn+ しく:adv+ +N
幸  na  せな:adn+ の:case>noun

# ── 核語 ──
志  n   す:adn* +N
巧  na  みな:adn+ みに:adv+
守  n   る:adn*
感  n   じる:adn*

# ── 動詞 (全部書く) ──
爆  v   ぜる:adn*
殺  v   す:adn* された:adn*
滅  v   ぼす:adn* びる:adn*
轟  v   く:adn*
侵  v   す:adn* された:adn*
炸  v   ぜる:adn*
破  v   る:adn* れる:adn* られた:adn*
沸  v   く:adn* かす:adn*
凍  v   る:adn* える:adn*
燃  v   える:adn* やす:adn*
焼  v   く:adn* ける:adn* かれた:adn*
焦  v   げる:adn* がす:adn*
溶  v   ける:adn* かす:adn*
融  v   ける:adn* かす:adn*
蒸  v   す:adn* された:adn*
貫  v   く:adn* かれた:adn*
射  v   る:adn* られた:adn*
斬  v   る:adn* られた:adn* り:adv*
砕  v   く:adn* ける:adn* かれた:adn*
殴  v   る:adn* られた:adn*
渦  n   +N
散  v   る:adn* らす:adn*
伸  v   びる:adn* ばす:adn*
縮  v   む:adn* める:adn*
跳  v   ねる:adn* ぶ:adn*
響  v   く:adn*
裂  v   く:adn* ける:adn* かれた:adn*
舞  v   う:adn*
吸  v   う:adn* われた:adn*
吐  v   く:adn*
潜  v   む:adn* る:adn*
浮  v   く:adn* かぶ:adn*
沈  v   む:adn* める:adn*
昇  v   る:adn*
降  v   る:adn*
挟  v   む:adn* まれた:adn*
掴  v   む:adn* まれた:adn*
掘  v   る:adn*
叩  v   く:adn* かれた:adn*
踏  v   む:adn* まれた:adn*
嗅  v   ぐ:adn*
舐  v   める:adn*
跨  v   ぐ:adn*
擦  v   る:adn* れる:adn*
潰  v   す:adn* れる:adn* された:adn*
嚇  v   す:adn*
縛  v   る:adn* られた:adn*
撫  v   でる:adn*
`;

/** 品詞の略号。 */
export const POS_CODE = { n: '体言', a: '形容', na: '形動', v: '用言' };

/**
 * 形 1 つを読む。「る:adn*」→ { k:'る', role:'adn', pred:true }
 * @returns {{k:string, role:string, next?:string, pred?:boolean, adj?:boolean}}
 */
export function parseForm(tok) {
  const m = /^([ぁ-ん]+):(adn|adv|case>(?:noun|verb|pred))([*+]?)$/.exec(tok);
  if (!m) throw new Error(`接続詞プールの書式が不正: ${tok}`);
  const [, k, roleRaw, mark] = m;
  const [role, next] = roleRaw.split('>');
  const e = { k, role };
  if (next) e.next = next;
  if (mark === '*') e.pred = true;
  if (mark === '+') e.adj = true;
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
