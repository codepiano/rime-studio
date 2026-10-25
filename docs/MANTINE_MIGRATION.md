# Mantine 基础控件迁移验收

日期：2026-10-25。基线：`1fc2ddb`。开发分支：`codex/mantine-controls`。本次只提交，不合并 main、不部署。

## 版本与兼容性

原项目没有 React、React DOM 或 React 类型包，使用原生 JavaScript 控制器和 HTML 模板。本次引入并精确锁定：

| 依赖 | 版本 |
| --- | --- |
| @mantine/core、@mantine/hooks | 9.7.3 |
| react、react-dom | 19.3.1 |
| @types/react、@types/react-dom | 19.3.0 |
| Vite、React 插件 | 8.3.5、6.1.2 |
| TypeScript | 7.0.2 |

执行时通过 npm registry 的 latest dist-tag 确认 Mantine 9.7.3 为稳定版；peer dependencies 要求 React / React DOM ^19.2.0 和 hooks 9.7.3，当前安装树满足要求，无重复 React。官方资料：[React 要求](https://mantine.dev/changelog/9-0-0/)、[按组件加载 CSS](https://mantine.dev/styles/mantine-styles/)。构建工具要求 Node >=22.12，已同步 package engines、初始化检查和说明。

## 改动范围

- 建立 `frontend/ui` 公共组件入口、橄榄绿主题、CSS 依赖入口和集中集成样式，保留纸色背景、字体、侧栏、卡片、页面结构及原有业务控制器。
- 所有页面的模板绘制显式进入 React 渲染层。按钮使用 Button / UnstyledButton，文字与数字字段使用 TextInput，多行字段使用 Textarea，选择框使用 NativeSelect，勾选与开关使用 Checkbox / Radio / Switch；弹窗使用 Modal。没有通过 DOM 观察器或修改 innerHTML 原型事后装饰控件。
- 保留 id、name、data 属性、原生提交、FormData、非受控字段值和原有事件处理；嵌套根在重画前从内到外卸载。原生 range、file 和 hidden 字段保留原有语义。
- 当前没有业务抽屉或原生 radio 界面，公共层提供 Drawer / Radio 并通过浏览器验收，没有为了使用新组件改变现有页面行为。
- NativeSelect 的右侧箭头区域统一为 36px，选择框宽度与箭头容器保持一致。清除旧自绘开关、原生 dialog 与 select 箭头规则；修正 Mantine 默认行高和按钮高度对原有布局的影响，给差异预览建立弹层内的定位边界。
- Vite 生成 dist，Express 优先提供构建产物。安装及发布 prepare 接入构建、发布产物包含 dist，本次未执行发布操作。diff2html 专用路由保持原样，因此 Vite 会提示其 JS / CSS 由运行时提供；浏览器请求和差异预览已验证。
- body-parser 的锁定间接版本同步到安全补丁版本，生产依赖审计为零漏洞。

## 隔离与验收

开发位于独立 Git worktree，依赖实际安装于该目录，无指向原项目依赖或构建输出的链接。原项目 `main` 保持 `1fc2ddb`，原目录工作区没有改动。正式清单端口 4312 在开始和结束检查时均未监听，没有为验证启动、停止或重启正式服务。

`npm run test:ui` 自动创建临时用户配置、共享配置、数据及源码目录，分配独立回环端口，设置 RIME_DISABLE_DEPLOY=1，使用独立无头 Chrome 进程、上下文和存储。完成后终止自身服务、删除临时数据；未连接、导航或刷新个人浏览器标签页。另用临时原版副本在独立端口截图对照布局。

通过检查：

- `npm run typecheck`：新增公共 React 层、构建配置与 UI 测试的严格类型检查；既有 JS 控制器没有整体改写为 TypeScript。
- `npm run build`：生产构建通过，按实际控件和依赖加载 CSS，没有引入全量 Mantine CSS。
- `npm test`：136/136 项原有业务测试通过。
- `npm run test:ui`：4/4 条桌面端到端流程通过，覆盖开关、滑块键盘调整、下拉选择、快捷键勾选、待应用清单、差异预览、保存、API / 文件 / 刷新读回；多页导航、搜索快捷键、文字转换提交；长选项、36px 箭头区域与边界断言、原生选单键盘首字母选择、禁用字段 / 勾选 / 按钮、radio 分组与 FormData；Modal / Drawer 焦点约束、Escape、焦点返回；快捷短语输入采集、增删行、预览与备份保存。
- 人工查看桌面截图：连接、方案与词库、输入诊断、方案结构、指南、文字工具、设置、设置差异弹层、短语差异弹层、公共控件状态和抽屉。检查文字、图标、箭头、焦点、长内容、弹层裁切与边界。
- `git diff --check` 通过。未测试移动端；未执行真实输入法重部署、外网方案下载、真实学习数据库写入或正式发布。

## 包体积

以基线 public 下应用 JS/CSS 对比生产 dist/assets 中全部 JS/CSS，gzip 按每个 HTTP 资源分别压缩后求和。单位为十进制 KB；排除 HTML、favicon、source map。保留既有 vendor 文件并在第二组同口径计入。gzip 是离线压缩统计，当前 Express 未新增传输压缩中间件。

| 口径 | 迁移前原始 / gzip | 迁移后原始 / gzip | 增量原始 / gzip |
| --- | --- | --- | --- |
| 应用 JS/CSS | 179.735 / 60.424 KB | 598.752 / 169.575 KB | +419.017 / +109.151 KB |
| 含既有 diff2html vendor | 274.813 / 83.170 KB | 693.830 / 192.321 KB | +419.017 / +109.151 KB |

首次引入 React 与 Mantine 导致总量增加；当前应用 CSS 约 109.87 KB（gzip 19.26 KB），其余为 React/Mantine 入口与业务控制器两个 JS 块。可复算：`node scripts/bundle-size.mjs 1fc2ddb`。
