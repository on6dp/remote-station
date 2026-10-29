# Remote Station UBA-LGE — ON5VL / OR0L

Pilotage à distance des transceivers du club depuis un navigateur.

- **Site des membres** : https://remote.op0p.be
- **Page Station (PC du club)** : https://remote.op0p.be/station
- **Serveur** : VPS VEX `57.131.159.97`, dossier `/opt/remote-station`, service `remote-station` (port local 9000, derrière nginx)
- **TRX pris en charge** : Yaesu FTX-1, Yaesu FTDX10, Yaesu FTDX101D / MP, Icom IC-7300 (un seul branché à la fois)

```
 TRX ──USB──► PC du club (Chrome, page /station) ──internet──► VPS remote.op0p.be ◄── membres (navigateur)
```

**Version actuelle : 0.25.5** — historique dans [CHANGELOG.md](CHANGELOG.md).

**Télécharger une version prête à installer** : dossier [releases/](releases/README.md) du dépôt. Chaque version y a son archive serveur
`remote-station-X.Y.Z.tar.gz`, son installateur Windows `RemoteStation-Setup-X.Y.Z.exe` et le fichier `SHA256SUMS.txt` des empreintes.
L'archive s'installe avec la procédure « Mettre à jour le serveur » ci-dessous.

| Document | Pour qui |
|---|---|
| **[MANUEL.md](MANUEL.md)** · [USER-MANUAL.md](USER-MANUAL.md) | Les membres : manuel complet pour débutants (lexique, premiers pas guidés, chaque commande expliquée). Aussi dans le dashboard, bouton **HELP**. |
| [LISEZMOI.md](LISEZMOI.md) | Les administrateurs : installation complète du serveur. |
| [windows/LISEZMOI-WINDOWS.md](windows/LISEZMOI-WINDOWS.md) | Installation sous Windows (PC du club, serveur). |
| Ce fichier | Aide-mémoire des opérations courantes. |
| [TIERS.md](TIERS.md) | Licences des éléments repris. |

## Ce que fait la Remote Station

- **Piloter le TRX** depuis un navigateur : fréquence, bandes, modes, filtres, DSP, deux VFO, SPLIT, RIT / XIT, antenne, tuner, puissance, PTT ; une seule personne « a la main » à la fois, les autres regardent et écoutent.
- **Écouter** le TRX dans le navigateur, avec un réglage de volume propre à chacun.
- **Modes numériques** décodés sur le serveur, sans logiciel à installer : FT8 · FT4 · FT2 (moteur WSJT-X 3 avec le décodeur multi-passes de JTDX, séquence automatique comme WSJT-X), RTTY, JTTY, WSPR, JT65, CW, SSTV ; émission en FT8 · FT4 · FT2, RTTY et JTTY. Une **carte de bande** verticale affiche les spots du DX cluster (et du Reverse Beacon Network) : un clic sur un spot y cale le TRX et le décodeur.
- **Carnet de trafic** partagé : enregistrement des QSO, colonnes et filtres, export ADIF / Cabrillo (dont « Mes QSO » pour chaque opérateur), envoi vers LoTW, eQSL, Club Log et QRZ.com avec des identifiants par indicatif, recherche des correspondants sur QRZ.com, UDP vers Swisslog, Log4OM, N1MM…
- **Phonie à distance** : le micro de l'opérateur (navigateur) part vers l'entrée USB du TRX pendant le PTT, avec un égaliseur réglable et des réglages gardés pour chaque membre et chaque micro (type de micro reconnu d'après son nom) ; **égaliseur paramétrique du TRX** (menus PRMTRC des Yaesu) avec un profil par membre, mis au TRX à la prise de main et remplacé par le réglage du club quand il la rend.
- **Sécurités d'émission** côté serveur et côté club : bandes autorisées, puissance selon la licence, ROS, durée maximale, coupure si la liaison tombe.
- **Opérateurs** : liste des connectés, demande et passage de la main, discussion, mode « Suivre l'opérateur » pour la formation à distance.

---

## Aide-mémoire

> Dans PuTTY, lancer **une commande à la fois**.
> Les fichiers secrets restent sur le VPS et ne sont **jamais** dans ce dépôt : `config.json` (jeton de la station), `users.json` (mots de passe), `comptes-*.csv`, `logbook.json` (carnet), `logbook-config.json` (identifiants des carnets en ligne), `sessions.json`, `macros.json`, `profiles.json` (réglages de micro des membres).

### 1. Mettre à jour le serveur avec une nouvelle version

1. Copier `remote-station-X.Y.Z.tar.gz` dans `/home/on6dp` avec WinSCP (supprimer les anciennes archives pour ne pas se tromper).
2. Dans PuTTY :

```bash
sudo rm -rf /opt/remote-station/public /opt/remote-station/lib
```
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

3. Ctrl+F5 dans le navigateur (page membres et page Station).

Le `chown` est **obligatoire** après chaque décompression, sinon les commandes de gestion des membres échouent (« permission denied »).

### 2. Gérer les membres

Les commandes se lancent dans PuTTY, en root ou avec `sudo`. Le chemin complet `/opt/remote-station/adduser.js` permet de les taper depuis n'importe quel dossier (depuis `/home/on6dp`, `node adduser.js` seul répond « Cannot find module »).

| Action | Commande |
|---|---|
| Ajouter un membre (ou changer son mot de passe) | `sudo -u remotestation node /opt/remote-station/adduser.js ON4XXX` |
| Ajouter un administrateur | `sudo -u remotestation node /opt/remote-station/adduser.js ON4XXX --admin` |
| Membre sans émission | `sudo -u remotestation node /opt/remote-station/adduser.js ON4XXX --no-tx` |
| Supprimer un membre | `sudo -u remotestation node /opt/remote-station/adduser.js --del ON4XXX` |
| Lister les membres (avec désactivés et dates de fin) | `sudo -u remotestation node /opt/remote-station/adduser.js --list` |
| **Désactiver** un membre (affiliation non renouvelée) | `sudo -u remotestation node /opt/remote-station/adduser.js --disable ON4XXX` |
| Le **réactiver** | `sudo -u remotestation node /opt/remote-station/adduser.js --enable ON4XXX` |
| Accès **jusqu'à une date** (fin d'affiliation) | `sudo -u remotestation node /opt/remote-station/adduser.js --until ON4XXX 2027-03-31` |
| Retirer la date de fin | `sudo -u remotestation node /opt/remote-station/adduser.js --until ON4XXX` |
| Même date pour **tous** les membres (sauf administrateurs) | `sudo -u remotestation node /opt/remote-station/adduser.js --until-all 2027-03-31` |

- Le mot de passe est **demandé deux fois** ; les caractères ne s'affichent pas pendant la frappe (normal). 8 caractères au moins.
- Le compte est actif tout de suite (pas de redémarrage). Relancer la même commande sur un compte existant **remplace son mot de passe**.
- Indicatifs belges seulement (ON, OO, OP, OQ, OR, OS, OT). Limites automatiques : ON2 100 W, ON3 25 W et bandes de la licence de base, ONL jamais en émission.
- Remettre le mot de passe au membre en privé (de vive voix, message personnel), jamais dans un groupe.

**Membres de la section LGE seulement.** Un membre qui ne renouvelle pas son affiliation est **désactivé** (`--disable`) plutôt que supprimé : son compte, ses QSO au carnet et ses statistiques restent, et `--enable` le rétablit dès qu'il est en ordre. Avec une **date de fin** (`--until`, ou `--until-all` pour tout le monde en début d'année), l'accès s'arrête tout seul le lendemain de cette date ; à chaque renouvellement, il suffit de reporter la date. Dans les deux cas : connexion refusée avec le message « Compte … désactivé / expiré le … : accès réservé aux membres en ordre d'affiliation », et une session déjà ouverte est fermée dans les 30 secondes. Le message n'apparaît qu'avec le bon mot de passe (un inconnu voit seulement « Indicatif ou mot de passe incorrect »).

Créer plusieurs comptes d'un coup (un indicatif par ligne dans `membres.txt`, copié dans `/home/on6dp`) :

```bash
sudo install -m 644 /home/on6dp/membres.txt /tmp/membres.txt
```
```bash
cd /opt/remote-station && sudo -u remotestation node importusers.js /tmp/membres.txt
```
```bash
sudo mv /opt/remote-station/comptes-*.csv /home/on6dp/ && sudo chown on6dp: /home/on6dp/comptes-*.csv
```

Le fichier `comptes-AAAA-MM-JJ.csv` contient les mots de passe générés : les remettre aux membres, puis **supprimer le fichier**. Pas besoin de redémarrer le service.

Règles automatiques : seuls les indicatifs belges (ON, OO, OP, OQ, OR, OS, OT) peuvent se connecter ; **ON3 = 25 W max**, les autres 1500 W ; **ONL = écoute seule**, jamais d'émission.

### 3. Jeton de la station

Le jeton sert uniquement à la page Station du PC du club (les membres ne l'utilisent pas). Ne jamais le publier.

Afficher le jeton :
```bash
sudo grep stationToken /opt/remote-station/config.json
```

Changer le jeton (puis le recoller sur la page Station du club, **sans les guillemets**) :
```bash
sudo sed -i "s/\"stationToken\": *\"[^\"]*\"/\"stationToken\": \"$(openssl rand -hex 24)\"/" /opt/remote-station/config.json
```
```bash
sudo systemctl restart remote-station
```

### 4. Changer le titre de la page

```bash
sudo sed -i 's|"clubName": *"[^"]*"|"clubName": "Remote Station UBA-LGE"|' /opt/remote-station/config.json
```
```bash
sudo sed -i 's|"stationCall": *"[^"]*"|"stationCall": "ON5VL / OR0L"|' /opt/remote-station/config.json
```
```bash
sudo systemctl restart remote-station
```

### 4 bis. Indicatif et locator des modes numériques
Les messages FT8 / FT4 / FT2 / RTTY / JTTY partent sous l'indicatif `digiCall` (ON5VL par défaut) ou, si celui qui a la main le choisit (TX call), sous son propre indicatif.
Le locator `stationGrid` sert aux messages CQ et aux distances ; `stationCall` liste les autres indicatifs du club (ex. `"ON5VL / OR0L"`) :
```
sudo nano /opt/remote-station/config.json      # "digiCall": "ON5VL", "stationGrid": "JO20"
sudo systemctl restart remote-station
```

**Autres réglages utiles de `config.json`** (redémarrer le service après modification) :

| Réglage | Par défaut | Rôle |
|---|---|---|
| `allowTx` | `false` | Autorise l'émission (section 5). |
| `maxTxSeconds` | `120` | Durée maximale d'une émission. |
| `autoSideband` | `true` | Phonie : à chaque changement de bande (pendant qu'un membre a la main), un VFO en LSB / USB est remis en LSB sous 10 MHz et en USB au-dessus (60 m : USB). Les modes DATA, CW, AM, FM ne sont pas touchés. |
| `remoteVoice` | `true` | Phonie à distance (micro de l'opérateur vers le TRX). `false` : le PTT garde le micro du club. |
| `controlIdleMinutes` / `sessionIdleMinutes` | `15` / `15` | Main libérée / membre déconnecté après ce temps sans action. |
| `rememberDays` | `7` | Jours pendant lesquels un navigateur reste connecté. |
| `controlMaxMinutes`, `controlWarnSeconds`, `controlAskMinutes` | 45 min, 120 s, 15 min | Équité : main passée au membre qui l'a demandée après 45 min (avertissement 2 min avant, jamais pendant une émission). 0 = pas de limite. |
| `licenceBands` | ON3 : 80, 40, 30, 20, 15, 10 m, 2 m, 70 cm | Bandes permises en émission par début d'indicatif (les autres : toutes celles de `txRanges`). |
| `clubCalls` | ON5VL, OR0L | Indicatifs du club proposés dans « TX call » (émission et carnet, traités comme ceux de la station pour les logs en ligne). |
| `stationTz` | Europe/Brussels | Fuseau horaire des jours et heures de la page /stats. |
| `idleExempt` | ON6DP, ON4LUC, ON5VL | Indicatifs jamais déconnectés pour inactivité (la main reste libérée après `controlIdleMinutes`). |
| `powerRules`, `defaultMaxWatts` | ON2 : 100 W, ON3 : 25 W, sinon 1500 W (ON2 et ON3 plafonnés même si le réglage les oublie) | Puissance maximale selon l'indicatif. |
| `rxOnlyPrefixes` | `["ONL"]` | Indicatifs en écoute seule. |
| `maxSwr`, `swrHoldMs` | `2.5`, `700` | Coupure de l'émission sur ROS élevé. |
| `tunerAuto` | `true` | Tuner remis en service à chaque changement de bande HF / 6 m. |
| `qsyOrigins` | `['https://dx.op0p.be', …, 'http://cluster.op0p.be']` | Sites de DX cluster autorisés à envoyer un spot au dashboard (clic sur un spot → le TRX s'y cale). Voir « Clic sur un spot d'un DX cluster ». |
| `stationEditors` | `['ON6DP', 'ON4LUC']` | Indicatifs (connectés à la page Station avec leur indicatif) qui peuvent modifier le jeton, la vitesse et les bits de stop de la page Station ; verrouillés pour les autres. |
| `clusterHost`, `clusterPort`, `clusterCall`, `clusterCmds` | `op0p.be`, `8000`, `''`, `['set/skimmer']` | DX cluster (telnet) de la carte de bande RTTY. `clusterHost` vide = pas de cluster ; `clusterCall` vide = `digiCall` suivi de `-7`. |
| `ftx1SubCat`, `ftx1SubSingle` | `true`, `false` | FTX-1 : passage MAIN / SUB par le dashboard en double réception (DUAL RX) ; en réception simple, refusé (il a mis le TRX en émission les 24 et 25/10) sauf `ftx1SubSingle: true` (essais seulement). |
| `digiAlcMax` | `0` | Limiteur d'ALC en émission numérique (%) ; 0 = pas de limiteur. |
| `ftxWatchdogMinutes` | `6` | Arrêt de l'émission FT8 / FT4 / FT2 sans réponse. |
| `qo100If` | 144,5 / 432,5 / 1296,5 | FI des convertisseurs QO-100 (section 4 ter). |

Les identifiants des carnets en ligne (LoTW, eQSL, Club Log, QRZ.com) se règlent dans le dashboard (onglet Logs → Synchronisation ▾ → ⚙ Configuration, et dans chaque fenêtre de synchronisation pour les indicatifs personnels) ; ils restent dans `logbook-config.json` sur le serveur, jamais dans ce dépôt.

### 4 ter. QO-100 : fréquences de la FI du convertisseur 2,4 GHz
Les listes FT8 · FT4, RTTY et CW proposent « QO-100 · FI 2 m / 70 cm / 23 cm » : la fréquence à mettre sur le TRX, avant le
convertisseur, pour monter sur 2400,040 MHz (FT8 / FT4), 2400,025 MHz (CW) ou 2400,090 MHz (RTTY). `qo100If` donne, pour chaque
convertisseur, la FI qui correspond à 2400,000 MHz :
```
"qo100If": { "2m": 144.5, "70cm": 432.5, "23cm": 1296.5 }
```
432,5 = oscillateur à 1967,5 MHz (ex. DXpatrol : FT8 sur 432,540 MHz). Avec un oscillateur à 1968 MHz, mettre 432 (FT8 sur 432,040) ;
0 = pas de convertisseur sur cette bande. Seules les FI couvertes par le TRX branché sont proposées (2 m et 70 cm : FTX-1).

### 5. Autoriser l'émission (après les essais sur charge fictive)

```bash
sudo sed -i 's/"allowTx": *false/"allowTx": true/' /opt/remote-station/config.json
```
```bash
sudo systemctl restart remote-station
```

Pour couper l'émission pour tout le monde : même commande avec `true` et `false` inversés.

### 6. Surveiller

| Quoi | Commande |
|---|---|
| État du service | `sudo systemctl status remote-station --no-pager` |
| Journal en direct | `sudo journalctl -u remote-station -f` |
| Connexions / déconnexions | `sudo journalctl -u remote-station -f \| grep -E "login\|logout"` |
| Liaison de la page Station (coupures, cause, durée) | `sudo journalctl -u remote-station --since "-30 min" \| grep station_` |
| Émissions du mois | `sudo grep tx_start /opt/remote-station/logs/access-$(date +%Y-%m).log \| tail` |

Les heures du journal systemd sont en **UTC** (heure belge − 1 h en hiver, − 2 h en été).

---

## Au club : PC de la station

**Navigateur** : Chrome ou Edge (le Web Serial ne marche pas dans Firefox ni Safari), adresse en **https**.

### Première mise en route
1. Brancher le TRX en USB (pilote « Virtual COM Port » de Yaesu pour FTX-1 / FTDX10 / FTDX101, pilote Icom CP210x pour l'IC-7300).
2. Ouvrir https://remote.op0p.be/station.
3. **Réglages** : choisir le **Modèle du TRX**, coller le **jeton**, « Enregistrer et reconnecter » → voyant Serveur vert.
4. « **Choisir le port du TRX** » → le bon port → le journal affiche « … répond ».
5. Laisser l'onglet ouvert en permanence. **Une seule page Station** à la fois.

**Jeton dans l'adresse** (si Chrome oublie le jeton) : ouvrir `https://remote.op0p.be/station#jeton=LE_JETON` (sans guillemets). La page enregistre le jeton puis l'efface de la barre d'adresse ; la partie après `#` n'est jamais envoyée sur internet. Pratique pour le raccourci de démarrage du PC du club :
`"C:\Program Files\Google\Chrome\Application\chrome.exe" --autoplay-policy=no-user-gesture-required --app=https://remote.op0p.be/station#jeton=LE_JETON`
6. Dans Chrome : **Paramètres → Performances → « Toujours garder ces sites actifs » → Ajouter `remote.op0p.be`**, sinon l'économiseur de mémoire peut mettre l'onglet en veille.

### Clic sur un spot d'un DX cluster (dx.op0p.be, cluster.op0p.be)

Un clic sur un spot dans un DX cluster ouvert dans le même navigateur que le dashboard cale le TRX sur la station
(fréquence, mode, onglet du mode, indicatif dans Correspondant), avec les règles habituelles (main, émission en cours).
Dans le site du cluster (servi en **https**, et listé dans `qsyOrigins`) :

```html
<script src="https://remote.op0p.be/js/rs-qsy-client.js"></script>
```

puis, dans le gestionnaire du clic sur un spot :

```js
window.remoteStationQsy(spot.freq /* kHz */, spot.mode /* 'FT8', 'CW', 'SSB', 'RTTY'… */, spot.dx_call);
```

Le script ajoute un relais invisible (`/qsy.html` de la Remote Station, en iframe) qui passe le spot au dashboard
(BroadcastChannel). Pour les membres déjà connectés au dashboard dans ce navigateur, un badge « Remote Station <-> DX Cluster »
en bas à droite de la page du cluster (ou dans un élément `id="rs-qsy-badge"` s'il existe, ex. la colonne des filtres de dx.op0p.be) indique la liaison (<-> vert : dashboard ouvert avec la main ; rouge sinon) et le résultat
de chaque clic. Facultatif : `window.onRemoteStationAck = (ok, raison) => …`.

### Réglages des radios

| TRX | Réglages | Port à choisir | Vitesse |
|---|---|---|---|
| **FTX-1** | Operation setting → General : CAT-1 RATE 38400, CAT-1 CAT-3 STOP BIT 1bit, RPTT SELECT OFF | Enhanced COM Port (CAT-1) | 38400 |
| **FTDX10** | Operation setting → General : CAT RATE 38400, RPTT SELECT OFF | Enhanced COM Port | 38400 |
| **FTDX101D / MP** | OPERATION SETTING → GENERAL : CAT RATE 38400, RPTT SELECT OFF | Enhanced COM Port | 38400 |
| **IC-7300** | MENU → SET → Connectors → CI-V : USB Baud Rate 115200, Address 94h, USB Echo Back OFF ; USB SEND et USB Keying OFF | port USB de l'IC-7300 | 115200 |

Aucun autre logiciel (WSJT-X, log…) ne doit utiliser le port CAT en même temps.

### Audio : faire entendre le TRX aux membres
1. Le TRX est relié en USB : sa carte son intégrée apparaît dans Windows (souvent « USB Audio CODEC »).
2. Page Station → cadre **« Audio du TRX »** → **« Activer l'audio »**. La première fois, Chrome demande l'accès au micro : répondre **Autoriser** (c'est l'entrée son du TRX, pas un micro).
3. Choisir l'**entrée son** du TRX dans la liste. La barre de niveau doit bouger avec la BF ; régler le niveau de sortie USB dans le menu du TRX si elle est trop faible ou toujours au maximum.
4. Le son n'est envoyé que si au moins un membre écoute ou regarde un onglet de mode numérique (12 kHz, 192 kbit/s depuis le club ; 96 kbit/s vers chaque écouteur).
5. **Sortie son vers le TRX** (émission numérique) : choisir la carte son USB du TRX (« Haut-parleurs (USB Audio CODEC) »), jamais les haut-parleurs du PC ; régler le niveau pour que l'ALC reste faible.

6. **Phonie à distance** : la voix de l'opérateur sort par la même **sortie son vers le TRX**. Le niveau se règle avec « Niveau phonie à distance » (l'ALC doit à peine bouger en SSB). Rien à régler dans les menus : juste avant l'émission, la page Station relit le menu « source de modulation » du mode, le met sur USB, puis le remet comme avant 20 s après la dernière émission en phonie ou dès que l'opérateur rend la main (le micro du club refonctionne) :
   - FTX-1 : MOD SOURCE (EX010113 en SSB, EX010213 en AM, EX010312 en FM) → 1 (USB) ;
   - FTDX10 : SSB MOD SOURCE (EX010113) → REAR, REAR SELECT (EX010114) → USB ;
   - FTDX101D / MP : SSB MOD SOURCE (EX010111) → REAR, REAR SELECT (EX010112) → USB ;
   - IC-7300 : DATA OFF MOD (CI-V 1A 05 00 66) → USB.
   Si le menu ne peut pas être relu, rien n'est émis (l'opérateur est prévenu).
7. **Égaliseur du TRX** (Yaesu, menus PRMTRC EQ1 à EQ3 et P PRMTRC) : la première fois qu'un profil de membre est mis au TRX, le réglage en place est relu et gardé comme **réglage du club** ; il est remis quand le membre rend la main. Un administrateur peut le changer (bouton « Enregistrer comme réglage du club »). Profils et réglage du club dans `profiles.json` (VPS seulement).

Après un redémarrage, la page réactive l'audio toute seule. Si elle affiche « Audio en pause », un clic n'importe où sur la page suffit ; pour éviter ce clic, ajouter `--autoplay-policy=no-user-gesture-required` au raccourci de démarrage de Chrome.

### Changer de TRX
- **Au club** : page Station → Réglages → « Modèle du TRX ». La première fois pour un modèle, choisir son port ; ensuite il est mémorisé.
- **À distance (administrateurs)** : sur https://remote.op0p.be, cliquer sur **STATION** en haut à gauche → choisir le TRX. Possible seulement si le TRX est branché au PC du club, que son port a déjà été choisi une fois au club, et jamais pendant une émission.

---

## Installation sous Windows 10 / 11

`RemoteStation-Setup-<version>.exe` installe, au choix, le **kit du PC du club** (page Station avec les bons réglages de Chrome,
démarrage automatique, pas de veille) et/ou le **serveur** en service Windows. Détails : [windows/LISEZMOI-WINDOWS.md](windows/LISEZMOI-WINDOWS.md).
Fabrication sous Linux : `windows/build.sh` (NSIS 3, WinSW).

## Pour les membres

Tout est expliqué pas à pas dans le **[manuel](MANUEL.md)** ([English](USER-MANUAL.md)), aussi dans le dashboard (bouton **HELP**, https://remote.op0p.be/aide et /help).
Source du manuel : `public/aide.html` et `public/help.html` ; après chaque modification, `node native/manual2md.js` refait les deux fichiers .md.

L'essentiel en cinq lignes :

1. Ouvrir https://remote.op0p.be dans **Chrome** ou **Edge**, se connecter avec **son indicatif** et **son mot de passe**.
2. **Prendre la main** (une seule personne pilote à la fois). Si quelqu'un l'a déjà : bouton **👥** en haut → **Demander la main**.
3. **Écouter** : cadre RX audio → « 🔊 Écouter le TRX ». Tout le monde peut écouter, même sans la main.
4. Après un changement de bande : **TUNE**, puis vérifier le SWR avant d'émettre. FT8 : onglet FT8 · FT4 · FT2, clic sur l'indicatif d'une station qui lance appel, la séquence se fait toute seule.
5. **Libérer la main** en partant (sinon elle est libérée après 15 min sans action).

---

## Sécurités d'émission (résumé)

- **TRX bloqué en émission** : la page Station (au club, même sans liaison avec le VPS) repasse le TRX en réception s'il émet **2 min sans modulation**, ou **5 min sans interruption**, quelle qu'en soit la cause (PTT ou micro bloqué au club…). Nouvel essai toutes les 10 s si la radio reste bloquée. Réglable : `txSilenceSeconds`, `txHardMaxSeconds`.
- **Protection du PA (ROS)** : si le ROS dépasse **2,5:1** pendant 0,7 s en émission, l'émission est coupée. Le PTT reste ensuite refusé sur cette fréquence (±25 kHz) jusqu'à un **accord (TUNE)**. Réglable dans `config.json` : `maxSwr` (0 = pas de protection) et `swrHoldMs`. Après chaque changement de bande, le dashboard rappelle de faire TUNE.

- Émission seulement dans les bandes autorisées (`txRanges`), contrôlée sur la fréquence réellement émise (VFO B en SPLIT, XIT compris).
- Durée maximale d'émission : 120 s, puis coupure (relâcher le PTT avant de réémettre).
- Coupure immédiate si le membre perd la liaison, si le PC du club perd internet, ou si la page Station se ferme.
- **TUNE sans accord** : si le FTX-1 signale HI-SWR à la fin d'un TUNE, l'émission est bloquée sur toute la bande (sauf TUNE) jusqu'à un TUNE réussi.
- FT8 / FT4 / FT2 : émission arrêtée à la fin de chaque période ; arrêt de la séquence si le même message part depuis 6 min sans réponse (`ftxWatchdogMinutes`).
- Puissance ramenée à la limite de la licence (ON3 : 25 W) ; émission coupée si on tourne le bouton au-delà.
- VOX : peut être coupé à distance, jamais activé. TUNE compte comme une émission.

---

## Problèmes fréquents

| Symptôme | Solution |
|---|---|
| L'ancien design s'affiche | Une ancienne archive a été décompressée : refaire la mise à jour (section 1), en supprimant d'abord `public` et `lib`. |
| « permission denied » avec `adduser.js` | `sudo chown -R remotestation:remotestation /opt/remote-station` |
| Page Station : « Jeton refusé » | Recoller le jeton (sans guillemets ni espaces). |
| Dashboard figé ou « Station hors ligne » alors que la page Station dit « Connecté » | Coupure réseau silencieuse (ex. Starlink qui change d'adresse IP). Depuis la v0.2.3, la page Station le détecte en 15 s et se reconnecte seule ; sinon « Enregistrer et reconnecter ». |
| « Station hors ligne (page Station fermée ou quittée) » | L'onglet de la page Station a servi à ouvrir autre chose (souvent le dashboard). Sur le PC du club, garder la page Station **seule dans sa fenêtre** et ouvrir le dashboard par son bouton « Ouvrir le dashboard dans une autre fenêtre ». |
| La page Station signale « mise en pause » ou « déchargée par Chrome » | Chrome économise l'énergie ou la mémoire sur les onglets en arrière-plan. Sur le PC du club : Chrome → **Paramètres → Performances** → **Économiseur de mémoire** → « Toujours garder ces sites actifs » → **Ajouter** `remote.op0p.be` ; désactiver l'**Économiseur d'énergie** ; Windows : mise en veille sur **Jamais**. Le journal du serveur indique la cause (`station_diag`). |
| Il faut retaper le mot de passe à chaque actualisation | Corrigé en v0.2.15 : le navigateur reste connecté 7 jours (`rememberDays`). « Déconnexion » l'oublie ; à faire sur un PC partagé. |
| Page Station : « Remplacée par une autre page Station » | Une autre page Station est ouverte ailleurs : la fermer, puis « Enregistrer et reconnecter ». |
| Page Station : « Une autre page Station est déjà ouverte dans ce navigateur » | Deux onglets /station : fermer celui en trop (l'autre prend le relais tout seul). |
| Page Station : « …avec le TRX, est déjà en service » | Une page Station avec le TRX tourne déjà sur un autre PC : la fermer si c'est celle-ci qui doit servir. |
| « Port ouvert, pas de réponse » | Mauvais port (essayer l'autre), mauvaise vitesse, ou autre logiciel sur le port. |
| Voyant TRX **jaune** sur le dashboard | La station est en ligne mais le TRX ne répond pas (radio éteinte, câble USB). Rien à faire : la page Station rouvre le port toute seule dès que la radio répond à nouveau. |
| Je n'ai pas la main alors que je suis connecté | La main appartient à un onglet : fermer les autres onglets ou cliquer « Prendre la main ici ». |

---

## Fichiers du projet

| Fichier | Rôle |
|---|---|
| `server.js` | Serveur : comptes, contrôle, PTT, sécurités, messages, journal |
| `lib/` | WebSocket minimal, mots de passe, décodeur FT8/FT4 de secours (`ftx.wasm`, `ftx.js`), démodulateur RTTY (`rtty.js`), décodeur CW (`cw.js`), décodeur SSTV (`sstv-dec.js`) et galerie (`sstv-store.js`), WSPR (`wspr.js`, `wsprd.wasm`), fil de décodage (`digi-worker.js`) — aucune dépendance npm |
| `lib/dxcc.js`, `lib/data/cty.dat` | Pays DXCC, préfixe, distance et azimut d'un indicatif (fichier cty.dat d'AD1C) |
| `lib/cluster.js` | Client telnet du DX cluster (spots de la carte de bande RTTY) |
| `lib/qrz.js` | Recherche des correspondants sur QRZ.com (prénom, ville, locator) |
| `native/ftx/` | Source et script de compilation du décodeur WebAssembly (ft8_lib : secours si `lib/bin/wsjtxd` ne peut pas tourner) |
| `lib/wsjtx.js`, `lib/data/ALLCALL7.TXT` | Pilotage du moteur de décodage WSJT-X (FT8 / FT4 / FT2, passes anticipée / normale / profonde, AP) ; base d'indicatifs de JTDX |
| `native/wsjtx/` | Script de compilation des décodeurs de WSJT-X en programmes autonomes (`lib/bin/jt65`, `lib/bin/jttyd`, `lib/bin/wsjtxd` — moteur FT8 / FT4 / FT2, source `wsjtxd.c`, `build-wsjtxd.sh`), sans FFTW (`fftw_kiss.c`) ni Boost (`crc.c`) |
| `native/wspr/` | Sources de wsprd (WSJT-X, GPL v3) et script de compilation de `lib/wsprd.wasm` |
| `public/js/digi.js` | Onglets du centre : FT8 · FT4 · FT2, RTTY, WSPR, JT65, JTTY, CW, SSTV, Synchro ; carte de bande |
| `public/js/zoom.js` | Taille du dashboard adaptée à l'écran (Auto : agrandi au-delà de 1920 × 1080) |
| `public/aide.html`, `public/help.html`, `native/manual2md.js` | Manuel des membres (FR / EN) et conversion en `MANUEL.md` / `USER-MANUAL.md` |
| `releases/` | Versions prêtes à installer (archive serveur, installateur Windows, empreintes SHA-256) |
| `public/js/sstv.js` | Modes SSTV et codeur (image → signal), communs au serveur et au navigateur |
| `public/js/ftxenc.js`, `public/js/ftx-enc.wasm`, `native/ftx/ftx_enc.c` | Codeur FT8 / FT4 / FT2 (ft8_lib, MIT) pour l'émission |
| `lib/logbook.js`, `lib/logsync.js`, `public/js/logbook.js` | Carnet de trafic, exports ADIF / Cabrillo, envois LoTW (TQSL), eQSL, Club Log, QRZ.com (identifiants par indicatif) et UDP (WSJT-X, N1MM, ADIF) ; onglet « Logs » |
| `public/index.html`, `public/js/app.js`, `public/css/` | Page des membres |
| `public/station.html`, `public/js/station.js`, `public/js/station-core.js` | Page Station (Web Serial) |
| `public/js/yaesu.js`, `ftx1.js`, `ftdx10.js`, `ic7300.js` | Pilotes des TRX |
| `adduser.js`, `importusers.js`, `init-config.js` | Gestion des membres et de la configuration |
| `deploy/` | Service systemd et site nginx |
| `LISEZMOI.md` | Guide complet |
| `TIERS.md` | Licences des éléments repris (RigPlane Core et ft8_lib, MIT ; décodeurs de WSJT-X, GPL v3 ; base d'indicatifs de JTDX ; cty.dat d'AD1C ; police Roboto Mono, OFL) |
