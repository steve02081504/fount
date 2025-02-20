# fount

![repo img](https://repository-images.githubusercontent.com/862251163/3b57d9ea-ab18-4b70-b11d-f74c764016aa)

Vous recherchez des personnages perdus, des composants ou des tutoriels personnalisés ?
Venez [ici ![Discord](https://img.shields.io/discord/1288934771153440768)](https://discord.gg/GtR9Quzq2v), et rencontrez-vous dans les étincelles d'idées !

> [!CAUTION]
>
> 1. fount est comme le soleil levant, toujours sur son chemin de croissance. Cela signifie que ses interfaces et API peuvent changer à tout moment, et les créateurs de personnages peuvent avoir besoin de suivre rapidement les mises à jour pour s'assurer que leurs œuvres fonctionnent correctement. Mais croyez bien que chaque changement est pour un avenir meilleur.
> 2. Dans le monde de fount, les personnages peuvent exécuter librement des commandes JavaScript, ce qui leur confère de puissantes capacités. Par conséquent, veuillez choisir avec prudence les personnages auxquels vous faites confiance, tout comme vous vous faites des amis dans la vie réelle, afin de garantir la sécurité des fichiers locaux.

## Installation

### Linux/macOS

```bash
# Si nécessaire, définissez la variable d'environnement $FOUNT_DIR pour spécifier le répertoire fount
curl -fsSL https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.sh | bash
```

Si vous ne souhaitez pas commencer ce voyage immédiatement après l'installation, vous pouvez faire ceci :

```bash
curl -fsSL https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.sh | bash -s init
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

Supprimer fount est facile, utilisez simplement `fount remove`.

## Qu'est-ce que fount ?

fount, en bref, est une page frontend de carte de personnage qui découple les sources d'IA, les personnages d'IA, les personnalités d'utilisateur, les environnements de dialogue et les plugins d'IA, leur permettant d'être librement combinés pour susciter des possibilités infinies.

De plus, c'est un pont, un pont reliant l'imagination et la réalité.
C'est un phare, guidant la direction des personnages et des histoires dans l'océan de données illimité.
C'est un jardin libre, permettant aux sources d'IA, aux personnages, aux personnalités, aux environnements de dialogue et aux plugins de pousser, s'entrelacer et s'épanouir librement ici.

### Intégration de sources d'IA

Avez-vous déjà été ennuyé par l'exécution de serveurs proxy inversés sur votre ordinateur ?
Dans le monde de fount, vous n'avez plus besoin de repartir de zéro, laissant la conversion fastidieuse du format de dialogue disparaître dans les airs.
Tout peut être résolu en utilisant du code JavaScript personnalisé dans le générateur de sources d'IA, comme par magie.
Aucun nouveau processus n'est nécessaire, le CPU et la mémoire peuvent respirer tranquillement, et le bureau est également plus propre.

### Amélioration de l'expérience Web

fount se tient sur les épaules de géants, jette un regard respectueux à [SillyTavern](https://github.com/SillyTavern/SillyTavern), et intègre ses propres idées et réflexions sur cette base.
Cela comprend :

- **Murmures de synchronisation multi-appareils :** Plus limité par un seul appareil, vous pouvez démarrer simultanément des conversations avec des personnages sur votre ordinateur et votre téléphone portable, ressentant la résonance en temps réel des pensées, comme des murmures entre amants, des cœurs connectés où que vous soyez.
- **Rendu HTML non filtré :** De nombreux passionnés de SillyTavern choisissent d'installer des plugins supplémentaires pour lever les restrictions sur le rendu HTML pour une expérience visuelle plus riche. fount ouvre cette capacité par défaut, donnant aux utilisateurs plus de liberté et de choix, permettant aux créateurs compétents de mettre en œuvre des fonctionnalités plus remarquables.
- **Support de groupe natif :** Dans fount, chaque conversation est un grand rassemblement. Vous pouvez librement inviter des personnages à rejoindre ou les laisser partir discrètement, sans conversions de format fastidieuses ni copie de cartes, tout comme dans un jardin, les fleurs peuvent être librement combinées pour présenter différents paysages.

Et plus encore...

### Compagnie : Au-delà du Web

fount aspire à laisser les personnages entrer dans votre vie, vivre les vents et la pluie avec vous, et partager la joie.

- Vous pouvez connecter des personnages à des groupes Discord en configurant le Discord Bot Shell intégré, les laissant rire avec des amis ou s'écouter le cœur dans des messages privés.
    ![image](https://github.com/user-attachments/assets/299255c9-eed3-4deb-b433-41b80930cbdb)
    ![image](https://github.com/user-attachments/assets/c9841eba-c010-42a3-afe0-336543ec39a0)

- Vous pouvez également utiliser [fount-pwsh](https://github.com/steve02081504/fount-pwsh) pour que les personnages vous envoient de doux rappels lorsque les commandes du terminal échouent, comme un doux murmure à votre oreille lorsque vous êtes confus.
    ![image](https://github.com/user-attachments/assets/93afee48-93d4-42c7-a5e0-b7f5c93bdee9)

- Même, tant que vous avez un cœur d'exploration, même si vous ne maîtrisez qu'un peu de compétences en programmation, vous pouvez également créer votre propre fount Shell, laissant les personnages aller vers un monde plus vaste, vers n'importe quel endroit que vous imaginez !

### Création : Au-delà du Prompt

Si vous êtes un créateur de personnages, fount vous ouvrira une porte vers des possibilités infinies.

- Vous pouvez utiliser librement la magie du code JavaScript ou TypeScript, libérer votre créativité, personnaliser le processus de génération de prompts et le processus de dialogue du personnage, vous libérer des contraintes de la syntaxe frontend, comme un poète maniant une plume et éclaboussant d'encre, exprimant pleinement ses émotions intérieures.
- Les cartes de personnages peuvent non seulement exécuter du code sans filtrage, mais aussi charger n'importe quel paquet npm et créer des pages HTML personnalisées. La création n'a jamais été aussi libre, comme un peintre étalant librement des couleurs sur une toile et esquissant le monde dans son cœur.
- Si vous le souhaitez, vous pouvez également intégrer diverses ressources dans le personnage, dire adieu aux problèmes de construction de services d'hébergement d'images, et rendre tout à portée de main, comme si vous mettiez le monde entier dans votre poche.

### Extension : Au-delà de la Vue

Dans le monde de fount, tout est hautement modularisé.

- Tant que vous avez une certaine base en programmation, vous pouvez facilement créer et distribuer les modules dont vous avez besoin, tout comme un jardinier cultivant de nouvelles fleurs, ajoutant plus de couleur à ce jardin.
- fount vous encourage à contribuer de votre force à la communauté et à l'avenir, rendant ce monde plus prospère et plus vibrant.

### Résumé

En résumé, fount vous permet d'exécuter des personnages au format fount, qui peuvent avoir diverses capacités ou être appliqués à différents scénarios. Ils peuvent être profonds, vifs, doux ou forts, tout dépend de vous, mon ami ! :)

## Architecture

- Le backend est basé sur Deno, complété par le framework Express, pour construire un squelette solide.
- Le frontend est tissé avec HTML, CSS et JavaScript pour créer une interface magnifique.
