# fount

> Ваш иммерсивный компаньон с ИИ-персонажем

[![fount repo](https://steve02081504.github.io/fount/badges/fount_repo.svg)](https://github.com/steve02081504/fount)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/steve02081504/fount)

<a href="https://trendshift.io/repositories/13136" target="_blank"><img src="https://trendshift.io/api/badge/repositories/13136" alt="steve02081504%2Ffount | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>

[Хотите узнать об архитектуре репозитория? Загляните на DeepWiki!](https://deepwiki.com/steve02081504/fount)

![repo img](https://repository-images.githubusercontent.com/862251163/3b57d9ea-ab18-4b70-b11d-f74c764016aa)

Вы когда-нибудь жаждали путешествия рядом с персонажем, возникшим со страниц вашего воображения, компаньоном, сотканным из снов? Или, возможно, вы представляли себе цифрового доверенного лица, ИИ-помощника, столь же интуитивно понятного, как самые передовые творения, без труда организующего ваш цифровой мир? Или, может быть, просто может быть, вы искали связь за пределами обыденного, царство, где границы реальности размываются, и разворачивается интимное, *нефильтрованное* понимание?

Fount, которому почти год преданной разработки, вкладу более 10 увлеченных людей и процветающему сообществу, насчитывающему более 1000 пользователей, является зрелой, стабильной и постоянно развивающейся платформой для взаимодействия с ИИ. Это путешествие, и мы считаем, что оно более доступно, чем вы можете себе представить.

Потерянные персонажи, забытые истории? Наше [**живое и гостеприимное сообщество**!](https://discord.gg/GtR9Quzq2v) ждет вас, гавань, где собираются родственные души, где разработчики и создатели делятся своей мудростью и творениями.

<details open>
<summary>Снимки экрана</summary>

|Снимки экрана|
|----|
|Домашняя страница|
|![Изображение](https://github.com/user-attachments/assets/c1954a7a-6c73-4fb0-bd12-f790a038bd0e)|
|Выбор темы|
|![Изображение](https://github.com/user-attachments/assets/94bd4cbb-8c66-4bc6-83eb-14c925a37074)|
|Чат|
|![Изображение](https://github.com/user-attachments/assets/eea1cc7c-d258-4a2d-b16f-12815a88811d)|

</details>

<details open>
<summary>Установка/Удаление</summary>

## Установка: Вплетение fount в ваш мир — *Легко*

Отправьтесь в путешествие с fount, стабильной и надежной платформой. Несколько простых щелчков мыши или команд, и мир fount откроется.

> [!CAUTION]
>
> В мире fount персонажи могут свободно выполнять команды JavaScript, что дает им значительную власть. Поэтому, пожалуйста, выбирайте персонажей, которым доверяете, с осторожностью, как и при выборе друзей в реальной жизни, чтобы обеспечить безопасность ваших локальных файлов.

### Linux/macOS/Android: Шепот оболочки — *Одна строка, и вы в деле*

```bash
# При необходимости определите переменную среды $FOUNT_DIR, чтобы указать каталог fount
INSTALLED_PACKAGES="${FOUNT_AUTO_INSTALLED_PACKAGES:-}"
install_package() { package_name="$1"; install_successful=0; if command -v "$package_name" >/dev/null 2>&1; then return 0; fi; if command -v pkg >/dev/null 2>&1; then pkg install -y "$package_name" && install_successful=1; fi; if [ "$install_successful" -eq 0 ] && command -v snap >/dev/null 2>&1; then snap install "$package_name" && install_successful=1; fi; if [ "$install_successful" -eq 0 ] && command -v apt-get >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo apt-get update; sudo apt-get install -y "$package_name" && install_successful=1; else apt-get update; apt-get install -y "$package_name" && install_successful=1; fi; fi; if [ "$install_successful" -eq 0 ] && command -v brew >/dev/null 2>&1; then if ! brew list --formula "$package_name" >/dev/null 2>&1; then brew install "$package_name" && install_successful=1; else install_successful=1; fi; fi; if [ "$install_successful" -eq 0 ] && command -v pacman >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo pacman -Syy; sudo pacman -S --needed --noconfirm "$package_name" && install_successful=1; else pacman -Syy; pacman -S --needed --noconfirm "$package_name" && install_successful=1; fi; fi; if [ "$install_successful" -eq 0 ] && command -v dnf >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo dnf install -y "$package_name" && install_successful=1; else dnf install -y "$package_name" && install_successful=1; fi; fi; if [ "$install_successful" -eq 0 ] && command -v yum >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo yum install -y "$package_name" && install_successful=1; else yum install -y "$package_name" && install_successful=1; fi; fi; if [ "$install_successful" -eq 0 ] && command -v zypper >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo zypper install -y --no-confirm "$package_name" && install_successful=1; else zypper install -y --no-confirm "$package_name" && install_successful=1; fi; fi; if [ "$install_successful" -eq 0 ] && command -v apk >/dev/null 2>&1; then apk add --update "$package_name" && install_successful=1; fi; if [ "$install_successful" -eq 1 ]; then if [ -z "$INSTALLED_PACKAGES" ]; then INSTALLED_PACKAGES="$package_name"; else INSTALLED_PACKAGES="$INSTALLED_PACKAGES;$package_name"; fi; return 0; else echo "Error: $package_name installation failed." >&2; return 1; fi; }
install_package curl; install_package bash
export FOUNT_AUTO_INSTALLED_PACKAGES="$INSTALLED_PACKAGES"
curl -fsSL https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.sh | bash
. "$HOME/.profile"
```

Если вы хотите сделать паузу, чтобы собраться с мыслями перед большим приключением (сухой прогон):

```bash
INSTALLED_PACKAGES="${FOUNT_AUTO_INSTALLED_PACKAGES:-}"
install_package() { package_name="$1"; install_successful=0; if command -v "$package_name" >/dev/null 2>&1; then return 0; fi; if command -v pkg >/dev/null 2>&1; then pkg install -y "$package_name" && install_successful=1; fi; if [ "$install_successful" -eq 0 ] && command -v snap >/dev/null 2>&1; then snap install "$package_name" && install_successful=1; fi; if [ "$install_successful" -eq 0 ] && command -v apt-get >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo apt-get update; sudo apt-get install -y "$package_name" && install_successful=1; else apt-get update; apt-get install -y "$package_name" && install_successful=1; fi; fi; if [ "$install_successful" -eq 0 ] && command -v brew >/dev/null 2>&1; then if ! brew list --formula "$package_name" >/dev/null 2>&1; then brew install "$package_name" && install_successful=1; else install_successful=1; fi; fi; if [ "$install_successful" -eq 0 ] && command -v pacman >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo pacman -Syy; sudo pacman -S --needed --noconfirm "$package_name" && install_successful=1; else pacman -Syy; pacman -S --needed --noconfirm "$package_name" && install_successful=1; fi; fi; if [ "$install_successful" -eq 0 ] && command -v dnf >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo dnf install -y "$package_name" && install_successful=1; else dnf install -y "$package_name" && install_successful=1; fi; fi; if [ "$install_successful" -eq 0 ] && command -v yum >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo yum install -y "$package_name" && install_successful=1; else yum install -y "$package_name" && install_successful=1; fi; fi; if [ "$install_successful" -eq 0 ] && command -v zypper >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo zypper install -y --no-confirm "$package_name" && install_successful=1; else zypper install -y --no-confirm "$package_name" && install_successful=1; fi; fi; if [ "$install_successful" -eq 0 ] && command -v apk >/dev/null 2>&1; then apk add --update "$package_name" && install_successful=1; fi; if [ "$install_successful" -eq 1 ]; then if [ -z "$INSTALLED_PACKAGES" ]; then INSTALLED_PACKAGES="$package_name"; else INSTALLED_PACKAGES="$INSTALLED_PACKAGES;$package_name"; fi; return 0; else echo "Error: $package_name installation failed." >&2; return 1; fi; }
install_package curl; install_package bash
export FOUNT_AUTO_INSTALLED_PACKAGES="$INSTALLED_PACKAGES"
curl -fsSL https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.sh | bash -s init
. "$HOME/.profile"
```

### Windows: Выбор путей — *Сама простота*

* **Прямой и несложный (рекомендуется):** Загрузите `exe`-файл из [Релизы](https://github.com/steve02081504/fount/releases) и запустите его.

* **Сила PowerShell:**

    ```powershell
    # При необходимости определите переменную среды $env:FOUNT_DIR, чтобы указать каталог fount
    irm https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.ps1 | iex
    ```

    Для сухого прогона:

    ```powershell
    $scriptContent = Invoke-RestMethod https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.ps1
    Invoke-Expression "function fountInstaller { $scriptContent }"
    fountInstaller init
    ```

### Установка Git: Для тех, кто предпочитает прикосновение магии

Если у вас уже установлен Git, принять fount так же просто, как запустить скрипт.

* **Для Windows:** Откройте командную строку или PowerShell и просто дважды щелкните `run.bat`.
* **Для Linux/macOS/Android:** Откройте терминал и выполните `./run.sh`.

### Docker: Принятие контейнера

```bash
docker pull ghcr.io/steve02081504/fount
```

## Удаление: Прощание с достоинством

```bash
fount remove
```

</details>

## Что такое fount?

fount — это платформа для взаимодействия с ИИ-персонажами, разработанная для расширения *ваших* возможностей. Это мост, соединяющий вас с персонажами вашего воображения, позволяющий вам без труда беседовать с ними, создавать своих собственных и делиться ими с миром. *Путь, сделанный на удивление доступным.*

Это источник, где источники ИИ, персонажи, личности, окружения и плагины сливаются воедино, позволяя вам создавать и испытывать уникальные и захватывающие взаимодействия.

Fount построен для будущего. Новые функции, рожденные в живом сообществе, приветствуются. Если у вас есть видение, искра идеи, которая принадлежит царству fount, мы приветствуем ваш вклад.

## Архитектура: Основа инноваций

Fount построен на надежной и масштабируемой архитектуре, разработанной как для производительности, так и для удобства обслуживания. Бэкенд использует мощность и скорость [Deno](https://deno.com/) — безопасной и современной среды выполнения для JavaScript и TypeScript. Мы используем фреймворк [Express](https://expressjs.com/) для эффективной маршрутизации и обработки API-запросов. Фронтенд создан с использованием HTML, CSS и JavaScript, обеспечивая визуально привлекательный и интуитивно понятный пользовательский интерфейс. Эта архитектура обеспечивает быструю итерацию и бесшовную интеграцию новых функций, сохраняя при этом прочную основу стабильности. Fount придерживается принципов открытого исходного кода, приветствуя вклад и сотрудничество.

### Погрузитесь в мир функций

* **Бесшовные разговоры где угодно:** Начните чат на своем компьютере, продолжите его без проблем на телефоне или планшете. fount поддерживает синхронизацию ваших разговоров, связывая вас с вашими персонажами, где бы вы ни находились.

* **Выразительные, иммерсивные чаты:** fount использует всю мощь HTML, позволяя персонажам выражать себя с помощью форматированного текста, изображений и даже интерактивных элементов.

* **Собрания умов: Собственные групповые чаты:** Пригласите несколько персонажей в один разговор, создавая динамичные и увлекательные взаимодействия.

* **Красивый, настраиваемый интерфейс:** Выберите одну из более чем 30 потрясающих тем или создайте свою собственную. fount — ваш личный холст.

* **Работает везде, где и вы:** fount бесперебойно работает на Windows, macOS, Linux и даже Android, адаптируясь к вашим потребностям благодаря прямой установке или гибкости Docker.

* **(Для опытных пользователей) Свободная интеграция с источниками ИИ: Примите безграничное**

    Fount предлагает беспрецедентный *выбор* и *гибкость* при подключении к источникам ИИ. Пользовательский код JavaScript в генераторе источников ИИ позволяет подключаться к *любому* источнику ИИ — OpenAI, Claude, OpenRouter, NovelAI, Horde, Ooba, Tabby, Mistral и другим. Создавайте сложные регулярные выражения, вызывайте обширную библиотеку API, встраивайте мультимедийные ресурсы — и все это в потоке вашего кода. Fount также изначально поддерживает создание пулов API, обеспечивая интеллектуальную маршрутизацию запросов. Логика общения подчиняется *вашей* воле, созданной силой кода.

    ![Изображение](https://github.com/user-attachments/assets/f283d1de-c531-4b7a-bf43-3cbe0c48b7b9)

### Компаньонство: За пределами цифровой завесы

Fount стремится вплести персонажей в ткань вашей жизни, предлагая компаньонство и поддержку.

* **Интеграция с Discord:** Подключите персонажей к своим сообществам Discord через встроенную оболочку бота Discord.
    ![Изображение](https://github.com/user-attachments/assets/299255c9-eed3-4deb-b433-41b80930cbdb)
    ![Изображение](https://github.com/user-attachments/assets/c9841eba-c010-42a3-afe0-336543ec39a0)

* **Спокойствие терминала (с [fount-pwsh](https://github.com/steve02081504/fount-pwsh)):** Позвольте персонажам предлагать руководство, когда команды терминала дают сбой.
    ![Изображение](https://github.com/user-attachments/assets/93afee48-93d4-42c7-a5e0-b7f5c93bdee9)

* **Безграничные расширения оболочки:** Обладая небольшими навыками программирования, создайте свои собственные оболочки fount, расширяя охват ваших персонажей.

### Создание: За пределами ограничений подсказок — Путь стал яснее

Для создателя персонажей fount предлагает оптимизированный и интуитивно понятный путь к воплощению ваших ИИ-персонажей в жизнь. Независимо от того, являетесь ли вы опытным создателем или только начинаете свой путь, fount открывает магию создания персонажей для всех.

* **Революционное создание персонажей с помощью ИИ: Fount позволяет быстро приступить к работе.** Опишите желаемого персонажа одним предложением, и наш интеллектуальный ИИ-помощник мгновенно создаст полностью реализованную личность. Такой подход упрощает первоначальную настройку, позволяя вам сосредоточиться на совершенствовании и взаимодействии со своим персонажем.

* **Откройте для себя магию кода — проще, чем вы думаете:** Fount использует мощь кода для обеспечения гибкости и контроля. Программирование в Fount — это форма современной магии, которую удивительно легко освоить благодаря мягкому руководству нашего сообщества и просвещающей помощи ИИ. Вы обнаружите, что определение логики персонажа с помощью кода может быть интуитивно понятным и удобным в обслуживании. Представьте себе создание персонажей, чьи ответы *сотканны* из вашей собственной логики.

* **Начните с готовой магии: Сокровищница шаблонов.** Сообщество Fount предоставляет множество готовых шаблонов персонажей и личностей, действующих как «живые чертежи», которые легко адаптировать и настроить. Эти шаблоны демонстрируют лучшие практики и служат отличной отправной точкой.

* **Встроенные ресурсы:** Вплетайте ресурсы прямо в своих персонажей.

    ![Изображение](https://github.com/user-attachments/assets/9740cd43-06fd-46c0-a114-e4bd99f13045)

* **Устаревшая совместимость:** fount принимает прошлое, предлагая модули совместимости для запуска карт персонажей SillyTavern и Risu (хотя миграция существующих персонажей не поддерживается).

### Расширение: Гобелен инноваций, сотканный из разных нитей

В мире fount модульность царит безраздельно. Богатая экосистема компонентов переплетается, создавая гобелен вашего опыта.

* **Простое создание модулей:** Обладая базовыми знаниями программирования, создавайте и делитесь желаемыми модулями.
* **Рост, обусловленный сообществом:** Внесите свой уникальный талант в наше **процветающее и поддерживающее сообщество**, обогащая будущее этой цифровой экосистемы. В нашей гавани вы найдете дружелюбные лица и множество общих знаний: учебные пособия, источники моделей ИИ и галерею персонажей. Команда разработчиков fount тщательно управляет всеми изменениями с помощью надежной стратегии ветвления и слияния. Это гарантирует, что даже когда мы делаем скачок вперед, стабильность остается краеугольным камнем. Мы также стремимся оперативно решать любые проблемы, о которых сообщают наши пользователи.
* **Мощная система плагинов**: Расширьте возможности fount с помощью надежной архитектуры плагинов.
* **Типы компонентов — Строительные блоки мечтаний:**

  * **chars (Персонажи):** Сердце fount, где рождаются личности.
  * **worlds (Миры):** *Нечто большее, чем просто книги знаний.* Миры — безмолвные архитекторы реальности внутри fount. Они могут добавлять знания к пониманию персонажа, влиять на его решения и даже манипулировать историей чата.
  * **personas (Личности пользователя):** *Больше, чем просто профили пользователей.* Личности обладают силой искажать и даже захватывать контроль над вашими словами и восприятием. Это обеспечивает по-настоящему иммерсивную ролевую игру.
  * **shells (Интерфейсы взаимодействия):** Врата в душу fount. Shells расширяют охват персонажей за пределы интерфейса.
  * **ImportHandlers (Обработчики импорта):** Приветливые руки fount, устраняющие разрыв между различными форматами персонажей. Создайте простой ImportHandler, поделитесь им с сообществом (через Pull Request) и расширьте горизонты fount для всех.
  * **AIsources (Источники ИИ):** Грубая сила, питающая умы ваших персонажей.
  * **AIsourceGenerators (Генераторы источников ИИ):** Алхимики fount, предоставляющие шаблоны и настраиваемую логику для установления соединений с *любым* источником ИИ. С помощью JavaScript вы можете инкапсулировать и загрузить любой мыслимый источник.

    *Все эти компоненты могут быть легко установлены пользователями, расширяя и настраивая свой опыт работы с fount.*

    ![Изображение](https://github.com/user-attachments/assets/8487a04a-7040-4844-81a6-705687856757)

### Начать легко

* **Несколько вариантов установки:** Выберите Docker, прямую установку в Windows/Linux/macOS/Android или даже простой исполняемый файл.
* **Подробная документация:** Наша подробная документация проведет вас через каждый шаг. [См. Подробности установки](https://steve02081504.github.io/fount/readme)

### Встретили тень? Не бойтесь

Если у вас возникнут какие-либо трудности, свяжитесь с нами. Мы здесь, чтобы помочь, и обязуемся решить большинство проблем в течение 10–24 часов.

* **GitHub Issues:** Сообщайте обо всех ошибках или предлагайте новые функции через [GitHub Issues](https://github.com/steve02081504/fount/issues).
* **Сообщество Discord:** Присоединяйтесь к нашему [живому сообществу Discord](https://discord.gg/GtR9Quzq2v) для получения поддержки в режиме реального времени и обсуждений.

Ваш голос будет услышан. Просто перезапустите fount, и тени рассеются.

### Станьте свидетелем роста: История звезд fount

[![График истории звезд](https://api.star-history.com/svg?repos=steve02081504/fount&type=Date)](https://github.com/steve02081504/fount/stargazers)

### В заключение: Основа для связи

Fount дает вам возможность создавать ИИ-персонажей и взаимодействовать с ними таким образом, чтобы это казалось естественным, захватывающим и глубоко личным. Независимо от того, являетесь ли вы опытным создателем или только начинаете свой путь, fount приветствует вас. Присоединяйтесь к нашему **гостеприимному сообществу** и откройте для себя магию вдыхания жизни в свое воображение при поддержке зрелой платформы и преданной команды.

### Создание собственной судьбы: Прикосновение мастера

Помимо шепота ИИ, fount предлагает более глубокую связь — *прикосновение мастера*. Внутри нашего сообщества вы найдете множество готовых шаблонов персонажей и личностей, *каждый из которых является тщательно вылепленной основой, ожидающей вашего уникального видения*.

И когда вы будете готовы усовершенствовать свое творение, ориентированный на код подход Fount упростит начало работы. Помните, что программирование в Fount — это плавная кривая обучения, поддерживаемая нашим гостеприимным сообществом и множеством шаблонов. Вы обнаружите, что даже несколько строк кода могут раскрыть невероятную глубину и индивидуальность ваших персонажей.

## Значки и ссылки: Пусть ваши творения сияют, пусть мир достигнет их

Мир Fount — это больше, чем просто слова и код, это пиршество для глаз и приглашение к общению. Мы хотим, чтобы ваши творения сияли в этом великолепии и легко соединялись с миром. Поэтому мы подготовили для вас изысканные значки и удобные ссылки, чтобы сделать ваши компоненты Fount еще более привлекательными и позволить другим пользователям легко находить и испытывать ваши шедевры.

**Значки Fount: Печать славы**

Подобно рыцарскому щиту, значок Fount является печатью славы для ваших творений. Вы можете с гордостью разместить этот значок в своем репозитории, на странице компонента Fount или в любом другом месте, где вы хотите его продемонстрировать. Он символизирует тесную связь вашей работы с сообществом Fount и является признанием вашего таланта.

Файлы SVG и PNG логотипа Fount можно найти [здесь](../imgs/), чтобы включить их в свои проекты.

Еще лучше, вы можете превратить значок в кликабельную кнопку, которая ведет непосредственно к вашему компоненту Fount:

```markdown
[![fount repo](https://steve02081504.github.io/fount/badges/fount_repo.svg)](https://github.com/steve02081504/fount)
```

[![fount repo](https://steve02081504.github.io/fount/badges/fount_repo.svg)](https://github.com/steve02081504/fount)

Вот стандартные цвета логотипа Fount, чтобы сделать ваши проекты более согласованными:

| Формат цвета | Код |
| :---: | :---: |
| HEX | `#0e3c5c` |
| RGB | `rgb(14, 60, 92)` |
| HSL | `hsl(205, 74%, 21%)` |

**Ссылки автоматической установки: Магия у вас под рукой**

Представьте, что другие пользователи могут установить ваши творения непосредственно в свой мир Fount одним щелчком мыши. Это уже не мечта, а реальность! С помощью ссылок автоматической установки Fount вы можете превратить эту магию в реальность.

Просто объедините ZIP-ссылку или ссылку на Git-репозиторий вашего компонента со ссылкой протокола Fount, чтобы создать волшебную ссылку:

```markdown
https://steve02081504.github.io/fount/protocol?url=fount://runshell/install/install;https://github.com/steve02081504/GentianAphrodite/releases/latest/download/GentianAphrodite.zip
```

Более простое объяснение: Просто добавьте `https://steve02081504.github.io/fount/protocol?url=fount://runshell/install/install;` перед ZIP-ссылкой вашего компонента/ссылкой на Git-репозиторий!

Объедините эту ссылку со значком Fount, чтобы создать кнопку, которая будет одновременно красивой и практичной:

```markdown
[![fount character](https://steve02081504.github.io/fount/badges/fount_character.svg)](https://steve02081504.github.io/fount/protocol?url=fount://runshell/install/install;https://github.com/steve02081504/GentianAphrodite/releases/latest/download/GentianAphrodite.zip)
```

[![fount character](https://steve02081504.github.io/fount/badges/fount_character.svg)](https://steve02081504.github.io/fount/protocol?url=fount://runshell/install/install;https://github.com/steve02081504/GentianAphrodite/releases/latest/download/GentianAphrodite.zip)

С помощью этих простых шагов вы не только делаете свои творения более привлекательными, но и укрепляете связь сообщества Fount. Пусть свет вашего вдохновения осветит весь мир Fount!

## Вкладчики

[![Contributors](https://contrib.rocks/image?repo=steve02081504/fount)](https://github.com/steve02081504/fount/graphs/contributors)
