# fount

![repo img](https://repository-images.githubusercontent.com/862251163/3b57d9ea-ab18-4b70-b11d-f74c764016aa)

Procurando por personagens perdidos, componentes ou tutoriais personalizados?
Venha [aqui![Discord](https://img.shields.io/discord/1288934771153440768)](https://discord.gg/GtR9Quzq2v), e encontre-se nas faíscas de ideias!

> [!CAUTION]
>
> 1. fount é como o sol nascente, ainda em seu caminho de crescimento. Isso significa que suas interfaces e APIs podem mudar a qualquer momento, e os criadores de personagens podem precisar acompanhar as atualizações prontamente para garantir que seus trabalhos funcionem corretamente. Mas, por favor, acredite que cada mudança é para um futuro melhor.
> 2. No mundo de fount, os personagens podem executar livremente comandos JavaScript, o que lhes confere capacidades poderosas. Portanto, escolha os personagens em quem você confia com cautela, assim como faz amigos na vida real, para garantir a segurança dos arquivos locais.

## Instalação

### Linux/macOS

```bash
# Se necessário, defina a variável de ambiente $FOUNT_DIR para especificar o diretório fount
curl -fsSL https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.sh | bash
source "$HOME/.profile"
```

Se você não quiser começar esta jornada imediatamente após a instalação, você pode fazer isso:

```bash
curl -fsSL https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.sh | bash -s init
source "$HOME/.profile"
```

### Windows

Não quer pensar muito? Baixe o arquivo exe de [release](https://github.com/steve02081504/fount/releases) e execute-o diretamente para entrar neste mundo.

Se você prefere o sussurro do shell, você também pode instalar e executar fount no PowerShell:

```powershell
# Se necessário, defina a variável de ambiente $env:FOUNT_DIR para especificar o diretório fount
irm https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.ps1 | iex
```

Se você quiser pausar por um momento antes de embarcar em sua exploração, você pode fazer isso:

```powershell
$scriptContent = Invoke-RestMethod https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.ps1
Invoke-Expression "function fountInstaller { $scriptContent }"
fountInstaller init
```

## Remoção

Remover o fount é fácil, basta usar `fount remove`.

## O que é fount?

fount, em resumo, é uma página frontend de cartão de personagem que desacopla fontes de IA, personagens de IA, personas de usuário, ambientes de diálogo e plugins de IA, permitindo que eles sejam livremente combinados para gerar infinitas possibilidades.

Além disso, é uma ponte, uma ponte que conecta imaginação e realidade.
É um farol, guiando a direção de personagens e histórias no oceano ilimitado de dados.
É um jardim livre, permitindo que fontes de IA, personagens, personas, ambientes de diálogo e plugins cresçam, se entrelacem e floresçam livremente aqui.

### Integração de Fontes de IA

Já se incomodou em executar servidores proxy reversos em seu computador?
No mundo de fount, você não precisa mais começar do zero, deixando a incômoda conversão de formato de diálogo desaparecer no ar.
Tudo pode ser resolvido usando código JavaScript personalizado no gerador de fontes de IA, como mágica.
Nenhum novo processo é necessário, CPU e memória podem respirar silenciosamente, e a área de trabalho também fica mais limpa.

### Melhoria da Experiência Web

fount está nos ombros de gigantes, lança um olhar respeitoso para [SillyTavern](https://github.com/SillyTavern/SillyTavern) e incorpora seus próprios insights e ideias sobre esta base.
Isso inclui:

- **Sussurros de sincronização multi-dispositivo:** Não mais limitado por um único dispositivo, você pode iniciar simultaneamente conversas com personagens em seu computador e telefone celular, sentindo a ressonância em tempo real dos pensamentos, como sussurros entre amantes, corações conectados onde quer que você esteja.
- **Renderização HTML não filtrada:** Muitos entusiastas de SillyTavern optam por instalar plugins adicionais para remover as restrições na renderização HTML para uma experiência visual mais rica. fount abre essa capacidade por padrão, dando aos usuários mais liberdade e escolha, permitindo que criadores capazes implementem recursos mais notáveis.
- **Suporte nativo a grupos:** Em fount, cada conversa é uma grande reunião. Você pode convidar livremente personagens para participar ou deixá-los sair discretamente, sem conversões de formato e cópia de cartões incômodas, assim como em um jardim, as flores podem ser livremente combinadas para apresentar diferentes paisagens.

E mais...

### Companheirismo: Além da Web

fount anseia por deixar os personagens entrarem em sua vida, experimentar vento e chuva com você e compartilhar alegria.

- Você pode conectar personagens a grupos Discord configurando o Discord Bot Shell embutido, permitindo que eles riam com amigos ou ouçam os corações uns dos outros em mensagens privadas.
    ![imagem](https://github.com/user-attachments/assets/299255c9-eed3-4deb-b433-41b80930cbdb)
    ![imagem](https://github.com/user-attachments/assets/c9841eba-c010-42a3-afe0-336543ec39a0)

- Você também pode usar [fount-pwsh](https://github.com/steve02081504/fount-pwsh) para que os personagens enviem lembretes suaves quando os comandos do terminal falharem, como um sussurro suave em seu ouvido quando você está confuso.
    ![imagem](https://github.com/user-attachments/assets/93afee48-93d4-42c7-a5e0-b7f5c93bdee9)

- Mesmo, desde que você tenha um coração de exploração, mesmo que domine apenas um pouco de habilidade de programação, você também pode criar seu próprio fount Shell, deixando os personagens irem para um mundo mais amplo, para qualquer lugar que você imaginar!

### Criação: Além do Prompt

Se você é um criador de personagens, fount abrirá uma porta para infinitas possibilidades para você.

- Você pode usar livremente a magia do código JavaScript ou TypeScript, liberar a criatividade, personalizar o processo de geração de prompts e o processo de diálogo do personagem, libertar-se das restrições da sintaxe frontend, como um poeta empunhando uma caneta e respingando tinta, expressando emoções internas ao máximo.
- Os cartões de personagens não só podem executar código sem filtragem, mas também carregar qualquer pacote npm e criar páginas HTML personalizadas. A criação nunca foi tão livre, como um pintor espalhando livremente cores em uma tela e esboçando o mundo em seu coração.
- Se você estiver disposto, você também pode construir vários recursos no personagem, dizer adeus aos problemas de construção de serviços de hospedagem de imagens e tornar tudo ao alcance, como se colocasse o mundo inteiro no seu bolso.

### Extensão: Além da Visão

No mundo de fount, tudo é altamente modularizado.

- Contanto que você tenha uma certa base de programação, você pode facilmente criar e distribuir os módulos que você precisa, assim como um jardineiro cultivando novas flores, adicionando mais cor a este jardim.
- fount encoraja você a contribuir com sua força para a comunidade e o futuro, tornando este mundo mais próspero e mais vibrante.

### Resumo

Em resumo, fount permite que você execute personagens no formato fount, que podem ter várias habilidades ou serem aplicados a diferentes cenários. Eles podem ser profundos, animados, gentis ou fortes, tudo depende de você, meu amigo! :)

## Arquitetura

- O backend é baseado em Deno, complementado pelo framework Express, para construir um esqueleto sólido.
- O frontend é tecido com HTML, CSS e JavaScript para criar uma interface magnífica.
