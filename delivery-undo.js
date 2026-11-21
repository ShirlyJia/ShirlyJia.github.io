import {isDeliveryDate, reconcileDelivery, validateDelivery} from './delivery-model.js';

const clone=value=>JSON.parse(JSON.stringify(value));
const key=(pid,nid)=>JSON.stringify([pid,nid]);
const index=data=>new Map((data.projects||[]).flatMap(project=>(project.planNodes||[]).map(node=>[key(project.id,node.id),{project,node}])));
const eventsFor=(data,pid,nid)=>(data.deliveryEvents||[]).filter(event=>event.projectId===pid&&event.nodeId===nid);
const tracked=(entry,events=[])=>!!entry?.node?.delivery||!!(entry?.node?.dateConfirmed&&isDeliveryDate(entry?.node?.estimatedDate))||events.length>0;
const actual=node=>node?.delivery?.completedAt||'';
const completed=node=>!!(node?.delivery?.completed||actual(node));
const confirmed=node=>!!node?.dateConfirmed&&isDeliveryDate(node?.estimatedDate);
const promised=node=>node?.estimatedDate||'';
const semantic=node=>node?JSON.stringify([promised(node),confirmed(node),actual(node),completed(node)]):null;

/** Inspect without touching either document. A layout/text undo has no delivery gate. */
export function previewDeliveryUndo(current,candidate){
  const before=index(current),after=index(candidate),changes=[];
  for(const identity of new Set([...before.keys(),...after.keys()])){
    const previous=before.get(identity),next=after.get(identity),entry=next||previous;
    const events=eventsFor(current,entry.project.id,entry.node.id);
    if(!tracked(previous,events)&&!tracked(next))continue;
    if(semantic(previous?.node)===semantic(next?.node))continue;
    const action=!next?'移除交付计划':!previous?'恢复交付计划':completed(previous.node)!==completed(next.node)||actual(previous.node)!==actual(next.node)?'更正交付状态':confirmed(previous.node)&&!confirmed(next.node)?'撤回交付确认':!confirmed(previous.node)&&confirmed(next.node)?'恢复交付确认':'修改承诺交付日';
    changes.push({projectId:entry.project.id,nodeId:entry.node.id,projectName:entry.project.name||'',nodeTitle:entry.node.title||'',fromDate:promised(previous?.node)||events.at(-1)?.toDate||'',toDate:promised(next?.node),action});
  }
  return {requiresReason:changes.length>0,changes};
}

function timeValue(now){
  const date=new Date(typeof now==='function'?now():now??new Date());
  if(!Number.isFinite(date.getTime()))throw Error('撤销记录时间无效');
  return date.toISOString();
}
function historyBaseline(previous,next,events){
  return previous?.node.delivery?.baselineDate||events.find(event=>isDeliveryDate(event.baselineDate))?.baselineDate||next?.node.delivery?.baselineDate||
    (isDeliveryDate(promised(previous?.node))?promised(previous.node):promised(next?.node));
}

/**
 * Transform before persistence writes: old undo snapshots must never erase the
 * current log. A delivery reversal is another recorded change, not log deletion.
 */
export function applyDeliveryUndo(current,candidate,{reason='',actor='',now}={}){
  const preview=previewDeliveryUndo(current,candidate),why=String(reason||'').trim();
  if(preview.requiresReason&&!why)throw Error('撤销会改变已留档的交付安排，请填写调整理由。');
  const at=timeValue(now),observed=clone(current),result=clone(candidate);
  reconcileDelivery(observed,{now:at,actor});
  const merged=new Map((result.deliveryEvents||[]).map(event=>[event.id,event]));
  for(const event of observed.deliveryEvents||[])merged.set(event.id,clone(event));
  result.deliveryEvents=[...merged.values()];
  const before=index(observed),after=index(result),changed=new Set(preview.changes.map(change=>key(change.projectId,change.nodeId)));
  for(const identity of new Set([...before.keys(),...after.keys()])){
    const previous=before.get(identity),next=after.get(identity),entry=next||previous;
    const events=eventsFor(observed,entry.project.id,entry.node.id);
    if(!tracked(previous,events)&&!tracked(next))continue;
    // Preserve the current commitment metadata through unrelated undo snapshots.
    if(!changed.has(identity)){
      if(next&&previous?.node.delivery)next.node.delivery=clone(previous.node.delivery);
      continue;
    }
    const baselineDate=historyBaseline(previous,next,events);
    const last=events.at(-1),priorMeta=previous?.node.delivery||next?.node.delivery;
    const cycleId='delivery-cycle-'+globalThis.crypto.randomUUID();
    if(next){
      const estimate=promised(next.node);
      if(estimate&&!isDeliveryDate(estimate))throw Error('撤销后的承诺交付日无效');
      // Old snapshots could mark only a desired date confirmed. That is not a
      // commitment, so restoring one must not manufacture a delivery deadline.
      next.node.dateConfirmed=confirmed(next.node);
      const committedDate=next.node.dateConfirmed?estimate:priorMeta?.committedDate||last?.fromDate||baselineDate||estimate;
      next.node.delivery={...clone(priorMeta||{}),baselineDate,committedDate,confirmedAt:priorMeta?.confirmedAt||at,cycleId,completedAt:actual(next.node),completed:completed(next.node),hasHistory:true};
    }
    const source=previous||next;
    result.deliveryEvents.push({
      id:'delivery-event-'+globalThis.crypto.randomUUID(),kind:previous?'undo':'restored',at,actor:String(actor||'').trim(),
      projectId:entry.project.id,projectName:entry.project.name||'',nodeId:entry.node.id,nodeTitle:entry.node.title||'',owner:entry.node.owner||'',
      fromDate:promised(previous?.node)||last?.toDate||'',toDate:promised(next?.node),baselineDate,
      completedAt:actual(next?.node),reason:why,cycleId:next?.node.delivery?.cycleId||source.node.delivery?.cycleId||cycleId
    });
  }
  reconcileDelivery(result,{now:at,actor});
  validateDelivery(result);
  return result;
}
