/* glibc_compat.c — Linux x86-64 : fmod de l'ancienne glibc (GLIBC_2.2.5) au lieu de fmod@GLIBC_2.38,
 * pour que l'exécutable tourne aussi sur des serveurs plus anciens (Debian 12, Ubuntu 22.04…). */
#if defined(__linux__) && defined(__x86_64__)
__asm__(".symver fmod_old,fmod@GLIBC_2.2.5");
double fmod_old(double, double);
double __wrap_fmod(double x, double y) { return fmod_old(x, y); }
#endif
