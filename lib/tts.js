'use strict';
/*
 * tts.js — messages vocaux en anglais ou en français pour les mémoires T1 à T8 (page TRX SSB), fabriqués sur le serveur par
 * espeak-ng (paquet Debian / Ubuntu « espeak-ng »). L'indicatif est épelé en alphabet phonétique (ON6DP →
 * « Oscar November Six Delta Papa »), les abréviations radioamateur sont dites lettre par lettre (C Q, Q R Z…).
 * Sortie : µ-law 12 kHz, comme les mémoires enregistrées au micro (voicemem/<INDICATIF>-T<n>.ul).
 */
const { execFile } = require('child_process');

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
const isFr = (voice) => /^fr/.test(String(voice || ''));

/** Indicatif en alphabet phonétique : « ON6DP/P » → « Oscar November Six Delta Papa portable » */
function spellCall(call, gap, fr) {
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
  return gap > 0 ? out.join(' <break time="' + Math.round(gap) + 'ms"/> ') : out.join(' ');
}
/** Texte du message : {CALL} épelé, abréviations lettre par lettre, nombres radioamateur */
function expand(text, call, gap, fr) {
  let t = String(text || '').replace(/\{CALL\}/gi, ' ' + spellCall(call, gap, fr) + ' ');
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
/** Message → µ-law 12 kHz ; opt : { voice, speed (mots / minute) } */
function synth(text, call, opt) {
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
module.exports = { synth, spellCall, expand, VOICES };
