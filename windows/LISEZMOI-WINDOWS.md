# Remote Station UBA-LGE — installation sous Windows 10 / 11 (64 bits)

L'installateur `RemoteStation-Setup-<version>.exe` ne concerne que Remote Station. Il propose trois parties, à cocher :

## 1. PC du club (coché par défaut)

Pour le PC relié au TRX (USB). Le serveur reste celui du club (https://remote.op0p.be) ou celui installé au point 2.

- **Page Station et dashboard** : raccourcis sur le bureau et dans le menu Démarrer.
  « Remote Station - Page Station » ouvre la page Station dans Google Chrome (ou Microsoft Edge), dans une fenêtre à part,
  avec un profil à elle et les réglages qui évitent les coupures : son sans clic préalable, pas de mise en pause en arrière-plan.
  « Remote Station - Dashboard » ouvre le dashboard dans le navigateur habituel.
- **Page Station au démarrage de Windows** : la station revient toute seule après une coupure de courant.
- **Pas de mise en veille** (sur secteur).

Ensuite, la première fois : ouvrir la Page Station, se connecter avec l'indicatif et le mot de passe d'un **administrateur**
(page réservée, le PC reste autorisé un an), coller le **jeton de la station**, choisir le TRX et son port, puis
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
- **Mise à jour** : relancer l'installateur d'une version plus récente (dossier releases du dépôt GitHub). Le bouton 🔔 du
  dashboard signale la nouvelle version, mais ne l'installe pas sous Windows.
- **SSTV numérique (DRM)** : programmes `drmd.exe`, `drmgen.exe`, `drmrs.exe` inclus depuis la 0.43.63.
- Une réinstallation ou une mise à jour garde la configuration, les comptes, les macros, les journaux, le carnet de trafic et les images SSTV.
- **LoTW** (onglet Logs online) : installer **TQSL** (ARRL) sur ce PC et y importer le certificat de l'indicatif ; dans la configuration
  LoTW du dashboard, indiquer le chemin de `tqsl.exe` (par défaut `C:\Program Files (x86)\TrustedQSL\tqsl.exe`) et le nom du lieu de station
  TQSL. Le certificat et son mot de passe restent sur ce PC. Le service tourne sous le compte Système : remplir aussi « Dossier TrustedQSL »
  avec le dossier du compte Windows où le certificat a été importé (`C:\Users\<nom>\AppData\Roaming\TrustedQSL`).
- **Swisslog, N1MM… sur ce PC** : dans Configuration → UDP du dashboard, adresse 127.0.0.1 et le port attendu par le logbook.

## 3. Agent LoTW (sur le PC où TQSL et votre certificat LoTW sont installés)

Pour signer et envoyer à LoTW les QSO du carnet Remote Station sans export à la main. Ce PC n'a pas besoin d'être celui
de la station : il doit seulement être allumé et relié à internet (fonctionne derrière un CGNAT, Starlink…).

- Avant tout, dans TQSL sur ce PC : le **certificat** de l'indicatif (fichier .p12 : Fichier → Charger un fichier de certificat)
  et un **lieu de station** pour cet indicatif (Lieux de station → Ajouter : indicatif, DXCC, locator).
- Dans le dashboard : carnet → Synchronisation ▾ → Synchronisation LoTW… → choisissez l'indicatif. Le cadre bleu **« LoTW pour … :
  ce qu'il faut »** (0.43.81) montre avec des voyants ✓ / ✗ ce qui est prêt et ce qui manque : TQSL, lieu de station, Agent connecté,
  identifiant du site LoTW (confirmations). Puis cadre **Agent LoTW** → « Appairer un PC… » : un code (ABCD-EFGH) valable 15 minutes.
- Installateur : **décochez** « PC du club » si ce PC ne sert qu'à LoTW, cochez **« Agent LoTW (TQSL de ce PC) »**, puis donnez
  l'adresse du serveur (https://remote.op0p.be) et le code.
- L'agent tourne en **service Windows** (« Remote Station - Agent LoTW », démarrage automatique). Il trouve tout seul TQSL et
  les lieux de station (Station Locations) du compte Windows qui a installé. Le certificat et son mot de passe restent sur ce PC.
- Menu Démarrer → Remote Station : **Appairer l'Agent LoTW** (nouveau code, autre serveur) et **État de l'Agent LoTW**
  (TQSL trouvé, lieux de station, journal).
- Certificat protégé par un mot de passe : invite de commandes en administrateur,
  `node "C:\Program Files\RemoteStation\agent-lotw\agent-lotw.js" --mdp-certificat`.

- **Sans Agent** : carnet → Synchronisation LoTW… → « Je préfère envoyer moi-même avec TQSL » (exporter, signer et envoyer avec
  TQSL, marquer comme envoyés), ou envoi par QRZ.com (certificat déposé chez QRZ). Avec l'identifiant du site LoTW, le carnet voit
  quand même les QSO arrivés dans LoTW (✓) et les confirmations (★).
- **Indicatifs du club** (ON5VL, OR0L) : rien à faire pour les membres, l'Agent d'un administrateur les signe.

## Désinstallation

Paramètres Windows → Applications → Remote Station UBA-LGE, ou menu Démarrer → Remote Station → Désinstaller.
Les données du serveur sont gardées, sauf si vous répondez Oui à la question.

## Installation silencieuse

    RemoteStation-Setup-<version>.exe /S [/KIT=0|1] [/SERVEUR=0|1] [/RESEAU=0|1] [/URL=https://remote.op0p.be]

## Fabriquer l'installateur (développeurs, sous Linux)

    windows/build.sh            # → dist/RemoteStation-Setup-<version>.exe

Voir l'en-tête de `windows/build.sh` (NSIS 3, WinSW téléchargé et vérifié, décodeurs WSJT-X Windows déjà dans lib/bin).
