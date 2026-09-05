# P12 — calendar prompts for Gemini

Copy-paste, one prompt per block, into Gemini in the private Google Workspace.
Every block names the private calendar, forbids guests, and asks Gemini to
update an existing event of the same title instead of creating a duplicate.
No secret, URL or key appears anywhere below.

All times are **Europe/Berlin**. The dates assume the first regular cycle on
**Wed 09.09.2026**; if it slips, block 9 moves everything that depends on it.

---

### 1 — Preparation deadline

```
Create an event in my personal Google Calendar only. No guests.
If an event with the same title already exists, update it instead of creating a duplicate.

Title: P12 Vorbereitung fällig — Konto, .env, Alarmkanäle
Date: Monday 7 September 2026
Time: 19:00–22:00, timezone Europe/Berlin
Description: Drei Owner-Schritte, alle vor dem Zertifikatslauf am 8.9.:
(1) Frisches Alpaca-Paper-Konto anlegen, nur für den Agenten, Options Level 3. Es muss am oder nach Sonntag 06.09.2026 02:00 Europe/Berlin erstellt worden sein, sonst verweigert der Provenance-Beweis.
(2) .env im Checkout füllen: competition-Profil, die neuen Konto-Zugangsdaten, ein NEUES STATE_DIR (longrun-1). Secrets nur lokal.
(3) Drei Healthchecks anlegen, EXAKT benannt gbt-liveness, gbt-readiness, gbt-watchdog — der Name in der Push-Meldung ist nachts die einzige Zuordnung zur Handlungsanweisung. Schedule-Typ "cron", mit den Ausdrücken, der IANA-Zeitzone (Europe/Berlin, NICHT dem Windows-Namen) und den Grace-Werten, die tools\install-scheduled-task.ps1 -WhatIf -CoverageThroughDate 2026-12-10 ausgibt. Ping-URLs in die .env, jede von ihrer eigenen Check-Seite kopiert — eine Vertauschung fällt später nirgends auf.
Dann die wiederkehrende "down"-Erinnerung im Konto einschalten: sie ist Gate-Bedingung 4, kein Extra. Danach tools\check-alert-path.ps1, Empfang aller drei Alarme auf dem Handy bestätigen, EINE Erinnerungsperiode abwarten und eine zweite Meldung bestätigen, erst dann tools\check-alert-path.ps1 -ResolveOnly, und zum Schluss alle drei Checks im Dashboard PAUSIEREN — sonst stehen sie bis Dienstag 22:10 ohne Ping da und wecken die ganze Nacht.
WENN die Erinnerung nur täglich möglich ist, passt das Warten nicht in diesen Abend: dann heute alles übrige erledigen, die zweite Meldung morgen bestätigen und den Rest des Ablaufs erst danach fortsetzen.
Anleitung: docs\P12-RUNBOOK.md, Owner steps 1 bis 3.
Notifications: popup 1 day before, popup 2 hours before.
```

### 2 — Certificate run four

```
Create an event in my personal Google Calendar only. No guests.
If an event with the same title already exists, update it instead of creating a duplicate.

Title: P12 Zertifikatslauf vier (Dev-Konto, betreut)
Date: Tuesday 8 September 2026
Time: 15:30–17:00, timezone Europe/Berlin
Description: Beaufsichtigt, ab der US-Eröffnung um 15:30, auf dem DEV-Konto, gegen die endgültige Konfiguration. Zuerst Get-ScheduledTask -TaskPath '\GlassBoxTrading\': erwartet werden entweder beide Tasks Disabled ODER ein roter "keine Objekte gefunden"-Fehler — an diesem Tag sind sie noch gar nicht installiert, und das ist der gute Ausgang, kein Fehler. Der PowerShell-Block in docs\P12-RUNBOOK.md, Owner step 4, setzt die Dev-Variablen nur für diesen Lauf und stellt sie auch bei Fehlern wieder her. Erwartet: verdict PASS. Flachheit des Dev-Kontos separat prüfen — node dist\shell\readiness-cli.js meldet "success", und im Alpaca-Dashboard des DEV-Kontos stehen null Positionen und null offene Orders. Danach den ausgegebenen Zertifikatspfad als PRE_ARM_CERTIFICATE in .env eintragen (absoluter Pfad, keine Anführungszeichen) und das Fenster schließen.
Abbruch, wenn das Verdikt nicht PASS ist ODER das Dev-Konto nicht flach ist: dann findet am 9.9. kein erster Zyklus statt, und der Anker wird nach der Prozedur am Ende von Owner step 6 NEU HERGELEITET — nicht linear verschoben.
Notifications: popup 1 day before, popup 30 minutes before.
```

### 3 — Installation and activation gate

```
Create an event in my personal Google Calendar only. No guests.
If an event with the same title already exists, update it instead of creating a duplicate.

Title: P12 Installation der Tasks
Date: Tuesday 8 September 2026
Time: 17:00–18:00, timezone Europe/Berlin
Description: Erst nach PASS. In einer ERHÖHTEN PowerShell: npm.cmd run build (npm.cmd, nicht npm — npm.ps1 ist von der Execution Policy gesperrt), dann tools\install-scheduled-task.ps1 -CoverageThroughDate 2026-12-10 (registriert die Tasks und deaktiviert sie sofort — Installieren ist nicht Aktivieren), dann tools\verify-scheduled-tasks.ps1 (erwartet: SCHEDULER CHECK PASSED).
Noch nichts aktivieren: das Gate ist der nächste Termin.
Notifications: popup 30 minutes before.
```

### 3b — The activation gate (two windows, outside every session)

```
Create two events in my personal Google Calendar only. No guests.
If an event with the same title already exists, update it instead of creating a duplicate.

Event one:
Title: P12 Aktivierungs-Gate, Teil 1 (Stille-Proben)
Date: Tuesday 8 September 2026
Time: 22:10–01:00 (endet am Mittwoch 9. September um 01:00), timezone Europe/Berlin
Description: Erst NACH dem US-Schluss um 22:00. Zuerst die drei Checks im Dashboard wieder fortsetzen (sie stehen seit Owner-Schritt 3 auf Pause), dann beide Tasks in einer ERHÖHTEN PowerShell aktivieren — jede Auslösung ab jetzt überspringt den Zyklus und meldet trotzdem beide Signale, es kann also nichts handeln. Absolute Regel: vor dem Ankerdatum darf keine Auslösung einen Zyklus fahren.
Jede Probe beginnt bei einer BEOBACHTETEN Auslösung, nicht bei der Wanduhr: deren lokale Zeit ist T, und alles rechnet von T. Erkennung ist Periode plus Karenz (Watchdog T+20, Liveness T+45, Readiness T+65), die Zustellung aufs Handy kommt mit 10 Minuten Budget obendrauf.
Der 22:10-Block muss VOR der 22:15-Auslösung fertig sein; danach verify-scheduled-tasks.ps1 -ExpectEnabled (SCHEDULER CHECK PASSED, beide Ready) und die 22:15-Auslösung im Log bestätigen. Zeigt eine Zeile einen LAUFENDEN Zyklus statt "skip", sofort beide Tasks deaktivieren — dann darf heute kein Anker gesetzt werden.
Drei Proben: (a) 22:30 nur der Watchdog aus — nur gbt-watchdog darf fallen (22:50), Push bis 23:00; danach Watchdog WIEDER EINSCHALTEN und abwarten, bis er grün ist (~23:05). (b) ab 23:05 abmelden (nicht sperren, nicht herunterfahren), die 23:15-Auslösung muss eine Logzeile schreiben, während niemand angemeldet ist — S4U-Beweis; um 23:20 wieder anmelden und lesen. (c) spätestens 23:30 den Rechner wirklich ausschalten (Stop-Computer -Force, kein Standby) — bei T=23:30 fallen die Checks gegen 23:55, 00:15 und 00:35, letzte Push bis 00:45. Wecker auf 00:45 stellen.
Kommt eine Erkennung, aber keine Push: das ist ein Befund, kein Verzug — anhalten und den Kanal prüfen. Schafft (c) den Start um 23:30 nicht mehr, beide Tasks deaktivieren und den Anker verschieben; nach 23:30 kann heute keine Erkennung mehr entstehen, weil die Checks bis Mittwoch 14:00 keinen Ping mehr erwarten.
Wenn alle drei Meldungen da sind, die drei Checks VOM HANDY AUS pausieren; der Rechner bleibt aus. Ablauf im Wortlaut: docs\P12-RUNBOOK.md, Owner step 6.
Notifications: popup 30 minutes before.

Event two:
Title: P12 Aktivierungs-Gate, Teil 2 (Kaltstart-Beweis und Gate)
Date: Wednesday 9 September 2026
Time: 13:50–14:45, timezone Europe/Berlin
Description: Der Rechner war seit Dienstagnacht aus — das ist der Kaltstart, auf den es ankommt. Um 13:50 einschalten, anmelden, die drei Checks im Dashboard fortsetzen. Um 14:00 fällt der erste Trigger des Tages; niemand startet etwas. Danach tools\show-run-log.ps1 -Since "14:00": eine 14:00-Zeile (UTC 12:00), von selbst geschrieben, ist der Neustart-Beweis. Kommt keine, beide Tasks deaktivieren und den Anker verschieben.
Dann eine weitere Auslösung abwarten, bis alle drei Checks wieder grün sind, und um 14:45 das Gate: verify-scheduled-tasks.ps1 -ExpectEnabled: SCHEDULER CHECK PASSED, beide Tasks Ready. Die Reserve, die einen langsamen Start auffängt, sind die 25 Minuten zwischen 14:20 und dem Gate; die halbe Stunde bis 15:15 danach ist Sicherheitsabstand zum Anker, kein Puffer, den man vorher aufbrauchen kann.
WICHTIG: Hängt um 14:45 noch etwas offen, auch nur ein "bin mir nicht sicher": beide Tasks deaktivieren. Der Anker wird dann NEU HERGELEITET (nicht linear verschoben) — Zertifikatstag ist der Handelstag davor, FLATTEN_DATE drei Kalendermonate nach dem Anker und nötigenfalls auf den nächsten Handelstag vorgerückt, Journaling-Tag der Handelstag danach. Prozedur am Ende von Owner step 6.
Notifications: popup 1 day before, popup 15 minutes before.
```

### 4 — The first regular cycle

```
Create an event in my personal Google Calendar only. No guests.
If an event with the same title already exists, update it instead of creating a duplicate.

Title: P12 Erster regulärer Zyklus (betreut) — Ankerdatum
Date: Wednesday 9 September 2026
Time: 15:10–16:30, timezone Europe/Berlin
Description: Der erste Zyklus läuft um 15:15, nicht 15:30: der Lead-in beginnt 20 Minuten vor der US-Eröffnung. Einen vollständigen Zyklus beobachten. Prüfen mit tools\show-run-log.ps1 -Since "15:15": der Aufruf und der gedruckte Report, dessen letzte Zeile eine einzelne JSON-Zeile ist. Dann: das Journal enthält einen BOOTSTRAP-Eintrag; alle drei Healthchecks sind grün; tools\verify-scheduled-tasks.ps1 -ExpectEnabled läuft durch.
Schlägt Punkt 1, 3 oder 4 fehl: beide Tasks in einer erhöhten Shell deaktivieren und den Anker nach der Prozedur am Ende von Owner step 6 neu herleiten.
Wird das Konto abgelehnt, steht KEIN Halt im Journal — das Journal bleibt leer, und der Report zeigt primary null, entriesBlocked PROVENANCE und alarmConditions COMPETITION_PROVENANCE_FAILED. Vorgehen dann: docs\P12-RUNBOOK.md, Owner step 7, Abschnitt zum Kontowechsel.
WICHTIG: Dieser Zyklus ist das Ankerdatum. Findet er nicht heute statt, verschiebt sich das Flatten-Datum, die Konfiguration muss geändert werden und das Zertifikat wird ungültig — dann erst neu zertifizieren, dann starten.
Notifications: popup 1 day before, popup 15 minutes before.
```

### 5 — Weekly operations review

```
Create a recurring event in my personal Google Calendar only. No guests.
If an event with the same title already exists, update it instead of creating a duplicate.

Title: P12 Wochenreview und Dashboard-Publikation
Recurrence: every Friday, from Friday 11 September 2026 until Friday 4 December 2026 inclusive
Time: 18:00–18:45, timezone Europe/Berlin
Description: Dashboard über den digest-neutralen Pfad aus docs\PUBLISH-RUNBOOK.md aus dem gbt-publish-Worktree veröffentlichen und die Probe sauber sehen. Danach durchgehen: ausgefallene Zyklen, jeder Halt mit Grund und Klärung, Alarme und Reaktionszeit, freie Plattenkapazität für Journal und Publish-Baum.
Keine Strategie- oder Risikoparameter ändern — eine Änderung beendet die Messperiode und startet eine neue.
Notifications: popup 30 minutes before.
```

### 6 — Before the two clock changes

```
Create an event in my personal Google Calendar only. No guests.
If an event with the same title already exists, update it instead of creating a duplicate.

Title: P12 Kontrolle nach der EU-Zeitumstellung (25.10.)
Date: Monday 26 October 2026
Time: 14:10–14:40, timezone Europe/Berlin
Description: Am Sonntag 25.10. endet die europäische Sommerzeit, die USA stellen erst am 1.11. um. In der Woche vom 26.10. beginnt die US-Sitzung deshalb eine Stunde früher in lokaler Zeit — 14:30 statt 15:30. Das Trigger-Fenster ist dafür gepolstert (gemessen: schlechtester Rand 30 Minuten), es ist also nichts zu tun ausser zu kontrollieren: Am Montag 26.10. prüfen: tools\show-run-log.ps1 -Since "14:00" zeigt ab 14:15 einen laufenden Zyklus — nicht erst ab 14:30, weil der Lead-in 20 Minuten vor der Eröffnung beginnt — und die drei Healthchecks bleiben grün. Das Log selbst steht in UTC; show-run-log.ps1 druckt beide Zeiten nebeneinander.
Notifications: popup 3 days before, popup 15 minutes before.
```

```
Create an event in my personal Google Calendar only. No guests.
If an event with the same title already exists, update it instead of creating a duplicate.

Title: P12 Kontrolle nach der US-Zeitumstellung (01.11.)
Date: Monday 2 November 2026
Time: 15:10–15:40, timezone Europe/Berlin
Description: Am Sonntag 1.11. endet die US-Sommerzeit; ab Montag 2.11. liegt die Sitzung wieder bei 15:30 lokal und beide Zonen sind wieder synchron. Am Montag 2.11. prüfen: tools\show-run-log.ps1 -Since "14:00" zeigt bis 15:00 nur übersprungene Aufrufe und ab **15:15** einen laufenden Zyklus — nicht erst ab 15:30, weil der Lead-in 20 Minuten vor der Eröffnung beginnt. Das Log selbst steht in UTC; show-run-log.ps1 druckt beide Zeiten nebeneinander.
Notifications: popup 1 day before.
```

### 7 — Closing sequence

```
Create an event in my personal Google Calendar only. No guests.
If an event with the same title already exists, update it instead of creating a duplicate.

Title: P12 Abschluss vorbereiten
Date: Monday 7 December 2026
Time: 18:00–19:00, timezone Europe/Berlin
Description: Zwei Tage vor dem Flatten. Offene Positionen und ihre Verfallstermine durchsehen, freie Plattenkapazität prüfen, den Ablauf für den 9. und 10.12. aus docs\P12-RUNBOOK.md, Abschnitt "Ending it", durchlesen.
Notifications: popup 1 day before.
```

```
Create an event in my personal Google Calendar only. No guests.
If an event with the same title already exists, update it instead of creating a duplicate.

Title: P12 FLATTEN_DATE — Buch wird geschlossen
Date: Wednesday 9 December 2026
Time: 15:25–22:15, timezone Europe/Berlin
Description: Ab heute vetot G11 jede neue Position und jeder Zyklus schliesst das Buch über die Leiter. Bis zum US-Schluss muss die Zusicherung gelten: keine risikotragende Position und kein nicht-terminaler Auftrag. Nicht eingreifen, solange die Leiter arbeitet; bei DEADLINE_FLATTEN_FAILED alarmiert der readiness-Check.
Notifications: popup 1 day before, popup 15 minutes before.
```

```
Create an event in my personal Google Calendar only. No guests.
If an event with the same title already exists, update it instead of creating a duplicate.

Title: P12 TERMINAL und Abschaltung
Date: Thursday 10 December 2026
Time: 22:05–23:00, timezone Europe/Berlin
Description: Heute ist Journaling-only. Nach dem US-Schluss: node dist\shell\deadline-cli.js terminal (Exit 0 nur, wenn der Eintrag gelandet ist), dann die letzte Revision veröffentlichen und proben. Danach in einer ERHÖHTEN PowerShell beide Tasks deaktivieren und den Zustand als Disabled zurücklesen. Zum Schluss Journal, beide Logs und die Belege im Verifikations-Store archivieren.
Notifications: popup 1 day before, popup 30 minutes before.
```

### 8 — Final evaluation

```
Create an event in my personal Google Calendar only. No guests.
If an event with the same title already exists, update it instead of creating a duplicate.

Title: P12 Auswertung schreiben
Date: Monday 14 December 2026
Time: 18:00–20:00, timezone Europe/Berlin
Description: Auswertung strikt nach docs\P12-EVALUATION.md, das vor dem Lauf festgelegt wurde: Ergebnis je Sleeve, offene Position am Periodenende getrennt, nicht zugeordnete Cents als eigene Zeile, Drawdown (zyklisch abgetastet, also Untergrenze), eingesetztes Risiko, abgeschlossene Trades mit Anzahl statt blosser Trefferquote, No-Trade-Gründe, Betriebsunterbrechungen mit "Zeit ohne Handelsbereitschaft" als wichtigster Zuverlässigkeitszahl. Paper-Brutto und die drei Kostenszenarien getrennt ausweisen, Gebühren aus einer veröffentlichten Broker-Preisliste zitieren, kein Szenario "real netto" nennen. Zwei Vergleichsmaßstäbe: Buy-and-hold SPY und Null.
Notifications: popup 1 day before.
```

### 9 — If the anchor moves

Do **not** ask for a linear shift. A P12 date is derived from the anchor and the
US trading calendar, and shifting every event by the same number of calendar
days puts the certificate run on a Sunday as soon as the anchor lands on a
Monday. Work out the four derived dates yourself first — the rules are in
`docs\P12-RUNBOOK.md`, section "Reading the clock" — and then give Gemini the
finished dates:

* **Anchor** = the new first regular cycle (a US trading day).
* **Certificate day** = the trading day immediately *before* the anchor.
* **Gate** = the evening of the certificate day into the anchor morning.
* **FLATTEN_DATE** = three calendar months after the anchor; if that is not a
  trading day, the next one that is.
* **Journaling-only day** = the trading day *after* FLATTEN_DATE. For a Friday
  flatten date that is the following Monday, never the Saturday.

```
In my personal Google Calendar only, no guests. Update the existing events rather than creating new ones.
My P12 anchor moved from Wednesday 9 September 2026 to <NEW ANCHOR, weekday and date>.
Set these events to the dates I give here — do not compute them yourself and do not shift them by a fixed number of days:

"P12 Vorbereitung fällig — Konto, .env, Alarmkanäle"            -> <the working day before the certificate day; never a Saturday or Sunday>, 19:00-22:00
"P12 Zertifikatslauf vier (Dev-Konto, betreut)"                 -> <CERTIFICATE DAY>, 15:30-17:00
"P12 Installation der Tasks"                                    -> <CERTIFICATE DAY>, 17:00-18:00
"P12 Aktivierungs-Gate, Teil 1 (Stille-Proben)"                 -> <CERTIFICATE DAY>, 22:10 bis 01:00 des Folgetags
"P12 Aktivierungs-Gate, Teil 2 (Kaltstart-Beweis und Gate)"     -> <ANCHOR DAY>, 13:50-14:45
"P12 Erster regulärer Zyklus (betreut) — Ankerdatum"             -> <ANCHOR DAY>, 15:10-16:30
"P12 Abschluss vorbereiten"                                     -> <two trading days before FLATTEN_DATE>, 18:00-19:00
"P12 FLATTEN_DATE — Buch wird geschlossen"                       -> <FLATTEN_DATE>, 15:25-22:15
"P12 TERMINAL und Abschaltung"                                  -> <JOURNALING-ONLY DAY>, 22:05-23:00
"P12 Auswertung schreiben"                                      -> <the Monday after the journaling-only day>, 18:00-20:00

Move the recurring "P12 Wochenreview und Dashboard-Publikation" to start on the first Friday after the new anchor and end on the last Friday before the new FLATTEN_DATE.
Leave the two clock-change checks on 26 October and 2 November 2026 where they are: they depend on the calendar, not on my anchor.
Then list every event with its new date so I can confirm it.
```

---

**If Gemini cannot set something** — a specific notification, a recurrence end
date, a timezone — it should say so explicitly for that event and list what is
left to do by hand, rather than silently creating the event without it.
