import test from 'node:test';
import assert from 'node:assert/strict';
import {moveFramesToEdge} from './frame-layers.js';
import {createSnapshotStore} from './snapshot-store.js';
import {snapshotCanvasModel} from './snapshot-canvas.js';
import {createPersistence} from './persistence.js';
import {renderSnapshotPreview} from './snapshot-preview.js';

const frame = (id, color='#e7e4db') => ({id,name:id,x:0,y:0,w:300,h:200,members:[],color});
const ids = frames => frames.map(frame=>frame.id);

test('置顶或置底只改变分组顺序，保留多选内部顺序和全部原对象',()=>{
  const frames=['a','b','c','d'].map(id=>frame(id)),before=structuredClone(frames);
  const top=moveFramesToEdge(frames,['c','a'],'front');
  assert.deepEqual(ids(top),['b','d','a','c']);
  const bottom=moveFramesToEdge(frames,new Set(['d','b']),'back');
  assert.deepEqual(ids(bottom),['b','d','a','c']);
  assert.deepEqual(frames,before);
  for (const entry of top) assert.equal(entry,frames.find(original=>original.id===entry.id));
});

test('空选择、未知标识及已在目标位置保持顺序；重复标识不会复制分组',()=>{
  const frames=['a','b','c'].map(id=>frame(id));
  assert.deepEqual(ids(moveFramesToEdge(frames,[])),['a','b','c']);
  assert.deepEqual(ids(moveFramesToEdge(frames,['missing'])),['a','b','c']);
  assert.deepEqual(ids(moveFramesToEdge(frames,['c','c'])),['a','b','c']);
  assert.deepEqual(ids(moveFramesToEdge(frames,'a','back')),['a','b','c']);
  assert.deepEqual(ids(moveFramesToEdge(frames,['a','b','c'],'back')),['a','b','c']);
  assert.throws(()=>moveFramesToEdge(frames,['a'],'invalid'),/层级/);
});

test('快照冻结当时分组颜色与层级，后续置顶和改色不改历史画板',()=>{
  const disk=new Map(),storage={getItem:key=>disk.get(key)??null,setItem:(key,value)=>disk.set(key,value)};
  const store=createSnapshotStore({storage,idFactory:()=> 'layers-snapshot',now:()=> '2026-10-29T04:00:00.000Z'});
  const data={schemaVersion:2,projects:[],tags:[],relations:[],instances:[],frames:[frame('a','#e8edf1'),frame('b','#e9eee7')],canvasItems:[],view:{x:0,y:0,z:1}};
  data.frames[0].backgroundColor='#eef2f5';
  data.frames=moveFramesToEdge(data.frames,['a'],'front');
  const saved=store.capture('分组层级',data);
  data.frames=moveFramesToEdge(data.frames,['a'],'back');data.frames[0].color='#eee7dd';data.frames[0].backgroundColor='#f3ede5';
  const model=snapshotCanvasModel(store.read(saved.id));
  assert.deepEqual(ids(model.frames),['b','a']);
  assert.equal(model.frames[1].color,'#e8edf1');
  assert.equal(model.frames[1].backgroundColor,'#eef2f5');
  assert.equal(Object.hasOwn(model.frames[0],'backgroundColor'),false);
  assert.deepEqual(ids(data.frames),['a','b']);
  const preview=renderSnapshotPreview(store.read(saved.id));
  assert.match(preview,/fill="color-mix\(in srgb,#eef2f5 35%,#fff\)"/);
  assert.match(preview,/fill="color-mix\(in srgb,#e9eee7 2.8%,#fff\)"/);
  assert.ok(preview.indexOf('<title>b</title>')<preview.indexOf('<title>a</title>'));
});


test('背景颜色与层级可保存、回读和整体撤销；非法背景不覆盖已存记录',()=>{
  const previous=globalThis.localStorage,disk=new Map();
  globalThis.localStorage={getItem:key=>disk.get(key)??null,setItem:(key,value)=>disk.set(key,value)};
  try {
    const store=createPersistence(),data={schemaVersion:2,projects:[],tags:[],relations:[],instances:[],frames:[frame('a'),frame('b')],canvasItems:[],view:{x:0,y:0,z:1}};
    const original=structuredClone(data);store.commit(data,{recordHistory:false});
    data.frames=moveFramesToEdge(data.frames,['a']);data.frames[1].backgroundColor='#eef2f5';store.commit(data);
    assert.deepEqual(createPersistence().load(original).data,data);
    assert.deepEqual(store.undo(),original);
    data.frames[1].backgroundColor='red;position:fixed';
    assert.throws(()=>store.commit(data),/backgroundColor/);
    assert.deepEqual(createPersistence().load(original).data,original);
  } finally {
    if(previous===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous;
  }
});
