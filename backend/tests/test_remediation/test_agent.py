"""Agent 集成测试：mock AI + dry-run 模式下完整流程。"""
import pytest
from unittest.mock import AsyncMock, MagicMock

from app.remediation.agent import RemediationAgent
from app.remediation.ai_client import RemediationLLMClient
from app.remediation.command_executor import CommandExecutor
from app.remediation.models import (
    CommandResult,
    Diagnosis,
    RemediationAlert,
    RiskLevel,
    RunbookDefinition,
    RunbookStep,
)
from app.remediation.runbook_registry import RunbookRegistry


def _mock_db():
    """创建 mock AsyncSession。"""
    db = AsyncMock()
    db.add = MagicMock()
    db.flush = AsyncMock()
    db.commit = AsyncMock()
    db.execute = AsyncMock()
    return db


def _make_alert(**kwargs) -> RemediationAlert:
    defaults = dict(
        alert_id=1,
        alert_type="disk_full",
        severity="warning",
        host="web-01",
        message="Disk usage at 95%",
    )
    defaults.update(kwargs)
    return RemediationAlert(**defaults)


def _make_registry() -> RunbookRegistry:
    registry = RunbookRegistry()
    registry.register(
        RunbookDefinition(
            name="disk_cleanup",
            description="cleanup disk",
            match_alert_types=["disk_full"],
            match_keywords=["disk", "space"],
            risk_level=RiskLevel.AUTO,
            commands=[RunbookStep(description="cleanup", command="echo cleanup", timeout_seconds=30)],
        )
    )
    registry.register(
        RunbookDefinition(
            name="service_restart",
            description="restart service",
            match_alert_types=["service_down"],
            match_keywords=["service", "down", "nginx"],
            risk_level=RiskLevel.CONFIRM,
            commands=[RunbookStep(description="restart", command="echo restart {service}", timeout_seconds=30)],
        )
    )
    registry.load_from_db = AsyncMock()
    return registry


def _make_type_priority_registry() -> RunbookRegistry:
    registry = RunbookRegistry()
    registry.register(
        RunbookDefinition(
            name="service_default",
            description="generic service remediation",
            match_alert_types=["service_down"],
            match_keywords=["service"],
            risk_level=RiskLevel.CONFIRM,
            commands=[RunbookStep(description="inspect", command="echo inspect", timeout_seconds=30)],
        )
    )
    registry.register(
        RunbookDefinition(
            name="nginx_service_restart",
            description="nginx specific remediation",
            match_alert_types=["service_down"],
            match_keywords=["nginx", "upstream"],
            risk_level=RiskLevel.CONFIRM,
            commands=[RunbookStep(description="restart", command="echo restart nginx", timeout_seconds=30)],
        )
    )
    registry.load_from_db = AsyncMock()
    return registry


@pytest.mark.asyncio
async def test_handle_alert_auto_dry_run():
    """AUTO 风险 + dry-run 模式下应该成功执行（不真正执行命令）。"""
    mock_diagnosis = Diagnosis(
        root_cause="Disk full due to old temp files",
        confidence=0.95,
        suggested_runbook="disk_cleanup",
    )
    ai = RemediationLLMClient(mock_responses=[mock_diagnosis])
    executor = CommandExecutor(dry_run=True)
    agent = RemediationAgent(ai_client=ai, executor=executor, registry=_make_registry())
    db = _mock_db()

    alert = _make_alert()
    result = await agent.handle_alert(alert, db)

    assert result.success is True
    assert result.runbook_name == "disk_cleanup"
    assert result.risk_level == RiskLevel.AUTO
    assert len(result.command_results) > 0
    assert all(not r.executed for r in result.command_results)  # dry-run
    db.commit.assert_called()


@pytest.mark.asyncio
async def test_handle_alert_confirm_escalates():
    """CONFIRM 风险应该升级而不是执行。"""
    mock_diagnosis = Diagnosis(
        root_cause="Service crashed",
        confidence=0.9,
        suggested_runbook="service_restart",
    )
    ai = RemediationLLMClient(mock_responses=[mock_diagnosis])
    agent = RemediationAgent(ai_client=ai, registry=_make_registry())
    db = _mock_db()

    alert = _make_alert(alert_type="service_down", message="nginx is down")
    result = await agent.handle_alert(alert, db)

    assert result.success is False
    assert result.escalated is True
    assert "confirm" in result.blocked_reason.lower()


@pytest.mark.asyncio
async def test_handle_alert_no_runbook():
    """找不到 runbook 或匹配到需要确认的 runbook 时应该升级。"""
    mock_diagnosis = Diagnosis(
        root_cause="Unknown issue",
        confidence=0.5,
        suggested_runbook="nonexistent_runbook",
    )
    ai = RemediationLLMClient(mock_responses=[mock_diagnosis])
    agent = RemediationAgent(ai_client=ai, registry=_make_registry())
    db = _mock_db()

    alert = _make_alert(alert_type="unknown_alert_type", message="Unknown issue detected")
    result = await agent.handle_alert(alert, db)

    assert result.success is False
    assert result.escalated is True
    assert "no matching runbook" in result.blocked_reason.lower()


@pytest.mark.asyncio
async def test_circuit_breaker_blocks():
    """熔断器开启时应该直接拒绝。"""
    mock_diagnosis = Diagnosis(root_cause="test", confidence=0.9, suggested_runbook="disk_cleanup")
    ai = RemediationLLMClient(mock_responses=[mock_diagnosis])
    agent = RemediationAgent(ai_client=ai, registry=_make_registry())
    # 触发熔断
    for _ in range(3):
        agent.circuit_breaker.record_failure("web-01")
    db = _mock_db()

    alert = _make_alert()
    result = await agent.handle_alert(alert, db)

    assert result.success is False
    assert "circuit breaker" in result.blocked_reason.lower()


@pytest.mark.asyncio
async def test_runbook_registry_match():
    """Runbook 注册表应该正确匹配。"""
    registry = _make_registry()
    assert len(registry.list_all()) == 2

    alert = _make_alert(alert_type="disk_full")
    diag = Diagnosis(root_cause="disk full", confidence=0.9, suggested_runbook="disk_cleanup")
    rb = registry.match(alert, diag)
    assert rb is not None
    assert rb.name == "disk_cleanup"


@pytest.mark.asyncio
async def test_runbook_registry_prefers_alert_type_then_keyword_score():
    """多个相同 alert_type 候选时，应按关键词得分选最优。"""
    registry = _make_type_priority_registry()

    alert = _make_alert(alert_type="service_down", message="nginx upstream is down")
    diag = Diagnosis(root_cause="service issue", confidence=0.7, suggested_runbook=None)
    rb = registry.match(alert, diag)

    assert rb is not None
    assert rb.name == "nginx_service_restart"


@pytest.mark.asyncio
async def test_handle_alert_blocks_when_safety_checks_fail():
    """safety_checks 不通过时应在执行前阻止。"""
    registry = RunbookRegistry()
    registry.register(
        RunbookDefinition(
            name="needs_service_label",
            description="requires service label",
            match_alert_types=["service_down"],
            match_keywords=["service"],
            safety_checks=["require_label:service"],
            risk_level=RiskLevel.AUTO,
            commands=[RunbookStep(description="inspect", command="echo inspect", timeout_seconds=30)],
        )
    )
    registry.load_from_db = AsyncMock()

    ai = RemediationLLMClient(
        mock_responses=[Diagnosis(root_cause="service issue", confidence=0.95, suggested_runbook=None)]
    )
    agent = RemediationAgent(ai_client=ai, registry=registry)
    db = _mock_db()

    alert = _make_alert(alert_type="service_down", message="service is down", labels={})
    result = await agent.handle_alert(alert, db)

    assert result.success is False
    assert result.escalated is True
    assert "safety checks failed" in result.blocked_reason.lower()


@pytest.mark.asyncio
async def test_handle_alert_runs_verify_steps():
    """自定义 verify_steps 应接入执行后的验证流程。"""
    registry = RunbookRegistry()
    registry.register(
        RunbookDefinition(
            name="verify_enabled_runbook",
            description="run with verification",
            match_alert_types=["disk_full"],
            match_keywords=["disk"],
            safety_checks=[],
            risk_level=RiskLevel.AUTO,
            commands=[RunbookStep(description="cleanup", command="echo cleanup", timeout_seconds=30)],
            verify_commands=[RunbookStep(description="verify", command="echo verify", timeout_seconds=30)],
        )
    )
    registry.load_from_db = AsyncMock()

    ai = RemediationLLMClient(
        mock_responses=[Diagnosis(root_cause="disk issue", confidence=0.95, suggested_runbook=None)]
    )
    executor = CommandExecutor(dry_run=True)
    agent = RemediationAgent(ai_client=ai, registry=registry, executor=executor)
    db = _mock_db()

    result = await agent.handle_alert(_make_alert(), db)

    assert result.success is True
    assert result.verification_passed is True
    assert len(result.command_results) == 2


class SequenceExecutor(CommandExecutor):
    def __init__(self, responses: list[list[CommandResult]]) -> None:
        super().__init__(dry_run=False)
        self.responses = list(responses)
        self.calls: list[list[RunbookStep]] = []

    async def execute_steps(self, steps: list[RunbookStep]) -> list[CommandResult]:
        self.calls.append(steps)
        return self.responses.pop(0)


@pytest.mark.asyncio
async def test_handle_alert_runs_rollbacks_in_reverse_order():
    """主步骤失败时，应对已成功步骤按逆序执行 rollback。"""
    registry = RunbookRegistry()
    registry.register(
        RunbookDefinition(
            name="rollback_runbook",
            description="run with rollback",
            match_alert_types=["disk_full"],
            match_keywords=["disk"],
            safety_checks=[],
            risk_level=RiskLevel.AUTO,
            commands=[
                RunbookStep(
                    description="step1",
                    command="echo step1",
                    rollback_command="echo rollback1",
                    timeout_seconds=30,
                ),
                RunbookStep(
                    description="step2",
                    command="echo step2",
                    rollback_command="echo rollback2",
                    timeout_seconds=30,
                ),
            ],
        )
    )
    registry.load_from_db = AsyncMock()

    ai = RemediationLLMClient(
        mock_responses=[Diagnosis(root_cause="disk issue", confidence=0.95, suggested_runbook=None)]
    )
    executor = SequenceExecutor(
        responses=[
            [
                CommandResult(command="echo step1", exit_code=0, executed=True),
                CommandResult(command="echo step2", exit_code=1, executed=True, stderr="boom"),
            ],
            [
                CommandResult(command="echo rollback1", exit_code=0, executed=True),
            ],
        ]
    )
    agent = RemediationAgent(ai_client=ai, registry=registry, executor=executor)
    db = _mock_db()

    result = await agent.handle_alert(_make_alert(), db)

    assert result.success is False
    assert len(executor.calls) == 2
    assert [step.command for step in executor.calls[1]] == ["echo rollback1"]
    assert result.command_results[-1].command == "echo rollback1"
