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
public/phrase-format.js   前后端共享的短语解析、重码检查与原格式保留
public/tools-view.js      系统词典和 OpenCC 工具箱界面
system-dictionary.js      本机词典辅助程序构建、输入验证与查询
native/system-dictionary.c macOS Dictionary Services 纯文本查询
text-tools.js             固定模式、长度上限与 OpenCC 转换
search.js                 来源明确的个人词条／短语／已加载学习记录搜索
diagnosis.js              诊断校验、资源隔离、原生助手与返回验证
native/input-diagnosis.m  librime 公共接口的编译、会话、候选试输
deployment.js             编译观察、待部署范围和固定短语核对
public/search-view.js     顶部词条搜索与来源导航
public/diagnosis-view.js  输入诊断表单、检查和候选显示
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
| GET | `/api/tools` | 系统词典平台支持、转换模式与输入上限 |
| POST | `/api/dictionary/query` | `{term}` 查询本机系统词典 |
| POST | `/api/tools/convert` | `{text, mode}` 离线繁简及地域用词转换 |

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


## 学习词典与独立词库管理

`learned.js` 使用检测到的 `rime_dict_manager`，学习数据不混入个人静态词库。`GET /api/learned` 查询缓存；`POST /api/learned/refresh` 刷新所有词典；`POST /api/learned/preview` 预览选择删除或清空单个词典；`GET /api/learned/export` 导出查询结果。学习预览由通用 apply/restore 接口处理，要求连接身份与写令牌。学习词典读取不发起网络请求。

`native/db-lock.c` 以 POSIX fcntl 锁使用 LevelDB 的 LOCK 文件。在同一进程锁下通知 Node 备份，然后 exec 官方导入工具，使原生工具继承锁的进程身份。删除使用官方负提交次数语义，保留其他学习参数。恢复在同一锁下替换数据库文件，保留 LOCK inode；使用完整快照哈希检查删除／恢复前后的所有学习参数。原始数据库备份包含 tombstones、tick 与动态值；禁止仅靠普通文本词频导入冒充完整恢复。

读取先用只读导出取得原用户身份，再在私有工作目录建立受控数据库别名和同步路径，获取官方完整快照；避免改动真实同步目录。数据库目录、LOCK、内部文件及用户身份路径均校验，拒绝符号链接或特殊文件。占用时退回可用同步快照，显示时间且禁止写入；源快照只读。备份上限每个数据库 256 MB／1000 文件，读取快照上限 32 MB。

预览最多选择 1000 条，清空单个词典最多 100000 条。操作共享 ConfigStore 的忙状态；预览与保存再次检查快照哈希。多词典失败尝试只回滚与本次删除相容的变化；不覆盖额外学习。未确认回滚保存 durable pending/uncertain 记录，不自动重复删除，恢复时重新核对。进程恢复和多文件事务不能等同于数据库跨词典原子事务。

原生退出／启动接口 `/api/learned/lifecycle` 只对已确认原生目录开放，`RIME_DISABLE_DEPLOY=1` 禁用。退出通过 Cocoa 的 cooperative terminate，按检测到的可执行程序路径匹配，不使用 killall 或强制停止；启动使用已检测应用路径。副本目录不控制系统输入法。

`dictionary-management.js` 管理 `.rime-studio-dictionaries.json` 和按方案生成的独立扩展入口，复用个人词库入口。导入接口 `/api/library/install/preview` 单独设置 25 MB JSON 解析上限，原接口仍为 150 KB。启停／卸载接口 `/api/library/manage/preview` 校验普通源码词库、依赖、主词库与共享目录边界；`GET /api/library/references` 返回已知引用。删除使用资源事务的 afterExists=false，不仅清空文件内容。

引用集合来自源配置、已部署配置和直接 import_tables，不能完整解释任意 Lua 或高级配置逻辑；失败时保守拒绝删除。停用状态在后续个人词条编辑时保留。安装／删除均绑定来源字节哈希、配置版本和管理记录，源词库变化使预览失效。

`POST /api/learned/sync` 只对已确认原生目录开放，沿用连接身份、写令牌和忙状态保护，`RIME_DISABLE_DEPLOY=1` 禁用。调用检测到的 Squirrel `--sync` 通知原生用户资料同步（可能按 Rime 规则合并已有同步资料），轮询快照的哈希和修改时间；连续稳定观察到更新才返回 observed，超时返回 unconfirmed。快照始终只读，不能作为已释放数据库或同步任务完全结束的证据。查询 coverage 区分直接读取、快照、不可用与尚未读取，避免旧快照冒充实时总量。

## 短语管理和文字工具

`GET /api/library/phrases?schema=&file=` 只接受所选方案已引用的固定文本表；未接入时目标文件由方案 ID 派生。读取与接入使用保存的源配置，支持 `tabledb` 和 `stabledb`，优先选择名字中包含 phrase 的翻译器。首次接入创建 `studio_phrases`，使用 stabledb、禁止造句／补全和 initial_quality=99；不改动主词库或学习数据库。

短语读取返回文件存在性、内容哈希、配置 revision、表选择与共用方案。预览核对这些状态；用户文件缺失时还绑定共享文件的存在性与哈希，避免上游改变后被旧预览静默遮盖。使用原资源事务应用、备份和恢复。前后端共享 `public/phrase-format.js`，按原行身份编辑，保留 BOM、注释、空行、LF／CRLF、可选第三列与末尾换行状态；新条目沿用原文件换行方式。同码候选允许，重复文本和编码拒绝。

浏览器短语草稿只保存在模块内存，按连接、方案和文件隔离；刷新浏览器不保证保留。读取时文件或配置变化，会显示新内容并提供旧草稿导出。导入使用 UTF-8 fatal 解码；空编辑行忽略，后端重新执行格式、重复、条数、字节数和路径校验。

文字工具两个 POST 接口同样要求 Host、Origin 和写令牌，独立于 Rime 连接，不写配置／词库。系统词典最多 120 个 UTF-16 单位、单行字词，通过 execFile 的独立参数调用固定本机程序，无 Shell。`native/system-dictionary.c` 调用公开 Dictionary Services API，使用 CFString 长度作为 UTF-16 范围，返回首个匹配记录的纯文本；退出码 3 表示未找到。首次查询以 clang 构建，按源码 SHA-256 和 CPU 架构缓存到工作台数据目录，失败可重试；不打包系统词典数据。查询有 10 秒超时和 1 MB 输出上限。

OpenCC 使用固定 `opencc-js 1.4.2` 及包内字典，8 种白名单模式、30,000 个 UTF-16 单位上限，转换器按模式复用。文本不持久化、不记入日志、不调用外部网络。前端查询／转换使用请求序号，防止页面切换后的旧请求覆盖新结果；修改原文或模式立即使结果失效。系统词典缺少工具或词条和转换结果无需变化分别显示明确状态。

## 统一搜索与隔离输入诊断

`search.js` / `GET /api/search?q=&connectionId=` 查找所有方案的个人扩展词库、源配置挂载的固定短语表及 `LearnedManager.cache` 中已加载的有效记录。请求与连接 ID 绑定；不触发学习数据库读取或同步。个人词库搜索上限 1 MB，短语 100 KB；最多返回 120 个匹配，部分来源失败和超限会显示告警。多个方案共用短语表时只扫描一次。结果保留文件、方案、来源、学习读取时间和导航目标。操作卡、设置及已部署符号反查继续在前端搜索；页面切换后过期响应不再绘制。

`diagnosis.js` / `POST /api/diagnosis` 接收 `{schema, code, expected?}`，要求令牌、确认连接及连接 ID。按键限 80 个可打印 ASCII 字符，空格作为实际选词键；期望词条限 100 个字符。静态检查菜单、编译记录、字母表、词库递归导入、短语挂载与期望词的来源，再通过 `native/input-diagnosis.m` 动态加载检测到的本机鼠须管 librime 公共接口，隔离编译并运行真实会话。返回至多 100 个候选、评论、预编辑、提交文本和逐键处理结果。

资源复制到真实路径的临时目录，共享文件先复制、用户文件覆盖。排除真实 `.userdb`、同步、身份、隐藏文件及用户目录的旧编译产物；共享预编译二进制词库允许复用。上限为 512 MB／2000 文件／6 层目录。源资源清单、字节哈希与配置版本在返回前再次核对。试输强制中文和半角，不使用真实学习数据库或实际应用按键事件；Lua 只在受限子进程中运行。

macOS `sandbox-exec` 阻止网络、额外程序执行、临时目录之外写入，以及用户目录、卷目录、原 Rime 目录的数据读取。只允许助手、临时资源和已检测应用的 Frameworks；路径取真实路径。助手执行有 60 秒／2 MB 输出限制，超限终止进程组，结束后清理临时目录并释放配置操作锁。不支持的系统或缺少 clang／引擎时明确失败，不回退为无约束执行。该机制仍不是虚拟机，特殊扩展不保证兼容。

## 学习请求顺序与部署依据

学习界面以递增请求号接受最新查询；刷新、同步使旧查询失效。查询期间禁止对旧结果删除，当前查询失败时清除旧行；过期响应、过期错误和已离开的视图不会覆盖结果或通知。

`deployment.js` 观察编译配置的源文件／自定义文件时间及整个 build 产物的大小、mtime、ctime，连续稳定两次才确认观察到编译更新。保存／恢复记录待部署文件及哈希到对应备份目录的 `pending-deployment.json`，重启仍保留待部署提示；学习删除不记录为需要部署。

固定短语表变更可能完全不改写编译 YAML。仅此类资源待部署时，会核对文件哈希、方案挂载和隔离会话中的样本候选，返回 `resources-checked`；不把没有 YAML 更新视为失败，也不宣称系统输入法的真实会话已生效。新编译产物的 `verified` 同样只确认编译观察。没有足够依据、资源后续变化或编译未完成时保留待部署记录及明确状态。
