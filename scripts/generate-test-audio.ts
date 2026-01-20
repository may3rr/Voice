#!/usr/bin/env bun
/**
 * 生成测试音频（使用 macOS TTS）
 */

import { spawn } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const RECORDINGS_DIR = join(process.cwd(), 'test-recordings');

// 确保目录存在
if (!existsSync(RECORDINGS_DIR)) {
  mkdirSync(RECORDINGS_DIR, { recursive: true });
}

async function generateTestAudio(): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = join(RECORDINGS_DIR, `tts-test-${timestamp}.wav`);
  const tempAiff = join(RECORDINGS_DIR, `temp-${timestamp}.aiff`);

  // macOS TTS 文本（中文）
  const text = "今天天气真不错，阳光明媚，我们一起去公园散步吧。人工智能技术正在深刻地改变我们的生活方式。";

  console.log('\n使用 macOS TTS 生成测试音频...');
  console.log(`文本内容: "${text}"\n`);

  return new Promise((resolve, reject) => {
    // 步骤1: 使用 say 命令生成 AIFF 文件
    const say = spawn('say', ['-v', 'Ting-Ting', '-o', tempAiff, text]);

    say.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`TTS 生成失败，退出码: ${code}`));
        return;
      }

      console.log('TTS 音频生成完成，正在转换格式...\n');

      // 步骤2: 使用 ffmpeg 转换为 16kHz, 16bit, mono WAV
      const ffmpeg = spawn('ffmpeg', [
        '-i', tempAiff,
        '-ar', '16000',
        '-ac', '1',
        '-sample_fmt', 's16',
        '-y',
        outputPath
      ]);

      ffmpeg.stderr.on('data', (data) => {
        // ffmpeg 输出到 stderr
        const output = data.toString();
        if (output.includes('time=')) {
          process.stdout.write('\r   转换中...');
        }
      });

      ffmpeg.on('close', (code) => {
        // 删除临时文件
        try {
          const { unlinkSync } = require('fs');
          unlinkSync(tempAiff);
        } catch {}

        if (code === 0) {
          console.log(`\n测试音频已生成: ${outputPath}\n`);
          resolve(outputPath);
        } else {
          reject(new Error(`音频转换失败，退出码: ${code}`));
        }
      });

      ffmpeg.on('error', (err) => {
        reject(err);
      });
    });

    say.on('error', (err) => {
      if ((err as any).code === 'ENOENT') {
        console.error('\n错误: 未找到 say 命令（仅 macOS 支持）\n');
      }
      reject(err);
    });
  });
}

generateTestAudio()
  .then((path) => {
    console.log('生成完成，现在可以运行测试：');
    console.log(`   bun run integration-test ${path}\n`);
  })
  .catch((err) => {
    console.error('生成失败:', err.message);
    process.exit(1);
  });
