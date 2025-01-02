FROM denoland/deno:latest

WORKDIR /app

COPY . /app

EXPOSE 8931

# 给予 run.sh 执行权限
RUN chmod +x /app/run.sh

# 使用 run.sh 作为启动脚本
CMD ["/app/run.sh"]
