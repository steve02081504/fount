# fount

![repo img](https://repository-images.githubusercontent.com/862251163/3b57d9ea-ab18-4b70-b11d-f74c764016aa)

> [!CAUTION]
>
> 1. 开发版本的接口没有固定
> 2. 没有统一的**命名规范**
> 3. 处于开发的初期,不存在稳定性
> 4. 缺少 css 美化
> 5. 角色可以随意运行 js 命令操作计算机本地文件

## fount 是什么？

fount 是一个角色卡前端页面，解耦合了AI来源、AI角色、用户人设、对话环境、AI插件。
fount可以允许你运行fount格式的角色，它们可能有各种各样的能力或应用场景，一切取决于你！ :)

### 使用fount创作角色的好处是什么？

- 使用任何你想使用的js/ts代码来客制化角色的prompt生成流程、对话流程，而不用受到前端的语法限制。
- 无过滤的运行js/ts代码和提供html页面，创作从未如此自由！
- 在角色内置各种资源，再也无需图床搭建。
- 做任何事！现在角色可以操作计算机本地文件或更多！

### 使用fount游玩的好处是什么？

- AI来源的内嵌性，你无需再另外启动服务器来转换对话格式，一切都可以在AI来源生成器中使用自定义js代码来解决。
- 更为强大的AI角色，满足你的各种幻想。

## 架构

- 后端使用 deno 作为基石 配合 express 框架来开发
- 前端是 html+css+js

## 规划

详见 [todo.md](./todo.md)

## 更好的其他项目

### [SillyTavern](https://github.com/SillyTavern/SillyTavern)

- SillyTavern 是一个可以安装在电脑（和安卓手机）上的前端用户界面
- SillyTavern 注重安全和兼容性
- 功能设置繁多且可通过配置文件来开启和配置
- 强大的世界书带来的强大功能
- 开发人员活跃具有众多贡献者且 Issues 的提流程完善
- 支持局域网服务
- 等等...

### [RisuAI](https://github.com/kwaroran/RisuAI)

- RisuAI 是一个新兴的前端页面,没有 SillyTavern 的包袱
- 使用 typescript 来开发,确保项目质量的下限
- 支持云端网页不需要自己部署,且安装有好方便
- 角色卡内自带内嵌资源,不需要搭建图床和单独导入人物表情包
- 直接的 if 函数和算数宏,直接使用 lua 和 js
- button 宏支持，不用插件也可以原生写出带按钮的界面
- 卡片的开场和作者注可以多语言对应
- 内嵌有角色卡分享站
