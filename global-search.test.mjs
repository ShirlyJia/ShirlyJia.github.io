import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSearchIndex,searchIndex,plainText,matchesKeywords} from './global-search.js';
import {removeRetiredSession} from './viewer-mode.js';
const data={projects:[{id:'p',name:'项目甲',tagIds:['tag'],description:'业务预测',richText:{description:'<p>百万<b>并发</b></p><img src="data:image/png;base64,PRIVATEIMAGE" alt="">'},comments:[{author:'复盘',body:'降低延迟 业务收益'}],customSections:[{id:'s',title:'验收',body:'周五上线'}],planNodes:[{title:'性能验证',owner:'李同学',estimatedDate:'2026-12-30'}],materials:[{title:'结果文档',url:'https://example.com/report'}],closed:true,lifecycle:'terminated'},{id:'q',name:'业务收益',tagIds:[],description:'另一个项目'}],tags:[{id:'tag',name:'资源与推理效率'}],frames:[{id:'f',name:'1230迭代',members:['i','i2']}],instances:[{id:'i',pid:'p',context:'区域重点'},{id:'i2',pid:'p'}],canvasItems:[{id:'n',type:'note',text:'现场讨论 业务收益'}],quickBoards:[{id:'b',name:'待补充',notes:'核对预算',projectIds:['p'],contexts:{p:'负责人待定'}}],relations:[]};
const meetings=[{id:'m',title:'内部周会',category:'internal',notes:'预算追加',date:'2026-11-17',materials:[{title:'会议纪要',url:'https://example.com/minutes'}]}];
test('global index includes all statuses, canonical projects only, and every searchable surface',()=>{
 const index=buildSearchIndex(data,meetings);
 for(const q of ['并发','延迟','验收','李同学','2026-12-30','资源与推理效率','结果文档','区域重点','负责人待定'])assert(searchIndex(index,q).some(r=>r.id==='p'),q);
 assert.equal(searchIndex(index,'项目甲').length,1);
 assert(searchIndex(index,'1230迭代').some(r=>r.type==='frame'));
 assert(searchIndex(index,'预算').some(r=>r.type==='board'));assert(searchIndex(index,'预算').some(r=>r.type==='meeting'));
 assert(searchIndex(index,'现场讨论').some(r=>r.type==='annotation'));
 assert.equal(searchIndex(index,'PRIVATEIMAGE').length,0);
 assert.equal(searchIndex(index,'业务收益')[0].id,'q');
 assert.equal(searchIndex(index,'李同学 周五')[0].id,'p');
});
test('normalization handles full width, casing, HTML entities and ignores scripts',()=>{
 assert(matchesKeywords('ＫＶ cache','kv CACHE'));assert.equal(plainText('<script>secret</script><p>A &amp; B</p>'),'A & B');
 assert.equal(searchIndex(buildSearchIndex(data),'no such content').length,0);assert.equal(searchIndex([],'' ).length,0);
});
test('retirement clears credentials, preserves comment drafts and never submits them',()=>{
 const disk=new Map([['topic-feishu-session-v1','s'],['topic-feishu-login-proof','proof'],['collab-draft:p',JSON.stringify({text:'未发布草稿',html:'<p>未发布草稿</p>',title:'草稿'})]]);
 const storage={getItem:key=>disk.get(key)||null,removeItem:key=>disk.delete(key)};let target='';
 removeRetiredSession({local:storage,session:storage,location:{hash:'#feishu_code=x',pathname:'/',search:'?project=p'},history:{state:null,replaceState:(_,__,url)=>target=url}});
 assert(!disk.has('topic-feishu-session-v1'));assert(disk.has('collab-draft:p'));assert.equal(target,'/?project=p');

});
