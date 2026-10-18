# Remote Station UBA-LGE — ON5VL / OR0L

Pilotage à distance des transceivers du club depuis un navigateur.

- **Site des membres** : https://remote.op0p.be
- **Page Station (PC du club)** : https://remote.op0p.be/station
- **Serveur** : VPS VEX `57.131.159.97`, dossier `/opt/remote-station`, service `remote-station` (port local 9000, derrière nginx)
- **TRX pris en charge** : Yaesu FTX-1, Yaesu FTDX10, Icom IC-7300 (un seul branché à la fois)

```
 TRX ──USB──► PC du club (Chrome, page /station) ──internet──► VPS remote.op0p.be ◄── membres (navigateur)
```

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

### Réglages des radios

| TRX | Réglages | Port à choisir | Vitesse |
|---|---|---|---|
| **FTX-1** | Operation setting → General : CAT-1 RATE 38400, CAT-1 CAT-3 STOP BIT 1bit, RPTT SELECT OFF | Enhanced COM Port (CAT-1) | 38400 |
| **FTDX10** | Operation setting → General : CAT RATE 38400, RPTT SELECT OFF | Enhanced COM Port | 38400 |
| **IC-7300** | MENU → SET → Connectors → CI-V : USB Baud Rate 115200, Address 94h, USB Echo Back OFF ; USB SEND et USB Keying OFF | port USB de l'IC-7300 | 115200 |

Aucun autre logiciel (WSJT-X, log…) ne doit utiliser le port CAT en même temps.

### Changer de TRX
- **Au club** : page Station → Réglages → « Modèle du TRX ». La première fois pour un modèle, choisir son port ; ensuite il est mémorisé.
- **À distance (administrateurs)** : sur https://remote.op0p.be, cliquer sur **STATION** en haut à gauche → choisir le TRX. Possible seulement si le TRX est branché au PC du club, que son port a déjà été choisi une fois au club, et jamais pendant une émission.

---

## Pour les membres

1. Aller sur https://remote.op0p.be, se connecter avec **son indicatif** et **son mot de passe**.
2. **Prendre la main** (une seule personne pilote à la fois). Si quelqu'un l'a déjà : **Demander la main** dans le cadre Opérateurs, ou lui écrire un message.
3. Accorder : molette ou glisser sur les chiffres, flèches ↑ ↓, touches de bande et de mode. **PTT** : bouton ou barre d'espace (maintenir).
4. **Libérer la main** en partant.

Automatique : main libérée après 15 min sans action, déconnexion après 15 min d'inactivité (avertissement une minute avant, bouton « Rester connecté »). **Jamais pendant une émission.**

---

## Sécurités d'émission (résumé)

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
| Page Station : « Remplacée par une autre page Station » | Une autre page Station est ouverte ailleurs : la fermer, puis « Enregistrer et reconnecter ». |
| « Port ouvert, pas de réponse » | Mauvais port (essayer l'autre), mauvaise vitesse, ou autre logiciel sur le port. |
| Je n'ai pas la main alors que je suis connecté | La main appartient à un onglet : fermer les autres onglets ou cliquer « Prendre la main ici ». |

---

## Fichiers du projet

| Fichier | Rôle |
|---|---|
| `server.js` | Serveur : comptes, contrôle, PTT, sécurités, messages, journal |
| `lib/` | WebSocket minimal et mots de passe (aucune dépendance npm) |
| `public/index.html`, `public/js/app.js`, `public/css/` | Page des membres |
| `public/station.html`, `public/js/station.js`, `public/js/station-core.js` | Page Station (Web Serial) |
| `public/js/yaesu.js`, `ftx1.js`, `ftdx10.js`, `ic7300.js` | Pilotes des TRX |
| `adduser.js`, `importusers.js`, `init-config.js` | Gestion des membres et de la configuration |
| `deploy/` | Service systemd et site nginx |
| `LISEZMOI.md` | Guide complet |
| `TIERS.md` | Licences des éléments repris (RigPlane Core, MIT ; police Roboto Mono, OFL) |
