# 微信与局域网HTTP兼容性核查

日期：2026-10-21。触发问题：用户在iPhone微信中打开http://172.25.23.29:3000，进入编辑器后点击题型，题目目录仍为0。

## 1. 已复现的直接原因

添加题目时，Editor.tsx直接调用crypto.randomUUID()生成题目/选项ID。该API要求安全上下文；局域网普通HTTP不符合这一条件，实际浏览器中该方法为undefined。点击抛出`crypto.randomUUID is not a function`，更新题目数组的代码没有执行，因此按钮可见但没有新增题目。

真实局域网HTTP页面测得：

| 能力                   | 实际结果               |
| ---------------------- | ---------------------- |
| isSecureContext        | false                  |
| crypto.randomUUID      | undefined              |
| crypto.getRandomValues | function               |
| navigator.clipboard    | undefined              |
| Array.prototype.at     | function（本机Chrome） |

修复前，在独立测试库和http://172.25.23.29:3010运行浏览器用例，成功注册并进入编辑器，但点击单选后无法出现题目标题；trace中记录上述TypeError。修复前失败报告见[test-evidence/wechat-before-results.json](test-evidence/wechat-before-results.json)。这与截图中的0题现象一致。

此前完整浏览器流程以127.0.0.1为入口，不能暴露普通HTTP的能力差异。最初局域网检查仅验证登录页、页面加载和API预检，没有从该入口实际编辑，这是此前验证的遗漏。

依据：[randomUUID的安全上下文要求](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID)、[getRandomValues可在非安全上下文使用](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues)。

## 2. 全前端关联位置核查

| 位置              | 原风险                                | 处理结果                            |
| ----------------- | ------------------------------------- | ----------------------------------- |
| 新增四类题目      | 创建题目ID直接报错                    | 全部改用createUuid                  |
| 选择题初始选项    | 生成选项ID报错                        | 使用同一兼容函数                    |
| 添加选项          | 生成新选项ID报错                      | 使用同一兼容函数                    |
| 添加条件规则      | 生成规则ID报错                        | 使用同一兼容函数                    |
| 问卷简介/开始填写 | 渲染时创建clientAttemptId报错         | 使用同一兼容函数                    |
| 填写页/提交与修改 | 创建submissionId报错                  | 使用同一兼容函数，保留幂等语义      |
| 分享页复制        | navigator.clipboard不存在或权限被拒绝 | 自动选中链接并提示长按/系统菜单复制 |
| 手机空编辑器说明  | “从左侧添加”不符合移动单列布局        | 改为“请选择题型，添加第一道题目”    |
| 填写导航          | Array.at在较旧WebView上可能缺失       | 自有代码改用数组下标，不依赖该方法  |

前端没有其他无保护的crypto.randomUUID调用。数据库、后端权限和问卷策略保持原有约束。

## 3. 实际修复方案

新增apps/web/src/uuid.ts。原生randomUUID存在时继续使用；否则调用getRandomValues获得16字节安全随机数，设置UUID v4版本及变体位，再输出标准UUID字符串。没有使用Math.random或递增序号替代UUID，接口和数据库校验无需放宽。若极旧浏览器连安全随机数来源都没有，则明确失败，不伪造标识。

复制按钮优先使用浏览器剪贴板API。不可用或拒绝权限时，选中原有只读链接框，提示“链接已选中，请长按或使用系统菜单复制”。该提示表示需要用户手动完成复制，不虚报已写入系统剪贴板。

## 4. 修复后的验证

| 检查                  | 实际结果                                                                                                                    |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 单元/API及真实MongoDB | 94通过，0失败；新增4项UUID测试                                                                                              |
| TypeScript及生产构建  | 通过                                                                                                                        |
| 全部浏览器流程        | 19通过，0失败、0flaky；入口为真实局域网HTTP                                                                                 |
| 新增兼容完整流程      | 四类题、初始/新增选项、三类跳转规则、保存刷新、预览、发布、二维码、复制降级、填写、确认、修改原卷、统计均通过；无页面JS异常 |
| 手机布局              | 390×844，无横向溢出；分享页截图已实际查看                                                                                   |
| HTTP生产冒烟          | 通过                                                                                                                        |
| 当前3000端口          | 页面和健康接口200，已加载包含随机数回退及复制提示的新JS资源                                                                 |

新增用例为tests/e2e/browser-compat.spec.ts，使用Chrome、手机视口、触控和微信UA。为确保默认localhost运行时也覆盖回退分支，该用例显式禁用randomUUID及clipboard；本轮实际HTTP入口中这两项原本就不可用。其余18条流程也改在实际局域网HTTP入口重新执行。

复现本轮浏览器检查的命令：

```powershell
npm.cmd test
npm.cmd run build
$env:PLAYWRIGHT_TEST_ORIGIN='http://172.25.23.29:3010'
npm.cmd run test:e2e
Remove-Item Env:PLAYWRIGHT_TEST_ORIGIN
npm.cmd run smoke
```

3010为独立测试服务，测试数据库限定questionnaire_test；用户实际数据所在的questionnaire_stage1没有作为清理对象。IP随网络变化时，应使用电脑当前可访问的IPv4。PLAYWRIGHT_TEST_ORIGIN只改变测试入口，不改变网站.env。

证据：[单元/API结果](test-evidence/unit-api-results.json)、[浏览器结果](test-evidence/browser-results.json)。当前验证不是直接操控用户的iPhone微信，未安装或宣称运行WebKit/iOS真机；用户仍需关闭旧微信网页并重新打开新页面确认真机效果。用户截图已证明手机能够连接该局域网网站，本次修复针对页面运行时兼容问题。

## 5. 微信重新验证步骤

1. 先保存仍可保存的修改，关闭微信中的旧网页窗口。
2. 重新打开http://172.25.23.29:3000/dashboard?v=20261021-wechat，必要时重新登录。
3. 新建问卷，依次点击单选、多选、文本和数字；确认目录计数增加，并能编辑保存。
4. 添加选项和跳转规则，预览后发布；确认填写、提交和修改正常。
5. 分享页点击复制时，如显示链接已选中，则长按链接使用微信/系统菜单复制，也可直接保存二维码。

已保存的原问卷和用户账号不需要删除或重建；未成功添加的题目没有产生已保存记录。
