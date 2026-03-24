# 阶段1：构建前端应用
FROM oven/bun:latest AS builder

WORKDIR /build
# 复制依赖文件
COPY web/package.json ./
COPY web/bun.lock ./
# 安装依赖（不锁定锁文件，先解决核心问题）
RUN bun install
# 复制前端代码和版本文件
COPY ./web ./
COPY ./VERSION ./

# 关键修复：直接调用Vite的实际CLI入口文件，彻底绕过.bin软链接
RUN DISABLE_ESLINT_PLUGIN='true' \
    VITE_REACT_APP_VERSION=$(cat VERSION) \
    bun run /build/node_modules/vite/bin/vite.js build

# 阶段2：构建Go应用
FROM golang:alpine AS builder2
ENV GO111MODULE=on CGO_ENABLED=0
ARG TARGETOS
ARG TARGETARCH
ENV GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH:-amd64}
ENV GOEXPERIMENT=greenteagc

WORKDIR /build

ADD go.mod go.sum ./
RUN go mod download

COPY . .
COPY --from=builder /build/dist ./web/dist
RUN VERSION=$(cat VERSION) && \
    go build -ldflags "-s -w -X 'github.com/QuantumNous/new-api/common.Version=${VERSION}'" -o new-api

# 阶段3：最终运行镜像
FROM debian:bookworm-slim

ENV TZ=Asia/Shanghai
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates tzdata libasan8 wget \
    && rm -rf /var/lib/apt/lists/* \
    && update-ca-certificates \
    && apt-get clean

COPY --from=builder2 /build/new-api /usr/local/bin/new-api
EXPOSE 3000
WORKDIR /data
ENTRYPOINT ["/usr/local/bin/new-api"]
