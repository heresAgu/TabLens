(function () {
  function setup() {
    const tooltip=document.createElement('div');
    tooltip.id='ui-tooltip';tooltip.role='tooltip';tooltip.hidden=true;
    document.body.append(tooltip);
    let active=null,timer=0;
    function hide() {
      clearTimeout(timer);timer=0;tooltip.hidden=true;
      if(active)active.removeAttribute('aria-describedby');
      active=null;
    }
    function show(element) {
      if(element===active)return;
      hide();
      if(!element?.dataset.tip)return;
      active=element;
      timer=setTimeout(()=>{
        if(!active||!active.isConnected)return hide();
        tooltip.textContent=active.dataset.tip;
        tooltip.hidden=false;
        active.setAttribute('aria-describedby','ui-tooltip');
        const rect=active.getBoundingClientRect();
        const width=tooltip.getBoundingClientRect().width;
        tooltip.style.left=`${Math.max(8,Math.min(innerWidth-width-8,rect.left+rect.width/2-width/2))}px`;
        const height=tooltip.getBoundingClientRect().height;
        tooltip.style.top=`${rect.bottom+height+12>innerHeight?Math.max(8,rect.top-height-8):rect.bottom+8}px`;
      },550);
    }
    document.addEventListener('pointerover',event=>show(event.target.closest?.('[data-tip]')));
    document.addEventListener('pointerout',event=>{
      if(active&&!active.contains(event.relatedTarget))hide();
    });
    document.addEventListener('focusin',event=>show(event.target.closest?.('[data-tip]')));
    document.addEventListener('focusout',event=>{
      if(active&&!active.contains(event.relatedTarget))hide();
    });
    document.addEventListener('pointerdown',hide);
    document.addEventListener('scroll',hide,true);
    window.addEventListener('resize',hide);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup,{once:true});
  else setup();
})();
