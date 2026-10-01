function selectedNote(score, eventId, noteId) {
  return score.measures.flatMap(measure => measure.events)
    .find(event => event.id === eventId)?.notes.find(note => note.id === noteId);
}

export function ornamentError(note) {
  const grace = note.graceBefore;
  if (grace) {
    if (!grace.id || !Number.isInteger(grace.string) || grace.string < 1 || grace.string > 6 ||
        !Number.isInteger(grace.fret) || grace.fret < 0 || grace.fret > 36)
      return '倚音需要有效的弦号和品位';
    if (!Number.isFinite(grace.leadBeats) || grace.leadBeats < 0.05 || grace.leadBeats > 0.5)
      return '倚音提前量须为0.05–0.5拍';
    if (!['pick', 'hammer', 'pull', 'slide'].includes(grace.articulation))
      return '倚音连接方式无效';
    if (note.fret === null) return '主音品位未确认，不能设置倚音';
    if (note.technique) return '同一主音不能同时连接上一音和倚音';
    if (grace.articulation !== 'pick') {
      if (grace.string !== note.string) return '连奏倚音与主音须在同一根弦';
      if (grace.articulation === 'hammer' && grace.fret >= note.fret) return '击弦倚音须从较低品位进入主音';
      if (grace.articulation === 'pull' && grace.fret <= note.fret) return '勾弦倚音须从较高品位进入主音';
      if (grace.articulation === 'slide' && grace.fret === note.fret) return '滑入倚音两端品位不能相同';
    }
  }
  const bend = note.bend;
  if (bend) {
    if (note.fret === null || note.fret === 0) return '普通推弦需要按住非空弦品位';
    if (![0.5, 1, 2].includes(bend.semitones)) return '推弦幅度须为四分音、半音或全音';
    if (!Number.isFinite(bend.reachRatio) || bend.reachRatio < 0.1 || bend.reachRatio > 0.6)
      return '推弦到达时间须为音符时值的10%–60%';
    if (typeof bend.release !== 'boolean') return '推弦回落设置无效';
  }
  return null;
}

export function validateOrnaments(score) {
  for (const measure of score.measures) for (const event of measure.events) for (const note of event.notes) {
    const error = ornamentError(note);
    if (error) throw new Error(error);
  }
}

export function pruneOrnaments(score) {
  let removed = 0;
  for (const measure of score.measures) for (const event of measure.events) for (const note of event.notes) {
    if (!ornamentError(note)) continue;
    if (note.graceBefore) { delete note.graceBefore; removed++; }
    if (ornamentError(note) && note.bend) { delete note.bend; removed++; }
  }
  return removed;
}

export function setGraceBefore(score, eventId, noteId, settings) {
  const note = selectedNote(score, eventId, noteId);
  if (!note) throw new Error('请先选中主音');
  if (!settings) { delete note.graceBefore; return; }
  const previous = note.graceBefore;
  note.graceBefore = {id: previous?.id ?? 'grace-' + crypto.randomUUID(),
    string: settings.string, fret: settings.fret,
    leadBeats: settings.leadBeats, articulation: settings.articulation};
  const error = ornamentError(note);
  if (error) { if (previous) note.graceBefore = previous; else delete note.graceBefore; throw new Error(error); }
}

export function setBend(score, eventId, noteId, settings) {
  const note = selectedNote(score, eventId, noteId);
  if (!note) throw new Error('请先选中音符');
  if (!settings) { delete note.bend; return; }
  const previous = note.bend;
  note.bend = {semitones: settings.semitones, reachRatio: settings.reachRatio, release: settings.release};
  const error = ornamentError(note);
  if (error) { if (previous) note.bend = previous; else delete note.bend; throw new Error(error); }
}
