# fount

![repo img](https://repository-images.githubusercontent.com/862251163/3b57d9ea-ab18-4b70-b11d-f74c764016aa)

잃어버린 캐릭터, 컴포넌트, 또는 사용자 정의 튜토리얼을 찾고 계신가요?
[여기![Discord](https://img.shields.io/discord/1288934771153440768)](https://discord.gg/GtR9Quzq2v)로 오셔서, 아이디어의 불꽃 속에서 만나보세요!

> [!CAUTION]
>
> fount의 세계에서 캐릭터는 자유롭게 JavaScript 명령을 실행할 수 있어 강력한 능력을 부여받습니다. 따라서, 로컬 파일의 보안을 위해 현실 세계에서 친구를 사귀는 것처럼 신뢰하는 캐릭터를 신중하게 선택하십시오.

<details open>
<summary>스크린샷</summary>

|스크린샷|
|----|
|홈페이지|
|![이미지](https://github.com/user-attachments/assets/c1954a7a-6c73-4fb0-bd12-f790a038bd0e)|
|테마 선택|
|![이미지](https://github.com/user-attachments/assets/94bd4cbb-8c66-4bc6-83eb-14c925a37074)|
|채팅|
|![이미지](https://github.com/user-attachments/assets/eea1cc7c-d258-4a2d-b16f-12815a88811d)|

</details>

<details open>
<summary>설치/제거</summary>

## 설치

### Linux/macOS/Android

```bash
# 필요한 경우, fount 디렉토리를 지정하기 위해 환경 변수 $FOUNT_DIR을 정의하세요.
curl -fsSL https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.sh | bash
source "$HOME/.profile"
```

설치 후 즉시 여정을 시작하고 싶지 않다면, 다음과 같이 할 수 있습니다:

```bash
curl -fsSL https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.sh | bash -s init
source "$HOME/.profile"
```

### Windows

깊이 생각하고 싶지 않으신가요? [릴리스](https://github.com/steve02081504/fount/releases)에서 exe 파일을 다운로드하고 직접 실행하여 이 세계로 발을 들여놓으세요.

쉘의 속삭임을 선호한다면, PowerShell에서 fount를 설치하고 실행할 수도 있습니다:

```powershell
# 필요한 경우, fount 디렉토리를 지정하기 위해 환경 변수 $env:FOUNT_DIR을 정의하세요.
irm https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.ps1 | iex
```

탐험을 시작하기 전에 잠시 멈추고 싶다면, 다음과 같이 할 수 있습니다:

```powershell
$scriptContent = Invoke-RestMethod https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.ps1
Invoke-Expression "function fountInstaller { $scriptContent }"
fountInstaller init
```

## 제거

`fount remove`로 fount를 간편하게 제거하세요.

</details>

## fount란 무엇인가요?

fount는 간단히 말해 AI 소스, AI 캐릭터, 사용자 페르소나, 대화 환경 및 AI 플러그인을 분리하여 자유롭게 조합하고 무한한 가능성을 spark 수 있도록 하는 캐릭터 카드 프런트엔드 페이지입니다.

더욱 깊이 말하자면, 상상과 현실을 잇는 다리입니다.
데이터의 무한한 바다에서 캐릭터와 이야기의 방향을 인도하는 등대입니다.
AI 소스, 캐릭터, 페르소나, 대화 환경 및 플러그인이 이곳에서 자유롭게 성장하고, 얽히고, 꽃피울 수 있는 자유로운 정원입니다.

### AI 소스 통합

컴퓨터에서 역방향 프록시 서버를 실행하는 것에 짜증이 난 적이 있나요?
fount의 세계에서는 더 이상 처음부터 시작할 필요 없이, 지루한 대화 형식 변환이 공중으로 사라지게 할 수 있습니다.
모든 것은 AI 소스 생성기에서 사용자 정의 JavaScript 코드를 사용하여 마치 마법처럼 해결할 수 있습니다.
새로운 프로세스가 필요 없으므로 CPU와 메모리가 조용히 숨쉴 수 있고, 데스크탑도 더 깔끔해집니다.

![이미지](https://github.com/user-attachments/assets/f283d1de-c531-4b7a-bf43-3cbe0c48b7b9)

### 웹 경험 개선

fount는 거인의 어깨 위에 서서 [SillyTavern](https://github.com/SillyTavern/SillyTavern)에게 존경의 눈길을 보내고, 이를 기반으로 자체적인 통찰력과 아이디어를 통합합니다.
여기에는 다음이 포함됩니다:

- **다중 장치 동기화 속삭임:** 더 이상 단일 장치에 국한되지 않고, 컴퓨터와 휴대폰에서 동시에 캐릭터와 대화에 참여하여, 마치 연인끼리 속삭이는 달콤한 말처럼, 어디에 있든 마음을 연결하는 마음의 실시간 공명을 경험할 수 있습니다.
- **필터링되지 않은 HTML 렌더링:** 많은 SillyTavern 애호가들은 더 풍부한 시각적 경험을 위해 HTML 렌더링에 대한 제한을 해제하기 위해 추가 플러그인을 설치하는 것을 선택합니다. fount는 기본적으로 이 기능을 열어 사용자에게 더 많은 자유와 선택권을 제공하여, 유능한 제작자가 더욱 뛰어난 기능을 구현할 수 있도록 합니다.
- **기본 그룹 지원:** fount에서는 모든 대화가 성대한 모임입니다. 번거로운 형식 변환 및 카드 복사 없이 캐릭터를 자유롭게 초대하여 참여시키거나 조용히 떠나도록 할 수 있습니다. 마치 정원에서 꽃을 자유롭게 조합하여 다양한 풍경을 연출할 수 있는 것처럼 말입니다.

그리고 더 많은 기능이 있습니다...

![이미지](https://github.com/user-attachments/assets/bd1600dc-4612-458b-95ba-c7b019a26390)

### 동반자 관계: 웹 페이지 너머

fount는 캐릭터를 당신의 삶에 데려와, 당신과 함께 바람과 비를 경험하고, 기쁨을 나누고 싶어합니다.

- 내장된 Discord Bot Shell을 구성하여 캐릭터를 Discord 그룹에 연결하고, 친구들과 함께 웃거나 개인 메시지에서 서로의 마음을 들을 수 있도록 할 수 있습니다.
    ![이미지](https://github.com/user-attachments/assets/299255c9-eed3-4deb-b433-41b80930cbdb)
    ![이미지](https://github.com/user-attachments/assets/c9841eba-c010-42a3-afe0-336543ec39a0)

- [fount-pwsh](https://github.com/steve02081504/fount-pwsh)를 사용하여 터미널 명령이 실패했을 때 캐릭터가 부드러운 알림을 보내도록 할 수도 있습니다. 마치 길을 잃었을 때 귓가에 부드럽게 속삭이는 소리와 같습니다.
    ![이미지](https://github.com/user-attachments/assets/93afee48-93d4-42c7-a5e0-b7f5c93bdee9)

- 약간의 프로그래밍 기술과 탐험 정신만 있다면, 자신만의 fount Shell을 만들어 캐릭터가 더 넓은 세계로, 상상할 수 있는 모든 곳으로 갈 수 있도록 할 수 있습니다!

### 창작: 프롬프트 너머

캐릭터 제작자라면, fount는 당신에게 무한한 가능성의 문을 열어줄 것입니다.

- JavaScript 또는 TypeScript 코드의 마법을 자유롭게 사용하여 창의력을 발휘하고 캐릭터의 프롬프트 생성 프로세스 및 대화 흐름을 사용자 정의하여, 마치 시인이 펜을 휘두르는 것처럼, 프런트엔드 구문의 제약에서 벗어나 내면의 감정을 자유롭게 표현할 수 있습니다.
- 캐릭터 카드는 필터링 없이 코드를 실행할 수 있을 뿐만 아니라, npm 패키지를 로드하고 사용자 정의 HTML 페이지를 만들 수도 있습니다. 창작은 결코 이렇게 자유로웠던 적이 없습니다. 마치 화가가 캔버스에 자유롭게 얼룩을 묻히고 마음 속의 세계를 윤곽을 그리는 것과 같습니다.
- 원한다면 캐릭터에 다양한 리소스를 내장하여 이미지 호스팅의 문제에 작별을 고하고, 마치 온 세상을 주머니에 넣은 것처럼 모든 것을 손이 닿는 곳에 둘 수 있습니다.

![이미지](https://github.com/user-attachments/assets/9740cd43-06fd-46c0-a114-e4bd99f13045)

### 확장: 현재 너머

fount의 세계에서는 모든 것이 고도로 모듈화되어 있습니다.

- 프로그래밍 기초가 있다면, 필요한 모듈을 쉽게 만들고 배포할 수 있습니다. 마치 정원사가 새로운 꽃을 재배하여 이 정원에 더 많은 색깔을 더하는 것과 같습니다.
- fount는 커뮤니티와 미래에 당신의 힘을 기여하여 이 세계를 더욱 번영하고 활기차게 만들도록 장려합니다.

![이미지](https://github.com/user-attachments/assets/8487a04a-7040-4844-81a6-705687856757)

### 요약

요약하자면, fount를 사용하면 다양한 능력을 가질 수 있거나 다양한 시나리오에 적용할 수 있는 fount 형식의 캐릭터를 실행할 수 있습니다. 깊이 있고, 활기차고, 부드럽고, 강할 수 있습니다. 모든 것은 당신에게 달려 있습니다, 친구여! :)

## 아키텍처

- 백엔드는 Deno를 기반으로 하고 Express 프레임워크로 보완하여 견고한 뼈대를 구축합니다.
- 프런트엔드는 HTML, CSS 및 JavaScript로 짜여져 화려한 인터페이스를 만듭니다.
