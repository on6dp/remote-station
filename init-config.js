'use strict';
/* Crée config.json à partir de config.example.json, avec un jeton de station aléatoire. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dst = path.join(__dirname, 'config.json');
if (fs.existsSync(dst)) {
  console.log('config.json existe déjà, rien n’a été modifié.');
  process.exit(0);
}
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.example.json'), 'utf8'));
cfg.stationToken = crypto.randomBytes(24).toString('base64url');
fs.writeFileSync(dst, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
console.log('config.json créé.');
console.log('Jeton de la station (à saisir une seule fois sur la page /station du PC du club) :');
console.log('  ' + cfg.stationToken);
