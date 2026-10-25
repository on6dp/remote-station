<!-- Fichier produit par native/manual2md.js à partir de public/aide.html : modifier la page HTML, puis relancer le script. -->

# Remote Station UBA-LGE — manuel d’utilisation

*Version en ligne : bouton **HELP** du dashboard ou https://remote.op0p.be/aide — [English version](USER-MANUAL.md)*

- [1. Se connecter](#connexion)
- [2. L'écran](#ecran)
- [3. Prendre et passer la main](#main)
- [4. Piloter le TRX](#trx)
   - [4.1 Toutes les commandes](#commandes)
   - [4.2 Trafic en SPLIT](#split)
- [5. Écouter](#ecoute)
- [6. Émettre et sécurités](#emission)
- [7. Opérateurs et discussion](#operateurs)
- [8. Disposition et fenêtres séparées](#disposition)
- [9. Modes numériques](#numeriques)
   - [9.1 FT8 · FT4 · FT2](#ft8)
   - [9.2 JT65](#jt65)
   - [9.3 RTTY](#rtty)
   - [9.4 WSPR](#wspr)
   - [9.5 JTTY](#jtty)
   - [9.6 CW](#cw)
   - [9.7 SSTV](#sstv)
   - [9.8 Synchro](#synchro)
   - [9.9 QO-100](#qo100)
- [10. Correspondant, messages et macros](#messages)
- [11. Raccourcis clavier](#clavier)
- [12. Problèmes fréquents](#problemes)
- [13. Le PC du club (page Station)](#club)
- [14. Logs (carnet de trafic)](#logs)

> [!NOTE]
> Le dashboard fonctionne dans un navigateur récent (Chrome, Edge, Firefox) sur PC, Mac, tablette ou téléphone. Il est conçu pour un écran de **1920 × 1080** ou plus ; sur un écran plus petit, les cadres se réorganisent. Après une mise à jour du serveur, faites `Ctrl` + `F5` pour recharger la page.

<a id="connexion"></a>
## 1. Se connecter

1. Ouvrez [https://remote.op0p.be](https://remote.op0p.be).
2. Entrez **votre indicatif** et **votre mot de passe** (donnés par un administrateur du club), puis **Se connecter**.
3. Le navigateur reste connecté **7 jours** : en rechargeant la page, vous revenez directement au dashboard.
4. **Déconnexion** (en haut à droite) ferme la session et oublie le navigateur : à faire sur un PC partagé.

Les indicatifs d'**écouteurs** (ONL…) peuvent tout voir et tout écouter, mais pas émettre ni régler la puissance. Après 15 minutes sans aucune action, vous êtes déconnecté (un avertissement apparaît une minute avant, avec un bouton « Rester connecté ») — jamais pendant une émission.

<a id="ecran"></a>
## 2. L'écran

### Bandeau du haut

| Élément | Signification |
|---|---|
| `● Serveur` | Liaison entre votre navigateur et le serveur (vert = connecté). |
| `● Station` | La page Station du PC du club est en ligne. Pour les administrateurs, un clic ouvre le choix du TRX. |
| `● FTX-1 FTDX10 IC-7300` | Le TRX branché (en surbrillance) et sa liaison CAT. |
| `👥 n` | Nombre de membres connectés ; un clic ouvre le volet **Opérateurs** (qui est là, qui a la main, discussion). Point rouge = nouveau message. |
| `Prendre la main` | Devenir l'opérateur (voir section 3). |
| `DX Cluster ▾` | Ouvre dans un nouvel onglet l'un des deux clusters : **dx.op0p.be** (Ultimate Cluster) ou **cluster.op0p.be** (CC-Cluster OP0P). |
| `HELP` | Ce manuel (en français ou en anglais selon la langue du navigateur). |

### Les colonnes (écran large)

1. **Gauche** : Antenne, RF front end, Mode, Filtres, Station meters.
2. **Centre** : VFO A et B (MAIN / SUB), ligne Step (pas, A / B, ◀ ▶, MAIN / SUB / SPLIT, A → B, B → A, A ⇄ B, LOCK) et bandes, puis « Activité et modes numériques » avec la ligne **Correspondant** sous les onglets.
3. **Droite** : RX audio, DSP, Accord (tuner), TX.
4. **Opérateurs** : volet du bouton `👥` du bandeau (nombre de connectés), fermé par défaut.

Chaque cadre se replie avec la petite flèche `▾` devant son titre, et peut s'ouvrir dans sa propre fenêtre avec `⧉` (section 8).

<a id="main"></a>
## 3. Prendre et passer la main

- Une seule personne **a la main** (pilote le TRX) ; tout le monde voit et entend.
- **Prendre la main** : bouton du bandeau, si personne ne l'a.
- Si quelqu'un l'a déjà : **Demander la main** dans le volet Opérateurs (bouton `👥` du bandeau ; il reçoit la demande et son volet s'ouvre) ou lui écrire un message. Celui qui a la main peut la **passer** à un autre membre.
- **Libérer la main** en partant. Elle est libérée automatiquement après **15 minutes** sans action.
- Sans la main, les commandes sont grisées et un message rappelle « Prenez la main ».
- **Suivre l'opérateur** (formation à distance) : bouton `👁 Suivre` à droite des onglets des modes numériques. Allumé (vert), votre dashboard affiche le même onglet que celui qui a la main (RTTY, FT8 / FT4 / FT2, CW…) et en change avec lui ; la fréquence, le mode et les réglages du TRX sont de toute façon communs à tous. Cliquer soi-même sur un autre onglet arrête le suivi ; un clic sur 👁 Suivre le relance. Le bouton n'apparaît pas chez celui qui a la main.

<a id="trx"></a>
## 4. Piloter le TRX

### Fréquence (cadre VFO)

- **Molette** sur les chiffres, ou **glisser** sur les chiffres ; flèches `↑` `↓` du clavier ; boutons `◀` `▶`.
- Le pas se choisit dans **Step** (10 Hz à 100 kHz). `A` / `B` : sur le FTX-1, comme **MAIN / SUB** (le TRX passe de ce côté) ; sur le FTDX10 et l'IC-7300, choix du VFO réglé. La molette sur les chiffres d'un VFO règle toujours celui-là.
- **Bandes** : 160 m à 70 cm (selon le TRX).
- Sur chaque écran VFO : RX en vert = VFO qui reçoit ; TX rouge foncé = **VFO d'émission** (c'est là que partirait l'émission ; il reste allumé en réception). **Émission réelle** : TX rouge vif avec halo, chiffres de la fréquence en rouge, voyant TRX du bandeau rouge. **Clic sur RX** d'un VFO : il devient le VFO de réception (MAIN / SUB, pas sur l'IC-7300). **Clic sur TX** : il devient le VFO d'émission. Règle des TRX : **sans SPLIT on émet sur le VFO où l'on écoute, avec SPLIT sur l'autre** (RX A → TX B ; RX B → TX A). Pendant l'émission, sa fréquence s'affiche en rouge ; un VFO qui ne sert ni à recevoir ni à émettre (VFO B hors SPLIT) a sa fréquence grisée. Le **cadre lumineux** entoure le VFO d'émission ; le VFO réglé par la molette, les flèches et les bandes a sa lettre soulignée (clic sur l'écran VFO pour le choisir).

### Mode et filtre

**Molette de la souris sur « BW »** (en haut de chaque écran VFO) : largeur de filtre de ce VFO. Sur le FTX-1, le VFO B règle le filtre du récepteur SUB.

- **Mode** : LSB, USB, CW-L/CW-U, RTTY, DATA-L/DATA-U (modes numériques), AM, FM… (appliqué au VFO indiqué).
- **Filtres** : largeur BW, IF SHIFT, CONTOUR, APF (en CW). NARROW : badge **NAR** de l'écran VFO.

### Antenne

Cadre **Antenne**, en haut à gauche : `ANT 1` / `ANT 2` sur le FTX-1 (prises de l'ampli SPA-1). Le FTDX10 et l'IC-7300 ne permettent pas ce choix à distance (boutons grisés). Le changement d'antenne est refusé pendant une émission.

### RF front end, DSP, deux VFO

- **RF front end** : RF gain, AGC. ATT et préampli (IPO / AMP1 / AMP2, AMP) : badges de l'écran VFO.
- **DSP** : NB, DNR, NOTCH (et sa fréquence), DNF.
- **FTX-1 : MAIN / SUB** (ou A / B) choisit le côté actif du TRX, réception et émission ensemble, exactement comme la touche MAIN / SUB de la face avant, sans émission. Le changement prend une à deux secondes. (Technique : commande CAT VS seule, d'après le manuel CAT de Yaesu.)
- **FTX-1 : les cadres RF front end, Filtres et DSP règlent le côté actif du TRX** (étiquette « A · MAIN » / « B · SUB » dans leur titre, sur la même ligne) : SUB actif → RF gain, AGC, BW, IF SHIFT, CONTOUR, APF, NB, DNR, NOTCH, DNF du côté SUB. Les touches A / B de la ligne des pas font comme MAIN / SUB (VFO réglé et côté actif du TRX) ; molette sur les chiffres de l'autre VFO pour changer sa fréquence sans changer de côté.
- **MAIN / SUB, SPLIT, A → B, B → A, A ⇄ B, LOCK** : sur la ligne des pas (Step), après ◀ ▶. Le décalage RIT / XIT se règle sur chaque écran VFO (molette sur la valeur, CLEAR pour le remettre à zéro).
- **RIT / XIT / CLEAR** sur chaque écran VFO : clic sur RIT ou XIT = allumer / éteindre ; **molette** sur le décalage affiché = ± 10 Hz (± 100 Hz avec Maj) ; **CLEAR** = décalage à zéro. Le VFO B a son propre RIT / XIT sur le FTX-1 (côté SUB) ; le FTDX10 et l'IC-7300 n'en ont qu'un, sur le VFO A.

> [!TIP]
> Les réglages agissent sur le vrai TRX du club et s'affichent pour tous. Les voyants du cadre VFO (ATT, IPO, NB, DNR, NOTCH, DNF, NAR, AGC) résument l'état ; **un clic sur ATT, IPO / AMP1 / AMP2, AMP, NB, DNR, NOTCH, DNF ou NAR l'enclenche ou le coupe** (IPO → AMP1 → AMP2 → IPO). Sur le FTX-1, l'écran du VFO B règle NB, DNR, NOTCH, DNF et NAR du côté SUB ; l'ATT et le préampli sont propres à chaque côté : le TRX ne les donne que pour le côté actif, donc un clic sur ceux de l'autre VFO le fait passer un instant de ce côté (sans émission), puis revenir ; ceux du côté inactif sont lus quand il redevient actif (« ? » tant qu'ils n'ont jamais été lus).

<a id="commandes"></a>
### 4.1 Toutes les commandes, cadre par cadre

Toutes les commandes demandent d'**avoir la main**, sauf l'écoute, le volume et l'affichage. Les réglages agissent sur le vrai TRX du club et tout le monde les voit.

**Écrans VFO A (MAIN) et VFO B (SUB)**, en haut au centre

| Commande | Ce qu'elle fait |
|---|---|
| `RX` | Vert : ce VFO reçoit. Clic : ce VFO devient celui de réception (comme MAIN / SUB). |
| `TX` | Rouge foncé : VFO d'émission. Rouge vif avec halo : émission en cours. Clic sur TX de l'autre VFO = SPLIT (section 4.2). |
| `BW 1.2K` | Largeur du filtre de ce VFO ; molette de la souris dessus pour l'élargir ou la rétrécir. |
| Bandeau « ÉMISSION SUR A / B » | Rappelle le VFO sur lequel partirait l'émission. |
| MAIN / SUB · 20M | Côté du TRX et bande de ce VFO. |
| S-mètre (S, +20…) | Signal reçu ; en émission, voir Station meters. |
| Chiffres de la fréquence | Molette ou glisser vers le haut / bas sur un chiffre : il monte ou descend. Clic sur l'écran : ce VFO devient celui réglé par les flèches et les bandes (lettre soulignée). |
| Mode (DATA-U, USB…) | Mode de ce VFO ; il se change dans le cadre Mode. |
| `RIT` / `XIT` | Clic : allume / éteint le décalage de réception (RIT) ou d'émission (XIT). Molette sur la valeur affichée : ± 10 Hz (± 100 Hz avec `Maj`). |
| `CLEAR` | Remet le décalage RIT / XIT à zéro. |
| `ATT` | Atténuateur d'entrée (signaux très forts), clic = marche / arrêt. Grisé en 2 m / 70 cm. |
| `IPO` / `AMP1` / `AMP2` | Préampli HF / 6 m ; chaque clic passe au suivant (IPO = sans préampli). En 2 m / 70 cm : `AMP` marche / arrêt. |
| `NB` `DNR` `NOTCH` `DNF` | Antiparasite, réducteur de bruit, filtre notch manuel, notch automatique : clic = marche / arrêt (les niveaux se règlent dans le cadre DSP). |
| `NAR` | Filtre étroit (NARROW), clic = marche / arrêt. |
| `AGC AUTO` | Rappel de l'AGC (réglée dans RF front end). |

**Ligne Step et ligne des bandes**, sous les écrans VFO

| Commande | Ce qu'elle fait |
|---|---|
| `10 Hz` … `100 kHz` | Pas des flèches ◀ ▶, des flèches du clavier et de la molette. |
| `A` / `B` | FTX-1 : comme MAIN / SUB (le TRX passe de ce côté). FTDX10, IC-7300 : choix du VFO réglé. |
| `◀` `▶` | Descendre / monter d'un pas. |
| `MAIN` / `SUB` | Côté actif du TRX (réception et émission ensemble), comme la touche MAIN / SUB de la face avant, sans émission ; prend une à deux secondes. |
| `SPLIT` | Émettre sur l'autre VFO que celui de réception (section 4.2). |
| `TXW` | **Maintenir** le bouton (ou la touche `W`) pour écouter la fréquence d'émission (en SPLIT : le pile-up sur le VFO B) ; relâcher = retour sur le DX. Les VFO sont échangés pendant l'appui puis remis en place tout seuls (aussi après 15 s, ou si la liaison se coupe). PTT refusé tant que TXW est enfoncé. |
| `DUAL RX` | FTX-1 : double réception (MAIN et SUB écoutés ensemble, S-mètre et RX sur les deux VFO) ou réception simple (seulement le côté actif). **Modes numériques** : en double réception, la BF envoyée par le TRX contient aussi le côté SUB (ex. le FT8 du 20 m pendant un trafic QO-100 sur MAIN) ; couper DUAL RX pour ne décoder que le côté actif. MAIN / SUB fonctionne avec ou sans DUAL RX (réglage `ftx1SubSingle` du serveur ; à `false`, SUB seulement en double réception). Le S-mètre du VFO inactif reste affiché, grisé. Le FTX-1 n'accepte la double réception que si un des deux VFO est en 144 / 430 MHz (pas HF + HF). |
| `A → B` / `B → A` | Recopie la fréquence et le mode d'un VFO sur l'autre. |
| `A ⇄ B` | Échange les deux VFO. |
| `LOCK` | Verrouille les commandes de la **face avant du TRX au club** (pour que personne ne les touche) ; le dashboard reste utilisable. |
| `160M` … `70CM` | Change de bande (dernière fréquence et dernier mode utilisés sur cette bande). À droite : rappel « TUNE obligatoire » ou blocage HI-SWR en rouge. |

**Colonne de gauche**

| Cadre / commande | Ce qu'elle fait |
|---|---|
| Antenne : `ANT 1` / `ANT 2` | Prise d'antenne du FTX-1 (sur le SPA-1) ; refusé pendant une émission. |
| RF front end : **RF GAIN** | Gain HF du récepteur ; le baisser calme un signal très fort ou une bande bruyante. |
| RF front end : **AGC** `OFF` `FAST` `MID` `SLOW` `AUTO` | Vitesse de la commande automatique de gain. AUTO convient presque toujours ; FAST en CW / numérique, SLOW en BLU. |
| Mode : `LSB` `USB` `CW-L` `CW-U` `RTTY-L` `RTTY-U` `DATA-L` `DATA-U` `PSK` `AM` `AM-N` `FM` `FM-N` `DATA-FM` | Mode du VFO indiqué sous les boutons (« Mode appliqué à VFO A »). Modes numériques (FT8, RTTY par la BF…) : **DATA-U**. |
| Filtres : **BW** | Largeur du filtre de réception. |
| Filtres : **IF SHIFT** | Déplace la bande passante vers le haut ou le bas (écarter un signal gênant d'un côté). |
| Filtres : `CONTOUR` / `APF` | Correcteur de tonalité ; APF = filtre audio de pointe, en CW seulement. |
| Station meters : **Po SWR ALC Id Vd COMP S** | Puissance émise, ROS, ALC (en numérique : ≤ 8 %), courant et tension du PA, compression, S-mètre. RX / TX en haut à gauche, durée d'émission à droite. |

**Colonne de droite**

| Cadre / commande | Ce qu'elle fait |
|---|---|
| RX audio : **AF LEVEL** / **SQUELCH** | Volume et silencieux **du TRX** (pour tout le monde). |
| RX audio : `🔊 Écouter le TRX` / **VOLUME** | Écouter la BF du TRX dans votre navigateur ; le volume n'agit que chez vous. |
| DSP : **NB** / **DNR** | Niveau de l'antiparasite et du réducteur de bruit (OFF, puis 1 à 10). |
| DSP : `NOTCH` + **FRÉQ. NOTCH** | Filtre qui creuse une fréquence (une porteuse qui siffle) ; régler la fréquence à l'oreille. |
| DSP : `DNF` | Notch automatique (élimine tout seul les porteuses). |
| Accord : `TUNER` | Boîte d'accord du SPA-1 en service (allumée par défaut en HF / 6 m). |
| Accord : `TUNE` | Lance l'accord : le TRX émet une porteuse quelques secondes. Obligatoire après un changement de bande ; vérifier ensuite le SWR. |
| TX : voyant `RX` / `TX` | État réel du TRX. |
| TX : `PTT` | Maintenir pour émettre (ou la barre d'espace) ; relâcher = réception. |
| TX : **PUISSANCE** `−` `+` | Puissance du TRX ; votre limite de licence est affichée dessous. |
| TX : **GAIN MICRO**, `PROC`, **NIVEAU PROC** | Réglages de la modulation en phonie (compresseur de modulation et son niveau). |
| TX : `VOX` | Peut seulement être coupé à distance (jamais activé). |

**Centre : activité et modes numériques**

| Commande | Ce qu'elle fait |
|---|---|
| Onglets `ACTIVITÉ` … `SSTV`, `SYNCHRO`, `LOGS` | Journal de la station, modes numériques (section 9), horloges, carnet de trafic (section 14). |
| `👁 Suivre` | Votre dashboard suit l'onglet de celui qui a la main (section 3). |
| `⧉` | Ouvre les modes numériques dans une fenêtre séparée. |
| Ligne **CORRESPONDANT**, NOM, QTH, LOCATOR, RST TX, RST RX, `LOG QSO` | La station contactée et ses reports : **RST TX** = report envoyé par la station du club, **RST RX** = report reçu du correspondant. En FT8 / FT4 / FT2, WSPR et JT65 ce sont des dB (RST RX se remplit tout seul pendant la séquence) ; en RTTY, CW, SSTV et JTTY, des RST 599. LOG QSO l'enregistre dans le carnet (section 10). |
| **TX CALL** `ON5VL (station)` / `votre indicatif` | Indicatif des émissions numériques (FT8 / FT4 / FT2, RTTY, JTTY) : celui de la station ou le vôtre ; choisi par celui qui a la main et retenu pour la prochaine fois. Les messages Tx1 à Tx6, les macros `<MYCALL>` et le carnet (Station) suivent. Un QSO enregistré sous votre indicatif reste dans le carnet du club mais n'est pas envoyé automatiquement vers LoTW, eQSL, Club Log ou QRZ du club (export ADIF pour votre carnet). |

<a id="split"></a>
### 4.2 Trafic en SPLIT (émission et réception sur deux fréquences)

Le SPLIT sert surtout pour une **expédition DX** qui écoute ailleurs que sur sa fréquence (« UP 5 », « listening 14 200 to 14 210 »). On **écoute le DX sur le VFO A** et on **émet sur le VFO B**.

1. Réglez le **VFO A** (MAIN) sur la fréquence du DX, dans le bon mode. Vérifiez que `RX` est vert sur le VFO A.
2. Cliquez `A → B` : le VFO B prend la même fréquence et le même mode.
3. Réglez la **fréquence d'émission sur le VFO B** : molette (ou glisser) sur les chiffres du VFO B, par exemple +5 kHz pour « UP 5 ». Sur le FTX-1, la molette sur les chiffres du VFO B ne change pas le côté actif : vous continuez d'écouter sur A.
4. Cliquez `SPLIT` (ou `TX` sur l'écran du VFO B). Le voyant **TX** et le cadre lumineux passent sur le VFO B, sa fréquence redevient blanche et le bandeau indique « ÉMISSION SUR B ».
5. Écoutez le DX sur A ; **maintenez TXW** (ou `W`) pour écouter le pile-up sur la fréquence d'émission. Pour l'appeler, **PTT** : l'émission part sur la fréquence du VFO B (chiffres en rouge). En relâchant, retour en réception sur A.
6. Pour finir : cliquez de nouveau `SPLIT` (ou `TX` du VFO A). Le voyant TX revient sur A.

> [!TIP]
> **Bon à savoir**
> - Règle des TRX : sans SPLIT on émet sur le VFO où l'on écoute ; avec SPLIT, sur l'autre (RX sur A → TX sur B ; si vous écoutez sur B, TX sur A).
> - **FTX-1** : le SPLIT est géré par le dashboard (SPLIT « virtuel », comme Hamlib) parce que la commande split du FTX-1 met le TRX en émission. Au PTT, le TRX passe sur le côté SUB pour émettre puis revient sur MAIN ; le TRX du club affiche donc un instant SUB pendant l'émission, c'est normal. Un SPLIT mis sur la face avant du TRX est suivi par le dashboard.
> - La fréquence **réellement émise** (VFO B, XIT compris) est contrôlée : en dehors des bandes autorisées, le PTT est refusé (message « VFO B en SPLIT »).
> - Petit écart (quelques kHz au plus) : `XIT` sur le VFO A décale seulement l'émission, sans SPLIT ; molette sur la valeur pour régler l'écart, `CLEAR` pour revenir.
> - En **FT8 / FT4 / FT2**, inutile de mettre SPLIT : l'émission se place dans la bande passante avec le repère TX de la cascade (clic droit). Si SPLIT est mis, le message part sur l'autre VFO, comme le PTT.
> - N'oubliez pas de couper le SPLIT en fin de pile-up : sinon, le prochain opérateur émettrait sur le VFO B.

<a id="ecoute"></a>
## 5. Écouter

- Cadre **RX audio** → `🔊 Écouter le TRX` ; réglez votre **Volume** juste en dessous (n'agit que chez vous).
- **AF level** et **Squelch** agissent sur le TRX lui-même.
- Tout le monde peut écouter, même sans avoir la main. Si rien ne s'entend, voir section 12 (la BF doit être activée sur le PC du club).

<a id="emission"></a>
## 6. Émettre et sécurités

- **PTT** : maintenez le gros bouton PTT ou la barre d'espace `Espace`. Relâcher = réception.
- **Puissance** : boutons − / + du cadre TX ; votre limite personnelle est affichée (ex. ON3 : 25 W).
- **Accord** : après un changement de bande, un `TUNE` est **obligatoire** (cadre Accord) avant d'émettre, puis vérifiez le **SWR** (en bas à gauche du dashboard) ; à chaque changement de bande, un rappel clignote à droite de la touche 70CM et reste affiché jusqu'au TUNE (en 2 m et 70 cm, pas de tuner : seulement « vérifiez le SWR », 20 s). Le tuner du SPA-1 ne travaille qu'en HF et 6 m. TUNE compte comme une émission. FTX-1 : le tuner interne est dans l'ampli SPA-1, qui doit être raccordé et allumé ; sinon TUNER et TUNE n'ont pas d'effet. Le **tuner est mis en service tout seul** à la connexion du TRX et à chaque changement de bande HF / 6 m ; un clic sur `TUNER` le coupe jusqu'au prochain changement de bande.
- Gain micro, PROC et niveau, VOX (on peut le couper à distance, jamais l'activer).

> [!WARNING]
> **Sécurités automatiques** (impossible de les contourner depuis le dashboard) :
> - Émission seulement dans les bandes autorisées, vérifiée sur la fréquence réellement émise (SPLIT et XIT compris).
> - Durée maximale d'une émission : **120 s**, puis coupure ; relâchez le PTT avant de réémettre.
> - Coupure immédiate si vous perdez la liaison, si le PC du club perd internet ou si la page Station se ferme.
> - **ROS** supérieur à 2,5:1, ou **HI-SWR** signalé par le TRX pendant une émission : émission coupée et PTT refusé sur cette fréquence (±25 kHz) jusqu'à un TUNE.
> - **TUNE sans accord** : si le FTX-1 signale HI-SWR à la fin d'un TUNE, l'émission est **bloquée sur toute la bande** (PTT, modes numériques, TUNE excepté) pour protéger le PA. Un message rouge s'affiche à droite de la ligne des bandes. Le blocage tombe dès qu'un nouveau TUNE réussit ; sinon, essayer l'autre antenne ou prévenir un responsable de la station.
> - Au club, le TRX est repassé en réception s'il émet 2 min sans modulation ou 5 min sans interruption.
> - Puissance ramenée à la limite de votre licence ; indicatifs d'écouteurs : aucune émission.

L'émission n'est possible que si les administrateurs l'ont autorisée sur le serveur.

<a id="operateurs"></a>
## 7. Opérateurs et discussion

- Le volet **Opérateurs** s'ouvre et se ferme avec le bouton `👥` du bandeau (nombre de membres connectés). Un point rouge sur `👥` signale un nouveau message.
- Il indique qui a la main et sert de **discussion** entre les membres connectés (les messages ne sont pas conservés après un redémarrage du serveur).
- Les demandes et passages de main y apparaissent aussi.
- L'onglet **Activité** (au centre) liste les événements : connexions, prise de main, station en ligne, TRX connecté…

<a id="disposition"></a>
## 8. Disposition et fenêtres séparées

- Bouton `⧉` en haut à droite d'un cadre : le cadre s'ouvre dans **sa propre fenêtre**, à placer où vous voulez (2e écran…). `⧉ Ramener` le remet en place.
- Le bouton `⧉` à droite des onglets ouvre **tous les modes numériques** dans une fenêtre séparée, sur le mode affiché.
- La disposition est retenue : au chargement suivant, les fenêtres se rouvrent à leur place si Chrome **autorise les fenêtres pop-up** pour remote.op0p.be (icône à droite de la barre d'adresse → Toujours autoriser).

<a id="numeriques"></a>
## 9. Modes numériques

Les onglets du centre : **Activité**, **FT8 · FT4**, **RTTY**, **WSPR**, **JT65**, **JTTY**, **CW**, **SSTV** et, plus à droite, **Synchro**.

- Le **décodage se fait sur le serveur**, à l'heure du serveur (synchronisée) : l'heure de votre PC et de celui du club n'a pas d'importance.
- La BF du TRX n'est envoyée que si quelqu'un écoute ou regarde un onglet de mode numérique.
- Choisir une fréquence dans la liste d'un onglet y envoie le TRX, en **DATA-U** (en CW pour l'onglet CW) — il faut avoir la main. Le bouton `↺` à côté de la liste ramène le TRX sur cette fréquence après avoir tourné le VFO.
- Chaque onglet a une **cascade** (0 à 3000 Hz) ; une ligne d'état signale les problèmes (station hors ligne, BF non activée, TRX pas en DATA-U…).
- L'émission se fait sous l'indicatif **ON5VL** en **FT8 · FT4 · FT2**, **RTTY** et **JTTY** (il faut avoir la main et l'émission autorisée) ; WSPR, JT65, CW et SSTV sont en réception seulement *(bientôt)*.

<a id="ft8"></a>
### 9.1 FT8 · FT4 · FT2

- Boutons `FT8` / `FT4` / `FT2` : le TRX va sur la fréquence d'appel de ce mode dans sa bande.
- **FT2** : le mode rapide de Decodium (IU8LMC) — périodes de 3,75 s, signal de 2,5 s et 167 Hz de large (fréquences : liste de Decodium, ex. 14 084 kHz). Les stations qui émettent « en asynchrone » (à tout moment) sont aussi décodées ; l'heure affichée est alors celle de la période où le signal commence (DT plus grand). Le FT2 de « WSJT-X Improved » est un autre mode, incompatible.
- **Décodeur** : le moteur de décodage de **WSJT-X 3**, celui qui intègre le décodeur FT8 multi-passes de **JTDX** (la ligne d'état indique « moteur WSJT-X »). En FT8, trois passes par période, comme WSJT-X / JTDX : une **passe anticipée** à 11,8 s (la réponse peut partir dès la période suivante), une **passe normale** à la fin du signal, puis une **passe profonde** (soustraction des signaux décodés, plusieurs cycles, OSD) qui ajoute les stations les plus faibles quelques secondes plus tard. Sensibilité mesurée (signal unique, bruit blanc, 50 % de décodages) : FT8 −22 dB sans aide, environ −24 dB avec l'aide a priori ; FT4 −17,5 dB ; FT2 environ 3 dB de mieux qu'avant.
- **Aide a priori (AP)**, comme WSJT-X / JTDX : le décodeur sait sous quel indicatif on émet (TX CALL) et, pendant un QSO, qui est le correspondant et où en est la séquence ; il cherche alors les messages attendus jusqu'à 2 à 3 dB plus bas. Ces décodages portent la marque **a1**…**a7** après le message. La base d'indicatifs de JTDX (~100 000 indicatifs) écarte les faux décodages très faibles.
- **Pays, km, Az** : pour la station qui émet chaque message, le pays DXCC (fichier cty.dat d'AD1C, comme WSJT-X / JTDX), la distance depuis le locator du club et l'azimut (direction de l'antenne). La distance vient du locator du message ; sans locator, elle est approximative (centre du pays, marquée « ≈ »).
- **Largeur des deux listes** : glisser le trait vertical entre « Activité de bande » et « Fréquence RX » (double-clic : moitié-moitié) ; réglage gardé dans votre navigateur.
- **Stations déjà contactées** : les messages d'une station déjà au carnet **sous le TX CALL actuel**, sur la même bande et dans le même mode, sont en vert barré (comme « worked before » de WSJT-X / JTDX). Avec un autre TX CALL (ex. votre indicatif personnel), seuls les QSO faits sous cet indicatif comptent.
- **Quand part la réponse** : en FT8, une émission doit commencer au début d'une période (au plus 2,3 s de retard, sinon le correspondant ne la décode plus ; FT4 : 0,8 s). Le décodage anticipé arrive vers 12,7 s : un clic avant la fin de la période du correspondant (ou dans les 2 premières secondes de la suivante) fait partir la réponse aussitôt. Un clic pendant **votre** période d'émission fait partir le message **tout de suite**, comme WSJT-X ; l'émission s'arrête toujours à la fin de la période (message tronqué s'il est parti en retard).
- **dB** : le rapport signal/bruit est celui de WSJT-X (dans 2,5 kHz) ; les reports envoyés sont donc les vrais reports, comme avec WSJT-X / JTDX.
- **Activité de bande** : tous les messages décodés (CQ en vert, messages pour ON5VL / OR0L en rouge) ; **Fréquence RX** : ceux de votre fréquence.
- **Split** comme dans WSJT-X : **clic gauche** sur la cascade ou une ligne = fréquence de réception, **clic droit** = fréquence d'émission ; boutons « TX ← RX » et « RX ← TX ».
- **Clic sur l'indicatif** (souligné) ou **double-clic** sur un message : son émetteur devient le correspondant (indicatif, locator, report), les messages Tx1 à Tx6 se préparent et, avec la main, l'émission part à la période suivante.
- **Émettre** (comme « Enable Tx » + « Auto Seq » de WSJT-X) : un clic sur un message **Tx1 à Tx7** (sous les listes de l'onglet, comme dans WSJT-X) le fait partir **à chaque période** (une sur deux), jusqu'à la réponse. Il faut avoir la main, le VFO d'émission en **DATA-U** et une puissance dans votre limite. Le message émis s'affiche en jaune dans les listes ; la barre sous les listes est verte en réception, rouge en émission.
- **La séquence avance toute seule** d'après ce que répond le correspondant : son locator → Tx2 (report) ; son report → Tx3 (R+report) ; R+report → Tx4 (RR73) ; RRR ou RR73 → Tx5 (73), dès la période suivante (si la réponse est décodée juste après le départ de notre émission, celle-ci est coupée et repart aussitôt avec le bon message, dans la même période, comme WSJT-X). Après l'envoi du RR73 ou du 73 : fin du QSO, émission coupée, retour sur Tx6 (CQ) et proposition d'**enregistrer le QSO dans le carnet**.
- **Répondre au 1er** : en appel CQ (Tx6), la station qui vous répond devient le correspondant et la séquence démarre sans clic (« Call 1st » de WSJT-X). **Pour répondre à un CQ : clic sur son indicatif** (souligné en pointillé dans le message) **ou double-clic sur son message** (avec la main) : le TRX émet Tx1 à la période suivante, dans l'autre période que la station, puis la séquence avance toute seule, comme WSJT-X. Un clic ailleurs sur la ligne ne fait que caler la réception. Notre propre émission n'est plus décodée une 2e fois dans les listes.
- **Période** : « auto » émet dans l'autre période que le correspondant (double-clic sur son message), sinon garde celle du premier message ; « 1re » / « 2e » l'imposent (1re = 00 et 30 s en FT8).
- **Réglages de la cascade** (au-dessus de l'échelle, comme dans WSJT-X) : **Gain** = contraste (à droite, les signaux faibles ressortent), **Zéro** = niveau du fond, **Plat** = fond égal sur toute la largeur (corrige la pente du filtre du TRX), quatre jeux de couleurs (**JTDX** par défaut : bruit bleu, signaux jaunes, signaux forts rouges), **Vitesse** de défilement (comme « Spd » de JTDX : lente = signaux plus ramassés et plus d'historique, normale par défaut), ↺ = réglages d'origine. Ils valent pour toutes les cascades (FT8, RTTY, CW…) et restent mémorisés dans votre navigateur.
- **Cascade fine façon JTDX** : une case de 1,46 Hz (au lieu de 6,25 Hz), moyennée sur 0,8 s (les signaux FT8 deviennent des blocs pleins) ; échelle graduée tous les 50 / 100 / 500 Hz. En FT8 / FT4 / FT2 / JT65, un trait blanc marque le début de chaque période, avec l'heure UTC et la bande (« 19:55:15 20m »), comme dans JTDX.
- **Poignée sous la cascade** : la glisser vers le haut agrandit les listes de messages (double-clic : taille d'origine).
- Arrêts : `■ Arrêter` (ou la barre d'espace) ; le correspondant appelé répond à quelqu'un d'autre ; le même message depuis 6 min sans réponse (chien de garde) ; main perdue.
- Fréquence d'émission : le drapeau rouge « TX 1500 » sous l'échelle et le trait plein rouge de la cascade (clic droit pour le déplacer) ; réception : drapeau vert « RX 1500 » et trait plein vert (clic gauche). En **SPLIT**, le message part sur l'autre VFO que celui de réception, comme le PTT.

<a id="jt65"></a>
### 9.2 JT65

Même fenêtre que FT8 (périodes d'une minute) ; le TRX va sur la fréquence JT65 de sa bande. Les décodages arrivent vers la 52e seconde.

<a id="rtty"></a>
### 9.3 RTTY

- Réglez le **shift** et la **vitesse** (170 Hz / 45,45 bauds par défaut), puis **cliquez sur le signal** dans la cascade : les repères jaune (Mark) et bleu (Space) doivent tomber sur ses deux traces ; sinon `Inversé`.
- Les barres M / S de l'indicateur d'accord doivent battre en alternance. Montez le **silencieux** si des caractères apparaissent sur le bruit.
- Le texte reçu défile sur toute la largeur (`Effacer` à droite de son titre la vide) ; double-clic sur un indicatif reçu = correspondant. En dessous : les macros `F1` à `F12` sur une ligne, puis le texte à émettre avec `Émettre`, `Effacer` et `Log QSO`.
- **Macros** : un clic (ou `F1`…) émet tout de suite (section 10) ; **Maj+clic** ajoute la macro au texte sans émettre.
- **Émettre** (ou `Ctrl`+`Entrée`) : le texte part en RTTY sur la fréquence de réception (même shift, même vitesse), puis le TRX repasse en réception. Le texte émis s'affiche dans la réception, en gris puis en rouge lettre par lettre à mesure qu'il part (« fin dans N s ») ; pendant l'émission le bouton devient `■ Arrêter`. Le TRX doit être en **DATA-U** (le signal passe par sa carte son), 600 caractères au plus par envoi.

<a id="wspr"></a>
### 9.4 WSPR

Choisissez la bande ; toutes les 2 minutes (une dizaine de secondes après la minute paire), la liste se complète : indicatif, locator, puissance, fréquence, dérive et distance depuis la station.

<a id="jtty"></a>
### 9.5 JTTY

- Nouveau mode de WSJT-X 3.3 pour le clavier à clavier et les concours : pas de périodes, chaque message apparaît **trame après trame** (1,9 s) ; `▌` = message en cours.
- Clic gauche = réception, clic droit = émission, double-clic = correspondant ; macros `F1` à `F8` (celles de WSJT-X) : un clic émet tout de suite, **Maj+clic** les ajoute au message.
- **Émettre** (ou `Entrée`) : le message part tout de suite (pas de période) sur la fréquence TX, codé par WSJT-X, puis retour en réception. 80 caractères par message (au-delà : deux messages à la suite) ; TRX en **DATA-U**.

<a id="cw"></a>
### 9.6 CW

- Le TRX va en CW. **Cliquez sur un signal** dans la cascade : le décodeur se cale tout seul sur le plus proche (repère jaune) et apprend la vitesse (affichée en mots/minute). Clic droit : calage exact là où vous cliquez.
- **Filtre** 100 Hz par défaut (50 Hz en cas de QRM, 200–400 Hz pour chercher) ; montez le **silencieux** si des lettres apparaissent sur le bruit. Le voyant suit la manipulation.
- Double-clic sur un indicatif reçu = correspondant ; macros `F1` à `F12` (ajoutées au texte : l'émission CW arrive dans une prochaine version) ; `Log QSO`.

<a id="sstv"></a>
### 9.7 SSTV

- **Réception** : les images arrivent toutes seules (code VIS) et s'affichent ligne après ligne. Modes Martin M1/M2, Scottie S1/S2/DX, Robot 36/72, PD 50 à PD 290 ; décalage de fréquence et pente corrigés. La **galerie** garde les 12 dernières (clic = afficher) ; `PNG` enregistre l'image affichée sur votre PC. Le serveur garde aussi chaque image.
- **Préparer une image** : `Images du PC…` (ou glisser-déposer), carte CQ, mire ou image reçue ; elle est recadrée au format du mode choisi. Trois lignes de texte (haut, centre, bas) avec balises `<CALL>`, `<MYCALL>`, `<RST>`… ; taille et couleur. Clic droit sur une vignette : la retirer.
- `▶ Écouter` joue le signal SSTV sur votre PC ; `WAV` l'enregistre (essai avec MMSSTV ou une application de téléphone).

<a id="synchro"></a>
### 9.8 Synchro

Heure du serveur, écart de votre PC, délai de la liaison avec la station et DT moyen des décodages FT8 : utile pour vérifier que tout est bien calé.

- **Votre PC** : écart **actuel** de l'horloge du PC où tourne votre navigateur avec le serveur, en millisecondes (en secondes au-delà d'une seconde), avec sa précision (± la moitié de l'aller-retour réseau le plus court). À ne pas confondre avec la colonne « Offset » de NetTime ou de Meinberg, qui montre l'écart trouvé **avant** leur dernière correction de l'horloge.
- **Décodages** : heure d'arrivée de chaque passe du décodeur FT8 / FT4 après le début de la période (anticipée vers +12,5 s, normale vers +15 s, profonde ensuite). Si la passe normale arrive plus de 2 s après la fin de la période, le serveur est trop chargé : certaines réponses partent une période plus tard.

<a id="qo100"></a>
### 9.9 QO-100

Les listes FT8 · FT4, RTTY et CW proposent « **QO-100 · FI 2 m / 70 cm** » : la fréquence à mettre sur le TRX **avant le convertisseur** 2,4 GHz, pour monter sur 2400,040 MHz (FT8 / FT4), 2400,025 MHz (CW) ou 2400,090 MHz (RTTY). Exemple : FT8 sur **432,540 MHz** avec le convertisseur 70 cm du club. Seules les FI que le TRX branché peut atteindre sont proposées (2 m et 70 cm : FTX-1).

<a id="messages"></a>
## 10. Correspondant, messages et macros

- Ligne **Correspondant**, sous les onglets des modes numériques : indicatif, prénom, QTH, locator, report FT8, RST et bouton `Log QSO`. Prénom, QTH et locator sont cherchés sur **QRZ.com** dès qu'un nouveau correspondant est choisi (si un compte QRZ est réglé dans Logs → Configuration). Les messages et macros sont dans chaque onglet : **Tx1 à Tx7** en FT8 · FT4 · FT2 (sous les listes), **F1 à F12** en RTTY et CW et **F1 à F8** en JTTY (sur une ligne, au-dessus du texte à émettre).
- **RTTY et JTTY : une macro qui commence par `<TX>` part tout de suite à l'émission** au clic (ou avec sa touche `F1`…), comme dans FLDIGI, puis le TRX repasse en réception (`<RX>`, toujours fait en fin de message). Ces macros ont un liseré rouge à gauche ; c'est le cas de toutes les macros d'origine. **Maj+clic** : ajouter la macro au texte à émettre sans émettre, pour composer un message personnalisé puis « Émettre ». Si la macro contient `<CALL>` sans correspondant choisi, rien ne part.
- En **RTTY**, le texte émis s'affiche dans la fenêtre de réception d'abord en gris, puis chaque lettre passe en rouge au moment où elle part ; la ligne d'état indique « fin dans N s » : de quoi préparer la macro suivante. Après « Arrêter », la partie non émise reste grise et barrée. Pendant l'émission, le décodage RTTY / JTTY est suspendu (le TRX renvoie notre propre signal dans sa BF).
- Une macro sans `<TX>` (et toutes les macros CW) s'ajoute au texte à émettre de son onglet. **Clic droit** (ou `✎`) : la modifier — nom, texte, aperçu, retour au texte d'origine. Vos macros sont gardées sur le serveur, pour vous seul.
- FT8 · FT4 · FT2 : **un clic sur Tx1 à Tx7 lance l'émission automatique** de ce message (voir 9.1). Tx7 : texte libre de 13 caractères (clic droit pour le modifier).

| Balise | Remplacée par | Balise | Remplacée par |
|---|---|---|---|
| `<MYCALL>` | indicatif émis (ON5VL) | `<CALL>` | correspondant |
| `<NAME>` | son prénom | `<QTH>` | son QTH |
| `<RST>` | report envoyé | `<LOC>` | son locator |
| `<MYLOC>` | locator de la station | `<MYQTH>` | QTH de la station |
| `<OPCALL>` | votre indicatif (opérateur) | `<CNTR>` | numéro de série (001…) |
| `<INCR>` | passe au numéro suivant | `<ZT>` / `<ZD>` | heure / date UTC |
| `<TX>` | en tête : émission immédiate au clic (RTTY, JTTY) | `<RX>` | retour en réception à la fin (toujours fait) |
| `<LOG>` | ouvre la fiche « Enregistrer le QSO » |  |  |

<a id="clavier"></a>
## 11. Raccourcis clavier

| Touche | Action |
|---|---|
| `Espace` (maintenir) | PTT — aussi depuis un cadre ouvert dans une fenêtre séparée |
| `W` (maintenir) | TXW : écoute de la fréquence d'émission (SPLIT) |
| `↑` `↓` | Fréquence ± un pas |
| `F1` … `F12` | Macros dans les onglets RTTY et CW (`F1`…`F8` en JTTY) : émission immédiate si la macro commence par `<TX>` |
| `Ctrl` + `Entrée` / `Entrée` | Émettre le texte tapé en RTTY / en JTTY |
| `Ctrl` + `F5` | Recharger la page après une mise à jour |

Ces touches sont ignorées pendant la saisie dans un champ de texte.

<a id="problemes"></a>
## 12. Problèmes fréquents

| Symptôme | Solution |
|---|---|
| Affichage bizarre, bouton qui ne réagit pas après une mise à jour | `Ctrl` + `F5`. |
| « Station hors ligne » | La page Station du PC du club est fermée ou le PC n'a plus internet : prévenir un responsable du club. |
| Pas de son, cascade vide, « La page Station n'envoie pas la BF » | Au club, la page Station doit avoir « Activer l'audio » et la bonne entrée son (voir section 13). |
| « Prenez la main… » | Vous n'avez pas la main : bouton « Prendre la main » ou « Demander la main ». |
| Rien n'est décodé en FT8 / RTTY… | Vérifiez le mode du TRX (DATA-U ; CW en CW) et la fréquence ; l'onglet Synchro montre si la BF arrive. |
| Une fenêtre séparée ne s'ouvre pas | Autorisez les fenêtres pop-up pour remote.op0p.be (icône à droite de la barre d'adresse). |
| PTT refusé | Le message indique la raison : hors bande autorisée, ROS (faire TUNE), émission non autorisée, indicatif d'écouteur, durée maximale… |
| Le badge TX est rouge alors que je n'émets pas | Normal : rouge foncé = VFO d'émission. L'émission réelle se voit aux chiffres de la fréquence en rouge et au badge TX rouge vif. |
| Clic sur ATT / IPO de l'autre VFO : le TRX change de côté un instant | Normal sur le FTX-1 : ces réglages ne se font que sur le côté actif ; le TRX y passe 2 à 3 s, sans émettre, puis revient. |
| « Passage MAIN ↔ SUB par le dashboard désactivé » | Un administrateur a mis `ftx1SubCat` à `false` dans `config.json` : MAIN / SUB sur la face avant seulement. |

<a id="club"></a>
## 13. Le PC du club (page Station)

Pour les responsables du club. Le PC relié au TRX ouvre **https://remote.op0p.be/station** dans Chrome (Web Serial). Sous Windows 10 / 11, l'installateur **RemoteStation-Setup** fait le nécessaire : raccourci « Remote Station - Page Station » (Chrome avec les bons réglages), lancement au démarrage de Windows, pas de mise en veille ; il peut aussi installer le serveur lui-même sur ce PC (voir LISEZMOI-WINDOWS).

La page Station est **réservée aux administrateurs** : à la première ouverture sur un PC, connectez-vous avec l'indicatif et le mot de passe d'un administrateur. Ce PC reste autorisé un an (renouvelé à chaque ouverture), jusqu'à « Se déconnecter ». Un membre non administrateur est refusé. Le navigateur du PC du club, qui garde le jeton de la station, se reconnecte aussi tout seul. Un administrateur peut **recharger la page Station à distance** : clic sur le voyant **STATION** en haut à gauche → « ↻ Recharger la page Station » (la station revient en une dizaine de secondes).

1. Coller le **jeton de station** (donné par l'administrateur du serveur), choisir le **modèle** du TRX et son **port CAT** (la première fois). FTX-1 : l'**Enhanced COM Port** (CAT-1), et sur le TRX les réglages **RPTT SELECT** et **PC KEYING** sur OFF (réglage d'usine) : l'émission se commande par CAT.
2. **Activer l'audio** et choisir l'entrée son du TRX (souvent « USB Audio CODEC ») ; la barre de niveau doit bouger.
3. **Sortie son vers le TRX** (émission FT8 / FT4 / FT2) : la carte son USB du TRX (« Haut-parleurs (USB Audio CODEC) »…), choisie toute seule si possible. Jamais les haut-parleurs du PC. Le TRX doit prendre la modulation DATA sur l'USB (menu du TRX). Régler le **niveau d'émission** pour que l'ALC reste faible. Limiteur facultatif : avec `"digiAlcMax": 8` dans `config.json`, en émission numérique (FT8 / FT4 / FT2, RTTY, JTTY…), la page Station **baisse toute seule** ce niveau dès que l'ALC dépasse 8 %, pendant l'émission, et garde le niveau atteint pour les émissions suivantes (message « ALC … ramené de 30 à 24 % » chez celui qui a la main) ; il ne remonte jamais tout seul. Par défaut (`0`), pas de limiteur. L'émission part à l'heure du VPS, même si l'horloge de Windows est décalée.
4. Garder la page Station **seule dans sa fenêtre** ; ouvrir le dashboard avec son bouton « Ouvrir le dashboard dans une autre fenêtre ».
5. Chrome → Paramètres → Performances : garder remote.op0p.be toujours actif ; Windows : mise en veille sur Jamais.

Installation et réglages du serveur : voir `LISEZMOI.md` et `README.md` (dépôt du projet).

<a id="logs"></a>
## 14. Logs (carnet de trafic)

Onglet **Logs** (à droite de Synchro) : le carnet de trafic de la station, partagé par tous les membres, avec l'envoi vers **LoTW**, **eQSL**, **Club Log** et **QRZ.com**, l'export **ADIF** ou **Cabrillo** et l'envoi en **UDP** aux logbooks du PC (Swisslog, HRD Logbook, Log4OM, N1MM Logger+…).

- **Enregistrer un QSO** : `⇩ TRX` reprend la fréquence et le mode du TRX (en DATA : le mode de l'onglet affiché, FT8, RTTY…), la puissance, et la ligne Correspondant (indicatif, prénom, QTH, locator). L'heure UTC est prise à la première lettre de l'indicatif ; `⟳ Maintenant` la remet à l'heure. `Entrée` ou `Enregistrer le QSO`. Un doublon (même indicatif, bande et mode dans la demi-heure) est signalé avant l'enregistrement ; si la fiche déjà au carnet (ex. enregistrée en fin de QSO) n'a pas le nom, le QTH, le locator ou le RST reçu, on propose de la **compléter** au lieu de créer un 2e QSO.
- **Sans quitter l'onglet RTTY, JTTY ou CW** : bouton `Log QSO` (à côté de « Émettre », et au bout de la ligne Correspondant), comme « Save QSO » de FLDIGI. Une fiche s'ouvre, déjà remplie : indicatif, prénom, QTH, locator et RST du correspondant, fréquence (en RTTY : celle du signal, porteuse + fréquence audio) et mode de l'onglet, puissance, heure de début (quand le correspondant a été choisi) et de fin (maintenant). Corriger au besoin (RST reçu…), puis `Enregistrer dans le carnet`. Une macro qui contient `<LOG>` (par exemple le « 73 ») ouvre aussi cette fiche.
- **QO-100** : avec la FI du convertisseur (ex. 432,525 MHz), la case QO-100 se coche et la fréquence de montée 2400,xxx MHz est enregistrée (satellite QO-100, descente 10 489,xxx MHz).
- **Fiche** : la fréquence et le mode suivent tout seuls le **VFO actif** du TRX (VFO B si le TRX est sur SUB) ; une fréquence ou un mode tapés à la main restent jusqu'au QSO suivant (⇩ TRX pour reprendre ceux du TRX).
- **Liste** : les 300 derniers QSO (recherche par indicatif, nom ou opérateur). Colonne **TX call** : l'indicatif sous lequel le QSO a été fait, le même que TX CALL du dashboard au moment du QSO (l'opérateur s'affiche au survol). Le TX call de la fiche suit celui de la ligne Correspondant ; avec la main, le changer dans la fiche change aussi l'indicatif d'émission. Colonnes **QTH**, **DXCC** (pays, d'après l'indicatif) et **Préfixe** (préfixe principal du pays DXCC : ON, LA, K…). **Largeur des colonnes** : glisser le bord droit d'un titre de colonne (double-clic : largeur d'origine) ; gardée dans votre navigateur. **Filtres** : le **▾** à côté de chaque titre propose les valeurs de la colonne (dates, bandes, modes, pays, TX call, état des envois…) avec leur nombre de QSO ; un choix filtre le carnet (le ▾ devient ●, plusieurs colonnes se combinent) ; « ✕ Filtres » les retire tous. Colonnes LoTW, eQSL, CL (Club Log), QRZ : **·** pas encore envoyé, **✓** envoyé, **✗** refusé (survol = détail), **★** confirmé sur LoTW. Clic sur une ligne : modifier ou supprimer le QSO (son auteur ou un administrateur).
- **Exporter ▾** : ADIF 3 (.adi) ou Cabrillo 3 (.log, avec le nom du concours), pour un TX call et une plage de dates au choix. **Mes QSO (.adi)** télécharge tout de suite les QSO faits sous **votre** indicatif (TX call), à importer dans votre propre logbook. Chaque membre exporte ses QSO : sous son indicatif, ou ceux qu'il a faits lui-même sous ON5VL / OR0L (« mes QSO sous cet indicatif ») ; les administrateurs exportent tous les TX call.
- **Synchronisation ▾** (administrateurs) : une fenêtre par service, comme dans Swisslog — onglet **Détails** (indicatif, plage de dates facultative, renvoyer les QSO déjà envoyés, temporisation ; Club Log : « Effacer le log ClubLog existant ») puis `Télécharger` ; onglet **Traitement** : progression, compte rendu, `Arrêt`. **Opérations LoTW** : exporter, signer avec TQSL, envoyer, lire les confirmations, statut ; `Confirmations` lit seulement les confirmations reçues.
- **⚙ Configuration** (administrateurs) : onglets CLUBLOG, eQSL, LoTW, QRZ, UDP. Case « Télécharger automatiquement les QSO lors de leur enregistrement », identifiants et mots de passe (bouton 👁 pour les voir pendant la saisie), temporisation, `Tester`. Les mots de passe et clés restent sur le serveur : la fenêtre affiche seulement « enregistré » ; laisser le champ vide garde la valeur, ✕ l'efface. Onglet QRZ, **Recherche des correspondants** : identifiant et mot de passe d'un compte QRZ.com ; dès qu'un correspondant est choisi (clic sur un indicatif, ligne Correspondant, fiche du carnet), son prénom, sa ville (QTH) et, avec un abonnement XML, son locator sont remplis tout seuls (cases vides seulement), avec un rappel « QRZ.com : … » sous les bandes.

| Service | À préparer |
|---|---|
| Club Log | E-mail du compte, mot de passe d'application (Club Log → Settings → App Passwords), clé API de l'application (demandée une fois au helpdesk Club Log). Un refus d'accès arrête les envois jusqu'au prochain OK de la configuration. |
| eQSL | Indicatif et mot de passe eQSL ; « QTH Nickname » si le compte a plusieurs QTH. |
| QRZ.com | Une clé API du carnet QRZ par indicatif (QRZ → Logbook → Settings), abonnement XML ou supérieur. |
| LoTW | **TQSL** et le **certificat** de l'indicatif installés sur le PC où tourne le serveur (serveur Windows du club), le nom du « Station Location » de TQSL, et l'identifiant du site LoTW pour les confirmations. Le certificat et son mot de passe ne quittent jamais ce PC. Avec le serveur sur le VPS : « Exporter pour TQSL (.adi) », signer le fichier avec TQSL sur le PC du club, puis « Marquer comme envoyés ». |
| UDP | Adresse, port et format attendus par le logbook : WSJT-X « Logged ADIF » (Swisslog, Log4OM, HRD Logbook ; port 2237 en général), N1MM (port 12060), ou ADIF brut. Les paquets partent du serveur : 127.0.0.1 si le serveur tourne sur le PC du club. |
