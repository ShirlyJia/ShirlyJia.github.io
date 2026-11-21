import test from 'node:test';
import assert from 'node:assert/strict';
import {createMeetingFiles,MAX_MEETING_FILE_BYTES} from './meeting-files.js';

// Small transaction driver: it distinguishes request success from transaction commit.
function disk() {
  const records = new Map(), control = {abortWrites:false, failReads:false};
  const database = {
    objectStoreNames:{contains:() => true}, close() {},
    transaction(_name, mode) {
      const transaction = {error:null};
      transaction.objectStore = () => ({
        add(record) {
          const request = {};
          queueMicrotask(() => {
            request.result = record.fileId; request.onsuccess?.();
            queueMicrotask(() => {
              if (control.abortWrites) {
                transaction.error = Object.assign(new Error('测试事务写入中止'),{name:'QuotaExceededError'});
                transaction.onabort?.();
              } else { records.set(record.fileId, record); transaction.oncomplete?.(); }
            });
          });
          return request;
        },
        get(id) {
          const request = {};
          queueMicrotask(() => {
            if (control.failReads) { transaction.error = new Error('测试读取失败'); transaction.onerror?.(); return; }
            request.result = records.get(id); request.onsuccess?.(); transaction.oncomplete?.();
          });
          return request;
        }
      });
      return transaction;
    }
  };
  const indexedDB = {open() {const request = {}; queueMicrotask(() => {request.result = database; request.onsuccess?.();}); return request;}};
  return {indexedDB,records,control};
}
const file = (contents, name='会议纪要 中文.txt', type='text/plain') => Object.assign(new Blob([contents],{type}),{name});

test('附件二进制提交后读回，保留文件名；完整备份可解码原字节并去重',async()=>{
  const storage=disk(), files=createMeetingFiles({indexedDB:storage.indexedDB});
  const bytes=Uint8Array.from([0,255,128,1,2,13,10]), original=file(bytes,'纪要 • 原文.bin','application/octet-stream');
  const info=await files.put(original);
  assert.match(info.fileId,/^meeting-file-/);assert.equal(info.fileName,original.name);assert.equal(info.mimeType,original.type);assert.equal(info.size,bytes.length);
  const saved=await files.get(info.fileId);assert.deepEqual(new Uint8Array(await saved.arrayBuffer()),bytes);
  const backup=await files.exportFiles([info.fileId,info.fileId]);assert.equal(backup.length,1);assert.deepEqual({...backup[0],data:undefined},{...info,data:undefined});
  assert.deepEqual(Uint8Array.from(atob(backup[0].data),char=>char.charCodeAt(0)),bytes);
  assert.deepEqual(await files.exportFiles([]),[]);
});

test('请求成功但事务中止时不报告附件已保存，原附件不受影响',async()=>{
  const storage=disk(), files=createMeetingFiles({indexedDB:storage.indexedDB});
  const first=await files.put(file('原附件'));storage.control.abortWrites=true;
  await assert.rejects(files.put(file('新附件')),/存储空间不足/);
  assert.equal(storage.records.size,1);assert.equal(await (await files.get(first.fileId)).text(),'原附件');
});

test('无存储支持、超限或无效输入明确失败，不触发文件写入',async()=>{
  const storage=disk(), files=createMeetingFiles({indexedDB:storage.indexedDB});
  await assert.rejects(files.put({name:'fake',size:1}),/有效的本地文件/);
  await assert.rejects(files.put(new Blob([new Uint8Array(MAX_MEETING_FILE_BYTES+1)])),/不能超过 20 MB/);
  assert.equal(storage.records.size,0);
  await assert.rejects(createMeetingFiles({indexedDB:{}}).put(file('x')),/不支持本地附件存储/);
});

test('缺失、损坏和读取失败不会被当作有效或完整备份',async()=>{
  const storage=disk(), files=createMeetingFiles({indexedDB:storage.indexedDB});
  assert.equal(await files.get('missing'),null);
  await assert.rejects(files.exportFiles(['missing']),/无法导出完整备份/);
  await assert.rejects(files.get(''),/标识无效/);
  const info=await files.put(file('真实内容'));storage.records.get(info.fileId).size=9;
  await assert.rejects(files.get(info.fileId),/记录不完整/);
  storage.control.failReads=true;
  await assert.rejects(files.get('missing'),/附件读取失败/);
});
