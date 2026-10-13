import { Writer } from "./pb.js";
import { decodeResponse } from "./send.js";

function responseFixture() {
  const conversation = new Writer();
  conversation.string(1, "0:1:100:200");
  conversation.int64(2, 998877n);
  conversation.int32(3, 1);
  conversation.string(4, "ticket-value");
  conversation.int32(9, 1);

  const create = new Writer();
  create.message(1, conversation);
  create.int64(2, 0n);
  create.string(3, "");
  create.string(4, "ok");
  create.int32(5, 0);

  const send = new Writer();
  send.int64(1, 555n);
  send.string(2, "");
  send.int32(3, 0);
  send.string(4, "client-id");
  send.int64(5, 0n);
  send.string(6, "");

  const body = new Writer();
  body.message(100, send);
  body.message(609, create);

  const response = new Writer();
  response.int32(1, 100);
  response.int64(2, 10002n);
  response.int32(3, 0);
  response.string(4, "");
  response.int32(5, 1);
  response.message(6, body);
  response.string(7, "log-id");
  return response.finish();
}

const decoded = decodeResponse(responseFixture());
if (decoded.sendBody.serverMessageId !== "555") {
  throw new Error(`server id ${decoded.sendBody.serverMessageId}`);
}
if (decoded.createBody.conversation.conversationId !== "0:1:100:200") {
  throw new Error(`conversation ${decoded.createBody.conversation.conversationId}`);
}
if (decoded.createBody.conversation.shortId !== "998877") {
  throw new Error(`short id ${decoded.createBody.conversation.shortId}`);
}
if (decoded.createBody.conversation.ticket !== "ticket-value") {
  throw new Error("ticket mismatch");
}
if (decoded.logId !== "log-id") {
  throw new Error("log id mismatch");
}
console.log("protobuf roundtrip ok");
