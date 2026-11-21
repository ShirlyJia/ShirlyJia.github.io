import test from 'node:test';
import assert from 'node:assert/strict';
import {resizeFrameBounds} from './frame-resize.js';
const box={x:100,y:200,w:400,h:300};
test('四边缩放只改变对应边，另一轴与对边保持固定',()=>{
  for(const [edge,expected]of Object.entries({n:{x:100,y:220,w:400,h:280},e:{x:100,y:200,w:430,h:300},s:{x:100,y:200,w:400,h:320},w:{x:130,y:200,w:370,h:300}}))assert.deepEqual(resizeFrameBounds(box,edge,30,20),expected);
  assert.deepEqual(box,{x:100,y:200,w:400,h:300});
});
test('四角同时调整相邻边，不把框内内容做比例缩放',()=>{
  for(const [edge,expected]of Object.entries({ne:{x:100,y:220,w:430,h:280},se:{x:100,y:200,w:430,h:320},sw:{x:130,y:200,w:370,h:320},nw:{x:130,y:220,w:370,h:280}}))assert.deepEqual(resizeFrameBounds(box,edge,30,20),expected);
});
test('越过对边时限制最小尺寸，保留对边位置且不翻转',()=>{
  assert.deepEqual(resizeFrameBounds(box,'nw',1000,1000),{x:380,y:400,w:120,h:100});
  assert.deepEqual(resizeFrameBounds(box,'se',-1000,-1000),{x:100,y:200,w:120,h:100});
  assert.deepEqual(resizeFrameBounds(box,'nw',-200,-300),{x:-100,y:-100,w:600,h:600});
});
test('适配不同缩放比换算后的拖动距离，拒绝非有限值',()=>{
  for(const zoom of [.18,.5,1,1.8]){
    const result=resizeFrameBounds(box,'w',20/zoom,0);
    assert.ok(Math.abs((result.x-box.x)*zoom-20)<1e-8);
    assert.equal(result.x+result.w,box.x+box.w);
  }
  assert.throws(()=>resizeFrameBounds(box,'x',1,1));
  assert.throws(()=>resizeFrameBounds(box,'n',NaN,0));
});
