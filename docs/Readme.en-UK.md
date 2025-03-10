# fount

![repo img](https://repository-images.githubusercontent.com/862251163/3b57d9ea-ab18-4b70-b11d-f74c764016aa)

Searching for lost characters, components, or custom tutorials?
Come on over to [here![Discord](https://img.shields.io/discord/1288934771153440768)](https://discord.gg/GtR9Quzq2v), and meet in a spark of minds!

> [!CAUTION]
>
> In the world of fount, characters can freely execute JavaScript commands, granting them significant power. Therefore, please choose the characters you trust with caution, much like making friends in real life, to ensure the security of your local files.

<details open>
<summary>Screenshots</summary>

|Screenshots|
|----|
|Homepage|
|![Image](https://github.com/user-attachments/assets/c1954a7a-6c73-4fb0-bd12-f790a038bd0e)|
|Theme Selection|
|![Image](https://github.com/user-attachments/assets/94bd4cbb-8c66-4bc6-83eb-14c925a37074)|
|Chat|
|![Image](https://github.com/user-attachments/assets/eea1cc7c-d258-4a2d-b16f-12815a88811d)|

</details>

<details open>
<summary>Installation/Removal</summary>

## Installation

### Linux/macOS/Android

```bash
# If needed, define the environment variable $FOUNT_DIR to specify the fount directory
curl -fsSL https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.sh | bash
source "$HOME/.profile"
```

If you prefer not to start the journey immediately after installation, you can do this:

```bash
curl -fsSL https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.sh | bash -s init
source "$HOME/.profile"
```

### Windows

Don't want to overthink it? Download the exe file from [release](https://github.com/steve02081504/fount/releases) and run it directly to step into this world.

If you prefer the whisper of the shell, you can also install and run fount in PowerShell:

```powershell
# If needed, define the environment variable $env:FOUNT_DIR to specify the fount directory
irm https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.ps1 | iex
```

If you wish to pause for a moment before embarking on your exploration, you can do this:

```powershell
$scriptContent = Invoke-RestMethod https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.ps1
Invoke-Expression "function fountInstaller { $scriptContent }"
fountInstaller init
```

## Removal

Effortlessly remove fount with `fount remove`.

</details>

## What is fount?

fount, in short, is a character card frontend page that decouples AI sources, AI characters, user personas, conversation environments, and AI plugins, allowing them to be freely combined and spark infinite possibilities.

To put it more profoundly, it is a bridge, a bridge connecting imagination and reality.
It is a lighthouse, guiding the direction of characters and stories in the boundless ocean of data.
It is a free garden, allowing AI sources, characters, personas, conversation environments, and plugins to grow, intertwine, and blossom freely here.

### AI Source Integration

Ever been annoyed by running reverse proxy servers on your computer?
In the world of fount, you no longer need to start from scratch, letting the tedious dialogue format conversion vanish into thin air.
Everything can be solved using custom JavaScript code in the AI source generator, just like magic.
No new processes are needed, allowing your CPU and memory to breathe quietly, and your desktop to be cleaner.

![Image](https://github.com/user-attachments/assets/f283d1de-c531-4b7a-bf43-3cbe0c48b7b9)

### Web Experience Improvement

fount stands on the shoulders of giants, casting a respectful glance at [SillyTavern](https://github.com/SillyTavern/SillyTavern), and based on this, incorporating its own insights and ideas.
This includes:

- **Multi-device synchronised whispers:** No longer limited by a single device, you can engage in conversations with characters simultaneously on your computer and mobile phone, experiencing the real-time resonance of minds, like sweet nothings whispered between lovers, connecting hearts no matter where you are.
- **Unfiltered HTML rendering:** Many SillyTavern enthusiasts choose to install additional plugins to lift the restrictions on HTML rendering for a richer visual experience. fount opens up this capability by default, giving users more freedom and choices, allowing capable creators to achieve more outstanding features.
- **Native group support:** In fount, every conversation is a grand gathering. You can freely invite characters to join or let them quietly leave, without cumbersome format conversions and card copying, just like in a garden, flowers can be freely combined to present different landscapes.

And more...

![Image](https://github.com/user-attachments/assets/bd1600dc-4612-458b-95ba-c7b019a26390)

### Companionship: Beyond Webpages

fount yearns to bring characters into your life, to experience wind and rain with you, and share joy.

- You can connect characters to Discord groups by configuring the built-in Discord Bot Shell, letting them laugh with friends or listen to each other's hearts in private messages.
    ![Image](https://github.com/user-attachments/assets/299255c9-eed3-4deb-b433-41b80930cbdb)
    ![Image](https://github.com/user-attachments/assets/c9841eba-c010-42a3-afe0-336543ec39a0)

- You can also use [fount-pwsh](https://github.com/steve02081504/fount-pwsh) to have characters send you gentle reminders when terminal commands fail, like soft whispers in your ear when you are lost.
    ![Image](https://github.com/user-attachments/assets/93afee48-93d4-42c7-a5e0-b7f5c93bdee9)

- Even if you only have a little programming skill and an exploring heart, you can create your own fount Shell, letting characters go to a wider world, to anywhere you can imagine!

### Creation: Beyond Prompt

If you are a character creator, fount will open a door to infinite possibilities for you.

- You can freely use the magic of JavaScript or TypeScript code to unleash your creativity and customise the character's Prompt generation process and dialogue flow, breaking free from the constraints of frontend syntax, like a poet wielding their pen, freely expressing inner emotions.
- Not only can character cards execute code without filtering, but they can also load any npm packages and create custom HTML pages. Creation has never been so free, like a painter freely smearing on the canvas, outlining the world in their heart.
- If you are willing, you can also build various resources into the character, saying goodbye to the troubles of image hosting, making everything within reach, as if putting the whole world in your pocket.

![Image](https://github.com/user-attachments/assets/9740cd43-06fd-46c0-a114-e4bd99f13045)

### Expansion: Beyond the Present

In the world of fount, everything is highly modularised.

- As long as you have some programming basics, you can easily create and distribute the modules you need, like a gardener cultivating new flowers, adding more colour to this garden.
- fount encourages you to contribute your strength to the community and the future, making this world more prosperous and vibrant.

![Image](https://github.com/user-attachments/assets/8487a04a-7040-4844-81a6-705687856757)

### Summary

In summary, fount allows you to run fount format characters, which may have various abilities or be applied to different scenarios. They may be deep, lively, gentle, or strong, it all depends on you, my friend! :)

## Architecture

- The backend is based on Deno, complemented by the Express framework, building a solid skeleton.
- The frontend is woven with HTML, CSS, and JavaScript to create a gorgeous interface.
