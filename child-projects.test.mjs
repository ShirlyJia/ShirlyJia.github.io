import test from 'node:test';
import assert from 'node:assert/strict';
import {childBadgeMarkup,childProjectRows,childTreeMarkup,childSectionActionsMarkup,createChildProject,createChildRelation} from './child-projects.js';
import {createPersistence} from './persistence.js';
import {snapshotCardMarkup} from './snapshot-canvas.js';
import {createSnapshotStore} from './snapshot-store.js';
import {clonePlacement} from './canvas-references.js';

const project=(id,patch={})=>({id,name:id,kind:'direction',priority:'P0',description:'父项目问题',outcome:'已交付',closed:true,closedAt:'2026-10-28',tagIds:[],planNodes:[],materials:[],...patch});
const data=()=>({schemaVersion:2,projects:[project('parent'),project('another')],relations:[],tags:[],frames:[],instances:[],view:{x:0,y:0,z:1}});

test('新建小项目与关联一起构造，不继承父项目结果、优先级或关闭状态，也不写入原记录',()=>{
  const original=data(),before=JSON.stringify(original);
  const created=createChildProject(original,'parent',{id:'child',relationId:'rel',name:' 新建小项目 ',description:'独立问题'});
  assert.equal(JSON.stringify(original),before);assert.equal(created.project.name,'新建小项目');assert.equal(created.project.closed,false);assert.equal(created.project.priority,'');assert.equal(created.project.result,'');assert.deepEqual(created.project.tagIds,[]);assert.equal(created.project.flow.currentId,'start');
  assert.deepEqual([created.relation.main,created.relation.child,created.relation.draft],['parent','child',false]);
  const next={...original,projects:[...original.projects,created.project],relations:[created.relation]};assert.equal(createPersistence().validate(next),true);
});
test('同一子项目可关联多个主项目，始终只保留一份项目事实',()=>{
  const state=data(),created=createChildProject(state,'parent',{id:'child',relationId:'rel',name:'共享小项目'});state.projects.push(created.project);state.relations.push(created.relation);
  const before=JSON.stringify(state),second=createChildRelation(state,'another','child',{id:'other-rel',context:'不同关联说明'});
  assert.equal(JSON.stringify(state),before);assert.equal(state.projects.filter(p=>p.id==='child').length,1);assert.equal(second.context,'不同关联说明');assert.throws(()=>createChildRelation(state,'parent','child',{id:'duplicate'}),/已有关联/);assert.throws(()=>createChildRelation(state,'child','child',{id:'self'}),/自身/);
});
test('失败输入不留下孤立项目或半条关联，空标题与重复标识拒绝',()=>{
  const state=data(),before=JSON.stringify(state);
  for(const options of [{id:'new',relationId:'rel',name:'  '},{id:'parent',relationId:'rel',name:'新建'},{id:'new',relationId:'',name:'新建'}])assert.throws(()=>createChildProject(state,'parent',options));
  assert.throws(()=>createChildProject(state,'missing',{id:'new',relationId:'rel',name:'新建'}),/不存在/);assert.equal(JSON.stringify(state),before);
});
test('小项目徽标只在有子项时出现，标识转义且只读快照不产生编辑按钮',()=>{
  assert.equal(childBadgeMarkup(0,'parent'),'');assert.equal(childBadgeMarkup(NaN,'parent'),'');
  const badge=childBadgeMarkup(2,'parent" onclick="bad');assert.match(badge,/data-open-children="parent&quot;/);assert.doesNotMatch(badge,/onclick="bad/);assert.match(badge,/查看2 个小项目/);
  const readonly=childBadgeMarkup(3,'parent',{readonly:true});assert.doesNotMatch(readonly,/<button|data-open-children/);assert.match(readonly,/3 个小项目/);
  assert.match(childSectionActionsMarkup(),/child-create/);assert.match(childSectionActionsMarkup(),/relation-add-main/);
});
test('快照卡片使用角标，预览不再出现关联小项目文字',()=>{
  const state=data();state.relations.push({id:'rel',main:'parent',child:'another'});const snapshot={createdAt:'2026-10-29T00:00:00Z',data:state};
  const html=snapshotCardMarkup(state.projects[0],{id:'place',pid:'parent',context:''},snapshot);
  assert.match(html,/child-project-badge/);assert.doesNotMatch(html,/个关联小项目|data-open-children|<button/);
});

test('子项目树复用直接关联，去重并保留已结束子项，忽略自引用、缺失项目和孙项目',()=>{
  const state=data();state.projects.push(project('grandchild',{name:'<img src=x onerror=bad>'}));
  state.relations=[{main:'parent',child:'another',draft:true},{main:'parent',child:'another',draft:false},{main:'parent',child:'parent'},{main:'parent',child:'missing'},{main:'another',child:'grandchild'}];
  const before=JSON.stringify(state),rows=childProjectRows('parent',state);assert.equal(rows.length,1);assert.equal(rows[0].project,state.projects[1]);assert.equal(rows[0].draft,false);
  const html=childTreeMarkup(rows);assert.match(html,/data-tree-project="another"/);assert.match(html,/已结束/);assert.doesNotMatch(html,/grandchild|missing/);
  const childHTML=childTreeMarkup(childProjectRows('another',state));assert.match(childHTML,/&lt;img/);assert.doesNotMatch(childHTML,/<img/);assert.equal(JSON.stringify(state),before);
});

test('展开状态按卡片存储，副本独立；快照冻结展开状态和子项标题，不改项目事实',()=>{
  const state=data();state.instances=[{id:'one',pid:'parent',x:0,y:0,childrenExpanded:true}];state.relations=[{id:'rel',main:'parent',child:'another'}];
  const copy=clonePlacement(state.instances[0],{id:'two'});state.instances.push(copy);copy.childrenExpanded=false;
  assert.equal(state.instances[0].childrenExpanded,true);assert.equal(createPersistence().validate(state),true);
  const disk=new Map(),store=createSnapshotStore({storage:{getItem:key=>disk.get(key)??null,setItem:(key,value)=>disk.set(key,value)},idFactory:()=> 'tree'});
  const snap=store.capture('已展开',state);state.instances[0].childrenExpanded=false;state.projects[1].name='后来改名';
  const saved=store.read(snap.id),html=snapshotCardMarkup(saved.data.projects[0],saved.data.instances[0],saved),collapsed=snapshotCardMarkup(saved.data.projects[0],saved.data.instances[1],saved);
  assert.match(html,/child-project-tree/);assert.match(html,/data-pid="another"/);assert.match(html,/another/);assert.doesNotMatch(html,/后来改名|data-tree-project|data-tree-add/);assert.doesNotMatch(collapsed,/child-project-tree/);
  state.instances[0].childrenExpanded='true';assert.throws(()=>createPersistence().validate(state),/childrenExpanded/);
});
