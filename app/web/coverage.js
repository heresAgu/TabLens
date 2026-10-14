// Keep every locally located TAB segment visible in a candidate score.
export function completeCoverage(prepared, result = null, previous = null, attempts = []) {
  const from = value => new Map((value?.measures ?? []).map(measure =>
    [measure.recognition?.segmentId ?? prepared.segments.find(s => s.number === measure.number)?.id, measure]));
  const oldMeasures = from(previous), newMeasures = from(result);
  const attemptStates = new Map(attempts.map(item => [item.id, item]));
  const base = result ?? previous ?? {
    schema: 'tablens.score', version: 1, id: `score-${prepared.id}`,
    title: prepared.source.name.replace(/\.[^.]+$/, ''), tempo: null,
    timeSignature: null, capo: null, tuningMidi: [64, 59, 55, 50, 45, 40],
    tuningOrigin: 'standard-default', sources: [prepared.source], issues: []
  };
  const measures = prepared.segments.map(segment => {
    const previousMeasure=oldMeasures.get(segment.id);
    const recognized = newMeasures.get(segment.id) ?? previousMeasure;
    if (recognized?.events.length){
      const measure=structuredClone(recognized);
      measure.number=segment.number;
      measure.source={pageId:prepared.source.id,box:segment.box};
      measure.recognition={...measure.recognition,preparedId:prepared.id,segmentId:segment.id};
      delete measure.recognition.status;
      delete measure.recognition.reason;
      return measure;
    }
    const attempt = attemptStates.get(segment.id);
    const reason = !segment.readable ? segment.issues.join('；') || '此段无法自动识别'
      : attempt?.state === 'failed' ? attempt.error || '本次识别失败'
      : attempt?.state === 'pending' || attempt?.state === 'running' ? '识别未完成'
      : !attempt && previousMeasure?.recognition?.reason ? previousMeasure.recognition.reason
      : '未选择识别或尚未识别';
    return {id: `measure-${prepared.id}-${segment.id}`, number: segment.number,
      source: {pageId: prepared.source.id, box: segment.box},
      recognition: {preparedId: prepared.id, segmentId: segment.id, status: 'missing', reason},
      issues: [`原图第 ${segment.number} 段尚未导入音符：${reason}`], events: []};
  });
  const hadRecognition=previous?.measures.some(measure=>measure.events.length);
  return {...structuredClone(base),
    ...(hadRecognition?{id:previous.id,title:previous.title,tempo:previous.tempo,
      timeSignature:previous.timeSignature,capo:previous.capo,tuningMidi:previous.tuningMidi,
      tuningOrigin:previous.tuningOrigin}:{}),
    sources: [structuredClone(prepared.source)],
    issues: [...new Set([...(previous?.issues ?? []), ...(result?.issues ?? [])])],
    measures};
}
