<details>
<summary><small>संक्षेप में</small></summary>

fount एक प्रोग्रामेबल, मानकीकृत, मॉड्यूलर और अनुकूलन योग्य एजेंट रनटाइम प्लेटफॉर्म है जो सेवाएं प्रदान करने के लिए विभिन्न भागों को लोड करता है।  
कोड से संबंधित प्रश्नों के लिए [deepwiki](https://deepwiki.com/steve02081504/fount) देखें।  
<small>fount नाम पूरी तरह लोअरकेस में लिखा जाता है—यह `f`ount है, `F`ount नहीं।</small>

#### fount क्यों?

- मानकीकृत, समृद्ध, शक्तिशाली इकोसिस्टम तैयार; पहिया दोबारा न बनाएं और डिबगिंग के दुःस्वप्न से बचें
- एजेंट लॉजिक कस्टमाइज़ करें, सिर्फ प्रॉम्प्ट और UI नहीं
- समुदाय के अन्य शक्तिशाली fount एजेंटों का उपयोग करें और सीखें
- ऑफिस-फ्रेंडली, त्वरित रिपोर्ट एक्सपोर्ट
- IDE, ब्राउज़र, टर्मिनल, Discord आदि में किरदारों का सहज एकीकरण
- समुदाय के एजेंट-उन्मुख प्लगइन जो अन्य LLM चैट फ्रंटएंड में नहीं हैं
- API कॉन्फ़िगर करें, फिर डिफ़ॉल्ट किरदार ZL-31 से बातचीत के ज़रिए पार्ट कॉन्फ़िगरेशन, निर्माण और **सभी उपयोगकर्ता ऑपरेशन** पूरे करें—बिना सीखने या ऑनबोर्डिंग के

#### fount क्यों नहीं?

- अधिक ढलान वाला लर्निंग कर्व, कोड ज्ञान चाहिए
- कुछ समुदाय भागों में दुर्भावनापूर्ण कोड हो सकता है; निर्णय लें और सावधानी से चुनें

##### मुझे क्या इस्तेमाल करना चाहिए?

[OpenClaw](https://openclaw.ai/) उपयोग करें जब आप:

- गहन अनुकूलन या दक्षता ट्यूनिंग के बिना AI एजेंट आज़माना चाहते हों

[ChatGPT](https://chatgpt.com/) या इसी तरह के ऑनलाइन LLM चैट प्लेटफॉर्म उपयोग करें जब आप:

- बस चैट करना चाहते हों
- AI किरदारों का गहन अनुकूलन न चाहते हों
- चैट इतिहास के क्लाउड में सहेजे जाने और एक्सपोर्ट/माइग्रेशन न होने से परेशान न हों
- विज्ञापनों से परेशान न हों

[character.ai](https://character.ai/) या इसी तरह के ऑनलाइन LLM किरदार रोलप्ले प्लेटफॉर्म उपयोग करें जब आप:

- एजेंट फीचर्स के बिना LLM-चालित किरदार चलाना चाहते हों
- सब्सक्रिप्शन लागत स्वीकार्य हो
- सॉफ्टवेयर कॉन्फ़िगर न करना चाहते हों

[SillyTavern](https://github.com/SillyTavern/SillyTavern/) उपयोग करें जब आप:

- ऐसे किरदार या फीचर चाहते हों जिनके लिए STscript या SillyTavern प्लगइन चाहिए

</details>

<h1 align="center">⛲fount💪</h1>

> <p align="center">कल्पना की एक चिंगारी, जीवंत साथी</p>

<p align="center">
<a href="https://github.com/topics/fount-repo"><img src="https://steve02081504.github.io/fount/badges/fount_repo.svg" alt="fount repo"></a>
<a href="https://deepwiki.com/steve02081504/fount"><img src="https://deepwiki.com/badge.svg" alt="Ask DeepWiki"></a>
<a href="https://github.com/users/steve02081504/packages/container/package/fount"><img src="https://img.shields.io/docker/image-size/steve02081504/fount" alt="Docker Image Size"></a>
<a href="https://github.com/steve02081504/fount/archive/refs/heads/master.zip"><img src="https://img.shields.io/github/repo-size/steve02081504/fount" alt="GitHub repo size"></a>
<a href="https://discord.gg/GtR9Quzq2v"><img src="https://img.shields.io/discord/1288934771153440768" alt="Discord"></a>
<a href="https://www.codefactor.io/repository/github/steve02081504/fount"><img src="https://www.codefactor.io/repository/github/steve02081504/fount/badge" alt="CodeFactor"></a>
<a href="https://app.codacy.com/gh/steve02081504/fount/dashboard?utm_source=gh&amp;utm_medium=referral&amp;utm_content=&amp;utm_campaign=Badge_grade"><img src="https://app.codacy.com/project/badge/Grade/8615bc18e3fa4ff391f41e9dcadf93f7" alt="Codacy Badge"></a>
</p>

<p align="center"><a href="https://trendshift.io/repositories/13136" target="_blank"><img src="https://trendshift.io/api/badge/repositories/13136" alt="steve02081504%2Ffount | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a></p>

![repo img](https://repository-images.githubusercontent.com/862251163/0ac90205-ae40-4fc6-af67-1e28d074c76b)

## fount क्या है?

fount एक **आधुनिक, स्केलेबल AI एजेंट रनटाइम वातावरण** है।

हम मानते हैं कि **उच्च दक्षता वाले उत्पादकता उपकरण** और **विसर्जित भावनात्मक बातचीत** एक-दूसरे के विपरीत नहीं हैं। fount एक पुल है: दिन के दौरान, यह जटिल कोड लिखने और मीटिंग के मिनट्स को व्यवस्थित करने में आपकी सहायता करने वाला सक्षम सहायक हो सकता है; रात में, यह एक डिजिटल विश्वासपात्र हो सकता है जो आपकी भावनाओं को समझता है और आपसे जुड़ता है।

![relative date](https://img.shields.io/date/1727107200?label=लगा%20समय) के समर्पित परिशोधन के बाद, ![GitHub contributors](https://img.shields.io/github/contributors/steve02081504/fount?label=योगदानकर्ताओं) के जुनून को शामिल करते हुए, और ![number of active users](https://img.shields.io/jsdelivr/gh/hy/steve02081504/fount?label=सक्रिय%20उपयोगकर्ता) के साथ एक जीवंत समुदाय के साथ, fount अब एक परिपक्व, स्थिर और लगातार विकसित हो रहा AI इंटरैक्शन प्लेटफॉर्म है।

यदि आप शुरू से कॉन्फ़िगर, सेटअप और शुरुआत करना चाहते हैं, तो आप सामुदायिक ट्यूटोरियल [**fount शुरुआती गाइड शुरू से**](https://github.com/Xiaoqiush81/fount-Guide-for-dummies) (ट्यूटोरियल चीनी भाषा में है, गैर-चीनी भाषी उपयोगकर्ता इसे पढ़ने के लिए ब्राउज़र अनुवाद फ़ंक्शन का उपयोग कर सकते हैं) देख सकते हैं।

![छवि](https://github.com/user-attachments/assets/05a5ad16-cc9a-49be-8c55-0c11353cb0d2)

---

## 🚀 दक्षता और इंजीनियरिंग: पेशेवरों, डेवलपर्स और गीक्स के लिए बनाया गया

fount बातचीत को उत्पादकता संपत्तियों में बदल देता है। सब कुछ ड्रैग-एंड-ड्रॉप है, सब कुछ एक फ़ाइल है, और तर्क कोड द्वारा संचालित होता है।

### 1. सीखने की ज़रूरत नहीं, तुरंत इस्तेमाल करें

- API कॉन्फ़िगर करें, फिर डिफ़ॉल्ट किरदार ZL-31 से बातचीत के ज़रिए पार्ट कॉन्फ़िगरेशन, निर्माण और **सभी उपयोगकर्ता ऑपरेशन** पूरे करें—बिना सीखने या ऑनबोर्डिंग के।
  ![छवि](https://github.com/user-attachments/assets/b871ec43-731a-468c-ad74-6c5a7ba8d737)

### 2. ज्ञान का संपत्ति में बदलना और निर्बाध साझाकरण

- **तत्काल रिपोर्ट जनरेशन**: बातचीत के बबल को सीधे एक फ़ोल्डर में खींचें और तुरंत एक स्वतंत्र HTML रिपोर्ट बनाएं। यह तकनीकी दस्तावेज़ों, मीटिंग रिकॉर्ड्स, या प्रेरणा के अंशों को शीघ्रता से व्यवस्थित करने के लिए आदर्श है।
  ![छवि](https://github.com/user-attachments/assets/0ef54ac0-7575-4b52-aa44-7b555dc4c4be)
- **कार्यप्रवाह इनकैप्सुलेशन और वितरण**: आपके द्वारा बनाए गए एजेंट (भूमिका) को सीधे डेस्कटॉप पर खींचें और एक साझा करने योग्य फ़ाइल बनाएं। अपने प्रॉम्प्ट इंजीनियरिंग और कार्यप्रवाह तर्क को सहकर्मियों या समुदाय में आसानी से वितरित करें।
  ![छवि](https://github.com/user-attachments/assets/5e14fe6e-2c65-492a-a09f-964c1e8ab9e0)

### 3. वास्तविक समय कोड निष्पादन वातावरण

अब सिर्फ मार्कडाउन हाईलाइटिंग नहीं। fount में, एजेंट (भूमिका) द्वारा भेजे गए कोड ब्लॉक **जीवंत** हैं।

- कई भाषाओं (C/C++/Rust/Python/JS, आदि) के लिए वास्तविक समय संकलन और रनिंग का समर्थन करता है।
- सीधे stdout आउटपुट देखें, और यहां तक कि संकलित भाषाओं के लिए ASM डिसअसेंबली परिणाम भी देखें।
- AI को पेयर प्रोग्रामिंग के लिए आपका वास्तविक समय सत्यापनकर्ता बनने दें।
  ![छवि](https://github.com/user-attachments/assets/66792238-4d70-4fa6-b0b3-76e506e49977)

### 4. डेवलपर-अनुकूल

fount की परियोजना वास्तुकला को डेवलपर्स की आदतों को पूरी तरह से ध्यान में रखकर डिज़ाइन किया गया है।
[परियोजना रिपॉजिटरी वास्तुकला जानना चाहते हैं? DeepWiki देखें!](https://deepwiki.com/steve02081504/fount)

- **Git संचालित**: सभी घटकों को Git के माध्यम से प्रबंधित किया जा सकता है।
- **VSCode एकीकरण**: परियोजना संरचना स्पष्ट है। [AGENTS.md](../AGENTS.md) में दिए गए मार्गदर्शन के साथ मिलकर, आप अपनी पसंदीदा IDE में सीधे अपने एजेंट तर्क को विकसित और डिबग कर सकते हैं।

---

## 🎭 विसर्जन और अनुनाद: उच्च-निष्ठा इंटरैक्शन अनुभव

जब काम पूरा हो जाता है, तो fount एक ऐसा संबंध प्रदान करता है जो सामान्य से परे है। हम पारंपरिक उपकरणों की कठोरता को छोड़ देते हैं, एक प्राकृतिक, तरल और गहराई से "उच्च-निष्ठा" बातचीत का पीछा करते हैं।

- **निर्बाध बातचीत, कभी भी, कहीं भी**
  कंप्यूटर पर शुरू हुई चैट मोबाइल फोन या टैबलेट पर निर्बाध रूप से जारी रह सकती है। fount आपकी बातचीत को सिंक्रनाइज़ रखता है, यह सुनिश्चित करता है कि आप कहीं भी हों, अपने एजेंट से कसकर जुड़े रहें।

- **अभिव्यंजक, विसर्जित चैट**
  HTML की शक्ति का लाभ उठाते हुए, fount एजेंट (भूमिका) को समृद्ध पाठ, छवियों और यहां तक कि इंटरैक्टिव तत्वों के माध्यम से खुद को व्यक्त करने की अनुमति देता है, जिससे प्रत्येक बातचीत जीवंत और गहरी बनती है।

- **दिमाग का जमावड़ा: देशी समूह चैट**
  कई एजेंटों को एक ही बातचीत में शामिल होने के लिए आमंत्रित करें और उनकी गतिशील और आकर्षक बातचीत देखें, चाहे वह काम के लिए एक बुद्धिशीलता सत्र हो या एजेंटों के बीच एक कहानी का अभिनय।
  ![छवि](https://github.com/user-attachments/assets/eea1cc7c-d258-4a2d-b16f-12815a88811d)

- **सुंदर, अनुकूलन योग्य इंटरफ़ेस**
  30 से अधिक आश्चर्यजनक थीम में से चुनें, या अपने खुद के रंग बनाएं। fount आपका विशेष कैनवास है।
  ![छवि](https://github.com/user-attachments/assets/0d327a06-6446-4bf3-8a05-f941aa5f4ed9)

- **हर जगह उपलब्ध**
  fount Windows, macOS, Linux, और यहां तक कि Android पर भी निर्बाध रूप से चलता है, सीधी स्थापना या Docker के लचीलेपन के माध्यम से आपकी विभिन्न आवश्यकताओं को पूरा करता है।

- **अबाधित AI स्रोत एकीकरण: अनंत को गले लगाओ**
  fount AI स्रोतों को जोड़ने में अद्वितीय _पसंद_ और _लचीलापन_ प्रदान करता है। AI स्रोत जनरेटर में कस्टम जावास्क्रिप्ट कोड आपको _किसी भी_ AI स्रोत से कनेक्ट करने की अनुमति देता है – OpenAI, Claude, OpenRouter, NovelAI, Horde, Ooba, Tabby, Mistral... कोड के प्रवाह में, आप जटिल नियमित अभिव्यक्तियों को ध्यान से डिज़ाइन कर सकते हैं, व्यापक API पुस्तकालयों को कॉल कर सकते हैं, और मल्टीमीडिया संसाधनों को एम्बेड कर सकते हैं। fount समझदार अनुरोध रूटिंग प्राप्त करने के लिए API पूलों के निर्माण का भी मूल रूप से समर्थन करता है। संचार का तर्क _आपकी_ इच्छा का पालन करता है, जो कोड की शक्ति से आकार लेता है।
  ![छवि](https://github.com/user-attachments/assets/f283d1de-c531-4b7a-bf43-3cbe0c48b7b9)

यदि आप एजेंटों के सागर में खोया हुआ महसूस करते हैं, या भूली हुई कहानियों की तलाश कर रहे हैं, तो हमारा [**जीवंत और मैत्रीपूर्ण समुदाय**](https://discord.gg/GtR9Quzq2v) आपके आगमन की प्रतीक्षा कर रहा है। यह समान विचारधारा वाले व्यक्तियों का एक स्वर्ग है, जहां डेवलपर्स और निर्माता अपनी बुद्धिमत्ता और रचनाएं साझा करते हैं।

---

## साहचर्य: डिजिटल पर्दे से परे

फाउंट पात्रों को आपके जीवन के ताने-बाने में बुनने का प्रयास करता है, जो स्क्रीन से परे साहचर्य और समर्थन प्रदान करता है।

- **डिस्कॉर्ड/टेलीग्राम एकीकरण**
  अपने पात्रों को अंतर्निहित बॉट शेल्स के माध्यम से डिस्कॉर्ड या टेलीग्राम समुदायों से कनेक्ट करें, जिससे वे आपके حلقों के जीवंत सदस्य बन जाते हैं।
  ![छवि](https://github.com/user-attachments/assets/299255c9-eed3-4deb-b433-41b80930cbdb)
  ![छवि](https://github.com/user-attachments/assets/c9841eba-c010-42a3-afe0-336543ec39a0)
  ![छवि](https://github.com/user-attachments/assets/b83301df-2205-4013-b059-4bced94e5857)

- **ब्राउज़र एकीकरण**
  पात्रों को ब्राउज़र एक्सटेंशन में एकीकृत करें, जिससे वे आपके ब्राउज़र में पृष्ठों की सामग्री को **देख और संशोधित** कर सकें, वास्तव में "AI के साथ वेब सर्फिंग" का एहसास हो सके।
  आप अपने पात्र से कह सकते हैं: अरे XX, इस पृष्ठ का रंग बदलने और कुछ सजावट जोड़ने में मेरी मदद करें।
  ![छवि](https://github.com/user-attachments/assets/c4dd7d46-122d-45f3-b0fe-53239725dcd6)

- **IDE एकीकरण**
  पात्रों को JetBrains, neovim, Zed आदि जैसे IDE में एकीकृत करें, जिससे वे कोड लिखते समय आपको संदर्भ-जागरूक सहायता और सुझाव प्रदान कर सकें, बिल्कुल Cursor Agent या GitHub Copilot की तरह।
  ![छवि](https://github.com/user-attachments/assets/70385a8d-c2cf-474d-b894-12f8675c2dc9)

- **टर्मिनल शांति ([fount-pwsh](https://github.com/steve02081504/fount-pwsh) के साथ)**
  जब कोई टर्मिनल कमांड विफल हो जाता है, तो अपने पात्र को चुपचाप मार्गदर्शन देने दें, जिससे डिजिटल दुनिया के अकेलेपन को कम किया जा सके।
  ![छवि](https://github.com/user-attachments/assets/93afee48-93d4-42c7-a5e0-b7f5c93bdee9)

- **असीम शेल एक्सटेंशन**
  थोड़ी प्रोग्रामिंग कौशल के साथ, अपने खुद के फाउंट शेल्स बनाएँ, अपने पात्रों की पहुँच को किसी भी कोने तक बढ़ाएँ जिसकी आप कल्पना कर सकते हैं।

---

## निर्माण: संकेतों की सीमाओं से परे

निर्माता के लिए, फाउंट आपके एआई पात्रों को जीवन में लाने का एक स्पष्ट मार्ग प्रदान करता है।

- **क्रांतिकारी एआई-सहायता प्राप्त निर्माण**
  अपने चरित्र का एक वाक्य में वर्णन करें, और हमारा बुद्धिमान एआई सहायक तुरंत एक पूर्ण व्यक्तित्व बना देगा। यह प्रारंभिक सेटअप को सरल बनाता है, जिससे आप अपनी रचना को परिष्कृत करने और उसके साथ बातचीत करने पर ध्यान केंद्रित कर सकते हैं।

- **कोड का जादू, जितना आप सोचते हैं उससे कहीं ज़्यादा आसान**
  फाउंट में, कोड आधुनिक जादू का एक रूप है। हमारे समुदाय के सौम्य मार्गदर्शन और एआई की प्रबुद्ध सहायता से, इसे सीखना आश्चर्यजनक रूप से आसान है। आप पाएंगे कि कोड के साथ चरित्र तर्क को परिभाषित करना उन पात्रों को बनाने का एक सहज और रखरखाव योग्य तरीका हो सकता है जिनकी प्रतिक्रियाएँ _आपकी_ अपनी तर्क से बुनी गई हैं।

- **तैयार जादू से शुरुआत करें: टेम्पलेट्स का खजाना**
  फाउंट का समुदाय पूर्व-निर्मित चरित्र और पर्सोना टेम्पलेट्स का खजाना प्रदान करता है। वे "जीवित खाका" के रूप में कार्य करते हैं, जिन्हें अनुकूलित करना और अनुकूलित करना आसान है, जो एक शानदार शुरुआती बिंदु प्रदान करते हैं।

- **एम्बेडेड संसाधन**
  छवियों, ऑडियो और अन्य संसाधनों को सीधे अपने पात्रों में बुनें, जिससे उनकी उपस्थिति और भी अधिक ठोस हो जाती है।
  ![छवि](https://github.com/user-attachments/assets/9740cd43-06fd-46c0-a114-e4bd99f13045)

- **सतत एकीकरण**
  अपने चरित्र विकास की सुरक्षा के लिए [fount-charCI](https://github.com/marketplace/actions/fount-charci) का उपयोग करें। यह हर कमिट पर स्वचालित रूप से परीक्षण चलाता है और वास्तविक समय में समस्याओं की रिपोर्ट करता है।
  ![छवि](https://github.com/user-attachments/assets/3f6a188d-6643-4d70-8bd1-b75f00c76439)
  ![छवि](https://github.com/user-attachments/assets/30eb8374-64c2-41bc-a7d1-f15596352260)

- **विरासत संगतता**
  फाउंट अतीत को अपनाता है, सिलीटेवर्न और रिसु चरित्र कार्ड चलाने के लिए संगतता मॉड्यूल प्रदान करता है (हालांकि मौजूदा पात्रों का माइग्रेशन समर्थित नहीं है)।

---

## आर्किटेक्चर: नवाचार की नींव

फाउंट एक मजबूत और स्केलेबल आर्किटेक्चर पर बनाया गया है। बैकएंड [डेनो](https://deno.com/) की शक्ति और गति का लाभ उठाता है, जिसमें कुशल रूटिंग के लिए [एक्सप्रेस](https://expressjs.com/) है। फ्रंटएंड HTML, CSS और जावास्क्रिप्ट के साथ एक सहज और आकर्षक इंटरफ़ेस के लिए तैयार किया गया है।

### विस्तार: विविध धागों से बुनी एक टेपेस्ट्री

फाउंट की दुनिया में, मॉड्यूलरिटी सर्वोच्च है। आपके अनुभव की टेपेस्ट्री बनाने के लिए घटकों का एक समृद्ध पारिस्थितिकी तंत्र आपस में जुड़ता है। इन सभी को उपयोगकर्ताओं द्वारा आसानी से स्थापित, विस्तारित और अनुकूलित किया जा सकता है।

- **chars (पात्र):** फाउंट का हृदय, जहाँ व्यक्तित्व पैदा होते हैं।
- **worlds (दुनियाएँ):** _सिर्फ विद्या पुस्तकों से कहीं ज़्यादा।_ वे वास्तविकता के मौन वास्तुकार हैं, जो ज्ञान जोड़ने, निर्णयों को प्रभावित करने और यहां तक कि चैट इतिहास में हेरफेर करने में सक्षम हैं।
- **personas (उपयोगकर्ता पर्सोना):** _सिर्फ उपयोगकर्ता प्रोफाइल से ज़्यादा।_ पर्सोना में आपके शब्दों और धारणाओं को विकृत करने और यहां तक कि नियंत्रण करने की शक्ति होती है, जो वास्तव में इमर्सिव रोलप्लेइंग की अनुमति देता है।
- **shells (इंटरैक्शन इंटरफेस):** फाउंट की आत्मा के प्रवेश द्वार, जो पात्रों की पहुँच को इंटरफ़ेस से परे बढ़ाते हैं।
- **ImportHandlers (आयात हैंडलर):** फाउंट के स्वागत करने वाले हाथ, जो विविध चरित्र प्रारूपों के बीच की खाई को पाटते हैं।
- **AIsources (एआई स्रोत):** कच्ची शक्ति जो आपके पात्रों के दिमाग को ईंधन देती है।
- **AIsourceGenerators (एआई स्रोत जनरेटर):** फाउंट के कीमियागर, जो जावास्क्रिप्ट के माध्यम से टेम्पलेट और तर्क प्रदान करते हैं ताकि _किसी भी_ कल्पनीय एआई स्रोत के साथ संबंध बन सके।

![छवि](https://github.com/user-attachments/assets/8487a04a-7040-4844-81a6-705687856757)

## इंस्टॉलेशन और रिमूवल: एक सुंदर मुलाकात और विदाई

### इंस्टॉलेशन: फाउंट को अपनी दुनिया में बुनना – _सहजता से_

> [!TIP]
>
> यदि आप शुरू से कॉन्फ़िगर, सेटअप और शुरुआत करना चाहते हैं, तो आप सामुदायिक ट्यूटोरियल [**fount शुरुआती गाइड शुरू से**](https://github.com/Xiaoqiush81/fount-Guide-for-dummies) (ट्यूटोरियल चीनी भाषा में है, गैर-चीनी भाषी उपयोगकर्ता इसे पढ़ने के लिए ब्राउज़र अनुवाद फ़ंक्शन का उपयोग कर सकते हैं) देख सकते हैं।

फाउंट के साथ अपनी यात्रा शुरू करें, एक स्थिर और विश्वसनीय मंच। कुछ सरल क्लिक या कमांड, और फाउंट की दुनिया खुल जाती है।

> [!CAUTION]
> फाउंट की दुनिया में, पात्र स्वतंत्र रूप से जावास्क्रिप्ट कमांड निष्पादित कर सकते हैं, जो उन्हें शक्तिशाली क्षमताएँ प्रदान करता है। इसलिए, उन पात्रों को उसी सावधानी से चुनें जिन पर आप भरोसा करते हैं जैसे आप वास्तविक जीवन में करते हैं ताकि आपकी स्थानीय फ़ाइलों की सुरक्षा सुनिश्चित हो सके।

### लिनक्स/macOS/एंड्रॉइड: शेल की फुसफुसाहटें – _एक पंक्ति, और आप अंदर हैं_

```bash
# यदि आवश्यक हो, तो फाउंट निर्देशिका निर्दिष्ट करने के लिए पर्यावरण चर $FOUNT_DIR को परिभाषित करें
INSTALLED_PACKAGES="${FOUNT_AUTO_INSTALLED_PACKAGES:-}"
install_package() { _command_name="$1"; _package_list=${2:-$_command_name}; _has_sudo=""; _installed_pkg_name="" ; if command -v "$_command_name" >/dev/null 2>&1; then return 0; fi; if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then _has_sudo="sudo"; fi; for _package in $_package_list; do if command -v apt-get >/dev/null 2>&1; then $_has_sudo apt-get update -y; $_has_sudo apt-get install -y "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v pacman >/dev/null 2>&1; then $_has_sudo pacman -Syy --noconfirm; $_has_sudo pacman -S --needed --noconfirm "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v dnf >/dev/null 2>&1; then $_has_sudo dnf install -y "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v yum >/dev/null 2>&1; then $_has_sudo yum install -y "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v zypper >/dev/null 2>&1; then $_has_sudo zypper install -y --no-confirm "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v apk >/dev/null 2>&1; then if [ "$(id -u)" -eq 0 ]; then apk add --update "$_package"; else $_has_sudo apk add --update "$_package"; fi; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v brew >/dev/null 2>&1; then if ! brew list --formula "$_package"; then brew install "$_package"; fi; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v pkg >/dev/null 2>&1; then pkg install -y "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v snap >/dev/null 2>&1; then $_has_sudo snap install "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; done; if command -v "$_command_name" >/dev/null 2>&1; then case ";$FOUNT_AUTO_INSTALLED_PACKAGES;" in *";$_installed_pkg_name;"*) ;; *) if [ -z "$FOUNT_AUTO_INSTALLED_PACKAGES" ]; then FOUNT_AUTO_INSTALLED_PACKAGES="$_installed_pkg_name"; else FOUNT_AUTO_INSTALLED_PACKAGES="$FOUNT_AUTO_INSTALLED_PACKAGES;$_installed_pkg_name"; fi; ;; esac; return 0; else echo "Error: Failed to install '$_command_name' from any source." >&2; return 1; fi; }
install_package "bash" "bash gnu-bash"; install_package "curl"
export FOUNT_AUTO_INSTALLED_PACKAGES="$INSTALLED_PACKAGES"
curl -fsSL https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.sh | bash
. "$HOME/.profile"
```

यदि आप रुकना चाहते हैं (एक ड्राई रन):

```bash
INSTALLED_PACKAGES="${FOUNT_AUTO_INSTALLED_PACKAGES:-}"
install_package() { _command_name="$1"; _package_list=${2:-$_command_name}; _has_sudo=""; _installed_pkg_name="" ; if command -v "$_command_name" >/dev/null 2>&1; then return 0; fi; if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then _has_sudo="sudo"; fi; for _package in $_package_list; do if command -v apt-get >/dev/null 2>&1; then $_has_sudo apt-get update -y; $_has_sudo apt-get install -y "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v pacman >/dev/null 2>&1; then $_has_sudo pacman -Syy --noconfirm; $_has_sudo pacman -S --needed --noconfirm "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v dnf >/dev/null 2>&1; then $_has_sudo dnf install -y "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v yum >/dev/null 2>&1; then $_has_sudo yum install -y "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v zypper >/dev/null 2>&1; then $_has_sudo zypper install -y --no-confirm "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v apk >/dev/null 2>&1; then if [ "$(id -u)" -eq 0 ]; then apk add --update "$_package"; else $_has_sudo apk add --update "$_package"; fi; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v brew >/dev/null 2>&1; then if ! brew list --formula "$_package"; then brew install "$_package"; fi; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v pkg >/dev/null 2>&1; then pkg install -y "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v snap >/dev/null 2>&1; then $_has_sudo snap install "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; done; if command -v "$_command_name" >/dev/null 2>&1; then case ";$FOUNT_AUTO_INSTALLED_PACKAGES;" in *";$_installed_pkg_name;"*) ;; *) if [ -z "$FOUNT_AUTO_INSTALLED_PACKAGES" ]; then FOUNT_AUTO_INSTALLED_PACKAGES="$_installed_pkg_name"; else FOUNT_AUTO_INSTALLED_PACKAGES="$FOUNT_AUTO_INSTALLED_PACKAGES;$_installed_pkg_name"; fi; ;; esac; return 0; else echo "Error: Failed to install '$_command_name' from any source." >&2; return 1; fi; }
install_package "bash" "bash gnu-bash"; install_package "curl"
export FOUNT_AUTO_INSTALLED_PACKAGES="$INSTALLED_PACKAGES"
curl -fsSL https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.sh | bash -s init
. "$HOME/.profile"
```

### विंडोज: रास्तों का चुनाव – _सादगी ही सब कुछ है_

- **प्रत्यक्ष और सरल (अनुशंसित):** [रिलीज़](https://github.com/steve02081504/fount/releases) से `.exe` फ़ाइल डाउनलोड करें और उसे चलाएँ।

- **PowerShell की शक्ति:**

  ```powershell
  # यदि आवश्यक हो, तो फाउंट निर्देशिका निर्दिष्ट करने के लिए पर्यावरण चर $env:FOUNT_DIR को परिभाषित करें
  irm https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.ps1 | iex
  ```

  ड्राई रन के लिए:

  ```powershell
  $scriptContent = Invoke-RestMethod https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.ps1
  Invoke-Expression "function fountInstaller { $scriptContent }"
  fountInstaller init
  ```

### गिट इंस्टॉलेशन: उन लोगों के लिए जो जादू का स्पर्श पसंद करते हैं

यदि आपके पास पहले से ही Git स्थापित है, तो फाउंट को अपनाना एक स्क्रिप्ट चलाने जितना ही सरल है।

- **विंडोज के लिए:** अपना कमांड प्रॉम्प्ट या PowerShell खोलें और बस `run.bat` पर डबल-क्लिक करें।
- **लिनक्स/macOS/एंड्रॉइड के लिए:** अपना टर्मिनल खोलें और `./run.sh` निष्पादित करें।

### डॉकर: कंटेनर को अपनाना

```bash
docker pull ghcr.io/steve02081504/fount
```

### रिमूवल: एक शालीन विदाई

```bash
fount remove
```

## किसी छाया का सामना? डरें नहीं

यदि आपको अपनी यात्रा में कोई कठिनाई आती है, तो कृपया हमसे संपर्क करें। हम मदद करने के लिए यहाँ हैं और 10 मिनट से 24 घंटे के भीतर अधिकांश समस्याओं का समाधान करने के लिए प्रतिबद्ध हैं।

- **GitHub मुद्दे:** [GitHub मुद्दे](https://github.com/steve02081504/fount/issues) के माध्यम से किसी भी बग की रिपोर्ट करें या नई सुविधाओं का सुझाव दें।
- **Discord समुदाय:** वास्तविक समय समर्थन और चर्चाओं के लिए हमारे [जीवंत Discord समुदाय](https://discord.gg/GtR9Quzq2v) में शामिल हों।

आपकी आवाज सुनी जाएगी। बस फाउंट को पुनरारंभ करें, और छायाएँ छँट जाएँगी।

---

## बैज और लिंक: अपनी रचनाओं को चमकने दें, दुनिया को उन तक पहुँचने दें

फाउंट की दुनिया सिर्फ शब्द और कोड से कहीं ज़्यादा है; यह आँखों के लिए एक दावत और जुड़ने का निमंत्रण है। हमने आपके फाउंट घटकों को चमकाने और दूसरों को आपकी उत्कृष्ट कृतियों को आसानी से खोजने की अनुमति देने के लिए उत्कृष्ट बैज और सुविधाजनक लिंक तैयार किए हैं।

### फाउंट बैज: गौरव की मुहर

आप इस बैज को गर्व से अपने रिपॉजिटरी में या कहीं भी प्रदर्शित कर सकते हैं जहाँ आप अपना काम दिखाना चाहते हैं। फाउंट लोगो की SVG फाइलें [यहां](../imgs/) पाएँ।

```markdown
[![fount repo](https://steve02081504.github.io/fount/badges/fount_repo.svg)](https://github.com/topics/fount-repo)
```

[![fount repo](https://steve02081504.github.io/fount/badges/fount_repo.svg)](https://github.com/topics/fount-repo)

```markdown
[![fount character](https://steve02081504.github.io/fount/badges/fount_character.svg)](https://github.com/topics/fount-character)
```

[![fount character](https://steve02081504.github.io/fount/badges/fount_character.svg)](https://github.com/topics/fount-character)

| रंग प्रारूप |         कोड          |
| :---------: | :------------------: |
|     HEX     |      `#0e3c5c`       |
|     RGB     |  `rgb(14, 60, 92)`   |
|     HSL     | `hsl(205, 74%, 21%)` |

आप किसी भी shields.io बैज में fount लोगो जोड़ने के लिए [बैज एडर](https://steve02081504.github.io/fount/badges/) का भी उपयोग कर सकते हैं।

### स्वचालित स्थापना लिंक: आपकी उंगलियों पर जादू

कल्पना कीजिए कि दूसरे आपकी रचनाओं को एक क्लिक में अपनी फाउंट दुनिया में स्थापित कर रहे हैं। बस अपने घटक के ज़िप या गिट रिपॉजिटरी लिंक को फाउंट के प्रोटोकॉल लिंक के साथ मिलाएं।

`https://steve02081504.github.io/fount/protocol?url=fount://run/shells/install/install;` + `आपका_घटक_लिंक`

---

## अनुशंसित ब्राउज़र: एक आदर्श मुलाकात के लिए

फाउंट का फ्रंटएंड आधुनिक वेब तकनीकों से बुना गया है, लेकिन सभी ब्राउज़र इसकी आत्मा के साथ पूरी तरह से प्रतिध्वनित नहीं होते हैं। सबसे शांत और तरल अनुभव के लिए, हम उन साथियों की सलाह देते हैं जो फाउंट की लय के साथ सामंजस्य में हैं:

- [**Google Chrome**](https://www.google.com/chrome/) / [**Microsoft Edge**](https://www.microsoft.com/edge/) / [**Opera**](https://www.opera.com/): वे फाउंट की भावना के साथ तालमेल बिठाते हैं, कविता की तरह सहज बातचीत के लिए सर्वश्रेष्ठ प्रदर्शन और संगतता प्रदान करते हैं।

फिर भी, कुछ ब्राउज़र एक अलग रास्ते पर चलते हैं, और फाउंट के साथ उनका सामना असंगति का एक नोट ले सकता है:

- **Mozilla Firefox**: यह एक जिद्दी पथिक की तरह है, जो अक्सर नई तकनीकों को अपनाने में जल्दबाजी नहीं करता, कभी-कभी हमेशा के लिए अतीत में रहने का विकल्प चुनता है। यह जिद, हालांकि, कुछ पछतावा पैदा कर सकती है:
  - [`speculationrules`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script/type/speculationrules) के लिए समर्थन की कमी के कारण, फाउंट का हर कोल्ड स्टार्ट और प्रोटोकॉल हैंडलिंग 1-2 सेकंड धीमा होगा—चुपचाप आपसे चुराए गए पल।
  - [CSS `anchor`](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_anchor_positioning) पोजीशनिंग के लिए समर्थन की अनुपस्थिति कुछ पृष्ठों को अपूर्ण धूल के स्पर्श के साथ छोड़ देगी, एक ऐसे मूड को खराब कर देगी जो शुद्ध होना था।
  - [`blocking="render"`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script) के लिए समर्थन की कमी के कारण फाउंट पेज लोड होने पर टिमटिमा सकते हैं, जिससे आपकी आँखों को चोट पहुँच सकती है।
  - बैकएंड त्रुटि रिपोर्ट के अनुसार, केवल फ़ायरफ़ॉक्स की दुनिया में ही फाउंट पेज कभी-कभी रहस्यमय त्रुटियों में पड़ जाते हैं या अजीब लगते हैं—जब ऐसा होता है, तो रीफ़्रेश करने का प्रयास करें; यह शायद धुंध को दूर कर देगा।

- **Apple Safari**: "उभरते" (कई साल पुराने) वेब मानकों के लिए इसका समर्थन फ़ायरफ़ॉक्स से थोड़ा बेहतर हो सकता है, लेकिन बहुत ज़्यादा नहीं।
  - इसमें भी [`speculationrules`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script/type/speculationrules) के लिए समर्थन की कमी है, जिसका अर्थ है कि फाउंट के स्टार्टअप में अभी भी थोड़ी देरी होगी, आपके कीमती क्षणों को बर्बाद कर देगी।

- **Brave**: क्रोमियम पर आधारित होने के बावजूद, इसकी गोपनीयता की दुर्जेय ढाल कभी-कभी अनजाने में फाउंट की कुछ रोशनी को अस्पष्ट कर सकती है, जिससे कुछ सुविधाओं का सामान्य संचालन प्रभावित हो सकता है।

---

### विकास देखें: फाउंट का स्टार इतिहास

[![स्टार इतिहास चार्ट](https://api.star-history.com/svg?repos=steve02081504/fount&type=Date)](https://github.com/steve02081504/fount/stargazers)

### योगदानकर्ताओं

[![Contributors](https://contrib.rocks/image?repo=steve02081504/fount)](https://github.com/steve02081504/fount/graphs/contributors)

### निष्कर्ष में: कारीगर का स्पर्श

एआई की फुसफुसाहट से परे, फाउंट एक गहरा संबंध प्रदान करता है - _कारीगर का स्पर्श_। हमारे समुदाय के भीतर, आपको पूर्व-निर्मित चरित्र और पर्सोना टेम्पलेट्स का खजाना मिलेगा, _प्रत्येक एक सावधानीपूर्वक तराशी गई नींव है जो आपकी अनूठी दृष्टि द्वारा जगाए जाने की प्रतीक्षा कर रही है_।

फाउंट आपको एआई पात्रों को बनाने और उनके साथ इस तरह से बातचीत करने का अधिकार देता है जो स्वाभाविक, इमर्सिव और गहराई से व्यक्तिगत महसूस हो। चाहे आप एक अनुभवी निर्माता हों या अभी अपनी यात्रा शुरू कर रहे हों, फाउंट आपका स्वागत करता है।

हमारे **स्वागत करने वाले समुदाय** में शामिल हों और एक परिपक्व मंच और एक समर्पित टीम द्वारा समर्थित, अपनी कल्पना में जान फूंकने के जादू की खोज करें।
