/*
 * fftw_kiss.c — implémentation minimale de l'API FFTW (simple précision) au-dessus de KISS FFT,
 * pour compiler les décodeurs de WSJT-X (JT65, JTTY) sans la bibliothèque FFTW.
 * Couvre les appels utilisés par WSJT-X : plans 1D complexes, réel→complexe, complexe→réel,
 * exécution sur d'autres tableaux (new-array execute), allocation, « sagesse » et threads (sans effet),
 * et l'ancienne interface Fortran sfftw_*. Comme FFTW, aucune normalisation n'est appliquée.
 */
#include <stdlib.h>
#include <string.h>
#include <fft/kiss_fft.h>
#include <fft/kiss_fftr.h>

typedef float fftwf_complex[2];
typedef struct {
    int kind; /* 0 complexe, 1 r2c, 2 c2r */
    int n;
    void *in, *out;
    kiss_fft_cfg c;
    kiss_fftr_cfg r;
    float *tmp; /* c2r : KISS FFT modifie l'entrée ; copie de travail */
} plan_s;
typedef plan_s *fftwf_plan;

static fftwf_plan mk(int kind, int n, void *in, void *out, int inverse)
{
    fftwf_plan p = (fftwf_plan)calloc(1, sizeof(plan_s));
    p->kind = kind; p->n = n; p->in = in; p->out = out;
    if (kind == 0 || (n & 1)) p->c = kiss_fft_alloc(n, inverse, NULL, NULL); /* taille impaire : FFT complexe */
    else p->r = kiss_fftr_alloc(n, kind == 2, NULL, NULL);
    if (kind != 0 && (n & 1)) p->tmp = (float *)malloc(sizeof(float) * 4 * n);
    return p;
}
fftwf_plan fftwf_plan_dft_1d(int n, fftwf_complex *in, fftwf_complex *out, int sign, unsigned flags)
{ (void)flags; return mk(0, n, in, out, sign > 0); }
fftwf_plan fftwf_plan_dft_r2c_1d(int n, float *in, fftwf_complex *out, unsigned flags)
{ (void)flags; return mk(1, n, in, out, 0); }
fftwf_plan fftwf_plan_dft_c2r_1d(int n, fftwf_complex *in, float *out, unsigned flags)
{ (void)flags; return mk(2, n, in, out, 1); }

static void run(fftwf_plan p, void *in, void *out)
{
    if (p->kind == 0) {
        kiss_fft(p->c, (kiss_fft_cpx *)in, (kiss_fft_cpx *)out);
    } else if (p->r && p->kind == 1) {
        kiss_fftr(p->r, (const kiss_fft_scalar *)in, (kiss_fft_cpx *)out);
    } else if (p->r) {
        kiss_fftri(p->r, (const kiss_fft_cpx *)in, (kiss_fft_scalar *)out);
    } else {
        /* Taille impaire : passage par une FFT complexe de n points */
        int n = p->n, i;
        kiss_fft_cpx *a = (kiss_fft_cpx *)p->tmp, *b = a + n;
        if (p->kind == 1) {
            const float *x = (const float *)in;
            for (i = 0; i < n; i++) { a[i].r = x[i]; a[i].i = 0; }
            kiss_fft(p->c, a, b);
            memcpy(out, b, sizeof(kiss_fft_cpx) * (n / 2 + 1));
        } else {
            const kiss_fft_cpx *X = (const kiss_fft_cpx *)in;
            for (i = 0; i <= n / 2; i++) a[i] = X[i];
            for (i = n / 2 + 1; i < n; i++) { a[i].r = X[n - i].r; a[i].i = -X[n - i].i; }
            kiss_fft(p->c, a, b);
            float *y = (float *)out;
            for (i = 0; i < n; i++) y[i] = b[i].r;
        }
    }
}
void fftwf_execute(const fftwf_plan p) { run(p, p->in, p->out); }
void fftwf_execute_dft(const fftwf_plan p, fftwf_complex *in, fftwf_complex *out) { run(p, in, out); }
void fftwf_execute_dft_r2c(const fftwf_plan p, float *in, fftwf_complex *out) { run(p, in, out); }
void fftwf_execute_dft_c2r(const fftwf_plan p, fftwf_complex *in, float *out) { run(p, in, out); }
void fftwf_destroy_plan(fftwf_plan p) { if (p) { free(p->c); free(p->r); free(p->tmp); free(p); } }

void *fftwf_malloc(size_t n) { return malloc(n); }
fftwf_complex *fftwf_alloc_complex(size_t n) { return (fftwf_complex *)calloc(n, sizeof(fftwf_complex)); }
float *fftwf_alloc_real(size_t n) { return (float *)calloc(n, sizeof(float)); }
void fftwf_free(void *p) { free(p); }

int fftwf_init_threads(void) { return 1; }
void fftwf_plan_with_nthreads(int n) { (void)n; }
void fftwf_cleanup_threads(void) {}
void fftwf_cleanup(void) {}
int fftwf_import_wisdom_from_filename(const char *f) { (void)f; return 0; }
int fftwf_export_wisdom_to_filename(const char *f) { (void)f; return 1; }
void fftwf_forget_wisdom(void) {}
void fftwf_set_timelimit(double t) { (void)t; }

/* Ancienne interface Fortran (plan rangé dans un entier 64 bits) */
void sfftw_plan_dft_1d_(long long *plan, int *n, fftwf_complex *in, fftwf_complex *out, int *sign, int *flags)
{ (void)flags; *plan = (long long)(size_t)mk(0, *n, in, out, *sign > 0); }
void sfftw_plan_dft_r2c_1d_(long long *plan, int *n, float *in, fftwf_complex *out, int *flags)
{ (void)flags; *plan = (long long)(size_t)mk(1, *n, in, out, 0); }
void sfftw_plan_dft_c2r_1d_(long long *plan, int *n, fftwf_complex *in, float *out, int *flags)
{ (void)flags; *plan = (long long)(size_t)mk(2, *n, in, out, 1); }
void sfftw_execute_(long long *plan) { fftwf_execute((fftwf_plan)(size_t)*plan); }
void sfftw_destroy_plan_(long long *plan) { fftwf_destroy_plan((fftwf_plan)(size_t)*plan); }
