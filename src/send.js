import { randomUUID } from "node:crypto";
import { resolveCookieHeader } from "./cookies.js";
import { Reader, Writer } from "./pb.js";
import { loadSelfAndRelations, matchPeople } from "./who.js";

// Observed in @pc-im/im 1.0.0.946 (static/js/async/4187 and the vmok expose).
const API_URL = "https://imapi.douyin.com/";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const SDK_VERSION = "0.1.8";
const BUILD_NUMBER = "0d50935:feat/pc-im-group";
const REFER_PC = 3;
const AUTH_SESSION = 1;
const INBOX_TYPE = 1;
const DEVICE_PLATFORM = "douyin_pc";
const ACCESS = "web_sdk";
const CMD_SEND_MESSAGE = 100;
const CMD_CREATE_CONVERSATION_V2 = 609;
const CONVERSATION_ONE_TO_ONE = 1;
const MESSAGE_TYPE_TEXT = 7;
const AWE_TYPE_TEXT = 700;
const VERSION_CODE = "360000";

function arg(name, fallback = undefined) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} needs a value`);
  }
  return value;
}

function flag(name) {
  return process.argv.includes(name);
}

function usage() {
  console.log(`给一个好友发一条文本私信。

用法:
  node src/send.js --cookie-file <浏览器导出的json> --peer <好友uid或昵称> --text <内容>

--peer 可以是好友 uid、昵称或抖音号。昵称必须和关系列表里完全一致。
自己的 uid 会从个人资料接口读取。已有会话时可以加:
  --conversation-id <id> --short-id <shortId> --ticket <ticket>

--dry-run 只打印请求，不发送。`);
}

export function encodeRequest({ cmd, sequenceId, body, deviceId, inboxType = 0 }) {
  const request = new Writer();
  request.int32(1, cmd);
  request.int64(2, sequenceId);
  request.string(3, SDK_VERSION);
  request.int32(5, REFER_PC);
  request.int32(6, inboxType);
  request.string(7, BUILD_NUMBER);
  request.message(8, body);
  request.string(9, deviceId || "0");
  request.string(11, DEVICE_PLATFORM);
  request.string(14, VERSION_CODE);
  request.map(15, {
    session_aid: "6383",
    session_did: "0",
    app_name: "douyin_pc",
    priority_region: "cn",
    user_agent: USER_AGENT,
    cookie_enabled: "true",
    browser_language: "zh-CN",
    browser_platform: "Win32",
    browser_name: "Mozilla",
    browser_version: USER_AGENT,
    browser_online: "true",
    screen_width: "1707",
    screen_height: "960",
    referer: "https://www.douyin.com/jingxuan",
    timezone_name: "Asia/Shanghai",
    deviceId: "0",
    "is-retry": "0",
  });
  request.int32(18, AUTH_SESSION);
  request.string(21, "douyin_web");
  request.string(22, ACCESS);
  return request.finish();
}

function encodeCreateConversation(selfUid, peerUid) {
  const participants = [BigInt(selfUid), BigInt(peerUid)];
  const body = new Writer();
  const create = new Writer();
  create.int32(1, CONVERSATION_ONE_TO_ONE);
  for (const uid of participants) create.int64(2, uid);
  body.message(609, create);
  return body;
}

function encodeSendMessage({ conversationId, shortId, ticket, text, clientId }) {
  const content = JSON.stringify({
    mention_users: [],
    aweType: AWE_TYPE_TEXT,
    richTextInfos: [],
    text,
  });
  const body = new Writer();
  const message = new Writer();
  message.string(1, conversationId);
  message.int32(2, CONVERSATION_ONE_TO_ONE);
  message.int64(3, BigInt(shortId));
  message.string(4, content);
  message.int32(6, MESSAGE_TYPE_TEXT);
  message.string(7, ticket);
  message.string(8, clientId);
  body.message(100, message);
  return body;
}

function readMessage(reader, readFields) {
  const value = {};
  while (!reader.done) {
    const { field, wire } = reader.key();
    if (readFields[field]) {
      value[field] = readFields[field](reader, wire);
    } else {
      reader.skip(wire);
    }
  }
  return value;
}

function asString(reader) {
  return reader.string();
}

function asInt(reader) {
  return reader.varint();
}

function asMessage(reader) {
  return reader.message();
}

function decodeConversation(reader) {
  const fields = readMessage(reader, {
    1: asString,
    2: asInt,
    3: asInt,
    4: asString,
    9: asInt,
  });
  return {
    conversationId: fields[1] || "",
    shortId: fields[2] ? fields[2].toString() : "",
    conversationType: fields[3] ? Number(fields[3]) : 0,
    ticket: fields[4] || "",
    inboxType: fields[9] ? Number(fields[9]) : 0,
  };
}

function decodeCreateBody(reader) {
  const fields = readMessage(reader, {
    1: asMessage,
    2: asInt,
    3: asString,
    4: asString,
    5: asInt,
  });
  return {
    conversation: fields[1] ? decodeConversation(fields[1]) : null,
    checkCode: fields[2] ? fields[2].toString() : "0",
    checkMessage: fields[3] || "",
    extraInfo: fields[4] || "",
    status: fields[5] ? Number(fields[5]) : 0,
  };
}

function decodeSendBody(reader) {
  const fields = readMessage(reader, {
    1: asInt,
    2: asString,
    3: asInt,
    4: asString,
    5: asInt,
    6: asString,
  });
  return {
    serverMessageId: fields[1] ? fields[1].toString() : "",
    extraInfo: fields[2] || "",
    status: fields[3] ? Number(fields[3]) : 0,
    clientMessageId: fields[4] || "",
    checkCode: fields[5] ? fields[5].toString() : "0",
    checkMessage: fields[6] || "",
  };
}

export function decodeResponse(buffer) {
  const reader = new Reader(buffer);
  const fields = readMessage(reader, {
    1: asInt,
    2: asInt,
    3: asInt,
    4: asString,
    5: asInt,
    6: asMessage,
    7: asString,
  });
  let createBody = null;
  let sendBody = null;
  const body = fields[6];
  if (body) {
    while (!body.done) {
      const { field, wire } = body.key();
      if (field === 100 && wire === 2) sendBody = decodeSendBody(body.message());
      else if (field === 609 && wire === 2) createBody = decodeCreateBody(body.message());
      else body.skip(wire);
    }
  }
  return {
    cmd: fields[1] ? Number(fields[1]) : 0,
    sequenceId: fields[2] ? fields[2].toString() : "",
    statusCode: fields[3] ? Number(fields[3]) : 0,
    errorDesc: fields[4] || "",
    inboxType: fields[5] ? Number(fields[5]) : 0,
    logId: fields[7] || "",
    createBody,
    sendBody,
  };
}

async function postProtobuf(url, cookie, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/x-protobuf",
      "Content-Type": "application/x-protobuf",
      Cookie: cookie,
      Origin: "https://www.douyin.com",
      Referer: "https://www.douyin.com/",
      "User-Agent": USER_AGENT,
    },
    body: payload,
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  return { httpStatus: response.status, bytes };
}

function printResponse(label, httpStatus, decoded) {
  const create = decoded.createBody && {
    ...decoded.createBody,
    conversation: decoded.createBody.conversation && {
      ...decoded.createBody.conversation,
      ticket: decoded.createBody.conversation.ticket ? "已返回" : "",
    },
  };
  console.log(`${label}: HTTP ${httpStatus}`);
  console.log(
    JSON.stringify(
      {
        cmd: decoded.cmd,
        statusCode: decoded.statusCode,
        errorDesc: decoded.errorDesc,
        logId: decoded.logId,
        create,
        send: decoded.sendBody,
      },
      null,
      2,
    ),
  );
}

async function main() {
  if (flag("--help") || flag("-h")) {
    usage();
    return;
  }

  const cookie = resolveCookieHeader(arg("--cookie", process.env.DOUYIN_COOKIE || ""), arg("--cookie-file", ""));
  let selfUid = arg("--self", process.env.DOUYIN_SELF_UID || "");
  let peerUid = arg("--peer", "");
  const text = arg("--text", "");
  let deviceId = arg("--device-id", process.env.DOUYIN_DEVICE_ID || "");
  const apiUrl = arg("--api", API_URL);
  const dryRun = flag("--dry-run");
  let conversationId = arg("--conversation-id", "");
  let shortId = arg("--short-id", "");
  let ticket = arg("--ticket", "");

  if (!peerUid || !text || (!dryRun && !cookie)) {
    usage();
    throw new Error("缺少 --peer、--text，或未提供 --cookie-file");
  }
  if (text.length > 2000) {
    throw new Error("文本超过 2000 字");
  }

  const peerIsUid = /^[0-9]+$/.test(peerUid);
  if (!dryRun && (!selfUid || !peerIsUid)) {
    const loaded = await loadSelfAndRelations(cookie, "https://www.douyin.com", 10);
    if (!selfUid) {
      if (!loaded.self) {
        throw new Error(`没有读到自己的 uid，HTTP ${loaded.httpStatus} status_code=${loaded.profileStatus} ${loaded.profileMessage}`);
      }
      selfUid = loaded.self.uid;
      console.log(`自己 uid=${selfUid} 昵称=${loaded.self.nickname}`);
    }
    if (!peerIsUid) {
      const matches = matchPeople(loaded.people, peerUid);
      if (matches.length !== 1) {
        const hint = matches.map((person) => `${person.nickname} uid=${person.uid}`).join("；");
        throw new Error(matches.length === 0 ? `关系列表里没有「${peerUid}」` : `「${peerUid}」匹配到多人：${hint}`);
      }
      peerUid = matches[0].uid;
      console.log(`好友 uid=${peerUid} 昵称=${matches[0].nickname}`);
    }
  }
  if (!deviceId) deviceId = "0";
  if (!selfUid) throw new Error("还缺自己的 uid");

  let sequenceId = 10001;
  const root = apiUrl.endsWith("/") ? apiUrl : `${apiUrl}/`;

  if (!conversationId || !shortId || !ticket) {
    const createPayload = encodeRequest({
      cmd: CMD_CREATE_CONVERSATION_V2,
      sequenceId: sequenceId++,
      body: encodeCreateConversation(selfUid, peerUid),
      deviceId,
      inboxType: 0,
    });
    const createUrl = `${root}v2/conversation/create`;
    if (dryRun) {
      console.log(`dry-run create ${createUrl} bytes=${createPayload.length}`);
    } else {
      const created = await postProtobuf(createUrl, cookie, createPayload);
      const decoded = decodeResponse(created.bytes);
      printResponse("创建会话", created.httpStatus, decoded);
      const conversation = decoded.createBody && decoded.createBody.conversation;
      if (!conversation || !conversation.conversationId || !conversation.ticket) {
        throw new Error("创建会话没有返回 conversation_id 和 ticket");
      }
      if (decoded.createBody.status !== 0 || decoded.statusCode !== 0) {
        throw new Error(
          `创建会话被拒绝 status=${decoded.createBody.status} ${decoded.createBody.checkMessage || decoded.errorDesc}`,
        );
      }
      conversationId = conversation.conversationId;
      shortId = conversation.shortId;
      ticket = conversation.ticket;
    }
  }
  const inboxType = 0;

  const clientId = randomUUID();
  const sendPayload = encodeRequest({
    cmd: CMD_SEND_MESSAGE,
    sequenceId,
    body: encodeSendMessage({
      conversationId: conversationId || "dry-run",
      shortId: shortId || "0",
      ticket: ticket || "dry-run",
      text,
      clientId,
    }),
    deviceId,
    inboxType,
  });
  const sendUrl = `${root}v1/message/send`;
  if (dryRun) {
    console.log(`dry-run send ${sendUrl} bytes=${sendPayload.length} clientId=${clientId}`);
    return;
  }

  const sent = await postProtobuf(sendUrl, cookie, sendPayload);
  const decoded = decodeResponse(sent.bytes);
  printResponse("发送消息", sent.httpStatus, decoded);
  if (!decoded.sendBody) {
    throw new Error("响应里没有 send_message_body");
  }
  if (decoded.statusCode !== 0 || decoded.sendBody.status !== 0) {
    throw new Error(
      `发送未成功 status=${decoded.sendBody.status} ${decoded.sendBody.checkMessage || decoded.errorDesc}`,
    );
  }
  console.log(`已发送 serverMessageId=${decoded.sendBody.serverMessageId}`);
}

const isDirectRun = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (isDirectRun) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
