import {chromium} from 'playwright';
import assert from 'node:assert/strict';

const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],records=new Map();
page.on('pageerror',error=>errors.push(error.message));
let serial=0;
await page.route('**/api/library**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;
  let body;
  if(request.method()==='POST'&&path==='/api/library/save'){
    const value=request.postDataJSON(),score=value.score;
    const record={id:`record-${++serial}`,title:score.title,filename:score.title+'.tablens.json',
      revision:String(serial),modifiedAt:new Date().toISOString(),measures:score.measures.length,
      notes:score.measures.flatMap(m=>m.events).flatMap(e=>e.notes).length};
    records.set(record.id,{record,score});body={directory:'测试乐谱库',record};
  }else if(path==='/api/library')body={directory:'测试乐谱库',records:[...records.values()].map(item=>item.record)};
  else body=records.get(path.split('/').at(-1));
  await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
});
const readScore=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('tablens.workspace.v1')));
const setFret=async fret=>{
  await page.locator('#edit-fret').fill(String(fret));
  await page.locator('#apply-note').click();
  await page.waitForFunction(value=>JSON.parse(localStorage.getItem('tablens.workspace.v1')).measures[0].events[0].notes[0].fret===value,fret);
};
const create=async title=>{
  await page.locator('#new-score').click();
  await page.locator('#new-score-title').fill(title);
  await page.locator('#new-score-form button[type=submit]').click();
  await page.locator('[data-empty-measure][data-string="5"]').click();
  await setFret(0);
};
const upload=score=>page.locator('#file-input').setInputFiles({name:'source.tablens.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(score))});
try{
  await page.goto('http://127.0.0.1:8765');
  await page.waitForFunction(()=>document.querySelector('#score-title').value.length>0);
  await create('本地文件保护');
  const original=await readScore();
  await setFret(2);
  await page.waitForFunction(()=>document.querySelector('#save-status').textContent.includes('已在本机暂存'));
  await upload(original);
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('tablens.workspace.v1')).measures[0].events[0].notes[0].fret===0);
  await page.locator('#open-library').click();
  const recovery=page.locator('[data-draft-id]').filter({hasText:'本地文件保护 · 未保存修改（恢复）'});
  await recovery.waitFor();
  const recoveryId=await recovery.getAttribute('data-draft-id');
  assert.notEqual(recoveryId,original.id);
  await page.locator('#library-close').click();
  await upload(original);
  await page.locator('#open-library').click();
  await page.locator(`[data-draft-id="${recoveryId}"]`).waitFor();
  assert.equal(await page.locator('[data-draft-id]').filter({hasText:'本地文件保护 · 未保存修改（恢复）'}).count(),1);
  await page.locator(`[data-draft-id="${recoveryId}"]`).click();
  assert.equal((await readScore()).measures[0].events[0].notes[0].fret,2);
  await page.reload();
  await page.waitForFunction(()=>document.querySelector('#score-title').value.includes('未保存修改（恢复）'));
  assert.equal((await readScore()).measures[0].events[0].notes[0].fret,2);

  await create('乐谱库文件保护');
  await page.locator('#save-file').click();
  await page.waitForFunction(()=>document.querySelector('#save-status').textContent.includes('✓'));
  await setFret(3);
  await page.waitForFunction(()=>document.querySelector('#save-status').textContent.includes('已在本机暂存'));
  await page.locator('#open-library').click();
  await page.locator('[data-library-id]').filter({hasText:'乐谱库文件保护'}).click();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('tablens.workspace.v1')).measures[0].events[0].notes[0].fret===0);
  await page.locator('#open-library').click();
  const savedRecovery=page.locator('[data-draft-id]').filter({hasText:'乐谱库文件保护 · 未保存修改（恢复）'});
  await savedRecovery.waitFor();
  await savedRecovery.click();
  assert.equal((await readScore()).measures[0].events[0].notes[0].fret,3);
  assert.deepEqual(errors,[]);
  console.log('PASS: reopening local and saved library files preserves unsaved changes as independent recoverable drafts.');
}finally{await browser.close();}
