#!/usr/bin/env bash
# =====================================================================================================
#  Remote Station — mise à jour demandée depuis le dashboard (bouton « 🔔 Mise à jour », administrateurs).
#
#  Copié par install.sh dans /usr/local/sbin/remote-station-update (appartient à root, le service ne peut pas le
#  modifier) et lancé par root (remote-station-update.service) dès que le serveur écrit le numéro de version voulu dans
#  /opt/remote-station/update/request. Seul ce numéro est lu dans la demande : le paquet vient toujours du dépôt
#  officiel (GitHub, HTTPS), son empreinte SHA-256 est vérifiée, puis : tar -xzf … -C /opt et install.sh, comme à la main.
#  Journal : /var/log/remote-station-update.log
# =====================================================================================================
set -uo pipefail
APP=/opt/remote-station
REQ="$APP/update/request"
LOG=/var/log/remote-station-update.log
URL=https://raw.githubusercontent.com/on6dp/remote-station/main/releases

[ -e "$REQ" ] || [ -L "$REQ" ] || exit 0
V=""
[ -f "$REQ" ] && [ ! -L "$REQ" ] && V="$(head -c 20 "$REQ" | tr -cd '0-9.')"
rm -f "$REQ"
touch "$LOG"; chmod 644 "$LOG"
say() { printf '%s\n' "$*" >> "$LOG"; }
echec() { say "ECHEC : $*"; exit 1; }
say ""
say "=== $V $(date -u '+%Y-%m-%d %H:%M:%S') UTC"
printf '%s' "$V" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || echec "numéro de version invalide"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
say "Téléchargement de la version $V…"
curl -fsSL --max-time 600 -o "$T/rs.tgz" "$URL/$V/remote-station-$V.tar.gz" || echec "téléchargement du paquet impossible"
curl -fsSL --max-time 60 -o "$T/SUMS" "$URL/$V/SHA256SUMS.txt" || echec "empreintes SHA-256 introuvables"
H="$(awk -v f="remote-station-$V.tar.gz" '$2 == f { print $1 }' "$T/SUMS")"
[ -n "$H" ] || echec "empreinte du paquet absente"
[ "$(sha256sum "$T/rs.tgz" | cut -d' ' -f1)" = "$H" ] || echec "empreinte SHA-256 fausse : paquet refusé"
tar -tzf "$T/rs.tgz" > "$T/list" 2>/dev/null || echec "paquet illisible"
grep -qv '^remote-station/' "$T/list" && echec "paquet refusé (fichiers hors de remote-station/)"
grep -q '\(^\|/\)\.\.\(/\|$\)' "$T/list" && echec "paquet refusé (chemin ..)"
say "Paquet vérifié, installation…"
tar -xzf "$T/rs.tgz" -C /opt --no-same-owner || echec "extraction impossible"
if bash "$APP/deploy/install.sh" >> "$LOG" 2>&1; then say "OK : version $V installée"
else echec "install.sh a échoué (voir ce journal)"; fi
