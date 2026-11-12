/** Project disposition is independent of priority, free-form outcome and board placement. */
export const lifecycleLabels = Object.freeze({active:'推进中',completed:'已完成',terminated:'已终止',frozen:'已冻结'});
const resolved = new Set(['已解决','已交付','已完成']);
const stopped = new Set(['已结束未解决','停止推进','不再推进','暂停终止']);
export function projectLifecycle(project) {
  if (Object.hasOwn(lifecycleLabels,project?.lifecycle)) return project.lifecycle;
  if (project?.closed === false) return 'active';
  const outcome = typeof project?.outcome === 'string' ? project.outcome.trim() : '';
  if (stopped.has(outcome)) return 'terminated';
  return project?.closed === true || resolved.has(outcome) ? 'completed' : 'active';
}
export const isHistoryProject = project => projectLifecycle(project) !== 'active';
export const lifecycleField = project => ({completed:'result',terminated:'terminationReason',frozen:'freezeReason'}[projectLifecycle(project)] || 'result');
export const lifecycleConclusionLabel = project => ({completed:'结项结论',terminated:'终止原因与结论',frozen:'冻结原因'}[projectLifecycle(project)] || '结项结论');
export const lifecycleDate = project => projectLifecycle(project)==='frozen' ? project.frozenAt : project.closedAt;
const validDay = value => typeof value==='string' && /^\d{4}-\d\d-\d\d$/.test(value) && Number.isFinite(Date.parse(value+'T00:00:00Z')) && new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
export function lifecycleToday() {
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
}
/** Called in the same undo/save transaction as the associated flow change. */
export function recordProjectLifecycle(project, from, to, date=lifecycleToday()) {
  if (!Object.hasOwn(lifecycleLabels,to) || !validDay(date)) throw Error('项目状态或日期无效');
  project.lifecycle=to;
  if (from===to) return;
  project.lifecycleHistory ||= [];
  project.lifecycleHistory.push({from,to,date,note:to==='active'?'恢复跟进':String(project[lifecycleField(project)]||''),resumeCondition:to==='frozen'?String(project.resumeCondition||''):''});
}
export function validateProjectLifecycle(project,path='project') {
  if (project.lifecycle!==undefined && !Object.hasOwn(lifecycleLabels,project.lifecycle)) throw Error(path+'.lifecycle 无效');
  if (project.lifecycle!==undefined && project.closed!==undefined && project.closed!==['completed','terminated'].includes(project.lifecycle)) throw Error(path+' 状态与结束标记不一致');
  for (const field of ['freezeReason','terminationReason','resumeCondition','frozenAt']) if (project[field]!==undefined && typeof project[field]!=='string') throw Error(path+'.'+field+' 必须是字符串');
  if (project.frozenAt && !validDay(project.frozenAt)) throw Error(path+'.frozenAt 日期无效');
  if (project.lifecycleHistory===undefined) return;
  if (!Array.isArray(project.lifecycleHistory)) throw Error(path+'.lifecycleHistory 必须是数组');
  for (const event of project.lifecycleHistory) {
    if (!event || !Object.hasOwn(lifecycleLabels,event.from) || !Object.hasOwn(lifecycleLabels,event.to) || !validDay(event.date) || typeof event.note!=='string' || typeof event.resumeCondition!=='string') throw Error(path+' 状态记录无效');
  }
}
