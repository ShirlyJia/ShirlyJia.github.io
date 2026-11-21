import test from 'node:test';
import assert from 'node:assert/strict';
import {createPersistence} from './persistence.js';
import {createSnapshotStore} from './snapshot-store.js';
import {renderSnapshotPreview} from './snapshot-preview.js';

const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jH9kAAAAASUVORK5CYII=';
const html = `<p><strong>当时的结论</strong></p><img src="${image}" alt="验证截图" width="320">`;
const fixture = () => ({schemaVersion:2,sourceDetachedVersion:1,projectContentVersion:1,
  projects:[{id:'p',name:'原项目',description:'当时的结论\n[图片]',richText:{description:html,commentDraft:'<p>未发送的草稿</p>'},
    tagIds:[],materials:[],planNodes:[{id:'plan',note:'计划补充',richText:{note:'<em>计划补充</em>'}}],
    comments:[{id:'comment',body:'评论截图\n[图片]',createdAt:'2026-10-28T00:00:00Z',richText:{body:html}}],
    customSections:[{id:'section',title:'验证材料',body:'栏目截图\n[图片]',richText:{body:html}}]},
    {id:'q',name:'另一项目',tagIds:[],materials:[],planNodes:[]}],
  relations:[{id:'r',main:'p',child:'q',context:'关联说明',richText:{context:'<p>关联说明</p>'}}],
  tags:[],frames:[],instances:[{id:'i',pid:'p',x:0,y:0,context:'本处说明',richText:{context:'<p>本处说明</p>'}}],view:{x:0,y:0,z:1}});

test('富文本图片保存、重载与撤销保留同一内容；不改旧文字字段',()=>{
  const previous=globalThis.localStorage,disk=new Map();
  globalThis.localStorage={getItem:key=>disk.get(key)??null,setItem:(key,value)=>disk.set(key,value)};
  try {
    const store=createPersistence({key:'rich-test'}),data=fixture();
    store.commit(data);
    assert.deepEqual(store.load(fixture()).data,data);
    const changed=structuredClone(data);changed.projects[0].richText.description='<p>会后内容</p>';changed.projects[0].description='会后内容';
    store.commit(changed);
    assert.deepEqual(store.undo(),data);
    assert.deepEqual(JSON.parse(disk.get('rich-test')),data);
  } finally {if(previous===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous;}
});

test('图片超出保存配额时保留上次记录，并报告未保存',()=>{
  const previous=globalThis.localStorage,disk=new Map(),statuses=[];let blocked=false;
  globalThis.localStorage={getItem:key=>disk.get(key)??null,setItem(key,value){if(blocked)throw Error('QuotaExceededError');disk.set(key,value);}};
  try {
    const store=createPersistence({key:'rich-test',onStatus:status=>statuses.push(status)}),data=fixture();store.commit(data);
    const before=disk.get('rich-test');blocked=true;data.projects[0].richText.description+=html;
    assert.throws(()=>store.commit(data),/QuotaExceededError/);
    assert.equal(disk.get('rich-test'),before);assert.equal(statuses.at(-1).ok,false);
  } finally {if(previous===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous;}
});

test('旧记录仍有效；富文本 companion 拒绝无效形状及不支持的字段',()=>{
  const validate=createPersistence().validate;
  const targets=[data=>data.projects[0],data=>data.projects[0].comments[0],data=>data.projects[0].customSections[0],data=>data.projects[0].planNodes[0],data=>data.relations[0],data=>data.instances[0]];
  for(const target of targets){
    const old=fixture();delete target(old).richText;assert.equal(validate(old),true);
    for(const value of [null,[],42,'text',{unexpected:'<p>bad field</p>'}]){
      const bad=fixture();target(bad).richText=value;assert.throws(()=>validate(bad),/richText/);
    }
    const invalidValue=fixture(),object=target(invalidValue);object.richText[Object.keys(object.richText)[0]]=false;
    assert.throws(()=>validate(invalidValue),/必须是字符串/);
  }
});

test('快照独立保存全部富文本与图片，JSON 导出不依赖当前页面',()=>{
  const disk=new Map(),storage={getItem:key=>disk.get(key)??null,setItem:(key,value)=>disk.set(key,value)};
  const store=createSnapshotStore({storage,idFactory:()=> 'rich-snapshot',now:()=> '2026-10-28T00:00:00Z'});
  const original=fixture(),saved=store.capture('带图讨论',original);original.projects[0].richText.description='<p>修改后</p>';
  const exported=JSON.parse(store.export(saved.id));
  assert.deepEqual(exported.data,fixture());assert.ok(JSON.stringify(exported).includes(image));
  const before=JSON.stringify(exported),preview=renderSnapshotPreview(exported);
  assert.equal(JSON.stringify(exported),before);assert.match(preview,/当时的结论/);assert.match(preview,/rich-content/);
  assert.doesNotMatch(preview,/修改后/);
});

test('无 DOM 的预览安全降级为原文；不会输出未清洗的 HTML',()=>{
  const data=fixture();data.projects[0].description='安全原文 <保留字符>';
  data.projects[0].richText.description='<img src=x onerror="alert(1)"><script>alert(2)</script>';
  const preview=renderSnapshotPreview({id:'safe',name:'安全预览',data});
  assert.match(preview,/安全原文 &lt;保留字符&gt;/);assert.doesNotMatch(preview,/<script|onerror=|src=x/);
});
