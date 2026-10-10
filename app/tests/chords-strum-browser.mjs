import {chromium} from 'playwright';
import assert from 'node:assert/strict';

const browser = await chromium.launch({headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page = await browser.newPage({viewport: {width: 1360, height: 900}});
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(process.env.TABLENS_TEST_URL || 'http://127.0.0.1:8765');
  await page.waitForFunction(() => document.querySelector('#score-title').value.length > 0);
  const draft = {
    format: 'tablens.agent.v1',
    metadata: {title: 'Chord Strum UI Test', tempo_bpm: 80, time_signature: [4, 4], capo: 0},
    measures: [{number: 1, events: [{duration: '1/4', notes: [{string: 3, fret: 0}]}]}]
  };
  await page.locator('#file-input').setInputFiles({
    name: 'chord-strum-agent.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(draft))
  });
  await page.waitForFunction(() => document.querySelector('#score-title').value === 'Chord Strum UI Test');
  await page.locator('[data-editor-tab="note"]').click();
  await page.locator('#chord-preset').selectOption('C');
  await page.locator('#apply-chord').click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('tablens.workspace.v1')).measures[0].events[0].notes.length === 5);
  assert.equal(await page.locator('#tab-view .chord-name').evaluate(node => node.firstChild.textContent), 'C');
  await page.locator('[data-editor-tab="rhythm"]').click();
  await page.locator('#strum-direction').selectOption('down');
  await page.locator('#strum-speed').selectOption('0.28');
  let saved = await page.evaluate(() => JSON.parse(localStorage.getItem('tablens.workspace.v1')));
  assert.deepEqual(saved.measures[0].events[0].strum, {direction: 'down', spreadBeats: 0.28});
  assert.equal(await page.locator('#tab-view .strum-marker').textContent(), '↓');
  await page.locator('#preview').click();
  await page.waitForFunction(() => document.querySelector('#sound-status').textContent.includes('已就绪'));
  await page.locator('#stop').click();
  await page.locator('[data-editor-tab="note"]').click();
  await page.locator('#copy-chord').click();
  saved = await page.evaluate(() => JSON.parse(localStorage.getItem('tablens.workspace.v1')));
  assert.equal(saved.measures[0].events.length, 2);
  assert.equal(saved.measures[0].events[1].duration, null);
  assert.equal(saved.measures[0].events[1].notes.length, 5);
  assert.equal(saved.measures[0].events[1].chordName, 'C');
  assert.equal(saved.measures[0].events[1].strum, undefined);
  assert.equal(await page.locator('#tab-view .chord-name').count(), 1);
  await page.locator('#tab-view [data-chord-diagram]').first().click();
  assert.match(await page.locator('.chord-popover').textContent(), /常见指型参考/);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.chord-popover').count(), 0);
  await page.locator('#tab-view [data-position]').last().click();
  await page.locator('#tab-view [data-strum-action="down"]').click();
  saved=await page.evaluate(() => JSON.parse(localStorage.getItem('tablens.workspace.v1')));
  assert.equal(saved.measures[0].events[1].strum.direction,'down');
  assert.equal(await page.locator('#tab-view .strum-marker').count(), 2);
  await page.keyboard.press('ArrowUp');
  saved=await page.evaluate(() => JSON.parse(localStorage.getItem('tablens.workspace.v1')));
  assert.equal(saved.measures[0].events[1].strum.direction,'up');
  await page.locator('#tab-view [data-strum-action=""]').click();
  saved=await page.evaluate(() => JSON.parse(localStorage.getItem('tablens.workspace.v1')));
  assert.equal(saved.measures[0].events[1].strum,undefined);
  await page.locator('[data-editor-tab="note"]').click();
  await page.locator('#chord-label').fill('Emadd11(no5)/G');
  await page.locator('#chord-label').dispatchEvent('change');
  assert.equal(await page.locator('#tab-view .chord-name').count(),2);
  const visual=await page.locator('#tab-view .measure-card').first().evaluate(card=>{
    const labels=[...card.querySelectorAll('.chord-name')].map(node=>node.getBoundingClientRect());
    const arrow=card.querySelector('.strum-marker').getBoundingClientRect();
    const staff=card.querySelector('.string-line').getBoundingClientRect();
    return {labels:labels.map(r=>({left:r.left,right:r.right,bottom:r.bottom})),arrowTop:arrow.top,staffTop:staff.top};
  });
  assert.ok(visual.labels[0].right<visual.labels[1].left);
  assert.ok(visual.labels.every(label=>label.bottom<visual.arrowTop),JSON.stringify(visual));
  assert.ok(visual.arrowTop<visual.staffTop);
  const cursor=await page.evaluate(async()=>{
    const {updatePlayhead}=await import('/tab.js');
    const view=document.querySelector('#tab-view');
    const ids=JSON.parse(localStorage.getItem('tablens.workspace.v1')).measures[0].events.map(event=>event.id);
    updatePlayhead(view,ids[0],1);
    const end=Number(view.querySelector('.playhead[visibility="visible"]').getAttribute('x1'));
    updatePlayhead(view,ids[1],0);
    const start=Number(view.querySelector('.playhead[visibility="visible"]').getAttribute('x1'));
    updatePlayhead(view,null);
    return {end,start};
  });
  assert.equal(cursor.end,cursor.start);
  if(process.env.TABLENS_SCREENSHOT)await page.screenshot({path:process.env.TABLENS_SCREENSHOT});
  assert.deepEqual(errors, []);
  console.log('PASS: chord labels, diagram, direct strum controls, cursor spacing and chord editor.');
} finally {
  await browser.close();
}
