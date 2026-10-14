import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {control} from './controls.mjs';

const browser = await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page = await browser.newPage({viewport:{width:1440,height:1050},acceptDownloads:true});
const errors = [];
page.on('pageerror',error=>errors.push(error.message));
try {
  await page.goto('http://127.0.0.1:8765');
  const score = {
    schema:'tablens.score',version:1,id:'ornaments-ui',title:'倚音推弦测试',
    tempo:80,timeSignature:[4,4],capo:0,tuningMidi:[64,59,55,50,45,40],
    sources:[],measures:[{id:'bar',number:1,authored:true,events:[
      {id:'a',kind:'notes',duration:'1/4',notes:[{id:'a1',string:1,fret:7},{id:'a2',string:6,fret:3}]},
      {id:'b',kind:'notes',duration:'1/4',notes:[{id:'b1',string:3,fret:9}]}
    ]}]
  };
  await page.locator('#file-input').setInputFiles({name:'ornaments.tablens.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(score))});
  await page.waitForFunction(()=>document.querySelector('#score-title').value==='倚音推弦测试');
  await page.locator('[data-event="a"][data-string="1"]').click();
  await control(page,'#grace-string').selectOption('2');
  await control(page,'#grace-fret').fill('5');
  await control(page,'#grace-articulation').selectOption('pick');
  await control(page,'#apply-grace').click();
  assert.equal(await page.locator('.grace-number').textContent(),'5');
  const graceAlignment=await page.locator('.grace-number').evaluate(node=>({
    grace:Number(node.getAttribute('y')),
    stringLine:Number(node.closest('svg').querySelectorAll('.string-line')[1].getAttribute('y1'))
  }));
  assert.equal(graceAlignment.grace-graceAlignment.stringLine,4,'倚音数字应位于指定弦线上');
  await page.evaluate(() => {
    window.__starts = [];
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function(when, ...args) {
      window.__starts.push(when);
      return start.call(this, when, ...args);
    };
  });
  await control(page,'#preview').click();
  await page.waitForTimeout(180);
  const graceStarts = await page.evaluate(() => window.__starts);
  assert.equal(graceStarts.length, 3, '倚音加双音和弦应触发三根独立弦');
  assert.ok(Math.max(...graceStarts) - Math.min(...graceStarts) > 0.08, '倚音应比主音提前发声');
  assert.deepEqual(errors,[]);
  await page.locator('[data-event="b"][data-string="3"]').click();
  await control(page,'#bend-semitones').selectOption('2');
  await control(page,'#bend-release').check();
  assert.match(await page.locator('.bend-marker').textContent(),/full/);
  await page.evaluate(() => { window.__starts = []; });
  await control(page,'#preview').click();
  await page.waitForTimeout(180);
  assert.equal(await page.evaluate(() => window.__starts.length), 1, '推弦只改变一颗音的音高，不能再次拨弦');
  assert.deepEqual(errors,[]);
  const downloadPromise=page.waitForEvent('download');
  await control(page,'#export-file').click();
  const download=await downloadPromise;
  const saved=JSON.parse(await readFile(await download.path(),'utf8'));
  assert.equal(saved.measures[0].events[0].notes[0].graceBefore.string,2);
  assert.equal(saved.measures[0].events[0].notes[0].graceBefore.fret,5);
  assert.equal(saved.measures[0].events[1].notes[0].bend.semitones,2);
  assert.equal(saved.measures[0].events[1].notes[0].bend.release,true);
  await page.locator('#file-input').setInputFiles({name:'saved.tablens.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(saved))});
  await page.waitForFunction(()=>document.querySelector('.grace-number')&&document.querySelector('.bend-marker'));
  assert.equal(await page.locator('.grace-number').textContent(),'5');
  await page.locator('[data-event="a"][data-string="1"]').click();
  await control(page,'#grace-string').selectOption('1');
  await control(page,'#grace-articulation').selectOption('slide');
  await control(page,'#apply-grace').click();
  await page.evaluate(() => { window.__starts = []; });
  await control(page,'#preview').click();
  await page.waitForTimeout(180);
  assert.equal(await page.evaluate(() => window.__starts.length),2,
    '滑入倚音和主音应使用同一根弦持续发声，另加和弦伴奏音');
  await control(page,'#play-selected').click();
  await page.waitForFunction(()=>document.querySelector('#play').textContent.includes('暂停'));
  await page.waitForTimeout(250);
  await control(page,'#stop').click();
  assert.deepEqual(errors,[]);
  console.log('PASS: cross-string grace and bend are editable, audible in preview, saved, reopened and playable.');
} finally {
  await browser.close();
}
