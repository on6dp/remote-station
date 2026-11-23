/*
 * rade_v2_stub.c — fdvd n'utilise que RADE V1 : les poids des réseaux de RADE V2 (≈ 12 Mo, rade_enc_v2_data.c et
 * rade_dec_v2_data.c) sont remplacés par ces fonctions vides. rade_open() en V2 échouerait proprement (jamais demandé).
 */
#include <stddef.h>
#include "rade_enc_v2_data.h"
#include "rade_dec_v2_data.h"
const WeightArray radeencv2_arrays[] = { { NULL, 0, 0, NULL } };
const WeightArray radedecv2_arrays[] = { { NULL, 0, 0, NULL } };
int init_radeencv2(RADEEncV2 *model, const WeightArray *arrays) { (void)model; (void)arrays; return -1; }
int init_radedecv2(RADEDecV2 *model, const WeightArray *arrays) { (void)model; (void)arrays; return -1; }
