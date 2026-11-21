import test from 'node:test';
import assert from 'node:assert/strict';
import {createSnapshotStore} from './snapshot-store.js';

const key = 'topic-workbench-snapshots-v1';
const fixture = () => ({schemaVersion: 2, importedAt: '2026-10-28', source: {},
  projects: [{id: 'p', name: '项目原名', tagIds: [], planNodes: [], materials: [], summary: '原结论'}],
  tags: [], relations: [], frames: [], instances: [], view: {x: 1, y: 2, z: 1}, custom: {keep: '原值'}});
function setup() {
  const disk = new Map([['topic-workbench-v2', '主存档保持原样']]);
  let readsBlocked = false, writesBlocked = false, serial = 0, writes = 0;
  const storage = {
    getItem(name) { if (readsBlocked) throw Error('读取被禁用'); return disk.get(name) ?? null; },
    setItem(name, value) { if (writesBlocked) throw Error('QuotaExceededError'); writes++; disk.set(name, value); }
  };
  const statuses = [];
  const options = {storage, now: () => '2026-10-28T12:00:00.000Z', idFactory: () => 'snapshot-' + ++serial, onStatus: result => statuses.push(result)};
  return {disk, storage, statuses, options, store: createSnapshotStore(options), writes: () => writes,
    blockRead: value => readsBlocked = value, blockWrite: value => writesBlocked = value};
}

test('主动 capture 深拷贝；list/read/export 为只读副本，主存档始终不变', () => {
  const test = setup(), data = fixture();
  assert.deepEqual(test.store.list(), []);
  assert.equal(test.store.read('missing'), null);
  assert.equal(test.writes(), 0);
  const snapshot = test.store.capture(' 会前版本 ', data);
  assert.equal(snapshot.name, '会前版本');
  data.projects[0].summary = '后续修改';
  snapshot.data.projects[0].summary = '修改返回对象';
  assert.equal(test.store.read(snapshot.id).data.projects[0].summary, '原结论');
  const preview = test.store.read(snapshot.id);
  preview.data.custom.keep = '预览中修改';
  assert.equal(test.store.read(snapshot.id).data.custom.keep, '原值');
  const list = test.store.list();
  assert.deepEqual(list[0], {id: snapshot.id, name: '会前版本', createdAt: '2026-10-28T12:00:00.000Z', projectCount: 1, boardCount: 0});
  list[0].name = '修改列表';
  assert.equal(test.store.list()[0].name, '会前版本');
  assert.equal(JSON.parse(test.store.export(snapshot.id)).data.projects[0].summary, '原结论');
  assert.equal(JSON.parse(test.store.export()).snapshots.length, 1);
  assert.equal(test.store.exportRaw(), test.disk.get(key));
  assert.equal(test.writes(), 1);
  assert.equal(test.disk.get('topic-workbench-v2'), '主存档保持原样');
  assert.equal(Object.hasOwn(test.store, 'restore'), false);
  assert.throws(() => createSnapshotStore({key: 'topic-workbench-v2'}), /主工作台/);
});

test('20 个达到上限时明确拒绝，不自动删除旧快照；用户删除后可新增', () => {
  const test = setup();
  for (let index = 0; index < 20; index++) test.store.capture('版本 ' + index, fixture());
  const before = test.disk.get(key);
  assert.throws(() => test.store.capture('第21个', fixture()), error => error.code === 'SNAPSHOT_LIMIT');
  assert.equal(test.disk.get(key), before);
  assert.equal(test.store.list().length, 20);
  assert.equal(test.store.remove('snapshot-1'), true);
  assert.equal(test.store.remove('missing'), false);
  test.store.capture('新的主动快照', fixture());
  assert.equal(test.store.list().length, 20);
  assert.equal(test.store.read('snapshot-1'), null);
});

test('坏存储禁止 capture/remove 覆盖，仍可原样导出', () => {
  const test = setup();
  for (const raw of ['{broken', JSON.stringify({schemaVersion: 9, snapshots: []}), JSON.stringify({schemaVersion: 1, snapshots: [{id: 'bad', name: '坏数据', createdAt: '2026-10-28', data: {schemaVersion: 2}}]}), '{"schemaVersion":1,"snapshots":[],"__proto__":{"polluted":true}}']) {
    test.disk.set(key, raw);
    for (const fn of [() => test.store.list(), () => test.store.read('bad'), () => test.store.capture('新', fixture()), () => test.store.remove('bad'), () => test.store.export()]) {
      assert.throws(fn, error => error.code === 'SNAPSHOT_CORRUPT');
      assert.equal(test.disk.get(key), raw);
    }
    assert.equal(test.store.exportRaw(), raw);
  }
  assert.equal(test.writes(), 0);
  assert.equal({}.polluted, undefined);
});

test('配额/权限失败不改存档；操作重新读取，多个工厂顺序写入不覆盖', () => {
  const test = setup(), second = createSnapshotStore(test.options);
  const first = test.store.capture('第一个', fixture());
  second.capture('第二个', fixture());
  assert.equal(test.store.list().length, 2);
  const before = test.disk.get(key);
  test.blockWrite(true);
  assert.throws(() => test.store.capture('保存失败', fixture()), /QuotaExceededError/);
  assert.throws(() => test.store.remove(first.id), /QuotaExceededError/);
  assert.equal(test.disk.get(key), before);
  assert.equal(test.statuses.at(-1).ok, false);
  test.blockWrite(false);
  test.blockRead(true);
  assert.throws(() => test.store.capture('读取失败', fixture()), /读取被禁用/);
  assert.throws(() => test.store.remove(first.id), /读取被禁用/);
  assert.equal(test.disk.get(key), before);
  test.blockRead(false);
  assert.equal(test.store.remove(first.id), true);
  assert.equal(test.store.list().length, 1);
});

test('无效名称/主数据/重复快照ID拒绝且不写；UI回调异常不影响已完成保存', () => {
  const test = setup();
  assert.throws(() => test.store.capture(' ', fixture()), /名称/);
  assert.throws(() => test.store.capture('非法数据', {schemaVersion: 1}), /schemaVersion/);
  const unsafe = fixture();
  unsafe.custom = JSON.parse('{"constructor":{}}');
  assert.throws(() => test.store.capture('非法字段', unsafe), /不允许/);
  assert.equal(test.writes(), 0);
  const sameId = createSnapshotStore({...test.options, idFactory: () => 'same', onStatus() { throw Error('UI失败'); }});
  sameId.capture('首次', fixture());
  const before = test.disk.get(key);
  assert.throws(() => sameId.capture('重复ID', fixture()), /记录无效/);
  assert.equal(test.disk.get(key), before);
  assert.equal(test.store.list().length, 1);
});

function legacySnapshot() {
  const data = fixture();
  data.source = {sourceUrl:'https://project.feishu.cn/work/storyView/old'};
  data.projects[0].source = {originalName:'旧系统名称', sourceUrl:'https://project.feishu.cn/work/story/detail/1'};
  data.projects[0].description = '保留问题陈述';
  data.projects[0].planNodes = [{id:'plan', title:'验证结果', owner:'跟进人', targetDate:'2026-11-01', dateConfirmed:false,
    sourceActualStart:'2026-10-27', sourceActualFinish:'2026-10-28', dateSource:'飞书节点计划结束时间'}];
  data.projects[0].materials = [{id:'old',title:'旧来源',url:'https://example.feishu.cn/docx/old'},
    {id:'keep',title:'外部资料',url:'https://example.org/evidence'}];
  data.instances = [{id:'card',pid:'p',x:20,y:40}];
  return {schemaVersion:1,snapshots:[{id:'legacy',name:'当时的讨论',createdAt:'2026-10-28T00:00:00.000Z',data}]};
}

test('旧快照一次清理来源，保留正文、布局、实际日期；列表和导出均不复活来源', () => {
  const t=setup();
  t.disk.set(key,JSON.stringify(legacySnapshot()));
  t.disk.set('topic-meetings-v1','会议记录原样保留');
  assert.equal(t.store.list()[0].projectCount,1);
  assert.equal(t.writes(),1);
  const saved=t.store.read('legacy');
  assert.equal(saved.data.projects[0].description,'保留问题陈述');
  assert.deepEqual(saved.data.instances,[{id:'card',pid:'p',x:20,y:40}]);
  assert.equal(saved.data.projects[0].planNodes[0].actualStart,'2026-10-27');
  assert.equal(saved.data.projects[0].planNodes[0].actualFinish,'2026-10-28');
  assert.deepEqual(saved.data.projects[0].materials,[{id:'keep',title:'外部资料',url:'https://example.org/evidence'}]);
  for(const output of [t.disk.get(key),t.store.export(),t.store.export('legacy'),t.store.exportRaw()]) {
    assert.doesNotMatch(output,/feishu\.cn|旧系统名称|dateSource|sourceActual|importedAt/);
  }
  assert.equal(t.writes(),1);
  assert.equal(t.disk.get('topic-workbench-v2'),'主存档保持原样');
  assert.equal(t.disk.get('topic-meetings-v1'),'会议记录原样保留');
});

test('清理旧快照遇到写入失败时明确报错，原记录不被覆盖，可重试', () => {
  const t=setup(),raw=JSON.stringify(legacySnapshot());
  t.disk.set(key,raw);t.blockWrite(true);
  assert.throws(()=>t.store.list(),error=>error.code==='SNAPSHOT_CLEANUP_FAILED');
  assert.equal(t.disk.get(key),raw);
  assert.equal(t.statuses.at(-1).ok,false);
  t.blockWrite(false);
  assert.equal(t.store.read('legacy').data.projects[0].name,'项目原名');
  assert.doesNotMatch(t.disk.get(key),/feishu\.cn/);
});

test('新快照清理未迁移数据，已迁移后手动添加的材料继续保留', () => {
  const t=setup(),original=legacySnapshot().snapshots[0].data,before=JSON.stringify(original);
  const first=t.store.capture('清理后',original);
  assert.equal(JSON.stringify(original),before);
  assert.doesNotMatch(t.store.export(first.id),/feishu\.cn/);
  first.data.projects[0].materials.push({id:'later',title:'主动补充资料',url:'https://example.feishu.cn/docx/later'});
  const next=t.store.capture('后续补充',first.data);
  assert.equal(t.store.read(next.id).data.projects[0].materials.at(-1).id,'later');
});
