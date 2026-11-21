import test from 'node:test';
import assert from 'node:assert/strict';
import {orderedTags,renameTag,moveTag,tagFilterMarkup,mountTagEditor} from './tag-editor.js';
import {createPersistence} from './persistence.js';

const tags=()=>[{id:'r',name:'资源',rank:0,color:'#9b8671'},{id:'p',name:'预测',rank:1,color:'#6284a0'},{id:'k',name:'知识',rank:2,color:'#668777'}];
test('标签改名不改身份、颜色、顺序或原数据，中文空白和重复名有校验',()=>{
  const original=tags(),before=structuredClone(original),next=renameTag(original,'r','  资源与效率  ');
  assert.deepEqual(original,before);assert.deepEqual(next[0],{...before[0],name:'资源与效率'});
  for(const name of ['', '   ','预测','x'.repeat(41)])assert.throws(()=>renameTag(original,'r',name));
  assert.throws(()=>renameTag(original,'missing','新名字'));
  assert.throws(()=>renameTag([{...original[0],name:'Alpha'},original[1]],'p',' alpha '));
});
test('前后跨位拖拽按插入位置排序，rank归一且不修改原数组',()=>{
  const original=tags(),before=structuredClone(original);
  assert.deepEqual(moveTag(original,'k','r','before').map(t=>t.id),['k','r','p']);
  const next=moveTag(original,'r','k','after');assert.deepEqual(next.map(t=>t.id),['p','k','r']);assert.deepEqual(next.map(t=>t.rank),[0,1,2]);
  assert.deepEqual(moveTag(original,'r','r'),original);assert.deepEqual(moveTag(original,'missing','p'),original);assert.deepEqual(original,before);
  assert.deepEqual(orderedTags([original[2],original[0],original[1]]).map(t=>t.id),['r','p','k']);
});
test('改名和排序保存、回读、一次撤销；项目引用保持原样',()=>{
  const previous=globalThis.localStorage,disk=new Map();globalThis.localStorage={getItem:k=>disk.get(k)??null,setItem:(k,v)=>disk.set(k,v)};
  try{
    const initial={schemaVersion:2,projects:[{id:'p1',name:'项目',tagIds:['r','k'],planNodes:[],materials:[]}],tags:tags(),relations:[],frames:[],instances:[],canvasItems:[],view:{x:0,y:0,z:1}};
    const store=createPersistence();store.commit(initial,{recordHistory:false});
    const next={...initial,tags:moveTag(renameTag(initial.tags,'r','资源与效率'),'k','r','before')};store.commit(next);
    assert.deepEqual(createPersistence().load(initial).data,next);assert.deepEqual(next.projects,initial.projects);assert.deepEqual(store.undo(),initial);
  }finally{if(previous===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous;}
});
test('显示使用自定义顺序并转义名称，只复用原标签按钮',()=>{
  const html=tagFilterMarkup(moveTag(renameTag(tags(),'k','<知识>'),'k','r','before'),new Set(['r']),()=>'<span class="color-existing"></span>');
  assert.ok(html.indexOf('data-tag="k"')<html.indexOf('data-tag="r"'));assert.match(html,/&lt;知识&gt;/);assert.match(html,/双击改名 · 拖动排序/);
  assert.equal((html.match(/<button/g)||[]).length,3);assert.doesNotMatch(html,/data-move-tag/);
});

test('管理列表旧 DOM 不覆盖别处刚改的名称，只有真正输入过的草稿才提交',()=>{
  const previousDocument=globalThis.document,previousWindow=globalThis.window;
  globalThis.document={addEventListener(){}};globalThis.window={addEventListener(){}};
  try{
    let values=tags(),writes=0;const handlers=new Map(),messages=[];
    const input={dataset:{tagName:'r'},value:'资源',setAttribute(){},removeAttribute(){},matches:()=>true};
    const bar={querySelectorAll:()=>[],contains:()=>false,addEventListener(){}};
    const rows={querySelectorAll:()=>[input],addEventListener:(name,fn)=>handlers.set(name,fn)};
    const editor=mountTagEditor({bar,rows,getTags:()=>values,saveName:(id,value)=>{assert.equal(editor.flush(),true);values=renameTag(values,id,value);writes++;},reorder(){},toggle(){},renderBar(){},renderRows(){},notify:m=>messages.push(m)});
    values=renameTag(values,'r','资源与推理效率');
    assert.equal(editor.flush(),true);assert.equal(writes,0);assert.equal(input.value,'资源与推理效率');
    input.value='资源与成本';handlers.get('input')({target:input});assert.equal(editor.flush(),true);assert.equal(writes,1);assert.equal(values[0].name,'资源与成本');
    input.value='';handlers.get('input')({target:input});assert.equal(editor.flush(),false);assert.equal(writes,1);assert.equal(messages.at(-1),'标签名称不能为空');
  }finally{if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;}
});
