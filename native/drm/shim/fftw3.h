// fftw3.h — remplacement minimal de FFTW pour le cœur DRM de QSSTV : transformées de Fourier de toute taille
// (Cooley-Tukey à base mixte, facteur premier résiduel en DFT directe), simple et double précision, r2r R2HC / HC2R.
#ifndef RS_DRM_FFTW3_SHIM_H
#define RS_DRM_FFTW3_SHIM_H
#include <complex>
#include <vector>
#include <cmath>
#include <cstdlib>
#define FFTW_FORWARD (-1)
#define FFTW_BACKWARD (+1)
#define FFTW_ESTIMATE 0U
#define FFTW_MEASURE 0U
#define FFTW_PATIENT 0U
#define FFTW_R2HC 0
#define FFTW_HC2R 1
typedef double fftw_complex[2];
typedef float fftwf_complex[2];
typedef int fftw_r2r_kind;
namespace rsfft {
template <class T> struct Engine {
  int n; int sign; std::vector<std::complex<T>> tw, tmp;
  void init(int n_, int s) { n = n_; sign = s; tw.resize(n); for (int k = 0; k < n; k++) { double a = 2 * M_PI * k / n * (s < 0 ? -1 : 1); tw[k] = std::complex<T>((T)cos(a), (T)sin(a)); } tmp.resize(n); }
  // x[k*stride] pour k < m, sortie y[0..m-1]
  void rec(const std::complex<T> *x, int stride, std::complex<T> *y, int m) {
    if (m == 1) { y[0] = x[0]; return; }
    int p = 2; while (p * p <= m && m % p) p++; if (m % p) p = m;
    int q = m / p;
    if (p == m) { // DFT directe (premier)
      int step = n / m;
      for (int k = 0; k < m; k++) { std::complex<T> s(0, 0); for (int j = 0; j < m; j++) s += x[j * stride] * tw[(size_t)((long long)j * k % m) * step]; y[k] = s; }
      return;
    }
    std::vector<std::complex<T>> sub(m);
    for (int r = 0; r < p; r++) rec(x + r * stride, stride * p, sub.data() + r * q, q);
    int step = n / m;
    for (int k = 0; k < q; k++) for (int s = 0; s < p; s++) {
      std::complex<T> acc(0, 0);
      int kk = k + s * q;
      for (int r = 0; r < p; r++) acc += sub[r * q + k] * tw[(size_t)((long long)r * kk % m) * step];
      y[kk] = acc;
    }
  }
  void run(const std::complex<T> *in, std::complex<T> *out) { rec(in, 1, tmp.data(), n); for (int i = 0; i < n; i++) out[i] = tmp[i]; }
};
template <class T> struct Plan { int kind; int n; void *in, *out; Engine<T> e; };
}
typedef rsfft::Plan<double> *fftw_plan;
typedef rsfft::Plan<float> *fftwf_plan;
inline fftw_plan fftw_plan_dft_1d(int n, fftw_complex *in, fftw_complex *out, int sign, unsigned) { auto p = new rsfft::Plan<double>; p->kind = 9; p->n = n; p->in = in; p->out = out; p->e.init(n, sign); return p; }
inline fftwf_plan fftwf_plan_dft_1d(int n, fftwf_complex *in, fftwf_complex *out, int sign, unsigned) { auto p = new rsfft::Plan<float>; p->kind = 9; p->n = n; p->in = in; p->out = out; p->e.init(n, sign); return p; }
inline fftw_plan fftw_plan_r2r_1d(int n, double *in, double *out, fftw_r2r_kind kind, unsigned) { auto p = new rsfft::Plan<double>; p->kind = kind; p->n = n; p->in = in; p->out = out; p->e.init(n, kind == FFTW_R2HC ? -1 : 1); return p; }
template <class T> inline void rs_exec(rsfft::Plan<T> *p) {
  int n = p->n;
  std::vector<std::complex<T>> a(n), b(n);
  if (p->kind == 9) {
    T *i = (T *)p->in; for (int k = 0; k < n; k++) a[k] = std::complex<T>(i[2 * k], i[2 * k + 1]);
    p->e.run(a.data(), b.data());
    T *o = (T *)p->out; for (int k = 0; k < n; k++) { o[2 * k] = b[k].real(); o[2 * k + 1] = b[k].imag(); }
  } else if (p->kind == FFTW_R2HC) {
    T *i = (T *)p->in; for (int k = 0; k < n; k++) a[k] = std::complex<T>(i[k], 0);
    p->e.run(a.data(), b.data());
    T *o = (T *)p->out; o[0] = b[0].real(); for (int k = 1; k <= n / 2; k++) o[k] = b[k].real(); for (int k = 1; k < (n + 1) / 2; k++) o[n - k] = b[k].imag();
  } else { // HC2R
    T *i = (T *)p->in; a[0] = std::complex<T>(i[0], 0);
    for (int k = 1; k < (n + 1) / 2; k++) { a[k] = std::complex<T>(i[k], i[n - k]); a[n - k] = std::conj(a[k]); }
    if (n % 2 == 0) a[n / 2] = std::complex<T>(i[n / 2], 0);
    p->e.run(a.data(), b.data());
    T *o = (T *)p->out; for (int k = 0; k < n; k++) o[k] = b[k].real();
  }
}
inline void fftw_execute(const fftw_plan p) { rs_exec(p); }
inline void fftwf_execute(const fftwf_plan p) { rs_exec(p); }
inline void fftw_destroy_plan(fftw_plan p) { delete p; }
inline void fftwf_destroy_plan(fftwf_plan p) { delete p; }
inline void *fftw_malloc(size_t n) { return calloc(1, n ? n : 1); }
inline void fftw_free(void *p) { free(p); }
inline void *fftwf_malloc(size_t n) { return calloc(1, n ? n : 1); }
inline void fftwf_free(void *p) { free(p); }
#endif
