# 第一阶段数据库设计

实际定义以 `database/schema.ts`、`apps/server/src/models.ts` 和 `packages/shared/src/domain.ts` 为准。开发库为 `questionnaire_stage1`，测试库为 `questionnaire_test`。下述五个集合承载全部持久化业务数据；会话也保存在 MongoDB。

| 集合            | 主体及关键字段                                                                                                | 主要索引                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| users           | 账号；username、usernameNormalized、passwordHash、createdAt                                                   | usernameNormalized 唯一                                |
| sessions        | 登录；userId、tokenHash、csrfToken、expiresAt                                                                 | tokenHash 唯一，expiresAt TTL，userId                  |
| surveys         | 归属、草稿、状态；ownerId、publicId、draft、activeVersionId、deadlineAt、revision、submissionGateSeq          | publicId 唯一，ownerId+updatedAt+_id                   |
| survey_versions | 发布定义；surveyId、versionNumber、sourceDraftRevision、definition                                            | surveyId+versionNumber 唯一                            |
| responses       | 一次填写；surveyId、surveyVersionId、participantKey、answers、visitedQuestionIds、status、editDraft、revision | 尝试幂等唯一、禁止重复提交条件唯一、统计及本人草稿索引 |

## 嵌入与引用

问卷定义包含有限的题目数组，每题嵌入选项、validation及logic。填写时一次取得完整定义，可整体检查条件引用和保存。没有独立题库需求，不拆成题目表、选项表、条件表。

每份答卷引用问卷与确切的发布版本，答案只保存稳定题目ID、服务器写入的题型及值，不重复保存题干。答卷数量可以增长，因此不嵌入问卷文档。历史发布版本也独立，避免问卷单文档不断膨胀。

surveys.title 是列表摘要冗余，由保存/发布流程同步；responses.surveyId 是查询和唯一限制需要的受控冗余；repeatAllowed 从可信发布设置冻结。没有独立统计集合，已提交答卷是统计事实来源。

主键与跨集合引用使用 BSON ObjectId，日期使用 BSON Date/UTC，API转换为字符串；题目、选项、规则和客户端尝试ID使用UUID。所有文档带 schemaVersion。versionNumber、revision分别表示发布版本和并发修订号。

新账号密码在应用层强制8～128字符、大写、小写及数字要求，再存Argon2id哈希；数据库不保存明文，也无法从哈希验证字符组成，因此复杂度规则由注册接口和演示数据入口统一执行。登录先判断usernameNormalized是否存在，再校验哈希；对已有账号不追加新密码规则，不改变现有数据结构。

## 填写设置与两种行为

```json
{
  "allowAnonymous": true,
  "allowMultipleSubmissions": false,
  "allowEditAfterSubmission": true
}
```

允许重复时关闭 `allowEditAfterSubmission`，每次再填插入新答卷。禁止重复时最多保留一份已提交答卷；若允许修改，则在原文档创建 `editDraft: { answers: [...] }`。保存修改仅更新该字段和revision，主answers/status不变；确认后在事务中替换主answers，清空editDraft并增加editCount，仍用同一_id。submittedAt保留首次提交，lastSubmittedAt记录最近一次确认。

相同提交请求使用 `lastSubmissionId + submissionHash` 判断重试；摘要按绑定版本、匿名选择和规范化答案计算，不包含revision和CSRF。浏览器重试不产生额外答卷。

禁止重复的数据库兜底：

```javascript
db.responses.createIndex(
  { surveyId: 1, participantKey: 1 },
  {
    unique: true,
    name: "one_submission_per_participant",
    partialFilterExpression: { status: "submitted", repeatAllowed: false },
  },
);
```

同一人的多份草稿允许存在，只有成功提交占用唯一键。修改原答卷不改变该键，因此无需删除旧答卷再插入。匿名和实名使用相同participantKey，不能切换身份展示方式绕过限制。

## 匿名和身份

participantKey为HMAC_SHA256(持久服务器密钥, surveyId:userId)，按问卷隔离。匿名答卷respondentId为null，非匿名为账号ObjectId。创建者接口排除participantKey、clientAttemptId、提交摘要和editDraft。登录仍是匿名填写的前提，不收集设备指纹或IP作为参与者身份。

HMAC标识也用于填写者访问自己答卷的权限判断及去重人数统计。它是伪匿名标识，不能承诺对拥有服务器密钥的运营者不可追溯。

## 数据库与业务校验

五个集合均设置strict/error validator。账号、日期、ObjectId、bool、状态枚举和答案BSON类型由数据库校验；匿名答卷不能包含respondentId；submitted必须有提交时间、摘要和请求ID。选择数组不允许重复。

动态问题校验、跨集合引用归属、选项属于哪道题、跳转目标合法性在共享模块和后端完成；MongoDB不提供这些业务外键。后端拒绝客户端指定ownerId、participantKey、repeatAllowed等可信字段。

每卷最多100题、每题50选项、每题20规则、文本答案最多2000字符。定义和答案额外检查实际BSON不超过1MiB，请求体不超过2MiB。应用上限避免接近MongoDB文档大小限制。

文本答案先trim首尾空白、将CRLF/CR转为LF，再按Unicode码点计数；前端显示、请求上限和业务范围使用共享函数。输入框不使用原生maxLength截断。实际MongoDB回归验证2000个表情保存成功，2001码点直接写入被validator以121拒绝；本次修复不改变数据库schema、索引或既有数据。

## 事务和并发

发布事务插入不可变快照并设置问卷发布入口，一起成功或回滚。保存草稿与答卷使用revision条件，防止旧页面覆盖新内容。

提交事务先重放路径，然后条件写问卷的submissionGateSeq，要求published、绑定版本匹配且未截止，再确认答卷。关闭操作也写同一问卷文档，因此与提交冲突后由驱动重试并重新检查状态。条件唯一索引兜底账号的唯一提交。事务使用snapshot读关注和majority写关注，不在事务内并行操作。

submissionGateSeq仅协调准入，不用作统计数字。这种每次提交写入口文档的方案适合课程规模，有写热点限制。单节点副本集支持本地事务，不等于多节点高可用。

## 统计和未来扩展

聚合只读取submitted主答案，不读取in_progress或editDraft。同时提供提交份数、participantKey去重人数、每题到达/回答/未填/跳过数；各选项返回选择份数和去重人数。数字平均值按有效数字答卷计算，零数据为null，选项零计数补齐。重复答卷中同一人选过不同选项时，该人会出现在多个选项的人数中，因此选项人数之和可大于全题去重人数。

版本定义不修改；未来增加版本只新增survey_versions，旧答卷保留原version引用。新增题型或条件扩展schema、解释器、渲染器和统计分支。迁移使用schemaVersion，先备份后验证旧功能。第一阶段没有自动删除答卷的TTL策略。
