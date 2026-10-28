/** Recoverable meeting content deletion. Attachment blobs are never removed here. */
const itemFields = {material:'materials', section:'sections'};

function requireData(data) {
  if (!data || !Array.isArray(data.meetings) || !Array.isArray(data.deletedMeetings)) throw Error('会议记录格式无效');
  if (data.deletedItems !== undefined && !Array.isArray(data.deletedItems)) throw Error('已删除内容格式无效');
}

function itemField(kind) {
  if (!Object.prototype.hasOwnProperty.call(itemFields,kind)) throw Error('不支持此删除类型');
  return itemFields[kind];
}

function requireEntry(entry) {
  if (!entry || typeof entry.id !== 'string' || !entry.id || typeof entry.meetingId !== 'string' || !entry.meetingId ||
      !entry.item || typeof entry.item.id !== 'string' || !entry.item.id || !Number.isInteger(entry.index) || entry.index < 0 ||
      typeof entry.deletedAt !== 'string') throw Error('已删除内容格式无效');
  itemField(entry.kind);
}

/** Returns the new trash entry, or null if the item no longer exists. */
export function removeMeetingItem(data, meetingId, kind, itemId, options = {}) {
  requireData(data);
  const field = itemField(kind);
  const meeting = data.meetings.find(row => row.id === meetingId);
  if (!meeting) throw Error('找不到所属会议');
  const items = meeting[field];
  if (items === undefined && kind === 'section') return null;
  if (!Array.isArray(items)) throw Error('会议内容格式无效');
  const index = items.findIndex(item => item?.id === itemId);
  if (index < 0) return null;
  const id = options.id ?? `deleted-item-${globalThis.crypto.randomUUID()}`;
  const deletedAt = options.deletedAt ?? new Date().toISOString();
  const entry = {id,kind,meetingId,item:items[index],index,deletedAt};
  requireEntry(entry);
  if ((data.deletedItems || []).some(row => row.id === id)) throw Error('已删除内容标识重复，未改动原内容');
  // All checks precede changes, keeping errors from consuming either copy.
  if (!data.deletedItems) data.deletedItems = [];
  items.splice(index,1);
  data.deletedItems.push(entry);
  return entry;
}

/** Returns the restored entry; restore its parent meeting first when necessary. */
export function restoreMeetingItem(data, trashId) {
  requireData(data);
  const deleted = data.deletedItems || [];
  const index = deleted.findIndex(entry => entry?.id === trashId);
  if (index < 0) return null;
  const entry = deleted[index];
  requireEntry(entry);
  if (deleted.some((row,i) => i !== index && row.id === trashId)) throw Error('已删除内容标识重复，未恢复');
  const meeting = data.meetings.find(row => row.id === entry.meetingId);
  if (!meeting) {
    if (data.deletedMeetings.some(row => row.meeting?.id === entry.meetingId)) throw Error('请先恢复所属会议');
    throw Error('找不到所属会议，已删除内容仍保留');
  }
  const field = itemField(entry.kind);
  const items = meeting[field] === undefined && entry.kind === 'section' ? [] : meeting[field];
  if (!Array.isArray(items)) throw Error('会议内容格式无效');
  if (items.some(item => item?.id === entry.item.id)) throw Error('同标识内容已存在，未覆盖现有内容');
  if (meeting[field] === undefined) meeting[field] = items;
  items.splice(Math.min(entry.index,items.length),0,entry.item);
  deleted.splice(index,1);
  return entry;
}

/** Restore a selected meeting, keeping its original order, content, and references. */
export function restoreMeetingById(data, meetingId) {
  requireData(data);
  const index = data.deletedMeetings.findIndex(entry => entry?.meeting?.id === meetingId);
  if (index < 0) return null;
  const entry = data.deletedMeetings[index];
  if (!entry.meeting || typeof entry.meeting.id !== 'string' || !entry.meeting.id || !Number.isInteger(entry.index) || entry.index < 0) throw Error('已删除会议格式无效');
  if (data.meetings.some(row => row.id === meetingId)) throw Error('会议已存在，未覆盖现有内容');
  if (data.deletedMeetings.some((row,i) => i !== index && row.meeting?.id === meetingId)) throw Error('已删除会议标识重复，未恢复');
  data.meetings.splice(Math.min(entry.index,data.meetings.length),0,entry.meeting);
  data.deletedMeetings.splice(index,1);
  return entry.meeting;
}
