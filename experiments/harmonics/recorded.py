"""Listening-only test using public previews of recorded natural harmonics.

Preview MP3s remain in the ignored experiments/.runtime directory and are not
part of the application or distributable sample set.
"""
from __future__ import annotations

from pathlib import Path
import json
import re
import subprocess
import sys
import wave

from bs4 import BeautifulSoup
import imageio_ffmpeg
import numpy as np
import requests


ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "experiments" / ".runtime" / "harmonics" / "recorded"
OUT.mkdir(parents=True, exist_ok=True)
BASE = "https://freesound.org"
SEARCH = BASE + "/search/?f=pack_grouping%3A%2211598_ClassicalGuitarHarmonics%22&g=1&page={}"
TITLE = re.compile(r"GtClHrm-(\d\d)f,(\d)s\((\d+)\)~v(\d\d)\.wav")
PREVIEW = re.compile(r'https://cdn\.freesound\.org/previews/[^"\s]+-hq\.mp3')
TARGETS = [(12, 1), (7, 1), (5, 1), (12, 3), (7, 3), (5, 3)]
RATE = 44100


def get(session: requests.Session, url: str) -> requests.Response:
    response = session.get(url, timeout=25)
    response.raise_for_status()
    return response


def find_samples(session: requests.Session) -> dict[tuple[int, int], dict]:
    found: dict[tuple[int, int], dict] = {}
    for page in range(1, 11):
        html = get(session, SEARCH.format(page)).text
        soup = BeautifulSoup(html, "html.parser")
        results = soup.select(".bw-search__result")
        if not results:
            break
        for result in results:
            match = TITLE.search(result.get_text(" ", strip=True))
            element = result.select_one("[data-sound-id]")
            if not match or not element:
                continue
            fret, string, midi, velocity = map(int, match.groups())
            key = (fret, string)
            if key in TARGETS and (key not in found or velocity < found[key]["velocity"]):
                found[key] = {"fret": fret, "string": string, "midi": midi,
                              "velocity": velocity, "id": element["data-sound-id"]}
        if len(found) == len(TARGETS) and all(item["velocity"] == 1 for item in found.values()):
            break
    missing = set(TARGETS) - set(found)
    if missing:
        raise RuntimeError(f"Missing recorded samples: {sorted(missing)}")
    return found


def fetch_preview(session: requests.Session, sample: dict) -> Path:
    page = f'{BASE}/people/quartertone/sounds/{sample["id"]}/'
    html = get(session, page).text
    urls = PREVIEW.findall(html)
    if not urls:
        raise RuntimeError(f"No public HQ preview at {page}")
    url = urls[0].replace("&amp;", "&")
    mp3 = OUT / f'{sample["fret"]}f_{sample["string"]}s_v{sample["velocity"]}.mp3'
    if not mp3.exists():
        mp3.write_bytes(get(session, url).content)
    wav = mp3.with_suffix(".wav")
    if not wav.exists():
        subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-hide_banner", "-loglevel", "error",
                        "-y", "-i", str(mp3), "-ac", "1", "-ar", str(RATE),
                        "-c:a", "pcm_s16le", str(wav)], check=True)
    sample.update(source=page, preview=url, license="CC BY 4.0", author="quartertone")
    return wav


def load_wav(path: Path) -> np.ndarray:
    with wave.open(str(path), "rb") as audio:
        assert (audio.getnchannels(), audio.getsampwidth(), audio.getframerate()) == (1, 2, RATE)
        return np.frombuffer(audio.readframes(audio.getnframes()), dtype="<i2").astype(np.float64) / 32768


def trim_leading_silence(audio: np.ndarray) -> np.ndarray:
    # Keep the real finger attack; remove only the recorded pre-roll.
    win = int(.008 * RATE)
    blocks = audio[:len(audio) // win * win].reshape(-1, win)
    rms = np.sqrt(np.mean(blocks * blocks, axis=1))
    threshold = max(.001, float(np.max(rms)) * .04)
    candidates = np.flatnonzero(rms >= threshold)
    start = max(0, (int(candidates[0]) if len(candidates) else 0) * win - int(.006 * RATE))
    return audio[start:]


def write_wav(path: Path, audio: np.ndarray) -> None:
    clipped = np.clip(audio, -1, 1)
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(RATE)
        handle.writeframes((clipped * 32767).astype("<i2").tobytes())


def main() -> None:
    if "--cached-only" in sys.argv:
        # The public host may temporarily rate-limit requests. This renders
        # only the two real notes already fetched; it does not synthesize any.
        notes = []
        for fret in (12, 7, 12, 7):
            path = OUT / f"{fret}f_1s_v1.wav"
            audio = trim_leading_silence(load_wav(path))
            length = min(len(audio), int(1.35 * RATE))
            note = np.zeros(int(1.55 * RATE))
            note[:length] = audio[:length]
            section = note[int(.04 * RATE):int(.35 * RATE)]
            rms = float(np.sqrt(np.mean(section * section)))
            note *= min(5.0, .032 / max(rms, 1e-5))
            fade = min(int(.08 * RATE), length)
            note[length - fade:length] *= np.linspace(1, 0, fade)
            notes.append(note)
        output = OUT / "06_real_preview_two_notes.wav"
        write_wav(output, np.concatenate(notes))
        print(output)
        return
    with requests.Session() as session:
        samples = find_samples(session)
        sequence = []
        for key in TARGETS:
            item = samples[key]
            audio = trim_leading_silence(load_wav(fetch_preview(session, item)))
            length = min(len(audio), int(1.35 * RATE))
            note = np.zeros(int(1.55 * RATE))
            note[:length] = audio[:length]
            # Same overall level for comparing timbre. No synthesis or filtering.
            section = note[int(.04 * RATE):int(.35 * RATE)]
            rms = float(np.sqrt(np.mean(section * section)))
            gain = min(5.0, .032 / max(rms, 1e-5))
            note *= gain
            fade = min(int(.08 * RATE), length)
            if fade:
                note[length - fade:length] *= np.linspace(1, 0, fade)
            sequence.append(note)
            item["raw_rms"] = rms
            item["gain"] = gain
            print(f'{key}: source={item["source"]}, velocity={item["velocity"]}, rms={rms:.5f}, gain={gain:.2f}')
    output = OUT / "06_real_classical_harmonics.wav"
    write_wav(output, np.concatenate(sequence))
    (OUT / "sources.json").write_text(json.dumps(list(samples.values()), ensure_ascii=False, indent=2), encoding="utf-8")
    print(output)


if __name__ == "__main__":
    main()
