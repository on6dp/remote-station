#!/usr/bin/env bash
# =====================================================================================================
#  Remote Station — INSTANCE DE TEST, à côté du serveur du club, sur le même VPS.
#
#  Un 2e serveur indépendant (dossier /opt/remote-station-test, service remote-station-test, port 9001, son propre
#  site, par ex. https://test.op0p.be) : sa propre page Station, son propre carnet, son propre jeton. On y essaie un
#  TRX (simulation de la page Station, ou le TRX d'un beta-testeur branché chez lui) sans toucher à la station du club.
#
#  Première installation (enregistrement DNS A du sous-domaine déjà pointé vers ce VPS) :
#     sudo bash /opt/remote-station/deploy/install-test.sh --domaine test.op0p.be --email moi@exemple.be
#  Mise à jour (faite toute seule par install.sh à chaque nouvelle version ; données de test gardées) :
#     sudo bash /opt/remote-station/deploy/install-test.sh
#  Arrêt et retrait du service (le dossier et ses données restent) :
#     sudo bash /opt/remote-station/deploy/install-test.sh --retirer
#
#  Options : --domaine NOM · --email ADRESSE · --port N (9001 par défaut, première installation) · --sans-https
#
#  Ce que l'instance de test reprend du serveur du club, une seule fois à la création : config.json (nom « TEST »,
#  autre port, jeton de station NEUF) et users.json (mêmes comptes et mots de passe). Rien n'est jamais renvoyé vers le
#  serveur du club. Sur l'instance de test : pas de PSK Reporter, pas de spot au DX cluster (lecture des spots seulement,
#  sous un autre SSID), pas de logs en ligne (carnet de test à part).
# =====================================================================================================
set -euo pipefail

SRC=/opt/remote-station
DST=/opt/remote-station-test
SVC=remote-station-test
RUSER=remotestation
DOMAINE=""; EMAIL=""; PORT=""; HTTPS=1; RETIRER=0; QUIET=0

vert() { printf '\033[1;32m%s\033[0m\n' "$*"; }
info() { [ "$QUIET" = 1 ] || printf '\033[1;36m» %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }
fin()  { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --domaine) DOMAINE="${2:-}"; shift 2 ;;
    --email) EMAIL="${2:-}"; shift 2 ;;
    --port) PORT="${2:-}"; shift 2 ;;
    --sans-https) HTTPS=0; shift ;;
    --retirer) RETIRER=1; shift ;;
    --quiet) QUIET=1; shift ;;
    -h|--help|--aide) sed -n '2,22p' "$0"; exit 0 ;;
    *) fin "option inconnue : $1 (voir --aide)" ;;
  esac
done

[ "$(id -u)" -eq 0 ] || fin "à lancer avec sudo : sudo bash $0 $*"
[ -f "$SRC/server.js" ] && [ -f "$SRC/config.json" ] || fin "serveur du club introuvable dans $SRC (installer d'abord Remote Station)"
[ -z "$DOMAINE" ] || printf '%s' "$DOMAINE" | grep -Eq '^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' || fin "nom de domaine invalide : $DOMAINE"
[ -z "$PORT" ] || { [ "$PORT" -ge 1024 ] 2>/dev/null && [ "$PORT" -le 65535 ]; } || fin "port invalide : $PORT"

if [ "$RETIRER" = 1 ]; then
  systemctl disable --now "$SVC" >/dev/null 2>&1 || true
  rm -f "/etc/systemd/system/$SVC.service"
  systemctl daemon-reload
  vert "Service $SVC arrêté et retiré. Le dossier $DST (données de test) est gardé ; site nginx laissé en place."
  exit 0
fi

NEUF=1; [ -f "$DST/config.json" ] && NEUF=0
if [ "$NEUF" = 1 ] && [ -z "$DOMAINE" ]; then fin "première installation : indiquez --domaine (ex. --domaine test.op0p.be)"; fi
VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$SRC/package.json" | head -1)"
[ "$NEUF" = 1 ] && vert "Instance de test Remote Station $VERSION — création dans $DST" || info "Instance de test : mise à jour en $VERSION (données de test gardées)"

# ------------------------------------------------------------------ 1. programme (pas les données du club)
mkdir -p "$DST"
tar -C "$SRC" \
  --exclude=./config.json --exclude=./users.json --exclude=./users.json.tmp --exclude=./sessions.json --exclude=./macros.json \
  --exclude=./profiles.json --exclude=./logs --exclude=./sstv --exclude=./voicemem --exclude=./tts --exclude=./releases --exclude=./update --exclude=./.git \
  --exclude='./comptes-*.csv' -cf - . | tar -C "$DST" -xf -
# Voix de synthèse (Piper) : celles du serveur du club, partagées (lecture seule)
[ -e "$DST/tts" ] || { [ -d "$SRC/tts" ] && ln -s "$SRC/tts" "$DST/tts"; } || true

# ------------------------------------------------------------------ 2. réglages et comptes (première fois)
if [ "$NEUF" = 1 ]; then
  info "config.json de test (copie de celle du club : autre port, jeton neuf, PSK Reporter et spots coupés)"
  node -e '
    const fs = require("fs"), crypto = require("crypto");
    const [src, dst, port] = process.argv.slice(1);
    const c = JSON.parse(fs.readFileSync(src, "utf8"));
    c.port = Number(port) || 9001;
    c.stationToken = crypto.randomBytes(24).toString("base64url");
    c.clubName = "TEST · " + String(c.clubName || "Remote Station").replace(/^TEST · /, "");
    c.pskReporter = false;
    c.clusterSpot = false;
    // Liaison au DX cluster sous un autre SSID que celle du club (deux connexions au même indicatif se gênent)
    const base = String(c.clusterCall || ((c.digiCall || c.stationCall || "") + "-7")).replace(/-\d+$/, "");
    if (base) c.clusterCall = base + "-8";
    delete c.logbookFile;
    // Données de test dans son propre dossier, jamais celles du club (chemins relatifs au programme)
    c.usersFile = "users.json";
    c.logDir = "logs";
    fs.writeFileSync(dst, JSON.stringify(c, null, 2) + "\n", { mode: 0o600 });' "$SRC/config.json" "$DST/config.json" "${PORT:-9001}"
  if [ -f "$SRC/users.json" ]; then cp -p "$SRC/users.json" "$DST/users.json"; info "Comptes repris du serveur du club (mêmes indicatifs et mots de passe)"; fi
fi
mkdir -p "$DST/logs"
chown -R "$RUSER:$RUSER" "$DST"
[ -L "$DST/tts" ] && chown -h "$RUSER:$RUSER" "$DST/tts" || true
for f in config.json users.json sessions.json macros.json profiles.json logs/logbook.json logs/logbook-config.json logs/station-sessions.json; do
  [ -f "$DST/$f" ] && chmod 600 "$DST/$f"
done
PORT="$(node -p 'try { require(process.argv[1]).port || 9001 } catch (e) { 9001 }' "$DST/config.json")"
SPORT="$(node -p 'try { require(process.argv[1]).port || 9000 } catch (e) { 9000 }' "$SRC/config.json")"
[ "$PORT" != "$SPORT" ] || fin "l'instance de test a le même port que le serveur du club ($PORT) : changez \"port\" dans $DST/config.json"

# ------------------------------------------------------------------ 3. service systemd
UNIT=/etc/systemd/system/$SVC.service
TMPU="$(mktemp)"
sed -e "s#/opt/remote-station#$DST#g" -e "s#/usr/bin/node#$(command -v node)#g" \
    -e "s#^Description=.*#Description=Remote Station — instance de test ($DST)#" "$SRC/deploy/remote-station.service" > "$TMPU"
if ! cmp -s "$TMPU" "$UNIT" 2>/dev/null; then
  info "Service systemd $SVC installé / mis à jour"
  install -m 644 "$TMPU" "$UNIT"
  systemctl daemon-reload
fi
rm -f "$TMPU"
systemctl enable "$SVC" >/dev/null 2>&1
systemctl restart "$SVC"

# ------------------------------------------------------------------ 4. site nginx (+ HTTPS)
if [ -n "$DOMAINE" ]; then
  SITE=/etc/nginx/sites-available/$DOMAINE
  if [ -f "$SITE" ] && grep -q 'listen 443' "$SITE"; then
    info "Site nginx $DOMAINE déjà en place (HTTPS) : laissé tel quel"
  else
    info "Site nginx $DOMAINE → 127.0.0.1:$PORT"
    # Variable « map » renommée : deux sites ne peuvent pas définir la même
    sed -e "s#remote\.op0p\.be#$DOMAINE#g" -e "s#127\.0\.0\.1:9000#127.0.0.1:$PORT#g" -e "s#rs_connection_upgrade#rs_test_connection_upgrade#g" \
      "$SRC/deploy/remote.op0p.be.nginx" > "$SITE"
    ln -sf "$SITE" "/etc/nginx/sites-enabled/$DOMAINE"
    nginx -t >/dev/null 2>&1 || { nginx -t; fin "configuration nginx refusée"; }
    systemctl reload nginx
    if [ "$HTTPS" = 1 ]; then
      info "Certificat HTTPS Let's Encrypt pour $DOMAINE"
      if [ -n "$EMAIL" ]; then certbot --nginx -d "$DOMAINE" --non-interactive --agree-tos -m "$EMAIL" --redirect
      else certbot --nginx -d "$DOMAINE" --redirect; fi
    else
      warn "Sans HTTPS : Chrome refusera le port série (page Station) et le micro."
    fi
  fi
fi

# ------------------------------------------------------------------ 5. vérification
OK=0
for _ in $(seq 1 20); do
  if curl -fs -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null; then OK=1; break; fi
  sleep 1
done
[ "$OK" = 1 ] || { systemctl --no-pager status "$SVC" | head -15 || true; fin "l'instance de test ne répond pas : sudo journalctl -u $SVC -n 50"; }
vert "✓ Instance de test $VERSION en service sur le port $PORT"
if [ "$NEUF" = 1 ]; then
  [ -z "$DOMAINE" ] || vert "  Dashboard : https://$DOMAINE   ·   Page Station : https://$DOMAINE/station   ·   FTDX5000 : https://$DOMAINE/ftdx5000"
  echo "  Journal : sudo journalctl -u $SVC -f"
fi
exit 0
