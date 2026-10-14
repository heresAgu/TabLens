import test from 'node:test';
import assert from 'node:assert/strict';
import {completeCoverage} from '../web/coverage.js';
import {collectReview} from '../web/review.js';
import {appendRecognition,importScore,portable} from '../web/core.js';

const prepared={id:'prepared-1',source:{id:'page-1',name:'demo.png',width:300,height:100,url:'/api/recognition/images/prepared-1'},
  segments:[
    {id:'segment-1',number:1,box:[0,10,100,70],readable:true,issues:[]},
    {id:'segment-2',number:2,box:[100,10,200,70],readable:true,issues:[]},
    {id:'segment-3',number:3,box:[200,10,300,70],readable:false,issues:['没有下方符干']}
  ]};
const recognized=(number,id=`event-${number}`)=>({id:`measure-${number}`,number,
  source:{pageId:'page-1',box:prepared.segments[number-1].box},
  recognition:{preparedId:'prepared-1',segmentId:`segment-${number}`},issues:[],events:[
    {id,kind:'notes',duration:null,issues:[],notes:[{id:`note-${number}`,string:1,fret:number,source:null}]}
  ]});

test('every located segment survives an import, including failed and unsupported bars',()=>{
  const first=completeCoverage(prepared);
  assert.equal(first.measures.length,3);
  assert.ok(first.measures.every(measure=>measure.source?.box));
  const result={...first,id:'api-result',measures:[recognized(1)]};
  const candidate=completeCoverage(prepared,result,first,[
    {id:'segment-1',state:'complete'},{id:'segment-2',state:'failed',error:'模型读取失败'}]);
  assert.deepEqual(candidate.measures.map(measure=>measure.events.length),[1,0,0]);
  assert.equal(candidate.measures[0].recognition.segmentId,'segment-1');
  assert.match(candidate.measures[1].recognition.reason,/模型读取失败/);
  assert.match(candidate.measures[2].recognition.reason,/没有下方符干/);
  const reopened=importScore(portable(candidate));
  assert.equal(reopened.measures.length,3);
  assert.equal(reopened.measures[1].source.pageId,'page-1');
  const review=collectReview(reopened);
  assert.equal(review.pendingCount,3);
  assert.equal(review.groups[1].canConfirm,false);
  assert.ok(review.groups[1].items.some(item=>item.type==='empty'&&item.message.includes('未导入')));
});

test('retrying one failed segment keeps earlier recognized bars and their order',()=>{
  const first=completeCoverage(prepared);
  const partial=completeCoverage(prepared,{...first,title:'识别出的歌名',tempo:96,measures:[recognized(1)]},first,[
    {id:'segment-1',state:'complete'},{id:'segment-2',state:'failed'}]);
  const retry=completeCoverage(prepared,{...partial,id:'new-job',title:'页头重试失败',tempo:null,measures:[recognized(2)]},partial,[{id:'segment-2',state:'complete'}]);
  assert.deepEqual(retry.measures.map(measure=>measure.events.length),[1,1,0]);
  assert.equal(retry.measures[0].events[0].id,'event-1');
  assert.equal(retry.measures[1].events[0].id,'event-2');
  assert.equal(retry.title,'识别出的歌名');
  assert.equal(retry.tempo,96);
});

test('inserting a manually boxed bar renumbers recognized bars without losing their notes',()=>{
  const initial=completeCoverage(prepared,{...completeCoverage(prepared),measures:[recognized(1)]});
  const expanded={...prepared,segments:[
    {...prepared.segments[0],number:1},
    {id:'manual-crop',number:2,box:[95,0,115,80],readable:false,issues:['需人工补录']},
    {...prepared.segments[1],number:3},
    {...prepared.segments[2],number:4}
  ]};
  const candidate=completeCoverage(expanded,null,initial);
  assert.deepEqual(candidate.measures.map(m=>m.number),[1,2,3,4]);
  assert.equal(candidate.measures[0].events[0].id,'event-1');
  assert.equal(candidate.measures[1].source.box[0],95);
  assert.equal(candidate.measures[1].recognition.segmentId,'manual-crop');
});

test('appending a page keeps its recognized and missing bars in page order',()=>{
  const first=completeCoverage(prepared,{...completeCoverage(prepared),measures:[recognized(1)]});
  const page2={...prepared,id:'prepared-2',source:{id:'page-2',name:'second.png',width:300,height:100},
    segments:prepared.segments.slice(0,2).map(segment=>({...segment,id:`page2-${segment.id}`}))};
  const second=completeCoverage(page2);
  const combined=appendRecognition(first,second);
  assert.equal(combined.measures.length,5);
  assert.deepEqual(combined.measures.map(measure=>measure.number),[1,2,3,4,5]);
  assert.deepEqual(combined.measures.slice(3).map(measure=>measure.source.pageId),['page-2','page-2']);
  assert.equal(combined.measures[3].originalNumber,1);
});
