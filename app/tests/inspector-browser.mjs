import {chromium} from 'playwright';
import assert from 'node:assert/strict';

const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
page.on('pageerror',error=>errors.push(error.message));
try{
  await page.goto(process.env.TABLENS_TEST_URL??'http://127.0.0.1:8765');
  await page.waitForFunction(()=>document.querySelector('#score-title')?.value?.length>0);
  assert.equal(await page.locator('body').getAttribute('data-score-density'),'compact');
  const compactHeight=Number(await page.locator('.tab-staff').first().getAttribute('height'));
  assert.ok(compactHeight<275);
  await page.locator('#score-density-toggle').click();
  assert.equal(await page.locator('.tab-staff').first().getAttribute('height'),'275');
  await page.locator('#score-density-toggle').click();
  assert.equal(Number(await page.locator('.tab-staff').first().getAttribute('height')),compactHeight);
  await page.locator('[data-mode="practice"]').click();
  assert.equal(await page.locator('.tab-staff').first().getAttribute('height'),'275');
  assert.equal(await page.locator('#score-density-toggle').isVisible(),false);
  await page.locator('[data-mode="review"]').click();

  const score={schema:'tablens.score',version:1,id:'inspector-test',title:'效果控件测试',
    tempo:80,timeSignature:[4,4],capo:0,tuningMidi:[64,59,55,50,45,40],
    sources:[{id:'p',name:'原图.png',width:1,height:1,dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='}],
    measures:[{id:'bar',number:1,source:{pageId:'p',box:[0,0,1,1]},events:[
      {id:'a',kind:'notes',duration:'1/4',notes:[{id:'a1',string:1,fret:5}]},
      {id:'b',kind:'notes',duration:'1/4',notes:[{id:'b1',string:1,fret:7}]},
      {id:'c',kind:'notes',duration:'1/4',notes:[{id:'c1',string:1,fret:9}]}
    ]}]};
  await page.locator('#file-input').setInputFiles({name:'inspector.tablens.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(score))});
  await page.waitForFunction(()=>document.querySelector('#score-title').value==='效果控件测试');
  assert.equal(await page.locator('.source-panel').isVisible(),true);
  await page.locator('[data-event="b"][data-string="1"]').click();
  assert.match(await page.locator('#editor-position').textContent(),/1弦 7品/);
  await page.locator('[data-editor-effect="connection"]').click();
  assert.equal(await page.locator('[data-effect-section="connection"]').evaluate(element=>element.open),true);
  await page.locator('#note-technique').selectOption('hammer');
  assert.match(await page.locator('[data-effect-section="connection"] .effect-state').textContent(),/击弦/);
  await page.locator('[data-event="c"][data-string="1"]').click();
  assert.equal(await page.locator('[data-effect-section="connection"]').evaluate(element=>element.open),true);
  assert.equal(await page.locator('#note-technique').inputValue(),'');
  const visible=await page.locator('[data-effect-section="connection"] summary').evaluate(element=>{
    const box=element.getBoundingClientRect(),pane=document.querySelector('.editor-content').getBoundingClientRect();
    return box.top>=pane.top&&box.bottom<=pane.bottom;
  });
  assert.ok(visible,'连续选音时正在编辑的技巧应留在可见区域');
  await page.locator('[data-editor-effect="bend"]').click();
  assert.equal(await page.locator('[data-effect-section="bend"]').evaluate(element=>element.open),true);
  assert.equal(await page.locator('[data-effect-section="connection"]').evaluate(element=>element.open),false);
  await page.screenshot({path:'app/.runtime/inspector-controls.png'});
  await page.locator('[data-editor-effect="basic"]').click();
  assert.equal(await page.locator('.editor-content').evaluate(element=>element.scrollTop),0);
  assert.equal(await page.locator('[data-effect-section="bend"]').evaluate(element=>element.open),false);
  await page.locator('[data-editor-tab="rhythm"]').hover();
  await page.locator('#ui-tooltip:visible').waitFor();
  assert.match(await page.locator('#ui-tooltip').textContent(),/时值、扫弦/);
  assert.deepEqual(errors,[]);
  console.log('PASS: compact review score, unaffected practice score, fixed effect controls, selection memory and tab help.');
}finally{await browser.close();}
