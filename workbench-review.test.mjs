import test from 'node:test';
import assert from 'node:assert/strict';
import {findScheduleConflicts, findContentOverlaps} from './workbench-review.js';

const copy = value => JSON.parse(JSON.stringify(value));
const project = (id, nodes = [], extra = {}) => ({id, name: id, planNodes: nodes, ...extra});
const node = (id, owner, targetDate, extra = {}) => ({id, title: id, owner, targetDate, ...extra});

test('区间仅在工作日重叠时提醒，包括补班；明确的同日交付仍可核对', () => {
  const review = (a, b) => findScheduleConflicts({projects:[
    project('a',[node('1','甲','',a)]), project('b',[node('2','甲','',b)])
  ]});
  const holiday = {startDate:'2026-10-01',endDate:'2026-10-07'};
  assert.deepEqual(review(holiday,holiday), []);
  const weekend = {startDate:'2026-10-30',endDate:'2026-11-01'};
  assert.deepEqual(review(weekend,{startDate:'2026-10-31',endDate:'2026-11-02'}), []);
  const range = {startDate:'2026-10-10',endDate:'2026-10-11'};
  assert.match(review(range,range)[0].reason, /1 个工作日/);
  const promise = {dateConfirmed:true,estimatedDate:'2026-10-02'};
  assert.match(review(promise,promise)[0].reason, /已确认交付落在同一天/);
  assert.deepEqual(review(promise,holiday), []);
  const unknown = {startDate:'2027-01-02',endDate:'2027-01-05'};
  assert.match(review(unknown,unknown)[0].reason, /工作日历待补全/);
});

test('明确同一负责人同日生成待核对提示，不推断未知负责人或认定冲突', () => {
  const data = {projects: [project('a', [node('a1', '李东哲', '2026-12-30')]),
    project('b', [node('b1', ' 李东哲 ', '2026-12-30', {dateConfirmed: true})]),
    project('other', [node('o1', '另一人', '2026-12-30')]),
    project('unknown', [node('u1', '', '2026-12-30'), node('u2', '待定', '2026-12-30'), node('u3', '待定', '2026-12-30')]),
    project('invalid', [node('x1', '李东哲', '2026-02-30')]),
    project('source-owner', [node('s1', '', '2026-12-30')], {source: {sourceOwners: [{name: '李东哲'}]}})]};
  const before = copy(data), results = findScheduleConflicts(data);
  assert.equal(results.length, 1);
  assert.equal(results[0].kind, 'same-date');
  assert.equal(results[0].status, 'needs-review');
  assert.equal(results[0].owner, '李东哲');
  assert.deepEqual(results[0].overlap, {start: '2026-12-30', end: '2026-12-30'});
  assert.deepEqual(results[0].items.map(item => item.dateConfirmed), [false, true]);
  assert.match(results[0].reason, /待核对/);
  assert.equal(Object.hasOwn(results[0], 'confirmedConflict'), false);
  results[0].items[0].nodeTitle = '只改结果副本';
  assert.deepEqual(data, before);
});

test('显式起止区间支持重叠；目标日和预计日不被拼成区间', () => {
  const data = {projects: [project('a', [node('a1', '同一人', '', {startDate: '2026-12-20', endDate: '2026-12-31'})]),
    project('b', [node('b1', '同一人', '', {plannedStartDate: '2026-12-25', plannedEndDate: '2026-12-28'})]),
    project('c', [node('c1', '同一人', '', {startDate: '2027-01-01', endDate: '2027-01-03'})]),
    project('invalid', [node('bad', '同一人', '', {startDate: '2026-12-28', endDate: '2026-12-20'})])]};
  const results = findScheduleConflicts(data);
  assert.equal(results.length, 1);
  assert.equal(results[0].kind, 'date-overlap');
  assert.deepEqual(results[0].overlap, {start: '2026-12-25', end: '2026-12-28'});
  const alternatives = {projects: [project('a', [node('n1', '同一人', '2026-12-10', {estimatedDate: '2026-12-30'})]),
    project('b', [node('n2', '同一人', '2026-12-15')])]};
  assert.deepEqual(findScheduleConflicts(alternatives), []);
  alternatives.projects[1].planNodes[0].targetDate = '2026-12-30';
  assert.equal(findScheduleConflicts(alternatives)[0].items[0].dateBasis, 'estimatedDate');
});

test('显式来源计划区间可核对，多处项目引用不会重复扫描同一节点', () => {
  const shared = project('shared', [node('n1', '同一人', '', {sourcePlannedStart: '2026-12-29T08:00:00+08:00', sourcePlannedEnd: '2026-12-31T08:00:00+08:00'})]);
  const data = {projects: [shared, copy(shared), project('other', [node('n2', '同一人', '2026-12-30')])],
    relations: [{main: 'a', child: 'shared'}, {main: 'b', child: 'shared'}],
    quickBoards: [{id: 'b1', projectIds: ['shared']}, {id: 'b2', projectIds: ['shared']}]};
  const results = findScheduleConflicts(data);
  assert.equal(results.length, 1);
  assert.equal(results[0].items[0].dateBasis, 'sourcePlannedStart/sourcePlannedEnd');
});

test('内容核对仅来自共享子项或多板成员，保留各处备注与草案标记', () => {
  const data = {projects: [project('a'), project('b'), project('shared')],
    relations: [{id: 'r1', main: 'a', child: 'shared', context: '甲范围', draft: true},
      {id: 'r2', main: 'b', child: 'shared', context: '乙范围', draft: false},
      {id: 'r3', main: 'missing', child: 'shared'}],
    quickBoards: [{id: 'board1', name: '第一板', projectIds: ['shared', 'shared'], contexts: {shared: '讨论甲'}},
      {id: 'board2', name: '第二板', projectIds: ['shared'], contexts: {shared: '讨论乙'}}]};
  const before = copy(data), results = findContentOverlaps(data);
  assert.deepEqual(results.map(result => result.kind), ['shared-child', 'multi-board-project']);
  assert.ok(results.every(result => result.status === 'needs-review'));
  assert.deepEqual(results[0].mainIds, ['a', 'b']);
  assert.deepEqual(results[0].relations.map(relation => relation.context), ['甲范围', '乙范围']);
  assert.deepEqual(results[1].boards.map(board => board.context), ['讨论甲', '讨论乙']);
  results[0].relations[0].context = '只修改副本';
  assert.deepEqual(data, before);
  assert.deepEqual(findContentOverlaps({projects: [project('a', [], {name: '同名', tagIds: ['同标签']}), project('b', [], {name: '同名', tagIds: ['同标签']})]}), []);
  assert.deepEqual(findContentOverlaps({projects: data.projects, relations: [{main: 'a', child: 'shared'}, {main: 'a', child: 'shared'}]}), []);
});
