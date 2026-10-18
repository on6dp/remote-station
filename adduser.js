'use strict';
/*
 * Gestion des membres autorisés.
 *   node adduser.js ON4ABC            ajoute / modifie un membre (mot de passe demandé)
 *   node adduser.js ON4ABC --admin    idem, avec droits administrateur (reprise de la main)
 *   node adduser.js ON4ABC --no-tx    écoute et réglages seulement, pas d'émission
 *   node adduser.js --del ON4ABC      supprime un membre
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
      console.log(c.padEnd(12) + (u.admin ? 'admin  ' : '       ') + (u.tx === false ? 'écoute seule' : 'TX autorisé') + (u.disabled ? '  (désactivé)' : ''));
    }
    return;
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
  rec.admin = args.includes('--admin');
  rec.tx = !args.includes('--no-tx');
  users[call] = rec;
  auth.saveUsers(USERS, users);
  const rule = (cfg.powerRules || [{ prefix: 'ON3', maxWatts: 25 }]).find((r) => call.startsWith(String(r.prefix).toUpperCase()));
  const watts = rule ? rule.maxWatts : (cfg.defaultMaxWatts || 1500);
  console.log(call + ' enregistré' + (rec.admin ? ' (admin)' : '') + (rec.tx ? ', puissance max ' + watts + ' W' : ' (écoute seule)') + '.');
})();
