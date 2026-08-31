import tkinter as tk
from fractions import Fraction
import math
import io
import wave
import struct
import pygame

# =========================
# 基本設定
# =========================
BASE_FREQ = 261.625565
SAMPLE_RATE = 44100
LOOP_SECONDS = 0.55
VOLUME = 0.13
FADE_IN_MS = 10
TOGGLE_KEY = "P"

# =========================
# 1.2 オクターブ移動
# =========================
MIN_OCTAVE_SHIFT = -2
MAX_OCTAVE_SHIFT = 2

OCTAVE_DOWN_KEY = "Q"   # 1/2倍
OCTAVE_UP_KEY = "W"     # 2倍
OCTAVE_RESET_KEY = "A"  # 1倍に戻す

# =========================
# 鳴らす瞬間だけのエコー設定
# =========================
ATTACK_ECHO_ENABLED = True
ATTACK_ECHO_DELAY_MS = 85
ATTACK_ECHO_AMOUNT = 0.18
ATTACK_ECHO_REPEATS = 2
ATTACK_ECHO_DECAY = 0.42
ATTACK_ECHO_SECONDS = 0.42
ATTACK_ECHO_VOLUME = 0.065

# =========================
# 対応表
# =========================
BASE_NOTE_MAP = {
    "Z": "1/1",
    "S": "10/9",
    "E": "135/128",
    "4": "25/24",
    "X": "9/8",
    "D": "81/64",
    "R": "75/64",
    "C": "5/4",
    "F": "675/512",
    "V": "4/3",
    "G": "40/27",
    "Y": "45/32",
    "7": "25/18",
    "B": "3/2",
    "H": "27/16",
    "U": "25/16",
    "N": "5/3",
    "J": "16/9",
    "I": "225/128",
    "M": "15/8",
    "K": "2025/1024",
    ",": "2/1",
}

ALT_OVERRIDES = {
    "4": "16/15",
    "X": "800/729",
    "D": "100/81",
    "R": "6/5",
    "F": "27/20",
    "G": "3200/2187",
    "7": "64/45",
    "H": "400/243",
    "U": "8/5",
    "I": "9/5",
}

WHITE_KEYS = ["Z", "X", "C", "V", "B", "N", "M", ","]

# 列構造（下から順）
COLUMNS = [
    ["S", "E", "4"],
    ["D", "R"],
    ["F"],
    ["G", "Y", "7"],
    ["H", "U"],
    ["J", "I"],
    ["K"],
]

# 下段でも黒にしたいキー
BLACK_BOTTOM_KEYS = {"J"}

# 灰色鍵で、キー名を比率の横に出したいもの
INLINE_GRAY_KEYS = {"D", "H"}

PLAYABLE_KEYS = set(BASE_NOTE_MAP.keys())

# =========================
# 音生成：4'単独リード風・低〜中倍音中心
# =========================
def reed_organ_steady_wave(freq: float, t: float) -> float:
    """
    4'単独リード風。
    複数ストップを重ねているのではなく、
    1つのリード音色に含まれる倍音成分を合成している。

    高次倍音の「ぎーん」を抑え、低〜中倍音中心にする。
    """

    harmonics = [
        (1, 1.00),
        (2, 0.73),
        (3, 0.52),
        (4, 0.41),
        (5, 0.31),
        (6, 0.27),
        (7, 0.24),
    ]

    s = 0.0
    amp_sum = 0.0

    for mul, amp in harmonics:
        phase = 0.10 * mul
        s += amp * math.sin(2.0 * math.pi * freq * mul * t + phase)
        amp_sum += amp

    s = s / amp_sum

    # リードっぽい硬さを少しだけ足す。
    # 強くしすぎると「ギーン」になるので控えめ。
    drive = 1.55
    s = math.tanh(drive * s) / math.tanh(drive)

    return s


def make_loop_wav_bytes(freq: float) -> bytes:
    """
    ループ再生用の短いWAVを作る。
    周期数を整数にして、ループ境界でプチッと鳴りにくくする。
    """

    cycles = max(20, int(freq * LOOP_SECONDS))
    n = int(round(cycles * SAMPLE_RATE / freq))

    frames = bytearray()

    for i in range(n):
        t = i / SAMPLE_RATE
        sample = reed_organ_steady_wave(freq, t)
        sample *= VOLUME
        sample = max(-1.0, min(1.0, sample))
        frames.extend(struct.pack("<h", int(sample * 32767)))

    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(frames)

    return buf.getvalue()


def attack_echo_envelope(t: float) -> float:
    """
    鳴らした瞬間だけの短い音。
    持続音ではなく、エコー用のアタック成分。
    """
    attack = 0.006
    decay = 0.075

    if t < 0:
        return 0.0

    if t < attack:
        atk = t / attack
    else:
        atk = 1.0

    return atk * math.exp(-t / decay)


def make_attack_echo_wav_bytes(freq: float) -> bytes:
    """
    キーを押した瞬間だけ重ねる短いエコー音。
    ループ音には混ぜない。
    """
    n = int(ATTACK_ECHO_SECONDS * SAMPLE_RATE)
    delay_samples = int((ATTACK_ECHO_DELAY_MS / 1000.0) * SAMPLE_RATE)

    frames = bytearray()

    for i in range(n):
        sample = 0.0

        for repeat in range(ATTACK_ECHO_REPEATS + 1):
            j = i - repeat * delay_samples

            if j < 0:
                continue

            t = j / SAMPLE_RATE

            if repeat == 0:
                amp = 1.0
            else:
                amp = ATTACK_ECHO_AMOUNT * (ATTACK_ECHO_DECAY ** (repeat - 1))

            sample += amp * reed_organ_steady_wave(freq, t) * attack_echo_envelope(t)

        sample *= ATTACK_ECHO_VOLUME
        sample = max(-1.0, min(1.0, sample))
        frames.extend(struct.pack("<h", int(sample * 32767)))

    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(frames)

    return buf.getvalue()


pygame.mixer.pre_init(SAMPLE_RATE, -16, 1, 256)
pygame.init()
if pygame.mixer.get_init() is None:
    pygame.mixer.init(frequency=SAMPLE_RATE, size=-16, channels=1, buffer=256)
pygame.mixer.set_num_channels(64)

# =========================
# 状態
# =========================
alt_mode = False
octave_shift = 0

pressed_keys = set()
sound_cache = {}
attack_echo_cache = {}
flash_jobs = {}
key_items = {}

# 押しているキーごとの再生チャンネル
active_channels = {}

# =========================
# 比率 / 周波数
# =========================
def ratio_text_for(key: str, use_alt: bool) -> str:
    if use_alt and key in ALT_OVERRIDES:
        return ALT_OVERRIDES[key]
    return BASE_NOTE_MAP[key]


def fraction_for(key: str, use_alt: bool) -> Fraction:
    return Fraction(ratio_text_for(key, use_alt))


def octave_multiplier_text() -> str:
    if octave_shift == 0:
        return "1倍"
    if octave_shift > 0:
        return f"{2 ** octave_shift}倍"
    return f"1/{2 ** (-octave_shift)}倍"


def freq_for(key: str, use_alt: bool, shift: int = None) -> float:
    if shift is None:
        shift = octave_shift
    return BASE_FREQ * float(fraction_for(key, use_alt)) * (2 ** shift)


def cents_of(key: str, use_alt: bool) -> float:
    fr = fraction_for(key, use_alt)
    return 1200.0 * math.log2(float(fr))


def prepare_sounds():
    for shift in range(MIN_OCTAVE_SHIFT, MAX_OCTAVE_SHIFT + 1):
        for mode in (False, True):
            for key in PLAYABLE_KEYS:
                hz = freq_for(key, mode, shift)

                wav_data = make_loop_wav_bytes(hz)
                sound_cache[(mode, shift, key)] = pygame.mixer.Sound(file=io.BytesIO(wav_data))

                echo_wav_data = make_attack_echo_wav_bytes(hz)
                attack_echo_cache[(mode, shift, key)] = pygame.mixer.Sound(file=io.BytesIO(echo_wav_data))

# =========================
# UI
# =========================
root = tk.Tk()
root.title("田中正平 純正調オルガン 風 1.2")
root.configure(bg="#3f9640")

mode_var = tk.StringVar()
info_var = tk.StringVar()

top = tk.Frame(root, bg="#3f9640", padx=10, pady=8)
top.pack(fill="x")

tk.Label(
    top,
    text="田中正平 純正調オルガン 風キーボード 1.2",
    font=("Yu Gothic UI", 15, "bold"),
    fg="white",
    bg="#3f9640",
).pack(anchor="w")

tk.Label(
    top,
    textvariable=mode_var,
    font=("Yu Gothic UI", 11, "bold"),
    fg="white",
    bg="#3f9640",
).pack(anchor="w", pady=(2, 2))

tk.Label(
    top,
    textvariable=info_var,
    font=("Yu Gothic UI", 10),
    fg="white",
    bg="#3f9640",
    justify="left",
    anchor="w",
).pack(anchor="w")

canvas = tk.Canvas(root, width=1120, height=500, bg="#3f9640", highlightthickness=0)
canvas.pack(padx=10, pady=8)

# 背景
canvas.create_rectangle(60, 30, 1085, 455, fill="#f0f0f0", outline="#f0f0f0")
canvas.create_rectangle(78, 70, 1100, 405, outline="#555555", width=2)

# 切替ボタン
toggle_circle = canvas.create_oval(15, 110, 80, 175, width=3, outline="#2f64ff", fill="#427bff")
toggle_text = canvas.create_text(47, 142, text="P", fill="white", font=("Yu Gothic UI", 18, "bold"))
toggle_label = canvas.create_text(47, 192, text="切替", fill="white", font=("Yu Gothic UI", 13, "bold"))

# =========================
# レイアウト
# =========================
WHITE_START_X = 105
WHITE_W = 120
WHITE_H = 290
WHITE_Y = 87

white_x = [WHITE_START_X + i * WHITE_W for i in range(8)]
for x in white_x:
    canvas.create_line(x, WHITE_Y, x, WHITE_Y + WHITE_H, fill="#3e9640", width=3)

canvas.create_line(
    WHITE_START_X + 8 * WHITE_W,
    WHITE_Y,
    WHITE_START_X + 8 * WHITE_W,
    WHITE_Y + WHITE_H,
    fill="#3e9640",
    width=3,
)

column_cx = [WHITE_START_X + WHITE_W * (i + 1) for i in range(7)]

GRAY_W, GRAY_H = 76, 48
MID_W, MID_H = 76, 58
TOP_W, TOP_H = 76, 135

GRAY_Y = 255
MID_Y = 188
TOP_Y = 35

TWO_BOTTOM_W, TWO_BOTTOM_H = 76, 58
TWO_TOP_W, TWO_TOP_H = 76, 175
TWO_BOTTOM_Y = 188
TWO_TOP_Y = 35

ONE_W, ONE_H = 76, 210
ONE_Y = 35

# =========================
# 色
# =========================
def normal_fill(kind: str):
    if kind == "white":
        return "#ffffff"
    if kind == "gray":
        return "#a9a9a9"
    return "#000000"


def active_fill(kind: str):
    if kind == "white":
        return "#ffd56d"
    if kind == "gray":
        return "#e1ba73"
    if kind == "black":
        return "#d65c5c"
    return "#cccccc"

# =========================
# 情報
# =========================
def update_mode_label():
    echo_text = "ON" if ATTACK_ECHO_ENABLED else "OFF"
    mode_var.set(
        f"モード: {'切替 ON' if alt_mode else '通常'}   "
        f"オクターブ: {octave_shift:+d} ({octave_multiplier_text()})   "
        f"Q=1/2倍  W=2倍  A=戻す  P=切替   起音エコー={echo_text}"
    )

    if alt_mode:
        canvas.itemconfig(toggle_circle, fill="#ff7d7d", outline="#ffd7d7")
    else:
        canvas.itemconfig(toggle_circle, fill="#427bff", outline="#2f64ff")


def copy_ratio(text: str):
    root.clipboard_clear()
    root.clipboard_append(text)
    root.update()


def show_info(key: str):
    ratio = ratio_text_for(key, alt_mode)
    hz = freq_for(key, alt_mode)
    cents = cents_of(key, alt_mode)

    info_var.set(
        f"最後に鳴らしたキー: {key}    比率: {ratio}    "
        f"オクターブ: {octave_shift:+d} ({octave_multiplier_text()})    "
        f"周波数: {hz:.6f} Hz    セント: {cents:.4f}\n"
        f"比率 {ratio} をクリップボードにコピーしました。"
    )

    copy_ratio(ratio)

# =========================
# 見た目更新
# =========================
def set_key_visual(key: str, active: bool):
    if key not in key_items:
        return
    item = key_items[key]
    kind = item["kind"]
    canvas.itemconfig(item["rect"], fill=active_fill(kind) if active else normal_fill(kind))


def activate_key(key: str):
    set_key_visual(key, True)


def deactivate_key(key: str):
    if key in pressed_keys:
        return
    set_key_visual(key, False)


def flash_key(key: str, ms=450):
    activate_key(key)
    if key in flash_jobs:
        try:
            root.after_cancel(flash_jobs[key])
        except Exception:
            pass
    flash_jobs[key] = root.after(ms, lambda k=key: deactivate_key(k))

# =========================
# 音
# =========================
def start_note(key: str):
    if key in active_channels:
        return

    snd = sound_cache.get((alt_mode, octave_shift, key))
    if snd is not None:
        ch = snd.play(loops=-1, fade_ms=FADE_IN_MS)
        if ch is not None:
            active_channels[key] = ch

    # 鳴らす瞬間だけ、短いエコーを重ねる
    if ATTACK_ECHO_ENABLED:
        echo = attack_echo_cache.get((alt_mode, octave_shift, key))
        if echo is not None:
            echo.play()

    show_info(key)


def stop_note(key: str):
    ch = active_channels.pop(key, None)
    if ch is not None:
        ch.stop()


def stop_all_notes():
    for ch in list(active_channels.values()):
        ch.stop()
    active_channels.clear()

    for key in PLAYABLE_KEYS:
        set_key_visual(key, False)

# =========================
# オクターブ操作
# =========================
def set_octave_shift(new_shift: int):
    global octave_shift

    new_shift = max(MIN_OCTAVE_SHIFT, min(MAX_OCTAVE_SHIFT, new_shift))

    stop_all_notes()

    octave_shift = new_shift
    update_mode_label()

    info_var.set(
        f"オクターブを {octave_shift:+d} ({octave_multiplier_text()}) にしました。"
    )


def octave_down():
    set_octave_shift(octave_shift - 1)


def octave_up():
    set_octave_shift(octave_shift + 1)


def octave_reset():
    set_octave_shift(0)

# =========================
# 部品作成
# =========================
def bind_key_area(tag, key):
    canvas.tag_bind(tag, "<Button-1>", lambda e, k=key: on_mouse_note(k))


def create_labeled_key(tag, x1, y1, x2, y2, key, kind="black", key_color="white", ratio_color="#84bfff"):
    rect = canvas.create_rectangle(
        x1, y1, x2, y2,
        fill=normal_fill(kind),
        outline="#1e1e1e",
        width=2,
        tags=(tag,),
    )
    h = y2 - y1

    if kind == "white":
        canvas.create_text(
            (x1 + x2) / 2,
            y2 - 58,
            text=key,
            font=("Consolas", 22, "bold"),
            fill="#111111",
            tags=(tag,),
        )
        ratio_id = canvas.create_text(
            (x1 + x2) / 2,
            y2 - 25,
            text=ratio_text_for(key, alt_mode),
            font=("Yu Gothic UI", 12, "bold"),
            fill="#111111",
            tags=(tag,),
        )

    elif kind == "gray":
        if key in INLINE_GRAY_KEYS:
            baseline_y = y1 + h * 0.62

            canvas.create_text(
                (x1 + x2) / 2 - 10,
                baseline_y,
                text=key,
                font=("Consolas", 13, "bold"),
                fill="white",
                tags=(tag,),
                anchor="e",
            )

            ratio_id = canvas.create_text(
                (x1 + x2) / 2 - 6,
                baseline_y,
                text=ratio_text_for(key, alt_mode),
                font=("Yu Gothic UI", 10, "bold"),
                fill="#f7f7f7",
                tags=(tag,),
                anchor="w",
            )
        else:
            canvas.create_text(
                (x1 + x2) / 2,
                y1 + h * 0.28,
                text=key,
                font=("Consolas", 16, "bold"),
                fill="white",
                tags=(tag,),
            )
            ratio_id = canvas.create_text(
                (x1 + x2) / 2,
                y1 + h * 0.68,
                text=ratio_text_for(key, alt_mode),
                font=("Yu Gothic UI", 10, "bold"),
                fill="#f7f7f7",
                tags=(tag,),
            )

    else:
        if key in BLACK_BOTTOM_KEYS:
            baseline_y = y1 + h * 0.62

            canvas.create_text(
                (x1 + x2) / 2 - 10,
                baseline_y,
                text=key,
                font=("Consolas", 13, "bold"),
                fill="white",
                tags=(tag,),
                anchor="e",
            )

            ratio_id = canvas.create_text(
                (x1 + x2) / 2 - 6,
                baseline_y,
                text=ratio_text_for(key, alt_mode),
                font=("Yu Gothic UI", 10, "bold"),
                fill=ratio_color,
                tags=(tag,),
                anchor="w",
            )
        else:
            canvas.create_text(
                (x1 + x2) / 2,
                y1 + h * 0.28,
                text=key,
                font=("Consolas", 18, "bold"),
                fill=key_color,
                tags=(tag,),
            )
            ratio_id = canvas.create_text(
                (x1 + x2) / 2,
                y1 + h * 0.62,
                text=ratio_text_for(key, alt_mode),
                font=("Yu Gothic UI", 10, "bold"),
                fill=ratio_color,
                tags=(tag,),
            )

    key_items[key] = {"rect": rect, "ratio_id": ratio_id, "kind": kind}
    bind_key_area(tag, key)

# =========================
# 白鍵
# =========================
for i, key in enumerate(WHITE_KEYS):
    x1 = WHITE_START_X + i * WHITE_W
    x2 = x1 + WHITE_W
    create_labeled_key(f"white_{key}", x1, WHITE_Y, x2, WHITE_Y + WHITE_H, key, kind="white")

# =========================
# 列描画
# =========================
for cx, keys in zip(column_cx, COLUMNS):
    if len(keys) == 3:
        bottom, middle, top = keys

        create_labeled_key(
            f"col_{bottom}",
            cx - GRAY_W / 2,
            GRAY_Y,
            cx + GRAY_W / 2,
            GRAY_Y + GRAY_H,
            bottom,
            kind="gray",
        )
        create_labeled_key(
            f"col_{middle}",
            cx - MID_W / 2,
            MID_Y,
            cx + MID_W / 2,
            MID_Y + MID_H,
            middle,
            kind="black",
        )
        create_labeled_key(
            f"col_{top}",
            cx - TOP_W / 2,
            TOP_Y,
            cx + TOP_W / 2,
            TOP_Y + TOP_H,
            top,
            kind="black",
        )

    elif len(keys) == 2:
        bottom, top = keys
        bottom_kind = "black" if bottom in BLACK_BOTTOM_KEYS else "gray"

        create_labeled_key(
            f"col_{bottom}",
            cx - TWO_BOTTOM_W / 2,
            TWO_BOTTOM_Y,
            cx + TWO_BOTTOM_W / 2,
            TWO_BOTTOM_Y + TWO_BOTTOM_H,
            bottom,
            kind=bottom_kind,
        )
        create_labeled_key(
            f"col_{top}",
            cx - TWO_TOP_W / 2,
            TWO_TOP_Y,
            cx + TWO_TOP_W / 2,
            TWO_TOP_Y + TWO_TOP_H,
            top,
            kind="black",
        )

    elif len(keys) == 1:
        only = keys[0]
        create_labeled_key(
            f"col_{only}",
            cx - ONE_W / 2,
            ONE_Y,
            cx + ONE_W / 2,
            ONE_Y + ONE_H,
            only,
            kind="black",
        )

# =========================
# クリック / キーボード
# =========================
def on_mouse_note(key: str):
    # マウスクリックは0.45秒だけ鳴らす
    if key in active_channels:
        stop_note(key)

    start_note(key)
    flash_key(key, ms=450)
    root.after(450, lambda k=key: stop_note(k))


def toggle_mode():
    global alt_mode

    stop_all_notes()

    alt_mode = not alt_mode
    update_mode_label()

    for key, item in key_items.items():
        canvas.itemconfig(item["ratio_id"], text=ratio_text_for(key, alt_mode))

    info_var.set(f"モードを {'切替 ON' if alt_mode else '通常'} に切り替えました。")


def normalize_key(event):
    ch = event.char
    if ch:
        if ch.isalpha():
            ch = ch.upper()

        if ch in PLAYABLE_KEYS or ch == TOGGLE_KEY:
            return ch

        if ch == OCTAVE_DOWN_KEY:
            return OCTAVE_DOWN_KEY

        if ch == OCTAVE_UP_KEY:
            return OCTAVE_UP_KEY

        if ch == OCTAVE_RESET_KEY:
            return OCTAVE_RESET_KEY

    ks = event.keysym
    if ks:
        if ks.lower() == "comma":
            return ","

        ks = ks.upper()

        if ks in PLAYABLE_KEYS or ks == TOGGLE_KEY:
            return ks

        if ks == OCTAVE_DOWN_KEY:
            return OCTAVE_DOWN_KEY

        if ks == OCTAVE_UP_KEY:
            return OCTAVE_UP_KEY

        if ks == OCTAVE_RESET_KEY:
            return OCTAVE_RESET_KEY

    return None


def on_key_press(event):
    key = normalize_key(event)
    if key is None:
        return

    if key in pressed_keys:
        return

    pressed_keys.add(key)

    if key == TOGGLE_KEY:
        toggle_mode()
        return

    if key == OCTAVE_DOWN_KEY:
        octave_down()
        return

    if key == OCTAVE_UP_KEY:
        octave_up()
        return

    if key == OCTAVE_RESET_KEY:
        octave_reset()
        return

    if key in PLAYABLE_KEYS:
        activate_key(key)
        start_note(key)


def on_key_release(event):
    key = normalize_key(event)
    if key is None:
        return

    if key in pressed_keys:
        pressed_keys.remove(key)

    if key in PLAYABLE_KEYS:
        stop_note(key)
        deactivate_key(key)


# 切替ボタン
for item in (toggle_circle, toggle_text, toggle_label):
    canvas.tag_bind(item, "<Button-1>", lambda e: toggle_mode())

# =========================
# 起動
# =========================
info_var.set("音を準備中…少し待ってね。")
root.update()

prepare_sounds()
update_mode_label()

info_var.set(
    "1.2：キーを押している間だけ鳴ります。離すと止まります。\n"
    "Qで1/2倍、Wで2倍、Aでリセット。起音エコーつきです。"
)

root.bind_all("<KeyPress>", on_key_press)
root.bind_all("<KeyRelease>", on_key_release)


def on_close():
    try:
        stop_all_notes()
        pygame.mixer.quit()
        pygame.quit()
    except Exception:
        pass
    root.destroy()


root.protocol("WM_DELETE_WINDOW", on_close)
root.after(200, root.focus_force)
root.mainloop()