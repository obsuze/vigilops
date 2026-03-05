/**
 * 自动修复列表页 (Remediation List Page)
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table, Card, Typography, Select, Space, Button, Row, Col } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { remediationService } from '../services/remediation';
import type { Remediation } from '../services/remediation';
import { RemediationStatusTag, RiskLevelTag } from '../components/RemediationBadge';

export default function RemediationList() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [data, setData] = useState<Remediation[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [hostFilter, setHostFilter] = useState<string>('');
  const [hosts, setHosts] = useState<string[]>([]);

  const fetch = async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = { page, page_size: 20 };
      if (statusFilter) params.status = statusFilter;
      if (hostFilter) params.host = hostFilter;
      const { data: res } = await remediationService.list(params);
      setData(res.items || []);
      setTotal(res.total || 0);
      const allHosts = (res.items || []).map((r) => r.host).filter(Boolean);
      setHosts((prev) => [...new Set([...prev, ...allHosts])]);
    } catch { /* ignore */ } finally { setLoading(false); }
  };

  useEffect(() => { fetch(); }, [page, statusFilter, hostFilter]);

  const columns = [
    {
      title: t('common.time'), dataIndex: 'created_at', width: 180,
      render: (val: string) => new Date(val).toLocaleString(),
    },
    { title: t('remediation.alertName'), dataIndex: 'alert_name', ellipsis: true, render: (v: string) => v || '-' },
    { title: t('remediation.host'), dataIndex: 'host', width: 160, render: (v: string) => v || '-' },
    {
      title: t('remediation.status'), dataIndex: 'status', width: 100,
      render: (s: string) => <RemediationStatusTag status={s} />,
    },
    { title: t('remediation.runbook'), dataIndex: 'runbook_name', ellipsis: true },
    {
      title: t('remediation.riskLevel'), dataIndex: 'risk_level', width: 100,
      render: (l: string) => <RiskLevelTag level={l} />,
    },
    {
      title: t('common.actions'), key: 'action', width: 80,
      render: (_: unknown, record: Remediation) => (
        <Button type="link" size="small" onClick={() => navigate(`/remediations/${record.id}`)}>
          {t('common.detail')}
        </Button>
      ),
    },
  ];

  return (
    <div>
      <Typography.Title level={4}>
        <ThunderboltOutlined style={{ marginRight: 8 }} />
        {t('remediation.title')}
      </Typography.Title>

      <Row style={{ marginBottom: 16 }}>
        <Col>
          <Space>
            <Select
              placeholder={t('remediation.filterStatus')} allowClear style={{ width: 130 }}
              onChange={(v) => { setStatusFilter(v || ''); setPage(1); }}
              options={[
                { label: t('remediation.statusPending'), value: 'pending' },
                { label: t('remediation.statusApproved'), value: 'approved' },
                { label: t('remediation.statusExecuting'), value: 'executing' },
                { label: t('remediation.statusSuccess'), value: 'success' },
                { label: t('remediation.statusFailed'), value: 'failed' },
                { label: t('remediation.statusRejected'), value: 'rejected' },
              ]}
            />
            <Select
              placeholder={t('remediation.filterHost')} allowClear style={{ width: 180 }}
              showSearch
              onChange={(v) => { setHostFilter(v || ''); setPage(1); }}
              options={hosts.map((h) => ({ label: h, value: h }))}
            />
          </Space>
        </Col>
      </Row>

      <Card>
        <Table
          dataSource={data} columns={columns} rowKey="id" loading={loading}
          pagination={{ current: page, pageSize: 20, total, onChange: (p) => setPage(p) }}
        />
      </Card>
    </div>
  );
}
