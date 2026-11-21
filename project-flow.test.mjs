import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readProjectFlow, validateProjectFlow, renameFlowNode, insertFlowNode,
  removeFlowNode, moveFlowNode, setFlowNodeClosing, setCurrentFlowNode, setProjectClosed
} from './project-flow.js';
import {isClosedProject, collectDirectionResults} from './workbench-model.js';
import {createPersistence} from './persistence.js';
import {createSnapshotStore} from './snapshot-store.js';

const copy = value => JSON.parse(JSON.stringify(value));
const project = (extra={}) => ({id:'p',name:'项目',tagIds:[],planNodes:[],materials:[],result:'已有成果',impact:'已有证据',...extra});
const fixture = () => ({schemaVersion:2,sourceDetachedVersion:1,
  projects:[project({closed:false}),project({id:'a',name:'方向甲',kind:'direction'}),project({id:'b',name:'方向乙',kind:'direction'})],
  tags:[],relations:[{id:'ra',main:'a',child:'p',context:'甲的关联'},{id:'rb',main:'b',child:'p',context:'乙的关联'}],
  frames:[],instances:[{id:'one',pid:'p',x:0,y:0},{id:'two',pid:'p',x:320,y:0}],view:{x:0,y:0,z:1}});

test('旧项目按显式结束状态提供默认节点，只读不迁移且不修改源记录',()=>{
  for (const [source,current] of [[project({closed:false,outcome:'已解决'}),'doing'],[project({closed:true}),'closed'],[project({outcome:'已解决'}),'closed']]) {
    const before=copy(source), flow=readProjectFlow(source);
    assert.deepEqual(flow.nodes.map(node=>node.title),['开始','进行中','已关闭']);
    assert.equal(flow.currentId,current); assert.deepEqual(source,before);
    flow.nodes[0].title='外部误改'; assert.equal(readProjectFlow(source).nodes[0].title,'开始');
  }
});

test('节点可自由改名增删移动，名称与位置不会自动结束项目，也不重置用户清空的流程',()=>{
  const p=project({closed:false,planNodes:[{id:'plan',title:'原计划'}]}), before=copy(p);
  renameFlowNode(p,'doing','补齐业务数据');
  const inserted=insertFlowNode(p,'doing',{title:'方案确认',idFactory:()=> 'review'});
  assert.equal(inserted.id,'review');assert.equal(inserted.closesProject,false);
  moveFlowNode(p,'closed',0);renameFlowNode(p,'start','已关闭');
  assert.equal(p.closed,false);assert.equal(p.flow.nodes[0].id,'closed');assert.equal(p.flow.currentId,'doing');
  for(const key of ['result','impact','planNodes'])assert.deepEqual(p[key],before[key]);
  for(const node of [...p.flow.nodes])removeFlowNode(p,node.id);
  assert.deepEqual(p.flow,{nodes:[],currentId:null}); assert.deepEqual(readProjectFlow(p),p.flow);
  insertFlowNode(p,null,{idFactory:()=> 'new'});assert.deepEqual(p.flow.nodes.map(node=>node.id),['new']);
  assert.equal(p.flow.currentId,null);assert.equal(p.closed,false);
});

test('选择具有结束标记的节点才结束，日期首次填入且重新推进不丢成果和历史日期',()=>{
  const p=project({closed:false,outcome:'交付观察中'});
  renameFlowNode(p,'closed','交接留档');moveFlowNode(p,'closed',0);
  setCurrentFlowNode(p,'closed',{date:'2026-10-28'});
  assert.equal(isClosedProject(p),true);assert.equal(p.closedAt,'2026-10-28');assert.equal(p.outcome,'交付观察中');
  setCurrentFlowNode(p,'start',{date:'2026-10-30'});
  assert.equal(isClosedProject(p),false);assert.equal(p.closedAt,'2026-10-28');
  setCurrentFlowNode(p,'closed',{date:'2026-11-02'});
  assert.equal(p.closedAt,'2026-10-28');assert.equal(p.result,'已有成果');assert.equal(p.impact,'已有证据');
});

test('删除或编辑当前节点只更改流程，当前移向相同结束语义的邻居，没有匹配则留空',()=>{
  const p=project({closed:false});removeFlowNode(p,'doing');
  assert.equal(p.flow.currentId,'start');assert.equal(p.closed,false);
  setCurrentFlowNode(p,'closed',{date:'2026-10-28'});removeFlowNode(p,'closed');
  assert.equal(p.flow.currentId,null);assert.equal(p.closed,true);
  setFlowNodeClosing(p,'start',true);assert.equal(p.closed,true);assert.equal(p.flow.currentId,null);
  setProjectClosed(p,false);assert.equal(p.flow.currentId,null);assert.equal(p.closed,false);
  setFlowNodeClosing(p,'start',false);assert.equal(p.closed,false);
});

test('成果里新建能直接结束，恢复与结束入口同步流程；主动结束空流程时只补一个结束节点',()=>{
  const ended=project();setProjectClosed(ended,true,{date:'2026-10-28'});
  assert.equal(isClosedProject(ended),true);assert.equal(ended.flow.currentId,'closed');assert.equal(ended.closedAt,'2026-10-28');
  setProjectClosed(ended,false);assert.equal(ended.flow.currentId,'doing');assert.equal(ended.closed,false);
  const empty=project({flow:{nodes:[],currentId:null}});
  setProjectClosed(empty,true,{date:'2026-10-28',idFactory:()=> 'only-close'});
  assert.deepEqual(empty.flow,{nodes:[{id:'only-close',title:'已关闭',closesProject:true}],currentId:'only-close'});
  setProjectClosed(empty,false);assert.equal(empty.flow.currentId,null);assert.equal(empty.flow.nodes.length,1);
});

test('错误名称、重复标识、悬空当前节点与错误日期被拒绝，失败操作不改变原记录',()=>{
  const validate=createPersistence().validate;
  const broken=[null,[],{}, {nodes:[],currentId:'missing'}, {nodes:[],currentId:undefined},
    {nodes:[{id:'n',title:'',closesProject:false}],currentId:null},
    {nodes:[{id:'n',title:'节点',closesProject:'yes'}],currentId:null},
    {nodes:[{id:'n',title:'节点',closesProject:false},{id:'n',title:'重复',closesProject:false}],currentId:null}];
  for(const flow of broken){assert.throws(()=>validateProjectFlow(flow));const data=fixture();data.projects[0].flow=flow;assert.throws(()=>validate(data));}
  assert.equal(validate(fixture()),true);assert.equal(validateProjectFlow(undefined),true);
  const p=project({closed:false}), before=copy(p);
  assert.throws(()=>renameFlowNode(p,'doing',' '));assert.deepEqual(p,before);
  assert.throws(()=>insertFlowNode(p,'doing',{idFactory:()=> 'start'}));assert.deepEqual(p,before);
  assert.throws(()=>setCurrentFlowNode(p,'closed',{date:'2026-02-30'}));assert.deepEqual(p,before);
  assert.equal(moveFlowNode(p,'doing',-1),false);assert.deepEqual(p,before);
});

test('同项目多处引用共享流程与结束状态，父方向成果各自引用同一条结果',()=>{
  const data=fixture();setCurrentFlowNode(data.projects[0],'closed',{date:'2026-10-28'});
  for(const parent of ['a','b']) {
    const [result]=collectDirectionResults(parent,data);assert.equal(result.closed,true);assert.equal(result.project.flow.currentId,'closed');
  }
  assert.equal(data.projects.length,3);assert.equal(data.instances.filter(item=>item.pid==='p').length,2);
  assert.equal(createPersistence().validate(data),true);
});

test('流程保存重载、撤销和快照导出保持用户改名及节点顺序',()=>{
  const previous=globalThis.localStorage,disk=new Map();
  const storage={getItem:key=>disk.get(key)??null,setItem:(key,value)=>disk.set(key,value)};
  globalThis.localStorage=storage;
  try {
    const data=fixture(),store=createPersistence({key:'flow-test'});store.commit(data);
    renameFlowNode(data.projects[0],'doing','业务对齐');insertFlowNode(data.projects[0],'doing',{title:'验证',idFactory:()=> 'verify'});
    store.commit(data);assert.deepEqual(createPersistence({key:'flow-test'}).load(fixture()).data,data);
    const snapshots=createSnapshotStore({key:'flow-snapshots',storage,idFactory:()=> 'snapshot',now:()=> '2026-10-28T00:00:00Z'});
    const snapshot=snapshots.capture('节点留存',data),before=copy(data);renameFlowNode(data.projects[0],'doing','后来调整');
    assert.deepEqual(JSON.parse(snapshots.export(snapshot.id)).data,before);
    assert.equal(store.undo().projects[0].flow,undefined);assert.equal(JSON.parse(disk.get('flow-test')).projects[0].flow,undefined);
  } finally {if(previous===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous;}
});
