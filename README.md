# DouYin-anto-fire

用抖音网页版正在使用的私信协议，给一个好友发一条文本消息。脚本是 Node.js 命令行，不启动浏览器。

协议来自电脑网页私信模块 `@pc-im/im` `1.0.0.946`。请求发往 `https://imapi.douyin.com`，正文是 protobuf。登录态使用你自己导出的 Cookie。

这个项目不是抖音官方接口。网页更新后，请求字段可能失效。只应使用你自己的账号，向你指定的一个好友发送你写好的内容。

## 环境

- Node.js 18 或更高版本（使用内置 `fetch`）
- 能访问 `https://www.douyin.com` 和 `https://imapi.douyin.com`
- 不需要 `npm install`

境外机房访问这两个域名时，经常超时或被风控拦截。

## 准备 Cookie

1. 在浏览器中登录 [douyin.com](https://www.douyin.com/)。
2. 用 Cookie 导出扩展，导出当前站点的 Cookie，保存为 JSON 数组。每一项需要包含 `name` 和 `value`。
3. 把文件放在仓库外面。不要提交，不要发给别人。该文件里的 `sessionid` 就是登录态。

`.gitignore` 已忽略 `www.douyin.com_json_*.json` 和文件名中带 `cookie` 的 JSON。

## 查找好友

```bash
node src/who.js --cookie-file "你的cookie.json" --name 好友昵称
```

不带 `--name` 时打印关系列表。`--json` 只输出 JSON。`--max-pages` 限制翻页，默认 10 页，每页 50 人。

输出里的 `uid` 用于发消息。`follow_status=2` 表示互相关注。

## 发送一条文本

```bash
node src/send.js --cookie-file "你的cookie.json" --peer 好友uid或昵称 --text "你好"
```

`--peer` 可以是 uid、昵称或抖音号。昵称和抖音号必须与关系列表完全一致。重名时脚本会列出对应 uid，改用 uid 再发。

自己的 uid 从 `GET /aweme/v1/web/user/profile/self/` 读取。已经有会话时可以跳过创建：

```bash
node src/send.js --cookie-file "你的cookie.json" --peer 好友uid --text "你好" --conversation-id 会话id --short-id 短id --ticket 票据
```

`--dry-run` 只打印请求地址和包长，不发送。

Cookie 也可以放在环境变量 `DOUYIN_COOKIE`，或用 `--cookie` 传入 `name=value; name=value` 字符串。

## 脚本在做什么

1. 用 Cookie 调用个人资料接口，得到自己的 uid。
2. 昵称不是纯数字时，调用 `GET /aweme/v1/web/im/spotlight/relation/` 匹配好友。
3. `POST /v2/conversation/create`，命令号 `609`，创建单聊。参与者是自己和对方两个 uid，`inbox_type` 为 `0`。
4. `POST /v1/message/send`，命令号 `100`。文本消息类型为 `7`，正文 JSON 的 `aweType` 为 `700`。

请求体里的固定字段与当前网页一致：`biz` 为 `douyin_web`，`access` 为 `web_sdk`，`device_id` 为 `0`，`device_platform` 为 `douyin_pc`，并带上一组浏览器环境头。鉴权类型是会话 Cookie（`SESSION_AUTH`）。

成功时终端打印 `serverMessageId`。`statusCode` 不是 `0` 时，脚本以非零状态退出，并打印 `errorDesc`。

## 会失效的情况

- Cookie 过期、退出登录，或抖音把这次登录判为异常。重新导出 Cookie。
- 网页私信升级。`sdk_version`、构建号 `0d50935:feat/pc-im-group`、protobuf 字段号或必填头发生变化后，服务端会返回 `invalid access param` 或 `INVALID_REQUEST`。
- 发消息开始强制校验 `identity_security_token` 或 `bd-ticket-guard`。当前这条链路没有附带这两项。

## 安全

Cookie 文件等同于账号密码。仓库、压缩包和聊天记录里都不要放它。服务器上运行时，把文件权限限制给运行脚本的用户。

脚本一次只向一个好友发送一条文本，没有群发循环。

## 许可

未指定开源许可证。未经作者同意，不要把这份代码当成可随意再分发的开源项目使用。
