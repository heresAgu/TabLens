import {chromium} from 'playwright';
import assert from 'node:assert/strict';

const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page=await browser.newPage({viewport:{width:1360,height:850}});
const errors=[];page.on('pageerror',error=>errors.push(error.message));
const fixture={metadata:{title:'键盘导航测试',tempo_bpm:80,time_signature:[4,4]},measures:[
  {number:1,events:[{duration:'1/8',notes:[{string:1,fret:3}]},{duration:'1/8',notes:[{string:2,fret:5}]}]},
  {number:2,events:[{duration:'1/8',notes:[{string:1,fret:7}]},{duration:'1/8',notes:[{string:1,fret:9}]}]},
  {number:3,events:[]}
]};
try{
  await page.goto(process.env.TABLENS_TEST_URL||'http://127.0.0.1:8765');
  await page.waitForFunction(()=>document.querySelector('#score-title').value.length>0);
  await page.locator('#file-input').setInputFiles({name:'keyboard.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});
  await page.waitForFunction(()=>document.querySelector('#score-title').value==='键盘导航测试');
  const ids=await page.evaluate(()=>JSON.parse(localStorage.getItem('tablens.workspace.v1')).measures.flatMap(measure=>measure.events.map(event=>event.id)));
  assert.equal(ids.length,4);
  await page.locator(`.position-selector[data-position="${ids[0]}"]`).click();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('.position-selector.active').getAttribute('data-position'),ids[1]);
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('.position-selector.active').getAttribute('data-position'),ids[2]);
  await page.keyboard.press('ArrowLeft');
  assert.equal(await page.locator('.position-selector.active').getAttribute('data-position'),ids[1]);
  await page.locator(`.tab-cell[data-event="${ids[0]}"][data-string="1"]`).click();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator(`.tab-cell.selected-cell[data-event="${ids[1]}"][data-string="1"]`).count(),1);
  await page.keyboard.type('0');await page.keyboard.press('Enter');
  assert.equal(await page.locator(`.tab-cell[data-event="${ids[1]}"][data-string="1"] .fret-number`).textContent(),'0');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator(`.tab-cell.selected-note[data-event="${ids[2]}"][data-string="1"]`).count(),1);
  await page.locator(`.tab-cell[data-event="${ids[0]}"][data-string="1"]`).click();
  await page.keyboard.type('1');
  assert.equal(await page.locator('#inline-fret').isVisible(),true);
  await page.keyboard.press('ArrowLeft');
  assert.equal(await page.locator(`.tab-cell.selected-cell[data-event="${ids[0]}"][data-string="1"]`).count(),1);
  await page.keyboard.press('Escape');
  const cards=page.locator('.measure-card');
  await cards.nth(0).locator('.measure-head').click({position:{x:45,y:15}});
  assert.equal(await page.locator('.measure-card.selected-measure').count(),1);
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('.measure-card.selected-measure').getAttribute('data-measure'),await cards.nth(1).getAttribute('data-measure'));
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('.measure-card.selected-measure').getAttribute('data-measure'),await cards.nth(2).getAttribute('data-measure'));
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('.measure-card.selected-measure').getAttribute('data-measure'),await cards.nth(2).getAttribute('data-measure'));
  await page.locator('#score-title').focus();await page.keyboard.press('ArrowLeft');
  assert.equal(await page.locator('.measure-card.selected-measure').getAttribute('data-measure'),await cards.nth(2).getAttribute('data-measure'));
  await page.locator('#layout-mode [data-mode="review"]').focus();await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#layout-mode').getAttribute('data-active'),'practice');
  assert.deepEqual(errors,[]);
  console.log('PASS: position and measure arrow navigation, cross-measure movement, same-string focus, native input and mode keys.');
}finally{await browser.close();}
