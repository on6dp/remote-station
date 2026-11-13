#!/usr/bin/env python3
"""Remote Station — voix Kokoro (paquet kokoro-onnx, modèle hexgrad/Kokoro-82M, Apache 2.0). Lancé par le serveur (lib/tts.js), sans shell.
Une phrase : JSON {"text", "voice", "speed", "lang"} sur stdin ; sortie : fréquence (uint32 LE) puis PCM 16 bits LE mono.
--serve : modèle chargé une seule fois, une requête JSON par ligne sur stdin ; pour chacune, sur stdout : int32 LE = nombre
d'octets de son (ou −longueur du message d'erreur), uint32 LE = fréquence, puis le son (ou le message d'erreur en UTF-8)."""
import json, os, struct, sys

# Dossier du modèle : RS_KOKORO_DIR (donné par le serveur), sinon celui de ce script
HERE = os.environ.get('RS_KOKORO_DIR') or os.path.dirname(os.path.abspath(__file__))

def load():
    from kokoro_onnx import Kokoro  # import ici : message clair si le paquet manque
    return Kokoro(os.path.join(HERE, 'kokoro-v1.0.onnx'), os.path.join(HERE, 'voices-v1.0.bin'))

def say(k, req):
    import numpy as np  # fourni avec kokoro-onnx
    text = str(req.get('text', '')).strip()[:1200]
    if not text:
        raise ValueError('texte vide')
    voice = str(req.get('voice', 'af_heart'))
    speed = min(2.0, max(0.5, float(req.get('speed', 1.0))))
    lang = str(req.get('lang', 'en-us'))
    samples, rate = k.create(text, voice=voice, speed=speed, lang=lang)
    return (np.clip(np.asarray(samples, dtype=np.float32), -1.0, 1.0) * 32767).astype('<i2').tobytes(), int(rate)

def main():
    out = sys.stdout.buffer
    if '--serve' in sys.argv:
        k = load()
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                pcm, rate = say(k, json.loads(line))
                out.write(struct.pack('<iI', len(pcm), rate) + pcm)
            except Exception as e:  # erreur rendue au serveur, le processus reste prêt
                msg = str(e).encode('utf-8')[:500] or b'erreur'
                out.write(struct.pack('<iI', -len(msg), 0) + msg)
            out.flush()
        return
    pcm, rate = say(load(), json.loads(sys.stdin.read() or '{}'))
    out.write(struct.pack('<I', rate) + pcm)
    out.flush()

if __name__ == '__main__':
    main()
