import {chromium} from 'playwright';
import assert from 'node:assert/strict';

const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
page.on('pageerror',error=>errors.push(error.message));
const create=async title=>{
  await page.locator('#new-score').click();
  await page.locator('#new-score-title').fill(title);
  await page.locator('#new-score-form button[type=submit]').click();
  await page.waitForFunction(name=>document.querySelector('#score-title').value===name,title);
};
const draft=title=>page.locator('[data-draft-id]').filter({hasText:title});
try{
  await page.goto('http://127.0.0.1:8765');
  await page.waitForFunction(()=>document.querySelector('#score-title').value.length>0);
  await create('待删除暂存甲');
  await page.locator('[data-empty-measure][data-string="5"]').click();
  await page.locator('#edit-fret').fill('0');
  await page.locator('#apply-note').click();
  await page.waitForFunction(()=>document.querySelector('#save-status').textContent.includes('已在本机暂存'));
  await create('待删除暂存乙');
  await page.waitForFunction(()=>document.querySelector('#save-status').textContent.includes('已在本机暂存'));
  await page.locator('#open-library').click();
  await draft('待删除暂存甲').waitFor();
  assert.equal(await draft('待删除暂存甲').count(),1);
  assert.equal(await draft('待删除暂存乙').count(),1);
  const firstId=await draft('待删除暂存甲').getAttribute('data-draft-id');
  page.once('dialog',dialog=>dialog.dismiss());
  await page.locator(`[data-delete-draft-id="${firstId}"]`).click();
  assert.equal(await draft('待删除暂存甲').count(),1);
  page.once('dialog',dialog=>dialog.accept());
  await page.locator(`[data-delete-draft-id="${firstId}"]`).click();
  await page.waitForFunction(id=>!document.querySelector(`[data-draft-id="${id}"]`),firstId);
  assert.equal(await page.locator('#score-title').inputValue(),'待删除暂存乙');
  const secondId=await draft('待删除暂存乙').getAttribute('data-draft-id');
  page.once('dialog',dialog=>dialog.accept());
  await page.locator(`[data-delete-draft-id="${secondId}"]`).click();
  await page.waitForFunction(()=>document.querySelector('#score-title').value==='未命名乐谱');
  await page.locator('#library-close').click();
  await page.reload();
  await page.waitForFunction(()=>document.querySelector('#score-title').value.length>0);
  await page.locator('#open-library').click();
  assert.equal(await page.locator(`[data-draft-id="${firstId}"]`).count(),0);
  assert.equal(await page.locator(`[data-draft-id="${secondId}"]`).count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS: draft deletion can be canceled, removes inactive/active drafts, and stays deleted after reload.');
}finally{await browser.close();}
