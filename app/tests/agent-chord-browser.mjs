import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const markdown=await readFile(new URL('../../AGENT_IMPORT_TEMPLATE.md',import.meta.url),'utf8');
const raw=JSON.parse(markdown.match(/~~~json\s*([\s\S]*?)~~~/)[1]);
raw.metadata.title='和弦符号待补指型';
raw.measures[0].events[0]={kind:'unknown',duration:'1/8',notes:[],chordName:'C',strum:{direction:'down'},
  uncertain_items:['原图为下扫，指型待确认']};
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
page.on('pageerror',error=>errors.push(error.message));
try{
  await page.goto('http://127.0.0.1:8765');
  await page.waitForFunction(()=>document.querySelector('#score-title').value.length>0);
  await page.locator('#file-input').setInputFiles({name:'chords.agent.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(raw))});
  await page.waitForFunction(()=>document.querySelector('#score-title').value==='和弦符号待补指型');
  assert.equal(await page.locator('#tab-view .chord-name').first().textContent(),'C');
  assert.equal(await page.locator('#tab-view .strum-trigger.pending').count(),1);
  assert.match(await page.locator('#review-issues').textContent(),/指型待确认/);
  await page.locator('#tab-view .chord-trigger').first().click();
  assert.equal(await page.locator('.chord-popover circle').count(),0);
  await page.keyboard.press('Escape');
  await page.locator('#tab-view [data-position]').first().click();
  await page.locator('[data-editor-tab="note"]').click();
  assert.equal(await page.locator('#chord-label').inputValue(),'C');
  assert.equal(await page.locator('#chord-label').isEnabled(),true);
  assert.equal(await page.locator('#strum-direction').isEnabled(),true);
  assert.equal(await page.locator('#strum-direction').inputValue(),'down');
  await page.locator('#chord-preset').selectOption('C');
  await page.locator('#apply-chord').click();
  const score=await page.evaluate(()=>JSON.parse(localStorage.getItem('tablens.workspace.v1')));
  const event=score.measures[0].events[0];
  assert.equal(event.chordName,'C');
  assert.equal(event.chordPending,undefined);
  assert.equal(event.strum.direction,'down');
  assert.deepEqual(event.notes.map(note=>[note.string,note.fret]),[[1,0],[2,1],[3,0],[4,2],[5,3]]);
  assert.equal(await page.locator('#tab-view .strum-trigger.pending').count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS: Agent chord names render before voicing is known, then users can complete notes and strum.');
}finally{await browser.close();}
