# API 使用说明（v2）

## 第二阶段新增接口

以下路径同样以`/api/v1`为前缀，均要求登录；所有写操作执行原有Origin、JSON与CSRF检查。`page`从1开始，每页20条，题目列表、版本历史和文本明细返回hasMore；题库列表和使用清单适合当前课程数据规模，尚未分页。

| 方法及路径 | 权限 | 输入 / 返回 |
| --- | --- | --- |
| GET /question-banks | 本人 | items，按更新时间降序 |
| POST /question-banks | 登录 | name、description可选；201新题库 |
| PUT /question-banks/:id | 本人 | revision、name、description；题库新revision |
| GET /library/questions | 作者或被共享者 | page、bankId可选；items含owned、owner用户名、latest及hasMore |
| POST /library/questions | 登录 | content、fromVersionId可选；201返回family和version |
| GET /library/questions/:id | 作者或被共享者 | page；family、owned、versions、hasMore，作者另有共享用户名 |
| PUT /library/questions/:id/access | 仅作者 | revision、usernames数组、bankIds数组；更新整个授权及归属名单 |
| GET /library/versions/:id | 作者或被共享者 | version完整内容及父链 |
| POST /library/versions/:id/derive | 仅作者 | revision、content；201新不可变版本 |
| POST /library/versions/:id/derive | 仅作者 | revision、restore:true；复制该旧版为新版本，不覆盖旧版 |
| POST /library/versions/:id/import | 作者或被共享者 | 空对象；新实例UUID、固定source、原选项ID |
| GET /library/versions/:id/usage | 作者或被共享者 | scope=version（默认）或family；items含versionNumbers（该问卷使用了哪些版本）；作者可见其他引用的匿名占位，接收者仅看本人；外部问卷无id |
| GET /library/versions/:id/stats | 作者或被共享者 | page、scope=version（默认）或family；answerCount、surveyCount、average/min/max、distribution、options（含versionNumbers）、texts、hasMore、versions（各版本有效回答份数）、excludedVersions（题型不同未合并的版本） |

content采用原Question JSON：id(UUID)、order、type、title、description、required、options、validation、logic。保存常用题时服务端将order归一为1，移除source并清空问卷上下文logic。创建独立题可直接使用同一结构；题干、选项和校验仍按原规则检查。

导入后把返回题目放入问卷definition.questions，并按位置设置order；保存及发布核对source引用和核心内容。核心内容不可直接修改，可派生后替换或显式解除关联。仅允许调整实例ID、顺序、跳转；同卷不能重复同一版本。copy接口重建实例/跳转ID，但保留题库选项ID和source；独立题的选项ID逐题重新生成，避免与引用题或其他题串用映射。

跨卷统计只聚合确切版本。本人问卷始终可汇总；原题作者还可汇总设置shareLibraryStatistics=true的发布快照。外部文本只贡献数量，原文不返回。有效答案为分母，不是跨卷去重人数。未授权访问404，旧revision冲突409，参数/来源内容不一致422，ID格式400；恢复不需content。共享名单清空代表撤销，已保存的引用仍可用，新导入被拒绝。

## 原有接口（保留兼容）

前缀 `/api/v1`。API不缓存。修改请求使用JSON、可信Origin和登录会话的 `X-CSRF-Token`；注册/登录仅要求可信Origin、JSON和限流。成功JSON直接返回数据。登录Cookie为HttpOnly，前端不能读取原会话令牌。

```json
{
  "error": {
    "code": "ANSWER_REQUIRED",
    "message": "请完成必答题",
    "fieldErrors": [
      {
        "questionId": "UUID",
        "code": "ANSWER_REQUIRED",
        "message": "此题为必答题"
      }
    ]
  }
}
```

| 方法及路径                                | 权限     | 关键输入/输出                                                 |
| ----------------------------------------- | -------- | ------------------------------------------------------------- |
| POST /auth/register                       | 公开     | username、password；创建账号                                  |
| POST /auth/login                          | 公开     | 同上；Cookie、user、csrfToken                                 |
| GET /auth/me                              | 登录     | user、csrfToken                                               |
| POST /auth/logout                         | 登录     | 删除会话并清Cookie                                            |
| GET /surveys                              | 登录     | cursor可选；本人列表、统计摘要、nextCursor                    |
| POST /surveys                             | 登录     | 空对象；创建草稿                                              |
| GET /surveys/:id                          | 创建者   | 管理信息、definition                                          |
| PUT /surveys/:id/draft                    | 创建者   | revision、definition、deadlineAt                              |
| DELETE /surveys/:id                       | 创建者   | 仅草稿可删除                                                  |
| POST /surveys/:id/publish                 | 创建者   | revision；快照与发布事务                                      |
| POST /surveys/:id/close                   | 创建者   | 关闭，重复调用保持同一状态                                    |
| PATCH /surveys/:id/deadline               | 创建者   | deadlineAt；ISO带时区字符串或null                             |
| POST /surveys/:id/copy                    | 创建者   | 新ID和重写引用的新草稿                                        |
| GET /surveys/:id/share                    | 创建者   | url及当前状态                                                 |
| GET /public/surveys/:publicId             | 公开     | 简介、设置、题数、有效状态，无完整题目                        |
| GET /public/surveys/:publicId/my-attempts | 登录     | 本人最近50次尝试                                              |
| POST /public/surveys/:publicId/attempts   | 登录     | clientAttemptId(UUID)、isAnonymous；attempt+definition+survey |
| GET /attempts/:id                         | 填写本人 | 恢复答卷；修改时answers为修改草稿                             |
| POST /attempts/:id/edit                   | 填写本人 | revision；进入或继续修改草稿                                  |
| PUT /attempts/:id/answers                 | 填写本人 | revision、answers；新revision                                 |
| POST /attempts/:id/submit                 | 填写本人 | revision、answers、submissionId(UUID)；提交凭证               |
| GET /surveys/:id/stats                    | 创建者   | versionId可选；整体和所有单题聚合                             |
| GET /surveys/:id/questions/:qid/stats     | 创建者   | page可选，每页20条；单题及填写内容                            |
| GET /surveys/:id/responses                | 创建者   | cursor可选；已脱敏的已提交答卷                                |
| GET /health                               | 公开     | 数据库ping成功后status=ok                                     |

答案请求格式：

```json
{
  "revision": 1,
  "answers": [{ "questionId": "题目UUID", "value": 20 }],
  "submissionId": "本次确认提交的UUID"
}
```

单选value是选项ID，多选是选项ID数组，文本是string，数字必须是JSON number。客户端不提交questionType；服务器从快照确定。相同提交的重试沿用submissionId，新的修改确认生成新ID。

文本答案先去除首尾空白、将CRLF/CR转为LF，再按Unicode码点计数。请求schema检查规范化后的全局2000码点上限，随后按绑定题目minLength/maxLength验证并保存规范化值。超过全局上限返回422 INPUT_INVALID；超过题目更小的范围返回422 ANSWER_INVALID。😀和𠀀各计1码点；2000个表情合法，2001个拒绝。此规则不改变账号、标题等其他字符串字段。

注册密码须为8～128个字符，同时包含ASCII大写字母、小写字母和数字；特殊字符可以使用但不强制。前后端共享 `packages/shared/src/auth.ts`，接口不符合时返回422 `PASSWORD_INVALID`，`fieldErrors`逐项返回缺少的大写、小写、数字或长度要求，不返回密码内容。用户名重复返回409 `USERNAME_TAKEN`，仍由MongoDB唯一索引兜底。

登录先以规范化用户名查找账号，未注册返回404 `USER_NOT_FOUND`（“该用户名尚未注册，请先创建账号”），存在但密码不匹配返回401 `PASSWORD_INCORRECT`（“密码错误，请重新输入”）。登录不套用新注册复杂度规则，以兼容已有账号；页面缺失用户名时提供预填用户名的注册链接并保留returnTo。

状态码：400标识/JSON/游标格式；401未登录；403来源/CSRF；404不存在或越权；409revision、重复提交、幂等冲突；410关闭/截止；413请求体过大；422定义/答案校验；429限流；500内部错误。匿名创建者响应不携带内部关联字段，管理接口统一校验ownerId。

### 整道题跨问卷统计（scope=family）

`scope=version`只统计路径中的确切版本；`scope=family`以该版本为基准，合计同一题目系列中**题型相同**的全部版本在各问卷中的有效回答，并在versions中逐版本给出份数。题型不同的版本（如数字改为文本）放入excludedVersions，不与数字均值或选项计数混合。选择题先按答案所属版本解析选项，再按`(optionId, label)`合并；同ID但文字变化的选项单列，历史回答始终使用历史文字。options返回`key`（此二元组的JSON字符串，供列表唯一标识）、`id`、`label`、`count`、`order`和`versionNumbers`，从不同基准版本查询同题型合计结果一致。若题意或数字单位变化，应使用单版本统计，系统不自动推断语义等价。权限与单版本相同：默认只计本人问卷，题目作者另计明确开启shareLibraryStatistics的问卷；文本原文只来自本人问卷；不宣称跨卷去重人数。其他scope取值返回422。

示例：`GET /api/v1/library/versions/<v1>/stats?scope=family` →
`{"scope":"family","type":"number","answerCount":3,"average":30,"min":20,"max":40,"surveyCount":2,"versions":[{"versionNumber":2,"answerCount":1,…},{"versionNumber":1,"answerCount":2,…}],"excludedVersions":[{"versionNumber":3,"type":"text",…}],…}`
