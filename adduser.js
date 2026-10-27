'use strict';
/*
 * Gestion des membres autorisés.
 *   node adduser.js ON4ABC            ajoute / modifie un membre (mot de passe demandé)
 *   node adduser.js ON4ABC --admin    idem, avec droits administrateur (reprise de la main)
 *   node adduser.js ON4ABC --no-tx    écoute et réglages seulement, pas d'émission
 *   node adduser.js --del ON4ABC      supprime un membre
 *   node adduser.js --disable ON4ABC  désactive un membre (affiliation non renouvelée) : compte, QSO et statistiques gardés
 *   node adduser.js --enable ON4ABC   le réactive
 *   node adduser.js --until ON4ABC 2027-03-31   accès jusqu'à cette date incluse (fin d'affiliation) ; sans date : sans limite
 *   node adduser.js --until-all 2027-03-31        même date pour tous les membres sauf les administrateurs (sans date : sans limite)
 *   node adduser.js --list            liste les membres
 */
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const auth = require('./lib/auth');

const cfgPath = process.env.RS_CONFIG || path.join(__dirname, 'config.json');
const cfg = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, 'utf8')) : {};
const USERS = path.resolve(__dirname, cfg.usersFile || 'users.json');

function askHidden(q) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => {
      if (s.startsWith(q)) rl.output.write(q);
      else if (s.includes('\n') || s.includes('\r')) rl.output.write('\n');
      else rl.output.write('*');
    };
    rl.question(q, (a) => {
      rl.close();
      resolve(a);
    });
  });
}

(async () => {
  const args = process.argv.slice(2);
  const users = auth.loadUsers(USERS);

  if (args[0] === '--list' || args.length === 0) {
    const calls = Object.keys(users).sort();
    if (!calls.length) console.log('Aucun membre. Usage : node adduser.js INDICATIF [--admin] [--no-tx]');
    for (const c of calls) {
      const u = users[c];
      const off = auth.userOff(u);
      console.log(c.padEnd(12) + (u.admin ? 'admin  ' : '       ') + (u.tx === false ? 'écoute seule' : 'TX autorisé ') +
        (off ? '  ** ' + off.toUpperCase() + ' **' : u.until ? '  (jusqu’au ' + u.until.split('-').reverse().join('/') + ')' : ''));
    }
    return;
  }
  if (args[0] === '--disable' || args[0] === '--enable') {
    const c = auth.normCall(args[1]);
    if (!users[c]) return console.log(c + ' n’existe pas.');
    if (args[0] === '--disable') users[c].disabled = true; else delete users[c].disabled;
    auth.saveUsers(USERS, users);
    return console.log(c + (args[0] === '--disable' ? ' désactivé : il ne peut plus se connecter (session ouverte fermée dans la minute). Compte, QSO et statistiques gardés ; « --enable » le réactive.' : ' réactivé.') +
      (args[0] === '--enable' && auth.userOff(users[c]) ? ' Attention : ' + auth.userOff(users[c]) + ' (changez la date avec --until).' : ''));
  }
  if (args[0] === '--until-all') {
    const d = String(args[1] || '');
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) return console.log('Date au format AAAA-MM-JJ, par exemple 2027-03-31');
    let n = 0;
    for (const c of Object.keys(users)) { if (users[c].admin) continue; if (d) users[c].until = d; else delete users[c].until; n++; }
    auth.saveUsers(USERS, users);
    return console.log(n + ' membres (administrateurs non compris) : ' + (d ? 'accès jusqu’au ' + d.split('-').reverse().join('/') + ' inclus.' : 'accès sans date de fin.'));
  }
  if (args[0] === '--until') {
    const c = auth.normCall(args[1]);
    if (!users[c]) return console.log(c + ' n’existe pas.');
    const d = String(args[2] || '');
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) return console.log('Date au format AAAA-MM-JJ, par exemple 2027-03-31');
    if (d) users[c].until = d; else delete users[c].until;
    auth.saveUsers(USERS, users);
    return console.log(c + (d ? ' : accès jusqu’au ' + d.split('-').reverse().join('/') + ' inclus.' : ' : accès sans date de fin.'));
  }
  if (args[0] === '--del') {
    const c = auth.normCall(args[1]);
    if (!users[c]) return console.log(c + ' n’existe pas.');
    delete users[c];
    auth.saveUsers(USERS, users);
    return console.log(c + ' supprimé.');
  }

  const call = auth.normCall(args[0]);
  const prefixes = cfg.allowedPrefixes || auth.BE_PREFIXES;
  if (!auth.validCall(call, prefixes)) {
    console.error('Indicatif refusé : ' + call + ' (préfixes autorisés : ' + prefixes.join(', ') + ')');
    process.exit(1);
  }
  const p1 = await askHidden('Mot de passe pour ' + call + ' : ');
  if (p1.length < 8) {
    console.error('8 caractères minimum.');
    process.exit(1);
  }
  const p2 = await askHidden('Confirmez : ');
  if (p1 !== p2) {
    console.error('Les mots de passe ne correspondent pas.');
    process.exit(1);
  }
  const rec = await auth.hashPassword(p1);
  const rxOnly = auth.isRxOnly(call, cfg.rxOnlyPrefixes);
  rec.admin = args.includes('--admin');
  rec.tx = !args.includes('--no-tx') && !rxOnly;
  // Nouveau mot de passe d'un compte existant : sa date de fin d'affiliation est gardée (pas son blocage éventuel)
  if (users[call] && users[call].until) rec.until = users[call].until;
  users[call] = rec;
  auth.saveUsers(USERS, users);
  const rule = (cfg.powerRules || [{ prefix: 'ON2', maxWatts: 100 }, { prefix: 'ON3', maxWatts: 25 }]).find((r) => call.startsWith(String(r.prefix).toUpperCase()));
  const watts = rule ? rule.maxWatts : (cfg.defaultMaxWatts || 1500);
  console.log(call + ' enregistré' + (rec.admin ? ' (admin)' : '') + (rec.tx ? ', puissance max ' + watts + ' W' : rxOnly ? ' (écouteur : écoute seule)' : ' (écoute seule)') + '.');
})();
