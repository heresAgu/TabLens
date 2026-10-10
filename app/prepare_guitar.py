"""Extract middle-dynamic guitar notes from local PCM AIFF recordings.

Original files are never modified. NumPy is needed only for preparation.
"""
import json
import re
import shutil
import struct
import wave
from pathlib import Path
import numpy as np

from bass_processing import process_bass_sample

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'app/web/audio/guitar'
PITCH = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}


def midi(name):
    match = re.fullmatch(r'([A-G])(b?)(\d)', name)
    return 12 * (int(match[3]) + 1) + PITCH[match[1]] - bool(match[2])


def read_aiff(path):
    blob = path.read_bytes()
    if blob[:4] != b'FORM' or blob[8:12] != b'AIFF':
        raise ValueError('Only uncompressed AIFF is supported')
    chunks, offset = {}, 12
    while offset + 8 <= len(blob):
        tag, size = blob[offset:offset + 4], int.from_bytes(blob[offset + 4:offset + 8], 'big')
        chunks[tag] = blob[offset + 8:offset + 8 + size]
        offset += 8 + size + size % 2
    channels, frames, bits = struct.unpack('>hIh', chunks[b'COMM'][:8])
    exponent, mantissa = struct.unpack('>HQ', chunks[b'COMM'][8:18])
    rate = round(mantissa * 2.0 ** ((exponent & 0x7fff) - 16383 - 63))
    if bits != 16 or channels != 2 or rate != 44100:
        raise ValueError(f'Unexpected PCM format: {channels}/{bits}/{rate}')
    sound = chunks[b'SSND']
    skip = int.from_bytes(sound[:4], 'big')
    data = np.frombuffer(sound[8 + skip:], dtype='>i2').reshape(-1, channels)
    if len(data) != frames:
        raise ValueError('Frame count mismatch')
    return data.astype(np.int16), rate


def remove_subbass(data, rate):
    """Remove recording DC/rumble before onset detection and normalization.

    Smooth zero-phase transition from 20 to 40 Hz, below guitar low E (~82 Hz).
    Originals remain untouched; returned PCM is used only for derived samples.
    """
    frequency = np.fft.rfftfreq(len(data), 1 / rate)
    ramp = np.clip((frequency - 20) / 20, 0, 1)
    response = np.sin(ramp * np.pi / 2) ** 2
    spectrum = np.fft.rfft(data.astype(float), axis=0)
    spectrum *= response[:, None]
    cleaned = np.fft.irfft(spectrum, n=len(data), axis=0)
    return np.clip(np.rint(cleaned), -32768, 32767).astype(np.int16)


def attack_offset(sample, rate):
    """Find a sustained attack at millisecond resolution, ignoring single noise peaks."""
    block, hop = max(1, round(rate * 0.005)), max(1, round(rate * 0.001))
    probe = sample[:min(len(sample), round(rate * 0.5))].astype(float)
    if len(probe) < block:
        return 0
    frames = np.lib.stride_tricks.sliding_window_view(probe, block, axis=0)[::hop]
    energy = np.sqrt(np.mean(frames ** 2, axis=(1, 2)))
    audible = np.flatnonzero(energy > energy.max() * 0.12)
    return max(0, int(audible[0]) * hop - round(rate * 0.002)) if len(audible) else 0


def reduce_background(sample, quiet):
    """Stereo-linked spectral suppression using an actual pre-attack noise profile.

    A soft gain floor and frequency smoothing avoid hard gates on guitar tails.
    Returns float PCM; the dry attack is preserved by the caller.
    """
    size, hop = 2048, 512
    if len(quiet) < size:
        return sample.astype(float)
    window = np.sqrt(np.hanning(size))
    noise_frames = np.lib.stride_tricks.sliding_window_view(quiet.astype(float), size, axis=0)[::hop]
    noise_spectrum = np.fft.rfft(noise_frames * window, axis=2)
    noise_power = np.mean(abs(noise_spectrum) ** 2, axis=(0, 1))
    padding = size // 2
    padded = np.pad(sample.astype(float), ((padding, padding + size), (0, 0)), mode='reflect')
    frames = np.lib.stride_tricks.sliding_window_view(padded, size, axis=0)[::hop]
    spectrum = np.fft.rfft(frames * window, axis=2)
    power = np.mean(abs(spectrum) ** 2, axis=1)
    gain = np.sqrt(np.maximum(0.02, 1 - 1.1 * noise_power / np.maximum(power, 1e-12)))
    smoothed = np.pad(gain, ((0, 0), (1, 1)), mode='edge')
    gain = 0.25 * smoothed[:, :-2] + 0.5 * smoothed[:, 1:-1] + 0.25 * smoothed[:, 2:]
    restored = np.fft.irfft(spectrum * gain[:, None, :], n=size, axis=2) * window
    output, weights = np.zeros_like(padded), np.zeros(len(padded))
    for index, frame in enumerate(restored):
        start = index * hop
        output[start:start + size] += frame.T
        weights[start:start + size] += window ** 2
    output /= np.maximum(weights[:, None], 1e-12)
    return output[padding:padding + len(sample)]


def refine_sample(sample, rate):
    offset = attack_offset(sample, rate)
    # Only denoise when a sufficiently long, quiet pre-attack recording exists.
    # A note that starts immediately supplies no reliable noise-only reference.
    quiet_end = offset - round(rate * 0.01)
    quiet = sample[:max(0, quiet_end)]
    dry = sample[offset:].astype(float)
    denoised = len(quiet) >= 2048
    wet = reduce_background(dry, quiet) if denoised else dry.copy()
    protect = min(len(dry), round(rate * 0.025))
    mix = np.linspace(0, 1, protect)[:, None]
    wet[:protect] = dry[:protect] * (1 - mix) + wet[:protect] * mix
    return wet, offset, denoised


def extract(path):
    data, rate = read_aiff(path)
    data = remove_subbass(data, rate)
    match = re.search(r'\.sul(E|A|D|G|B|_E)\.([A-G]b?\d)([A-G]b?\d)?\.aif$', path.name)
    string = {'E': 6, 'A': 5, 'D': 4, 'G': 3, 'B': 2, '_E': 1}[match[1]]
    low, high = midi(match[2]), midi(match[3] or match[2])
    notes = np.arange(low, high + 1)
    mono = data.mean(axis=1) / 32768
    size, hop, fft_size = 8192, 2048, 32768
    frames = np.lib.stride_tricks.sliding_window_view(mono, size)[::hop]
    spectra = abs(np.fft.rfft(frames * np.hanning(size), n=fft_size, axis=1))
    frequencies = np.fft.rfftfreq(fft_size, 1 / rate)
    energy = np.sqrt(np.mean(frames ** 2, axis=1))
    # Recordings are slightly detuned. Non-overlapping semitone bands retain
    # the filename's intended note while allowing up to 60 cents below it.
    scores = []
    for note in notes:
        fundamental = 440 * 2.0 ** ((note - 69) / 12)
        score = np.zeros(len(frames))
        for harmonic in range(1, 5):
            band = (frequencies >= fundamental * harmonic * 2 ** (-60 / 1200)) & (frequencies <= fundamental * harmonic * 2 ** (20 / 1200))
            score += spectra[:, band].max(axis=1) / harmonic
        scores.append(score)
    scores = np.array(scores).T
    labels = scores.argmax(axis=1)
    ranked = np.sort(scores, axis=1)
    confident = np.ones(len(frames), dtype=bool) if len(notes) == 1 else ranked[:, -1] > ranked[:, -2] * 1.3
    result = []
    previous_start = -rate
    for index, note in enumerate(notes):
        candidates = np.flatnonzero((labels == index) & confident & (energy > max(0.0003, energy.max() * 0.01)))
        if not len(candidates):
            raise ValueError(f'{path.name}: no confident sample for MIDI {note}')
        # A transient or a loud harmonic must not steal a note from another
        # part of the recording. Require a sustained classification and keep
        # the chromatic recording order declared in the source filename.
        runs = np.split(candidates, np.flatnonzero(np.diff(candidates) > 1) + 1)
        runs = [run for run in runs if len(run) >= 6 and run[0] * hop > previous_start + rate * 0.3]
        if not runs:
            print('Skipped uncertain sample', path.name, int(note))
            continue
        run = runs[0]
        peak = run[np.argmax(energy[run])]
        begin = int(peak)
        while begin > 0 and labels[begin - 1] == index and energy[begin - 1] > energy[peak] * 0.15 and peak - begin < rate / hop:
            begin -= 1
        start = max(0, begin * hop)
        # A short preceding quiet part can belong to the attack; trim it with
        # the stereo amplitude, rather than removing a fixed slice of sound.
        snippet = data[start:min(len(data), start + rate * 3)].astype(np.float64) / 32768
        envelope = np.max(abs(snippet), axis=1)
        audible = np.flatnonzero(envelope > max(0.0003, envelope.max() * 0.03))
        if not len(audible):
            raise ValueError('Empty audio sample')
        start += max(0, int(audible[0]) - 220)
        # Cut before a stable change to the next pitch, including high frets.
        end = min(len(data), start + rate * 10)
        for frame in range(peak + 3, min(len(labels) - 3, int(end / hop))):
            if np.all(labels[frame:frame + 3] != index) and np.all(confident[frame:frame + 3]) and energy[frame] > energy[peak] * 0.1:
                end = max(start + rate // 5, frame * hop)
                break
            # Stop before a new pluck of the same pitch, or sustained silence.
            # Keep the original decay instead of stretching a short sample.
            if frame > peak + 8:
                prior = np.median(energy[max(peak + 3, frame - 8):frame - 2])
                if energy[frame] > max(energy[peak] * 0.25, prior * 3):
                    end = max(start + rate // 5, frame * hop)
                    break
                quiet = energy[frame:frame + 8]
                if len(quiet) == 8 and np.all(quiet < energy[peak] * 0.01):
                    end = max(start + rate // 5, frame * hop)
                    break
        # Estimate tuning by fitting several harmonics, avoiding mistaking a
        # loud second harmonic for the fundamental frequency.
        spec = spectra[peak]
        base = 440 * 2.0 ** ((note - 69) / 12)
        cents = np.linspace(-60, 20, 161)
        bases = base * 2 ** (cents / 1200)
        fit = sum(np.interp(bases * harmonic, frequencies, spec) / harmonic for harmonic in range(1, 5))
        measured = float(bases[fit.argmax()])
        actual_cents = float(cents[fit.argmax()])
        if actual_cents <= -55 or actual_cents >= 19:
            print('Skipped tuning-edge sample', path.name, int(note))
            continue
        sample, fine_offset, denoised = refine_sample(data[start:end], rate)
        start += fine_offset
        amplitude = np.max(abs(sample))
        sample *= min(8, 0.8 * 32767 / amplitude)
        fade = min(441, len(sample) // 4)
        sample[:44] *= np.linspace(0, 1, 44)[:, None]
        sample[-fade:] *= np.linspace(1, 0, fade)[:, None]
        pcm = np.clip(sample, -32767, 32767).astype('<i2')
        if string in (5, 6):
            treated = process_bass_sample(pcm.astype(np.float64) / 32768, rate, measured, string)
            pcm = np.clip(np.rint(treated * 32767), -32768, 32767).astype('<i2')
        name = f's{string}-{int(note)}.wav'
        with wave.open(str(OUT / name), 'wb') as writer:
            writer.setnchannels(2); writer.setsampwidth(2); writer.setframerate(rate)
            writer.writeframes(pcm.tobytes())
        entry = {'string': string, 'midi': int(note), 'frequency': measured,
                 'url': f'/audio/guitar/{name}', 'source': path.name,
                 'sourceStart': round(start / rate, 4), 'duration': round(len(pcm) / rate, 4),
                 'tuningCents': actual_cents, 'attackTrimMs': round(fine_offset * 1000 / rate, 2),
                 'noiseReduced': denoised}
        if string in (5, 6):
            entry['bassTreatment'] = 'clear-sustain-c1'
        result.append(entry)
        previous_start = start
    return result


def replace_weak_open_a(samples):
    """Use the healthy fifth-string B2 take for the weak open-A recording.

    The player uses `frequency` to tune this same-string source down to A2.
    Keep source metadata explicit so later regeneration remains reproducible.
    """
    source = next(item for item in samples if item['string'] == 5 and item['midi'] == 47)
    target = next(item for item in samples if item['string'] == 5 and item['midi'] == 45)
    shutil.copyfile(OUT / 's5-47.wav', OUT / 's5-45.wav')
    for field in ('frequency', 'source', 'sourceStart', 'duration', 'tuningCents',
                  'attackTrimMs', 'noiseReduced', 'bassTreatment'):
        target[field] = source[field]
    target['sourceMidi'] = 47


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    samples = []
    for path in sorted((ROOT / 'Guitar.stereo.1644.1/1644stereo').glob('Guitar.mf.*.aif')):
        extracted = extract(path)
        samples.extend(extracted)
        print(path.name, len(extracted), 'notes')
    if not samples:
        raise RuntimeError('No local guitar recordings found')
    replace_weak_open_a(samples)
    manifest = {'name': '本地吉他采样 · mf', 'samples': samples}
    (OUT / 'manifest.json').write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding='utf-8')
    print('Prepared', len(samples), 'samples; originals preserved.')
