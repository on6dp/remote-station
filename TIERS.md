# Composants et sources de tiers

## RigPlane Core

Les formats des commandes CAT du Yaesu FTX-1 utilisés dans `public/js/yaesu.js` et `public/js/ftx1.js` (réglages, filtres, mesures, tables de largeur de filtre, étalonnages indicatifs du S-mètre et du SWR) ont été repris du profil `rigs/ftx1.toml` de RigPlane Core, vérifié sur une radio réelle.

La liste des commandes CI-V de l'Icom IC-7300 utilisées dans `public/js/ic7300.js` (codes de commande et sous-commandes, valeurs d'atténuateur, préampli, AGC et filtres, vitesse par défaut) s'appuie sur le profil `rigs/ic7300.toml` de RigPlane Core.

Le design de la page opérateur (`public/index.html`, `public/css/rp.css`) reprend la disposition « bureau » de l'interface web de RigPlane Core, et `public/css/rp-tokens.css` est une copie de ses jetons de design (`frontend/src/components-v2/theme/tokens.css`). Le nom et le logo « RigPlane » ne sont pas utilisés.

- Projet : https://github.com/rigplane/rigplane-core
- Licence : MIT

```
MIT License

Copyright (c) 2026 Sergey Morozik (KN4KYD)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Police Roboto Mono

`public/fonts/roboto-mono-*.woff2`, repris des fichiers embarqués par RigPlane Core (issus de Google Fonts).
Licence : SIL Open Font License 1.1 — voir `public/fonts/LICENSES.md`.
