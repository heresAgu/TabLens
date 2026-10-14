import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const base=process.env.TABLENS_TEST_URL||'http://127.0.0.1:8765';
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page=await browser.newPage({viewport:{width:1440,height:900}});
const errors=[];page.on('pageerror',error=>errors.push(error.message));
try{
  await page.goto(base);
  await page.waitForFunction(()=>document.querySelector('#score-title').value.length>0);
  const heading=await page.locator('.score-heading').boundingBox();
  const workspace=await page.locator('.workspace').boundingBox();
  assert.ok(heading.height<70,`score heading should be compact, got ${heading.height}px`);
  assert.ok(workspace.y<260,`score workspace should start near the top, got ${workspace.y}px`);
  const mode=await page.locator('#layout-mode').boundingBox();
  assert.ok(mode.width>160&&mode.height<60,`three mode buttons should remain compact: ${JSON.stringify(mode)}`);
  assert.equal(await page.locator('#sample-picker').locator('..').getAttribute('id'),'sample-section');
  const fixture={schema:'tablens.score',version:1,id:'layout-fixture',title:'布局测试',tempo:80,timeSignature:[4,4],capo:0,
    tuningMidi:[64,59,55,50,45,40],sources:[{id:'p',name:'fixture.png',width:1,height:1,
      dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='}],
    measures:[{id:'m',number:1,source:{pageId:'p',box:[0,0,1,1]},events:[],issues:[]}]};
  await page.locator('#file-input').setInputFiles({name:'layout.tablens.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});
  await page.waitForFunction(()=>document.querySelector('#score-title').value==='布局测试');
  assert.equal(await page.locator('.source-panel').isVisible(),true);
  await page.locator('#layout-mode [data-mode="practice"]').click();
  const modeInPractice=await page.locator('#layout-mode').boundingBox();
  assert.ok(Math.abs(mode.x-modeInPractice.x)<1&&Math.abs(mode.y-modeInPractice.y)<1,'mode switch must not move when practice controls appear');
  assert.equal(await page.locator('.source-panel').isVisible(),true);
  assert.equal(await page.locator('.editor-panel').isVisible(),false);
  let sourceBox=await page.locator('.source-panel').boundingBox(),tabBox=await page.locator('.score-panel').boundingBox();
  assert.ok(sourceBox.x<tabBox.x&&sourceBox.width>tabBox.width,'practice should show a larger original on the left');
  const baseWidth=Number((await page.locator('#source-view').getAttribute('viewBox')).split(' ')[2]);
  await page.locator('#source-zoom-in').click();
  assert.ok(Number((await page.locator('#source-view').getAttribute('viewBox')).split(' ')[2])<baseWidth);
  const imageBox=await page.locator('#source-view').boundingBox();
  await page.mouse.move(imageBox.x+imageBox.width/2,imageBox.y+imageBox.height/2);
  await page.mouse.wheel(0,-120);
  assert.ok(Number((await page.locator('#source-view').getAttribute('viewBox')).split(' ')[2])<baseWidth/1.25);
  await page.locator('#source-zoom-fit').click();
  assert.ok(Math.abs(Number((await page.locator('#source-view').getAttribute('viewBox')).split(' ')[2])-baseWidth)<0.01);
  const beforePan=await page.locator('#source-view').getAttribute('viewBox');
  await page.mouse.move(imageBox.x+imageBox.width/2,imageBox.y+imageBox.height/2);
  await page.mouse.down();await page.mouse.move(imageBox.x+imageBox.width/2+25,imageBox.y+imageBox.height/2+20,{steps:4});await page.mouse.up();
  assert.notEqual(await page.locator('#source-view').getAttribute('viewBox'),beforePan);
  await page.locator('#practice-view [data-practice-view="tab"]').click();
  sourceBox=await page.locator('.source-panel').boundingBox();tabBox=await page.locator('.score-panel').boundingBox();
  assert.ok(tabBox.x<sourceBox.x&&tabBox.width>sourceBox.width,'TAB priority should swap the two views');
  await page.locator('#layout-mode [data-mode="compose"]').click();
  assert.equal(await page.locator('.editor-panel').isVisible(),true);
  assert.equal(await page.locator('.source-panel').isVisible(),false);
  await page.locator('#layout-mode [data-mode="review"]').click();
  assert.equal(await page.locator('.source-panel').isVisible(),true);
  const reviewButton=await page.locator('#layout-mode [data-mode="review"]').boundingBox();
  const composeButton=await page.locator('#layout-mode [data-mode="compose"]').boundingBox();
  await page.mouse.move(reviewButton.x+reviewButton.width/2,reviewButton.y+reviewButton.height/2);
  await page.mouse.down();
  await page.mouse.move(composeButton.x+composeButton.width/2,composeButton.y+composeButton.height/2,{steps:5});
  await page.mouse.up();
  assert.equal(await page.locator('#layout-mode').getAttribute('data-active'),'compose');
  await page.locator('#layout-mode [data-mode="review"]').click();
  await page.locator('#workspace-resizer').focus();
  await page.keyboard.press('ArrowLeft');
  await page.locator('#side-resizer').focus();
  await page.keyboard.press('ArrowDown');
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('tablens.layout.v1')));
  assert.ok(saved.sideWidth>370&&saved.sourceHeight>210);
  await page.reload();
  assert.equal(await page.locator('#layout-mode').getAttribute('data-active'),'review');
  assert.equal(await page.locator('.source-panel').isVisible(),true);
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('tablens.layout.v1'))),saved);

  await page.locator('#import-image').click();
  const pdf=await readFile(new URL('./fixtures/two-pages.pdf',import.meta.url));
  await page.locator('#recognition-file').setInputFiles({name:'two-pages.pdf',mimeType:'application/pdf',buffer:pdf});
  await page.waitForFunction(()=>document.querySelector('#pdf-page').options.length===2);
  assert.equal(await page.locator('#pdf-page').inputValue(),'1');
  await page.locator('#pdf-page').selectOption('2');
  await page.waitForFunction(()=>document.querySelector('#pdf-page-status').textContent.includes('当前第 2 页'));
  const source=await page.locator('#recognition-image image').getAttribute('href');
  assert.ok(source.startsWith('data:image/png;base64,'));
  await page.screenshot({path:'app/.runtime/pdf-dialog.png'});
  assert.match(await page.locator('#recognition-status').textContent(),/尚未调用|不会调用|已打开/);
  await page.locator('#recognition-manual').click();
  await page.waitForFunction(()=>!document.querySelector('#recognition-dialog').open);
  const manual=await page.evaluate(()=>JSON.parse(localStorage.getItem('tablens.workspace.v1')));
  assert.equal(manual.measures.length,2);
  assert.equal(manual.measures[1].manualReference,true);
  assert.match(manual.sources.at(-1).name,/第 2 页/);
  assert.equal(manual.sources.at(-1).originPdf.page,2);
  await page.locator('#import-image').click();
  let prepared=null;
  await page.route('**/api/recognition/prepare',async route=>{
    const value=route.request().postDataJSON(),number=Number(value.name.match(/第 (\d+) 页/)?.[1]??1);
    const identifier=`page-${number}`;
    prepared={id:`prepared-${number}`,source:{id:value.sourceId,name:value.name,dataUrl:value.imageDataUrl,
      originPdf:{name:value.pdfName,page:value.pdfPageNumber},
      width:number===1?900:960,height:number===1?1200:1350},
      segments:[{id:`segment-${number}`,number:1,box:[30,30,500,300],columns:[120],
        stringY:[60,80,100,120,140,160],readable:true,issues:[]}]};
    await route.fulfill({contentType:'application/json',body:JSON.stringify(prepared)});
  });
  await page.route('**/api/recognition/start',async route=>{
    const result={id:'job-'+prepared.id,state:'running',calls:0,maximumCalls:3,completed:0,total:1,errors:[],usage:{inputTokens:0,outputTokens:0},segments:[]};
    await route.fulfill({contentType:'application/json',body:JSON.stringify(result)});
  });
  await page.route(/\/api\/recognition\/jobs\/[^/]+$/,async route=>{
    const number=Number(prepared.id.split('-').at(-1)),source=prepared.source;
    const result={schema:'tablens.score',version:1,id:`score-page-${number}`,title:'PDF测试曲',tempo:80,timeSignature:[4,4],capo:0,
      tuningMidi:[64,59,55,50,45,40],sources:[source],measures:[{id:`measure-page-${number}`,number:1,
        source:{pageId:source.id,box:[30,30,500,300]},issues:[],events:[{id:`event-page-${number}`,kind:'notes',duration:'1/4',issues:[],
          notes:[{id:`note-page-${number}`,string:1,fret:number,source:{pageId:source.id,box:[100,50,130,70]}}]}]}]};
    const job={id:'job-'+prepared.id,state:'complete',calls:3,maximumCalls:3,completed:1,total:1,errors:[],
      usage:{inputTokens:0,outputTokens:0},segments:[{id:prepared.segments[0].id,state:'complete'}],result};
    await route.fulfill({contentType:'application/json',body:JSON.stringify(job)});
  });
  await page.locator('#pdf-page').selectOption('1');
  await page.waitForFunction(()=>document.querySelector('#pdf-page-status').textContent.includes('当前第 1 页'));
  await page.locator('#recognition-prepare').click();
  await page.waitForFunction(()=>document.querySelectorAll('#recognition-segments input').length===1);
  await page.locator('#recognition-start').click();
  await page.waitForFunction(()=>!document.querySelector('#recognition-apply').disabled);
  await page.locator('#recognition-apply').click();
  await page.waitForFunction(()=>document.querySelector('#pdf-page-status').textContent.includes('当前第 2 页'));
  await page.locator('#recognition-close').click();
  await page.locator('[data-note="note-page-1"]').first().click();
  await page.locator('#edit-fret').fill('9');
  await page.locator('#apply-note').click();
  await page.locator('#import-image').click();
  await page.locator('#recognition-prepare').click();
  await page.waitForFunction(()=>document.querySelectorAll('#recognition-segments input').length===1);
  await page.locator('#recognition-start').click();
  await page.waitForFunction(()=>!document.querySelector('#recognition-append').disabled);
  await page.locator('#recognition-append').click();
  await page.waitForFunction(()=>!document.querySelector('#recognition-dialog').open);
  const score=await page.evaluate(()=>JSON.parse(localStorage.getItem('tablens.workspace.v1')));
  assert.equal(score.measures.length,2);
  assert.deepEqual(score.measures.map(measure=>measure.number),[1,2]);
  assert.equal(score.measures[0].events[0].notes[0].fret,9);
  assert.equal(score.measures[1].events[0].notes[0].fret,2);
  assert.equal(score.sources.length,2);
  assert.deepEqual(score.sources.map(source=>source.originPdf.page),[1,2]);

  const largePage=await page.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=1100;canvas.height=800;
    const context=canvas.getContext('2d'),pixels=context.createImageData(canvas.width,canvas.height);
    let value=123456789;
    for(let i=0;i<pixels.data.length;i+=4){
      value=(Math.imul(value,1664525)+1013904223)>>>0;
      pixels.data[i]=value&255;pixels.data[i+1]=(value>>>8)&255;pixels.data[i+2]=(value>>>16)&255;pixels.data[i+3]=255;
    }
    context.putImageData(pixels,0,0);return canvas.toDataURL('image/png');
  });
  assert.ok(largePage.length>2_000_000);
  const largeScore={...fixture,id:'large-pdf-draft',title:'多页暂存测试',
    sources:[{id:'big-page',name:'PDF 第 1 页',dataUrl:largePage,width:1100,height:800}],
    measures:[{id:'large-measure',number:1,source:{pageId:'big-page',box:[0,0,1100,800]},events:[],issues:[]}]};
  await page.locator('#file-input').setInputFiles({name:'large.tablens.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(largeScore))});
  await page.waitForFunction(()=>document.querySelector('#score-title').value==='多页暂存测试');
  await page.waitForFunction(()=>document.querySelector('#save-status').textContent.includes('已在本机暂存'));
  assert.equal(await page.evaluate(()=>localStorage.getItem('tablens.workspace.v1')),null);
  await page.reload();
  await page.waitForFunction(()=>document.querySelector('#score-title').value==='多页暂存测试');
  assert.equal(await page.locator('.source-panel').isVisible(),true);
  const withoutImage={...fixture,id:'without-source',title:'没有原图',sources:[],measures:[{id:'blank',number:1,events:[],issues:[]}]};
  await page.locator('#file-input').setInputFiles({name:'blank.tablens.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(withoutImage))});
  await page.waitForFunction(()=>document.querySelector('#score-title').value==='没有原图');
  await page.locator('#layout-mode [data-mode="practice"]').click();
  assert.equal(await page.locator('.source-panel').isVisible(),false);
  assert.equal(await page.locator('.score-panel').isVisible(),true);
  assert.equal(await page.locator('#workspace-resizer').isVisible(),false);
  const partlyLinked={...fixture,id:'partly-linked',title:'部分有原图',measures:[
    fixture.measures[0],{id:'without-reference',number:2,events:[],issues:[]}
  ]};
  await page.locator('#file-input').setInputFiles({name:'partly-linked.tablens.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(partlyLinked))});
  await page.waitForFunction(()=>document.querySelector('#score-title').value==='部分有原图');
  await page.locator('[data-select-measure="without-reference"]').click();
  assert.equal(await page.locator('.source-panel').isVisible(),false);
  await page.locator('[data-select-measure="m"]').click();
  assert.equal(await page.locator('.source-panel').isVisible(),true);
  assert.deepEqual(errors,[]);
  console.log('PASS: layout resizing, two-page PDF import/append and manual fallback, edited-note preservation and large-draft recovery.');
}finally{await browser.close();}
