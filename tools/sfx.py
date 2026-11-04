# ============================================================================
# ワードローグ — 効果音生成 (assets/sfx)
#
# 使い方:  python tools/sfx.py
#
# これまでの効果音を、重なりで作る合成に作り直す。
#   頭の速い遷移 (クリック・パチン) + 音程のある胴 + 残響の尾
# の 3 層を基本に、語の意味が音になるように (斬 = 殺風景なノイズではなく
# 息のあるスウォッシュ、金 = コインの輝き…)。
# 44.1kHz / 16bit / stereo。上書きするので元に戻したいときは
# git checkout assets/sfx で。
# ============================================================================
import math
import random
import struct
import wave

SR = 44100

def hz(midi):
    return 440.0 * (2.0 ** ((midi - 69) / 12.0))

class Buf:
    """ stereo 1 本分のミキサ。add(name_or_ch, at, samples) で重ねる。 """
    def __init__(self, dur):
        self.n = int(dur * SR)
        self.l = [0.0] * self.n
        self.r = [0.0] * self.n

    def add(self, at, gen, pan=0.0):
        i0 = int(at * SR)
        if i0 >= self.n:
            return
        gl = math.sqrt(0.5 * (1.0 - pan))
        gr = math.sqrt(0.5 * (1.0 + pan))
        end = min(self.n, i0 + len(gen))
        for i in range(i0, end):
            s = gen[i - i0]
            self.l[i] += s * gl
            self.r[i] += s * gr

    def fold(self, keep):
        """余韻を先頭へ折り返す (ループ用ではなく SE はフェードで足切り)。"""
        self.l = self.l[:keep]
        self.r = self.r[:keep]

def env_ar(n, a, d, curve=5.0):
    """attack / decay の包絡。"""
    out = [0.0] * n
    an = max(1, int(a * SR))
    for i in range(n):
        if i < an:
            out[i] = i / an
        else:
            out[i] = math.exp(-((i - an) / SR) * d * curve)
    return out

def tone(f0, f1, dur, vol=1.0, a=0.002, d=9.0, curve=5.0, wobble=0.0):
    """音程が f0 → f1 へ落ちる (または上がる) 正弦の胴。"""
    n = int(dur * SR)
    out = [0.0] * n
    ph = 0.0
    e = env_ar(n, a, d, curve)
    for i in range(n):
        t = i / SR
        f = f0 + (f1 - f0) * min(1.0, t / (dur * 0.7))
        if wobble:
            f *= 1.0 + wobble * math.sin(t * 2 * math.pi * 9)
        ph += 2 * math.pi * f / SR
        out[i] = math.sin(ph) * e[i] * vol
    return out

def sub(f0, f1, dur, vol=1.0):
    """低域の胴。2 倍音を少し混ぜない。純粋に沈む。"""
    return tone(f0, f1, dur, vol, a=0.003, d=6.0)

def nz(dur, vol=1.0, a=0.001, d=22.0, lp=1.0, hp=0.0, curve=5.0, seed=1):
    """ノイズ。1 次の lp / hp フィルタ (0..1)。"""
    n = int(dur * SR)
    out = [0.0] * n
    rnd = random.Random(seed)
    lpv = 0.0
    prev = 0.0
    e = env_ar(n, a, d, curve)
    for i in range(n):
        x = rnd.random() * 2 - 1
        lpv += (x - lpv) * lp
        v = lpv if lp < 1.0 else x
        v = v - prev if hp > 0.0 else v
        prev = v
        out[i] = v * e[i] * vol
    return out

def pluck(f, dur, vol=1.0, bright=1.0, seed=3):
    """撥弦 (箏・マリム)。"""
    n = int(dur * SR)
    out = [0.0] * n
    rnd = random.Random(seed)
    for i in range(n):
        t = i / SR
        env = math.exp(-t * 6.5 / dur)
        s = math.sin(2 * math.pi * f * t) * env
        s += 0.4 * bright * math.sin(2 * math.pi * f * 2.003 * t) * math.exp(-t * 11 / dur)
        s += 0.15 * bright * math.sin(2 * math.pi * f * 3.01 * t) * math.exp(-t * 16 / dur)
        if t < 0.006:
            s += (rnd.random() * 2 - 1) * (1 - t / 0.006) * 0.4 * bright
        out[i] = s * vol
    return out

def chord_note(buf, at, f, dur, vol, pan=0.0, bright=1.0, seed=3):
    buf.add(at, pluck(f, dur, vol, bright, seed), pan)

def mix(dst, gain=1.0):
    return dst

# ── 各効果音のレシピ ──────────────────────────────────────────────────────
# 関数は Buf を返す。長さ (秒) は従来のファイルと同程度に揃える。

def s_hit():
    b = Buf(0.12)
    b.add(0.0, tone(150, 62, 0.10, 0.85, d=7.0))
    b.add(0.0, nz(0.035, 0.5, d=30, hp=0.5), 0.1)
    b.add(0.004, tone(340, 200, 0.05, 0.25, d=12), -0.3)
    return b

def s_hit_heavy():
    b = Buf(0.16)
    b.add(0.0, sub(110, 45, 0.15, 1.0))
    b.add(0.0, nz(0.05, 0.55, d=20, lp=0.5), 0.05)
    b.add(0.0, tone(210, 80, 0.08, 0.4, d=10), -0.15)
    return b

def s_hit_sharp():
    b = Buf(0.10)
    b.add(0.0, tone(2100, 1400, 0.06, 0.5, d=11, wobble=0.02))
    b.add(0.0, nz(0.03, 0.6, d=34, hp=0.7), 0.15)
    b.add(0.002, tone(3120, 2600, 0.05, 0.3, d=13), 0.35)
    return b

def s_hit_soft():
    b = Buf(0.09)
    b.add(0.0, tone(190, 92, 0.08, 0.7, d=8))
    b.add(0.0, nz(0.03, 0.22, d=26, lp=0.35))
    return b

def s_hit_ring():
    b = Buf(0.20)
    b.add(0.0, tone(1180, 1170, 0.19, 0.4, d=5.5, wobble=0.015))
    b.add(0.0, tone(1865, 1840, 0.15, 0.28, d=6.5), 0.4)
    b.add(0.0, nz(0.02, 0.35, d=40, hp=0.7))
    return b

def s_hit_wind():
    b = Buf(0.14)
    b.add(0.0, nz(0.13, 0.5, a=0.012, d=8, lp=0.28, hp=0.25, curve=3.5))
    b.add(0.0, tone(660, 380, 0.1, 0.14, d=9))
    return b

def s_hit_coin():
    b = Buf(0.14)
    b.add(0.0, tone(1568, 1568, 0.09, 0.4, d=6.5), -0.3)
    b.add(0.03, tone(2093, 2093, 0.1, 0.36, d=6), 0.35)
    b.add(0.0, nz(0.015, 0.3, d=44, hp=0.8))
    return b

def s_hit_dark():
    b = Buf(0.16)
    b.add(0.0, sub(95, 40, 0.15, 0.9))
    b.add(0.02, nz(0.12, 0.3, a=0.02, d=9, lp=0.2, curve=3), 0.2)
    b.add(0.0, tone(320, 130, 0.09, 0.22, d=10), -0.25)
    return b

def s_elem_hit():
    b = Buf(0.07)
    b.add(0.0, tone(1250, 820, 0.05, 0.45, d=13))
    b.add(0.0, nz(0.02, 0.35, d=38, hp=0.65), 0.2)
    return b

def s_slash():
    b = Buf(0.16)
    # 息のあるスウォッシュ。帯域が上 → 下へ滑る。
    n = int(0.13 * SR)
    rnd = random.Random(77)
    lpv = 0.0
    sweep = [0.0] * n
    for i in range(n):
        t = i / n
        f = 0.75 - 0.55 * t
        lpv += (rnd.random() * 2 - 1 - lpv) * max(0.05, f)
        env = math.sin(t * math.pi) ** 1.4
        sweep[i] = lpv * env * 1.7
    b.add(0.0, sweep)
    b.add(0.05, tone(2840, 1900, 0.07, 0.2, d=13), 0.3)
    b.add(0.0, tone(520, 300, 0.07, 0.18, d=12), -0.2)
    return b

def s_shoot():
    b = Buf(0.11)
    b.add(0.0, tone(1560, 240, 0.09, 0.62, d=10, curve=6))
    b.add(0.0, nz(0.02, 0.5, d=44, hp=0.6))
    b.add(0.004, tone(560, 210, 0.06, 0.3, d=12), -0.25)
    return b

def s_kill():
    b = Buf(0.16)
    b.add(0.0, tone(460, 120, 0.06, 0.6, d=13))
    b.add(0.035, pluck(hz(88), 0.12, 0.4, 1.1, 5), 0.2)
    b.add(0.07, pluck(hz(95), 0.12, 0.34, 1.1, 6), -0.25)
    b.add(0.0, nz(0.03, 0.3, d=30, hp=0.5))
    return b

def s_hurt():
    b = Buf(0.18)
    b.add(0.0, sub(130, 52, 0.16, 1.0))
    b.add(0.0, nz(0.09, 0.5, d=16, lp=0.55), 0.1)
    b.add(0.02, tone(280, 110, 0.1, 0.4, d=9), -0.2)
    return b

def s_explode():
    b = Buf(0.55)
    b.add(0.0, nz(0.5, 1.0, a=0.002, d=4.2, lp=0.32, curve=2.6, seed=12))
    b.add(0.0, sub(150, 36, 0.42, 0.9))
    b.add(0.0, nz(0.06, 0.8, d=26, hp=0.55), 0.2)
    b.add(0.1, nz(0.3, 0.4, a=0.01, d=6, lp=0.2, curve=3, seed=13), -0.3)
    return b

def s_dash():
    b = Buf(0.26)
    n = int(0.24 * SR)
    rnd = random.Random(31)
    lpv = 0.0
    sweep = [0.0] * n
    for i in range(n):
        t = i / n
        f = 0.2 + 0.55 * math.sin(t * math.pi)
        lpv += (rnd.random() * 2 - 1 - lpv) * f
        env = math.sin(t * math.pi) ** 1.2
        sweep[i] = lpv * env * 1.6
    b.add(0.0, sweep)
    b.add(0.0, tone(340, 720, 0.14, 0.14, d=7))
    return b

def s_xp():
    b = Buf(0.11)
    b.add(0.0, pluck(hz(93), 0.07, 0.5, 0.9, 9), -0.2)
    b.add(0.045, pluck(hz(100), 0.07, 0.46, 0.9, 10), 0.25)
    return b

def s_pickup():
    b = Buf(0.2)
    b.add(0.0, pluck(hz(90), 0.09, 0.46, 0.9, 11))
    b.add(0.05, pluck(hz(97), 0.1, 0.42, 0.9, 12), 0.25)
    b.add(0.1, pluck(hz(104), 0.1, 0.36, 0.9, 13), -0.2)
    return b

def s_combo():
    b = Buf(0.14)
    b.add(0.0, tone(880, 880, 0.05, 0.4, d=9))
    b.add(0.035, tone(1109, 1109, 0.05, 0.38, d=9), 0.25)
    b.add(0.07, tone(1319, 1319, 0.06, 0.36, d=8), -0.2)
    return b

def s_heal():
    b = Buf(0.42)
    for i, (m, at) in enumerate([(88, 0.0), (95, 0.09), (102, 0.18), (109, 0.27)]):
        b.add(at, pluck(hz(m), 0.2, 0.3, 0.8, 20 + i), -0.3 + i * 0.2)
    return b

def s_phrase():
    b = Buf(0.3)
    b.add(0.0, pluck(hz(84), 0.16, 0.46, 1.0, 30))
    b.add(0.08, pluck(hz(91), 0.22, 0.42, 1.0, 31), 0.2)
    return b

def s_broken():
    b = Buf(0.22)
    b.add(0.0, tone(420, 130, 0.18, 0.5, d=5, curve=3))
    b.add(0.0, nz(0.1, 0.3, d=12, lp=0.4), -0.2)
    return b

def s_levelup():
    b = Buf(0.55)
    for i, m in enumerate([76, 80, 83, 88]):
        b.add(i * 0.075, pluck(hz(m), 0.2, 0.4, 1.0, 40 + i), -0.2 + i * 0.13)
    b.add(0.3, pluck(hz(93), 0.28, 0.4, 1.0, 44), 0.1)
    return b

def s_win():
    b = Buf(0.85)
    seq = [76, 80, 83, 88, 92]
    for i, m in enumerate(seq):
        b.add(i * 0.1, pluck(hz(m), 0.3, 0.42, 1.0, 50 + i), -0.25 + i * 0.12)
    b.add(0.5, chord_note and tone(587, 587, 0.34, 0.16, d=4), 0)
    return b

def s_lose():
    b = Buf(0.8)
    for i, m in enumerate([76, 72, 69, 64]):
        b.add(i * 0.13, tone(hz(m), hz(m) * 0.985, 0.26, 0.3, d=4.5, wobble=0.01), (-0.2) ** i)
    b.add(0.0, sub(90, 45, 0.5, 0.4))
    return b

def s_boss():
    b = Buf(0.75)
    for i, m in enumerate([45, 40, 33]):
        b.add(i * 0.16, tone(hz(m), hz(m) * 0.99, 0.42, 0.5, d=3.5, wobble=0.012), (-0.3) ** i)
    b.add(0.0, nz(0.5, 0.3, a=0.03, d=3.2, lp=0.22, curve=2.2, seed=60))
    return b

def s_boss_warn():
    b = Buf(0.6)
    for i in range(2):
        b.add(i * 0.24, tone(220, 233, 0.2, 0.5, d=4, wobble=0.02), -0.2)
        b.add(i * 0.24 + 0.1, tone(196, 208, 0.18, 0.4, d=4, wobble=0.02), 0.25)
    return b

def s_cast():
    b = Buf(0.14)
    b.add(0.0, tone(980, 1450, 0.1, 0.32, d=9, wobble=0.02))
    b.add(0.0, nz(0.04, 0.2, d=24, hp=0.5))
    return b

def s_cast_fire():
    b = Buf(0.28)
    b.add(0.0, nz(0.26, 0.55, a=0.015, d=5, lp=0.4, curve=3, seed=71))
    b.add(0.0, tone(300, 170, 0.22, 0.3, d=5))
    rnd = random.Random(72)
    for i in range(5):
        b.add(0.04 + rnd.random() * 0.16, nz(0.02, 0.3, d=40, hp=0.6, seed=80 + i),
              (rnd.random() - 0.5) * 1.4)
    return b

def s_cast_ice():
    b = Buf(0.24)
    for i, (f, at) in enumerate([(1865, 0.0), (2349, 0.05), (2794, 0.1)]):
        b.add(at, tone(f, f * 0.99, 0.13, 0.22, d=7, wobble=0.01), -0.3 + i * 0.3)
    b.add(0.0, nz(0.08, 0.14, d=18, hp=0.75))
    return b

def s_cast_thunder():
    b = Buf(0.22)
    b.add(0.0, nz(0.16, 0.7, a=0.001, d=11, hp=0.45, curve=4, seed=90))
    b.add(0.0, tone(1245, 340, 0.13, 0.34, d=9, curve=5))
    b.add(0.02, sub(110, 55, 0.12, 0.4))
    return b

def s_cast_wind():
    b = Buf(0.3)
    n = int(0.28 * SR)
    rnd = random.Random(95)
    lpv = 0.0
    sweep = [0.0] * n
    for i in range(n):
        t = i / n
        f = 0.3 + 0.5 * math.sin(t * math.pi)
        lpv += (rnd.random() * 2 - 1 - lpv) * f
        sweep[i] = lpv * math.sin(t * math.pi) ** 1.2 * 1.4
    b.add(0.0, sweep)
    return b

def s_cast_earth():
    b = Buf(0.26)
    b.add(0.0, sub(120, 48, 0.22, 0.9))
    b.add(0.0, nz(0.1, 0.4, d=14, lp=0.35), 0.15)
    return b

def s_cast_dark():
    b = Buf(0.3)
    b.add(0.0, tone(220, 130, 0.28, 0.4, d=3.6, wobble=0.025))
    b.add(0.04, tone(329, 200, 0.22, 0.24, d=4), 0.25)
    b.add(0.0, nz(0.14, 0.2, a=0.02, d=6, lp=0.18, curve=3, seed=99), -0.2)
    return b

def s_cast_water():
    b = Buf(0.2)
    b.add(0.0, tone(620, 1180, 0.09, 0.3, d=8, wobble=0.02))
    b.add(0.06, tone(880, 340, 0.1, 0.22, d=9), 0.25)
    b.add(0.0, nz(0.03, 0.12, d=30, hp=0.4))
    return b

def s_cast_gold():
    b = Buf(0.16)
    b.add(0.0, tone(1568, 1568, 0.07, 0.3, d=8), -0.25)
    b.add(0.035, tone(2093, 2093, 0.08, 0.26, d=7), 0.3)
    b.add(0.0, nz(0.012, 0.2, d=46, hp=0.8))
    return b

def s_cast_shot():
    b = Buf(0.12)
    b.add(0.0, tone(1180, 520, 0.08, 0.4, d=11))
    b.add(0.0, nz(0.018, 0.3, d=42, hp=0.6), 0.2)
    return b

def s_cast_gun():
    b = Buf(0.13)
    b.add(0.0, tone(880, 190, 0.1, 0.55, d=10, curve=6))
    b.add(0.0, nz(0.03, 0.5, d=34, hp=0.5), 0.15)
    return b

def s_cast_arrow():
    b = Buf(0.18)
    n = int(0.16 * SR)
    rnd = random.Random(103)
    lpv = 0.0
    sweep = [0.0] * n
    for i in range(n):
        t = i / n
        lpv += (rnd.random() * 2 - 1 - lpv) * (0.5 - 0.3 * t)
        sweep[i] = lpv * (t < 0.85 and 1.0 or max(0.0, 1 - (t - 0.85) / 0.15)) * 1.2
    b.add(0.0, sweep)
    b.add(0.0, tone(920, 620, 0.1, 0.12, d=9))
    return b

def s_cast_thrust():
    b = Buf(0.13)
    b.add(0.0, tone(740, 1480, 0.08, 0.36, d=10, curve=4))
    b.add(0.0, nz(0.03, 0.24, d=34, hp=0.55), 0.2)
    return b

def s_conn():
    b = Buf(0.08)
    b.add(0.0, pluck(hz(96), 0.06, 0.42, 0.8, 111))
    return b

def s_uns():
    b = Buf(0.09)
    b.add(0.0, tone(520, 380, 0.07, 0.34, d=11))
    return b

def s_slot():
    b = Buf(0.08)
    b.add(0.0, pluck(hz(103), 0.05, 0.4, 0.9, 112))
    return b

def s_ui_open():
    b = Buf(0.1)
    b.add(0.0, tone(620, 830, 0.07, 0.3, d=9))
    return b

def s_ui_close():
    b = Buf(0.1)
    b.add(0.0, tone(830, 590, 0.07, 0.28, d=9))
    return b

def s_ui_select():
    b = Buf(0.08)
    b.add(0.0, pluck(hz(100), 0.05, 0.38, 0.9, 113))
    return b

def s_ui_deny():
    b = Buf(0.12)
    b.add(0.0, tone(310, 260, 0.09, 0.34, d=8))
    b.add(0.05, tone(262, 230, 0.09, 0.3, d=8), 0.2)
    return b

def s_heartbeat():
    b = Buf(0.34)
    b.add(0.0, sub(88, 50, 0.11, 0.8))
    b.add(0.13, sub(74, 44, 0.13, 0.62))
    return b

def s_tick_urgent():
    b = Buf(0.07)
    b.add(0.0, tone(1245, 1245, 0.045, 0.4, d=14))
    b.add(0.0, nz(0.012, 0.2, d=48, hp=0.7), 0.2)
    return b

def s_gacha_spin():
    b = Buf(0.3)
    for i in range(9):
        b.add(i * 0.03, tone(700 + i * 90, 700 + i * 90, 0.024, 0.18, d=18), ((-0.3) if i % 2 else 0.3))
    return b

def s_gacha_tick():
    b = Buf(0.05)
    b.add(0.0, tone(1046, 1046, 0.03, 0.3, d=20))
    return b

def s_gacha_shine():
    b = Buf(0.24)
    for i, f in enumerate([1568, 1976, 2349, 3136]):
        b.add(i * 0.035, tone(f, f, 0.1, 0.2, d=8), -0.35 + i * 0.23)
    return b

def s_gacha_lock():
    b = Buf(0.12)
    b.add(0.0, pluck(hz(88), 0.08, 0.44, 1.0, 120))
    b.add(0.0, nz(0.014, 0.24, d=46, hp=0.6), 0.2)
    return b

def s_gacha_reveal():
    b = Buf(0.42)
    for i, m in enumerate([83, 88, 95]):
        b.add(i * 0.09, pluck(hz(m), 0.22, 0.4, 1.0, 121 + i), -0.25 + i * 0.25)
    b.add(0.0, tone(hz(59), hz(59), 0.36, 0.16, d=4))
    return b

RECIPES = {
    'hit': s_hit, 'hit_heavy': s_hit_heavy, 'hit_sharp': s_hit_sharp,
    'hit_soft': s_hit_soft, 'hit_ring': s_hit_ring, 'hit_wind': s_hit_wind,
    'hit_coin': s_hit_coin, 'hit_dark': s_hit_dark, 'elem_hit': s_elem_hit,
    'slash': s_slash, 'shoot': s_shoot, 'kill': s_kill, 'hurt': s_hurt,
    'explode': s_explode, 'dash': s_dash, 'xp': s_xp, 'pickup': s_pickup,
    'combo': s_combo, 'heal': s_heal, 'phrase': s_phrase, 'broken': s_broken,
    'levelup': s_levelup, 'win': s_win, 'lose': s_lose, 'boss': s_boss,
    'boss_warn': s_boss_warn, 'cast': s_cast, 'cast_fire': s_cast_fire,
    'cast_ice': s_cast_ice, 'cast_thunder': s_cast_thunder, 'cast_wind': s_cast_wind,
    'cast_earth': s_cast_earth, 'cast_dark': s_cast_dark, 'cast_water': s_cast_water,
    'cast_gold': s_cast_gold, 'cast_shot': s_cast_shot, 'cast_gun': s_cast_gun,
    'cast_arrow': s_cast_arrow, 'cast_thrust': s_cast_thrust,
    'conn': s_conn, 'uns': s_uns, 'slot': s_slot,
    'ui_open': s_ui_open, 'ui_close': s_ui_close, 'ui_select': s_ui_select,
    'ui_deny': s_ui_deny, 'heartbeat': s_heartbeat, 'tick_urgent': s_tick_urgent,
    'gacha_spin': s_gacha_spin, 'gacha_tick': s_gacha_tick, 'gacha_shine': s_gacha_shine,
    'gacha_lock': s_gacha_lock, 'gacha_reveal': s_gacha_reveal,
}

def write_wav(path, buf):
    peak = max(1e-9, max(max(abs(s) for s in buf.l), max(abs(s) for s in buf.r)))
    k = 0.86 / peak
    fade = int(0.004 * SR)
    n = len(buf.l)
    for i in range(min(fade, n)):
        f = i / fade
        buf.l[i] *= f
        buf.r[i] *= f
        buf.l[n - 1 - i] *= f
        buf.r[n - 1 - i] *= f
    w = wave.open(path, 'wb')
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    frames = b''.join(
        struct.pack('<hh', int(max(-1, min(1, buf.l[i] * k)) * 32767),
                    int(max(-1, min(1, buf.r[i] * k)) * 32767))
        for i in range(n))
    w.writeframes(frames)
    w.close()

def main():
    for name, fn in RECIPES.items():
        b = fn()
        path = f'assets/sfx/{name}.wav'
        write_wav(path, b)
        print(f'{path} {len(b.l) / SR:.2f}s')
    print(f'{len(RECIPES)} files')

if __name__ == '__main__':
    main()
