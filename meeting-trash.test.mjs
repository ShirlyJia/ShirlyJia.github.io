import test from 'node:test';
import assert from 'node:assert/strict';
import {removeMeetingItem,restoreMeetingItem,restoreMeetingById} from './meeting-trash.js';

const clone = value => JSON.parse(JSON.stringify(value));
const stamp = '2026-10-28T09:00:00Z';
const fixture = () => ({schemaVersion:1,meetings:[{
  id:'m1',title:'原会议',category:'internal',notes:'原讨论\n与共识',
  materials:[{id:'a',title:'文件',url:'',kind:'file',fileId:'blob-a',fileName:'纪要.pdf',mimeType:'application/pdf',size:123,custom:'保留'}, {id:'b',title:'原文',url:'https://example.com/notes'}, {id:'c',title:'数据',url:'https://example.com/data'}],
  sections:[{id:'s1',title:'自定义栏目',body:'原始内容',color:'#aaa'}],projectIds:['p1']
}],deletedMeetings:[],unknown:'保留'});
const remove = (data,kind,id,trashId='trash-1') => removeMeetingItem(data,'m1',kind,id,{id:trashId,deletedAt:stamp});

test('删除资料保留文件引用与全部字段，恢复原索引；栏目与文件互不干扰',()=>{
  const data=fixture(),before=clone(data);
  const entry=remove(data,'material','b');
  assert.equal(entry.index,1);assert.equal(entry.deletedAt,stamp);assert.deepEqual(entry.item,before.meetings[0].materials[1]);
  assert.deepEqual(data.meetings[0].materials.map(x=>x.id),['a','c']);
  assert.equal(restoreMeetingItem(data,'trash-1'),entry);
  assert.deepEqual(data.meetings,before.meetings);assert.deepEqual(data.deletedItems,[]);
  remove(data,'material','a','file');remove(data,'section','s1','section');
  assert.equal(data.deletedItems[0].item.fileId,'blob-a');assert.equal(data.deletedItems[0].item.custom,'保留');
  restoreMeetingItem(data,'section');restoreMeetingItem(data,'file');assert.deepEqual(data.meetings,before.meetings);
  assert.equal(data.unknown,'保留');
});

test('可按标识恢复任意会议，缺失内容幂等返回null，缩短列表后安全恢复',()=>{
  const data=fixture();const original=clone(data.meetings[0]);
  data.meetings=[{id:'m2',materials:[]}];data.deletedMeetings=[{meeting:original,index:0,deletedAt:stamp},{meeting:{id:'m3',materials:[]},index:9,deletedAt:stamp}];
  assert.equal(restoreMeetingById(data,'m1').id,'m1');assert.deepEqual(data.meetings.map(m=>m.id),['m1','m2']);
  assert.equal(restoreMeetingById(data,'m3').id,'m3');assert.deepEqual(data.meetings.map(m=>m.id),['m1','m2','m3']);
  assert.equal(restoreMeetingById(data,'m3'),null);assert.equal(restoreMeetingItem(data,'missing'),null);assert.equal(remove(data,'material','missing'),null);
  remove(data,'material','c');data.meetings[0].materials=[];restoreMeetingItem(data,'trash-1');assert.equal(data.meetings[0].materials[0].id,'c');
});

test('先删资料再删会议：父会议恢复前拒绝恢复资料且不消耗删除记录',()=>{
  const data=fixture(),before=clone(data.meetings[0]);remove(data,'material','a');
  const [meeting]=data.meetings.splice(0,1);data.deletedMeetings.push({meeting,index:0,deletedAt:stamp});
  const blocked=clone(data);assert.throws(()=>restoreMeetingItem(data,'trash-1'),/请先恢复所属会议/);assert.deepEqual(data,blocked);
  restoreMeetingById(data,'m1');restoreMeetingItem(data,'trash-1');assert.deepEqual(data.meetings[0],before);
});

test('未知父会议、重复标识与损坏记录拒绝覆盖，失败后两边原数据完整',()=>{
  for(const scenario of [
    data=>{remove(data,'material','a');data.meetings=[];return ()=>restoreMeetingItem(data,'trash-1');},
    data=>{remove(data,'material','a');data.meetings[0].materials.push({id:'a',title:'用户新建的同标识资料',url:''});return ()=>restoreMeetingItem(data,'trash-1');},
    data=>{remove(data,'material','a');return ()=>remove(data,'section','s1');},
    data=>{data.deletedMeetings.push({meeting:clone(data.meetings[0]),index:0,deletedAt:stamp});return ()=>restoreMeetingById(data,'m1');},
    data=>{remove(data,'material','a');data.deletedItems[0].index=-1;return ()=>restoreMeetingItem(data,'trash-1');},
    data=>()=>removeMeetingItem(data,'unknown','material','a',{id:'bad',deletedAt:stamp}),
    data=>()=>remove(data,'unknown','a')
  ]){
    const data=fixture(),action=scenario(data),before=clone(data);assert.throws(action);assert.deepEqual(data,before);
  }
});

test('旧会议没有自定义栏目时可恢复栏目，不添加无意义空数组',()=>{
  const data=fixture();delete data.meetings[0].sections;
  assert.equal(remove(data,'section','missing'),null);assert.equal(data.deletedItems,undefined);
  data.deletedItems=[{id:'section',meetingId:'m1',kind:'section',item:{id:'s1',title:'重建栏目',body:'保留'},index:3,deletedAt:stamp}];
  restoreMeetingItem(data,'section');assert.deepEqual(data.meetings[0].sections,[{id:'s1',title:'重建栏目',body:'保留'}]);
});
