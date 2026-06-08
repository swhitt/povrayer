// Pulls the precise uncovered lines / branches / functions out of a
// FileCoverage so the gate (and the baseline census) can say exactly what a
// test still has to exercise, by line.
import { rel } from './paths.mjs';

function uncoveredFunctions(fc) {
  const out = [];
  const { fnMap, f } = fc.data;
  for (const id of Object.keys(fnMap)) {
    if (f[id] === 0) {
      const m = fnMap[id];
      const line = (m.decl ?? m.loc).start.line;
      out.push({ name: m.name || '(anonymous)', line });
    }
  }
  return out.sort((a, b) => a.line - b.line);
}

function uncoveredBranches(fc) {
  const out = [];
  const { branchMap, b } = fc.data;
  for (const id of Object.keys(branchMap)) {
    const counts = b[id] ?? [];
    const m = branchMap[id];
    counts.forEach((hit, k) => {
      if (hit === 0) {
        const locs = m.locations ?? [];
        const loc = locs[k] ?? m.loc ?? {};
        const line = loc.start?.line ?? m.line;
        out.push({ type: m.type, line, path: k });
      }
    });
  }
  return out.sort((a, b) => a.line - b.line || a.path - b.path);
}

export function fileGaps(fc) {
  return {
    summary: fc.toSummary().data,
    lines: fc.getUncoveredLines().map(Number),
    functions: uncoveredFunctions(fc),
    branches: uncoveredBranches(fc),
  };
}

// Collapses [1,2,3,5,6,9] -> "1-3, 5-6, 9" for compact census output.
export function compactRanges(nums) {
  if (!nums.length) return '';
  const sorted = [...new Set(nums)].sort((a, b) => a - b);
  const parts = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (const n of sorted.slice(1)) {
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = prev = n;
  }
  parts.push(start === prev ? `${start}` : `${start}-${prev}`);
  return parts.join(', ');
}

export function printFileGaps(absPath, fc) {
  const g = fileGaps(fc);
  const s = g.summary;
  const pct = (x) => `${x.pct}% (${x.covered}/${x.total})`;
  console.log(`\n${rel(absPath)}`);
  console.log(
    `  statements ${pct(s.statements)} · branches ${pct(s.branches)} · ` +
      `functions ${pct(s.functions)} · lines ${pct(s.lines)}`
  );
  if (g.lines.length) console.log(`  uncovered lines: ${compactRanges(g.lines)}`);
  if (g.functions.length) {
    console.log(
      `  uncovered functions: ${g.functions.map((f) => `${f.name}@${f.line}`).join(', ')}`
    );
  }
  if (g.branches.length) {
    const byLine = {};
    for (const br of g.branches) {
      (byLine[br.line] ??= new Set()).add(`${br.type}#${br.path}`);
    }
    const desc = Object.entries(byLine)
      .map(([line, set]) => `${line}(${[...set].join(',')})`)
      .join(', ');
    console.log(`  uncovered branches: ${desc}`);
  }
}
