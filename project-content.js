/** One-time migration to problem statements, comments, and explicit completion. */
import {isClosedProject} from './workbench-model.js';

const clone = value => JSON.parse(JSON.stringify(value));
const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

export function enrichProjectContent(input) {
  const data = clone(input);
  if (data.schemaVersion !== 2 || !Array.isArray(data.projects)) throw Error('项目内容迁移需要有效的 schemaVersion 2 数据');
  if (data.projectContentVersion !== undefined && data.projectContentVersion !== 1) throw Error('不支持此项目内容版本');
  if (data.projectContentVersion === 1) return data;

  for (const project of data.projects) {
    if (!has(project, 'closed')) project.closed = isClosedProject(project);
    if (typeof project.closed !== 'boolean') throw Error('项目 closed 必须为布尔值');
    if (!has(project, 'comments')) project.comments = [];
    if (!Array.isArray(project.comments)) throw Error('项目 comments 必须为数组');
    if (!has(project, 'customSections')) project.customSections = [];
    if (!Array.isArray(project.customSections)) throw Error('项目 customSections 必须为数组');

    // Keep the exact old wording; its recording time is unknown, so never invent one.
    if (typeof project.summary === 'string' && project.summary.trim()) {
      const base = 'legacy-summary-' + project.id;
      const existing = project.comments.find(comment => comment?.id === base && comment.body === project.summary);
      if (!existing) {
        const used = new Set(project.comments.map(comment => comment?.id));
        let id = base, suffix = 2;
        while (used.has(id)) id = base + '-' + suffix++;
        project.comments.push({id, body: project.summary, createdAt: '', author: '原最新结论'});
      }
      project.summary = '';
    }
  }
  data.projectContentVersion = 1;
  return data;
}
