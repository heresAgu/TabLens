import copy
import json
from pathlib import Path
import tempfile
import unittest

from PIL import Image

from cell_verifier import (apply_review, checked_positions, cross_check,
                           prepare_review_cards, resolve_note_review)
from cell_reader import prepare_cell_samples
from event_pipeline import merge_observations, prepare_event_samples
from string_anchors import prepare_anchor_samples
from symbol_reader import SymbolFormatError
from test_cell_reader import reference_cells
from test_event_pipeline import reference_parts
from test_string_verifier import reference_reading
import test_event_pipeline


class CellVerifierTests(unittest.TestCase):
    def setUp(self):
        self.cells = reference_cells()
        self.audit = reference_reading()
        _, self.rhythm, self.anchors = reference_parts()

    def missing_last_note(self):
        self.cells["measures"][0]["string_rows"][2]["cells"][-1] = []

    def test_missing_note_triggers_entire_conflicting_row_and_empty_column(self):
        self.missing_last_note()
        original = copy.deepcopy(self.cells)
        check = cross_check(self.cells, self.audit, self.rhythm, self.anchors)
        self.assertFalse(check["consistent"])
        self.assertFalse(check["reference_used"])
        self.assertEqual(check["agreeing_rows"], 11)
        self.assertEqual(check["empty_note_columns"], [{"measure": 2, "column": 8}])
        self.assertEqual(len(check["review_targets"]), 13)
        self.assertEqual(self.cells, original)
        positions = checked_positions(self.cells, check, self.anchors)
        _, score, diagnostic = merge_observations(positions, self.rhythm, self.anchors)
        self.assertFalse(diagnostic["ready_for_playback"])
        self.assertEqual(score["measures"][0]["events"][-1]["notes"], [])

    def test_consistent_readings_need_no_review(self):
        check = cross_check(self.cells, self.audit, self.rhythm, self.anchors)
        self.assertTrue(check["consistent"])
        self.assertEqual(check["review_targets"], [])

    def test_note_only_check_detects_missing_stem_note_without_reading_rhythm(self):
        self.anchors["columns_are_note_candidates"] = True
        self.missing_last_note()
        check = cross_check(self.cells, self.audit, None, self.anchors)
        self.assertFalse(check["consistent"])
        self.assertEqual(check["empty_note_columns"], [{"measure": 2, "column": 8}])
        self.assertEqual(len(check["review_targets"]), 13)

    def test_local_confirmation_resolves_audit_false_alarm_without_erasing_disagreement(self):
        self.anchors["columns_are_note_candidates"] = True
        self.audit["measures"][0]["strings"][3]["frets"] = [7]
        check = cross_check(self.cells, self.audit, None, self.anchors)
        targets = check["review_targets"]
        review = self.review_for(targets)
        updated, changes = apply_review(self.cells, review, targets, self.anchors)
        resolved = resolve_note_review(self.cells, updated, review, targets, self.audit, self.anchors)
        self.assertFalse(resolved["consistent"])
        self.assertTrue(resolved["resolved"])
        self.assertEqual(resolved["resolved_rows"], 1)
        self.assertEqual(changes, [])
        self.assertEqual(checked_positions(updated, resolved, self.anchors)["measures"][0]["uncertain_items"], [])

    def test_incomplete_or_uncertain_local_review_does_not_resolve_audit(self):
        self.audit["measures"][0]["strings"][3]["frets"] = [7]
        targets = cross_check(self.cells, self.audit, None, self.anchors)["review_targets"]
        review = self.review_for(targets)
        for selected, evidence in [(targets[:-1], review), (targets, {**review, "uncertain_items": ["数字不清"]})]:
            check = resolve_note_review(self.cells, self.cells, evidence, selected, self.audit, self.anchors)
            self.assertFalse(check["resolved"])

    def test_changed_row_that_still_disagrees_cannot_be_approved(self):
        self.audit["measures"][0]["strings"][0]["frets"] = [17]
        targets = cross_check(self.cells, self.audit, None, self.anchors)["review_targets"]
        reviewed = copy.deepcopy(self.cells)
        reviewed["measures"][0]["string_rows"][0]["cells"][0] = [8]
        check = resolve_note_review(self.cells, reviewed, {"uncertain_items": []}, targets, self.audit, self.anchors)
        self.assertFalse(check["resolved"])

    def test_matching_wrong_readings_still_trigger_review_of_an_empty_note_column(self):
        self.missing_last_note()
        self.audit["measures"][0]["strings"][2]["frets"].pop()
        check = cross_check(self.cells, self.audit, self.rhythm, self.anchors)
        self.assertEqual(check["agreeing_rows"], 12)
        self.assertFalse(check["consistent"])
        self.assertEqual(len(check["review_targets"]), 6)
        self.assertTrue(all(t["column"] == 8 and t["measure"] == 2 for t in check["review_targets"]))

    def test_disagreement_inside_a_chord_blocks_playback_without_empty_column(self):
        self.cells["measures"][0]["string_rows"][1]["cells"][0] = []
        check = cross_check(self.cells, self.audit, self.rhythm, self.anchors)
        self.assertEqual(check["empty_note_columns"], [])
        self.assertFalse(check["consistent"])
        _, _, diagnostic = merge_observations(checked_positions(self.cells, check, self.anchors),
                                              self.rhythm, self.anchors)
        self.assertFalse(diagnostic["ready_for_playback"])

    def test_unknown_audit_cannot_silently_approve_a_complete_score(self):
        self.audit["measures"][0]["strings"][2]["frets"] = None
        check = cross_check(self.cells, self.audit, self.rhythm, self.anchors)
        self.assertFalse(check["consistent"])
        self.assertEqual(len(check["review_targets"]), 8)
        self.assertFalse(check["rows"][2]["known"])

    def review_for(self, targets):
        correct = reference_cells()
        rows = {(m["number"], r["string"]): r for m in correct["measures"] for r in m["string_rows"]}
        return {"cells": [{"id": t["id"], "value": rows[t["measure"], t["string"]]["cells"][t["column"] - 1]}
                           for t in targets], "uncertain_items": []}

    def test_review_updates_only_candidates_and_keeps_baseline(self):
        self.missing_last_note()
        original = copy.deepcopy(self.cells)
        check = cross_check(self.cells, self.audit, self.rhythm, self.anchors)
        updated, changes = apply_review(self.cells, self.review_for(check["review_targets"]),
                                        check["review_targets"], self.anchors)
        self.assertEqual(self.cells, original)
        self.assertEqual(updated, reference_cells())
        self.assertEqual(len(changes), 1)
        self.assertEqual(changes[0]["id"], "m2-s3-c8")
        self.assertEqual(changes[0]["before"], [])
        self.assertEqual(changes[0]["after"], [0])
        self.assertTrue(cross_check(updated, self.audit, self.rhythm, self.anchors)["consistent"])

    def test_review_rejects_missing_duplicate_unrequested_and_invalid_values(self):
        self.missing_last_note()
        targets = cross_check(self.cells, self.audit, self.rhythm, self.anchors)["review_targets"]
        edits = [lambda r: r["cells"].pop(),
                 lambda r: r["cells"].append(copy.deepcopy(r["cells"][0])),
                 lambda r: r["cells"][0].update(id="m3-s1-c1"),
                 lambda r: r["cells"][0].update(value=[True])]
        for edit in edits:
            with self.subTest(edit=edit):
                review = self.review_for(targets)
                edit(review)
                with self.assertRaises(SymbolFormatError):
                    apply_review(self.cells, review, targets, self.anchors)

    def test_review_cards_keep_original_pixels_and_manifest_coordinates(self):
        with tempfile.TemporaryDirectory(prefix="tablab-review-") as temporary:
            root = Path(temporary)
            source = test_event_pipeline.ColumnImageTests().source()
            row_file = root / "row.png"
            source.save(row_file)
            samples = {"row": row_file, **prepare_anchor_samples(row_file, root)}
            samples.update(prepare_event_samples(samples, root))
            samples.update(prepare_cell_samples(samples, root))
            geometry = json.loads(samples["cell_geometry"].read_text(encoding="utf-8"))
            targets = [{"id": "m2-s1-c1", "measure": 2, "string": 1, "column": 1}]
            paths, manifest = prepare_review_cards(row_file, geometry, targets, root / "review")
            self.assertEqual(len(paths), 1)
            card = manifest[0]
            snippet = source.crop(card["source_box"])
            enlarged = snippet.resize((snippet.width * 4, snippet.height * 4), Image.Resampling.NEAREST)
            with Image.open(paths[0]) as page:
                x, y = card["paste_xy"]
                self.assertEqual(page.crop((x, y, x + enlarged.width, y + enlarged.height)).tobytes(), enlarged.tobytes())


if __name__ == "__main__":
    unittest.main()
