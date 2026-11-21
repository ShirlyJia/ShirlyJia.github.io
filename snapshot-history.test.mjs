import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotCanvasModel,snapshotCardMarkup,snapshotFrameMarkup,snapshotDay} from './snapshot-canvas.js';
import {renderSnapshotProjectDetails,renderSnapshotRecords} from './snapshot-preview.js';

const project=(patch={})=>({id:'p',name:'共享项目',priority:'P0',description:'问题原文',tagIds:['t'],planNodes:[],materials:[],...patch});
const snapshot=(patch={})=>({id:'snapshot',name:'会前',createdAt:'2026-10-28T00:00:00Z',data:{schemaVersion:2,projects:[project()],tags:[{id:'t',name:'预测效果',color:'#6284a0'}],frames:[{id:'f',name:'原分组',x:-200,y:-100,w:700,h:500,members:['a']}],instances:[{id:'a',pid:'p',x:-180,y:-70,w:340},{id:'b',pid:'p',x:800,y:100}],relations:[],view:{x:20,y:30,z:.6},canvasItems:[{id:'note',type:'note',x:100,y:100,w:220,h:160,text:'保留便签',fontSize:18,color:'#fff3bf'},{id:'arrow',type:'arrow',x:500,y:500,x2:-250,y2:-120,color:'#6284a0',strokeWidth:2}],...patch}});

test('历史画板保留负坐标、重复引用、原尺寸与便签箭头；已结束项目只留在项目记录',()=>{
  const snap=snapshot();snap.data.projects.push(project({id:'closed',closed:true}));snap.data.instances.push({id:'c',pid:'closed',x:9999,y:9999});
  const before=JSON.stringify(snap),model=snapshotCanvasModel(snap);
  assert.equal(model.instances.length,2);assert.equal(model.instances[0].w,340);assert.equal(model.instances[0].x,-180);assert.equal(model.frames[0].x,-200);assert.equal(model.items.length,2);assert.ok(model.bounds.left<=-250);assert.ok(model.bounds.top<=-120);assert.ok(model.bounds.right<9999);assert.equal(JSON.stringify(snap),before);
  assert.match(renderSnapshotRecords(snap),/共享项目/);
});

test('历史卡片交付提示冻结在快照日期，跨北京时间日界计算',()=>{
  assert.equal(snapshotDay('2026-10-27T17:00:00Z'),'2026-10-28');
  const snap=snapshot({projects:[project({planNodes:[{id:'n',title:'验证',owner:'李',estimatedDate:'2026-10-29',dateConfirmed:true,status:'doing'}]})]});
  const before=JSON.stringify(snap),html=snapshotCardMarkup(snap.data.projects[0],snap.data.instances[0],snap);
  assert.match(html,/还剩 1 个工作日/);assert.doesNotMatch(html,/已延期/);assert.match(html,/2026-10-29/);assert.match(html,/2 处引用/);assert.match(html,/预测效果/);assert.equal(JSON.stringify(snap),before);
});

test('原卡片、分组、完整详情转义文字且不输出可编辑控件',()=>{
  const snap=snapshot({projects:[project({name:'<img onerror=alert(1)>',comments:[{id:'c',author:'甲',body:'完整评论'}],customSections:[{id:'s',title:'自定义',body:'保留详情'}]})]});
  const html=snapshotCardMarkup(snap.data.projects[0],{...snap.data.instances[0],context:'" onmouseover="bad'},snap)+snapshotFrameMarkup({...snap.data.frames[0],name:'<script>bad</script>'},snap.data)+renderSnapshotProjectDetails(snap,'p');
  assert.doesNotMatch(html,/<img|<script|<input|<textarea|contenteditable=/);assert.match(html,/&lt;img/);assert.match(html,/完整评论/);assert.match(html,/保留详情/);assert.match(html,/问题原文/);assert.equal(renderSnapshotProjectDetails(snap,'missing'),'');
});

test('旧快照没有便签或宽度字段仍可回看，空画板不伪造项目',()=>{
  const snap=snapshot({canvasItems:undefined,instances:[{id:'a',pid:'p',x:0,y:0}]});const model=snapshotCanvasModel(snap);assert.equal(model.items.length,0);assert.equal(model.instances.length,1);
  const empty=snapshotCanvasModel({data:{projects:[],frames:[],instances:[]}});assert.equal(empty.bounds,null);assert.equal(empty.instances.length,0);
});
