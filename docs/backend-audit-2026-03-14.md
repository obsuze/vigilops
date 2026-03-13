# VigilOps Backend 技术审计报告

**日期:** 2026-03-14
**审计范围:** `/backend/` 全部后端代码
**审计人:** Founding Engineer (CMP-8)

---

## 执行摘要

对 VigilOps 后端（FastAPI + SQLAlchemy + PostgreSQL + Redis）进行了全面技术审计，涵盖架构、安全、性能、测试覆盖和代码质量五个维度。

**关键数据：**
- 31 个路由文件，100+ REST 端点
- 27 个 SQLAlchemy 模型
- 14 个业务服务，9 个后台任务
- 51 个测试文件，333 个测试用例
- 代码量约 15,400 行

**发现：** 5 个 CRITICAL、8 个 HIGH、12 个 MEDIUM 级别问题
**已修复：** 6 个 P0/P1 问题在本次审计中直接修复

---

## 一、架构质量 ✅ 良好

### 优点
- **全异步架构：** 所有路由和服务使用 async/await，asyncpg 驱动，httpx 异步客户端
- **清晰的分层：** routers → services → models 三层设计
- **Pydantic 类型安全：** 21 个 schema 文件定义请求/响应模型
- **完善的中间件栈：** RequestSize → Security → RateLimit → CORS
- **优雅的生命周期管理：** lifespan context manager 管理 9 个后台任务的启停

### 改进建议
- 列表查询的分页逻辑在 22 个路由中重复，建议提取为通用 `paginated_list()` 工具函数
- 同步 Session（`SessionLocal`）仍在告警去重服务中使用，会阻塞事件循环

---

## 二、安全审计 ⚠️ 需要关注

### 已修复的 P0 问题

| # | 问题 | 文件 | 修复内容 |
|---|------|------|----------|
| 1 | **LDAP 注入** | `external_auth.py:439,460` | 使用 `ldap3.utils.conv.escape_filter_chars()` 转义 email |
| 2 | **未定义角色 "member"** | `external_auth.py:414,518` | 改为 "viewer"（系统已有的合法角色） |
| 3 | **OAuth state 内存泄漏** | `external_auth.py:81` | 添加 TTL 过期机制和清理函数 |
| 4 | **SSRF 防护不完整** | `notifier.py:104-131` | 使用 `ipaddress` 模块 + DNS 解析验证，覆盖 IPv6/link-local/cloud metadata |
| 5 | **密码无强度要求** | `schemas/auth.py:15` | 添加 field_validator：≥8位 + 数字 + 字母 |
| 6 | **数据库连接池缺失** | `core/database.py:19` | 添加 pool_size=20, max_overflow=10, pool_recycle=3600, pool_pre_ping=True |

### 仍需处理的安全问题

#### CRITICAL
- **硬编码 AI API Key：** `.env` 文件中包含真实的 `AI_API_KEY=sk-8a824d...`，应立即轮换
- **JWT 弱密钥默认值：** `JWT_SECRET_KEY=change-me-in-production...`，config.py 有生产环境检测但依赖正确配置

#### HIGH
- **命令注入风险：** `remediation/command_executor.py:241` 使用 `create_subprocess_shell()`，虽有安全检查白名单但建议改用 `create_subprocess_exec()`
- **Token 无法吊销：** 登出仅删除 cookie，JWT 在到期前仍有效（最长 2 小时）。应在 Redis 维护 token 黑名单（代码中已有 TODO）
- **OAuth state 应迁移 Redis：** 当前的内存存储不支持多实例部署

#### MEDIUM
- 部分路由缺少 rate limiting（remediation 触发端点）
- 用户名字段无长度限制
- 日志中可能包含敏感信息（OAuth token exchange 错误响应）

### 安全优势
- ✅ bcrypt 密码哈希
- ✅ JWT + 刷新令牌双令牌机制
- ✅ RBAC 角色访问控制（admin/operator/viewer）
- ✅ 完善的 OWASP 安全响应头
- ✅ 审计日志覆盖关键操作

---

## 三、性能审计 ⚠️ 需优化

### 已修复
- **数据库连接池：** 从默认 5 连接改为 pool_size=20 + max_overflow=10 + pool_pre_ping

### 仍需处理

#### N+1 查询模式
- `routers/hosts.py:88-96`：列出主机时逐个从 Redis 获取最新指标，应使用 Redis pipeline 批量操作
- 全局零 eager loading（无 joinedload/selectinload），所有关系延迟加载

#### 缺失索引
- `Alert.status` + `Alert.severity` + `Alert.fired_at` — 需复合索引
- `Host.status` — 频繁过滤字段
- `HostMetric.host_id` + `HostMetric.recorded_at` — 时序查询关键索引

#### 缓存策略不足
- 仅缓存最新主机指标（Redis）
- 查询结果、模板数据、配置数据未缓存
- 告警去重记录走数据库查询（高频路径）

#### Redis 连接池
- `core/redis.py` 未配置显式连接池参数
- 无健康检查和自动重连逻辑

---

## 四、测试覆盖 ⚠️ 有缺口

### 覆盖概况
- **51 个测试文件，333 个测试用例**
- 测试框架：pytest + pytest-asyncio + in-memory SQLite
- 测试配置完善：conftest.py 提供 8 个 fixture（admin_user, viewer_user, db_session 等）

### 未覆盖的路由（11/32 = 34%）
| 路由 | 风险 |
|------|------|
| `external_auth.py` (OAuth/LDAP) | **高** — 安全关键路径 |
| `alert_escalation.py` | **高** — 告警升级逻辑 |
| `on_call.py` | **高** — 值班调度 |
| `remediation.py` | **高** — 自动修复（安全相关） |
| `alert_rules.py` | 中 — 告警规则 CRUD |
| `dashboard_ws.py` | 中 — WebSocket |
| `dashboard_config.py` | 低 |
| `ai_feedback.py` | 低 |
| `log_admin.py` | 低 |
| `prometheus.py` | 低 |
| `agent_install_endpoint.py` | 低 |

### 缺失的测试类型
- **RBAC 权限测试：** 无 viewer/operator/admin 权限边界测试
- **Rate limiting 测试：** 限流中间件完全未测试
- **分页边界测试：** page_size=0, 负数, 超大值
- **端到端流程测试：** 告警规则 → 触发告警 → 通知 → 升级全链路

### 测试质量亮点
- `test_notifier_deep.py`（29 测试）— 覆盖全部通知渠道、SSRF 防护、重试逻辑
- `test_remediation/test_safety.py`（21 测试）— 命令安全检查全面覆盖

---

## 五、代码质量 ✅ 良好

### 优点
- 统一使用 SQLAlchemy 2.0 `select()` 语法
- Pydantic 模型规范数据校验
- 服务层 async/await 一致
- 异常处理不向客户端泄露内部信息

### 改进建议
- **Redis key 常量化：** `f"metrics:latest:{h.id}"` 等魔术字符串应定义为常量
- **错误处理一致性：** 部分任务循环中 `except Exception` 静默吞错（如 `alert_engine.py:64-65`）
- **缺少结构化日志：** 仅 5/32 路由使用 logger
- **Type hint 风格不统一：** 混用 `str | None` 和 `Optional[str]`

---

## 六、改进优先级

### 立即（本周）
1. ~~修复 LDAP 注入~~ ✅ 已修复
2. ~~修复未定义角色~~ ✅ 已修复
3. ~~增强 SSRF 防护~~ ✅ 已修复
4. ~~添加密码强度校验~~ ✅ 已修复
5. ~~配置数据库连接池~~ ✅ 已修复
6. 轮换暴露的 AI API Key
7. 确认生产环境 JWT_SECRET_KEY 已替换

### 短期（1-2 周）
8. 实现 Redis token 黑名单
9. 将 OAuth state 迁移到 Redis
10. 为 external_auth、alert_escalation、on_call 添加测试
11. 添加数据库缺失索引

### 中期（1 个月）
12. 提取通用分页工具函数
13. Redis 批量操作替代 N+1 模式
14. 结构化日志全局接入
15. 将 alert_deduplication 服务改为异步
16. 实现 RBAC 和 rate limiting 测试

---

## OWASP Top 10 合规情况

| ID | 类别 | 状态 |
|----|------|------|
| A01 | 访问控制 | ⚠️ "member" 角色已修复，需加测试 |
| A02 | 加密失败 | ⚠️ JWT 密钥需确认生产环境已替换 |
| A03 | 注入 | ✅ LDAP 注入已修复，SQL 使用 ORM 安全 |
| A04 | 不安全设计 | ⚠️ OAuth state 存储需迁移 Redis |
| A05 | 安全配置 | ⚠️ 默认密码在代码中 |
| A06 | 过时组件 | ❓ 需依赖版本审计 |
| A07 | 认证失败 | ✅ 密码校验已加强 |
| A08 | 数据完整性 | ⚠️ Token 吊销待实现 |
| A09 | 日志监控 | ⚠️ 安全事件日志不足 |
| A10 | SSRF | ✅ 已增强防护 |
