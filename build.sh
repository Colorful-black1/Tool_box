#!/usr/bin/env sh
#
# 构建脚本：桌面端安装包 + 手机端 APK
#
# 用法：
#   ./build.sh pc              桌面端 → Windows 安装包（release/私人百宝箱 Setup x.x.x.exe）
#   ./build.sh pc --dir        桌面端 → 只出免安装目录（release/win-unpacked），快很多，适合先验证
#   ./build.sh android         手机端 → arm64-v8a 的 release APK（推荐，只打一个 ABI 快 4 倍）
#   ./build.sh android --all   手机端 → 四个 ABI 全打（armeabi-v7a / arm64-v8a / x86 / x86_64）
#   ./build.sh all             两端都打
#
# Windows 上用 Git Bash 跑：`sh build.sh pc`。若提示权限不足，用 `sh build.sh pc` 明确指定解释器。
#
# 首次安装（换机器必读，细节见 README「为什么不是普通 npm install」）：
#   npm install --ignore-scripts
#   node node_modules/electron/install.js
#   node node_modules/esbuild/install.js
#   node node_modules/vite/node_modules/esbuild/install.js
#   npm install --prefix mobile
#   cd mobile && npx expo prebuild --platform android    # 只在首次或改了 app.json 后需要
#
# 国内网络建议先设镜像（仅首次构建要下载 Electron 运行时与打包工具时用得上）：
#   export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
#   export ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
#
# 不要跑 `npm run rebuild`：better-sqlite3 13 用 Node-API 预编译，不需要按 ABI 编译，
# 跑了反而会因为缺 MSVC 而失败。打包已用 build.npmRebuild=false 跳过。

set -eu

# 以脚本自身位置为根，这样从任何目录调用都成立
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
MOBILE="$ROOT/mobile"

say() { printf '\033[1;33m==>\033[0m %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }
die() {
	printf '\033[1;31m错误:\033[0m %s\n' "$*" >&2
	exit 1
}

on_windows() {
	case "$(uname -s 2>/dev/null || echo unknown)" in
	MINGW* | MSYS* | CYGWIN* | Windows_NT) return 0 ;;
	*) return 1 ;;
	esac
}

require_node() {
	command -v node >/dev/null 2>&1 || die '找不到 node。请先安装 Node >= 20 并把它加进 PATH。'
	command -v npm >/dev/null 2>&1 || die '找不到 npm。'
	major=$(node -p 'process.versions.node.split(".")[0]')
	[ "$major" -ge 20 ] || die "需要 Node >= 20，当前是 $major。"
}

require_desktop_deps() {
	[ -d "$ROOT/node_modules" ] ||
		die '桌面端依赖未安装。请先在仓库根执行：npm install --ignore-scripts（细节见本文件头部）'
}

require_android_deps() {
	[ -d "$MOBILE/node_modules" ] ||
		die '手机端依赖未安装。手机端是独立包，请执行：npm install --prefix mobile'
	[ -d "$MOBILE/android" ] ||
		die 'mobile/android 不存在。先执行一次：cd mobile && npx expo prebuild --platform android'

	# 环境变量是「终端级」的：装完 JDK / SDK 后，当前这个终端仍然读不到新值，
	# 必须重开一个终端。所以下面两条的报错都附带这句提醒 —— 这是最常见的坑。
	command -v java >/dev/null 2>&1 ||
		die '找不到 java。需要 JDK 17；若刚装完，请重开一个终端再试（环境变量是终端级的）。'
	[ -n "${JAVA_HOME:-}" ] ||
		die 'JAVA_HOME 未设置。Gradle 需要它，例如 export JAVA_HOME=/path/to/jdk17；若刚设过，请重开终端。'
	[ -n "${ANDROID_HOME:-}" ] ||
		die 'ANDROID_HOME 未设置。指向 Android SDK 根目录（含 platform-tools 与 ndk）；若刚设过，请重开终端。'

	# SDK 里没有 license 接受记录时 Gradle 会中途失败
	[ -d "$ANDROID_HOME/licenses" ] ||
		die 'Android SDK licenses 未接受。执行一次：sdkmanager --licenses'
}

# ---------- 桌面端 ----------

# electron-builder 打包桌面端时是两步：先把 Electron 运行时解压到
# release/win-unpacked.tmp，再 rename 成 release/win-unpacked。
# 若上一次的 win-unpacked 还在且被占用（正在运行的 exe、杀毒软件正在扫描刚解出的文件），
# 第二步就会 `EPERM: operation not permitted, rename ...` 而整个构建失败。
# 这两个目录每次构建都会重新生成，所以构建前直接清掉最省事。
# 注意只删这两个暂存目录，不动 release/ 下的安装包（*.exe）与 *.yml。
clean_desktop_stage() {
	[ -d "$ROOT/release" ] || return 0
	for name in win-unpacked win-unpacked.tmp; do
		target="$ROOT/release/$name"
		[ -e "$target" ] || continue
		rm -rf "$target" 2>/dev/null || true
		# 不依赖 rm 的退出码，直接确认目录真的没了（Windows 上 rm 常静默失败）
		if [ -e "$target" ]; then
			die "无法删除 release/$name —— 它正被占用。
    常见原因：release\\win-unpacked 里的「私人百宝箱.exe」还在运行，或杀毒软件正在扫描该目录。
    处理：关掉该程序后重试；仍失败就把 release 目录加入杀毒软件的排除项。"
		fi
	done
}

# 构建失败后，若留下 win-unpacked.tmp 基本可断定是上面那个 rename 被占用
report_desktop_failure() {
	if [ -d "$ROOT/release/win-unpacked.tmp" ]; then
		printf '\033[1;31m提示:\033[0m 残留 release/win-unpacked.tmp，说明 Electron 解压后的 rename 被占用。\n' >&2
		printf '      关闭 release\\win-unpacked 里的「私人百宝箱.exe」后重跑即可。\n' >&2
	fi
}

build_pc() {
	require_node
	require_desktop_deps
	clean_desktop_stage

	if [ "${1:-}" = '--dir' ]; then
		say '桌面端：打包免安装目录 → release/win-unpacked'
		if ! npm run --prefix "$ROOT" pack; then
			report_desktop_failure
			exit 1
		fi
		info '免安装目录可直接运行里面的 exe'
		return
	fi

	if ! on_windows; then
		die 'NSIS 安装包只能在 Windows 上构建（electron-builder --win nsis）。' \
			'在 Linux/macOS 上请改用：./build.sh pc --dir'
	fi

	say '桌面端：打包 Windows 安装包 → release/私人百宝箱 Setup x.x.x.exe'
	if ! npm run --prefix "$ROOT" dist; then
		report_desktop_failure
		exit 1
	fi

	setup=$(find "$ROOT/release" -maxdepth 1 -name '*Setup*.exe' 2>/dev/null | head -n 1)
	if [ -n "$setup" ]; then
		info "产物：${setup#"$ROOT"/}"
	else
		info '未找到安装包，请检查构建日志'
	fi
}

# ---------- 手机端 ----------

build_android() {
	require_node
	require_android_deps

	# Gradle 的启动脚本：Windows 用 .bat，其余用无后缀那个。
	# 必须带 ./ 前缀 —— 否则 bash 会去 PATH 里找而不是当前目录。
	if [ -f "$MOBILE/android/gradlew.bat" ] && on_windows; then
		gradlew='./gradlew.bat'
	else
		gradlew='./gradlew'
	fi

	if [ "${1:-}" = '--all' ]; then
		say '手机端：打包 APK（四个 ABI 全打）'
		(cd "$MOBILE/android" && "$gradlew" assembleRelease --init-script "$MOBILE/gradle-mirror.init.gradle")
	else
		say '手机端：打包 APK（仅 arm64-v8a）'
		(cd "$MOBILE/android" && "$gradlew" assembleRelease --init-script "$MOBILE/gradle-mirror.init.gradle" -PreactNativeArchitectures=arm64-v8a)
	fi

	apk=$(find "$MOBILE/android/app/build/outputs/apk" -name '*.apk' 2>/dev/null | head -n 1)
	if [ -n "$apk" ]; then
		info "产物：${apk#"$ROOT"/}"
		info '安装：adb install -r <上面的路径>'
	else
		info '未找到 APK，请检查构建日志里的失败任务'
	fi
}

usage() {
	sed -n '3,12p' "$0" | sed 's/^# \{0,1\}//'
}

main() {
	target=${1:-}
	flag=${2:-}

	case "$target" in
	pc)
		build_pc "$flag"
		;;
	android)
		build_android "$flag"
		;;
	all)
		build_pc "$flag"
		printf '\n'
		build_android "$flag"
		;;
	'' | -h | --help | help)
		usage
		;;
	*)
		printf '未知目标：%s\n\n' "$target" >&2
		usage >&2
		exit 1
		;;
	esac
}

main "$@"
