# Voice ASR 模块开发文档

> 本文档面向前端开发人员，介绍 ASR（语音识别）模块的架构设计、API 使用方式以及与渲染进程的集成方法。

---

## 1. 概述

Voice 是一个基于 Electron 的智能语音输入法。ASR 模块负责：

1. **流式语音识别** - 使用字节跳动「豆包」API 将语音实时转写为文本
2. **文本润色** - 使用 LLM 去除语气词、修正语法
3. **会话管理** - 管理录音会话的生命周期和历史记录

---

## 2. 目录结构

```
app/
├── main/                          # 主进程代码
│   ├── asr/                       # ASR 模块
│   │   ├── index.ts               # 模块导出
│   │   ├── asr-client.ts          # WebSocket 客户端（底层协议）
│   │   ├── asr-manager.ts         # 会话管理器（高层 API）
│   │   ├── audio-processor.ts     # 音频处理工具
│   │   └── __tests__/             # 单元测试
│   └── rewrite/                   # 文本润色模块
│       └── index.ts
│
├── preload/                       # 预加载脚本（待实现）
│   └── index.ts
│
├── renderer/                      # 渲染进程（待实现）
│   └── ...
│
└── shared/                        # 共享类型
    ├── index.ts
    └── types/
        └── asr.ts                 # ASR 相关类型定义
```

---

## 3. 核心模块 API

### 3.1 ASRManager（推荐使用）

`ASRManager` 是面向应用层的高级 API，封装了会话生命周期管理。

```typescript
import { ASRManager } from "@main/asr";

// 创建管理器
const manager = new ASRManager({
  appKey: process.env.doubao_app_key!,
  accessKey: process.env.doubao_access_key!,
  autoSaveHistory: true,
  maxHistorySize: 100,
});

// 监听事件
manager.on("state-change", (event) => {
  console.log("状态变更:", event.state);
});

manager.on("result", (event) => {
  if (event.result?.isPartial) {
    console.log("实时识别:", event.result.text);
  } else {
    console.log("最终结果:", event.result?.text);
  }
});

// 开始会话
await manager.startSession();

// 发送音频数据（PCM 16bit 16kHz 单声道）
await manager.sendAudio(pcmData);

// 停止会话并获取结果
const result = await manager.stopSession();
```

### 3.2 ASRClient（底层 API）

如需更细粒度的控制，可直接使用 `ASRClient`：

```typescript
import { ASRClient } from "@main/asr";

const client = new ASRClient(
  { appKey: "xxx", accessKey: "xxx" },
  (result) => console.log(result.text)
);

await client.connect();
await client.sendAudio(audioData);
await client.finish();
await client.close();
```

### 3.3 RewriteService（文本润色）

```typescript
import { RewriteService } from "@main/rewrite";

const service = new RewriteService({
  apiUrl: "https://api.openai.com/v1/chat/completions",
  apiKey: "your-api-key",
  model: "gpt-4o-mini",
});

const result = await service.rewrite("嗯，那个，我想说的是...");
console.log(result.polished); // "我想说的是..."
```

### 3.4 音频处理工具

```typescript
import {
  float32ToPCMBytes,
  resample,
  stereoToMono,
  calculateRMS,
  AudioBuffer,
} from "@main/asr";

// Web Audio API 输出转 PCM
const pcmData = float32ToPCMBytes(float32Array);

// 重采样
const resampled = resample(inputData, 44100, 16000);

// 计算音量（用于波形显示）
const volume = calculateRMS(audioData);
```

---

## 4. 类型定义

所有类型定义位于 `app/shared/types/asr.ts`：

```typescript
type ASRState = 'idle' | 'connecting' | 'ready' | 'recording' | 'processing' | 'completed' | 'error';

interface ASRResult {
  text: string;
  isPartial: boolean;
  utterances?: ASRUtterance[];
  error?: string;
}

const IPC_CHANNELS = {
  ASR_START: "asr:start",
  ASR_STOP: "asr:stop",
  ASR_SEND_AUDIO: "asr:send-audio",
  ASR_STATE_CHANGE: "asr:state-change",
  ASR_RESULT: "asr:result",
};
```

---

## 5. 环境变量配置

在项目根目录创建 `.env` 文件（参考 `.env.example`）：

```bash
doubao_app_key=your_app_key
doubao_access_key=your_access_key
transcribe_model_api_url=https://api.openai.com/v1/chat/completions
transcribe_model_api_key=your_api_key
transcribe_model=gpt-4o-mini
```

---

## 6. 前端集成指南

### 6.1 渲染进程音频采集

```typescript
export async function startAudioCapture(
  onAudioData: (data: Uint8Array) => void
): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { sampleRate: 16000, channelCount: 1 },
  });

  const audioContext = new AudioContext({ sampleRate: 16000 });
  const source = audioContext.createMediaStreamSource(stream);
  const processor = audioContext.createScriptProcessor(4096, 1, 1);

  processor.onaudioprocess = (e) => {
    const float32Data = e.inputBuffer.getChannelData(0);
    const int16Data = new Int16Array(float32Data.length);
    for (let i = 0; i < float32Data.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Data[i]));
      int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    onAudioData(new Uint8Array(int16Data.buffer));
  };

  source.connect(processor);
  processor.connect(audioContext.destination);

  return () => {
    processor.disconnect();
    source.disconnect();
    stream.getTracks().forEach((track) => track.stop());
    audioContext.close();
  };
}
```

### 6.2 Preload 脚本示例

```typescript
import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS } from "@shared/types/asr";

contextBridge.exposeInMainWorld("voice", {
  start: () => ipcRenderer.invoke(IPC_CHANNELS.ASR_START),
  stop: () => ipcRenderer.invoke(IPC_CHANNELS.ASR_STOP),
  sendAudio: (data: Uint8Array) =>
    ipcRenderer.send(IPC_CHANNELS.ASR_SEND_AUDIO, data),
  onResult: (callback) => {
    ipcRenderer.on(IPC_CHANNELS.ASR_RESULT, (_, result) => callback(result));
  },
  onStateChange: (callback) => {
    ipcRenderer.on(IPC_CHANNELS.ASR_STATE_CHANGE, (_, state) => callback(state));
  },
});
```

---

## 7. 运行测试

```bash
npm install
npm test
npm run test:coverage
```

---

## 8. 状态流转图

```
┌──────┐  startSession()  ┌────────────┐  connected   ┌───────┐
│ idle │ ───────────────► │ connecting │ ───────────► │ ready │
└──────┘                  └────────────┘              └───────┘
    ▲                                                      │
    │ cancelSession()                              sendAudio()
    │                                                      │
    │                     ┌───────────┐              ┌───────────┐
    │                     │ processing│◄─────────────│ recording │
    │                     └───────────┘ stopSession()└───────────┘
    │                           │
    │                           ▼
    │                     ┌───────────┐
    └─────────────────────│ completed │
                          └───────────┘
```

---

## 9. 后续开发任务

- [ ] 实现 `app/preload/index.ts` - 暴露 IPC API
- [ ] 实现 `app/main/ipc/asr-handlers.ts` - 主进程 IPC 处理器
- [ ] 在主进程注册全局快捷键
- [ ] 实现渲染进程录音 UI（参考 PRD 中的 Capsule 组件规格）
- [ ] 添加 electron-vite 配置完成打包
