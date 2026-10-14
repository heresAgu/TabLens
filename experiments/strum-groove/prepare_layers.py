"""Prepare only the pp/ff samples needed by the offline C/G sweep comparison."""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'app'))
import prepare_guitar as guitar  # noqa: E402

TARGETS = {(5, 48), (4, 52), (3, 55), (2, 60), (1, 64),
           (6, 43), (5, 47), (4, 50), (2, 59), (1, 67)}
RUNTIME = ROOT / 'experiments/.runtime/strum-groove'
ORIGINALS = ROOT / 'Guitar.stereo.1644.1/1644stereo'


def main():
    originals = json.loads((ROOT / 'app/web/audio/guitar/manifest.json').read_text(encoding='utf-8'))['samples']
    reference = [entry for entry in originals if (entry['string'], entry['midi']) in TARGETS]
    if len(reference) != len(TARGETS):
        raise RuntimeError('Middle-dynamic manifest is missing a required note')
    layers = {}
    for level in ('pp', 'ff'):
        guitar.OUT = RUNTIME / 'layers' / level
        guitar.OUT.mkdir(parents=True, exist_ok=True)
        sources = sorted({entry['source'].replace('.mf.', f'.{level}.') for entry in reference})
        extracted = [entry for source in sources for entry in guitar.extract(ORIGINALS / source)]
        available = {(entry['string'], entry['midi']): entry for entry in extracted}
        missing = TARGETS - available.keys()
        if missing:
            print(level, 'missing', sorted(missing), '(middle-dynamic fallback will be used)')
        layers[level] = {f'{string}:{midi}': {**entry,
                         'url': f'/layers/{level}/s{string}-{midi}.wav'}
                         for (string, midi), entry in available.items() if (string, midi) in TARGETS}
        print(level, len(layers[level]), 'target notes available')
    (RUNTIME / 'layers.json').write_text(json.dumps(layers, indent=2, ensure_ascii=False), encoding='utf-8')


if __name__ == '__main__':
    main()
