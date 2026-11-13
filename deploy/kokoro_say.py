#!/usr/bin/env python3
"""Remote Station — une phrase dite par Kokoro (paquet kokoro-onnx, modèle hexgrad/Kokoro-82M, Apache 2.0).
Entrée : JSON {"text", "voice", "speed", "lang"} sur stdin. Sortie : fréquence (uint32 LE) puis PCM 16 bits LE mono sur stdout.
Lancé par le serveur (lib/tts.js) sans shell ; les fichiers du modèle sont dans le même dossier que ce script."""
import json, os, struct, sys

def main():
    req = json.loads(sys.stdin.read() or '{}')
    text = str(req.get('text', '')).strip()[:1200]
    if not text:
        sys.exit('texte vide')
    voice = str(req.get('voice', 'af_heart'))
    speed = min(2.0, max(0.5, float(req.get('speed', 1.0))))
    lang = str(req.get('lang', 'en-us'))
    here = os.path.dirname(os.path.abspath(__file__))
    from kokoro_onnx import Kokoro  # import ici : message clair si le paquet manque
    k = Kokoro(os.path.join(here, 'kokoro-v1.0.onnx'), os.path.join(here, 'voices-v1.0.bin'))
    samples, rate = k.create(text, voice=voice, speed=speed, lang=lang)
    out = sys.stdout.buffer
    out.write(struct.pack('<I', int(rate)))
    import numpy as np  # fourni avec kokoro-onnx
    out.write((np.clip(np.asarray(samples, dtype=np.float32), -1.0, 1.0) * 32767).astype('<i2').tobytes())
    out.flush()

if __name__ == '__main__':
    main()
