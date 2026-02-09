# 阶段一：跑 terser，压缩并移除所有 JS 注释
FROM --platform=$BUILDPLATFORM denoland/deno:alpine-2.6.7 AS terser-builder
WORKDIR /app
COPY . /app

RUN echo '{\
	"module": true,\
	"compress": {},\
	"mangle": false,\
	"output": {\
		"semicolons": false\
	},\
	"parse": {\
		"bare_returns": true\
	},\
	"rename": {}\
}' > /app/terser.config.json

RUN find . -type f \( -name "*.mjs" -o -name "*.js" \) ! -path "./node_modules/*" -print0 \
    | xargs -0 -P $(nproc) -I {} deno run -A npm:terser {} --config-file /app/terser.config.json --output {}

RUN rm -rf /app/node_modules /app/terser.config.json

# 阶段二：跑 minify，压缩并移除所有无用的html、css、json、svg、xml等文件
FROM --platform=$BUILDPLATFORM tdewolff/minify:latest AS minify-builder
WORKDIR /app
COPY --from=terser-builder /app /app

RUN find . -type f \( -name "*.html" -o -name "*.css" -o -name "*.json" -o -name "*.svg" -o -name "*.xml" \) ! -path "./node_modules/*" -print0 \
    | xargs -0 -P $(nproc) -I {} sh -c 'minify -o {} {} || echo "Warning: Failed to minify {}, skipping."'

# 阶段三：最终运行时镜像
FROM denoland/deno:alpine-2.6.7
WORKDIR /app
COPY --from=minify-builder /app /app
RUN touch /app/.noupdate && touch /.dockerenv

EXPOSE 8931
EXPOSE 16698

# 给予 *.sh 执行权限
RUN find . -type f \( -name "*.sh" -o -name "*.fish" -o -name "*.zsh" \) -print0 | xargs -0 chmod +x
RUN find ./path -maxdepth 1 -type f -print0 | xargs -0 chmod +x

# 安装依赖并忽略错误
RUN /app/run.sh init || true
RUN rm -rf /.dockerenv

# 使用 run.sh 作为启动脚本，并且传递参数
ENTRYPOINT ["/app/run.sh"]
CMD []
