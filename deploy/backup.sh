#!/usr/bin/env bash
# =====================================================================================================
#  Remote Station — sauvegarde et restauration des données du serveur.
#
#    sudo bash /opt/remote-station/deploy/backup.sh                    sauvegarde maintenant (données)
#    sudo bash /opt/remote-station/deploy/backup.sh --complet          données + programme (tout le dossier)
#    sudo bash /opt/remote-station/deploy/backup.sh --liste            sauvegardes présentes
#    sudo bash /opt/remote-station/deploy/backup.sh --restaurer FICHIER
#    sudo bash /opt/remote-station/deploy/backup.sh --minuterie 03:30  sauvegarde automatique chaque jour à 03:30
#    sudo bash /opt/remote-station/deploy/backup.sh --sans-minuterie   arrête la sauvegarde automatique
#
#  Options : --dossier DIR (par défaut /home/<vous>/backups, sinon /var/backups/remote-station)
#            --garder N    nombre de sauvegardes gardées (30 par défaut ; les plus anciennes sont supprimées)
#
#  Données sauvegardées : config.json (jeton), users.json, sessions.json, macros.json, profiles.json, comptes-*.csv,
#  le dossier des journaux (carnet logbook.json, identifiants des logs en ligne logbook-config.json, accès, statistiques)
#  et sstv/. Pas refdata/ (listes IOTA, POTA… retéléchargées toutes seules).
#  Les archives contiennent des secrets : droits 600, à garder sur le VPS et sur votre PC (WinSCP),
#  JAMAIS sur GitHub, par e-mail ou dans un message.
# =====================================================================================================
set -euo pipefail
umask 077

APP="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SVC=remote-station
RUSER=remotestation
ACTION=sauver; COMPLET=0; FICHIER=""; HEURE=""; GARDER=30; DOSSIER=""; CALME=0

info() { [ "$CALME" = 1 ] || printf '\033[1;36m» %s\033[0m\n' "$*"; }
vert() { [ "$CALME" = 1 ] || printf '\033[1;32m%s\033[0m\n' "$*"; }
fin()  { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --complet) COMPLET=1; shift ;;
    --liste) ACTION=liste; shift ;;
    --restaurer) ACTION=restaurer; FICHIER="${2:-}"; shift 2 ;;
    --minuterie)
      ACTION=minuterie; HEURE=03:30
      if [ $# -gt 1 ] && [ "${2#--}" = "$2" ]; then HEURE="$2"; shift; fi
      shift ;;
    --sans-minuterie) ACTION=sans-minuterie; shift ;;
    --dossier) DOSSIER="${2:-}"; shift 2 ;;
    --garder) GARDER="${2:-30}"; shift 2 ;;
    --calme) CALME=1; shift ;;
    -h|--help|--aide) sed -n '2,22p' "$0"; exit 0 ;;
    *) fin "option inconnue : $1 (voir --aide)" ;;
  esac
done

[ "$(id -u)" -eq 0 ] || fin "à lancer avec sudo : sudo bash $0"
[ -f "$APP/server.js" ] || fin "Remote Station introuvable dans $APP"
printf '%s' "$GARDER" | grep -Eq '^[0-9]+$' && [ "$GARDER" -ge 1 ] || fin "--garder : un nombre (1 ou plus)"

# Dossier des sauvegardes : celui demandé, sinon ~/backups de l'utilisateur qui a lancé sudo, sinon /var/backups
if [ -z "$DOSSIER" ]; then
  U="${SUDO_USER:-}"
  if [ -n "$U" ] && [ "$U" != root ] && [ -d "/home/$U" ]; then DOSSIER="/home/$U/backups"
  elif [ -d /home/on6dp ]; then DOSSIER=/home/on6dp/backups
  else DOSSIER=/var/backups/remote-station; fi
fi
case "$DOSSIER" in "$APP"|"$APP"/*) fin "le dossier des sauvegardes doit être en dehors de $APP" ;; esac

# Propriétaire des archives : celui du dossier /home/<nom>/… (pour les récupérer avec WinSCP), sinon root
proprio() {
  local d="$1"
  case "$d" in /home/*) stat -c %U "/home/$(printf '%s' "${d#/home/}" | cut -d/ -f1)" 2>/dev/null || echo root ;; *) echo root ;; esac
}

# Fichiers de données (chemins relatifs à $APP), d'après config.json (usersFile, logDir, logbookFile…)
donnees() {
  node -e '
    const fs = require("fs"), path = require("path"), app = process.argv[1];
    let c = {}; try { c = JSON.parse(fs.readFileSync(path.join(app, "config.json"), "utf8")); } catch (e) {}
    const out = new Set(["config.json", "users.json", "sessions.json", "macros.json", "profiles.json", "sstv", c.logDir || "logs"]);
    for (const k of ["usersFile", "logbookFile", "logbookConfig"]) if (c[k]) out.add(c[k]);
    try { for (const f of fs.readdirSync(app)) if (/^comptes-.*\.csv$/.test(f)) out.add(f); } catch (e) {}
    for (const f of out) {
      const abs = path.resolve(app, f), rel = path.relative(app, abs);
      if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) { console.error("ignoré (hors du dossier) : " + abs); continue; }
      if (fs.existsSync(abs)) console.log(rel);
    }' "$APP"
}

sauver() {
  local quand tag nom f n
  mkdir -p "$DOSSIER"; chmod 700 "$DOSSIER"
  quand="$(date +%Y-%m-%d_%H%M)"
  tag="${1:-}"
  nom="$DOSSIER/remote-station-${tag:+$tag-}$quand.tar.gz"
  if [ "$COMPLET" = 1 ]; then
    info "Sauvegarde complète (programme + données) de $APP"
    tar -czf "$nom" -C "$(dirname "$APP")" --exclude="$(basename "$APP")/refdata" "$(basename "$APP")"
  else
    info "Sauvegarde des données de $APP"
    mapfile -t LISTE < <(donnees)
    [ ${#LISTE[@]} -gt 0 ] || fin "aucune donnée trouvée dans $APP"
    sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$APP/package.json" | head -1 > "$APP/.version-sauvegarde"
    tar -czf "$nom" -C "$APP" .version-sauvegarde "${LISTE[@]}"
    rm -f "$APP/.version-sauvegarde"
  fi
  chmod 600 "$nom"
  chown "$(proprio "$DOSSIER")": "$nom" "$DOSSIER" 2>/dev/null || true
  vert "✓ $nom ($(du -h "$nom" | cut -f1))"
  # Rotation : on garde les $GARDER plus récentes (les « avant-restauration » ne comptent pas)
  n=0
  while IFS= read -r f; do
    n=$((n + 1))
    if [ "$n" -gt "$GARDER" ]; then rm -f -- "$f"; info "ancienne sauvegarde supprimée : $(basename "$f")"; fi
  done < <(ls -1t "$DOSSIER"/remote-station-20*.tar.gz 2>/dev/null || true)
}

case "$ACTION" in
  sauver)
    sauver ""
    ;;
  liste)
    [ -d "$DOSSIER" ] || fin "aucune sauvegarde dans $DOSSIER"
    ls -lht "$DOSSIER"/remote-station-*.tar.gz 2>/dev/null || echo "Aucune sauvegarde dans $DOSSIER"
    if systemctl is-enabled remote-station-backup.timer >/dev/null 2>&1; then
      echo; echo "Sauvegarde automatique : $(systemctl show remote-station-backup.timer -p NextElapseUSecRealtime --value 2>/dev/null | sed 's/^$/active/') (prochaine)"
    fi
    ;;
  restaurer)
    [ -n "$FICHIER" ] || fin "--restaurer : indiquez le fichier (voir --liste)"
    if [ ! -f "$FICHIER" ] && [ -f "$DOSSIER/$FICHIER" ]; then FICHIER="$DOSSIER/$FICHIER"; fi
    [ -f "$FICHIER" ] || fin "fichier introuvable : $FICHIER"
    tar -tzf "$FICHIER" >/dev/null 2>&1 || fin "archive illisible : $FICHIER"
    # Archive complète (dossier remote-station/…) ou de données (config.json… à la racine)
    CONTENU="$(tar -tzf "$FICHIER")"
    PREMIER="${CONTENU%%$'\n'*}"
    if printf '%s\n' "$CONTENU" | grep -Eq '^(\./)?config\.json$'; then TYPE=donnees; else TYPE=complet; fi
    printf 'Restaurer %s (%s) dans %s ?\nLes données actuelles sont d’abord sauvegardées (« avant-restauration »). [o/N] ' "$(basename "$FICHIER")" "$TYPE" "$APP"
    read -r R; case "$R" in o|O|oui|OUI|y|Y) ;; *) echo "Abandon."; exit 0 ;; esac
    COMPLET=0; sauver avant-restauration
    info "Arrêt du service"
    systemctl stop "$SVC" || true
    if [ "$TYPE" = complet ]; then
      tar -xzf "$FICHIER" -C "$(dirname "$APP")"
      [ "${PREMIER%%/*}" = "$(basename "$APP")" ] || echo "Attention : l'archive contenait le dossier ${PREMIER%%/*}/ (extrait à côté de $APP)"
    else
      tar -xzf "$FICHIER" -C "$APP"
      rm -f "$APP/.version-sauvegarde"
    fi
    chown -R "$RUSER:$RUSER" "$APP"
    systemctl start "$SVC"
    vert "✓ Restauré depuis $(basename "$FICHIER") ; service relancé (sudo journalctl -u $SVC -n 30)"
    ;;
  minuterie)
    printf '%s' "$HEURE" | grep -Eq '^([01][0-9]|2[0-3]):[0-5][0-9]$' || fin "heure invalide : $HEURE (format HH:MM)"
    cat > /etc/systemd/system/remote-station-backup.service <<EOF
[Unit]
Description=Sauvegarde des données de Remote Station

[Service]
Type=oneshot
ExecStart=/bin/bash $APP/deploy/backup.sh --calme --dossier $DOSSIER --garder $GARDER
EOF
    cat > /etc/systemd/system/remote-station-backup.timer <<EOF
[Unit]
Description=Sauvegarde quotidienne de Remote Station ($HEURE)

[Timer]
OnCalendar=*-*-* $HEURE:00
Persistent=true
RandomizedDelaySec=120

[Install]
WantedBy=timers.target
EOF
    chmod 644 /etc/systemd/system/remote-station-backup.service /etc/systemd/system/remote-station-backup.timer
    systemctl daemon-reload
    systemctl enable --now remote-station-backup.timer >/dev/null 2>&1
    mkdir -p "$DOSSIER"; chmod 700 "$DOSSIER"; chown "$(proprio "$DOSSIER")": "$DOSSIER" 2>/dev/null || true
    vert "✓ Sauvegarde automatique chaque jour à $HEURE dans $DOSSIER ($GARDER gardées)"
    echo "  Vérifier : systemctl list-timers remote-station-backup   ·   Essai immédiat : sudo systemctl start remote-station-backup"
    ;;
  sans-minuterie)
    systemctl disable --now remote-station-backup.timer >/dev/null 2>&1 || true
    rm -f /etc/systemd/system/remote-station-backup.service /etc/systemd/system/remote-station-backup.timer
    systemctl daemon-reload
    vert "✓ Sauvegarde automatique arrêtée (les archives existantes sont gardées)"
    ;;
esac
