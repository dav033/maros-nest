import {
  extractReferenceContexts,
  extractReferencesFromTipTapDoc,
  stripReferenceTargetsForPublic,
} from './tiptap-references.util';

const paragraph = (...content: unknown[]) => ({ type: 'paragraph', content });
const doc = (...content: unknown[]) => ({ type: 'doc', content });

const mention = (kind: string, id: unknown, label?: string) => ({
  type: 'entityMention',
  attrs: { kind, id, label },
});

const wikilink = (id: unknown, label?: string) => ({
  type: 'noteLink',
  attrs: { id, label },
});

describe('extractReferencesFromTipTapDoc', () => {
  it('returns nothing for an empty or malformed doc', () => {
    expect(extractReferencesFromTipTapDoc(null)).toEqual([]);
    expect(extractReferencesFromTipTapDoc('not a doc')).toEqual([]);
    expect(extractReferencesFromTipTapDoc(doc())).toEqual([]);
  });

  it('reads an entity mention with its kind and label', () => {
    const result = extractReferencesFromTipTapDoc(
      doc(paragraph({ type: 'text', text: 'see ' }, mention('lead', 42, 'Acme roof'))),
    );
    expect(result).toEqual([{ kind: 'lead', id: 42, label: 'Acme roof' }]);
  });

  it('treats a wikilink as a note reference without needing a kind attribute', () => {
    expect(extractReferencesFromTipTapDoc(doc(paragraph(wikilink(7, 'Site survey'))))).toEqual([
      { kind: 'note', id: 7, label: 'Site survey' },
    ]);
  });

  it('accepts ids that survived a JSON round trip as strings', () => {
    expect(extractReferencesFromTipTapDoc(doc(paragraph(mention('task', '9', 'Order steel'))))).toEqual(
      [{ kind: 'task', id: 9, label: 'Order steel' }],
    );
  });

  it('finds mentions nested deep inside lists and tables', () => {
    const nested = doc({
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [paragraph(mention('contact', 3, 'Jane Doe'))],
        },
      ],
    });
    expect(extractReferencesFromTipTapDoc(nested)).toEqual([
      { kind: 'contact', id: 3, label: 'Jane Doe' },
    ]);
  });

  it('collapses repeats of the same target and keeps the first label', () => {
    const result = extractReferencesFromTipTapDoc(
      doc(
        paragraph(mention('lead', 42, 'Acme roof')),
        paragraph(mention('lead', 42, 'stale copy of the name')),
      ),
    );
    expect(result).toEqual([{ kind: 'lead', id: 42, label: 'Acme roof' }]);
  });

  it('keeps the same id under two different kinds apart', () => {
    const result = extractReferencesFromTipTapDoc(
      doc(paragraph(mention('lead', 5, 'Lead five'), mention('project', 5, 'Project five'))),
    );
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.kind)).toEqual(['lead', 'project']);
  });

  it('drops a chip with an unknown kind rather than writing an unconstrained row', () => {
    expect(extractReferencesFromTipTapDoc(doc(paragraph(mention('invoice', 1, 'INV-1'))))).toEqual([]);
  });

  it('drops a chip whose id is missing, zero or not a number', () => {
    const result = extractReferencesFromTipTapDoc(
      doc(
        paragraph(mention('lead', null, 'no id')),
        paragraph(mention('lead', 0, 'zero')),
        paragraph(mention('lead', 'abc', 'text')),
      ),
    );
    expect(result).toEqual([]);
  });

  it('survives one malformed chip without losing the valid ones beside it', () => {
    const result = extractReferencesFromTipTapDoc(
      doc(paragraph(mention('lead', undefined), mention('company', 8, 'Maros'))),
    );
    expect(result).toEqual([{ kind: 'company', id: 8, label: 'Maros' }]);
  });

  it('normalises a blank label to null and truncates one too long for the column', () => {
    const [blank] = extractReferencesFromTipTapDoc(doc(paragraph(mention('user', 2, '   '))));
    expect(blank.label).toBeNull();

    const [long] = extractReferencesFromTipTapDoc(doc(paragraph(mention('user', 3, 'x'.repeat(400)))));
    expect(long.label).toHaveLength(255);
  });
});

describe('extractReferenceContexts', () => {
  it('returns the text of the block holding the mention, label included', () => {
    const body = doc(
      paragraph({ type: 'text', text: 'unrelated opening line' }),
      paragraph(
        { type: 'text', text: 'walk the roof with ' },
        mention('contact', 3, 'Jane Doe'),
        { type: 'text', text: ' on Friday' },
      ),
    );
    expect(extractReferenceContexts(body, 'contact', 3)).toEqual([
      'walk the roof with Jane Doe on Friday',
    ]);
  });

  it('ignores blocks that mention a different target', () => {
    const body = doc(
      paragraph(mention('lead', 1, 'Lead one')),
      paragraph(mention('lead', 2, 'Lead two')),
    );
    expect(extractReferenceContexts(body, 'lead', 2)).toEqual(['Lead two']);
  });

  it('attributes a mention nested in a list to the whole list', () => {
    const body = doc({
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [paragraph({ type: 'text', text: 'call ' }, mention('contact', 3, 'Jane'))] },
      ],
    });
    expect(extractReferenceContexts(body, 'contact', 3)).toEqual(['call Jane']);
  });

  it('stops at the limit so a note mentioning a lead fifty times stays readable', () => {
    const blocks = Array.from({ length: 10 }, (_, i) =>
      paragraph({ type: 'text', text: `line ${i} ` }, mention('lead', 1, 'Acme')),
    );
    expect(extractReferenceContexts(doc(...blocks), 'lead', 1, 2)).toEqual([
      'line 0 Acme',
      'line 1 Acme',
    ]);
  });

  it('skips a matching block whose only content is the chip with no label', () => {
    expect(extractReferenceContexts(doc(paragraph(mention('lead', 1))), 'lead', 1)).toEqual([]);
  });

  it('returns nothing for an empty or malformed doc', () => {
    expect(extractReferenceContexts(null, 'lead', 1)).toEqual([]);
    expect(extractReferenceContexts({}, 'lead', 1)).toEqual([]);
  });
});

describe('stripReferenceTargetsForPublic', () => {
  it('keeps the chip text but removes the id a reader could follow', () => {
    const sanitized = stripReferenceTargetsForPublic(
      doc(paragraph({ type: 'text', text: 'for ' }, mention('lead', 42, 'Acme roof'))),
    ) as any;

    expect(sanitized.content[0].content[1].attrs).toEqual({
      kind: null,
      id: null,
      label: 'Acme roof',
    });
  });

  it('sanitises wikilinks and nested chips too', () => {
    const sanitized = stripReferenceTargetsForPublic(
      doc({
        type: 'bulletList',
        content: [{ type: 'listItem', content: [paragraph(wikilink(7, 'Site survey'))] }],
      }),
    ) as any;

    const chip = sanitized.content[0].content[0].content[0].content[0];
    expect(chip.attrs).toEqual({ kind: null, id: null, label: 'Site survey' });
  });

  it('leaves every other node and its attributes untouched', () => {
    const original = doc(
      paragraph({ type: 'text', text: 'hello' }),
      { type: 'image', attrs: { src: 'notes/3/photo.jpg' } },
    );
    expect(stripReferenceTargetsForPublic(original)).toEqual(original);
  });

  it('does not mutate the document it was handed', () => {
    const original = doc(paragraph(mention('lead', 42, 'Acme roof')));
    const snapshot = JSON.parse(JSON.stringify(original));
    stripReferenceTargetsForPublic(original);
    expect(original).toEqual(snapshot);
  });
});
