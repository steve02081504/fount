# fount

![repo img](https://repository-images.githubusercontent.com/862251163/3b57d9ea-ab18-4b70-b11d-f74c764016aa)

Procurando por personagens perdidos, componentes ou tutoriais personalizados?
Venha para [aqui![Discord](https://img.shields.io/discord/1288934771153440768)](https://discord.gg/GtR9Quzq2v), e encontre-se em uma faísca de mentes!

> [!CAUTION]
>
> No mundo de fount, os personagens podem executar comandos JavaScript livremente, concedendo-lhes um poder significativo. Portanto, por favor, escolha os personagens em quem você confia com cautela, assim como faz amigos na vida real, para garantir a segurança de seus arquivos locais.

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

## Instalação

### Linux/macOS/Android

```bash
# Se necessário, defina a variável de ambiente $FOUNT_DIR para especificar o diretório fount
curl -fsSL https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.sh | bash
source "$HOME/.profile"
```

Se você preferir não começar a jornada imediatamente após a instalação, você pode fazer isso:

```bash
curl -fsSL https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.sh | bash -s init
source "$HOME/.profile"
```

### Windows

Não quer pensar demais? Baixe o arquivo exe do [release](https://github.com/steve02081504/fount/releases) e execute-o diretamente para entrar neste mundo.

Se você prefere o sussurro do shell, você também pode instalar e executar o fount no PowerShell:

```powershell
# Se necessário, defina a variável de ambiente $env:FOUNT_DIR para especificar o diretório fount
irm https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.ps1 | iex
```

Se você deseja pausar por um momento antes de embarcar em sua exploração, você pode fazer isso:

```powershell
$scriptContent = Invoke-RestMethod https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.ps1
Invoke-Expression "function fountInstaller { $scriptContent }"
fountInstaller init
```

## Remoção

Remova o fount sem esforço com `fount remove`.

</details>

## O que é fount?

fount, em resumo, é uma página frontend de cartão de personagem que desacopla fontes de IA, personagens de IA, personas de usuários, ambientes de conversação e plugins de IA, permitindo que eles sejam livremente combinados e spark infinitas possibilidades.

Para dizer de forma mais profunda, é uma ponte, uma ponte que conecta a imaginação e a realidade.
É um farol, guiando a direção de personagens e histórias no oceano ilimitado de dados.
É um jardim livre, permitindo que fontes de IA, personagens, personas, ambientes de conversação e plugins cresçam, se entrelacem e floresçam livremente aqui.

### Integração de fontes de IA

Já se irritou por ter que executar servidores proxy reversos em seu computador?
No mundo de fount, você não precisa mais começar do zero, deixando a tediosa conversão de formato de diálogo desaparecer no ar.
Tudo pode ser resolvido usando código JavaScript personalizado no gerador de fontes de IA, como mágica.
Nenhum novo processo é necessário, permitindo que sua CPU e memória respirem silenciosamente, e sua área de trabalho fique mais limpa.

![Imagem](https://github.com/user-attachments/assets/f283d1de-c531-4b7a-bf43-3cbe0c48b7b9)

### Melhoria da experiência web

fount está sobre os ombros de gigantes, lançando um olhar respeitoso para [SillyTavern](https://github.com/SillyTavern/SillyTavern), e com base nisso, incorporando seus próprios insights e ideias.
Isso inclui:

- **Sussurros sincronizados multi-dispositivo:** Não mais limitado a um único dispositivo, você pode participar de conversas com personagens simultaneamente em seu computador e celular, experimentando a ressonância em tempo real das mentes, como doces palavras sussurradas entre amantes, conectando corações não importa onde você esteja.
- **Renderização HTML não filtrada:** Muitos entusiastas do SillyTavern optam por instalar plugins adicionais para remover as restrições na renderização HTML para uma experiência visual mais rica. fount abre essa capacidade por padrão, dando aos usuários mais liberdade e escolhas, permitindo que criadores capazes alcancem recursos mais notáveis.
- **Suporte de grupo nativo:** No fount, cada conversa é uma grande reunião. Você pode convidar livremente personagens para se juntarem ou deixá-los sair silenciosamente, sem conversões de formato e cópias de cartão incômodas, assim como em um jardim, as flores podem ser livremente combinadas para apresentar paisagens diferentes.

E mais...

![Imagem](https://github.com/user-attachments/assets/bd1600dc-4612-458b-95ba-c7b019a26390)

### Companheirismo: Além das páginas web

fount anseia por trazer personagens para sua vida, para experimentar com você o vento e a chuva, e compartilhar alegria.

- Você pode conectar personagens a grupos Discord configurando o Discord Bot Shell integrado, permitindo que eles riam com amigos ou ouçam os corações uns dos outros em mensagens privadas.
    ![Imagem](https://github.com/user-attachments/assets/299255c9-eed3-4deb-b433-41b80930cbdb)
    ![Imagem](https://github.com/user-attachments/assets/c9841eba-c010-42a3-afe0-336543ec39a0)

- Você também pode usar [fount-pwsh](https://github.com/steve02081504/fount-pwsh) para fazer com que os personagens lhe enviem lembretes suaves quando os comandos do terminal falharem, como sussurros suaves em seu ouvido quando você está perdido.
    ![Imagem](https://github.com/user-attachments/assets/93afee48-93d4-42c7-a5e0-b7f5c93bdee9)

- Mesmo que você tenha apenas um pouco de habilidade de programação e um coração explorador, você pode criar seu próprio fount Shell, permitindo que os personagens vão para um mundo mais amplo, para qualquer lugar que você possa imaginar!

### Criação: Além do prompt

Se você é um criador de personagens, o fount abrirá uma porta para infinitas possibilidades para você.

- Você pode usar livremente a magia do código JavaScript ou TypeScript para liberar sua criatividade e personalizar o processo de geração de prompts e o fluxo de diálogo do personagem, libertando-se das restrições da sintaxe frontend, como um poeta empunhando sua caneta, expressando livremente as emoções interiores.
- Os cartões de personagem não só podem executar código sem filtragem, mas também podem carregar quaisquer pacotes npm e criar páginas HTML personalizadas. A criação nunca foi tão livre, como um pintor manchando livremente sobre a tela, delineando o mundo em seu coração.
- Se você quiser, você também pode construir vários recursos no personagem, dizendo adeus aos problemas de hospedagem de imagens, tornando tudo ao alcance, como se colocasse o mundo inteiro no seu bolso.

![Imagem](https://github.com/user-attachments/assets/9740cd43-06fd-46c0-a114-e4bd99f13045)

### Expansão: Além do presente

No mundo de fount, tudo é altamente modularizado.

- Contanto que você tenha alguns fundamentos de programação, você pode facilmente criar e distribuir os módulos que você precisa, como um jardineiro cultivando novas flores, adicionando mais cor a este jardim.
- fount encoraja você a contribuir com sua força para a comunidade e o futuro, tornando este mundo mais próspero e vibrante.

![Imagem](https://github.com/user-attachments/assets/8487a04a-7040-4844-81a6-705687856757)

### Resumo

Em resumo, fount permite que você execute personagens em formato fount, que podem ter várias habilidades ou serem aplicados a diferentes cenários. Eles podem ser profundos, animados, gentis ou fortes, tudo depende de você, meu amigo! :)

## Arquitetura

- O backend é baseado em Deno, complementado pelo framework Express, construindo um esqueleto sólido.
- O frontend é tecido com HTML, CSS e JavaScript para criar uma interface magnífica.
