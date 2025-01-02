FROM denoland/deno:latest

WORKDIR /app

COPY . /app

EXPOSE 8931

# 给予 *.sh 执行权限
RUN chmod +x /app/*.sh

# 安装依赖
RUN deno install --allow-scripts --allow-all --node-modules-dir=auto --entrypoint "/app/src/server/index.mjs"

# 使用 run.sh 作为启动脚本，并且传递参数
ENTRYPOINT ["/app/run.sh"]
CMD []
