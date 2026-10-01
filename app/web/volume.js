import {dynamicLevel,dynamicVolume,locate} from './core.js';

export function setupVolume({player,getScore,getSelection,commit}){
  const controls=document.createElement('div');controls.className='volume-controls';
  controls.innerHTML='<button id="master-mute" aria-label="静音" aria-pressed="false">静音</button><label>总音量 <input id="master-volume" type="range" min="0" max="100" value="100" aria-label="总音量"></label><output id="master-volume-value">100%</output>';
  document.querySelector('#practice-settings').before(controls);
  const range=controls.querySelector('input'),mute=controls.querySelector('button'),output=controls.querySelector('output');
  const updateMaster=(persist=true)=>{
    output.textContent=`${range.value}%`;mute.textContent=player.muted?'取消静音':'静音';mute.setAttribute('aria-pressed',String(player.muted));
    if(persist)try{localStorage.setItem('tablens.audio.v1',JSON.stringify({volume:player.masterVolume,muted:player.muted}));}catch{}
  };
  try{const saved=JSON.parse(localStorage.getItem('tablens.audio.v1'));if(saved&&Number.isFinite(saved.volume)&&saved.volume>=0&&saved.volume<=100){player.setVolume(saved.volume,saved.muted===true);range.value=saved.volume;}}catch{}
  updateMaster(false);
  range.addEventListener('input',()=>{player.setVolume(Number(range.value));updateMaster();});
  mute.addEventListener('click',()=>{player.setVolume(player.masterVolume,!player.muted);updateMaster();});
  for(const id of ['event-dynamics','note-dynamics']){const option=document.createElement('option');option.value='custom';option.textContent='自定义';option.disabled=true;document.querySelector('#'+id).append(option);}
  const field=document.createElement('div');field.className='note-volume-controls';
  field.innerHTML='<label for="note-volume">选中音符音量 <output id="note-volume-value"></output></label><input id="note-volume" aria-label="选中音符音量" type="range" min="0" max="100" step="1"><button id="note-volume-inherit" class="small">跟随位置</button><small>0为无声；滑块与轻、中、重共用一个设置。</small>';
  document.querySelector('#note-dynamics').closest('.rhythm-field').append(field);
  const noteRange=field.querySelector('input'),noteOutput=field.querySelector('output'),inherit=field.querySelector('button');
  noteRange.addEventListener('input',()=>{noteOutput.textContent=noteRange.value;});
  noteRange.addEventListener('change',()=>{const selection=getSelection();if(selection?.kind==='multi')return;const note=locate(getScore(),selection?.eventId,selection?.noteId)?.note;if(note)commit(()=>{note.dynamics=Number(noteRange.value);});});
  inherit.addEventListener('click',()=>{const selection=getSelection(),note=locate(getScore(),selection?.eventId,selection?.noteId)?.note;if(note)commit(()=>{delete note.dynamics;});});
  const batch=document.createElement('span');batch.className='batch-volume-controls';
  batch.innerHTML='<label>音量 <input id="selection-volume" type="number" min="0" max="100" value="70" aria-label="所选音符音量"></label><button id="selection-apply-volume">统一音量</button><button data-selection-volume-delta="-10" title="所选音符各降低10，保留强弱差别">−10</button><button data-selection-volume-delta="10" title="所选音符各提高10，保留强弱差别">＋10</button>';
  document.querySelector('#selection-delete').before(batch);
  return ()=>{
    const selection=getSelection(),found=locate(getScore(),selection?.eventId,selection?.noteId),note=selection?.kind==='multi'?null:found?.note;
    noteRange.disabled=inherit.disabled=!note;noteOutput.textContent=note?`${Math.round(dynamicVolume(dynamicLevel(found.event,note)))}${note.dynamics===undefined?' · 跟随位置':''}`:'先选一个音符';
    if(note)noteRange.value=dynamicVolume(dynamicLevel(found.event,note));
    for(const button of batch.querySelectorAll('button'))button.disabled=selection?.kind!=='multi'||!selection.noteIds.length;
  };
}
