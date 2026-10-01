import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {control} from './controls.mjs';

const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page=await browser.newPage({viewport:{width:1440,height:1050},acceptDownloads:true});
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
try {
  await page.goto('http://127.0.0.1:8765');
  const score={
    schema:'tablens.score',version:1,id:'tech-ui',title:'技巧编辑测试',
    tempo:80,timeSignature:[4,4],capo:0,tuningMidi:[64,59,55,50,45,40],
    sources:[],measures:[{id:'bar',number:1,authored:true,events:[
      {id:'a',kind:'notes',duration:'1/4',notes:[{id:'a1',string:1,fret:5},{id:'a2',string:2,fret:7}]},
      {id:'b',kind:'notes',duration:'1/4',notes:[{id:'b1',string:1,fret:7}]},
      {id:'c',kind:'notes',duration:'1/4',notes:[{id:'c1',string:1,fret:5}]},
      {id:'d',kind:'notes',duration:'1/4',notes:[{id:'d1',string:1,fret:9}]}
    ]}]
  };
  await control(page,'#file-input').setInputFiles({name:'tech.tablens.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(score))});
  await page.waitForFunction(()=>document.querySelector('#score-title').value==='技巧编辑测试');
  await page.locator('[data-event="b"][data-string="1"]').first().click();
  await control(page,'#note-technique').selectOption('hammer');
  assert.equal(await control(page,'#note-technique').inputValue(),'hammer');
  await page.locator('[data-event="c"][data-string="1"]').first().click();
  await control(page,'#note-technique').selectOption('pull');
  await page.locator('[data-event="d"][data-string="1"]').first().click();
  await control(page,'#note-technique').selectOption('slide');
  assert.equal(await control(page,'#slide-ratio').inputValue(),'20');
  await control(page,'[data-slide-ratio="85"]').click();
  assert.equal(await control(page,'#slide-ratio').inputValue(),'85');
  assert.ok(await page.locator('.technique-marker').count()>=3);
  const downloadPromise=page.waitForEvent('download');
  await control(page,'#export-file').click();
  const download=await downloadPromise;
  const saved=JSON.parse(await (await import('node:fs/promises')).readFile(await download.path(),'utf8'));
  const notes=saved.measures[0].events.map(event=>event.notes.find(note=>note.string===1));
  assert.deepEqual(notes.slice(1).map(note=>note.technique.type),['hammer','pull','slide']);
  assert.equal(notes[3].technique.ratio,0.85);
  await control(page,'#play').click();
  await page.waitForFunction(()=>document.querySelector('#play').textContent.includes('暂停'));
  await page.waitForTimeout(900);
  assert.equal(errors.length,0);
  await control(page,'#play').click();
  assert.match(await control(page,'#play').textContent(),/继续/);
  await control(page,'#play').click();
  await page.waitForFunction(()=>document.querySelector('#play').textContent.includes('暂停'));
  await page.waitForTimeout(250);
  await control(page,'#stop').click();
  await control(page,'#note-technique').selectOption('');
  assert.equal(await page.locator('.technique-marker').count(),2);
  await control(page,'#undo').click();
  assert.equal(await page.locator('.technique-marker').count(),3);
  assert.deepEqual(errors,[]);
  const rendered=await page.evaluate(async()=>{
    const {createGuitarInstrument}=await import('/guitar.js');
    const context=new OfflineAudioContext(1,Math.ceil(3.2*44100),44100);
    const guitar=createGuitarInstrument();
    await guitar.prepare(context,[{midi:[69,71,69,73],strings:[1,1,1,1]}]);
    guitar(context,69,0.05,2.9,0.16,1,{transitions:[
      {type:'hammer',at:0.75,gap:0.75,midi:71,volume:0.16},
      {type:'pull',at:1.5,gap:0.75,midi:69,volume:0.16},
      {type:'slide',at:2.25,gap:0.75,midi:73,ratio:0.6,volume:0.16}
    ]});
    const buffer=await context.startRendering(),data=buffer.getChannelData(0);
    const rms=at=>{
      const start=Math.round(at*44100);
      let power=0;
      for(let i=start;i<start+4410;i++)power+=data[i]*data[i];
      return Math.sqrt(power/4410);
    };
    return [0.2,0.82,1.62,2.36].map(rms);
  });
  assert.ok(rendered.every(value=>Number.isFinite(value)&&value>0.00005),JSON.stringify(rendered));
  const slideLevels=await page.evaluate(async()=>{
    const {createGuitarInstrument}=await import('/guitar.js');
    async function render(targetVolume){
      const context=new OfflineAudioContext(1,Math.ceil(2*44100),44100),starts=[];
      const create=context.createBufferSource.bind(context);
      context.createBufferSource=()=>{
        const source=create(),start=source.start.bind(source);
        source.start=(when,...args)=>{starts.push(when);start(when,...args);};
        return source;
      };
      const guitar=createGuitarInstrument();
      await guitar.prepare(context,[{midi:[64,66],strings:[3,3]}]);
      guitar(context,64,0.05,1.65,0.16,3,{transitions:[
        {type:'slide',at:0.75,gap:0.75,midi:66,ratio:0.2,volume:targetVolume}
      ]});
      const data=(await context.startRendering()).getChannelData(0);
      let power=0;
      for(let i=Math.round(0.9*44100);i<Math.round(1.05*44100);i++)power+=data[i]*data[i];
      return {rms:Math.sqrt(power/Math.round(0.15*44100)),starts};
    }
    return {normal:await render(0.16),silent:await render(0),strong:await render(0.24)};
  });
  assert.ok(slideLevels.normal.starts.length>=2,'weak 3rd-string slide should receive a target body sample');
  assert.ok(slideLevels.normal.rms>0.001,JSON.stringify(slideLevels));
  assert.ok(slideLevels.silent.rms<slideLevels.normal.rms*0.05,JSON.stringify(slideLevels));
  assert.ok(slideLevels.strong.rms>slideLevels.normal.rms*1.25,JSON.stringify(slideLevels));
  console.log('PASS: edit hammer/pull/slide, save, play, pause, remove, undo and render linked audio.');
} finally {await browser.close();}
