/**
 * ResizableImage — Tiptap extension that adds resize handles to images.
 * Extends @tiptap/extension-image with a React NodeView and a `width` attribute.
 */
import { useRef, useState, useCallback } from 'react';
import Image from '@tiptap/extension-image';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';

function ResizableImageView({ node, updateAttributes, selected }) {
  const { src, alt, width } = node.attrs;
  const imgRef = useRef(null);
  const [resizing, setResizing] = useState(false);

  const onResizeStart = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = imgRef.current?.offsetWidth || 300;
    setResizing(true);

    const onMouseMove = (moveEvent) => {
      const diff = moveEvent.clientX - startX;
      const newWidth = Math.max(50, Math.round(startWidth + diff));
      updateAttributes({ width: newWidth });
    };

    const onMouseUp = () => {
      setResizing(false);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [updateAttributes]);

  return (
    <NodeViewWrapper className="resizable-image-wrapper">
      <div
        className={`resizable-image${selected ? ' resizable-image--selected' : ''}${resizing ? ' resizable-image--resizing' : ''}`}
        style={{ width: width ? `${width}px` : undefined, maxWidth: '100%' }}
      >
        <img ref={imgRef} src={src} alt={alt || ''} draggable={false} />
        {selected && (
          <>
            <div className="resize-handle resize-handle--e" onMouseDown={onResizeStart} />
            <div className="resize-handle resize-handle--se" onMouseDown={onResizeStart} />
          </>
        )}
        {resizing && <span className="resize-badge">{width || ''}px</span>}
      </div>
    </NodeViewWrapper>
  );
}

const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        renderHTML: (attributes) => {
          if (!attributes.width) return {};
          return { width: attributes.width };
        },
        parseHTML: (element) => {
          const w = element.getAttribute('width');
          return w ? parseInt(w, 10) : null;
        },
      },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView);
  },
});

export default ResizableImage;
