"""TabLens Agent Score DSL & Builder Helper

Provides reusable data structures, chord fingerings, rhythm generators,
and draft validation for creating tablens.agent.v1 scores.
"""

from fractions import Fraction
import json
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Union


# Permitted durations in TabLens
VALID_DURATIONS = {'1', '1/2', '1/4', '1/8', '1/16', '1/32', '3/8', '3/16'}


def note(string: int, fret: Optional[int], tech: Optional[Union[str, dict]] = None, dynamics: Optional[str] = None) -> dict:
    """Create a single note specification."""
    if not (1 <= string <= 6):
        raise ValueError(f"String must be 1..6, got {string}")
    if fret is not None and not (0 <= fret <= 36):
        raise ValueError(f"Fret must be 0..36 or None, got {fret}")
    res = {"string": string, "fret": fret}
    if tech:
        if isinstance(tech, str):
            res["technique"] = {"type": tech}
        elif isinstance(tech, dict):
            res["technique"] = tech
    if dynamics:
        if dynamics not in ('soft', 'normal', 'strong'):
            raise ValueError(f"Dynamics must be soft, normal or strong, got {dynamics}")
        res["dynamics"] = dynamics
    return res


def ev(duration: str, notes: List[dict], chord: Optional[str] = None,
       strum: Optional[Union[str, dict]] = None, dynamics: Optional[str] = None,
       kind: Optional[str] = None, issues: Optional[List[str]] = None) -> dict:
    """Create a single performance event position."""
    if duration not in VALID_DURATIONS:
        raise ValueError(f"Invalid duration '{duration}'. Allowed: {sorted(VALID_DURATIONS)}")
    res = {"duration": duration, "notes": notes}
    if chord:
        res["chordName"] = chord
    if strum:
        if isinstance(strum, str):
            res["strum"] = {"direction": strum}
        elif isinstance(strum, dict):
            res["strum"] = strum
    if dynamics:
        res["dynamics"] = dynamics
    if kind:
        res["kind"] = kind
    if issues:
        res["uncertain_items"] = issues
    return res


def rest(duration: str, issues: Optional[List[str]] = None) -> dict:
    """Create a rest event."""
    return ev(duration, [], kind="rest", issues=issues)


def unknown(duration: str, chordName: Optional[str] = None, strum: Optional[str] = None,
            issues: Optional[List[str]] = None) -> dict:
    """Create an unknown position (e.g. chord pending fret assignment)."""
    return ev(duration, [], chord=chordName, strum=strum, kind="unknown", issues=issues)


# Common standard guitar chord voicings (string: fret)
STANDARD_CHORDS = {
    # C family
    "C": [(5, 3), (4, 2), (3, 0), (2, 1), (1, 0)],
    "Cadd9": [(5, 3), (4, 2), (3, 0), (2, 3), (1, 3)],
    "Cmaj7": [(5, 3), (4, 2), (3, 0), (2, 0), (1, 0)],
    "C7": [(5, 3), (4, 2), (3, 3), (2, 1), (1, 0)],
    "C/G": [(6, 3), (5, 3), (4, 2), (3, 0), (2, 1), (1, 0)],

    # D family
    "D": [(4, 0), (3, 2), (2, 3), (1, 2)],
    "Dm": [(4, 0), (3, 2), (2, 3), (1, 1)],
    "Dsus2": [(4, 0), (3, 2), (2, 3), (1, 0)],
    "Dsus4": [(4, 0), (3, 2), (2, 3), (1, 3)],
    "D7": [(4, 0), (3, 2), (2, 1), (1, 2)],
    "D/F#": [(6, 2), (4, 0), (3, 2), (2, 3), (1, 2)],

    # E family
    "E": [(6, 0), (5, 2), (4, 2), (3, 1), (2, 0), (1, 0)],
    "Em": [(6, 0), (5, 2), (4, 2), (3, 0), (2, 0), (1, 0)],
    "Em7": [(6, 0), (5, 2), (4, 0), (3, 0), (2, 0), (1, 0)],
    "E7": [(6, 0), (5, 2), (4, 0), (3, 1), (2, 0), (1, 0)],

    # F family
    "F": [(6, 1), (5, 3), (4, 3), (3, 2), (2, 1), (1, 1)],
    "Fmaj7": [(4, 3), (3, 2), (2, 1), (1, 0)],
    "Fm": [(6, 1), (5, 3), (4, 3), (3, 1), (2, 1), (1, 1)],

    # G family
    "G": [(6, 3), (5, 2), (4, 0), (3, 0), (2, 0), (1, 3)],
    "G6": [(6, 3), (5, 2), (4, 0), (3, 0), (2, 0), (1, 0)],
    "G7": [(6, 3), (5, 2), (4, 0), (3, 0), (2, 0), (1, 1)],
    "G/B": [(5, 2), (4, 0), (3, 0), (2, 0), (1, 3)],

    # A family
    "A": [(5, 0), (4, 2), (3, 2), (2, 2), (1, 0)],
    "Am": [(5, 0), (4, 2), (3, 2), (2, 1), (1, 0)],
    "Am7": [(5, 0), (4, 2), (3, 0), (2, 1), (1, 0)],
    "A7": [(5, 0), (4, 2), (3, 0), (2, 2), (1, 0)],
    "Asus2": [(5, 0), (4, 2), (3, 2), (2, 0), (1, 0)],
    "Asus4": [(5, 0), (4, 2), (3, 2), (2, 3), (1, 0)],

    # B family
    "Bm": [(5, 2), (4, 4), (3, 4), (2, 3), (1, 2)],
    "Bm7": [(5, 2), (4, 0), (3, 2), (2, 3), (1, 2)],
    "B7": [(5, 2), (4, 1), (3, 2), (2, 0), (1, 2)],
}


def get_chord_notes(chord_name: str, custom_voicings: Optional[dict] = None) -> List[dict]:
    """Retrieve note list for a chord name."""
    voicings = {**STANDARD_CHORDS, **(custom_voicings or {})}
    if chord_name not in voicings:
        raise ValueError(f"Unknown chord '{chord_name}'. Register it in custom_voicings.")
    return [note(s, f) for s, f in voicings[chord_name]]


def strum_event(chord_name: str, duration: str, direction: str,
                custom_voicings: Optional[dict] = None, spread_beats: Optional[float] = None) -> dict:
    """Generate a full chord strum event."""
    notes = get_chord_notes(chord_name, custom_voicings)
    st = {"direction": direction}
    if spread_beats is not None:
        st["spreadBeats"] = spread_beats
    return ev(duration, notes, chord=chord_name, strum=st)


class ScoreDraft:
    """Builder for tablens.agent.v1 music structure."""

    def __init__(self, title: str, tempo_bpm: Optional[int] = None,
                 time_signature: Optional[Tuple[int, int]] = (4, 4), capo: int = 0):
        self.title = title
        self.tempo_bpm = tempo_bpm
        self.time_signature = list(time_signature) if time_signature else None
        self.capo = capo
        self.measures: List[dict] = []
        self.custom_voicings: Dict[str, List[Tuple[int, int]]] = {}
        self.uncertain_items: List[str] = []

    def register_chord(self, chord_name: str, fingering: List[Tuple[int, int]]):
        """Register custom or non-standard chord voicing."""
        self.custom_voicings[chord_name] = fingering

    def add_measure(self, number: int, events: List[dict],
                    allow_incomplete: bool = False,
                    uncertain_items: Optional[List[str]] = None) -> 'ScoreDraft':
        """Add a measure to the score draft."""
        m = {
            "number": number,
            "events": events
        }
        if allow_incomplete:
            m["allow_incomplete"] = True
        if uncertain_items:
            m["uncertain_items"] = uncertain_items
        self.measures.append(m)
        return self

    def check_timing(self) -> List[str]:
        """Validate measure timing sums against time_signature."""
        if not self.time_signature:
            return []
        num, den = self.time_signature
        expected = Fraction(num, den)
        warnings = []
        for m in self.measures:
            total = Fraction(0, 1)
            for e in m.get("events", []):
                d = e.get("duration")
                if not d:
                    warnings.append(f"Measure {m['number']} has event without duration")
                    continue
                parts = d.split('/')
                f = Fraction(int(parts[0]), int(parts[1]) if len(parts) > 1 else 1)
                total += f
            if m.get("allow_incomplete"):
                if total > expected:
                    warnings.append(f"Measure {m['number']} marked allow_incomplete but total ({total}) > expected ({expected})")
            else:
                if total != expected:
                    warnings.append(f"Measure {m['number']} total ({total}) != expected ({expected})")
        return warnings

    def to_dict(self) -> dict:
        """Convert to dict structure conforming to tablens.agent.v1."""
        res = {
            "format": "tablens.agent.v1",
            "metadata": {
                "title": self.title,
                "tempo_bpm": self.tempo_bpm,
                "time_signature": self.time_signature,
                "capo": self.capo
            },
            "measures": self.measures
        }
        if self.uncertain_items:
            res["uncertain_items"] = self.uncertain_items
        return res

    def save(self, output_path: Union[str, Path]) -> Path:
        """Write draft JSON to disk."""
        out = Path(output_path).resolve()
        warnings = self.check_timing()
        if warnings:
            print(f"⚠️ Warning: Found {len(warnings)} timing discrepancies while saving {out.name}:")
            for w in warnings:
                print(f"   - {w}")
        else:
            print(f"✅ All {len(self.measures)} measures match {self.time_signature} timing cleanly.")

        out.write_text(json.dumps(self.to_dict(), ensure_ascii=False, indent=2), encoding='utf-8')
        print(f"Saved tablens.agent.v1 draft: {out}")
        return out
