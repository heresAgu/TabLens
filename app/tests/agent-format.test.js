import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {importScore, portable, timingWarning} from '../web/core.js';
import {timeline, strumOffsets, suggestedStrumSpread, suggestedStrumDynamic} from '../web/playback.js';
import {AGENT_FORMAT, AGENT_SOURCE_FORMAT} from '../web/agent-format.js';

const example=()=>{
  const guide=readFileSync(new URL('../../AGENT_IMPORT_TEMPLATE.md', import.meta.url),'utf8');
  const match=guide.match(/~~~json\s*([\s\S]*?)~~~/);
  assert.ok(match,'模板应含一份完整 JSON 示例');
  return JSON.parse(match[1]);
};

test('the actual Agent template example imports down/up strums, rest and valid 4/4 rhythm',()=>{
  const raw=example();
  assert.equal(raw.format,AGENT_FORMAT);
  const score=importScore(raw), events=score.measures[0].events;
  assert.equal(score.title,'示例曲名');
  assert.deepEqual(events.map(event=>event.duration),['1/8','1/8','1/4','1/2']);
  assert.deepEqual(events[0].notes.map(note=>[note.string,note.fret]),[[1,0],[2,0],[3,0],[6,0]]);
  assert.deepEqual(events[0].strum,{direction:'down',spreadBeats:0.08,speedMode:'auto',autoDynamics:true});
  assert.deepEqual(events[1].strum,{direction:'up',spreadBeats:0.08,speedMode:'auto',autoDynamics:true});
  assert.deepEqual(events.slice(0,2).map(event=>event.chordName),['Em','Em']);
  assert.equal(events[2].kind,'rest');
  assert.equal(timingWarning(score,score.measures[0]),'');
  const played=timeline(score,80);
  assert.equal(played.total,3);
  assert.deepEqual(played.events[0].midi,[64,59,55,40]);
  assert.deepEqual([...strumOffsets(played.events[0],80).keys()],[6,3,2,1]);
  assert.deepEqual([...strumOffsets(played.events[1],80).keys()],[1,2]);
  assert.deepEqual(played.events[2].midi,[]);
  assert.deepEqual(importScore(portable(score)).measures,score.measures);
});

test('Agent v2 keeps one embedded page and a separate source crop for each measure',()=>{
  const raw=example();
  raw.format=AGENT_SOURCE_FORMAT;
  raw.sources=[{id:'page-1',name:'带歌词的谱.png',width:100,height:80,
    dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='}];
  raw.measures[0].source={pageId:'page-1',box:[0,0,48,65]};
  raw.measures.push({...structuredClone(raw.measures[0]),number:2,source:{pageId:'page-1',box:[48,0,100,65]}});
  const score=importScore(raw);
  assert.equal(score.sources.length,1);
  assert.equal(score.sources[0].dataUrl,raw.sources[0].dataUrl);
  assert.deepEqual(score.measures.map(measure=>measure.source.box),[[0,0,48,65],[48,0,100,65]]);
  assert.equal(score.measures[0].events[0].notes[0].source,null);
  assert.deepEqual(importScore(portable(score)).measures.map(measure=>measure.source.box),
    [[0,0,48,65],[48,0,100,65]]);
});

test('Agent v2 rejects missing images and invalid per-measure regions',()=>{
  const make=()=>{
    const raw=example();raw.format=AGENT_SOURCE_FORMAT;
    raw.sources=[{id:'page-1',name:'source.png',width:100,height:80,
      dataUrl:'data:image/png;base64,AAAA'}];
    raw.measures[0].source={pageId:'page-1',box:[0,0,100,80]};
    return raw;
  };
  const invalid=(edit,pattern)=>{const raw=make();edit(raw);assert.throws(()=>importScore(raw),pattern);};
  invalid(raw=>{delete raw.sources;},/sources/);
  invalid(raw=>{raw.sources[0].dataUrl='file:///song.png';},/dataUrl/);
  invalid(raw=>{raw.measures[0].source.box=[0,0,101,80];},/裁切范围/);
  invalid(raw=>{raw.measures[0].source.pageId='missing';},/原图不存在/);
  invalid(raw=>{delete raw.measures[0].source;},/source/);
  invalid(raw=>{raw.measures[0].source.lyrics='text';},/lyrics/);
});

test('automatic Agent strums follow edited rhythm while an explicit spread remains fixed',()=>{
  const raw=example();
  raw.measures[0].events[0].duration='1/4';
  raw.measures[0].events[1].duration='1/4';
  const score=importScore(raw), [first, second]=score.measures[0].events;
  assert.equal(suggestedStrumSpread(score,first.id),0.08); // adjacent opposite strokes
  delete second.strum;
  assert.equal(suggestedStrumSpread(score,first.id),0.16); // isolated quarter-note stroke
  assert.equal(timeline(score,80).events[0].strum.spreadBeats,0.16);
  assert.equal(first.strum.spreadBeats,0.08); // playback does not rewrite the saved score
  first.duration='1/8';
  assert.equal(suggestedStrumSpread(score,first.id),0.08);
  first.duration='1/4';
  const slow=timeline(score,40);
  assert.ok(Math.abs(strumOffsets(slow.events[0],40).get(1)-0.12)<1e-9); // auto cap
  first.strum={direction:'down',spreadBeats:0.28};
  assert.equal(timeline(score,40).events[0].strum.spreadBeats,0.28);
  assert.equal(importScore(portable(score)).measures[0].events[0].strum.speedMode,undefined);
  raw.measures[0].events[0].strum.spreadBeats=0.16;
  assert.deepEqual(importScore(raw).measures[0].events[0].strum,{direction:'down',spreadBeats:0.16,autoDynamics:true});
});

test('Agent technique targets connect across events and keep their playback links',()=>{
  const raw=example();
  raw.measures[0].events=[
    {duration:'1/4',notes:[{string:2,fret:3}]},
    {duration:'1/4',notes:[{string:2,fret:5,technique:{type:'hammer'}}]},
    {duration:'1/4',notes:[{string:2,fret:3,technique:{type:'pull'}}]},
    {duration:'1/4',notes:[{string:2,fret:7,technique:{type:'slide',ratio:0.4}}]}
  ];
  const score=importScore(raw), events=score.measures[0].events;
  assert.deepEqual(events.slice(1).map((event,index)=>event.notes[0].technique),[
    {type:'hammer',fromNoteId:events[0].notes[0].id},
    {type:'pull',fromNoteId:events[1].notes[0].id},
    {type:'slide',fromNoteId:events[2].notes[0].id,ratio:0.4}
  ]);
  assert.equal(timeline(score,80).events[3].techniques[0].ratio,0.4);
  assert.deepEqual(importScore(portable(score)).measures[0].events[3].notes[0].technique,
    events[3].notes[0].technique);
});

test('Agent fast partial strums default light and explicit dynamics take precedence',()=>{
  const raw=example();
  raw.measures[0].events=[
    {duration:'1/8',notes:[{string:4,fret:2},{string:3,fret:0},{string:2,fret:1},{string:1,fret:0}],
      strum:{direction:'down'}},
    {duration:'1/8',notes:[{string:2,fret:1,dynamics:'strong'},{string:1,fret:0}],strum:{direction:'up'}},
    {duration:'1/4',notes:[{string:4,fret:2},{string:3,fret:0}],strum:{direction:'up'}},
    {duration:'1/2',notes:[{string:2,fret:1}]}
  ];
  const score=importScore(raw), events=score.measures[0].events;
  const played=timeline(score,80);
  assert.deepEqual(played.events[0].strings,[1,2,3,4]);
  assert.deepEqual(played.events[0].dynamics,['soft','soft','soft','soft']);
  assert.deepEqual(played.events[1].dynamics,['soft','strong']);
  assert.deepEqual(played.events[2].dynamics,['normal','normal']);
  assert.equal(suggestedStrumDynamic(score,events[2]),'normal');
  events[2].strum.spreadBeats=0.08;
  delete events[2].strum.speedMode;
  assert.deepEqual(timeline(score,80).events[2].dynamics,['soft','soft']);
  events[2].dynamics='strong';
  assert.deepEqual(timeline(score,80).events[2].dynamics,['strong','strong']);
  assert.deepEqual(importScore(portable(score)).measures[0].events[2].strum,events[2].strum);
});

test('Agent invalid technique links and dynamics fail with an actionable location',()=>{
  const raw=example();
  const first=raw.measures[0].events[0], second=raw.measures[0].events[1];
  first.notes.find(note=>note.string===2).technique={type:'hammer'};
  assert.throws(()=>importScore(raw),/第1小节第1个位置的第2弦技巧.*前面没有/);
  delete first.notes.find(note=>note.string===2).technique;
  second.notes.find(note=>note.string===2).technique={type:'hammer'};
  assert.throws(()=>importScore(raw),/第1小节第2个位置的第2弦技巧.*更高/);
  second.notes.find(note=>note.string===2).technique={type:'slide',ratio:1};
  assert.throws(()=>importScore(raw),/slide ratio/);
  delete second.notes.find(note=>note.string===2).technique;
  second.dynamics='very-soft';
  assert.throws(()=>importScore(raw),/第1小节第2个位置的 dynamics/);
});

test('uncertain Agent content remains editable and visible, rather than becoming open strings',()=>{
  const raw=example();
  raw.metadata.tempo_bpm=null;
  raw.metadata.time_signature=null;
  raw.measures[0].events[0].duration=null;
  raw.measures[0].events[0].notes[0].fret=null;
  raw.measures[0].events[0].uncertain_items=['第1弦数字模糊'];
  const score=importScore(raw);
  assert.equal(score.measures[0].events[0].duration,null);
  assert.equal(score.measures[0].events[0].notes.find(note=>note.string===6).fret,null);
  assert.match(score.measures[0].events[0].issues.join('；'),/品位待确认/);
  assert.match(score.issues.join('；'),/拍号待确认/);
  assert.throws(()=>timeline(score,80),/节奏/);
});

test('plain stacked notes stay simultaneous unless Agent explicitly marks a strum',()=>{
  const raw=example();
  delete raw.measures[0].events[0].strum;
  const score=importScore(raw);
  assert.equal(score.measures[0].events[0].strum,undefined);
  assert.equal(strumOffsets(timeline(score,80).events[0],80).size,0);
});

test('Agent pickup bars stay incomplete only when explicitly marked',()=>{
  const raw=example();
  raw.measures[0].events=raw.measures[0].events.slice(0,2);
  const score=importScore(raw);
  assert.match(timingWarning(score,score.measures[0]),/时值合计/);
  raw.measures[0].allow_incomplete=true;
  const pickup=importScore(raw);
  assert.equal(pickup.measures[0].allowIncomplete,true);
  assert.equal(timingWarning(pickup,pickup.measures[0]),'');
});

test('Agent format rejects silent field loss and pinpoints structural mistakes',()=>{
  const invalid=(edit,pattern)=>{const raw=example();edit(raw);assert.throws(()=>importScore(raw),pattern);};
  invalid(raw=>{raw.format='tablens.agent.v3';},/不支持的 Agent 文件格式/);
  invalid(raw=>{raw.measures[0].events[0].beat=1;},/第1小节第1个位置.*beat/);
  invalid(raw=>{raw.measures[0].events[0].notes[1].string=6;},/第1小节第1个位置.*第6弦重复/);
  invalid(raw=>{raw.measures[0].events[1].duration='1/3';},/第1小节第2个位置.*duration/);
  invalid(raw=>{raw.measures[0].events[1].notes[0].fret='2';},/第1小节第2个位置.*fret/);
  invalid(raw=>{raw.measures[0].events[2].notes=[{string:2,fret:1}];},/第1小节第3个位置.*kind 与 notes/);
  invalid(raw=>{raw.measures[0].events[0].strum.direction='left';},/strum.direction/);
  invalid(raw=>{raw.measures[0].events[0].strum.spreadBeats=0.01;},/strum.spreadBeats/);
  invalid(raw=>{raw.measures[0].events[0].strum.extra=true;},/strum.*extra/);
  invalid(raw=>{raw.measures[0].events[2].strum={direction:'down'};},/第1小节第3个位置.*扫弦/);
  invalid(raw=>{raw.measures[0].events[3].strum={direction:'up'};},/第1小节第4个位置.*扫弦/);
  invalid(raw=>{raw.metadata.capo=null;},/capo.*确认/);
  invalid(raw=>{raw.measures.push({...structuredClone(raw.measures[0]),number:3});},/编号应为 2/);
});


test('Agent format supports capo-six fingerstyle chords and dense two-digit-fret passages',()=>{
  const lullaby=example();
  lullaby.metadata.title='变调夹与同时弹测试';
  lullaby.metadata.capo=6;
  lullaby.measures[0].events[0].notes=[{string:1,fret:0},{string:6,fret:0}];
  const first=importScore(lullaby);
  assert.deepEqual(timeline(first,80).events[0].midi,[70,46]);

  const duvet=example();
  duvet.metadata.title='高把位密集节奏测试';
  duvet.metadata.tempo_bpm=96;
  duvet.measures[0].events=Array.from({length:16},(_,index)=>({
    duration:'1/16',notes:[{string:index%2?2:1,fret:[10,12,14,19][index%4]}]
  }));
  const dense=importScore(duvet);
  assert.equal(dense.measures[0].events.length,16);
  assert.equal(timingWarning(dense,dense.measures[0]),'');
  assert.equal(timeline(dense,96).total,2.5);
});


test('Agent chord charts preserve explicit voicings and names; names alone stay unplayable',()=>{
  const chart=example();
  chart.measures[0].events[0].chordName='C';
  chart.measures[0].events[0].notes=[
    {string:5,fret:3},{string:4,fret:2},{string:3,fret:0},
    {string:2,fret:1},{string:1,fret:0}
  ];
  const score=importScore(chart),first=score.measures[0].events[0];
  assert.equal(first.chordName,'C');
  assert.equal(first.chordPending,undefined);
  assert.deepEqual(first.notes.map(note=>[note.string,note.fret]),[[1,0],[2,1],[3,0],[4,2],[5,3]]);
  assert.equal(timeline(score,80).events[0].strum.direction,'down');
  assert.equal(importScore(portable(score)).measures[0].events[0].chordName,'C');

  const namesOnly=example();
  namesOnly.measures[0].events[0]={kind:'unknown',duration:'1/8',notes:[],chordName:'C',strum:{direction:'down'}};
  const pending=importScore(namesOnly).measures[0].events[0];
  assert.equal(pending.chordName,'C');
  assert.equal(pending.chordPending,true);
  assert.deepEqual(pending.strum,{direction:'down',spreadBeats:0.08,speedMode:'auto',autoDynamics:true});
  assert.match(pending.issues.join('；'),/按弦位置待确认/);
  assert.equal(importScore(portable(importScore(namesOnly))).measures[0].events[0].chordName,'C');
  assert.throws(()=>timeline(importScore(namesOnly),80),/音符|位置/);
});

test('Agent rejects invalid chord labels without silently inventing voicings',()=>{
  const invalid=(edit,pattern)=>{const raw=example();edit(raw);assert.throws(()=>importScore(raw),pattern);};
  invalid(raw=>{raw.measures[0].events[0].chordName=' ';},/chordName/);
  invalid(raw=>{raw.measures[0].events[0].chordName='X'.repeat(25);},/chordName/);
  invalid(raw=>{raw.measures[0].events[2].chordName='C';},/chordName/);
  invalid(raw=>{raw.measures[0].events[0]={kind:'unknown',duration:'1/8',notes:[],strum:{direction:'down'}};},/扫弦/);
});
