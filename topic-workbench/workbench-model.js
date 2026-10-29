/** Optional workbench views over schema-v2 project facts. No storage or remote writes. */
const resolvedOutcomes = new Set(['已解决', '已交付', '已完成']);
const stoppedOutcomes = new Set(['已结束未解决', '停止推进', '不再推进', '暂停终止']);
const toneColors = {sand: '#e7e4db', blue: '#e0e4e6', green: '#e5e5de'};
const clone = value => JSON.parse(JSON.stringify(value));
const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

export function outcomeKind(project) {
  if (project?.closed === false) return 'open';
  const outcome = typeof project?.outcome === 'string' ? project.outcome.trim() : '';
  return resolvedOutcomes.has(outcome) ? 'resolved' : stoppedOutcomes.has(outcome) ? 'stopped' : project?.closed === true ? 'ended' : 'open';
}

/** Explicit completion wins; old archives retain legacy outcome interpretation until migration. */
export function isClosedProject(project) {
  return outcomeKind(project) !== 'open';
}

/**
 * Clone and enrich old v2 records. Boards are created only by the user.
 * Existing boards, including an empty array, are never replaced with presets.
 */
export function enrichWorkbench(input) {
  const data = clone(input);
  if (data.schemaVersion !== 2 || !Array.isArray(data.projects) || !Array.isArray(data.tags) || !Array.isArray(data.frames)) {
    throw Error('工作台迁移需要有效的 schemaVersion 2 数据');
  }
  if (data.workbenchVersion !== undefined && data.workbenchVersion !== 1) throw Error('不支持此 workbenchVersion');
  if (!has(data, 'quickBoards')) data.quickBoards = [];
  if (!Array.isArray(data.quickBoards)) throw Error('quickBoards 必须是数组');
  const knownIds = new Set(data.projects.map(project => project.id));
  for (const board of data.quickBoards) {
    if (!board || !Array.isArray(board.projectIds) || !Array.isArray(board.emphasisIds)) throw Error('行动看板缺少项目引用数组');
    board.projectIds = board.projectIds.filter(id => knownIds.has(id));
    const members = new Set(board.projectIds);
    board.emphasisIds = board.emphasisIds.filter(id => knownIds.has(id) && members.has(id));
    if (!has(board, 'contexts')) board.contexts = {};
    if (!board.contexts || typeof board.contexts !== 'object' || Array.isArray(board.contexts)) throw Error('行动看板 contexts 必须是对象');
    board.contexts = Object.fromEntries(Object.entries(board.contexts).filter(([id]) => members.has(id)));
  }
  data.tags.forEach((tag, index) => { if (!has(tag, 'rank')) tag.rank = index; });
  data.frames.forEach(frame => { if (!has(frame, 'color')) frame.color = toneColors[frame.tone] || '#e5e5de'; });
  data.workbenchVersion = 1;
  return data;
}

/** Import a frame's placement references without copying or changing project facts. */
export function boardFromFrame(data, frameId, {id, rank = 0, color} = {}) {
  const frame = data.frames.find(frame => frame.id === frameId);
  if (!frame) throw Error('分组已不存在，请重新选择');
  if (typeof id !== 'string' || !id.trim()) throw Error('新看板缺少 ID');
  const projects = new Set(data.projects.map(project => project.id));
  const instances = new Map(data.instances.map(instance => [instance.id, instance]));
  const projectIds = [], emphasisIds = [], notes = new Map();
  for (const placementId of frame.members) {
    const placement = instances.get(placementId);
    if (!placement || !projects.has(placement.pid)) continue;
    const pid = placement.pid;
    if (!projectIds.includes(pid)) projectIds.push(pid);
    if (placement.focus && !emphasisIds.includes(pid)) emphasisIds.push(pid);
    if (typeof placement.context === 'string' && placement.context.trim()) {
      if (!notes.has(pid)) notes.set(pid, new Set());
      notes.get(pid).add(placement.context.trim());
    }
  }
  return {id, name:frame.name, color:color || frame.backgroundColor || frame.color || '#74736c', rank,
    projectIds, emphasisIds, contexts:Object.fromEntries([...notes].map(([pid, values]) => [pid, [...values].join('\n\n')])), notes:''};
}

/** Project priority stays the only priority. Unknown values retain their input order. */
export function sortProjectsByPriority(list) {
  const priorities = new Map([['P0', 0], ['P1', 1], ['P2', 2]]);
  const rank = project => priorities.get(typeof project?.priority === 'string' ? project.priority.trim() : '') ?? 3;
  return list.map((project, index) => ({project, index})).sort((a, b) => rank(a.project) - rank(b.project) || a.index - b.index).map(row => row.project);
}

/**
 * Unique reachable descendants, in breadth-first relation order. Each row keeps
 * its own outcome and all reachable inbound association notes/draft flags. A
 * child's outcome never closes its parent or claims the whole parent is solved.
 * Returns [{project, depth, parentIds, relations, outcomeKind, closed}].
 */
export function collectDirectionResults(pid, data) {
  const projects = new Map(data.projects.map(project => [project.id, project]));
  if (!projects.has(pid)) return [];
  const children = new Map();
  for (const relation of data.relations || []) {
    if (!projects.has(relation.main) || !projects.has(relation.child)) continue;
    if (!children.has(relation.main)) children.set(relation.main, []);
    children.get(relation.main).push(relation);
  }
  const queue = [pid], depth = new Map([[pid, 0]]), rows = new Map();
  for (let head = 0; head < queue.length; head += 1) {
    const parent = queue[head];
    for (const relation of children.get(parent) || []) {
      if (relation.child === pid) continue;
      if (!rows.has(relation.child)) {
        const project = clone(projects.get(relation.child));
        const kind = outcomeKind(project);
        rows.set(relation.child, {project, depth: depth.get(parent) + 1, parentIds: [], relations: [], outcomeKind: kind, closed: kind !== 'open'});
      }
      const row = rows.get(relation.child);
      if (!row.parentIds.includes(parent)) row.parentIds.push(parent);
      row.relations.push(clone(relation));
      if (!depth.has(relation.child)) {
        depth.set(relation.child, depth.get(parent) + 1);
        queue.push(relation.child);
      }
    }
  }
  return [...rows.values()];
}
