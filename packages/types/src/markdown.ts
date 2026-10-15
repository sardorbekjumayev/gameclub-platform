/**
 * Xavfsiz minimal Markdown parser (huquqiy hujjatlar uchun): sarlavha, paragraf, ro'yxat, iqtibos, chiziq,
 * **qalin**, *kursiv*, `kod`, [havola](url). Natija — oddiy obyekt daraxti; klient uni React elementlariga
 * aylantiradi (dangerouslySetInnerHTML yo'q), shuning uchun xom HTML hech qachon bajarilmaydi — matn sifatida chiqadi.
 */

export type MdInline =
  | { t: 'text'; v: string }
  | { t: 'strong'; c: MdInline[] }
  | { t: 'em'; c: MdInline[] }
  | { t: 'code'; v: string }
  | { t: 'link'; href: string; c: MdInline[] };

export type MdBlock =
  | { t: 'h'; level: 1 | 2 | 3 | 4; c: MdInline[] }
  | { t: 'p'; c: MdInline[] }
  | { t: 'ul'; items: MdInline[][] }
  | { t: 'ol'; start: number; items: MdInline[][] }
  | { t: 'quote'; c: MdInline[] }
  | { t: 'hr' };

/** Faqat http(s), mailto, tel va sayt ichidagi yo'llar (`/...`, `#...`). `javascript:` va boshqalar — havola emas. */
export function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (/^(https?:\/\/|mailto:|tel:)/i.test(href)) return href;
  if (href.startsWith('#') || (href.startsWith('/') && !href.startsWith('//'))) return href;
  return null;
}

export function parseInline(src: string): MdInline[] {
  const out: MdInline[] = [];
  let buf = '';
  const flush = () => {
    if (buf) out.push({ t: 'text', v: buf });
    buf = '';
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\' && i + 1 < src.length && /[\\`*_[\]()#>+\-.!]/.test(src[i + 1])) {
      buf += src[i + 1];
      i += 2;
      continue;
    }
    if (ch === '`') {
      const end = src.indexOf('`', i + 1);
      if (end > i + 1) {
        flush();
        out.push({ t: 'code', v: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if ((ch === '*' || ch === '_') && src[i + 1] === ch) {
      const end = src.indexOf(ch + ch, i + 2);
      if (end > i + 2) {
        flush();
        out.push({ t: 'strong', c: parseInline(src.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if (ch === '*' || ch === '_') {
      const end = src.indexOf(ch, i + 1);
      // `_` so'z ichida (snake_case) kursiv emas
      const wordInside = ch === '_' && i > 0 && /\w/.test(src[i - 1]);
      if (end > i + 1 && !wordInside && src[i + 1] !== ' ') {
        flush();
        out.push({ t: 'em', c: parseInline(src.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    if (ch === '[') {
      const close = src.indexOf('](', i + 1);
      const end = close > 0 ? src.indexOf(')', close + 2) : -1;
      // `[Kompaniya nomi] ... [havola](url)` — birinchi `]` aynan `](` bo'lishi kerak
      if (close > i && end > close && src.indexOf(']', i + 1) === close) {
        const href = safeHref(src.slice(close + 2, end));
        const label = parseInline(src.slice(i + 1, close));
        flush();
        if (href) out.push({ t: 'link', href, c: label });
        else out.push(...label);
        i = end + 1;
        continue;
      }
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}

export function parseMarkdown(md: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  let para: string[] = [];
  let list: { kind: 'ul' | 'ol'; start: number; items: string[] } | null = null;
  let quote: string[] = [];

  const flushPara = () => {
    if (para.length) blocks.push({ t: 'p', c: parseInline(para.join(' ')) });
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map(parseInline);
    blocks.push(list.kind === 'ul' ? { t: 'ul', items } : { t: 'ol', start: list.start, items });
    list = null;
  };
  const flushQuote = () => {
    if (quote.length) blocks.push({ t: 'quote', c: parseInline(quote.join(' ')) });
    quote = [];
  };
  const flushAll = () => {
    flushPara();
    flushList();
    flushQuote();
  };

  for (const raw of md.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    if (!trimmed) {
      flushAll();
      continue;
    }
    let m: RegExpMatchArray | null;
    if ((m = trimmed.match(/^(#{1,6})\s+(.*?)\s*#*$/))) {
      flushAll();
      blocks.push({ t: 'h', level: Math.min(m[1].length, 4) as 1 | 2 | 3 | 4, c: parseInline(m[2]) });
    } else if (/^([-*_])(\s*\1){2,}$/.test(trimmed)) {
      flushAll();
      blocks.push({ t: 'hr' });
    } else if ((m = trimmed.match(/^[-*+]\s+(.*)$/))) {
      flushPara();
      flushQuote();
      if (list?.kind !== 'ul') {
        flushList();
        list = { kind: 'ul', start: 1, items: [] };
      }
      list.items.push(m[1]);
    } else if ((m = trimmed.match(/^(\d{1,9})[.)]\s+(.*)$/))) {
      flushPara();
      flushQuote();
      if (list?.kind !== 'ol') {
        flushList();
        list = { kind: 'ol', start: Number(m[1]), items: [] };
      }
      list.items.push(m[2]);
    } else if ((m = trimmed.match(/^>\s?(.*)$/))) {
      flushPara();
      flushList();
      quote.push(m[1]);
    } else if (list && /^\s+/.test(line)) {
      // Ro'yxat bandining davomi (chekinish bilan)
      list.items[list.items.length - 1] += ` ${trimmed}`;
    } else {
      flushList();
      flushQuote();
      para.push(trimmed);
    }
  }
  flushAll();
  return blocks;
}
