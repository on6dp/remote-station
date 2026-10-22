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
# Copie de ft8_lib avec une seule retouche : plage de recherche en temps réglable (FT2 : 3,75 s, départs asynchrones)
PATCHED=$(mktemp -d)
trap 'rm -rf "$PATCHED"' EXIT
cp -r "$FT8_LIB/ft8" "$FT8_LIB/fft" "$FT8_LIB/common" "$PATCHED/"
sed -i 's/candidate.time_offset = -10; candidate.time_offset < 20;/candidate.time_offset = ftx_t_min; candidate.time_offset < ftx_t_max;/' "$PATCHED/ft8/decode.c"
sed -i '0,/^int ftx_find_candidates/s//int ftx_t_min = -10, ftx_t_max = 20;\nint ftx_find_candidates/' "$PATCHED/ft8/decode.c"
grep -q "ftx_t_min = -10" "$PATCHED/ft8/decode.c" && grep -q "time_offset < ftx_t_max" "$PATCHED/ft8/decode.c" || { echo "retouche de ft8/decode.c impossible"; exit 1; }
FT8_LIB="$PATCHED"
"$WASI_SDK/bin/clang" --target=wasm32-wasip1 --sysroot="$WASI_SDK/share/wasi-sysroot" \
  -O3 -DHAVE_STPCPY -I"$FT8_LIB" -mexec-model=reactor \
  -Wl,--strip-all -Wl,--initial-memory=16777216 \
  "$HERE/ftx_wasm.c" "$FT8_LIB"/ft8/*.c "$FT8_LIB"/fft/kiss_fft.c "$FT8_LIB"/fft/kiss_fftr.c "$FT8_LIB"/common/monitor.c \
  -o "$ROOT/lib/ftx.wasm"
ls -l "$ROOT/lib/ftx.wasm"

# Codeur FT8 / FT4 / FT2 (émission, page Station) : public/js/ftx-enc.wasm
"$WASI_SDK/bin/clang" --target=wasm32-wasip1 --sysroot="$WASI_SDK/share/wasi-sysroot" \
  -O3 -DHAVE_STPCPY -I"$FT8_LIB" -mexec-model=reactor \
  -Wl,--strip-all -Wl,--initial-memory=16777216 \
  "$HERE/ftx_enc.c" "$FT8_LIB"/ft8/message.c "$FT8_LIB"/ft8/text.c "$FT8_LIB"/ft8/encode.c "$FT8_LIB"/ft8/constants.c "$FT8_LIB"/ft8/crc.c \
  -o "$ROOT/public/js/ftx-enc.wasm"
ls -l "$ROOT/public/js/ftx-enc.wasm"
