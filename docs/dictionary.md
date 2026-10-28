# 熟語の出典と生成

`js/data/words.compounds.js` は **自動生成** です。手で編集しないでください。
手で熟語を足すときは `js/data/words.phrase.js` に書きます（生成分より優先されます）。

## 辞書

| 項目 | 内容 |
| --- | --- |
| 名前 | JMdict |
| 提供 | Electronic Dictionary Research and Development Group (EDRDG) |
| 入手 | http://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz |
| 説明 | https://www.edrdg.org/jmdict/j_jmdict.html |
| ライセンス | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/deed.ja) |

JMdict は無料で再配布できる日本語辞書です。**CC BY-SA 4.0** なので、
ここから作った熟語の一覧（`js/data/words.compounds.js`）も同じ条件で扱います。
ゲーム本体のコード（MIT）とは別扱いです。

## 何を載せているか

語彙の語（1 文字の漢字 681 語）を 2〜4 個つないだ文字列のうち、
**JMdict に名詞として載っているものだけ** を熟語として登録しています。

- すべての文字が語彙の語であること（ゲーム内で必ず作れる）。
- 名詞（サ変名詞「〜する」を含む）であること。動詞の活用形は語の側で作る。
- 固有名詞（地名・人名）、古語・廃語・稀な語、かな表記だけの語、俗語・卑語は除く。
- `words.phrase.js` に手で書いた熟語は除く（そちらが優先）。

効果は **構成語の効果の和 × 0.5** です。語の意味がそのまま武器の性質になる、
というこのゲームの原則を熟語にも通すためで、手で書いた名のある熟語より弱くしてあります。

## 再生成

```bash
# 辞書を取る (約 10MB)
curl -O http://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz

# 生成 (js/data/words.compounds.js を書き換える)
python3 tools/mine-compounds.py JMdict_e.gz

# 検証
npm test
```

語を足したり消したりしたら、必ず再生成して `npm test` を通してください。
辞書に載っていない熟語が欲しいときは `words.phrase.js` に手で書きます。

## 出典表示

公開ページの「遊び方」などに、次の一文を添えてください。

> 熟語の判定には JMdict (EDRDG, CC BY-SA 4.0) を使用しています。
