"""Prepare the quiet guitar takes used by up-strums.

The middle-dynamic instrument remains the fallback for missing takes. Source
AIFF files are read without modification; generated files live in soft/.
"""

import json
from pathlib import Path

import prepare_guitar as guitar

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'Guitar.stereo.1644.1/1644stereo'
OUT = ROOT / 'app/web/audio/guitar/soft'


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    guitar.OUT = OUT
    samples = []
    for path in sorted(SOURCE.glob('Guitar.pp.*.aif')):
        extracted = guitar.extract(path, skip_missing=True)
        samples.extend(extracted)
        print(path.name, len(extracted), 'notes')
    if not samples:
        raise RuntimeError('No local quiet guitar recordings found')
    for item in samples:
        item['url'] = f"/audio/guitar/soft/s{item['string']}-{item['midi']}.wav"
    (OUT / 'manifest.json').write_text(
        json.dumps({'name': '本地吉他采样 · pp', 'samples': samples},
                   ensure_ascii=False, indent=2), encoding='utf-8')
    print('Prepared', len(samples), 'quiet samples; originals preserved.')


if __name__ == '__main__':
    main()
