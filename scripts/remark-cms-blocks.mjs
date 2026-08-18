import fs from 'node:fs';
import path from 'node:path';
import { parseCmsEditorBlock, renderCmsEditorBlockHtml } from '../shared/content/editor-blocks.ts';
import { parseMarkdownDocument } from '../shared/content/frontmatter.ts';

const ENTRIES_DIRECTORY = path.resolve('src/content/entradas');

function publishedEntries() {
  if (!fs.existsSync(ENTRIES_DIRECTORY)) return [];
  return fs
    .readdirSync(ENTRIES_DIRECTORY, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .flatMap((entry) => {
      const source = fs.readFileSync(path.join(ENTRIES_DIRECTORY, entry.name), 'utf8');
      try {
        const data = parseMarkdownDocument(source).data;
        if (!Object.keys(data).length) return [];
        return [{ id: entry.name.replace(/\.md$/i, ''), data }];
      } catch {
        return [];
      }
    });
}

function transformNodes(node, entries, excludeSlug = '') {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node.children)) {
    node.children = node.children.map((child) => {
      if (child?.type === 'code') {
        const block = parseCmsEditorBlock(child.lang, child.value);
        if (block) {
          return {
            type: 'html',
            value: renderCmsEditorBlockHtml(block, entries, { excludeSlug }),
          };
        }
      }
      transformNodes(child, entries, excludeSlug);
      return child;
    });
  }
}

export default function remarkCmsBlocks() {
  return (tree, file) => {
    const excludeSlug = file?.path ? path.basename(file.path).replace(/\.mdx?$/i, '') : '';
    transformNodes(tree, publishedEntries(), excludeSlug);
  };
}
