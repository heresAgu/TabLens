import {chromium} from 'playwright';
import assert from 'node:assert/strict';

const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page=await browser.newPage({viewport:{width:1440,height:1080}});
const errors=[];page.on('pageerror',error=>errors.push(error.message));
async function dragImage(from,to){
  const points=await page.locator('#recognition-image').evaluate((svg,pair)=>pair.map(([x,y])=>{
    const p=new DOMPoint(x,y).matrixTransform(svg.getScreenCTM());
    return {x:p.x,y:p.y};
  }),[from,to]);
  await page.mouse.move(points[0].x,points[0].y);
  await page.mouse.down();await page.mouse.move(points[1].x,points[1].y,{steps:8});await page.mouse.up();
}
try{
  await page.goto(process.env.TABLENS_TEST_URL||'http://127.0.0.1:8766');
  await page.locator('#import-image').click();
  await page.locator('#recognition-file').setInputFiles('lullaby.jpg');
  await page.waitForFunction(()=>!document.querySelector('#recognition-manual-box').disabled);
  await page.locator('#api-settings').evaluate(el=>{el.open=false;});
  await page.locator('#recognition-mode').selectOption('region');
  await dragImage([90,290],[1350,480]);
  await page.locator('#recognition-prepare').click();
  await page.waitForFunction(()=>document.querySelectorAll('#recognition-segments input').length===1);
  const previous=await page.locator('#recognition-segments input').first().inputValue();
  await page.locator('#recognition-manual-box').click();
  await dragImage([90,550],[730,760]);
  assert.equal(await page.locator('.import-manual-selection').count(),1);
  await page.locator('#recognition-manual-add').click();
  await page.waitForFunction(()=>document.querySelectorAll('#recognition-segments input').length===2);
  assert.equal(await page.locator('#recognition-segments input').first().inputValue(),previous);
  assert.match(await page.locator('#recognition-coverage').textContent(),/原图定位 2 段/);
  assert.equal(await page.locator('#candidate-tab .measure-card').count(),2);
  assert.equal(await page.locator('.import-manual-selection').count(),0);
  await page.locator('#recognition-apply').click();
  await page.waitForFunction(()=>document.querySelectorAll('#tab-view .measure-card').length===2);
  assert.equal(await page.locator('#tab-view .measure-card').count(),2);
  await page.locator('#import-image').click();
  await page.locator('#recognition-file').setInputFiles('lullaby.jpg');
  await page.waitForFunction(()=>!document.querySelector('#recognition-manual-box').disabled);
  await page.locator('#recognition-manual-box').click();
  await dragImage([90,550],[730,760]);
  await page.locator('#recognition-manual-add').click();
  await page.waitForFunction(()=>document.querySelectorAll('#recognition-segments input').length===1);
  assert.equal(await page.locator('#candidate-tab .measure-card').count(),1,
    '框选应能在完全没有自动分析结果时单独建立候选小节');
  await page.locator('#recognition-close').click();
  assert.deepEqual(errors,[]);
  console.log('manual recovery browser test passed');
}finally{await browser.close();}
