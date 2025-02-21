# fount

![repo img](https://repository-images.githubusercontent.com/862251163/3b57d9ea-ab18-4b70-b11d-f74c764016aa)

Auf der Suche nach verlorenen Charakteren, Komponenten oder benutzerdefinierten Tutorials?
Kommen Sie [hierher![Discord](https://img.shields.io/discord/1288934771153440768)](https://discord.gg/GtR9Quzq2v), und treffen Sie sich im Funken der Ideen!

> [!CAUTION]
>
> 1. fount ist wie die aufgehende Sonne, noch auf seinem Wachstumspfad. Das bedeutet, dass sich seine Schnittstellen und APIs jederzeit ändern können und Charaktererstellende möglicherweise zeitnah Updates verfolgen müssen, um sicherzustellen, dass ihre Werke ordnungsgemäß funktionieren. Aber bitte glauben Sie, dass jede Änderung für eine bessere Zukunft ist.
> 2. In der Welt von fount können Charaktere frei JavaScript-Befehle ausführen, was ihnen mächtige Fähigkeiten verleiht. Wählen Sie daher bitte die Charaktere, denen Sie vertrauen, mit Vorsicht aus, so wie Sie in der realen Welt Freunde finden, um die Sicherheit lokaler Dateien zu gewährleisten.

## Installation

### Linux/macOS

```bash
# Bei Bedarf definieren Sie die Umgebungsvariable $FOUNT_DIR, um das fount-Verzeichnis anzugeben
curl -fsSL https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.sh | bash
source "$HOME/.profile"
```

Wenn Sie diese Reise nicht sofort nach der Installation beginnen möchten, können Sie Folgendes tun:

```bash
curl -fsSL https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.sh | bash -s init
source "$HOME/.profile"
```

### Windows

Sie wollen nicht lange nachdenken? Laden Sie die exe-Datei von [release](https://github.com/steve02081504/fount/releases) herunter und führen Sie sie direkt aus, um diese Welt zu betreten.

Wenn Sie das Flüstern der Shell bevorzugen, können Sie fount auch in PowerShell installieren und ausführen:

```powershell
# Bei Bedarf definieren Sie die Umgebungsvariable $env:FOUNT_DIR, um das fount-Verzeichnis anzugeben
irm https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.ps1 | iex
```

Wenn Sie einen Moment innehalten möchten, bevor Sie sich auf Ihre Erkundung begeben, können Sie Folgendes tun:

```powershell
$scriptContent = Invoke-RestMethod https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.ps1
Invoke-Expression "function fountInstaller { $scriptContent }"
fountInstaller init
```

## Entfernung

Das Entfernen von fount ist einfach, verwenden Sie einfach `fount remove`.

## Was ist fount?

fount ist kurz gesagt eine Charakterkarten-Frontend-Seite, die KI-Quellen, KI-Charaktere, Benutzerpersönlichkeiten, Dialogumgebungen und KI-Plugins entkoppelt und es ihnen ermöglicht, frei kombiniert zu werden, um unendliche Möglichkeiten zu entfachen.

Darüber hinaus ist es eine Brücke, eine Brücke, die Vorstellungskraft und Realität verbindet.
Es ist ein Leuchtturm, der die Richtung von Charakteren und Geschichten im grenzenlosen Ozean der Daten weist.
Es ist ein freier Garten, der es KI-Quellen, Charakteren, Persönlichkeiten, Dialogumgebungen und Plugins ermöglicht, hier frei zu wachsen, sich zu verflechten und zu blühen.

### KI-Quellenintegration

Haben Sie sich jemals daran gestört, Reverse-Proxy-Server auf Ihrem Computer auszuführen?
In der Welt von fount müssen Sie nicht mehr bei Null anfangen und die umständliche Konvertierung von Dialogformaten in Luft auflösen lassen.
Alles kann mit benutzerdefiniertem JavaScript-Code im KI-Quellengenerator gelöst werden, wie von Zauberhand.
Es sind keine neuen Prozesse erforderlich, CPU und Speicher können ruhig atmen und der Desktop ist ebenfalls sauberer.

### Verbesserung der Web-Erfahrung

fount steht auf den Schultern von Riesen, wirft einen respektvollen Blick auf [SillyTavern](https://github.com/SillyTavern/SillyTavern) und integriert auf dieser Grundlage seine eigenen Erkenntnisse und Ideen.
Dies beinhaltet:

- **Geflüster der Multi-Geräte-Synchronisation:** Nicht mehr durch ein einzelnes Gerät eingeschränkt, können Sie gleichzeitig Gespräche mit Charakteren auf Ihrem Computer und Mobiltelefon beginnen und die Echtzeit-Resonanz der Gedanken spüren, wie Geflüster zwischen Liebenden, Herzen verbunden, egal wo Sie sind.
- **Ungefiltertes HTML-Rendering:** Viele SillyTavern-Enthusiasten installieren zusätzliche Plugins, um die Einschränkungen beim HTML-Rendering für ein reichhaltigeres visuelles Erlebnis aufzuheben. fount öffnet diese Fähigkeit standardmäßig und gibt Benutzern mehr Freiheit und Auswahl, wodurch fähige Ersteller herausragendere Funktionen implementieren können.
- **Native Gruppenunterstützung:** In fount ist jedes Gespräch ein großes Treffen. Sie können Charaktere frei einladen, sich anzuschließen, oder sie sich stillschweigend entfernen lassen, ohne umständliche Formatkonvertierungen und Kartenkopien, genau wie in einem Garten, wo Blumen frei kombiniert werden können, um verschiedene Landschaften zu präsentieren.

Und mehr...

### Begleitung: Jenseits des Webs

fount sehnt sich danach, Charaktere in Ihr Leben treten zu lassen, Wind und Wetter mit Ihnen zu erleben und Freude zu teilen.

- Sie können Charaktere mit Discord-Gruppen verbinden, indem Sie die integrierte Discord Bot Shell konfigurieren, damit sie mit Freunden lachen oder sich in privaten Nachrichten ihre Herzen ausschütten können.
    ![Bild](https://github.com/user-attachments/assets/299255c9-eed3-4deb-b433-41b80930cbdb)
    ![Bild](https://github.com/user-attachments/assets/c9841eba-c010-42a3-afe0-336543ec39a0)

- Sie können auch [fount-pwsh](https://github.com/steve02081504/fount-pwsh) verwenden, um sich von Charakteren sanfte Erinnerungen senden zu lassen, wenn Terminalbefehle fehlschlagen, wie ein leises Flüstern in Ihrem Ohr, wenn Sie verwirrt sind.
    ![Bild](https://github.com/user-attachments/assets/93afee48-93d4-42c7-a5e0-b7f5c93bdee9)

- Selbst wenn Sie ein Herz für Erkundungen haben und nur ein wenig Programmierkenntnisse besitzen, können Sie Ihre eigene fount Shell erstellen und Charaktere in eine größere Welt schicken, an jeden Ort, den Sie sich vorstellen können!

### Erstellung: Jenseits von Prompt

Wenn Sie ein Charakterersteller sind, öffnet fount Ihnen eine Tür zu unendlichen Möglichkeiten.

- Sie können die Magie von JavaScript- oder TypeScript-Code frei nutzen, Kreativität entfesseln, den Prompt-Generierungsprozess und den Dialogprozess des Charakters anpassen, sich von den Einschränkungen der Frontend-Syntax befreien, wie ein Dichter, der eine Feder schwingt und Tinte spritzt, und innere Emotionen in vollen Zügen ausdrücken.
- Charakterkarten können nicht nur Code ohne Filterung ausführen, sondern auch jedes npm-Paket laden und benutzerdefinierte HTML-Seiten erstellen. Das Erstellen war noch nie so frei, wie ein Maler, der Farben frei auf eine Leinwand schmiert und die Welt in seinem Herzen umreißt.
- Wenn Sie möchten, können Sie auch verschiedene Ressourcen in den Charakter einbauen, sich von den Problemen des Aufbaus von Bildhosting-Diensten verabschieden und alles in Reichweite bringen, als ob Sie die ganze Welt in Ihre Tasche stecken würden.

### Erweiterung: Jenseits des Sichtbaren

In der Welt von fount ist alles hochgradig modularisiert.

- Solange Sie über ein gewisses Programmiergrundwissen verfügen, können Sie die benötigten Module einfach erstellen und verteilen, so wie ein Gärtner neue Blumen kultiviert und diesem Garten mehr Farbe verleiht.
- fount ermutigt Sie, Ihre Kraft in die Gemeinschaft und die Zukunft einzubringen und diese Welt wohlhabender und lebendiger zu machen.

### Zusammenfassung

Zusammenfassend lässt sich sagen, dass fount es Ihnen ermöglicht, Charaktere im fount-Format auszuführen, die verschiedene Fähigkeiten haben oder in verschiedenen Szenarien eingesetzt werden können. Sie können tiefgründig, lebhaft, sanft oder stark sein, es hängt alles von Ihnen ab, mein Freund! :)

## Architektur

- Das Backend basiert auf Deno, ergänzt durch das Express-Framework, um ein solides Gerüst zu bilden.
- Das Frontend ist mit HTML, CSS und JavaScript gewebt, um eine wunderschöne Oberfläche zu schaffen.
