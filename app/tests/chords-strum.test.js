import test from 'node:test';
import assert from 'node:assert/strict';
import {addPosition, dynamicGain, importScore, locate, newScore, portable, removeNote, validate} from '../web/core.js';
import {applyChordPreset, copyChordToNext} from '../web/chords.js';
import {strumArticulation, strumOffsets, timeline, voicePlan, suggestedStrumAccent} from '../web/playback.js';
import {displayedChords, eventXPositions} from '../web/tab.js';
import {autoStrumGain} from '../web/preferences.js';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9,
  `expected ${expected}, got ${actual}`);

test('preset fills one position with the playable voicing, and copy keeps its own rhythm', () => {
  const score = newScore(), measure = score.measures[0];
  const id = addPosition(score, measure.id, null);
  const noteId = applyChordPreset(score, id, 'C');
  const first = locate(score, id).event;
  assert.equal(noteId, first.notes[0].id);
  assert.deepEqual(first.notes.map(({string, fret}) => [string, fret]),
    [[1, 0], [2, 1], [3, 0], [4, 2], [5, 3]]);
  assert.equal(first.chordName, 'C');
  first.duration = '1/4';
  first.strum = {direction: 'down', spreadBeats: 0.16};
  const nextId = copyChordToNext(score, id), second = locate(score, nextId).event;
  assert.equal(second.duration, null);
  assert.equal(second.chordName, 'C');
  assert.equal(second.strum, undefined);
  assert.deepEqual(second.notes.map(({string, fret}) => [string, fret]),
    first.notes.map(({string, fret}) => [string, fret]));
  assert.ok(second.notes.every(note => !first.notes.some(source => source.id === note.id)));
  second.duration = '1/4';
  second.strum = {direction: 'up', spreadBeats: 0.16};
  assert.equal(importScore(portable(score)).measures[0].events[1].strum.direction, 'up');
});

test('down and up strums stagger only the sounding strings without changing beats', () => {
  const score = newScore(), measure = score.measures[0];
  const firstId = addPosition(score, measure.id, null);
  applyChordPreset(score, firstId, 'C');
  const first = locate(score, firstId).event;
  first.duration = '1/4';
  first.strum = {direction: 'down', spreadBeats: 0.16};
  const secondId = copyChordToNext(score, firstId), second = locate(score, secondId).event;
  second.duration = '1/4';
  second.strum = {direction: 'up', spreadBeats: 0.16};
  const data = timeline(score, 120), plan = voicePlan(data, {sustain: 'timed'});
  near(data.total, 1);
  const down = plan.filter(note => note.start < 0.5);
  const up = plan.filter(note => note.start >= 0.5);
  near(down.find(note => note.string === 5).start, 0);
  near(down.find(note => note.string === 1).start, 0.08);
  near(up.find(note => note.string === 1).start, 0.5);
  near(up.find(note => note.string === 5).start, 0.58);
  assert.ok(down.every(note => note.end === 0.5));
  assert.ok(up.every(note => note.end === 1));
  near(strumOffsets(timeline(score, 60).events[0], 60).get(1), 0.16);
  const base = 0.16 / Math.sqrt(5);
  near(down.find(note => note.string === 5).volume, base * 1.08 * autoStrumGain(1.07, 'standard'));
  near(down.find(note => note.string === 1).volume, base * 0.90 * autoStrumGain(1.07, 'standard'));
  near(up.find(note => note.string === 1).volume, base * 0.82 * autoStrumGain(1.02, 'standard'));
  near(up.find(note => note.string === 5).volume, base * 0.82 * 0.75 * autoStrumGain(1.02, 'standard'));
  assert.ok(down.every(note => note.attack === 0.005));
  assert.ok(up.every(note => note.attack === 0.010));
  const articulation = strumArticulation(data.events[0], data.bpm);
  near(articulation.get(4).offset, 0.08 * 0.19 + 0.0015);
  assert.deepEqual([...strumOffsets(data.events[0], data.bpm)],
    [...articulation].map(([string, style]) => [string, style.offset]));
});

test('single picked notes keep their original onset, gain and instrument attack', () => {
  const score = newScore(), id = addPosition(score, score.measures[0].id, null);
  const event = locate(score, id).event;
  event.duration = '1/4';
  event.kind = 'notes';
  event.notes = [{id: 'single-note', string: 4, fret: 2}];
  const plan = voicePlan(timeline(score, 80), {sustain: 'timed'});
  assert.equal(plan.length, 1);
  assert.equal(plan[0].midi, 52);
  near(plan[0].start, 0);
  near(plan[0].volume, 0.16);
  assert.equal(plan[0].attack, undefined);
});

test('ordinary chords stay simultaneous and deleting down to one note clears the marks', () => {
  const score = newScore(), id = addPosition(score, score.measures[0].id, null);
  applyChordPreset(score, id, 'Am');
  const event = locate(score, id).event;
  event.duration = '1/4';
  assert.ok(voicePlan(timeline(score, 80)).every(note => note.start === 0));
  event.strum = {direction: 'down', spreadBeats: 0.08};
  for (const note of [...event.notes].slice(0, -1)) removeNote(score, id, note.id);
  assert.equal(event.strum, undefined);
  assert.equal(event.chordName, undefined);
  assert.doesNotThrow(() => validate(score));
  event.strum = {direction: 'down', spreadBeats: 0.08};
  assert.throws(() => validate(score), /扫弦/);
});

test('standard-tuning presets reject alternate tuning instead of mislabeling the chord', () => {
  const score = newScore(), id = addPosition(score, score.measures[0].id, null);
  score.tuningMidi = [64, 59, 55, 50, 45, 41];
  assert.throws(() => applyChordPreset(score, id, 'C'), /标准调弦/);
});

test('chord names print at changes and reserve room for long labels', () => {
  const events = [
    {chordName: 'C'}, {chordName: 'C'}, {},
    {chordName: 'Emadd11(no5)/G'}, {chordName: 'Emadd11(no5)/G'},
    {chordName: 'Am'}
  ];
  const labels=displayedChords(events), xs=eventXPositions(events,labels);
  assert.deepEqual(labels,['C',null,null,'Emadd11(no5)/G',null,'Am']);
  assert.ok(xs.every((x,index)=>index===0||x-xs[index-1]>=49));
  const width=name=>[...name].length*3.6;
  assert.ok(xs[5]-width('Am')>xs[3]+width('Emadd11(no5)/G'));
});

test('very fast and partial strums keep each sounded string in order', () => {
  for (const direction of ['down', 'up']) for (let count=2;count<=6;count++) {
    const strings=Array.from({length:count},(_,index)=>index+1);
    const event={id:'fast-stroke',index:3,duration:0.05,strings,
      strum:{direction,spreadBeats:0.04}};
    const stroke=strumArticulation(event,300);
    const offsets=[...stroke.values()].map(item=>item.offset);
    near(offsets[0],0);
    near(offsets.at(-1),0.008);
    assert.ok(offsets.every((value,index)=>index===0||value>offsets[index-1]));
    assert.deepEqual([...strumArticulation(event,300)],[...stroke]);
  }
});

test('automatic strums have a stable metrical contour; manual stroke volume keeps string accents', () => {
  const score = newScore(), measure = score.measures[0];
  const firstId = addPosition(score, measure.id, null);
  applyChordPreset(score, firstId, 'C');
  const first = locate(score, firstId).event;
  first.duration = '1/8';
  first.strum = {direction: 'down', spreadBeats: 0.08, autoDynamics: true};
  const secondId = copyChordToNext(score, firstId);
  const second = locate(score, secondId).event;
  second.duration = '1/8';
  second.strum = {direction: 'up', spreadBeats: 0.08, autoDynamics: true};
  const thirdId = copyChordToNext(score, secondId);
  const third = locate(score, thirdId).event;
  third.duration = '1/8';
  third.strum = {direction: 'down', spreadBeats: 0.08, autoDynamics: true};
  assert.deepEqual([first, second, third].map(event => suggestedStrumAccent(score, event)), [1.07, 0.97, 1.02]);
  const baseline = voicePlan(timeline(score, 80));
  third.notes[0].dynamics = 'strong';
  third.notes[1].dynamics = 'soft';
  const unadjusted = voicePlan(timeline(score, 80));
  third.strum.volume = 85;
  const adjusted = voicePlan(timeline(score, 80));
  for (const note of third.notes) {
    const original = unadjusted.find(voice => voice.noteId === note.id);
    const changed = adjusted.find(voice => voice.noteId === note.id);
    near(changed.volume / original.volume, 1.175 / autoStrumGain(1.02, 'standard'));
    near(changed.start, original.start);
    near(changed.end, original.end);
  }
  assert.equal(third.notes[0].dynamics, 'strong');
  assert.equal(third.notes[1].dynamics, 'soft');
  near(adjusted.find(voice => voice.noteId === first.notes[0].id).volume,
    baseline.find(voice => voice.noteId === first.notes[0].id).volume);
  assert.equal(importScore(portable(score)).measures[0].events[2].strum.volume, 85);
  third.strum.volume = 0;
  assert.ok(voicePlan(timeline(score, 80)).filter(voice => third.notes.some(note => note.id === voice.noteId))
    .every(voice => voice.volume === 0));
  third.strum.volume = 101;
  assert.throws(() => validate(score), /扫弦/);
});

test('legacy sweeps without autoDynamics get accents without changing saved base dynamics', () => {
  const score = newScore(), id = addPosition(score, score.measures[0].id, null);
  applyChordPreset(score, id, 'C');
  const event = locate(score, id).event;
  event.duration = '1/8';
  event.strum = {direction: 'down', spreadBeats: 0.08};
  event.dynamics = 'soft';
  event.notes[0].dynamics = 'strong';
  const secondId = copyChordToNext(score, id), second = locate(score, secondId).event;
  second.duration = '1/8';
  second.strum = {direction: 'up', spreadBeats: 0.08};
  const original = portable(score);
  const automatic = voicePlan(timeline(score, 80));
  near(timeline(score, 80).events[0].strumGain, autoStrumGain(1.07, 'standard'));
  near(timeline(score, 80).events[1].strumGain, autoStrumGain(0.97, 'standard'));
  assert.equal(event.notes[0].dynamics, 'strong');
  assert.equal(event.notes[1].dynamics, undefined);
  event.strum.volume = 80;
  const manual = voicePlan(timeline(score, 80));
  for (const note of event.notes) {
    const before = automatic.find(voice => voice.noteId === note.id);
    const after = manual.find(voice => voice.noteId === note.id);
    near(after.volume / before.volume, dynamicGain(80) / autoStrumGain(1.07, 'standard'));
  }
  delete event.strum.volume;
  assert.deepEqual(voicePlan(timeline(score, 80)), automatic);
  assert.deepEqual(portable(score), original);
  event.duration = '1/16';
  near(timeline(score, 80).events[1].strumGain, autoStrumGain(0.94, 'standard'));
});

test('automatic sweep contrast separates weak, medium and strong strokes', () => {
  near(autoStrumGain(1.07, 'subtle'), 1.07);
  near(autoStrumGain(0.94, 'off'), 1);
  near(autoStrumGain(1.07, 'off'), 1);
  for (const contrast of ['standard', 'strong']) {
    const weak=autoStrumGain(0.97, contrast);
    const medium=autoStrumGain(1.02, contrast);
    const strong=autoStrumGain(1.07, contrast);
    assert.ok(medium-weak>=0.1 && strong-medium>=0.1);
  }
  assert.ok(autoStrumGain(1.07, 'strong')>autoStrumGain(1.07, 'standard'));
});
