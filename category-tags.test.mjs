import test from 'node:test';
import assert from 'node:assert/strict';
import {applyDomainTags,DOMAIN_TAGS} from './category-tags.js';
const copy=x=>JSON.parse(JSON.stringify(x));
const base=()=>({schemaVersion:2,tags:[{id:'data-comparison',name:'数据对照',color:'#888888',rank:1},{id:'scope-alignment',name:'我的标签',color:'#123456',rank:3},{id:'custom',name:'自建',color:'#abcdef',rank:4}],projects:[{id:'7135469627',name:'原标题',tagIds:['data-comparison','custom'],priority:'P0',summary:'保留结论'},{id:'7135496756',name:'输入容量',tagIds:['scope-alignment']},{id:'7133205159',name:'会议资料',tagIds:[]},{id:'user-project',name:'自建项目',tagIds:['custom']}],frames:[{id:'f',name:'我的画框',members:[]}],quickBoards:[{id:'b',name:'下次会前补齐',projectIds:['7135469627']}],relations:[{main:'7135496756',child:'7135469627',context:'保留'}],view:{x:10,y:20,z:1},instances:[]});
test('迁移仅默认标签与已知项目归属，保留分组、事实、自建与已改名标签',()=>{
 const data=base(),before=copy(data),next=applyDomainTags(data);assert.deepEqual(data,before);
 for(const key of ['frames','quickBoards','relations','view','instances'])assert.deepEqual(next[key],data[key]);
 assert.equal(next.tags.length,9);assert.ok(!next.tags.some(t=>t.id==='data-comparison'));assert.ok(next.tags.some(t=>t.id==='scope-alignment'&&t.name==='我的标签'));
 assert.deepEqual(next.projects[0],{...data.projects[0],tagIds:['domain-p','custom']});
 assert.deepEqual(next.projects[1].tagIds,['domain-r','domain-p','scope-alignment']);assert.deepEqual(next.projects[2].tagIds,['domain-a']);assert.deepEqual(next.projects[3],data.projects[3]);
});
test('迁移幂等，用户后续删类、改名、换色、调整归属不会被恢复',()=>{
 const data=applyDomainTags(base());data.tags=data.tags.filter(t=>t.id!=='domain-e');data.tags.find(t=>t.id==='domain-p').name='效果';data.tags.find(t=>t.id==='domain-p').color='#000000';data.projects[0].tagIds=['custom'];assert.deepEqual(applyDomainTags(data),data);
});
test('分类稳定ID被自建标签占用时不覆盖；同名分类复用',()=>{
 const data=base();data.tags.push({id:'domain-r',name:'我的占位',color:'#112233'},{id:'existing-p',name:'P 预测效果与泛化',color:'#445566'});const next=applyDomainTags(data);
 assert.deepEqual(next.projects[1].tagIds,['domain-r-2','existing-p','scope-alignment']);assert.equal(next.tags.find(t=>t.id==='domain-r').name,'我的占位');assert.equal(next.tags.find(t=>t.id==='existing-p').color,'#445566');assert.equal(new Set(next.tags.map(t=>t.id)).size,next.tags.length);
});
test('新初始数据复用7类，无重复分类，未知版本拒绝',()=>{
 const data=base();data.tags=copy(DOMAIN_TAGS);data.projects.forEach(p=>p.tagIds=[]);assert.equal(applyDomainTags(data).tags.length,7);assert.throws(()=>applyDomainTags({...data,domainTagVersion:2}));
});
test('未映射的用户项目保留曾使用的旧标签；已映射项目仍替换为问题域',()=>{
 const data=base();data.projects.push({id:'user-new',name:'用户自建',tagIds:['data-comparison']});const next=applyDomainTags(data);
 assert.deepEqual(next.projects.at(-1).tagIds,['data-comparison']);assert.ok(next.tags.some(t=>t.id==='data-comparison'));assert.deepEqual(next.projects[0].tagIds,['domain-p','custom']);
});
