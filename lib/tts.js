'use strict';
/*
 * tts.js — messages vocaux en anglais ou en français pour les mémoires T1 à T8 (page TRX SSB), fabriqués sur le serveur par
 * espeak-ng (paquet Debian / Ubuntu « espeak-ng »). L'indicatif est épelé en alphabet phonétique (ON6DP →
 * « Oscar November Six Delta Papa »), les abréviations radioamateur sont dites lettre par lettre (C Q, Q R Z…).
 * Sortie : µ-law 12 kHz, comme les mémoires enregistrées au micro (voicemem/<INDICATIF>-T<n>.ul).
 */
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CMD = process.env.RS_TTS_CMD || 'espeak-ng';
const RATE = 12000;
const NATO = { A: 'Alfa', B: 'Bravo', C: 'Charlie', D: 'Delta', E: 'Echo', F: 'Foxtrot', G: 'Golf', H: 'Hotel', I: 'India', J: 'Juliett',
  K: 'Kilo', L: 'Lima', M: 'Mike', N: 'November', O: 'Oscar', P: 'Papa', Q: 'Quebec', R: 'Romeo', S: 'Sierra', T: 'Tango', U: 'Uniform',
  V: 'Victor', W: 'Whiskey', X: 'X-ray', Y: 'Yankee', Z: 'Zulu' };
const DIG = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
const DIG_FR = ['Zéro', 'Un', 'Deux', 'Trois', 'Quatre', 'Cinq', 'Six', 'Sept', 'Huit', 'Neuf'];
// Voix proposées (variantes d'espeak-ng) : féminines et masculines, anglais US et GB, français
const VOICES = Object.fromEntries(['en-us', 'en-us+m3', 'en-gb', 'en-gb+m3', 'en-us+f2', 'en-us+f3', 'en-us+f4', 'en-us+f5', 'en-us+Annie', 'en-us+linda',
  'en-us+belinda', 'en-us+steph', 'en-us+victoria', 'en-gb+f2', 'en-gb+f3', 'en-gb+linda', 'en-gb+victoria',
  'fr', 'fr+m3', 'fr+f2', 'fr+f3', 'fr+f4', 'fr+linda', 'fr+victoria', 'fr+Annie'].map((v) => [v, v]));
const isFr = (voice) => /^(piper:)?fr/i.test(String(voice || '')) || /^kokoro:f/i.test(String(voice || ''));

// Voix Kokoro (deploy/install-kokoro.sh) : modèle neuronal libre (Apache 2.0, 82 M de paramètres), le plus réaliste en local ;
// tts/kokoro/venv (Python, paquet kokoro-onnx), tts/kokoro/kokoro-v1.0.onnx, voices-v1.0.bin et kokoro_say.py
const KOKORO_DIR = path.join(TTS_DIR_K(), 'kokoro');
function TTS_DIR_K() { return process.env.RS_TTS_DIR || path.join(__dirname, '..', 'tts'); }
const KOKORO_PY = path.join(KOKORO_DIR, 'venv', 'bin', 'python3');
// Voix proposées (notes de qualité de hexgrad/Kokoro-82M, VOICES.md : les meilleures d'abord)
const KOKORO_VOICES = [
  ['af_heart', 'Heart · femme US', 'en'], ['af_bella', 'Bella · femme US', 'en'], ['af_nicole', 'Nicole · femme US (douce)', 'en'],
  ['am_michael', 'Michael · homme US', 'en'], ['am_fenrir', 'Fenrir · homme US', 'en'], ['am_puck', 'Puck · homme US', 'en'],
  ['bf_emma', 'Emma · femme GB', 'en'], ['bf_isabella', 'Isabella · femme GB', 'en'], ['bm_george', 'George · homme GB', 'en'], ['bm_fable', 'Fable · homme GB', 'en'],
  ['ff_siwis', 'Siwis · femme FR', 'fr']];
// Script : celui du programme (deploy/kokoro_say.py, à jour à chaque mise à jour), sinon la copie de tts/kokoro
const KOKORO_SCRIPT = () => { const a = path.join(__dirname, '..', 'deploy', 'kokoro_say.py'); return fs.existsSync(a) ? a : path.join(KOKORO_DIR, 'kokoro_say.py'); };
function kokoroOk() {
  try { return fs.existsSync(KOKORO_PY) && fs.existsSync(path.join(KOKORO_DIR, 'kokoro-v1.0.onnx')) && fs.existsSync(path.join(KOKORO_DIR, 'voices-v1.0.bin')) && fs.existsSync(KOKORO_SCRIPT()); } catch (e) { return false; }
}
// Processus Kokoro gardé en marche (modèle chargé une seule fois : 2 à 3 s de moins par message) ; arrêté après 15 min
// sans demande ; une demande à la fois (file d'attente)
const KW = { p: null, buf: Buffer.alloc(0), q: [], cur: null, idle: null };
function kwStart() {
  if (KW.p) return KW.p;
  const p = spawn(KOKORO_PY, [KOKORO_SCRIPT(), '--serve'], { cwd: KOKORO_DIR, env: Object.assign({}, process.env, { RS_KOKORO_DIR: KOKORO_DIR }), stdio: ['pipe', 'pipe', 'pipe'] });
  KW.p = p; KW.buf = Buffer.alloc(0); KW.err = '';
  p.stdout.on('data', (c) => { KW.buf = Buffer.concat([KW.buf, c]); kwRead(); });
  p.stderr.on('data', (c) => { KW.err = (KW.err + c).slice(-2000); });
  const dead = (why) => {
    if (KW.p !== p) return;
    KW.p = null;
    const all = (KW.cur ? [KW.cur] : []).concat(KW.q);
    KW.cur = null; KW.q = [];
    for (const r of all) { clearTimeout(r.t); r.reject(new Error('Kokoro : ' + (why || (KW.err.split('\n').filter(Boolean).pop() || 'arrêté')).slice(0, 160))); }
  };
  p.on('error', (e) => dead(e.code === 'ENOENT' ? 'absent du serveur (deploy/install-kokoro.sh)' : e.message));
  p.on('close', () => dead());
  return p;
}
function kwRead() {
  while (KW.cur && KW.buf.length >= 8) {
    const n = KW.buf.readInt32LE(0), rate = KW.buf.readUInt32LE(4), len = Math.abs(n);
    if (KW.buf.length < 8 + len) return;
    const body = KW.buf.subarray(8, 8 + len);
    KW.buf = KW.buf.subarray(8 + len);
    const r = KW.cur; KW.cur = null; clearTimeout(r.t);
    if (n < 0) r.reject(new Error('Kokoro : ' + body.toString('utf8').slice(0, 160)));
    else {
      const pcm = new Float32Array(Math.floor(len / 2));
      for (let i = 0; i < pcm.length; i++) pcm[i] = body.readInt16LE(i * 2) / 32768;
      r.resolve({ pcm, rate: rate || 24000 });
    }
    kwNext();
  }
}
function kwNext() {
  if (KW.cur || !KW.q.length) {
    if (!KW.cur && !KW.q.length) { clearTimeout(KW.idle); KW.idle = setTimeout(() => { if (KW.p && !KW.cur) { try { KW.p.kill(); } catch (e) { /* */ } } }, 15 * 60000); }
    return;
  }
  clearTimeout(KW.idle);
  const p = kwStart();
  KW.cur = KW.q.shift();
  KW.cur.t = setTimeout(() => { const r = KW.cur; KW.cur = null; try { p.kill('SIGKILL'); } catch (e) { /* */ } if (r) r.reject(new Error('Kokoro trop lent (plus de 90 s)')); }, 90000);
  try { p.stdin.write(JSON.stringify(KW.cur.req) + '\n'); } catch (e) { /* processus arrêté : rejeté par « close » */ }
}
/** Démarrage d'avance (page TRX SSB ouverte) : le premier « ▶ Écouter » n'attend plus le chargement du modèle */
function kokoroWarm() { if (kokoroOk() && !KW.p) { try { kwStart(); kwNext(); } catch (e) { /* */ } } }
function kokoroVoices() { return kokoroOk() ? KOKORO_VOICES.map(([v, n, lang]) => ({ id: 'kokoro:' + v, name: n, lang, kind: 'kokoro' })) : []; }
/** Kokoro : demande au processus gardé en marche (modèle déjà chargé) */
function kokoroSynth(voice, words, speed) {
  const lang = /^b/.test(voice) ? 'en-gb' : /^f/.test(voice) ? 'fr-fr' : 'en-us';
  // Siwis (seule voix française de Kokoro) parle naturellement très vite : ralentie de 20 % en plus du réglage Vitesse
  const sp = Math.max(0.5, Math.min(1.6, speed / 170 * (/^f/.test(voice) ? 0.8 : 1)));
  return new Promise((resolve, reject) => { KW.q.push({ req: { text: words, voice, speed: sp, lang }, resolve, reject }); kwNext(); });
}
// (ancienne façon : un processus par message, gardée pour essai à la main)
function kokoroSynthOnce(voice, words, speed) {
  const lang = /^b/.test(voice) ? 'en-gb' : /^f/.test(voice) ? 'fr-fr' : 'en-us';
  const sp = Math.max(0.6, Math.min(1.6, speed / 170));
  return new Promise((resolve, reject) => {
    const p = spawn(KOKORO_PY, [KOKORO_SCRIPT()], { cwd: KOKORO_DIR, env: Object.assign({}, process.env, { RS_KOKORO_DIR: KOKORO_DIR }), stdio: ['pipe', 'pipe', 'pipe'] });
    const parts = [];
    let n = 0, errTxt = '';
    const kill = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('Kokoro trop lent (plus de 90 s)')); }, 90000);
    p.stdout.on('data', (c) => { n += c.length; if (n < 64 * 1024 * 1024) parts.push(c); });
    p.stderr.on('data', (c) => { if (errTxt.length < 4000) errTxt += c; });
    p.on('error', (e) => { clearTimeout(kill); reject(new Error(e.code === 'ENOENT' ? 'Kokoro absent du serveur (deploy/install-kokoro.sh)' : 'Kokoro : ' + e.message)); });
    p.on('close', (code) => {
      clearTimeout(kill);
      const buf = Buffer.concat(parts);
      if (code !== 0 || buf.length < 104) return reject(new Error('Kokoro : ' + (errTxt.split('\n').filter(Boolean).pop() || 'code ' + code).slice(0, 160)));
      const rate = buf.readUInt32LE(0) || 24000;
      const pcm = new Float32Array(Math.floor((buf.length - 4) / 2));
      for (let i = 0; i < pcm.length; i++) pcm[i] = buf.readInt16LE(4 + i * 2) / 32768;
      resolve({ pcm, rate });
    });
    p.stdin.end(JSON.stringify({ text: words, voice, speed: sp, lang }));
  });
}

// Voix naturelles Piper (deploy/install-voix.sh) : <programme>/tts/piper/piper et tts/voices/<nom>.onnx (+ .onnx.json)
const TTS_DIR = process.env.RS_TTS_DIR || path.join(__dirname, '..', 'tts');
const PIPER = process.env.RS_PIPER_CMD || path.join(TTS_DIR, 'piper', 'piper');
const PIPER_NAMES = {
  'en-us-kathleen-low': 'Kathleen · femme US', 'en-us-amy-low': 'Amy (ancienne) · femme US', 'en-us-lessac-medium': 'Lessac · femme US',
  'en-gb-southern_english_female-low': 'Femme GB', 'en-us-ryan-medium': 'Ryan (ancien) · homme US', 'en-gb-alan-low': 'Alan · homme GB',
  'fr-siwis-medium': 'Siwis (ancienne) · femme', 'fr-siwis-low': 'Siwis (ancienne) · femme', 'fr-gilles-low': 'Gilles · homme', 'fr-mls_1840-low': 'Homme',
  'fr_FR-tom-medium': 'Tom · homme', 'fr_FR-siwis-medium': 'Siwis · femme', 'fr_FR-upmc-medium@jessica': 'Jessica · femme', 'fr_FR-upmc-medium@pierre': 'Pierre · homme',
  'fr_FR-gilles-low': 'Gilles · homme', 'en_US-kristin-medium': 'Kristin · femme US', 'en_US-amy-medium': 'Amy · femme US', 'en_GB-jenny_dioco-medium': 'Jenny · femme GB',
  'en_GB-cori-high': 'Cori · femme GB', 'en_US-lessac-high': 'Lessac · femme US', 'en_US-hfc_female-medium': 'Femme US', 'en_US-ryan-high': 'Ryan · homme US',
  'en_US-joe-medium': 'Joe · homme US', 'en_US-john-medium': 'John · homme US', 'en_US-hfc_male-medium': 'Homme US', 'en_GB-northern_english_male-medium': 'Homme GB (nord)',
  'en_GB-alan-medium': 'Alan · homme GB'
};
/** Voix Piper installées : [{ id: 'piper:fr_FR-tom-medium' ou 'piper:fr_FR-upmc-medium@jessica', name, lang }] (voix à plusieurs locuteurs : une par locuteur) */
function piperVoices() {
  let list = [];
  try { if (!fs.existsSync(PIPER)) return []; list = fs.readdirSync(path.join(TTS_DIR, 'voices')); } catch (e) { return []; }
  const out = [];
  for (const f of list.filter((x) => /^[A-Za-z0-9_-]+\.onnx$/.test(x) && list.indexOf(x + '.json') >= 0).sort()) {
    const n = f.slice(0, -5);
    let spk = null;
    try { const j = JSON.parse(fs.readFileSync(path.join(TTS_DIR, 'voices', f + '.json'), 'utf8')); if (j.num_speakers > 1 && j.speaker_id_map) spk = Object.keys(j.speaker_id_map).slice(0, 12); } catch (e) { continue; }
    const lang = /^fr/i.test(n) ? 'fr' : 'en';
    if (spk) for (const k of spk) out.push({ id: 'piper:' + n + '@' + k, name: PIPER_NAMES[n + '@' + k] || n + ' · ' + k, lang });
    else out.push({ id: 'piper:' + n, name: PIPER_NAMES[n] || n, lang });
  }
  return out;
}

/** Indicatif en alphabet phonétique : « ON6DP/P » → « Oscar November Six Delta Papa portable » */
function spellCall(call, gap, fr, plain) {
  const c = String(call || '').toUpperCase().replace(/[^A-Z0-9/]/g, '');
  const parts = c.split('/');
  const out = [];
  parts.forEach((p, i) => {
    if (i > 0) {
      if (p === 'P') { out.push('portable'); return; }
      if (p === 'M') { out.push('mobile'); return; }
      if (p === 'MM') { out.push(fr ? 'maritime mobile' : 'maritime mobile'); return; }
      if (p === 'QRP') { out.push('Q, R, P'); return; }
      out.push(fr ? 'barre' : 'stroke');
    }
    // Alphabet phonétique international (aussi en français, comme sur l'air) ; chiffres dans la langue de la voix
    for (const ch of p) out.push(/\d/.test(ch) ? (fr ? DIG_FR : DIG)[+ch] : NATO[ch] || ch);
  });
  // Petite pause entre les lettres épelées (SSML, espeak-ng -m) ; sans virgules (la voix serait hachée)
  // Piper (texte simple) : une virgule fait une petite pause naturelle
  // Kokoro : les virgules y font de vraies pauses (« Victor… Lima ») : lettres liées d'un trait, virgules seulement
  // si l'on demande une grande pause entre les lettres (≥ 200 ms)
  if (plain === 'k') return gap >= 200 ? out.join(', ') : out.join(' ');
  if (plain) return gap >= 40 ? out.join(', ') : out.join(' ');
  return gap > 0 ? out.join(' <break time="' + Math.round(gap) + 'ms"/> ') : out.join(' ');
}
/** Texte du message : {CALL} épelé, abréviations lettre par lettre, nombres radioamateur */
function expand(text, call, gap, fr, plain) {
  let t = String(text || '').replace(/\{CALL\}/gi, ' ' + spellCall(call, gap, fr, plain) + ' ');
  // Abréviations lettre par lettre ; en français, épelées comme on les dit (« cu ère zède »), sinon la voix lit « Q ter zed »
  const FR_ABR = { CQ: 'cé kiou', QRZ: 'cu ère zède', QRL: 'cu ère elle', QSO: 'cu esse o', QSL: 'cu esse elle', QTH: 'cu té ache', QRP: 'cu ère pé', DX: 'dé ixe' };
  // En anglais, « Z » se dit « zed » (comme en radioamateur européen), pas « zee » (américain) : Q R zed
  t = t.replace(/\b(CQ|QRZ|QRL|QSO|QSL|QTH|QRP|DX|TU)\b/g, (m) => (m === 'TU' ? (fr ? 'merci' : 'thank you') : fr ? FR_ABR[m] : m.split('').map((c) => (c === 'Z' ? 'zed' : c)).join(' ')));
  t = fr ? t.replace(/\b73\b/g, 'soixante-treize').replace(/\b59\b/g, 'cinq neuf').replace(/\b5NN\b/gi, 'cinq neuf')
    : t.replace(/\b73\b/g, 'seventy three').replace(/\b59\b/g, 'five nine').replace(/\b5NN\b/gi, 'five nine');
  return t.replace(/\s+/g, ' ').trim();
}
// Prononciations : l'alphabet phonétique international lu par une voix française (« Roméo », « Zoulou »…) ;
// complétées ou remplacées par celles de l'opérateur (« mot=dit comme », page TRX SSB)
const PRON = {
  fr: { Charlie: 'Tcharli', Echo: 'Écho', Hotel: 'Hôtel', Juliett: 'Djouliette', Mike: 'Maïk', November: 'Novembre', Quebec: 'Québec',
    Romeo: 'Roméo', Uniform: 'Iouniform', Whiskey: 'Ouisski', 'X-ray': 'Ixe-rè', Yankee: 'Yanki', Zulu: 'Zoulou',
    // En français, les mois se disent en français (N = « Novembre », comme on l'épelle sur l'air)
    January: 'janvier', February: 'février', March: 'mars', April: 'avril', May: 'mai', June: 'juin', July: 'juillet', August: 'août',
    September: 'septembre', October: 'octobre', December: 'décembre' },
  en: {}
};
const escRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function applyPron(t, fr, user) {
  const map = Object.assign({}, PRON[fr ? 'fr' : 'en']);
  if (user && typeof user === 'object') for (const [k, v] of Object.entries(user).slice(0, 60)) {
    const a = clean(k, 40).trim(), b = clean(v, 60).trim();
    if (a) map[a] = b;
  }
  for (const [a, b] of Object.entries(map)) {
    if (!a || !b) continue;
    t = t.replace(new RegExp('(^|[^\\p{L}])' + escRe(a) + '(?![\\p{L}])', 'giu'), (m, pre) => pre + b);
  }
  return t;
}
// Lettres (accents compris), chiffres, ponctuation simple ; rien qui ressemble à du SSML
const clean = (s, n) => String(s || '').replace(/[^\p{L}\p{N} ,.?!'’{}\/-]/gu, ' ').slice(0, n || 300);

/** WAV (PCM 16 bits mono) → Float32Array et sa fréquence */
function parseWav(buf) {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error('réponse d’espeak-ng illisible');
  let pos = 12, rate = 22050, bits = 16, ch = 1, data = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    let len = buf.readUInt32LE(pos + 4);
    if (id === 'fmt ') { ch = buf.readUInt16LE(pos + 10); rate = buf.readUInt32LE(pos + 12); bits = buf.readUInt16LE(pos + 22); }
    if (id === 'data') { if (len === 0 || len === 0xffffffff || pos + 8 + len > buf.length) len = buf.length - pos - 8; data = buf.subarray(pos + 8, pos + 8 + len); break; }
    pos += 8 + len + (len & 1);
  }
  if (!data || bits !== 16) throw new Error('format audio inattendu');
  const n = Math.floor(data.length / 2 / ch);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = data.readInt16LE(i * 2 * ch) / 32768;
  return { pcm: out, rate };
}
/** Rééchantillonnage vers 12 kHz (moyenne sur la fenêtre : filtre passe-bas simple), crête à −1 dB, silences autour */
function to12k(pcm, rate) {
  // Filtre passe-bas (sinus cardinal fenêtré, coupure 4,8 kHz) puis rééchantillonnage : pas de repliement (son métallique)
  const ratio = rate / RATE;
  let src = pcm;
  if (rate > RATE) {
    const fc = 4800 / rate, M = 64, h = new Float32Array(M + 1);
    let hs = 0;
    for (let k = 0; k <= M; k++) {
      const x = k - M / 2;
      h[k] = (x === 0 ? 2 * Math.PI * fc : Math.sin(2 * Math.PI * fc * x) / x) * (0.54 - 0.46 * Math.cos(2 * Math.PI * k / M));
      hs += h[k];
    }
    src = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) {
      let acc = 0;
      for (let k = 0; k <= M; k++) { const j = i + k - M / 2; if (j >= 0 && j < pcm.length) acc += pcm[j] * h[k]; }
      src[i] = acc / hs;
    }
  }
  const n = Math.floor(src.length / ratio);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i * ratio, j = Math.floor(x), f = x - j;
    out[i] = (src[j] || 0) * (1 - f) + (src[j + 1] || 0) * f;
  }
  // Niveau comme une voix au micro (≈ −18 dB efficaces sur les passages parlés, crêtes ≤ −4 dB) : une voix de synthèse
  // ramenée à 0 dB de crête est très comprimée, elle pousse l'ALC et le processeur du TRX et sort « robotique » sur l'air
  let peak = 0, sum = 0, cnt = 0;
  for (const v of out) { const a = Math.abs(v); if (a > peak) peak = a; }
  for (const v of out) if (Math.abs(v) > peak * 0.05) { sum += v * v; cnt++; }
  const rms = cnt ? Math.sqrt(sum / cnt) : 0;
  const g = rms > 1e-4 ? Math.min(0.125 / rms, peak > 0.001 ? 0.63 / peak : 1) : 1;
  // Silence avant le message : 0,4 s, le temps que le TRX passe en émission (relais, ALC) — sinon le début du premier
  // mot est mangé (« Again » entendu « gain », « Zero » entendu « ero ») ; 0,15 s après
  const pad = Math.round(RATE * 0.15), lead = Math.round(RATE * 0.4);
  const res = new Float32Array(n + lead + pad);
  for (let i = 0; i < n; i++) res[lead + i] = out[i] * g;
  return res;
}
/** G.711 µ-law */
function ulaw(pcm) {
  const out = Buffer.alloc(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    let s = Math.max(-32635, Math.min(32635, Math.round(pcm[i] * 32767)));
    const sign = s < 0 ? 0x80 : 0;
    if (sign) s = -s;
    s += 0x84;
    let exp = 7;
    for (let m = 0x4000; (s & m) === 0 && exp > 0; m >>= 1) exp--;
    const mant = (s >> (exp + 3)) & 0x0f;
    out[i] = ~(sign | (exp << 4) | mant) & 0xff;
  }
  return out;
}
/** Piper : texte sur l'entrée, PCM 16 bits brut à la fréquence du modèle sur la sortie */
function piperSynth(id, words, speed) {
  const [name, who] = String(id).split('@');
  const model = path.join(TTS_DIR, 'voices', name + '.onnx');
  let rate = 22050, spk = null;
  try {
    const j = JSON.parse(fs.readFileSync(model + '.json', 'utf8'));
    rate = Number(j.audio && j.audio.sample_rate) || 22050;
    if (who && j.speaker_id_map && j.speaker_id_map[who] != null) spk = Number(j.speaker_id_map[who]);
  } catch (e) { return Promise.reject(new Error('voix ' + name + ' absente (deploy/install-voix.sh)')); }
  const ls = Math.max(0.45, Math.min(1.8, 170 / speed)); // vitesse : length_scale (1 = débit normal)
  return new Promise((resolve, reject) => {
    const dir = path.dirname(PIPER);
    const args = ['--model', model, '--output_raw', '--length_scale', ls.toFixed(2), '--sentence_silence', '0.15', '--espeak_data', path.join(dir, 'espeak-ng-data')];
    if (spk != null && Number.isFinite(spk)) args.push('--speaker', String(spk));
    const p = spawn(PIPER, args,
      { env: Object.assign({}, process.env, { LD_LIBRARY_PATH: dir }), stdio: ['pipe', 'pipe', 'pipe'] });
    const parts = [];
    let n = 0, errTxt = '';
    const kill = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('Piper trop lent (plus de 30 s)')); }, 30000);
    p.stdout.on('data', (c) => { n += c.length; if (n < 64 * 1024 * 1024) parts.push(c); });
    p.stderr.on('data', (c) => { if (errTxt.length < 2000) errTxt += c; });
    p.on('error', (e) => { clearTimeout(kill); reject(new Error(e.code === 'ENOENT' ? 'Piper absent du serveur (deploy/install-voix.sh)' : 'Piper : ' + e.message)); });
    p.on('close', (code) => {
      clearTimeout(kill);
      const buf = Buffer.concat(parts);
      if (code !== 0 || buf.length < 100) return reject(new Error('Piper : ' + (errTxt.split('\n').filter(Boolean).pop() || 'code ' + code).slice(0, 160)));
      const pcm = new Float32Array(Math.floor(buf.length / 2));
      for (let i = 0; i < pcm.length; i++) pcm[i] = buf.readInt16LE(i * 2) / 32768;
      resolve({ pcm, rate });
    });
    p.stdin.end(words + '\n');
  });
}
/** Message → µ-law 12 kHz ; opt : { voice ('en-us+f2'… espeak-ng, ou 'piper:<nom>'), speed (mots / minute), gap (ms) } */
function synth(text, call, opt) {
  const kv = /^kokoro:([a-z]{2}_[a-z]+)$/.exec(String((opt && opt.voice) || ''));
  if (kv) {
    if (!KOKORO_VOICES.some((x) => x[0] === kv[1])) return Promise.reject(new Error('voix Kokoro inconnue'));
    const gap = Math.max(0, Math.min(400, Math.round(Number(opt && opt.gap != null ? opt.gap : 70))));
    const words = applyPron(expand(clean(text), call, gap, isFr(opt.voice), 'k'), isFr(opt.voice), opt.pron);
    if (!words) return Promise.reject(new Error('message vide'));
    const speed = Math.max(80, Math.min(350, Math.round(Number(opt && opt.speed) || 170)));
    return kokoroSynth(kv[1], words, speed).then((w) => ({ data: ulaw(to12k(w.pcm, w.rate)), words }));
  }
  const pv = /^piper:([A-Za-z0-9_-]+(?:@[A-Za-z0-9_-]+)?)$/.exec(String((opt && opt.voice) || ''));
  if (pv) {
    const gap = Math.max(0, Math.min(400, Math.round(Number(opt && opt.gap != null ? opt.gap : 70))));
    const words = applyPron(expand(clean(text), call, gap, isFr(opt.voice), true), isFr(opt.voice), opt.pron);
    if (!words) return Promise.reject(new Error('message vide'));
    const speed = Math.max(80, Math.min(350, Math.round(Number(opt && opt.speed) || 170)));
    return piperSynth(pv[1], words, speed).then((w) => ({ data: ulaw(to12k(w.pcm, w.rate)), words }));
  }
  const gap = Math.max(0, Math.min(400, Math.round(Number(opt && opt.gap != null ? opt.gap : 70))));
  const words = applyPron(expand(clean(text), call, gap, isFr(opt && opt.voice)), isFr(opt && opt.voice), opt && opt.pron);
  if (!words) return Promise.reject(new Error('message vide'));
  const voice = VOICES[(opt && opt.voice) || 'en-us'] || 'en-us';
  const speed = Math.max(80, Math.min(350, Math.round(Number(opt && opt.speed) || 160))); // mots / minute (espeak-ng)
  return new Promise((resolve, reject) => {
    execFile(CMD, ['-v', voice, '-s', String(speed), '-g', '2', '-m', '--stdout', '<speak>' + words + '</speak>'], { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024, timeout: 20000 }, (err, out) => {
      if (err) return reject(err.code === 'ENOENT' ? new Error('espeak-ng absent du serveur (sudo apt install espeak-ng)') : new Error('espeak-ng : ' + String(err.message || err).slice(0, 160)));
      try { const w = parseWav(out); resolve({ data: ulaw(to12k(w.pcm, w.rate)), words }); } catch (e) { reject(e); }
    });
  });
}
module.exports = { synth, spellCall, expand, applyPron, VOICES, piperVoices, kokoroVoices, kokoroWarm, kokoroSynthOnce, PRON };
