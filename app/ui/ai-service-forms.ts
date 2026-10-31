

import { useRef, useState } from "react";

import type { AiModelRecord, AiProviderRecord } from "@/db/ai-models";
import { type CatalogModel } from "@/lib/ai-model-capabilities";

import { type CivitaiAirBatch } from "@/lib/civitai-api";
import { DEFAULT_MAX_INPUT_CHARACTERS } from "@/lib/model-options";

import { type ImageParameterDraft } from "@/app/ui/image-model-parameters";

import type { ReasoningEffort } from "@/lib/reasoning-options";

export type Model = AiModelRecord;

export type CatalogSearch = { providerId: string; query: string; mode: "provider" | "full"; attempt: number };

export type CatalogScan = { catalog: Map<string, CatalogModel>; cursor: string | null; scanned: number; complete: boolean; seen: Set<string> };

export type CatalogScanSnapshot = { key: string; catalog: CatalogModel[]; scanned: number; complete: boolean; airBatch?: CivitaiAirBatch };

export const emptyConnection = { name: "", baseUrl: "https://api.openai.com/v1", secret: "", adapterKind: "openai-compatible", timeoutMinutes: 2 };

export function useConnectionForm() {
const [connectionsOpen, setConnectionsOpen] = useState(false);
const [connectionOpen, setConnectionOpen] = useState(false);
const [connectionId, setConnectionId] = useState<string | null>(null);
const [connection, setConnection] = useState(emptyConnection);
const [formError, setFormError] = useState("");
return { connectionsOpen, setConnectionsOpen, connectionOpen, setConnectionOpen, connectionId, setConnectionId, connection, setConnection, formError, setFormError };
}

export function useModelEditor() {
const [editing, setEditing] = useState<Model | null>(null);
const [imageDraft, setImageDraft] = useState<ImageParameterDraft>({ values: {}, extra: "", workflow: "" });
const [editForm, setEditForm] = useState({ providerId: "", name: "", modelId: "", kind: "text", systemPrompt: "", maxInput: DEFAULT_MAX_INPUT_CHARACTERS, reasoningEffort: null as ReasoningEffort | null });
const [preview, setPreview] = useState<string | null>(null);
return { editing, setEditing, imageDraft, setImageDraft, editForm, setEditForm, preview, setPreview };
}

export function useModelManagement() {
const [managing, setManaging] = useState<AiProviderRecord | null>(null);
const [manageQuery, setManageQuery] = useState("");
const [managedSelection, setManagedSelection] = useState<string[]>([]);
const [removal, setRemoval] = useState<{ models: Model[]; provider?: AiProviderRecord; clearAll?: boolean } | null>(null);
const [removalError, setRemovalError] = useState("");
return { managing, setManaging, manageQuery, setManageQuery, managedSelection, setManagedSelection, removal, setRemoval, removalError, setRemovalError };
}

export function useModelCatalog() {
const [adding, setAdding] = useState(false);
const [addProvider, setAddProvider] = useState("");
const [addMode, setAddMode] = useState("catalog");
const [catalogQuery, setCatalogQuery] = useState("");
const [catalogSearch, setCatalogSearch] = useState<CatalogSearch | null>(null);
const [catalogSearchMode, setCatalogSearchMode] = useState<"provider" | "full">("provider");
const [catalogFilter, setCatalogFilter] = useState("new");
const [selected, setSelected] = useState<string[]>([]);
const [manualIds, setManualIds] = useState("");
const [manualKind, setManualKind] = useState("text");
const [catalogBusy, setCatalogBusy] = useState(false);
const [catalogNotice, setCatalogNotice] = useState("");
const requestRef = useRef(0);
const scanCache = useRef(new Map<string, CatalogScan>());
const searchPageCache = useRef(new Map<string, CatalogScan>());
const scanController = useRef<AbortController | null>(null);
const [scanSnapshot, setScanSnapshot] = useState<CatalogScanSnapshot | null>(null);
const [scanBusy, setScanBusy] = useState(false);
const [scanError, setScanError] = useState("");
const [cachedCatalogs, setCachedCatalogs] = useState<Record<string, CatalogModel[]>>({});
return { adding, setAdding, addProvider, setAddProvider, addMode, setAddMode, catalogQuery, setCatalogQuery, catalogSearch, setCatalogSearch, catalogSearchMode, setCatalogSearchMode, catalogFilter, setCatalogFilter, selected, setSelected, manualIds, setManualIds, manualKind, setManualKind, catalogBusy, setCatalogBusy, catalogNotice, setCatalogNotice, requestRef, scanCache, searchPageCache, scanController, scanSnapshot, setScanSnapshot, scanBusy, setScanBusy, scanError, setScanError, cachedCatalogs, setCachedCatalogs };
}
