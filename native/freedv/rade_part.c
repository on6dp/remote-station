/*
 * rade_part.c — FreeDV RADE V1 (Radio Autoencoder) pour fdvd : réception et émission en continu.
 * Bibliothèque rade_c (https://github.com/freedv/rade_c, BSD 2), vocodeur FARGAN et extraction des paramètres de la
 * voix d'Opus (BSD), texte de l'indicatif (fin de passage, EOO) comme FreeDV : rade_text de freedv-backend (BSD 2).
 * Voir TIERS.md.
 */
#include "config.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include "rade_api.h"
#include "rade_dsp.h"
#include "fargan.h"
#include "lpcnet.h"
#include "arch.h"
#include "cpu_support.h"
#include "rade_text.h"
#include "rade_part.h"

static int inited = 0;
static void init_once(void) { if (!inited) { rade_initialize(); inited = 1; } }

/* ------------------------------------------------------------------ réception */
struct RadeRx {
  struct rade *r;
  RADE_COMP *in; int n_in, cap_in;
  float *feat, *eoo;
  int n_eoo;
  FARGANState fargan;
  int ready, cont;
  float contbuf[5 * NB_TOTAL_FEATURES];
  rade_text_t rt;
  char call[16]; int callNew;
  int lastSync;
};
static void onText(rade_text_t rt, const char *t, int len, void *st) {
  (void)rt;
  RadeRx *x = (RadeRx *)st;
  int j = 0;
  for (int i = 0; i < len && j < 15; i++) if (t[i] > 32 && t[i] < 127 && t[i] != '"' && t[i] != '\\') x->call[j++] = t[i];
  x->call[j] = 0;
  if (j) x->callNew = 1;
}
RadeRx *rp_rx_open(void) {
  init_once();
  RadeRx *x = calloc(1, sizeof *x);
  x->r = rade_open("", RADE_VERBOSE_0);
  if (!x->r) { free(x); return NULL; }
  x->cap_in = rade_nin_max(x->r) + 400;
  x->in = calloc(x->cap_in, sizeof(RADE_COMP));
  x->feat = calloc(rade_n_features_in_out(x->r), sizeof(float));
  x->n_eoo = rade_n_eoo_bits(x->r);
  x->eoo = calloc(x->n_eoo ? x->n_eoo : 1, sizeof(float));
  fargan_init(&x->fargan);
  x->rt = rade_text_create();
  rade_text_set_rx_callback(x->rt, onText, x);
  return x;
}
/* in : n échantillons 8 kHz (s16) ; voix 16 kHz ajoutée par out(st, pcm, n) */
void rp_rx_feed(RadeRx *x, const short *in, int n, void (*out)(void *, const short *, int), void *st) {
  for (int i = 0; i < n; i++) {
    if (x->n_in >= x->cap_in) { memmove(x->in, x->in + 1, (x->cap_in - 1) * sizeof(RADE_COMP)); x->n_in--; }
    x->in[x->n_in].real = in[i] * (2.0f / RADE_INT16_SCALE); /* signal réel (BLU) : 2 × l'inverse de l'échelle d'émission */
    x->in[x->n_in].imag = 0.0f;
    x->n_in++;
  }
  int nin;
  while (x->n_in >= (nin = rade_nin(x->r))) {
    int has_eoo = 0;
    int n_out = rade_rx(x->r, x->feat, &has_eoo, x->eoo, x->in);
    memmove(x->in, x->in + nin, (x->n_in - nin) * sizeof(RADE_COMP));
    x->n_in -= nin;
    if (has_eoo && x->n_eoo) rade_text_rx(x->rt, x->eoo, x->n_eoo);
    int sy = rade_sync(x->r);
    if (!sy && x->lastSync) { x->ready = 0; x->cont = 0; fargan_init(&x->fargan); } /* fin de passage : vocodeur remis à zéro */
    x->lastSync = sy;
    if (n_out <= 0) continue;
    int nf = n_out / RADE_NB_TOTAL_FEATURES;
    for (int f = 0; f < nf; f++) {
      float *ft = &x->feat[f * RADE_NB_TOTAL_FEATURES];
      if (!x->ready) {
        memcpy(&x->contbuf[x->cont * NB_TOTAL_FEATURES], ft, NB_TOTAL_FEATURES * sizeof(float));
        if (++x->cont >= 5) {
          float packed[5 * NB_FEATURES];
          for (int i = 0; i < 5; i++) memcpy(&packed[i * NB_FEATURES], &x->contbuf[i * NB_TOTAL_FEATURES], NB_FEATURES * sizeof(float));
          float zeros[FARGAN_CONT_SAMPLES];
          memset(zeros, 0, sizeof zeros);
          fargan_cont(&x->fargan, zeros, packed);
          x->ready = 1;
        }
        continue;
      }
      float fp[LPCNET_FRAME_SIZE];
      short pcm[LPCNET_FRAME_SIZE];
      fargan_synthesize(&x->fargan, fp, ft);
      for (int s = 0; s < LPCNET_FRAME_SIZE; s++) {
        float v = fp[s] * 32768.0f;
        v = v > 32767.0f ? 32767.0f : v < -32767.0f ? -32767.0f : v;
        pcm[s] = (short)floorf(0.5f + v);
      }
      out(st, pcm, LPCNET_FRAME_SIZE);
    }
  }
}
int rp_rx_sync(RadeRx *x) { return rade_sync(x->r); }
float rp_rx_snr(RadeRx *x) { return rade_snrdB_3k_est(x->r); }
float rp_rx_foff(RadeRx *x) { return rade_freq_offset(x->r); }
const char *rp_rx_call(RadeRx *x) { if (!x->callNew) return NULL; x->callNew = 0; return x->call; }

/* ------------------------------------------------------------------ émission */
struct RadeTx {
  struct rade *r;
  LPCNetEncState *net;
  int arch;
  float *feat; int nfeat, per, idx;
  RADE_COMP *iq; int niq, neoo;
  RADE_COMP *eoo;
  short *pcm16; int npcm;
};
RadeTx *rp_tx_open(const char *call) {
  init_once();
  RadeTx *x = calloc(1, sizeof *x);
  x->r = rade_open("", RADE_VERBOSE_0);
  if (!x->r) { free(x); return NULL; }
  x->arch = opus_select_arch();
  x->net = lpcnet_encoder_create();
  x->nfeat = rade_n_features_in_out(x->r);
  x->per = x->nfeat / RADE_NB_TOTAL_FEATURES;
  x->feat = calloc(x->nfeat, sizeof(float));
  x->niq = rade_n_tx_out(x->r);
  x->neoo = rade_n_tx_eoo_out(x->r);
  x->iq = calloc(x->niq, sizeof(RADE_COMP));
  x->eoo = calloc(x->neoo, sizeof(RADE_COMP));
  x->pcm16 = calloc(LPCNET_FRAME_SIZE, sizeof(short));
  /* Indicatif dans la trame de fin de passage (EOO), codé comme FreeDV (LDPC + CRC) */
  int nb = rade_n_eoo_bits(x->r);
  if (nb > 0 && call && call[0]) {
    float *syms = calloc(nb, sizeof(float));
    rade_text_t rt = rade_text_create();
    rade_text_generate_tx_string(rt, call, (int)strlen(call), syms, nb);
    rade_tx_set_eoo_bits(x->r, syms);
    rade_text_destroy(rt);
    free(syms);
  }
  return x;
}
static void emit(const RADE_COMP *iq, int n, void (*out)(void *, const short *, int), void *st) {
  short buf[1024];
  int k = 0;
  for (int i = 0; i < n; i++) {
    float v = iq[i].real * RADE_INT16_SCALE;
    v = v > 32767.0f ? 32767.0f : v < -32767.0f ? -32767.0f : v;
    buf[k++] = (short)floorf(0.5f + v);
    if (k == 1024) { out(st, buf, k); k = 0; }
  }
  if (k) out(st, buf, k);
}
/* voix 16 kHz → signal 8 kHz par out() */
void rp_tx_speech(RadeTx *x, const short *sp, int n, void (*out)(void *, const short *, int), void *st) {
  for (int i = 0; i < n; i++) {
    x->pcm16[x->npcm++] = sp[i];
    if (x->npcm < LPCNET_FRAME_SIZE) continue;
    x->npcm = 0;
    lpcnet_compute_single_frame_features(x->net, x->pcm16, &x->feat[x->idx * RADE_NB_TOTAL_FEATURES], x->arch);
    if (++x->idx >= x->per) {
      int no = rade_tx(x->r, x->iq, x->feat);
      emit(x->iq, no, out, st);
      x->idx = 0;
    }
  }
}
/* fin de parole : dernière trame complétée de zéros, puis la trame de fin de passage (indicatif) */
void rp_tx_end(RadeTx *x, void (*out)(void *, const short *, int), void *st) {
  if (x->idx > 0) {
    memset(&x->feat[x->idx * RADE_NB_TOTAL_FEATURES], 0, (size_t)(x->per - x->idx) * RADE_NB_TOTAL_FEATURES * sizeof(float));
    int no = rade_tx(x->r, x->iq, x->feat);
    emit(x->iq, no, out, st);
    x->idx = 0;
  }
  int ne = rade_tx_eoo(x->r, x->eoo);
  emit(x->eoo, ne, out, st);
}
