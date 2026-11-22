/* Image-grid based OCR table detector.
 * Detects printed horizontal/vertical rules first, then places original OCR words in cells.
 */
(function (root) {
  "use strict";
  function median(values) {
    if (!values.length) return 0;
    const sorted = values.slice().sort((a,b)=>a-b);
    return sorted[Math.floor(sorted.length/2)];
  }
  function validWord(w) {
    return w && typeof w.text === "string" && w.text.trim() && w.bbox &&
      Number.isFinite(w.bbox.x0) && Number.isFinite(w.bbox.x1) &&
      Number.isFinite(w.bbox.y0) && Number.isFinite(w.bbox.y1) &&
      w.bbox.x1 > w.bbox.x0 && w.bbox.y1 > w.bbox.y0;
  }
  function clusterRuns(values, minGap) {
    const groups=[];
    for (const value of values) {
      const last=groups[groups.length-1];
      if (!last || value-last[last.length-1] > minGap) groups.push([value]);
      else last.push(value);
    }
    return groups.map(g=>g.reduce((a,b)=>a+b,0)/g.length);
  }
  function detectGrid(canvas) {
    if (!canvas || !canvas.getContext) return null;
    const ctx=canvas.getContext("2d",{willReadFrequently:true});
    const w=canvas.width,h=canvas.height;
    if (!w || !h || w*h > 12000000) return null;
    const px=ctx.getImageData(0,0,w,h).data;
    const col=new Uint32Array(w), row=new Uint32Array(h);
    // Dark-pixel projections: long printed rules dominate text strokes.
    for(let y=0;y<h;y++){
      const offset=y*w*4;
      for(let x=0;x<w;x++){
        const i=offset+x*4;
        const gray=0.299*px[i]+0.587*px[i+1]+0.114*px[i+2];
        if(gray<105){col[x]++;row[y]++;}
      }
    }
    const verticalThreshold=Math.max(80,Math.floor(h*0.27));
    const horizontalThreshold=Math.max(80,Math.floor(w*0.43));
    const vx=[],hy=[];
    for(let x=0;x<w;x++) if(col[x]>=verticalThreshold) vx.push(x);
    for(let y=0;y<h;y++) if(row[y]>=horizontalThreshold) hy.push(y);
    const xs=clusterRuns(vx,Math.max(8,Math.round(w/250)));
    let ys=clusterRuns(hy,Math.max(8,Math.round(h/250)));
    if(xs.length<3 || ys.length<3) return null;

    // A horizontal page frame can span the whole page without belonging to
    // the table. Keep horizontal rules that cross several sustained vertical
    // grid strokes, not merely the horizontal stroke itself.
    const verticalSupport=(x,y)=>{
      const xi=Math.round(x), yi=Math.round(y);
      let count=0;
      for(let yy=Math.max(0,yi-20);yy<Math.min(h,yi+21);yy++){
        for(let xx=Math.max(0,xi-2);xx<Math.min(w,xi+3);xx++){
          const i=(yy*w+xx)*4;
          const gray=0.299*px[i]+0.587*px[i+1]+0.114*px[i+2];
          if(gray<105) count++;
        }
      }
      return count;
    };
    ys=ys.filter(y=>xs.filter(x=>verticalSupport(x,y)>30).length>=3);
    if(ys.length<3) return null;
    return {xs,ys};
  }
  function detectFromOcrLines(words) {
    if (!words.length) return {ok:false,reason:"인식된 단어의 위치 정보가 없습니다. 먼저 문자 추출을 실행해 주세요."};
    const heights=words.map(w=>w.bbox.y1-w.bbox.y0);
    const lineTolerance=Math.max(5,median(heights)*0.58);
    const lines=[];
    for(const word of words.slice().sort((a,b)=>((a.bbox.y0+a.bbox.y1)-(b.bbox.y0+b.bbox.y1))||a.bbox.x0-b.bbox.x0)){
      const cy=(word.bbox.y0+word.bbox.y1)/2;
      let line=lines.find(item=>Math.abs(item.cy-cy)<=lineTolerance);
      if(!line){line={cy,words:[]};lines.push(line);}
      line.words.push(word);
      line.cy=line.words.reduce((sum,w)=>sum+(w.bbox.y0+w.bbox.y1)/2,0)/line.words.length;
    }
    lines.sort((a,b)=>a.cy-b.cy);
    const gaps=[];
    for(let li=0;li<lines.length;li++){
      const ordered=lines[li].words.sort((a,b)=>a.bbox.x0-b.bbox.x0);
      for(let i=0;i<ordered.length-1;i++){
        const gap=ordered[i+1].bbox.x0-ordered[i].bbox.x1;
        if(gap>=Math.max(12,median(heights)*1.25)){
          gaps.push({x:(ordered[i].bbox.x1+ordered[i+1].bbox.x0)/2,line:li,gap});
        }
      }
    }
    const clusters=[];
    const tolerance=Math.max(16,median(heights)*2.0);
    for(const gap of gaps.sort((a,b)=>a.x-b.x)){
      let cluster=clusters.find(c=>Math.abs(c.x-gap.x)<=tolerance);
      if(!cluster){cluster={x:gap.x,lines:new Set(),values:[]};clusters.push(cluster);}
      cluster.values.push(gap.x);cluster.lines.add(gap.line);
      cluster.x=cluster.values.reduce((a,b)=>a+b,0)/cluster.values.length;
    }
    // A separator must recur on multiple OCR lines; a single wide word gap
    // is not enough evidence to create a column.
    const separators=clusters.filter(c=>c.lines.size>=2).sort((a,b)=>a.x-b.x).map(c=>c.x);
    const minX=Math.min(...words.map(w=>w.bbox.x0));
    const maxX=Math.max(...words.map(w=>w.bbox.x1));
    if(!separators.length) {
      return {ok:false,reason:"표의 선은 검출되지 않았고, 여러 OCR 줄에서 반복되는 열 경계도 확인되지 않았습니다. 원본 이미지의 표 전체가 보이도록 다시 촬영하거나 이미지를 올려 주세요."};
    }
    const bounds=[minX-1,...separators.filter(x=>x>minX&&x<maxX),maxX+1];
    const matrix=lines.map(line=>{
      const cells=Array(bounds.length-1).fill("");
      for(const word of line.words.sort((a,b)=>a.bbox.x0-b.bbox.x0)){
        const cx=(word.bbox.x0+word.bbox.x1)/2;
        let col=bounds.findIndex((x,i)=>i<bounds.length-1&&cx>=x&&cx<bounds[i+1]);
        if(col<0) col=cells.length-1;
        cells[col]+=(cells[col]?" ":"")+word.text.trim();
      }
      return cells;
    });
    const source=words.map(w=>w.text.trim()).sort().join("\u0000");
    const output=matrix.flatMap(row=>row.join(" ").split(/\\s+/)).filter(Boolean).sort().join("\u0000");
    if(source!==output) return {ok:false,reason:"자동 열 분할 과정에서 글자 보존 검사를 통과하지 못했습니다. 원본 OCR 텍스트는 유지했습니다."};
    return {ok:true,rowCount:matrix.length,columnCount:bounds.length-1,text:matrix.map(row=>row.join("\\t")).join("\\n"),grid:{verticalLines:0,horizontalLines:0},method:"ocr-line-fallback"};
  }
  function detect(data, canvas) {
    const words=(Array.isArray(data&&data.words)?data.words:[])
      .filter(validWord).slice().sort((a,b)=>a.bbox.y0-b.bbox.y0||a.bbox.x0-b.bbox.x0);
    const grid=detectGrid(canvas);
    if(!grid) return detectFromOcrLines(words);
    const xs=grid.xs,ys=grid.ys;
    const xBounds=xs.filter(x=>x>=xs[0]&&x<=xs[xs.length-1]);
    const yBounds=ys.filter(y=>y>=ys[0]&&y<=ys[ys.length-1]);
    const matrix=Array.from({length:yBounds.length-1},()=>Array(xBounds.length-1).fill(""));
    const cellLines=Array.from({length:yBounds.length-1},()=>Array.from({length:xBounds.length-1},()=>[]));
    for(const word of words){
      const cx=(word.bbox.x0+word.bbox.x1)/2;
      const cy=(word.bbox.y0+word.bbox.y1)/2;
      let c=-1,r=-1;
      for(let i=0;i<xBounds.length-1;i++) if(cx>=xBounds[i]&&cx<=xBounds[i+1]){c=i;break;}
      for(let i=0;i<yBounds.length-1;i++) if(cy>=yBounds[i]&&cy<=yBounds[i+1]){r=i;break;}
      if(r>=0&&c>=0) cellLines[r][c].push(word);
    }
    for(let r=0;r<cellLines.length;r++){
      for(let c=0;c<cellLines[r].length;c++){
        const cellWords=cellLines[r][c].sort((a,b)=>a.bbox.y0-b.bbox.y0||a.bbox.x0-b.bbox.x0);
        const lineGroups=[];
        for(const word of cellWords){
          const cy=(word.bbox.y0+word.bbox.y1)/2;
          let line=lineGroups.find(item=>Math.abs(item.cy-cy)<=Math.max(5,median(cellWords.map(x=>x.bbox.y1-x.bbox.y0))*0.55));
          if(!line){line={cy,words:[]};lineGroups.push(line);}
          line.words.push(word);
        }
        matrix[r][c]=lineGroups.sort((a,b)=>a.cy-b.cy)
          .map(line=>line.words.sort((a,b)=>a.bbox.x0-b.bbox.x0).map(w=>w.text.trim()).join(" "))
          .filter(Boolean).join(" / ");
      }
    }
    // Remove empty outer frame bands. The photographed page may have a second
    // decorative border outside the actual table grid.
    while (matrix.length && matrix[0].every(cell => !cell.trim())) matrix.shift();
    while (matrix.length && matrix[matrix.length - 1].every(cell => !cell.trim())) matrix.pop();
    while (matrix.length && matrix.every(row => !row[0].trim())) {
      matrix.forEach(row => row.shift());
    }
    while (matrix.length && matrix.every(row => !row[row.length - 1].trim())) {
      matrix.forEach(row => row.pop());
    }
    if (!matrix.length || !matrix[0].length) {
      return {ok:false,reason:"표 내부의 셀을 찾지 못했습니다."};
    }

    // Reject text outside the detected grid or any token loss/duplication.
    const tokenCounts=text=>{
      const map=new Map();
      for(const token of (text.match(/[^\s]+/g)||[])){
        const key=token.toLocaleLowerCase();
        map.set(key,(map.get(key)||0)+1);
      }
      return map;
    };
    const inside=words.filter(word=>{
      const x=(word.bbox.x0+word.bbox.x1)/2,y=(word.bbox.y0+word.bbox.y1)/2;
      return x>=xBounds[0]&&x<=xBounds[xBounds.length-1]&&y>=yBounds[0]&&y<=yBounds[yBounds.length-1];
    });
    const expected=tokenCounts(inside.map(w=>w.text.trim()).join(" "));
    const actual=tokenCounts(matrix.flat().join(" "));
    if(expected.size!==actual.size||Array.from(expected).some(([t,n])=>actual.get(t)!==n)){
      return {ok:false,reason:"표 격자 안의 글자 보존 검사를 통과하지 못했습니다. 원본 OCR 텍스트는 유지했습니다."};
    }
    return {
      ok:true,rowCount:matrix.length,columnCount:matrix[0].length,
      text:matrix.map(row=>row.join("\t")).join("\n"),
      grid:{verticalLines:xs.length,horizontalLines:ys.length}
    };
  }
  root.TableStructureDetector=Object.freeze({detect});
})(window);
