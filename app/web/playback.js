import {fraction, validate, dynamicLevel, dynamicGain} from './core.js';
import {autoStrumGain, getAutoStrumContrast} from './preferences.js';

export function pitches(score, event) {
  const tuning = score.tuningMidi ?? [64, 59, 55, 50, 45, 40];
  const capo = score.capo ?? 0;
  if (!Number.isInteger(capo) || capo < 0 || capo > 24 || tuning.length !== 6 || tuning.some(n => !Number.isInteger(n))) throw new Error('调弦或变调夹设置无效');
  if (event.kind === 'rest' && !event.notes.length) return [];
  if (!event.notes.length) throw new Error('空位置需要添加音符、设为休止或删除');
  return event.notes.map(note => {
    if (note.fret === null) throw new Error('请先确认未知品位');
    return tuning[note.string - 1] + note.fret + capo;
  });
}

const STRUM_TIME = [0, 0.19, 0.48, 0.77, 1];
const STRUM_WOBBLE = [0, 0.0015, -0.0015, 0.001, 0];
const DOWN_STRENGTH = [1.08, 1.03, 0.98, 0.94, 0.90];
const UP_STRENGTH = [1, 0.98, 0.90, 0.82, 0.75];
const AUTO_FAST = 0.08, AUTO_STANDARD = 0.16, AUTO_MAX_SECONDS = 0.12;

// The gap to the next position is the current event's duration. An adjacent
// opposite stroke keeps a quick motion; an isolated beat gets more room.
function automaticStrumSpread(events, index) {
  const current = events[index], value = fraction(current.duration);
  if (value === null) return AUTO_FAST;
  const beats = value * 4;
  const previous = events[index - 1], next = events[index + 1];
  const previousBeats = previous?.duration == null ? null : fraction(previous.duration) * 4;
  const alternating = (other, gap) => other?.strum && current.strum &&
    other.strum.direction !== current.strum.direction && gap !== null && gap <= 1;
  if (alternating(previous, previousBeats) || alternating(next, beats)) return AUTO_FAST;
  return beats >= 1 ? AUTO_STANDARD : AUTO_FAST;
}

export function suggestedStrumSpread(score, eventId) {
  const events = score.measures.flatMap(measure => measure.events);
  const index = events.findIndex(event => event.id === eventId);
  return index < 0 ? AUTO_FAST : automaticStrumSpread(events, index);
}

export function suggestedStrumDynamic(score, event) {
  if (!event.strum?.autoDynamics) return 'normal';
  const spread = event.strum.speedMode === 'auto'
    ? suggestedStrumSpread(score, event.id) : event.strum.spreadBeats;
  return spread <= AUTO_FAST ? 'soft' : 'normal';
}

export function effectiveDynamicLevel(score, event, note) {
  return dynamicLevel(event, note, suggestedStrumDynamic(score, event));
}

// This contour is derived from score rhythm, including legacy strums without
// autoDynamics. It never rewrites a saved score or its per-string dynamics.
function accentAtBeat(score, beat) {
  const [count, denominator] = score.timeSignature ?? [4, 4];
  const beatLength = denominator === 8 && count > 3 && count % 3 === 0 ? 1.5 : 4 / denominator;
  if (!Number.isFinite(beatLength) || beatLength <= 0) return 1;
  const position = beat / beatLength;
  const nearest = Math.round(position);
  if (Math.abs(position - nearest) < 0.08) {
    if (nearest === 0) return 1.07;
    if (count === 4) return [1.07, 1.02, 1.04, 0.99][nearest % 4];
    return nearest % 2 === 0 ? 1.01 : 0.99;
  }
  return Math.abs(position - Math.floor(position) - 0.5) < 0.08 ? 0.97 : 0.94;
}

export function strumAccents(score) {
  const accents = new Map();
  for (const measure of score.measures) {
    let beat = 0;
    for (const event of measure.events) {
      if (event.strum) accents.set(event.id, accentAtBeat(score, beat));
      const duration = fraction(event.duration);
      beat += duration === null ? 0.5 : duration * 4;
    }
  }
  return accents;
}

export function suggestedStrumAccent(score, event) {
  return strumAccents(score).get(event.id) ?? 1;
}

export function strumVolumeGain(score, event, accents = null, contrast = getAutoStrumContrast()) {
  if (!event.strum) return 1;
  if (event.strum.volume !== undefined) return dynamicGain(event.strum.volume);
  return autoStrumGain(accents?.get(event.id) ?? suggestedStrumAccent(score, event), contrast);
}

function along(points, progress) {
  const position = progress * (points.length - 1), left = Math.floor(position);
  return left === points.length - 1 ? points[left] :
    points[left] + (points[left + 1] - points[left]) * (position - left);
}

// Articulation is derived at playback time; score timing and note dynamics
// remain untouched. The same offsets drive audio and the highlighted strings.
export function strumArticulation(event, bpm) {
  const result = new Map();
  if (!event.strum || (event.strings?.length ?? 0) < 2) return result;
  const up = event.strum.direction === 'up';
  const strings = [...event.strings].sort((a, b) => up ? a - b : b - a);
  const span = Math.min(event.duration * 0.8, event.strum.spreadBeats * 60 / bpm,
    event.strum.speedMode === 'auto' ? AUTO_MAX_SECONDS : Infinity);
  const fallback = [...String(event.id ?? '')].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const ordinal = Number.isInteger(event.index) && event.index > 0 ? event.index - 1 : fallback;
  const wobbleSign = Math.floor(ordinal / 2) % 2 ? -1 : 1;
  strings.forEach((string, index) => {
    const progress = index / (strings.length - 1);
    const offset = span * along(STRUM_TIME, progress) +
      wobbleSign * along(STRUM_WOBBLE, progress) * Math.min(1, span / 0.06);
    const gain = along(up ? UP_STRENGTH : DOWN_STRENGTH, progress) * (up ? 0.82 : 1);
    result.set(string, {offset, gain, attack: up ? 0.010 : 0.005});
  });
  return result;
}

export function strumOffsets(event, bpm) {
  return new Map([...strumArticulation(event, bpm)].map(([string, style]) => [string, style.offset]));
}

export function timeline(score, bpm, range = null) {
  validate(score);
  if (!Number.isFinite(bpm) || bpm < 10 || bpm > 300) throw new Error('实际练习速度须在10–300 BPM之间');
  let total = 0;
  const events = [];
  if (range && (!Number.isInteger(range.from) || !Number.isInteger(range.to) || range.from < 0 || range.to >= score.measures.length || range.from > range.to)) throw new Error('练习范围的起始小节不能晚于结束小节');
  const measures = range ? score.measures.slice(range.from, range.to + 1) : score.measures;
  const allEvents = score.measures.flatMap(measure => measure.events);
  const automaticAccents = strumAccents(score);
  const strumContrast = getAutoStrumContrast();
  const automaticSpreads = new Map();
  allEvents.forEach((event, index) => {
    if (event.strum?.speedMode === 'auto') automaticSpreads.set(event.id, automaticStrumSpread(allEvents, index));
  });
  let started=!range?.startEventId;
  for (const measure of measures) for (const [index, event] of measure.events.entries()) {
    if(!started){if(event.id!==range.startEventId)continue;started=true;}
    try {
      const value = fraction(event.duration);
      if (value === null) throw new Error('请先设置这个位置的节奏');
      const midi = pitches(score, event);
      const duration = value * 4 * 60 / bpm;
      events.push({id: event.id, measure: measure.number, index: index + 1, start: total, duration, midi,
        strings: event.notes.map(note => note.string), noteIds: event.notes.map(note => note.id),
        techniques: event.notes.map(note => note.technique ?? null),
        graces: event.notes.map(note => note.graceBefore ? {
          ...note.graceBefore,
          midi: (score.tuningMidi ?? [64, 59, 55, 50, 45, 40])[note.graceBefore.string - 1] +
            note.graceBefore.fret + (score.capo ?? 0),
          lead: Math.min(duration * 0.45, 0.18, Math.max(0.03, note.graceBefore.leadBeats * 60 / bpm))
        } : null),
        bends: event.notes.map(note => note.bend ?? null),
        sustain: event.sustain,
        strum: event.strum?.speedMode === 'auto'
          ? {...event.strum, spreadBeats: automaticSpreads.get(event.id)} : event.strum ?? null,
        strumGain: strumVolumeGain(score, event, automaticAccents, strumContrast),
        dynamics: event.notes.map(note => effectiveDynamicLevel(score, event, note))});
      total += duration;
    } catch (error) { error.eventId = event.id; throw error; }
  }
  if(!started)throw new Error('选中位置不在练习范围内');
  if (!events.length) throw new Error('乐谱中还没有演奏位置');
  return {events, total, bpm};
}

// Musical time and acoustic lifetime are separate. A new note only replaces
// the previous note on the same string; rests leave the other strings ringing.
export function voicePlan(data, options = {}, naturalDuration = () => 3) {
  const notes = [];
  for (const event of data.events) {
    const stroke = strumArticulation(event, data.bpm);
    for (const [index, midi] of event.midi.entries()) {
      const string = event.strings?.[index], style = stroke.get(string);
      const noteStart = event.start + (style?.offset ?? 0);
      const natural = event.sustain === 'natural' || (event.sustain !== 'timed' && options.sustain === 'natural');
      const volume = 0.16 * dynamicGain(event.dynamics?.[index]) / Math.sqrt(event.midi.length) *
        (style?.gain ?? 1) * (event.strum ? event.strumGain ?? 1 : 1);
      const grace = event.graces?.[index];
      const technique = grace && grace.articulation !== 'pick' ?
        {type: grace.articulation, fromNoteId: grace.id,
          ratio: grace.articulation === 'slide' ? 0.75 : 0.2,
          graceSlide: grace.articulation === 'slide'} : event.techniques?.[index];
      notes.push({start: noteStart, end: natural ? noteStart + naturalDuration(midi, string) : event.start + event.duration,
        duration: event.duration, midi, string, natural, noteId: event.noteIds?.[index],
        technique, bend: event.bends?.[index], volume, attack: style?.attack,
        strumDirection: style ? event.strum.direction : null});
      if (grace) notes.push({start: noteStart - grace.lead, end: noteStart,
        duration: grace.lead, midi: grace.midi, string: grace.string, natural: false,
        noteId: grace.id, technique: null, bend: null, volume: volume * (grace.articulation === 'slide' ? 0.22 : 0.7), isGrace: true,
        eventId: event.id});
    }
  }
  notes.sort((a, b) => a.start - b.start);
  const nextString = new Map();
  if (options.loop) for (const note of notes) if (note.start < 0 && note.string != null)
    nextString.set(note.string, Math.min(nextString.get(note.string) ?? Infinity, data.total + note.start));
  for (const note of [...notes].reverse()) {
    if (note.natural && note.string != null && nextString.has(note.string))
      note.end = Math.min(note.end, nextString.get(note.string));
    if (options.loop) note.end = Math.min(note.end, data.total);
    if (note.string != null) nextString.set(note.string, note.start);
  }
  const chains = new Map(), plan = [];
  for (const note of notes) {
    const source = note.technique && chains.get(note.technique.fromNoteId);
    let chain;
    if (source && source.string === note.string && note.start > source.lastOnset) {
      chain = source;
      chain.transitions.push({type: note.technique.type, at: note.start - chain.start,
        gap: note.start - chain.lastOnset, midi: note.midi,
        ratio: note.technique.ratio ?? 0.2, volume: note.volume,
        graceSlide: !!note.technique.graceSlide});
      chain.end = note.end;
      chain.lastOnset = note.start;
    } else {
      chain = note;
      chain.transitions = [];
      chain.lastOnset = note.start;
      plan.push(chain);
    }
    if (note.noteId) chains.set(note.noteId, chain);
    if (note.bend) {
      const onset = note.start - chain.start;
      chain.transitions.push({type: 'bend', begin: onset,
        at: onset + note.duration * note.bend.reachRatio,
        midi: note.midi + note.bend.semitones, volume: note.volume});
      if (note.bend.release) chain.transitions.push({type: 'bend',
        begin: onset + note.duration * 0.65, at: onset + note.duration * 0.9,
        midi: note.midi, volume: note.volume});
    }
  }
  return plan;
}

// A small harmonic pluck synth. All notes in a chord share one audio clock.
export function pluck(context, midi, when, duration, volume = 0.13, string, {offset = 0, natural = false, transitions = [], attack = 0.006, destination=context.destination} = {}) {
  const gain = context.createGain(), volumeGain = context.createGain();
  gain.connect(volumeGain); volumeGain.connect(destination);
  const baseVolume = Math.max(volume, ...transitions.map(item => item.volume ?? volume), 0.001);
  gain.gain.setValueAtTime(0, when);
  const level = natural ? baseVolume * Math.exp(-2 * offset) : baseVolume;
  gain.gain.linearRampToValueAtTime(level, when + (transitions[0]?.graceSlide ? 0.018 : attack));
  const end = when + Math.max(0.025, duration);
  if (natural) {
    const release = Math.max(when + attack, end - 0.02);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, level * Math.exp(-2 * (release - when))), release);
    gain.gain.linearRampToValueAtTime(0, end);
  } else gain.gain.exponentialRampToValueAtTime(0.0001, end);
  let activeMidi = midi;
  for (const transition of transitions) {
    if (transition.at <= offset) activeMidi = transition.midi;
    else if (['slide', 'bend'].includes(transition.type)) {
      const begin = transition.type === 'bend' ? transition.begin : transition.at - transition.gap * transition.ratio;
      if (offset > begin) {
        activeMidi += (transition.midi - activeMidi) * (offset - begin) / (transition.at - begin);
      }
      break;
    } else break;
  }
  let currentVolume = volume;
  for (const transition of transitions) {
    if (transition.at <= offset) currentVolume = transition.volume ?? currentVolume;
    else break;
  }
  const volumeStart = item => item.graceSlide ? item.at - item.gap * 0.35 :
    item.type === 'bend' ? item.begin : item.at - item.gap * item.ratio;
  const pendingVolumeSlide = transitions.find(item => item.type === 'slide' &&
    item.at > offset && volumeStart(item) < offset);
  if (pendingVolumeSlide) {
    const progress = (offset - volumeStart(pendingVolumeSlide)) /
      (pendingVolumeSlide.at - volumeStart(pendingVolumeSlide));
    currentVolume += ((pendingVolumeSlide.volume ?? currentVolume) - currentVolume) * progress;
  }
  volumeGain.gain.setValueAtTime(currentVolume / baseVolume, when);
  for (const transition of transitions) {
    if (transition.at <= offset) continue;
    const arrival = when + transition.at - offset;
    const targetVolume = transition.volume ?? currentVolume;
    if (transition.type === 'slide' || transition.type === 'bend') {
      const begin = Math.max(when, when + volumeStart(transition) - offset);
      volumeGain.gain.setValueAtTime(currentVolume / baseVolume, begin);
      volumeGain.gain.linearRampToValueAtTime(targetVolume / baseVolume, arrival);
    } else {
      volumeGain.gain.setValueAtTime(currentVolume / baseVolume, arrival);
      volumeGain.gain.linearRampToValueAtTime(targetVolume / baseVolume, arrival + 0.02);
    }
    currentVolume = targetVolume;
  }
  const nodes = [1, 2, 3, 4].map((harmonic, index) => {
    const oscillator = context.createOscillator(), level = context.createGain();
    oscillator.frequency.value = 440 * 2 ** ((activeMidi - 69) / 12) * harmonic;
    let priorMidi = midi;
    for (const transition of transitions) {
      if (transition.at <= offset) { priorMidi = transition.midi; continue; }
      const arrival = when + transition.at - offset;
      const targetHz = 440 * 2 ** ((transition.midi - 69) / 12) * harmonic;
      if (transition.type === 'slide' || transition.type === 'bend') {
        const rampStart = Math.max(when, when + (transition.type === 'bend' ? transition.begin : transition.at - transition.gap * transition.ratio) - offset);
        const startHz = 440 * 2 ** ((priorMidi - 69) / 12) * harmonic;
        oscillator.frequency.setValueAtTime(rampStart === when ? oscillator.frequency.value : startHz, rampStart);
        oscillator.frequency.exponentialRampToValueAtTime(targetHz, arrival);
      } else oscillator.frequency.setValueAtTime(targetHz, arrival);
      priorMidi = transition.midi;
    }
    level.gain.value = [0.65, 0.2, 0.1, 0.05][index];
    oscillator.connect(level); level.connect(gain);
    oscillator.start(when); oscillator.stop(end + 0.01);
    oscillator.onended = () => { oscillator.disconnect(); level.disconnect(); };
    return oscillator;
  });
  nodes[0].addEventListener('ended', () => { gain.disconnect(); volumeGain.disconnect(); });
  return () => {
    volumeGain.gain.cancelScheduledValues(context.currentTime);
    volumeGain.gain.setTargetAtTime(0, context.currentTime, 0.005);
    gain.gain.cancelScheduledValues(context.currentTime);
    gain.gain.setTargetAtTime(0.0001, context.currentTime, 0.005);
    for (const node of nodes) { try { node.stop(context.currentTime + 0.025); } catch {} }
  };
}
pluck.naturalDuration = () => 3;

export function clickSound(context, when,destination=context.destination) {
  const oscillator = context.createOscillator(), gain = context.createGain();
  oscillator.frequency.value = 1200;
  oscillator.connect(gain); gain.connect(destination);
  gain.gain.setValueAtTime(0.08, when);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.045);
  oscillator.start(when); oscillator.stop(when + 0.05);
  oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  return () => { try { oscillator.stop(context.currentTime); } catch {} };
}

export class Player {
  // Future sample instruments implement this same (context, midi, time,
  // duration, volume) => cancel contract; transport and TAB stay independent.
  constructor(update, instrument = pluck) {
    this.update = update; this.state = 'stopped'; this.offset = 0; this.voices = []; this.generation = 0;
    this.instrument = instrument;
    this.masterVolume=100;this.muted=false;
  }
  setVolume(volume,muted=this.muted){
    if(!Number.isFinite(volume)||volume<0||volume>100)throw new Error('总音量须为0–100');
    this.masterVolume=volume;this.muted=Boolean(muted);
    if(this.master){const now=this.context.currentTime;this.master.gain.cancelScheduledValues(now);this.master.gain.setTargetAtTime(this.muted?0:volume/100,now,0.01);}
  }
  async audio() {
    this.context ??= new AudioContext();
    if(!this.master){this.master=this.context.createGain();this.master.gain.value=this.muted?0:this.masterVolume/100;this.master.connect(this.context.destination);}
    await this.context.resume();
    if (this.context.state !== 'running') throw new Error('浏览器未能启用声音，请再次点击播放');
    return this.context;
  }
  silence() { for (const voice of this.voices) voice.stop(); this.voices = []; cancelAnimationFrame(this.frame); clearInterval(this.scheduler); }
  stop() {
    this.generation++; this.silence(); this.state = 'stopped'; this.offset = 0; this.data = null;
    this.update({state: this.state, time: 0, total: 0, event: null, progress: 0});
  }
  pause() {
    if (this.state !== 'playing') return;
    this.offset = this.context.currentTime - this.origin;
    this.generation++; this.silence(); this.state = 'paused'; this.tick();
  }
  async play(data, options = {}) {
    const resuming = this.state === 'paused';
    this.silence();
    const generation = ++this.generation;
    const context = await this.audio();
    const graceSamples = data.events.flatMap(event => (event.graces ?? [])
      .filter(Boolean).map(grace => ({midi: [grace.midi], strings: [grace.string]})));
    await this.instrument.prepare?.(context, [...data.events, ...graceSamples]);
    if (generation !== this.generation) return;
    if (!resuming) {
      this.data = data; this.options = options;
    }
    this.plan = voicePlan(this.data, this.options, this.instrument.naturalDuration);
    if (!resuming) this.offset = options.countIn ? -4 * 60 / data.bpm :
      Math.min(0, ...this.plan.map(voice => voice.start));
    this.finish = Math.max(this.data.total, ...this.plan.map(voice => voice.end));
    this.origin = context.currentTime + 0.035 - this.offset;
    this.state = 'playing';
    const local = Math.max(0, this.offset);
    this.cycle = this.options.loop ? Math.floor(local / data.total) : 0;
    this.nextVoice = 0;
    this.nextClick = Math.ceil(this.offset / (60 / data.bpm));
    this.schedule();
    this.scheduler = setInterval(() => this.schedule(), 25);
    this.tick();
  }
  schedule() {
    if (this.state !== 'playing') return;
    const context = this.context, elapsed = context.currentTime - this.origin;
    const horizon = elapsed + 0.15, {total, bpm} = this.data;
    this.voices = this.voices.filter(voice => voice.end >= context.currentTime);
    while (true) {
      if (this.nextVoice >= this.plan.length) {
        if (!this.options.loop || !this.plan.length) break;
        this.nextVoice = 0; this.cycle++;
      }
      const voice = this.plan[this.nextVoice], start = this.cycle * total + voice.start;
      if (start > horizon) break;
      const attack = Math.max(start, this.offset, elapsed);
      const remaining = this.cycle * total + voice.end - attack;
      if (remaining > 0 && (voice.volume > 0 || voice.transitions?.some(item => item.volume > 0))) {
        const when = Math.max(context.currentTime, this.origin + Math.max(start, this.offset));
        this.voices.push({stop: this.instrument(context, voice.midi, when, remaining, voice.volume, voice.string,
          {offset: Math.max(0, attack - start), natural: voice.natural, transitions: voice.transitions,
            attack: voice.attack, strumDirection: voice.strumDirection,
            destination:this.master??context.destination}), end: when + remaining + 0.02});
      }
      this.nextVoice++;
    }
    const beat = 60 / bpm;
    while (this.nextClick * beat <= horizon) {
      const time = this.nextClick * beat;
      if (!this.options.loop && time >= total) break;
      if (((time < 0 && this.options.countIn) || this.options.metronome) && time >= elapsed - 0.025) {
        const when = Math.max(context.currentTime, this.origin + time);
        this.voices.push({stop: clickSound(context, when,this.master??context.destination), end: when + 0.05});
      }
      this.nextClick++;
    }
  }
  tick() {
    const elapsed = this.state === 'playing' ? this.context.currentTime - this.origin : this.offset;
    const time = elapsed < 0 ? 0 : this.options?.loop ? elapsed % this.data.total : elapsed;
    if (this.state === 'playing' && !this.options.loop && elapsed >= this.finish) {
      const total = this.data.total;
      this.silence(); this.state = 'stopped'; this.offset = 0;
      this.update({state: 'stopped', time: total, total, event: null, progress: 0}); return;
    }
    const position = elapsed < 0 ? elapsed : time;
    let grace = null;
    for (const candidate of this.data?.events ?? []) {
      for (const item of candidate.graces ?? []) if (item &&
          position >= candidate.start - item.lead && position < candidate.start) {
        grace = {event: candidate, id: item.id}; break;
      }
      if (grace) break;
    }
    if (!grace && this.options?.loop && elapsed >= 0) {
      const first = this.data.events[0];
      for (const item of first?.graces ?? []) if (item &&
          position >= this.data.total - item.lead) {
        grace = {event: first, id: item.id}; break;
      }
    }
    const event = grace?.event ?? (elapsed < 0 ? null :
      this.data?.events.find(e => time >= e.start && time < e.start + e.duration) ?? null);
    const soundingStrings = event?.strum && !grace ? event.strings.filter(string =>
      (strumOffsets(event, this.data.bpm).get(string) ?? 0) <= time - event.start + 0.001) : null;
    this.update({state: this.state, time: Math.min(time, this.data?.total ?? 0), total: this.data?.total ?? 0,
      event, soundingStrings, graceNoteId: grace?.id ?? null, progress: grace ? 0 : event ? (time - event.start) / event.duration : 0,
      tail: elapsed >= this.data?.total && !this.options?.loop,
      countIn: elapsed < 0 && this.options?.countIn ? Math.min(4, Math.ceil(-elapsed / (60 / this.data.bpm))) : 0,
      cycle: this.options?.loop && elapsed >= 0 ? Math.floor(elapsed / this.data.total) + 1 : null});
    if (this.state === 'playing') this.frame = requestAnimationFrame(() => this.tick());
  }
  async preview(midi, strings = [], sustain = 'natural', dynamics = [], selection = null) {
    this.stop();
    const generation = this.generation;
    const context = await this.audio();
    const ornamented = selection?.event.notes.some(note => note.graceBefore || note.bend) || !!selection?.event.strum;
    if (ornamented) {
      const {score, event, bpm} = selection;
      const measure = score.measures.find(item => item.events.some(position => position.id === event.id));
      const originalIndex = measure?.events.findIndex(position => position.id === event.id);
      const duration = event.duration ? fraction(event.duration) * 4 * 60 / bpm : 0.8;
      const graces = event.notes.map(note => note.graceBefore ? {
        ...note.graceBefore,
        midi: score.tuningMidi[note.graceBefore.string - 1] + note.graceBefore.fret + score.capo,
        lead: Math.min(duration * 0.45, 0.18, Math.max(0.03, note.graceBefore.leadBeats * 60 / bpm))
      } : null);
      const data = {events: [{
        id: event.id, index: originalIndex === undefined ? undefined : originalIndex + 1,
        start: 0, duration, midi, strings,
        noteIds: event.notes.map(note => note.id),
        graces, bends: event.notes.map(note => note.bend ?? null),
        techniques: event.notes.map(note => note.technique ?? null),
        dynamics, sustain: event.sustain,
        strum: event.strum?.speedMode === 'auto'
          ? {...event.strum, spreadBeats: suggestedStrumSpread(score, event.id)} : event.strum ?? null,
        strumGain: strumVolumeGain(score, event)
      }], total: duration, bpm};
      await this.instrument.prepare?.(context, [
        data.events[0], ...graces.filter(Boolean).map(grace => ({midi: [grace.midi], strings: [grace.string]}))
      ]);
      if (generation !== this.generation) return;
      const plan = voicePlan(data, {sustain}, this.instrument.naturalDuration);
      const lead = Math.min(0, ...plan.map(voice => voice.start));
      const origin = context.currentTime + 0.025 - lead;
      for (const voice of plan) {
        const when = origin + voice.start, length = voice.end - voice.start;
        if (length <= 0 || (voice.volume === 0 && !voice.transitions?.some(item => item.volume > 0))) continue;
        this.voices.push({stop: this.instrument(context, voice.midi, when, length, voice.volume, voice.string,
          {natural: voice.natural, transitions: voice.transitions, attack: voice.attack,
            strumDirection: voice.strumDirection,
            destination: this.master ?? context.destination}),
          end: when + length + 0.02});
      }
      return;
    }
    await this.instrument.prepare?.(context, [{midi, strings}]);
    if (generation !== this.generation) return;
    const when = context.currentTime + 0.025;
    for (const [index, note] of midi.entries()) {
      const duration = sustain === 'natural' ? (this.instrument.naturalDuration?.(note, strings[index]) ?? 3) : 0.8;
      const volume = 0.16 * dynamicGain(dynamics[index]) / Math.sqrt(midi.length);
      if(volume===0)continue;
      this.voices.push({stop: this.instrument(context, note, when, duration, volume, strings[index], {natural: sustain === 'natural',destination:this.master??context.destination}), end: when + duration + 0.02});
    }
  }
}
