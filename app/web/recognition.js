// Recognition is a candidate workflow: nothing edits the score until Apply.
import {renderTab} from './tab.js';
import {completeCoverage} from './coverage.js';
const $ = id => document.getElementById(id);
const SVG = 'http://www.w3.org/2000/svg';
const node = (tag, attrs) => {
  const element = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
  return element;
};
async function api(path, value) {
  const response = await fetch('/api/recognition/' + path, value === undefined ? {} : {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(value)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '识别请求失败');
  return result;
}
const readImage = file => new Promise((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error('无法读取文件')); reader.readAsDataURL(file);
});

export function recognitionDialog(apply, attachManual) {
  let image = null, box = null, prepared = null, job = null, candidate = null, target = null;
  let manualDrawing = false, manualBox = null;
  let pdfSession = null;
  let busy = false, analysing = false, drag = null, generation = 0, timer = null, candidateSelection = null;
  let retained = null, candidatePreparedId = null;
  let activeSegmentId = null;
  let recognitionAttempted = false;
  const status = message => { $('recognition-status').textContent = message; };
  const selectedIds = () => [...$('recognition-segments').querySelectorAll('input:checked')].map(input => input.value);
  function controls() {
    $('recognition-start').disabled = busy || analysing || !prepared || !selectedIds().length;
    $('recognition-prepare').disabled = busy || analysing || !image || manualDrawing;
    $('recognition-file').disabled = busy || analysing;
    $('recognition-mode').disabled = busy || analysing || manualDrawing;
    $('recognition-cancel').disabled = !busy || job?.state === 'cancelling';
    $('recognition-apply').disabled = busy || !candidate?.measures.length;
    $('recognition-replace').disabled = busy || !target || candidate?.measures.length !== 1 || !candidate.measures[0].events.length;
    $('recognition-append').disabled = busy || !!target || !candidate?.measures.length;
    $('recognition-manual').disabled = busy || analysing || !image || !!target;
    $('recognition-manual-box').disabled = busy || analysing || !image || !!target;
    $('recognition-manual-add').disabled = busy || analysing || !manualBox || manualBox[2]-manualBox[0]<20 || manualBox[3]-manualBox[1]<20;
    $('pdf-page').disabled = busy || analysing;
    const count=selectedIds().length;
    $('recognition-estimate').textContent = prepared ? count ? `所选 ${count} 段，最多 ${1 + 2 * count} 次模型调用：页头一次，每段分格读取与独立逐弦核对各一次。不自动重试。` : '未选小节，不会发起模型调用。' : '';
    for (const input of $('recognition-segments').querySelectorAll('input')) input.disabled = busy || input.dataset.readable !== 'true';
  }
  function paint() {
    const svg = $('recognition-image'); svg.replaceChildren();
    if (!image) return;
    svg.setAttribute('viewBox', `0 0 ${image.width} ${image.height}`);
    svg.append(node('image', {href: image.dataUrl, width: image.width, height: image.height}));
    for (const segment of prepared?.segments ?? []) {
      const [a,b,c,d] = segment.box;
      const imported=candidate?.measures.some(measure=>measure.recognition?.segmentId===segment.id&&measure.events.length);
      svg.append(node('rect', {x:a,y:b,width:c-a,height:d-b,
        class:imported||(!recognitionAttempted&&segment.readable)?'import-segment':'import-missing'}));
      if(activeSegmentId===segment.id)svg.append(node('rect',{x:a,y:b,width:c-a,height:d-b,class:'import-focused'}));
    }
    const event = candidate?.measures.flatMap(m => m.events).find(e => e.id === candidateSelection?.eventId);
    for (const note of event?.notes ?? []) {
      if (!note.source?.box) continue;
      const [a,b,c,d] = note.source.box;
      svg.append(node('rect',{x:a,y:b,width:c-a,height:d-b,class:note.id===candidateSelection.noteId?'source-focus':'source-chord'}));
    }
    if (box && $('recognition-mode').value === 'region') {
      const [a,b,c,d] = box;
      svg.append(node('rect', {x:a,y:b,width:c-a,height:d-b,class:'import-selection'}));
    }
    if (manualBox) {
      const [a,b,c,d] = manualBox;
      svg.append(node('rect', {x:a,y:b,width:c-a,height:d-b,class:'import-manual-selection'}));
    }
  }
  function manualControls() {
    $('recognition-manual-add').hidden = !manualDrawing;
    $('recognition-manual-cancel').hidden = !manualDrawing;
    $('manual-placement-wrap').hidden = !manualDrawing || !prepared;
    $('recognition-manual-box').textContent = manualDrawing ? '正在框选漏掉的小节' : '补漏小节：在原图框选';
    const placement=$('manual-placement');placement.replaceChildren();
    if(prepared){
      const options=[['auto','按原图位置自动排列']];
      for(let i=0;i<=prepared.segments.length;i++)
        options.push([String(i),i===prepared.segments.length?'放在最后一段之后':`放在第 ${i+1} 段之前`]);
      for(const [value,label] of options){const option=document.createElement('option');option.value=value;option.textContent=label;placement.append(option);}
    }
    controls();paint();
  }
  function segments() {
    $('recognition-segments').replaceChildren();
    for (const segment of prepared?.segments ?? []) {
      const label = document.createElement('label'), input = document.createElement('input');
      input.type = 'checkbox'; input.value = segment.id; input.checked = segment.readable;
      input.dataset.readable = String(segment.readable); input.disabled = !segment.readable;
      input.addEventListener('change', controls);
      const state=document.createElement('span');state.dataset.segmentStatus=segment.id;
      label.append(input, document.createTextNode(` 第 ${segment.number} 段 · ${segment.columns.length} 个候选位置 · `),state);
      label.title = segment.issues.join('；'); $('recognition-segments').append(label);
    }
    updateSegmentStatus();controls();paint();
  }
  function updateSegmentStatus() {
    for(const segment of prepared?.segments??[]){
      const state=$('recognition-segments').querySelector('[data-segment-status="'+segment.id+'"]');
      if(!state)continue;
      const measure=candidate?.measures.find(item=>item.recognition?.segmentId===segment.id);
      state.textContent=measure?.events.length?'已识别':segment.readable
        ?recognitionAttempted?'待补录':'待识别':'需人工补录';
    }
    const count=candidate?.measures.length??0;
    const recognized=candidate?.measures.filter(measure=>measure.events.length).length??0;
    $('recognition-coverage').textContent=count
      ?`原图定位 ${count} 段 · 已识别 ${recognized} 段 · 待补录 ${count-recognized} 段`
      :'';
  }
  function focusSegment(segment) {
    activeSegmentId=segment.id;candidateSelection=null;paint();
    const viewport=$('recognition-image').parentElement,svg=$('recognition-image');
    viewport.scrollTop=Math.max(0,segment.box[1]/image.height*svg.getBoundingClientRect().height-40);
  }
  async function config() {
    const settings = await api('config');
    $('api-endpoint').value = settings.endpoint; $('api-model').value = settings.model;
    $('api-state').textContent = settings.connected ? '密钥已连接（服务重启后需重新输入）' : '尚未连接密钥';
    $('api-settings').open = !settings.connected;
  }
  $('api-connect').addEventListener('click', async () => {
    const value = {endpoint: $('api-endpoint').value, model: $('api-model').value};
    if ($('api-key').value.trim()) value.key = $('api-key').value.trim();
    try { await api('config', value); $('api-key').value = ''; await config(); status('接口设置已更新'); }
    catch(error) { status(error.message); }
  });
  $('api-disconnect').addEventListener('click', async () => {
    try { await api('config', {key:''}); $('api-key').value=''; await config(); status('密钥已清除'); }
    catch(error) { status(error.message); }
  });
  async function loadPdfPage(number) {
    if (!pdfSession || busy || analysing) return;
    analysing=true;controls();status(`正在渲染PDF第 ${number} 页…`);
    try {
      const page=await api('pdf/render',{id:pdfSession.id,pageNumber:number});
      image={id:`pdf-${pdfSession.id}-${number}`,dataUrl:page.dataUrl,
        name:`${pdfSession.name} · 第 ${number} 页`,pdfName:pdfSession.name,pdfPageNumber:number,width:page.width,height:page.height};
      $('pdf-page').value=String(number);
      $('pdf-page-status').textContent=`共 ${pdfSession.pageCount} 页 · 当前第 ${number} 页；每页分别分析、识别并确认。`;
      prepared=null;candidate=null;retained=null;candidatePreparedId=null;activeSegmentId=null;recognitionAttempted=false;box=null;target=null;manualDrawing=false;manualBox=null;
      $('recognition-mode').value='whole';$('recognition-result').replaceChildren();
      segments();manualControls();status(`PDF 第 ${number} 页已打开；分析图片不会调用模型。`);
    }catch(error){image=null;prepared=null;candidate=null;segments();status(error.message);}
    finally{analysing=false;controls();}
  }
  $('recognition-file').addEventListener('change', async event => {
    const file=event.target.files[0];if(!file)return;
    try {
      if(file.size>20_000_000)throw new Error('文件请控制在20MB以内');
      if(file.type==='application/pdf'||/\.pdf$/i.test(file.name)){
        analysing=true;controls();status('正在打开PDF，尚未调用识图模型…');
        const dataUrl=await readImage(file);
        const session=await api('pdf/open',{pdfDataUrl:dataUrl});
        pdfSession={...session,name:file.name};
        $('pdf-page').replaceChildren();
        for(let number=1;number<=session.pageCount;number++){
          const option=document.createElement('option');option.value=String(number);option.textContent=`第 ${number} 页`;
          $('pdf-page').append(option);
        }
        $('pdf-page-controls').hidden=false;
        analysing=false;await loadPdfPage(1);
      }else{
        pdfSession=null;$('pdf-page-controls').hidden=true;
        const dataUrl=await readImage(file),decoded=new Image();decoded.src=dataUrl;await decoded.decode();
        if(decoded.naturalWidth*decoded.naturalHeight>24_000_000)throw new Error('图片请控制在2400万像素以内');
        image={dataUrl,name:file.name,width:decoded.naturalWidth,height:decoded.naturalHeight};
        prepared=null;candidate=null;activeSegmentId=null;recognitionAttempted=false;box=null;target=null;manualDrawing=false;manualBox=null;$('recognition-result').replaceChildren();
        segments();manualControls();status('可以整图分析，也可以先切换到框选区域后拖动选择。');
      }
    }catch(error){status(error.message);}
    finally{analysing=false;controls();}
  });
  $('pdf-page').addEventListener('change',event=>{
    const number=Number(event.target.value);
    if(candidate?.measures.some(measure=>measure.events.length)&&!confirm('当前页的识别候选尚未加入乐谱。切换页面会丢弃候选结果，继续吗？')){
      event.target.value=String(image?.pdfPageNumber??number);return;
    }
    loadPdfPage(number);
  });
  $('recognition-mode').addEventListener('change', () => {
    manualDrawing=false;manualBox=null;
    prepared=null;candidate=null;retained=null;candidatePreparedId=null;activeSegmentId=null;recognitionAttempted=false;
    $('recognition-result').replaceChildren();segments();manualControls();
  });
  $('recognition-manual-box').addEventListener('click',()=>{
    if(busy||analysing||!image||target)return;
    manualDrawing=true;manualBox=null;manualControls();
    status('在左侧原图拖动，框住漏掉的一个完整小节；不会清除已有识别结果。');
  });
  $('recognition-manual-cancel').addEventListener('click',()=>{
    manualDrawing=false;manualBox=null;manualControls();status('已取消补漏框选。');
  });
  const point = event => {
    const matrix = $('recognition-image').getScreenCTM();
    if (!matrix || !image) return null;
    const p = new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse());
    return [Math.max(0,Math.min(image.width,p.x)),Math.max(0,Math.min(image.height,p.y))];
  };
  $('recognition-image').addEventListener('pointerdown', event => {
    if (busy || analysing || !image || (!manualDrawing && $('recognition-mode').value !== 'region')) return;
    drag=point(event); $('recognition-image').setPointerCapture(event.pointerId);
    if(!manualDrawing){
      prepared=null; candidate=null; retained=null; candidatePreparedId=null;
      $('recognition-result').replaceChildren();segments();
    }
  });
  $('recognition-image').addEventListener('pointermove', event => {
    if (!drag) return; const p=point(event);
    const next=[Math.min(drag[0],p[0]),Math.min(drag[1],p[1]),Math.max(drag[0],p[0]),Math.max(drag[1],p[1])];
    if(manualDrawing)manualBox=next;else box=next;
    paint();
  });
  $('recognition-image').addEventListener('pointerup', () => { drag=null; controls(); });
  $('recognition-manual-add').addEventListener('click',async()=>{
    if(busy||analysing||!image||!manualBox||manualBox[2]-manualBox[0]<20||manualBox[3]-manualBox[1]<20)return;
    analysing=true;controls();status('正在检查补漏小节的弦线和演奏位置…');
    try{
      const oldIds=new Set(prepared?.segments.map(s=>s.id)??[]);
      const oldSelection=new Set(selectedIds());
      const place=$('manual-placement').value;
      prepared=prepared
        ?await api('manual-segment',{preparedId:prepared.id,box:manualBox,...(place==='auto'?{}:{insertAt:Number(place)})})
        :await api('prepare',{imageDataUrl:image.dataUrl,name:image.name,manualBox,
            sourceId:image.id,pdfName:image.pdfName,pdfPageNumber:image.pdfPageNumber});
      candidate=completeCoverage(prepared,null,candidate);candidatePreparedId=prepared.id;
      const added=prepared.segments.find(s=>!oldIds.has(s.id));
      manualDrawing=false;manualBox=null;manualControls();segments();resultView(candidate);
      for(const input of $('recognition-segments').querySelectorAll('input'))
        input.checked=input.value===added?.id ? input.dataset.readable==='true' : oldSelection.has(input.value);
      if(added)focusSegment(added);
      status(added?.readable?'补漏小节已加入候选谱，可勾选后尝试识别。':'补漏小节已加入候选谱并保留原图；演奏位置无法可靠定位，请打开后手动补录。');
    }catch(error){status(error.message);}
    finally{analysing=false;controls();}
  });
  $('recognition-prepare').addEventListener('click', async () => {
    if (!image || busy || analysing) return;
    if ($('recognition-mode').value === 'region' && (!box || box[2]-box[0]<10 || box[3]-box[1]<10)) {
      status('先在图片上拖动，框选要识别的小节'); return;
    }
    analysing=true; candidate=null; retained=null; candidatePreparedId=null;recognitionAttempted=false;
    $('recognition-result').replaceChildren();controls(); status('正在定位六条弦线、小节线和下方符干…');
    try {
      prepared = await api('prepare', {imageDataUrl:image.dataUrl, name:image.name,
        box:$('recognition-mode').value==='region'?box:null, sourceId:image.id,
        pdfName:image.pdfName,pdfPageNumber:image.pdfPageNumber});
      candidate=completeCoverage(prepared);candidatePreparedId=prepared.id;
      segments();manualControls();resultView(candidate);
      status(`定位到 ${prepared.segments.length} 段。未识别的段落会以关联原图的空小节保留；请勾选要自动识别的段落。`);
    } catch(error) { prepared=null; status(error.message); }
    finally { analysing=false; controls(); }
  });
  function resultView(value) {
    const list=$('recognition-result'); list.replaceChildren();
    for (const issue of value?.issues ?? []) {
      const p=document.createElement('p');p.textContent=String(issue);list.append(p);
    }
    for (const measure of value?.measures ?? []) {
      const p=document.createElement('p');
      p.textContent=measure.events.length
        ?`第 ${measure.number} 段：${measure.events.length} 个位置、${measure.events.reduce((sum,e)=>sum+e.notes.length,0)} 个音符、${measure.events.filter(e=>e.notes.length>1).length} 个同时弹组合。节奏待设置。`
        :`第 ${measure.number} 段：尚未导入音符，将作为关联原图的空小节保留。${measure.recognition?.reason??''}`;
      if(!measure.events.length){
        p.classList.add('coverage-missing');
        const segment=prepared?.segments.find(item=>item.id===measure.recognition?.segmentId);
        if(segment){const button=document.createElement('button');button.type='button';button.className='small';
          button.textContent='查看原图';button.addEventListener('click',()=>focusSegment(segment));p.append(' ',button);}
      }
      list.append(p);
      for (const issue of [...(measure.issues??[]),...measure.events.flatMap(e=>e.issues??[])]) {
        const item=document.createElement('p'); item.className='error'; item.textContent=issue; list.append(item);
      }
    }
    if (value?.measures.length) {
      const p=document.createElement('p');p.textContent='这是候选结果，尚未改动当前乐谱。空小节可对照原图补录；已识别段落仍需检查弦号、品位、顺序和同时弹组合。';list.append(p);
      const preview=document.createElement('div'); preview.id='candidate-tab';
      renderTab(preview,value,null);
      preview.addEventListener('click',event=>{
        const cell=event.target.closest('[data-event]');if (!cell) return;
        activeSegmentId=null;candidateSelection={eventId:cell.dataset.event,noteId:cell.dataset.note||null};
        renderTab(preview,value,candidateSelection);paint();
      });
      list.append(preview);
    }
    candidateSelection=null;updateSegmentStatus();paint();
  }
  async function poll(token) {
    if (token!==generation || !job) return;
    try {
      job=await api(`jobs/${job.id}`); if (token!==generation) return;
      busy=['running','cancelling'].includes(job.state);
      candidate=completeCoverage(prepared,job.result,retained,job.segments);
      candidatePreparedId=prepared?.id;
      const states={running:'正在识别',cancelling:'正在取消，等待本次调用结束',complete:'识别完成',partial:'部分小节完成',failed:'识别失败',cancelled:'任务已取消'};
      status(`${states[job.state]??job.state} · ${job.completed}/${job.total} 段 · 已调用 ${job.calls}/${job.maximumCalls} 次 · 输入/输出 tokens ${job.usage.inputTokens}/${job.usage.outputTokens}${job.errors.length?' · '+job.errors.join('；'):''}`);
      if (!busy) {
        resultView(candidate);
        const failed=new Set(job.segments.filter(s=>s.state!=='complete').map(s=>s.id));
        for (const input of $('recognition-segments').querySelectorAll('input')) input.checked=failed.has(input.value);
      }
      controls();
      if (busy) timer=setTimeout(()=>poll(token),800);
    } catch(error) {
      status(`${error.message}；状态查询将在两秒后继续。不要重复启动识别。`);
      timer=setTimeout(()=>poll(token),2000);
    }
  }
  $('recognition-start').addEventListener('click', async () => {
    if (busy || !prepared) return;
    retained=candidatePreparedId===prepared.id ? structuredClone(candidate) : null;
    busy=true; candidate=null; $('recognition-result').replaceChildren(); controls();
    try {
      job=await api('start', {preparedId:prepared.id, segmentIds:selectedIds()});
      recognitionAttempted=true;
      clearTimeout(timer); await poll(++generation);
    } catch(error) { busy=false; candidate=retained; resultView(candidate); status(error.message); controls(); }
  });
  $('recognition-cancel').addEventListener('click', async () => {
    if (!job || !busy) return;
    try { job=await api(`jobs/${job.id}/cancel`,{}); controls(); status('已请求取消；不会再启动后续模型调用。已发出的调用仍可能计费。'); }
    catch(error) { status(error.message); }
  });
  async function accept(action) {
    if(busy||!candidate?.measures.length)return;
    try{
      await apply(structuredClone(candidate),action==='replace'?target:null,action==='append');
      const current=Number($('pdf-page').value);
      if(action!=='replace'&&pdfSession&&current<pdfSession.pageCount){
        await loadPdfPage(current+1);
      }else $('recognition-dialog').close();
    }catch(error){status(error.message);}
  }
  $('recognition-manual').addEventListener('click',async()=>{
    if(busy||analysing||!image||target)return;
    try{
      await attachManual(structuredClone(image));
      const current=Number($('pdf-page').value);
      if(pdfSession&&current<pdfSession.pageCount)await loadPdfPage(current+1);
      else $('recognition-dialog').close();
    }catch(error){status(error.message);}
  });
  $('recognition-apply').addEventListener('click',()=>accept('new'));
  $('recognition-append').addEventListener('click',()=>accept('append'));
  $('recognition-replace').addEventListener('click',()=>accept('replace'));
  $('recognition-close').addEventListener('click',()=>{
    $('api-key').value=''; $('recognition-dialog').close();
  });
  $('recognition-dialog').addEventListener('cancel',()=>{ $('api-key').value=''; });
  return async function open(options=null) {
    $('recognition-dialog').showModal();
    $('recognition-file').value='';
    try {
      await config();
      if (options && !busy && !analysing) {
        pdfSession=null;$('pdf-page-controls').hidden=true;
        image=options.page;box=options.box;target=options.target;prepared=null;candidate=null;activeSegmentId=null;recognitionAttempted=false;manualDrawing=false;manualBox=null;
        $('recognition-mode').value='region';$('recognition-file').value='';
        $('recognition-result').replaceChildren();segments();manualControls(); status('已框选当前小节。分析后识别，检查候选再决定是否替换。');
      }
      controls();
    } catch(error) { status(error.message); }
  };
}
