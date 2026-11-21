import test from 'node:test';
import assert from 'node:assert/strict';
import {publicationStore} from './board-publication.js';
import {createPersistence} from './persistence.js';
import {readFileSync} from 'node:fs';

const sample = JSON.parse(readFileSync(new URL('./initial-data.json', import.meta.url)));
const projectKey = 'topic-workbench-v2';
const first = '2026-11-05-1111111111111111';
const second = '2026-11-06-2222222222222222';

test('首次和回访加载发布数据，更新前的本机修改仍可按原样访问', t => {
  const values = new Map();
  const disk = {get length(){return values.size}, key:i=>[...values.keys()][i],
    getItem:k=>values.get(k) ?? null, setItem:(k,v)=>values.set(k,v)};
  const oldDescriptor = Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  Object.defineProperty(globalThis,'localStorage',{value:disk,configurable:true});
  t.after(() => oldDescriptor ? Object.defineProperty(globalThis,'localStorage',oldDescriptor) : delete globalThis.localStorage);
  const config = {public:true, namespace:'site'};
  const visit = (edition,requested) => publicationStore(config,{edition,requested,disk:()=>disk});
  const data = name => {const d=structuredClone(sample);d.projects[0].name=name;return d};
  const storage = edition => createPersistence({key:edition.key(projectKey)});
  const legacy=JSON.stringify(data('旧版里的个人编辑'));
  disk.setItem('site:'+projectKey,legacy);
  const newer=visit(first);
  assert.equal(storage(newer).load(data('最新发布')).data.projects[0].name,'最新发布');
  assert.deepEqual(newer.olderCopies(),['legacy']);
  storage(newer).commit(data('本机继续编辑'));
  assert.equal(storage(visit(first)).load(sample).data.projects[0].name,'本机继续编辑');
  assert.equal(storage(visit(first,'legacy')).load(sample).data.projects[0].name,'旧版里的个人编辑');
  const next=visit(second);
  assert.equal(storage(next).load(data('再次发布')).data.projects[0].name,'再次发布');
  assert.deepEqual(next.olderCopies(),[first,'legacy']);
  assert.equal(storage(visit(second,first)).load(sample).data.projects[0].name,'本机继续编辑');
  assert.equal(visit(second,'2026-11-04-3333333333333333').active,second);
  assert.equal(next.key('topic-workbench-meetings-v1'),'site:topic-workbench-meetings-v1');
  assert.equal(disk.getItem('site:'+projectKey),legacy);
});
