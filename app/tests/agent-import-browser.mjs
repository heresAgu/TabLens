import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const base=process.env.TABLENS_TEST_URL||'http://127.0.0.1:8765';
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page=await browser.newPage({viewport:{width:1360,height:900}});
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
const markdown=await readFile(new URL('../../AGENT_IMPORT_TEMPLATE.md',import.meta.url),'utf8');
const raw=JSON.parse(markdown.match(/~~~json\s*([\s\S]*?)~~~/)[1]);
const upload=async value=>page.locator('#file-input').setInputFiles({
  name:'agent-score.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))
});
try {
  await page.goto(base);
  await page.waitForFunction(()=>document.querySelector('#score-title').value.length>0);
  await page.locator('#import-image').click();
  assert.equal(await page.locator('a[download="AGENT_IMPORT_TEMPLATE.md"]').count(),1);
  const templateResponse=await page.request.get(base+'/api/agent-template');
  assert.equal(templateResponse.status(),200);
  assert.match(await templateResponse.text(),/tablens.agent.v1/);
  await page.locator('#recognition-close').click();
  await upload(raw);
  await page.waitForFunction(()=>document.querySelector('#score-title').value==='示例曲名');
  assert.equal(await page.locator('#tab-view .tab-cell.has-note').count(),7);
  assert.deepEqual(await page.locator('#tab-view .strum-marker').allTextContents(),['↓','↑']);
  const imported=await page.evaluate(()=>JSON.parse(localStorage.getItem('tablens.workspace.v1')));
  assert.deepEqual(imported.measures[0].events.slice(0,2).map(event=>event.strum),[
    {direction:'down',spreadBeats:0.08,speedMode:'auto'},
    {direction:'up',spreadBeats:0.08,speedMode:'auto'}
  ]);
  await page.locator('#tab-view [data-position]').first().click();
  await page.locator('[data-editor-tab="rhythm"]').click();
  assert.equal(await page.locator('#strum-speed').inputValue(),'auto');
  assert.match(await page.locator('#strum-speed option[value="auto"]').textContent(),/快扫/);
  await page.locator('#strum-speed').selectOption('0.16');
  const manual=await page.evaluate(()=>JSON.parse(localStorage.getItem('tablens.workspace.v1')));
  assert.deepEqual(manual.measures[0].events[0].strum,{direction:'down',spreadBeats:0.16});
  await page.locator('#strum-speed').selectOption('auto');
  assert.equal(await page.locator('#strum-speed').inputValue(),'auto');
  await page.locator('#preview').click();
  await page.waitForFunction(()=>document.querySelector('#sound-status').textContent.includes('已就绪'));
  await page.locator('#stop').click();

  const isolated=structuredClone(raw);
  isolated.metadata.title='自动速度规则';
  isolated.measures[0].events[0].duration='1/4';
  delete isolated.measures[0].events[1].strum;
  isolated.measures[0].events[2].duration='1/8';
  await upload(isolated);
  await page.waitForFunction(()=>document.querySelector('#score-title').value==='自动速度规则');
  await page.locator('#tab-view [data-position]').first().click();
  await page.locator('[data-editor-tab="rhythm"]').click();
  assert.match(await page.locator('#strum-speed option[value="auto"]').textContent(),/标准/);
  await page.locator('#edit-duration').selectOption('1/8');
  assert.match(await page.locator('#strum-speed option[value="auto"]').textContent(),/快扫/);
  assert.match(await page.locator('#toast').textContent(),/Agent 乐谱已打开/);
  assert.match(await page.locator('#play-status').textContent(),/已可播放/);

  const withImage=structuredClone(raw);
  withImage.metadata.title='双小节原图';
  withImage.measures.push({...structuredClone(withImage.measures[0]),number:2});
  await upload(withImage);
  await page.waitForFunction(()=>document.querySelector('#score-title').value==='双小节原图');
  const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
  const attach=()=>page.locator('#image-input').setInputFiles({name:'reference.png',mimeType:'image/png',buffer:image});
  await attach();
  await page.waitForFunction(()=>{
    const score=JSON.parse(localStorage.getItem('tablens.workspace.v1')||'null');
    return score?.sources?.length===1 && score.measures[0]?.manualReference;
  });
  await page.locator('[data-select-measure]').nth(1).click();
  await attach();
  await page.waitForFunction(()=>{
    const score=JSON.parse(localStorage.getItem('tablens.workspace.v1')||'null');
    return score?.measures[1]?.manualReference;
  });
  const linked=await page.evaluate(()=>JSON.parse(localStorage.getItem('tablens.workspace.v1')));
  assert.equal(linked.sources.length,1);
  assert.equal(linked.measures[0].source.pageId,linked.measures[1].source.pageId);

  const uncertain=structuredClone(raw);
  uncertain.metadata.title='待核对';
  uncertain.measures[0].events[0].duration=null;
  uncertain.measures[0].events[0].notes[0].fret=null;
  await upload(uncertain);
  await page.waitForFunction(()=>document.querySelector('#score-title').value==='待核对');
  await page.waitForFunction(()=>document.querySelector('.review-panel').open);
  assert.match(await page.locator('#review-issues').textContent(),/品位待确认|节奏待设置/);

  const invalid=structuredClone(uncertain);
  invalid.measures[0].events[0].notes[1].string=6;
  await upload(invalid);
  await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('第6弦重复'));
  assert.equal(await page.locator('#score-title').inputValue(),'待核对');
  assert.deepEqual(errors,[]);
  console.log('PASS: Agent JSON opens as playable TAB, uncertainty is shown, and invalid input leaves the score intact.');
} finally {
  await browser.close();
}
