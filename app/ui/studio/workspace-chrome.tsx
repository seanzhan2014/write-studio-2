"use client";

import { useId, useState } from "react";
import { Popover } from "@mantine/core";

export type WorkspaceMode = "write" | "chat" | "generate" | "illustrations";
export type WorkspaceLayout = "single" | "columns" | "rows" | "grid";
export const workspaceModes: { value: WorkspaceMode; label: string }[] = [{value:"write",label:"写作"},{value:"chat",label:"聊天"},{value:"generate",label:"生成"},{value:"illustrations",label:"插图"}];
export const workspaceLayouts: { value: WorkspaceLayout; label: string }[] = [{value:"single",label:"单窗"},{value:"columns",label:"左右"},{value:"rows",label:"上下"},{value:"grid",label:"四宫格"}];

export function WorkspaceModeTabs({ value, onChange, unread = false }: { value: WorkspaceMode; onChange: (value: WorkspaceMode) => void; unread?: boolean }) {
  const id=useId();
  return <div className="workspace-mode-tabs" role="tablist" aria-label="工作模式" onKeyDown={event=>{
    const index=workspaceModes.findIndex(item=>item.value===value);
    const next=event.key==="ArrowRight"?(index+1)%4:event.key==="ArrowLeft"?(index+3)%4:event.key==="Home"?0:event.key==="End"?3:-1;
    if(next<0)return;event.preventDefault();onChange(workspaceModes[next].value);event.currentTarget.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
  }}>{workspaceModes.map(item=><button key={item.value} id={id+item.value} type="button" role="tab" aria-selected={value===item.value} tabIndex={value===item.value?0:-1} onClick={()=>onChange(item.value)}>{item.label}{unread&&item.value==="chat"&&<i className="chat-result-ready" aria-label="有新生成的聊天回复" />}</button>)}</div>;
}

export function WorkspaceModeSelect({ value, onChange }: { value: WorkspaceMode; onChange: (value: WorkspaceMode) => void }) {
  return <select className="workspace-mode-select" aria-label="工作模式" value={value} onChange={event=>onChange(event.target.value as WorkspaceMode)}>{workspaceModes.map(item=><option value={item.value} key={item.value}>{item.label}</option>)}</select>;
}

function LayoutGlyph({ value }: { value: WorkspaceLayout }) {
  return <span className={"workspace-layout-glyph layout-"+value} aria-hidden="true">{Array.from({length:value==="grid"?4:value==="single"?1:2},(_,i)=><span key={i} />)}</span>;
}

export function WorkspaceLayoutPicker({ value, onChange, disabled }: { value: WorkspaceLayout; onChange: (value: WorkspaceLayout) => void; disabled?: boolean }) {
  const [opened,setOpened]=useState(false);
  const current=workspaceLayouts.find(item=>item.value===value)!;
  return <Popover opened={opened} onChange={setOpened} position="bottom-end" offset={8} withinPortal trapFocus returnFocus closeOnEscape>
    <Popover.Target><button className="workspace-layout-trigger icon-button" type="button" aria-label="窗口布局" title={"窗口布局 · "+current.label} aria-haspopup="dialog" aria-expanded={opened} data-layout={value} disabled={disabled} onClick={()=>setOpened(!opened)}><LayoutGlyph value={value} /></button></Popover.Target>
    <Popover.Dropdown className="workspace-layout-popover"><div className="workspace-layout-options" role="toolbar" aria-label="窗口布局" onKeyDown={event=>{
      const buttons=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));const index=buttons.indexOf(document.activeElement as HTMLButtonElement);
      const delta=event.key==="ArrowRight"?1:event.key==="ArrowLeft"?-1:event.key==="ArrowDown"?2:event.key==="ArrowUp"?-2:0;
      if(delta){event.preventDefault();buttons[(index+delta+4)%4]?.focus();}
    }}>{workspaceLayouts.map(item=><button type="button" key={item.value} aria-pressed={value===item.value} data-autofocus={value===item.value||undefined} onClick={()=>{onChange(item.value);setOpened(false);}}><LayoutGlyph value={item.value} /><span>{item.label}</span></button>)}</div></Popover.Dropdown>
  </Popover>;
}
