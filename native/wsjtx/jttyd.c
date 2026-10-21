/*
 * jttyd.c — décodeur JTTY en continu pour le serveur Remote Station.
 *
 * Lit la BF du TRX sur l'entrée standard (entiers 16 bits, 12 kHz, mono, sans en-tête), la passe au
 * décodeur de réception JTTY de WSJT-X (jtty_rx_*, GPL v3) et écrit chaque mise à jour de message
 * sur la sortie standard, une ligne par mise à jour, champs séparés par des tabulations :
 *   U  id  fréquence(Hz)  snr(dB)  état  début(s)  dernier(s)  texte
 * « début » et « dernier » sont comptés en secondes depuis le premier échantillon reçu.
 * état : 0 = message en cours, autre = message terminé (fin de message, expiré, réception arrêtée).
 *
 *   jttyd [nsps=384] [fmin=200] [fmax=2800] [f0=1500] [ftol=1300]
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#ifdef _WIN32
#include <io.h>
#include <fcntl.h>
#endif

extern int jtty_rx_create(void);
extern void jtty_rx_begin(int h, int64_t session, int64_t grid_origin, int64_t first_search, int nsps);
extern int64_t jtty_rx_next_required_sample(int h);
extern int jtty_rx_process(int h, const int16_t *pcm, int count, int64_t first_sample, int64_t stop_sample,
                           int max_steps, int nfa, int nfb, float f0, float ftol);
extern int jtty_rx_take_updates(int h, int capacity, char *text, int64_t *ids, float *freqs, double *starts,
                                double *latest, int *terminals, int *snrs);

#define BUF (12000 * 180)  /* 3 minutes au plus en mémoire */
#define CAP 30

static int16_t buf[BUF];

int main(int argc, char **argv)
{
    int nsps = argc > 1 ? atoi(argv[1]) : 384;
    int nfa = argc > 2 ? atoi(argv[2]) : 200;
    int nfb = argc > 3 ? atoi(argv[3]) : 2800;
    float f0 = argc > 4 ? (float)atof(argv[4]) : 1500.0f;
    float ftol = argc > 5 ? (float)atof(argv[5]) : 1300.0f;
    int h = jtty_rx_create();
    if (h <= 0) { fprintf(stderr, "jttyd: contexte de réception indisponible\n"); return 1; }
    jtty_rx_begin(h, 1, 0, 0, nsps);
    int64_t base = 0; /* numéro absolu de buf[0] */
    int n = 0;
    static char text[CAP * 80];
    int64_t ids[CAP]; float fr[CAP]; double st[CAP], la[CAP]; int te[CAP], sn[CAP];
#ifdef _WIN32
    /* Windows : flux binaires (pas de conversion des fins de ligne ni arrêt sur l'octet 0x1A) */
    _setmode(_fileno(stdin), _O_BINARY);
    _setmode(_fileno(stdout), _O_BINARY);
#endif
    setvbuf(stdout, NULL, _IOLBF, 0);
    for (;;) {
        if (n > BUF - 2400) { /* sécurité : jamais atteint en temps normal */
            int drop = n - BUF / 2;
            memmove(buf, buf + drop, (size_t)(n - drop) * sizeof(int16_t));
            n -= drop; base += drop;
        }
        size_t got = fread(buf + n, sizeof(int16_t), 1200, stdin);
        if (got == 0) break;
        n += (int)got;
        for (;;) {
            /* On ne garde que ce dont le décodeur a encore besoin (re-balayages compris) */
            int64_t req = jtty_rx_next_required_sample(h);
            if (req > base) {
                int drop = (int)(req - base);
                if (drop > n) drop = n;
                memmove(buf, buf + drop, (size_t)(n - drop) * sizeof(int16_t));
                n -= drop; base += drop;
            }
            int r = jtty_rx_process(h, buf, n, base, base + n, 4, nfa, nfb, f0, ftol);
            if (r <= 0) break;
        }
        int c = jtty_rx_take_updates(h, CAP, text, ids, fr, st, la, te, sn);
        for (int i = 0; i < c; i++) {
            char m[81];
            memcpy(m, text + i * 80, 80);
            m[80] = 0;
            for (int k = 79; k >= 0 && (m[k] == ' ' || m[k] == 0); k--) m[k] = 0;
            for (char *p = m; *p; p++) if (*p == '\t' || *p == '\n' || *p == '\r') *p = ' ';
            printf("U\t%lld\t%.1f\t%d\t%d\t%.2f\t%.2f\t%s\n", (long long)ids[i], fr[i], sn[i], te[i], st[i], la[i], m);
            fflush(stdout); /* _IOLBF n'existe pas sous Windows (tampon complet) */
        }
    }
    return 0;
}
