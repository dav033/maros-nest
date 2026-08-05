/** Minimal shape of a TipTap/ProseMirror JSON node — enough to walk the tree for search indexing. */
interface TipTapNode {
  type?: string;
  text?: string;
  content?: TipTapNode[];
}

/**
 * Extracts plain text from a TipTap document JSON, for the content_text column
 * that feeds the Postgres tsvector search index. Defensive against malformed/empty docs.
 */
export function extractPlainTextFromTipTapDoc(doc: unknown): string {
  if (!doc || typeof doc !== 'object') return '';

  const lines: string[] = [];

  const walk = (node: TipTapNode, buffer: string[]): void => {
    if (typeof node.text === 'string') {
      buffer.push(node.text);
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content) {
        walk(child, buffer);
      }
    }
  };

  const root = doc as TipTapNode;
  if (Array.isArray(root.content)) {
    for (const block of root.content) {
      const buffer: string[] = [];
      walk(block, buffer);
      const text = buffer.join('').trim();
      if (text) lines.push(text);
    }
  }

  return lines.join('\n');
}
