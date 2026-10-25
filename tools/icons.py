import sys, random, math
from PIL import Image, ImageDraw, ImageFilter
out = sys.argv[1]
S = 1024

def background(size, rounded):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    grad = Image.new('RGBA', (size, size))
    gd = ImageDraw.Draw(grad)
    cx, cy = size * 0.35, size * 0.3
    maxd = math.hypot(size, size)
    for r in range(int(maxd), 0, -4):
        t = r / maxd
        c0, c1 = (74, 52, 190), (13, 11, 30)
        k = min(1, t * 1.5)
        col = tuple(int(c0[i] * (1 - k) + c1[i] * k) for i in range(3)) + (255,)
        gd.ellipse([cx - r, cy - r, cx + r, cy + r], fill=col)
    rnd = random.Random(7)
    for _ in range(60):
        x, y = rnd.uniform(0, size), rnd.uniform(0, size)
        rr = rnd.uniform(1.5, 4.5) * size / 1024
        a = rnd.randint(90, 230)
        gd.ellipse([x - rr, y - rr, x + rr, y + rr], fill=(255, 255, 255, a))
    mask = Image.new('L', (size, size), 0)
    if rounded:
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * 0.22), fill=255)
    else:
        mask = Image.new('L', (size, size), 255)
    img.paste(grad, (0, 0), mask)
    return img

def rocket(size, scale):
    L = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(L)
    c = size / 2
    u = size * scale / 1000  # design units
    # flame
    flame = [(c - 9 * u, c + 26 * u), (c + 9 * u, c + 26 * u), (c, c + 48 * u)]
    d.polygon(flame, fill=(245, 158, 11, 255))
    d.polygon([(c - 5 * u, c + 26 * u), (c + 5 * u, c + 26 * u), (c, c + 38 * u)], fill=(253, 224, 71, 255))
    # fins
    d.polygon([(c - 13 * u, c + 6 * u), (c - 26 * u, c + 26 * u), (c - 12 * u, c + 22 * u)], fill=(157, 134, 255, 255))
    d.polygon([(c + 13 * u, c + 6 * u), (c + 26 * u, c + 26 * u), (c + 12 * u, c + 22 * u)], fill=(157, 134, 255, 255))
    # body: pointed top ellipse-ish
    body = []
    for i in range(0, 181):
        a = math.radians(i)
        x = c + 14 * u * math.cos(a)
        y = c + 6 * u - 40 * u * math.sin(a) ** 0.85
        body.append((x, y))
    body += [(c - 14 * u, c + 6 * u), (c - 12 * u, c + 24 * u), (c + 12 * u, c + 24 * u), (c + 14 * u, c + 6 * u)]
    d.polygon(body, fill=(246, 244, 255, 255))
    # window
    d.ellipse([c - 7 * u, c - 16 * u, c + 7 * u, c - 2 * u], fill=(109, 74, 255, 255), outline=(200, 190, 255, 255), width=int(2.5 * u))
    return L.rotate(-40, resample=Image.BICUBIC, center=(c, c))

def make(rounded, scale):
    bg = background(S, rounded)
    r = rocket(S, scale)
    glow = r.copy().filter(ImageFilter.GaussianBlur(S * 0.03))
    bg.alpha_composite(Image.eval(glow, lambda v: v // 3))
    bg.alpha_composite(r)
    return bg

icon = make(True, 6.6)
icon.resize((512, 512), Image.LANCZOS).save(f'{out}/icon-512.png')
icon.resize((192, 192), Image.LANCZOS).save(f'{out}/icon-192.png')
mask = make(False, 5.2)
mask.resize((512, 512), Image.LANCZOS).save(f'{out}/icon-maskable-512.png')
print('ok')
