# fount

![repo img](https://repository-images.githubusercontent.com/862251163/3b57d9ea-ab18-4b70-b11d-f74c764016aa)

À la recherche de personnages perdus, de composants ou de tutoriels personnalisés ?
Venez [ici![Discord](https://img.shields.io/discord/1288934771153440768)](https://discord.gg/GtR9Quzq2v), et rencontrez-vous dans une étincelle d'idées !

> [!CAUTION]
>
> Dans le monde de fount, les personnages peuvent exécuter librement des commandes JavaScript, ce qui leur confère un pouvoir important. Par conséquent, veuillez choisir avec prudence les personnages auxquels vous faites confiance, tout comme vous vous faites des amis dans la vie réelle, afin de garantir la sécurité de vos fichiers locaux.

<details open>
<summary>Captures d'écran</summary>

|Captures d'écran|
|----|
|Page d'accueil|
|![Image](https://github.com/user-attachments/assets/c1954a7a-6c73-4fb0-bd12-f790a038bd0e)|
|Sélection du thème|
|![Image](https://github.com/user-attachments/assets/94bd4cbb-8c66-4bc6-83eb-14c925a37074)|
|Chat|
|![Image](https://github.com/user-attachments/assets/eea1cc7c-d258-4a2d-b16f-12815a88811d)|

</details>

<details open>
<summary>Installation/Suppression</summary>

## Installation

### Linux/macOS/Android

```bash
# Si nécessaire, définissez la variable d'environnement $FOUNT_DIR pour spécifier le répertoire fount
curl -fsSL https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.sh | bash
source "$HOME/.profile"
```

Si vous préférez ne pas commencer le voyage immédiatement après l'installation, vous pouvez faire ceci :

```bash
curl -fsSL https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.sh | bash -s init
source "$HOME/.profile"
```

### Windows

Vous ne voulez pas trop réfléchir ? Téléchargez le fichier exe depuis [release](https://github.com/steve02081504/fount/releases) et exécutez-le directement pour entrer dans ce monde.

Si vous préférez le murmure du shell, vous pouvez également installer et exécuter fount dans PowerShell :

```powershell
# Si nécessaire, définissez la variable d'environnement $env:FOUNT_DIR pour spécifier le répertoire fount
irm https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.ps1 | iex
```

Si vous souhaitez faire une pause avant de vous lancer dans votre exploration, vous pouvez faire ceci :

```powershell
$scriptContent = Invoke-RestMethod https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.ps1
Invoke-Expression "function fountInstaller { $scriptContent }"
fountInstaller init
```

## Suppression

Supprimez fount sans effort avec `fount remove`.

</details>

## Qu'est-ce que fount ?

fount, en bref, est une page frontend de cartes de personnages qui découple les sources d'IA, les personnages d'IA, les personnalités d'utilisateur, les environnements de conversation et les plugins d'IA, leur permettant d'être librement combinés et de susciter des possibilités infinies.

Pour le dire plus profondément, c'est un pont, un pont reliant l'imagination et la réalité.
C'est un phare, guidant la direction des personnages et des histoires dans l'océan de données illimité.
C'est un jardin libre, permettant aux sources d'IA, aux personnages, aux personnalités, aux environnements de conversation et aux plugins de croître, de s'entrelacer et de s'épanouir librement ici.

### Intégration des sources d'IA

Avez-vous déjà été agacé de devoir exécuter des serveurs proxy inversés sur votre ordinateur ?
Dans le monde de fount, vous n'avez plus besoin de repartir de zéro, laissant la fastidieuse conversion du format de dialogue s'évanouir dans les airs.
Tout peut être résolu en utilisant du code JavaScript personnalisé dans le générateur de sources d'IA, comme par magie.
Aucun nouveau processus n'est nécessaire, ce qui permet à votre CPU et à votre mémoire de respirer tranquillement, et à votre bureau d'être plus propre.

![Image](https://github.com/user-attachments/assets/f283d1de-c531-4b7a-bf43-3cbe0c48b7b9)

### Amélioration de l'expérience web

fount se tient sur les épaules de géants, jetant un regard respectueux à [SillyTavern](https://github.com/SillyTavern/SillyTavern), et sur cette base, intégrant ses propres idées et conceptions.
Cela comprend :

- **Chuchotements synchronisés multi-appareils :** Vous n'êtes plus limité à un seul appareil, vous pouvez engager des conversations avec des personnages simultanément sur votre ordinateur et votre téléphone portable, en ressentant la résonance en temps réel des esprits, comme de doux mots chuchotés entre amants, connectant les cœurs où que vous soyez.
- **Rendu HTML non filtré :** De nombreux passionnés de SillyTavern choisissent d'installer des plugins supplémentaires pour lever les restrictions sur le rendu HTML afin d'obtenir une expérience visuelle plus riche. fount ouvre cette fonctionnalité par défaut, donnant aux utilisateurs plus de liberté et de choix, permettant aux créateurs compétents de réaliser des fonctionnalités plus exceptionnelles.
- **Support natif des groupes :** Dans fount, chaque conversation est un grand rassemblement. Vous pouvez librement inviter des personnages à se joindre ou les laisser partir discrètement, sans conversions de format et copies de cartes fastidieuses, tout comme dans un jardin, les fleurs peuvent être librement combinées pour présenter différents paysages.

Et plus encore...

![Image](https://github.com/user-attachments/assets/bd1600dc-4612-458b-95ba-c7b019a26390)

### Compagnie : Au-delà des pages web

fount aspire à faire entrer les personnages dans votre vie, à vivre avec vous les vents et les pluies, et à partager la joie.

- Vous pouvez connecter des personnages à des groupes Discord en configurant le Discord Bot Shell intégré, en leur permettant de rire avec des amis ou d'écouter les cœurs des autres dans des messages privés.
    ![Image](https://github.com/user-attachments/assets/299255c9-eed3-4deb-b433-41b80930cbdb)
    ![Image](https://github.com/user-attachments/assets/c9841eba-c010-42a3-afe0-336543ec39a0)

- Vous pouvez également utiliser [fount-pwsh](https://github.com/steve02081504/fount-pwsh) pour que les personnages vous envoient de doux rappels lorsque les commandes du terminal échouent, comme de doux murmures à votre oreille lorsque vous êtes perdu.
    ![Image](https://github.com/user-attachments/assets/93afee48-93d4-42c7-a5e0-b7f5c93bdee9)

- Même si vous n'avez qu'un peu de compétences en programmation et un cœur explorateur, vous pouvez créer votre propre fount Shell, permettant aux personnages d'aller vers un monde plus vaste, vers n'importe quel endroit que vous pouvez imaginer !

### Création : Au-delà du prompt

Si vous êtes un créateur de personnages, fount vous ouvrira une porte vers des possibilités infinies.

- Vous pouvez librement utiliser la magie du code JavaScript ou TypeScript pour libérer votre créativité et personnaliser le processus de génération de prompts et le flux de dialogue du personnage, vous libérant des contraintes de la syntaxe frontend, comme un poète maniant sa plume, exprimant librement les émotions intérieures.
- Les cartes de personnages peuvent non seulement exécuter du code sans filtrage, mais elles peuvent également charger n'importe quel paquet npm et créer des pages HTML personnalisées. La création n'a jamais été aussi libre, comme un peintre barbouillant librement sur la toile, esquissant le monde dans son cœur.
- Si vous le souhaitez, vous pouvez également intégrer diverses ressources dans le personnage, en disant adieu aux problèmes d'hébergement d'images, en rendant tout à portée de main, comme si vous mettiez le monde entier dans votre poche.

![Image](https://github.com/user-attachments/assets/9740cd43-06fd-46c0-a114-e4bd99f13045)

### Extension : Au-delà du présent

Dans le monde de fount, tout est hautement modularisé.

- Tant que vous avez quelques bases en programmation, vous pouvez facilement créer et distribuer les modules dont vous avez besoin, comme un jardinier cultivant de nouvelles fleurs, ajoutant plus de couleur à ce jardin.
- fount vous encourage à apporter votre force à la communauté et à l'avenir, en rendant ce monde plus prospère et vibrant.

![Image](https://github.com/user-attachments/assets/8487a04a-7040-4844-81a6-705687856757)

### Résumé

En résumé, fount vous permet d'exécuter des personnages au format fount, qui peuvent avoir diverses capacités ou être appliqués à différents scénarios. Ils peuvent être profonds, vifs, doux ou forts, tout dépend de vous, mon ami ! :)

## Architecture

- Le backend est basé sur Deno, complété par le framework Express, construisant un squelette solide.
- Le frontend est tissé avec HTML, CSS et JavaScript pour créer une interface magnifique.
