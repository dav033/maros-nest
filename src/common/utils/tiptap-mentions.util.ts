/** Minimal shape of a TipTap/ProseMirror JSON node — enough to walk the tree for mentions. */
interface TipTapNode {
  type?: string;
  attrs?: { id?: string | number };
  content?: TipTapNode[];
}

/**
 * Extracts the user ids behind every `@mention` node in a TipTap comment body (see
 * the frontend's taskMentionExtension, which stores the mentioned user's id as the
 * node's `id` attribute). Deduplicated — mentioning the same person twice in one
 * comment only pulls them into the thread once. Defensive against malformed/empty
 * docs, same posture as extractPlainTextFromTipTapDoc.
 */
export function extractMentionedUserIds(doc: unknown): number[] {
  if (!doc || typeof doc !== 'object') return [];

  const ids = new Set<number>();

  const walk = (node: TipTapNode): void => {
    if (node.type === 'mention' && node.attrs?.id != null) {
      const id = Number(node.attrs.id);
      if (Number.isInteger(id)) ids.add(id);
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content) walk(child);
    }
  };

  walk(doc as TipTapNode);
  return [...ids];
}
