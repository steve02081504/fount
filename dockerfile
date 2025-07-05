FROM denoland/deno:latest

WORKDIR /app

COPY . /app
RUN touch /app/.noupdate && touch /.dockerenv

EXPOSE 8931
EXPOSE 16698

# 给予 *.sh 执行权限
RUN find . -maxdepth 1 \( -name "*.sh" -o -name "*.fish" -o -name "*.zsh" \) -print0 | xargs -0 chmod +x
RUN find ./path -maxdepth 1 -type f -print0 | xargs -0 chmod +x

# 安装依赖并忽略错误
RUN /app/run.sh init || true
RUN rm -rf /.dockerenv

# 使用 run.sh 作为启动脚本，并且传递参数
ENTRYPOINT ["/app/run.sh"]
CMD []
