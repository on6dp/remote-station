#!/bin/sh
# build.sh — compile les programmes HamDRM de Remote Station (Linux x86-64) à partir du code de QSSTV (ON4QZ, GPL v3) :
#   lib/bin/drmgen  émetteur : fichier → signal DRM (s16, mono, 12 kHz)
#   lib/bin/drmd    récepteur : BF (s16, mono, 12 kHz) → état, constellation et paquets MSC (JSON)
#   lib/bin/drmrs   Reed-Solomon .rs1 à .rs4 (compatible EasyPal / QSSTV)
# Usage : QSSTV=/chemin/QSSTV native/drm/build.sh   (dépôt https://github.com/ON4QZ/QSSTV, commit ci-dessous)
# Qt et FFTW ne sont pas nécessaires : shim/qtshim.h et shim/fftw3.h les remplacent.
set -eu
W=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$W/../.." && pwd)
Q="${QSSTV:?QSSTV=chemin du dépôt QSSTV}/src"
B=$(mktemp -d)
trap 'rm -rf "$B"' EXIT
# Fichiers des shims en premier (appglobal.h, configparams.h, QString… remplacés)
SH="$B/shim"; mkdir -p "$SH"
cp "$W"/shim/*.h "$SH/"
for h in QString QByteArray QList QVector QObject QMutex QDebug QDateTime QFile QFileInfo QTemporaryFile QThread; do echo '#include "qtshim.h"' > "$SH/$h"; done
cp "$SH/appglobal.h" "$SH/supportfunctions.h"; cp "$SH/appglobal.h" "$SH/logging.h"
CXX="${CXX:-g++} -std=c++17 -O2 -w -fno-strict-aliasing"
LD="-static" # entièrement statique : aucune exigence de version de glibc sur le serveur
# --- émetteur : drmtx/common de QSSTV (sauf la sortie son), entrelaceur long vidé avant la fin (extraBlocks 5 → 12)
mkdir -p "$B/tx" "$B/otx"
cp -r "$Q/drmtx" "$B/tx/"
sed -i 's/extraBlocks=5;/extraBlocks=12;/' "$B/tx/drmtx/common/datadecoding/MOTSlideShow.cpp"
INC="-I$SH -I$Q -I$B/tx/drmtx -I$B/tx/drmtx/common -I$Q/drmrx -I$Q/utils"
for f in $(find "$B/tx/drmtx/common" -name '*.cpp' ! -name csoundout.cpp); do $CXX $INC -c "$f" -o "$B/otx/$(basename "$f" .cpp).o"; done
$CXX $INC -c "$W/drmgen.cpp" -o "$B/otx/drmgen_main.o"
$CXX -o "$ROOT/lib/bin/drmgen" "$B"/otx/*.o $LD -lm
# --- récepteur : drmrx de QSSTV, décodeur de fichiers remplacé (fichiers reconstitués par lib/hamdrm.js)
mkdir -p "$B/rx" "$B/orx"
cp "$Q"/drmrx/*.cpp "$Q"/drmrx/*.h "$B/rx/"
rm -f "$B/rx/sourcedecoder.cpp" "$B/rx/drmrx.cpp" "$B/rx/drmrx.h" "$B"/rx/*frame* "$B"/rx/fixform*
cp "$W/rx/sourcedecoder.h" "$B/rx/"
# coefficients du filtre de Hilbert de QSSTV (dsp/filterparam.cpp)
awk '/drmHilbertCoef\[DRMHILBERTTAPS\]=/{f=1} f{print} f&&/};/{exit}' "$Q/dsp/filterparam.cpp" | sed 's/const FILTERPARAMTYPE drmHilbertCoef\[DRMHILBERTTAPS\]=/static const double drmHilbertCoef[153]=/' > "$B/rx/hilbert_taps.inc"
sed 's|^TAPS$|#include "hilbert_taps.inc"|' "$W/rx/drmd.cpp" > "$B/rx/drmd.cpp"
for f in "$B"/rx/*.cpp; do $CXX -I$SH -I$B/rx -I$Q -I$Q/utils -c "$f" -o "$B/orx/$(basename "$f" .cpp).o"; done
$CXX -o "$ROOT/lib/bin/drmd" "$B"/orx/*.o $LD -lm
# --- Reed-Solomon
$CXX -I$SH -I$Q -I$Q/utils -c "$Q/utils/reedsolomoncoder.cpp" -o "$B/rsc.o"
$CXX -I$SH -I$Q -I$Q/utils -c "$Q/utils/rs.cpp" -o "$B/rsl.o"
$CXX -I$SH -I$Q -I$Q/utils -c "$W/drmrs.cpp" -o "$B/drmrs.o"
$CXX -o "$ROOT/lib/bin/drmrs" "$B/drmrs.o" "$B/rsc.o" "$B/rsl.o" $LD -lm
strip "$ROOT/lib/bin/drmgen" "$ROOT/lib/bin/drmd" "$ROOT/lib/bin/drmrs"
echo "drmgen, drmd, drmrs : OK"
