import json
import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

from plan import PALETTE, extract, pixel_to_world, terrain_height, validate, world_to_pixel


class PlannerTests(unittest.TestCase):
    def test_generated_source_benchmark_and_grounding(self):
        source = Path(__file__).parent / "input" / "generated-map-source.png"
        with tempfile.TemporaryDirectory() as tmp:
            spec = extract(source, Path(tmp))
            self.assertEqual([], validate(spec))
            self.assertGreater(spec["planning"]["anchor_snap"]["goal_delta_m"], 5)
            self.assertEqual(113, len(spec["objects"]))
            self.assertGreater(spec["planning"]["grounding_delta_m"]["max"], .5)
            for obj in spec["objects"]:
                x,y,z = obj["position_xyz"]
                self.assertAlmostEqual(y,terrain_height(spec,(x,z)),places=3)

    def test_coordinate_registration(self):
        for point in ((0, 0), (511, 511), (255.5, 255.5), (27, 390)):
            for actual, expected in zip(world_to_pixel(*pixel_to_world(*point)), point):
                self.assertAlmostEqual(actual, expected, places=3)
        self.assertAlmostEqual(pixel_to_world(0, 0)[0], -39.9219, places=4)
        self.assertAlmostEqual(pixel_to_world(511, 511)[1], 39.9219, places=4)

    def test_extract_and_validate_imperfect_palette(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            im = Image.new("RGB", (512, 512), PALETTE["grass"])
            d = ImageDraw.Draw(im)
            d.line([(0, 255), (100, 259), (200, 251), (300, 260), (511, 254)], fill=PALETTE["water"], width=29)
            s = world_to_pixel(-30, 29)
            g = world_to_pixel(24, -27)
            b = world_to_pixel(0, 0)
            d.line([s, b, g], fill=PALETTE["path"], width=24)
            d.line([(b[0]-10,b[1]+20),(b[0]+10,b[1]-20)], fill=PALETTE["crossing"], width=22)
            for xy, name in ((s,"spawn"),(g,"goal")):
                x,y=xy
                d.ellipse((x-9,y-9,x+9,y+9), fill=PALETTE[name])
            im = im.filter(__import__("PIL.ImageFilter",fromlist=["GaussianBlur"]).GaussianBlur(.5))
            source=tmp/"generated.png"
            im.save(source)
            spec=extract(source,tmp/"out","synthetic-test")
            self.assertEqual([],validate(spec))
            self.assertEqual([-30,29],spec["spawn_xz"])
            self.assertEqual([24,-27],spec["goal_xz"])
            self.assertEqual(spec["spawn_xz"],spec["path_xz"][0])
            self.assertEqual(spec["goal_xz"],spec["path_xz"][-1])
            for obj in spec["objects"]:
                x,y,z=obj["position_xyz"]
                self.assertAlmostEqual(y,terrain_height(spec,(x,z)),places=3)
            self.assertTrue((tmp/"out"/"mask_water.png").exists())
            self.assertTrue((tmp/"out"/"plan_preview.png").exists())
            for mask in ("mask_height.png", "mask_density.png"):
                with Image.open(tmp/"out"/mask) as registered:
                    self.assertEqual((512,512),registered.size)
            self.assertEqual("synthetic-test",json.loads((tmp/"out"/"world_spec.json").read_text())["provenance"]["model"])
            broken = json.loads((tmp/"out"/"world_spec.json").read_text())
            broken["crossing"]["center_xz"] = [15,15]
            self.assertTrue(any("Crossing" in e or "Bridge" in e for e in validate(broken)))
            rotated = json.loads((tmp/"out"/"world_spec.json").read_text())
            rotated["crossing"]["yaw_rad"] += __import__("math").pi/2
            self.assertTrue(any("misaligned" in e for e in validate(rotated)))

    def test_missing_anchor_is_reported(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp=Path(tmp)
            im=Image.new("RGB",(512,512),PALETTE["grass"])
            d=ImageDraw.Draw(im)
            d.line([(256,0),(256,511)],fill=PALETTE["water"],width=30)
            d.line([world_to_pixel(-30,29),world_to_pixel(0,0),world_to_pixel(24,-27)],fill=PALETTE["path"],width=24)
            source=tmp/"missing.png"
            im.save(source)
            spec=extract(source,tmp/"out")
            self.assertEqual(3,len(spec["provenance"]["anchor_fallbacks"]))
            self.assertTrue(any("marker absent" in w for w in spec["planning"]["warnings"]))


if __name__ == "__main__":
    unittest.main()
