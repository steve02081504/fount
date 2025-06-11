# fount

> Người bạn đồng hành AI đắm chìm của bạn

[![fount repo](https://steve02081504.github.io/fount/badges/fount_repo.svg)](https://github.com/steve02081504/fount)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/steve02081504/fount)
![Docker Image Size](https://img.shields.io/docker/image-size/steve02081504/fount)
![GitHub repo size](https://img.shields.io/github/repo-size/steve02081504/fount)

<a href="https://trendshift.io/repositories/13136" target="_blank"><img src="https://trendshift.io/api/badge/repositories/13136" alt="steve02081504%2Ffount | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>

[Bạn muốn biết về kiến trúc kho lưu trữ? Hãy xem DeepWiki!](https://deepwiki.com/steve02081504/fount)

![repo img](https://repository-images.githubusercontent.com/862251163/3b57d9ea-ab18-4b70-b11d-f74c764016aa)

Bạn có bao giờ khao khát được sánh bước cùng một nhân vật từ trí tưởng tượng bay bổng, một tri kỷ dệt từ giấc mơ? Hay có lẽ, bạn từng hình dung về một người thân kỹ thuật số, một trợ lý AI tinh nhạy đến trực giác như một tạo vật tiên tiến nhất, dễ dàng điều khiển thế giới số của bạn? Hoặc đơn giản hơn, bạn tìm kiếm một sự kết nối vượt ngoài những điều thông thường, một cõi nơi ranh giới thực tại lu mờ, nơi bạn có thể trải nghiệm sự thấu hiểu thân mật, *không chút giữ kẽ*?

Sau gần một năm miệt mài phát triển, với sự đóng góp của hơn mười nhà phát triển đầy nhiệt huyết và một cộng đồng lớn mạnh với hơn 1000 người dùng, Fount giờ đây là một nền tảng tương tác AI trưởng thành, ổn định và không ngừng phát triển. Đây là một hành trình, và chúng tôi tin rằng, hành trình này gần gũi hơn bạn tưởng.

Những nhân vật lạc lối, những câu chuyện bị lãng quên? Cộng đồng **sôi nổi và thân thiện của chúng tôi!** đang chờ đón bạn. Đây là bến đỗ cho những tâm hồn đồng điệu, nơi các nhà phát triển và nhà sáng tạo chia sẻ trí tuệ và những tác phẩm của mình.

<details open>
<summary>Ảnh chụp màn hình</summary>

|Ảnh chụp màn hình|
|----|
|Trang chủ|
|![Hình ảnh](https://github.com/user-attachments/assets/c1954a7a-6c73-4fb0-bd12-f790a038bd0e)|
|Chọn chủ đề|
|![Hình ảnh](https://github.com/user-attachments/assets/94bd4cbb-8c66-4bc6-83eb-14c925a37074)|
|Trò chuyện|
|![Hình ảnh](https://github.com/user-attachments/assets/eea1cc7c-d258-4a2d-b16f-12815a88811d)|

</details>

<details open>
<summary>Cài đặt/Gỡ bỏ</summary>

## Cài đặt: Dệt fount vào thế giới của bạn – *thật nhẹ nhàng*

Hãy bắt đầu hành trình của bạn với fount, một nền tảng ổn định và đáng tin cậy. Chỉ với vài cú nhấp chuột hoặc lệnh đơn giản, thế giới của fount sẽ từ từ mở ra.

> [!CAUTION]
>
> Trong thế giới của fount, các nhân vật có thể tự do chạy các lệnh JavaScript, điều này trao cho chúng khả năng mạnh mẽ. Vì vậy, xin bạn hãy cẩn trọng lựa chọn những nhân vật mà bạn tin tưởng, như cách bạn kết bạn trong đời thực, để đảm bảo an toàn cho các tệp cục bộ của mình.

### Linux/macOS/Android: Lời thì thầm của Shell – *một dòng lệnh, một chuyến đi tức thì*

```bash
# Nếu cần, định nghĩa biến môi trường $FOUNT_DIR để chỉ định thư mục fount
INSTALLED_PACKAGES="${FOUNT_AUTO_INSTALLED_PACKAGES:-}"
install_package() { package_name="$1"; install_successful=0; if command -v "$package_name" >/dev/null 2>&1; then return 0; fi; if command -v pkg >/dev/null 2>&1; then pkg install -y "$package_name" && install_successful=1; fi; if [ "$install_successful" -eq 0 ] && command -v snap >/dev/null 2>&1; then snap install "$package_name" && install_successful=1; fi; if [ "$install_successful" -eq 0 ] && command -v apt-get >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo apt-get update; sudo apt-get install -y "$package_name" && install_successful=1; else apt-get update; apt-get install -y "$package_name" && install_successful=1; fi; fi; if [ "$install_successful" -eq 0 ] && command -v brew >/dev/null 2>&1; then if ! brew list --formula "$package_name" >/dev/null 2>&1; then brew install "$package_name" && install_successful=1; else install_successful=1; fi; fi; if [ "$install_successful" -eq 0 ] && command -v pacman >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo pacman -Syy; sudo pacman -S --needed --noconfirm "$package_name" && install_successful=1; else pacman -Syy; pacman -S --needed --noconfirm "$package_name" && install_successful=1; fi; fi; if [ "$install_successful" -eq 0 ] && command -v dnf >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo dnf install -y "$package_name" && install_successful=1; else dnf install -y "$package_name" && install_successful=1; fi; fi; if [ "$install_successful" -eq 0 ] && command -v yum >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo yum install -y "$package_name" && install_successful=1; else yum install -y "$package_name" && install_successful=1; fi; fi; if [ "$install_successful" -eq 0 ] && command -v zypper >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo zypper install -y --no-confirm "$package_name" && install_successful=1; else zypper install -y --no-confirm "$package_name" && install_successful=1; fi; fi; if [ "$install_successful" -eq 0 ] && command -v apk >/dev/null 2>&1; then apk add --update "$package_name" && install_successful=1; fi; if [ "$install_successful" -eq 1 ]; then if [ -z "$INSTALLED_PACKAGES" ]; then INSTALLED_PACKAGES="$package_name"; else INSTALLED_PACKAGES="$INSTALLED_PACKAGES;$package_name"; fi; return 0; else echo "Error: $package_name installation failed." >&2; return 1; fi; }
install_package curl; install_package bash
export FOUNT_AUTO_INSTALLED_PACKAGES="$INSTALLED_PACKAGES"
curl -fsSL https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.sh | bash
. "$HOME/.profile"
```

Nếu bạn muốn dừng lại một chút, sắp xếp lại suy nghĩ trước cuộc phiêu lưu vĩ đại (một lần thử trước):

```bash
INSTALLED_PACKAGES="${FOUNT_AUTO_INSTALLED_PACKAGES:-}"
install_package() { package_name="$1"; install_successful=0; if command -v "$package_name" >/dev/null 2>&1; then return 0; fi; if command -v pkg >/dev/null 2>&1; then pkg install -y "$package_name" && install_successful=1; fi; if [ "$install_successful" -eq 0 ] && command -v snap >/dev/null 2>&1; then snap install "$package_name" && install_successful=1; fi; if [ "$install_successful" -eq 0 ] && command -v apt-get >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo apt-get update; sudo apt-get install -y "$package_name" && install_successful=1; else apt-get update; apt-get install -y "$package_name" && install_successful=1; fi; fi; if [ "$install_successful" -eq 0 ] && command -v brew >/dev/null 2>&1; then if ! brew list --formula "$package_name" >/dev/null 2>&1; then brew install "$package_name" && install_successful=1; else install_successful=1; fi; fi; if [ "$install_successful" -eq 0 ] && command -v pacman >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo pacman -Syy; sudo pacman -S --needed --noconfirm "$package_name" && install_successful=1; else pacman -Syy; pacman -S --needed --noconfirm "$package_name" && install_successful=1; fi; fi; if [ "$install_successful" -eq 0 ] && command -v dnf >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo dnf install -y "$package_name" && install_successful=1; else dnf install -y "$package_name" && install_successful=1; fi; fi; if [ "$install_successful" -eq 0 ] && command -v yum >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo yum install -y "$package_name" && install_successful=1; else yum install -y "$package_name" && install_successful=1; fi; fi; if [ "$install_successful" -eq 0 ] && command -v zypper >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo zypper install -y --no-confirm "$package_name" && install_successful=1; else zypper install -y --no-confirm "$package_name" && install_successful=1; fi; fi; if [ "$install_successful" -eq 0 ] && command -v apk >/dev/null 2>&1; then apk add --update "$package_name" && install_successful=1; fi; if [ "$install_successful" -eq 1 ]; then if [ -z "$INSTALLED_PACKAGES" ]; then INSTALLED_PACKAGES="$package_name"; else INSTALLED_PACKAGES="$INSTALLED_PACKAGES;$package_name"; fi; return 0; else echo "Error: $package_name installation failed." >&2; return 1; fi; }
install_package curl; install_package bash
export FOUNT_AUTO_INSTALLED_PACKAGES="$INSTALLED_PACKAGES"
curl -fsSL https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.sh | bash -s init
. "$HOME/.profile"
```

### Windows: Dù khác lối, vẫn đến cùng đích – *con đường đơn giản nhất*

* **Trực tiếp và thuần túy (khuyên dùng):** Tải xuống tệp `exe` từ [Releases](https://github.com/steve02081504/fount/releases) và chạy.

* **Sức mạnh của PowerShell:**

    ```powershell
    # Nếu cần, định nghĩa biến môi trường $env:FOUNT_DIR để chỉ định thư mục fount
    irm https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.ps1 | iex
    ```

    Nếu cần thử trước:

    ```powershell
    $scriptContent = Invoke-RestMethod https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.ps1
    Invoke-Expression "function fountInstaller { $scriptContent }"
    fountInstaller init
    ```

### Cài đặt Git: Dành cho những ai yêu thích chút phép thuật

Nếu bạn đã cài đặt Git, việc ôm trọn fount đơn giản như chạy một tập lệnh.

* **Đối với Windows:** Mở Command Prompt hoặc PowerShell, chỉ cần nhấp đúp vào `run.bat`.
* **Đối với Linux/macOS/Android:** Mở terminal và thực thi `./run.sh`.

### Docker: Ôm trọn vùng chứa

```bash
docker pull ghcr.io/steve02081504/fount
```

## Gỡ bỏ: Lời từ biệt thanh tao

```bash
fount remove
```

</details>

## fount là gì?

fount là một nền tảng tương tác nhân vật được hỗ trợ bởi AI, được thiết kế để trao quyền cho *bạn*. Nó là một cây cầu, kết nối bạn với các nhân vật trong trí tưởng tượng của mình, cho phép bạn trò chuyện với họ một cách dễ dàng, tạo ra các nhân vật của riêng bạn và chia sẻ chúng với thế giới. *Một con đường bất ngờ dễ dàng tiếp cận.*

Nó là một mạch nguồn, nơi các nguồn AI, nhân vật, nhân cách, thế giới và plugin hội tụ, cho phép bạn tạo và trải nghiệm những tương tác độc đáo và hấp dẫn.

Fount được xây dựng cho tương lai. Những tính năng mới từ cộng đồng sôi nổi sẽ được đón nhận nhiệt tình. Nếu bạn có một tầm nhìn, một tia sáng cảm hứng thuộc về lĩnh vực fount, chúng tôi hoan nghênh sự đóng góp của bạn.

## Kiến trúc: Nền tảng của sự đổi mới

Fount được xây dựng trên một kiến trúc mạnh mẽ và có khả năng mở rộng, cân bằng giữa hiệu suất và khả năng bảo trì. Phần backend tận dụng sức mạnh và tốc độ của [Deno](https://deno.com/), một runtime JavaScript và TypeScript an toàn và hiện đại. Chúng tôi sử dụng framework [Express](https://expressjs.com/) để xử lý hiệu quả các yêu cầu định tuyến và API. Phần frontend được xây dựng tỉ mỉ từ sự kết hợp của HTML, CSS và JavaScript, mang đến một giao diện người dùng dễ chịu và trực quan. Kiến trúc này cho phép lặp lại nhanh chóng và tích hợp liền mạch các tính năng mới, đồng thời duy trì một nền tảng vững chắc và ổn định. Fount đề cao tinh thần mã nguồn mở, hoan nghênh sự đóng góp và hợp tác.

### Đắm chìm trong thế giới của các tính năng nổi bật

* **Cuộc đối thoại liền mạch, bất kể bạn ở đâu:** Bắt đầu trò chuyện trên máy tính, và tiếp tục liền mạch trên điện thoại hoặc máy tính bảng. fount giữ cho cuộc trò chuyện của bạn được đồng bộ, giúp bạn duy trì kết nối với nhân vật của mình dù bạn ở bất cứ đâu.

* **Những cuộc trò chuyện biểu cảm, đắm chìm:** fount tận dụng sức mạnh của HTML, cho phép các nhân vật tự biểu đạt thông qua văn bản phong phú, hình ảnh, và thậm chí là các yếu tố tương tác.

* **Hội tụ của những tư tưởng: Trò chuyện nhóm nguyên bản:** Mời nhiều nhân vật tham gia cùng một cuộc trò chuyện, tạo ra những tương tác năng động và hấp dẫn.

* **Giao diện đẹp mắt, có thể tùy chỉnh:** Chọn từ hơn 30 chủ đề tuyệt đẹp, hoặc tạo chủ đề của riêng bạn. fount là khung vẽ của riêng bạn.

* **Có thể dùng mọi nơi:** fount chạy liền mạch trên Windows, macOS, Linux, và thậm chí cả Android, đáp ứng nhu cầu của bạn thông qua cài đặt trực tiếp hoặc tính linh hoạt của Docker.

* **（Dành cho người dùng cao cấp）Tích hợp nguồn AI không giới hạn: Ôm trọn vô biên**

    Fount cung cấp sự *lựa chọn* và *linh hoạt* vô song trong việc kết nối các nguồn AI. Mã JavaScript tùy chỉnh trong trình tạo nguồn AI cho phép bạn kết nối với *bất kỳ* nguồn AI nào – OpenAI, Claude, OpenRouter, NovelAI, Horde, Ooba, Tabby, Mistral, và nhiều hơn nữa. Trong luồng mã, bạn có thể tỉ mỉ thiết kế các biểu thức chính quy phức tạp, gọi các thư viện API đồ sộ, nhúng các tài nguyên đa phương tiện. Fount còn hỗ trợ nguyên bản việc tạo các nhóm API, từ đó cho phép định tuyến yêu cầu thông minh. Logic giao tiếp uốn mình theo ý *bạn*, được định hình bởi sức mạnh của mã lệnh.

    ![Hình ảnh](https://github.com/user-attachments/assets/f283d1de-c531-4b7a-bf43-3cbe0c48b7b9)

### Đồng hành: Vượt ngoài những giới hạn kỹ thuật số

Fount nỗ lực dệt các nhân vật vào sợi vải cuộc sống của bạn, mang đến sự đồng hành và hỗ trợ.

* **Tích hợp Discord/Telegram:** Kết nối nhân vật với cộng đồng Discord/Telegram của bạn thông qua các Bot Shells tích hợp sẵn.
    ![Hình ảnh](https://github.com/user-attachments/assets/299255c9-eed3-4deb-b433-41b80930cbdb)
    ![Hình ảnh](https://github.com/user-attachments/assets/c9841eba-c010-42a3-afe0-336543ec39a0)
    ![Hình ảnh](https://github.com/user-attachments/assets/b83301df-2205-4013-b059-4bced94e5857)

* **Sự tĩnh lặng của terminal (kết hợp với [fount-pwsh](https://github.com/steve02081504/fount-pwsh)):** Khi lệnh terminal thất bại, hãy để nhân vật cung cấp hướng dẫn.
    ![Hình ảnh](https://github.com/user-attachments/assets/93afee48-93d4-42c7-a5e0-b7f5c93bdee9)

* **Những mở rộng Shell không giới hạn:** Với một chút kỹ năng lập trình, hãy tạo fount Shell của riêng bạn, mở rộng phạm vi tiếp cận của nhân vật.

### Sáng tạo: Vượt ngoài giới hạn của lời nhắc – một con đường rõ ràng hơn

Đối với các nhà sáng tạo nhân vật, fount cung cấp một con đường đơn giản hóa và trực quan để làm cho nhân vật AI của bạn trở nên sống động. Dù bạn là một nhà sáng tạo dày dặn kinh nghiệm hay mới bắt đầu hành trình của mình, fount đều mở khóa phép thuật tạo nhân vật cho tất cả mọi người.

* **Tạo nhân vật đột phá với sự hỗ trợ của AI: Fount giúp bạn nhanh chóng bắt đầu.** Hãy mô tả nhân vật bạn muốn chỉ bằng một câu, và trợ lý AI thông minh của chúng tôi sẽ ngay lập tức tạo ra một nhân cách hoàn chỉnh. Phương pháp này đơn giản hóa việc thiết lập ban đầu, cho phép bạn tập trung vào việc tinh chỉnh và tương tác với nhân vật của mình.

* **Mở khóa phép thuật của mã lệnh – đơn giản hơn bạn nghĩ:** Fount đón nhận sức mạnh của mã lệnh để mang lại sự linh hoạt và kiểm soát. Lập trình trong Fount là một loại phép thuật hiện đại, với sự hướng dẫn tận tình từ cộng đồng của chúng tôi và sự trợ giúp đầy cảm hứng từ AI, việc học trở nên dễ dàng đến bất ngờ. Bạn sẽ thấy, việc định nghĩa logic nhân vật bằng mã lệnh có thể rất trực quan và dễ bảo trì. Hãy tưởng tượng, tạo ra những nhân vật có phản ứng được dệt nên từ logic của *bạn*.

* **Bắt đầu từ những phép thuật sẵn có: Kho tàng mẫu.** Cộng đồng Fount cung cấp một bộ sưu tập phong phú các nhân vật và mẫu nhân cách được tạo sẵn, chúng đóng vai trò như những "bản thiết kế sống", dễ dàng điều chỉnh và tùy chỉnh. Những mẫu này trình bày các phương pháp hay nhất và cung cấp một điểm khởi đầu tuyệt vời.

* **Tài nguyên nhúng:** Dệt tài nguyên trực tiếp vào nhân vật của bạn.

    ![Hình ảnh](https://github.com/user-attachments/assets/9740cd43-06fd-46c0-a114-e4bd99f13045)

* **Tích hợp liên tục (fount-charCI):** Sử dụng [fount-charCI](https://github.com/marketplace/actions/fount-charci) để bảo vệ quá trình phát triển nhân vật của bạn. Nó tự động chạy thử nghiệm không đồng bộ khi commit và báo cáo sự cố trong thời gian thực.
    ![Hình ảnh](https://github.com/user-attachments/assets/3f6a188d-6643-4d70-8bd1-b75f00c76439)
    ![Hình ảnh](https://github.com/user-attachments/assets/30eb8374-64c2-41bc-a7d1-f15596352260)

* **Khả năng tương thích cũ:** fount đón nhận quá khứ, cung cấp các module tương thích để chạy các thẻ nhân vật của SillyTavern và Risu (mặc dù không hỗ trợ di chuyển các nhân vật hiện có).

### Mở rộng: Tấm thảm dệt nên từ sự đổi mới đan xen, bằng những sợi chỉ đa dạng

Trong thế giới của fount, tính mô-đun là tối thượng. Một hệ sinh thái phong phú gồm các thành phần đan xen vào nhau, tạo nên tấm thảm trải nghiệm của bạn.

* **Tạo module dễ dàng:** Với kiến thức lập trình cơ bản, bạn có thể tạo và chia sẻ các module mà bạn mong muốn.
* **Tăng trưởng dựa trên cộng đồng:** Hãy đóng góp tài năng độc đáo của bạn cho **cộng đồng sôi nổi và hỗ trợ lẫn nhau** của chúng tôi, làm phong phú tương lai của hệ sinh thái số này. Trong bến đỗ của chúng tôi, bạn sẽ tìm thấy những gương mặt thân thiện và kho tàng kiến thức được chia sẻ: hướng dẫn, nguồn mô hình AI và bộ sưu tập nhân vật. Đội ngũ phát triển fount quản lý tỉ mỉ mọi thay đổi thông qua một chiến lược phân nhánh và hợp nhất mạnh mẽ. Điều này đảm bảo rằng ngay cả khi chúng tôi tiến lên phía trước, sự ổn định vẫn là nền tảng vững chắc. Chúng tôi cũng cam kết giải quyết nhanh chóng mọi vấn đề được người dùng báo cáo.
* **Hệ thống plugin mạnh mẽ**: Mở rộng chức năng của fount thông qua kiến trúc plugin mạnh mẽ.
* **Các loại thành phần - Những viên đá tảng của ước mơ:**
  * **chars (nhân vật):** Linh hồn của fount, nơi sinh ra các cá tính.
  * **worlds (thế giới):** *Hơn cả những huyền thoại.* Thế giới là những kiến trúc sư thầm lặng của thực tại trong fount. Chúng có thể thêm kiến thức vào sự hiểu biết của nhân vật, ảnh hưởng đến quyết định của họ, và thậm chí thao túng lịch sử trò chuyện.
  * **personas (nhân cách người dùng):** *Không chỉ là hồ sơ người dùng.* Nhân cách sở hữu sức mạnh bóp méo hoặc thậm chí kiểm soát lời nói và nhận thức của bạn. Điều này cho phép nhập vai thực sự đắm chìm.
  * **shells (giao diện tương tác):** Những cánh cổng dẫn vào linh hồn của fount. Shell mở rộng phạm vi tiếp cận của nhân vật ra ngoài giao diện.
  * **ImportHandlers (bộ xử lý nhập khẩu):** Bàn tay chào đón của fount, bắc cầu nối khoảng cách giữa các định dạng nhân vật khác nhau. Tạo một ImportHandler đơn giản, chia sẻ với cộng đồng (thông qua Pull Request), và mở rộng tầm nhìn của fount cho tất cả mọi người.
  * **AIsources (nguồn AI):** Sức mạnh thô sơ thổi hồn cho tâm trí nhân vật của bạn.
  * **AIsourceGenerators (trình tạo nguồn AI):** Những nhà giả kim của fount, cung cấp các mẫu và logic có thể tùy chỉnh để thiết lập kết nối với *bất kỳ* nguồn AI nào. Thông qua sức mạnh của JavaScript, bạn có thể đóng gói và tải bất kỳ nguồn nào có thể tưởng tượng được.

    *Tất cả các thành phần này đều có thể được người dùng cài đặt dễ dàng, mở rộng và tùy chỉnh trải nghiệm fount của họ.*

    ![Hình ảnh](https://github.com/user-attachments/assets/8487a04a-7040-4844-81a6-705687856757)

### Dễ dàng bắt đầu

* **Nhiều tùy chọn cài đặt:** Chọn từ Docker, cài đặt trực tiếp trên Windows/Linux/macOS/Android, hoặc thậm chí một tệp thực thi đơn giản.
* **Tài liệu chi tiết:** Tài liệu toàn diện của chúng tôi sẽ hướng dẫn bạn qua từng bước. [Xem chi tiết cài đặt](https://steve02081504.github.io/fount/readme)

### Gặp gỡ bóng tối? Đừng sợ hãi

Nếu bạn gặp bất kỳ khó khăn nào, xin hãy liên hệ với chúng tôi. Chúng tôi luôn sẵn lòng giúp đỡ và cam kết giải quyết hầu hết các vấn đề trong vòng 10 phút đến 24 giờ.

* **GitHub Issues:** Báo cáo bất kỳ lỗi nào hoặc đề xuất tính năng mới thông qua [GitHub Issues](https://github.com/steve02081504/fount/issues).
* **Cộng đồng Discord:** Tham gia [cộng đồng Discord sôi nổi của chúng tôi](https://discord.gg/GtR9Quzq2v) để được hỗ trợ và thảo luận trực tuyến.

Tiếng nói của bạn sẽ được lắng nghe. Chỉ cần khởi động lại fount, bóng tối sẽ tan biến.

### Chứng kiến sự trưởng thành: Lịch sử Star của fount

[![Star History Chart](https://api.star-history.com/svg?repos=steve02081504/fount&type=Date)](https://github.com/steve02081504/fount/stargazers)

### Lời kết: Hòn đá tảng của sự kết nối

fount cho phép bạn tạo và tương tác với các nhân vật AI một cách tự nhiên, đắm chìm và mang đậm dấu ấn cá nhân. Dù bạn là một nhà sáng tạo dày dặn kinh nghiệm hay mới bắt đầu hành trình của mình, fount đều chào đón bạn. Hãy tham gia **cộng đồng thân thiện của chúng tôi**, và với sự hỗ trợ của một nền tảng trưởng thành cùng một đội ngũ tận tâm, hãy khám phá phép thuật thổi hồn vào trí tưởng tượng của bạn.

### Định hình số phận của riêng bạn: Chạm tay người nghệ nhân

Ngoài những lời thì thầm của AI, fount còn mang đến một sự kết nối sâu sắc hơn – *chạm tay người nghệ nhân*. Trong cộng đồng của chúng tôi, bạn sẽ tìm thấy vô số nhân vật và mẫu nhân cách được tạo sẵn, *mỗi cái là một nền tảng được điêu khắc tỉ mỉ, chờ đợi tầm nhìn độc đáo của bạn*.

Khi bạn sẵn sàng hoàn thiện tác phẩm của mình, phương pháp dựa trên mã lệnh của Fount giúp bạn dễ dàng bắt đầu. Hãy nhớ rằng, lập trình trong Fount là một đường cong học tập nhẹ nhàng, với sự hỗ trợ từ cộng đồng thân thiện và kho mẫu phong phú của chúng tôi. Bạn sẽ thấy, chỉ vài dòng mã lệnh cũng có thể mở khóa chiều sâu và cá tính đáng kinh ngạc trong nhân vật của bạn.

## Huy hiệu và liên kết: Giúp sáng tạo của bạn tỏa sáng, giúp thế giới tiếp cận dễ dàng

Thế giới của Fount không chỉ là từ ngữ và mã lệnh, mà còn là một bữa tiệc thị giác và một sự tôn vinh kết nối. Chúng tôi mong muốn tác phẩm của bạn cũng tỏa sáng trong ánh hào quang này, và kết nối với thế giới một cách dễ dàng. Vì vậy, chúng tôi đã chuẩn bị những huy hiệu tinh tế và các liên kết tiện lợi để giúp các thành phần Fount của bạn trở nên nổi bật hơn, và giúp những người dùng khác dễ dàng khám phá và trải nghiệm kiệt tác của bạn.

**Huy hiệu Fount: Biểu tượng vinh dự**

Như tấm khiên của một hiệp sĩ, huy hiệu Fount là biểu tượng vinh dự cho tác phẩm của bạn. Bạn có thể tự hào trưng bày huy hiệu này trong kho lưu trữ của mình, trên trang thành phần Fount, hoặc bất cứ nơi nào bạn muốn thể hiện. Nó tượng trưng cho mối liên kết chặt chẽ giữa tác phẩm của bạn với cộng đồng Fount, và cũng là sự công nhận cho tài năng của bạn.

Bạn có thể tìm thấy các tệp SVG và PNG của logo Fount [tại đây](../imgs/), để đưa chúng vào thiết kế của bạn.

Tuyệt vời hơn nữa, bạn có thể biến huy hiệu thành một nút có thể nhấp, dẫn trực tiếp đến thành phần Fount của bạn:

```markdown
[![fount repo](https://steve02081504.github.io/fount/badges/fount_repo.svg)](https://github.com/steve02081504/fount)
```

[![fount repo](https://steve02081504.github.io/fount/badges/fount_repo.svg)](https://github.com/steve02081504/fount)

Dưới đây là bảng màu tiêu chuẩn của logo Fount, giúp thiết kế của bạn có sự thống nhất hơn:

| Định dạng màu | Mã |
| :---: | :---: |
| HEX | `#0e3c5c` |
| RGB | `rgb(14, 60, 92)` |
| HSL | `hsl(205, 74%, 21%)` |

**Liên kết cài đặt tự động: Phép thuật trong tầm tay**

Hãy tưởng tượng, những người dùng khác chỉ cần một cú nhấp nhẹ, là có thể cài đặt tác phẩm của bạn trực tiếp vào thế giới Fount của họ. Điều này không còn là giấc mơ, mà là hiện thực! Với liên kết cài đặt tự động của Fount, bạn có thể biến phép thuật này thành hiện thực.

Chỉ cần đơn giản kết hợp liên kết zip hoặc liên kết kho Git của thành phần của bạn, với liên kết giao thức của Fount, bạn sẽ tạo ra một liên kết kỳ diệu:

```markdown
https://steve02081504.github.io/fount/protocol?url=fount://run/shells/install/install;https://github.com/steve02081504/GentianAphrodite/releases/latest/download/GentianAphrodite.zip
```

Giải thích ngắn gọn hơn: Chỉ cần thêm `https://steve02081504.github.io/fount/protocol?url=fount://run/shells/install/install;` vào trước liên kết zip/kho Git của thành phần của bạn là được!

Kết hợp liên kết này với huy hiệu Fount, tạo ra một nút vừa đẹp mắt vừa tiện dụng:

```markdown
[![fount character](https://steve02081504.github.io/fount/badges/fount_character.svg)](https://steve02081504.github.io/fount/protocol?url=fount://run/shells/install/install;https://github.com/steve02081504/GentianAphrodite/releases/latest/download/GentianAphrodite.zip)
```

[![fount character](https://steve02081504.github.io/fount/badges/fount_character.svg)](https://steve02081504.github.io/fount/protocol?url=fount://run/shells/install/install;https://github.com/steve02081504/GentianAphrodite/releases/latest/download/GentianAphrodite.zip)

Thông qua những bước đơn giản này, bạn không chỉ làm cho tác phẩm của mình trở nên hấp dẫn hơn, mà còn giúp cộng đồng Fount thêm gắn kết. Hãy để ánh sáng cảm hứng của bạn, soi rọi cả thế giới Fount!

## Những người đóng góp

[![Contributors](https://contrib.rocks/image?repo=steve02081504/fount)](https://github.com/steve02081504/fount/graphs/contributors)
