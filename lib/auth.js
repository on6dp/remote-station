'use strict';
/* Gestion des comptes : mots de passe hachés avec scrypt (module crypto natif). */
const crypto = require('crypto');
const fs = require('fs');

const CALL_RE = /^[A-Z0-9]{1,3}[0-9][A-Z0-9]{0,4}(\/[A-Z0-9]{1,4})?$/;

function normCall(c) {
  return String(c || '').trim().toUpperCase();
}

function validCall(c) {
  return CALL_RE.test(c);
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

module.exports = { normCall, validCall, hashPassword, verifyPassword, loadUsers, saveUsers, safeEqual };
