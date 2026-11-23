#!/bin/sh
# fdvd (FreeDV RADE V1, 700D, 700E, 1600) pour Remote Station. Sources (voir TIERS.md) :
#   CODEC2=…   https://github.com/drowe67/codec2        commit 310777b1c6f1af0bc7c72f5b32f80f6fd9136962 (LGPL 2.1)
#   RADE_C=…   https://github.com/freedv/rade_c         commit 23c3746e488dd4825178b4abb857106a5f61a4e6 (BSD 2)
#   FDVB=…     https://github.com/freedv/freedv-backend commit 49006b029853061ca4e992f9632a51875aa3ecf1 (BSD 2 : rade_text, LDPC)
#   OPUS=…     https://github.com/xiph/opus             commit 940d4e5af64351ca8ba8390df3f555484c567fbb (BSD), avec dans ce
#              dossier opus_data-4ed9445b96698bad25d852e912b41495ddfa30c8dbc8a55f9cde5826ed793453.tar.gz (poids des réseaux
#              FARGAN / LPCNet, media.xiph.org/opus/models/ ; empreinte SHA-256 vérifiée par autogen.sh)
# Windows x64 en plus (lib/bin/fdvd.exe) : MINGW=/chemin/xpack-mingw-w64-gcc-14.2.0-1/bin
# Usage : CODEC2=… RADE_C=… FDVB=… OPUS=… [MINGW=…] native/freedv/build.sh
set -e
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
HERE="$ROOT/native/freedv"
C2=${CODEC2:?CODEC2=sources de codec2}; RS=${RADE_C:?RADE_C=sources de rade_c}/src; FB=${FDVB:?FDVB=sources de freedv-backend}; OPS=${OPUS:?OPUS=sources d’Opus}
B=$(mktemp -d)
trap 'rm -rf "${B:?}"' EXIT
J=$(nproc)

# 1. codec2 (cmake) : tables de codebook et version.h ; liste des sources de la bibliothèque
cmake -S "$C2" -B "$B/c2" -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DUNITTEST=OFF >/dev/null
cmake --build "$B/c2" --target codec2 -j"$J" >/dev/null
mkdir -p "$B/c2src"
for f in $(sed -n '/set(CODEC2_SRCS/,/^)/p' "$C2/src/CMakeLists.txt" | sed '1d;$d' | tr -d ' ' | sort -u); do
  if [ -f "$C2/src/$f" ]; then cp "$C2/src/$f" "$B/c2src/"; else cp "$B/c2/src/$f" "$B/c2src/"; fi
done

# 2. rade_text et LDPC de freedv-backend, journal remplacé par rien
mkdir -p "$B/fb/pipeline" "$B/fb/util/logging"
for f in rade_text.cpp rade_text.h ldpc_encode.cpp ldpc_encode.h ldpc_decode.cpp ldpc_decode.h HRA_56_56.h; do cp "$FB/src/pipeline/$f" "$B/fb/pipeline/"; done
cp "$HERE/shim/ulog.h" "$B/fb/util/logging/ulog.h"

# RADE V1 seulement : les poids de V2 (rade_enc_v2_data.c, rade_dec_v2_data.c, ≈ 12 Mo) sont remplacés par rade_v2_stub.c
RADE_SRCS="rade_api.c rade_enc.c rade_dec.c rade_enc_data.c rade_dec_data.c rade_dsp.c rade_ofdm.c rade_bpf.c rade_acq.c rade_tx.c rade_rx.c rade_enc_v2.c rade_dec_v2.c rade_sync.c rade_sync_data.c rade_v2_ofdm.c rade_tx_v2.c rade_rx_v2.c"

# 3. Opus avec FARGAN (correctifs de rade_c), puis fdvd ; $1 = préfixe du compilateur ('' ou x86_64-w64-mingw32-), $2 = sortie
build() {
  P=$1; OUT=$2; W="$B/w$P"
  mkdir -p "$W/o"
  cp -r "$OPS" "$W/opus"
  rm -rf "$W/opus/.git"
  ( cd "$W/opus" && patch -s dnn/nnet.h < "$RS/opus-nnet.h.diff" && patch -s dnn/nnet.c < "$RS/opus-nnet.c.diff" && ./autogen.sh >/dev/null 2>&1 && \
    ./configure --with-pic --enable-osce --enable-dred --disable-shared --disable-doc --disable-extra-programs ${P:+--host=${P%-}} CC="${P}gcc" >/dev/null && make -j"$J" >/dev/null )
  OP="$W/opus"
  OPI="-I$OP -I$OP/include -I$OP/dnn -I$OP/celt -I$OP/silk"
  CC="${P}gcc -O2 -w"; CXX="${P}g++ -O2 -w"
  [ -n "$P" ] && CC="$CC -D_USE_MATH_DEFINES" && CXX="$CXX -D_USE_MATH_DEFINES"
  cd "$W/o"
  for f in $RADE_SRCS; do $CC -c -DIS_BUILDING_RADE_API=1 -I"$RS" $OPI "$RS/$f" -o "rade_$f.o"; done
  for f in "$B"/c2src/*.c; do $CC -std=gnu11 -DGIT_HASH=\"310777b\" -c -I"$C2/src" -I"$B/c2/codec2" -I"$B/c2" "$f" -o "c2_$(basename "$f").o"; done
  for f in rade_text ldpc_encode ldpc_decode; do $CXX -c -DIS_BUILDING_RADE_API=1 -I"$B/fb/pipeline" -I"$RS" $OPI "$B/fb/pipeline/$f.cpp" -o "$f.o"; done
  $CC -c -DIS_BUILDING_RADE_API=1 -I"$HERE" -I"$RS" $OPI -I"$B/fb/pipeline" "$HERE/rade_part.c" -o rade_part.o
  $CC -c -DIS_BUILDING_RADE_API=1 -I"$RS" $OPI "$HERE/rade_v2_stub.c" -o rade_v2_stub.o
  $CC -c -I"$HERE" -I"$C2/src" -I"$B/c2/codec2" -I"$B/c2" "$HERE/fdvd.c" -o fdvd.o
  ${P}g++ -static -o "$OUT" ./*.o "$OP/.libs/libopus.a" -lm ${P:+-lssp}
  ${P}strip "$OUT"
  cd "$ROOT"
}
build "" "$ROOT/lib/bin/fdvd"
echo "fdvd : OK"
if [ -n "${MINGW:-}" ]; then
  export PATH="$MINGW:$PATH"
  build x86_64-w64-mingw32- "$ROOT/lib/bin/fdvd.exe"
  echo "fdvd.exe : OK"
fi
