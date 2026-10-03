/* One projected pitch for DOM and PNG. Player positions and scoring stay with their callers. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FPLPitch = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const palette = Object.freeze({ grass: '#a5ccab', stripe: '#96c29e', line: '#f5faf2', edge: '#6d9976' });
  const FAR_SCALE = .72, SIDE = .035, TOP = .035, BOTTOM = .965;
  // Homography: all lengthwise lines converge at the same vanishing point. Unlike
  // CSS-clipped rectangles, the boxes, circles and mowing bands share this projection.
  function project(u, v) {
    const scale = FAR_SCALE / (1 - (1 - FAR_SCALE) * v);
    return [.5 + (u - .5) * scale * (1 - 2 * SIDE), TOP + v * scale * (BOTTOM - TOP)];
  }
  const rect = (left, top, right, bottom) => [[left, top], [right, top], [right, bottom], [left, bottom]].map(([u,v]) => project(u,v));
  function arc(u, v, radius, start = 0, end = Math.PI * 2, steps = 72) {
    return Array.from({ length: steps + 1 }, (_, i) => {
      const angle = start + (end - start) * i / steps;
      return project(u + Math.cos(angle) * radius / 68, v + Math.sin(angle) * radius / 105);
    });
  }
  const boundary = rect(0, 0, 1, 1);
  const stripes = Array.from({ length: 10 }, (_, i) => rect(0, i / 10, 1, (i + 1) / 10));
  const lines = [{ points: [project(0,.5), project(1,.5)] }, { points: arc(.5,.5,9.15), closed: true }];
  // Only the three interior sides: the end line is already drawn by the boundary.
  for (const end of [0, 1]) {
    for (const [boxWidth, depth] of [[40.32,16.5], [18.32,5.5]]) {
      const left = .5 - boxWidth / 136, right = .5 + boxWidth / 136;
      const inner = end === 0 ? depth / 105 : 1 - depth / 105;
      lines.push({ points: [[left,end],[left,inner],[right,inner],[right,end]].map(([u,v]) => project(u,v)) });
    }
    const angle = Math.asin(5.5 / 9.15);
    lines.push({ points: end === 0 ? arc(.5,11/105,9.15,angle,Math.PI-angle,32)
      : arc(.5,94/105,9.15,Math.PI+angle,2*Math.PI-angle,32) });
  }
  const spots = [[.5,.5],[.5,11/105],[.5,94/105]].map(([u,v]) => arc(u,v,.30,0,Math.PI*2,16));
  const svgPath = (points, closed = false) => points.map(([x,y],i) => `${i?'L':'M'}${(x*1000).toFixed(2)} ${(y*1000).toFixed(2)}`).join(' ') + (closed?' Z':'');
  const stroke = 'vector-effect="non-scaling-stroke" stroke-linecap="butt" stroke-linejoin="round"';
  const markup = `<div class="fpl-perspective-field" aria-hidden="true"><svg class="fpl-field-svg" viewBox="0 0 1000 1000" preserveAspectRatio="none" focusable="false" xmlns="http://www.w3.org/2000/svg">
    <path d="${svgPath(boundary,true)}" fill="${palette.grass}"/>
    ${stripes.filter((_,i)=>i%2===0).map(points=>`<path d="${svgPath(points,true)}" fill="${palette.stripe}"/>`).join('')}
    <g fill="none" stroke="${palette.line}" stroke-opacity=".9" stroke-width="1.15">${lines.map(line=>`<path d="${svgPath(line.points,line.closed)}" ${stroke}/>`).join('')}</g>
    <g fill="${palette.line}" fill-opacity=".8">${spots.map(points=>`<path d="${svgPath(points,true)}"/>`).join('')}</g>
    <path d="${svgPath(boundary,true)}" fill="none" stroke="${palette.edge}" stroke-opacity=".68" stroke-width="1.4" ${stroke}/>
  </svg></div>`;
  function draw(ctx, x, y, width, height) {
    const path = (points, closed = false) => {
      ctx.beginPath();
      points.forEach(([u,v],i) => i ? ctx.lineTo(x+u*width,y+v*height) : ctx.moveTo(x+u*width,y+v*height));
      if (closed) ctx.closePath();
    };
    ctx.save();
    path(boundary,true); ctx.fillStyle=palette.grass; ctx.fill();
    ctx.save(); ctx.clip();
    stripes.forEach((points,i) => { if (i%2===0) {path(points,true);ctx.fillStyle=palette.stripe;ctx.fill();} });
    ctx.strokeStyle=palette.line; ctx.lineWidth=Math.max(1.15,Math.min(width,height)/320); ctx.globalAlpha=.9; ctx.lineCap='butt';ctx.lineJoin='round';
    lines.forEach(line => {path(line.points,line.closed);ctx.stroke();});
    ctx.globalAlpha=.8;ctx.fillStyle=palette.line; spots.forEach(points=>{path(points,true);ctx.fill();});
    ctx.restore();
    path(boundary,true);ctx.strokeStyle=palette.edge;ctx.globalAlpha=.68;ctx.lineWidth=Math.max(1.4,Math.min(width,height)/280);ctx.stroke();
    ctx.restore();
  }
  // Available width at a screen-space height; used only to keep upright player cards in bounds.
  function boundsAt(y) {
    const depth = Math.max(0,Math.min(1,(y-TOP)/(BOTTOM-TOP)));
    const span = (FAR_SCALE+(1-FAR_SCALE)*depth)*(1-2*SIDE);
    return { left:(1-span)/2, right:(1+span)/2 };
  }
  return Object.freeze({ html:()=>markup, draw, boundsAt, project, palette });
});
