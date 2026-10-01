import copy
import json
from pathlib import Path
import tempfile
import unittest

from PIL import Image

from cell_reader import cells_to_positions, prepare_cell_samples
from event_pipeline import prepare_event_samples
from string_anchors import prepare_anchor_samples
from symbol_reader import SymbolFormatError
import test_event_pipeline
from test_event_pipeline import reference_parts


def reference_cells():
    positions, _, anchors = reference_parts()
    observation = {"measures": [], "uncertain_items": []}
    for measure in positions["measures"]:
        count = len(next(m for m in anchors["measures"] if m["number"] == measure["number"])["columns"])
        rows = []
        for row in measure["string_rows"]:
            cells = [[] for _ in range(count)]
            for note in row["notes"]:
                cells[note["column"] - 1] = [note["fret"]]
            rows.append({"string": row["string"], "cells": cells})
        observation["measures"].append({"number": measure["number"], "string_rows": rows, "uncertain_items": []})
    return observation


class CellReaderTests(unittest.TestCase):
    def setUp(self):
        self.cells = reference_cells()
        self.positions, _, self.anchors = reference_parts()

    def test_cells_preserve_empty_spaces_open_strings_and_exact_positions(self):
        actual = cells_to_positions(self.cells, self.anchors)
        self.assertEqual(actual, self.positions)
        self.assertEqual(actual["measures"][0]["string_rows"][1]["notes"][0], {"column": 1, "fret": 0})
        self.assertEqual(actual["measures"][0]["string_rows"][3]["notes"][1], {"column": 6, "fret": 0})

    def test_unknown_presence_and_unknown_fret_remain_distinct_from_empty(self):
        row = self.cells["measures"][0]["string_rows"][1]
        row["cells"][0] = [None]
        row["cells"][1] = None
        actual = cells_to_positions(self.cells, self.anchors)["measures"][0]
        self.assertEqual(actual["string_rows"][1]["notes"][0], {"column": 1, "fret": None})
        self.assertEqual(actual["unassigned_notes"][0]["column"], 2)
        self.assertIsNone(actual["unassigned_notes"][0]["fret"])

    def test_missing_empty_cell_is_rejected_instead_of_shifting_columns(self):
        self.cells["measures"][0]["string_rows"][0]["cells"].pop()
        with self.assertRaises(SymbolFormatError):
            cells_to_positions(self.cells, self.anchors)

    def test_boolean_frets_scalar_cells_and_duplicate_strings_are_rejected(self):
        changes = [lambda value: value["measures"][0]["string_rows"][1]["cells"].__setitem__(0, [True]),
                   lambda value: value["measures"][0]["string_rows"][1]["cells"].__setitem__(0, 0),
                   lambda value: value["measures"][0]["string_rows"][1]["cells"].__setitem__(0, [1, 2]),
                   lambda value: value["measures"][0]["string_rows"][0].update(string=2)]
        for change in changes:
            with self.subTest(change=change):
                value = copy.deepcopy(self.cells)
                change(value)
                with self.assertRaises(SymbolFormatError):
                    cells_to_positions(value, self.anchors)

    def test_cell_images_copy_source_pixels_and_use_detected_column_count(self):
        with tempfile.TemporaryDirectory(prefix="tablab-cells-") as directory:
            root = Path(directory)
            source = test_event_pipeline.ColumnImageTests().source()
            row_path = root / "row.png"
            source.save(row_path)
            samples = {"row": row_path, **prepare_anchor_samples(row_path, root)}
            samples.update(prepare_event_samples(samples, root))
            samples.update(prepare_cell_samples(samples, root))
            geometry = json.loads(samples["cell_geometry"].read_text(encoding="utf-8"))
            self.assertFalse(geometry["reference_used"])
            self.assertEqual(len(geometry["cells"]), 2 * 6 * 2)
            for number in [2, 3]:
                with Image.open(samples[f"cells_m{number}"]) as grid:
                    for cell in (cell for cell in geometry["cells"] if cell["measure"] == number):
                        original = source.crop(cell["source_box"])
                        enlarged = original.resize((original.width * 2, original.height * 2), Image.Resampling.NEAREST)
                        x, y = cell["paste_xy"]
                        self.assertEqual(grid.crop((x, y, x + enlarged.width, y + enlarged.height)).tobytes(), enlarged.tobytes())


if __name__ == "__main__":
    unittest.main()
