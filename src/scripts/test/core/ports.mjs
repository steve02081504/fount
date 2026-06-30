/** 测试节点首选 TCP 端口（自该值向上扫描空闲口；与生产默认口一致）。 */
export const TEST_PORT_BASE = 8931

/** headless 集成测试 config.json 占位 port（Web: false 时不 bind；与 live 口错开）。 */
export const HEADLESS_CONFIG_PORT = TEST_PORT_BASE + 10_000
