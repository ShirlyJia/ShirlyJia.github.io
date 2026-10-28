/** Local meeting attachments. Binary data stays in IndexedDB, never sent to a server. */
import {storageKey} from './deployment-config.js';
export const MAX_MEETING_FILE_BYTES = 20 * 1024 * 1024;
const DATABASE_NAME = storageKey('topic-workbench-meeting-files');
const STORE_NAME = 'files';

function storageError(error, action) {
  if (error?.name === 'QuotaExceededError') return new Error('浏览器存储空间不足，附件未保存；请先导出备份或选择较小文件');
  if (error?.name === 'SecurityError' || error?.name === 'NotAllowedError') return new Error('此浏览器不允许保存本地附件，请检查存储权限');
  return new Error(`${action}：${error?.message || '本地文件存储不可用'}`);
}

function metadata(record) {
  return {fileId:record.fileId, fileName:record.fileName, mimeType:record.mimeType, size:record.size};
}

function validRecord(record) {
  return record && typeof record.fileId === 'string' && typeof record.fileName === 'string' &&
    typeof record.mimeType === 'string' && Number.isInteger(record.size) && record.size >= 0 &&
    record.blob instanceof Blob && record.blob.size === record.size;
}

function base64(bytes) {
  let text = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    text += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  }
  return btoa(text);
}

/** Options allow a caller to inject an IndexedDB factory for isolated verification. */
export function createMeetingFiles(options = {}) {
  let connection = null;
  function open() {
    if (connection) return connection;
    connection = new Promise((resolve, reject) => {
      let request;
      try {
        const factory = options.indexedDB ?? globalThis.indexedDB;
        if (!factory?.open) throw new Error('此浏览器不支持本地附件存储');
        request = factory.open(options.dbName || DATABASE_NAME, 1);
      } catch (error) { reject(storageError(error, '无法打开附件存储')); return; }
      let rejected = false;
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, {keyPath:'fileId'});
      };
      request.onblocked = () => {
        rejected = true;
        reject(new Error('附件存储正在被其他页面占用，请关闭旧会议页面后重试'));
      };
      request.onerror = () => reject(storageError(request.error, '无法打开附件存储'));
      request.onsuccess = () => {
        if (rejected) { request.result.close(); return; }
        const database = request.result;
        database.onversionchange = () => { database.close(); connection = null; };
        database.onclose = () => { connection = null; };
        resolve(database);
      };
    }).catch(error => { connection = null; throw error; });
    return connection;
  }

  async function transact(mode, action) {
    const database = await open();
    return new Promise((resolve, reject) => {
      let transaction, request, result;
      try {
        transaction = database.transaction(STORE_NAME, mode);
        request = action(transaction.objectStore(STORE_NAME));
      } catch (error) { reject(storageError(error, mode === 'readwrite' ? '附件保存失败' : '附件读取失败')); return; }
      request.onsuccess = () => { result = request.result; };
      // A request's success is provisional. Resolve only after the entire transaction commits.
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(storageError(transaction.error || request.error, mode === 'readwrite' ? '附件保存失败' : '附件读取失败'));
      transaction.onabort = () => reject(storageError(transaction.error || request.error || new Error('事务已中止'), mode === 'readwrite' ? '附件保存失败' : '附件读取失败'));
    });
  }

  async function readRecord(fileId) {
    if (typeof fileId !== 'string' || !fileId) throw new Error('附件标识无效');
    const record = await transact('readonly', store => store.get(fileId));
    if (record === undefined || record === null) return null;
    if (!validRecord(record) || record.fileId !== fileId) throw new Error('本地附件记录不完整，未覆盖原数据');
    return record;
  }

  return {
    async put(file) {
      if (!(file instanceof Blob)) throw new Error('请选择有效的本地文件');
      if (file.size > MAX_MEETING_FILE_BYTES) throw new Error('单个附件不能超过 20 MB，请选择较小文件或添加飞书链接');
      const crypto = options.crypto ?? globalThis.crypto;
      if (!crypto?.randomUUID) throw new Error('此浏览器无法生成附件标识，请换用支持本地文件存储的浏览器');
      const record = {
        fileId:`meeting-file-${crypto.randomUUID()}`,
        fileName:typeof file.name === 'string' && file.name ? file.name : '未命名资料',
        mimeType:file.type || 'application/octet-stream', size:file.size, blob:file
      };
      await transact('readwrite', store => store.add(record));
      const saved = await readRecord(record.fileId);
      if (!saved || saved.fileName !== record.fileName || saved.size !== record.size || saved.mimeType !== record.mimeType) {
        throw new Error('附件保存后校验未通过，请重试；原会议内容未改动');
      }
      return metadata(saved);
    },
    async get(fileId) {
      const record = await readRecord(fileId);
      return record?.blob || null;
    },
    async exportFiles(fileIds) {
      if (!Array.isArray(fileIds) || fileIds.some(id => typeof id !== 'string' || !id)) throw new Error('附件备份清单无效');
      const files = [];
      for (const fileId of new Set(fileIds)) {
        const record = await readRecord(fileId);
        if (!record) throw new Error('有附件未能在此浏览器中找到，无法导出完整备份；请补回附件后重试');
        files.push({...metadata(record), data:base64(new Uint8Array(await record.blob.arrayBuffer()))});
      }
      return files;
    }
  };
}
