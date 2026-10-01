import json
import sys
import unittest
import wave
from pathlib import Path

import numpy as np

APP = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP))
from prepare_guitar import remove_subbass, attack_offset, refine_sample, reduce_background


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
