import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const eslint = new ESLint({ cwd });

const conditionalHook = `import { useState } from 'react';
export function Widget({ on }: { on: boolean }) {
  if (on) {
    const [n] = useState(0);
    return n;
  }
  return 0;
}
`;

async function ruleIds(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.map((m) => m.ruleId ?? 'fatal');
}

describe('eslint.config.js', () => {
  it('applies react-hooks rules to client sources', async () => {
    const ids = await ruleIds(conditionalHook, 'packages/client/src/Widget.tsx');
    expect(ids).toContain('react-hooks/rules-of-hooks');
  });

  it('applies typescript-eslint recommended rules to shared', async () => {
    const ids = await ruleIds('export const x: any = 1;\n', 'packages/shared/src/x.ts');
    expect(ids).toContain('@typescript-eslint/no-explicit-any');
  });

  it('allows underscore-prefixed unused arguments', async () => {
    const ids = await ruleIds('export function f(_unused: number) { return 1; }\n', 'packages/shared/src/f.ts');
    expect(ids).toEqual([]);
  });
});
