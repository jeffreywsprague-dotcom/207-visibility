// Thin wrapper over Netlify Blobs so tests can swap in an in-memory store.
import { getStore } from "@netlify/blobs";

let factory = null;
export function _useTestStore(fn) { factory = fn; }

export function store(name) {
  return factory ? factory(name) : getStore({ name, consistency: "strong" });
}
export async function getJSON(name, key) {
  return (await store(name).get(key, { type: "json" })) ?? null;
}
export async function setJSON(name, key, value) {
  await store(name).setJSON(key, value);
}
export async function listKeys(name, prefix) {
  const res = await store(name).list(prefix ? { prefix } : {});
  return (res.blobs || []).map((b) => b.key);
}
export async function del(name, key) {
  await store(name).delete(key);
}
