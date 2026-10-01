// Layout owns navigation only; existing score and playback controls keep their IDs.
const $=selector=>document.querySelector(selector);
export function selectEditorTab(name) {
  for(const button of document.querySelectorAll('[data-editor-tab]')) {
    const active=button.dataset.editorTab===name;button.classList.toggle('active',active);
    button.setAttribute('aria-selected',String(active));
  }
  for(const page of document.querySelectorAll('.editor-page'))page.hidden=page.dataset.editorPage!==name;
}

export function setupWorkspace() {
  const editor=$('.editor-panel'),nav=document.createElement('div');nav.className='editor-tabs';nav.setAttribute('role','tablist');
  const pages={};
  for(const [name,label] of [['note','音符'],['rhythm','节奏'],['expression','表现'],['measure','小节']]) {
    const button=document.createElement('button');button.textContent=label;button.dataset.editorTab=name;
    button.setAttribute('role','tab');button.addEventListener('click',()=>selectEditorTab(name));nav.append(button);
    const page=document.createElement('div');page.className='editor-page';page.dataset.editorPage=name;
    page.id='editor-'+name;page.setAttribute('role','tabpanel');pages[name]=page;
  }
  const content=document.createElement('div');content.className='editor-content';
  const error=$('#edit-error');editor.querySelector('.panel-heading').after(nav,error,content);
  pages.note.append($('#note-form'),$('.event-notes'),$('.editor-actions'),$('#technique-controls'),$('#apply-grace').closest('.rhythm-field'),$('#bend-semitones').closest('.rhythm-field'));
  pages.expression.append($('#event-dynamics').closest('.rhythm-field'),$('#event-sustain').closest('.rhythm-field'));
  pages.rhythm.append($('#edit-duration').closest('.rhythm-field'));
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
