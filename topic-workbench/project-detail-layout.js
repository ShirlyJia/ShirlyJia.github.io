/** Project-owned presentation only: hiding a section never removes its content. */
export const DETAIL_SECTION_TITLES = Object.freeze({
  description:'问题陈述', result:'成果记录', comments:'评论池',
  children:'小项目', parents:'所属主项目', history:'这个方向积累的结果',
  plans:'计划', materials:'资料'
});

export function detailSectionKeys(project) {
  return ['description','result',...(project.customSections||[]).map(section=>'custom:'+section.id),'comments','children','parents','history','plans','materials'];
}

export function detailLayout(project) {
  const defaults=detailSectionKeys(project),known=new Set(defaults),saved=project.detailLayout||{};
  const order=[...new Set([...(saved.order||[]).filter(key=>known.has(key)),...defaults])];
  const hidden=[...new Set((saved.hidden||[]).filter(key=>key!=='description'&&Object.hasOwn(DETAIL_SECTION_TITLES,key)))];
  const titles=Object.fromEntries(Object.entries(saved.titles||{}).filter(([key,value])=>Object.hasOwn(DETAIL_SECTION_TITLES,key)&&typeof value==='string'));
  return {order,hidden,titles};
}

export function detailSectionTitle(project,key) {
  if(key.startsWith('custom:'))return project.customSections?.find(section=>'custom:'+section.id===key)?.title||'未命名栏目';
  return detailLayout(project).titles[key]?.trim()||DETAIL_SECTION_TITLES[key]||'栏目';
}

export function visibleDetailSections(project,availableKeys) {
  const layout=detailLayout(project),available=new Set(availableKeys);
  return layout.order.filter(key=>available.has(key)&&!layout.hidden.includes(key));
}

export function moveDetailSection(project,key,step,availableKeys) {
  const layout=detailLayout(project),visible=visibleDetailSections(project,availableKeys),index=visible.indexOf(key),next=index+step;
  if(![-1,1].includes(step)||index<0||next<0||next>=visible.length)return false;
  const from=layout.order.indexOf(key),to=layout.order.indexOf(visible[next]);
  [layout.order[from],layout.order[to]]=[layout.order[to],layout.order[from]];
  project.detailLayout=layout;return true;
}

export function setDetailSectionHidden(project,key,hidden) {
  if(key==='description'||!Object.hasOwn(DETAIL_SECTION_TITLES,key))return false;
  const layout=detailLayout(project);
  layout.hidden=layout.hidden.filter(value=>value!==key);
  if(hidden)layout.hidden.push(key);
  project.detailLayout=layout;return true;
}

export function renameDetailSection(project,key,title) {
  if(!Object.hasOwn(DETAIL_SECTION_TITLES,key))return false;
  const layout=detailLayout(project),value=title.trim();
  if(value&&value!==DETAIL_SECTION_TITLES[key])layout.titles[key]=value;else delete layout.titles[key];
  project.detailLayout=layout;return true;
}

export function removeCustomSection(project,id) {
  const index=(project.customSections||[]).findIndex(section=>section.id===id);if(index<0)return null;
  const layout=detailLayout(project),key='custom:'+id,position=layout.order.indexOf(key),section=project.customSections[index];
  project.customSections.splice(index,1);layout.order=layout.order.filter(value=>value!==key);project.detailLayout=layout;
  return {section,index,position};
}

export function restoreCustomSection(project,removed) {
  if(!removed||project.customSections?.some(section=>section.id===removed.section.id))return false;
  const layout=detailLayout(project);project.customSections||=[];
  project.customSections.splice(Math.min(removed.index,project.customSections.length),0,removed.section);
  layout.order.splice(Math.min(removed.position,layout.order.length),0,'custom:'+removed.section.id);
  project.detailLayout=layout;return true;
}
