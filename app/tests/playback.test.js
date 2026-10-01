import test from 'node:test';
import assert from 'node:assert/strict';
import {importScore,renumberMeasures} from '../web/core.js';
import {timeline, pitches, voicePlan} from '../web/playback.js';

const score = () => importScore({metadata: {tempo_bpm: 80, capo: 6}, measures: [{number: 2, events: [
  {duration: '1/8', notes: [{string: 1, fret: 0}, {string: 5, fret: 2}]},
  {duration: '3/16', notes: [{string: 2, fret: 3}]},
  {kind: 'rest', duration: '1/16', notes: []}
]}]});
test('chord shares one onset; tuning/capo and dotted durations affect playback', () => {
  const data = timeline(score(), 80);
  assert.deepEqual(data.events[0].midi, [70, 53]);
  assert.equal(data.events[0].start, 0);
  assert.equal(data.events[0].duration, 0.375);
  assert.equal(data.events[1].start, 0.375);
  assert.equal(data.events[1].duration, 0.5625);
  assert.deepEqual(data.events[2].midi, []);
  assert.equal(data.total, 1.125);
});
test('missing timing is rejected with a position, never guessed', () => {
  const value = score(); value.measures[0].events[1].duration = null;
  assert.throws(() => timeline(value, 80), error => error.eventId === 'm1-e2' && /节奏/.test(error.message));
});
test('unknown fret and empty positions do not turn into open strings or rests', () => {
  const value = score(), event = value.measures[0].events[0];
  event.notes[0].fret = null;
  assert.throws(() => pitches(value, event), /未知品位/);
  event.notes = []; event.kind = 'unknown';
  assert.throws(() => timeline(value, 80), /空位置/);
});
test('practice speed changes time without altering frets or chord groups', () => {
  const value = score(), before = structuredClone(value);
  assert.equal(timeline(value, 40).total, 2 * timeline(value, 80).total);
  assert.deepEqual(value, before);
  assert.throws(() => timeline(value, 0), /速度/);
});
test('practice range validates only included notes and resets their onset', () => {
  const value = score();
  value.measures.unshift({id: 'unknown-bar', number: 1, events: [{id: 'unknown-event', kind: 'unknown', duration: null, notes: []}]});
  renumberMeasures(value);
  assert.throws(() => timeline(value, 80), /节奏/);
  const excerpt = timeline(value, 80, {from: 1, to: 1});
  assert.equal(excerpt.events[0].measure, 2);
  assert.equal(excerpt.events[0].start, 0);
  assert.equal(excerpt.total, 1.125);
  assert.throws(() => timeline(value, 80, {from: 1, to: 0}), /范围/);
});
test('natural tails cross other strings and rests, but end at the next same-string note', () => {
  const data = {total: 1, events: [
    {start: 0, duration: 0.25, midi: [40, 64], strings: [6, 1]},
    {start: 0.25, duration: 0.25, midi: [59], strings: [2]},
    {start: 0.5, duration: 0.25, midi: [], strings: []},
    {start: 0.75, duration: 0.25, midi: [42], strings: [6]}
  ]};
  const before = structuredClone(data);
  const notes = voicePlan(data, {sustain: 'natural'}, () => 4);
  assert.equal(notes.find(n => n.midi === 40).end, 0.75);
  assert.equal(notes.find(n => n.midi === 64).end, 4);
  assert.equal(notes.find(n => n.midi === 59).end, 4.25);
  assert.deepEqual(data, before);
  const loop = voicePlan(data, {sustain: 'natural', loop: true}, () => 4);
  assert.ok(loop.every(n => n.end <= data.total));
});
test('per-position articulation overrides the global setting without changing musical time', () => {
  const data = {total: 1, events: [
    {start: 0, duration: 0.5, midi: [40], strings: [6], sustain: 'timed'},
    {start: 0.5, duration: 0.5, midi: [64], strings: [1], sustain: 'natural'}
  ]};
  const plan = voicePlan(data, {sustain: 'natural'}, () => 2);
  assert.equal(plan[0].end, 0.5);
  assert.equal(plan[1].end, 2.5);
  assert.equal(voicePlan(data, {sustain: 'timed'}, () => 2)[1].end, 2.5);
});
