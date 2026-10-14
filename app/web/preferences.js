// Playback preferences belong to this browser, not to the score file.
const STRUM_CONTRAST_KEY = 'tablens.autoStrumContrast.v1';
const NEW_SCORE_KEY = 'tablens.newScoreDefaults.v1';
const PRACTICE_KEY = 'tablens.practiceDefaults.v1';
const SOURCE_FOLLOW_KEY = 'tablens.sourceFollowMode.v1';
const SOURCE_PREVIEW_KEY = 'tablens.sourcePreview.v1';
export const STRUM_CONTRAST_CHOICES = ['off', 'subtle', 'standard', 'strong'];
export const DEFAULT_NEW_SCORE = Object.freeze({tempo:80,timeSignature:[4,4],capo:0,sustain:'natural'});
export const DEFAULT_PRACTICE = Object.freeze({speed:'1',countIn:false,metronome:false});

function readObject(key) {
  try { const value=JSON.parse(localStorage.getItem(key));return value && typeof value==='object' ? value : {}; }
  catch { return {}; }
}

export function getNewScoreDefaults() {
  const saved=readObject(NEW_SCORE_KEY);
  return {
    tempo:Number.isInteger(saved.tempo)&&saved.tempo>=20&&saved.tempo<=300?saved.tempo:DEFAULT_NEW_SCORE.tempo,
    timeSignature:Array.isArray(saved.timeSignature)&&saved.timeSignature.length===2&&
      Number.isInteger(saved.timeSignature[0])&&saved.timeSignature[0]>=1&&saved.timeSignature[0]<=32&&
      [1,2,4,8,16,32].includes(saved.timeSignature[1])?[...saved.timeSignature]:[...DEFAULT_NEW_SCORE.timeSignature],
    capo:Number.isInteger(saved.capo)&&saved.capo>=0&&saved.capo<=24?saved.capo:DEFAULT_NEW_SCORE.capo,
    sustain:['natural','timed'].includes(saved.sustain)?saved.sustain:DEFAULT_NEW_SCORE.sustain
  };
}

export function setNewScoreDefaults(value) {
  const {tempo,timeSignature,capo,sustain}=value;
  if(!Number.isInteger(tempo)||tempo<20||tempo>300||
    !Array.isArray(timeSignature)||timeSignature.length!==2||
    !Number.isInteger(timeSignature[0])||timeSignature[0]<1||timeSignature[0]>32||
    ![1,2,4,8,16,32].includes(timeSignature[1])||
    !Number.isInteger(capo)||capo<0||capo>24||!['natural','timed'].includes(sustain))
    throw new Error('新建乐谱默认值无效');
  try { localStorage.setItem(NEW_SCORE_KEY,JSON.stringify({tempo,timeSignature,capo,sustain})); } catch {}
}

export function getPracticeDefaults() {
  const saved=readObject(PRACTICE_KEY);
  return {
    speed:['1','0.75','0.5'].includes(saved.speed)?saved.speed:DEFAULT_PRACTICE.speed,
    countIn:typeof saved.countIn==='boolean'?saved.countIn:DEFAULT_PRACTICE.countIn,
    metronome:typeof saved.metronome==='boolean'?saved.metronome:DEFAULT_PRACTICE.metronome
  };
}

export function setPracticeDefaults(value) {
  if(!['1','0.75','0.5'].includes(value.speed)||typeof value.countIn!=='boolean'||typeof value.metronome!=='boolean')
    throw new Error('练习默认值无效');
  try { localStorage.setItem(PRACTICE_KEY,JSON.stringify(value)); } catch {}
}

export function getSourceFollowMode() {
  try { return localStorage.getItem(SOURCE_FOLLOW_KEY)==='row'?'row':'measure'; }
  catch { return 'measure'; }
}

export function setSourceFollowMode(value) {
  if(!['measure','row'].includes(value))throw new Error('原图跟随方式无效');
  try { localStorage.setItem(SOURCE_FOLLOW_KEY,value); } catch {}
}

export function getSourcePreviewSettings() {
  const saved=readObject(SOURCE_PREVIEW_KEY);
  return {
    visible:typeof saved.visible==='boolean'?saved.visible:true,
    layout:['stacked','side'].includes(saved.layout)?saved.layout:'stacked'
  };
}

export function setSourcePreviewSettings(value) {
  if(typeof value.visible!=='boolean'||!['stacked','side'].includes(value.layout))
    throw new Error('后续原图预览设置无效');
  try { localStorage.setItem(SOURCE_PREVIEW_KEY,JSON.stringify(value)); } catch {}
}

export function getAutoStrumContrast() {
  try {
    const value = localStorage.getItem(STRUM_CONTRAST_KEY);
    if (STRUM_CONTRAST_CHOICES.includes(value)) return value;
  } catch {}
  return 'standard';
}

export function setAutoStrumContrast(value) {
  if (!STRUM_CONTRAST_CHOICES.includes(value)) throw new Error('未知的自动扫弦起伏强度');
  try { localStorage.setItem(STRUM_CONTRAST_KEY, value); } catch {}
}

export function autoStrumBars(accent, contrast = getAutoStrumContrast()) {
  if (contrast === 'off') return 0;
  return accent < 0.98 ? 1 : accent >= 1.04 ? 3 : 2;
}

export function autoStrumGain(accent, contrast = getAutoStrumContrast()) {
  if (contrast === 'off') return 1;
  if (contrast === 'subtle') return accent;
  const bars = autoStrumBars(accent, contrast);
  const centers = contrast === 'strong' ? [0, 0.8, 1, 1.2] : [0, 0.88, 1, 1.12];
  const oldCenters = [0, 0.955, 1.005, 1.055];
  // Keep a small variation within each group; the larger step is between groups.
  return centers[bars] + (accent - oldCenters[bars]) * 0.2;
}
