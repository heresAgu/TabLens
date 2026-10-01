import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {control} from './controls.mjs';
import {readFile} from 'node:fs/promises';

const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page=await browser.newPage({viewport:{width:1440,height:900},acceptDownloads:true}),errors=[],records=new Map();
page.on('pageerror',error=>errors.push(error.message));
let serial=0;
await page.route('**/api/library**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;let body,status=200;
  if(request.method()==='POST'){
    const value=request.postDataJSON(),old=records.get(value.score.id);
    if(old&&old.record.revision!==value.revision){status=409;body={error:'文件已在其他窗口修改，请另存为'};}
    else{const record={id:value.score.id,revision:String(++serial),title:value.score.title,filename:value.score.title+'.tablens.json',modifiedAt:new Date().toISOString(),measures:value.score.measures.length,notes:value.score.measures.flatMap(m=>m.events).flatMap(e=>e.notes).length};records.set(value.score.id,{record,score:value.score});body={directory:'测试乐谱库',record};}
  }else if(path==='/api/library')body={directory:'测试乐谱库',records:[...records.values()].map(value=>value.record)};
  else body=records.get(path.split('/').at(-1));
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
});
try{
  await page.goto(process.env.TABLENS_TEST_URL??'http://127.0.0.1:8765');await page.waitForFunction(()=>document.querySelector('#score-title').value==='Duvet');
  await page.locator('#new-score').click();await page.locator('#new-score-title').fill('原创测试');await page.locator('#new-score-form button[type=submit]').click();
  assert.equal(await page.locator('.measure-card').count(),1);assert.equal(await page.locator('.source-panel').isVisible(),false);
  await page.locator('[data-empty-measure][data-string="6"]').click();await control(page,'#edit-fret').fill('0');await control(page,'#apply-note').click();
  await page.locator('.tab-cell[data-string="1"]').click();await control(page,'#edit-fret').fill('3');await control(page,'#apply-note').click();
  await control(page,'#edit-duration').selectOption('1/4');assert.equal(await page.locator('.has-note').count(),2);
  await control(page,'#measure-copy').click();assert.equal(await page.locator('.measure-card').count(),2);assert.equal(await page.locator('.has-note').count(),4);
  await control(page,'#measure-before').click();assert.equal(await page.locator('.measure-card').count(),3);
  await control(page,'#measure-delete').click();assert.equal(await page.locator('.measure-card').count(),2);
  await page.locator('#undo').click();assert.equal(await page.locator('.measure-card').count(),3);await page.locator('#redo').click();
  await page.locator('#save-file').click();await page.waitForFunction(()=>document.querySelector('#save-status').textContent.includes('✓'));
  const id=[...records.keys()][0];assert.equal(records.get(id).score.measures[0].events[0].notes.length,2);
  await page.reload();await page.waitForFunction(()=>document.querySelector('#score-title').value==='原创测试');assert.match(await page.locator('#save-status').textContent(),/✓/);
  await control(page,'#edit-fret').fill('7');await control(page,'#apply-note').click();assert.match(await page.locator('#save-status').textContent(),/未保存/);
  await page.locator('#new-score').click();await page.locator('#new-score-title').fill('第二首');await page.locator('#new-score-form button[type=submit]').click();
  await page.locator('#open-library').click();await page.locator(`[data-draft-id="${id}"]`).click();assert.equal(await page.locator('#score-title').inputValue(),'原创测试');assert.match(await page.locator('#save-status').textContent(),/未保存/);
  assert.equal(await page.locator('.has-note').first().locator('.fret-number').textContent(),'7');
  await page.locator('#save-file').click();await page.waitForFunction(()=>document.querySelector('#save-status').textContent.includes('✓'));
  assert.equal(records.size,1);assert.equal(records.get(id).score.measures[0].events[0].notes[0].fret,7);
  await page.locator('#save-as').click();await page.locator('#save-as-title').fill('独立副本');await page.locator('#save-as-confirm').click();await page.waitForFunction(()=>document.querySelector('#score-title').value==='独立副本');assert.equal(records.size,2);
  await page.locator('#open-library').click();await page.locator(`[data-library-id="${id}"]`).click();await page.waitForFunction(()=>document.querySelector('#score-title').value==='原创测试');
  await control(page,'#measure-copy').click();
  for(let i=0;i<12;i++)await control(page,'#measure-copy').click();
  const top=await page.locator('.editor-panel').boundingBox();await page.locator('#tab-view').evaluate(element=>element.scrollTop=element.scrollHeight);
  const after=await page.locator('.editor-panel').boundingBox();assert.equal(after.y,top.y);assert.equal(await page.evaluate(()=>window.scrollY),0);
  const scrollBefore=await page.locator('#tab-view').evaluate(element=>element.scrollTop);
  await page.locator('.measure-card').last().locator('.has-note').last().click();
  assert.ok(Math.abs(await page.locator('#tab-view').evaluate(element=>element.scrollTop)-scrollBefore)<2,'selecting a later note must preserve the TAB scroll position');
  await page.locator('.measure-card').last().locator('[data-position]').first().click();
  assert.ok(Math.abs(await page.locator('#tab-view').evaluate(element=>element.scrollTop)-scrollBefore)<2,'selecting a later position must not jump to the first bar');
  await page.locator('.measure-card').last().locator('[data-rhythm]').first().click();
  await page.locator('.rhythm-menu [data-duration="1/8"]').click();
  assert.ok(Math.abs(await page.locator('#tab-view').evaluate(element=>element.scrollTop)-scrollBefore)<2,'editing later rhythm must preserve the TAB scroll position');
  assert.ok(await page.locator('#edit-fret').isVisible()||await page.locator('[data-editor-tab="note"]').isVisible());
  await page.locator('[data-editor-tab="note"]').click();assert.ok((await page.locator('#apply-note').boundingBox()).y<900);
  records.get(id).record.revision='external-change';await page.locator('#save-file').click();await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('保存失败'));
  assert.match(await page.locator('#save-status').textContent(),/未保存/);
  await page.locator('#image-input').setInputFiles({name:'reference.png',mimeType:'image/png',buffer:await readFile('duvet.png')});
  await page.waitForFunction(()=>!document.querySelector('#source-view').hidden);
  assert.equal(await page.locator('#source-view image').count(),1);assert.equal(await page.locator('.source-focus').count(),0);
  await page.locator('.measure-card').first().locator('.has-note').first().click();assert.equal(await page.locator('#source-empty').isVisible(),true);
  await page.locator('.measure-card').last().locator('.has-note').first().click();assert.equal(await page.locator('#source-view image').count(),1);
  const sourceTop=(await page.locator('.source-panel').boundingBox()).y;
  await page.locator('#tab-view').evaluate(element=>element.scrollTop=0);assert.equal((await page.locator('.source-panel').boundingBox()).y,sourceTop);
  await page.screenshot({path:'app/.runtime/tablens-workspace.png'});assert.deepEqual(errors,[]);
  console.log('PASS: blank composition, chords, measure editing, library save/reopen, independent save-as, recoverable drafts, conflict protection and fixed inspector.');
}catch(error){console.log('UI diagnostics:',await page.locator('#library-status').textContent(),await page.locator('#library-list').textContent(),errors);throw error;}
finally{await browser.close();}
