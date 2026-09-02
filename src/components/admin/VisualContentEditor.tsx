import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CodeNode } from '@lexical/code';
import { AutoLinkNode, LinkNode, TOGGLE_LINK_COMMAND } from '@lexical/link';
import {
  ListItemNode,
  ListNode,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
} from '@lexical/list';
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  TRANSFORMERS,
  type MultilineElementTransformer,
  type Transformer,
} from '@lexical/markdown';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { DraggableBlockPlugin_EXPERIMENTAL } from '@lexical/react/LexicalDraggableBlockPlugin';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { $createHeadingNode, $createQuoteNode, HeadingNode, QuoteNode } from '@lexical/rich-text';
import { $setBlocksType } from '@lexical/selection';
import {
  $createParagraphNode,
  $getRoot,
  $getSelection,
  $insertNodes,
  $isRangeSelection,
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  COMMAND_PRIORITY_LOW,
  FORMAT_TEXT_COMMAND,
  REDO_COMMAND,
  UNDO_COMMAND,
  type LexicalEditor,
} from 'lexical';
import type { CmsEditorBlock } from '../../../shared/content/editor-blocks';
import {
  parseCmsEditorBlock,
  serializeCmsEditorBlock,
} from '../../../shared/content/editor-blocks';
import { $createCmsBlockNode, $isCmsBlockNode, CmsBlockNode } from './CmsBlockNode';

const CMS_BLOCK_TRANSFORMER: MultilineElementTransformer = {
  type: 'multiline-element',
  dependencies: [CmsBlockNode],
  export: (node) => ($isCmsBlockNode(node) ? serializeCmsEditorBlock(node.getBlock()) : null),
  regExpStart: /^```(cms-(?:image|gallery|entries))\s*$/,
  regExpEnd: /^```\s*$/,
  replace: (rootNode, _children, startMatch, _endMatch, linesInBetween) => {
    const block = parseCmsEditorBlock(startMatch[1], (linesInBetween || []).join('\n'));
    if (!block) return false;
    rootNode.append($createCmsBlockNode(block));
    return true;
  },
};

export const EDITOR_TRANSFORMERS: Transformer[] = [CMS_BLOCK_TRANSFORMER, ...TRANSFORMERS];

function syncTextarea(markdown: string) {
  const textarea = document.getElementById('body') as HTMLTextAreaElement | null;
  if (!textarea || textarea.value === markdown) return;
  textarea.value = markdown;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function Toolbar() {
  const [editor] = useLexicalComposerContext();
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  useEffect(
    () =>
      editor.registerCommand(
        CAN_UNDO_COMMAND,
        (value) => {
          setCanUndo(value);
          return false;
        },
        COMMAND_PRIORITY_LOW
      ),
    [editor]
  );
  useEffect(
    () =>
      editor.registerCommand(
        CAN_REDO_COMMAND,
        (value) => {
          setCanRedo(value);
          return false;
        },
        COMMAND_PRIORITY_LOW
      ),
    [editor]
  );

  const setBlock = (type: 'paragraph' | 'h2' | 'h3' | 'quote') => {
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      $setBlocksType(selection, () =>
        type === 'paragraph'
          ? $createParagraphNode()
          : type === 'quote'
            ? $createQuoteNode()
            : $createHeadingNode(type)
      );
    });
  };

  const addLink = () => {
    const url = window.prompt('Dirección del enlace (https://…)');
    if (url === null) return;
    const value = url.trim();
    if (value && !/^(?:https?:\/\/|mailto:|\/|#)/i.test(value)) {
      window.alert('Usa una dirección https://, un correo mailto:, una ruta / o un enlace #.');
      return;
    }
    editor.dispatchCommand(TOGGLE_LINK_COMMAND, value || null);
  };

  return (
    <div className="cms-wysiwyg-toolbar" role="toolbar" aria-label="Formato del contenido">
      <button
        type="button"
        onClick={() => editor.dispatchCommand(UNDO_COMMAND, undefined)}
        disabled={!canUndo}
        title="Deshacer"
      >
        ↶
      </button>
      <button
        type="button"
        onClick={() => editor.dispatchCommand(REDO_COMMAND, undefined)}
        disabled={!canRedo}
        title="Rehacer"
      >
        ↷
      </button>
      <span aria-hidden="true" />
      <select
        aria-label="Tipo de texto"
        defaultValue="paragraph"
        onChange={(event) => setBlock(event.target.value as 'paragraph' | 'h2' | 'h3' | 'quote')}
      >
        <option value="paragraph">Párrafo</option>
        <option value="h2">Título</option>
        <option value="h3">Subtítulo</option>
        <option value="quote">Cita</option>
      </select>
      <button
        type="button"
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold')}
        aria-label="Negrita"
      >
        <strong>N</strong>
      </button>
      <button
        type="button"
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic')}
        aria-label="Cursiva"
      >
        <em>C</em>
      </button>
      <button
        type="button"
        onClick={() => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)}
        aria-label="Lista con viñetas"
      >
        • Lista
      </button>
      <button
        type="button"
        onClick={() => editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined)}
        aria-label="Lista numerada"
      >
        1. Lista
      </button>
      <button type="button" onClick={addLink} aria-label="Añadir enlace">
        🔗 Enlace
      </button>
    </div>
  );
}

function BridgePlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const load = (event: Event) => {
      const markdown = String((event as CustomEvent<{ body?: string }>).detail?.body || '');
      editor.update(
        () => {
          $convertFromMarkdownString(markdown, EDITOR_TRANSFORMERS);
        },
        { tag: 'cms-body-load' }
      );
    };
    const insertBlock = (event: Event) => {
      const block = (event as CustomEvent<{ block?: CmsEditorBlock }>).detail?.block;
      if (!block) return;
      editor.update(() => {
        const nodes = [$createCmsBlockNode(block), $createParagraphNode()];
        if ($isRangeSelection($getSelection())) $insertNodes(nodes);
        else $getRoot().append(...nodes);
      });
      editor.focus();
    };
    const insertQuote = () => {
      editor.update(() => {
        const quote = $createQuoteNode();
        const nodes = [quote, $createParagraphNode()];
        if ($isRangeSelection($getSelection())) $insertNodes(nodes);
        else $getRoot().append(...nodes);
        quote.selectStart();
      });
      editor.focus();
    };
    window.addEventListener('cms:body-load', load);
    window.addEventListener('cms:block-insert', insertBlock);
    window.addEventListener('cms:quote-insert', insertQuote);
    const textarea = document.getElementById('body') as HTMLTextAreaElement | null;
    load(new CustomEvent('cms:body-load', { detail: { body: textarea?.value || '' } }));
    return () => {
      window.removeEventListener('cms:body-load', load);
      window.removeEventListener('cms:block-insert', insertBlock);
      window.removeEventListener('cms:quote-insert', insertQuote);
    };
  }, [editor]);

  const onChange = useCallback(
    (
      editorState: Parameters<Parameters<typeof OnChangePlugin>[0]['onChange']>[0],
      _editor: LexicalEditor,
      tags: Set<string>
    ) => {
      if (tags.has('cms-body-load')) return;
      editorState.read(() => syncTextarea($convertToMarkdownString(EDITOR_TRANSFORMERS)));
    },
    []
  );

  return <OnChangePlugin onChange={onChange} ignoreSelectionChange />;
}

function DragPlugin({ anchor }: { anchor: HTMLElement }) {
  const menuRef = useRef<HTMLButtonElement>(null);
  const targetLineRef = useRef<HTMLDivElement>(null);
  return (
    <DraggableBlockPlugin_EXPERIMENTAL
      anchorElem={anchor}
      menuRef={menuRef}
      targetLineRef={targetLineRef}
      menuComponent={
        <button
          ref={menuRef}
          type="button"
          className="cms-wysiwyg-drag"
          aria-label="Arrastrar bloque"
          title="Arrastrar bloque"
        >
          ⋮⋮
        </button>
      }
      targetLineComponent={<div ref={targetLineRef} className="cms-wysiwyg-drop-line" />}
      isOnMenu={(element) => Boolean(element.closest('.cms-wysiwyg-drag'))}
    />
  );
}

function EditorSurface() {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  useEffect(() => setAnchor(wrapperRef.current), []);
  return (
    <div className="cms-wysiwyg-shell" ref={wrapperRef}>
      <Toolbar />
      <div className="cms-wysiwyg-canvas">
        <RichTextPlugin
          contentEditable={<ContentEditable className="cms-wysiwyg-input" aria-label="Contenido" />}
          placeholder={<p className="cms-wysiwyg-placeholder">Empieza a escribir tu contenido…</p>}
          ErrorBoundary={({ children }) => children}
        />
        {anchor && <DragPlugin anchor={anchor} />}
      </div>
      <HistoryPlugin />
      <ListPlugin />
      <LinkPlugin />
      <MarkdownShortcutPlugin transformers={EDITOR_TRANSFORMERS} />
      <BridgePlugin />
    </div>
  );
}

export default function VisualContentEditor() {
  const initialConfig = useMemo(
    () => ({
      namespace: 'SimposioVisualEditor',
      nodes: [
        HeadingNode,
        QuoteNode,
        ListNode,
        ListItemNode,
        LinkNode,
        AutoLinkNode,
        CodeNode,
        CmsBlockNode,
      ],
      editorState: () => {
        const textarea = document.getElementById('body') as HTMLTextAreaElement | null;
        $convertFromMarkdownString(textarea?.value || '', EDITOR_TRANSFORMERS);
      },
      onError(error: Error) {
        throw error;
      },
      theme: {
        heading: { h2: 'cms-wysiwyg-h2', h3: 'cms-wysiwyg-h3' },
        link: 'cms-wysiwyg-link',
        list: { ul: 'cms-wysiwyg-list', ol: 'cms-wysiwyg-list' },
        quote: 'cms-wysiwyg-quote',
        text: { bold: 'cms-wysiwyg-bold', italic: 'cms-wysiwyg-italic' },
      },
    }),
    []
  );
  return (
    <LexicalComposer initialConfig={initialConfig}>
      <EditorSurface />
    </LexicalComposer>
  );
}
