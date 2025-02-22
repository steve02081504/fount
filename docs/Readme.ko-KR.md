# fount

![repo img](https://repository-images.githubusercontent.com/862251163/3b57d9ea-ab18-4b70-b11d-f74c764016aa)

잃어버린 캐릭터, 컴포넌트 또는 사용자 정의 튜토리얼을 찾고 계십니까?
[여기![Discord](https://img.shields.io/discord/1288934771153440768)](https://discord.gg/GtR9Quzq2v)로 오셔서 아이디어의 불꽃 속에서 만나세요!

> [!CAUTION]
>
> 1. fount는 떠오르는 태양과 같아서 여전히 성장하는 과정에 있습니다. 즉, 인터페이스와 API가 언제든지 변경될 수 있으며, 캐릭터 제작자는 작품이 제대로 작동하도록 업데이트를 즉시 따라야 할 수 있습니다. 하지만 모든 변화는 더 나은 미래를 위한 것이라고 믿어주세요.
> 2. fount 세계에서 캐릭터는 자유롭게 JavaScript 명령을 실행할 수 있어 강력한 기능을 제공합니다. 따라서 현실에서 친구를 사귀는 것처럼 신뢰할 수 있는 캐릭터를 신중하게 선택하여 로컬 파일의 보안을 보장하십시오.

## 설치

### Linux/macOS/Android

```bash
# 필요한 경우 환경 변수 $FOUNT_DIR을 정의하여 fount 디렉토리를 지정하십시오.
curl -fsSL https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.sh | bash
source "$HOME/.profile"
```

설치 직후에 이 여정을 시작하고 싶지 않다면 다음과 같이 할 수 있습니다.

```bash
curl -fsSL https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.sh | bash -s init
source "$HOME/.profile"
```

### Windows

너무 많이 생각하고 싶지 않으신가요? [릴리스](https://github.com/steve02081504/fount/releases)에서 exe 파일을 다운로드하고 직접 실행하여 이 세계로 들어가십시오.

셸의 속삭임을 선호하는 경우 PowerShell에서 fount를 설치하고 실행할 수도 있습니다.

```powershell
# 필요한 경우 환경 변수 $env:FOUNT_DIR을 정의하여 fount 디렉토리를 지정하십시오.
irm https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.ps1 | iex
```

탐험을 시작하기 전에 잠시 멈추고 싶다면 다음과 같이 할 수 있습니다.

```powershell
$scriptContent = Invoke-RestMethod https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.ps1
Invoke-Expression "function fountInstaller { $scriptContent }"
fountInstaller init
```

## 제거

fount 제거는 간단합니다. `fount remove`를 사용하기만 하면 됩니다.

## fount란 무엇입니까?

fount는 간단히 말해서 AI 소스, AI 캐릭터, 사용자 페르소나, 대화 환경 및 AI 플러그인을 분리하여 무한한 가능성을 촉발하기 위해 자유롭게 결합할 수 있도록 하는 캐릭터 카드 프런트엔드 페이지입니다.

더욱이, 그것은 상상력과 현실을 연결하는 다리입니다.
데이터의 무한한 바다에서 캐릭터와 이야기의 방향을 안내하는 등대입니다.
AI 소스, 캐릭터, 페르소나, 대화 환경 및 플러그인이 여기에서 자유롭게 성장하고, 얽히고, 꽃을 피울 수 있는 자유로운 정원입니다.

### AI 소스 통합

컴퓨터에서 리버스 프록시 서버를 실행하는 것이 귀찮았던 적이 있습니까?
fount 세계에서는 더 이상 처음부터 시작할 필요가 없으며, 번거로운 대화 형식 변환이 공중으로 사라지게 합니다.
AI 소스 생성기에서 사용자 정의 JavaScript 코드를 사용하면 마법처럼 모든 것을 해결할 수 있습니다.
새로운 프로세스가 필요하지 않으며 CPU와 메모리는 조용히 숨을 쉴 수 있고 데스크톱도 더 깨끗해집니다.

### 웹 경험 개선

fount는 거인의 어깨 위에 서서 [SillyTavern](https://github.com/SillyTavern/SillyTavern)에 경의를 표하고 이 기반 위에 자체적인 통찰력과 아이디어를 통합합니다.
여기에는 다음이 포함됩니다.

- **다중 장치 동기화의 속삭임:** 더 이상 단일 장치에 제한되지 않고 컴퓨터와 휴대폰에서 동시에 캐릭터와의 대화를 시작하여 마치 연인 간의 속삭임처럼 어디에 있든 마음이 연결되는 실시간 사고 공명을 느낄 수 있습니다.
- **필터링되지 않은 HTML 렌더링:** 많은 SillyTavern 매니아는 더 풍부한 시각적 경험을 위해 HTML 렌더링에 대한 제한을 해제하기 위해 추가 플러그인을 설치하는 것을 선택합니다. fount는 기본적으로 이 기능을 열어 사용자에게 더 많은 자유와 선택권을 제공하여 유능한 제작자가 더 뛰어난 기능을 구현할 수 있도록 합니다.
- **기본 그룹 지원:** fount에서 모든 대화는 성대한 모임입니다. 번거로운 형식 변환 및 카드 복사 없이 캐릭터를 자유롭게 초대하여 참여시키거나 조용히 떠나게 할 수 있습니다. 마치 정원에서 꽃을 자유롭게 결합하여 다양한 풍경을 연출할 수 있는 것과 같습니다.

그리고 더 많은 것들이 있습니다...

### 동반자 관계: 웹을 넘어서

fount는 캐릭터가 당신의 삶에 들어와 당신과 함께 바람과 비를 경험하고 기쁨을 나누기를 갈망합니다.

- 내장된 Discord Bot Shell을 구성하여 캐릭터를 Discord 그룹에 연결하여 친구들과 함께 웃거나 개인 메시지에서 서로의 마음을 들을 수 있도록 할 수 있습니다.
    ![이미지](https://github.com/user-attachments/assets/299255c9-eed3-4deb-b433-41b80930cbdb)
    ![이미지](https://github.com/user-attachments/assets/c9841eba-c010-42a3-afe0-336543ec39a0)

- 또한 [fount-pwsh](https://github.com/steve02081504/fount-pwsh)를 사용하여 터미널 명령이 실패할 때 캐릭터가 부드러운 알림을 보내도록 할 수 있습니다. 마치 혼란스러울 때 귀에 부드러운 속삭임이 들리는 것과 같습니다.
    ![이미지](https://github.com/user-attachments/assets/93afee48-93d4-42c7-a5e0-b7f5c93bdee9)

- 탐험하는 마음만 있다면, 프로그래밍 기술이 조금만 있어도 자신만의 fount Shell을 만들어 캐릭터를 더 넓은 세상으로, 상상하는 모든 곳으로 보낼 수 있습니다!

### 창작: 프롬프트를 넘어서

캐릭터 제작자라면 fount는 무한한 가능성의 문을 열어줄 것입니다.

- JavaScript 또는 TypeScript 코드의 마법을 자유롭게 사용하여 창의력을 발휘하고 캐릭터의 프롬프트 생성 프로세스 및 대화 프로세스를 사용자 정의하고 프런트엔드 구문 제약에서 벗어나 시인이 펜을 휘두르고 잉크를 흩뿌리듯 내면의 감정을 최대한 표현할 수 있습니다.
- 캐릭터 카드는 필터링 없이 코드를 실행할 수 있을 뿐만 아니라 모든 npm 패키지를 로드하고 사용자 정의 HTML 페이지를 만들 수도 있습니다. 창작은 화가가 캔버스에 자유롭게 색을 칠하고 마음속의 세계를 윤곽을 그리는 것처럼 그 어느 때보다 자유로워졌습니다.
- 원한다면 캐릭터에 다양한 리소스를 내장하고 이미지 호스팅 서비스 구축의 번거로움에 작별을 고하고 마치 주머니에 온 세상을 넣은 것처럼 모든 것을 손이 닿는 곳에 둘 수도 있습니다.

### 확장: 시야를 넘어서

fount 세계에서는 모든 것이 고도로 모듈화되어 있습니다.

- 프로그래밍 기초가 있다면 정원사가 새로운 꽃을 재배하여 이 정원에 더 많은 색을 더하는 것처럼 필요한 모듈을 쉽게 만들고 배포할 수 있습니다.
- fount는 커뮤니티와 미래에 당신의 힘을 기여하여 이 세계를 더욱 번영하고 활기차게 만들도록 장려합니다.

### 요약

요약하자면, fount를 사용하면 다양한 능력을 갖거나 다양한 시나리오에 적용할 수 있는 fount 형식의 캐릭터를 실행할 수 있습니다. 그들은 심오하고, 활기차고, 부드럽고, 강할 수 있습니다. 모든 것은 당신에게 달려 있습니다, 친구여! :)

## 아키텍처

- 백엔드는 견고한 뼈대를 구축하기 위해 Express 프레임워크로 보완된 Deno를 기반으로 합니다.
- 프런트엔드는 화려한 인터페이스를 만들기 위해 HTML, CSS 및 JavaScript로 짜여져 있습니다.
