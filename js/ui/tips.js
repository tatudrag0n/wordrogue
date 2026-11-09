// ============================================================================
// ワードローグ — タブを初めて開いたときの短い説明
//
// 画面の中に長い説明を置くと、遊び慣れた人には毎回邪魔になる。
// そこで説明は
//   ・初めてそのタブを開いたとき (このファイル)
//   ・チュートリアル (js/ui/menus.js の #tutorial)
//   ・遊び方 (index.html の #howto。読み返したいとき用)
// に集め、タブには 1 行の要点だけを残す。
// 一度出したタブは save.d.tips[key] に記録し、2 回目からは出さない。
// もう一度読みたいときは、各タブ右上の「?」からいつでも開ける。
// ============================================================================

import { $, el, clear } from '../core/util.js?v=1.50';

/**
 * タブごとの案内。items は [見出し, 本文]。
 * **ここを増やしすぎない**。長くなるならチュートリアルへ書く。
 */
export const TIPS = {
  forge: {
    title: '言葉鍛冶',
    lead: '語を並べて文を作る。文が成り立たないと、その武器は無効。',
    items: [
      ['置く', '語彙の語をタップしてから文の行をタップ。ドラッグなら、落とした位置に入る。'],
      ['接続詞', '文の語をタップすると切り替わる。語の右の接続詞のマスからは一覧で選べる。'],
      ['外す・戻す', '文の語を語彙へドラッグすると戻る。「戻す」で直前の操作を 1 つ取り消せる。'],
    ],
  },
  grow: {
    title: '強化 — 部位に語を入れる',
    lead: '頭・手・胸・胴・足の 7 部位に語を入れて、体そのものを強くする。',
    items: [
      ['置く', '「所持語」の一覧から語をタップ → 部位の行をタップ。ドラッグで直接置いてもよい。'],
      ['効き方', '1 部位は 10 文字の 1 文。文が成り立ち、語の意味が部位に合うと効果が出る。'],
      ['入れ替え', '語はドラッグで並べ替え・別の部位へ移動。間違えたら「戻す」。'],
    ],
  },
  words: {
    title: '書庫 — 言葉くじと言葉デッキ',
    lead: '言玉で言葉くじを引いて語を増やし、持ち込む語を選ぶ。',
    items: [
      ['言葉くじ', '同じ語を引くとランクが上がり、効果は最大 1.6 倍になる。'],
      ['言葉デッキ', '戦闘開始時の語彙になる語。押すと出し入れできる (最低 10 語)。'],
      ['言玉', 'ステージクリアと、敵の文を崩した数で貯まる。'],
    ],
  },
  dict: {
    title: '辞書',
    lead: 'すべての語の意味と効果を調べられる。開いている間は時間が止まる。',
    items: [
      ['探す', '上のタブで種類を絞り、検索欄で語を探せる。'],
      ['読み方', '「威力 +2」は武器の文で効く効果。「体」が付く行は部位で効く効果。'],
      ['鍛冶の上から', '言葉鍛冶の上に重ねて開いても、鍛冶は閉じない。'],
    ],
  },
};

export class Tips {
  /** @param {{save?:object, audio?:object}} opt */
  constructor(opt = {}) {
    this.save = opt.save;
    this.audio = opt.audio;
    this.root = $('#tabHelp');
    this.titleEl = $('#tabHelpTitle');
    this.leadEl = $('#tabHelpLead');
    this.bodyEl = $('#tabHelpBody');
    this.closeEls = [$('#tabHelpClose'), $('#tabHelpOk')].filter(Boolean);
    for (const b of this.closeEls) b.addEventListener('click', () => this.close());
    // 幕の外を押しても閉じる。
    this.root?.addEventListener('click', (e) => {
      if (e.target === this.root) this.close();
    });
    /** いま開いているタブのキー。 */
    this.key = null;
  }

  isOpen() {
    return !!this.root && !this.root.hidden;
  }

  /** 記録済みか (最小 DOM で Save が無いときは「見た」扱いにして出さない)。 */
  seen(key) {
    return !this.save || this.save.seenTip(key);
  }

  /** 初めてのタブなら説明を出す。出したら true。 */
  maybe(key) {
    if (!TIPS[key] || this.seen(key)) return false;
    return this.open(key);
  }

  /** 説明を開く (「?」ボタンからは何度でも)。 */
  open(key) {
    const tip = TIPS[key];
    if (!tip || !this.root) return false;
    this.key = key;
    if (this.titleEl) this.titleEl.textContent = tip.title;
    if (this.leadEl) this.leadEl.textContent = tip.lead || '';
    if (this.bodyEl) {
      clear(this.bodyEl);
      for (const [label, text] of tip.items) {
        this.bodyEl.append(el('li', {},
          el('b', {}, label),
          el('span', {}, text),
        ));
      }
    }
    this.root.hidden = false;
    this.root.scrollTop = 0;
    this.save?.markTip?.(key);
    this.audio?.uiOpen?.();
    return true;
  }

  close() {
    if (!this.isOpen()) return false;
    this.root.hidden = true;
    this.key = null;
    this.audio?.uiClose?.();
    return true;
  }
}
