import {chromium} from 'playwright';
import assert from 'node:assert/strict';

const now=Date.now();
const records=Array.from({length:34},(_,index)=>({
  id:`record-${index}`,title:`普通曲${String(index).padStart(2,'0')}`,
  modifiedAt:new Date(now-index*86400000).toISOString(),measures:2,notes:8
}));
records.push({id:'special-new',title:'夜航',modifiedAt:new Date(now-2*86400000).toISOString(),measures:1,notes:4});
records.push({id:'special-old',title:'旧歌',modifiedAt:new Date(now-200*86400000).toISOString(),measures:1,notes:4});
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page=await browser.newPage({viewport:{width:1280,height:740}}),errors=[];
page.on('pageerror',error=>errors.push(error.message));
await page.route('**/api/library',route=>route.fulfill({contentType:'application/json',
  body:JSON.stringify({directory:'测试乐谱库',records})}));
try{
  await page.goto('http://127.0.0.1:8765');
  await page.waitForFunction(()=>document.querySelector('#score-title').value.length>0);
  await page.locator('#new-score').click();
  await page.locator('#new-score-title').fill('暂存独有');
  await page.locator('#new-score-form button[type=submit]').click();
  await page.waitForFunction(()=>document.querySelector('#save-status').textContent.includes('已在本机暂存'));
  await page.locator('#open-library').click();
  await page.waitForFunction(()=>document.querySelectorAll('[data-library-id]').length===36);
  const heading=page.locator('#library-dialog .panel-heading'),before=await heading.boundingBox();
  const scrolled=await page.locator('#library-list').evaluate(node=>{node.scrollTop=node.scrollHeight;return node.scrollTop;});
  assert.ok(scrolled>100,'long library should scroll inside the list');
  const after=await heading.boundingBox();
  assert.equal(after.y,before.y);
  assert.equal(await page.locator('#library-close').isVisible(),true);
  await page.locator('#library-query').fill('夜航');
  assert.equal(await page.locator('.library-row:visible').count(),1);
  assert.equal(await page.locator('#library-list').evaluate(node=>node.scrollTop),0);
  await page.locator('#library-period').selectOption('7');
  assert.equal(await page.locator('.library-row:visible').count(),1);
  await page.locator('#library-query').fill('旧歌');
  assert.equal(await page.locator('.library-row:visible').count(),0);
  assert.equal(await page.locator('.library-no-results').isVisible(),true);
  await page.locator('#library-query').fill('暂存独有');
  assert.equal(await page.locator('.library-row:visible').count(),1);
  await page.locator('#library-period').selectOption('all');
  await page.locator('#library-query').fill('');
  await page.locator('#library-sort').selectOption('oldest');
  assert.match(await page.locator('#library-list .library-row').first().textContent(),/旧歌/);
  await page.locator('#library-close').click();
  assert.equal(await page.locator('#library-dialog').evaluate(dialog=>dialog.open),false);
  assert.deepEqual(errors,[]);
  console.log('PASS: library heading stays fixed; title, date, and sort filters work for saved scores and drafts.');
}finally{await browser.close();}
