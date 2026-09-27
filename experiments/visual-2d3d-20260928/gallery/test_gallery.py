"""Small checks for the generated gallery's evidence links and missing-data policy."""

import unittest
from pathlib import Path

from build import CAMERAS, HERE, build_data


class GalleryDataTests(unittest.TestCase):
    def test_relative_links_resolve(self):
        data = build_data()
        self.assertEqual([v["id"] for v in data["variants"]], list("ABCDE"))
        for variant in data["variants"]:
            self.assertEqual(list(variant["renders"]), list(CAMERAS))
            hrefs = [*variant["renders"].values(), variant["spec"], *(s["href"] for s in variant["sources"])]
            for href in filter(None, hrefs):
                self.assertFalse(Path(href).is_absolute(), href)
                self.assertTrue((HERE / href).is_file(), href)

    def test_missing_metrics_stay_missing(self):
        data = build_data()
        for variant in data["variants"]:
            if variant["metrics"] is not None:
                self.assertTrue(variant["metrics"].get("source"))
        self.assertEqual(data["variants"][3]["metrics"]["variant"], "D")


if __name__ == "__main__":
    unittest.main()
