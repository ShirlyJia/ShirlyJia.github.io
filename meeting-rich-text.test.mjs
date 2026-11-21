import test from 'node:test';
import assert from 'node:assert/strict';
import {createMeetingStore, initialMeetings, validateMeetings, deleteMeeting, restoreLastMeeting, meetingMatches, isBlankMeeting} from './meetings.js';

const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';
const clone=value=>JSON.parse(JSON.stringify(value));
function diskFor(data){let raw=JSON.stringify(data);return {fail:false,getItem:()=>raw,setItem(_key,value){if(this.fail)throw Error('存储空间不足');raw=value;},raw:()=>raw};}

test('会议富文本和内嵌图片随保存重载、删除恢复和导出记录完整留存',()=>{
  const data=initialMeetings(),meeting=data.meetings[0];
  meeting.notes='已验证的交付范围';meeting.followUp='周五补充评测';
  meeting.richText={notes:`<p><strong>已验证的交付范围</strong></p><p><img src="${image}" alt="评测结果" width="280"></p>`,followUp:'<ul><li>周五补充评测</li></ul>'};
  const expected=clone(meeting),disk=diskFor(data),store=createMeetingStore(disk),loaded=store.load();
  assert.equal(loaded.error,null);store.save(loaded.data);
  const next=createMeetingStore(disk),reloaded=next.load().data;
  assert.deepEqual(reloaded.meetings[0],expected);
  assert.equal(meetingMatches(reloaded.meetings[0],'交付范围'),true);
  deleteMeeting(reloaded,meeting.id,'2026-10-28T12:00:00Z');next.save(reloaded);
  const exported=JSON.parse(disk.raw());assert.deepEqual(exported.deletedMeetings[0].meeting.richText,expected.richText);
  assert.equal(restoreLastMeeting(exported),meeting.id);validateMeetings(exported);
  assert.deepEqual(exported.meetings[0],expected);
});

test('纯图片会议不是空会议；旧文字会议继续可读',()=>{
  const data=initialMeetings(),meeting=data.meetings[0];
  for(const key of ['title','date','notes','followUp'])meeting[key]='';meeting.materials=[];meeting.projectIds=[];
  assert.equal(isBlankMeeting(meeting),true);
  meeting.richText={notes:`<p><img src="${image}" alt="截图"></p>`};
  assert.equal(isBlankMeeting(meeting),false);
  delete meeting.richText;meeting.notes='旧版会议内容';
  const loaded=createMeetingStore(diskFor(data)).load();
  assert.equal(loaded.error,null);assert.equal(loaded.data.meetings[0].notes,'旧版会议内容');
  assert.equal(loaded.data.meetings[0].richText,undefined);
});

test('富文本结构错误阻止覆盖，容量不足保留已存内容和当前图片草稿',()=>{
  for(const value of [null,[],{notes:123},{title:'不是富文本字段'},JSON.parse('{"__proto__":"unsafe"}'),{notes:{html:'wrong'}}]){
    const data=initialMeetings();data.meetings[0].richText=value;
    assert.throws(()=>validateMeetings(data),/会议富文本格式无效/);
  }
  const original=initialMeetings(),disk=diskFor(original),store=createMeetingStore(disk),draft=store.load().data;
  const previous=disk.raw();draft.meetings[0].richText={notes:`<p><img src="${image}" alt="待保存截图"></p>`};
  disk.fail=true;assert.throws(()=>store.save(draft),/存储空间不足/);assert.equal(disk.raw(),previous);
  assert.match(draft.meetings[0].richText.notes,/待保存截图/);
  disk.fail=false;store.save(draft);
  assert.deepEqual(createMeetingStore(disk).load().data.meetings[0].richText,draft.meetings[0].richText);
});
