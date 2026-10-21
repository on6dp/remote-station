<!-- Fichier produit par native/manual2md.js à partir de public/aide.html : modifier la page HTML, puis relancer le script. -->

# Remote Station UBA-LGE — manuel d’utilisation

*Version en ligne : bouton **HELP** du dashboard ou https://remote.op0p.be/aide — [English version](USER-MANUAL.md)*

- [1. Se connecter](#connexion)
- [2. L'écran](#ecran)
- [3. Prendre et passer la main](#main)
- [4. Piloter le TRX](#trx)
- [5. Écouter](#ecoute)
- [6. Émettre et sécurités](#emission)
- [7. Opérateurs et discussion](#operateurs)
- [8. Disposition et fenêtres séparées](#disposition)
- [9. Modes numériques](#numeriques)
   - [9.1 FT8 · FT4](#ft8)
   - [9.2 JT65](#jt65)
   - [9.3 RTTY](#rtty)
   - [9.4 WSPR](#wspr)
   - [9.5 JTTY](#jtty)
   - [9.6 CW](#cw)
   - [9.7 SSTV](#sstv)
   - [9.8 Synchro](#synchro)
   - [9.9 QO-100](#qo100)
- [10. Messages pré-enregistrés et macros](#messages)
- [11. Raccourcis clavier](#clavier)
- [12. Problèmes fréquents](#problemes)
- [13. Le PC du club (page Station)](#club)

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
| `👥 n` | Nombre de membres connectés ; un clic en donne la liste. |
| `Prendre la main` | Devenir l'opérateur (voir section 3). |
| `HELP` | Ce manuel (en français ou en anglais selon la langue du navigateur). |

### Les colonnes (écran large)

1. **Gauche** : Antenne, RF front end, Mode, Filtre, Station meters.
2. **Centre** : VFO A et B (MAIN / SUB), Step et bandes, puis « Activité et modes numériques ».
3. **Droite** : RX audio, DSP, Accord (tuner), TX.
4. **Extrême droite** : Opérateurs (discussion) et Messages pré-enregistrés.

Chaque cadre se replie avec la petite flèche `▾` devant son titre, et peut s'ouvrir dans sa propre fenêtre avec `⧉` (section 8).

<a id="main"></a>
## 3. Prendre et passer la main

- Une seule personne **a la main** (pilote le TRX) ; tout le monde voit et entend.
- **Prendre la main** : bouton du bandeau, si personne ne l'a.
- Si quelqu'un l'a déjà : **Demander la main** dans le cadre Opérateurs (il reçoit la demande) ou lui écrire un message. Celui qui a la main peut la **passer** à un autre membre.
- **Libérer la main** en partant. Elle est libérée automatiquement après **15 minutes** sans action.
- Sans la main, les commandes sont grisées et un message rappelle « Prenez la main ».

<a id="trx"></a>
## 4. Piloter le TRX

### Fréquence (cadre VFO)

- **Molette** sur les chiffres, ou **glisser** sur les chiffres ; flèches `↑` `↓` du clavier ; boutons `◀` `▶`.
- Le pas se choisit dans **Step** (10 Hz à 100 kHz) ; `A` / `B` choisit le VFO réglé.
- Saisie directe : tapez la fréquence en kHz puis **Aller**.
- **Bandes** : 160 m à 70 cm (selon le TRX).

### Mode et filtre

- **Mode** : LSB, USB, CW-L/CW-U, RTTY, DATA-L/DATA-U (modes numériques), AM, FM… (appliqué au VFO indiqué).
- **Filtre** : largeur BW, NARROW, IF SHIFT, CONTOUR, APF (en CW).

### Antenne

Cadre **Antenne**, en haut à gauche : `ANT 1` / `ANT 2` sur le FTX-1 (prises de l'ampli SPA-1). Le FTDX10 et l'IC-7300 ne permettent pas ce choix à distance (boutons grisés). Le changement d'antenne est refusé pendant une émission.

### RF front end, DSP, deux VFO

- **RF front end** : RF gain, ATT, préampli (IPO / AMP1 / AMP2…), AGC.
- **DSP** : NB, DNR, NOTCH (et sa fréquence), DNF.
- **Dual** (entre les deux VFO) : MAIN / SUB, A → B, B → A, A ⇄ B, SPLIT, RIT, XIT, décalage, LOCK.

> [!TIP]
> Les réglages agissent sur le vrai TRX du club et s'affichent pour tous. Les voyants du cadre VFO (ATT, IPO, NB, DNR, NOTCH, DNF, NAR, AGC) résument l'état.

<a id="ecoute"></a>
## 5. Écouter

- Cadre **RX audio** → `🔊 Écouter le TRX` ; réglez votre **Volume** juste en dessous (n'agit que chez vous).
- **AF level** et **Squelch** agissent sur le TRX lui-même.
- Tout le monde peut écouter, même sans avoir la main. Si rien ne s'entend, voir section 12 (la BF doit être activée sur le PC du club).

<a id="emission"></a>
## 6. Émettre et sécurités

- **PTT** : maintenez le gros bouton PTT ou la barre d'espace `Espace`. Relâcher = réception.
- **Puissance** : boutons − / + du cadre TX ; votre limite personnelle est affichée (ex. ON3 : 25 W).
- **Accord** : après un changement de bande, faites `TUNE` (cadre Accord) avant d'émettre. TUNE compte comme une émission.
- Gain micro, PROC et niveau, VOX (on peut le couper à distance, jamais l'activer).

> [!WARNING]
> **Sécurités automatiques** (impossible de les contourner depuis le dashboard) :
> - Émission seulement dans les bandes autorisées, vérifiée sur la fréquence réellement émise (SPLIT et XIT compris).
> - Durée maximale d'une émission : **120 s**, puis coupure ; relâchez le PTT avant de réémettre.
> - Coupure immédiate si vous perdez la liaison, si le PC du club perd internet ou si la page Station se ferme.
> - **ROS** supérieur à 2,5:1 : émission coupée et PTT refusé sur cette fréquence (±25 kHz) jusqu'à un TUNE.
> - Au club, le TRX est repassé en réception s'il émet 2 min sans modulation ou 5 min sans interruption.
> - Puissance ramenée à la limite de votre licence ; indicatifs d'écouteurs : aucune émission.

L'émission n'est possible que si les administrateurs l'ont autorisée sur le serveur.

<a id="operateurs"></a>
## 7. Opérateurs et discussion

- Le cadre **Opérateurs** indique qui a la main et sert de **discussion** entre les membres connectés (les messages ne sont pas conservés après un redémarrage du serveur).
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
- Choisir une fréquence dans la liste d'un onglet y envoie le TRX (**QSY**), en **DATA-U** (en CW pour l'onglet CW) — il faut avoir la main.
- Chaque onglet a une **cascade** (0 à 3000 Hz) ; une ligne d'état signale les problèmes (station hors ligne, BF non activée, TRX pas en DATA-U…).
- L'émission des modes numériques (sous l'indicatif **ON5VL**) arrive dans une prochaine version *(bientôt)* : les boutons « Émettre » sont grisés, mais les messages et macros se préparent déjà.

<a id="ft8"></a>
### 9.1 FT8 · FT4

- Boutons `FT8` / `FT4` : le TRX va sur la fréquence d'appel de ce mode dans sa bande.
- **Activité de bande** : tous les messages décodés (CQ en vert, messages pour ON5VL / OR0L en rouge) ; **Fréquence RX** : ceux de votre fréquence.
- **Split** comme dans WSJT-X : **clic gauche** sur la cascade ou une ligne = fréquence de réception, **clic droit** = fréquence d'émission ; boutons « TX ← RX » et « RX ← TX ».
- **Double-clic** sur un message : son émetteur devient le correspondant (indicatif, locator, report) et les messages Tx1 à Tx6 se préparent.

<a id="jt65"></a>
### 9.2 JT65

Même fenêtre que FT8 (périodes d'une minute) ; le TRX va sur la fréquence JT65 de sa bande. Les décodages arrivent vers la 52e seconde.

<a id="rtty"></a>
### 9.3 RTTY

- Réglez le **shift** et la **vitesse** (170 Hz / 45,45 bauds par défaut), puis **cliquez sur le signal** dans la cascade : les repères jaune (Mark) et bleu (Space) doivent tomber sur ses deux traces ; sinon `Inversé`.
- Les barres M / S de l'indicateur d'accord doivent battre en alternance. Montez le **silencieux** si des caractères apparaissent sur le bruit.
- Le texte reçu défile à gauche ; double-clic sur un indicatif reçu = correspondant. À droite : macros `F1` à `F12` et texte à émettre.

<a id="wspr"></a>
### 9.4 WSPR

Choisissez la bande ; toutes les 2 minutes (une dizaine de secondes après la minute paire), la liste se complète : indicatif, locator, puissance, fréquence, dérive et distance depuis la station.

<a id="jtty"></a>
### 9.5 JTTY

- Nouveau mode de WSJT-X 3.3 pour le clavier à clavier et les concours : pas de périodes, chaque message apparaît **trame après trame** (1,9 s) ; `▌` = message en cours.
- Clic gauche = réception, clic droit = émission, double-clic = correspondant ; macros `F1` à `F8` (celles de WSJT-X).

<a id="cw"></a>
### 9.6 CW

- Le TRX va en CW. **Cliquez sur un signal** dans la cascade : le décodeur se cale tout seul sur le plus proche (repère jaune) et apprend la vitesse (affichée en mots/minute). Clic droit : calage exact là où vous cliquez.
- **Filtre** 100 Hz par défaut (50 Hz en cas de QRM, 200–400 Hz pour chercher) ; montez le **silencieux** si des lettres apparaissent sur le bruit. Le voyant suit la manipulation.
- Double-clic sur un indicatif reçu = correspondant ; macros `F1` à `F12`.

<a id="sstv"></a>
### 9.7 SSTV

- **Réception** : les images arrivent toutes seules (code VIS) et s'affichent ligne après ligne. Modes Martin M1/M2, Scottie S1/S2/DX, Robot 36/72, PD 50 à PD 290 ; décalage de fréquence et pente corrigés. La **galerie** garde les 12 dernières (clic = afficher) ; `PNG` enregistre l'image affichée sur votre PC. Le serveur garde aussi chaque image.
- **Préparer une image** : `Images du PC…` (ou glisser-déposer), carte CQ, mire ou image reçue ; elle est recadrée au format du mode choisi. Trois lignes de texte (haut, centre, bas) avec balises `<CALL>`, `<MYCALL>`, `<RST>`… ; taille et couleur. Clic droit sur une vignette : la retirer.
- `▶ Écouter` joue le signal SSTV sur votre PC ; `WAV` l'enregistre (essai avec MMSSTV ou une application de téléphone).

<a id="synchro"></a>
### 9.8 Synchro

Heure du serveur, écart de votre PC, délai de la liaison avec la station et DT moyen des décodages FT8 : utile pour vérifier que tout est bien calé.

<a id="qo100"></a>
### 9.9 QO-100

Les listes FT8 · FT4, RTTY et CW proposent « **QO-100 · FI 2 m / 70 cm** » : la fréquence à mettre sur le TRX **avant le convertisseur** 2,4 GHz, pour monter sur 2400,040 MHz (FT8 / FT4), 2400,025 MHz (CW) ou 2400,090 MHz (RTTY). Exemple : FT8 sur **432,540 MHz** avec le convertisseur 70 cm du club. Seules les FI que le TRX branché peut atteindre sont proposées (2 m et 70 cm : FTX-1).

<a id="messages"></a>
## 10. Messages pré-enregistrés et macros

- Cadre **Messages pré-enregistrés** : correspondant (indicatif, prénom, QTH, locator, report FT8, RST), puis une ligne par mode : FT8 · FT4 (Tx1 à Tx7), RTTY, JTTY, CW.
- Un clic sur une macro l'ajoute au texte à émettre de son onglet. **Clic droit** (ou `✎`) : la modifier — nom, texte, aperçu, retour au texte d'origine. Vos macros sont gardées sur le serveur, pour vous seul.
- Tx7 : texte libre FT8 / FT4 de 13 caractères.

| Balise | Remplacée par | Balise | Remplacée par |
|---|---|---|---|
| `<MYCALL>` | indicatif émis (ON5VL) | `<CALL>` | correspondant |
| `<NAME>` | son prénom | `<QTH>` | son QTH |
| `<RST>` | report envoyé | `<LOC>` | son locator |
| `<MYLOC>` | locator de la station | `<MYQTH>` | QTH de la station |
| `<OPCALL>` | votre indicatif (opérateur) | `<CNTR>` | numéro de série (001…) |
| `<INCR>` | passe au numéro suivant | `<ZT>` / `<ZD>` | heure / date UTC |

<a id="clavier"></a>
## 11. Raccourcis clavier

| Touche | Action |
|---|---|
| `Espace` (maintenir) | PTT — aussi depuis un cadre ouvert dans une fenêtre séparée |
| `↑` `↓` | Fréquence ± un pas |
| `F1` … `F12` | Macros dans les onglets RTTY et CW (`F1`…`F8` en JTTY) |
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

<a id="club"></a>
## 13. Le PC du club (page Station)

Pour les responsables du club. Le PC relié au TRX ouvre **https://remote.op0p.be/station** dans Chrome (Web Serial) :

1. Coller le **jeton de station** (donné par l'administrateur du serveur), choisir le **modèle** du TRX et son **port CAT** (la première fois).
2. **Activer l'audio** et choisir l'entrée son du TRX (souvent « USB Audio CODEC ») ; la barre de niveau doit bouger.
3. Garder la page Station **seule dans sa fenêtre** ; ouvrir le dashboard avec son bouton « Ouvrir le dashboard dans une autre fenêtre ».
4. Chrome → Paramètres → Performances : garder remote.op0p.be toujours actif ; Windows : mise en veille sur Jamais.

Installation et réglages du serveur : voir `LISEZMOI.md` et `README.md` (dépôt du projet).
