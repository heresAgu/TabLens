import {control} from './controls.mjs';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';

const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page=await browser.newPage({viewport:{width:1440,height:1080}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try {
  await page.goto('http://127.0.0.1:8765');await page.waitForFunction(()=>document.querySelector('#score-title').value==='Duvet');
  const before=await control(page,'#score-count').textContent();
  await control(page,'#import-image').click();
  await control(page,'#recognition-file').setInputFiles('lullaby.jpg');
  await page.waitForFunction(()=>!document.querySelector('#recognition-prepare').disabled);
  await control(page,'#api-settings').evaluate(el=>{el.open=false;});
  await control(page,'#recognition-mode').selectOption('region');
  const dragPoints=await control(page,'#recognition-image').evaluate(svg=>{
    const matrix=svg.getScreenCTM();
    return [[90,560],[720,760]].map(([x,y])=>{const p=new DOMPoint(x,y).matrixTransform(matrix);return {x:p.x,y:p.y};});
  });
  await page.mouse.move(dragPoints[0].x,dragPoints[0].y);await page.mouse.down();
  await page.mouse.move(dragPoints[1].x,dragPoints[1].y,{steps:8});await page.mouse.up();
  assert.equal(await page.locator('.import-selection').count(),1);
  await control(page,'#recognition-prepare').click();
  await page.waitForFunction(()=>document.querySelectorAll('#recognition-segments input').length===1);
  await control(page,'#recognition-mode').selectOption('whole');
  await control(page,'#recognition-prepare').click();
  await page.waitForFunction(()=>document.querySelectorAll('#recognition-segments input').length===8);
  assert.equal(await control(page,'#recognition-segments input:checked').count(),8);
  assert.match(await control(page,'#recognition-estimate').textContent(),/17 次/);
  // No key means no model request. Preparing geometry never mutates the score.
  await control(page,'#recognition-start').click();
  await page.waitForFunction(()=>document.querySelector('#recognition-status').textContent.includes('密钥'));
  assert.equal(await control(page,'#score-count').textContent(),before);
  const preparedImage=await control(page,'#recognition-image image').getAttribute('href');
  const p=await page.request.post('http://127.0.0.1:8765/api/recognition/prepare',{data:{imageDataUrl:preparedImage,name:'lullaby.jpg'}});
  const prepared=await p.json();const segment=prepared.segments[1];
  const result={schema:'tablens.score',version:1,id:'mock-score',title:'接口候选测试',tempo:80,timeSignature:[4,4],capo:6,
    tuningMidi:[64,59,55,50,45,40],sources:[prepared.source],measures:[{id:'mock-measure',number:2,source:{pageId:prepared.source.id,box:segment.box},issues:[],events:[
      {id:'mock-e1',kind:'notes',duration:null,issues:[],notes:[{id:'mock-n1',string:1,fret:0,source:{pageId:prepared.source.id,box:[segment.columns[0]-8,segment.stringY[0]-10,segment.columns[0]+10,segment.stringY[0]+10]}},{id:'mock-n2',string:5,fret:2,source:{pageId:prepared.source.id,box:[segment.columns[0]-8,segment.stringY[4]-10,segment.columns[0]+10,segment.stringY[4]+10]}}]},
      {id:'mock-e2',kind:'notes',duration:null,issues:[],notes:[{id:'mock-n3',string:2,fret:12,source:null}]}
    ]}]};
  const job={id:'mock-job',state:'complete',calls:3,maximumCalls:3,completed:1,total:1,usage:{inputTokens:12,outputTokens:24},errors:[],segments:[{id:segment.id,number:2,state:'complete'}],result};
  await page.route('**/api/recognition/start',route=>route.fulfill({json:job}));
  await page.route('**/api/recognition/jobs/mock-job',route=>route.fulfill({json:job}));
  await control(page,'#recognition-start').click();
  await page.waitForFunction(()=>!document.querySelector('#recognition-apply').disabled);
  assert.equal(await control(page,'#score-count').textContent(),before);
  await control(page,'#candidate-tab .has-note').first().click();
  assert.equal(await control(page,'#recognition-image .source-focus,#recognition-image .source-chord').count(),2);
  await mkdir('app/.runtime',{recursive:true});
  await control(page,'#recognition-dialog').screenshot({path:'app/.runtime/recognition-dialog.png'});
  await control(page,'#recognition-apply').click();
  await page.waitForFunction(()=>document.querySelector('#score-title').value==='接口候选测试');
  assert.equal(await control(page,'#score-title').inputValue(),'接口候选测试');
  assert.equal(await control(page,'#tab-view .has-note').count(),3);
  assert.equal(await control(page,'#source-view .source-chord,#source-view .source-focus').count(),2);
  const viewBox=await control(page,'#source-view').getAttribute('viewBox');
  assert.ok(Number(viewBox.split(' ')[1])>400,'original-image view should follow second staff');
  await control(page,'#split-position').click();
  assert.match(await control(page,'#score-count').textContent(),/3 个演奏位置/);
  await control(page,'#undo').click();
  assert.match(await control(page,'#score-count').textContent(),/2 个演奏位置/);
  await control(page,'#merge-position').click();
  assert.match(await control(page,'#score-count').textContent(),/1 个演奏位置/);
  await control(page,'#undo').click();
  await control(page,'#time-signature').fill('3/4');await control(page,'#time-signature').press('Tab');
  await control(page,'#batch-scope').selectOption('all');await control(page,'#apply-duration').click();
  assert.match(await control(page,'#tab-view .measure-state').textContent(),/不自动补齐/);
  await control(page,'#incomplete-measure').check();
  assert.equal(await control(page,'#tab-view .measure-state').textContent(),'节奏已设置');
  // Local candidate stays pending and refuses replacement after a manual edit.
  await control(page,'#retry-measure').click();await control(page,'#recognition-prepare').click();
  await page.waitForFunction(()=>document.querySelectorAll('#recognition-segments input').length===1);
  await control(page,'#recognition-start').click();await page.waitForFunction(()=>!document.querySelector('#recognition-replace').disabled);
  await control(page,'#recognition-close').click();
  await control(page,'#edit-fret').fill('7');await control(page,'#apply-note').click();
  await control(page,'#import-image').click();await control(page,'#recognition-replace').click();
  await page.waitForFunction(()=>document.querySelector('#recognition-status').textContent.includes('已经修改'));
  assert.equal(await control(page,'#edit-fret').inputValue(),'7');
  await control(page,'#recognition-close').click();
  const downloadEvent=page.waitForEvent('download');await control(page,'#export-file').click();
  const download=await downloadEvent;const saved=JSON.parse(await readFile(await download.path(),'utf8'));
  assert.ok(saved.sources[0].dataUrl);assert.equal(saved.measures[0].events[0].notes[0].fret,7);
  assert.equal(saved.timeSignature[0],3);
  await control(page,'#undo').click(); // Undo manual note edit.
  assert.equal(await control(page,'#edit-fret').inputValue(),'0');
  await control(page,'#file-input').setInputFiles({name:'saved.tablens.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(saved))});
  await page.waitForFunction(()=>document.querySelector('#edit-fret').value==='7');
  const illegal=await page.request.post('http://127.0.0.1:8765/api/recognition/config',{headers:{Origin:'https://unrelated.example'},data:{key:'mock'}});
  assert.equal(illegal.status(),403);
  // Retrying failed segments combines candidates without losing successful bars.
  await control(page,'#import-image').click();
  await control(page,'#recognition-file').setInputFiles('lullaby.jpg');
  await page.waitForFunction(()=>!document.querySelector('#recognition-prepare').disabled);
  await control(page,'#recognition-mode').selectOption('whole');
  await control(page,'#recognition-prepare').click();
  await page.waitForFunction(()=>document.querySelectorAll('#recognition-segments input').length===8);
  Object.assign(job,{state:'partial',completed:1,total:2,errors:['模拟第三段失败'],segments:[{id:'segment-2',state:'complete'},{id:'segment-3',state:'failed'}],result});
  await control(page,'#recognition-start').click();
  await page.waitForFunction(()=>document.querySelector('#recognition-status').textContent.includes('部分小节完成'));
  assert.equal(await control(page,'#recognition-segments input:checked').count(),1);
  const second=structuredClone(result);second.measures[0].number=3;second.measures[0].id='mock-m3';
  for (const e of second.measures[0].events){e.id+='-3';for(const n of e.notes)n.id+='-3';}
  Object.assign(job,{state:'complete',completed:1,total:1,errors:[],segments:[{id:'segment-3',state:'complete'}],result:second});
  await control(page,'#recognition-start').click();
  await page.waitForFunction(()=>document.querySelectorAll('#candidate-tab .measure-card').length===2);
  assert.equal(await control(page,'#candidate-tab .has-note').count(),6);
  assert.equal(await control(page,'#tab-view .measure-card').count(),1,'retry candidates must not change the open score');
  await control(page,'#recognition-close').click();
  assert.deepEqual(errors,[]);
  await mkdir('app/.runtime',{recursive:true});await page.screenshot({path:'app/.runtime/recognition-workspace.png',fullPage:true});
  console.log('PASS: image preparation, explicit API start, candidate apply, merge/split, multi-row source, conflict protection, timing warnings and portable save/reopen. No paid API calls.');
} finally {await browser.close();}
