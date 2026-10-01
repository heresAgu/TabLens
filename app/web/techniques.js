// A technique belongs to its destination note and points to the preceding
// note on the same string. This keeps chords and cross-measure links unambiguous.
export const TECHNIQUE_LABELS = {
  hammer: '击弦 h',
  pull: '勾弦 p',
  slide: '滑弦 /'
};

export function previousOnString(score, targetEventId, string) {
  let previous = null;
  for (const measure of score.measures) {
    for (const event of measure.events) {
      if (event.id === targetEventId) return previous;
      const note = event.notes.find(item => item.string === string);
      if (note) previous = {event, note, measure};
    }
  }
  return null;
}

export function techniqueError(score, event, note) {
  const technique = note.technique;
  if (!technique) return null;
  if (!Object.hasOwn(TECHNIQUE_LABELS, technique.type)) return '技巧类型无效';
  const previous = previousOnString(score, event.id, note.string);
  if (!previous || previous.note.id !== technique.fromNoteId) return '技巧必须连接前一颗同弦音';
  if (note.fret === null || previous.note.fret === null) return '技巧两端的品位必须明确';
  if (technique.type === 'hammer' && note.fret <= previous.note.fret) return '击弦目标品位须更高';
  if (technique.type === 'pull' && note.fret >= previous.note.fret) return '勾弦目标品位须更低';
  if (technique.type === 'slide') {
    if (note.fret === previous.note.fret) return '滑弦两端品位不能相同';
    if (!Number.isFinite(technique.ratio) || technique.ratio < 0.1 || technique.ratio > 0.9) return '滑弦时间须为音符间隔的10%–90%';
  } else if (technique.ratio !== undefined) return '只有滑弦能设置滑动时间';
  return null;
}

export function validateTechniques(score) {
  for (const measure of score.measures) for (const event of measure.events) for (const note of event.notes) {
    const error = techniqueError(score, event, note);
    if (error) throw new Error(error);
  }
}

export function pruneTechniques(score) {
  let removed = 0;
  for (const measure of score.measures) for (const event of measure.events) for (const note of event.notes) {
    if (techniqueError(score, event, note)) { delete note.technique; removed++; }
  }
  return removed;
}

export function setNoteTechnique(score, eventId, noteId, type, ratio = 0.2) {
  const event = score.measures.flatMap(measure => measure.events).find(item => item.id === eventId);
  const note = event?.notes.find(item => item.id === noteId);
  if (!note) throw new Error('请先选中目标音符');
  if (!type) { delete note.technique; return; }
  if (note.graceBefore) throw new Error('请先移除当前音符的倚音，再连接前一音');
  const previous = previousOnString(score, eventId, note.string);
  if (!previous) throw new Error('这根弦前面没有可连接的音');
  note.technique = {type, fromNoteId: previous.note.id};
  if (type === 'slide') note.technique.ratio = ratio;
  const error = techniqueError(score, event, note);
  if (error) { delete note.technique; throw new Error(error); }
}
