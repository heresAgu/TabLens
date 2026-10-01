"""Local score library with atomic saves, one previous backup and revisions."""
import copy
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import threading
import uuid


class LibraryConflict(ValueError):
    pass


def validate_score(score):
    if not isinstance(score, dict) or score.get('schema') != 'tablens.score' or score.get('version') != 1:
        raise ValueError('不是TabLens乐谱')
    if not isinstance(score.get('id'), str) or not 1 <= len(score['id']) <= 120:
        raise ValueError('乐谱编号无效')
    if not isinstance(score.get('title'), str) or len(score['title']) > 120:
        raise ValueError('乐谱名称无效')
    if not isinstance(score.get('sources'), list) or not isinstance(score.get('measures'), list):
        raise ValueError('乐谱数据不完整')
    seen=set()
    for measure in score['measures']:
        if not isinstance(measure, dict) or not isinstance(measure.get('events'), list): raise ValueError('小节数据无效')
        for event in measure['events']:
            if not isinstance(event, dict) or not isinstance(event.get('notes'), list): raise ValueError('演奏位置无效')
            event_id=event.get('id')
            if not isinstance(event_id, str) or not event_id or event_id in seen: raise ValueError('演奏位置编号无效或重复')
            seen.add(event_id)
            duration=event.get('duration')
            if duration is not None and (not isinstance(duration,str) or not re.fullmatch(r'[1-9]\d*(?:/[1-9]\d*)?',duration)):
                raise ValueError('音符时值无效')
            strings=set()
            for note in event['notes']:
                if not isinstance(note,dict): raise ValueError('音符数据无效')
                nid=note.get('id');string=note.get('string');fret=note.get('fret')
                if not isinstance(nid,str) or not nid or nid in seen: raise ValueError('音符编号无效或重复')
                seen.add(nid)
                if type(string) is not int or not 1<=string<=6 or string in strings: raise ValueError('弦号重复或无效')
                strings.add(string)
                if fret is not None and (type(fret) is not int or not 0<=fret<=36): raise ValueError('品位无效')
    return score


class ScoreLibrary:
    def __init__(self,directory):
        self.directory=Path(directory).resolve()
        self.lock=threading.RLock()

    @staticmethod
    def record_id(score):
        return hashlib.sha256(score['id'].encode('utf8')).hexdigest()[:24]

    def files(self):
        for path in self.directory.glob('*.tablens.json'):
            if path.is_symlink(): continue
            try:
                data=path.read_bytes();score=validate_score(json.loads(data))
                yield path,score,hashlib.sha256(data).hexdigest()
            except (OSError,ValueError,TypeError): continue

    def record(self,path,score,revision):
        return {'id':self.record_id(score),'title':score['title'],'filename':path.name,'revision':revision,
                'modifiedAt':datetime.datetime.fromtimestamp(path.stat().st_mtime,datetime.timezone.utc).isoformat(),
                'measures':len(score['measures']),'notes':sum(len(e['notes']) for m in score['measures'] for e in m['events'])}

    def list(self):
        with self.lock:
            records=[self.record(p,s,r) for p,s,r in self.files()]
            return {'directory':str(self.directory),'records':sorted(records,key=lambda r:r['modifiedAt'],reverse=True)}

    def read(self,identifier):
        if not isinstance(identifier,str) or not re.fullmatch('[a-f0-9]{24}',identifier): raise ValueError('乐谱编号无效')
        with self.lock:
            for path,score,revision in self.files():
                if self.record_id(score)==identifier:
                    return {'record':self.record(path,score,revision),'score':score}
        raise ValueError('乐谱不存在或无法读取')

    def save(self,value):
        score=copy.deepcopy(validate_score(value.get('score')))
        score.pop('libraryRecord',None)
        identifier=self.record_id(score)
        if value.get('recordId') not in (None,identifier): raise ValueError('保存目标与当前乐谱不一致，请另存为')
        with self.lock:
            self.directory.mkdir(parents=True,exist_ok=True)
            existing=next(((p,s,r) for p,s,r in self.files() if self.record_id(s)==identifier),None)
            if existing:
                path,_,revision=existing
                if value.get('revision')!=revision:
                    raise LibraryConflict('文件已在其他窗口修改，或尚未从乐谱库打开；请重新打开或另存为，避免覆盖')
            else:
                if value.get('recordId'):
                    raise LibraryConflict('原乐谱文件已移动或删除，请另存为')
                title=re.sub(r'[\\/:*?"<>|\x00-\x1f]','_',score['title']).strip(' .')[:80] or '未命名乐谱'
                if title.upper().split('.')[0] in {'CON','PRN','AUX','NUL',*[f'COM{i}' for i in range(1,10)],*[f'LPT{i}' for i in range(1,10)]}:
                    title='乐谱-'+title
                path=self.directory/(title+'.tablens.json');index=2
                while path.exists():
                    path=self.directory/(f'{title} ({index}).tablens.json');index+=1
            data=json.dumps(score,ensure_ascii=False,indent=2,allow_nan=False).encode('utf8')
            if existing:
                backup=self.directory/'.备份';backup.mkdir(exist_ok=True)
                self.atomic(backup/(identifier+'.tablens.json'),path.read_bytes())
            self.atomic(path,data)
            revision=hashlib.sha256(data).hexdigest()
            return {'directory':str(self.directory),'record':self.record(path,score,revision)}

    def delete(self,value):
        identifier=value.get('recordId')
        revision=value.get('revision')
        if not isinstance(identifier,str) or not re.fullmatch('[a-f0-9]{24}',identifier):
            raise ValueError('乐谱编号无效')
        if not isinstance(revision,str) or not re.fullmatch('[a-f0-9]{64}',revision):
            raise ValueError('乐谱版本无效，请重新打开乐谱库')
        with self.lock:
            existing=next(((p,s,r) for p,s,r in self.files() if self.record_id(s)==identifier),None)
            if not existing:
                raise ValueError('乐谱已删除或无法读取，请刷新乐谱库')
            path,score,current_revision=existing
            if revision!=current_revision:
                raise LibraryConflict('乐谱已在其他窗口修改，请刷新乐谱库后再删除')
            trash=self.directory/'.回收站'
            trash.mkdir(exist_ok=True)
            folder=trash/(datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d-%H%M%S-%f')+'-'+uuid.uuid4().hex[:8])
            folder.mkdir()
            os.replace(path,folder/path.name)
            backup=self.directory/'.备份'/(identifier+'.tablens.json')
            if backup.is_file() and not backup.is_symlink():
                try: os.replace(backup,folder/('上次版本-'+path.name))
                except OSError: pass
            return {'scoreId':score['id'],'title':score['title'],'trash':str(folder)}

    @staticmethod
    def atomic(path,data):
        temporary=None
        try:
            with tempfile.NamedTemporaryFile(dir=path.parent,prefix='.saving-',suffix='.tmp',delete=False) as file:
                temporary=Path(file.name);file.write(data);file.flush();os.fsync(file.fileno())
            os.replace(temporary,path)
        finally:
            if temporary and temporary.exists():temporary.unlink()
