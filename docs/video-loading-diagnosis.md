# T6 教程视频加载优化 · 调研报告

> issue #60 · 2026-09-30 · worktree `t6-video-loading`
> 结论先行：**主根因是资产交付链路（R2 公开桶从国内实测仅 ~125KB/s、TTFB 1–3.2s），
> 次根因是女版视频码率超标 10–20 倍（8.5–15 Mbps）**；播放器配置本身（preload=metadata
> + poster + 懒挂载）已是正确形态。本次已在代码内落地连接预热与缓冲反馈；
> 转码与资产迁移需拍板后执行。

---

## 一、调研证据

### 1.1 资产形态（ffprobe 实测样本，2026-09-30）

资产源：Cloudflare R2 公开桶 `pub-585d42eb1aa64a67aedf483ec328d3fe.r2.dev`
（代码证据：`src/demo/DemoA8A9.tsx:20`、`src/components/picker/pickerData.ts:252`；
DB `exercises.video_urls` 存该域绝对 URL，`normalizeSources.ts:226` 透传入库）。

| 样本 | 编码 | 分辨率 | 码率 | 时长 | 体积 | moov 位置 |
| --- | --- | --- | --- | --- | --- | --- |
| male/hanging-leg-hip-raise | h264 High | 1920×1080 | 0.86 Mbps | 6.6s | 710KB | **尾部** ❌ |
| male/cable-lying-fly-flat-bench-cable-fly | h264 CB | 1920×1080 | 1.23 Mbps | 6.6s | 1.0MB | 头部 ✓ |
| male/stretching-feet-and-ankles-stretch | h264 High | 1920×1080 | 0.21 Mbps | 6.1s | 160KB | **尾部** ❌ |
| female/crunch-floor-female | h264 Main | 1920×1080 | **8.5 Mbps** | 5.2s | 5.6MB | 头部 ✓ |
| female/corkscrew-pilates | h264 High | 1920×1080 | **15.0 Mbps** | 12.0s | **22.9MB** | 头部 ✓ |

规模抽样（HEAD 采样 31 个文件）：

- 男版 15 个：均值 **493KB**，合计 7MB —— 健康
- 女版 16 个：均值 **9MB**，合计 146MB —— **男版的 ~18 倍**

结论：
1. 女版为高清原片直出（8.5–15 Mbps），6–12 秒的演示clip完全不需要这个码率；
2. moov atom 位置混杂——部分文件 moov 在尾部（非 faststart），起播前浏览器需先
   Range 探测文件尾部再回头取数据，多 1–2 个 RTT（浏览器 Network 面板可见同一 mp4
   出现 3 次分段请求，截图证据 `screenshots-t6/01`；curl 亦证实 R2 支持 206）。

### 1.2 交付链路（curl 实测，2026-09-30）

**R2 公开桶（当前生产实际使用的源）**

```text
Range 请求 → 206 Partial Content ✓（Content-Range/Accept-Ranges 齐全）
吞吐（4 次全量下载）：112–134 KB/s（≈1 Mbps）
TTFB：1.04 / 1.19 / 1.88 / 2.19 / 3.23 s；其中 TLS 握手 0.6–2.75s
出口 POP：LAX（CF-RAY 实测），用户网络到 R2 公开域链路差
全量下载耗时：710KB 男版 5.3–6.3s；5.6MB 女版 45.2s
```

对照：**用户自建服务器 zenthos.top（阿里云 ECS+OpenResty）TTFB 0.089s**——与
R2 公开域差 12–36 倍。任务书所述「自建 OSS+按需 CDN」目前并未承载这些资产，
`video_urls` 仍指向 r2.dev 公开开发域（该域官方定位即非生产用途）。

**后端代理路径（`/uploads/*`，仅 assets_json 自传视频走）**

- `@fastify/static@8.3.0`（`backend/src/server.ts:270`），最小实例实测
  `Range: bytes=0-1023` → **206** + `accept-ranges: bytes` ✓（send 库原生支持，
  代码未关闭）；
- 但响应头为 `cache-control: public, max-age=0`——无缓存窗口，重复观看需反复回源。

**iOS 壳**：Capacitor WKWebView 直接加载远程绝对 URL（capacitor.config.ts 未做
任何媒体代理），即视频流量形态与 Safari 一致，Range 能力取决于源站（R2 ✓）。

### 1.3 播放器配置（改动前现状）

- `VideoPlayerModal.tsx`：单 `<video>`、`preload="metadata"` ✓、poster ✓、
  仅在弹层打开时挂载（`isOpen` 短路）✓、预览条缩略图 `loading="lazy"` ✓；
- `ExerciseTutorialModal.tsx`：点「观看演示」才进播放器 ✓；
- 列表/教程页**无**多处同时挂载 video 的问题；
- 缺失项：① 打开教程到点播放之间的冷连接（DNS+TCP+TLS 0.6–2.75s）无预热；
  ② 播放中缓冲（慢链路必然发生）无任何视觉反馈，冻结帧即「加载慢」的体感来源。

### 1.4 根因排序

| # | 根因 | 量级 | 归属 |
| --- | --- | --- | --- |
| 1 | 资产源链路：r2.dev 公开域 ~125KB/s + 1–3s TTFB，海报/视频全慢 | 决定性 | 资产迁移（待拍板） |
| 2 | 女版码率 8.5–15 Mbps（均值 9MB/条） | 重大 | 转码（待拍板） |
| 3 | 部分文件 moov 在尾部，起播多 1–2 RTT | 中 | 与转码同批处理 |
| 4 | 冷连接握手未预热、缓冲无反馈 | 中 | **本次已修** |
| 5 | `/uploads/*` max-age=0 无缓存 | 低（主路径不走此） | 待拍板 |

---

## 二、已实施改动

| 文件 | 改动 |
| --- | --- |
| `src/lib/assetPreconnect.ts`（新） | 资产源幂等预热：按 origin 注入 `<link rel=preconnect>` + `dns-prefetch` 兜底；video/img 均 no-cors，故不带 crossorigin |
| `src/components/execution/ExerciseTutorialModal.tsx` | 教程数据到达即对封面/视频源预热——与正文阅读时间重叠，摊平冷握手 |
| `src/components/execution/VideoPlayerModal.tsx` | ① 打开即预热（与教程页互相幂等去重）；② `waiting/stalled/playing/canplay` 缓冲反馈：转圈 + 「缓冲中…」浮层（pointer-events-none，可继续点画面暂停）；③ 源切换/重开时复位缓冲态 |
| `src/lib/__tests__/assetPreconnect.test.ts`（新） | 4 用例：注入/幂等/多源/非法输入静默忽略 |

不新增依赖、不发明缓存框架、不动转码与 OSS 资产。

## 三、验证证据

| 门 | 结果 |
| --- | --- |
| `env -u NODE_ENV npm run typecheck` | 0 错 |
| `env -u NODE_ENV npx vitest run` | **498 passed**（基线 494 + 新增 4，无回归） |
| `env -u NODE_ENV npm run build` | 成功（5.81s） |
| 后端 Range（未改后端，取证性质） | 最小 @fastify/static@8.3.0 实例 206 ✓ |
| 浏览器实测（vite :43120 + `a8a9-demo.html?video=1`） | preconnect/dns-prefetch 注入 DOM ✓；`preload="metadata"` + poster ✓；metadata 仅拉元数据（同一 mp4 出现 3 次分段 Range 探测=moov 在尾部实证）；男版完整播至 6.57s ✓；`waiting`→转圈出现、`playing`→消失 ✓；截图 `docs/design/screenshots-t6/01–03` |

## 四、待用户拍板项（未实施，按预期收益排序）

### ① 资产迁离 r2.dev 公开域（收益最大）

迁至自建 OSS+按需 CDN（zenthos.top 实测 TTFB 0.089s，快 12–36 倍），或 R2 绑
自定义域名走 Cloudflare 正式 CDN。落地动作：批量改 `exercises.video_urls` /
`image_refs` / `poster_url` 的域前缀（一次 SQL UPDATE + 前端无感知，URL 为绝对
http 直连）+ 资产搬运。**搬运与 DB 变更需用户确认后执行。**

### ② 女版视频转码（体积降 ~85–90%）

演示视频 6–12s、手机竖屏观看，1080p@8.5–15Mbps 严重过剩。建议规格：
720p / h264 / CRF 23 / 30fps / faststart（男版已是该量级，仅处理女版即可）：

```bash
# 单条验证（先转 1 条人工比对画质，再批量）：
ffmpeg -i in.mp4 -vf scale=-2:720 -c:v libx264 -crf 23 -preset medium \
  -an -movflags +faststart -y out.mp4
# 批量（确认后执行；输出后同 key 重传 OSS/R2，DB 无需变更）：
for f in female/*.mp4; do
  ffmpeg -i "$f" -vf scale=-2:720 -c:v libx264 -crf 23 -preset medium \
    -an -movflags +faststart -y "out/$(basename "$f")";
done
```

预估：女版均值 9MB → ~1MB（-89%），全库体积大幅回落；在现有 ~1Mbps 链路上
720p@CRF23（≈1–1.5 Mbps）也可基本顺播。

### ③ moov 修尾部（可与 ② 合并）

上面命令 `-movflags +faststart` 已含。若不做转码，仅补 faststart 也可单做：
`ffmpeg -i in.mp4 -c copy -movflags +faststart out.mp4`（无损、秒级）。

### ④ `/uploads/*` 静态缓存窗口（低优先）

`@fastify/static` 注册处加 `maxAge: '1h'` 类配置，减少 assets_json 自传视频
重复回源；因主教程路径不走后端，收益有限，且需权衡 admin 重传后的一致性。

---

## 附：复测命令速查

```bash
# Range 支持
curl -s -D - -o /dev/null -H "Range: bytes=0-1023" <video-url>
# 吞吐/TTFB
curl -s -o /dev/null -w "ttfb=%{time_starttransfer}s total=%{time_total}s speed=%{speed_download}B/s\n" <video-url>
# moov 位置（top-level atom 顺序，moov 在 mdat 前为 faststart）
ffprobe -v trace <file> 2>&1 | grep -m4 "type:'m"
```
