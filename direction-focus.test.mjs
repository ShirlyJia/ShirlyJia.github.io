import test from 'node:test';
import assert from 'node:assert/strict';
import {directionFocusModel} from './direction-focus.js';
import {parentCardMarkup} from './child-projects.js';

const project=(id,extra={})=>({id,name:id,kind:'project',closed:false,priority:'',...extra});
const relation=(main,child,extra={})=>({id:main+'-'+child,main,child,...extra});

test('方向包含多层小项目且每项只出现一次，循环、自关联和失效关联不会扩散',()=>{
  const data={projects:[project('a',{kind:'direction'}),project('b'),project('c'),project('d'),project('outside')],relations:[relation('a','b'),relation('a','c'),relation('b','d'),relation('c','d'),relation('d','a'),relation('a','a'),relation('a','missing')]};
  const before=JSON.stringify(data),model=directionFocusModel(data,'a');
  assert.deepEqual([...model.ids],['a','b','c','d']);
  assert.equal(model.rows.length,3);assert.equal(model.rows.find(r=>r.project.id==='d').depth,2);
  assert.equal(JSON.stringify(data),before);
});

test('跨方向共享小项目按当前方向计算，不牵连另一个主方向或复制项目事实',()=>{
  const shared=project('shared'),data={projects:[project('a',{kind:'direction'}),project('b',{kind:'direction'}),shared,project('b-only')],relations:[relation('a','shared',{context:'这里只跟进显存'}),relation('b','shared',{context:'这里只跟进记忆'}),relation('b','b-only')]};
  const a=directionFocusModel(data,'a'),b=directionFocusModel(data,'b');
  assert.equal(a.rows[0].project,shared);assert.equal(b.rows[0].project,shared);
  assert.equal(a.rows[0].relation.context,'这里只跟进显存');
  assert.equal(b.rows[0].relation.context,'这里只跟进记忆');
  assert.equal(a.ids.has('b'),false);assert.equal(a.ids.has('b-only'),false);
});

test('待确认关系沿层级标识；存在已确认路径时优先展示该路径',()=>{
  const data={projects:[project('a',{kind:'direction'}),project('draft'),project('confirmed'),project('shared'),project('nested')],relations:[relation('a','draft',{draft:true}),relation('draft','nested'),relation('a','shared',{draft:true}),relation('a','confirmed'),relation('confirmed','shared')]};
  const model=directionFocusModel(data,'a');
  assert.equal(model.rows.find(r=>r.project.id==='nested').draft,true);
  const shared=model.rows.find(r=>r.project.id==='shared');
  assert.equal(shared.draft,false);assert.equal(shared.parent.id,'confirmed');
});

test('已结束项目单独保留；解除关系、改类型和删除后没有陈旧聚焦结果',()=>{
  const data={projects:[project('a',{kind:'direction'}),project('open'),project('done',{closed:true,result:'节省20%显存'})],relations:[relation('a','open'),relation('a','done')]};
  let model=directionFocusModel(data,'a');
  assert.deepEqual(model.active.map(r=>r.project.id),['open']);assert.equal(model.closed[0].project.result,'节省20%显存');
  data.relations.pop();model=directionFocusModel(data,'a');assert.equal(model.closed.length,0);
  data.projects[0].kind='project';assert.equal(directionFocusModel(data,'a'),null);
  assert.equal(directionFocusModel(data,'missing'),null);
});

test('共享项目卡片优先提示当前方向归属，其他主项目仍可访问',()=>{
  const data={projects:[project('a',{name:'降显存'}),project('b',{name:'记忆能力'}),project('shared')],relations:[relation('a','shared'),relation('b','shared')]};
  const before=JSON.stringify(data),html=parentCardMarkup('shared',data,{preferredParent:'b'});
  assert.match(html,/<span class="card-parent-name">记忆能力<\/span>/);
  assert.match(html,/data-card-parent="a"/);assert.match(html,/data-card-parent="b"/);
  assert.equal(JSON.stringify(data),before);
});
