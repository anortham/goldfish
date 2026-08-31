import type { RegisteredProject } from './types';

export const WORKSPACE_SUGGESTIONS_LABEL = 'Suggestions only; choose one explicitly:';

export function formatKnownProjects(
  projects: RegisteredProject[],
  includeLabel = true
): string {
  const paths = [...new Set(projects.map(project => project.path))];
  if (paths.length === 0) return '';

  const suffix = paths.map(path => `- ${path}`).join('\n');
  return includeLabel
    ? `\n${WORKSPACE_SUGGESTIONS_LABEL}\n${suffix}`
    : `\n${suffix}`;
}
