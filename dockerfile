FROM denoland/deno:latest

WORKDIR /app

COPY . /app

EXPOSE 8931

# 给予 *.sh 执行权限
RUN chmod +x ./*.sh ./*.fish ./*.zsh ./path/*

# 安装依赖并忽略错误
RUN /app/run.sh init

# 使用 run.sh 作为启动脚本，并且传递参数
ENTRYPOINT ["/app/run.sh"]
CMD []
