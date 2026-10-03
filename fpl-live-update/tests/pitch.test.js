const test=require('node:test'), assert=require('node:assert/strict');
const pitch=require('../public/pitch.js');
test('projected field keeps midfield and both complete penalty boxes inside its boundary',()=>{
  for (let v=0;v<=1;v+=.05) {
    const left=pitch.project(0,v),right=pitch.project(1,v),bounds=pitch.boundsAt(left[1]);
    assert.ok(Math.abs(bounds.left-left[0])<1e-10);
    assert.ok(Math.abs(bounds.right-right[0])<1e-10);
    assert.ok(left[0]>0&&right[0]<1);
  }
  assert.ok(pitch.project(1,0)[0]<pitch.project(1,1)[0]);
  const svg=pitch.html();
  assert.equal((svg.match(/vector-effect=/g)||[]).length,9);
  assert.ok(!svg.includes('clip-path'));
  assert.ok(svg.includes(pitch.palette.grass));
});
