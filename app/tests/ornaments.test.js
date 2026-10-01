import test from 'node:test';
import assert from 'node:assert/strict';
import {newScore, insertMeasure, validate, clone} from '../web/core.js';
import {setGraceBefore,setBend} from '../web/ornaments.js';
import {timeline,voicePlan} from '../web/playback.js';

function score(){
  const value=newScore('倚音与推弦');
  value.measures[0].events=[
    {id:'a',kind:'notes',duration:'1/4',notes:[{id:'a1',string:3,fret:9},{id:'a2',string:5,fret:3}]},
    {id:'b',kind:'notes',duration:'1/4',notes:[{id:'b1',string:3,fret:11}]}
  ];
  return value;
}
test('short grace sounds before the beat without moving the main chord',()=>{
  const value=score();
  setGraceBefore(value,'a','a1',{string:3,fret:7,leadBeats:0.125,articulation:'hammer'});
  validate(value);
  const data=timeline(value,80);
  assert.equal(data.events[0].start,0);
  assert.equal(data.events[1].start,0.75);
  assert.equal(data.events[0].graces[0].lead,0.09375);
  const plan=voicePlan(data,{sustain:'natural'},()=>3);
  const grace=plan.find(voice=>voice.isGrace);
  assert.equal(grace.start,-0.09375);
  assert.equal(grace.transitions[0].type,'hammer');
  assert.equal(grace.transitions[0].at,0.09375);
  assert.equal(plan.find(voice=>voice.noteId==='a2').start,0);
});
test('grace slide stays quiet before the beat and reaches the main note continuously',()=>{
  const value=score();
  setGraceBefore(value,'a','a1',{string:3,fret:7,leadBeats:0.125,articulation:'slide'});
  const data=timeline(value,80);
  const plan=voicePlan(data,{sustain:'natural'},()=>3);
  const grace=plan.find(voice=>voice.isGrace);
  const main=plan.find(voice=>voice.noteId==='a2');
  assert.ok(grace.volume<main.volume*0.25);
  assert.equal(grace.transitions.length,1);
  assert.equal(grace.transitions[0].type,'slide');
  assert.equal(grace.transitions[0].ratio,0.75);
  assert.equal(grace.transitions[0].graceSlide,true);
  assert.equal(grace.transitions[0].at,0.09375);
  assert.equal(plan.filter(voice=>voice.string===3 && voice.start<0).length,1);
  assert.ok(!plan.some(voice=>voice.noteId==='a1'),'主音应接在倚音声部中，而非另起一次拨弦');
});
test('cross-string picked grace remains separate, and loop clips prior same-string tails',()=>{
  const value=score();
  setGraceBefore(value,'a','a1',{string:2,fret:3,leadBeats:0.125,articulation:'pick'});
  const data=timeline(value,80);
  const plan=voicePlan(data,{sustain:'natural',loop:true},()=>3);
  assert.equal(plan.find(voice=>voice.isGrace).string,2);
  assert.equal(plan.find(voice=>voice.noteId==='a1').start,0);
  assert.ok(plan.every(voice=>voice.end<=data.total));
});
test('bend changes pitch within one note and returns without adding score time',()=>{
  const value=score();
  setBend(value,'a','a1',{semitones:2,reachRatio:0.35,release:true});
  validate(value);
  const data=timeline(value,80),plan=voicePlan(data,{sustain:'natural'},()=>3);
  const voice=plan.find(item=>item.noteId==='a1');
  assert.equal(data.total,1.5);
  assert.deepEqual(voice.transitions.map(item=>item.type),['bend','bend']);
  assert.deepEqual(voice.transitions.map(item=>item.midi),[66,64]);
  assert.equal(voice.transitions[0].begin,0);
  assert.ok(Math.abs(voice.transitions[0].at-0.2625)<1e-9);
  assert.ok(Math.abs(voice.transitions[1].at-0.675)<1e-9);
});
test('invalid grace, open-string bend and conflicting predecessor are rejected',()=>{
  const value=score();
  assert.throws(()=>setGraceBefore(value,'a','a1',{string:3,fret:11,leadBeats:0.125,articulation:'hammer'}),/较低/);
  value.measures[0].events[0].notes[0].fret=0;
  assert.throws(()=>setBend(value,'a','a1',{semitones:1,reachRatio:0.35,release:false}),/非空弦/);
  value.measures[0].events[0].notes[0].fret=9;
  setGraceBefore(value,'a','a1',{string:3,fret:7,leadBeats:0.125,articulation:'pick'});
  value.measures[0].events[0].notes[0].technique={type:'hammer',fromNoteId:'other'};
  assert.throws(()=>validate(value),/前一颗同弦音/);
});
test('portable copies preserve ornaments with distinct grace IDs',()=>{
  const value=score();
  setGraceBefore(value,'a','a1',{string:3,fret:7,leadBeats:0.125,articulation:'pick'});
  setBend(value,'a','a1',{semitones:1,reachRatio:0.2,release:false});
  const original=clone(value);
  const copied=insertMeasure(value,value.measures[0].id,'after',true);
  validate(value);
  assert.notEqual(copied.events[0].notes[0].graceBefore.id,original.measures[0].events[0].notes[0].graceBefore.id);
  assert.equal(copied.events[0].notes[0].bend.semitones,1);
});
