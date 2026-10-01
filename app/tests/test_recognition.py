import base64
import json
import re
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch, Mock
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'app'))
from recognition import RecognitionService, geometry


class RecognitionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.service = RecognitionService(self.temp.name, self.fake)
        self.service.configure({'key':'mock-test-key'})

    def fake(self, config, system, user, paths):
        if len(paths) == 1:
            return {'title':'测试','tempo':80,'capo':6,'timeSignature':[4,4],'tuningMidi':None}, {}
        if 'string_rows' in system:
            number, columns = map(int, re.search(r'第(\d+)小节，6行、(\d+)列',user).groups())
            return {'measures':[{'number':number,'string_rows':[{'string':s,'cells':[[0] if s in (1,6) else [] for _ in range(columns)]} for s in range(1,7)],'uncertain_items':[]}],'uncertain_items':[]}, {}
        number = int(re.search(r'第2张是第(\d+)小节', user).group(1))
        segment = next(s for p in self.service.prepared.values() for s in p['segments'] if s['number']==number)
        return {'measures':[{'number':number,'strings':[{'string':s,'frets':[0]*len(segment['columns']) if s in (1,6) else []} for s in range(1,7)],'uncertain_items':[]}],'uncertain_items':[]}, {}

    def prepare(self, filename='lullaby.jpg', box=None):
        data = 'data:image/png;base64,' + base64.b64encode((ROOT/filename).read_bytes()).decode()
        return self.service.prepare({'imageDataUrl':data,'name':filename,'box':box})

    def wait(self, job):
        deadline=time.monotonic()+10
        while time.monotonic()<deadline:
            state=self.service.status(job['id'])
            if state['state'] not in ('running','cancelling'): return state
            time.sleep(.02)
        self.fail('job timed out')

    def test_geometry_both_pages_and_short_final_row(self):
        lullaby=geometry(Image.open(ROOT/'lullaby.jpg'))
        duvet=geometry(Image.open(ROOT/'duvet.png'))
        self.assertEqual(len(lullaby),8)
        self.assertEqual(len(duvet),17)
        self.assertEqual(len(duvet[0]['columns']),16)
        self.assertFalse(duvet[-1]['readable'])
        self.assertEqual(sum(s['readable'] for s in duvet),12)

    def test_region_does_not_accidentally_include_adjacent_bars(self):
        whole=self.prepare(); chosen=whole['segments'][1]
        region=self.prepare(box=chosen['box'])
        self.assertEqual([s['number'] for s in region['segments']],[2])

    def test_real_image_pipeline_with_mock_api_preserves_chord_coordinates(self):
        p=self.prepare();j=self.service.start({'preparedId':p['id'],'segmentIds':[p['segments'][0]['id']]})
        state=self.wait(j)
        self.assertEqual(state['state'],'complete',state['errors'])
        self.assertEqual(state['calls'],3)
        result=state['result'];self.assertEqual(result['capo'],6)
        events=result['measures'][0]['events'];self.assertEqual(len(events),10)
        self.assertTrue(all([n['string'] for n in e['notes']]==[1,6] for e in events))
        self.assertTrue(all(e['duration'] is None for e in events))
        self.assertGreater(events[0]['notes'][0]['source']['box'][1],200)
        self.assertNotIn('mock-test-key',json.dumps(state))
        self.assertNotIn('key',self.service.settings())
        self.assertFalse(result['measures'][0]['issues'])

    def test_cancel_inflight_never_appends_late_candidate_or_calls_again(self):
        entered,release=threading.Event(),threading.Event()
        self.addCleanup(release.set)
        def blocked(*args):
            entered.set();release.wait(3);return {},{}
        self.service.caller=blocked;p=self.prepare()
        job=self.service.start({'preparedId':p['id'],'segmentIds':[p['segments'][0]['id']]})
        self.assertTrue(entered.wait(2));self.service.cancel(job['id']);release.set()
        state=self.wait(job);self.assertEqual(state['state'],'cancelled')
        self.assertEqual(state['calls'],1);self.assertEqual(state['result']['measures'],[])

    def test_failed_segment_keeps_successful_segment_without_automatic_retry(self):
        normal=self.fake
        def fail_second(config,system,user,paths):
            if len(paths)>1 and '第2小节' in user: raise ValueError('mock failure')
            return normal(config,system,user,paths)
        self.service.caller=fail_second;p=self.prepare()
        job=self.service.start({'preparedId':p['id'],'segmentIds':[s['id'] for s in p['segments'][:2]]})
        state=self.wait(job);self.assertEqual(state['state'],'partial',state['errors'])
        self.assertEqual(state['calls'],4);self.assertEqual(len(state['result']['measures']),1)

    def test_blank_image_rejected_before_any_model_calls(self):
        with self.assertRaisesRegex(ValueError,'六条'):
            geometry(Image.new('RGB',(400,600),'white'))

    def test_all_readable_duvet_segments_use_same_generic_pipeline(self):
        p=self.prepare('duvet.png'); chosen=[s['id'] for s in p['segments'] if s['readable']]
        state=self.wait(self.service.start({'preparedId':p['id'],'segmentIds':chosen}))
        self.assertEqual(state['state'],'complete',state['errors'])
        self.assertEqual(state['calls'],25)
        self.assertEqual(len(state['result']['measures']),12)
        self.assertTrue(any('未自动读取' in issue for issue in state['result']['issues']))

    def test_transport_uses_image_messages_and_never_echoes_provider_error_body(self):
        response=Mock(ok=True)
        response.json.return_value={'choices':[{'message':{'content':'```json\n{"tempo":80}\n```'}}],'usage':{'prompt_tokens':3}}
        with patch('recognition.requests.post',return_value=response) as call:
            value,usage=self.service.call_model(self.service.config,'system','user',[ROOT/'duvet.png'])
            self.assertEqual(value,{'tempo':80});self.assertEqual(usage['prompt_tokens'],3)
            payload=call.call_args.kwargs['json']
            self.assertEqual(payload['thinking'],{'type':'disabled'})
            self.assertEqual(payload['response_format'],{'type':'json_object'})
            self.assertFalse(call.call_args.kwargs['allow_redirects'])
            self.assertEqual(payload['messages'][1]['content'][1]['type'],'image_url')
            self.assertTrue(payload['messages'][1]['content'][1]['image_url']['url'].startswith('data:image/png;base64,'))
            self.assertEqual(call.call_args.kwargs['headers']['Authorization'],'Bearer mock-test-key')
        response.ok=False;response.status_code=401;response.text='mock-test-key'
        with patch('recognition.requests.post',return_value=response):
            with self.assertRaises(ValueError) as error:
                self.service.call_model(self.service.config,'system','user',[])
            self.assertNotIn('mock-test-key',str(error.exception))

    def test_truncated_or_empty_output_is_reported_without_accepting_partial_notes(self):
        for message,reason,expected in [
            ({'content':'{"measures":['},'length','被截断'),
            ({'content':None,'reasoning_content':'analysis'},'stop','没有返回正文'),
            ({'content':'Here is the score: {}'},'stop','不是完整JSON'),
            ({'content':'[]'},'stop','JSON对象')]:
            response=Mock(ok=True)
            response.json.return_value={'choices':[{'message':message,'finish_reason':reason}]}
            with patch('recognition.requests.post',return_value=response):
                with self.assertRaisesRegex(ValueError,expected):
                    self.service.call_model(self.service.config,'system','user',[])

    def test_other_provider_does_not_receive_deepseek_thinking_parameter(self):
        response=Mock(ok=True)
        response.json.return_value={'choices':[{'message':{'content':'{}'}}]}
        settings={**self.service.config,'endpoint':'https://vision.example/v1/chat/completions'}
        with patch('recognition.requests.post',return_value=response) as call:
            self.service.call_model(settings,'system','user',[])
            self.assertNotIn('thinking',call.call_args.kwargs['json'])

    def test_diagnostic_redacts_key_and_does_not_include_request_headers(self):
        response=Mock(ok=True)
        response.json.return_value={'choices':[{'message':{'content':'{"note":"mock-test-key"}'}}]}
        with patch('recognition.requests.post',return_value=response):
            self.service.call_model(self.service.config,'system','user',[])
        diagnostic=next((self.service.directory/'responses').glob('*.json')).read_text(encoding='utf8')
        self.assertNotIn('mock-test-key',diagnostic)
        self.assertNotIn('Authorization',diagnostic)


if __name__=='__main__': unittest.main()
