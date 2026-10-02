import {
  NOTE_REFERENCE_KINDS,
  type NoteReferenceKind,
} from '../../entities/note-reference.entity';

/** Minimal shape of a TipTap/ProseMirror JSON node — enough to walk one looking for mentions. */
interface TipTapNode {
  type?: string;
  attrs?: Record<string, unknown> | null;
  content?: TipTapNode[];
}

/** One mention found in a document, before anything has been resolved against the database. */
export interface ExtractedNoteReference {
  kind: NoteReferenceKind;
  id: number;
  /** The label the editor stored in the node, used as the snapshot. */
  label: string | null;
}

/**
 * The two inline node types a reference can arrive as.
 *
 * `entityMention` is the `@` chip and carries its own kind; `noteLink` is the `[[…]]`
 * wikilink and is always a note, so it has no kind attribute to read.
 */
const ENTITY_MENTION_NODE = 'entityMention';
const NOTE_LINK_NODE = 'noteLink';

const KINDS: ReadonlySet<string> = new Set(NOTE_REFERENCE_KINDS);

/** Accepts the number 7 and the string "7" alike: node attrs survive a JSON round trip. */
function toPositiveInt(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function toLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // The column is varchar(255); a pasted paragraph in a label attribute must not be
  // what makes saving a note fail.
  return trimmed.slice(0, 255);
}

function readReference(node: TipTapNode): ExtractedNoteReference | null {
  if (node.type !== ENTITY_MENTION_NODE && node.type !== NOTE_LINK_NODE) return null;

  const attrs = node.attrs ?? {};
  const id = toPositiveInt(attrs.id);
  if (id === null) return null;

  if (node.type === NOTE_LINK_NODE) {
    return { kind: 'note', id, label: toLabel(attrs.label) };
  }

  const kind = typeof attrs.kind === 'string' ? attrs.kind : '';
  if (!KINDS.has(kind)) return null;
  return { kind: kind as NoteReferenceKind, id, label: toLabel(attrs.label) };
}

/**
 * Every record a note points at, read out of its TipTap document.
 *
 * Deduplicated by kind+id: mentioning the same lead in three paragraphs is one
 * reference. The first occurrence wins the label, so the dedupe is stable rather than
 * dependent on which copy was edited last.
 *
 * Defensive throughout — this runs on whatever JSON a client sends, and a malformed
 * chip must cost its own reference, never the whole save.
 */
export function extractReferencesFromTipTapDoc(doc: unknown): ExtractedNoteReference[] {
  if (!doc || typeof doc !== 'object') return [];

  const found = new Map<string, ExtractedNoteReference>();

  const walk = (node: TipTapNode): void => {
    const reference = readReference(node);
    if (reference) {
      const key = `${reference.kind}:${reference.id}`;
      if (!found.has(key)) found.set(key, reference);
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content) walk(child);
    }
  };

  walk(doc as TipTapNode);
  return [...found.values()];
}

/**
 * The text of each block that mentions a given target — what a backlink shows under
 * the source note's title, so "mentioned in Site survey" also says *how*.
 *
 * Mention labels are inlined into the text on purpose: a block reading "walk the roof
 * with @Jane Doe" would otherwise come back as "walk the roof with", which looks like
 * a truncation bug. That is also why this cannot reuse note_pages.content_text, which
 * is built from text nodes only.
 *
 * Blocks are matched at the top level of the document. A mention nested inside a list
 * or a table is attributed to that whole list or table, which reads as the right
 * amount of context and keeps the walk to a single pass.
 */
export function extractReferenceContexts(
  doc: unknown,
  kind: NoteReferenceKind,
  id: number,
  limit = 3,
): string[] {
  if (!doc || typeof doc !== 'object') return [];
  const blocks = (doc as TipTapNode).content;
  if (!Array.isArray(blocks)) return [];

  const contexts: string[] = [];

  for (const block of blocks) {
    if (contexts.length >= limit) break;

    let matches = false;
    const words: string[] = [];

    const walk = (node: TipTapNode): void => {
      const reference = readReference(node);
      if (reference) {
        if (reference.kind === kind && reference.id === id) matches = true;
        if (reference.label) words.push(reference.label);
      } else if (typeof (node as { text?: unknown }).text === 'string') {
        words.push((node as { text: string }).text);
      }
      if (Array.isArray(node.content)) {
        for (const child of node.content) walk(child);
      }
    };

    walk(block);

    if (!matches) continue;
    const text = words.join('').replace(/\s+/g, ' ').trim();
    if (text) contexts.push(text);
  }

  return contexts;
}

/**
 * The same document with every mention reduced to its label.
 *
 * A published note goes to the open internet, where NoteMapper.toPublicDto already
 * withholds entityKind/entityId precisely because "lead 412 exists" is not the
 * customer's business. A mention chip carries the same pair inside the content, so
 * publishing one unsanitized would leak through the body what the DTO is careful not
 * to leak through its fields — and hand out a working deep link besides.
 *
 * The chip keeps its text, which is what makes the sentence readable; it loses the id,
 * so the public reader renders it as plain emphasis with nowhere to click.
 */
export function stripReferenceTargetsForPublic(doc: unknown): unknown {
  if (!doc || typeof doc !== 'object') return doc;

  const sanitize = (node: TipTapNode): TipTapNode => {
    const next: TipTapNode = { ...node };

    if (node.type === ENTITY_MENTION_NODE || node.type === NOTE_LINK_NODE) {
      const label = toLabel(node.attrs?.label);
      next.attrs = { kind: null, id: null, label };
    }

    if (Array.isArray(node.content)) {
      next.content = node.content.map(sanitize);
    }
    return next;
  };

  return sanitize(doc as TipTapNode);
}
