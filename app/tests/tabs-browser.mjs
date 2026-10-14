import {chromium} from 'playwright';
import assert from 'node:assert/strict';

const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page=await browser.newPage({viewport:{width:1440,height:900}});
const errors=[];page.on('pageerror',error=>errors.push(error.message));
const records=new Map();let revision=0;
await page.route('**/api/library**',async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname;
  let result;
  if(path==='/api/library/save'){
    const input=request.postDataJSON(),score=input.score;
    const id=input.recordId??`test-${++revision}`;
    const record={id,title:score.title,filename:`${score.title}.tablens.json`,revision:String(++revision),
      modifiedAt:new Date().toISOString(),measures:score.measures.length,notes:0};
    records.set(id,{record,score});result={directory:'测试乐谱库',record};
  }else if(path==='/api/library')result={directory:'测试乐谱库',records:[...records.values()].map(value=>value.record)};
  else result=records.get(path.split('/').at(-1));
  await route.fulfill({status:result?200:404,contentType:'application/json',body:JSON.stringify(result??{error:'未找到'})});
});
const tab=title=>page.locator('.document-tab').filter({has:page.locator('.document-tab-main',{hasText:title})});
const create=async title=>{
  await page.locator('#new-score').click();await page.locator('#new-score-title').fill(title);
  await page.locator('#new-score-form button[type="submit"]').click();
  await page.waitForFunction(value=>document.querySelector('#score-title').value===value,title);
};
try{
  await page.goto(process.env.TABLENS_TEST_URL||'http://127.0.0.1:8765');
  await page.waitForFunction(()=>document.querySelector('#score-title').value.length>0);
  await create('标签测试 A');
  await page.locator('#tempo').fill('96');
  await create('标签测试 B');
  assert.equal(await tab('标签测试 A').count(),1);
  await tab('标签测试 A').locator('.document-tab-main').click();
  assert.equal(await page.locator('#tempo').inputValue(),'96');
  await page.locator('#tempo').fill('105');
  await tab('标签测试 B').locator('.document-tab-main').click();
  await tab('标签测试 A').locator('.document-tab-main').click();
  await page.locator('#undo').click();assert.equal(await page.locator('#tempo').inputValue(),'96');
  await page.locator('#redo').click();assert.equal(await page.locator('#tempo').inputValue(),'105');
  await page.keyboard.press('Control+s');
  await page.waitForFunction(()=>document.querySelector('#save-status').textContent.includes('已保存到乐谱库'));
  assert.equal(await tab('标签测试 A').locator('.document-dirty').isVisible(),false);
  await tab('标签测试 A').locator('.document-tab-close').click();
  assert.equal(await tab('标签测试 A').count(),0);
  await page.locator('#files-toggle').click();
  await page.locator('#files-library-list .file-entry',{hasText:'标签测试 A'}).click();
  await tab('标签测试 A').waitFor();
  assert.equal(await tab('标签测试 A').count(),1);
  await tab('标签测试 B').locator('.document-tab-close').click();
  await page.locator('[data-close-choice="draft"]').click();
  await tab('标签测试 B').waitFor({state:'detached'});
  assert.equal(await tab('标签测试 B').count(),0);
  await page.locator('#files-draft-list .file-entry',{hasText:'标签测试 B'}).click();
  assert.equal(await tab('标签测试 B').count(),1);
  await tab('标签测试 B').locator('.document-tab-close').click();
  await page.locator('[data-close-choice="discard"]').click();
  await tab('标签测试 B').waitFor({state:'detached'});
  assert.equal(await tab('标签测试 B').count(),0);
  await create('标签测试 C');
  await tab('标签测试 C').locator('.document-tab-close').click();
  await page.locator('[data-close-choice="cancel"]').click();
  assert.equal(await tab('标签测试 C').count(),1);
  await tab('标签测试 C').locator('.document-tab-close').click();
  await page.locator('[data-close-choice="save"]').click();
  await tab('标签测试 C').waitFor({state:'detached'});
  assert.equal(await records.size,2);
  await page.reload();
  await page.waitForFunction(()=>document.querySelector('#score-title').value.length>0);
  assert.equal(await tab('标签测试 A').count(),1);
  assert.equal(await tab('标签测试 B').count(),0);
  await page.locator('#files-toggle').click();
  assert.equal(await page.locator('#files-draft-list .file-entry',{hasText:'标签测试 B'}).count(),0);
  if(process.env.TABLENS_SCREENSHOT)await page.screenshot({path:process.env.TABLENS_SCREENSHOT});
  assert.deepEqual(errors,[]);
  console.log('PASS: tabs, per-score undo, Ctrl+S, saved reopen, draft close/reopen/discard and reload restore.');
}finally{await browser.close();}
