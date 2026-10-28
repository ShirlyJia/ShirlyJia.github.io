// Display projections only: imported records and user edits stay intact.
const normalized = value => String(value ?? '').trim();
export function displayPriority(project) {
  const value = normalized(project.priority);
  return ['待定', '未设置', '未填写'].includes(value) ? '' : value;
}

export function displayStatus(project) {
  const value = normalized(project.status);
  return value === '开始' && value === project.source?.sourceStatus ? '' : value;
}

export function isSourcePlaceholder(project, node) {
  const original = project.source?.planNodes?.find(item => String(item.id) === String(node.id));
  return !!original && node.title === original.title && ['开始', '处理中', '进行中'].includes(node.title)
    && !node.owner && !node.targetDate && !node.estimatedDate && !node.note && !node.focus
    && (!node.status || node.status === original.status);
}

export function visibleNodes(project) {
  return project.planNodes.filter(node => !isSourcePlaceholder(project, node));
}

export function nodeStatus(value) {
  return ({doing:'进行中',done:'已完成',finished:'已完成',pending:'待开始',not_started:'待开始'})[value] || value || '';
}

export function displayDescription(value) {
  return String(value || '').replace(/(https?:\/\/[^\s（）()]+)[（(]\1[）)]/g, '$1')
    .replace(/^[\t ]*\|[\t ]*$/gm, '').replace(/\n[\t ]*\n(?:[\t ]*\n)+/g, '\n\n').trim();
}

export function sourceFieldsForDisplay(project) {
  const source = project.source || {};
  const internal = new Set(['需求状态', '需求类型']);
  const represented = new Set([project.description, project.summary, project.result].filter(Boolean).map(normalized));
  const seen = new Set();
  return (source.sourceFields || []).filter(field => {
    const value = normalized(field.value);
    if (!value || represented.has(value) || internal.has(field.label)) return false;
    if (field.label === '是否完成' && value === 'false') return false;
    if (field.label === '当前负责人' && source.sourceOwners?.length) return false;
    if (field.label === '相关文档1' && project.materials?.some(m => value.includes(m.url))) return false;
    const key = field.label + '\u0000' + value;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(field => {
    if (!['提出时间', '更新时间'].includes(field.label)) return field;
    const iso = String(field.value).match(/iso_time[：:]\s*(\d{4}-\d{2}-\d{2}T[^；;\s]+)/)?.[1];
    return iso ? {...field, value:iso.slice(0,16).replace('T',' ')} : field;
  });
}
