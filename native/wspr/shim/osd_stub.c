/* osd_stub.c — wsprd peut appeler le décodeur OSD (Fortran) avec l'option -o ; non utilisé ici. */
void osdwspr_(float fsymbs[], unsigned char apmask[], int *ndepth, unsigned char cw[], int *nhardmin, float *dmin)
{
    (void)fsymbs; (void)apmask; (void)ndepth; (void)cw;
    *nhardmin = -1;
    *dmin = 0;
}
