"""Read numbered image cells; geometry supplies string/column membership."""

import json
import math
from pathlib import Path

from PIL import Image, ImageDraw

from event_pipeline import _keys, _target_measures, position_evidence
from string_anchors import AnchorError, _font
from symbol_reader import SymbolFormatError


PROMPT_DIR = Path(__file__).resolve().parent / "prompts"


def prepare_cell_samples(samples, output_dir):
    """Crop only from line/stem geometry; never inspect fret values or a reference."""
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    anchors = json.loads(samples["event_manifest"].read_text(encoding="utf-8"))
    gap = (anchors["string_y"][-1] - anchors["string_y"][0]) / 5
    half_height = round(gap * 0.85)
    scale, side, title_height = 2, 64, 64
    paths = {"cell_geometry": output_dir / "lullaby_cell_geometry.json"}
    geometry = {"scale": scale, "reference_used": False, "coordinate_space": "row_crop_pixels", "cells": []}
    with Image.open(samples["row"]) as source:
        source = source.convert("RGB")
        for measure in anchors["measures"]:
            xs = [column["x"] for column in measure["columns"]]
            if len(xs) < 2:
                raise AnchorError("本轮分格需要至少两个符干候选来估计水平裁剪宽度。")
            bounds = []
            for index, x in enumerate(xs):
                left = (xs[index - 1] + x) / 2 if index else x - (xs[1] - x) / 2
                right = (x + xs[index + 1]) / 2 if index + 1 < len(xs) else x + (x - xs[index - 1]) / 2
                left = max(math.floor(left), math.ceil(measure["left"]))
                right = min(math.ceil(right), math.floor(measure["right"]))
                if not 0 <= left <= x < right <= source.width:
                    raise AnchorError("发声位置太靠近图片或小节边界，无法生成完整候选格子。")
                bounds.append((left, right))
            cell_width = max((right - left) * scale for left, right in bounds) + 24
            cell_height = (half_height * 2 + 1) * scale + 30
            grid = Image.new("RGB", (side + cell_width * len(xs) + 8, title_height + 6 * cell_height + 8), "white")
            draw = ImageDraw.Draw(grid)
            draw.text((10, 8), f"MEASURE {measure['number']}", fill="#164c9b", font=_font(24))
            for column in measure["columns"]:
                column_x = side + (column["index"] - 0.5) * cell_width
                draw.text((column_x, 44), f"{measure['number']}.{column['index']}",
                          fill="#164c9b", font=_font(18), anchor="mm")
            for row_index, center in enumerate(anchors["string_y"]):
                top, bottom = round(center) - half_height, round(center) + half_height + 1
                if top < 0 or bottom > source.height:
                    raise AnchorError("弦太靠近图片边缘，不能完整保留当前弦的字符。")
                cell_top = title_height + row_index * cell_height
                draw.text((8, cell_top + cell_height / 2), f"S{row_index + 1}",
                          fill="#164c9b", font=_font(22), anchor="lm")
                for column, (left, right) in zip(measure["columns"], bounds):
                    cell_left = side + (column["index"] - 1) * cell_width
                    box = (left, top, right, bottom)
                    snippet = source.crop(box)
                    enlarged = snippet.resize((snippet.width * scale, snippet.height * scale), Image.Resampling.NEAREST)
                    paste_x = cell_left + (cell_width - enlarged.width) // 2
                    paste_y = cell_top + (cell_height - enlarged.height) // 2
                    grid.paste(enlarged, (paste_x, paste_y))
                    draw.rectangle((cell_left, cell_top, cell_left + cell_width - 1, cell_top + cell_height - 1),
                                   outline="#d7dfe9", width=1)
                    target_y = paste_y + (center - top) * scale
                    draw.line((paste_x - 7, target_y, paste_x - 2, target_y), fill="#164c9b", width=2)
                    draw.line((paste_x + enlarged.width + 2, target_y, paste_x + enlarged.width + 7, target_y),
                              fill="#164c9b", width=2)
                    geometry["cells"].append({"measure": measure["number"], "string": row_index + 1,
                                              "column": column["index"], "source_box": list(box),
                                              "paste_xy": [paste_x, paste_y], "target_y": target_y})
            key = f"cells_m{measure['number']}"
            paths[key] = output_dir / f"lullaby_cells_m{measure['number']}.png"
            grid.save(paths[key])
    paths["cell_geometry"].write_text(json.dumps(geometry, indent=2), encoding="utf-8")
    return paths


def load_cell_prompts(samples):
    anchors = json.loads(samples["event_manifest"].read_text(encoding="utf-8"))
    descriptions = "；".join(f"第{index + 2}张图：第{measure['number']}小节，6行、{len(measure['columns'])}列"
                             for index, measure in enumerate(anchors["measures"]))
    return ((PROMPT_DIR / "cells_system.txt").read_text(encoding="utf-8"),
            (PROMPT_DIR / "cells_user.txt").read_text(encoding="utf-8").replace("{{GRID_DESCRIPTION}}", descriptions))


def _issues(value):
    if not isinstance(value, list) or len(value) > 64 or any(
            not isinstance(item, str) or len(item) > 2000 for item in value):
        raise SymbolFormatError("分格读取的待确认项必须为字符串列表")
    return list(value)


def cells_to_positions(observation, anchors):
    _keys(observation, ["measures", "uncertain_items"], "cells")
    geometry = {m["number"]: m for m in anchors["measures"]}
    positions = {"measures": [], "uncertain_items": _issues(observation["uncertain_items"])}
    for measure in _target_measures(observation["measures"], anchors):
        _keys(measure, ["number", "string_rows", "uncertain_items"], "cells.measure")
        if not isinstance(measure["string_rows"], list) or len(measure["string_rows"]) != 6:
            raise SymbolFormatError("每个小节必须包含六根弦行")
        rows, unassigned = [], []
        for row in measure["string_rows"]:
            _keys(row, ["string", "cells"], "cells.string_row")
            if not isinstance(row["cells"], list) or len(row["cells"]) != len(geometry[measure["number"]]["columns"]):
                raise SymbolFormatError("每根弦的格子数量必须与图像列数一致，不能省略空格")
            notes = []
            for column, cell in enumerate(row["cells"], 1):
                if cell is None:
                    unassigned.append({"string": row["string"], "column": column, "fret": None,
                                       "reason": "无法确定当前格子是否有品位数字"})
                elif isinstance(cell, list) and len(cell) <= 1:
                    if cell:
                        notes.append({"column": column, "fret": cell[0]})
                else:
                    raise SymbolFormatError("格子必须为空列表、单个品位列表或null")
            rows.append({"string": row["string"], "notes": notes})
        positions["measures"].append({"number": measure["number"], "string_rows": rows,
                                       "unassigned_notes": unassigned,
                                       "uncertain_items": _issues(measure["uncertain_items"])})
    position_evidence(positions, anchors)
    return positions
