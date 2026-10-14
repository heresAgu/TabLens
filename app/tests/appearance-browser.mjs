import {chromium} from 'playwright';
import assert from 'node:assert/strict';

const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page=await browser.newPage({viewport:{width:1440,height:900}});
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
try {
  await page.goto(process.env.TABLENS_TEST_URL||'http://127.0.0.1:8765');
  await page.waitForFunction(()=>document.querySelector('#score-title')?.value?.length>0);
  assert.equal(await page.locator('html').getAttribute('data-corners'),'sharp');
  assert.equal(await page.locator('.mode-switch button').first().evaluate(element=>getComputedStyle(element).borderRadius),'2px');
  await page.locator('#theme-quick-toggle').click();
  await page.locator('[data-theme-choice="custom"]').click();
  assert.equal(await page.locator('html').getAttribute('data-theme-preference'),'custom');
  assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
  await page.locator('#settings-open').click();
  await page.locator('#corner-style').selectOption('rounded');
  assert.equal(await page.locator('.panel').first().evaluate(element=>getComputedStyle(element).borderRadius),'11px');
  assert.equal(await page.locator('.mode-switch button').first().evaluate(element=>getComputedStyle(element).borderRadius),'8px');
  await page.locator('#custom-theme-accent').evaluate(element=>{
    element.value='#a855f7';element.dispatchEvent(new Event('change',{bubbles:true}));
  });
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('tablens.appearance.v1')).accent),'#a855f7');
  await page.locator('#custom-theme-background').evaluate(element=>{
    element.value='#999999';element.dispatchEvent(new Event('change',{bubbles:true}));
  });
  assert.notEqual(await page.locator('#custom-theme-background').inputValue(),'#999999');
  await page.locator('#custom-theme-tone').selectOption('light');
  assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
  assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).backgroundColor),'rgb(244, 244, 244)');
  await page.locator('#settings-close').click();
  await page.locator('#theme-quick-toggle').click();
  await page.locator('[data-theme-choice="dark"]').click();
  await page.locator('#settings-open').click();
  const backdrop=await page.locator('#settings-dialog').evaluate(dialog=>
    getComputedStyle(dialog,'::backdrop').backgroundColor);
  const channels=backdrop.match(/[\d.]+/g).slice(0,3).map(Number);
  assert.deepEqual(channels,[0,0,0]);
  await page.locator('#settings-close').click();
  assert.equal(await page.evaluate(()=>document.documentElement.style.getPropertyValue('--ui-page')),'');
  await page.reload();
  await page.waitForFunction(()=>document.querySelector('#score-title')?.value?.length>0);
  assert.equal(await page.locator('html').getAttribute('data-theme-preference'),'dark');
  assert.equal(await page.locator('html').getAttribute('data-corners'),'rounded');
  await page.locator('#theme-quick-toggle').click();
  await page.locator('[data-theme-choice="custom"]').click();
  assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
  await page.locator('#score-help').hover();
  await page.locator('#ui-tooltip:visible').waitFor();
  assert.match(await page.locator('#ui-tooltip').textContent(),/点击数字改品位/);
  assert.deepEqual(errors,[]);
  console.log('PASS: quick theme menu, custom colors, corner style, persistence and delayed help.');
} finally {await browser.close();}
