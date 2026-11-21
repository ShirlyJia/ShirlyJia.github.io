/** One-time meeting organization migration; existing project records are untouched. */
export const MEETING_CATEGORIES = Object.freeze([
  Object.freeze({id:'cross-team', label:'基模-落地'}),
  Object.freeze({id:'internal', label:'落地内部'})
]);

const categoryIds = new Set(MEETING_CATEGORIES.map(category => category.id));
const processNote = '已收录双周会原文链接，未自动提炼会议内容。';
const clone = value => JSON.parse(JSON.stringify(value));
const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

/** Explicit placement wins over the hidden legacy type. */
export function meetingCategory(meeting) {
  if (categoryIds.has(meeting?.category)) return meeting.category;
  return meeting?.type === '落地内部' ? 'internal' : 'cross-team';
}

function mergedNotes(notes, conclusions) {
  if (!conclusions.trim()) return notes;
  if (!notes.trim()) return conclusions;
  // Ignore surrounding whitespace for duplication, retaining the exact notes text.
  if (notes.trim() === conclusions.trim()) return notes;
  return notes + '\n\n' + conclusions;
}

export function enrichMeetingContent(input) {
  if (!input || input.schemaVersion !== 1 || !Array.isArray(input.meetings) || !Array.isArray(input.deletedMeetings)) throw Error('会议内容迁移需要有效的 schemaVersion 1 数据');
  if (input.meetingContentVersion !== undefined && input.meetingContentVersion !== 1) throw Error('不支持此会议内容版本');
  const data = clone(input);
  if (data.meetingContentVersion === 1) return data;

  const migrate = meeting => {
    if (!meeting || typeof meeting !== 'object' || Array.isArray(meeting) || typeof meeting.notes !== 'string' || typeof meeting.conclusions !== 'string') throw Error('会议记录与结论必须为文字');
    if (has(meeting, 'category') && !categoryIds.has(meeting.category)) throw Error('会议分栏无效');
    meeting.category = meetingCategory(meeting);
    meeting.notes = mergedNotes(meeting.notes, meeting.conclusions);
    meeting.conclusions = '';
    if (meeting.originNote === processNote) meeting.originNote = '';
  };

  data.meetings.forEach(migrate);
  data.deletedMeetings.forEach(entry => migrate(entry?.meeting));
  data.meetingContentVersion = 1;
  return data;
}
