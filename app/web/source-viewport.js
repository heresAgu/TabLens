// Screen-only controls for the original image; they do not change score coordinates.
const clamp=(value,minimum,maximum)=>Math.max(minimum,Math.min(maximum,value));
const boxOf=svg=>svg.getAttribute('viewBox')?.split(/\s+/).map(Number);
const sameBox=(a,b)=>a?.length===4&&b?.length===4&&a.every((value,index)=>Math.abs(value-b[index])<0.01);

export function createSourceViewport(svg,{onZoom,onManualPan}={}){
  const canvas=svg.parentElement;
  let zoom=1,base=null,view=null,key=null,suppressClick=false;
  const setBox=box=>{view=box;svg.setAttribute('viewBox',box.join(' '));};
  const pointAt=(x,y)=>{
    const matrix=svg.getScreenCTM();
    return matrix?new DOMPoint(x,y).matrixTransform(matrix.inverse()):null;
  };
  const setZoom=(value,anchor=null)=>{
    const next=clamp(value,0.5,4);
    if(view&&base){
      const point=anchor?pointAt(anchor.x,anchor.y):null;
      const fx=point?clamp((point.x-view[0])/view[2],0,1):0.5;
      const fy=point?clamp((point.y-view[1])/view[3],0,1):0.5;
      const width=view[2]*zoom/next,height=view[3]*zoom/next;
      const x=(point?.x??view[0]+view[2]/2)-fx*width;
      const y=(point?.y??view[1]+view[3]/2)-fy*height;
      setBox([x,y,width,height]);
    }
    zoom=next;onZoom?.(zoom);
  };
  const recenter=()=>{
    if(base)setBox([base[0]+base[2]*(1-1/zoom)/2,base[1]+base[3]*(1-1/zoom)/2,
      base[2]/zoom,base[3]/zoom]);
  };
  const show=(render,{measureKey=null}={})=>{
    const changed=key!==null&&key!==measureKey;
    const hasImage=render();
    if(!hasImage){base=null;view=null;key=null;return false;}
    const fresh=boxOf(svg);
    if(!sameBox(base,fresh)||changed||!view){
      base=fresh;
      setBox([fresh[0]+fresh[2]*(1-1/zoom)/2,fresh[1]+fresh[3]*(1-1/zoom)/2,
        fresh[2]/zoom,fresh[3]/zoom]);
    }else setBox(view);
    key=measureKey;
    return true;
  };
  canvas.addEventListener('wheel',event=>{
    if(event.ctrlKey||!view)return;
    event.preventDefault();
    setZoom(zoom*Math.exp(-event.deltaY*0.002),{x:event.clientX,y:event.clientY});
  },{passive:false});
  svg.addEventListener('pointerdown',event=>{
    if(event.button!==0||!view)return;
    const pointerId=event.pointerId,startX=event.clientX,startY=event.clientY;
    let previousX=startX,previousY=startY,moved=false;
    svg.setPointerCapture(pointerId);
    const move=next=>{
      if(next.pointerId!==pointerId)return;
      if(!moved&&Math.hypot(next.clientX-startX,next.clientY-startY)<5)return;
      if(!moved){moved=true;onManualPan?.();}
      const from=pointAt(previousX,previousY),to=pointAt(next.clientX,next.clientY);
      if(from&&to)setBox([view[0]+from.x-to.x,view[1]+from.y-to.y,view[2],view[3]]);
      previousX=next.clientX;previousY=next.clientY;
    };
    const finish=next=>{
      if(next.pointerId!==pointerId)return;
      svg.removeEventListener('pointermove',move);
      svg.removeEventListener('pointerup',finish);
      svg.removeEventListener('pointercancel',finish);
      if(moved){suppressClick=true;setTimeout(()=>{suppressClick=false;},0);}
    };
    svg.addEventListener('pointermove',move);
    svg.addEventListener('pointerup',finish);
    svg.addEventListener('pointercancel',finish);
  });
  svg.addEventListener('click',event=>{
    if(!suppressClick)return;
    event.preventDefault();event.stopImmediatePropagation();suppressClick=false;
  },true);
  return {show,setZoom,recenter,getZoom:()=>zoom,reset:()=>setZoom(1)};
}
