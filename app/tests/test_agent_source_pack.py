import base64
from io import BytesIO
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from PIL import Image


SCRIPT = Path(__file__).resolve().parents[2] / 'scripts' / 'pack_agent_source.py'


class AgentSourcePackTest(unittest.TestCase):
    def test_embeds_image_once_and_keeps_two_measure_boxes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            Image.new('RGB', (120, 90), '#ffffff').save(root / 'sheet.png')
            draft = {'format': 'tablens.agent.v1', 'metadata': {'title': '示例', 'tempo_bpm': 80,
                     'time_signature': [4, 4], 'capo': 0}, 'measures': [
                         {'number': 1, 'events': [{'duration': '1/4', 'notes': [{'string': 1, 'fret': 0}]}]},
                         {'number': 2, 'events': [{'duration': '1/4', 'notes': [{'string': 2, 'fret': 1}]}]}
                     ]}
            manifest = {'pages': [{'id': 'page-1', 'file': 'sheet.png'}], 'measures': [
                {'number': 1, 'pageId': 'page-1', 'box': [0, 0, 60, 80]},
                {'number': 2, 'pageId': 'page-1', 'box': [60, 0, 120, 80]}
            ]}
            (root / 'draft.json').write_text(json.dumps(draft), encoding='utf-8')
            (root / 'manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
            command = [sys.executable, str(SCRIPT), str(root / 'draft.json'),
                       str(root / 'manifest.json'), str(root / 'final.json')]
            completed = subprocess.run(command, capture_output=True, text=True, check=False)
            self.assertEqual(completed.returncode, 0, completed.stderr)
            result = json.loads((root / 'final.json').read_text(encoding='utf-8'))
            self.assertEqual(result['format'], 'tablens.agent.v2')
            self.assertEqual(len(result['sources']), 1)
            self.assertEqual(result['measures'][0]['events'], draft['measures'][0]['events'])
            self.assertEqual([measure['source']['box'] for measure in result['measures']],
                             [[0, 0, 60, 80], [60, 0, 120, 80]])
            image = Image.open(BytesIO(base64.b64decode(result['sources'][0]['dataUrl'].split(',', 1)[1])))
            self.assertEqual(image.size, (120, 90))
            manifest['measures'][1]['box'] = [60, 0, 121, 80]
            (root / 'manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
            completed = subprocess.run(command, capture_output=True, text=True, check=False)
            self.assertNotEqual(completed.returncode, 0)


if __name__ == '__main__':
    unittest.main()
