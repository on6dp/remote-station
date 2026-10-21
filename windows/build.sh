#!/bin/sh
# windows/build.sh — fabrique dist/RemoteStation-Setup-<version>.exe (installateur Windows 10/11 x64) sous Linux.
#
# Besoins : node (lecture de la version), git, makensis (NSIS 3 ; ex. paquet « nsis », ou le makensis Linux des
# binaires d'electron-builder : MAKENSIS=/chemin/linux/makensis NSISDIR=/chemin/nsis), curl (WinSW, une fois).
# Les décodeurs Windows lib/bin/jt65.exe et lib/bin/jttyd.exe sont dans le dépôt. Pour les recompiler :
#   MINGW=/chemin/xpack-mingw-w64-gcc-14.2.0-1/bin WSJTX=/chemin/wsjtx FT8LIB=/chemin/ft8_lib windows/build.sh
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
VERSION=$(node -p "require('$ROOT/package.json').version")
MAKENSIS=${MAKENSIS:-makensis}  # NSIS 3 : makensis et ses « stubs » doivent être de la même version (ex. NSIS 3.10 compilé avec MinGW-w64)
CACHE="$ROOT/windows/.cache"
WINSW_URL=https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe
WINSW_SHA=05b82d46ad331cc16bdc00de5c6332c1ef818df8ceefcd49c726553209b3a0da
mkdir -p "$CACHE" "$ROOT/dist"

# Décodeurs WSJT-X pour Windows (facultatif : déjà fournis)
if [ -n "${MINGW:-}" ]; then
  export PATH="$MINGW:$PATH"
  for spec in "jt65:lib/jt65.f90:--extra lib/ftrsd/init_rs.c --extra lib/ftrsd/encode_rs.c --extra lib/ftrsd/decode_rs.c --extra lib/wrapkarn.c" \
              "jttyd:$ROOT/native/wsjtx/jttyd.c:--extra lib/jtty/jtty_receive_context.f90"; do
    name=${spec%%:*}; rest=${spec#*:}; main=${rest%%:*}; extra=${rest#*:}
    # shellcheck disable=SC2086
    python3 "$ROOT/native/wsjtx/build.py" --wsjtx "$WSJTX" --ft8lib "$FT8LIB" --cc x86_64-w64-mingw32-gcc --fc x86_64-w64-mingw32-gfortran \
      --static --main "$main" $extra --out "$ROOT/lib/bin/$name.exe"
    x86_64-w64-mingw32-strip "$ROOT/lib/bin/$name.exe"
  done
fi

# WinSW (service Windows), vérifié par son empreinte
if [ ! -f "$CACHE/WinSW-x64.exe" ]; then curl -fsSL -o "$CACHE/WinSW-x64.exe" "$WINSW_URL"; fi
echo "$WINSW_SHA  $CACHE/WinSW-x64.exe" | sha256sum -c -

# Dossier préparé : fichiers suivis par git (jamais config.json, users.json, sessions.json, macros.json…)
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/serveur" "$STAGE/outils"
(cd "$ROOT" && git ls-files -z --cached --others --exclude-standard | tar --null -T - -cf -) | tar -xf - -C "$STAGE/serveur"
rm -rf "$STAGE/serveur/native" "$STAGE/serveur/windows" "$STAGE/serveur/deploy" "$STAGE/serveur/releases" "$STAGE/serveur/lib/bin/jt65" "$STAGE/serveur/lib/bin/jttyd" \
       "$STAGE/serveur/.gitignore" "$STAGE/serveur/.gitattributes"
cp "$ROOT/windows/setup.js" "$STAGE/serveur/windows-setup.js"
cp "$ROOT/windows/outils/"*.cmd "$STAGE/outils/"
cp "$CACHE/WinSW-x64.exe" "$STAGE/WinSW-x64.exe"
sed 's/$/\r/' "$ROOT/windows/LISEZMOI-WINDOWS.md" > "$STAGE/LISEZMOI-WINDOWS.txt"

OUT="$ROOT/dist/RemoteStation-Setup-$VERSION.exe"
(cd "$ROOT/windows" && "$MAKENSIS" -V2 -DVERSION="$VERSION" -DSTAGE="$STAGE" -DOUTFILE="$OUT" installer.nsi)
sha256sum "$OUT"
