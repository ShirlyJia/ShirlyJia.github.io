/** Free canvas annotations are presentation objects, separate from project facts. */
const types = new Set(['text','note','line','arrow']);
const lineTypes = new Set(['line','arrow']);
export const NOTE_YELLOW = '#f7e8ab';

/** Restore existing notes once; later manual colour choices remain user-owned. */
export function restoreYellowNotes(input) {
  const data = JSON.parse(JSON.stringify(input));
  if (data.schemaVersion !== 2) throw Error('便签样式需要 schemaVersion 2 数据');
  if (data.canvasNoteStyleVersion !== undefined && data.canvasNoteStyleVersion !== 1) throw Error('不支持此便签样式版本');
  if (data.canvasNoteStyleVersion === 1) return data;
  if (data.canvasItems !== undefined) validateCanvasItems(data.canvasItems);
  for (const item of data.canvasItems || []) if (item.type === 'note') item.color = NOTE_YELLOW;
  data.canvasNoteStyleVersion = 1;
  return data;
}
const finite = (value, label) => {
  if (!Number.isFinite(value)) throw Error(`${label} 必须为有限数值`);
};
const positive = (value, label) => {
  finite(value,label);
  if (value <= 0) throw Error(`${label} 必须大于零`);
};
const inRange = (value,min,max,label) => {
  finite(value,label);
  if (value < min || value > max) throw Error(`${label} 须在 ${min}–${max} 之间`);
};

/** Validate known fields without normalizing away future or user-owned JSON data. */
export function validateCanvasItems(items) {
  if (!Array.isArray(items)) throw Error('画板元素必须为数组');
  const ids = new Set();
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw Error('画板元素格式无效');
    if (typeof item.id !== 'string' || !item.id.trim() || ids.has(item.id)) throw Error('画板元素标识无效或重复');
    ids.add(item.id);
    if (!types.has(item.type)) throw Error('画板元素类型无效');
    finite(item.x,'画板横坐标');finite(item.y,'画板纵坐标');
    if (typeof item.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(item.color)) throw Error('画板元素颜色须为六位十六进制颜色');
    if (lineTypes.has(item.type)) {
      finite(item.x2,'线条终点横坐标');finite(item.y2,'线条终点纵坐标');
      inRange(item.strokeWidth,1,12,'线条宽度');
    } else {
      positive(item.w,'文字或便签宽度');positive(item.h,'文字或便签高度');
      if (typeof item.text !== 'string') throw Error('文字或便签内容须为文字');
      inRange(item.fontSize,10,64,'文字大小');
    }
  }
  return true;
}

/** The clicked point is authoritative; options may customize styles and content. */
export function createCanvasItem(type, point, options = {}) {
  if (!point || typeof point !== 'object') throw Error('缺少画板位置');
  if (!types.has(type)) throw Error('画板元素类型无效');
  const defaults = lineTypes.has(type)
    ? {x2:point.x+180,y2:point.y,color:'#78736b',strokeWidth:2}
    : type === 'note'
      ? {w:240,h:180,text:'',color:NOTE_YELLOW,fontSize:18}
      : {w:260,h:72,text:'',color:'#37352f',fontSize:24};
  const item = {...defaults,...options,id:options.id ?? `canvas-${globalThis.crypto.randomUUID()}`,type,x:point.x,y:point.y};
  validateCanvasItems([item]);
  return item;
}

/** Line bounds work in every drawing direction, including zero-length segments. */
export function canvasItemBounds(item) {
  if (lineTypes.has(item.type)) return {
    x:Math.min(item.x,item.x2),y:Math.min(item.y,item.y2),
    w:Math.max(1,Math.abs(item.x2-item.x)),h:Math.max(1,Math.abs(item.y2-item.y))
  };
  return {x:item.x,y:item.y,w:item.w,h:item.h};
}

/** Move in world coordinates, keeping a segment's vector and all content intact. */
export function translateCanvasItem(item,dx,dy) {
  finite(dx,'横向位移');finite(dy,'纵向位移');
  const next={x:item.x+dx,y:item.y+dy};
  if (lineTypes.has(item.type)) {next.x2=item.x2+dx;next.y2=item.y2+dy;}
  for (const value of Object.values(next)) finite(value,'移动后坐标');
  Object.assign(item,next);
  return item;
}
