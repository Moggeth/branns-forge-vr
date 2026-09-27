"""Focused asset gate regression: real build/import and deliberate contract failures."""

import json
import pathlib
import subprocess
import sys
import tempfile
import unittest

import asset_lab


ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = ROOT / "assets/asset-lab/pilot/asset.json"


class AssetLabTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="brann-asset-lab-test-")
        cls.output = pathlib.Path(cls.temp.name)
        result = subprocess.run([sys.executable, str(ROOT / "scripts/asset_lab.py"), "build",
                                 str(SPEC), "--out", str(cls.output)], capture_output=True, text=True,
                                timeout=40, check=False)
        cls.result = json.loads((cls.output / "report.json").read_text(encoding="utf-8"))
        if result.returncode:
            raise AssertionError(f"real pilot pipeline failed: {result.stdout}\n{result.stderr}")

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_real_pilot_imports_with_all_markers(self):
        self.assertTrue(self.result["passed"])
        self.assertEqual(self.result["checks"]["khronos"]["numErrors"], 0)
        self.assertIn("Grip", self.result["checks"]["godot"]["node_names"])
        self.assertIn("Flame", self.result["checks"]["godot"]["node_names"])
        self.assertLess(self.result["checks"]["glb"]["metrics"]["triangles"], 3000)

    def test_contract_rejects_missing_interaction_marker(self):
        spec = asset_lab.load_spec(SPEC)
        spec["required_nodes"].append("MissingInteractionSocket")
        _, errors = asset_lab.inspect_glb(self.output / "model.glb", spec)
        self.assertIn("missing required node: MissingInteractionSocket", errors)

    def test_contract_rejects_excess_triangle_budget(self):
        spec = asset_lab.load_spec(SPEC)
        spec["limits"]["max_triangles"] = 100
        _, errors = asset_lab.inspect_glb(self.output / "model.glb", spec)
        self.assertTrue(any("triangles" in error and "exceeds" in error for error in errors))

    def test_bad_header_rejected(self):
        bad = self.output / "bad.glb"
        bad.write_bytes(b"not a glb")
        with self.assertRaises(ValueError):
            asset_lab.inspect_glb(bad, asset_lab.load_spec(SPEC))


if __name__ == "__main__":
    unittest.main()
