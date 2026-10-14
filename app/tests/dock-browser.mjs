import {chromium} from 'playwright';
import assert from 'node:assert/strict';

const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
page.on('pageerror',error=>errors.push(error.message));
const fixture={schema:'tablens.score',version:1,id:'dock-test',title:'停靠布局测试',tempo:80,
  timeSignature:[4,4],capo:0,tuningMidi:[64,59,55,50,45,40],
  sources:[{id:'p',name:'source.png',width:1,height:1,
    dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='}],
  measures:[{id:'bar',number:1,source:{pageId:'p',box:[0,0,1,1]},events:[
    {id:'position',kind:'notes',duration:'1/4',notes:[{id:'note',string:1,fret:5}]}
  ]}]};
const boxes=async()=>Object.fromEntries(await Promise.all(
  ['score','source','editor'].map(async name=>[name,await page.locator(`.${name}-panel`).boundingBox()])));
try{
  await page.goto(process.env.TABLENS_TEST_URL??'http://127.0.0.1:8765');
  await page.waitForFunction(()=>document.querySelector('#score-title')?.value?.length>0);
  await page.locator('#file-input').setInputFiles({name:'dock.tablens.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});
  await page.waitForFunction(()=>document.querySelector('#score-title').value==='停靠布局测试');
  await page.locator('#settings-open').click();
  await page.locator('#layout-reset').click();
  await page.locator('#settings-close').click();
  assert.equal(await page.locator('.workspace').getAttribute('data-dock-side'),'left');
  let b=await boxes();
  assert.ok(b.score.x<b.source.x&&b.score.height>b.source.height+b.editor.height-30);

  await page.locator('.editor-panel .panel-dock-handle').click();
  await page.locator('.dock-zone[data-dock-side="right"][data-dock-slot="full"]').click();
  b=await boxes();
  assert.ok(b.editor.x>b.score.x&&b.source.y<b.score.y,'working area can dock full-height on the right');
  await page.locator('#dock-layout-preset').click();
  assert.equal(await page.locator('.workspace').getAttribute('data-dock-side'),'left');

  await page.locator('#dock-layout-preset').click();
  assert.equal(await page.locator('.workspace').getAttribute('data-dock-side'),'right');
  b=await boxes();
  assert.ok(b.source.x<b.editor.x&&b.score.x<b.editor.x&&b.source.y<b.score.y);
  assert.ok(b.editor.height>b.source.height+b.score.height-30);
  await page.screenshot({path:'app/.runtime/dock-right.png'});
  const widthBefore=b.editor.width;
  await page.locator('#workspace-resizer').focus();
  await page.keyboard.press('ArrowLeft');
  b=await boxes();
  assert.ok(b.editor.width>widthBefore+20);
  const heightBefore=b.source.height;
  await page.locator('#side-resizer').focus();
  await page.keyboard.press('ArrowDown');
  b=await boxes();
  assert.ok(b.source.height>heightBefore+20);

  await page.locator('.source-panel .panel-dock-handle').click();
  assert.equal(await page.locator('#dock-overlay').isVisible(),true);
  await page.locator('.dock-zone[data-dock-side="left"][data-dock-slot="bottom"]').click();
  assert.equal(await page.locator('.source-panel').getAttribute('data-dock-slot'),'bottom');
  b=await boxes();
  assert.ok(b.score.y<b.source.y&&b.editor.x>b.source.x);

  const grip=await page.locator('.score-panel .panel-dock-handle').boundingBox();
  await page.mouse.move(grip.x+grip.width/2,grip.y+grip.height/2);
  await page.mouse.down();await page.mouse.move(grip.x+grip.width/2+18,grip.y+grip.height/2+18,{steps:4});
  await page.locator('#dock-overlay:visible').waitFor();
  const zone=await page.locator('.dock-zone[data-dock-side="right"][data-dock-slot="top"]').boundingBox();
  await page.mouse.move(zone.x+zone.width/2,zone.y+zone.height/2,{steps:8});await page.mouse.up();
  assert.equal(await page.locator('.score-panel').getAttribute('data-dock-slot'),'top');
  assert.equal(await page.locator('.workspace').getAttribute('data-dock-side'),'left');
  await page.locator('[data-note="note"]').click();
  assert.match(await page.locator('#editor-position').textContent(),/1弦 5品/);

  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('tablens.layout.v1')));
  await page.reload();
  await page.waitForFunction(()=>document.querySelector('#score-title')?.value?.length>0);
  assert.equal(await page.locator('.score-panel').getAttribute('data-dock-slot'),saved.dockSlots.top==='score'?'top':'bottom');
  await page.locator('[data-mode="practice"]').click();
  assert.equal(await page.locator('.editor-panel').isVisible(),false);
  assert.equal(await page.locator('#dock-layout-preset').isVisible(),false);
  await page.locator('[data-mode="review"]').click();
  assert.equal(await page.locator('.editor-panel').isVisible(),true);
  await page.locator('#settings-open').click();
  await page.locator('#layout-reset').click();
  await page.locator('#settings-close').click();
  assert.equal(await page.locator('.workspace').getAttribute('data-dock-side'),'left');
  assert.equal(await page.locator('.score-panel').getAttribute('data-dock-slot'),'full');
  await page.setViewportSize({width:800,height:900});
  assert.equal(await page.locator('#dock-layout-preset').isVisible(),false);
  assert.equal(await page.locator('.score-panel').isVisible(),true);
  await page.setViewportSize({width:1440,height:900});
  assert.equal(await page.locator('#dock-layout-preset').isVisible(),true);
  const blank={...fixture,id:'no-source-dock',title:'无原图谱',sources:[],
    measures:[{id:'blank',number:1,events:[],issues:[]}]};
  await page.locator('#file-input').setInputFiles({name:'blank.tablens.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(blank))});
  await page.waitForFunction(()=>document.querySelector('#score-title').value==='无原图谱');
  assert.equal(await page.locator('#dock-layout-preset').isVisible(),false);
  assert.equal(await page.locator('.editor-panel').isVisible(),true);
  assert.deepEqual(errors,[]);
  console.log('PASS: review docking, resize, click/drag, edit, persistence, practice, narrow/no-source fallbacks and reset.');
}finally{await browser.close();}
