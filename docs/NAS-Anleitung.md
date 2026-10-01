# Dog auf dem Synology NAS betreiben

Anleitung für ein **DS224+ mit DSM 7.4** und den **Container Manager**. Das Spiel läuft als ein einziger Container und ist
im Heimnetz (WLAN) und – über einen Cloudflare Tunnel – auch aus dem Internet erreichbar.

**Übersicht**

```
Handy/PC  ──►  https://dog.deinedomain.ch  ──►  Cloudflare Tunnel  ──►  NAS: Container "dog" (Port 3000)
Handy im WLAN  ──►  http://NAS-IP:3000  ──────────────────────────────►  NAS: Container "dog"
```

Es wird **keine Portfreigabe im Router** gebraucht und das NAS ist nicht direkt aus dem Internet erreichbar.

---

## 1. Voraussetzungen

- DSM 7.2 oder neuer (getestet ist die Konfiguration für 7.4) mit installiertem **Container Manager**
  (Paket-Zentrum → „Container Manager“).
- Für den Zugriff aus dem Internet: eine **eigene Domain** (etwa 10 CHF pro Jahr), deren DNS bei Cloudflare
  liegt (der kostenlose Cloudflare-Tarif reicht). Ohne Domain siehe [Abschnitt 6](#6-alternativen-ohne-eigene-domain).

## 2. Ordner für die Spielstände anlegen

Der Container Manager legt den Ordner `docker` nicht immer selbst an. So erstellst du die Ordner:

- **Variante A (einfach):** In der **File Station** im vorhandenen Ordner (z. B. `Daten`) über **Erstellen → Ordner erstellen**
  den Ordner `docker` anlegen, darin `dog` und darin `data`. Den vollen Pfad zeigt ein Rechtsklick auf `data` →
  **Eigenschaften** → **Allgemein** → „Ort“, z. B. `/volume1/Daten/docker/dog/data`.
- **Variante B (Synology-Empfehlung):** **Systemsteuerung → Gemeinsamer Ordner → Erstellen**, Name `docker`. Darin wie oben
  `dog/data` anlegen. Der Pfad lautet dann `/volume1/docker/dog/data`.

In den Compose-Dateien steht standardmäßig `/volume1/docker/dog/data`. Bei Variante A den Pfad bei `volumes:` durch deinen
Ort ersetzen. Das Spiel speichert dort laufende Spiele, damit sie einen Neustart des NAS oder des Containers überstehen.

## 3. Das Image bereitstellen

**Variante A (empfohlen): fertiges Image von GitHub laden**

Bei jedem Push nach `master` baut GitHub automatisch ein Image (Workflow „Docker-Image“) und legt es unter
`ghcr.io/seppbucher-develop/dog:latest` ab. Beim ersten Mal:

1. Auf GitHub im Repository unter **Actions** prüfen, dass „Docker-Image“ grün durchgelaufen ist
   (sonst dort „Run workflow“ wählen).
2. Auf GitHub → Profil → **Packages** → `dog` → **Package settings** → **Change visibility** → **Public**.
   Sonst kann das NAS das Image nicht ohne Anmeldung laden.

**Variante B: Image auf dem NAS selbst bauen**

Nur nötig, wenn Variante A nicht geht. Das Repository als ZIP von GitHub laden, auf das NAS nach
`/volume1/docker/dog-src` entpacken und beim Projekt (Schritt 4) die Datei `deploy/docker-compose.build.yml` verwenden.
Der Ordner des Projekts ist dann `/volume1/docker/dog-src/deploy`. Der Bau dauert auf dem NAS einige Minuten.

## 4. Projekt im Container Manager anlegen

### Nur Heimnetz

1. Container Manager → **Projekt** → **Erstellen**.
2. Projektname `dog`, Pfad `/docker/dog` (bei Variante A in Schritt 2 z. B. `/Daten/docker/dog`).
3. Quelle **docker-compose.yml erstellen** und den Inhalt der Datei `deploy/docker-compose.yml` einfügen.
4. **Weiter** bis zum Ende, Projekt **starten**.
5. Auf dem Handy im selben WLAN `http://<NAS-IP>:3000` öffnen (die IP steht in der Systemsteuerung unter Netzwerk).

### Mit Zugriff aus dem Internet (Cloudflare Tunnel)

1. **Tunnel anlegen:** [one.dash.cloudflare.com](https://one.dash.cloudflare.com) (Zero Trust; beim ersten Mal den kostenlosen
   Tarif „Free“ wählen, Cloudflare verlangt dafür evtl. eine Zahlungsmethode, berechnet im Free-Tarif aber nichts) →
   **Networks → Connectors** (früher „Tunnels“) → **Connector erstellen** → Typ **Cloudflared** → Name z. B. `dog-nas`.
   Auf der Seite „Connector installieren“ **nichts installieren**: Betriebssystem auf **Docker** stellen und nur den
   **Token** kopieren (der lange Text nach `--token`, beginnt mit `eyJ`). Der Token ist wie ein Passwort.
2. **Route festlegen** (Schritt „Tunnel routen“ bzw. „Veröffentlichte Anwendungsrouten“):
   - Subdomain `dog`, Domain: deine Domain (sie muss bei Cloudflare verwaltet werden; eine DynDNS-Adresse genügt nicht)
   - Dienst: Typ `HTTP`, URL `dog:3000` (`dog` ist der Name des Containers im selben Projekt)
   - Keine „Zugriffsanwendung“ (Access) anlegen, sonst müssten sich alle Mitspieler bei Cloudflare anmelden.
3. **Projekt im Container Manager** mit dem Inhalt von `deploy/docker-compose.cloudflare.yml` anlegen (oder das bestehende
   Projekt ändern) und bei `TUNNEL_TOKEN` den Token **in Gänsefüßchen** eintragen. Bei einem bestehenden Projekt: Projekt öffnen →
   Reiter **YAML-Konfigurationen** → Text ersetzen → **Speichern** → **Aktion → Erstellen** (erst das baut die neuen
   Container auf). Danach laufen die Container `dog` und `dog-tunnel`.
4. Im Tunnel-Dashboard sollte der Status nach etwa einer Minute **Healthy** zeigen.
5. Auf dem Handy (auch im Mobilfunknetz) `https://dog.deinedomain.ch` öffnen. WebSockets funktionieren bei Cloudflare
   ohne weitere Einstellung.

Spielinitiator und Mitspieler brauchen dieselbe Adresse. Der Initiator kopiert in der Lobby den **Einladungslink**
und schickt ihn per Messenger.

## 5. Sicherheit

- **Keine Portfreigabe** für Port 3000 im Router einrichten. Der Zugriff aus dem Internet läuft ausschließlich durch
  den Tunnel. Wer nur den Tunnel nutzen will, entfernt in der Compose-Datei die Zeilen `ports: - "3000:3000"`.
- DSM (Port 5000/5001) niemals ins Internet freigeben und die Zwei-Faktor-Anmeldung für das NAS-Konto aktivieren.
- Ein Spiel ist nur über den 5-stelligen Code erreichbar, und der Initiator muss jeden Mitspieler einzeln **bewilligen**.
  Der Server begrenzt Nachrichtengröße und -häufigkeit und prüft jeden Spielzug selbst; niemand kann fremde Karten sehen.
- Zusätzlicher Schutz (optional): in Cloudflare unter *Access* eine Richtlinie anlegen, die nur bestimmte E-Mail-Adressen
  auf `dog.deinedomain.ch` lässt. Dann ist die Seite für alle anderen gesperrt.
- Das Spiel speichert nur Namen und Spielstände in `/volume1/docker/dog/data`. Es gibt keine Konten und keine Passwörter.
  Spiele, die 24 Stunden unbenutzt sind, werden automatisch gelöscht.

## 6. Alternativen ohne eigene Domain

- **Schneller Test-Tunnel (kostenlos, ohne Konto):** Einen zusätzlichen Container mit
  `cloudflare/cloudflared:latest` und dem Befehl `tunnel --no-autoupdate --url http://dog:3000` starten. Im Protokoll
  erscheint eine Adresse wie `https://zufaellig.trycloudflare.com`. Sie ändert sich bei jedem Start und eignet sich nur
  zum Ausprobieren.
- **Tailscale:** Auf dem NAS das Paket „Tailscale“ installieren. Jeder Mitspieler installiert die Tailscale-App und
  wird in dein „Tailnet“ eingeladen. Dann öffnen alle `http://<NAS-Tailscale-Name>:3000`. Das ist sehr sicher, aber
  jeder Mitspieler braucht die App. Mit **Tailscale Funnel** ließe sich die Seite auch ohne App öffentlich machen.

## 7. Betrieb

| Aufgabe | So geht es |
|---|---|
| **Aktualisieren** | Container Manager → **Registrierung/Image** → `ghcr.io/seppbucher-develop/dog` erneut herunterladen, dann **Projekt** `dog` → **Aktion** → **Neu erstellen** (bzw. Stopp und Start). Laufende Spiele bleiben erhalten. |
| **Protokoll ansehen** | Container Manager → **Container** → `dog` → **Protokoll** |
| **Sicherung** | Den Ordner `/volume1/docker/dog/data` sichern (Hyper Backup). Mehr gibt es nicht zu sichern. |
| **Neu anfangen** | Projekt stoppen, Datei `rooms.json` im Ordner `data` löschen, Projekt starten. |

### Einstellungen (Umgebungsvariablen)

| Variable | Standard | Bedeutung |
|---|---|---|
| `PORT` | `3000` | Port im Container |
| `BOT_DELAY_MS` | `900` | Wartezeit vor jedem Computerzug in Millisekunden (0 = sofort) |
| `DATA_DIR` | `/data` | Ordner für gespeicherte Spiele |
| `ALLOWED_ORIGINS` | leer | Weitere erlaubte Adressen für WebSocket-Verbindungen (kommagetrennt, z. B. `https://spiel.example.ch`); normalerweise nicht nötig |

## 8. Fehlersuche

- **Im Protokoll steht „WARNUNG: Spiele können nicht gespeichert werden“:** Der Container darf nicht in den Ordner
  `data` schreiben. Das Spiel läuft trotzdem, verliert aber bei einem Neustart die Spiele. Abhilfe: per SSH `id` mit dem
  NAS-Konto ausführen, die Zahlen für Benutzer und Gruppe in der Compose-Datei bei `user:` eintragen (z. B. `"1026:100"`)
  und die Zeile aktivieren, dann das Projekt neu starten.
- **„Verbindung unterbrochen“ im Spiel:** Meist blockiert ein Zwischenschritt WebSockets. Bei Cloudflare ist nichts nötig.
  Falls du stattdessen den **Reverse Proxy von DSM** nutzt (Systemsteuerung → Anmeldeportal → Erweitert →
  Reverse Proxy), in der Regel unter „Benutzerdefinierter Header“ die Schaltfläche **Erstellen → WebSocket** wählen,
  sonst bricht die Verbindung sofort ab.
- **Tunnel zeigt „Down“:** Token in der `.env` prüfen (keine Anführungszeichen, keine Leerzeichen) und im Protokoll des
  Containers `dog-tunnel` nachsehen.
- **Container ist „unhealthy“:** Im Protokoll von `dog` nach Fehlern suchen. Der Health-Check ruft
  `http://127.0.0.1:3000/healthz` im Container auf.
