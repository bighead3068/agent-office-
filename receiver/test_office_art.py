import json
import unittest
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ATLAS = ROOT / "public" / "art" / "office-atlas.png"
MANIFEST = ROOT / "public" / "art" / "office-atlas.json"
STATUS = {"#1D5FA8", "#F2B53A", "#B45309", "#B3261E", "#2E7D32", "#5B4E8C", "#5F5F5F", "#E8DFCF"}


class OfficeArtTests(unittest.TestCase):
    def test_atlas_stays_inside_the_32_color_palette(self):
        manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
        self.assertEqual(len(manifest["palette"]), 32)
        self.assertTrue(ATLAS.is_file())
        allowed = {tuple(int(item[i : i + 2], 16) for i in (1, 3, 5)) for item in manifest["palette"]}
        image = Image.open(ATLAS).convert("RGBA")
        colors = set()
        pixels = image.load()
        for y in range(image.height):
            for x in range(image.width):
                red, green, blue, alpha = pixels[x, y]
                if alpha:
                    colors.add((red, green, blue))
        self.assertTrue(colors <= allowed)
        named = {f"#{red:02X}{green:02X}{blue:02X}" for red, green, blue in colors}
        self.assertTrue(named.isdisjoint(STATUS))

    def test_manifest_sprites_and_cc0_sources_exist(self):
        manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
        for layer in manifest["layers"]:
            self.assertIn(layer["sprite"], manifest["sprites"])
        for seat in manifest["seats"]:
            self.assertEqual(len(seat["anchor"]), 2)
        props = ROOT / "third_party" / "cc0" / "natural-privateer"
        for name in (
            "water_bottle_32bit_img.png",
            "tape_roll_32bit_img.png",
            "cup_of_pens_32bit_img.png",
            "office_paper_work_32bit_img.png",
        ):
            self.assertTrue((props / name).is_file(), name)
        names = []
        for folder in ("public", "src", "scripts", "third_party", "receiver"):
            names.extend(path.name.casefold() for path in (ROOT / folder).rglob("*"))
        text = " ".join(names)
        self.assertNotIn("semtex", text)
        self.assertNotIn("crimelike", text)
        self.assertNotIn("extradave", text)

    def test_windows_launcher_in_the_zip_is_utf8_with_bom(self):
        source = (ROOT / "Start-AgentOffice.ps1").read_bytes()
        self.assertTrue(source.startswith(b"\xef\xbb\xbf"))
        archive = ROOT / "packaging" / "agent-office-v0.2.zip"
        self.assertTrue(archive.is_file())
        import zipfile
        with zipfile.ZipFile(archive) as package:
            payload = package.read("Start-AgentOffice.ps1")
        self.assertTrue(payload.startswith(b"\xef\xbb\xbf"))


if __name__ == "__main__":
    unittest.main()
