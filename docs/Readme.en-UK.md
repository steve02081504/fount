# fount

![repo img](https://repository-images.githubusercontent.com/862251163/3b57d9ea-ab18-4b70-b11d-f74c764016aa)

Looking for lost characters, components, or custom tutorials?
Come [here![Discord](https://img.shields.io/discord/1288934771153440768)](https://discord.gg/GtR9Quzq2v), and meet in the sparks of ideas!

> [!CAUTION]
>
> 1. fount is like the rising sun, still on its path of growth. This means its interfaces and APIs may change at any time, and character creators may need to follow up with updates promptly to ensure their works function properly. But please believe that every change is for a better future.
> 2. In the world of fount, characters can freely run JavaScript commands, which gives them powerful capabilities. Therefore, please choose the characters you trust with caution, just like making friends in real life, to ensure the security of local files.

## Installation

### Linux/macOS/Android

```bash
# If needed, define the environment variable $FOUNT_DIR to specify the fount directory
curl -fsSL https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.sh | bash
source "$HOME/.profile"
```

If you don't want to start this journey immediately after installation, you can do this:

```bash
curl -fsSL https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.sh | bash -s init
source "$HOME/.profile"
```

### Windows

Don't want to think too much? Download the exe file from [release](https://github.com/steve02081504/fount/releases) and run it directly to step into this world.

If you prefer the whisper of the shell, you can also install and run fount in PowerShell:

```powershell
# If needed, define the environment variable $env:FOUNT_DIR to specify the fount directory
irm https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.ps1 | iex
```

If you want to pause for a moment before embarking on your exploration, you can do this:

```powershell
$scriptContent = Invoke-RestMethod https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.ps1
Invoke-Expression "function fountInstaller { $scriptContent }"
fountInstaller init
```

## Removal

Removing fount is easy, just use `fount remove`.

## What is fount?

fount, in short, is a character card frontend page that decouples AI sources, AI characters, user personas, dialogue environments, and AI plugins, allowing them to be freely combined to spark infinite possibilities.

Furthermore, it is a bridge, a bridge connecting imagination and reality.
It is a lighthouse, guiding the direction of characters and stories in the boundless ocean of data.
It is a free garden, allowing AI sources, characters, personas, dialogue environments, and plugins to grow, intertwine, and bloom freely here.

### AI Source Integration

Ever been bothered by running reverse proxy servers on your computer?
In the world of fount, you no longer need to start from scratch, letting the cumbersome dialogue format conversion vanish into thin air.
Everything can be solved using custom JavaScript code in the AI source generator, like magic.
No new processes are needed, CPU and memory can breathe quietly, and the desktop is also cleaner.

### Web Experience Improvement

fount stands on the shoulders of giants, casts a respectful glance at [SillyTavern](https://github.com/SillyTavern/SillyTavern), and incorporates its own insights and ideas on this basis.
This includes:

- **Whispers of multi-device synchronization:** No longer limited by a single device, you can simultaneously start conversations with characters on your computer and mobile phone, feeling the real-time resonance of thoughts, like whispers between lovers, hearts connected no matter where you are.
- **Unfiltered HTML rendering:** Many SillyTavern enthusiasts choose to install additional plugins to lift the restrictions on HTML rendering for a richer visual experience. fount opens this capability by default, giving users more freedom and choice, allowing capable creators to implement more outstanding features.
- **Native group support:** In fount, every conversation is a grand gathering. You can freely invite characters to join or let them quietly leave, without cumbersome format conversions and card copying, just like in a garden, flowers can be freely combined to present different scenery.

And more...

### Companionship: Beyond the Web

fount yearns to let characters walk into your life, experience wind and rain with you, and share joy.

- You can connect characters to Discord groups by configuring the built-in Discord Bot Shell, letting them laugh with friends or listen to each other's hearts in private messages.
    ![image](https://github.com/user-attachments/assets/299255c9-eed3-4deb-b433-41b80930cbdb)
    ![image](https://github.com/user-attachments/assets/c9841eba-c010-42a3-afe0-336543ec39a0)

- You can also use [fount-pwsh](https://github.com/steve02081504/fount-pwsh) to have characters send you gentle reminders when terminal commands fail, like a soft whisper in your ear when you are confused.
    ![image](https://github.com/user-attachments/assets/93afee48-93d4-42c7-a5e0-b7f5c93bdee9)

- Even, as long as you have a heart of exploration, even if you only master a little programming skill, you can also create your own fount Shell, letting characters go to a wider world, to anywhere you imagine!

### Creation: Beyond Prompt

If you are a character creator, fount will open a door to infinite possibilities for you.

- You can freely use the magic of JavaScript or TypeScript code, unleash creativity, customize the character's prompt generation process and dialogue process, break free from the constraints of frontend syntax, like a poet wielding a pen and splashing ink, expressing inner emotions to the fullest.
- Character cards can not only execute code without filtering, but also load any npm package and create custom HTML pages. Creation has never been so free, like a painter freely smearing colors on a canvas and outlining the world in their heart.
- If you are willing, you can also build various resources into the character, bid farewell to the troubles of building image hosting services, and make everything within reach, as if putting the whole world into your pocket.

### Extension: Beyond Sight

In the world of fount, everything is highly modularized.

- As long as you have a certain programming foundation, you can easily create and distribute the modules you need, just like a gardener cultivating new flowers, adding more color to this garden.
- fount encourages you to contribute your strength to the community and the future, making this world more prosperous and more vibrant.

### Summary

In summary, fount allows you to run fount format characters, which may have various abilities or be applied to different scenarios. They may be deep, lively, gentle, or strong, it all depends on you, my friend! :)

## Architecture

- The backend is based on Deno, supplemented by the Express framework, to build a solid skeleton.
- The frontend is woven with HTML, CSS, and JavaScript to create a gorgeous interface.
