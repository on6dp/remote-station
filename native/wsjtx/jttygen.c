/*
 * jttygen.c — fabrique le signal JTTY d'un message pour le serveur Remote Station (émission JTTY).
 *
 * Appelle le codeur de WSJT-X 3.3 (genjtty_profile, gen_jttywave : lib/jtty/*.f90, GPL v3), comme
 * WSJT-X lui-même (widgets/mainwindow_jtty.cpp) : 4-GFSK à 31,25 bauds, BT 2, trames de 59 symboles.
 * Écrit le signal sur la sortie standard en entiers 16 bits signés, 12 kHz, mono, sans en-tête.
 *
 *   jttygen <f0 en Hz> <message>        (message : 80 caractères au plus, majuscules)
 *
 * Code de sortie : 0 = signal écrit ; 2 = message impossible à coder ; 1 = arguments invalides.
 * Sur la sortie d'erreur : « nsym <n> » (nombre de symboles).
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#ifdef _WIN32
#include <io.h>
#include <fcntl.h>
#endif

extern void genjtty_profile_(char *msg, int const *exchange_profile, int itone[], int *nsym, int frame_starts[],
                             int const *is_final, size_t len);
extern void gen_jttywave_(int itone[], int *nsym, int *nsps, float *bt, float *fsample, float *f0,
                          float xjunk[], float wave[], int *icmplx, int *nwave);

#define MAXSYM (59 * 16)

int main(int argc, char **argv)
{
    if (argc < 3) { fprintf(stderr, "usage : jttygen f0 message\n"); return 1; }
    float f0 = (float)atof(argv[1]);
    if (!(f0 >= 100.0f && f0 <= 3000.0f)) { fprintf(stderr, "f0 hors plage\n"); return 1; }
    char msg[81];
    memset(msg, ' ', 80);
    msg[80] = 0;
    size_t n = strlen(argv[2]);
    if (n > 80) n = 80;
    memcpy(msg, argv[2], n);

    int itone[MAXSYM];
    int nsym = 0;
    int frame_starts[16] = {0};
    int const profile = 0;   /* JTTY_EXCHANGE_UNKNOWN */
    int const is_final = 1;  /* fin de message (EOM) sur la dernière trame */
    genjtty_profile_(msg, &profile, itone, &nsym, frame_starts, &is_final, 80);
    fprintf(stderr, "nsym %d\n", nsym);
    if (nsym <= 0 || nsym > MAXSYM) return 2;

    int nsps = 384;            /* 12 000 / 384 = 31,25 bauds */
    float bt = 2.0f, fs = 12000.0f;
    int icmplx = 0;
    int nwave = nsps * nsym;
    float *wave = (float *)calloc((size_t)nwave + 1, sizeof(float));
    if (!wave) return 1;
    gen_jttywave_(itone, &nsym, &nsps, &bt, &fs, &f0, wave, wave, &icmplx, &nwave);

#ifdef _WIN32
    _setmode(_fileno(stdout), _O_BINARY);
#endif
    int16_t *out = (int16_t *)malloc((size_t)nwave * sizeof(int16_t));
    if (!out) return 1;
    for (int i = 0; i < nwave; i++) {
        float v = wave[i] * 32767.0f;
        if (v > 32767.0f) v = 32767.0f;
        if (v < -32768.0f) v = -32768.0f;
        out[i] = (int16_t)(v < 0 ? v - 0.5f : v + 0.5f);
    }
    fwrite(out, sizeof(int16_t), (size_t)nwave, stdout);
    fflush(stdout);
    return 0;
}
