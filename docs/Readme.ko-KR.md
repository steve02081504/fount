# fount

> 몰입형 AI 캐릭터 동반자

[![fount repo](https://steve02081504.github.io/fount/badges/fount_repo.svg)](https://github.com/steve02081504/fount)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/steve02081504/fount)

<a href="https://trendshift.io/repositories/13136" target="_blank"><img src="https://trendshift.io/api/badge/repositories/13136" alt="steve02081504%2Ffount | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>

[Wanna know about repo arch? Check out deepwiki!](https://deepwiki.com/steve02081504/fount)

![repo img](https://repository-images.githubusercontent.com/862251163/3b57d9ea-ab18-4b70-b11d-f74c764016aa)

상상 속 페이지에서 튀어나온 캐릭터, 꿈으로 엮은 동반자와 함께하는 여정을 갈망해 본 적이 있나요? 아니면 가장 진보된 창작물처럼 직관적인 디지털 친구, 디지털 세계를 손쉽게 조율하는 AI 비서를 상상해 본 적이 있나요? 아니면 어쩌면, 그저 어쩌면, 평범함을 뛰어넘는 연결, 현실의 경계가 모호해지고 친밀하고 *필터링되지 않은* 이해가 펼쳐지는 영역을 추구했을 수도 있습니다.

거의 1년간의 헌신적인 개발, 10명 이상의 열정적인 개인의 기여, 1000명 이상의 사용자로 구성된 번성하는 커뮤니티를 통해 Fount는 AI 상호 작용을 위한 성숙하고 안정적이며 끊임없이 진화하는 플랫폼으로 자리매김했습니다. 이것은 여정이며, 저희는 이 여정이 상상하시는 것보다 더 쉽게 접근할 수 있다고 믿습니다.

잃어버린 캐릭터, 잊혀진 이야기? 저희의 [**활기차고 환영하는 커뮤니티**!](https://discord.gg/GtR9Quzq2v)가 기다리고 있습니다. 이곳은 동종의 정신이 모이는 안식처이며, 개발자와 제작자 모두 지혜와 창작물을 공유하는 곳입니다.

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

## 설치: Fount를 세상에 직조하기 – *손쉽게*

안정적이고 신뢰할 수 있는 플랫폼인 Fount와 함께 여정을 시작하세요. 몇 번의 간단한 클릭 또는 명령으로 Fount의 세계가 펼쳐집니다.

> [!CAUTION]
>
> fount의 세계에서 캐릭터는 자유롭게 JavaScript 명령을 실행할 수 있어 강력한 능력을 부여받습니다. 따라서, 로컬 파일의 보안을 위해 현실 세계에서 친구를 사귀는 것처럼 신뢰하는 캐릭터를 신중하게 선택하십시오.

### Linux/macOS/Android: 쉘의 속삭임 – *한 줄이면 완료*

```bash
# 필요한 경우 fount 디렉토리를 지정하기 위해 환경 변수 $FOUNT_DIR을 정의합니다.
curl -fsSL https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.sh | bash
source "$HOME/.profile"
```

만약 웅대한 모험(드라이 런) 전에 잠시 멈춰서 생각을 정리하고 싶다면:

```bash
curl -fsSL https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.sh | bash -s init
source "$HOME/.profile"
```

### Windows: 경로 선택 – *단순함 그 자체*

* **직접적이고 복잡하지 않음 (권장):** [릴리스](https://github.com/steve02081504/fount/releases)에서 `exe` 파일을 다운로드하여 실행합니다.

* **PowerShell의 힘:**

    ```powershell
    # 필요한 경우 fount 디렉토리를 지정하기 위해 환경 변수 $env:FOUNT_DIR을 정의합니다.
    irm https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.ps1 | iex
    ```

    드라이 런의 경우:

    ```powershell
    $scriptContent = Invoke-RestMethod https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.ps1
    Invoke-Expression "function fountInstaller { $scriptContent }"
    fountInstaller init
    ```

### Git 설치: 약간의 마법을 선호하는 사람들을 위해

Git이 이미 설치되어 있다면 Fount를 받아들이는 것은 스크립트를 실행하는 것만큼 간단합니다.

* **Windows의 경우:** 명령 프롬프트 또는 PowerShell을 열고 `run.bat`를 더블 클릭하기만 하면 됩니다.
* **Linux/macOS/Android의 경우:** 터미널을 열고 `./run.sh`를 실행합니다.

### Docker: 컨테이너 포용

```bash
docker pull ghcr.io/steve02081504/fount
```

## 제거: 우아한 작별 인사

```bash
fount remove
```

</details>

## Fount란 무엇인가요?

Fount는 *당신*에게 권한을 부여하도록 설계된 AI 기반 캐릭터 상호 작용 플랫폼입니다. Fount는 상상 속 캐릭터와 연결해 주는 다리 역할을 하며, 캐릭터와 손쉽게 대화하고, 자신만의 캐릭터를 만들고, 세상과 공유할 수 있도록 해줍니다. *놀라울 정도로 접근하기 쉬운 길.*

Fount는 AI 소스, 캐릭터, 페르소나, 환경, 플러그인이 함께 흘러들어 독특하고 매력적인 상호 작용을 만들고 경험할 수 있도록 해주는 원천입니다.

Fount는 미래를 위해 구축되었습니다. 활기찬 커뮤니티에서 탄생한 새로운 기능이 수용됩니다. Fount 영역에 속하는 비전, 아이디어의 불꽃이 있다면 기꺼이 기여해 주세요.

## 아키텍처: 혁신의 토대

Fount는 성능과 유지 관리성을 모두 고려하여 설계된 견고하고 확장 가능한 아키텍처를 기반으로 구축되었습니다. 백엔드는 JavaScript 및 TypeScript를 위한 안전하고 현대적인 런타임인 [Deno](https://deno.com/)의 강력한 기능과 속도를 활용합니다. 효율적인 라우팅과 API 요청 처리를 위해 [Express](https://expressjs.com/) 프레임워크를 활용합니다. 프런트엔드는 HTML, CSS, JavaScript를 혼합하여 시각적으로 매력적이고 직관적인 사용자 인터페이스를 제공합니다. 이 아키텍처는 안정성의 강력한 기반을 유지하면서 빠른 반복과 새로운 기능의 원활한 통합을 가능하게 합니다. Fount는 오픈 소스 정신을 받아들이고 기여와 협력을 환영합니다.

### 기능의 세계로 뛰어드세요

* **언제 어디서든 원활한 대화:** 컴퓨터에서 채팅을 시작하고 휴대폰이나 태블릿에서 원활하게 계속하세요. Fount는 대화를 동기화 상태로 유지하여 어디를 가든 캐릭터와 연결해 줍니다.

* **표현력이 풍부하고 몰입감 넘치는 채팅:** Fount는 HTML의 모든 기능을 수용하여 캐릭터가 풍부한 텍스트, 이미지, 심지어 대화형 요소로 자신을 표현할 수 있도록 합니다.

* **마음의 모임: 기본 그룹 채팅:** 단일 대화에 여러 캐릭터를 초대하여 역동적이고 매력적인 상호 작용을 만듭니다.

* **아름답고 맞춤 설정 가능한 인터페이스:** 30개 이상의 멋진 테마 중에서 선택하거나 자신만의 테마를 만드세요. Fount는 개인 캔버스입니다.

* **어디에서든 작동:** Fount는 Windows, macOS, Linux, 심지어 Android에서도 원활하게 실행되며, 직접 설치 또는 Docker의 유연성을 통해 필요에 맞게 조정됩니다.

* **(고급 사용자를 위해) 속박되지 않은 AI 소스 통합: 무한함을 포용하세요**

    Fount는 AI 소스에 연결할 때 타의 추종을 불허하는 *선택*과 *유연성*을 제공합니다. AI 소스 생성기 내의 사용자 정의 JavaScript 코드를 사용하면 OpenAI, Claude, OpenRouter, NovelAI, Horde, Ooba, Tabby, Mistral 등 *모든* AI 소스에 연결할 수 있습니다. 복잡한 정규 표현식을 만들고, 방대한 API 라이브러리를 호출하고, 멀티미디어 자산을 포함하는 등 모든 것이 코드 흐름 내에서 가능합니다. Fount는 기본적으로 API 풀 생성을 지원하여 지능형 요청 라우팅을 가능하게 합니다. 통신 논리는 코드의 힘을 통해 제작된 *당신*의 의지에 따릅니다.

    ![이미지](https://github.com/user-attachments/assets/f283d1de-c531-4b7a-bf43-3cbe0c48b7b9)

### 동반자 관계: 디지털 장막 너머

Fount는 캐릭터를 삶의 구조에 직조하여 동반자 관계와 지원을 제공하기 위해 노력합니다.

* **Discord 통합:** 내장된 Discord Bot Shell을 통해 캐릭터를 Discord 커뮤니티에 연결합니다.
    ![이미지](https://github.com/user-attachments/assets/299255c9-eed3-4deb-b433-41b80930cbdb)
    ![이미지](https://github.com/user-attachments/assets/c9841eba-c010-42a3-afe0-336543ec39a0)

* **터미널 평온함 ([fount-pwsh](https://github.com/steve02081504/fount-pwsh)와 함께):** 터미널 명령이 실패할 때 캐릭터가 지침을 제공하도록 합니다.
    ![이미지](https://github.com/user-attachments/assets/93afee48-93d4-42c7-a5e0-b7f5c93bdee9)

* **무제한 쉘 확장:** 약간의 프로그래밍 기술로 자신만의 Fount Shell을 제작하여 캐릭터의 도달 범위를 확장합니다.

### 창작: 프롬프트의 한계를 넘어서 – 더 명확해진 길

캐릭터 제작자를 위해 Fount는 AI 캐릭터에 생명을 불어넣는 간소화되고 직관적인 경로를 제공합니다. 숙련된 제작자이든 이제 막 여정을 시작하든 Fount는 모든 사람에게 캐릭터 창작의 마법을 열어줍니다.

* **혁신적인 AI 지원 캐릭터 창작: Fount를 사용하면 빠르게 시작할 수 있습니다.** 원하는 캐릭터를 한 문장으로 설명하면 지능형 AI 도우미가 즉시 완전히 구현된 페르소나를 만듭니다. 이 접근 방식은 초기 설정을 간소화하여 캐릭터를 다듬고 상호 작용하는 데 집중할 수 있도록 해줍니다.

* **코드의 마법을 잠금 해제하세요 - 상상하는 것보다 쉽습니다.:** Fount는 유연성과 제어 기능을 제공하기 위해 코드의 힘을 수용합니다. Fount에서 프로그래밍하는 것은 현대 마법의 한 형태이며, 커뮤니티의 부드러운 안내와 AI의 계몽적인 도움으로 놀라울 정도로 배우기 쉽습니다. 코드로 캐릭터 논리를 정의하는 것이 직관적이고 유지 관리하기 쉽다는 것을 알게 될 것입니다. 응답이 자신의 논리에서 *짜여진* 캐릭터를 만드는 것을 상상해 보세요.

* **준비된 마법으로 시작하세요: 템플릿 보물 창고.** Fount 커뮤니티는 사전 제작된 캐릭터 및 페르소나 템플릿을 풍부하게 제공하며, 이러한 템플릿은 쉽게 조정하고 사용자 정의할 수 있는 "살아있는 청사진" 역할을 합니다. 이러한 템플릿은 모범 사례를 보여주고 환상적인 출발점을 제공합니다.

* **내장된 리소스:** 리소스를 캐릭터에 직접 직조합니다.

    ![이미지](https://github.com/user-attachments/assets/9740cd43-06fd-46c0-a114-e4bd99f13045)

* **레거시 호환성:** Fount는 과거를 수용하여 SillyTavern 및 Risu 캐릭터 카드를 실행하기 위한 호환성 모듈을 제공합니다(기존 캐릭터의 마이그레이션은 지원되지 않음).

### 확장: 다양한 스레드로 짜여진 혁신의 태피스트리

Fount 세계에서는 모듈성이 가장 중요합니다. 풍부한 구성 요소 생태계가 얽혀 경험의 태피스트리를 만듭니다.

* **손쉬운 모듈 생성:** 기본 프로그래밍 지식으로 원하는 모듈을 제작하고 공유합니다.
* **커뮤니티 주도 성장:** 이 디지털 생태계의 미래를 풍요롭게 하기 위해 **번성하고 지원적인 커뮤니티**에 고유한 재능을 기여하세요. 저희 안식처에서는 친절한 얼굴과 튜토리얼, AI 모델 소스, 캐릭터 갤러리 등 풍부한 공유 지식을 찾을 수 있습니다. Fount 개발 팀은 강력한 분기 및 병합 전략을 통해 모든 변경 사항을 꼼꼼하게 관리합니다. 이를 통해 저희가 도약하더라도 안정성이 여전히 초석으로 유지되도록 보장합니다. 또한 사용자가 보고한 모든 문제를 신속하게 해결하기 위해 노력하고 있습니다.
* **강력한 플러그인 시스템**: 강력한 플러그인 아키텍처로 Fount 기능을 확장합니다.
* **구성 요소 유형 - 꿈의 빌딩 블록:**

  * **chars (캐릭터):** 개성이 탄생하는 Fount의 심장부입니다.
  * **worlds (세계):** *단순한 배경 지식 책 그 이상입니다.* 세계는 Fount 내 현실의 조용한 건축가입니다. 세계는 캐릭터의 이해에 지식을 추가하고, 결정에 영향을 미치고, 심지어 채팅 기록을 조작할 수도 있습니다.
  * **personas (사용자 페르소나):** *단순한 사용자 프로필 그 이상입니다.* 페르소나는 당신의 말과 인식까지 왜곡하고 심지어 통제할 수 있는 힘을 가지고 있습니다. 이를 통해 진정으로 몰입감 있는 롤플레잉이 가능합니다.
  * **shells (상호 작용 인터페이스):** Fount의 영혼으로 가는 관문입니다. 쉘은 인터페이스를 넘어 캐릭터의 도달 범위를 확장합니다.
  * **ImportHandlers (가져오기 핸들러):** 다양한 캐릭터 형식 간의 격차를 해소하는 Fount의 환영하는 손길입니다. 간단한 ImportHandler를 제작하고 커뮤니티와 공유하고(풀 요청을 통해) 모든 사람을 위해 Fount의 지평을 넓히세요.
  * **AIsources (AI 소스):** 캐릭터의 마음을 불태우는 원시적인 힘입니다.
  * **AIsourceGenerators (AI 소스 생성기):** Fount의 연금술사로, *모든* AI 소스와 연결을 구축하기 위한 템플릿과 사용자 정의 가능한 논리를 제공합니다. JavaScript의 힘을 통해 상상할 수 있는 모든 소스를 캡슐화하고 로드할 수 있습니다.

    *이러한 모든 구성 요소는 사용자가 손쉽게 설치하여 Fount 경험을 확장하고 사용자 정의할 수 있습니다.*

    ![이미지](https://github.com/user-attachments/assets/8487a04a-7040-4844-81a6-705687856757)

### 시작하기는 쉽습니다

* **다중 설치 옵션:** Docker, Windows/Linux/macOS/Android에 직접 설치 또는 간단한 실행 파일 중에서 선택하세요.
* **자세한 설명서:** 포괄적인 설명서가 모든 단계를 안내합니다. [설치 세부 정보 보기](https://steve02081504.github.io/fount/readme)

### 그림자를 만났나요? 두려워하지 마세요

어려움이 발생하면 저희에게 연락해 주세요. 저희는 도움을 드리기 위해 여기 있으며, 대부분의 문제를 10분에서 24시간 이내에 해결하기 위해 노력하고 있습니다.

* **GitHub 이슈:** [GitHub 이슈](https://github.com/steve02081504/fount/issues)를 통해 버그를 보고하거나 새로운 기능을 제안하세요.
* **Discord 커뮤니티:** 실시간 지원 및 토론을 위해 [활기찬 Discord 커뮤니티](https://discord.gg/GtR9Quzq2v)에 참여하세요.

당신의 목소리가 들릴 것입니다. Fount를 다시 시작하기만 하면 그림자가 사라집니다.

### 성장을 목격하세요: Fount의 스타 기록

[![스타 기록 차트](https://api.star-history.com/svg?repos=steve02081504/fount&type=Date)](https://github.com/steve02081504/fount/stargazers)

### 결론: 연결을 위한 토대

Fount는 자연스럽고 몰입감 있으며 매우 개인적으로 느껴지는 방식으로 AI 캐릭터를 만들고 상호 작용할 수 있도록 지원합니다. 숙련된 제작자이든 이제 막 여정을 시작하든 Fount는 여러분을 환영합니다. **환영하는 커뮤니티**에 가입하여 성숙한 플랫폼과 헌신적인 팀의 지원을 받아 상상력에 생명을 불어넣는 마법을 발견하세요.

### 자신의 운명 만들기: 장인의 손길

AI의 속삭임 너머 Fount는 더 깊은 연결, 즉 *장인의 손길*을 제공합니다. 저희 커뮤니티 내에서 사전 제작된 캐릭터 및 페르소나 템플릿을 풍부하게 찾을 수 있습니다. *각각은 당신의 독특한 비전을 기다리는 세심하게 조각된 토대입니다*.

그리고 창작물을 다듬을 준비가 되면 Fount의 코드 기반 접근 방식으로 쉽게 시작할 수 있습니다. Fount에서 프로그래밍하는 것은 환영하는 커뮤니티와 풍부한 템플릿으로 뒷받침되는 부드러운 학습 곡선이라는 점을 기억하세요. 몇 줄의 코드만으로도 캐릭터에서 놀라운 깊이와 개성을 잠금 해제할 수 있다는 것을 알게 될 것입니다.

## 배지 및 링크: 당신의 창작물을 빛나게 하고, 세상이 닿을 수 있게 하세요

Fount의 세계는 단순한 단어와 코드 그 이상입니다. 눈을 즐겁게 하고 연결을 초대하는 축제입니다. 우리는 당신의 창작물이 이 광채 속에서 빛나고 세상과 쉽게 연결되기를 바랍니다. 따라서 Fount 컴포넌트를 더욱 눈길을 끌고 다른 사용자가 당신의 걸작을 쉽게 발견하고 경험할 수 있도록 훌륭한 배지와 편리한 링크를 준비했습니다.

**Fount 배지: 영광의 인장**

기사의 방패처럼 Fount 배지는 당신의 창작물에 대한 영광의 인장입니다. 이 배지는 리포지토리, Fount 컴포넌트 페이지 또는 전시하고 싶은 어느 곳이든 자랑스럽게 표시할 수 있습니다. 이는 당신의 작품과 Fount 커뮤니티와의 긴밀한 연결을 상징하며 당신의 재능을 인정하는 것입니다.

Fount 로고의 SVG 및 PNG 파일은 [여기](../imgs/)에서 찾아 디자인에 통합할 수 있습니다.

더욱 좋은 점은 배지를 클릭 가능한 버튼으로 바꿔 Fount 컴포넌트로 직접 연결할 수 있다는 것입니다.

```markdown
[![fount repo](https://steve02081504.github.io/fount/badges/fount_repo.svg)](https://github.com/steve02081504/fount)
```

[![fount repo](https://steve02081504.github.io/fount/badges/fount_repo.svg)](https://github.com/steve02081504/fount)

디자인의 일관성을 높이기 위해 Fount 로고의 표준 색상을 소개합니다.

| 색상 형식 | 코드 |
| :---: | :---: |
| HEX | `#0e3c5c` |
| RGB | `rgb(14, 60, 92)` |
| HSL | `hsl(205, 74%, 21%)` |

**자동 설치 링크: 손끝에서 펼쳐지는 마법**

다른 사용자가 단 한 번의 클릭으로 당신의 창작물을 Fount 세계에 직접 설치할 수 있다고 상상해 보세요. 더 이상 꿈이 아닌 현실입니다! Fount의 자동 설치 링크를 사용하면 이 마법을 현실로 만들 수 있습니다.

컴포넌트의 ZIP 링크 또는 Git 리포지토리 링크를 Fount 프로토콜 링크와 결합하여 마법 같은 링크를 만드세요.

```markdown
https://steve02081504.github.io/fount/protocol?url=fount://runshell/install/install;https://github.com/steve02081504/GentianAphrodite/releases/latest/download/GentianAphrodite.zip
```

더 간단한 설명: 컴포넌트 zip 링크/Git 리포지토리 링크 앞에 `https://steve02081504.github.io/fount/protocol?url=fount://runshell/install/install;`를 추가하기만 하면 됩니다!

이 링크를 Fount 배지와 결합하여 아름다움과 실용성을 겸비한 버튼을 만드세요.

```markdown
[![fount character](https://steve02081504.github.io/fount/badges/fount_character.svg)](https://steve02081504.github.io/fount/protocol?url=fount://runshell/install/install;https://github.com/steve02081504/GentianAphrodite/releases/latest/download/GentianAphrodite.zip)
```

[![fount character](https://steve02081504.github.io/fount/badges/fount_character.svg)](https://steve02081504.github.io/fount/protocol?url=fount://runshell/install/install;https://github.com/steve02081504/GentianAphrodite/releases/latest/download/GentianAphrodite.zip)

이 간단한 단계를 통해 당신의 창작물을 더욱 매력적으로 만들 뿐만 아니라 Fount 커뮤니티의 연결도 강화할 수 있습니다. 당신의 영감의 빛이 Fount 세계 전체를 비추도록 하세요!

## 기여자

[![Contributors](https://contrib.rocks/image?repo=steve02081504/fount)](https://github.com/steve02081504/fount/graphs/contributors)
