# ============================================================================
# ワードローグ — BGM 生成 (stage10〜19)
#
# 使い方:  python tools/bgm.py
#
# 戦闘曲。和太鼓とスネアとハイハットで畳み、駆動するベースの上を
# 箏と笛が走る。ステージが奥へ進むほど速く、厚くなる。
# 44.1kHz / 16bit / mono の WAV として assets/bgm/ に書き出す。
#
# 依存なし (標準ライブラリのみ)。ループは「末尾の余韻を先頭へ折り返す」
# ので、継ぎ目が途切れない。
# ============================================================================
import math
import random
import struct
import wave

SR = 44100

HIRAJOSHI = [0, 2, 3, 7, 8]      # 平調子。物哀り。
MINOR_PENT = [0, 3, 5, 7, 10]    # 和風の短音階。
MAJOR_PENT = [0, 2, 4, 7, 9]     # 明るい長音階。
IN_SEN = [0, 1, 5, 7, 10]        # 陰旋法。張りつめた静けさ。

# (ステージ番号, 名前, 根音 MIDI, 音階, BPM, 小節, 濃しさ 0..1)
TRACKS = [
    (1,  '村の外れ',      50, MINOR_PENT, 112, 8, 0.35),
    (2,  '森の奥',        50, HIRAJOSHI, 114, 8, 0.4),
    (3,  '廃村',          48, MINOR_PENT, 116, 8, 0.42),
    (4,  '地下墓場',      45, IN_SEN,    118, 8, 0.45),
    (5,  '城塞外壁',      47, MINOR_PENT, 120, 8, 0.48),
    (6,  '深淵の魔王城',  43, IN_SEN,    122, 8, 0.5),
    (7,  '語書庫',        48, HIRAJOSHI, 120, 8, 0.5),
    (8,  '韻律の塔',      50, MAJOR_PENT, 124, 8, 0.55),
    (9,  '言葉の根源',    45, IN_SEN,    126, 8, 0.6),
    (10, '苔庭',          52, HIRAJOSHI, 124, 8, 0.45),
    (11, '竹林の間',      50, MINOR_PENT, 130, 8, 0.55),
    (12, '水鏡の池',      48, HIRAJOSHI, 126, 8, 0.5),
    (13, '枯山水',        45, IN_SEN,    128, 8, 0.55),
    (14, '灯籠の路',      46, MINOR_PENT, 134, 8, 0.6),
    (15, '霧の苑',        48, MAJOR_PENT, 132, 8, 0.6),
    (16, '花筏の野',      50, MAJOR_PENT, 140, 8, 0.7),
    (17, '月見の壇',      45, HIRAJOSHI, 136, 8, 0.65),
    (18, '静寂の間',      43, IN_SEN,    144, 8, 0.75),
    (19, '言葉の庭',      45, MINOR_PENT, 152, 8, 0.85),
    ('boss', 'ボス',      41, MINOR_PENT, 148, 8, 0.9),
]

def hz(midi):
    return 440.0 * (2.0 ** ((midi - 69) / 12.0))

def add(buf, at, gen):
    """buf の at 秒位置へ gen のサンプルを足す (はみ出しは無視)。"""
    i0 = int(at * SR)
    if i0 >= len(buf):
        return
    end = min(len(buf), i0 + len(gen))
    for i in range(i0, end):
        buf[i] += gen[i - i0]

def taiko(freq=150, dur=0.30, vol=1.0):
    """和太鼓。叩いた瞬間に皮の張りが沈み、音程が落ちる。"""
    n = int(dur * SR)
    out = [0.0] * n
    for i in range(n):
        t = i / SR
        f = freq * (1.0 - 0.62 * min(1.0, t / 0.06))
        env = math.exp(-t * 16)
        s = math.sin(2 * math.pi * f * t) * env
        # 皮の叩き初めのパチン。
        if t < 0.004:
            s += (1 - t / 0.004) * 0.55
        out[i] = s * vol
    return out

def snare(dur=0.11, vol=1.0, tone=0.35):
    """スネア。ノイズの胴に、 membrane の音を少し混ぜる。"""
    n = int(dur * SR)
    out = [0.0] * n
    rnd = random.Random(4127)
    prev = 0.0
    lp = 0.0
    for i in range(n):
        t = i / SR
        x = rnd.random() * 2 - 1
        hp = x - prev          # 高域の胴。
        prev = x
        lp += (x - lp) * 0.42  # 中域。
        env = math.exp(-t * 30)
        s = hp * 0.8 + lp * tone
        out[i] = s * env * vol
    return out

def hat(dur=0.032, vol=1.0, open_=False):
    """ハイハット。開放は少し長く。"""
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
    return out

def bass(freq, dur, vol):
    """駆けるベース。8 分の粒。頭にアタックを置く。"""
    n = int(dur * SR)
    out = [0.0] * n
    for i in range(n):
        t = i / SR
        atk = min(1.0, t / 0.006)
        env = atk * math.exp(-t * 7.5 / dur)
        s = math.sin(2 * math.pi * freq * t)
        s += 0.45 * math.sin(2 * math.pi * freq * 2 * t) * math.exp(-t * 12 / dur)
        out[i] = s * env * vol
    return out

def pluck(freq, dur, vol, seed=0.0, bright=1.0):
    """箏の撥弦。減衰する基音 + 倍音 + 爪のノイズ。"""
    n = int(dur * SR)
    out = [0.0] * n
    rnd = random.Random(int(seed * 1e6) if seed else 7)
    for i in range(n):
        t = i / SR
        env = math.exp(-t * 5.6 / dur)
        vib = 1.0 + 0.0014 * math.sin(t * 2 * math.pi * 5.3 + seed)
        s = math.sin(2 * math.pi * freq * vib * t) * env
        s += 0.42 * bright * math.sin(2 * math.pi * freq * 2.005 * t) * math.exp(-t * 10 / dur)
        s += 0.18 * bright * math.sin(2 * math.pi * freq * 3.02 * t) * math.exp(-t * 15 / dur)
        if t < 0.010:
            s += (rnd.random() * 2 - 1) * (1 - t / 0.010) * 0.45 * bright
        out[i] = s * vol
    return out

def flute(freq, dur, vol):
    """笛。裏拍からふっと入る息。"""
    n = int(dur * SR)
    out = [0.0] * n
    for i in range(n):
        t = i / SR
        a = min(1.0, t / (dur * 0.22)) * (1 - t / dur) ** 1.4
        vib = 1.0 + 0.005 * math.sin(t * 2 * math.pi * 5.1)
        s = math.sin(2 * math.pi * freq * vib * t)
        s += 0.12 * math.sin(2 * math.pi * freq * 2 * t)
        out[i] = s * a * vol
    return out

def render_track(root, scale, bpm, bars, density, seed):
    """1 曲ぶんのサンプル列。長さ = 小節 × 4 拍 + 余韻。"""
    beat = 60.0 / bpm
    bar = beat * 4
    length = bar * bars
    tail = 1.6
    total = int((length + tail) * SR)
    buf = [0.0] * total
    rnd = random.Random(seed)
    n_scale = len(scale)
    spb16 = beat / 4  # 16 分 1 個の長さ

    # 和声の歩み。2 小節ごとに落ち着き先を変える。
    prog = [0, 3, 4, 1, 2, 3, 0, 4]
    prog2 = [0, 2, 3, 1, 4, 0, 3, 2]

    for b in range(bars):
        t0 = b * bar
        deg = (prog if b % 2 == 0 else prog2)[b] % n_scale
        base = root + scale[deg] + 12 * (deg // n_scale)
        fifth = 7

        # ── 太鼓。1・3 拍はどっしり、濃い曲は裏にも置く。
        add(buf, t0, taiko(150, 0.32, 0.92))
        add(buf, t0 + beat * 2, taiko(132, 0.3, 0.8))
        if density > 0.5:
            add(buf, t0 + beat * 2.75, taiko(120, 0.2, 0.5 * density))
        if density > 0.7:
            add(buf, t0 + beat * 3.5, taiko(110, 0.18, 0.42 * density))

        # ── スネア。2・4 拍。
        add(buf, t0 + beat * 1, snare(0.1, 0.42 + density * 0.2))
        add(buf, t0 + beat * 3, snare(0.1, 0.42 + density * 0.2))
        if density > 0.6:
            add(buf, t0 + beat * 3.75, snare(0.07, 0.2))

        # ── ハイハット。8 分。オフビートを強めに。
        for k in range(8):
            v = 0.16 + (0.1 if k % 2 else 0.02)
            add(buf, t0 + k * beat / 2, hat(0.032, v * (0.7 + density * 0.5),
                                            open_=(k == 7 and density > 0.55)))

        # ── ベース。8 分で駆ける。根音と五度とオクターブ。
        bp = [0, 0, 7, 0, 12, 0, 7, 5]
        for k in range(8):
            step = bp[k]
            f = hz(base - 12 + step)
            acc = 1.0 if k % 2 == 0 else 0.74
            add(buf, t0 + k * beat / 2, bass(f, beat * 0.52, 0.30 * acc * (0.85 + density * 0.3)))

        # ── 箏の旋律。16 分も交ぜて走らせる。
        for k in range(8):
            if rnd.random() > 0.42 + density * 0.4:
                continue
            octv = 12 if rnd.random() < 0.3 else 0
            d2 = scale[rnd.randrange(n_scale)]
            dur = beat * (1.2 if rnd.random() < 0.3 else 0.55)
            add(buf, t0 + k * beat / 2 + (rnd.random() * 0.008),
                pluck(hz(base + 12 + d2 + octv), dur, 0.20 + density * 0.1,
                      seed=seed * 3 + b * 7 + k, bright=0.95 + density * 0.4))
        # 走り。濃い曲は 16 分の連打を 1 か所入れる。
        if density > 0.55:
            run_at = rnd.randrange(4) * beat
            for r in range(4):
                d2 = scale[(b + r) % n_scale]
                add(buf, t0 + run_at + r * spb16,
                    pluck(hz(base + 12 + d2 + 12), spb16 * 1.4, 0.13,
                          seed=seed * 11 + b * 5 + r, bright=1.1))

        # ── 笛。2 小節に 1 回、フックを 1 音。
        if b % 2 == 1:
            d2 = scale[(b + 3) % n_scale]
            add(buf, t0 + beat * 2.25, flute(hz(base + 24 + d2), beat * 1.7,
                                             0.06 + density * 0.04))

    # 末尾の余韻を先頭へ折り返して、ループの継ぎ目をなくす。
    loop_n = int(length * SR)
    tail_n = total - loop_n
    for i in range(tail_n):
        buf[i] += buf[loop_n + i]
    return buf[:loop_n]

def write_wav(path, samples):
    peak = max(1e-9, max(abs(s) for s in samples))
    k = 0.82 / peak
    fade = int(0.005 * SR)
    for i in range(fade):
        samples[i] *= i / fade
        samples[-1 - i] *= i / fade
    w = wave.open(path, 'wb')
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(SR)
    frames = b''.join(struct.pack('<h', int(max(-1, min(1, s * k)) * 32767)) for s in samples)
    w.writeframes(frames)
    w.close()

def main():
    for (stage, name, root, scale, bpm, bars, density) in TRACKS:
        seed = (int(stage) * 1013904223 if isinstance(stage, int) else 9137) % (2 ** 31)
        samples = render_track(root, scale, bpm, bars, density, seed)
        path = f'assets/bgm/{'boss' if stage == 'boss' else 'stage' + str(stage)}.wav'
        write_wav(path, samples)
        print(f'{path}  {len(samples) / SR:.1f}s  {bpm}bpm')

if __name__ == '__main__':
    main()
