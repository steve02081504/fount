# fount

![repo img](https://repository-images.githubusercontent.com/862251163/3b57d9ea-ab18-4b70-b11d-f74c764016aa)

¿Buscando personajes perdidos, componentes o tutoriales personalizados?
¡Ven [aquí![Discord](https://img.shields.io/discord/1288934771153440768)](https://discord.gg/GtR9Quzq2v) y encuéntranos en una chispa de ideas!

> [!CAUTION]
>
> En el mundo de fount, los personajes pueden ejecutar comandos de JavaScript libremente, lo que les otorga un poder significativo. Por lo tanto, por favor, elige con precaución los personajes en los que confías, al igual que haces amigos en la vida real, para garantizar la seguridad de tus archivos locales.

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
<summary>Instalación/Desinstalación</summary>

## Instalación

### Linux/macOS/Android

```bash
# Si es necesario, define la variable de entorno $FOUNT_DIR para especificar el directorio de fount
curl -fsSL https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.sh | bash
source "$HOME/.profile"
```

Si prefieres no comenzar el viaje inmediatamente después de la instalación, puedes hacer esto:

```bash
curl -fsSL https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.sh | bash -s init
source "$HOME/.profile"
```

### Windows

¿No quieres pensar demasiado? Descarga el archivo exe desde [release](https://github.com/steve02081504/fount/releases) y ejecútalo directamente para entrar en este mundo.

Si prefieres el susurro de la shell, también puedes instalar y ejecutar fount en PowerShell:

```powershell
# Si es necesario, define la variable de entorno $env:FOUNT_DIR para especificar el directorio de fount
irm https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.ps1 | iex
```

Si deseas detenerte un momento antes de embarcarte en tu exploración, puedes hacer esto:

```powershell
$scriptContent = Invoke-RestMethod https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.ps1
Invoke-Expression "function fountInstaller { $scriptContent }"
fountInstaller init
```

## Desinstalación

Desinstala fount sin esfuerzo con `fount remove`.

</details>

## ¿Qué es fount?

fount, en resumen, es una página frontend de tarjetas de personajes que desacopla las fuentes de IA, los personajes de IA, las personas de usuario, los entornos de conversación y los plugins de IA, permitiéndoles combinarse libremente y generar infinitas posibilidades.

Para decirlo de manera más profunda, es un puente, un puente que conecta la imaginación y la realidad.
Es un faro, que guía la dirección de los personajes y las historias en el océano ilimitado de datos.
Es un jardín libre, que permite que las fuentes de IA, los personajes, las personas, los entornos de conversación y los plugins crezcan, se entrelacen y florezcan libremente aquí.

### Integración de fuentes de IA

¿Alguna vez te ha molestado tener que ejecutar servidores proxy inversos en tu ordenador?
En el mundo de fount, ya no necesitas empezar de cero, dejando que la tediosa conversión del formato de diálogo se desvanezca en el aire.
Todo se puede resolver utilizando código JavaScript personalizado en el generador de fuentes de IA, como por arte de magia.
No se necesitan nuevos procesos, lo que permite que tu CPU y memoria respiren tranquilamente, y que tu escritorio esté más limpio.

![Imagen](https://github.com/user-attachments/assets/f283d1de-c531-4b7a-bf43-3cbe0c48b7b9)

### Mejora de la experiencia web

fount se alza sobre hombros de gigantes, lanzando una mirada respetuosa a [SillyTavern](https://github.com/SillyTavern/SillyTavern), y basándose en ello, incorporando sus propias ideas y concepciones.
Esto incluye:

- **Susurros sincronizados multidispositivo:** Ya no estás limitado a un solo dispositivo, puedes entablar conversaciones con personajes simultáneamente en tu ordenador y teléfono móvil, experimentando la resonancia en tiempo real de las mentes, como dulces palabras susurradas entre amantes, conectando corazones sin importar dónde te encuentres.
- **Renderizado HTML sin filtros:** Muchos entusiastas de SillyTavern optan por instalar plugins adicionales para levantar las restricciones en el renderizado HTML y obtener una experiencia visual más rica. fount abre esta capacidad por defecto, dando a los usuarios más libertad y opciones, permitiendo a los creadores capaces lograr características más destacadas.
- **Soporte de grupos nativo:** En fount, cada conversación es una gran reunión. Puedes invitar libremente a personajes a unirse o dejar que se vayan en silencio, sin engorrosas conversiones de formato y copia de tarjetas, como en un jardín, las flores pueden combinarse libremente para presentar diferentes paisajes.

Y más...

![Imagen](https://github.com/user-attachments/assets/bd1600dc-4612-458b-95ba-c7b019a26390)

### Compañerismo: Más allá de las páginas web

fount anhela llevar a los personajes a tu vida, para experimentar juntos los vientos y las lluvias, y compartir la alegría.

- Puedes conectar personajes a grupos de Discord configurando el Discord Bot Shell integrado, permitiéndoles reír con amigos o escuchar los corazones de los demás en mensajes privados.
    ![Imagen](https://github.com/user-attachments/assets/299255c9-eed3-4deb-b433-41b80930cbdb)
    ![Imagen](https://github.com/user-attachments/assets/c9841eba-c010-42a3-afe0-336543ec39a0)

- También puedes usar [fount-pwsh](https://github.com/steve02081504/fount-pwsh) para que los personajes te envíen recordatorios suaves cuando los comandos de la terminal fallen, como suaves susurros en tu oído cuando estás perdido.
    ![Imagen](https://github.com/user-attachments/assets/93afee48-93d4-42c7-a5e0-b7f5c93bdee9)

- ¡Incluso si sólo tienes un poco de habilidad de programación y un corazón explorador, puedes crear tu propia fount Shell, permitiendo que los personajes vayan a un mundo más amplio, a cualquier lugar que puedas imaginar!

### Creación: Más allá del prompt

Si eres un creador de personajes, fount te abrirá una puerta a infinitas posibilidades.

- Puedes usar libremente la magia del código JavaScript o TypeScript para dar rienda suelta a tu creatividad y personalizar el proceso de generación de prompts y el flujo de diálogo del personaje, liberándote de las limitaciones de la sintaxis frontend, como un poeta que empuña su pluma, expresando libremente las emociones interiores.
- Las tarjetas de personaje no sólo pueden ejecutar código sin filtrar, sino que también pueden cargar cualquier paquete npm y crear páginas HTML personalizadas. La creación nunca ha sido tan libre, como un pintor que mancha libremente sobre el lienzo, esbozando el mundo en su corazón.
- Si quieres, también puedes construir varios recursos dentro del personaje, diciendo adiós a los problemas del alojamiento de imágenes, haciendo que todo esté al alcance de la mano, como si pusieras el mundo entero en tu bolsillo.

![Imagen](https://github.com/user-attachments/assets/9740cd43-06fd-46c0-a114-e4bd99f13045)

### Expansión: Más allá del presente

En el mundo de fount, todo está altamente modularizado.

- Siempre y cuando tengas algunos conocimientos básicos de programación, puedes crear y distribuir fácilmente los módulos que necesites, como un jardinero cultivando nuevas flores, añadiendo más color a este jardín.
- fount te anima a contribuir con tu fuerza a la comunidad y al futuro, haciendo que este mundo sea más próspero y vibrante.

![Imagen](https://github.com/user-attachments/assets/8487a04a-7040-4844-81a6-705687856757)

### Resumen

En resumen, fount te permite ejecutar personajes en formato fount, que pueden tener diversas habilidades o aplicarse a diferentes escenarios. Pueden ser profundos, vivaces, amables o fuertes, ¡todo depende de ti, amigo mío! :)

## Arquitectura

- El backend se basa en Deno, complementado con el framework Express, construyendo un esqueleto sólido.
- El frontend está tejido con HTML, CSS y JavaScript para crear una interfaz magnífica.
