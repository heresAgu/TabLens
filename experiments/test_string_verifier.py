import copy
import json
import unittest

from recognition_lab import REFERENCE_PATH
from string_verifier import (StringFormatError, compare_verification, evaluate_reading,
                             load_string_prompts, ordered_matches, validate_reading)


def reference_reading():
    reference = json.loads(REFERENCE_PATH.read_text(encoding="utf-8"))
    reading = {"measures": [], "uncertain_items": []}
    for measure in reference["measures"]:
        rows = [{"string": string, "frets": []} for string in range(1, 7)]
        for event in measure["events"]:
            for note in event["notes"]:
                rows[note["string"] - 1]["frets"].append(note["fret"])
        reading["measures"].append({"number": measure["number"], "strings": rows, "uncertain_items": []})
    return reading


class StringVerifierTests(unittest.TestCase):
    def setUp(self):
        self.reading = reference_reading()
        self.reference = json.loads(REFERENCE_PATH.read_text(encoding="utf-8"))

    def test_reverse_output_order_preserves_frets_and_scores(self):
        for measure in self.reading["measures"]:
            measure["strings"].reverse()
        reading = validate_reading(self.reading)
        diagnostic = evaluate_reading(reading, self.reference)
        self.assertEqual(diagnostic["correct_rows"], 12)
        self.assertEqual(diagnostic["correct_nonempty_rows"], 9)
        self.assertEqual(diagnostic["ordered_note_matches"], 20)
        self.assertEqual([row["string"] for row in reading["measures"][0]["strings"]], list(range(1, 7)))
        self.assertEqual(self.reading["measures"][0]["strings"][0]["string"], 6)

    def test_correct_digit_inventory_does_not_prove_correct_strings(self):
        rows = self.reading["measures"][0]["strings"]
        rows[1]["frets"], rows[3]["frets"] = rows[3]["frets"], rows[1]["frets"]
        diagnostic = evaluate_reading(validate_reading(self.reading), self.reference)
        self.assertEqual(diagnostic["fret_inventory_matches_ignoring_strings"], 20)
        self.assertLess(diagnostic["ordered_note_matches"], 20)
        self.assertEqual(diagnostic["correct_rows"], 10)

    def test_verification_counts_both_fixes_and_regressions(self):
        before = copy.deepcopy(self.reading)
        before["measures"][0]["strings"][1]["frets"] = [9]
        after = copy.deepcopy(self.reading)
        after["measures"][1]["strings"][0]["frets"] = [9]
        change = compare_verification(evaluate_reading(before, self.reference),
                                      evaluate_reading(after, self.reference))
        self.assertEqual(change["fixed_rows"], 1)
        self.assertEqual(change["regressed_rows"], 1)
        self.assertEqual(change["ordered_note_match_delta"], 0)

    def test_unknowns_are_not_treated_as_empty_strings_or_zero_frets(self):
        self.reading["measures"][0]["strings"][0]["frets"] = None
        self.reading["measures"][0]["strings"][1]["frets"][0] = None
        diagnostic = evaluate_reading(validate_reading(self.reading), self.reference)
        self.assertEqual(diagnostic["unknown_rows"], 1)
        self.assertEqual(diagnostic["unknown_digits"], 1)
        self.assertEqual(diagnostic["correct_rows"], 10)
        self.assertEqual(diagnostic["ordered_note_matches"], 19)

    def test_ordered_matching_respects_order_and_duplicate_counts(self):
        self.assertEqual(ordered_matches([0, 2, 3], [0, 3, 2]), 2)
        self.assertEqual(ordered_matches([0, 0, 0], [0]), 1)
        self.assertEqual(ordered_matches([0], [None]), 0)

    def test_invalid_tables_do_not_become_valid_drafts(self):
        changes = [lambda r: r["measures"][0]["strings"][0].update(string=True),
                   lambda r: r["measures"][0]["strings"][0].update(string=2),
                   lambda r: r["measures"][0]["strings"][1].update(frets=[True]),
                   lambda r: r["measures"][0]["strings"].pop(),
                   lambda r: r["measures"][1].update(number=2),
                   lambda r: r.update(confidence=0.97)]
        for change in changes:
            with self.subTest(change=change):
                reading = copy.deepcopy(self.reading)
                change(reading)
                with self.assertRaises(StringFormatError):
                    validate_reading(reading)

    def test_prompt_json_example_is_valid_without_real_answer(self):
        system, _ = load_string_prompts("forward")
        example, _ = json.JSONDecoder().raw_decode(system[system.index('{'):])
        validate_reading(example, (99,))
        self.assertNotIn("[0, 0, 3]", system)


if __name__ == "__main__":
    unittest.main()
