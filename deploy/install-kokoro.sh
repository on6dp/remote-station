#!/usr/bin/env bash
# =====================================================================================================
#  Remote Station — voix Kokoro (les plus réalistes) pour les messages vocaux de la page TRX SSB.
#
#  Kokoro (hexgrad/Kokoro-82M, licence Apache 2.0) : modèle de synthèse neuronal de 82 M de paramètres, sur le processeur
#  du VPS (pas de carte graphique). Paquet Python « kokoro-onnx » (PyPI) dans un environnement à part, et les fichiers du
#  modèle (GitHub, thewh1teagle/kokoro-onnx, ~340 Mo) dans /opt/remote-station/tts/kokoro (gardé par les mises à jour,
#  jamais sur GitHub). À lancer une fois :
#       sudo bash /opt/remote-station/deploy/install-kokoro.sh
#  Voix : anglais US / GB (Heart, Bella, Michael, Emma, George…) et une voix française (Siwis).
#  Retirer Kokoro :  sudo rm -rf /opt/remote-station/tts/kokoro && sudo systemctl restart remote-station
# =====================================================================================================
set -euo pipefail

APP="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIR="$APP/tts/kokoro"
RUSER=remotestation
REL="https://github.com/thewh1teagle/kokoro-onnx/releases/download"

vert() { printf '\033[1;32m%s\033[0m\n' "$*"; }
info() { printf '\033[1;36m» %s\033[0m\n' "$*"; }
fin()  { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fin "À lancer avec sudo."
command -v curl >/dev/null || fin "curl manquant : sudo apt install curl"
command -v python3 >/dev/null || fin "python3 manquant : sudo apt install python3 python3-venv"
PYV="$(python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])')"
info "Python $PYV"
python3 -c 'import sys; sys.exit(0 if (3,10) <= sys.version_info[:2] <= (3,13) else 1)' || fin "kokoro-onnx demande Python 3.10 à 3.13 (ici $PYV)."
python3 -c 'import venv, ensurepip' 2>/dev/null || { info "Paquet python3-venv…"; apt-get install -y "python${PYV}-venv" || apt-get install -y python3-venv; }

mkdir -p "$DIR"
if [ ! -x "$DIR/venv/bin/python3" ]; then
  info "Environnement Python (venv)…"
  python3 -m venv "$DIR/venv"
fi
info "Paquet kokoro-onnx (PyPI)…"
"$DIR/venv/bin/pip" install --quiet --upgrade pip
"$DIR/venv/bin/pip" install --quiet --upgrade kokoro-onnx

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
for f in kokoro-v1.0.onnx voices-v1.0.bin; do
  if [ -s "$DIR/$f" ]; then info "$f : déjà là"; continue; fi
  info "$f…"
  curl -fL --retry 3 -o "$TMP/$f" "$REL/model-files-v1.0/$f" || curl -fL --retry 3 -o "$TMP/$f" "$REL/model-files-v1.1/$f" || fin "Téléchargement de $f impossible."
  mv "$TMP/$f" "$DIR/$f"
done
cp "$APP/deploy/kokoro_say.py" "$DIR/kokoro_say.py"

id "$RUSER" >/dev/null 2>&1 && chown -R "$RUSER:$RUSER" "$DIR"
info "Essai de Kokoro (voix Heart)…"
if echo '{"text":"This is a test of the remote station.","voice":"af_heart","speed":1.0,"lang":"en-us"}' | \
   ( id "$RUSER" >/dev/null 2>&1 && runuser -u "$RUSER" -- "$DIR/venv/bin/python3" "$DIR/kokoro_say.py" || "$DIR/venv/bin/python3" "$DIR/kokoro_say.py" ) >"$TMP/t.raw" 2>"$TMP/t.log" && [ "$(stat -c %s "$TMP/t.raw")" -gt 10000 ]; then
  vert "Kokoro fonctionne ($(stat -c %s "$TMP/t.raw") octets de son)."
else
  cat "$TMP/t.log" >&2
  fin "Kokoro ne fonctionne pas sur ce serveur (voir ci-dessus)."
fi

systemctl restart remote-station 2>/dev/null || true
vert "Voix Kokoro installées dans $DIR : rouvrez la page TRX SSB (Ctrl+F5), « Messages vocaux… », liste Voix (groupe « Voix Kokoro »)."
