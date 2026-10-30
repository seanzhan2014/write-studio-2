export function newestTaskFirst(a: { id: string; createdAt: string }, b: { id: string; createdAt: string }) {
  const timestamp = (value: string) => {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  };
  return timestamp(b.createdAt) - timestamp(a.createdAt) || b.id.localeCompare(a.id);
}
