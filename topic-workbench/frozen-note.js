import {richHTML,richHasContent} from './rich-text.js?v=20261030-card-preview';
import {projectLifecycle} from './project-lifecycle.js';

/** Present older optional notes in one editable field without deleting their originals. */
export function frozenNote(project={}) {
  const fields=[['freezeReason','']];
  if(project.frozenNoteVersion!==1){
    fields.push(['resumeCondition','恢复条件：']);
    if(projectLifecycle(project)==='frozen')fields.push(['impact','已有进展：']);
  }
  const parts=fields.map(([key,label])=>({label,text:project[key]||'',html:project.richText?.[key]||''}))
    .filter(part=>richHasContent(part));
  return {
    text:parts.map(part=>part.label+part.text).join('\n\n'),
    // The shared rich-text renderer sanitizes this stored HTML before display.
    html:parts.map(part=>(part.label?'<p>'+part.label+'</p>':'')+(part.html||richHTML('',part.text))).join('')
  };
}

/** Once edited, respect removals rather than adding old notes back on the next render. */
export function saveFrozenNote(project,{text='',html=''}={}) {
  project.freezeReason=text;
  project.richText||={};project.richText.freezeReason=html;
  project.frozenNoteVersion=1;
}
