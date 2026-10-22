# 第一阶段GitHub提交检查

检查日期：2026-10-22（Asia/Shanghai）。

## 当前交付范围

按最新要求，项目完成报告精简为本地Markdown，删除提交信息，由提交者自行转换PDF。`docs/report-stage1.md`和`output/pdf/`加入忽略规则，并从GitHub当前版本移除；本地文件保留，已有Git历史不重写。

2026-10-22已重新执行94项单元/API、19条真实局域网HTTP浏览器流程、类型检查、生产构建及HTTP冒烟，全部通过，证据为submission-unit-results.json和submission-browser-results.json。下文“最新完整功能验证为2026-10-21”记录的是此前首次Git整理时的状态。本次精简报告不修改业务代码，无须重复运行功能测试。

目标仓库：`Mediocrity-919/database-course-project`。已通过当前GitHub登录确认归属和推送权限；仓库创建时为空，默认分支为main，可见性为公开。本次保留原可见性。

## 提交范围

提交源码apps、packages、database、scripts、tests，系统、数据库、API、测试和AI日志等项目文档，以及JSON测试证据、README、plan、依赖锁文件、TypeScript/测试配置、.npmrc、.gitignore及.env.example。项目完成报告单独交付。

以下内容由.gitignore排除，并已检查暂存区不包含这些文件：

- `.env`及其他真实`.env.*`配置；仅放行`.env.example`。
- `.local/`：实际MongoDB数据、缓存和临时检查文件。
- `大作业一.docx`：课程题目原文。
- `docs/report-stage1.md`和`output/pdf/`：本地报告及其PDF文件。
- `node_modules/`、`dist/`、`apps/web/dist/`。
- `test-results/`、`playwright-report/`、`coverage/`、日志和Office临时文件。

不提交的配置、数据库和题目原文继续保存在本机，没有删除或导出真实账号和答卷。示例环境由setup、db:init和db:seed脚本重建，不上传真实用户数据库。

## 密钥检查

检查对象为实际暂存的Git文件内容和当前仓库已有历史。初次扫描65个文件；本检查记录加入后再次扫描全部66个文件及最终提交历史。检查脚本及含本机检查过程的原始结果保存在被忽略的.local/qa中。

1. 在内存中读取.env里的真实PARTICIPANT_HMAC_KEY，逐字检查待提交内容是否含该密钥；不输出密钥值。
2. 扫描GitHub/OpenAI等常见令牌格式、私钥标记、AWS访问键、Slack令牌、JWT、带账号密码的连接串及npm认证字段。
3. 检查是否误加入.env、.local、数据库目录、私钥文件或构建产物。
4. 核对.env.example只有占位符，.npmrc不含认证令牌。

检查结果：没有发现真实HMAC密钥或上述凭据内容；禁止提交的路径为0，配置模板包含在提交中。测试中的固定演示密码及文档中的占位符不属于本机真实账号密码或服务密钥。

GitHub认证通过现有Git Credential Manager完成。用于仓库归属检查的登录凭据仅在进程内存中使用，没有写入源文件、命令参数、日志或本检查记录；origin仅保存普通HTTPS仓库地址。

## 验证与版本说明

最新完整功能验证为2026-10-21的94项单元/API、19条真实LAN HTTP浏览器流程、类型检查、生产构建和HTTP冒烟通过，详见test-results.md。本次提交整理仅调整忽略规则及交付状态说明，没有修改业务代码，也没有声称当天重跑了全部功能测试。

本次是项目首个Git提交，包含之前完成的第一阶段成果。先前开发与修复过程依据ai-log.md及测试证据记录，不虚构逐步Git历史。代码提交基线以Git实际生成的提交号为准；数据库逻辑备份、恢复演练及干净机器安装仍待执行。
