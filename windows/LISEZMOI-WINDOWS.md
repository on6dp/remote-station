# Remote Station UBA-LGE — installation sous Windows 10 / 11 (64 bits)

L'installateur `RemoteStation-Setup-<version>.exe` ne concerne que Remote Station. Il propose deux parties, à cocher :

## 1. PC du club (coché par défaut)

Pour le PC relié au TRX (USB). Le serveur reste celui du club (https://remote.op0p.be) ou celui installé au point 2.

- **Page Station et dashboard** : raccourcis sur le bureau et dans le menu Démarrer.
  « Remote Station - Page Station » ouvre la page Station dans Google Chrome (ou Microsoft Edge), dans une fenêtre à part,
  avec un profil à elle et les réglages qui évitent les coupures : son sans clic préalable, pas de mise en pause en arrière-plan.
  « Remote Station - Dashboard » ouvre le dashboard dans le navigateur habituel.
- **Page Station au démarrage de Windows** : la station revient toute seule après une coupure de courant.
- **Pas de mise en veille** (sur secteur).

Ensuite, la première fois : ouvrir la Page Station, coller le **jeton de la station**, choisir le TRX et son port, puis
« Activer l'audio » et l'entrée son du TRX (voir le manuel : bouton HELP du dashboard, section 13).

Google Chrome est conseillé (la page Station a besoin du port série Web Serial ; Edge le gère aussi, pas Firefox).

## 2. Serveur Remote Station (à cocher seulement si le club n'utilise pas le VPS)

- Le serveur s'installe dans `C:\Program Files\RemoteStation\serveur` et tourne en **service Windows**
  (« Remote Station UBA-LGE », démarrage automatique, redémarré en cas d'arrêt anormal), sur le port **9000**.
- **Node.js** (version 20 ou plus) est nécessaire : s'il manque, l'installateur propose de l'installer avec winget.
- **Accès depuis le réseau (pare-feu)** : ouvre le port 9000 pour les autres PC. Sans cette option, seul ce PC
  peut se connecter (http://localhost:9000).
- Menu Démarrer → **Remote Station** : Ajouter un membre, Liste des membres, Supprimer un membre, Jeton de la station,
  Configuration du serveur (config.json), Redémarrer le serveur, Journaux.
- Accès depuis internet : rediriger le port 9000 du routeur vers ce PC, et de préférence passer en HTTPS : mettre un
  certificat dans `config.json` (`"tls": { "cert": "cert.pem", "key": "key.pem" }`) ou utiliser un tunnel (ex. Cloudflare Tunnel).
  La page Station, elle, doit être ouverte sur ce même PC (http://localhost:9000/station) ou en HTTPS.
- Une réinstallation ou une mise à jour garde la configuration, les comptes, les macros, les journaux et les images SSTV.

## Désinstallation

Paramètres Windows → Applications → Remote Station UBA-LGE, ou menu Démarrer → Remote Station → Désinstaller.
Les données du serveur sont gardées, sauf si vous répondez Oui à la question.

## Installation silencieuse

    RemoteStation-Setup-<version>.exe /S [/KIT=0|1] [/SERVEUR=0|1] [/RESEAU=0|1] [/URL=https://remote.op0p.be]

## Fabriquer l'installateur (développeurs, sous Linux)

    windows/build.sh            # → dist/RemoteStation-Setup-<version>.exe

Voir l'en-tête de `windows/build.sh` (NSIS 3, WinSW téléchargé et vérifié, décodeurs WSJT-X Windows déjà dans lib/bin).
