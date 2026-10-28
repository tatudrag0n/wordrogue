#!/usr/bin/env python3
"""語彙の総当たりから、辞書に実在する熟語だけを抜き出して登録する。

辞書:  JMdict (EDRDG)  http://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz
        Creative Commons Attribution-ShareAlike 4.0 (CC BY-SA 4.0)
        出典と条件は docs/dictionary.md を見ること。

    python3 tools/mine-compounds.py /path/to/JMdict_e.gz

何をするか:
  1. js/data/words.core.js の語テーブルから、語・属性・効果を読む。
  2. JMdict の漢字見出しを、**ゲームの語だけで書ける熟語**に絞る。
     ・2〜4 文字。すべての文字が語彙の語。
     ・名詞 (サ変名詞「〜する」を含む)。固有名詞・古語・俗語などは除く。
     ・すでに words.phrase.js に手で書いた熟語は除く (そちらが優先)。
  3. 効果は構成語の効果から導く (意味がそのまま武器の性質になる)。
       熟語の効果 = 構成語の効果の和 × 0.5
     手で書いた熟語より弱くして、名のある熟語の格を保つ。
  4. js/data/words.compounds.js を書く。

出力は自動生成。手で直さないこと (直すと次の生成で消える)。
"""
import gzip
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CORE_JS = ROOT / 'js' / 'data' / 'words.core.js'
PHRASE_JS = ROOT / 'js' / 'data' / 'words.phrase.js'
LABEL_JS = ROOT / 'js' / 'ui' / 'labels.js'
OUT_JS = ROOT / 'js' / 'data' / 'words.compounds.js'

# 熟語にしない語 (JMdict の misc タグ)。
BAD_MISC = (
    'archaic', 'obsolete', 'obscure', 'rare', 'dated', 'ateji', 'ik',
    'word usually written using kana alone', 'abbreviation', 'colloquial',
    'slang', 'vulgar', 'sensitive', 'X', 'person', 'place', 'work',
    'product', 'company', 'given', 'surname', 'character', 'creature',
    'event', 'legend', 'myth', 'fiction', 'group', 'organization',
    'deity', 'ship', 'service', 'food', 'clothing', 'family',
)
# 固有名詞 (地名・人名) は武器にしない。
BAD_POS = ('proper noun',)

# 構成語の効果を熟語に移すときの倍率。手書きの熟語より弱くするための係数。
COMPOUND_SCALE = 0.5
# 熟語 1 つに載せる効果の数。説明と UI が長くなりすぎないように。
MAX_FX = 4
MIN_FX = 0.05
# 熟語の最大文字数。words.js の MAX_COMPOUND と合わせる。
MAX_LEN = 4


def read_words():
    """words.core.js から 語 -> {cat, el, fx} を読む。"""
    src = CORE_JS.read_text(encoding='utf-8')
    words = {}
    for line in src.splitlines():
        row = line.strip()
        if not row or row.startswith('#') or row.startswith('//'):
            continue
        m = re.match(r'^(\S{1,2})\s+(element|phenom|form|modifier|verb)\s+(\S+)\s*(.*)$', row)
        if not m:
            continue
        text, cat, _el, rest = m.group(1), m.group(2), m.group(3), m.group(4)
        fx = {}
        for tok in rest.split():
            mm = re.match(r'^(?:p\.)?([A-Za-z]+)([+-][\d.]+)$', tok)
            if not mm:
                continue
            if tok.startswith('p.'):
                continue          # 体だけに効く効果は武器の熟語に載せない
            fx[mm.group(1)] = fx.get(mm.group(1), 0) + float(mm.group(2))
        words[text] = {'cat': cat, 'fx': fx}
    return words


def read_labels():
    """labels.js の FX_LABEL を読む (説明文の日本語名)。"""
    src = LABEL_JS.read_text(encoding='utf-8')
    m = re.search(r'export const FX_LABEL = \{(.*?)\n\};', src, re.S)
    if not m:
        return {}
    out = {}
    for k, v in re.findall(r"(\w+):\s*'([^']*)'", m.group(1)):
        out[k] = v
    return out


def read_authored():
    """words.phrase.js に手で書いた熟語。生成侧で上書きしない。"""
    src = PHRASE_JS.read_text(encoding='utf-8')
    return set(re.findall(r"^add2?\('([^']+)'", src, re.M))


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    path = sys.argv[1]

    words = read_words()
    labels = read_labels()
    authored = read_authored()
    print(f'語彙 {len(words)} 語 / 手書きの熟語 {len(authored)} / ラベル {len(labels)}')

    entries = {}
    for _ev, elem in ET.iterparse(gzip.open(path, 'rb'), events=('end',)):
        if elem.tag != 'entry':
            continue
        kebs = [k.text for k in elem.findall('k_ele/keb') if k.text]
        poss = [p.text or '' for p in elem.findall('sense/pos')]
        misc = [m.text or '' for m in elem.findall('sense/misc')]
        for k in kebs:
            if not (2 <= len(k) <= MAX_LEN):
                continue
            if not all(c in words for c in k):
                continue
            if any(b in p for p in poss for b in BAD_POS):
                continue
            if any(b in m for m in misc for b in BAD_MISC):
                continue
            # 名詞だけを熟語にする。動詞の活用形 (斬る など) は語の側で作る。
            if not any('noun' in p for p in poss):
                continue
            entries.setdefault(k, True)
        elem.clear()

    print(f'辞書に実在する熟語: {len(entries)}')

    out = []
    for phrase in sorted(entries):
        if phrase in authored:
            continue
        segs = list(phrase)
        fx = {}
        for s in segs:
            for k, v in words[s]['fx'].items():
                fx[k] = fx.get(k, 0) + v
        scaled = {}
        for k, v in fx.items():
            v = round(v * COMPOUND_SCALE, 2)
            if abs(v) >= MIN_FX:
                scaled[k] = v
        if not scaled:
            continue
        top = sorted(scaled.items(), key=lambda kv: -abs(kv[1]))[:MAX_FX]
        fx_out = dict(sorted(top))

        parts = []
        for k, v in top:
            label = labels.get(k, k)
            parts.append(f'{label}{v:+.2f}'.replace('.00', '').replace('0+', '+'))
        desc = f'{"と".join(segs)}の熟語。' + ' '.join(parts)
        out.append({'phrase': phrase, 'desc': desc, 'fx': fx_out})

    print(f'登録する熟語: {len(out)} (2 字 {sum(1 for o in out if len(o["phrase"]) == 2)}'
          f' / 3 字 {sum(1 for o in out if len(o["phrase"]) == 3)}'
          f' / 4 字 {sum(1 for o in out if len(o["phrase"]) == 4)})')

    lines = [
        '// ============================================================================',
        '// ワードローグ — 辞書から拾った熟語 (自動生成)',
        '//',
        '// このファイルは tools/mine-compounds.py が書く。手で編集しないこと。',
        '//   元データ: JMdict (EDRDG)  http://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz',
        '//   ライセンス: CC BY-SA 4.0 — 出典と条件は docs/dictionary.md を見ること。',
        '//',
        '// 語彙の語 2〜4 個で書ける熟語のうち、辞書に名詞として載っているものだけ。',
        '// 効果は構成語の効果の和 × 0.5。意味がそのまま武器の性質になる。',
        '// 手で書いた熟語 (words.phrase.js) が常に優先する。',
        '// ============================================================================',
        '',
        '/** 生成元の辞書。 */',
        "export const DICT_NAME = 'JMdict';",
        "export const DICT_LICENSE = 'CC BY-SA 4.0';",
        "export const DICT_SOURCE = 'https://www.edrdg.org/jmdict/j_jmdict.html';",
        '',
        '/** 辞書に実在する熟語。効果は構成語から導いたもの。 */',
        'export const DICT_COMPOUNDS = [',
    ]
    for o in out:
        lines.append(f"  {{ phrase: '{o['phrase']}', desc: '{o['desc']}', fx: {json.dumps(o['fx'], ensure_ascii=False)} }},")
    lines.append('];')
    lines.append('')
    OUT_JS.write_text('\n'.join(lines), encoding='utf-8')
    print(f'書いた: {OUT_JS.relative_to(ROOT)}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
