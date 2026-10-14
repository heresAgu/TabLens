"""Private listening test of SampleSwap acoustic-harmonic MP3 previews.

These previews are low bitrate and are deliberately kept out of the app.
The source page does not establish that the guitar has steel strings.
"""
from pathlib import Path
import subprocess
import wave
from urllib.parse import urljoin

from bs4 import BeautifulSoup
import imageio_ffmpeg
import numpy as np
import requests


ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "experiments" / ".runtime" / "harmonics" / "sampleswap"
OUT.mkdir(parents=True, exist_ok=True)
PAGE = "https://sampleswap.org/filebrowser-new.php?d=INSTRUMENTS+%28MULTISAMPLED%29%2FGUITAR%2Facoustic+guitar+harmonics"
RATE = 44100


def get_source_links():
    r = requests.get(PAGE, timeout=25)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")
    result = {}
    for link in soup.find_all("a", href=True):
        href = link["href"]
        if "/samples-ghost/" in href and href.endswith(".mp3"):
            label = link.get_text(" ", strip=True).split("»")[-1].strip()
            result[label] = urljoin(PAGE, href)
    return result


def load_preview(name, url):
    mp3 = OUT / (name + ".mp3")
    wav = OUT / (name + ".wav")
    if not mp3.exists():
        r = requests.get(url, timeout=25)
        r.raise_for_status()
        if "audio" not in r.headers.get("content-type", ""):
            raise RuntimeError(f"Unexpected response for {name}: {r.headers.get('content-type')}")
        mp3.write_bytes(r.content)
    if not wav.exists():
        subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-hide_banner", "-loglevel", "error",
                        "-y", "-i", str(mp3), "-ac", "1", "-ar", str(RATE),
                        "-c:a", "pcm_s16le", str(wav)], check=True)
    with wave.open(str(wav), "rb") as source:
        assert (source.getnchannels(), source.getsampwidth(), source.getframerate()) == (1, 2, RATE)
        return np.frombuffer(source.readframes(source.getnframes()), dtype="<i2").astype(np.float64) / 32768


def main():
    links = get_source_links()
    sequence = []
    for name in ("E7fret.wav", "B7fret.wav", "G7fret.wav", "D7fret.wav", "A7fret.wav", "2E7fret.wav"):
        audio = load_preview(name, links[name])
        # Keep the natural transient, trimming only preceding silence.
        block = int(.008 * RATE)
        rms = np.sqrt(np.mean(audio[:len(audio) // block * block].reshape(-1, block) ** 2, axis=1))
        candidates = np.flatnonzero(rms > max(.001, np.max(rms) * .035))
        start = max(0, (int(candidates[0]) if len(candidates) else 0) * block - int(.005 * RATE))
        audio = audio[start:]
        duration = min(len(audio), int(1.5 * RATE))
        note = np.zeros(int(1.7 * RATE))
        note[:duration] = audio[:duration]
        mid = note[int(.04 * RATE):int(.35 * RATE)]
        gain = min(5, .035 / max(float(np.sqrt(np.mean(mid ** 2))), 1e-5))
        note *= gain
        fade = min(int(.1 * RATE), duration)
        note[duration - fade:duration] *= np.linspace(1, 0, fade)
        sequence.append(note)
        print(name, "seconds", round(len(audio) / RATE, 2), "gain", round(gain, 2))
    combined = np.clip(np.concatenate(sequence), -1, 1)
    output = OUT / "07_acoustic_harmonics_preview.wav"
    with wave.open(str(output), "wb") as target:
        target.setnchannels(1)
        target.setsampwidth(2)
        target.setframerate(RATE)
        target.writeframes((combined * 32767).astype("<i2").tobytes())
    print(output)


if __name__ == "__main__":
    main()
