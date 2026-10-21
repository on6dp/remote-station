# Remote Station UBA-LGE — ON5VL / OR0L

Pilotage à distance des transceivers du club depuis un navigateur.

- **Site des membres** : https://remote.op0p.be
- **Page Station (PC du club)** : https://remote.op0p.be/station
- **Serveur** : VPS VEX `57.131.159.97`, dossier `/opt/remote-station`, service `remote-station` (port local 9000, derrière nginx)
- **TRX pris en charge** : Yaesu FTX-1, Yaesu FTDX10, Icom IC-7300 (un seul branché à la fois)

```
 TRX ──USB──► PC du club (Chrome, page /station) ──internet──► VPS remote.op0p.be ◄── membres (navigateur)
```

**Version actuelle : 0.7.1** — historique dans [CHANGELOG.md](CHANGELOG.md).

**Télécharger un paquet prêt à installer** : onglet **Releases** (ou **Tags**) du dépôt → version voulue → `Source code (tar.gz)`. Le paquet s'installe avec la procédure « Mettre à jour le serveur » ci-dessous (le dossier extrait s'appelle alors `remote-station-0.7.1` : le renommer en `remote-station`, ou utiliser l'archive `remote-station-X.Y.Z.tar.gz` fournie avec la version).

Le guide complet est dans [LISEZMOI.md](LISEZMOI.md). Ci-dessous, l'aide-mémoire des opérations courantes.

---

## Aide-mémoire

> Dans PuTTY, lancer **une commande à la fois**.
> Les fichiers secrets restent sur le VPS et ne sont **jamais** dans ce dépôt : `config.json` (jeton de la station), `users.json` (mots de passe), `comptes-*.csv`.

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

```bash
cd /opt/remote-station
```
| Action | Commande |
|---|---|
| Ajouter un membre (ou changer son mot de passe) | `sudo -u remotestation node adduser.js ON4XXX` |
| Ajouter un administrateur | `sudo -u remotestation node adduser.js ON4XXX --admin` |
| Membre sans émission | `sudo -u remotestation node adduser.js ON4XXX --no-tx` |
| Supprimer un membre | `sudo -u remotestation node adduser.js --del ON4XXX` |
| Lister les membres | `sudo -u remotestation node adduser.js --list` |

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
Les messages FT8 / FT4 / RTTY / CW utilisent l'indicatif `digiCall` (ON5VL par défaut) et le locator `stationGrid` de `config.json` :
```
sudo nano /opt/remote-station/config.json      # "digiCall": "ON5VL", "stationGrid": "JO20"
sudo systemctl restart remote-station
```

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
1. Brancher le TRX en USB (pilote « Virtual COM Port » de Yaesu pour FTX-1/FTDX10, pilote Icom CP210x pour l'IC-7300).
2. Ouvrir https://remote.op0p.be/station.
3. **Réglages** : choisir le **Modèle du TRX**, coller le **jeton**, « Enregistrer et reconnecter » → voyant Serveur vert.
4. « **Choisir le port du TRX** » → le bon port → le journal affiche « … répond ».
5. Laisser l'onglet ouvert en permanence. **Une seule page Station** à la fois.

**Jeton dans l'adresse** (si Chrome oublie le jeton) : ouvrir `https://remote.op0p.be/station#jeton=LE_JETON` (sans guillemets). La page enregistre le jeton puis l'efface de la barre d'adresse ; la partie après `#` n'est jamais envoyée sur internet. Pratique pour le raccourci de démarrage du PC du club :
`"C:\Program Files\Google\Chrome\Application\chrome.exe" --autoplay-policy=no-user-gesture-required --app=https://remote.op0p.be/station#jeton=LE_JETON`
6. Dans Chrome : **Paramètres → Performances → « Toujours garder ces sites actifs » → Ajouter `remote.op0p.be`**, sinon l'économiseur de mémoire peut mettre l'onglet en veille.

### Réglages des radios

| TRX | Réglages | Port à choisir | Vitesse |
|---|---|---|---|
| **FTX-1** | Operation setting → General : CAT-1 RATE 38400, CAT-1 CAT-3 STOP BIT 1bit, RPTT SELECT OFF | Enhanced COM Port (CAT-1) | 38400 |
| **FTDX10** | Operation setting → General : CAT RATE 38400, RPTT SELECT OFF | Enhanced COM Port | 38400 |
| **IC-7300** | MENU → SET → Connectors → CI-V : USB Baud Rate 115200, Address 94h, USB Echo Back OFF ; USB SEND et USB Keying OFF | port USB de l'IC-7300 | 115200 |

Aucun autre logiciel (WSJT-X, log…) ne doit utiliser le port CAT en même temps.

### Audio : faire entendre le TRX aux membres
1. Le TRX est relié en USB : sa carte son intégrée apparaît dans Windows (souvent « USB Audio CODEC »).
2. Page Station → cadre **« Audio du TRX »** → **« Activer l'audio »**. La première fois, Chrome demande l'accès au micro : répondre **Autoriser** (c'est l'entrée son du TRX, pas un micro).
3. Choisir l'**entrée son** du TRX dans la liste. La barre de niveau doit bouger avec la BF ; régler le niveau de sortie USB dans le menu du TRX si elle est trop faible ou toujours au maximum.
4. Le son n'est envoyé que si au moins un membre écoute ou regarde la fenêtre FT8 · FT4 (12 kHz, 192 kbit/s depuis le club ; 96 kbit/s vers chaque écouteur).

Après un redémarrage, la page réactive l'audio toute seule. Si elle affiche « Audio en pause », un clic n'importe où sur la page suffit ; pour éviter ce clic, ajouter `--autoplay-policy=no-user-gesture-required` au raccourci de démarrage de Chrome.

### Changer de TRX
- **Au club** : page Station → Réglages → « Modèle du TRX ». La première fois pour un modèle, choisir son port ; ensuite il est mémorisé.
- **À distance (administrateurs)** : sur https://remote.op0p.be, cliquer sur **STATION** en haut à gauche → choisir le TRX. Possible seulement si le TRX est branché au PC du club, que son port a déjà été choisi une fois au club, et jamais pendant une émission.

---

## Pour les membres

Manuel complet : bouton **HELP** du dashboard, ou https://remote.op0p.be/aide (français) et https://remote.op0p.be/help (English). Sources : `public/aide.html`, `public/help.html` — à tenir à jour avec chaque nouvelle fonction.


1. Aller sur https://remote.op0p.be, se connecter avec **son indicatif** et **son mot de passe**.
2. **Prendre la main** (une seule personne pilote à la fois). Si quelqu'un l'a déjà : **Demander la main** dans le cadre Opérateurs, ou lui écrire un message.
3. Accorder : molette ou glisser sur les chiffres, flèches ↑ ↓, touches de bande et de mode. **PTT** : bouton ou barre d'espace (maintenir).
4. **Écouter** : cadre RX AUDIO → « 🔊 Écouter le TRX », réglage du volume juste en dessous. Tout le monde peut écouter, même sans avoir la main (écouteurs ONL compris).
5. **Libérer la main** en partant.

**Disposition** : sur un écran 1920 × 1080 ou plus, tout tient sur un seul écran. Chaque cadre a un bouton **⧉** (en haut à droite) qui l'ouvre dans sa propre fenêtre, à placer où l'on veut (2e écran…) ; « Ramener » le remet dans le dashboard. La disposition est retenue : si Chrome autorise les fenêtres pop-up pour remote.op0p.be, les fenêtres se rouvrent à leur place au chargement suivant.
6. **FT8 · FT4** : onglet au centre de la page. Cascade 0–3000 Hz, « Activité de bande » (tous les messages décodés, CQ en vert, messages avec ON5VL / OR0L en rouge) et « Fréquence RX ». Split comme dans WSJT-X : **clic gauche** sur la cascade ou sur une ligne = fréquence de **réception** (vert), **clic droit** = fréquence d'**émission** (rouge) ; boutons « TX ← RX » et « RX ← TX ». Un clic sur **FT8** ou **FT4** met le TRX sur la fréquence d'appel de ce mode dans sa bande, en DATA-U ; « QSY » va sur la fréquence choisie dans la liste (il faut avoir la main dans les deux cas). Le bouton **⧉** à droite des onglets ouvre les modes numériques dans une **fenêtre séparée** (à placer sur un 2e écran) ; l'onglet **Synchro** montre l'heure du serveur, l'écart de votre PC et le calage des DT. Le décodage se fait sur le serveur, à l'heure du VPS : l'heure du PC du club n'a pas d'importance. L'émission FT8 / FT4 et RTTY (indicatif ON5VL) arrive dans une prochaine version.
7. **RTTY** : onglet RTTY, régler shift et vitesse (170 Hz / 45,45 bauds par défaut), cliquer sur le signal dans la cascade (les repères jaune = Mark et bleu = Space doivent tomber sur ses deux traces ; sinon « Inversé »). Le texte reçu défile à gauche ; à droite, le correspondant (double-clic sur un indicatif reçu) et les macros préparent le texte à émettre.
8. **WSPR** : onglet WSPR, choisir la bande dans la liste (le TRX y va). Toutes les 2 minutes, une dizaine de secondes après la minute paire, la liste des stations entendues se complète : indicatif, locator, puissance, fréquence, dérive et distance (si `stationGrid` est réglé).
9. **JT65** : onglet JT65, même fenêtre que FT8 (le TRX va sur la fréquence JT65 de sa bande, en DATA-U). Décodage vers la 52e seconde de chaque minute.
10. **JTTY** : onglet JTTY, choisir la bande (le TRX va sur la fréquence JTTY, en DATA-U). Pas de périodes : le texte de chaque message apparaît au fil des trames de 1,9 s (▌ = en cours). Clic gauche = réception, clic droit = émission, double-clic = correspondant ; macros F1 à F8 (clic droit pour les modifier).
11. **CW** : onglet CW, choisir la bande (le TRX va en CW). Cliquer sur un signal dans la cascade : le décodeur s'y cale tout seul (repère jaune) et apprend la vitesse. Filtre 100 Hz par défaut (50 Hz si QRM, 200–400 Hz si l'on cherche) ; silencieux à monter si des lettres apparaissent sur le bruit. Double-clic sur un indicatif reçu = correspondant ; macros F1 à F12.
12. **SSTV** : onglet SSTV, choisir la bande (14 230 kHz…). Les images arrivent toutes seules (code VIS) et s'affichent ligne après ligne ; la galerie garde les 12 dernières, « PNG » enregistre l'image affichée. À droite : choisir une image de votre PC (ou la carte CQ), écrire le texte (balises <CALL>, <MYCALL>, <RST>…), choisir le mode ; « Écouter » / « WAV » pour essayer (l'émission viendra plus tard).

Automatique : main libérée après 15 min sans action, déconnexion après 15 min d'inactivité (avertissement une minute avant, bouton « Rester connecté »). **Jamais pendant une émission.**

---

## Sécurités d'émission (résumé)

- **TRX bloqué en émission** : la page Station (au club, même sans liaison avec le VPS) repasse le TRX en réception s'il émet **2 min sans modulation**, ou **5 min sans interruption**, quelle qu'en soit la cause (PTT ou micro bloqué au club…). Nouvel essai toutes les 10 s si la radio reste bloquée. Réglable : `txSilenceSeconds`, `txHardMaxSeconds`.
- **Protection du PA (ROS)** : si le ROS dépasse **2,5:1** pendant 0,7 s en émission, l'émission est coupée. Le PTT reste ensuite refusé sur cette fréquence (±25 kHz) jusqu'à un **accord (TUNE)**. Réglable dans `config.json` : `maxSwr` (0 = pas de protection) et `swrHoldMs`. Après chaque changement de bande, le dashboard rappelle de faire TUNE.

- Émission seulement dans les bandes autorisées (`txRanges`), contrôlée sur la fréquence réellement émise (VFO B en SPLIT, XIT compris).
- Durée maximale d'émission : 120 s, puis coupure (relâcher le PTT avant de réémettre).
- Coupure immédiate si le membre perd la liaison, si le PC du club perd internet, ou si la page Station se ferme.
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
| `lib/` | WebSocket minimal, mots de passe, décodeur FT8/FT4 (`ftx.wasm`, `ftx.js`), démodulateur RTTY (`rtty.js`), décodeur CW (`cw.js`), décodeur SSTV (`sstv-dec.js`) et galerie (`sstv-store.js`), fil de décodage (`digi-worker.js`) — aucune dépendance npm |
| `native/ftx/` | Source et script de compilation du décodeur WebAssembly (ft8_lib) |
| `native/wsjtx/` | Script de compilation des décodeurs de WSJT-X en programmes Linux autonomes (`lib/bin/jt65`, `lib/bin/jttyd` ; source de `jttyd` : `jttyd.c`), sans FFTW (`fftw_kiss.c`) |
| `native/wspr/` | Sources de wsprd (WSJT-X, GPL v3) et script de compilation de `lib/wsprd.wasm` |
| `public/js/digi.js` | Onglets du centre : FT8 · FT4, RTTY, WSPR, JT65, JTTY, CW, SSTV, Synchro |
| `public/js/sstv.js` | Modes SSTV et codeur (image → signal), communs au serveur et au navigateur |
| `public/index.html`, `public/js/app.js`, `public/css/` | Page des membres |
| `public/station.html`, `public/js/station.js`, `public/js/station-core.js` | Page Station (Web Serial) |
| `public/js/yaesu.js`, `ftx1.js`, `ftdx10.js`, `ic7300.js` | Pilotes des TRX |
| `adduser.js`, `importusers.js`, `init-config.js` | Gestion des membres et de la configuration |
| `deploy/` | Service systemd et site nginx |
| `LISEZMOI.md` | Guide complet |
| `TIERS.md` | Licences des éléments repris (RigPlane Core et ft8_lib, MIT ; wsprd de WSJT-X, GPL v3 ; police Roboto Mono, OFL) |
