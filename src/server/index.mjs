import express from 'express';
import path from 'path';
export const app = express();
const port = 8931;

let __dirname = path.resolve();

// 定义路由，host所有在src/pubilc目录下的文件
app.use(express.static(__dirname + '/src/public'));

// 启动服务器
app.listen(port, () => {
	console.log(`服务器运行在 http://localhost:${port}`);
});
