import type {ComboboxParsedItem,OptionsFilter} from "@mantine/core";
type SearchableModel={id:string;name:string;providerName?:string;modelId?:string};
export function configuredModelFilter(models:readonly SearchableModel[]):OptionsFilter {
 const catalog=new Map(models.map(model=>[model.id,[model.name,model.providerName,model.modelId].filter(Boolean).join(" ").toLocaleLowerCase()]));
 return ({options,search})=>{const query=search.trim().toLocaleLowerCase();const filter=(items:ComboboxParsedItem[]):ComboboxParsedItem[]=>items.flatMap<ComboboxParsedItem>(item=>{if("group" in item){const children=filter(item.items);return children.length?[{...item,items:children as typeof item.items}]:[];}return (item.label+" "+(catalog.get(String(item.value))??"")).toLocaleLowerCase().includes(query)?[item]:[];});return filter(options);};
}
