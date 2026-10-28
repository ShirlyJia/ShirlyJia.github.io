import {validateDelivery} from './delivery-model.js';
import {validateCanvasItems} from './canvas-items.js';
import {validateProjectFlow} from './project-flow.js';
/** Local-only, schema-v2 persistence. No seed writes, remote calls, or business workflow rules. */
export function createPersistence({ key = 'topic-workbench-v2', onStatus } = {}) {
  if (typeof key !== 'string' || !key.trim()) throw new Error('存储 key 必须是非空字符串');

  const dangerousKeys = new Set(['__proto__', 'prototype', 'constructor']);
  const history = [];
  let lastSaved = null;

  function report(status) {
    // A rendering error must not turn a successful storage write into a failed commit.
    try { if (typeof onStatus === 'function') onStatus(status); } catch (_) { /* UI-owned */ }
  }

  function fail(message) { throw new Error(message); }

  function record(value, path) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${path} 必须是对象`);
  }

  function array(value, path) {
    if (!Array.isArray(value)) fail(`${path} 必须是数组`);
  }

  function text(value, path) {
    if (typeof value !== 'string' || !value.trim()) fail(`${path} 必须是非空字符串`);
  }

  function finite(value, path, positive = false) {
    if (!Number.isFinite(value) || (positive && value <= 0)) {
      fail(`${path} 必须是${positive ? '大于零的' : ''}有限数值`);
    }
  }

  function color(value, path) {
    if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) fail(`${path} 必须为六位十六进制颜色`);
  }

  function safeJson(value, path = '$', ancestors = new Set()) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number') { finite(value, path); return; }
    if (typeof value !== 'object') fail(`${path} 不是可保存的 JSON 值`);
    if (ancestors.has(value)) fail(`${path} 含循环对象引用`);
    const prototype = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
      fail(`${path} 必须是普通 JSON 对象`);
    }
    ancestors.add(value);
    for (const name of Object.keys(value)) {
      if (dangerousKeys.has(name)) fail(`${path} 含不允许的字段 ${name}`);
      safeJson(value[name], `${path}.${name}`, ancestors);
    }
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) fail(`${path}[${index}] 不能为空数组项`);
      }
    }
    ancestors.delete(value);
  }

  function indexed(rows, path) {
    array(rows, path);
    const ids = new Set();
    rows.forEach((row, index) => {
      record(row, `${path}[${index}]`);
      text(row.id, `${path}[${index}].id`);
      if (ids.has(row.id)) fail(`${path} 中的 ID 重复：${row.id}`);
      ids.add(row.id);
    });
    return ids;
  }

  function references(values, validIds, path) {
    array(values, path);
    const seen = new Set();
    values.forEach((id, index) => {
      text(id, `${path}[${index}]`);
      if (!validIds.has(id)) fail(`${path} 引用了不存在的 ID：${id}`);
      if (seen.has(id)) fail(`${path} 重复引用 ID：${id}`);
      seen.add(id);
    });
  }

  function optionalStrings(value, fields, path) {
    for (const field of fields) {
      if (value[field] !== undefined && typeof value[field] !== 'string') {
        fail(`${path}.${field} 必须是字符串`);
      }
    }
  }

  function richTextShape(value, fields, path) {
    if (value === undefined) return;
    record(value, path);
    for (const [field, html] of Object.entries(value)) {
      if (!fields.includes(field)) fail(`${path}.${field} 不是可编辑的富文本字段`);
      if (typeof html !== 'string') fail(`${path}.${field} 必须是字符串`);
    }
  }

  function sourceShape(value, path) {
    if (value === undefined || value === null) return;
    record(value, path);
    optionalStrings(value, ['sourceUrl', 'originalName'], path);
    for (const field of ['sourceFields', 'sourceOwners']) {
      if (value[field] === undefined || value[field] === null) continue;
      array(value[field], `${path}.${field}`);
      value[field].forEach((item, index) => {
        const itemPath = `${path}.${field}[${index}]`;
        record(item, itemPath);
        optionalStrings(item, field === 'sourceOwners' ? ['name', 'role'] : ['label'], itemPath);
      });
    }
  }

  function materialUrl(value, path) {
    text(value, path);
    let url;
    try { url = new URL(value); } catch (_) { fail(`${path} 必须是有效的 http 或 https 链接`); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      fail(`${path} 必须是有效且不含登录凭据的 http 或 https 链接`);
    }
  }

  /** Returns true, or throws Error. Unknown JSON fields survive unchanged. */
  function validate(data) {
    safeJson(data);
    record(data, 'data');
    if (data.schemaVersion !== 2) fail('schemaVersion 必须为 2');
    if (data.projectContentVersion !== undefined && data.projectContentVersion !== 1) fail('projectContentVersion 必须为 1');
    if (data.domainTagVersion !== undefined && data.domainTagVersion !== 1) fail('domainTagVersion 必须为 1');
    if (data.workbenchVersion !== undefined && data.workbenchVersion !== 1) fail('workbenchVersion 必须为 1');
    if (data.sourceDetachedVersion !== undefined && data.sourceDetachedVersion !== 1) fail('sourceDetachedVersion 必须为 1');
    sourceShape(data.source, 'source');
    validateDelivery(data);

    const projectIds = indexed(data.projects, 'projects');
    const tagIds = indexed(data.tags, 'tags');
    indexed(data.relations, 'relations');
    indexed(data.frames, 'frames');
    const instanceIds = indexed(data.instances, 'instances');
    if (data.canvasItems !== undefined) validateCanvasItems(data.canvasItems);

    data.tags.forEach((tag, index) => {
      text(tag.name, `tags[${index}].name`);
      if (tag.color !== undefined) color(tag.color, `tags[${index}].color`);
      if (tag.rank !== undefined) finite(tag.rank, `tags[${index}].rank`);
    });
    data.projects.forEach((project, index) => {
      const path = `projects[${index}]`;
      text(project.name, `${path}.name`);
      references(project.tagIds, tagIds, `${path}.tagIds`);
      optionalStrings(project, ['kind', 'priority', 'status', 'summary', 'description', 'result', 'outcome', 'closedAt', 'impact', 'commentDraft', 'commentAuthor'], path);
      richTextShape(project.richText, ['description', 'result', 'impact', 'commentDraft'], `${path}.richText`);
      if (project.closed !== undefined && typeof project.closed !== 'boolean') fail(`${path}.closed 必须为布尔值`);
      validateProjectFlow(project.flow, `${path}.flow`);
      if (project.comments !== undefined) {
        indexed(project.comments, `${path}.comments`);
        project.comments.forEach((comment, commentIndex) => {
          const commentPath = `${path}.comments[${commentIndex}]`;
          for (const field of ['body', 'createdAt']) if (typeof comment[field] !== 'string') fail(`${commentPath}.${field} 必须是字符串`);
          optionalStrings(comment, ['author', 'updatedAt'], commentPath);
          richTextShape(comment.richText, ['body'], `${commentPath}.richText`);
        });
      }
      if (project.customSections !== undefined) {
        indexed(project.customSections, `${path}.customSections`);
        project.customSections.forEach((section, sectionIndex) => {
          const sectionPath = `${path}.customSections[${sectionIndex}]`;
          for (const field of ['title', 'body']) if (typeof section[field] !== 'string') fail(`${sectionPath}.${field} 必须是字符串`);
          richTextShape(section.richText, ['body'], `${sectionPath}.richText`);
        });
      }
      if (project.detailLayout !== undefined) {
        const layout=project.detailLayout,layoutPath=`${path}.detailLayout`;
        record(layout,layoutPath);
        for(const field of ['order','hidden']) {
          if(layout[field] === undefined) continue;
          array(layout[field],`${layoutPath}.${field}`);
          const seen=new Set();
          layout[field].forEach((key,index)=>{text(key,`${layoutPath}.${field}[${index}]`);if(seen.has(key))fail(`${layoutPath}.${field} 栏目重复`);seen.add(key);});
        }
        if(layout.titles !== undefined) {
          record(layout.titles,`${layoutPath}.titles`);
          for(const [key,value] of Object.entries(layout.titles))if(typeof value !== 'string')fail(`${layoutPath}.titles.${key} 必须是字符串`);
        }
      }
      sourceShape(project.source, `${path}.source`);
      // Only rendering/editing shape is required. Business fields may stay empty
      // or absent; no owner, date, outcome, or workflow gate is imposed.
      indexed(project.planNodes, `${path}.planNodes`);
      project.planNodes.forEach((node, nodeIndex) => {
        const nodePath = `${path}.planNodes[${nodeIndex}]`;
        optionalStrings(node, ['title', 'owner', 'targetDate', 'estimatedDate', 'status', 'note'], nodePath);
        richTextShape(node.richText, ['note'], `${nodePath}.richText`);
        for (const field of ['focus', 'dateConfirmed']) {
          if (node[field] !== undefined && typeof node[field] !== 'boolean') {
            fail(`${nodePath}.${field} 必须是布尔值`);
          }
        }
      });
      indexed(project.materials, `${path}.materials`);
      project.materials.forEach((material, materialIndex) => {
        const materialPath = `${path}.materials[${materialIndex}]`;
        optionalStrings(material, ['title'], materialPath);
        materialUrl(material.url, `${materialPath}.url`);
      });
    });

    const children = new Map([...projectIds].map(id => [id, []]));
    const incoming = new Map([...projectIds].map(id => [id, 0]));
    data.relations.forEach((relation, index) => {
      const path = `relations[${index}]`;
      richTextShape(relation.richText, ['context'], `${path}.richText`);
      if (!projectIds.has(relation.main) || !projectIds.has(relation.child)) {
        fail(`${path} 的主项目或小项目不存在`);
      }
      if (relation.main === relation.child) fail(`${path} 不能关联项目自身`);
      children.get(relation.main).push(relation.child);
      incoming.set(relation.child, incoming.get(relation.child) + 1);
    });
    // Kahn's algorithm: multiple parents are valid; directed cycles are not.
    const queue = [...projectIds].filter(id => incoming.get(id) === 0);
    for (let head = 0; head < queue.length; head += 1) {
      for (const child of children.get(queue[head])) {
        incoming.set(child, incoming.get(child) - 1);
        if (incoming.get(child) === 0) queue.push(child);
      }
    }
    if (queue.length !== projectIds.size) fail('主项目与小项目的关联不能构成方向环');

    data.instances.forEach((instance, index) => {
      richTextShape(instance.richText, ['context'], `instances[${index}].richText`);
      if (!projectIds.has(instance.pid)) fail(`instances[${index}] 引用的项目不存在`);
      finite(instance.x, `instances[${index}].x`);
      finite(instance.y, `instances[${index}].y`);
    });
    data.frames.forEach((frame, index) => {
      const path = `frames[${index}]`;
      text(frame.name, `${path}.name`);
      finite(frame.x, `${path}.x`);
      finite(frame.y, `${path}.y`);
      finite(frame.w, `${path}.w`, true);
      finite(frame.h, `${path}.h`, true);
      references(frame.members, instanceIds, `${path}.members`);
      if (frame.color !== undefined) color(frame.color, `${path}.color`);
    });
    if (data.quickBoards !== undefined) {
      indexed(data.quickBoards, 'quickBoards');
      data.quickBoards.forEach((board, index) => {
        const path = `quickBoards[${index}]`;
        text(board.name, `${path}.name`);
        color(board.color, `${path}.color`);
        finite(board.rank, `${path}.rank`);
        if (typeof board.notes !== 'string') fail(`${path}.notes 必须是字符串`);
        references(board.projectIds, projectIds, `${path}.projectIds`);
        references(board.emphasisIds, new Set(board.projectIds), `${path}.emphasisIds`);
        if (board.contexts !== undefined) {
          record(board.contexts, `${path}.contexts`);
          for (const [pid, context] of Object.entries(board.contexts)) {
            if (!board.projectIds.includes(pid)) fail(`${path}.contexts 引用了不在本板的项目：${pid}`);
            if (typeof context !== 'string') fail(`${path}.contexts.${pid} 必须是字符串`);
          }
        }
      });
    }
    record(data.view, 'view');
    finite(data.view.x, 'view.x');
    finite(data.view.y, 'view.y');
    finite(data.view.z, 'view.z', true);
    return true;
  }

  function message(error, prefix) {
    return `${prefix}：${error instanceof Error ? error.message : String(error)}`;
  }

  /**
   * Never writes. error is null or a user-readable string. On damaged/unreadable
   * storage the caller must block replacement until the user chooses recovery;
   * the original key remains available for exporting its raw contents.
   */
  function load(seed) {
    let seedJson;
    try { validate(seed); seedJson = JSON.stringify(seed); }
    catch (error) { report({ ok: false, message: message(error, '初始数据无效') }); throw error; }
    history.length = 0;
    lastSaved = null;
    try {
      const raw = globalThis.localStorage.getItem(key);
      if (raw === null) return { data: JSON.parse(seedJson), fromStorage: false, error: null };
      let data;
      try { data = JSON.parse(raw); } catch (_) { fail('本机记录不是有效 JSON'); }
      validate(data);
      lastSaved = JSON.stringify(data);
      return { data, fromStorage: true, error: null };
    } catch (error) {
      const detail = message(error, '无法读取本机记录，原记录已保留');
      report({ ok: false, message: detail });
      return { data: JSON.parse(seedJson), fromStorage: false, error: detail };
    }
  }

  /** View-only writes may opt out of history; every successful write updates the baseline. */
  function commit(data, { recordHistory = true } = {}) {
    try {
      validate(data);
      const next = JSON.stringify(data);
      globalThis.localStorage.setItem(key, next);
      if (recordHistory && lastSaved !== null && lastSaved !== next) {
        history.push(lastSaved);
        if (history.length > 10) history.shift();
      }
      lastSaved = next;
      report({ ok: true, message: '已保存到此浏览器' });
      return JSON.parse(next);
    } catch (error) {
      report({ ok: false, message: message(error, '保存失败') });
      throw error;
    }
  }

  function peekUndo() { return history.length ? JSON.parse(history[history.length - 1]) : null; }

  function undo({transform} = {}) {
    if (!history.length) return null;
    const previous = history[history.length - 1];
    try {
      let data = JSON.parse(previous);
      if(transform!==undefined){if(typeof transform!=='function')fail('撤销转换必须是函数');const transformed=transform(data);if(transformed!==undefined)data=transformed;}
      validate(data);
      const next=JSON.stringify(data);
      globalThis.localStorage.setItem(key, next);
      history.pop();
      lastSaved = next;
      report({ ok: true, message: '已保存到此浏览器' });
      return data;
    } catch (error) {
      report({ ok: false, message: message(error, '撤销未保存') });
      throw error;
    }
  }

  /** Export only: does not mutate storage, undo, or save status. */
  function download(data) {
    let url;
    let anchor;
    try {
      // A raw string can also be exported unchanged for damaged-record recovery.
      const contents = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
      if (typeof contents !== 'string') fail('没有可导出的内容');
      const blob = new Blob([contents], { type: 'application/json;charset=utf-8' });
      url = URL.createObjectURL(blob);
      anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'topic-workbench-backup.json';
      anchor.hidden = true;
      document.body.append(anchor);
      anchor.click();
      return anchor.download;
    } catch (error) {
      report({ ok: false, message: message(error, '导出失败') });
      throw error;
    } finally {
      if (anchor) anchor.remove();
      if (url) setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  return { load, commit, undo, peekUndo, canUndo: () => history.length > 0, download, validate };
}
