# EdgeOne + 硅基流动 AI 图片优化部署说明

## 架构

- 前端依然由 Next.js 静态导出到 `out`，图片上传、拼豆生成及下载功能不依赖后端。
- 新服务端 API：`cloud-functions/api/ai-optimize.js` → `POST /api/ai-optimize`。
- 服务端从 EdgeOne 环境变量读取 `SILICONFLOW_API_KEY`，调用硅基流动 `https://api.siliconflow.cn/v1/images/generations`。
- 默认模型：`Qwen/Qwen-Image-Edit-2509`，发送 `prompt` 和 `image`（PNG/JPG/WEBP Data URL）。
- 图片生成后由服务端即时下载，**通过 PNG/JPEG/WebP 文件签名识别真实格式**，返回同源图片二进制，浏览器存为 Data URL。解决硅基流动临时 URL 仅一小时有效、以及浏览器跨域下载受限的问题。SiliconFlow 的 `s3.siliconflow.cn` 可能返回 `Content-Type: application/octet-stream`，即使内容实际为 PNG；不能仅根据响应头判断图片类型。
- 服务端每次请求最长运行 120 秒（`edgeone.json`），上游模型调用限定 100 秒，图片下载每次最多 12 秒。超时会返回明确提示。

参考官方文档：
- [硅基流动生图/图生图 API](https://api-docs.siliconflow.cn/docs/api/images-generations-post)
- [EdgeOne Cloud Functions](https://pages.edgeone.ai/zh/document/node-functions)
- [EdgeOne edgeone.json](https://pages.edgeone.ai/zh/document/edgeone-json)

## 1. 配置密钥（必须）

在 [硅基流动控制台](https://cloud.siliconflow.cn/) 创建 API Key，并确认账户已开通对应图像编辑模型及可用额度。密钥属于敏感凭证，不要通过聊天发送，也不要提交至 GitHub。

进入 EdgeOne Makers/Pages 项目「项目设置 → 环境管理 → 生产环境（及需要的预览环境）→ 环境变量」，添加：

| 名称 | 内容 | 是否必须 |
|---|---|---|
| `SILICONFLOW_API_KEY` | 你自己的硅基流动 API Key | 是 |
| `SILICONFLOW_IMAGE_MODEL` | `Qwen/Qwen-Image-Edit-2509` | 否，默认使用此模型 |
| `AI_ALLOWED_ORIGINS` | 额外合法预览域名，完整 Origin，以英文逗号分隔（例如 `https://pindou-abc.edgeone.cool`） | 否；正式域名已内置 |

**变量名不要加 `NEXT_PUBLIC_` 前缀。** 配置完成后，在 EdgeOne 重新部署：环境变量变更不影响已发布的旧版本。

## 2. 项目构建参数

| 项目 | 值 |
|---|---|
| GitHub 仓库 | `YiZhanSuDaShui/PinDou` |
| 分支 | `main` |
| 安装命令 | `npm ci` |
| 构建命令 | `npm run build` |
| 静态输出目录 | `out` |
| 运行时配置 | `edgeone.json`：Node.js Cloud Function `maxDuration=120` |
| API 路由 | `/api/ai-optimize` |

构建后检查 EdgeOne「函数管理」是否识别到 `/api/ai-optimize`。单纯把 `out` 静态目录上传到 CDN **不会**部署函数；应通过包含 `cloud-functions` 目录的 GitHub 仓库方式构建。

## 3. 验收步骤

1. 打开 EdgeOne 的预览地址或 `https://pindou.sudashui.online`。
2. 上传 JPG/PNG，确认裁剪并生成像素预览。
3. 点击「AI 优化 → 开始优化」。硅基流动每次调用可能产生费用。
4. 出现编辑后预览时点击「使用此图」，确认拼豆预览重新生成。
5. 继续验证下载拼豆图纸。

**如果网站提示「不允许跨站点调用 AI 服务」**：确认已部署包含 [EdgeOne 自定义域名 Origin 校验修复](../cloud-functions/api/ai-optimize.js) 的最新 `main`。正式访问 `https://pindou.sudashui.online` 无需额外配置；如使用 EdgeOne 预览地址且被平台内部转发，可在生产/预览环境变量 `AI_ALLOWED_ORIGINS` 中添加**准确的**预览 Origin（例如 `https://pindou-abc.edgeone.cool`），不要填 `*` 或整个 `.edgeone.cool` 通配符。修改变量后须重新部署。

若提示「AI 服务尚未配置」说明 `SILICONFLOW_API_KEY` 缺失或当前部署未重新构建。若 429 是上游并发限额或请求过于频繁。 若日志出现 `INVALID_IMAGE_TYPE`，先检查是否部署包含 2026-11-10 PNG/JPEG/WebP 文件签名修复的最新 `main`；历史代码误将 CDN 的 `application/octet-stream` 直接当成无效图片。若 504 是 AI 请求超过超时限制，应缩小图片或稍后重试；最长 120 秒是 EdgeOne 平台限制，不保证所有模型请求均能完成。

## 4. 安全与成本

- API Key 永远只在服务端，服务器对传入的 MIME、Base64、大小和提示词进行校验。浏览器 `Origin` 将按固定正式域名和精确白名单校验，兼容 EdgeOne 反向代理改变内部请求主机的情况。不会将原始上游错误 JSON（其中可能含敏感信息）直接传给浏览器。
- **公网接口依然可能被他人重复调用并造成扣费。** 上线前建议在 EdgeOne 上对 `/api/ai-optimize` 配置 WAF/速率限制、验证码或访问控制；仅隐藏 Key **不等于**防滥用。
- EdgeOne Cloud Functions 单次请求与响应均有 6MB 限制，本实现对上传和结果大小有额外限制，过大的图片会提示错误。
- 硅基流动于 2026 年调整了图像生成显式水印策略。当前代码遵循服务默认水印行为，不私自禁用。如需移除显式水印用于下游加工，请先阅读官方合规要求。
- 此仓库有其他历史 `npm audit` 依赖告警，AI 接口迁移不会自动消除此类风险。

## 5. 开发和验证

- 不需要真实 Key 的模拟接口单元测试：`node scripts/test-siliconflow-api.mjs`
- Next.js 构建：`npm run build`
- GitHub Actions：`.github/workflows/verify-home.yml`（会执行以上接口单测、网站构建及浏览器测试）。

> 注意：CI 使用模拟硅基流动响应，不产生 API 费用；真正的线上模型调用仍需配置密钥后在 EdgeOne 验证。
