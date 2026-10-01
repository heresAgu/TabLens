import test from 'node:test';
import assert from 'node:assert/strict';
import {beamGroups,rhythmInfo} from '../web/notation.js';
const notes=(duration,kind='notes')=>({duration,kind,notes:kind==='rest'?[]:[{string:1,fret:0}]});
test('beams respect quarter beats and keep chords as one event',()=>{
  const events=[notes('1/8'),notes('1/8'),notes('1/16'),notes('1/16'),notes('1/8'),notes('1/4')];
  events[0].notes.push({string:6,fret:3});
  assert.deepEqual(beamGroups(events,[4,4]),[[0,1],[2,3,4]]);
});
test('rest and unknown timing break beams without inventing onsets',()=>{
  assert.deepEqual(beamGroups([notes('1/16'),notes('1/16','rest'),notes('1/16'),notes(null),notes('1/16'),notes('1/16')],[4,4]),[]);
});
test('compound meter groups three eighth notes; unsupported durations remain explicit',()=>{
  assert.deepEqual(beamGroups(Array.from({length:6},()=>notes('1/8')),[6,8]),[[0,1,2],[3,4,5]]);
  assert.equal(rhythmInfo('3/16').flags,1);assert.equal(rhythmInfo('3/8').dotted,true);
  assert.equal(rhythmInfo('1').stem,false);assert.equal(rhythmInfo('1/2').head,'open');assert.equal(rhythmInfo('1/3'),null);
});
