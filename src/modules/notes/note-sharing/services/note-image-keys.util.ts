/** Minimal TipTap/ProseMirror node shape — the same walk as tiptap-text.util.ts. */
interface TipTapNode {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: TipTapNode[];
}

/**
 * Every S3 key referenced by image nodes in a TipTap document.
 *
 * This is the allow-list the public image endpoint checks against, so it has to be
 * exhaustive in one direction: a key it misses becomes a broken image (annoying), while
 * a key it invents would become a signed URL for an object the reader was never given
 * (a leak). Missing is the safe failure, and the walk therefore stays deliberately
 * literal — it collects what is in the document and nothing derived from it.
 *
 * External images (http/https/data) are skipped: the browser fetches those directly and
 * they never reach the proxy.
 */
export function collectImageKeys(doc: unknown): Set<string> {
  const keys = new Set<string>();
  if (!doc || typeof doc !== 'object') return keys;

  const walk = (node: TipTapNode): void => {
    if (node.type === 'image') {
      const src = node.attrs?.src;
      if (typeof src === 'string' && src && !isExternal(src)) {
        keys.add(src);
      }
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content) walk(child);
    }
  };

  walk(doc as TipTapNode);
  return keys;
}

function isExternal(src: string): boolean {
  return /^https?:\/\//.test(src) || src.startsWith('data:');
}
