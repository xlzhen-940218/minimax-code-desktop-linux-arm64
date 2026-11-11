#!/usr/bin/env node
// lint-skill.js — Mavis SKILL.md 校验器
//
// 用法: node lint-skill.js <path/to/skill-directory>
// 退出码: 0 = 通过，1 = 有错误
//
// 校验项见同目录 SKILL.md Step 5。
// 不依赖任何第三方包；只用 Node.js 内置 fs + path。

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';

const FORBIDDEN_FILES = ['README.md', 'CHANGELOG.md', 'INSTALLATION.md', 'INSTALLATION_GUIDE.md', 'QUICK_REFERENCE.md'];
const FORBIDDEN_FRONTMATTER_KEYS = ['allowed-tools', 'license', 'model'];
const MAX_BODY_LINES = 500;
const REDUNDANT_WHEN_TO_USE_HEADINGS = [
  '## When to use',
  '## When to use this skill',
  '## When this skill should be used',
];
const README_SMELLS = [
  '## How it works',
  '## Usage',
  '### Command line',
  '### As a Python module',
  '### As a Node module',
  '## API',
];

function fail(msg) {
  console.error(`[FAIL] ${msg}`);
  return false;
}

function warn(msg) {
  console.error(`[WARN] ${msg}`);
}

function ok(msg) {
  console.log(`[OK]   ${msg}`);
}

// 极简 frontmatter 解析：只处理 `---` 围起来的顶层 key: value
// 不处理嵌套，不处理多行字符串以外的复杂 YAML（足够 SKILL.md 用）
function parseFrontmatter(content) {
  const lines = content.split('\n');
  if (lines[0]?.trim() !== '---') return { frontmatter: null, bodyStart: 0 };
  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) return { frontmatter: null, bodyStart: 0 };

  const fm = {};
  let currentKey = null;
  let currentValue = [];
  let inBlockScalar = false;
  for (let i = 1; i < endIdx; i++) {
    const line = lines[i];
    if (inBlockScalar) {
      if (/^[a-zA-Z_-]+\s*:/.test(line)) {
        // 新 key 来了，flush 旧的
        fm[currentKey] = currentValue.join('\n').trim();
        inBlockScalar = false;
        currentKey = null;
        currentValue = [];
        // 不 continue，往下走解析新行
      } else {
        currentValue.push(line.replace(/^\s{0,4}/, ''));
        continue;
      }
    }
    const m = line.match(/^([a-zA-Z_-]+)\s*:\s*(.*)$/);
    if (m) {
      const [, k, v] = m;
      if (v === '|' || v === '>' || v === '|-' || v === '>-') {
        // 块标量
        currentKey = k;
        currentValue = [];
        inBlockScalar = true;
      } else {
        fm[k] = v.trim();
      }
    }
  }
  if (inBlockScalar && currentKey) {
    fm[currentKey] = currentValue.join('\n').trim();
  }
  return { frontmatter: fm, bodyStart: endIdx + 1 };
}

function lintSkill(skillDir) {
  const dirAbs = resolve(skillDir);
  const dirName = basename(dirAbs);
  const skillMdPath = join(dirAbs, 'SKILL.md');

  console.log(`Linting skill at: ${dirAbs}`);
  console.log('');

  let allOk = true;

  // 0. SKILL.md 必须存在
  if (!existsSync(skillMdPath)) {
    fail(`SKILL.md not found at ${skillMdPath}`);
    process.exit(1);
  }
  ok('SKILL.md exists');

  const content = readFileSync(skillMdPath, 'utf-8');
  const { frontmatter, bodyStart } = parseFrontmatter(content);

  // 1. frontmatter 存在
  if (!frontmatter) {
    fail('frontmatter (--- ... ---) missing or unclosed');
    process.exit(1);
  }
  ok('frontmatter parsed');

  // 2. name 必填、kebab-case、与目录同名
  const name = frontmatter.name;
  if (!name) {
    allOk = fail('frontmatter.name is missing') && allOk;
  } else if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    allOk = fail(`frontmatter.name "${name}" is not kebab-case (lowercase letters/digits/hyphens, start with letter)`) && allOk;
  } else if (name !== dirName) {
    allOk = fail(`frontmatter.name "${name}" does not match directory name "${dirName}"`) && allOk;
  } else {
    ok(`name "${name}" is valid kebab-case and matches directory`);
  }

  // 3. description 必填、含触发短语
  const desc = frontmatter.description;
  if (!desc) {
    allOk = fail('frontmatter.description is missing') && allOk;
  } else {
    const hasTriggerHint = /\b(when|trigger|use this|load this)\b/i.test(desc) || /["'']/.test(desc);
    if (!hasTriggerHint) {
      allOk = fail('frontmatter.description must contain at least one trigger phrase: a quoted phrase, "when", "trigger", "use this", or "load this"') && allOk;
    } else {
      ok('description contains trigger hint');
    }
    if (desc.length < 30) {
      warn(`description is very short (${desc.length} chars); make sure it covers what + when + near misses`);
    }
  }

  // 4. 禁用 frontmatter 字段
  for (const key of FORBIDDEN_FRONTMATTER_KEYS) {
    if (key in frontmatter) {
      allOk = fail(`frontmatter contains forbidden key "${key}" (Mavis does not recognize this; remove it)`) && allOk;
    }
  }
  if (FORBIDDEN_FRONTMATTER_KEYS.every((k) => !(k in frontmatter))) {
    ok('no forbidden frontmatter keys');
  }

  // 5. 行数检查（正文部分）
  const bodyLines = content.split('\n').length - bodyStart;
  if (bodyLines > MAX_BODY_LINES) {
    allOk = fail(`SKILL.md body is ${bodyLines} lines (> ${MAX_BODY_LINES}); split into references/<topic>.md`) && allOk;
  } else {
    ok(`body is ${bodyLines} lines (limit ${MAX_BODY_LINES})`);
  }

  // 5.1 README-style 反模式检查
  const body = content.split('\n').slice(bodyStart).join('\n');
  const hasRedundantWhenToUse = REDUNDANT_WHEN_TO_USE_HEADINGS.some((heading) => body.includes(heading));
  if (hasRedundantWhenToUse) {
    warn('body contains a "When to use" heading; prefer putting trigger/boundary rules in frontmatter.description to avoid duplication');
  }
  const readmeMatches = README_SMELLS.filter((heading) => body.includes(heading));
  if (readmeMatches.length > 0) {
    warn(`body contains README-style section(s): ${readmeMatches.join(', ')}; keep SKILL.md focused on execution rules unless these sections are truly necessary`);
  }

  // 5.2 Windows 适配检查：如果 body 有 shell 命令指标但全文没提到 windows/win32，发 WARN
  const shellIndicators = [/python3\b/, /bash\s+scripts\//, /brew\s+install/, /\/tmp\//, /```(?:bash|sh)\b/];
  const hasShellIndicator = shellIndicators.some((re) => re.test(body));
  const mentionsWindows = /windows|win32/i.test(content);
  if (hasShellIndicator && !mentionsWindows) {
    warn('body contains shell/bash commands but does not mention Windows/win32; consider adding a "## Windows (win32) platform notes" section for cross-platform support');
  }

  // 6. 禁用文件检查
  const entries = readdirSync(dirAbs);
  for (const entry of entries) {
    if (FORBIDDEN_FILES.includes(entry)) {
      allOk = fail(`forbidden file "${entry}" in skill directory (skill is for LLM, not human docs); remove it`) && allOk;
    }
  }
  if (FORBIDDEN_FILES.every((f) => !entries.includes(f))) {
    ok('no forbidden files in skill directory');
  }

  // 7. references/ 引用必须存在
  const refRefs = [...content.matchAll(/references\/([a-zA-Z0-9_-]+\.md)/g)].map((m) => m[1]);
  const uniqueRefs = [...new Set(refRefs)];
  for (const ref of uniqueRefs) {
    const refPath = join(dirAbs, 'references', ref);
    if (!existsSync(refPath)) {
      allOk = fail(`SKILL.md references "references/${ref}" but file does not exist`) && allOk;
    }
  }
  if (uniqueRefs.length > 0 && uniqueRefs.every((r) => existsSync(join(dirAbs, 'references', r)))) {
    ok(`all ${uniqueRefs.length} references/*.md links resolve`);
  }

  console.log('');
  if (allOk) {
    console.log('✓ All checks passed');
    process.exit(0);
  } else {
    console.error('✗ Lint failed');
    process.exit(1);
  }
}

const arg = process.argv[2];
if (!arg) {
  console.error('Usage: node lint-skill.js <path/to/skill-directory>');
  process.exit(2);
}
lintSkill(arg);
