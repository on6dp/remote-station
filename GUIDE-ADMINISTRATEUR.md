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
| `refData` | `true` | Téléchargement des listes IOTA / WWFF / POTA / BOTA / LLOTA pour le carnet (section 11). `false` : pas de téléchargement, les cases de référence restent utilisables à la main |
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
| `digiAlcMax` | 0 | Limiteur d'ALC en émission numérique (%) ; 0 = sans |
| `ftxWatchdogMinutes` | 6 | Arrêt d'une séquence FT8 / FT4 / FT2 sans réponse |
| `stationEditors` | ON6DP, ON4LUC | Responsables de la station (section 2) |
| `stationTz` | Europe/Brussels | Fuseau des statistiques |
| `clusterHost`, `clusterPort`, `clusterCall`, `clusterCmds` | op0p.be, 8000 | DX cluster de la carte de bande ; `clusterHost` vide = sans cluster. Les spots des opérateurs (case « Spot cluster » au log) passent par une courte liaison au même cluster sous l'indicatif de leur compte (pas `clusterCall` ni le TX call) ; journal `spot` |
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
- **FTDX5000** (`/ftdx5000`, en essai) : `faces/ftdx5000.webp` = face avant du logiciel Yaesu PCC-5000 (2× 1100 × 684 : voyants et chiffres de l'afficheur éteints) + réplique de l'afficheur (disposée comme celle du TRX : VFO-A en haut, S-mètre du SUB au milieu, VFO-B en bas ; toutes les valeurs dessinées éteintes, rallumées par `glows` aux zones `VR` relevées par le script de dessin) et cadre de l'écran dessous ; `faces/ftdx5000.js` (zones relevées sur l'image 1018 × 318 puis × 1100/1018 ; `glows` : voyants rallumés en color-dodge ; `texts` : chiffres en direct). Touches sans commande CAT dans le manuel (VRF, CONT/APF, R.FLT, TXW, mémoires) : message d'explication.
- **IC-7760** (`/ic7760`, en essai) : `faces/ic7760.webp` = photo Icom de la tête de commande (1634 × 581, coins blancs retirés, écran et petit écran noircis, voyants TX/RX éteints) ; `faces/ic7760.js` : positions relevées sur la photo puis × 570/740 pour que l'écran de la page ait la taille de celui du FTDX101 (`dualIcom` : écran Icom — colonne de touches ANT / P.AMP / ATT / DIGI-SEL / IP+ / AGC / COMP, en-têtes ANT · BW · SFT, galvanomètres réduits, « VFO [mode] [FIL] », fréquence en police Icom, scope à droite de la colonne (`lay.scopeX`), rangée <MENU1> · SPAN/EDGE · HOLD · CENT/FIX · MAIN/SUB · DUAL · EXPD/SET en touches bleues (colonne de gauche : barrette `.i76-kon` cyan si en service, `.off` grise ; dégradés `i76btn` / `i76btnOn`, classes `.lcd-bot.i76b`), EXPD/SET masquée et six touches resserrées sous le scope quand la colonne MULTI est ouverte (↩ dans la colonne), appui long sur CENT/FIX = SCROLL-C / SCROLL-F (27 14 02/03), écran FUNCTION et menu MULTI Icom ; filtre du récepteur sélectionné dans le petit écran (`subLcd`) ; touches et TWIN PBT `sided` = récepteur sélectionné). Page SSB : 2e carte de bande (VFO-B) à droite pour les TRX à deux récepteurs. Scope du TRX : `27 00` du MAIN et du SUB (octet 1 = 00 / 01), assemblés à part par la page Station (`s: 1` pour le SUB), relayés par le serveur ; réglages 27 12 (MAIN/SUB), 27 13 (DUAL), 27 14 – 27 17 (CENTER/FIX, SPAN, EDGE, HOLD de chaque scope).
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

Chaque membre règle l'égaliseur de **son** micro (**Equalizer micro**) : coupe-bas, 3 bandes, coupe-haut, gain, réduction de bruit. Le type de micro est reconnu d'après le nom de l'entrée son. Les réglages sont gardés **par membre et par micro** dans `profiles.json` sur le serveur. Rien à faire pour l'administrateur.

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
- Messages vocaux en anglais ou en français (TRX SSB) : fabriqués sur le VPS par **espeak-ng** (`sudo apt install espeak-ng`, déjà présent), lancé par le serveur sans shell ; mémoires dans `voicemem/` (textes dans `<INDICATIF>-tts.json`), refaites quand le TX call de l'opérateur change.
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

- Le carnet est dans `/opt/remote-station/logs/logbook.json` ; les réglages des services (mots de passe, clés API LoTW, eQSL, Club Log, QRZ.com) dans `logs/logbook-config.json` (droits 600). **Jamais publiés**, et les mots de passe ne sont jamais renvoyés aux navigateurs.
- Configuration du club : **administrateurs** (onglet Logbooks → Synchronisation ▾ → ⚙ Configuration). Synchronisation : administrateurs pour tous les indicatifs, chaque membre pour le sien (ci-dessous).
- Tous les membres (sauf écouteurs) enregistrent des QSO et peuvent modifier ou supprimer **les leurs** seulement. Les autres peuvent voir le détail d'un QSO, sans jamais le modifier.
- Un QSO sous l'indicatif d'un membre n'est **jamais** envoyé aux carnets du club : il part vers les siens (s'il les a réglés) ou s'exporte en ADIF (« Mes QSO »).
- **LoTW** : le certificat (.p12 / .tq6) et son mot de passe restent sur le PC où **TQSL** est installé, jamais sur le VPS ni sur GitHub. Sur le VPS : « Exporter pour TQSL (.adi) », signer avec TQSL sur le PC du club, puis « Marquer comme envoyés ».
- **UDP** (Swisslog, Log4OM, N1MM) : les paquets partent du serveur ; le PC qui les reçoit doit être joignable depuis le VPS.

### Logs en ligne par indicatif

- Chaque indicatif a **ses propres identifiants** (eQSL, Club Log, clé API QRZ, lieu de station TQSL et identifiant du site LoTW), gardés dans `logs/logbook-config.json` (droits 600), jamais renvoyés aux navigateurs.
- Les identifiants de ⚙ Configuration ne servent qu'aux indicatifs du club (ON5VL, OR0L). Un QSO n'est **jamais** envoyé avec les identifiants d'un autre indicatif.
- **Membres** (indicatif personnel avec émission permise) : Synchronisation ▾ → service → ils ne voient et ne règlent que **leur** indicatif, envoient **leurs** QSO, peuvent cocher l'envoi automatique de chaque nouveau QSO, exporter pour TQSL et marquer comme envoyés **leurs** QSO, lire **leurs** confirmations LoTW. Jamais la configuration du club, jamais « effacer le log Club Log ».
- **Administrateurs** : tous les indicatifs, comme avant, plus l'envoi automatique d'un indicatif personnel (case dans le cadre de ses identifiants).
- Un refus d'accès (mauvais mot de passe) bloque **seulement cet indicatif** jusqu'à ce que ses identifiants soient réenregistrés.
- Confirmations LoTW : lues pour l'indicatif choisi et reportées seulement sur ses QSO (date de dernière lecture gardée par indicatif).
- Pas d'envoi UDP vers le logbook du PC du club pour un QSO fait sous un indicatif personnel.

### Listes de références IOTA, WWFF, POTA, BOTA, LLOTA

- La fiche du QSO a des cases **IOTA, WWFF, POTA, BOTA, LLOTA** (2e ligne, à droite de Remarque) pour les références du correspondant, et une ligne « Ma réf. (activation) » (bouton à droite de QO-100) pour celles de la station. Une liste de choix s'ouvre pendant la frappe.
- Le serveur télécharge les listes mondiales lui-même, sans clé ni compte, dans `/opt/remote-station/refdata/<PROGRAMME>.json` :
  - POTA : `https://pota.app/all_parks_ext.csv`
  - WWFF : `https://wwff.co/wwff-data/wwff_directory.csv`
  - BOTA (WWBOTA) : `https://api.wwbota.org/bunkers/?format=CSV`
  - LLOTA : `https://llota.app/api/public/references`
  - IOTA : `https://www.iota-world.org/…/fulllist.json`
- Premier téléchargement 20 s après le démarrage du service (une liste à la fois), puis vérification toutes les 6 h ; une liste est retéléchargée quand elle a plus de 7 jours (BOTA : 30 jours). Une liste en erreur garde la version précédente.
- **État et mise à jour à la main** : onglet Logbooks → Synchronisation ▾ → **Listes de références…** (administrateurs) → « Mettre à jour maintenant ». Les erreurs s'affichent aussi dans `journalctl -u remote-station`.
- Le VPS doit pouvoir joindre ces sites en HTTPS (sortie). `"refData": false` dans `config.json` coupe les téléchargements.
- `refdata/` n'est pas à sauvegarder (il se retélécharge) et n'est jamais publié sur GitHub.
- ADIF : `IOTA`, `POTA_REF`, `WWFF_REF`, `MY_IOTA`, `MY_POTA_REF`, `MY_WWFF_REF` ; BOTA en `SIG` = `WWBOTA` / `SIG_INFO` (LLOTA en `SIG` = `LLOTA` s'il n'y a pas de BOTA ; `MY_SIG` / `MY_SIG_INFO` pour la station), plus des champs `APP_REMOTESTATION_BOTA` / `APP_REMOTESTATION_LLOTA` (et `_MY_`) pour garder les deux.

---

## 12. Statistiques d'utilisation

Bouton **📊 STATS** du dashboard (administrateurs), page https://remote.op0p.be/stats :

- par indicatif : temps avec la main, temps connecté, émission, sessions, jours, QSO, bandes et modes ;
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
| `logs/` | Carnet (`logbook.json`), identifiants des carnets en ligne (`logbook-config.json`), journaux d'accès, relevés d'utilisation |
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

## 15. Fichiers secrets

Ces fichiers restent **sur le VPS** (et dans vos sauvegardes privées), jamais dans le dépôt GitHub, dans une archive de version ni dans un message :
`config.json` (jeton), `users.json`, `comptes-*.csv`, `sessions.json`, `macros.json`, `profiles.json`, `logs/logbook.json`, `logs/logbook-config.json`, `logs/station-sessions.json`, `logs/*.log`, `logs/usage-*.jsonl`, `sstv/`.
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
| Heure de Windows du PC du club décalée (NetTime installé à la main) | Assistant carte son **version 4** : règle le service Windows Time (be.pool.ntp.org, europe.pool.ntp.org, time.cloudflare.com, interrogés toutes les 1 à 4 min), resynchronise au démarrage, toutes les heures et sur « ⟳ Mettre à l'heure » (onglet Synchro). L'écart du PC du club est de toute façon corrigé pour l'émission ; désinstaller NetTime pour éviter deux réglages concurrents |
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
