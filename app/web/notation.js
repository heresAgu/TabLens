import {fraction} from './core.js';
export function rhythmInfo(duration){
  return ({'1':{head:'open',stem:false,flags:0},'1/2':{head:'open',stem:true,flags:0},
    '1/4':{head:'filled',stem:true,flags:0},'1/8':{head:'filled',stem:true,flags:1},
    '1/16':{head:'filled',stem:true,flags:2},'1/32':{head:'filled',stem:true,flags:3},
    '3/8':{head:'filled',stem:true,flags:0,dotted:true},'3/16':{head:'filled',stem:true,flags:1,dotted:true}})[duration]??null;
}
export function beamGroups(events,meter){
  const [count,unit]=meter??[4,4],beat=count>=6&&count%3===0&&unit===8?3/8:1/unit;
  const groups=[];let onset=0,current=[],previousBeat=-1;
  const flush=()=>{if(current.length>1)groups.push(current);current=[];};
  for(let index=0;index<events.length;index++){
    const event=events[index],duration=fraction(event.duration),info=rhythmInfo(event.duration);
    const bucket=onset===null?-1:Math.floor((onset+1e-8)/beat);
    const eligible=onset!==null&&info?.flags>0&&event.kind!=='rest'&&event.notes.length&&onset+duration<=(bucket+1)*beat+1e-8;
    if(!eligible||bucket!==previousBeat)flush();
    if(eligible)current.push(index);else flush();
    previousBeat=bucket;onset=onset===null||duration===null?null:onset+duration;
  }
  flush();return groups;
}
export function drawRhythms(svg,measure,meter,xAt,el,editable){
  const groups=beamGroups(measure.events,meter),joined=new Set(groups.flat());
  for(const [index,event] of measure.events.entries()){
    const x=xAt(index),info=rhythmInfo(event.duration);
    const node=el('g',{class:`rhythm-symbol${event.kind==='rest'?' rest-symbol':''}`,'data-rhythm':event.id,...(editable?{tabindex:0,role:'button','aria-label':`位置${index+1}，${event.kind==='rest'?'休止，':''}时值${event.duration??'待设置'}，修改节奏`}:{})});
    node.append(el('title',{},`时值 ${event.duration??'待设置'}${editable?' · 点击修改':''}`));
    node.append(el('rect',{x:x-20,y:174,width:40,height:38,rx:5,class:'rhythm-hit'}));
    if(!info)node.append(el('text',{x,y:201,'text-anchor':'middle',class:'rhythm-unknown'},event.duration??'?'));
    else if(event.kind==='rest'){
      if(event.duration==='1'||event.duration==='1/2'){
        node.append(el('line',{x1:x-9,x2:x+9,y1:188,y2:188,class:'rhythm-stroke'}));
        node.append(el('rect',{x:x-6,y:event.duration==='1'?188:184,width:12,height:4,class:'rhythm-filled'}));
      }else if(info.flags){
        node.append(el('line',{x1:x+4,x2:x-2,y1:182,y2:206,class:'rhythm-stroke'}));
        for(let level=0;level<info.flags;level++){
          node.append(el('circle',{cx:x-3,cy:184+level*6,r:3,class:'rhythm-filled'}));
          node.append(el('path',{d:`M${x-3} ${184+level*6} Q${x+4} ${190+level*6} ${x+4} ${182+level*6}`,class:'rhythm-stroke'}));
        }
      }else node.append(el('path',{d:`M${x+2} 178 l-5 7 7 7 -6 5 q-5 4 1 8`,class:'rhythm-stroke'}));
    }else{
      node.append(el('ellipse',{cx:x,cy:203,rx:info.stem?5:6,ry:3.3,transform:`rotate(-20 ${x} 203)`,class:info.head==='open'?'rhythm-open':'rhythm-filled'}));
      if(info.stem)node.append(el('line',{x1:x+4,x2:x+4,y1:202,y2:177,class:'rhythm-stroke'}));
      if(!joined.has(index))for(let level=0;level<info.flags;level++)node.append(el('path',{d:`M${x+4} ${178+level*6} q12 6 6 14`,class:'rhythm-stroke'}));
    }
    if(info?.dotted)node.append(el('circle',{cx:x+13,cy:201,r:1.8,class:'rhythm-filled'}));
    svg.append(node);
  }
  for(const group of groups){
    for(let level=0;level<3;level++){
      let run=[];
      const flush=()=>{
        if(!run.length)return;
        let first=xAt(run[0])+4,last=xAt(run.at(-1))+4;
        if(run.length===1){const direction=run[0]===group.at(-1)?-1:1;last=first+direction*10;}
        svg.append(el('line',{x1:first,x2:last,y1:178+level*5,y2:178+level*5,class:'rhythm-beam'}));run=[];
      };
      for(const index of group){if(rhythmInfo(measure.events[index].duration).flags>level)run.push(index);else flush();}flush();
    }
  }
}
