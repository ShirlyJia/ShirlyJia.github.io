import {isClosedProject, outcomeKind} from './workbench-model.js';
import {parentCardMarkup} from './child-projects.js';
import {richEditorMarkup, richHTML, richHasContent} from './rich-text.js?v=20261030-card-preview';
import {isDeliveryDate, todayDate} from './delivery-model.js';
import {displayDescription} from './presentation.js';

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
  const conclusion = richEditorMarkup({value:project.result||'',html:formatted.result||'',label:project.name+'的结项结论',
    placeholder:'待补结论 · 点击填写',attrs:'data-inline="result" data-timeline-pid="'+pid+'"',collapsible:true});
  const status = project.outcome ? '<span class="outcome-chip '+outcomeKind(project)+'">'+esc(project.outcome)+'</span>' : '';
  const materials = project.materials?.length || 0;
  return `<li class="result-event">
    <div class="result-stamp">${stamp}</div>
    <article class="result-record" data-project-highlight="${pid}">
      <header><h3><button type="button" data-project-open="${pid}">${esc(project.name)}</button></h3>${status}</header>
      ${parentCardMarkup(project.id,data)}
      ${facts('问题陈述',description,formatted.description)}
      <div class="result-conclusion"><span class="result-label">结项结论</span>${conclusion}</div>
      ${facts('影响与证据',project.impact,formatted.impact)}
      <footer><button type="button" data-project-open="${pid}">项目详情${materials?' · '+materials+' 份资料':''} ↗</button><button type="button" data-reopen-project="${pid}">恢复跟进</button></footer>
    </article></li>`;
}

export function resultsTimelineMarkup(data, matches) {
  const closed = data.projects.filter(isClosedProject);
  const rows = closed.filter(matches).map(project=>({project,date:closingDay(project.closedAt)}))
    .sort((a,b)=>b.date.localeCompare(a.date)||a.project.name.localeCompare(b.project.name,'zh-CN')||a.project.id.localeCompare(b.project.id));
  const heading = '<div class="overview-heading"><h2>结项时间线</h2></div>';
  if (!rows.length) return heading + (closed.length
    ? '<div class="view-empty"><strong>没有匹配的结项记录</strong><p>清除筛选后可查看全部记录。</p></div>'
    : '<div class="view-empty"><strong>还没有结项记录</strong><p>项目结束后会显示在这里，也可以直接记录已结项目。</p></div>');
  return heading + '<ol class="result-timeline" aria-label="按结项日期从近到远">'+rows.map(({project,date})=>entryMarkup(project,date,data)).join('')+'</ol>';
}
