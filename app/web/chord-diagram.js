import {CHORD_PRESETS} from './chords.js';

const NS='http://www.w3.org/2000/svg';
let openCard=null, openTrigger=null;

function svg(tag,attrs={},content){
  const node=document.createElementNS(NS,tag);
  for(const [key,value] of Object.entries(attrs))node.setAttribute(key,value);
  if(content!==undefined)node.textContent=content;
  return node;
}

export function closeChordDiagram(){
  openCard?.remove();openCard=null;
  openTrigger?.setAttribute('aria-expanded','false');openTrigger=null;
}

export function showChordDiagram(trigger,event,score){
  closeChordDiagram();
  const standard=JSON.stringify(score.tuningMidi??[64,59,55,50,45,40])==='[64,59,55,50,45,40]';
  const preset=standard&&!event.chordPending?CHORD_PRESETS[event.chordName]:null;
  const frets=preset??Array.from({length:6},(_,index)=>event.notes.find(note=>note.string===6-index)?.fret??null);
  const positive=frets.filter(fret=>Number.isInteger(fret)&&fret>0);
  const base=positive.length&&Math.min(...positive)>4?Math.min(...positive):1;
  const rows=Math.max(4,...positive.map(fret=>fret-base+1));
  const card=document.createElement('div');card.className='chord-popover';
  card.setAttribute('role','dialog');card.setAttribute('aria-label',`${event.chordName} 指型图`);
  const title=document.createElement('strong');title.textContent=event.chordName;
  const diagram=svg('svg',{viewBox:`0 0 160 ${48+rows*22}`,width:160,height:48+rows*22,
    role:'img','aria-label':`从左到右为六弦到一弦，${preset?'常见指型':'当前位置弹响的弦位'}`});
  for(let string=0;string<6;string++){
    const x=24+string*22;
    diagram.append(svg('line',{x1:x,x2:x,y1:29,y2:29+rows*22,stroke:'#798a7e','stroke-width':1}));
    diagram.append(svg('text',{x,y:44+rows*22,'text-anchor':'middle',fill:'#66796c','font-size':10},['E','A','D','G','B','e'][string]));
    const fret=frets[string];
    if(fret===null){diagram.append(svg('text',{x,y:21,'text-anchor':'middle',fill:'#8a958d','font-size':15},preset?'×':'–'));continue;}
    if(fret===0){diagram.append(svg('circle',{cx:x,cy:16,r:5,fill:'none',stroke:'#2b745a','stroke-width':1.6}));continue;}
    diagram.append(svg('circle',{cx:x,cy:29+(fret-base+.5)*22,r:6,fill:'#277556'}));
  }
  for(let row=0;row<=rows;row++)diagram.append(svg('line',{x1:24,x2:134,y1:29+row*22,y2:29+row*22,
    stroke:'#798a7e','stroke-width':row===0&&base===1?3:1}));
  if(base>1)diagram.append(svg('text',{x:11,y:47,fill:'#66796c','font-size':10},base));
  const explanation=document.createElement('p');
  explanation.textContent=event.chordPending?'按弦位置尚未确认；图中若有常见指型也仅供参考，请补全实际弹响的弦和品位。':preset?'常见指型参考；实际弹响的弦以当前谱列为准。':'仅显示当前列弹响的弦，不代表完整和弦按法。';
  card.append(title,diagram,explanation);document.body.append(card);
  const rect=trigger.getBoundingClientRect();
  card.style.left=Math.max(8,Math.min(innerWidth-card.offsetWidth-8,rect.left))+'px';
  card.style.top=Math.max(8,Math.min(innerHeight-card.offsetHeight-8,rect.bottom+7))+'px';
  trigger.setAttribute('aria-expanded','true');openCard=card;openTrigger=trigger;
}

document.addEventListener('pointerdown',event=>{
  if(openCard&&!openCard.contains(event.target)&&!openTrigger?.contains(event.target))closeChordDiagram();
});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&openCard){event.preventDefault();closeChordDiagram();}
});
