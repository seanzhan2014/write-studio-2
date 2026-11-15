export type TextDiffPart={kind:"equal"|"removed"|"added";text:string};
export function textDiff(before:string,after:string):TextDiffPart[]{
 const result:TextDiffPart[]=[];
 const emit=(kind:TextDiffPart["kind"],text:string)=>{if(!text)return;const last=result[result.length-1];if(last?.kind===kind)last.text+=text;else result.push({kind,text});};
 function compare(a:string,b:string,depth=0){
  if(a===b){emit("equal",a);return;}
  let prefix=0;while(prefix<Math.min(a.length,b.length)&&a[prefix]===b[prefix])prefix++;
  if(prefix && /[\uD800-\uDBFF]/.test(a[prefix-1]) && /[\uDC00-\uDFFF]/.test(a[prefix]??""))prefix--;
  if(prefix){emit("equal",a.slice(0,prefix));a=a.slice(prefix);b=b.slice(prefix);}
  let suffix=0;while(suffix<Math.min(a.length,b.length)&&a[a.length-1-suffix]===b[b.length-1-suffix])suffix++;
  if(suffix && /[\uDC00-\uDFFF]/.test(a[a.length-suffix]??""))suffix--;
  const tail=suffix?a.slice(a.length-suffix):"";if(suffix){a=a.slice(0,-suffix);b=b.slice(0,-suffix);}
  if(!a)emit("added",b);else if(!b)emit("removed",a);
  else if(a.length*b.length<=500000){
   const left=Array.from(a),right=Array.from(b);const width=right.length+1;const rows=new Uint32Array((left.length+1)*width);
   for(let i=left.length-1;i>=0;i--)for(let j=right.length-1;j>=0;j--)rows[i*width+j]=left[i]===right[j]?1+rows[(i+1)*width+j+1]:Math.max(rows[(i+1)*width+j],rows[i*width+j+1]);
   let i=0,j=0;while(i<left.length&&j<right.length){if(left[i]===right[j]){emit("equal",left[i++]);j++;}else if(rows[(i+1)*width+j]>=rows[i*width+j+1])emit("removed",left[i++]);else emit("added",right[j++]);}emit("removed",left.slice(i).join(""));emit("added",right.slice(j).join(""));
  }else{
   // Find stable paragraph anchors for large documents without quadratic memory.
   const aLines=a.match(/[^\n]*\n|[^\n]+$/g)??[];const bLines=b.match(/[^\n]*\n|[^\n]+$/g)??[];
   const locations=new Map<string,number>();let offset=0;for(const line of bLines){locations.set(line,locations.has(line)?-1:offset);offset+=line.length;}
   let aOffset=0;let anchor:{a:number;b:number;text:string}|undefined;
   if(depth<24)for(const line of aLines){const position=locations.get(line);if(line.trim().length>8&&position!==undefined&&position>=0){anchor={a:aOffset,b:position,text:line};break;}aOffset+=line.length;}
   if(anchor){compare(a.slice(0,anchor.a),b.slice(0,anchor.b),depth+1);emit("equal",anchor.text);compare(a.slice(anchor.a+anchor.text.length),b.slice(anchor.b+anchor.text.length),depth+1);}else{emit("removed",a);emit("added",b);}
  }
  emit("equal",tail);
 }
 compare(before,after);return result;
}
