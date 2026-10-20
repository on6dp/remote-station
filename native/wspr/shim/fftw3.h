/*
 * fftw3.h — remplacement minimal de l'API FFTW (simple précision) utilisée par wsprd,
 * au-dessus de KISS FFT (inclus dans ft8_lib). Seules les fonctions appelées par wsprd.c existent.
 */
#ifndef RS_FFTW3_SHIM_H
#define RS_FFTW3_SHIM_H
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <fft/kiss_fft.h>
#include <fft/kiss_fftr.h>

typedef float fftwf_complex[2];
typedef struct { int n; int real; float *rin; fftwf_complex *in, *out; kiss_fft_cfg cfg; kiss_fftr_cfg rcfg; } rs_fftwf_plan_s;
typedef rs_fftwf_plan_s *fftwf_plan;

#define FFTW_FORWARD (-1)
#define FFTW_BACKWARD (+1)
#define FFTW_ESTIMATE 0
#define FFTW_ESTIMATE_PATIENT 0
#define FFTW_MEASURE 0
#define FFTW_PATIENT 0
#define FFTW_EXHAUSTIVE 0

static inline void *fftwf_malloc(size_t n) { return malloc(n); }
static inline void fftwf_free(void *p) { free(p); }
static inline fftwf_plan fftwf_plan_dft_1d(int n, fftwf_complex *in, fftwf_complex *out, int sign, unsigned flags)
{
    (void)flags;
    fftwf_plan p = (fftwf_plan)calloc(1, sizeof(rs_fftwf_plan_s));
    p->n = n; p->in = in; p->out = out;
    p->cfg = kiss_fft_alloc(n, sign == FFTW_BACKWARD, NULL, NULL);
    return p;
}
/* Transformée réelle → complexe (n/2+1 sorties) */
static inline fftwf_plan fftwf_plan_dft_r2c_1d(int n, float *in, fftwf_complex *out, unsigned flags)
{
    (void)flags;
    fftwf_plan p = (fftwf_plan)calloc(1, sizeof(rs_fftwf_plan_s));
    p->n = n; p->real = 1; p->rin = in; p->out = out;
    p->rcfg = kiss_fftr_alloc(n, 0, NULL, NULL);
    return p;
}
/* KISS FFT et FFTW n'appliquent pas de normalisation : mêmes résultats */
static inline void fftwf_execute(const fftwf_plan p)
{
    if (p->real) kiss_fftr(p->rcfg, p->rin, (kiss_fft_cpx *)p->out);
    else kiss_fft(p->cfg, (kiss_fft_cpx *)p->in, (kiss_fft_cpx *)p->out);
}
static inline void fftwf_destroy_plan(fftwf_plan p) { if (p) { free(p->cfg); free(p->rcfg); free(p); } }
static inline int fftwf_import_wisdom_from_file(FILE *f) { (void)f; return 0; }
static inline void fftwf_export_wisdom_to_file(FILE *f) { (void)f; }
static inline void fftwf_cleanup(void) {}
#endif
