// Offline A-K sweep experiment. J isolates the app sampler; K uses its full playback plan.
import {createServer} from 'node:http';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname, extname, join, resolve, sep} from 'node:path';
import {chromium} from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const web = join(root, 'app', 'web');
const out = join(root, 'experiments', '.runtime', 'strum-groove');
const mime = {'.js': 'text/javascript', '.json': 'application/json', '.wav': 'audio/wav'};
const server = createServer(async (request, response) => {
  try {
    if (request.url === '/') {response.writeHead(200, {'Content-Type': 'text/html'}); response.end('<title>TabLens experiment</title>'); return;}
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const isLayer = pathname === '/layers.json' || pathname.startsWith('/layers/');
    const base = isLayer ? out : web;
    const path = resolve(base, '.' + pathname);
    if (!path.startsWith(base + sep)) throw Error('outside web root');
    response.writeHead(200, {'Content-Type': mime[extname(path)] ?? 'application/octet-stream'});
    response.end(await readFile(path));
  } catch {if (!response.headersSent) response.writeHead(404); response.end();}
});
const chords = {
  C: [[5,3],[4,2],[3,0],[2,1],[1,0]],
  G: [[6,3],[5,2],[4,0],[3,0],[2,0],[1,3]]
};
const directions = ['down','down','up','up','down','up'];
const durations = ['1/4','1/8','1/8','1/8','1/8','1/4'];
const draft = {
  format: 'tablens.agent.v1',
  metadata: {title:'扫弦律动试听',tempo_bpm:96,time_signature:[4,4],capo:0},
  measures: ['C','C','G','G'].map((name,bar)=>({
    number:bar+1,
    events: directions.map((direction,i)=>({
      duration:durations[i],
      notes:chords[name].filter(([string])=>direction==='down'||string<=3)
        .map(([string,fret])=>({string,fret})),
      strum:{direction}
    }))
  }))
};

await new Promise((ok,fail)=>server.once('error',fail).listen(0,'127.0.0.1',ok));
let browser;
try {
  browser = await chromium.launch({headless:true,executablePath:process.env.TABLENS_CHROME||
    'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:'+server.address().port+'/');
  await mkdir(out,{recursive:true});
  const metrics=[];
  for(const variant of ['A-current','B-accents','C-motion','D-soft-takes','E-dynamic-takes',
    'F-up-balanced','G-up-clear','H-up-sustain','I-up-carry','J-app-H','K-app-full']){
    const result=await page.evaluate(async ({draft,variant,targetRms})=>{
      const {importScore}=await import('/core.js');
      const {timeline,voicePlan}=await import('/playback.js');
      const {createGuitarInstrument}=await import('/guitar.js');
      const rate=44100, lead=0.1;
      const data=timeline(importScore(draft),draft.metadata.tempo_bpm);
      const seconds=data.total+3.2;
      const context=new OfflineAudioContext(2,Math.ceil(seconds*rate),rate);
      const guitar=createGuitarInstrument();
      await guitar.prepare(context,data.events);
      const layers=/^[DEFGHI]-/.test(variant)
        ? await (await fetch('/layers.json')).json() : null;
      const layerBuffers=new Map();
      if(layers){
        const urls=new Set(Object.values(layers).flatMap(level=>Object.values(level).map(item=>item.url)));
        await Promise.all([...urls].map(async url=>{
          layerBuffers.set(url,await context.decodeAudioData(await (await fetch(url)).arrayBuffer()));
        }));
      }
      const master=context.createGain();master.gain.value=2.7;master.connect(context.destination);
      const byNote=new Map(data.events.flatMap(event=>event.noteIds.map(id=>[id,event])));
      const accents=[1.05,0.90,0.72,0.84,1.22,0.74];
      const hash=(a,b,c=0)=>{
        let x=Math.imul(a+7,73856093)^Math.imul(b+11,19349663)^Math.imul(c+17,83492791);
        x^=x>>>13;return ((x>>>0)%10000)/10000;
      };
      const voices=voicePlan(data,{sustain:'natural'},guitar.naturalDuration).map(note=>({...note}));
      for(const note of voices){
        const event=byNote.get(note.noteId);
        if(!['A-current','K-app-full'].includes(variant))
          note.volume*=accents[event.index-1]*(event.measure%2?1.015:0.985);
        if(!['A-current','B-accents','K-app-full'].includes(variant)){
          const offset=note.start-event.start;
          if(offset>0.00001){
            const span=0.89+0.22*hash(event.measure,event.index);
            const touch=(hash(event.measure,event.index,note.string)-0.5)*0.0025;
            note.start=event.start+lead+Math.max(0.001,offset*span+touch);
          }else note.start+=lead;
          note.volume*=0.96+0.08*hash(event.measure,event.index,note.string+7);
          note.attack*=0.82+0.36*hash(event.measure,event.index,note.string+13);
        }else note.start+=lead;
        note.end=note.start+guitar.naturalDuration(note.midi,note.string);
        note.event=event;
      }
      const nextByString=new Map();
      for(const note of [...voices].sort((a,b)=>b.start-a.start)){
        const next=nextByString.get(note.string);
        if(next){
          note.nextOnString=next.start;
          note.nextEventIndex=next.event.index;
          const breath=!['A-current','B-accents','K-app-full'].includes(variant)&&
            next.event.index===1?0.035:0;
          note.end=Math.min(note.end,Math.max(note.start+0.04,next.start-breath));
        }
        nextByString.set(note.string,note);
      }
      let alternateNotes=0;
      for(const note of voices){
        const level=note.event.strum?.direction==='up'?'pp'
          :variant==='E-dynamic-takes'&&note.event.index===5?'ff':null;
        const alternate=layers?.[level]?.[`${note.string}:${note.midi}`];
        if(!alternate){
          guitar(context,note.midi,note.start,note.end-note.start,note.volume,
            note.string,{attack:note.attack,
              strumDirection:['J-app-H','K-app-full'].includes(variant)
                ?note.event.strum?.direction:null,
              destination:master});
          continue;
        }
        alternateNotes++;
        const clearAttack=['F-up-balanced','H-up-sustain','I-up-carry'].includes(variant)
          ?0.45:variant==='G-up-clear'?0.70:0;
        if(level==='pp'&&clearAttack){
          const sustained=['H-up-sustain','I-up-carry'].includes(variant);
          const carry=variant==='I-up-carry'&&note.nextOnString&&
            note.nextEventIndex!==1&&note.nextOnString-note.start<0.55;
          const supportEnd=sustained ? note.end+(carry?0.055:0):
            Math.min(note.end,note.start+0.14);
          const support=context.createGain();support.connect(master);
          support.gain.setValueAtTime(1,note.start);
          if(sustained){
            support.gain.setValueAtTime(1,Math.min(note.start+0.11,supportEnd-0.04));
            support.gain.linearRampToValueAtTime(0.70,
              Math.min(note.start+0.24,supportEnd-0.025));
            if(carry){
              support.gain.setValueAtTime(0.70,note.nextOnString);
              support.gain.linearRampToValueAtTime(0,supportEnd);
            }
          }
          guitar(context,note.midi,note.start,supportEnd-note.start,
            note.volume*clearAttack,note.string,{attack:note.attack,destination:support});
        }
        const buffer=layerBuffers.get(alternate.url);
        const source=context.createBufferSource(),gain=context.createGain();
        const rate=440*2**((note.midi-69)/12)/alternate.frequency;
        const end=Math.min(note.end,note.start+buffer.duration/rate);
        source.buffer=buffer;source.playbackRate.value=rate;
        gain.gain.setValueAtTime(0,note.start);
        const levelScale=level==='pp'?0.84:0.90;
        const volume=note.volume*2*levelScale;
        gain.gain.linearRampToValueAtTime(volume,note.start+note.attack);
        gain.gain.setValueAtTime(volume,Math.max(note.start+note.attack,end-0.025));
        gain.gain.linearRampToValueAtTime(0,end);
        source.connect(gain);gain.connect(master);
        source.start(note.start);source.stop(end+0.01);
      }
      const rendered=await context.startRendering();
      const left=rendered.getChannelData(0),right=rendered.getChannelData(1);
      const wav=new ArrayBuffer(44+left.length*4),view=new DataView(wav);
      const tag=(at,value)=>[...value].forEach((char,i)=>view.setUint8(at+i,char.charCodeAt(0)));
      tag(0,'RIFF');view.setUint32(4,wav.byteLength-8,true);tag(8,'WAVE');
      tag(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);
      view.setUint16(22,2,true);view.setUint32(24,rate,true);view.setUint32(28,rate*4,true);
      view.setUint16(32,4,true);view.setUint16(34,16,true);tag(36,'data');
      view.setUint32(40,left.length*4,true);
      let peak=0,energy=0;
      for(let i=0;i<left.length;i++){
        const a=left[i],b=right[i];peak=Math.max(peak,Math.abs(a),Math.abs(b));
        energy+=a*a+b*b;
      }
      const rawRms=Math.sqrt(energy/(2*left.length));
      const scale=targetRms?targetRms/rawRms:1;
      peak*=scale;
      for(let i=0;i<left.length;i++){
        view.setInt16(44+i*4,Math.round(Math.max(-1,Math.min(1,left[i]*scale))*32767),true);
        view.setInt16(46+i*4,Math.round(Math.max(-1,Math.min(1,right[i]*scale))*32767),true);
      }
      const bytes=new Uint8Array(wav),chunks=[];
      for(let i=0;i<bytes.length;i+=16384)
        chunks.push(String.fromCharCode(...bytes.subarray(i,i+16384)));
      return {base64:btoa(chunks.join('')),peak,rms:rawRms*scale,scale,
        seconds,notes:voices.length,alternateNotes};
    },{draft,variant,targetRms:/^[DEFGHIJK]-/.test(variant)
      ? metrics.find(item=>item.variant==='C-motion').rms : null});
    if(result.peak>=0.98)throw Error(variant+' clipped: '+result.peak);
    await writeFile(join(out,variant+'.wav'),Buffer.from(result.base64,'base64'));
    metrics.push({variant,peak:result.peak,rms:result.rms,scale:result.scale,
      seconds:result.seconds,notes:result.notes,alternateNotes:result.alternateNotes});
    console.log(variant,metrics.at(-1));
  }
  await writeFile(join(out,'metrics.json'),JSON.stringify(metrics,null,2)+'\n');
}finally{
  await browser?.close();
  await new Promise(ok=>server.close(ok));
}
