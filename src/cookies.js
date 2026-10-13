import { readFileSync } from "node:fs";

export function cookieHeaderFromItems(items) {
  if (!Array.isArray(items)) throw new Error("cookie 文件内容不是数组");
  const parts = [];
  for (const item of items) {
    if (!item || typeof item.name !== "string" || !item.name.trim()) continue;
    if (item.value === undefined || item.value === null) continue;
    parts.push(`${item.name}=${item.value}`);
  }
  if (!parts.length) throw new Error("cookie 文件里没有可用的 name=value");
  return parts.join("; ");
}

export function cookieHeaderFromFile(path) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`无法读取 cookie 文件 ${path}: ${error.message}`);
  }
  return cookieHeaderFromItems(parsed);
}

export function resolveCookieHeader(cookie, cookieFile) {
  if (cookieFile) return cookieHeaderFromFile(cookieFile);
  return cookie || "";
}
