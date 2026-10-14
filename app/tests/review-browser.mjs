import {chromium} from 'playwright';
import assert from 'node:assert/strict';

const base=process.env.TABLENS_TEST_URL||'http://127.0.0.1:8765';
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page=await browser.newPage({viewport:{width:1440,height:900},acceptDownloads:true});
const errors=[];page.on('pageerror',error=>errors.push(error.message));
try{
  await page.goto(base);
  await page.waitForFunction(()=>document.querySelector('#score-title').value.length>0);
  const fixture={schema:'tablens.score',version:1,id:'review-browser',title:'校对流程测试',
    tempo:80,timeSignature:[1,4],capo:0,tuningMidi:[64,59,55,50,45,40],sources:[],
    measures:[{id:'measure-review',number:1,agentImported:true,issues:['请核对原谱'],events:[
      {id:'event-known',kind:'notes',duration:'1/8',issues:[],notes:[{id:'note-known',string:2,fret:1,source:null}]},
      {id:'event-uncertain',kind:'notes',duration:null,issues:[],notes:[{id:'note-uncertain',string:1,fret:null,source:null}]}
    ]}]};
  const upload=value=>page.locator('#file-input').setInputFiles({name:'review.tablens.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});
  await upload(fixture);
  await page.waitForFunction(()=>document.querySelector('#score-title').value==='校对流程测试');
  await page.locator('.review-panel summary').click();
  assert.match(await page.locator('#review-summary').textContent(),/1 节未核对/);
  assert.equal(await page.locator('.review-confirm').isDisabled(),true);
  await page.screenshot({path:'app/.runtime/review-panel.png'});
  await page.locator('#review-next').click();
  assert.equal(await page.locator('#tab-view .selected-note').getAttribute('data-note'),'note-uncertain');
  await page.locator('.review-issue').filter({hasText:'1 弦：品位待确认'}).click();
  assert.equal(await page.locator('#tab-view .selected-note').getAttribute('data-note'),'note-uncertain');
  await page.locator('#edit-fret').fill('3');
  await page.locator('#apply-note').click();
  await page.locator('.review-issue').filter({hasText:'第 2 个位置：节奏待设置'}).click();
  assert.equal(await page.locator('#tab-view .active-measure').count(),1);
  await page.locator('#edit-duration').selectOption('1/8');
  assert.equal(await page.locator('.review-confirm').isEnabled(),true);
  await page.locator('.review-confirm').click();
  assert.match(await page.locator('#review-summary').textContent(),/0 节未核对/);
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('tablens.workspace.v1')));
  assert.equal(typeof saved.measures[0].reviewedSnapshot,'string');

  await page.locator('#tab-view [data-note="note-uncertain"]').click();
  await page.locator('[data-editor-tab="note"]').click();
  await page.locator('#edit-fret').fill('4');
  await page.locator('#apply-note').click();
  assert.match(await page.locator('#review-summary').textContent(),/1 节未核对/);
  assert.match(await page.locator('#review-issues').textContent(),/修改后待复核/);
  await page.locator('#undo').click();
  assert.match(await page.locator('#review-summary').textContent(),/0 节未核对/);
  const download=page.waitForEvent('download');
  await page.locator('#export-file').click();
  const stream=await (await download).createReadStream();
  const chunks=[];for await(const chunk of stream)chunks.push(chunk);
  const exported=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  assert.equal(typeof exported.measures[0].reviewedSnapshot,'string');
  await upload(exported);
  await page.waitForFunction(()=>document.querySelector('#score-title').value==='校对流程测试');
  assert.match(await page.locator('#review-summary').textContent(),/0 节未核对/);
  assert.deepEqual(errors,[]);
  console.log('PASS: review issues navigate to exact notes, block premature confirmation, persist review and reopen after undo.');
}finally{await browser.close();}
