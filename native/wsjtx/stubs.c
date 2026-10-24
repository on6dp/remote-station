/* stubs.c — fonctions de l'application WSJT-X inutiles hors de son interface (suivi IPC, ThreadSanitizer) */
void decoder_ipc_progress_report(int g) { (void)g; }
#define T(n) void wsjt_tsan_acquire_##n(void) {} void wsjt_tsan_release_##n(void) {}
T(four2avar_setup) T(ft8_find_dupes) T(ft8_mtd) T(ft8_update_structures)
