"""The approved C treatment for TabLens's fifth and sixth string samples."""

import numpy as np


def process_bass_sample(data, rate, fundamental, string):
    """Return a clearer, longer bass note while retaining its original pluck."""
    if string not in (5, 6):
        raise ValueError('Bass treatment applies only to strings five and six')
    if data.ndim != 2 or data.shape[1] != 2 or len(data) < rate // 5:
        raise ValueError('Expected a stereo note of at least 0.2 seconds')

    body = data[int(.03 * rate):int(.23 * rate)]
    measured = float(np.sqrt(np.mean(body * body)))
    target = .17 if string == 6 else .13
    balance = float(np.clip(target / max(measured, .001), .7, 2.2))

    frequencies = np.fft.rfftfreq(len(data), 1 / rate)
    presence = 1 + (10 ** (2.3 / 20) - 1) * np.exp(
        -.5 * (np.log2(np.maximum(frequencies, 1) / 650) / 1.35) ** 2)
    spectrum = np.fft.rfft(data, axis=0) * presence[:, None]
    bright = np.fft.irfft(spectrum, n=len(data), axis=0)

    harmonic = np.zeros(len(frequencies))
    for order in range(1, int(min(9000, rate / 2) / fundamental) + 1):
        center = fundamental * order
        width = max(7, center * .015)
        harmonic = np.maximum(harmonic,
                              np.exp(-.5 * ((frequencies - center) / width) ** 2))
    cleaned = np.fft.irfft(spectrum * (.28 + .72 * harmonic)[:, None],
                            n=len(data), axis=0)
    length = min(len(data), round(3.8 * rate))
    seconds = np.arange(length) / rate
    wet = np.clip((seconds - .12) / .20, 0, 1)
    wet = wet * wet * (3 - 2 * wet)
    combined = bright[:length] * (1 - wet[:, None]) + cleaned[:length] * wet[:, None]
    sustain = np.interp(seconds, [0, .15, .6, 1.2, 2.2, 2.8, 3.5, 4.0],
                        [1, 1, 1.35, 1.9, 2.35, 2.0, 1.1, .4])
    result = combined * sustain[:, None] * balance
    release = min(max(1, len(result) // 5), round(.18 * rate))
    result[-release:] *= np.linspace(1, 0, release)[:, None]
    return result
