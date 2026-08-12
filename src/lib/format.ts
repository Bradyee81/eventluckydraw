export function formatSectionLabel(section: string, sequence: number): string {
  return `${section || "(none)"} #${sequence}`;
}
