'use strict';
/*
 * Création des comptes en une fois, à partir d'une liste d'indicatifs (un par ligne).
 *
 *   node importusers.js membres.txt              crée les comptes manquants
 *   node importusers.js membres.txt --reset      recrée aussi les comptes existants (nouveau mot de passe)
 *
 * Chaque nouveau compte reçoit un mot de passe aléatoire. Le résultat est écrit dans
 * comptes-AAAA-MM-JJ.csv (indicatif ; mot de passe ; droits), lisible uniquement par son propriétaire.
 * Ce fichier sert à remettre les mots de passe aux membres : supprimez-le ensuite.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const auth = require('./lib/auth');

const cfgPath = process.env.RS_CONFIG || path.join(__dirname, 'config.json');
const cfg = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, 'utf8')) : {};
const USERS = path.resolve(__dirname, cfg.usersFile || 'users.json');
const PREFIXES = cfg.allowedPrefixes || auth.BE_PREFIXES;
const POWER_RULES = cfg.powerRules || [{ prefix: 'ON3', maxWatts: 25 }];
const DEFAULT_W = cfg.defaultMaxWatts || 1500;

// Mot de passe lisible : 10 caractères sans caractères ambigus (pas de 0/O, 1/I/L), ex. "K7QPM-H3XWA"
function randomPassword() {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const b = crypto.randomBytes(10);
  let s = '';
  for (let i = 0; i < 10; i++) s += A[b[i] % A.length] + (i === 4 ? '-' : '');
  return s;
}

(async () => {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  const reset = args.includes('--reset');
  if (!file) {
    console.log('Usage : node importusers.js membres.txt [--reset]');
    process.exit(1);
  }
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const users = auth.loadUsers(USERS);
  const created = [];
  const skipped = [];
  const invalid = [];
  const seen = new Set();

  for (const line of lines) {
    const call = auth.normCall(line.split(/[;,\t ]/)[0]);
    if (!call || call === 'CALL' || call === 'INDICATIF' || seen.has(call)) continue;
    seen.add(call);
    if (!auth.validCall(call, PREFIXES)) { invalid.push(call); continue; }
    if (users[call] && !reset) { skipped.push(call); continue; }
    const pass = randomPassword();
    const rxOnly = auth.isRxOnly(call, cfg.rxOnlyPrefixes);
    const rec = await auth.hashPassword(pass);
    rec.admin = users[call] ? !!users[call].admin : false; // un admin existant le reste
    rec.tx = !rxOnly;
    users[call] = rec;
    const rule = POWER_RULES.find((r) => call.startsWith(String(r.prefix).toUpperCase()));
    const rights = rxOnly ? 'Écoute seule (écouteur)' : 'Émission, ' + (rule ? rule.maxWatts : DEFAULT_W) + ' W max';
    created.push([call, pass, rights]);
  }

  if (created.length) {
    auth.saveUsers(USERS, users);
    const out = path.resolve('comptes-' + new Date().toISOString().slice(0, 10) + '.csv');
    const csv = '﻿Indicatif;Mot de passe;Droits\n' + created.map((r) => r.join(';')).join('\n') + '\n';
    fs.writeFileSync(out, csv, { mode: 0o600 });
    console.log(created.length + ' compte(s) créé(s). Mots de passe dans : ' + out);
    console.log('→ Récupérez ce fichier, remettez à chaque membre son mot de passe, puis supprimez-le.');
  } else {
    console.log('Aucun compte créé.');
  }
  const tx = created.filter((r) => !/Écoute/.test(r[2])).length;
  if (created.length) console.log('   dont ' + tx + ' avec émission et ' + (created.length - tx) + ' écouteur(s) en écoute seule.');
  if (skipped.length) console.log(skipped.length + ' déjà existant(s), inchangé(s) : ' + skipped.join(', ') + (reset ? '' : ' (option --reset pour les recréer)'));
  if (invalid.length) console.log(invalid.length + ' indicatif(s) refusé(s) : ' + invalid.join(', '));
})();
