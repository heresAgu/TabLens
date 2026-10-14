#!/usr/bin/env node
/**
 * TabLens Agent Score Verification Tool
 *
 * Usage:
 *   node scripts/verify_agent_score.mjs <score.agent.json>
 *
 * Validates:
 * 1. tablens.agent.v1 or tablens.agent.v2 structure (normalizeAgentDraft)
 * 2. Core score import (importScore)
 * 3. Timing warnings across all measures (timingWarning)
 * 4. Sources and measure bounding boxes (for v2)
 * 5. Playback timeline generation (timeline)
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeAgentDraft } from '../app/web/agent-format.js';
import { importScore, timingWarning } from '../app/web/core.js';
import { timeline } from '../app/web/playback.js';

function main() {
  const fileArg = process.argv[2];
  if (!fileArg) {
    console.error('用法: node scripts/verify_agent_score.mjs <score.agent.json>');
    process.exit(1);
  }

  const filePath = resolve(fileArg);
  let raw;
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.error(`❌ 读取或解析 JSON 失败 [${filePath}]:`, err.message);
    process.exit(1);
  }

  console.log(`\n📄 正在校验: ${filePath}`);
  console.log(`───────────────────────────────────────────`);

  // 1. 结构与格式规范校验
  let normalized;
  try {
    normalized = normalizeAgentDraft(raw);
    console.log(`✅ 格式结构: ${raw.format} (合规)`);
  } catch (err) {
    console.error(`❌ 格式结构校验失败:`, err.message);
    process.exit(1);
  }

  // 元数据信息
  const meta = raw.metadata || {};
  console.log(`🎵 曲名: 「${meta.title}」`);
  console.log(`⏱ 速度: ${meta.tempo_bpm ? meta.tempo_bpm + ' BPM' : 'null (未设定，应用默认)'}`);
  console.log(`🎼 拍号: [${(meta.time_signature || []).join('/')}]`);
  console.log(`🎸 变调夹: Capo ${meta.capo ?? 0}`);

  // 2. v2 原图与区域信息校验
  if (raw.format === 'tablens.agent.v2') {
    const sources = raw.sources || [];
    console.log(`🖼 原图总数: ${sources.length} 页`);
    for (const [idx, s] of sources.entries()) {
      const dataSize = Math.round((s.dataUrl?.length || 0) / 1024);
      console.log(`   - 页 ${idx + 1} (${s.id}): ${s.name} [${s.width}x${s.height} px, WebP ~${dataSize} KB]`);
    }
  }

  // 3. 核心乐谱导入
  let score;
  try {
    score = importScore(raw);
    console.log(`✅ 核心导入: 成功导入 ${score.measures.length} 个小节`);
  } catch (err) {
    console.error(`❌ 乐谱核心导入失败:`, err.message);
    process.exit(1);
  }

  // 4. 小节时值与对照区域校验
  let warningCount = 0;
  let missingSourceCount = 0;
  const timingDetails = [];

  for (const m of score.measures) {
    // 检查 v2 原图引用
    if (raw.format === 'tablens.agent.v2') {
      if (!m.source || !m.source.pageId || !Array.isArray(m.source.box)) {
        missingSourceCount++;
        timingDetails.push(`第 ${m.number} 小节: 缺失原图引用或 box 裁切框`);
      }
    }

    // 检查时值与拍数告警
    const warn = timingWarning(score, m);
    if (warn) {
      warningCount++;
      timingDetails.push(`第 ${m.number} 小节时值告警: ${warn}`);
    }
  }

  if (missingSourceCount > 0) {
    console.error(`❌ 原图对照缺失: ${missingSourceCount} 个小节未配置有效 source`);
  }

  if (warningCount > 0) {
    console.warn(`⚠️ 发现 ${warningCount} 处时值/节奏告警:`);
    for (const d of timingDetails) {
      console.warn(`   - ${d}`);
    }
  } else {
    console.log(`✅ 时值核对: 全曲 ${score.measures.length} 小节 0 节奏告警 (Zero timing warnings)`);
  }

  // 5. 播放时间轴生成
  try {
    const played = timeline(score, meta.tempo_bpm || 80);
    console.log(`✅ 播放时间轴: 生成成功 (包含 ${played.total} 个演奏事件)`);
  } catch (err) {
    console.error(`❌ 播放时间轴构建失败:`, err.message);
    process.exit(1);
  }

  console.log(`───────────────────────────────────────────`);
  if (warningCount === 0 && missingSourceCount === 0) {
    console.log(`🎉 校验结果: 完美通过 (100% PASS)\n`);
    process.exit(0);
  } else {
    console.log(`⚠️ 校验结果: 存在待调整项\n`);
    process.exit(warningCount > 0 ? 2 : 1);
  }
}

main();
