/*
 * drmrs.cpp — codage Reed-Solomon des fichiers HamDRM (.rs1 à .rs4, compatible EasyPal / QSSTV), d'après le
 * reedSolomonCoder de QSSTV (PA0MBO / ON4QZ, GPL). Données sur l'entrée standard, résultat sur la sortie standard.
 *   drmrs enc <1..4> <extension d'origine>          → fichier codé (à émettre sous le nom « nom.rsN »)
 *   drmrs dec <1..4> <segments> <taille> [manquants séparés par des virgules] → fichier d'origine ;
 *        l'extension d'origine est écrite sur la sortie d'erreur ({"ext":"jp2"})
 */
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include "reedsolomoncoder.h"
#include "binio.h"
QString rxDRMImagesPath = "";
int main(int argc, char **argv)
{
  binaryStdio();
  if (argc < 4) { fprintf(stderr, "usage : drmrs enc N ext | drmrs dec N segments taille [manquants]\n"); return 2; }
  QByteArray ba;
  { char buf[65536]; size_t n; while ((n = fread(buf, 1, sizeof buf, stdin)) > 0) ba.append(buf, (int)n); }
  int t = atoi(argv[2]);
  if (t < 1 || t > 4) return 2;
  reedSolomonCoder rs;
  if (!strcmp(argv[1], "enc")) {
    if (!rs.encode(ba, QString(argv[3]), (eRSType)t)) return 1;
    fwrite(ba.data(), 1, ba.size(), stdout);
    return 0;
  }
  if (argc < 5) return 2;
  QList<int> er;
  er.append(atoi(argv[3]));
  er.append(atoi(argv[4]));
  if (argc > 5 && argv[5][0]) { std::string m = argv[5]; size_t p = 0; while (p < m.size()) { size_t q = m.find(',', p); if (q == std::string::npos) q = m.size(); if (q > p) er.append(atoi(m.substr(p, q - p).c_str())); p = q + 1; } }
  QString nf;
  QByteArray out;
  char ext[8];
  snprintf(ext, sizeof ext, "rs%d", t);
  if (!rs.decode(ba, QString("rx.") + QString(ext), nf, out, QString(ext), er)) { fprintf(stderr, "{\"ok\":0}\n"); return 1; }
  QFileInfo fi(nf);
  fprintf(stderr, "{\"ok\":1,\"ext\":\"%s\"}\n", fi.suffix().s.c_str());
  fwrite(out.data(), 1, out.size(), stdout);
  return 0;
}
