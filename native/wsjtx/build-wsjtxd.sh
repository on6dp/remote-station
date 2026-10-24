#!/bin/sh
# build-wsjtxd.sh — compile lib/bin/wsjtxd (Linux x86-64), le moteur de décodage FT8 / FT4 / FT2 de WSJT-X 3.
#   WSJTX=/chemin/wsjtx FT8LIB=/chemin/ft8_lib native/wsjtx/build-wsjtxd.sh
# (Windows : windows/build.sh avec MINGW=…, qui produit lib/bin/wsjtxd.exe)
set -eu
W=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$W/../.." && pwd)
python3 "$W/build.py" --wsjtx "$WSJTX" --ft8lib "$FT8LIB" --openmp --skip wsprd/wsprd,jtty/wava \
  --main "$W/wsjtxd.c" $(sed "s#@W@#$W#g" "$W/wsjtxd.extras") --out "$ROOT/lib/bin/wsjtxd"
strip "$ROOT/lib/bin/wsjtxd"
