# Remote Station UBA-LGE (ON5VL / OR0L) — guide des administrateurs

Ce guide s'adresse aux personnes qui gèrent la Remote Station : le serveur (VPS), le PC du club et les comptes des membres.
Les membres, eux, ont le **manuel d'utilisation** ([MANUEL.md](MANUEL.md), aussi dans le dashboard, bouton **HELP**).

**Version décrite : 0.26.1.** L'historique complet est dans [CHANGELOG.md](CHANGELOG.md).

---

## Sommaire

1. [Vue d'ensemble](#1-vue-densemble)
2. [Rôles et droits](#2-rôles-et-droits)
3. [Mettre à jour le serveur](#3-mettre-à-jour-le-serveur)
4. [Gérer les membres](#4-gérer-les-membres)
5. [Réglages du serveur (config.json)](#5-réglages-du-serveur-configjson)
6. [Le PC du club et la page Station](#6-le-pc-du-club-et-la-page-station)
7. [Jeton de la station](#7-jeton-de-la-station)
8. [Émission : autorisation et sécurités](#8-émission--autorisation-et-sécurités)
9. [Phonie à distance et égaliseurs](#9-phonie-à-distance-et-égaliseurs)
10. [MODE AUTO et bande latérale](#10-mode-auto-et-bande-latérale)
11. [Carnet de trafic et logs en ligne](#11-carnet-de-trafic-et-logs-en-ligne)
12. [Statistiques d'utilisation](#12-statistiques-dutilisation)
13. [Surveiller le serveur](#13-surveiller-le-serveur)
14. [Sauvegarder et restaurer](#14-sauvegarder-et-restaurer)
15. [Fichiers secrets](#15-fichiers-secrets)
16. [Problèmes fréquents](#16-problèmes-fréquents)
17. [Installation complète d'un nouveau serveur](#17-installation-complète-dun-nouveau-serveur)

---

## 1. Vue d'ensemble

```
 TRX ──USB──► PC du club (Chrome, page /station) ──internet──► VPS remote.op0p.be ◄── membres (navigateur)
```

| Élément | Où | Rôle |
|---|---|---|
| **Serveur** | VPS VEX `57.131.159.97`, dossier `/opt/remote-station`, service `remote-station` (port local 9000, derrière nginx) | Comptes, main, PTT et sécurités, décodage des modes numériques, carnet, statistiques |
| **Page Station** | PC du club, https://remote.op0p.be/station dans Chrome ou Edge | Pilote le TRX par le port USB (Web Serial), envoie la BF au serveur, joue les signaux d'émission et la voix des opérateurs vers le TRX |
| **Dashboard** | https://remote.op0p.be, navigateur de chaque membre | Face avant du TRX, écoute, modes numériques, phonie à distance, carnet |

- Le PC du club **se connecte vers** le VPS : aucun port à ouvrir au club (le CGNAT de Starlink ne gêne pas).
- Le serveur n'utilise **aucun paquet npm** : seulement Node.js.
- TRX pris en charge : **Yaesu FTX-1**, **FTDX10**, **FTDX101D / MP**, **FTDX5000** (en essai), **Icom IC-7300**, **Icom IC-7760** (en essai). Un seul est en service à la fois, mais plusieurs peuvent rester branchés au PC du club.

---

## 2. Rôles et droits

| Rôle | Qui | Ce qu'il peut faire en plus |
|---|---|---|
| **Membre** | tout indicatif belge (ON, OO, OP, OQ, OR, OS, OT) avec un compte | Piloter quand il a la main, écouter, émettre selon sa licence, carnet (ses QSO) |
| **Membre sans émission** | compte créé avec `--no-tx` | Écoute et réglages seulement |
| **Écouteur** | indicatif ONL… | Jamais d'émission, ni TUNE, ni réglage de puissance |
| **Administrateur** | compte créé avec `--admin` | Page Station (PC du club), reprise de la main, changement de TRX à distance, rechargement de la page Station, lecture CAT, synchronisation des carnets en ligne, réglage du club de l'égaliseur du TRX, menus du FTX-1 (RADIO / CW / OPERATION / DISPLAY / EXTENSION / APRS SETTING, APRS BEACON), mise à l'heure du FTX-1, statistiques (/stats) |
| **Responsable de la station** | `stationEditors` (ON6DP, ON4LUC) | Modifier le jeton, la vitesse et les bits de stop de la page Station ; relancer la carte son du TRX à distance |

**Limites de licence** (automatiques) : ON2 100 W, ON3 25 W et bandes de la licence de base (80, 40, 30, 20, 15, 10 m, 2 m, 70 cm), ONL jamais en émission.

---

## 3. Mettre à jour le serveur

### Depuis le dashboard : bouton « 🔔 Mise à jour » (à partir de la 0.39.15)

Le serveur regarde toutes les 30 minutes sur GitHub (github.com/on6dp/remote-station, dépôt public) si une version plus récente est publiée. Si oui, **les administrateurs** voient en haut à droite du dashboard un bouton jaune **🔔 Mise à jour X.Y.Z** : la cloche bouge et sonne (un « ding-dong ») à son apparition — si le navigateur bloque le son avant le premier clic, elle sonne au premier clic dans la page.

1. Clic sur le bouton : version en service → nouvelle version, et la liste des nouveautés.
2. **Installer maintenant** → confirmer. Le VPS télécharge le paquet officiel sur GitHub, **vérifie son empreinte SHA-256**, le décompresse dans `/opt` et lance `install.sh` (comme à la main). La station est coupée **environ une minute** ; tous les membres connectés sont prévenus.
3. Pendant l'installation, le bouton passe en bleu ⏳ avec l'étape en cours ; en cas d'échec, rouge ⚠ avec la raison (bouton **Réessayer**).
4. À la reconnexion, le dashboard affiche « ✓ Remote Station X.Y.Z installée : rechargez la page (Ctrl+F5) ».

- **La toute première fois**, il faut faire la mise à jour **à la main** (ci-dessous) : c'est `install.sh` qui met en place le programme de mise à jour. Tant qu'il n'est pas en place, le volet du bouton montre les commandes à taper.
- Sécurité : le serveur Remote Station (utilisateur `remotestation`) ne fait qu'écrire le numéro de version voulu dans `/opt/remote-station/update/request`. C'est un service de root séparé (`remote-station-update.path` / `.service`, programme `/usr/local/sbin/remote-station-update`, que le service ne peut pas modifier) qui télécharge depuis l'adresse GitHub fixée dans ce programme, vérifie et installe. Le serveur n'a aucun droit d'administrateur du VPS.
- Journal de chaque mise à jour : `sudo tail -40 /var/log/remote-station-update.log`.
- Couper la vérification : `"updateCheck": false` dans `config.json`.
- Accès internet du serveur utilisés : raw.githubusercontent.com (versions), www.hamqsl.com (propagation, toutes les 30 min, cadre Propagation de la page SSB).
- L'instance de test (test.op0p.be) est mise à la même version par `install.sh`, comme avant.

### À la main

Chaque version est livrée sous forme d'archive `remote-station-X.Y.Z.tar.gz` (dossier [releases/](releases/README.md) du dépôt GitHub, avec ses empreintes SHA-256).

1. Copier l'archive dans `/home/on6dp` avec **WinSCP** (supprimer les anciennes archives pour ne pas se tromper).
2. Dans **PuTTY**, une commande à la fois :

```bash
sudo tar -xzf /home/on6dp/remote-station-X.Y.Z.tar.gz -C /opt
```
```bash
sudo chown -R remotestation:remotestation /opt/remote-station
```
```bash
sudo systemctl restart remote-station
```
```bash
grep '"version"' /opt/remote-station/package.json
```

**Ou, en une seule commande après la décompression** (à partir de la 0.28.0) : `install.sh` refait les droits, met à jour le service si besoin, redémarre et vérifie que le serveur répond :

```bash
sudo bash /opt/remote-station/deploy/install.sh
```

3. **Ctrl+F5** sur le dashboard. La page Station du club se recharge **toute seule** quand le serveur a changé de version (sauf pendant une émission) ; sinon, un administrateur clique le voyant **STATION** du dashboard → « ↻ Recharger la page Station ».

- Le `chown` est **obligatoire** après chaque décompression, sinon `adduser.js` répond « permission denied ».
- La mise à jour garde les comptes, la configuration, le carnet, les journaux, les macros, les profils de micro et les images SSTV.
- Si l'ancien design s'affiche encore après une mise à jour : supprimer d'abord `public` et `lib`, puis refaire la décompression :
  `sudo rm -rf /opt/remote-station/public /opt/remote-station/lib`.

---

### Instance de test (test.op0p.be)

Un 2ᵉ serveur sur le même VPS, indépendant de celui du club : dossier `/opt/remote-station-test`, service `remote-station-test`, port 9001, son propre site. On y essaie un TRX (bouton « Tester sans radio (simulation) » de sa page Station, ou le vrai TRX d'un beta-testeur branché chez lui) **sans toucher à la station du club**.

1. Chez l'hébergeur du domaine (op0p.be) : enregistrement **A** `test` → adresse IP du VPS (la même que `remote`).
2. Sur le VPS, une fois le DNS en place :
   ```
   sudo bash /opt/remote-station/deploy/install-test.sh --domaine test.op0p.be --email votre@adresse
   ```
3. Ensuite, chaque mise à jour du serveur du club (`install.sh`) met aussi l'instance de test à la même version (ses données gardées).

- Repris du serveur du club **une seule fois**, à la création : `config.json` (nom « TEST · … », port 9001, **jeton de station neuf**) et `users.json` (mêmes comptes et mots de passe). Rien ne repart vers le serveur du club.
- Sur l'instance de test : carnet de test séparé, pas de logs en ligne, **pas de PSK Reporter**, **pas de spot envoyé au DX cluster** (`clusterSpot: false` ; les spots sont lus sous ON5VL-8 pour ne pas gêner la liaison ON5VL-7 du club).
- Essai sans TRX : `https://test.op0p.be/station` → choisir le TRX (ex. Yaesu FTDX5000) → **Tester sans radio (simulation)** ; puis `https://test.op0p.be/ftdx5000` ou le dashboard dans un autre onglet.
- Beta-testeur avec son TRX : il ouvre `https://test.op0p.be/station` chez lui (compte administrateur nécessaire pour la page Station), choisit son TRX et son port.
- Journal : `sudo journalctl -u remote-station-test -f` · arrêt et retrait du service : `sudo bash /opt/remote-station/deploy/install-test.sh --retirer` (le dossier reste).

## 4. Gérer les membres

Les commandes se lancent dans PuTTY avec `sudo`. Le chemin complet permet de les taper depuis n'importe quel dossier.

| Action | Commande |
|---|---|
| Ajouter un membre (ou changer son mot de passe) | `sudo -u remotestation node /opt/remote-station/adduser.js ON4XXX` |
| Ajouter un administrateur | `sudo -u remotestation node /opt/remote-station/adduser.js ON4XXX --admin` |
| Membre sans émission | `sudo -u remotestation node /opt/remote-station/adduser.js ON4XXX --no-tx` |
| Supprimer un membre | `sudo -u remotestation node /opt/remote-station/adduser.js --del ON4XXX` |
| Lister les membres (droits, désactivés, dates de fin) | `sudo -u remotestation node /opt/remote-station/adduser.js --list` |
| **Désactiver** un membre (affiliation non renouvelée) | `sudo -u remotestation node /opt/remote-station/adduser.js --disable ON4XXX` |
| Le **réactiver** | `sudo -u remotestation node /opt/remote-station/adduser.js --enable ON4XXX` |
| Accès **jusqu'à une date** incluse | `sudo -u remotestation node /opt/remote-station/adduser.js --until ON4XXX 2027-03-31` |
| Retirer la date de fin | `sudo -u remotestation node /opt/remote-station/adduser.js --until ON4XXX` |
| Même date de fin pour **tous** (sauf administrateurs) | `sudo -u remotestation node /opt/remote-station/adduser.js --until-all 2027-03-31` |

- Le mot de passe est **demandé deux fois** et ne s'affiche pas pendant la frappe (normal). 8 caractères au moins.
- Le compte est actif tout de suite, sans redémarrage. Relancer la commande sur un compte existant **remplace son mot de passe**.
- Remettre le mot de passe au membre **en privé** (de vive voix, message personnel), jamais dans un groupe.

**Affiliation à la section LGE.** Un membre qui ne renouvelle pas est **désactivé** (`--disable`) plutôt que supprimé : son compte, ses QSO et ses statistiques restent, et `--enable` le rétablit. Avec une **date de fin** (`--until`, ou `--until-all` en début d'année), l'accès s'arrête tout seul le lendemain ; il suffit de reporter la date au renouvellement. Le membre voit « Compte … désactivé / expiré le … » (seulement avec le bon mot de passe), et une session ouverte est fermée dans les 30 secondes.

**Créer plusieurs comptes d'un coup** (un indicatif par ligne dans `membres.txt`, copié dans `/home/on6dp`) :

```bash
sudo install -m 644 /home/on6dp/membres.txt /tmp/membres.txt
```
```bash
cd /opt/remote-station && sudo -u remotestation node importusers.js /tmp/membres.txt
```
```bash
sudo mv /opt/remote-station/comptes-*.csv /home/on6dp/ && sudo chown on6dp: /home/on6dp/comptes-*.csv
```

Le fichier `comptes-AAAA-MM-JJ.csv` contient les mots de passe générés : les remettre aux membres, puis **supprimer le fichier** du VPS et de votre PC. Les comptes existants ne sont pas modifiés (option `--reset` pour leur donner un nouveau mot de passe).

**Un même compte sur deux PC** : la nouvelle connexion remplace l'ancienne (la première est coupée). Chacun doit avoir son propre compte.

---

## 5. Réglages du serveur (config.json)

Fichier `/opt/remote-station/config.json`. Le modifier avec `sudo nano /opt/remote-station/config.json`, puis :

```bash
sudo systemctl restart remote-station
```

| Réglage | Par défaut | Rôle |
|---|---|---|
| `clubName`, `stationCall` | — | Titre de la page (« Remote Station UBA-LGE », « ON5VL / OR0L ») |
| `digiCall`, `stationGrid` | ON5VL, JO20 | Indicatif et locator des modes numériques |
| `clubCalls` | ON5VL, OR0L | Indicatifs du club proposés dans « TX call » |
| `allowTx` | `false` | Autorise l'émission (section 8) |
| `txRanges` | Région 1 IARU | Plages d'émission autorisées (Hz) |
| `maxTxSeconds` | 120 | Durée maximale d'une émission |
| `remoteVoice` | `true` | Phonie à distance (section 9). `false` : le PTT garde le micro du club |
| `bandPlan` | `true` | MODE AUTO, plan de bande IARU Région 1 (section 10) |
| `refData` | `true` | Téléchargement des listes IOTA / WWFF / POTA / BOTA / LLOTA / SOTA pour le carnet (section 11). `false` : pas de téléchargement, les cases de référence restent utilisables à la main |
| `autoSideband` | `true` | LSB sous 10 MHz, USB au-dessus, au changement de bande (section 10) |
| `controlIdleMinutes` / `sessionIdleMinutes` | 15 / 15 | Main libérée / membre déconnecté après ce temps sans action |
| `idleExempt` | ON6DP, ON4LUC, ON5VL | Jamais déconnectés pour inactivité (la main est quand même libérée) |
| `rememberDays` | 7 | Jours pendant lesquels un navigateur reste connecté |
| `controlMaxMinutes`, `controlWarnSeconds`, `controlAskMinutes` | 45 min, 120 s, 15 min | Équité : la main passe au membre qui l'a demandée après 45 min (avertissement 2 min avant, jamais pendant une émission) ; 0 = sans limite |
| `licenceBands` | ON3 : 80, 40, 30, 20, 15, 10 m, 2 m, 70 cm | Bandes permises en émission par début d'indicatif |
| `powerRules`, `defaultMaxWatts` | ON2 100 W, ON3 25 W, sinon 1500 W | Puissance maximale selon l'indicatif |
| `rxOnlyPrefixes` | ONL | Indicatifs en écoute seule |
| `allowedPrefixes` | ON, OO, OP, OQ, OR, OS, OT | Préfixes autorisés à se connecter |
| `allowedCalls` | (vide) | Exceptions : indicatifs étrangers admis nommément (`node adduser.js F4ABC --exception`, puis redémarrer le service) |
| `maxSwr`, `swrHoldMs` | 2,5, 700 ms | Coupure de l'émission sur ROS élevé (0 = pas de protection) |
| `tunerAuto` | `true` | Tuner remis en service à chaque changement de bande HF / 6 m |
| `txSilenceSeconds`, `txHardMaxSeconds` | 120, 300 | Chien de garde de la page Station (TRX en émission sans modulation / en continu) ; en modes numériques (DATA, RTTY, PSK), 20 s sans modulation au plus (`txSilenceDigiMs`) |
| `digiAlcMax` | 10 | Limiteur d'ALC en émission numérique (% de la zone ALC du TRX ; Icom : 0 à 120 en CI-V = 100 %) ; 0 = sans |
| `ftxWatchdogMinutes` | 6 | Arrêt d'une séquence FT8 / FT4 / FT2 sans réponse |
| `stationEditors` | ON6DP, ON4LUC | Responsables de la station (section 2) |
| `stationTz` | Europe/Brussels | Fuseau des statistiques |
| `clusterHost`, `clusterPort`, `clusterCall`, `clusterCmds` | op0p.be, 8000 | DX cluster de la carte de bande ; `clusterHost` vide = sans cluster. Les spots des opérateurs (case « Spot cluster » au log) passent par une courte liaison au même cluster sous l'indicatif de leur compte (pas `clusterCall` ni le TX call) ; journal `spot` |
| `updateCheck` | `true` | Vérifie toutes les 30 min sur GitHub si une nouvelle version existe : bouton « 🔔 Mise à jour » au dashboard des administrateurs (voir §3) ; `false` = pas de vérification |
| `pskReporter`, `pskAntenna` | `true`, vide | Stations FT8 / FT4 / FT2 décodées envoyées à PSK Reporter (pskreporter.info) toutes les 5 min sous `digiCall` et `stationGrid`, comme WSJT-X (UDP vers report.pskreporter.info:4739) ; `false` = arrêt ; `pskAntenna` : texte d'antenne affiché sur la carte |
| `qsyOrigins` | dx.op0p.be, cluster.op0p.be | Sites de DX cluster autorisés à caler le TRX sur un spot |
| `ftx1SubCat`, `ftx1SubSingle` | `true`, `false` | FTX-1 : MAIN / SUB par le dashboard (en réception simple : refusé, sauf essais) |
| `qo100If` | 144,5 / 432,5 / 1296,5 | FI des convertisseurs QO-100 |

Changer le titre sans éditeur :

```bash
sudo sed -i 's|"clubName": *"[^"]*"|"clubName": "Remote Station UBA-LGE"|' /opt/remote-station/config.json
```

---

## 6. Le PC du club et la page Station

### Installation (Windows 10 / 11)

Lancer `RemoteStation-Setup-X.Y.Z.exe` (dossier [releases/](releases/README.md)) et garder la partie **PC du club** cochée :
raccourci « Remote Station - Page Station » (Chrome avec les bons réglages, son sans clic préalable, pas de mise en pause), lancement au démarrage de Windows, pas de mise en veille. Détails : [windows/LISEZMOI-WINDOWS.md](windows/LISEZMOI-WINDOWS.md).

**Navigateur** : **Chrome ou Edge** obligatoirement (Firefox et Safari n'ont pas le Web Serial ; la page l'indique par un bandeau rouge).

### Première mise en route

1. Brancher le TRX en USB (pilote « Virtual COM Port » de Yaesu ; pilote Silicon Labs CP210x pour l'IC-7300 ; pilote USB Icom pour l'IC-7760).
2. Ouvrir la page Station et se connecter avec l'indicatif et le mot de passe d'un **administrateur** (le PC reste autorisé un an).
3. Le **jeton de la station** est repris tout seul du serveur : rien à recopier (section 7).
4. **Réglages** : choisir le **modèle du TRX** (la page se recharge avec son pilote), puis « **Choisir le port du TRX** ». Le journal doit afficher « … répond ».
5. **Audio du TRX** : « Activer l'audio », puis l'**entrée son** du TRX (« USB Audio CODEC »… jamais « Par défaut » ni « Communications »). La barre de niveau doit bouger.
6. **Sortie son vers le TRX** : la carte son USB du TRX (« Haut-parleurs (USB Audio CODEC) »), jamais les haut-parleurs du PC. Elle sert aux émissions numériques **et** à la phonie à distance.
7. Régler **Niveau d'émission** (numérique) et **Niveau phonie à distance** pour que l'ALC reste faible (section 9).
8. Chrome → Paramètres → Performances : « Toujours garder ces sites actifs » → ajouter `remote.op0p.be` ; désactiver l'économiseur d'énergie. Windows : mise en veille sur **Jamais**.
9. Garder la page Station **seule dans sa fenêtre** ; pour piloter depuis le PC du club, bouton « Ouvrir le dashboard dans une autre fenêtre ». **Une seule page Station à la fois**, quel que soit le PC.

### Assistant carte son (PC du club)

Petit programme Windows (PowerShell, tâche planifiée « RemoteStation carte son », compte SYSTEM) qui :
- relance la carte son USB du TRX quand elle se fige (à la demande de la page Station ou du dashboard, seule après 45 s de silence) et la répare si Windows la met en erreur ;
- coupe la mise en veille USB de Windows (cause fréquente d'une carte son figée) ;
- met l'horloge de Windows à l'heure à la milliseconde, comme NetTime (au démarrage, toutes les heures, et bouton « ⟳ Mettre à l'heure » de l'onglet Synchro) — désinstaller NetTime.

Installation ou mise à jour : sur la page Station (administrateur connecté), lien **« Télécharger l'assistant carte son »** (affiché tant que l'assistant manque ou n'est pas à la dernière version) → décompresser (remplacer l'ancien dossier) → double-clic sur `installer-carte-son.cmd` → « … en marche (version 5) ». **Version 5** : priorité basse et surveillance de la carte son une fois par minute (requête limitée à la carte son du TRX), plus légère pour le PC du club. Retrait : `retirer-carte-son.cmd`. Journal : `C:\ProgramData\RemoteStation\rs-carte-son.log`.

**Membres** : pour écouter et piloter, **Chrome ou Edge** aussi. Sous Firefox, l'écoute du TRX peut être hachée.

### Réglages des TRX

| TRX | Menu du TRX | Port à choisir | Vitesse |
|---|---|---|---|
| **FTX-1** (firmware MAIN 1.08 ou plus) | Operation setting → General : CAT-1 RATE 38400, CAT-1 CAT-3 STOP BIT 1 bit, RPTT SELECT OFF, PC KEYING OFF | Enhanced COM Port (CAT-1) | 38400 |
| **FTDX10** | Operation setting → General : CAT RATE 38400, **CAT RTS OFF**, RPTT SELECT OFF | Enhanced COM Port | 38400 |
| **FTDX101D / MP** | OPERATION SETTING → GENERAL : CAT RATE 38400, **CAT RTS OFF**, CAT TOT 100 ms, RPTT SELECT OFF | Enhanced COM Port (le Standard sert à la manipulation DTR) | 38400 |
| **IC-7300** | MENU → SET → Connectors → CI-V : USB Baud Rate 115200, Address 94h, USB Echo Back OFF ; USB SEND et USB Keying OFF | port USB de l'IC-7300 | 115200 |
| **FTDX5000** (pas de port USB) | Menu 032 CAT RATE 38400, 033 CAT TIME OUT TIMER 100 ms, **034 CAT RTS DISABLE** ; son : interface USB (RigExpert TI-5000, SignaLink…) sur la prise DATA, 069 DATA IN SELECT = DATA | adaptateur USB ↔ RS-232 (FTDI) sur la prise CAT | 38400, **2 bits de stop** (1 si le TRX ne répond pas) |
| **IC-7760** | Câble USB sur le port **[USB B] de la tête de commande** (pas le bloc RF) ; MENU → SET → Connectors → CI-V : adresse B2h, « CI-V USB (A) Echo Back » OFF ; USB SEND / USB Keying OFF ; USB AF/IF Output → Output Select = AF ; MOD Input → DATA1 MOD = USB | 1er des deux ports COM du port [USB B] (USB (A)) | 115200 (port USB virtuel) |

- **FTDX10 / FTDX101 : CAT RTS doit être sur OFF**, sinon la liaison CAT tombe toutes les 2 secondes (voyant vert puis orange).
- Aucun autre logiciel (WSJT-X, logbook…) ne doit utiliser le port CAT en même temps.
- **FTDX5000 (en essai)** : pilote écrit d'après le manuel CAT (FA / FB sur 8 chiffres, SPLIT par FT2 / FT3, FR 0–3, menus EX sur 3 chiffres). À vérifier au premier essai : puissance lue / réglée en watts (PC005–PC200), TUNE (`AC002;`), largeurs SH, double réception (FR2). Pas encore : CONTOUR / APF, macros CW (mémoire KM du TRX), double décodage (une seule voie son).
- **IC-7760 (en essai)** : pilote écrit d'après le guide CI-V Icom (octobre 2024) : MAIN = VFO A, SUB = VFO B ; réglages de chaque récepteur par la commande 29 (29 00 MAIN, 29 01 SUB) ; 25 / 26 fréquence et mode de chaque côté ; 07 D0 / D1 côté sélectionné, 07 C0 / C1 DUAL WATCH, 07 B0 échange, 07 B1 égalise ; phonie à distance : DATA OFF MOD (1A 05 01 29) mis sur USB le temps de l'émission. À vérifier au premier essai : puissance 14 0A en watts (0–255 ↔ 0–200 W supposé), son USB (une voie, ou MAIN | SUB en stéréo), port COM (USB (A)). Simulation : page Station → Icom IC-7760 → Tester sans radio.
- **CW par DTR** (facultatif, plus réactif) : page Station → « Port de manipulation CW (DTR)… » → le 2ᵉ port USB du TRX (Standard COM Port). Le menu PC KEYING du TRX est mis sur DTR tout seul pendant l'émission.
- **Clé CW à distance** (palettes ou pioche des opérateurs, depuis la 0.37.174) : elle passe **obligatoirement** par ce port DTR. Sans lui, la page Station refuse (« 2e port USB du TRX (manipulation DTR) non ouvert »). Après la mise à jour, **recharger la page Station** (Ctrl+F5) : une ancienne page refuse la clé à distance. Premiers essais **sur charge fictive**, en présence d'un membre au club.
- **Clé des opérateurs chez eux** : rien à installer au club ni chez eux. Chaque opérateur relie sa clé à **son** PC par une interface USB, jamais par la carte son : adaptateur **USB → RS-232 DB9 mâle** (CH340 / PL2303 / FTDI) avec une prise **DB9 femelle à bornier** : commun de la clé → **broche 4 (DTR)**, point → **6 (DSR)**, trait → **8 (CTS)** (le commun ne va **pas** sur la broche 5 GND), puis « Câble USB-série (DSR / CTS) » dans la page **TRX CW** (onglet CW → 🎛 TRX CW). Autres solutions : adaptateur VBand / Vail, ou Arduino Pro Micro (masse → GND, point → A2, trait → A3). Les câbles USB « TTL » (4 ou 6 fils) et les câbles console USB → jack ne conviennent pas pour une double palette. Détails, essai au trombone et liste du matériel : aide, section 12.6 « Brancher une double palette ».

### Changer de TRX

- **Au club** : page Station → Réglages → « Modèle du TRX ». La première fois pour un modèle, choisir son port ; il est ensuite mémorisé par modèle.
- **À distance** (administrateurs) : dashboard → clic sur le voyant **STATION** en haut à gauche → choisir le TRX. Possible seulement si ce TRX est branché au PC du club et que son port a déjà été choisi une fois, et jamais pendant une émission. La main est conservée.
- **Plusieurs TRX branchés au même PC** (chacun sur son port USB) : la page Station retient pour **chaque modèle** son port CAT (identité USB du câble) et sa carte son (entrée et sortie). Préparation au club, une fois par TRX : sélectionner le modèle, « Choisir le port du TRX », choisir l'entrée et la sortie son, « Enregistrer et reconnecter ». Ensuite la commutation à distance prend quelques secondes.
- À la mise à jour vers la 0.27.0, la carte son déjà réglée est reprise pour le TRX en service à ce moment-là ; pour les autres modèles, choisir leur carte son une fois après la première commutation.

### Face avant (page /ftdx101)

- `https://remote.op0p.be/ftdx101` : la photo de la face avant du FTDX101MP (prise par ON6DP), avec une zone cliquable par touche et par bouton rotatif. Mêmes comptes, même main, mêmes sécurités que le dashboard ; le dashboard ne change pas.
- Fichiers : `public/face.html`, `public/js/face.js` (fonctionnement), `public/css/face.css`, `public/faces/ftdx101.webp` (photo, voyants allumés effacés) et `public/faces/ftdx101.js` (position et fonction de chaque touche, en pixels de la photo).
- **Vérifier ou corriger les zones** : `https://remote.op0p.be/ftdx101?zones=1` montre les contours et la position de la souris ; corriger les nombres dans `faces/ftdx101.js`.
- **Autre modèle** (ex. FTDX10) : une photo `faces/ftdx10.webp`, une description `faces/ftdx10.js` sur le même modèle, la route `'/ftdx10': '/face.html'` dans `server.js` et la ligne `<script src="/faces/ftdx10.js">` dans `face.html`.
- **FTDX5000** (`/ftdx5000`, en essai) : `faces/ftdx5000.webp` = face avant du logiciel Yaesu PCC-5000 (2× 1100 × 684 : voyants et chiffres de l'afficheur éteints) + réplique de l'afficheur (disposée comme celle du TRX : VFO-A en haut, S-mètre du SUB au milieu, VFO-B en bas ; toutes les valeurs dessinées éteintes, rallumées par `glows` aux zones `VR` relevées par le script de dessin) et cadre de l'écran dessous ; `faces/ftdx5000.js` (zones relevées sur l'image 1018 × 318 puis × 1100/1018 ; `glows` : voyants rallumés en color-dodge ; `texts` : chiffres en direct). Touches sans commande CAT dans le manuel (VRF, CONT/APF, R.FLT, TXW, mémoires) : message d'explication. Touches ANT (AN 0 / AN 1) / ATT / IPO / R.FLT / AGC « sided » (côté de vfoSel). CONT/APF : CO P1 0 P3 (000 OFF, 001 CONTOUR, 002 APF), CO P1 1 P3 (fréquence 01 – 40 = 100 – 4000 Hz) ; nombre de chiffres de P3 repris de la réponse du TRX (`coDig`, `coFDig`) car le manuel est ambigu. R.FLT : RF P1 P2 (réglage 0 AUTO, 1 15k, 2 6k, 3 3k, 4 600, 5 300) ; réponse P3 1 – A (4 – 6, 9, A = AUTO) → `roof` / `roofAuto` (et B).
- **IC-7760** (`/ic7760`, en essai) : `faces/ic7760.webp` = photo Icom de la tête de commande (1634 × 581, coins blancs retirés, écran et petit écran noircis, voyants TX/RX éteints) ; `faces/ic7760.js` : positions relevées sur la photo puis × 570/740 pour que l'écran de la page ait la taille de celui du FTDX101 (`dualIcom` : écran Icom — colonne de touches ANT / P.AMP / ATT / DIGI-SEL / IP+ / AGC / COMP, en-têtes ANT · BW · SFT, galvanomètres réduits, « VFO [mode] [FIL] », fréquence en police Icom, scope à droite de la colonne (`lay.scopeX`), rangée <MENU1> · SPAN/EDGE · HOLD · CENT/FIX · MAIN/SUB · DUAL · EXPD/SET en touches bleues, texte Arial 900 blanc 11 px, touche SPAN nommée EDGE quand le scope du récepteur sélectionné est en FIX (grand écran : S-mètre / Po et SWR en barres de même largeur (SWR 1 → 0, 3 → 0,6, ∞ → 1), police Arial pour tout l'écran (`#face[data-model='ic7760'] .lcd text`, pas de zéro barré), fréquence à y 80, case TX 22 × 13 en gras (`.lcd text.i76-txt`) sur le VFO qui émet, DUAL-W au-dessus de SPLIT entre les deux VFO (x 285, y 24 / 43, 11 px gras), fréquence du MAIN finissant avec ses barres (x0 + 194), bloc du VFO-B (en-tête, barres, ligne VFO) décalé de 56 et aligné à droite sur sa fréquence, en-tête ANT · BW · SFT en blanc gras 9 px, `lay` lowY 96 / scopeY 108 / scopeH 184 ; petit écran `FACE.subMeter` : galvanomètre Icom S / Po / SWR / COMP du récepteur sélectionné + date, SUB DISP (`L.subDisp`) ⇄ filtre ; tableau AGC (appui long sur AGC) : CI-V 29 0x 1A 04 = constante du mode et du FAST/MID/SLOW en cours (00 OFF, 01 – 13), cases pas encore lues = valeurs d'usine ; chiffres Arial 900 blancs `.lcd text.i76agc-v` ; 1/4 en CW/RTTY/PSK = pas du grand bouton ÷ 4 sur la page (pas de commande CI-V) ; SIDETONE = 1A 05 02 86 ; accord DIGI-SEL = `dsShift` (14 13 29, appui long sur DIGI-SEL → colonne MULTI) ; clic sur la case MULTI déjà choisie = ON/OFF (digiSel, proc, moni) ; fenêtres `L.i76pop` (ant / bw / sft / band / finp) : ANT = 12 0n rr (29), RX ANT = contrôle `rxAnt`, largeur = `filWi` (1A 03 29 : SSB/CW/PSK 0 – 40, RTTY 0 – 31, AM 0 – 49, pas en FM), SFT = pbtIn + pbtOut ensemble (~50 Hz par cran), forme SHARP/SOFT = `filShape` (16 56 29) ; BAND STACKING tenu par la page (localStorage `rs.face.i76bstk`, par récepteur et par bande ; le registre 1A 01 du TRX n'est pas utilisé) ; « RFG » quand rf / rfB < 250 (en-tête en DUAL, sous MET Po en SINGLE) ; voyants POWER (bleu, `connected`), TUNER / NB / NR / APF / NOTCH (blancs) et VOX/BK-IN (bleu) en chemins `circ()` dans FACE.leds ; repère ▼ de chiffre (`L.digit`, `i76DigitAt` par getExtentOfChar : MHz = BAND STACKING au clic, ▼ MHz par appui long ; kHz / Hz = ▼ ; grand bouton et molette sur la fréquence = pas de ce chiffre) ; écran MENU (`buildGrid(…, 3)` : 3 rangées de 5, icône ANTENNA ; MEMORY / SCAN / MPAD / RECORD à faire) ; colonnes NB (nbLvl, DEPTH 1A 05 03 63, WIDTH 1A 05 03 64) et NR (nrLvl) comme la colonne NOTCH (`L.mmKind = 'notch'`, ouverte quand le notch manuel du récepteur sélectionné passe en service ; position 14 0D ≈ 300 – 2700 Hz pour le repère N du filtre) ; MULTI-FUNCTION METER (`L.i76meter`, MENU → METER, même place que FUNCTION ; Po 15 11, ALC 15 13, COMP 15 14, SWR 15 12, Id 15 16, Vd 15 15 ; pas de TEMP en CI-V) ; FUNCTION (`I76_FUNC` : 9 touches sous le scope raccourci par `placeScope`, I76_FTOP = 186 ; DPD = 16 67) ; TWIN-PBT (IC-7760) : bague = BW (les deux PBT en sens contraire), bouton = SFT (les deux ensemble), `pbtTurn76` / `pbt76` (valeurs envoyées en priorité, BW par 50 Hz, SFT par 25 Hz, mêmes valeurs dans l'en-tête, le petit écran et le cadre #icPbt, placé à gauche pour le MAIN et à droite pour le SUB), voyant blanc quand un PBT n'est pas au milieu ; petit écran : 3e galvanomètre `LCD.mS` (copie de l'aiguille en RX, mesure `L.metSel` en TX), barres Multi-function `L.metMulti`, SUB DISP sans exception en un seul scope ; Others → Information → Version : tableau `I76_VER` de face.js (relevé à la main, aucune commande CI-V ; à mettre à jour après une mise à jour du firmware ; MAC et n° de série volontairement pas dans le dépôt) ; fenêtre MODE : mode choisi affiché tout de suite (`L.popModeAt`, 2,5 s) et 26 00 / 26 01 relu au cycle suivant (`_readBack` dans station-core.js) ; bandeau du scope (`LCD.i76hdr`) : 27 1A / 1F / 1D / 19 relus dans la boucle lente, Max Hold et Scope during Tx (1A 05 02 09 / 02 08) lus une fois ; SCOPE SET : 1A 05 02 08 … 02 23, Fixed Edges 02 24 … 02 71 (contrôle `exEdge`) ; <MENU2> : 27 19 (REF), 27 1A (SPEED), 27 1F (RBW), 27 1D (VBW) ; SET → Display : 1A 05 01 84 … 01 99 (pct = 2 octets 0000 – 0255, rgb = 3 × 2 octets écrits par le contrôle `exRgb` ; 01 98 / 01 99 lecture seule), fenêtre de liste `L.exList` ; MENU → ANTENNA : 1A 05 03 44 … 03 48 (TYPE, lecture seule), 03 49 … 03 60 (ANTENNA MEMORY, 2 octets : ANT 00 – 03, RX-ANT 00/01), 03 61 (TEMP-M), 03 62 ([ANT] SW) — écriture refusée par le serveur aux non-administrateurs (`EX[n].wAdmin`) ; M.SCOPE (IC-7760) : `L.i76meter` → `L.i76mtOnly` → scope ; petit écran filtre : waterfall du son reçu (canvas dans un foreignObject), touches FIL / SHARP / MN au toucher ; DPD Adjustment : liste affichée, rien d’envoyé ; SET → Network : 1A 05 01 61 … 01 71, 01 76 (Network Name), Different Segment Settings 01 72 … 01 75 en lecture seule (rw false, exSet refusé), exRead refusé par le serveur aux non-administrateurs (`EX[n].admin`), IP = 4 × 2 octets BCD ; Display → Meter Type 1A 05 01 88 (Standard / Edgewise / Bar) pas encore utilisé ; SET (`buildI76Set`, 2 × 6 rubriques) avec arborescence du pilote (`EX_TREE` dossiers, `EX_MENUS` réglages, `EX_PARENT` pour ↩) ; Tone Control/TBW = 1A 05 00 01 … 00 22 (types hl, tone, tbw6 : bord bas 100/120/150/200/300/500, bord haut 2500/2700/2800/2900), réglés par la fenêtre `L.hlDlg` (+ / −, grand bouton) et envoyés à ↩ / EXIT par exSet, relus par exRead ; F-INP au clavier (repère orange « F-INP » à droite de FIL sur le VFO concerné pendant la saisie) ; SUB DISP 0 galvanomètre / 1 filtre / 2 bandes ; régions du scope selon `scDual` (0 → tout de suite le seul scope du récepteur sélectionné, sans attendre 1,5 s la fin des trames de l'autre) ; disposition selon `scDual` (`i76Layout` : SINGLE = galvanomètres en haut × 0,9, décalages I76_SINGLE, scope descendu de 72 par `placeScope`, petit écran sur le filtre ; DUAL = barres) ; DUAL-W (`local: i76dualW`) envoie aussi 27 13 ; fenêtre MODE (`modeKey`, SSB = LSB < 10 MHz sinon USB, DATA = USB-D1 à toute fréquence, affiché « USB-D1 ») ; loupe du scope (`ZM`, canevas `.fc-zoom`, 10 % de la largeur affichés sur 30 %) et glisser = accord continu (`tuneTo`) ; colonne MULTI selon le mode (`i76MultiItems` : SSB RF POWER/MIC GAIN/COMP/DIGI-SEL/MONITOR, CW avec KEY SPEED/CW PITCH/SIDETONE, RTTY/PSK RF POWER/DIGI-SEL/MONITOR, cases vides sans réglette) ; chiffres des galvanomètres en Arial gras droit via `#face[data-model='ic7760'] .mtr-num` ; grande fréquence à y 129, voyants à y 140 ; colonne de gauche : barrette `.i76-kon` cyan si en service, `.off` grise ; dégradés `i76btn` / `i76btnOn`, classes `.lcd-bot.i76b`), EXPD/SET masquée et six touches resserrées sous le scope quand la colonne MULTI est ouverte (↩ dans la colonne), appui long sur CENT/FIX = SCROLL-C / SCROLL-F (27 14 02/03), écran FUNCTION et menu MULTI Icom ; filtre du récepteur sélectionné dans le petit écran (`subLcd`) ; touches et TWIN PBT `sided` = récepteur sélectionné). Page SSB : 2e carte de bande (VFO-B) à droite pour les TRX à deux récepteurs. Scope du TRX : `27 00` du MAIN et du SUB (octet 1 = 00 / 01), assemblés à part par la page Station (`s: 1` pour le SUB), relayés par le serveur ; réglages 27 12 (MAIN/SUB), 27 13 (DUAL), 27 14 – 27 17 (CENTER/FIX, SPAN, EDGE, HOLD de chaque scope).
- Le FTDX101 a trois réglages en plus pour cette page : AF du récepteur SUB (`AG1`), BREAK-IN (`BI`) KEYER (`KR`), fonction de la bague MPVD (`SF0;` : grande touche VC TUNE = 2, arrêt = 3 SUB), fréquences CONTOUR / APF (`CO01;` `CO11;` `CO03;` `CO13;`) et VC TUNE (`VT0;` / `VT1;` : marche, position 000-255, installé ou non ; réglage `VT01+1;` / `VT01-1;` par la bague du grand bouton après la grande touche VC TUNE, à vérifier sur le vrai TRX), lus avec les autres ; ils n'apparaissent pas dans le dashboard. SYNC est géré par la page (les deux VFO accordés ensemble), pas par le TRX.
- Lectures « chaudes » (page Station, `station-core.js`) : une lecture lente dont la valeur vient de changer (bouton tourné sur le TRX) est relue à chaque cycle pendant 4 s (3 au plus à la fois) ; pas pour les mesures (S-mètre, PO, SWR…).
- Fenêtres séparées : ⧉ des onglets des modes numériques (→ `digi.html`, raccrochée à la face avant par `window.opener.RSHOST`, comme pour le dashboard) et ⧉ de la carte de bande (la colonne `#fcBm` est déplacée telle quelle dans une fenêtre ; mémorisée dans le navigateur sous `rs.face.bmwin`).

### Face avant du FTX-1 (page /ftx1) : menus du TRX

- Les menus **RADIO / CW / OPERATION / DISPLAY / EXTENSION / APRS SETTING** (écran FUNC, page 3, rangée du bas) et **APRS BEACON** (case APRS BEACON, en FM) sont réservés aux **administrateurs** (ON6DP, ON4LUC). Le serveur refuse `menu_read` / `menu_write` / `menu_dt` aux autres (`MENU.admin` dans `public/js/ftx1.js`).
- Table des menus : `MENU` dans `public/js/ftx1.js`, d'après le manuel CAT du FTX-1 (2508-C, Table 3 : commande `EX P1P2P3` + valeur), avec les libellés de l'écran du TRX quand ils diffèrent du manuel (RF/SQL VR : AUTO ; TUN/LIN PORT SELECT : OPTION, BAND DATA, CAT-3, GPO ; TUNER SELECT : OPTION, ATAS). Vérifié au club : puissances de la tête Field en dixièmes de watt (`060` = 6.0W, `100` = 10.0W), RPT SFT FREQ 144 / 430 MHz par pas de 50 kHz (`0152` = 7.60MHz ; le « 0100 » maximum du manuel est faux).
- Lecture : à l'ouverture d'un sous-menu puis toutes les 8 s tant que l'écran est ouvert ; pendant une lecture de menus, la page Station suspend ses lectures en rafale (sinon les réponses arrivent trop tard), 1,2 s d'attente par réglage.
- **Bloqués même pour les administrateurs** (`LOCK`) : CAT-1 / CAT-3 (vitesse, délai, bits d'arrêt : couperait la station), MOD SOURCE, USB MOD GAIN et RPTT SELECT (phonie à distance), PC KEYING et CW MEMORY 5 (CW à distance), PRMTRC EQ (profils EQUALIZER TRX, bouton « Ouvrir EQUALIZER TRX »), AUTO POWER OFF (le TRX ne se rallumerait pas). CAT-2 est réglable (la station n'utilise que CAT-1).
- Réglables par un administrateur : puissances maximales, QRP MODE, VOX SELECT, TX INHIBIT, EMERGENCY FREQ TX, REF FREQ ADJ, tuner / antennes, GPS, APRS (dont BEACON TYPE : en AUTO ou SMART, le TRX émet tout seul !), TIME ZONE…
- **DATE&TIME** : commande `DT0` (date aaaammjj) / `DT1` (heure locale hhmmss) ; bouton « Mettre à l'heure de votre PC » (main prise).
- Textes (MY CALL, CALLSIGN APRS, messages, statuts, groupes, symbole USER) : relus seulement. WIRES-X, DAY… : absents du manuel CAT, rien n'est envoyé (« au TRX »).
- **DTMF** (FUNC page 3) : mémoires 1 à 10 = `EX010328` à `EX010337` (0-9, A-D, *, #, « - » pour l'espace), lues par tous, écrites par l'opérateur qui a la main ; aucune tonalité n'est émise.
- **SPAN** du scope : `SS05` lu et écrit (2 = 5 kHz … 9 = 1 MHz). Le spectre de la page reste celui du son reçu.
- **ATT / IPO du SUB** : `RA0` / `PA` n'agissent que sur le côté en service ; la page les lit quand le SUB est actif et les garde, et refuse de les régler (ils changeaient le MAIN). Pas de commutation MAIN / SUB automatique (VS1 avait mis le TRX en émission).

### Commandes à distance (menu du voyant STATION, administrateurs)

| Commande | Effet |
|---|---|
| Nom d'un TRX | Passe sur ce TRX (la station redémarre quelques secondes) |
| ↻ Recharger la page Station | Recharge la page du PC du club (nouvelle version, page bloquée) |
| 🔊 Relancer la carte son du TRX | Responsables seulement : redémarre la carte son USB du TRX quand la BF ne passe plus (assistant carte son installé sur le PC du club) |
| ⌨ Lecture CAT… | Diagnostic : lit des valeurs brutes du TRX (lecture seulement) |

---

## 7. Jeton de la station

Le jeton autorise la page Station à se brancher sur le serveur. **Ne jamais le publier** (ni dans un message, ni sur GitHub, ni dans le programme).

- Il est dans `config.json` sur le VPS, et seulement là.
- La page Station le **reçoit toute seule** du serveur quand un administrateur y est connecté : changer de PC, redémarrer le PC ou le TRX ne demande rien. Un nouveau jeton est repris automatiquement.
- Le voir (sur le VPS uniquement) :

```bash
sudo grep stationToken /opt/remote-station/config.json
```

- Le changer (si on craint qu'il ait été vu) :

```bash
sudo sed -i "s/\"stationToken\": *\"[^\"]*\"/\"stationToken\": \"$(openssl rand -hex 24)\"/" /opt/remote-station/config.json
```
```bash
sudo systemctl restart remote-station
```

---

## 8. Émission : autorisation et sécurités

**Autoriser l'émission** (après les essais sur charge fictive, en présence d'un membre au club) :

```bash
sudo sed -i 's/"allowTx": *false/"allowTx": true/' /opt/remote-station/config.json
```
```bash
sudo systemctl restart remote-station
```

Pour tout couper : même commande avec `true` et `false` inversés.

**Sécurités** (aucune à régler, sauf mention) :

| Situation | Réaction |
|---|---|
| Le membre ne maintient plus le PTT (réseau coupé, onglet fermé) | Retour en réception après 1,5 s |
| Émission trop longue | Coupure après `maxTxSeconds` ; il faut relâcher puis réappuyer |
| Le PC du club perd le VPS pendant l'émission | Retour en réception après 2 s (côté club) |
| TRX en émission sans modulation 2 min (20 s en DATA / RTTY / PSK), ou en continu 5 min (PTT ou micro bloqué au club…) | Retour en réception par la page Station, même sans liaison avec le VPS |
| Fréquence d'émission hors des plages ou de la licence | PTT refusé, ou coupé si on sort de bande (fréquence réellement émise : VFO B en SPLIT, XIT compris) |
| Puissance au-delà de la licence | PTT refusé ou coupé, puissance ramenée à la limite |
| ROS au-delà de 2,5:1 pendant 0,7 s | Coupure ; PTT refusé sur ±25 kHz jusqu'à un TUNE réussi |
| TRX en émission sans demande (ex. après un réglage) | Retour en réception immédiat |
| VOX | Peut être coupé à distance, jamais activé ; PTT refusé tant qu'il est actif |
| Clé CW à distance : les données de l'opérateur n'arrivent plus | Clé relâchée par la page Station après 0,3 s ; émission terminée après 3 à 4 s |
| Clé CW à distance enfoncée plus de 5 s (clé bloquée, adaptateur en panne) | Clé relâchée, émission coupée |
| Clé CW à distance : manipulation sans pause plus de `maxTxSeconds` | Coupure ; reprise possible après une pause |

Conseil : régler aussi le **temporisateur d'émission (TOT)** dans le menu du TRX, dernière sécurité si le PC du club plante.

**Ampli linéaire** : la limite de puissance porte sur le TRX ; un ampli externe doit être hors circuit quand un ON3 opère.

**FT8 en HOUND (DXpédition FOX / SuperFox)** : choisi dans l'onglet FT8 (« Activité ») par celui qui a la main, pour toute la station ; noté dans le journal (`hound`, `v` : 0 normale, 1 FOX, 2 SuperFox). En HOUND, le serveur n'autorise que Tx1, Tx3 et Tx5, en 2e période ; arrêt sans RR73 du FOX après 11 périodes. Le décodeur SuperFox est dans le moteur WSJT-X fourni (`lib/bin/wsjtxd`, `wsjtxd.exe`) : rien à installer. Pensez à remettre « Normale » après une DXpédition.

---

## 9. Phonie à distance et égaliseurs

### Ce qui se passe à l'émission

Le membre active son micro dans le cadre TX (**SSB CONFIGURATION → Configuration micro**). Pendant l'appui sur PTT, sa voix part du navigateur vers le serveur, puis vers la page Station, qui la joue sur la **sortie son vers le TRX**. Juste avant l'émission, la page Station relit le menu « source de modulation » du mode et le met sur USB :

| TRX | Menu mis sur USB pendant la phonie à distance |
|---|---|
| FTX-1 | MOD SOURCE : EX010113 (SSB), EX010213 (AM), EX010312 (FM) → USB |
| FTDX10 | SSB MOD SOURCE EX010113 → REAR, REAR SELECT EX010114 → USB |
| FTDX101D / MP | SSB MOD SOURCE EX010111 → REAR, REAR SELECT EX010112 → USB |
| FTDX5000 | SSB MIC SELECT EX103 → DATA (prise de l'interface son) |
| IC-7300 | DATA OFF MOD (CI-V 1A 05 00 66) → USB |
| IC-7760 | DATA OFF MOD (CI-V 1A 05 01 29) → USB |

- La valeur d'origine est **remise** 20 s après la dernière émission en phonie, ou dès que l'opérateur rend la main ou coupe son micro : **le micro du club refonctionne**.
- Aucun menu n'est changé pendant une émission. Si le menu ne peut pas être relu, **rien n'est émis** et l'opérateur est prévenu.
- Réglage du niveau : page Station → **Niveau phonie à distance**. Faire un essai sur charge fictive : l'ALC doit à peine bouger en SSB.
- Pour revenir au seul micro du club pour tout le monde : `"remoteVoice": false`.

### Égaliseur du micro (navigateur)

Chaque membre règle l'égaliseur de **son** micro (**MICRO EQ**) : coupe-bas, 3 bandes, coupe-haut, gain, réduction de bruit. Le type de micro est reconnu d'après le nom de l'entrée son. Les réglages sont gardés **par membre et par micro** dans `profiles.json` sur le serveur. Rien à faire pour l'administrateur.

### Égaliseur du TRX (Yaesu : menus PRMTRC)

**Equalizer TRX** règle les menus PRMTRC EQ1 à EQ3 du TRX (PROC coupé et PROC en service) :
FTX-1 EX030402 à 19, FTDX10 EX030302 à 19, FTDX101 EX030303 à 20.

- Chaque membre peut enregistrer **son profil** : il est mis au TRX quand il prend la main.
- Le **réglage du club** est remis quand il rend la main. La première fois qu'un profil est mis au TRX, le réglage en place est relu et gardé comme réglage du club.
- Un **administrateur** peut le redéfinir : Equalizer TRX → régler (ou « Lire le TRX ») → **Enregistrer comme réglage du club**.
- FTDX10 / FTDX101 : l'égaliseur n'agit que si **MIC EQ** est en service (bouton du cadre TX ; la fenêtre prévient s'il est coupé).
- À vérifier à l'écoute : l'égaliseur PRMTRC agit sûrement sur le micro du club ; sur la voix arrivant par l'USB, cela dépend du TRX.

### Phonie et contests (TRX SSB)

- Onglet **SSB** de la ligne des onglets du dashboard, ou bouton **SSB** de la ligne MODES de la face avant : page **/ssb** (TRX SSB) raccrochée à la page qui l'ouvre, comme le TRX CW, avec le PTT et la ligne SSB CONFIGURATION (micro, égaliseurs, entrée / sortie son). Rien à régler sur le serveur.
- Indicatifs probables : le serveur télécharge **MASTER.SCP** (supercheckpartial.com) au démarrage s'il manque, puis chaque semaine, dans `refdata/` (jamais sur GitHub). Sans accès à ce site, seuls les indicatifs du log du contest et les spots sont proposés.
- Score : estimation d'après le règlement de chaque contest (fonctions RULES de `public/js/ssbpage.js`) ; le score officiel reste celui du comité après contrôle des logs.
- Dashboard : le cadre SSB CONFIGURATION (micro, égaliseurs) n'est plus dans le cadre TX ; un bouton bleu « 🎙 Phonie : page TRX SSB » le remplace. Les faces avant n'ont pas ce bouton : le bouton SSB de leur ligne MODES ouvre la page TRX SSB.
- CW par DTR (FTX-1) : la page Station met PC KEYING sur DTR et BK-IN au premier message, attend 0,5 s que le TRX les applique (sinon les premiers signes partaient avant l'émission), puis les garde 90 s après le dernier message ou la dernière manipulation (macros enchaînées sans délai) avant de remettre PC KEYING sur OFF (tout de suite après un arrêt de sécurité). Après la mise à jour, Ctrl+F5 sur la page Station du club.
- Phonie à distance et mémoires vocales : la page Station du club rééchantillonne elle-même la voix (12 kHz → carte son du TRX) d'une trame à l'autre ; laissé au navigateur trame par trame, chaque raccord faisait un clic 50 fois par seconde (voix « robotique » sur l'air). Après la mise à jour, Ctrl+F5 sur la page Station du club.
- Voix naturelles (Piper, beaucoup plus humaines qu'espeak-ng) : `sudo bash /opt/remote-station/deploy/install-voix.sh` télécharge une fois Piper (MIT, GitHub) et 8 voix (huggingface.co, piper-voices ; français : Tom, Pierre et Jessica (upmc), Siwis ; anglais : Kristin, Amy, Jenny, Ryan, Joe ; ~60 à 110 Mo chacune) dans `/opt/remote-station/tts` (gardé par les mises à jour, jamais sur GitHub), fait un essai et redémarre le service ; elles apparaissent en tête de la liste Voix. Une voix de plus : `install-voix.sh en_GB-cori-high` (nom piper-voices) ; en retirer une : `install-voix.sh --retirer fr-gilles-low`.
- Voix **Kokoro** (les plus réalistes, modèle libre hexgrad/Kokoro-82M, Apache 2.0) : `sudo bash /opt/remote-station/deploy/install-kokoro.sh` crée un environnement Python dans `/opt/remote-station/tts/kokoro` (paquet PyPI `kokoro-onnx`, Python 3.10 à 3.13, `python3-venv` installé si besoin), télécharge le modèle (`kokoro-v1.0.onnx` et `voices-v1.0.bin`, GitHub thewh1teagle/kokoro-onnx, ~340 Mo), fait un essai et redémarre le service. Groupe « Voix Kokoro » en tête de la liste Voix (anglais US / GB : Heart, Bella, Nicole, Michael, Fenrir, Puck, Emma, Isabella, George, Fable ; français : Siwis), choisi d'office. Sur le processeur du VPS : quelques secondes par message. Retirer : `sudo rm -rf /opt/remote-station/tts/kokoro`.
- Messages vocaux en anglais ou en français (TRX SSB) : seules les voix naturelles (Kokoro, Piper) sont proposées ; espeak-ng (`sudo apt install espeak-ng`, déjà présent) n'est plus proposé ; voix lancées par le serveur sans shell ; mémoires dans `voicemem/` (textes dans `<INDICATIF>-tts.json`), refaites quand le TX call de l'opérateur change.
- Sans contest, le TRX SSB montre la fiche du carnet (même saisie que Logbooks) ; ses QSO portent le repère « ssbpage » : seule cette page reçoit la réponse (enregistré, doublon).
- Dans le dashboard, chaque onglet de mode ouvre sa page : TRX SSB, TRX CW (/cw), ou TRX DIGI (/digi, page des modes numériques) sur ce mode. Page TRX CW ouverte : le décodage CW est demandé tout seul pour sa fenêtre de réception.
- Liste des contests SSB (`public/js/contests.js`) avec l'échange d'une station belge et les catégories d'inscription ; pour la station du club, UBA DX et ON Contest donnent la section **LGE**. Les contests marqués « * » ont des catégories génériques : à vérifier dans le règlement de l'année, et à corriger dans `contests.js` si besoin.
- Les QSO vont dans le carnet général avec le contest et les échanges ; le bouton CABRILLO écrit l'en-tête avec la catégorie choisie (CATEGORY-OPERATOR, -POWER, -BAND, -ASSISTED, -MODE, -TRANSMITTER, -OVERLAY, -TIME).
- Touches F1 à F8 : mémoires vocales T1 à T8 de l'opérateur (VOICE TX, gardées sur le serveur dans `voicemem/`), mêmes contrôles que le PTT.

---

## 10. MODE AUTO et bande latérale

**MODE AUTO** (`bandPlan`) : quand le VFO entre dans une autre portion de bande (touche de bande, molette, flèches), le TRX prend une fois le mode du **plan de bande IARU Région 1** : CW, DATA-U (portion numérique et fréquences FT8 / FT4 / WSPR / JT65 / JTTY / SSTV), phonie (LSB sous 10 MHz, USB au-dessus, 60 m en USB), FM. Balises et segments mixtes : rien.

- **Le choix manuel l'emporte** : un mode choisi à la main reste tant qu'on reste dans la même portion. Un onglet numérique ou un spot du cluster impose aussi le sien.
- Chaque membre peut couper MODE AUTO (bouton vert à droite des bandes). Pour tout le monde : `"bandPlan": false`.
- Le plan est dans `public/js/bandplan.js` (portions et fréquences des modes numériques) : une limite se change là, puis mise à jour du serveur.

**Bande latérale automatique** (`autoSideband`) : au changement de bande, un VFO en LSB / USB est remis dans la bonne bande latérale. Quand MODE AUTO est en service, c'est le plan de bande qui décide.

Ces deux automatismes n'agissent que si un membre a la main (rien ne change pour quelqu'un qui tourne les boutons au club).

---

## 11. Carnet de trafic et logs en ligne

- **Base SQLite** (depuis 0.41.0) : le carnet est dans `/opt/remote-station/logs/logbook.db`, base SQLite intégrée à Node.js (`node:sqlite`, Node 22.13 ou plus ; le VPS a Node 24). Rien à installer ni à régler : pas de serveur de base de données, pas de mot de passe. MariaDB, présente sur le VPS pour un autre service, n'est pas utilisée.
  - **Première fois** : reprise automatique de `logbook.json` (copie gardée : `logbook.json.avant-sqlite-<date>`), nombre de QSO vérifié ; en cas d'écart, rien n'est changé et le serveur reste sur `logbook.json`.
  - Chaque QSO ajouté, corrigé ou supprimé est écrit seul (≈ 10 ms même avec 100 000 QSO, au lieu de réécrire tout le fichier).
  - `logbook.json` reste une **copie lisible**, refaite au démarrage puis chaque jour : secours si un jour SQLite manquait (Node.js trop ancien, le serveur la relit alors et le signale dans le journal).
  - Consulter la base : `sudo sqlite3 /opt/remote-station/logs/logbook.db "SELECT COUNT(*) FROM qsos;"` (lecture ; ne pas modifier pendant que le service tourne).
  - Tables : `qsos` (une ligne par QSO : colonnes de recherche + `data` = le QSO complet en JSON, `node` = poste qui l'a fait, `version`, `modified`), `changes` (journal ajout / correction / suppression), `serials` (numéros de série de contest réservés par poste), `meta` (version du schéma, reprise). Préparées pour la mise en réseau (plusieurs postes, un log commun) ; `nodeName` dans config.json = nom de ce serveur dans le log commun (défaut : serveur).
  - **Numéros de série** (0.41.1) : message `serial` { op: lease | used | set | reset, contest, txc, sid } → `Logbook.serialOp` (table `serials`, une ligne par numéro : poste `node` = serveur/opérateur/navigateur, `reserved`, `used`, `qso_id` = call:…) ; édition = 96 dernières heures ; `reset` réservé aux administrateurs et à l'opérateur qui a la main. Les pages gardent leur compteur local si le serveur ne répond pas (carnet en JSON).
- Les réglages des services (mots de passe, clés API LoTW, eQSL, Club Log, QRZ.com) dans `logs/logbook-config.json` (droits 600). **Jamais publiés**, et les mots de passe ne sont jamais renvoyés aux navigateurs.
- **Seul l'opérateur connaît ses identifiants** (jetons et clés API Club Log / QRZ.com, mots de passe eQSL et du site LoTW) : Remote Station ne les réaffiche **jamais** (ni à l'opérateur, ni aux administrateurs : la fenêtre n'indique que « enregistré ») et **ne peut pas les récupérer** s'ils sont perdus. À dire à chaque membre : les noter en lieu sûr ; en cas de perte, les refaire chez le service (Club Log : nouveau jeton et suppression de l'ancien ; QRZ.com : clé relisible dans Logbook → Settings ; eQSL et site LoTW : nouveau mot de passe), puis les enregistrer de nouveau. Le certificat LoTW n'est jamais dans Remote Station (TQSL du PC ; sauvegarde .tbk conseillée, sinon nouveau certificat ARRL). Rappel honnête pour l'administrateur du VPS : `logs/logbook-config.json` n'est pas chiffré (protégé par ses droits 600) — ne jamais le copier, l'envoyer ni le publier. Avertissement 🔒 affiché dans chaque cadre jaune et dans ⚙ Configuration (0.42.87).
- Configuration du club : **administrateurs** (onglet Logbooks → Synchronisation ▾ → ⚙ Configuration). Synchronisation : administrateurs pour tous les indicatifs, chaque membre pour le sien (ci-dessous).
- Tous les membres (sauf écouteurs) enregistrent des QSO et peuvent modifier ou supprimer **les leurs** seulement. Les autres peuvent voir le détail d'un QSO, sans jamais le modifier.
- Un QSO sous l'indicatif d'un membre n'est **jamais** envoyé aux carnets du club : il part vers les siens (s'il les a réglés) ou s'exporte en ADIF (« Mes QSO »).
- **LoTW** : le certificat (.p12 / .tq6) et son mot de passe restent sur le PC où **TQSL** est installé, jamais sur le VPS ni sur GitHub. Avec l'**Agent LoTW** (ci-dessous), ce PC signe et envoie lui-même ; sans agent, sur le VPS : « Exporter pour TQSL (.adi) », signer avec TQSL sur le PC, puis « Marquer comme envoyés ».
- **UDP** (Swisslog, Log4OM, N1MM) : les paquets partent du serveur ; le PC qui les reçoit doit être joignable depuis le VPS.
- **Exports par opérateur** (pages RTTY et SSB, menu EXPORTER ▾ des cadres LOG RTTY / LOG SSB) : plusieurs opérateurs se partagent la station ; un administrateur peut exporter en ADIF (et en Cabrillo pour un contest RTTY) les QSO de **tous** les TX call et de **tous** les opérateurs, ou d'un opérateur précis (nom de fichier `…-OP<INDICATIF>-…`), avec des dates du / au. Un membre n'exporte que ses propres QSO : le serveur l'impose, quels que soient les filtres choisis.
- **Corrections** : un QSO du log d'un contest SSB se corrige en cliquant sur son indicatif (détails sous la ligne, Enregistrer / Supprimer) ; mêmes droits que l'onglet Logbooks (un membre ses propres QSO, un administrateur tous). Le QSO corrigé remplace l'ancien dans le carnet ; les envois déjà faits vers les logs en ligne restent notés (à refaire si nécessaire).
- **Page RTTY** : la ligne du QSO (CALL, RST, échanges, LOG ↵) enregistre directement dans le carnet, sans fiche ; nom, QTH et locator manquants sont complétés par QRZ.com si le compte QRZ est configuré (⚙ Configuration). Le cadre LOG RTTY montre les 300 derniers QSO RTTY (hors contest, ou du contest choisi).
- **Page WSPR** (fenêtre séparée) : même bloc des deux VFO que la page RTTY (miroir du dashboard, SPLIT, A ⇄ B, A → B, DUAL RX, STÉRÉO ; le bloc est déplacé en haut de l'onglet affiché), fréquence WSPR + ↺ du VFO A à gauche et du VFO B à droite (VFO B en DATA-U). FTDX101 en DUAL RX : le serveur décode déjà le récepteur SUB (voie droite, `WSPRB`, fréquences rapportées au VFO-B) ; la page affiche alors la 2e cascade, la liste VFO-B · Stations WSPR entendues et la 2e carte de bande. Deux bandes WSPR à la fois : VFO A et VFO B sur deux bandes différentes + DUAL RX ON.
- **Carnet (onglet Logbooks)** : encadré jaune **TX CALL** dans la barre (filtre `txc` de la liste, le même que celui de la colonne TX call) ; Exporter ▾ → **Vue affichée (.adi)** / **(Cabrillo)…** : `log_export` avec `view: true`, `q` et `f` = recherche et filtres de colonne appliqués à tout le carnet (`lgFilter`) ; un membre n'en reçoit que ses QSO (TX call = son indicatif, ou opérateur / auteur = lui) ; fichier `VUE-<TXCALL>-<date>.adi`.
- **Carnet en grand** (dashboard, 2e clic sur LOGBOOKS) : `/log.html` (1900 × 1000, position gardée), raccroché au dashboard par `window.RSLOGHOST` (app.js) ; ses messages `log_*` partent avec `tag: 'big'`, le serveur renvoie ce tag dans `log_list`, `log_values`, `log_export` (et `log_saved` / `log_dupe` / `log_one`), et app.js les route vers la fenêtre seule ; `log_changed`, réglages et synchronisation vont aux deux carnets. Liste jusqu'à 1000 QSO.
- **Statistiques DXCC** (carnet en grand) : message `log_stats` { txc, mode } → pays DXCC (`DXCC.lookupDxcc` : entités WAE `*` de cty.dat ramenées à leur pays) × bande (`SAT` si `prop_mode` = SAT), lettres C / P / D contactées et confirmées (`lotw_qsl_rcvd` ou `qsl_rcvd` = Y) ; colonne Préfixe du carnet aussi en préfixe DXCC (filtre `pfx` du clic sur une case).
- **Diplômes des statistiques** (0.42.31) : `log_stats` accepte `award` (DXCC, WAZ, ITU, WAE, WAC, WAS, WPX, IOTA, GRID ; `AWARDS` / `awardKey` dans server.js, `wpxPrefix` selon les règles CQ WPX) et renvoie `mcols` = SSB (phonie), CW, FT8, FT4, FT2, RTTY, DATA (tous les modes numériques réunis), toujours dans cet ordre. Filtre du carnet `aw` = « DIPLÔME:clé ». Le carnet garde maintenant les champs ADIF `state`, `cnty`, `cqz`, `ituz`, `cont` (fiche, import, QRZ.com : `state` des stations K / KL / KH6).
- **Décodeur RTTY** (`lib/rtty.js`, 0.40.6) : filtres adaptés d'un bit, AFC ±40 Hz (rotation de phase Mark / Space moyennées, seulement avec un signal net), trois décisions (enveloppes, ATC normalisé, ATC W7AY), deux décodeurs de trames (Mark − Space ; somme avec l'ATC) à 5 instants de lecture chacun, fusion par note ; silencieux = réglage + 3 dB (−3 dB pendant 2,5 s après un caractère net). Banc d'essai : environ 2 à 3 dB de mieux en bruit blanc ; ~4× plus de calcul (≈ 0,7 % d'un cœur par décodeur).
- **FT8 en double réception** (0.40.7) : passe profonde aussi pour le récepteur SUB, dans son propre processus `wsjtxd` (`wsjDeepB`), jamais en même temps que celle du MAIN (`deepBusy` partagé : celle qui attend part dès que l'autre est finie, tant que la période est dans la mémoire audio).
- **Version affichée** (0.42.14) : à droite de la date GMT du dashboard (`#appVer`), lue dans `/api/info` au chargement puis dans `hello` (version du serveur).
- **Manuel** (`/aide`, `/help`) : texte justifié (césure automatique, aligné à gauche sur téléphone) et page élargie à 1500 px (`public/css/manual.css`).

### Mise en réseau (log commun, 0.42.0)

Plusieurs serveurs Remote Station (un par TRX) partagent un log et une série de numéros de série, à la manière de N1MM (`lib/net.js`, réglages dans `net.json`, droits 600, jamais publié, sauvegardé par `backup.sh`).

1. **Choisir une clé du réseau** (16 caractères au moins), la même pour tous ; la donner aux stations par un moyen sûr (jamais par le dépôt GitHub ni un forum).
2. **remote.op0p.be** : Logbooks → Synchronisation ▾ → 🌐 Réseau → mode **Maître**, nom (ex. REMOTE), adresse `remote.op0p.be`, maîtres `remote.op0p.be` puis `secours.op0p.be`, la clé → Enregistrer.
3. **secours.op0p.be** (VPS 89.117.57.161 : `install.sh --domaine secours.op0p.be --email … --admin ON6DP`, sans TRX) : même écran, mode **Maître**, nom SECOURS, adresse `secours.op0p.be`, **la même liste de maîtres**, la même clé.
4. **Chaque station** (serveur local, installateur Windows « Serveur Remote Station ») : mode **Poste**, nom (ex. ON4LUC-1), la même liste de maîtres, la clé. Ses QSO d'avant l'activation ne partent pas, sauf la case « depuis le … ».

**Installer secours.op0p.be** (fait le 14/11/2026 sur 89.117.57.161) : enregistrement DNS A `secours` → l'IP du VPS ; copier le paquet ; `sudo tar -xzf …tar.gz -C /opt` puis **`sudo bash /opt/remote-station/deploy/install.sh --domaine secours.op0p.be --email … --admin ON6DP --sauvegarde 03:30`** (le `tar` seul ne crée ni service ni compte : « unknown user remotestation » = `install.sh` pas lancé). Compte administrateur oublié : `cd /opt/remote-station && sudo -u remotestation node adduser.js ON6DP --admin`. Mettre les deux VPS à jour ensemble (même version).

**Tester la reprise** (hors trafic) : `sudo systemctl stop remote-station` sur remote.op0p.be → 30 s plus tard, secours.op0p.be « ACTIF » ; `sudo systemctl start remote-station` → secours rend la main (événement « … la main lui est rendue »), remote.op0p.be « ACTIF ». Ne pas cliquer Enregistrer pendant le test (le compteur repart). Journal : `sudo journalctl -u remote-station | grep Réseau`.

**Partage (0.42.6)** : réglage `share` d'une station (poste) : `club` (défaut, QSO dont le TX call est un indicatif du club — liste annoncée par le maître dans `net_chal`, gardée dans `meta` `net_club`), `contest` (QSO avec `contest_id`), `all`. Les autres QSO restent dans le carnet de la station. Les maîtres partagent tout.

**Versions (0.42.3)** : le maître annonce sa version à la liaison ; le maître de secours, en attente, plus ancien que le maître → `UPD.installVersion(v)` (même mécanisme que 🔔 : `update/request` → `deploy/update.sh` → paquet GitHub vérifié SHA-256 → `install.sh`), une fois par version ; `"autoUpdate": false` dans config.json pour couper. Jamais vers une version plus ancienne. Stations : avertissement seulement (écran Réseau du maître en orange, message aux administrateurs de la station). Le secours doit être en 0.42.3 au moins pour s'aligner (une dernière mise à jour à la main).

**Contest** : voir le manuel, section 14.6 (même TX call et même contest partout, série remise à 1 une seule fois, envoi automatique LoTW / Club Log / QRZ coupé dans ⚙ Configuration de chaque serveur, Cabrillo depuis le maître).

Fonctionnement : liaisons WebSocket sur `/ws` (HTTPS 443, nginx inchangé), toujours du poste vers le maître ; authentification HMAC-SHA256 dans les deux sens (la clé ne circule jamais). Chaque serveur garde le log complet (base SQLite) ; à chaque liaison, chacun envoie à l'autre ses changements depuis le dernier reçu (journal `changes`, curseurs `recv:<nom>` dans `meta`) ; la version la plus récente d'un QSO l'emporte (`edited` / `created`), les suppressions laissent une trace (`tombs`). Numéros de série : donnés par le **maître actif** ; ses lignes `serials` sont recopiées partout (colonne `mod`). Maître de priorité 1 : actif quand le secours lui a rendu ses données (ou 40 s après son démarrage) ; secours : actif si aucun maître plus prioritaire ne répond depuis 30 s, rend la main à son retour (`net_moved` : ses postes se rebranchent). Poste sans maître : numéros **provisoires** (série locale, message orange). Journal du service : lignes « Réseau : … ».

### FT8 / FT4 / FT2 : enchaînement des QSO et émission (0.42.20)

- **Après un QSO** (liste de la barre FT) : `cq` (défaut) = réponse au plus fort qui répond au CQ, puis à la fin du QSO au suivant qui appelait (décodé dans les 2 dernières périodes, file `seq.waiting`), sinon CQ relancé (`seq.cqRun`, `seq.autoCq`) ; `first` = réponse au 1er puis arrêt ; `stop` = rien d'automatique. Stations déjà contactées (même bande, même mode, TX call en service, ou déjà faites dans la série) jamais reprises toutes seules (`isDupeNow`). Le chien de garde (`ftxWatchdogMinutes`) arrête un CQ sans réponse.
- **🎨 Alertes des listes FT** (0.42.26) : le message `worked` porte aussi `ent` — pays DXCC `D<pfx>`, zones CQ `Z<n>` (ADIF `cqz`, sinon cty.dat avec les zones propres aux préfixes), locators `G<XX99>` → [« bande|mode »] sous le TX call ; les décodages portent `cqz`. Coloration côté navigateur (réglages par navigateur). Le message `worked` est aussi renvoyé à l'ouverture de la fenêtre séparée (avant, les stations n'y étaient barrées qu'après un changement du carnet).
- **Signal reçu en dBm** (0.42.26) : `smeterDb(raw)` des modules TRX (Yaesu : table S0…S9+40 ; Icom : 0120 = S9, 0241 = S9+60), dBm = −73 + dB/S9. Indicatif.
- **Tableau DXCC** (0.42.26) : `ft_dxcc` accepte `txc` parmi les indicatifs du carnet du membre (`logCalls`, tous pour un administrateur) et renvoie `calls`.
- **Appel d'une station occupée** (0.42.50) : `seqOnDecodes` — le correspondant appelé (Tx1) qui répond à un autre n'arrête plus l'émission ; `seq.rep` remis à zéro (et abandon « Sans réponse » annulé) tant qu'il est occupé ; avis une fois par autre station.
- **Alerte « pas encore confirmé »** (0.42.48) : le message `worked` porte `conf` (pays DXCC `D<pfx>` → « bande|mode » des QSO confirmés : `lotw_qsl_rcvd` ou `qsl_rcvd` = Y) ; alertes `nc` (jamais confirmé) et `ncb` (pas sur cette bande) dans les listes FT. Les confirmations viennent de « Synchronisation LoTW → Importer les confirmations » et de l'import ADIF.
- **Gros carnet et fluidité** (0.42.54) : avec ~200 000 QSO, le serveur reparcourait tout le carnet plusieurs fois après chaque QSO (liste `worked`, tableau DXCC de la page FT, `save()` complet après chaque envoi automatique LoTW / Club Log / eQSL / QRZ) : plusieurs secondes de blocage, audio de la station empilé, passes du décodeur toutes à +20 s. Corrigé : `workedNow` regroupé par bande puis mode (sans chaîne par QSO, ~0,3 s pour 200 000 QSO) et `DXCC.peek` (sans copie) ; message `worked` au format `bm` (« bande|mode » → indicatifs séparés par des espaces, 2,5 fois plus court), mis en forme une seule fois et envoyé au plus une fois par 1,5 s ; `ft_dxcc` et la liste des TX call gardés en mémoire par `book.rev` ; `Logbook.flush()` (QSO signalés seulement) à la place de `save()` dans `logsync.js` et `log_mark` ; `book.rev` ne change plus quand rien n'est écrit ; confirmations LoTW appariées par un index « INDICATIF|bande » (avant : une recherche dans tout le carnet par confirmation).
- **Onglet Synchro → Fluidité** (0.42.54) : blocage de la boucle du serveur (> 0,4 s, contrôle toutes les 250 ms ; > 2 s aussi dans le journal du service : « Serveur bloqué x s ») et trou entre deux trames audio de la station (> 0,4 s), maximum des 2 dernières minutes ; plus durée du calcul `worked` et taille du carnet. Décodeur (`lib/digi-worker.js`) : une rafale de trames en retard (serveur ou liaison bloqués puis rattrapage) ne déplace plus l'horloge de l'audio ; un retard n'est pris en compte que s'il dure 2 s (vrai trou), recalage immédiat si l'audio est en avance. « ⟳ Mettre à l'heure » envoie aussi `reset` au décodeur (horloge, délai 150 ms, historique des DT).
- **Badge MONI** (0.42.75) : TRX avec une commande `moni` à bascule (IC-7300, IC-7760) — badge MONI (orange = en service) dans la rangée du VFO A du dashboard, repris dans les pages TRX DIGI / RTTY / CW ; clic = ON / OFF.
- **Logbook du PC par l'Agent LoTW** (0.42.95, agent version 3) : `log_agent_udp` → `AGENTS.setUdp` (`udp` : 4 destinations au plus { on, port, format }, `udpAll`) gardés dans `logs/lotw-agents.json` ; à chaque QSO enregistré (`log_add`), `AGENTS.forward(q, udpPacket)` envoie `lotw_udp` (paquet en base64) aux agents dont le titulaire est l'opérateur du QSO (sous son indicatif, ou aussi ceux du club si `udpAll`) ; agent déconnecté → file en mémoire (200 au plus, perdue au redémarrage du serveur), transmise à la reconnexion. L'agent envoie seulement vers 127.0.0.1 (port 1-65535). Remplace l'UDP direct quand le serveur est sur le VPS et le PC derrière un CGNAT. Agents v2 → mise à jour automatique en v3.
- **Locator = lieu de station TQSL** (0.42.94, choix du club) : `AGENTS.gridFor(call, lieu)` donne le locator (GRIDSQUARE de `station_data`) du lieu de station TQSL de l'indicatif (lieu inscrit dans les identifiants LoTW, sinon son seul lieu ; mémorisé depuis les agents connectés). `logCtx` → `myGridFor(TX call)` le met dans MY_GRIDSQUARE de chaque nouveau QSO (sinon `stationGrid`) ; `lotwSend` signe avec ce locator et met le carnet à jour après acceptation. Ainsi ON6DP part avec JO20SM, ON5VL / OR0L avec JO20RP, comme déjà sur LoTW. Remarque : la règle LoTW / DXCC veut en principe le lieu de l'émetteur ; c'est un choix du club de garder le locator déjà enregistré pour chaque indicatif.
- **LoTW indisponible** (0.42.93) : `lotwreport.adi` en HTTP 502 / 503 / 504 (surcharge ou maintenance de LoTW, fréquent le soir et pendant les grands contests) → message clair au lieu de « réponse LoTW inattendue » ; la date de dernière lecture ne change pas, la lecture automatique horaire réessaie.
- **Détail des QSO à envoyer** (0.42.92) : `log_pending` renvoie aussi `never` (jamais présentés), `done` (déjà envoyés, avec « Renvoyer aussi »), `why` (échecs groupés par motif, 4 au plus) et `d0` / `d1` (dates extrêmes) ; affichés sous le nombre dans chaque fenêtre de synchronisation.
- **Références DME, DCI, DAI, ARLHS** (0.42.91) : champs `dme_ref`, `dci_ref`, `dai_ref`, `arlhs_ref` (et `my_…`) dans `REF_FIELDS` ; saisie libre (pas de liste : aucun fichier public pour DME / DCI / DAI ; liste ARLHS protégée, réutilisation sur autorisation écrite de l'ARLHS) ; ARLHS « BEL 001 » enregistré « BEL-001 ». ADIF : SIG / SIG_INFO selon `SIG_ORDER` (WWBOTA, LLOTA, DME, DCI, DAI, ARLHS) + `APP_REMOTESTATION_<PROG>` ; l'import ADIF relit SIG / SIG_INFO et les champs APP_. Pour ajouter une liste téléchargeable plus tard : `SOURCES` de `lib/refdata.js` et retirer le drapeau « saisie libre » de `REF_KEYS` (`public/js/logbook.js`).
- **TQSL 8 et lieu de station** (0.42.90) : avec `-a compliant`, TQSL écarte les QSO dont MY_GRIDSQUARE (ou autre champ MY_…) ne correspond pas au lieu de station, puis répond 8 « No QSOs to upload » — avant, compté comme « déjà envoyé » alors que rien n'était parti. `tqslResult` : code 8 + champ MY_… / STATION_CALLSIGN dans la sortie = échec (`mismatch`), QSO laissés « à envoyer », message qui explique de créer dans TQSL un lieu de station au locator de la station du club. Au démarrage, `Sync` remet « à envoyer » les QSO marqués ainsi à tort (journal « LoTW : n QSO écartés par TQSL… »). Le serveur n'efface pas MY_GRIDSQUARE de l'ADIF : signer des QSO de la station du club avec le lieu du domicile fausserait les diplômes.
- **Confirmations LoTW, suivi** (0.42.89) : `lotwreport.adi` peut mettre plusieurs minutes avant la première donnée (premier rapport depuis 1900, gros log) : attente portée à 5 min sans donnée (avant : 2 min, puis « réponse LoTW inattendue »), lignes « LoTW répond après … s » puis « … Mo reçus » toutes les 10 s (`request(..., { onData })`, `Sync.confProg`), ARRÊT interrompt la lecture (`cancel.lotw`, aussi pour le bouton Confirmations seul). Lecture automatique horaire : sans ces lignes.
- **Logbooks du PC en UDP** (0.42.88) : ⚙ Configuration → UDP, un bouton par logbook (`UDP_PRESETS` dans `public/js/logbook.js`) : Swisslog 2237 WSJT-X « Logged ADIF » ; HRD Logbook 2333 ADIF brut (QSO Forwarding) ; Log4OM 2333 ADIF brut (UDP inbound ADIF_MESSAGE ; ou JT_MESSAGE 2237) ; Logger32 2237 WSJT-X ; DXLab 2237 WSJT-X (SpotCollector, qui inscrit dans DXKeeper) ; DXBase 2237 WSJT-X (à vérifier) ; N1MM Logger+ 12060 contactinfo ; ADIF brut. Les paquets partent du serveur (VPS : adresse joignable depuis internet et redirection de port vers le PC).
- **Avertissement « vous seul connaissez vos identifiants »** (0.42.87) : cadre 🔒 (`keepNote`, `.lg-keep`) dans chaque cadre jaune d'indicatif et en tête de ⚙ Configuration ; même avertissement dans le manuel (14.4 et onglet HELP de chaque service).
- **Libellés de synchronisation** (0.42.86) : menu, titre de fenêtre et bouton d'envoi identiques : « Synchronisation LoTW », « Synchronisation eQSL », « Synchronisation ClubLog », « Synchronisation QRZ Logbook », et « Synchronisation Listes » pour les listes de références IOTA, WWFF, POTA… (`SYNC` dans `public/js/logbook.js` ; avant : « Club Log… », « QRZ… », « Télécharger vers … », « Opérations LoTW », bouton « Télécharger »).
- **Agent LoTW 2** (0.42.85) : la sortie de TQSL est lue en UTF-8, sinon en page de codes Windows (cp1252) — avant, les accents du TQSL français arrivaient en « t�l�charger ». `AGENT_VERSION` passe à 2 (`agent/agent-lotw.js` et `lib/lotw-agent.js`) : les agents version 1 se mettent à jour tout seuls à leur prochaine connexion (téléchargement de `/agent/agent-lotw.js`, sortie 75, relance par WinSW / systemd). TQSL code 8 (« No QSOs to upload ») = QSO déjà signés par TQSL sur ce PC (doublons) ou hors des dates du certificat : notés « envoyés ».
- **Lien de l'installateur de l'Agent LoTW** (0.42.83) : « Appairer un PC… » pointe vers le dernier installateur Windows réellement construit (`WIN_INSTALLER` dans `server.js`, 0.42.42), plus vers celui de la version en cours (absent quand l'installateur n'a pas été refait : erreur 404 sur GitHub). L'agent livré par cet installateur se met ensuite à jour tout seul depuis le serveur (`AGENT_VERSION`). Changer `WIN_INSTALLER` à chaque nouvel installateur.
- **Club Log, jeton de la nouvelle API** (0.42.81) : si la « clé API » d'un indicatif (ou de ⚙ Configuration) commence par `cl_`, c'est un jeton (Club Log → Settings → API → Tokens) et `lib/logsync.js` utilise l'API REST https://clublog.org/api/v1 avec `Authorization: Bearer` : un QSO = `POST /qso` (`{"call": TX call, "adif": enregistrement ADIF}`), un lot = `POST /qso/batch` (`{"qsos": [...]}`, 100 au plus, un résultat par QSO : created / updated / duplicate = envoyé, rejected = en échec avec le `message` de Club Log, `qsoid` gardé dans `q.up.clublog.id`), « Effacer le log » = `POST /logs/{call}/uploads` (fichier ADIF, `clear=1`, 202 = en file d'attente), Tester = `GET /me/usage?days=1` pour chaque jeton différent (⚙ Configuration et indicatifs du club). E-mail, mot de passe et clé du helpdesk inutiles. 401 / 403 / 429 / autre 4xx (sauf 422) arrêtent les envois de l'indicatif jusqu'au prochain enregistrement. `credFor` ne prête jamais un jeton à un indicatif personnel (contrairement à l'ancienne clé API du logiciel). Limites Club Log : 500 requêtes générales et 10 000 envois de QSO par jour UTC ; 5 fichiers par 5 min. Le jeton reste dans `logs/logbook-config.json` (600), jamais dans le dépôt.
- **Club Log, refus 403** (0.42.80) : la réponse de Club Log est affichée telle quelle ; « pare-feu » seulement si elle parle de blocage (nginx, firewall, blocked) — avant, toute page HTML était prise pour un blocage du pare-feu (faux diagnostic). Enregistrer les identifiants (OK, « Enregistrer pour cet indicatif ») lève aussi l'attente de 65 min. Rappel (documentation Club Log) : `putlogs.php` et `realtime.php` veulent un **mot de passe d'application**, pas celui du site.
- **RTTY : BARRES aussi en DUAL** (0.42.79) : boutons A1 A2 (A2 = décodeur interne 1) ; en QUAD A1 A2 A3 A4 ; cachés en SINGLE.
- **RTTY : liste SINGLE / DUAL / QUAD sur l'IC-7300** (0.42.78) : elle était déplacée à côté du bouton DUAL RX des VFO, dont la ligne est cachée sur un TRX à un seul récepteur (IC-7300, FTDX10) — elle reste alors sur la ligne de la cascade, après « Vitesse ».
- **Bouton d'écoute renommé** (0.42.77) : « 🔊 Activer BF TRX » / « 🔇 Désactiver BF TRX » (avant : « Écouter le TRX » / « Arrêter l'écoute », confondu avec l'arrêt du TRX), dashboard, face avant, aide.
- **Écoute du TRX** (0.42.76) : retour au fonctionnement d'avant la 0.42.74 — l'écoute ne démarre qu'au clic sur « Activer BF TRX » (pas d'écoute automatique à la connexion).
- **RTTY : ■ Arrêter toujours cliquable** (0.42.73) : plus grisé hors émission (cadre rouge), rouge plein pendant l'émission ; sans émission en cours, un clic l'annonce.
- **TRX à un récepteur : badges aussi sous le VFO B** (0.42.72) : IC-7300 et FTDX10 (`SUB_BADGES` faux) — la rangée ATT / P.AMP / NB / NR / NOTCH / AGC du VFO A est recopiée sous le VFO B ; un clic y règle le même (unique) récepteur.
- **RTTY : ■ Arrêter visible** (0.42.71) : le bouton de la 0.42.68 était dans `.rt-macact`, caché dans la page RTTY (`.ctab-pane.rt .rt-macact`) ; il est maintenant à droite de la rangée de macros affichée (habituelles ou du contest).
- **RTTY QUAD, souris** (0.42.70) : `rtTarget` — clic gauche A1 (ou BARRES), clic droit A2 (décodeur interne 2), Ctrl + clic gauche A3 (interne 1), Ctrl + clic droit A4 ; en DUAL, clic droit = A2 (interne 1) comme avant.
- **QSY à l'arrivée sur la page RTTY** (0.42.69) : `enterRtQsyCheck` (indicateur `rs.dg.enterqsyrt`, posé par l'onglet RTTY, `openModePage`, `goTab` et `digiOpen` de la face avant) → `RTTY_DIAL` de la bande si le TRX est à plus de 10 kHz ou sur une fréquence FT8 / FT4 / JT65 ; `goTab('ftx')` pose aussi l'indicateur FT (boutons MODES de la face avant).
- **RTTY : bouton ■ Arrêter** (0.42.68) sur la ligne des macros (`#rtStop`, message `ftx_stop`, comme Échap), rouge pendant l'émission.
- **Face avant : RF POWER affiché tout de suite** (0.42.67) : `power()` de face.js garde la valeur envoyée (`pend.power`, 1,5 s) comme les autres réglages — avant, l'affichage attendait la relecture sur le TRX (~1 s) et les crans rapprochés repartaient de l'ancienne valeur. Infobulle FUNCTION de l'IC-7300 à jour.
- **Fin d'émission RTTY / JTTY / SSTV** (0.42.66) : la page Station relâche le PTT `outputLatency` + 0,2 s après la fin du signal dans l'horloge audio (avant : la fin du message, encore dans la carte son, était coupée) ; RTTY : 16 bits de mark (~0,35 s) après le dernier caractère au lieu de 8. Page Station à recharger.
- **RTTY QUAD : noms dans l'ordre des fenêtres** (0.42.65) : affichage seulement — décodeurs internes 0, 2 | 1, 3 nommés A1, A2 | A3, A4 (Ctrl + clic gauche = A2, clic droit = A3) ; en DUAL, le décodeur de droite reste A2.
- **Club Log : vérification et blocage** (0.42.64) : « Tester » (⚙ Configuration → Club Log) demande aussi au serveur la page https://clublog.org/check.php (refus et blocages récents **de l'adresse IP du serveur**, à joindre à une demande au helpdesk Club Log) et en affiche le résumé. Après un 403 du pare-feu, plus aucun envoi Club Log (automatique ou à la main) pendant 65 min, même après un redémarrage (`clublog.fwUntil` dans `logs/logbook-config.json`). Adresses utilisées (documentation Club Log) : `realtime.php` (un QSO) et `putlogs.php` (lot).
- **LoTW, un compte par indicatif** (0.42.63) : la date de dernière lecture des confirmations est gardée pour chaque indicatif (`lotw.accounts[CALL].lastConfirm`, aussi pour ON5VL / OR0L) — avant, les indicatifs du club partageaient une seule date. Une entrée `accounts[CALL]` qui ne contient que cette date ne compte pas comme « identifiants propres ».
- **Comptes propres aux indicatifs du club** (0.42.62) : ⚙ Configuration = réglages communs à ON5VL / OR0L ; dans la fenêtre d'un service (cadre jaune), un administrateur donne à un indicatif du club ses propres identifiants **et son propre envoi automatique** (`accounts[CALL].auto` booléen : remplace `logCfg[service].auto` pour cet indicatif seulement ; `autoFor`, `acctPublic.autoOwn`).
- **Annonce verte gardée** (0.42.61) : `say` (dashboard) et l'annonce de la fenêtre TRX DIGI : pendant 5 s après une annonce `ok` (« ✓ QSO sauvegardé… »), un avis qui suit (spot envoyé, réponse automatique, CQ relancé) s'ajoute derrière au lieu de l'effacer.
- **Barre du haut de la page FT** (0.42.60) : « BF reçue · décodage OK (moteur WSJT-X) · délai … » n'est plus affiché (il passait sous la ligne « Émission FT » et ses réglages) ; seuls les problèmes s'y affichent (station hors ligne, pas de BF, mode du TRX) ; l'état du décodage est dans l'onglet SYNCHRO.
- **Annonce « ✓ QSO sauvegardé dans le logbook »** (0.42.59) : `digi.js` garde les indicatifs envoyés au carnet depuis la page FT (`ftLogPend`) ; la réponse `log_saved` les annonce même si `dx` est déjà le correspondant suivant (séquence automatique) ; l'ancien message « Log automatique : … enregistré » (avant la réponse du serveur) est retiré.
- **Réponse double avec indicatif composé** (0.42.58) : dans le message 0.1, un indicatif non standard (F5OYA/P, HA/ES3H) est codé par son empreinte 22 bits (`NTOKENS + n22`, comme `pack28` de ft8_lib) ; vérifié avec le décodeur WSJT-X (« <HA/ES3H> » lu en clair avec mycall = HA/ES3H). Page Station : capacité `ftxdx2` (sinon réponse double limitée aux indicatifs standard).
- **Double-clic sur un indicatif à préfixe** (0.42.57) : `CALL_RE` de `digi.js` accepte HA/ES3H, EA8/ON4ABC (avant : « Pas d'indicatif à reprendre ») ; « <ON5VL> HA/ES3H » (appel sans locator) → Tx2 (report).
- **Séquence FT8** (0.42.56) : `ftx_cfg` ne remet plus la période à `null` (la page renvoie ses réglages à chaque clic : la période « auto » faisait partir CQ / report au plus tôt, dans la période du correspondant) — seules 0 / 1 (liste Période) sont prises. Réponse double aussi à la place du 73 (ntx 5, RR73 du correspondant reçu). La station du `dualTake` n'est plus retirée de la file comme « n'appelle plus » (elle attend notre report). Appel d'un indicatif composé sans locator (« <ON5VL> HA/ES3H », type 4) : pris comme un appel (file, répondre au 1er), réponse « HA/ES3H ON5VL -15 » (codée « <HA/ES3H> ON5VL -15 »).
- **Passes FT8 et attente avant émission** (0.42.55) : la passe profonde (`stage=50 mtd=1`, plusieurs cœurs) attend que les passes anticipée et normale (MAIN et SUB) soient finies — lancée en même temps, elle faisait passer la passe normale de ~0,5 s à 2 s sur 20 m chargé. `ftxHoldUntil` : pas d'attente si `seq.heardSlot` (réponse du correspondant déjà décodée, passe anticipée) ; sinon attente = plus tardive des 6 dernières passes normales + 0,3 s, 1 s au plus (`digi.normalLate`, ms après la fin de la période) ; médiane au-delà de 1 s : aucune attente (la réponse tardive remplace le message pendant l'émission, `seqChanged`, dans les `FTX_LATE` premières ms).
- **Lecture automatique des confirmations LoTW** (0.42.54) : `lotwAutoConfirm()` 3 min après le démarrage puis toutes les heures (seulement les confirmations depuis la dernière lecture : requête légère), pour les indicatifs du club et les comptes personnels dont `login` et `webPassword` LoTW sont réglés (pas pour un indicatif bloqué après un refus d'accès) ; travail `auto` (dernière ligne sous le carnet, pas de fenêtre), journal `lotw_confirm_auto` quand il y a du nouveau. Coupée par `"autoConfirm": false` dans la section `lotw` de `logs/logbook-config.json`.
- **Réponse double FT8** (0.42.54, case « 2 à la fois ») : `seqDualPick` choisit, au moment du RR73 (ntx 4, appel CQ), la station de la file qui a appelé avec son locator sur la même période (indicatif standard, pas déjà contactée) ; `seqText` envoie alors « A RR73; B <TXCALL> -NN » (message DXpédition i3=0 n3=1 : 28 + 28 + 10 bits d'empreinte + report pair 5 bits). Après l'émission, `dualTake` : B devient le correspondant en Tx2 déjà envoyé une fois (s'il ne répond pas, son report repart en message normal). Codé dans `public/js/ftxenc.js` (ft8_lib ne sait que le décoder : empaquetage, CRC-14, LDPC, Costas / Gray et GFSK en JavaScript, vérifiés contre ft8_lib et le décodeur WSJT-X) ; la page Station annonce `ftxdx` (rechargée après la mise à jour), sinon pas de réponse double.
- **Départ FT plus rapide** (0.42.46) : `FTX_PREP` = 450 ms (700 avant) entre la demande et le départ du signal ; si la page Station n'a pas encore rendu le signal codé à l'heure, `ftxKey` l'attend jusqu'à 0,8 s (départ décalé d'autant) au lieu d'annuler.
- **Import ADIF** (0.42.44) : `lib/adifimport.js` (lecture ADIF, `ImportJob`), message `log_import` {op: start | data | end | cancel} — lots < 50 Ko envoyés par le navigateur (4 en route), QSO ajoutés par paquets de 5000 (`Logbook.addMany` : fusion triée, une transaction SQLite), doublons à 30 min, `up` noté envoyé pour les 4 services (rien ne repart, pas de rattrapage LoTW), 150 Mo au plus. Mémoire : ~1 Ko par QSO (200 000 QSO ≈ 200 Mo). Avec la mise en réseau, les QSO des indicatifs du club partent aussi vers le secours (par lots). Les recherches DXCC sont gardées en mémoire (statistiques rapides sur un gros carnet).
- **Attente de la passe normale** (0.42.43) : `ftxHoldUntil` / `ftxHoldCheck` (server.js) — une émission de la séquence (Tx1–Tx5, ou CQ avec « répondre au 1er ») attend la passe normale de la période précédente (`digi.normal`), au plus jusqu'à début de période + 0,5 s + min(FTX_LATE − 0,5 s, 1,5 s) ; puis départ (en retard si besoin). Évite l'ancien message émis puis remplacé.
- **File d'attente FT** (0.42.41) : `seq.waiting` exposée dans `state.seq.queue` (ordre : en tête `top`, ajoutées à la main `manual` / `call1` → Tx1, puis la plus forte) ; message `ftx_queue` {op: add | del | top | clear} (celui qui a la main, émission auto en cours). « Toujours CQ » = `cqAlways` (`ftx_tx` / `ftx_cfg`) : `cqRun` dès le départ, donc CQ relancé (ou suivant de la file) après un QSO commencé en Tx1.
- **Sans réponse** (0.42.25, liste de la barre FT, 3 / 4 par défaut / 5 / 6 / 8 / jamais, envoyée en `maxRep` dans `ftx_tx` / `ftx_cfg`) : après `maxRep` envois du même message Tx1–Tx3 (`seq.rep`, `seq.repText`) et les décodages de la période suivante sans réponse (filet : minuterie à la fin de cette période + 4 s), `seqGiveUp` : en appel CQ avec `autoCq`, `seqNextCaller` (station suivante de `seq.waiting`, sinon CQ) ; sinon arrêt de l'émission auto. Pas de fiche du carnet pour un QSO abandonné.
- **Listes FT** (0.42.38) : clic gauche sur une ligne = RX à sa fréquence, clic droit = TX, double-clic ou clic sur l'indicatif = répondre ; ce rappel a quitté l'en-tête « Fréquence RX » (il est dans l'aide). En-têtes des colonnes à la même hauteur (un récepteur).
- **🌍 DXCC de la page FT** (0.42.24) : message `ft_dxcc` {txc, mode FT|FT8|FT4|FT2} → pays DXCC (`DXCC.lookupDxcc`, WAE ramenées au pays) × bande 160–6 m, 1 = contacté, 2 = confirmé (`lotw_qsl_rcvd` ou `qsl_rcvd` = Y, comme les statistiques du carnet). Les décodages portent `dxp` (entité DXCC) quand il diffère de `pfx` (WAE) : pays entendus NEW / NEW BANDE en tête. Mono VFO : 3ᵉ colonne ; double réception : panneau par-dessus la colonne VFO-B. Rien à régler.
- **TX call de la fiche DÉTAILS QSO** (0.42.24) : la fiche des pages TRX connaît tous les indicatifs de la station (`clubCalls`) et ajoute le TX call en service s'il manque ; avant, elle pouvait rester sur le premier (ON5VL) alors qu'on émettait sous OR0L.
- **Fréquence TX changée pendant l'émission** : `ftx_cfg` → `ftxretune` vers la page Station, qui refait le signal à la nouvelle fréquence et le reprend au même instant (`txRetune`) ; message prévu pas encore parti : refait à la nouvelle fréquence. Fréquence RX : l'aide AP du décodeur la suit tout de suite (`seq.rxf`).
- **Émission FT : …** sur la page FT : état de la sortie son de la page Station (`tx_out` → `state.audio.out` : carte, niveau, limite ALC).
- **ALC** : limiteur `digiAlcMax` = 10 % par défaut, réglable par les administrateurs sur la ligne « Émission FT » de la page FT (liste ALC max ; message `tx_set`, gardé dans `logs/station-tx.json`, qui l'emporte sur config.json) avec le niveau d'émission (− / +, appliqué par la page Station) ; IC-7300 / IC-7760 : `ALC_FULL` = 120 (CI-V 15 13 : 0 à 120 = zone ALC), aussi pour l'affichage.

### Carnet : suppression de plusieurs QSO (0.42.20)

Ctrl+clic / Maj+clic sur les lignes, barre « N QSO sélectionnés » → `log_del_many` (5000 au plus) ; chaque QSO selon `logCanEdit` (auteur avec la main ou administrateur), refus comptés et signalés ; journal `log_del_many`.

### WSPR : qui m'a entendu ? (0.42.19)

Onglet WSPR → **📡 Qui m'a entendu ?** : le serveur interroge la base publique **wspr.live** (copie des spots de WSPRnet, `https://db1.wspr.live/?query=…`, lecture seule, sans compte) : `SELECT … FROM wspr.rx WHERE time > now() - INTERVAL n HOUR AND tx_sign = 'INDICATIF'` (ou `rx_sign` pour « ce que cet indicatif a entendu »), bande en option, 2000 lignes au plus. Indicatif limité à `[A-Z0-9/]`, période et bande prises dans une liste (pas de texte libre dans la requête). Cache de 90 s par question, 10 requêtes par minute au plus pour tout le serveur (wspr.live en accepte 20 ; usage non commercial). Le VPS doit pouvoir joindre db1.wspr.live en HTTPS (port 443 sortant). Message `wspr_heard`.

### Mémoires vocales à sa propre voix (0.42.18)

Page TRX SSB → **🎙 Ma voix** : chaque membre enregistre T1 … T8 au micro de son PC, pour tous les TRX (avant : seulement l'écran VOICE de la face avant IC-7300). Mêmes messages serveur que la face avant (`vm_put` en morceaux µ-law 12 kHz, `vm_name`, `vm_del`, `vm_get` avec `tag: 'ssb'` pour que la face avant ne rejoue pas l'écoute). Fichiers `voicemem/<INDICATIF>-T<n>.ul` (30 s au plus, droits 600, jamais publiés) ; une mémoire enregistrée au micro efface le message de synthèse du même numéro. Émission par le serveur (`vm_play`) avec les sécurités du PTT, quel que soit le TRX.

### Droits sur le carnet (qui modifie ou supprime un QSO)

- Un QSO appartient à l'opérateur qui l'a **enregistré** (champ `by` du QSO), quel que soit le TX call. Contrôle côté serveur (`logCanEdit` : administrateur, ou `q.by` = le membre **et** il a la main), pour `log_edit`, `log_del` et `log_merge` ; refus : « QSO enregistré par … : seul son auteur (avec la main) ou un administrateur peut le modifier ou le supprimer ». Écouteurs : consultation seulement.
- Membre ON1ZZZ : ses QSO sous ON1ZZZ, ON5VL ou OR0L → oui avec la main ; QSO de ON4LUC sous ON5VL ou d'un autre membre → non. Administrateurs (⚙ → Membres) : tous les QSO.
- Journal : `log_edit`, `log_del` avec l'indicatif de l'auteur de la correction. En réseau, le contrôle est fait par le serveur où l'on corrige ; la correction ou la suppression (`tombs`) passe ensuite à tous les serveurs.

### Synchronisation et réseau : en bref

| Serveur | Mode réseau | Synchronisations LoTW / Club Log / eQSL / QRZ |
|---|---|---|
| remote.op0p.be | Maître (priorité 1) | **ici** (tous les QSO partagés) ; Agent LoTW relié ici |
| secours.op0p.be | Maître (priorité 2) | non (prend le relais du log seulement) |
| station d'un membre | Poste | ses QSO personnels (non partagés), avec ses propres identifiants / son agent |

- Première mise en service d'un service : identifiants (et Agent LoTW) → « Enregistrer pour cet indicatif » → un envoi à la main → seulement ensuite l'envoi automatique.
- L'envoi automatique d'un nouveau QSO part du serveur où il a été enregistré ; les QSO reçus d'une autre station partent par la synchronisation (bouton) depuis remote.op0p.be, ou au retour de l'Agent LoTW (QSO des 30 derniers jours jamais présentés à LoTW).

### Logs en ligne par indicatif

- Chaque indicatif a **ses propres identifiants** (eQSL, Club Log, clé API QRZ, lieu de station TQSL et identifiant du site LoTW), gardés dans `logs/logbook-config.json` (droits 600), jamais renvoyés aux navigateurs.
- Les identifiants de ⚙ Configuration ne servent qu'aux indicatifs du club (ON5VL, OR0L). Un QSO n'est **jamais** envoyé avec les identifiants d'un autre indicatif.
- **Membres** (indicatif personnel avec émission permise) : Synchronisation ▾ → service → ils ne voient et ne règlent que **leur** indicatif, envoient **leurs** QSO, peuvent cocher l'envoi automatique de chaque nouveau QSO, exporter pour TQSL et marquer comme envoyés **leurs** QSO, lire **leurs** confirmations LoTW. Jamais la configuration du club, jamais « effacer le log Club Log ».
- **Administrateurs** : tous les indicatifs, comme avant, plus l'envoi automatique d'un indicatif personnel (case dans le cadre de ses identifiants).
- Un refus d'accès (mauvais mot de passe) bloque **seulement cet indicatif** jusqu'à ce que ses identifiants soient réenregistrés.
- **Club Log 403** : e-mail du compte, mot de passe d'application, indicatif absent du compte ou clé API refusés. Après plusieurs refus, Club Log bloque l'IP du VPS environ une heure (page « 403 Forbidden nginx ») ; test depuis le VPS : `curl -s -o /dev/null -w '%{http_code}\n' https://clublog.org/` (403 = IP encore bloquée, 200 = débloquée). Le serveur n'essaie plus Club Log pendant 65 minutes après une page « nginx » (`Sync.clublogFw`, remis à zéro au redémarrage du service). Clé API (une pour le logiciel, tous indicatifs) : demande par e-mail à support@clublog.org.
- Confirmations LoTW : lues pour l'indicatif choisi et reportées seulement sur ses QSO (date de dernière lecture gardée par indicatif).
- Pas d'envoi UDP vers le logbook du PC du club pour un QSO fait sous un indicatif personnel.
- **Vitesse des envois** : eQSL (`ImportADIF.cfm`) et QRZ.com (`ACTION=INSERT`) reçoivent **un QSO par requête** ; la **temporisation** (pause entre deux QSO, 5 s par défaut, réglage `delay` de chaque service dans `logbook-config.json`, ⚙ Configuration ou case de la fenêtre pour un seul envoi) fixe la vitesse. Conseillé : **1 s** pour eQSL et QRZ (ni l'un ni l'autre ne publie de limite ; 0 est possible mais déconseillé). Club Log et LoTW partent en un seul fichier (pas de temporisation). Gros lot : Exporter ▾ → ADIF et envoi du fichier sur le site du service ; un nouvel envoi de ces QSO par Remote Station est sans risque (réponse « doublon » comptée comme envoyée).
- **⚙ Configuration** (0.42.16) : onglets = indicatifs du club ; la clé API Club Log de ⚙ Configuration sert aussi aux indicatifs personnels (`credFor` ne la vide pas ; un membre peut en mettre une propre) ; pas de temporisation pour Club Log et LoTW (un fichier) ; onglet LoTW sans TQSL sur le serveur (`tqslHere` faux) : champs Programme / Dossier / mot de passe du certificat masqués, « Tester » vérifie l'Agent LoTW connecté pour `digiCall` et son lieu de station.
- **Club Log, clé API** : elle identifie le logiciel Remote Station (pas un membre) ; une seule pour tout le club, demandée par e-mail à support@clublog.org (le développeur, ON6DP) ; chaque membre met ensuite l'e-mail de son compte et un mot de passe d'application (Club Log → Settings → App Passwords). Ce n'est **pas** le jeton de la station.

### Agent LoTW (0.42.10)

**Mise en route pas à pas (administrateur, indicatifs du club)** :

1. Carnet → Synchronisation ▾ → **Synchronisation LoTW…** → indicatif (OR0L) → cadre jaune : lieu de station TQSL (nom exact, par ex. `OR0L_HomeQTH`), identifiant et mot de passe du **site** lotw.arrl.org (confirmations). Mot de passe du certificat : vide (avec l'agent il reste sur le PC). « Enregistrer pour cet indicatif ».
2. « Appairer un PC… » → code (15 min). Sur le PC qui a TQSL et le certificat : installateur Windows (lien sous le code, dernier construit : `WIN_INSTALLER`), cocher **uniquement** « Agent LoTW (TQSL de ce PC) », adresse `https://remote.op0p.be`, code. **Ne pas cocher « Serveur (service Windows) »** : sinon un second serveur s'installe sur ce PC (question « premier compte administrateur » et jeton de station local affichés — répondre Non, ignorer ce jeton, puis `"C:\Program Files\RemoteStation\service\RemoteStation.exe" stop` et `uninstall` dans une invite administrateur ; la désinstallation complète retirerait aussi l'agent).
3. Le cadre Agent LoTW affiche « ● PC — connecté » et les lieux de station trouvés. « Synchronisation LoTW » : Exporter → Signer → Téléchargement → confirmations.
4. Tout vert : cocher l'envoi automatique et réenregistrer ; recommencer pour ON5VL (même agent si le certificat est dans le même TQSL).

Codes de TQSL : 0 = envoyé ; **8** = « No QSOs to upload » (QSO déjà signés par TQSL sur ce PC — Swisslog, WSJT-X… — ou hors des dates du certificat) : notés envoyés, vérifier au besoin sur lotw.arrl.org ; 9 = en partie déjà envoyés. Confirmations en rouge avec « identifiant / mot de passe du site LoTW non renseignés » : seule la lecture des confirmations manque.


Le VPS n'a ni TQSL ni certificat. L'Agent LoTW (`agent/agent-lotw.js`, Node.js 22 ou plus, sans dépendance) tourne sur le PC d'un membre où TQSL et son certificat sont installés, et ouvre lui-même une liaison WebSocket vers `wss://remote.op0p.be/ws` (rien à ouvrir dans le routeur, fonctionne derrière un CGNAT).

- **Appairage** : carnet → Synchronisation LoTW → cadre Agent LoTW → « Appairer un PC… » : code de 8 caractères (`log_agent_code`, 15 minutes, une seule fois). L'agent le présente (`lotw_agent_pair`) et reçoit un jeton propre à ce PC ; le serveur ne garde que son empreinte SHA-256 dans **`logs/lotw-agents.json`** (droits 600, jamais publié, sauvegardé avec `logs/`). Le mot de passe du membre n'est jamais demandé à l'agent. 6 codes faux depuis une adresse → 10 minutes de blocage.
- **Droits** : l'agent d'un membre ne signe que son indicatif personnel (s'il émet sous son indicatif) ; celui d'un administrateur aussi les indicatifs du club. L'agent ne reçoit que des lots ADIF à signer (`lotw_sign`, 100 QSO au plus) et renvoie le code de sortie de TQSL (`lotw_signed`) ; il ne lit rien d'autre. Compte supprimé ou hors service → agent refusé. « Retirer » dans le carnet coupe le PC tout de suite.
- **Signature** : `tqsl -x -u -d -a compliant -l <lieu> fichier.adi` sur le PC, avec `TQSLDIR` = dossier des données TQSL trouvé (Windows : `%APPDATA%\TrustedQSL`, cherché aussi dans les profils de `C:\Users` car le service tourne sous le compte Système ; Linux : `~/.tqsl`, avec `xvfb-run` sans écran). Lieu de station : celui des identifiants LoTW de l'indicatif s'il existe sur le PC, sinon le seul lieu de cet indicatif (les lieux de `station_data` sont annoncés au serveur et affichés dans le carnet). Mot de passe de certificat éventuel : `agent-lotw.js --mdp-certificat`, gardé dans `agent-lotw.json` sur ce PC seulement.
- **Envoi automatique** coché pour l'indicatif : chaque nouveau QSO part par l'agent ; agent absent → rien n'est marqué, et à sa connexion les QSO des 30 derniers jours jamais présentés à LoTW partent. Agent déconnecté pendant une signature ou lieu de station à choisir → QSO laissés « à envoyer » (pas d'échec).
- **Installation** : Windows : installateur, case « Agent LoTW (TQSL de ce PC) » (service WinSW `RemoteStationAgentLoTW`, dossier `Program Files\RemoteStation\agent-lotw` réservé au Système et aux administrateurs, raccourcis « Appairer l'Agent LoTW » et « État de l'Agent LoTW » ; silencieux : `/AGENT=1 /URL=https://remote.op0p.be /AGENTCODE=ABCD-EFGH /KIT=0`). Linux : `curl -fsSL https://remote.op0p.be/agent/install-agent-lotw.sh | sudo bash -s -- --serveur https://remote.op0p.be --code ABCD-EFGH` ou `sudo bash /opt/remote-station/deploy/install.sh --agent-lotw --serveur … --code …` (service systemd `remote-station-agent-lotw` sous le compte de l'utilisateur, commande `remote-station-agent-lotw --etat | --appairer CODE | --oublier | --mdp-certificat` ; `--desinstaller` pour le retirer). Le serveur publie `/agent/agent-lotw.js` et `/agent/install-agent-lotw.sh` (sans secret).
- **Mise à jour** : le serveur annonce la version de l'agent livrée avec lui ; un agent plus ancien se recharge depuis `/agent/agent-lotw.js` et redémarre (service).
- **Réseau** : l'agent se relie au serveur indiqué à l'appairage (remote.op0p.be) ; secours.op0p.be ne connaît pas ses appairages (les QSO attendent le retour du maître).
- Journal : événements `lotw_agent_code`, `lotw_agent_paired`, `lotw_agent_on` / `_off`, `lotw_agent_refused`, `lotw_agent_del`. Côté PC : Windows « État de l'Agent LoTW » (fichier `RemoteStationAgentLoTW.out.log`), Linux `journalctl -u remote-station-agent-lotw -f`.

### Listes de références IOTA, WWFF, POTA, BOTA, LLOTA, SOTA

- La fiche du QSO a des cases **IOTA, WWFF, POTA, BOTA, LLOTA, SOTA** (2e ligne, à droite de Remarque) pour les références du correspondant, et une ligne « Ma réf. (activation) » (bouton à droite de QO-100) pour celles de la station. Une liste de choix s'ouvre pendant la frappe.
- Le serveur télécharge les listes mondiales lui-même, sans clé ni compte, dans `/opt/remote-station/refdata/<PROGRAMME>.json` :
  - POTA : `https://pota.app/all_parks_ext.csv`
  - WWFF : `https://wwff.co/wwff-data/wwff_directory.csv`
  - BOTA (WWBOTA) : `https://api.wwbota.org/bunkers/?format=CSV`
  - LLOTA : `https://llota.app/api/public/references`
  - IOTA : `https://www.iota-world.org/…/fulllist.json`
  - SOTA : `https://storage.sota.org.uk/summitslist.csv` (environ 180 000 sommets, quelques dizaines de Mo ; les sommets retirés sont écartés ; locator calculé d'après la latitude / longitude)
- Premier téléchargement 20 s après le démarrage du service (une liste à la fois), puis vérification toutes les 6 h ; une liste est retéléchargée quand elle a plus de 7 jours (BOTA et SOTA : 30 jours). Une liste en erreur garde la version précédente.
- **État et mise à jour à la main** : onglet Logbooks → Synchronisation ▾ → **Synchronisation Listes…** (administrateurs) → « Mettre à jour maintenant ». Les erreurs s'affichent aussi dans `journalctl -u remote-station`.
- Le VPS doit pouvoir joindre ces sites en HTTPS (sortie). `"refData": false` dans `config.json` coupe les téléchargements.
- `refdata/` n'est pas à sauvegarder (il se retélécharge) et n'est jamais publié sur GitHub.
- ADIF : `IOTA`, `POTA_REF`, `WWFF_REF`, `SOTA_REF`, `MY_IOTA`, `MY_POTA_REF`, `MY_WWFF_REF`, `MY_SOTA_REF` ; BOTA en `SIG` = `WWBOTA` / `SIG_INFO` (LLOTA en `SIG` = `LLOTA` s'il n'y a pas de BOTA ; `MY_SIG` / `MY_SIG_INFO` pour la station), plus des champs `APP_REMOTESTATION_BOTA` / `APP_REMOTESTATION_LLOTA` (et `_MY_`) pour garder les deux.

---

## 12. Statistiques d'utilisation

Bouton **📊 STATS** du dashboard (administrateurs), page https://remote.op0p.be/stats :

- par opérateur : temps avec la main, temps connecté, émission, sessions, jours, QSO, bandes et modes ;
- par indicatif (TX call, 0.42.32) : minutes avec la main sous ce TX call (champ `x` des lignes `usage-*.jsonl`, relevé depuis la 0.42.32), émission, QSO du carnet (`station_callsign`) avec leurs opérateurs, bandes et modes ;
- graphiques par bande, par mode, par jour, carte jours × heures (heure belge) ;
- journal des sessions, **export CSV** pour Excel.

Les données viennent du relevé minute par minute `logs/usage-AAAA-MM.jsonl` (et, pour la période antérieure, d'une estimation d'après le journal des prises de main).

---

## 13. Surveiller le serveur

| Quoi | Commande |
|---|---|
| État du service | `sudo systemctl status remote-station --no-pager` |
| Journal en direct | `sudo journalctl -u remote-station -f` |
| Connexions / déconnexions | `sudo journalctl -u remote-station -f \| grep -E "login\|logout"` |
| Liaison de la page Station (coupures, cause, durée) | `sudo journalctl -u remote-station --since "-30 min" \| grep station_` |
| Émissions du mois | `sudo grep tx_start /opt/remote-station/logs/access-$(date +%Y-%m).log \| tail` |
| Phonie à distance, égaliseur, plan de bande | `sudo grep -E "voice\|trx_eq\|band_plan" /opt/remote-station/logs/access-$(date +%Y-%m).log \| tail` |

Le journal des accès (`logs/access-AAAA-MM.log`) contient une ligne JSON par événement : connexions, échecs, prises et libérations de la main, émissions (indicatif, IP, fréquence, mode, durée, raison de la coupure).
Les heures de `journalctl` sont en **UTC** (heure belge − 1 h en hiver, − 2 h en été).

---

## 14. Sauvegarder et restaurer

Les données à protéger sont toutes dans `/opt/remote-station` :

| Fichier / dossier | Contenu |
|---|---|
| `config.json` | Réglages et **jeton de la station** |
| `users.json` | Comptes et mots de passe (chiffrés) |
| `sessions.json` | Navigateurs restés connectés |
| `macros.json` | Macros personnelles des membres |
| `profiles.json` | Réglages de micro et profils d'égaliseur des membres, réglage du club de l'égaliseur du TRX |
| `logs/` | Carnet (`logbook.db`, base SQLite ; copie lisible `logbook.json`), identifiants des carnets en ligne (`logbook-config.json`), journaux d'accès, relevés d'utilisation |
| `sstv/` | Images SSTV reçues |

### Avec le script `backup.sh` (recommandé)

```bash
sudo bash /opt/remote-station/deploy/backup.sh
```
Sauvegarde **les données** (tout le tableau ci-dessus, sauf `refdata/` qui se retélécharge) dans `/home/on6dp/backups/remote-station-AAAA-MM-JJ_HHMM.tar.gz`, droits 600, propriétaire on6dp (à récupérer avec WinSCP). Les 30 plus récentes sont gardées (`--garder N` pour changer), les plus anciennes supprimées.

| Commande (précédée de `sudo bash /opt/remote-station/deploy/backup.sh`) | Effet |
|---|---|
| *(rien)* | Sauvegarde des données maintenant |
| `--complet` | Programme + données (tout le dossier) |
| `--liste` | Sauvegardes présentes et prochaine sauvegarde automatique |
| `--minuterie 03:30` | **Sauvegarde automatique chaque jour** à 03:30 (minuterie systemd ; rattrapée au démarrage si le VPS était éteint) |
| `--sans-minuterie` | Arrête la sauvegarde automatique (les archives restent) |
| `--restaurer remote-station-AAAA-MM-JJ_HHMM.tar.gz` | Restaure (après confirmation) : sauvegarde d'abord l'état actuel (« avant-restauration »), arrête le service, remet les fichiers, refait les droits, relance |
| `--dossier DIR` | Autre dossier que `/home/on6dp/backups` |

Vérifier la minuterie : `systemctl list-timers remote-station-backup` ; essai immédiat : `sudo systemctl start remote-station-backup`.

### À la main (sans le script)

**Sauvegarde complète** (code + données), à garder sur le VPS et sur votre PC (WinSCP), **jamais sur GitHub ni dans un message** :

```bash
sudo mkdir -p /home/on6dp/backups
```
```bash
sudo tar -czf /home/on6dp/backups/remote-station-$(date +%F).tar.gz -C /opt remote-station
```
```bash
sudo chown on6dp: /home/on6dp/backups/*.tar.gz && sudo chmod 600 /home/on6dp/backups/*.tar.gz
```

**Restaurer** (même VPS ou nouveau, une fois nginx et Node.js en place, section 17) :

```bash
sudo systemctl stop remote-station
```
```bash
sudo tar -xzf /home/on6dp/backups/remote-station-AAAA-MM-JJ.tar.gz -C /opt
```
```bash
sudo chown -R remotestation:remotestation /opt/remote-station && sudo systemctl start remote-station
```

---


**Carnet en base SQLite** : `backup.sh` en fait d'abord une copie cohérente (`VACUUM INTO`, sans arrêter le service), mise dans l'archive sous le nom `logs/logbook.db` ; la base vivante et ses fichiers `-wal` / `-shm` ne sont pas archivés tels quels. À la restauration, ces fichiers `-wal` / `-shm` sont retirés ; une archive plus ancienne (carnet `logbook.json` seulement) met la base actuelle de côté (`logbook.db.avant-restauration-…`) et le serveur reprend le `logbook.json` restauré.

## 15. Fichiers secrets

Ces fichiers restent **sur le VPS** (et dans vos sauvegardes privées), jamais dans le dépôt GitHub, dans une archive de version ni dans un message :
`config.json` (jeton), `users.json`, `comptes-*.csv`, `sessions.json`, `macros.json`, `profiles.json`, `logs/logbook.json`, `logs/logbook-config.json`, `logs/station-sessions.json`, `logs/lotw-agents.json`, `logs/*.log`, `logs/usage-*.jsonl`, `sstv/`. Sur le PC d'un membre : `agent-lotw.json` (jeton d'appairage de l'Agent LoTW).
Le certificat LoTW et son mot de passe ne quittent jamais le PC où TQSL est installé.
Les mots de passe SSH, les clés et le jeton ne s'envoient jamais par e-mail ni par chat.

---

## 16. Problèmes fréquents

| Symptôme | Solution |
|---|---|
| L'ancien design s'affiche | Refaire la mise à jour en supprimant d'abord `public` et `lib` (section 3) |
| « permission denied » avec `adduser.js` | `sudo chown -R remotestation:remotestation /opt/remote-station` |
| Page Station : bandeau « Firefox n'a pas le port série » | Ouvrir la page dans **Chrome** ou **Edge** |
| FTDX10 / FTDX101 : voyant TRX vert puis orange toutes les 2 s | Menu du TRX : **CAT RTS sur OFF** |
| « Port ouvert, pas de réponse » | Mauvais port (Enhanced, pas Standard), mauvaise vitesse, ou autre logiciel sur le port |
| Voyant TRX **jaune** sur le dashboard | Station en ligne mais TRX muet (éteint, câble) : la page rouvre le port dès qu'il répond |
| « Station hors ligne » alors que la page Station dit « Connecté » | Coupure réseau silencieuse : la page se reconnecte en 15 s ; sinon « Enregistrer et reconnecter » |
| « Station hors ligne (page Station fermée ou quittée) » | L'onglet de la page Station a servi à autre chose : la garder **seule dans sa fenêtre** |
| Page Station « mise en pause » ou « déchargée par Chrome » | Chrome → Performances → garder `remote.op0p.be` actif ; économiseur d'énergie coupé ; Windows : veille Jamais |
| « Remplacée par une autre page Station » | Une autre page Station est ouverte ailleurs : la fermer, puis « Enregistrer et reconnecter » |
| Plus de son du TRX (alerte orange sur le dashboard) | Carte son USB figée : relancée seule par la page Station après 45 s de silence (assistant installé, une fois / 10 min) ; sinon menu STATION → « Relancer la carte son du TRX » (responsables). Assistant **version 2** (refaire `installer-carte-son.cmd` une fois) : coupe aussi la mise en veille USB de Windows à chaque démarrage (`powercfg` suspension sélective USB, `MSPower_DeviceEnable` des concentrateurs et cartes son USB) |
| Onglet Synchro : « Serveur : NTP » NON SYNCHRONISÉ ou écart > 50 ms | Le VPS est la référence de tous les décodages et de l'instant d'émission. Vérifier `timedatectl` ; pour la milliseconde, installer chrony : `sudo apt install chrony` (remplace systemd-timesyncd), puis `chronyc tracking` (« System time » doit être de l'ordre de quelques ms) |
| Heure de Windows du PC du club décalée (NetTime installé à la main) | Assistant carte son **version 4 et plus** (version 5 conseillée : priorité basse, surveillance une fois par minute) : règle le service Windows Time (be.pool.ntp.org, europe.pool.ntp.org, time.cloudflare.com, interrogés toutes les 1 à 4 min), resynchronise au démarrage, toutes les heures et sur « ⟳ Mettre à l'heure » (onglet Synchro). L'écart du PC du club est de toute façon corrigé pour l'émission ; désinstaller NetTime pour éviter deux réglages concurrents |
| Raies verticales régulières (tous les 25 Hz) sur toute la cascade | Deux captures du son envoyées en même temps par la page Station (relances successives) : corrigé en 0.37.176 ; en attendant, recharger la page Station (Ctrl+F5) et n'en garder qu'un seul onglet ouvert |
| Carte son du TRX disparue de Windows (« Périphérique USB composite » en **Error**, plus d'« USB Audio CODEC » dans le Gestionnaire de périphériques) | Assistant **version 3** : la retire et la fait redétecter seul (surveillance toutes les 20 s, au plus une fois / 5 min ; aussi sur « Relancer la carte son du TRX »). La page Station ne prend jamais une autre carte son à sa place : alerte « Carte son du TRX absente », reprise automatique au retour. À la main (PowerShell administrateur) : `Get-PnpDevice \| Where-Object InstanceId -like 'USB\VID_0D8C*'` puis `pnputil /remove-device "<InstanceId>"` pour chaque ligne et `pnputil /scan-devices`. Si l'erreur revient souvent : câble USB court blindé avec ferrites, autre prise USB du PC (arrière, sans hub) |
| Phonie : « le TRX n'a pas répondu à la lecture du menu… » | Liaison CAT perturbée ou TRX occupé : réessayer ; vérifier le modèle choisi sur la page Station |
| Phonie : pas de modulation | Page Station : sortie son vers le TRX choisie ? « Niveau phonie à distance » assez haut ? Le membre a-t-il activé son micro (point vert) ? |
| Equalizer TRX sans effet | FTDX10 / FTDX101 : bouton **MIC EQ** en service |
| GAIN MICRO grisé quelques secondes | Normal : le TRX n'a pas encore donné sa valeur |
| Un membre n'a pas la main alors qu'il est connecté | La main appartient à un onglet : fermer les autres onglets ou « Prendre la main ici » |

---

## 17. Installation complète d'un nouveau serveur

### En une commande avec `install.sh` (recommandé)

Sur un VPS Debian / Ubuntu neuf, le nom du site (enregistrement DNS A) déjà pointé vers ce serveur. Copier l'archive avec WinSCP, puis :

```bash
sudo tar -xzf /home/on6dp/remote-station-X.Y.Z.tar.gz -C /opt
```
```bash
sudo bash /opt/remote-station/deploy/install.sh --domaine remote.op0p.be --email on6dp@on6dp.be --admin ON6DP --sauvegarde 03:30
```

Le script installe Node.js (22 si celui du système est trop ancien), nginx et certbot ; crée l'utilisateur `remotestation` ; crée `config.json` avec un **jeton neuf, jamais affiché** (la page Station le reprend toute seule) ; crée l'administrateur (mot de passe demandé) ; installe le service systemd, le site nginx et le certificat HTTPS ; installe la sauvegarde quotidienne ; puis vérifie que le serveur répond.

| Option | Rôle |
|---|---|
| `--domaine NOM` | Nom du site (nginx + certificat) |
| `--email ADRESSE` | Adresse pour Let's Encrypt (sinon certbot la demande) |
| `--admin INDICATIF` | Premier administrateur |
| `--port N` | Port interne (9000 par défaut ; nouveau serveur seulement) |
| `--sauvegarde HH:MM` | Sauvegarde automatique quotidienne (section 14) |
| `--sans-https` | Pas de certificat (essais seulement : Chrome refuse alors le port série et le micro) |

Ensuite : régler `clubName`, `stationCall`, `stationGrid` dans `config.json` (section 5), créer les membres (section 4). Pour reprendre un ancien serveur : `backup.sh --restaurer` avec une sauvegarde de l'ancien (section 14).
Le script ne supprime jamais rien : relancé sur un serveur existant, il fait une simple mise à jour.

### À la main

Sur un VPS Debian neuf (accès PuTTY / WinSCP) :

```bash
sudo apt update && sudo apt install -y nodejs nginx certbot python3-certbot-nginx
```
```bash
sudo tar -xzf /home/on6dp/remote-station-X.Y.Z.tar.gz -C /opt
```
```bash
sudo useradd --system --home /opt/remote-station --shell /usr/sbin/nologin remotestation
```
```bash
sudo chown -R remotestation:remotestation /opt/remote-station
```
```bash
cd /opt/remote-station && sudo -u remotestation node init-config.js
```

`init-config.js` crée `config.json` avec un jeton de station neuf. Régler ensuite `clubName`, `stationCall` et laisser `"allowTx": false` (section 5).

```bash
sudo -u remotestation node /opt/remote-station/adduser.js ON6DP --admin
```
```bash
sudo cp /opt/remote-station/deploy/remote-station.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now remote-station
```
```bash
sudo cp /opt/remote-station/deploy/remote.op0p.be.nginx /etc/nginx/sites-available/remote.op0p.be && sudo ln -s /etc/nginx/sites-available/remote.op0p.be /etc/nginx/sites-enabled/
```
```bash
sudo nginx -t && sudo systemctl reload nginx && sudo certbot --nginx -d remote.op0p.be
```

- Le **HTTPS est obligatoire** (Chrome n'autorise le Web Serial et le micro que sur une page sécurisée).
- Le site nginx fourni transmet l'adresse réelle des membres (`X-Forwarded-For $remote_addr`), utilisée par le journal et la règle « un compte, un PC ».
- Pour récupérer comptes, carnet et réglages d'un ancien serveur : restaurer une sauvegarde (section 14) au lieu de `init-config.js` et `adduser.js`.
- Test : https://remote.op0p.be/station → connexion administrateur → « Tester sans radio (simulation) », puis le dashboard dans un autre onglet.

---

*Concept ON6DP, Paul (on6dp@on6dp.be) & IA Claude — Remote Station UBA-LGE, section de Liège.*

### Clusters telnet au choix de chaque membre

- Le menu **DX Cluster ▾** du dashboard propose, sous les deux clusters web, une liste de clusters telnet : chaque membre choisit celui de ses propres spots (carte de bande, pages des modes).
- La liste vient de `lib/data/clusters.json` (tableau `{ "name", "host", "port", "info" }`, environ 225 clusters d'après la liste « DX-Cluster – Realtime status » de novembre 2026 : clusters belges en tête, puis ordre alphabétique ; port 23 quand la liste n'en donne pas ; le nombre d'utilisateurs affiché est celui du relevé) ; une case **Chercher** filtre la liste du menu (indicatif, préfixe, adresse) ; on peut en ajouter dans `config.json` avec `clusterList` (même format). Le cluster du club (`clusterHost` / `clusterPort`, nom `clusterName`, par défaut « OP0P ») est toujours en tête et reste celui par défaut.
- Le choix de chaque indicatif est gardé dans `logs/cluster-pref.json` (à ne pas publier). Une seule liaison par cluster, partagée ; fermée 10 minutes après le départ du dernier membre qui l'utilise. Les commandes `clusterCmds` (ex. `set/skimmer`) ne sont envoyées qu'au cluster du club.
- Les spots envoyés par les membres (case « Spot cluster », bouton SPOT) partent toujours au cluster du club.
