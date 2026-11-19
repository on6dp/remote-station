// sourcedecoder.h (Remote Station) : remplace le décodeur de fichiers de QSSTV ; les paquets MSC reçus (CRC vérifié)
// sont écrits sur la sortie standard et reconstitués en fichier par le serveur (lib/hamdrm-mot.js)
#ifndef SOURCEDECODER_H
#define SOURCEDECODER_H
#include "qtshim.h"
class sourceDecoder {
public:
  void init() {}
  bool decode();
};
#endif
