# 测试说明

列出目前可运行的测试项、用途及运行方式。

## 测试列表
- 单元测试（Vitest）：覆盖音频处理、ASR 管理等核心逻辑。运行：`bun test`
  - 65 个测试通过
  - 7 个测试跳过（需要真实 WebSocket 连接的 ASRClient 测试，已移至集成测试）
- 集成测试（脚本）：端到端走通录音文件 → ASR → 文本润色。运行：`bun run scripts/integration-test.ts [wav路径]`
- 录音脚本：采集测试音频。运行：`bun run scripts/record-audio.ts [秒数]`
- TTS 生成脚本（macOS）：用系统 TTS 生成示例音频。运行：`bun run scripts/generate-test-audio.ts`

## 运行指引
1) 准备环境变量：在仓库根目录创建 `.env`，包含 `doubao_app_key` 和 `doubao_access_key`（必需），`transcribe_model_api_url`、`transcribe_model_api_key`、`transcribe_model`（可选，用于润色）。
2) 运行单元测试：`bun test`
3) 运行集成测试：
   - 如果已有录音：`bun run scripts/integration-test.ts /path/to/file.wav`
   - 如果没有录音：先执行 `bun run scripts/record-audio.ts 8` 或 `bun run scripts/generate-test-audio.ts`
4) 查看结果：脚本会打印识别文本和（如配置）润色结果。

## 测试架构说明
- **单元测试**：使用 Vitest 框架，测试独立函数和类的逻辑
  - 音频处理工具：36 个测试，覆盖格式转换、重采样、音量计算等
  - ASR Manager：15 个测试，覆盖会话管理、状态机、历史记录等
  - Rewrite Service：13 个测试，覆盖 API 调用、错误处理等
  - ASR Client：2 个测试（基础功能），7 个测试跳过（需要真实连接）
- **集成测试**：使用真实的豆包 ASR 服务进行端到端测试
  - 测试完整的音频 → 识别 → 润色流程
  - 需要有效的 API 凭证
  - 使用实际的音频文件

## 关于跳过的测试
由于 Bun 使用原生 WebSocket API（全局对象），无法使用传统的 Mock 方式测试 ASRClient 的 WebSocket 连接逻辑。这些测试已经标记为跳过，相关功能通过以下方式保证：
1. 集成测试脚本验证端到端功能
2. ASRManager 的单元测试覆盖了上层逻辑
3. 真实场景中的手动测试

## 状态记录（手动更新）
- 2026-01-20 单元测试：65 通过，7 跳过，0 失败
- 2026-01-20 集成测试：ASR 协议调整完成，使用无序列号模式发送音频包
