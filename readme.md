# fount

![repo img](https://repository-images.githubusercontent.com/862251163/3b57d9ea-ab18-4b70-b11d-f74c764016aa)

[![Discord](https://img.shields.io/discord/1288934771153440768)](https://discord.gg/GtR9Quzq2v)

> [!CAUTION]
>
> 1. 处于开发的初期,不存在稳定性
> 2. 角色可以随意运行 js 命令操作计算机本地文件

## 安装

Linux/macOS：

```bash
# 若需要，定义环境变量$FOUNT_DIR来指定fount目录
curl -fsSL https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.sh | bash
```

Windows：

```pwsh
# 若需要，定义环境变量$env:FOUNT_DIR来指定fount目录
irm https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.ps1 | iex
```

或者下载[release](https://github.com/steve02081504/fount/releases)中的exe文件，直接运行即可。

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
