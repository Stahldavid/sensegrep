/** Physical source identity. Intersecting ranges are not interchangeable.
 * Keep overlapping definitions until a provenance-preserving union is available. */
export type SourceSpan = { file: string; startLine: number; endLine: number; content: string; contentTruncated?: boolean }
export function sameSource(a: SourceSpan, b: SourceSpan): boolean {
  return a.file === b.file && a.startLine === b.startLine && a.endLine === b.endLine
    && !a.contentTruncated && !b.contentTruncated
    && a.content.replace(/\r\n/g, "\n") === b.content.replace(/\r\n/g, "\n")
}
export function conflictingSource(a: SourceSpan, b: SourceSpan): boolean {
  return a.file === b.file && a.startLine === b.startLine && a.endLine === b.endLine && !sameSource(a, b)
}
