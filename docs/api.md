# API 使用说明

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
