import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {control} from './controls.mjs';

const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page=await browser.newPage({viewport:{width:1440,height:900}});
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
await page.route('**/api/samples',route=>route.fulfill({contentType:'application/json',body:'[]'}));
await page.route('**/audio/guitar/manifest.json',route=>route.fulfill({status:404,body:'missing'}));
try{
  await page.goto('http://127.0.0.1:8765');
  await page.waitForFunction(()=>document.querySelector('#score-title').value==='未命名乐谱');
  assert.equal(await page.locator('#instrument').inputValue(),'synth');
  assert.equal(await page.locator('#sample-picker').isVisible(),false);
  await page.locator('[data-empty-measure][data-string="1"]').click();
  await control(page,'#edit-fret').fill('3');
  await control(page,'#apply-note').click();
  await control(page,'#edit-duration').selectOption('1/4');
  await page.locator('#play').click();
  await page.waitForFunction(()=>document.querySelector('#play').textContent.includes('暂停'));
  await page.locator('#stop').click();
  assert.deepEqual(errors,[]);
  console.log('PASS: a clone without private scores or guitar samples starts blank and plays with the synth.');
}finally{await browser.close();}
