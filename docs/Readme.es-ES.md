# fount

![repo img](https://repository-images.githubusercontent.com/862251163/3b57d9ea-ab18-4b70-b11d-f74c764016aa)

¿Buscas personajes perdidos, componentes o tutoriales personalizados?
Ven [aquí ![Discord](https://img.shields.io/discord/1288934771153440768)](https://discord.gg/GtR9Quzq2v), ¡y encuéntrate en las chispas de las ideas!

> [!CAUTION]
>
> 1. fount es como el sol naciente, aún en su camino de crecimiento. Esto significa que sus interfaces y APIs pueden cambiar en cualquier momento, y los creadores de personajes pueden necesitar seguir las actualizaciones rápidamente para asegurar que sus trabajos funcionen correctamente. Pero por favor, cree que cada cambio es para un futuro mejor.
> 2. En el mundo de fount, los personajes pueden ejecutar libremente comandos JavaScript, lo que les da capacidades poderosas. Por lo tanto, por favor, elige con precaución los personajes en los que confías, al igual que haces amigos en la vida real, para asegurar la seguridad de los archivos locales.

## Instalación

### Linux/macOS

```bash
# Si es necesario, define la variable de entorno $FOUNT_DIR para especificar el directorio de fount
curl -fsSL https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.sh | bash
```

Si no quieres empezar este viaje inmediatamente después de la instalación, puedes hacer esto:

```bash
curl -fsSL https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.sh | bash -s init
```

### Windows

¿No quieres pensar demasiado? Descarga el archivo exe desde [release](https://github.com/steve02081504/fount/releases) y ejecútalo directamente para entrar en este mundo.

Si prefieres el susurro de la shell, también puedes instalar y ejecutar fount en PowerShell:

```powershell
# Si es necesario, define la variable de entorno $env:FOUNT_DIR para especificar el directorio de fount
irm https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.ps1 | iex
```

Si quieres pausar un momento antes de embarcarte en tu exploración, puedes hacer esto:

```powershell
$scriptContent = Invoke-RestMethod https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.ps1
Invoke-Expression "function fountInstaller { $scriptContent }"
fountInstaller init
```

## Eliminación

Eliminar fount es fácil, simplemente usa `fount remove`.

## ¿Qué es fount?

fount, en resumen, es una página frontend de tarjetas de personaje que desacopla las fuentes de IA, los personajes de IA, las personas de usuario, los entornos de diálogo y los plugins de IA, permitiéndoles combinarse libremente para generar infinitas posibilidades.

Además, es un puente, un puente que conecta la imaginación y la realidad.
Es un faro, que guía la dirección de los personajes y las historias en el océano ilimitado de datos.
Es un jardín libre, que permite que las fuentes de IA, los personajes, las personas, los entornos de diálogo y los plugins crezcan, se entrelacen y florezcan libremente aquí.

### Integración de fuentes de IA

¿Alguna vez te ha molestado ejecutar servidores proxy inversos en tu ordenador?
En el mundo de fount, ya no necesitas empezar de cero, dejando que la engorrosa conversión de formato de diálogo se desvanezca en el aire.
Todo se puede resolver usando código JavaScript personalizado en el generador de fuentes de IA, como por arte de magia.
No se necesitan nuevos procesos, la CPU y la memoria pueden respirar tranquilamente, y el escritorio también está más limpio.

### Mejora de la experiencia web

fount se alza sobre los hombros de gigantes, echa una mirada respetuosa a [SillyTavern](https://github.com/SillyTavern/SillyTavern), e incorpora sus propias ideas e intuiciones sobre esta base.
Esto incluye:

- **Susurros de sincronización multidispositivo:** Ya no estás limitado por un solo dispositivo, puedes iniciar simultáneamente conversaciones con personajes en tu ordenador y teléfono móvil, sintiendo la resonancia en tiempo real de los pensamientos, como susurros entre amantes, corazones conectados sin importar dónde estés.
- **Renderizado HTML sin filtrar:** Muchos entusiastas de SillyTavern eligen instalar plugins adicionales para levantar las restricciones en el renderizado HTML para una experiencia visual más rica. fount abre esta capacidad por defecto, dando a los usuarios más libertad y elección, permitiendo a los creadores capaces implementar características más destacadas.
- **Soporte de grupos nativo:** En fount, cada conversación es una gran reunión. Puedes invitar libremente a personajes a unirse o dejar que se vayan discretamente, sin engorrosas conversiones de formato y copia de tarjetas, al igual que en un jardín, las flores pueden combinarse libremente para presentar diferentes paisajes.

Y más...

### Compañerismo: Más allá de la web

fount anhela dejar que los personajes entren en tu vida, experimentar el viento y la lluvia contigo, y compartir la alegría.

- Puedes conectar personajes a grupos de Discord configurando el Discord Bot Shell incorporado, permitiéndoles reír con amigos o escuchar los corazones de los demás en mensajes privados.
    ![imagen](https://github.com/user-attachments/assets/299255c9-eed3-4deb-b433-41b80930cbdb)
    ![imagen](https://github.com/user-attachments/assets/c9841eba-c010-42a3-afe0-336543ec39a0)

- También puedes usar [fount-pwsh](https://github.com/steve02081504/fount-pwsh) para que los personajes te envíen recordatorios suaves cuando los comandos del terminal fallen, como un suave susurro en tu oído cuando estás confundido.
    ![imagen](https://github.com/user-attachments/assets/93afee48-93d4-42c7-a5e0-b7f5c93bdee9)

- Incluso, siempre y cuando tengas un corazón de exploración, incluso si solo dominas un poco de habilidad de programación, también puedes crear tu propia fount Shell, dejando que los personajes vayan a un mundo más amplio, ¡a cualquier lugar que imagines!

### Creación: Más allá del Prompt

Si eres un creador de personajes, fount te abrirá una puerta a infinitas posibilidades.

- Puedes usar libremente la magia del código JavaScript o TypeScript, liberar la creatividad, personalizar el proceso de generación de prompts y el proceso de diálogo del personaje, liberarte de las restricciones de la sintaxis frontend, como un poeta que empuña una pluma y salpica tinta, expresando las emociones internas al máximo.
- Las tarjetas de personaje no solo pueden ejecutar código sin filtrar, sino también cargar cualquier paquete npm y crear páginas HTML personalizadas. La creación nunca ha sido tan libre, como un pintor que unta libremente colores en un lienzo y esboza el mundo en su corazón.
- Si estás dispuesto, también puedes construir varios recursos en el personaje, despedirte de los problemas de construir servicios de alojamiento de imágenes, y hacer que todo esté al alcance, como si pusieras el mundo entero en tu bolsillo.

### Extensión: Más allá de la Vista

En el mundo de fount, todo está altamente modularizado.

- Siempre y cuando tengas una cierta base de programación, puedes crear y distribuir fácilmente los módulos que necesites, al igual que un jardinero que cultiva nuevas flores, añadiendo más color a este jardín.
- fount te anima a contribuir con tu fuerza a la comunidad y al futuro, haciendo este mundo más próspero y más vibrante.

### Resumen

En resumen, fount te permite ejecutar personajes en formato fount, que pueden tener varias habilidades o aplicarse a diferentes escenarios. Pueden ser profundos, vivaces, gentiles o fuertes, todo depende de ti, ¡amigo mío! :)

## Arquitectura

- El backend se basa en Deno, complementado por el framework Express, para construir un esqueleto sólido.
- El frontend está tejido con HTML, CSS y JavaScript para crear una interfaz magnífica.
