<!-- Fichier produit par native/manual2md.js à partir de public/help.html : modifier la page HTML, puis relancer le script. -->

# Remote Station UBA-LGE — user manual

*Online version: **HELP** button on the dashboard or https://remote.op0p.be/help — [version française](MANUEL.md)*

- [1. Before you start](#intro)
- [2. Short glossary](#lexique)
- [3. Logging in](#connexion)
- [4. Guided first steps](#premiers)
   - [4.1 Listening to a band](#p-ecoute)
   - [4.2 A phone QSO (SSB)](#p-phonie)
   - [4.3 An FT8 QSO](#p-ft8)
   - [4.4 Logging the QSO](#p-log)
- [5. The screen at a glance](#ecran)
- [6. Taking and handing over control](#main)
- [7. Operating the TRX](#trx)
   - [7.1 The VFO displays](#vfo)
   - [7.2 Step row and bands](#step)
   - [7.3 Left column](#gauche)
   - [7.4 Right column](#droite)
   - [7.5 Operating SPLIT](#split)
- [8. Listening](#ecoute)
- [9. Transmitting and safety](#emission)
- [10. Operators and chat](#operateurs)
- [11. Layout and separate windows](#disposition)
- [12. Digital modes](#numeriques)
   - [12.1 FT8 · FT4 · FT2](#ft8)
   - [12.2 JT65](#jt65)
   - [12.3 RTTY](#rtty)
   - [12.4 WSPR](#wspr)
   - [12.5 JTTY](#jtty)
   - [12.6 CW](#cw)
   - [12.7 SSTV](#sstv)
   - [12.8 Synchro](#synchro)
   - [12.9 QO-100](#qo100)
- [13. Correspondent, macros and tags](#messages)
- [14. Logs (station logbook)](#logs)
   - [14.1 Logging a QSO](#l-fiche)
   - [14.2 The QSO list](#l-liste)
   - [14.3 Exporting](#l-export)
   - [14.4 Synchronisation (LoTW, eQSL, Club Log, QRZ)](#l-sync)
   - [14.5 Configuration](#l-config)
- [15. Keyboard shortcuts](#clavier)
- [16. Common problems](#problemes)
- [17. For administrators](#admin)
- [18. The club PC (Station page)](#club)

> [!NOTE]
> The dashboard runs in **Google Chrome** or **Microsoft Edge**, on a PC, Mac, tablet or phone. It is designed for a **1920 × 1080** screen or larger; on a smaller screen, the panels stack one below the other. The interface is in French: button and field names are quoted below as they appear on screen, with an English translation. After a server update, press `Ctrl` + `F5` to reload the page.

<a id="intro"></a>
## 1. Before you start

The **Remote Station** lets members of the UBA-LGE section use the **club transceiver (TRX)** from home, with nothing more than a web browser. The TRX (a Yaesu FTX-1 with its SPA-1 amplifier, or depending on the setup an FTDX10, an FTDX101D / MP or an IC-7300) is at the club, connected to a PC. That PC is linked over the internet to the server **remote.op0p.be**, and that server is what you open in your browser.

1. You click a button on the dashboard (for example "20M").
2. The server passes the command on to the club PC.
3. The club PC sends the command to the TRX over its USB cable (the "CAT link").
4. The TRX changes band, and every connected member sees the new frequency.

The receiver audio travels the other way: it arrives in your browser, and the digital modes (FT8, RTTY, CW…) are decoded on the server.

> [!TIP]
> **The golden rules**
> - **Only one person operates** the TRX at a time: the one who "has control". Everybody else watches and listens.
> - **Everything you set acts on the real club TRX**, for everybody. If you are not sure about a setting, leave it as it is.
> - After a band change, always do a `TUNE` before transmitting (antenna tuning).
> - Respect your licence: authorised bands and power. The server checks this anyway.
> - When you leave, **release control** and switch SPLIT off if you used it.

<a id="lexique"></a>
## 2. Short glossary

Words that come up often in this manual and on the screen.

| Word | Meaning |
|---|---|
| TRX | Transceiver: the club's transmitter-receiver. |
| Having control (« avoir la main ») | Being the operator who is driving the TRX right now. Without control you can watch and listen, but not change settings or transmit. |
| VFO | The "tuning knob" of the TRX. There are two, **A** and **B** (on the FTX-1: **MAIN** and **SUB**), each with its own frequency and mode. |
| MAIN / SUB | The two receivers of the FTX-1. MAIN corresponds to VFO A, SUB to VFO B. The "active side" is the one you listen to and adjust. |
| PTT | Push To Talk: the button that keys the TRX into transmit for as long as you hold it. |
| CAT | The USB cable link between the club PC and the TRX, used to control it. |
| BF (AF) | Audio frequency ("basse fréquence" in French): the sound coming out of the receiver (what you hear, and what the decoder analyses). |
| Mode | The way of transmitting: **LSB / USB** (SSB, phone on HF), **CW** (Morse), **AM**, **FM**, **DATA-U** (digital modes through the TRX sound card), **RTTY**… |
| SSB (BLU) | Single sideband ("BLU" in French): phone on HF. LSB below 10 MHz, USB above. |
| Band | A frequency range: 80 m, 40 m, 20 m… (the smaller the number, the higher the frequency). |
| SWR (ROS) | Standing wave ratio ("ROS" in French): shows whether the antenna is properly matched. 1.0 is perfect, up to 1.5 is very good, above 2.5 transmission is cut. |
| TUNE / tuner | The tuner (antenna tuning unit) matches the antenna to the frequency. TUNE starts the tuning: the TRX sends a carrier for a few seconds. |
| ALC | Indicator showing whether the transmitter is being "driven" too hard. In digital modes, ALC must stay very low. |
| S-meter | Shows the strength of the received signal, from S1 (very weak) to S9, then S9+10, +20… dB (very strong). |
| Filter / BW | Width of the listening "window". Narrower = less noise and fewer neighbouring stations, but you must be tuned accurately. |
| SPLIT | Listening on one frequency and transmitting on another (for DX expeditions). |
| RIT / XIT | A small offset of the receive frequency (RIT) or transmit frequency (XIT), without touching the VFO. |
| Waterfall (« cascade ») | The scrolling picture in the digital-mode tabs: each coloured trace is a signal; the brighter or redder it is, the stronger. |
| QSO | A radio contact between two stations. |
| Correspondent (« Correspondant ») | The station you are making the QSO with (DX for short). |
| Report / RST | The signal report exchanged: **59** or **599** in phone / CW / RTTY, a number of **dB** (−15, +03…) in FT8. |
| Locator | Position as a Maidenhead grid square (e.g. JO20 for the Liège area). |
| TX call | The callsign under which digital transmissions go out and under which the QSO is logged: the club's (ON5VL, OR0L) or your own. |
| UTC | Universal time, used in radio (Belgian time − 1 h in winter, − 2 h in summer). |
| ADIF | Standard file format for exchanging QSOs between logging programs (.adi). |
| LoTW, eQSL, Club Log, QRZ | Websites to which you upload your QSOs to get confirmations (electronic QSLs) and awards. |
| DXCC | The official list of amateur-radio "countries" (entities). The prefix (ON, F, DL…) tells you the country of a callsign. |

<a id="connexion"></a>
## 3. Logging in

1. Open [https://remote.op0p.be](https://remote.op0p.be) in Chrome or Edge.
2. Enter **your callsign** and **your password** (given by a club administrator), then click `Se connecter` (log in).
3. The browser stays logged in for **7 days**: when you reload the page, you go straight back to the dashboard.
4. `Déconnexion` (log out, top right) ends the session and forgets the browser: do this on a PC that is not yours.

- **Listener** callsigns (ONL…) can see and hear everything, but cannot transmit or change the power.
- After **15 minutes without any action**, you are logged out. A warning appears one minute before, with a `Rester connecté` (stay logged in) button. This never happens during a transmission.
- The `HELP` button at the top right opens this manual in a new tab.

<a id="premiers"></a>
## 4. Guided first steps

Four "recipes" to get started. Each button is described in detail further on (sections 7 to 14).

<a id="p-ecoute"></a>
### 4.1 Listening to a band

1. On the right, **RX audio** panel: click `🔊 Écouter le TRX` (listen to the TRX). Set the **Volume** slider just below (it only affects you).
2. To change band or frequency you must **have control**: click `Prendre la main` (take control) at the top (if nobody has it).
3. Click a band, for example `40M`, in the band row below the VFOs.
4. Choose the mode in the **Mode** panel on the left: `LSB` for phone on 40 m, `USB` on 20 m and above.
5. Tune the frequency: put the mouse over the digits of **VFO A** and use the **mouse wheel**. Each digit is set separately; the digit under the mouse goes up or down.
6. A station too strong? Lower the **RF GAIN** (RF front end panel) or switch `ATT` on. Lots of noise? Try `DNR` (noise reduction).

<a id="p-phonie"></a>
### 4.2 A phone QSO (SSB)

The dashboard does not yet send your microphone to the TRX: phone operation is done at the club or by another means arranged by the station managers. The dashboard is then used to set up and monitor the station. If phone transmission is available from your home, proceed as follows:

1. Take control, choose the band and the mode (LSB / USB).
2. **Accord** (tuner) panel on the right: click `TUNE` and wait for the tuning to finish. Look at the **SWR** in **Station meters** (bottom left): it should be below about 1.5.
3. Check the **power** in the TX panel (`−` `+` buttons).
4. Listen to make sure the frequency is clear, then hold `PTT` (or the `Space` bar) to talk; release it to listen.

> [!NOTE]
> Check with a club manager how phone modulation is set up before your first attempt.

<a id="p-ft8"></a>
### 4.3 An FT8 QSO

FT8 is the easiest mode to use remotely: everything is done with the mouse and the dashboard handles the sequence just like WSJT-X.

1. Take control. In the **Correspondant** (correspondent) line at the bottom, choose the **TX call**: the club callsign (ON5VL) or your own.
2. `FT8 · FT4 · FT2` tab in the centre, `FT8` button, then choose a band in the frequency list (e.g. "14.074 · 20m"). The TRX goes there by itself, in DATA-U.
3. Do a `TUNE` (Accord panel), then set a reasonable power (20 to 40 W is plenty for FT8).
4. Wait one or two 15 s periods: the stations heard appear in **Activité de bande** (band activity). **CQ** calls are in green.
5. **To answer a CQ**: click the station's **callsign** (dotted underline) or double-click its line. The TRX sends your call at the start of the next period.
6. Let it run: the **sequence advances by itself** (report, R-report, RR73, 73). The bar below the lists is red while transmitting, green while receiving.
7. As soon as the correspondent sends RR73, the **« Enregistrer le QSO »** (log the QSO) form opens already filled in: check it and save.
8. To call CQ yourself: click `Tx6` (CQ). Tick **Répondre au 1er** (answer the first) so that the first station to answer is taken automatically.
9. To stop everything: `■ Arrêter` (stop) (or the `Space` bar).

<a id="p-log"></a>
### 4.4 Logging the QSO

1. After a digital QSO, the form opens by itself (FT8) or with the `Log QSO` button (RTTY, JTTY, CW; also on the tab row, right of Logs).
2. For a phone QSO: `LOGS` tab, type the callsign (the UTC time fills in by itself), click `⇩ TRX` (take from the TRX) to copy the frequency and mode, then complete the reports.
3. `Enregistrer le QSO` (save the QSO) (or `Enter`). The QSO appears in the list. Under the club callsign, it is also uploaded to the online logbooks if the administrators have set that up.
4. To get your QSOs into your own logging program: **Exporter ▾ → Mes QSO (.adi)** (Export → My QSOs).

<a id="ecran"></a>
## 5. The screen at a glance

### Top bar

| Item | What it is | What it does |
|---|---|---|
| `● Serveur` | Link lamp between your browser and the server. | Green = connected. Red or grey: check your internet connection; the page reconnects by itself. |
| `● Station` | Lamp of the Station page on the club PC. | Green = the club PC is online. For administrators, a click opens the TRX menu (section 17). |
| `● FTX-1 FTDX10 FTDX101D / MP IC-7300` | The club transceivers; the one in use is highlighted. | Green = the TRX answers over CAT; red = the TRX is transmitting. |
| Title in the centre | Callsign and name of the station. | — |
| `👥 n` | Number of members online. | Opens the **Opérateurs** (operators) panel: who is there, who has control, chat (section 10). A red dot means a new message. |
| Your callsign | The account you are logged in with. | — |
| `Prendre la main` / `Libérer la main` | Control button (take control / release control). | You become the operator, or you give control back (section 6). |
| `<-> DX Cluster ▾` | Links the TRX to one of the club's DX clusters (top bar, between « Prendre la main » and the size menu). | Click: choose **dx.op0p.be** (Ultimate Cluster) or **cluster.op0p.be** (CC-Cluster OP0P), opened in its own window (put it on the 2nd screen); if already open, its window comes to the front. Green <-> = a cluster in this browser is linked and you have control (« ● relié » in the menu); **orange** = cluster open but you do not have control (« ● ouvert, prenez la main »): take control to link it; red = no cluster open. One way only: the link is opened from the dashboard (logged-in member); from the cluster page nothing opens or drives the dashboard on its own. |
| Click on a spot of dx.op0p.be / cluster.op0p.be | The TRX tunes to the station. | Open the cluster in another window (2nd screen) **of the same browser** as the dashboard. Click a spot: FT8 / FT4 / FT2, JT65, JTTY, WSPR → the mode's tab opens, VFO A goes to the calling frequency and receive onto the signal; RTTY → RTTY tab, transmit decoder on the signal; CW → CW tab, VFO on the station (CW-L below 10 MHz, CW-U above); phone (SSB, AM, FM) → chosen VFO (A or B) and mode (LSB below 10 MHz, USB above). The callsign goes into Correspondant. You must have control; refused while transmitting. The cluster site must be allowed (`qsyOrigins` in config.json) and served over https. A **Remote Station <-> DX Cluster** badge (shown only to members already logged in to the dashboard in this browser), at the top of the Alert / Show Only / Hide column on dx.op0p.be, bottom right elsewhere (or inside an element `id="rs-qsy-badge"` of the page): green <-> = dashboard open with control, **orange** = dashboard open without control, red = no dashboard; after a click it says « TRX calé sur le spot » (TRX tuned) or what is missing. |
| `Auto 100 %` | Dashboard size. | **Auto** (recommended): the dashboard is designed for a 1920 × 1080 screen; on a larger screen it is enlarged in the same proportion to fill the screen, without moving anything (2560 × 1440: about 130 %; 4K 3840 × 2160: 200 %). The **height** decides: a very wide screen only 1080 high (2560 × 1080) stays at 100 %, the extra width widens the waterfall and windows. The top of the menu shows the PC's screen and the size chosen by Auto. If Windows already enlarges the display (Settings › Display › Scale, often 125 % or 150 % on a 2560 × 1440 or 4K screen), Auto takes it into account and only adds the rest: 125 % × 105 % ≈ 131 %, the same size as a 2560 × 1440 screen at 100 % with Auto at 133 %. The menu also lets you choose the size yourself, from **50 % to 200 %**: below 100 % everything is smaller and you see more (useful on a laptop); sizes larger than the screen (in grey) are still allowed, but the layout gets tighter and some columns scroll. Setting kept in this browser. On a screen smaller than 1920, the layout already adapts by itself; Chrome's `Ctrl` + `−` can help. |
| `HELP` | The manual. | Opens this page (French or English depending on your browser). |
| `Déconnexion` | End of session (log out). | Ends the session and forgets this browser. |

### The screen areas

1. **Left column**: Antenne (antenna), RF front end (receive), Mode, Filtres (filters), Station meters (measurements).
2. **Centre, top**: the two VFO displays (A / MAIN and B / SUB), the **Step** row (tuning step, VFO choice, SPLIT…) and the **band** row.
3. **Centre, bottom**: « Activité et modes numériques » (activity and digital modes): tabs Activité, FT8 · FT4 · FT2, RTTY, WSPR, JT65, JTTY, CW, SSTV, Synchro and Logs.
4. **Right column**: RX audio (listening), DSP (noise reduction), Accord (tuner), TX (PTT and power).
5. Under the tabs: the **Correspondant** line (the station worked, its reports and the TX call). `Log QSO` is on the tab row, right of Logs, followed by `👁 Suivre` (follow the operator). On the right, the **band map** (DX cluster spots), in every mode tab except SSTV.

- **Fold a panel**: click its title (for example "DSP"); a second click opens it again. Your choice is remembered.
- **Separate window**: the `⧉` button of a panel opens it in its own window (section 11).
- Below the band row, a message line shows confirmations and refusals (« Prenez la main… » (take control…), « PTT refusé : … » (PTT refused)).

<a id="main"></a>
## 6. Taking and handing over control

- Only one person **has control** (operates the TRX); everybody sees and hears the same thing.
- `Prendre la main` (take control, top bar): possible if nobody has it. The button then becomes `Libérer la main` (release control).
- If someone already has it: open the `👥` panel and click `Demander la main à …` (request control from …). The operator receives the request (their panel opens) and can click `Passer la main à …` (hand control to …). You can also send them a message in the chat.
- **When you leave**, click `Libérer la main`. With no action for **15 minutes**, control is released automatically.
- The top-bar button shows `Main occupée` (control taken) when someone else has it, and `Prendre la main ici` (take control here) if you already have it in another tab or another browser. An administrator sees `Reprendre la main` (take back control): they can take it back if needed, after confirmation.
- Without control, the commands are greyed out and a message reminds you « Prenez la main » (take control).
- **Following the operator** (for remote training): `👁 Suivre` (follow) button just after the digital-mode tabs. When on (green), your screen shows the same tab as the operator in control (RTTY, FT8, CW…) and changes along with them. Clicking another tab yourself stops following; a click on `👁 Suivre` starts it again. This button is not shown to the operator in control.

<a id="trx"></a>
## 7. Operating the TRX

All the commands in this section require **having control**, except listening and the volume. They act on the real club TRX and everybody sees the result. Some exist on only one TRX: they are greyed out or absent on the others. When a button is lit (coloured), the function is on; a click switches it off.

<a id="vfo"></a>
### 7.1 The VFO displays

At the top centre, two displays: **VFO A (MAIN)** on the left and **VFO B (SUB)** on the right. They look like the display of the TRX.

| Item | What it shows | What a click (or the mouse wheel) does |
|---|---|---|
| `RX` | Green: this is the VFO being listened to. | Click: this VFO becomes the receive VFO (like the MAIN / SUB key of the TRX; not on the IC-7300). |
| `TX` | Dark red: a transmission would go out on this VFO. Bright red with a glow: transmitting. | Click on the TX of the other VFO: SPLIT (listen on one VFO and transmit on the other, section 7.5). Click on the TX of the VFO being listened to: SPLIT off. |
| `BW 2.4K` | Receive filter width of this VFO. | **Mouse wheel** over it: widen or narrow the filter. |
| « Émission sur A / B » | Orange reminder of the VFO a transmission would go out on (« transmit on A / B »). | — |
| MAIN / SUB · 20M | Side of the TRX and band of this VFO. | — |
| S-meter (S1 … +60) | Received signal strength. Greyed out on the VFO not being listened to. | — (when transmitting, look at Station meters). |
| Frequency digits | The frequency in MHz. Red while transmitting; greyed out if this VFO is used neither to receive nor to transmit. | **Mouse wheel** or **drag** up / down on a digit: that digit goes up or down (MHz, kHz, hundreds of Hz…). **Click** the display: this VFO becomes the one tuned by the ◀ ▶ arrows and the band keys (its letter is underlined). |
| Mode (USB, DATA-U…) | The mode of this VFO. | It is changed in the **Mode** panel on the left. |
| `RIT` | Offset of the receive frequency only. | Click: on / off. **Mouse wheel** over the displayed value (+0.00 kHz): ± 10 Hz, ± 100 Hz with `Shift`. Useful if the correspondent drifts a little. |
| `XIT` | Offset of the transmit frequency only. | Click: on / off. Mouse wheel over the value: as for RIT. Useful for a small split of a few kHz. |
| `CLEAR` | — | Resets the RIT / XIT offset to zero. |
| `ATT` | Input attenuator. | Click: on / off. For a very strong local station or an overloaded band (the noise drops too). Greyed out on 2 m / 70 cm. On the FTDX10: OFF, 6, 12 or 18 dB. |
| `IPO` / `AMP1` / `AMP2` | Preamplifier (HF and 6 m). IPO = no preamp. | Each click moves to the next one. AMP1 / AMP2 help on quiet high bands (15, 10, 6 m); on 80 / 40 m, IPO is usually enough. |
| `AMP` | Preamp on 2 m / 70 cm. | Click: on / off. |
| `NB` | Noise blanker: suppresses impulse noise (engines, electric fences). | Click: on / off (the level is set in the DSP panel). |
| `DNR` | Digital noise reduction (hiss). | Click: on / off; level in the DSP panel. |
| `NOTCH` | Manual filter that cuts out one frequency (a whistle). | Click: on / off; its frequency is set in the DSP panel. |
| `DNF` | Automatic notch: removes whistling carriers by itself. | Click: on / off. Avoid it in CW and digital modes (it can remove the wanted signal). |
| `NAR` | Narrow filter (NARROW). When on, the TRX imposes its narrow width: the BW slider of the Filters box is greyed and shows « NARROW ✕ ». | Click: on / off. Clicking « NARROW ✕ » in the Filters box also turns it off and gives the BW slider back. |
| `AGC AUTO` | Reminder of the AGC setting. | It is changed in RF front end. |

> [!TIP]
> **FTX-1: the two sides, MAIN and SUB**
> - The VFO B display sets NB, DNR, NOTCH, DNF and NAR of the SUB side.
> - ATT and preamp belong to each side, but the TRX only reports them for the active side: a click on those of the other VFO switches the TRX to that side for 2 to 3 s, without transmitting, then back. As long as they have never been read, they show "?".
> - The RF front end, Filtres and DSP panels set the **active side**: their title shows « A · MAIN » or « B · SUB ».

<a id="step"></a>
### 7.2 Step row and band row

Below the VFO displays.

| Command | What it does | When to use it |
|---|---|---|
| `1 Hz` … `100 kHz` (Step) | Chooses the step of the ◀ ▶ arrows and of the keyboard arrows `↑` `↓`. | 100 Hz to 1 kHz to search in SSB; 10 Hz for fine tuning, 1 Hz for the finest (RTTY, digital modes, CW zero beat); 10 to 100 kHz to move across a band. |
| `A` / `B` (VFO) | Chooses the VFO tuned by the arrows and the band keys. On the FTX-1, also switches the TRX to that side (like MAIN / SUB). | To work on VFO B. |
| `◀` `▶` | Moves the frequency down / up by one step. | Step-by-step searching. |
| `MAIN` / `SUB` | Active side of the TRX (receive and transmit together), like the front-panel key, without transmitting. Takes 1 to 2 seconds. **FTX-1: only in dual receive (DUAL RX, one VFO on 144 / 430 MHz).** In single receive the dashboard refuses: the transceiver went into transmit (seen at the club on 24 and 25/10). To listen to the VFO B frequency on HF: `A ⇄ B`. An administrator can allow it for tests (`ftx1SubSingle`). | FTX-1: listen and transmit on VFO B. |
| `SPLIT` | Transmit on the other VFO than the one being listened to. | DX expeditions (section 7.5). |
| `TXW` | **Hold** the button (or the `W` key): you listen on the transmit frequency; release = back to the DX. The VFOs are put back automatically (also after 15 s or if the link drops). PTT is refused while TXW is held. | In SPLIT, to listen to the pile-up and find a gap. |
| `DUAL RX` | FTX-1: dual receive (MAIN and SUB heard together) or single receive. The FTX-1 refuses dual receive with both VFOs on HF / 50 MHz, even on the same band (tried at the club: 20 m + 15 m, then 7.074 + 7.090 MHz); one VFO must be on 144 / 430 MHz. The button is then greyed out (explanation on hover). To follow two stations on the same HF band: the two decoders of the RTTY tab. | Monitoring two frequencies. In digital modes, switch it off so that only the active side is decoded. |
| `A → B` / `B → A` | Copies the frequency and mode of one VFO to the other. | Preparing a SPLIT. |
| `A ⇄ B` | Swaps the two VFOs. | Switching quickly between two frequencies. |
| `LOCK` | Locks the **front-panel controls of the TRX at the club**. The dashboard remains usable. | So that someone at the club does not change anything during your operating. |
| **Bands**: `160M` … `70CM` | Changes band: the TRX returns to the last frequency and mode used on that band. Only the bands of the connected TRX are offered. | Changing band. A « **TUNE obligatoire** » (TUNE required) reminder then flashes on the right until the next TUNE. |

The grey line below the bands is a reminder of useful actions; the message line just below it shows confirmations and refusals.

<a id="gauche"></a>
### 7.3 Left column

**Antenne** (antenna)

| Command | What it does |
|---|---|
| `ANT 1` / `ANT 2` | Chooses the antenna socket of the SPA-1 amplifier (FTX-1), or ANT 1 / ANT 2 / ANT 3 on the FTDX101. Refused during a transmission. The FTDX10 and IC-7300 do not allow this choice remotely (buttons greyed out). After changing antenna, do a new TUNE. |

**RF front end** (the receiver input)

| Command | What it does | Advice |
|---|---|---|
| **RF GAIN** | Receiver sensitivity (0 to 100 %). | Usually leave it at maximum; lower it if a band is very noisy or a nearby station overloads the receiver. |
| **AGC** `OFF` `FAST` `MID` `SLOW` `AUTO` | Automatic gain control: how fast the receiver turns the volume down after a strong signal. | AUTO is almost always fine. FAST for CW, SLOW for SSB. Avoid OFF (very loud, distorted sound). |
| Preamp, ATT | Same as the badges on the VFO display (section 7.1). | — |

**Mode**

| Button | Use |
|---|---|
| `LSB` / `USB` | SSB phone: LSB below 10 MHz (160, 80, 40 m), USB above (20 m…). |
| `CW-L` / `CW-U` | Morse (CW-U is the most common). |
| `RTTY-L` / `RTTY-U` | RTTY decoded by the TRX itself. For the dashboard's RTTY, use DATA-U. |
| `DATA-L` / `DATA-U` | Digital modes through the TRX sound card: **DATA-U** for the dashboard's FT8, FT4, FT2, RTTY, JTTY, WSPR, JT65, SSTV. |
| `PSK` | PSK31 decoded by the TRX. |
| `AM` / `AM-N`, `FM` / `FM-N`, `DATA-FM` | Amplitude modulation, frequency modulation (N = narrow), digital over FM (repeaters, packet…). |

Below the buttons, « Mode appliqué à **VFO A** » (mode applied to VFO A) shows which VFO changes mode (the one chosen with A / B).

**Filtres** (filters)

| Command | What it does | Advice |
|---|---|---|
| **BW** (WIDTH) | Receive filter width. | SSB: 2.4 to 2.7 kHz; CW: 300 to 500 Hz; FT8: 3 kHz (the whole audio band). |
| **IF SHIFT** | Slides the passband up or down without changing frequency. | Pushes an interfering station out on one side. Set it back to 0 afterwards. |
| `CONTOUR` | Tone control that attenuates part of the audio. | Makes a voice easier to understand. |
| `APF` | Audio peak filter, CW only. | Makes a weak CW signal stand out. |
| `NARROW` | Narrow filter (NAR badge on the VFO display). | Crowded band. |
| IC-7300: **FILTRE**, **PBT** | FIL1 / FIL2 / FIL3 (wide, medium, narrow) and Twin PBT (narrowing from both edges). | — |

**Station meters** (measurements, mostly useful when transmitting)

| Meter | Meaning | Normal value |
|---|---|---|
| RX / TX | State of the TRX; on the right, duration of the current transmission. | — |
| **Po** | Output power (watts). | The power set in the TX panel. |
| **SWR** | Antenna match. | Below 1.5; above 2.5, transmission is cut. |
| **ALC** | Is the transmitter being driven too hard? | Digital modes: as low as possible (ideally 0). Phone: a little ALC on the peaks. |
| **Id** / **Vd** | Current and voltage of the final stage. | For the station managers (monitoring). |
| **COMP** | Compression of the speech processor (phone). | A few dB when PROC is on. |
| **S** | S-meter of the active side. | — |

<a id="droite"></a>
### 7.4 Right column

**RX audio**

| Command | What it does | Who it affects |
|---|---|---|
| `🔊 Écouter le TRX` | Plays the receiver audio in your browser (listen to the TRX). A second click mutes it. | Only you (no control needed). |
| **Volume** | Volume of your listening (0 to 150 %). | Only you. |
| **AF LEVEL** | Volume of the TRX loudspeaker at the club. | Everybody (with control). Does not affect your listening or the decoders. |
| **SQUELCH** | Mutes the audio until a signal rises above the threshold. | Everybody. Useful in FM; leave it at 0 on HF and in digital modes, otherwise the decoders no longer hear anything. |

**DSP** (signal processing)

| Command | What it does |
|---|---|
| **NB** | Noise blanker level (OFF, then 1 to 10). Start low and raise it until the clicks disappear. |
| **DNR** | Noise reduction level (OFF, then 1 to 10; up to 15 on the FTDX10). Too high and the voice sounds "metallic". |
| `NOTCH` + **Fréq. NOTCH** | Switches the manual notch on and sets its frequency (10 to 3200 Hz): turn it until the whistle disappears. |
| `DNF` | Automatic notch. |

**Accord (tuner)**

| Command | What it does |
|---|---|
| `TUNER` | Switches the antenna tuner in or out of line (the SPA-1's for the FTX-1). It is switched back in automatically when the TRX connects and at every HF / 6 m band change. |
| `TUNE` | Starts tuning: the TRX sends a carrier for a few seconds while the tuner looks for the best match. **Required after a band change**; then check the SWR. TUNE counts as a transmission: you need control and transmit permission. |

**TX**

| Command | What it does |
|---|---|
| `RX` / `TX` lamp | Real state of the TRX (green when receiving, red when transmitting). |
| `PTT` | **Hold** to transmit (or the `Space` bar); release = back to receive. The small text below says why PTT is unavailable (« Prenez la main pour émettre » (take control to transmit)…). |
| **Puissance** (power) `−` `+` | Lowers or raises the TRX power. Your licence limit is shown below (e.g. ON3: 25 W); above it, the power is brought back down automatically. |
| **Gain micro** (mic gain) | Microphone level in phone. |
| `PROC` + **Niveau PROC** (PROC level) | Speech processor (compressor): the voice "punches through" the noise better. Keep the level moderate, otherwise the modulation sounds unpleasant. On the IC-7300: COMP. |
| `VOX` | Voice-operated transmit: can only be **switched off** remotely, never on. |

<a id="split"></a>
### 7.5 Operating SPLIT (transmit and receive on two frequencies)

SPLIT is mainly used for a **DX expedition** listening away from its own frequency ("UP 5", "listening 14 200 to 14 210"). You **listen to the DX on VFO A** and **transmit on VFO B**.

1. Set **VFO A** to the DX frequency, in the right mode. Check that `RX` is green on VFO A.
2. Click `A → B`: VFO B takes the same frequency and mode.
3. Set the **transmit frequency on VFO B** with the mouse wheel on its digits, for example +5 kHz for "UP 5". On the FTX-1, the wheel on VFO B does not change the side you are listening to: you stay on A.
4. Click `SPLIT` (or `TX` on the VFO B display). The **TX** lamp and the glowing frame move to VFO B; the reminder shows « Émission sur B » (transmit on B).
5. Listen to the DX on A; **hold TXW** (or `W`) to listen to the pile-up on your transmit frequency. To call, **PTT**: the transmission goes out on VFO B (digits in red). On release, back to receive on A.
6. To finish: click `SPLIT` again (or `TX` on VFO A). The TX lamp goes back to A.

> [!TIP]
> **Good to know**
> - Transceiver rule: without SPLIT you transmit on the VFO you listen on; with SPLIT, on the other one.
> - **FTX-1**: SPLIT is handled by the dashboard, by swapping the VFOs. On PTT, the Station page swaps A and B on the transceiver (A ⇄ B), transmits from the active side on the frequency and in the mode of the transmit VFO, then, once receive is confirmed, puts the VFOs back. On the transceiver display the frequencies swap during the transmission: this is normal; the dashboard shows the VFOs in place. A very short press (under a quarter of a second) does not transmit. A SPLIT set on the front panel is followed by the dashboard.
> - The frequency **actually transmitted** (VFO B, XIT included) is checked: outside the authorised bands, PTT is refused.
> - Small offset (a few kHz): `XIT` on VFO A is enough, without SPLIT.
> - In **FT8 / FT4 / FT2**, there is no need for SPLIT: the transmission is placed within the audio passband with the TX marker of the waterfall (right click).
> - Switch SPLIT off at the end of the pile-up: otherwise the next operator would transmit on VFO B without knowing it.

<a id="ecoute"></a>
## 8. Listening

- **RX audio** panel → `🔊 Écouter le TRX`, then set your **Volume**. Everybody can listen, even without control.
- The audio arrives with a small delay (a fraction of a second): this is normal over the internet.
- If you hear nothing: check your PC volume, then the Station lamp. The club's Station page must have audio enabled (section 18). The message below the button says what is missing.
- **AF LEVEL** and **SQUELCH** act on the TRX itself, for everybody.

<a id="emission"></a>
## 9. Transmitting and safety

1. **Have control** and an account allowed to transmit (ONL listeners cannot).
2. Be in a **band authorised** for your licence.
3. After a band change: `TUNE`, then check the **SWR**. A reminder flashes to the right of the 70CM key until the TUNE (on 2 m and 70 cm there is no tuner: only "check the SWR"). The SPA-1 tuner only works on HF and 6 m, and the amplifier must be switched on.
4. Set the **power** (TX panel).
5. Transmit: hold `PTT` (or `Space`), or use the transmit buttons of the digital modes.

> [!WARNING]
> **Automatic safety features** (cannot be bypassed from the dashboard):
> - Transmission only in the authorised bands, checked on the frequency actually transmitted (SPLIT and XIT included).
> - Maximum length of one transmission: **120 s**, then it is cut; release the PTT before transmitting again.
> - Immediate cut if you lose the link, if the club PC loses internet, or if the Station page closes.
> - **SWR** above 2.5:1, or **HI-SWR** reported by the TRX: transmission cut and PTT refused on that frequency (± 25 kHz) until a successful TUNE.
> - **TUNE without a match**: if the FTX-1 reports HI-SWR at the end of a TUNE, transmitting is **blocked on the whole band** (except TUNE) to protect the amplifier. A red message appears to the right of the bands. The block is lifted as soon as a TUNE succeeds; otherwise, try the other antenna or tell a station manager.
> - At the club, the TRX goes back to receive if it transmits for 2 min without modulation or 5 min without a break.
> - Power limited to your licence class; listener callsigns: no transmission at all.

Transmitting is only possible if the administrators have enabled it on the server.

<a id="operateurs"></a>
## 10. Operators and chat

- The **Opérateurs** (operators) panel opens and closes with the `👥` button in the top bar. A red dot on `👥` means a new message.
- It shows the connected members and who has control.
- **Chat**: type a message in « Message aux connectés… » (message to connected members) then `Envoyer` (send) (or `Enter`). All connected members see it. Messages are not kept after a server restart.
- The `Demander la main à …` and `Passer la main à …` buttons appear there when relevant (section 6).
- The **Activité** (activity) tab in the centre is the station log: logins, control taken and handed over, transmissions (frequency, mode, power, duration), tuning, safety cuts, station online, TRX connected…

<a id="disposition"></a>
## 11. Layout and separate windows

- `⧉` button at the top right of a panel: the panel opens in **its own window**, to place wherever you like (on a 2nd screen…). In that window, `⧉ Ramener` (bring back) puts it back in the dashboard.
- The `⧉` button to the right of the tabs opens **all the digital modes** in a separate window. `⧉ Ramener dans le dashboard` (bring back into the dashboard) (or `Ramener ici` (bring back here) in the dashboard) puts them back.
- The `Space` bar (PTT) also works from a separate window.
- The layout is remembered: on the next load, the windows reopen in place if Chrome **allows pop-up windows** for remote.op0p.be (icon at the right of the address bar → Always allow).

<a id="numeriques"></a>
## 12. Digital modes

The centre tabs: **Activité**, **FT8 · FT4 · FT2**, **RTTY**, **WSPR**, **JT65**, **JTTY**, **CW**, **SSTV**, then **Synchro**, **Logs** and the `Log QSO` button. On the right of the FT8 · FT4 · FT2, RTTY, WSPR, JT65, JTTY and CW tabs, the **band map** shows the DX cluster spots (see 12.3, « Band map »). You have **no software to install** (no WSJT-X, FLDIGI…): everything happens in the page.

- **Decoding runs on the server**, on the server's (synchronised) clock: the time on your PC and on the club PC does not matter.
- The TRX audio is only sent while someone is listening or watching a digital-mode tab: decodes start a few seconds after the tab is opened.
- **Frequency list** (at the top of each tab): choosing a line sends the TRX to that frequency, in **DATA-U** (in CW for the CW tab). You need control. The `↺` button next to it brings the TRX back to the chosen frequency if someone has turned the VFO in the meantime.
- **Waterfall**: each tab shows the scrolling spectrum from 0 to 3000 Hz. A signal is a coloured trace; its horizontal position is its audio frequency.
- **Status line** (on the right of the tab bar): reports problems (station offline, audio not enabled, TRX not in DATA-U…) or the decoder state.
- **Transmitting** in FT8 · FT4 · FT2, RTTY and JTTY, under the **TX call** chosen in the Correspondant line (ON5VL or your callsign). You need control and transmit permission. WSPR, JT65, CW and SSTV are **receive**-only for now *(soon)*.

**Waterfall settings** (above the scale, shared by all tabs and remembered in your browser)

| Setting | What it does |
|---|---|
| **Gain** | Contrast: further to the right, weak signals stand out more. |
| **Zéro** (zero) | Background level: further to the right, the background is brighter. |
| **Plat** (flat) | Makes the background noise even across the whole width (corrects the slope of the TRX filter). Leave it ticked. |
| **Couleurs** (colours) | JTDX (default: blue noise, yellow signals, strong ones in red), blue, rainbow, grey. |
| **Vitesse** (speed) | Fast, normal or slow scrolling (slow = more compact signals and more history), like JTDX's "Spd". |
| `↺` | Restores the default settings. |
| Handle below the waterfall | Drag it up or down: height of the waterfall and of the lists (double-click: original size). |

<a id="ft8"></a>
### 12.1 FT8 · FT4 · FT2

FT8 is a digital mode designed for very weak signals: each station sends a short message for 15 seconds (a **period**), then listens during the next period. A complete QSO takes about a minute and a half. **FT4** is twice as fast (7.5 s), **FT2** faster still (3.75 s).

**The bar at the top of the tab**

| Command | What it does |
|---|---|
| `FT8` / `FT4` / `FT2` | Chooses the mode; the TRX goes to that mode's calling frequency on its band. FT2 is the fast mode of Decodium (IU8LMC), incompatible with the "FT2" of WSJT-X Improved. |
| Frequency list | Calling frequencies per band (e.g. 14.074 · 20m), and QO-100 (section 12.9). |
| `↺` | Brings the TRX back to the chosen frequency (VFO A, DATA-U). |
| RX … Hz / TX … Hz | Receive (green) and transmit (red) audio frequencies within the 3 kHz passband. |
| `TX ← RX` | Transmit on the same audio frequency as receive. |
| `RX ← TX` | Receive on the transmit audio frequency. |
| **Période** (period) auto / 1re / 2e | Which period to transmit in. « auto »: opposite to the chosen correspondent (almost always what you want); « 1re » (1st) = 00 and 30 s, « 2e » (2nd) = 15 and 45 s in FT8. |
| ☐ **Répondre au 1er** (answer the first) | When you call CQ (Tx6), the first station to answer becomes the correspondent and the QSO runs by itself (WSJT-X's "Call 1st"). |
| `■ Arrêter` | Stops automatic transmission at once ("Halt Tx"). The `Space` bar does the same. |
| Clock | Server UTC time. |

**The waterfall**: **left click** = receive frequency (green « RX 1500 » flag and green line), **right click** = transmit frequency (red flag and red line). For transmitting, choose a clear spot in the waterfall. A white line marks the start of each period, with the UTC time and the band.

**The two message lists**

- **Activité de bande** (band activity, on the left): all decoded messages. **CQ** calls are in green, messages addressed to your TX call (ON5VL, OR0L or yours) in red, your own transmissions in yellow. `Effacer` (clear) empties the list.
- **Fréquence RX** (RX frequency, on the right): only the messages close to your receive frequency, i.e. your QSO in progress.
- A line separates each period; messages are in chronological order.
- **Width of the two lists**: drag the vertical line between them (double-click: half and half).

| Column | Meaning |
|---|---|
| UTC | Start of the period in which the message was received. |
| dB | Signal-to-noise ratio (as in WSJT-X): −24 = very weak, +10 = strong. This is the report you send. |
| DT | Time offset of the signal (seconds). Close to 0 when everything is in step. |
| Fréq | Audio frequency of the signal (Hz). |
| Message | The decoded text, e.g. "CQ F4ABC JN18". A mark **a1**…**a7** at the end means a decode obtained with a priori help (see below). |
| Pays | DXCC country of the transmitting station. |
| km / Az | Distance and direction (azimuth in degrees) from the club. "≈": approximate (no locator in the message, centre of the country). |

- **Stations already worked**: messages from a station already in the log **under the current TX call**, on the same band and in the same mode, are shown green and struck through ("worked before"). With another TX call, only QSOs made under that callsign count.

**Messages Tx1 to Tx7** (below the lists, as in WSJT-X)

| Message | Example | When |
|---|---|---|
| `Tx1` | F4ABC ON5VL JO20 | Answering a CQ (your callsign and locator). |
| `Tx2` | F4ABC ON5VL −12 | Giving the correspondent a report. |
| `Tx3` | F4ABC ON5VL R−12 | Acknowledging their report and giving yours. |
| `Tx4` | F4ABC ON5VL RR73 | Everything received, goodbye. |
| `Tx5` | F4ABC ON5VL 73 | Last message. |
| `Tx6` | CQ ON5VL JO20 | Calling CQ. |
| `Tx7` | free text | Free message of 13 characters at most. Right click or `✎` to edit it. |

- **Clicking a Tx message** sends it **every period** (one in two) until an answer comes, like WSJT-X's "Enable Tx". You need control, the transmit VFO in **DATA-U** and power within your limit.
- **Answering a station**: click its **callsign** (dotted underline) or **double-click** its message. It becomes the correspondent (callsign, locator, report) and, with control, the right message goes out in the next period, opposite to theirs. A click elsewhere on the line only sets the receive frequency.
- **The sequence advances by itself** from the answer: their locator → Tx2; their report → Tx3; R+report → Tx4 (RR73); RRR or RR73 → Tx5 (73). After RR73 or 73: end of QSO, transmission stopped, back to Tx6, and the **Enregistrer le QSO** form opens already filled in.
- **When the answer goes out**: in FT8, a transmission must start at the beginning of a period (at most 2.3 s late, otherwise it is no longer decoded; FT4: 0.8 s). Decodes arrive around 12.7 s: a click before the end of the correspondent's period (or in the first 2 seconds of the next one) sends the answer at once. Transmission always stops at the end of the period. A message at the bottom of the screen says when your answer goes out.
- **Period bar** (below the lists): green while receiving, red while transmitting; it fills up during the period.
- **Automatic stops**: `■ Arrêter` or `Space`; the correspondent answers someone else; the same message for 6 minutes without an answer; control lost.
- In **SPLIT**, the message goes out on the other VFO, like the PTT.

> [!TIP]
> **The decoder**
> - It is the **WSJT-X 3** engine, with the multi-pass decoder of **JTDX**. In FT8, three passes per period: an early one around 12 s (so you can answer right away), a normal one at the end of the signal, then a deep one that adds the weakest stations a few seconds later.
> - **A priori help (AP)**: during a QSO, the decoder knows who the correspondent is and which message is expected; it can then find it down to 2 to 3 dB lower. These decodes carry the mark a1 … a7.
> - Sensitivity: FT8 about −22 dB (−24 dB with a priori help), FT4 about −17.5 dB. A database of ~100,000 callsigns (JTDX's) rejects very weak false decodes.

<a id="jt65"></a>
### 12.2 JT65

Same window as FT8, but with one-minute periods; the TRX goes to the JT65 frequency of its band. Decodes arrive around the 52nd second. Receive only.

<a id="rtty"></a>
### 12.3 RTTY

RTTY is radio "teletype": you type text that scrolls on the other station's screen. Widely used in contests. The tab has **two independent decoders**: **A** (VFO-A, left) and **B** (VFO-B, right), each with its own received text and settings. The FTX-1, FTDX10 and IC-7300 send a single audio stream to the PC (the FTDX101 in single receive; in dual receive it sends both receivers in stereo: one waterfall per decoder, A = MAIN, B = SUB), so there is **one waterfall**, full width, carrying the markers of both decoders. You can follow two stations on the same band at once (contest, a DX and its pile-up). A transceiver that sends its two receivers separately (FTDX101D / MP) will get one waterfall per decoder, side by side.

Above the waterfall, the help line (« clic gauche : décodeur A… ») is shown for **3 seconds** when you open the tab, then disappears to leave more room for the receive windows; it stays as a tooltip on the waterfall. The status line only appears when something is wrong (no audio, TRX not in DATA-U…).

| Control | What it does |
|---|---|
| Frequency list + `↺` | RTTY frequencies per band; the transceiver goes there in DATA-U. |
| **Bande** 3 kHz / 4 kHz (band) | Audio width shown. The transceiver only sends the audio after its filter: for 4 kHz also open its filter (BW 4.0K), otherwise the right edge stays black. It cannot go wider with these transceivers (their screen's scope does not go through USB). |
| **Zoom** ×1 to ×8, or **mouse wheel** on the waterfall | As in MixW: the waterfall shows a narrower, more detailed range (×4: 750 Hz in the 3 kHz band). **Wheel towards you**: narrower, around the mouse; **wheel away**: wider, up to the whole band (×1). The list does the same, centred on the decoder marked TX; the window follows that decoder when it gets near an edge. |
| `SPLIT` | Receive on VFO A, transmit on VFO B (same command as SPLIT on the Step row). Lit in red: « SPLIT · TX sur B ». |
| Waterfall scale | In **kHz**, real frequency (VFO dial + audio); the small white triangle marks the middle of the audio band. In **DATA-U** (the mode to use for RTTY) low frequencies are on the left; in LSB the scale is reversed and so is the RTTY transmission: switch to DATA-U. |
| Markers on the waterfall | Decoder **A**: yellow (Mark) and blue (Space). Decoder **B**: mauve (Mark) and green (Space). Dark colours and thick frames: visible even on a very bright screen. The letter **A** or **B** is written large, on a badge of its colour, above the markers. |
| Left button / right button | **Left click** on a signal: tune decoder **A** on it; **right click**: decoder **B**. **Holding the button down** and dragging, both bars of the decoder (Mark and Space) follow the mouse **continuously**: left for A, right for B; decoding follows while moving. Release: the decoder stays there. |
| `Shift` + drag / `Shift` + wheel on the waterfall | `Shift` + **dragging** the waterfall left or right (or dragging with the middle button, wheel pressed) tunes the VFO (you "grab" the band, signals follow the mouse); `Shift` + **wheel**: VFO ± 10 Hz per notch. Both decoders stay on their signals. You need control. |
| Frequency (e.g. 7 074,9 kHz) | Next to VFO-A / VFO-B: frequency of the signal followed by this decoder (dial of the VFO being received + Mark / Space centre, − in LSB), handy for the log or a spot. In single receive (always the case with both VFOs on HF on the FTX-1), both decoders read the same receiver: their frequencies are computed from the VFO being received, shown in brackets, e.g. « 7 079,1 kHz (VFO A) ». |
| **Shift** (170, 200, 425, 850 Hz) / **Speed** (45,45 … 100 Bd) | Amateur radio: 170 Hz and 45.45 baud. |
| `Inversé` (reversed) | Swaps Mark and Space when the received text makes no sense (signal "upside down"). |
| **Silencieux** (squelch) | Higher = fewer random characters on noise; too high and weak signals are no longer decoded. |
| M / S indicator | The two bars should beat alternately when the decoder is tuned correctly. |
| Centre … Hz | Audio frequency the decoder is tuned to. |
| `⌖ Centrer` (centre) | Moves the VFO so that the signal followed by this decoder falls in the middle of the audio band (white triangle): its frequency does not change. The other decoder stays on its signal if it is still in the band. |
| `TX` / click in the window | Chooses the decoder whose settings are used for transmitting (audio frequency, shift, speed): **one click anywhere in the VFO-A or VFO-B window** is enough, or the `TX` button in its header. The button becomes `▶ TX ici` (TX here, red), the header turns pink and a red frame surrounds the decoder; the other window shows `RX ici` (RX here) in green, with a green frame (receive only). A click on `RX ici` swaps the roles. The zoom centres on it. **A click on `▶ TX ici` transmits the custom text** typed in the bottom box (like `Émettre`); while transmitting it becomes `■ Arrêter` (stop). Macros `F1`…`F12` also go out on this window. |
| `Effacer` (clear) | Clears the received text of this decoder. |
| Vertical bar between the two texts | Drag it: width of the two decoders (double-click: half and half). |

1. **Receive**: left click on a signal for decoder A, right click for decoder B (button held: the bars follow the mouse continuously, to place them exactly on the traces). The two markers should sit on the two traces of the signal. The text appears under the waterfall, A on the left, B on the right.
2. **Double-click a received callsign**: it becomes the correspondent.
3. **Choose the transmit decoder**: a click in its window (VFO-A or VFO-B), or the `TX` button in its header; your reply goes out on the frequency of the station it follows. Double-clicking a callsign in window B therefore does both: B becomes the transmit decoder and the callsign goes into Correspondant.
4. **Transmit**: text in the bottom box, then `Émettre` (transmit) (or `Ctrl`+`Enter`). The text goes out with the settings of the decoder marked TX (and on VFO B if SPLIT is on), then the transceiver returns to receive. It appears in grey in that decoder's received text, then each letter turns red as it is sent. While transmitting the button becomes `■ Arrêter` (stop). 600 characters at most; transmit audio frequency between 300 and 2800 Hz.
5. **Macros** `F1` to `F12` (keyboard keys or click): transmit at once; **Shift+click** adds the macro to the text without transmitting (section 13). `Esc` stops the current transmission.
6. `Effacer` (under the transmit button) clears the text to send; `Log QSO` opens the logbook form, with the frequency of the decoder marked TX.

1. **Take control**, **RTTY** tab, TRX in **DATA-U** (`↺` button of the frequency list).
2. **Find a station**: click a green callsign on the **band map**. The TRX tunes to it, the transmit decoder decodes it and its callsign goes into Correspondant. Or: left click on a trace in the waterfall (decoder A), right click (decoder B).
3. **Choose the transmit window**: one click in the VFO-A or VFO-B window (« ▶ TX ici »). Double-clicking a received callsign puts it in Correspondant and selects its window at the same time.
4. **Reply**: `F2` key (or the reply macro), then the report macro. For custom text: type it in the bottom box, then `▶ TX ici` (or `Ctrl`+`Enter`). `Esc` stops the current transmission.
5. **Log the QSO**: a macro containing `<LOG>` (form opens by itself) or the `Log QSO` button.
6. **Call yourself** (CQ): choose the transmit window, then `F1`. With two decoders you can call CQ on A while watching another station on B.
7. **Station outside the waterfall and not spotted**: click the band map at that frequency (the TRX goes there), or Shift + drag the waterfall, or `Shift` + wheel.

On the right of the FT8 · FT4 · FT2, RTTY, WSPR, JT65, JTTY and CW tabs (not SSTV: a single frequency), a **vertical column** shows the band as a ruler (on a large screen it goes up to the top, next to the VFO A and B displays, both narrowed by the same width): low frequencies **at the top**, high at the bottom (by default 7030–7120 kHz on 40 m, 14080–14150 kHz on 20 m, 3570–3600 kHz on 80 m…). **Spots** from the club's DX cluster (OP0P, including stations found by the Reverse Beacon Network) appear at their frequency. You see the whole RTTY part of the band at a glance, while the waterfall only shows 3 or 4 kHz.

| Item | What it shows or does |
|---|---|
| Green / red dot, **20 m** | Link to the cluster (green = connected), band of the VFO being heard. |
| **RTTY** (or FT8, CW…) / **Tous** (all) | The tab's mode: its spots and spots with no mode given. Tous: also spots of other modes. |
| Two kHz boxes | Range shown, kept for each band, separately for RTTY, CW and the other digital modes. Type your limits (e.g. 7030 and 7120). Defaults on 40 m: RTTY 7030–7120, CW 7000–7040, FT8 and others 7038–7080 kHz. |
| Callsign in green | Station calling (CQ, RBN skimmer spot). |
| Struck-out callsign | Already worked in RTTY on this band (under the chosen TX call). |
| Faded callsign | Old spot (kept 30 minutes). On hover: comment, who spotted it, how many minutes ago. |
| Blue area | The part of the band visible in the waterfall right now. |
| Yellow / mauve line | RTTY: decoder A / B; « TX » next to the transmit one, « RX » next to the other. FT8, JT65, JTTY: green line = receive frequency, red = transmit. CW: yellow line = VFO frequency. « ▲ VFO » or « ▼ VFO »: the VFO is outside the range. |
| **Click on a spot** | The transceiver tunes to the station: if it is already in the waterfall, only the transmit decoder moves onto it; otherwise the VFO moves to put it in the middle of the waterfall, with the decoder on it. The callsign goes into Correspondant. Then just press the reply macro (`F2`…). You must have control. |
| Click elsewhere on the map | Same on that frequency, without a callsign (to scan the band). |
| Click in the other tabs | **CW**: the VFO goes to the station (it comes out at the TRX pitch, where the CW decoder is set). **FT8 · FT4 · FT2, JT65, JTTY, WSPR**: the receive frequency moves onto the signal; if it is outside the audio band, the VFO moves to put it at 1500 Hz. |
| Handle on the left edge | Drag left or right: width of the band map (kept in this browser); double-click: original width. |
| **Wheel** / drag / double-click | Wheel: zoom around the mouse; drag up or down: move the range; double-click: the band's original range. |

Cluster settings (administrator, `config.json`, then restart the service): `clusterHost` (op0p.be by default; empty = no cluster), `clusterPort` (8000), `clusterCall` (login callsign with an SSID; empty = digiCall followed by -7, i.e. ON5VL-7) and `clusterCmds` (commands sent after logging in: `set/skimmer` for RBN spots).

<a id="wspr"></a>
### 12.4 WSPR

WSPR is used to study propagation: low-power beacons transmit their callsign, locator and power every 2 minutes. Choose the band in the list; about ten seconds after each even minute, the list grows: time, dB, DT, frequency, drift, callsign, locator, power and distance from the station. Receive only.

<a id="jtty"></a>
### 12.5 JTTY

- WSJT-X 3.3 mode for keyboard-to-keyboard and contests: no periods, each message appears **frame by frame** (1.9 s); `▌` = message still being received.
- As in FT8: left click = receive, right click = transmit, double-click = correspondent. Two lists: Activité JTTY (JTTY activity) and Fréquence RX (RX frequency).
- Macros `F1` to `F8`: a click transmits at once, **Shift+click** adds them to the message.
- `Émettre` (or `Enter`): the message goes out at once on the TX frequency, then back to receive. 80 characters per message (longer: two messages in a row); TRX in **DATA-U**.

<a id="cw"></a>
### 12.6 CW

| Command | What it does |
|---|---|
| Frequency list + `↺` | CW frequencies per band; the TRX switches to CW. |
| **Filtre** (filter) 50 … 400 Hz | Decoder filter width: 100 Hz by default, 50 Hz with QRM, 200 to 400 Hz for searching. |
| **Silencieux** (squelch) | Higher = fewer random letters on noise. |
| LED and level bar | Follow the keying: the LED flashes in time with the Morse when the decoder is properly locked. |
| Tonalité / Vitesse (tone / speed) | Audio frequency being tracked and measured speed (words per minute). |

- **Click a signal** in the waterfall: the decoder locks onto the nearest signal and learns its speed. Right click: exact tuning where you click.
- Double-click a received callsign = correspondent; `Log QSO` opens the logbook form.
- **Émission** (transmit) section (speed, macros `F1` to `F12`, text): prepared; CW transmission will come in a future version.

<a id="sstv"></a>
### 12.7 SSTV

- **Receiving**: pictures arrive by themselves (VIS code) and are drawn line by line. Martin, Scottie, Robot and PD modes. The **gallery** keeps the last 12 (click = show); `PNG` saves the picture shown to your PC.
- **Preparing a picture**: `Images du PC…` (pictures from your PC) (or drag and drop a picture), CQ card, test pattern or received picture; it is cropped to the format of the chosen mode. Three text lines (top, centre, bottom) with the tags `<CALL>`, `<MYCALL>`, `<RST>`…; text size and colour. Right click a thumbnail: remove it.
- `▶ Écouter` (play) plays the signal on your PC (without transmitting); `WAV` saves it as a file. SSTV transmission will come in a future version.

<a id="synchro"></a>
### 12.8 Synchro

A monitoring tab: it shows whether the clocks and the link are in step. There is nothing for you to set.

| Box | Meaning |
|---|---|
| Heure du serveur (UTC) (server time) | The reference for all decoding. |
| Votre PC (your PC) | Current offset between your PC clock and the server, in milliseconds. Does not matter for the dashboard. Not to be confused with the "Offset" column of NetTime or Meinberg (the error **before** their last correction). |
| Liaison station → serveur (station → server link) | Arrival delay of the audio from the club, measured and corrected automatically. |
| DT médian (median DT) | Average DT of the latest FT8 / FT4 decodes: close to 0.0 s = everything is in step. |
| Décodages (decodes) | Arrival time of each decoder pass after the start of the period. If the normal pass arrives more than 2 s after the end of the period, the server is overloaded and some answers go out one period later. |

<a id="qo100"></a>
### 12.9 QO-100

QO-100 is a geostationary satellite reached on 2.4 GHz with an up-converter. The FT8 · FT4, RTTY and CW lists offer « **QO-100 · FI 2 m / 70 cm** » (IF 2 m / 70 cm): the frequency to set on the TRX **before the converter**, to uplink on 2400.040 MHz (FT8 / FT4), 2400.025 MHz (CW) or 2400.090 MHz (RTTY). Example: FT8 on **432.540 MHz** with the club's 70 cm converter. Only the IFs the connected TRX can reach are offered (FTX-1).

<a id="messages"></a>
## 13. Correspondent, macros and tags

**The Correspondant line** (under the digital-mode tabs)

| Field | What it contains |
|---|---|
| **Correspondant** (correspondent) | The callsign of the station worked. It fills in by itself when you click a callsign in a tab; you can also type it. |
| **Nom** (name), **QTH**, **Locator** | First name, town and locator of the correspondent. They are looked up on **QRZ.com** as soon as a new correspondent is chosen (if a QRZ account has been set up by the administrators); only empty boxes are filled. |
| **RST TX** / **RST RX** | RST TX = report **sent** by the club station; RST RX = report **received** from the correspondent. In FT8 / FT4 / FT2, WSPR and JT65 they are dB (RST RX fills itself in during the sequence); in RTTY, CW, SSTV and JTTY, RST 599. |
| **TX call** | Callsign for digital transmissions and the logbook: the station's (ON5VL) or yours. Chosen by the operator in control and remembered for next time. Messages Tx1 to Tx6, `<MYCALL>` macros and the logbook form follow it. A QSO logged under your callsign stays in the club logbook, but is not uploaded to the club's online accounts (get it with Exporter → Mes QSO). |
| `Log QSO` (tab row, right of Logs) | Opens the « Enregistrer le QSO » (log the QSO) form, already filled in with this information, the frequency and the mode. |

**Macros** (RTTY, JTTY, CW) are ready-made texts, on a row above the text box: **F1 to F12** in RTTY and CW, **F1 to F8** in JTTY.

- A macro starting with `<TX>` (red edge on the left; this is the case for all default macros) **is transmitted at once** when clicked or with its `F1`… key, then the TRX returns to receive.
- **Shift+click**: adds the macro to the text to send without transmitting, to build a message and then « Émettre ».
- A macro without `<TX>` (and every CW macro) is simply added to the text.
- **Right click** a macro (or `✎`): edit it — name, text, preview, back to the default text. Your macros are stored on the server, for you only.
- If a macro contains `<CALL>` while no correspondent is chosen, nothing is sent.

| Tag | Replaced by | Tag | Replaced by |
|---|---|---|---|
| `<MYCALL>` | transmitted callsign (TX call) | `<CALL>` | correspondent |
| `<NAME>` | their first name | `<QTH>` | their QTH |
| `<RST>` | report sent | `<LOC>` | their locator |
| `<MYLOC>` | station locator | `<MYQTH>` | station QTH |
| `<OPCALL>` | your callsign (operator) | `<CNTR>` | serial number (001…) |
| `<INCR>` | moves to the next serial number | `<ZT>` / `<ZD>` | UTC time / date |
| `<TX>` | at the start: transmit at once on click | `<RX>` | back to receive at the end (always done) |
| `<LOG>` | opens the « Enregistrer le QSO » form |  |  |

<a id="logs"></a>
## 14. Logs (station logbook)

**Logs** tab (to the right of Synchro): the station logbook, shared by all members. It can upload QSOs to **LoTW**, **eQSL**, **Club Log** and **QRZ.com**, export them as **ADIF** or **Cabrillo**, and forward them over **UDP** to logging programs on the PC (Swisslog, HRD Logbook, Log4OM, N1MM Logger+…).

<a id="l-fiche"></a>
### 14.1 Logging a QSO

The form at the top of the tab:

| Field / button | What it does |
|---|---|
| **Indicatif** (callsign) | The correspondent's callsign. The UTC date and time fill in as soon as you type the first letter (start of the QSO). The name, QTH and locator are looked up on QRZ.com. |
| **Date UTC**, **Heure UTC** (UTC time) | Start of the QSO, in UTC (not Belgian time). |
| `⟳ Maintenant` (now) | Resets the date and time to the present moment. |
| **Fréquence MHz** (frequency), **Mode** | Follow the active VFO of the TRX by themselves. A value typed by hand is kept until the next QSO. |
| `⇩ TRX` | Takes the frequency and mode from the TRX (in DATA: the mode of the tab on screen, FT8, RTTY…), the power, and the Correspondant line (callsign, name, QTH, locator). |
| **RST env.** (sent) / **RST reçu** (received) | Report sent and received (59, 599 or dB depending on the mode). |
| **Nom**, **QTH**, **Locator**, **Puiss. W** (power), **Remarque** (comment) | QSO information; the comment is free text. |
| **TX call** | Callsign under which the QSO was made. It follows the one on the Correspondant line; with control, changing it here also changes the transmit callsign. |
| ☐ **QO-100** | QSO via the QO-100 satellite: with the converter IF (e.g. 432.525 MHz), the box ticks itself and the 2400.xxx MHz uplink frequency is logged. |
| `Enregistrer le QSO` (or `Enter`) | Adds the QSO to the logbook. A duplicate (same callsign, band and mode within half an hour) is reported before saving; if the entry already in the logbook lacks the name, QTH, locator or received RST, you are offered to **complete** it instead of creating a 2nd QSO. |
| `Supprimer` (delete) / `Annuler` (cancel) | Appear when you edit an existing QSO: delete the QSO (after confirmation; online logbooks are not changed) or abandon the edit. |

**Without leaving the RTTY, JTTY or CW tab**: the `Log QSO` button (next to « Émettre », and on the tab row, right of Logs) opens a form already filled in: callsign, first name, QTH, locator and RST, frequency (in RTTY: the signal frequency) and mode, power, start time (when the correspondent was chosen) and end time. Correct if needed, then `Enregistrer dans le carnet` (save to the logbook). In FT8, this form opens by itself at the end of the QSO; a macro containing `<LOG>` also opens it.

<a id="l-liste"></a>
### 14.2 The QSO list

- The list shows the last 300 QSOs. The **Rechercher** (search) box finds a callsign, a name or an operator; the number of QSOs found is shown next to it.
- **Click a row**: the QSO is loaded into the form to be edited or deleted (by its author or an administrator).
- **Column width**: drag the right edge of a column title (double-click: original width). Setting remembered in your browser.
- **Filters**: the **▾** next to each title offers the values of that column (dates, bands, modes, countries, TX call, upload state…) with their QSO count. A choice filters the logbook (the ▾ becomes ●); several columns combine; `✕ Filtres` (filters) removes them all.

| Column | Meaning |
|---|---|
| Date, UTC | UTC date and time of the start of the QSO. |
| Indicatif | The correspondent. |
| Bande, MHz, Mode | Band, exact frequency and mode. |
| Env., Reçu | Reports sent and received. |
| Nom, QTH | First name and town of the correspondent. |
| DXCC, Préfixe | Country of the correspondent (from their callsign) and its main prefix (ON for Belgium, LA for Norway, K for the USA…). |
| TX call | The callsign under which the QSO was made; the operator is shown on hover. |
| LoTW, eQSL, CL, QRZ | Upload state for each service: **·** not sent yet, **✓** sent, **✗** rejected (hover = details), **★** confirmed on LoTW. |

<a id="l-export"></a>
### 14.3 Exporting

| Exporter ▾ menu (export) | What it does |
|---|---|
| **Mes QSO (.adi)** (my QSOs) | Immediately downloads the QSOs made under **your** callsign (TX call), to import into your own logging program. |
| **ADIF (.adi)…** | Selection window: TX call and date range, then download of an ADIF 3 file. A member exports their own QSOs (under their callsign, or those they made themselves under ON5VL / OR0L: « mes QSO sous cet indicatif », my QSOs under this callsign); administrators export every TX call. |
| **Cabrillo (.log)…** | Same choice, plus the contest name: Cabrillo 3 file to send to a contest's organisers. |

<a id="l-sync"></a>
### 14.4 Synchronisation (LoTW, eQSL, Club Log, QRZ)

**Synchronisation ▾** menu, reserved for administrators: it uploads the logbook QSOs to the confirmation websites. One window per service, as in Swisslog.

1. Choose the service: **Synchronisation LoTW…**, **Synchronisation eQSL…**, **Club Log…** or **QRZ…**.
2. **Détails** (details) tab: choose the **callsign (TX call)** whose QSOs are uploaded (the current TX call is suggested).
3. Just below, the yellow **« Identifiants <service> de <indicatif> »** (<service> credentials of <callsign>) box shows the credentials that will be used: login, password, key… A note says whether they belong to this callsign, come from the club configuration, or what is missing. Complete them if needed, then `Enregistrer pour cet indicatif` (save for this callsign). Passwords stay on the server and are never displayed: a field left empty keeps the stored value, `✕` deletes it, `👁` shows what you type.
4. Optional: **date range**, **Renvoyer aussi les QSO déjà envoyés** (also resend QSOs already sent), **Temporisation** (delay in seconds between two QSOs, so as not to be blocked by the website). Club Log: « Effacer le log ClubLog existant » (clear the existing Club Log log) replaces the whole online log (only use it if this logbook is complete). The number of QSOs to upload is shown at the bottom.
5. `Télécharger` (upload): the upload starts; the **Traitement** (processing) tab shows the progress and the report, QSO by QSO. `Arrêt` (stop) interrupts it; `Fermer` (close) closes the window: the upload continues on the server and its progress stays visible below the logbook list.

- **Club callsigns and personal callsigns**: the credentials in the general configuration (14.5) are only used for the club callsigns (ON5VL, OR0L). A personal callsign (ON6DP…) needs **its own credentials**, otherwise its QSOs are marked « non configuré » (not configured). An upload mixing several TX calls is done group by group, each with its own credentials.
- **LoTW operations**: export, sign with TQSL, upload, read confirmations, status. `Confirmations` only reads the confirmations received (★ in the list). With the server on the VPS (no TQSL): `Exporter pour TQSL (.adi)` (export for TQSL), sign the file with TQSL on the club PC, then `Marquer comme envoyés` (mark as sent).

<a id="l-config"></a>
### 14.5 Configuration

**Synchronisation ▾ → ⚙ Configuration…** (administrators): the general settings, in tabs **CLUBLOG**, **eQSL**, **LoTW**, **QRZ** and **UDP**.

- **« Télécharger automatiquement les QSO lors de leur enregistrement »** box (upload QSOs automatically when they are logged): every new QSO under a club callsign is uploaded to that service by itself.
- Club logins and passwords (`👁` to see them while typing), delay, and `Tester` (test) to check the connection to the service. The window only shows « enregistré » (stored) for passwords; leaving the field empty keeps the value, `✕` deletes it.
- **QRZ** tab, **Recherche des correspondants** (correspondent lookup): login and password of a QRZ.com account. As soon as a correspondent is chosen (click on a callsign, Correspondant line, logbook form), their first name, town and, with an XML subscription, locator are filled in automatically (empty boxes only), with a « QRZ.com : … » note below the bands.
- **UDP** tab: forwarding of each QSO to logging programs (address, port, format).

| Service | What you need |
|---|---|
| Club Log | Account e-mail, an application password (Club Log → Settings → App Passwords), the application API key (requested once from the Club Log helpdesk). An access refusal stops uploads until the next successful test. |
| eQSL | eQSL callsign and password; "QTH Nickname" if the account has several QTHs. |
| QRZ.com | One QRZ logbook API key per callsign (QRZ → Logbook → Settings), XML subscription or higher. |
| LoTW | **TQSL** and the callsign's **certificate** installed on the PC running the server, the TQSL "Station Location" name, and the LoTW website login for confirmations. The certificate and its password never leave that PC. |
| UDP | Address, port and format expected by the program: WSJT-X "Logged ADIF" (Swisslog, Log4OM, HRD Logbook; usually port 2237), N1MM (port 12060), or raw ADIF. Packets are sent by the server: 127.0.0.1 if the server runs on the club PC. |

<a id="clavier"></a>
## 15. Keyboard shortcuts

| Key | Action |
|---|---|
| `Space` (hold) | PTT; in FT8 / FT4 / FT2, stops automatic transmission. Also works from a separate window. |
| `W` (hold) | TXW: listen on the transmit frequency (SPLIT). |
| `↑` `↓` | Frequency ± one step (the one on the Step row). |
| `F1` … `F12` | Macros in the RTTY and CW tabs (`F1`…`F8` in JTTY). |
| `Ctrl` + `Enter` / `Enter` | Transmit the typed text in RTTY / in JTTY. |
| `Esc` | Stop the current RTTY or JTTY transmission. |
| `Enter` (logbook form) | Save the QSO. |
| `Shift` + mouse wheel | RIT / XIT offset in 100 Hz steps. |
| `Ctrl` + `F5` | Reload the page after an update. |

These keys are ignored while you are typing in a text field.

<a id="problemes"></a>
## 16. Common problems

| Symptom | Likely cause and solution |
|---|---|
| Odd display, a button does not respond after an update | Old version in memory: `Ctrl` + `F5`. |
| « Ce navigateur n'est ni Chrome ni Edge » (this browser is neither Chrome nor Edge) | Open the page in Google Chrome or Microsoft Edge. |
| Serveur lamp red | Your internet connection is down; the page reconnects by itself when it comes back. |
| « Station hors ligne » (station offline) | The Station page on the club PC is closed or the PC has lost internet: tell a club manager. |
| No sound, empty waterfall, « La page Station n'envoie pas la BF » (the Station page is not sending audio) | At the club, the Station page must have audio enabled and the right sound input (section 18). At home, check your PC volume and the Volume slider. |
| Commands greyed out, « Prenez la main… » | You do not have control: `Prendre la main` or `Demander la main` (request control). |
| Nothing decoded in FT8 / RTTY… | Check the TRX mode (DATA-U; CW for CW), the frequency (↺ button), SQUELCH at 0, and DUAL RX off. The Synchro tab shows whether audio is arriving. |
| My FT8 answer goes out one period too late | The click came too late (more than 2 s into the next period). Click as soon as the decode appears. If it happens often, look at the "Décodages" box in the Synchro tab. |
| PTT refused | The message gives the reason: outside the authorised bands, SWR (do a TUNE), transmitting not enabled, listener callsign, maximum duration, TXW held… |
| The TX badge is red although I am not transmitting | Normal: dark red = transmit VFO. An actual transmission shows red frequency digits and a bright red TX badge. |
| Clicking ATT / IPO of the other VFO: the TRX changes side for a moment | Normal on the FTX-1: these settings can only be made on the active side; the TRX goes there for 2 to 3 s, without transmitting, then comes back. |
| « TUNE sans accord » (TUNE without a match), transmitting blocked on the band | The antenna cannot be matched on that frequency: do another TUNE, try the other antenna or another band, and tell a station manager. |
| A separate window does not open | Allow pop-up windows for remote.op0p.be (icon at the right of the address bar). |
| Name and QTH not filled in | The QRZ.com account is not set up, or the station is not on QRZ.com: type them in by hand. |
| Synchronisation: « non configuré » (not configured) | No credentials for that TX call: complete the « Identifiants … » box in the synchronisation window (14.4). |
| « Passage MAIN ↔ SUB refusé en réception simple » (MAIN ↔ SUB switching refused in single receive) | Normal on the FTX-1: in single receive, switching to SUB from the dashboard keyed it (seen at the club). On HF it only receives one side at a time: to listen to the VFO B frequency, use `A ⇄ B`. VFO B can still be tuned (mouse wheel, arrows, bands). |
| « Passage MAIN ↔ SUB par le dashboard désactivé » (MAIN ↔ SUB switching from the dashboard disabled) | An administrator has set `ftx1SubCat` to `false` in `config.json`: MAIN / SUB from the front panel only. |

<a id="admin"></a>
## 17. For administrators

A click on the `● Station` lamp opens the **TRX du club** (club TRX) menu:

| Command | What it does |
|---|---|
| Name of a TRX (FTX-1, FTDX10, FTDX101D / MP, IC-7300) | Switches to that TRX, after confirmation. The station restarts for a few seconds and control is kept. The TRX must be connected to the club PC and its port chosen once on the Station page. Not possible during a transmission. |
| `↻ Recharger la page Station` (reload the Station page) | Reloads the Station page on the club PC remotely (new version, page stuck…). The station is back within about ten seconds. |
| `⌨ Lecture CAT…` (CAT read) | Diagnostics: reads a raw value from the TRX (read only, list of allowed commands). Several reads on one line (« VS;FT;ST; »); `Effacer` (clear) empties the window. |

Administrators also have access to the logbook Synchronisation menu (14.4 and 14.5), to the export of every TX call, and can take back control (section 6). Management of members, passwords and the server is described in `LISEZMOI.md` and `README.md` (project repository).

<a id="club"></a>
## 18. The club PC (Station page)

For club managers. The PC connected to the TRX opens **https://remote.op0p.be/station** in Chrome (Web Serial). On Windows 10 / 11, the **RemoteStation-Setup** installer does everything needed: « Remote Station - Page Station » shortcut (Chrome with the right settings), start with Windows, no sleep; it can also install the server itself on that PC (see LISEZMOI-WINDOWS).

The Station page is **reserved for administrators**: the first time it is opened on a PC, log in with the callsign and password of an administrator. That PC then stays authorised for one year (renewed each time the page is opened), until « Se déconnecter » (log out). A non-administrator member is refused. The club PC's browser, which keeps the station token, also logs back in by itself.

🔒 The **Jeton de la station** (station token), **Vitesse (bps)** (speed) and **Bits de stop** (stop bits) fields are **locked**, to avoid mistakes. Only **ON6DP** and **ON4LUC**, logged in to the Station page with their callsign and password, can change them: « Se déconnecter » (log out) at the top of the page, then log in again with that callsign. The list is set in `config.json` (`stationEditors`). Choosing the model, port and audio remains free.

**FTDX101D / MP**: USB audio in stereo (MAIN receiver on the left, SUB on the right). In dual receive (DUAL RX), the Station page sends both channels: in RTTY, decoder B reads the SUB receiver, with its own waterfall to the right of A's; listening gets the mix of both, as in headphones. In single receive, one waterfall, as on the other transceivers.

1. Paste the **station token** (given by the server administrator), choose the TRX **model** and its **CAT port** (the first time). FTX-1: the **Enhanced COM Port** (CAT-1), and on the TRX the **RPTT SELECT** and **PC KEYING** settings at OFF (factory default): transmission is controlled through CAT.
2. **Activer l'audio** (enable audio) and choose the TRX sound input ("USB Audio CODEC" or "USB Audio Device" depending on the TRX); the level bar must move. Pick the card itself, not « Par défaut - … » / « Communications - … »: those Windows entries switch to another card when another TRX is plugged in (the page replaces them with the real card anyway).
3. **Sortie son vers le TRX** (sound output to the TRX, for FT8 / FT4 / FT2, RTTY, JTTY transmission): the TRX's USB sound card ("Speakers (USB Audio CODEC)"…), chosen automatically when possible. Never the PC speakers. The TRX must take DATA modulation from USB (TRX menu). Set the **transmit level** so that ALC stays low. Optional limiter: with `"digiAlcMax": 8` in `config.json`, the Station page **lowers that level by itself** as soon as ALC goes above 8 % during a digital transmission, and keeps the reached level for the following transmissions; it never goes back up by itself. By default (`0`), no limiter. Transmissions start on the server clock, even if the Windows clock is off.
4. Keep the Station page **alone in its window**; open the dashboard with its « Ouvrir le dashboard dans une autre fenêtre » (open the dashboard in another window) button.
5. Chrome → Settings → Performance: always keep remote.op0p.be active; Windows: sleep set to Never.

### Frozen TRX sound card (no more audio)

The TRX's built-in USB sound card sometimes freezes silent: empty level bar on the Station page, silent waterfall (only a hum at the far left), nothing to listen to. After 45 s of silence with the TRX connected, the Station page shows it in orange, and so does the dashboard (under « Écouter le TRX », with a message to the station managers and to whoever has control).

- **Relancer la carte son du TRX** (restart the TRX sound card): button on the Station page, or, for ON6DP and ON4LUC, the « Relancer la carte son » button of the dashboard alert and the TRX menu (click the station lamp). The USB sound card is restarted on the club PC, like « Disable / Enable » in Device Manager; audio stops for about ten seconds, the TRX stays on, the CAT port is not touched. Refused while transmitting.
- Once, install the **sound card helper** on the club PC: « Télécharger l'assistant carte son » link on the Station page (while it is not installed), unzip, double-click `installer-carte-son.cmd` and accept the administrator prompt. It starts with Windows, listens only on the PC itself (127.0.0.1:18099) and only obeys the remote.op0p.be Station page. The first time, Chrome may ask for access to « local network devices »: Allow. The Station page shows « Assistant carte son : en marche ».
- If the restart is not enough: switch the TRX off and on (the FTX-1 cannot be switched on by CAT).

Server installation and settings: see `LISEZMOI.md` and `README.md` (project repository).
