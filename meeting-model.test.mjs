import test from 'node:test';
import assert from 'node:assert/strict';
import {MEETING_CATEGORIES, meetingCategory, enrichMeetingContent} from './meeting-model.js';

const copy = value => JSON.parse(JSON.stringify(value));
const meeting = (id, extra = {}) => ({
  id, title:id, date:'2026-10-23', type:'其他', attendees:'甲、乙',
  notes:'原会议记录', conclusions:'已明确的判断', followUp:'补齐原数据',
  originNote:'已收录双周会原文链接，未自动提炼会议内容。',
  projectIds:['project-1'], materials:[{id:'source-1',title:'原纪要',url:'https://example.com/minutes'}],
  createdAt:'', updatedAt:'', ...extra
});
const fixture = () => ({schemaVersion:1, updatedAt:'', meetings:[meeting('m1')], deletedMeetings:[], localPreference:'保留'});

test('会议分栏顺序固定，旧类型映射与已有分栏互不覆盖', () => {
  assert.deepEqual(MEETING_CATEGORIES,[{id:'cross-team',label:'基模-落地'},{id:'internal',label:'落地内部'}]);
  assert.equal(meetingCategory({type:'落地内部'}),'internal');
  assert.equal(meetingCategory({type:'基模对齐'}),'cross-team');
  assert.equal(meetingCategory({type:'其他'}),'cross-team');
  assert.equal(meetingCategory({type:'落地内部',category:'cross-team'}),'cross-team');
  const data=fixture();data.meetings.push(meeting('internal',{type:'落地内部'}),meeting('explicit',{type:'基模对齐',category:'internal'}));
  assert.deepEqual(enrichMeetingContent(data).meetings.map(row=>row.category),['cross-team','internal','internal']);
});

test('记录与结论合并保留原文，不增加判断，非展示字段与资料保持原样', () => {
  const source=fixture();source.meetings[0].notes='  讨论第一段\n第二行  ';source.meetings[0].conclusions='  原结论\n原限定范围  ';
  const before=copy(source),data=enrichMeetingContent(source),row=data.meetings[0];
  assert.deepEqual(source,before);
  assert.equal(row.notes,before.meetings[0].notes+'\n\n'+before.meetings[0].conclusions);
  assert.equal(row.conclusions,'');assert.equal(row.originNote,'');assert.equal(data.meetingContentVersion,1);
  for(const field of ['id','title','date','type','attendees','followUp','projectIds','materials','createdAt','updatedAt']) assert.deepEqual(row[field],before.meetings[0][field]);
  assert.equal(data.updatedAt,before.updatedAt);assert.equal(data.localPreference,'保留');
});

test('空字段与相同内容不重复追加，未知来源备注保留', () => {
  const cases=[
    {notes:'只有记录',conclusions:'',expected:'只有记录'},
    {notes:'',conclusions:'  只有结论\n ',expected:'  只有结论\n '},
    {notes:' \n ',conclusions:'原结论',expected:'原结论'},
    {notes:'同一段',conclusions:'同一段',expected:'同一段'},
    {notes:' 同一段\n',conclusions:'同一段',expected:' 同一段\n'},
    {notes:'',conclusions:'',expected:''}
  ];
  for(const item of cases){
    const data=fixture();data.meetings[0]=meeting('case',{notes:item.notes,conclusions:item.conclusions,originNote:'用户自己的来源说明'});
    const row=enrichMeetingContent(data).meetings[0];assert.equal(row.notes,item.expected);assert.equal(row.conclusions,'');assert.equal(row.originNote,'用户自己的来源说明');
  }
});

test('已删除会议也迁移，撤销元信息和原资料保留', () => {
  const data=fixture();data.deletedMeetings=[{index:2,deletedAt:'2026-10-27T02:00:00Z',meeting:meeting('deleted',{type:'落地内部'})}];
  const migrated=enrichMeetingContent(data),entry=migrated.deletedMeetings[0];
  assert.equal(entry.index,2);assert.equal(entry.deletedAt,'2026-10-27T02:00:00Z');assert.equal(entry.meeting.category,'internal');
  assert.equal(entry.meeting.notes,'原会议记录\n\n已明确的判断');assert.equal(entry.meeting.conclusions,'');assert.deepEqual(entry.meeting.materials,data.deletedMeetings[0].meeting.materials);
});

test('迁移幂等，用户清空记录、移动分栏或删除原会议后不复活', () => {
  const first=enrichMeetingContent(fixture());assert.deepEqual(enrichMeetingContent(first),first);
  first.meetings[0].notes='';first.meetings[0].category='internal';first.meetings[0].materials=[];
  assert.deepEqual(enrichMeetingContent(first),first);
  first.meetings=[];assert.deepEqual(enrichMeetingContent(first),first);
  const second=enrichMeetingContent(first);second.localPreference='仅修改副本';assert.equal(first.localPreference,'保留');
});

test('未知迁移版本、坏容器或非文字记录拒绝处理且不改原输入', () => {
  for(const mutate of [data=>data.meetingContentVersion=2,data=>data.schemaVersion=2,data=>data.deletedMeetings=null,data=>data.meetings[0].notes={},data=>data.meetings[0].conclusions=null,data=>data.meetings[0].category='unknown',data=>data.deletedMeetings.push({index:0})]){
    const data=fixture();mutate(data);const before=copy(data);assert.throws(()=>enrichMeetingContent(data));assert.deepEqual(data,before);
  }
  assert.throws(()=>enrichMeetingContent(null));
});
