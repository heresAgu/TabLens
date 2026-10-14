import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {dirname, extname, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '../web');
const mime = {'.js':'text/javascript','.json':'application/json','.wav':'audio/wav'};
const server = createServer(async (request, response) => {
  try {
    if (request.url === '/') {
      response.writeHead(200, {'Content-Type':'text/html'});
      response.end('<title>Guitar audio test</title>'); return;
    }
    const file = resolve(web, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
    if (!file.startsWith(web + sep)) throw Error('invalid path');
    const bytes = await readFile(file);
    response.writeHead(200, {'Content-Type':mime[extname(file)] ?? 'application/octet-stream'});
    response.end(bytes);
  } catch { response.writeHead(404); response.end(); }
});

await new Promise((ok, fail) => server.once('error', fail).listen(0, '127.0.0.1', ok));
let browser;
try {
  browser = await chromium.launch({headless:true,
    executablePath:process.env.TABLENS_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const address = `http://127.0.0.1:${server.address().port}/`;
  const page = await browser.newPage();
  const requests = [];
  page.on('request', request => requests.push(new URL(request.url()).pathname));
  await page.goto(address);
  const withSoft = await page.evaluate(async () => {
    const {createGuitarInstrument} = await import('/guitar.js');
    const {voicePlan, Player} = await import('/playback.js');
    const event = {id:'up',start:0,duration:0.4,midi:[60,64],strings:[2,1],
      strum:{direction:'up',spreadBeats:0.08}};
    const data = {events:[event],bpm:96,total:0.4};
    const plan = voicePlan(data, {sustain:'natural'}, () => 1);
    const context = new OfflineAudioContext(2,44100,44100);
    const guitar = createGuitarInstrument();
    await guitar.prepare(context,data.events);
    const note = plan.find(item => item.string === 2);
    guitar(context,note.midi,0.05,0.4,note.volume,note.string,
      {attack:note.attack,strumDirection:note.strumDirection});
    const output = await context.startRendering(), channel = output.getChannelData(0);
    const rms = (from,to) => {
      const values = channel.slice(Math.round(from*44100),Math.round(to*44100));
      return Math.sqrt(values.reduce((sum,value)=>sum+value*value,0)/values.length);
    };
    const resumed = new OfflineAudioContext(2,22050,44100);
    guitar(resumed,60,0.05,0.25,0.1,2,{offset:0.18,strumDirection:'up'});
    const resumedAudio = await resumed.startRendering();
    const resumedValues = resumedAudio.getChannelData(0);
    const resumeRms = Math.sqrt(resumedValues.reduce((sum,value)=>sum+value*value,0)/resumedValues.length);
    const calls=[];
    const fake = (ctx,midi,when,duration,volume,string,options) => {
      calls.push(options.strumDirection); return () => {};
    };
    fake.naturalDuration=()=>1;
    fake.prepare=async()=>{};
    const player = new Player(()=>{},fake);
    player.context={currentTime:0,destination:null};
    player.audio=async()=>player.context;
    await player.play({bpm:96,total:0.15,events:[
      {...event,start:0,duration:0.05},
      {...event,id:'down',start:0.05,duration:0.05,strum:{direction:'down',spreadBeats:0.08}},
      {id:'single',start:0.1,duration:0.05,midi:[60],strings:[2]}
    ]},{sustain:'timed'});
    player.stop();
    return {early:rms(0.07,0.13),late:rms(0.25,0.33),resumeRms,calls};
  });
  assert.ok(requests.includes('/audio/guitar/soft/s2-60.wav'));
  assert.ok(withSoft.early>0.001 && withSoft.late>0.001 && withSoft.resumeRms>0.001);
  assert.deepEqual(withSoft.calls.sort(),['down','down','up','up',null].sort());

  const fallback = await browser.newPage();
  await fallback.route('**/audio/guitar/soft/manifest.json', route =>
    route.fulfill({status:404,body:'missing'}));
  await fallback.goto(address);
  const fallbackRms = await fallback.evaluate(async () => {
    const {createGuitarInstrument} = await import('/guitar.js');
    const context = new OfflineAudioContext(2,22050,44100),guitar=createGuitarInstrument();
    await guitar.prepare(context,[{midi:[60,64],strings:[2,1],strum:{direction:'up'}}]);
    guitar(context,60,0.05,0.3,0.1,2,{strumDirection:'up'});
    const audio=await context.startRendering(),values=audio.getChannelData(0);
    return Math.sqrt(values.reduce((sum,value)=>sum+value*value,0)/values.length);
  });
  assert.ok(fallbackRms>0.001);
  const missingTake = await browser.newPage();
  await missingTake.route('**/audio/guitar/soft/*.wav', route =>
    route.fulfill({status:404,body:'missing'}));
  await missingTake.goto(address);
  const missingTakeRms = await missingTake.evaluate(async () => {
    const {createGuitarInstrument} = await import('/guitar.js');
    const context = new OfflineAudioContext(2,22050,44100),guitar=createGuitarInstrument();
    await guitar.prepare(context,[{midi:[60,64],strings:[2,1],strum:{direction:'up'}}]);
    guitar(context,60,0.05,0.3,0.1,2,{strumDirection:'up'});
    const audio=await context.startRendering(),values=audio.getChannelData(0);
    return Math.sqrt(values.reduce((sum,value)=>sum+value*value,0)/values.length);
  });
  assert.ok(missingTakeRms>0.001);
  console.log('PASS: quiet upstroke sustain, pause offset, Player routing, and audio fallbacks.');
} finally {
  await browser?.close();
  await new Promise(ok => server.close(ok));
}
