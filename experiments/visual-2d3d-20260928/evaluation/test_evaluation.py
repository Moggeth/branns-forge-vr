"""Focused tests for failure detection and procedural reproducibility."""
import copy
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "variants" / "D"))
from generate import make_spec
from evaluate import evaluate, semantic_hash, terrain_height
from compare_edit import compare


class EvaluationTests(unittest.TestCase):
    def test_repeat_same_seed(self):
        self.assertEqual(semantic_hash(make_spec(20260928)), semantic_hash(make_spec(20260928)))

    def test_three_seeds_pass(self):
        for seed in (20260928, 20260929, 20260930):
            with self.subTest(seed=seed):
                result = evaluate(make_spec(seed))
                self.assertTrue(result["pass"], result["failures"])

    def test_missed_bridge_fails(self):
        spec = make_spec()
        spec["crossing"]["center_xz"] = [7, 7]
        self.assertFalse(evaluate(spec)["pass"])

    def test_route_obstruction_fails(self):
        spec = make_spec()
        spec["objects"].append({"id": "blocked", "asset_id": "rock_mossy", "position_xyz": [0, 0, 0], "yaw_rad": 0, "scale": 1, "radius_m": 1, "interactive": False})
        self.assertFalse(evaluate(spec)["pass"])

    def test_clearing_edit_local(self):
        result = compare(make_spec(clearing_radius=6), make_spec(clearing_radius=9))
        self.assertTrue(result["targeted_edit_pass"], result)
        self.assertGreater(len(result["removed_object_ids"]), 0)

    def test_explicit_gaussian_coefficient(self):
        spec = make_spec()
        spec["terrain"]["gaussian_coefficient"] = 1.0
        x, z = spec["terrain"]["hills"][0]["center_xz"]
        at_center = terrain_height(spec, x, z)
        self.assertNotEqual(at_center, terrain_height(make_spec(), x, z))

    def test_declared_ravine_and_path_surface_role(self):
        import json
        spec = json.loads((HERE.parent / "variants" / "A" / "world_spec.json").read_text(encoding="utf-8"))
        obj = spec["objects"][97]
        self.assertAlmostEqual(obj["position_xyz"][1], terrain_height(spec, *obj["position_xyz"][::2]), delta=0.01)
        result = evaluate(spec)
        self.assertEqual(result["metrics"]["inferred_path_surface_count"], 16)
        self.assertTrue(result["pass"], result["failures"])

    def test_path_surface_still_obeys_other_exclusions(self):
        spec = make_spec()
        x, z = -35, 0
        spec["objects"].append({"id": "test_path", "asset_id": "path_straight", "position_xyz": [x, terrain_height(spec, x, z), z], "yaw_rad": 0, "scale": 1, "radius_m": 0, "interactive": False})
        spec["exclusions"].append({"name": "protected_water", "kind": "circle", "center_xz": [x, z], "radius_m": 1})
        self.assertTrue(any("test_path intersects exclusion protected_water" in f for f in evaluate(spec)["failures"]))

    def test_explicit_role_exemption_is_narrow(self):
        import json
        spec = json.loads((HERE.parent / "variants" / "C" / "world_spec.json").read_text(encoding="utf-8"))
        brook = next(e for e in spec["exclusions"] if e.get("name") == "brook")
        brook["except_roles"] = ["boulder"]
        result = evaluate(spec)
        self.assertEqual(result["metrics"]["path_surface_count"], 23)
        self.assertEqual(result["metrics"]["exclusion_role_exemption_count"], 15)
        self.assertEqual(result["metrics"]["water_edge_contact_unverified_count"], 15)
        self.assertFalse(any("exclusion brook" in f for f in result["failures"]))
        # A non-exempt tree at the same bank point remains a hard violation.
        intruder = dict(spec["objects"][183])
        intruder["role"] = "tree"
        spec["objects"].append(intruder)
        self.assertTrue(any("exclusion brook" in f for f in evaluate(spec)["failures"]))


if __name__ == "__main__": unittest.main()
