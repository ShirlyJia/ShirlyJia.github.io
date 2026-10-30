import {deliveryState, deliveryCases, todayDate} from './delivery-model.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dayNumber = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? Date.parse(value+'T00:00:00Z')/86400000 : null;
const daysUntil = (date,today) => dayNumber(date) !== null && dayNumber(today) !== null ? dayNumber(date)-dayNumber(today) : null;
const eventLabels = {baseline:'已确认日期首次留档',confirmed:'确认交付日',reconfirmed:'重新确认交付日',rescheduled:'延后交付',advanced:'提前交付',corrected:'更正日期',withdrawn:'撤销日期确认',overdue:'发现交付逾期',delivered:'记录已交付',reopened:'恢复跟进',removed:'移除计划',projectClosed:'项目结束',projectReopened:'项目恢复跟进',projectDeleted:'项目删除',undo:'撤销调整',restored:'恢复计划'};

function label(state,today,node) {
  if(state.kind==='overdue')return '已延期 '+state.daysLate+' 天';
  if(state.kind==='due')return '今天交付';
  if(state.kind==='delivered')return state.daysLate?'已交付 · 晚 '+state.daysLate+' 天':'已交付';
  if(state.kind==='closed')return '项目已结束';
  if(node?.delivery&&!node.dateConfirmed)return '已撤回确认';
  if(state.kind==='scheduled'){
    const days=daysUntil(state.date,today);
    return days===1?'明天交付':days!==null&&days<=3?'还有 '+days+' 天':'已确认';
  }
  return state.date?'待确认':'未设置';
}
function tone(state,today) {
  if(state.kind==='overdue')return 'overdue';
  if(state.kind==='due'||(state.kind==='scheduled'&&daysUntil(state.date,today)<=3))return 'soon';
  if(state.kind==='delivered')return 'delivered';
  return state.kind==='scheduled'?'confirmed':'neutral';
}
function dateHTML(date,className='') {
  return date?'<time class="'+esc(className)+'" datetime="'+esc(date)+'">'+esc(date)+'</time>':'';
}
function action(nodeId,projectId,kind,text,className='') {
  return '<button type="button" class="'+esc(className)+'" data-delivery-'+kind+'="'+esc(nodeId)+'" data-project-id="'+esc(projectId)+'">'+esc(text)+'</button>';
}
function orderedPlans(project,today) {
  const rank={overdue:0,due:1,scheduled:2,draft:3,none:4,delivered:5,closed:6};
  return (project.planNodes||[]).map(node=>({node,state:deliveryState(project,node,{today})}))
    .filter(item=>item.state.date||item.node.targetDate)
    .sort((a,b)=>(rank[a.state.kind]??7)-(rank[b.state.kind]??7)||Number(!!b.node.focus)-Number(!!a.node.focus)||(a.state.date||a.node.targetDate).localeCompare(b.state.date||b.node.targetDate));
}

/** One date summary per project; overdue work takes precedence over a manually focused plan. */
export function deliveryCardMarkup(project,{today=todayDate()}={}) {
  const rows=orderedPlans(project,today);if(!rows.length)return '';
  const {node,state}=rows[0],confirmedDate=state.date||node.estimatedDate||'',date=confirmedDate||node.targetDate;
  const dateLabel=confirmedDate?'承诺交付':'期望日期',status=confirmedDate?label(state,today,node):'期望';
  return '<div class="delivery-card-date delivery-tone-'+tone(state,today)+'" aria-label="'+esc(dateLabel+' '+date+' '+status)+'">'+
    '<div class="delivery-card-date-main"><span class="delivery-calendar" aria-hidden="true">▣</span><span class="delivery-date-label">'+dateLabel+'</span>'+dateHTML(date)+'<span class="delivery-state">'+esc(status)+'</span></div>'+
    ((node.title||node.owner||rows.length>1)?'<div class="delivery-card-context">'+(node.title?'<span>'+esc(node.title)+'</span>':'')+(node.owner?'<span>'+esc(node.owner)+'</span>':'')+(rows.length>1?'<span class="delivery-other-count">另 '+(rows.length-1)+' 项计划</span>':'')+'</div>':'')+'</div>';
}

/** Dates are edited through the confirmation dialog, so confirmed changes cannot bypass history. */
export function deliveryPlanMarkup(project,node,{today=todayDate()}={}) {
  const state=deliveryState(project,node,{today}),date=state.date||node.estimatedDate||'',hasDate=!!date;
  const hasHistory=state.hasHistory||!!node.delivery?.hasHistory;
  const completion=state.completedAt||node.delivery?.completedAt||'';
  const actions=action(node.id,project.id,'edit',hasDate?'修改日期':'设置交付日','delivery-edit-date')+
    (hasDate&&node.dateConfirmed&&state.kind!=='delivered'&&state.kind!=='closed'?action(node.id,project.id,'complete','标记已交付','delivery-complete'):'')+
    (state.kind==='delivered'?action(node.id,project.id,'complete','更正交付记录','delivery-complete')+action(node.id,project.id,'reopen','恢复跟进','delivery-reopen'):'')+
    (hasHistory?action(node.id,project.id,'history','延期记录 ↗','delivery-history-link'):'');
  return '<section class="delivery-plan delivery-tone-'+tone(state,today)+'" aria-label="交付日期">'+
    (hasDate?'<div class="delivery-plan-date"><div><span class="delivery-eyebrow">承诺交付日</span>'+dateHTML(date,'delivery-date-large')+'</div><span class="delivery-state">'+esc(label(state,today,node))+'</span></div>':'<div class="delivery-plan-date"><div class="delivery-no-date">尚未设置交付日</div>'+(node.delivery&&!node.dateConfirmed?'<span class="delivery-state">已撤回确认</span>':'')+'</div>')+
    ((node.targetDate||completion||state.baselineDate&&state.baselineDate!==date)?'<dl class="delivery-date-context">'+
      (node.targetDate?'<div><dt>期望日期</dt><dd>'+dateHTML(node.targetDate)+'</dd></div>':'')+
      (state.baselineDate&&state.baselineDate!==date?'<div><dt>首次承诺</dt><dd>'+dateHTML(state.baselineDate)+'</dd></div>':'')+
      (completion?'<div><dt>实际交付</dt><dd>'+dateHTML(completion)+'</dd></div>':'')+'</dl>':'')+
    '<div class="delivery-plan-actions">'+actions+'</div></section>';
}

function timestamp(value) {
  const parsed=new Date(value);
  return Number.isFinite(parsed.getTime())?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(parsed):String(value||'');
}
function eventDates(event) {
  if(event.kind==='delivered')return '<span>实际交付 '+dateHTML(event.completedAt||event.toDate||'')+'</span>';
  if(event.fromDate&&event.toDate&&event.fromDate!==event.toDate)return dateHTML(event.fromDate)+'<span aria-hidden="true">→</span>'+dateHTML(event.toDate);
  const date=event.toDate||event.fromDate;
  return date?dateHTML(date):'';
}
function timeline(events) {
  return '<ol class="delivery-timeline">'+events.map(event=>'<li data-delivery-event="'+esc(event.id)+'"><div class="delivery-event-heading"><strong>'+esc(eventLabels[event.kind]||'交付记录')+'</strong><time datetime="'+esc(event.at)+'">'+esc(timestamp(event.at))+'</time></div>'+
    '<div class="delivery-event-dates">'+eventDates(event)+'</div>'+
    (event.reason?'<p class="delivery-event-reason">'+esc(event.reason)+'</p>':'')+
    '<div class="delivery-event-author">'+esc(event.actor||'未署名')+(event.owner?' · 当时跟进人 '+esc(event.owner):'')+'</div></li>').join('')+'</ol>';
}
function caseMarkup(row,today) {
  const state=row.state,projectExists=!!row.project,nodeExists=!!row.node;
  const events=row.events||[],changes=events.filter(event=>event.kind==='rescheduled').length;
  const reasonEvent=events.find(event=>event.reason&&event.kind!=='overdue')||events.find(event=>event.reason),latestReason=reasonEvent?.reason;
  const title=projectExists?'<button type="button" data-delivery-open="'+esc(row.projectId)+'" data-node-id="'+esc(row.nodeId)+'">'+esc(row.projectName)+'</button>':'<strong>'+esc(row.projectName)+'</strong>';
  const status=row.removed?'已移除':label(state,today,row.node);
  const currentDateLabel=row.removed?'最后记录日期':row.node&&!row.node.dateConfirmed?'交付日期 · 未确认':'当前承诺';
  return '<article class="delivery-case delivery-tone-'+tone(state,today)+'" data-delivery-case="'+esc(row.key)+'" data-project-highlight="'+esc(row.projectId)+'">'+
    '<header><div class="delivery-case-title">'+title+'<p>'+esc(row.nodeTitle||'未命名计划')+(row.owner?' · '+esc(row.owner):'')+'</p></div><span class="delivery-state">'+esc(status)+'</span></header>'+
    '<div class="delivery-case-dates">'+(state.baselineDate?'<div><span>首次承诺</span>'+dateHTML(state.baselineDate)+'</div>':'')+(state.date?'<div><span>'+currentDateLabel+'</span>'+dateHTML(state.date)+'</div>':'')+(state.completedAt?'<div><span>实际交付</span>'+dateHTML(state.completedAt)+'</div>':'')+'</div>'+
    (latestReason?'<div class="delivery-latest-reason"><span>最近说明</span><p>'+esc(latestReason)+'</p></div>':'')+
    '<footer><details class="delivery-case-history"><summary>查看 '+events.length+' 条记录'+(changes?' · 延期 '+changes+' 次':'')+'</summary>'+timeline(events)+'</details>'+
    (projectExists&&nodeExists?'<div class="delivery-case-actions">'+action(row.nodeId,row.projectId,'edit','调整交付日')+(state.kind==='overdue'||state.kind==='due'||state.kind==='scheduled'?action(row.nodeId,row.projectId,'complete','标记已交付'):'')+'</div>':'')+'</footer></article>';
}

/** Only exception cases are exposed here; ordinary project schedules remain in their own cards. */
export function deliveryPageMarkup(data,{filter='active',query='',today=todayDate()}={}) {
  const cases=deliveryCases(data,{today}),active=cases.filter(row=>row.state.kind==='overdue'&&!row.removed);
  const q=query.trim().toLocaleLowerCase(),rows=(filter==='active'?active:cases).filter(row=>!q||[row.projectName,row.nodeTitle,row.owner,...row.events.map(event=>event.reason||'')].join(' ').toLocaleLowerCase().includes(q));
  const totalChanges=cases.reduce((total,row)=>total+row.events.filter(event=>event.kind==='rescheduled').length,0);
  return '<div class="delivery-page"><header class="delivery-page-head"><div class="delivery-summary"><span'+(active.length?' class="has-delays"':'')+'><strong>'+active.length+'</strong> 项正在延期</span><span><strong>'+totalChanges+'</strong> 次延期调整</span></div></header>'+
    '<div class="delivery-page-controls"><div role="tablist" aria-label="延期记录范围"><button type="button" role="tab" data-delivery-filter="active" aria-selected="'+(filter==='active')+'">当前延期 <span>'+active.length+'</span></button><button type="button" role="tab" data-delivery-filter="history" aria-selected="'+(filter==='history')+'">历史记录 <span>'+cases.length+'</span></button></div><label class="delivery-search"><span class="sr-only">搜索延期记录</span><input type="search" data-delivery-search placeholder="搜索项目、计划或理由" aria-label="搜索延期记录" value="'+esc(query)+'"></label></div>'+
    '<div class="delivery-case-list">'+(rows.length?rows.map(row=>caseMarkup(row,today)).join(''):'<div class="delivery-empty"><strong>'+(q?'没有匹配的记录':filter==='active'?'当前没有延期项目':'暂无延期历史')+'</strong><p>'+(q?'换一个关键词试试。':filter==='active'?'已确认交付日过后仍未交付的计划会出现在这里。':'发生延期或调整后，日期与原因会留存在这里。')+'</p></div>')+'</div></div>';
}
