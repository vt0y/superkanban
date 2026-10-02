import { Icon } from './Icon';

export function CanvasControls({
  zoom,
  onZoomIn,
  onZoomOut,
  onFit,
  onReset,
  fitLabel,
}: {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onReset: () => void;
  fitLabel: string;
}) {
  return (
    <div className="canvas-controls" onPointerDown={(event) => event.stopPropagation()}>
      <button type="button" onClick={onZoomOut} title="Zoom out" aria-label="Zoom out">
        <Icon name="minus" />
      </button>
      <button type="button" className="zoom-value" onClick={onReset} title="Reset to 100%">
        {Math.round(zoom * 100)}%
      </button>
      <button type="button" onClick={onZoomIn} title="Zoom in" aria-label="Zoom in">
        <Icon name="add" />
      </button>
      <span />
      <button type="button" onClick={onFit} title={fitLabel} aria-label={fitLabel}>
        <Icon name="fit" />
      </button>
    </div>
  );
}
