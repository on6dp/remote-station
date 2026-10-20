#!/bin/sh
# Compile le décodeur WSPR de WSJT-X (wsprd, K9AN / K1JT, licence GNU GPL v3) en WebAssembly (lib/wsprd.wasm).
# FFTW est remplacé par KISS FFT (shim/fftw3.h) ; l'OSD Fortran n'est pas utilisé (shim/osd_stub.c).
#   WASI_SDK=/chemin/wasi-sdk FT8_LIB=/chemin/ft8_lib sh native/wspr/build.sh
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
: "${WASI_SDK:?WASI_SDK non défini}"
: "${FT8_LIB:?FT8_LIB non défini}"
"$WASI_SDK/bin/clang" --target=wasm32-wasip1 --sysroot="$WASI_SDK/share/wasi-sysroot" \
  -O2 -ffast-math -I"$HERE/shim" -I"$FT8_LIB" -D_WASI_EMULATED_PROCESS_CLOCKS -Wno-everything \
  "$HERE/wsprd.c" "$HERE/wsprd_utils.c" "$HERE/wsprsim_utils.c" "$HERE/tab.c" "$HERE/fano.c" "$HERE/jelinek.c" "$HERE/nhash.c" \
  "$HERE/shim/osd_stub.c" "$FT8_LIB/fft/kiss_fft.c" "$FT8_LIB/fft/kiss_fftr.c" \
  -lwasi-emulated-process-clocks -Wl,--strip-all -Wl,-z,stack-size=67108864 -Wl,--initial-memory=134217728 -Wl,--max-memory=536870912 \
  -o "$ROOT/lib/wsprd.wasm"
ls -l "$ROOT/lib/wsprd.wasm"
