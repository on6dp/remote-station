/*
 * ftx_wasm.c — interface WebAssembly du décodeur FT8 / FT4 (ft8_lib de Kārlis Goba, licence MIT)
 * pour le serveur Remote Station. Compilé en lib/ftx.wasm par native/ftx/build.sh.
 *
 * Deux décodeurs (FT8 = 0, FT4 = 1) et un « moniteur d'affichage » qui produit les lignes de la cascade.
 * Les échantillons sont des float (-1..1) à 12 kHz, déposés dans ftx_buf() avant chaque appel.
 */
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <stdint.h>
#include <stdbool.h>
#include <math.h>

#include <ft8/decode.h>
#include <ft8/message.h>
#include <common/monitor.h>

#define EXPORT(name) __attribute__((export_name(#name)))

#define SAMPLE_RATE 12000
#define MAX_CAND 200
#define MAX_DEC 100
#define LDPC_ITER 25
#define MIN_SCORE 10

/* ------------------------------------------------------------------ table des indicatifs (messages hachés) */
#define HT_SIZE 512
static struct { char call[12]; uint32_t hash; } ht[HT_SIZE];

static void ht_cleanup(uint8_t max_age)
{
    for (int i = 0; i < HT_SIZE; ++i) {
        if (!ht[i].call[0]) continue;
        uint8_t age = (uint8_t)(ht[i].hash >> 24);
        if (age > max_age) { ht[i].call[0] = 0; ht[i].hash = 0; }
        else ht[i].hash = (((uint32_t)age + 1u) << 24) | (ht[i].hash & 0x3FFFFFu);
    }
}
static void ht_add(const char* call, uint32_t hash)
{
    uint16_t h10 = (hash >> 12) & 0x3FFu;
    int i = (h10 * 23) % HT_SIZE;
    for (int n = 0; n < HT_SIZE && ht[i].call[0]; ++n) {
        if (((ht[i].hash & 0x3FFFFFu) == hash) && !strcmp(ht[i].call, call)) { ht[i].hash &= 0x3FFFFFu; return; }
        i = (i + 1) % HT_SIZE;
    }
    strncpy(ht[i].call, call, 11);
    ht[i].call[11] = 0;
    ht[i].hash = hash;
}
static bool ht_lookup(ftx_callsign_hash_type_t type, uint32_t hash, char* call)
{
    uint8_t sh = (type == FTX_CALLSIGN_HASH_10_BITS) ? 12 : (type == FTX_CALLSIGN_HASH_12_BITS ? 10 : 0);
    uint16_t h10 = (hash >> (12 - sh)) & 0x3FFu;
    int i = (h10 * 23) % HT_SIZE;
    for (int n = 0; n < HT_SIZE && ht[i].call[0]; ++n) {
        if (((ht[i].hash & 0x3FFFFFu) >> sh) == hash) { strcpy(call, ht[i].call); return true; }
        i = (i + 1) % HT_SIZE;
    }
    call[0] = 0;
    return false;
}
static ftx_callsign_hash_interface_t hash_if = { .lookup_hash = ht_lookup, .save_hash = ht_add };

/* ------------------------------------------------------------------ moniteurs */
static monitor_t mon[3];      /* 0 = FT8, 1 = FT4, 2 = cascade (affichage) */
static bool mon_ok[3];
static float buf[4096];
static char out[MAX_DEC * 64];

EXPORT(ftx_buf) float* ftx_buf(void) { return buf; }
EXPORT(ftx_out) char* ftx_out(void) { return out; }

static void init_mon(int h)
{
    if (mon_ok[h]) return;
    monitor_config_t cfg = {
        .f_min = h == 2 ? 0 : 100,
        .f_max = h == 2 ? 3200 : 3100,
        .sample_rate = SAMPLE_RATE,
        .time_osr = h == 2 ? 1 : 2,
        .freq_osr = h == 2 ? 1 : 2,
        .protocol = h == 1 ? FTX_PROTOCOL_FT4 : FTX_PROTOCOL_FT8
    };
    monitor_init(&mon[h], &cfg);
    mon_ok[h] = true;
}

/** Nombre d'échantillons à fournir par appel à ftx_process (une durée de symbole). */
EXPORT(ftx_block) int ftx_block(int h) { init_mon(h); return mon[h].block_size; }
/** Nombre de blocs (symboles) d'une période complète. */
EXPORT(ftx_blocks) int ftx_blocks(int h) { init_mon(h); return mon[h].wf.max_blocks; }
EXPORT(ftx_reset) void ftx_reset(int h) { init_mon(h); monitor_reset(&mon[h]); }
EXPORT(ftx_process) void ftx_process(int h) { init_mon(h); monitor_process(&mon[h], buf); }

/**
 * Cascade : traite un bloc et copie la dernière ligne (dB*2+240, un octet par case de 6,25 Hz) dans out.
 * Renvoie le nombre de cases.
 */
EXPORT(ftx_wf_row) int ftx_wf_row(void)
{
    init_mon(2);
    monitor_t* m = &mon[2];
    if (m->wf.num_blocks >= m->wf.max_blocks) monitor_reset(m);
    monitor_process(m, buf);
    const uint8_t* row = m->wf.mag + (m->wf.num_blocks - 1) * m->wf.block_stride;
    int n = m->wf.num_bins;
    memcpy(out, row, n);
    return n;
}

/** Fréquence (Hz) de la première case de la cascade. */
EXPORT(ftx_wf_f0) float ftx_wf_f0(void) { init_mon(2); return mon[2].min_bin / mon[2].symbol_period; }

/**
 * Décode la période accumulée par ftx_process (h = 0 FT8, 1 FT4).
 * Résultat dans out : une ligne par message « score;temps_s;freq_hz;texte\n ». Renvoie le nombre de messages.
 */
EXPORT(ftx_decode) int ftx_decode(int h)
{
    init_mon(h);
    const monitor_t* m = &mon[h];
    const ftx_waterfall_t* wf = &m->wf;
    static ftx_candidate_t cand[MAX_CAND];
    static ftx_message_t dec[MAX_DEC];
    static ftx_message_t* dech[MAX_DEC];
    int nc = ftx_find_candidates(wf, MAX_CAND, cand, MIN_SCORE);
    for (int i = 0; i < MAX_DEC; ++i) dech[i] = NULL;
    int nd = 0;
    char* p = out;
    out[0] = 0;
    for (int k = 0; k < nc && nd < MAX_DEC - 1; ++k) {
        const ftx_candidate_t* c = &cand[k];
        ftx_message_t msg;
        ftx_decode_status_t st;
        if (!ftx_decode_candidate(wf, c, LDPC_ITER, &msg, &st)) continue;
        int i = msg.hash % MAX_DEC;
        bool dup = false;
        while (dech[i]) {
            if (dech[i]->hash == msg.hash && !memcmp(dech[i]->payload, msg.payload, sizeof(msg.payload))) { dup = true; break; }
            i = (i + 1) % MAX_DEC;
        }
        if (dup) continue;
        dec[i] = msg;
        dech[i] = &dec[i];
        ++nd;
        char text[FTX_MAX_MESSAGE_LENGTH];
        ftx_message_offsets_t offs;
        if (ftx_message_decode(&msg, &hash_if, text, &offs) != FTX_MESSAGE_RC_OK) continue;
        float f = (m->min_bin + c->freq_offset + (float)c->freq_sub / wf->freq_osr) / m->symbol_period;
        float t = (c->time_offset + (float)c->time_sub / wf->time_osr) * m->symbol_period;
        int room = (int)(sizeof(out) - (p - out));
        int w = snprintf(p, room, "%d;%.2f;%.1f;%s\n", c->score, t, f, text);
        if (w <= 0 || w >= room) break;
        p += w;
    }
    ht_cleanup(10);
    return nd;
}
