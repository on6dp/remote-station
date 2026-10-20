#!/bin/sh
# Compile le décodeur FT8/FT4 en WebAssembly (lib/ftx.wasm), sans dépendance à l'exécution.
# Prérequis : wasi-sdk (https://github.com/WebAssembly/wasi-sdk) et les sources de ft8_lib
# (https://github.com/kgoba/ft8_lib, licence MIT).
#   WASI_SDK=/chemin/wasi-sdk FT8_LIB=/chemin/ft8_lib sh native/ftx/build.sh
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
: "${WASI_SDK:?WASI_SDK non défini}"
: "${FT8_LIB:?FT8_LIB non défini}"
"$WASI_SDK/bin/clang" --target=wasm32-wasip1 --sysroot="$WASI_SDK/share/wasi-sysroot" \
  -O3 -DHAVE_STPCPY -I"$FT8_LIB" -mexec-model=reactor \
  -Wl,--strip-all -Wl,--initial-memory=16777216 \
  "$HERE/ftx_wasm.c" "$FT8_LIB"/ft8/*.c "$FT8_LIB"/fft/kiss_fft.c "$FT8_LIB"/fft/kiss_fftr.c "$FT8_LIB"/common/monitor.c \
  -o "$ROOT/lib/ftx.wasm"
ls -l "$ROOT/lib/ftx.wasm"
