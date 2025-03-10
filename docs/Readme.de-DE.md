# fount

![repo img](https://repository-images.githubusercontent.com/862251163/3b57d9ea-ab18-4b70-b11d-f74c764016aa)

Auf der Suche nach verlorenen Charakteren, Komponenten oder benutzerdefinierten Tutorials?
Kommt [hier![Discord](https://img.shields.io/discord/1288934771153440768)](https://discord.gg/GtR9Quzq2v) vorbei und trefft euch im Geistesblitz!

> [!CAUTION]
>
> In der Welt von fount können Charaktere frei JavaScript-Befehle ausführen, was ihnen beträchtliche Macht verleiht. Wählt daher die Charaktere, denen ihr vertraut, mit Bedacht aus, so wie ihr im echten Leben Freunde gewinnt, um die Sicherheit eurer lokalen Dateien zu gewährleisten.

<details open>
<summary>Bildschirmfotos</summary>

|Bildschirmfotos|
|----|
|Startseite|
|![Bild](https://github.com/user-attachments/assets/c1954a7a-6c73-4fb0-bd12-f790a038bd0e)|
|Themenauswahl|
|![Bild](https://github.com/user-attachments/assets/94bd4cbb-8c66-4bc6-83eb-14c925a37074)|
|Chat|
|![Bild](https://github.com/user-attachments/assets/eea1cc7c-d258-4a2d-b16f-12815a88811d)|

</details>

<details open>
<summary>Installation/Deinstallation</summary>

## Installation

### Linux/macOS/Android

```bash
# Bei Bedarf definieren Sie die Umgebungsvariable $FOUNT_DIR, um das fount-Verzeichnis anzugeben
curl -fsSL https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.sh | bash
source "$HOME/.profile"
```

Wenn Sie die Reise nicht sofort nach der Installation beginnen möchten, können Sie dies tun:

```bash
curl -fsSL https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.sh | bash -s init
source "$HOME/.profile"
```

### Windows

Keine Lust, lange nachzudenken? Laden Sie die EXE-Datei aus [Release](https://github.com/steve02081504/fount/releases) herunter und führen Sie sie direkt aus, um diese Welt zu betreten.

Wenn Sie das Flüstern der Shell bevorzugen, können Sie fount auch in PowerShell installieren und ausführen:

```powershell
# Bei Bedarf definieren Sie die Umgebungsvariable $env:FOUNT_DIR, um das fount-Verzeichnis anzugeben
irm https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.ps1 | iex
```

Wenn Sie einen Moment innehalten möchten, bevor Sie sich auf die Erkundung begeben, können Sie dies tun:

```powershell
$scriptContent = Invoke-RestMethod https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.ps1
Invoke-Expression "function fountInstaller { $scriptContent }"
fountInstaller init
```

## Deinstallation

Entfernen Sie fount mühelos mit `fount remove`.

</details>

## Was ist fount?

fount ist, kurz gesagt, eine Frontend-Seite für Charakterkarten, die KI-Quellen, KI-Charaktere, Benutzerpersönlichkeiten, Gesprächsumgebungen und KI-Plugins entkoppelt und es ihnen ermöglicht, frei kombiniert zu werden und unendliche Möglichkeiten zu entfachen.

Noch weiter gefasst ist es eine Brücke, eine Brücke, die Vorstellung und Realität verbindet.
Es ist ein Leuchtturm, der die Richtung von Charakteren und Geschichten im unendlichen Ozean der Daten weist.
Es ist ein freier Garten, in dem KI-Quellen, Charaktere, Persönlichkeiten, Gesprächsumgebungen und Plugins frei wachsen, sich verflechten und erblühen können.

### KI-Quellenintegration

Waren Sie jemals genervt davon, Reverse-Proxy-Server auf Ihrem Computer auszuführen?
In der Welt von fount müssen Sie nicht mehr bei Null anfangen und können die mühsame Konvertierung von Dialogformaten in Luft auflösen lassen.
Alles kann mit benutzerdefiniertem JavaScript-Code im KI-Quellengenerator gelöst werden, wie von Zauberhand.
Es sind keine neuen Prozesse erforderlich, sodass Ihre CPU und Ihr Speicher ruhig atmen können und Ihr Desktop übersichtlicher wird.

![Bild](https://github.com/user-attachments/assets/f283d1de-c531-4b7a-bf43-3cbe0c48b7b9)

### Verbesserung der Web-Erfahrung

fount steht auf den Schultern von Riesen, wirft einen respektvollen Blick auf [SillyTavern](https://github.com/SillyTavern/SillyTavern) und integriert darauf aufbauend eigene Erkenntnisse und Ideen.
Dazu gehören:

- **Geräteübergreifende synchronisierte Flüstern:** Nicht mehr auf ein einzelnes Gerät beschränkt, können Sie gleichzeitig auf Ihrem Computer und Mobiltelefon Gespräche mit Charakteren führen und die Echtzeit-Resonanz der Gedanken spüren, wie süße Worte, die sich Liebende zuflüstern und die Herzen verbinden, egal wo Sie sich befinden.
- **Ungefiltertes HTML-Rendering:** Viele SillyTavern-Enthusiasten installieren zusätzliche Plugins, um die Einschränkungen des HTML-Renderings für ein reichhaltigeres visuelles Erlebnis aufzuheben. fount öffnet diese Funktion standardmäßig und gibt Benutzern mehr Freiheit und Auswahlmöglichkeiten, sodass fähige Entwickler herausragendere Funktionen realisieren können.
- **Native Gruppenunterstützung:** In fount ist jedes Gespräch ein großes Treffen. Sie können Charaktere frei einladen, beizutreten, oder sie still und leise gehen lassen, ohne umständliche Formatkonvertierungen und Kartenkopien, so wie in einem Garten Blumen frei kombiniert werden können, um unterschiedliche Landschaften zu präsentieren.

Und mehr...

![Bild](https://github.com/user-attachments/assets/bd1600dc-4612-458b-95ba-c7b019a26390)

### Begleitung: Mehr als nur Webseiten

fount sehnt sich danach, Charaktere in Ihr Leben zu bringen, mit Ihnen Wind und Wetter zu erleben und Freude zu teilen.

- Sie können Charaktere mit Discord-Gruppen verbinden, indem Sie die integrierte Discord Bot Shell konfigurieren, damit sie mit Freunden lachen oder sich in privaten Nachrichten das Herz ausschütten können.
    ![Bild](https://github.com/user-attachments/assets/299255c9-eed3-4deb-b433-41b80930cbdb)
    ![Bild](https://github.com/user-attachments/assets/c9841eba-c010-42a3-afe0-336543ec39a0)

- Sie können auch [fount-pwsh](https://github.com/steve02081504/fount-pwsh) verwenden, damit Ihnen Charaktere sanfte Erinnerungen schicken, wenn Terminalbefehle fehlschlagen, wie leises Flüstern in Ihrem Ohr, wenn Sie verloren sind.
    ![Bild](https://github.com/user-attachments/assets/93afee48-93d4-42c7-a5e0-b7f5c93bdee9)

- Selbst wenn Sie nur ein wenig Programmierkenntnisse und ein Entdeckerherz haben, können Sie Ihre eigene fount Shell erstellen und die Charaktere in eine weitere Welt schicken, wohin auch immer Sie sich vorstellen können!

### Schöpfung: Mehr als nur Prompt

Wenn Sie ein Charakterersteller sind, öffnet Ihnen fount eine Tür zu unendlichen Möglichkeiten.

- Sie können die Magie von JavaScript- oder TypeScript-Code frei nutzen, um Ihre Kreativität zu entfesseln und den Prompt-Generierungsprozess und den Dialogablauf des Charakters anzupassen, sich von den Einschränkungen der Frontend-Syntax zu befreien, wie ein Dichter, der seine Feder schwingt und innere Emotionen frei ausdrückt.
- Charakterkarten können nicht nur Code ohne Filterung ausführen, sondern auch beliebige npm-Pakete laden und benutzerdefinierte HTML-Seiten erstellen. Das Erschaffen war noch nie so frei, wie ein Maler, der frei auf der Leinwand schmiert und die Welt in seinem Herzen umreißt.
- Wenn Sie möchten, können Sie auch verschiedene Ressourcen in den Charakter einbauen, sich von den Problemen des Bildhostings verabschieden und alles in Reichweite bringen, als ob Sie die ganze Welt in Ihre Tasche stecken würden.

![Bild](https://github.com/user-attachments/assets/9740cd43-06fd-46c0-a114-e4bd99f13045)

### Erweiterung: Mehr als nur die Gegenwart

In der Welt von fount ist alles hochgradig modularisiert.

- Solange Sie über einige Programmiergrundlagen verfügen, können Sie die benötigten Module einfach erstellen und verteilen, wie ein Gärtner, der neue Blumen züchtet und diesem Garten mehr Farbe verleiht.
- fount ermutigt Sie, Ihre Kraft in die Community und die Zukunft einzubringen und diese Welt wohlhabender und lebendiger zu machen.

![Bild](https://github.com/user-attachments/assets/8487a04a-7040-4844-81a6-705687856757)

### Zusammenfassung

Zusammenfassend lässt sich sagen, dass fount es Ihnen ermöglicht, Charaktere im fount-Format auszuführen, die über verschiedene Fähigkeiten verfügen oder in verschiedenen Szenarien eingesetzt werden können. Sie können tiefgründig, lebhaft, sanft oder stark sein, alles hängt von Ihnen ab, mein Freund! :)

## Architektur

- Das Backend basiert auf Deno, ergänzt durch das Express-Framework, und bildet ein solides Gerüst.
- Das Frontend ist mit HTML, CSS und JavaScript verwoben, um eine wunderschöne Oberfläche zu schaffen.
