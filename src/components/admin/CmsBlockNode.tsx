import type { JSX } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $getNodeByKey,
  DecoratorNode,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from 'lexical';
import type { CmsEditorBlock } from '../../../shared/content/editor-blocks';

type SerializedCmsBlockNode = Spread<
  { block: CmsEditorBlock; type: 'cms-block'; version: 1 },
  SerializedLexicalNode
>;

function blockLabel(block: CmsEditorBlock): string {
  if (block.type === 'image') return 'Imagen';
  if (block.type === 'entries') return 'Entradas por categoría';
  return block.layout === 'carousel' ? 'Carrusel' : 'Galería';
}

function blockDetail(block: CmsEditorBlock): string {
  if (block.type === 'image') return block.image.alt || 'Imagen decorativa';
  if (block.type === 'entries') {
    return `${block.category} · máximo ${block.limit}`;
  }
  return `${block.images.length} ${block.images.length === 1 ? 'imagen' : 'imágenes'}`;
}

function CmsBlockCard({ block, nodeKey }: { block: CmsEditorBlock; nodeKey: NodeKey }) {
  const [editor] = useLexicalComposerContext();
  const images =
    block.type === 'image' ? [block.image] : block.type === 'gallery' ? block.images : [];

  function mutate(action: 'up' | 'down' | 'remove') {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (!node) return;
      if (action === 'remove') node.remove();
      else if (action === 'up') node.getPreviousSibling()?.insertBefore(node);
      else node.getNextSibling()?.insertAfter(node);
    });
  }

  return (
    <section className="cms-visual-block" data-cms-block={block.type} contentEditable={false}>
      <div className="cms-visual-block-preview" aria-hidden="true">
        {images.slice(0, 4).map((image, index) => (
          <img key={`${image.src}-${index}`} src={image.src} alt="" loading="lazy" />
        ))}
        {block.type === 'entries' && <span>▤</span>}
      </div>
      <div className="cms-visual-block-copy">
        <strong>{blockLabel(block)}</strong>
        <span>{blockDetail(block)}</span>
      </div>
      <div className="cms-visual-block-actions" aria-label={`Acciones de ${blockLabel(block)}`}>
        <button type="button" onClick={() => mutate('up')} title="Mover hacia arriba">
          ↑<span className="sr-only">Mover hacia arriba</span>
        </button>
        <button type="button" onClick={() => mutate('down')} title="Mover hacia abajo">
          ↓<span className="sr-only">Mover hacia abajo</span>
        </button>
        <button type="button" onClick={() => mutate('remove')} title="Eliminar bloque">
          ×<span className="sr-only">Eliminar bloque</span>
        </button>
      </div>
    </section>
  );
}

export class CmsBlockNode extends DecoratorNode<JSX.Element> {
  __block: CmsEditorBlock;

  static getType(): string {
    return 'cms-block';
  }

  static clone(node: CmsBlockNode): CmsBlockNode {
    return new CmsBlockNode(node.__block, node.__key);
  }

  static importJSON(serialized: SerializedCmsBlockNode): CmsBlockNode {
    return new CmsBlockNode(serialized.block);
  }

  constructor(block: CmsEditorBlock, key?: NodeKey) {
    super(key);
    this.__block = structuredClone(block);
  }

  exportJSON(): SerializedCmsBlockNode {
    return { block: this.__block, type: 'cms-block', version: 1 };
  }

  createDOM(): HTMLElement {
    const element = document.createElement('div');
    element.className = 'cms-visual-block-node';
    return element;
  }

  updateDOM(): false {
    return false;
  }

  isInline(): false {
    return false;
  }

  decorate(): JSX.Element {
    return <CmsBlockCard block={this.__block} nodeKey={this.__key} />;
  }

  getBlock(): CmsEditorBlock {
    return structuredClone(this.getLatest().__block);
  }
}

export function $createCmsBlockNode(block: CmsEditorBlock): CmsBlockNode {
  return new CmsBlockNode(block);
}

export function $isCmsBlockNode(node: LexicalNode | null | undefined): node is CmsBlockNode {
  return node instanceof CmsBlockNode;
}
