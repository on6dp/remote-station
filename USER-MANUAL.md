<!-- Fichier produit par native/manual2md.js à partir de public/help.html : modifier la page HTML, puis relancer le script. -->

# Remote Station UBA-LGE — user manual

*Online version: **HELP** button on the dashboard or https://remote.op0p.be/help — [version française](MANUEL.md)*

- [1. Logging in](#login)
- [2. The screen](#screen)
- [3. Taking and handing over control](#control)
- [4. Operating the transceiver](#trx)
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
- [10. Stored messages and macros](#messages)
- [11. Keyboard shortcuts](#keys)
- [12. Troubleshooting](#trouble)
- [13. The club PC (Station page)](#club)
- [14. Logs online (station logbook)](#logs)

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
| `👥 n` | Number of members online; click for the list. |
| `Prendre la main` | Take control (see section 3). |
| `HELP` | This manual. |

### Columns (wide screen)

1. **Left**: Antenne (antenna), RF front end, Mode, Filtre (filter), Station meters.
2. **Centre**: VFO A and B (MAIN / SUB), Step and bands, then « Activité et modes numériques » (activity and digital modes).
3. **Right**: RX audio, DSP, Accord (tuner), TX.
4. **Far right**: Opérateurs (operators and chat) and Messages pré-enregistrés (stored messages).

Each panel folds with the small arrow `▾` before its title, and can open in its own window with `⧉` (section 8).

<a id="control"></a>
## 3. Taking and handing over control

- Only one person **has control** (« a la main ») of the transceiver; everybody else can see and listen.
- **Prendre la main** (take control): button in the top bar, when nobody has control.
- If someone already has it: **Demander la main** (request control) in the Operators panel, or send them a chat message. The operator in control can **hand it over** to another member.
- **Libérer la main** (release control) when you leave. Control is released automatically after **15 minutes** without action.
- Without control, the commands are greyed out and a message reminds you to take control (« Prenez la main »).

<a id="trx"></a>
## 4. Operating the transceiver

### Frequency (VFO panel)

- Mouse **wheel** over the digits, or **drag** the digits; keyboard arrows `↑` `↓`; buttons `◀` `▶`.
- Choose the tuning step in **Step** (10 Hz to 100 kHz); `A` / `B` selects the VFO being tuned.
- Direct entry: type the frequency in kHz, then **Aller** (go).
- **Bands**: 160 m to 70 cm (depending on the transceiver).
- On each VFO display: RX in green = the receiving VFO; TX in red = the transmit VFO (bright red while transmitting; in SPLIT it is VFO B).

### Mode and filter

- **Mode**: LSB, USB, CW-L/CW-U, RTTY, DATA-L/DATA-U (digital modes), AM, FM… (applied to the VFO shown).
- **Filtre**: bandwidth BW, NARROW, IF SHIFT, CONTOUR, APF (in CW).

### Antenna

**Antenne** panel, top left: `ANT 1` / `ANT 2` on the FTX-1 (SPA-1 amplifier sockets). The FTDX10 and IC-7300 cannot switch antennas remotely (buttons greyed out). Changing antenna is refused during a transmission.

### RF front end, DSP, dual VFO

- **RF front end**: RF gain, ATT, preamplifier (IPO / AMP1 / AMP2…), AGC.
- **DSP**: NB, DNR, NOTCH (and its frequency), DNF.
- **Dual** (between the two VFOs): MAIN / SUB, A → B, B → A, A ⇄ B, SPLIT, RIT, XIT, offset, LOCK.

> [!TIP]
> Settings act on the real club transceiver and are shown to everybody. The indicators in the VFO panel (ATT, IPO, NB, DNR, NOTCH, DNF, NAR, AGC) summarise its state.

<a id="listen"></a>
## 5. Listening

- **RX audio** panel → `🔊 Écouter le TRX` (listen); set your own **Volume** just below (affects only you).
- **AF level** and **Squelch** act on the transceiver itself.
- Everybody can listen, even without control. If you hear nothing, see section 12 (audio must be enabled on the club PC).

<a id="tx"></a>
## 6. Transmitting and safety

- **PTT**: hold the big PTT button or the `Space` bar. Release = receive.
- **Power**: − / + buttons in the TX panel; your personal limit is displayed (e.g. ON3: 25 W).
- **Tuning**: after changing band, press `TUNE` (Accord panel) before transmitting. TUNE counts as a transmission.
- Mic gain, PROC and level, VOX (can be switched off remotely, never on).

> [!WARNING]
> **Automatic safety features** (cannot be bypassed from the dashboard):
> - Transmission only in the authorised bands, checked on the frequency actually transmitted (SPLIT and XIT included).
> - Maximum length of one transmission: **120 s**, then cut; release the PTT before transmitting again.
> - Immediate cut if you lose the link, if the club PC loses internet, or if the Station page closes.
> - **SWR** above 2.5:1: transmission cut and PTT refused on that frequency (±25 kHz) until a TUNE.
> - At the club, the transceiver is returned to receive if it transmits 2 min without modulation or 5 min without a break.
> - Power limited to your licence class; listener callsigns: no transmission at all.

Transmitting is only possible if the administrators have enabled it on the server.

<a id="operators"></a>
## 7. Operators and chat

- The **Opérateurs** panel shows who has control and is a **chat** between connected members (messages are not kept after a server restart).
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
- Choosing a frequency in a tab's list sends the transceiver there (**QSY**), in **DATA-U** (in CW for the CW tab) — you need control.
- Each tab has a **waterfall** (0 to 3000 Hz); a status line reports problems (station offline, audio not enabled, transceiver not in DATA-U…).
- Transmitting in the digital modes (as **ON5VL**) comes in a future version *(soon)*: the « Émettre » (transmit) buttons are greyed out, but messages and macros can already be prepared.

<a id="ft8"></a>
### 9.1 FT8 · FT4 · FT2

- `FT8` / `FT4` / `FT2` buttons: the transceiver goes to that mode's calling frequency on its band.
- **FT2**: the fast mode of Decodium (IU8LMC) — 3.75 s periods, 2.5 s signal, 167 Hz wide (frequencies: Decodium's list, e.g. 14084 kHz). Stations transmitting « asynchronously » (at any time) are decoded too; the time shown is then that of the period in which the signal starts (larger DT). The FT2 of « WSJT-X Improved » is a different, incompatible mode.
- **Activité de bande** (band activity): all decoded messages (CQ in green, messages for ON5VL / OR0L in red); **Fréquence RX**: those on your frequency.
- **Split** as in WSJT-X: **left click** on the waterfall or a line = receive frequency, **right click** = transmit frequency; « TX ← RX » and « RX ← TX » buttons.
- **Double-click** a message: its sender becomes the contact (callsign, locator, report) and messages Tx1 to Tx6 are prepared.

<a id="jt65"></a>
### 9.2 JT65

Same window as FT8 (one-minute periods); the transceiver goes to the JT65 frequency of its band. Decodes arrive around second 52.

<a id="rtty"></a>
### 9.3 RTTY

- Set the **shift** and **speed** (170 Hz / 45.45 baud by default), then **click on the signal** in the waterfall: the yellow (Mark) and blue (Space) markers must sit on its two traces; otherwise press `Inversé` (reverse).
- The M / S bars of the tuning indicator should flicker alternately. Raise the **squelch** (« Silencieux ») if characters appear on noise.
- Received text scrolls on the left; double-click a received callsign = contact. On the right: macros `F1` to `F12` and the text to send.

<a id="wspr"></a>
### 9.4 WSPR

Choose the band; every 2 minutes (about ten seconds after each even minute) the list grows: callsign, locator, power, frequency, drift and distance from the station.

<a id="jtty"></a>
### 9.5 JTTY

- New WSJT-X 3.3 mode for keyboard-to-keyboard and contests: no periods, each message appears **frame by frame** (1.9 s); `▌` = message still arriving.
- Left click = receive, right click = transmit, double-click = contact; macros `F1` to `F8` (the WSJT-X ones).

<a id="cw"></a>
### 9.6 CW

- The transceiver goes to CW. **Click on a signal** in the waterfall: the decoder locks onto the nearest one (yellow marker) and learns the speed (shown in words per minute). Right click: exact tuning where you click.
- **Filter** 100 Hz by default (50 Hz with QRM, 200–400 Hz to search); raise the **squelch** if letters appear on noise. The LED follows the keying.
- Double-click a received callsign = contact; macros `F1` to `F12`.

<a id="sstv"></a>
### 9.7 SSTV

- **Receive**: pictures start by themselves (VIS code) and are drawn line by line. Modes Martin M1/M2, Scottie S1/S2/DX, Robot 36/72, PD 50 to PD 290; frequency offset and slant corrected. The **gallery** keeps the last 12 (click = show); `PNG` saves the picture shown to your PC. The server also keeps every picture.
- **Prepare a picture**: `Images du PC…` (pictures from your PC, or drag and drop), CQ card, test pattern or received picture; it is cropped to the selected mode's format. Three text lines (top, centre, bottom) with tags `<CALL>`, `<MYCALL>`, `<RST>`…; size and colour. Right click a thumbnail: remove it.
- `▶ Écouter` plays the SSTV signal on your PC; `WAV` saves it (test with MMSSTV or a phone app).

<a id="sync"></a>
### 9.8 Synchro

Server time, offset of your PC, delay of the link with the station and mean DT of FT8 decodes: useful to check that everything is in step.

<a id="qo100"></a>
### 9.9 QO-100

The FT8 · FT4, RTTY and CW lists offer « **QO-100 · FI 2 m / 70 cm** »: the frequency to set on the transceiver **before the 2.4 GHz up-converter**, to transmit on 2400.040 MHz (FT8 / FT4), 2400.025 MHz (CW) or 2400.090 MHz (RTTY). Example: FT8 on **432.540 MHz** with the club's 70 cm converter. Only the IFs the connected transceiver can reach are listed (2 m and 70 cm: FTX-1).

<a id="messages"></a>
## 10. Stored messages and macros

- **Messages pré-enregistrés** panel: contact (callsign, first name, QTH, locator, FT8 report, RST), then one row per mode: FT8 · FT4 (Tx1 to Tx7), RTTY, JTTY, CW.
- Clicking a macro adds it to the text to send in its tab. **Right click** (or `✎`): edit it — name, text, preview, back to the default. Your macros are stored on the server, for you only.
- Tx7: free FT8 / FT4 text, 13 characters.

| Tag | Replaced by | Tag | Replaced by |
|---|---|---|---|
| `<MYCALL>` | transmitted callsign (ON5VL) | `<CALL>` | contact |
| `<NAME>` | their first name | `<QTH>` | their QTH |
| `<RST>` | report sent | `<LOC>` | their locator |
| `<MYLOC>` | station locator | `<MYQTH>` | station QTH |
| `<OPCALL>` | your own callsign (operator) | `<CNTR>` | serial number (001…) |
| `<INCR>` | moves to the next serial | `<ZT>` / `<ZD>` | UTC time / date |

<a id="keys"></a>
## 11. Keyboard shortcuts

| Key | Action |
|---|---|
| `Space` (hold) | PTT — also from a panel opened in a separate window |
| `↑` `↓` | Frequency ± one step |
| `F1` … `F12` | Macros in the RTTY and CW tabs (`F1`…`F8` in JTTY) |
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

<a id="club"></a>
## 13. The club PC (Station page)

For club managers. The PC connected to the transceiver opens **https://remote.op0p.be/station** in Chrome (Web Serial). On Windows 10 / 11, the **RemoteStation-Setup** installer does it all: « Remote Station - Page Station » shortcut (Chrome with the right settings), start with Windows, no sleep; it can also install the server itself on that PC (see LISEZMOI-WINDOWS).

The Station page is **reserved for administrators**: the first time it is opened on a PC, log in with an administrator's call and password. That PC then stays authorised for a year (renewed each time the page is opened), until « Se déconnecter » (log out). Non-administrator members are refused.

1. Paste the **station token** (given by the server administrator), choose the transceiver **model** and its **CAT port** (first time only).
2. **Activer l'audio** (enable audio) and choose the transceiver's sound input (often « USB Audio CODEC »); the level bar must move.
3. Keep the Station page **alone in its window**; open the dashboard with its « Ouvrir le dashboard dans une autre fenêtre » button.
4. Chrome → Settings → Performance: always keep remote.op0p.be active; Windows: sleep set to Never.

Server installation and settings: see `LISEZMOI.md` and `README.md` (project repository).

<a id="logs"></a>
## 14. Logs online (station logbook)

**Logs online** tab (the last one, right of Synchro): the station logbook, shared by all members, with upload to **LoTW**, **eQSL**, **Club Log** and **QRZ.com**, **ADIF** or **Cabrillo** export, and **UDP** forwarding to PC logbooks (Swisslog, HRD Logbook, Log4OM, N1MM Logger+…).

- **Logging a QSO**: `⇩ TRX` takes the transceiver frequency and mode (in DATA: the mode of the tab on screen, FT8, RTTY…), the power, and the correspondent from the bottom of the page (call, name, QTH, locator). The UTC time is taken when you type the first letter of the call; `⟳ Maintenant` (now) resets it. `Enter` or `Enregistrer le QSO` (save). A duplicate (same call, band and mode within half an hour) is reported before saving.
- **QO-100**: with the converter IF (e.g. 432.525 MHz) the QO-100 box is ticked and the 2400.xxx MHz uplink frequency is logged (QO-100 satellite, downlink 10489.xxx MHz).
- **List**: the last 300 QSOs (search by call, name or operator). Columns LoTW, eQSL, CL (Club Log), QRZ: **·** not sent yet, **✓** sent, **✗** rejected (hover for details), **★** confirmed on LoTW. Click a row to edit or delete the QSO (its author or an administrator).
- **Exporter ▾** (export): ADIF 3 (.adi) or Cabrillo 3 (.log, with the contest name), for one call and an optional date range.
- **Synchronisation ▾** (administrators): one window per service, as in Swisslog — **Détails** tab (call, optional date range, resend QSOs already sent, delay; Club Log: « Effacer le log ClubLog existant », clear the existing log) then `Télécharger` (upload); **Traitement** tab: progress, report, `Arrêt` (stop). **Opérations LoTW**: export, sign with TQSL, upload, read confirmations, status; `Confirmations` only reads the confirmations received.
- **⚙ Configuration** (administrators): tabs CLUBLOG, eQSL, LoTW, QRZ, UDP. « Upload QSOs automatically when they are logged » box, logins and passwords (👁 button to see them while typing), delay, `Tester` (test). Passwords and keys stay on the server: the window only shows « enregistré » (stored); an empty field keeps the value, ✕ deletes it.

| Service | What you need |
|---|---|
| Club Log | Account e-mail, an application password (Club Log → Settings → App Passwords), the application API key (requested once from the Club Log helpdesk). An access refusal stops uploads until the configuration is saved again. |
| eQSL | eQSL call and password; « QTH Nickname » if the account has several QTHs. |
| QRZ.com | One QRZ logbook API key per call (QRZ → Logbook → Settings), XML subscription or higher. |
| LoTW | **TQSL** and the call's **certificate** installed on the PC running the server (the club's Windows server), the TQSL « Station Location » name, and the LoTW website login for confirmations. The certificate and its password never leave that PC. With the server on the VPS: « Exporter pour TQSL (.adi) », sign the file with TQSL on the club PC, then « Marquer comme envoyés » (mark as sent). |
| UDP | Address, port and format expected by the logbook: WSJT-X « Logged ADIF » (Swisslog, Log4OM, HRD Logbook; usually port 2237), N1MM (port 12060), or raw ADIF. Packets are sent by the server: 127.0.0.1 when the server runs on the club PC. |
