import {frozenNote} from './frozen-note.js';
import {outcomeKind} from './workbench-model.js';
import {parentCardMarkup} from './child-projects.js';
import {richEditorMarkup, richHTML, richHasContent} from './rich-text.js?v=20261030-card-preview';
import {isDeliveryDate, todayDate} from './delivery-model.js';
import {displayDescription} from './presentation.js';
import {projectLifecycle,isHistoryProject,lifecycleLabels,lifecycleField,lifecycleConclusionLabel,lifecycleDate} from './project-lifecycle.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function closingDay(value) {
  if (isDeliveryDate(value)) return value;
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/i.test(value)) return '';
  return isDeliveryDate(value.slice(0,10)) && Number.isFinite(Date.parse(value)) ? todayDate(value) : '';
}

function entryMarkup(project, date, data) {
  const pid = esc(project.id);
  const stamp = date
    ? `<time datetime="${date}"><span>${date.slice(0,4)} 年</span><strong>${Number(date.slice(5,7))} 月 ${Number(date.slice(8))} 日</strong></time>`
    : '<span class="result-undated">日期待补</span>';
  const description = displayDescription(project.description);
  const formatted = project.richText || {};
  const facts = (title, value, html) => richHasContent({text:value||'', html:html||''})
    ? '<div class="result-fact"><span class="result-label">'+title+'</span><div class="rich-content">'+richHTML(html,value)+'</div></div>' : '';
  const kind=projectLifecycle(project),field=lifecycleField(project),label=lifecycleConclusionLabel(project);
  const freeze=frozenNote(project);
  const conclusion = richEditorMarkup({value:kind==='frozen'?freeze.text:project[field]??(kind==='terminated'?project.result:'')??'',html:kind==='frozen'?freeze.html:formatted[field]??(kind==='terminated'?formatted.result:'')??'',label:project.name+'的'+label,
    placeholder:kind==='completed'?'待补结论 · 点击填写':'待补原因 · 点击填写',attrs:'data-inline="'+field+'" data-timeline-pid="'+pid+'"',collapsible:true});
  const status = '<span class="lifecycle-badge '+kind+'">'+lifecycleLabels[kind]+'</span>'+(project.outcome ? '<span class="outcome-chip '+outcomeKind(project)+'">'+esc(project.outcome)+'</span>' : '');

  const materials = project.materials?.length || 0;
  return `<li class="result-event lifecycle-${kind}">
    <div class="result-stamp">${stamp}</div>
    <article class="result-record" data-project-highlight="${pid}">
      <header><h3><button type="button" data-project-open="${pid}">${esc(project.name)}</button></h3>${status}</header>
      ${parentCardMarkup(project.id,data)}
      ${facts('问题陈述',description,formatted.description)}
      <div class="result-conclusion"><span class="result-label">${label}</span>${conclusion}</div>
      ${kind==='frozen'?'':facts(kind==='completed'?'影响与证据':'已有进展与可复用信息',project.impact,formatted.impact)}
      <footer><button type="button" data-project-open="${pid}">项目详情${materials?' · '+materials+' 份资料':''} ↗</button><button type="button" data-reopen-project="${pid}">恢复跟进</button></footer>
    </article></li>`;
}

export function resultsTimelineMarkup(data, matches=()=>true, filter='all') {
  const closed = data.projects.filter(isHistoryProject);
  const rows = closed.filter(matches).filter(p=>filter==='all'||projectLifecycle(p)===filter).map(project=>({project,date:closingDay(lifecycleDate(project))}))
    .sort((a,b)=>b.date.localeCompare(a.date)||a.project.name.localeCompare(b.project.name,'zh-CN')||a.project.id.localeCompare(b.project.id));
  const options=[['all','全部'],['completed','已完成'],['terminated','已终止'],['frozen',lifecycleLabels.frozen]];
  const heading = '<div class="history-heading"><h2>项目时间线</h2><div class="history-filters" role="group" aria-label="历史项目状态">'+options.map(([value,label])=>'<button type="button" data-history-filter="'+value+'" class="'+(value===filter?'active':'')+'" aria-pressed="'+(value===filter)+'">'+label+'<span>'+closed.filter(p=>matches(p)&&(value==='all'||projectLifecycle(p)===value)).length+'</span></button>').join('')+'</div></div>';
  if (!rows.length) return heading + (closed.length
    ? '<div class="view-empty"><strong>没有匹配的记录</strong><p>切换状态或清除筛选后查看。</p></div>'
    : '<div class="view-empty"><strong>还没有历史记录</strong><p>结项、终止或暂时搁置的项目都会留在这里。</p></div>');
  return heading + '<ol class="result-timeline" aria-label="按状态记录日期从近到远">'+rows.map(({project,date})=>entryMarkup(project,date,data)).join('')+'</ol>';
}
