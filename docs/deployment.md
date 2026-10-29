# 本机、局域网运行与Cloudflare接入

## 当前本机运行（2026-10-29）

按用户要求，当前采用本机localhost环境。前后端完整网站为http://localhost:3000，前端开发页为http://localhost:5173，题库入口为http://localhost:3000/library。当前.env关键设置如下；真实环境文件继续忽略，不上传GitHub。

```dotenv
HOST=127.0.0.1
PUBLIC_BASE_URL=http://localhost:3000
APP_ORIGIN=http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000
COOKIE_SECURE=false
```

新分享链接和二维码使用localhost。历史局域网地址及配置仅作为下文的运行记录，不是当前入口。MongoDB仍使用原有127.0.0.1:27018副本集；账号、密钥和正常业务数据保留。运行方式见README：开发使用npm run dev，构建运行使用npm run build后npm start。

## 第二阶段升级方式

v2无新增外部服务，使用原MongoDB副本集与同一环境文件。先`npm run db:backup`，再`npm run db:init`增量增加题库、系列、版本集合及索引；原五集合旧记录不回填。之后`npm run build`、`npm start`，Express在3000端口同时提供前端静态页及后端API，题库入口/library。当前使用上方localhost配置。

原HMAC密钥、账号、问卷与答卷继续保留，备份在忽略的.local/backups；迁移校验只公开计数与是否变化，不公开内容。切换main并不能还原MongoDB，若要同时演示一期，应从一期备份恢复到隔离库并使用对应配置。恢复演练尚未执行。

验收使用http://localhost:3000/library。浏览器普通HTTP验证不等同实体微信验收；MongoDB仅本机监听。后文保留一期局域网配置过程及未执行的Cloudflare方案。

## 历史局域网配置（2026-10-21，当前未启用）

2026-10-21已启用无线局域网访问。网站品牌为“问笺”，当前电脑的WLAN IPv4为172.25.23.29。访问入口：

```text
http://172.25.23.29:3000
```

手机和其他电脑接入同一可互访的局域网后，打开该地址登录。进入问卷分享页，链接及二维码会使用局域网入口。已有下载的localhost二维码不会自动更新，需要重新下载。原有账号和问卷数据仍在同一开发库。

本机.env已调整为：

```dotenv
HOST=0.0.0.0
PUBLIC_BASE_URL=http://172.25.23.29:3000
APP_ORIGIN=http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000,http://172.25.23.29:3000
COOKIE_SECURE=false
```

数据库连接和HMAC密钥保留；MongoDB只监听127.0.0.1:27018，不提供给其他设备直接连接。启动仍使用npm run db:start、npm run build、npm start。后台日志中的0.0.0.0表示监听接口，访问时使用实际IPv4或本机localhost。

Windows当前WLAN属于Public网络，已有允许D:\nodejs\node.exe入站的TCP规则，本次没有修改这些既有规则。尝试新增限定规则时因缺少管理员权限未创建；现有允许规则已满足当前配置，未触发额外管理员确认。后续换电脑应检查TCP 3000入站，按实际网络限定来源，不能通过关闭整个防火墙解决。

实际检查：局域网地址的页面及健康接口200，登录接口预检204且准确返回允许的Origin和凭据标记；Chrome通过该地址显示“问笺”，旧品牌及旧提示已移除；localhost入口继续正常。两条独立测试库浏览器流程通过，覆盖二维码解码、发布、填写、修改与统计。尚未从第二台实体设备完成验收，校园/访客网的设备隔离不能由本机测试排除。

局域网部署不需要公网域名或Tunnel。电脑、Node和MongoDB保持运行，避免休眠；网络或IPv4变化后更新PUBLIC_BASE_URL和APP_ORIGIN，再重启并下载新二维码。网站从localhost切换到局域网地址后浏览器需重新登录，这是不同主机Cookie的正常行为。

## 微信及局域网HTTP兼容修复（2026-10-21）

用户已通过iPhone微信连接网站，但编辑器因crypto.randomUUID在普通HTTP不可用而无法添加题目。现已修复所有前端UUID生成入口及剪贴板降级，完整回归在实际局域网HTTP入口通过（94项单元/API、19条浏览器流程、构建和冒烟）。这次确认了页面交互，补足最初只检查页面加载和预检的遗漏。微信真机修复后仍待用户重新打开验证；详见[browser-compat-audit.md](browser-compat-audit.md)。关闭旧微信窗口后可打开http://172.25.23.29:3000/dashboard?v=20261021-wechat加载新页面。

## 可选：后续公网接入（尚未执行）

代码和数据库均已在本地实现。以下方案用于将来跨网络收集，尚未执行；二维码只编码URL，不提供网络托管。

本地先完成 `npm run build`、`npm start`，确认3000端口能打开。使用Quick Tunnel测试：

```powershell
cloudflared tunnel --url http://127.0.0.1:3000
```

将生成的HTTPS域名填入 `.env` 的PUBLIC_BASE_URL，并加入APP_ORIGIN，设置COOKIE_SECURE=true后重启Node服务，从该域名重新登录并生成分享二维码。停止Tunnel后链接失效；重建域名变化，旧二维码不会自动更新。

固定域名需Cloudflare账号和已托管域名，控制台创建Tunnel，安装cloudflared后将Published application route指向本机 `http://127.0.0.1:3000`。不要转发27018数据库端口。电脑、MongoDB、Node和Tunnel都必须保持运行。

长期在线时将Express应用和数据库迁到持续在线的云端，保留ObjectId/publicId和持久HMAC密钥。数据库采用认证副本集或Atlas，备份后迁移，避免两个入口写两套库。Cloudflare可继续作为Tunnel或域名入口。详细方案沿用根目录plan.md第11节。

API、登录和统计保持Cache-Control:no-store；不得用Cloudflare规则缓存私人API。不要在公开问卷入口启用仅特定邮箱可访问的Access策略。部署后使用手机移动网络实际完成登录、提交、修改和统计核对。

本轮没有注册Cloudflare站点或执行公网部署，没有用D1替代MongoDB。
