# Journal des versions — Remote Station UBA-LGE (ON5VL / OR0L)

## v0.9 — CW

- **0.9.0** — Onglet **CW** (à droite de JTTY), à la manière de FLDIGI : décodeur Morse sur le serveur (`lib/cw.js`, sans dépendance), un par réglage de membre. Clic sur la cascade = calage automatique sur le signal le plus proche (±60 Hz) ; filtre 50 / 100 / 200 / 400 Hz ; silencieux en dB au-dessus du bruit ; vitesse apprise toute seule (5 à 60 mots/min, affichée), y compris la manipulation à la main et les traits allongés ; suit le QSB ; signes ? / = + , . et abréviations <SK> <KN> <AS>… Indicateur de niveau avec voyant qui suit la manipulation. Fréquences CW par bande (QSY en CW-U / CW). Zone d'émission : macros CW F1 à F12 (touches du clavier, modifiables, aussi en bas de page), vitesse du manipulateur ; l'émission CW par le manipulateur du TRX arrive dans une prochaine version.

## v0.8 — JTTY

- **0.8.0** — Onglet **JTTY** (nouveau mode de WSJT-X 3.2 / 3.3 : 4-GFSK, 31,25 bauds, 127 Hz, trames de 1,9 s, émission à tout moment) à droite de JT65. Décodeur de réception en continu de WSJT-X 3.3 (GPL v3) compilé en programme Linux autonome (`lib/bin/jttyd`, processus séparé, ~15 % d'un cœur) : le texte de chaque message apparaît trame après trame (▌ = en cours, puis terminé). Fenêtre : fréquences d'appel JTTY par bande (QSY direct en DATA-U), cascade avec repères RX / TX (clic gauche / clic droit), « Activité JTTY » et « Fréquence RX » (±80 Hz ou messages avec ON5VL / OR0L), double-clic = correspondant ; zone d'émission avec les 8 macros JTTY de WSJT-X (F1 à F8, modifiables et gardées par membre), aussi en bas de page. La fenêtre séparée des modes numériques s'ouvre sur le mode affiché. L'émission JTTY arrive avec l'émission des modes numériques.

## v0.7 — écran large et cadres détachables

- **0.7.1** — Macros RTTY à la manière de FLDIGI : 12 macros F1 à F12 (touches du clavier dans l'onglet RTTY), modifiables (clic droit ou ✎ : nom, texte, balises <MYCALL> <CALL> <NAME> <QTH> <RST> <LOC> <MYLOC> <MYQTH> <OPCALL> <CNTR> <INCR> <ZT> <ZD>, aperçu, retour au défaut), gardées sur le serveur pour chaque membre ; macros CW modifiables de la même façon ; correspondant avec nom, QTH et RST ; Tx7 = texte libre FT8/FT4 ; cadre Opérateurs plus compact sur écran large.
- **0.7.0** — Écran large (1920 × 1080 et plus) : tout le dashboard tient sur un écran, en quatre colonnes (réglages · VFO et modes numériques · audio, DSP, accord, TX · opérateurs et messages pré-enregistrés) ; chaque colonne défile seule si besoin. Bouton **⧉** sur chaque cadre (RF front end, Mode, Filtre, Station meters, VFO, Step et bandes, RX audio, DSP, Accord, TX, Opérateurs, Messages) : le cadre s'ouvre dans sa propre fenêtre, tout y fonctionne (PTT et flèches compris), « Ramener » le remet en place ; disposition et position des fenêtres mémorisées.

## v0.6 — JT65

- **0.6.0** — Onglet **JT65** (JT65A, périodes d'une minute) : décodeur de WSJT-X (GPL v3) compilé en programme Linux autonome (`lib/bin/jt65`, lancé dans un processus séparé), décodage vers la 52e seconde ; même fenêtre que FT8 · FT4 (cascade, activité de bande, fréquence RX, split, double-clic pour répondre) ; fréquences JT65 par bande, l'onglet met le TRX sur la fréquence JT65 de sa bande. Correction : locator à 4 caractères dans les messages FT8/FT4.

## v0.5 — WSPR

- **0.5.0** — Fenêtre **WSPR** : décodage des périodes de 2 minutes sur le serveur avec wsprd de WSJT-X (K9AN / K1JT, GPL v3) compilé en WebAssembly, exécuté entièrement en mémoire. Liste des stations entendues : heure, dB, DT, fréquence réelle, dérive, indicatif, locator, puissance (dBm et W), distance depuis le locator de la station ; fréquences WSPR par bande (QSY direct) ; compte à rebours de la période.

## v0.4 — RTTY

- **0.4.2** — Choisir une bande dans les listes FT8 · FT4 et RTTY met directement le TRX sur cette fréquence, en DATA-U (plus besoin de cliquer sur QSY).
- **0.4.1** — « Station meters » dans la colonne de gauche, sous le filtre. En bas de page : **messages pré-enregistrés** sur trois lignes (FT8 · FT4 Tx1 à Tx6, RTTY, CW) avec correspondant, locator et report communs à tous les modes ; double-clic sur un message FT8/FT4 décodé = répondre à cette station (indicatif, locator et report repris). Réglages `digiCall` (indicatif émis, ON5VL) et `stationGrid` (locator des CQ).
- **0.4.0** — Fenêtre **RTTY** : démodulateur AFSK sur le serveur (Baudot ITA2, shift 170/200/425/850 Hz, 45,45 à 100 bauds, inversé, silencieux réglable), un réglage par membre ; clic sur la cascade pour se caler (repères Mark jaune / Space bleu), indicateur d'accord, texte reçu en continu ; zone d'émission avec correspondant et macros (CQ, Appel, Report, Contest, 73, QRZ?). L'émission RTTY arrive avec l'émission des modes numériques.

## v0.3 — modes numériques

- **0.3.3** — Clic sur FT8 ou FT4 : le TRX va sur la fréquence d'appel de ce mode dans sa bande, en DATA-U (il faut avoir la main), comme dans WSJT-X. Bande sans fréquence d'appel pour ce mode (ex. FT4 sur 70 cm) : « Pas de fréquence FT4 sur cette bande » au lieu de 80 m.
- **0.3.2** — FT8 / FT4 en **split** : clic gauche sur la cascade (ou sur une ligne) = fréquence de réception (repère vert), clic droit = fréquence d'émission (repère rouge) ; boutons « TX ← RX » et « RX ← TX ».
- **0.3.1** — Onglets RTTY, WSPR, JT65 (en préparation) et **Synchro** (heure du serveur, écart de votre PC, délai de la liaison station, DT médian). Bouton ⧉ : les modes numériques s'ouvrent dans une **fenêtre séparée** qui utilise la connexion du dashboard (« Ramener dans le dashboard » pour revenir). La liste des fréquences d'appel suit la bande du TRX. Correction : une page Station rechargée pendant qu'une fenêtre FT8/FT4 était ouverte (sans écouteur) n'envoyait plus la BF (cascade figée).
- **0.3.0** — Onglets au centre du dashboard : Activité, **FT8 · FT4**, RTTY. Fenêtre FT8/FT4 : cascade, activité de bande, fréquence RX, fréquences d'appel et QSY. Décodage sur le VPS (ft8_lib en WebAssembly, dans un fil séparé), à l'heure du VPS, avec recalage automatique du délai. La page Station envoie la BF en 12 kHz / 16 bits quand quelqu'un écoute ou regarde la fenêtre. RTTY et émission FT8/FT4 : prochaines versions.

## v0.2 — écoute de la BF, robustesse, protection du PA

- **0.2.17** — Les panneaux du dashboard se replient et se déplient d'un clic sur leur titre (flèche ▾/▸), état mémorisé dans le navigateur.
- **0.2.16** — Cause trouvée des « station hors ligne » : l'onglet de la page Station était réutilisé pour ouvrir le dashboard (code 1001 = page quittée). La page Station demande maintenant confirmation avant d'être quittée, propose un bouton « Ouvrir le dashboard dans une autre fenêtre », et le dashboard affiche la cause de chaque coupure (« page Station fermée ou quittée », « coupure réseau »…).
- **0.2.15** — Le dashboard reste connecté quand on actualise la page (session mémorisée 7 jours sur ce navigateur, oubliée par « Déconnexion » ou après une déconnexion pour inactivité ; seule une empreinte est gardée sur le serveur, `sessions.json`). La page Station signale quand Chrome l'a mise en pause ou déchargée.
- **0.2.14** — La page Station se reconnecte au VPS sans trou : la nouvelle liaison est ouverte avant de fermer l'ancienne (plus de « station hors ligne » sur le dashboard pendant une reconnexion), nouvel essai toutes les 5 s au plus ; après chaque coupure, la page Station envoie au serveur la cause et la durée (`station_diag` dans le journal).
- **0.2.13** — Une page Station rechargée (Ctrl+F5) sur le PC du club reprend toujours sa place tout de suite (elle était parfois refusée 30 s : fréquence sur la page Station mais pas sur le dashboard).
- **0.2.12** — Chien de garde d'émission dans la page Station : retour en réception si le TRX émet 2 min sans modulation ou 5 min sans interruption (PTT ou micro bloqué), même sans liaison avec le VPS.
- **0.2.11** — Encart « Accord (tuner) » juste au-dessus du TX ; caché si le TRX n'a pas de boîte d'accord.
- **0.2.10** — Fenêtre de connexion : « L'utilisation de la REMOTE STATION nécessite Google CHROME ou Microsoft EDGE », avertissement si un autre navigateur est détecté.
- **0.2.9** — Nombre de membres connectés (👥) dans la barre du haut, liste au clic : qui a la main, qui émet, écouteurs.
- **0.2.8** — TUNER et TUNE cachés sans boîte d'accord (FTX-1 sans SPA-1) ; messages ROS adaptés.
- **0.2.7** — La page Station rouvre seule le port du TRX (radio rallumée, câble rebranché) ; info-bulle du voyant TRX.
- **0.2.6** — Protection du PA : émission coupée si ROS > 2,5:1, PTT bloqué sur la fréquence jusqu'à un accord ; rappel « TUNE » après un changement de bande.
- **0.2.5** — Une seule page Station à la fois : un 2e onglet attend, une page sans TRX ne peut plus déloger celle qui a le TRX.
- **0.2.4** — Jeton accepté dans l'adresse (`/station#jeton=…`) ; avertissement si Chrome n'enregistre pas les données du site.
- **0.2.3** — Reconnexion automatique après une coupure réseau silencieuse (changement d'adresse IP Starlink) ; champ du jeton protégé contre le remplissage automatique de Chrome.
- **0.2.2** — Touches de bande du FTX-1 par BAND SELECT (mémoire de bande de la radio) ; commandes refusées signalées dans le journal de la page Station.
- **0.2.1** — La page Station continue d'interroger le TRX en arrière-plan (minuteries dans un Web Worker).
- **0.2.0** — Écoute de la BF du TRX à distance (8 kHz µ-law, un seul flux depuis le club, relayé à chaque écouteur).

## v0.1 — pilotage CAT

- **0.1.13** — Fréquences MAIN et SUB à la même hauteur.
- **0.1.12** — Fréquences aérées, taille des chiffres adaptée à l'écran.
- **0.1.11** — Commandes CAT envoyées une par une (le FTX-1 perdait les rafales), relecture immédiate après un réglage.
- **0.1.10** — Titre « ON5VL / OR0L  Remote Station UBA-LGE ».
- **0.1.9** — Messages entre connectés, demande et passage de la main.
- **0.1.8** — TRX en service coché en haut à gauche ; changement de TRX à distance par un administrateur.
- **0.1.7** — Déconnexion après 15 min d'inactivité (jamais en émission) ; main par onglet ; reprise après coupure.
- **0.1.6** — Port série mémorisé par modèle de TRX.
- **0.1.5** — Pilotes Yaesu FTDX10 et Icom IC-7300 (CI-V).
- **0.1.4** — Import des comptes en une fois (`importusers.js`) ; indicatifs d'écouteur ONL en écoute seule.
- **0.1.3** — Face avant d'après l'interface RigPlane Core : deux écrans VFO, colonne DUAL, mesures, journal d'activité.
- **0.1.2** — Fonctions complètes du FTX-1 (SPLIT, VFO B, RIT/XIT, filtres, DSP, réception, émission, mesures).
- **0.1.1** — Indicatifs belges uniquement ; puissance limitée par licence (ON3 = 25 W).
- **0.1** — Première version : pilotage CAT du FTX-1 via Web Serial et le VPS.
