"""Sign artwork for building 2 (flat textures, later warped onto the drawn blocks). Writes tex/*.html + tex/list.json."""
import json, os
os.makedirs('tex', exist_ok=True)
HEAD = """<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="../fonts/fonts.css"><style>
html,body{margin:0;padding:0;width:%dpx;height:%dpx;overflow:hidden;background:transparent}
.f{position:absolute;inset:0;overflow:hidden}
.c{position:absolute;display:flex;align-items:center;justify-content:center}
.v{writing-mode:vertical-rl;text-orientation:upright}
</style></head><body>"""
T = {}
def tex(name, w, h, body):
    T[name] = (w, h, body)

# ---------- top-right suspended box: deep-sea aquarium ad ----------
jelly = lambda x, y, s, o: f"""
<g transform="translate({x},{y}) scale({s})" opacity="{o}">
  <path d="M-60,0 C-60,-70 60,-70 60,0 C40,8 20,-2 0,6 C-20,-2 -40,8 -60,0Z" fill="url(#bell)"/>
  <path d="M-40,-8 C-30,-50 30,-50 40,-8" fill="none" stroke="#e8fbff" stroke-width="2" opacity=".7"/>
  {''.join(f'<path d="M{dx},4 C{dx+14},50 {dx-14},90 {dx+6},{150+abs(dx)} " fill="none" stroke="#9fe8ff" stroke-width="{2.4-abs(dx)/40}" opacity=".75" filter="url(#gl)"/>' for dx in (-44,-26,-10,8,24,42))}
  {''.join(f'<path d="M{dx},4 C{dx-6},60 {dx+10},120 {dx-4},{230-abs(dx)*2}" fill="none" stroke="#ffd1f4" stroke-width="5" opacity=".55" filter="url(#gl)"/>' for dx in (-14,4,16))}
</g>"""
SVGDEF = """<defs><radialGradient id="bell" cx="50%" cy="80%" r="70%"><stop offset="0" stop-color="#ffffff"/><stop offset=".35" stop-color="#bff3ff"/><stop offset=".75" stop-color="#4fb7ff" stop-opacity=".75"/><stop offset="1" stop-color="#2a3cff" stop-opacity=".2"/></radialGradient>
<filter id="gl" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="gl2" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="10" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>"""
bubbles = ''.join(f'<circle cx="{(i*137)%700}" cy="{(i*251)%900}" r="{2+(i%5)}" fill="none" stroke="#bfefff" stroke-width="1.5" opacity="{.25+.1*(i%4)}"/>' for i in range(40))
tex('trbox_left', 700, 900, f"""<div class="f" style="background:radial-gradient(120% 90% at 60% 35%,#1a3cff 0%,#0a12c8 40%,#050670 80%,#03023a 100%)"></div>
<svg class="f" width="700" height="900" viewBox="0 0 700 900">{SVGDEF}{bubbles}{jelly(470,300,2.4,1)}{jelly(200,520,1.4,.85)}{jelly(560,700,.9,.7)}</svg>
""")
tex('trbox_front', 1100, 640, f"""<div class="f" style="background:linear-gradient(170deg,#3b2cff 0%,#2414e0 45%,#130a9a 100%)"></div>
<svg class="f" width="1100" height="640">{SVGDEF}
{''.join(f'<path d="M0,{300+i*34} C250,{260+i*34} 520,{350+i*34} 1100,{280+i*34}" fill="none" stroke="#7fd7ff" stroke-width="2" opacity="{.06+.03*i}"/>' for i in range(10))}
{jelly(930,170,1.0,.9)}</svg>
<div class="c" style="left:60px;top:40px;font-family:'Orbitron';font-weight:900;font-size:190px;letter-spacing:6px;color:#eafcff;text-shadow:0 0 14px #8fe3ff,0 0 44px #4a8cff">AQUA</div>
<div class="c" style="left:66px;top:265px;font-family:'Dela Gothic One';font-size:78px;color:#ffffff;text-shadow:0 0 12px #7fd0ff">深海水族館</div>
<div class="c" style="left:70px;top:375px;font-family:'Rajdhani';font-weight:700;font-size:44px;letter-spacing:8px;color:#bfeaff">DEEP SEA AQUARIUM · 140F</div>
<div class="c" style="left:70px;top:440px;width:520px;height:6px;background:#9fe8ff;box-shadow:0 0 12px #9fe8ff"></div>""")
tex('trbox_top', 900, 400, """<div class="f" style="background:linear-gradient(180deg,#141018 0%,#1d1624 70%,#2a1f36 100%)"></div>
<svg class="f" width="900" height="400">
""" + ''.join(f'<line x1="{x}" y1="0" x2="{x}" y2="400" stroke="#0a080c" stroke-width="3"/>' for x in range(0, 900, 75)) +
''.join(f'<rect x="{80+i*190}" y="{60+(i%2)*90}" width="110" height="70" fill="#0d0b10" stroke="#2c2434" stroke-width="3"/><circle cx="{135+i*190}" cy="{95+(i%2)*90}" r="26" fill="#08070a" stroke="#3a3044" stroke-width="2"/>' for i in range(4)) + """
<rect x="0" y="382" width="900" height="18" fill="#b9a2ff"/><rect x="0" y="376" width="900" height="6" fill="#6f4dff" opacity=".6"/>
<circle cx="40" cy="40" r="7" fill="#ff2a2a"/><circle cx="860" cy="40" r="7" fill="#ff2a2a"/></svg>""")

# ---------- stacked pink lightboxes ----------
tex('pink_top', 420, 300, """<div class="f" style="background:radial-gradient(90% 80% at 50% 45%,#f6d0ff 0%,#e19bff 55%,#c46ef0 100%)"></div>
<div class="c" style="left:0;right:0;top:20px;font-family:'Dela Gothic One';font-size:120px;color:#41104f">夜光</div>
<div class="c" style="left:0;right:0;top:182px;font-family:'Bungee';font-size:72px;letter-spacing:10px;color:#5a1470">BAR</div>""")
tex('pink_bot', 420, 300, """<div class="f" style="background:radial-gradient(90% 80% at 50% 45%,#f6d0ff 0%,#e19bff 55%,#c46ef0 100%)"></div>
<div class="c" style="left:0;right:0;top:30px;font-family:'Bungee';font-size:86px;color:#4a0f5c">OPEN</div>
<div class="c" style="left:0;right:0;top:150px;font-family:'Dela Gothic One';font-size:84px;color:#4a0f5c">２４時</div>""")
tex('pink_mid', 420, 300, """<div class="f" style="background:linear-gradient(180deg,#1b0f22,#2b1736 50%,#1b0f22)"></div>
<svg class="f" width="420" height="300">""" + ''.join(f'<circle cx="{25+i*41}" cy="{y}" r="11" fill="#fff1c8"/><circle cx="{25+i*41}" cy="{y}" r="17" fill="#ffb86a" opacity=".35"/>' for i in range(10) for y in (70, 230)) + """</svg>""")

# ---------- vertical mint pharmacy / cream ticker / pale green hotel ----------
tex('mint_v1', 300, 960, """<div class="f" style="background:linear-gradient(90deg,#c8ffe0 0%,#effff6 50%,#c8ffe0 100%)"></div>
<svg class="f" width="300" height="960"><path d="M125 40h50v35h35v50h-35v35h-50v-35h-35v-50h35z" fill="#0a9a4a"/></svg>
<div class="c v" style="left:0;right:0;top:200px;font-family:'Dela Gothic One';font-size:150px;color:#063f22">くすり</div>
<div class="c" style="left:0;right:0;top:880px;font-family:'Rajdhani';font-weight:700;font-size:40px;letter-spacing:4px;color:#0a6a34">PHARMACY</div>""")
tex('cream_h', 1100, 260, """<div class="f" style="background:linear-gradient(180deg,#fffbe2 0%,#fdf6c8 60%,#f1e7a6 100%)"></div>
<svg class="f" width="1100" height="260"><circle cx="110" cy="130" r="82" fill="#d81e2a"/><circle cx="110" cy="130" r="58" fill="#fffbe2"/></svg>
<div class="c" style="left:62px;top:70px;width:96px;height:120px;font-family:'Russo One';font-size:92px;color:#1a1a1a">7</div>
<div class="c" style="left:230px;top:24px;font-family:'Dela Gothic One';font-size:92px;color:#151515">環状七号線</div>
<div class="c" style="left:236px;top:150px;font-family:'Rajdhani';font-weight:700;font-size:58px;letter-spacing:6px;color:#2a2a2a">RING LINE 7 &nbsp;<span style="color:#d81e2a">▶</span>&nbsp; 北門 23:47</div>""")
tex('mint_v2', 280, 1060, """<div class="f" style="background:linear-gradient(90deg,#c6f7a6 0%,#e9ffd8 50%,#c6f7a6 100%)"></div>
<div class="c v" style="left:0;right:0;top:40px;font-family:'Dela Gothic One';font-size:170px;color:#0e3d12">ホテル</div>
<div class="c" style="left:0;right:0;top:640px;font-family:'Limelight';font-size:62px;color:#14531a">MIDORI</div>
<div class="c" style="left:30px;right:30px;top:760px;height:200px;background:#1a1a1a;border-radius:10px"></div>
<div class="c v" style="left:0;right:0;top:775px;font-family:'DotGothic16';font-size:84px;color:#ff3b2f;text-shadow:0 0 10px #ff3b2f">空室</div>""")

# ---------- big magenta screen with pudding mascot ----------
tex('mag', 1200, 900, """<div class="f" style="background:radial-gradient(110% 90% at 50% 40%,#e01ae6 0%,#b10cba 45%,#6a0678 100%)"></div>
<svg class="f" width="1200" height="900">""" + ''.join(f'<path d="M{-200+i*120},900 L{200+i*120},0" stroke="#ff9cf6" stroke-width="18" opacity=".05"/>' for i in range(16)) + """</svg>
<div class="c" style="left:40px;top:24px;font-family:'Dela Gothic One';font-size:56px;color:#fff;background:#ff2f6e;padding:6px 18px;border-radius:8px">新発売</div>
<div class="c" style="left:40px;top:770px;font-family:'Bungee';font-size:104px;letter-spacing:6px;color:#fff6c2;text-shadow:0 5px 0 #6a0678,0 0 30px #ffd2fb">PURIN</div>
<div class="c" style="left:560px;top:790px;font-family:'Dela Gothic One';font-size:58px;color:#ffffff">とろける夜のプリン</div>""")
tex('mascot', 800, 800, """<div class="f" style="background:radial-gradient(80% 80% at 45% 40%,#fffbd2 0%,#f8f3a8 55%,#e9df7c 100%)"></div>
<svg class="f" width="800" height="800">
<path d="M0,0 H800 V150 C760,150 750,250 700,250 C650,250 660,170 600,170 C540,170 560,300 500,300 C440,300 450,190 390,190 C330,190 340,260 280,260 C220,260 230,170 170,170 C110,170 110,230 60,230 C20,230 20,170 0,170 Z" fill="#7a3f12"/>
<path d="M0,0 H800 V120 C760,120 750,200 700,200 C650,200 660,140 600,140 C540,140 560,250 500,250 C440,250 450,160 390,160 C330,160 340,220 280,220 C220,220 230,140 170,140 C110,140 110,190 60,190 C20,190 20,140 0,140 Z" fill="#9c5418"/>
<ellipse cx="160" cy="70" rx="90" ry="22" fill="#d9965a" opacity=".6"/>
<ellipse cx="270" cy="440" rx="42" ry="58" fill="#1a1208"/><ellipse cx="530" cy="440" rx="42" ry="58" fill="#1a1208"/>
<circle cx="284" cy="420" r="15" fill="#fff"/><circle cx="544" cy="420" r="15" fill="#fff"/>
<ellipse cx="190" cy="530" rx="62" ry="34" fill="#ff8fa6" opacity=".75"/><ellipse cx="610" cy="530" rx="62" ry="34" fill="#ff8fa6" opacity=".75"/>
<path d="M350,520 C370,560 400,560 400,525 C400,560 430,560 450,520" fill="none" stroke="#1a1208" stroke-width="12" stroke-linecap="round"/></svg>""")

# ---------- small blue metro screen, blue bath-house column ----------
tex('kiosk', 320, 560, """<div class="f" style="background:linear-gradient(180deg,#1730ff,#0a17b8)"></div>
<svg class="f" width="320" height="560"><rect x="95" y="40" width="130" height="110" rx="22" fill="#fff"/><rect x="115" y="60" width="90" height="45" rx="8" fill="#1730ff"/>
<circle cx="125" cy="128" r="9" fill="#1730ff"/><circle cx="195" cy="128" r="9" fill="#1730ff"/><path d="M110 150 L90 175 M210 150 L230 175" stroke="#fff" stroke-width="8"/></svg>
<div class="c" style="left:0;right:0;top:190px;font-family:'Dela Gothic One';font-size:64px;color:#fff">地下鉄</div>
<div class="c" style="left:0;right:0;top:275px;font-family:'Orbitron';font-weight:900;font-size:44px;color:#fff">METRO</div>
<div class="c" style="left:0;right:0;top:345px;font-family:'Share Tech Mono';font-size:38px;color:#cfe0ff;line-height:1.25;flex-direction:column">
<div>B2 ↓ 23:51</div><div>B2 ↓ 00:04</div><div style="color:#ffe66a">B4 ↓ 00:12</div></div>""")
tex('pill', 220, 1100, """<div class="f" style="background:linear-gradient(90deg,#1b2db8 0%,#3550ff 50%,#1b2db8 100%);border-radius:110px"></div>
<div class="c" style="left:20px;top:30px;width:180px;height:180px;border-radius:50%;background:#fff"></div>
<div class="c" style="left:20px;top:30px;width:180px;height:180px;font-family:'Dela Gothic One';font-size:130px;color:#1b2db8">ゆ</div>
<div class="c v" style="left:0;right:0;top:260px;font-family:'Dela Gothic One';font-size:150px;color:#fff;text-shadow:0 0 12px #9fb4ff">銭湯</div>
<div class="c v" style="left:0;right:0;top:620px;font-family:'Zen Antique';font-size:70px;color:#dfe6ff">月の湯</div>
<div class="c" style="left:0;right:0;top:980px;font-family:'Rajdhani';font-weight:700;font-size:40px;color:#dfe6ff">♨ 24H</div>""")
for k, (ch) in zip(('r8', 'r9', 'r10', 'r11', 'r12'), ('酒', '茶', '麺', '湯', '宿')):
    tex('disc_' + k, 400, 400, f"""<div class="f" style="border-radius:50%;background:radial-gradient(60% 60% at 45% 40%,#4d6bff 0%,#1a2cff 55%,#0b10b0 100%)"></div>
<div class="f" style="border-radius:50%;box-shadow:inset 0 0 0 22px #e8eeff"></div>
<div class="c" style="left:0;right:0;top:0;bottom:0;font-family:'Dela Gothic One';font-size:230px;color:#ffffff">{ch}</div>""")

# ---------- warm curved arc banner ----------
tex('arc', 2600, 170, """<div class="f" style="background:linear-gradient(180deg,#fff0d2 0%,#ffdc99 55%,#f2c070 100%)"></div>
<div class="c" style="left:0;right:0;top:0;bottom:0;font-family:'Josefin Sans';font-weight:700;font-size:74px;letter-spacing:9px;color:#5a2a0e;white-space:nowrap">WELCOME TO RING SEVEN ✦ 第七環区へようこそ</div>""")

# ---------- curved capsule box + wedge fin ----------
tex('cap_front', 1100, 240, """<div class="f" style="background:linear-gradient(180deg,#5a46ff,#3220e6 60%,#22129e)"></div>
<div class="c" style="left:40px;top:0;bottom:0;font-family:'Orbitron';font-weight:900;font-size:96px;letter-spacing:2px;color:#ffffff;text-shadow:0 0 16px #b8a8ff">SKY LOUNGE</div>
<div class="c" style="left:930px;top:0;bottom:0;font-family:'Dela Gothic One';font-size:64px;color:#ffe9a8">72F</div>""")
tex('cap_top', 1100, 200, """<div class="f" style="background:linear-gradient(180deg,#5a0a5e 0%,#a10ea6 70%,#ff4dff 100%)"></div>
<svg class="f" width="1100" height="200">""" + ''.join(f'<rect x="{20+i*90}" y="40" width="60" height="90" fill="#2a0430" opacity=".55"/>' for i in range(12)) + """<rect x="0" y="186" width="1100" height="14" fill="#ffd0ff"/></svg>""")
tex('cap_end', 300, 300, """<div class="f" style="background:radial-gradient(80% 80% at 50% 50%,#ecc4ec,#b561b1)"></div>
<div class="c" style="left:50px;top:50px;width:200px;height:200px;border-radius:50%;border:12px solid #fff;box-sizing:border-box;font-family:'Russo One';font-size:100px;color:#fff">72</div>""")
tex('wedge_face', 1600, 150, """<div class="f" style="background:linear-gradient(90deg,#f6c983 0%,#ffe2ad 40%,#fff3d6 100%)"></div>
<div class="c" style="left:340px;top:0;bottom:0;font-family:'Josefin Sans';font-weight:700;font-size:74px;letter-spacing:10px;color:#5a2a0e;white-space:nowrap">LOUNGE ▸ ラウンジ ▸ 72F ▸</div>""")

# ---------- moon hotel billboard ----------
stars = ''.join(f'<circle cx="{(i*97)%1000}" cy="{(i*61)%1000}" r="{1+(i%3)*0.8}" fill="#e8f0ff" opacity="{.35+.2*(i%3)}"/>' for i in range(160))
tex('moon', 1000, 1000, f"""<div class="f" style="background:radial-gradient(90% 80% at 50% 35%,#2840ff 0%,#1420d8 45%,#0a0c80 100%)"></div>
<svg class="f" width="1000" height="1000">{stars}
<path d="M0,780 C200,720 380,800 560,760 C740,720 860,780 1000,740 L1000,1000 L0,1000Z" fill="#0b0f5a" opacity=".85"/>
<path d="M0,850 C220,800 420,880 640,840 C800,810 900,850 1000,830 L1000,1000 L0,1000Z" fill="#070940"/></svg>
<div class="c v" style="left:40px;top:60px;font-family:'Zen Antique';font-size:120px;color:#fff4d0;text-shadow:0 0 14px #fff1b8">月見</div>
<div class="c" style="left:0;right:0;top:840px;font-family:'Limelight';font-size:96px;letter-spacing:12px;color:#fff1c4;text-shadow:0 0 18px #ffe9a0">HOTEL LUNA</div>""")
tex('moon_disc', 400, 400, """<svg width="400" height="400"><defs><radialGradient id="m" cx="35%" cy="40%" r="70%"><stop offset="0" stop-color="#fffbe6"/><stop offset=".7" stop-color="#f3e6b8"/><stop offset="1" stop-color="#cdbb86"/></radialGradient>
<mask id="cr"><rect width="400" height="400" fill="#fff"/><circle cx="270" cy="160" r="185" fill="#000"/></mask></defs>
<circle cx="200" cy="200" r="198" fill="#10153a"/>
<circle cx="200" cy="200" r="198" fill="url(#m)" mask="url(#cr)"/>
<circle cx="120" cy="250" r="16" fill="#d8c894" opacity=".6" mask="url(#cr)"/><circle cx="80" cy="190" r="10" fill="#d8c894" opacity=".5" mask="url(#cr)"/></svg>""")

# ---------- green izakaya blades ----------
tex('blade1', 360, 1100, """<div class="f" style="background:linear-gradient(90deg,#2fb800,#4fe00c 50%,#2fb800)"></div>
<div class="c" style="left:70px;top:40px;width:220px;height:220px;border-radius:50%;background:#d0141e;font-family:'Dela Gothic One';font-size:150px;color:#fff">旨</div>
<div class="c v" style="left:0;right:0;top:300px;font-family:'Dela Gothic One';font-size:170px;color:#0a1a04">らーめん</div>""")
tex('blade2', 360, 1100, """<div class="f" style="background:linear-gradient(90deg,#94dd2e,#c2ff5a 50%,#94dd2e)"></div>
<div class="c v" style="left:0;right:0;top:60px;font-family:'Dela Gothic One';font-size:230px;color:#14240a">餃子</div>
<div class="c" style="left:0;right:0;top:620px;font-family:'Bungee';font-size:66px;color:#14240a">GYOZA</div>
<div class="c" style="left:40px;right:40px;top:760px;height:6px;background:#14240a"></div>
<div class="c" style="left:0;right:0;top:800px;font-family:'Dela Gothic One';font-size:80px;color:#c8141e">¥380</div>""")
tex('blade3', 360, 1100, """<div class="f" style="background:linear-gradient(90deg,#bfeaa6,#ecffe0 50%,#bfeaa6)"></div>
<svg class="f" width="360" height="1100"><rect x="105" y="60" width="130" height="170" rx="14" fill="#f2b81c"/><rect x="105" y="60" width="130" height="44" rx="14" fill="#fffaf0"/>
<path d="M235 100 h30 a30 30 0 0 1 30 30 v40 a30 30 0 0 1 -30 30 h-30" fill="none" stroke="#f2b81c" stroke-width="18"/></svg>
<div class="c v" style="left:0;right:0;top:290px;font-family:'Dela Gothic One';font-size:160px;color:#123a10">生ビール</div>""")
tex('L_face', 400, 400, """<div class="f" style="background:radial-gradient(90% 90% at 50% 50%,#d6ffd9,#7cff83 70%,#4fd658)"></div>""")

# ---------- ring band ----------
tex('band_top', 2400, 260, """<div class="f" style="background:linear-gradient(180deg,#ff3f8f 0%,#ff6aa8 50%,#ff9cc2 100%)"></div>
<svg class="f" width="2400" height="260">""" + ''.join(f'<path d="M{x},20 l60,110 l-60,110" fill="none" stroke="#fff0f6" stroke-width="16" opacity=".75"/>' for x in range(1900, 2380, 110)) + """</svg>
<div class="c" style="left:60px;top:0;bottom:0;font-family:'Big Shoulders Display';font-weight:900;font-size:210px;letter-spacing:22px;color:#fff3f8;white-space:nowrap">RING SEVEN 第七環</div>""")
tex('band_end', 300, 700, """<div class="f" style="background:linear-gradient(90deg,#c000c0,#ff1aff 50%,#c000c0)"></div>
<div class="c v" style="left:0;right:0;top:40px;font-family:'Dela Gothic One';font-size:200px;color:#fff">七</div>""")
for k, (bg, fg, txt, font, size) in {
        'r28': ('#fdfbb0', '#141414', '夜市', 'Dela Gothic One', 330),
        'r26': ('#1414ff', '#ffffff', 'NIGHT', 'Bungee', 170),
        'r30': ('#fdfbb0', '#141414', '屋台', 'Dela Gothic One', 260),
        'r27': ('#1414ff', '#ffffff', 'MARKET', 'Bungee', 130),
        'r31': ('#fdfbb0', '#c8141e', '毎晩', 'Dela Gothic One', 260),
        'r29': ('#1414ff', '#fff36a', '22—05', 'Orbitron', 150)}.items():
    tex('tile_' + k, 800, 500, f"""<div class="f" style="background:radial-gradient(90% 90% at 50% 45%,{bg},{bg})"></div>
<div class="c" style="left:0;right:0;top:0;bottom:0;font-family:'{font}';font-size:{size}px;color:{fg};white-space:nowrap">{txt}</div>""")
tex('rec_wall', 400, 900, """<div class="f" style="background:linear-gradient(90deg,#b000b4,#ff2cff 50%,#b000b4)"></div>
<svg class="f" width="400" height="900">""" + ''.join(f'<rect x="{30+i*90}" y="0" width="34" height="900" fill="#ffd6ff" opacity=".55"/>' for i in range(4)) + """</svg>""")
tex('rec_wall2', 400, 900, """<div class="f" style="background:linear-gradient(90deg,#a000a8,#f040ff 50%,#a000a8)"></div>
<svg class="f" width="400" height="900">""" + ''.join(f'<rect x="0" y="{40+i*110}" width="400" height="20" fill="#ffd6ff" opacity=".5"/>' for i in range(8)) + """</svg>""")
tex('rec_floor', 2400, 300, """<div class="f" style="background:linear-gradient(180deg,#ffd2ff 0%,#ff8af8 35%,#e050e8 100%)"></div>
<svg class="f" width="2400" height="300">""" + ''.join(f'<line x1="{x}" y1="0" x2="{x}" y2="300" stroke="#a020a8" stroke-width="4" opacity=".5"/>' for x in range(0, 2400, 120)) + """</svg>""")

lst = []
for name, (w, h, body) in T.items():
    open(f'tex/{name}.html', 'w').write((HEAD % (w, h)) + body + '</body></html>')
    lst.append(dict(name=name, w=w, h=h, file=f'tex/{name}.html'))
json.dump(lst, open('tex/list.json', 'w'))
print(len(lst), 'textures')
