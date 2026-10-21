'use strict';
/*
 * windows-setup.js — lancé par l'installateur Windows (copié dans le dossier du serveur).
 *   node windows-setup.js [--reseau]
 * Crée config.json la première fois (jeton de station aléatoire) ; à chaque installation, règle l'adresse
 * d'écoute : 127.0.0.1 (ce PC seulement) ou 0.0.0.0 avec --reseau (accès depuis le réseau, port 9000).
 * Les comptes, les macros, les images SSTV et les autres réglages existants ne sont jamais modifiés.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dir = __dirname;
const dst = path.join(dir, 'config.json');
let cfg;
let created = false;
if (fs.existsSync(dst)) cfg = JSON.parse(fs.readFileSync(dst, 'utf8'));
else {
  cfg = JSON.parse(fs.readFileSync(path.join(dir, 'config.example.json'), 'utf8'));
  cfg.stationToken = crypto.randomBytes(24).toString('base64url');
  created = true;
}
cfg.listen = process.argv.includes('--reseau') ? '0.0.0.0' : '127.0.0.1';
if (!cfg.port) cfg.port = 9000;
fs.writeFileSync(dst, JSON.stringify(cfg, null, 2) + '\n');
fs.mkdirSync(path.join(dir, cfg.logDir || 'logs'), { recursive: true });
console.log((created ? 'config.json créé' : 'config.json mis à jour') + ' : écoute ' + cfg.listen + ':' + cfg.port);
