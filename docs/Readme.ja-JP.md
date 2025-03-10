# fount

![repo img](https://repository-images.githubusercontent.com/862251163/3b57d9ea-ab18-4b70-b11d-f74c764016aa)

失われたキャラクター、コンポーネント、カスタムチュートリアルをお探しですか？
[こちらへ![Discord](https://img.shields.io/discord/1288934771153440768)](https://discord.gg/GtR9Quzq2v)へ、知性の火花の中で出会いましょう！

> [!CAUTION]
>
> fountの世界では、キャラクターは自由にJavaScriptコマンドを実行でき、強力な能力を与えられています。そのため、ローカルファイルのセキュリティを確保するために、現実世界で友達を作るのと同じように、信頼できるキャラクターを慎重に選択してください。

<details open>
<summary>スクリーンショット</summary>

|スクリーンショット|
|----|
|ホームページ|
|![画像](https://github.com/user-attachments/assets/c1954a7a-6c73-4fb0-bd12-f790a038bd0e)|
|テーマ選択|
|![画像](https://github.com/user-attachments/assets/94bd4cbb-8c66-4bc6-83eb-14c925a37074)|
|チャット|
|![画像](https://github.com/user-attachments/assets/eea1cc7c-d258-4a2d-b16f-12815a88811d)|

</details>

<details open>
<summary>インストール/削除</summary>

## インストール

### Linux/macOS/Android

```bash
# 必要に応じて、fountディレクトリを指定するために環境変数 $FOUNT_DIR を定義します
curl -fsSL https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.sh | bash
source "$HOME/.profile"
```

インストール後すぐに旅を始めない場合は、次のようにします。

```bash
curl -fsSL https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.sh | bash -s init
source "$HOME/.profile"
```

### Windows

深く考えたくないですか？ [リリース](https://github.com/steve02081504/fount/releases)からexeファイルをダウンロードして直接実行すれば、この世界に入ることができます。

シェルの囁きがお好みの場合は、PowerShellでfountをインストールして実行することもできます。

```powershell
# 必要に応じて、fountディレクトリを指定するために環境変数 $env:FOUNT_DIR を定義します
irm https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.ps1 | iex
```

探検を始める前に少し立ち止まりたい場合は、次のようにします。

```powershell
$scriptContent = Invoke-RestMethod https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.ps1
Invoke-Expression "function fountInstaller { $scriptContent }"
fountInstaller init
```

## 削除

`fount remove` で簡単にfountを削除できます。

</details>

## fountとは？

fountを簡単に言うと、AIソース、AIキャラクター、ユーザーペルソナ、会話環境、AIプラグインを分離し、それらを自由に組み合わせて無限の可能性を spark できるキャラクターカードのフロントエンドページです。

さらに深く言えば、それは橋であり、想像力と現実を結びつける橋です。
それは灯台であり、データの無限の海の中でキャラクターとストーリーの方向を導きます。
それは自由な庭であり、AIソース、キャラクター、ペルソナ、会話環境、プラグインがここで自由に成長し、絡み合い、花開くことを可能にします。

### AIソース統合

コンピューターでリバースプロキシサーバーを実行することにうんざりしたことはありませんか？
fountの世界では、面倒な対話形式の変換を消し去り、ゼロから始める必要はもうありません。
すべては、AIソースジェネレーターのカスタムJavaScriptコードを使用して、まるで魔法のように解決できます。
新しいプロセスは必要なく、CPUとメモリは静かに呼吸でき、デスクトップもすっきりします。

![画像](https://github.com/user-attachments/assets/f283d1de-c531-4b7a-bf43-3cbe0c48b7b9)

### ウェブ体験の向上

fountは巨人の肩の上に立ち、[SillyTavern](https://github.com/SillyTavern/SillyTavern)に敬意を表し、これに基づいて、独自の洞察とアイデアを取り入れています。
これには以下が含まれます。

- **マルチデバイス同期の囁き:** 単一のデバイスに限定されなくなり、コンピューターと携帯電話で同時にキャラクターとの会話に参加でき、まるで恋人同士がささやく甘い言葉のように、どこにいても心を繋ぎ、心のリアルタイムな共鳴を体験できます。
- **フィルタリングされていないHTMLレンダリング:** 多くのSillyTavern愛好家は、より豊かな視覚体験を得るためにHTMLレンダリングの制限を解除する追加のプラグインをインストールすることを選択します。 fountはデフォルトでこの機能を公開し、ユーザーにより多くの自由と選択肢を与え、有能なクリエイターがより優れた機能を実現できるようにします。
- **ネイティブグループサポート:** fountでは、すべての会話が盛大な集まりです。面倒な形式変換やカードコピーなしに、キャラクターを自由に招待して参加させたり、静かに去らせたりすることができます。まるで庭園のように、花は自由に組み合わせてさまざまな風景を表現できます。

その他にも...

![画像](https://github.com/user-attachments/assets/bd1600dc-4612-458b-95ba-c7b019a26390)

### 仲間：ウェブページを超えて

fountは、キャラクターをあなたの生活に迎え入れ、あなたと一緒に風雨を経験し、喜びを分かち合いたいと願っています。

- 組み込みのDiscord Bot Shellを設定することで、キャラクターをDiscordグループに接続し、友達と笑ったり、プライベートメッセージでお互いの心に耳を傾けたりすることができます。
    ![画像](https://github.com/user-attachments/assets/299255c9-eed3-4deb-b433-41b80930cbdb)
    ![画像](https://github.com/user-attachments/assets/c9841eba-c010-42a3-afe0-336543ec39a0)

- [fount-pwsh](https://github.com/steve02081504/fount-pwsh)を使用して、ターミナルコマンドが失敗した場合にキャラクターから優しいリマインダーを送信してもらうこともできます。まるで迷子になったときに耳元で優しく囁かれるようなものです。
    ![画像](https://github.com/user-attachments/assets/93afee48-93d4-42c7-a5e0-b7f5c93bdee9)

- プログラミングスキルが少しと探求心さえあれば、独自のfount Shellを作成し、キャラクターをより広い世界へ、想像できる場所ならどこへでも送り出すことができます！

### 創造：プロンプトを超えて

あなたがキャラクタークリエイターなら、fountはあなたに無限の可能性への扉を開きます。

- JavaScriptまたはTypeScriptコードの魔法を自由に使用して、創造性を解き放ち、キャラクターのプロンプト生成プロセスと対話フローをカスタマイズし、まるで詩人がペンを振るうように、フロントエンド構文の制約から解放され、内なる感情を自由に表現できます。
- キャラクターカードは、フィルタリングなしでコードを実行できるだけでなく、任意のnpmパッケージをロードしたり、カスタムHTMLページを作成したりすることもできます。創造はかつてないほど自由になりました。まるで画家がキャンバスに自由に塗りつけ、心の中の世界を描き出すかのようです。
- 必要に応じて、さまざまなリソースをキャラクターに組み込み、画像ホスティングのトラブルに別れを告げ、まるで世界全体をポケットに入れたかのように、すべてを手の届く範囲にすることができます。

![画像](https://github.com/user-attachments/assets/9740cd43-06fd-46c0-a114-e4bd99f13045)

### 拡張：現在を超えて

fountの世界では、すべてが高度にモジュール化されています。

- プログラミングの基礎知識があれば、必要なモジュールを簡単に作成および配布できます。まるで庭師が新しい花を栽培し、この庭にさらに彩りを加えるようにです。
- fountは、コミュニティと未来にあなたの力を貢献し、この世界をより豊かで活気に満ちたものにすることを奨励します。

![画像](https://github.com/user-attachments/assets/8487a04a-7040-4844-81a6-705687856757)

### まとめ

要約すると、fountを使用すると、さまざまな能力を持つ可能性のある、またはさまざまなシナリオに適用できるfount形式のキャラクターを実行できます。彼らは深く、活発で、優しく、または強いかもしれません。すべてはあなた次第です、私の友人！:)

## アーキテクチャ

- バックエンドはDenoをベースにしており、Expressフレームワークで補完され、堅牢なスケルトンを構築しています。
- フロントエンドは、HTML、CSS、JavaScriptで織り上げられ、豪華なインターフェイスを作成します。
