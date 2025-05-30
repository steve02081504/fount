# fount

> Tu Compañero Inmersivo de Personajes IA

[![fount repo](https://steve02081504.github.io/fount/badges/fount_repo.svg)](https://github.com/steve02081504/fount)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/steve02081504/fount)

<a href="https://trendshift.io/repositories/13136" target="_blank"><img src="https://trendshift.io/api/badge/repositories/13136" alt="steve02081504%2Ffount | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>

[¿Quieres saber sobre la arquitectura del repositorio? ¡Echa un vistazo a DeepWiki!](https://deepwiki.com/steve02081504/fount)

![repo img](https://repository-images.githubusercontent.com/862251163/3b57d9ea-ab18-4b70-b11d-f74c764016aa)

¿Alguna vez has anhelado un viaje junto a un personaje surgido de las páginas de tu imaginación, un compañero tejido de sueños? ¿O tal vez has imaginado un confidente digital, un asistente de IA tan intuitivo como las creaciones más avanzadas, orquestando sin esfuerzo tu mundo digital? O tal vez, solo tal vez, has buscado una conexión más allá de lo ordinario, un reino donde los bordes de la realidad se difuminan y se desarrolla una comprensión íntima y *sin filtros*?

Con casi un año de desarrollo dedicado, contribuciones de más de 10 personas apasionadas y una comunidad próspera de más de 1000 usuarios, Fount se erige como una plataforma madura, estable y en constante evolución para la interacción con IA. Es un viaje, y uno que creemos que es más accesible de lo que podrías imaginar.

¿Personajes perdidos, historias olvidadas? ¡Nuestra [**comunidad vibrante y acogedora**!](https://discord.gg/GtR9Quzq2v) te espera, un refugio donde se reúnen espíritus afines, donde desarrolladores y creadores por igual comparten su sabiduría y creaciones.

<details open>
<summary>Capturas de pantalla</summary>

|Capturas de pantalla|
|----|
|Página de inicio|
|![Imagen](https://github.com/user-attachments/assets/c1954a7a-6c73-4fb0-bd12-f790a038bd0e)|
|Selección de tema|
|![Imagen](https://github.com/user-attachments/assets/94bd4cbb-8c66-4bc6-83eb-14c925a37074)|
|Chat|
|![Imagen](https://github.com/user-attachments/assets/eea1cc7c-d258-4a2d-b16f-12815a88811d)|

</details>

<details open>
<summary>Instalación/Eliminación</summary>

## Instalación: Tejiendo fount en tu mundo – *Sin esfuerzo*

Embárcate en tu viaje con fount, una plataforma estable y confiable. Unos pocos clics o comandos simples, y el mundo de fount se despliega.

> [!CAUTION]
>
> En el mundo de fount, los personajes pueden ejecutar comandos de JavaScript libremente, lo que les otorga un poder significativo. Por lo tanto, por favor, elige con precaución los personajes en los que confías, al igual que haces amigos en la vida real, para garantizar la seguridad de tus archivos locales.

### Linux/macOS/Android: Los susurros del shell – *Una línea, y estás dentro*

```bash
# Si es necesario, define la variable de entorno $FOUNT_DIR para especificar el directorio de fount
INSTALLED_PACKAGES="${FOUNT_AUTO_INSTALLED_PACKAGES:-}"
install_package() { package_name="$1"; install_successful=0; if command -v "$package_name" >/dev/null 2>&1; then return 0; fi; if command -v pkg >/dev/null 2>&1; then pkg install -y "$package_name" && install_successful=1; fi; if [ "$install_successful" -eq 0 ] && command -v snap >/dev/null 2>&1; then snap install "$package_name" && install_successful=1; fi; if [ "$install_successful" -eq 0 ] && command -v apt-get >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo apt-get update; sudo apt-get install -y "$package_name" && install_successful=1; else apt-get update; apt-get install -y "$package_name" && install_successful=1; fi; fi; if [ "$install_successful" -eq 0 ] && command -v brew >/dev/null 2>&1; then if ! brew list --formula "$package_name" >/dev/null 2>&1; then brew install "$package_name" && install_successful=1; else install_successful=1; fi; fi; if [ "$install_successful" -eq 0 ] && command -v pacman >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo pacman -Syy; sudo pacman -S --needed --noconfirm "$package_name" && install_successful=1; else pacman -Syy; pacman -S --needed --noconfirm "$package_name" && install_successful=1; fi; fi; if [ "$install_successful" -eq 0 ] && command -v dnf >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo dnf install -y "$package_name" && install_successful=1; else dnf install -y "$package_name" && install_successful=1; fi; fi; if [ "$install_successful" -eq 0 ] && command -v yum >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo yum install -y "$package_name" && install_successful=1; else yum install -y "$package_name" && install_successful=1; fi; fi; if [ "$install_successful" -eq 0 ] && command -v zypper >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo zypper install -y --no-confirm "$package_name" && install_successful=1; else zypper install -y --no-confirm "$package_name" && install_successful=1; fi; fi; if [ "$install_successful" -eq 0 ] && command -v apk >/dev/null 2>&1; then apk add --update "$package_name" && install_successful=1; fi; if [ "$install_successful" -eq 1 ]; then if [ -z "$INSTALLED_PACKAGES" ]; then INSTALLED_PACKAGES="$package_name"; else INSTALLED_PACKAGES="$INSTALLED_PACKAGES;$package_name"; fi; return 0; else echo "Error: $package_name installation failed." >&2; return 1; fi; }
install_package curl; install_package bash
export FOUNT_AUTO_INSTALLED_PACKAGES="$INSTALLED_PACKAGES"
curl -fsSL https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.sh | bash
. "$HOME/.profile"
```

Si deseas hacer una pausa, para reunir tus pensamientos antes de la gran aventura (una prueba en seco):

```bash
INSTALLED_PACKAGES="${FOUNT_AUTO_INSTALLED_PACKAGES:-}"
install_package() { package_name="$1"; install_successful=0; if command -v "$package_name" >/dev/null 2>&1; then return 0; fi; if command -v pkg >/dev/null 2>&1; then pkg install -y "$package_name" && install_successful=1; fi; if [ "$install_successful" -eq 0 ] && command -v snap >/dev/null 2>&1; then snap install "$package_name" && install_successful=1; fi; if [ "$install_successful" -eq 0 ] && command -v apt-get >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo apt-get update; sudo apt-get install -y "$package_name" && install_successful=1; else apt-get update; apt-get install -y "$package_name" && install_successful=1; fi; fi; if [ "$install_successful" -eq 0 ] && command -v brew >/dev/null 2>&1; then if ! brew list --formula "$package_name" >/dev/null 2>&1; then brew install "$package_name" && install_successful=1; else install_successful=1; fi; fi; if [ "$install_successful" -eq 0 ] && command -v pacman >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo pacman -Syy; sudo pacman -S --needed --noconfirm "$package_name" && install_successful=1; else pacman -Syy; pacman -S --needed --noconfirm "$package_name" && install_successful=1; fi; fi; if [ "$install_successful" -eq 0 ] && command -v dnf >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo dnf install -y "$package_name" && install_successful=1; else dnf install -y "$package_name" && install_successful=1; fi; fi; if [ "$install_successful" -eq 0 ] && command -v yum >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo yum install -y "$package_name" && install_successful=1; else yum install -y "$package_name" && install_successful=1; fi; fi; if [ "$install_successful" -eq 0 ] && command -v zypper >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo zypper install -y --no-confirm "$package_name" && install_successful=1; else zypper install -y --no-confirm "$package_name" && install_successful=1; fi; fi; if [ "$install_successful" -eq 0 ] && command -v apk >/dev/null 2>&1; then apk add --update "$package_name" && install_successful=1; fi; if [ "$install_successful" -eq 1 ]; then if [ -z "$INSTALLED_PACKAGES" ]; then INSTALLED_PACKAGES="$package_name"; else INSTALLED_PACKAGES="$INSTALLED_PACKAGES;$package_name"; fi; return 0; else echo "Error: $package_name installation failed." >&2; return 1; fi; }
install_package curl; install_package bash
export FOUNT_AUTO_INSTALLED_PACKAGES="$INSTALLED_PACKAGES"
curl -fsSL https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.sh | bash -s init
. "$HOME/.profile"
```

### Windows: Una elección de caminos – *Simplicidad misma*

* **Directo y sin complicaciones (Recomendado):** Descarga el archivo `exe` de [Releases](https://github.com/steve02081504/fount/releases) y ejecútalo.

* **El poder de PowerShell:**

    ```powershell
    # Si es necesario, define la variable de entorno $env:FOUNT_DIR para especificar el directorio de fount
    irm https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.ps1 | iex
    ```

    Para una prueba en seco:

    ```powershell
    $scriptContent = Invoke-RestMethod https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.ps1
    Invoke-Expression "function fountInstaller { $scriptContent }"
    fountInstaller init
    ```

### Instalación de Git: Para aquellos que prefieren un toque de magia

Si ya tienes Git instalado, abrazar fount es tan simple como ejecutar un script.

* **Para Windows:** Abre tu símbolo del sistema o PowerShell y simplemente haz doble clic en `run.bat`.
* **Para Linux/macOS/Android:** Abre tu terminal y ejecuta `./run.sh`.

### Docker: Abrazando el contenedor

```bash
docker pull ghcr.io/steve02081504/fount
```

## Eliminación: Una despedida elegante

```bash
fount remove
```

</details>

## ¿Qué es fount?

fount es una plataforma de interacción de personajes impulsada por IA diseñada para empoderarte *a ti*. Es un puente, que te conecta con los personajes de tu imaginación, permitiéndote conversar sin esfuerzo con ellos, crear los tuyos propios y compartirlos con el mundo. *Un camino sorprendentemente accesible.*

Es una fuente, donde las fuentes de IA, los personajes, las personas, los entornos y los plugins fluyen juntos, permitiéndote crear y experimentar interacciones únicas y convincentes.

Fount está construido para el futuro. Se abrazan nuevas características, nacidas de la vibrante comunidad. Si tienes una visión, una chispa de una idea que pertenece al reino de fount, agradecemos tu contribución.

## Arquitectura: El fundamento de la innovación

Fount está construido sobre una arquitectura robusta y escalable, diseñada tanto para el rendimiento como para el mantenimiento. El backend aprovecha el poder y la velocidad de [Deno](https://deno.com/), un entorno de tiempo de ejecución seguro y moderno para JavaScript y TypeScript. Utilizamos el framework [Express](https://expressjs.com/) para un enrutamiento eficiente y el manejo de solicitudes API. El frontend está elaborado con una mezcla de HTML, CSS y JavaScript, proporcionando una interfaz de usuario visualmente atractiva e intuitiva. Esta arquitectura permite una iteración rápida y la integración perfecta de nuevas características, manteniendo una base sólida de estabilidad. Fount abraza un espíritu de código abierto, dando la bienvenida a contribuciones y colaboración.

### Sumérgete en un mundo de características

* **Conversaciones fluidas, en cualquier lugar:** Comienza una conversación en tu ordenador, continúa sin problemas en tu teléfono o tableta. fount mantiene tus conversaciones sincronizadas, conectándote con tus personajes dondequiera que vayas.

* **Chats expresivos e inmersivos:** fount abraza todo el poder de HTML, permitiendo a los personajes expresarse con texto enriquecido, imágenes e incluso elementos interactivos.

* **Reuniones de mentes: Chats grupales nativos:** Invita a varios personajes a una sola conversación, creando interacciones dinámicas y atractivas.

* **Una interfaz hermosa y personalizable:** Elige entre más de 30 temas impresionantes, o crea el tuyo propio. fount es tu lienzo personal.

* **Funciona en todas partes donde tú lo haces:** fount se ejecuta sin problemas en Windows, macOS, Linux e incluso Android, adaptándose a tus necesidades a través de la instalación directa o la flexibilidad de Docker.

* **(Para usuarios avanzados) Integración de fuentes de IA desencadenada: Abraza lo ilimitado**

    Fount ofrece *elección* y *flexibilidad* incomparables al conectarse a fuentes de IA. El código JavaScript personalizado dentro del generador de fuentes de IA te permite conectarte a *cualquier* fuente de IA: OpenAI, Claude, OpenRouter, NovelAI, Horde, Ooba, Tabby, Mistral y más. Crea expresiones regulares intrincadas, recurre a una vasta biblioteca de API, incrusta activos multimedia, todo dentro del flujo de tu código. Fount también admite de forma nativa la creación de grupos de API, lo que permite el enrutamiento inteligente de solicitudes. La lógica de la comunicación se doblega a *tu* voluntad, elaborada a través del poder del código.

    ![Image](https://github.com/user-attachments/assets/f283d1de-c531-4b7a-bf43-3cbe0c48b7b9)

### Compañerismo: Más allá del velo digital

Fount se esfuerza por tejer personajes en el tejido de tu vida, ofreciendo compañía y apoyo.

* **Integración de Discord:** Conecta personajes a tus comunidades de Discord a través del shell de bot de Discord integrado.
    ![Image](https://github.com/user-attachments/assets/299255c9-eed3-4deb-b433-41b80930cbdb)
    ![Image](https://github.com/user-attachments/assets/c9841eba-c010-42a3-afe0-336543ec39a0)

* **Serenidad del terminal (con [fount-pwsh](https://github.com/steve02081504/fount-pwsh)):** Deja que los personajes ofrezcan orientación cuando los comandos del terminal fallen.
    ![Image](https://github.com/user-attachments/assets/93afee48-93d4-42c7-a5e0-b7f5c93bdee9)

* **Extensiones de shell ilimitadas:** Con un toque de habilidad de programación, crea tus propios shells de fount, extendiendo el alcance de tus personajes.

### Creación: Más allá de los confines de los prompts – Un camino más claro

Para el creador de personajes, fount ofrece un camino optimizado e intuitivo para dar vida a tus personajes de IA. Ya seas un creador experimentado o estés comenzando tu viaje, fount desbloquea la magia de la creación de personajes para todos.

* **Creación revolucionaria de personajes asistida por IA: Fount te permite comenzar rápidamente.** Describe el personaje deseado en una sola frase, y nuestro asistente inteligente de IA crea instantáneamente una persona completamente realizada. Este enfoque simplifica la configuración inicial, lo que te permite concentrarte en refinar e interactuar con tu personaje.

* **Desbloquea la magia del código: más fácil de lo que imaginas:** Fount abraza el poder del código para proporcionar flexibilidad y control. Programar en Fount es una forma de magia moderna, sorprendentemente fácil de aprender con la guía amable de nuestra comunidad y la ayuda esclarecedora de la IA. Descubrirás que definir la lógica del personaje con código puede ser intuitivo y fácil de mantener. Imagina crear personajes cuyas respuestas estén *tejidas* a partir de tu propia lógica.

* **Comienza con magia ya hecha: Un tesoro de plantillas.** La comunidad de Fount proporciona una gran cantidad de plantillas de personajes y personas prefabricadas, que actúan como "planos vivos" que son fáciles de adaptar y personalizar. Estas plantillas muestran las mejores prácticas y proporcionan un fantástico punto de partida.

* **Recursos incrustados:** Teje recursos directamente en tus personajes.

    ![Image](https://github.com/user-attachments/assets/9740cd43-06fd-46c0-a114-e4bd99f13045)

* **Compatibilidad heredada:** fount abraza el pasado, ofreciendo módulos de compatibilidad para ejecutar tarjetas de personajes de SillyTavern y Risu (aunque no se admite la migración de personajes existentes).

### Expansión: Un tapiz de innovación, tejido con diversos hilos

En el mundo de fount, la modularidad reina suprema. Un rico ecosistema de componentes se entrelaza para crear el tapiz de tu experiencia.

* **Creación de módulos sin esfuerzo:** Con conocimientos básicos de programación, crea y comparte los módulos que desees.
* **Crecimiento impulsado por la comunidad:** Contribuye con tus talentos únicos a nuestra **comunidad próspera y de apoyo**, enriqueciendo el futuro de este ecosistema digital. Dentro de nuestro refugio, encontrarás caras amigables y una gran cantidad de conocimiento compartido: tutoriales, fuentes de modelos de IA y una galería de personajes. El equipo de desarrollo de fount gestiona meticulosamente todos los cambios a través de una estrategia robusta de ramificación y fusión. Esto asegura que incluso mientras avanzamos, la estabilidad siga siendo una piedra angular. También estamos comprometidos a abordar rápidamente cualquier problema informado por nuestros usuarios.
* **Potente sistema de plugins**: Amplía las capacidades de fount con una arquitectura de plugins robusta.
* **Tipos de componentes: Los bloques de construcción de los sueños:**

  * **chars (Personajes):** El corazón de fount, donde nacen las personalidades.
  * **worlds (Mundos):** *Mucho más que meros libros de historia.* Los mundos son los arquitectos silenciosos de la realidad dentro de fount. Pueden añadir conocimiento a la comprensión de un personaje, influir en sus decisiones e incluso manipular el historial del chat.
  * **personas (Personas de usuario):** *Más que solo perfiles de usuario.* Las personas poseen el poder de deformar e incluso tomar el control de tus palabras y percepciones. Esto permite un juego de roles verdaderamente inmersivo.
  * **shells (Interfaces de interacción):** Las puertas de entrada al alma de fount. Los shells extienden el alcance de los personajes más allá de la interfaz.
  * **ImportHandlers (Manejadores de importación):** Las manos acogedoras de fount, que cierran la brecha entre diversos formatos de personajes. Crea un ImportHandler simple, compártelo con la comunidad (a través de un Pull Request) y amplía los horizontes de fount para todos.
  * **AIsources (Fuentes de IA):** El poder bruto que alimenta las mentes de tus personajes.
  * **AIsourceGenerators (Generadores de fuentes de IA):** Los alquimistas de fount, que proporcionan las plantillas y la lógica personalizable para forjar conexiones con *cualquier* fuente de IA. A través del poder de JavaScript, puedes encapsular y cargar cualquier fuente imaginable.

    *Todos estos componentes pueden ser instalados sin esfuerzo por los usuarios, expandiendo y personalizando su experiencia fount.*

    ![Image](https://github.com/user-attachments/assets/8487a04a-7040-4844-81a6-705687856757)

### Empezar es fácil

* **Múltiples opciones de instalación:** Elige entre Docker, instalación directa en Windows/Linux/macOS/Android, o incluso un simple archivo ejecutable.
* **Documentación detallada:** Nuestra documentación completa te guía a través de cada paso. [Consulta los detalles de instalación](https://steve02081504.github.io/fount/readme)

### ¿Encuentras una sombra? No temas

Si encuentras alguna dificultad, comunícate con nosotros. Estamos aquí para ayudar y comprometidos a resolver la mayoría de los problemas en un plazo de 10 a 24 horas.

* **GitHub Issues:** Informa de cualquier error o sugiere nuevas características a través de [GitHub Issues](https://github.com/steve02081504/fount/issues).
* **Comunidad de Discord:** Únete a nuestra [vibrante comunidad de Discord](https://discord.gg/GtR9Quzq2v) para obtener soporte y debates en tiempo real.

Tu voz será escuchada. Simplemente reinicia fount, y las sombras se disiparán.

### Sé testigo del crecimiento: Historial de estrellas de fount

[![Star History Chart](https://api.star-history.com/svg?repos=steve02081504/fount&type=Date)](https://github.com/steve02081504/fount/stargazers)

### En conclusión: Una base para la conexión

fount te permite crear e interactuar con personajes de IA de una manera que se siente natural, inmersiva y profundamente personal. Ya seas un creador experimentado o estés comenzando tu viaje, fount te da la bienvenida. Únete a nuestra **acogedora comunidad** y descubre la magia de dar vida a tu imaginación, con el apoyo de una plataforma madura y un equipo dedicado.

### Creando tu propio destino: El toque artesanal

Más allá de los susurros de la IA, fount ofrece una conexión más profunda: *el toque artesanal*. Dentro de nuestra comunidad, encontrarás una gran cantidad de plantillas de personajes y personas prefabricadas, *cada una una base cuidadosamente esculpida esperando tu visión única*.

Y cuando estés listo para refinar tu creación, el enfoque basado en código de Fount hace que sea fácil comenzar. Recuerda, programar en Fount es una curva de aprendizaje suave, respaldada por nuestra acogedora comunidad y abundantes plantillas. Descubrirás que incluso unas pocas líneas de código pueden desbloquear una profundidad y personalidad increíbles en tus personajes.

## Insignias y Enlaces: Deja que tus Creaciones Brillen, Deja que el Mundo las Alcance

El mundo de Fount es más que palabras y código, es una fiesta para los ojos y una invitación a conectar. Queremos que tus creaciones brillen con este resplandor y se conecten sin esfuerzo con el mundo. Por lo tanto, hemos preparado insignias exquisitas y enlaces convenientes para que tus componentes de Fount sean aún más llamativos y permitan a otros usuarios descubrir y experimentar fácilmente tus obras maestras.

**Insignias de Fount: El Sello de la Gloria**

Como el escudo de un caballero, la insignia de Fount es el sello de la gloria para tus creaciones. Puedes mostrar con orgullo esta insignia en tu repositorio, en la página de tu componente de Fount o en cualquier lugar donde desees exhibirla. Simboliza la estrecha conexión de tu trabajo con la comunidad de Fount y es un reconocimiento de tu talento.

Puedes encontrar los archivos SVG y PNG del logotipo de Fount [aquí](../imgs/) para incorporarlos en tus diseños.

Aún mejor, puedes convertir la insignia en un botón ক্লিকable que enlace directamente a tu componente de Fount:

```markdown
[![fount repo](https://steve02081504.github.io/fount/badges/fount_repo.svg)](https://github.com/steve02081504/fount)
```

[![fount repo](https://steve02081504.github.io/fount/badges/fount_repo.svg)](https://github.com/steve02081504/fount)

Aquí están los colores estándar del logotipo de Fount para hacer tus diseños más consistentes:

| Formato de Color | Código |
| :---: | :---: |
| HEX | `#0e3c5c` |
| RGB | `rgb(14, 60, 92)` |
| HSL | `hsl(205, 74%, 21%)` |

**Enlaces de Instalación Automática: Magia al Alcance de tu Mano**

Imagina que otros usuarios puedan instalar tus creaciones directamente en su mundo de Fount con un solo clic. ¡Esto ya no es un sueño, sino una realidad! Con los enlaces de instalación automática de Fount, puedes convertir esta magia en realidad.

Simplemente combina el enlace ZIP o el enlace del repositorio Git de tu componente con el enlace de protocolo de Fount para crear un enlace mágico:

```markdown
https://steve02081504.github.io/fount/protocol?url=fount://runshell/install/install;https://github.com/steve02081504/GentianAphrodite/releases/latest/download/GentianAphrodite.zip
```

Explicación más sencilla: ¡Simplemente añade `https://steve02081504.github.io/fount/protocol?url=fount://runshell/install/install;` antes de tu enlace zip de componente/enlace de repositorio Git!

Combina este enlace con la insignia de Fount para crear un botón que sea tanto hermoso como práctico:

```markdown
[![fount character](https://steve02081504.github.io/fount/badges/fount_character.svg)](https://steve02081504.github.io/fount/protocol?url=fount://runshell/install/install;https://github.com/steve02081504/GentianAphrodite/releases/latest/download/GentianAphrodite.zip)
```

[![fount character](https://steve02081504.github.io/fount/badges/fount_character.svg)](https://steve02081504.github.io/fount/protocol?url=fount://runshell/install/install;https://github.com/steve02081504/GentianAphrodite/releases/latest/download/GentianAphrodite.zip)

Con estos sencillos pasos, no solo haces que tus creaciones sean más atractivas, sino que también fortaleces la conexión de la comunidad de Fount. ¡Deja que la luz de tu inspiración ilumine todo el mundo de Fount!

## Colaboradores

[![Contributors](https://contrib.rocks/image?repo=steve02081504/fount)](https://github.com/steve02081504/fount/graphs/contributors)
