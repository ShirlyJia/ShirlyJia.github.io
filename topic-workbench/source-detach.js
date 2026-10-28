/** One-time removal of legacy provenance from workbench documents, never meetings. */
import {displayStatus, visibleNodes} from './presentation.js';

const clone = value => JSON.parse(JSON.stringify(value));
const textFields = new Set(['description','summary','result','impact','commentDraft','body','note','notes','context','text']);
const provenanceKeys = new Set(['source','sourceKind','sourceUrl','sourceFields','sourceOwners','sourceNodes','sourcePriority','sourceStatus','originalName','initialName','inCurrentView','dateSource','sourceIsDelayed','isCurrent','rationale']);

export function isFeishuSourceURL(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return ['feishu.cn','larksuite.com','meegle.com'].some(domain => hostname === domain || hostname.endsWith('.' + domain));
  } catch { return false; }
}

export function removeFeishuReferences(value) {
  const original = String(value ?? '');
  let result = original.replace(/\[([^\]\n]*)\]\((https?:\/\/[^\s)]+)(?:\s+"[^"]*")?\)/g, (whole,label,url) => {
    if (!isFeishuSourceURL(url)) return whole;
    return /^(?:飞书.*|查看.*原项|打开来源|原文|来源|链接|https?:\/\/.*)$/.test(label.trim()) ? '' : label;
  }).replace(/https?:\/\/[^\s<>"'\[\]()（），。；！？、“”]+/g, url => isFeishuSourceURL(url) ? '' : url);
  if (result === original) return original;
  return result.replace(/\(\s*\)|（\s*）|<\s*>/g,'')
    .replace(/(?:关联|来源|原文|原项|原始链接|链接|资料链接|收录到)[：:]\s*(?=$|[,，。；;\n])/gm,'')
    .replace(/([，,；;])\s*\1/g,'$1')
    .replace(/^[\t ]*[-*]?[\t ]*$/gm,'').replace(/\n{3,}/g,'\n\n').trim();
}

export function detachSourceMetadata(input) {
  if (input?.schemaVersion !== 2 || !Array.isArray(input.projects)) throw Error('来源清理需要有效的工作台数据');
  if (input.sourceDetachedVersion !== undefined && input.sourceDetachedVersion !== 1) throw Error('不支持此工作台数据版本');
  const data = clone(input);
  if (data.sourceDetachedVersion === 1) return {data, changed:false};

  // Freeze the currently visible facts before removing their old provenance.
  for (const project of data.projects) {
    if (typeof project.status === 'string') project.status = displayStatus(project);
    project.planNodes = visibleNodes(project).map(node => {
      const next = {...node};
      for (const [oldKey,newKey] of [['sourceActualStart','actualStart'],['sourceActualFinish','actualFinish']]) {
        if (next[newKey] === undefined && next[oldKey]) next[newKey] = next[oldKey];
        delete next[oldKey];
      }
      // A target/forecast date stays a single date, not a newly inferred duration.
      if (!next.targetDate && !next.estimatedDate && !next.startDate && !next.endDate && !next.plannedStartDate && !next.plannedEndDate) {
        if (next.sourcePlannedStart) next.plannedStartDate = next.sourcePlannedStart;
        if (next.sourcePlannedEnd) next.plannedEndDate = next.sourcePlannedEnd;
      }
      delete next.sourcePlannedStart; delete next.sourcePlannedEnd;
      return next;
    });
  }
  for (const key of ['importedAt','sourceSnapshotAt','generatedAt','organizationNotes','previousProjectIds','redactionSummary']) delete data[key];
  function clean(value) {
    if (!value || typeof value !== 'object') return;
    for (const key of Object.keys(value)) {
      if (provenanceKeys.has(key)) { delete value[key]; continue; }
      if (key === 'materials' && Array.isArray(value[key])) value[key] = value[key].filter(item => !isFeishuSourceURL(item.url));
      if (typeof value[key] === 'string' && textFields.has(key)) value[key] = removeFeishuReferences(value[key]);
      else clean(value[key]);
    }
  }
  clean(data);
  data.sourceDetachedVersion = 1;
  return {data, changed:true};
}
