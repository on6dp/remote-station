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
const isFr = (voice) => /^(piper:)?fr/.test(String(voice || ''));

// Voix naturelles Piper (deploy/install-voix.sh) : <programme>/tts/piper/piper et tts/voices/<nom>.onnx (+ .onnx.json)
const TTS_DIR = process.env.RS_TTS_DIR || path.join(__dirname, '..', 'tts');
const PIPER = process.env.RS_PIPER_CMD || path.join(TTS_DIR, 'piper', 'piper');
const PIPER_NAMES = {
  'en-us-kathleen-low': 'Kathleen · femme US', 'en-us-amy-low': 'Amy · femme US', 'en-us-lessac-medium': 'Lessac · femme US',
  'en-gb-southern_english_female-low': 'Femme GB', 'en-us-ryan-medium': 'Ryan · homme US', 'en-gb-alan-low': 'Alan · homme GB',
  'fr-siwis-medium': 'Siwis · femme', 'fr-siwis-low': 'Siwis · femme', 'fr-gilles-low': 'Gilles · homme', 'fr-mls_1840-low': 'Homme'
};
/** Voix Piper installées : [{ id: 'piper:fr-siwis-medium', name, lang }] */
function piperVoices() {
  let list = [];
  try { if (!fs.existsSync(PIPER)) return []; list = fs.readdirSync(path.join(TTS_DIR, 'voices')); } catch (e) { return []; }
  return list.filter((f) => /^[a-z0-9_-]+\.onnx$/.test(f) && list.indexOf(f + '.json') >= 0).map((f) => f.slice(0, -5))
    .map((n) => ({ id: 'piper:' + n, name: PIPER_NAMES[n] || n, lang: /^fr/.test(n) ? 'fr' : 'en' }));
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
  if (plain) return gap >= 40 ? out.join(', ') : out.join(' ');
  return gap > 0 ? out.join(' <break time="' + Math.round(gap) + 'ms"/> ') : out.join(' ');
}
/** Texte du message : {CALL} épelé, abréviations lettre par lettre, nombres radioamateur */
function expand(text, call, gap, fr, plain) {
  let t = String(text || '').replace(/\{CALL\}/gi, ' ' + spellCall(call, gap, fr, plain) + ' ');
  t = t.replace(/\b(CQ|QRZ|QRL|QSO|QSL|QTH|QRP|DX|TU)\b/g, (m) => (m === 'TU' ? (fr ? 'merci' : 'thank you') : m.split('').join(' ')));
  t = fr ? t.replace(/\b73\b/g, 'soixante-treize').replace(/\b59\b/g, 'cinq neuf').replace(/\b5NN\b/gi, 'cinq neuf')
    : t.replace(/\b73\b/g, 'seventy three').replace(/\b59\b/g, 'five nine').replace(/\b5NN\b/gi, 'five nine');
  return t.replace(/\s+/g, ' ').trim();
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
  const ratio = rate / RATE;
  const n = Math.floor(pcm.length / ratio);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = i * ratio, b = a + ratio;
    let s = 0, k = 0;
    for (let j = Math.floor(a); j < Math.min(pcm.length, Math.ceil(b)); j++) { s += pcm[j]; k++; }
    out[i] = k ? s / k : 0;
  }
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  const g = peak > 0.001 ? 0.89 / peak : 1;
  const pad = Math.round(RATE * 0.15);
  const res = new Float32Array(n + 2 * pad);
  for (let i = 0; i < n; i++) res[pad + i] = out[i] * g;
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
function piperSynth(name, words, speed) {
  const model = path.join(TTS_DIR, 'voices', name + '.onnx');
  let rate = 22050;
  try { rate = Number(JSON.parse(fs.readFileSync(model + '.json', 'utf8')).audio.sample_rate) || 22050; } catch (e) { return Promise.reject(new Error('voix ' + name + ' absente (deploy/install-voix.sh)')); }
  const ls = Math.max(0.45, Math.min(1.8, 170 / speed)); // vitesse : length_scale (1 = débit normal)
  return new Promise((resolve, reject) => {
    const dir = path.dirname(PIPER);
    const p = spawn(PIPER, ['--model', model, '--output_raw', '--length_scale', ls.toFixed(2), '--sentence_silence', '0.15', '--espeak_data', path.join(dir, 'espeak-ng-data')],
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
  const pv = /^piper:([a-z0-9_-]+)$/.exec(String((opt && opt.voice) || ''));
  if (pv) {
    const gap = Math.max(0, Math.min(400, Math.round(Number(opt && opt.gap != null ? opt.gap : 70))));
    const words = expand(clean(text), call, gap, isFr(opt.voice), true);
    if (!words) return Promise.reject(new Error('message vide'));
    const speed = Math.max(80, Math.min(350, Math.round(Number(opt && opt.speed) || 170)));
    return piperSynth(pv[1], words, speed).then((w) => ({ data: ulaw(to12k(w.pcm, w.rate)), words }));
  }
  const gap = Math.max(0, Math.min(400, Math.round(Number(opt && opt.gap != null ? opt.gap : 70))));
  const words = expand(clean(text), call, gap, isFr(opt && opt.voice));
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
module.exports = { synth, spellCall, expand, VOICES, piperVoices };
