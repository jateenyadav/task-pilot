import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function writeResults(results, model) {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs');
  mkdirSync(dir, { recursive: true });
  const ok = results.filter((r) => r.ok).length;
  const date = new Date().toISOString().slice(0, 10);
  const steps = results.map((r) => r.steps).sort((a, b) => a - b);
  writeFileSync(join(dir, 'benchmark.json'), JSON.stringify({ date, model, results }, null, 2));
  writeFileSync(join(dir, 'benchmark.md'), `# TaskPilot benchmark (${date})

10 tasks on the local practice sites in \`bench/sites\` (to-do list, shop search, form, table lookup, multi-page wiki,
checkboxes, pagination, dropdown + radio, long scroll, tabs). Each task has an automatic success check.
Model: ${model} (your own free key). "Confirm" prompts were auto-approved in benchmark mode.

**Success: ${ok} / ${results.length}** · median ${steps[Math.floor(steps.length / 2)]} steps

| Task | Result | Steps | Time |
|---|---|---|---|
${results.map((r) => `| ${r.task} | ${r.ok ? '✓' : `✗ (${r.status})`} | ${r.steps} | ${r.seconds} s |`).join('\n')}

Re-run: \`GEMINI_API_KEY=… npm run bench\` (or add the key in Settings first).
`);
  console.log(`\n${ok}/${results.length} → docs/benchmark.md`);
}
