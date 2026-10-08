# 开发说明

## 技术与结构

项目使用 Node.js / Express、原生 HTML / CSS / JavaScript、yaml 文档节点、jsdiff 和 diff2html。没有前端构建步骤，第三方浏览器组件由本机依赖目录提供。

```text
server.js                 本机 HTTP 服务、请求检查、源码读取、部署状态
connection.js             系统与用户目录发现、连接设置持久化
config.js                 配置读取、补丁修改、预览、备份及恢复
review-diff.js            从预览的原始字节生成文件差异
content.js                按使用目的整理的操作卡与组件说明
public/app.js             页面、导航、控件与操作卡
public/forget-demo.js     误选词移除教学练习
public/symbols.js         已部署标点映射的反向查询
public/style.css          界面样式
test/                     配置、文件差异、符号反查测试
research-snapshots.json   固定提交的公开上游调研文件
.data/                    本地运行数据与个人配置备份，不提交
```

## 本地开发

```bash
npm ci
npm test
npm start
```

静态前端文件刷新即生效；后端模块和操作卡内容在启动时加载，修改后需要重启服务。启动器与生命周期脚本共用清单端口 4312；调试自定义端口使用终端前台启动。

测试覆盖：补丁语义、注释保留、继承、字段校验、只读预览、精确恢复、外部变化、符号链接、重复覆盖、差异字节重建、HTML 文本转义、符号查询和推荐按法。

## 写入边界

`config.js` 用字段白名单把控件映射到固定文件和路径。不要开放任意文件写入或任意 YAML 路径 API。

预览保存服务器侧 ID 与版本指纹；应用之前重新检查配置版本。每个目标写入前再核对原始文本。单个文件通过临时文件加重命名替换，多文件失败时尽力恢复已经写入的文件；这不等于文件系统级多文件事务。

备份记录原始文本和修改后哈希。恢复要求相关文件仍匹配修改后哈希；不自动覆盖后续工作。

## HTTP 接口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/health` | 服务身份及进程健康信息 |
| GET | `/control-panel/metrics` | 服务自身状态、PID、运行时长及内存字节数 |
| GET | `/api/state` | 配置、方案、知识卡、历史、写入令牌与部署状态 |
| POST | `/api/connection` | 校验并保存所选目录，或恢复自动检测；不写 Rime 配置 |
| POST | `/api/preview` | 校验修改，返回精确文件差异；不写配置 |
| POST | `/api/apply` | 按预览 ID 保存并备份 |
| POST | `/api/restore` | 按记录 ID 恢复配置 |
| POST | `/api/deploy` | 请求鼠须管重载并观察编译产物 |
| GET | `/api/deployment` | 部署检查状态 |
| GET | `/api/source` | 读取白名单内的固定提交源码文件 |

写请求要求 `x-rime-token`。配置修改请求还要求当前连接的 `connectionId`，跨目录或缺少身份的请求被拒绝。自动检测到的候选必须确认后才能写入；启动环境变量属于显式指定。服务检查本机 Host 与 Origin，不允许任意外部来源。令牌随进程生成，不写入仓库。不应绕过这些边界把服务作为公网管理接口。

## 隔离开发

修改读写逻辑时，使用独立用户目录与工作台数据目录，不对日常输入目录试写。

```bash
RIME_USER_DIR=/absolute/path/to/rime-fixture \
RIME_SHARED_DIR=/absolute/path/to/shared-config \
RIME_STUDIO_DATA_DIR=/absolute/path/to/studio-test-data \
RIME_DISABLE_DEPLOY=1 \
PORT=4320 npm start
```

内置默认服务仍是 macOS 布局。覆盖目录适合验证配置逻辑，不代表已支持其他平台客户端部署。

正式扩展复杂继承、列表操作、模糊音、词库或插件之前，应增加真实 Rime 的隔离编译验证。JavaScript 读取器只支持常见子集，不能替代完整编译器。

## 资料快照

`research-snapshots.json` 各条目保存固定提交和原始文件。服务优先读取它；找不到快照时才尝试 `RIME_SOURCE_DIR` 下对应的 Git 仓库。

上游原文与代码不属于本项目原创代码，授权范围见根目录 `THIRD_PARTY_NOTICES.md`。更新快照应记录提交、保留原文及许可证，并重新核实引用卡片的版本适用性。

## 贡献

针对具体问题提交 issue 或 PR，注明运行环境、鼠须管版本、重现方法和预期行为。配置示例使用最小匿名片段，不提交真实词库、备份、安装标识、个人短语或访问令牌。

提交前运行适当测试与 `git diff --check`。界面修改还应核对桌面、小屏、键盘操作和可见状态。保持“待应用、已保存、部署请求、已观察到编译更新、实际输入效果”各自清晰。
