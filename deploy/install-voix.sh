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
#  Voix par défaut (jeux « piper-voices » sur huggingface.co, ~60 Mo chacune, ~110 Mo pour « high ») :
#    français : fr_FR-tom-medium (homme), fr_FR-upmc-medium (Jessica femme + Pierre homme), fr_FR-siwis-medium (femme)
#    anglais  : en_US-kristin-medium, en_US-amy-medium, en_GB-jenny_dioco-medium (femmes), en_US-ryan-high, en_US-joe-medium (hommes)
#  Anciennes voix (GitHub, noms avec un tiret : en-us-kathleen-low, fr-gilles-low…) toujours possibles.
#  Retirer une voix :  sudo bash .../install-voix.sh --retirer fr-gilles-low
#  Licence de chaque voix : tts/voices/<voix>.MODEL_CARD. Usage radioamateur, non commercial.
# =====================================================================================================
set -euo pipefail

APP="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIR="$APP/tts"
RUSER=remotestation
PIPER_REL="2023.11.14-2"
VOICE_REL="v0.0.2"
HF="https://huggingface.co/rhasspy/piper-voices/resolve/main"
DEFAUT="fr_FR-tom-medium fr_FR-upmc-medium fr_FR-siwis-medium en_US-kristin-medium en_US-amy-medium en_GB-jenny_dioco-medium en_US-ryan-high en_US-joe-medium"
if [ "${1:-}" = "--retirer" ]; then
  shift
  for v in "$@"; do
    case "$v" in *[!A-Za-z0-9_-]*) echo "Nom inattendu : $v" >&2; exit 1 ;; esac
    rm -f "$DIR/voices/$v.onnx" "$DIR/voices/$v.onnx.json" "$DIR/voices/$v.MODEL_CARD" && echo "Voix $v retirée."
  done
  systemctl restart remote-station 2>/dev/null || true
  exit 0
fi
VOIX="${*:-$DEFAUT}"

vert() { printf '\033[1;32m%s\033[0m\n' "$*"; }
info() { printf '\033[1;36m» %s\033[0m\n' "$*"; }
fin()  { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }

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
  case "$v" in *[!A-Za-z0-9_-]*) fin "Nom de voix inattendu : $v" ;; esac
  if [ -f "$DIR/voices/$v.onnx" ] && [ -f "$DIR/voices/$v.onnx.json" ]; then info "Voix $v : déjà là"; continue; fi
  info "Voix $v…"
  if [[ "$v" =~ ^([a-z]{2})_([A-Z]{2})-([a-z0-9_]+)-(x_low|low|medium|high)$ ]]; then
    # piper-voices (huggingface.co) : <langue>/<langue_PAYS>/<nom>/<qualité>/<voix>.onnx
    base="$HF/${BASH_REMATCH[1]}/${BASH_REMATCH[1]}_${BASH_REMATCH[2]}/${BASH_REMATCH[3]}/${BASH_REMATCH[4]}"
    if curl -fL --retry 3 -o "$TMP/$v.onnx" "$base/$v.onnx" && curl -fL --retry 3 -o "$TMP/$v.onnx.json" "$base/$v.onnx.json"; then
      curl -fsL -o "$TMP/$v.MODEL_CARD" "$base/MODEL_CARD" || true
      mv "$TMP/$v.onnx" "$TMP/$v.onnx.json" "$DIR/voices/"
      [ -s "$TMP/$v.MODEL_CARD" ] && mv "$TMP/$v.MODEL_CARD" "$DIR/voices/"
    else warn "Voix $v : téléchargement impossible, passée."; fi
  else
    # anciennes voix (GitHub, piper v0.0.2) : voice-<voix>.tar.gz
    if curl -fL --retry 3 -o "$TMP/$v.tgz" "https://github.com/rhasspy/piper/releases/download/$VOICE_REL/voice-$v.tar.gz"; then
      mkdir -p "$TMP/$v"
      tar -xzf "$TMP/$v.tgz" -C "$TMP/$v"
      f="$(find "$TMP/$v" -name '*.onnx' | head -1)"
      if [ -n "$f" ]; then
        cp "$f" "$DIR/voices/$v.onnx"; cp "$f.json" "$DIR/voices/$v.onnx.json"
        [ -f "$TMP/$v/MODEL_CARD" ] && cp "$TMP/$v/MODEL_CARD" "$DIR/voices/$v.MODEL_CARD"
      else warn "Modèle absent dans voice-$v.tar.gz"; fi
    else warn "Voix $v : téléchargement impossible, passée."; fi
  fi
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
