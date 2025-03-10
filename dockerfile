FROM denoland/deno:latest

WORKDIR /app

COPY . /app
RUN touch /app/.noupdate
RUN rm -rf /app/.git

EXPOSE 8931

# 给予 *.sh 执行权限
RUN find . -maxdepth 1 \( -name "*.sh" -o -name "*.fish" -o -name "*.zsh" \) -print0 | xargs -0 chmod +x
RUN find ./path -maxdepth 1 -type f -print0 | xargs -0 chmod +x

# 安装依赖并忽略错误
RUN /app/run.sh init

# 使用 run.sh 作为启动脚本，并且传递参数
ENTRYPOINT ["/app/run.sh"]
CMD []
