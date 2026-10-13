import { cookieHeaderFromItems, resolveCookieHeader } from "./cookies.js";

// 用已登录 Cookie 读取自己的 uid、网页 device id 线索，以及私信关系列表里的好友 uid。
// 接口形状来自网页包：
// GET /aweme/v1/web/user/profile/self/
// GET /aweme/v1/web/im/spotlight/relation/

const PROFILE_PATH = "/aweme/v1/web/user/profile/self/";
const RELATION_PATH = "/aweme/v1/web/im/spotlight/relation/";
const PAGE_SIZE = 50;
const MAX_PAGES = 10;

function arg(name, fallback = undefined) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} 需要一个值`);
  return value;
}

function flag(name) {
  return process.argv.includes(name);
}

function usage() {
  console.log(`读取自己的 uid 和好友 uid。

用法:
  node src/who.js

Cookie 用 --cookie-file 浏览器导出的 JSON，或环境变量 DOUYIN_COOKIE，或 --cookie。
--name <昵称或抖音号> 只显示匹配的好友。
--json 只打印 JSON。
--max-pages <n> 限制关系列表页数，默认 ${MAX_PAGES}。`);
}

export function parseCookie(cookie) {
  const pairs = {};
  for (const part of String(cookie || "").split(";")) {
    const item = part.trim();
    if (!item) continue;
    const eq = item.indexOf("=");
    if (eq <= 0) continue;
    pairs[item.slice(0, eq).trim()] = item.slice(eq + 1).trim();
  }
  return pairs;
}

const WEB_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export async function fetchWebDeviceId(cookie) {
  const response = await fetch("https://mcs.zijieapi.com/webid", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      Origin: "https://www.douyin.com",
      Referer: "https://www.douyin.com/",
      "User-Agent": WEB_USER_AGENT,
    },
    body: JSON.stringify({
      app_id: 6383,
      url: "https://www.douyin.com/",
      user_agent: WEB_USER_AGENT,
      referer: "https://www.douyin.com/",
      user_unique_id: "",
    }),
  });
  const data = await response.json();
  if (!data || !data.web_id) {
    throw new Error(`没有拿到 device_id，webid HTTP ${response.status}`);
  }
  return String(data.web_id);
}

export function deviceIdFromCookie(cookie) {
  const pairs = parseCookie(cookie);
  for (const key of ["device_id", "user_unique_id", "webid"]) {
    if (pairs[key]) return { id: pairs[key], source: `cookie ${key}` };
  }
  return null;
}

function commonQuery() {
  return {
    device_platform: "webapp",
    aid: "6383",
    channel: "channel_pc_web",
    publish_video_strategy_type: "2",
  };
}

async function getJson(origin, path, query, cookie) {
  const url = new URL(path, origin);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, String(value));
  }
  const headers = {
    Accept: "application/json",
    Cookie: cookie,
    Referer: "https://www.douyin.com/",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  };
  const uifid = parseCookie(cookie).uifid;
  if (uifid) headers.uifid = uifid;
  const response = await fetch(url, { headers });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { httpStatus: response.status, body, text };
}

export function readSelf(body) {
  const user = body && body.user ? body.user : null;
  if (!user) return null;
  const uid = user.uid || user.user_id || "";
  if (!uid) return null;
  return {
    uid: String(uid),
    nickname: user.nickname || "",
    uniqueId: user.unique_id || user.short_id || "",
    secUid: user.sec_uid || "",
  };
}

function personFrom(item) {
  if (!item || typeof item !== "object") return null;
  const uid = item.uid || item.user_id || "";
  if (!uid) return null;
  return {
    uid: String(uid),
    nickname: item.nickname || "",
    uniqueId: item.unique_id || item.short_id || "",
    secUid: item.sec_uid || "",
    followStatus: item.follow_status === undefined ? null : item.follow_status,
  };
}

export function readRelations(body) {
  const lists = [];
  const buckets = ["followings", "friends", "recent_share_users", "share_users", "users"];
  for (const key of buckets) {
    if (Array.isArray(body && body[key])) lists.push(...body[key]);
    if (Array.isArray(body && body.data && body.data[key])) lists.push(...body.data[key]);
  }
  const people = [];
  const seen = new Set();
  for (const item of lists) {
    const person = personFrom(item);
    if (!person || seen.has(person.uid)) continue;
    seen.add(person.uid);
    people.push(person);
  }
  return people;
}

function relationCursor(body) {
  if (!body || typeof body !== "object") return null;
  const value = body.min_time !== undefined ? body.min_time : body.data && body.data.min_time;
  if (value === undefined || value === null || value === "") return null;
  return String(value);
}

function hasMore(body) {
  const value = body && (body.has_more !== undefined ? body.has_more : body.data && body.data.has_more);
  return value === 1 || value === true;
}

async function loadRelations(origin, cookie, maxPages) {
  const people = [];
  const seen = new Set();
  let minTime = "0";
  let pages = 0;
  let lastStatus = null;
  while (pages < maxPages) {
    const query = {
      ...commonQuery(),
      count: String(PAGE_SIZE),
      source: "coldup",
      max_time: String(Date.now()),
      min_time: minTime,
      need_remove_share_panel: "true",
      need_sorted_info: "true",
      with_fstatus: "1",
    };
    const result = await getJson(origin, RELATION_PATH, query, cookie);
    lastStatus = result;
    if (!result.body) break;
    if (result.body.status_code && result.body.status_code !== 0) break;
    for (const person of readRelations(result.body)) {
      if (seen.has(person.uid)) continue;
      seen.add(person.uid);
      people.push(person);
    }
    pages += 1;
    const next = relationCursor(result.body);
    if (!hasMore(result.body) || !next || next === minTime || next === "0") break;
    minTime = next;
  }
  return { people, pages, lastStatus };
}

export function matchPeople(people, query) {
  return people.filter((person) => person.uid === query || person.nickname === query || person.uniqueId === query);
}

export async function loadSelfAndRelations(cookie, origin, maxPages) {
  const profile = await getJson(
    origin,
    PROFILE_PATH,
    { ...commonQuery(), source: "channel_pc_web", personal_center_strategy: "1" },
    cookie,
  );
  const relations = await loadRelations(origin, cookie, maxPages);
  return {
    self: readSelf(profile.body),
    people: relations.people,
    pages: relations.pages,
    profileStatus: profile.body ? profile.body.status_code : null,
    profileMessage: profile.body ? profile.body.status_msg || "" : profile.text.slice(0, 180),
    httpStatus: profile.httpStatus,
  };
}

function printHuman(report) {
  const self = report.self;
  if (!self) {
    console.log("没有读到自己的 uid。");
    console.log(`资料接口 HTTP ${report.profile.httpStatus} status_code=${report.profileStatus}`);
    if (report.profileMessage) console.log(report.profileMessage);
    return;
  }
  console.log(`自己: uid=${self.uid} 昵称=${self.nickname} 抖音号=${self.uniqueId}`);
  if (report.device) {
    console.log(`device_id=${report.device.id}（来自 ${report.device.source}）`);
  } else {
    console.log("没有拿到 device_id。");
  }
  console.log(`关系列表 ${report.relations.length} 人，请求了 ${report.pages} 页。`);
  for (const person of report.relations) {
    const status = person.followStatus === null ? "" : ` follow_status=${person.followStatus}`;
    console.log(`  uid=${person.uid} 昵称=${person.nickname} 抖音号=${person.uniqueId}${status}`);
  }
  if (self && report.relations[0] && report.device) {
    console.log("");
    console.log("发消息示例:");
    console.log(
      `node src/send.js --cookie-file <cookie.json> --peer ${report.relations[0].nickname} --text "你好"`,
    );
  }
}

async function main() {
  if (flag("--help") || flag("-h")) {
    usage();
    return;
  }
  if (flag("--self-test")) {
    const sample = {
      status_code: 0,
      min_time: 10,
      has_more: 0,
      followings: [{ uid: "200", nickname: "好友", unique_id: "friend", follow_status: 2 }],
    };
    const people = readRelations(sample);
    if (people.length !== 1 || people[0].uid !== "200") throw new Error("关系列表解析失败");
    const self = readSelf({ user: { uid: "100", nickname: "我", unique_id: "me", sec_uid: "sec" } });
    if (!self || self.uid !== "100") throw new Error("自己的 uid 解析失败");
    const device = deviceIdFromCookie("sessionid=abc; device_id=999");
    if (!device || device.id !== "999") throw new Error("device id 解析失败");
    const header = cookieHeaderFromItems([{ name: "sessionid", value: "abc" }, { name: "", value: "skip" }]);
    if (header !== "sessionid=abc") throw new Error("cookie 文件解析失败");
    console.log("who self-test ok");
    return;
  }

  const cookie = resolveCookieHeader(arg("--cookie", process.env.DOUYIN_COOKIE || ""), arg("--cookie-file", ""));
  const origin = arg("--origin", "https://www.douyin.com");
  const nameFilter = arg("--name", "");
  const maxPages = Number(arg("--max-pages", String(MAX_PAGES)));
  if (!cookie) {
    usage();
    throw new Error("缺少 --cookie-file、DOUYIN_COOKIE 或 --cookie");
  }
  if (!Number.isInteger(maxPages) || maxPages < 1) throw new Error("--max-pages 需要正整数");

  const loaded = await loadSelfAndRelations(cookie, origin, maxPages);
  const report = {
    self: loaded.self,
    device: deviceIdFromCookie(cookie) || {
      id: await fetchWebDeviceId(cookie),
      source: "mcs webid",
    },
    relations: nameFilter ? matchPeople(loaded.people, nameFilter) : loaded.people,
    pages: loaded.pages,
    profileStatus: loaded.profileStatus,
    profileMessage: loaded.profileMessage,
    profile: { httpStatus: loaded.httpStatus },
    relationStatus: null,
  };

  if (flag("--json")) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  printHuman(report);
  if (!report.self) process.exitCode = 1;
}

const isDirectRun = process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll("\\", "/"));
if (isDirectRun) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
