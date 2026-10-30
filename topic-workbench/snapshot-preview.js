import {orderedComments} from './comment-order.js';
import {readProjectFlow} from './project-flow.js';
import {isClosedProject} from './workbench-model.js';
import {richHTML} from './rich-text.js?v=20261030-comment-interactions';
/** A pure, read-only projection of one saved snapshot. No DOM handlers or storage access. */
const text = value => typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
const esc = value => text(value).replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
const list = value => Array.isArray(value) ? value.filter(item => item && typeof item === 'object' && !Array.isArray(item)) : [];
const ids = value => Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];
const present = value => text(value).trim().length > 0;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const color = (value, fallback = '#d7d5cd') => /^#[0-9a-f]{6}$/i.test(text(value)) ? value : /^#[0-9a-f]{6}$/i.test(text(fallback)) ? fallback : '#d7d5cd';
const n = value => String(Math.abs(value) < 1e12 ? Math.round(value * 100) / 100 : value);
const paragraph = (label, value) => present(value) ? `<div class="snapshot-field"><h5>${esc(label)}</h5><p class="snapshot-text preserve-text">${esc(value)}</p></div>` : '';
const richParagraph = (label, value, html) => present(value) || present(html) ? `<div class="snapshot-field"><h5>${esc(label)}</h5><div class="snapshot-text rich-content">${richHTML(text(html), text(value))}</div></div>` : '';

function safeURL(value) {
  if (!present(value)) return '';
  try {
    const url = new URL(text(value));
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

function link(url, label) {
  const safe = safeURL(url);
  return safe ? `<a href="${esc(safe)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">${esc(label)} ↗</a>` : '';
}

function dateLabel(value) {
  if (!present(value)) return '';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}) : text(value);
}

// SVG text is deliberately plain text, with no foreignObject, links, or embedded HTML.
function wrap(value, width = 18, limit = 2) {
  const chars = [...text(value).replace(/\s+/g,' ').trim()];
  const lines = []; let line = '', units = 0;
  for (let index = 0; index < chars.length; index++) {
    const char = chars[index], size = /[\u0000-\u00ff]/.test(char) ? 0.56 : 1;
    if (units + size > width && line) {
      if (lines.length === limit - 1) { lines.push(line.replace(/.$/u,'') + '…'); return lines; }
      lines.push(line); line = ''; units = 0;
    }
    line += char; units += size;
  }
  if (line) lines.push(line);
  return lines;
}

function tagsFor(project, tagById) {
  return ids(project.tagIds).map(id => tagById.get(id)).filter(Boolean);
}

function tagsHTML(project, tagById) {
  return tagsFor(project,tagById).map(tag => `<span class="snapshot-tag" style="--snapshot-accent:${color(tag.color)}">${esc(tag.name || '未命名标签')}</span>`).join('');
}

function metadataHTML(project) {
  const values = [['类型',project.kind === 'direction' ? '方向' : ''],['优先级',project.priority],['状态',project.status],['结果状态',project.outcome],['结束日期',isClosedProject(project)?project.closedAt:'']];
  const fields = values.filter(([,value]) => present(value));
  return fields.length ? `<dl class="snapshot-meta">${fields.map(([label,value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>` : '';
}

// Keep the preview defensive: old snapshots may omit annotations, and an
// invalid geometry must never inject an attribute or break the whole map.
function canvasAnnotations(data) {
  return list(data.canvasItems).filter(item => {
    if (!finite(item.x) || !finite(item.y)) return false;
    if (['line','arrow'].includes(item.type)) return [item.x2,item.y2,item.x2-item.x,item.y2-item.y,Math.hypot(item.x2-item.x,item.y2-item.y)].every(finite);
    return ['text','note'].includes(item.type) && [item.w,item.h].every(finite) && item.w > 0 && item.h > 0 && [item.x+item.w,item.y+item.h].every(finite);
  });
}

function annotationBox(item) {
  if (['line','arrow'].includes(item.type)) {
    const pad=24;
    return {x:Math.min(item.x,item.x2)-pad,y:Math.min(item.y,item.y2)-pad,w:Math.max(1,Math.abs(item.x2-item.x))+pad*2,h:Math.max(1,Math.abs(item.y2-item.y))+pad*2};
  }
  return {x:item.x,y:item.y,w:item.w,h:item.h};
}

function annotationInk(value) {
  const hex=color(value,'#f7edc3').slice(1),channels=[0,2,4].map(index=>parseInt(hex.slice(index,index+2),16)/255);
  const [r,g,b]=channels.map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
  return .2126*r+.7152*g+.0722*b < .35 ? '#ffffff' : '#37352f';
}

function annotationSVG(item) {
  const tone=color(item.color,item.type==='note'?'#f7edc3':'#575149');
  if (['line','arrow'].includes(item.type)) {
    const width=finite(item.strokeWidth)?Math.max(1,Math.min(12,item.strokeWidth)):2;
    const dx=item.x2-item.x,dy=item.y2-item.y,length=Math.hypot(dx,dy);
    let head='';
    if(item.type==='arrow'&&length>0){
      const size=Math.min(length*.65,Math.max(9,width*3)),ux=dx/length,uy=dy/length,bx=item.x2-ux*size,by=item.y2-uy*size;
      head=`<path d="M ${n(bx-uy*size*.5)} ${n(by+ux*size*.5)} L ${n(item.x2)} ${n(item.y2)} L ${n(bx+uy*size*.5)} ${n(by-ux*size*.5)}" fill="none" stroke="${tone}" stroke-width="${n(width)}" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    return `<g class="snapshot-canvas-${item.type}"><title>${item.type==='arrow'?'箭头':'线条'}</title><line x1="${n(item.x)}" y1="${n(item.y)}" x2="${n(item.x2)}" y2="${n(item.y2)}" stroke="${tone}" stroke-width="${n(width)}" stroke-linecap="round"/>${head}</g>`;
  }
  const note=item.type==='note',font=finite(item.fontSize)?Math.max(10,Math.min(64,item.fontSize)):note?18:24;
  const padding=note?16:2,lineHeight=font*1.5,maxLines=Math.max(1,Math.floor((item.h-padding*2)/lineHeight));
  const source=text(item.text),lines=[];
  for(const paragraph of source.split(/\r?\n/))lines.push(...(paragraph?wrap(paragraph,Math.max(1,(item.w-padding*2)/font),maxLines+1):['']));
  if(lines.length>maxLines){lines.length=maxLines;lines[maxLines-1]=lines[maxLines-1].replace(/.$/u,'')+'…';}
  return `<g class="snapshot-canvas-${item.type}" transform="translate(${n(item.x)} ${n(item.y)})"><title>${esc(source|| (note?'空便签':'空文字'))}</title>${note?`<rect width="${n(item.w)}" height="${n(item.h)}" rx="3" fill="${tone}" stroke="#37352f" stroke-opacity="0.12"/>`:''}<text x="${padding}" y="${n(padding+font)}" font-size="${n(font)}" fill="${note?annotationInk(tone):tone}">${lines.map((line,index)=>`<tspan x="${padding}" dy="${index?n(lineHeight):'0'}">${esc(line)}</tspan>`).join('')}</text></g>`;
}

function annotationTextHTML(data) {
  const items=list(data.canvasItems).filter(item=>['text','note'].includes(item.type)&&present(item.text));
  if(!items.length)return '';
  return `<details class="snapshot-frame-notes snapshot-annotation-text"><summary>文字与便签 · ${items.length}</summary>${items.map((item,index)=>paragraph(`${item.type==='note'?'便签':'文字'} ${index+1}`,item.text)).join('')}</details>`;
}

function canvasHTML(data, projectById, tagById) {
  const allFrames = list(data.frames), allInstances = list(data.instances), allAnnotations=list(data.canvasItems), annotations=canvasAnnotations(data);
  const frames = allFrames.filter(frame => [frame.x,frame.y,frame.w,frame.h].every(finite) && frame.w > 0 && frame.h > 0 && [frame.x+frame.w,frame.y+frame.h].every(finite));
  const instances = allInstances.filter(instance => finite(instance.x) && finite(instance.y) && projectById.has(instance.pid));
  const skipped = allFrames.length + allInstances.length + allAnnotations.length - frames.length - instances.length - annotations.length;
  if (!frames.length && !instances.length && !annotations.length) return '<p class="snapshot-empty muted">这份快照没有可显示的画板布局。</p>';
  const boxes = frames.map(frame => ({x:frame.x,y:frame.y-30,w:frame.w,h:frame.h+30})).concat(instances.map(instance => ({x:instance.x,y:instance.y,w:282,h:152})),annotations.map(annotationBox));
  const left = Math.min(...boxes.map(box => box.x))-24, top = Math.min(...boxes.map(box => box.y))-24;
  const width = Math.max(...boxes.map(box => box.x+box.w))-left+24, height = Math.max(...boxes.map(box => box.y+box.h))-top+24;
  if (![left,top,width,height].every(finite) || width <= 0 || height <= 0) return '<p class="snapshot-empty muted">布局坐标无法显示；下方仍可查看项目与备注。</p>';
  const frameSVG = frames.map(frame => {
    const tone = color(frame.color, {sand:'#d8cfbb',blue:'#c4ced4',green:'#cbd0c5'}[frame.tone] || '#d7d5cd');
    const hasBackground=/^#[0-9a-f]{6}$/i.test(text(frame.backgroundColor)),background=hasBackground?color(frame.backgroundColor):tone;
    return `<g transform="translate(${n(frame.x)} ${n(frame.y)})"><title>${esc(frame.name || '未命名分组')}</title><rect width="${n(frame.w)}" height="${n(frame.h)}" rx="6" fill="color-mix(in srgb,${background} ${hasBackground?35:2.8}%,#fff)" stroke="${tone}" stroke-width="1.5"/><text x="2" y="-11" font-size="13" font-weight="600" fill="#73726e">${esc(wrap(frame.name || '未命名分组',40,1)[0])}</text></g>`;
  }).join('');
  const cardSVG = instances.map(instance => {
    const project = projectById.get(instance.pid), title = text(project.name) || '未命名项目';
    const tags = tagsFor(project,tagById).map(tag => text(tag.name)).filter(Boolean);
    const metadata = [project.priority,project.outcome || project.status].filter(present).join(' · ');
    const note = (instance.focus ? '★ 本处重点  ' : '') + text(instance.context || project.description || project.summary);
    return `<g transform="translate(${n(instance.x)} ${n(instance.y)})"><title>${esc(title)}${present(instance.context) ? ' — '+esc(instance.context) : ''}</title><rect width="282" height="152" rx="6" fill="#ffffff" stroke="${instance.focus ? '#a29b80' : '#deded6'}" stroke-width="${instance.focus ? '2' : '1'}"/><text x="15" y="28" font-size="14" font-weight="600" fill="#37352f">${wrap(title,18,2).map((line,index) => `<tspan x="15" dy="${index ? '21' : '0'}">${esc(line)}</tspan>`).join('')}</text><text x="15" y="78" font-size="11" fill="#73726e">${esc(wrap(metadata,22,1)[0])}</text><text x="15" y="103" font-size="11" fill="#73726e">${esc(wrap(tags.join(' · '),22,1)[0])}</text><text x="15" y="130" font-size="11" fill="#73726e">${esc(wrap(note,22,1)[0])}</text></g>`;
  }).join('');
  return `<div class="snapshot-map-scroll"><svg class="snapshot-map" xmlns="http://www.w3.org/2000/svg" width="100%" height="420" viewBox="${n(left)} ${n(top)} ${n(width)} ${n(height)}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="快照中的只读画板布局"><title>当时的画板布局</title><desc>${frames.length} 个分组，${instances.length} 处项目卡片${annotations.length?'，'+annotations.length+' 处文字、便签或连线':''}；完整文字可在下方展开查看。</desc><rect x="${n(left)}" y="${n(top)}" width="${n(width)}" height="${n(height)}" fill="#fcfcfa"/>${frameSVG}${cardSVG}${annotations.map(annotationSVG).join('')}</svg></div><p class="snapshot-caption muted">${frames.length} 个分组 · ${instances.length} 处卡片${annotations.length?' · '+annotations.length+' 处文字、便签或连线':''}。按保存坐标展示，缩略文字可在下方展开阅读。${skipped ? `另有 ${skipped} 处无有效布局或项目引用。` : ''}</p>`;
}

function boardsHTML(data, projectById, tagById) {
  const boards = list(data.quickBoards).map((board,index) => ({board,index})).sort((a,b) => (finite(a.board.rank) ? a.board.rank : a.index) - (finite(b.board.rank) ? b.board.rank : b.index));
  if (!boards.length) return '<p class="snapshot-empty muted">这份快照没有行动看板。</p>';
  return `<div class="snapshot-boards">${boards.map(({board}) => {
    const members = ids(board.projectIds), emphasis = new Set(ids(board.emphasisIds));
    return `<details class="snapshot-board" open><summary><span class="snapshot-color" style="background:${color(board.color)}"></span><strong>${esc(board.name || '未命名看板')}</strong><small>${members.length} 个项目</small></summary><div class="snapshot-board-body">${paragraph('看板说明',board.notes)}${members.length ? `<ul class="snapshot-board-members">${members.map(id => {
      const project = projectById.get(id);
      const context = board.contexts && Object.hasOwn(board.contexts,id) ? board.contexts[id] : '';
      return `<li class="snapshot-board-member${emphasis.has(id) ? ' snapshot-emphasis' : ''}"><div class="snapshot-member-heading"><strong>${esc(project?.name || '快照中缺少此项目')}</strong>${emphasis.has(id) ? '<span class="snapshot-badge">★ 本板重点</span>' : ''}${present(project?.priority) ? `<span class="snapshot-badge">${esc(project.priority)}</span>` : ''}</div>${project ? `<div class="snapshot-tags">${tagsHTML(project,tagById)}</div>` : ''}${paragraph('本看板备注',context)}</li>`;
    }).join('')}</ul>` : '<p class="snapshot-empty muted">当时未加入项目。</p>'}</div></details>`;
  }).join('')}</div>`;
}

function plansHTML(project) {
  const plans = list(project.planNodes);
  if (!plans.length) return '';
  const statuses = {doing:'进行中',not_started:'未开始',finished:'已完成',blocked:'受阻'};
  return `<section class="snapshot-project-section"><h4>当时的计划</h4><div class="snapshot-plans">${plans.map(plan => {
    const fields = [['跟进人',plan.owner],['期望日期',plan.targetDate],['承诺交付日',plan.estimatedDate],['实际交付日',plan.delivery?.completedAt],['实际开始',plan.actualStart],['实际完成',plan.actualFinish],['状态',Object.hasOwn(statuses,text(plan.status)) ? statuses[plan.status] : plan.status]];
    const info = fields.filter(([,value]) => present(value));
    if (present(plan.estimatedDate)) info.push(['交付确认',plan.dateConfirmed === true ? '已确认' : '未确认']);
    return `<article class="snapshot-plan"><strong>${esc(plan.title || '未命名计划')}</strong>${plan.focus ? '<span class="snapshot-badge">卡片展示</span>' : ''}${info.length ? `<dl class="snapshot-meta">${info.map(([label,value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>` : ''}${richParagraph('说明',plan.note,plan.richText?.note)}</article>`;
  }).join('')}</div></section>`;
}

function materialsHTML(project) {
  const materials = list(project.materials);
  if (!materials.length) return '';
  return `<section class="snapshot-project-section"><h4>当时的资料</h4><ul class="snapshot-materials">${materials.map(material => {
    const name = material.title || '未命名资料', anchor = link(material.url,name);
    return `<li>${anchor || `<span>${esc(name)}</span><small class="muted"> · 无可用链接</small>`}${paragraph('资料说明',material.note || material.description)}</li>`;
  }).join('')}</ul></section>`;
}

function placementNotesHTML(project, data) {
  const placements = list(data.instances).filter(instance => instance.pid === project.id);
  const frames = list(data.frames);
  const notes = placements.map((instance,index) => ({instance,index})).filter(({instance}) => present(instance.context) || present(instance.richText?.context) || instance.focus);
  if (!notes.length) return '';
  return `<section class="snapshot-project-section"><h4>画板各处备注</h4>${notes.map(({instance,index}) => {
    const names = frames.filter(frame => ids(frame.members).includes(instance.id)).map(frame => text(frame.name)).filter(Boolean);
    return `<div class="snapshot-placement-note"><strong>${esc(names.join(' / ') || `画板位置 ${index+1}`)}</strong>${instance.focus ? '<span class="snapshot-badge">★ 本处重点</span>' : ''}${present(instance.context)||present(instance.richText?.context) ? `<div class="snapshot-text rich-content">${richHTML(text(instance.richText?.context),text(instance.context))}</div>` : ''}</div>`;
  }).join('')}</section>`;
}

function relationsHTML(project, data, projectById) {
  const relations = list(data.relations).filter(relation => relation.main === project.id || relation.child === project.id);
  if (!relations.length) return '';
  return `<section class="snapshot-project-section"><h4>当时的项目关联</h4><ul class="snapshot-relations">${relations.map(relation => {
    const child = relation.main === project.id, other = projectById.get(child ? relation.child : relation.main);
    return `<li><span class="muted">${child ? '关联小项目' : '所属主项目'}</span> <strong>${esc(other?.name || '快照中缺少此项目')}</strong>${relation.draft ? '<span class="snapshot-badge">待确认</span>' : ''}${richParagraph('关联说明',relation.context,relation.richText?.context)}</li>`;
  }).join('')}</ul></section>`;
}

function commentsHTML(project) {
  const comments=orderedComments(list(project.comments));
  if(!comments.length)return '';
  return `<section class="snapshot-project-section"><h4>评论池</h4><ul class="snapshot-comments">${comments.map(comment=>`<li><div class="snapshot-meta">${comment.pinned?'<span class="snapshot-badge">置顶</span>':''}${present(comment.author)?`<span>${esc(comment.author)}</span>`:''}${present(comment.createdAt)?`<time>${esc(dateLabel(comment.createdAt))}</time>`:''}</div><div class="snapshot-text rich-content">${richHTML(text(comment.richText?.body),text(comment.body))}</div></li>`).join('')}</ul></section>`;
}

function customSectionsHTML(project) {
  const sections=list(project.customSections);
  return sections.map(section=>`<section class="snapshot-project-section"><h4>${esc(section.title||'未命名栏目')}</h4><div class="snapshot-text rich-content">${richHTML(text(section.richText?.body),text(section.body))}</div></section>`).join('');
}

function resultsHTML(project,data) {
  const show=isClosedProject(project)||(data.projectContentVersion!==1&&typeof project.closed!=='boolean');
  if(!show||(!present(project.result)&&!present(project.impact)&&!present(project.richText?.result)&&!present(project.richText?.impact)))return '';
  return `<section class="snapshot-project-section"><h4>成果记录</h4>${richParagraph('结果',project.result,project.richText?.result)}${richParagraph('影响与证据说明',project.impact,project.richText?.impact)}</section>`;
}

function flowHTML(project) {
  if(!project.flow)return '';
  const flow=readProjectFlow(project);
  if(!flow.nodes.length)return '';
  return '<section class="snapshot-project-section"><h4>当时的流程</h4><p>'+flow.nodes.map(node=>esc(node.title)+(node.id===flow.currentId?'（当前）':'')).join(' → ')+'</p></section>';
}

/** Render only recorded exceptions; the current clock never rewrites old snapshots. */
function deliveryHistoryHTML(data){
  const labels={baseline:'首次留档',confirmed:'确认交付日',reconfirmed:'重新确认',rescheduled:'延期改期',advanced:'提前交付日',corrected:'日期更正',withdrawn:'撤回确认',overdue:'已过承诺交付日',delivered:'记录交付',reopened:'恢复跟进',removed:'移除计划',undo:'撤销调整',restored:'恢复计划',projectClosed:'项目结束',projectReopened:'项目恢复跟进'};
  const exceptions=new Set(['reconfirmed','rescheduled','advanced','corrected','withdrawn','overdue','reopened','removed','undo','restored']);
  const groups=new Map();
  for(const event of list(data.deliveryEvents)){
    const identity=JSON.stringify([event.projectId,event.nodeId]);
    if(!groups.has(identity))groups.set(identity,[]);
    groups.get(identity).push(event);
  }
  const rows=[...groups.values()].filter(events=>events.some(event=>exceptions.has(event.kind)||(event.kind==='delivered'&&present(event.completedAt)&&present(event.toDate)&&event.completedAt>event.toDate)));
  if(!rows.length)return '';
  rows.sort((a,b)=>Number(b.some(e=>['overdue','rescheduled'].includes(e.kind)))-Number(a.some(e=>['overdue','rescheduled'].includes(e.kind)))||text(b.at(-1)?.at).localeCompare(text(a.at(-1)?.at)));
  return '<section class="snapshot-section"><h3>交付变更留档</h3>'+rows.map(events=>{
    const latest=events.at(-1),project=list(data.projects).find(p=>p.id===latest.projectId),node=list(project?.planNodes).find(n=>n.id===latest.nodeId);
    return '<details class="snapshot-project"><summary><strong>'+esc(project?.name||latest.projectName||'已移除项目')+'</strong><span>'+esc(node?.title||latest.nodeTitle||'未命名计划')+'</span>'+(!node?'<small>计划已移除</small>':'')+'</summary><div class="snapshot-project-body">'+events.slice().sort((a,b)=>text(b.at).localeCompare(text(a.at))).map(event=>'<article class="snapshot-plan"><strong>'+esc(labels[event.kind]||'交付记录')+'</strong><div class="snapshot-meta"><time>'+esc(dateLabel(event.at))+'</time><span>'+esc(event.actor||'未署名')+'</span></div>'+((present(event.fromDate)||present(event.toDate))?'<p>'+esc(event.fromDate||'未设置')+' → '+esc(event.toDate||'已撤回')+'</p>':'')+paragraph('理由',event.reason)+paragraph('实际交付日',event.completedAt)+'</article>').join('')+'</div></details>';
  }).join('')+'</section>';
}

function projectsHTML(data, projects, projectById, tagById) {
  if (!projects.length) return '<p class="snapshot-empty muted">这份快照没有项目记录。</p>';
  return `<div class="snapshot-projects">${projects.map(project => {
    return `<details class="snapshot-project"><summary>${present(project.priority) ? `<span class="snapshot-badge">${esc(project.priority)}</span>` : ''}<strong>${esc(project.name || '未命名项目')}</strong>${present(project.outcome) ? `<small>${esc(project.outcome)}</small>` : ''}</summary><div class="snapshot-project-body">${metadataHTML(project)}${flowHTML(project)}<div class="snapshot-tags">${tagsHTML(project,tagById)}</div>${richParagraph('问题陈述',project.description,project.richText?.description)}${paragraph('历史摘要',project.summary)}${commentsHTML(project)}${customSectionsHTML(project)}${resultsHTML(project,data)}${plansHTML(project)}${materialsHTML(project)}${placementNotesHTML(project,data)}${relationsHTML(project,data,projectById)}</div></details>`;
  }).join('')}</div>`;
}

export function renderSnapshotPreview(snap) {
  if (!snap || typeof snap !== 'object' || !snap.data || typeof snap.data !== 'object') return '<div class="snapshot-preview"><p class="snapshot-empty muted">这份快照没有可读取的内容。</p></div>';
  const data = snap.data, projects = list(data.projects), tags = list(data.tags);
  const projectById = new Map(projects.map(project => [project.id,project]));
  const tagById = new Map(tags.map(tag => [tag.id,tag]));
  const timestamp = dateLabel(snap.createdAt);
  const frameNotes = list(data.frames).filter(frame => present(frame.rationale));
  return `<div class="snapshot-preview"><header class="snapshot-preview-head"><strong>${esc(snap.name || '未命名快照')}</strong><p class="muted">只读${timestamp ? ' · '+esc(timestamp) : ''} · ${projects.length} 个项目。展示保存时的内容。</p></header><section class="snapshot-section"><h3>当时的画板布局</h3>${canvasHTML(data,projectById,tagById)}${annotationTextHTML(data)}${frameNotes.length ? `<details class="snapshot-frame-notes"><summary>分组说明</summary>${frameNotes.map(frame => paragraph(frame.name || '未命名分组',frame.rationale)).join('')}</details>` : ''}</section><section class="snapshot-section"><h3>当时的行动看板</h3>${boardsHTML(data,projectById,tagById)}</section>${deliveryHistoryHTML(data)}<section class="snapshot-section"><h3>项目清单</h3><p class="snapshot-caption muted">展开查看当时的问题陈述、评论、栏目、计划与资料。</p>${projectsHTML(data,projects,projectById,tagById)}</section></div>`;
}

/** Full historical project content for the standalone canvas drawer. */
export function renderSnapshotProjectDetails(snap,projectId){
  if(!snap?.data)return '';
  const data=snap.data,projects=list(data.projects),projectById=new Map(projects.map(p=>[p.id,p]));
  const project=projectById.get(projectId);if(!project)return '';
  const tags=new Map(list(data.tags).map(t=>[t.id,t]));
  return '<div class="snapshot-preview snapshot-project-detail">'+projectsHTML(data,[project],projectById,tags)+'</div>';
}

export function renderSnapshotRecords(snap){
  if(!snap?.data)return '';
  const data=snap.data,projects=list(data.projects),byId=new Map(projects.map(p=>[p.id,p])),tags=new Map(list(data.tags).map(t=>[t.id,t]));
  const notes=list(data.frames).filter(f=>present(f.rationale));
  return '<div class="snapshot-preview"><section class="snapshot-section"><h3>行动看板</h3>'+boardsHTML(data,byId,tags)+'</section>'+deliveryHistoryHTML(data)+
    '<section class="snapshot-section"><h3>项目记录</h3>'+projectsHTML(data,projects,byId,tags)+'</section>'+annotationTextHTML(data)+
    (notes.length?'<section class="snapshot-section"><h3>分组说明</h3>'+notes.map(f=>paragraph(f.name||'未命名分组',f.rationale)).join('')+'</section>':'')+'</div>';
}
