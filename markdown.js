// Minimal Markdown -> DOM renderer for model answers. No dependencies.
// Builds elements with createElement/textContent only (never innerHTML), so
// model output can't inject HTML. Links are limited to http(s) and open in a new tab.
//
// Blocks: paragraphs, # headings, - / 1. lists (nested by indent), ``` code
// blocks, > quotes, --- rules, | tables. Inline: **bold**, *italic*, `code`,
// ~~strike~~, [text](url), bare URLs.

// Wrapped so helpers like el() and link() stay private; only renderMarkdown is global.
const renderMarkdown = (() => {
  const LIST_ITEM_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
  const FENCE_RE = /^\s*(```|~~~)/;
  const HEADING_RE = /^\s*(#{1,6})\s+(.*?)\s*#*\s*$/;
  const RULE_RE = /^\s*([-*_])(\s*\1){2,}\s*$/;
  const QUOTE_RE = /^\s*>/;
  const TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/;

  // Earliest match wins; on a tie, the rule listed first wins (so ** beats *).
  const INLINE_RULES = [
    { re: /`([^`\n]+)`/, render: (m) => el("code", m[1]) },
    { re: /\[([^\]\n]+)\]\(([^)\s]+)\)/, render: (m) => link(m[2], parseInline(m[1])) },
    { re: /\*\*(?=\S)([\s\S]*?\S)\*\*/, render: (m) => el("strong", parseInline(m[1])) },
    { re: /__(?=\S)([\s\S]*?\S)__/, render: (m) => el("strong", parseInline(m[1])) },
    { re: /~~(?=\S)([\s\S]*?\S)~~/, render: (m) => el("del", parseInline(m[1])) },
    { re: /\*(?=\S)([^*\n]*?\S)\*/, render: (m) => el("em", parseInline(m[1])) },
    { re: /(?<!\w)_(?=\S)([^_\n]*?\S)_(?!\w)/, render: (m) => el("em", parseInline(m[1])) },
    { re: /https?:\/\/[^\s<>]*[^\s<>.,;:!?'")\]]/, render: (m) => link(m[0], [m[0]]) },
  ];

  // Returns a DocumentFragment for the given Markdown text.
  function renderMarkdown(source) {
    const lines = source.replace(/\r\n?/g, "\n").split("\n");
    const fragment = document.createDocumentFragment();
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      let match;

      if (!line.trim()) {
        i++;
      } else if ((match = FENCE_RE.exec(line))) {
        const code = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith(match[1])) code.push(lines[i++]);
        i++; // closing fence, if any
        fragment.append(el("pre", [el("code", code.join("\n"))]));
      } else if ((match = HEADING_RE.exec(line))) {
        fragment.append(el(match[1].length <= 2 ? "h3" : "h4", parseInline(match[2])));
        i++;
      } else if (RULE_RE.test(line)) {
        fragment.append(el("hr"));
        i++;
      } else if (QUOTE_RE.test(line)) {
        const quoted = [];
        while (i < lines.length && QUOTE_RE.test(lines[i])) {
          quoted.push(lines[i++].replace(/^\s*>\s?/, ""));
        }
        fragment.append(el("blockquote", [renderMarkdown(quoted.join("\n"))]));
      } else if (isTableStart(lines, i)) {
        i = renderTable(lines, i, fragment);
      } else if (LIST_ITEM_RE.test(line)) {
        i = renderList(lines, i, fragment);
      } else {
        // Paragraph: consecutive lines, kept as separate lines (models use single
        // newlines on purpose).
        const paragraph = [];
        while (i < lines.length && lines[i].trim() && !startsBlock(lines, i)) {
          if (paragraph.length) paragraph.push(el("br"));
          paragraph.push(...parseInline(lines[i++].trim()));
        }
        fragment.append(el("p", paragraph));
      }
    }
    return fragment;
  }

  function startsBlock(lines, i) {
    const line = lines[i];
    return (
      FENCE_RE.test(line) ||
      HEADING_RE.test(line) ||
      RULE_RE.test(line) ||
      QUOTE_RE.test(line) ||
      LIST_ITEM_RE.test(line) ||
      isTableStart(lines, i)
    );
  }

  // Lists nest by indentation. Indented non-item lines continue the previous item.
  // Returns the index of the first line after the list.
  function renderList(lines, i, parent) {
    const stack = []; // { list, indent, lastItem }

    while (i < lines.length) {
      const line = lines[i];

      if (!line.trim()) {
        // A blank line inside a list is fine if the list continues afterwards.
        const next = lines.slice(i + 1).find((l) => l.trim());
        if (next !== undefined && (LIST_ITEM_RE.test(next) || /^\s{2,}\S/.test(next))) {
          i++;
          continue;
        }
        break;
      }

      const match = LIST_ITEM_RE.exec(line);
      if (match) {
        const indent = match[1].replace(/\t/g, "    ").length;
        while (stack.length > 1 && indent < stack.at(-1).indent) stack.pop();
        let top = stack.at(-1);

        // Switching between "-" and "1." at the top level starts a separate list.
        const ordered = /\d/.test(match[2]);
        if (stack.length === 1 && indent <= top.indent && ordered !== (top.list.tagName === "OL")) {
          break;
        }

        if (!top || (indent > top.indent && top.lastItem)) {
          const level = { list: newList(match[2]), indent, lastItem: null };
          if (top) top.lastItem.append(level.list);
          else parent.append(level.list);
          stack.push(level);
          top = level;
        }

        top.lastItem = el("li", parseInline(match[3]));
        top.list.append(top.lastItem);
        i++;
        continue;
      }

      const top = stack.at(-1);
      if (top?.lastItem && /^\s+\S/.test(line)) {
        top.lastItem.append(el("br"), ...parseInline(line.trim()));
        i++;
        continue;
      }
      break;
    }
    return i;
  }

  function newList(marker) {
    if (!/\d/.test(marker)) return el("ul");
    const list = el("ol");
    const start = parseInt(marker, 10);
    if (start !== 1) list.setAttribute("start", String(start));
    return list;
  }

  function isTableStart(lines, i) {
    return lines[i].includes("|") && i + 1 < lines.length && TABLE_SEPARATOR_RE.test(lines[i + 1]);
  }

  function renderTable(lines, i, parent) {
    const headerCells = splitTableRow(lines[i]);
    i += 2; // header + separator

    const headRow = el("tr", headerCells.map((cell) => el("th", parseInline(cell))));
    const body = el("tbody");
    while (i < lines.length && lines[i].trim() && lines[i].includes("|")) {
      const cells = splitTableRow(lines[i++]);
      body.append(el("tr", headerCells.map((_, c) => el("td", parseInline(cells[c] ?? "")))));
    }

    parent.append(el("div", [el("table", [el("thead", [headRow]), body])]));
    parent.lastChild.className = "md-table";
    return i;
  }

  function splitTableRow(line) {
    return line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim());
  }

  // Returns an array of nodes for one line of inline Markdown.
  function parseInline(text) {
    const nodes = [];
    let rest = text;

    while (rest) {
      let best = null;
      for (const rule of INLINE_RULES) {
        const match = rule.re.exec(rest);
        if (match && (!best || match.index < best.match.index)) best = { rule, match };
      }
      if (!best) {
        nodes.push(document.createTextNode(rest));
        break;
      }
      if (best.match.index > 0) {
        nodes.push(document.createTextNode(rest.slice(0, best.match.index)));
      }
      nodes.push(best.rule.render(best.match));
      rest = rest.slice(best.match.index + best.match[0].length);
    }
    return nodes;
  }

  // Only http(s) links become clickable; anything else (javascript:, data:, ...)
  // is shown as plain text.
  function link(url, children) {
    if (!/^https?:\/\//i.test(url)) return el("span", children);
    const a = el("a", children);
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    return a;
  }

  // el("p", "text") or el("p", [nodes or strings]).
  function el(tag, content) {
    const node = document.createElement(tag);
    if (typeof content === "string") node.textContent = content;
    else if (content) node.append(...content);
    return node;
  }

  return renderMarkdown;
})();
