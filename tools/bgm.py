# ============================================================================
# ワードローグ — BGM 生成 (stage10〜19)
#
# 使い方:  python tools/bgm.py
#
# assets/bgm/stage1〜9.wav の続き。和音と箏のような撥弦で、
# 各ステージの名前に合わせた調・速さのループ曲をつくり、
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

# 範音階。ステージの空気で選ぶ。
HIRAJOSHI = [0, 2, 3, 7, 8]      # 平調子。物哀り。
MINOR_PENT = [0, 3, 5, 7, 10]    # 和風の短音階。
MAJOR_PENT = [0, 2, 4, 7, 9]     # 明るい長音階。
IN_SEN = [0, 1, 5, 7, 10]        # 陰旋法。張りつめた静けさ。

# (ステージ番号, 名前, 根音 MIDI, 音階, BPM, 小節, 濃しさ 0..1)
TRACKS = [
    (10, '苔庭',      55, HIRAJOSHI,  88, 8, 0.35),
    (11, '竹林の間',  57, MINOR_PENT, 108, 8, 0.5),
    (12, '水鏡の池',  50, HIRAJOSHI,  84, 8, 0.3),
    (13, '枯山水',    52, IN_SEN,     76, 8, 0.25),
    (14, '灯籠の路',  53, MINOR_PENT, 100, 8, 0.55),
    (15, '霧の苑',    58, MAJOR_PENT, 90, 8, 0.3),
    (16, '花筏の野',  60, MAJOR_PENT, 114, 8, 0.6),
    (17, '月見の壇',  52, HIRAJOSHI,  72, 8, 0.3),
    (18, '静寂の間',  50, IN_SEN,     66, 8, 0.2),
    (19, '言葉の庭',  55, MAJOR_PENT, 120, 8, 0.7),
]

def hz(midi):
    return 440.0 * (2.0 ** ((midi - 69) / 12.0))

def add(buf, at, gen):
    """buf の at 秒位置へ gen のサンプルを足す (はみ出しは無視)。"""
    i0 = int(at * SR)
    n = len(gen)
    if i0 >= len(buf):
        return
    end = min(len(buf), i0 + n)
    for i in range(i0, end):
        buf[i] += gen[i - i0]

def pluck(freq, dur, vol, seed=0.0, bright=1.0):
    """箏の撥弦。減衰する基音 + 2倍音 + 爪のノイズ。"""
    n = int(dur * SR)
    out = [0.0] * n
    rnd = random.Random(int(seed * 1e6) if seed else 7)
    for i in range(n):
        t = i / SR
        env = math.exp(-t * 6.5 / dur)
        vib = 1.0 + 0.0016 * math.sin(t * 2 * math.pi * 5.1 + seed)
        s = math.sin(2 * math.pi * freq * vib * t) * env
        s += 0.38 * bright * math.sin(2 * math.pi * freq * 2.01 * t) * math.exp(-t * 11 / dur)
        s += 0.16 * bright * math.sin(2 * math.pi * freq * 3.02 * t) * math.exp(-t * 16 / dur)
        # 爪がはじく最初の一瞬のノイズ。
        if t < 0.012:
            s += (rnd.random() * 2 - 1) * (1 - t / 0.012) * 0.5
        out[i] = s * vol
    return out

def bass(freq, dur, vol):
    """低音。柔らかく突き出す。"""
    n = int(dur * SR)
    out = [0.0] * n
    for i in range(n):
        t = i / SR
        env = min(1.0, t / 0.02) * math.exp(-t * 2.2 / dur)
        s = math.sin(2 * math.pi * freq * t)
        s += 0.35 * math.sin(2 * math.pi * freq * 2 * t) * math.exp(-t * 4 / dur)
        out[i] = s * env * vol
    return out

def air(freq, dur, vol):
    """笛のような装飾。裏拍にふっと通る。"""
    n = int(dur * SR)
    out = [0.0] * n
    for i in range(n):
        t = i / SR
        a = min(1.0, t / (dur * 0.3)) * (1 - t / dur) ** 1.5
        vib = 1.0 + 0.004 * math.sin(t * 2 * math.pi * 4.7)
        out[i] = math.sin(2 * math.pi * freq * vib * t) * a * vol
    return out

def hat(at_buf_len, vol):
    """短いノイズの打点。差分で高域だけ残す。"""
    n = int(0.035 * SR)
    out = [0.0] * n
    rnd = random.Random(99)
    prev = 0.0
    for i in range(n):
        x = rnd.random() * 2 - 1
        d = x - prev
        prev = x
        env = (1 - i / n) ** 2
        out[i] = d * env * vol
    return out

def render_track(root, scale, bpm, bars, density, seed):
    """1 曲ぶんのサンプル列。長さ = 小節 × 4 拍 + 余韻。"""
    beat = 60.0 / bpm
    bar = beat * 4
    length = bar * bars
    tail = 2.0
    total = int((length + tail) * SR)
    buf = [0.0] * total
    rnd = random.Random(seed)
    n_scale = len(scale)

    for b in range(bars):
        t0 = b * bar
        # 和声の歩み。平調子っぽく、根音から四度・五度へ落ち着く。
        prog = [0, 3, 4, 1, 0, 2, 3, 0]
        deg = prog[b % len(prog)]
        base = root + scale[deg % n_scale] + 12 * (deg // n_scale)
        # 低音。1 拍目と 3 拍目。
        add(buf, t0, bass(hz(base - 12), beat * 2.2, 0.30))
        add(buf, t0 + beat * 2, bass(hz(base - 12 + (7 if b % 2 else 5)), beat * 1.8, 0.22))
        # 箏の旋律。濃しさで密度が上がる。
        beats = [0, 1, 2, 3]
        for k in beats:
            if rnd.random() > 0.28 + density * 0.42:
                continue
            octv = 12 if rnd.random() < 0.24 else 0
            d2 = scale[rnd.randrange(n_scale)]
            dur = beat * (2.4 if rnd.random() < 0.3 else 1.4)
            add(buf, t0 + k * beat + (rnd.random() * 0.02),
                pluck(hz(base + d2 + octv), dur, 0.20 + density * 0.1,
                      seed=seed * 3 + b * 7 + k, bright=0.9 + density * 0.4))
        # 琶音。8 分の細い流れ。
        for k in range(0, 8):
            if rnd.random() > 0.45 + density * 0.25:
                continue
            d2 = scale[(k * 2 + b) % n_scale]
            add(buf, t0 + k * beat / 2, pluck(hz(base + 12 + d2), 0.5, 0.075 + density * 0.04,
                                              seed=seed * 5 + b * 3 + k, bright=0.7))
        # 裏打ちのノイズ。濃い曲だけ。
        if density > 0.45:
            for k in range(4):
                add(buf, t0 + k * beat + beat / 2, hat(total, 0.05 + density * 0.05))
        # 笛。2 小節に 1 回、裏でふっと。
        if b % 2 == 1:
            d2 = scale[(b + 2) % n_scale]
            add(buf, t0 + beat * 2.5, air(hz(base + 24 + d2), beat * 1.6, 0.05 + density * 0.03))

    # 末尾の余韻を先頭へ折り返して、ループの継ぎ目をなくす。
    loop_n = int(length * SR)
    tail_n = total - loop_n
    for i in range(tail_n):
        buf[i] += buf[loop_n + i]
    return buf[:loop_n]

def write_wav(path, samples):
    peak = max(1e-9, max(abs(s) for s in samples))
    k = 0.74 / peak
    # 最初と最後を 5ms ずつ丸める (クリック防止)。
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
        seed = stage * 1013904223 % (2 ** 31)
        samples = render_track(root, scale, bpm, bars, density, seed)
        path = f'assets/bgm/stage{stage}.wav'
        write_wav(path, samples)
        print(f'{path}  {name}  {len(samples) / SR:.1f}s  {bpm}bpm')

if __name__ == '__main__':
    main()
