"use client";
import { useEffect, useRef, useState } from "react";
import { Button, Group, Stack, Text, TextInput } from "@mantine/core";
import { ResponsiveModal } from "./overlays";

type Operation = {kind:"text"|"confirm"; message:string; initial:string; resolve:(value:string|null)=>void};
const eventName="writer-studio:operation-dialog";
function request(kind:Operation["kind"],message:string,initial="") {
  return new Promise<string|null>(resolve=>window.dispatchEvent(new CustomEvent<Operation>(eventName,{detail:{kind,message,initial,resolve}})));
}
export const requestTextDialog=(message:string,initial="")=>request("text",message,initial);
export const requestConfirmDialog=async(message:string)=>(await request("confirm",message))==="confirmed";

export function OperationDialogs() {
  const [operation,setOperation]=useState<Operation|null>(null);
  const [value,setValue]=useState("");
  const queue=useRef<Operation[]>([]);
  const active=useRef<Operation|null>(null);
  const open=(next:Operation|null)=>{active.current=next;setOperation(next);setValue(next?.initial??"");};
  useEffect(()=>{
    const receive=(event:Event)=>{const next=(event as CustomEvent<Operation>).detail;if(active.current)queue.current.push(next);else open(next);};
    window.addEventListener(eventName,receive);
    return ()=>{window.removeEventListener(eventName,receive);active.current?.resolve(null);queue.current.splice(0).forEach(item=>item.resolve(null));};
  },[]);
  function finish(result:string|null){operation?.resolve(result);open(queue.current.shift()??null);}
  if(!operation)return null;
  const danger=/删除|清除|覆盖|清空/.test(operation.message);
  return <ResponsiveModal opened title={operation.kind==="text"?"输入确认":"确认操作"} onClose={()=>finish(null)} closeButtonProps={{"aria-label":"取消操作"}} mobileFullScreen={false} size="sm" zIndex={1000}>
    <form onSubmit={event=>{event.preventDefault();finish(operation.kind==="text"?value:"confirmed");}}><Stack gap="md"><Text size="sm" style={{whiteSpace:"pre-wrap"}}>{operation.message}</Text>{operation.kind==="text"&&<TextInput data-autofocus aria-label={operation.message} value={value} onChange={event=>setValue(event.currentTarget.value)} maxLength={2000} />}<Group justify="flex-end"><Button variant="default" onClick={()=>finish(null)}>取消</Button><Button type="submit" color={danger?"red":undefined}>确认</Button></Group></Stack></form>
  </ResponsiveModal>;
}
