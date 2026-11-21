import test from 'node:test';
import assert from 'node:assert/strict';
import {safeImageWidth,resizedImageWidth} from './rich-image-resize.js';

test('图片宽度只接受有界整数，样式、脚本和异常数值不能进入图片属性',()=>{
  for(const [input,expected] of [['320',320],[' 480 ',480],[1280,1280],['1',1],['4096',4096]])assert.equal(safeImageWidth(input),expected);
  for(const input of [null,undefined,'','0','-1','4097','300px','100%','1e3','320.5','200;position:fixed','1" onload="alert(1)',Infinity,NaN])assert.equal(safeImageWidth(input),null);
});
test('四个角支持横向或纵向缩放，保留比例计算且限制在文本框内',()=>{
  const start={width:400,height:200,maxWidth:600};
  assert.equal(resizedImageWidth({...start,corner:'se',dx:80,dy:30}),480);
  assert.equal(resizedImageWidth({...start,corner:'nw',dx:-80,dy:-30}),480);
  assert.equal(resizedImageWidth({...start,corner:'ne',dx:0,dy:-40}),480);
  assert.equal(resizedImageWidth({...start,corner:'sw',dx:0,dy:40}),480);
  assert.equal(resizedImageWidth({...start,dx:1000,dy:1000}),600);
  assert.equal(resizedImageWidth({...start,dx:-1000,dy:-1000}),24);
  assert.equal(resizedImageWidth({...start,maxWidth:18,dx:0,dy:0}),18);
});
test('异常几何不写成损坏尺寸；静止与往回拖动保持稳定',()=>{
  const start={width:240,height:160,maxWidth:800};
  assert.equal(resizedImageWidth({...start,dx:0,dy:0}),240);
  assert.equal(resizedImageWidth({...start,dx:-40,dy:0}),200);
  for(const patch of [{width:0},{height:-1},{dx:NaN},{dy:Infinity}])assert.throws(()=>resizedImageWidth({...start,dx:0,dy:0,...patch}),/无效/);
});
