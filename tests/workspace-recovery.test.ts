import { describe, it, expect } from 'bun:test';
import { formatKnownProjects } from '../src/workspace-recovery';
import type { RegisteredProject } from '../src/types';

const project = (path: string): RegisteredProject => ({
  path,
  name: path.split('/').pop() ?? path,
  registered: '2026-08-30T00:00:00.000Z'
});

describe('formatKnownProjects', () => {
  it('returns an empty suffix when no projects are registered', () => {
    expect(formatKnownProjects([])).toBe('');
  });

  it('labels registered paths as suggestions only', () => {
    expect(formatKnownProjects([project('/tmp/first'), project('/tmp/second')])).toBe(
      '\nSuggestions only; choose one explicitly:\n- /tmp/first\n- /tmp/second'
    );
  });

  it('can append paths to an existing suggestions label', () => {
    expect(formatKnownProjects([project('/tmp/project')], false)).toBe('\n- /tmp/project');
  });
});
