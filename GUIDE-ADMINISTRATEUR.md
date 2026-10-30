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
- TRX pris en charge : **Yaesu FTX-1**, **FTDX10**, **FTDX101D / MP**, **Icom IC-7300**. Un seul est en service à la fois, mais plusieurs peuvent rester branchés au PC du club.

---

## 2. Rôles et droits

| Rôle | Qui | Ce qu'il peut faire en plus |
|---|---|---|
| **Membre** | tout indicatif belge (ON, OO, OP, OQ, OR, OS, OT) avec un compte | Piloter quand il a la main, écouter, émettre selon sa licence, carnet (ses QSO) |
| **Membre sans émission** | compte créé avec `--no-tx` | Écoute et réglages seulement |
| **Écouteur** | indicatif ONL… | Jamais d'émission, ni TUNE, ni réglage de puissance |
| **Administrateur** | compte créé avec `--admin` | Page Station (PC du club), reprise de la main, changement de TRX à distance, rechargement de la page Station, lecture CAT, synchronisation des carnets en ligne, réglage du club de l'égaliseur du TRX, statistiques (/stats) |
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
| `maxSwr`, `swrHoldMs` | 2,5, 700 ms | Coupure de l'émission sur ROS élevé (0 = pas de protection) |
| `tunerAuto` | `true` | Tuner remis en service à chaque changement de bande HF / 6 m |
| `txSilenceSeconds`, `txHardMaxSeconds` | 120, 300 | Chien de garde de la page Station (TRX en émission sans modulation / en continu) |
| `digiAlcMax` | 0 | Limiteur d'ALC en émission numérique (%) ; 0 = sans |
| `ftxWatchdogMinutes` | 6 | Arrêt d'une séquence FT8 / FT4 / FT2 sans réponse |
| `stationEditors` | ON6DP, ON4LUC | Responsables de la station (section 2) |
| `stationTz` | Europe/Brussels | Fuseau des statistiques |
| `clusterHost`, `clusterPort`, `clusterCall`, `clusterCmds` | op0p.be, 8000 | DX cluster de la carte de bande ; `clusterHost` vide = sans cluster |
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

1. Brancher le TRX en USB (pilote « Virtual COM Port » de Yaesu ; pilote Silicon Labs CP210x pour l'IC-7300).
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

- **FTDX10 / FTDX101 : CAT RTS doit être sur OFF**, sinon la liaison CAT tombe toutes les 2 secondes (voyant vert puis orange).
- Aucun autre logiciel (WSJT-X, logbook…) ne doit utiliser le port CAT en même temps.
- **CW par DTR** (facultatif, plus réactif) : page Station → « Port de manipulation CW (DTR)… » → le 2ᵉ port USB du TRX (Standard COM Port). Le menu PC KEYING du TRX est mis sur DTR tout seul pendant l'émission.

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
- Le FTDX101 a trois réglages en plus pour cette page : AF du récepteur SUB (`AG1`), BREAK-IN (`BI`) et KEYER (`KR`), lus avec les autres ; ils n'apparaissent pas dans le dashboard. SYNC est géré par la page (les deux VFO accordés ensemble), pas par le TRX.
- Fenêtres séparées : ⧉ des onglets des modes numériques (→ `digi.html`, raccrochée à la face avant par `window.opener.RSHOST`, comme pour le dashboard) et ⧉ de la carte de bande (la colonne `#fcBm` est déplacée telle quelle dans une fenêtre ; mémorisée dans le navigateur sous `rs.face.bmwin`).

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
| TRX en émission sans modulation 2 min, ou en continu 5 min (PTT ou micro bloqué au club…) | Retour en réception par la page Station, même sans liaison avec le VPS |
| Fréquence d'émission hors des plages ou de la licence | PTT refusé, ou coupé si on sort de bande (fréquence réellement émise : VFO B en SPLIT, XIT compris) |
| Puissance au-delà de la licence | PTT refusé ou coupé, puissance ramenée à la limite |
| ROS au-delà de 2,5:1 pendant 0,7 s | Coupure ; PTT refusé sur ±25 kHz jusqu'à un TUNE réussi |
| TRX en émission sans demande (ex. après un réglage) | Retour en réception immédiat |
| VOX | Peut être coupé à distance, jamais activé ; PTT refusé tant qu'il est actif |

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
| IC-7300 | DATA OFF MOD (CI-V 1A 05 00 66) → USB |

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
| Plus de son du TRX (alerte orange sur le dashboard) | Carte son USB figée : menu STATION → « Relancer la carte son du TRX » (responsables) |
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
