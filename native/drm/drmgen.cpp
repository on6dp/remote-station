/*
 * drmgen.cpp — émetteur HamDRM (images / fichiers) de Remote Station, construit sur le cœur DRM de QSSTV
 * (Dream / PA0MBO / ON4QZ, GPL). Lit un fichier, écrit le signal audio sur la sortie standard :
 * entiers 16 bits signés, mono, 12 000 Hz (le signal DRM de QSSTV est fabriqué à 48 kHz puis décimé par 4).
 *
 *   drmgen <fichier> <nom> <format> <mode A=0 B=1 E=2> <bande 2,3k=0 2,5k=1> <entrelacement long=0 court=1>
 *          <qam 4=0 16=1 64=2> <protection haute=0 normale=1> <indicatif>
 */
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>
#include <cmath>
#include "common/GlobalDefinitions.h"
#include "common/CDrmTransmitter.h"
#include "csoundout.h"
#include "drmparams.h"

int numTxFrames;
bool stopDRM;
uint txTransportID;
QList<short unsigned int> fixBlockList;

// ---- sortie son : voie gauche (partie réelle), 48 kHz → 12 kHz
static std::vector<float> fir;
static std::vector<float> hist;
static long phase48 = 0;
static long written = 0;
static void out48(float x)
{
  hist.push_back(x);
  if (hist.size() > fir.size()) hist.erase(hist.begin(), hist.begin() + (hist.size() - fir.size()));
  if ((phase48++ & 3) || hist.size() < fir.size()) return;
  double y = 0;
  for (size_t i = 0; i < fir.size(); i++) y += fir[i] * hist[hist.size() - 1 - i];
  int v = (int)lrint(y);
  if (v > 32767) v = 32767;
  if (v < -32768) v = -32768;
  short s = (short)v;
  fwrite(&s, 2, 1, stdout);
  written++;
}
CSoundOut::CSoundOut() {}
CSoundOut::~CSoundOut() {}
bool CSoundOut::Write(CVector<_SAMPLE> &psData)
{
  for (int i = 0; i + 1 < psData.Size(); i += 2) out48((float)psData[i]);
  return false;
}

int main(int argc, char **argv)
{
  if (argc < 10) { fprintf(stderr, "usage : drmgen fichier nom format mode bande entrelacement qam protection indicatif\n"); return 2; }
  FILE *f = fopen(argv[1], "rb");
  if (!f) { fprintf(stderr, "fichier introuvable\n"); return 2; }
  QByteArray ba;
  { char buf[65536]; size_t n; while ((n = fread(buf, 1, sizeof buf, f)) > 0) ba.append(buf, (int)n); fclose(f); }
  // passe-bas 5 kHz à 48 kHz (fenêtre de Hamming, 97 coefficients) avant la décimation par 4
  const int N = 97;
  fir.resize(N);
  double sum = 0;
  for (int i = 0; i < N; i++) {
    double m = i - (N - 1) / 2.0, fc = 5000.0 / 48000.0;
    double h = m == 0 ? 2 * fc : sin(2 * M_PI * fc * m) / (M_PI * m);
    h *= 0.54 - 0.46 * cos(2 * M_PI * i / (N - 1));
    fir[i] = (float)h; sum += h;
  }
  for (auto &h : fir) h /= sum;

  drmTxParams params;
  params.robMode = atoi(argv[4]);
  params.bandwith = atoi(argv[5]);
  params.interleaver = atoi(argv[6]);
  params.qam = atoi(argv[7]);
  params.protection = atoi(argv[8]);
  params.callsign = argv[9];
  params.reedSolomon = 0;

  // même réglage que drmTransmitter::init de QSSTV
  CDRMTransmitter *tx = new CDRMTransmitter;
  ERobMode RobMod = params.robMode == 0 ? RM_ROBUSTNESS_MODE_A : params.robMode == 1 ? RM_ROBUSTNESS_MODE_B : RM_ROBUSTNESS_MODE_E;
  ESpecOcc BW = params.bandwith == 0 ? SO_0 : SO_1;
  CService Service;
  tx->init_base();
  tx->GetAudSrcEnc()->ClearPicFileNames();
  CParameter *TransmParam = tx->GetParameters();
  tx->GetAudSrcEnc()->SetPicFileName(&ba, QString(argv[2]), QString(argv[3]));
  TransmParam->InitCellMapTable(RobMod, BW);
  TransmParam->SetInterleaverDepth(params.interleaver == 0 ? CParameter::SI_LONG : CParameter::SI_SHORT);
  TransmParam->SetMSCCodingScheme(params.qam == 0 ? CS_1_SM : params.qam == 1 ? CS_2_SM : CS_3_SM);
  CMSCProtLev prot;
  prot.iPartA = 0; prot.iHierarch = 0;
  prot.iPartB = params.protection == 1 ? 1 : 0;
  TransmParam->SetMSCProtLev(prot, false);
  Service.iServiceDescr = 0;
  Service.iServiceID = 0;
  Service.iLanguage = 5;
  Service.strLabel = params.callsign.toLatin1().data();
  TransmParam->SetServiceParameters(0, Service);
  tx->Init();
  fprintf(stderr, "{\"frames\":%d,\"seconds\":%.1f}\n", numTxFrames, numTxFrames * 0.4);
  stopDRM = false;
  tx->Start();
  for (int i = 0; i < (int)fir.size(); i++) out48(0); // vide le filtre
  fflush(stdout);
  fprintf(stderr, "{\"samples\":%ld}\n", written);
  return 0;
}
