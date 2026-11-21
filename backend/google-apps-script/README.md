# INDUSTRYAI – automatische Kontaktbenachrichtigung

Die Kontaktanfrage wird zuerst in Supabase gespeichert. Anschließend ruft die Supabase-Edge-Function dieses Google-Apps-Script-Web-App-Endpoint auf. Das Script sendet eine Benachrichtigung über das Gmail-Konto an `industryaisupport@gmail.com`. Die Nachricht bleibt außerdem im geschützten INDUSTRYAI-Admin-Posteingang.

## 1. Google Apps Script anlegen

1. Mit dem Google-Konto `industryaisupport@gmail.com` öffnen: https://script.google.com/
2. Ein neues eigenständiges Projekt erstellen, z. B. **INDUSTRYAI Kontaktbenachrichtigung**.
3. Den Inhalt aus `ContactNotification.gs` in die Datei `Code.gs` kopieren und speichern.
4. In **Projekteinstellungen → Skripteigenschaften** eine Eigenschaft hinzufügen:
   - Name: `INDUSTRYAI_WEBHOOK_SECRET`
   - Wert: ein zufälliger, mindestens 32 Zeichen langer geheimer Wert. Einen Passwortmanager oder sicheren Zufallsgenerator verwenden.
   - Diesen Wert niemals in den Quellcode oder auf GitHub schreiben.

## 2. Gmail-Zugriff autorisieren

1. Im Apps-Script-Editor die Funktion `authorizeGmailAccess` auswählen.
2. Einmal manuell ausführen.
3. Die angeforderten Berechtigungen für das eigene Gmail-Konto prüfen und erteilen.

## 3. Als Web-App veröffentlichen

1. **Bereitstellen → Neue Bereitstellung** öffnen.
2. Typ **Web-App** auswählen.
3. **Ausführen als:** Ich.
4. **Zugriff:** Jeder.
5. Bereitstellen und die URL kopieren, die auf `/exec` endet.

Der öffentliche Zugriff ist erforderlich, damit Supabase den Endpunkt serverseitig erreichen kann. Der Endpunkt akzeptiert aber nur Anfragen mit dem geheimen Schlüssel aus den Skripteigenschaften. Der Schlüssel wird über HTTPS im POST-Body übertragen.

## 4. Supabase-Secrets hinterlegen

Im Supabase-Projekt **industryai-backend** unter **Project Settings → Edge Functions → Secrets** zwei Secrets anlegen:

- `INDUSTRYAI_EMAIL_WEBHOOK_URL` = vollständige Apps-Script-Web-App-URL mit `/exec`
- `INDUSTRYAI_EMAIL_WEBHOOK_SECRET` = exakt derselbe geheime Wert wie in den Skripteigenschaften

Die URL und den geheimen Wert nicht in Website-Dateien, GitHub-Commits oder Chat-Nachrichten eintragen.

## 5. Verhalten und Datenschutz

- Die Anfrage wird zuerst in der privaten Supabase-Tabelle `contact_messages` gespeichert.
- Erst danach wird die E-Mail-Benachrichtigung ausgelöst.
- Ein Versandfehler löscht die Anfrage nicht und verhindert nicht die Bestätigung der erfolgreichen Speicherung.
- Die Benachrichtigung enthält Name, E-Mail, Betreff, Nachricht und Referenz-ID; Antworten auf die Benachrichtigung gehen direkt an die Absenderadresse.
- Das Script protokolliert keine Nachrichteninhalte oder Schlüssel.
- Ein sechs Stunden langes Deduplizierungsfenster verhindert doppelte Benachrichtigungen für dieselbe Referenz.
- Die Benachrichtigung ist erst aktiv, nachdem beide Supabase-Secrets hinterlegt und die Web-App veröffentlicht wurden.

## Offizielle Google-Dokumentation

- Apps Script Web-Apps: https://developers.google.com/apps-script/guides/web
- GmailApp.sendEmail: https://developers.google.com/apps-script/reference/gmail/gmail-app#sendEmail(String,String,String,Object)
