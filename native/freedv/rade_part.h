/* rade_part.h — RADE V1 pour fdvd (voir rade_part.c) */
#pragma once
typedef struct RadeRx RadeRx;
typedef struct RadeTx RadeTx;
RadeRx *rp_rx_open(void);
void rp_rx_feed(RadeRx *x, const short *in8k, int n, void (*out)(void *, const short *, int), void *st);
int rp_rx_sync(RadeRx *x);
float rp_rx_snr(RadeRx *x);
float rp_rx_foff(RadeRx *x);
const char *rp_rx_call(RadeRx *x);
RadeTx *rp_tx_open(const char *call);
void rp_tx_speech(RadeTx *x, const short *sp16k, int n, void (*out)(void *, const short *, int), void *st);
void rp_tx_end(RadeTx *x, void (*out)(void *, const short *, int), void *st);
