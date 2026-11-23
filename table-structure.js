/* Generic document table-grid detector. No page-size or table-shape assumptions. */
(function (root) {
  "use strict";
  function runs(values,gap){const groups=[];for(const v of values){const last=groups[groups.length-1];if(!last||v-last[last.length-1]>gap)groups.push([v]);else last.push(v);}return groups.map(g=>g.reduce((a,b)=>a+b,0)/g.length);}
  function groupRows(ys,gap){const groups=[];for(const y of ys){const last=groups[groups.length-1];if(!last||y-last[last.length-1]>gap)groups.push([y]);else last.push(y);}return groups;}
  function detectGrid(canvas){
    if(!canvas||!canvas.getContext)return null;
    const width=canvas.width,height=canvas.height;
    if(!width||!height||width*height>18000000)return null;
    const data=canvas.getContext("2d",{willReadFrequently:true}).getImageData(0,0,width,height).data;
    const rowCounts=new Uint32Array(height);
    for(let y=0;y<height;y++){let n=0,off=y*width*4;for(let x=0;x<width;x++){const i=off+x*4;if(.299*data[i]+.587*data[i+1]+.114*data[i+2]<205)n++;}rowCounts[y]=n;}
    // Find a dense group of horizontal rules first. All later thresholds are
    // relative to this table ROI, not the entire page height.
    const horizontal=runs(Array.from({length:height},(_,y)=>y).filter(y=>rowCounts[y]>=Math.max(18,width*.42)),Math.max(2,Math.round(height/1200)));
    if(horizontal.length<3)return null;
    const horizontalGaps=horizontal.slice(1).map((y,i)=>y-horizontal[i]);
    const sortedHorizontalGaps=horizontalGaps.slice().sort((a,b)=>a-b);
    const medianRowGap=sortedHorizontalGaps.length?sortedHorizontalGaps[Math.floor(sortedHorizontalGaps.length/2)]:0;
    const groups=groupRows(horizontal,Math.max(36,medianRowGap*4.5));
    let table=groups.filter(g=>g.length>=3&&g[g.length-1]-g[0]>=Math.max(30,height*.025))
      .sort((a,b)=>(b.length*(b[b.length-1]-b[0]))-(a.length*(a[a.length-1]-a[0])))[0];
    if(!table)return null;
    if(table.length>=4){
      const rowGaps=table.slice(1).map((y,i)=>y-table[i]);
      const sortedRowGaps=rowGaps.slice().sort((a,b)=>a-b);
      const typicalRowGap=sortedRowGaps[Math.floor(sortedRowGaps.length/2)];
      const trimTop=rowGaps[0]<typicalRowGap*.4;
      const trimBottom=rowGaps[rowGaps.length-1]<typicalRowGap*.4;
      if(trimTop)table=table.slice(1);
      if(trimBottom)table=table.slice(0,-1);
    }
    if(table.length<3)return null;
    const top=table[0],bottom=table[table.length-1],tableHeight=bottom-top;
    if(tableHeight<30)return null;
    const columnCounts=new Uint32Array(width);
    for(let y=Math.max(0,Math.floor(top));y<=Math.min(height-1,Math.ceil(bottom));y++){const off=y*width*4;for(let x=0;x<width;x++){const i=off+x*4;if(.299*data[i]+.587*data[i+1]+.114*data[i+2]<205)columnCounts[x]++;}}
    let xs=runs(Array.from({length:width},(_,x)=>x).filter(x=>columnCounts[x]>=Math.max(12,tableHeight*.62)),Math.max(3,Math.round(width/300)));
    if(xs.length<3)return null;
    // A page frame can sit just outside the actual table and create two
    // narrow gutters. Remove both outer candidates together, using the
    // median interior column spacing so a genuinely narrow first column stays.
    if(xs.length>=4){
      const gaps=xs.slice(1).map((x,i)=>x-xs[i]);
      const sorted=gaps.slice().sort((a,b)=>a-b);
      const medianGap=sorted[Math.floor(sorted.length/2)];
      const trimLeft=gaps[0]<medianGap*.4;
      const trimRight=gaps[gaps.length-1]<medianGap*.4;
      if(trimLeft)xs=xs.slice(1);
      if(trimRight)xs=xs.slice(0,-1);
    }
    const intersects=(x,y)=>{const xi=Math.round(x),yi=Math.round(y);let hs=0,vs=0;
      for(let yy=Math.max(0,yi-2);yy<=Math.min(height-1,yi+2);yy++)for(let xx=Math.max(0,xi-12);xx<=Math.min(width-1,xi+12);xx++){const i=(yy*width+xx)*4;if(.299*data[i]+.587*data[i+1]+.114*data[i+2]<205)hs++;}
      for(let xx=Math.max(0,xi-2);xx<=Math.min(width-1,xi+2);xx++)for(let yy=Math.max(0,yi-12);yy<=Math.min(height-1,yi+12);yy++){const i=(yy*width+xx)*4;if(.299*data[i]+.587*data[i+1]+.114*data[i+2]<205)vs++;}
      return hs>=15&&vs>=15;};
    xs=xs.filter(x=>table.filter(y=>intersects(x,y)).length>=3);
    const ys=table.filter(y=>xs.filter(x=>intersects(x,y)).length>=3);
    if(xs.length<3||ys.length<3)return null;
    return {xs,ys,top:ys[0],bottom:ys[ys.length-1],width,height};
  }
  function hasVerticalBoundary(canvas,x,y0,y1){
    const xi=Math.round(x),top=Math.max(0,Math.round(y0+2)),bottom=Math.min(canvas.height-1,Math.round(y1-2));
    if(bottom<=top)return false;
    const left=Math.max(0,xi-2),right=Math.min(canvas.width-1,xi+2),w=right-left+1,h=bottom-top+1;
    const data=canvas.getContext("2d",{willReadFrequently:true}).getImageData(left,top,w,h).data;
    let dark=0;for(let y=0;y<h;y++)for(let x0=0;x0<w;x0++){const i=(y*w+x0)*4;if(.299*data[i]+.587*data[i+1]+.114*data[i+2]<170)dark++;}
    return dark>=Math.max(5,h*1.25);
  }
  root.TableStructureDetector=Object.freeze({detectGrid,hasVerticalBoundary});
})(window);
