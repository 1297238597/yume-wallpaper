# 部署 YUME 到线上

这份指南面向当前项目（Node.js 服务 + 静态前端 + `sharp` 图片处理），不是纯静态站点。

## 先确认三件事

1. **不能直接丢到纯静态托管**  
   项目里的 `/api/wallpapers`、`/api/thumb/:id`、`/api/download/:id` 都由 `server.mjs` 提供。Wallhaven 的接口本身没有开放浏览器跨域，所以必须有 Node 服务做代理。
2. **运行环境需要能访问壁纸源**  
   默认出站地址是 `wallhaven.clbug.com` 与 `w.clbug.com` / `th.wallhaven.clbug.com`。如果服务器网络无法访问，改 `WALLHAVEN_BASE` 或换机房。
3. **需要可写缓存目录**  
   `sharp` 生成的 WebP 缩略图和预览图会写入 `.cache/`。容器部署建议挂载 `/app/.cache`；不挂也能运行，只是重启后缓存会重建。

## 方案怎么选

| 方案 | 适合场景 | 成本 | 难度 | 备注 |
| --- | --- | --- | --- | --- |
| Render | 快速上线、演示、个人项目 | 有免费档 | ★ | 免费实例闲置会休眠，缓存不持久 |
| Railway | 快速上线、需要简单扩容 | 按量付费 | ★ | 支持 Docker、域名、持久卷 |
| VPS + Docker + Nginx/Caddy | 长期稳定、国内访问、可控 | 服务器费用 | ★★ | 推荐正式部署 |
| VPS + systemd | 已有 Node 环境、不想用 Docker | 服务器费用 | ★★ | 本项目附带 systemd 模板 |
| Vercel / Netlify / Pages | 仅静态站 | 有免费档 | ★★★ | 当前项目不能直接部署，需重写 API 为 Serverless Function |

> 如果主要面向中国大陆用户：优先考虑香港、新加坡等境外区域，避免 ICP 备案；如果放在大陆服务器，域名通常需要完成 ICP 备案，80/443 才能正常绑定。

---

## 方案一：Render（最快，可免费）

Render 会读取仓库根目录的 [`render.yaml`](render.yaml) 和 [`Dockerfile`](Dockerfile)。

### 1. 把代码推到 GitHub

本机需要先安装 Git 和 GitHub 账号。

```bash
git init
git add .
git commit -m "deploy yume wallpaper"
git branch -M main
git remote add origin https://github.com/你的用户名/yume-wallpaper.git
git push -u origin main
```

`.gitignore` 已经排除了 `node_modules/` 和 `.cache/`，不会把依赖和缓存提交上去。

### 2. 在 Render 创建服务

1. 打开 [render.com](https://render.com/) 并登录。
2. **New + → Blueprint**，选择刚推送的仓库。
3. Render 会识别 `render.yaml`；确认 Region 为 `Singapore`，Plan 为 `Free`。
4. 如果没有识别到 Blueprint，就手动 **New + → Web Service → Docker**：
   - Root Directory：仓库根目录
   - Dockerfile Path：`./Dockerfile`
   - Health Check Path：`/api/health`
5. 环境变量按需填写：

```text
HOST=0.0.0.0
WALLHAVEN_BASE=https://wallhaven.clbug.com/api/v1
SEARCH_EXCLUSIONS=-suggestive
# 可选
WALLHAVEN_API_KEY=你的_key
```

`PORT` 不要手填，Render 会自动注入。

### 3. 访问和绑定域名

部署完成后，Render 会给出：

```text
https://yume-wallpaper-xxxx.onrender.com
```

先打开 `/api/health` 确认返回 `"ok": true`，再打开首页。

绑定自定义域名：**Settings → Custom Domain**，按提示添加 CNAME。HTTPS 证书由 Render 自动签发。

### 4. 注意免费档限制

- 免费实例 15 分钟无请求会休眠，下一次访问需要几十秒冷启动。
- 免费档没有持久磁盘，重启后 `.cache` 会清空，图片需要重新生成。
- 正式运营建议升级付费实例，并挂载持久磁盘到 `/app/.cache`。

---

## 方案二：Railway

项目已经包含 [`railway.toml`](railway.toml)，会使用 Dockerfile 构建。

1. 把代码推到 GitHub（同上）。
2. 打开 [railway.app](https://railway.app/) → **New Project → Deploy from GitHub repo**。
3. 选择仓库，Railway 自动识别 Dockerfile 并部署。
4. 在 **Variables** 添加：

```text
HOST=0.0.0.0
WALLHAVEN_BASE=https://wallhaven.clbug.com/api/v1
SEARCH_EXCLUSIONS=-suggestive
```

5. 在 **Settings → Networking → Generate Domain** 生成公网域名。
6. 可选：添加 Volume，挂载路径 `/app/.cache`，避免缩略图缓存丢失。

Railway 的 `PORT` 也由平台自动注入。

---

## 方案三：VPS + Docker + Nginx（推荐正式部署）

以下以 Ubuntu 22.04/24.04 为例，域名以 `wallpaper.example.com` 代替。

### 1. 准备服务器和 DNS

- 购买一台能访问目标壁纸源的 VPS（香港/新加坡/日本通常更省事）。
- 在域名服务商添加 A 记录：`wallpaper.example.com → 服务器公网 IP`。
- 云厂商安全组放行 `22`、`80`、`443`。

### 2. 安装 Docker

```bash
sudo apt update
sudo apt install -y git
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
newgrp docker
```

### 3. 上传项目并启动

```bash
cd /opt
sudo git clone https://github.com/你的用户名/yume-wallpaper.git
cd yume-wallpaper

# 按需修改环境变量
sudo nano docker-compose.yml

sudo docker compose up -d --build
sudo docker compose ps

curl http://127.0.0.1:4173/api/health
```

`docker-compose.yml` 已经把服务绑定到 `127.0.0.1:4173`，不会直接暴露公网；由 Nginx/Caddy 转发。

### 4. 配置 Nginx 反向代理

```bash
sudo apt install -y nginx

sudo cp deploy/nginx.conf /etc/nginx/sites-available/yume.conf
sudo sed -i 's/wallpaper.example.com/你的真实域名/g' /etc/nginx/sites-available/yume.conf
sudo ln -s /etc/nginx/sites-available/yume.conf /etc/nginx/sites-enabled/yume.conf

sudo nginx -t
sudo systemctl reload nginx
```

这份配置把 `/` 全部转发到 `127.0.0.1:4173`，并对图片生成和原图下载设置了 180 秒超时。

### 5. 自动 HTTPS

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d 你的真实域名
```

Certbot 会自动申请 Let's Encrypt 证书并续期。完成后访问：

```text
https://你的真实域名
```

### 6. 更新版本

```bash
cd /opt/yume-wallpaper
sudo git pull
sudo docker compose up -d --build
```

### 7. 如果想用 Caddy

Caddy 会自动申请 HTTPS，不需要额外执行 certbot。参考 [`deploy/Caddyfile`](deploy/Caddyfile)：

```bash
sudo apt install -y caddy
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo sed -i 's/wallpaper.example.com/你的真实域名/g' /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

---

## 方案四：VPS + systemd（不用 Docker）

适合已经有 Node.js 22 的服务器。

### 1. 安装 Node.js 和 pnpm

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pnpm@12.21.0
node -v
pnpm -v
```

### 2. 上传并安装依赖

```bash
sudo mkdir -p /opt/yume
sudo chown -R "$USER":"$USER" /opt/yume
# 将项目文件上传到 /opt/yume，或 git clone 到该目录
cd /opt/yume

pnpm install --prod --frozen-lockfile
mkdir -p .cache
sudo chown -R www-data:www-data /opt/yume
```

### 3. 注册 systemd 服务

```bash
sudo cp deploy/yume.service /etc/systemd/system/yume.service
sudo systemctl daemon-reload
sudo systemctl enable --now yume
sudo systemctl status yume
```

查看日志：

```bash
journalctl -u yume -f
```

如果要放敏感环境变量，写入 `/etc/yume.env`：

```bash
sudo nano /etc/yume.env
```

```dotenv
HOST=0.0.0.0
PORT=4173
WALLHAVEN_BASE=https://wallhaven.clbug.com/api/v1
SEARCH_EXCLUSIONS=-suggestive
# WALLHAVEN_API_KEY=你的_key
```

然后重启：

```bash
sudo systemctl restart yume
```

### 4. 配置 Nginx + HTTPS

同方案三的第 4、5 步。

> systemd 模板使用 `/usr/bin/node`。如果你用 nvm 安装 Node，需要把 `ExecStart` 改成实际的 Node 路径。

---

## 临时给朋友看：Cloudflare Tunnel

如果只是临时演示，不想买服务器，可以在本机运行：

```bash
cloudflared tunnel --url http://127.0.0.1:4174
```

终端会打印一个 `https://xxx.trycloudflare.com` 地址。它的限制是：你的电脑必须开着，本地服务必须运行；不适合正式上线。

---

## 环境变量说明

| 变量 | 必填 | 示例 | 说明 |
| --- | --- | --- | --- |
| `HOST` | 容器/PaaS 建议 | `0.0.0.0` | 默认 `127.0.0.1`；放公网必须改 |
| `PORT` | 平台自动注入 | `4173` | 本地可指定；PaaS 不要覆盖 |
| `WALLHAVEN_BASE` | 否 | `https://wallhaven.clbug.com/api/v1` | 壁纸 API 地址；官方为 `https://wallhaven.cc/api/v1` |
| `WALLHAVEN_API_KEY` | 否 | `xxxx` | 官方 API Key；公开部署建议配置 |
| `SEARCH_EXCLUSIONS` | 否 | `-suggestive` | 追加到搜索词后的排除标签；留空即不排除 |
| `ALLOWED_IMAGE_HOSTS` | 否 | `wallhaven.cc,wallhaven.clbug.com` | 服务端允许抓取的图片域名 |
| `NODE_ENV` | 否 | `production` | 生产环境 |

---

## 上线验收清单

```bash
# 1. 服务存活
curl https://你的域名/api/health

# 2. 首页可访问，注意 CSP 和缓存头
curl -I https://你的域名/

# 3. API 能拿到壁纸
curl "https://你的域名/api/wallpapers?page=1&sorting=favorites" | head -c 300

# 4. 预览图能生成
curl -I "https://你的域名/api/preview/z8gr9y"

# 5. 下载接口
curl -I "https://你的域名/api/download/d6gjo3"
```

然后在手机浏览器打开，依次检查：搜索、筛选、收藏、详情弹窗、下载、深色/明亮主题。

---

## 常见问题

### 页面能打开，但图片全部空白 / 502

服务器无法访问图片源，或 `sharp` 生成失败。

```bash
# 在服务器上测试出站访问
curl -I "https://w.wallhaven.clbug.com/full/6l/wallhaven-6le97q.jpg"
```

- 如果域名不通，换 `WALLHAVEN_BASE` 或换一个能访问的机房。
- 如果使用官方 API，请配置 `WALLHAVEN_API_KEY`。
- 容器内可以执行 `docker compose logs -f` 查看 `[YUME]` 日志。

### 部署后只能通过 `localhost` 访问

`HOST` 仍是默认的 `127.0.0.1`。改成：

```text
HOST=0.0.0.0
```

Dockerfile 和 compose 已经设置，使用自建 systemd 时要注意。

### 上传后端口不对

平台会注入 `PORT`。不要固定写死 `EXPOSE` 之外的端口；本项目会读取 `process.env.PORT`。本地没有 `PORT` 时，如果 4173 被占用会自动顺延。

### 返回 429 / 图片加载很慢

Wallhaven 的公共 API 有频率限制（约 45 次/分钟）。项目内有搜索缓存和图片缓存，但公开流量较大时建议：

- 配置官方 `WALLHAVEN_API_KEY`；
- 使用持久化 `.cache`；
- 在 Cloudflare 前增加缓存和限流；
- 或升级到独立部署并控制访问频率。

### 免费平台一段时间后第一次访问很慢

Render 免费实例会休眠，冷启动通常几十秒。正式使用请升级付费实例，或选择 VPS。

### 国内打开慢 / 域名无法访问

- 大陆服务器 + 大陆域名：完成 ICP 备案。
- 不想备案：选择香港/新加坡/日本机房，但大陆访问质量取决于线路。
- 平台域名（`onrender.com`、`railway.app`）在部分网络环境可能不稳定，正式站建议绑定自己的域名。

---

## 关于 Vercel / Netlify / Cloudflare Pages

当前项目不能直接作为纯静态站部署，因为：

- Wallhaven API 不提供浏览器可用的 CORS 头，必须由 Node 代理；
- 图片缩略图依赖 `sharp`；
- 需要 `.cache` 写入（至少当前实现如此）。

如果一定要用 Serverless，需要把 `server.mjs` 中的 `/api/wallpapers`、`/api/thumb`、`/api/download` 改写成平台函数，并把图片缓存换成对象存储（如 R2 / S3）。这是另一套架构，不是简单拖拽部署。
