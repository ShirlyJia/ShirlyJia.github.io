import test from 'node:test';
import assert from 'node:assert/strict';
import {enrichWorkbench, isClosedProject, outcomeKind, sortProjectsByPriority, collectDirectionResults, boardFromFrame} from './workbench-model.js';
import {createPersistence} from './persistence.js';

const copy = value => JSON.parse(JSON.stringify(value));
const project = (id, extra = {}) => ({id, name: id, priority: '', outcome: '', tagIds: [], planNodes: [], materials: [], ...extra});
const validate = createPersistence().validate;
const testBoards = () => [
  {id:'empty-board',name:'自建空看板',color:'#74736c',rank:0,notes:'',projectIds:[],emphasisIds:[],contexts:{}},
  {id:'member-board',name:'自建项目看板',color:'#6284a0',rank:1,notes:'',projectIds:['7135469627'],emphasisIds:[],contexts:{}}
];
const base = () => ({
  schemaVersion: 2, importedAt: '2026-10-28', source: {isLive: true},
  projects: [project('7135469627'), project('7018500789'), project('6961865664'), project('7134500575'),
    project('local-memory', {name: '降显存', kind: 'direction', source: {sourceKind: 'user-direction'}, summary: '用户结论', result: '用户结果', tagIds: ['tag-a']})],
  tags: [{id: 'tag-a', name: '原始标签甲', color: '#123456'}, {id: 'tag-b', name: '原始标签乙', color: '#abcdef', rank: 7}],
  relations: [{id: 'r1', main: 'local-memory', child: '7135469627', context: '本地关联说明', draft: false}],
  frames: [{id: 'f1', name: '用户画框', x: 20, y: 30, w: 400, h: 300, tone: 'sand', members: ['i1']},
    {id: 'f2', name: '自定义颜色框', x: 500, y: 30, w: 400, h: 300, tone: 'blue', color: '#102030', members: []}],
  instances: [{id: 'i1', pid: 'local-memory', x: 40, y: 50, context: '本处备注', focus: true}],
  view: {x: 12, y: 34, z: .8}, custom: {keep: ['all', 'metadata']}
});

test('旧 schema 2 可直接载入；迁移纯净、幂等且保留本地事实和组织方式', () => {
  const source = base(), before = copy(source);
  assert.equal(validate(source), true);
  const previousStorage = globalThis.localStorage;
  try {
    globalThis.localStorage = {getItem: () => JSON.stringify(source), setItem: () => assert.fail('load must not write')};
    const loaded = createPersistence().load(source);
    assert.equal(loaded.error, null);
    assert.equal(loaded.fromStorage, true);
    assert.deepEqual(loaded.data, source);
  } finally {
    if (previousStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousStorage;
  }
  const result = enrichWorkbench(source);
  assert.deepEqual(source, before);
  assert.notEqual(result, source);
  assert.deepEqual(enrichWorkbench(result), result);
  assert.equal(result.schemaVersion, 2);
  assert.equal(result.workbenchVersion, 1);
  for (const field of ['projects', 'relations', 'instances', 'view', 'custom', 'source']) assert.deepEqual(result[field], source[field]);
  assert.deepEqual(result.tags.map(({rank, ...tag}) => tag), source.tags.map(({rank, ...tag}) => tag));
  assert.deepEqual(result.tags.map(tag => tag.rank), [0, 7]);
  assert.equal(result.frames[0].color, '#e7e4db');
  assert.equal(result.frames[1].color, '#102030');
  assert.deepEqual(result.frames.map(({color, ...frame}) => frame), source.frames.map(({color, ...frame}) => frame));
  assert.equal(validate(result), true);
});

test('首次启动行动看板为空，不再自动创建预设', () => {
  const result = enrichWorkbench(base());
  assert.deepEqual(result.quickBoards, []);
  assert.deepEqual(enrichWorkbench(result).quickBoards, []);
});

test('不复活用户删掉的行动板，只清除无效板内引用', () => {
  const result = enrichWorkbench({...base(),quickBoards:testBoards()});
  result.quickBoards = result.quickBoards.filter(board => board.id !== 'empty-board');
  assert.equal(enrichWorkbench(result).quickBoards.length, 1);
  result.quickBoards = [];
  assert.deepEqual(enrichWorkbench(result).quickBoards, []);
  delete result.quickBoards;
  assert.deepEqual(enrichWorkbench(result).quickBoards, []);
  const custom = base();
  custom.quickBoards = [{id: 'user-board', name: '用户自建', color: '#123456', rank: -3, notes: '原备注', projectIds: ['7135469627', 'missing'], emphasisIds: ['7135469627', 'missing', '7018500789'], contexts: {'7135469627': '此板的独立讨论备注', missing: '已移除'}, custom: '保留'}];
  const migrated = enrichWorkbench(custom);
  assert.equal(migrated.quickBoards.length, 1);
  assert.deepEqual(migrated.quickBoards[0], {...custom.quickBoards[0], projectIds: ['7135469627'], emphasisIds: ['7135469627'], contexts: {'7135469627': '此板的独立讨论备注'}});
  assert.equal(validate(migrated), true);
});

test('仅明确本地结果结束项目，已解决与停止推进区分', () => {
  for (const outcome of ['已解决', '已交付', '已完成', '已结束未解决', '停止推进', '不再推进', '暂停终止', ' 已解决 ']) assert.equal(isClosedProject({outcome}), true, outcome);
  for (const outcome of ['', '持续跟进', '暂停', '已解决部分问题', '待验证', '自定义进展']) assert.equal(isClosedProject({outcome}), false, outcome);
  assert.equal(isClosedProject({status: '已完成', source: {sourceStatus: '已解决'}, closedAt: '2026-10-28'}), false);
  assert.equal(outcomeKind({outcome: '已解决'}), 'resolved');
  assert.equal(outcomeKind({outcome: '已结束未解决'}), 'stopped');
  const data = base();
  Object.assign(data.projects[0], {closedAt: '', impact: '自定义影响', outcome: '任意自由文本'});
  assert.equal(validate(data), true);
});

test('优先级稳定排序，不改原数组、不增加第二套项目重要级别', () => {
  const list = [project('a', {priority: '高'}), project('b', {priority: 'P2'}), project('c', {priority: 'P0'}),
    project('d'), project('e', {priority: 'P1'}), project('f', {priority: 'P0'}), project('g', {priority: 'P3'})];
  const before = [...list];
  assert.deepEqual(sortProjectsByPriority(list).map(item => item.id), ['c', 'f', 'e', 'b', 'a', 'd', 'g']);
  assert.deepEqual(list, before);
});

test('方向多层汇总去重共享子项，保留关联范围，区分停止与解决', () => {
  const data = {projects: [project('root', {kind: 'direction'}), project('a'), project('b'),
    project('shared', {outcome: '已解决', result: '已验证结果', impact: '影响说明'}),
    project('stopped', {outcome: '已结束未解决', result: '停止原因'}),
    project('ongoing', {status: '已完成', closedAt: '2026-10-28', source: {sourceStatus: '已解决'}})],
    relations: [{id: 'r1', main: 'root', child: 'a'}, {id: 'r2', main: 'root', child: 'b'},
      {id: 'r3', main: 'a', child: 'shared', context: '只关注甲范围', draft: true},
      {id: 'r4', main: 'b', child: 'shared', context: '乙关联范围', draft: false},
      {id: 'r5', main: 'shared', child: 'stopped'}, {id: 'r6', main: 'b', child: 'ongoing'}]};
  const before = copy(data), rows = collectDirectionResults('root', data);
  assert.equal(rows.length, 5);
  const shared = rows.find(row => row.project.id === 'shared');
  assert.equal(shared.depth, 2);
  assert.deepEqual(shared.parentIds, ['a', 'b']);
  assert.deepEqual(shared.relations.map(relation => relation.context), ['只关注甲范围', '乙关联范围']);
  assert.equal(shared.outcomeKind, 'resolved');
  assert.equal(shared.closed, true);
  assert.equal(rows.find(row => row.project.id === 'stopped').outcomeKind, 'stopped');
  assert.equal(rows.find(row => row.project.id === 'ongoing').outcomeKind, 'open');
  assert.equal(isClosedProject(data.projects[0]), false);
  assert.deepEqual(data, before);
  shared.project.result = '仅改变返回副本';
  assert.equal(data.projects.find(item => item.id === 'shared').result, '已验证结果');
  assert.deepEqual(collectDirectionResults('missing', data), []);
});

test('扩展字段拒绝错误类型、颜色、重复 ID 和无效引用', () => {
  const cases = [
    ['version', d => d.workbenchVersion = 2],
    ['boards array', d => d.quickBoards = {}],
    ['duplicate board', d => d.quickBoards.push(copy(d.quickBoards[0]))],
    ['empty board title', d => d.quickBoards[0].name = ' '],
    ['board color', d => d.quickBoards[0].color = 'url(javascript:bad)'],
    ['board rank', d => d.quickBoards[0].rank = 'first'],
    ['board notes', d => d.quickBoards[0].notes = null],
    ['board missing project', d => d.quickBoards[0].projectIds = ['missing']],
    ['board duplicate project', d => d.quickBoards[0].projectIds = ['7135469627', '7135469627']],
    ['emphasis outside board', d => d.quickBoards[0].emphasisIds = ['7135469627']],
    ['emphasis missing project', d => d.quickBoards[0].emphasisIds = ['missing']],
    ['contexts shape', d => d.quickBoards[0].contexts = []],
    ['context outside board', d => d.quickBoards[0].contexts = {'7135469627': '不是本板项目'}],
    ['context value', d => d.quickBoards[1].contexts = {'7135469627': {note: '错误结构'}}],
    ['tag rank', d => d.tags[0].rank = 'top'],
    ['tag rank NaN', d => d.tags[0].rank = NaN],
    ['frame color', d => d.frames[0].color = '#fff'],
    ['frame color type', d => d.frames[0].color = {}],
    ['project closedAt', d => d.projects[0].closedAt = 123],
    ['project impact', d => d.projects[0].impact = []]
  ];
  for (const [name, change] of cases) {
    const data = enrichWorkbench({...base(),quickBoards:testBoards()});
    change(data);
    assert.throws(() => validate(data), undefined, name);
  }
  assert.equal(validate(base()), true, 'all new fields remain optional for old archives');
});

test('导入分组只引用原项目，重复卡片去重并合并备注、重点，支持空分组', () => {
  const data=enrichWorkbench(base());
  data.instances.push({id:'i2',pid:'local-memory',x:60,y:80,context:'第二处备注'},
    {id:'i3',pid:'local-memory',x:70,y:80,context:'本处备注'},
    {id:'outside',pid:'7135469627',x:200,y:100,context:'分组外的卡片'});
  data.frames[0].members.push('i2','i3','missing');
  const before=copy(data),board=boardFromFrame(data,'f1',{id:'imported',rank:2});
  assert.deepEqual(board.projectIds,['local-memory']);
  assert.deepEqual(board.emphasisIds,['local-memory']);
  assert.equal(board.contexts['local-memory'],'本处备注\n\n第二处备注');
  assert.equal(board.name,'用户画框');
  assert.equal(board.rank,2);
  assert.deepEqual(data,before);
  board.contexts['local-memory']='改看板备注';
  assert.equal(data.instances[0].context,'本处备注');
  assert.deepEqual(boardFromFrame(data,'f2',{id:'empty'}).projectIds,[]);
  assert.throws(()=>boardFromFrame(data,'missing',{id:'invalid'}),/分组已不存在/);
  data.frames[0].members.pop();
  data.quickBoards.push(board);
  assert.equal(validate(data),true);
});

test('同一项目导入多个看板后仍共用事实，导入可整体撤销', () => {
  const previous=globalThis.localStorage,disk=new Map();
  globalThis.localStorage={getItem:key=>disk.get(key)??null,setItem:(key,value)=>disk.set(key,value)};
  try {
    const data=enrichWorkbench(base());data.frames[1].members.push('i1');
    const storage=createPersistence();storage.commit(data,{recordHistory:false});
    data.quickBoards=['f1','f2'].map((frameId,rank)=>boardFromFrame(data,frameId,{id:'board-'+rank,rank}));
    storage.commit(data);
    assert.equal(data.projects.length,base().projects.length);
    assert.deepEqual(data.quickBoards.map(b=>b.projectIds),[['local-memory'],['local-memory']]);
    assert.deepEqual(createPersistence().load(data).data.quickBoards,data.quickBoards);
    assert.deepEqual(storage.undo().quickBoards,[]);
  }finally{if(previous===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous;}
});
