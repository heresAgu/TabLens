import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {chooseSample} from '../web/guitar.js';

const manifest=new URL('../web/audio/guitar/manifest.json', import.meta.url);
const samples=existsSync(manifest)?JSON.parse(readFileSync(manifest,'utf8')).samples:null;

test('sample mapping prefers the played string, then nearest pitch',()=>{
  const fixture=[{string:1,midi:60},{string:1,midi:68},{string:2,midi:64}];
  assert.equal(chooseSample(fixture,61,1),fixture[0]);
  assert.equal(chooseSample(fixture,63,2),fixture[2]);
  assert.equal(chooseSample(fixture,63,3),fixture[2]);
  assert.throws(()=>chooseSample([],60,1),/没有可用/);
});

test('local sample mapping covers six strings and prefers the played string',
  {skip:!samples&&'本地音源未安装'},()=>{
  assert.equal(samples.length,118);
  for(const string of [1,2,3,4,5,6]){
    const sample=chooseSample(samples,64,string);
    assert.equal(sample.string,string);
  }
  assert.equal(chooseSample(samples,64,1).midi,64);
  assert.equal(chooseSample(samples,45,5).midi,45);
});

test('all mapped samples are stereo PCM WAV with bounded tuning correction',
  {skip:!samples&&'本地音源未安装'},()=>{
  const seen=new Set();
  for(const sample of samples){
    assert.ok(!seen.has(sample.url));seen.add(sample.url);
    const path=new URL('../web'+sample.url,import.meta.url);
    assert.ok(existsSync(path));
    const wav=readFileSync(path);
    assert.equal(wav.toString('ascii',0,4),'RIFF');
    assert.equal(wav.toString('ascii',8,12),'WAVE');
    assert.equal(wav.readUInt16LE(22),2);
    assert.equal(wav.readUInt32LE(24),44100);
    assert.equal(wav.readUInt16LE(34),16);
    assert.ok(sample.frequency>0&&sample.tuningCents>-55&&sample.tuningCents<19);
  }
});
