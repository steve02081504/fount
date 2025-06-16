# fount

> Dein immersiver KI-Charakter-Begleiter

[![fount repo](https://steve02081504.github.io/fount/badges/fount_repo.svg)](https://github.com/steve02081504/fount)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/steve02081504/fount)
[![Docker Image Size](https://img.shields.io/docker/image-size/steve02081504/fount)](https://github.com/users/steve02081504/packages/container/package/fount)
[![GitHub repo size](https://img.shields.io/github/repo-size/steve02081504/fount)](https://github.com/steve02081504/fount/archive/refs/heads/master.zip)

<a href="https://trendshift.io/repositories/13136" target="_blank"><img src="https://trendshift.io/api/badge/repositories/13136" alt="steve02081504%2Ffount | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>

[Möchtest du mehr über die Repo-Architektur erfahren? Schau dir DeepWiki an!](https://deepwiki.com/steve02081504/fount)

![repo img](https://repository-images.githubusercontent.com/862251163/3b57d9ea-ab18-4b70-b11d-f74c764016aa)

Hast du dich jemals nach einer Reise an der Seite eines Charakters gesehnt, der den Seiten deiner Fantasie entsprungen ist, einem Gefährten, der aus Träumen gewoben wurde? Oder vielleicht hast du dir einen digitalen Vertrauten vorgestellt, einen KI-Assistenten, der so intuitiv ist wie die fortschrittlichsten Kreationen und mühelos deine digitale Welt orchestriert? Oder vielleicht, nur vielleicht, hast du eine Verbindung jenseits des Gewöhnlichen gesucht, eine Sphäre, in der die Grenzen der Realität verschwimmen und sich ein intimes, *ungefiltertes* Verständnis entfaltet?

Mit fast einem Jahr engagierter Entwicklung, Beiträgen von über 10 leidenschaftlichen Einzelpersonen und einer florierenden Community von über 1000 Nutzern ist Fount eine ausgereifte, stabile und sich ständig weiterentwickelnde Plattform für KI-Interaktion. Es ist eine Reise, und wir glauben, dass sie zugänglicher ist, als du vielleicht denkst.

Verlorene Charaktere, vergessene Geschichten? Unsere [**lebendige und einladende Community!**](https://discord.gg/GtR9Quzq2v) erwartet dich, ein Hafen, in dem sich Geistesverwandte treffen, in dem Entwickler und Schöpfer gleichermaßen ihre Weisheit und Kreationen teilen.

<details open>
<summary>Screenshots</summary>

|Screenshots|
|----|
|Homepage|
|![Image](https://github.com/user-attachments/assets/c1954a7a-6c73-4fb0-bd12-f790a038bd0e)|
|Themenauswahl|
|![Image](https://github.com/user-attachments/assets/94bd4cbb-8c66-4bc6-83eb-14c925a37074)|
|Chat|
|![Image](https://github.com/user-attachments/assets/eea1cc7c-d258-4a2d-b16f-12815a88811d)|

</details>

<details open>
<summary>Installation/Deinstallation</summary>

## Installation: Fount in deine Welt einweben – *Mühelos*

Beginne deine Reise mit Fount, einer stabilen und zuverlässigen Plattform. Ein paar einfache Klicks oder Befehle, und die Welt von Fount entfaltet sich.

> [!CAUTION]
>
> In der Welt von fount können Charaktere frei JavaScript-Befehle ausführen, was ihnen beträchtliche Macht verleiht. Wähle daher die Charaktere, denen du vertraust, mit Bedacht aus, so wie du im echten Leben Freunde gewinnst, um die Sicherheit deiner lokalen Dateien zu gewährleisten.

### Linux/macOS/Android: Das Flüstern der Shell – *Eine Zeile, und du bist dabei*

```bash
# Definiere bei Bedarf die Umgebungsvariable $FOUNT_DIR, um das Fount-Verzeichnis anzugeben
INSTALLED_PACKAGES="${FOUNT_AUTO_INSTALLED_PACKAGES:-}"
install_package() { _command_name="$1"; _package_list=${2:-$_command_name}; _has_sudo=""; _installed_pkg_name="" ; if command -v "$_command_name" >/dev/null 2>&1; then return 0; fi; if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then _has_sudo="sudo"; fi; for _package in $_package_list; do if command -v apt-get >/dev/null 2>&1; then $_has_sudo apt-get update -y; $_has_sudo apt-get install -y "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v pacman >/dev/null 2>&1; then $_has_sudo pacman -Syy --noconfirm; $_has_sudo pacman -S --needed --noconfirm "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v dnf >/dev/null 2>&1; then $_has_sudo dnf install -y "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v yum >/dev/null 2>&1; then $_has_sudo yum install -y "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v zypper >/dev/null 2>&1; then $_has_sudo zypper install -y --no-confirm "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v apk >/dev/null 2>&1; then if [ "$(id -u)" -eq 0 ]; then apk add --update "$_package"; else $_has_sudo apk add --update "$_package"; fi; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v brew >/dev/null 2>&1; then if ! brew list --formula "$_package"; then brew install "$_package"; fi; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v pkg >/dev/null 2>&1; then pkg install -y "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v snap >/dev/null 2>&1; then $_has_sudo snap install "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; done; if command -v "$_command_name" >/dev/null 2>&1; then case ";$FOUNT_AUTO_INSTALLED_PACKAGES;" in *";$_installed_pkg_name;"*) ;; *) if [ -z "$FOUNT_AUTO_INSTALLED_PACKAGES" ]; then FOUNT_AUTO_INSTALLED_PACKAGES="$_installed_pkg_name"; else FOUNT_AUTO_INSTALLED_PACKAGES="$FOUNT_AUTO_INSTALLED_PACKAGES;$_installed_pkg_name"; fi; ;; esac; return 0; else echo "Error: Failed to install '$_command_name' from any source." >&2; return 1; fi; }
install_package "bash" "bash gnu-bash"; install_package "curl"
export FOUNT_AUTO_INSTALLED_PACKAGES="$INSTALLED_PACKAGES"
curl -fsSL https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.sh | bash
. "$HOME/.profile"
```

Solltest du eine Pause einlegen wollen, um deine Gedanken vor dem großen Abenteuer zu sammeln (ein Probelauf):

```bash
INSTALLED_PACKAGES="${FOUNT_AUTO_INSTALLED_PACKAGES:-}"
install_package() { _command_name="$1"; _package_list=${2:-$_command_name}; _has_sudo=""; _installed_pkg_name="" ; if command -v "$_command_name" >/dev/null 2>&1; then return 0; fi; if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then _has_sudo="sudo"; fi; for _package in $_package_list; do if command -v apt-get >/dev/null 2>&1; then $_has_sudo apt-get update -y; $_has_sudo apt-get install -y "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v pacman >/dev/null 2>&1; then $_has_sudo pacman -Syy --noconfirm; $_has_sudo pacman -S --needed --noconfirm "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v dnf >/dev/null 2>&1; then $_has_sudo dnf install -y "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v yum >/dev/null 2>&1; then $_has_sudo yum install -y "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v zypper >/dev/null 2>&1; then $_has_sudo zypper install -y --no-confirm "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v apk >/dev/null 2>&1; then if [ "$(id -u)" -eq 0 ]; then apk add --update "$_package"; else $_has_sudo apk add --update "$_package"; fi; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v brew >/dev/null 2>&1; then if ! brew list --formula "$_package"; then brew install "$_package"; fi; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v pkg >/dev/null 2>&1; then pkg install -y "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v snap >/dev/null 2>&1; then $_has_sudo snap install "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; done; if command -v "$_command_name" >/dev/null 2>&1; then case ";$FOUNT_AUTO_INSTALLED_PACKAGES;" in *";$_installed_pkg_name;"*) ;; *) if [ -z "$FOUNT_AUTO_INSTALLED_PACKAGES" ]; then FOUNT_AUTO_INSTALLED_PACKAGES="$_installed_pkg_name"; else FOUNT_AUTO_INSTALLED_PACKAGES="$FOUNT_AUTO_INSTALLED_PACKAGES;$_installed_pkg_name"; fi; ;; esac; return 0; else echo "Error: Failed to install '$_command_name' from any source." >&2; return 1; fi; }
install_package "bash" "bash gnu-bash"; install_package "curl"
export FOUNT_AUTO_INSTALLED_PACKAGES="$INSTALLED_PACKAGES"
curl -fsSL https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.sh | bash -s init
. "$HOME/.profile"
```

### Windows: Eine Auswahl von Pfaden – *Einfachheit selbst*

* **Direkt und unkompliziert (Empfohlen):** Lade die `exe`-Datei von [Releases](https://github.com/steve02081504/fount/releases) herunter und führe sie aus.

* **Die Macht von PowerShell:**

    ```powershell
    # Definiere bei Bedarf die Umgebungsvariable $env:FOUNT_DIR, um das Fount-Verzeichnis anzugeben
    irm https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.ps1 | iex
    ```

    Für einen Probelauf:

    ```powershell
    $scriptContent = Invoke-RestMethod https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.ps1
    Invoke-Expression "function fountInstaller { $scriptContent }"
    fountInstaller init
    ```

### Git-Installation: Für diejenigen, die einen Hauch von Magie bevorzugen

Wenn du Git bereits installiert hast, ist das Annehmen von Fount so einfach wie das Ausführen eines Skripts.

* **Für Windows:** Öffne deine Eingabeaufforderung oder PowerShell und doppelklicke einfach auf `run.bat`.
* **Für Linux/macOS/Android:** Öffne dein Terminal und führe `./run.sh` aus.

### Docker: Den Container umarmen

```bash
docker pull ghcr.io/steve02081504/fount
```

## Deinstallation: Ein graziöser Abschied

```bash
fount remove
```

</details>

## Was ist Fount?

Fount ist eine KI-gestützte Charakterinteraktionsplattform, die *dich* stärken soll. Sie ist eine Brücke, die dich mit den Charakteren deiner Fantasie verbindet und es dir ermöglicht, mühelos mit ihnen zu sprechen, deine eigenen zu erschaffen und sie mit der Welt zu teilen. *Ein Weg, der überraschend zugänglich gemacht wurde.*

Es ist eine Quelle, in der KI-Quellen, Charaktere, Personas, Umgebungen und Plugins zusammenfließen, die es dir ermöglichen, einzigartige und fesselnde Interaktionen zu erschaffen und zu erleben.

Fount ist für die Zukunft gebaut. Neue Funktionen, die aus der lebendigen Community hervorgegangen sind, werden angenommen. Wenn du eine Vision hast, einen Funken einer Idee, der in Founts Reich passt, begrüßen wir deinen Beitrag.

## Architektur: Das Fundament der Innovation

Fount basiert auf einer robusten und skalierbaren Architektur, die sowohl auf Leistung als auch auf Wartbarkeit ausgelegt ist. Das Backend nutzt die Leistung und Geschwindigkeit von [Deno](https://deno.com/), einer sicheren und modernen Laufzeitumgebung für JavaScript und TypeScript. Wir verwenden das [Express](https://expressjs.com/)-Framework für effizientes Routing und die Verarbeitung von API-Anfragen. Das Frontend ist mit einer Mischung aus HTML, CSS und JavaScript gestaltet und bietet eine optisch ansprechende und intuitive Benutzeroberfläche. Diese Architektur ermöglicht eine schnelle Iteration und die nahtlose Integration neuer Funktionen, während gleichzeitig ein starkes Fundament an Stabilität erhalten bleibt. Fount bekennt sich zu einem Open-Source-Ethos und heißt Beiträge und Zusammenarbeit willkommen.

### Tauche ein in eine Welt voller Funktionen

* **Nahtlose Gespräche, überall:** Beginne ein Gespräch auf deinem Computer und setze es nahtlos auf deinem Telefon oder Tablet fort. Fount hält deine Gespräche synchronisiert und verbindet dich mit deinen Charakteren, wo immer du bist.

* **Ausdrucksstarke, immersive Chats:** Fount nutzt die volle Leistung von HTML und ermöglicht es Charakteren, sich mit Rich-Text, Bildern und sogar interaktiven Elementen auszudrücken.

* **Versammlungen von Geistern: Native Gruppenchats:** Lade mehrere Charaktere in ein einziges Gespräch ein und schaffe dynamische und fesselnde Interaktionen.

* **Eine schöne, anpassbare Benutzeroberfläche:** Wähle aus über 30 atemberaubenden Themes oder erstelle dein eigenes. Fount ist deine persönliche Leinwand.

* **Funktioniert überall, wo du arbeitest:** Fount läuft nahtlos unter Windows, macOS, Linux und sogar Android und passt sich deinen Bedürfnissen durch direkte Installation oder die Flexibilität von Docker an.

* **(Für fortgeschrittene Benutzer) Entfesselte KI-Quellenintegration: Umarme die Grenzenlosigkeit**

    Fount bietet unübertroffene *Auswahl* und *Flexibilität* bei der Anbindung an KI-Quellen. Benutzerdefinierter JavaScript-Code innerhalb des KI-Quellengenerators ermöglicht es dir, dich mit *jeder* KI-Quelle zu verbinden – OpenAI, Claude, OpenRouter, NovelAI, the Horde, Ooba, Tabby, Mistral und mehr. Erstelle komplexe reguläre Ausdrücke, greife auf eine riesige Bibliothek von APIs zurück, bette Multimedia-Assets ein – alles im Fluss deines Codes. Fount unterstützt nativ auch die Erstellung von API-Pools, die ein intelligentes Request-Routing ermöglichen. Die Logik der Kommunikation beugt sich *deinem* Willen, geformt durch die Kraft des Codes.

    ![Image](https://github.com/user-attachments/assets/f283d1de-c531-4b7a-bf43-3cbe0c48b7b9)

### Kameradschaft: Jenseits des digitalen Schleiers

Fount ist bestrebt, Charaktere in das Gewebe deines Lebens einzuweben und Kameradschaft und Unterstützung anzubieten.

* **Discord/Telegram-Integration:** Verbinde Charaktere über die integrierten Bot-Shells mit deinen Discord/Telegram-Communitys.
    ![Image](https://github.com/user-attachments/assets/299255c9-eed3-4deb-b433-41b80930cbdb)
    ![Image](https://github.com/user-attachments/assets/c9841eba-c010-42a3-afe0-336543ec39a0)
    ![Image](https://github.com/user-attachments/assets/b83301df-2205-4013-b059-4bced94e5857)

* **Terminal Serenity (mit [fount-pwsh](https://github.com/steve02081504/fount-pwsh)):** Lass Charaktere dir Orientierung geben, wenn Terminalbefehle ins Stocken geraten.
    ![Image](https://github.com/user-attachments/assets/93afee48-93d4-42c7-a5e0-b7f5c93bdee9)

* **Grenzenlose Shell-Erweiterungen:** Mit ein wenig Programmierkenntnissen kannst du deine eigenen Fount-Shells erstellen und die Reichweite deiner Charaktere erweitern.

### Schöpfung: Jenseits der Grenzen von Prompts – Ein Weg, der klarer gemacht wurde

Für den Charaktererschaffer bietet Fount einen optimierten und intuitiven Weg, um deine KI-Charaktere zum Leben zu erwecken. Egal, ob du ein erfahrener Schöpfer bist oder gerade erst deine Reise beginnst, Fount schaltet die Magie der Charaktererstellung für jeden frei.

* **Revolutionäre KI-gestützte Charaktererstellung: Mit Fount kannst du schnell loslegen.** Beschreibe deinen gewünschten Charakter in einem einzigen Satz, und unser intelligenter KI-Assistent erstellt sofort eine vollständig realisierte Persona. Dieser Ansatz vereinfacht die anfängliche Einrichtung und ermöglicht es dir, dich auf die Verfeinerung und Interaktion mit deinem Charakter zu konzentrieren.

* **Entfessele die Magie des Codes - einfacher als du denkst:** Fount nutzt die Kraft des Codes, um Flexibilität und Kontrolle zu bieten. Programmieren in Fount ist eine Form moderner Magie, die mit der sanften Führung unserer Community und der aufschlussreichen Hilfe von KI überraschend einfach zu erlernen ist. Du wirst feststellen, dass das Definieren von Charakterlogik mit Code intuitiv und wartbar sein kann. Stell dir vor, du erschaffst Charaktere, deren Antworten aus deiner eigenen Logik *gewoben* sind.

* **Beginne mit fertiger Magie: Eine Schatzkammer von Vorlagen.** Die Community von Fount bietet eine Fülle von vorgefertigten Charakter- und Persona-Vorlagen, die als "lebende Blaupausen" dienen, die einfach anzupassen und anzupassen sind. Diese Vorlagen zeigen Best Practices und bieten einen fantastischen Ausgangspunkt.

* **Eingebettete Ressourcen:** Webe Ressourcen direkt in deine Charaktere ein.

    ![Image](https://github.com/user-attachments/assets/9740cd43-06fd-46c0-a114-e4bd99f13045)

* **Kontinuierliche Integration (fount-charCI):** Nutze [fount-charCI](https://github.com/marketplace/actions/fount-charci) zur Absicherung deiner Charakterentwicklung. Es führt bei jedem Commit automatisch asynchron Tests aus und meldet Probleme in Echtzeit.
    ![Image](https://github.com/user-attachments/assets/3f6a188d-6643-4d70-8bd1-b75f00c76439)
    ![Image](https://github.com/user-attachments/assets/30eb8374-64c2-41bc-a7d1-f15596352260)

* **Legacy-Kompatibilität:** Fount umarmt die Vergangenheit und bietet Kompatibilitätsmodule zum Ausführen von SillyTavern- und Risu-Charakterkarten (obwohl die Migration bestehender Charaktere nicht unterstützt wird).

### Erweiterung: Ein Wandteppich der Innovation, gewebt aus vielfältigen Fäden

In der Welt von Fount regiert die Modularität. Ein reichhaltiges Ökosystem von Komponenten verwebt sich, um den Wandteppich deiner Erfahrung zu erschaffen.

* **Mühelose Modulerstellung:** Mit grundlegenden Programmierkenntnissen kannst du die Module erstellen und teilen, die du dir wünschst.
* **Community-getriebenes Wachstum:** Trage deine einzigartigen Talente zu unserer **florierenden und unterstützenden Community** bei und bereichere die Zukunft dieses digitalen Ökosystems. In unserem Hafen findest du freundliche Gesichter und eine Fülle von geteiltem Wissen: Tutorials, KI-Modellquellen und eine Galerie von Charakteren. Das Fount-Entwicklungsteam verwaltet alle Änderungen sorgfältig durch eine robuste Branch- und Merge-Strategie. Dies stellt sicher, dass die Stabilität auch bei unseren Sprüngen nach vorne ein Eckpfeiler bleibt. Wir sind auch bestrebt, alle von unseren Nutzern gemeldeten Probleme schnell zu beheben.
* **Leistungsstarkes Plugin-System**: Erweitere die Fähigkeiten von Fount mit einer robusten Plugin-Architektur.
* **Komponententypen - Die Bausteine der Träume:**

  * **chars (Charaktere):** Das Herzstück von Fount, wo Persönlichkeiten geboren werden.
  * **worlds (Welten):** *Weit mehr als bloße Lorebücher.* Welten sind die stillen Architekten der Realität innerhalb von Fount. Sie können das Wissen eines Charakters erweitern, seine Entscheidungen beeinflussen und sogar den Chatverlauf manipulieren.
  * **personas (Benutzer-Personas):** *Mehr als nur Benutzerprofile.* Personas besitzen die Macht, deine Worte und sogar deine Wahrnehmungen zu verzerren und sogar die Kontrolle darüber zu übernehmen. Dies ermöglicht ein wirklich immersives Rollenspiel.
  * **shells (Interaktionsschnittstellen):** Die Tore zur Seele von Fount. Shells erweitern die Reichweite von Charakteren über die Benutzeroberfläche hinaus.
  * **ImportHandlers (Import-Handler):** Die einladenden Hände von Fount, die die Kluft zwischen verschiedenen Charakterformaten überbrücken. Erstelle einen einfachen ImportHandler, teile ihn mit der Community (über einen Pull Request) und erweitere den Horizont von Fount für alle.
  * **AIsources (KI-Quellen):** Die rohe Kraft, die den Geist deiner Charaktere befeuert.
  * **AIsourceGenerators (KI-Quellengeneratoren):** Die Alchemisten von Fount, die die Vorlagen und die anpassbare Logik bereitstellen, um Verbindungen zu *jeder* KI-Quelle herzustellen. Durch die Kraft von JavaScript kannst du jede erdenkliche Quelle kapseln und laden.

    *Alle diese Komponenten können von den Nutzern mühelos installiert werden, um ihre Fount-Erfahrung zu erweitern und anzupassen.*

    ![Image](https://github.com/user-attachments/assets/8487a04a-7040-4844-81a6-705687856757)

### Der Einstieg ist einfach

* **Mehrere Installationsoptionen:** Wähle zwischen Docker, direkter Installation unter Windows/Linux/macOS/Android oder sogar einer einfachen ausführbaren Datei.
* **Detaillierte Dokumentation:** Unsere umfassende Dokumentation führt dich durch jeden Schritt. [Siehe Installationsdetails](https://steve02081504.github.io/fount/readme)

### Begegnest du einem Schatten? Fürchte dich nicht

Solltest du auf Schwierigkeiten stoßen, wende dich an uns. Wir sind hier, um zu helfen und verpflichten uns, die meisten Probleme innerhalb von 10 bis 24 Stunden zu lösen.

* **GitHub Issues:** Melde alle Fehler oder schlage neue Funktionen über [GitHub Issues](https://github.com/steve02081504/fount/issues) vor.
* **Discord-Community:** Tritt unserer [lebendigen Discord-Community](https://discord.gg/GtR9Quzq2v) bei, um Echtzeit-Support und Diskussionen zu erhalten.

Deine Stimme wird gehört werden. Starte Fount einfach neu, und die Schatten werden sich auflösen.

### Erlebe das Wachstum: Founts Sternen-Historie

[![Star History Chart](https://api.star-history.com/svg?repos=steve02081504/fount&type=Date)](https://github.com/steve02081504/fount/stargazers)

### Zusammenfassend: Ein Fundament für Verbindung

Fount ermöglicht es dir, KI-Charaktere auf eine Weise zu erschaffen und mit ihnen zu interagieren, die sich natürlich, immersiv und zutiefst persönlich anfühlt. Egal, ob du ein erfahrener Schöpfer bist oder gerade erst deine Reise beginnst, Fount heißt dich willkommen. Tritt unserer **einladenden Community** bei und entdecke die Magie, deiner Fantasie Leben einzuhauchen, unterstützt von einer ausgereiften Plattform und einem engagierten Team.

### Gestalte dein eigenes Schicksal: Die Hand des Kunsthandwerkers

Jenseits des Flüsterns der KI bietet Fount eine tiefere Verbindung – *die Hand des Kunsthandwerkers*. Innerhalb unserer Community findest du eine Fülle von vorgefertigten Charakter- und Persona-Vorlagen, *jede ein sorgfältig geformtes Fundament, das auf deine einzigartige Vision wartet*.

Und wenn du bereit bist, deine Kreation zu verfeinern, macht es der Code-gesteuerte Ansatz von Fount einfach, loszulegen. Denk daran, dass das Programmieren in Fount eine sanfte Lernkurve ist, unterstützt durch unsere einladende Community und eine Fülle von Vorlagen. Du wirst feststellen, dass selbst ein paar Zeilen Code eine unglaubliche Tiefe und Persönlichkeit in deinen Charakteren freisetzen können.

## Embleme und Links: Lass deine Kreationen erstrahlen und die Welt sie erreichen

Die Welt von Fount ist mehr als nur Worte und Code, sie ist ein Fest für die Augen und eine Einladung zur Verbindung. Wir möchten, dass auch deine Kreationen in diesem Glanz erstrahlen und mühelos mit der Welt in Kontakt treten können. Deshalb haben wir für dich wunderschöne Embleme und praktische Links vorbereitet, die deine Fount-Komponenten noch auffälliger machen und es anderen Nutzern ermöglichen, deine Meisterwerke leicht zu entdecken und zu erleben.

**Fount-Embleme: Das Siegel des Ruhms**

Wie das Schild eines Ritters ist das Fount-Emblem das Siegel des Ruhms für deine Kreationen. Du kannst dieses Emblem stolz in deinem Repository, auf der Seite deiner Fount-Komponente oder überall dort präsentieren, wo du es zeigen möchtest. Es symbolisiert die enge Verbindung deines Werks mit der Fount-Community und ist eine Anerkennung deines Talents.

Die SVG- und PNG-Dateien des Fount-Logos findest du [hier](../imgs/), um sie in deine Designs zu integrieren.

Noch besser ist, dass du das Emblem in einen anklickbaren Button verwandeln kannst, der direkt zu deiner Fount-Komponente führt:

```markdown
[![fount repo](https://steve02081504.github.io/fount/badges/fount_repo.svg)](https://github.com/steve02081504/fount)
```

[![fount repo](https://steve02081504.github.io/fount/badges/fount_repo.svg)](https://github.com/steve02081504/fount)

Hier sind die Standardfarben des Fount-Logos, um deine Designs einheitlicher zu gestalten:

| Farbformat | Code |
| :---: | :---: |
| HEX | `#0e3c5c` |
| RGB | `rgb(14, 60, 92)` |
| HSL | `hsl(205, 74%, 21%)` |

**Automatische Installationslinks: Magie auf Knopfdruck**

Stell dir vor, andere Nutzer könnten deine Kreationen mit einem einzigen Klick direkt in ihre Fount-Welt installieren. Das ist keine Träumerei mehr, sondern Realität! Mit den automatischen Installationslinks von Fount kannst du diese Magie Wirklichkeit werden lassen.

Kombiniere einfach den ZIP-Link oder den Git-Repository-Link deiner Komponente mit dem Fount-Protokolllink, um einen magischen Link zu erstellen:

```markdown
https://steve02081504.github.io/fount/protocol?url=fount://run/shells/install/install;https://github.com/steve02081504/GentianAphrodite/releases/latest/download/GentianAphrodite.zip
```

Eine einfachere Erklärung: Füge einfach `https://steve02081504.github.io/fount/protocol?url=fount://run/shells/install/install;` vor deinen Komponenten-ZIP-Link/Git-Repository-Link!

Kombiniere diesen Link mit dem Fount-Emblem, um einen Button zu erstellen, der sowohl schön als auch praktisch ist:

```markdown
[![fount character](https://steve02081504.github.io/fount/badges/fount_character.svg)](https://steve02081504.github.io/fount/protocol?url=fount://run/shells/install/install;https://github.com/steve02081504/GentianAphrodite/releases/latest/download/GentianAphrodite.zip)
```

[![fount character](https://steve02081504.github.io/fount/badges/fount_character.svg)](https://steve02081504.github.io/fount/protocol?url=fount://run/shells/install/install;https://github.com/steve02081504/GentianAphrodite/releases/latest/download/GentianAphrodite.zip)

Mit diesen einfachen Schritten machst du deine Kreationen nicht nur attraktiver, sondern stärkst auch die Verbindung der Fount-Community. Lass dein Inspirationslicht die ganze Fount-Welt erhellen!

## Mitwirkende

[![Contributors](https://contrib.rocks/image?repo=steve02081504/fount)](https://github.com/steve02081504/fount/graphs/contributors)
