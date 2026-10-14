import {
  DEFAULT_NEW_SCORE, getAutoStrumContrast, getNewScoreDefaults, getPracticeDefaults, getSourceFollowMode,
  getSourcePreviewSettings, setAutoStrumContrast, setNewScoreDefaults, setPracticeDefaults,
  setSourceFollowMode, setSourcePreviewSettings
} from './preferences.js';

export function setupSettings({onContrastChange,onPracticeChange,onSourceFollowChange,onSourcePreviewChange,onNewScoreDefaultsChange}) {
  const $=selector=>document.querySelector(selector);
  const dialog=$('#settings-dialog');
  const tabs=[...dialog.querySelectorAll('[data-settings-tab]')];
  function showTab(name) {
    for(const tab of tabs){const active=tab.dataset.settingsTab===name;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;}
    for(const page of dialog.querySelectorAll('[data-settings-page]'))page.hidden=page.dataset.settingsPage!==name;
  }
  dialog.querySelector('.settings-tabs').addEventListener('click',event=>{
    const tab=event.target.closest('[data-settings-tab]');
    if(tab)showTab(tab.dataset.settingsTab);
  });
  dialog.querySelector('.settings-tabs').addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();
    const current=tabs.findIndex(tab=>tab.getAttribute('aria-selected')==='true');
    const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:
      (current+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
    showTab(tabs[next].dataset.settingsTab);tabs[next].focus();
  });
  const contrast=$('#auto-strum-contrast');
  const practiceSpeed=$('#default-practice-speed');
  const countIn=$('#default-count-in');
  const metronome=$('#default-metronome');
  const sourceFollow=$('#source-follow-mode');
  const sourcePreview=$('#source-preview-enabled');
  const sourcePreviewLayout=$('#source-preview-layout');
  const tempo=$('#default-score-tempo');
  const meter=$('#default-score-meter');
  const capo=$('#default-score-capo');
  const sustain=$('#default-score-sustain');
  const status=$('#new-score-defaults-status');
  const appearance=window.TabLensTheme;
  const corner=$('#corner-style'),tone=$('#custom-theme-tone');
  const background=$('#custom-theme-background'),accent=$('#custom-theme-accent');
  function refresh() {
    contrast.value=getAutoStrumContrast();
    const practice=getPracticeDefaults();
    practiceSpeed.value=practice.speed;countIn.checked=practice.countIn;metronome.checked=practice.metronome;
    sourceFollow.value=getSourceFollowMode();
    const preview=getSourcePreviewSettings();
    sourcePreview.checked=preview.visible;sourcePreviewLayout.value=preview.layout;
    sourcePreviewLayout.disabled=!preview.visible;
    const score=getNewScoreDefaults();
    tempo.value=String(score.tempo);meter.value=score.timeSignature.join('/');
    capo.value=String(score.capo);sustain.value=score.sustain;
    meter.setCustomValidity('');status.textContent='';
  }
  $('#settings-open').addEventListener('click',()=>{refresh();dialog.showModal();});
  $('#settings-close').addEventListener('click',()=>dialog.close());
  corner.addEventListener('change',()=>appearance.setAppearance({corners:corner.value}));
  tone.addEventListener('change',()=>{
    appearance.setAppearance({tone:tone.value});appearance.setTheme('custom');
  });
  background.addEventListener('change',()=>{
    const key=appearance.getState().tone==='dark'?'darkBackground':'lightBackground';
    appearance.setAppearance({[key]:background.value});appearance.setTheme('custom');
  });
  accent.addEventListener('change',()=>{
    appearance.setAppearance({accent:accent.value});appearance.setTheme('custom');
  });
  $('#use-custom-theme').addEventListener('click',()=>appearance.setTheme('custom'));
  contrast.addEventListener('change',()=>{setAutoStrumContrast(contrast.value);onContrastChange();});
  const updatePractice=()=>{
    const value={speed:practiceSpeed.value,countIn:countIn.checked,metronome:metronome.checked};
    setPracticeDefaults(value);onPracticeChange(value);
  };
  for(const control of [practiceSpeed,countIn,metronome])control.addEventListener('change',updatePractice);
  sourceFollow.addEventListener('change',()=>{setSourceFollowMode(sourceFollow.value);onSourceFollowChange();});
  const updateSourcePreview=()=>{
    const value={visible:sourcePreview.checked,layout:sourcePreviewLayout.value};
    setSourcePreviewSettings(value);sourcePreviewLayout.disabled=!value.visible;onSourcePreviewChange();
  };
  sourcePreview.addEventListener('change',updateSourcePreview);
  sourcePreviewLayout.addEventListener('change',updateSourcePreview);
  meter.addEventListener('input',()=>meter.setCustomValidity(''));
  $('#new-score-defaults-form').addEventListener('submit',event=>{
    event.preventDefault();
    const match=/^(\d{1,2})\/(1|2|4|8|16|32)$/.exec(meter.value.trim());
    if(!match||Number(match[1])<1||Number(match[1])>32){meter.setCustomValidity('拍号请填写如 4/4、3/4、6/8');meter.reportValidity();return;}
    const value={tempo:Number(tempo.value),timeSignature:[Number(match[1]),Number(match[2])],
      capo:Number(capo.value),sustain:sustain.value};
    try{setNewScoreDefaults(value);status.textContent='已保存，之后新建乐谱时使用';onNewScoreDefaultsChange();}
    catch(error){status.textContent=error.message;}
  });
  $('#reset-new-score-defaults').addEventListener('click',()=>{
    setNewScoreDefaults(DEFAULT_NEW_SCORE);refresh();status.textContent='已恢复出厂值';onNewScoreDefaultsChange();
  });
  showTab('appearance');refresh();
}
