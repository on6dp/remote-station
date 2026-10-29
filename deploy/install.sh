#!/usr/bin/env bash
# =====================================================================================================
#  Remote Station — installation d'un serveur Linux (Debian / Ubuntu) ou mise à jour, en une commande.
#
#  1. Copier remote-station-X.Y.Z.tar.gz sur le serveur (WinSCP), puis :
#       sudo tar -xzf remote-station-X.Y.Z.tar.gz -C /opt
#  2. Nouveau serveur :
#       sudo bash /opt/remote-station/deploy/install.sh --domaine remote.op0p.be --email moi@exemple.be --admin ON6DP
#     Mise à jour d'un serveur existant (comptes, carnet, réglages gardés) :
#       sudo bash /opt/remote-station/deploy/install.sh
#
#  Options :
#    --domaine NOM       nom du site (enregistrement DNS A déjà pointé vers ce serveur)
#    --email ADRESSE     adresse pour Let's Encrypt (certificat HTTPS) ; sans elle, certbot la demande
#    --admin INDICATIF   premier administrateur (mot de passe demandé) ; nouveau serveur seulement
#    --port N            port interne de l'application (9000 par défaut ; nouveau serveur seulement)
#    --sans-https        pas de certificat (essais seulement : Chrome refuse alors le port série et le micro)
#    --sauvegarde HH:MM  installe aussi la sauvegarde automatique quotidienne (deploy/backup.sh)
#
#  Rien n'est jamais effacé : config.json, users.json, le carnet (logs/), les macros, les profils… restent en place.
#  Le jeton de la station n'est jamais affiché : la page Station le reprend toute seule (administrateur connecté).
# =====================================================================================================
set -euo pipefail

APP="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SVC=remote-station
RUSER=remotestation
DOMAINE=""; EMAIL=""; ADMIN=""; PORT=""; HTTPS=1; SAUVE=""

vert() { printf '\033[1;32m%s\033[0m\n' "$*"; }
info() { printf '\033[1;36m» %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }
fin()  { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --domaine) DOMAINE="${2:-}"; shift 2 ;;
    --email) EMAIL="${2:-}"; shift 2 ;;
    --admin) ADMIN="$(printf '%s' "${2:-}" | tr '[:lower:]' '[:upper:]')"; shift 2 ;;
    --port) PORT="${2:-}"; shift 2 ;;
    --sans-https) HTTPS=0; shift ;;
    --sauvegarde) SAUVE="${2:-}"; shift 2 ;;
    -h|--help|--aide) sed -n '2,23p' "$0"; exit 0 ;;
    *) fin "option inconnue : $1 (voir --aide)" ;;
  esac
done

[ "$(id -u)" -eq 0 ] || fin "à lancer avec sudo : sudo bash $0 $*"
[ -f "$APP/server.js" ] && [ -f "$APP/package.json" ] || fin "Remote Station introuvable dans $APP (extraire d'abord l'archive dans /opt)"
command -v apt-get >/dev/null || fin "ce script est prévu pour Debian / Ubuntu (apt-get)"
[ -z "$DOMAINE" ] || printf '%s' "$DOMAINE" | grep -Eq '^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' || fin "nom de domaine invalide : $DOMAINE"
[ -z "$ADMIN" ] || printf '%s' "$ADMIN" | grep -Eq '^[A-Z0-9/]{3,15}$' || fin "indicatif invalide : $ADMIN"
[ -z "$PORT" ] || { [ "$PORT" -ge 1024 ] 2>/dev/null && [ "$PORT" -le 65535 ]; } || fin "port invalide : $PORT"
[ -z "$SAUVE" ] || printf '%s' "$SAUVE" | grep -Eq '^([01][0-9]|2[0-3]):[0-5][0-9]$' || fin "heure de sauvegarde invalide : $SAUVE (format HH:MM)"

VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$APP/package.json" | head -1)"
NEUF=1; [ -f "$APP/config.json" ] && NEUF=0
if [ "$NEUF" = 1 ]; then vert "Remote Station $VERSION — installation d'un nouveau serveur dans $APP"
else vert "Remote Station $VERSION — mise à jour (données et réglages gardés)"; fi

# ------------------------------------------------------------------ 1. Node.js (20 ou plus), nginx, certbot
node_ok() { command -v node >/dev/null && [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -ge 20 ]; }
PKGS=()
node_ok || PKGS+=(nodejs)
if [ -n "$DOMAINE" ] || [ "$NEUF" = 1 ]; then
  command -v nginx >/dev/null || PKGS+=(nginx)
  [ "$HTTPS" = 0 ] || command -v certbot >/dev/null || PKGS+=(certbot python3-certbot-nginx)
fi
command -v curl >/dev/null || PKGS+=(curl)
if [ ${#PKGS[@]} -gt 0 ]; then
  info "Paquets à installer : ${PKGS[*]}"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  if printf '%s\n' "${PKGS[@]}" | grep -qx nodejs; then
    # Node.js de la distribution trop ancien : dépôt officiel NodeSource (version 22, maintenue)
    apt-get install -y -qq ca-certificates curl gnupg >/dev/null
    if ! apt-cache policy nodejs 2>/dev/null | grep -Eq 'Candidate: (2[0-9]|[3-9][0-9])\.'; then
      info "Ajout du dépôt NodeSource (Node.js 22)"
      curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
    fi
  fi
  apt-get install -y -qq "${PKGS[@]}" >/dev/null
fi
node_ok || fin "Node.js 20 ou plus est nécessaire (trouvé : $(node -v 2>/dev/null || echo aucun))"
info "Node.js $(node -v)"

# ------------------------------------------------------------------ 2. utilisateur du service, droits
if ! id "$RUSER" >/dev/null 2>&1; then
  info "Création de l'utilisateur système $RUSER"
  useradd --system --home "$APP" --shell /usr/sbin/nologin "$RUSER"
fi
mkdir -p "$APP/logs"
chown -R "$RUSER:$RUSER" "$APP"
# Fichiers secrets : lisibles par le service seulement
for f in config.json users.json sessions.json macros.json profiles.json logs/logbook.json logs/logbook-config.json logs/station-sessions.json; do
  [ -f "$APP/$f" ] && chmod 600 "$APP/$f"
done

# ------------------------------------------------------------------ 3. config.json (nouveau serveur) : jeton neuf, port
if [ "$NEUF" = 1 ]; then
  info "Création de config.json (jeton de station neuf, jamais affiché)"
  ( cd "$APP" && runuser -u "$RUSER" -- node init-config.js >/dev/null )
  if [ -n "$PORT" ]; then
    runuser -u "$RUSER" -- node -e '
      const fs = require("fs"), f = process.argv[1], c = JSON.parse(fs.readFileSync(f, "utf8"));
      c.port = Number(process.argv[2]); fs.writeFileSync(f, JSON.stringify(c, null, 2) + "\n", { mode: 0o600 });' "$APP/config.json" "$PORT"
  fi
  warn "Réglez ensuite dans $APP/config.json : clubName, stationCall, stationGrid (allowTx reste false jusqu'aux essais)."
fi
PORT="$(node -p 'try { require(process.argv[1]).port || 9000 } catch (e) { 9000 }' "$APP/config.json")"

# ------------------------------------------------------------------ 4. premier administrateur
if [ -n "$ADMIN" ]; then
  info "Administrateur $ADMIN : choisissez son mot de passe"
  ( cd "$APP" && runuser -u "$RUSER" -- node adduser.js "$ADMIN" --admin ) || true
  if ( cd "$APP" && runuser -u "$RUSER" -- node adduser.js --list 2>/dev/null ) | grep -q "$ADMIN"; then info "Administrateur $ADMIN prêt"
  else warn "Administrateur $ADMIN non créé : sudo -u $RUSER node $APP/adduser.js $ADMIN --admin"; fi
elif [ "$NEUF" = 1 ]; then
  warn "Aucun administrateur créé : sudo -u $RUSER node $APP/adduser.js VOTREINDICATIF --admin"
fi

# ------------------------------------------------------------------ 5. service systemd
UNIT=/etc/systemd/system/$SVC.service
TMPU="$(mktemp)"
sed -e "s#/opt/remote-station#$APP#g" -e "s#/usr/bin/node#$(command -v node)#g" "$APP/deploy/remote-station.service" > "$TMPU"
if ! cmp -s "$TMPU" "$UNIT" 2>/dev/null; then
  info "Service systemd $SVC installé / mis à jour"
  install -m 644 "$TMPU" "$UNIT"
  systemctl daemon-reload
fi
rm -f "$TMPU"
systemctl enable "$SVC" >/dev/null 2>&1
systemctl restart "$SVC"

# ------------------------------------------------------------------ 6. site nginx (+ HTTPS)
if [ -n "$DOMAINE" ]; then
  SITE=/etc/nginx/sites-available/$DOMAINE
  if [ -f "$SITE" ] && grep -q 'listen 443' "$SITE"; then
    info "Site nginx $DOMAINE déjà en place (HTTPS) : laissé tel quel"
  else
    info "Site nginx $DOMAINE → 127.0.0.1:$PORT"
    sed -e "s#remote\.op0p\.be#$DOMAINE#g" -e "s#127\.0\.0\.1:9000#127.0.0.1:$PORT#g" "$APP/deploy/remote.op0p.be.nginx" > "$SITE"
    ln -sf "$SITE" "/etc/nginx/sites-enabled/$DOMAINE"
    nginx -t >/dev/null 2>&1 || { nginx -t; fin "configuration nginx refusée"; }
    systemctl reload nginx
    if [ "$HTTPS" = 1 ]; then
      info "Certificat HTTPS Let's Encrypt pour $DOMAINE"
      if [ -n "$EMAIL" ]; then certbot --nginx -d "$DOMAINE" --non-interactive --agree-tos -m "$EMAIL" --redirect
      else certbot --nginx -d "$DOMAINE" --redirect; fi
    else
      warn "Sans HTTPS : Chrome refusera le port série (page Station) et le micro. À n'utiliser que pour un essai."
    fi
  fi
elif [ "$NEUF" = 1 ]; then
  warn "Pas de --domaine : site nginx non installé (relancer avec --domaine votre.site.be)"
fi

# ------------------------------------------------------------------ 7. sauvegarde automatique (facultatif)
if [ -n "$SAUVE" ]; then
  bash "$APP/deploy/backup.sh" --minuterie "$SAUVE"
fi

# ------------------------------------------------------------------ 8. vérification
info "Vérification…"
OK=0
for _ in $(seq 1 20); do
  if curl -fs -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null; then OK=1; break; fi
  sleep 1
done
if [ "$OK" = 1 ]; then
  vert "✓ Remote Station $VERSION en service sur le port $PORT"
else
  systemctl --no-pager status "$SVC" | head -15 || true
  fin "le service ne répond pas : sudo journalctl -u $SVC -n 50"
fi
[ -z "$DOMAINE" ] || vert "  Dashboard : https://$DOMAINE   ·   Page Station (PC du club) : https://$DOMAINE/station"
echo "  Journal : sudo journalctl -u $SVC -f"
[ "$NEUF" = 0 ] && echo "  Pensez à Ctrl+F5 sur le dashboard et sur la page Station."
exit 0
