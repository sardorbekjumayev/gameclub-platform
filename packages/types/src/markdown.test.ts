import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInline, parseMarkdown, safeHref } from './markdown.ts';

test('blocks: headings, paragraphs, lists, hr, quote', () => {
  const md = '## 1. Umumiy\n\n1.1. Birinchi\nqator davomi.\n\n- bir\n- ikki\n  davomi\n\n1) A\n2) B\n\n---\n\n> izoh';
  assert.deepEqual(parseMarkdown(md), [
    { t: 'h', level: 2, c: [{ t: 'text', v: '1. Umumiy' }] },
    { t: 'p', c: [{ t: 'text', v: '1.1. Birinchi qator davomi.' }] },
    { t: 'ul', items: [[{ t: 'text', v: 'bir' }], [{ t: 'text', v: 'ikki davomi' }]] },
    { t: 'ol', start: 1, items: [[{ t: 'text', v: 'A' }], [{ t: 'text', v: 'B' }]] },
    { t: 'hr' },
    { t: 'quote', c: [{ t: 'text', v: 'izoh' }] },
  ]);
});

test('inline: strong, em, code, links', () => {
  assert.deepEqual(parseInline('**Nomi:** [Kompaniya nomi] va *kursiv* `kod`'), [
    { t: 'strong', c: [{ t: 'text', v: 'Nomi:' }] },
    { t: 'text', v: ' [Kompaniya nomi] va ' },
    { t: 'em', c: [{ t: 'text', v: 'kursiv' }] },
    { t: 'text', v: ' ' },
    { t: 'code', v: 'kod' },
  ]);
  assert.deepEqual(parseInline('[oferta](/legal/offer)'), [{ t: 'link', href: '/legal/offer', c: [{ t: 'text', v: 'oferta' }] }]);
  assert.deepEqual(parseInline('snake_case_name'), [{ t: 'text', v: 'snake_case_name' }]);
  assert.deepEqual(parseInline('[STIR] va [sayt](https://zonup.uz)'), [
    { t: 'text', v: '[STIR] va ' },
    { t: 'link', href: 'https://zonup.uz', c: [{ t: 'text', v: 'sayt' }] },
  ]);
});

test('unsafe links become plain text; raw HTML stays text', () => {
  assert.deepEqual(parseInline('[bos](javascript:alert(1))'), [{ t: 'text', v: 'bos' }, { t: 'text', v: ')' }]);
  assert.equal(safeHref('//evil.example'), null);
  assert.equal(safeHref('data:text/html,x'), null);
  assert.equal(safeHref('mailto:info@zonup.uz'), 'mailto:info@zonup.uz');
  assert.deepEqual(parseMarkdown('<script>alert(1)</script>'), [{ t: 'p', c: [{ t: 'text', v: '<script>alert(1)</script>' }] }]);
});
