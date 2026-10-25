<!-- Fichier produit par native/manual2md.js à partir de public/help.html : modifier la page HTML, puis relancer le script. -->

# Remote Station UBA-LGE — user manual

*Online version: **HELP** button on the dashboard or https://remote.op0p.be/help — [version française](MANUEL.md)*

- [1. Logging in](#login)
- [2. The screen](#screen)
- [3. Taking and handing over control](#control)
- [4. Operating the transceiver](#trx)
   - [4.1 Every command](#commandes)
   - [4.2 Operating SPLIT](#split)
- [5. Listening](#listen)
- [6. Transmitting and safety](#tx)
- [7. Operators and chat](#operators)
- [8. Layout and separate windows](#layout)
- [9. Digital modes](#digital)
   - [9.1 FT8 · FT4 · FT2](#ft8)
   - [9.2 JT65](#jt65)
   - [9.3 RTTY](#rtty)
   - [9.4 WSPR](#wspr)
   - [9.5 JTTY](#jtty)
   - [9.6 CW](#cw)
   - [9.7 SSTV](#sstv)
   - [9.8 Synchro](#sync)
   - [9.9 QO-100](#qo100)
- [10. Correspondent, messages and macros](#messages)
- [11. Keyboard shortcuts](#keys)
- [12. Troubleshooting](#trouble)
- [13. The club PC (Station page)](#club)
- [14. Logs (station logbook)](#logs)

> [!NOTE]
> The dashboard runs in any recent browser (Chrome, Edge, Firefox) on a PC, Mac, tablet or phone. It is designed for a **1920 × 1080** screen or larger; on smaller screens the panels rearrange themselves. The interface is in French; the button and panel names are quoted below as they appear on screen. After a server update, press `Ctrl` + `F5` to reload the page.

<a id="login"></a>
## 1. Logging in

1. Open [https://remote.op0p.be](https://remote.op0p.be).
2. Enter **your callsign** and **your password** (given by a club administrator), then **Se connecter** (log in).
3. The browser stays logged in for **7 days**: reloading the page takes you straight back to the dashboard.
4. **Déconnexion** (log out, top right) ends the session and forgets the browser: do this on a shared PC.

**Listener** callsigns (ONL…) can see and hear everything but cannot transmit or change the power. After 15 minutes without any action you are logged out (a warning appears one minute before, with a « Rester connecté » / stay logged in button) — never during a transmission.

<a id="screen"></a>
## 2. The screen

### Top bar

| Item | Meaning |
|---|---|
| `● Serveur` | Link between your browser and the server (green = connected). |
| `● Station` | The Station page on the club PC is online. For administrators, a click opens the transceiver choice. |
| `● FTX-1 FTDX10 IC-7300` | The connected transceiver (highlighted) and its CAT link. |
| `👥 n` | Number of members online; click to open the **Opérateurs** panel (who is online, who has control, chat). Red dot = new message. |
| `Prendre la main` | Take control (see section 3). |
| `DX Cluster ▾` | Opens one of the two clusters in a new tab: **dx.op0p.be** (Ultimate Cluster) or **cluster.op0p.be** (CC-Cluster OP0P). |
| `HELP` | This manual. |

### Columns (wide screen)

1. **Left**: Antenne (antenna), RF front end, Mode, Filtres (filters), Station meters.
2. **Centre**: VFO A and B (MAIN / SUB), the Step row (step, A / B, ◀ ▶, MAIN / SUB / SPLIT, A → B, B → A, A ⇄ B, LOCK) and bands, then « Activité et modes numériques » (activity and digital modes) with the **Correspondant** line below the tabs.
3. **Right**: RX audio, DSP, Accord (tuner), TX.
4. **Opérateurs** (operators): panel opened by the `👥` button in the top bar (number of connected members), closed by default.

Each panel folds with the small arrow `▾` before its title, and can open in its own window with `⧉` (section 8).

<a id="control"></a>
## 3. Taking and handing over control

- Only one person **has control** (« a la main ») of the transceiver; everybody else can see and listen.
- **Prendre la main** (take control): button in the top bar, when nobody has control.
- If someone already has it: **Demander la main** (request control) in the Operators panel (`👥` button in the top bar; their panel opens with the request), or send them a chat message. The operator in control can **hand it over** to another member.
- **Libérer la main** (release control) when you leave. Control is released automatically after **15 minutes** without action.
- Without control, the commands are greyed out and a message reminds you to take control (« Prenez la main »).
- **Follow the operator** (remote training): `👁 Suivre` button to the right of the digital-mode tabs. When on (green), your dashboard shows the same tab as the operator in control (RTTY, FT8 / FT4 / FT2, CW…) and changes with them; the frequency, mode and transceiver settings are shared by everybody anyway. Clicking another tab yourself stops following; click 👁 Suivre to start again. The button is not shown to the operator in control.

<a id="trx"></a>
## 4. Operating the transceiver

### Frequency (VFO panel)

- Mouse **wheel** over the digits, or **drag** the digits; keyboard arrows `↑` `↓`; buttons `◀` `▶`.
- Choose the tuning step in **Step** (10 Hz to 100 kHz). `A` / `B`: on the FTX-1 they act like **MAIN / SUB** (the rig moves to that side); on the FTDX10 and IC-7300 they select the VFO being tuned. The mouse wheel on a VFO's digits always tunes that VFO.
- **Bands**: 160 m to 70 cm (depending on the transceiver).
- On each VFO display: RX in green = the receiving VFO; TX dark red = the **transmit VFO** (where a transmission would go; it stays lit while receiving). **Actual transmission**: TX bright red with a glow, frequency digits in red, TRX lamp in the top bar red. **Click RX** on a VFO to make it the receive VFO (MAIN / SUB, not on the IC-7300); **click TX** to make it the transmit VFO. Transceiver rule: **without SPLIT you transmit on the VFO you listen to, with SPLIT on the other one** (RX A → TX B; RX B → TX A). While transmitting, its frequency turns red; a VFO used neither for receive nor transmit (VFO B outside SPLIT) has its frequency greyed out. The **glowing frame** surrounds the transmit VFO; the VFO tuned by the wheel, arrows and band keys has its letter underlined (click the VFO display to choose it).

### Mode and filter

**Mouse wheel over « BW »** (top of each VFO screen): filter width of that VFO. On the FTX-1, VFO B sets the SUB receiver's filter.

- **Mode**: LSB, USB, CW-L/CW-U, RTTY, DATA-L/DATA-U (digital modes), AM, FM… (applied to the VFO shown).
- **Filtres**: bandwidth BW, IF SHIFT, CONTOUR, APF (in CW). NARROW: **NAR** badge on the VFO display.

### Antenna

**Antenne** panel, top left: `ANT 1` / `ANT 2` on the FTX-1 (SPA-1 amplifier sockets). The FTDX10 and IC-7300 cannot switch antennas remotely (buttons greyed out). Changing antenna is refused during a transmission.

### RF front end, DSP, dual VFO

- **RF front end**: RF gain, AGC. ATT and preamplifier (IPO / AMP1 / AMP2, AMP): badges on the VFO display.
- **DSP**: NB, DNR, NOTCH (and its frequency), DNF.
- **FTX-1: MAIN / SUB** (or A / B) chooses the active side of the rig, receive and transmit together, exactly like the front-panel MAIN / SUB key, without transmitting. The change takes one or two seconds. (Technical: VS CAT command alone, from Yaesu's CAT manual.)
- **FTX-1: the RF front end, Filtres and DSP panels act on the active side of the rig** (« A · MAIN » / « B · SUB » tag on their title line): SUB active → RF gain, AGC, BW, IF SHIFT, CONTOUR, APF, NB, DNR, NOTCH, DNF of the SUB side. The A / B keys on the Step row act like MAIN / SUB (tuned VFO and active side of the rig); use the mouse wheel on the other VFO's digits to change its frequency without changing side.
- **MAIN / SUB, SPLIT, A → B, B → A, A ⇄ B, LOCK**: on the Step row, after ◀ ▶. The RIT / XIT offset is set on each VFO display (mouse wheel on the value, CLEAR to reset it).
- **RIT / XIT / CLEAR** on each VFO display: click RIT or XIT to switch it on / off; mouse **wheel** over the offset = ± 10 Hz (± 100 Hz with Shift); **CLEAR** = offset to zero. VFO B has its own RIT / XIT on the FTX-1 (SUB side); the FTDX10 and IC-7300 have only one, on VFO A.

> [!TIP]
> Settings act on the real club transceiver and are shown to everybody. The indicators in the VFO panel (ATT, IPO, NB, DNR, NOTCH, DNF, NAR, AGC) summarise its state; **clicking ATT, IPO / AMP1 / AMP2, AMP, NB, DNR, NOTCH, DNF or NAR switches it on or off** (IPO → AMP1 → AMP2 → IPO). On the FTX-1, the VFO B display sets NB, DNR, NOTCH, DNF and NAR of the SUB side; ATT and preamp belong to each side: the rig only reports them for the active side, so clicking those of the other VFO switches the rig to that side for a moment (no transmission) and back; those of the inactive side are read when it becomes active again (« ? » until first read).

<a id="commandes"></a>
### 4.1 Every command, panel by panel

All commands need **control** (« la main »), except listening, your volume and the display. Settings act on the real transceiver at the club and everybody sees them.

**VFO A (MAIN) and VFO B (SUB) displays**, top centre

| Command | What it does |
|---|---|
| `RX` | Green: this VFO receives. Click: this VFO becomes the receive VFO (like MAIN / SUB). |
| `TX` | Dark red: transmit VFO. Bright red with a glow: transmitting. Click TX on the other VFO = SPLIT (section 4.2). |
| `BW 1.2K` | Filter width of this VFO; mouse wheel on it to widen or narrow. |
| « ÉMISSION SUR A / B » banner | Reminds you which VFO a transmission would use. |
| MAIN / SUB · 20M | Transceiver side and band of this VFO. |
| S-meter (S, +20…) | Received signal; when transmitting, see Station meters. |
| Frequency digits | Mouse wheel or drag up / down on a digit: it goes up or down. Click the display: this VFO becomes the one tuned by the arrows and bands (underlined letter). |
| Mode (DATA-U, USB…) | Mode of this VFO; change it in the Mode panel. |
| `RIT` / `XIT` | Click: switch the receive (RIT) or transmit (XIT) offset on / off. Mouse wheel on the value: ± 10 Hz (± 100 Hz with `Shift`). |
| `CLEAR` | Sets the RIT / XIT offset back to zero. |
| `ATT` | Input attenuator (very strong signals), click = on / off. Greyed out on 2 m / 70 cm. |
| `IPO` / `AMP1` / `AMP2` | HF / 6 m preamp; each click moves to the next (IPO = no preamp). On 2 m / 70 cm: `AMP` on / off. |
| `NB` `DNR` `NOTCH` `DNF` | Noise blanker, noise reduction, manual notch, automatic notch: click = on / off (levels are set in the DSP panel). |
| `NAR` | Narrow filter (NARROW), click = on / off. |
| `AGC AUTO` | AGC reminder (set in RF front end). |

**Step row and band row**, below the VFO displays

| Command | What it does |
|---|---|
| `10 Hz` … `100 kHz` | Step of the ◀ ▶ arrows, keyboard arrows and mouse wheel. |
| `A` / `B` | FTX-1: like MAIN / SUB (the transceiver moves to that side). FTDX10, IC-7300: choice of the tuned VFO. |
| `◀` `▶` | One step down / up. |
| `MAIN` / `SUB` | Active side of the transceiver (receive and transmit together), like the front-panel MAIN / SUB key, without transmitting; takes one or two seconds. |
| `SPLIT` | Transmit on the other VFO than the receive one (section 4.2). |
| `TXW` | **Hold** the button (or the `W` key) to listen on the transmit frequency (in SPLIT: the pile-up on VFO B); release = back to the DX. The VFOs are swapped while held and put back automatically (also after 15 s, or if the link drops). PTT refused while TXW is held. |
| `DUAL RX` | FTX-1: dual receive (MAIN and SUB heard together, S-meter and RX on both VFOs) or single receive (active side only). **Digital modes**: in dual receive the audio sent by the transceiver also contains the SUB side (e.g. 20 m FT8 during a QO-100 contact on MAIN); switch DUAL RX off to decode the active side only. MAIN / SUB works with or without DUAL RX (server setting `ftx1SubSingle`; with `false`, SUB only in dual receive). The S-meter of the inactive VFO stays visible, greyed out. The FTX-1 only accepts dual receive when one of the VFOs is on 144 / 430 MHz (not HF + HF). |
| `A → B` / `B → A` | Copies the frequency and mode of one VFO to the other. |
| `A ⇄ B` | Swaps both VFOs. |
| `LOCK` | Locks the **front-panel controls of the transceiver at the club** (so nobody touches them); the dashboard keeps working. |
| `160M` … `70CM` | Band change (last frequency and mode used on that band). On the right: « TUNE obligatoire » reminder or red HI-SWR block. |

**Left column**

| Panel / command | What it does |
|---|---|
| Antenne: `ANT 1` / `ANT 2` | FTX-1 antenna socket (on the SPA-1); refused while transmitting. |
| RF front end: **RF GAIN** | Receiver RF gain; lower it to calm a very strong signal or a noisy band. |
| RF front end: **AGC** `OFF` `FAST` `MID` `SLOW` `AUTO` | Automatic gain control speed. AUTO suits almost always; FAST for CW / digital, SLOW for SSB. |
| Mode: `LSB` `USB` `CW-L` `CW-U` `RTTY-L` `RTTY-U` `DATA-L` `DATA-U` `PSK` `AM` `AM-N` `FM` `FM-N` `DATA-FM` | Mode of the VFO shown below the buttons (« Mode appliqué à VFO A »). Digital modes (FT8, audio RTTY…): **DATA-U**. |
| Filtres: **BW** | Receive filter width. |
| Filtres: **IF SHIFT** | Moves the passband up or down (pushes an interfering signal out on one side). |
| Filtres: `CONTOUR` / `APF` | Tone shaping; APF = audio peak filter, CW only. |
| Station meters: **Po SWR ALC Id Vd COMP S** | Output power, SWR, ALC (digital modes: ≤ 8 %), PA current and voltage, compression, S-meter. RX / TX top left, transmit time on the right. |

**Right column**

| Panel / command | What it does |
|---|---|
| RX audio: **AF LEVEL** / **SQUELCH** | Volume and squelch **of the transceiver** (for everybody). |
| RX audio: `🔊 Écouter le TRX` / **VOLUME** | Listen to the transceiver audio in your browser; the volume only acts for you. |
| DSP: **NB** / **DNR** | Noise blanker and noise reduction level (OFF, then 1 to 10). |
| DSP: `NOTCH` + **FRÉQ. NOTCH** | Filter that removes one frequency (a whistling carrier); set the frequency by ear. |
| DSP: `DNF` | Automatic notch (removes carriers on its own). |
| Accord: `TUNER` | SPA-1 antenna tuner in line (on by default on HF / 6 m). |
| Accord: `TUNE` | Starts tuning: the transceiver sends a carrier for a few seconds. Mandatory after a band change; then check the SWR. |
| TX: `RX` / `TX` lamp | Real state of the transceiver. |
| TX: `PTT` | Hold to transmit (or the space bar); release = receive. |
| TX: **PUISSANCE** `−` `+` | Transceiver power; your licence limit is shown below. |
| TX: **GAIN MICRO**, `PROC`, **NIVEAU PROC** | Phone modulation settings (speech processor and its level). |
| TX: `VOX` | Can only be switched off remotely (never on). |

**Centre: activity and digital modes**

| Command | What it does |
|---|---|
| Tabs `ACTIVITÉ` … `SSTV`, `SYNCHRO`, `LOGS` | Station log, digital modes (section 9), clocks, logbook (section 14). |
| `👁 Suivre` | Your dashboard follows the tab of the operator in control (section 3). |
| `⧉` | Opens the digital modes in a separate window. |
| **CORRESPONDANT** line, NOM, QTH, LOCATOR, RST TX, RST RX, `LOG QSO` | The station worked and its reports: **RST TX** = report sent by the club station, **RST RX** = report received from the correspondent. In FT8 / FT4 / FT2, WSPR and JT65 they are dB (RST RX fills itself during the sequence); in RTTY, CW, SSTV and JTTY, RST 599. LOG QSO saves it in the logbook (section 10). |
| **TX CALL** `ON5VL (station)` / `your callsign` | Callsign of digital transmissions (FT8 / FT4 / FT2, RTTY, JTTY): the station's or yours; chosen by the operator in control and remembered for next time. Messages Tx1 to Tx6, `<MYCALL>` macros and the logbook (Station) follow. A QSO logged under your callsign stays in the club logbook but is not uploaded automatically to the club's LoTW, eQSL, Club Log or QRZ (export ADIF for your own log). |

<a id="split"></a>
### 4.2 Operating SPLIT (transmit and receive on two frequencies)

SPLIT is mainly used for a **DX expedition** listening away from its own frequency (« UP 5 », « listening 14 200 to 14 210 »). You **listen to the DX on VFO A** and **transmit on VFO B**.

1. Set **VFO A** (MAIN) on the DX frequency, in the right mode. Check that `RX` is green on VFO A.
2. Click `A → B`: VFO B takes the same frequency and mode.
3. Set the **transmit frequency on VFO B**: mouse wheel (or drag) on the VFO B digits, e.g. +5 kHz for « UP 5 ». On the FTX-1 the wheel on VFO B digits does not change the active side: you keep listening on A.
4. Click `SPLIT` (or `TX` on the VFO B display). The **TX** lamp and the glowing frame move to VFO B, its frequency turns white again and the banner shows « ÉMISSION SUR B ».
5. Listen to the DX on A; **hold TXW** (or `W`) to listen to the pile-up on the transmit frequency. To call, **PTT**: the transmission goes out on the VFO B frequency (digits in red). On release, back to receive on A.
6. To finish: click `SPLIT` again (or `TX` on VFO A). The TX lamp goes back to A.

> [!TIP]
> **Good to know**
> - Transceiver rule: without SPLIT you transmit on the VFO you listen on; with SPLIT, on the other one (RX on A → TX on B; if you listen on B, TX on A).
> - **FTX-1**: SPLIT is handled by the dashboard (« virtual » SPLIT, as in Hamlib) because the FTX-1 split command keys the transmitter. On PTT the transceiver moves to the SUB side to transmit, then back to MAIN; the transceiver at the club therefore briefly shows SUB while transmitting, which is normal. A SPLIT set on the transceiver front panel is followed by the dashboard.
> - The frequency **actually transmitted** (VFO B, XIT included) is checked: outside the authorised bands the PTT is refused (message « VFO B en SPLIT »).
> - Small offset (a few kHz at most): `XIT` on VFO A shifts only the transmission, without SPLIT; mouse wheel on the value to set the offset, `CLEAR` to go back.
> - In **FT8 / FT4 / FT2** there is no need for SPLIT: the transmission is placed in the passband with the TX marker of the waterfall (right click). If SPLIT is on, the message goes out on the other VFO, like the PTT.
> - Do not forget to switch SPLIT off at the end of the pile-up: otherwise the next operator would transmit on VFO B.

<a id="listen"></a>
## 5. Listening

- **RX audio** panel → `🔊 Écouter le TRX` (listen); set your own **Volume** just below (affects only you).
- **AF level** and **Squelch** act on the transceiver itself.
- Everybody can listen, even without control. If you hear nothing, see section 12 (audio must be enabled on the club PC).

<a id="tx"></a>
## 6. Transmitting and safety

- **PTT**: hold the big PTT button or the `Space` bar. Release = receive.
- **Power**: − / + buttons in the TX panel; your personal limit is displayed (e.g. ON3: 25 W).
- **Tuning**: after changing band, a `TUNE` is **mandatory** (Accord panel) before transmitting, then check the **SWR** (bottom left of the dashboard); after each band change a reminder flashes to the right of the 70CM key and stays until the TUNE (on 2 m and 70 cm, no tuner: only « check the SWR », 20 s). The SPA-1 tuner works on HF and 6 m only. TUNE counts as a transmission. FTX-1: the internal tuner is in the SPA-1 amplifier, which must be connected and switched on; otherwise TUNER and TUNE have no effect. The **tuner is switched on automatically** when the transceiver connects and at each HF / 6 m band change; clicking `TUNER` switches it off until the next band change.
- Mic gain, PROC and level, VOX (can be switched off remotely, never on).

> [!WARNING]
> **Automatic safety features** (cannot be bypassed from the dashboard):
> - Transmission only in the authorised bands, checked on the frequency actually transmitted (SPLIT and XIT included).
> - Maximum length of one transmission: **120 s**, then cut; release the PTT before transmitting again.
> - Immediate cut if you lose the link, if the club PC loses internet, or if the Station page closes.
> - **SWR** above 2.5:1, or **HI-SWR** reported by the transceiver while transmitting: transmission cut and PTT refused on that frequency (±25 kHz) until a TUNE.
> - **TUNE without a match**: if the FTX-1 reports HI-SWR at the end of a TUNE, transmitting is **blocked on the whole band** (PTT, digital modes; TUNE still allowed) to protect the PA. A red message appears to the right of the band row. The block is lifted as soon as a new TUNE succeeds; otherwise try the other antenna or tell a station manager.
> - At the club, the transceiver is returned to receive if it transmits 2 min without modulation or 5 min without a break.
> - Power limited to your licence class; listener callsigns: no transmission at all.

Transmitting is only possible if the administrators have enabled it on the server.

<a id="operators"></a>
## 7. Operators and chat

- The **Opérateurs** panel opens and closes with the `👥` button in the top bar (number of connected members). A red dot on `👥` means a new message.
- It shows who has control and is a **chat** between connected members (messages are not kept after a server restart).
- Control requests and hand-overs also appear there.
- The **Activité** tab (centre) lists events: logins, control changes, station online, transceiver connected…

<a id="layout"></a>
## 8. Layout and separate windows

- `⧉` button at the top right of a panel: the panel opens in **its own window**, to place wherever you like (second screen…). `⧉ Ramener` puts it back.
- The `⧉` button to the right of the tabs opens **all digital modes** in a separate window, on the mode currently shown.
- The layout is remembered: on the next visit the windows reopen in place if Chrome **allows pop-up windows** for remote.op0p.be (icon at the right of the address bar → Always allow).

<a id="digital"></a>
## 9. Digital modes

The centre tabs: **Activité**, **FT8 · FT4**, **RTTY**, **WSPR**, **JT65**, **JTTY**, **CW**, **SSTV** and, further right, **Synchro**.

- **Decoding runs on the server**, on the server's (synchronised) clock: the clocks of your PC and of the club PC do not matter.
- Transceiver audio is only sent while someone listens or watches a digital-mode tab.
- Choosing a frequency in a tab's list sends the transceiver there, in **DATA-U** (in CW for the CW tab) — you need control. The `↺` button next to the list brings the transceiver back to that frequency after you have turned the VFO.
- Each tab has a **waterfall** (0 to 3000 Hz); a status line reports problems (station offline, audio not enabled, transceiver not in DATA-U…).
- Transmission is done as **ON5VL** in **FT8 · FT4 · FT2**, **RTTY** and **JTTY** (you need control and transmit enabled); WSPR, JT65, CW and SSTV are receive-only for now *(soon)*.

<a id="ft8"></a>
### 9.1 FT8 · FT4 · FT2

- `FT8` / `FT4` / `FT2` buttons: the transceiver goes to that mode's calling frequency on its band.
- **FT2**: the fast mode of Decodium (IU8LMC) — 3.75 s periods, 2.5 s signal, 167 Hz wide (frequencies: Decodium's list, e.g. 14084 kHz). Stations transmitting « asynchronously » (at any time) are decoded too; the time shown is then that of the period in which the signal starts (larger DT). The FT2 of « WSJT-X Improved » is a different, incompatible mode.
- **Decoder**: the **WSJT-X 3** decoding engine, which includes the multi-pass FT8 decoder of **JTDX** (the status line shows « moteur WSJT-X »). In FT8, three passes per period, as in WSJT-X / JTDX: an **early pass** at 11.8 s (the reply can go out in the next period), a **normal pass** at the end of the signal, then a **deep pass** (subtraction of decoded signals, several cycles, OSD) that adds the weakest stations a few seconds later. Measured sensitivity (single signal, white noise, 50 % decodes): FT8 −22 dB without help, about −24 dB with a priori help; FT4 −17.5 dB; FT2 about 3 dB better than before.
- **A priori help (AP)**, as in WSJT-X / JTDX: the decoder knows the call we transmit under (TX CALL) and, during a QSO, the correspondent and the sequence step; it then looks for the expected messages down to 2 to 3 dB lower. Such decodes carry the mark **a1**…**a7** after the message. The JTDX callsign database (~100,000 calls) rejects very weak false decodes.
- **Country, km, Az**: for the station sending each message, the DXCC country (AD1C cty.dat file, as in WSJT-X / JTDX), the distance from the club locator and the azimuth (antenna direction). The distance comes from the locator in the message; without a locator it is approximate (centre of the country, marked « ≈ »).
- **Width of the two lists**: drag the vertical line between « Activité de bande » and « Fréquence RX » (double-click: half and half); remembered in your browser.
- **Already worked stations**: messages from a station already in the log **under the current TX CALL**, on the same band and mode, are shown green and struck through (like WSJT-X / JTDX « worked before »). With another TX CALL (e.g. your own call), only QSOs made under that call count.
- **When the reply goes out**: in FT8 a transmission must start at the beginning of a period (at most 2.3 s late, otherwise the correspondent no longer decodes it; FT4: 0.8 s). The early decode arrives around 12.7 s: a click before the end of the correspondent's period (or in the first 2 seconds of the next one) sends the reply at once. A later click sends it in the next period on the same side (30 s later in FT8); the message at the bottom of the page says so. **The transceiver keys up as soon as you click** (if the signal starts within 8 s in FT8, 4 s in FT4, 2 s in FT2); the signal itself starts at the beginning of the period.
- **dB**: the signal-to-noise ratio is WSJT-X's (in 2.5 kHz); reports sent are therefore real reports, as with WSJT-X / JTDX.
- **Activité de bande** (band activity): all decoded messages (CQ in green, messages for ON5VL / OR0L in red); **Fréquence RX**: those on your frequency.
- **Split** as in WSJT-X: **left click** on the waterfall or a line = receive frequency, **right click** = transmit frequency; « TX ← RX » and « RX ← TX » buttons.
- **Click the callsign** (underlined) or **double-click** a message: its sender becomes the contact (callsign, locator, report), messages Tx1 to Tx6 are prepared and, with control, the transmission starts in the next period.
- **Transmitting** (like « Enable Tx » + « Auto Seq » in WSJT-X): clicking a message **Tx1 to Tx7** (below the lists of the tab, as in WSJT-X) sends it **every period** (one in two) until an answer comes. You need control, the TX VFO in **DATA-U** and power within your limit. The sent message shows in yellow in the lists; the bar under the lists is green while receiving, red while transmitting.
- **The sequence advances by itself** from the contact's answers: his locator → Tx2 (report); his report → Tx3 (R+report); R+report → Tx4 (RR73); RRR or RR73 → Tx5 (73), from the next period (if the answer is decoded just after our transmission started, it is cut and restarted at once with the right message in the same period, as WSJT-X does). After sending RR73 or 73: end of QSO, transmission stops, back to Tx6 (CQ) and an offer to **save the QSO in the logbook**.
- **Répondre au 1er** (answer the first): while calling CQ (Tx6), the station answering you becomes the contact and the sequence starts without a click (« Call 1st » in WSJT-X). **To answer a CQ: click his callsign** (dotted underline in the message) **or double-click his message** (with control): the transceiver sends Tx1 in the next period, opposite to the station's, then the sequence runs on its own, as in WSJT-X. A click elsewhere on the line only sets the receive frequency. Our own transmission is no longer decoded a second time in the lists.
- **Période**: « auto » transmits in the other period than the contact (double-click his message), otherwise keeps the period of the first message; « 1re » / « 2e » force it (1st = 00 and 30 s in FT8).
- **Waterfall settings** (above the scale, as in WSJT-X): **Gain** = contrast (to the right, weak signals stand out), **Zéro** = background level, **Plat** = flat background across the width (corrects the transceiver filter slope), four colour sets (**JTDX** by default: blue noise, yellow signals, red strong signals), scrolling **speed** (like JTDX « Spd »: slow = tighter signals and more history, normal by default), ↺ = defaults. They apply to every waterfall (FT8, RTTY, CW…) and are remembered in your browser.
- **Fine JTDX-style waterfall**: 1.46 Hz bins (instead of 6.25 Hz), averaged over 0.8 s (FT8 signals become solid blocks); scale ticks every 50 / 100 / 500 Hz. In FT8 / FT4 / FT2 / JT65, a white line marks the start of each period, with the UTC time and the band (« 19:55:15 20m »), as in JTDX.
- **Handle under the waterfall**: drag it up to enlarge the message lists (double-click: original size).
- Stops: `■ Arrêter` (or the space bar); the called contact answers someone else; the same message for 6 min without answer (watchdog); control lost.
- Transmit frequency: the red « TX 1500 » flag below the scale and the solid red line on the waterfall (right click to move it); receive: green « RX 1500 » flag and solid green line (left click). In **SPLIT**, the message goes out on the other VFO than the receive one, like the PTT.

<a id="jt65"></a>
### 9.2 JT65

Same window as FT8 (one-minute periods); the transceiver goes to the JT65 frequency of its band. Decodes arrive around second 52.

<a id="rtty"></a>
### 9.3 RTTY

- Set the **shift** and **speed** (170 Hz / 45.45 baud by default), then **click on the signal** in the waterfall: the yellow (Mark) and blue (Space) markers must sit on its two traces; otherwise press `Inversé` (reverse).
- The M / S bars of the tuning indicator should flicker alternately. Raise the **squelch** (« Silencieux ») if characters appear on noise.
- Received text scrolls across the full width (`Effacer` on the right of its title clears it); double-click a received callsign = contact. Below: macros `F1` to `F12` on one row, then the text to send with `Émettre`, `Effacer` and `Log QSO`.
- **Macros**: a click (or `F1`…) transmits at once (section 10); **Shift+click** adds the macro to the text without transmitting.
- **Émettre** (or `Ctrl`+`Enter`): the text goes out in RTTY on the receive frequency (same shift and speed), then the transceiver returns to receive. The sent text shows in the receive window, first grey then red letter by letter as it goes out (« fin dans N s »); while transmitting the button becomes `■ Arrêter` (stop). The transceiver must be in **DATA-U** (the signal goes through its sound card), 600 characters at most per send.

<a id="wspr"></a>
### 9.4 WSPR

Choose the band; every 2 minutes (about ten seconds after each even minute) the list grows: callsign, locator, power, frequency, drift and distance from the station.

<a id="jtty"></a>
### 9.5 JTTY

- New WSJT-X 3.3 mode for keyboard-to-keyboard and contests: no periods, each message appears **frame by frame** (1.9 s); `▌` = message still arriving.
- Left click = receive, right click = transmit, double-click = contact; macros `F1` to `F8` (the WSJT-X ones): a click transmits at once, **Shift+click** adds them to the message.
- **Émettre** (or `Enter`): the message goes out at once (no periods) on the TX frequency, encoded by WSJT-X, then back to receive. 80 characters per message (longer: two messages in a row); transceiver in **DATA-U**.

<a id="cw"></a>
### 9.6 CW

- The transceiver goes to CW. **Click on a signal** in the waterfall: the decoder locks onto the nearest one (yellow marker) and learns the speed (shown in words per minute). Right click: exact tuning where you click.
- **Filter** 100 Hz by default (50 Hz with QRM, 200–400 Hz to search); raise the **squelch** if letters appear on noise. The LED follows the keying.
- Double-click a received callsign = contact; macros `F1` to `F12` (added to the text: CW transmission comes in a future version); `Log QSO`.

<a id="sstv"></a>
### 9.7 SSTV

- **Receive**: pictures start by themselves (VIS code) and are drawn line by line. Modes Martin M1/M2, Scottie S1/S2/DX, Robot 36/72, PD 50 to PD 290; frequency offset and slant corrected. The **gallery** keeps the last 12 (click = show); `PNG` saves the picture shown to your PC. The server also keeps every picture.
- **Prepare a picture**: `Images du PC…` (pictures from your PC, or drag and drop), CQ card, test pattern or received picture; it is cropped to the selected mode's format. Three text lines (top, centre, bottom) with tags `<CALL>`, `<MYCALL>`, `<RST>`…; size and colour. Right click a thumbnail: remove it.
- `▶ Écouter` plays the SSTV signal on your PC; `WAV` saves it (test with MMSSTV or a phone app).

<a id="sync"></a>
### 9.8 Synchro

Server time, offset of your PC, delay of the link with the station and mean DT of FT8 decodes: useful to check that everything is in step.

- **Votre PC** (your PC): the **current** offset between the clock of the PC running your browser and the server, in milliseconds (in seconds above one second), with its accuracy (± half the shortest network round trip). Not to be confused with the « Offset » column of NetTime or Meinberg, which shows the error found **before** their last clock correction.

<a id="qo100"></a>
### 9.9 QO-100

The FT8 · FT4, RTTY and CW lists offer « **QO-100 · FI 2 m / 70 cm** »: the frequency to set on the transceiver **before the 2.4 GHz up-converter**, to transmit on 2400.040 MHz (FT8 / FT4), 2400.025 MHz (CW) or 2400.090 MHz (RTTY). Example: FT8 on **432.540 MHz** with the club's 70 cm converter. Only the IFs the connected transceiver can reach are listed (2 m and 70 cm: FTX-1).

<a id="messages"></a>
## 10. Correspondent, messages and macros

- **Correspondant** line, below the digital-mode tabs: callsign, first name, QTH, locator, FT8 report, RST and the `Log QSO` button. First name, QTH and locator are looked up on **QRZ.com** as soon as a new contact is chosen (if a QRZ account is set in Logs → Configuration). Messages and macros are in each tab: **Tx1 to Tx7** in FT8 · FT4 · FT2 (below the lists), **F1 to F12** in RTTY and CW and **F1 to F8** in JTTY (on one row, above the text to send).
- **RTTY and JTTY: a macro starting with `<TX>` is transmitted at once** when clicked (or with its `F1`… key), as in FLDIGI, then the rig goes back to receive (`<RX>`, always done at the end of the message). These macros have a red edge on the left; all default macros do. **Shift+click**: add the macro to the text to send without transmitting, to build a custom message then « Émettre ». If the macro contains `<CALL>` and no contact is chosen, nothing is sent.
- In **RTTY**, the transmitted text appears in the receive window first in grey, then each letter turns red as it goes out; the status line shows « fin dans N s » (ends in N s), so you can get the next macro ready. After « Arrêter », the part not sent stays grey and struck through. RTTY / JTTY decoding is paused while transmitting (the rig feeds our own signal back into its audio).
- A macro without `<TX>` (and every CW macro) is added to the text to send in its tab. **Right click** (or `✎`): edit it — name, text, preview, back to the default. Your macros are stored on the server, for you only.
- FT8 · FT4 · FT2: **clicking Tx1 to Tx7 starts automatic transmission** of that message (see 9.1). Tx7: free text, 13 characters (right click to edit).

| Tag | Replaced by | Tag | Replaced by |
|---|---|---|---|
| `<MYCALL>` | transmitted callsign (ON5VL) | `<CALL>` | contact |
| `<NAME>` | their first name | `<QTH>` | their QTH |
| `<RST>` | report sent | `<LOC>` | their locator |
| `<MYLOC>` | station locator | `<MYQTH>` | station QTH |
| `<OPCALL>` | your own callsign (operator) | `<CNTR>` | serial number (001…) |
| `<INCR>` | moves to the next serial | `<ZT>` / `<ZD>` | UTC time / date |
| `<TX>` | at the start: transmit at once on click (RTTY, JTTY) | `<RX>` | back to receive at the end (always done) |
| `<LOG>` | opens the « Enregistrer le QSO » form |  |  |

<a id="keys"></a>
## 11. Keyboard shortcuts

| Key | Action |
|---|---|
| `Space` (hold) | PTT — also from a panel opened in a separate window |
| `W` (hold) | TXW: listen on the transmit frequency (SPLIT) |
| `↑` `↓` | Frequency ± one step |
| `F1` … `F12` | Macros in the RTTY and CW tabs (`F1`…`F8` in JTTY): transmitted at once if the macro starts with `<TX>` |
| `Ctrl` + `Enter` / `Enter` | Transmit the typed text in RTTY / in JTTY |
| `Ctrl` + `F5` | Reload the page after an update |

These keys are ignored while typing in a text field.

<a id="trouble"></a>
## 12. Troubleshooting

| Symptom | Solution |
|---|---|
| Odd display, a button does nothing after an update | `Ctrl` + `F5`. |
| « Station hors ligne » (station offline) | The Station page on the club PC is closed or the PC has lost internet: tell a club manager. |
| No sound, empty waterfall, « La page Station n'envoie pas la BF » | At the club, the Station page must have « Activer l'audio » (enable audio) on and the right sound input (see section 13). |
| « Prenez la main… » | You do not have control: « Prendre la main » or « Demander la main ». |
| Nothing decoded in FT8 / RTTY… | Check the transceiver mode (DATA-U; CW for CW) and the frequency; the Synchro tab shows whether audio is arriving. |
| A separate window does not open | Allow pop-up windows for remote.op0p.be (icon at the right of the address bar). |
| PTT refused | The message gives the reason: outside the authorised bands, SWR (press TUNE), transmitting not enabled, listener callsign, maximum duration… |
| The TX badge is red although I am not transmitting | Normal: dark red = transmit VFO. An actual transmission shows red frequency digits and a bright red TX badge. |
| Clicking ATT / IPO of the other VFO: the rig changes side for a moment | Normal on the FTX-1: these settings only apply to the active side; the rig goes there for 2 to 3 s, without transmitting, then comes back. |
| « Passage MAIN ↔ SUB par le dashboard désactivé » | An administrator set `ftx1SubCat` to `false` in `config.json`: MAIN / SUB on the front panel only. |

<a id="club"></a>
## 13. The club PC (Station page)

For club managers. The PC connected to the transceiver opens **https://remote.op0p.be/station** in Chrome (Web Serial). On Windows 10 / 11, the **RemoteStation-Setup** installer does it all: « Remote Station - Page Station » shortcut (Chrome with the right settings), start with Windows, no sleep; it can also install the server itself on that PC (see LISEZMOI-WINDOWS).

The Station page is **reserved for administrators**: the first time it is opened on a PC, log in with an administrator's call and password. That PC then stays authorised for a year (renewed each time the page is opened), until « Se déconnecter » (log out). Non-administrator members are refused. The club PC's browser, which keeps the station token, also logs in by itself. An administrator can **reload the Station page remotely**: click the **STATION** lamp at the top left → « ↻ Recharger la page Station » (the station is back within about ten seconds).

1. Paste the **station token** (given by the server administrator), choose the transceiver **model** and its **CAT port** (first time only). FTX-1: the **Enhanced COM Port** (CAT-1), and on the rig **RPTT SELECT** and **PC KEYING** set to OFF (factory default): transmission is controlled through CAT.
2. **Activer l'audio** (enable audio) and choose the transceiver's sound input (often « USB Audio CODEC »); the level bar must move.
3. **Sortie son vers le TRX** (sound output to the transceiver, for FT8 / FT4 / FT2): the transceiver's USB sound card (« Speakers (USB Audio CODEC) »…), picked automatically when possible. Never the PC speakers. The transceiver must take DATA modulation from USB (transceiver menu). Set the **transmit level** so that ALC stays low. Optional limiter: with `"digiAlcMax": 8` in `config.json`, in digital modes (FT8 / FT4 / FT2, RTTY, JTTY…) the Station page **lowers that level automatically** as soon as ALC goes above 8 %, during the transmission, and keeps the reached level for the next ones (message « ALC … ramené de 30 à 24 % » shown to the operator in control); it never goes back up on its own. Default (`0`): no limiter. Transmissions start on the VPS clock, even if the Windows clock is off.
4. Keep the Station page **alone in its window**; open the dashboard with its « Ouvrir le dashboard dans une autre fenêtre » button.
5. Chrome → Settings → Performance: always keep remote.op0p.be active; Windows: sleep set to Never.

Server installation and settings: see `LISEZMOI.md` and `README.md` (project repository).

<a id="logs"></a>
## 14. Logs (station logbook)

**Logs** tab (right of Synchro): the station logbook, shared by all members, with upload to **LoTW**, **eQSL**, **Club Log** and **QRZ.com**, **ADIF** or **Cabrillo** export, and **UDP** forwarding to PC logbooks (Swisslog, HRD Logbook, Log4OM, N1MM Logger+…).

- **Logging a QSO**: `⇩ TRX` takes the transceiver frequency and mode (in DATA: the mode of the tab on screen, FT8, RTTY…), the power, and the Correspondant line (call, name, QTH, locator). The UTC time is taken when you type the first letter of the call; `⟳ Maintenant` (now) resets it. `Enter` or `Enregistrer le QSO` (save). A duplicate (same call, band and mode within half an hour) is reported before saving; if the QSO already in the log (e.g. saved at the end of the QSO) lacks the name, QTH, locator or received RST, you are offered to **complete** it instead of creating a 2nd QSO.
- **Without leaving the RTTY, JTTY or CW tab**: `Log QSO` button (next to « Émettre », and at the end of the Correspondant line), like FLDIGI's « Save QSO ». A form opens, already filled in: call, name, QTH, locator and RST of the correspondent, frequency (in RTTY: the signal frequency, carrier + audio offset) and the tab's mode, power, start time (when the correspondent was chosen) and end time (now). Correct if needed (RST received…), then `Enregistrer dans le carnet` (save). A macro containing `<LOG>` (e.g. the « 73 ») also opens this form.
- **QO-100**: with the converter IF (e.g. 432.525 MHz) the QO-100 box is ticked and the 2400.xxx MHz uplink frequency is logged (QO-100 satellite, downlink 10489.xxx MHz).
- **Form**: frequency and mode follow the transceiver's **active VFO** automatically (VFO B when on SUB); a frequency or mode typed by hand is kept until the next QSO (⇩ TRX to take the transceiver's again).
- **List**: the last 300 QSOs (search by call, name or operator). **TX call** column: the callsign the QSO was made under, the same as TX CALL on the dashboard at the time (the operator shows on hover). The TX call of the form follows the one on the Correspondent line; with control, changing it in the form also changes the transmit call. **QTH** and **DXCC** (country, from the call) columns. Columns LoTW, eQSL, CL (Club Log), QRZ: **·** not sent yet, **✓** sent, **✗** rejected (hover for details), **★** confirmed on LoTW. Click a row to edit or delete the QSO (its author or an administrator).
- **Exporter ▾** (export): ADIF 3 (.adi) or Cabrillo 3 (.log, with the contest name), for one call and an optional date range.
- **Synchronisation ▾** (administrators): one window per service, as in Swisslog — **Détails** tab (call, optional date range, resend QSOs already sent, delay; Club Log: « Effacer le log ClubLog existant », clear the existing log) then `Télécharger` (upload); **Traitement** tab: progress, report, `Arrêt` (stop). **Opérations LoTW**: export, sign with TQSL, upload, read confirmations, status; `Confirmations` only reads the confirmations received.
- **⚙ Configuration** (administrators): tabs CLUBLOG, eQSL, LoTW, QRZ, UDP. « Upload QSOs automatically when they are logged » box, logins and passwords (👁 button to see them while typing), delay, `Tester` (test). Passwords and keys stay on the server: the window only shows « enregistré » (stored); an empty field keeps the value, ✕ deletes it. QRZ tab, **Contact lookup**: user name and password of a QRZ.com account; as soon as a contact is chosen (click on a callsign, Correspondant line, logbook form), their first name, town (QTH) and, with an XML subscription, locator are filled in automatically (empty fields only), with a « QRZ.com: … » note below the bands.

| Service | What you need |
|---|---|
| Club Log | Account e-mail, an application password (Club Log → Settings → App Passwords), the application API key (requested once from the Club Log helpdesk). An access refusal stops uploads until the configuration is saved again. |
| eQSL | eQSL call and password; « QTH Nickname » if the account has several QTHs. |
| QRZ.com | One QRZ logbook API key per call (QRZ → Logbook → Settings), XML subscription or higher. |
| LoTW | **TQSL** and the call's **certificate** installed on the PC running the server (the club's Windows server), the TQSL « Station Location » name, and the LoTW website login for confirmations. The certificate and its password never leave that PC. With the server on the VPS: « Exporter pour TQSL (.adi) », sign the file with TQSL on the club PC, then « Marquer comme envoyés » (mark as sent). |
| UDP | Address, port and format expected by the logbook: WSJT-X « Logged ADIF » (Swisslog, Log4OM, HRD Logbook; usually port 2237), N1MM (port 12060), or raw ADIF. Packets are sent by the server: 127.0.0.1 when the server runs on the club PC. |
