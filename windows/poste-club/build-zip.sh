#!/bin/sh
# Refait public/outils/assistant-carte-son.zip (téléchargeable depuis la page Station) à partir de ce dossier
set -eu
D=$(cd "$(dirname "$0")" && pwd)
OUT="$D/../../public/outils/assistant-carte-son.zip"
mkdir -p "$(dirname "$OUT")"
rm -f "$OUT"
cd "$D" && zip -q -X "$OUT" LISEZMOI.txt installer-carte-son.cmd installer-carte-son.ps1 retirer-carte-son.cmd rs-carte-son.ps1
echo "$OUT"
