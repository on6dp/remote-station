# Remote Station — v0.1.4 (CAT seul)

Pilotage à distance du **Yaesu FTX-1** du club depuis un navigateur, via le VPS VEX (`remote.op0p.be`).

Cette version gère : fréquence (VFO A et B), mode, S-mètre, puissance, PTT, les fonctions du transceiver (voir ci-dessous), comptes par indicatif, une seule personne aux commandes, journal des accès. **L'audio (réception et micro) arrive en v0.2.**

## Comment ça marche

```
 FTX-1 ──USB──► PC du club (Chrome)          VPS VEX 57.131.159.97            Membre (navigateur)
  CAT-1        page https://remote.op0p.be/station ─wss──► nginx ─► Node :9000 ◄──wss── https://remote.op0p.be
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
- à la place du spectre (non transmis par le CAT du FTX-1) : l'accord (pas, bandes, aller à) et le **journal d'activité** en direct.

## Fonctions du transceiver

La face avant a un panneau à quatre onglets, généré à partir du pilote de la radio :

- **VFO et SPLIT** : SPLIT, VFO active, A ⇄ B, A → B, B → A, RIT, XIT et décalage, LOCK de la face avant du club.
- **Filtres et DSP** : WIDTH (selon le mode), NARROW, IF SHIFT, CONTOUR, APF (en CW), DNF, NOTCH et sa fréquence, NB, DNR.
- **Réception** : AF, RF, squelch, AGC, préampli (IPO/AMP1/AMP2, jusqu'à 54 MHz), ATT (jusqu'à 60 MHz).
- **Émission** : gain micro, processeur et niveau, VOX, tuner et TUNE.

La VFO B s'accorde aussi : cliquez sur la ligne SUB de l'écran, et le bouton, les touches de mode et de bande et « Aller à » agissent alors sur B. En émission, l'écran affiche la puissance relative, le SWR et l'ALC.

Règles de sécurité propres à ces fonctions :
- **SPLIT et XIT** : le contrôle des bandes autorisées porte sur la fréquence réellement émise (VFO B en SPLIT, décalage XIT compris).
- **TUNE** est une émission : il obéit aux mêmes règles que le PTT (main, bandes, puissance, licence) et il est journalisé.
- **VOX** : on peut le couper à distance, jamais l'activer. S'il est actif au club, le PTT est refusé.
- Aucun réglage n'est accepté pendant une émission.

### Modèles de transceivers

La page Station propose une liste de modèles. Le **Yaesu FTX-1** est pris en charge. Les Icom IC-7300, IC-705, IC-7610, IC-9700, les Xiegu X6100 et X6200 et le Lab599 TX-500 sont listés comme « prévu » : leur pilote reste à écrire. Le serveur refuse une station qui annonce un modèle sans pilote.

## Accès et puissance selon la licence

- **Connexion** : seuls les indicatifs belges sont acceptés (préfixes `ON`, `OO`, `OP`, `OQ`, `OR`, `OS`, `OT`), à la connexion comme à la création d'un compte avec `adduser.js`.
- **Écouteurs (ONL)** : les indicatifs d'écouteur, comme `ONL12345`, peuvent se connecter et régler la réception quand ils ont la main, mais ne peuvent **jamais émettre** : ni PTT, ni TUNE, ni réglage de puissance, même si leur compte a été créé sans `--no-tx`. Liste modifiable avec `rxOnlyPrefixes` dans `config.json`.
- **Puissance** : les indicatifs commençant par `ON3` sont limités à **25 W**, tous les autres à **1500 W**. Concrètement, le FTX-1 ne dépasse pas 100 W (ampli SPA-1) ou 10 W (tête Field), donc seule la limite ON3 agit sur la radio :
  - à la prise de main par un ON3, la puissance du TRX est ramenée à 25 W ;
  - un ON3 ne peut pas régler plus de 25 W ;
  - si la puissance dépasse la limite de l'opérateur en émission (bouton tourné au club, par exemple), l'émission est coupée et la puissance ramenée à la limite ;
  - le PTT est refusé tant que la puissance du TRX n'a pas été lue.
- Ces règles se modifient dans `config.json` : `allowedPrefixes`, `rxOnlyPrefixes`, `powerRules` (la première règle dont le préfixe correspond s'applique) et `defaultMaxWatts`. Sans ces lignes, les valeurs ci-dessus s'appliquent par défaut.
- **Ampli linéaire** : la limite porte sur la puissance réglée dans le FTX-1. Si un ampli externe est branché après le TRX, le logiciel ne le voit pas : il doit être hors circuit quand un ON3 opère.

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

Copie `remote-station-0.1.4.tar.gz` dans `/home/on6dp` avec WinSCP, puis dans PuTTY :

```bash
# Node.js (Debian 13 fournit la version 20, ça suffit)
sudo apt update && sudo apt install -y nodejs
node -v

# Fichiers + utilisateur système dédié
sudo tar -xzf /home/on6dp/remote-station-0.1.4.tar.gz -C /opt
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

### nginx + certificat

```bash
sudo cp deploy/remote.op0p.be.nginx /etc/nginx/sites-available/remote.op0p.be
sudo ln -s /etc/nginx/sites-available/remote.op0p.be /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d remote.op0p.be
```

Le HTTPS est **obligatoire** : Chrome n'autorise le Web Serial que sur une page sécurisée.

Test immédiat : ouvre `https://remote.op0p.be/station`, colle le jeton, clique « Enregistrer et reconnecter », puis « Tester sans radio ». Dans un autre onglet, connecte-toi sur `https://remote.op0p.be` : tu pilotes le FTX-1 virtuel.

## 2. Au club : PC de la station

**Navigateur** : Chrome, Edge ou Chromium (Firefox et Safari ne gèrent pas le Web Serial).

**FTX-1** (firmware MAIN 1.08 ou plus récent, exigé pour le CAT) :
- Operation setting → General → **CAT-1 RATE : 38400**
- Operation setting → General → **CAT-1 CAT-3 STOP BIT : 1bit**
- RPTT SELECT laissé sur **OFF** (la page met de toute façon RTS/DTR au repos)

**Windows** : installer le pilote « Virtual COM port » de Yaesu. Le FTX-1 crée deux ports : il faut choisir **Enhanced COM Port** (CAT-1), pas Standard.

**Raspberry Pi / Linux** : `sudo usermod -aG dialout $USER` puis redémarrer la session. Dans `ls -l /dev/serial/by-id/`, le port qui finit par `-if00` est en général le port Enhanced.

**Aucun autre logiciel** (WSJT-X, logiciel de log…) ne doit utiliser le port CAT-1 en même temps.

Mise en route :
1. Ouvrir `https://remote.op0p.be/station`, coller le jeton, « Enregistrer et reconnecter ».
2. « Choisir le port du FTX-1 » → Enhanced COM Port. Le journal doit afficher « FTX-1 répond ».
3. L'autorisation du port est mémorisée : au prochain démarrage, la page rouvre le port toute seule.

**Démarrage automatique** :
- Windows : raccourci dans `shell:startup` vers
  `"C:\Program Files\Google\Chrome\Application\chrome.exe" --app=https://remote.op0p.be/station`
  et désactiver la mise en veille du PC.
- Raspberry Pi : lancer `chromium --app=https://remote.op0p.be/station` au démarrage de la session graphique.

## 3. Activer l'émission

1. Essais sur **charge fictive**, en présence d'un membre au club : PTT, relâchement, débranchement du câble réseau du PC du club pendant l'émission, fermeture de l'onglet du membre pendant l'émission.
2. Si le menu du FTX-1 propose un temporisateur d'émission (TOT), le régler : c'est la dernière sécurité si le PC du club plante en pleine émission.
3. Vérifier les plages `txRanges` de `config.json` par rapport à la licence de la station du club (IBPT). Les valeurs fournies sont celles de la Région 1 IARU, **à valider**.
4. Mettre `"allowTx": true` puis `sudo systemctl restart remote-station`.

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
| `public/js/ftx1.js` | Pilote CAT FTX-1 (commandes, réglages, FTX-1 virtuel pour les tests) |
| `public/js/rigs-catalog.js` | Liste des modèles proposés sur la page Station |
| `TIERS.md` | Sources et licences de tiers (RigPlane Core, MIT) |
| `public/js/station-core.js` | Logique de la page Station (polling, sécurités) |
| `public/station.html`, `public/js/station.js` | Page Station (Web Serial) |
| `public/index.html`, `public/js/app.js`, `public/css/rp.css`, `public/css/rp-tokens.css` | Face avant des membres |
| `public/css/panel.css` | Styles de la page Station |
| `public/fonts/` | Police Roboto Mono (SIL OFL) |
| `adduser.js`, `init-config.js` | Gestion des membres et de la configuration |
| `deploy/` | Service systemd et site nginx |

## Suite prévue

- **v0.2 — audio** : audio RX capté sur la carte son USB du FTX-1, relayé par le VPS (plusieurs membres peuvent écouter), micro du membre vers le TRX pendant le PTT.
- **v0.3** : réservation de créneaux, mesures en émission (puissance, ROS, ALC), plages d'émission par membre selon sa classe de licence.
