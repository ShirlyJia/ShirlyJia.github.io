/** Evidence-only review helpers. Results are prompts to check, never conflict/duplicate verdicts. */
const copy = value => JSON.parse(JSON.stringify(value));
const label = value => typeof value === 'string' ? value : '';
const unresolvedOwners = new Set(['待定', '待确认', '未指定', '未分配', '暂无', '-', '--', 'tbd', 'unknown', 'unassigned', 'needs supplement']);

function calendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value)) return null;
  const day = value.slice(0, 10), timestamp = Date.parse(day + 'T00:00:00Z');
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== day) return null;
  if (value.length > 10 && !Number.isFinite(Date.parse(value))) return null;
  return day;
}

function windowFor(node) {
  // Only explicit start/end pairs form a duration. A goal and a forecast are two
  // alternative dates, not an inferred interval between them.
  for (const [startKey, endKey] of [['startDate', 'endDate'], ['plannedStartDate', 'plannedEndDate']]) {
    if (node[startKey] || node[endKey]) {
      const start = calendarDate(node[startKey]), end = calendarDate(node[endKey]);
      return start && end && start <= end ? {start, end, dateBasis: startKey + '/' + endKey} : null;
    }
  }
  for (const key of ['estimatedDate', 'targetDate']) {
    if (node[key]) {
      const day = calendarDate(node[key]);
      return day ? {start: day, end: day, dateBasis: key} : null;
    }
  }
  const start = calendarDate(node.sourcePlannedStart), end = calendarDate(node.sourcePlannedEnd);
  return start && end && start <= end ? {start, end, dateBasis: 'sourcePlannedStart/sourcePlannedEnd'} : null;
}

/**
 * Pairwise calendar-day overlaps for exactly matching nonempty owner text.
 * Node dateConfirmed is surfaced; unknown owners, aliases, effort, dependencies,
 * and whether the overlapping work is actually incompatible are never inferred.
 * Returns [{id, kind, status:'needs-review', owner, overlap, items, reason}].
 */
export function findScheduleConflicts(data) {
  const owners = new Map(), seen = new Set();
  for (const project of data.projects || []) {
    for (const node of project.planNodes || []) {
      const owner = label(node?.owner).trim(), window = node && windowFor(node);
      if (!owner || unresolvedOwners.has(owner.toLowerCase()) || !window || !project.id || !node.id) continue;
      const identity = JSON.stringify([project.id, node.id]);
      if (seen.has(identity)) continue;
      seen.add(identity);
      if (!owners.has(owner)) owners.set(owner, []);
      owners.get(owner).push({projectId: project.id, projectName: label(project.name), nodeId: node.id,
        nodeTitle: label(node.title), ...window, dateConfirmed: node.dateConfirmed === true,
        outcome: label(project.outcome), nodeStatus: label(node.status)});
    }
  }
  const results = [];
  for (const [owner, items] of owners) {
    for (let left = 0; left < items.length; left += 1) {
      for (let right = left + 1; right < items.length; right += 1) {
        const a = items[left], b = items[right];
        const start = a.start > b.start ? a.start : b.start, end = a.end < b.end ? a.end : b.end;
        if (start > end) continue;
        const kind = a.start === a.end && b.start === b.end ? 'same-date' : 'date-overlap';
        results.push({id: 'schedule:' + JSON.stringify([a.projectId, a.nodeId, b.projectId, b.nodeId]), kind,
          status: 'needs-review', owner, overlap: {start, end}, items: [copy(a), copy(b)],
          reason: kind === 'same-date' ? '同一跟进人的两个计划落在同一天，待核对安排。' : '同一跟进人的计划日期重叠，待核对安排。'});
      }
    }
  }
  return results;
}

/** Only explicit shared associations qualify. Similar titles/tags/text do not. */
export function findContentOverlaps(data) {
  const projects = new Map((data.projects || []).map(project => [project.id, project]));
  const byChild = new Map(), results = [];
  for (const relation of data.relations || []) {
    if (!projects.has(relation.main) || !projects.has(relation.child) || relation.main === relation.child) continue;
    if (!byChild.has(relation.child)) byChild.set(relation.child, []);
    byChild.get(relation.child).push(relation);
  }
  for (const [childId, relations] of byChild) {
    const mainIds = [...new Set(relations.map(relation => relation.main))];
    if (mainIds.length < 2) continue;
    results.push({id: 'shared-child:' + childId, kind: 'shared-child', status: 'needs-review',
      projectId: childId, projectName: label(projects.get(childId).name), mainIds,
      parents: mainIds.map(id => ({id, name: label(projects.get(id).name)})), relations: copy(relations),
      reason: '同一子项目挂载到多个主项目，待核对各处关注范围。'});
  }
  const byProject = new Map();
  for (const board of data.quickBoards || []) {
    for (const pid of new Set(board.projectIds || [])) {
      if (!projects.has(pid)) continue;
      if (!byProject.has(pid)) byProject.set(pid, new Map());
      byProject.get(pid).set(board.id, {id: board.id, name: label(board.name), context: label(board.contexts?.[pid])});
    }
  }
  for (const [projectId, boards] of byProject) {
    if (boards.size < 2) continue;
    results.push({id: 'multi-board-project:' + projectId, kind: 'multi-board-project', status: 'needs-review',
      projectId, projectName: label(projects.get(projectId).name), boardIds: [...boards.keys()], boards: [...boards.values()],
      reason: '同一项目出现在多个行动看板，待核对讨论重点与跟进安排。'});
  }
  return results;
}
