#!/usr/bin/env bun
/**
 * ASR 集成测试 - 使用实际音频文件
 * 完整测试音频录制 → ASR 识别 → 文本改写流程
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { ASRManager } from '../app/main/asr/asr-manager';
import { RewriteService } from '../app/main/rewrite';
import { int16ToUint8 } from '../app/main/asr/audio-processor';
import type { ASREvent, ASRResult } from '../app/shared/types/asr';

// 从 .env 文件加载环境变量
function loadEnv() {
  const envPath = join(process.cwd(), '.env');
  if (!existsSync(envPath)) {
    console.warn('未找到 .env 文件，请先创建并配置环境变量');
    return;
  }
  
  const content = readFileSync(envPath, 'utf-8');
  content.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...values] = trimmed.split('=');
      if (key && values.length > 0) {
        process.env[key.trim()] = values.join('=').trim();
      }
    }
  });
}

// 解析 WAV 文件头，提取 PCM 数据
function parseWavFile(filePath: string): Int16Array {
  const buffer = readFileSync(filePath);
  
  // 简单的 WAV 解析（假设标准格式）
  // WAV 头部通常是 44 字节
  const dataOffset = 44;
  const pcmData = new Int16Array(
    buffer.buffer,
    buffer.byteOffset + dataOffset,
    (buffer.length - dataOffset) / 2
  );
  
  // 计算音频能量
  let maxAmplitude = 0;
  let rms = 0;
  for (let i = 0; i < pcmData.length; i++) {
    const abs = Math.abs(pcmData[i]);
    if (abs > maxAmplitude) maxAmplitude = abs;
    rms += pcmData[i] * pcmData[i];
  }
  rms = Math.sqrt(rms / pcmData.length);
  
  console.log(`音频信息:`);
  console.log(`   - 文件大小: ${buffer.length} bytes`);
  console.log(`   - PCM 样本数: ${pcmData.length}`);
  console.log(`   - 时长: ${(pcmData.length / 16000).toFixed(2)}秒`);
  console.log(`   - 最大振幅: ${maxAmplitude} / 32768 (${(maxAmplitude / 32768 * 100).toFixed(1)}%)`);
  console.log(`   - RMS 能量: ${rms.toFixed(0)}`);
  
  if (maxAmplitude < 100) {
    console.warn('警告: 音频信号非常弱，可能没有录到声音');
  } else if (maxAmplitude < 1000) {
    console.warn('警告: 音频信号较弱，建议说话声音大一些');
  }
  
  return pcmData;
}

// 将 Int16Array 转换为音频块（模拟实时流，直接使用 16-bit PCM 字节流）
function* createAudioChunks(pcmData: Int16Array, chunkSize: number = 3200) {
  for (let i = 0; i < pcmData.length; i += chunkSize) {
    const chunk = pcmData.slice(i, i + chunkSize);
    yield int16ToUint8(chunk);
  }
}

async function runIntegrationTest(audioFile: string) {
  console.log('\nASR 集成测试开始\n');
  console.log('=' .repeat(60));
  
  // 1. 加载环境变量
  console.log('\n步骤 1: 加载环境变量');
  loadEnv();
  
  if (!process.env.doubao_app_key || !process.env.doubao_access_key) {
    throw new Error('缺少必要的环境变量: doubao_app_key, doubao_access_key');
  }
  console.log('环境变量已加载');
  
  // 2. 解析音频文件
  console.log('\n步骤 2: 解析音频文件');
  if (!existsSync(audioFile)) {
    throw new Error(`音频文件不存在: ${audioFile}`);
  }
  const pcmData = parseWavFile(audioFile);
  console.log('音频文件解析完成');
  
  // 3. 初始化 ASR Manager
  console.log('\n步骤 3: 初始化 ASR Manager');
  const asrManager = new ASRManager({
    appKey: process.env.doubao_app_key,
    accessKey: process.env.doubao_access_key,
    uid: 'integration-test',
  });
  console.log('ASR Manager 已初始化');
  
  // 4. 初始化 Rewrite Service
  console.log('\n步骤 4: 初始化 Rewrite Service');
  const rewriteService = new RewriteService(
    process.env.transcribe_model_api_url || 'https://api.openai.com/v1/chat/completions',
    process.env.transcribe_model_api_key || '',
    process.env.transcribe_model || 'gpt-4'
  );
  console.log('Rewrite Service 已初始化');
  
  // 5. 设置事件监听
  console.log('\n步骤 5: 开始 ASR 识别');
  let finalResult: ASRResult | null = null;

  asrManager.on('result', (event: ASREvent) => {
    const result = event.result;
    if (!result) return;

    if (result.isPartial) {
      console.log(`   中间结果: "${result.text}"`);
    } else {
      console.log(`\n最终识别结果: "${result.text}"`);
      finalResult = result;
    }
  });

  asrManager.on('error', (event: ASREvent) => {
    console.error('ASR 错误:', event.error ?? '未知错误');
  });
  
  // 6. 开始识别会话
  await asrManager.startSession();
  console.log(`会话已启动`);
  
  // 7. 发送音频数据（模拟实时流）
  console.log('\n步骤 6: 发送音频数据');
  let chunkCount = 0;
  for (const chunk of createAudioChunks(pcmData)) {
    await asrManager.sendAudio(chunk);
    chunkCount++;
    
    // 每 10 个块显示一次进度
    if (chunkCount % 10 === 0) {
      const progress = ((chunkCount * 3200) / pcmData.length * 100).toFixed(1);
      process.stdout.write(`\r   进度: ${progress}% (${chunkCount} 块)`);
    }
    
    // 模拟实时流的延迟（200ms 一块）
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  console.log(`\n音频发送完成 (共 ${chunkCount} 块)`);
  
  // 8. 停止会话并等待最终结果
  console.log('\n步骤 7: 等待最终结果');
  const managerResult = await asrManager.stopSession();
  // 兜底：如果事件回调未捕获最终结果，使用 stopSession 的返回值
  if (!finalResult) {
    finalResult = managerResult;
  }
  
  if (!finalResult) {
    throw new Error('未收到最终识别结果');
  }
  
  // 9. 文本改写
  console.log('\n步骤 8: 文本改写');
  console.log(`   原始文本: "${finalResult.text}"`);
  
  const rewriteResult = await rewriteService.rewrite(finalResult.text);
  const rewrittenText = rewriteResult.polished;
  if (!rewriteResult.success) {
    console.warn(`润色未成功: ${rewriteResult.error ?? '未知错误'}`);
  }
  console.log(`   改写文本: "${rewrittenText}"`);
  console.log('文本改写完成');
  
  // 10. 显示测试总结
  console.log('\n' + '='.repeat(60));
  console.log('集成测试完成\n');
  console.log('测试结果总结:');
  console.log(`   - 音频时长: ${(pcmData.length / 16000).toFixed(2)}秒`);
  console.log(`   - 音频块数: ${chunkCount}`);
  console.log(`   - 识别文本: "${finalResult.text}"`);
  console.log(`   - 改写文本: "${rewrittenText}"`);
  console.log(`   - 会话ID: （未提供）`);
  console.log('\n' + '='.repeat(60) + '\n');
  
  process.exit(0);
}

// 获取音频文件路径（命令行参数或最新的录音）
function getLatestRecording(): string {
  const recordingsDir = join(process.cwd(), 'test-recordings');
  if (!existsSync(recordingsDir)) {
    console.error('错误: 未找到 test-recordings 目录');
    console.error('请先运行: bun run record-audio');
    process.exit(1);
  }
  
  const { readdirSync, statSync } = require('fs');
  const files = readdirSync(recordingsDir)
    .filter((f: string) => f.endsWith('.wav'))
    .map((f: string) => join(recordingsDir, f))
    .sort((a: string, b: string) => {
      return statSync(b).mtime.getTime() - statSync(a).mtime.getTime();
    });
  
  if (files.length === 0) {
    console.error('错误: test-recordings 目录中没有音频文件');
    console.error('请先运行: bun run record-audio');
    process.exit(1);
  }
  
  return files[0];
}

const audioFile = process.argv[2] || getLatestRecording();

console.log(`\n使用音频文件: ${audioFile}\n`);

runIntegrationTest(audioFile).catch((err) => {
  console.error('\n测试失败:', err.message);
  console.error(err.stack);
  process.exit(1);
});
