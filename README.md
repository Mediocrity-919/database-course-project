# 问笺 · 数据库课程问卷系统

基于MongoDB的在线问卷系统。第二阶段在第一阶段基础上增加常用题库、跨用户共享、不可变题目版本和跨问卷统计，保留问卷设计、条件跳转、填写保存、匿名与重复填写、URL/二维码分享等功能。

| 分支 | 内容 |
| --- | --- |
| [main](https://github.com/Mediocrity-919/database-course-project/tree/main) | 第一阶段成果 |
| [v2](https://github.com/Mediocrity-919/database-course-project/tree/v2) | 第二阶段需求变更、代码与测试；本README说明此版本 |

## 功能

- 注册登录：用户名不区分大小写且唯一；新密码为8～128字符，必须包含大写、小写字母和数字，页面逐项提示。
- 问卷设计：单选、多选、文本、数字四类题目；必答、选择数量、文本长度、数字范围及整数校验；可配置条件跳转。
- 发布填写：不可变发布快照、截止时间、URL/二维码分享、填写草稿恢复、匿名与重复填写策略、原答卷修改及聚合统计。填写者需要登录，匿名表示向问卷创建者隐藏账号身份。
- 题库与共享：保存常用题、管理题库归属、按用户名共享；同一道题可以用于多份问卷。
- 版本管理：从任意历史版派生、查看来源、恢复旧内容为新版本；已发布问卷和旧答案保持原样。
- 使用与统计：反查引用问卷；统计单个版本或同题型版本合计。改名选项分开显示，外部问卷须授权才贡献汇总，外部文本原文不共享。

## 技术与数据结构

前端为React、TypeScript和Vite，后端为Node.js、Express和MongoDB官方驱动，共享模块统一校验与跳转规则。业务数据保存在MongoDB，不使用关系数据库或现成问卷框架。

| 集合 | 职责 |
| --- | --- |
| `users` / `sessions` | 账号与登录会话 |
| `surveys` / `survey_versions` | 问卷入口、草稿及不可变发布快照 |
| `responses` | 独立答卷、填写进度与修改草稿 |
| `question_banks` | 题库名称、说明及所有者 |
| `question_families` | 题目系列、共享名单、题库归属及最新版本指针 |
| `question_versions` | 不可变内容、版本号、父版本及恢复来源 |

题库复用采用“系列—版本—问卷内快照”：问卷中的`source`绑定固定版本，填写不读取题库最新版。新字段均为可选，旧问卷不需要回填。设计依据、索引与事务见[数据库设计](docs/database-design.md)和[第二阶段设计](docs/stage2-design.md)。

## 环境要求

- 推荐Node.js 24、npm 11、MongoDB 8；`package.json`要求Node.js ≥22.12，依赖版本以锁文件为准。
- MongoDB必须以副本集运行以支持事务。本地脚本启动`survey-rs`单节点副本集，端口27018，数据放在`.local/mongo-rs`，不修改已有27017实例。
- 浏览器测试默认使用Windows已安装的Chrome；没有Chrome时可运行`npx playwright install chromium`。
- 下列命令在Windows PowerShell、v2分支的项目根目录执行；其他终端可将`npm.cmd`写为`npm`，一键验收脚本需要Windows PowerShell。

## 首次启动

```powershell
npm.cmd ci
npm.cmd run setup
```

`setup`仅在`.env`不存在时创建配置并生成随机密钥；已有配置不会覆盖。若`mongod`不在PATH且未安装于`D:\mongodb\bin\mongod.exe`，先在`.env`填写`MONGOD_PATH`的实际路径。

新环境继续执行：

```powershell
npm.cmd run db:start
npm.cmd run db:init
npm.cmd run build
npm.cmd start
```

打开[本地网站](http://localhost:3000)，自行注册账号。Express同时提供构建后的前端和`/api/v1`接口，无需另开前端进程。修改源码后需要重新构建并重启服务。

### 从第一阶段升级

已有数据时，保留原`.env`和数据库，在v2代码下先备份，再增量初始化：

```powershell
npm.cmd run db:start
npm.cmd run db:backup
npm.cmd run db:init
npm.cmd run db:verify -- --baseline latest
npm.cmd run build
npm.cmd start
```

逐条执行，前一步失败时先排查，不继续初始化。备份包含敏感数据，仅保存在被忽略的`.local/backups`。不要更换`PARTICIPANT_HMAC_KEY`，它影响历史参与者标识。Git分支不隔离MongoDB数据，main不理解二期字段；同时展示两期应分别使用不同数据库。

### 开发模式

```powershell
npm.cmd run dev
```

访问[开发页面](http://127.0.0.1:5173)，Vite将API请求代理到3000。此时将`.env`中的`PUBLIC_BASE_URL`设为`http://127.0.0.1:5173`并重启后端，使分享链接指向开发页面。使用构建后的3000入口时改回对应地址。

## 主要配置与局域网访问

| `.env`配置 | 说明 |
| --- | --- |
| `MONGODB_URI` | 开发库连接，模板使用`questionnaire_stage1`；二期沿用库名 |
| `MONGODB_TEST_URI` | 独立测试库`questionnaire_test`，测试会清理其中数据 |
| `HOST` / `PORT` | 模板监听`127.0.0.1:3000` |
| `APP_ORIGIN` | 允许注册、登录和修改请求的网页来源，多个地址用逗号分隔 |
| `PUBLIC_BASE_URL` | URL与二维码中的访问入口 |
| `COOKIE_SECURE` | 本地HTTP为`false`，HTTPS为`true` |
| `PARTICIPANT_HMAC_KEY` | setup生成并持久保存的密钥，只放在后端配置中 |

局域网演示使用构建后的3000入口：将`HOST`设为`0.0.0.0`，`PUBLIC_BASE_URL`设为`http://电脑当前局域网IP:3000`，并把该完整地址加入`APP_ORIGIN`，HTTP下保持`COOKIE_SECURE=false`。重启服务并重新生成分享二维码。

手机与电脑需处于可互访的同一局域网，系统防火墙允许该服务入站；MongoDB仍只监听回环地址。IP变化需更新配置，电脑关机或服务停止后无法访问。公网及Cloudflare方案见[部署说明](docs/deployment.md)，当前未完成公网部署。

## 第二阶段操作示例

1. 打开“我的题库”，创建“基本资料”题库和数字题“年龄（周岁）”，设置0～120及整数要求，保存并设置题库归属。
2. 建立两份问卷，点击“从题库选题”并选择v1。题目核心内容锁定，本卷跳转单独配置；发布后分别填写20和40。
3. 在题库查看使用与统计，应显示两份有效回答、平均30。按用户名共享给另一个账号后，对方可导入或另存自己的题目。
4. 从v1创建v2，原问卷继续使用v1。草稿中可选择“保存为题库新版本并替换”，或“解除关联并编辑副本”只改本卷。恢复v1会追加新版本，历史不覆盖。
5. 在“仅此版本”和“全部版本合计”间切换。合计只纳入同题型版本；选项ID与文字均相同才合并。题意或数字单位变化时应使用单版本统计。

共享题目不等于共享答卷。默认只统计本人问卷，题目作者还可统计明确允许汇总的外部问卷；文本原文仅来自本人问卷。跨卷按有效回答份数统计，不宣称去重人数。

## 测试与验收

先启动MongoDB。以下测试共用隔离的`questionnaire_test`，请顺序运行，不能把正式数据放进测试库；浏览器和冒烟分别使用3010、3011端口。

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run smoke
npm.cmd run test:e2e
```

数据库只读核查及Windows一键验收：

```powershell
npm.cmd run db:verify
npm.cmd run db:verify -- --test
npm.cmd run accept
```

`accept`依次执行开发库备份、增量初始化、只读核查、单元/API测试、测试库核查、构建、冒烟和浏览器流程。任何一步失败即停止，日志写入`.local/qa`。它包含开发库初始化，不等同于只读检查。

2026-10-28修复后实际结果：

| 检查 | 结果 |
| --- | --- |
| 单元/API及脚本测试 | **128通过**，包括一期94项及二期34项 |
| Chrome端到端 | **26通过**，包括一期19条及二期7条；0失败、0跳过、0flaky |
| 类型检查、生产构建、两期HTTP冒烟 | 通过 |
| 数据库核查 | 测试库12项、开发库含备份比对14项，均0错误、0提示；原11条业务记录未改变 |

本次结果为各步骤分别实测，脚本失败保护在临时项目中用模拟命令验证。浏览器包含移动布局及HTTP能力缺失场景，不能替代微信真机验收。详见[测试结果](docs/test-results.md)、[精简测试证据](docs/test-evidence/stage2-precommit-results.json)和[手工验收清单](docs/stage2-audit.md)。

## 项目结构与文档

```text
apps/server/src/       身份校验、HTTP接口、问卷事务、题库版本及统计
apps/web/src/          React题库、编辑器、填写、分享及统计页面
packages/shared/src/  题目与答案校验、跳转规则、复用内容比较
database/             八集合validator、索引、演示定义及一致性核查
scripts/              环境设置、数据库启动/备份、构建验收与HTTP冒烟
tests/                单元、MongoDB/API、脚本与浏览器测试
docs/                 设计、API、测试、部署及AI使用日志
```

| 文档 | 内容 |
| --- | --- |
| [plan.md](plan.md) | 实施安排与一期历史方案 |
| [数据库设计](docs/database-design.md) / [第二阶段设计](docs/stage2-design.md) | 数据模型、八项需求映射、兼容性与取舍 |
| [API说明](docs/api.md) / [关键逻辑](docs/key-logic.md) | 接口、权限、执行流程与统计口径 |
| [测试用例](docs/test-cases.md) / [测试结果](docs/test-results.md) | 验收步骤、真实结果与历史证据 |
| [AI使用日志](docs/ai-log.md) | 工具、提示任务、产出、发现的问题及修复过程 |
| [提交检查](docs/submission-checklist.md) | 提交范围、忽略文件与密钥检查记录 |

真实`.env`、`.local/`、课程原始文档、项目报告、PDF、本机`.claude/`配置、依赖目录、构建产物及运行缓存不提交；仅提交`.env.example`配置模板。项目报告单独保留在本地。当前未做全新机器安装、数据库恢复演练或大规模压力测试。
