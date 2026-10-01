import test from 'node:test';
import assert from 'node:assert/strict';
import {importScore, portable, eventRange, setEventDynamics, dynamicLevel,dynamicVolume,dynamicGain,validate,mergePosition} from '../web/core.js';
import {editNotes,noteSelection} from '../web/selection.js';
import {timeline, voicePlan} from '../web/playback.js';
const make = () => importScore({measures: [{number: 1, events: [
  {duration: '1/8', notes: [{string: 1, fret: 0}, {string: 5, fret: 2}]},
  {duration: '1/8', notes: [{string: 2, fret: 1}]}
]}, {number: 2, events: [{duration: '1/4', notes: [{string: 4, fret: 2}]}]}]});
test('continuous volume preserves presets, inheritance, zero and portable numeric values',()=>{
  const score=make(),event=score.measures[0].events[0];setEventDynamics(score,[event.id],40);event.notes[0].dynamics=0;
  for(const preset of ['soft','normal','strong'])assert.ok(Math.abs(dynamicGain(preset)-dynamicGain(dynamicVolume(preset)))<1e-12);
  const reopened=importScore(portable(score));assert.equal(reopened.measures[0].events[0].notes[0].dynamics,0);
  const voices=voicePlan(timeline(score,80));assert.equal(voices.find(v=>v.string===1).volume,0);assert.ok(voices.find(v=>v.string===5).volume>0);
  score.measures[0].events[1].notes[0].dynamics=26;mergePosition(score,event.id);assert.equal(event.notes.find(n=>n.string===2).dynamics,26);
  event.notes[0].dynamics=101;assert.throws(()=>validate(score),/力度/);
});
test('relative volume keeps differences and chord partners; invalid batch is atomic',()=>{
  const score=make(),event=score.measures[0].events[0],last=score.measures[1].events[0];event.notes[0].dynamics=20;last.notes[0].dynamics=90;
  const selection=noteSelection(score,[event.notes[0].id,last.notes[0].id]);editNotes(score,selection,{volumeDelta:10});
  assert.equal(event.notes[0].dynamics,30);assert.equal(last.notes[0].dynamics,100);assert.equal(event.notes[1].dynamics,undefined);
  const previous=structuredClone(score);assert.throws(()=>editNotes(score,selection,{dynamics:-1}),/力度/);assert.deepEqual(score,previous);
  editNotes(score,selection,{dynamics:0});assert.equal(event.notes[0].dynamics,0);assert.equal(last.notes[0].dynamics,0);
});
test('selection supports reversed spans across measures', () => {
  const score = make();
  assert.deepEqual(eventRange(score, 'm2-e1', 'm1-e1').map(e => e.id), ['m1-e1', 'm1-e2', 'm2-e1']);
  assert.deepEqual(eventRange(score, 'removed', 'm1-e1'), []);
});
test('single-note overrides survive save/reopen; whole-position edits explicitly unify notes', () => {
  const score = make(), event = score.measures[0].events[0];
  setEventDynamics(score, [event.id], 'soft');
  event.notes[0].dynamics = 'strong';
  assert.equal(dynamicLevel(event, event.notes[0]), 'strong');
  assert.equal(dynamicLevel(event, event.notes[1]), 'soft');
  const reopened = importScore(JSON.parse(JSON.stringify(portable(score))));
  assert.equal(dynamicLevel(reopened.measures[0].events[0], reopened.measures[0].events[0].notes[0]), 'strong');
  setEventDynamics(score, [event.id], 'normal');
  assert.ok(event.notes.every(note => note.dynamics === undefined));
  assert.throws(() => setEventDynamics(score, [event.id], 'unknown'), /力度/);
});
test('dynamics change voice volume without changing pitch, timing, chord membership or tails', () => {
  const score = make(), original = timeline(score, 80);
  const baseline = voicePlan(original, {sustain: 'natural'});
  setEventDynamics(score, ['m1-e1'], 'soft');
  score.measures[0].events[0].notes[0].dynamics = 'strong';
  const data = timeline(score, 80), changed = voicePlan(data, {sustain: 'natural'});
  assert.deepEqual(data.events.map(e => [e.midi, e.start, e.duration]), original.events.map(e => [e.midi, e.start, e.duration]));
  for (const voice of changed) {
    const old = baseline.find(n => n.midi === voice.midi && n.start === voice.start);
    assert.equal(voice.end, old.end);
    const factor = voice.start === 0 ? voice.string === 1 ? 1.35 : 0.55 : 1;
    assert.ok(Math.abs(voice.volume / old.volume - factor) < 1e-10);
  }
});
