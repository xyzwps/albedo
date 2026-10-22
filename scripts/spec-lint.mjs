#!/usr/bin/env node
/**
 * 册子结构检查 + 册子 ↔ 测试双向覆盖。
 *
 * 规矩见 docs/specs/index.md 与 AGENTS.md。这个闸门只做机器能判的事：
 *   - Scenario ID 唯一、编号三位、同一 Requirement 内升序
 *   - 每个 Requirement 至少一条 Scenario，每条都有 WHEN / THEN
 *   - 每条 Scenario 正文不超过 5 行
 *   - README / AGENTS / docs/notes / 册子索引引用的号必须存在
 *   - 每个册子号至少有一条可执行测试，且测试标题里的号必须在册子里
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const SPECS = path.join(ROOT, 'docs', 'specs');
const SCENARIO = /^#### Scenario: ([A-Z]+)-(\d{3})\b\s*(.*)$/;
const REQUIREMENT = /^### Requirement: (.+?)\s*$/;
const HEADING = /^#{1,4}\s/;
const ANY_ID = /\b[A-Z]{2,5}-\d{3}\b/g;
const BODY_LIMIT = 5;
const NOTICE = 45;
const TEST_ID = /\[([A-Z]{2,5}-\d{3})\]/g;

function fail(problems) {
  for (const problem of problems) console.error(`✗ ${problem}`);
  if (problems.length) {
    console.error(`\n${problems.length} 个问题。规矩见 docs/specs/index.md 与 AGENTS.md。`);
    process.exitCode = 1;
  }
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(full);
  }
  return files;
}

function parseSpec(file, text) {
  const problems = [];
  const scenarios = [];
  let requirement = null;
  let order = [];
  let current = null;
  let body = [];
  let purpose = false;
  let title = null;

  const closeScenario = () => {
    if (!current) return;
    const joined = body.join('\n');
    if (!joined.includes('- **WHEN**')) problems.push(`${file}: ${current.id} 缺 WHEN`);
    if (!joined.includes('- **THEN**')) problems.push(`${file}: ${current.id} 缺 THEN`);
    const lines = body.filter((line) => line.trim()).length;
    if (lines > BODY_LIMIT) {
      problems.push(`${file}: ${current.id} 正文 ${lines} 行 —— 一条不超 ${BODY_LIMIT} 行；为什么放 docs/notes`);
    }
    current = null;
    body = [];
  };

  const closeRequirement = () => {
    if (requirement === null) return;
    if (!order.length) problems.push(`${file}: Requirement「${requirement}」下没有任何 Scenario`);
    const sorted = order.slice().sort((a, b) => Number(a.split('-')[1]) - Number(b.split('-')[1]));
    if (order.join(' ') !== sorted.join(' ')) {
      problems.push(`${file}: Requirement「${requirement}」内 ID 非升序 -> ${order.join(' ')}`);
    }
    requirement = null;
    order = [];
  };

  for (const line of text.split(/\r?\n/)) {
    if (title === null && line.startsWith('# ')) {
      title = line.slice(2).trim();
      continue;
    }
    if (line.trim() === '## Purpose') {
      purpose = true;
      closeScenario();
      closeRequirement();
      continue;
    }
    const req = REQUIREMENT.exec(line);
    if (req) {
      closeScenario();
      closeRequirement();
      requirement = req[1].trim();
      continue;
    }
    const scen = SCENARIO.exec(line);
    if (scen) {
      closeScenario();
      const id = `${scen[1]}-${scen[2]}`;
      current = { id, title: scen[3].trim(), line };
      scenarios.push(current);
      if (requirement === null) problems.push(`${file}: ${id} 不在任何 Requirement 下`);
      order.push(id);
      continue;
    }
    if (HEADING.test(line)) {
      closeScenario();
      if (line.startsWith('## ') || (line.startsWith('### ') && !REQUIREMENT.test(line))) {
        closeRequirement();
      }
      continue;
    }
    if (current) body.push(line);
  }

  closeScenario();
  closeRequirement();
  if (!title) problems.push(`${file}: 缺一级标题`);
  else if (title !== path.basename(path.dirname(file))) {
    problems.push(`${file}: 一级标题「${title}」与目录名「${path.basename(path.dirname(file))}」不一致`);
  }
  if (!purpose) problems.push(`${file}: 缺 ## Purpose`);
  for (const scenario of scenarios) {
    if (!scenario.title) problems.push(`${file}: ${scenario.id} 缺标题`);
  }
  return { problems, scenarios };
}

async function findSpecs() {
  const entries = await readdir(SPECS, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(SPECS, entry.name, 'spec.md'))
    .sort();
}

async function main() {
  const problems = [];
  let files;
  try {
    files = await findSpecs();
  } catch (error) {
    console.error('✗ docs/specs 不存在');
    process.exitCode = 1;
    return;
  }
  if (!files.length) {
    console.error('✗ docs/specs 下没有 */spec.md');
    process.exitCode = 1;
    return;
  }

  const seen = new Map();
  const all = [];
  const perCapability = [];
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    const parsed = parseSpec(file, text);
    problems.push(...parsed.problems);
    for (const scenario of parsed.scenarios) {
      if (seen.has(scenario.id)) {
        problems.push(`${file}: ${scenario.id} 重复（先出现在 ${seen.get(scenario.id)}）`);
      } else {
        seen.set(scenario.id, file);
        all.push(scenario.id);
      }
    }
    perCapability.push({ file, count: parsed.scenarios.length });
    if (parsed.scenarios.length > NOTICE) {
      console.log(`ℹ️  ${path.basename(path.dirname(file))} 已有 ${parsed.scenarios.length} 条，考虑按语义拆一本（提醒，不拦）`);
    }
  }

  // 别处引用的册子号必须存在；册子正文本身除外。
  const refFiles = [
    path.join(ROOT, 'README.md'),
    path.join(ROOT, 'AGENTS.md'),
    path.join(SPECS, 'index.md')
  ];
  const notesDir = path.join(ROOT, 'docs', 'notes');
  try {
    for (const entry of await readdir(notesDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.md')) refFiles.push(path.join(notesDir, entry.name));
    }
  } catch (error) {
    // docs/notes 可以还没有。
  }
  for (const file of refFiles) {
    let text;
    try {
      text = await readFile(file, 'utf8');
    } catch (error) {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      if (line.startsWith('#### Scenario:')) continue;
      for (const id of line.match(ANY_ID) || []) {
        if (!seen.has(id)) problems.push(`${path.relative(ROOT, file)}: 引用了 ${id}，册子里没有这一条`);
      }
    }
  }

  // 测试标题挂 [SVG-001]；双向差集，缺一边都算没对齐。
  const testFiles = await walk(path.join(ROOT, 'test'));
  const tests = new Map();
  for (const file of testFiles) {
    const text = await readFile(file, 'utf8');
    for (const match of text.matchAll(TEST_ID)) {
      const id = match[1];
      if (!tests.has(id)) tests.set(id, []);
      tests.get(id).push(path.relative(ROOT, file));
    }
  }
  for (const id of all) {
    if (!tests.has(id)) problems.push(`${id}: 册子里有，但没有任何测试标题挂这个号`);
  }
  for (const id of tests.keys()) {
    if (!seen.has(id)) problems.push(`${id}: 测试里挂了这个号，但册子里没有这一条（私测）`);
  }

  fail(problems);
  if (!problems.length) {
    console.log(`✅ 册子检查通过：${files.length} 个能力，${all.length} 条 Scenario，` +
      `${tests.size} 个号都有可执行测试`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});