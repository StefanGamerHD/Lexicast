# Sicherheit

Lexicast bringt Texte in die Anwendungen anderer Leute. Ein falscher oder böswilliger Text kann viele Menschen erreichen, deshalb soll das möglichst schwer sein. Diese Seite beschreibt, was der Code heute tut und was er noch nicht tut.

## Schwachstelle melden
Bitte melde sie vertraulich über „Report a vulnerability“ auf GitHub im Repository, nicht als öffentliches Issue. Siehe `SECURITY.md`.

## Texte
- Texte sind **reiner Text** und werden so gespeichert und ausgeliefert. Editor und Client interpretieren sie nie als HTML.
- Harte Regeln lehnen Steuerzeichen, Zeichen zur Umkehr der Schreibrichtung, kaputte Klammern und Platzhalter ab, die vom Ausgangstext abweichen (siehe [Bedienung](user-guide.md#platzhalter-und-textregeln)).
- **Vier-Augen-Prinzip:** Ein Text braucht eine zweite Person, bevor er veröffentlicht werden kann. Der Solo-Modus ist eine ausdrückliche, protokollierte Ausnahme für Ein-Personen-Projekte. Die Regel ist zusätzlich eine Datenbank-Bedingung.
- Ein Vorschlag, der gegen einen älteren Ausgangstext geschrieben wurde, kann nicht freigegeben werden.

## Releases und Signatur
- Jedes Release wird mit **Ed25519** signiert. Apps prüfen die Signatur mit dem öffentlichen Schlüssel, den sie mitbringen, und den SHA-256 jeder Sprachdatei.
- Release-Dateien sind unveränderlich; ein Rollback ist ein neues Release mit höherer Nummer, damit Clients ältere Releases ablehnen können.
- Manifest und Signatur werden erst vollständig geschrieben und dann umbenannt, damit ein Absturz nie ein neues Manifest neben einer alten Signatur hinterlässt.
- **Signaturschlüssel:** wird bei der ersten Nutzung erzeugt, mit Dateirechten 0400 in `LEXICAST_KEY_DIR` gespeichert und **nur von einem eigenen Signer-Prozess** geladen. Der Web-Prozess lässt ihn über eine Pipe signieren und hält den Schlüssel nie selbst. Das ist Prozesstrennung, keine Benutzertrennung: Code, der unter demselben Betriebssystem-Benutzer läuft, kann die Datei trotzdem lesen.
- Noch nicht gebaut: Schlüsselrotation mit Vertrauenskette und Notfallweg (entworfen), verschlüsseltes Schlüssel-Backup, Signieren mit Hardware oder offline.

## Konten und Sitzungen
- Passwörter werden mit **scrypt** gehasht. Mindestens 12 Zeichen, ohne den Namensteil der E-Mail.
- Nach 5 fehlgeschlagenen Anmeldungen ist ein Konto 15 Minuten gesperrt. Unbekannte E-Mails bekommen dieselbe Antwort in ähnlicher Zeit (es wird ein Dummy-Hash berechnet).
- Sitzungs-Tokens sind zufällig und werden nur als Hash gespeichert. Cookie: `HttpOnly`, `SameSite=Strict`, über HTTPS `Secure` mit `__Host-`-Präfix, 7 Tage.
- Nur per Einladung; Links sind einmal nutzbar und laufen ab (Einladungen 7 Tage, Passwort-Reset 60 Minuten, höchstens 3 Resets pro Stunde). Passwortänderung oder Reset beendet alle Sitzungen.
- Das einmalige Setup-Token wird als Hash gespeichert und funktioniert nur einmal.
- Der Instanz-Admin hat keinen automatischen Zugriff auf Projekte. Nicht-Mitglieder bekommen für Projekt-URLs „nicht gefunden“.

## Web
- Jede schreibende Anfrage muss von `LEXICAST_BASE_URL` kommen (Origin-Prüfung) und JSON sein.
- Die Oberfläche läuft unter einer strengen Content-Security-Policy: `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`. Kein Inline-Code, keine Anfragen an Dritte. Die öffentliche Fortschrittsseite hat eine eigene strenge Policy und kein JavaScript.
- Ratenbegrenzung pro IP (im Speicher): schreibende API-Anfragen sowie Auslieferung und Fortschrittsseite.
- Anfragen sind in der Größe begrenzt. Interne Fehler werden nie zurückgegeben; das Log bekommt eine kurze ID.

## Container
Die mitgelieferte compose-Datei startet den Container schreibgeschützt, als Nicht-root-Benutzer, ohne Capabilities und mit `no-new-privileges`, und bindet den Port nur an localhost. Das Image enthält eine Laufzeit-Abhängigkeit (nodemailer, fest versioniert) und keine Build-Werkzeuge.

## Audit-Log
Sicherheitsrelevante Aktionen (Einrichtung, Anmeldungen, Sperren, Passwortänderungen und -resets, Einladungen, Mitgliederänderungen, Key-Änderungen, Importe, Vorschläge, Freigaben samt Solo-Freigaben, Ablehnungen, Releases, Rollbacks, Einstellungen) landen in einem Audit-Log in der Datenbank, mit einem Pseudonym statt des Namens. Eine Ansicht und API zum Lesen sind geplant.

## Bekannte Grenzen
- Echte SMTP-Anbieter sind noch nicht getestet; TLS übernimmt nodemailer.
- Ratenbegrenzungen gelten pro Prozess und beginnen nach einem Neustart bei null; hinter einem Proxy `LEXICAST_TRUST_PROXY_HEADER` setzen.
- Noch kein Backup/Restore-Befehl (siehe [Betrieb](operations.md#backup)).
- Noch keine API-Tokens; Skripte nutzen ein Sitzungs-Cookie.
- `node:sqlite` ist in Node 24 noch als experimentell markiert. Das Basis-Image ist per Tag festgelegt, noch nicht per Digest.
- Die Oberfläche wurde nur in Chromium getestet, nicht in Firefox oder Safari und nicht mit Screenreadern.
