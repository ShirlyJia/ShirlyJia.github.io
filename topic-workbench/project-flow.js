import {isClosedProject} from './workbench-model.js';

/** Project-owned, optional progress notes. Node order never imposes a workflow. */
const clone = value => JSON.parse(JSON.stringify(value));
const object = value => value && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const defaultNodes = () => [
  {id:'start', title:'开始', closesProject:false},
  {id:'doing', title:'进行中', closesProject:false},
  {id:'closed', title:'已关闭', closesProject:true}
];

export function validateProjectFlow(flow, path = 'flow') {
  if (flow === undefined) return true;
  if (!object(flow) || !Array.isArray(flow.nodes)) throw Error(`${path} 必须包含节点数组`);
  const ids = new Set();
  for (const node of flow.nodes) {
    if (!object(node) || typeof node.id !== 'string' || !node.id.trim() || ids.has(node.id)) throw Error(`${path} 节点标识无效或重复`);
    if (typeof node.title !== 'string' || !node.title.trim()) throw Error(`${path} 节点名称不能为空`);
    if (typeof node.closesProject !== 'boolean') throw Error(`${path} 节点结束标记必须为布尔值`);
    ids.add(node.id);
  }
  if (flow.currentId !== null && (typeof flow.currentId !== 'string' || !ids.has(flow.currentId))) throw Error(`${path} 当前节点不存在`);
  return true;
}

/** Reads old projects without migrating, resetting, or writing them. */
export function readProjectFlow(project) {
  if (project?.flow !== undefined) {
    validateProjectFlow(project.flow);
    return clone(project.flow);
  }
  return {nodes:defaultNodes(), currentId:isClosedProject(project) ? 'closed' : 'doing'};
}

function saveFlow(project, flow) {
  if (!object(project)) throw Error('项目格式无效');
  validateProjectFlow(flow);
  project.flow = flow;
}
function nodeId(flow, factory) {
  const id = factory ? factory() : 'flow-' + globalThis.crypto.randomUUID();
  if (typeof id !== 'string' || !id.trim() || flow.nodes.some(node => node.id === id)) throw Error('新节点标识无效或重复');
  return id;
}
function titleText(title) {
  if (typeof title !== 'string' || !title.trim()) throw Error('节点名称不能为空');
  return title.trim();
}
function today() {
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
}
function closingDate(project, date) {
  if (project.closedAt) return project.closedAt;
  const value = date ?? today();
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(value + 'T00:00:00Z')) || new Date(value + 'T00:00:00Z').toISOString().slice(0,10) !== value) throw Error('结束日期格式无效');
  return value;
}

export function renameFlowNode(project, id, title) {
  const flow = readProjectFlow(project), node = flow.nodes.find(item => item.id === id);
  if (!node) return false;
  node.title = titleText(title);
  saveFlow(project, flow);
  return true;
}

/** Empty flows stay empty until the user explicitly inserts a node. */
export function insertFlowNode(project, afterId = null, {title = '新节点', idFactory} = {}) {
  const flow = readProjectFlow(project);
  const index = afterId === null ? flow.nodes.length - 1 : flow.nodes.findIndex(node => node.id === afterId);
  if (afterId !== null && index < 0) throw Error('插入位置不存在');
  const node = {id:nodeId(flow,idFactory), title:titleText(title), closesProject:false};
  flow.nodes.splice(index + 1, 0, node);
  saveFlow(project, flow);
  return clone(node);
}

export function removeFlowNode(project, id) {
  const flow = readProjectFlow(project), index = flow.nodes.findIndex(node => node.id === id);
  if (index < 0) return false;
  const removed = flow.nodes[index];
  flow.nodes.splice(index, 1);
  if (flow.currentId === id) {
    const candidates = flow.nodes.map((node, position) => ({node,position}))
      .filter(({node}) => node.closesProject === removed.closesProject)
      .sort((a,b) => Math.abs(a.position-index)-Math.abs(b.position-index) || a.position-b.position);
    flow.currentId = candidates[0]?.node.id ?? null;
  }
  saveFlow(project, flow);
  return true;
}

/** Absolute zero-based destination; moving labels never closes/reopens the project. */
export function moveFlowNode(project, id, toIndex) {
  const flow = readProjectFlow(project), index = flow.nodes.findIndex(node => node.id === id);
  if (index < 0) return false;
  if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= flow.nodes.length) return false;
  if (index === toIndex) return false;
  const [node] = flow.nodes.splice(index, 1);
  flow.nodes.splice(toIndex, 0, node);
  saveFlow(project, flow);
  return true;
}

/** An explicit node marker, independent of its wording or position. */
export function setFlowNodeClosing(project, id, closesProject) {
  if (typeof closesProject !== 'boolean') throw Error('结束标记必须为布尔值');
  const flow = readProjectFlow(project), node = flow.nodes.find(item => item.id === id);
  if (!node) return false;
  node.closesProject = closesProject;
  saveFlow(project, flow);
  return true;
}

/** Selecting a node is an explicit progress action; it is not a transition gate. */
export function setCurrentFlowNode(project, id, {date} = {}) {
  const flow = readProjectFlow(project), node = flow.nodes.find(item => item.id === id);
  if (!node) return false;
  const closedAt = node.closesProject ? closingDate(project,date) : project.closedAt;
  flow.currentId = id;
  saveFlow(project, flow);
  project.closed = node.closesProject;
  if (node.closesProject) project.closedAt = closedAt;
  return true;
}

/** Keeps the existing finish/reopen action aligned with editable process nodes. */
export function setProjectClosed(project, closed, {date, idFactory} = {}) {
  if (typeof closed !== 'boolean') throw Error('项目结束状态必须为布尔值');
  const flow = readProjectFlow(project), current = flow.nodes.find(node => node.id === flow.currentId);
  const closedAt = closed ? closingDate(project,date) : project.closedAt;
  if (closed) {
    let target = current?.closesProject ? current : flow.nodes.find(node => node.closesProject);
    if (!target) {
      target = {id:nodeId(flow,idFactory),title:'已关闭',closesProject:true};
      flow.nodes.push(target);
    }
    flow.currentId = target.id;
  } else if (!current || current.closesProject) {
    const currentIndex = flow.nodes.findIndex(node => node.id === flow.currentId);
    const before = flow.nodes.slice(0,currentIndex < 0 ? flow.nodes.length : currentIndex).filter(node => !node.closesProject);
    flow.currentId = before.at(-1)?.id ?? flow.nodes.find(node => !node.closesProject)?.id ?? null;
  }
  saveFlow(project, flow);
  project.closed = closed;
  if (closed) project.closedAt = closedAt;
  return true;
}
