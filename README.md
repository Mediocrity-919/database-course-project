# 问笺 Survey Studio

基于 MongoDB 的课程问卷系统第一阶段实现。支持账号、问卷设计、条件跳转、填写保存、匿名提交、URL/二维码分享和统计。题目定义在发布时生成不可变快照，答卷独立保存。

第一阶段完整说明见[项目完成报告](docs/report-stage1.md)及[提交版PDF](output/pdf/2026_ECNU_PJ1_1_彭欣.pdf)，设计理由与后续计划见[plan.md](plan.md)。2026-10-22提交前复验：**94项单元/API测试、19条真实局域网HTTP入口的浏览器流程、类型检查、生产构建及HTTP冒烟通过**。文本Unicode边界和普通HTTP下的UUID/复制兼容问题已修复；公网部署及微信真机修复后复验尚未执行。

## 填写策略与校验

编辑问卷时，点击“未命名问卷”“新单选题/多选题/填空”或“选项 1/2”等默认文字会自动全选，直接输入即可替换；新增选项同样适用。已填写的自定义内容保留正常光标编辑方式。

- **禁止重复 + 允许修改**：一个账号在一份问卷内保留一份已提交答卷。修改使用同一答卷文档内的 `editDraft`，确认前不会污染统计，确认后更新原答案，答卷 ID 与提交份数保持不变。
- **允许重复**：每次填写创建新答卷。原答卷保持不变，统计同时展示答卷份数和账号去重人数。
- 填写者均须先登录；匿名表示创建者看不到账号身份。内部 `participantKey` 用于授权和去重。
- 问卷关闭或超过截止时间后，不能提交新答卷或确认修改。相同成功请求的重试仍返回原结果。
- 恢复草稿沿用并显示原来的匿名/实名设置。上一题与下一题都会保存有效答案；不合规的未完成输入暂留页面并提示，修正后再保存。
- 保存期间的新编辑会保留并标为未保存；提交结果不确定时保留原请求，点击“重试提交”确认，不会新增答卷。
- 文本答案去除首尾空白、统一换行后按Unicode码点计数，前端计数、接口与业务校验一致。😀和𠀀各计1字符；组合表情可能占多个码点。文本框保留超限输入并提示修改，不静默截断；上限2000码点，允许每题设置更小范围。

## 环境

Node.js 24（本机实测 24.14.0）、npm 11、MongoDB 8（本机实测 8.3.11）。数据库需要副本集；项目脚本使用已安装的 MongoDB，在 `.local/mongo-rs` 启动独立开发实例，端口27018，不修改原27017实例。

package.json声明Node.js >=22.12，精确依赖以package-lock.json为准。以下命令均在项目根目录执行，先确认27018端口供本项目使用。

```powershell
# 项目根目录
npm.cmd ci
npm.cmd run setup
npm.cmd run db:start
npm.cmd run db:init
npm.cmd run dev
```

打开 [开发网站](http://127.0.0.1:5173)。自行注册账号，不内置固定公开密码。

仅使用Vite开发模式时，可将.env中的PUBLIC_BASE_URL改为http://127.0.0.1:5173，重启后端后重新生成分享链接。默认值http://localhost:3000对应下方构建后运行方式；不要把不同端口或不同主机名下的登录Cookie当成同一访问环境。

用户名不区分大小写且不能重复。登录时先检查用户名是否存在：未注册时提示创建账号并带入原用户名，已有账号密码错误时单独提示。新注册密码须为8～128个字符，且同时包含大写字母、小写字母和数字；注册页实时显示各项是否满足，接口也执行相同校验。已有账号仍可使用原密码登录。

`setup` 仅在 `.env` 不存在时复制配置并生成随机密钥。不要删除或随意更换 `PARTICIPANT_HMAC_KEY`，否则历史匿名参与者标识会变化。

| 配置                 | 本地用途                                                      |
| -------------------- | ------------------------------------------------------------- |
| MONGODB_URI          | 开发库questionnaire_stage1，连接survey-rs副本集               |
| MONGODB_TEST_URI     | 独立questionnaire_test，允许测试清理，不能存正式数据          |
| HOST / PORT          | 默认127.0.0.1 / 3000                                          |
| APP_ORIGIN           | 允许注册、登录和修改请求的准确来源；模板列出本地3000/5173地址 |
| PUBLIC_BASE_URL      | URL与二维码使用的网站入口；改域名后重新生成二维码             |
| COOKIE_SECURE        | 本机HTTP为false，公网HTTPS配置为true                          |
| PARTICIPANT_HMAC_KEY | 首次setup生成，持久保存；不放入前端或提交材料                 |

若 MongoDB 不在 `D:\mongodb\bin\mongod.exe`，在 `.env` 中设置 `MONGOD_PATH`。`db:start` 启动的是本机回环、无认证开发实例；它保持后台运行并写日志 `.local/mongodb.log`。停止时先确认是本项目实例，再用以下管理员数据库命令正常关停，不要结束所有 mongod 进程：

```powershell
mongosh 'mongodb://127.0.0.1:27018/admin?directConnection=true' --eval 'db.shutdownServer()'
```

需要演示数据时，先设置自己选定的密码：

```powershell
$env:DEMO_PASSWORD='StudyDemo2026' # 示例，请换成自己的合规密码
npm.cmd run db:seed
```

将创建 `demo` 账号和示例问卷；已存在时不会重复创建或覆盖密码。

## 构建和正式本地运行

```powershell
npm.cmd run build
npm.cmd start
```

打开 [本地网站](http://localhost:3000)。Express 同时提供 `apps/web/dist` 和 `/api/v1`，不存在的 API 返回 JSON 404。前端无外部字体或图片依赖。

若此前使用5173开发入口，将PUBLIC_BASE_URL切回http://localhost:3000。修改后端代码或.env后须重启服务；修改前端源码后须重新构建才能在3000端口看到新页面。

## 局域网访问（当前已配置）

2026-10-21已将本机网站配置为无线局域网访问，品牌更名为“问笺”。当前访问地址为 **http://172.25.23.29:3000**，本机也可继续使用http://localhost:3000。手机和其他电脑需连接可互访的同一局域网，从该地址登录。

.env中的HOST已设为0.0.0.0，PUBLIC_BASE_URL使用上述局域网地址，APP_ORIGIN保留原有本地地址并添加局域网来源，HTTP下COOKIE_SECURE=false。分享链接和重新生成的二维码使用局域网地址；0.0.0.0是监听配置，不是应转发的网址。MongoDB仍仅绑定127.0.0.1:27018。

当前Windows已有允许Node.js在Public网络入站的规则，本次沿用，未修改现有规则。已在本机通过无线IPv4打开页面并检查API与预检；实体手机访问需继续实测。校园或访客Wi-Fi若启用设备隔离，可能无法互访。电脑休眠/关机或服务停止后不可访问；Wi-Fi或DHCP地址变化后需更新PUBLIC_BASE_URL及APP_ORIGIN并重启、重新生成二维码。具体说明见[部署说明](docs/deployment.md)。

## 测试

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run smoke
npm.cmd run test:e2e
```

测试与冒烟只使用 `questionnaire_test` 数据库，测试入口会拒绝其他库名。`npm test` 会清理测试库的五个集合，绝不对开发库运行清理。运行测试前先启动项目副本集。各组测试共用测试库，按上述命令顺序运行，不要并发执行；确保3010/3011测试端口空闲。

端到端测试在3010启动构建后的服务，默认使用本机已安装的 Chrome；无 Chrome 时执行 `npx playwright install chromium`，或自行配置 `playwright.config.ts`。如 Windows 环境限制测试框架结束子进程，可手动在单独终端启动3010测试服务，并设置 `PLAYWRIGHT_EXTERNAL_SERVER=1` 运行测试（详见测试说明）。

结果与限制见 [测试结果](docs/test-results.md)，用例与步骤见 [测试用例](docs/test-cases.md)。

最新结果包括36项API集成、19项账号规则/API、29项定义/校验/跳转、6项进度规则、4项UUID兼容及19条浏览器流程；JSON证据保存在docs/test-evidence。微信/HTTP核查及复验步骤见[兼容性核查](docs/browser-compat-audit.md)。文本Unicode边界回归也继续通过。

默认浏览器测试入口为127.0.0.1。为覆盖普通HTTP，可设置PLAYWRIGHT_TEST_ORIGIN=http://电脑局域网IP:3010后运行npm run test:e2e；脚本仍只使用questionnaire_test并限定3010端口。测试结束后移除该环境变量，避免更换网络后保留过时IP。微信打开实际网站时，若复制API不可用，按钮会选中链接并提示长按复制；不是自动写入剪贴板。

## 代码结构

```text
apps/server/src/      配置、身份与HTTP入口、问卷业务和事务、MongoDB集合类型
apps/web/src/         React页面、题目与规则编辑器、填写引擎、统计和分享
packages/shared/src/  题目schema、答案校验、条件解释器、路径重放
database/             五集合数据库validator和索引、演示定义
scripts/              环境初始化、副本集启动、数据库初始化、HTTP冒烟
tests/                单元、MongoDB集成、浏览器端到端
docs/                 完成报告、数据库设计、API、关键逻辑、测试与AI日志
```

为减少课程项目的工具链负担，使用一个根 `package.json` 统一安装依赖，代码目录保留前后端和共享模块边界。统计图使用原生 CSS 条形图；其数据来自 MongoDB 聚合。数据库访问使用官方驱动，不使用关系数据库或现成问卷系统框架。

## 部署

本轮完成本地代码与验证，公网部署步骤见 [部署说明](docs/deployment.md)。URL和二维码生成使用 `.env` 中的 `PUBLIC_BASE_URL`；localhost 地址不能发给其他设备访问。云端数据库应配置认证、备份、网络限制和所需 TLS，不能原样照搬本机无认证开发实例。

## 文档与提交材料

| 文档                                                              | 内容                                                         |
| ----------------------------------------------------------------- | ------------------------------------------------------------ |
| [第一阶段项目完成报告](docs/report-stage1.md)                     | 项目目标、系统与数据库设计、跳转校验、测试、问题解决、AI总结 |
| [实施计划与当前状态](plan.md)                                     | 设计依据、实际实现、待部署与第二阶段准备                     |
| [数据库设计](docs/database-design.md)                             | 五集合、嵌入/引用、索引、事务、匿名及统计                    |
| [API说明](docs/api.md)                                            | 路径、权限、输入输出、错误码                                 |
| [关键逻辑](docs/key-logic.md)                                     | 路径重放、草稿保存、修改与幂等                               |
| [测试用例](docs/test-cases.md) / [测试结果](docs/test-results.md) | 输入、步骤、预期、实际结果和证据                             |
| [AI使用日志](docs/ai-log.md)                                      | 真实提示、生成与修复过程                                     |
| [需求完整性核查](docs/stage1-audit.md)                            | 逐项要求、历史发现及修复状态                                 |
| [部署说明](docs/deployment.md)                                    | 本地与Cloudflare接入方案，尚未执行公网部署                   |

GitHub仓库为[Mediocrity-919/database-course-project](https://github.com/Mediocrity-919/database-course-project)，本次首次Git提交保存第一阶段代码基线。[提交检查记录](docs/submission-checklist.md)说明文件范围及密钥检查结果。.env、.local/和大作业一.docx仅保留本机，.env.example正常提交。数据库逻辑备份、恢复演练及干净机器安装仍待执行；第二阶段须保留现有核心结构和旧数据，具体迁移根据后续需求设计。
