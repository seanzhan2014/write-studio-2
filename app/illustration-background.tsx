"use client";

import { useEffect } from "react";
import { fetchFromServer } from "@/lib/browser-network";
import type { IllustrationRecord } from "@/lib/illustration-history";

// Lives in the root layout, so modal dismissal and client-side navigation do
// not interrupt transport. SQLite also has an independent service dispatcher.
export default function IllustrationBackground() {
  useEffect(() => {
    const executing = new Set<string>();
    let stopped = false, polling = false;
    async function tick() {
      if (stopped || polling || !navigator.onLine) return;
      polling = true;
      try {
        const response = await fetchFromServer("/api/ai/illustrations", { cache: "no-store" });
        if (!response.ok || stopped) return;
        const { records } = await response.json() as { records: IllustrationRecord[] };
        let capacity = Math.max(0, 2 - records.filter(record => record.status === "running" || executing.has(record.id)).length);
        for (const record of records.slice().reverse()) {
          if (!capacity || record.status !== "queued" || executing.has(record.id)) continue;
          capacity--; executing.add(record.id);
          void fetchFromServer(`/api/ai/illustrations/${record.id}/execute`, { method: "POST" }).then(response => response.text()).catch(() => {}).finally(() => {
            executing.delete(record.id);
            window.dispatchEvent(new Event("illustrations-updated"));
          });
        }
      } catch { /* Resume after connectivity returns. */ }
      finally { polling = false; }
    }
    const wake = () => { void tick(); };
    const timer = setInterval(wake, 4000);
    window.addEventListener("illustrations-submitted", wake);
    window.addEventListener("online", wake);
    wake();
    return () => { stopped = true; clearInterval(timer); window.removeEventListener("illustrations-submitted", wake); window.removeEventListener("online", wake); };
  }, []);
  return null;
}
