import type { DeveloperCommand, CommandRisk } from './developer-commands'

// 语法来源与核对范围见 docs/developer-command-library-verification.md。
type Preset = [id: string, title: string, command: string, description: string, risk?: CommandRisk]
const docker: Preset[] = [
  ['containers', '查看所有容器', 'docker ps -a', '列出运行中和已停止的容器'],
  ['images', '查看本地镜像', 'docker image ls', '列出镜像名称、标签与大小'],
  [
    'logs',
    '跟踪容器日志',
    'docker logs --tail 100 -f <容器名>',
    '输出最近 100 行并持续跟踪；Ctrl+C 结束查看'
  ],
  [
    'exec',
    '进入容器终端',
    'docker exec -it <容器名> sh',
    '容器需正在运行且包含 sh；进入后操作可能修改容器',
    'write'
  ],
  ['start', '启动已有容器', 'docker start <容器名>', '启动已创建的容器', 'write'],
  ['stop', '停止容器', 'docker stop <容器名>', '停止指定容器，会中断其中的服务', 'write'],
  ['restart', '重启容器', 'docker restart <容器名>', '停止后重新启动，会短暂中断服务', 'write'],
  ['ports', '查看容器端口映射', 'docker port <容器名>', '查看容器端口映射到宿主机的地址和端口'],
  ['stats', '查看容器资源占用', 'docker stats', '实时查看 CPU、内存和网络；Ctrl+C 结束查看'],
  ['space', '查看 Docker 磁盘占用', 'docker system df', '查看镜像、容器和卷使用的空间'],
  [
    'inspect',
    '查看容器详细配置',
    'docker inspect <容器名>',
    '输出 JSON 配置，可能含环境变量，分享前注意脱敏'
  ],
  [
    'build',
    '构建项目镜像',
    'docker build -t <镜像名>:<标签> .',
    '在含 Dockerfile 的目录运行；可能执行其中的构建步骤',
    'write'
  ],
  ['compose-ps', '查看 Compose 服务状态', 'docker compose ps', '在含 compose.yaml 的项目目录运行'],
  [
    'compose-up',
    '后台启动 Compose 服务',
    'docker compose up -d',
    '创建并启动项目服务，可能重建已变更容器',
    'write'
  ],
  [
    'compose-logs',
    '跟踪 Compose 服务日志',
    'docker compose logs --tail 100 -f <服务名>',
    '查看指定服务最近日志并持续跟踪'
  ],
  [
    'compose-rebuild',
    '重建并启动 Compose 服务',
    'docker compose up -d --build <服务名>',
    '重新构建镜像并更新服务，可能中断服务',
    'write'
  ],
  [
    'compose-stop',
    '停止 Compose 服务',
    'docker compose stop',
    '保留容器，停止当前项目服务',
    'write'
  ],
  [
    'compose-down',
    '移除 Compose 容器和网络',
    'docker compose down',
    '停止并移除项目容器和网络，容器可写层会丢失；此处未使用 -v',
    'destructive'
  ]
]
const linux: Preset[] = [
  ['pwd', '查看当前目录', 'pwd', '显示当前工作目录的完整路径'],
  ['list', '查看目录文件', 'ls -lah', '显示隐藏文件、权限和易读大小'],
  [
    'find',
    '按名称查找文件',
    'find . -type f -name "<文件名模式>"',
    '在当前目录递归查找；模式例如 *.log'
  ],
  [
    'grep',
    '递归搜索文本',
    'grep -rn -- "<关键词>" <目录>',
    '输出匹配文本的文件与行号；关键词按正则解释'
  ],
  [
    'tail',
    '实时跟踪文件日志',
    'tail -n 100 -f <日志路径>',
    '显示最后 100 行并持续跟踪；Ctrl+C 结束'
  ],
  ['head', '查看文件开头', 'head -n 50 <文件路径>', '查看前 50 行'],
  ['disk', '查看磁盘空间', 'df -h', '查看挂载文件系统的已用与可用空间'],
  ['directory-size', '查看目录占用', 'du -sh <目录>', '汇总指定目录大小，可能需要读取大量文件'],
  ['processes', '查看进程列表', 'ps aux', '适用于常见 Linux procps；可查看 CPU 与内存占用'],
  ['ports', '查看监听端口', 'ss -lntp', 'Linux iproute2；显示 TCP 监听，进程信息可能需要额外权限'],
  ['pid', '按名称查找进程', 'pgrep -af <进程名>', 'Linux procps；显示命令行，分享前检查敏感参数'],
  [
    'permission',
    '为脚本增加执行权限',
    'chmod u+x <脚本路径>',
    '只给文件所有者增加执行权限，不会运行脚本',
    'write'
  ],
  [
    'archive',
    '打包目录为 tar.gz',
    'tar -czf <归档名>.tar.gz <目录>',
    'GNU tar；会写入或覆盖同名归档文件',
    'write'
  ],
  [
    'extract',
    '解压 tar.gz 到指定目录',
    'tar -xzf <归档名>.tar.gz -C <目标目录>',
    'GNU tar；目标目录需已存在，只解压可信归档，可能覆盖文件',
    'write'
  ],
  [
    'services',
    '查看 systemd 服务状态',
    'systemctl status <服务名>',
    '仅适用于使用 systemd 的 Linux；按 q 退出分页'
  ],
  [
    'journal',
    '跟踪 systemd 服务日志',
    'journalctl -u <服务名> -n 100 -f',
    '需要 systemd 和日志读取权限；Ctrl+C 结束'
  ]
]
const git: Preset[] = [
  ['status', '查看 Git 工作区状态', 'git status --short', '查看暂存、未暂存与未跟踪文件'],
  ['diff', '查看未暂存差异', 'git diff', '与暂存区比较工作区内容'],
  ['staged', '查看已暂存差异', 'git diff --cached', '查看准备提交的改动'],
  ['branches', '查看本地和远程分支', 'git branch -a', '远程分支列表以本地已获取信息为准'],
  [
    'switch',
    '切换已有分支',
    'git switch <分支名>',
    '切换工作区分支；存在冲突修改时 Git 会拒绝',
    'write'
  ],
  ['log', '查看最近提交', 'git log --oneline -20', '以简短格式显示最近 20 条提交'],
  [
    'stash',
    '临时保存工作区修改',
    'git stash push -u -m "<备注>"',
    '保存并移走修改及未跟踪文件；不包括忽略文件',
    'write'
  ],
  ['stash-list', '查看临时保存列表', 'git stash list', '查看 stash，不恢复或删除任何记录'],
  ['show', '查看某次提交的改动', 'git show <提交哈希>', '查看提交信息与差异'],
  ['file-log', '查看文件提交历史', 'git log --oneline -- <文件路径>', '查看影响指定文件的提交']
]
const npm: Preset[] = [
  ['scripts', '查看项目 npm 脚本', 'npm run', '在项目目录查看 package.json 中的 scripts'],
  ['dependencies', '查看顶层依赖', 'npm ls --depth=0', '列出项目直接依赖与版本'],
  [
    'install',
    '安装项目依赖',
    'npm install',
    '可能更新锁文件并执行依赖安装脚本，仅用于可信项目',
    'write'
  ],
  [
    'ci',
    '按锁文件安装依赖',
    'npm ci',
    '先移除现有 node_modules，再按锁文件安装；可执行安装脚本',
    'destructive'
  ],
  ['outdated', '查看可更新依赖', 'npm outdated', '联网查询版本，不自动升级依赖'],
  ['cache', '校验 npm 缓存', 'npm cache verify', '校验并整理缓存，可能清理无用缓存内容', 'write']
]

/** 固定 ID 随升级保留；正文不是执行脚本，内置条目不写入用户 kv。 */
export const DEVELOPER_COMMAND_PRESETS: readonly DeveloperCommand[] = [
  ...docker.map((item) => makePreset('docker', 'Docker', item)),
  ...linux.map((item) => makePreset('linux', 'Linux', item)),
  ...git.map((item) => makePreset('git', 'Git', item)),
  ...npm.map((item) => makePreset('npm', 'Node.js／npm', item))
]

function makePreset(group: string, category: string, item: Preset): DeveloperCommand {
  const [id, title, command, description, risk = 'read'] = item
  return {
    id: `builtin:${group}-${id}`,
    title,
    command,
    description,
    category,
    shell: group === 'linux' ? 'bash' : 'any',
    risk,
    tags: group === 'linux' && id === 'ports' ? [group, '端口占用'] : [group],
    archivedAtMs: null
  }
}
