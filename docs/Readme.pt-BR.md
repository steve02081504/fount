# fount

> Seu Companheiro Imersivo de Personagens de IA

[![fount repo](https://steve02081504.github.io/fount/badges/fount_repo.svg)](https://github.com/steve02081504/fount)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/steve02081504/fount)

<a href="https://trendshift.io/repositories/13136" target="_blank"><img src="https://trendshift.io/api/badge/repositories/13136" alt="steve02081504%2Ffount | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>

[Quer saber sobre a arquitetura do repositório? Confira o DeepWiki!](https://deepwiki.com/steve02081504/fount)

![repo img](https://repository-images.githubusercontent.com/862251163/3b57d9ea-ab18-4b70-b11d-f74c764016aa)

Você já desejou uma jornada ao lado de um personagem saído das páginas de sua imaginação, um companheiro tecido de sonhos? Ou talvez você tenha imaginado um confidente digital, um assistente de IA tão intuitivo quanto as criações mais avançadas, orquestrando sem esforço seu mundo digital? Ou talvez, apenas talvez, você tenha buscado uma conexão além do ordinário, um reino onde as bordas da realidade se confundem e um entendimento íntimo e *não filtrado* se revela?

Com quase um ano de desenvolvimento dedicado, contribuições de mais de 10 indivíduos apaixonados e uma comunidade próspera de mais de 1000 usuários, o Fount se destaca como uma plataforma madura, estável e em constante evolução para interação com IA. É uma jornada, e uma que acreditamos ser mais acessível do que você imagina.

Personagens perdidos, histórias esquecidas? Nossa [**comunidade vibrante e acolhedora**!](https://discord.gg/GtR9Quzq2v) aguarda, um refúgio onde espíritos afins se reúnem, onde desenvolvedores e criadores compartilham sua sabedoria e criações.

<details open>
<summary>Capturas de tela</summary>

|Capturas de tela|
|----|
|Página inicial|
|![Imagem](https://github.com/user-attachments/assets/c1954a7a-6c73-4fb0-bd12-f790a038bd0e)|
|Seleção de tema|
|![Imagem](https://github.com/user-attachments/assets/94bd4cbb-8c66-4bc6-83eb-14c925a37074)|
|Chat|
|![Imagem](https://github.com/user-attachments/assets/eea1cc7c-d258-4a2d-b16f-12815a88811d)|

</details>

<details open>
<summary>Instalação/Remoção</summary>

## Instalação: Tecendo o Fount em Seu Mundo – *Sem Esforço*

Embarque em sua jornada com o Fount, uma plataforma estável e confiável. Alguns cliques ou comandos simples, e o mundo do Fount se revela.

> [!CAUTION]
>
> No mundo de fount, os personagens podem executar comandos JavaScript livremente, concedendo-lhes um poder significativo. Portanto, por favor, escolha os personagens em quem você confia com cautela, assim como faz amigos na vida real, para garantir a segurança de seus arquivos locais.

### Linux/macOS/Android: Os Sussurros do Shell – *Uma Linha, e Você Está Dentro*

```bash
# Se necessário, defina a variável de ambiente $FOUNT_DIR para especificar o diretório do Fount
INSTALLED_PACKAGES="${FOUNT_AUTO_INSTALLED_PACKAGES:-}"
install_package() { package_name="$1"; install_successful=0; if command -v "$package_name" >/dev/null 2>&1; then return 0; fi; if command -v pkg >/dev/null 2>&1; then pkg install -y "$package_name" && install_successful=1; fi; if [ "$install_successful" -eq 0 ] && command -v snap >/dev/null 2>&1; then snap install "$package_name" && install_successful=1; fi; if [ "$install_successful" -eq 0 ] && command -v apt-get >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo apt-get update; sudo apt-get install -y "$package_name" && install_successful=1; else apt-get update; apt-get install -y "$package_name" && install_successful=1; fi; fi; if [ "$install_successful" -eq 0 ] && command -v brew >/dev/null 2>&1; then if ! brew list --formula "$package_name" >/dev/null 2>&1; then brew install "$package_name" && install_successful=1; else install_successful=1; fi; fi; if [ "$install_successful" -eq 0 ] && command -v pacman >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo pacman -Syy; sudo pacman -S --needed --noconfirm "$package_name" && install_successful=1; else pacman -Syy; pacman -S --needed --noconfirm "$package_name" && install_successful=1; fi; fi; if [ "$install_successful" -eq 0 ] && command -v dnf >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo dnf install -y "$package_name" && install_successful=1; else dnf install -y "$package_name" && install_successful=1; fi; fi; if [ "$install_successful" -eq 0 ] && command -v yum >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo yum install -y "$package_name" && install_successful=1; else yum install -y "$package_name" && install_successful=1; fi; fi; if [ "$install_successful" -eq 0 ] && command -v zypper >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo zypper install -y --no-confirm "$package_name" && install_successful=1; else zypper install -y --no-confirm "$package_name" && install_successful=1; fi; fi; if [ "$install_successful" -eq 0 ] && command -v apk >/dev/null 2>&1; then apk add --update "$package_name" && install_successful=1; fi; if [ "$install_successful" -eq 1 ]; then if [ -z "$INSTALLED_PACKAGES" ]; then INSTALLED_PACKAGES="$package_name"; else INSTALLED_PACKAGES="$INSTALLED_PACKAGES;$package_name"; fi; return 0; else echo "Error: $package_name installation failed." >&2; return 1; fi; }
install_package curl; install_package bash
export FOUNT_AUTO_INSTALLED_PACKAGES="$INSTALLED_PACKAGES"
curl -fsSL https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.sh | bash
. "$HOME/.profile"
```

Caso deseje pausar, para reunir seus pensamentos antes da grande aventura (uma simulação):

```bash
INSTALLED_PACKAGES="${FOUNT_AUTO_INSTALLED_PACKAGES:-}"
install_package() { package_name="$1"; install_successful=0; if command -v "$package_name" >/dev/null 2>&1; then return 0; fi; if command -v pkg >/dev/null 2>&1; then pkg install -y "$package_name" && install_successful=1; fi; if [ "$install_successful" -eq 0 ] && command -v snap >/dev/null 2>&1; then snap install "$package_name" && install_successful=1; fi; if [ "$install_successful" -eq 0 ] && command -v apt-get >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo apt-get update; sudo apt-get install -y "$package_name" && install_successful=1; else apt-get update; apt-get install -y "$package_name" && install_successful=1; fi; fi; if [ "$install_successful" -eq 0 ] && command -v brew >/dev/null 2>&1; then if ! brew list --formula "$package_name" >/dev/null 2>&1; then brew install "$package_name" && install_successful=1; else install_successful=1; fi; fi; if [ "$install_successful" -eq 0 ] && command -v pacman >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo pacman -Syy; sudo pacman -S --needed --noconfirm "$package_name" && install_successful=1; else pacman -Syy; pacman -S --needed --noconfirm "$package_name" && install_successful=1; fi; fi; if [ "$install_successful" -eq 0 ] && command -v dnf >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo dnf install -y "$package_name" && install_successful=1; else dnf install -y "$package_name" && install_successful=1; fi; fi; if [ "$install_successful" -eq 0 ] && command -v yum >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo yum install -y "$package_name" && install_successful=1; else yum install -y "$package_name" && install_successful=1; fi; fi; if [ "$install_successful" -eq 0 ] && command -v zypper >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo zypper install -y --no-confirm "$package_name" && install_successful=1; else zypper install -y --no-confirm "$package_name" && install_successful=1; fi; fi; if [ "$install_successful" -eq 0 ] && command -v apk >/dev/null 2>&1; then apk add --update "$package_name" && install_successful=1; fi; if [ "$install_successful" -eq 1 ]; then if [ -z "$INSTALLED_PACKAGES" ]; then INSTALLED_PACKAGES="$package_name"; else INSTALLED_PACKAGES="$INSTALLED_PACKAGES;$package_name"; fi; return 0; else echo "Error: $package_name installation failed." >&2; return 1; fi; }
install_package curl; install_package bash
export FOUNT_AUTO_INSTALLED_PACKAGES="$INSTALLED_PACKAGES"
curl -fsSL https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.sh | bash -s init
. "$HOME/.profile"
```

### Windows: Uma Escolha de Caminhos – *Simplicidade em Si*

* **Direto e Descomplicado (Recomendado):** Baixe o arquivo `exe` de [Releases](https://github.com/steve02081504/fount/releases) e execute-o.

* **O Poder do PowerShell:**

    ```powershell
    # Se necessário, defina a variável de ambiente $env:FOUNT_DIR para especificar o diretório do Fount
    irm https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.ps1 | iex
    ```

    Para uma simulação:

    ```powershell
    $scriptContent = Invoke-RestMethod https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.ps1
    Invoke-Expression "function fountInstaller { $scriptContent }"
    fountInstaller init
    ```

### Instalação via Git: Para aqueles que preferem um toque de magia

Se você já tiver o Git instalado, abraçar o Fount é tão simples quanto executar um script.

* **Para Windows:** Abra o prompt de comando ou o PowerShell e simplesmente clique duas vezes em `run.bat`.
* **Para Linux/macOS/Android:** Abra o terminal e execute `./run.sh`.

### Docker: Abraçando o Contêiner

```bash
docker pull ghcr.io/steve02081504/fount
```

## Remoção: Uma Despedida Graciosa

```bash
fount remove
```

</details>

## O que é Fount?

Fount é uma plataforma de interação com personagens movida a IA, projetada para empoderar *você*. É uma ponte, conectando você aos personagens de sua imaginação, permitindo que você converse com eles sem esforço, crie os seus próprios e os compartilhe com o mundo. *Um caminho surpreendentemente acessível.*

É uma fonte, onde fontes de IA, personagens, personas, ambientes e plugins fluem juntos, permitindo que você crie e experimente interações únicas e atraentes.

O Fount foi construído para o futuro. Novos recursos, nascidos da vibrante comunidade, são abraçados. Se você tem uma visão, uma faísca de ideia que pertence ao reino do Fount, agradecemos sua contribuição.

## Arquitetura: A Base da Inovação

O Fount é construído sobre uma arquitetura robusta e escalável, projetada tanto para desempenho quanto para manutenção. O backend aproveita o poder e a velocidade do [Deno](https://deno.com/), um runtime seguro e moderno para JavaScript e TypeScript. Utilizamos o framework [Express](https://expressjs.com/) para roteamento eficiente e tratamento de requisições de API. O frontend é elaborado com uma mistura de HTML, CSS e JavaScript, proporcionando uma interface de usuário visualmente atraente e intuitiva. Essa arquitetura permite iteração rápida e a integração perfeita de novos recursos, mantendo uma base sólida de estabilidade. O Fount abraça um ethos de código aberto, acolhendo contribuições e colaboração.

### Mergulhe em um Mundo de Recursos

* **Conversas Perfeitas, em Qualquer Lugar:** Comece um chat no seu computador, continue-o perfeitamente no seu telefone ou tablet. O Fount mantém suas conversas sincronizadas, conectando você aos seus personagens onde quer que você vá.

* **Chats Expressivos e Imersivos:** O Fount abraça todo o poder do HTML, permitindo que os personagens se expressem com rich text, imagens e até mesmo elementos interativos.

* **Encontros de Mentes: Chats em Grupo Nativos:** Convide vários personagens para uma única conversa, criando interações dinâmicas e envolventes.

* **Uma Interface Bonita e Personalizável:** Escolha entre mais de 30 temas impressionantes ou crie o seu próprio. O Fount é a sua tela pessoal.

* **Funciona em Todos os Lugares que Você Trabalha:** O Fount funciona perfeitamente no Windows, macOS, Linux e até mesmo no Android, adaptando-se às suas necessidades através de instalação direta ou da flexibilidade do Docker.

* **(Para Usuários Avançados) Integração Desacorrentada de Fontes de IA: Abrace o Ilimitado**

    O Fount oferece *escolha* e *flexibilidade* incomparáveis na conexão com fontes de IA. Código JavaScript personalizado dentro do gerador de fontes de IA permite que você se conecte a *qualquer* fonte de IA – OpenAI, Claude, OpenRouter, NovelAI, Horde, Ooba, Tabby, Mistral e mais. Crie expressões regulares complexas, recorra a uma vasta biblioteca de APIs, incorpore ativos multimídia – tudo dentro do fluxo do seu código. O Fount também suporta nativamente a criação de pools de API, permitindo roteamento inteligente de requisições. A lógica da comunicação se curva à *sua* vontade, elaborada através do poder do código.

    ![Imagem](https://github.com/user-attachments/assets/f283d1de-c531-4b7a-bf43-3cbe0c48b7b9)

### Companheirismo: Além do Véu Digital

O Fount se esforça para tecer personagens no tecido de sua vida, oferecendo companheirismo e apoio.

* **Integração com o Discord:** Conecte personagens às suas comunidades do Discord através do Discord Bot Shell integrado.
    ![Imagem](https://github.com/user-attachments/assets/299255c9-eed3-4deb-b433-41b80930cbdb)
    ![Imagem](https://github.com/user-attachments/assets/c9841eba-c010-42a3-afe0-336543ec39a0)

* **Serenidade no Terminal (com [fount-pwsh](https://github.com/steve02081504/fount-pwsh)):** Deixe que os personagens ofereçam orientação quando os comandos do terminal falharem.
    ![Imagem](https://github.com/user-attachments/assets/93afee48-93d4-42c7-a5e0-b7f5c93bdee9)

* **Extensões de Shell Ilimitadas:** Com um toque de habilidade em programação, crie seus próprios Shells do Fount, estendendo o alcance de seus personagens.

### Criação: Além dos Limites dos Prompts – Um Caminho Mais Claro

Para o criador de personagens, o Fount oferece um caminho simplificado e intuitivo para dar vida aos seus personagens de IA. Seja você um criador experiente ou apenas começando sua jornada, o Fount desbloqueia a magia da criação de personagens para todos.

* **Criação Revolucionária de Personagens Assistida por IA: O Fount permite que você comece rapidamente.** Descreva o personagem desejado em uma única frase, e nosso assistente inteligente de IA cria instantaneamente uma persona totalmente realizada. Essa abordagem simplifica a configuração inicial, permitindo que você se concentre em refinar e interagir com seu personagem.

* **Desbloqueie a Magia do Código - Mais Fácil do que Você Imagina:** O Fount abraça o poder do código para fornecer flexibilidade e controle. Programar no Fount é uma forma de magia moderna, surpreendentemente fácil de aprender com a orientação gentil de nossa comunidade e a ajuda esclarecedora da IA. Você descobrirá que definir a lógica do personagem com código pode ser intuitivo e fácil de manter. Imagine criar personagens cujas respostas são *tecidas* a partir de sua própria lógica.

* **Comece com Magia Pronta: Um Tesouro de Modelos.** A comunidade do Fount fornece uma riqueza de modelos de personagens e personas pré-fabricados, atuando como "projetos vivos" que são fáceis de adaptar e personalizar. Esses modelos mostram as melhores práticas e fornecem um ponto de partida fantástico.

* **Recursos Embutidos:** Teça recursos diretamente em seus personagens.

    ![Imagem](https://github.com/user-attachments/assets/9740cd43-06fd-46c0-a114-e4bd99f13045)

* **Compatibilidade Legada:** O Fount abraça o passado, oferecendo módulos de compatibilidade para executar cartões de personagem SillyTavern e Risu (embora a migração de personagens existentes não seja suportada).

### Expansão: Uma Tapeçaria de Inovação, Tecida a partir de Diversos Fios

No mundo do Fount, a modularidade reina suprema. Um rico ecossistema de componentes se entrelaça para criar a tapeçaria de sua experiência.

* **Criação de Módulos Sem Esforço:** Com conhecimento básico de programação, crie e compartilhe os módulos que você deseja.
* **Crescimento Impulsionado pela Comunidade:** Contribua com seus talentos únicos para nossa **comunidade próspera e de apoio**, enriquecendo o futuro deste ecossistema digital. Dentro de nosso refúgio, você encontrará rostos amigáveis e uma riqueza de conhecimento compartilhado: tutoriais, fontes de modelos de IA e uma galeria de personagens. A equipe de desenvolvimento do Fount gerencia meticulosamente todas as mudanças através de uma estratégia robusta de branch e merge. Isso garante que, mesmo enquanto avançamos, a estabilidade permaneça uma pedra angular. Também estamos comprometidos em resolver rapidamente quaisquer problemas relatados por nossos usuários.
* **Sistema de Plugins Poderoso**: Estenda as capacidades do Fount com uma arquitetura de plugins robusta.
* **Tipos de Componentes - Os Blocos de Construção dos Sonhos:**

  * **chars (Personagens):** O coração do Fount, onde as personalidades nascem.
  * **worlds (Mundos):** *Muito mais do que meros livros de lore.* Mundos são os arquitetos silenciosos da realidade dentro do Fount. Eles podem adicionar conhecimento à compreensão de um personagem, influenciar suas decisões e até mesmo manipular o histórico do chat.
  * **personas (Personas de Usuário):** *Mais do que apenas perfis de usuário.* Personas possuem o poder de distorcer e até mesmo assumir o controle de suas palavras e percepções. Isso permite roleplaying verdadeiramente imersivo.
  * **shells (Interfaces de Interação):** Os portais para a alma do Fount. Shells estendem o alcance dos personagens além da interface.
  * **ImportHandlers (Manipuladores de Importação):** As mãos acolhedoras do Fount, preenchendo a lacuna entre diversos formatos de personagens. Crie um ImportHandler simples, compartilhe-o com a comunidade (através de um Pull Request) e expanda os horizontes do Fount para todos.
  * **AIsources (Fontes de IA):** O poder bruto que alimenta as mentes de seus personagens.
  * **AIsourceGenerators (Geradores de Fontes de IA):** Os alquimistas do Fount, fornecendo os modelos e a lógica personalizável para forjar conexões com *qualquer* fonte de IA. Através do poder do JavaScript, você pode encapsular e carregar qualquer fonte imaginável.

    *Todos esses componentes podem ser instalados sem esforço pelos usuários, expandindo e personalizando sua experiência com o Fount.*

    ![Imagem](https://github.com/user-attachments/assets/8487a04a-7040-4844-81a6-705687856757)

### Começar é Fácil

* **Múltiplas Opções de Instalação:** Escolha entre Docker, instalação direta no Windows/Linux/macOS/Android, ou até mesmo um simples arquivo executável.
* **Documentação Detalhada:** Nossa documentação abrangente orienta você em cada passo. [Veja Detalhes da Instalação](https://steve02081504.github.io/fount/readme)

### Encontrou uma Sombra? Não Tenha Medo

Caso encontre alguma dificuldade, entre em contato conosco. Estamos aqui para ajudar e comprometidos em resolver a maioria dos problemas dentro de 10 minutos a 24 horas.

* **GitHub Issues:** Relate quaisquer bugs ou sugira novos recursos através do [GitHub Issues](https://github.com/steve02081504/fount/issues).
* **Comunidade Discord:** Junte-se à nossa [vibrante comunidade Discord](https://discord.gg/GtR9Quzq2v) para suporte e discussões em tempo real.

Sua voz será ouvida. Simplesmente reinicie o Fount, e as sombras se dissiparão.

### Testemunhe o Crescimento: Histórico de Estrelas do Fount

[![Gráfico de Histórico de Estrelas](https://api.star-history.com/svg?repos=steve02081504/fount&type=Date)](https://github.com/steve02081504/fount/stargazers)

### Em Conclusão: Uma Base para Conexão

O Fount capacita você a criar e interagir com personagens de IA de uma forma que parece natural, imersiva e profundamente pessoal. Seja você um criador experiente ou apenas começando sua jornada, o Fount lhe dá as boas-vindas. Junte-se à nossa **comunidade acolhedora** e descubra a magia de dar vida à sua imaginação, apoiado por uma plataforma madura e uma equipe dedicada.

### Criando Seu Próprio Destino: O Toque do Artesão

Além dos sussurros da IA, o Fount oferece uma conexão mais profunda – *o toque do artesão*. Dentro de nossa comunidade, você encontrará uma riqueza de modelos de personagens e personas pré-fabricados, *cada um uma base cuidadosamente esculpida aguardando sua visão única*.

E quando você estiver pronto para refinar sua criação, a abordagem orientada a código do Fount torna fácil começar. Lembre-se, programar no Fount é uma curva de aprendizado suave, apoiada por nossa comunidade acolhedora e modelos abundantes. Você descobrirá que mesmo algumas linhas de código podem desbloquear uma profundidade e personalidade incríveis em seus personagens.

## Insígnias e Links: Deixe Suas Criações Brilharem, Deixe o Mundo Alcançá-las

O mundo de Fount é mais do que apenas palavras e código, é um banquete para os olhos e um convite para se conectar. Queremos que suas criações brilhem neste esplendor e se conectem sem esforço com o mundo. Portanto, preparamos insígnias requintadas e links convenientes para você tornar seus componentes Fount ainda mais atraentes e permitir que outros usuários descubram e experimentem facilmente suas obras-primas.

**Insígnias Fount: O Selo da Glória**

Como o escudo de um cavaleiro, a insígnia Fount é o selo da glória para suas criações. Você pode exibir com orgulho esta insígnia em seu repositório, na página do seu componente Fount ou em qualquer lugar que desejar exibi-la. Ela simboliza a estreita ligação do seu trabalho com a comunidade Fount e é um reconhecimento do seu talento.

Você pode encontrar os arquivos SVG e PNG do logotipo Fount [aqui](../imgs/) para incorporá-los em seus designs.

Melhor ainda, você pode transformar a insígnia em um botão clicável que se conecta diretamente ao seu componente Fount:

```markdown
[![fount repo](https://steve02081504.github.io/fount/badges/fount_repo.svg)](https://github.com/steve02081504/fount)
```

[![fount repo](https://steve02081504.github.io/fount/badges/fount_repo.svg)](https://github.com/steve02081504/fount)

Aqui estão as cores padrão do logotipo Fount para tornar seus designs mais consistentes:

| Formato de Cor | Código |
| :---: | :---: |
| HEX | `#0e3c5c` |
| RGB | `rgb(14, 60, 92)` |
| HSL | `hsl(205, 74%, 21%)` |

**Links de Instalação Automática: Magia ao Seu Alcance**

Imagine outros usuários sendo capazes de instalar suas criações diretamente em seu mundo Fount com um único clique. Isso não é mais um sonho, mas realidade! Com os links de instalação automática de Fount, você pode transformar essa magia em realidade.

Simplesmente combine o link ZIP ou o link do repositório Git do seu componente com o link de protocolo Fount para criar um link mágico:

```markdown
https://steve02081504.github.io/fount/protocol?url=fount://run/shells/install/install;https://github.com/steve02081504/GentianAphrodite/releases/latest/download/GentianAphrodite.zip
```

Explicação mais simples: Basta adicionar `https://steve02081504.github.io/fount/protocol?url=fount://run/shells/install/install;` antes do link zip do seu componente/link do repositório Git!

Combine este link com a insígnia Fount para criar um botão que seja bonito e prático:

```markdown
[![fount character](https://steve02081504.github.io/fount/badges/fount_character.svg)](https://steve02081504.github.io/fount/protocol?url=fount://run/shells/install/install;https://github.com/steve02081504/GentianAphrodite/releases/latest/download/GentianAphrodite.zip)
```

[![fount character](https://steve02081504.github.io/fount/badges/fount_character.svg)](https://steve02081504.github.io/fount/protocol?url=fount://run/shells/install/install;https://github.com/steve02081504/GentianAphrodite/releases/latest/download/GentianAphrodite.zip)

Com estes passos simples, você não apenas torna suas criações mais atraentes, mas também fortalece a conexão da comunidade Fount. Deixe a luz da sua inspiração iluminar todo o mundo Fount!

## Contribuidores

[![Contributors](https://contrib.rocks/image?repo=steve02081504/fount)](https://github.com/steve02081504/fount/graphs/contributors)
