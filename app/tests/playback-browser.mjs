import {control} from './controls.mjs';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page = await browser.newPage({viewport: {width: 1440, height: 1050}});
const errors = [];
page.on('pageerror', e => errors.push(e.message));
try {
  await page.goto('http://127.0.0.1:8765');
  await page.waitForFunction(() => document.querySelector('#score-title').value === 'Duvet');
  await control(page,'#play').click();
  assert.match(await control(page,'#toast').textContent(), /设置.*节奏/);
  assert.equal(await page.locator('.playing-note').count(), 0);
  await control(page,'#batch-duration').selectOption('1/16');
  await control(page,'#apply-duration').click();
  assert.equal(await page.locator('.has-note').count(), 31);
  assert.match(await control(page,'#play-status').textContent(), /已可播放/);
  await control(page,'#undo').click();
  assert.match(await control(page,'#play-status').textContent(), /31 处节奏待设/);
  await control(page,'#redo').click();
  await control(page,'#sample-picker').selectOption('lullaby');
  await page.waitForFunction(() => document.querySelector('#score-title').value === 'Lullaby');
  assert.equal(await control(page,'#capo').inputValue(), '6');
  await control(page,'#preview').click();
  await control(page,'#play').click();
  await page.waitForFunction(() => document.querySelectorAll('.playing-note.has-note').length === 2);
  assert.equal(await page.locator('.playhead[visibility="visible"]').count(), 1);
  await control(page,'#play').click();
  assert.match(await control(page,'#play').textContent(), /继续/);
  const paused = await control(page,'#play-time').textContent();
  await page.waitForTimeout(1100);
  assert.equal(await control(page,'#play-time').textContent(), paused);
  await control(page,'#play').click();
  await page.waitForFunction(() => document.querySelector('#play').textContent.includes('暂停'));
  await control(page,'#edit-fret').fill('3');
  await control(page,'#apply-note').click();
  assert.equal(await page.locator('.playing-note').count(), 0);
  assert.match(await control(page,'#play').textContent(), /播放/);
  await control(page,'#tempo').fill('300'); await control(page,'#tempo').press('Tab');
  await control(page,'#play').click();
  await page.waitForFunction(() => document.querySelector('#play').textContent.includes('暂停'));
  await page.waitForFunction(() => document.querySelector('#play').textContent.includes('播放'), {timeout: 10000});
  assert.equal(await page.locator('.playing-note').count(), 0);
  // Verify the synthesizer actually produces audio samples and schedules chord
  // members at the exact same timestamp using the browser audio implementation.
  const signal = await page.evaluate(async () => {
    const {pluck} = await import('/playback.js');
    const ctx = new OfflineAudioContext(1, 44100, 44100), starts = [];
    const create = ctx.createOscillator.bind(ctx);
    ctx.createOscillator = () => {
      const osc = create(), start = osc.start.bind(osc);
      osc.start = time => { starts.push(time); start(time); }; return osc;
    };
    pluck(ctx, 64, 0.05, 0.3); pluck(ctx, 52, 0.05, 0.3);
    const buffer = await ctx.startRendering(), samples = buffer.getChannelData(0);
    return {starts, peak: Math.max(...samples.map(Math.abs)), tail: samples.slice(20000).some(n => n !== 0)};
  });
  assert.equal(signal.starts.length, 8);
  assert.ok(signal.starts.every(n => n === 0.05));
  assert.ok(signal.peak > 0.01 && signal.peak < 1);
  assert.equal(signal.tail, false);
  const sampled = await page.evaluate(async () => {
    const {createGuitarInstrument} = await import('/guitar.js');
    const ctx = new OfflineAudioContext(2, 44100, 44100), starts = [], rates = [];
    const create = ctx.createBufferSource.bind(ctx);
    ctx.createBufferSource = () => {
      const source = create(), start = source.start.bind(source);
      source.start = time => { starts.push(time); rates.push(source.playbackRate.value); start(time); };
      return source;
    };
    const guitar = createGuitarInstrument();
    await guitar.prepare(ctx, [{midi: [64, 52], strings: [1, 4]}]);
    guitar(ctx, 64, 0.05, 0.4, 0.15, 1); guitar(ctx, 52, 0.05, 0.4, 0.15, 4);
    const output = await ctx.startRendering();
    const samples = output.getChannelData(0);
    return {starts, rates, peak: Math.max(...samples.map(Math.abs)), tail: samples.slice(24000).some(n => n !== 0)};
  });
  assert.deepEqual(sampled.starts, [0.05, 0.05]);
  assert.ok(sampled.rates.every(rate => rate > 0.9 && rate < 1.1));
  assert.ok(sampled.peak > 0.01 && sampled.peak < 1);
  assert.equal(sampled.tail, false);
  await page.screenshot({path: 'app/.runtime/tablens-playback.png', fullPage: true});
  assert.deepEqual(errors, []);
  console.log('PASS: missing rhythm, batch/undo, chord/capo, audio samples, cursor, pause/resume, edit cancellation and completion.');
} finally { await browser.close(); }
