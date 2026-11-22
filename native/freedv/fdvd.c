/*
 * fdvd.c — FreeDV (phonie numérique HF) pour Remote Station.
 *   RADE (V1) : rade_c + FARGAN d'Opus (voir rade_part.c) ; 700D, 700E, 1600 : bibliothèque codec2 de FreeDV
 *   (https://github.com/drowe67/codec2, LGPL 2.1). Voir TIERS.md.
 *
 *   fdvd rx [modes]        réception : stdin = BF du TRX, s16 LE 8 kHz mono ; stdout = voix décodée, s16 LE 16 kHz
 *                          (deux fois plus d'échantillons qu'en entrée : silence tant qu'aucun mode n'est synchronisé) ;
 *                          stderr = état en lignes JSON. modes : liste séparée par des virgules (RADE,700D,700E,1600 par
 *                          défaut) : tous les décodeurs écoutent en même temps, celui qui est synchronisé est entendu.
 *   fdvd tx MODE INDICATIF émission : stdin = voix s16 LE 16 kHz ; stdout = signal FreeDV s16 LE 8 kHz ; indicatif
 *                          dans le canal texte (RADE : trame de fin de passage ; 700D / 700E : texte fiable ; 1600 :
 *                          texte varicode), comme FreeDV.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include "freedv_api.h"
#include "modem_stats.h"
#include "reliable_text.h"
#include "rade_part.h"
#ifdef _WIN32
#include <io.h>
#include <fcntl.h>
#endif

#define NDEC 4
#define BLK 160 /* 20 ms à 8 kHz */
#define OUTBLK 320 /* 20 ms à 16 kHz */
#define RADE_ID 100

static int modeOf(const char *s) {
  if (!strcmp(s, "RADE")) return RADE_ID;
  if (!strcmp(s, "700D")) return FREEDV_MODE_700D;
  if (!strcmp(s, "700E")) return FREEDV_MODE_700E;
  if (!strcmp(s, "1600")) return FREEDV_MODE_1600;
  return -1;
}

/* ------------------------------------------------------------------ 8 ↔ 16 kHz (filtre demi-bande, 31 coefficients) */
#define HB 31
static float hb[HB];
static void hbInit(void) {
  float s = 0;
  for (int i = 0; i < HB; i++) {
    float x = i - (HB - 1) / 2.0f;
    float sinc = x == 0 ? 0.5f : sinf((float)M_PI * 0.5f * x) / ((float)M_PI * x);
    float w = 0.42f - 0.5f * cosf(2 * (float)M_PI * i / (HB - 1)) + 0.08f * cosf(4 * (float)M_PI * i / (HB - 1));
    hb[i] = sinc * w; s += hb[i];
  }
  for (int i = 0; i < HB; i++) hb[i] /= s;
}
typedef struct { float z[HB]; int p; } Fir;
static float firStep(Fir *f, float x) {
  f->z[f->p] = x;
  float acc = 0;
  for (int i = 0, k = f->p; i < HB; i++) { acc += hb[i] * f->z[k]; if (--k < 0) k = HB - 1; }
  if (++f->p >= HB) f->p = 0;
  return acc;
}
static short clip16(float v) { return v > 32767 ? 32767 : v < -32767 ? -32767 : (short)lrintf(v); }
/* 8 → 16 kHz */
static void up2(Fir *f, const short *in, int n, short *out) {
  for (int i = 0; i < n; i++) { out[2 * i] = clip16(2 * firStep(f, in[i])); out[2 * i + 1] = clip16(2 * firStep(f, 0)); }
}

/* ------------------------------------------------------------------ réception */
typedef struct {
  const char *name;
  int rade;
  struct freedv *f;
  RadeRx *rx;
  reliable_text_t rt;
  Fir up;
  short *in; int n_in;              /* entrée en attente (codec2) */
  short *out; int cap, n_out;       /* voix décodée en attente, 16 kHz */
  short *spk; short *dem; short *spk16;
  char txt[64]; int txtNew;
  char raw[64]; int nraw;
  char prev[64];
  int run;                          /* blocs de 20 ms synchronisés d'affilée */
} Dec;

static Dec dec[NDEC];
static int ndec = 0;

static void push(Dec *d, const short *s, int n) {
  if (d->n_out + n > d->cap) { int drop = d->n_out + n - d->cap; if (drop > d->n_out) drop = d->n_out; memmove(d->out, d->out + drop, (d->n_out - drop) * sizeof(short)); d->n_out -= drop; }
  if (n > d->cap) { s += n - d->cap; n = d->cap; }
  memcpy(d->out + d->n_out, s, n * sizeof(short));
  d->n_out += n;
}
static void pushCb(void *st, const short *s, int n) { push((Dec *)st, s, n); }

static void onReliable(reliable_text_t rt, const char *t, int len, void *st) {
  Dec *d = (Dec *)st;
  int n = len < 63 ? len : 63, j = 0;
  for (int i = 0; i < n; i++) if (t[i] >= 32 && t[i] < 127 && t[i] != '"' && t[i] != '\\') d->txt[j++] = t[i];
  d->txt[j] = 0;
  d->txtNew = 1;
  reliable_text_reset(rt);
}
static void onChar(void *st, char c) {
  Dec *d = (Dec *)st;
  if (c == '\r' || c == '\n') {
    d->raw[d->nraw] = 0;
    char *t = d->raw;
    while (*t == ' ') t++;
    for (int i = (int)strlen(t) - 1; i >= 0 && t[i] == ' '; i--) t[i] = 0;
    if (strlen(t) >= 3) { if (!strcmp(t, d->prev)) { strcpy(d->txt, t); d->txtNew = 1; } strcpy(d->prev, t); }
    d->nraw = 0;
    return;
  }
  if (c >= 32 && c < 127 && c != '"' && c != '\\' && d->nraw < 63) d->raw[d->nraw++] = c;
}
static char txChar(void *st) { (void)st; return ' '; }

static void decStats(Dec *d, int *sync, float *snr, float *foff) {
  if (d->rade) { *sync = rp_rx_sync(d->rx); *snr = *sync ? rp_rx_snr(d->rx) : -5; *foff = *sync ? rp_rx_foff(d->rx) : 0; return; }
  struct MODEM_STATS ms;
  freedv_get_modem_extended_stats(d->f, &ms);
  *sync = ms.sync; *snr = ms.snr_est; *foff = ms.foff;
}

static int rxMain(const char *list) {
  char buf[64];
  strncpy(buf, list ? list : "RADE,700D,700E,1600", sizeof buf - 1);
  buf[sizeof buf - 1] = 0;
  for (char *p = strtok(buf, ","); p && ndec < NDEC; p = strtok(NULL, ",")) {
    int m = modeOf(p);
    if (m < 0) continue;
    Dec *d = &dec[ndec];
    memset(d, 0, sizeof *d);
    d->cap = 16000 * 2;
    d->out = calloc(d->cap, sizeof(short));
    if (m == RADE_ID) {
      d->rade = 1; d->name = "RADE";
      d->rx = rp_rx_open();
      if (!d->rx) continue;
    } else {
      d->f = freedv_open(m);
      if (!d->f) continue;
      d->name = m == FREEDV_MODE_700D ? "700D" : m == FREEDV_MODE_700E ? "700E" : "1600";
      freedv_set_squelch_en(d->f, 1);
      if (m != FREEDV_MODE_1600) {
        d->rt = reliable_text_create();
        reliable_text_use_with_freedv(d->rt, d->f, onReliable, d);
      } else freedv_set_callback_txt(d->f, onChar, txChar, d);
      d->in = calloc(freedv_get_n_max_modem_samples(d->f) + BLK, sizeof(short));
      d->spk = calloc(freedv_get_n_max_speech_samples(d->f), sizeof(short));
      d->spk16 = calloc(2 * freedv_get_n_max_speech_samples(d->f), sizeof(short));
      d->dem = calloc(freedv_get_n_max_modem_samples(d->f), sizeof(short));
    }
    ndec++;
  }
  if (!ndec) { fprintf(stderr, "{\"t\":\"err\",\"msg\":\"aucun mode\"}\n"); return 1; }
  short blk[BLK], zero[OUTBLK];
  memset(zero, 0, sizeof zero);
  int act = -1, blocks = 0, lostAt = 0, radeAt = 0;
  for (;;) {
    size_t r = fread(blk, sizeof(short), BLK, stdin);
    if (r == 0) break;
    for (size_t i = r; i < BLK; i++) blk[i] = 0;
    blocks++;
    for (int k = 0; k < ndec; k++) {
      Dec *d = &dec[k];
      if (d->rade) { rp_rx_feed(d->rx, blk, BLK, pushCb, d); continue; }
      memcpy(d->in + d->n_in, blk, sizeof blk);
      d->n_in += BLK;
      int nin;
      while (d->n_in >= (nin = freedv_nin(d->f))) {
        memcpy(d->dem, d->in, nin * sizeof(short));
        int nout = freedv_rx(d->f, d->spk, d->dem);
        memmove(d->in, d->in + nin, (d->n_in - nin) * sizeof(short));
        d->n_in -= nin;
        up2(&d->up, d->spk, nout, d->spk16);
        push(d, d->spk16, 2 * nout);
      }
    }
    /* Décodeur entendu : synchronisé depuis 0,5 s au moins (pas de saut sur une fausse synchro dans le bruit ;
       700D / 700E : SNR d'au moins 0 dB, 1600 : 2 dB), le plus fort s'il y en a plusieurs ; gardé tant qu'il reste synchronisé, et 1 s après */
    int best = -1; float bsnr = -99;
    for (int k = 0; k < ndec; k++) {
      int sync; float snr, fo;
      decStats(&dec[k], &sync, &snr, &fo);
      dec[k].run = sync ? dec[k].run + 1 : 0;
      int okk = dec[k].run >= 25 && snr >= (dec[k].rade ? -10.0f : strcmp(dec[k].name, "1600") ? 0.0f : 2.0f);
      if (k == act && sync) okk = 1;
      if (sync && dec[k].rade) radeAt = blocks;
      if (okk && dec[k].rade) snr += 20; /* RADE synchronisé : prioritaire (les modes 700 se calent parfois à tort sur un signal RADE) */
      if (okk && !dec[k].rade && k != act && radeAt && blocks - radeAt < 100) okk = 0; /* ni pendant ni 2 s après un passage RADE */
      if (okk && (best < 0 || snr > bsnr)) { best = k; bsnr = snr; }
    }
    if (best >= 0) { if (act < 0 || dec[act].run == 0 || best != act) act = best; lostAt = 0; }
    else if (act >= 0 && !lostAt) lostAt = blocks;
    else if (act >= 0 && blocks - lostAt > 50) act = -1;
    /* Sortie : 20 ms de voix (16 kHz) par bloc d'entrée */
    if (act >= 0 && dec[act].n_out >= OUTBLK) fwrite(dec[act].out, sizeof(short), OUTBLK, stdout);
    else fwrite(zero, sizeof(short), OUTBLK, stdout);
    for (int k = 0; k < ndec; k++) {
      Dec *d = &dec[k];
      int take = d->n_out >= OUTBLK ? OUTBLK : d->n_out;
      /* RADE rend sa voix par paquets de 120 ms : jusqu'à 0,4 s d'avance gardée ; au-delà, jeté (pas de retard qui s'accumule) */
      if (d->n_out - take > 6400) take = d->n_out - 6400;
      memmove(d->out, d->out + take, (d->n_out - take) * sizeof(short));
      d->n_out -= take;
    }
    fflush(stdout);
    if (blocks % 10 == 0) {
      fprintf(stderr, "{\"t\":\"st\",\"m\":[");
      for (int k = 0; k < ndec; k++) {
        int sync; float snr, fo;
        decStats(&dec[k], &sync, &snr, &fo);
        fprintf(stderr, "%s{\"n\":\"%s\",\"s\":%d,\"snr\":%.1f,\"fo\":%.1f}", k ? "," : "", dec[k].name, sync, snr, fo);
      }
      fprintf(stderr, "],\"act\":\"%s\"", act >= 0 ? dec[act].name : "");
      if (act >= 0 && !dec[act].rade) {
        struct MODEM_STATS ms;
        freedv_get_modem_extended_stats(dec[act].f, &ms);
        fprintf(stderr, ",\"c\":[");
        int n = 0;
        for (int row = 0; row < ms.nr && row < MODEM_STATS_NR_MAX; row++)
          for (int c = 0; c < ms.Nc && c <= MODEM_STATS_NC_MAX && n < 300; c++, n++)
            fprintf(stderr, "%s%.2f,%.2f", n ? "," : "", ms.rx_symbols[row][c].real, ms.rx_symbols[row][c].imag);
        fprintf(stderr, "]");
      }
      fprintf(stderr, "}\n");
    }
    for (int k = 0; k < ndec; k++) {
      const char *call = NULL;
      if (dec[k].rade) call = rp_rx_call(dec[k].rx);
      else if (dec[k].txtNew) { dec[k].txtNew = 0; call = dec[k].txt; }
      if (call && call[0]) fprintf(stderr, "{\"t\":\"txt\",\"n\":\"%s\",\"call\":\"%s\"}\n", dec[k].name, call);
      if (!dec[k].rade) dec[k].txt[0] = 0;
    }
    fflush(stderr);
  }
  return 0;
}

/* ------------------------------------------------------------------ émission */
static const char *txText = "";
static int txPos = 0;
static char txCharCall(void *st) { (void)st; char c = txText[txPos++]; if (!c) { txPos = 0; return '\r'; } return c; }
static void rxNone(void *st, char c) { (void)st; (void)c; }
static void outCb(void *st, const short *s, int n) { (void)st; fwrite(s, sizeof(short), n, stdout); fflush(stdout); }

static int txMain(const char *mode, const char *call) {
  int m = modeOf(mode);
  if (m < 0) { fprintf(stderr, "{\"t\":\"err\",\"msg\":\"mode inconnu\"}\n"); return 1; }
  static char cs[16];
  int j = 0;
  for (int i = 0; call && call[i] && j < 15; i++) { char c = call[i]; if ((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '/') cs[j++] = c; else if (c >= 'a' && c <= 'z') cs[j++] = c - 32; }
  cs[j] = 0;
  short in[OUTBLK];
  if (m == RADE_ID) {
    RadeTx *x = rp_tx_open(cs);
    if (!x) return 1;
    fprintf(stderr, "{\"t\":\"tx\",\"mode\":\"RADE\"}\n");
    fflush(stderr);
    size_t r;
    while ((r = fread(in, sizeof(short), OUTBLK, stdin)) > 0) rp_tx_speech(x, in, (int)r, outCb, NULL);
    rp_tx_end(x, outCb, NULL);
    fflush(stdout);
    return 0;
  }
  struct freedv *f = freedv_open(m);
  if (!f) return 1;
  reliable_text_t rt = NULL;
  if (m != FREEDV_MODE_1600) {
    freedv_set_clip(f, 1);
    freedv_set_tx_bpf(f, 1);
    rt = reliable_text_create();
    reliable_text_set_string(rt, cs, strlen(cs));
    reliable_text_use_with_freedv(rt, f, NULL, NULL);
  } else { txText = cs; freedv_set_callback_txt(f, rxNone, txCharCall, NULL); }
  int ns = freedv_get_n_speech_samples(f), nm = freedv_get_n_nom_modem_samples(f);
  short *sp = calloc(ns, sizeof(short)), *mo = calloc(nm, sizeof(short));
  fprintf(stderr, "{\"t\":\"tx\",\"mode\":\"%s\",\"ns\":%d,\"nm\":%d}\n", mode, ns, nm);
  fflush(stderr);
  Fir dn; memset(&dn, 0, sizeof dn);
  int got = 0, ph = 0;
  size_t r;
  while ((r = fread(in, sizeof(short), OUTBLK, stdin)) > 0) {
    for (size_t i = 0; i < r; i++) {
      float y = firStep(&dn, in[i]); /* 16 → 8 kHz : filtre puis un échantillon sur deux */
      if (ph ^= 1) continue;
      sp[got++] = clip16(y);
      if (got == ns) { freedv_tx(f, mo, sp); fwrite(mo, sizeof(short), nm, stdout); fflush(stdout); got = 0; }
    }
  }
  if (got) { memset(sp + got, 0, (ns - got) * sizeof(short)); freedv_tx(f, mo, sp); fwrite(mo, sizeof(short), nm, stdout); }
  fflush(stdout);
  if (rt) reliable_text_destroy(rt);
  freedv_close(f);
  return 0;
}

int main(int argc, char **argv) {
#ifdef _WIN32
  _setmode(_fileno(stdin), _O_BINARY);
  _setmode(_fileno(stdout), _O_BINARY);
#endif
  hbInit();
  if (argc >= 2 && !strcmp(argv[1], "rx")) return rxMain(argc >= 3 ? argv[2] : NULL);
  if (argc >= 4 && !strcmp(argv[1], "tx")) return txMain(argv[2], argv[3]);
  fprintf(stderr, "usage : fdvd rx [RADE,700D,700E,1600] | fdvd tx MODE INDICATIF\n");
  return 2;
}
