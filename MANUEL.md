<!-- Fichier produit par native/manual2md.js à partir de public/aide.html : modifier la page HTML, puis relancer le script. -->

# Remote Station UBA-LGE — manuel d’utilisation

*Version en ligne : bouton **HELP** du dashboard ou https://remote.op0p.be/aide — [English version](USER-MANUAL.md)*

- [1. Avant de commencer](#intro)
- [2. Petit lexique](#lexique)
- [3. Se connecter](#connexion)
- [4. Premiers pas guidés](#premiers)
   - [4.1 Écouter une bande](#p-ecoute)
   - [4.2 Un QSO en phonie (BLU)](#p-phonie)
   - [4.3 Un QSO en FT8](#p-ft8)
   - [4.4 Noter le QSO dans le carnet](#p-log)
- [5. L'écran en un coup d'œil](#ecran)
- [6. Prendre et passer la main](#main)
- [7. Piloter le TRX](#trx)
   - [7.1 Les écrans VFO](#vfo)
   - [7.2 Ligne Step et bandes](#step)
   - [7.3 Colonne de gauche](#gauche)
   - [7.4 Colonne de droite](#droite)
   - [7.5 Trafic en SPLIT](#split)
- [8. Écouter](#ecoute)
- [9. Émettre et sécurités](#emission)
- [10. Opérateurs et discussion](#operateurs)
- [11. Disposition et fenêtres séparées](#disposition)
- [12. Modes numériques](#numeriques)
   - [12.1 FT8 · FT4 · FT2](#ft8)
   - [12.2 JT65](#jt65)
   - [12.3 RTTY](#rtty)
   - [12.4 WSPR](#wspr)
   - [12.5 JTTY](#jtty)
   - [12.6 CW](#cw)
   - [12.7 SSTV](#sstv)
   - [12.8 Synchro](#synchro)
   - [12.9 QO-100](#qo100)
- [13. Correspondant, macros et balises](#messages)
- [14. Logs (carnet de trafic)](#logs)
   - [14.1 Enregistrer un QSO](#l-fiche)
   - [14.2 La liste des QSO](#l-liste)
   - [14.3 Exporter](#l-export)
   - [14.4 Synchronisation (LoTW, eQSL, Club Log, QRZ)](#l-sync)
   - [14.5 Configuration](#l-config)
- [15. Raccourcis clavier](#clavier)
- [16. Problèmes fréquents](#problemes)
- [17. Pour les administrateurs](#admin)
- [18. Le PC du club (page Station)](#club)

> [!NOTE]
> Le dashboard fonctionne dans **Google Chrome** ou **Microsoft Edge**, sur PC, Mac, tablette ou téléphone. Il est prévu pour un écran de **1920 × 1080** ou plus ; sur un écran plus petit, les cadres se placent les uns sous les autres. Après une mise à jour du serveur, appuyez sur `Ctrl` + `F5` pour recharger la page.

<a id="intro"></a>
## 1. Avant de commencer

La **Remote Station** permet aux membres de la section UBA-LGE d'utiliser le **transceiver (TRX) du club** depuis chez eux, avec un simple navigateur. Le TRX (un Yaesu FTX-1 avec son ampli SPA-1, ou selon le cas un FTDX10 ou un IC-7300) est au club, relié à un PC. Ce PC est relié par internet au serveur **remote.op0p.be**, et c'est ce serveur que vous ouvrez dans votre navigateur.

1. Vous cliquez sur un bouton du dashboard (par exemple « 20M »).
2. Le serveur transmet l'ordre au PC du club.
3. Le PC du club envoie la commande au TRX par son câble USB (la « liaison CAT »).
4. Le TRX change de bande, et tous les membres connectés voient la nouvelle fréquence.

Le son du récepteur fait le chemin inverse : il arrive dans votre navigateur, et les modes numériques (FT8, RTTY, CW…) sont décodés sur le serveur.

> [!TIP]
> **Les règles d'or**
> - **Une seule personne pilote** le TRX à la fois : celle qui « a la main ». Les autres regardent et écoutent.
> - **Tout ce que vous réglez agit sur le vrai TRX du club**, pour tout le monde. Si vous n'êtes pas sûr d'un réglage, laissez-le tel quel.
> - Après un changement de bande, faites toujours un `TUNE` avant d'émettre (accord de l'antenne).
> - Respectez votre licence : bandes et puissance autorisées. Le serveur le vérifie de toute façon.
> - En partant, **libérez la main** et coupez le SPLIT si vous l'avez mis.

<a id="lexique"></a>
## 2. Petit lexique

Les mots qui reviennent souvent dans ce manuel et sur l'écran.

| Mot | Signification |
|---|---|
| TRX | Transceiver : l'émetteur-récepteur du club. |
| Avoir la main | Être l'opérateur qui pilote le TRX en ce moment. Sans la main, on peut regarder et écouter, mais pas régler ni émettre. |
| VFO | Le « bouton de fréquence » du TRX. Il y en a deux, **A** et **B** (sur le FTX-1 : **MAIN** et **SUB**), chacun avec sa fréquence et son mode. |
| MAIN / SUB | Les deux récepteurs du FTX-1. MAIN correspond au VFO A, SUB au VFO B. Le « côté actif » est celui qu'on écoute et qu'on règle. |
| PTT | Push To Talk : le bouton qui met le TRX en émission tant qu'on le maintient. |
| CAT | La liaison par câble USB entre le PC du club et le TRX, qui sert à le commander. |
| BF | Basse fréquence : le son qui sort du récepteur (ce que vous entendez, et ce que le décodeur analyse). |
| Mode | La façon de transmettre : **LSB / USB** (BLU, la phonie en HF), **CW** (morse), **AM**, **FM**, **DATA-U** (modes numériques par la carte son du TRX), **RTTY**… |
| BLU | Bande latérale unique (SSB en anglais) : la phonie en HF. LSB en dessous de 10 MHz, USB au-dessus. |
| Bande | Une plage de fréquences : 80 m, 40 m, 20 m… (plus le chiffre est petit, plus la fréquence est haute). |
| SWR / ROS | Rapport d'ondes stationnaires : indique si l'antenne est bien accordée. 1,0 est parfait, jusqu'à 1,5 c'est très bien, au-delà de 2,5 l'émission est coupée. |
| TUNE / tuner | Le tuner (boîte d'accord) adapte l'antenne à la fréquence. TUNE lance cet accord : le TRX émet une porteuse quelques secondes. |
| ALC | Indicateur qui montre si l'émetteur est « poussé » trop fort. En modes numériques, l'ALC doit rester très faible. |
| S-mètre | Indique la force du signal reçu, de S1 (très faible) à S9, puis S9+10, +20… dB (très fort). |
| Filtre / BW | Largeur de la « fenêtre » d'écoute. Plus étroite = moins de bruit et de stations voisines, mais il faut être bien calé. |
| SPLIT | Écouter sur une fréquence et émettre sur une autre (pour les expéditions DX). |
| RIT / XIT | Petit décalage de la fréquence de réception (RIT) ou d'émission (XIT), sans toucher au VFO. |
| Cascade (waterfall) | L'image qui défile dans les onglets numériques : chaque trait coloré est un signal ; plus il est clair ou rouge, plus il est fort. |
| QSO | Un contact radio entre deux stations. |
| Correspondant | La station avec qui vous faites le QSO (DX en abrégé). |
| Report / RST | Le compte rendu de réception qu'on se donne : **59** ou **599** en phonie / CW / RTTY, un nombre de **dB** (−15, +03…) en FT8. |
| Locator | Position en carré Maidenhead (ex. JO20 pour la région liégeoise). |
| TX call | L'indicatif sous lequel partent les émissions numériques et sous lequel le QSO est noté : celui du club (ON5VL, OR0L) ou le vôtre. |
| UTC | L'heure universelle utilisée en radio (heure belge − 1 h en hiver, − 2 h en été). |
| ADIF | Format de fichier standard pour échanger des QSO entre logiciels de carnet (.adi). |
| LoTW, eQSL, Club Log, QRZ | Sites où l'on envoie ses QSO pour obtenir des confirmations (QSL électroniques) et des diplômes. |
| DXCC | La liste officielle des « pays » radioamateurs (entités). Le préfixe (ON, F, DL…) indique le pays d'un indicatif. |

<a id="connexion"></a>
## 3. Se connecter

1. Ouvrez [https://remote.op0p.be](https://remote.op0p.be) dans Chrome ou Edge.
2. Entrez **votre indicatif** et **votre mot de passe** (donnés par un administrateur du club), puis cliquez `Se connecter`.
3. Le navigateur reste connecté **7 jours** : en rechargeant la page, vous revenez directement au dashboard.
4. `Déconnexion` (en haut à droite) ferme la session et oublie le navigateur : à faire sur un PC qui n'est pas le vôtre.

- Les indicatifs d'**écouteurs** (ONL…) peuvent tout voir et tout écouter, mais pas émettre ni régler la puissance.
- Après **15 minutes sans aucune action**, vous êtes déconnecté. Un avertissement apparaît une minute avant, avec un bouton `Rester connecté`. Cela n'arrive jamais pendant une émission.
- Le bouton `HELP` en haut à droite ouvre ce manuel dans un nouvel onglet.

<a id="premiers"></a>
## 4. Premiers pas guidés

Quatre « recettes » pour démarrer. Le détail de chaque bouton se trouve plus loin (sections 7 à 14).

<a id="p-ecoute"></a>
### 4.1 Écouter une bande

1. À droite, cadre **RX audio** : cliquez `🔊 Écouter le TRX`. Réglez le curseur **Volume** juste en dessous (il n'agit que chez vous).
2. Pour changer de bande ou de fréquence, il faut **avoir la main** : cliquez `Prendre la main` en haut (si personne ne l'a).
3. Cliquez une bande, par exemple `40M`, dans la ligne des bandes sous les VFO.
4. Choisissez le mode dans le cadre **Mode** à gauche : `LSB` pour la phonie sur 40 m, `USB` sur 20 m et au-dessus.
5. Tournez la fréquence : placez la souris sur les chiffres du **VFO A** et utilisez la **molette**. Chaque chiffre se règle séparément ; le chiffre sous la souris monte ou descend.
6. Une station trop forte ? Baissez le **RF GAIN** (cadre RF front end) ou allumez l'`ATT`. Beaucoup de bruit ? Essayez `DNR` (réducteur de bruit).

<a id="p-phonie"></a>
### 4.2 Un QSO en phonie (BLU)

Le dashboard n'envoie pas encore votre micro vers le TRX : la phonie se fait au club ou avec un autre moyen prévu par les responsables. Le dashboard sert alors à régler et surveiller la station. Si l'émission phonie est disponible chez vous, la marche à suivre est la suivante :

1. Prenez la main, choisissez la bande et le mode (LSB / USB).
2. Cadre **Accord** à droite : cliquez `TUNE` et attendez la fin de l'accord. Regardez le **SWR** dans **Station meters** (en bas à gauche) : il doit être sous 1,5 environ.
3. Vérifiez la **puissance** dans le cadre TX (boutons `−` `+`).
4. Écoutez que la fréquence est libre, puis maintenez `PTT` (ou la barre `Espace`) pour parler ; relâchez pour écouter.

> [!NOTE]
> Vérifiez avec un responsable du club comment la modulation phonie est prévue avant votre premier essai.

<a id="p-ft8"></a>
### 4.3 Un QSO en FT8

Le FT8 est le mode le plus simple à distance : tout se fait à la souris et le dashboard gère la séquence comme WSJT-X.

1. Prenez la main. Dans la ligne **Correspondant** (en bas), choisissez le **TX call** : l'indicatif du club (ON5VL) ou le vôtre.
2. Onglet `FT8 · FT4 · FT2` au centre, bouton `FT8`, puis choisissez une bande dans la liste des fréquences (ex. « 14.074 · 20m »). Le TRX y va tout seul, en DATA-U.
3. Faites un `TUNE` (cadre Accord), puis réglez une puissance raisonnable (20 à 40 W suffisent en FT8).
4. Attendez une ou deux périodes de 15 s : les stations entendues s'affichent dans **Activité de bande**. Les appels **CQ** sont en vert.
5. **Pour répondre à un CQ** : cliquez sur l'**indicatif** de la station (souligné en pointillé) ou double-cliquez sur sa ligne. Le TRX émet votre appel dès le début de la période suivante.
6. Laissez faire : la **séquence avance toute seule** (report, R-report, RR73, 73). La barre sous les listes est rouge pendant l'émission, verte en réception.
7. Dès que le correspondant envoie RR73, la fiche **« Enregistrer le QSO »** s'ouvre déjà remplie : vérifiez et enregistrez.
8. Pour appeler vous-même : cliquez `Tx6` (CQ). Cochez **Répondre au 1er** pour que la première station qui répond soit prise automatiquement.
9. Pour tout arrêter : `■ Arrêter` (ou la barre `Espace`).

<a id="p-log"></a>
### 4.4 Noter le QSO dans le carnet

1. Après un QSO numérique, la fiche s'ouvre toute seule (FT8) ou avec le bouton `Log QSO` (RTTY, JTTY, CW, ligne Correspondant).
2. Pour un QSO en phonie : onglet `LOGS`, tapez l'indicatif (l'heure UTC se met toute seule), cliquez `⇩ TRX` pour reprendre fréquence et mode, complétez les reports.
3. `Enregistrer le QSO` (ou `Entrée`). Le QSO apparaît dans la liste. Sous l'indicatif du club, il est aussi envoyé aux carnets en ligne si les administrateurs l'ont prévu.
4. Pour récupérer vos QSO dans votre propre logiciel : **Exporter ▾ → Mes QSO (.adi)**.

<a id="ecran"></a>
## 5. L'écran en un coup d'œil

### Bandeau du haut

| Élément | Ce que c'est | Ce qu'il fait |
|---|---|---|
| `● Serveur` | Voyant de liaison entre votre navigateur et le serveur. | Vert = connecté. Rouge ou gris : vérifiez votre internet, la page se reconnecte toute seule. |
| `● Station` | Voyant de la page Station du PC du club. | Vert = le PC du club est en ligne. Pour les administrateurs, un clic ouvre le menu du TRX (section 17). |
| `● FTX-1 FTDX10 IC-7300` | Les TRX du club ; celui en service est en surbrillance. | Vert = le TRX répond par le CAT ; rouge = le TRX émet. |
| Titre au centre | Indicatif et nom de la station. | — |
| `👥 n` | Nombre de membres connectés. | Ouvre le volet **Opérateurs** : qui est là, qui a la main, discussion (section 10). Un point rouge signale un nouveau message. |
| Votre indicatif | Le compte avec lequel vous êtes connecté. | — |
| `Prendre la main` / `Libérer la main` | Bouton de pilotage. | Vous devenez l'opérateur, ou vous rendez la main (section 6). |
| `DX Cluster ▾` | Menu des clusters DX du club. | Ouvre dans un nouvel onglet **dx.op0p.be** (Ultimate Cluster) ou **cluster.op0p.be** (CC-Cluster OP0P) : la liste des stations DX annoncées. |
| `HELP` | Le manuel. | Ouvre cette page (français ou anglais selon votre navigateur). |
| `Déconnexion` | Fin de session. | Ferme la session et oublie ce navigateur. |

### Les zones de l'écran

1. **Colonne de gauche** : Antenne, RF front end (réception), Mode, Filtres, Station meters (mesures).
2. **Centre, en haut** : les deux écrans VFO (A / MAIN et B / SUB), la ligne **Step** (pas d'accord, choix du VFO, SPLIT…) et la ligne des **bandes**.
3. **Centre, en bas** : « Activité et modes numériques » : onglets Activité, FT8 · FT4 · FT2, RTTY, WSPR, JT65, JTTY, CW, SSTV, Synchro et Logs.
4. **Colonne de droite** : RX audio (écoute), DSP (antiparasites), Accord (tuner), TX (PTT et puissance).
5. **Tout en bas** : la ligne **Correspondant** (la station contactée, ses reports, le TX call et `Log QSO`).

- **Replier un cadre** : cliquez sur son titre (par exemple « DSP ») ; un deuxième clic le rouvre. Votre choix est retenu.
- **Fenêtre séparée** : le bouton `⧉` d'un cadre l'ouvre dans sa propre fenêtre (section 11).
- Sous la ligne des bandes, une ligne de messages affiche les confirmations et les refus (« Prenez la main… », « PTT refusé : … »).

<a id="main"></a>
## 6. Prendre et passer la main

- Une seule personne **a la main** (pilote le TRX) ; tout le monde voit et entend la même chose.
- `Prendre la main` (bandeau du haut) : possible si personne ne l'a. Le bouton devient `Libérer la main`.
- Si quelqu'un l'a déjà : ouvrez le volet `👥` et cliquez `Demander la main à …`. L'opérateur reçoit la demande (son volet s'ouvre) et peut cliquer `Passer la main à …`. Vous pouvez aussi lui écrire un message dans la discussion.
- **En partant**, cliquez `Libérer la main`. Sans action pendant **15 minutes**, la main est libérée automatiquement.
- Le bouton du bandeau affiche `Main occupée` quand quelqu'un d'autre l'a, et `Prendre la main ici` si vous l'avez déjà dans un autre onglet ou un autre navigateur. Un administrateur voit `Reprendre la main` : il peut la reprendre en cas de besoin, après confirmation.
- Sans la main, les commandes sont grisées et un message rappelle « Prenez la main ».
- **Suivre l'opérateur** (pour une formation à distance) : bouton `👁 Suivre` à droite des onglets des modes numériques. Allumé (vert), votre écran affiche le même onglet que celui qui a la main (RTTY, FT8, CW…) et en change avec lui. Cliquer vous-même sur un autre onglet arrête le suivi ; un clic sur `👁 Suivre` le relance. Ce bouton n'apparaît pas chez celui qui a la main.

<a id="trx"></a>
## 7. Piloter le TRX

Toutes les commandes de cette section demandent d'**avoir la main**, sauf l'écoute et le volume. Elles agissent sur le vrai TRX du club et tout le monde voit le résultat. Certaines n'existent que sur un TRX : elles sont grisées ou absentes sur les autres. Quand un bouton est allumé (en couleur), la fonction est en service ; un clic l'éteint.

<a id="vfo"></a>
### 7.1 Les écrans VFO

En haut au centre, deux écrans : **VFO A (MAIN)** à gauche et **VFO B (SUB)** à droite. Ils ressemblent à l'afficheur du TRX.

| Élément | Ce qu'il montre | Ce qu'un clic (ou la molette) fait |
|---|---|---|
| `RX` | Vert : ce VFO est celui qu'on écoute. | Clic : ce VFO devient celui de réception (comme la touche MAIN / SUB du TRX ; pas sur l'IC-7300). |
| `TX` | Rouge foncé : l'émission partirait sur ce VFO. Rouge vif avec halo : émission en cours. | Clic sur le TX de l'autre VFO : SPLIT (on écoute sur un VFO et on émet sur l'autre, section 7.5). Clic sur le TX du VFO écouté : SPLIT coupé. |
| `BW 2.4K` | Largeur du filtre de réception de ce VFO. | **Molette** dessus : élargir ou rétrécir le filtre. |
| « Émission sur A / B » | Rappel orange du VFO sur lequel partirait l'émission. | — |
| MAIN / SUB · 20M | Côté du TRX et bande de ce VFO. | — |
| S-mètre (S1 … +60) | Force du signal reçu. Grisé sur le VFO qu'on n'écoute pas. | — (en émission, regardez Station meters). |
| Chiffres de la fréquence | La fréquence en MHz. Rouge pendant l'émission ; grisée si ce VFO ne sert ni à recevoir ni à émettre. | **Molette** ou **glisser** vers le haut / bas sur un chiffre : ce chiffre monte ou descend (les MHz, les kHz, les centaines de Hz…). **Clic** sur l'écran : ce VFO devient celui que règlent les flèches ◀ ▶ et les bandes (sa lettre est soulignée). |
| Mode (USB, DATA-U…) | Le mode de ce VFO. | Il se change dans le cadre **Mode** à gauche. |
| `RIT` | Décalage de la réception seulement. | Clic : marche / arrêt. **Molette** sur la valeur affichée (+0.00 kHz) : ± 10 Hz, ± 100 Hz avec `Maj`. Utile si le correspondant dérive un peu. |
| `XIT` | Décalage de l'émission seulement. | Clic : marche / arrêt. Molette sur la valeur : comme RIT. Utile pour un petit split de quelques kHz. |
| `CLEAR` | — | Remet le décalage RIT / XIT à zéro. |
| `ATT` | Atténuateur d'entrée. | Clic : marche / arrêt. Pour une station locale très forte ou une bande saturée (le bruit baisse aussi). Grisé en 2 m / 70 cm. Sur le FTDX10 : OFF, 6, 12 ou 18 dB. |
| `IPO` / `AMP1` / `AMP2` | Préamplificateur (HF et 6 m). IPO = sans préampli. | Chaque clic passe au suivant. AMP1 / AMP2 aident sur les bandes hautes calmes (15, 10, 6 m) ; sur 80 / 40 m, IPO suffit en général. |
| `AMP` | Préampli en 2 m / 70 cm. | Clic : marche / arrêt. |
| `NB` | Noise blanker : antiparasite pour les bruits d'impulsions (moteurs, clôtures électriques). | Clic : marche / arrêt (le niveau se règle dans le cadre DSP). |
| `DNR` | Réducteur de bruit numérique (souffle). | Clic : marche / arrêt ; niveau dans le cadre DSP. |
| `NOTCH` | Filtre manuel qui creuse une fréquence (un sifflement). | Clic : marche / arrêt ; sa fréquence se règle dans le cadre DSP. |
| `DNF` | Notch automatique : supprime tout seul les porteuses qui sifflent. | Clic : marche / arrêt. À éviter en CW et en modes numériques (il peut supprimer le signal utile). |
| `NAR` | Filtre étroit (NARROW). | Clic : marche / arrêt. |
| `AGC AUTO` | Rappel du réglage d'AGC. | Il se change dans RF front end. |

> [!TIP]
> **FTX-1 : les deux côtés MAIN et SUB**
> - L'écran du VFO B règle NB, DNR, NOTCH, DNF et NAR du côté SUB.
> - ATT et préampli sont propres à chaque côté, mais le TRX ne les donne que pour le côté actif : un clic sur ceux de l'autre VFO fait passer le TRX de ce côté 2 à 3 s, sans émettre, puis revenir. Tant qu'ils n'ont jamais été lus, ils affichent « ? ».
> - Les cadres RF front end, Filtres et DSP règlent le **côté actif** : leur titre indique « A · MAIN » ou « B · SUB ».

<a id="step"></a>
### 7.2 Ligne Step et ligne des bandes

Sous les écrans VFO.

| Commande | Ce qu'elle fait | Quand s'en servir |
|---|---|---|
| `10 Hz` … `100 kHz` (Step) | Choisit le pas des flèches ◀ ▶ et des flèches `↑` `↓` du clavier. | 100 Hz à 1 kHz pour chercher en BLU ; 10 Hz pour un réglage fin ; 10 à 100 kHz pour traverser une bande. |
| `A` / `B` (VFO) | Choisit le VFO que règlent les flèches et les bandes. Sur le FTX-1, fait aussi passer le TRX sur ce côté (comme MAIN / SUB). | Pour travailler sur le VFO B. |
| `◀` `▶` | Descend / monte la fréquence d'un pas. | Recherche pas à pas. |
| `MAIN` / `SUB` | Côté actif du TRX (réception et émission ensemble), comme la touche de la face avant, sans émission. Prend 1 à 2 secondes. **FTX-1 : seulement en double réception (DUAL RX, un VFO en 144 / 430 MHz).** En réception simple, le dashboard refuse : le TRX est passé en émission (constaté au club les 24 et 25/10). Pour écouter la fréquence du VFO B en HF : `A ⇄ B`. Un administrateur peut l'autoriser pour des essais (`ftx1SubSingle`). | FTX-1 : écouter et émettre sur le VFO B. |
| `SPLIT` | Émettre sur l'autre VFO que celui qu'on écoute. | Expéditions DX (section 7.5). |
| `TXW` | **Maintenir** le bouton (ou la touche `W`) : on écoute la fréquence d'émission ; relâcher = retour sur le DX. Les VFO sont remis en place tout seuls (aussi après 15 s ou si la liaison se coupe). Le PTT est refusé tant que TXW est enfoncé. | En SPLIT, pour écouter le pile-up et trouver un trou. |
| `DUAL RX` | FTX-1 : double réception (MAIN et SUB entendus ensemble) ou réception simple. Le FTX-1 refuse la double réception avec les deux VFO en HF / 50 MHz, même sur la même bande (essayé au club : 20 m + 15 m, puis 7,074 + 7,090 MHz) ; il faut qu'un des VFO soit en 144 / 430 MHz. Pour suivre deux stations d'une même bande HF : les deux décodeurs de l'onglet RTTY. | Surveiller deux fréquences. En modes numériques, coupez-le pour ne décoder que le côté actif. |
| `A → B` / `B → A` | Recopie la fréquence et le mode d'un VFO sur l'autre. | Préparer un SPLIT. |
| `A ⇄ B` | Échange les deux VFO. | Passer rapidement d'une fréquence à l'autre. |
| `LOCK` | Verrouille les boutons de la **face avant du TRX au club**. Le dashboard reste utilisable. | Pour qu'une personne au club ne dérègle rien pendant votre trafic. |
| `160M` … `70CM` | Change de bande : le TRX reprend la dernière fréquence et le dernier mode utilisés sur cette bande. Seules les bandes du TRX branché sont proposées. | Changer de bande. Un rappel « **TUNE obligatoire** » clignote ensuite à droite jusqu'au prochain TUNE. |

La ligne grise sous les bandes rappelle les gestes utiles ; la ligne de messages juste en dessous affiche les confirmations et les refus.

<a id="gauche"></a>
### 7.3 Colonne de gauche

**Antenne**

| Commande | Ce qu'elle fait |
|---|---|
| `ANT 1` / `ANT 2` | Choisit la prise d'antenne de l'ampli SPA-1 (FTX-1). Refusé pendant une émission. Le FTDX10 et l'IC-7300 ne permettent pas ce choix à distance (boutons grisés). Après un changement d'antenne, refaites un TUNE. |

**RF front end** (l'entrée du récepteur)

| Commande | Ce qu'elle fait | Conseil |
|---|---|---|
| **RF GAIN** | Sensibilité du récepteur (0 à 100 %). | Laissez au maximum en général ; baissez-le si une bande est très bruyante ou si une station proche sature. |
| **AGC** `OFF` `FAST` `MID` `SLOW` `AUTO` | Commande automatique de gain : vitesse à laquelle le récepteur baisse le volume après un signal fort. | AUTO convient presque toujours. FAST en CW, SLOW en BLU. OFF à éviter (son très fort et distordu). |
| Préampli, ATT | Comme les badges de l'écran VFO (section 7.1). | — |

**Mode**

| Bouton | Utilisation |
|---|---|
| `LSB` / `USB` | Phonie BLU : LSB sous 10 MHz (160, 80, 40 m), USB au-dessus (20 m…). |
| `CW-L` / `CW-U` | Morse (CW-U est le plus courant). |
| `RTTY-L` / `RTTY-U` | RTTY décodé par le TRX lui-même. Pour le RTTY du dashboard, utilisez DATA-U. |
| `DATA-L` / `DATA-U` | Modes numériques par la carte son du TRX : **DATA-U** pour FT8, FT4, FT2, RTTY, JTTY, WSPR, JT65, SSTV du dashboard. |
| `PSK` | PSK31 décodé par le TRX. |
| `AM` / `AM-N`, `FM` / `FM-N`, `DATA-FM` | Modulation d'amplitude, de fréquence (N = étroit), numérique en FM (relais, packet…). |

Sous les boutons, « Mode appliqué à **VFO A** » indique quel VFO change de mode (celui choisi avec A / B).

**Filtres**

| Commande | Ce qu'elle fait | Conseil |
|---|---|---|
| **BW** (WIDTH) | Largeur du filtre de réception. | BLU : 2,4 à 2,7 kHz ; CW : 300 à 500 Hz ; FT8 : 3 kHz (toute la bande audio). |
| **IF SHIFT** | Fait glisser la bande passante vers le haut ou le bas sans changer de fréquence. | Écarter une station gênante d'un côté. Remettez à 0 ensuite. |
| `CONTOUR` | Correcteur de tonalité qui atténue une partie du son. | Rendre une voix plus lisible. |
| `APF` | Filtre audio de pointe, en CW seulement. | Faire ressortir un signal CW faible. |
| `NARROW` | Filtre étroit (badge NAR de l'écran VFO). | Bande encombrée. |
| IC-7300 : **FILTRE**, **PBT** | FIL1 / FIL2 / FIL3 (large, moyen, étroit) et Twin PBT (rétrécir par les deux bords). | — |

**Station meters** (mesures, surtout utiles en émission)

| Mesure | Signification | Valeur normale |
|---|---|---|
| RX / TX | État du TRX ; à droite, durée de l'émission en cours. | — |
| **Po** | Puissance émise (watts). | Celle réglée dans le cadre TX. |
| **SWR** | Accord de l'antenne. | Sous 1,5 ; au-delà de 2,5, l'émission est coupée. |
| **ALC** | L'émetteur est-il poussé trop fort ? | Modes numériques : le plus bas possible (idéalement 0). Phonie : un peu d'ALC sur les pointes. |
| **Id** / **Vd** | Courant et tension de l'étage final. | Pour les responsables (surveillance). |
| **COMP** | Compression du processeur de modulation (phonie). | Quelques dB quand PROC est en service. |
| **S** | S-mètre du côté actif. | — |

<a id="droite"></a>
### 7.4 Colonne de droite

**RX audio**

| Commande | Ce qu'elle fait | Pour qui |
|---|---|---|
| `🔊 Écouter le TRX` | Fait entendre le son du récepteur dans votre navigateur. Un deuxième clic coupe. | Vous seul (pas besoin de la main). |
| **Volume** | Volume de votre écoute (0 à 150 %). | Vous seul. |
| **AF LEVEL** | Volume du haut-parleur du TRX au club. | Tout le monde (avec la main). N'influence pas votre écoute ni les décodeurs. |
| **SQUELCH** | Silencieux : coupe le son tant qu'aucun signal ne dépasse le seuil. | Tout le monde. Utile en FM ; laissez-le à 0 en HF et en numérique, sinon les décodeurs n'entendent plus rien. |

**DSP** (traitement du signal)

| Commande | Ce qu'elle fait |
|---|---|
| **NB** | Niveau de l'antiparasite (OFF, puis 1 à 10). Commencez bas et montez jusqu'à ce que les claquements disparaissent. |
| **DNR** | Niveau du réducteur de bruit (OFF, puis 1 à 10 ; jusqu'à 15 sur le FTDX10). Trop haut, la voix devient « métallique ». |
| `NOTCH` + **Fréq. NOTCH** | Allume le notch manuel et règle sa fréquence (10 à 3200 Hz) : tournez jusqu'à ce que le sifflement disparaisse. |
| `DNF` | Notch automatique. |

**Accord (tuner)**

| Commande | Ce qu'elle fait |
|---|---|
| `TUNER` | Met en service ou hors service la boîte d'accord (celle du SPA-1 pour le FTX-1). Elle est remise en service toute seule à la connexion du TRX et à chaque changement de bande HF / 6 m. |
| `TUNE` | Lance l'accord : le TRX émet une porteuse quelques secondes, le tuner cherche le meilleur réglage. **Obligatoire après un changement de bande** ; vérifiez ensuite le SWR. TUNE compte comme une émission : il faut avoir la main et l'émission autorisée. |

**TX**

| Commande | Ce qu'elle fait |
|---|---|
| Voyant `RX` / `TX` | État réel du TRX (vert en réception, rouge en émission). |
| `PTT` | **Maintenir** pour émettre (ou la barre `Espace`) ; relâcher = retour en réception. Le petit texte en dessous dit pourquoi le PTT est indisponible (« Prenez la main pour émettre »…). |
| **Puissance** `−` `+` | Baisse ou monte la puissance du TRX. Votre limite de licence est affichée en dessous (ex. ON3 : 25 W) ; au-delà, elle est ramenée automatiquement. |
| **Gain micro** | Niveau du micro en phonie. |
| `PROC` + **Niveau PROC** | Processeur de modulation (compresseur) : la voix « porte » mieux dans le bruit. Niveau modéré, sinon la modulation est désagréable. Sur l'IC-7300 : COMP. |
| `VOX` | Émission déclenchée par la voix : peut seulement être **coupé** à distance, jamais activé. |

<a id="split"></a>
### 7.5 Trafic en SPLIT (émission et réception sur deux fréquences)

Le SPLIT sert surtout pour une **expédition DX** qui écoute ailleurs que sur sa fréquence (« UP 5 », « listening 14 200 to 14 210 »). On **écoute le DX sur le VFO A** et on **émet sur le VFO B**.

1. Réglez le **VFO A** sur la fréquence du DX, dans le bon mode. Vérifiez que `RX` est vert sur le VFO A.
2. Cliquez `A → B` : le VFO B prend la même fréquence et le même mode.
3. Réglez la **fréquence d'émission sur le VFO B** avec la molette sur ses chiffres, par exemple +5 kHz pour « UP 5 ». Sur le FTX-1, la molette sur le VFO B ne change pas le côté écouté : vous restez sur A.
4. Cliquez `SPLIT` (ou `TX` sur l'écran du VFO B). Le voyant **TX** et le cadre lumineux passent sur le VFO B ; le rappel indique « Émission sur B ».
5. Écoutez le DX sur A ; **maintenez TXW** (ou `W`) pour écouter le pile-up sur votre fréquence d'émission. Pour l'appeler, **PTT** : l'émission part sur le VFO B (chiffres en rouge). En relâchant, retour en réception sur A.
6. Pour finir : cliquez de nouveau `SPLIT` (ou `TX` du VFO A). Le voyant TX revient sur A.

> [!TIP]
> **Bon à savoir**
> - Règle des TRX : sans SPLIT on émet sur le VFO où l'on écoute ; avec SPLIT, sur l'autre.
> - **FTX-1** : le SPLIT est géré par le dashboard. Au PTT, le TRX passe un instant sur le côté SUB pour émettre puis revient sur MAIN ; c'est normal. Un SPLIT mis sur la face avant est suivi par le dashboard.
> - La fréquence **réellement émise** (VFO B, XIT compris) est contrôlée : hors des bandes autorisées, le PTT est refusé.
> - Petit écart (quelques kHz) : `XIT` sur le VFO A suffit, sans SPLIT.
> - En **FT8 / FT4 / FT2**, inutile de mettre SPLIT : l'émission se place dans la bande audio avec le repère TX de la cascade (clic droit).
> - Coupez le SPLIT en fin de pile-up : sinon, le prochain opérateur émettrait sur le VFO B sans le savoir.

<a id="ecoute"></a>
## 8. Écouter

- Cadre **RX audio** → `🔊 Écouter le TRX`, puis réglez votre **Volume**. Tout le monde peut écouter, même sans la main.
- Le son arrive avec un petit retard (une fraction de seconde) : c'est normal sur internet.
- Si rien ne s'entend : vérifiez le volume de votre PC, puis le voyant Station. La page Station du club doit avoir l'audio activé (section 18). Le message sous le bouton indique ce qui manque.
- **AF LEVEL** et **SQUELCH** agissent sur le TRX lui-même, pour tout le monde.

<a id="emission"></a>
## 9. Émettre et sécurités

1. **Avoir la main** et un compte autorisé à émettre (les écouteurs ONL ne peuvent pas).
2. Être dans une **bande autorisée** pour votre licence.
3. Après un changement de bande : `TUNE`, puis vérifier le **SWR**. Un rappel clignote à droite de la touche 70CM jusqu'au TUNE (en 2 m et 70 cm, pas de tuner : seulement « vérifiez le SWR »). Le tuner du SPA-1 ne travaille qu'en HF et 6 m, et l'ampli doit être allumé.
4. Régler la **puissance** (cadre TX).
5. Émettre : `PTT` maintenu (ou `Espace`), ou les boutons d'émission des modes numériques.

> [!WARNING]
> **Sécurités automatiques** (impossible de les contourner depuis le dashboard) :
> - Émission seulement dans les bandes autorisées, vérifiée sur la fréquence réellement émise (SPLIT et XIT compris).
> - Durée maximale d'une émission : **120 s**, puis coupure ; relâchez le PTT avant de réémettre.
> - Coupure immédiate si vous perdez la liaison, si le PC du club perd internet ou si la page Station se ferme.
> - **ROS** supérieur à 2,5:1, ou **HI-SWR** signalé par le TRX : émission coupée et PTT refusé sur cette fréquence (± 25 kHz) jusqu'à un TUNE réussi.
> - **TUNE sans accord** : si le FTX-1 signale HI-SWR à la fin d'un TUNE, l'émission est **bloquée sur toute la bande** (sauf TUNE) pour protéger l'ampli. Un message rouge s'affiche à droite des bandes. Le blocage tombe dès qu'un TUNE réussit ; sinon, essayez l'autre antenne ou prévenez un responsable.
> - Au club, le TRX repasse en réception s'il émet 2 min sans modulation ou 5 min sans interruption.
> - Puissance ramenée à la limite de votre licence ; indicatifs d'écouteurs : aucune émission.

L'émission n'est possible que si les administrateurs l'ont autorisée sur le serveur.

<a id="operateurs"></a>
## 10. Opérateurs et discussion

- Le volet **Opérateurs** s'ouvre et se ferme avec le bouton `👥` du bandeau. Un point rouge sur `👥` signale un nouveau message.
- Il montre les membres connectés et qui a la main.
- **Discussion** : tapez un message dans « Message aux connectés… » puis `Envoyer` (ou `Entrée`). Tous les connectés le voient. Les messages ne sont pas gardés après un redémarrage du serveur.
- Les boutons `Demander la main à …` et `Passer la main à …` y apparaissent quand c'est utile (section 6).
- L'onglet **Activité** (au centre) est le journal de la station : connexions, prises et passages de main, émissions (fréquence, mode, puissance, durée), accords, coupures de sécurité, station en ligne, TRX connecté…

<a id="disposition"></a>
## 11. Disposition et fenêtres séparées

- Bouton `⧉` en haut à droite d'un cadre : le cadre s'ouvre dans **sa propre fenêtre**, à placer où vous voulez (sur un 2e écran…). Dans cette fenêtre, `⧉ Ramener` le remet dans le dashboard.
- Le bouton `⧉` à droite des onglets ouvre **tous les modes numériques** dans une fenêtre séparée. `⧉ Ramener dans le dashboard` (ou `Ramener ici` dans le dashboard) les remet en place.
- La barre `Espace` (PTT) fonctionne aussi depuis une fenêtre séparée.
- La disposition est retenue : au chargement suivant, les fenêtres se rouvrent à leur place si Chrome **autorise les fenêtres pop-up** pour remote.op0p.be (icône à droite de la barre d'adresse → Toujours autoriser).

<a id="numeriques"></a>
## 12. Modes numériques

Les onglets du centre : **Activité**, **FT8 · FT4 · FT2**, **RTTY**, **WSPR**, **JT65**, **JTTY**, **CW**, **SSTV** et, plus à droite, **Synchro** et **Logs**. Vous n'avez **aucun logiciel à installer** (pas de WSJT-X, FLDIGI…) : tout se fait dans la page.

- Le **décodage se fait sur le serveur**, à l'heure du serveur (synchronisée) : l'heure de votre PC et de celui du club n'a pas d'importance.
- Le son du TRX n'est envoyé que si quelqu'un écoute ou regarde un onglet de mode numérique : les décodages commencent quelques secondes après l'ouverture de l'onglet.
- **Liste des fréquences** (en haut de chaque onglet) : choisir une ligne envoie le TRX sur cette fréquence, en **DATA-U** (en CW pour l'onglet CW). Il faut avoir la main. Le bouton `↺` à côté ramène le TRX sur la fréquence choisie si quelqu'un a tourné le VFO entre-temps.
- **Cascade** : chaque onglet montre le spectre de 0 à 3000 Hz qui défile. Un signal est un trait coloré ; sa position horizontale est sa fréquence audio.
- **Ligne d'état** (à droite de la barre de l'onglet) : signale les problèmes (station hors ligne, BF non activée, TRX pas en DATA-U…) ou l'état du décodeur.
- **Émission** en FT8 · FT4 · FT2, RTTY et JTTY, sous le **TX call** choisi dans la ligne Correspondant (ON5VL ou votre indicatif). Il faut avoir la main et l'émission autorisée. WSPR, JT65, CW et SSTV sont pour l'instant en **réception** seulement *(bientôt)*.

**Réglages de la cascade** (au-dessus de l'échelle, communs à tous les onglets et gardés dans votre navigateur)

| Réglage | Ce qu'il fait |
|---|---|
| **Gain** | Contraste : plus à droite, les signaux faibles ressortent davantage. |
| **Zéro** | Niveau du fond : plus à droite, le fond est plus clair. |
| **Plat** | Rend le bruit de fond égal sur toute la largeur (corrige la pente du filtre du TRX). Laisser coché. |
| **Couleurs** | JTDX (par défaut : bruit bleu, signaux jaunes, forts en rouge), bleu, arc-en-ciel, gris. |
| **Vitesse** | Défilement rapide, normal ou lent (lent = signaux plus ramassés et plus d'historique), comme « Spd » de JTDX. |
| `↺` | Remet les réglages d'origine. |
| Poignée sous la cascade | À glisser vers le haut ou le bas : hauteur de la cascade et des listes (double-clic : taille d'origine). |

<a id="ft8"></a>
### 12.1 FT8 · FT4 · FT2

FT8 est un mode numérique fait pour les signaux très faibles : chaque station émet un court message pendant 15 secondes (une **période**), puis écoute pendant la période suivante. Un QSO complet prend environ une minute et demie. **FT4** est deux fois plus rapide (7,5 s), **FT2** encore plus (3,75 s).

**La barre du haut de l'onglet**

| Commande | Ce qu'elle fait |
|---|---|
| `FT8` / `FT4` / `FT2` | Choisit le mode ; le TRX va sur la fréquence d'appel de ce mode dans sa bande. FT2 est le mode rapide de Decodium (IU8LMC), incompatible avec le « FT2 » de WSJT-X Improved. |
| Liste des fréquences | Fréquences d'appel par bande (ex. 14.074 · 20m), et QO-100 (section 12.9). |
| `↺` | Ramène le TRX sur la fréquence choisie (VFO A, DATA-U). |
| RX … Hz / TX … Hz | Fréquences audio de réception (vert) et d'émission (rouge) dans la bande de 3 kHz. |
| `TX ← RX` | Émettre sur la même fréquence audio que la réception. |
| `RX ← TX` | Recevoir sur la fréquence audio d'émission. |
| **Période** auto / 1re / 2e | Dans quelle période émettre. « auto » : à l'opposé du correspondant choisi (c'est presque toujours ce qu'il faut) ; « 1re » = 00 et 30 s, « 2e » = 15 et 45 s en FT8. |
| ☐ **Répondre au 1er** | Quand vous lancez CQ (Tx6), la première station qui répond devient le correspondant et le QSO se déroule tout seul (« Call 1st » de WSJT-X). |
| `■ Arrêter` | Coupe l'émission automatique tout de suite (« Halt Tx »). La barre `Espace` fait de même. |
| Horloge | Heure UTC du serveur. |

**La cascade** : **clic gauche** = fréquence de réception (drapeau vert « RX 1500 » et trait vert), **clic droit** = fréquence d'émission (drapeau rouge et trait rouge). Choisissez pour l'émission un endroit libre de la cascade. Un trait blanc marque le début de chaque période, avec l'heure UTC et la bande.

**Les deux listes de messages**

- **Activité de bande** (à gauche) : tous les messages décodés. Les **CQ** sont en vert, les messages adressés à votre TX call (ON5VL, OR0L ou le vôtre) en rouge, vos propres émissions en jaune. `Effacer` vide la liste.
- **Fréquence RX** (à droite) : seulement les messages proches de votre fréquence de réception, c'est-à-dire votre QSO en cours.
- Un trait sépare chaque période ; les messages sont classés dans l'ordre chronologique.
- **Largeur des deux listes** : glisser le trait vertical entre elles (double-clic : moitié-moitié).

| Colonne | Signification |
|---|---|
| UTC | Début de la période où le message a été reçu. |
| dB | Rapport signal/bruit (comme WSJT-X) : −24 = très faible, +10 = fort. C'est le report qu'on envoie. |
| DT | Décalage en temps du signal (secondes). Proche de 0 quand tout est bien calé. |
| Fréq | Fréquence audio du signal (Hz). |
| Message | Le texte décodé, par ex. « CQ F4ABC JN18 ». Une marque **a1**…**a7** à la fin indique un décodage obtenu grâce à l'aide a priori (voir plus bas). |
| Pays | Pays DXCC de la station qui émet. |
| km / Az | Distance et direction (azimut en degrés) depuis le club. « ≈ » : approximatif (pas de locator dans le message, centre du pays). |

- **Stations déjà contactées** : les messages d'une station déjà au carnet **sous le TX call actuel**, sur la même bande et dans le même mode, sont en vert barré (« worked before »). Avec un autre TX call, seuls les QSO faits sous cet indicatif comptent.

**Les messages Tx1 à Tx7** (sous les listes, comme dans WSJT-X)

| Message | Exemple | Quand |
|---|---|---|
| `Tx1` | F4ABC ON5VL JO20 | Répondre à un CQ (votre indicatif et locator). |
| `Tx2` | F4ABC ON5VL −12 | Donner le report au correspondant. |
| `Tx3` | F4ABC ON5VL R−12 | Accuser réception de son report et donner le vôtre. |
| `Tx4` | F4ABC ON5VL RR73 | Tout est reçu, au revoir. |
| `Tx5` | F4ABC ON5VL 73 | Dernier message. |
| `Tx6` | CQ ON5VL JO20 | Lancer appel. |
| `Tx7` | texte libre | Message libre de 13 caractères au plus. Clic droit ou `✎` pour le modifier. |

- **Un clic sur un message Tx** le fait partir à **chaque période** (une sur deux) jusqu'à la réponse, comme « Enable Tx » de WSJT-X. Il faut avoir la main, le VFO d'émission en **DATA-U** et une puissance dans votre limite.
- **Répondre à une station** : clic sur son **indicatif** (souligné en pointillé) ou **double-clic** sur son message. Elle devient le correspondant (indicatif, locator, report) et, avec la main, le bon message part dès la période suivante, à l'opposé de la sienne. Un clic ailleurs sur la ligne ne fait que régler la réception.
- **La séquence avance toute seule** d'après la réponse : son locator → Tx2 ; son report → Tx3 ; R+report → Tx4 (RR73) ; RRR ou RR73 → Tx5 (73). Après RR73 ou 73 : fin du QSO, émission coupée, retour sur Tx6, et la fiche **Enregistrer le QSO** s'ouvre déjà remplie.
- **Quand part la réponse** : en FT8, une émission doit commencer au début d'une période (au plus 2,3 s de retard, sinon elle n'est plus décodée ; FT4 : 0,8 s). Les décodages arrivent vers 12,7 s : un clic avant la fin de la période du correspondant (ou dans les 2 premières secondes de la suivante) fait partir la réponse aussitôt. L'émission s'arrête toujours à la fin de la période. Un message en bas de l'écran dit quand votre réponse part.
- **Barre de période** (sous les listes) : verte en réception, rouge en émission ; elle se remplit au cours de la période.
- **Arrêts automatiques** : `■ Arrêter` ou `Espace` ; le correspondant répond à quelqu'un d'autre ; le même message depuis 6 minutes sans réponse ; main perdue.
- En **SPLIT**, le message part sur l'autre VFO, comme le PTT.

> [!TIP]
> **Le décodeur**
> - C'est le moteur de **WSJT-X 3**, avec le décodeur multi-passes de **JTDX**. En FT8, trois passes par période : une anticipée vers 12 s (pour pouvoir répondre tout de suite), une normale à la fin du signal, puis une profonde qui ajoute les stations les plus faibles quelques secondes plus tard.
> - **Aide a priori (AP)** : pendant un QSO, le décodeur sait qui est le correspondant et quel message est attendu ; il le retrouve alors jusqu'à 2 à 3 dB plus bas. Ces décodages portent la marque a1 … a7.
> - Sensibilité : FT8 vers −22 dB (−24 dB avec l'aide a priori), FT4 vers −17,5 dB. Une base de ~100 000 indicatifs (celle de JTDX) écarte les faux décodages très faibles.

<a id="jt65"></a>
### 12.2 JT65

Même fenêtre que FT8, mais avec des périodes d'une minute ; le TRX va sur la fréquence JT65 de sa bande. Les décodages arrivent vers la 52e seconde. Réception seulement.

<a id="rtty"></a>
### 12.3 RTTY

Le RTTY est le « télétype » : on tape du texte qui défile chez le correspondant. Très utilisé en concours. L'onglet a **deux décodeurs indépendants**, côte à côte : **VFO-A** à gauche et **VFO-B** à droite, chacun avec sa cascade, son texte reçu et ses réglages. Ils écoutent tous les deux la BF du TRX : on peut ainsi suivre deux stations de la même bande en même temps (par exemple en concours, ou un DX et son pile-up).

| Commande | Ce qu'elle fait |
|---|---|
| Liste des fréquences + `↺` | Fréquences RTTY par bande (en haut, commune aux deux décodeurs). |
| Fréquence (ex. 14 086,5 kHz) | À côté de VFO-A / VFO-B : fréquence du signal suivi par ce décodeur (porteuse du TRX + centre Mark / Space), utile pour le carnet ou un spot. |
| **Shift** (170, 200, 425, 850 Hz) | Écart entre les deux tonalités du signal. Radioamateurs : 170 Hz. |
| **Vitesse** (45,45 … 100 Bd) | Radioamateurs : 45,45 bauds. |
| `Inversé` | Échange Mark et Space si le texte reçu n'a aucun sens (signal « à l'envers »). |
| **Silencieux** | Plus haut = moins de caractères au hasard sur le bruit ; trop haut, les signaux faibles ne sont plus décodés. |
| Indicateur M / S | Les deux barres doivent battre en alternance quand le décodeur est bien calé. |
| Centre … Hz | Fréquence audio où le décodeur est calé. |
| `TX` | Choisit le décodeur dont les réglages servent à l'émission (fréquence audio, shift, vitesse) : allumé en rouge, avec un cadre rouge autour du décodeur. |
| `Effacer` | Vide le texte reçu de ce décodeur. |
| Trait vertical entre les deux | À glisser à gauche ou à droite : largeur des deux décodeurs (double-clic : moitié-moitié). Réglage gardé dans votre navigateur. |

1. **Recevoir** : cliquez sur un signal dans la cascade de gauche pour y caler le décodeur A, dans celle de droite pour le décodeur B. Les repères jaune (Mark) et bleu (Space) doivent tomber sur les deux traces du signal. Le texte s'affiche sous chaque cascade.
2. **Double-clic sur un indicatif** reçu (à gauche ou à droite) : il devient le correspondant.
3. **Choisir le décodeur de l'émission** : bouton `TX` de son en-tête. Votre réponse part ainsi exactement sur la fréquence de la station que ce décodeur suit.
4. **Émettre** : tapez le texte dans la zone du bas, puis `Émettre` (ou `Ctrl`+`Entrée`). Le texte part avec les réglages du décodeur marqué TX, puis le TRX repasse en réception. Il s'affiche dans la réception de ce décodeur, en gris, puis chaque lettre passe en rouge au moment où elle part (« fin dans N s »). Pendant l'émission, le bouton devient `■ Arrêter`. 600 caractères au plus par envoi.
5. **Macros** `F1` à `F12` (sur une ligne, au-dessus du texte) : un clic émet tout de suite ; **Maj+clic** ajoute la macro au texte sans émettre (section 13).
6. `Effacer` (sous le bouton Émettre) vide le texte à émettre ; `Log QSO` ouvre la fiche du carnet, déjà remplie avec la fréquence du décodeur marqué TX.

> [!NOTE]
> Le TRX n'envoie qu'un seul son au PC. Les deux décodeurs lisent donc la même bande passante (environ 3 kHz autour de la fréquence du VFO qu'on écoute) ; c'est pourquoi les deux cascades montrent le même spectre. Sur le FTX-1 en DUAL RX, ce son mélange MAIN et SUB : le décodeur B peut alors suivre un signal du VFO-B, si sa tonalité audio est différente de celle du VFO-A.

<a id="wspr"></a>
### 12.4 WSPR

Le WSPR sert à étudier la propagation : des balises de faible puissance émettent leur indicatif, leur locator et leur puissance toutes les 2 minutes. Choisissez la bande dans la liste ; une dizaine de secondes après chaque minute paire, la liste se complète : heure, dB, DT, fréquence, dérive, indicatif, locator, puissance et distance depuis la station. Réception seulement.

<a id="jtty"></a>
### 12.5 JTTY

- Mode de WSJT-X 3.3 pour le clavier à clavier et les concours : pas de périodes, chaque message apparaît **trame après trame** (1,9 s) ; `▌` = message en cours de réception.
- Comme en FT8 : clic gauche = réception, clic droit = émission, double-clic = correspondant. Deux listes : Activité JTTY et Fréquence RX.
- Macros `F1` à `F8` : un clic émet tout de suite, **Maj+clic** les ajoute au message.
- `Émettre` (ou `Entrée`) : le message part tout de suite sur la fréquence TX, puis retour en réception. 80 caractères par message (au-delà : deux messages à la suite) ; TRX en **DATA-U**.

<a id="cw"></a>
### 12.6 CW

| Commande | Ce qu'elle fait |
|---|---|
| Liste des fréquences + `↺` | Fréquences CW par bande ; le TRX passe en CW. |
| **Filtre** 50 … 400 Hz | Largeur du filtre du décodeur : 100 Hz par défaut, 50 Hz en cas de QRM, 200 à 400 Hz pour chercher. |
| **Silencieux** | Plus haut = moins de lettres au hasard sur le bruit. |
| Voyant et barre de niveau | Suivent la manipulation : le voyant clignote au rythme du morse quand le décodeur est bien calé. |
| Tonalité / Vitesse | Fréquence audio suivie et vitesse mesurée (mots/minute). |

- **Cliquez sur un signal** dans la cascade : le décodeur se cale sur le signal le plus proche et apprend sa vitesse. Clic droit : calage exact là où vous cliquez.
- Double-clic sur un indicatif reçu = correspondant ; `Log QSO` ouvre la fiche du carnet.
- Partie **Émission** (vitesse, macros `F1` à `F12`, texte) : préparée, l'émission CW arrivera dans une prochaine version.

<a id="sstv"></a>
### 12.7 SSTV

- **Réception** : les images arrivent toutes seules (code VIS) et s'affichent ligne après ligne. Modes Martin, Scottie, Robot et PD. La **galerie** garde les 12 dernières (clic = afficher) ; `PNG` enregistre l'image affichée sur votre PC.
- **Préparer une image** : `Images du PC…` (ou glisser-déposer une image), carte CQ, mire ou image reçue ; elle est recadrée au format du mode choisi. Trois lignes de texte (haut, centre, bas) avec les balises `<CALL>`, `<MYCALL>`, `<RST>`… ; taille et couleur du texte. Clic droit sur une vignette : la retirer.
- `▶ Écouter` joue le signal sur votre PC (sans émettre) ; `WAV` l'enregistre en fichier. L'émission SSTV arrivera dans une prochaine version.

<a id="synchro"></a>
### 12.8 Synchro

Un onglet de contrôle : il montre si les horloges et la liaison sont bien calées. Vous n'avez rien à régler.

| Case | Signification |
|---|---|
| Heure du serveur (UTC) | La référence de tous les décodages. |
| Votre PC | Écart actuel de l'horloge de votre PC avec le serveur, en millisecondes. N'a pas d'importance pour le dashboard. À ne pas confondre avec la colonne « Offset » de NetTime ou Meinberg (écart **avant** leur dernière correction). |
| Liaison station → serveur | Délai d'arrivée du son du club, mesuré et corrigé automatiquement. |
| DT médian | Moyenne des DT des derniers décodages FT8 / FT4 : proche de 0,0 s = tout est calé. |
| Décodages | Heure d'arrivée de chaque passe du décodeur après le début de la période. Si la passe normale arrive plus de 2 s après la fin de la période, le serveur est trop chargé et certaines réponses partent une période plus tard. |

<a id="qo100"></a>
### 12.9 QO-100

QO-100 est un satellite géostationnaire qu'on atteint en 2,4 GHz avec un convertisseur. Les listes FT8 · FT4, RTTY et CW proposent « **QO-100 · FI 2 m / 70 cm** » : la fréquence à mettre sur le TRX **avant le convertisseur**, pour monter sur 2400,040 MHz (FT8 / FT4), 2400,025 MHz (CW) ou 2400,090 MHz (RTTY). Exemple : FT8 sur **432,540 MHz** avec le convertisseur 70 cm du club. Seules les FI que le TRX branché peut atteindre sont proposées (FTX-1).

<a id="messages"></a>
## 13. Correspondant, macros et balises

**La ligne Correspondant** (tout en bas de l'écran)

| Champ | Ce qu'il contient |
|---|---|
| **Correspondant** | L'indicatif de la station contactée. Il se remplit tout seul quand vous cliquez sur un indicatif dans un onglet ; vous pouvez aussi le taper. |
| **Nom**, **QTH**, **Locator** | Prénom, ville et locator du correspondant. Ils sont cherchés sur **QRZ.com** dès qu'un nouveau correspondant est choisi (si un compte QRZ est réglé par les administrateurs) ; seules les cases vides sont remplies. |
| **RST TX** / **RST RX** | RST TX = report **envoyé** par la station du club ; RST RX = report **reçu** du correspondant. En FT8 / FT4 / FT2, WSPR et JT65 ce sont des dB (RST RX se remplit tout seul pendant la séquence) ; en RTTY, CW, SSTV et JTTY, des RST 599. |
| **TX call** | Indicatif des émissions numériques et du carnet : celui de la station (ON5VL) ou le vôtre. Choisi par celui qui a la main et retenu pour la prochaine fois. Les messages Tx1 à Tx6, les macros `<MYCALL>` et la fiche du carnet suivent. Un QSO enregistré sous votre indicatif reste dans le carnet du club, mais n'est pas envoyé vers les comptes en ligne du club (récupérez-le avec Exporter → Mes QSO). |
| `Log QSO` | Ouvre la fiche « Enregistrer le QSO », déjà remplie avec ces informations, la fréquence et le mode. |

**Les macros** (RTTY, JTTY, CW) sont des textes tout prêts, sur une ligne au-dessus de la zone de texte : **F1 à F12** en RTTY et CW, **F1 à F8** en JTTY.

- Une macro qui commence par `<TX>` (liseré rouge à gauche ; c'est le cas de toutes les macros d'origine) **part tout de suite à l'émission** au clic ou avec sa touche `F1`…, puis le TRX repasse en réception.
- **Maj+clic** : ajoute la macro au texte à émettre sans émettre, pour composer un message puis « Émettre ».
- Une macro sans `<TX>` (et toutes les macros CW) s'ajoute simplement au texte.
- **Clic droit** sur une macro (ou `✎`) : la modifier — nom, texte, aperçu, retour au texte d'origine. Vos macros sont gardées sur le serveur, pour vous seul.
- Si une macro contient `<CALL>` alors qu'aucun correspondant n'est choisi, rien ne part.

| Balise | Remplacée par | Balise | Remplacée par |
|---|---|---|---|
| `<MYCALL>` | indicatif émis (TX call) | `<CALL>` | correspondant |
| `<NAME>` | son prénom | `<QTH>` | son QTH |
| `<RST>` | report envoyé | `<LOC>` | son locator |
| `<MYLOC>` | locator de la station | `<MYQTH>` | QTH de la station |
| `<OPCALL>` | votre indicatif (opérateur) | `<CNTR>` | numéro de série (001…) |
| `<INCR>` | passe au numéro suivant | `<ZT>` / `<ZD>` | heure / date UTC |
| `<TX>` | en tête : émission immédiate au clic | `<RX>` | retour en réception à la fin (toujours fait) |
| `<LOG>` | ouvre la fiche « Enregistrer le QSO » |  |  |

<a id="logs"></a>
## 14. Logs (carnet de trafic)

Onglet **Logs** (à droite de Synchro) : le carnet de trafic de la station, partagé par tous les membres. Il sait envoyer les QSO vers **LoTW**, **eQSL**, **Club Log** et **QRZ.com**, les exporter en **ADIF** ou **Cabrillo**, et les transmettre en **UDP** aux logiciels de carnet du PC (Swisslog, HRD Logbook, Log4OM, N1MM Logger+…).

<a id="l-fiche"></a>
### 14.1 Enregistrer un QSO

La fiche en haut de l'onglet :

| Champ / bouton | Ce qu'il fait |
|---|---|
| **Indicatif** | L'indicatif du correspondant. La date et l'heure UTC se remplissent dès la première lettre tapée (début du QSO). Le nom, le QTH et le locator sont cherchés sur QRZ.com. |
| **Date UTC**, **Heure UTC** | Début du QSO, en heure UTC (pas l'heure belge). |
| `⟳ Maintenant` | Remet la date et l'heure à l'instant présent. |
| **Fréquence MHz**, **Mode** | Suivent tout seuls le VFO actif du TRX. Une valeur tapée à la main reste jusqu'au QSO suivant. |
| `⇩ TRX` | Reprend la fréquence et le mode du TRX (en DATA : le mode de l'onglet affiché, FT8, RTTY…), la puissance, et la ligne Correspondant (indicatif, nom, QTH, locator). |
| **RST env.** / **RST reçu** | Report envoyé et reçu (59, 599 ou dB selon le mode). |
| **Nom**, **QTH**, **Locator**, **Puiss. W**, **Remarque** | Informations du QSO ; la remarque est libre. |
| **TX call** | Indicatif sous lequel le QSO a été fait. Il suit celui de la ligne Correspondant ; avec la main, le changer ici change aussi l'indicatif d'émission. |
| ☐ **QO-100** | QSO par le satellite QO-100 : avec la FI du convertisseur (ex. 432,525 MHz), la case se coche toute seule et la fréquence de montée 2400,xxx MHz est enregistrée. |
| `Enregistrer le QSO` (ou `Entrée`) | Ajoute le QSO au carnet. Un doublon (même indicatif, bande et mode dans la demi-heure) est signalé avant l'enregistrement ; si la fiche déjà au carnet n'a pas le nom, le QTH, le locator ou le RST reçu, on propose de la **compléter** au lieu de créer un 2e QSO. |
| `Supprimer` / `Annuler` | Apparaissent quand vous modifiez un QSO existant : supprimer le QSO (après confirmation ; les carnets en ligne ne sont pas modifiés) ou abandonner la modification. |

**Sans quitter l'onglet RTTY, JTTY ou CW** : le bouton `Log QSO` (à côté de « Émettre », et au bout de la ligne Correspondant) ouvre une fiche déjà remplie : indicatif, prénom, QTH, locator et RST, fréquence (en RTTY : celle du signal) et mode, puissance, heure de début (quand le correspondant a été choisi) et de fin. Corrigez au besoin, puis `Enregistrer dans le carnet`. En FT8, cette fiche s'ouvre toute seule à la fin du QSO ; une macro qui contient `<LOG>` l'ouvre aussi.

<a id="l-liste"></a>
### 14.2 La liste des QSO

- La liste montre les 300 derniers QSO. La case **Rechercher** trouve un indicatif, un nom ou un opérateur ; le nombre de QSO trouvés s'affiche à côté.
- **Clic sur une ligne** : le QSO se charge dans la fiche pour être modifié ou supprimé (par son auteur ou un administrateur).
- **Largeur des colonnes** : glisser le bord droit d'un titre de colonne (double-clic : largeur d'origine). Réglage gardé dans votre navigateur.
- **Filtres** : le **▾** à côté de chaque titre propose les valeurs de la colonne (dates, bandes, modes, pays, TX call, état des envois…) avec leur nombre de QSO. Un choix filtre le carnet (le ▾ devient ●) ; plusieurs colonnes se combinent ; `✕ Filtres` les retire tous.

| Colonne | Signification |
|---|---|
| Date, UTC | Date et heure UTC du début du QSO. |
| Indicatif | Le correspondant. |
| Bande, MHz, Mode | Bande, fréquence exacte et mode. |
| Env., Reçu | Reports envoyé et reçu. |
| Nom, QTH | Prénom et ville du correspondant. |
| DXCC, Préfixe | Pays du correspondant (d'après son indicatif) et son préfixe principal (ON pour la Belgique, LA pour la Norvège, K pour les USA…). |
| TX call | L'indicatif sous lequel le QSO a été fait ; l'opérateur s'affiche au survol. |
| LoTW, eQSL, CL, QRZ | État de l'envoi vers chaque service : **·** pas encore envoyé, **✓** envoyé, **✗** refusé (survol = détail), **★** confirmé sur LoTW. |

<a id="l-export"></a>
### 14.3 Exporter

| Menu Exporter ▾ | Ce qu'il fait |
|---|---|
| **Mes QSO (.adi)** | Télécharge tout de suite les QSO faits sous **votre** indicatif (TX call), à importer dans votre propre logiciel de carnet. |
| **ADIF (.adi)…** | Fenêtre de choix : TX call et plage de dates, puis téléchargement d'un fichier ADIF 3. Un membre exporte ses QSO (sous son indicatif, ou ceux qu'il a faits lui-même sous ON5VL / OR0L : « mes QSO sous cet indicatif ») ; les administrateurs exportent tous les TX call. |
| **Cabrillo (.log)…** | Même choix, plus le nom du concours : fichier Cabrillo 3 à envoyer aux organisateurs d'un concours. |

<a id="l-sync"></a>
### 14.4 Synchronisation (LoTW, eQSL, Club Log, QRZ)

Menu **Synchronisation ▾**, réservé aux administrateurs : il envoie les QSO du carnet vers les sites de confirmation. Une fenêtre par service, comme dans Swisslog.

1. Choisissez le service : **Synchronisation LoTW…**, **Synchronisation eQSL…**, **Club Log…** ou **QRZ…**.
2. Onglet **Détails** : choisissez l'**indicatif (TX call)** dont les QSO partent (le TX call en cours est proposé).
3. Juste en dessous, le cadre jaune **« Identifiants <service> de <indicatif> »** montre les identifiants qui seront utilisés : identifiant, mot de passe, clé… Une note dit s'ils sont propres à cet indicatif, s'ils viennent de la configuration du club, ou ce qui manque. Complétez-les si besoin, puis `Enregistrer pour cet indicatif`. Les mots de passe restent sur le serveur et ne sont jamais affichés : un champ laissé vide garde la valeur enregistrée, `✕` l'efface, `👁` montre ce que vous tapez.
4. Facultatif : **plage de dates**, **Renvoyer aussi les QSO déjà envoyés**, **Temporisation** (pause en secondes entre deux QSO, pour ne pas être bloqué par le site). Club Log : « Effacer le log ClubLog existant » remplace tout le log en ligne (à n'utiliser que si ce carnet est complet). Le nombre de QSO à envoyer s'affiche en bas.
5. `Télécharger` : l'envoi commence ; l'onglet **Traitement** montre la progression et le compte rendu, QSO par QSO. `Arrêt` l'interrompt ; `Fermer` ferme la fenêtre : l'envoi continue sur le serveur et sa progression reste affichée sous la liste du carnet.

- **Indicatifs du club et indicatifs personnels** : les identifiants de la configuration générale (14.5) ne servent qu'aux indicatifs du club (ON5VL, OR0L). Un indicatif personnel (ON6DP…) a besoin de **ses propres identifiants**, sinon ses QSO sont marqués « non configuré ». Un envoi qui mélange plusieurs TX call est fait groupe par groupe, chacun avec ses identifiants.
- **Opérations LoTW** : exporter, signer avec TQSL, envoyer, lire les confirmations, statut. `Confirmations` lit seulement les confirmations reçues (★ dans la liste). Avec le serveur sur le VPS (sans TQSL) : `Exporter pour TQSL (.adi)`, signez le fichier avec TQSL sur le PC du club, puis `Marquer comme envoyés`.

<a id="l-config"></a>
### 14.5 Configuration

**Synchronisation ▾ → ⚙ Configuration…** (administrateurs) : les réglages généraux, en onglets **CLUBLOG**, **eQSL**, **LoTW**, **QRZ** et **UDP**.

- Case **« Télécharger automatiquement les QSO lors de leur enregistrement »** : chaque nouveau QSO sous un indicatif du club part tout seul vers ce service.
- Identifiants et mots de passe du club (`👁` pour les voir pendant la saisie), temporisation, et `Tester` pour vérifier la connexion au service. La fenêtre n'affiche que « enregistré » pour les mots de passe ; laisser le champ vide garde la valeur, `✕` l'efface.
- Onglet **QRZ**, **Recherche des correspondants** : identifiant et mot de passe d'un compte QRZ.com. Dès qu'un correspondant est choisi (clic sur un indicatif, ligne Correspondant, fiche du carnet), son prénom, sa ville et, avec un abonnement XML, son locator sont remplis tout seuls (cases vides seulement), avec un rappel « QRZ.com : … » sous les bandes.
- Onglet **UDP** : envoi de chaque QSO aux logiciels de carnet (adresse, port, format).

| Service | À préparer |
|---|---|
| Club Log | E-mail du compte, mot de passe d'application (Club Log → Settings → App Passwords), clé API de l'application (demandée une fois au helpdesk Club Log). Un refus d'accès arrête les envois jusqu'au prochain test réussi. |
| eQSL | Indicatif et mot de passe eQSL ; « QTH Nickname » si le compte a plusieurs QTH. |
| QRZ.com | Une clé API du carnet QRZ par indicatif (QRZ → Logbook → Settings), abonnement XML ou supérieur. |
| LoTW | **TQSL** et le **certificat** de l'indicatif installés sur le PC où tourne le serveur, le nom du « Station Location » de TQSL, et l'identifiant du site LoTW pour les confirmations. Le certificat et son mot de passe ne quittent jamais ce PC. |
| UDP | Adresse, port et format attendus par le logiciel : WSJT-X « Logged ADIF » (Swisslog, Log4OM, HRD Logbook ; port 2237 en général), N1MM (port 12060), ou ADIF brut. Les paquets partent du serveur : 127.0.0.1 si le serveur tourne sur le PC du club. |

<a id="clavier"></a>
## 15. Raccourcis clavier

| Touche | Action |
|---|---|
| `Espace` (maintenir) | PTT ; en FT8 / FT4 / FT2, arrête l'émission automatique. Fonctionne aussi depuis une fenêtre séparée. |
| `W` (maintenir) | TXW : écoute de la fréquence d'émission (SPLIT). |
| `↑` `↓` | Fréquence ± un pas (celui de la ligne Step). |
| `F1` … `F12` | Macros dans les onglets RTTY et CW (`F1`…`F8` en JTTY). |
| `Ctrl` + `Entrée` / `Entrée` | Émettre le texte tapé en RTTY / en JTTY. |
| `Entrée` (fiche du carnet) | Enregistrer le QSO. |
| `Maj` + molette | Décalage RIT / XIT par pas de 100 Hz. |
| `Ctrl` + `F5` | Recharger la page après une mise à jour. |

Ces touches sont ignorées pendant que vous tapez dans un champ de texte.

<a id="problemes"></a>
## 16. Problèmes fréquents

| Symptôme | Cause probable et solution |
|---|---|
| Affichage bizarre, bouton qui ne réagit pas après une mise à jour | Ancienne version en mémoire : `Ctrl` + `F5`. |
| « Ce navigateur n'est ni Chrome ni Edge » | Ouvrez la page dans Google Chrome ou Microsoft Edge. |
| Voyant Serveur rouge | Votre connexion internet est coupée ; la page se reconnecte toute seule quand elle revient. |
| « Station hors ligne » | La page Station du PC du club est fermée ou le PC n'a plus internet : prévenez un responsable du club. |
| Pas de son, cascade vide, « La page Station n'envoie pas la BF » | Au club, la page Station doit avoir l'audio activé et la bonne entrée son (section 18). Chez vous, vérifiez le volume du PC et le curseur Volume. |
| Commandes grisées, « Prenez la main… » | Vous n'avez pas la main : `Prendre la main` ou `Demander la main`. |
| Rien n'est décodé en FT8 / RTTY… | Vérifiez le mode du TRX (DATA-U ; CW en CW), la fréquence (bouton ↺), le SQUELCH à 0, et DUAL RX coupé. L'onglet Synchro montre si la BF arrive. |
| Ma réponse FT8 part une période trop tard | Le clic est arrivé trop tard (après 2 s dans la période suivante). Cliquez dès que le décodage s'affiche. Si cela arrive souvent, regardez la case « Décodages » de l'onglet Synchro. |
| PTT refusé | Le message indique la raison : hors bande autorisée, ROS (faire TUNE), émission non autorisée, indicatif d'écouteur, durée maximale, TXW enfoncé… |
| Le badge TX est rouge alors que je n'émets pas | Normal : rouge foncé = VFO d'émission. L'émission réelle se voit aux chiffres de la fréquence en rouge et au badge TX rouge vif. |
| Clic sur ATT / IPO de l'autre VFO : le TRX change de côté un instant | Normal sur le FTX-1 : ces réglages ne se font que sur le côté actif ; le TRX y passe 2 à 3 s, sans émettre, puis revient. |
| « TUNE sans accord », émission bloquée sur la bande | L'antenne ne s'accorde pas sur cette fréquence : refaites un TUNE, essayez l'autre antenne ou une autre bande, et prévenez un responsable. |
| Une fenêtre séparée ne s'ouvre pas | Autorisez les fenêtres pop-up pour remote.op0p.be (icône à droite de la barre d'adresse). |
| Nom et QTH pas remplis | Le compte QRZ.com n'est pas réglé, ou la station n'est pas sur QRZ.com : tapez-les à la main. |
| Synchronisation : « non configuré » | Pas d'identifiants pour ce TX call : complétez le cadre « Identifiants … » de la fenêtre de synchronisation (14.4). |
| « Passage MAIN ↔ SUB refusé en réception simple » | Normal sur le FTX-1 : en réception simple, un passage sur SUB par le dashboard l'a mis en émission (constaté au club). En HF, il n'écoute qu'un côté à la fois : pour écouter la fréquence du VFO B, `A ⇄ B`. Le VFO B se règle quand même (molette, flèches, bandes). |
| « Passage MAIN ↔ SUB par le dashboard désactivé » | Un administrateur a mis `ftx1SubCat` à `false` dans `config.json` : MAIN / SUB sur la face avant seulement. |

<a id="admin"></a>
## 17. Pour les administrateurs

Un clic sur le voyant `● Station` ouvre le menu **TRX du club** :

| Commande | Ce qu'elle fait |
|---|---|
| Nom d'un TRX (FTX-1, FTDX10, IC-7300) | Passe sur ce TRX, après confirmation. La station redémarre quelques secondes et la main est conservée. Le TRX doit être branché au PC du club et son port choisi une fois sur la page Station. Impossible pendant une émission. |
| `↻ Recharger la page Station` | Recharge à distance la page Station du PC du club (nouvelle version, page bloquée…). La station revient en une dizaine de secondes. |
| `⌨ Lecture CAT…` | Diagnostic : lit une valeur brute du TRX (lecture seulement, liste de commandes autorisées). |

Les administrateurs ont aussi accès au menu Synchronisation du carnet (14.4 et 14.5), à l'export de tous les TX call, et peuvent reprendre la main (section 6). La gestion des membres, des mots de passe et du serveur est décrite dans `LISEZMOI.md` et `README.md` (dépôt du projet).

<a id="club"></a>
## 18. Le PC du club (page Station)

Pour les responsables du club. Le PC relié au TRX ouvre **https://remote.op0p.be/station** dans Chrome (Web Serial). Sous Windows 10 / 11, l'installateur **RemoteStation-Setup** fait le nécessaire : raccourci « Remote Station - Page Station » (Chrome avec les bons réglages), lancement au démarrage de Windows, pas de mise en veille ; il peut aussi installer le serveur lui-même sur ce PC (voir LISEZMOI-WINDOWS).

La page Station est **réservée aux administrateurs** : à la première ouverture sur un PC, connectez-vous avec l'indicatif et le mot de passe d'un administrateur. Ce PC reste autorisé un an (renouvelé à chaque ouverture), jusqu'à « Se déconnecter ». Un membre non administrateur est refusé. Le navigateur du PC du club, qui garde le jeton de la station, se reconnecte aussi tout seul.

1. Coller le **jeton de station** (donné par l'administrateur du serveur), choisir le **modèle** du TRX et son **port CAT** (la première fois). FTX-1 : l'**Enhanced COM Port** (CAT-1), et sur le TRX les réglages **RPTT SELECT** et **PC KEYING** sur OFF (réglage d'usine) : l'émission se commande par CAT.
2. **Activer l'audio** et choisir l'entrée son du TRX (souvent « USB Audio CODEC ») ; la barre de niveau doit bouger.
3. **Sortie son vers le TRX** (émission FT8 / FT4 / FT2, RTTY, JTTY) : la carte son USB du TRX (« Haut-parleurs (USB Audio CODEC) »…), choisie toute seule si possible. Jamais les haut-parleurs du PC. Le TRX doit prendre la modulation DATA sur l'USB (menu du TRX). Régler le **niveau d'émission** pour que l'ALC reste faible. Limiteur facultatif : avec `"digiAlcMax": 8` dans `config.json`, la page Station **baisse toute seule** ce niveau dès que l'ALC dépasse 8 % en émission numérique, et garde le niveau atteint pour les émissions suivantes ; il ne remonte jamais tout seul. Par défaut (`0`), pas de limiteur. L'émission part à l'heure du serveur, même si l'horloge de Windows est décalée.
4. Garder la page Station **seule dans sa fenêtre** ; ouvrir le dashboard avec son bouton « Ouvrir le dashboard dans une autre fenêtre ».
5. Chrome → Paramètres → Performances : garder remote.op0p.be toujours actif ; Windows : mise en veille sur Jamais.

Installation et réglages du serveur : voir `LISEZMOI.md` et `README.md` (dépôt du projet).
