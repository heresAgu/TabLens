import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page=await browser.newPage({viewport:{width:1440,height:900},acceptDownloads:true}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const cell=(event,string)=>page.locator(`.tab-cell[data-event="${event}"][data-string="${string}"]`);
const snapshot=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('tablens.workspace.v1')));
try{
  await page.goto(process.env.TABLENS_TEST_URL??'http://127.0.0.1:8765');await page.waitForFunction(()=>document.querySelector('#score-title').value==='Duvet');
  const raw={metadata:{title:'谱上编辑验证',tempo_bpm:80,time_signature:[4,4]},measures:[{number:2,events:[
    {duration:'1/8',notes:[{string:1,fret:3},{string:6,fret:0}]},
    {duration:'1/8',notes:[{string:2,fret:5}]},
    {duration:'1/16',notes:[{string:3,fret:7}]},{duration:'1/16',notes:[{string:4,fret:2}]},
    {duration:'1/8',notes:[{string:1,fret:12}]},{duration:'1/4',notes:[{string:2,fret:8}]},
    {duration:'1/4',kind:'rest',notes:[]}]}]};
  await page.locator('#file-input').setInputFiles({name:'direct.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(raw))});
  await page.waitForFunction(()=>document.querySelector('#score-title').value==='谱上编辑验证');
  assert.match(await page.locator('.measure-head').first().textContent(),/第 1 小节/);assert.equal((await snapshot()).measures[0].originalNumber,2);
  assert.equal(await page.locator('.rhythm-beam').count(),3);
  await cell('m1-e1',1).click();await page.keyboard.type('12');assert.equal(await page.locator('#inline-fret').inputValue(),'12');await page.keyboard.press('Enter');
  assert.equal(await cell('m1-e1',1).locator('.fret-number').textContent(),'12');assert.equal((await snapshot()).measures[0].events[0].notes.length,2);
  await page.keyboard.press('Backspace');assert.equal(await cell('m1-e1',1).locator('.fret-number').count(),0);assert.equal((await snapshot()).measures[0].events[0].notes.length,1);
  await page.keyboard.type('0');await page.keyboard.press('Enter');assert.equal(await cell('m1-e1',1).locator('.fret-number').textContent(),'0');
  await page.keyboard.type('9');await cell('m1-e1',6).click();
  assert.equal(await cell('m1-e1',1).locator('.fret-number').textContent(),'9');assert.equal(await page.locator('#edit-string').inputValue(),'6');
  await cell('m1-e1',3).click();await page.keyboard.type('24');await page.keyboard.press('Escape');assert.equal(await cell('m1-e1',3).locator('.fret-number').count(),0);
  await page.keyboard.type('37');await page.keyboard.press('Enter');assert.ok(await page.locator('#inline-fret').isVisible());await page.keyboard.press('Escape');
  await cell('m1-e1',3).click();await page.keyboard.type('24');await page.keyboard.press('Enter');assert.equal((await snapshot()).measures[0].events.length,7);
  assert.equal((await snapshot()).measures[0].events[0].notes.length,3);
  await page.locator('[data-position="m1-e1"]').click();assert.ok(await page.locator('.position-actions').isVisible());
  await page.keyboard.press('Backspace');assert.equal((await snapshot()).measures[0].events.length,6);assert.equal(await cell('m1-e1',1).count(),0);
  await page.locator('#undo').click();assert.equal((await snapshot()).measures[0].events[0].notes.length,3);
  await page.locator('[data-position="m1-e1"]').click();await page.locator('[data-direct-action="position-before"]').click();
  assert.equal((await snapshot()).measures[0].events.length,8);
  const positionLabels=await page.locator('.measure-card').first().locator('.position-label').evaluateAll(nodes=>
    nodes.map(node=>({text:node.textContent,opacity:getComputedStyle(node).opacity})));
  assert.deepEqual(positionLabels.map(label=>label.text),Array.from({length:8},(_,index)=>String(index+1)));
  assert.ok(positionLabels.every(label=>Number(label.opacity)===1),'new and existing position numbers stay visible');
  await page.locator('[data-direct-action="delete-position"]').click();assert.equal((await snapshot()).measures[0].events.length,7);
  await page.locator('[data-rhythm="m1-e1"]').click();await page.locator('.rhythm-menu [data-duration="1/16"]').click();
  assert.equal((await snapshot()).measures[0].events[0].duration,'1/16');assert.equal((await snapshot()).measures[0].events[0].notes.length,3);
  await page.locator('[data-rhythm="m1-e1"]').click();await page.keyboard.press('Escape');assert.equal(await page.locator('.rhythm-menu').count(),0);
  await page.locator('.measure-insertion button').first().click();let value=await snapshot();assert.deepEqual(value.measures.map(m=>m.number),[1,2]);assert.equal(value.measures[1].originalNumber,2);
  await page.locator('.measure-remove').first().click();assert.equal((await snapshot()).measures[0].number,1);
  await page.locator('.measure-insertion button').last().click();assert.deepEqual((await snapshot()).measures.map(m=>m.number),[1,2]);
  await page.locator('[data-empty-measure][data-string="4"]').click();await page.keyboard.type('2');await page.keyboard.press('Enter');
  assert.equal((await snapshot()).measures[1].events[0].notes[0].string,4);assert.equal((await snapshot()).measures[1].events[0].notes[0].fret,2);
  await page.locator('.measure-remove').last().click();
  // Native text editing must not delete a position or a whole chord.
  await page.locator('#score-title').fill('文字输入123');await page.locator('#score-title').press('Home');await page.keyboard.press('Backspace');assert.equal((await snapshot()).measures[0].events.length,7);
  await page.locator('#score-title').press('Tab');
  const downloadPromise=page.waitForEvent('download');await page.locator('#export-file').click();const download=await downloadPromise;
  const exported=JSON.parse(await readFile(await download.path(),'utf8'));assert.equal(exported.measures[0].events[0].notes.length,3);assert.equal(exported.measures[0].events[0].duration,'1/16');
  await page.reload();await page.waitForFunction(()=>document.querySelector('#score-title').value==='文字输入123');assert.equal((await snapshot()).measures[0].originalNumber,2);
  // A single click must take keyboard focus back from the inspector.
  await page.locator('#edit-fret').focus();await cell('m1-e1',6).click();
  assert.equal(await page.locator('#inline-fret').count(),0);await page.keyboard.press('Backspace');
  assert.equal((await snapshot()).measures[0].events[0].notes.length,2);await page.locator('#undo').click();
  await cell('m1-e1',1).click();assert.equal(await page.locator('#inline-fret').count(),0);
  await page.waitForTimeout(250);await cell('m1-e1',1).click();assert.equal(await page.locator('#inline-fret').count(),1);
  const inputBox=await page.locator('#inline-fret').boundingBox(),cellBox=await cell('m1-e1',1).boundingBox();
  assert.ok(inputBox.x>=cellBox.x-1&&inputBox.y>=cellBox.y-1&&inputBox.y+inputBox.height<=cellBox.y+cellBox.height+1,'fret editor stays inside the selected string cell');
  await page.screenshot({path:'app/.runtime/tablens-inline-fret.png'});
  await page.locator('#inline-fret').fill('16');await page.keyboard.press('Backspace');assert.equal(await page.locator('#inline-fret').inputValue(),'1');await page.keyboard.type('5');assert.equal((await snapshot()).measures[0].events[0].notes.length,3);await page.keyboard.press('Enter');assert.equal(await cell('m1-e1',1).locator('.fret-number').textContent(),'15');
  await page.locator('#undo').click();
  await cell('m1-e1',2).click();assert.equal(await cell('m1-e1',2).getAttribute('class').then(value=>value.includes('selected-cell')),true);
  assert.equal(await page.locator('.position-selection').count(),0);assert.equal(await page.locator('.position-actions').count(),0);
  await page.screenshot({path:'app/.runtime/tablens-empty-cell.png'});
  await page.locator('[data-column-position="m1-e1"]').click();assert.equal(await page.locator('.position-actions').count(),1);
  await page.locator('[data-rhythm="m1-e1"]').click();assert.equal(await page.locator('.position-actions').count(),0);assert.equal(await page.locator('.selected-rhythm').count(),1);
  await page.keyboard.press('Escape');await page.keyboard.press('Backspace');assert.equal((await snapshot()).measures[0].events.length,7);
  await page.locator('.measure-head').first().locator('span').first().click();assert.equal(await page.locator('.selected-measure').count(),1);
  assert.equal(await page.locator('.selected-cell').count(),0);assert.equal(await page.locator('.event-selection').count(),0);
  assert.equal(await page.locator('#edit-fret').isDisabled(),true);assert.equal(await page.locator('[data-editor-tab=measure]').getAttribute('aria-selected'),'true');
  await page.keyboard.press('Backspace');assert.equal((await snapshot()).measures[0].events.length,7);
  await cell('m1-e1',1).click();
  const svg=page.locator('.tab-staff').first(),svgBox=await svg.boundingBox();
  await svg.click({position:{x:svgBox.width-10,y:100}});assert.equal(await page.locator('.selected-measure').count(),1);
  await page.locator('[data-position="m1-e1"]').click();await page.screenshot({path:'app/.runtime/tablens-direct.png'});
  assert.deepEqual(errors,[]);console.log('PASS: numbering/source references, boundary buttons, inline two-digit frets, open strings, Escape/validation, note vs column deletion, rhythm selection, beams, undo and persistence.');
}finally{await browser.close();}
