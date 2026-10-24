/*
 * wsjtxd.c — décodeur WSJT-X en processus permanent pour Remote Station (GPL v3, comme WSJT-X).
 *
 * Utilise le moteur de décodage de WSJT-X 3.x (DecoderEngine.h : FT8 « MTD » multi-passes de type JTDX,
 * FT4, …) compilé avec native/wsjtx/build.py. Le serveur lui envoie chaque période sur l'entrée standard
 * et lit les décodages sur la sortie standard ; le processus garde son état entre deux périodes
 * (indicatifs hachés, décodages anticipés puis complets d'une même période, AP).
 *
 * Entrée : une ligne de commande, suivie pour DECODE de n échantillons int16 little-endian (12 kHz) :
 *   DECODE mode phase id n clé=valeur …     mode 8 (FT8) ou 5 (FT4) ; phase 1 anticipée, 2 normale, 3 reprise
 *     FT8 « classique » comme WSJT-X : stage=41 (11,8 s d'audio, phase 1) puis stage=50 (phase 2) sur le même id ;
 *     « mtd=1 » : décodeur multi-passes de type JTDX (plus lent, plus sensible), sur un id à part
 *   RELEASE id                              oublie l'audio d'une période
 *   RESET                                   oublie tout l'historique
 * Sortie : « D snr dt fréq ap qualité message » par décodage, puis « E statut nombre ms ».
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <time.h>
#include "DecoderEngine.h"
#ifdef _WIN32
#include <io.h>
#include <fcntl.h>
#endif

static decoder_engine_handle H;
static int16_t *buf;
static int bufcap;

static void pad(char *dst, int n, const char *src)
{
  int k = (int)strlen(src);
  for (int i = 0; i < n; i++) dst[i] = i < k ? src[i] : ' ';
}

static void on_obs(const decoder_observation *o, void *u)
{
  (void)u;
  char msg[39];
  memcpy(msg, o->message, 38);
  msg[38] = 0;
  for (int i = 37; i >= 0 && (msg[i] == ' ' || msg[i] == 0); i--) msg[i] = 0;
  if (!msg[0]) return;
  printf("D\t%d\t%.2f\t%.1f\t%d\t%.2f\t%s\n", o->snr_db, o->dt_seconds, o->frequency_hz, o->ap_type, o->quality, msg);
}

static double now_ms(void)
{
  struct timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return t.tv_sec * 1e3 + t.tv_nsec / 1e6;
}

int main(void)
{
#ifdef _WIN32
  _setmode(_fileno(stdin), _O_BINARY); /* échantillons binaires : pas de conversion CR/LF ni de Ctrl-Z */
  setvbuf(stdout, NULL, _IONBF, 0);
#else
  setvbuf(stdout, NULL, _IOLBF, 0);
#endif
  decoder_engine_options eo = { DECODER_ENGINE_ABI };
  int st = decoder_engine_create(&eo, &H);
  if (st != DECODER_OK) { printf("E\t%d\t0\t0\n", st); return 1; }
  printf("READY\n");
  char line[2048];
  while (fgets(line, sizeof line, stdin)) {
    char cmd[16] = "";
    sscanf(line, "%15s", cmd);
    if (!strcmp(cmd, "QUIT")) break;
    if (!strcmp(cmd, "RESET")) { decoder_engine_reset_session(H); printf("E\t0\t0\t0\n"); continue; }
    if (!strcmp(cmd, "RELEASE")) {
      long long id = 0;
      sscanf(line, "%*s %lld", &id);
      decoder_engine_release_input(H, id);
      printf("E\t0\t0\t0\n");
      continue;
    }
    if (strcmp(cmd, "DECODE")) { printf("E\t1\t0\t0\n"); continue; }
    int mode = 8, phase = 2, n = 0, off = 0;
    long long id = 1;
    if (sscanf(line, "%*s %d %d %lld %d%n", &mode, &phase, &id, &n, &off) < 4 || n < 0 || n > 900000) { printf("E\t1\t0\t0\n"); continue; }
    if (n > bufcap) { bufcap = n; buf = realloc(buf, sizeof(int16_t) * (size_t)bufcap); }
    if (n && fread(buf, sizeof(int16_t), (size_t)n, stdin) != (size_t)n) break;

    decoder_attempt_request rq;
    memset(&rq, 0, sizeof rq);
    rq.input_id = id;
    rq.analysis_id = id;
    rq.attempt_no = phase;
    rq.mode = mode;
    rq.phase = phase;
    rq.source = DECODER_SOURCE_FILE; /* pas de coupure selon l'heure réelle : l'audio arrive avec un délai */
    decoder_ft8_options *f8 = &rq.ft8;
    decoder_ft4_options *f4 = &rq.ft4;
    /* Réglages de jt9 (WSJT-X) pour le décodeur FT8 multi-passes, profondeur maximale */
    f8->half_symbol_stage = 50; f8->reuse_spectrum = 0; f8->receive_frequency_hz = 1500; f8->transmit_frequency_hz = 1500;
    f8->search_low_hz = 100; f8->search_high_hz = 3000; f8->tolerance_hz = 20; f8->depth = 3; f8->ap_width_hz = 25;
    f8->candidate_thinning = 100; f8->cycles = 3; f8->trials = 10000; f8->threads = 0; f8->receive_sensitivity = 3;
    f8->ap_enabled = 1; f8->mtd = 1; f8->low_threshold = 1; f8->subtract_pass = 1; f8->hide_duplicates = 1;
    f8->dx_search = 1; f8->wide_dx_search = 1;
    f4->receive_frequency_hz = 1500; f4->search_low_hz = 100; f4->search_high_hz = 3000; f4->depth = 3;
    char mycall[13] = "", hiscall[13] = "", mygrid[7] = "", hisgrid[7] = "", mybase[13] = "", hisbase[13] = "";
    int mystd = 1, hisstd = 1;
    /* clé=valeur */
    char *p = line + off;
    char k[32], v[64];
    int used;
    while (sscanf(p, " %31[^= \n]=%63s%n", k, v, &used) == 2) {
      p += used;
      long x = strtol(v, NULL, 10);
      if (!strcmp(k, "stage")) f8->half_symbol_stage = (int)x;
      else if (!strcmp(k, "utc")) { f8->utc = (int)x; f4->utc = (int)x; }
      else if (!strcmp(k, "rx")) { f8->receive_frequency_hz = (int)x; f4->receive_frequency_hz = (int)x; }
      else if (!strcmp(k, "tx")) f8->transmit_frequency_hz = (int)x;
      else if (!strcmp(k, "lo")) { f8->search_low_hz = (int)x; f4->search_low_hz = (int)x; }
      else if (!strcmp(k, "hi")) { f8->search_high_hz = (int)x; f4->search_high_hz = (int)x; }
      else if (!strcmp(k, "depth")) { f8->depth = (int)x; f4->depth = (int)x; }
      else if (!strcmp(k, "qp")) { f8->qso_progress = (int)x; f4->qso_progress = (int)x; }
      else if (!strcmp(k, "ap")) f8->ap_enabled = (int)x;
      else if (!strcmp(k, "mtd")) f8->mtd = (int)x;
      else if (!strcmp(k, "cycles")) f8->cycles = (int)x;
      else if (!strcmp(k, "sens")) f8->receive_sensitivity = (int)x;
      else if (!strcmp(k, "threads")) f8->threads = (int)x;
      else if (!strcmp(k, "lowth")) f8->low_threshold = (int)x;
      else if (!strcmp(k, "subpass")) f8->subtract_pass = (int)x;
      else if (!strcmp(k, "txing")) f8->transmitting = (int)x;
      else if (!strcmp(k, "even")) f8->even_sequence = (int)x;
      else if (!strcmp(k, "newband")) f8->band_changed = (int)x;
      else if (!strcmp(k, "src")) rq.source = (int)x;
      else if (!strcmp(k, "mycall")) snprintf(mycall, sizeof mycall, "%s", v);
      else if (!strcmp(k, "mybase")) snprintf(mybase, sizeof mybase, "%s", v);
      else if (!strcmp(k, "hiscall")) snprintf(hiscall, sizeof hiscall, "%s", v);
      else if (!strcmp(k, "hisbase")) snprintf(hisbase, sizeof hisbase, "%s", v);
      else if (!strcmp(k, "mygrid")) snprintf(mygrid, sizeof mygrid, "%s", v);
      else if (!strcmp(k, "hisgrid")) snprintf(hisgrid, sizeof hisgrid, "%s", v);
      else if (!strcmp(k, "mystd")) mystd = (int)x;
      else if (!strcmp(k, "hisstd")) hisstd = (int)x;
    }
    if (!mybase[0]) strcpy(mybase, mycall);
    if (!hisbase[0]) strcpy(hisbase, hiscall);
    pad(f8->mycall, 12, mycall); pad(f8->my_base_call, 12, mybase);
    pad(f8->hiscall, 12, hiscall); pad(f8->his_base_call, 12, hisbase);
    pad(f8->mygrid, 6, mygrid); pad(f8->hisgrid, 6, hisgrid);
    pad(f4->mycall, 12, mycall); pad(f4->hiscall, 12, hiscall);
    f8->standard_mycall = mycall[0] ? mystd : 0;
    f8->standard_hiscall = hiscall[0] ? hisstd : 0;
    f8->ap_mycall = mycall[0] ? 1 : 0;

    decoder_audio_view av = { buf, n, 12000 };
    decoder_attempt_outcome out;
    memset(&out, 0, sizeof out);
    double t0 = now_ms();
    st = decoder_engine_decode(H, &rq, &av, on_obs, NULL, &out);
    printf("E\t%d\t%d\t%.0f\n", st ? st : out.status, out.observation_count, now_ms() - t0);
  }
  decoder_engine_destroy(H);
  return 0;
}
