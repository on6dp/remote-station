/*
 * drmd.cpp — récepteur HamDRM de Remote Station, construit sur le démodulateur et le décodeur de canal de QSSTV
 * (RXAMADRM de PA0MBO, adapté par ON4QZ, GPL). Lit la BF sur l'entrée standard (entiers 16 bits signés, mono,
 * 12 000 Hz) et écrit une ligne JSON par événement sur la sortie standard :
 *   {"t":"st", …}  état (synchro, mode, QAM, SNR, indicatif, constellation) à chaque trame de 400 ms environ
 *   {"t":"pkt","ok":1,"hex":"…"}  paquet de données MSC reçu (CRC 16 bon)
 */
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cmath>
#include <vector>
#include <string>
#include <unistd.h>
#include "drm.h"
#include "drmproto.h"
#include "demodulator.h"
#include "sourcedecoder.h"

extern int lMSC;
extern float MSC_cells_sequence[2 * 2959];
extern int msc_mode_new, interleaver_depth_new, spectrum_occupancy_new;
extern int fac_valid;
extern void crc16_bytewise(double *, unsigned char *, long);
extern void bits2bytes(double *, int, unsigned char *);

TAPS


static const double HILB_GAIN = 1.569749;
static double hist[153];

static unsigned long pktCount = 0;
bool sourceDecoder::decode()
{
  if (channel_decoded_data_buffer_data_valid != 1) return false;
  if (audio_data_flag == 0) return false;
  int n = length_decoded_data / 8;
  if (n <= 0 || n > 4096) return false;
  std::vector<unsigned char> b(n);
  bits2bytes(channel_decoded_data_buffer, n * 8, b.data());
  double ck = 0;
  crc16_bytewise(&ck, b.data(), n);
  bool ok = fabs(ck) <= 1e-12;
  static const char *hx = "0123456789abcdef";
  std::string s;
  s.reserve(n * 2);
  for (int i = 0; i < n; i++) { s += hx[b[i] >> 4]; s += hx[b[i] & 15]; }
  printf("{\"t\":\"pkt\",\"ok\":%d,\"n\":%lu,\"hex\":\"%s\"}\n", ok ? 1 : 0, ++pktCount, s.c_str());
  fflush(stdout);
  return ok;
}

int main()
{
  srcDecoder = new sourceDecoder;
  demodulatorPtr = new demodulator;
  avgSNR = 0; avgSNRAvailable = false;
  demodulatorPtr->init();
  initGetmode(DRMBUFSIZE / 4);
  samplerate_offset_estimation = 0.0;
  runstate = RUN_STATE_POWER_ON; channel_decoding();
  runstate = RUN_STATE_INIT; channel_decoding();
  runstate = RUN_STATE_NORMAL;
  const int N = 1024; // RXSTRIPE
  std::vector<short> in(N);
  std::vector<float> iq(2 * DRMBUFSIZE);
  memset(hist, 0, sizeof hist);
  long blocks = 0;
  for (;;) {
    size_t got = 0;
    while (got < (size_t)N) { size_t r = fread(in.data() + got, 2, N - got, stdin); if (r == 0) break; got += r; }
    if (got < (size_t)N) break;
    // filtre de Hilbert de QSSTV : sortie complexe (quadrature filtrée, entrée retardée)
    for (int k = 0; k < N; k++) {
      memmove(hist + 1, hist, sizeof(double) * 152);
      hist[0] = (double)in[k];
      double q = 0;
      for (int i = 0; i < 153; i++) q += hist[i] * drmHilbertCoef[i];
      iq[2 * k] = (float)(q / HILB_GAIN);
      iq[2 * k + 1] = (float)hist[76];
    }
    if (input_samples_buffer_request == 0) demodulatorPtr->demodulate(iq.data(), 0);
    demodulatorPtr->demodulate(iq.data(), N);
    float w = WMERFAC < 0 ? 0 : WMERFAC;
    if (avgSNRAvailable) avgSNR = 0.95f * avgSNR + 0.05f * w;
    // état environ toutes les 400 ms (5 blocs de 1024 échantillons à 12 kHz ≈ 427 ms)
    if (++blocks % 5 == 0) {
      std::string c;
      if (demodulatorPtr->isFrameSync() && lMSC > 0) {
        int step = lMSC > 300 ? lMSC / 300 : 1;
        char tmp[40];
        for (int i = 0; i < lMSC; i += step) { snprintf(tmp, sizeof tmp, "%s%.2f,%.2f", c.empty() ? "" : ",", MSC_cells_sequence[2 * i], MSC_cells_sequence[2 * i + 1]); c += tmp; }
      }
      printf("{\"t\":\"st\",\"ts\":%d,\"fs\":%d,\"frs\":%d,\"fac\":%d,\"mode\":%d,\"occ\":%d,\"qam\":%d,\"il\":%d,\"snr\":%.1f,\"fo\":%.1f,\"call\":\"%s\",\"c\":[%s]}\n",
        demodulatorPtr->isTimeSync() ? 1 : 0, demodulatorPtr->isFrequencySync() ? 1 : 0, demodulatorPtr->isFrameSync() ? 1 : 0, demodulatorPtr->isFACAvailable() ? 1 : 0,
        robustness_mode, spectrum_occupancy_new, msc_mode_new, interleaver_depth_new, avgSNRAvailable ? avgSNR : w, freqOffset,
        drmCallsign.s.c_str(), c.c_str());
      fflush(stdout);
    }
  }
  return 0;
}
