# ============================================================================
# ワードローグ — BGM 生成 (stage1〜19 + boss)
#
# 使い方:  python tools/bgm.py [--out DIR] [--only stage1,boss]
#
# 1.71 で作曲から作り直した。旧版は全曲が同じテンプレートで、旋律は
# 音階のランダムウォークだったので、どの曲も同じに聞こえた。
# 新版は「章ごとの主題 (モチーフ)」を持つ:
#
#   章 (物語の章立てと一致) ごとに、8 分音符 16 個ぶん (2 小節) の
#   固定譜面の主題 A と、対になるフレーズ B を 1 つずつ持つ。
#   1 曲 = 8 小節 = [A / A' / B / A] の 4 ブロックで、各ブロックは
#   和声の根音の上へ主題を移調して置く。A' は主題の締めくくりだけを
#   変えた変奏 (締めの形はステージごとに 3 種から選ぶ)。
#   ステージごとの違いは、根音・テンポ・主役の楽器 (笛/箏/二重)・
#   打楽器と和声の厚み・音階の差し替えで付ける。
#   ボス曲は第 4 章の主題を陰旋法に落とした暗い変奏。
#
#   ランダムは装飾 (和声の箏・16 分の走り) だけに使い、種は曲ごとに
#   固定するので、再実行しても同じファイルが出来る (決定的)。
#
# 音はステレオ 32kHz / 16bit。主旋律は中央、和声と残響は左右へ。
# 全曲 RMS をそろえて正規化するので、曲ごとの音量差は無い。
# ループは「末尾の余韻を先頭へ折り返す」ので、継ぎ目が途切れない。
#
# 依存なし (標準ライブラリのみ)。
# ============================================================================
import argparse
import math
import random
import struct
import sys
import wave
from array import array
from pathlib import Path

SR = 32000
ROOT = Path(__file__).resolve().parent.parent

HIRAJOSHI = [0, 2, 3, 7, 8]      # 平調子。物哀り。
MINOR_PENT = [0, 3, 5, 7, 10]    # 和風の短音階。
MAJOR_PENT = [0, 2, 4, 7, 9]     # 明るい長音階。
IN_SEN = [0, 1, 5, 7, 10]        # 陰旋法。張りつめた静けさ。

# ── 章ごとの主題 ────────────────────────────────────────────────────────────
# 主題は「音階の段数 (0 が根音、5 で 1 オクターブ上) + 8 分音符の長さ」の
# 列で書く。2 小節 = 16 個の 8 分音符ぶん。B は対句。
# prog は 4 ブロック [A, A', B, A] それぞれの和声の根 (段数)。
CHAPTERS = {
    1: {  # 第1章 旅立ち — 上がって、落ち着く旋律。
        'scale': MINOR_PENT,
        'motif': [(4, 1), (5, 1), (4, 1), (2, 1), (3, 2), (2, 1), (1, 1),
                  (2, 1), (3, 1), (4, 2), (2, 2), (0, 2)],
        'motif_b': [(5, 2), (4, 1), (3, 1), (4, 2), (2, 2), (3, 1), (2, 1),
                    (1, 1), (0, 1), (1, 2), (0, 2)],
        'prog': [0, -2, 3, 0],
    },
    2: {  # 第2章 言葉の源 — 半音の擦りが緊張を作る、詰まった旋律。
        'scale': IN_SEN,
        'motif': [(0, 2), (1, 1), (0, 1), (2, 2), (1, 2), (0, 1), (1, 1),
                  (2, 1), (4, 1), (3, 2), (2, 2)],
        'motif_b': [(4, 2), (3, 1), (2, 1), (1, 2), (2, 2), (4, 1), (3, 1),
                    (2, 1), (1, 1), (0, 4)],
        'prog': [0, 4, 1, 0],
    },
    3: {  # 第3章 静まる世界 — 長い音の、疎な旋律。
        'scale': HIRAJOSHI,
        'motif': [(2, 3), (1, 1), (0, 2), (1, 2), (2, 2), (4, 2), (3, 2),
                  (2, 2)],
        'motif_b': [(4, 3), (3, 1), (2, 2), (1, 2), (0, 3), (1, 1), (2, 4)],
        'prog': [0, 2, 4, 0],
    },
    4: {  # 第4章 再会 — 駆け上がって開ける旋律。
        'scale': MAJOR_PENT,
        'motif': [(0, 1), (2, 1), (4, 1), (5, 1), (4, 2), (2, 1), (1, 1),
                  (2, 1), (4, 1), (5, 1), (7, 1), (4, 4)],
        'motif_b': [(7, 1), (5, 1), (4, 1), (2, 1), (4, 2), (5, 2), (7, 1),
                    (5, 1), (4, 1), (2, 1), (1, 2), (2, 2)],
        'prog': [0, 3, 4, 0],
    },
}

# A' の締めくくり (主題の 12/16 以降を差し替える 4 個ぶん)。
CADENCES = {
    0: [(2, 1), (4, 1), (5, 2)],   # 高く解ける。
    1: [(3, 1), (1, 1), (0, 2)],   # 低く落ち着く。
    # 2 は主題の頭 2 音を繰り返して根音へ (コード側で組み立てる)。
}

# (ステージ, 名前, 根音 MIDI, BPM, 濃さ 0..1, 主役, 締めの形, 音階の差し替え)
# 章は物語の章立て (1-5 / 6-9 / 10-15 / 16-19) から決まる。
TRACKS = [
    (1,  '村の外れ',      50, 112, 0.35, 'flute', 0, None),
    (2,  '森の奥',        50, 114, 0.40, 'flute', 1, None),
    (3,  '廃村',          48, 116, 0.42, 'koto',  2, None),
    (4,  '地下墓場',      45, 118, 0.45, 'flute', 1, None),
    (5,  '城塞外壁',      47, 120, 0.48, 'duo',   0, None),
    (6,  '深淵の魔王城',  43, 122, 0.50, 'koto',  1, None),
    (7,  '語書庫',        48, 120, 0.50, 'flute', 2, None),
    (8,  '韻律の塔',      50, 124, 0.55, 'duo',   0, MAJOR_PENT),
    (9,  '言葉の根源',    45, 126, 0.60, 'duo',   1, None),
    (10, '苔庭',          52, 124, 0.45, 'flute', 0, None),
    (11, '竹林の間',      50, 130, 0.55, 'koto',  1, None),
    (12, '水鏡の池',      48, 126, 0.50, 'flute', 2, None),
    (13, '枯山水',        45, 128, 0.55, 'koto',  0, None),
    (14, '灯籠の路',      46, 134, 0.60, 'duo',   1, None),
    (15, '霧の苑',        48, 132, 0.60, 'flute', 2, MAJOR_PENT),
    (16, '花筏の野',      50, 140, 0.70, 'duo',   0, None),
    (17, '月見の壇',      45, 136, 0.65, 'duo',   2, None),
    (18, '静寂の間',      43, 144, 0.75, 'duo',   1, None),
    (19, '言葉の庭',      45, 152, 0.85, 'duo',   0, None),
    ('boss', 'ボス',      41, 148, 0.92, 'duo',   1, IN_SEN),
]
BOSS_PROG = [0, 1, 4, 0]   # 第 4 章主題を陰旋法で。根のすぐ上の半音が圧す。


def chapter_of(stage):
    if stage == 'boss':
        return 4
    if stage <= 5:
        return 1
    if stage <= 9:
        return 2
    if stage <= 15:
        return 3
    return 4


def hz(midi):
    return 440.0 * (2.0 ** ((midi - 69) / 12.0))


def deg_semi(scale, d):
    """段数 → 半音。音階を巻いて数える (負の段数も下へ巻く)。"""
    n = len(scale)
    return scale[d % n] + 12 * (d // n)


# ── 楽器 (モノの粒。パンと音量は混ぜるときに付ける) ─────────────────────

_taiko_cache = {}


def taiko(freq=150, dur=0.30, vol=1.0):
    """和太鼓。叩いた瞬間に皮の張りが沈み、音程が落ちる。芯に低い正弦を足す。"""
    key = (freq, dur, vol)
    if key in _taiko_cache:
        return _taiko_cache[key]
    n = int(dur * SR)
    out = [0.0] * n
    for i in range(n):
        t = i / SR
        f = freq * (1.0 - 0.62 * min(1.0, t / 0.06))
        env = math.exp(-t * 16)
        s = math.sin(2 * math.pi * f * t) * env
        s += 0.5 * math.sin(2 * math.pi * freq * 0.5 * t) * math.exp(-t * 11)
        if t < 0.004:
            s += (1 - t / 0.004) * 0.55
        out[i] = s * vol
    _taiko_cache[key] = out
    return out


_snare_cache = None


def snare(dur=0.11, vol=1.0, tone=0.35):
    """スネア。ノイズの胴に、membrane の音を少し混ぜる。"""
    global _snare_cache
    if _snare_cache is not None and _snare_cache[0] == (dur, vol, tone):
        return _snare_cache[1]
    n = int(dur * SR)
    out = [0.0] * n
    rnd = random.Random(4127)
    prev = 0.0
    lp = 0.0
    for i in range(n):
        t = i / SR
        x = rnd.random() * 2 - 1
        hp = x - prev
        prev = x
        lp += (x - lp) * 0.42
        env = math.exp(-t * 30)
        s = hp * 0.8 + lp * tone
        out[i] = s * env * vol
    _snare_cache = ((dur, vol, tone), out)
    return out


_hat_cache = {}


def hat(dur=0.032, vol=1.0, open_=False):
    """ハイハット。開放は少し長く。"""
    key = (dur, vol, open_)
    if key in _hat_cache:
        return _hat_cache[key]
    n = int((0.09 if open_ else dur) * SR)
    out = [0.0] * n
    rnd = random.Random(99)
    prev = 0.0
    for i in range(n):
        x = rnd.random() * 2 - 1
        d = x - prev
        prev = x
        env = math.exp(-i / n * (7 if open_ else 9))
        out[i] = d * env * vol
    _hat_cache[key] = out
    return out


def bass(freq, dur, vol):
    """駆けるベース。基音 + 倍音 + 一オクターブ下の腹。軽く歪ませて芯を作る。"""
    n = int(dur * SR)
    out = [0.0] * n
    sub = 0.30 if freq >= 55 else 0.0
    for i in range(n):
        t = i / SR
        atk = min(1.0, t / 0.006)
        env = atk * math.exp(-t * 7.0 / dur)
        s = math.sin(2 * math.pi * freq * t)
        s += 0.45 * math.sin(2 * math.pi * freq * 2 * t) * math.exp(-t * 12 / dur)
        if sub:
            s += sub * math.sin(2 * math.pi * freq * 0.5 * t)
        s -= 0.10 * s ** 3
        out[i] = s * env * vol
    return out


def pluck(freq, dur, vol, seed=0, bright=1.0):
    """箏の撥弦。減衰する基音 + 倍音 (少し外して金属味) + 爪のノイズ。"""
    n = int(dur * SR)
    out = [0.0] * n
    rnd = random.Random(int(seed * 1e6) if seed else 7)
    for i in range(n):
        t = i / SR
        env = math.exp(-t * 5.2 / dur)
        vib = 1.0 + 0.0014 * math.sin(t * 2 * math.pi * 5.3 + seed)
        s = math.sin(2 * math.pi * freq * vib * t) * env
        s += 0.42 * bright * math.sin(2 * math.pi * freq * 2.005 * t) * math.exp(-t * 10 / dur)
        s += 0.18 * bright * math.sin(2 * math.pi * freq * 3.02 * t) * math.exp(-t * 15 / dur)
        s += 0.08 * bright * math.sin(2 * math.pi * freq * 4.16 * t) * math.exp(-t * 20 / dur)
        if t < 0.010:
            s += (rnd.random() * 2 - 1) * (1 - t / 0.010) * 0.45 * bright
        out[i] = s * vol
    return out


def flute(freq, dur, vol, seed=0):
    """笛。入りは半音弱くすくい上げ、遅れてビブラートが乗り、息の音が重なる。"""
    n = int(dur * SR)
    out = [0.0] * n
    rnd = random.Random(1000 + int(seed))
    lpv = 0.0
    ph = 0.0
    for i in range(n):
        t = i / SR
        # 息。低域に寄せたノイズが、音の包絡に沿って漏れる。
        lpv += ((rnd.random() * 2 - 1) - lpv) * 0.10
        # すくい上げ。最初の 70ms でわずかに低いところから滑り込む。
        scoop = 1.0 - 0.012 * math.exp(-t / 0.03)
        # ビブラートは鳴ってから遅れて深くなる。
        vd = 0.006 * min(1.0, max(0.0, (t - 0.12) / 0.25))
        vib = 1.0 + vd * math.sin(2 * math.pi * 5.2 * t + seed)
        ph += 2 * math.pi * freq * scoop * vib / SR
        a = min(1.0, t / 0.05)
        a = a * a * (3 - 2 * a)
        r = min(1.0, max(0.0, (dur - t) / (0.25 * dur)) * 1.6)
        env = a * r
        s = math.sin(ph) + 0.14 * math.sin(2 * ph) + 0.04 * math.sin(3 * ph)
        out[i] = (s + lpv * 0.55) * env * vol
    return out


def pad(freq, dur, vol):
    """薄い持続音。2 つの三角波をわずかに外して重ねる。静かな曲の下地。"""
    n = int(dur * SR)
    out = [0.0] * n
    for i in range(n):
        t = i / SR
        a = min(1.0, t / 0.8, (dur - t) / 0.8)
        s = math.sin(2 * math.pi * freq * t) + 0.6 * math.sin(2 * math.pi * freq * 1.003 * t)
        s += 0.3 * math.sin(2 * math.pi * freq * 2 * t)
        out[i] = s * a * vol
    return out


# ── 混ぜる ────────────────────────────────────────────────────────────────

def add(buf_l, buf_r, at, gen, pan=0.0, vol=1.0):
    """ステレオのバッファへ、等パワーのパンで粒を足す。"""
    i0 = int(at * SR)
    if i0 >= len(buf_l):
        return
    gl = math.sqrt(0.5 * (1.0 - pan)) * vol
    gr = math.sqrt(0.5 * (1.0 + pan)) * vol
    end = min(len(buf_l), i0 + len(gen))
    for i in range(i0, end):
        s = gen[i - i0]
        buf_l[i] += s * gl
        buf_r[i] += s * gr


def add_space(buf_l, buf_r):
    """左右で長さの違う遅延を交差して返す、安い残響。空間の幅を作る。"""
    n = len(buf_l)
    d1 = int(0.27 * SR)
    d2 = int(0.34 * SR)
    dl = [0.0] * d1
    dr = [0.0] * d2
    il = ir = 0
    lpl = lpr = 0.0
    fb = 0.22
    wet = 0.13
    for i in range(n):
        inl = buf_l[i]
        inr = buf_r[i]
        lpl += (dl[il] - lpl) * 0.35
        lpr += (dr[ir] - lpr) * 0.35
        buf_l[i] = inl + wet * lpr
        buf_r[i] = inr + wet * lpl
        dl[il] = inl + fb * lpr
        dr[ir] = inr + fb * lpl
        il = il + 1 if il + 1 < d1 else 0
        ir = ir + 1 if ir + 1 < d2 else 0


def vary_motif(motif, mvar):
    """A' 用。主題の前 12/16 を保ち、締めだけ差し替える。"""
    head = []
    pos = 0
    for (deg, ln) in motif:
        if pos + ln > 12:
            break
        head.append((deg, ln))
        pos += ln
    if mvar == 2:
        cad = [(motif[0][0], 1), (motif[1][0], 1), (0, 2)]
    else:
        cad = CADENCES[mvar]
    return head + cad


def render_track(chapter, root, bpm, density, lead, mvar, scale, prog,
                 seed, drone=False):
    """1 曲ぶんのステレオサンプル列。長さ = 8 小節 + 余韻 (折り返し前)。"""
    ch = CHAPTERS[chapter]
    motif = ch['motif']
    motif_b = ch['motif_b']
    beat = 60.0 / bpm
    bar = beat * 4
    eighth = beat / 2
    length = bar * 8
    tail = 1.8
    total = int((length + tail) * SR)
    buf_l = [0.0] * total
    buf_r = [0.0] * total
    rnd = random.Random(seed)
    note_no = 0

    blocks = [
        (motif, prog[0]),
        (vary_motif(motif, mvar), prog[1]),
        (motif_b, prog[2]),
        (motif, prog[3]),
    ]

    # ベースの歩み (半音)。根と五度とオクターブで駆ける。
    bp = [0, 0, 7, 0, 12, 0, 7, 5]

    for bi, (mel, bdeg) in enumerate(blocks):
        t0 = bi * bar * 2
        base_midi = root + deg_semi(scale, bdeg)

        # ── 下地の持続音。静かな曲だけ、ブロックの和音を薄く敷く。
        if density <= 0.55:
            for k, dd in enumerate((0, 2, 4)):
                f = hz(root + 12 + deg_semi(scale, bdeg + dd))
                add(buf_l, buf_r, t0, pad(f, bar * 2, 0.016),
                    pan=(-0.25, 0.0, 0.25)[k])

        for b in range(2):
            bt = t0 + b * bar
            # ── 太鼓。1・3 拍はどっしり、濃い曲は 4 拍にも置く。
            add(buf_l, buf_r, bt, taiko(150, 0.32, 0.92))
            add(buf_l, buf_r, bt + beat * 2, taiko(132, 0.3, 0.8))
            if density > 0.5:
                add(buf_l, buf_r, bt + beat * 2.75, taiko(120, 0.2, 0.5 * density))
            if density > 0.65:
                add(buf_l, buf_r, bt + beat * 3, taiko(110, 0.2, 0.4 * density))
            if density > 0.7:
                add(buf_l, buf_r, bt + beat * 3.5, taiko(110, 0.18, 0.42 * density))

            # ── スネア。2・4 拍。
            sv = 0.42 + density * 0.2
            add(buf_l, buf_r, bt + beat * 1, snare(0.1, sv), pan=0.04)
            add(buf_l, buf_r, bt + beat * 3, snare(0.1, sv), pan=-0.04)
            if density > 0.6:
                add(buf_l, buf_r, bt + beat * 3.75, snare(0.07, 0.2))

            # ── ハイハット。8 分。左右へ小さく振る。
            for k in range(8):
                v = 0.16 + (0.1 if k % 2 else 0.02)
                add(buf_l, buf_r, bt + k * beat / 2,
                    hat(0.032, v * (0.7 + density * 0.5),
                        open_=(k == 7 and density > 0.55)),
                    pan=0.18 if k % 2 else -0.18)

            # ── ベース。8 分で駆ける。
            for k in range(8):
                f = hz(base_midi - 12 + bp[k])
                acc = 1.0 if k % 2 == 0 else 0.74
                add(buf_l, buf_r, bt + k * beat / 2,
                    bass(f, beat * 0.52, 0.30 * acc * (0.85 + density * 0.3)))

            # ── 和声の箏。裏拍に和音の音を置く (装飾。種つき)。
            for k, dd in ((2, 2), (5, 4)):
                if rnd.random() > 0.35 + density * 0.45:
                    continue
                note_no += 1
                f = hz(root + 12 + deg_semi(scale, bdeg + dd))
                add(buf_l, buf_r, bt + k * eighth,
                    pluck(f, beat * 1.1, 0.085 + density * 0.05,
                          seed=seed + note_no, bright=0.9),
                    pan=0.3 if k == 2 else -0.3)

            # ── 16 分の走り。ブロックの締めに 1 か所 (装飾。種つき)。
            if b == 1 and bi in (1, 3) and density > 0.5:
                for r in range(4):
                    note_no += 1
                    f = hz(root + 12 + deg_semi(scale, bdeg + 5 + r))
                    add(buf_l, buf_r, bt + beat * 3 + r * eighth / 2,
                        pluck(f, eighth * 0.8, 0.09,
                              seed=seed + 500 + note_no, bright=1.1),
                        pan=0.15 if r % 2 else -0.15)

        # ── 主題。主役の楽器で固定譜面を鳴らす。
        if lead == 'koto':
            # 箏が主役の曲は、笛がブロック頭で長い音を添える。
            f = hz(root + 24 + deg_semi(scale, bdeg + 4))
            add(buf_l, buf_r, t0 + 0.02, flute(f, bar * 0.9, 0.07,
                                               seed=seed + bi))
        pos = 0
        last = len(mel) - 1
        for ni, (deg, ln) in enumerate(mel):
            at = t0 + pos * eighth
            dur = ln * eighth
            f = hz(root + 12 + deg_semi(scale, bdeg + deg))
            ring = 1.6 if (bi == 3 and ni == last) else 1.0
            note_no += 1
            if lead == 'flute':
                add(buf_l, buf_r, at, flute(f, dur * 1.12 * ring, 0.30,
                                            seed=seed * 7 + note_no))
                if ln >= 2:  # 長い音には箏が下で寄り添う。
                    add(buf_l, buf_r, at + 0.01,
                        pluck(hz(root + 12 + deg_semi(scale, bdeg + deg - 5)),
                              dur * 1.2, 0.09, seed=seed + note_no, bright=0.8),
                        pan=0.12)
            elif lead == 'koto':
                add(buf_l, buf_r, at,
                    pluck(f, dur * 1.5 * ring, 0.30,
                          seed=seed * 7 + note_no, bright=1.1))
            else:  # duo — 笛の旋律に箏が同じ音で輪郭を付ける。
                add(buf_l, buf_r, at, flute(f, dur * 1.12 * ring, 0.26,
                                            seed=seed * 7 + note_no))
                add(buf_l, buf_r, at + 0.012,
                    pluck(f, dur * 1.3 * ring, 0.12,
                          seed=seed + note_no, bright=0.9),
                    pan=-0.08)
            pos += ln

    # ── ボス曲の下地。低い持続音が全体を圧す。
    if drone:
        n = int(length * SR)
        f0 = hz(root - 12)
        f1 = hz(root - 12 + 7)
        for i in range(n):
            t = i / SR
            trem = 0.85 + 0.15 * math.sin(2 * math.pi * 0.5 * t)
            s = (math.sin(2 * math.pi * f0 * t)
                 + 0.5 * math.sin(2 * math.pi * f1 * t)) * 0.045 * trem
            buf_l[i] += s
            buf_r[i] += s

    add_space(buf_l, buf_r)
    return buf_l, buf_r, int(length * SR), total - int(length * SR)


TARGET_RMS = 0.15


def write_wav(path, buf_l, buf_r, loop_n, tail_n):
    """余韻を先頭へ折り返し、RMS をそろえて書き出す。

    まず RMS が目標に合うよう増幅し、最後に tanh の柔らかい潰しで
    ピークを丸める。太鼓の瞬間的なピークで曲全体が小さくなるのを防ぎ、
    曲ごとの聞こえの大きさをそろえるため。
    """
    for i in range(tail_n):
        buf_l[i] += buf_l[loop_n + i]
        buf_r[i] += buf_r[loop_n + i]
    buf_l = buf_l[:loop_n]
    buf_r = buf_r[:loop_n]
    ss = 0.0
    for i in range(loop_n):
        l = buf_l[i]
        r = buf_r[i]
        ss += (l * l + r * r) * 0.5
    rms = math.sqrt(ss / loop_n)
    g = TARGET_RMS / max(1e-9, rms)
    fade = int(0.002 * SR)
    frames = array('h', bytes(4 * loop_n))
    ss2 = 0.0
    peak = 0
    for i in range(loop_n):
        f = 1.0
        if i < fade:
            f = i / fade
        elif i >= loop_n - fade:
            f = (loop_n - 1 - i) / fade
        vl = int(math.tanh(buf_l[i] * g * f * 1.25) * 0.92 * 32767)
        vr = int(math.tanh(buf_r[i] * g * f * 1.25) * 0.92 * 32767)
        frames[2 * i] = vl
        frames[2 * i + 1] = vr
        ss2 += vl * vl + vr * vr
        m = abs(vl) if abs(vl) > abs(vr) else abs(vr)
        if m > peak:
            peak = m
    if sys.byteorder != 'little':
        frames.byteswap()
    w = wave.open(str(path), 'wb')
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(frames.tobytes())
    w.close()
    return math.sqrt(ss2 / (2 * loop_n)) / 32767, peak / 32767


def track_seed(stage):
    if stage == 'boss':
        return 9137
    return (int(stage) * 1013904223) % (2 ** 31)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=str(ROOT / 'assets' / 'bgm'))
    ap.add_argument('--only', default=None,
                    help='カンマ区切りのファイル名 (stage1,boss など)')
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    only = set(args.only.split(',')) if args.only else None
    for (stage, name, root, bpm, density, lead, mvar, scale_over) in TRACKS:
        fname = 'boss' if stage == 'boss' else f'stage{stage}'
        if only and fname not in only:
            continue
        ch_no = chapter_of(stage)
        ch = CHAPTERS[ch_no]
        scale = scale_over if scale_over is not None else ch['scale']
        prog = BOSS_PROG if stage == 'boss' else ch['prog']
        buf_l, buf_r, loop_n, tail_n = render_track(
            ch_no, root, bpm, density, lead, mvar, scale, prog,
            track_seed(stage), drone=(stage == 'boss'))
        path = out / f'{fname}.wav'
        rms, peak = write_wav(path, buf_l, buf_r, loop_n, tail_n)
        print(f'{path}  {loop_n / SR:.1f}s  {bpm}bpm  ch{ch_no} {name} '
              f'lead={lead} rms={rms:.3f} peak={peak:.2f}')


if __name__ == '__main__':
    main()
