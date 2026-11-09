# XinXinXin 的拼豆基地

一个将图片转换为拼豆图纸的小工具。

网站：https://pindou.sudashui.online

## 功能

- 上传、裁剪图片并生成像素化拼豆底稿
- 调整颗粒大小、配色和色号系统，去除杂色，手动修改颜色
- 使用硅基流动 `Qwen/Qwen-Image-Edit-2509` 优化图片（可选）
- 下载 PNG 图纸和 CSV 颜色用量清单

## 本地运行

```bash
npm ci
npm run dev
```

打开 http://localhost:3000 。

## 部署

使用 Next.js 静态导出与 EdgeOne Makers Cloud Functions：

- 构建命令：`npm run build`
- 输出目录：`out`
- AI 接口：`/api/ai-optimize`
- 环境变量：`SILICONFLOW_API_KEY`（仅服务端）

部署细节见 [EdgeOne 部署说明](docs/edgeone-siliconflow-deployment.md)。

## 致谢与许可

基于 [Zippland/perler-beads](https://github.com/Zippland/perler-beads) 改造。许可证见 [LICENSE](LICENSE)。
