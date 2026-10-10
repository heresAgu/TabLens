// Compact interchange format for image-reading agents. Generated IDs and
// embedded image data belong to the saved TabLens format, not this one.
export const AGENT_FORMAT = 'tablens.agent.v1';
const durations = new Set(['1', '1/2', '1/4', '1/8', '1/16', '1/32', '3/8', '3/16']);

function object(value, where) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(where + '必须是对象');
  return value;
}
function fields(value, allowed, where) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(where + '含有不支持的字段「' + key + '」，请对照 Agent 模板修改');
  }
}
function issues(value, where) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim()))
    throw new Error(where + '的 uncertain_items 必须是非空文字列表');
  return value.map(item => item.trim());
}

export function normalizeAgentDraft(raw) {
  object(raw, 'Agent 文件');
  fields(raw, ['format', 'metadata', 'measures', 'uncertain_items'], 'Agent 文件');
  if (raw.format !== AGENT_FORMAT) throw new Error('Agent 文件格式应为 ' + AGENT_FORMAT);

  const meta = object(raw.metadata, 'metadata');
  fields(meta, ['title', 'tempo_bpm', 'time_signature', 'capo'], 'metadata');
  if (typeof meta.title !== 'string' || !meta.title.trim() || meta.title.length > 120)
    throw new Error('metadata.title 须为1到120字的乐谱名称');
  if (meta.tempo_bpm !== null && (!Number.isInteger(meta.tempo_bpm) || meta.tempo_bpm < 20 || meta.tempo_bpm > 300))
    throw new Error('metadata.tempo_bpm 须为20到300的整数；看不清时填 null');
  const signature = meta.time_signature;
  if (signature !== null && (!Array.isArray(signature) || signature.length !== 2 ||
    !Number.isInteger(signature[0]) || signature[0] < 1 || signature[0] > 32 ||
    ![1, 2, 4, 8, 16, 32].includes(signature[1])))
    throw new Error('metadata.time_signature 须为如 [4,4] 的拍号；看不清时填 null');
  if (!Number.isInteger(meta.capo) || meta.capo < 0 || meta.capo > 24)
    throw new Error('metadata.capo 须为0到24的整数；不确定时先确认，以免播放错调');

  if (!Array.isArray(raw.measures) || !raw.measures.length) throw new Error('measures 至少需要一个小节');
  const result = {
    metadata: {...meta, title: meta.title.trim()},
    uncertain_items: issues(raw.uncertain_items, 'Agent 文件'),
    measures: []
  };
  if (meta.tempo_bpm === null) result.uncertain_items.push('速度未读到，练习时暂用应用默认速度');
  if (signature === null) result.uncertain_items.push('拍号待确认，暂不能自动核对每小节拍数');

  let previousNumber = null;
  for (const [mi, rawMeasure] of raw.measures.entries()) {
    const measure = object(rawMeasure, '第' + (mi + 1) + '个小节');
    fields(measure, ['number', 'events', 'uncertain_items', 'allow_incomplete'], '第' + (mi + 1) + '个小节');
    if (!Number.isInteger(measure.number) || measure.number < 1)
      throw new Error('第' + (mi + 1) + '个小节的 number 须为正整数');
    if (previousNumber !== null && measure.number !== previousNumber + 1)
      throw new Error('第' + (mi + 1) + '个小节的编号应为 ' + (previousNumber + 1) + '；请检查是否漏掉小节');
    previousNumber = measure.number;
    if (!Array.isArray(measure.events) || !measure.events.length)
      throw new Error('第' + measure.number + '小节没有演奏位置；整小节休止也要显式写出休止位置');
    if (measure.allow_incomplete !== undefined && typeof measure.allow_incomplete !== 'boolean')
      throw new Error('第' + measure.number + '小节的 allow_incomplete 须为 true 或 false');
    const normalized = {
      number: measure.number,
      events: [],
      uncertain_items: issues(measure.uncertain_items, '第' + measure.number + '小节')
    };
    if (measure.allow_incomplete !== undefined) normalized.allow_incomplete = measure.allow_incomplete;
    for (const [ei, rawEvent] of measure.events.entries()) {
      const where = '第' + measure.number + '小节第' + (ei + 1) + '个位置';
      const event = object(rawEvent, where);
      fields(event, ['kind', 'duration', 'notes', 'chordName', 'strum', 'uncertain_items'], where);
      if (!Object.hasOwn(event, 'duration') || (event.duration !== null && !durations.has(event.duration)))
        throw new Error(where + '的 duration 须为模板列出的时值；看不清时填 null');
      if (!Array.isArray(event.notes)) throw new Error(where + '的 notes 须为音符列表');
      const kind = event.kind ?? (event.notes.length ? 'notes' : null);
      if (!['notes', 'rest', 'unknown'].includes(kind))
        throw new Error(where + '须写明音符，或用 kind: "rest"/"unknown" 标记休止/待确认');
      if ((kind === 'notes' && !event.notes.length) || (kind !== 'notes' && event.notes.length))
        throw new Error(where + '的 kind 与 notes 不匹配；同时弹的音应放在同一 notes 列表');
      const normalizedEvent = {
        kind, duration: event.duration, notes: [],
        uncertain_items: issues(event.uncertain_items, where)
      };
      if (event.chordName !== undefined) {
        if (typeof event.chordName !== 'string' || !event.chordName.trim() || event.chordName.trim().length > 24 || kind === 'rest')
          throw new Error(where + '的 chordName 须为1到24字的和弦名，且不能写在休止位置');
        normalizedEvent.chordName = event.chordName.trim();
        if (event.notes.length < 2) normalizedEvent.chordPending = true;
      }
      if (kind === 'unknown' && !normalizedEvent.uncertain_items.length)
        normalizedEvent.uncertain_items.push(event.chordName ? '和弦按弦位置待确认；请补上实际弹响的弦与品位' : '此位置尚未确认是音符还是休止');
      if (event.strum !== undefined) {
        const strum = object(event.strum, where + '的 strum');
        fields(strum, ['direction', 'spreadBeats'], where + '的 strum');
        if (kind === 'rest' || (event.notes.length < 2 && !normalizedEvent.chordPending))
          throw new Error(where + '的扫弦至少要有两根音符；只有带和弦名的待确认指型可暂存方向');
        if (!['down', 'up'].includes(strum.direction))
          throw new Error(where + '的 strum.direction 必须是 down 或 up');
        const spreadBeats = strum.spreadBeats === undefined ? 0.08 : strum.spreadBeats;
        if (!Number.isFinite(spreadBeats) || spreadBeats < 0.04 || spreadBeats > 0.5)
          throw new Error(where + '的 strum.spreadBeats 必须是0.04到0.5拍');
        normalizedEvent.strum = {direction: strum.direction, spreadBeats,
          ...(strum.spreadBeats === undefined ? {speedMode: 'auto'} : {})};
      }
      const strings = new Set();
      for (const [ni, rawNote] of event.notes.entries()) {
        const noteWhere = where + '第' + (ni + 1) + '个音符';
        const note = object(rawNote, noteWhere);
        fields(note, ['string', 'fret'], noteWhere);
        if (!Number.isInteger(note.string) || note.string < 1 || note.string > 6)
          throw new Error(noteWhere + '的 string 须为1到6；1是最细的高音弦');
        if (strings.has(note.string))
          throw new Error(where + '的第' + note.string + '弦重复；先后弹请拆成两个位置');
        strings.add(note.string);
        if (note.fret !== null && (!Number.isInteger(note.fret) || note.fret < 0 || note.fret > 36))
          throw new Error(noteWhere + '的 fret 须为0到36；看不清时填 null');
        if (note.fret === null) normalizedEvent.uncertain_items.push('第' + note.string + '弦品位待确认');
        normalizedEvent.notes.push({string: note.string, fret: note.fret});
      }
      normalizedEvent.notes.sort((a, b) => a.string - b.string);
      normalized.events.push(normalizedEvent);
    }
    result.measures.push(normalized);
  }
  return result;
}
