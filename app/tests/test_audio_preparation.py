import json
import sys
import unittest
import wave
from pathlib import Path

import numpy as np

APP = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP))
from prepare_guitar import remove_subbass, attack_offset, refine_sample, reduce_background
from bass_processing import process_bass_sample


class AudioPreparationTests(unittest.TestCase):
    def test_removes_dc_and_rumble_without_attenuating_guitar_notes(self):
        rate = 44100
        time = np.arange(rate * 2) / rate
        noise = 3000 + 6000 * np.sin(2 * np.pi * 3 * time)
        tone = 1000 * np.sin(2 * np.pi * 82 * time) + 500 * np.sin(2 * np.pi * 164 * time)
        stereo = np.column_stack([noise + tone, noise + tone]).astype(np.int16)
        cleaned = remove_subbass(stereo, rate).astype(float)
        self.assertLess(abs(cleaned.mean()), 1)
        self.assertLess(np.sqrt(np.mean((cleaned[:, 0] - tone) ** 2)), 2)
        np.testing.assert_array_equal(cleaned[:, 0], cleaned[:, 1])

    def test_bass_treatment_keeps_tone_and_suppresses_tail_noise(self):
        rate = 8000
        time = np.arange(rate * 3) / rate
        rng = np.random.default_rng(456)
        tone = .12 * np.sin(2 * np.pi * 82.4 * time) * np.exp(-2 * time)
        noise = rng.normal(0, .003, len(time))
        original = np.column_stack([tone + noise, tone + noise])
        treated = process_bass_sample(original, rate, 82.4, 6)
        self.assertEqual(treated.shape, original.shape)
        self.assertGreater(np.sqrt(np.mean(treated[rate:rate * 2] ** 2)),
                           np.sqrt(np.mean(original[rate:rate * 2] ** 2)))
        self.assertLess(abs(treated[-1]).max(), 1e-8)
        self.assertLess(abs(treated).max(), 1)
        window = np.hanning(rate)
        frequencies = np.fft.rfftfreq(rate, 1 / rate)
        before = abs(np.fft.rfft(original[rate:rate * 2, 0] * window)) ** 2
        after = abs(np.fft.rfft(treated[rate:rate * 2, 0] * window)) ** 2
        audible = (frequencies > 40) & (frequencies < 3000)
        harmonic = np.zeros(len(frequencies), dtype=bool)
        for order in range(1, 37):
            center = 82.4 * order
            if center > 3000:
                break
            harmonic |= abs(frequencies - center) < max(7, center * .015)
        before_noise_ratio = before[audible & ~harmonic].sum() / before[audible].sum()
        after_noise_ratio = after[audible & ~harmonic].sum() / after[audible].sum()
        self.assertLess(after_noise_ratio, before_noise_ratio * 0.6)

    def test_bass_samples_are_treated_and_keep_stereo_format(self):
        manifest = json.loads((APP / 'web/audio/guitar/manifest.json').read_text(encoding='utf8'))
        bass = [sample for sample in manifest['samples'] if sample['string'] in (5, 6)]
        self.assertEqual(len(bass), 40)
        for sample in bass:
            self.assertEqual(sample['bassTreatment'], 'clear-sustain-c1')
            with wave.open(str(APP / 'web' / sample['url'].lstrip('/'))) as reader:
                self.assertEqual(reader.getnchannels(), 2)
                self.assertEqual(reader.getframerate(), 44100)
                self.assertAlmostEqual(sample['duration'], reader.getnframes() / 44100, places=3)
                self.assertLessEqual(sample['duration'], 3.8)

    def test_open_a_uses_same_string_source_with_correct_tuning_metadata(self):
        manifest = json.loads((APP / 'web/audio/guitar/manifest.json').read_text(encoding='utf8'))
        source = next(s for s in manifest['samples'] if s['string'] == 5 and s['midi'] == 47)
        target = next(s for s in manifest['samples'] if s['string'] == 5 and s['midi'] == 45)
        self.assertEqual(target['sourceMidi'], 47)
        self.assertEqual(target['frequency'], source['frequency'])
        self.assertEqual((APP / 'web' / target['url'].lstrip('/')).read_bytes(),
                         (APP / 'web' / source['url'].lstrip('/')).read_bytes())
        self.assertGreater(440 * 2 ** ((45 - 69) / 12) / target['frequency'], 0.85)
        self.assertLess(440 * 2 ** ((45 - 69) / 12) / target['frequency'], 0.95)

    def test_fourth_string_second_fret_has_tonal_audio_not_subbass(self):
        manifest = json.loads((APP / 'web/audio/guitar/manifest.json').read_text(encoding='utf8'))
        sample = next(s for s in manifest['samples'] if s['string'] == 4 and s['midi'] == 52)
        with wave.open(str(APP / 'web' / sample['url'].lstrip('/'))) as reader:
            mono = np.frombuffer(reader.readframes(44100), dtype='<i2').reshape(-1, 2).mean(axis=1) / 32768
        spectrum = abs(np.fft.rfft(mono * np.hanning(len(mono)), n=65536)) ** 2
        frequencies = np.fft.rfftfreq(65536, 1 / 44100)
        self.assertGreater(np.sqrt(np.mean(mono ** 2)), 0.03)
        self.assertGreater(spectrum[frequencies > 60].sum() / spectrum.sum(), 0.9)

    def test_attack_alignment_ignores_a_quiet_noise_lead(self):
        rate = 44100
        rng = np.random.default_rng(123)
        sample = rng.normal(0, 30, (rate, 2))
        onset = round(rate * 0.12)
        time = np.arange(rate - onset) / rate
        sample[onset:] += (5000 * np.sin(2 * np.pi * 164 * time))[:, None]
        offset = attack_offset(sample, rate)
        self.assertLess(abs(offset / rate - 0.12), 0.01)
        result, trimmed, denoised = refine_sample(sample, rate)
        self.assertEqual(trimmed, offset)
        self.assertTrue(denoised)
        self.assertEqual(len(result), rate - offset)
        self.assertLess(attack_offset(result, rate) / rate, 0.01)

    def test_spectral_reduction_suppresses_noise_and_preserves_tonal_decay(self):
        rate = 44100
        rng = np.random.default_rng(10)
        quiet = rng.normal(0, 400, (rate // 4, 2))
        noise = rng.normal(0, 400, (rate, 2))
        reduced = reduce_background(noise, quiet)
        self.assertLess(np.sqrt(np.mean(reduced ** 2)), np.sqrt(np.mean(noise ** 2)) * 0.65)
        time = np.arange(rate) / rate
        tone = (5000 * np.sin(2 * np.pi * 164 * time) * np.exp(-time))[:, None]
        mixed = noise + tone
        result = reduce_background(mixed, quiet)
        basis = np.sin(2 * np.pi * 164 * time)
        dry_amplitude = np.sum(mixed[:, 0] * basis)
        wet_amplitude = np.sum(result[:, 0] * basis)
        self.assertGreater(wet_amplitude / dry_amplitude, 0.95)

    def test_fourth_string_second_fret_starts_promptly_and_has_noise_profile(self):
        manifest = json.loads((APP / 'web/audio/guitar/manifest.json').read_text(encoding='utf8'))
        sample = next(s for s in manifest['samples'] if s['string'] == 4 and s['midi'] == 52)
        self.assertTrue(sample['noiseReduced'])
        self.assertGreater(sample['attackTrimMs'], 80)
        with wave.open(str(APP / 'web' / sample['url'].lstrip('/'))) as reader:
            data = np.frombuffer(reader.readframes(44100), dtype='<i2').reshape(-1, 2)
        self.assertLess(attack_offset(data, 44100) / 44100, 0.01)


if __name__ == '__main__':
    unittest.main()
