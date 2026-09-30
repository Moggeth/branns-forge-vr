"""Ensure renderer noise allowances never accept actual weapon-image changes."""
import io
import unittest

from PIL import Image, ImageDraw
from weapon_review import compare_pixels


def png(image):
    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


class RepeatEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.image = Image.new("RGB", (128, 128), "#404040")
        ImageDraw.Draw(self.image).rectangle((40, 20, 55, 110), fill="white")

    def test_exact_capture(self):
        data = png(self.image)
        self.assertTrue(compare_pixels(data, data)["byte_identical"])

    def test_small_renderer_rounding_is_disclosed(self):
        changed = self.image.copy()
        changed.putpixel((80, 80), (69, 64, 64))
        result = compare_pixels(png(self.image), png(changed))
        self.assertFalse(result["byte_identical"])
        self.assertTrue(result["within_tolerance"])
        self.assertEqual(result["max_channel_delta"], 5)

    def test_one_pixel_pose_shift_fails(self):
        shifted = Image.new("RGB", self.image.size, "#404040")
        shifted.paste(self.image, (1, 0))
        self.assertFalse(compare_pixels(png(self.image), png(shifted))["within_tolerance"])

    def test_reorientation_fails(self):
        rotated = self.image.transpose(Image.Transpose.ROTATE_90)
        self.assertFalse(compare_pixels(png(self.image), png(rotated))["within_tolerance"])

    def test_broad_subtle_material_change_fails(self):
        changed = Image.new("RGB", self.image.size, "#414141")
        ImageDraw.Draw(changed).rectangle((40, 20, 55, 110), fill="white")
        self.assertFalse(compare_pixels(png(self.image), png(changed))["within_tolerance"])

    def test_resolution_change_fails(self):
        self.assertFalse(compare_pixels(png(self.image), png(self.image.resize((64, 64))))["within_tolerance"])


if __name__ == "__main__":
    unittest.main()
