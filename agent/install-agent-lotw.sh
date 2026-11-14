#!/usr/bin/env bash
# =====================================================================================================
#  Remote Station — installation de l'Agent LoTW sur un PC Linux (Debian, Ubuntu, Raspberry Pi OS…)
#  où TQSL et le certificat LoTW sont déjà installés (TQSL déjà utilisé par cet utilisateur).
#
#  Code d'appairage : carnet → Opérations LoTW → Agent LoTW → « Appairer un PC… » (valable 15 minutes).
#
#    curl -fsSL https://remote.op0p.be/agent/install-agent-lotw.sh | sudo bash -s -- --serveur https://remote.op0p.be --code ABCD-EFGH
#  ou, depuis l'archive de Remote Station :
#    sudo bash /opt/remote-station/agent/install-agent-lotw.sh --serveur https://remote.op0p.be --code ABCD-EFGH
#
#  Options :
#    --serveur URL         adresse du serveur Remote Station (https://…)
#    --code CODE           code d'appairage (facultatif : sinon « remote-station-agent-lotw --appairer CODE » plus tard)
#    --utilisateur NOM     compte Linux qui utilise TQSL (par défaut : celui qui a lancé sudo)
#    --desinstaller        retire l'agent (service et programme ; TQSL et le certificat ne sont pas touchés)
#
#  L'agent tourne en service systemd sous ce compte (il lit les lieux de station de ~/.tqsl) et redémarre tout seul.
# =====================================================================================================
set -euo pipefail

SERVEUR=""; CODE=""; U="${SUDO_USER:-}"; DESINST=0
SVC=remote-station-agent-lotw
vert() { printf '\033[1;32m%s\033[0m\n' "$*"; }
info() { printf '\033[1;36m» %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }
fin()  { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --serveur) SERVEUR="${2:-}"; shift 2 ;;
    --code) CODE="${2:-}"; shift 2 ;;
    --utilisateur) U="${2:-}"; shift 2 ;;
    --desinstaller) DESINST=1; shift ;;
    -h|--help|--aide) sed -n '2,20p' "$0" 2>/dev/null || true; exit 0 ;;
    *) fin "option inconnue : $1" ;;
  esac
done

[ "$(id -u)" -eq 0 ] || fin "à lancer avec sudo"
[ -n "$U" ] && [ "$U" != root ] || fin "indiquez le compte qui utilise TQSL : --utilisateur NOM (pas root)"
id "$U" >/dev/null 2>&1 || fin "compte inconnu : $U"
HOMEU="$(getent passwd "$U" | cut -d: -f6)"
AG="$HOMEU/.local/share/remote-station-agent"

if [ "$DESINST" = 1 ]; then
  systemctl disable --now "$SVC" 2>/dev/null || true
  rm -f "/etc/systemd/system/$SVC.service" /usr/local/bin/remote-station-agent-lotw
  systemctl daemon-reload
  rm -rf "${AG:?}"
  vert "Agent LoTW retiré (retirez aussi ce PC dans le carnet : Opérations LoTW → Agent LoTW)."
  exit 0
fi

SERVEUR="${SERVEUR%/}"
case "$SERVEUR" in https://*|http://localhost*|http://127.0.0.1*|"") ;; *) fin "adresse du serveur : https://… (ex. https://remote.op0p.be)" ;; esac
if [ -z "$SERVEUR" ] && [ -f "$AG/agent-lotw.json" ]; then SERVEUR="$(sed -n 's/.*"server": *"\([^"]*\)".*/\1/p' "$AG/agent-lotw.json" | head -1)"; fi
[ -n "$SERVEUR" ] || fin "indiquez le serveur : --serveur https://remote.op0p.be"

vert "Agent LoTW de Remote Station — compte $U, serveur $SERVEUR"

# ------------------------------------------------------------------ Node.js 22 ou plus (WebSocket intégré)
node_ok() { command -v node >/dev/null && [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -ge 22 ]; }
if ! node_ok; then
  command -v apt-get >/dev/null || fin "Node.js 22 ou plus est nécessaire (https://nodejs.org)"
  info "Installation de Node.js 22 (dépôt NodeSource)"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg >/dev/null
  if ! apt-cache policy nodejs 2>/dev/null | grep -Eq 'Candidate: (2[2-9]|[3-9][0-9])\.'; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  fi
  apt-get install -y -qq nodejs >/dev/null
fi
node_ok || fin "Node.js 22 ou plus est nécessaire (trouvé : $(node -v 2>/dev/null || echo aucun))"
NODE="$(command -v node)"
info "Node.js $(node -v)"

# ------------------------------------------------------------------ TQSL et affichage virtuel (TQSL en service, sans écran)
if command -v tqsl >/dev/null || [ -x /usr/bin/tqsl ] || [ -x /usr/local/bin/tqsl ]; then info "TQSL : $(command -v tqsl || echo /usr/bin/tqsl)"
else warn "TQSL est introuvable : installez-le (sudo apt install trustedqsl) et importez votre certificat avant le premier envoi."; fi
[ -f "$HOMEU/.tqsl/station_data" ] || warn "Aucun lieu de station TQSL pour $U (~/.tqsl/station_data) : créez-le dans TQSL (Station Locations → New)."
if ! command -v xvfb-run >/dev/null && command -v apt-get >/dev/null; then
  info "Installation de xvfb (TQSL a besoin d'un affichage, même en mode lot)"
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq xvfb xauth >/dev/null || warn "xvfb non installé : sudo apt install xvfb"
fi

# ------------------------------------------------------------------ programme de l'agent
sudo -u "$U" mkdir -p "$AG"   # créé par le compte lui-même : ~/.local et ~/.local/share restent à lui
chmod 700 "$AG"
# Lancé depuis l'archive : agent-lotw.js à côté de ce script ; lancé par « curl | bash » : téléchargé depuis le serveur
ME="${BASH_SOURCE[0]:-}"
SRC=""
case "$ME" in */install-agent-lotw.sh) [ -f "$(dirname "$ME")/agent-lotw.js" ] && SRC="$(dirname "$ME")/agent-lotw.js" ;; esac
if [ -n "$SRC" ]; then cp "$SRC" "$AG/agent-lotw.js"
else curl -fsSL "$SERVEUR/agent/agent-lotw.js" -o "$AG/agent-lotw.js" || fin "téléchargement de $SERVEUR/agent/agent-lotw.js impossible"; fi
head -1 "$AG/agent-lotw.js" | grep -q '^#!/usr/bin/env node' || fin "agent-lotw.js inattendu"
chown "$U:" "$AG/agent-lotw.js"
chmod 700 "$AG/agent-lotw.js"
cat > /usr/local/bin/remote-station-agent-lotw <<EOF
#!/bin/sh
# Agent LoTW de Remote Station : --appairer CODE, --etat, --oublier, --mdp-certificat (sous le compte $U)
if [ "\$(id -un)" != "$U" ]; then exec sudo -u "$U" "$NODE" "$AG/agent-lotw.js" "\$@"; fi
exec "$NODE" "$AG/agent-lotw.js" "\$@"
EOF
chmod 755 /usr/local/bin/remote-station-agent-lotw

# ------------------------------------------------------------------ appairage
if [ -n "$CODE" ]; then
  info "Appairage avec le code $CODE"
  sudo -u "$U" HOME="$HOMEU" "$NODE" "$AG/agent-lotw.js" --serveur "$SERVEUR" --appairer "$CODE" || fin "appairage refusé : demandez un nouveau code dans le carnet, puis : remote-station-agent-lotw --appairer CODE"
else
  sudo -u "$U" HOME="$HOMEU" "$NODE" "$AG/agent-lotw.js" --serveur "$SERVEUR" --etat >/dev/null 2>&1 || true
  [ -f "$AG/agent-lotw.json" ] && grep -q '"token"' "$AG/agent-lotw.json" || warn "Pas encore appairé : remote-station-agent-lotw --serveur $SERVEUR --appairer CODE"
fi

# ------------------------------------------------------------------ service systemd
cat > "/etc/systemd/system/$SVC.service" <<EOF
[Unit]
Description=Remote Station - Agent LoTW (TQSL de ce PC)
After=network-online.target
Wants=network-online.target

[Service]
User=$U
Environment=HOME=$HOMEU
ExecStart=$NODE $AG/agent-lotw.js
Restart=always
RestartSec=10
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable "$SVC" >/dev/null 2>&1
systemctl restart "$SVC"
sleep 2
systemctl is-active --quiet "$SVC" && vert "✓ Agent LoTW en service ($SVC) — journal : journalctl -u $SVC -f" || warn "le service ne démarre pas : journalctl -u $SVC"
sudo -u "$U" HOME="$HOMEU" "$NODE" "$AG/agent-lotw.js" --etat || true
