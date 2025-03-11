# fount

> Your Immersive AI Character Companion

![repo img](https://repository-images.githubusercontent.com/862251163/3b57d9ea-ab18-4b70-b11d-f74c764016aa)

[![English (United Kingdom)](https://raw.githubusercontent.com/gosquared/flags/master/flags/flags/shiny/48/United-Kingdom.png)](./docs/Readme.en-UK.md)
[![日本語](https://raw.githubusercontent.com/gosquared/flags/master/flags/flags/shiny/48/Japan.png)](./docs/Readme.ja-JP.md)
[![中文](https://raw.githubusercontent.com/gosquared/flags/master/flags/flags/shiny/48/China.png)](./docs/Readme.zh-CN.md)
[![Français](https://raw.githubusercontent.com/gosquared/flags/master/flags/flags/shiny/48/France.png)](./docs/Readme.fr-FR.md)
[![Español](https://raw.githubusercontent.com/gosquared/flags/master/flags/flags/shiny/48/Spain.png)](./docs/Readme.es-ES.md)
[![Deutsch](https://raw.githubusercontent.com/gosquared/flags/master/flags/flags/shiny/48/Germany.png)](./docs/Readme.de-DE.md)
[![русский](https://raw.githubusercontent.com/gosquared/flags/master/flags/flags/shiny/48/Russia.png)](./docs/Readme.ru-RU.md)
[![Português](https://raw.githubusercontent.com/gosquared/flags/master/flags/flags/shiny/48/Portugal.png)](./docs/Readme.pt-BR.md)
[![हिन्दी](https://raw.githubusercontent.com/gosquared/flags/master/flags/flags/shiny/48/India.png)](./docs/Readme.hi-IN.md)
[![한국어](https://raw.githubusercontent.com/gosquared/flags/master/flags/flags/shiny/48/South-Korea.png)](./docs/Readme.ko-KR.md)

Have you ever yearned for a journey alongside a character sprung from the pages of your imagination, a companion woven from dreams? Or perhaps you've envisioned a digital confidant, an AI assistant as intuitive as the most advanced creations, effortlessly orchestrating your digital world? Or maybe, just maybe, you've sought a connection beyond the ordinary, a realm where reality's edges blur, and an intimate, *unfiltered* understanding unfolds?

With nearly a year of dedicated development, contributions from over 10 passionate individuals, and a thriving community of over 1000 users, Fount stands as a mature, stable, and ever-evolving platform for AI interaction.  It's a journey, and one we believe is more accessible than you might imagine.

Lost characters, forgotten stories? Our [**vibrant and welcoming community**!](https://discord.gg/GtR9Quzq2v) awaits, a haven where kindred spirits gather, where developers and creators alike share their wisdom and creations.

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

## Installation: Weaving fount into Your World – *Effortlessly*

Embark on your journey with fount, a stable and reliable platform.  A few simple clicks or commands, and the world of fount unfolds.

### Linux/macOS/Android: The Whispers of the Shell – *One Line, and You're In*

```bash
# If needed, define the environment variable $FOUNT_DIR to specify the fount directory
curl -fsSL https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.sh | bash
source "$HOME/.profile"
```

Should you wish to pause, to gather your thoughts before the grand adventure (a dry run):

```bash
curl -fsSL https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.sh | bash -s init
source "$HOME/.profile"
```

### Windows: A Choice of Paths – *Simplicity Itself*

* **Direct and Uncomplicated (Recommended):** Download the `exe` file from [Releases](https://github.com/steve02081504/fount/releases) and run it.

* **The Power of PowerShell:**

    ```powershell
    # If needed, define the environment variable $env:FOUNT_DIR to specify the fount directory
    irm https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.ps1 | iex
    ```

    For a dry run:

    ```powershell
    $scriptContent = Invoke-RestMethod https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.ps1
    Invoke-Expression "function fountInstaller { $scriptContent }"
    fountInstaller init
    ```

### Git Installation: For those who prefer a touch of magic

If you already have Git installed, embracing fount is as simple as running a script.

* **For Windows:**  Open your command prompt or PowerShell and simply double-click `run.bat`.
* **For Linux/macOS/Android:**  Open your terminal and execute `./run.sh`.

### Docker: Embracing the Container

```bash
docker pull ghcr.io/steve02081504/fount
```

## Removal: A Graceful Farewell

```bash
fount remove
```

</details>

## What is fount?

fount is an AI-powered character interaction platform designed to empower *you*. It's a bridge, connecting you to the characters of your imagination, allowing you to effortlessly converse with them, craft your own, and share them with the world. *A path made surprisingly accessible.*

It's a wellspring, where AI sources, characters, personas, environments, and plugins flow together, allowing you to create and experience unique and compelling interactions.

Fount is built for the future.  New features, born from the vibrant community, are embraced. If you have a vision, a spark of an idea that belongs within fount's realm, we welcome your contribution.

## Architecture: The Foundation of Innovation

Fount is built upon a robust and scalable architecture, designed for both performance and maintainability. The backend leverages the power and speed of [Deno](https://deno.com/), a secure and modern runtime for JavaScript and TypeScript. We utilize the [Express](https://expressjs.com/) framework for efficient routing and handling of API requests. The frontend is crafted with a blend of HTML, CSS, and JavaScript, providing a visually appealing and intuitive user interface. This architecture allows for rapid iteration and the seamless integration of new features, while maintaining a strong foundation of stability. Fount embraces an open-source ethos, welcoming contributions and collaboration.

### Dive into a World of Features

* **Seamless Conversations, Anywhere:** Begin a chat on your computer, continue it seamlessly on your phone or tablet. fount keeps your conversations synchronized, connecting you to your characters wherever you go.

* **Expressive, Immersive Chats:** fount embraces the full power of HTML, allowing characters to express themselves with rich text, images, and even interactive elements.

* **Gatherings of Minds: Native Group Chats:** Invite multiple characters into a single conversation, creating dynamic and engaging interactions.

* **A Beautiful, Customizable Interface:** Choose from over 30 stunning themes, or create your own. fount is your personal canvas.

* **Works Everywhere You Do:** fount runs seamlessly on Windows, macOS, Linux, and even Android, adapting to your needs through direct installation or the flexibility of Docker.

* **(For Advanced Users) Unshackled AI Source Integration: Embrace the Boundless**

    Fount offers unparalleled *choice* and *flexibility* in connecting to AI sources.  Custom JavaScript code within the AI source generator allows you to connect to *any* AI source – OpenAI, Claude, OpenRouter, NovelAI, the Horde, Ooba, Tabby, Mistral, and more.  Craft intricate regular expressions, call upon a vast library of APIs, embed multimedia assets – all within the flow of your code. Fount also natively supports the creation of API pools, enabling intelligent request routing.  The logic of communication bends to *your* will, crafted through the power of code.

    ![Image](https://github.com/user-attachments/assets/f283d1de-c531-4b7a-bf43-3cbe0c48b7b9)

### Companionship: Beyond the Digital Veil

Fount strives to weave characters into the fabric of your life, offering companionship and support.

* **Discord Integration:** Connect characters to your Discord communities through the built-in Discord Bot Shell.
    ![Image](https://github.com/user-attachments/assets/299255c9-eed3-4deb-b433-41b80930cbdb)
    ![Image](https://github.com/user-attachments/assets/c9841eba-c010-42a3-afe0-336543ec39a0)

* **Terminal Serenity (with [fount-pwsh](https://github.com/steve02081504/fount-pwsh)):** Let characters offer guidance when terminal commands falter.
    ![Image](https://github.com/user-attachments/assets/93afee48-93d4-42c7-a5e0-b7f5c93bdee9)

* **Limitless Shell Extensions:** With a touch of programming skill, craft your own fount Shells, extending your characters' reach.

### Creation: Beyond the Confines of Prompts – A Path Made Clearer

For the character creator, fount offers a streamlined and intuitive path to bringing your AI characters to life. Whether you're a seasoned creator or just beginning your journey, fount unlocks the magic of character creation for everyone.

* **Revolutionary AI-Assisted Character Creation: Fount allows you to quickly get started.** Describe your desired character in a single sentence, and our intelligent AI assistant instantly crafts a fully realized persona. This approach simplifies the initial setup, allowing you to focus on refining and interacting with your character.

* **Unlock the Magic of Code - Easier Than You Imagine:** Fount embraces the power of code to provide flexibility and control. Programming in Fount is a form of modern magic, surprisingly easy to learn with the gentle guidance of our community, and the illuminating aid of AI. You'll find that defining character logic with code can be intuitive and maintainable. Imagine crafting characters whose responses are *woven* from your own logic.

* **Start with Ready-Made Magic: A Treasure Trove of Templates.** Fount's community provides a wealth of pre-crafted character and persona templates, acting as "living blueprints" that are easy to adapt and customize. These templates showcase best practices and provide a fantastic starting point.

* **Embedded Resources:** Weave resources directly into your characters.

![Image](https://github.com/user-attachments/assets/9740cd43-06fd-46c0-a114-e4bd99f13045)

* **Legacy Compatibility:** fount embraces the past, offering compatibility modules to run SillyTavern and Risu character cards (though migration of existing characters is not supported).

### Expansion: A Tapestry of Innovation, Woven from Diverse Threads

In the world of fount, modularity reigns supreme. A rich ecosystem of components intertwines to create the tapestry of your experience.

* **Effortless Module Creation:** With basic programming knowledge, craft and share the modules you desire.
* **Community Driven Growth:** Contribute your unique talents to our **thriving and supportive community**, enriching the future of this digital ecosystem. Within our haven, you'll find friendly faces, and a wealth of shared knowledge: tutorials, AI model sources, and a gallery of characters. The fount development team meticulously manages all changes through a robust branch and merge strategy. This ensures that even as we leap forward, stability remains a cornerstone. We are also committed to rapidly addressing any issues reported by our users.
* **Powerful Plugin System**: Extend fount's capabilities with a robust plugin architecture.
* **Component Types - The Building Blocks of Dreams:**

  * **chars (Characters):** The heart of fount, where personalities are born.
  * **worlds (Worlds):** *Far more than mere lorebooks.* Worlds are the silent architects of reality within fount. They can append knowledge to a character's understanding, influence their decisions, and even manipulate the chat history.
  * **personas (User Personas):** *More than just user profiles.* Personas possess the power to warp and even seize control of your words and perceptions. This allows for truly immersive roleplaying.
  * **shells (Interaction Interfaces):** The gateways to fount's soul. Shells extend the reach of characters beyond the interface.
  * **ImportHandlers (Import Handlers):** The welcoming hands of fount, bridging the gap between diverse character formats. Craft a simple ImportHandler, share it with the community (through a Pull Request), and expand the horizons of fount for all.
  * **AIsources (AI Sources):** The raw power that fuels the minds of your characters.
  * **AIsourceGenerators (AI Source Generators):** The alchemists of fount, providing the templates and customizable logic to forge connections with *any* AI source. Through the power of JavaScript, you can encapsulate and load any source imaginable.

    *All of these components can be effortlessly installed by users, expanding and customizing their fount experience.*

![Image](https://github.com/user-attachments/assets/8487a04a-7040-4844-81a6-705687856757)

### Getting Started is Easy

* **Multiple Installation Options:** Choose from Docker, direct installation on Windows/Linux/macOS/Android, or even a simple executable file.
* **Detailed Documentation:** Our comprehensive documentation guides you through every step. [See Installation Details](https://steve02081504.github.io/fount/readme)

### Encountering a Shadow? Fear Not

Should you encounter any difficulties, reach out to us. We are here to help, and committed to resolving most issues within 10 minutes to 24 hours.

* **GitHub Issues:** Report any bugs or suggest new features through [GitHub Issues](https://github.com/steve02081504/fount/issues).
* **Discord Community:** Join our [vibrant Discord community](https://discord.gg/GtR9Quzq2v) for real-time support and discussions.

Your voice will be heard. Simply restart fount, and the shadows will dissipate.

### Witness the Growth: fount's Star History

[![Star History Chart](https://api.star-history.com/svg?repos=steve02081504/fount&type=Date)](https://github.com/steve02081504/fount/stargazers)

### In Conclusion: A Foundation for Connection

fount empowers you to create and interact with AI characters in a way that feels natural, immersive, and deeply personal. Whether you're a seasoned creator or just beginning your journey, fount welcomes you. Join our **welcoming community** and discover the magic of breathing life into your imagination, supported by a mature platform and a dedicated team.

### Crafting Your Own Fate: The Artisan's Touch

Beyond the whispers of AI, fount offers a deeper connection – *the artisan's touch*. Within our community, you'll find a wealth of pre-crafted character and persona templates, *each a carefully sculpted foundation awaiting your unique vision*.

And when you're ready to refine your creation, Fount's code-driven approach makes it easy to get started. Remember, programming in Fount is a gentle learning curve, supported by our welcoming community and abundant templates. You'll discover that even a few lines of code can unlock incredible depth and personality in your characters.

## Delve Deeper

Explore the [localized readme](https://steve02081504.github.io/fount/readme) for a wealth of detailed information.
