import test from 'node:test';
import assert from 'node:assert/strict';
import {MEETING_KEY, createMeetingStore, initialMeetings, validateMeetings, deleteMeeting, deletedMeetingFileIds} from './meetings.js';
import {removeMeetingItem, restoreMeetingItem, restoreMeetingById} from './meeting-trash.js';

const stamp = '2026-10-28T00:00:00.000Z';
const clone = value => JSON.parse(JSON.stringify(value));
const file = (id, fileId) => ({id,title:`附件 ${id}`,url:'',kind:'file',fileId,fileName:`${id}.txt`,mimeType:'text/plain',size:12,extra:{keep:true}});
function storageFor(data) {
  let raw = JSON.stringify(data);
  return {
    fail:false,
    getItem(key) { assert.equal(key,MEETING_KEY); return raw; },
    setItem(key,value) { assert.equal(key,MEETING_KEY); if(this.fail)throw Error('存储空间不足');raw=value; },
    raw:() => raw,
    replace(value) { raw=JSON.stringify(value); }
  };
}

test('旧记录加载补充回收站，迁移后删除、重载与恢复保留原 ID 和隐藏字段',()=>{
  const original=initialMeetings();delete original.meetingContentVersion;delete original.deletedItems;
  const meeting=original.meetings[0];meeting.notes='原记录';meeting.conclusions='已有结论';meeting.attendees='历史参与人';meeting.extra={preserve:'未展示信息'};
  const storage=storageFor(original),store=createMeetingStore(storage),loaded=store.load();
  assert.equal(loaded.error,null);assert.equal(loaded.migrated,true);assert.deepEqual(loaded.data.deletedItems,[]);
  assert.equal(loaded.data.meetings[0].notes,'原记录\n\n已有结论');
  const expected=clone(loaded.data.meetings[0]);
  deleteMeeting(loaded.data,expected.id,stamp);store.save(loaded.data);
  const next=createMeetingStore(storage),reloaded=next.load();
  assert.equal(reloaded.migrated,false);assert.equal(reloaded.data.meetings.length,0);
  assert.deepEqual(restoreMeetingById(reloaded.data,expected.id),expected);next.save(reloaded.data);
  assert.deepEqual(createMeetingStore(storage).load().data.meetings,[expected]);
});

test('先删附件再删会议后，备份仍包含所有文件；重载后按父子顺序恢复',()=>{
  const data=initialMeetings(),meeting=data.meetings[0];meeting.materials=[file('a','blob-a'),file('b','blob-b')];
  const second=clone(meeting);second.id='second';second.materials=[file('c','blob-c'),file('alias','blob-a')];data.meetings.push(second);
  const expected=clone(meeting),storage=storageFor(data),store=createMeetingStore(storage),draft=store.load().data;
  removeMeetingItem(draft,meeting.id,'material','b',{id:'trash-b',deletedAt:stamp});
  deleteMeeting(draft,meeting.id,stamp);store.save(draft);
  const reloaded=createMeetingStore(storage).load().data;
  assert.deepEqual(new Set(deletedMeetingFileIds(reloaded)),new Set(['blob-a','blob-b','blob-c']));
  assert.equal(deletedMeetingFileIds(reloaded).length,3);
  assert.throws(()=>restoreMeetingItem(reloaded,'trash-b'),/请先恢复所属会议/);
  restoreMeetingById(reloaded,meeting.id);restoreMeetingItem(reloaded,'trash-b');
  assert.equal(validateMeetings(reloaded),true);assert.deepEqual(reloaded.meetings[0],expected);
});

test('删除保存失败不会覆盖持久记录，内存回收站可重试并完整恢复',()=>{
  const original=initialMeetings(),storage=storageFor(original),store=createMeetingStore(storage),draft=store.load().data;
  const before=storage.raw(),meeting=draft.meetings[0],expected=clone(meeting);
  removeMeetingItem(draft,meeting.id,'material',meeting.materials[0].id,{id:'trash-link',deletedAt:stamp});
  storage.fail=true;assert.throws(()=>store.save(draft),/存储空间不足/);
  assert.equal(storage.raw(),before);assert.equal(draft.deletedItems[0].item.url,expected.materials[0].url);
  storage.fail=false;assert.equal(store.save(draft),true);
  const fresh=createMeetingStore(storage),reloaded=fresh.load().data;
  assert.equal(reloaded.meetings[0].materials.length,0);restoreMeetingItem(reloaded,'trash-link');fresh.save(reloaded);
  assert.deepEqual(createMeetingStore(storage).load().data.meetings[0],expected);
});

test('其他页面修改后拒绝覆盖删除草稿，损坏回收站读取失败不以初始数据覆盖',()=>{
  const original=initialMeetings(),storage=storageFor(original),store=createMeetingStore(storage),draft=store.load().data;
  deleteMeeting(draft,draft.meetings[0].id,stamp);
  const remote=clone(original);remote.meetings[0].notes='其他页面新增记录';storage.replace(remote);const savedRemote=storage.raw();
  assert.throws(()=>store.save(draft),/另一个页面/);assert.equal(storage.raw(),savedRemote);assert.equal(draft.deletedMeetings.length,1);
  const malformed=clone(original);malformed.deletedItems=[{id:'orphan',kind:'material',meetingId:'unknown',index:0,deletedAt:stamp,item:clone(original.meetings[0].materials[0])}];
  storage.replace(malformed);const malformedRaw=storage.raw(),blocked=createMeetingStore(storage),result=blocked.load();
  assert.equal(result.data,null);assert.match(result.error,/已删除资料格式无效/);assert.equal(blocked.original(),malformedRaw);
  assert.throws(()=>blocked.save(initialMeetings()),/停止覆盖保存/);assert.equal(storage.raw(),malformedRaw);
});
