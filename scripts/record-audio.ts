#!/usr/bin/env bun
/**
 * 音频录制工具
 * 支持 ffmpeg 或 sox，自动检测可用工具
 */

import { spawn, spawnSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const RECORDINGS_DIR = join(process.cwd(), 'test-recordings');

// 确保录音目录存在
if (!existsSync(RECORDINGS_DIR)) {
  mkdirSync(RECORDINGS_DIR, { recursive: true });
}

// 检测可用的录音工具
function detectRecordingTool(): 'ffmpeg' | 'sox' | null {
  // 检查 ffmpeg
  try {
    const ffmpeg = spawnSync('which', ['ffmpeg']);
    if (ffmpeg.status === 0) {
      return 'ffmpeg';
    }
  } catch {}

  // 检查 sox
  try {
    const sox = spawnSync('which', ['sox']);
    if (sox.status === 0) {
      return 'sox';
    }
  } catch {}

  return null;
}

// 列出 ffmpeg 可用的音频设备
function listAudioDevices(): void {
  console.log('\n📋 检测可用的音频设备...\n');
  
  const result = spawnSync('ffmpeg', [
    '-f', 'avfoundation',
    '-list_devices', 'true',
    '-i', ''
  ], { encoding: 'utf-8' });
  
  const output = result.stderr || '';
  const audioSection = output.split('AVFoundation audio devices:')[1];
  
  if (audioSection) {
    const lines = audioSection.split('\n').filter(line => line.includes('['));
    console.log('可用的音频输入设备:');
    lines.forEach(line => {
      const match = line.match(/\[(\d+)\] (.+)/);
      if (match) {
        console.log(`  ${match[1]}: ${match[2]}`);
      }
    });
    console.log('');
  }
}

// 使用 ffmpeg 录音
async function recordWithFFmpeg(outputPath: string, duration: number, deviceIndex: number = 1): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-f', 'avfoundation',  // macOS 音频输入
      '-i', `:${deviceIndex}`,  // 音频设备索引
      '-ar', '16000',        // 采样率 16kHz
      '-ac', '1',            // 单声道
      '-t', duration.toString(),  // 时长
      '-y',                  // 覆盖已存在的文件
      outputPath
    ]);

    ffmpeg.stderr.on('data', (data) => {
      const output = data.toString();
      // ffmpeg 输出到 stderr，过滤掉版本信息
      if (output.includes('time=') || output.includes('size=')) {
        process.stdout.write('\r   录音中...');
      }
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg 退出码: ${code}`));
      }
    });

    ffmpeg.on('error', (err) => {
      reject(err);
    });
  });
}

// 使用 sox 录音
async function recordWithSox(outputPath: string, duration: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const sox = spawn('sox', [
      '-d',              // 默认输入设备
      '-r', '16000',     // 采样率 16kHz
      '-c', '1',         // 单声道
      '-t', 'wav',       // 输出格式
      outputPath,
      'trim', '0', duration.toString()  // 录音时长
    ]);

    sox.stderr.on('data', (data) => {
      const output = data.toString();
      if (output.includes('In:') || output.includes('Out:')) {
        process.stdout.write('\r   录音中...');
      }
    });

    sox.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`sox 退出码: ${code}`));
      }
    });

    sox.on('error', (err) => {
      reject(err);
    });
  });
}

async function recordAudio(duration: number = 5): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = join(RECORDINGS_DIR, `recording-${timestamp}.wav`);

  // 检测可用工具
  const tool = detectRecordingTool();
  
  if (!tool) {
    console.error('\n错误: 未找到可用的录音工具');
    console.error('\n请安装以下工具之一:');
    console.error('  - ffmpeg (推荐): brew install ffmpeg');
    console.error('  - sox:          brew install sox\n');
    throw new Error('未找到录音工具');
  }

  console.log(`\n准备录音 (时长: ${duration}秒, 工具: ${tool})...`);
  console.log(`请准备说话！建议说一句完整的中文句子，例如：`);
  console.log(`   "今天天气真不错，我们一起去公园散步吧。"`);
  console.log(`   "人工智能技术正在改变我们的生活方式。"\n`);
  console.log(`录音将在 2 秒后开始...\n`);
  
  // 等待 2 秒让用户准备
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  console.log(`开始录音...`);
  console.log(`输出文件: ${outputPath}\n`);

  try {
    if (tool === 'ffmpeg') {
      await recordWithFFmpeg(outputPath, duration);
    } else {
      await recordWithSox(outputPath, duration);
    }
    
    console.log(`\n录音完成，文件已保存到: ${outputPath}\n`);
    return outputPath;
  } catch (err) {
    console.error('录音失败:', err.message);
    throw err;
  }
}

// 命令行参数
const duration = parseInt(process.argv[2]) || 5;

recordAudio(duration).catch((err) => {
  console.error('录音失败:', err.message);
  process.exit(1);
});
