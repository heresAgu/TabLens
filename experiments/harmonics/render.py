"""Offline A/B samples for natural guitar harmonics. No application code changes."""
from pathlib import Path
import json
import math
import wave

import numpy as np


ROOT = Path(__file__).resolve().parents[2]
SAMPLES = ROOT / 'app' / 'web' / 'audio' / 'guitar'
OUTPUT = ROOT / 'experiments' / '.runtime' / 'harmonics'
OUTPUT.mkdir(parents=True, exist_ok=True)
RATE = 44100
MANIFEST = json.loads((SAMPLES / 'manifest.json').read_text(encoding='utf-8'))['samples']
BY_STRING = {string: [item for item in MANIFEST if item['string'] == string] for string in (1, 3)}


def read(item):
    with wave.open(str(SAMPLES / Path(item['url']).name), 'rb') as handle:
        assert (handle.getnchannels(), handle.getsampwidth(), handle.getframerate()) == (2, 2, RATE)
        return np.frombuffer(handle.readframes(handle.getnframes()), dtype='<i2').reshape(-1, 2).astype(np.float64) / 32768


def soften_attack(audio, offset=.012):
    start = round(offset * RATE)
    result = audio[start:].copy()
    count = min(len(result), round(.012 * RATE))
    result[:count] *= np.linspace(0, 1, count)[:, None]
    return result


def partial_filter(audio, fundamental, order):
    """At a 1/order string node, preserve partials order, 2*order, ..."""
    size, hop = 8192, 1024
    window = np.hanning(size)
    frequencies = np.fft.rfftfreq(size, 1 / RATE)
    mask = np.zeros(len(frequencies))
    for multiple in range(order, int(12500 / fundamental) + 1, order):
        center = fundamental * multiple
        mask = np.maximum(mask, np.exp(-.5 * ((frequencies - center) / 25) ** 2))
    padded = np.pad(audio, ((size // 2, size // 2 + size), (0, 0)))
    result = np.zeros_like(padded)
    weights = np.zeros(len(padded))
    for start in range(0, len(padded) - size + 1, hop):
        block = padded[start:start + size] * window[:, None]
        filtered = np.fft.irfft(np.fft.rfft(block, axis=0) * mask[:, None], n=size, axis=0)
        result[start:start + size] += filtered * window[:, None]
        weights[start:start + size] += window ** 2
    result /= np.maximum(weights[:, None], 1e-9)
    return result[size // 2:size // 2 + len(audio)]


def normal_sample(string, target_frequency, duration):
    source = min(BY_STRING[string], key=lambda item: abs(math.log(item['frequency'] / target_frequency)))
    raw = soften_attack(read(source))
    positions = np.arange(round(duration * RATE)) * target_frequency / source['frequency']
    channels = [np.interp(positions, np.arange(len(raw)), raw[:, side], right=0) for side in range(2)]
    return np.stack(channels, axis=1), source


def envelope(audio, duration):
    count = round(duration * RATE)
    out = np.zeros((count, 2))
    out[:min(count, len(audio))] = audio[:count]
    attack = round(.009 * RATE)
    release = round(.08 * RATE)
    out[:attack] *= np.linspace(0, 1, attack)[:, None]
    out[-release:] *= np.linspace(1, 0, release)[:, None]
    return out


def level(audio, target=.065):
    section = audio[round(.07 * RATE):round(.65 * RATE)]
    rms = float(np.sqrt(np.mean(section ** 2)))
    return audio * min(12.0, target / max(rms, .0001)), rms


def bell_voice(frequency, duration, bright=False):
    """Immediate, quiet harmonic tone without a recorded pick transient."""
    time = np.arange(round(duration * RATE)) / RATE
    partials = ((1, .83, 2.1), (2, .12, .95), (3, .04, .42), (4, .01, .25)) if not bright else (
        (1, .69, 1.9), (2, .24, .82), (3, .055, .38), (4, .015, .22))
    mono = np.zeros(len(time))
    for multiple, strength, decay in partials:
        mono += strength * np.sin(2 * np.pi * frequency * multiple * time) * np.exp(-time / decay)
    # A 1.5 ms fade removes the digital click without the audible onset delay.
    onset = min(len(mono), round(.0015 * RATE))
    mono[:onset] *= np.linspace(0, 1, onset)
    release = min(len(mono), round(.075 * RATE))
    mono[-release:] *= np.linspace(1, 0, release)
    return np.stack((mono, .97 * mono), axis=1)


def save(path, signal):
    signal = signal * min(1, .91 / max(1e-9, np.max(np.abs(signal))))
    pcm = np.round(np.clip(signal, -1, 1) * 32767).astype('<i2')
    with wave.open(str(path), 'wb') as handle:
        handle.setnchannels(2)
        handle.setsampwidth(2)
        handle.setframerate(RATE)
        handle.writeframes(pcm.tobytes())


def main():
    duration, gap = 1.4, .24
    clips = {name: [] for name in ('01_normal_pitch', '02_filtered_open_string', '03_blend',
                                   '04_soft_glass', '05_clear_music_box')}
    details = []
    # The open string's partials 2/3/4 correspond approximately to frets 12/7/5.
    for string, open_midi in ((1, 64), (3, 55)):
        source = next(item for item in BY_STRING[string] if item['midi'] == open_midi)
        raw = read(source)
        for fret, order in ((12, 2), (7, 3), (5, 4)):
            target = source['frequency'] * order
            ordinary, ordinary_source = normal_sample(string, target, duration)
            filtered = partial_filter(raw[:round(duration * RATE)], source['frequency'], order)
            variants = {'01_normal_pitch': ordinary,
                        '02_filtered_open_string': filtered,
                        '03_blend': .78 * filtered + .22 * ordinary,
                        '04_soft_glass': bell_voice(target, duration),
                        '05_clear_music_box': bell_voice(target, duration, bright=True)}
            measurements = {}
            for name, audio in variants.items():
                if name.startswith(('04_', '05_')):
                    audio, rms = level(audio, .028 if name.startswith('04_') else .034)
                else:
                    audio, rms = level(envelope(audio, duration))
                clips[name].append(audio)
                clips[name].append(np.zeros((round(gap * RATE), 2)))
                measurements[name] = round(rms, 5)
            details.append({'string': string, 'fret': fret, 'partial': order,
                            'targetHz': round(target, 2), 'ordinarySourceMidi': ordinary_source['midi'],
                            'rmsBeforeLeveling': measurements})
    for name, pieces in clips.items():
        save(OUTPUT / f'{name}.wav', np.concatenate(pieces))
    (OUTPUT / 'details.json').write_text(json.dumps(details, ensure_ascii=False, indent=2), encoding='utf-8')
    print(OUTPUT)
    for item in details:
        print(item)


if __name__ == '__main__':
    main()
