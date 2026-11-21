import test from 'node:test';
import assert from 'node:assert/strict';
import {wheelDelta,enclosedFrameIds,moveSelection,centeredCanvasView} from './canvas-gesture.js';

test('触控板保留像素小数，行和页滚动换算为屏幕像素',()=>{
  assert.deepEqual(wheelDelta({deltaX:-4.5,deltaY:10.25,deltaMode:0}),{x:-4.5,y:10.25});
  assert.deepEqual(wheelDelta({deltaX:-2,deltaY:3,deltaMode:1}),{x:-32,y:48});
  assert.deepEqual(wheelDelta({deltaX:1,deltaY:-2,deltaMode:2},{width:800,height:500}),{x:800,y:-1000});
  assert.deepEqual(wheelDelta({deltaY:2,deltaMode:1},{lineHeight:20}),{x:0,y:40});
  assert.deepEqual(wheelDelta({deltaX:Infinity,deltaY:NaN}),{x:0,y:0});
});

test('Shift 滚轮横移，原生横向滚动与缩放手势保留各自方向',()=>{
  assert.deepEqual(wheelDelta({shiftKey:true,deltaY:2,deltaMode:1}),{x:32,y:0});
  assert.deepEqual(wheelDelta({shiftKey:true,deltaX:32}),{x:32,y:0});
  assert.deepEqual(wheelDelta({shiftKey:true,ctrlKey:true,deltaY:-8}),{x:0,y:-8});
});

test('跨越远距离空白的画板可全览，也能回到实际项目并读清标题',()=>{
  const left={x:-6000,y:-1000,w:280,h:160};
  const middle={x:-800,y:50,w:280,h:160};
  const right={x:6000,y:1000,w:280,h:160};
  const boxes=[left,middle,right];
  const overview=centeredCanvasView(boxes,800,500);
  assert.ok(overview.z<.18);
  for(const b of boxes) {
    assert.ok(overview.x+b.x*overview.z>=0 && overview.x+(b.x+b.w)*overview.z<=800);
    assert.ok(overview.y+b.y*overview.z>=0 && overview.y+(b.y+b.h)*overview.z<=500);
  }
  const home=centeredCanvasView(boxes,800,500,{readingTargets:boxes});
  assert.equal(home.z,1);
  assert.equal(home.x+(middle.x+middle.w/2)*home.z,400);
  assert.equal(home.y+(middle.y+middle.h/2)*home.z,250);
  assert.deepEqual(centeredCanvasView([left],800,500,{readingTargets:[left]}),centeredCanvasView([left],800,500));
  assert.deepEqual(centeredCanvasView([],800,500),{x:400,y:250,z:1});
  assert.equal(centeredCanvasView(boxes,0,500),null);
});

test('框选必须完整包围分组，内部选择与擦过边缘不带走分组',()=>{
  const frames=[{id:'one',x:20,y:30,w:300,h:200},{id:'two',x:360,y:30,w:300,h:200}];
  assert.deepEqual(enclosedFrameIds(frames,{x:20,y:30,w:300,h:200}),['one']);
  assert.deepEqual(enclosedFrameIds(frames,{x:50,y:60,w:100,h:100}),[]);
  assert.deepEqual(enclosedFrameIds(frames,{x:0,y:0,w:700,h:300}),['one','two']);
  assert.deepEqual(enclosedFrameIds(frames,{x:0,y:0,w:100,h:100}),[]);
  assert.deepEqual(enclosedFrameIds(frames,{x:0,y:0,w:NaN,h:300}),[]);
});

test('贴齐边缘的内框在小数坐标下仍嵌套，同尺寸重合框和部分重叠框保持独立',()=>{
  const dx=5/7;
  const outer={id:'outer',x:100+dx,y:20,w:470,h:400};
  const aligned={id:'aligned',x:260+dx,y:80,w:310,h:300};
  const state={frames:[aligned,{...outer,id:'peer'},{...aligned,id:'crossing',x:aligned.x+1},outer]};
  assert.deepEqual(moveSelection(state,{frameId:'outer'}).frames.map(f=>f.id),['aligned','outer']);
  assert.deepEqual(moveSelection(state,{frameId:'aligned'}).frames.map(f=>f.id),['aligned']);
});

test('多分组与显式选中卡片取并集，同一张卡片和标注只移动一次',()=>{
  const state={
    frames:[{id:'a',x:0,y:0,w:300,h:300,members:['i1','i2']},{id:'b',x:200,y:0,w:300,h:300,members:['i2','i3']}],
    instances:[{id:'i1',pid:'p',x:20,y:20},{id:'i2',pid:'p',x:220,y:20},{id:'i3',pid:'q',x:360,y:20},{id:'i4',pid:'r',x:600,y:20}],
    canvasItems:[{id:'note',type:'note',x:220,y:100,w:40,h:40,text:'n',style:{color:'pink'}},{id:'outside',type:'note',x:490,y:100,w:100,h:100},{id:'reverse',type:'arrow',x:280,y:260,x2:230,y2:210}],
    selected:new Set(['i2','i4']),selectedFrames:new Set(['a','b'])
  };
  const result=moveSelection(state);
  assert.deepEqual(result.frames.map(f=>f.id),['a','b']);
  assert.deepEqual(result.items.map(i=>i.id),['i1','i2','i3','i4']);
  assert.deepEqual(result.canvasItems.map(i=>i.id),['note','reverse']);
  result.frames[0].members.push('nope');result.canvasItems[0].style.color='blue';result.items[0].x=999;
  assert.deepEqual(state.frames[0].members,['i1','i2']);assert.equal(state.canvasItems[0].style.color,'pink');assert.equal(state.instances[0].x,20);
});

test('单个拖动目标兜底加入，陈旧选择不新增不存在的对象',()=>{
  const state={frames:[{id:'a',x:0,y:0,w:100,h:100,members:['i']}],instances:[{id:'i',pid:'p',x:1,y:2}],selectedFrames:new Set(['gone']),selected:new Set(['missing'])};
  assert.deepEqual(moveSelection(state).items,[]);
  assert.equal(moveSelection(state,{instanceId:'i'}).items.length,1);
  assert.equal(moveSelection(state,{frameId:'a'}).items.length,1);
  assert.deepEqual(moveSelection(state,{frameId:'a'}).canvasItems,[]);
});
