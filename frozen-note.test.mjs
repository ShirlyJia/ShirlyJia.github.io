import test from 'node:test';
import assert from 'node:assert/strict';
import {frozenNote,saveFrozenNote,freezeCommentOptions} from './frozen-note.js';
import {setProjectLifecycle} from './project-flow.js';
import {validateProjectLifecycle} from './project-lifecycle.js';

test('空的旧栏目不出现在唯一冻结原因内',()=>{
  const p={lifecycle:'frozen',freezeReason:'暂缺落地场景',resumeCondition:'',impact:''};
  assert.deepEqual(frozenNote(p),{text:'暂缺落地场景',html:'<div>暂缺落地场景</div>'});
});

test('已有补充文本和图片合并显示，读取时不改动原始记录',()=>{
  const p={lifecycle:'frozen',freezeReason:'等待业务确认',resumeCondition:'场景明确后评估',impact:'',richText:{impact:'<p><img src="data:image/png;base64,aGVsbG8="></p>'}};
  const before=structuredClone(p),note=frozenNote(p);
  assert.match(note.text,/等待业务确认\n\n恢复条件：场景明确后评估/);
  assert.match(note.html,/data:image\/png;base64,aGVsbG8=/);
  assert.deepEqual(p,before);
});

test('编辑后尊重用户删除，旧内容不反复合并，新状态历史也不重复',()=>{
  const p={closed:false,lifecycle:'active',resumeCondition:'旧恢复条件',impact:'旧成果'};
  saveFrozenNote(p,{text:'当前原因',html:'<p>当前原因</p>'});
  setProjectLifecycle(p,'frozen',{date:'2026-11-12'});
  assert.deepEqual(frozenNote(p),{text:'当前原因',html:'<p>当前原因</p>'});
  assert.equal(p.lifecycleHistory[0].note,'当前原因');
  assert.equal(p.lifecycleHistory[0].resumeCondition,'');
  assert.equal(p.resumeCondition,'旧恢复条件');assert.equal(p.impact,'旧成果');
  saveFrozenNote(p,{});
  assert.deepEqual(frozenNote(p),{text:'',html:''});
  assert.doesNotThrow(()=>validateProjectLifecycle(JSON.parse(JSON.stringify(p))));
});

test('其他状态的成果不会在新冻结记录中自动变成冻结原因',()=>{
  assert.deepEqual(frozenNote({lifecycle:'completed',impact:'已验证的结果'}),{text:'',html:''});
});

test('可以从本地记录和署名留言选择，保留富文本和图片，过滤空记录',()=>{
  const project={comments:[{id:'same',author:'讨论结论',body:'等待业务确认',richText:{body:'<p><strong>等待业务确认</strong></p>'}},{id:'empty',body:''}]};
  const shared=[{id:'same',title:'业务反馈',body:'',html:'<p><img src="data:image/png;base64,aGVsbG8="></p>',actor:{name:'测试成员'}}];
  const before=structuredClone({project,shared}),options=freezeCommentOptions(project,shared);
  assert.equal(options.length,2);
  assert.deepEqual(options.map(row=>row.id),['shared:same','local:same']);
  assert.equal(options[0].author,'测试成员');
  assert.match(options[0].html,/data:image\/png/);
  assert.match(options[1].html,/<strong>等待业务确认<\/strong>/);
  assert.deepEqual({project,shared},before);
});

test('评论作为原因保存后，原评论修改或删除不会改写冻结原因与历史',()=>{
  const project={lifecycle:'active',closed:false,comments:[{id:'one',author:'讨论结果',body:'暂不推进',richText:{body:'<p>暂不推进</p>'}}]};
  const option=freezeCommentOptions(project)[0];
  saveFrozenNote(project,option);setProjectLifecycle(project,'frozen',{date:'2026-11-13'});
  assert.equal(project.comments[0].body,'暂不推进');
  project.comments[0].body='后续已有变化';project.comments=[];
  assert.deepEqual(frozenNote(project),{text:'暂不推进',html:'<p>暂不推进</p>'});
  assert.equal(project.lifecycleHistory[0].note,'暂不推进');
  assert.doesNotThrow(()=>validateProjectLifecycle(project));
});
