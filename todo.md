1. home处的char导入导出按钮
  * 导入按钮
    - 1.1.1 前端需求：
      * 点击后弹出窗口 上半部分多行文本输入框，下半部分文件拖拽选择，再加一个确认按钮
      * 确认按钮点击后，后端使用`src\server\Installer_handler.mjs`的逻辑进行导入
    - 1.1.2 后端需求：
      * 在`src\public\charTemplates\fount\main.mjs`中实现zip解压（文件）和自github url clone（文本）的逻辑
	  * 现有的char用于测试导入：`https://github.com/steve02081504/GentianAphrodite`

2. chat shell的消息左右切换
  - 2.1 前端需求：
    * 在chat页面实现消息左右下角两个箭头，点击触发左右切换
  - 2.2 后端需求：
	* 在`src\public\shells\chat\src\server\chat.mjs`中实现左右切换的后端逻辑支持
	  - 对于来自char的greeting，左右切换在其提供的数组中切换
	  - 对于后续的来自char的reply，右侧切换在超出数组长度时触发新的回复调用，否则切换至过往回复
	  - 当一个chatLogEntry的后续有消息时实现后续消息的切换

3. chat shell的消息删除/编辑
  - 3.1 前端需求：
	* 在chat页面实现消息删除/编辑
  - 3.2 后端需求：
	* 在`src\public\shells\chat\src\server\chat.mjs`中实现删除/编辑的后端逻辑支持
	  - 对于来自char的的reply，编辑应当触发char的`interfacies.chat.MessageEdit`逻辑，并以该函数返回值作为最终编辑结果。
	  - 当一个chatLogEntry的`content_for_edit`不为空时，编辑窗口中的内容为`content_for_edit`，否则为`content`。

4. chat shell的角色列表
  - 4.1 前端需求：
	* 在chat页面实现角色列表，供用户预览/添加/移除角色或用按钮触发角色的回复生成
  - 4.2 后端需求：
	* 入口点齐全，无需实现

5. 新的shell用于导入/导出AIsource/编辑/删除/新建AIsource/设置角色的AIsource
  - 实现新的shell用于做这些事

6. 主页美化
  - 在主页实现一个下拉列表，用于选择shell
  - 在shell的API约定中追加文件路径规定或函数约定使得shell可以提供界面在主页显示
  - 对现有的shell追加和适配主页浏览需求
    * chat shell:
	  - 浏览/新建/删除/进入聊天
	* AIsource setting shell:
	  - 简易的AIsource设置界面
	* discordbot shell:
	  - 浏览和启动bot

7. discord bot shell的bot新建/编辑/删除UI
  - 创建一个界面供用户选择新建/编辑/删除bot

8. 界面美化
  - 看情况随便搞搞 不太难看就行
  - 可以的话请统一使用daisyui（自cdn导入）
