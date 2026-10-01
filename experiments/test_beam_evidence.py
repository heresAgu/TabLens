import copy
import json
from pathlib import Path
import tempfile
import unittest

from PIL import Image, ImageDraw

from beam_evidence import (cross_check_beams, detect_beam_candidates, profile_bands,
                           review_pixel_evidence, validate_beam_review)
from rhythm_diagnostic import prepare_rhythm_samples
from symbol_reader import SymbolFormatError
from test_rhythm_diagnostic import reference_rhythm


class BeamEvidenceTests(unittest.TestCase):
    def profile(self, values):
        return [{"y": y, "median_gray": value} for y, value in enumerate(values)]

    def test_dark_internal_separator_splits_bands_without_using_thickness_to_count(self):
        values = [255] * 3 + [0] * 5 + [17] * 2 + [0] * 5 + [255] * 2 + [0] * 5 + [255] * 3
        result = profile_bands(self.profile(values), maximum_band_height=9)
        self.assertTrue(result["resolved"])
        self.assertEqual(result["bands"], [[3, 7], [10, 14], [17, 21]])
        self.assertEqual(result["separators"], [{"y_range": [8, 9], "peak_gray": 17}])

    def test_wide_solid_block_without_separation_stays_unresolved(self):
        result = profile_bands(self.profile([255] * 3 + [0] * 12 + [255] * 3), maximum_band_height=9)
        self.assertFalse(result["resolved"])
        self.assertEqual(len(result["bands"]), 1)

    def test_small_compression_noise_does_not_create_extra_beam(self):
        result = profile_bands(self.profile([255, 255, 0, 0, 3, 0, 0, 255]), maximum_band_height=9)
        self.assertTrue(result["resolved"])
        self.assertEqual(result["bands"], [[2, 6]])

    def test_binding_uses_adjacent_spans_instead_of_group_maximum(self):
        row = Image.new("RGB", (120, 100), "white")
        draw = ImageDraw.Draw(row)
        for y in (20, 31):
            draw.rectangle((25, y, 54, y + 4), fill="black")
        for y in (20, 31, 42):
            draw.rectangle((65, y, 94, y + 4), fill="black")
        anchors = {"string_y": [0, 15, 30, 45, 60, 75], "measures": [{"number": 99,
            "columns": [{"index": i, "x": x} for i, x in enumerate((20, 60, 100), 1)]}]}
        groups = {"connections": [{"measure": 99, "between_columns": [1, 2], "source_box": [25, 10, 55, 80], "joined": True},
                                  {"measure": 99, "between_columns": [2, 3], "source_box": [65, 10, 95, 80], "joined": True}]}
        candidates = detect_beam_candidates(row, anchors, groups)
        self.assertEqual([c["candidate_beam_count"] for c in candidates["columns"]], [2, 3, 3])
        self.assertFalse(candidates["reference_used"])

    def test_real_pixel_candidates_match_reference_used_only_for_scoring(self):
        source = Path(__file__).resolve().parent.parent / "lullaby.jpg"
        with tempfile.TemporaryDirectory(prefix="tablab-beam-") as temporary:
            paths = prepare_rhythm_samples({"whole_page": source}, Path(temporary), include_beams=True)
            for number in (1, 4):
                anchors = json.loads(paths[f"rhythm_anchors_m{number}"].read_text(encoding="utf-8"))
                observation, _, _ = reference_rhythm(number)
                expected = [c["rhythm"]["beam_count"] for c in observation["measures"][0]["columns"]]
                self.assertEqual([c["candidate_beam_count"] for c in anchors["beam_candidates"]["columns"]], expected)
                self.assertTrue(cross_check_beams(observation, anchors)["consistent"])

    def review_fixture(self):
        correct, anchors, _ = reference_rhythm(1)
        anchors["beam_candidates"] = {"coordinate_space": "row_crop_pixels", "parameters": {}, "spans": [],
            "columns": [{"measure": 1, "index": c["index"], "candidate_beam_count": c["rhythm"]["beam_count"],
                         "supported_by_spans": []} for c in correct["measures"][0]["columns"]]}
        initial = copy.deepcopy(correct)
        initial["measures"][0]["columns"][7]["rhythm"]["beam_count"] = 2
        targets = cross_check_beams(initial, anchors)["targets"]
        return correct, initial, anchors, targets

    def test_review_changes_only_requested_beam_and_can_disagree_with_candidate(self):
        correct, initial, anchors, targets = self.review_fixture()
        updated, changes = validate_beam_review(correct, initial, anchors, targets)
        self.assertEqual(changes, [{"measure": 1, "column": 8, "before": 2, "after": 3}])
        self.assertTrue(cross_check_beams(updated, anchors)["consistent"])
        unchanged, changes = validate_beam_review(initial, initial, anchors, targets)
        self.assertEqual(changes, [])
        self.assertFalse(cross_check_beams(unchanged, anchors)["consistent"])
        self.assertFalse(review_pixel_evidence(anchors, targets)["reference_used"])

    def test_review_rejects_changes_to_metadata_other_marks_or_non_target_columns(self):
        correct, initial, anchors, targets = self.review_fixture()
        for kind in ("metadata", "dots", "other_column", "mode"):
            review = copy.deepcopy(correct)
            if kind == "metadata": review["metadata"]["capo"] = 0
            elif kind == "dots": review["measures"][0]["columns"][7]["rhythm"]["dot_count"] = 1
            elif kind == "other_column": review["measures"][0]["columns"][0]["rhythm"]["beam_count"] = 2
            else: review["measures"][0]["rhythm_mode"] = "multiple_voices"
            with self.subTest(kind=kind), self.assertRaises(SymbolFormatError):
                validate_beam_review(review, initial, anchors, targets)

    def test_unknown_pixel_candidate_does_not_supply_an_answer(self):
        _, initial, anchors, _ = self.review_fixture()
        anchors["beam_candidates"]["columns"][7]["candidate_beam_count"] = None
        check = cross_check_beams(initial, anchors)
        self.assertEqual(check["targets"], [])
        self.assertEqual(check["unknown_pixel_columns"], [[1, 8]])
        self.assertFalse(check["consistent"])


if __name__ == "__main__":
    unittest.main()
