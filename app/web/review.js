import {timingWarning} from './core.js';

// Keep the confirmation tied to the music being checked, not to a measure number.
export function reviewSnapshot(measure) {
  return JSON.stringify({
    source:measure.source??null,
    allowIncomplete:measure.allowIncomplete===true,
    events:measure.events.map(event=>({
      kind:event.kind,duration:event.duration,strum:event.strum??null,
      chordName:event.chordName??null,chordPending:event.chordPending===true,
      dynamics:event.dynamics??null,sustain:event.sustain??null,
      notes:event.notes.map(note=>({
        string:note.string,fret:note.fret,source:note.source??null,
        dynamics:note.dynamics??null,technique:note.technique??null,
        graceBefore:note.graceBefore??null,bend:note.bend??null
      }))
    }))
  });
}

export function measureReviewState(measure) {
  if(measure.authored&&!measure.agentImported&&!measure.recognition)return null;
  if(!measure.reviewedSnapshot)return 'pending';
  return measure.reviewedSnapshot===reviewSnapshot(measure)?'reviewed':'changed';
}

export function collectReview(score) {
  const groups=[];
  let issueCount=0,pendingCount=0,reviewedCount=0;
  for(const measure of score.measures){
    const state=measureReviewState(measure),items=[];
    const add=(type,message,event=null,note=null,blocking=false)=>{
      if(items.some(item=>item.type===type&&item.message===message&&item.eventId===event?.id&&item.noteId===note?.id))return;
      items.push({type,message,eventId:event?.id??null,noteId:note?.id??null,blocking});
    };
    if(state==='reviewed')reviewedCount++;
    else if(state)pendingCount++;
    if(state&&!measure.events.length)add('empty',measure.recognition?.status==='missing'
      ?`原图第 ${measure.originalNumber??measure.number} 段未导入：${measure.recognition.reason??'请对照原图补录或重新识别'}`
      :'没有演奏位置，请对照原图补录',null,null,true);
    for(const [index,event] of measure.events.entries()){
      const label=`第 ${index+1} 个位置`;
      if(event.kind==='unknown'||(!event.notes.length&&event.kind!=='rest'))
        add('unknown',`${label}：音符或休止待确认`,event,null,true);
      for(const note of event.notes)if(note.fret===null)
        add('fret',`${label} · ${note.string} 弦：品位待确认`,event,note,true);
      if(event.duration===null)add('duration',`${label}：节奏待设置`,event,null,true);
      if(state!=='reviewed')for(const issue of event.issues??[])
        add('model',`${label}：${String(issue)}`,event);
    }
    if(measure.events.length&&!measure.events.some(event=>event.duration===null)){
      const warning=timingWarning(score,measure);
      if(warning)add('timing',warning,null,null,true);
    }
    if(state!=='reviewed')for(const issue of measure.issues??[])add('model',String(issue));
    issueCount+=items.length;
    if(items.length||state)groups.push({measureId:measure.id,number:measure.number,state,items,
      canConfirm:!!state&&!items.some(item=>item.blocking)});
  }
  return {groups,globals:(score.issues??[]).map(String),issueCount,pendingCount,reviewedCount};
}
