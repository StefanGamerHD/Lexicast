# Bedienung

## Rollen
Lexicast trennt die Person, die den Server betreibt, von den Personen, die an Projekten arbeiten.

| Rolle | Bereich | Darf |
|---|---|---|
| Instanz-Admin | der Server | Personen zur Instanz einladen, Projekte anlegen (und wird deren Owner). Hat **keinen** automatischen Zugriff auf andere Projekte. |
| Owner | ein Projekt | alles im Projekt: Keys und Import, Sprachen, Mitglieder, Einstellungen, Releases und Rollback; in jeder Sprache vorschlagen und prüfen |
| Prüfer (Reviewer) | eine Sprache eines Projekts | in dieser Sprache vorschlagen, freigeben und ablehnen (nie den eigenen Text) |
| Übersetzer (Translator) | eine Sprache eines Projekts | in dieser Sprache vorschlagen, eigene Vorschläge zurückziehen |

Eine Person kann mehrere Rollen haben, zum Beispiel Prüfer für `de` und Übersetzer für `fr`. Wer kein Mitglied eines Projekts ist, bekommt dafür „nicht gefunden“ und kann nicht einmal erkennen, dass es existiert.

## Konten
- **Nur per Einladung.** Es gibt keine offene Registrierung. Der Instanz-Admin lädt Personen zur Instanz ein; Projekt-Owner laden Personen mit einer Rolle in ein Projekt ein. Die eingeladene Person bekommt einen Link per Mail (7 Tage gültig, nur einmal nutzbar). Ohne Mail sieht die einladende Person den Link einmal und gibt ihn weiter.
- **Passwort:** mindestens 12 Zeichen und ohne den Namensteil deiner E-Mail. Nach 5 Fehlversuchen ist das Konto 15 Minuten gesperrt.
- **Passwort vergessen:** „Passwort vergessen?“ auf der Anmeldeseite schickt einen Link (60 Minuten gültig, nur einmal nutzbar, höchstens 3 pro Stunde). Eine Passwortänderung meldet alle Sitzungen ab. Nur verfügbar, wenn Mail eingerichtet ist.
- **Sitzungen** gelten 7 Tage.
- **Sprache und Darstellung:** Oben gibt es eine Sprachauswahl (Englisch, Deutsch) und eine Darstellungsauswahl (System, Hell, Dunkel). Wenn du angemeldet bist, werden beide in deinem Konto gespeichert und gelten auch in anderen Browsern.
- **Benachrichtigungen:** Lexicast sammelt Ereignisse (neue Vorschläge in Sprachen, die du prüfst, deine abgelehnten Vorschläge, veröffentlichte Releases, veraltete Übersetzungen) und schickt eine Sammel-Mail pro Person. Du kannst das in deinem Konto abschalten (`PATCH /api/v1/me` mit `notifyEmail: false`; die Seite dafür kommt mit UI-Teil 4).

## Projekte
Projekte legt der Instanz-Admin an. Das Formular kommt mit einem späteren Update; bis dahin geht das über die API:
```bash
curl -X POST https://translate.example.com/api/v1/projects \
  -H 'Content-Type: application/json' -H 'Origin: https://translate.example.com' -b cookies.txt \
  -d '{"slug":"shop","name":"Shop","sourceLanguage":"en","languages":[{"tag":"en"},{"tag":"de","fallback":["en"]},{"tag":"de-AT","fallback":["de","en"]}]}'
```
- **Slug:** Kleinbuchstaben, Ziffern und Bindestriche; er steht in URLs und im Auslieferungspfad.
- **Sprachen** sind BCP-47-Kürzel wie `de` oder `de-AT`. Eine davon ist die Ausgangssprache.
- **Fallback-Kette:** Fehlt ein Text in `de-AT`, nimmt das Release `de`, dann `en`. Die Kette wird beim Bauen des Releases aufgelöst, Apps bekommen also vollständige Dateien und brauchen keine eigene Fallback-Logik.
- **Einstellungen** (Owner): `soloMode` (siehe Prüfen), `progressPublic` (öffentliche Fortschrittsseite), Name.

Die Startseite listet deine Projekte. Die Projektseite zeigt jede Sprache mit einem Fortschrittsbalken, wie viele Texte in Prüfung oder veraltet sind, das aktuelle Release und Knöpfe zum Übersetzen oder Prüfen.

## Keys und Ausgangstexte
Ein Key ist ein Text deiner App, z. B. `cart.items` mit dem Ausgangstext `{count} items in your cart`. Owner verwalten Keys über die API (Oberfläche mit UI-Teil 3):
- **Import** einer JSON-Datei, flach (`{"cart.title": "Your cart"}`) oder verschachtelt (`{"cart": {"title": "Your cart"}}`). Schicke sie zuerst mit `apply: false`, um zu sehen, was hinzukäme, sich änderte, wieder aktiv würde oder fehlt; dann mit `apply: true`. Der Import gilt ganz oder gar nicht: Ein ungültiger Text lehnt die ganze Datei ab. `deprecateMissing: true` markiert Keys, die nicht in der Datei stehen, als veraltet (deprecated).
- **Bearbeiten** eines Keys: Ausgangstext, Hinweis für Übersetzer, Maximallänge, Zustand (`active` oder `deprecated`).
- **Ändert sich ein Ausgangstext**, werden alle seine Übersetzungen als **veraltet** markiert. Veraltete Übersetzungen kommen erst wieder ins Release, wenn jemand sie neu übersetzt.
- Deprecated Keys sind für Übersetzer ausgeblendet und verschwinden mit dem nächsten Release.

## Platzhalter und Textregeln
Platzhalter sehen so aus: `{name}`, also Buchstaben, Ziffern und Unterstrich in geschweiften Klammern. Eine Übersetzung muss genau dieselben Platzhalter enthalten wie der Ausgangstext. Pluralformen sind eigene Keys (`items.one`, `items.other`); das ICU-Nachrichtenformat ist für später geplant.

Harte Regeln (ein Vorschlag wird abgelehnt):
- dieselben Platzhalter wie im Ausgangstext; geschweifte Klammern nur für Platzhalter,
- nicht leer, höchstens 5000 Zeichen oder die Maximallänge des Keys,
- keine Steuerzeichen (Zeilenumbruch ist erlaubt), keine Zeichen, die die Schreibrichtung umkehren, Unicode in NFC-Form.

Weiche Warnungen (werden dem Prüfer gezeigt, blockieren nie): viel länger oder kürzer als der Ausgangstext, andere Leerzeichen am Anfang oder Ende, anderes Satzzeichen am Ende, gleich wie der Ausgangstext, eine Webadresse oder E-Mail, die nicht im Ausgangstext steht, Text, der nach HTML aussieht. Texte werden immer als reiner Text ausgeliefert und angezeigt, nie als HTML.

## Übersetzen
Öffne ein Projekt und drücke **Übersetzen** neben einer Sprache, in der du arbeitest.
- **Links:** die Liste der Keys mit Suchfeld und Filter: alle, nicht übersetzt, veraltet, in Prüfung, freigegeben. Auf dem Handy siehst du erst die Liste und nach der Auswahl eines Keys den Editor.
- **Rechts:** der Editor. Er zeigt den Ausgangstext, den Hinweis, die aktuelle freigegebene Übersetzung (mit „Veraltet“, wenn sich der Ausgangstext geändert hat), deinen offenen Vorschlag (mit **Zurückziehen**) oder die Begründung, mit der dein letzter Vorschlag abgelehnt wurde, und wie viele Vorschläge anderer auf Prüfung warten.
- **Platzhalter-Chips** über dem Textfeld fügen `{name}` an der Cursorposition ein.
- Die Regeln oben werden **beim Tippen** geprüft; der Knopf bleibt gesperrt, solange eine harte Regel verletzt ist. Ein Zähler zeigt verwendete und erlaubte Zeichen.
- **Entwürfe** werden automatisch in deinem Browser gespeichert und überstehen ein Neuladen. Gesendet werden sie erst mit **Vorschlag senden**.
- **Tastatur:** Strg+Enter (Cmd+Enter auf dem Mac) sendet, Alt+↑ und Alt+↓ wechseln zum vorherigen oder nächsten Key der gefilterten Liste.

Ein neuer Vorschlag für einen Key ersetzt deinen bisherigen offenen Vorschlag für diesen Key. Du kannst pro Projekt höchstens 100 offene Vorschläge haben.

## Prüfen
Owner und Prüfer sehen auf der Projektseite **Prüf-Warteschlange öffnen**.
- Wähle eine Sprache oder „Alle meine Sprachen“.
- Jede Karte zeigt den Key, wer ihn wann vorgeschlagen hat, den Ausgangstext und den Vorschlag als **Wort-Diff** gegenüber der aktuellen Übersetzung (entfernte Wörter durchgestrichen, neue unterstrichen). Ein Text für einen Key ohne Übersetzung erscheint als „Neue Übersetzung“.
- Warnungen, ein Hinweis, wenn sich der Ausgangstext nach dem Vorschlag geändert hat (solche Vorschläge können nicht freigegeben werden; lehne sie ab, damit die Person sie anpasst), und die Zahl weiterer offener Vorschläge für denselben Key.
- **Freigeben:** Der Text wird zur aktuellen Übersetzung, andere offene Vorschläge für denselben Key und dieselbe Sprache werden geschlossen (superseded). Live geht er mit dem nächsten Release.
- **Ablehnen …:** Gib eine Begründung ein (Pflicht, bis 500 Zeichen). Die Person sieht sie im Editor und in der Sammel-Mail.
- **Sammelfreigabe:** Vorschläge ohne Warnungen haben ein Feld „Auswählen“; **Ausgewählte freigeben** gibt sie nacheinander frei.

**Vier-Augen-Prinzip:** Niemand kann den eigenen Vorschlag freigeben. Für Projekte mit nur einer Person können Owner den **Solo-Modus** einschalten; dann dürfen Owner eigene Texte freigeben, jede solche Freigabe wird als Ausnahme protokolliert und in der Release-Vorschau gezählt. Auch die Datenbank erzwingt die Regel.

## Releases
Owner veröffentlichen Releases (jetzt über die API, Oberfläche mit UI-Teil 3):
1. **Vorschau** (`GET .../releases/preview`): nächste Release-Nummer, Änderungen pro Sprache (neu, geändert, entfernt), offene Vorschläge, Solo-Freigaben, ausgelassene veraltete Texte.
2. **Erstellen** (`POST .../releases` mit optionaler Notiz): Lexicast löst die Fallbacks auf, schreibt eine JSON-Datei pro Sprache, signiert das Manifest und schaltet es live. Pro Projekt kann nur ein Release gleichzeitig gebaut werden. Ein fehlgeschlagener Build hält den Grund fest und lässt das Live-Release unverändert.
3. **Verlauf** (`GET .../releases`): alle Releases mit Notizen, Änderungsübersicht, Fehlern und Rollbacks.
4. **Rollback** (`POST .../releases/{n}/rollback`): veröffentlicht den Inhalt eines älteren Releases als **neues** Release mit höherer Nummer, damit Apps es annehmen. Der Verlauf wird nie verändert.

Freigegebene Texte sind erst live, wenn ein Release gebaut wurde. Ein Release enthält nur aktive Keys und Übersetzungen, die nicht veraltet sind.

## Öffentliche Fortschrittsseite
Wenn ein Owner `progressPublic` einschaltet, zeigt `/progress/{slug}` allen ohne Anmeldung den Übersetzungsfortschritt pro Sprache: nur Zahlen, keine Key-Namen, Texte oder Personen. Sie funktioniert ohne JavaScript, auf Deutsch und Englisch, hell und dunkel. Ist die Einstellung aus, antwortet die Seite „nicht gefunden“, genau wie bei einem unbekannten Projekt.
