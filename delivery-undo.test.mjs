import test from 'node:test';
import assert from 'node:assert/strict';
import {previewDeliveryUndo,applyDeliveryUndo} from './delivery-undo.js';
import {updateDelivery,reconcileDelivery,removeDeliveryNode,deliveryCases,validateDelivery} from './delivery-model.js';
import {createPersistence} from './persistence.js';
import {createSnapshotStore} from './snapshot-store.js';
import {renderSnapshotPreview} from './snapshot-preview.js';

const clone=value=>JSON.parse(JSON.stringify(value));
const now='2026-10-28T04:00:00.000Z';
const options={now,actor:'验收记录人'};
const fixture=()=>({schemaVersion:2,sourceDetachedVersion:1,projects:[{id:'p',name:'交付项目',closed:false,tagIds:[],materials:[],planNodes:[{id:'n',title:'验证交付',owner:'负责人',estimatedDate:'2026-11-01',targetDate:'',dateConfirmed:false}]}],tags:[],relations:[],frames:[],instances:[],view:{x:0,y:0,z:1}});
const confirm=data=>updateDelivery(data,'p','n',{dateConfirmed:true},options);
const node=data=>data.projects[0].planNodes[0];

test('普通内容撤销不需理由，保留当前全部交付事件和元数据，不污染输入',()=>{
  const current=fixture();confirm(current);const candidate=clone(current);
  candidate.deliveryEvents=[];candidate.projects[0].name='旧标题';delete node(candidate).delivery;
  const before=clone(current),older=clone(candidate);
  assert.equal(previewDeliveryUndo(current,candidate).requiresReason,false);
  const result=applyDeliveryUndo(current,candidate,options);
  assert.equal(result.projects[0].name,'旧标题');assert.deepEqual(result.deliveryEvents,current.deliveryEvents);
  assert.deepEqual(node(result).delivery,node(current).delivery);assert.deepEqual(current,before);assert.deepEqual(candidate,older);
});

test('撤销改期必须填理由，形成新记录且原承诺与原有事件保持不变',()=>{
  const current=fixture();confirm(current);const candidate=clone(current);
  updateDelivery(current,'p','n',{estimatedDate:'2026-11-07'},{...options,reason:'验证环境延迟'});
  const before=clone(current),preview=previewDeliveryUndo(current,candidate);
  assert.equal(preview.requiresReason,true);assert.equal(preview.changes[0].fromDate,'2026-11-07');assert.equal(preview.changes[0].toDate,'2026-11-01');
  assert.throws(()=>applyDeliveryUndo(current,candidate,options),/理由/);assert.deepEqual(current,before);
  const result=applyDeliveryUndo(current,candidate,{...options,reason:'排期误填，恢复已确认日期'});
  assert.equal(node(result).estimatedDate,'2026-11-01');assert.equal(node(result).delivery.committedDate,'2026-11-01');assert.equal(node(result).delivery.baselineDate,'2026-11-01');
  assert.deepEqual(result.deliveryEvents.slice(0,current.deliveryEvents.length),current.deliveryEvents);
  assert.equal(result.deliveryEvents.at(-1).kind,'undo');assert.equal(result.deliveryEvents.at(-1).reason,'排期误填，恢复已确认日期');assert.equal(validateDelivery(result),true);
});

test('撤销首次确认不会制造期望日期承诺，也不抹掉首次留档',()=>{
  const current=fixture(),candidate=clone(current);node(candidate).estimatedDate='';node(candidate).targetDate='2026-10-01';node(candidate).dateConfirmed=true;
  confirm(current);
  const result=applyDeliveryUndo(current,candidate,{...options,reason:'仍需进一步对齐，撤回承诺'});
  assert.equal(node(result).dateConfirmed,false);assert.equal(node(result).estimatedDate,'');assert.equal(node(result).targetDate,'2026-10-01');
  assert.equal(node(result).delivery.baselineDate,'2026-11-01');assert.equal(result.deliveryEvents[0].kind,'confirmed');assert.equal(result.deliveryEvents.at(-1).kind,'undo');
});

test('撤销到待确认日期时保留上次承诺，不把草案当作确认承诺',()=>{
  const current=fixture();confirm(current);const candidate=clone(current);
  node(candidate).estimatedDate='2026-11-09';node(candidate).dateConfirmed=false;
  const result=applyDeliveryUndo(current,candidate,{...options,reason:'日期还需重新对齐'});
  assert.equal(node(result).estimatedDate,'2026-11-09');assert.equal(node(result).dateConfirmed,false);
  assert.equal(node(result).delivery.committedDate,'2026-11-01');assert.equal(node(result).delivery.baselineDate,'2026-11-01');
});

test('撤销删除恢复项目和节点时追加恢复记录，旧延期和删除记录均存档',()=>{
  const current=fixture();node(current).estimatedDate='2026-10-25';confirm(current);reconcileDelivery(current,options);const candidate=clone(current);
  removeDeliveryNode(current,'p','n',{...options,reason:'合并计划'});current.projects=[];
  assert.equal(previewDeliveryUndo(current,candidate).changes[0].action,'恢复交付计划');
  const result=applyDeliveryUndo(current,candidate,{...options,reason:'误删，恢复跟进'});
  assert.equal(node(result).delivery.baselineDate,'2026-10-25');
  for(const kind of ['overdue','removed','restored'])assert.ok(result.deliveryEvents.some(event=>event.kind===kind));
  assert.equal(deliveryCases(result,{today:'2026-10-28'})[0].state.kind,'overdue');
});

test('撤销新建而移除已留档计划需要理由，已删除项目仍可索引历史',()=>{
  const current=fixture();confirm(current);const candidate={...fixture(),projects:[]};
  assert.throws(()=>applyDeliveryUndo(current,candidate,options),/理由/);
  const result=applyDeliveryUndo(current,candidate,{...options,reason:'重复录入，取消该项'});
  assert.equal(result.projects.length,0);assert.equal(result.deliveryEvents.at(-1).kind,'undo');
  const [row]=deliveryCases(result,{today:'2026-10-28'});assert.equal(row.projectName,'交付项目');assert.equal(row.removed,true);
});

test('撤销交付记录回到未交付，完成标记和日期都被调整且原交付仍留档',()=>{
  const current=fixture();confirm(current);const candidate=clone(current);
  updateDelivery(current,'p','n',{completedAt:'2026-10-28'},options);
  const result=applyDeliveryUndo(current,candidate,{...options,reason:'验收未通过，继续跟进'});
  assert.equal(node(result).delivery.completed,false);assert.equal(node(result).delivery.completedAt,'');
  assert.ok(result.deliveryEvents.some(event=>event.kind==='delivered'));assert.equal(result.deliveryEvents.at(-1).kind,'undo');
});

test('undo transform 校验失败不先擦写存档，成功则原子保存新记录',()=>{
  const prior=globalThis.localStorage,disk=new Map();globalThis.localStorage={getItem:key=>disk.get(key)??null,setItem:(key,value)=>disk.set(key,value)};
  try{
    const store=createPersistence({key:'undo-delivery'}),current=fixture();confirm(current);store.commit(current);
    updateDelivery(current,'p','n',{estimatedDate:'2026-11-03'},{...options,reason:'依赖推迟'});store.commit(current);
    const raw=disk.get('undo-delivery');assert.equal(previewDeliveryUndo(current,store.peekUndo()).requiresReason,true);
    assert.throws(()=>store.undo({transform:candidate=>applyDeliveryUndo(current,candidate,options)}),/理由/);
    assert.equal(disk.get('undo-delivery'),raw);assert.equal(store.canUndo(),true);
    const result=store.undo({transform:candidate=>applyDeliveryUndo(current,candidate,{...options,reason:'纠正录入'})});
    assert.equal(result.deliveryEvents.at(-1).kind,'undo');assert.deepEqual(JSON.parse(disk.get('undo-delivery')),result);
  }finally{if(prior===undefined)delete globalThis.localStorage;else globalThis.localStorage=prior;}
});

test('快照只展示已留档异常，保留已删除节点历史与转义，后续修改不改变快照',()=>{
  const data=fixture();confirm(data);const make=value=>({id:'s',name:'交付回看',createdAt:now,data:value});
  assert.doesNotMatch(renderSnapshotPreview(make(data)),/交付变更留档/);
  updateDelivery(data,'p','n',{estimatedDate:'2026-11-07'},{...options,reason:'依赖 <img src=x onerror=alert(1)> 推迟'});
  removeDeliveryNode(data,'p','n',{...options,reason:'合并后保留历史'});
  const disk=new Map(),storage={getItem:key=>disk.get(key)??null,setItem:(key,value)=>disk.set(key,value)},store=createSnapshotStore({storage,idFactory:()=> 's',now:()=>now});
  store.capture('交付回看',data);const html=renderSnapshotPreview(store.read('s'));
  assert.match(html,/交付变更留档/);assert.match(html,/计划已移除/);assert.match(html,/验证交付/);assert.match(html,/延期改期/);assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);assert.doesNotMatch(html,/<img/);
  data.deliveryEvents.at(-1).reason='后来的修改';assert.equal(renderSnapshotPreview(store.read('s')),html);
  assert.equal(JSON.parse(store.export('s')).data.deliveryEvents.at(-1).reason,'合并后保留历史');
});
