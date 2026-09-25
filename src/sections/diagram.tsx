import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { AppContextValue } from '@/context/AppContext';
import { Avatar, CanvasControls } from '@/components/common';
import { useCanvasViewport, useItemDrag } from '@/hooks';
import { USECASE_STATUS_COLORS } from '@/config/constants';
import {
  bulkUpdateWorkItems, createDiagramNode, createWorkItem, deleteDiagramElements, updateWorkItem,
} from '@/services';
import type { Diagram, DiagramEdge, DiagramEdgeKind, DiagramNode, DiagramNodeKind, Membership, ProjectUseCase, Role } from '@/types';
import { attempt, toast } from '@/components/toast';
import { pick } from '@/utils/formatters';
import { NODE_DEFAULTS, classifyUseCase, clipToShape, nextUseCaseCode, validEdge, type UseCaseKind } from '@/utils/usecase-model';
import { CommentThread } from '@/components/comments/CommentThread';

type Tool = 'select' | DiagramNodeKind | DiagramEdgeKind;
const NODE_TOOLS: { id: DiagramNodeKind; icon: string; th: string; en: string }[] = [
  { id: 'actor', icon: '웃', th: 'Actor', en: 'Actor' },
  { id: 'usecase', icon: '⬭', th: 'Use Case', en: 'Use case' },
  { id: 'boundary', icon: '▭', th: 'ขอบเขตระบบ', en: 'System boundary' },
  { id: 'note', icon: '🗒', th: 'โน้ต', en: 'Note' },
];
const EDGE_TOOLS: { id: DiagramEdgeKind; icon: string; th: string; en: string }[] = [
  { id: 'association', icon: '—', th: 'Association', en: 'Association' },
  { id: 'include', icon: '⇢', th: '«include»', en: '«include»' },
  { id: 'extend', icon: '⇠', th: '«extend»', en: '«extend»' },
  { id: 'generalization', icon: '▷', th: 'Generalization', en: 'Generalization' },
];
const KIND_LABEL: Record<UseCaseKind, { th: string; en: string }> = {
  base: { th: 'Base', en: 'Base' }, common: { th: 'Common', en: 'Common' }, extension: { th: 'Extension', en: 'Extension' },
};
const GRID = 20;
const snapValue = (value: number) => Math.round(value / GRID) * GRID;

interface Props {
  diagram: Diagram;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  useCases: ProjectUseCase[];
  members: Membership[];
  context: AppContextValue;
  role: Role | null;
  projectId: string;
  readOnly: boolean;
}

export function DiagramEditor({ diagram, nodes: allNodes, edges: allEdges, useCases, members, context, role, projectId, readOnly }: Props) {
  const { locale, user } = context;
  const nodes = useMemo(() => allNodes.filter((node) => node.diagramId === diagram.id), [allNodes, diagram.id]);
  const edges = useMemo(() => allEdges.filter((edge) => edge.diagramId === diagram.id), [allEdges, diagram.id]);
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const useCaseById = useMemo(() => new Map(useCases.map((item) => [item.id, item])), [useCases]);
  const canvas = useCanvasViewport(`ps.diagram.view.${diagram.id}`);
  const svgRef = useRef<SVGSVGElement>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [selected, setSelected] = useState<{ nodes: Set<string>; edges: Set<string> }>({ nodes: new Set(), edges: new Set() });
  const [snap, setSnap] = useState(true);
  const [mineOnly, setMineOnly] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [editingLabel, setEditingLabel] = useState<{ id: string; value: string } | null>(null);
  const [draftEdge, setDraftEdge] = useState<{ from: string; kind: DiagramEdgeKind; x: number; y: number } | null>(null);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [resizing, setResizing] = useState<{ id: string; w: number; h: number; startX: number; startY: number; pointerId: number } | null>(null);
  const [resizeOverride, setResizeOverride] = useState<{ id: string; w: number; h: number } | null>(null);

  const drag = useItemDrag(canvas.toWorld, (positions) => {
    void attempt(() => bulkUpdateWorkItems(projectId, 'diagramNodes', [...positions.keys()], (id) => positions.get(id)!), pick(locale, 'ย้ายไม่สำเร็จ', 'Move failed'));
  });

  // Drop selection entries that other collaborators deleted.
  useEffect(() => {
    setSelected((current) => {
      const nextNodes = new Set([...current.nodes].filter((id) => nodeById.has(id)));
      const nextEdges = new Set([...current.edges].filter((id) => edges.some((edge) => edge.id === id)));
      return nextNodes.size === current.nodes.size && nextEdges.size === current.edges.size ? current : { nodes: nextNodes, edges: nextEdges };
    });
  }, [nodeById, edges]);

  const boxOf = (node: DiagramNode) => {
    const position = drag.overrides.get(node.id);
    const size = resizeOverride?.id === node.id ? resizeOverride : node;
    return { x: position?.x ?? node.x, y: position?.y ?? node.y, w: size.w, h: size.h };
  };
  const labelOf = (node: DiagramNode) => (node.kind === 'usecase' && useCaseById.get(node.useCaseId)?.title) || node.label;

  /** Names of actors linked to a use case node by association (used to keep ProjectUseCase.actor in sync). */
  const actorNamesFor = (useCaseNodeId: string, edgeList: Pick<DiagramEdge, 'from' | 'to' | 'kind'>[], labelOverrides = new Map<string, string>()) => edgeList
    .filter((edge) => edge.kind === 'association' && (edge.from === useCaseNodeId || edge.to === useCaseNodeId))
    .map((edge) => nodeById.get(edge.from === useCaseNodeId ? edge.to : edge.from))
    .filter((node): node is DiagramNode => node?.kind === 'actor')
    .map((node) => labelOverrides.get(node.id) ?? node.label)
    .filter((name, index, list) => list.indexOf(name) === index)
    .join(', ');

  const syncActors = (useCaseNodeIds: string[], edgeList: Pick<DiagramEdge, 'from' | 'to' | 'kind'>[], labelOverrides?: Map<string, string>) => {
    useCaseNodeIds.forEach((nodeId) => {
      const node = nodeById.get(nodeId);
      const useCase = node && useCaseById.get(node.useCaseId);
      if (!useCase) return;
      const actor = actorNamesFor(nodeId, edgeList, labelOverrides);
      if (actor !== useCase.actor) void attempt(() => updateWorkItem(projectId, 'useCases', useCase.id, { actor }), pick(locale, 'ซิงก์ actor ไม่สำเร็จ', 'Actor sync failed'));
    });
  };

  /* ---------- creation ---------- */

  const placeNode = async (kind: DiagramNodeKind, worldX: number, worldY: number, existingUseCase?: ProjectUseCase) => {
    const defaults = NODE_DEFAULTS[kind];
    const x = snap ? snapValue(worldX - defaults.w / 2) : worldX - defaults.w / 2;
    const y = snap ? snapValue(worldY - defaults.h / 2) : worldY - defaults.h / 2;
    const label = existingUseCase?.title || defaults.label;
    const id = await attempt(async () => {
      if (existingUseCase) {
        return createWorkItem(projectId, 'diagramNodes', { diagramId: diagram.id, kind, x, y, w: defaults.w, h: defaults.h, label, useCaseId: existingUseCase.id }, user, { type: 'diagram_updated', th: `วาง ${existingUseCase.code} บนไดอะแกรม`, en: `placed ${existingUseCase.code} on the diagram` });
      }
      return createDiagramNode(projectId, { diagramId: diagram.id, kind, x, y, w: defaults.w, h: defaults.h, label }, user, kind === 'usecase' ? nextUseCaseCode(useCases.map((item) => item.code)) : undefined);
    }, pick(locale, 'เพิ่มไม่สำเร็จ', 'Could not add shape'));
    if (id) {
      setSelected({ nodes: new Set([id]), edges: new Set() });
      setTool('select');
      if (!existingUseCase && kind !== 'boundary') setEditingLabel({ id, value: label });
    }
  };

  const connect = (fromId: string, toId: string, kind: DiagramEdgeKind) => {
    const from = nodeById.get(fromId);
    const to = nodeById.get(toId);
    if (!from || !to || fromId === toId) return;
    // Handle-drag uses "auto": association where valid, otherwise «include» between use cases.
    const edgeKind: DiagramEdgeKind = validEdge(from.kind, to.kind, kind) ? kind : validEdge(from.kind, to.kind, 'include') && tool === 'select' ? 'include' : kind;
    if (!validEdge(from.kind, to.kind, edgeKind)) {
      toast(pick(locale, 'เชื่อมแบบนี้ไม่ได้: association = actor↔use case, include/extend = use case→use case, generalization = ชนิดเดียวกัน', 'Invalid link: association = actor↔use case, include/extend = use case→use case, generalization = same kind'), 'error');
      return;
    }
    if (edges.some((edge) => edge.kind === edgeKind && ((edge.from === fromId && edge.to === toId) || (edgeKind === 'association' && edge.from === toId && edge.to === fromId)))) return;
    void attempt(() => createWorkItem(projectId, 'diagramEdges', { diagramId: diagram.id, from: fromId, to: toId, kind: edgeKind }, user, { type: 'diagram_updated', th: `เชื่อม ${labelOf(from)} → ${labelOf(to)}`, en: `linked ${labelOf(from)} → ${labelOf(to)}` }), pick(locale, 'เชื่อมไม่สำเร็จ', 'Could not connect'))
      .then(() => { if (edgeKind === 'association') syncActors([fromId, toId].filter((id) => nodeById.get(id)?.kind === 'usecase'), [...edges, { from: fromId, to: toId, kind: edgeKind }]); });
  };

  const deleteSelection = () => {
    const nodeIds = [...selected.nodes];
    const edgeIds = new Set(selected.edges);
    edges.forEach((edge) => { if (selected.nodes.has(edge.from) || selected.nodes.has(edge.to)) edgeIds.add(edge.id); });
    if (!nodeIds.length && !edgeIds.size) return;
    const remaining = edges.filter((edge) => !edgeIds.has(edge.id));
    const affected = edges.filter((edge) => edgeIds.has(edge.id) && edge.kind === 'association').flatMap((edge) => [edge.from, edge.to]).filter((id) => nodeById.get(id)?.kind === 'usecase' && !selected.nodes.has(id));
    void attempt(() => deleteDiagramElements(projectId, nodeIds, [...edgeIds]), pick(locale, 'ลบไม่สำเร็จ', 'Delete failed')).then(() => syncActors([...new Set(affected)], remaining));
    setSelected({ nodes: new Set(), edges: new Set() });
  };

  const commitLabel = () => {
    if (!editingLabel) return;
    const node = nodeById.get(editingLabel.id);
    const value = editingLabel.value.trim();
    setEditingLabel(null);
    if (!node || !value || value === labelOf(node)) return;
    void attempt(() => updateWorkItem(projectId, 'diagramNodes', node.id, { label: value }), pick(locale, 'เปลี่ยนชื่อไม่สำเร็จ', 'Rename failed'));
    const useCase = node.kind === 'usecase' ? useCaseById.get(node.useCaseId) : undefined;
    if (useCase) void attempt(() => updateWorkItem(projectId, 'useCases', useCase.id, { title: value }), pick(locale, 'เปลี่ยนชื่อไม่สำเร็จ', 'Rename failed'));
    if (node.kind === 'actor') {
      const linked = edges.filter((edge) => edge.kind === 'association' && (edge.from === node.id || edge.to === node.id)).map((edge) => (edge.from === node.id ? edge.to : edge.from));
      syncActors(linked, edges, new Map([[node.id, value]]));
    }
  };

  /* ---------- keyboard ---------- */

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable || document.querySelector('.modal-backdrop')) return;
      if (!readOnly && (event.key === 'Delete' || event.key === 'Backspace')) { event.preventDefault(); deleteSelection(); }
      else if (event.key === 'Escape') { setTool('select'); setDraftEdge(null); setSelected({ nodes: new Set(), edges: new Set() }); setInspectorOpen(false); }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); setSelected({ nodes: new Set(nodes.map((node) => node.id)), edges: new Set(edges.map((edge) => edge.id)) }); }
      else if (!readOnly && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const shortcut: Record<string, Tool> = { v: 'select', a: 'actor', u: 'usecase', b: 'boundary', n: 'note', l: 'association', i: 'include', e: 'extend', g: 'generalization' };
        const next = shortcut[event.key.toLowerCase()];
        if (next) setTool(next);
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });

  /* ---------- pointer handling ---------- */

  const nodeAt = (clientX: number, clientY: number): DiagramNode | undefined => {
    const hits = document.elementsFromPoint(clientX, clientY);
    for (const hit of hits) {
      const id = (hit as Element).closest?.('[data-node-id]')?.getAttribute('data-node-id');
      if (id && nodeById.get(id)?.kind !== 'boundary') return nodeById.get(id);
    }
    for (const hit of hits) {
      const id = (hit as Element).closest?.('[data-node-id]')?.getAttribute('data-node-id');
      if (id) return nodeById.get(id);
    }
    return undefined;
  };

  const onBackgroundDown = (event: ReactPointerEvent) => {
    const world = canvas.toWorld(event.clientX, event.clientY);
    // preventDefault stops the mousedown focus change from blurring the rename box that opens after placing.
    if (!readOnly && NODE_TOOLS.some((item) => item.id === tool) && event.button === 0) { event.preventDefault(); void placeNode(tool as DiagramNodeKind, world.x, world.y); return; }
    if (event.shiftKey && event.button === 0) {
      svgRef.current?.setPointerCapture(event.pointerId);
      setMarquee({ x0: world.x, y0: world.y, x1: world.x, y1: world.y });
      return;
    }
    if (!canvas.handlePointerDown(event, true)) return;
    setSelected({ nodes: new Set(), edges: new Set() });
  };

  const onNodeDown = (event: ReactPointerEvent, node: DiagramNode) => {
    event.stopPropagation();
    if (canvas.handlePointerDown(event, false)) return;
    if (event.button !== 0) return;
    if (EDGE_TOOLS.some((item) => item.id === tool)) {
      const world = canvas.toWorld(event.clientX, event.clientY);
      svgRef.current?.setPointerCapture(event.pointerId);
      setDraftEdge({ from: node.id, kind: tool as DiagramEdgeKind, x: world.x, y: world.y });
      return;
    }
    if (NODE_TOOLS.some((item) => item.id === tool)) { event.preventDefault(); const world = canvas.toWorld(event.clientX, event.clientY); void placeNode(tool as DiagramNodeKind, world.x, world.y); return; }
    let nextNodes = selected.nodes;
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      nextNodes = new Set(selected.nodes);
      if (nextNodes.has(node.id)) nextNodes.delete(node.id); else nextNodes.add(node.id);
      setSelected({ nodes: nextNodes, edges: selected.edges });
    } else if (!selected.nodes.has(node.id)) {
      nextNodes = new Set([node.id]);
      setSelected({ nodes: nextNodes, edges: new Set() });
    }
    if (!nextNodes.has(node.id)) return;
    if (readOnly) return;
    // Moving a system boundary carries the shapes that sit inside it.
    const moving = new Set(nextNodes);
    nextNodes.forEach((id) => {
      const boundary = nodeById.get(id);
      if (boundary?.kind !== 'boundary') return;
      nodes.forEach((inner) => { if (inner.id !== id && inner.x >= boundary.x && inner.y >= boundary.y && inner.x + inner.w <= boundary.x + boundary.w && inner.y + inner.h <= boundary.y + boundary.h) moving.add(inner.id); });
    });
    drag.start(event, new Map([...moving].map((id) => { const item = nodeById.get(id)!; return [id, { x: item.x, y: item.y }]; })));
  };

  const onHandleDown = (event: ReactPointerEvent, node: DiagramNode) => {
    event.stopPropagation();
    const world = canvas.toWorld(event.clientX, event.clientY);
    svgRef.current?.setPointerCapture(event.pointerId);
    setDraftEdge({ from: node.id, kind: 'association', x: world.x, y: world.y });
  };

  const onResizeDown = (event: ReactPointerEvent, node: DiagramNode) => {
    event.stopPropagation();
    const world = canvas.toWorld(event.clientX, event.clientY);
    svgRef.current?.setPointerCapture(event.pointerId);
    setResizing({ id: node.id, w: node.w, h: node.h, startX: world.x, startY: world.y, pointerId: event.pointerId });
  };

  const onMove = (event: ReactPointerEvent) => {
    if (drag.move(event, snap ? snapValue : undefined)) return;
    if (draftEdge || marquee || resizing) {
      const world = canvas.toWorld(event.clientX, event.clientY);
      if (draftEdge) setDraftEdge({ ...draftEdge, x: world.x, y: world.y });
      if (marquee) setMarquee({ ...marquee, x1: world.x, y1: world.y });
      if (resizing) {
        const min = resizing.id && nodeById.get(resizing.id)?.kind === 'boundary' ? 160 : 60;
        const w = Math.max(min, resizing.w + world.x - resizing.startX);
        const h = Math.max(40, resizing.h + world.y - resizing.startY);
        setResizeOverride({ id: resizing.id, w: snap ? snapValue(w) : w, h: snap ? snapValue(h) : h });
      }
      return;
    }
    canvas.handlePointerMove(event);
  };

  const onUp = (event: ReactPointerEvent) => {
    const result = drag.end(event);
    if (result === 'click' && tool === 'select') {
      const id = (event.target as Element).closest?.('[data-node-id]')?.getAttribute('data-node-id');
      if (id && !event.shiftKey && !event.ctrlKey && !event.metaKey) setSelected({ nodes: new Set([id]), edges: new Set() });
    }
    if (draftEdge) {
      const target = nodeAt(event.clientX, event.clientY);
      if (target) connect(draftEdge.from, target.id, draftEdge.kind);
      setDraftEdge(null);
    }
    if (marquee) {
      const [x0, x1] = [Math.min(marquee.x0, marquee.x1), Math.max(marquee.x0, marquee.x1)];
      const [y0, y1] = [Math.min(marquee.y0, marquee.y1), Math.max(marquee.y0, marquee.y1)];
      const inside = nodes.filter((node) => node.x >= x0 && node.y >= y0 && node.x + node.w <= x1 && node.y + node.h <= y1).map((node) => node.id);
      setSelected({ nodes: new Set([...selected.nodes, ...inside]), edges: selected.edges });
      setMarquee(null);
    }
    if (resizing && resizeOverride) {
      const { id, w, h } = resizeOverride;
      void attempt(() => updateWorkItem(projectId, 'diagramNodes', id, { w, h }), pick(locale, 'ปรับขนาดไม่สำเร็จ', 'Resize failed')).then(() => setResizeOverride(null));
    }
    if (resizing) setResizing(null);
    canvas.handlePointerUp(event);
  };

  /* ---------- export ---------- */

  const exportSvg = (): string | null => {
    const svg = svgRef.current;
    if (!svg || !nodes.length) return null;
    const boxes = nodes.map(boxOf);
    const minX = Math.min(...boxes.map((b) => b.x)) - 40;
    const minY = Math.min(...boxes.map((b) => b.y)) - 40;
    const width = Math.max(...boxes.map((b) => b.x + b.w)) + 40 - minX;
    const height = Math.max(...boxes.map((b) => b.y + b.h)) + 60 - minY;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.querySelectorAll('[data-export-skip]').forEach((element) => element.remove());
    clone.querySelector('[data-world]')?.setAttribute('transform', '');
    clone.setAttribute('viewBox', `${minX} ${minY} ${width} ${height}`);
    clone.setAttribute('width', String(width));
    clone.setAttribute('height', String(height));
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.querySelectorAll('[data-node-id]').forEach((element) => element.classList.remove('selected'));
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = EXPORT_CSS;
    clone.insertBefore(style, clone.firstChild);
    const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    Object.entries({ x: minX, y: minY, width, height, fill: '#ffffff' }).forEach(([key, value]) => background.setAttribute(key, String(value)));
    clone.insertBefore(background, style.nextSibling);
    return new XMLSerializer().serializeToString(clone);
  };
  const download = (href: string, name: string) => { const link = document.createElement('a'); link.href = href; link.download = name; link.click(); };
  const exportAs = (format: 'svg' | 'png') => {
    const markup = exportSvg();
    if (!markup) { toast(pick(locale, 'ไดอะแกรมว่าง', 'Diagram is empty')); return; }
    const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
    const name = diagram.title.replace(/[^\w฀-๿-]+/g, '_') || 'diagram';
    if (format === 'svg') { download(url, `${name}.svg`); setTimeout(() => URL.revokeObjectURL(url), 1000); return; }
    const image = new Image();
    image.onload = () => {
      const scale = 2;
      const output = document.createElement('canvas');
      output.width = image.width * scale; output.height = image.height * scale;
      const ctx = output.getContext('2d')!;
      ctx.scale(scale, scale); ctx.drawImage(image, 0, 0);
      download(output.toDataURL('image/png'), `${name}.png`);
      URL.revokeObjectURL(url);
    };
    image.src = url;
  };

  /* ---------- render ---------- */

  const kinds = useMemo(() => new Map(nodes.filter((node) => node.kind === 'usecase').map((node) => [node.id, classifyUseCase(node.id, edges)])), [nodes, edges]);
  const ordered = [...nodes].sort((a, b) => (a.kind === 'boundary' ? 0 : 1) - (b.kind === 'boundary' ? 0 : 1));
  const singleNode = selected.nodes.size === 1 && !selected.edges.size ? nodeById.get([...selected.nodes][0]) : undefined;
  const singleEdge = selected.edges.size === 1 && !selected.nodes.size ? edges.find((edge) => edge.id === [...selected.edges][0]) : undefined;
  const placedUseCaseIds = new Set(nodes.map((node) => node.useCaseId).filter(Boolean));
  const unplaced = useCases.filter((item) => !placedUseCaseIds.has(item.id)).sort((a, b) => a.code.localeCompare(b.code));
  const editingNode = editingLabel ? nodeById.get(editingLabel.id) : undefined;

  return <div className="diagram-shell">
    <div className="diagram-toolbar" role="toolbar">
      {!readOnly && <><button className={tool === 'select' ? 'active' : ''} onClick={() => setTool('select')} title={`${pick(locale, 'เลือก/ย้าย', 'Select / move')} (V)`}>➤</button>
      <span className="divider" />
      {NODE_TOOLS.map((item) => <button key={item.id} className={tool === item.id ? 'active' : ''} onClick={() => setTool(item.id)} title={`${locale === 'th' ? item.th : item.en} (${{ actor: 'A', usecase: 'U', boundary: 'B', note: 'N' }[item.id]})`}><span className="tool-icon">{item.icon}</span><small>{locale === 'th' ? item.th : item.en}</small></button>)}
      <span className="divider" />
      {EDGE_TOOLS.map((item) => <button key={item.id} className={`edge-tool ${tool === item.id ? 'active' : ''}`} onClick={() => setTool(item.id)} title={`${locale === 'th' ? item.th : item.en} (${{ association: 'L', include: 'I', extend: 'E', generalization: 'G' }[item.id]})`}><span className="tool-icon">{item.icon}</span><small>{locale === 'th' ? item.th : item.en}</small></button>)}</>}
      <span className="spacer" />
      {!readOnly && <label className="mini-toggle"><input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} /> {pick(locale, 'จัดตามกริด', 'Snap')}</label>}
      <label className="mini-toggle"><input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} /> {pick(locale, 'ของฉัน', 'Mine')}</label>
      <button onClick={() => exportAs('png')} title="Export PNG">PNG</button>
      <button onClick={() => exportAs('svg')} title="Export SVG">SVG</button>
    </div>
    <div className="diagram-body">
      <div ref={canvas.containerRef} className={`infinite-canvas diagram-canvas tool-${tool} ${canvas.panning ? 'panning' : ''}`} style={canvas.gridStyle}
        onPointerDown={(event) => { if ((event.target as Element).closest('[data-node-id], [data-edge-id], input, button, .canvas-controls')) return; onBackgroundDown(event); }}
        onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        onDoubleClick={(event) => { if (!readOnly && !(event.target as Element).closest('[data-node-id], [data-edge-id], input, button, .canvas-controls') && tool === 'select') { const world = canvas.toWorld(event.clientX, event.clientY); void placeNode('usecase', world.x, world.y); } }}>
        <svg ref={svgRef} className="diagram-svg">
          <defs>
            <marker id="arrow-open" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="12" markerHeight="12" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M1 1 L11 6 L1 11" fill="none" stroke="currentColor" strokeWidth="1.6" /></marker>
            <marker id="arrow-hollow" viewBox="0 0 16 16" refX="15" refY="8" markerWidth="16" markerHeight="16" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M1 1 L15 8 L1 15 Z" fill="var(--d-surface, #fff)" stroke="currentColor" strokeWidth="1.6" /></marker>
          </defs>
          <g data-world transform={`translate(${canvas.view.x} ${canvas.view.y}) scale(${canvas.view.zoom})`}>
            {ordered.filter((node) => node.kind === 'boundary').map((node) => <NodeShape key={node.id} node={node} box={boxOf(node)} label={labelOf(node)} selected={selected.nodes.has(node.id)} onDown={onNodeDown} onDoubleClick={() => { if (!readOnly) setEditingLabel({ id: node.id, value: labelOf(node) }); }} />)}
            {edges.map((edge) => {
              const from = nodeById.get(edge.from); const to = nodeById.get(edge.to);
              if (!from || !to) return null;
              const a = boxOf(from); const b = boxOf(to);
              const start = clipToShape(a, from.kind, b.x + b.w / 2, b.y + b.h / 2);
              const end = clipToShape(b, to.kind, a.x + a.w / 2, a.y + a.h / 2);
              const isSelected = selected.edges.has(edge.id);
              const dashed = edge.kind === 'include' || edge.kind === 'extend';
              const marker = edge.kind === 'generalization' ? 'url(#arrow-hollow)' : dashed ? 'url(#arrow-open)' : undefined;
              return <g key={edge.id} data-edge-id={edge.id} className={`diagram-edge ${edge.kind} ${isSelected ? 'selected' : ''}`} onPointerDown={(event) => { event.stopPropagation(); if (canvas.handlePointerDown(event, false)) return; setSelected(event.shiftKey ? { nodes: selected.nodes, edges: new Set([...selected.edges, edge.id]) } : { nodes: new Set(), edges: new Set([edge.id]) }); }}>
                <line className="edge-hit" x1={start.x} y1={start.y} x2={end.x} y2={end.y} />
                <line className="edge-line" x1={start.x} y1={start.y} x2={end.x} y2={end.y} strokeDasharray={dashed ? '7 5' : undefined} markerEnd={marker} />
                {dashed && <text className="edge-label" x={(start.x + end.x) / 2} y={(start.y + end.y) / 2 - 6} textAnchor="middle">«{edge.kind}»</text>}
              </g>;
            })}
            {ordered.filter((node) => node.kind !== 'boundary').map((node) => {
              const useCase = node.kind === 'usecase' ? useCaseById.get(node.useCaseId) : undefined;
              const assignee = useCase ? members.find((member) => member.userId === useCase.assigneeId) : undefined;
              const dim = mineOnly && node.kind === 'usecase' && useCase?.assigneeId !== user.uid;
              return <NodeShape key={node.id} node={node} box={boxOf(node)} label={labelOf(node)} selected={selected.nodes.has(node.id)} dim={dim}
                useCase={useCase} kind={kinds.get(node.id)} assignee={assignee} locale={locale}
                onDown={onNodeDown} onDoubleClick={() => { if (!readOnly) setEditingLabel({ id: node.id, value: labelOf(node) }); }} />;
            })}
            {!readOnly && tool === 'select' && [...selected.nodes].map((id) => nodeById.get(id)).filter((node): node is DiagramNode => !!node).map((node) => {
              const box = boxOf(node);
              return <g key={`h-${node.id}`} data-export-skip>
                {node.kind !== 'boundary' && node.kind !== 'note' && <circle className="connect-handle" cx={box.x + box.w + 12} cy={box.y + box.h / 2} r={7} onPointerDown={(event) => onHandleDown(event, node)}><title>{pick(locale, 'ลากเพื่อเชื่อม', 'Drag to connect')}</title></circle>}
                {node.kind !== 'actor' && <rect className="resize-handle" x={box.x + box.w - 5} y={box.y + box.h - 5} width={10} height={10} onPointerDown={(event) => onResizeDown(event, node)} />}
              </g>;
            })}
            {draftEdge && (() => { const from = nodeById.get(draftEdge.from); if (!from) return null; const box = boxOf(from); return <line data-export-skip className="draft-edge" x1={box.x + box.w / 2} y1={box.y + box.h / 2} x2={draftEdge.x} y2={draftEdge.y} />; })()}
            {marquee && <rect data-export-skip className="marquee" x={Math.min(marquee.x0, marquee.x1)} y={Math.min(marquee.y0, marquee.y1)} width={Math.abs(marquee.x1 - marquee.x0)} height={Math.abs(marquee.y1 - marquee.y0)} />}
          </g>
        </svg>
        {!readOnly && editingNode && editingLabel && (() => {
          const box = boxOf(editingNode);
          const top = editingNode.kind === 'actor' ? box.y + box.h - 18 : editingNode.kind === 'boundary' ? box.y + 4 : box.y + box.h / 2 - 16;
          return <input className="label-editor" autoFocus value={editingLabel.value} maxLength={120}
            style={{ left: canvas.view.x + box.x * canvas.view.zoom, top: canvas.view.y + top * canvas.view.zoom, width: Math.max(140, box.w * canvas.view.zoom) }}
            onChange={(e) => setEditingLabel({ ...editingLabel, value: e.target.value })} onBlur={commitLabel}
            onKeyDown={(e) => { if (e.key === 'Enter') commitLabel(); if (e.key === 'Escape') setEditingLabel(null); }} onFocus={(e) => e.target.select()} />;
        })()}
        {!nodes.length && <div className="canvas-empty"><div className="diagram-empty"><strong>{pick(locale, 'เริ่มวาด Use Case Diagram', 'Start your use case diagram')}</strong><span>{pick(locale, '1. เลือก 웃 Actor แล้วคลิกบนผืนผ้าใบ  2. เลือก ⬭ Use Case แล้วคลิก  3. เลือก — Association แล้วลากจาก Actor ไปยัง Use Case', '1. Pick 웃 Actor and click the canvas  2. Pick ⬭ Use case and click  3. Pick — Association and drag from actor to use case')}</span></div></div>}
        <div className="canvas-hint">{readOnly ? pick(locale, 'ลากที่ว่างเพื่อเลื่อน · Ctrl/⌘ + scroll เพื่อซูม · คลิกรูปเพื่อดูรายละเอียด', 'Drag empty space to pan · Ctrl/⌘ + scroll to zoom · click a shape for details') : tool === 'select' ? pick(locale, 'ลากที่ว่าง = เลื่อน · Shift+ลาก = เลือกหลายชิ้น · ดับเบิลคลิก = เพิ่ม Use Case/แก้ชื่อ · Delete = ลบ', 'Drag empty = pan · Shift+drag = multi-select · double-click = add use case / rename · Delete = remove')
          : EDGE_TOOLS.some((item) => item.id === tool) ? pick(locale, 'ลากจากรูปหนึ่งไปอีกรูปเพื่อเชื่อม · Esc = ยกเลิก', 'Drag from one shape to another to connect · Esc = cancel')
            : pick(locale, 'คลิกบนผืนผ้าใบเพื่อวาง · Esc = ยกเลิก', 'Click the canvas to place · Esc = cancel')}</div>
        <CanvasControls zoom={canvas.view.zoom} onZoomIn={() => canvas.zoomBy(1.2)} onZoomOut={() => canvas.zoomBy(1 / 1.2)} onReset={canvas.reset} onFit={() => canvas.fit(nodes.map(boxOf))} fitLabel={pick(locale, 'แสดงทั้งหมด', 'Fit all')} />
        <button type="button" className="mobile-inspector-button" onClick={() => setInspectorOpen(true)}>{singleNode || singleEdge ? pick(locale, 'แก้ไขรายละเอียด', 'Edit details') : pick(locale, 'รายละเอียด', 'Inspector')}</button>
      </div>
      {inspectorOpen && <button type="button" className="diagram-inspector-scrim" onClick={() => setInspectorOpen(false)} aria-label={pick(locale, 'ปิด', 'Close')} />}
      <aside className={`diagram-inspector ${inspectorOpen ? 'open' : ''}`}>
        <div className="mobile-inspector-head"><div className="mobile-sheet-handle" /><strong>{pick(locale, 'รายละเอียด', 'Inspector')}</strong><button type="button" onClick={() => setInspectorOpen(false)} aria-label={pick(locale, 'ปิด', 'Close')}>×</button></div>
        {singleNode ? <NodeInspector node={singleNode} label={labelOf(singleNode)} useCase={useCaseById.get(singleNode.useCaseId)} kind={kinds.get(singleNode.id)} nodes={nodes} edges={edges} members={members} context={context} role={role} projectId={projectId} readOnly={readOnly} onRename={() => setEditingLabel({ id: singleNode.id, value: labelOf(singleNode) })} onDelete={deleteSelection} />
          : singleEdge ? <EdgeInspector edge={singleEdge} nodeById={nodeById} labelOf={labelOf} locale={locale} projectId={projectId} readOnly={readOnly} onDelete={deleteSelection} />
            : selected.nodes.size + selected.edges.size > 1 ? <div className="inspector-section"><h3>{selected.nodes.size + selected.edges.size} {pick(locale, 'รายการที่เลือก', 'items selected')}</h3>{!readOnly && <><p className="muted">{pick(locale, 'ลากเพื่อย้ายพร้อมกัน หรือกด Delete', 'Drag to move together, or press Delete')}</p><button className="danger ghost" onClick={deleteSelection}>{pick(locale, 'ลบที่เลือก', 'Delete selected')}</button></>}</div>
              : <div className="inspector-section">
                <h3>{pick(locale, 'Use Case ที่ยังไม่อยู่บนไดอะแกรม', 'Use cases not on this diagram')}</h3>
                <p className="muted">{pick(locale, 'คลิกเพื่อวางไว้กลางจอ', 'Click to place at the centre of the view')}</p>
                {!readOnly && <div className="unplaced-list">{unplaced.map((item) => <button key={item.id} onClick={() => { const center = canvas.center(); void placeNode('usecase', center.x, center.y, item); }}><b>{item.code}</b>{item.title}</button>)}{!unplaced.length && <p className="muted">{pick(locale, 'วางครบทุก Use Case แล้ว', 'All use cases are placed')}</p>}</div>}
                <h3>{pick(locale, 'สัญลักษณ์', 'Legend')}</h3>
                <ul className="legend">
                  <li><i className="kind-dot base" /> <b>Base</b> — {pick(locale, 'Use Case หลักที่ Actor ใช้งาน', 'main goal an actor performs')}</li>
                  <li><i className="kind-dot common" /> <b>Common</b> — {pick(locale, 'ถูก «include» โดย Use Case อื่น (ใช้ร่วมกัน)', 'reused via «include»')}</li>
                  <li><i className="kind-dot extension" /> <b>Extension</b> — {pick(locale, '«extend» เพิ่มพฤติกรรมเสริมให้ Base', 'adds optional behaviour via «extend»')}</li>
                </ul>
              </div>}
      </aside>
    </div>
  </div>;
}

/* ---------- shapes ---------- */

function wrapText(text: string, maxChars: number, maxLines = 3): string[] {
  const words = text.split(/(\s+)/).filter((part) => part.trim());
  const lines: string[] = [];
  let line = '';
  const push = (value: string) => { if (value) lines.push(value); };
  for (const word of words.length ? words : [text]) {
    if (word.length > maxChars) { push(line); line = ''; for (let i = 0; i < word.length; i += maxChars) { const chunk = word.slice(i, i + maxChars); if (chunk.length === maxChars) push(chunk); else line = chunk; } continue; }
    if ((line ? `${line} ${word}` : word).length > maxChars) { push(line); line = word; } else line = line ? `${line} ${word}` : word;
  }
  push(line);
  if (lines.length > maxLines) { const kept = lines.slice(0, maxLines); kept[maxLines - 1] = `${kept[maxLines - 1].slice(0, Math.max(0, maxChars - 1))}…`; return kept; }
  return lines;
}

function MultilineText({ lines, x, y, lineHeight = 15, className }: { lines: string[]; x: number; y: number; lineHeight?: number; className?: string }) {
  const startY = y - ((lines.length - 1) * lineHeight) / 2;
  return <text className={className} x={x} y={startY} textAnchor="middle" dominantBaseline="middle">{lines.map((line, index) => <tspan key={index} x={x} y={startY + index * lineHeight}>{line}</tspan>)}</text>;
}

function NodeShape({ node, box, label, selected, dim, useCase, kind, assignee, locale, onDown, onDoubleClick }: {
  node: DiagramNode; box: { x: number; y: number; w: number; h: number }; label: string; selected: boolean; dim?: boolean;
  useCase?: ProjectUseCase; kind?: UseCaseKind; assignee?: Membership; locale?: string;
  onDown: (event: ReactPointerEvent, node: DiagramNode) => void; onDoubleClick: () => void;
}) {
  const { x, y, w, h } = box;
  const common = { 'data-node-id': node.id, className: `diagram-node ${node.kind} ${selected ? 'selected' : ''} ${dim ? 'dim' : ''}`, onPointerDown: (event: ReactPointerEvent) => onDown(event, node), onDoubleClick: (event: React.MouseEvent) => { event.stopPropagation(); onDoubleClick(); } };
  if (node.kind === 'boundary') return <g {...common}>
    <rect className="boundary-rect" x={x} y={y} width={w} height={h} rx={6} />
    <rect className="boundary-grab" x={x} y={y} width={w} height={30} rx={6} />
    <text className="boundary-title" x={x + 14} y={y + 20}>{label}</text>
  </g>;
  if (node.kind === 'actor') {
    const cx = x + w / 2; const top = y + 4; const figure = h - 26;
    const head = figure * 0.16;
    return <g {...common}>
      <rect className="hit-area" x={x} y={y} width={w} height={h} />
      <circle className="actor-line" cx={cx} cy={top + head} r={head} />
      <line className="actor-line" x1={cx} y1={top + head * 2} x2={cx} y2={top + figure * 0.62} />
      <line className="actor-line" x1={cx - w * 0.38} y1={top + figure * 0.4} x2={cx + w * 0.38} y2={top + figure * 0.4} />
      <line className="actor-line" x1={cx} y1={top + figure * 0.62} x2={cx - w * 0.32} y2={top + figure} />
      <line className="actor-line" x1={cx} y1={top + figure * 0.62} x2={cx + w * 0.32} y2={top + figure} />
      <MultilineText className="node-label actor-label" lines={wrapText(label, 16, 2)} x={cx} y={y + h - 8} lineHeight={13} />
    </g>;
  }
  if (node.kind === 'note') return <g {...common}>
    <path className="note-shape" d={`M${x} ${y} H${x + w - 16} L${x + w} ${y + 16} V${y + h} H${x} Z`} />
    <path className="note-fold" d={`M${x + w - 16} ${y} V${y + 16} H${x + w}`} />
    <MultilineText className="node-label note-label" lines={wrapText(label, Math.max(8, Math.floor(w / 8)), Math.max(1, Math.floor((h - 12) / 15)))} x={x + w / 2} y={y + h / 2} />
  </g>;
  const status = useCase?.status || 'open';
  const initials = assignee?.displayName.slice(0, 1).toUpperCase() || '';
  const clipId = `clip-${node.id}`;
  return <g {...common}>
    <ellipse className={`usecase-shape kind-${kind || 'base'}`} cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} style={{ '--status': USECASE_STATUS_COLORS[status] } as React.CSSProperties} />
    {useCase && <text className="usecase-code" x={x + w / 2} y={y + 15} textAnchor="middle">{useCase.code} · {KIND_LABEL[kind || 'base'][locale === 'th' ? 'th' : 'en']}</text>}
    <MultilineText className="node-label" lines={wrapText(label, Math.max(10, Math.floor(w / 8.2)), 2)} x={x + w / 2} y={y + h / 2 + 4} />
    {!useCase && node.useCaseId && <text className="usecase-code unlinked" x={x + w / 2} y={y + h - 8} textAnchor="middle">unlinked</text>}
    {assignee && <g className="assignee-badge" transform={`translate(${x + w - 16} ${y + h - 14})`}>
      <title>{assignee.displayName}</title>
      <clipPath id={clipId}><circle r={11} /></clipPath>
      <circle r={12} className="assignee-ring" />
      {assignee.photoURL ? <image href={assignee.photoURL} x={-11} y={-11} width={22} height={22} clipPath={`url(#${clipId})`} preserveAspectRatio="xMidYMid slice" crossOrigin="anonymous" /> : <><circle r={11} className="assignee-fallback" /><text textAnchor="middle" dominantBaseline="central" className="assignee-initial">{initials}</text></>}
    </g>}
  </g>;
}

/* ---------- inspectors ---------- */

function NodeInspector({ node, label, useCase, kind, nodes, edges, members, context, role, projectId, readOnly, onRename, onDelete }: {
  node: DiagramNode; label: string; useCase?: ProjectUseCase; kind?: UseCaseKind; nodes: DiagramNode[]; edges: DiagramEdge[]; members: Membership[];
  context: AppContextValue; role: Role | null; projectId: string; readOnly: boolean; onRename: () => void; onDelete: () => void;
}) {
  const { locale, user } = context;
  const [details, setDetails] = useState(useCase?.details || '');
  const [rules, setRules] = useState(useCase?.businessRules.join(', ') || '');
  useEffect(() => { setDetails(useCase?.details || ''); setRules(useCase?.businessRules.join(', ') || ''); }, [useCase?.id, useCase?.details, useCase?.businessRules]);
  const save = (values: Partial<ProjectUseCase>, activity?: { type: string; th: string; en: string }) => useCase && void attempt(() => updateWorkItem(projectId, 'useCases', useCase.id, values, activity ? user : undefined, activity), pick(locale, 'บันทึกไม่สำเร็จ', 'Save failed'));
  const related = edges.filter((edge) => edge.from === node.id || edge.to === node.id).map((edge) => {
    const otherId = edge.from === node.id ? edge.to : edge.from;
    const other = nodes.find((item) => item.id === otherId);
    return { edge, other, outgoing: edge.from === node.id };
  });
  const assignee = useCase ? members.find((member) => member.userId === useCase.assigneeId) : undefined;
  const kindName = { actor: 'Actor', usecase: 'Use case', boundary: pick(locale, 'ขอบเขตระบบ', 'System boundary'), note: pick(locale, 'โน้ต', 'Note') }[node.kind];

  return <div className="inspector-section">
    <div className="inspector-head"><span className="eyebrow">{kindName}</span>{kind && <span className={`kind-badge ${kind}`}>{KIND_LABEL[kind][locale === 'th' ? 'th' : 'en']}</span>}</div>
    <h3 className="inspector-title">{useCase && <b>{useCase.code}</b>} {label} {!readOnly && <button className="icon-button" onClick={onRename} title={pick(locale, 'เปลี่ยนชื่อ', 'Rename')}>✎</button>}</h3>
    {useCase && <>
      <label className="inspector-field">{pick(locale, 'ผู้รับผิดชอบ', 'Assigned to')}
        <div className="assignee-picker">{assignee ? <Avatar name={assignee.displayName} src={assignee.photoURL} size="sm" /> : <span className="avatar fallback sm empty-avatar">?</span>}
          {!readOnly ? <select value={useCase.assigneeId} onChange={(e) => save({ assigneeId: e.target.value, status: e.target.value ? (useCase.status === 'completed' ? 'completed' : 'assigned') : 'open' }, { type: 'usecase_assigned', th: `เปลี่ยนผู้รับผิดชอบ ${useCase.code}`, en: `changed assignee for ${useCase.code}` })}>
            <option value="">{pick(locale, 'ยังไม่มอบหมาย', 'Unassigned')}</option>{members.map((member) => <option key={member.id} value={member.userId}>{member.displayName}</option>)}
          </select> : <span>{assignee?.displayName || pick(locale, 'ยังไม่มอบหมาย', 'Unassigned')}</span>}</div>
      </label>
      {!readOnly && !useCase.assigneeId && <button type="button" className="link-button" onClick={() => save({ assigneeId: user.uid, status: 'assigned' }, { type: 'usecase_assigned', th: `รับผิดชอบ ${useCase.code}`, en: `took ${useCase.code}` })}>✋ {pick(locale, 'รับผิดชอบเอง', 'Assign to me')}</button>}
      <label className="inspector-field">{pick(locale, 'สถานะ', 'Status')}
        <select value={useCase.status} disabled={readOnly} onChange={(e) => save({ status: e.target.value as ProjectUseCase['status'] })}><option value="open">Open</option><option value="assigned">Assigned</option><option value="completed">Completed</option></select>
      </label>
      <label className="inspector-field">Actor<input value={useCase.actor} readOnly title={pick(locale, 'ซิงก์จาก association บนไดอะแกรม', 'Synced from diagram associations')} placeholder="—" /></label>
      <label className="inspector-field">{pick(locale, 'รายละเอียด', 'Details')}<textarea rows={3} value={details} disabled={readOnly} onChange={(e) => setDetails(e.target.value)} onBlur={() => details !== useCase.details && save({ details })} /></label>
      <label className="inspector-field">Business rules<input value={rules} disabled={readOnly} placeholder="BR-01, BR-02" onChange={(e) => setRules(e.target.value)} onBlur={() => { const next = rules.split(',').map((rule) => rule.trim()).filter(Boolean); if (next.join(',') !== useCase.businessRules.join(',')) save({ businessRules: next }); }} /></label>
    </>}
    {related.length > 0 && <div className="relation-list"><small>{pick(locale, 'ความสัมพันธ์', 'Relationships')}</small>{related.map(({ edge, other, outgoing }) => <span key={edge.id}>{outgoing ? '→' : '←'} <em>{edge.kind === 'association' ? '—' : edge.kind === 'generalization' ? '▷' : `«${edge.kind}»`}</em> {other?.label || '?'}</span>)}</div>}
    {!readOnly && <button className="danger ghost small" onClick={onDelete}>{pick(locale, 'ลบออกจากไดอะแกรม', 'Remove from diagram')}</button>}
    {useCase && <p className="muted tiny">{pick(locale, 'การลบรูปไม่ลบ Use Case ในรายการ', 'Removing the shape keeps the use case in the list')}</p>}
    {useCase && <CommentThread projectId={projectId} targetType="useCase" targetId={useCase.id} context={context} role={role} compact readOnly={readOnly} />}
  </div>;
}

function EdgeInspector({ edge, nodeById, labelOf, locale, projectId, readOnly, onDelete }: { edge: DiagramEdge; nodeById: Map<string, DiagramNode>; labelOf: (node: DiagramNode) => string; locale: string; projectId: string; readOnly: boolean; onDelete: () => void }) {
  const from = nodeById.get(edge.from); const to = nodeById.get(edge.to);
  if (!from || !to) return null;
  const change = (kind: DiagramEdgeKind) => void attempt(() => updateWorkItem(projectId, 'diagramEdges', edge.id, { kind }), pick(locale, 'อัปเดตไม่สำเร็จ', 'Update failed'));
  const reverse = () => void attempt(() => updateWorkItem(projectId, 'diagramEdges', edge.id, { from: edge.to, to: edge.from }), pick(locale, 'อัปเดตไม่สำเร็จ', 'Update failed'));
  return <div className="inspector-section">
    <span className="eyebrow">{pick(locale, 'ความสัมพันธ์', 'Relationship')}</span>
    <h3 className="inspector-title">{labelOf(from)} → {labelOf(to)}</h3>
    <div className="edge-kinds">{EDGE_TOOLS.map((item) => <button key={item.id} className={edge.kind === item.id ? 'active' : ''} disabled={readOnly || !validEdge(from.kind, to.kind, item.id)} onClick={() => change(item.id)}>{item.icon} {item.en}</button>)}</div>
    <p className="muted tiny">{edge.kind === 'include' ? pick(locale, '«include»: Base เรียกใช้ Use Case ปลายทางทุกครั้ง', '«include»: the base always runs the target use case') : edge.kind === 'extend' ? pick(locale, '«extend»: ต้นทางเพิ่มพฤติกรรมเสริมให้ Base ปลายทางตามเงื่อนไข', '«extend»: the source optionally extends the target base') : edge.kind === 'generalization' ? pick(locale, 'Generalization: ต้นทางเป็นชนิดย่อยของปลายทาง', 'Generalization: the source specialises the target') : pick(locale, 'Association: Actor มีส่วนร่วมกับ Use Case', 'Association: the actor takes part in the use case')}</p>
    {!readOnly && <div className="action-row"><button className="secondary small" onClick={reverse}>⇄ {pick(locale, 'สลับทิศทาง', 'Reverse')}</button><button className="danger ghost small" onClick={onDelete}>{pick(locale, 'ลบ', 'Delete')}</button></div>}
  </div>;
}

/** Inline styles for exported SVG/PNG files (the app stylesheet isn't available there). */
const EXPORT_CSS = `
text{font-family:Inter,'Noto Sans Thai',system-ui,sans-serif;fill:#1e293b}
.boundary-rect{fill:#f8fafc;stroke:#64748b;stroke-width:1.5}.boundary-grab{fill:transparent}.boundary-title{font-weight:700;font-size:14px}
.actor-line{fill:none;stroke:#1e293b;stroke-width:2}.hit-area{fill:transparent}
.usecase-shape{fill:#fff;stroke:#1e293b;stroke-width:1.6}.usecase-shape.kind-common{fill:#eef2ff}.usecase-shape.kind-extension{fill:#fdf4ff}
.usecase-code{font-size:9px;font-weight:700;fill:#6366f1}.node-label{font-size:12.5px;font-weight:600}.actor-label{font-size:12px}
.note-shape{fill:#fef9c3;stroke:#ca8a04}.note-fold{fill:none;stroke:#ca8a04}.note-label{font-size:12px;font-weight:500}
.edge-hit{stroke:transparent}.edge-line{stroke:#334155;stroke-width:1.6}.edge-label{font-size:11px;fill:#475569;font-style:italic}
.diagram-edge{color:#334155}.assignee-ring{fill:#fff;stroke:#6366f1;stroke-width:1.5}.assignee-fallback{fill:#6366f1}.assignee-initial{fill:#fff;font-size:10px;font-weight:700}
`;
