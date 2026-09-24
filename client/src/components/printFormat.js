const BULLET_PREFIX = /^\s*(?:[-*•●▪]|\d+[.)])\s+/;

export function parsePrintContent(value) {
  const lines = String(value ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let paragraphs = [];
  let listItems = [];

  const flushParagraphs = () => {
    for (const text of paragraphs) {
      if (text.trim()) blocks.push({ type: 'paragraph', text: text.trim() });
    }
    paragraphs = [];
  };
  const flushList = () => {
    if (listItems.length) blocks.push({ type: 'list', items: listItems });
    listItems = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      flushParagraphs();
      continue;
    }
    if (BULLET_PREFIX.test(line)) {
      flushParagraphs();
      listItems.push(trimmed.replace(BULLET_PREFIX, '').trim());
      continue;
    }
    flushList();
    paragraphs.push(trimmed);
  }
  flushList();
  flushParagraphs();
  return blocks;
}
