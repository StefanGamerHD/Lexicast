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
Die Startseite listet deine Projekte. Die Projektseite zeigt jede Sprache mit einem Fortschrittsbalken, wie viele Texte in Prüfung oder veraltet sind, das aktuelle Release und Knöpfe zum Übersetzen oder Prüfen. Eine Navigationsleiste führt zu den Bereichen des Projekts; du siehst nur die, die deine Rollen erlauben (Übersicht, Prüfen, Keys, Releases, Mitglieder, Einstellungen).

## Mitglieder und Einladungen
Owner verwalten Personen unter **Mitglieder**:
- **Person oder Rolle hinzufügen:** E-Mail, Rolle (Übersetzer, Prüfer, Owner) und bei Übersetzern und Prüfern die Sprache. Wer schon ein Konto hat, bekommt die Rolle sofort. Alle anderen bekommen eine Einladung, ein Konto anzulegen (7 Tage gültig, nur einmal nutzbar); ohne Mail, oder wenn der Versand scheitert, zeigt die Seite den Link einmal mit Kopieren-Knopf.
- **Personen:** alle mit ihren Rollen; **Entfernen** neben einer Rolle nimmt sie weg. „Rolle hinzufügen …“ trägt die E-Mail der Person oben ins Formular ein.
- Ein Projekt behält immer mindestens einen Owner. Wenn du deine eigene Owner-Rolle entfernst, wirst du vorher gefragt, weil du den Zugriff auf die Owner-Bereiche verlierst.
- **Offene Einladungen:** E-Mail, Rolle, wer eingeladen hat und bis wann sie gilt (abgelaufene sind markiert). **Widerrufen** löscht die Einladung; ihr Link funktioniert sofort nicht mehr.

## Einstellungen
Owner ändern das Projekt unter **Einstellungen**:
- **Allgemein:** Projektname (der Slug in Adressen lässt sich nicht ändern), **öffentliche Fortschrittsseite** an oder aus, **Solo-Modus** an oder aus (siehe Prüfen).
- **Sprachen:** Jede Zielsprache hat eine **Fallback-Kette**, eingegeben als andere Projektsprachen mit Kommas getrennt (z. B. `de, en`); leer heißt nur Ausgangssprache. Die Kette wird vor dem Speichern gegen die Sprachen des Projekts geprüft.
- **Sprache hinzufügen:** ein BCP-47-Kürzel (z. B. `fr`, `pt-BR`, `de-AT`) und seine Fallback-Kette. Gib danach jemandem die Übersetzer-Rolle dafür. Sprachen entfernen geht noch nicht.

## Keys und Ausgangstexte
Ein Key ist ein Text deiner App, z. B. `cart.items` mit dem Ausgangstext `{count} items in your cart`. Owner verwalten Keys unter **Keys** in der Projekt-Navigation.
- **Key-Liste:** Suche, Filter (aktiv, deprecated, alle) und pro Key, wie viele Sprachen übersetzt und wie viele Übersetzungen veraltet sind.
- **Neuer Key:** Name (Buchstaben, Ziffern, Punkt, Bindestrich, Unterstrich; lässt sich später nicht ändern), Ausgangstext, optional ein Hinweis für Übersetzer und eine Maximallänge. Die Textregeln werden beim Tippen geprüft.
- **JSON importieren:** Datei hochladen oder JSON einfügen, flach (`{"cart.title": "Your cart"}`) oder verschachtelt (`{"cart": {"title": "Your cart"}}`). Ungültiges JSON wird mit Zeile und Spalte gemeldet. **Vorschau anzeigen** listet, was neu hinzukäme, sich änderte, wieder aktiv würde, gleich bliebe und welche vorhandenen Keys nicht in der Datei stehen; gespeichert wird noch nichts. **Import übernehmen** speichert. Der Import gilt ganz oder gar nicht: Ein ungültiger Text lehnt die ganze Datei ab, und die Seite zeigt, welche Keys betroffen sind. Mit der Option „Keys, die nicht in dieser Datei stehen, als deprecated markieren“ werden sie deprecated; ohne sie bleiben sie, wie sie sind. Änderst du Text oder Option, brauchst du eine neue Vorschau.
- **Key-Seite** (Key anklicken): Ausgangstext, Hinweis, Maximallänge und Zustand (`active` oder `deprecated`) bearbeiten und die Übersetzung jeder Sprache mit Zustand und offenen Vorschlägen sehen, mit Link in den Editor.
- **Ändert sich ein Ausgangstext**, werden alle seine Übersetzungen als **veraltet** markiert; die Key-Seite sagt vor dem Speichern, wie viele. Veraltete Übersetzungen kommen erst wieder ins Release, wenn jemand sie neu übersetzt.
- Deprecated Keys sind für Übersetzer ausgeblendet und verschwinden mit dem nächsten Release. Keys werden nie gelöscht.

Skripte können dasselbe über die API (`POST .../keys`, `PATCH .../keys/{name}`, `POST .../keys/import` mit `apply: false` für die Vorschau und `apply: true` zum Speichern); siehe [API-Referenz](api.md#keys).

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
**Releases** in der Projekt-Navigation zeigt allen Mitgliedern das Live-Release und den Verlauf. Owner sehen zusätzlich das nächste Release:
1. **Vorschau:** die nächste Release-Nummer und pro Sprache, wie viele Keys neu, geändert oder entfernt sind (Sprache aufklappen für die Key-Namen). Darunter: Vorschläge, die noch auf Prüfung warten (nicht enthalten), ausgelassene veraltete Übersetzungen und Freigaben im Solo-Modus.
2. **Veröffentlichen:** optional eine Notiz eintragen (steht im Verlauf neben der erzeugten Änderungsliste) und **Release {n} veröffentlichen** drücken. Lexicast löst die Fallbacks auf, schreibt eine JSON-Datei pro Sprache, signiert das Manifest und schaltet es live. Der Knopf ist gesperrt, wenn sich seit dem Live-Release nichts geändert hat. Pro Projekt kann nur ein Release gleichzeitig gebaut werden; ein fehlgeschlagener Build hält den Grund im Verlauf fest und lässt das Live-Release unverändert.
3. **Verlauf:** jedes Release mit Datum, wer, Notiz, Änderungen pro Sprache, Fehlern und den Markierungen „Live“, „Fehlgeschlagen“ und „Zurückgerollt“.
4. **Wiederherstellen (Rollback):** Bei einem älteren veröffentlichten Release fragt **Release {n} wiederherstellen …** nach Bestätigung und einer optionalen Notiz und veröffentlicht dann diesen Inhalt als **neues** Release mit höherer Nummer, damit Apps es annehmen. Die Releases dazwischen werden als „Zurückgerollt“ markiert. Der Verlauf wird nie verändert.

API: `GET .../releases/preview`, `POST .../releases`, `POST .../releases/{n}/rollback`, `GET .../releases`; siehe [API-Referenz](api.md#releases).

Freigegebene Texte sind erst live, wenn ein Release gebaut wurde. Ein Release enthält nur aktive Keys und Übersetzungen, die nicht veraltet sind.

## Öffentliche Fortschrittsseite
Wenn ein Owner `progressPublic` einschaltet, zeigt `/progress/{slug}` allen ohne Anmeldung den Übersetzungsfortschritt pro Sprache: nur Zahlen, keine Key-Namen, Texte oder Personen. Sie funktioniert ohne JavaScript, auf Deutsch und Englisch, hell und dunkel. Ist die Einstellung aus, antwortet die Seite „nicht gefunden“, genau wie bei einem unbekannten Projekt.
