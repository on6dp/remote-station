# Journal des versions — Remote Station UBA-LGE (ON5VL / OR0L)

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
