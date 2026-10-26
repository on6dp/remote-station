# Remote Station — v0.23.4 (CAT + écoute de la BF)

Pilotage à distance d'un transceiver du club depuis un navigateur, via le VPS VEX (`remote.op0p.be`).
Quatre modèles sont pris en charge : **Yaesu FTX-1**, **Yaesu FTDX10**, **Yaesu FTDX101D / MP** et **Icom IC-7300**. Un seul est branché à la fois ; on choisit lequel sur la page Station du club, et la face avant des membres s'adapte toute seule.

Cette version gère : fréquence (VFO A et B), mode, S-mètre, puissance, PTT, les fonctions du transceiver (voir ci-dessous), comptes par indicatif, une seule personne aux commandes, journal des accès. **La BF du TRX est relayée aux membres (écoute). Émission FT8 / FT4 / FT2 (v0.16) : le signal est fabriqué et joué par la page Station sur la carte son du TRX ; le micro des membres vers le TRX est encore à faire.**

## Comment ça marche

```
 TRX ────USB──► PC du club (Chrome)          VPS VEX 57.131.159.97            Membre (navigateur)
  CAT / CI-V   page https://remote.op0p.be/station ─wss──► nginx ─► Node :9000 ◄──wss── https://remote.op0p.be
               (Web Serial, sortant seulement)                (comptes, PTT, journal)
```

- Le PC du club **se connecte vers** le VPS : aucun port à ouvrir au club, le CGNAT n'est pas un problème.
- Le VPS n'a besoin d'**aucun paquet npm** : uniquement Node.js (modules natifs).
- L'application écoute seulement sur `127.0.0.1:9000` ; nginx fait le relais en HTTPS.

## Face avant

La page opérateur reprend la disposition de l'interface de RigPlane Core (licence MIT) :
- au centre, **deux écrans VFO** côte à côte, MAIN (A) et SUB (B). Celui qui émet passe en rouge, ce qui rend le SPLIT immédiatement lisible ;
- entre les deux, la colonne **DUAL** : VFO active, A → B, B → A, A ⇄ B, SPLIT, RIT, XIT, LOCK ;
- à gauche : RF front end, modes, filtre ; à droite : audio, DSP, TX (PTT, puissance), opérateurs ;
- en bas, les **mesures de la station** : Po, SWR, ALC, Id, Vd, COMP, S ;
- à la place du spectre (non transmis par la liaison CAT) : l'accord (pas, bandes, aller à) et le **journal d'activité** en direct.

## Fonctions du transceiver

Les réglages affichés sont générés à partir du pilote de la radio connectée : les touches de mode, les bandes et les réglages changent selon le modèle. Pour le FTX-1 :

- **VFO et SPLIT** : SPLIT, VFO active, A ⇄ B, A → B, B → A, RIT, XIT et décalage, LOCK de la face avant du club.
- **Filtres et DSP** : WIDTH (selon le mode), NARROW, IF SHIFT, CONTOUR, APF (en CW), DNF, NOTCH et sa fréquence, NB, DNR.
- **Réception** : AF, RF, squelch, AGC, préampli (IPO/AMP1/AMP2, jusqu'à 54 MHz), ATT (jusqu'à 60 MHz).
- **Émission** : gain micro, processeur et niveau, VOX, tuner et TUNE.

Différences des autres modèles :
- **FTDX10** : mêmes fonctions, avec ATT 6/12/18 dB, NB et DNR en interrupteur + niveau, puissance 5–100 W, couverture jusqu'à 75 MHz (pas de 2 m ni 70 cm).
- **FTDX101D / MP** : deux récepteurs complets (MAIN = VFO A, SUB = VFO B) : DUAL RX par FR, réglages du côté SUB directement (ATT, IPO / AMP, NB, DNR, NOTCH, DNF, NARROW, WIDTH, SHIFT, CONTOUR, APF, AGC, RF) ; ATT 6/12/18 dB ; antennes ANT 1 / 2 / 3 ; puissance 5–100 W (D) ou 5–200 W (MP, reconnu tout seul par le CAT) ; SPLIT normal (ST) ; RIT / XIT par RT / XT ; couverture jusqu'à 75 MHz avec la bande 4 m (70 MHz).
- **IC-7300** : modes LSB, USB, CW, CW-R, RTTY, RTTY-R, AM, FM et les modes DATA (USB-D…) ; filtres FIL1/FIL2/FIL3 et PBT intérieur/extérieur à la place de WIDTH/SHIFT ; NB, NR, NOTCH manuel (position) et AUTO NOTCH ; ATT 20 dB, P.AMP1/2, AGC FAST/MID/SLOW ; COMP ; tuner et TUNE ; RIT/XIT (ΔTX). Pas de B → A ni de choix de la VFO active (l'IC-7300 ne les donne pas par CI-V) : la VFO A de l'écran est la VFO sélectionnée sur la radio.

La VFO B s'accorde aussi : cliquez sur la ligne SUB de l'écran, et le bouton, les touches de mode et de bande et « Aller à » agissent alors sur B. En émission, l'écran affiche la puissance relative, le SWR et l'ALC.

Règles de sécurité propres à ces fonctions :
- **SPLIT et XIT** : le contrôle des bandes autorisées porte sur la fréquence réellement émise (VFO B en SPLIT, décalage XIT compris).
- **TUNE** est une émission : il obéit aux mêmes règles que le PTT (main, bandes, puissance, licence) et il est journalisé.
- **VOX** : on peut le couper à distance, jamais l'activer. S'il est actif au club, le PTT est refusé.
- Aucun réglage n'est accepté pendant une émission.

### Modèles de transceivers

Sur la page Station, la liste « Modèle du TRX » propose les transceivers pris en charge : **Yaesu FTX-1**, **Yaesu FTDX10**, **Yaesu FTDX101D / MP** et **Icom IC-7300**. Choisir un modèle recharge la page avec son pilote ; la vitesse série est mémorisée pour chaque modèle (38400 bps pour les Yaesu, 115200 pour l'IC-7300). Les membres voient le nom du TRX connecté en haut de leur page, et leurs touches s'adaptent.

Les pilotes FTDX10, FTDX101D / MP et IC-7300 sont écrits d'après les manuels CAT/CI-V et testés sur des radios simulées : faites le premier essai réel en réception seule, puis l'émission sur charge fictive, comme pour le FTX-1.

Les Icom IC-705, IC-7610, IC-9700, les Xiegu X6100 et X6200 et le Lab599 TX-500 restent listés comme « prévu ». Le serveur refuse une station qui annonce un modèle sans pilote.

## Accès et puissance selon la licence

- **Connexion** : seuls les indicatifs belges sont acceptés (préfixes `ON`, `OO`, `OP`, `OQ`, `OR`, `OS`, `OT`), à la connexion comme à la création d'un compte avec `adduser.js`.
- **Écouteurs (ONL)** : les indicatifs d'écouteur, comme `ONL12345`, peuvent se connecter et régler la réception quand ils ont la main, mais ne peuvent **jamais émettre** : ni PTT, ni TUNE, ni réglage de puissance, même si leur compte a été créé sans `--no-tx`. Liste modifiable avec `rxOnlyPrefixes` dans `config.json`.
- **Puissance** : les indicatifs commençant par `ON3` sont limités à **25 W**, tous les autres à **1500 W**. Concrètement, les trois TRX du club ne dépassent pas 100 W (le FTX-1 : 100 W avec l'ampli SPA-1, 10 W avec la tête Field seule), donc seule la limite ON3 agit sur la radio :
  - à la prise de main par un ON3, la puissance du TRX est ramenée à 25 W ;
  - un ON3 ne peut pas régler plus de 25 W ;
  - si la puissance dépasse la limite de l'opérateur en émission (bouton tourné au club, par exemple), l'émission est coupée et la puissance ramenée à la limite ;
  - le PTT est refusé tant que la puissance du TRX n'a pas été lue.
- **Déconnexion pour inactivité** : un membre qui ne fait rien pendant **15 minutes** est déconnecté. Une minute avant, sa page affiche un avertissement avec un bouton « Rester connecté ». Toute action (accord, réglage, PTT) compte comme activité. **Aucune déconnexion ni libération de la main n'a lieu tant que le TRX est en émission** : l'échéance est reportée à la fin de l'émission, toujours précédée de l'avertissement. Réglable avec `sessionIdleMinutes` (0 = jamais). La main se libère aussi après 15 min sans action (`controlIdleMinutes`).
- **Messages et demande de main** : le cadre Opérateurs contient une discussion entre les connectés (300 caractères par message, un message par seconde au plus). Quand quelqu'un a la main, les autres voient « Demander la main à … » ; celui qui pilote reçoit la demande et peut cliquer « Passer la main à … » (pas pendant une émission). Les messages sont gardés en mémoire (40 derniers, effacés au redémarrage du serveur) et notés dans le journal des accès.
- **Main par onglet** : la main appartient à l'onglet où on l'a prise. Si un membre a plusieurs onglets ou appareils ouverts, les autres affichent « Prendre la main ici ». Après une coupure (redémarrage du serveur, réseau), l'onglet qui avait la main la reprend automatiquement si personne ne l'a prise entre-temps.
- Ces règles se modifient dans `config.json` : `allowedPrefixes`, `rxOnlyPrefixes`, `powerRules` (la première règle dont le préfixe correspond s'applique) et `defaultMaxWatts`. Sans ces lignes, les valeurs ci-dessus s'appliquent par défaut.
- **Ampli linéaire** : la limite porte sur la puissance réglée dans le TRX. Si un ampli externe est branché après le TRX, le logiciel ne le voit pas : il doit être hors circuit quand un ON3 opère.

## Sécurités d'émission

| Situation | Réaction |
|---|---|
| Le membre ne maintient plus le PTT (réseau coupé, onglet fermé) | TX0 après 1,5 s |
| Émission trop longue | TX0 après `maxTxSeconds` (120 s par défaut) ; il faut relâcher puis réappuyer |
| Le PC du club ne reçoit plus le VPS pendant l'émission | TX0 après 2 s (côté station) |
| La liaison VPS ↔ club tombe | TX0 immédiat (côté station) |
| La radio est en « CAT TX » sans demande (ex. rechargement de page) | TX0 automatique |
| Fréquence hors des plages `txRanges` | PTT refusé, ou coupé si on sort de bande |
| Puissance au-delà de la licence de l'opérateur | PTT refusé, ou coupé, et puissance ramenée à la limite |
| Changement de fréquence/mode pendant l'émission | refusé |

L'émission est **désactivée par défaut** (`"allowTx": false`). On l'active seulement après les essais sur charge fictive.

## 1. Installation sur le VPS VEX

Copie `remote-station-0.23.4.tar.gz` dans `/home/on6dp` avec WinSCP, puis dans PuTTY :

```bash
# Node.js (Debian 13 fournit la version 20, ça suffit)
sudo apt update && sudo apt install -y nodejs
node -v

# Fichiers + utilisateur système dédié
sudo tar -xzf /home/on6dp/remote-station-0.23.4.tar.gz -C /opt
sudo useradd --system --home /opt/remote-station --shell /usr/sbin/nologin remotestation
sudo chown -R remotestation:remotestation /opt/remote-station
cd /opt/remote-station

# Configuration : crée config.json et affiche le JETON DE LA STATION (à noter)
sudo -u remotestation node init-config.js
sudo nano config.json        # clubName, stationCall ; laisser "allowTx": false pour l'instant

# Membres (mot de passe demandé, 8 caractères minimum)
sudo -u remotestation node adduser.js ON6DP --admin
sudo -u remotestation node adduser.js ON4XXX            # membre normal
sudo -u remotestation node adduser.js ON3YYY --no-tx    # écoute et réglages seulement
sudo -u remotestation node adduser.js --list

# Service
sudo cp deploy/remote-station.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now remote-station
sudo systemctl status remote-station --no-pager
```

### Créer tous les comptes du club en une fois

Mettez la liste des indicatifs dans un fichier texte, un par ligne (par exemple `membres.txt`, copié dans `/home/on6dp` avec WinSCP), puis :

```bash
sudo install -m 644 /home/on6dp/membres.txt /tmp/membres.txt
cd /opt/remote-station && sudo -u remotestation node importusers.js /tmp/membres.txt
sudo mv /opt/remote-station/comptes-*.csv /home/on6dp/ && sudo chown on6dp: /home/on6dp/comptes-*.csv
```

- Chaque nouveau compte reçoit un mot de passe aléatoire, du type `K7QPM-H3XWA`.
- Les comptes existants ne sont pas modifiés (option `--reset` pour leur donner un nouveau mot de passe).
- Le fichier `comptes-AAAA-MM-JJ.csv` (indicatif ; mot de passe ; droits) s'ouvre dans Excel : remettez à chaque membre son mot de passe, puis **supprimez le fichier** du VPS et de votre PC.
- Pas besoin de redémarrer le service : les comptes sont lus à chaque connexion.

### nginx + certificat

```bash
sudo cp deploy/remote.op0p.be.nginx /etc/nginx/sites-available/remote.op0p.be
sudo ln -s /etc/nginx/sites-available/remote.op0p.be /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d remote.op0p.be
```

Le HTTPS est **obligatoire** : Chrome n'autorise le Web Serial que sur une page sécurisée.

Test immédiat : ouvre `https://remote.op0p.be/station`, colle le jeton, clique « Enregistrer et reconnecter », puis « Tester sans radio ». Dans un autre onglet, connecte-toi sur `https://remote.op0p.be` : tu pilotes le TRX virtuel du modèle choisi.

## 2. Au club : PC de la station

**Navigateur** : Chrome, Edge ou Chromium (Firefox et Safari ne gèrent pas le Web Serial).

**Accès réservé** (v0.14.1) : https://remote.op0p.be/station demande l'indicatif et le mot de passe d'un **administrateur**
(compte créé avec `adduser.js … --admin` ; `node adduser.js --list` montre qui l'est). Le PC reste autorisé un an, jusqu'à
« Se déconnecter ». Le jeton de la station reste nécessaire pour brancher le TRX.

Choisir d'abord le **modèle du TRX** branché dans « Réglages » (FTX-1, FTDX10, FTDX101D / MP ou IC-7300). La page rappelle les réglages de la radio correspondants.

**FTX-1** (firmware MAIN 1.08 ou plus récent, exigé pour le CAT) :
- Operation setting → General → **CAT-1 RATE : 38400**
- Operation setting → General → **CAT-1 CAT-3 STOP BIT : 1bit**
- RPTT SELECT laissé sur **OFF** (la page met de toute façon RTS/DTR au repos)

**Windows** : installer le pilote « Virtual COM port » de Yaesu. Le FTX-1 crée deux ports : il faut choisir **Enhanced COM Port** (CAT-1), pas Standard.

**FTDX10** :
- Operation setting → General → **CAT RATE : 38400** (ou la vitesse choisie sur la page)
- RPTT SELECT laissé sur **OFF**
- Windows : pilote « Virtual COM port » de Yaesu ; choisir le port **Enhanced COM Port**.

**FTDX101D / MP** :
- OPERATION SETTING → GENERAL → **CAT RATE : 38400** (ou la vitesse choisie sur la page)
- RPTT SELECT laissé sur **OFF**
- Windows : pilote « Virtual COM port » de Yaesu ; choisir le port **Enhanced COM Port**.

**IC-7300** :
- MENU → SET → Connectors → CI-V : **CI-V USB Baud Rate : 115200**, **CI-V Address : 94h**, **CI-V USB Echo Back : OFF**
- MENU → SET → Connectors : **USB SEND** et **USB Keying (CW/RTTY)** sur **OFF**
- Windows : pilote USB Icom (Silicon Labs CP210x) ; l'IC-7300 crée un seul port COM.

**Raspberry Pi / Linux** : `sudo usermod -aG dialout $USER` puis redémarrer la session. Dans `ls -l /dev/serial/by-id/`, le port qui finit par `-if00` est en général le port Enhanced.

**Aucun autre logiciel** (WSJT-X, logiciel de log…) ne doit utiliser le port CAT en même temps.

Mise en route :
1. Ouvrir `https://remote.op0p.be/station`, coller le jeton, « Enregistrer et reconnecter ».
2. « Choisir le port du TRX » → le port de la radio. Le journal doit afficher « Yaesu FTX-1 répond » (ou FTDX10, IC-7300).
3. Dans Chrome : Paramètres → Performances → « Toujours garder ces sites actifs » → ajouter `remote.op0p.be` (sinon l'économiseur de mémoire peut endormir l'onglet).
4. L'autorisation du port est mémorisée : au prochain démarrage, la page rouvre le port toute seule.

**Changer de TRX** (au club, sur le PC de la station) :
1. Prévenir les membres : pendant le changement, la station est hors ligne quelques secondes (une émission en cours est coupée).
2. Brancher le câble USB du nouveau TRX (ou le laisser branché en permanence : les trois peuvent rester reliés au PC).
3. Page Station → Réglages → « Modèle du TRX » : choisir le modèle. La page se recharge avec le bon pilote et la bonne vitesse.
4. La première fois pour ce modèle, cliquer « Choisir le port du TRX » et prendre le port de cette radio. Le port est ensuite mémorisé **par modèle** : les fois suivantes, il suffit de choisir le modèle.
5. Le journal doit afficher « … répond » avec le nom du nouveau TRX. Les membres n'ont rien à faire : leur page affiche le nouveau modèle et s'adapte.

**Changer de TRX à distance** (administrateurs seulement, par exemple ON6DP) : en haut à gauche de la page opérateur, les trois TRX sont affichés et celui en service est coché (✓). Un administrateur clique sur **STATION** : un menu propose les TRX dont le port a déjà été choisi une fois au club. Après confirmation, la page Station du club se recharge avec l'autre pilote et rouvre le port de cette radio ; la main est conservée. Le changement est refusé pendant une émission, et noté dans le journal d'activité. Les deux radios doivent rester branchées au PC du club.

**Audio : faire entendre le TRX aux membres**
1. Le TRX est relié en USB : sa carte son intégrée apparaît dans Windows (souvent « USB Audio CODEC »).
2. Page Station → cadre **« Audio du TRX »** → **« Activer l'audio »**. La première fois, Chrome demande l'accès au micro : répondre **Autoriser** (c'est l'entrée son du TRX, pas un micro).
3. Choisir l'**entrée son** du TRX dans la liste. La barre de niveau doit bouger avec la BF ; régler le niveau de sortie USB dans le menu du TRX si elle est trop faible ou toujours au maximum.
4. Le son n'est envoyé que si au moins un membre écoute (64 kbit/s par écouteur, qualité « téléphone » 8 kHz).

Après un redémarrage, la page réactive l'audio toute seule. Si elle affiche « Audio en pause », un clic n'importe où sur la page suffit ; pour éviter ce clic, ajouter `--autoplay-policy=no-user-gesture-required` au raccourci de démarrage de Chrome.

**Démarrage automatique** :
- Windows : raccourci dans `shell:startup` vers
  `"C:\Program Files\Google\Chrome\Application\chrome.exe" --autoplay-policy=no-user-gesture-required --app=https://remote.op0p.be/station`
  et désactiver la mise en veille du PC.
- Raspberry Pi : lancer `chromium --app=https://remote.op0p.be/station` au démarrage de la session graphique.

## 3. Activer l'émission

1. Essais sur **charge fictive**, en présence d'un membre au club : PTT, relâchement, débranchement du câble réseau du PC du club pendant l'émission, fermeture de l'onglet du membre pendant l'émission.
2. Si le menu du TRX propose un temporisateur d'émission (TOT), le régler : c'est la dernière sécurité si le PC du club plante en pleine émission.
3. Vérifier les plages `txRanges` de `config.json` par rapport à la licence de la station du club (IBPT). Les valeurs fournies sont celles de la Région 1 IARU, **à valider**.
4. Mettre `"allowTx": true` puis `sudo systemctl restart remote-station`.

## Logs online (carnet de trafic, v0.14)

Onglet « Logs online » du dashboard : carnet de la station, envois LoTW / eQSL / Club Log / QRZ.com, export ADIF et Cabrillo, UDP vers les
logbooks du PC. Mode d'emploi : manuel, section 14 (`/aide#logs`). Côté serveur :

- Le carnet est dans `logs/logbook.json`, les réglages des services (mots de passe, clés API) dans `logs/logbook-config.json` (droits 600).
  Ni l'un ni l'autre ne doit être publié ; ils sont gardés lors des mises à jour. Les mots de passe ne sont jamais renvoyés aux navigateurs.
- Seuls les **administrateurs** (`adduser.js … --admin`) ouvrent la configuration et lancent les synchronisations ; tous les membres
  (sauf les écouteurs ONL) enregistrent des QSO, et modifient ou suppriment les leurs.
- **LoTW** : le certificat de l'indicatif reste sur le PC où TQSL est installé. Si le serveur tourne sur ce PC (installateur Windows, partie
  Serveur), Remote Station appelle TQSL lui-même. Sur le VPS (sans certificat) : « Exporter pour TQSL (.adi) » dans Synchronisation LoTW,
  signer le fichier avec TQSL sur le PC du club, puis « Marquer comme envoyés ».
- **UDP** : les paquets partent du serveur. Pour Swisslog / N1MM sur le PC du club, le serveur doit tourner sur ce PC (adresse 127.0.0.1),
  sinon le PC doit être joignable depuis le VPS (redirection de port UDP).
- Le service systemd doit pouvoir écrire dans `/opt/remote-station` (sessions, macros, images SSTV) : depuis la v0.14, le fichier
  `deploy/remote-station.service` le permet (`ReadWritePaths=/opt/remote-station`). Après une mise à jour :
  `sudo cp deploy/remote-station.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl restart remote-station`.

## Journal des accès

`/opt/remote-station/logs/access-AAAA-MM.log`, une ligne JSON par événement : connexions, échecs de connexion, prise et libération de la main, début et fin d'émission (indicatif, IP, fréquence, mode, durée, raison de la coupure).

```bash
sudo grep tx_start /opt/remote-station/logs/access-$(date +%Y-%m).log | tail
```

## Fichiers

| Fichier | Rôle |
|---|---|
| `server.js` | Serveur VPS : comptes, contrôle, PTT, relais, journal |
| `lib/ws-lite.js` | Serveur WebSocket minimal, sans dépendance |
| `lib/auth.js` | Mots de passe (scrypt) |
| `public/js/yaesu.js` | Base commune des pilotes CAT Yaesu |
| `public/js/ftx1.js`, `public/js/ftdx10.js` | Pilotes FTX-1 et FTDX10 (différences par rapport à la base, radio virtuelle pour les tests) |
| `public/js/ic7300.js` | Pilote CI-V de l'IC-7300 (trames binaires, radio virtuelle pour les tests) |
| `public/js/rigs-catalog.js` | Liste des modèles proposés sur la page Station |
| `TIERS.md` | Sources et licences de tiers (RigPlane Core, MIT) |
| `public/js/station-core.js` | Logique de la page Station (polling, sécurités) |
| `public/station.html`, `public/js/station.js` | Page Station (Web Serial) |
| `public/index.html`, `public/js/app.js`, `public/css/rp.css`, `public/css/rp-tokens.css` | Face avant des membres |
| `public/css/panel.css` | Styles de la page Station |
| `public/fonts/` | Police Roboto Mono (SIL OFL) |
| `adduser.js`, `importusers.js`, `init-config.js` | Gestion des membres (un par un ou en une fois) et de la configuration |
| `lib/logbook.js`, `lib/logsync.js` | Carnet de trafic (ADIF, Cabrillo) et envois LoTW / eQSL / Club Log / QRZ / UDP |
| `public/js/logbook.js` | Onglet « Logs online » du dashboard |
| `deploy/` | Service systemd et site nginx |

## Suite prévue

- **v0.2 — audio RX (fait)** : BF du TRX captée sur sa carte son USB par la page Station, relayée par le VPS à tous les membres qui écoutent.
- **v0.16 – v0.17 — émission FT8 / FT4 / FT2 (fait)** : clic sur Tx1 à Tx7 = émission automatique avec séquence comme WSJT-X ; sortie son de la page Station vers la carte son USB du TRX.
- **Ensuite** : émission RTTY, JTTY, SSTV, CW (manipulateur du TRX) ; micro du membre vers le TRX pendant le PTT.
- **v0.3** : réservation de créneaux, mesures en émission (puissance, ROS, ALC), plages d'émission par membre selon sa classe de licence.
