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
  assert.equal(await control(page,'#sustain').inputValue(), 'natural');
  await control(page,'#event-sustain').selectOption('timed');
  assert.equal(await control(page,'#event-sustain').inputValue(), 'timed');
  await control(page,'#undo').click();
  assert.equal(await control(page,'#event-sustain').inputValue(), 'inherit');
  await control(page,'#sustain').selectOption('timed');
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#score-title').value === 'Duvet');
  assert.equal(await control(page,'#sustain').inputValue(), 'timed');
  await control(page,'#sustain').selectOption('natural');
  const audio = await page.evaluate(async () => {
    const {createGuitarInstrument} = await import('/guitar.js');
    const {voicePlan, Player} = await import('/playback.js');
    const data = {bpm: 300, total: 0.24, events: [
      {id: 'note', start: 0, duration: 0.12, midi: [64], strings: [1]},
      {id: 'rest', start: 0.12, duration: 0.12, midi: [], strings: []}
    ]};
    async function render(mode) {
      const context = new OfflineAudioContext(2, 44100, 44100);
      const guitar = createGuitarInstrument(); await guitar.prepare(context, data.events);
      const note = voicePlan(data, {sustain: mode}, guitar.naturalDuration)[0];
      guitar(context, note.midi, 0, note.end, note.volume, note.string, {natural: note.natural});
      const output = await context.startRendering(), samples = output.getChannelData(0);
      const region = samples.slice(13230, 19845);
      return {end: note.end, energy: region.reduce((sum, n) => sum + n * n, 0) / region.length};
    }
    const natural = await render('natural'), timed = await render('timed');
    let clock = 0;
    const calls = [];
    const instrument = (context, midi, when, duration, volume, string, options) => {
      const call = {midi, when, duration, offset: options.offset, stopped: false};
      calls.push(call); return () => { call.stopped = true; };
    };
    instrument.naturalDuration = () => 1;
    const player = new Player(() => {}, instrument);
    player.context = {get currentTime() { return clock; }};
    player.audio = async () => player.context;
    const excerpt = {bpm: 300, total: 0.4, events: [
      {start: 0, duration: 0.2, midi: [40], strings: [6]},
      {start: 0.2, duration: 0.2, midi: [64], strings: [1]}
    ]};
    await player.play(excerpt, {sustain: 'natural'});
    clock = 0.25; player.schedule();
    clock = 0.45; player.pause();
    const paused = calls.map(call => ({...call}));
    await player.play(excerpt);
    const resumed = calls.slice(paused.length).map(call => ({...call}));
    player.stop();
    return {natural, timed, paused, resumed, allStopped: calls.every(call => call.stopped)};
  });
  assert.ok(audio.natural.end > 0.5);
  assert.equal(audio.timed.end, 0.12);
  assert.ok(audio.natural.energy > 1e-8);
  assert.equal(audio.timed.energy, 0);
  assert.equal(audio.paused.length, 2);
  assert.ok(audio.paused.every(call => call.stopped));
  assert.equal(audio.resumed.length, 2);
  assert.ok(audio.resumed.find(call => call.midi === 40).offset > 0.4);
  assert.ok(audio.resumed.find(call => call.midi === 64).offset > 0.2);
  assert.ok(audio.allStopped);
  await page.screenshot({path: 'app/.runtime/tablens-sustain.png', fullPage: true});
  assert.deepEqual(errors, []);
  console.log('PASS: real sample tails after rests, timed damping, pause/resume offsets, cancellation, per-position override and saved sustain setting.');
} finally { await browser.close(); }
