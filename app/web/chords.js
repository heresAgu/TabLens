import {addPosition, locate} from './core.js';

// Frets run from the sixth (low E) to the first (high e) string; null means muted.
export const CHORD_PRESETS = Object.freeze({
  C: [null, 3, 2, 0, 1, 0],
  G: [3, 2, 0, 0, 0, 3],
  Am: [null, 0, 2, 2, 1, 0],
  Em: [0, 2, 2, 0, 0, 0],
  D: [null, null, 0, 2, 3, 2],
  A: [null, 0, 2, 2, 2, 0],
  E: [0, 2, 2, 1, 0, 0],
  Dm: [null, null, 0, 2, 3, 1],
  F: [1, 3, 3, 2, 1, 1]
});

const noteId = () => `note-${crypto.randomUUID()}`;

export function applyChordPreset(score, eventId, name) {
  if (JSON.stringify(score.tuningMidi ?? [64, 59, 55, 50, 45, 40]) !== '[64,59,55,50,45,40]')
    throw new Error('常用和弦指型只适用于标准调弦；自定义调弦请逐弦编写');
  const frets = CHORD_PRESETS[name], found = locate(score, eventId);
  if (!found || !frets) throw new Error('先选择演奏位置和和弦指型');
  const previous = new Map(found.event.notes.map(note => [note.string, note]));
  found.event.notes = frets.flatMap((fret, index) => {
    if (fret === null) return [];
    const string = 6 - index, old = previous.get(string);
    return [{id: old?.id ?? noteId(), string, fret,
      source: old?.fret === fret ? old.source ?? null : null}];
  }).sort((a, b) => a.string - b.string);
  found.event.kind = 'notes';
  found.event.chordName = name;
  return found.event.notes[0].id;
}

export function copyChordToNext(score, eventId) {
  const found = locate(score, eventId);
  if (!found || found.event.notes.length < 2 || found.event.notes.some(note => note.fret === null))
    throw new Error('先选中至少包含两颗已确认音符的和弦位置');
  const index = found.measure.events.indexOf(found.event);
  const nextId = found.measure.events[index + 1]?.id ?? addPosition(score, found.measure.id, eventId);
  const target = locate(score, nextId).event;
  target.notes = found.event.notes.map(note => ({id: noteId(), string: note.string, fret: note.fret,
    source: null, ...(note.dynamics === undefined ? {} : {dynamics: note.dynamics})}));
  target.kind = 'notes';
  if (found.event.chordName) target.chordName = found.event.chordName;
  else delete target.chordName;
  return nextId;
}
