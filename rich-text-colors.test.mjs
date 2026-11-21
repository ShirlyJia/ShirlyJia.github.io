import test from 'node:test';
import assert from 'node:assert/strict';
import {safeTextColor,richEditorMarkup} from './rich-text.js';
import {createPersistence} from './persistence.js';
import {colorChoices} from './color-presets.js';

test('文字颜色只接受可重建的纯色，不保留透明、脚本或其他 CSS',()=>{
  for(const [value,expected] of [['#45627D','#45627d'],['#aBc','#aabbcc'],['rgb(69, 98, 125)','#45627d'],['rgba(69,98,125,1)','#45627d'],['red','#ff0000'],['  #37352f  ','#37352f']])assert.equal(safeTextColor(value),expected);
  for(const value of ['',null,'transparent','currentColor','var(--secret)','url(https://example.com/x)','expression(alert(1))','#fff;background:url(x)','rgb(256,0,0)','rgb(-1,0,0)','rgba(0,0,0,0.5)','red;position:fixed'])assert.equal(safeTextColor(value),'');
  for(const choice of colorChoices('ink'))assert.equal(safeTextColor(choice.value),choice.value);
});

test('每个富文本区域提供完整工具栏，保留颜色与图片缩放',()=>{
  const html=richEditorMarkup({value:'原文字',label:'评论'});
  assert.equal((html.match(/data-rich-command="foreColor"/g)||[]).length,1);
  assert.match(html,/aria-label="文字颜色"/);assert.match(html,/aria-haspopup="menu"/);
  for(const command of ['link','image','undo','redo','formatPainter','textStyle','highlight','alignment','indentation','divider','table','code','emoji'])assert.ok(html.includes('data-rich-command="'+command+'"'));
  for(const command of ['bold','italic','insertOrderedList','insertUnorderedList','taskList','blockquote','resetImageSize'])assert.ok(html.includes('data-rich-command="'+command+'"'));
});

test('彩色文字随项目保存重载与撤销，纯文本搜索内容保持原样',()=>{
  const original=globalThis.localStorage,disk=new Map();globalThis.localStorage={getItem:k=>disk.get(k)??null,setItem:(k,v)=>disk.set(k,v)};
  try{
    const html='<p>普通文字 <span style="color: rgb(69, 98, 125)"><strong>重点</strong></span></p>';
    const data={schemaVersion:2,projects:[{id:'p',name:'原项目',description:'普通文字 重点',richText:{description:html},tagIds:[],materials:[],planNodes:[]}],tags:[],relations:[],frames:[],instances:[],view:{x:0,y:0,z:1}};
    const store=createPersistence();store.commit(data);assert.deepEqual(store.load(data).data,data);
    const next=structuredClone(data);next.projects[0].richText.description='<p>普通文字 <strong>重点</strong></p>';store.commit(next);
    assert.deepEqual(store.undo(),data);assert.equal(store.load(data).data.projects[0].description,'普通文字 重点');
  }finally{if(original===undefined)delete globalThis.localStorage;else globalThis.localStorage=original;}
});
