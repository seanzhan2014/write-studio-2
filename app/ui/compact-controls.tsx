"use client";
import { useState } from "react";
import { Menu, NumberInput, Slider } from "@mantine/core";

export function NumberPresetMenu({label, values, onChange}: {label:string;values:{value:number;label:string}[];onChange:(value:number)=>void}) {
  return <Menu position="bottom-end" withinPortal><Menu.Target><button type="button" className="number-preset-trigger" aria-label={label} title={label}>⌄</button></Menu.Target><Menu.Dropdown>{values.map(item=><Menu.Item key={item.value} onClick={()=>onChange(item.value)}>{item.label}</Menu.Item>)}</Menu.Dropdown></Menu>;
}

export function RangeNumberControl({label,value,min,max,step=1,unit="",onChange}: {label:string;value:number;min:number;max:number;step?:number;unit?:string;onChange:(value:number)=>void}) {
  const [input,setInput]=useState<{source:number;value:string|number}>({source:value,value});
  const draft=input.source===value?input.value:value;
  const number=Number(draft);
  const valid=draft!==""&&Number.isFinite(number)&&number>=min&&number<=max;
  const commit=()=>{if(valid&&number!==value)onChange(number);};
  return <div className="range-number-control"><span className="ui-label">{label}</span><div className="range-number-fields"><Slider thumbLabel={label} min={min} max={max} step={step} precision={step<1?1:0} value={valid?number:value} onChange={next=>setInput({source:value,value:next})} onChangeEnd={next=>onChange(next)} /><NumberInput clampBehavior="none" aria-label={label+"数值"} min={min} max={max} step={step} decimalScale={step<1?1:0} suffix={unit} value={draft} onChange={next=>setInput({source:value,value:next})} onBlur={commit} onKeyDown={event=>{if(event.key==="Enter"){commit();event.currentTarget.blur();}}} error={valid?undefined:min+"–"+max} /></div></div>;
}
