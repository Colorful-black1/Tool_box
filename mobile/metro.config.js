const path = require('node:path')

const { getDefaultConfig } = require('expo/metro-config')

const projectRoot = __dirname
/** 桌面端纯逻辑所在目录（src/shared、src/main/services/library 等） */
const sharedSourceDir = path.resolve(projectRoot, '..', 'src')

const config = getDefaultConfig(projectRoot)

/**
 * 跨目录复用桌面端的纯逻辑：这些文件没有 Node / Electron 依赖，可直接被 Metro 编译，
 * 因此手机端不必复制一份，也不需要改动桌面端任何代码。
 *
 * 只监听 src/ 而不是仓库根，避免把根目录的 node_modules 纳入 Metro 监听与解析范围。
 * 手机端是独立包（未接入 npm workspaces），依赖全部装在 mobile/node_modules，
 * 所以解析路径里不能出现仓库根的 node_modules，否则会命中桌面端的 react 副本。
 */
config.watchFolders = [sharedSourceDir]
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')]
config.resolver.disableHierarchicalLookup = true

module.exports = config
