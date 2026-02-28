export interface SynthesisRow {
  finding: string;
  frequency: number;
  evidence: string[];
}

export function extractBulletFindings(markdown: string): string[] {
  const findings: string[] = [];
  for (const line of markdown.split("\n")) {
    const match = line.match(/^\s*-\s+(.+)$/);
    if (!match) continue;
    const finding = match[1].split(":", 1)[0].trim();
    if (finding) findings.push(finding);
  }
  return findings;
}

export function synthesizeFindings(minerOutputs: string[]): SynthesisRow[] {
  const map = new Map<string, { frequency: number; evidence: string[] }>();

  minerOutputs.forEach((output, index) => {
    const evidenceLabel = `batch ${index + 1}`;
    const uniqueFindings = new Set(extractBulletFindings(output));

    for (const finding of uniqueFindings) {
      const existing = map.get(finding);
      if (existing) {
        existing.frequency += 1;
        existing.evidence.push(evidenceLabel);
      } else {
        map.set(finding, { frequency: 1, evidence: [evidenceLabel] });
      }
    }
  });

  return [...map.entries()]
    .map(([finding, value]) => ({ finding, frequency: value.frequency, evidence: value.evidence }))
    .sort((a, b) => b.frequency - a.frequency || a.finding.localeCompare(b.finding));
}

export function formatSynthesisTable(rows: SynthesisRow[]): string {
  if (rows.length === 0) {
    return "No high-signal findings returned.";
  }

  const header = [
    "| finding | frequency/evidence | proposed action |",
    "| --- | --- | --- |",
  ];

  const body = rows.map((row) => {
    const evidence = row.evidence.join("; ");
    const frequency = `${row.frequency} (${evidence})`;
    const action = "Review and, if approved, persist this as a memory vault update.";
    return `| ${escapePipe(row.finding)} | ${escapePipe(frequency)} | ${action} |`;
  });

  return [...header, ...body].join("\n");
}

function escapePipe(text: string): string {
  return text.replaceAll("|", "\\|");
}
