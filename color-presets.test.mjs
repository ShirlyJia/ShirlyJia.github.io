import test from 'node:test';
import assert from 'node:assert/strict';
import {COLOR_PRESETS,colorChoices,colorPickerMarkup} from './color-presets.js';

test('所有场景共用九个常用色名，背景和文字使用不同色阶',()=>{
  assert.equal(COLOR_PRESETS.length,9);
  for(const variant of ['accent','surface','ink']){
    const choices=colorChoices(variant);
    assert.equal(new Set(choices.map(p=>p.value)).size,9);
    assert.deepEqual(choices.map(p=>p.name),COLOR_PRESETS.map(p=>p.name));
    assert.ok(choices.every(p=>/^#[0-9a-f]{6}$/.test(p.value)));
  }
  for(const p of COLOR_PRESETS){assert.notEqual(p.surface,p.ink);assert.notEqual(p.surface,p.accent);}
});

test('旧颜色不自动替换，表单字段和原 change 目标保留，不生成原生色盘',()=>{
  const html=colorPickerMarkup('#ABC123','data-tag-color','tag1','标签颜色',{name:'color',inputId:'newTagColor'});
  assert.match(html,/value="#ABC123"/);assert.match(html,/当前颜色/);
  assert.match(html,/data-tag-color="tag1"/);assert.match(html,/name="color"/);assert.match(html,/id="newTagColor"/);
  assert.doesNotMatch(html,/type="color"/);assert.match(html,/type="hidden"/);
});

test('颜色与控件属性仅接受安全格式，文字标识统一转义',()=>{
  const html=colorPickerMarkup('red;position:fixed','data-frame-color','a"><script>','颜色<', {variant:'surface'});
  assert.match(html,/value="#f2f3f5"/);assert.match(html,/a&quot;&gt;&lt;script&gt;/);
  assert.doesNotMatch(html,/<script>|position:fixed/);
  assert.throws(()=>colorPickerMarkup('#ffffff','onclick','x','x'),/属性无效/);
});
