# 开发说明

## 技术与结构

项目使用 Node.js / Express、原生 HTML / CSS / JavaScript、yaml 文档节点、jsdiff 和 diff2html。没有前端构建步骤，第三方浏览器组件由本机依赖目录提供。

```text
server.js                 本机 HTTP 服务、请求检查、源码读取、部署状态
connection.js             系统与用户目录发现、连接设置持久化
config.js                 配置读取、补丁修改、预览、备份及恢复
review-diff.js            从预览的原始字节生成文件差异
file-transactions.js       受限路径的文本／二进制资源预览、备份与恢复
library.js                词库头部、依赖关系、词条查询与个人文本编辑
packages.js               精选仓库下载、文件筛选、来源记录与更新保护
public/library-view.js    方案与词库界面
plum.js                   固定安装器、配方校验、受限执行与暂存输出
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

静态前端文件刷新即生效；后端模块和操作卡内容在启动时加载，修改后需要重启服务。启动器固定使用 4319 端口；调试自定义端口使用终端启动。

测试覆盖：补丁语义、注释保留、继承、字段校验、只读预览、精确恢复、外部变化、符号链接、重复覆盖、差异字节重建、HTML 文本转义、符号查询和推荐按法。

## 写入边界

`config.js` 用字段白名单把控件映射到固定文件和路径。不要开放任意文件写入或任意 YAML 路径 API。

预览保存服务器侧 ID 与版本指纹；应用之前重新检查配置版本。每个目标写入前再核对原始文本。单个文件通过临时文件加重命名替换，多文件失败时尽力恢复已经写入的文件；这不等于文件系统级多文件事务。

备份记录原始文本和修改后哈希。恢复要求相关文件仍匹配修改后哈希；不自动覆盖后续工作。

## HTTP 接口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/health` | 服务身份及进程健康信息 |
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


## 方案与词库接口

新增只读接口：`GET /api/library`、`/api/library/dictionary?file=&q=&offset=`、`/api/library/phrases?schema=`、`/api/library/personal?schema=`、`/api/packages`、`/api/packages/download/:id`。

新增写请求：`POST /api/library/phrases/preview`、`/api/library/personal/preview`、`/api/packages/download`。同样要求来源检查、写令牌和 `connectionId`；通用 `/api/apply`、`/api/restore` 接收服务端预览和备份 ID。没有任意文件写入、任意远程仓库或 Shell 接口。

下载只允许代码目录中的雾凇和白霜，通过 Git 下载到 `.data/packages/` 下的独立缓存，取得准确提交后筛选数据文件。不执行上游 recipe 脚本。完整原仓库及许可证留在缓存中，用户目录写入 `.rime-studio-packages.json` 记录来源和已安装哈希。更新时若文件偏离上次安装哈希，保留原文件，并保持旧文件基线以便下次仍能识别冲突。

资源事务只允许普通文件和真实父目录，拒绝路径穿越、符号链接及特殊文件。文本使用 UTF-8，模型和 OpenCC／Lua 数据使用二进制字节；总修改量上限 120 MB。存在性独立于空文本记录。基础词库依赖和未改动方案文件也绑定预览哈希，保存前再核对。Rime 会话状态 `user.yaml` 与安装标识 `installation.yaml` 不参与设置版本指纹。

较大文本（两侧合计超过 64 KB 或 2000 行）及二进制文件只发送摘要；完整数据留在服务端预览和备份中。资源事务与原设置保存共享 `ConfigStore.busy`，下载期间阻止切换目录和保存／恢复／部署。多文件写入失败会尽力回滚，仍不等于文件系统事务；原始备份保留供排查。

Rime 词库的 `import_tables` 不能依赖多层聚合入口自动递归展开。个人扩展显式展开引用链，保留基础入口的编译设置和用户学习词典名称；不改变上游词库。真实隔离编译和候选验证记录见 `验收记录.md`。


## plum 适配

`POST /api/packages/download` 增加 `{recipe, mode:"full", enable:false}`。仍要求写令牌和连接 ID，复用下载任务、预览、应用及恢复接口。原 `{package:"ice"|"frost", ...}` 不变。配方字符串解析为参数数组，拒绝终端命令、URL、路径穿越、外部 `.conf` 和 `plum` 自更新。

安装器固定在 `b1be1969f914cc005add4090631b855db00c2591`，每个任务在独立缓存获取该提交，并显式设置 `plum_dir`、`rime_dir` 和临时目录。仅复制所选配置与内置目录的顶层 YAML 作为补丁输入，不复制学习数据库、个人短语和词条数据。执行前后的配置存在性与哈希绑定到预览。

macOS `sandbox-exec` 约束普通文件写入为任务目录，保护用户目录、卷目录及所选 Rime 用户目录的数据读取；`/dev` 用于标准输入输出。路径先取真实路径，避免 `/var` 与 `/private/var` 等别名绕开规则。子进程不继承服务端环境或用户 Git 凭据配置；禁用 Git hooks、本地文件及 ext 协议。保留系统工具／证书读取和网络访问。这是文件访问约束，不是虚拟机或对任意恶意脚本的完整隔离承诺。系统缺少该能力时失败，不回退到无约束执行。

超时／输出超限会终止任务进程组。输出拒绝符号链接、特殊文件、配置标量及被删除的初始配置；只导入支持的 YAML、TXT、Lua、JSON、GRAM、DB、OCD／OCD2 数据文件。保存遵循现有 500 文件／120 MB 上限。安装记录保存安装器提交、配方数组、所有来源仓库提交和最终文件哈希。

白霜 README 指定 `others/recipes/full`，而非裸仓库安装。裸 `gaboolic/rime-frost` 或 `@master` 解析到该完整配方；显式指定的分支和其他配方不改写。不再进行笼统的已知仓库文件补齐，plum 输出遵循选定配方。多个安装方式共享最新安装基线，避免切换方式后覆盖本地修改。安装记录自身在界面显示摘要，完整内容仍进入备份。

配置控件仍只支持常见 Rime 配置子集，不能完整解释任意 `__patch`／配方逻辑；高级配方的最终效果以真实编译配置为准。配方准备成功不是编译或输入效果验收。
