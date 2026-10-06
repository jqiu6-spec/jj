"""Tests for the photo-palette extractor and its MCP server.

Run from the plugin root:  python3 -m unittest discover -s tests
"""

from __future__ import annotations

import io
import json
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

PLUGIN = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PLUGIN / "skills" / "photo-palette" / "scripts"))

import palette as P  # noqa: E402


def lab_of(hex_value: str) -> np.ndarray:
    return P.srgb_to_oklab(np.array(P.hex_to_rgb8(hex_value), dtype=float) / 255)


def nearest_distance(palette: dict, hex_value: str) -> float:
    target = lab_of(hex_value)
    return min(float(np.linalg.norm(lab_of(c["hex"]) - target)) for c in palette["colors"])


def photo(regions: list[tuple[str, float]], size=(600, 400), noise=8.0, seed=0) -> Image.Image:
    """Vertical bands of the given colors with sensor-like noise and slight blur."""
    w, h = size
    arr = np.zeros((h, w, 3))
    x = 0
    for hex_value, frac in regions:
        x1 = w if hex_value == regions[-1][0] else x + round(w * frac)
        arr[:, x:x1] = P.hex_to_rgb8(hex_value)
        x = x1
    arr += np.random.default_rng(seed).normal(0, noise, arr.shape)
    img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    return img.filter(ImageFilter.GaussianBlur(1))


class PaletteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.dir = Path(cls.tmp.name)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def save(self, img: Image.Image, name: str) -> Path:
        path = self.dir / name
        img.save(path)
        return path

    def test_recovers_dominant_colors(self):
        path = self.save(photo([("#1F3A5F", 0.55), ("#D9C29A", 0.30), ("#E8735A", 0.15)]), "a.jpg")
        pal = P.extract_palette(path, count=3, style="natural")
        for target in ("#1F3A5F", "#D9C29A", "#E8735A"):
            self.assertLess(nearest_distance(pal, target), 0.04, target)
        shares = [c["share"] for c in pal["colors"]]
        self.assertAlmostEqual(sum(shares), 1.0, places=3)
        self.assertAlmostEqual(shares[0], 0.55, delta=0.05)

    def test_small_vivid_accent_survives(self):
        path = self.save(photo([("#8A8C8E", 0.93), ("#D62828", 0.07)]), "accent.png")
        pal = P.extract_palette(path, count=3)
        self.assertLess(nearest_distance(pal, "#D62828"), 0.06)
        self.assertIn(pal["roles"]["accent" if "accent" in pal["roles"] else "primary"],
                      [c["hex"] for c in pal["colors"]])

    def test_edge_blends_do_not_become_colors(self):
        # Red and green tiles: the blurred seams are brown, which must not be picked.
        arr = np.zeros((400, 400, 3), dtype=np.uint8)
        yy, xx = np.mgrid[0:400, 0:400]
        checker = ((yy // 25 + xx // 25) % 2).astype(bool)
        arr[checker] = P.hex_to_rgb8("#D02020")
        arr[~checker] = P.hex_to_rgb8("#2F8A2F")
        img = Image.fromarray(arr).filter(ImageFilter.GaussianBlur(3))
        pal = P.extract_palette(self.save(img, "checker.png"), count=2, style="natural")
        self.assertLess(nearest_distance(pal, "#D02020"), 0.05)
        self.assertLess(nearest_distance(pal, "#2F8A2F"), 0.05)

    def test_deterministic(self):
        path = self.save(photo([("#264653", 0.4), ("#E9C46A", 0.35), ("#E76F51", 0.25)]), "d.jpg")
        self.assertEqual(P.extract_palette(path), P.extract_palette(path))

    def test_ignores_transparent_pixels(self):
        arr = np.zeros((100, 100, 4), dtype=np.uint8)
        arr[:, :50] = (0, 200, 0, 0)       # invisible green
        arr[:, 50:] = (30, 60, 200, 255)   # opaque blue
        pal = P.extract_palette(self.save(Image.fromarray(arr, "RGBA"), "alpha.png"), count=2)
        self.assertGreater(nearest_distance(pal, "#00C800"), 0.15)
        self.assertLess(nearest_distance(pal, "#1E3CC8"), 0.05)

    def test_styles_change_saturation_and_stay_in_gamut(self):
        path = self.save(photo([("#3D5A80", 0.4), ("#98C1D9", 0.3), ("#EE6C4D", 0.3)]), "s.jpg")
        chroma = {}
        for style in P.STYLES:
            pal = P.extract_palette(path, count=4, style=style)
            for c in pal["colors"]:
                self.assertRegex(c["hex"], r"^#[0-9A-F]{6}$")
                self.assertTrue(all(0 <= v <= 255 for v in c["rgb"]))
            chroma[style] = np.mean([c["oklch"][1] for c in pal["colors"]])
        self.assertGreater(chroma["vivid"], chroma["natural"])
        self.assertGreater(chroma["natural"], chroma["muted"])

    def test_roles_are_readable(self):
        path = self.save(photo([("#2A6F4E", 0.6), ("#C9A227", 0.4)]), "roles.jpg")
        pal = P.extract_palette(path, count=4)
        roles = pal["roles"]
        for key in ("background", "surface", "text", "primary"):
            self.assertIn(key, roles)
        self.assertIn("background", pal["derived_roles"])  # no light color in the photo
        ratio = P.contrast_ratio(P.hex_to_rgb8(roles["text"]), P.hex_to_rgb8(roles["background"]))
        self.assertGreaterEqual(ratio, 7)

    def test_moodboard_weights_images_equally(self):
        big = self.save(Image.new("RGB", (800, 800), "#1D4E89"), "big.png")
        small = self.save(Image.new("RGB", (100, 100), "#F4A259"), "small.png")
        pal = P.extract_palette([big, small], count=2, style="natural")
        self.assertEqual(len(pal["source"]), 2)
        for c in pal["colors"]:
            self.assertAlmostEqual(c["share"], 0.5, delta=0.01)

    def test_grayscale_photo_without_neutrals(self):
        img = Image.fromarray(np.tile(np.linspace(0, 255, 256, dtype=np.uint8), (64, 1)), "L")
        pal = P.extract_palette(self.save(img, "gray.png"), count=4, neutrals=False)
        self.assertGreaterEqual(pal["count"], 1)

    def test_sixteen_bit_image(self):
        arr = (np.linspace(0, 65535, 128 * 64).reshape(64, 128)).astype(np.uint16)
        pal = P.extract_palette(self.save(Image.fromarray(arr), "deep.png"), count=3)
        self.assertGreaterEqual(pal["count"], 1)

    def test_rejects_bad_arguments(self):
        path = self.save(Image.new("RGB", (10, 10), "red"), "tiny.png")
        with self.assertRaises(ValueError):
            P.extract_palette(path, count=0)
        with self.assertRaises(ValueError):
            P.extract_palette(path, style="neon")

    def test_formats(self):
        path = self.save(photo([("#003049", 0.5), ("#F77F00", 0.5)]), "f.jpg")
        pal = P.extract_palette(path, count=2)
        self.assertEqual(json.loads(P.render(pal, "json"))["count"], 2)
        css = P.render(pal, "css", prefix="brand")
        self.assertIn(":root {", css)
        self.assertIn("--brand-primary:", css)
        self.assertIn("@theme {", P.render(pal, "tailwind"))
        self.assertIn("$palette-background:", P.render(pal, "scss"))
        self.assertTrue(P.render(pal, "gpl").startswith("GIMP Palette"))
        ET.fromstring(P.render(pal, "svg"))
        self.assertNotIn("\x1b[", P.render(pal, "text"))

    def test_cli_writes_output_and_preview(self):
        path = self.save(photo([("#5F0F40", 0.5), ("#FB8B24", 0.5)]), "cli.jpg")
        out, preview = self.dir / "theme.css", self.dir / "nested" / "preview.png"
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            code = P.main([str(path), "-n", "3", "-f", "css", "-o", str(out),
                           "--preview", str(preview)])
        self.assertEqual(code, 0)
        self.assertIn(":root", out.read_text())
        with Image.open(preview) as im:
            self.assertEqual(im.width, 1200)

    def test_cli_reports_missing_file(self):
        err = io.StringIO()
        with redirect_stderr(err):
            self.assertEqual(P.main([str(self.dir / "nope.jpg")]), 1)
        self.assertIn("error:", err.getvalue())


class McpServerTests(unittest.TestCase):
    def test_initialize_list_and_call(self):
        with tempfile.TemporaryDirectory() as tmp:
            img = Path(tmp) / "m.jpg"
            photo([("#22577A", 0.6), ("#FFD166", 0.4)]).save(img)
            requests = [
                {"jsonrpc": "2.0", "id": 1, "method": "initialize",
                 "params": {"protocolVersion": "2025-06-18", "capabilities": {},
                            "clientInfo": {"name": "test", "version": "0"}}},
                {"jsonrpc": "2.0", "method": "notifications/initialized"},
                {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
                {"jsonrpc": "2.0", "id": 3, "method": "tools/call",
                 "params": {"name": "extract_palette",
                            "arguments": {"image_paths": [str(img)], "count": 3, "format": "css"}}},
                {"jsonrpc": "2.0", "id": 4, "method": "tools/call",
                 "params": {"name": "extract_palette", "arguments": {"image_paths": ["rel.jpg"]}}},
                {"jsonrpc": "2.0", "id": 5, "method": "nope"},
            ]
            proc = subprocess.run(
                [sys.executable, str(PLUGIN / "mcp" / "server.py")],
                input="\n".join(json.dumps(r) for r in requests) + "\n",
                capture_output=True, text=True, timeout=60, cwd=PLUGIN,
            )
        replies = {r["id"]: r for r in map(json.loads, proc.stdout.splitlines())}
        self.assertEqual(sorted(replies), [1, 2, 3, 4, 5])  # no reply to the notification
        self.assertEqual(replies[1]["result"]["protocolVersion"], "2025-06-18")
        self.assertEqual(replies[2]["result"]["tools"][0]["name"], "extract_palette")
        call = replies[3]["result"]
        self.assertFalse(call["isError"])
        self.assertIn(":root", call["content"][0]["text"])
        self.assertEqual(call["structuredContent"]["count"], 3)
        self.assertTrue(replies[4]["result"]["isError"])
        self.assertIn("absolute", replies[4]["result"]["content"][0]["text"])
        self.assertEqual(replies[5]["error"]["code"], -32601)


if __name__ == "__main__":
    unittest.main()
