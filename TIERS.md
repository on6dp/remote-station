# Composants et sources de tiers

## wsprd (décodeur WSPR de WSJT-X)

`lib/wsprd.wasm` est compilé (voir `native/wspr/build.sh`) à partir des sources C de wsprd, le décodeur WSPR de WSJT-X, copiées sans modification dans `native/wspr/` : Copyright 2001-2018 Joe Taylor (K1JT), 2014-2018 Steven Franke (K9AN). FFTW y est remplacé par KISS FFT (`native/wspr/shim/fftw3.h`) et le décodage OSD en Fortran n'est pas utilisé (`native/wspr/shim/osd_stub.c`).

- Projet : https://wsjt.sourceforge.io (WSJT-X)
- Licence : **GNU General Public License v3** — texte complet dans `native/wspr/COPYING`

Conséquence : le projet Remote Station, qui inclut ce décodeur, doit être redistribué sous GPL v3 (sources complètes fournies avec toute copie distribuée).

## Décodeur JT65 de WSJT-X

`lib/bin/jt65` est le programme de test « jt65 » de WSJT-X 3.3 (fichiers `lib/jt65*.f90`, `decode65*.f90`, `sync65.f90`, Reed-Solomon de Phil Karn KA9Q, décodeur FT de K9AN…), compilé en exécutable Linux x86-64 par `native/wsjtx/build.py` à partir d'une copie du dépôt https://github.com/WSJTX/wsjtx (étiquette v3.3.0-beta2). FFTW est remplacé par `native/wsjtx/fftw_kiss.c` (KISS FFT).

- Copyright Joe Taylor (K1JT), Steven Franke (K9AN) et l'équipe WSJT-X
- Licence : GNU GPL v3 (texte dans `native/wspr/COPYING`)

## Décodeur JTTY de WSJT-X

`lib/bin/jttyd` est le récepteur JTTY en continu de WSJT-X 3.3 (interface `jtty_rx_*` : `lib/jtty/*.f90`, codes convolutifs et CRC associés), relié à un petit programme propre à ce projet, `native/wsjtx/jttyd.c` (lit la BF 16 bits / 12 kHz sur l'entrée standard, écrit chaque mise à jour de message), et compilé par `native/wsjtx/build.py` à partir du même dépôt WSJT-X (étiquette v3.3.0-beta2), sans OpenMP (`native/wsjtx/omp_lib.f90`) et sans FFTW.

- Copyright Joe Taylor (K1JT), Steven Franke (K9AN) et l'équipe WSJT-X
- Licence : GNU GPL v3 (texte dans `native/wspr/COPYING`)

## ft8_lib (décodeur et codeur FT8 / FT4 / FT2)

`lib/ftx.wasm` est compilé (voir `native/ftx/build.sh`) à partir de ft8_lib, bibliothèque de décodage FT8/FT4 de Kārlis Goba (YL3JG), et de l'interface `native/ftx/ftx_wasm.c` propre à ce projet (une seule retouche de `ft8/decode.c` à la compilation : plage de recherche en temps réglable, pour FT2). Le codeur `public/js/ftx-enc.wasm` (`native/ftx/ftx_enc.c`) reprend aussi ft8_lib. FT2 est le mode de Decodium (IU8LMC, GPL v3) : seuls ses paramètres publics (FT4 à 288 échantillons par symbole, période de 3,75 s, fréquences) sont repris, aucun code. ft8_lib inclut KISS FFT (Mark Borgerding, licence BSD).

- Projet : https://github.com/kgoba/ft8_lib
- Licence : MIT — Copyright (c) 2018 Kārlis Goba

## RigPlane Core

Les formats des commandes CAT du Yaesu FTX-1 utilisés dans `public/js/yaesu.js` et `public/js/ftx1.js` (réglages, filtres, mesures, tables de largeur de filtre, étalonnages indicatifs du S-mètre et du SWR) ont été repris du profil `rigs/ftx1.toml` de RigPlane Core, vérifié sur une radio réelle.

La liste des commandes CI-V de l'Icom IC-7300 utilisées dans `public/js/ic7300.js` (codes de commande et sous-commandes, valeurs d'atténuateur, préampli, AGC et filtres, vitesse par défaut) s'appuie sur le profil `rigs/ic7300.toml` de RigPlane Core.

Le design de la page opérateur (`public/index.html`, `public/css/rp.css`) reprend la disposition « bureau » de l'interface web de RigPlane Core, et `public/css/rp-tokens.css` est une copie de ses jetons de design (`frontend/src/components-v2/theme/tokens.css`). Le nom et le logo « RigPlane » ne sont pas utilisés.

- Projet : https://github.com/rigplane/rigplane-core
- Licence : MIT

```
MIT License

Copyright (c) 2026 Sergey Morozik (KN4KYD)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Police IBM Plex Mono

`public/fonts/IBMPlexMono-*.woff2` (Regular, Medium, SemiBold, Bold), de https://github.com/IBM/plex — police principale
du dashboard (zéro pointé, distinct du 8). Licence : SIL Open Font License 1.1 — `public/fonts/IBMPlexMono-OFL.txt`.

## Police Roboto Mono

`public/fonts/roboto-mono-*.woff2`, repris des fichiers embarqués par RigPlane Core (issus de Google Fonts).
Licence : SIL Open Font License 1.1 — voir `public/fonts/LICENSES.md`.
