// Recognition is a candidate workflow: nothing edits the score until Apply.
import {renderTab} from './tab.js';
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
  reader.onerror = () => reject(new Error('无法读取图片')); reader.readAsDataURL(file);
});

export function recognitionDialog(apply) {
  let image = null, box = null, prepared = null, job = null, candidate = null, target = null;
  let busy = false, analysing = false, drag = null, generation = 0, timer = null, candidateSelection = null;
  let retained = null, candidatePreparedId = null;
  const status = message => { $('recognition-status').textContent = message; };
  const selectedIds = () => [...$('recognition-segments').querySelectorAll('input:checked')].map(input => input.value);
  function controls() {
    $('recognition-start').disabled = busy || analysing || !prepared || !selectedIds().length;
    $('recognition-prepare').disabled = busy || analysing || !image;
    $('recognition-file').disabled = busy || analysing;
    $('recognition-mode').disabled = busy || analysing;
    $('recognition-cancel').disabled = !busy || job?.state === 'cancelling';
    $('recognition-apply').disabled = busy || !candidate?.measures.length;
    $('recognition-replace').disabled = busy || !target || candidate?.measures.length !== 1;
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
      svg.append(node('rect', {x:a,y:b,width:c-a,height:d-b,class:segment.readable?'import-segment':'import-unsupported'}));
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
  }
  function segments() {
    $('recognition-segments').replaceChildren();
    for (const segment of prepared?.segments ?? []) {
      const label = document.createElement('label'), input = document.createElement('input');
      input.type = 'checkbox'; input.value = segment.id; input.checked = segment.readable;
      input.dataset.readable = String(segment.readable); input.disabled = !segment.readable;
      input.addEventListener('change', controls);
      label.append(input, document.createTextNode(` 第 ${segment.number} 段 · ${segment.columns.length} 个候选位置${segment.readable ? '' : ' · 需人工处理'}`));
      label.title = segment.issues.join('；'); $('recognition-segments').append(label);
    }
    controls(); paint();
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
  $('recognition-file').addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file) return;
    try {
      if (file.size > 20_000_000) throw new Error('图片请控制在20MB以内');
      const dataUrl = await readImage(file), decoded = new Image(); decoded.src = dataUrl; await decoded.decode();
      if (decoded.naturalWidth * decoded.naturalHeight > 24_000_000) throw new Error('图片请控制在2400万像素以内');
      image = {dataUrl, name:file.name, width:decoded.naturalWidth, height:decoded.naturalHeight};
      prepared=null; candidate=null; box=null; target=null; $('recognition-result').replaceChildren();
      segments(); status('可以整图分析，也可以先切换到框选区域后拖动选择。');
    } catch(error) { status(error.message); }
  });
  $('recognition-mode').addEventListener('change', () => {
    prepared=null;candidate=null;retained=null;candidatePreparedId=null;
    $('recognition-result').replaceChildren();segments();
  });
  const point = event => {
    const matrix = $('recognition-image').getScreenCTM();
    if (!matrix || !image) return null;
    const p = new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse());
    return [Math.max(0,Math.min(image.width,p.x)),Math.max(0,Math.min(image.height,p.y))];
  };
  $('recognition-image').addEventListener('pointerdown', event => {
    if (busy || analysing || !image || $('recognition-mode').value !== 'region') return;
    drag=point(event); $('recognition-image').setPointerCapture(event.pointerId);
    prepared=null; candidate=null; retained=null; candidatePreparedId=null;
    $('recognition-result').replaceChildren();segments();
  });
  $('recognition-image').addEventListener('pointermove', event => {
    if (!drag) return; const p=point(event);
    box=[Math.min(drag[0],p[0]),Math.min(drag[1],p[1]),Math.max(drag[0],p[0]),Math.max(drag[1],p[1])]; paint();
  });
  $('recognition-image').addEventListener('pointerup', () => { drag=null; controls(); });
  $('recognition-prepare').addEventListener('click', async () => {
    if (!image || busy || analysing) return;
    if ($('recognition-mode').value === 'region' && (!box || box[2]-box[0]<10 || box[3]-box[1]<10)) {
      status('先在图片上拖动，框选要识别的小节'); return;
    }
    analysing=true; candidate=null; retained=null; candidatePreparedId=null;
    $('recognition-result').replaceChildren();controls(); status('正在定位六条弦线、小节线和下方符干…');
    try {
      prepared = await api('prepare', {imageDataUrl:image.dataUrl, name:image.name,
        box:$('recognition-mode').value==='region'?box:null, sourceId:image.id});
      segments(); status(`定位到 ${prepared.segments.length} 段。请核对绿色边框并勾选；无符干或被截断的段落不能自动识别。`);
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
      p.textContent=`第 ${measure.number} 段：${measure.events.length} 个位置、${measure.events.reduce((sum,e)=>sum+e.notes.length,0)} 个音符、${measure.events.filter(e=>e.notes.length>1).length} 个同时弹组合。节奏待设置。`;
      list.append(p);
      for (const issue of [...(measure.issues??[]),...measure.events.flatMap(e=>e.issues??[])]) {
        const item=document.createElement('p'); item.className='error'; item.textContent=issue; list.append(item);
      }
    }
    if (value?.measures.length) {
      const p=document.createElement('p');p.textContent='这是候选结果，尚未改动当前乐谱。请打开后对照原图检查弦号、品位、顺序和同时弹组合。';list.append(p);
      const preview=document.createElement('div'); preview.id='candidate-tab';
      renderTab(preview,value,null);
      preview.addEventListener('click',event=>{
        const cell=event.target.closest('[data-event]');if (!cell) return;
        candidateSelection={eventId:cell.dataset.event,noteId:cell.dataset.note||null};
        renderTab(preview,value,candidateSelection);paint();
      });
      list.append(preview);
    }
    candidateSelection=null;paint();
  }
  async function poll(token) {
    if (token!==generation || !job) return;
    try {
      job=await api(`jobs/${job.id}`); if (token!==generation) return;
      busy=['running','cancelling'].includes(job.state);
      if (retained && job.result) {
        const measures=new Map(retained.measures.map(m=>[m.recognition?.segmentId ?? m.number,m]));
        for (const measure of job.result.measures) measures.set(measure.recognition?.segmentId ?? measure.number,measure);
        candidate={...structuredClone(retained),measures:[...measures.values()].sort((a,b)=>a.number-b.number),
          issues:[...new Set([...(retained.issues??[]),...(job.result.issues??[])])]};
      } else candidate=job.result ?? retained;
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
      clearTimeout(timer); await poll(++generation);
    } catch(error) { busy=false; candidate=retained; resultView(candidate); status(error.message); controls(); }
  });
  $('recognition-cancel').addEventListener('click', async () => {
    if (!job || !busy) return;
    try { job=await api(`jobs/${job.id}/cancel`,{}); controls(); status('已请求取消；不会再启动后续模型调用。已发出的调用仍可能计费。'); }
    catch(error) { status(error.message); }
  });
  async function accept(local) {
    if (busy || !candidate?.measures.length) return;
    try { await apply(structuredClone(candidate),local?target:null); $('recognition-dialog').close(); }
    catch(error) { status(error.message); }
  }
  $('recognition-apply').addEventListener('click',()=>accept(false));
  $('recognition-replace').addEventListener('click',()=>accept(true));
  $('recognition-close').addEventListener('click',()=>{
    $('api-key').value=''; $('recognition-dialog').close();
  });
  $('recognition-dialog').addEventListener('cancel',()=>{ $('api-key').value=''; });
  return async function open(options=null) {
    $('recognition-dialog').showModal();
    try {
      await config();
      if (options && !busy && !analysing) {
        image=options.page;box=options.box;target=options.target;prepared=null;candidate=null;
        $('recognition-mode').value='region';$('recognition-file').value='';
        $('recognition-result').replaceChildren();segments(); status('已框选当前小节。分析后识别，检查候选再决定是否替换。');
      }
      controls();
    } catch(error) { status(error.message); }
  };
}
