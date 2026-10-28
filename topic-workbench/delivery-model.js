import {isClosedProject} from './workbench-model.js';

const clone = value => JSON.parse(JSON.stringify(value));
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const own = (value,key) => Object.prototype.hasOwnProperty.call(value,key);
const dayMs = 86400000;
const eventKinds = new Set(['baseline','confirmed','reconfirmed','rescheduled','advanced','corrected','withdrawn','overdue','delivered','reopened','removed','undo','restored','projectClosed','projectReopened']);
const exceptionKinds = new Set(['reconfirmed','rescheduled','advanced','corrected','withdrawn','overdue','reopened','removed','undo','restored']);
const completedStatuses=new Set(['done','finished','completed','已完成','已交付']);
function legacyCompletion(node,today){
  const actual=typeof node?.actualFinish==='string'?node.actualFinish.slice(0,10):'';
  const completedAt=isDeliveryDate(actual)&&actual<=today?actual:'';
  return {completed:!!completedAt||completedStatuses.has(String(node?.status||'').trim().toLowerCase()),completedAt};
}
const stringFields = ['id','kind','at','actor','projectId','projectName','nodeId','nodeTitle','owner','fromDate','toDate','baselineDate','completedAt','reason','cycleId'];
const uuid = prefix => prefix + '-' + globalThis.crypto.randomUUID();
const timestamp = now => {
  const value = typeof now === 'function' ? now() : now ?? new Date();
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw Error('记录时间无效');
  return date.toISOString();
};
export function isDeliveryDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value+'T00:00:00Z')) && new Date(value+'T00:00:00Z').toISOString().slice(0,10) === value;
}
function dateValue(value,label,{empty=true}={}) {
  if (empty && value === '') return value;
  if (!isDeliveryDate(value)) throw Error(label+'必须是有效的完整日期');
  return value;
}
export function todayDate(now) {
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(timestamp(now)));
}
const days = (later,earlier) => Math.max(0,Math.round((Date.parse(later+'T00:00:00Z')-Date.parse(earlier+'T00:00:00Z'))/dayMs));
const historyEvent = event => exceptionKinds.has(event.kind) || (event.kind === 'delivered' && !!event.completedAt && !!event.toDate && event.completedAt > event.toDate);
const caseKey = (pid,nid) => JSON.stringify([pid,nid]);

/** Only estimatedDate is a commitment. targetDate is an independent desired date. */
export function deliveryState(project,node,{today=todayDate()}={}) {
  dateValue(today,'今天',{empty:false});
  const meta=node?.delivery, effective=isDeliveryDate(node?.estimatedDate)?node.estimatedDate:'';
  const committed=isDeliveryDate(meta?.committedDate)?meta.committedDate:effective;
  const legacy=legacyCompletion(node,today);
  const completed=isDeliveryDate(meta?.completedAt)?meta.completedAt:!meta?legacy.completedAt:'';
  const isComplete=meta&&own(meta,'completed')?meta.completed:!!completed||legacy.completed;
  const baseline=isDeliveryDate(meta?.baselineDate)?meta.baselineDate:node?.dateConfirmed?effective:'';
  let kind='none', daysLate=0;
  if (isComplete) {kind='delivered';daysLate=committed&&completed?days(completed,committed):0;}
  else if (isClosedProject(project)) kind='closed';
  else if (!effective) kind='none';
  else if (!node.dateConfirmed) kind='draft';
  else if (committed<today) {kind='overdue';daysLate=days(today,committed);}
  else kind=committed===today?'due':'scheduled';
  return {kind,date:effective?(node?.dateConfirmed?(committed||effective):effective):'',daysLate,baselineDate:baseline,completedAt:completed,hasHistory:!!meta?.hasHistory||kind==='overdue'||(kind==='delivered'&&daysLate>0)};
}

export function validateDelivery(data) {
  if (data.deliveryEvents !== undefined) {
    if (!Array.isArray(data.deliveryEvents)) throw Error('deliveryEvents 必须是数组');
    const ids=new Set();
    data.deliveryEvents.forEach((event,index)=>{
      const path='deliveryEvents['+index+']';
      if (!object(event)) throw Error(path+' 必须是对象');
      for (const key of stringFields) if (typeof event[key] !== 'string') throw Error(path+'.'+key+' 必须是字符串');
      for (const key of ['id','projectId','nodeId','cycleId']) if (!event[key].trim()) throw Error(path+'.'+key+' 不能为空');
      if (ids.has(event.id)) throw Error('交付记录 ID 重复');ids.add(event.id);
      if (!eventKinds.has(event.kind)) throw Error(path+' 记录类型无效');
      if (!Number.isFinite(Date.parse(event.at))) throw Error(path+' 记录时间无效');
      for (const key of ['fromDate','toDate','baselineDate','completedAt']) dateValue(event[key],path+'.'+key);
      if (['rescheduled','advanced','corrected','withdrawn','reopened','removed','undo','restored'].includes(event.kind)&&!event.reason.trim()) throw Error(path+' 缺少变更理由');
    });
  }
  for (const project of data.projects||[]) for (const node of project.planNodes||[]) {
    if (node.delivery===undefined) continue;
    const value=node.delivery;
    if (!object(value)) throw Error('delivery 必须是对象');
    for (const key of ['baselineDate','committedDate']) dateValue(value[key],'delivery.'+key,{empty:false});
    if (typeof value.confirmedAt !== 'string'||!Number.isFinite(Date.parse(value.confirmedAt))) throw Error('交付确认时间无效');
    if (typeof value.cycleId !== 'string'||!value.cycleId.trim()) throw Error('交付承诺周期标识无效');
    if (typeof value.hasHistory !== 'boolean') throw Error('交付历史标记无效');
    if (value.completedAt!==undefined) dateValue(value.completedAt,'实际交付日期');
    if(value.completed!==undefined&&typeof value.completed!=='boolean')throw Error('已交付标记必须是布尔值');
  }
  return true;
}

function appendEvent(events,project,node,kind,{at,actor='',reason='',fromDate,toDate,completedAt}={}) {
  const meta=node.delivery;
  const event={id:uuid('delivery-event'),kind,at,actor:String(actor||'').trim(),projectId:project.id,projectName:project.name||'',nodeId:node.id,nodeTitle:node.title||'',owner:node.owner||'',fromDate:fromDate??meta?.committedDate??'',toDate:toDate??meta?.committedDate??'',baselineDate:meta?.baselineDate||'',completedAt:completedAt??meta?.completedAt??'',reason:String(reason||'').trim(),cycleId:meta?.cycleId||uuid('delivery-cycle')};
  events.push(event);
  if(meta && historyEvent(event)) meta.hasHistory=true;
  return event;
}
function initialize(project,node,events,{at,actor='',kind='baseline'}={}) {
  if (node.delivery || !node.dateConfirmed || !isDeliveryDate(node.estimatedDate)) return false;
  const legacy=legacyCompletion(node,todayDate(at));
  node.delivery={baselineDate:node.estimatedDate,committedDate:node.estimatedDate,confirmedAt:at,cycleId:uuid('delivery-cycle'),completedAt:legacy.completedAt,completed:legacy.completed,hasHistory:false};
  appendEvent(events,project,node,kind,{at,actor,fromDate:'',toDate:node.estimatedDate});
  return true;
}
function observeOverdue(project,node,events,{at,actor='',today}={}) {
  const state=deliveryState(project,node,{today});
  if(state.kind!=='overdue'||!node.delivery)return false;
  if(events.some(event=>event.projectId===project.id&&event.nodeId===node.id&&event.cycleId===node.delivery.cycleId&&event.kind==='overdue'))return false;
  appendEvent(events,project,node,'overdue',{at,actor,reason:'已过承诺交付日，尚未记录交付。'});
  return true;
}

/** First observation is recorded as such; no past confirmation time is fabricated. */
export function reconcileDelivery(data,{now,actor=''}={}) {
  validateDelivery(data);
  const at=timestamp(now),today=todayDate(at),events=clone(data.deliveryEvents||[]),updates=[];
  for(const project of data.projects||[])for(const original of project.planNodes||[]){
    const node=clone(original),before=JSON.stringify(node);
    initialize(project,node,events,{at,actor});
    observeOverdue(project,node,events,{at,actor,today});
    if(JSON.stringify(node)!==before)updates.push([original,node]);
  }
  const changed=updates.length>0||data.deliveryEvents===undefined||events.length!==(data.deliveryEvents||[]).length;
  if(changed){for(const [original,node]of updates)Object.assign(original,node);data.deliveryEvents=events;}
  return changed;
}

function locate(data,pid,nid){
  const project=data.projects?.find(item=>item.id===pid),node=project?.planNodes?.find(item=>item.id===nid);
  if(!project||!node)throw Error('项目或计划已不存在');
  return {project,node};
}

/** Validates a cloned node and log first, then commits both together in memory. */
export function updateDelivery(data,pid,nid,patch,{reason='',actor='',now}={}) {
  if(!object(patch))throw Error('交付变更必须是对象');
  const allowed=new Set(['targetDate','estimatedDate','dateConfirmed','completedAt']);
  for(const key of Object.keys(patch))if(!allowed.has(key))throw Error('不支持的交付字段：'+key);
  validateDelivery(data);
  const {project,node:original}=locate(data,pid,nid),node=clone(original),events=clone(data.deliveryEvents||[]),start=events.length;
  const at=timestamp(now),today=todayDate(at),why=String(reason||'').trim();
  initialize(project,node,events,{at,actor});
  const before=clone(node),meta=node.delivery,hadCommitment=!!meta;
  for(const key of ['targetDate','estimatedDate','completedAt'])if(own(patch,key))dateValue(patch[key],key==='estimatedDate'?'承诺交付日':key==='targetDate'?'期望日期':'实际交付日期');
  if(own(patch,'dateConfirmed')&&typeof patch.dateConfirmed!=='boolean')throw Error('交付确认标记必须为布尔值');
  const estimateChanged=own(patch,'estimatedDate')&&patch.estimatedDate!==(node.estimatedDate||'');
  const confirmationChanged=own(patch,'dateConfirmed')&&patch.dateConfirmed!==!!node.dateConfirmed;
  const wasCompleted=deliveryState(project,node,{today}).kind==='delivered';
  const completedChanged=own(patch,'completedAt')&&(patch.completedAt!==(meta?.completedAt||'')||(!patch.completedAt&&wasCompleted));
  if(hadCommitment&&(estimateChanged||(confirmationChanged&&!patch.dateConfirmed)||(completedChanged&&wasCompleted))&&!why)throw Error(estimateChanged?'修改已确认交付日期，请填写调整理由。':confirmationChanged?'撤销交付日期确认，请填写理由。':'修改交付记录，请填写理由。');
  for(const key of ['targetDate','estimatedDate','dateConfirmed'])if(own(patch,key))node[key]=patch[key];
  if((estimateChanged||own(patch,'dateConfirmed'))&&node.dateConfirmed&&!node.estimatedDate)throw Error('请填写承诺交付日，再确认交付日期。');
  if(own(patch,'completedAt')&&patch.completedAt>today)throw Error('实际交付日期不能晚于今天');
  if(own(patch,'completedAt')&&patch.completedAt&&!hadCommitment&&!node.dateConfirmed)throw Error('请先确认承诺交付日，再记录实际交付');
  // Observe the old commitment before applying an amendment. A past-dated actual
  // delivery entered now is distinguished from this observation, not inferred.
  observeOverdue(project,before,events,{at,actor,today});
  if(before.delivery?.hasHistory&&node.delivery)node.delivery.hasHistory=true;
  if(!hadCommitment){
    initialize(project,node,events,{at,actor,kind:'confirmed'});
  }else{
    const oldDate=meta.committedDate;
    if(confirmationChanged&&!node.dateConfirmed){
      appendEvent(events,project,node,'withdrawn',{at,actor,reason:why,fromDate:oldDate,toDate:node.estimatedDate||''});
    }else if(estimateChanged){
      const newDate=node.estimatedDate||'';
      node.delivery.cycleId=uuid('delivery-cycle');
      if(newDate)node.delivery.committedDate=newDate;
      appendEvent(events,project,node,newDate?(newDate>oldDate?'rescheduled':newDate<oldDate?'advanced':'corrected'):'withdrawn',{at,actor,reason:why,fromDate:oldDate,toDate:newDate});
    }
    if(confirmationChanged&&node.dateConfirmed){
      node.delivery.cycleId=uuid('delivery-cycle');node.delivery.committedDate=node.estimatedDate;node.delivery.confirmedAt=at;
      appendEvent(events,project,node,'reconfirmed',{at,actor,reason:why,fromDate:oldDate,toDate:node.estimatedDate});
    }
  }
  if(completedChanged){
    if(!node.delivery)throw Error('请先确认承诺交付日，再记录实际交付');
    const oldActual=node.delivery.completedAt||'';node.delivery.completedAt=patch.completedAt;node.delivery.completed=!!patch.completedAt;
    appendEvent(events,project,node,patch.completedAt?'delivered':'reopened',{at,actor,reason:why,completedAt:patch.completedAt});
    if(oldActual&&patch.completedAt)node.delivery.hasHistory=true;
  }
  observeOverdue(project,node,events,{at,actor,today});
  validateDelivery({projects:[{...project,planNodes:[node]}],deliveryEvents:events});
  const changed=JSON.stringify(original)!==JSON.stringify(node)||events.length!==start;
  if(changed){Object.assign(original,node);data.deliveryEvents=events;}
  return {changed,node:original,events:events.slice(start)};
}

export function removeDeliveryNode(data,pid,nid,{reason='',actor='',now}={}){
  validateDelivery(data);
  const {project,node:original}=locate(data,pid,nid),node=clone(original),events=clone(data.deliveryEvents||[]),start=events.length;
  const at=timestamp(now),today=todayDate(at),why=String(reason||'').trim();
  initialize(project,node,events,{at,actor});
  const tracked=!!node.delivery||events.some(event=>event.projectId===pid&&event.nodeId===nid);
  if(tracked&&!why)throw Error('移除已有交付记录的计划，请填写理由。');
  observeOverdue(project,node,events,{at,actor,today});
  if(tracked)appendEvent(events,project,node,'removed',{at,actor,reason:why});
  validateDelivery({projects:[],deliveryEvents:events});
  project.planNodes=project.planNodes.filter(item=>item.id!==nid);data.deliveryEvents=events;
  return {changed:true,node:null,events:events.slice(start)};
}

/** Project closure is tracked separately from actual delivery; it never fabricates an actual date. */
export function recordDeliveryLifecycle(data,before,{now,actor=''}={}) {
  validateDelivery(data);
  const at=timestamp(now),events=clone(data.deliveryEvents||[]),start=events.length;
  for(const project of data.projects||[]){
    const prior=before?.projects?.find(item=>item.id===project.id);
    if(!prior||isClosedProject(prior)===isClosedProject(project))continue;
    for(const node of project.planNodes||[]){
      if(!node.delivery)continue;
      appendEvent(events,project,node,isClosedProject(project)?'projectClosed':'projectReopened',{at,actor,reason:isClosedProject(project)?'项目已结束；实际交付状态单独记录。':'项目恢复跟进，继续按承诺交付日追踪。'});
    }
  }
  if(events.length===start)return false;
  validateDelivery({projects:data.projects,deliveryEvents:events});data.deliveryEvents=events;return true;
}

/** Exception-only projection; deleted nodes retain their frozen event labels. */
export function deliveryCases(data,{today=todayDate()}={}){
  dateValue(today,'今天',{empty:false});
  const groups=new Map();
  for(const event of data.deliveryEvents||[]){
    const key=caseKey(event.projectId,event.nodeId);
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push(event);
  }
  const records=new Map();
  for(const project of data.projects||[])for(const node of project.planNodes||[]){
    const key=caseKey(project.id,node.id),events=groups.get(key)||[],state=deliveryState(project,node,{today});
    if(state.kind!=='overdue'&&!state.hasHistory&&!events.some(historyEvent))continue;
    records.set(key,{key,projectId:project.id,projectName:project.name,nodeId:node.id,nodeTitle:node.title||'',owner:node.owner||'',project,node,removed:false,state,events:events.slice().reverse().sort((a,b)=>b.at.localeCompare(a.at)),latestAt:events.at(-1)?.at||''});
  }
  for(const [key,events]of groups){
    if(records.has(key)||!events.some(historyEvent))continue;
    const last=events.at(-1),project=data.projects?.find(item=>item.id===last.projectId)||null,node=project?.planNodes?.find(item=>item.id===last.nodeId)||null;
    if(node)continue;
    records.set(key,{key,projectId:last.projectId,projectName:project?.name||last.projectName,nodeId:last.nodeId,nodeTitle:last.nodeTitle,owner:last.owner,project,node:null,removed:true,state:{kind:'closed',date:last.toDate||last.fromDate,daysLate:0,baselineDate:last.baselineDate,completedAt:last.completedAt,hasHistory:true},events:events.slice().reverse().sort((a,b)=>b.at.localeCompare(a.at)),latestAt:last.at});
  }
  return [...records.values()].sort((a,b)=>Number(b.state.kind==='overdue')-Number(a.state.kind==='overdue')||b.state.daysLate-a.state.daysLate||b.latestAt.localeCompare(a.latestAt));
}
