/*
 * ftx_enc.c — codeur FT8 / FT4 / FT2 en WebAssembly (ft8_lib de Kārlis Goba, licence MIT) pour Remote Station.
 * Compilé en public/js/ftx-enc.wasm par native/ftx/build.sh ; utilisé par la page Station (émission) et les essais.
 *
 *   enc_text()  : tampon où l'on écrit le message (ASCII, terminé par 0)
 *   enc_encode(mode, rate, f0) : mode 0 = FT8, 1 = FT4, 3 = FT2 ; rate = fréquence d'échantillonnage de sortie ;
 *                f0 = fréquence BF du ton 0 (Hz). Renvoie le nombre d'échantillons écrits dans enc_wave(), ou
 *                un nombre négatif si le message ne peut pas être codé.
 *   enc_tones() : les symboles (79 en FT8, 103 en FT4 / FT2) ; enc_ntones() leur nombre.
 *
 * FT2 (Decodium, IU8LMC) = mêmes symboles que FT4, à vitesse double (24 ms par symbole, 41,67 Hz entre tons).
 * Synthèse GFSK identique à WSJT-X / ft8_lib (BT 2 en FT8, 1 en FT4 / FT2, rampes d'1/8 de symbole).
 */
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <stdbool.h>
#include <math.h>

#include <ft8/encode.h>
#include <ft8/message.h>
#include <ft8/constants.h>

#define EXPORT(name) __attribute__((export_name(#name)))
#define MAX_WAVE (79 * 7680 + 16)        /* FT8 à 48 kHz : la plus longue forme d'onde (FT4 : 105 × 2304) */
#define GFSK_K 5.336446f                  /* pi * sqrt(2 / ln 2) */

static char text[64];
static uint8_t tones[128];
static int ntones;
static float wave[MAX_WAVE];
static float dphi[MAX_WAVE + 3 * 7680];
static float pulse[3 * 7680];

/* Indicatifs hachés (<F4ABC/P>…) : petite table, suffisante pour coder un message */
static struct { char call[12]; uint32_t n22; } ht[64];
static int ht_n;
static void save_hash(const char* call, uint32_t n22)
{
    for (int i = 0; i < ht_n; ++i) if (ht[i].n22 == n22) return;
    if (ht_n >= 64) ht_n = 0;
    strncpy(ht[ht_n].call, call, 11);
    ht[ht_n].call[11] = 0;
    ht[ht_n++].n22 = n22;
}
static bool lookup_hash(ftx_callsign_hash_type_t t, uint32_t h, char* call)
{
    int sh = t == FTX_CALLSIGN_HASH_10_BITS ? 12 : t == FTX_CALLSIGN_HASH_12_BITS ? 10 : 0;
    for (int i = 0; i < ht_n; ++i) if ((ht[i].n22 >> sh) == h) { strcpy(call, ht[i].call); return true; }
    call[0] = 0;
    return false;
}
static ftx_callsign_hash_interface_t hash_if = { .lookup_hash = lookup_hash, .save_hash = save_hash };

EXPORT(enc_text) char* enc_text(void) { return text; }
EXPORT(enc_wave) float* enc_wave(void) { return wave; }
EXPORT(enc_tones) uint8_t* enc_tones(void) { return tones; }
EXPORT(enc_ntones) int enc_ntones(void) { return ntones; }

static void synth(int n_sym, float f0, float bt, float period, int rate, int* n_out)
{
    int nsps = (int)(0.5f + rate * period);
    int n_wave = n_sym * nsps;
    float dphi_peak = 2.0f * (float)M_PI / nsps;
    for (int i = 0; i < n_wave + 2 * nsps; ++i) dphi[i] = 2.0f * (float)M_PI * f0 / rate;
    for (int i = 0; i < 3 * nsps; ++i) {
        float t = i / (float)nsps - 1.5f;
        pulse[i] = (erff(GFSK_K * bt * (t + 0.5f)) - erff(GFSK_K * bt * (t - 0.5f))) / 2;
    }
    for (int i = 0; i < n_sym; ++i)
        for (int j = 0; j < 3 * nsps; ++j) dphi[j + i * nsps] += dphi_peak * tones[i] * pulse[j];
    for (int j = 0; j < 2 * nsps; ++j) {
        dphi[j] += dphi_peak * pulse[j + nsps] * tones[0];
        dphi[j + n_sym * nsps] += dphi_peak * pulse[j] * tones[n_sym - 1];
    }
    double phi = 0;
    for (int k = 0; k < n_wave; ++k) {
        wave[k] = sinf((float)phi);
        phi = fmod(phi + dphi[k + nsps], 2 * M_PI);
    }
    int ramp = nsps / 8;
    for (int i = 0; i < ramp; ++i) {
        float env = (1 - cosf(2 * (float)M_PI * i / (2 * ramp))) / 2;
        wave[i] *= env;
        wave[n_wave - 1 - i] *= env;
    }
    *n_out = n_wave;
}

/* FT4 / FT2 comme gen_ft4wave de WSJT-X : 103 symboles entre deux symboles de rampe (montée / descente en cosinus) */
static void synth4(float f0, float period, int rate, int* n_out)
{
    const int nsym = 103;
    int nsps = (int)(0.5f + rate * period);
    int n_wave = (nsym + 2) * nsps;
    float dphi_peak = 2.0f * (float)M_PI / nsps;
    for (int i = 0; i < n_wave + nsps; ++i) dphi[i] = 0;
    for (int i = 0; i < 3 * nsps; ++i) {
        float t = i / (float)nsps - 1.5f;
        pulse[i] = (erff(GFSK_K * 1.0f * (t + 0.5f)) - erff(GFSK_K * 1.0f * (t - 0.5f))) / 2;
    }
    for (int j = 0; j < nsym; ++j)                     /* tones[1..103] : symboles de données et de synchro */
        for (int i = 0; i < 3 * nsps; ++i) dphi[j * nsps + i] += dphi_peak * pulse[i] * tones[j + 1];
    double phi = 0;
    for (int k = 0; k < n_wave; ++k) {
        wave[k] = sinf((float)phi);
        phi = fmod(phi + dphi[k] + 2.0 * M_PI * f0 / rate, 2 * M_PI);
    }
    for (int i = 0; i < nsps; ++i) {
        wave[i] *= (1.0f - cosf(2 * (float)M_PI * i / (2.0f * nsps))) / 2;
        wave[(nsym + 1) * nsps + i] *= (1.0f + cosf(2 * (float)M_PI * i / (2.0f * nsps))) / 2;
    }
    *n_out = n_wave;
}

EXPORT(enc_encode) int enc_encode(int mode, int rate, float f0)
{
    if (rate < 4000 || rate > 48000) return -2;
    text[sizeof(text) - 1] = 0;
    ftx_message_t msg;
    ftx_message_rc_t rc = ftx_message_encode(&msg, &hash_if, text);
    if (rc != FTX_MESSAGE_RC_OK) return -1;
    int n = 0;
    if (mode == 0) {
        ft8_encode(msg.payload, tones);
        ntones = FT8_NN;
        synth(FT8_NN, f0, 2.0f, FT8_SYMBOL_PERIOD, rate, &n);
    } else {
        ft4_encode(msg.payload, tones);
        ntones = FT4_NN;
        synth4(f0, mode == 3 ? FT4_SYMBOL_PERIOD / 2 : FT4_SYMBOL_PERIOD, rate, &n);
    }
    /* Texte effectivement codé (relu depuis la charge utile, comme « Tx » dans WSJT-X) */
    ftx_message_offsets_t offs;
    char back[FTX_MAX_MESSAGE_LENGTH];
    if (ftx_message_decode(&msg, &hash_if, back, &offs) == FTX_MESSAGE_RC_OK) { strncpy(text, back, sizeof(text) - 1); }
    return n;
}
