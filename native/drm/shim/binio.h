// binio.h — entrée et sortie standard en binaire (Windows : sinon \n devient \r\n et 0x1A coupe la lecture)
#pragma once
#ifdef _WIN32
#include <io.h>
#include <fcntl.h>
#include <cstdio>
static inline void binaryStdio() { _setmode(_fileno(stdin), _O_BINARY); _setmode(_fileno(stdout), _O_BINARY); }
#else
static inline void binaryStdio() {}
#endif
