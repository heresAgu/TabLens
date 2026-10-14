import test from 'node:test';
import assert from 'node:assert/strict';
import {clone,insertMeasure,portable,importScore} from '../web/core.js';
import {collectReview,measureReviewState,reviewSnapshot} from '../web/review.js';

const score=()=>({schema:'tablens.score',version:1,id:'review-score',title:'校对测试',tempo:80,
  timeSignature:[1,4],capo:0,tuningMidi:[64,59,55,50,45,40],sources:[],measures:[{
    id:'measure-1',number:1,agentImported:true,issues:['请核对旋律'],events:[
      {id:'event-1',kind:'notes',duration:null,issues:['两次读取不一致'],notes:[
        {id:'note-1',string:2,fret:null,source:null}]}
    ]
  }]});

test('review lists exact unknown notes and timing, then requires explicit measure confirmation',()=>{
  const document=score();
  let review=collectReview(document);
  assert.equal(review.pendingCount,1);
  assert.ok(review.groups[0].items.some(item=>item.type==='fret'&&item.noteId==='note-1'));
  assert.ok(review.groups[0].items.some(item=>item.type==='duration'&&item.eventId==='event-1'));
  assert.equal(review.groups[0].canConfirm,false);
  document.measures[0].events[0].notes[0].fret=3;
  document.measures[0].events[0].duration='1/4';
  review=collectReview(document);
  assert.equal(review.groups[0].canConfirm,true);
  assert.ok(review.groups[0].items.some(item=>item.message.includes('两次读取不一致')));
  document.measures[0].reviewedSnapshot=reviewSnapshot(document.measures[0]);
  review=collectReview(document);
  assert.equal(review.pendingCount,0);
  assert.equal(review.reviewedCount,1);
  assert.equal(review.groups.length,1);
  assert.equal(review.groups[0].items.length,0);
  const reopened=importScore(portable(document));
  assert.equal(measureReviewState(reopened.measures[0]),'reviewed');
  reopened.measures[0].events[0].notes[0].fret=4;
  assert.equal(measureReviewState(reopened.measures[0]),'changed');
  assert.equal(collectReview(reopened).pendingCount,1);
});

test('reordering preserves confirmation; copying a measure requires a fresh review',()=>{
  const document=score();
  document.measures[0].events[0].duration='1/4';
  document.measures[0].events[0].notes[0].fret=3;
  document.measures[0].reviewedSnapshot=reviewSnapshot(document.measures[0]);
  const copy=insertMeasure(document,'measure-1','after',true);
  assert.equal(copy.reviewedSnapshot,undefined);
  assert.equal(measureReviewState(document.measures[0]),'reviewed');
  assert.equal(measureReviewState(copy),'pending');
  assert.equal(collectReview(clone(document)).pendingCount,1);
});
