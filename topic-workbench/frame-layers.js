/** Frames remain a background-only stack; later array entries are drawn above earlier ones. */
export function moveFramesToEdge(frames, ids, edge = 'front') {
  if (!Array.isArray(frames)) throw new TypeError('分组列表必须为数组');
  if (edge !== 'front' && edge !== 'back') throw new TypeError('分组层级位置无效');
  const selected = new Set(typeof ids === 'string' ? [ids] : (ids || []));
  const moving = frames.filter(frame => selected.has(frame.id));
  const remaining = frames.filter(frame => !selected.has(frame.id));
  return edge === 'front' ? [...remaining, ...moving] : [...moving, ...remaining];
}
