import test from 'node:test';
import assert from 'node:assert/strict';
import {todayDate,isDeliveryDate,deliveryState,reconcileDelivery,updateDelivery,removeDeliveryNode,deliveryCases,validateDelivery,recordDeliveryLifecycle} from './delivery-model.js';
import {createPersistence} from './persistence.js';
import {createSnapshotStore} from './snapshot-store.js';
import {deliveryCardMarkup,deliveryPlanMarkup,deliveryPageMarkup} from './delivery-view.js';

const copy=value=>JSON.parse(JSON.stringify(value));
const now='2026-10-28T08:00:00.000Z';
const plan=(extra={})=>({id:'n',title:'交付版本',owner:'小李',targetDate:'',estimatedDate:'2026-10-29',dateConfirmed:false,...extra});
const fixture=(extra={})=>({schemaVersion:2,sourceDetachedVersion:1,projects:[{id:'p',name:'项目甲',closed:false,tagIds:[],materials:[],planNodes:[plan(extra)]}],tags:[],relations:[],frames:[],instances:[],view:{x:0,y:0,z:1}});
const node=data=>data.projects[0].planNodes[0];
const confirm=(data,date='2026-10-29')=>updateDelivery(data,'p','n',{estimatedDate:date,dateConfirmed:true},{now,actor:'我'});

test('工作日倒计时、提醒、延期档案与交付更正共用承诺日口径',()=>{
  const holiday=fixture({dateConfirmed:true,estimatedDate:'2026-09-30'}),project=holiday.projects[0];
  reconcileDelivery(holiday,{now:'2026-10-07T08:00:00Z'});
  assert.deepEqual(holiday.deliveryEvents.map(e=>e.kind),['baseline']);
  assert.deepEqual(deliveryCases(holiday,{today:'2026-10-07'}),[]);
  assert.match(deliveryPlanMarkup(project,node(holiday),{today:'2026-10-07'}),/到期未交付/);
  reconcileDelivery(holiday,{now:'2026-10-08T08:00:00Z'});
  reconcileDelivery(holiday,{now:'2026-10-10T08:00:00Z'});
  assert.deepEqual(holiday.deliveryEvents.map(e=>e.kind),['baseline','overdue']);
  assert.match(deliveryCardMarkup(project,{today:'2026-10-10'}),/已延期 3 个工作日/);
  assert.match(deliveryPageMarkup(holiday,{today:'2026-10-10'}),/已延期 3 个工作日/);
  updateDelivery(holiday,'p','n',{completedAt:'2026-10-10'},{now:'2026-10-10T08:00:00Z'});
  assert.match(deliveryPageMarkup(holiday,{today:'2026-10-12',filter:'history'}),/已交付 · 延期 3 个工作日/);
  assert.doesNotMatch(deliveryPageMarkup(holiday,{today:'2026-10-12'}),/已延期 3 个工作日/);
});

test('休息日交付保留原日期，普通周末不累计延期，同期间改期仍须理由',()=>{
  const data=fixture({estimatedDate:'2026-10-30',dateConfirmed:true}),project=data.projects[0];
  const sunday={now:'2026-11-01T08:00:00Z'};
  reconcileDelivery(data,sunday);
  assert.throws(()=>updateDelivery(data,'p','n',{estimatedDate:'2026-11-01'},sunday),/理由/);
  updateDelivery(data,'p','n',{completedAt:'2026-11-01'},sunday);
  assert.equal(node(data).delivery.hasHistory,false);
  assert.equal(deliveryCases(data,{today:'2026-11-01'}).length,0);
  assert.equal(node(data).delivery.committedDate,'2026-10-30');
  const weekend=fixture({dateConfirmed:true,estimatedDate:'2026-11-01'}).projects[0];
  assert.match(deliveryCardMarkup(weekend,{today:'2026-10-30'}),/休息日交付/);
  assert.match(deliveryCardMarkup(weekend,{today:'2026-11-01'}),/今天交付/);
  assert.match(deliveryCardMarkup(project,{today:'2026-11-02'}),/已交付/);
  const monday=fixture({dateConfirmed:true,estimatedDate:'2026-11-02'}).projects[0];
  assert.match(deliveryCardMarkup(monday,{today:'2026-10-30'}),/还剩 1 个工作日/);
});

test('年度日历缺失时仅采用已知工作日，休假和回溯观察均不编造延期',()=>{
  const data=fixture({dateConfirmed:true,estimatedDate:'2027-01-01'}),project=data.projects[0];
  assert.match(deliveryCardMarkup(project,{today:'2026-12-30'}),/工作日历待补全/);
  reconcileDelivery(data,{now:'2027-01-05T08:00:00Z'});
  assert.deepEqual(data.deliveryEvents.map(e=>e.kind),['baseline']);
  assert.match(deliveryCardMarkup(project,{today:'2027-01-05'}),/到期未交付 · 工作日历待补全/);
  const cross=fixture({dateConfirmed:true,estimatedDate:'2026-12-30'}).projects[0];
  assert.match(deliveryCardMarkup(cross,{today:'2027-01-05'}),/已延期至少 1 个工作日/);
});

test('北京时间日界和日期校验：截止当天不逾期，跨月按工作日计算',()=>{
  assert.equal(todayDate('2026-10-31T16:00:00Z'),'2026-11-01');
  assert.equal(isDeliveryDate('2026-02-29'),false);assert.equal(isDeliveryDate('2028-02-29'),true);
  const p={closed:false};
  assert.equal(deliveryState(p,plan({dateConfirmed:true,estimatedDate:'2026-10-31'}),{today:'2026-10-31'}).kind,'due');
  const s=deliveryState(p,plan({dateConfirmed:true,estimatedDate:'2026-10-31'}),{today:'2026-11-02'});
  assert.equal(s.kind,'overdue');assert.equal(s.daysLate,1);
});

test('期望日期永不作为承诺交付日，旧确认但仅目标日期不会误报或破坏旧数据',()=>{
  const data=fixture({targetDate:'2025-01-01',estimatedDate:'',dateConfirmed:true});
  assert.equal(reconcileDelivery(data,{now}),true);assert.deepEqual(data.deliveryEvents,[]);
  assert.equal(node(data).delivery,undefined);assert.equal(deliveryState(data.projects[0],node(data),{today:'2026-10-28'}).kind,'none');
  assert.equal(createPersistence().validate(data),true);
  updateDelivery(data,'p','n',{targetDate:'2026-11-03'},{now});assert.equal(node(data).targetDate,'2026-11-03');
  assert.throws(()=>updateDelivery(data,'p','n',{dateConfirmed:true},{now}),/承诺交付日/);
});

test('正常日期不进入异常页；已确认承诺日当天提醒但未判逾期',()=>{
  const data=fixture();confirm(data,'2026-10-28');
  assert.equal(data.deliveryEvents[0].kind,'confirmed');assert.deepEqual(deliveryCases(data,{today:'2026-10-28'}),[]);
  assert.equal(deliveryState(data.projects[0],node(data),{today:'2026-10-28'}).kind,'due');
});

test('旧数据首次留档不伪造确认时间，逾期观察按承诺周期只记录一次',()=>{
  const data=fixture({estimatedDate:'2026-10-20',dateConfirmed:true});
  reconcileDelivery(data,{now});assert.deepEqual(data.deliveryEvents.map(e=>e.kind),['baseline','overdue']);
  assert.equal(data.deliveryEvents[0].at,now);assert.equal(data.deliveryEvents[1].at,now);
  const saved=copy(data);assert.equal(reconcileDelivery(data,{now:'2026-10-29T08:00:00Z'}),false);assert.deepEqual(data,saved);
  const [row]=deliveryCases(data,{today:'2026-10-28'});assert.equal(row.state.daysLate,6);assert.equal(row.events.length,2);
});

test('已确认延期需理由且原子拒绝；多次改期保留基线、每轮逾期观察与当时负责人',()=>{
  const data=fixture();confirm(data,'2026-10-25');
  const saved=copy(data);assert.throws(()=>updateDelivery(data,'p','n',{estimatedDate:'2026-11-01'},{now}),/理由/);assert.deepEqual(data,saved);
  updateDelivery(data,'p','n',{estimatedDate:'2026-11-01'},{now,reason:'验证范围增加',actor:'我'});
  assert.equal(node(data).delivery.baselineDate,'2026-10-25');assert.equal(node(data).delivery.committedDate,'2026-11-01');
  assert.equal(deliveryState(data.projects[0],node(data),{today:'2026-10-28'}).kind,'scheduled');assert.equal(deliveryCases(data,{today:'2026-10-28'}).length,1);
  node(data).owner='小张';reconcileDelivery(data,{now:'2026-11-03T08:00:00Z'});
  updateDelivery(data,'p','n',{estimatedDate:'2026-11-08'},{now:'2026-11-03T08:00:00Z',reason:'业务数据未补齐'});
  assert.equal(data.deliveryEvents.filter(e=>e.kind==='overdue').length,2);
  assert.equal(data.deliveryEvents.filter(e=>e.kind==='rescheduled').length,2);
  assert.equal(data.deliveryEvents.find(e=>e.kind==='rescheduled').owner,'小李');
  assert.equal(data.deliveryEvents.at(-1).owner,'小张');assert.equal(node(data).delivery.baselineDate,'2026-10-25');
});

test('提前、撤销确认、清空日期和重新确认都有记录，撤销后不能无理由绕过改期',()=>{
  const data=fixture();confirm(data,'2026-11-10');
  updateDelivery(data,'p','n',{targetDate:'2026-11-20'},{now});assert.equal(data.deliveryEvents.length,1);
  updateDelivery(data,'p','n',{estimatedDate:'2026-11-05'},{now,reason:'提前完成准备'});assert.equal(data.deliveryEvents.at(-1).kind,'advanced');
  assert.throws(()=>updateDelivery(data,'p','n',{dateConfirmed:false},{now}),/理由/);
  updateDelivery(data,'p','n',{dateConfirmed:false},{now,reason:'重新确认资源'});assert.equal(data.deliveryEvents.at(-1).kind,'withdrawn');
  updateDelivery(data,'p','n',{estimatedDate:'2026-11-06'},{now,reason:'确认前先调整草案'});assert.equal(deliveryState(data.projects[0],node(data),{today:'2026-10-28'}).date,'2026-11-06');
  assert.throws(()=>updateDelivery(data,'p','n',{estimatedDate:''},{now}),/理由/);
  updateDelivery(data,'p','n',{estimatedDate:''},{now,reason:'暂未确定新日期'});assert.equal(deliveryState(data.projects[0],node(data),{today:'2026-11-30'}).kind,'none');assert.equal(deliveryState(data.projects[0],node(data),{today:'2026-11-30'}).date,'');
  updateDelivery(data,'p','n',{estimatedDate:'2026-12-01',dateConfirmed:true},{now,reason:'已确认新资源'});
  assert.equal(node(data).delivery.baselineDate,'2026-11-10');assert.equal(node(data).delivery.committedDate,'2026-12-01');assert.equal(data.deliveryEvents.at(-1).kind,'reconfirmed');
});

test('迟交后保留档案，恢复未交付需要理由；实际交付不能填未来',()=>{
  const data=fixture();confirm(data,'2026-10-26');
  assert.throws(()=>updateDelivery(data,'p','n',{completedAt:'2026-10-29'},{now}),/晚于今天/);
  updateDelivery(data,'p','n',{completedAt:'2026-10-28'},{now});
  let s=deliveryState(data.projects[0],node(data),{today:'2026-11-01'});assert.equal(s.kind,'delivered');assert.equal(s.daysLate,2);
  assert.equal(deliveryCases(data,{today:'2026-11-01'}).length,1);
  assert.throws(()=>updateDelivery(data,'p','n',{completedAt:''},{now}),/理由/);
  updateDelivery(data,'p','n',{completedAt:''},{now,reason:'交付需要重新验收'});s=deliveryState(data.projects[0],node(data),{today:'2026-10-28'});assert.equal(s.kind,'overdue');
});

test('明确完成的旧计划不会误报；不知道完成日期时保留空值，撤销完成后可恢复追踪',()=>{
  const data=fixture({estimatedDate:'2026-10-01',dateConfirmed:true,status:'done'});reconcileDelivery(data,{now});
  assert.equal(deliveryState(data.projects[0],node(data),{today:'2026-10-28'}).kind,'delivered');assert.equal(node(data).delivery.completedAt,'');assert.equal(data.deliveryEvents.length,1);
  updateDelivery(data,'p','n',{completedAt:''},{now,reason:'完成状态有误'});assert.equal(deliveryState(data.projects[0],node(data),{today:'2026-10-28'}).kind,'overdue');
  const withDate=fixture({estimatedDate:'2026-10-01',dateConfirmed:true,status:'finished',actualFinish:'2026-09-30T12:00:00Z'});reconcileDelivery(withDate,{now});assert.equal(node(withDate).delivery.completedAt,'2026-09-30');
});

test('正常按期交付不进入异常页；结束项目停止提醒，历史仍存，恢复项目可重新提醒',()=>{
  const normal=fixture();confirm(normal,'2026-10-29');updateDelivery(normal,'p','n',{completedAt:'2026-10-28'},{now});assert.equal(deliveryCases(normal,{today:'2026-11-01'}).length,0);
  const data=fixture();confirm(data,'2026-10-20');data.projects[0].closed=true;
  assert.equal(deliveryState(data.projects[0],node(data),{today:'2026-10-28'}).kind,'closed');assert.equal(deliveryCases(data,{today:'2026-10-28'}).length,1);
  data.projects[0].closed=false;assert.equal(deliveryState(data.projects[0],node(data),{today:'2026-10-28'}).kind,'overdue');
});

test('移除有承诺的计划需理由，计划和项目删除后异常档案仍可索引',()=>{
  const data=fixture();confirm(data,'2026-11-10');const saved=copy(data);
  assert.throws(()=>removeDeliveryNode(data,'p','n',{now}),/理由/);assert.deepEqual(data,saved);
  removeDeliveryNode(data,'p','n',{now,reason:'合并到新计划'});assert.equal(data.projects[0].planNodes.length,0);
  let rows=deliveryCases(data,{today:'2026-10-28'});assert.equal(rows.length,1);assert.equal(rows[0].removed,true);assert.equal(rows[0].nodeTitle,'交付版本');
  data.projects=[];rows=deliveryCases(data,{today:'2026-10-28'});assert.equal(rows[0].projectName,'项目甲');assert.equal(rows[0].project,null);
});

test('多节点独立统计，不重复同一项目节点；非法日期和事件拒绝保存',()=>{
  const data=fixture({estimatedDate:'2026-10-20',dateConfirmed:true});data.projects[0].planNodes.push(plan({id:'other',estimatedDate:'2026-10-23',dateConfirmed:true}));
  reconcileDelivery(data,{now});const rows=deliveryCases(data,{today:'2026-10-28'});assert.equal(rows.length,2);assert.equal(new Set(rows.map(r=>r.key)).size,2);
  const saved=copy(data);assert.throws(()=>updateDelivery(data,'p','n',{estimatedDate:'2026-02-30'},{now,reason:'日期修改'}));assert.deepEqual(data,saved);
  const invalid=copy(data);invalid.deliveryEvents[0].toDate='x';assert.throws(()=>createPersistence().validate(invalid));
  const duplicate=copy(data);duplicate.deliveryEvents.push(copy(duplicate.deliveryEvents[0]));assert.throws(()=>validateDelivery(duplicate));
});

test('保存重载与快照保留全历史；peekUndo为拷贝，撤销转换在写入前验证且失败不pop',()=>{
  const prior=globalThis.localStorage,disk=new Map();let fail=false;
  const backend={getItem:k=>disk.get(k)??null,setItem:(k,v)=>{if(fail)throw Error('disk full');disk.set(k,v);}};globalThis.localStorage=backend;
  try{
    const data=fixture(),store=createPersistence({key:'delivery-test'});store.commit(data);confirm(data);store.commit(data);
    const previous=store.peekUndo();previous.projects[0].name='污染';assert.equal(store.peekUndo().projects[0].name,'项目甲');
    assert.deepEqual(createPersistence({key:'delivery-test'}).load(fixture()).data,data);
    const snap=createSnapshotStore({key:'delivery-snaps',storage:backend,idFactory:()=> 's',now:()=>now});const item=snap.capture('交付记录',data);assert.deepEqual(JSON.parse(snap.export(item.id)).data,data);
    assert.throws(()=>store.undo({transform:d=>({...d,schemaVersion:9})}));assert.equal(store.canUndo(),true);
    fail=true;assert.throws(()=>store.undo({transform:d=>({...d,deliveryEvents:copy(data.deliveryEvents)})}));assert.equal(store.canUndo(),true);fail=false;
    const undone=store.undo({transform:d=>({...d,deliveryEvents:copy(data.deliveryEvents)})});assert.deepEqual(undone.deliveryEvents,data.deliveryEvents);assert.equal(store.canUndo(),false);assert.deepEqual(JSON.parse(disk.get('delivery-test')),undone);
  }finally{if(prior===undefined)delete globalThis.localStorage;else globalThis.localStorage=prior;}
});

 test('项目结束与恢复记录生命周期但不伪造交付，不主动展示正常项目',()=>{
  const data=fixture();confirm(data,'2026-11-01');let before=copy(data);data.projects[0].closed=true;
  assert.equal(recordDeliveryLifecycle(data,before,{now}),true);assert.equal(data.deliveryEvents.at(-1).kind,'projectClosed');assert.equal(node(data).delivery.completedAt,'');assert.equal(deliveryCases(data,{today:'2026-10-28'}).length,0);
  before=copy(data);data.projects[0].closed=false;recordDeliveryLifecycle(data,before,{now});assert.equal(data.deliveryEvents.at(-1).kind,'projectReopened');assert.equal(recordDeliveryLifecycle(data,data,{now}),false);
 });

test('同时撤销确认与修改拟定日期展示新草案，旧承诺及基线仍保留档案',()=>{
  const data=fixture();confirm(data,'2026-11-01');
  updateDelivery(data,'p','n',{dateConfirmed:false,estimatedDate:'2026-11-08'},{now,reason:'新排期仍待确认'});
  const state=deliveryState(data.projects[0],node(data),{today:'2026-10-28'});
  assert.equal(state.kind,'draft');assert.equal(state.date,'2026-11-08');assert.equal(state.baselineDate,'2026-11-01');
  assert.equal(node(data).delivery.committedDate,'2026-11-01');assert.equal(data.deliveryEvents.at(-1).kind,'withdrawn');assert.equal(data.deliveryEvents.at(-1).toDate,'2026-11-08');
  updateDelivery(data,'p','n',{estimatedDate:''},{now,reason:'暂不确定新排期'});assert.equal(deliveryState(data.projects[0],node(data),{today:'2026-10-28'}).date,'');
});
