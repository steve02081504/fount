# fount

> Votre Compagnon de Personnage IA Immersif

[![fount repo](https://steve02081504.github.io/fount/badges/fount_repo.svg)](https://github.com/steve02081504/fount)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/steve02081504/fount)
[![Docker Image Size](https://img.shields.io/docker/image-size/steve02081504/fount)](https://github.com/users/steve02081504/packages/container/package/fount)
[![GitHub repo size](https://img.shields.io/github/repo-size/steve02081504/fount)](https://github.com/steve02081504/fount/archive/refs/heads/master.zip)

<a href="https://trendshift.io/repositories/13136" target="_blank"><img src="https://trendshift.io/api/badge/repositories/13136" alt="steve02081504%2Ffount | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>

[Envie d'en savoir plus sur l'architecture du dépôt ? Consultez DeepWiki !](https://deepwiki.com/steve02081504/fount)

![repo img](https://repository-images.githubusercontent.com/862251163/3b57d9ea-ab18-4b70-b11d-f74c764016aa)

Avez-vous déjà aspiré à un voyage aux côtés d'un personnage issu des pages de votre imagination, un compagnon tissé de rêves ? Ou peut-être avez-vous imaginé un confident numérique, un assistant IA aussi intuitif que les créations les plus avancées, orchestrant sans effort votre monde numérique ? Ou peut-être, juste peut-être, avez-vous recherché une connexion au-delà de l'ordinaire, un royaume où les bords de la réalité s'estompent et où une compréhension intime et *non filtrée* se déploie ?

Avec près d'un an de développement dédié, les contributions de plus de 10 personnes passionnées et une communauté florissante de plus de 1000 utilisateurs, Fount se présente comme une plateforme mature, stable et en constante évolution pour l'interaction avec l'IA. C'est un voyage, et nous pensons qu'il est plus accessible que vous ne l'imaginez.

Personnages perdus, histoires oubliées ? Notre [**communauté dynamique et accueillante** !](https://discord.gg/GtR9Quzq2v) vous attend, un havre où les esprits apparentés se rassemblent, où les développeurs et les créateurs partagent leur sagesse et leurs créations.

<details open>
<summary>Captures d'écran</summary>

|Captures d'écran|
|----|
|Page d'accueil|
|![Image](https://github.com/user-attachments/assets/c1954a7a-6c73-4fb0-bd12-f790a038bd0e)|
|Sélection de thème|
|![Image](https://github.com/user-attachments/assets/94bd4cbb-8c66-4bc6-83eb-14c925a37074)|
|Chat|
|![Image](https://github.com/user-attachments/assets/eea1cc7c-d258-4a2d-b16f-12815a88811d)|

</details>

<details open>
<summary>Installation/Suppression</summary>

## Installation : Intégrer fount à votre monde – *Sans effort*

Embarquez pour votre voyage avec fount, une plateforme stable et fiable. Quelques clics ou commandes simples, et le monde de fount se dévoile.

> [!CAUTION]
>
> Dans le monde de fount, les personnages peuvent exécuter librement des commandes JavaScript, ce qui leur confère un pouvoir important. Par conséquent, veuillez choisir avec prudence les personnages auxquels vous faites confiance, tout comme vous vous faites des amis dans la vie réelle, afin de garantir la sécurité de vos fichiers locaux.

### Linux/macOS/Android : Les murmures du shell – *Une ligne, et vous êtes dedans*

```bash
# Si nécessaire, définissez la variable d'environnement $FOUNT_DIR pour spécifier le répertoire fount
INSTALLED_PACKAGES="${FOUNT_AUTO_INSTALLED_PACKAGES:-}"
install_package() { _command_name="$1"; _package_list=${2:-$_command_name}; _has_sudo=""; _installed_pkg_name="" ; if command -v "$_command_name" >/dev/null 2>&1; then return 0; fi; if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then _has_sudo="sudo"; fi; for _package in $_package_list; do if command -v apt-get >/dev/null 2>&1; then $_has_sudo apt-get update -y; $_has_sudo apt-get install -y "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v pacman >/dev/null 2>&1; then $_has_sudo pacman -Syy --noconfirm; $_has_sudo pacman -S --needed --noconfirm "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v dnf >/dev/null 2>&1; then $_has_sudo dnf install -y "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v yum >/dev/null 2>&1; then $_has_sudo yum install -y "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v zypper >/dev/null 2>&1; then $_has_sudo zypper install -y --no-confirm "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v apk >/dev/null 2>&1; then if [ "$(id -u)" -eq 0 ]; then apk add --update "$_package"; else $_has_sudo apk add --update "$_package"; fi; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v brew >/dev/null 2>&1; then if ! brew list --formula "$_package"; then brew install "$_package"; fi; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v pkg >/dev/null 2>&1; then pkg install -y "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v snap >/dev/null 2>&1; then $_has_sudo snap install "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; done; if command -v "$_command_name" >/dev/null 2>&1; then case ";$FOUNT_AUTO_INSTALLED_PACKAGES;" in *";$_installed_pkg_name;"*) ;; *) if [ -z "$FOUNT_AUTO_INSTALLED_PACKAGES" ]; then FOUNT_AUTO_INSTALLED_PACKAGES="$_installed_pkg_name"; else FOUNT_AUTO_INSTALLED_PACKAGES="$FOUNT_AUTO_INSTALLED_PACKAGES;$_installed_pkg_name"; fi; ;; esac; return 0; else echo "Error: Failed to install '$_command_name' from any source." >&2; return 1; fi; }
install_package "bash" "bash gnu-bash"; install_package "curl"
export FOUNT_AUTO_INSTALLED_PACKAGES="$INSTALLED_PACKAGES"
curl -fsSL https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.sh | bash
. "$HOME/.profile"
```

Si vous souhaitez faire une pause, pour rassembler vos pensées avant la grande aventure (une simulation) :

```bash
INSTALLED_PACKAGES="${FOUNT_AUTO_INSTALLED_PACKAGES:-}"
install_package() { _command_name="$1"; _package_list=${2:-$_command_name}; _has_sudo=""; _installed_pkg_name="" ; if command -v "$_command_name" >/dev/null 2>&1; then return 0; fi; if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then _has_sudo="sudo"; fi; for _package in $_package_list; do if command -v apt-get >/dev/null 2>&1; then $_has_sudo apt-get update -y; $_has_sudo apt-get install -y "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v pacman >/dev/null 2>&1; then $_has_sudo pacman -Syy --noconfirm; $_has_sudo pacman -S --needed --noconfirm "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v dnf >/dev/null 2>&1; then $_has_sudo dnf install -y "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v yum >/dev/null 2>&1; then $_has_sudo yum install -y "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v zypper >/dev/null 2>&1; then $_has_sudo zypper install -y --no-confirm "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v apk >/dev/null 2>&1; then if [ "$(id -u)" -eq 0 ]; then apk add --update "$_package"; else $_has_sudo apk add --update "$_package"; fi; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v brew >/dev/null 2>&1; then if ! brew list --formula "$_package"; then brew install "$_package"; fi; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v pkg >/dev/null 2>&1; then pkg install -y "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v snap >/dev/null 2>&1; then $_has_sudo snap install "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; done; if command -v "$_command_name" >/dev/null 2>&1; then case ";$FOUNT_AUTO_INSTALLED_PACKAGES;" in *";$_installed_pkg_name;"*) ;; *) if [ -z "$FOUNT_AUTO_INSTALLED_PACKAGES" ]; then FOUNT_AUTO_INSTALLED_PACKAGES="$_installed_pkg_name"; else FOUNT_AUTO_INSTALLED_PACKAGES="$FOUNT_AUTO_INSTALLED_PACKAGES;$_installed_pkg_name"; fi; ;; esac; return 0; else echo "Error: Failed to install '$_command_name' from any source." >&2; return 1; fi; }
install_package "bash" "bash gnu-bash"; install_package "curl"
export FOUNT_AUTO_INSTALLED_PACKAGES="$INSTALLED_PACKAGES"
curl -fsSL https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.sh | bash -s init
. "$HOME/.profile"
```

### Windows : Un choix de chemins – *La simplicité même*

* **Direct et simple (Recommandé) :** Téléchargez le fichier `.exe` depuis [Releases](https://github.com/steve02081504/fount/releases) et exécutez-le.

* **La puissance de PowerShell :**

    ```powershell
    # Si nécessaire, définissez la variable d'environnement $env:FOUNT_DIR pour spécifier le répertoire fount
    irm https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.ps1 | iex
    ```

    Pour une simulation :

    ```powershell
    $scriptContent = Invoke-RestMethod https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.ps1
    Invoke-Expression "function fountInstaller { $scriptContent }"
    fountInstaller init
    ```

### Installation Git : Pour ceux qui préfèrent une touche de magie

Si Git est déjà installé, adopter fount est aussi simple que d'exécuter un script.

* **Pour Windows :** Ouvrez votre invite de commandes ou PowerShell et double-cliquez simplement sur `run.bat`.
* **Pour Linux/macOS/Android :** Ouvrez votre terminal et exécutez `./run.sh`.

### Docker : Adopter le conteneur

```bash
docker pull ghcr.io/steve02081504/fount
```

## Suppression : Un adieu gracieux

```bash
fount remove
```

</details>

## Qu'est-ce que fount ?

fount est une plateforme d'interaction avec des personnages basée sur l'IA conçue pour *vous* donner du pouvoir. C'est un pont, qui vous relie aux personnages de votre imagination, vous permettant de converser sans effort avec eux, de créer les vôtres et de les partager avec le monde. *Un chemin étonnamment accessible.*

C'est une source, où les sources d'IA, les personnages, les personnalités, les environnements et les plugins convergent, vous permettant de créer et de vivre des interactions uniques et captivantes.

Fount est conçu pour l'avenir. De nouvelles fonctionnalités, issues de la communauté dynamique, sont accueillies favorablement. Si vous avez une vision, une étincelle d'idée qui appartient au royaume de fount, nous accueillons votre contribution.

## Architecture : Le fondement de l'innovation

Fount est construit sur une architecture robuste et évolutive, conçue à la fois pour la performance et la maintenabilité. Le backend exploite la puissance et la vitesse de [Deno](https://deno.com/), un environnement d'exécution sécurisé et moderne pour JavaScript et TypeScript. Nous utilisons le framework [Express](https://expressjs.com/) pour un routage efficace et la gestion des requêtes API. Le frontend est conçu avec un mélange de HTML, CSS et JavaScript, offrant une interface utilisateur visuellement attrayante et intuitive. Cette architecture permet une itération rapide et l'intégration transparente de nouvelles fonctionnalités, tout en maintenant une base solide de stabilité. Fount adopte une philosophie open-source, accueillant les contributions et la collaboration.

### Plongez dans un monde de fonctionnalités

* **Conversations fluides, partout :** Commencez une conversation sur votre ordinateur, continuez-la de manière transparente sur votre téléphone ou votre tablette. fount maintient vos conversations synchronisées, vous connectant à vos personnages où que vous alliez.

* **Chats expressifs et immersifs :** fount adopte toute la puissance du HTML, permettant aux personnages de s'exprimer avec du texte enrichi, des images et même des éléments interactifs.

* **Rassemblements d'esprits : Chats de groupe natifs :** Invitez plusieurs personnages dans une seule conversation, créant des interactions dynamiques et engageantes.

* **Une interface magnifique et personnalisable :** Choisissez parmi plus de 30 thèmes époustouflants, ou créez le vôtre. fount est votre toile personnelle.

* **Fonctionne partout où vous travaillez :** fount fonctionne de manière transparente sur Windows, macOS, Linux et même Android, s'adaptant à vos besoins grâce à une installation directe ou à la flexibilité de Docker.

* **(Pour les utilisateurs avancés) Intégration de sources d'IA libérée : Embrassez l'illimité**

    Fount offre un *choix* et une *flexibilité* inégalés dans la connexion aux sources d'IA. Le code JavaScript personnalisé au sein du générateur de sources d'IA vous permet de vous connecter à *n'importe quelle* source d'IA : OpenAI, Claude, OpenRouter, NovelAI, Horde, Ooba, Tabby, Mistral, et plus encore. Créez des expressions régulières complexes, faites appel à une vaste bibliothèque d'API, intégrez des ressources multimédias, le tout dans le flux de votre code. Fount prend également en charge nativement la création de pools d'API, permettant un routage intelligent des requêtes. La logique de la communication se plie à *votre* volonté, façonnée par la puissance du code.

    ![Image](https://github.com/user-attachments/assets/f283d1de-c531-4b7a-bf43-3cbe0c48b7b9)

### Compagnie : Au-delà du voile numérique

Fount s'efforce de tisser des personnages dans le tissu de votre vie, offrant compagnie et soutien.

* **Intégration Discord/Telegram :** Connectez des personnages à vos communautés Discord/Telegram grâce aux Bot Shells intégrés.
    ![Image](https://github.com/user-attachments/assets/299255c9-eed3-4deb-b433-41b80930cbdb)
    ![Image](https://github.com/user-attachments/assets/c9841eba-c010-42a3-afe0-336543ec39a0)
    ![Image](https://github.com/user-attachments/assets/b83301df-2205-4013-b059-4bced94e5857)

* **Sérénité du terminal (avec [fount-pwsh](https://github.com/steve02081504/fount-pwsh)) :** Laissez les personnages vous guider lorsque les commandes du terminal échouent.
    ![Image](https://github.com/user-attachments/assets/93afee48-93d4-42c7-a5e0-b7f5c93bdee9)

* **Extensions de shell illimitées :** Avec une touche de compétences en programmation, créez vos propres shells fount, étendant la portée de vos personnages.

### Création : Au-delà des limites des prompts – Un chemin plus clair

Pour le créateur de personnages, fount offre un chemin simplifié et intuitif pour donner vie à vos personnages IA. Que vous soyez un créateur chevronné ou que vous commenciez tout juste votre parcours, fount déverrouille la magie de la création de personnages pour tous.

* **Création de personnages révolutionnaire assistée par l'IA : Fount vous permet de démarrer rapidement.** Décrivez le personnage souhaité en une seule phrase, et notre assistant IA intelligent crée instantanément une personnalité pleinement réalisée. Cette approche simplifie la configuration initiale, vous permettant de vous concentrer sur le raffinement et l'interaction avec votre personnage.

* **Débloquez la magie du code - Plus facile que vous ne l'imaginez :** Fount adopte la puissance du code pour offrir flexibilité et contrôle. La programmation dans Fount est une forme de magie moderne, étonnamment facile à apprendre avec les conseils doux de notre communauté et l'aide éclairante de l'IA. Vous constaterez que la définition de la logique des personnages avec du code peut être intuitive et maintenable. Imaginez créer des personnages dont les réponses sont *tissées* à partir de votre propre logique.

* **Commencez avec une magie prête à l'emploi : Une mine de modèles.** La communauté de Fount fournit une multitude de modèles de personnages et de personnalités préfabriqués, agissant comme des « plans vivants » faciles à adapter et à personnaliser. Ces modèles présentent les meilleures pratiques et constituent un point de départ fantastique.

* **Ressources intégrées :** Intégrez des ressources directement dans vos personnages.

    ![Image](https://github.com/user-attachments/assets/9740cd43-06fd-46c0-a114-e4bd99f13045)

* **Intégration Continue (fount-charCI) :** Utilisez [fount-charCI](https://github.com/marketplace/actions/fount-charci) pour protéger le développement de vos personnages. Il exécute automatiquement des tests de manière asynchrone à chaque commit et signale les problèmes en temps réel.
    ![Image](https://github.com/user-attachments/assets/3f6a188d-6643-4d70-8bd1-b75f00c76439)
    ![Image](https://github.com/user-attachments/assets/30eb8374-64c2-41bc-a7d1-f15596352260)

* **Compatibilité héritée :** fount embrasse le passé, offrant des modules de compatibilité pour exécuter les cartes de personnages SillyTavern et Risu (bien que la migration des personnages existants ne soit pas prise en charge).

### Expansion : Une tapisserie d'innovation, tissée de divers fils

Dans le monde de fount, la modularité règne en maître. Un riche écosystème de composants s'entrelace pour créer la tapisserie de votre expérience.

* **Création de modules sans effort :** Avec des connaissances de base en programmation, créez et partagez les modules que vous désirez.
* **Croissance axée sur la communauté :** Contribuez vos talents uniques à notre **communauté florissante et solidaire**, enrichissant l'avenir de cet écosystème numérique. Au sein de notre havre de paix, vous trouverez des visages amicaux et une richesse de connaissances partagées : des tutoriels, des sources de modèles d'IA et une galerie de personnages. L'équipe de développement de fount gère méticuleusement tous les changements grâce à une stratégie robuste de branche et de fusion. Cela garantit que même lorsque nous faisons un bond en avant, la stabilité reste une pierre angulaire. Nous nous engageons également à résoudre rapidement tout problème signalé par nos utilisateurs.
* **Système de plugins puissant** : Étendez les capacités de fount avec une architecture de plugins robuste.
* **Types de composants - Les blocs de construction des rêves :**

  * **chars (Personnages) :** Le cœur de fount, où naissent les personnalités.
  * **worlds (Mondes) :** *Bien plus que de simples livres de connaissances.* Les mondes sont les architectes silencieux de la réalité au sein de fount. Ils peuvent ajouter des connaissances à la compréhension d'un personnage, influencer ses décisions et même manipuler l'historique du chat.
  * **personas (Personnalités utilisateur) :** *Plus que de simples profils d'utilisateur.* Les personnalités possèdent le pouvoir de déformer et même de prendre le contrôle de vos mots et de vos perceptions. Cela permet un jeu de rôle vraiment immersif.
  * **shells (Interfaces d'interaction) :** Les portes d'entrée à l'âme de fount. Les shells étendent la portée des personnages au-delà de l'interface.
  * **ImportHandlers (Gestionnaires d'importation) :** Les mains accueillantes de fount, comblant le fossé entre divers formats de personnages. Créez un ImportHandler simple, partagez-le avec la communauté (via une Pull Request) et élargissez les horizons de fount pour tous.
  * **AIsources (Sources d'IA) :** La puissance brute qui alimente l'esprit de vos personnages.
  * **AIsourceGenerators (Générateurs de sources d'IA) :** Les alchimistes de fount, fournissant les modèles et la logique personnalisable pour forger des connexions avec *n'importe quelle* source d'IA. Grâce à la puissance de JavaScript, vous pouvez encapsuler et charger n'importe quelle source imaginable.

    *Tous ces composants peuvent être installés sans effort par les utilisateurs, élargissant et personnalisant leur expérience fount.*

    ![Image](https://github.com/user-attachments/assets/8487a04a-7040-4844-81a6-705687856757)

### Se lancer est facile

* **Plusieurs options d'installation :** Choisissez entre Docker, l'installation directe sur Windows/Linux/macOS/Android, ou même un simple fichier exécutable.
* **Documentation détaillée :** Notre documentation complète vous guide à chaque étape. [Voir les détails d'installation](https://steve02081504.github.io/fount/readme)

### Vous rencontrez une ombre ? N'ayez crainte

Si vous rencontrez des difficultés, contactez-nous. Nous sommes là pour vous aider et nous nous engageons à résoudre la plupart des problèmes dans un délai de 10 à 24 heures.

* **GitHub Issues :** Signalez tout bogue ou suggérez de nouvelles fonctionnalités via [GitHub Issues](https://github.com/steve02081504/fount/issues).
* **Communauté Discord :** Rejoignez notre [communauté Discord dynamique](https://discord.gg/GtR9Quzq2v) pour obtenir une assistance et des discussions en temps réel.

Votre voix sera entendue. Redémarrez simplement fount, et les ombres se dissiperont.

### Soyez témoin de la croissance : L'historique des étoiles de fount

[![Star History Chart](https://api.star-history.com/svg?repos=steve02081504/fount&type=Date)](https://github.com/steve02081504/fount/stargazers)

### En conclusion : Une base pour la connexion

fount vous permet de créer et d'interagir avec des personnages IA d'une manière naturelle, immersive et profondément personnelle. Que vous soyez un créateur chevronné ou que vous commenciez tout juste votre parcours, fount vous accueille. Rejoignez notre **communauté accueillante** et découvrez la magie de donner vie à votre imagination, soutenue par une plateforme mature et une équipe dévouée.

### Façonnez votre propre destin : La touche de l'artisan

Au-delà des murmures de l'IA, fount offre une connexion plus profonde – *la touche de l'artisan*. Au sein de notre communauté, vous trouverez une multitude de modèles de personnages et de personnalités préfabriqués, *chacun étant une base soigneusement sculptée attendant votre vision unique*.

Et lorsque vous êtes prêt à affiner votre création, l'approche basée sur le code de Fount facilite la prise en main. N'oubliez pas que la programmation dans Fount est une courbe d'apprentissage douce, soutenue par notre communauté accueillante et d'abondants modèles. Vous découvrirez que même quelques lignes de code peuvent débloquer une profondeur et une personnalité incroyables dans vos personnages.

## Badges et Liens : Laissez Vos Créations Briller, Laissez le Monde les Atteindre

Le monde de Fount est plus que de simples mots et codes, c'est un festin pour les yeux et une invitation à se connecter. Nous voulons que vos créations brillent de cet éclat et se connectent sans effort avec le monde. C'est pourquoi nous avons préparé pour vous des badges exquis et des liens pratiques pour rendre vos composants Fount encore plus accrocheurs et permettre aux autres utilisateurs de découvrir et d'expérimenter facilement vos chefs-d'œuvre.

**Badges Fount : Le Sceau de la Gloire**

Tel le bouclier d'un chevalier, le badge Fount est le sceau de la gloire pour vos créations. Vous pouvez fièrement afficher ce badge dans votre dépôt, sur la page de votre composant Fount, ou partout où vous souhaitez le présenter. Il symbolise le lien étroit entre votre travail et la communauté Fount et est une reconnaissance de votre talent.

Vous pouvez trouver les fichiers SVG et PNG du logo Fount [ici](../imgs/) pour les intégrer à vos designs.

Mieux encore, vous pouvez transformer le badge en un bouton cliquable qui renvoie directement à votre composant Fount :

```markdown
[![fount repo](https://steve02081504.github.io/fount/badges/fount_repo.svg)](https://github.com/steve02081504/fount)
```

[![fount repo](https://steve02081504.github.io/fount/badges/fount_repo.svg)](https://github.com/steve02081504/fount)

Voici les couleurs standard du logo Fount pour rendre vos designs plus cohérents :

| Format de Couleur | Code |
| :---: | :---: |
| HEX | `#0e3c5c` |
| RGB | `rgb(14, 60, 92)` |
| HSL | `hsl(205, 74%, 21%)` |

**Liens d'Installation Automatique : La Magie au Bout des Doigts**

Imaginez que d'autres utilisateurs puissent installer vos créations directement dans leur monde Fount en un seul clic. Ce n'est plus un rêve, mais une réalité ! Avec les liens d'installation automatique de Fount, vous pouvez transformer cette magie en réalité.

Combinez simplement le lien ZIP ou le lien du dépôt Git de votre composant avec le lien du protocole Fount pour créer un lien magique :

```markdown
https://steve02081504.github.io/fount/protocol?url=fount://run/shells/install/install;https://github.com/steve02081504/GentianAphrodite/releases/latest/download/GentianAphrodite.zip
```

Explication plus simple : Ajoutez simplement `https://steve02081504.github.io/fount/protocol?url=fount://run/shells/install/install;` avant le lien zip/lien du dépôt Git de votre composant !

Combinez ce lien avec le badge Fount pour créer un bouton à la fois beau et pratique :

```markdown
[![fount character](https://steve02081504.github.io/fount/badges/fount_character.svg)](https://steve02081504.github.io/fount/protocol?url=fount://run/shells/install/install;https://github.com/steve02081504/GentianAphrodite/releases/latest/download/GentianAphrodite.zip)
```

[![fount character](https://steve02081504.github.io/fount/badges/fount_character.svg)](https://steve02081504.github.io/fount/protocol?url=fount://run/shells/install/install;https://github.com/steve02081504/GentianAphrodite/releases/latest/download/GentianAphrodite.zip)

Grâce à ces étapes simples, vous rendez non seulement vos créations plus attrayantes, mais vous renforcez également le lien de la communauté Fount. Laissez la lumière de votre inspiration illuminer le monde entier de Fount !

## Contributeurs

[![Contributors](https://contrib.rocks/image?repo=steve02081504/fount)](https://github.com/steve02081504/fount/graphs/contributors)
