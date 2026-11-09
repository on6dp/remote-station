#!/usr/bin/env bash
# =====================================================================================================
#  Remote Station — voix de synthèse naturelles (Piper) pour les messages vocaux de la page TRX SSB.
#
#  Piper (https://github.com/rhasspy/piper, licence MIT) fabrique une voix bien plus humaine qu'espeak-ng.
#  Ce script le télécharge depuis GitHub avec quelques voix anglaises et françaises, dans /opt/remote-station/tts
#  (jamais effacé par les mises à jour), puis redémarre le service. À lancer une fois :
#       sudo bash /opt/remote-station/deploy/install-voix.sh
#  Pour ajouter / reprendre une seule voix :  sudo bash .../install-voix.sh fr-siwis-medium
#
#  Voix (licence du jeu de données d'entraînement) :
#    en-us-kathleen-low   femme, anglais US (CC0)          en-us-amy-low        femme, anglais US
#    en-us-lessac-medium  femme, anglais US                 en-gb-southern_english_female-low  femme, anglais GB (CC BY-SA 4.0)
#    en-us-ryan-medium    homme, anglais US                 fr-siwis-medium      femme, français (CC BY 4.0)
#    fr-gilles-low        homme, français
#  Environ 60 Mo par voix. Usage radioamateur, non commercial.
# =====================================================================================================
set -euo pipefail

APP="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIR="$APP/tts"
RUSER=remotestation
PIPER_REL="2023.11.14-2"
VOICE_REL="v0.0.2"
DEFAUT="en-us-kathleen-low en-us-amy-low en-us-lessac-medium en-gb-southern_english_female-low en-us-ryan-medium fr-siwis-medium fr-gilles-low"
VOIX="${*:-$DEFAUT}"

vert() { printf '\033[1;32m%s\033[0m\n' "$*"; }
info() { printf '\033[1;36m» %s\033[0m\n' "$*"; }
fin()  { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fin "À lancer avec sudo."
command -v curl >/dev/null || fin "curl manquant : sudo apt install curl"

case "$(uname -m)" in
  x86_64) ARCH=x86_64 ;;
  aarch64|arm64) ARCH=aarch64 ;;
  armv7l) ARCH=armv7l ;;
  *) fin "Processeur $(uname -m) non prévu par Piper." ;;
esac

mkdir -p "$DIR/voices"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if [ ! -x "$DIR/piper/piper" ]; then
  info "Piper $PIPER_REL ($ARCH)…"
  curl -fL --retry 3 -o "$TMP/piper.tgz" "https://github.com/rhasspy/piper/releases/download/$PIPER_REL/piper_linux_$ARCH.tar.gz"
  tar -xzf "$TMP/piper.tgz" -C "$DIR"
fi
[ -x "$DIR/piper/piper" ] || fin "Piper introuvable après le téléchargement."

for v in $VOIX; do
  case "$v" in *[!a-z0-9_-]*) fin "Nom de voix inattendu : $v" ;; esac
  if [ -f "$DIR/voices/$v.onnx" ] && [ -f "$DIR/voices/$v.onnx.json" ]; then info "Voix $v : déjà là"; continue; fi
  info "Voix $v…"
  curl -fL --retry 3 -o "$TMP/$v.tgz" "https://github.com/rhasspy/piper/releases/download/$VOICE_REL/voice-$v.tar.gz"
  mkdir -p "$TMP/$v"
  tar -xzf "$TMP/$v.tgz" -C "$TMP/$v"
  f="$(find "$TMP/$v" -name '*.onnx' | head -1)"
  [ -n "$f" ] || fin "Modèle absent dans voice-$v.tar.gz"
  cp "$f" "$DIR/voices/$v.onnx"
  cp "$f.json" "$DIR/voices/$v.onnx.json"
  [ -f "$TMP/$v/MODEL_CARD" ] && cp "$TMP/$v/MODEL_CARD" "$DIR/voices/$v.MODEL_CARD"
done

# Essai : une phrase dans un fichier temporaire, avec l'utilisateur du service
id "$RUSER" >/dev/null 2>&1 && chown -R "$RUSER:$RUSER" "$DIR"
first="$(ls "$DIR"/voices/*.onnx | head -1)"
info "Essai de Piper avec $(basename "$first" .onnx)…"
if echo "This is a test." | LD_LIBRARY_PATH="$DIR/piper" "$DIR/piper/piper" --model "$first" --espeak_data "$DIR/piper/espeak-ng-data" --output_raw >"$TMP/t.raw" 2>"$TMP/t.log" && [ -s "$TMP/t.raw" ]; then
  vert "Piper fonctionne ($(stat -c %s "$TMP/t.raw") octets de son)."
else
  cat "$TMP/t.log" >&2
  fin "Piper ne fonctionne pas sur ce serveur (voir ci-dessus)."
fi

systemctl restart remote-station 2>/dev/null || true
vert "Voix naturelles installées dans $DIR : rouvrez la page TRX SSB, « Messages vocaux… », liste Voix (groupe « Voix naturelles »)."
