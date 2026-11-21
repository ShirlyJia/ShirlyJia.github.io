import test from 'node:test';
import assert from 'node:assert/strict';
import {referenceConnections,referenceCurve,referenceLinesMarkup,clonePlacement,removePlacement} from './canvas-references.js';
import {createPersistence} from './persistence.js';

const instance=(id,pid='p',x=0,y=0)=>({id,pid,x,y,context:'讨论备注',focus:true});
const box=(x=0,y=0)=>({x,y,w:282,h:166});
const frame=(id,members)=>({id,members});

test('只连接同项目的不同分组引用，不串联不同项目或同组副本',()=>{
  const instances=[instance('a'),instance('b'),instance('c','other')];
  const bounds={a:box(),b:box(500),c:box(1000)};
  assert.deepEqual(referenceConnections(instances,[frame('same',['a','b'])],bounds),[]);
  const links=referenceConnections(instances,[frame('one',['a']),frame('two',['b','c'])],bounds);
  assert.equal(links.length,1);assert.equal(links[0].pid,'p');assert.deepEqual([links[0].from,links[0].to],['a','b']);
});

test('多处分组用最短连接树，重复成员和同组副本不产生交叉网格',()=>{
  const instances=['a','a-copy','b','c','d'].map(id=>instance(id));
  const frames=[frame('one',['a','a-copy','a']),frame('two',['b']),frame('three',['c']),frame('four',['d'])];
  const bounds={a:box(), 'a-copy':box(300),b:box(600),c:box(1200),d:box(1800)};
  const before=JSON.stringify({instances,frames,bounds}),links=referenceConnections(instances,frames,bounds);
  assert.equal(links.length,3);assert.ok(links.some(line=>line.from==='a-copy'&&line.to==='b'));
  assert.equal(JSON.stringify({instances,frames,bounds}),before);
  assert.equal(new Set(links.map(line=>[line.from,line.to].sort().join(':'))).size,3);
});

test('自由区、跨多组和负坐标可连接；无有效可见边界的卡片不产生幽灵线',()=>{
  const instances=['a','b','c','bad'].map(id=>instance(id)),bounds=new Map([['a',box(-600,-100)],['b',box()],['c',box(600)],['bad',{...box(),w:NaN}]]);
  const links=referenceConnections(instances,[frame('one',['b','c']),frame('two',['c'])],bounds);
  assert.equal(links.length,2);assert.ok(links.some(line=>line.from==='a'));
  assert.ok(links.every(line=>line.from!=='bad'&&line.to!=='bad'));
  assert.ok(links.every(line=>!line.path.includes('NaN')));
});

test('曲线从卡片边缘出发，横纵布局均有效；标识转义且连线不抢鼠标',()=>{
  assert.match(referenceCurve(box(),box(600)),/^M 282 83 C/);
  assert.match(referenceCurve(box(),box(0,600)),/^M 141 166 C/);
  assert.equal(referenceCurve(box(),{...box(),h:Infinity}),'');
  const pid='p" onload="bad',html=referenceLinesMarkup([instance('a',pid),instance('b',pid)],[frame('f',['a'])],{a:box(),b:box(600)},{activePid:pid});
  assert.match(html,/is-active/);assert.match(html,/vector-effect="non-scaling-stroke"/);assert.match(html,/aria-hidden="true"/);
  assert.match(html,/p&amp;quot;|p&quot;/);assert.doesNotMatch(html,/ onload="bad/);
});

test('复制仅新增画板引用，保留局部重点和富文本，后续改备注不会改原引用',()=>{
  const original={...instance('source','p',100,200),richText:{context:'<p>备注</p>'}},before=JSON.stringify(original);
  const copy=clonePlacement(original,{id:'copy',placements:[original,instance('existing','p',136,236)]});
  assert.equal(copy.pid,original.pid);assert.equal(copy.x,172);assert.equal(copy.y,272);assert.equal(copy.focus,true);
  copy.richText.context='<p>新的本处备注</p>';assert.equal(JSON.stringify(original),before);
  assert.throws(()=>clonePlacement(original,{id:original.id}));assert.throws(()=>clonePlacement(original,{id:'copy',x:NaN}));
  assert.deepEqual(clonePlacement(original,{id:'target',x:-20,y:10}),{...original,id:'target',x:-20,y:10});
});

test('移除按位置 ID，只处理相应引用和分组成员；一次撤销完整还原',()=>{
  const previous=globalThis.localStorage,disk=new Map();
  globalThis.localStorage={setItem:(k,v)=>disk.set(k,v),getItem:k=>disk.get(k)??null};
  try{
    const original=instance('first'),copy={...instance('second','p',348,50),context:'这组的讨论'};
    const project={id:'p',name:'共享议题',description:'共享正文',result:'共享结果',tagIds:[],planNodes:[],materials:[]};
    const group=(id,members)=>({id,name:id,x:0,y:0,w:540,h:240,members});
    const data={schemaVersion:2,projects:[project],tags:[],relations:[],instances:[original,copy],
      frames:[group('a',['first','second']),group('b',['second'])],view:{x:0,y:0,z:1}};
    const before=structuredClone(data),store=createPersistence({key:'remove-placement'});
    store.commit(data);
    assert.equal(removePlacement(data,'second'),true);
    assert.equal(removePlacement(data,'second'),false);
    assert.deepEqual(data.instances,[before.instances[0]]);
    assert.deepEqual(data.frames.map(f=>f.members),[['first'],[]]);
    assert.deepEqual(data.projects,before.projects);
    store.commit(data);
    assert.deepEqual(store.undo(),before);
    assert.equal(store.canUndo(),false);
    assert.equal(removePlacement(data,'first'),true);
    assert.equal(data.instances.length,0);
    assert.deepEqual(data.projects,before.projects);
  }finally{if(previous===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous;}
});
