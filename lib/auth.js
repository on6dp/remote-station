'use strict';
/* Gestion des comptes : mots de passe hachés avec scrypt (module crypto natif). */
const crypto = require('crypto');
const fs = require('fs');

// Préfixes belges autorisés par défaut (modifiable via "allowedPrefixes" dans config.json)
const BE_PREFIXES = ['ON', 'OO', 'OP', 'OQ', 'OR', 'OS', 'OT'];
// préfixe + chiffre(s) + suffixe commençant par une lettre : ON6DP, OP0P, OR0L, ON3ABC, OT4A…
const CALL_RE = /^([A-Z]{2})[0-9]{1,4}[A-Z][A-Z0-9]{0,3}$/;
// indicatif d'écouteur (SWL) : préfixe + L + numéro, ex. ONL12345
const LISTENER_RE = /^(ON)L[0-9]{1,6}$/;
// Préfixes en écoute seule par défaut (modifiable via "rxOnlyPrefixes" dans config.json)
const RX_ONLY_PREFIXES = ['ONL'];

function normCall(c) {
  return String(c || '').trim().toUpperCase();
}

function validCall(c, prefixes) {
  const m = CALL_RE.exec(c) || LISTENER_RE.exec(c);
  return !!m && (prefixes || BE_PREFIXES).indexOf(m[1]) >= 0;
}

/** Vrai si l'indicatif ne peut jamais émettre (ex. ONL, écouteurs). */
function isRxOnly(c, rxPrefixes) {
  return (rxPrefixes || RX_ONLY_PREFIXES).some((p) => c.startsWith(String(p).toUpperCase()));
}

function hashPassword(pass) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(String(pass), salt, 64, (err, key) => {
      if (err) return reject(err);
      resolve({ salt: salt.toString('hex'), hash: key.toString('hex') });
    });
  });
}

function verifyPassword(pass, rec) {
  return new Promise((resolve) => {
    if (!rec || !rec.salt || !rec.hash) return resolve(false);
    crypto.scrypt(String(pass), Buffer.from(rec.salt, 'hex'), 64, (err, key) => {
      if (err) return resolve(false);
      const ref = Buffer.from(rec.hash, 'hex');
      resolve(ref.length === key.length && crypto.timingSafeEqual(ref, key));
    });
  });
}

function loadUsers(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw e;
  }
}

function saveUsers(file, users) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(users, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/** Compare deux secrets en temps constant, quelle que soit leur longueur. */
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

module.exports = { BE_PREFIXES, RX_ONLY_PREFIXES, normCall, validCall, isRxOnly, hashPassword, verifyPassword, loadUsers, saveUsers, safeEqual };
