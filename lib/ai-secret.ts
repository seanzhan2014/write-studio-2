const ENCRYPT_PREFIX = "enc:v1:";

async function secretKey() {
  const material = `${process.env.AI_SECRET_KEY ?? ""}|writer-studio-local-ai-secret`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function toBase64(bytes: ArrayBuffer | Uint8Array) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  view.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function fromBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export async function encryptAiSecret(plain: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await secretKey(), new TextEncoder().encode(plain));
  return `${ENCRYPT_PREFIX}${toBase64(iv)}.${toBase64(cipher)}`;
}

export async function decryptAiSecret(stored: string) {
  if (!stored.startsWith(ENCRYPT_PREFIX)) return stored;
  const [ivPart, cipherPart] = stored.slice(ENCRYPT_PREFIX.length).split(".");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(ivPart) }, await secretKey(), fromBase64(cipherPart));
  return new TextDecoder().decode(plain);
}
