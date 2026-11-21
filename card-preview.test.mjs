import test from 'node:test';
import assert from 'node:assert/strict';
import {previewLines} from './card-preview.js';

test('有空间时最多展示两行，紧密排列时保留卡片元信息和间隔',()=>{
  assert.equal(previewLines({height:190,noteHeight:80,lineHeight:20}),2);
  assert.equal(previewLines({height:190,noteHeight:80,lineHeight:20,space:170}),2);
  assert.equal(previewLines({height:240,noteHeight:80,lineHeight:20,space:170}),1);
});
test('短正文不会被错误分配更少预览，已展开或收紧后重复计算仍一致',()=>{
  assert.equal(previewLines({height:130,noteHeight:20,lineHeight:20,space:190}),2);
  assert.equal(previewLines({height:230,noteHeight:120,lineHeight:20,space:170}),2);
  assert.equal(previewLines({height:170,noteHeight:60,lineHeight:20,space:170}),2);
});
