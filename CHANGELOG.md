# Journal des versions — Remote Station UBA-LGE (ON5VL / OR0L)

## v0.15 — FT2

- **0.17.1** — Onglet FT8 · FT4 · FT2 : état de la BF (« BF reçue · décodage OK · délai ») sur la ligne de l'heure UTC ; **poignée sous la cascade** pour régler à la souris la hauteur de la cascade et des listes « Activité de bande » / « Fréquence RX » (mémorisée, double-clic : taille d'origine).
- **0.17.0** — **Émission automatique FT8 / FT4 / FT2, comme WSJT-X** (« Enable Tx » + « Auto Seq », règles reprises du code de WSJT-X 3.x).
  - Clic sur Tx1 à Tx7 : le message part à chaque période de l'opérateur (une sur deux) jusqu'à la réponse.
  - La séquence avance toute seule avec les réponses décodées : locator → Tx2, report → Tx3, R+report → Tx4 (RR73), RRR / RR73 → Tx5 (73). Après RR73 ou 73 envoyé : fin du QSO, émission coupée, retour sur Tx6 et proposition d'enregistrer le QSO dans le carnet.
  - « Répondre au 1er » (Call 1st) : en appel CQ, la station qui répond devient le correspondant. Double-clic sur un message : le bon Tx est choisi selon son contenu, période opposée.
  - Arrêts : ■ Arrêter, barre d'espace, correspondant qui répond à un autre, chien de garde (même message depuis `ftxWatchdogMinutes`, 6 min), main perdue.
  - Décodage anticipé FT8 / FT4 en fin de signal (13,4 s en FT8) : la réponse part dès la période suivante.
  - Barre de progression de la période sous les listes : verte en réception, rouge en émission.
- **0.16.0** — **Émission FT8 / FT4 / FT2.** Un clic sur un message Tx1 à Tx7 l'émet une fois au prochain créneau, puis retour automatique en réception.
  - Le serveur choisit le créneau (heure du VPS) : période « auto » (opposée au correspondant choisi par double-clic) ou imposée (1re / 2e) ; bouton « ■ Arrêter ».
  - La page Station code le message (ft8_lib en WebAssembly), met le TRX en émission juste avant le créneau (VFO B en SPLIT, confirmé par FT avant d'émettre) et joue le signal à l'heure du VPS sur la **sortie son vers le TRX** (nouveau réglage, avec niveau d'émission), même si l'horloge de Windows est décalée.
  - Fin du signal → retour en réception ; mêmes sécurités que le PTT (main, licence, puissance, ROS, bande, chien de garde). Refus clair si le VFO d'émission n'est pas en DATA-U, si le message est incomplet ou si la page Station n'a pas de sortie son.
  - Le message émis s'affiche en jaune dans les listes, comme dans WSJT-X.
- **0.15.17** — FTX-1 : badge **BW** sur l'écran du VFO B (largeur de filtre du récepteur SUB, SH1). Mention « Émission » raccourcie sur les écrans étroits pour garder l'en-tête sur une ligne.
- **0.15.16** — Mention **« Émission sur A »** ou **« Émission sur B »** dans l'en-tête du VFO d'émission (entre BW et MAIN / SUB). FTX-1 : **badges d'état du récepteur SUB** sur l'écran du VFO B (ATT, AMP, NB, DNR, NOTCH, DNF, NAR, AGC, RFG). **Préampli selon la bande** : IPO / AMP1 / AMP2 en HF et 50 MHz (PA0), bouton **AMP** ON / OFF en 144 et 430 MHz (PA1 / PA2) ; l'ancien badge affichait le réglage HF même en 70 cm.
- **0.15.15** — **SPLIT du FTX-1 : émission vérifiée sur le bon VFO.** Avant d'émettre en SPLIT, la page Station envoie le VFO d'émission puis relit `FT;` : elle n'émet que si le TRX confirme SUB (essais `FT1;`, puis `FT3;`, puis `VS1;FT1;`, la façon acceptée est retenue). Sinon, pas d'émission et message clair. Chiffres rouges sur le VFO qui émet réellement (FT relu), émission coupée si le TRX émet plus d'1,5 s sur l'autre VFO, réception remise après l'émission sur le VFO d'avant le PTT.
- **0.15.14** — **Lecture CAT** de diagnostic pour les administrateurs (voyant STATION → « ⌨ Lecture CAT… ») : envoie une commande de lecture au TRX (FB;, VS;, FT;, IF;, OI;…) et affiche sa réponse brute. Lectures seulement (liste fermée par pilote), jamais de réglage ni d'émission.

- **0.15.13** — FTX-1 : le **SPLIT mis sur la face avant du TRX** est suivi par le dashboard (lecture de ST) ; le couper au dashboard envoie ST0 (ST1 n'est jamais envoyé par CAT) ; en SPLIT de face avant, le PTT n'envoie que TX1 / TX0. Après une émission en SPLIT virtuel, si le TRX a recopié la fréquence d'un VFO sur l'autre, la page Station remet les deux fréquences comme avant l'émission (et le note dans son journal).

- **0.15.12** — FTX-1 : MAIN / SUB (et clic sur RX) envoient FT puis VS sur le même côté. Avec VS seul, FT restait de l'autre côté et ce désaccord faisait émettre le TRX au clic sur SUB. En dehors des émissions, FT et VS sont toujours sur le même côté ; le SPLIT reste virtuel (appliqué seulement pendant l'émission). Version du serveur affichée au survol du titre et du bouton HELP.

- **0.15.11** — FTX-1 : **SPLIT « virtuel »** (comme Hamlib). Sur ce TRX, réception et émission basculent ensemble, et un VFO d'émission différent de celui de réception peut le faire émettre. Le clic sur SPLIT / TX n'envoie donc plus rien au TRX : le serveur garde le choix, l'affiche, s'en sert pour les contrôles (bande autorisée, fréquence d'émission) et ne l'envoie qu'au moment d'émettre (FT du VFO choisi puis TX1 ; au relâchement TX0, puis FT et VS remis sur le VFO de réception). Le clic sur RX n'envoie que VS.

- **0.15.10** — FTX-1 : **réception et émission indépendantes**. Le SPLIT (TX sur B) ne déplace plus la réception : la commande FT est suivie du VFO de réception inchangé (VS) ; un clic sur RX change la réception sans toucher au VFO d'émission (VS puis FT inchangé). Toutes les combinaisons : RX A / TX B, RX B / TX B, RX B / TX A, RX A / TX A.

- **0.15.9** — **Recharger la page Station à distance** (administrateurs) : voyant STATION → « ↻ Recharger la page Station ». Fonctionne aussi avec une page d'avant la 0.15.7 (elle passe un instant sur un autre pilote, sans port ouvert, puis revient sur son TRX). La page Station se connecte toute seule avec le jeton de station gardé par le navigateur du PC du club (plus besoin de mot de passe après un rechargement). Le message « SPLIT refusé » indique cette commande.

- **0.15.8** — FTX-1 : le serveur **refuse le SPLIT** tant que la page Station du club est une version d'avant la 0.15.5 (qui enverrait ST1 et mettrait le TRX en émission), avec le message « rechargez la page Station au club ». La page Station annonce désormais ce qu'elle sait faire au serveur.

- **0.15.7** — **La page Station se met à jour toute seule** : après une mise à jour du serveur, elle compare son programme (page et pilotes des TRX) à celui du serveur et se recharge si besoin (jamais pendant une émission). Avant, une page Station restée ouverte au club gardait les anciens pilotes — c'est pourquoi le SPLIT du FTX-1 envoyait encore ST1 (passage en émission) malgré la 0.15.5. **Filet de sécurité** : si le TRX passe en émission dans la seconde et demie qui suit un réglage SPLIT / VFO envoyé à distance, sans PTT, la page Station le remet en réception (TX0, et ST0 sur le FTX-1) et tous les membres sont prévenus.

- **0.15.6** — Fréquence grisée sur le VFO qui ne sert ni à recevoir ni à émettre (VFO B hors SPLIT) ; elle redevient blanche dès que le SPLIT est mis (TX sur B). Le SPLIT ne fait que désigner le VFO d'émission : l'émission ne part qu'au PTT (ou plus tard, aux commandes d'émission des modes numériques).

- **0.15.5** — **Correction FTX-1** : SPLIT, et le clic sur TX du VFO B, faisaient passer le TRX en émission. Sur le FTX-1, la commande CAT ST1 (split) met le côté SUB en émission (défaut connu du firmware, signalé par Hamlib) : le VFO d'émission est maintenant choisi par FT0 / FT1, ST n'est plus lu ni envoyé, et ST0 est envoyé à l'ouverture du port pour sortir d'un éventuel ST1. FTDX10 et IC-7300 inchangés. En émission, les chiffres de la fréquence du VFO qui émet passent en rouge.

- **0.15.4** — **RIT / XIT / CLEAR sur chaque écran VFO** : clic sur RIT ou XIT pour les allumer / éteindre, molette sur le décalage (± 10 Hz, ± 100 Hz avec Maj), CLEAR en dessous pour le remettre à zéro ; retirés de la colonne du milieu (MAIN SUB SPLIT · A→B B→A A⇄B · décalage LOCK). VFO B : clarifier du côté SUB du FTX-1 (CF1…, comme Hamlib) ; FTDX10 et IC-7300 n'ont qu'un clarifier (VFO A).

- **0.15.3** — Fréquence des VFO : points de séparation (MHz . kHz . Hz) rapprochés des chiffres ; la place gagnée sert à des chiffres un peu plus grands.

- **0.15.2** — Voyants **TX** / **RX** des écrans VFO cliquables : clic sur TX = ce VFO émet (TX sur B = SPLIT, TX sur A = SPLIT coupé), clic sur RX = ce VFO reçoit (MAIN / SUB ; pas de choix par CAT sur l'IC-7300). Le cadre lumineux suit le VFO d'émission ; le VFO réglé par la molette a sa lettre soulignée. Bouton **CLEAR** entre RIT et XIT : décalage RIT / XIT remis à zéro (FTX-1, FTDX10, IC-7300). Colonne DUAL réorganisée (MAIN SUB SPLIT · A→B B→A A⇄B · RIT CLEAR XIT · décalage LOCK) ; la fréquence reste sur la ligne « VFO / mode » jusqu'à 1440 px de large (en dessous, elle passe sur sa propre ligne).

- **0.15.1** — Écrans VFO plus compacts (246 → 149 px de haut sur 1920 × 1080) : la fréquence est sur la ligne « VFO / mode », entre le mode et RIT / XIT (l'un au-dessus de l'autre) ; écran étroit : la fréquence repasse sur sa propre ligne. Chaque VFO affiche **RX** (vert : VFO qui reçoit) et **TX** (rouge : VFO d'émission, rouge vif pendant l'émission ; en SPLIT, TX passe sur le VFO B). Colonne DUAL sur trois boutons par ligne (MAIN SUB LOCK · A→B B→A A⇄B · SPLIT RIT XIT · décalage). Plus de place pour les modes numériques en dessous.

- **0.15.0** — Mode **FT2** (Decodium, IU8LMC) dans la fenêtre FT8 · FT4 · FT2 : bouton FT2, fréquences de la liste de Decodium 4.0 (1 843 … 432 177 kHz), périodes de 3,75 s. FT2 est le signal FT4 à vitesse double (24 ms par symbole, 4-GFSK, 167 Hz) : décodé par ft8_lib (décodeur FT4 remis à l'échelle), fenêtres analysées toutes les 1,25 s pour attraper aussi les émissions asynchrones, doublons retirés. Carnet : MODE MFSK / SUBMODE FT2 (ADIF 3.1.7). Nouveau codeur FT8 / FT4 / FT2 en WebAssembly (`public/js/ftx-enc.wasm`, `public/js/ftxenc.js`), base de l'émission des modes numériques qui suit. Le FT2 de « WSJT-X Improved » (DG2YCB) est un autre mode, incompatible, non pris en charge.

## v0.14 — Logs online (version « extended »)

- **0.14.1** — **Page Station réservée aux administrateurs** : /station demande d'abord l'indicatif et le mot de passe d'un administrateur ; la page et son programme (station.js, station-core.js) ne sont envoyés qu'ensuite. Le PC reste autorisé un an (cookie HttpOnly, SameSite=Strict, Secure en HTTPS, renouvelé à chaque ouverture ; seule son empreinte est gardée dans `logs/station-sessions.json`), bouton « Se déconnecter » ; un membre non administrateur est refusé, les mauvais mots de passe sont freinés (5 essais / 10 min) et notés dans le journal (`station_page_login`, `station_page_fail`, `station_page_refused`). Le jeton de station reste exigé pour brancher le TRX.

- **0.14.0** — Onglet **Logs online** : carnet de trafic de la station (serveur, `logs/logbook.json`), partagé par les membres. Saisie d'un QSO pré-remplie par « ⇩ TRX » (fréquence, mode — en DATA celui de l'onglet affiché —, puissance, correspondant du bas de page), heure UTC prise à la première lettre, doublons signalés, QO-100 reconnu sur la FI du convertisseur (montée 2400,xxx enregistrée, PROP_MODE SAT). Liste avec recherche et état des envois (✓ ✗ ★ confirmé LoTW), modification / suppression par l'auteur ou un administrateur. **Exporter** en ADIF 3 (.adi) ou Cabrillo 3 (.log). **Synchronisation** (administrateurs), fenêtres à la manière de Swisslog : Télécharger vers QRZ / eQSL / Club Log (indicatif, plage de dates, temporisation, renvoi, « Effacer le log ClubLog existant »), onglet Traitement avec progression et Arrêt ; **Opérations LoTW** par TQSL (exporter, signer, envoyer, confirmations, statut) ou, sur un serveur sans certificat, export pour TQSL puis « Marquer comme envoyés ». **Configuration** (administrateurs) : onglets CLUBLOG, eQSL, LoTW, QRZ (une clé par indicatif), UDP (WSJT-X « Logged ADIF » / « QSO Logged », N1MM, ADIF brut, vers Swisslog, Log4OM, HRD, N1MM…) ; envoi automatique à chaque QSO, mots de passe masqués (👁), jamais renvoyés au navigateur ; envois arrêtés après un refus d'accès. Service systemd : écriture permise dans /opt/remote-station.

## v0.13 — installateur Windows

- **0.13.0** — **Installateur Windows 10 / 11** (`RemoteStation-Setup-0.13.0.exe`, fabriqué par `windows/build.sh`), deux parties au choix : **PC du club** (raccourci « Page Station » qui ouvre Chrome ou Edge dans sa fenêtre, avec un profil à part et les réglages anti-coupure ; dashboard ; lancement au démarrage de Windows ; pas de mise en veille ; adresse du serveur demandée) et **serveur Remote Station** (service Windows via WinSW, démarrage automatique et relance en cas d'arrêt, Node.js installé par winget si besoin, pare-feu en option, outils du menu Démarrer : ajouter / lister / supprimer un membre, jeton de la station, configuration, redémarrage, journaux). Mise à jour sans perte (configuration, comptes, macros, images SSTV), désinstallation propre, installation silencieuse possible. Décodeurs JT65 et JTTY compilés pour Windows (`lib/bin/*.exe`, MinGW-w64). Serveur : HTTPS direct possible (`"tls": { "cert", "key" }`), arrêt propre sous Windows. Manuel aussi en Markdown sur GitHub (MANUEL.md, USER-MANUAL.md).

## v0.12 — manuel d'utilisation

- **0.12.0** — **Manuel d'utilisation** en français (`/aide`) et en anglais (`/help`) : connexion, écran, main, réglages du TRX, écoute, émission et sécurités, discussion, fenêtres séparées, tous les modes numériques (FT8 · FT4, JT65, RTTY, WSPR, JTTY, CW, SSTV, Synchro, QO-100), macros et balises, raccourcis clavier, problèmes fréquents, PC du club ; imprimable. Bouton **HELP** dans le bandeau du dashboard (manuel dans la langue du navigateur) et liens sur la page Station. Choix d'antenne ANT 1 / ANT 2 dans son propre cadre, en haut à gauche.

## v0.11 — QO-100 et choix d'antenne

- **0.11.0** — **QO-100** : les listes de fréquences FT8 · FT4, RTTY et CW proposent la FI du convertisseur 2,4 GHz (2 m, 70 cm, 23 cm) pour monter sur 2400,040 MHz (FT8 / FT4, comme WSJT-X), 2400,025 (CW) et 2400,090 (RTTY) ; par défaut 432,540 MHz en FT8 (convertisseur à OL 1967,5 MHz), réglable par `qo100If` ; seules les FI couvertes par le TRX sont proposées, et la liste ne bascule jamais d'elle-même d'une fréquence 70 cm terrestre vers QO-100. **Antenne** : cadre RF front end, ANT 1 / ANT 2 sur le FTX-1 (menu EX030704, prises de l'ampli SPA-1), refusé pendant une émission ; FTDX10 et IC-7300 n'offrent pas ce choix par CAT (indiqué, boutons grisés).

## v0.10 — SSTV

- **0.10.0** — Onglet **SSTV** (à droite de CW). Réception sur le serveur (`lib/sstv-dec.js`, sans dépendance) : départ automatique sur le code VIS, modes Martin M1 / M2, Scottie S1 / S2 / DX, Robot 36 / 72, PD 50 / 90 / 120 / 160 / 180 / 240 / 290 ; TRX mal calé corrigé (décalage mesuré sur l'amorce), correction de pente (horloges de carte son différentes), image affichée ligne après ligne puis redressée à la fin ; tient le QSB et le QRM de courte durée. Galerie des 12 dernières images (vignettes), enregistrement PNG sur votre PC ; chaque image reçue est aussi gardée sur le serveur (dossier `sstv/`, 200 dernières). Préparation des images à émettre : images de votre PC (bouton ou glisser-déposer, gardées dans le navigateur), carte CQ, mire ou image reçue, recadrage au format du mode, trois lignes de texte (balises <CALL> <MYCALL> <RST> <NAME> <MYLOC> <ZT>, taille, couleur), aperçu, durée ; « Écouter » joue le signal SSTV sur le PC et « WAV » l'enregistre (essai avec un autre logiciel). L'émission SSTV arrive avec l'émission des modes numériques.

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
