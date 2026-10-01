"""Isolated Baidu numbers OCR trial. Never changes the app or its API settings.

Default prepares inputs only. --live asks for credentials without terminal echo.
Eight OCR requests maximum, no retries, credentials/tokens are never saved.
"""
import argparse
import base64
import datetime
import getpass
import json
import math
import sys
import time
from pathlib import Path

import numpy as np
import requests
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'app'))
from recognition import geometry
from evaluate_note_positions import evaluate

ENDPOINT = 'https://aip.baidubce.com/rest/2.0/ocr/v1/numbers'


def write(path, value):
    path.write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf8')


def prepare(directory):
    directory.mkdir(parents=True,exist_ok=True)
    cases=[]
    for filename,numbers in [('lullaby.jpg',[2,3]),('duvet.png',[1,2])]:
        with Image.open(ROOT/filename) as original:
            image=original.convert('RGB')
        for segment in geometry(image):
            if segment['number'] not in numbers: continue
            number=segment['number'];gap=(segment['stringY'][-1]-segment['stringY'][0])/5
            name=f'{Path(filename).stem}-m{number}'
            x0,y0,x1,y1=segment['box']
            # Only the six-line music band: exclude headings, chord diagrams and measure numbers.
            raw_box=[x0,max(0,math.floor(segment['stringY'][0]-gap*.6)),x1,
                     min(image.height,math.ceil(segment['stringY'][-1]+gap*.6))]
            raw=image.crop(raw_box).resize(((x1-x0)*2,(raw_box[3]-raw_box[1])*2),Image.Resampling.LANCZOS)
            raw_path=directory/f'{name}-raw.png';raw.save(raw_path)
            xs=segment['columns'];cells=[]
            # No labels or numeric column headers: OCR would read those as frets.
            grid=Image.new('RGB',(180*len(xs),120*6),'white')
            for s,y in enumerate(segment['stringY'],1):
                for c,x in enumerate(xs,1):
                    left=max(x0,math.floor((xs[c-2]+x)/2 if c>1 else x-(xs[1]-x)/2))
                    right=min(x1,math.ceil((x+xs[c])/2 if c<len(xs) else x+(x-xs[c-2])/2))
                    top=max(0,math.floor(y-gap*.49));bottom=min(image.height,math.ceil(y+gap*.49))
                    patch=np.asarray(image.crop((left,top,right,bottom)).convert('L'))
                    # Removes gray staff/watermark; retain the original image for audit.
                    clean=Image.fromarray(np.where(patch<120,0,255).astype('uint8')).convert('RGB')
                    clean=clean.resize((clean.width*3,clean.height*3),Image.Resampling.NEAREST)
                    if clean.width>160 or clean.height>100:
                        clean.thumbnail((160,100),Image.Resampling.LANCZOS)
                    px=(c-1)*180+(180-clean.width)//2;py=(s-1)*120+(120-clean.height)//2
                    grid.paste(clean,(px,py))
                    cells.append({'string':s,'column':c,'source_box':[left,top,right,bottom],
                                  'tile_box':[(c-1)*180,(s-1)*120,c*180,s*120]})
            grid_path=directory/f'{name}-grid.png';grid.save(grid_path)
            common={'source':filename,'measure':number,'columns':xs,'string_y':segment['stringY']}
            cases.append({**common,'id':name+'-raw','image':raw_path.name,'mode':'raw','scale':2,'crop_box':raw_box})
            cases.append({**common,'id':name+'-grid','image':grid_path.name,'mode':'grid','cells':cells})
    write(directory/'manifest.json',{'maximum_ocr_calls':8,'automatic_retries':0,'reference_used_for_inputs':False,
                                     'endpoint':ENDPOINT,'cases':cases})
    return cases


def map_result(raw,case):
    events=[{'column':c,'duration':None,'notes':[]} for c in range(1,len(case['columns'])+1)]
    assigned={};uncertain=[]
    gap=(case['string_y'][-1]-case['string_y'][0])/5
    for item in raw.get('words_result',[]):
        text=str(item.get('words','')).strip();loc=item.get('location')
        if not loc or not text.isascii() or not text.isdigit():
            uncertain.append({'words':text,'reason':'missing location or non-digit result'});continue
        left,top=loc['left'],loc['top'];right=left+loc['width'];bottom=top+loc['height']
        if case['mode']=='grid':
            c=math.floor(((left+right)/2)/180)+1;s=math.floor(((top+bottom)/2)/120)+1
            if not 1<=c<=len(events) or not 1<=s<=6 or left<(c-1)*180 or right>c*180 or top<(s-1)*120 or bottom>s*120:
                uncertain.append({'words':text,'reason':'OCR box spans multiple cells'});continue
        else:
            x=(left+right)/2/case['scale']+case['crop_box'][0]
            y=(top+bottom)/2/case['scale']+case['crop_box'][1]
            s=min(range(1,7),key=lambda n:abs(case['string_y'][n-1]-y))
            c=min(range(1,len(events)+1),key=lambda n:abs(case['columns'][n-1]-x))
            span=loc['width']/case['scale']
            if abs(case['string_y'][s-1]-y)>gap*.45 or span>gap*2.5 or abs(case['columns'][c-1]-x)>gap*.9:
                uncertain.append({'words':text,'reason':'ambiguous string/column or combined numbers'});continue
        assigned.setdefault((s,c),[]).append((left,text))
    for (s,c),parts in assigned.items():
        # Joining is restricted to the same known cell; never spread a string
        # of digits across positions by guessing, and never turn no result into 0.
        text=''.join(text for _,text in sorted(parts))
        if len(text)>2 or int(text)>36:
            uncertain.append({'words':text,'reason':'outside fret range or duplicate detections'});continue
        events[c-1]['notes'].append({'string':s,'fret':int(text)})
    for event in events:event['notes'].sort(key=lambda n:n['string'])
    return {'measures':[{'number':case['measure'],'events':events}],'uncertain_items':uncertain}


def prepare_glyphs(directory):
    directory.mkdir(parents=True,exist_ok=True)
    with Image.open(ROOT/'duvet.png') as original: image=original.convert('RGB')
    segments=geometry(image);cases=[]
    # Small manually selected diagnostic set; expected frets are evaluation only.
    for number,string,column,expected in [(1,1,1,5),(2,1,1,10),(3,1,1,12),(3,6,1,None),(1,1,4,5)]:
        segment=next(s for s in segments if s['number']==number)
        x=segment['columns'][column-1];y=segment['stringY'][string-1]
        gap=(segment['stringY'][-1]-segment['stringY'][0])/5
        box=[math.floor(x-gap),math.floor(y-gap*.6),math.ceil(x+gap*1.4),math.ceil(y+gap*.6)]
        patch=image.crop(box).resize(((box[2]-box[0])*4,(box[3]-box[1])*4),Image.Resampling.LANCZOS)
        name=f'duvet-m{number}-s{string}-c{column}-glyph';patch.save(directory/(name+'.png'))
        cases.append({'id':name,'image':name+'.png','mode':'raw','source':'duvet.png','measure':number,
                      'columns':[x],'string_y':segment['stringY'],'scale':4,'crop_box':box,
                      'evaluation_only':{'string':string,'fret':expected}})
    write(directory/'manifest.json',{'maximum_ocr_calls':len(cases),'reference_used_for_inputs':False,'cases':cases})
    return cases


def reference(case):
    # Evaluation only, loaded AFTER the OCR response has been obtained.
    if 'evaluation_only' in case:
        value=case['evaluation_only']
        notes=[] if value['fret'] is None else [value]
        return {'measures':[{'number':case['measure'],'events':[{'notes':notes}]}]},'manual glyph spot check'
    if case['source']=='lullaby.jpg':
        value=json.loads((ROOT/'experiments/reference_lullaby_2_3.json').read_text(encoding='utf8'))
        label='manual reference'
    else:
        value=json.loads((ROOT/'experiments/runs/20260928-202008-beccf0/note_positions_resolved.json').read_text(encoding='utf8'))
        label='previously reviewed experiment result; not new independent ground truth'
    return {'measures':[m for m in value['measures'] if m['number']==case['measure']]},label


def live(directory,cases):
    key=getpass.getpass('Baidu API Key: ')
    secret=getpass.getpass('Baidu Secret Key: ')
    session=requests.Session()
    try:
        response=session.post('https://aip.baidubce.com/oauth/2.0/token',data={
            'grant_type':'client_credentials','client_id':key,'client_secret':secret},timeout=(15,60),allow_redirects=False)
        value=response.json()
    except (requests.RequestException,ValueError):
        print('Authentication network/JSON failure. No OCR calls sent.',flush=True);return
    token=value.get('access_token')
    if not response.ok or not token:
        print('Authentication failed. Check OCR application credentials; no OCR calls sent.',flush=True);return
    results=[]
    for index,case in enumerate(cases[:8]):
        if index:
            time.sleep(1.25)  # Respect low-QPS trial accounts; never retry errors automatically.
        print('OCR '+case['id']+' ...',flush=True)
        started=time.monotonic()
        try:
            response=session.post(ENDPOINT,params={'access_token':token},data={
                'image':base64.b64encode((directory/case['image']).read_bytes()).decode(),
                'detect_direction':'false','probability':'true'},timeout=(15,90),allow_redirects=False)
            raw=response.json()
        except (requests.RequestException,ValueError):
            results.append({'id':case['id'],'status':'network/JSON failure'});break
        # Explicitly sanitize before recording provider data. OAuth responses are never saved.
        safe=json.dumps(raw,ensure_ascii=False)
        for credential in (key,secret,token):safe=safe.replace(credential,'[REDACTED]')
        raw=json.loads(safe);write(directory/(case['id']+'-response.json'),raw)
        if not response.ok or 'error_code' in raw:
            results.append({'id':case['id'],'status':'api_error','http_status':response.status_code,
                            'error_code':raw.get('error_code'),'error_msg':raw.get('error_msg')})
            print(json.dumps(results[-1],ensure_ascii=True),flush=True);break
        candidate=map_result(raw,case);write(directory/(case['id']+'-candidate.json'),candidate)
        expected,label=reference(case);metrics=evaluate(candidate,expected)
        result={'id':case['id'],'status':'complete','seconds':round(time.monotonic()-started,2),
                'reference':label,'ocr_regions':len(raw.get('words_result',[])),
                'ambiguous_regions':len(candidate['uncertain_items']),**metrics}
        results.append(result);write(directory/'results.json',results)
        print(json.dumps({k:result[k] for k in ['id','notes_matching_string_fret_column','expected_notes',
              'correct_event_groups','expected_events','correct_chords','expected_chords','ambiguous_regions']},ensure_ascii=True),flush=True)
    write(directory/'results.json',results)
    print('Saved experiment: '+str(directory),flush=True)


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--live',action='store_true');parser.add_argument('--directory',type=Path)
    parser.add_argument('--source',choices=['lullaby.jpg','duvet.png'])
    parser.add_argument('--glyphs',action='store_true')
    parser.add_argument('--case')
    args=parser.parse_args()
    directory=args.directory or ROOT/'experiments'/'baidu_trial'/datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
    cases=prepare_glyphs(directory) if args.glyphs else prepare(directory)
    if args.source: cases=[case for case in cases if case['source']==args.source]
    if args.case: cases=[case for case in cases if case['id']==args.case]
    print(f'Prepared {len(cases)} cases; app untouched.',flush=True)
    if args.live:live(directory,cases)


if __name__=='__main__':main()
