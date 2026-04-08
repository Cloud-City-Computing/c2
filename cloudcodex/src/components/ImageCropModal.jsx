/**
 * ImageCropModal — Lightweight crop overlay for image files before upload.
 * Renders a modal with the image, a draggable crop rectangle, and action buttons.
 * Uses canvas to produce the cropped output as a File.
 */
import { useState, useRef, useEffect } from 'react';

const MIN_CROP = 20; // minimum crop dimension in display pixels
const MAX_DISPLAY = 600; // max display width/height inside the modal

export default function ImageCropModal({ file, onConfirm, onCancel }) {
  const [imageSrc, setImageSrc] = useState(null);
  const [naturalSize, setNaturalSize] = useState(null);
  const [displaySize, setDisplaySize] = useState(null);
  const [crop, setCrop] = useState(null);
  const [dragging, setDragging] = useState(null);
  const imgRef = useRef(null);
  const dragStartRef = useRef(null);

  // Load image from file
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setImageSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const handleImageLoad = () => {
    const img = imgRef.current;
    if (!img) return;
    const nat = { w: img.naturalWidth, h: img.naturalHeight };
    setNaturalSize(nat);
    const scale = Math.min(MAX_DISPLAY / nat.w, MAX_DISPLAY / nat.h, 1);
    const disp = { w: Math.round(nat.w * scale), h: Math.round(nat.h * scale) };
    setDisplaySize(disp);
    setCrop({ x: 0, y: 0, w: disp.w, h: disp.h });
  };

  // Drag / resize logic
  const handleMouseDown = (e, type) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(type);
    dragStartRef.current = { mx: e.clientX, my: e.clientY, crop: { ...crop } };
  };

  useEffect(() => {
    if (!dragging || !displaySize) return;

    const onMove = (e) => {
      const { mx, my, crop: c } = dragStartRef.current;
      const dx = e.clientX - mx;
      const dy = e.clientY - my;
      let { x, y, w, h } = c;

      if (dragging === 'move') {
        x = clamp(x + dx, 0, displaySize.w - w);
        y = clamp(y + dy, 0, displaySize.h - h);
      } else {
        if (dragging.includes('w')) {
          const newX = clamp(x + dx, 0, x + w - MIN_CROP);
          w = w + (x - newX);
          x = newX;
        }
        if (dragging.includes('e')) {
          w = clamp(w + dx, MIN_CROP, displaySize.w - x);
        }
        if (dragging.includes('n')) {
          const newY = clamp(y + dy, 0, y + h - MIN_CROP);
          h = h + (y - newY);
          y = newY;
        }
        if (dragging.includes('s')) {
          h = clamp(h + dy, MIN_CROP, displaySize.h - y);
        }
      }

      setCrop({ x, y, w, h });
    };

    const onUp = () => setDragging(null);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [dragging, displaySize]);

  const handleCrop = () => {
    if (!naturalSize || !displaySize || !crop) return;
    const scaleX = naturalSize.w / displaySize.w;
    const scaleY = naturalSize.h / displaySize.h;
    const sx = Math.round(crop.x * scaleX);
    const sy = Math.round(crop.y * scaleY);
    const sw = Math.round(crop.w * scaleX);
    const sh = Math.round(crop.h * scaleY);

    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(imgRef.current, sx, sy, sw, sh, 0, 0, sw, sh);

    canvas.toBlob((blob) => {
      if (blob) {
        const cropped = new File([blob], file.name, { type: file.type || 'image/png' });
        onConfirm(cropped);
      }
    }, file.type || 'image/png');
  };

  if (!imageSrc) return null;

  const ready = displaySize && crop;

  return (
    <div className="image-crop-overlay" onMouseDown={onCancel}>
      <div className="image-crop-modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3 className="image-crop-title">Crop Image</h3>

        <div
          className="image-crop-stage"
          style={{ width: displaySize?.w || 'auto', height: displaySize?.h || 'auto' }}
        >
          <img
            ref={imgRef}
            src={imageSrc}
            onLoad={handleImageLoad}
            style={{ width: displaySize?.w, height: displaySize?.h, display: 'block' }}
            draggable={false}
          />

          {ready && (
            <>
              {/* Dark masks outside crop area */}
              <div className="crop-mask" style={{ top: 0, left: 0, right: 0, height: crop.y }} />
              <div className="crop-mask" style={{ top: crop.y + crop.h, left: 0, right: 0, bottom: 0 }} />
              <div className="crop-mask" style={{ top: crop.y, left: 0, width: crop.x, height: crop.h }} />
              <div className="crop-mask" style={{ top: crop.y, left: crop.x + crop.w, right: 0, height: crop.h }} />

              {/* Crop rectangle */}
              <div
                className="crop-rect"
                style={{ top: crop.y, left: crop.x, width: crop.w, height: crop.h }}
                onMouseDown={(e) => handleMouseDown(e, 'move')}
              >
                {/* Rule-of-thirds grid lines */}
                <div className="crop-grid" />

                {/* Corner handles */}
                <div className="crop-handle crop-handle--nw" onMouseDown={(e) => handleMouseDown(e, 'nw')} />
                <div className="crop-handle crop-handle--ne" onMouseDown={(e) => handleMouseDown(e, 'ne')} />
                <div className="crop-handle crop-handle--sw" onMouseDown={(e) => handleMouseDown(e, 'sw')} />
                <div className="crop-handle crop-handle--se" onMouseDown={(e) => handleMouseDown(e, 'se')} />

                {/* Edge handles */}
                <div className="crop-handle crop-handle--n" onMouseDown={(e) => handleMouseDown(e, 'n')} />
                <div className="crop-handle crop-handle--s" onMouseDown={(e) => handleMouseDown(e, 's')} />
                <div className="crop-handle crop-handle--w" onMouseDown={(e) => handleMouseDown(e, 'w')} />
                <div className="crop-handle crop-handle--e" onMouseDown={(e) => handleMouseDown(e, 'e')} />
              </div>
            </>
          )}
        </div>

        <div className="image-crop-actions">
          <button className="btn btn--primary" onClick={handleCrop}>Crop &amp; Insert</button>
          <button className="btn btn--secondary" onClick={() => onConfirm(file)}>Insert Original</button>
          <button className="btn btn--ghost" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}
