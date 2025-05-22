# fount

> Il tuo compagno AI di ruolo immersivo

[![fount repo](https://steve02081504.github.io/fount/badges/fount_repo.svg)](https://github.com/steve02081504/fount)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/steve02081504/fount)

<a href="https://trendshift.io/repositories/13136" target="_blank"><img src="https://trendshift.io/api/badge/repositories/13136" alt="steve02081504%2Ffount | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>

[Vuoi conoscere l'architettura del repository? Dai un'occhiata a DeepWiki!](https://deepwiki.com/steve02081504/fount)

![repo img](https://repository-images.githubusercontent.com/862251163/3b57d9ea-ab18-4b70-b11d-f74c764016aa)

Hai mai anelato a fiancheggiare un personaggio balzato dall'immaginazione, un caro amico intessuto di sogni? O forse, hai fantasticato su un confidente digitale, un assistente AI intuitivo quanto la più avanzata delle creazioni, capace di dominare con agilità il tuo mondo digitale? Oppure, semplicemente, hai cercato una connessione che trascende l'ordinario, un regno dove i confini della realtà si fanno sfumati, e dove può sbocciare una comprensione profonda, *senza veli*?

Dopo quasi un anno di sviluppo assiduo, unendo gli sforzi di oltre dieci contributori appassionati e una comunità fiorente che vanta più di 1000 utenti, Fount si presenta ora come una piattaforma di interazione AI matura, stabile e in continua evoluzione. È un viaggio, e crediamo che questo viaggio sia più a portata di mano di quanto tu possa immaginare.

Personaggi smarriti, storie dimenticate? La nostra [**comunità vibrante e accogliente!**](https://discord.gg/GtR9Quzq2v) attende il tuo arrivo, un porto sicuro per spiriti affini dove sviluppatori e creatori condividono la loro saggezza e le loro opere.

<details open>
<summary>Schermate</summary>

|Schermate|
|----|
|Pagina Iniziale|
|![Immagine](https://github.com/user-attachments/assets/c1954a7a-6c73-4fb0-bd12-f790a038bd0e)|
|Selezione Tema|
|![Immagine](https://github.com/user-attachments/assets/94bd4cbb-8c66-4bc6-83eb-14c925a37074)|
|Chat|
|![Immagine](https://github.com/user-attachments/assets/eea1cc7c-d258-4a2d-b16f-12815a88811d)|

</details>

<details open>
<summary>Installazione/Disinstallazione</summary>

## Installazione: Intrecciare Fount nel tuo mondo – *Senza sforzo alcuno*

Inizia il tuo viaggio con Fount, una piattaforma stabile e affidabile. Con pochi, semplici clic o comandi, il mondo di Fount si schiuderà lentamente davanti a te.

> [!ATTENZIONE]
>
> Nel mondo di Fount, i personaggi possono eseguire liberamente comandi JavaScript, il che conferisce loro una potente capacità. Pertanto, scegli con cautela i personaggi a cui ti fidi, proprio come faresti nella vita reale quando stringi nuove amicizie, per salvaguardare la sicurezza dei tuoi file locali.

### Linux/macOS/Android: Il sussurro della Shell – *Un singolo comando, un viaggio immediato*

```bash
# Se necessario, definisci la variabile d'ambiente $FOUNT_DIR per specificare la directory di Fount
curl -fsSL https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.sh | bash
source "$HOME/.profile"
```

Se desideri una breve pausa, per raccogliere i pensieri prima della grande avventura (un'anteprima):

```bash
curl -fsSL https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.sh | bash -s init
source "$HOME/.profile"
```

### Windows: Molteplici sentieri, un'unica destinazione – *La via della semplicità suprema*

* **Diretto e puro (raccomandato):** Scarica il file `exe` da [Releases](https://github.com/steve02081504/fount/releases) ed eseguilo.

* **La potenza di PowerShell:**

    ```powershell
    # Se necessario, definisci la variabile d'ambiente $env:FOUNT_DIR per specificare la directory di Fount
    irm https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.ps1 | iex
    ```

    Per un'anteprima:

    ```powershell
    $scriptContent = Invoke-RestMethod https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.ps1
    Invoke-Expression "function fountInstaller { $scriptContent }"
    fountInstaller init
    ```

### Installazione Git: Per coloro che prediligono un tocco di magia

Se hai già installato Git, abbracciare Fount è semplice come eseguire uno script.

* **Per Windows:** Apri il prompt dei comandi o PowerShell e fai semplicemente doppio clic su `run.bat`.
* **Per Linux/macOS/Android:** Apri il terminale ed esegui `./run.sh`.

### Docker: Abbraccia i container

```bash
docker pull ghcr.io/steve02081504/fount
```

## Disinstallazione: Un addio elegante

```bash
fount remove
```

</details>

## Che cos'è Fount?

Fount è una piattaforma di interazione con personaggi basata su AI, concepita per *potenziare te*. È un ponte che ti connette ai personaggi della tua immaginazione, permettendoti di conversare senza sforzo con loro, creare i tuoi e condividerli con il mondo. *Un percorso inaspettatamente agevole da intraprendere.*

È una sorgente dove fonti AI, personaggi, personalità, ambienti e plugin convergono, permettendoti di creare e sperimentare interazioni uniche e coinvolgenti.

Fount è costruito per il futuro. Nuove funzionalità, scaturite da una comunità vibrante, saranno accolte con gioia. Se hai una visione, una scintilla di ispirazione destinata al regno di Fount, il tuo contributo è il benvenuto.

## Architettura: Le fondamenta dell'innovazione

Fount è edificato su un'architettura robusta e scalabile, bilanciando performance e manutenibilità. Il backend sfrutta la potenza e la velocità di [Deno](https://deno.com/), un runtime JavaScript e TypeScript sicuro e moderno. Adottiamo il framework [Express](https://expressjs.com/) per una gestione efficiente del routing e delle richieste API. Il frontend, invece, è stato minuziosamente plasmato da un connubio di HTML, CSS e JavaScript, offrendo un'interfaccia utente gradevole alla vista e intuitiva. Tale architettura consente iterazioni rapide e l'integrazione fluida di nuove funzionalità, pur mantenendo una solida base di stabilità. Fount abbraccia lo spirito open-source, accogliendo contributi e collaborazione.

### Immergiti in un mondo di funzionalità distintive

* **Dialoghi fluidi, ovunque e in qualsiasi momento:** Inizia una chat sul tuo computer, e continua senza interruzioni sul telefono o sul tablet. Fount mantiene le tue conversazioni sincronizzate, permettendoti di restare connesso ai tuoi personaggi ovunque tu sia.

* **Chat espressive e coinvolgenti:** Fount sfrutta appieno la potenza dell'HTML, consentendo ai personaggi di esprimersi attraverso testo formattato, immagini e persino elementi interattivi.

* **Confluenza di pensieri: Chat di gruppo native:** Invita più personaggi a unirsi alla stessa conversazione, creando interazioni dinamiche e avvincenti.

* **Un'interfaccia elegante e personalizzabile:** Scegli tra oltre 30 temi mozzafiato, o crea il tuo. Fount è la tua tela personale.

* **Disponibile ovunque:** Fount funziona senza problemi su Windows, macOS, Linux e persino Android, adattandosi alle tue esigenze con installazione diretta o la flessibilità di Docker.

* **(Per utenti esperti) Integrazione senza briglie delle fonti AI: Abbraccia l'infinito**

    Fount offre una *scelta* e una *flessibilità* ineguagliabili nella connessione alle fonti AI. Il codice JavaScript personalizzato nei generatori di fonti AI ti permette di connetterti a *qualsiasi* fonte AI – OpenAI, Claude, OpenRouter, NovelAI, Horde, Ooba, Tabby, Mistral e molte altre. All'interno del flusso di codice, puoi orchestrare complesse espressioni regolari, invocare vaste librerie API e incorporare risorse multimediali. Inoltre, Fount supporta nativamente la creazione di pool API, consentendo un routing intelligente delle richieste. La logica della comunicazione è affidata alla *tua* volontà, plasmata dalla potenza del codice.

    ![Immagine](https://github.com/user-attachments/assets/f283d1de-c531-4b7a-bf43-3cbe0c48b7b9)

### Compagnia: Oltre le barriere digitali

Fount si adopera per intessere i personaggi nella trama della tua vita, offrendo compagnia e supporto.

* **Integrazione Discord:** Connetti i personaggi alla tua comunità Discord tramite la Shell Discord integrata.
    ![Immagine](https://github.com/user-attachments/assets/299255c9-eed3-4deb-b433-41b80930cbdb)
    ![Immagine](https://github.com/user-attachments/assets/c9841eba-c010-42a3-afe0-336543ec39a0)

* **La quiete del terminale (in combinazione con [fount-pwsh](https://github.com/steve02081504/fount-pwsh)):** Lascia che i personaggi offrano guida quando i comandi del terminale falliscono.
    ![Immagine](https://github.com/user-attachments/assets/93afee48-93d4-42c7-a5e0-b7f5c93bdee9)

* **Estensioni Shell illimitate:** Con un pizzico di abilità di programmazione, crea la tua Shell Fount, estendendo il raggio d'azione dei tuoi personaggi.

### Creazione: Oltre i confini del Prompt – Un sentiero più limpido

Per i creatori di personaggi, Fount offre un percorso semplificato e intuitivo per dare vita ai tuoi personaggi AI. Che tu sia un creatore esperto o stia appena iniziando il tuo viaggio, Fount sblocca la magia della creazione di personaggi per tutti.

* **Creazione di personaggi assistita da AI rivoluzionaria: Fount ti permette di iniziare rapidamente.** Descrivi il personaggio che desideri con una frase, e il nostro assistente AI intelligente creerà immediatamente una personalità completa. Questo approccio semplifica la configurazione iniziale, permettendoti di concentrarti sul perfezionamento e sull'interazione con il tuo personaggio.

* **Sblocca la magia del codice – Più semplice di quanto tu possa immaginare:** Fount abbraccia la potenza del codice per offrire flessibilità e controllo. Programmare in Fount è una magia moderna, sorprendentemente facile da apprendere grazie alla guida attenta della nostra comunità e all'assistenza illuminante dell'AI. Scoprirai che definire la logica di un personaggio tramite codice può essere intuitivo e di facile manutenzione. Immagina di creare personaggi le cui risposte sono intessute dalla *tua* logica.

* **Inizia con la magia pronta all'uso: Un tesoro di modelli.** La comunità di Fount offre una vasta gamma di modelli di personaggi e personalità predefiniti, che fungono da "progetti viventi", facili da adattare e personalizzare. Questi modelli mostrano le migliori pratiche e offrono un eccellente punto di partenza.

* **Risorse incorporate:** Intreccia le risorse direttamente nel tuo personaggio.

    ![Immagine](https://github.com/user-attachments/assets/9740cd43-06fd-46c0-a114-e4bd99f13045)

* **Compatibilità con il passato:** Fount abbraccia il passato, offrendo moduli compatibili per eseguire schede personaggio di SillyTavern e Risu (sebbene la migrazione di personaggi esistenti non sia supportata).

### Estensione: Un arazzo di innovazione, intessuto con fili diversi

Nel mondo di Fount, la modularità regna sovrana. Un ricco ecosistema di componenti si intreccia, creando l'arazzo della tua esperienza.

* **Creazione di moduli senza sforzo:** Con una conoscenza di programmazione basilare, crea e condividi i moduli che desideri.
* **Crescita guidata dalla comunità:** Contribuisci con il tuo talento unico alla nostra **comunità fiorente e solidale**, arricchendo il futuro di questo ecosistema digitale. Nel nostro rifugio, troverai volti amichevoli e una ricchezza di conoscenza condivisa: tutorial, fonti di modelli AI e gallerie di personaggi. Il team di sviluppo di Fount gestisce meticolosamente tutte le modifiche attraverso robuste strategie di branching e merging. Ciò assicura che, anche mentre avanziamo a grandi passi, la stabilità rimanga la pietra angolare. Ci impegniamo anche a risolvere rapidamente qualsiasi problema segnalato dagli utenti.
* **Un potente sistema di plugin**: Estendi le funzionalità di Fount attraverso una robusta architettura di plugin.
* **Tipi di componenti - Le fondamenta del sogno:**
  * **chars (personaggi):** Il cuore di Fount, il luogo di nascita della personalità.
  * **worlds (mondi):** *Molto più che semplici leggende.* I mondi sono gli architetti silenziosi della realtà in Fount. Possono aggiungere conoscenza alla comprensione dei personaggi, influenzare le loro decisioni e persino manipolare la cronologia della chat.
  * **personas (personalità utente):** *Non solo profili utente.* Le personalità detengono il potere di distorcere e persino controllare le tue parole e percezioni. Ciò rende possibile un gioco di ruolo autenticamente immersivo.
  * **shells (interfacce interattive):** Il portale all'anima di Fount. Le Shell estendono la portata dei personaggi oltre l'interfaccia.
  * **ImportHandlers (gestori di importazione):** La mano accogliente di Fount, che colma il divario tra i diversi formati di personaggi. Crea un semplice ImportHandler, condividilo con la comunità (tramite Pull Request), ed espandi l'orizzonte di Fount per tutti.
  * **AIsources (fonti AI):** La forza primordiale che alimenta la mente dei tuoi personaggi.
  * **AIsourceGenerators (generatori di fonti AI):** Gli alchimisti di Fount, che offrono modelli e logiche personalizzabili per stabilire una connessione con *qualsiasi* fonte AI. Attraverso il potere di JavaScript, puoi incapsulare e caricare ogni fonte immaginabile.

    *Tutti questi componenti possono essere facilmente installati dagli utenti, estendendo e personalizzando la loro esperienza Fount.*

    ![Immagine](https://github.com/user-attachments/assets/8487a04a-7040-4844-81a6-705687856757)

### Inizia con facilità

* **Molteplici opzioni di installazione:** Scegli tra Docker, installazione diretta su Windows/Linux/macOS/Android, o persino un semplice eseguibile.
* **Documentazione dettagliata:** La nostra documentazione completa ti guiderà attraverso ogni passo. [Visualizza i dettagli di installazione](https://steve02081504.github.io/fount/readme)

### Incontro con le ombre? Non temere

Se incontri difficoltà, non esitare a contattarci. Siamo sempre pronti ad aiutare e ci impegniamo a risolvere la maggior parte dei problemi entro 10 minuti o 24 ore.

* **GitHub Issues:** Segnala qualsiasi errore o suggerisci nuove funzionalità tramite [GitHub Issues](https://github.com/steve02081504/fount/issues).
* **Comunità Discord:** Unisciti alla nostra [comunità Discord vibrante](https://discord.gg/GtR9Quzq2v) per supporto e discussioni in tempo reale.

La tua voce sarà ascoltata. Basta riavviare Fount, e le ombre si dissolveranno.

### Testimonia la crescita: La storia delle Star di Fount

[![Star History Chart](https://api.star-history.com/svg?repos=steve02081504/fount&type=Date)](https://github.com/steve02081504/fount/stargazers)

### Conclusione: La pietra angolare della connessione

Fount ti consente di creare e interagire con personaggi AI in un modo naturale, profondamente immersivo e squisitamente personalizzato. Che tu sia un creatore esperto o stia appena iniziando il tuo viaggio, Fount ti dà il benvenuto. Unisciti alla nostra **comunità accogliente**, e supportato da una piattaforma matura e da un team dedicato, scopri la magia di infondere vita nella tua immaginazione.

### Plasma il tuo destino: Il tocco dell'artigiano

Oltre i sussurri dell'AI, Fount offre una connessione più profonda – *il tocco dell'artigiano*. Nella nostra comunità, troverai una vasta gamma di modelli di personaggi e personalità predefiniti, *ognuno una base finemente cesellata, in attesa della tua visione unica*.

Quando sarai pronto a perfezionare la tua creazione, l'approccio basato sul codice di Fount ti permette di iniziare con facilità. Ricorda, programmare in Fount è una curva di apprendimento dolce, supportata dalla nostra amichevole comunità e da una ricchezza di modelli. Scoprirai che anche poche righe di codice possono sbloccare una profondità e una personalità incredibili nei tuoi personaggi.

## Stemmi e collegamenti: Lascia che le tue creazioni risplendano, rendendo il mondo a portata di mano

Il mondo di Fount non è solo parole e codice; è un banchetto di visualità e connessione. Desideriamo che le tue creazioni possano risplendere in questo splendore, connettendosi senza sforzo al mondo. Per questo, abbiamo preparato per te stemmi raffinati e collegamenti comodi, per rendere i tuoi componenti Fount ancora più accattivanti, e per permettere ad altri utenti di scoprire ed esperire facilmente i tuoi capolavori.

**Stemma Fount: Il segno della gloria**

Come lo scudo di un cavaliere, lo stemma Fount è il segno glorioso della tua creazione. Puoi esibirlo con orgoglio nel tuo repository, sulla pagina dei componenti Fount, o ovunque desideri mostrarlo. Simboleggia lo stretto legame della tua opera con la comunità Fount, ed è anche un riconoscimento del tuo talento.

Puoi trovare i file SVG e PNG del logo Fount [qui](../imgs/), per integrarli nei tuoi design.

Ancora meglio, puoi trasformare lo stemma in un pulsante cliccabile, collegandolo direttamente al tuo componente Fount:

```markdown
[![fount repo](https://steve02081504.github.io/fount/badges/fount_repo.svg)](https://github.com/steve02081504/fount)
```

[![fount repo](https://steve02081504.github.io/fount/badges/fount_repo.svg)](https://github.com/steve02081504/fount)

Di seguito sono riportati i colori standard del logo Fount, per conferire ai tuoi design una maggiore uniformità:

| Colore formato | Codice |
| :---: | :---: |
| HEX | `#0e3c5c` |
| RGB | `rgb(14, 60, 92)` |
| HSL | `hsl(205, 74%, 21%)` |

**Collegamento per l'installazione automatica: La magia a portata di dito**

Immagina: altri utenti, con un semplice tocco, potranno installare la tua creazione direttamente nel loro mondo Fount. Non è più un sogno, ma una realtà! Attraverso il collegamento di installazione automatica di Fount, puoi rendere questa magia tangibile.

Ti basterà combinare il link ZIP del tuo componente o il link del repository Git con il link del protocollo di Fount, per creare un collegamento magico:

```markdown
https://steve02081504.github.io/fount/protocol?url=fount://runshell/install/install;https://github.com/steve02081504/GentianAphrodite/releases/latest/download/GentianAphrodite.zip
```

Spiegazione più concisa: Aggiungi semplicemente `https://steve02081504.github.io/fount/protocol?url=fount://runshell/install/install;` prima del link ZIP del tuo componente o del link del repository Git!

Unisci questo link allo stemma Fount, per creare un pulsante che sia sia bello che funzionale:

```markdown
[![fount character](https://steve02081504.github.io/fount/badges/fount_character.svg)](https://steve02081504.github.io/fount/protocol?url=fount://runshell/install/install;https://github.com/steve02081504/GentianAphrodite/releases/latest/download/GentianAphrodite.zip)
```

[![fount character](https://steve02081504.github.io/fount/badges/fount_character.svg)](https://steve02081504.github.io/fount/protocol?url=fount://runshell/install/install;https://github.com/steve02081504/GentianAphrodite/releases/latest/download/GentianAphrodite.zip)

Attraverso questi semplici passaggi, non solo renderai le tue creazioni più accattivanti, ma renderai anche la connessione della comunità Fount ancora più stretta. Lascia che la luce della tua ispirazione illumini l'intero mondo di Fount!

## Contributori

[![Contributors](https://contrib.rocks/image?repo=steve02081504/fount)](https://github.com/steve02081504/fount/graphs/contributors)
