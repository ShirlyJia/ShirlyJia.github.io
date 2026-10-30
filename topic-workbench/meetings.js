import {MEETING_CATEGORIES, meetingCategory, enrichMeetingContent} from './meeting-model.js';
import {createMeetingFiles} from './meeting-files.js';
import {removeMeetingItem, restoreMeetingItem, restoreMeetingById} from './meeting-trash.js';
import {deployment, storageKey} from './deployment-config.js';
import {richEditorMarkup, mountRichEditors, readRichEditor, setRichEditor, flushRichEditors} from './rich-text.js?v=20261030-rich-blocks';
/** Independent meeting notes. The project store is read-only here. */
export const MEETING_KEY = storageKey('topic-workbench-meetings-v1');
export const PROJECT_KEY = storageKey('topic-workbench-v2');
const TYPES = ['落地内部', '基模对齐', '其他'];
const TEXT_FIELDS = ['title', 'date', 'type', 'attendees', 'notes', 'conclusions', 'followUp', 'originNote', 'createdAt', 'updatedAt'];
const RICH_FIELDS = ['notes', 'followUp'];
const clone = value => JSON.parse(JSON.stringify(value));
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
const uid = prefix => `${prefix}-${globalThis.crypto.randomUUID()}`;
const now = () => new Date().toISOString();

export function safeMeetingURL(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value.trim());
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

// Incomplete input stays inert text, so it can be saved and undone without becoming a link.
export function setMaterialURL(material, value) {
  const safe = safeMeetingURL(value);
  material.url = safe;
  if (value.trim() && !safe) material.draftUrl = value;
  else delete material.draftUrl;
}

export function initialMeetings() {
  return {schemaVersion:1, meetingContentVersion:1, updatedAt:'', meetings:[{
    id:'meeting-2026-10-23-biweekly', title:'10-23 双周会', date:'2026-10-23', type:'其他', category:'cross-team',
    attendees:'', notes:'', conclusions:'', followUp:'', projectIds:[], createdAt:'', updatedAt:'',
    originNote:'',
    materials:[{id:'material-biweekly-document', title:'10-23 双周会文档', url:'https://vcnxjo4gpx7l.feishu.cn/docx/Q9lJdvXPko6mpBxAvNKcRusnnoj'}]
  }], deletedMeetings:[], deletedItems:[]};
}

function validDate(value) {
  if (value === '') return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value;
}

function validateMaterial(material) {
  if (!material || typeof material.id !== 'string' || !material.id || typeof material.title !== 'string' || typeof material.url !== 'string') throw Error('会议资料字段无效');
  if (material.kind !== undefined && !['file','link'].includes(material.kind)) throw Error('会议资料类型无效');
  if (material.kind === 'file' && (!material.fileId || typeof material.fileId !== 'string' || typeof material.fileName !== 'string' || typeof material.mimeType !== 'string' || !Number.isInteger(material.size) || material.size < 0)) throw Error('会议文件信息无效');
  if (material.draftUrl !== undefined && typeof material.draftUrl !== 'string') throw Error('资料链接草稿格式无效');
  if (material.url.trim() && !safeMeetingURL(material.url)) throw Error('资料链接须为不含登录凭据的 http 或 https 链接');
}

export function validateMeetings(data) {
  if (!data || data.schemaVersion !== 1 || !Array.isArray(data.meetings) || !Array.isArray(data.deletedMeetings) || typeof data.updatedAt !== 'string') throw new Error('会议记录格式不兼容');
  if(data.meetingContentVersion!==undefined&&data.meetingContentVersion!==1)throw Error('会议内容版本不兼容');
  const ids = new Set();
  function validateMeeting(meeting) {
    if (!meeting || typeof meeting.id !== 'string' || !meeting.id || ids.has(meeting.id)) throw new Error('会议记录的标识无效或重复');
    ids.add(meeting.id);
    if(meeting.category!==undefined&&!MEETING_CATEGORIES.some(c=>c.id===meeting.category))throw Error('会议分栏无效');
    if (TEXT_FIELDS.some(field => typeof meeting[field] !== 'string') || !TYPES.includes(meeting.type) || !validDate(meeting.date)) throw new Error('会议字段或日期格式无效');
    if (meeting.richText !== undefined && (!meeting.richText || typeof meeting.richText !== 'object' || Array.isArray(meeting.richText) || ![Object.prototype,null].includes(Object.getPrototypeOf(meeting.richText)) || Object.entries(meeting.richText).some(([field,value]) => !RICH_FIELDS.includes(field) || typeof value !== 'string'))) throw new Error('会议富文本格式无效');
    if (!Array.isArray(meeting.projectIds) || meeting.projectIds.some(id => typeof id !== 'string' || !id) || new Set(meeting.projectIds).size !== meeting.projectIds.length) throw new Error('关联项目格式无效');
    if (!Array.isArray(meeting.materials)) throw new Error('会议资料格式无效');
    const materialIds = new Set();
    for (const material of meeting.materials) {
      validateMaterial(material);
      if (materialIds.has(material.id)) throw Error('会议资料标识重复');
      materialIds.add(material.id);
    }
  }
  data.meetings.forEach(validateMeeting);
  data.deletedMeetings.forEach(entry => {
    if (!entry || !Number.isInteger(entry.index) || entry.index < 0 || typeof entry.deletedAt !== 'string') throw new Error('可撤销记录格式无效');
    validateMeeting(entry.meeting);
  });
  if (data.deletedItems !== undefined) {
    if (!Array.isArray(data.deletedItems)) throw Error('已删除资料格式无效');
    const trashIds = new Set();
    for (const entry of data.deletedItems) {
      if (!entry || typeof entry.id !== 'string' || !entry.id || trashIds.has(entry.id) || !ids.has(entry.meetingId) || entry.kind !== 'material' || !Number.isInteger(entry.index) || entry.index < 0 || typeof entry.deletedAt !== 'string') throw Error('已删除资料格式无效');
      trashIds.add(entry.id); validateMaterial(entry.item);
    }
  }
  return true;
}

/** Failed reads never authorize a seed overwrite; failed saves never replace the draft. */
export function createMeetingStore(storage, {publicSeedRequired = deployment.public} = {}) {
  let baseline = null, blocked = true, raw = null;
  return {
    load(publishedSeed) {
      blocked = true; raw = null;
      try {
        raw = storage.getItem(MEETING_KEY);
        if (raw === null && publicSeedRequired && publishedSeed === undefined) return {data:null, fromStorage:false, needsPublishedSeed:true, error:'分享版会议数据尚未载入'};
        const original=raw===null?(publicSeedRequired?publishedSeed:initialMeetings()):JSON.parse(raw);validateMeetings(original);
        const data=enrichMeetingContent(original);data.deletedItems??=[];validateMeetings(data);
        baseline = raw; blocked = false;
        return {data:clone(data), fromStorage:raw !== null, migrated:raw!==null&&(!original.meetingContentVersion||original.deletedItems===undefined), error:null};
      } catch (error) {
        return {data:null, fromStorage:false, error:error instanceof SyntaxError ? '本地会议记录不是有效 JSON' : error.message || '无法读取此浏览器的会议记录'};
      }
    },
    save(data) {
      if (blocked) throw new Error('原记录尚未成功读取，已停止覆盖保存');
      validateMeetings(data);
      if (storage.getItem(MEETING_KEY) !== baseline) throw new Error('另一个页面修改了会议记录。请先导出当前草稿，再刷新页面合并');
      const text = JSON.stringify(data);
      storage.setItem(MEETING_KEY, text);
      if (storage.getItem(MEETING_KEY) !== text) throw new Error('保存后校验未通过，当前草稿仍保留');
      baseline = text; raw = text;
      return true;
    },
    original() { return raw; }
  };
}

/** Public visitors start from the published snapshot, never from a fabricated default meeting. */
export async function loadMeetingStore(store, fetcher = globalThis.fetch) {
  const result = store.load();
  if (!result.needsPublishedSeed) return result;
  try {
    const response = await fetcher('./initial-meetings.json', {cache:'no-cache'});
    if (!response.ok) throw Error(`HTTP ${response.status}`);
    const seed = await response.json();
    validateMeetings(seed);
    if (seed.deletedMeetings.length || seed.deletedItems?.length) throw Error('发布数据包含已删除记录，请重新发布');
    if (seed.meetings.some(meeting => meeting.materials.some(material => material.kind === 'file'))) throw Error('发布资料仍引用本地附件，请重新发布');
    return store.load(seed);
  } catch (error) {
    return {data:null, fromStorage:false, error:`分享版会议数据读取失败：${error.message || '请检查网络后重新读取'}`};
  }
}

export function readMeetingProjects(storage) {
  try {
    const raw = storage.getItem(PROJECT_KEY);
    if (raw === null) return {projects:[], error:'先打开工作台载入项目，再回来关联。'};
    const data = JSON.parse(raw);
    if (data?.schemaVersion !== 2 || !Array.isArray(data.projects) || data.projects.some(project => !project || typeof project.id !== 'string' || typeof project.name !== 'string')) throw new Error('项目记录格式不兼容');
    return {projects:data.projects.map(({id,name}) => ({id,name})), error:''};
  } catch { return {projects:[], error:'暂时无法读取工作台项目；原项目数据未作改动。'}; }
}

export function deleteMeeting(data, id, deletedAt = now()) {
  const index = data.meetings.findIndex(meeting => meeting.id === id);
  if (index < 0) return false;
  const [meeting] = data.meetings.splice(index,1);
  data.deletedMeetings.push({meeting, index, deletedAt});
  return true;
}

export function restoreLastMeeting(data) {
  const entry = data.deletedMeetings.at(-1);
  if (!entry) return null;
  if (data.meetings.some(meeting => meeting.id === entry.meeting.id)) throw new Error('会议已存在，未覆盖现有内容');
  data.deletedMeetings.pop();
  data.meetings.splice(Math.min(entry.index,data.meetings.length),0,entry.meeting);
  return entry.meeting.id;
}

export function meetingMatches(meeting, query) {
  const text = [meeting.title, meeting.date, meeting.notes, meeting.followUp, ...meeting.materials.flatMap(material => [material.title, material.url, material.draftUrl || ''])].join(' ').toLocaleLowerCase();
  return text.includes(query.trim().toLocaleLowerCase());
}

export function isBlankMeeting(meeting) {
  return ['title','date','attendees','notes','conclusions','followUp','originNote'].every(field => !meeting[field]?.trim()) && !Object.values(meeting.richText||{}).some(html=>/<img\b/i.test(html)) && !meeting.materials.length && !meeting.projectIds.length;
}

export function deletedMeetingFileIds(data) {
  const materials = [...data.meetings, ...data.deletedMeetings.map(entry => entry.meeting)].flatMap(meeting => meeting.materials);
  materials.push(...(data.deletedItems || []).filter(entry => entry.kind === 'material').map(entry => entry.item));
  return [...new Set(materials.filter(item => item.kind === 'file').map(item => item.fileId))];
}

function bootMeetings() {
  const $ = id => document.getElementById(id);
  // The storage getter itself may be denied; leave the old data untouched in that case.
  const adapter = {getItem:key => globalThis.localStorage.getItem(key), setItem:(key,value) => globalThis.localStorage.setItem(key,value)};
  const store = createMeetingStore(adapter), files=createMeetingFiles();
  let data = null, selected = null, projects = [], projectError = '', dirty = false, timer, toastTimer, fromStorage = false, loadRevision = 0;
  $('meetingShareNotice').hidden = !deployment.public;
  let activeCategory='cross-team';const remembered=new Map();
  const categoryLabel=id=>MEETING_CATEGORIES.find(c=>c.id===id)?.label||'基模-落地';
  const categoryMeetings=()=>data?data.meetings.filter(m=>meetingCategory(m)===activeCategory).sort((a,b)=>b.date.localeCompare(a.date)||b.updatedAt.localeCompare(a.updatedAt)):[];
  const current = () => data?.meetings.find(meeting => meeting.id === selected);
  const visibleMeetings=()=>categoryMeetings().filter(meeting=>meetingMatches(meeting,$('meetingSearch').value));
  $('meetingNotesHost').innerHTML=richEditorMarkup({label:'会议记录',placeholder:'讨论要点、已明确的结论；可直接粘贴图片…',attrs:'id="meetingNotes" data-field="notes"'});
  $('meetingFollowUpHost').innerHTML=richEditorMarkup({label:'待跟进',placeholder:'下一步、跟进人或待补信息…',attrs:'id="meetingFollowUp" data-field="followUp"'});
  mountRichEditors($('meetingEditor'),{onError:message=>toast(message)});
  function toast(message, action) {
    const box=$('meetingToast');box.replaceChildren();const text=document.createElement('span');text.textContent=message;box.append(text);
    if(action){const button=document.createElement('button');button.textContent='撤销';button.onclick=()=>{box.hidden=true;action();};box.append(button);}
    box.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{if(!box.contains(document.activeElement))box.hidden=true;},action?8000:3500);
  }
  function status(message, unsaved = false) { $('saveStatus').textContent = message; $('saveStatus').classList.toggle('unsaved',unsaved); }
  function error(message = '') { $('saveMessage').textContent = message; $('saveMessage').hidden = !message; }
  function save() {
    clearTimeout(timer);
    if(!flushRichEditors($('meetingEditor')))return false;
    if (!data || !dirty) return !dirty;
    try {
      store.save(data); dirty = false; fromStorage = true;
      status(data.meetings.some(meeting => meeting.materials.some(material => material.draftUrl)) ? '已保存 · 有待补全链接' : '已保存到此浏览器'); error(); updateFooter(); return true;
    } catch (failure) {
      status('未保存 · 点击重试',true);
      const message=failure.name==='QuotaExceededError'?'浏览器存储空间不足':failure.message;
      error(`${message}。草稿保留在当前页面，可重试或导出 JSON；离开前请先备份。`);
      return false;
    }
  }
  function changed(immediate = false, touchMeeting = true) {
    dirty = true; data.updatedAt = now();
    if (touchMeeting && current()) current().updatedAt = data.updatedAt;
    status('正在保存…',true); clearTimeout(timer);
    renderList();
    if(immediate)return save();timer=setTimeout(save,400);return true;
  }
  function refreshProjects() { const result = readMeetingProjects(adapter); projects = result.projects; projectError = result.error; if (current()) renderProjects(); }
  function renderList() {
    document.querySelectorAll('[data-category]').forEach(button=>{const active=button.dataset.category===activeCategory;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;});
    $('meetingList').setAttribute('aria-labelledby',activeCategory==='cross-team'?'crossTeamTab':'internalTab');$('emptyTitle').textContent=categoryLabel(activeCategory);
    $('emptyMessage').textContent=$('meetingSearch').value.trim()?'当前搜索下没有会议，可清空搜索或新建会议。':'还没有会议，先添加一份纪要。';
    if(!data){$('meetingList').innerHTML='';$('meetingCount').textContent='读取失败';return;}
    const meetings=categoryMeetings(),matches=meetings.filter(meeting=>meetingMatches(meeting,$('meetingSearch').value));
    $('meetingCount').textContent=`${matches.length}${matches.length!==meetings.length?' / '+meetings.length:''} 条会议`;
    $('meetingList').innerHTML=matches.map(meeting=>`<div class="meeting-list-item${selected===meeting.id?' selected':''}"><button class="meeting-row" data-meeting="${esc(meeting.id)}"${selected===meeting.id?' aria-current="page"':''}><strong>${esc(meeting.title.trim()||'未命名会议')}</strong>${meeting.date?`<small>${esc(meeting.date)}</small>`:''}</button><button class="row-delete" data-delete-meeting="${esc(meeting.id)}" aria-label="删除会议：${esc(meeting.title.trim()||'未命名会议')}" title="删除会议">删除</button></div>`).join('')||'<p class="list-empty">'+(meetings.length?'没有匹配的会议':'还没有会议记录')+'</p>';
    const count=data.deletedMeetings.length+(data.deletedItems?.length||0);
    $('undoDelete').disabled=!count;$('openTrash').disabled=false;$('trashCount').textContent=count?String(count):'';
  }
  function switchCategory(id){
    if(!save())return;if(selected)remembered.set(activeCategory,selected);activeCategory=id;$('meetingSearch').value='';const rows=categoryMeetings();selected=rows.find(m=>m.id===remembered.get(id))?.id||rows[0]?.id||null;renderList();renderEditor();
  }
  function renderProjects() {
    const meeting = current(); if (!meeting) return;
    const byId = new Map(projects.map(project => [project.id,project]));
    $('linkedProjects').innerHTML = meeting.projectIds.map(id => `<span class="linked-project${byId.has(id) ? '' : ' missing'}"><a href="./?project=${encodeURIComponent(id)}">${esc(byId.get(id)?.name || '已不在工作台的项目')} ↗</a><button data-unlink-project="${esc(id)}" aria-label="取消关联${esc(byId.get(id)?.name || '此项目')}">×</button></span>`).join('');
    $('projectReadNotice').textContent = projectError;
    $('projectReadNotice').hidden = !projectError;
    const query = $('projectSearch').value.trim().toLocaleLowerCase();
    const visible = projects.filter(project => project.name.toLocaleLowerCase().includes(query));
    $('projectChoices').innerHTML = visible.map(project => `<label class="project-choice"><input type="checkbox" data-project="${esc(project.id)}"${meeting.projectIds.includes(project.id) ? ' checked' : ''}><span>${esc(project.name)}</span></label>`).join('') || (!projectError ? '<p class="muted">'+(projects.length ? '没有匹配的项目' : '工作台还没有项目')+'</p>' : '');
  }
  function materialLink(material) {
    if(material.kind==='file') return `<button data-preview-material="${esc(material.id)}">预览</button><button data-download-material="${esc(material.id)}">下载 ↗</button>`;
    const url = material.draftUrl ? '' : safeMeetingURL(material.url);
    return url ? `<button data-preview-material="${esc(material.id)}">预览</button><a href="${esc(url)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">打开 ↗</a>` : '';
  }
  function renderMaterials() {
    const meeting=current();if(!meeting)return;
    $('materialList').innerHTML=meeting.materials.map(material=>`<div class="material-row" data-material-row="${esc(material.id)}"><div class="material-head"><span class="material-icon" aria-hidden="true">▤</span><input class="material-title" aria-label="资料标题" placeholder="资料标题" value="${esc(material.title)}" data-material="${esc(material.id)}" data-material-field="title"><span class="material-tools" data-material-open>${materialLink(material)}</span><button class="remove-material" data-remove-material="${esc(material.id)}" aria-label="删除资料：${esc(material.title||'未命名资料')}">删除</button></div>${material.kind==='file'?`<p class="file-meta">${esc(material.fileName)} · ${material.size<1048576?Math.ceil(material.size/1024)+' KB':(material.size/1048576).toFixed(1)+' MB'}</p>`:`<input class="material-url" type="url" inputmode="url" aria-label="资料链接" placeholder="https://…" value="${esc(material.draftUrl??material.url)}" data-material="${esc(material.id)}" data-material-field="url"><p class="material-error" hidden>链接待补全</p>`}</div>`).join('');
    for(const material of meeting.materials)updateMaterialState(material);
  }
  function updateMaterialState(material) {
    const row=[...$('materialList').children].find(el=>el.dataset.materialRow===material.id);if(!row)return;
    if(material.kind!=='file'){
      const invalid=!!material.draftUrl||!!material.url.trim()&&!safeMeetingURL(material.url);
      row.querySelector('.material-url').setAttribute('aria-invalid',String(invalid));row.querySelector('.material-error').hidden=!invalid;
    }
    row.querySelector('[data-material-open]').innerHTML=materialLink(material);
    row.querySelector('[data-remove-material]').setAttribute('aria-label','删除资料：'+(material.title||'未命名资料'));
  }
  let previewURL=null,previewVersion=0;
  function releasePreview(){previewVersion++;if(previewURL)URL.revokeObjectURL(previewURL);previewURL=null;$('previewBody').replaceChildren();$('previewOpen').removeAttribute('href');}
  async function openMaterial(material,downloadFile=false){
    releasePreview();const version=previewVersion;
    try{
      let url=material.draftUrl?'':safeMeetingURL(material.url),blob=null;
      if(material.kind==='file'){
        blob=await files.get(material.fileId);if(version!==previewVersion)return;if(!blob)throw Error('此浏览器中找不到这份文件，请重新上传');
        previewURL=URL.createObjectURL(blob);url=previewURL;
        if(downloadFile){const anchor=document.createElement('a');anchor.href=url;anchor.download=material.fileName;document.body.append(anchor);anchor.click();anchor.remove();const downloadedURL=previewURL;previewURL=null;setTimeout(()=>URL.revokeObjectURL(downloadedURL),1000);return;}
      }
      if(!url)return;
      $('previewTitle').textContent=material.title||material.fileName||'会议资料';$('previewOpen').href=url;
      $('previewOpen').textContent=blob?'下载原文件 ↗':'打开原文 ↗';if(blob)$('previewOpen').download=material.fileName;else $('previewOpen').removeAttribute('download');
      const body=$('previewBody');
      if(blob&&['image/png','image/jpeg','image/gif','image/webp','image/avif'].includes(material.mimeType)){
        const image=document.createElement('img');image.src=url;image.alt=material.title||material.fileName;body.append(image);
      }else if(blob&&(/^(text\/(plain|markdown|csv))$/.test(material.mimeType)||/\.(txt|md|csv)$/i.test(material.fileName))){
        const text=await blob.slice(0,200000).text();if(version!==previewVersion)return;const pre=document.createElement('pre');pre.textContent=text+(blob.size>200000?'\n\n…剩余内容请下载查看':'');body.append(pre);
      }else if(!blob||material.mimeType==='application/pdf'){
        const frame=document.createElement('iframe');frame.src=url;frame.title=material.title||'会议资料';frame.referrerPolicy='no-referrer';if(!blob)frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-forms allow-popups');body.append(frame);
        if(!blob){const hint=document.createElement('p');hint.className='preview-hint';hint.textContent='如未显示，请打开原文查看。';body.append(hint);}
      }else{const hint=document.createElement('p');hint.className='file-preview-empty';hint.textContent='此文件可下载后查看。';body.append(hint);}
      $('materialPreview').showModal();
    }catch(failure){if(version===previewVersion){releasePreview();toast(failure.message||'无法打开资料');}}
  }
  function updateFooter() {
    const value = current()?.updatedAt;
    const date = value ? new Date(value) : null;
    $('editedAt').textContent = date && Number.isFinite(date.getTime()) ? `最近编辑 ${date.toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}` : '';
  }
  function renderEditor() {
    if($('materialPreview').open)$('materialPreview').close();releasePreview();
    const meeting = current(); $('meetingEditor').hidden = !meeting; $('emptyState').hidden = !data || !!meeting;
    if (!meeting) return;
    for (const input of document.querySelectorAll('[data-field]')) {
      const field=input.dataset.field;
      if(input.matches('.rich-editor-input'))setRichEditor(input,{text:meeting[field],html:meeting.richText?.[field]||''});
      else input.value=meeting[field];
    }
    $('meetingCategoryLabel').textContent=categoryLabel(meetingCategory(meeting));$('moveMeeting').textContent='移到'+categoryLabel(meetingCategory(meeting)==='cross-team'?'internal':'cross-team');$('materialLinkInput').value='';
    $('projectSearch').value = ''; $('projectPicker').open = false;
    renderProjects(); renderMaterials(); updateFooter();
  }
  async function load() {
    if(!flushRichEditors($('meetingEditor')))return;
    const revision = ++loadRevision;
    clearTimeout(timer);
    error();
    data = null; $('meetingList').replaceChildren(); $('meetingCount').textContent = '正在读取…';
    $('newMeeting').disabled = true; $('exportMeetings').disabled = true; $('openTrash').disabled = true;
    $('undoDelete').disabled = true; $('exportRaw').disabled = true;
    $('meetingEditor').hidden = true; $('emptyState').hidden = true; status('正在读取…');
    const result = await loadMeetingStore(store);
    if (revision !== loadRevision) return;
    data = result.data; fromStorage = result.fromStorage; dirty = false;
    $('loadError').hidden = !result.error; $('newMeeting').disabled = !!result.error; $('exportMeetings').disabled = !!result.error;
    $('exportRaw').disabled = store.original() === null; $('undoDelete').disabled = true;$('openTrash').disabled=!!result.error;
    if (result.error) { $('loadErrorText').textContent = result.error; status('需要恢复',true); selected = null; }
    else { const rows=categoryMeetings();selected=rows.some(meeting=>meeting.id===selected)?selected:rows[0]?.id||null;status(fromStorage?'已保存到此浏览器':'已就绪');if(result.migrated){dirty=true;save();} }
    refreshProjects(); renderList(); renderEditor();
  }
  function focusTitle() {
    $('meetingTitle').focus();$('meetingEditor').scrollIntoView({block:'start',behavior:'smooth'});
  }
  function addMeeting() {
    if (!data || !save()) return;
    let meeting=categoryMeetings().find(isBlankMeeting);
    if(!meeting){
      const stamp=now();meeting={id:uid('meeting'),title:'',date:'',type:'其他',category:activeCategory,attendees:'',notes:'',conclusions:'',followUp:'',originNote:'',projectIds:[],materials:[],createdAt:stamp,updatedAt:stamp};
      data.meetings.unshift(meeting);selected=meeting.id;$('meetingSearch').value='';changed(true);
    }else{selected=meeting.id;$('meetingSearch').value='';}
    renderList();renderEditor();focusTitle();
  }
  function trashEntries() {
    if(!data)return [];
    return [...data.deletedMeetings.map(entry=>({kind:'meeting',id:entry.meeting.id,title:entry.meeting.title||'未命名会议',meeting:entry.meeting,deletedAt:entry.deletedAt})),
      ...(data.deletedItems||[]).map(entry=>({kind:'material',id:entry.id,title:entry.item.title||entry.item.fileName||'未命名资料',meeting:data.meetings.find(m=>m.id===entry.meetingId)||data.deletedMeetings.find(e=>e.meeting.id===entry.meetingId)?.meeting,deletedAt:entry.deletedAt,blocked:!data.meetings.some(m=>m.id===entry.meetingId)}))].sort((a,b)=>b.deletedAt.localeCompare(a.deletedAt));
  }
  function renderTrash() {
    $('trashList').innerHTML=trashEntries().map(entry=>`<div class="trash-row"><div><strong>${esc(entry.title)}</strong><small>${entry.kind==='meeting'?'会议 · '+esc(categoryLabel(meetingCategory(entry.meeting))):'资料 · '+esc(entry.meeting?.title||'未命名会议')}${entry.blocked?' · 请先恢复所属会议':''}</small></div><button data-restore-kind="${entry.kind}" data-restore-id="${esc(entry.id)}" aria-label="恢复${entry.kind==='meeting'?'会议':'资料'}：${esc(entry.title)}"${entry.blocked?' disabled':''}>恢复</button></div>`).join('')||'<p class="trash-empty">没有已删除的会议或资料</p>';
  }
  function restoreEntry(kind,id) {
    if(!data||!save())return;
    try{
      let meeting,materialId;
      if(kind==='meeting'){meeting=restoreMeetingById(data,id);}
      else{const entry=restoreMeetingItem(data,id);if(entry){meeting=data.meetings.find(m=>m.id===entry.meetingId);materialId=entry.item.id;}}
      if(!meeting)return;
      selected=meeting.id;activeCategory=meetingCategory(meeting);$('meetingSearch').value='';
      const saved=changed(true);renderList();renderEditor();renderTrash();
      if(saved){$('meetingTrash').close();toast(kind==='meeting'?'会议已恢复':'资料已恢复');
        const restored=materialId?[...$('materialList').children].find(row=>row.dataset.materialRow===materialId):$('meetingTitle');
        restored?.classList.add('just-restored');(materialId?restored?.querySelector('.material-title'):restored)?.focus();restored?.scrollIntoView({block:'nearest'});
      }
    }catch(failure){toast(failure.message);}
  }
  function removeMeeting(id) {
    if(!data||!save())return;
    const rows=visibleMeetings(),index=rows.findIndex(m=>m.id===id),wasSelected=selected===id;
    if(!deleteMeeting(data,id))return;
    if(wasSelected)selected=rows[index+1]?.id||rows[index-1]?.id||null;
    const saved=changed(true,false);renderList();if(wasSelected)renderEditor();renderTrash();
    if(saved)toast('会议已移到回收站',()=>restoreEntry('meeting',id));
    if(wasSelected){const next=[...$('meetingList').querySelectorAll('[data-meeting]')].find(button=>button.dataset.meeting===selected);(next||$('newMeeting')).focus();}
  }
  function download(value, filename) {
    let url;
    try {
      url = URL.createObjectURL(new Blob([typeof value === 'string' ? value : JSON.stringify(value,null,2)],{type:'application/json;charset=utf-8'}));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url),1000);
    } catch { if (url) URL.revokeObjectURL(url); toast('导出失败，请重试。当前内容仍在页面中。'); }
  }
  $('newMeeting').onclick = addMeeting; $('createFromEmpty').onclick = addMeeting;
  $('saveStatus').onclick = save; $('retryLoad').onclick = load;
  document.querySelectorAll('[data-category]').forEach(button=>{button.onclick=()=>switchCategory(button.dataset.category);button.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const id=e.key==='Home'?'cross-team':e.key==='End'?'internal':activeCategory==='cross-team'?'internal':'cross-team';switchCategory(id);document.querySelector('[data-category="'+id+'"]').focus();};});
  $('moveMeeting').onclick=()=>{const meeting=current();if(!meeting||!save())return;meeting.category=meetingCategory(meeting)==='cross-team'?'internal':'cross-team';activeCategory=meeting.category;changed(true);renderEditor();};
  $('meetingSearch').oninput = renderList; $('projectSearch').oninput = renderProjects;
  $('meetingList').onclick = event => { const remove=event.target.closest('[data-delete-meeting]');if(remove){removeMeeting(remove.dataset.deleteMeeting);return;}const button=event.target.closest('[data-meeting]');if(!button||!save())return;selected=button.dataset.meeting;renderList();renderEditor(); };
  $('meetingEditor').addEventListener('input',event => {
    const meeting = current(); if (!meeting) return;
    const field = event.target.dataset.field;
    if (field && TEXT_FIELDS.includes(field)) {
      if(event.target.matches('.rich-editor-input')){
        const value=readRichEditor(event.target);meeting[field]=value.text;meeting.richText??={};meeting.richText[field]=value.html;
      }else meeting[field] = event.target.value;
      changed(); if (['title','date'].includes(field)) renderList(); return;
    }
    const materialId = event.target.dataset.material;
    if (materialId) {
      const material = meeting.materials.find(item => item.id === materialId); const property = event.target.dataset.materialField;
      if (material && ['title','url'].includes(property)) { if (property === 'url') setMaterialURL(material,event.target.value); else material.title = event.target.value; updateMaterialState(material); changed(); }
    }
  });
  $('projectChoices').onchange = event => { const id = event.target.dataset.project; const meeting = current(); if (!id || !meeting) return; meeting.projectIds = event.target.checked ? [...new Set([...meeting.projectIds,id])] : meeting.projectIds.filter(value => value !== id); changed(true); renderProjects(); };
  $('linkedProjects').onclick = event => { const button = event.target.closest('[data-unlink-project]'); if (!button || !current()) return; current().projectIds = current().projectIds.filter(id => id !== button.dataset.unlinkProject); changed(true); renderProjects(); };
  $('materialLinkForm').onsubmit=event=>{event.preventDefault();const meeting=current();if(!meeting)return;const url=safeMeetingURL($('materialLinkInput').value);if(!url){toast('请填写有效的 http 或 https 链接');return;}if(meeting.materials.some(m=>m.url===url)){toast('这份链接已在资料中');return;}const host=new URL(url).hostname;meeting.materials.push({id:uid('material'),title:host.endsWith('feishu.cn')?'飞书会议纪要':host,url});$('materialLinkInput').value='';changed(true);renderMaterials();};
  $('uploadMaterial').onclick=()=>$('meetingFileInput').click();
  $('meetingFileInput').onchange=async event=>{
    const meeting=current(),chosen=[...event.target.files];event.target.value='';if(!meeting||!chosen.length)return;
    $('uploadMaterial').disabled=true;
    try{for(const file of chosen){const metadata=await files.put(file);if(!data.meetings.includes(meeting))throw Error('会议已移除，请重新选择会议后添加文件');meeting.materials.push({id:uid('material'),title:file.name,url:'',kind:'file',...metadata});meeting.updatedAt=now();const saved=changed(true,false);if(current()===meeting)renderMaterials();if(!saved)throw Error('资料引用尚未保存，请点击顶部重试保存；文件已保留在本浏览器');}toast('资料已添加');}catch(failure){toast(failure.message||'文件保存失败');}finally{$('uploadMaterial').disabled=false;}
  };
  $('materialList').onclick=event=>{
    const button=event.target.closest('[data-remove-material],[data-preview-material],[data-download-material]');if(!button||!current())return;
    if(button.dataset.removeMaterial){if(!save())return;releasePreview();const entry=removeMeetingItem(data,selected,'material',button.dataset.removeMaterial);if(!entry)return;const saved=changed(true);renderMaterials();renderTrash();if(saved)toast('资料已移到回收站',()=>restoreEntry('material',entry.id));$('materialLinkInput').focus();return;}
    const material=current().materials.find(m=>m.id===(button.dataset.previewMaterial||button.dataset.downloadMaterial));if(material)openMaterial(material,!!button.dataset.downloadMaterial);
  };
  $('closePreview').onclick=()=>$('materialPreview').close();$('materialPreview').onclose=releasePreview;
  $('deleteMeeting').onclick=()=>{if(current())removeMeeting(selected);};
  $('undoDelete').onclick=()=>{const entry=trashEntries()[0];if(entry)restoreEntry(entry.kind,entry.id);};
  $('openTrash').onclick=()=>{renderTrash();$('meetingTrash').showModal();};
  $('closeTrash').onclick=()=>$('meetingTrash').close();
  $('trashList').onclick=event=>{const button=event.target.closest('[data-restore-id]');if(button)restoreEntry(button.dataset.restoreKind,button.dataset.restoreId);};
  $('exportMeetings').onclick=async()=>{if(!data||!flushRichEditors($('meetingEditor')))return;try{const backup=clone(data),ids=deletedMeetingFileIds(backup);if(ids.length)backup.embeddedFiles=await files.exportFiles(ids);download(backup,`会议记录${dirty?'-未保存草稿':''}-${new Date().toISOString().slice(0,10)}.json`);}catch(failure){toast('导出未完成：'+failure.message);}};
  $('exportRaw').onclick = () => { const raw = store.original(); if (raw !== null) download(raw,'会议记录-原始备份.json'); };
  document.addEventListener('click',event=>{const link=event.target.closest('a[href]');if(link&&link.target!=='_blank'&&!link.hasAttribute('download')&&!link.getAttribute('href').startsWith('#')&&!save())event.preventDefault();});
  window.addEventListener('beforeunload',event => { if (!flushRichEditors($('meetingEditor')) || dirty && !save()) { event.preventDefault(); event.returnValue = ''; } });
  document.addEventListener('visibilitychange',() => { if (document.visibilityState === 'hidden') save(); });
  window.addEventListener('focus',refreshProjects);
  window.addEventListener('storage',event => {
    if (event.key === PROJECT_KEY || event.key === null) refreshProjects();
    if (event.key === MEETING_KEY || event.key === null) {
      if (dirty || !flushRichEditors($('meetingEditor'))) { clearTimeout(timer); status('未保存 · 检测到其他页面更改',true); error('另一个页面修改了会议记录。当前草稿已保留，请导出后再刷新页面合并。'); }
      else load();
    }
  });
  load();
}

if (typeof document !== 'undefined' && document.getElementById('meetingEditor')) bootMeetings();
