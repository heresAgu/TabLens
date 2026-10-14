(function () {
  const themeKey='tablens.theme.v1', appearanceKey='tablens.appearance.v1';
  const modes=['system','light','dark','custom'], cycle=['system','light','dark'];
  const names={system:'跟随系统',light:'浅色',dark:'深色',custom:'自定义'};
  const icons={system:'◐',light:'☀',dark:'☾',custom:'◈'};
  const defaults={corners:'sharp',tone:'dark',darkBackground:'#202020',lightBackground:'#f4f4f4',accent:'#70c69a'};
  const media=window.matchMedia('(prefers-color-scheme: dark)'), root=document.documentElement;
  const props=['--ui-page','--ui-surface','--ui-inset','--ui-control','--ui-control-hover','--ui-border','--line',
    '--ui-accent','--ui-accent-soft','--ui-accent-border','--ui-focus','--ui-primary','--ui-primary-hover','--ui-primary-text','--green'];
  const validHex=value=>typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value);
  const rgb=value=>[1,3,5].map(index=>parseInt(value.slice(index,index+2),16));
  const hex=value=>'#'+value.map(channel=>Math.round(channel).toString(16).padStart(2,'0')).join('');
  const mix=(from,to,ratio)=>from.map((channel,index)=>channel*(1-ratio)+to[index]*ratio);
  const luminance=value=>{
    const channels=value.map(channel=>channel/255).map(channel=>channel<=0.04045?channel/12.92:((channel+0.055)/1.055)**2.4);
    return channels[0]*0.2126+channels[1]*0.7152+channels[2]*0.0722;
  };
  const contrast=(a,b)=>{const values=[luminance(a),luminance(b)].sort((x,y)=>y-x);return(values[0]+0.05)/(values[1]+0.05);};
  function readable(color,background,target,toward){
    if(contrast(color,background)>=target)return color;
    let low=0,high=1;
    for(let count=0;count<14;count++){
      const middle=(low+high)/2;
      if(contrast(mix(color,toward,middle),background)>=target)high=middle;else low=middle;
    }
    return mix(color,toward,high);
  }
  function normalizeBackground(color,tone){
    const source=rgb(color),target=tone==='dark'?[0,0,0]:[255,255,255];
    const allowed=value=>tone==='dark'?luminance(value)<=0.06:luminance(value)>=0.78;
    if(allowed(source))return color.toLowerCase();
    let low=0,high=1;
    for(let count=0;count<14;count++){
      const middle=(low+high)/2;
      if(allowed(mix(source,target,middle)))high=middle;else low=middle;
    }
    return hex(mix(source,target,high));
  }
  function read(key){try{return localStorage.getItem(key);}catch{return null;}}
  function write(key,value){try{localStorage.setItem(key,value);}catch{}}
  let preference=read(themeKey);
  if(!modes.includes(preference))preference='system';
  let stored={};try{stored=JSON.parse(read(appearanceKey))??{};}catch{}
  let appearance={...defaults,...stored};
  if(!['sharp','rounded'].includes(appearance.corners))appearance.corners=defaults.corners;
  if(!['dark','light'].includes(appearance.tone))appearance.tone=defaults.tone;
  for(const key of ['darkBackground','lightBackground','accent'])if(!validHex(appearance[key]))appearance[key]=defaults[key];
  appearance.darkBackground=normalizeBackground(appearance.darkBackground,'dark');
  appearance.lightBackground=normalizeBackground(appearance.lightBackground,'light');

  function applyPalette(){
    for(const prop of props)root.style.removeProperty(prop);
    if(preference!=='custom')return;
    const dark=appearance.tone==='dark',page=rgb(appearance[dark?'darkBackground':'lightBackground']);
    const white=[255,255,255],black=[0,0,0];
    const surface=dark?mix(page,white,0.035):mix(page,white,0.45);
    const inset=dark?mix(page,white,0.07):mix(page,white,0.18);
    const control=dark?mix(page,white,0.11):mix(surface,black,0.035);
    const hover=dark?mix(page,white,0.18):mix(surface,black,0.09);
    const border=dark?mix(page,white,0.26):mix(surface,black,0.2);
    const requested=rgb(appearance.accent);
    const foreground=readable(requested,surface,4.5,dark?white:black);
    const primary=readable(requested,surface,3,dark?white:black);
    const primaryText=contrast(primary,white)>=contrast(primary,black)?white:black;
    const values={
      '--ui-page':hex(page),'--ui-surface':hex(surface),'--ui-inset':hex(inset),
      '--ui-control':hex(control),'--ui-control-hover':hex(hover),'--ui-border':hex(border),'--line':hex(border),
      '--ui-accent':hex(foreground),'--ui-accent-soft':hex(mix(surface,foreground,0.16)),
      '--ui-accent-border':hex(mix(surface,foreground,0.48)),'--ui-focus':hex(foreground),
      '--ui-primary':hex(primary),'--ui-primary-hover':hex(mix(primary,dark?white:black,0.12)),
      '--ui-primary-text':hex(primaryText),'--green':hex(foreground)
    };
    for(const [key,value] of Object.entries(values))root.style.setProperty(key,value);
  }
  function syncControls(){
    const toggle=document.getElementById('theme-toggle');
    if(toggle){toggle.textContent=`${icons[preference]} ${names[preference]}`;
      toggle.setAttribute('aria-label',`当前主题：${names[preference]}；点击切换跟随系统、浅色和深色`);}
    const quick=document.getElementById('theme-quick-toggle');
    if(quick){quick.setAttribute('aria-label',`主题：${names[preference]}，打开主题菜单`);
      quick.dataset.tip=`主题：${names[preference]}；点击选择主题`;}
    document.querySelectorAll('[data-theme-choice]').forEach(button=>{
      button.setAttribute('aria-checked',String(button.dataset.themeChoice===preference));
    });
    const corners=document.getElementById('corner-style'),tone=document.getElementById('custom-theme-tone');
    const background=document.getElementById('custom-theme-background'),accent=document.getElementById('custom-theme-accent');
    if(corners)corners.value=appearance.corners;
    if(tone)tone.value=appearance.tone;
    if(background)background.value=appearance[appearance.tone==='dark'?'darkBackground':'lightBackground'];
    if(accent)accent.value=appearance.accent;
  }
  function apply(){
    const effective=preference==='custom'?appearance.tone:preference==='system'?(media.matches?'dark':'light'):preference;
    root.dataset.theme=effective;root.dataset.themePreference=preference;root.dataset.corners=appearance.corners;
    applyPalette();syncControls();document.dispatchEvent(new CustomEvent('tablens:theme-change'));
  }
  function setTheme(value){if(!modes.includes(value))return;preference=value;write(themeKey,value);apply();}
  function setAppearance(next){
    const merged={...appearance,...next};
    if(!['sharp','rounded'].includes(merged.corners))merged.corners=appearance.corners;
    if(!['dark','light'].includes(merged.tone))merged.tone=appearance.tone;
    for(const key of ['darkBackground','lightBackground','accent'])if(!validHex(merged[key]))merged[key]=appearance[key];
    merged.darkBackground=normalizeBackground(merged.darkBackground,'dark');
    merged.lightBackground=normalizeBackground(merged.lightBackground,'light');
    appearance=merged;write(appearanceKey,JSON.stringify(appearance));apply();
  }
  window.TabLensTheme={getState:()=>({preference,...appearance}),setTheme,setAppearance};
  media.addEventListener('change',()=>{if(preference==='system')apply();});
  document.addEventListener('DOMContentLoaded',()=>{
    const quick=document.getElementById('theme-quick-toggle'),menu=document.getElementById('theme-quick-menu');
    const close=()=>{menu.hidden=true;quick.setAttribute('aria-expanded','false');};
    quick.addEventListener('click',()=>{
      const open=menu.hidden;menu.hidden=!open;quick.setAttribute('aria-expanded',String(open));
      if(open)menu.querySelector('[aria-checked="true"]')?.focus();
    });
    menu.addEventListener('click',event=>{
      const item=event.target.closest('[data-theme-choice]');if(!item)return;
      setTheme(item.dataset.themeChoice);close();quick.focus();
    });
    menu.addEventListener('keydown',event=>{
      if(!['ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
      event.preventDefault();
      const items=[...menu.querySelectorAll('button')],current=items.indexOf(document.activeElement);
      const next=event.key==='Home'?0:event.key==='End'?items.length-1:
        (current+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;
      items[next].focus();
    });
    document.getElementById('theme-customize').addEventListener('click',()=>{
      close();document.getElementById('settings-open').click();
      document.querySelector('[data-settings-tab="appearance"]').click();
    });
    document.addEventListener('pointerdown',event=>{if(!menu.hidden&&!event.target.closest('.theme-quick'))close();});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!menu.hidden){close();quick.focus();}});
    document.getElementById('theme-toggle').addEventListener('click',()=>{
      const index=cycle.indexOf(preference);setTheme(cycle[(index+1)%cycle.length]);
    });
    syncControls();
  });
  apply();
})();
