import {createPersistence} from './persistence.js';
import {detachSourceMetadata} from './source-detach.js';

const limit = 20;
const clone = value => JSON.parse(JSON.stringify(value));
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const makeError = (code, message) => Object.assign(new Error(message), {code});

/** Independent snapshots only; no method restores or modifies the main workbench key. */
export function createSnapshotStore({key = 'topic-workbench-snapshots-v1', storage, onStatus,
  now = () => new Date().toISOString(), idFactory = () => globalThis.crypto.randomUUID()} = {}) {
  if (typeof key !== 'string' || !key.trim()) throw makeError('INVALID_KEY', '快照存储 key 不能为空');
  if (key === 'topic-workbench-v2') throw makeError('INVALID_KEY', '快照不能使用主工作台的存储 key');
  const validateData = createPersistence().validate;
  const backend = () => storage ?? globalThis.localStorage;

  function report(ok, message) {
    try { if (typeof onStatus === 'function') onStatus({ok, message}); } catch { /* UI-owned */ }
  }

  function run(operation) {
    try { return operation(); }
    catch (error) { report(false, error.message || '快照操作失败'); throw error; }
  }

  function validateContainer(value) {
    if (!isObject(value) || value.schemaVersion !== 1 || !Array.isArray(value.snapshots) || value.snapshots.length > limit) {
      throw Error('快照存储结构无效');
    }
    const ids = new Set();
    for (const snapshot of value.snapshots) {
      if (!isObject(snapshot) || typeof snapshot.id !== 'string' || !snapshot.id.trim() || ids.has(snapshot.id) ||
          typeof snapshot.name !== 'string' || !snapshot.name.trim() || typeof snapshot.createdAt !== 'string' ||
          !Number.isFinite(Date.parse(snapshot.createdAt))) throw Error('快照记录无效');
      ids.add(snapshot.id);
      validateData(snapshot.data);
    }
    // Metadata is part of the saved JSON too; forbid polluted objects at any depth.
    function safe(value) {
      if (!value || typeof value !== 'object') return;
      for (const key of Object.keys(value)) {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) throw Error('快照含不允许的字段');
        safe(value[key]);
      }
    }
    safe(value);
  }

  function readContainer() {
    const raw = backend().getItem(key);
    if (raw === null) return {schemaVersion: 1, snapshots: []};
    let value;
    try {
      value = JSON.parse(raw);
      validateContainer(value);
    } catch (error) {
      throw makeError('SNAPSHOT_CORRUPT', '快照记录无法读取，原记录已保留：' + error.message);
    }
    let changed = false;
    const snapshots = value.snapshots.map(snapshot => {
      const detached = detachSourceMetadata(snapshot.data);
      changed ||= detached.changed;
      return {...snapshot, data: detached.data};
    });
    if (!changed) return value;
    const cleaned = {...value, snapshots};
    validateContainer(cleaned);
    try { backend().setItem(key, JSON.stringify(cleaned)); }
    catch (error) { throw makeError('SNAPSHOT_CLEANUP_FAILED', '快照来源信息清理未保存，原记录已保留：' + error.message); }
    return cleaned;
  }

  function capture(name, data) {
    return run(() => {
      if (typeof name !== 'string' || !name.trim()) throw makeError('INVALID_NAME', '请填写快照名称');
      validateData(data);
      const current = readContainer();
      if (current.snapshots.length >= limit) throw makeError('SNAPSHOT_LIMIT', '已保存 20 个快照，请先明确删除不再需要的快照');
      const snapshot = {id: idFactory(), name: name.trim(), createdAt: now(), data: detachSourceMetadata(clone(data)).data};
      const next = {...current, snapshots: [snapshot, ...current.snapshots]};
      validateContainer(next);
      backend().setItem(key, JSON.stringify(next));
      report(true, '快照已保存');
      return clone(snapshot);
    });
  }

  function list() {
    return run(() => readContainer().snapshots.map(snapshot => ({id: snapshot.id, name: snapshot.name, createdAt: snapshot.createdAt,
      projectCount: snapshot.data.projects.length, boardCount: snapshot.data.quickBoards?.length || 0})));
  }

  function read(id) {
    return run(() => {
      const snapshot = readContainer().snapshots.find(item => item.id === id);
      return snapshot ? clone(snapshot) : null;
    });
  }

  function remove(id) {
    return run(() => {
      const current = readContainer(), snapshots = current.snapshots.filter(snapshot => snapshot.id !== id);
      if (snapshots.length === current.snapshots.length) return false;
      backend().setItem(key, JSON.stringify({...current, snapshots}));
      report(true, '快照已删除');
      return true;
    });
  }

  function exportJson(id) {
    return run(() => {
      const current = readContainer();
      if (id === undefined) return JSON.stringify(current, null, 2);
      const snapshot = current.snapshots.find(item => item.id === id);
      if (!snapshot) throw makeError('SNAPSHOT_NOT_FOUND', '快照不存在');
      return JSON.stringify(snapshot, null, 2);
    });
  }

  function exportRaw() {
    return run(() => {
      const raw = backend().getItem(key);
      if (raw === null) return null;
      try { validateContainer(JSON.parse(raw)); }
      catch { return raw; } // Keep damaged records recoverable without rewriting them.
      readContainer();
      return backend().getItem(key);
    });
  }

  return {capture, list, read, remove, export: exportJson, exportRaw};
}
