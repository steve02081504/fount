# fount

![repo img](https://repository-images.githubusercontent.com/862251163/3b57d9ea-ab18-4b70-b11d-f74c764016aa)

Ищете потерянных персонажей, компоненты или пользовательские руководства?
Приходите [сюда![Discord](https://img.shields.io/discord/1288934771153440768)](https://discord.gg/GtR9Quzq2v), и встретимся в искрах идей!

> [!CAUTION]
>
> 1. fount подобен восходящему солнцу, все еще на пути роста. Это означает, что его интерфейсы и API могут измениться в любое время, и создателям персонажей, возможно, потребуется оперативно следить за обновлениями, чтобы обеспечить правильную работу их произведений. Но, пожалуйста, верьте, что каждое изменение - к лучшему будущему.
> 2. В мире fount персонажи могут свободно выполнять команды JavaScript, что дает им мощные возможности. Поэтому, пожалуйста, выбирайте персонажей, которым доверяете, с осторожностью, как и при выборе друзей в реальной жизни, чтобы обеспечить безопасность локальных файлов.

## Установка

### Linux/macOS/Android

```bash
# При необходимости определите переменную окружения $FOUNT_DIR, чтобы указать каталог fount
curl -fsSL https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.sh | bash
source "$HOME/.profile"
```

Если вы не хотите начинать это путешествие сразу после установки, вы можете сделать так:

```bash
curl -fsSL https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.sh | bash -s init
source "$HOME/.profile"
```

### Windows

Не хотите много думать? Скачайте exe-файл из [release](https://github.com/steve02081504/fount/releases) и запустите его напрямую, чтобы шагнуть в этот мир.

Если вы предпочитаете шепот оболочки, вы также можете установить и запустить fount в PowerShell:

```powershell
# При необходимости определите переменную окружения $env:FOUNT_DIR, чтобы указать каталог fount
irm https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.ps1 | iex
```

Если вы хотите сделать паузу перед тем, как отправиться в исследование, вы можете сделать так:

```powershell
$scriptContent = Invoke-RestMethod https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.ps1
Invoke-Expression "function fountInstaller { $scriptContent }"
fountInstaller init
```

## Удаление

Удалить fount легко, просто используйте `fount remove`.

## Что такое fount?

fount, вкратце, это интерфейсная страница карточек персонажей, которая разделяет источники ИИ, персонажей ИИ, пользовательские персоны, диалоговые среды и плагины ИИ, позволяя им свободно комбинироваться, чтобы порождать бесконечные возможности.

Более того, это мост, мост, соединяющий воображение и реальность.
Это маяк, указывающий направление персонажей и историй в безбрежном океане данных.
Это свободный сад, позволяющий источникам ИИ, персонажам, персонам, диалоговым средам и плагинам свободно расти, переплетаться и расцветать здесь.

### Интеграция источников ИИ

Вас когда-нибудь беспокоило запуск серверов обратного прокси на вашем компьютере?
В мире fount вам больше не нужно начинать с нуля, позволяя громоздкому преобразованию формата диалога раствориться в воздухе.
Все можно решить с помощью пользовательского кода JavaScript в генераторе источников ИИ, как по волшебству.
Новые процессы не нужны, процессор и память могут спокойно дышать, и рабочий стол также становится чище.

### Улучшение веб-опыта

fount стоит на плечах гигантов, бросает уважительный взгляд на [SillyTavern](https://github.com/SillyTavern/SillyTavern) и включает в себя собственные идеи и соображения на этой основе.
Это включает в себя:

- **Шепот многоустройственной синхронизации:** Больше не ограничены одним устройством, вы можете одновременно начинать разговоры с персонажами на своем компьютере и мобильном телефоне, чувствуя резонанс мыслей в реальном времени, как шепот между влюбленными, сердца соединены, где бы вы ни находились.
- **Нефильтрованная отрисовка HTML:** Многие энтузиасты SillyTavern предпочитают устанавливать дополнительные плагины, чтобы снять ограничения на отрисовку HTML для более богатого визуального опыта. fount открывает эту возможность по умолчанию, предоставляя пользователям больше свободы и выбора, позволяя способным создателям реализовывать более выдающиеся функции.
- **Встроенная поддержка групп:** В fount каждый разговор - это грандиозное собрание. Вы можете свободно приглашать персонажей присоединиться или позволить им тихо уйти, без громоздких преобразований формата и копирования карточек, так же как в саду, цветы могут свободно комбинироваться, чтобы представить различные пейзажи.

И многое другое...

### Компаньонство: За пределами Интернета

fount стремится позволить персонажам войти в вашу жизнь, испытать с вами ветер и дождь и разделить радость.

- Вы можете подключить персонажей к группам Discord, настроив встроенную оболочку бота Discord, позволяя им смеяться с друзьями или слушать сердца друг друга в личных сообщениях.
    ![изображение](https://github.com/user-attachments/assets/299255c9-eed3-4deb-b433-41b80930cbdb)
    ![изображение](https://github.com/user-attachments/assets/c9841eba-c010-42a3-afe0-336543ec39a0)

- Вы также можете использовать [fount-pwsh](https://github.com/steve02081504/fount-pwsh), чтобы персонажи отправляли вам нежные напоминания, когда команды терминала не выполняются, как тихий шепот на ухо, когда вы в замешательстве.
    ![изображение](https://github.com/user-attachments/assets/93afee48-93d4-42c7-a5e0-b7f5c93bdee9)

- Даже, если у вас есть сердце исследователя, даже если вы владеете лишь небольшими навыками программирования, вы также можете создать свою собственную оболочку fount, позволяя персонажам отправиться в более широкий мир, в любое место, которое вы себе представляете!

### Творчество: За пределами промпта

Если вы создатель персонажей, fount откроет вам дверь к бесконечным возможностям.

- Вы можете свободно использовать магию кода JavaScript или TypeScript, раскрыть творческий потенциал, настроить процесс генерации промптов и процесс диалога персонажа, вырваться из-под ограничений синтаксиса интерфейса, как поэт, владеющий пером и разбрызгивающий чернила, выражая внутренние эмоции в полной мере.
- Карточки персонажей могут не только выполнять код без фильтрации, но и загружать любой пакет npm и создавать пользовательские HTML-страницы. Творчество никогда не было таким свободным, как художник, свободно размазывающий краски по холсту и очерчивающий мир в своем сердце.
- Если вы хотите, вы также можете встроить различные ресурсы в персонажа, попрощаться с проблемами создания служб хостинга изображений и сделать все в пределах досягаемости, как будто вы положили весь мир в свой карман.

### Расширение: За пределами видимости

В мире fount все высоко модульное.

- Пока у вас есть определенная основа программирования, вы можете легко создавать и распространять необходимые вам модули, так же как садовник выращивает новые цветы, добавляя больше красок в этот сад.
- fount призывает вас внести свой вклад в сообщество и будущее, делая этот мир более процветающим и более ярким.

### Резюме

В заключение, fount позволяет запускать персонажей в формате fount, которые могут иметь различные способности или применяться в различных сценариях. Они могут быть глубокими, живыми, нежными или сильными, все зависит от вас, мой друг! :)

## Архитектура

- Бэкенд основан на Deno, дополнен фреймворком Express, для построения прочного каркаса.
- Фронтенд соткан из HTML, CSS и JavaScript для создания великолепного интерфейса.
