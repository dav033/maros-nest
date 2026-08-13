import { extractMentionedUserIds } from './tiptap-mentions.util';

describe('extractMentionedUserIds', () => {
  it('returns an empty array for a doc with no mentions', () => {
    const doc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'no mentions here' }] }],
    };
    expect(extractMentionedUserIds(doc)).toEqual([]);
  });

  it('extracts a single mention', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'hey ' },
            { type: 'mention', attrs: { id: '42', label: 'Jane' } },
          ],
        },
      ],
    };
    expect(extractMentionedUserIds(doc)).toEqual([42]);
  });

  it('extracts several distinct mentions across the doc', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'mention', attrs: { id: '1' } },
            { type: 'text', text: ' and ' },
            { type: 'mention', attrs: { id: '2' } },
          ],
        },
      ],
    };
    expect(extractMentionedUserIds(doc).sort()).toEqual([1, 2]);
  });

  it('deduplicates the same person mentioned twice', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'mention', attrs: { id: '7' } }] },
        { type: 'paragraph', content: [{ type: 'mention', attrs: { id: '7' } }] },
      ],
    };
    expect(extractMentionedUserIds(doc)).toEqual([7]);
  });

  it('ignores a mention node with a non-numeric id rather than throwing', () => {
    const doc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'mention', attrs: { id: 'not-a-number' } }] }],
    };
    expect(extractMentionedUserIds(doc)).toEqual([]);
  });

  it('is defensive against null, undefined and malformed docs', () => {
    expect(extractMentionedUserIds(null)).toEqual([]);
    expect(extractMentionedUserIds(undefined)).toEqual([]);
    expect(extractMentionedUserIds('not an object')).toEqual([]);
    expect(extractMentionedUserIds({})).toEqual([]);
  });
});
