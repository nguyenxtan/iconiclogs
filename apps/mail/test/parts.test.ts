import { expect, it } from 'vitest';
import { parseMessage } from '../src/server/providers/mime';
import { decodedAttachmentParts } from '../src/server/providers/parts';

const raw = Buffer.from(
  [
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="outer"',
    '',
    '--outer',
    'Content-Type: multipart/related; boundary="inner"',
    '',
    '--inner',
    'Content-Type: text/plain',
    '',
    'Body',
    '--inner',
    'Content-Type: application/octet-stream',
    'Content-Disposition: attachment; filename="same.bin"',
    'Content-Transfer-Encoding: base64',
    '',
    'AQID',
    '--inner--',
    '--outer',
    'Content-Type: application/octet-stream',
    'Content-Disposition: attachment; filename="same.bin"',
    'Content-Transfer-Encoding: base64',
    '',
    'BAUGBwg=',
    '--outer--',
    '',
  ].join('\r\n'),
);
const structure = {
  type: 'multipart/mixed',
  childNodes: [
    {
      type: 'multipart/related',
      part: '1',
      childNodes: [
        { type: 'text/plain', part: '1.1', size: 4 },
        {
          type: 'application/octet-stream',
          part: '1.2',
          size: 4,
          disposition: 'attachment',
          dispositionParameters: { filename: 'same.bin' },
        },
      ],
    },
    {
      type: 'application/octet-stream',
      part: '2',
      size: 8,
      disposition: 'attachment',
      dispositionParameters: { filename: 'same.bin' },
    },
  ],
};
it('maps a decoded Content-ID by MIME part rather than by a duplicate filename', async () => {
  const withCid = Buffer.from(
    raw
      .toString()
      .replace(
        'Content-Disposition: attachment; filename="same.bin"\r\n',
        'Content-Disposition: attachment; filename="same.bin"\r\nContent-ID: <first@example.com>\r\n',
      ),
  );
  const parsed = await parseMessage(withCid);
  const parts = decodedAttachmentParts(structure, [...parsed.attachments].reverse());
  expect(parts[0]).toMatchObject({ id: 0, part: '1.2', contentId: 'first@example.com' });
  expect(parts[1]?.contentId).toBeUndefined();
});
it('maps actual decoded MIME bytes by partId despite duplicate filenames and reordered parser results', async () => {
  const parsed = await parseMessage(raw);
  expect(parsed.attachments.map((file) => file.partId)).toEqual(['1.2', '2']);
  const parts = decodedAttachmentParts(structure, [...parsed.attachments].reverse());
  expect(
    parts.map((file) => ({ part: file.part, id: file.id, name: file.name, size: file.size })),
  ).toEqual([
    { part: '1.2', id: 0, name: 'same.bin', size: 3 },
    { part: '2', id: 1, name: 'same.bin', size: 5 },
  ]);
});
it('uses a sole top-level MIME attachment without a partId only when the mapping is unambiguous', async () => {
  const parsed = await parseMessage(
    Buffer.from(
      'MIME-Version: 1.0\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename="root.bin"\r\nContent-Transfer-Encoding: base64\r\n\r\nAQIDBA==\r\n',
    ),
  );
  expect(parsed.attachments).toHaveLength(1);
  expect(parsed.attachments[0]!.partId).toBeFalsy();
  expect(
    decodedAttachmentParts(
      { type: 'application/octet-stream', part: '1', size: 8, disposition: 'attachment' },
      parsed.attachments,
    )[0],
  ).toMatchObject({ part: '1', size: 4 });
});
it('keeps an unmatched downloadable part explicitly unknown instead of guessing by filename or order', async () => {
  const parsed = await parseMessage(raw);
  const unmatched = {
    ...structure,
    childNodes: [...structure.childNodes.slice(0, 1), { ...structure.childNodes[1]!, part: '9' }],
  };
  expect(decodedAttachmentParts(unmatched, parsed.attachments)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ part: '1.2', size: 3 }),
      expect.objectContaining({ part: '9', sizeKnown: false }),
    ]),
  );
});
