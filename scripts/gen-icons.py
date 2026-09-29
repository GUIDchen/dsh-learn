#!/usr/bin/env python3
"""生成 PWA / macOS 图标（纯标准库，不依赖 Pillow）。
画一个终端窗口样式的图标：深色圆角底 + 绿色提示符 ">_"。
用法：python3 scripts/gen-icons.py [输出目录]
"""
import os
import struct
import sys
import zlib

BG = (27, 36, 48, 255)        # 深蓝灰底
FG = (61, 220, 151, 255)      # 终端绿
FRAME = (58, 74, 94, 255)     # 窗口描边


def rounded_alpha(x, y, size, radius):
    """圆角矩形遮罩：返回 0..1 的覆盖率（简化的 1px 抗锯齿）。"""
    cx = min(max(x, radius), size - 1 - radius)
    cy = min(max(y, radius), size - 1 - radius)
    dx = x - cx
    dy = y - cy
    dist = (dx * dx + dy * dy) ** 0.5
    if dist <= radius - 1:
        return 1.0
    if dist >= radius:
        return 0.0
    return radius - dist


def blend(base, color):
    a = color[3] / 255.0
    return (
        int(base[0] * (1 - a) + color[0] * a),
        int(base[1] * (1 - a) + color[1] * a),
        int(base[2] * (1 - a) + color[2] * a),
    )


def draw_pixel(buffer, size, x, y, color, alpha=1.0):
    if alpha <= 0 or x < 0 or y < 0 or x >= size or y >= size:
        return
    idx = (y * size + x) * 4
    cur = (buffer[idx], buffer[idx + 1], buffer[idx + 2])
    merged = blend(cur, (color[0], color[1], color[2], int(color[3] * alpha)))
    buffer[idx] = merged[0]
    buffer[idx + 1] = merged[1]
    buffer[idx + 2] = merged[2]


def draw_rect(buffer, size, x0, y0, x1, y1, color):
    for y in range(max(0, int(y0)), min(size, int(y1))):
        for x in range(max(0, int(x0)), min(size, int(x1))):
            draw_pixel(buffer, size, x, y, color)


def draw_chevron(buffer, size, thickness, color):
    """画一个 ">" 折线：两条斜线。"""
    cx = size * 0.36
    top = size * 0.34
    mid = size * 0.5
    bottom = size * 0.66
    arm = size * 0.12
    steps = int(size * 0.8)
    for i in range(steps):
        t = i / float(steps - 1)
        if t <= 0.5:
            k = t / 0.5
            x = cx - arm + 2 * arm * k
            y = top + (mid - top) * k
        else:
            k = (t - 0.5) / 0.5
            x = cx + arm - 2 * arm * k
            y = mid + (bottom - mid) * k
        draw_rect(buffer, size, x - thickness / 2, y - thickness / 2, x + thickness / 2, y + thickness / 2, color)


def make_icon(size):
    buffer = bytearray(size * size * 4)
    radius = size * 0.22
    for y in range(size):
        for x in range(size):
            a = rounded_alpha(x, y, size, radius)
            if a <= 0:
                continue
            idx = (y * size + x) * 4
            buffer[idx] = BG[0]
            buffer[idx + 1] = BG[1]
            buffer[idx + 2] = BG[2]
            buffer[idx + 3] = int(255 * a)
    # 顶部标题栏
    draw_rect(buffer, size, size * 0.12, size * 0.16, size * 0.88, size * 0.24, FRAME)
    # ">" 提示符与 "_" 光标
    draw_chevron(buffer, size, max(2, size * 0.055), FG)
    draw_rect(buffer, size, size * 0.55, size * 0.63, size * 0.78, size * 0.63 + max(2, size * 0.06), FG)
    return bytes(buffer)


def write_png(path, size, rgba):
    raw = bytearray()
    stride = size * 4
    for y in range(size):
        raw.append(0)
        raw.extend(rgba[y * stride:(y + 1) * stride])

    def chunk(tag, data):
        out = struct.pack('>I', len(data)) + tag + data
        return out + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)

    header = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', header) + chunk(b'IDAT', zlib.compress(bytes(raw), 9)) + chunk(b'IEND', b'')
    with open(path, 'wb') as fh:
        fh.write(png)
    return path


def main():
    out_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'web', 'icons')
    out_dir = os.path.abspath(out_dir)
    os.makedirs(out_dir, exist_ok=True)
    written = []
    # 192/512 给 PWA 用；1024 给 macOS 的 .icns 用（其余尺寸由 sips 从 1024 缩）
    for size in (192, 512, 1024):
        written.append(write_png(os.path.join(out_dir, 'icon-%d.png' % size), size, make_icon(size)))
        print('生成', os.path.join(out_dir, 'icon-%d.png' % size))
    return written


if __name__ == '__main__':
    main()
