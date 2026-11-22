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
    const xs=clusterRuns(vx,Math.max(2,Math.round(w/900)));
    const ys=clusterRuns(hy,Math.max(2,Math.round(h/1200)));
    if(xs.length<3 || ys.length<3) return null;
    return {xs,ys};
  }
  function detect(data, canvas) {
    const words=(Array.isArray(data&&data.words)?data.words:[])
      .filter(validWord).slice().sort((a,b)=>a.bbox.y0-b.bbox.y0||a.bbox.x0-b.bbox.x0);
    const grid=detectGrid(canvas);
    if(!grid) return {ok:false,reason:"이미지에서 표의 가로선과 세로선을 충분히 검출하지 못했습니다. 선이 선명한 원본 이미지를 사용해 주세요."};
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
