1. home处的char导入导出按钮
  * 导入按钮
    - 1.1.1 前端需求：
      * 点击后跳转至install shell主界面：上半部分多行文本输入框，下半部分文件拖拽选择，再加一个确认按钮
      * 确认按钮点击后，后端使用`src\public\shells\install\src\server\Installer_handler.mjs`的逻辑进行导入
    - 1.1.2 后端需求：
      * 在`src\public\charTemplates\fount\main.mjs`中实现zip解压（文件）和自github url clone（文本）的逻辑
	  * 现有的char用于测试导入：`https://github.com/steve02081504/GentianAphrodite`

2. chat shell的角色列表
  - 4.1 前端需求：
	* 在chat页面实现角色列表，供用户预览/添加/移除角色或用按钮触发角色的回复生成
  - 4.2 后端需求：
	* 入口点齐全，无需实现

3. 新的shell用于导入/导出AIsource/编辑/删除/新建AIsource/设置角色的AIsource
  - 实现新的shell用于做这些事

4. 主页美化
  - 在主页实现一个下拉列表，用于选择shell
  - 在shell的API约定中追加文件路径规定或函数约定使得shell可以提供界面在主页显示
  - 对现有的shell追加和适配主页浏览需求
    * chat shell:
	  - 浏览/新建/删除/进入聊天
	* AIsource setting shell:
	  - 简易的AIsource设置界面
	* discordbot shell:
	  - 浏览和启动bot

5. discord bot shell的bot新建/编辑/删除UI
  - 创建一个界面供用户选择新建/编辑/删除bot
