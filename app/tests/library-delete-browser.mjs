import {chromium} from 'playwright';
import assert from 'node:assert/strict';

const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page=await browser.newPage({viewport:{width:1440,height:900}});
const errors=[],records=new Map();
page.on('pageerror',error=>errors.push(error.message));
let serial=0,scoreId;
await page.route('**/api/library**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname,method=request.method();
  let status=200,body;
  if(method==='POST'&&path==='/api/library/save'){
    const value=request.postDataJSON(),score=value.score;
    scoreId=score.id;
    const record={id:'a'.repeat(24),title:score.title,filename:score.title+'.tablens.json',
      revision:String(++serial).padStart(64,'0'),modifiedAt:new Date().toISOString(),
      measures:score.measures.length,notes:score.measures.flatMap(m=>m.events).flatMap(e=>e.notes).length};
    records.set(record.id,{record,score});body={directory:'C:\\TabLens\\乐谱库',record};
  }else if(method==='POST'&&path==='/api/library/delete'){
    const value=request.postDataJSON(),existing=records.get(value.recordId);
    if(!existing||existing.record.revision!==value.revision){
      status=409;body={error:'乐谱已在其他窗口修改，请刷新乐谱库后再删除'};
    }else{
      records.delete(value.recordId);
      body={scoreId:existing.score.id,title:existing.score.title,trash:'C:\\TabLens\\乐谱库\\.回收站\\测试'};
    }
  }else if(path==='/api/library'){
    body={directory:'C:\\TabLens\\乐谱库',records:[...records.values()].map(value=>value.record)};
  }else body=records.get(path.split('/').at(-1));
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
});
try{
  await page.goto('http://127.0.0.1:8765');
  await page.locator('#new-score').click();
  await page.locator('#new-score-title').fill('待删除测试谱');
  await page.locator('#new-score-form button[type=submit]').click();
  await page.locator('#save-file').click();
  await page.waitForFunction(()=>document.querySelector('#save-status').textContent.includes('✓'));
  await page.locator('#open-library').click();
  assert.equal(await page.locator('[data-library-id]').count(),1);
  assert.equal(await page.locator('#library-directory').textContent(),'C:\\TabLens\\乐谱库');
  page.once('dialog',dialog=>dialog.dismiss());
  await page.locator('[data-delete-library-id]').click();
  assert.equal(await page.locator('[data-library-id]').count(),1);
  records.get('a'.repeat(24)).record.revision='b'.repeat(64);
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('[data-delete-library-id]').click();
  await page.waitForFunction(()=>document.querySelector('#library-status').textContent.includes('其他窗口修改'));
  assert.equal(await page.locator('[data-library-id]').count(),1);
  await page.locator('#library-close').click();
  await page.locator('#open-library').click();
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('[data-delete-library-id]').click();
  await page.waitForFunction(()=>document.querySelector('#library-status').textContent.includes('已移至回收站'));
  assert.equal(records.size,0);
  assert.equal(await page.locator('[data-library-id]').count(),0);
  assert.equal(await page.locator('#score-title').inputValue(),'未命名乐谱');
  await page.locator('#library-close').click();
  await page.locator('#open-library').click();
  assert.equal(await page.locator('[data-draft-id="'+scoreId+'"]').count(),0);
  await page.locator('#library-close').click();
  await page.locator('#import-image').click();
  assert.match(await page.locator('.file-picker-hint').textContent(),/浏览器记住上次打开的位置/);
  assert.deepEqual(errors,[]);
  console.log('PASS: cancel, stale revision refusal, trash deletion, current-score switch, draft cleanup and file picker hint.');
}finally{await browser.close();}