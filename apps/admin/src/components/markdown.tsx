import { type MdBlock, type MdInline, parseMarkdown } from "@gc/types";
import Link from "next/link";
import { cx } from "@/components/ui";

/**
 * Markdown'ni React elementlari sifatida chiqaradi — HTML hech qachon bajarilmaydi (dangerouslySetInnerHTML yo'q).
 * Parser va havola filtri: `@gc/types` → `markdown.ts`. Server va klient komponentlarida ishlaydi.
 */
export function Markdown({ source, className }: { source: string; className?: string }) {
  return <div className={cx("space-y-4 text-[15px] leading-7", className)}>{parseMarkdown(source).map(block)}</div>;
}

function block(b: MdBlock, i: number) {
  switch (b.t) {
    case "h": {
      // Sahifa sarlavhasi h1 — hujjat ichidagi sarlavhalar h2 dan boshlanadi
      if (b.level <= 2) return <h2 key={i} className="pt-4 font-display text-xl font-bold text-fg">{inline(b.c)}</h2>;
      if (b.level === 3) return <h3 key={i} className="pt-2 text-lg font-bold text-fg">{inline(b.c)}</h3>;
      return <h4 key={i} className="font-bold text-fg">{inline(b.c)}</h4>;
    }
    case "p":
      return <p key={i}>{inline(b.c)}</p>;
    case "ul":
      return (
        <ul key={i} className="list-disc space-y-1.5 pl-6">
          {b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}
        </ul>
      );
    case "ol":
      return (
        <ol key={i} start={b.start} className="list-decimal space-y-1.5 pl-6">
          {b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}
        </ol>
      );
    case "quote":
      return <blockquote key={i} className="border-l-2 border-accent/60 pl-4 text-muted">{inline(b.c)}</blockquote>;
    case "hr":
      return <hr key={i} className="border-line-soft" />;
  }
}

function inline(nodes: MdInline[]): React.ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.t) {
      case "text":
        return n.v;
      case "strong":
        return <strong key={i} className="font-bold text-fg">{inline(n.c)}</strong>;
      case "em":
        return <em key={i}>{inline(n.c)}</em>;
      case "code":
        return <code key={i} className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[13px]">{n.v}</code>;
      case "link":
        return n.href.startsWith("/") || n.href.startsWith("#") ? (
          <Link key={i} href={n.href} className="font-semibold text-accent hover:underline">{inline(n.c)}</Link>
        ) : (
          <a key={i} href={n.href} target="_blank" rel="noopener noreferrer nofollow" className="font-semibold text-accent hover:underline">{inline(n.c)}</a>
        );
    }
  });
}
