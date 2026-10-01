import {control} from './controls.mjs';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page = await browser.newPage({viewport: {width: 1440, height: 1050}});
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto('http://127.0.0.1:8765');
  await page.waitForFunction(() => document.querySelector('#score-title').value === 'Duvet');
  await control(page,'#sample-picker').selectOption('lullaby');
  await page.waitForFunction(() => document.querySelector('#score-title').value === 'Lullaby');
  await control(page,'#range-to').selectOption('0');
  await control(page,'#tempo').fill('300'); await control(page,'#tempo').press('Tab');
  await control(page,'#loop').check(); await control(page,'#count-in').check(); await control(page,'#metronome').check();
  await control(page,'#play').click();
  await page.waitForFunction(() => document.querySelector('#play-status').textContent.includes('倒数'));
  assert.equal(await page.locator('.playing-note').count(), 0);
  await control(page,'#play').click();
  assert.match(await control(page,'#play-status').textContent(), /已暂停.*倒数/);
  await page.waitForTimeout(1000);
  assert.equal(await page.locator('.playing-note').count(), 0);
  await control(page,'#play').click();
  await page.waitForFunction(() => document.querySelector('#play-status').textContent.includes('第2遍'));
  assert.equal(await page.locator('.measure-card').nth(1).locator('.playing-note').count(), 0);
  await control(page,'#stop').click();
  assert.equal(await page.locator('.playing-note').count(), 0);
  await page.waitForTimeout(500);
  assert.equal(await page.locator('.playing-note').count(), 0);
  // Test the transport clock directly with a replacement instrument. Verify
  // that repeats are scheduled at exact boundaries, independent of UI frames.
  const transport = await page.evaluate(async () => {
    const {Player} = await import('/playback.js');
    const calls = [], views = [];
    const player = new Player(view => views.push(view), (ctx, midi, when) => {
      calls.push({midi, when}); return () => {};
    });
    const data = {bpm: 300, total: 0.4, events: [
      {id: 'a', midi: [64, 52], start: 0, duration: 0.2},
      {id: 'b', midi: [59], start: 0.2, duration: 0.2}
    ]};
    await player.play(data, {loop: true});
    const deadline = performance.now() + 4000;
    while (!views.some(view => view.cycle >= 3) && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
    player.stop(); const count = calls.length;
    await new Promise(resolve => setTimeout(resolve, 250));
    return {calls, extra: calls.length - count, cycles: views.filter(v => v.cycle).map(v => v.cycle)};
  });
  const starts = transport.calls.filter(call => call.midi === 64);
  assert.ok(starts.length >= 3);
  for (let index = 1; index < starts.length; index++) assert.ok(Math.abs(starts[index].when - starts[index - 1].when - 0.4) < 0.001);
  for (const note of starts) assert.ok(transport.calls.some(call => call.midi === 52 && call.when === note.when));
  assert.equal(transport.extra, 0);
  assert.ok(transport.cycles.includes(3));
  await control(page,'#range-from').selectOption('1');
  assert.equal(await control(page,'#range-to').inputValue(), '1');
  await control(page,'#speed').selectOption('0.5');
  await control(page,'#count-in').uncheck(); await control(page,'#loop').uncheck();
  await control(page,'#play').click();
  await page.waitForFunction(() => document.querySelector('#play-status').textContent.includes('第 2 小节'));
  await control(page,'#stop').click();
  await page.screenshot({path: 'app/.runtime/tablens-practice.png', fullPage: true});
  assert.deepEqual(errors, []);
  console.log('PASS: selected range, count-in pause/resume, loop boundary timing, simultaneous chord scheduling, cancellation and half speed.');
} finally { await browser.close(); }
