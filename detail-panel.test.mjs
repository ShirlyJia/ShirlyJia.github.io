import test from 'node:test';
import assert from 'node:assert/strict';
import {detailWidth} from './detail-panel.js';
test('详情宽度保留拖动值与最小阅读宽度，并留出画板空白',()=>{
  assert.equal(detailWidth(720,1200),720);assert.equal(detailWidth(100,1200),360);
  assert.equal(detailWidth(2000,1200),1120);assert.equal(detailWidth(NaN,1200),560);
});
test('窗口收窄时约束到容器，不产生负宽度',()=>{
  assert.equal(detailWidth(700,400),320);assert.equal(detailWidth(700,60),0);
});
