// Layout owns navigation only; existing score and playback controls keep their IDs.
const $=selector=>document.querySelector(selector);
const tabScroll=new Map();
let activeTab=null, activeEffect=null, lastNoteId=null;
const effectPanels=new Map();
const tabHelp={
  note:'音符：修改弦与品位；添加击勾滑、倚音、推弦及和弦指型',
  rhythm:'节奏：修改时值、扫弦及演奏位置',
  expression:'表现：设置力度与延音',
  measure:'小节：设置拍号、增删小节及关联原图'
};

export function selectEditorTab(name) {
  const content=$('.editor-content');
  if(content&&activeTab&&activeTab!==name)tabScroll.set(activeTab,content.scrollTop);
  for(const button of document.querySelectorAll('[data-editor-tab]')) {
    const active=button.dataset.editorTab===name;button.classList.toggle('active',active);
    button.setAttribute('aria-selected',String(active));
  }
  for(const page of document.querySelectorAll('.editor-page'))page.hidden=page.dataset.editorPage!==name;
  const toolbar=$('.editor-effect-toolbar');if(toolbar)toolbar.hidden=name!=='note';
  if(content&&activeTab!==name)content.scrollTop=tabScroll.get(name)??0;
  activeTab=name;
}

function openEffect(name,scroll=true){
  const next=name==='basic'||activeEffect===name&&effectPanels.get(name)?.open?null:name;
  activeEffect=next;
  $(`[data-editor-effect="basic"]`)?.setAttribute('aria-pressed',String(!next));
  for(const [key,panel] of effectPanels){
    panel.open=key===next;
    const button=$(`[data-editor-effect="${key}"]`);
    button?.setAttribute('aria-pressed',String(panel.open));
    button?.setAttribute('aria-expanded',String(panel.open));
  }
  if(!scroll)return;
  if(!next){$('.editor-content').scrollTop=0;return;}
  requestAnimationFrame(()=>{
    const content=$('.editor-content'),panel=effectPanels.get(next);
    if(!content||!panel||!panel.open)return;
    content.scrollTop+=panel.getBoundingClientRect().top-content.getBoundingClientRect().top-8;
  });
}

export function syncEditorEffects(note,event){
  const summaries={
    connection:note?.technique?.type==='hammer'?'击弦 h':note?.technique?.type==='pull'?'勾弦 p':note?.technique?.type==='slide'?'滑弦 /':'未设置',
    grace:note?.graceBefore?`${note.graceBefore.string}弦 ${note.graceBefore.fret}品`:'未设置',
    bend:note?.bend?({0.5:'¼',1:'½',2:'全音'}[note.bend.semitones]??'已设置'):'未设置',
    chord:event?.chordName??(event?.notes.length>1?`${event.notes.length} 音同时弹`:'未设置')
  };
  for(const [name,panel] of effectPanels){
    panel.querySelector('.effect-state').textContent=summaries[name];
    const active=summaries[name]!=='未设置';
    panel.classList.toggle('has-effect',active);
    const button=$(`[data-editor-effect="${name}"]`);
    button.disabled=name==='chord'?!event:!note;
    button.classList.toggle('has-effect',active);
  }
  if(note?.id!==lastNoteId){
    lastNoteId=note?.id??null;
    if(note&&!activeEffect){
      const present=note.technique?'connection':note.graceBefore?'grace':note.bend?'bend':null;
      if(present)openEffect(present,false);
    }
  }
}

export function setupWorkspace() {
  const editor=$('.editor-panel'),nav=document.createElement('div');nav.className='editor-tabs';nav.setAttribute('role','tablist');
  const pages={};
  for(const [name,label] of [['note','音符'],['rhythm','节奏'],['expression','表现'],['measure','小节']]) {
    const button=document.createElement('button');button.textContent=label;button.dataset.editorTab=name;
    button.dataset.tip=tabHelp[name];
    button.setAttribute('role','tab');button.addEventListener('click',()=>selectEditorTab(name));nav.append(button);
    const page=document.createElement('div');page.className='editor-page';page.dataset.editorPage=name;
    page.id='editor-'+name;page.setAttribute('role','tabpanel');pages[name]=page;
  }
  const content=document.createElement('div');content.className='editor-content';
  const toolbar=document.createElement('div');toolbar.className='editor-effect-toolbar';toolbar.setAttribute('role','group');toolbar.setAttribute('aria-label','音符效果控件');
  for(const [name,symbol,label,tip] of [
    ['basic','♬','基础','返回弦、品位与当前音符的基本操作'],
    ['connection','h/p','连接','连接前一颗同弦音：击弦、勾弦或滑弦'],
    ['grace','♪','倚音','在当前主音前添加短小音'],
    ['bend','↗','推弦','让当前音符的音高上升，可设置回落'],
    ['chord','C','和弦','查看同时弹的音、填入指型和修改和弦名']
  ]){
    const button=document.createElement('button');button.type='button';button.dataset.editorEffect=name;
    button.dataset.tip=tip;button.setAttribute('aria-pressed','false');button.setAttribute('aria-expanded','false');
    button.setAttribute('aria-label',label);button.innerHTML=`<span class="effect-symbol" aria-hidden="true">${symbol}</span><span>${label}</span>`;
    button.addEventListener('click',()=>openEffect(name));toolbar.append(button);
  }
  toolbar.querySelector('[data-editor-effect="basic"]').setAttribute('aria-pressed','true');
  const error=$('#edit-error');editor.querySelector('.panel-heading').after(nav,toolbar,error,content);
  pages.note.append($('#note-form'),$('.editor-actions'));
  function effect(name,label,nodes){
    const panel=document.createElement('details');panel.className='effect-section';panel.dataset.effectSection=name;
    panel.id=`effect-${name}`;
    $(`[data-editor-effect="${name}"]`).setAttribute('aria-controls',panel.id);
    const summary=document.createElement('summary');summary.innerHTML=`<span class="effect-chevron" aria-hidden="true">▸</span><span class="effect-title">${label}</span><span class="effect-state">未设置</span>`;
    summary.addEventListener('click',event=>{event.preventDefault();openEffect(name);});
    panel.append(summary,...nodes);pages.note.append(panel);effectPanels.set(name,panel);
  }
  effect('connection','连接技巧',[$('#technique-controls')]);
  effect('grace','短前倚音',[$('#apply-grace').closest('.rhythm-field')]);
  effect('bend','推弦',[$('#bend-semitones').closest('.rhythm-field')]);
  effect('chord','和弦与同时弹',[$('.event-notes'),$('.chord-editor')]);
  pages.expression.append($('#event-dynamics').closest('.rhythm-field'),$('#event-sustain').closest('.rhythm-field'));
  pages.rhythm.append($('#edit-duration').closest('.rhythm-field'),$('.strum-editor'));
  for(const id of ['add-position-before','add-position','set-rest','delete-position','merge-position','split-position'])pages.rhythm.append($('#'+id));
  const explanation=editor.querySelector(':scope > small');if(explanation)pages.rhythm.append(explanation);
  const meter=$('#time-signature').parentElement;meter.firstChild.textContent='全谱拍号 ';pages.measure.append(meter);
  pages.measure.append($('#incomplete-measure').parentElement,$('#retry-measure'));
  const actions=document.createElement('div');actions.className='measure-actions';
  for(const [id,text] of [['measure-before','在本小节前添加'],['measure-after','在本小节后添加'],['measure-copy','复制本小节'],['measure-delete','删除本小节']]) {
    const button=document.createElement('button');button.id=id;button.textContent=text;
    if(id==='measure-delete')button.className='danger';actions.append(button);
  }
  pages.measure.append(actions);
  const sourceButton=document.createElement('button');sourceButton.textContent='关联原图（可选）';sourceButton.className='text-button';
  sourceButton.addEventListener('click',()=>$('#attach-image').click());pages.measure.append(sourceButton);
  const hint=document.createElement('p');hint.textContent='插入、复制和删除均可撤销。复制后保留原图作为参考。';pages.measure.append(hint);
  content.append(...Object.values(pages));selectEditorTab('note');

  const densityKey='tablens.scoreDensity.v1';
  let density='compact';
  try{const saved=localStorage.getItem(densityKey);if(['standard','compact'].includes(saved))density=saved;}catch{}
  const densityButton=document.createElement('button');densityButton.id='score-density-toggle';densityButton.type='button';
  densityButton.className='small';densityButton.dataset.tip='调整校谱模式的六线谱密度；只改变显示，不修改乐谱';
  $('.score-panel .history-actions').prepend(densityButton);
  const applyDensity=()=>{
    document.body.dataset.scoreDensity=density;
    densityButton.textContent=density==='compact'?'紧凑谱面':'标准谱面';
    densityButton.setAttribute('aria-pressed',String(density==='compact'));
  };
  applyDensity();
  densityButton.addEventListener('click',()=>{
    density=density==='compact'?'standard':'compact';applyDensity();
    try{localStorage.setItem(densityKey,density);}catch{}
    document.dispatchEvent(new CustomEvent('tablens:score-density-change'));
  });

  const practice=$('#practice-settings-content');
  for(const node of document.querySelectorAll('.practice-panel > .practice-options, .practice-panel > .batch-controls, .practice-panel > small'))practice.append(node);
  $('#practice-settings').addEventListener('click',()=>$('#practice-dialog').showModal());
  $('#practice-close').addEventListener('click',()=>$('#practice-dialog').close());
  $('.score-panel').append($('.review-panel'));
  $('#source-enlarge').addEventListener('click',()=>{
    const current=$('#source-view'),large=$('#source-large');
    large.setAttribute('viewBox',current.getAttribute('viewBox'));
    large.replaceChildren(...[...current.childNodes].map(node=>node.cloneNode(true)));
    $('#source-dialog').showModal();
  });
  $('#source-close').addEventListener('click',()=>$('#source-dialog').close());
}
