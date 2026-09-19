# P12 — die Termine des Aktivierungsfensters

Neu geschrieben am 20.09.2026. Die vorherige Fassung war eine Reihe von Gemini-Prompts für
feste Tage im September, an denen der Lauf nicht begonnen hat, und sie beschrieb einen
Ablauf, in dem der Eigentümer fast jeden Schritt selbst tippt. Beides stimmt nicht mehr:
seit Unit 10 führt das Aktivierungsskript die Schritte aus, und der Starttag steht erst
fest, wenn die Betriebsnachweise stehen. Deshalb stehen hier **Ereignisse relativ zum
Ankertag** statt Daten, die beim nächsten Verzug wieder falsch sind.

**Zwei Daten setzen alles andere.** `Z` ist der Zertifikatstag, `A` der Ankertag, und
`A` ist der nächste Handelstag nach `Z`. Sobald beide feststehen, wird aus dieser Datei
eine `.ics`-Datei auf dem Desktop erzeugt; Kalendereinträge gehen nicht über einen
Konnektor.

**Was sich gegenüber der alten Fassung inhaltlich geändert hat, und nicht nur im Datum:**

- Der Zertifikatspfad wird **nicht** von Hand in `.env` eingetragen. Die Aktivierung liest
  `evidence\pre-arm\` selbst, prüft das Zertifikat in Schritt `2-certificate` gegen beide
  Digests und schreibt die Zeile erst in Schritt `10-gate`, nach den Proben und dem
  Neustart-Nachweis. Zwischen Schritt 0 und Schritt 10 muss `PRE_ARM_CERTIFICATE` in `.env`
  **fehlen** — das ist die Sperre aus Spezifikation §6, und eine handgeschriebene Zeile
  wird von Schritt 0 wieder entfernt.
- Der Dauerbetrieb bleibt auf `ALPACA_PROFILE=competition`. Der Zertifikatslauf setzt
  Dev-Profil, Dev-Zustandsverzeichnis und Dev-Diagnosesenke **nur im eigenen Prozess**.
- Die Erinnerungs-Bestätigung der drei Checks ist seit dem 15.09. erledigt und gilt
  vierzehn Tage ab dem ältesten Empfang, also bis zum **29.09.2026**. Rutscht der Anker
  darüber hinaus, ist sie vor Schritt 0 zu wiederholen — das ist Bedingung 4 des Gates.
- Die Abschaltung der automatischen Wiederanmeldung nach Neustart
  (`DisableAutomaticRestartSignOn = 1`) ist seit dem 19.09. erledigt und zurückgelesen. Der
  alte Termin dafür entfällt ersatzlos.

---

## Die Termine, relativ zum Ankertag

**1) „P12 Zertifikatslauf (Dev-Konto, betreut)" — Z, 15:30–17:00**

Beaufsichtigt ab der US-Eröffnung, auf dem Dev-Konto, gegen die endgültige Konfiguration.
Ablauf: `docs\P12-RUNBOOK.md`, Owner step 4. Erwartet: `verdict PASS` **und** ein flaches
Dev-Konto, beides getrennt geprüft. Der Zertifikatspfad wird notiert, **nicht** in `.env`
eingetragen. Danach das PowerShell-Fenster schließen, damit keine Dev-Variable überlebt.
Bei allem außer PASS fällt der Anker aus und wird neu hergeleitet, nicht verschoben.

**2) „P12 Installation der Tasks (erhöht)" — Z, 17:00–18:00**

Erst nach PASS, in einer **erhöhten** PowerShell. Die Aktivierung führt Schritt
`1-install` aus: beide Tasks werden neu registriert und bleiben deaktiviert —
Installieren ist nicht Aktivieren. Danach muss `verify-scheduled-tasks.ps1`
`SCHEDULER CHECK PASSED` melden; die gemeldete Prüfzahl notieren, sie muss bei jedem
späteren Lauf ohne `-ExpectEnabled` dieselbe sein.

**3) „P12 Aktivierungs-Gate Teil 1 — Stille-Proben" — Z, 22:05 bis Z+1, 01:00**

Erst nach dem US-Schluss um 22:00. Die Aktivierung aktiviert beide Tasks (Schritt
`4-enable`, Fenster 22:05–22:20), fährt die Watchdog-Probe (`5-drill-watchdog`) und die
Stille-Probe (`6-drill-silence`). Jede Probe rechnet von einer **beobachteten** Auslösung,
nie von der Wanduhr. Der Mensch beobachtet und greift nur ein, wenn die Aktivierung
pausiert oder pagt.

Neu seit dem 20.09.: Eine Stille wird als „Task war deaktiviert" nur dann gelesen, wenn
**kein** Ping-Text in diesem Fenster einen Logfehler nennt. Ein Feuern, das sein Log nicht
schreiben kann, erzeugt lokal dieselbe Stille — darum steht der Grund im Ping.

**4) „P12 Aktivierungs-Gate Teil 2 — Kaltstart und Gate" — A, 13:25–14:55**

Der Rechner war über Nacht aus. Die Aktivierung fordert den Neustart an (`8-reboot`,
13:30), schließt ihn nach dem Hochlauf ab, belegt die selbsttätige Auslösung um 14:00
(`9-proof`) und entscheidet um 14:35 das Gate (`10-gate`). Erst dort wird
`PRE_ARM_CERTIFICATE` geschrieben. Hängt um 14:55 noch etwas offen, auch nur ein „ich bin
mir nicht sicher": beide Tasks deaktivieren und den Anker neu herleiten.

**5) „P12 Erster regulärer Zyklus — Ankertag" — A, 15:10–16:30**

Der erste handelnde Zyklus ist die **15:15**-Auslösung, nicht 15:30: der Vorlauf beginnt
zwanzig Minuten vor der US-Eröffnung. Prüfen mit `tools\show-run-log.ps1 -Since "15:15"`,
dann `BOOTSTRAP` im Journal und drei grüne Checks. Diese Auslösung ist das Ankerdatum.

**6) „P12 Flatten" — 15.12.2026, 15:30–22:00**

`FLATTEN_DATE` steht fest auf dem 15.12.2026 (Entscheidung vom 11.09.). Der Lauf ist ab
diesem Tag im Flatten-Regime; der Tag danach ist journaling-only.

**7) „P12 TERMINAL und Abschalten" — der Handelstag nach dem Flatten, nach 22:00**

`node dist\shell\deadline-cli.js terminal` aus dem Betriebs-Checkout, dann **beide Tasks
deaktivieren**. Das ist kein Automatismus: die Trigger sind wochenweise ohne Endgrenze
registriert, und wenn dieser Handgriff ausfällt, feuern sie weiter. Solange der
automatische Abschluss nicht gebaut und bewiesen ist, ist dieser Termin der einzige, der
den Lauf beendet.

---

## Zwei Termine, die unabhängig vom Anker stehen

**„P12 Erinnerungs-Bestätigung erneuern" — 29.09.2026, falls der Anker später liegt**

Die Bestätigung der drei Checks ist vierzehn Tage gültig, gerechnet vom ältesten Empfang
(15.09. 22:08). Liegt Schritt 0 danach, wird sie vorher wiederholt: `check-alert-path.ps1`
ausführen, die Checks unten lassen, eine Erinnerungsperiode abwarten, die **zweite** Meldung
bestätigen, dann `-ResolveOnly` und wieder pausieren.

**„P12 Watchdog-Kalender vor der Feiertagslücke" — vor dem 26.11.2026**

Die Feiertagstabelle in `tools\watchdog-run.ps1` ist ein erklärter Notnagel (R1-14): sie
kann eine ungeplante Schließung nicht kennen, und der 26.11. ist der erste Feiertag
innerhalb des Messzeitraums. Die echte Reparatur — der Watchdog-Pfad liest den
Börsenkalender, den er ohnehin abruft — berührt `src/`, ist also Digest-Material und
kostet nach dem Zertifikatslauf ein neues Zertifikat. Sie gehört deshalb **vor** die
Zertifizierung oder in eine bewusste Entscheidung, sie im Lauf zu ziehen.
