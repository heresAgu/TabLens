import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {control} from './controls.mjs';
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
page.on('pageerror',error=>errors.push(error.message));
await page.addInitScript(()=>{const Native=window.AudioContext;window.__audio=[];window.AudioContext=class extends Native{constructor(...args){super(...args);const record={context:this,gains:[]};window.__audio.push(record);const create=this.createGain.bind(this);this.createGain=()=>{const node=create();record.gains.push(node);return node;};}};});
const snapshot=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('tablens.workspace.v1')));
async function setRange(selector,value){const tab=await page.locator(selector).evaluate(node=>node.closest('[data-editor-page]')?.dataset.editorPage);if(tab)await page.locator(`[data-editor-tab="${tab}"]`).click();await page.locator(selector).evaluate((node,value)=>{node.value=value;node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));},value);}
try{
  await page.goto('http://127.0.0.1:8765');await page.waitForFunction(()=>document.querySelector('#score-title').value==='Duvet');
  await control(page,'#sample-picker').selectOption('lullaby');await page.waitForFunction(()=>document.querySelector('#score-title').value==='Lullaby');
  await setRange('#note-volume',25);let score=await snapshot();assert.equal(score.measures[0].events[0].notes[0].dynamics,25);assert.equal(score.measures[0].events[0].notes[1].dynamics,undefined);
  assert.equal(await page.locator('#note-dynamics').inputValue(),'custom');await page.locator('#undo').click();assert.equal((await snapshot()).measures[0].events[0].notes[0].dynamics,undefined);await page.locator('#redo').click();
  await control(page,'#note-volume-inherit').click();assert.equal(await page.locator('#note-dynamics').inputValue(),'inherit');
  await control(page,'#note-dynamics').selectOption('strong');assert.equal(await page.locator('#note-volume').inputValue(),'100');await setRange('#note-volume',24);
  await page.locator('[data-event="m1-e2"].has-note').first().click({modifiers:['Control']});await page.locator('[data-selection-volume-delta="10"]').click();
  score=await snapshot();assert.equal(score.measures[0].events[0].notes[0].dynamics,34);assert.equal(score.measures[0].events[1].notes[0].dynamics,80);assert.equal(score.measures[0].events[0].notes[1].dynamics,undefined);
  await page.locator('#selection-volume').fill('60');await page.locator('#selection-apply-volume').click();assert.equal((await snapshot()).measures[0].events[1].notes[0].dynamics,60);
  await page.locator('#selection-clear').click();await control(page,'#instrument').selectOption('synth');await control(page,'#metronome').check();await page.locator('#practice-close').click();
  const before=await snapshot();await setRange('#master-volume',35);await page.locator('#play').click();await page.waitForFunction(()=>document.querySelector('#play').textContent.includes('暂停'));
  await page.locator('#master-mute').click();await page.waitForTimeout(120);
  assert.equal(await page.locator('#master-mute').getAttribute('aria-pressed'),'true');await page.waitForFunction(()=>window.__audio[0].gains[0].gain.value<0.001);assert.match(await page.locator('#play').textContent(),/暂停/);
  await setRange('#master-volume',50);await page.locator('#master-mute').click();await page.waitForTimeout(100);
  await page.waitForFunction(()=>Math.abs(window.__audio[0].gains[0].gain.value-0.5)<0.001);assert.deepEqual(await snapshot(),before);await page.locator('#stop').click();
  await page.reload();await page.waitForFunction(()=>document.querySelector('#score-title').value==='Lullaby');assert.equal(await page.locator('#master-volume').inputValue(),'50');assert.equal((await snapshot()).measures[0].events[0].notes[0].dynamics,60);
  await control(page,'#sample-picker').selectOption('duvet');assert.equal(await page.locator('#master-volume').inputValue(),'50');
  const energy=await page.evaluate(async()=>{
    const {Player,pluck,clickSound}=await import('/playback.js');const {createGuitarInstrument}=await import('/guitar.js');
    async function render(instrument,volume,muted=false){const context=new OfflineAudioContext(2,22050,44100),player=new Player(()=>{},instrument);player.context=context;player.master=context.createGain();player.master.gain.value=muted?0:volume/100;player.master.connect(context.destination);player.audio=async()=>context;await player.preview([64],[1],'timed',[70]);clickSound(context,0.15,player.master);const buffer=await context.startRendering();return buffer.getChannelData(0).reduce((sum,n)=>sum+n*n,0);}
    return {synthFull:await render(pluck,100),synthHalf:await render(pluck,50),synthMute:await render(pluck,100,true),guitarFull:await render(createGuitarInstrument(),100),guitarHalf:await render(createGuitarInstrument(),50),guitarMute:await render(createGuitarInstrument(),100,true)};
  });
  for(const kind of ['synth','guitar']){assert.ok(energy[kind+'Full']>0);assert.ok(Math.abs(energy[kind+'Half']/energy[kind+'Full']-0.25)<1e-5);assert.equal(energy[kind+'Mute'],0);}
  await page.locator('[data-event="m1-e1"].has-note').first().click();await control(page,'#note-dynamics').selectOption('soft');await setRange('#note-volume',45);await page.screenshot({path:'app/.runtime/tablens-volume.png'});assert.deepEqual(errors,[]);
  console.log('PASS: per-note volume, inheritance/presets, relative/absolute batches, undo, persisted preferences, uninterrupted live mute/gain and real synth/sample/metronome output.');
}finally{await browser.close();}
