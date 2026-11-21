import test from 'node:test';
import assert from 'node:assert/strict';
import {detailLayout,detailSectionTitle,visibleDetailSections,moveDetailSection,setDetailSectionHidden,renameDetailSection,removeCustomSection,restoreCustomSection} from './project-detail-layout.js';
import {createPersistence} from './persistence.js';

const copy=value=>JSON.parse(JSON.stringify(value));
const project=()=>({id:'p',name:'原标题',tagIds:[],planNodes:[],materials:[{id:'m',title:'原资料',url:'https://example.com/source'}],description:'原问题',result:'原成果',comments:[{id:'c',body:'原记录',createdAt:''}],customSections:[{id:'s1',title:'业务背景',body:'原内容'},{id:'s2',title:'数据',body:'数据内容'}]});
const fixture=()=>({schemaVersion:2,projects:[project()],tags:[],relations:[],frames:[],instances:[],view:{x:0,y:0,z:1}});

test('旧项目无需迁移，默认问题陈述第一，未结束成果不在可用栏目中',()=>{
  const p=project(),before=copy(p),available=['description','custom:s1','custom:s2','comments','materials'];
  assert.deepEqual(visibleDetailSections(p,available),available);
  assert.equal(detailLayout(p).order[0],'description');
  assert.equal(visibleDetailSections(p,available).includes('result'),false);
  assert.deepEqual(p,before);
  assert.equal(detailSectionTitle(p,'comments'),'评论池');
});

test('排序只跨可见栏目，隐藏栏目和暂未出现的成果保留位置',()=>{
  const p=project(),available=['description','result','custom:s1','custom:s2','comments','materials'];
  setDetailSectionHidden(p,'comments',true);
  assert.equal(moveDetailSection(p,'materials',-1,available),true);
  assert.deepEqual(visibleDetailSections(p,available),['description','result','custom:s1','materials','custom:s2']);
  const saved=copy(p.detailLayout);
  assert.equal(moveDetailSection(p,'description',-1,available),false);
  assert.equal(moveDetailSection(p,'custom:s2',1,available),false);
  assert.deepEqual(p.detailLayout,saved);
  const open=available.filter(key=>key!=='result');
  assert.equal(visibleDetailSections(p,open).includes('result'),false);
  assert.equal(visibleDetailSections(p,available).indexOf('result'),1);
  setDetailSectionHidden(p,'comments',false);
  assert.equal(visibleDetailSections(p,available).includes('comments'),true);
});

test('系统栏目隐藏和改名不改业务内容，问题陈述不可隐藏，清空名称恢复默认',()=>{
  const p=project(),before=copy(p);
  for(const key of ['comments','materials','result','parents','children','plans','history'])setDetailSectionHidden(p,key,true);
  assert.equal(setDetailSectionHidden(p,'description',true),false);
  assert.equal(setDetailSectionHidden(p,'custom:s1',true),false);
  renameDetailSection(p,'comments','  随手笔记  ');
  assert.equal(detailSectionTitle(p,'comments'),'随手笔记');
  renameDetailSection(p,'comments','');
  assert.equal(detailSectionTitle(p,'comments'),'评论池');
  const {detailLayout:layout,...content}=p;assert.deepEqual(content,before);
  assert.equal(layout.hidden.includes('description'),false);
});

test('删除及撤销只恢复目标自建栏目，保留期间的其他编辑与新增栏目',()=>{
  const p=project(),available=['description','custom:s1','custom:s2','comments','materials'];
  moveDetailSection(p,'custom:s1',1,available);
  const originalOrder=detailLayout(p).order,removed=removeCustomSection(p,'s1');
  assert.equal(p.customSections.some(section=>section.id==='s1'),false);
  assert.equal(detailLayout(p).order.includes('custom:s1'),false);
  p.description='期间更新';p.customSections.push({id:'s3',title:'追加',body:'新内容'});
  assert.equal(restoreCustomSection(p,removed),true);
  assert.equal(restoreCustomSection(p,removed),false);
  assert.equal(p.description,'期间更新');assert.equal(p.customSections.find(s=>s.id==='s3').body,'新内容');
  assert.deepEqual(p.customSections.find(s=>s.id==='s1'),removed.section);
  assert.equal(detailLayout(p).order.indexOf('custom:s1'),originalOrder.indexOf('custom:s1'));
  assert.equal(removeCustomSection(p,'missing'),null);
});

test('布局存储、重新加载和整体撤销，跨引用仍是同一份项目字段',()=>{
  const disk=new Map(),previous=globalThis.localStorage;
  try{
    globalThis.localStorage={getItem:key=>disk.get(key)??null,setItem:(key,value)=>disk.set(key,value)};
    const store=createPersistence(),original=fixture();store.commit(original);const data=copy(original),p=data.projects[0];
    renameDetailSection(p,'materials','参考材料');setDetailSectionHidden(p,'comments',true);
    moveDetailSection(p,'materials',-1,['description','custom:s1','custom:s2','comments','materials']);
    store.commit(data);const reloaded=createPersistence().load(fixture()).data;
    assert.deepEqual(reloaded,data);assert.deepEqual(detailLayout(reloaded.projects[0]),detailLayout(p));
    assert.deepEqual(store.undo(),original);
    assert.equal(Object.hasOwn(original.projects[0],'detailLayout'),false);
  }finally{if(previous===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous;}
});

test('布局校验拒绝错误形状、重复顺序及非文字标题，仍兼容旧档',()=>{
  const validate=createPersistence().validate;assert.equal(validate(fixture()),true);
  for(const layout of [null,[],{order:'description'},{hidden:[2]},{order:['description','description']},{hidden:['comments','comments']},{titles:[]},{titles:{comments:5}}]){
    const data=fixture();data.projects[0].detailLayout=layout;assert.throws(()=>validate(data));
  }
  const data=fixture();data.projects[0].detailLayout={order:['description'],hidden:[],titles:{comments:'笔记'}};assert.equal(validate(data),true);
});
