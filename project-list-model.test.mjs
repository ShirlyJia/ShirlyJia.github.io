import test from 'node:test';
import assert from 'node:assert/strict';
import {projectListGroups,listPreferences,matchesListFilters,moveListId,committedDate,UNGROUPED,NO_PRIORITY} from './project-list-model.js';

const project=(id,priority='')=>({id,name:id,priority,closed:false,planNodes:[]});
function fixture(){return {
  projects:[project('A','P1'),project('B','P0'),project('C'),project('D'),{...project('closed'),closed:true}],
  instances:[{id:'a1',pid:'A',x:100,y:20},{id:'a2',pid:'A',x:80,y:200},{id:'b',pid:'B',x:10,y:20},{id:'c',pid:'C',x:10,y:220},{id:'closed',pid:'closed',x:0,y:0}],
  frames:[{id:'second',name:'第二组',x:300,y:0,members:['a2','c']},{id:'first',name:'第一组',x:0,y:0,members:['a1','a2','b','closed','deleted']}]
};}
test('按画板分组和位置排序，组内去重、跨组共用，已结项目不进入列表',()=>{
  const data=fixture(),groups=projectListGroups(data);
  assert.deepEqual(groups.map(g=>g.id),['first','second',UNGROUPED]);
  assert.deepEqual(groups[0].rows.map(r=>r.project.id),['B','A']);
  assert.deepEqual(groups[1].rows.map(r=>r.project.id),['A','C']);
  assert.equal(groups[0].rows[1].project,groups[1].rows[0].project);
  assert.deepEqual(groups[2].rows.map(r=>r.project.id),['D']);
});
test('分组改名、移入移出和删除实时反映，不保存分组内容副本',()=>{
  const data=fixture();data.frames[0].name='已改名';data.frames[0].members=['c'];data.frames[1].members=['b'];
  let groups=projectListGroups(data);assert.equal(groups[1].name,'已改名');assert.deepEqual(groups.at(-1).rows.map(r=>r.project.id),['A','D']);
  data.frames=[];groups=projectListGroups(data);assert.deepEqual(groups[0].rows.map(r=>r.project.id),['A','B','C','D']);
});
test('组别与优先级可组合筛选，未分组按全部分组判定，删除的筛选组安全恢复全部',()=>{
  const data=fixture(),[a,b,c,d]=data.projects;
  assert.equal(matchesListFilters(a,data,{groupId:'second',priority:'P1'}),true);
  assert.equal(matchesListFilters(b,data,{groupId:'second',priority:'P0'}),false);
  assert.equal(matchesListFilters(c,data,{groupId:UNGROUPED,priority:NO_PRIORITY}),false);
  assert.equal(matchesListFilters(d,data,{groupId:UNGROUPED,priority:NO_PRIORITY}),true);
  assert.equal(matchesListFilters(a,data,{groupId:'removed'}),true);
});
test('优先级支持正反顺序，自定义优先级保留，未设置项始终排末尾',()=>{
  const data={projects:[project('none'),project('low','P2'),project('high','P0'),project('custom','特别关注')],frames:[],instances:[]};
  const values=descending=>projectListGroups(data,{sort:'priority',descending})[0].rows.map(r=>r.project.id);
  assert.deepEqual(values(false),['high','low','custom','none']);assert.deepEqual(values(true),['custom','low','high','none']);
});
test('交付排序只使用尚未交付且已确认的承诺日期，不用期望日替代，缺日期排末尾',()=>{
  const a=project('only-target'),b=project('later'),c=project('earlier');
  a.planNodes=[{id:'target',targetDate:'2026-01-01',estimatedDate:'2026-01-02',dateConfirmed:false}];
  b.planNodes=[{id:'b',estimatedDate:'2026-12-10',dateConfirmed:true}];
  c.planNodes=[{id:'c',estimatedDate:'2026-11-01',dateConfirmed:true}];
  assert.equal(committedDate(a),null);
  const data={projects:[a,b,c],frames:[],instances:[]};
  assert.deepEqual(projectListGroups(data,{sort:'delivery'})[0].rows.map(r=>r.project.id),['earlier','later','only-target']);
  assert.deepEqual(projectListGroups(data,{sort:'delivery',descending:true})[0].rows.map(r=>r.project.id),['later','earlier','only-target']);
});
test('手动排序保留隐藏项目与新项目，跨组分别记忆，不改画板坐标',()=>{
  const data=fixture(),before=JSON.stringify(data);
  const order=moveListId(['B','hidden','A'],'A','B');assert.deepEqual(order,['A','B','hidden']);
  const prefs={sort:'manual',groupOrder:['second','missing','first'],projectOrder:{first:['A','B'],second:['C','A']}};
  const groups=projectListGroups(data,prefs);assert.deepEqual(groups.map(g=>g.id),['second','first',UNGROUPED]);
  assert.deepEqual(groups[0].rows.map(r=>r.project.id),['C','A']);assert.deepEqual(groups[1].rows.map(r=>r.project.id),['A','B']);
  assert.equal(JSON.stringify(data),before);
  assert.deepEqual(projectListGroups(data,{...prefs,sort:'canvas'})[0].rows.map(r=>r.project.id),['B','A']);
  assert.equal(listPreferences(JSON.parse(JSON.stringify(prefs))).sort,'manual');
});
