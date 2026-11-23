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

## Moteur de décodage FT8 / FT4 / FT2 de WSJT-X (avec le décodeur FT8 de JTDX)

`lib/bin/wsjtxd` (Linux x86-64) et `lib/bin/wsjtxd.exe` (Windows x64) relient le moteur de décodage de WSJT-X 3.3 (`DecoderEngine.h`, `lib/decoder_engine.f90` et les décodeurs FT8 « classique » et « MTD » multi-passes — ce dernier repris de JTDX —, FT4, etc.) à un petit programme propre à ce projet, `native/wsjtx/wsjtxd.c` (processus permanent : périodes reçues sur l'entrée standard, décodages sur la sortie standard). Compilé par `native/wsjtx/build.py` (avec OpenMP, `native/wsjtx/build-wsjtxd.sh` ; Windows : `windows/build.sh`) à partir du dépôt https://github.com/WSJTX/wsjtx (étiquette v3.3.0-beta2), sans FFTW (`fftw_kiss.c`) ni Boost (`native/wsjtx/crc.c` remplace `crc10/13/14.cpp`) ; `stubs.c` neutralise le suivi IPC et ThreadSanitizer de l'application.

`lib/data/ALLCALL7.TXT` est la base d'indicatifs de JTDX livrée avec WSJT-X (indicatifs vus sur PSK Reporter), utilisée par le décodeur FT8 pour écarter les faux décodages.

- Copyright Joe Taylor (K1JT), Steven Franke (K9AN), l'équipe WSJT-X et les auteurs de JTDX
- Licence : GNU GPL v3 (texte dans `native/wspr/COPYING`)

## cty.dat (pays DXCC)

`lib/data/cty.dat` est le fichier des préfixes DXCC de Jim Reisert (AD1C), https://www.country-files.com, tel que livré avec WSJT-X / Decodium ; utilisé par `lib/dxcc.js` (pays, distance et azimut des stations décodées). Licence de type MIT : texte dans `lib/data/cty.dat_copyright.txt`.

## Décodeur JTTY de WSJT-X

`lib/bin/jttyd` est le récepteur JTTY en continu de WSJT-X 3.3 (interface `jtty_rx_*` : `lib/jtty/*.f90`, codes convolutifs et CRC associés), relié à un petit programme propre à ce projet, `native/wsjtx/jttyd.c` (lit la BF 16 bits / 12 kHz sur l'entrée standard, écrit chaque mise à jour de message), et compilé par `native/wsjtx/build.py` à partir du même dépôt WSJT-X (étiquette v3.3.0-beta2), sans OpenMP (`native/wsjtx/omp_lib.f90`) et sans FFTW.

`lib/bin/jttygen` (et `jttygen.exe`) fabrique le signal JTTY à émettre avec le codeur de WSJT-X 3.3 (`genjtty_profile`, `gen_jttywave` : `lib/jtty/genjtty.f90`, `gen_jttywave.f90`, GPL v3), relié à `native/wsjtx/jttygen.c` (message → entiers 16 bits / 12 kHz sur la sortie standard), compilé de la même façon.

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

## Police Roboto Mono

`public/fonts/roboto-mono-*.woff2`, repris des fichiers embarqués par RigPlane Core (issus de Google Fonts).
Licence : SIL Open Font License 1.1 — voir `public/fonts/LICENSES.md`.

## Modem HamDRM de QSSTV (SSTV numérique, compatible EasyPal)

`lib/bin/drmgen` (émetteur), `lib/bin/drmd` (récepteur) et `lib/bin/drmrs` (Reed-Solomon .rs1 à .rs4) sont compilés par `native/drm/build.sh` à partir du dépôt https://github.com/ON4QZ/QSSTV (commit 31c323ccb848bade1dbab0a96890073f7b9455ea) : `src/drmtx` (cœur Dream de l'émetteur, adapté par PA0MBO), `src/drmrx` (récepteur RXAMADRM de PA0MBO, adapté par ON4QZ), `src/utils/reedsolomoncoder.cpp` et `rs.cpp`, coefficients du filtre de Hilbert de `src/dsp/filterparam.cpp`. Sans Qt ni FFTW : `native/drm/shim/qtshim.h` et `native/drm/shim/fftw3.h` les remplacent ; le décodeur de fichiers de QSSTV est remplacé par `lib/hamdrm.js` (même logique MOT) et la sortie son par celle de `native/drm/drmgen.cpp`. Seule modification du code repris : 12 blocs de fin au lieu de 5 (`MOTSlideShow.cpp`), pour vider l'entrelaceur long avant la fin de l'émission.

- Copyright Volker Fischer et l'équipe Dream (TU Darmstadt), Ties Bos (PA0MBO), Johan Maes (ON4QZ)
- Licence : GNU GPL v3 (QSSTV ; parties Dream sous GPL v2 ou ultérieure) — texte dans `native/wspr/COPYING`

## FreeDV : RADE, codec2, FARGAN (phonie numérique HF)

`lib/bin/fdvd` (Linux x86-64) et `lib/bin/fdvd.exe` (Windows x64) sont compilés par `native/freedv/build.sh` (code propre : `native/freedv/fdvd.c` et `rade_part.c`) à partir de :

- **codec2** (modes 700D, 700E, 1600, texte fiable) : https://github.com/drowe67/codec2, commit 310777b1c6f1af0bc7c72f5b32f80f6fd9136962 — Copyright David Rowe (VK5DGR) et contributeurs — **GNU LGPL 2.1** (texte : `COPYING` du dépôt codec2). Bibliothèque liée statiquement et non modifiée : ses sources et `native/freedv/build.sh` permettent de refaire `fdvd` avec une autre version de codec2.
- **rade_c** (RADE V1, Radio Autoencoder, version C) : https://github.com/freedv/rade_c, commit 23c3746e488dd4825178b4abb857106a5f61a4e6 — Copyright David Rowe, Peter B Marks — **licence BSD à 2 clauses** RADE V1 seulement : les poids de RADE V2 sont remplacés par `native/freedv/rade_v2_stub.c` (programme deux fois plus petit).
- **freedv-backend** (`rade_text`, LDPC : indicatif dans la trame de fin de passage RADE, comme FreeDV) : https://github.com/freedv/freedv-backend, commit 49006b029853061ca4e992f9632a51875aa3ecf1 — Copyright Mooneer Salem (K6AQ) — **licence BSD à 2 clauses**. Journal remplacé par `native/freedv/shim/ulog.h`.
- **Opus** (vocodeur FARGAN, extraction des paramètres de la voix ; correctifs `opus-nnet.*.diff` de rade_c) : https://github.com/xiph/opus, commit 940d4e5af64351ca8ba8390df3f555484c567fbb, poids des réseaux `opus_data-4ed9445b…793453.tar.gz` (media.xiph.org) — Copyright Xiph.Org Foundation, Jean-Marc Valin et contributeurs — **licence BSD à 3 clauses**.
