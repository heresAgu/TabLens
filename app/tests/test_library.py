import copy
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from urllib.request import Request,urlopen
from urllib.error import HTTPError
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from library import ScoreLibrary,LibraryConflict

def score(identifier='test',title='测试编曲'):
    return dict(schema='tablens.score',version=1,id=identifier,title=title,sources=[],measures=[dict(id='m1',number=1,events=[dict(id='e1',duration='1/8',notes=[dict(id='n1',string=4,fret=2),dict(id='n2',string=1,fret=0)])])])

class LibraryTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='tablens-library-test-');self.root=Path(self.temp.name);self.library=ScoreLibrary(self.root/'乐谱库')
    def tearDown(self):self.temp.cleanup()
    def test_update_backup_and_reopen(self):
        value=score();first=self.library.save({'score':value})['record'];old=copy.deepcopy(value)
        value['measures'][0]['events'][0]['notes'][0]['fret']=7
        second=self.library.save({'score':value,'recordId':first['id'],'revision':first['revision']})['record']
        self.assertEqual(first['filename'],second['filename']);self.assertNotEqual(first['revision'],second['revision'])
        self.assertEqual(self.library.read(first['id'])['score'],value)
        self.assertEqual(json.loads((self.library.directory/'.备份'/f"{first['id']}.tablens.json").read_text(encoding='utf8')),old)
        self.assertEqual(len(self.library.list()['records']),1)
    def test_same_title_creates_independent_files(self):
        first=self.library.save({'score':score('a')})['record'];second=self.library.save({'score':score('b')})['record']
        self.assertNotEqual(first['filename'],second['filename']);self.assertEqual(len(self.library.list()['records']),2)
    def test_stale_revision_refuses_overwrite(self):
        value=score();first=self.library.save({'score':value})['record'];value['title']='改名'
        self.library.save({'score':value,'recordId':first['id'],'revision':first['revision']})
        with self.assertRaises(LibraryConflict):self.library.save({'score':score(),'recordId':first['id'],'revision':first['revision']})
        with self.assertRaises(LibraryConflict):self.library.save({'score':score()})
        self.assertEqual(self.library.read(first['id'])['score']['title'],'改名')
    def test_names_cannot_escape_library(self):
        for i,title in enumerate(['../../x','CON','A:B?*|','../nul']):
            record=self.library.save({'score':score(str(i),title)})['record']
            self.assertEqual((self.library.directory/record['filename']).resolve().parent,self.library.directory)
            self.assertNotIn('/',record['filename'])
        with self.assertRaises(ValueError):self.library.read('../../x')
    def test_invalid_chord_is_rejected_before_writing(self):
        value=score();value['measures'][0]['events'][0]['notes'][1]['string']=4
        with self.assertRaises(ValueError):self.library.save({'score':value})
        self.assertFalse(self.library.directory.exists())
    def test_deleted_file_requires_save_as(self):
        first=self.library.save({'score':score()})['record'];(self.library.directory/first['filename']).unlink()
        with self.assertRaises(LibraryConflict):self.library.save({'score':score(),'recordId':first['id'],'revision':first['revision']})
    def test_delete_moves_current_revision_and_backup_to_trash(self):
        value=score()
        first=self.library.save({'score':value})['record']
        value['title']='修改后'
        latest=self.library.save({'score':value,'recordId':first['id'],'revision':first['revision']})['record']
        with self.assertRaises(LibraryConflict):
            self.library.delete({'recordId':latest['id'],'revision':first['revision']})
        self.assertEqual(len(self.library.list()['records']),1)
        result=self.library.delete({'recordId':latest['id'],'revision':latest['revision']})
        self.assertEqual(result['scoreId'],value['id'])
        self.assertEqual(self.library.list()['records'],[])
        trash=Path(result['trash'])
        self.assertTrue((trash/latest['filename']).is_file())
        self.assertTrue((trash/('上次版本-'+latest['filename'])).is_file())
        with self.assertRaises(ValueError):
            self.library.read(latest['id'])
        with self.assertRaises(ValueError):
            self.library.delete({'recordId':'../../x','revision':latest['revision']})
    def test_http_save_list_open_and_conflict(self):
        import server
        previous=server.LIBRARY;server.LIBRARY=self.library
        host=server.LocalServer(('127.0.0.1',0),server.Handler);thread=threading.Thread(target=host.serve_forever,daemon=True);thread.start()
        base=f'http://127.0.0.1:{host.server_port}'
        def request(path,value=None):
            message=Request(base+path,data=json.dumps(value).encode() if value else None,headers={'Content-Type':'application/json','Origin':base})
            with urlopen(message,timeout=3) as response:return json.load(response)
        try:
            saved=request('/api/library/save',{'score':score()})['record']
            self.assertEqual(request('/api/library')['records'][0]['id'],saved['id'])
            self.assertEqual(request('/api/library/'+saved['id'])['score'],score())
            with self.assertRaises(HTTPError) as failure:request('/api/library/save',{'score':score()})
            self.assertEqual(failure.exception.code,409)
            self.assertEqual(len(self.library.list()['records']),1)
            deleted=request('/api/library/delete',{'recordId':saved['id'],'revision':saved['revision']})
            self.assertEqual(deleted['scoreId'],'test')
            self.assertEqual(request('/api/library')['records'],[])
        finally:
            host.shutdown();host.server_close();thread.join();server.LIBRARY=previous

if __name__=='__main__':unittest.main()
