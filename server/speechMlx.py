# Kokoro on the Apple GPU, through mlx-audio: the crew's voices when the office runs on Apple Silicon (server/speech.ts
# starts it with uv, and says why). It speaks the same messages as server/speechWorker.ts, one JSON object a line: the
# office's on stdin, its own on stdout, the WAVs base64. Anything a library prints goes to stderr, so stdout stays ours.
import base64
import io
import json
import os
import sys
import wave

protocol = os.fdopen(os.dup(1), "w", buffering=1)
os.dup2(2, 1)
sys.stdout = sys.stderr

MODEL = "mlx-community/Kokoro-82M-bf16"
RATE = 24000


def tell(message):
    protocol.write(json.dumps(message) + "\n")


def wav(chunks):
    import numpy as np

    samples = np.concatenate([np.asarray(c, dtype=np.float32).reshape(-1) for c in chunks]) if chunks else np.zeros(0, np.float32)
    pcm = (np.clip(samples, -1, 1) * 32767).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


model = None


def say(text, voice):
    # Kokoro's voices are named for their accent: a for American, b for British
    return wav([r.audio for r in model.generate(text=text, voice=voice, speed=1.0, lang_code=voice[0])])


for line in sys.stdin:
    try:
        message = json.loads(line)
    except ValueError:
        continue
    if message.get("type") == "load":
        try:
            if model is None:
                from mlx_audio.tts.utils import load_model

                model = load_model(MODEL)
                # the first line a process says, and the first in each voice, is slow (the pronouncing dictionary
                # loads, the GPU's kernels compile, the voice downloads): say one in each nobody hears, so the first the
                # captain hears is quick
                for voice in message.get("voices") or ["af_heart", "bf_emma"]:
                    say("Ready.", voice)
            tell({"type": "ready"})
        except Exception as err:  # noqa: BLE001 - the office falls back to Kokoro on the CPU, whatever went wrong
            tell({"type": "failed", "error": str(err)[:500]})
    elif message.get("type") == "speak":
        try:
            tell({"type": "spoken", "id": message["id"], "wav": base64.b64encode(say(message["text"], message["voice"])).decode()})
        except Exception as err:  # noqa: BLE001
            tell({"type": "unspoken", "id": message["id"], "error": str(err)[:500]})
