"""Focused tests for failure detection and procedural reproducibility."""
import copy
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "variants" / "D"))
from generate import make_spec
from evaluate import evaluate, semantic_hash
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


if __name__ == "__main__": unittest.main()
