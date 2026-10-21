#!/usr/bin/env python3
"""
build.py — compile un programme de test de WSJT-X (décodeur en ligne de commande) en exécutable Linux autonome.

Les sources de WSJT-X (GPL v3) ne sont pas copiées ici : le script part d'une copie du dépôt
(https://github.com/WSJTX/wsjtx, dossier lib/) et ne compile que les fichiers réellement nécessaires,
trouvés automatiquement (modules utilisés, sous-programmes appelés). FFTW est remplacé par fftw_kiss.c
(KISS FFT, fourni avec ft8_lib). L'exécutable est lié statiquement aux bibliothèques Fortran / GCC.

  python3 native/wsjtx/build.py --wsjtx /chemin/wsjtx --ft8lib /chemin/ft8_lib --cc gcc --fc gfortran \
      --main lib/jt65.f90 --out lib/bin/jt65
"""
import argparse, os, re, subprocess, sys, shutil, tempfile

ap = argparse.ArgumentParser()
ap.add_argument('--wsjtx', required=True)
ap.add_argument('--ft8lib', required=True)
ap.add_argument('--cc', default='gcc')
ap.add_argument('--fc', default='gfortran')
ap.add_argument('--main', required=True, help='programme principal, relatif au dépôt WSJT-X')
ap.add_argument('--out', required=True)
ap.add_argument('--extra', action='append', default=[], help='source supplémentaire (relative au dépôt)')
ap.add_argument('--prefer', action='append', default=[], help='nom=fichier : fichier à préférer pour un symbole')
ap.add_argument('-v', action='store_true')
ap.add_argument('--static', action='store_true', help='édition de liens entièrement statique')
a = ap.parse_args()

HERE = os.path.dirname(os.path.abspath(__file__))
LIB = os.path.join(a.wsjtx, 'lib')
build = tempfile.mkdtemp(prefix='wsjtx-build-')

# ------------------------------------------------------------------ index des sources
mods, procs, cfuncs = {}, {}, {}
skip_dirs = ('qra/q65/', 'wsprd', 'jtty/wava')
files = []
for root, dirs, fs in os.walk(LIB):
    for f in fs:
        p = os.path.join(root, f)
        rel = os.path.relpath(p, a.wsjtx).replace('\\', '/')
        if any(s in rel for s in skip_dirs): continue
        if f.endswith(('.f90', '.f', '.F90', '.F', '.c')): files.append(p)
mod_re = re.compile(r'^\s*module\s+(\w+)\s*$', re.I | re.M)
proc_re = re.compile(r'^\s*(?:(?:pure|elemental|recursive|real(?:\*\d)?|integer(?:\*\d)?|logical|complex(?:\*\d)?|double\s+precision|character(?:\*\d+)?)\s+)*(subroutine|function)\s+(\w+)', re.I | re.M)
bind_re = re.compile(r'bind\s*\(\s*c\s*,\s*name\s*=\s*[\'"](\w+)[\'"]', re.I)
cfun_re = re.compile(r'^\w[\w\s\*]*?\b(\w+)\s*\([^;{]*\)\s*\{', re.M)
for p in files:
    try:
        t = open(p, errors='replace').read()
    except Exception:
        continue
    if p.endswith('.c'):
        for m in cfun_re.finditer(t): cfuncs.setdefault(m.group(1), []).append(p)
        continue
    for m in mod_re.finditer(t): mods.setdefault(m.group(1).lower(), []).append(p)
    # sous-programmes externes : hors module (approximation : fichiers sans « module » ou contenant « end module » avant)
    if not mod_re.search(t):
        for m in proc_re.finditer(t): procs.setdefault(m.group(2).lower(), []).append(p)
    for m in bind_re.finditer(t): procs.setdefault(m.group(1).lower(), []).append(p)

prefer = dict(x.split('=', 1) for x in a.prefer)
def pick(name, cands):
    if name in prefer: return os.path.join(a.wsjtx, prefer[name])
    cands = sorted(set(cands), key=lambda p: (os.path.splitext(os.path.basename(p))[0].lower() != name, p.count('/'), len(p)))
    return cands[0]

# Sans OpenMP : les décodeurs tournent sur un seul cœur ; les grands tableaux locaux restent en mémoire
# statique (pas sur la pile, qui déborderait). omp_lib.f90 (à côté de ce script) remplace le module OpenMP.
FFLAGS = ['-O2', '-fno-second-underscore', '-ffree-line-length-none', '-fallow-argument-mismatch', '-w',
          '-I' + build, '-J' + build, '-I' + LIB]
CFLAGS = ['-O2', '-w', '-DBIGSYM=1', '-I' + LIB, '-I' + a.ft8lib]

objs = {}
def compile_file(p, stack=()):
    if p in objs: return
    if p in stack: return
    o = os.path.join(build, re.sub(r'[^\w]', '_', os.path.relpath(p, a.wsjtx)) + '.o')
    is_c = p.endswith('.c')
    for _ in range(40):
        cmd = ([a.cc] + CFLAGS if is_c else [a.fc] + FFLAGS) + ['-c', p, '-o', o]
        r = subprocess.run(cmd, capture_output=True, text=True, cwd=os.path.dirname(p))
        if r.returncode == 0:
            objs[p] = o
            if a.v: print('  compilé', os.path.relpath(p, a.wsjtx))
            return
        miss = re.findall(r"Cannot open module file '(\w+)\.mod'", r.stderr, re.I) + re.findall(r"Cannot open module file ‘(\w+)\.mod’", r.stderr, re.I)
        if not miss:
            sys.exit('Échec de compilation de %s :\n%s' % (p, r.stderr[-3000:]))
        for m in miss:
            m = m.lower()
            if m not in mods: sys.exit('Module introuvable : %s (requis par %s)' % (m, p))
            compile_file(pick(m, mods[m]), stack + (p,))
    sys.exit('Trop de tentatives pour ' + p)

shim = os.path.join(HERE, 'fftw_kiss.c')
kiss = [os.path.join(a.ft8lib, 'fft', 'kiss_fft.c'), os.path.join(a.ft8lib, 'fft', 'kiss_fftr.c')]
extra_objs = []
for c in [shim] + kiss:
    o = os.path.join(build, os.path.basename(c) + '.o')
    subprocess.run([a.cc] + CFLAGS + ['-c', c, '-o', o], check=True)
    extra_objs.append(o)

# Module OpenMP de remplacement (un seul fil)
omp = os.path.join(HERE, 'omp_lib.f90')
mods['omp_lib'] = [omp]

compile_file(os.path.join(a.wsjtx, a.main))
for e in a.extra: compile_file(os.path.join(a.wsjtx, e))

os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
# libquadmath en statique aussi (absente de beaucoup de serveurs) : seule la libc reste partagée
quad = subprocess.run([a.fc, '-print-file-name=libquadmath.a'], capture_output=True, text=True).stdout.strip()
extra_objs += [quad] if os.path.isabs(quad) and os.path.exists(quad) else []
tried = set()
for _ in range(200):
    cmd = [a.fc, '-o', a.out, '-Wl,--as-needed'] + list(objs.values()) + extra_objs + ['-static-libgfortran', '-static-libquadmath', '-static-libgcc', '-lm'] + (['-static'] if a.static else []) + ['-lm']
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode == 0:
        print('OK :', a.out, os.path.getsize(a.out), 'octets,', len(objs), 'fichiers WSJT-X')
        shutil.rmtree(build, ignore_errors=True)
        sys.exit(0)
    und = set(re.findall(r"undefined reference to [`'‘](\w+)['’]", r.stderr))
    if not und: sys.exit('Échec de l’édition de liens :\n' + r.stderr[-3000:])
    added = False
    for s in sorted(und):
        name = s.lower()
        base = name[:-1] if name.endswith('_') else name
        cand = procs.get(base) or procs.get(name) or cfuncs.get(s) or cfuncs.get(base)
        if not cand:
            continue
        f = pick(base, cand)
        if f in objs or (s, f) in tried: continue
        tried.add((s, f))
        compile_file(f)
        added = True
    if not added:
        sys.exit('Symboles introuvables : ' + ', '.join(sorted(und)))
sys.exit('Édition de liens : trop de tentatives')
