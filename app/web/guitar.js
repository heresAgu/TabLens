export function chooseSample(samples, midi, string) {
  const sameString = samples.filter(sample => sample.string === string);
  const candidates = sameString.length ? sameString : samples;
  if (!candidates.length) throw new Error('没有可用的吉他采样');
  return candidates.reduce((best, sample) => Math.abs(sample.midi - midi) < Math.abs(best.midi - midi) ? sample : best);
}

const frequency = midi => 440 * 2 ** ((midi - 69) / 12);
function bodyRms(buffer, start, end) {
  const first = Math.max(0, Math.round(start * buffer.sampleRate));
  const last = Math.min(buffer.length, Math.round(end * buffer.sampleRate));
  if (last <= first) return 0;
  let power = 0, count = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = first; i < last; i += 8) { power += data[i] * data[i]; count++; }
  }
  return Math.sqrt(power / Math.max(1, count));
}

export function createGuitarInstrument(status = () => {}) {
  let samples, manifestPromise;
  const buffers = new Map();
  const key = (midi, string) => chooseSample(samples, midi, string);
  const instrument = (context, midi, when, duration, volume, string,
    {offset = 0, transitions = [], attack: strokeAttack = 0.004, destination = context.destination} = {}) => {
    const voices = [], end = when + Math.max(0.025, duration);
    const baseVolume = Math.max(volume, ...transitions.map(item => item.volume ?? volume), 0.001);
    const chainGain = context.createGain();
    chainGain.connect(destination);
    let endedVoices = 0;
    const makeVoice = (pitch, start, finish, loudness, sampleOffset = 0, attack = 0.004) => {
      const sample = key(pitch, string), buffer = buffers.get(sample.url);
      if (!buffer) throw new Error('吉他音源尚未准备好');
      const source = context.createBufferSource(), gain = context.createGain();
      source.buffer = buffer;
      const rate = frequency(pitch) / sample.frequency;
      source.playbackRate.setValueAtTime(rate, start);
      source.connect(gain); gain.connect(chainGain);
      const level = loudness * 2;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(level, start + attack);
      gain.gain.setValueAtTime(level, Math.max(start + attack, finish - 0.025));
      gain.gain.linearRampToValueAtTime(0, finish);
      source.start(start, Math.min(Math.max(0, buffer.duration - 0.01), sampleOffset * rate));
      source.stop(finish + 0.01);
      source.onended = () => {
        source.disconnect(); gain.disconnect();
        if (++endedVoices === voices.length) chainGain.disconnect();
      };
      const voice = {source, gain, sample, buffer, start, rate, level, sampleOffset};
      voices.push(voice);
      return voice;
    };
    const fade = (voice, at, seconds = 0.04) => {
      voice.gain.gain.cancelScheduledValues(at);
      voice.gain.gain.setValueAtTime(voice.level, at);
      voice.gain.gain.linearRampToValueAtTime(0, at + seconds);
      try { voice.source.stop(at + seconds + 0.01); } catch {}
    };
    let currentMidi = midi, currentVolume = volume, lastAt = 0;
    for (const transition of transitions) {
      if (transition.at <= offset) {
        currentMidi = transition.midi;
        currentVolume = transition.volume ?? currentVolume;
        lastAt = transition.at;
      } else break;
    }
    const rampStart = t => t.type === 'bend' ? t.begin : t.at - t.gap * t.ratio;
    const volumeStart = t => t.graceSlide ? t.at - t.gap * 0.35 : rampStart(t);
    const pendingRamp = transitions.find(t => ['slide', 'bend'].includes(t.type) &&
      t.at > offset && rampStart(t) < offset);
    if (pendingRamp) {
      const progress = (offset - rampStart(pendingRamp)) / (pendingRamp.at - rampStart(pendingRamp));
      currentMidi += (pendingRamp.midi - currentMidi) * progress;
      const volumeProgress = Math.max(0, Math.min(1,
        (offset - volumeStart(pendingRamp)) / (pendingRamp.at - volumeStart(pendingRamp))));
      currentVolume += ((pendingRamp.volume ?? currentVolume) - currentVolume) * volumeProgress;
    }
    chainGain.gain.setValueAtTime(currentVolume / baseVolume, when);
    const graceSlide = !!transitions[0]?.graceSlide;
    let active = [makeVoice(currentMidi, when, end, baseVolume,
      offset > 0 && transitions.length ? 0.055 + Math.max(0, offset - lastAt) : graceSlide ? 0.055 : offset,
      graceSlide ? 0.018 : strokeAttack)];
    const addBodyLayer = (transition, index, arrival, targetRatio) => {
      const main = active[0];
      const first = bodyRms(main.buffer, 0.08 * main.rate, 0.18 * main.rate);
      const playedFor = Math.max(0, arrival - main.start);
      const remaining = bodyRms(main.buffer,
        (main.sampleOffset + playedFor + 0.08) * main.rate,
        (main.sampleOffset + playedFor + 0.18) * main.rate);
      if (first <= 0 || remaining / first >= targetRatio) return;
      const sample = key(transition.midi, string), buffer = buffers.get(sample.url);
      const targetRate = frequency(transition.midi) / sample.frequency;
      const unit = bodyRms(buffer, (0.055 + 0.08) * targetRate,
        (0.055 + 0.18) * targetRate);
      const desired = first * targetRatio;
      const layerGain = Math.min(0.65,
        Math.sqrt(Math.max(0, desired ** 2 - remaining ** 2)) / Math.max(unit, 0.0001));
      if (layerGain <= 0.005) return;
      const next = transitions[index + 1];
      const layerEnd = next ? Math.min(end, when + next.at - offset + 0.025) : end;
      if (layerEnd <= arrival + 0.03) return;
      active.push(makeVoice(transition.midi, arrival, layerEnd,
        baseVolume * layerGain, 0.055, 0.028));
    };
    for (const [index, transition] of transitions.entries()) {
      if (transition.at <= offset) continue;
      const arrival = when + transition.at - offset;
      const targetVolume = transition.volume ?? currentVolume;
      if (transition.type === 'slide' || transition.type === 'bend') {
        const begin = Math.max(when, when + rampStart(transition) - offset);
        const gainBegin = Math.max(when, when + volumeStart(transition) - offset);
        chainGain.gain.setValueAtTime(currentVolume / baseVolume, gainBegin);
        chainGain.gain.linearRampToValueAtTime(targetVolume / baseVolume, arrival);
        for (const voice of active) {
          const fromRate = frequency(currentMidi) / voice.sample.frequency;
          const toRate = frequency(transition.midi) / voice.sample.frequency;
          voice.source.playbackRate.setValueAtTime(fromRate, begin);
          voice.source.playbackRate.exponentialRampToValueAtTime(toRate, arrival);
        }
        // A slide normally keeps the same string vibrating. Only add a soft
        // attack-skipped target body when that vibration has become too faint.
        if (transition.type === 'slide' && !transition.graceSlide)
          addBodyLayer(transition, index, arrival, 0.65);
      } else {
        chainGain.gain.setValueAtTime(currentVolume / baseVolume, arrival);
        chainGain.gain.linearRampToValueAtTime(targetVolume / baseVolume, arrival + 0.02);
        for (const voice of active) voice.source.playbackRate.setValueAtTime(
          frequency(transition.midi) / voice.sample.frequency, arrival);
        if (transition.type === 'pull' && transition.gap >= 0.5) {
          for (const voice of active) fade(voice, arrival);
          active = [makeVoice(transition.midi, arrival, end, baseVolume * 0.5, 0.055, 0.028)];
        } else if (transition.type === 'hammer' && transition.gap >= 0.5) {
          addBodyLayer(transition, index, arrival, 0.32);
        } else if (transition.type === 'pull') {
          for (const voice of active) {
            voice.gain.gain.setValueAtTime(voice.level, arrival);
            voice.gain.gain.linearRampToValueAtTime(voice.level * 1.5, arrival + 0.02);
          }
        }
      }
      currentMidi = transition.midi;
      currentVolume = targetVolume;
    }
    return () => {
      chainGain.gain.cancelScheduledValues(context.currentTime);
      chainGain.gain.setTargetAtTime(0, context.currentTime, 0.005);
      for (const voice of voices) {
        voice.gain.gain.cancelScheduledValues(context.currentTime);
        voice.gain.gain.setTargetAtTime(0, context.currentTime, 0.005);
        try { voice.source.stop(context.currentTime + 0.025); } catch {}
      }
    };
  };
  instrument.naturalDuration = (midi, string) => {
    const sample = key(midi, string), buffer = buffers.get(sample.url);
    return buffer.duration / (frequency(midi) / sample.frequency);
  };
  instrument.prepare = async (context, events) => {
    status('正在加载所需吉他音符…');
    try {
      manifestPromise ??= fetch('/audio/guitar/manifest.json').then(async response => {
        if (!response.ok) throw new Error('未找到转换后的吉他音源，可切换基础合成音色');
        return (await response.json()).samples;
      }).catch(error => { manifestPromise = null; throw error; });
      samples = await manifestPromise;
      const needed = new Map();
      for (const event of events) for (const [index, midi] of event.midi.entries()) {
        const sample = key(midi, event.strings?.[index]); needed.set(sample.url, sample);
      }
      await Promise.all([...needed.keys()].filter(url => !buffers.has(url)).map(async url => {
        const response = await fetch(url);
        if (!response.ok) throw new Error('吉他采样文件无法读取');
        buffers.set(url, await context.decodeAudioData(await response.arrayBuffer()));
      }));
      status('本地吉他采样已就绪');
    } catch (error) { status('音源加载失败，可切换基础合成'); throw error; }
  };
  return instrument;
}
